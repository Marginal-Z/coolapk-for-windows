import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceCode, createToken, tokenAt, requestHeaders, APK_PROFILE } from '../core/auth.mjs';
import { CoolapkClient, internalPageRoute, flattenEntities, sanitizeCookie } from '../core/client.mjs';
import { ossTarget, officialImageUrl, uploadImage } from '../core/upload.mjs';
import { AccountStore } from '../core/account-store.mjs';
import { fetchImage, imageSource } from '../core/images.mjs';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const success = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const identity = { uid: '123456', username: '测试酷友' };
test('favorites and view-index ranks use independent evidenced fields, not the default likes rank', async () => {
  const requests = [], client = new CoolapkClient({ fetchImpl: async url => { requests.push(new URL(url)); return success([]); } });
  for (const [type, field] of [['favorite', 'favnum'], ['index', 'detailnum']]) { await client.dispatch('rank', { type }); assert.equal(requests.at(-1).searchParams.get('url'), `#/feed/statList?statType=7days&sortField=${field}`); }
  const count = requests.length; await assert.rejects(client.dispatch('rank', { type: 'unknown' }), e => e.code === 'INPUT'); assert.equal(requests.length, count);
});
test('hot discussion is the dedicated hotReplyList, validates the feed ID and keeps API failures visible', async () => {
  let request; const client = new CoolapkClient({ fetchImpl: async url => { request = new URL(url); return success([{ id: '9', entityType: 'feedReply' }]); } });
  const result = await client.dispatch('hotReplies', { id: '101', page: 2, lastItem: 'ignored' }); assert.equal(result.data[0].id, '9'); assert.equal(request.pathname, '/v6/feed/hotReplyList'); assert.deepEqual(Object.fromEntries(request.searchParams), { id: '101', page: '2', discussMode: '1' });
  await assert.rejects(client.dispatch('hotReplies', { id: 'not-numeric' }), e => e.code === 'INPUT');
  const broken = new CoolapkClient({ fetchImpl: async () => success({ unknown: [] }) }); await assert.rejects(broken.dispatch('hotReplies', { id: '101' }), e => e.code === 'API_ERROR');
});

