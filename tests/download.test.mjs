import test from 'node:test';
import assert from 'node:assert/strict';
import { APK_DOWNLOAD_HOSTS, apkDownloadUrl, buildApkDownloadUrl, dispatchDownload, openApkDownload, prepareApkDownload } from '../core/download.mjs';
import { createDeviceCode } from '../core/auth.mjs';

const pn = 'com.example.synthetic', plan = { packageName: pn, apkId: '101', versionCode: '30', title: '模拟应用', requestUrl: buildApkDownloadUrl(pn, '101', '30') };
function fixture(overrides = {}) { const calls = [], client = { cookie: 'synthetic-only=1', identity: { uid: '42' }, deviceCode: createDeviceCode('synthetic-download-fixture'), request: async (path, query, options) => { calls.push({ path, query, options }); if (path === '/v6/apk/detail') return { data: { id: '101', packageName: pn, appName: '模拟应用', versionCode: '30', apkversion: '3.0' } }; if (path === '/v6/apk/downloadVersionList') return { data: [{ id: 'old-version', versionCode: '20', apkversion: '2.0' }, { id: 'no-code', apkversion: '1.0' }], hasMore: false }; return { data: 'verified' }; }, ...overrides }; return { calls, client }; }

test('official download planning resolves numeric app identity and does not use the APK webpage URL', async () => {
  const { calls, client } = fixture(); const result = await prepareApkDownload(client, { packageName: pn });
  assert.equal(result.data.requestUrl, `https://api.coolapk.com/v6/apk/download?pn=${pn}&aid=101&vc=30&extra=`);
  assert.equal(result.data.versionName, '3.0'); assert.equal(result.data.historical, false); assert.deepEqual(calls[0], { path: '/v6/apk/detail', query: { id: pn, installed: 0 }, options: { method: 'POST', form: { extraAnalysisData: '' } } });
  const history = await dispatchDownload(client, 'apkDownloadVersions', { packageName: pn, page: 2 }); assert.deepEqual(calls.at(-1).query, { id: '101', page: 2 }); assert.equal(history.data[1].downloadVersionCode, ''); assert.equal(history.hasMore, false);
  await prepareApkDownload(client, { packageName: pn, versionCode: '20', versionPage: 2 }); assert.equal(calls.at(-1).query.page, 2);
  await assert.rejects(prepareApkDownload(client, { packageName: pn, versionCode: '99' }), e => e.code === 'UNSUPPORTED_VERSION');
  await assert.rejects(prepareApkDownload(client, { packageName: pn, url: 'https://evil.test/payload.apk' }), e => e.code === 'INPUT');
  assert.equal(await dispatchDownload(client, 'unknown'), undefined);
});

test('extraAnalysisData only supplies evidenced current version fields and mismatched app identities fail', async () => {
  const { client } = fixture({ request: async () => ({ data: { entityId: '101', extraAnalysisData: Buffer.from(JSON.stringify({ versionCode: 31, downloadUrl: 'https://evil.test/ignored.apk' })).toString('base64') + '~metadata' } }) });
  assert.equal((await prepareApkDownload(client, { packageName: pn })).data.versionCode, '31');
  client.request = async () => ({ data: { id: '101', versionCode: '30', packageName: 'com.other.app' } }); await assert.rejects(prepareApkDownload(client, { packageName: pn }), e => e.code === 'API_ERROR');
});

