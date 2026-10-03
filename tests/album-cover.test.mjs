import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError } from '../core/client.mjs';
import { uploadImage } from '../core/upload.mjs';

const uid = '42', cover = 'https://image.coolapk.com/album/synthetic.png';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const input = error => error instanceof ApiError && error.code === 'INPUT';
function fixture({ fileUrl, fetchImpl = async () => new Response('{}'), identity = { uid }, prepareOverride } = {}) {
  const requests = [], uploads = [];
  const client = {
    identity,
    request: async (...args) => {
      requests.push(args);
      return prepareOverride ?? { data: { uploadPrepareInfo: { bucket: 'synthetic-images', endPoint: 'oss-cn-shenzhen.aliyuncs.com', accessKeyId: 'synthetic-key', accessKeySecret: 'synthetic-secret', securityToken: 'synthetic-token', uploadImagePrefix: 'https://image.coolapk.com' }, fileInfo: [{ ...(fileUrl ? { url: fileUrl } : { uploadFileName: 'album/synthetic.png' }) }] } };
    },
    fetch: async (...args) => { uploads.push(args); return fetchImpl(...args); },
  };
  return { client, requests, uploads, run: args => uploadImage(client, { dir: 'album', bytes: png, width: 32, height: 24, ...args }) };
}

test('album cover preparation uses the confirmed album bucket, directory and current owner only', async () => {
  const { run, requests, uploads } = fixture({ fileUrl: cover });
  assert.deepEqual(await run({ toUid: '999' }), { data: cover });
  assert.equal(requests.length, 1); assert.equal(uploads.length, 0);
  const [path, query, options] = requests[0];
  assert.equal(path, '/v6/upload/ossUploadPrepare'); assert.deepEqual(query, {}); assert.equal(options.method, 'POST');
  const { uploadFileList, ...form } = options.form;
  assert.deepEqual(form, { uploadBucket: 'album', uploadDir: 'album', is_anonymous: 0, toUid: uid, feed_type: '' });
  const files = JSON.parse(uploadFileList); assert.equal(files.length, 1);
  assert.match(files[0].name, /^[0-9a-f-]{36}\.png$/);
  assert.deepEqual({ ...files[0], name: undefined }, { name: undefined, resolution: '32x24', md5: createHash('md5').update(png).digest('hex'), hdr: 0 });
});

test('album images use their detected MIME and signed bounded OSS upload before returning the cover URL', async () => {
  for (const [bytes, mime] of [[png, 'image/png'], [Buffer.from([255, 216, 255, 0]), 'image/jpeg'], [Buffer.from('GIF89a'), 'image/gif'], [Buffer.from('RIFF0000WEBP'), 'image/webp']]) {
    const { run, uploads } = fixture();
    assert.deepEqual(await run({ bytes }), { data: cover });
    assert.equal(uploads.length, 1);
    const [url, options] = uploads[0];
    assert.equal(url, 'https://synthetic-images.oss-cn-shenzhen.aliyuncs.com/album/synthetic.png');
    assert.equal(options.method, 'PUT'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers['Content-Type'], mime); assert.equal(options.headers['Content-MD5'], createHash('md5').update(bytes).digest('base64'));
    assert.deepEqual(options.body, bytes); assert.match(options.headers.Authorization, /^OSS synthetic-key:/);
    const callback = JSON.parse(Buffer.from(options.headers['x-oss-callback'], 'base64').toString());
    assert.equal(callback.callbackHost, 'api.coolapk.com'); assert.match(callback.callbackUrl, /^https:\/\/api\.coolapk\.com\/v6\/callback\/mobileOssUploadSuccessCallback\?/);
  }
});

test('album cover image boundaries reject empty, over-limit, unknown format and array-like data before prepare', async () => {
  const { run, requests } = fixture({ fileUrl: cover });
  for (const bytes of [new Uint8Array(), Buffer.alloc(20 * 1024 * 1024 + 1), Buffer.from('not an image'), { 0: 137, length: 9 }]) await assert.rejects(run({ bytes }), input);
  for (const dir of ['avatar', 'albums', '../album']) await assert.rejects(run({ dir }), input);
  assert.equal(requests.length, 0);
  const maximum = Buffer.alloc(20 * 1024 * 1024); png.copy(maximum);
  assert.equal((await run({ bytes: maximum })).data, cover); assert.equal(requests.length, 1);
});

test('guest album cover upload fails before any request or storage upload', async () => {
  const { run, requests, uploads } = fixture({ identity: null });
  await assert.rejects(run(), error => error.code === 'LOGIN_REQUIRED');
  assert.equal(requests.length, 0); assert.equal(uploads.length, 0);
});

test('album cover prepare must return official image addresses and usable storage evidence', async () => {
  for (const fileUrl of ['https://evil.test/album.png', 'data:image/png;base64,AAAA', 'https://user:pass@image.coolapk.com/album.png']) {
    const { run, uploads } = fixture({ fileUrl }); await assert.rejects(run(), input); assert.equal(uploads.length, 0);
  }
  const missing = fixture({ prepareOverride: { data: {} } }); await assert.rejects(missing.run(), error => error.code === 'API_ERROR'); assert.equal(missing.uploads.length, 0);
  const traversal = fixture({ prepareOverride: { data: { uploadPrepareInfo: { bucket: 'synthetic-images', endPoint: 'evil.test' }, fileInfo: [{ uploadFileName: '../album.png' }] } } });
  await assert.rejects(traversal.run(), error => error.code === 'API_ERROR'); assert.equal(traversal.uploads.length, 0);
});

test('album cover upload failures remain explicit and account changes are preserved', async () => {
  const network = fixture({ fetchImpl: async () => { throw new Error('synthetic storage detail'); } });
  await assert.rejects(network.run(), error => error.code === 'NETWORK' && !error.message.includes('synthetic storage detail'));
  const http = fixture({ fetchImpl: async () => new Response('', { status: 500 }) }); await assert.rejects(http.run(), error => error.code === 'HTTP');
  const changed = fixture({ fetchImpl: async () => { throw new ApiError('账号已切换', 'ACCOUNT_CHANGED'); } }); await assert.rejects(changed.run(), error => error.code === 'ACCOUNT_CHANGED');
});