test('APK token binds time, app code and device without using phone identity', () => {
  const device = createDeviceCode('synthetic-device');
  const token = tokenAt(device, 1791000000);
  assert.equal(token, tokenAt(device, 1791000000));
  assert.notEqual(token, createToken(createDeviceCode('other-device'), APK_PROFILE, 1791000000));
  assert.notEqual(token, createToken(device, APK_PROFILE, 1791000001));
  assert.notEqual(token, createToken(device, { ...APK_PROFILE, code: 2604201 }, 1791000000));
  assert.match(Buffer.from(token.slice(2), 'base64').toString(), /^\$2y\$04\$/);
  assert.equal(requestHeaders(device)['X-App-Code'], '2609291');
});
test('server-driven pages accept known read routes and reject redirects / writes', () => {
  assert.equal(internalPageRoute('/page?url=V11_HOME_TAB_NEWS').query.url, 'V11_HOME_TAB_NEWS');
  assert.equal(internalPageRoute('/main/headline').endpoint, '/v6/main/headline');
  assert.equal(internalPageRoute('/product/categoryList').endpoint, '/v6/product/categoryList');
  assert.deepEqual(internalPageRoute('/dyh/list?type=editor&title=%E5%B0%8F%E7%BC%96%E6%8E%A8%E8%8D%90'), { endpoint: '/v6/dyh/list', query: { type: 'editor', title: '小编推荐' } });
  for (const url of ['https://evil.test/main/headline', '//evil.test/page', '/feed/like?id=1', '/account/logout', 'javascript:alert(1)', '#/feed/deleteFeed?id=1', '/page?url=%2Ffeed%2Flike%3Fid%3D1', '/page?url=https%3A%2F%2Fevil.test%2Fmain%2Fheadline']) assert.throws(() => internalPageRoute(url));
});
test('Kankan more list preserves server filters and pagination without allowing dyh write paths', async () => {
  let request; const client = new CoolapkClient({ fetchImpl: async (url, init) => { request = { url, init }; return success([]); } });
  await client.dispatch('page', { url: '/dyh/list?type=editor&title=%E5%B0%8F%E7%BC%96%E6%8E%A8%E8%8D%90', page: 2, lastItem: '91' });
  assert.equal(request.url.pathname, '/v6/dyh/list'); assert.equal(request.url.searchParams.get('type'), 'editor'); assert.equal(request.url.searchParams.get('lastItem'), '91'); assert.equal(request.init.method, 'GET');
  for (const url of ['/dyh/follow?id=91', '#/dyh/unFollow?id=91', '/dyh/delete?id=91']) assert.throws(() => internalPageRoute(url));
});
test('nested entities retain content and omit advertisements', () => {
  const result = flattenEntities([{ entityType: 'card', entities: [{ entityType: 'feed', id: 1 }, { entityType: 'card', entities: [{ entityType: 'topic', id: 2 }] }] }, { entityType: 'ad', id: 3 }]);
  assert.deepEqual(result.map(x => x.id), [1, 2]);
});
test('a network failure stays a failure instead of a successful empty feed', async () => {
  const client = new CoolapkClient({ fetchImpl: async () => { throw new Error('secret network internals'); } });
  await assert.rejects(client.dispatch('home'), e => e.code === 'NETWORK' && !e.message.includes('secret'));
});
test('malformed public lists cannot masquerade as an empty successful page', async () => {
  for (const operation of ['home', 'search', 'replies']) {
    const client = new CoolapkClient({ fetchImpl: async () => success({ unknown: [] }) });
    await assert.rejects(client.dispatch(operation, { id: '1', query: '测试' }), { code: 'API_ERROR' });
  }
});
test('question, topic, dyh and album search preserve official search types', async () => {
  const calls = []; const client = new CoolapkClient({ fetchImpl: async url => { calls.push(url); return success([]); } });
  for (const type of ['question', 'answer', 'topic', 'dyh', 'album']) await client.dispatch('search', { type, query: '测试' });
  assert.deepEqual(calls.map(url => url.searchParams.get('type')), ['ask', 'ask', 'feedTopic', 'dyhMix', 'album']);
  assert.deepEqual(calls.slice(0, 2).map(url => url.searchParams.get('feedType')), ['question', 'answer']);
});
test('HTTP / malformed JSON / application errors are surfaced', async () => {
  for (const response of [new Response('', { status: 503 }), new Response('<html>blocked</html>'), new Response(JSON.stringify({ code: 403, message: '请先登录' })), new Response('{}')]) {
    const client = new CoolapkClient({ fetchImpl: async () => response });
    await assert.rejects(client.dispatch('home'));
  }
});
test('captcha challenge is retained for manual verification and field is bounded', async () => {
  const client = new CoolapkClient({ fetchImpl: async () => new Response(JSON.stringify({ code: 403, message: '当前访问需要验证码', messageExtra: JSON.stringify({ captchaType: 'NEC', captchaId: 'a'.repeat(32), captchaField: 'bad-header' }) })) });
  await assert.rejects(client.dispatch('detail', { id: '123' }), e => e.code === 'VERIFY_REQUIRED' && e.detail.challenge.field === '_v2_post_token');
});
test('pagination carries both server cursors and deduplicated entities', async () => {
  let requested;
  const client = new CoolapkClient({ fetchImpl: async url => { requested = url; return success([{ entityType: 'feed', id: 123 }, { entityType: 'feed', id: 124 }]); } });
  const response = await client.dispatch('home', { page: 2, firstItem: '101', lastItem: '102' });
  assert.equal(requested.searchParams.get('firstItem'), '101'); assert.equal(requested.searchParams.get('lastItem'), '102');
  assert.equal(response.lastItem, '124'); assert.equal(response.firstItem, '123');
});
test('no authenticated endpoint or write is requested as guest', async () => {
  let requested = 0;
  const client = new CoolapkClient({ fetchImpl: async () => { requested++; return success([]); } });
  for (const operation of ['messages', 'collections', 'notifications']) await assert.rejects(client.dispatch(operation), e => e.code === 'LOGIN_REQUIRED');
  await assert.rejects(client.dispatch('action', { type: 'like', id: '1' }), e => e.code === 'LOGIN_REQUIRED');
  assert.equal(requested, 0);
});
test('reply-to-reply targets comment id and feed_reply lists match APK contract', async () => {
  const requests = [];
  const client = new CoolapkClient({ identity, fetchImpl: async (url, init) => { requests.push({ url, init }); return success(url.pathname.endsWith('/replyList') ? [{ id: 50 }] : { id: 50 }); } });
  await client.dispatch('action', { type: 'reply', id: '1', rid: '2', message: '测试回复' });
  assert.equal(requests[0].url.searchParams.get('id'), '2'); assert.equal(requests[0].url.searchParams.get('type'), 'reply');
  assert.equal(requests[0].init.body.get('message'), '测试回复');
  await client.dispatch('subReplies', { id: '1', rid: '2' });
  assert.equal(requests[1].url.searchParams.get('feedType'), 'feed_reply');
});
test('video resolver uses the POST params field, not GET requestParams', async () => {
  let request;
  const client = new CoolapkClient({ fetchImpl: async (_, init) => { request = init; return success({ url: 'https://image.coolapk.com/test.mp4' }); } });
  await client.dispatch('video', { params: '{"fromType":"test"}' });
  assert.equal(request.method, 'POST'); assert.equal(request.body.get('params'), '{"fromType":"test"}');
});
test('invalid id and newline-injected cookies never reach the network', async () => {
  let requested = 0;
  const client = new CoolapkClient({ fetchImpl: async () => { requested++; return success([]); } });
  await assert.rejects(client.dispatch('detail', { id: '../account/login' }));
  assert.throws(() => sanitizeCookie('uid=1\r\nAuthorization: leak'));
  assert.equal(requested, 0);
});
test('OSS credentials only reach an Alibaba OSS bucket with a validated key', () => {
  assert.equal(ossTarget('coolapk', 'oss-cn-shenzhen.aliyuncs.com', 'feed/a.png'), 'https://coolapk.oss-cn-shenzhen.aliyuncs.com/feed/a.png');
  for (const host of ['evil.test', 'oss-cn-shenzhen.aliyuncs.com.evil.test', 'https://localhost/', 'https://oss-cn-shenzhen.aliyuncs.com:1234/']) assert.throws(() => ossTarget('coolapk', host, 'feed/a.png'));
  assert.throws(() => ossTarget('coolapk', 'oss-cn-shenzhen.aliyuncs.com', '../a.png'));
  assert.throws(() => officialImageUrl('https://evil.test/pic.png'));
});
test('image upload rejects non-images and does not attach account cookies to OSS', async () => {
  const requests = [];
  const client = new CoolapkClient({ identity, cookie: 'token=synthetic-account-secret', fetchImpl: async (url, init) => { requests.push({ url, init }); if (requests.length === 1) return success({ fileInfo: [{ uploadFileName: 'feed/test.png' }], uploadPrepareInfo: { bucket: 'coolapk', endPoint: 'oss-cn-shenzhen.aliyuncs.com', uploadImagePrefix: 'https://image.coolapk.com', accessKeyId: 'synthetic-key', accessKeySecret: 'synthetic-secret', securityToken: 'synthetic-oss-token' } }); return new Response('', { status: 200 }); } });
  await assert.rejects(uploadImage(client, { bytes: Buffer.from('not an image') }));
  assert.equal(requests.length, 0);
  const result = await uploadImage(client, { bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), width: 1, height: 1 });
  assert.equal(result.data, 'https://image.coolapk.com/feed/test.png');
  assert.equal(requests[1].init.headers.Cookie, undefined); assert.equal(requests[1].init.headers['X-App-Token'], undefined);
  assert.match(requests[1].init.headers.Authorization, /^OSS synthetic-key:/);
});
test('account state exposes no cookies and saving is atomic across failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coolapk-store-test-'));
  const encryption = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(x => x ^ 90), decryptString: bytes => Buffer.from(bytes).map(x => x ^ 90).toString() };
  try {
    const store = new AccountStore(directory, encryption); store.add(identity, 'token=synthetic-private-secret');
    assert.ok(!JSON.stringify(store.publicState()).includes('synthetic-private-secret'));
    assert.ok(!readFileSync(store.path).includes(Buffer.from('synthetic-private-secret')));
    const recovered = new AccountStore(directory, encryption); assert.equal(recovered.current().uid, identity.uid);
    encryption.isEncryptionAvailable = () => false;
    assert.throws(() => store.select('')); assert.equal(store.current().uid, identity.uid);
    assert.ok(!existsSync(store.path + '.tmp'));
  } finally { rmSync(directory, { recursive: true }); }
});
test('image proxy only accepts official CDN hosts, without account credentials', async () => {
  for (const url of ['https://evil.test/image.png', 'http://127.0.0.1/image.png', 'https://image.coolapk.com.evil.test/pic', 'file:///C:/secret']) assert.throws(() => imageSource(url));
  let headers;
  const result = await fetchImage('http://image.coolapk.com/test.jpg', async (url, init) => { headers = init.headers; assert.equal(url.protocol, 'https:'); return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/jpg' } }); });
  assert.match(headers['User-Agent'], /CoolMarket\/16.6.4/); assert.equal(headers.Cookie, undefined); assert.equal(headers['X-App-Token'], undefined); assert.equal(result.body.length, 2);
});
test('image proxy rejects HTML challenges instead of treating them as images', async () => {
  await assert.rejects(fetchImage('https://image.coolapk.com/test.jpg', async () => new Response('<html>challenge</html>', { headers: { 'Content-Type': 'text/html' } })));
});