test('each redirect is allowlisted and API credentials never accompany a CDN request', async () => {
  const fetches = []; const { calls, client } = fixture({ fetch: async (url, options) => { fetches.push({ url: url.toString(), options }); if (fetches.length === 1) return new Response(null, { status: 302, headers: { location: 'https://download.coolapk.com/apps/synthetic.apk' } }); if (fetches.length === 2) return new Response(null, { status: 307, headers: { location: 'https://cdn.coolapk.com/apps/synthetic.apk?signature=synthetic' } }); return new Response(Uint8Array.from([80, 75, 3, 4, 0]), { headers: { 'content-type': 'application/vnd.android.package-archive', 'content-length': '5' } }); } });
  const opened = await openApkDownload(client, plan); assert.equal(opened.verified, true); assert.equal(fetches[0].options.method, 'POST'); assert.equal(fetches[0].options.redirect, 'manual'); assert.deepEqual(Object.fromEntries(new URLSearchParams(fetches[0].options.body)), { nd: '1', extraAnalysisData: '' }); assert.equal(fetches[0].options.headers.Cookie, 'synthetic-only=1'); assert.ok(fetches[0].options.headers['X-App-Token']);
  for (const { options } of fetches.slice(1)) { assert.equal(options.method, 'GET'); assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers['X-App-Token'], undefined); assert.equal(options.headers['X-App-Device'], undefined); assert.equal(options.headers.Range, 'bytes=0-'); assert.equal(options.headers['Accept-Encoding'], 'identity'); assert.equal(options.body, undefined); }
  assert.deepEqual(calls.at(-1), { path: '/v6/apk/downloadVerify', query: {}, options: { method: 'POST', form: { apkName: pn, requestUrl: plan.requestUrl, downloadUrl: 'https://cdn.coolapk.com/apps/synthetic.apk?signature=synthetic' } } }); await opened.response.body.cancel();
});

test('untrusted hosts, downgrade URLs, malformed ranges and HTML never become verified download streams', async () => {
  assert.deepEqual(APK_DOWNLOAD_HOSTS, ['api.coolapk.com', 'download.coolapk.com', 'cdn.coolapk.com', 'static.coolapk.com']);
  for (const url of ['https://cdn.coolapk.com.evil.test/app.apk', 'http://cdn.coolapk.com/app.apk', 'https://user:pass@cdn.coolapk.com/app.apk', 'https://cdn.coolapk.com:8443/app.apk', 'https://api.coolapk.com/v6/user/logout']) assert.throws(() => apkDownloadUrl(url));
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://evil.test/app.apk' } }), new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }), new Response(Uint8Array.from([80, 75, 3, 4]), { status: 206, headers: { 'content-range': 'bytes 100-103/104' } })]) {
    let count = 0; const { calls, client } = fixture({ fetch: async () => { count++; return response; } }); await assert.rejects(openApkDownload(client, plan)); assert.equal(count, 1); assert.equal(calls.length, 0);
  }
});

test('API redirects must retain one exact package/app/version triplet before receiving credentials', async () => {
  for (const suffix of [`pn=com.other.app&aid=101&vc=30`, `pn=${pn}&aid=102&vc=30`, `pn=${pn}&aid=101&vc=31`, `pn=${pn}&pn=com.other.app&aid=101&vc=30`]) {
    let count = 0; const { client } = fixture({ fetch: async () => { count++; return new Response(null, { status: 307, headers: { location: `https://api.coolapk.com/v6/apk/download?${suffix}` } }); } }); await assert.rejects(openApkDownload(client, plan), e => e.code === 'DOWNLOAD_IDENTITY'); assert.equal(count, 1);
  }
});

test('explicit empty anti-hijack verification, unavailable verification and account changes reject the body', async () => {
  for (const data of [null, '', ' ', false, 0]) { const { client } = fixture({ request: async () => ({ data }) }); await assert.rejects(dispatchDownload(client, 'apkDownloadVerify', { packageName: pn, requestUrl: plan.requestUrl, downloadUrl: 'https://download.coolapk.com/test.apk' }), e => e.code === 'DOWNLOAD_VERIFY_FAILED'); }
  const { client } = fixture({ fetch: async () => new Response(Uint8Array.from([80, 75, 3, 4])) }); client.request = async () => { throw Object.assign(new Error('Synthetic network unavailable'), { code: 'NETWORK' }); }; await assert.rejects(openApkDownload(client, plan), e => e.code === 'NETWORK');
  client.fetch = async () => { client.identity = { uid: '99' }; return new Response(Uint8Array.from([80, 75, 3, 4])); }; await assert.rejects(openApkDownload(client, plan), e => e.code === 'ACCOUNT_CHANGED');
  const abort = new AbortController(); abort.abort(Object.assign(new Error('Synthetic cancel'), { code: 'CANCELED' })); await assert.rejects(openApkDownload(client, plan, { signal: abort.signal }), e => e.code === 'CANCELED');
});
