import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ApiError, assertLogin, numericId } from './client.mjs';

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
  if (!/^[a-z0-9-]{3,63}$/.test(bucket) || !/^[A-Za-z0-9_./@-]{1,2048}$/.test(key) || key.split('/').includes('..')) throw new ApiError('上传路径无效', 'API_ERROR');
  const host = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`);
  if (!host.hostname.endsWith('.aliyuncs.com') || host.port || host.username || host.password || !['/', ''].includes(host.pathname)) throw new ApiError('上传服务器地址无效', 'API_ERROR');
  return `https://${bucket}.${host.hostname}/${key}`;
}
export async function uploadImage(client, args) {
  assertLogin(client.identity);
  const dir = args.dir || 'feed';
  if (!['feed', 'message', 'cover'].includes(dir)) throw new ApiError('上传类型无效', 'INPUT');
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
  const url = ossTarget(info.bucket, info.endPoint, key);
  if (![info.accessKeyId, info.accessKeySecret, info.securityToken].every(v => typeof v === 'string' && v.length > 0 && v.length < 8192)) throw new ApiError('上传凭据不完整', 'API_ERROR');
  const prefix = dir !== 'message' ? officialImageUrl(info.uploadImagePrefix || 'https://image.coolapk.com').replace(/\/$/, '') : 'https://image.coolapk.com';
  const md5 = createHash('md5').update(bytes).digest('base64');
  const date = new Date().toUTCString();
  const callback = Buffer.from(JSON.stringify({ callbackBodyType: 'application/json', callbackHost: 'api.coolapk.com', callbackUrl: 'https://api.coolapk.com/v6/callback/mobileOssUploadSuccessCallback?checkArticleCoverResolution=0&versionCode=2609291', callbackBody: '{"bucket":${bucket},"object":${object},"hasProcess":${x:var1}}' })).toString('base64');
  const callbackVar = Buffer.from('{"x:var1":"false"}').toString('base64');
  const signature = createHmac('sha1', info.accessKeySecret).update(`PUT\n${md5}\n${mime}\n${date}\nx-oss-callback:${callback}\nx-oss-callback-var:${callbackVar}\nx-oss-security-token:${info.securityToken}\n/${info.bucket}/${key}`).digest('base64');
  let response;
  try { response = await client.fetch(url, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(90000), headers: { Authorization: `OSS ${info.accessKeyId}:${signature}`, 'Content-MD5': md5, 'Content-Type': mime, Date: date, 'x-oss-callback': callback, 'x-oss-callback-var': callbackVar, 'x-oss-security-token': info.securityToken }, body: bytes }); }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError('图片上传失败，请检查网络后重试', 'NETWORK'); }
  if (!response.ok) throw new ApiError(`图片上传返回 HTTP ${response.status}`, 'HTTP');
  return { data: resultUrl(`${prefix}/${key}`) };
}
