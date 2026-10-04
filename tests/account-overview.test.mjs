import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchAccount } from '../core/account.mjs';
import { createDeviceCode } from '../core/auth.mjs';
import { accountStatistic, accountOverviewSummary, accountCardTarget, accountOverviewCards } from '../core/account-overview-models.mjs';

function client(data, envelope = {}) {
  const calls = [];
  const reader = new CoolapkClient({ identity: { uid: '123456', username: '合成酷友' }, cookie: 'SESSID=synthetic-only', deviceCode: createDeviceCode('synthetic-overview'), fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return new Response(JSON.stringify({ data, ...envelope }), { headers: { 'Content-Type': 'application/json' } }); } });
  return { calls, run: args => dispatchAccount(reader, 'accountOverview', args) };
}
test('my overview binds the current user and returns only documented safe profile and count fields', async () => {
  const reader = client({ userInfo: { uid: '123456', username: '合成酷友', level: 0, feed: 0, follow: 2, fans: 0, cookie: 'synthetic-private', province: { token: 'synthetic-private' } }, token: 'synthetic-private', arbitraryExperience: 300, entities: [{ secret: 'synthetic-private' }] }, { token: 'synthetic-private', messageExtra: 'synthetic-private' });
  const result = await reader.run({ uid: '654321', endpoint: '/private' });
  assert.equal(reader.calls[0].url.pathname, '/v6/user/space'); assert.equal(reader.calls[0].url.searchParams.get('uid'), '123456'); assert.equal(reader.calls[0].init.method || 'GET', 'GET');
  assert.deepEqual(result.data, { uid: '123456', username: '合成酷友', level: 0, feed: 0, follow: 2, fans: 0 }); assert.ok(!JSON.stringify(result).includes('synthetic-private'));
});
test('my overview rejects malformed and wrong-user data instead of showing another account or false empties', async () => {
  for (const data of [null, [], 'profile', { uid: '654321' }, { uid: '123456', userInfo: { uid: '654321' } }]) await assert.rejects(client(data).run(), error => error.code === 'API_ERROR');
  let requests = 0; const guest = new CoolapkClient({ fetchImpl: async () => { requests++; throw new Error('Unexpected guest network'); } });
  await assert.rejects(dispatchAccount(guest, 'accountOverview'), error => error.code === 'LOGIN_REQUIRED'); assert.equal(requests, 0);
});
test('my overview omits oversized strings, unsafe numbers and nested values even under allowed profile names', async () => {
  const reader = client({ uid: '123456', username: 'x'.repeat(201), bio: 'x'.repeat(1001), cover: 'x'.repeat(4097), level: Number.MAX_SAFE_INTEGER + 1, feed: 1.5, follow: true, fans: { token: 'synthetic-private' }, province: '广东' });
  assert.deepEqual((await reader.run()).data, { uid: '123456', province: '广东' });
});
test('overview statistics preserve real zero and omit missing, fractional, negative and invalid values', () => {
  assert.deepEqual(accountOverviewSummary({ uid: '123456', feed: 0, follow: '0', fans: 5, level: 0 }, '123456'), { feed: 0, follow: 0, fans: 5, level: 0 });
  for (const value of [undefined, null, '', false, -1, 1.5, NaN, Infinity, {}, '01foo', Number.MAX_SAFE_INTEGER + 1]) assert.equal(accountStatistic(value), null);
  assert.deepEqual(accountOverviewSummary({ feed: 3 }, '123456'), { feed: 3, follow: null, fans: null, level: null });
  assert.deepEqual(accountOverviewSummary({ uid: '654321', feed: 99 }, '123456'), {});
});
test('my card targets only fixed personal list aliases and known entity links', () => {
  for (const [url, kind] of [['/member/recentHistoryList', 'recent'], ['/member/hitHistoryList', 'history'], ['/topic/myFollowTopicList', 'topics'], ['/collection/myCollectionList', 'collections'], ['/feed/myQaFeedList', 'qa']]) assert.deepEqual(accountCardTarget({ url }), { kind });
  assert.deepEqual(accountCardTarget({ url: '/feed/22' }), { kind: 'link', url: '/feed/22' });
  assert.equal(accountCardTarget({ url: '/member/hitHistoryList?uid=654321' }), null);
  for (const row of [{ url: 'https://evil.test/feed/22' }, { url: '/page?url=/private' }, { url: '/account/updateConfig' }, { entityType: 'future', id: 2 }, { entityType: 'feed', id: 0 }, { entityType: 'user', id: 2 }]) assert.equal(accountCardTarget(row), null);
  assert.equal(accountCardTarget({ entityType: 'feed', id: 22 })?.kind, 'entity');
});
test('unknown card templates remain read-only and malformed envelopes stay explicit errors', () => {
  const cards = accountOverviewCards(JSON.stringify([{ entityType: 'card', entityTemplate: 'iconScrollCard', title: '关注', url: '/topic/myFollowTopicList', entities: [{ entityType: 'topic', tag: '合成话题', title: '合成话题' }] }, { entityType: 'card', entityTemplate: 'future-private-template', title: '未知模板', url: '/feed/22', entities: [{ entityType: 'feed', id: 22, title: '只读内容' }] }, { entityType: 'card', title: '隐藏卡片', page_visibility: 0 }]));
  assert.equal(cards.invalid, false); assert.equal(cards.cards.length, 2); assert.equal(cards.cards[0].items[0].target.kind, 'entity'); assert.equal(cards.cards[1].target, null); assert.equal(cards.cards[1].items[0].target, null); assert.equal(cards.cards[1].items[0].title, '只读内容');
  for (const value of [undefined, 'not JSON', { entities: [] }]) assert.equal(accountOverviewCards(value).invalid, true);
  assert.deepEqual(accountOverviewCards([]), { cards: [], invalid: false });
});
