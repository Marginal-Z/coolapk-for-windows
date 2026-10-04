import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchAccount, ACCOUNT_OPERATIONS } from '../core/account.mjs';
import { uploadImage } from '../core/upload.mjs';
import { createDeviceCode } from '../core/auth.mjs';
const identity = { uid: '123456', username: '测试酷友' }, other = '654321';
const response = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function mock(responder = () => response(1)) {
  const calls = [];
  const client = new CoolapkClient({ identity, cookie: 'SESSID=synthetic-session; ddid=synthetic-session-device', deviceCode: createDeviceCode('synthetic-device'), fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return responder(url, init, calls.length); } });
  return { client, calls, run: (op, args) => dispatchAccount(client, op, args) };
}
test('all account features reject guests before networking and unknown operations remain delegatable', async () => {
  let requests = 0; const client = new CoolapkClient({ fetchImpl: async () => { requests++; return response(1); } });
  for (const op of ACCOUNT_OPERATIONS) await assert.rejects(dispatchAccount(client, op), e => e.code === 'LOGIN_REQUIRED');
  assert.equal(await dispatchAccount(client, 'anotherFeature'), undefined); assert.equal(requests, 0);
});
test('profile writes use exact field contracts and reject invented nickname / invalid dates', async () => {
  const { run, calls } = mock();
  await run('accountProfileUpdate', { field: 'gender', value: '0' });
  await run('accountProfileUpdate', { field: 'bio', value: '' });
  await run('accountProfileUpdate', { field: 'birthday', value: '2000-02-29' });
  await run('accountProfileUpdate', { field: 'location', province: '广东', city: '深圳' });
  assert.equal(calls[0].url.pathname, '/v6/account/changeProfile'); assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body.get('key'), 'gender'); assert.equal(calls[0].init.body.get('value'), '0');
  assert.equal(calls[1].init.body.get('key'), 'bio'); assert.equal(calls[1].init.body.get('value'), '');
  assert.equal(calls[2].init.body.get('key'), ''); assert.deepEqual(JSON.parse(calls[2].init.body.get('value')), { birthyear: 2000, birthmonth: 2, birthday: 29 });
  assert.deepEqual(JSON.parse(calls[3].init.body.get('value')), { province: '广东', city: '深圳' });
  for (const args of [{ field: 'username', value: 'new' }, { field: 'gender', value: 5 }, { field: 'birthday', value: '2001-02-29' }, { field: 'birthday', value: '9999-12-31' }, { field: 'bio', value: 'a'.repeat(61) }]) await assert.rejects(run('accountProfileUpdate', args));
  assert.equal(calls.length, 4);
});
test('profile reads omit credentials and reject a different account or invalid shape', async () => {
  const { run } = mock(() => response({ uid: identity.uid, username: '酷友', token: 'synthetic-private', userInfo: { bio: '签名', cookie: 'synthetic-private' } }));
  const profile = await run('accountProfile'); assert.equal(profile.data.bio, '签名'); assert.ok(!JSON.stringify(profile).includes('synthetic-private'));
  await assert.rejects(mock(() => response({ uid: other })).run('accountProfile'));
  await assert.rejects(mock(() => response([])).run('accountProfile'));
});
test('avatars are multipart imgFile images and covers use the independent cover upload bucket', async () => {
  const { run, calls } = mock(); await run('accountAvatar', { bytes: png });
  const file = calls[0].init.body.get('imgFile'); assert.equal(file.name, 'avatar.png'); assert.equal(file.type, 'image/png'); assert.equal(calls[0].url.pathname, '/v6/account/changeAvatar');
  await assert.rejects(run('accountAvatar', { bytes: Buffer.from('invalid') })); assert.equal(calls.length, 1);
  const upload = mock(() => response({ fileInfo: [{ url: 'https://image.coolapk.com/cover/synthetic.png' }], uploadPrepareInfo: {} }));
  const result = await uploadImage(upload.client, { bytes: png, width: 1, height: 1, dir: 'cover' });
  assert.equal(result.data, 'https://image.coolapk.com/cover/synthetic.png'); assert.equal(upload.calls[0].init.body.get('uploadBucket'), 'cover'); assert.equal(upload.calls[0].init.body.get('uploadDir'), 'cover'); assert.equal(upload.calls[0].init.body.get('feed_type'), ''); assert.equal(upload.calls[0].init.body.get('toUid'), identity.uid);
  await run('accountCover', { url: result.data }); assert.equal(calls[1].url.pathname, '/v6/account/changeAvatarCover'); assert.equal(calls[1].init.body.get('url'), result.data);
  await assert.rejects(run('accountCover', { url: 'https://evil.test/image.png' }));
});
test('official blacklist removal and ignore removal use POST query fields, preserving the separate ignore contract', async () => {
  const { run, calls } = mock();
  for (const action of ['black', 'unblack', 'ignore', 'unignore']) await run('accountRelationship', { action, uid: other });
  assert.deepEqual(calls.map(c => c.url.pathname), ['/v6/user/addToBlackList', '/v6/user/removeFromBlackList', '/v6/user/addToIgnoreList', '/v6/user/removeFromIgnoreList']); assert.deepEqual(calls.map(c => c.init.method), ['POST', 'POST', 'GET', 'POST']); assert.ok(calls.every(c => c.url.searchParams.get('uid') === other));
  await run('accountRelationship', { action: 'special', uid: other, value: true }); await run('accountRelationship', { action: 'cancelFan', uid: other }); await run('accountRelationship', { action: 'remark', uid: other, name: '' });
  assert.equal(calls[4].url.searchParams.get('special'), '1'); assert.equal(calls[4].init.method, 'POST'); assert.equal(calls[5].url.pathname, '/v6/user/cancelFollower'); assert.equal(calls[5].url.searchParams.get('uid'), other); assert.equal(calls[6].init.body.get('name'), '');
  await assert.rejects(run('accountRelationship', { action: 'black', uid: identity.uid })); await assert.rejects(run('accountRelationship', { action: 'remark', uid: other, name: 'a'.repeat(31) })); assert.equal(calls.length, 7);
});
test('fan identities come from userInfo and remark envelopes retain the target uid', async () => {
  const followers = mock(() => response([{ id: 10, fuid: identity.uid, fUserInfo: identity, userInfo: { uid: other, username: '粉丝' } }]));
  const fans = await followers.run('accountUsers', { type: 'fans' }); assert.equal(fans.data[0].uid, other); assert.equal(fans.data[0].username, '粉丝'); assert.equal(followers.calls[0].url.searchParams.get('isIncludeTop'), '1');
  const remarks = await mock(() => response({ remarkList: [{ remarkUid: other, remarkName: '朋友' }] })).run('accountUsers', { type: 'remarks' }); assert.equal(remarks.data[0].uid, other); assert.equal(remarks.data[0].remarkName, '朋友');
  await assert.rejects(mock(() => response({ unknown: [] })).run('accountUsers', { type: 'black' }));
});
test('official plugin JSON uses a fixed mobile endpoint / Build UA and strips raw session fields', async () => {
  const { run, calls } = mock(() => new Response(JSON.stringify({ status: 200, cookie: 'synthetic-private', token: 'synthetic-private', avatarPluginList: [{ id: 7, title: '挂件', plugin_type: 0, token: 'synthetic-private' }], feedPluginList: [], selectedAvatarPluginRow: { id: 7, token: 'synthetic-private' } })));
  const plugins = await run('accountPlugins'); assert.ok(!JSON.stringify(plugins).includes('synthetic-private'));
  assert.equal(calls[0].url.origin, 'https://m.coolapk.com'); assert.equal(calls[0].url.pathname, '/mp/userPlugin/myPlugin'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers['X-App-Token'], undefined); assert.match(calls[0].init.headers['User-Agent'], /\(#Build; Samsung;/); assert.match(calls[0].init.headers.Cookie, /DID=synthetic-device/); assert.ok(!calls[0].init.headers.Cookie.includes('ddid='));
});
test('plugin save preserves both selected ids including zero and claims never accept an arbitrary destination', async () => {
  const { run, calls } = mock(() => new Response('{"status":200,"message":"ok"}'));
  await run('accountPluginSave', { avatarId: 0, feedId: 8 }); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.body.get('avatar_id'), '0'); assert.equal(calls[0].init.body.get('feed_id'), '8');
  await run('accountPluginClaim', { id: 7, url: 'https://evil.test' }); assert.equal(calls[1].url.pathname, '/mp/userPlugin/getPlugin'); assert.equal(calls[1].url.searchParams.get('id'), '7'); assert.match(calls[1].init.headers.Cookie, /ddid=synthetic-session-device/);
  await assert.rejects(run('accountPluginClaim', { id: 0 })); assert.equal(calls.length, 2);
  await assert.rejects(mock(() => new Response('{"status":400,"message":"条件未满足"}')).run('accountPluginSave', { avatarId: 0, feedId: 0 }));
});
test('card configuration stores show/hide ordering and refuses duplicate ids or unconfirmed writes', async () => {
  const { run, calls } = mock(); await run('accountCardSave', { show: [4, 0, 2], hide: [3] });
  assert.equal(calls[0].init.body.get('key'), 'my_page_card_config'); assert.deepEqual(JSON.parse(calls[0].init.body.get('value')), { show: [4, 0, 2], hide: [3] });
  await assert.rejects(run('accountCardSave', { show: [4], hide: [4] })); await assert.rejects(run('accountCardSave', { show: [-1], hide: [] })); assert.equal(calls.length, 1);
  await assert.rejects(mock(() => response(0)).run('accountCardSave', { show: [4], hide: [] }));
});
test('home channel changes use home_tab_config rows rather than the card key/value contract', async () => {
  const { run, calls } = mock(); await run('accountChannels', { reset: true }); await run('accountChannelSave', { channels: [{ id: 420, title: '头条', visible: true }, { id: 415, title: '热榜', visible: false }] });
  assert.equal(calls[0].url.searchParams.get('reSet'), '1'); assert.equal(calls[0].url.searchParams.get('key'), 'home_tab_config');
  assert.equal(calls[1].init.body.get('key'), null); assert.deepEqual(JSON.parse(calls[1].init.body.get('home_tab_config')), [{ id: '420', title: '头条', page_visibility: '1' }, { id: '415', title: '热榜', page_visibility: '0' }]);
});
test('cloud history keeps original entity fields and forwards pagination without pretending unknown data is empty', async () => {
  const { run, calls } = mock(() => response([{ entityType: 'history', id: 9, title: '历史动态', url: 'feed/123', logo: 'image/synthetic.jpg', dateline: 123 }]));
  const history = await run('accountHistory', { page: 2, firstItem: '5', lastItem: '6' }); assert.equal(history.data[0].url, '/feed/123'); assert.equal(history.data[0].entityType, 'history'); assert.equal(history.data[0].logo, 'https://image.coolapk.com/image/synthetic.jpg'); assert.equal(calls[0].url.searchParams.get('firstItem'), '5'); assert.equal(calls[0].url.searchParams.get('type'), 'feed');
  await run('accountHistory', { type: 'recent' }); assert.equal(calls[1].url.pathname, '/v6/user/recentHistoryList'); assert.equal(calls[1].url.searchParams.get('type'), null);
  await assert.rejects(mock(() => response({ unknown: [] })).run('accountHistory'));
});
test('plugin transports preserve account-change errors instead of disguising them as network failures', async () => {
  const { client } = mock(); client.fetch = () => { const error = new Error('账号已切换'); error.code = 'ACCOUNT_CHANGED'; throw error; };
  await assert.rejects(dispatchAccount(client, 'accountPlugins'), e => e.code === 'ACCOUNT_CHANGED');
});
