import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGoods, GOODS_CONTRACTS, GOODS_OPERATIONS, goodsLink } from '../core/goods.mjs';

const feed = () => ({ id: '101', uid: '123456', goodsListInfo: { id: '707', title: '测试清单', cover: 'https://image.coolapk.com/cover.png', is_open_vote: 1 }, goodsListItem: [{ id: '11', feed_id: '555', product_goods_id: '88', product_goods_cover: 'https://img.example-mall.test/original.jpg', note: '原推荐理由' }] });
const args = { id: '101', itemId: '11', goodsId: '88', feedId: '909', uid: '123456', title: '测试清单', message: '清单说明', keyword: '耳机', url: 'https://item.jd.com/123.html', note: '修改说明', value: 1, items: [{ item_name: '测试产品', item_id: '9' }] };
function client(overrides = {}) { const calls = [], instance = { identity: { uid: '123456' }, request: async (endpoint, query = {}, options = {}) => { calls.push({ endpoint, query, options }); if (endpoint === '/v6/feed/detail') return { data: query.id === '909' ? { id: '909', uid: '123456' } : feed() }; if (endpoint === '/v6/user/productAlbumList') return { data: [{ id: '101', title: '产品专辑', productItems: [] }], hasMore: false }; if (['/v6/goodsList/create', '/v6/productAlbum/create', '/v6/goods/addGoods', '/v6/goods/detail'].includes(endpoint)) return { data: { id: '202' } }; if (options.method === 'POST') return { data: 1 }; return { data: [] }; }, ...overrides }; return { instance, calls }; }

