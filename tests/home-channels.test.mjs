import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchHome } from '../core/home.mjs';
test('headline, update and editor selection use their fixed read endpoints and reject bad list responses', async () => {
  const paths = []; const client = { request: async (path, args) => { paths.push(path); return { data: [{ entityType: 'feed', id: 1 }], hasMore: false }; } };
  for (const operation of ['homeHeadline', 'homeUpdates', 'homeEditorChoice']) assert.equal((await dispatchHome(client, operation)).data[0].id, 1);
  assert.deepEqual(paths, ['/v6/main/headline', '/v6/main/updateList', '/v6/feed/editorChoiceList']);
  await assert.rejects(dispatchHome({ request: async () => ({ data: {} }) }, 'homeHeadline'), { code: 'API_ERROR' });
});
test('cloud tab settings follow official field names and preserve order and hidden state', async () => {
  let request; const client = { identity: { uid: '42' }, request: async (...args) => { request = args; return { data: true }; } };
  await dispatchHome(client, 'homeTabConfig', { tabs: [{ id: '2', title: '关注', page_visibility: '1' }, { id: '1', title: '话题', page_visibility: '0' }] });
  assert.equal(request[0], '/v6/account/updateConfig'); assert.equal(request[2].method, 'POST'); assert.deepEqual(JSON.parse(request[2].form.home_tab_config).map(item => [item.id, item.page_visibility]), [['2', '1'], ['1', '0']]);
});
test('guests, duplicate IDs, invalid visibility and wholly hidden configs make no write request', async () => {
  let writes = 0; const request = async () => { writes++; };
  await assert.rejects(dispatchHome({ request }, 'homeTabConfig', { tabs: [] }), { code: 'LOGIN_REQUIRED' });
  for (const tabs of [[], [{ id: '1', title: '头条', page_visibility: '9' }], [{ id: '1', title: '头条', page_visibility: '0' }], [{ id: '1', title: '头条', page_visibility: '1' }, { id: '1', title: '头条', page_visibility: '1' }]]) await assert.rejects(dispatchHome({ identity: { uid: '42' }, request }, 'homeTabConfig', { tabs }), { code: 'INPUT' });
  assert.equal(writes, 0);
});

test('news and community digest keep their exact descriptors, title and item cursors', async () => {
  const requests = [], client = { request: async (path, args) => { requests.push({ path, args }); return { data: [{ entityType: 'feed', id: 7 }], firstItem: 'original-first', lastItem: 'original-last', hasMore: false }; } };
  for (const operation of ['homeNews', 'homeDigest']) {
    const result = await dispatchHome(client, operation, { page: 3, firstItem: 'first', lastItem: 'last' });
    assert.equal(result.firstItem, 'original-first'); assert.equal(result.lastItem, 'original-last'); assert.equal(result.hasMore, false);
  }
  assert.deepEqual(requests, [
    { path: '/v6/page/dataList', args: { page: 3, firstItem: 'first', lastItem: 'last', url: 'V11_HOME_TAB_NEWS', title: '快讯' } },
    { path: '/v6/page/dataList', args: { page: 3, firstItem: 'first', lastItem: 'last', url: '#/feed/digestList', title: '精选' } },
  ]);
});
test('快讯 falls back through the two APK-confirmed descriptors on an empty or failed source', async () => {
  const calls = [], client = { request: async (path, args) => {
    calls.push({ path, args });
    if (calls.length < 3) return { data: [] };
    return { data: [{ entityType: 'feed', id: 21 }], hasMore: false };
  } };
  const result = await dispatchHome(client, 'homeNews', { page: 2, firstItem: 'cursor-a', lastItem: 'cursor-b' });
  assert.equal(result.data[0].id, 21);
  assert.deepEqual(calls.map(({ args }) => args.url), ['V11_HOME_TAB_NEWS', '#/feed/digestList?type=1', '#/feed/newestList']);
  assert.equal(calls[0].args.title, '快讯'); assert.equal(calls[1].args.title, '快讯'); assert.equal(calls[2].args.title, undefined);
  assert.ok(calls.every(({ args }) => args.page === 2 && args.firstItem === 'cursor-a' && args.lastItem === 'cursor-b'));

  const failed = [], networkFallback = { request: async (path, args) => {
    failed.push(args.url);
    if (failed.length === 1) throw Object.assign(new Error('network unavailable'), { code: 'NETWORK' });
    return { data: [{ entityType: 'feed', id: 22 }] };
  } };
  assert.equal((await dispatchHome(networkFallback, 'homeNews')).data[0].id, 22);
  assert.deepEqual(failed, ['V11_HOME_TAB_NEWS', '#/feed/digestList?type=1']);
});
test('快讯 does not use fallback routes to bypass login or official verification challenges', async () => {
  for (const code of ['LOGIN_REQUIRED', 'VERIFY_REQUIRED']) {
    const urls = [], client = { request: async (path, args) => { urls.push(args.url); throw Object.assign(new Error('official challenge'), { code }); } };
    await assert.rejects(dispatchHome(client, 'homeNews'), { code });
    assert.deepEqual(urls, ['V11_HOME_TAB_NEWS']);
  }
});

test('all read columns reject invalid paging and cursor inputs before making any request', async () => {
  let requests = 0; const client = { request: async () => { requests++; return { data: [] }; } };
  for (const operation of ['homeHeadline', 'homeUpdates', 'homeEditorChoice', 'homeNews', 'homeDigest']) {
    for (const args of [{ page: 0 }, { page: 1.5 }, { page: 1001 }, { page: true }, { page: ' 1' }, { firstItem: 'x\n' }, { lastItem: 'x'.repeat(121) }, { firstItem: {} }]) await assert.rejects(dispatchHome(client, operation, args), { code: 'INPUT' });
  }
  assert.equal(requests, 0);
});

test('news exhaustion exposes the final route error, while digest remains a single exact route', async () => {
  let requests = 0;
  await assert.rejects(dispatchHome({ request: async () => { requests++; throw Object.assign(new Error('network failed'), { code: 'NETWORK' }); } }, 'homeNews'), { code: 'NETWORK' }); assert.equal(requests, 3);
  await assert.rejects(dispatchHome({ request: async () => ({ data: {} }) }, 'homeNews'), { code: 'API_ERROR' });
  const empty = await dispatchHome({ request: async () => ({ data: [] }) }, 'homeNews'); assert.equal(empty.hasMore, false);

  let digestRequests = 0;
  await assert.rejects(dispatchHome({ request: async () => { digestRequests++; throw Object.assign(new Error('network failed'), { code: 'NETWORK' }); } }, 'homeDigest'), { code: 'NETWORK' }); assert.equal(digestRequests, 1);
  await assert.rejects(dispatchHome({ request: async () => ({ data: {} }) }, 'homeDigest'), { code: 'API_ERROR' });
  assert.equal((await dispatchHome({ request: async () => ({ data: [] }) }, 'homeDigest')).hasMore, false);
});
