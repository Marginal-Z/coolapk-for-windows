import { createHash, createHmac } from 'node:crypto';
import { ApiError, assertLogin } from './client.mjs';
const input = message => { throw new ApiError(message, 'INPUT'); };
const field = (value, key) => { const text = value?.[key]; if (typeof text !== 'string' || !text || text.length > 8192 || /[\r\n\0]/.test(text)) throw new ApiError(`视频上传响应缺少 ${key}`); return text; };
export function videoUrl(value) {
  let url; try { url = new URL(value); } catch { return input('视频地址无效'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !['myqcloud.com', 'qcloud.com', 'vodqcloud.com', 'vodqcloudcdn.com'].some(domain => url.hostname.endsWith('.' + domain))) input('视频地址必须来自官方上传服务');
  return url.href;
}
export function validateVideo(args) {
  if (!(args.bytes instanceof Uint8Array) && !Array.isArray(args.bytes) || !(args.coverBytes instanceof Uint8Array) && !Array.isArray(args.coverBytes) || args.bytes.length > 256 * 1024 ** 2 || args.coverBytes.length > 8 * 1024 ** 2) input('视频或封面数据无效');
  const video = Buffer.from(args.bytes), cover = Buffer.from(args.coverBytes);
  if (video.length < 12 || video.length > 256 * 1024 ** 2 || video.toString('ascii', 4, 8) !== 'ftyp') input('请选择不超过 256 MB 的 MP4 或 MOV 视频');
  if (cover.length < 3 || cover.length > 8 * 1024 ** 2 || !cover.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) input('视频封面必须是有效 JPG');
  if (!Number.isInteger(args.duration) || args.duration < 1 || args.duration > 86400) input('视频时长无效');
  if (typeof args.name !== 'string' || args.name.length > 200 || /[\r\n\0/\\]/.test(args.name)) input('视频名称无效');
  return { video, cover, kind: video.toString('ascii', 8, 12) === 'qt  ' ? 'mov' : 'mp4' };
}
export function cosUpload(prepared, storagePath, contentType, now = Math.floor(Date.now() / 1000)) {
  const bucket = field(prepared, 'storageBucket'), region = field(prepared, 'storageRegionV5'), appId = String(prepared.storageAppId || '');
  if (!/^[A-Za-z0-9-]{1,80}$/.test(bucket) || !/^[A-Za-z0-9-]{1,50}$/.test(region) || !/^\d{1,20}$/.test(appId)) throw new ApiError('视频存储地址无效');
  if (typeof storagePath !== 'string' || !/^\/?[A-Za-z0-9_./%-]{1,2000}$/.test(storagePath) || /%|\\/.test(storagePath) || storagePath.split('/').some(s => s === '..' || s === '.')) throw new ApiError('视频存储路径无效');
  const host = `${bucket}-${appId}.cos.${region}.myqcloud.com`, url = new URL('https://' + host + '/' + storagePath.replace(/^\//, ''));
  const cert = prepared.tempCertificate, expires = Number(cert?.expiredTime);
  if (!Number.isInteger(expires) || expires <= now) throw new ApiError('视频上传凭证已过期');
  const time = `${now - 60};${Math.min(expires, now + 1800)}`;
  const hmac = (key, value) => createHmac('sha1', key).update(value).digest('hex');
  const signKey = hmac(field(cert, 'secretKey'), time);
  const canonicalHash = createHash('sha1').update(`put\n${url.pathname}\n\nhost=${host}\n`).digest('hex');
  const sign = hmac(signKey, `sha1\n${time}\n${canonicalHash}\n`);
  return { url, headers: { Authorization: `q-sign-algorithm=sha1&q-ak=${field(cert, 'secretId')}&q-sign-time=${time}&q-key-time=${time}&q-header-list=host&q-url-param-list=&q-signature=${sign}`, 'x-cos-security-token': field(cert, 'token'), 'Content-Type': contentType } };
}
export async function uploadVideo(client, args) {
  assertLogin(client.identity);
  const { video, cover, kind } = validateVideo(args);
  const signatureResult = await client.request('/v6/upload/TXUgcUploadPrepare', {}, { method: 'POST', form: {} });
  const signature = field({ signature: signatureResult.data }, 'signature');
  const report = `coolapk-desktop-${Date.now()}`;
  const shared = { signature, clientReportId: report, clientVersion: '9.1.10566' };
  async function vod(action, body) {
    const response = await client.fetch(`https://vod2.qcloud.com/v3/index.php?Action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new ApiError(`视频上传服务返回 HTTP ${response.status}`, 'UPLOAD');
    let result; try { result = await response.json(); } catch { throw new ApiError('视频上传响应无效', 'UPLOAD'); }
    if (result.code !== 0 || !result.data) throw new ApiError('视频上传服务拒绝请求，请稍后重试', 'UPLOAD');
    return result.data;
  }
  const prepared = await vod('ApplyUploadUGC', { ...shared, videoName: args.name, videoType: kind, videoSize: video.length, coverName: 'cover.jpg', coverType: 'jpg', coverSize: cover.length });
  for (const [data, object, contentType] of [[video, prepared.video, kind === 'mov' ? 'video/quicktime' : 'video/mp4'], [cover, prepared.cover, 'image/jpeg']]) {
    const request = cosUpload(prepared, field(object, 'storagePath'), contentType);
    const response = await client.fetch(request.url, { method: 'PUT', headers: request.headers, body: data, redirect: 'error', signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new ApiError(`视频文件上传失败 HTTP ${response.status}`, 'UPLOAD');
  }
  const committed = await vod('CommitUploadUGC', { ...shared, vodSessionKey: field(prepared, 'vodSessionKey') });
  const mediaUrl = videoUrl(field(committed.video, 'url')), coverUrl = videoUrl(field(committed.cover, 'url'));
  const info = { name: '', mediaType: 'video', artistName: '', duration: args.duration, cover: coverUrl, isLive: false, identify: createHash('md5').update(`coolapkVideo:${mediaUrl}`).digest('hex'), source: '11', redirectSource: false, requestParams: JSON.stringify({ '普通': { fromType: 'coolapkVideo', '0': mediaUrl, '1': args.duration } }) };
  return { data: { mediaUrl, mediaInfo: JSON.stringify(info), cover: coverUrl } };
}
