import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import requestScope from '../electron/request-scope.cjs';

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
