const VIDEO_HOST = 'weibocdn.com';
const MAX_REDIRECTS = 3;
const FORWARDED_HEADERS = ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified'];

function parsedWeiboVideo(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !(host === VIDEO_HOST || host.endsWith('.' + VIDEO_HOST))) return null;
  url.hash = '';
  return url;
}

export function isWeiboVideoUrl(value) { return Boolean(parsedWeiboVideo(value)); }

export function weiboVideoSource(value) {
  const target = parsedWeiboVideo(value);
  return target ? `coolapk-video://weibo/?url=${encodeURIComponent(target.href)}` : typeof value === 'string' ? value : '';
}

function failure(status) {
  return new Response('', { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function validRange(value) { return value.length <= 80 && /^bytes=(?:\d+-\d*|-\d+)$/i.test(value.trim()); }

export async function proxyWeiboVideoRequest(request, { fetchImpl = globalThis.fetch, trustedOrigins = [] } = {}) {
  if (!trustedOrigins.includes(request.initiatorOrigin)) return failure(403);
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405);

  let proxyUrl;
  try { proxyUrl = new URL(request.url); } catch { return failure(400); }
  if (proxyUrl.protocol !== 'coolapk-video:' || proxyUrl.hostname !== 'weibo' || proxyUrl.pathname !== '/') return failure(400);
  let target = parsedWeiboVideo(proxyUrl.searchParams.get('url'));
  if (!target) return failure(400);

  const range = request.headers?.get?.('range') || '';
  if (range && !validRange(range)) return failure(416);
  if (typeof fetchImpl !== 'function') return failure(502);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const headers = new Headers({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        Referer: 'https://weibo.com/',
      });
      if (range) headers.set('Range', range);
      const response = await fetchImpl(target.href, { method: request.method, headers, redirect: 'manual', signal: request.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location || redirectCount === MAX_REDIRECTS) return failure(502);
        target = parsedWeiboVideo(new URL(location, target).href);
        if (!target) return failure(502);
        continue;
      }
      if (![200, 206, 403, 404, 416, 429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        return failure(502);
      }
      const outputHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for (const name of FORWARDED_HEADERS) {
        const value = response.headers.get(name);
        if (value && !/[\r\n\0]/.test(value)) outputHeaders.set(name, value);
      }
      if (!outputHeaders.has('content-type')) outputHeaders.set('content-type', 'video/mp4');
      const body = [200, 206].includes(response.status) && request.method !== 'HEAD' ? response.body : null;
      if (!body) await response.body?.cancel().catch(() => {});
      return new Response(body, { status: response.status, headers: outputHeaders });
    }
  } catch {
    return failure(502);
  }
  return failure(502);
}

export function registerWeiboVideoProxy(protocol, options) {
  protocol.handle('coolapk-video', request => proxyWeiboVideoRequest(request, options));
}
