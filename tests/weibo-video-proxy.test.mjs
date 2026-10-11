import test from 'node:test';
import assert from 'node:assert/strict';
import { isWeiboVideoUrl, proxyWeiboVideoRequest, registerWeiboVideoProxy, weiboVideoSource } from '../core/weibo-video.mjs';

const origin = 'coolapk-video://weibo/?url=' + encodeURIComponent('https://f.video.weibocdn.com/path/video.mp4?token=sample');
const trustedOrigins = ['file://', 'http://127.0.0.1:5173'];
function request({ url = origin, method = 'GET', range, initiatorOrigin = 'file://' } = {}) {
  return { url, method, headers: new Headers(range ? { Range: range } : {}), initiatorOrigin, signal: undefined };
}

test('only official HTTPS Weibo CDN video URLs are rewritten for playback', () => {
  assert.equal(isWeiboVideoUrl('https://weibocdn.com/a.mp4'), true);
  assert.equal(isWeiboVideoUrl('https://f.video.weibocdn.com/a.mp4'), true);
  assert.equal(isWeiboVideoUrl('http://f.video.weibocdn.com/a.mp4'), false);
  assert.equal(isWeiboVideoUrl('https://weibocdn.com.evil.example/a.mp4'), false);
  assert.equal(isWeiboVideoUrl('https://user@weibocdn.com/a.mp4'), false);
  assert.equal(isWeiboVideoUrl('https://weibocdn.com:444/a.mp4'), false);
  const proxied = new URL(weiboVideoSource('https://f.video.weibocdn.com/a.mp4?token=sample#poster'));
  assert.equal(proxied.protocol, 'coolapk-video:');
  assert.equal(proxied.hostname, 'weibo');
  assert.equal(proxied.searchParams.get('url'), 'https://f.video.weibocdn.com/a.mp4?token=sample');
  assert.equal(weiboVideoSource('https://media.coolapk.com/a.mp4'), 'https://media.coolapk.com/a.mp4');
});

test('protocol rejects untrusted initiators, other methods, malformed targets, and injected/multiple ranges before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(new Uint8Array([1])); };
  assert.equal((await proxyWeiboVideoRequest(request({ initiatorOrigin: 'https://evil.example' }), { fetchImpl, trustedOrigins })).status, 403);
  assert.equal((await proxyWeiboVideoRequest(request({ method: 'POST' }), { fetchImpl, trustedOrigins })).status, 405);
  assert.equal((await proxyWeiboVideoRequest(request({ url: 'coolapk-video://other/?url=' + encodeURIComponent('https://f.video.weibocdn.com/a.mp4') }), { fetchImpl, trustedOrigins })).status, 400);
  assert.equal((await proxyWeiboVideoRequest(request({ url: 'coolapk-video://weibo/?url=' + encodeURIComponent('https://weibocdn.com.evil.example/a.mp4') }), { fetchImpl, trustedOrigins })).status, 400);
  assert.equal((await proxyWeiboVideoRequest(request({ range: 'bytes=0-10,20-30' }), { fetchImpl, trustedOrigins })).status, 416);
  const injectedRange = request(); injectedRange.headers = { get: () => 'bytes=0-10\r\nCookie: x' };
  assert.equal((await proxyWeiboVideoRequest(injectedRange, { fetchImpl, trustedOrigins })).status, 416);
  assert.equal(calls, 0);
});

test('valid byte ranges stream and preserve video response headers without Coolapk credentials', async () => {
  let sent;
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const response = await proxyWeiboVideoRequest(request({ range: 'bytes=0-3' }), {
    trustedOrigins,
    fetchImpl: async (url, init) => {
      sent = { url, init };
      return new Response(bytes, { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 0-3/100', 'accept-ranges': 'bytes', 'set-cookie': 'must-not-forward=1' } });
    },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
  assert.equal(sent.url, 'https://f.video.weibocdn.com/path/video.mp4?token=sample');
  assert.equal(sent.init.method, 'GET');
  assert.equal(sent.init.redirect, 'manual');
  assert.equal(sent.init.headers.get('range'), 'bytes=0-3');
  assert.equal(sent.init.headers.get('referer'), 'https://weibo.com/');
  assert.equal(sent.init.headers.has('cookie'), false);
  assert.equal(sent.init.headers.has('x-app-id'), false);
});

test('redirects are limited to the Weibo HTTPS CDN allowlist and keep the requested range', async () => {
  const seen = [];
  const response = await proxyWeiboVideoRequest(request({ range: 'bytes=-500' }), {
    trustedOrigins,
    fetchImpl: async (url, init) => {
      seen.push({ url, range: init.headers.get('range') });
      if (seen.length === 1) return new Response(null, { status: 302, headers: { location: 'https://us.video.weibocdn.com/final.mp4' } });
      return new Response(new Uint8Array([8]), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(item => item.range), ['bytes=-500', 'bytes=-500']);

  let calls = 0;
  const denied = await proxyWeiboVideoRequest(request(), { trustedOrigins, fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.example/redirect.mp4' } }); } });
  assert.equal(denied.status, 502);
  assert.equal(calls, 1);
});

test('upstream errors do not leak arbitrary response bodies and the custom streaming protocol is registered', async () => {
  const denied = await proxyWeiboVideoRequest(request(), { trustedOrigins, fetchImpl: async () => new Response('upstream-private-body', { status: 404 }) });
  assert.equal(denied.status, 404);
  assert.equal(await denied.text(), '');
  let registration;
  registerWeiboVideoProxy({ handle: (scheme, handler) => { registration = { scheme, handler }; } }, { trustedOrigins, fetchImpl: async () => new Response(new Uint8Array([4]), { headers: { 'content-type': 'video/mp4' } }) });
  assert.equal(registration.scheme, 'coolapk-video');
  assert.equal((await registration.handler(request())).status, 200);
});
