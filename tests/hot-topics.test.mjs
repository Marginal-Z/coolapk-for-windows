import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, CoolapkClient } from '../core/client.mjs';
import { dispatchHome, HOME_OPERATIONS } from '../core/home.mjs';

test('hot topics dispatch uses the fixed first-page GET without guest Cookie or custom descriptors', async () => {
  const requests = [];
  const client = new CoolapkClient({ cookie: '', identity: null, fetchImpl: async (url, options) => {
    requests.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ code: 200, data: [{ entityType: 'topic', title: '模拟话题', hot_num: 12 }] }));
  } });
  assert.ok(HOME_OPERATIONS.includes('homeHotTopics'));
  const result = await client.dispatch('homeHotTopics');
  assert.deepEqual(result.data, [{ tag: '模拟话题', count: 12 }]);
  assert.equal(result.hasMore, false);
  assert.equal(requests.length, 1);
  const [{ url, options }] = requests;
  assert.equal(url.origin, 'https://api.coolapk.com');
  assert.equal(url.pathname, '/v6/page/dataList');
  assert.deepEqual(Object.fromEntries(url.searchParams), { url: 'V9_HOME_TAB_TOPIC', page: '1' });
  assert.equal(options.method, 'GET');
  assert.equal(options.body, undefined);
  assert.equal(options.headers.Cookie, undefined);
});

test('hot topics reject every caller override before requesting the fixed source', async () => {
  let requests = 0;
  const client = { request: async () => { requests++; return { data: [] }; } };
  for (const args of [null, [], 'topic', { page: 1 }, { page: 2 }, { url: 'V11_HOME_TAB_TOPIC' }, { title: '话题' }, { firstItem: 'topic_1' }, { lastItem: 'topic_2' }, { unused: true }]) {
    await assert.rejects(dispatchHome(client, 'homeHotTopics', args), { code: 'INPUT' });
  }
  assert.equal(requests, 0);
});

test('hot topics normalize only top-level topics with nonempty titles in source order, at most five', async () => {
  const result = await dispatchHome({ request: async () => ({ data: [
    null, { entityType: 'card', entities: [{ entityType: 'topic', title: '嵌套话题' }] },
    { entityType: 'feed', title: '动态' }, { entityType: 'topic', tag: '无标题' },
    { entityType: 'topic', title: '' }, { entityType: 'topic', title: '  ' }, { entityType: 'topic', title: 123 },
    ...Array.from({ length: 7 }, (_, index) => ({ entityType: 'topic', title: '  话题' + index + '  ', hot_num: index })),
  ] }) }, 'homeHotTopics');
  assert.deepEqual(result.data, Array.from({ length: 5 }, (_, index) => ({ tag: '话题' + index, count: index })));
  assert.equal(result.hasMore, false);
});

test('topic heat selects the first valid unsigned count and respects a preferred zero', async () => {
  const result = await dispatchHome({ request: async () => ({ data: [
    { entityType: 'topic', title: '热度', hot_num: ' 25000 ', commentnum: 9, comment_num: 8 },
    { entityType: 'topic', title: '零热度', hot_num: 0, commentnum: 9 },
    { entityType: 'topic', title: '评论', hot_num: -1, commentnum: '17', comment_num: 8 },
    { entityType: 'topic', title: '备用评论', hot_num: true, commentnum: 'bad', comment_num: '+8' },
    { entityType: 'topic', title: '无有效热度', hot_num: 1.5, commentnum: null, comment_num: '' },
  ] }) }, 'homeHotTopics');
  assert.deepEqual(result.data.map(topic => topic.count), [25000, 0, 17, 8, 0]);
});

test('hot topic API and verification errors propagate without fallback or extra requests', async () => {
  for (const code of ['NETWORK', 'VERIFY_REQUIRED', 'ACCOUNT_CHANGED']) {
    let requests = 0;
    const error = new ApiError('模拟读取失败', code);
    await assert.rejects(dispatchHome({ request: async () => { requests++; throw error; } }, 'homeHotTopics'), thrown => thrown === error);
    assert.equal(requests, 1);
  }
  for (const data of [undefined, null, {}, 'invalid']) {
    await assert.rejects(dispatchHome({ request: async () => ({ code: 200, data }) }, 'homeHotTopics'), { code: 'API_ERROR' });
  }
});

test('an empty fixed hot-topic source remains an explicit successful empty result', async () => {
  const requests = [];
  const result = await dispatchHome({ request: async (...args) => { requests.push(args); return { data: [], hasMore: true }; } }, 'homeHotTopics');
  assert.deepEqual(result.data, []);
  assert.equal(result.hasMore, false);
  assert.deepEqual(requests, [['/v6/page/dataList', { url: 'V9_HOME_TAB_TOPIC', page: 1 }]]);
});
