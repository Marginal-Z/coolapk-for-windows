import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CoolapkClient } from '../core/client.mjs';
import { createDeviceCode, APK_PROFILE } from '../core/auth.mjs';
import { dispatchAccount, ACCOUNT_CONTENT_TABS } from '../core/account.mjs';
const { AccountScope } = createRequire(import.meta.url)('../electron/request-scope.cjs');
const identity = { uid: '123456', username: '只读测试酷友' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=', 'base64');
const json = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const image = (bytes = png, type = 'image/png', more = {}) => new Response(bytes, { headers: { 'Content-Type': type, ...more } });
function mock(respond = () => json([])) {
  const calls = [];
  const client = new CoolapkClient({ identity, cookie: 'Cookie: SESSID=synthetic-session', deviceCode: createDeviceCode('synthetic-qr-device'), fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return respond(url, init); } });
  return { client, calls, run: (op, args) => dispatchAccount(client, op, args) };
}

test('all new personal read operations require login before networking', async () => {
  let calls = 0; const client = new CoolapkClient({ fetchImpl: () => { calls++; return json([]); } });
  for (const op of ['accountQr', 'accountFollowNodes', 'accountTabData', 'accountSpamFeeds']) await assert.rejects(dispatchAccount(client, op), e => e.code === 'LOGIN_REQUIRED');
  assert.equal(calls, 0); assert.equal(await dispatchAccount(client, 'accountAppealFeed'), undefined);
});

test('QR uses the current account, authenticated fixed origin and raster dataURL only', async () => {
  const { run, calls, client } = mock(() => image());
  const result = await run('accountQr', { uid: '654321', url: 'https://external.invalid/image' });
  assert.equal(result.data, 'data:image/png;base64,' + png.toString('base64'));
  assert.equal(calls[0].url.href, 'https://api.coolapk.com/v6/user/qrImage?uid=' + identity.uid);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers.Cookie, 'SESSID=synthetic-session');
  assert.equal(calls[0].init.headers['X-App-Device'], client.deviceCode); assert.equal(calls[0].init.headers['X-App-Version'], APK_PROFILE.version);
  assert.equal(calls[0].init.headers.Accept, 'image/*'); assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('QR rejects HTML/SVG, MIME mismatches, empty images, auth failure and oversize declared lengths', async () => {
  for (const reply of [image('<svg/>', 'image/svg+xml'), image('login page', 'text/html'), image(png, 'image/jpeg'), image('bad image'), image(''), image(png, 'image/png', { 'Content-Length': String(4 * 1024 ** 2 + 1) })]) await assert.rejects(mock(() => reply).run('accountQr'), e => e.code === 'API_ERROR');
  await assert.rejects(mock(() => new Response('', { status: 401 })).run('accountQr'), e => e.code === 'LOGIN_REQUIRED');
});

test('QR streams are bounded even when Content-Length is absent and cancelled on overflow', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 ** 2 + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(mock(() => new Response(stream, { headers: { 'Content-Type': 'image/png' } })).run('accountQr'), e => e.code === 'API_ERROR');
  assert.equal(cancelled, true);
});

test('QR scope snapshots retain the original owner and discard an in-flight result after account change', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const { client, calls } = mock(async () => { await waiting; return image(); }), scope = new AccountScope(), context = scope.capture(client);
  const pending = dispatchAccount(context.client, 'accountQr'); scope.changed(); client.identity = { uid: '654321' }; release();
  const result = await pending; assert.ok(result.data.startsWith('data:image/png;')); assert.equal(calls[0].url.searchParams.get('uid'), identity.uid);
  assert.throws(() => scope.assert(context), e => e.code === 'ACCOUNT_CHANGED');
  await assert.rejects(dispatchAccount(context.client, 'accountQr'), e => e.code === 'ACCOUNT_CHANGED'); assert.equal(calls.length, 1);
});

test('follow nodes use forumFollowList and exact page cursors rather than removed customNodeList', async () => {
  const { run, calls } = mock(() => json([{ id: 17, entityType: 'topic', title: '测试圈子', url: '/topic/测试' }]));
  const result = await run('accountFollowNodes', { uid: '654321', page: 2, firstItem: '7', lastItem: '16' });
  assert.equal(calls[0].url.pathname, '/v6/user/forumFollowList');
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { uid: identity.uid, page: '2', firstItem: '7', lastItem: '16' });
  assert.equal(result.firstItem, '17'); assert.equal(result.hasMore, true); assert.equal(result.data[0].entityType, 'topic');
  await run('accountFollowNodes'); assert.equal(calls[1].url.searchParams.get('firstItem'), ''); assert.equal(calls[1].url.searchParams.get('lastItem'), '');
});

