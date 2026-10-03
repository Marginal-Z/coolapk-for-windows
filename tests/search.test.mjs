import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchSearch, searchRows } from '../core/search.mjs';
import { suggestionSelection } from '../src/search-targets.ts';
function mock(data = []) {
  const calls = [];
  const client = new CoolapkClient({ fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } }); } });
  return { calls, client, run: (op, args) => dispatchSearch(client, op, args) };
}

test('suggestions remain available to guests, skip empty query and preserve exact app/general query fields', async () => {
  const { run, calls } = mock([{ title: '搜索用户 测试', url: 'searchTab://user?keyword=%E6%B5%8B%E8%AF%95' }]);
  assert.deepEqual(await run('searchSuggestions', { query: '   ' }), { data: [] }); assert.equal(calls.length, 0);
  await run('searchSuggestions', { query: ' 测试 ', type: 'private', endpoint: '/v6/account/delete' });
  await run('searchSuggestionsApp', { query: '测试' });
  assert.equal(calls[0].url.pathname, '/v6/search/suggestSearchWordsNew'); assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { searchValue: '测试' });
  assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), { searchValue: '测试', type: 'app' }); assert.ok(calls.every(call => call.init.method === 'GET'));
  assert.equal(await run('otherSearch', { query: '测试' }), undefined);
});

test('invalid search arguments reject without networking', async () => {
  const { run, calls } = mock();
  for (const args of [null, [], { query: 1 }, { query: 'a'.repeat(201) }, { query: 'a\nb' }, { query: 'a\0b' }]) await assert.rejects(run('searchSuggestions', args), e => e.code === 'INPUT');
  for (const args of [{ page: 0 }, { page: 1001 }, { recentIds: '1,1' }, { recentIds: 'abc' }, { recentIds: '1,' }, { recentIds: [] }, { recentIds: Array.from({ length: 31 }, (_, i) => i + 1).join(',') }]) await assert.rejects(run('searchPublishTopics', args), e => e.code === 'INPUT');
  assert.equal(calls.length, 0);
});

test('known suggestion envelopes flatten nested entities, deduplicate and omit raw credentials/sponsor rows', async () => {
  const row = { id: 7, entityType: 'searchSuggestion', title: '酷友 测试', url: 'searchTab://user?keyword=test', cookie: 'synthetic-private-cookie', token: 'synthetic-private-token', identity: { uid: 'synthetic-private-id' } };
  const raw = { entities: [{ entityType: 'card', entities: [row, row, { title: '广告', entityType: 'sponsor' }, { title: '广告2', sponsorType: 3 }, { title: '应用', entityType: 'apk', id: 8, sponsorType: 0 }] }] };
  const result = await mock(raw).run('searchSuggestions', { query: 'test' });
  assert.equal(result.data.length, 2); assert.equal(result.data[0].url, row.url); assert.equal(result.hasMore, false); assert.ok(!JSON.stringify(result).includes('synthetic-private'));
  for (const key of ['list', 'rows', 'items', 'data']) assert.equal(searchRows({ [key]: [row] }).length, 1);
  assert.throws(() => searchRows({ unknown: [] }), e => e.code === 'API_ERROR');
  await assert.rejects(mock(null).run('searchSuggestions', { query: 'test' }), e => e.code === 'API_ERROR');
  const many = await mock(Array.from({ length: 25 }, (_, i) => ({ title: '建议 ' + i }))).run('searchSuggestions', { query: 'test' }); assert.equal(many.data.length, 20);
});

test('publishing topics use official searchTag with empty hot/recent query and only valid topic candidates', async () => {
  const { run, calls } = mock([{ entityType: 'card', entities: [{ id: 7, entityType: 'feedTopic', title: '#测试话题#', token: 'synthetic-private' }, { id: 7, tag: '测试话题' }, { id: 8, entityType: 'tag', tag: '#新话题#' }, { id: 9, entityType: 'feed', title: '非话题' }, { id: 'invalid', title: '坏编号' }, { id: 10, title: '#' }] }]);
  const result = await run('searchPublishTopics', { query: '', page: 2, recentIds: '7,8', type: 'invented' });
  assert.equal(calls[0].url.pathname, '/v6/feed/searchTag'); assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { q: '', page: '2', recentIds: '7,8' });
  assert.deepEqual(result.data.map(row => [row.id, row.title, row.entityType]), [['7', '测试话题', 'topic'], ['8', '新话题', 'topic']]); assert.ok(!JSON.stringify(result).includes('synthetic-private')); assert.equal(result.hasMore, true);
  assert.equal((await mock([]).run('searchPublishTopics')).hasMore, false);
});

test('searchTab selections honor keyword/category instead of the visible descriptive label', () => {
  assert.deepEqual(suggestionSelection({ title: '搜索用户名 酷友', url: 'searchTab://user?keyword=%E9%85%B7%E5%8F%8B' }), { kind: 'search', query: '酷友', type: 'user' });
  assert.deepEqual(suggestionSelection({ title: '搜索应用', actionUrl: 'searchTab://app?keyword=example' }), { kind: 'search', query: 'example', type: 'apk' });
  for (const [host, type] of [['feedTopic', 'feedTopic'], ['topic', 'feedTopic'], ['dyhMix', 'dyhMix'], ['dyh', 'dyhMix'], ['ask', 'ask'], ['album', 'album'], ['goods', 'goods'], ['goods_list', 'goods_list']]) assert.deepEqual(suggestionSelection({ title: '类别建议', url: `searchTab://${host}?keyword=test` }), { kind: 'search', query: 'test', type });
  for (const url of ['searchTab://delete?keyword=bad', 'searchTab://user?keyword=', 'searchTab://user?keyword=a%0Ab']) assert.deepEqual(suggestionSelection({ title: 'fallback', url }), { kind: 'search', query: 'fallback', type: 'all' });
});

test('suggestion entity/link dispatch accepts known entities and safe links, with no direct external side effects', () => {
  const entity = { entityType: 'apk', id: 7, packageName: 'com.example' }; assert.deepEqual(suggestionSelection(entity), { kind: 'entity', entity });
  assert.deepEqual(suggestionSelection({ title: '主页', url: '/u/123456' }), { kind: 'link', url: 'https://www.coolapk.com/u/123456' });
  assert.deepEqual(suggestionSelection({ title: '外链', url: 'https://example.org/page' }), { kind: 'link', url: 'https://example.org/page' });
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://name:secret@example.org/']) assert.deepEqual(suggestionSelection({ title: '正常词', url }), { kind: 'search', query: '正常词', type: 'all' });
});
