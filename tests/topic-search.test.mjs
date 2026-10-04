import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, CoolapkClient } from '../core/client.mjs';
import { COMMUNITY_OPERATIONS, dispatchCommunity } from '../core/community.mjs';

function mock(data = [{ entityType: 'feed', id: '101', entityId: 'cursor-101' }]) {
  const calls = [];
  return { calls, client: { identity: null, request: async (path, query) => { calls.push({ path, query }); return { data }; } } };
}
const initial = { tag: '手机摄影', query: '样张' };

test('guest topic search has a fixed read-only route and current tag scope', async () => {
  assert.ok(COMMUNITY_OPERATIONS.includes('topicSearch'));
  const { client, calls } = mock();
  await dispatchCommunity(client, 'topicSearch', { tag: ' 手机摄影 ', query: ' 样张 ' });
  assert.deepEqual(calls, [{ path: '/v6/search', query: { type: 'feed', searchValue: '样张', page: 1, pageType: 'tag', pageParam: '手机摄影', feedType: 'all', isStrict: 0, showAnonymous: -1, sort: 'none' } }]);
});

test('all five reference sort choices send exact search sort and strictness', async () => {
  for (const [sort, wireSort, isStrict] of [['default', 'none', 0], ['latest', 'dateline', 0], ['hot', 'hot', 0], ['comment', 'reply', 0], ['accurate', undefined, 1]]) {
    const { client, calls } = mock();
    await dispatchCommunity(client, 'topicSearch', { ...initial, sort });
    assert.equal(calls[0].query.sort, wireSort);
    assert.equal(Object.hasOwn(calls[0].query, 'sort'), wireSort !== undefined);
    assert.equal(calls[0].query.isStrict, isStrict);
  }
});

test('ten topic content types are case-sensitive and never broaden to global search', async () => {
  for (const feedType of ['all', 'feed', 'feedArticle', 'picture', 'question', 'answer', 'comment', 'video', 'ershou', 'vote']) {
    const { client, calls } = mock();
    await dispatchCommunity(client, 'topicSearch', { ...initial, feedType });
    assert.equal(calls[0].query.feedType, feedType);
    assert.equal(calls[0].query.pageType, 'tag');
    assert.equal(calls[0].query.pageParam, initial.tag);
  }
});

test('pagination preserves opaque entity cursors and unknown rows without granting a type', async () => {
  const unknown = { entityType: 'unrecognized', id: '901', message: 'synthetic', feedType: 'feed' };
  const { client, calls } = mock([{ entityType: 'card', entities: [{ entityType: 'feed', id: '101', entityId: 'head-a' }, unknown] }]);
  const result = await dispatchCommunity(client, 'topicSearch', { ...initial, page: 2, firstItem: ' head-a ', lastItem: 'tail-b', pageContext: 'opaque-context' });
  assert.deepEqual(calls[0].query, { type: 'feed', searchValue: '样张', page: 2, pageType: 'tag', pageParam: '手机摄影', feedType: 'all', isStrict: 0, showAnonymous: -1, sort: 'none', firstItem: 'head-a', lastItem: 'tail-b', pageContext: 'opaque-context' });
  assert.equal(result.firstItem, 'head-a'); assert.equal(result.lastItem, '901');
  assert.deepEqual(result.data[1], unknown);
});

test('scope overrides, unknown options and invalid inputs fail before any request', async () => {
  const invalid = [
    { type: 'user' }, { pageType: 'search' }, { pageParam: '另一个话题' }, { isStrict: 1 }, { url: '/v6/feed/deleteFeed' }, { extra: true },
    { sort: 'dateline' }, { sort: 'toString' }, { sort: null }, { feedType: 'rating' }, { feedType: 'goods' }, { feedType: 'feedarticle' }, { feedType: null },
    { tag: '' }, { tag: ' '.repeat(4) }, { tag: 42 }, { tag: 'x'.repeat(201) }, { tag: 'bad\ninput' },
    { query: '' }, { query: {} }, { query: 'x'.repeat(201) }, { query: 'bad\0input' },
    { page: 0 }, { page: 1001 }, { page: 1.5 }, { page: '2' }, { page: NaN },
    { firstItem: {} }, { lastItem: 42 }, { firstItem: 'x'.repeat(161) }, { lastItem: 'bad\ninput' }, { pageContext: [] }, { pageContext: 'x'.repeat(2001) },
  ];
  for (const args of invalid) {
    const { client, calls } = mock();
    await assert.rejects(dispatchCommunity(client, 'topicSearch', { ...initial, ...args }), error => error.code === 'INPUT');
    assert.equal(calls.length, 0);
  }
});

test('network and verification failures propagate without fallback or empty success', async () => {
  for (const code of ['NETWORK', 'VERIFY_REQUIRED']) {
    let calls = 0; const error = new ApiError('synthetic failure', code);
    const client = { identity: null, request: async () => { calls++; throw error; } };
    await assert.rejects(dispatchCommunity(client, 'topicSearch', initial), rejected => rejected === error);
    assert.equal(calls, 1);
  }
  const { client } = mock({ unrelated: [] });
  await assert.rejects(dispatchCommunity(client, 'topicSearch', initial), error => error.code === 'API_ERROR');
});

test('client dispatch recognizes topicSearch without login or an actual network request', async () => {
  const client = new CoolapkClient({ identity: null, fetchImpl: () => { throw new Error('network must stay unused'); } });
  const calls = []; client.request = async (path, query) => { calls.push({ path, query }); return { data: [], hasMore: false }; };
  const result = await client.dispatch('topicSearch', initial);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v6/search');
  assert.equal(calls[0].query.pageParam, initial.tag); assert.deepEqual(result.data, []); assert.equal(result.hasMore, false);
});
