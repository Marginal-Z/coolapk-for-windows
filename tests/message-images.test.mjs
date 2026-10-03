import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { fetchMessageImage } from '../core/images.mjs';
import { uploadImage } from '../core/upload.mjs';
const identity = { uid: '123456' };
const success = data => new Response(JSON.stringify({ data }));
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

test('private images use only fixed message endpoint with account headers', async () => {
  const client = new CoolapkClient({ identity, cookie: 'token=synthetic', fetchImpl: async (url, init) => {
    assert.equal(url.origin, 'https://api.coolapk.com'); assert.equal(url.pathname, '/v6/message/showImage');
    assert.equal(url.searchParams.get('id'), '999'); assert.equal(init.headers.Cookie, 'token=synthetic');
    assert.ok(init.headers['X-App-Token']); assert.equal(init.redirect, 'error');
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  } });
  assert.match((await fetchMessageImage(client, '999')).data, /^data:image\/png;base64,/);
  await assert.rejects(fetchMessageImage(client, 'https://evil.test'), { code: 'INPUT' });
  await assert.rejects(fetchMessageImage(new CoolapkClient(), '999'), { code: 'LOGIN_REQUIRED' });
});
test('private image proxy rejects HTML, redirects and oversized payloads', async () => {
  for (const response of [new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), new Response('', { status: 302 }), new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(13 * 1024 * 1024) } })]) {
    await assert.rejects(fetchMessageImage(new CoolapkClient({ identity, fetchImpl: async () => response }), '999'));
  }
});
test('message upload prepares recipient bucket and returns relative path without leaking account headers to OSS', async () => {
  const requests = [];
  const client = new CoolapkClient({ identity, cookie: 'token=synthetic', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) return success({ fileInfo: [{ uploadFileName: 'message/test.png' }], uploadPrepareInfo: { bucket: 'coolapk', endPoint: 'oss-cn-shenzhen.aliyuncs.com', accessKeyId: 'synthetic-key', accessKeySecret: 'synthetic-secret', securityToken: 'synthetic-token' } });
    return new Response('', { status: 200 });
  } });
  const result = await uploadImage(client, { bytes: png, width: 1, height: 1, dir: 'message', toUid: '987' });
  assert.equal(result.data, '/message/test.png');
  assert.equal(requests[0].init.body.get('uploadBucket'), 'message'); assert.equal(requests[0].init.body.get('toUid'), '987');
  assert.equal(requests[1].init.headers.Cookie, undefined); assert.equal(requests[1].init.headers['X-App-Token'], undefined);
  await assert.rejects(uploadImage(client, { bytes: png, dir: 'message', toUid: 'invalid' }), { code: 'INPUT' });
  assert.equal(requests.length, 2);
});
