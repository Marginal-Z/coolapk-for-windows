import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import requestScope from '../electron/request-scope.cjs';
import { userEntityTarget, visibleUserTabs } from '../core/user-discovery.mjs';

function recorder(data = { uid: '77', username: '模拟酷友' }) {
  const requests = [];
  const client = new CoolapkClient({ cookie: 'synthetic_session=private', identity: { uid: '42' }, fetchImpl: async (url, init) => {
    requests.push({ url, init }); return new Response(JSON.stringify({ data }));
  } });
  return { client, requests };
}
test('public profile and space use a separate stable guest device without the current cookie', async () => {
  const { client, requests } = recorder();
  await client.dispatch('publicUserProfile', { uid: '77' });
  await client.dispatch('publicUserSpace', { uid: '77' });
  assert.equal(requests[0].url.pathname, '/v6/user/profile');
  assert.equal(requests[1].url.pathname, '/v6/user/space');
  for (const { url, init } of requests) { assert.equal(url.origin, 'https://api.coolapk.com'); assert.equal(url.search, '?uid=77'); assert.equal(init.headers.Cookie, undefined); assert.equal(init.redirect, 'error'); }
  assert.equal(requests[0].init.headers['X-App-Device'], requests[1].init.headers['X-App-Device']);
  await client.dispatch('userProfile', { uid: '77' });
  assert.equal(requests[2].init.headers.Cookie, 'synthetic_session=private');
  assert.notEqual(requests[0].init.headers['X-App-Device'], requests[2].init.headers['X-App-Device']);
});
test('explicit public verification preserves the guest device and does not introduce a cookie', async () => {
  const { client, requests } = recorder();
  await client.dispatch('publicUserProfile', { uid: '77' });
  client.verification = { field: '_v2_post_token', token: 'synthetic_public_verification' };
  await client.dispatch('publicUserProfile', { uid: '77' });
  assert.equal(requests[1].url.searchParams.get('_v2_post_token'), 'synthetic_public_verification');
  assert.equal(requests[1].init.headers.Cookie, undefined);
  assert.equal(requests[0].init.headers['X-App-Device'], requests[1].init.headers['X-App-Device']);
});
test('validated public profile proof stays on its anonymous reader and never adds the saved account cookie', async () => {
  const { client, requests } = recorder();
  await client.dispatch('publicUserProfile', { uid: '77' });
  const id = 'a'.repeat(32), token = 'NEC:aaaaaaaa:synthetic-local-public-proof';
  const reader = client.getVerificationReader('publicUserProfile');
  assert.equal(reader, client.getPublicReader()); assert.equal(reader.deviceCode, client.publicDeviceCode);
  reader.setVerificationCookie({ id, token }); client.verification = { field: '_v2_post_token', token };
  await client.dispatch('publicUserProfile', { uid: '77' }); delete client.verification;
  await client.dispatch('publicUserSpace', { uid: '77' });
  for (const request of requests.slice(1)) {
    assert.equal(request.init.headers.Cookie, 'validate=' + encodeURIComponent(token));
    assert.equal(request.init.headers['X-App-Device'], requests[0].init.headers['X-App-Device']);
  }
  assert.equal(requests[1].url.searchParams.get('_v2_post_token'), token);
  assert.equal(requests[2].url.searchParams.has('_v2_post_token'), false);
  assert.equal(client.getVerificationCookie(), null);
  await client.dispatch('userProfile', { uid: '77' });
  assert.equal(requests[3].init.headers.Cookie, 'synthetic_session=private');
  assert.notEqual(requests[3].init.headers['X-App-Device'], requests[0].init.headers['X-App-Device']);
});
test('separate scoped IPC reads retain a stable guest device and the account epoch guard', async () => {
  const { client, requests } = recorder();
  const scope = new requestScope.AccountScope();
  const first = scope.capture(client), second = scope.capture(client);
  await first.client.dispatch('publicUserProfile', { uid: '77' });
  await second.client.dispatch('publicUserSpace', { uid: '77' });
  assert.equal(requests[0].init.headers['X-App-Device'], requests[1].init.headers['X-App-Device']);
  assert.notEqual(first.client.deviceCode, first.client.publicDeviceCode);
  assert.equal(requests[0].init.headers.Cookie, undefined); assert.equal(requests[1].init.headers.Cookie, undefined);
  scope.changed();
  await assert.rejects(first.client.dispatch('publicUserProfile', { uid: '77' }), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(requests.length, 2);
});
test('user application ratings preserve entities, server cursors and explicit pagination', async () => {
  const { client, requests } = recorder([{ entityType: 'card', entities: [{ entityType: 'apk', id: '7', entityId: 'apk_7', rating: 5 }] }]);
  const result = await client.dispatch('userAppRatings', { uid: '77', page: 2, firstItem: 'apk_1', lastItem: 'apk_6' });
  assert.equal(requests[0].url.pathname, '/v6/user/apkRatingList');
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { uid: '77', page: '2', firstItem: 'apk_1', lastItem: 'apk_6' });
  assert.equal(result.data[0].rating, 5); assert.equal(result.firstItem, 'apk_7'); assert.equal(result.lastItem, 'apk_7');
});
test('application node discussion uses its confirmed route and cannot change to an unknown node sort', async () => {
  const { client, requests } = recorder([]);
  await client.dispatch('nodeAppFeeds', { id: 'com.example.app', page: 3 });
  assert.equal(requests[0].url.pathname, '/v6/page/dataList');
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { url: '#/feed/apkCommentList', id: 'com.example.app', sort: 'lastupdate_desc', page: '3' });
  await assert.rejects(client.dispatch('nodeAppFeeds', { id: 'com.example.app', sort: 'unknown' }), error => error.code === 'INPUT');
  assert.equal(requests.length, 1);
});
test('opaque server pagination markers take precedence over visible entity IDs', async () => {
  const client = new CoolapkClient({ fetchImpl: async () => new Response(JSON.stringify({ data: [{ entityType: 'apk', id: '7' }], firstItem: 'server:first', lastItem: 'server:last', hasMore: false })) });
  const result = await client.dispatch('userAppRatings', { uid: '77' });
  assert.equal(result.firstItem, 'server:first'); assert.equal(result.lastItem, 'server:last'); assert.equal(result.hasMore, false);
});
test('invalid user, app, page and cursor inputs fail before issuing requests', async () => {
  const { client, requests } = recorder([]);
  for (const [operation, args] of [
    ['publicUserProfile', { uid: '../42' }], ['userProfile', { uid: '' }], ['publicUserSpace', { uid: 'https://example.com' }],
    ['nodeAppFeeds', { id: 'https://example.com/apk/7' }], ['userAppRatings', { uid: '77', page: 0 }],
    ['userAppRatings', { uid: '77', page: 1.5 }], ['userAppRatings', { uid: '77', lastItem: '\ninvalid' }],
    ['userAppRatings', { uid: '77', page: true }], ['userAppRatings', { uid: '77', page: [1] }],
  ]) await assert.rejects(client.dispatch(operation, args), error => error.code === 'INPUT');
  assert.equal(requests.length, 0);
});
test('invalid profile or rating response shapes fail explicitly', async () => {
  for (const operation of ['publicUserProfile', 'userProfile', 'publicUserSpace']) {
    const { client } = recorder([]); await assert.rejects(client.dispatch(operation, { uid: '77' }), error => error.code === 'API_ERROR');
  }
  const { client } = recorder({ unexpected: 'not a list' });
  await assert.rejects(client.dispatch('userAppRatings', { uid: '77' }), error => error.code === 'API_ERROR');
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=', 'base64');
test('another user QR binds the selected UID, authenticated headers and bounded raster data rather than a JSON or web URL', async () => {
  const requests = [], client = new CoolapkClient({ cookie: 'synthetic_session=private', identity: { uid: '42' }, fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response(png, { headers: { 'content-type': 'image/png' } }); } });
  const result = await client.dispatch('userQr', { uid: '77' });
  assert.equal(requests[0].url.toString(), 'https://api.coolapk.com/v6/user/qrImage?uid=77'); assert.equal(requests[0].init.redirect, 'error'); assert.equal(requests[0].init.headers.Cookie, 'synthetic_session=private'); assert.ok(requests[0].init.headers['X-App-Device']); assert.equal(result.data, 'data:image/png;base64,' + png.toString('base64'));
  await client.dispatch('publicUserQr', { uid: '88' }); await client.dispatch('publicUserQr', { uid: '99' });
  assert.equal(requests[1].init.headers.Cookie, undefined); assert.equal(requests[1].init.headers['X-App-Device'], requests[2].init.headers['X-App-Device']); assert.notEqual(requests[0].init.headers['X-App-Device'], requests[1].init.headers['X-App-Device']); assert.equal(requests[1].url.search, '?uid=88');
});
test('QR errors remain login, network or explicit data failures and oversized streams are cancelled', async () => {
  for (const [response, code] of [
    [new Response('login', { status: 401 }), 'LOGIN_REQUIRED'], [new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), 'API_ERROR'],
    [new Response(png, { headers: { 'content-type': 'image/jpeg' } }), 'API_ERROR'], [new Response('', { headers: { 'content-type': 'image/png' } }), 'API_ERROR'],
    [new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(4 * 1024 ** 2 + 1) } }), 'API_ERROR'],
  ]) await assert.rejects(new CoolapkClient({ fetchImpl: async () => response }).dispatch('publicUserQr', { uid: '77' }), error => error.code === code);
  for (const code of ['NETWORK', 'ACCOUNT_CHANGED']) await assert.rejects(new CoolapkClient({ fetchImpl: async () => { throw Object.assign(new Error('synthetic transport'), { code }); } }).dispatch('userQr', { uid: '77' }), error => error.code === code);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 ** 2)); }, cancel() { cancelled = true; } });
  await assert.rejects(new CoolapkClient({ fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/png' } }) }).dispatch('userQr', { uid: '77' }), error => error.code === 'API_ERROR'); assert.equal(cancelled, true);
  const broken = new ReadableStream({ start(controller) { controller.error(new TypeError('synthetic stream failure')); } });
  await assert.rejects(new CoolapkClient({ fetchImpl: async () => new Response(broken, { headers: { 'content-type': 'image/png' } }) }).dispatch('userQr', { uid: '77' }), error => error.code === 'NETWORK');
});
test('QR JSON verification retains the supported challenge and public replay binds the same target without introducing cookies', async () => {
  const requests = [], client = new CoolapkClient({ cookie: 'synthetic_session=private', fetchImpl: async (url, init) => { requests.push({ url, init }); return requests.length === 1 ? new Response(JSON.stringify({ status: -1, message: '请完成安全验证', messageExtra: { captchaType: 'NEC', captchaId: '0123456789abcdef0123456789abcdef', captchaField: '_v2_post_token' } }), { headers: { 'content-type': 'application/json' } }) : new Response(png, { headers: { 'content-type': 'image/png' } }); } });
  await assert.rejects(client.dispatch('publicUserQr', { uid: '77' }), error => error.code === 'VERIFY_REQUIRED' && error.detail.challenge.field === '_v2_post_token');
  client.verification = { field: '_v2_post_token', token: 'synthetic_qr_verification' }; await client.dispatch('publicUserQr', { uid: '77' });
  assert.equal(requests[1].url.searchParams.get('uid'), '77'); assert.equal(requests[1].url.searchParams.get('_v2_post_token'), 'synthetic_qr_verification'); assert.equal(requests[1].init.headers.Cookie, undefined); assert.equal(requests[0].init.headers['X-App-Device'], requests[1].init.headers['X-App-Device']);
});
test('public QR replay and later QR reads send the validated Cookie on the same anonymous device', async () => {
  const requests = [], id = 'a'.repeat(32), token = 'NEC:aaaaaaaa:synthetic-local-qr-proof';
  const client = new CoolapkClient({ cookie: 'synthetic_session=private', identity: { uid: '42' }, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return requests.length === 1 ? Response.json({ code: 403, message: '请完成安全验证', messageExtra: { captchaType: 'NEC', captchaId: id, captchaField: '_v2_post_token' } }) : new Response(png, { headers: { 'content-type': 'image/png' } });
  } });
  await assert.rejects(client.dispatch('publicUserQr', { uid: '77' }), { code: 'VERIFY_REQUIRED' });
  client.getVerificationReader('publicUserQr').setVerificationCookie({ id, token });
  client.verification = { field: '_v2_post_token', token };
  await client.dispatch('publicUserQr', { uid: '77' }); delete client.verification;
  await client.dispatch('publicUserQr', { uid: '88' });
  for (const request of requests.slice(1)) {
    assert.equal(request.init.headers.Cookie, 'validate=' + encodeURIComponent(token));
    assert.equal(request.init.headers['X-App-Device'], requests[0].init.headers['X-App-Device']);
  }
  assert.equal(requests[1].url.searchParams.get('_v2_post_token'), token);
  assert.equal(requests[2].url.searchParams.has('_v2_post_token'), false);
  await client.dispatch('userQr', { uid: '77' });
  assert.equal(requests[3].init.headers.Cookie, 'synthetic_session=private');
  assert.equal(client.getVerificationCookie(), null);
});
test('another user followed circles preserve mixed rows and use exact target UID and page cursors', async () => {
  const { client, requests } = recorder([{ entityType: 'card', entities: [{ entityType: 'topic', id: '8', tag: '摄影' }, { entityType: 'product', id: '9', title: '相机' }] }, { entityType: 'unknownForum', id: '10', url: '/user/private' }]);
  const result = await client.dispatch('userFollowNodes', { uid: '77', page: 2, firstItem: 'node:first', lastItem: 'node:last' });
  assert.equal(requests[0].url.pathname, '/v6/user/forumFollowList'); assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { uid: '77', firstItem: 'node:first', lastItem: 'node:last', page: '2' }); assert.equal(result.data.length, 3); assert.equal(result.data[2].entityType, 'unknownForum');
  await client.dispatch('publicUserFollowNodes', { uid: '88' }); assert.equal(requests[1].init.headers.Cookie, undefined); assert.equal(requests[1].url.searchParams.get('uid'), '88');
});
test('homepage cards come from space and continuation starts at feed page two without treating card IDs as cursors', async () => {
  const requests = [], client = new CoolapkClient({ fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(url.pathname.endsWith('/space') ? { data: { uid: '77', homeTabCardRows: [{ entityType: 'collection', id: '300', title: '主页卡片' }] } } : { data: [{ entityType: 'feed', id: '401', message: '下一页动态' }], firstItem: 'feed:first', lastItem: 'feed:last', hasMore: false })); } });
  const first = await client.dispatch('publicUserHomepage', { uid: '77' }); assert.equal(first.data[0].id, '300'); assert.equal(first.firstItem, ''); assert.equal(first.lastItem, ''); assert.equal(first.hasMore, true);
  const second = await client.dispatch('publicUserHomepage', { uid: '77', page: 2, firstItem: first.firstItem, lastItem: first.lastItem }); assert.equal(second.data[0].id, '401'); assert.equal(second.lastItem, 'feed:last'); assert.equal(second.hasMore, false);
  assert.deepEqual(requests.map(request => request.url.pathname), ['/v6/user/space', '/v6/user/feedList']); assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), { uid: '77', page: '2', showAnonymous: '0', isIncludeTop: '1', showDoing: '1' });
});
test('homepage without cards reads the first feed page and invalid or mismatched space does not silently become an empty list', async () => {
  const requests = [], client = new CoolapkClient({ fetchImpl: async url => { requests.push(url); return new Response(JSON.stringify(url.pathname.endsWith('/space') ? { data: { uid: '77' } } : { data: [{ entityType: 'feed', id: '88' }] })); } });
  const result = await client.dispatch('userHomepage', { uid: '77' }); assert.equal(result.data[0].id, '88'); assert.equal(requests[1].searchParams.get('page'), '1');
  for (const data of [{ uid: '88', homeTabCardRows: [] }, { uid: '77', homeTabCardRows: {} }]) await assert.rejects(recorder(data).client.dispatch('userHomepage', { uid: '77' }), error => error.code === 'API_ERROR');
  await assert.rejects(recorder({ userInfo: { uid: '88' } }).client.dispatch('userProfile', { uid: '77' }), error => error.code === 'API_ERROR');
});
test('public content uses fixed source-backed routes and constrained rating targets rather than arbitrary server URLs', async () => {
  const { client, requests } = recorder([]);
  await client.dispatch('userTabData', { uid: '77', tab: 'article', page: 3, firstItem: 'article:first', lastItem: 'article:last', url: 'https://foreign.example/private' });
  assert.equal(requests[0].url.pathname, '/v6/user/htmlFeedList'); assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { uid: '77', page: '3', firstItem: 'article:first', lastItem: 'article:last' });
  await client.dispatch('publicUserTabData', { uid: '88', tab: 'rating', ratingTarget: 'product', page: 2 });
  assert.equal(requests[1].url.pathname, '/v6/page/dataList'); assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), { url: '#/feed/nodeRatingList?uid=88&targetType=product&parseRatingToFeed=1', title: '评分', subTitle: '', pageContext: 'user_space', page: '2' }); assert.equal(requests[1].init.headers.Cookie, undefined);
  for (const tab of ['like', 'reply', 'recycle', 'blacklist', '../private', 'https://foreign.example']) await assert.rejects(client.dispatch('userTabData', { uid: '77', tab }), error => error.code === 'UNSUPPORTED');
  await assert.rejects(client.dispatch('userTabData', { uid: '77', tab: 'rating', ratingTarget: 'private' }), error => error.code === 'INPUT'); assert.equal(requests.length, 2);
});
test('public tab visibility follows profile flags and unknown rows never acquire navigation from arbitrary URLs', () => {
  const baseline = visibleUserTabs({}).map(tab => tab.id); for (const hidden of ['like', 'reply', 'recycle', 'album', 'developer_apps', 'apk_follow', 'discovery', 'goods_store']) assert.ok(!baseline.includes(hidden));
  const expanded = visibleUserTabs({ albumNum: 2, isDeveloper: true, userInfo: { apkFollowNum: 1 }, discovery_num: 3, goods_store_status: 1 }).map(tab => tab.id); for (const optional of ['album', 'developer_apps', 'apk_follow', 'discovery', 'goods_store']) assert.ok(expanded.includes(optional));
  assert.equal(userEntityTarget({ entityType: 'unknownForum', id: '10', url: '/feed/123' }), null); assert.equal(userEntityTarget({ entityType: 'product', id: '../123', url: '/feed/123' }), null); assert.equal(userEntityTarget({ entityType: 'user', id: '77', uid: '0' }), null); assert.equal(userEntityTarget({ entityType: 'topic', tag: '摄影' }).tag, '摄影');
  assert.equal(userEntityTarget({ entityType: 'productAlbum', id: '9' }), null); assert.equal(userEntityTarget({ entityType: 'productAlbum', id: '9', uid: '77' }).uid, '77'); assert.equal(userEntityTarget({ entityType: 'apk', id: '9', packageName: 'https://foreign.example' }).packageName, '');
});
test('new user reads reject invalid IDs and stale account scope before any request', async () => {
  const { client, requests } = recorder([]);
  for (const operation of ['userQr', 'publicUserFollowNodes', 'userHomepage', 'publicUserTabData']) await assert.rejects(client.dispatch(operation, { uid: '0', tab: 'feed' }), error => error.code === 'INPUT');
  const scope = new requestScope.AccountScope(), captured = scope.capture(client); scope.changed();
  await assert.rejects(captured.client.dispatch('publicUserQr', { uid: '77' }), error => error.code === 'ACCOUNT_CHANGED'); await assert.rejects(captured.client.dispatch('userFollowNodes', { uid: '77' }), error => error.code === 'ACCOUNT_CHANGED'); assert.equal(requests.length, 0);
});
