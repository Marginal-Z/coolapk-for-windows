import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ApiError, assertLogin, numericId } from './client.mjs';
import { imageSettingsAccountGuard } from './image-settings.mjs';

export function imageFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['image/png', 'png'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg'];
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return ['image/gif', 'gif'];
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  throw new ApiError('支持 JPG、PNG、GIF 和 WebP 图片', 'INPUT');
}
export function officialImageUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'image.coolapk.com' || url.username || url.password) throw new ApiError('图片地址不属于酷安', 'INPUT');
  url.protocol = 'https:'; return url.toString();
}
export function ossTarget(bucket, endpoint, key) {
  if (typeof bucket !== 'string' || typeof key !== 'string' || !/^[a-z0-9-]{3,63}$/.test(bucket) || !/^[A-Za-z0-9_./@-]{1,2048}$/.test(key) || key.split('/').some(part => part === '.' || part === '..')) throw new ApiError('上传路径无效', 'API_ERROR');
  if (typeof endpoint !== 'string' || endpoint.length > 512) throw new ApiError('上传服务器地址无效', 'API_ERROR');
  let host; try { host = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`); } catch { throw new ApiError('上传服务器地址无效', 'API_ERROR'); }
  if (!/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(host.hostname) || !['http:', 'https:'].includes(host.protocol) || host.search || host.hash || host.port || host.username || host.password || !['/', ''].includes(host.pathname)) throw new ApiError('上传服务器地址无效', 'API_ERROR');
  return `https://${bucket}.${host.hostname}/${key}`;
}
function credentials(info) {
  if (!info || ![info.accessKeyId, info.accessKeySecret, info.securityToken].every(value => typeof value === 'string' && value.length > 0 && value.length < 8192 && !/[\r\n\x00]/.test(value))) throw new ApiError('上传凭据不完整', 'API_ERROR');
}
export function prepareImageProcesses(info, key) {
  const process = info?.process;
  if (process == null) return [];
  if (typeof process !== 'object' || Array.isArray(process) || Object.keys(process).length > 16) throw new ApiError('酷安图片处理规则无效', 'API_ERROR');
  return Object.entries(process).map(([action, suffix]) => {
    if (!/^[a-z][a-z0-9_-]*(?:[,/]|$)/.test(action) || /^(?:video|document|sys)\//.test(action) || action.length > 8192 || /[^\x21-\x7e]|[?&#]|\|sys\//.test(action) || typeof suffix !== 'string' || suffix.length > 512) throw new ApiError('酷安图片处理规则无效', 'API_ERROR');
    const target = key + suffix; ossTarget(info.bucket, info.endPoint, target);
    return { action: action.startsWith('image/') ? action : `image/${action}`, key: target };
  });
}
function callbackUrl(info) {
  const value = info.callbackUrl || 'https://api.coolapk.com/v6/callback/mobileOssUploadSuccessCallback?checkArticleCoverResolution=0&versionCode=2609291';
  let url; try { url = new URL(value); } catch { throw new ApiError('酷安图片回调地址无效', 'API_ERROR'); }
  if (typeof value !== 'string' || value.length > 4096 || url.hostname !== 'api.coolapk.com' || url.pathname !== '/v6/callback/mobileOssUploadSuccessCallback' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash) throw new ApiError('酷安图片回调地址无效', 'API_ERROR');
  url.protocol = 'https:'; return url.toString();
}
export function imageUploadCallback(info, hasProcess) {
  return {
    'x-oss-callback': Buffer.from(JSON.stringify({ callbackBodyType: 'application/json', callbackHost: 'api.coolapk.com', callbackUrl: callbackUrl(info), callbackBody: '{"bucket":${bucket},"object":${object},"hasProcess":${x:var1}}' })).toString('base64'),
    'x-oss-callback-var': Buffer.from(JSON.stringify({ 'x:var1': String(hasProcess) })).toString('base64'),
  };
}
async function signedRequest(client, info, key, { method, mime = '', body, extra = {}, query = '', guard, message }) {
  credentials(info);
  const url = ossTarget(info.bucket, info.endPoint, key) + query, md5 = body == null ? '' : createHash('md5').update(body).digest('base64'), date = new Date().toUTCString();
  const headers = { Date: date, 'x-oss-security-token': info.securityToken, ...extra };
  if (mime) headers['Content-Type'] = mime;
  if (body != null) headers['Content-MD5'] = md5;
  const canonicalHeaders = Object.keys(headers).filter(key => key.startsWith('x-oss-')).sort().map(key => `${key}:${headers[key]}\n`).join('');
  headers.Authorization = `OSS ${info.accessKeyId}:${createHmac('sha1', info.accessKeySecret).update(`${method}\n${md5}\n${mime}\n${date}\n${canonicalHeaders}/${info.bucket}/${key}${query}`).digest('base64')}`;
  guard(); let response;
  try { response = await client.fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(method === 'PUT' ? 90000 : 20000), headers, ...(body == null ? {} : { body }) }); }
  catch (error) { guard(); if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError(`${message}失败，请检查网络后重试`, 'NETWORK'); }
  guard(); if (!response.ok) throw new ApiError(`${message}返回 HTTP ${response.status}`, 'HTTP');
  return response;
}
export async function processUploadedImage(client, info, sourceKey, processes, guard = imageSettingsAccountGuard(client)) {
  // Native OssHelper uploads with hasProcess, persists each server-supplied
  // image action to sourceKey + suffix, then HEAD-checks the resulting object.
  // The server supplies the actual watermark pixels; original bytes are not
  // flattened through an SDR canvas before upload.
  for (const process of processes) {
    const body = Buffer.from(`x-oss-process=${process.action}|sys/saveas,o_${Buffer.from(process.key).toString('base64')},b_${Buffer.from(info.bucket).toString('base64')}`);
    const extension = sourceKey.split('.').at(-1).toLowerCase(), mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[extension] || 'application/octet-stream';
    await signedRequest(client, info, sourceKey, { method: 'POST', mime, body, query: '?x-oss-process', guard, message: '图片处理' });
    await signedRequest(client, info, process.key, { method: 'HEAD', guard, message: '图片处理结果核对' });
  }
}
export async function uploadImage(client, args) {
  assertLogin(client.identity);
  const guard = imageSettingsAccountGuard(client); guard();
  const dir = args.dir || 'feed';
  if (!['feed', 'message', 'cover', 'album'].includes(dir)) throw new ApiError('上传类型无效', 'INPUT');
  const toUid = dir === 'message' ? numericId(args.toUid) : client.identity.uid;
  if (!(args.bytes instanceof Uint8Array) && !Array.isArray(args.bytes)) throw new ApiError('没有读取到图片', 'INPUT');
  const bytes = Buffer.from(args.bytes);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new ApiError('单张图片不能超过 20 MB', 'INPUT');
  const [mime, ext] = imageFormat(bytes);
  const name = `${randomUUID()}.${ext}`;
  const prepare = await client.request('/v6/upload/ossUploadPrepare', {}, { method: 'POST', form: {
    uploadBucket: dir === 'feed' ? 'image' : dir, uploadDir: dir, is_anonymous: 0, toUid, feed_type: dir === 'feed' ? 'feed' : '',
    uploadFileList: JSON.stringify([{ name, resolution: `${Math.max(1, Math.min(30000, Number(args.width) || 1))}x${Math.max(1, Math.min(30000, Number(args.height) || 1))}`, md5: createHash('md5').update(bytes).digest('hex'), hdr: 0 }]),
  } });
  guard();
  const info = prepare.data?.uploadPrepareInfo, file = prepare.data?.fileInfo?.[0];
  if (!info || !file) throw new ApiError('酷安没有返回上传凭据', 'API_ERROR');
  const resultUrl = value => {
    if (dir !== 'message') return officialImageUrl(value);
    const url = new URL(value, 'https://image.coolapk.com');
    if (!['image.coolapk.com', 'message.coolapk.com'].includes(url.hostname) || url.username || url.password || url.port || !['http:', 'https:'].includes(url.protocol) || url.search || url.hash || !/^\/message\/[A-Za-z0-9_./@-]+$/.test(url.pathname) || url.pathname.split('/').includes('..')) throw new ApiError('私信图片路径无效', 'API_ERROR');
    return url.pathname;
  };
  if (file.url) return { data: resultUrl(file.url) };
  const key = file.uploadFileName;
  ossTarget(info.bucket, info.endPoint, key); credentials(info);
  const processes = prepareImageProcesses(info, key), callback = imageUploadCallback(info, processes.length > 0);
  const prefix = dir !== 'message' ? officialImageUrl(info.uploadImagePrefix || 'https://image.coolapk.com').replace(/\/$/, '') : 'https://image.coolapk.com';
  await signedRequest(client, info, key, { method: 'PUT', mime, body: bytes, extra: callback, guard, message: '图片上传' });
  await processUploadedImage(client, info, key, processes, guard);
  guard();
  return { data: resultUrl(`${prefix}/${key}`) };
}