test('all personal content tabs bind self uid and their fixed documented GET contracts', async () => {
  const direct = { feed: 'user/feedList', reply: 'user/replyList', collection: 'collection/list', goods_store: 'goods/goodsStoreItemList', goods_rank: 'goodsList/list', developer_apps: 'apk/developerAppList', apk_follow: 'user/apkFollowList', article: 'user/htmlFeedList', qa: 'user/questionAndAnswerList', album: 'user/albumList', like: 'user/likeList', discovery: 'user/discoveryList' };
  const pageRoutes = { coolpic: `#/feed/userCoolPictureFeedList?fragmentTemplate=flex&uid=${identity.uid}`, rating: `#/feed/nodeRatingList?uid=${identity.uid}&targetType=all&parseRatingToFeed=1`, goods: `#/goods/goodsFeedList?type=default&fragmentTemplate=flex&uid=${identity.uid}`, ershou: `#/feed/userErshouList?fragmentTemplate=flex&ershouStatus=userAll&uid=${identity.uid}`, recycle: `#/feed/userDeleteFeedList?uid=${identity.uid}` };
  const row = { id: 27, entityType: 'future-content', entityTemplate: 'unknown', title: '保留未来实体', futureField: 'retained' };
  const { run, calls } = mock(() => json({ entities: [{ entityType: 'card', entities: [row] }] }));
  for (const tab of ACCOUNT_CONTENT_TABS) {
    const result = await run('accountTabData', { tab, uid: '654321', page: 3, firstItem: '1', lastItem: '2', url: '#/account/delete', endpoint: '/v6/account/delete' });
    assert.deepEqual(result.data, [row]);
    const call = calls.at(-1); assert.equal(call.init.method, 'GET'); assert.equal(call.url.searchParams.get('page'), '3'); assert.equal(call.url.searchParams.get('firstItem'), '1'); assert.equal(call.url.searchParams.get('lastItem'), '2');
    if (direct[tab]) { assert.equal(call.url.pathname, '/v6/' + direct[tab]); assert.equal(call.url.searchParams.get('uid'), identity.uid); }
    else { assert.equal(call.url.pathname, '/v6/page/dataList'); assert.equal(call.url.searchParams.get('url'), pageRoutes[tab]); assert.equal(call.url.searchParams.get('pageContext'), 'user_space'); }
    if (tab === 'feed') assert.deepEqual(['showAnonymous', 'isIncludeTop', 'showDoing'].map(key => call.url.searchParams.get(key)), ['0', '1', '1']);
  }
  assert.equal(calls.length, 17);
});

test('rating targets are constrained and unknown/failed list envelopes are never successful empties', async () => {
  const { run, calls } = mock();
  for (const ratingTarget of ['apk', 'product']) { await run('accountTabData', { tab: 'rating', ratingTarget }); assert.ok(calls.at(-1).url.searchParams.get('url').includes('targetType=' + ratingTarget)); }
  for (const args of [{ tab: 'deleteAccount' }, { tab: 'rating', ratingTarget: '#/account/delete' }, { tab: 'feed', page: 0 }, { tab: 'feed', lastItem: 'a'.repeat(121) }]) await assert.rejects(run('accountTabData', args), e => e.code === 'INPUT');
  assert.equal(calls.length, 2);
  await assert.rejects(mock(() => json({ unknown: [] })).run('accountTabData', { tab: 'feed' }), e => e.code === 'API_ERROR');
  await assert.rejects(mock(() => new Response('{"status":403,"message":"无审核权限"}')).run('accountSpamFeeds'), e => e.code === 'API_ERROR');
});

test('spam feed list uses documented read-only query and retains server reasons', async () => {
  const { run, calls } = mock(() => json([{ id: 47, message: '异常测试动态', spamReason: '服务器说明' }]));
  const result = await run('accountSpamFeeds', { page: 2, type: 'write', action: 'appeal', spamType: 'private', firstItem: '4', lastItem: '5' });
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { type: 'feed', channel: 'feed', spamType: 'feed', subType: 'feed', page: '2', firstItem: '4', lastItem: '5' });
  assert.equal(calls[0].url.pathname, '/v6/feed/spamFeedList'); assert.equal(calls[0].init.method, 'GET'); assert.equal(result.data[0].entityType, 'feed'); assert.equal(result.data[0].spamReason, '服务器说明');
});
