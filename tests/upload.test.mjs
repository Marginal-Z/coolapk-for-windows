import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { ApiError } from '../core/client.mjs';
import { uploadImage } from '../core/upload.mjs';
const image = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('synthetic-original-metadata')]);
const credentials = { bucket: 'synthetic-images', endPoint: 'oss-cn-shenzhen.aliyuncs.com', accessKeyId: 'synthetic-key', accessKeySecret: 'synthetic-secret', securityToken: 'synthetic-token', uploadImagePrefix: 'https://image.coolapk.com' };
function fixture({ info = {}, fetch, request } = {}) {
  const calls = [], prepares = [];
  const client = { identity: { uid: '42' }, cookie: 'synthetic-account-cookie', deviceCode: 'synthetic-device', request: async (...args) => { prepares.push(args); return request ? request(client, ...args) : { data: { uploadPrepareInfo: { ...credentials, ...info }, fileInfo: [{ uploadFileName: 'feed/synthetic.png' }] } }; }, fetch: async (url, init) => { calls.push({ url, init }); return fetch ? fetch(client, url, init, calls.length) : new Response(null, { status: 200 }); } };
  return { client, calls, prepares, run: () => uploadImage(client, { bytes: image, width: 32, height: 24 }) };
}
test('unprocessed images remain an original-byte PUT with hasProcess false', async () => {
  const box = fixture(); assert.equal((await box.run()).data, 'https://image.coolapk.com/feed/synthetic.png'); assert.equal(box.calls.length, 1);
  const { init } = box.calls[0]; assert.deepEqual(init.body, image);
  assert.deepEqual(JSON.parse(Buffer.from(init.headers['x-oss-callback-var'], 'base64').toString()), { 'x:var1': 'false' });
});
test('server image actions upload with hasProcess and persist each exact rule before signed HEAD verification', async () => {
  const process = { 'image/resize,w_100': '@small.png', 'image/watermark,text_Y29vbGFwaw': '@watermark.png' }, box = fixture({ info: { process } });
  assert.equal((await box.run()).data, 'https://image.coolapk.com/feed/synthetic.png');
  assert.deepEqual(box.calls.map(call => call.init.method), ['PUT', 'POST', 'HEAD', 'POST', 'HEAD']);
  assert.deepEqual(box.calls[0].init.body, image); assert.deepEqual(JSON.parse(Buffer.from(box.calls[0].init.headers['x-oss-callback-var'], 'base64').toString()), { 'x:var1': 'true' });
  for (const [i, [action, suffix]] of Object.entries(process).entries()) {
    const persisted = box.calls[1 + i * 2], head = box.calls[2 + i * 2];
    assert.equal(persisted.url, 'https://synthetic-images.oss-cn-shenzhen.aliyuncs.com/feed/synthetic.png?x-oss-process');
    assert.equal(persisted.init.body.toString(), `x-oss-process=${action}|sys/saveas,o_${Buffer.from('feed/synthetic.png' + suffix).toString('base64')},b_${Buffer.from(credentials.bucket).toString('base64')}`);
    assert.equal(head.url, 'https://synthetic-images.oss-cn-shenzhen.aliyuncs.com/feed/synthetic.png' + suffix); assert.equal(head.init.body, undefined);
  }
  for (const { url, init } of box.calls) {
    assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers['X-App-Token'], undefined); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.redirect, 'error');
    const target = new URL(url), canonicalHeaders = Object.keys(init.headers).filter(key => key.startsWith('x-oss-')).sort().map(key => `${key}:${init.headers[key]}\n`).join('');
    const canonical = `${init.method}\n${init.headers['Content-MD5'] || ''}\n${init.headers['Content-Type'] || ''}\n${init.headers.Date}\n${canonicalHeaders}/${credentials.bucket}${target.pathname}${target.search}`;
    assert.equal(init.headers.Authorization, `OSS ${credentials.accessKeyId}:${createHmac('sha1', credentials.accessKeySecret).update(canonical).digest('base64')}`);
    if (init.body) assert.equal(init.headers['Content-MD5'], createHash('md5').update(init.body).digest('base64'));
  }
});
test('native SDK action normalization accepts server rules without the image prefix and preserves Base64 padding', async () => {
  const box = fixture({ info: { process: { 'resize,w_100': '@a.png' } } }); await box.run();
  assert.match(box.calls[1].init.body.toString(), /^x-oss-process=image\/resize,w_100\|sys\/saveas,o_/);
  assert.equal(box.calls[1].init.headers['Content-Type'], 'image/png');
  assert.equal(box.calls[1].init.body.toString().includes(`o_${Buffer.from('feed/synthetic.png@a.png').toString('base64')},b_`), true);
});
test('native supplied callback URL is validated and retained without changing the process flag', async () => {
  const url = 'https://api.coolapk.com/v6/callback/mobileOssUploadSuccessCallback?checkArticleCoverResolution=1';
  const box = fixture({ info: { callbackUrl: url } }); await box.run();
  assert.equal(JSON.parse(Buffer.from(box.calls[0].init.headers['x-oss-callback'], 'base64').toString()).callbackUrl, url);
});
test('unsafe server processing paths, actions, callback hosts and credentials fail before storage upload', async () => {
  for (const info of [{ process: [] }, { process: 'not-map' }, { process: { 'image/resize,w_1': '/../../private' } }, { process: { 'image/resize,w_1|sys/saveas,o_YQ': '' } }, { process: { 'image/resize,w_1\n': '' } }, { process: { 'video/resize,w_1': '' } }, { callbackUrl: 'https://evil.test/callback' }, { securityToken: 'bad\nvalue' }, { endPoint: null }, { endPoint: {} }, { endPoint: 'https://oss-cn-shenzhen.aliyuncs.com?redirect=evil' }]) {
    const box = fixture({ info }); await assert.rejects(box.run(), error => error.code === 'API_ERROR'); assert.equal(box.calls.length, 0);
  }
});
test('processing or HEAD failures stay failures and explicit retry completes the same server actions', async () => {
  for (const method of ['POST', 'HEAD']) {
    let fail = true; const box = fixture({ info: { process: { 'image/resize,w_100': '@small.png' } }, fetch: async (client, url, init) => { if (fail && init.method === method) { fail = false; return new Response(null, { status: 500 }); } return new Response(null); } });
    await assert.rejects(box.run(), error => error.code === 'HTTP');
    assert.equal((await box.run()).data, 'https://image.coolapk.com/feed/synthetic.png');
    assert.equal(box.calls.filter(call => call.init.method === 'POST').at(-1).init.body.toString().includes('image/resize,w_100'), true);
  }
});
test('account changes during prepare, original upload or processing stop all subsequent storage requests', async () => {
  const prepared = fixture({ request: async client => { client.identity = { uid: '43' }; return { data: {} }; } });
  await assert.rejects(prepared.run(), error => error.code === 'ACCOUNT_CHANGED'); assert.equal(prepared.calls.length, 0);
  for (const at of [1, 2, 3]) {
    const box = fixture({ info: { process: { 'image/resize,w_100': '@small.png' } }, fetch: async (client, url, init, index) => { if (index === at) client.cookie = 'synthetic-other-account'; return new Response(null); } });
    await assert.rejects(box.run(), error => error.code === 'ACCOUNT_CHANGED'); assert.equal(box.calls.length, at);
  }
});
test('processing network failures never expose credential details or return a premature URL', async () => {
  const box = fixture({ info: { process: { 'image/resize,w_100': '@small.png' } }, fetch: async (client, url, init) => { if (init.method === 'POST') throw new Error('synthetic-secret'); return new Response(null); } });
  await assert.rejects(box.run(), error => error instanceof ApiError && error.code === 'NETWORK' && !error.message.includes('synthetic-secret'));
  assert.deepEqual(box.calls.map(call => call.init.method), ['PUT', 'POST']);
});
