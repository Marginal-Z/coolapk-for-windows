import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_DISCOVERY_OPERATIONS, dispatchAppDiscovery } from '../core/app-discovery.mjs';

function fixture(result = { data: [], hasMore: false }) {
  const calls = [], client = { identity: null, request: async (...args) => { calls.push(args); return result; } };
  return { calls, client };
}
test('app discovery preserves the distinct rank and newest page contracts', async () => {
  for (const [category, url] of [['recommend', '#/apk/rankList'], ['newest', '#/apk/newestList']]) {
    const { client, calls } = fixture();
    await dispatchAppDiscovery(client, 'appDiscovery', { category, page: 2, firstItem: 'rank:head', lastItem: 'rank:tail' });
    assert.deepEqual(calls, [['/v6/page/dataList', { page: 2, firstItem: 'rank:head', lastItem: 'rank:tail', url }]]);
  }
});
test('app category searches use only the four confirmed words and APK search type', async () => {
  for (const [category, searchValue] of [['tools', '系统工具'], ['social', '社交聊天'], ['media', '影音播放'], ['beauty', '主题美化']]) {
    const { client, calls } = fixture(); await dispatchAppDiscovery(client, 'appDiscovery', { category });
    assert.deepEqual(calls, [['/v6/search', { page: 1, type: 'apk', searchValue, show_flag: 1 }]]);
  }
});
test('game category searches use the six exact reference words', async () => {
  for (const [category, searchValue] of [['hot', '手游'], ['new', '新游戏'], ['single', '单机游戏'], ['online', '网游'], ['casual', '休闲游戏'], ['indie', '独立游戏']]) {
    const { client, calls } = fixture(); await dispatchAppDiscovery(client, 'gameDiscovery', { category, page: '3', lastItem: 'game-tail' });
    assert.deepEqual(calls, [['/v6/search', { page: 3, lastItem: 'game-tail', type: 'game', searchValue, show_flag: 1 }]]);
  }
});
test('unknown operations are not dispatched and defaults need no logged-in identity', async () => {
  const { client, calls } = fixture(); assert.deepEqual(APP_DISCOVERY_OPERATIONS, ['appDiscovery', 'gameDiscovery']);
  assert.equal(await dispatchAppDiscovery(client, 'unknown', {}), undefined); assert.equal(calls.length, 0);
  await dispatchAppDiscovery(client, 'appDiscovery'); await dispatchAppDiscovery(client, 'gameDiscovery');
  assert.equal(calls[0][1].url, '#/apk/rankList'); assert.equal(calls[1][1].searchValue, '手游');
});
test('bad options, page types and cursor injection fail before requesting', async () => {
  const { client, calls } = fixture();
  for (const args of [null, [], true, new Date(), { category: 'all' }, { category: false }, { category: 'hot' }, { query: '自定义词' }, { url: '/v6/user/profile' }, ...[0, -1, 1001, 1.5, true, '', '01', '1e2', NaN, Infinity, {}].map(page => ({ page })), { firstItem: 123 }, { lastItem: '\rprivate-header' }, { firstItem: 'x'.repeat(121) }]) await assert.rejects(dispatchAppDiscovery(client, 'appDiscovery', args), error => error.code === 'INPUT');
  for (const category of ['recommend', 'unknown', true]) await assert.rejects(dispatchAppDiscovery(client, 'gameDiscovery', { category }), error => error.code === 'INPUT');
  assert.equal(calls.length, 0);
});
test('APK cards normalize confirmed aliases without invented ratings or wrong entity navigation', async () => {
  const { client } = fixture({ data: [{ entityType: 'card', entities: [
    { entityType: 'apk', id: 7, title: '工具', package_name: 'com.example.tool', apkRomIcon: 'icons/tool.png', apktype: 1, subTitle: '说明' },
    { entityType: 'feed', id: 8, title: '应用讨论', message: '不是应用' },
    { entityType: 'apk', id: 9, title: '游戏', packageName: 'com.example.game', apktype: 2 },
    { entityType: 'apk', id: 10, title: '不合法', packageName: 'javascript:alert(1)' },
  ] }], firstItem: 'opaque:first', lastItem: 'opaque:last', hasMore: true });
  const result = await dispatchAppDiscovery(client, 'appDiscovery');
  assert.equal(result.data.length, 2); const app = result.data[0];
  assert.equal(app.entityType, 'apk'); assert.equal(app.packageName, 'com.example.tool'); assert.equal(app.logo, 'https://image.coolapk.com/icons/tool.png'); assert.equal(app.description, '说明'); assert.equal(app.rating, undefined);
  assert.equal(result.data[1].packageName, '10'); // Numeric APK IDs are supported by the existing app detail contract.
  assert.equal(result.firstItem, 'opaque:first'); assert.equal(result.lastItem, 'opaque:last'); assert.equal(result.hasMore, true);
});
test('game transport excludes obvious helper utilities while preserving server game entities', async () => {
  const { client } = fixture({ data: [
    { entityType: 'apk', id: 1, title: '游戏助手', packageName: 'com.example.helper' },
    { entityType: 'apk', id: 2, title: '单机样本', packageName: 'com.example.single', apkTypeName: '游戏', score: '8.7' },
    { entityType: 'ad', id: 3, title: '广告', packageName: 'com.example.ad' },
  ] });
  const result = await dispatchAppDiscovery(client, 'gameDiscovery'); assert.deepEqual(result.data.map(item => item.packageName), ['com.example.single']); assert.equal(result.data[0].rating, '8.7');
});
test('fallback cursor follows the raw last entity even when it is filtered out', async () => {
  const { client } = fixture({ data: [{ entityType: 'card', entities: [{ entityType: 'apk', id: 1, title: '工具', packageName: 'com.example.tool' }, { entityType: 'apk', id: 2, title: '游戏', packageName: 'com.example.game', apktype: 2 }] }] });
  const result = await dispatchAppDiscovery(client, 'appDiscovery'); assert.equal(result.data.length, 1); assert.equal(result.firstItem, '1'); assert.equal(result.lastItem, '2'); assert.equal(result.hasMore, true);
});
test('empty success remains distinct from malformed responses and invalid server cursors', async () => {
  assert.deepEqual((await dispatchAppDiscovery(fixture({ data: [], hasMore: false }).client, 'appDiscovery')).data, []);
  assert.equal((await dispatchAppDiscovery(fixture({ data: [], firstItem: 12, lastItem: 23 }).client, 'appDiscovery')).lastItem, '23');
  for (const result of [{}, { data: null }, { data: {} }, { data: [], hasMore: 'false' }, { data: [], firstItem: true }, { data: [], lastItem: 'a\nb' }]) await assert.rejects(dispatchAppDiscovery(fixture(result).client, 'appDiscovery'), error => error.code === 'API_ERROR');
});
test('rank captcha and network failures propagate without silently searching instead', async () => {
  for (const code of ['VERIFY_REQUIRED', 'NETWORK', 'ACCOUNT_CHANGED']) {
    const calls = [], failure = Object.assign(new Error('synthetic'), { code });
    await assert.rejects(dispatchAppDiscovery({ request: async (...args) => { calls.push(args); throw failure; } }, 'appDiscovery', { category: 'newest' }), error => error === failure);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], '/v6/page/dataList');
  }
});
