import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ApiError, assertLogin, numericId, sanitizeCookie } from './client.mjs';
import { APK_PROFILE, requestHeaders } from './auth.mjs';
import { imageFormat, imageUploadCallback, ossTarget, prepareImageProcesses, processUploadedImage } from './upload.mjs';

export const LIVE_PHOTO_OPERATIONS = Object.freeze(['livePhotoVideo', 'uploadLivePhoto']);
export const LIVE_PHOTO_LIMITS = Object.freeze({ image: 20 * 1024 ** 2, video: 64 * 1024 ** 2 });
const cdnHosts = new Set(['image.coolapk.com', 'video.coolapk.com', 'cdn.coolapk.com', 'static.coolapk.com']);
export function livePhotoUrl(value, image = false) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x20\x7f\\]/.test(value)) throw new ApiError('实况照片地址无效', 'INPUT');
  let url; try { url = new URL(value); } catch { throw new ApiError('实况照片地址无效', 'INPUT'); }
  if (!['http:', 'https:'].includes(url.protocol) || !cdnHosts.has(url.hostname) || image && url.hostname !== 'image.coolapk.com' || url.port || url.username || url.password || url.hash) throw new ApiError('实况照片只能使用酷安官方 CDN 地址', 'INPUT');
  url.protocol = 'https:'; return url.toString();
}
export function liveVideoFormat(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > LIVE_PHOTO_LIMITS.video) throw new ApiError('请选择非空 MP4/MOV 实况视频，不能超过 64 MB', 'INPUT');
  const buffer = Buffer.from(bytes), size = buffer.readUInt32BE(0);
  if (buffer.subarray(4, 8).toString() !== 'ftyp' || size < 16 || size > buffer.length || size > 4096) throw new ApiError('实况视频必须是标准 MP4 或 MOV 容器', 'INPUT');
  const brand = buffer.subarray(8, 12).toString();
  if (!['qt  ', 'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV'].includes(brand)) throw new ApiError('实况视频必须是标准 MP4 或 MOV 容器', 'INPUT');
  let offset = 0, media = false, movie = false;
  while (offset + 8 <= buffer.length) {
    let boxSize = buffer.readUInt32BE(offset), header = 8;
    const boxType = buffer.subarray(offset + 4, offset + 8).toString();
    if (boxSize === 1) { if (offset + 16 > buffer.length) throw new ApiError('实况视频容器不完整', 'INPUT'); const wide = buffer.readBigUInt64BE(offset + 8); if (wide > BigInt(buffer.length)) throw new ApiError('实况视频容器不完整', 'INPUT'); boxSize = Number(wide); header = 16; }
    if (boxSize === 0) boxSize = buffer.length - offset;
    if (boxSize < header || offset + boxSize > buffer.length) throw new ApiError('实况视频容器不完整', 'INPUT');
    media ||= boxType === 'mdat' && boxSize > header; movie ||= boxType === 'moov' && boxSize > header;
    offset += boxSize;
  }
  if (offset !== buffer.length || !media || !movie) throw new ApiError('实况视频缺少媒体或电影轨道数据', 'INPUT');
  return brand === 'qt  ' ? ['video/quicktime', 'mov'] : ['video/mp4', 'mp4'];
}
function accountGuard(client) {
  const uid = String(client.identity?.uid ?? ''), cookie = client.cookie, code = client.deviceCode;
  return () => { if (String(client.identity?.uid ?? '') !== uid || client.cookie !== cookie || client.deviceCode !== code) throw new ApiError('账号已切换，请重新上传', 'ACCOUNT_CHANGED'); };
}
async function limitedText(response, limit = 65536) {
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new ApiError('实况照片响应异常', 'API_ERROR');
  const reader = response.body.getReader(), chunks = []; let count = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; count += value.length; if (count > limit) { await reader.cancel(); throw new ApiError('实况照片响应异常', 'API_ERROR'); } chunks.push(value); } } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function videoFromJson(value, depth = 0) {
  if (depth > 5) return '';
  if (typeof value === 'string') { try { return livePhotoUrl(value); } catch { return ''; } }
  if (Array.isArray(value)) return value.slice(0, 32).map(item => videoFromJson(item, depth + 1)).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  return ['url', 'videoUrl', 'video_url', 'finalUrl', 'final_url', 'urlList', 'url_list', 'data'].map(key => videoFromJson(value[key], depth + 1)).find(Boolean) || '';
}
export async function resolveLivePhoto(client, args) {
  const pic = new URL(livePhotoUrl(args.picUrl, true)), id = numericId(args.id), type = args.contentType ?? 'feed';
  if (!['feed', 'reply', 'article'].includes(type)) throw new ApiError('实况照片内容类型无效', 'INPUT');
  // Official resolver checks original image.coolapk.com HTTP form.
  pic.protocol = 'http:';
  const url = new URL('/v6/livePhoto/showVideo', 'https://api.coolapk.com');
  url.searchParams.set('picUrl', pic.toString()); url.searchParams.set('id', `${type}_${id}`);
  const headers = { ...requestHeaders(client.deviceCode), 'X-Requested-With': 'XMLHttpRequest' };
  if (client.cookie) headers.Cookie = sanitizeCookie(client.cookie).split(';').filter(part => !/^\s*ddid=/i.test(part)).join(';').trim();
  const guard = accountGuard(client); guard();
  let response;
  try { response = await client.fetch(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(20000) }); }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError('实况照片视频解析失败，请检查网络后重试', 'NETWORK'); }
  guard();
  if (response.status >= 300 && response.status < 400) {
    const target = response.headers.get('location');
    if (!target) throw new ApiError('酷安未返回实况照片视频地址', 'API_ERROR');
    const result = livePhotoUrl(new URL(target, url).toString());
    return { data: { url: result } }; // Resolve only. Never follow with account headers.
  }
  if (!response.ok) throw new ApiError(`实况照片解析返回 HTTP ${response.status}`, response.status === 401 ? 'LOGIN_REQUIRED' : 'HTTP');
  let raw; try { raw = JSON.parse(await limitedText(response)); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('酷安未返回有效实况照片数据', 'API_ERROR'); }
  guard();
  if (!raw || typeof raw !== 'object' || raw.status != null && ![1, 200].includes(Number(raw.status)) || raw.code != null && ![1, 200].includes(Number(raw.code))) throw new ApiError('酷安未确认实况照片解析成功', 'API_ERROR');
  const result = videoFromJson(raw);
  if (!result) throw new ApiError('酷安未返回可播放的实况照片视频地址', 'API_ERROR');
  return { data: { url: result } };
}
function credentials(info) {
  if (!info || typeof info.endPoint !== 'string' || ![info.accessKeyId, info.accessKeySecret, info.securityToken].every(value => typeof value === 'string' && value.length > 0 && value.length < 8192 && !/[\r\n\x00]/.test(value))) throw new ApiError('实况照片上传凭据不完整', 'API_ERROR');
  let endpoint; try { endpoint = new URL(info.endPoint.includes('://') ? info.endPoint : `https://${info.endPoint}`); } catch { throw new ApiError('实况照片上传服务器无效', 'API_ERROR'); }
  if (!/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(endpoint.hostname) || !['http:', 'https:'].includes(endpoint.protocol) || endpoint.search || endpoint.hash || endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/') throw new ApiError('实况照片上传服务器无效', 'API_ERROR');
}
function target(info, file) {
  if (!file || typeof file.uploadFileName !== 'string' || file.uploadFileName.split('/').some(part => part === '.' || part === '..')) throw new ApiError('实况照片上传路径缺失', 'API_ERROR');
  credentials(info); return ossTarget(info.bucket, info.endPoint, file.uploadFileName);
}
async function signedPut(client, bytes, mime, info, file, guard, image, hasProcess = false) {
  const url = target(info, file), md5 = createHash('md5').update(bytes).digest('base64'), date = new Date().toUTCString();
  const headers = { 'Content-MD5': md5, 'Content-Type': mime, Date: date, 'x-oss-security-token': info.securityToken };
  if (image) {
    Object.assign(headers, imageUploadCallback(info, hasProcess));
  }
  const canonicalHeaders = Object.entries(headers).filter(([key]) => key.startsWith('x-oss-')).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}\n`).join('');
  const canonical = `PUT\n${md5}\n${mime}\n${date}\n${canonicalHeaders}/${info.bucket}/${file.uploadFileName}`;
  headers.Authorization = `OSS ${info.accessKeyId}:${createHmac('sha1', info.accessKeySecret).update(canonical).digest('base64')}`;
  guard(); let response;
  try { response = await client.fetch(url, { method: 'PUT', headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError(image ? '实况照片封面上传失败' : '实况视频上传失败，未作为静态图片发送', 'NETWORK'); }
  guard(); if (!response.ok) throw new ApiError(`${image ? '实况封面' : '实况视频'}上传返回 HTTP ${response.status}`, 'HTTP');
}
export async function uploadLivePhoto(client, args) {
  assertLogin(client.identity);
  if (args.dir != null && args.dir !== 'feed') throw new ApiError('实况照片目前使用动态和评论图片上传协议', 'INPUT');
  if (!(args.bytes instanceof Uint8Array) && !Array.isArray(args.bytes) || !(args.videoBytes instanceof Uint8Array) && !Array.isArray(args.videoBytes)) throw new ApiError('请选择实况照片和配对的视频', 'INPUT');
  if (!args.bytes.length || args.bytes.length > LIVE_PHOTO_LIMITS.image || args.videoBytes.length > LIVE_PHOTO_LIMITS.video) throw new ApiError('实况封面不能超过 20 MB，视频不能超过 64 MB', 'INPUT');
  if ([args.bytes, args.videoBytes].some(value => Array.isArray(value) && value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))) throw new ApiError('实况照片数据无效', 'INPUT');
  const bytes = Buffer.from(args.bytes), video = Buffer.from(args.videoBytes), [imageMime, imageExt] = imageFormat(bytes), [videoMime, videoExt] = liveVideoFormat(video);
  const width = Number(args.width), height = Number(args.height);
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 30000) || args.hdr != null && ![0, 1].includes(args.hdr)) throw new ApiError('实况照片尺寸或 HDR 标记无效', 'INPUT');
  const name = `${randomUUID()}.${imageExt}`, videoName = `${createHash('md5').update(video).digest('hex')}.${videoExt}`;
  const guard = accountGuard(client); guard();
  const prepared = await client.request('/v6/upload/ossUploadPrepare', {}, { method: 'POST', form: { uploadBucket: 'image', uploadDir: 'feed', is_anonymous: 0, toUid: numericId(client.identity.uid), feed_type: 'feed', uploadFileList: JSON.stringify([{ name, resolution: `${width}x${height}`, md5: createHash('md5').update(bytes).digest('hex'), hdr: args.hdr ?? 0, livePhotoVideo: videoName, livePhoto: 1 }, { name: videoName, md5: createHash('md5').update(video).digest('hex') }]) } });
  guard();
  const data = prepared.data, info = data?.uploadPrepareInfo, files = data?.fileInfo;
  if (!Array.isArray(files) || files.length !== 2 || !info) throw new ApiError('酷安未返回完整实况照片上传凭据', 'API_ERROR');
  const movie = files.find(file => file.name === videoName), still = files.find(file => file.name === name) || files[0];
  if (!movie || !still || still === movie) throw new ApiError('酷安未返回配对实况视频凭据，已停止上传', 'API_ERROR');
  const prefix = livePhotoUrl(info.uploadImagePrefix || 'https://image.coolapk.com', true).replace(/\/$/, '');
  // Validate both destinations before uploading either file.
  const movieUrl = movie.url ? livePhotoUrl(movie.url) : (target(info, movie), '');
  const stillUrl = still.url ? livePhotoUrl(still.url, true) : (target(info, still), livePhotoUrl(`${prefix}/${still.uploadFileName}`, true));
  const processes = still.url ? [] : prepareImageProcesses(info, still.uploadFileName);
  if (!still.url) imageUploadCallback(info, processes.length > 0); // Validate before either upload.
  if (movieUrl && movieUrl === stillUrl || movie.uploadFileName && movie.uploadFileName === still.uploadFileName) throw new ApiError('实况视频和封面上传路径冲突', 'API_ERROR');
  if (!movieUrl) await signedPut(client, video, videoMime, info, movie, guard, false);
  if (!still.url) {
    await signedPut(client, bytes, imageMime, info, still, guard, true, processes.length > 0);
    await processUploadedImage(client, info, still.uploadFileName, processes, guard);
  }
  guard(); return { data: stillUrl, livePhoto: true };
}
export async function dispatchLivePhoto(client, operation, args = {}) {
  if (!LIVE_PHOTO_OPERATIONS.includes(operation)) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('实况照片参数无效', 'INPUT');
  return operation === 'uploadLivePhoto' ? uploadLivePhoto(client, args) : resolveLivePhoto(client, args);
}
