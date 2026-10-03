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

test('all read columns reject invalid paging and cursor inputs before making any request', async () => {
  let requests = 0; const client = { request: async () => { requests++; return { data: [] }; } };
  for (const operation of ['homeHeadline', 'homeUpdates', 'homeEditorChoice', 'homeNews', 'homeDigest']) {
    for (const args of [{ page: 0 }, { page: 1.5 }, { page: 1001 }, { page: true }, { page: ' 1' }, { firstItem: 'x\n' }, { lastItem: 'x'.repeat(121) }, { firstItem: {} }]) await assert.rejects(dispatchHome(client, operation, args), { code: 'INPUT' });
  }
  assert.equal(requests, 0);
});

test('news/digest API errors and invalid structures never change to another feed source', async () => {
  for (const operation of ['homeNews', 'homeDigest']) {
    let requests = 0;
    await assert.rejects(dispatchHome({ request: async () => { requests++; throw Object.assign(new Error('network failed'), { code: 'NETWORK' }); } }, operation), { code: 'NETWORK' }); assert.equal(requests, 1);
    await assert.rejects(dispatchHome({ request: async () => ({ data: {} }) }, operation), { code: 'API_ERROR' });
    const empty = await dispatchHome({ request: async () => ({ data: [] }) }, operation); assert.equal(empty.hasMore, false);
  }
});
