import { ApiError, assertLogin, numericId, sanitizeCookie } from './client.mjs';
import { imageUserAgent, requestHeaders } from './auth.mjs';
export function imageSource(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !['avatar.coolapk.com', 'image.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com'].includes(url.hostname)) throw new ApiError('不支持的图片来源', 'INPUT');
  url.protocol = 'https:'; return url;
}
export async function fetchImage(value, fetchImpl = fetch) {
  const url = imageSource(value);
  const response = await fetchImpl(url, { headers: { 'User-Agent': imageUserAgent() }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  return readImage(response);
}
async function readImage(response) {
  const type = response.headers.get('content-type') || '';
  const limit = 12 * 1024 * 1024;
  if (!response.ok || !/^image\/(jpg|jpeg|png|gif|webp|avif|x-icon|vnd.microsoft.icon)(;|$)/i.test(type)) throw new Error('图片暂不可用');
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new Error('图片超过加载限制');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { while (true) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.length; if (size > limit) { await reader.cancel(); throw new Error('图片超过加载限制'); } chunks.push(chunk); } }
  finally { reader.releaseLock(); }
  return { body: Buffer.concat(chunks), type };
}
// Private message images never enter the public CDN proxy or its shared cache.
export async function fetchMessageImage(client, id) {
  assertLogin(client.identity);
  const url = new URL('/v6/message/showImage', 'https://api.coolapk.com');
  url.searchParams.set('id', numericId(id)); url.searchParams.set('type', 'n');
  const headers = { ...requestHeaders(client.deviceCode), Accept: 'image/*' };
  if (client.cookie) headers.Cookie = sanitizeCookie(client.cookie);
  let response;
  try { response = await client.fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new ApiError('私信图片加载失败，请检查网络后重试', 'NETWORK'); }
  if (response.status === 401 || response.status === 403) throw new ApiError('私信图片需要有效登录或官方验证', response.status === 401 ? 'LOGIN_REQUIRED' : 'VERIFY_REQUIRED');
  const { body, type } = await readImage(response);
  const mime = type.split(';')[0].toLowerCase().replace('image/jpg', 'image/jpeg');
  return { data: `data:${mime};base64,${body.toString('base64')}` };
}
