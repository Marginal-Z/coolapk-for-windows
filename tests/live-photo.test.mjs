import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createDeviceCode } from '../core/auth.mjs';
import { dispatchLivePhoto, LIVE_PHOTO_OPERATIONS, livePhotoUrl, liveVideoFormat } from '../core/live-photo.mjs';

const box = (name, payload) => { const buffer = Buffer.alloc(8 + payload.length); buffer.writeUInt32BE(buffer.length); buffer.write(name, 4); payload.copy(buffer, 8); return buffer; };
const movie = (brand = 'isom') => Buffer.concat([box('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from('isom')])), box('moov', Buffer.from('test track')), box('mdat', Buffer.from('synthetic video'))]);
const image = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const args = () => ({ bytes: image, videoBytes: movie(), width: 32, height: 24 });
const credentials = { bucket: 'coolapk', endPoint: 'oss-cn-shanghai.aliyuncs.com', accessKeyId: 'synthetic-id', accessKeySecret: 'synthetic-secret', securityToken: 'synthetic-session', uploadImagePrefix: 'http://image.coolapk.com' };
function client(overrides = {}) {
  const state = { prepare: [], puts: [], uid: '123456' };
  const instance = { identity: { uid: '123456' }, cookie: 'uid=123456; synthetic=yes; ddid=remove', deviceCode: createDeviceCode('synthetic-device'), request: async (endpoint, query, options) => { state.prepare.push({ endpoint, query, options }); const files = JSON.parse(options.form.uploadFileList); return { data: { uploadPrepareInfo: { ...credentials }, fileInfo: files.map((file, i) => ({ name: file.name, uploadFileName: `feed/2026/${i ? 'video.mp4' : 'cover.live.png'}` })) } }; }, fetch: async (url, options) => { state.puts.push({ url: String(url), options }); return new Response('success'); }, ...overrides };
  return { instance, state };
}

test('paired live upload prepares exact relationship and puts video before callback image', async () => {
  const { instance, state } = client(); const result = await dispatchLivePhoto(instance, 'uploadLivePhoto', args());
  assert.equal(state.prepare.length, 1); const prepared = state.prepare[0], files = JSON.parse(prepared.options.form.uploadFileList);
  assert.equal(prepared.endpoint, '/v6/upload/ossUploadPrepare'); assert.equal(prepared.options.method, 'POST');
  assert.deepEqual(Object.fromEntries(Object.entries(prepared.options.form).filter(([key]) => key !== 'uploadFileList')), { uploadBucket: 'image', uploadDir: 'feed', is_anonymous: 0, toUid: '123456', feed_type: 'feed' });
  assert.equal(files[0].livePhoto, 1); assert.equal(files[0].livePhotoVideo, files[1].name); assert.equal(files[0].resolution, '32x24'); assert.equal(files[1].md5, createHash('md5').update(movie()).digest('hex'));
  assert.equal(state.puts.length, 2); assert.equal(state.puts[0].options.headers['Content-Type'], 'video/mp4'); assert.equal(state.puts[1].options.headers['Content-Type'], 'image/png');
  assert.equal(state.puts[0].options.headers['x-oss-callback'], undefined); assert.ok(state.puts[1].options.headers['x-oss-callback']);
  for (const { url, options } of state.puts) {
    const header = options.headers, canonicalHeaders = Object.keys(header).filter(key => key.startsWith('x-oss-')).sort().map(key => `${key}:${header[key]}\n`).join('');
    const canonical = `PUT\n${header['Content-MD5']}\n${header['Content-Type']}\n${header.Date}\n${canonicalHeaders}/coolapk${new URL(url).pathname}`;
    const expected = createHmac('sha1', credentials.accessKeySecret).update(canonical).digest('base64');
    assert.equal(header.Authorization, `OSS synthetic-id:${expected}`); assert.equal(options.redirect, 'error'); assert.equal(header.Cookie, undefined); assert.equal(header['X-App-Token'], undefined);
  }
  assert.deepEqual(result, { data: 'https://image.coolapk.com/feed/2026/cover.live.png', livePhoto: true });
});
test('MOV uses quicktime mime and matching md5 filename extension', async () => {
  const { instance, state } = client(); await dispatchLivePhoto(instance, 'uploadLivePhoto', { ...args(), videoBytes: movie('qt  ') });
  assert.match(JSON.parse(state.prepare[0].options.form.uploadFileList)[1].name, /\.mov$/); assert.equal(state.puts[0].options.headers['Content-Type'], 'video/quicktime');
});
test('guest, malformed image/video, over-limit dimensions and private upload reject before any network', async () => {
  for (const extra of [{ videoBytes: Buffer.from('not a video') }, { videoBytes: Buffer.alloc(65 * 1024 ** 2) }, { bytes: Buffer.from('bad image') }, { width: 0 }, { height: 30001 }, { hdr: 2 }, { dir: 'message' }]) {
    const { instance, state } = client(); await assert.rejects(dispatchLivePhoto(instance, 'uploadLivePhoto', { ...args(), ...extra }), error => error.code === 'INPUT'); assert.equal(state.prepare.length + state.puts.length, 0);
  }
  const { instance, state } = client({ identity: null }); await assert.rejects(dispatchLivePhoto(instance, 'uploadLivePhoto', args()), error => error.code === 'LOGIN_REQUIRED'); assert.equal(state.prepare.length, 0);
  assert.throws(() => liveVideoFormat(box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(12)]))));
});
test('missing live metadata, untrusted OSS target, failed video and existing static cover never become success', async () => {
  for (const variant of ['missing_video', 'bad_endpoint', 'bad_key', 'video_failure', 'existing_cover_video_failure']) {
    const { instance, state } = client(); const base = instance.request;
    instance.request = async (...parameters) => { const result = await base(...parameters); if (variant === 'missing_video') result.data.fileInfo.pop(); if (variant === 'bad_endpoint') result.data.uploadPrepareInfo.endPoint = 'oss-cn-shanghai.aliyuncs.com.evil.test'; if (variant === 'bad_key') result.data.fileInfo[1].uploadFileName = '../video.mp4'; if (variant === 'existing_cover_video_failure') result.data.fileInfo[0].url = 'https://image.coolapk.com/old.png'; return result; };
    if (variant.includes('failure')) instance.fetch = async (...parameters) => { state.puts.push(parameters); return new Response('fail', { status: 403 }); };
    await assert.rejects(dispatchLivePhoto(instance, 'uploadLivePhoto', args())); assert.ok(state.puts.length <= 1);
  }
});
test('server deduplication skips only files with validated paired URLs', async () => {
  const { instance, state } = client(); const base = instance.request;
  instance.request = async (...parameters) => { const result = await base(...parameters); result.data.fileInfo[0].url = 'http://image.coolapk.com/a.live.png'; result.data.fileInfo[1].url = 'https://video.coolapk.com/a.mp4'; return result; };
  assert.deepEqual(await dispatchLivePhoto(instance, 'uploadLivePhoto', args()), { data: 'https://image.coolapk.com/a.live.png', livePhoto: true }); assert.equal(state.puts.length, 0);
});
test('account switch after prepare or video put stops subsequent upload and URL return', async () => {
  for (const point of ['prepare', 'video']) {
    const { instance, state } = client(), base = instance.request, fetch = instance.fetch;
    if (point === 'prepare') instance.request = async (...parameters) => { const result = await base(...parameters); instance.identity = { uid: '654321' }; return result; };
    else instance.fetch = async (...parameters) => { const result = await fetch(...parameters); instance.cookie = 'uid=654321'; return result; };
    await assert.rejects(dispatchLivePhoto(instance, 'uploadLivePhoto', args()), error => error.code === 'ACCOUNT_CHANGED'); assert.equal(state.puts.length, point === 'video' ? 1 : 0);
  }
  const { instance } = client({ fetch: async () => { const error = new Error('changed'); error.code = 'ACCOUNT_CHANGED'; throw error; } });
  await assert.rejects(dispatchLivePhoto(instance, 'uploadLivePhoto', args()), error => error.code === 'ACCOUNT_CHANGED');
});
test('public resolver restores original HTTP pic form, names content and never follows authenticated redirect', async () => {
  const calls = [], { instance } = client({ fetch: async (url, options) => { calls.push({ url: new URL(url), options }); return new Response('', { status: 302, headers: { Location: 'http://video.coolapk.com/live/test.mp4' } }); } });
  const result = await dispatchLivePhoto(instance, 'livePhotoVideo', { picUrl: 'https://image.coolapk.com/feed/a.live.jpg?x=1', id: '98', contentType: 'reply' });
  assert.deepEqual(result, { data: { url: 'https://video.coolapk.com/live/test.mp4' } }); assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/v6/livePhoto/showVideo'); assert.equal(calls[0].url.searchParams.get('id'), 'reply_98'); assert.equal(calls[0].url.searchParams.get('picUrl'), 'http://image.coolapk.com/feed/a.live.jpg?x=1');
  assert.equal(calls[0].options.redirect, 'manual'); assert.ok(!calls[0].options.headers.Cookie.includes('ddid='));
});
test('resolver accepts bounded official JSON and rejects offsite/credentials/errors/large response', async () => {
  for (const value of ['https://evil.test/a.mp4', 'file:///a.mp4', 'https://name:secret@video.coolapk.com/a.mp4', 'https://video.coolapk.com:444/a.mp4']) assert.throws(() => livePhotoUrl(value));
  const parameters = { picUrl: 'https://image.coolapk.com/a.live.jpg', id: '98', contentType: 'article' };
  const { instance } = client({ fetch: async () => new Response(JSON.stringify({ data: { videoUrl: 'https://image.coolapk.com/a.mp4' } })) });
  assert.deepEqual(await dispatchLivePhoto(instance, 'livePhotoVideo', parameters), { data: { url: 'https://image.coolapk.com/a.mp4' } });
  for (const body of [{ data: { url: 'https://evil.test/a.mp4' } }, { status: -1, data: { url: 'https://image.coolapk.com/a.mp4' } }, {}]) {
    instance.fetch = async () => new Response(JSON.stringify(body)); await assert.rejects(dispatchLivePhoto(instance, 'livePhotoVideo', parameters));
  }
  instance.fetch = async () => new Response('', { status: 302, headers: { Location: 'https://evil.test/a.mp4' } }); await assert.rejects(dispatchLivePhoto(instance, 'livePhotoVideo', parameters));
  instance.fetch = async () => new Response('x'.repeat(70000)); await assert.rejects(dispatchLivePhoto(instance, 'livePhotoVideo', parameters));
  assert.equal(await dispatchLivePhoto(instance, 'unrelated', {}), undefined); assert.deepEqual(LIVE_PHOTO_OPERATIONS, ['livePhotoVideo', 'uploadLivePhoto']);
});