test('all 19 operations follow a fixed official protocol path and expected method', async () => {
  assert.equal(GOODS_OPERATIONS.length, 19);
  for (const contract of GOODS_CONTRACTS) { const { instance, calls } = client(); await dispatchGoods(instance, contract.operation, { ...args }); assert.ok(calls.every(call => /^\/v6\/[A-Za-z0-9_\/]+$/.test(call.endpoint))); const call = calls.findLast(call => call.endpoint === contract.endpoint); assert.ok(call, contract.operation); assert.equal(call.options.method || 'GET', contract.method, contract.operation); }
});
test('all mutations require login before network and creation must return a stable id', async () => {
  for (const contract of GOODS_CONTRACTS.filter(row => row.authenticated)) { const { instance, calls } = client({ identity: null }); await assert.rejects(dispatchGoods(instance, contract.operation, args), error => error.code === 'LOGIN_REQUIRED'); assert.equal(calls.length, 0); }
  for (const operation of ['goodsListCreate', 'goodsAlbumCreate', 'goodsPrepare']) { const { instance } = client({ request: async () => ({ data: {} }) }); await assert.rejects(dispatchGoods(instance, operation, args), error => error.code === 'API_ERROR'); }
});
test('search uses exact sortName/sort pairs, coupon and page; prototypes cannot masquerade as sort', async () => {
  const { instance, calls } = client(); await dispatchGoods(instance, 'goodsSearch', { keyword: '耳机', sort: 'price_desc', coupon: true, page: 3 });
  assert.deepEqual(calls[0].query, { keyword: '耳机', sortName: 'price', sort: 'desc', isCoupon: 1, page: 3 });
  await assert.rejects(dispatchGoods(instance, 'goodsSearch', { keyword: '耳机', sort: 'toString' }), error => error.code === 'INPUT'); assert.equal(calls.length, 1);
});
test('list create and edit preserve snake-case fields and distinguish feed id from list id', async () => {
  const { instance, calls } = client(); await dispatchGoods(instance, 'goodsListCreate', { title: '新清单', message: '说明', cover: 'http://image.coolapk.com/cover.png', topLimit: 3, isOpenVote: true, listType: '5', targetId: '9', targetType: 'product_phone' });
  assert.deepEqual(calls.at(-1).options.form, { title: '新清单', message: '说明', cover: 'https://image.coolapk.com/cover.png', top_limit: 3, is_open_vote: 1, list_type: '5', targetId: '9', targetType: 'product_phone' });
  await dispatchGoods(instance, 'goodsListEdit', { id: '101', title: '更新清单', message: '新说明', isOpenVote: false }); assert.equal(calls.at(-1).options.form.id, '707'); assert.equal(calls.at(-1).options.form.cover, 'https://image.coolapk.com/cover.png');
});
test('item add/edit/remove derive parent and item feed IDs from current verified ownership', async () => {
  const { instance, calls } = client(); await dispatchGoods(instance, 'goodsItemAdd', { id: '101', goodsId: '88', note: '推荐' }); assert.deepEqual(calls.at(-1).options.form, { feedId: '707', goodsId: '88', note: '推荐', pic: '' });
  await dispatchGoods(instance, 'goodsItemEdit', args); assert.deepEqual(calls.at(-1).options.form, { feedId: '555', goodsId: '88', note: '修改说明', pic: 'https://img.example-mall.test/original.jpg' });
  await dispatchGoods(instance, 'goodsItemRemove', args); assert.deepEqual(calls.at(-1).options.form, { cancelFeedId: '555', goodsId: '88' });
  const before = calls.length; await assert.rejects(dispatchGoods(instance, 'goodsItemRemove', { ...args, goodsId: 'other' })); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).endpoint, '/v6/feed/detail');
});
test('non-owner cannot edit/remove/bind and a different user feed cannot be bound', async () => {
  for (const operation of ['goodsListEdit', 'goodsItemAdd', 'goodsItemEdit', 'goodsItemRemove', 'goodsListBind']) { const { instance, calls } = client({ request: async endpoint => { calls.push({ endpoint }); return { data: { ...feed(), uid: '654321' } }; } }); await assert.rejects(dispatchGoods(instance, operation, args), error => error.code === 'FORBIDDEN'); assert.equal(calls.length, 1); }
  const { instance, calls } = client(); const base = instance.request; instance.request = async (...parameters) => { const result = await base(...parameters); if (parameters[0] === '/v6/feed/detail' && parameters[1].id === '909') result.data.uid = '654321'; return result; };
  await assert.rejects(dispatchGoods(instance, 'goodsListBind', args), error => error.code === 'FORBIDDEN'); assert.equal(calls.length, 2);
});
test('vote uses list id + entry id with 1/-1, and binding rechecks both owned feed IDs', async () => {
  const { instance, calls } = client(); await dispatchGoods(instance, 'goodsItemVote', { ...args, value: -1 }); assert.deepEqual(calls.at(-1).options.form, { id: '707', item_id: '11', value: -1 });
  await dispatchGoods(instance, 'goodsListBind', args); assert.deepEqual(calls.at(-1).options.form, { feedId: '909', goodsListId: '707' });
  await assert.rejects(dispatchGoods(instance, 'goodsItemVote', { ...args, value: 0 }), error => error.code === 'INPUT');
});
test('product album create serializes every indexed field in display order', async () => {
  const { instance, calls } = client(); await dispatchGoods(instance, 'goodsAlbumCreate', { title: '旅行装备', description: '说明', items: [{ id: '', level: '2', item_id: '7', item_name: '相机', item_description: '轻便', item_logo: 'http://image.coolapk.com/a.png', item_images: 'https://image.coolapk.com/b.png', display_order: 99 }] });
  assert.deepEqual(calls.at(-1).options.form, { title: '旅行装备', description: '说明', album_type: 0, targetType: '', targetId: '', 'productItems[0][id]': '', 'productItems[0][level]': '2', 'productItems[0][item_id]': '7', 'productItems[0][item_logo]': 'https://image.coolapk.com/a.png', 'productItems[0][item_name]': '相机', 'productItems[0][item_description]': '轻便', 'productItems[0][item_images]': 'https://image.coolapk.com/b.png', 'productItems[0][display_order]': 0 });
});
test('album detail searches bounded owner pages without using unrelated goodsList/list fallback', async () => {
  const { instance, calls } = client({ request: async (endpoint, query) => { calls.push({ endpoint, query }); return { data: query.page === 1 ? [{ id: '1' }] : [{ id: '2', productItems: [{ item_name: '产品' }] }], hasMore: query.page === 1 }; } });
  const result = await dispatchGoods(instance, 'goodsAlbum', { id: '2', uid: '123456' }); assert.equal(result.data.id, '2'); assert.equal(calls.length, 2); assert.ok(calls.every(call => call.endpoint === '/v6/user/productAlbumList'));
  await assert.rejects(dispatchGoods(instance, 'goodsAlbum', { id: '3', uid: '123456' }), error => error.code === 'API_ERROR');
});
test('invalid urls/images/envelopes remain failures and unknown deletes are absent', async () => {
  for (const value of ['file:///x', 'https://user:pass@item.jd.com/x', 'http://127.0.0.1/x', 'http://172.16.0.1/x', 'https://item.jd.com:123/x']) assert.throws(() => goodsLink(value));
  const { instance, calls } = client(); await assert.rejects(dispatchGoods(instance, 'goodsListCreate', { title: 'x', cover: 'https://evil.test/x.png' })); assert.equal(calls.length, 0);
  instance.request = async () => ({ data: {} }); await assert.rejects(dispatchGoods(instance, 'goodsLists', {}), error => error.code === 'API_ERROR');
  assert.equal(await dispatchGoods(instance, 'goodsAlbumDelete', {}), undefined); assert.equal(await dispatchGoods(instance, 'goodsListDelete', {}), undefined);
});
