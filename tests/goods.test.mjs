import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGoods, GOODS_CONTRACTS, GOODS_OPERATIONS, goodsLink } from '../core/goods.mjs';

const feed = () => ({ id: '101', uid: '123456', goodsListInfo: { id: '707', title: '测试清单', cover: 'https://image.coolapk.com/cover.png', is_open_vote: 1 }, goodsListItem: [{ id: '11', feed_id: '555', product_goods_id: '88', product_goods_cover: 'https://img.example-mall.test/original.jpg', note: '原推荐理由' }] });
const album = () => ({ id: '303', uid: '123456', feedType: 'productAlbum', message_title: '产品清单', message: '原说明', productAlbumType: '1', enableModify: 1, status: 1, tid: '', ttype: '', productAlbumDetailInfo: [{ id: '301', album_id: '303', level: '1', item_id: '9', item_name: '测试产品', item_description: '旧推荐理由', item_logo: 'https://legacy.example.test/product.png', item_images: 'https://legacy.example.test/photo.jpg', display_order: 0 }] });
const args = { id: '101', itemId: '11', goodsId: '88', feedId: '909', uid: '123456', title: '测试清单', message: '清单说明', keyword: '耳机', url: 'https://item.jd.com/123.html', note: '修改说明', value: 1, items: [{ item_name: '测试产品', item_id: '9' }] };
function client(overrides = {}) { const calls = [], instance = { identity: { uid: '123456' }, request: async (endpoint, query = {}, options = {}) => { calls.push({ endpoint, query, options }); if (endpoint === '/v6/feed/detail') return { data: query.id === '303' ? album() : query.id === '909' ? { id: '909', uid: '123456' } : feed() }; if (endpoint === '/v6/user/productAlbumList') return { data: [{ id: '303', title: '产品专辑' }], hasMore: false }; if (endpoint === '/v6/productAlbum/edit') return { data: { id: '303' } }; if (['/v6/goodsList/create', '/v6/productAlbum/create', '/v6/goods/addGoods', '/v6/goods/detail'].includes(endpoint)) return { data: { id: '202' } }; if (options.method === 'POST') return { data: 1 }; return { data: [] }; }, ...overrides }; return { instance, calls }; }
const editArgs = () => ({ id: '303', title: '修改清单', description: '新说明', expectedItemIds: ['301'], items: [{ id: '301', level: '1', item_id: '9', item_name: '测试产品', item_description: '新推荐理由', item_logo: 'https://legacy.example.test/product.png', item_images: 'https://legacy.example.test/photo.jpg' }] });

test('all 21 operations follow a fixed official protocol path and expected method', async () => {
  assert.equal(GOODS_OPERATIONS.length, 21);
  for (const contract of GOODS_CONTRACTS) { const { instance, calls } = client(); const input = contract.operation === 'goodsAlbum' ? { id: '303', uid: '123456' } : contract.operation === 'goodsAlbumEdit' ? editArgs() : contract.operation === 'goodsAlbumDelete' ? { id: '303' } : { ...args }; await dispatchGoods(instance, contract.operation, input); assert.ok(calls.every(call => /^\/v6\/[A-Za-z0-9_\/]+$/.test(call.endpoint))); const call = calls.findLast(call => call.endpoint === contract.endpoint); assert.ok(call, contract.operation); assert.equal(call.options.method || 'GET', contract.method, contract.operation); }
});
test('all mutations require login before network and creation must return a stable id', async () => {
  for (const contract of GOODS_CONTRACTS.filter(row => row.authenticated)) { const { instance, calls } = client({ identity: null }); await assert.rejects(dispatchGoods(instance, contract.operation, args), error => error.code === 'LOGIN_REQUIRED'); assert.equal(calls.length, 0); }
  for (const operation of ['goodsListCreate', 'goodsAlbumCreate', 'goodsPrepare']) { const { instance } = client({ request: async () => ({ data: {} }) }); await assert.rejects(dispatchGoods(instance, operation, args), error => error.code === (operation === 'goodsPrepare' ? 'API_ERROR' : 'WRITE_UNCONFIRMED')); }
});
test('creation responses lost in transport or parsing stay unconfirmed without replaying writes', async () => {
  for (const operation of ['goodsListCreate', 'goodsAlbumCreate']) for (const failure of [Object.assign(new Error('network lost'), { code: 'NETWORK' }), Object.assign(new Error('HTTP 567'), { code: 'HTTP' }), Object.assign(new Error('non-JSON security page'), { code: 'VERIFY_REQUIRED', detail: { responseInvalid: true } }), Object.assign(new Error('invalid JSON envelope'), { code: 'API_ERROR', detail: { responseInvalid: true } }), new Error('unexpected transport failure'), null]) {
    let count = 0; const { instance } = client({ request: async () => { count++; throw failure; } });
    await assert.rejects(dispatchGoods(instance, operation, args), error => error.code === 'WRITE_UNCONFIRMED'); assert.equal(count, 1);
  }
  for (const operation of ['goodsListCreate', 'goodsAlbumCreate']) for (const result of [null, {}, { data: {} }, { data: 0 }, { data: { id: 'unknown' } }]) {
    let count = 0; const { instance } = client({ request: async () => { count++; return result; } });
    await assert.rejects(dispatchGoods(instance, operation, args), error => error.code === 'WRITE_UNCONFIRMED'); assert.equal(count, 1);
  }
});
test('creation keeps confirmed server rejections and account or verification failures distinct', async () => {
  for (const operation of ['goodsListCreate', 'goodsAlbumCreate']) for (const [code, detail] of [['API_ERROR', { serverStatus: -1 }], ['VERIFY_REQUIRED', { challenge: { url: 'https://www.coolapk.com/account/verify' } }], ['LOGIN_REQUIRED', {}], ['ACCOUNT_CHANGED', {}], ['FORBIDDEN', {}]]) {
    const failure = Object.assign(new Error('explicit rejection'), { code, detail }); let count = 0; const { instance } = client({ request: async () => { count++; throw failure; } });
    await assert.rejects(dispatchGoods(instance, operation, args), error => error === failure); assert.equal(count, 1);
  }
  const { instance, calls } = client(); instance.request = async (endpoint, query, options) => { calls.push({ endpoint, query, options }); if (calls.length === 1) throw Object.assign(new Error('explicit verification'), { code: 'VERIFY_REQUIRED' }); return { data: { id: '202' } }; };
  await assert.rejects(dispatchGoods(instance, 'goodsAlbumCreate', args), error => error.code === 'VERIFY_REQUIRED'); const result = await dispatchGoods(instance, 'goodsAlbumCreate', args); assert.equal(result.createdId, '202'); assert.deepEqual(calls[1], calls[0]);
});
test('creation validates drafts before submission and edit/delete retain their existing failure codes', async () => {
  for (const [operation, input] of [['goodsListCreate', { title: '' }], ['goodsListCreate', { title: 'x', cover: 'https://evil.test/x.png' }], ['goodsAlbumCreate', { title: 'x', items: [{ item_name: '' }] }], ['goodsAlbumCreate', { title: 'x', description: 'x'.repeat(201) }]]) {
    const { instance, calls } = client(); await assert.rejects(dispatchGoods(instance, operation, input), error => error.code === 'INPUT'); assert.equal(calls.length, 0);
  }
  for (const operation of ['goodsAlbumEdit', 'goodsAlbumDelete']) { const { instance } = client(); const base = instance.request; instance.request = async (...parameters) => { if (parameters[0] === '/v6/feed/detail') return base(...parameters); throw Object.assign(new Error('existing mutation failure'), { code: 'NETWORK' }); }; await assert.rejects(dispatchGoods(instance, operation, operation === 'goodsAlbumEdit' ? editArgs() : { id: '303' }), error => error.code === 'NETWORK'); }
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
  assert.deepEqual(calls.at(-1).options.form, { title: '旅行装备', description: '说明', album_type: 1, targetType: '', targetId: '', 'productItems[0][level]': '2', 'productItems[0][item_id]': '7', 'productItems[0][item_logo]': 'https://image.coolapk.com/a.png', 'productItems[0][item_name]': '相机', 'productItems[0][item_description]': '轻便', 'productItems[0][item_images]': 'https://image.coolapk.com/b.png', 'productItems[0][display_order]': 0 });
});
test('album detail reads the actual feed productAlbumDetailInfo and derives owned controls', async () => {
  const { instance, calls } = client(); const result = await dispatchGoods(instance, 'goodsAlbum', { id: '303', uid: '123456' });
  assert.equal(result.data.title, '产品清单'); assert.equal(result.data.description, '原说明'); assert.deepEqual(result.data.productItems, album().productAlbumDetailInfo); assert.equal(result.data.canEdit, true); assert.equal(result.data.canDelete, true);
  assert.deepEqual(calls, [{ endpoint: '/v6/feed/detail', query: { id: '303' }, options: { method: 'POST', form: { trace: '' } } }]);
  await assert.rejects(dispatchGoods(instance, 'goodsAlbum', { id: '303', uid: '654321' }), error => error.code === 'API_ERROR');
  instance.identity = null; const guest = await dispatchGoods(instance, 'goodsAlbum', { id: '303' }); assert.equal(guest.data.canEdit, false); assert.equal(guest.data.canDelete, false);
});
test('invalid urls/images/envelopes remain failures and unknown deletes are absent', async () => {
  for (const value of ['file:///x', 'https://user:pass@item.jd.com/x', 'http://127.0.0.1/x', 'http://172.16.0.1/x', 'https://item.jd.com:123/x']) assert.throws(() => goodsLink(value));
  const { instance, calls } = client(); await assert.rejects(dispatchGoods(instance, 'goodsListCreate', { title: 'x', cover: 'https://evil.test/x.png' })); assert.equal(calls.length, 0);
  instance.request = async () => ({ data: {} }); await assert.rejects(dispatchGoods(instance, 'goodsLists', {}), error => error.code === 'API_ERROR');
  assert.equal(await dispatchGoods(instance, 'goodsListDelete', {}), undefined);
});
test('album edits preserve verified ids, complete indexed fields, ladder type and old public images', async () => {
  const source = { ...album(), feedType: 'anythingList', productAlbumType: '2', tid: '7000000123', ttype: 'apk', targetRow: { id: '456', targetType: 'tag' } };
  const { instance, calls } = client(); const base = instance.request; instance.request = async (...parameters) => parameters[0] === '/v6/feed/detail' ? (calls.push({ endpoint: parameters[0], query: parameters[1], options: parameters[2] }), { data: source }) : base(...parameters);
  const input = editArgs(); input.items = [{ item_name: '新增相机', item_id: '80', level: '3', item_description: '', item_logo: 'http://image.coolapk.com/camera.png', item_images: '' }, { ...input.items[0], level: '5', display_order: 99 }];
  const result = await dispatchGoods(instance, 'goodsAlbumEdit', input); assert.equal(result.createdId, '303');
  assert.deepEqual(calls.at(-1).options.form, { id: '303', title: '修改清单', description: '新说明', album_type: 2, targetType: 'product_phone', targetId: '456', 'productItems[0][level]': '3', 'productItems[0][item_id]': '80', 'productItems[0][item_logo]': 'https://image.coolapk.com/camera.png', 'productItems[0][item_name]': '新增相机', 'productItems[0][item_description]': '', 'productItems[0][item_images]': '', 'productItems[0][display_order]': 0, 'productItems[1][id]': '301', 'productItems[1][level]': '5', 'productItems[1][item_id]': '9', 'productItems[1][item_logo]': 'https://legacy.example.test/product.png', 'productItems[1][item_name]': '测试产品', 'productItems[1][item_description]': '新推荐理由', 'productItems[1][item_images]': 'https://legacy.example.test/photo.jpg', 'productItems[1][display_order]': 1 });
});
test('album editing retains official encoded node identity and verified fallback aliases', async () => {
  for (const [extra, targetType, targetId] of [[{ tid: '1000000042' }, 'apk', '42'], [{ tid: '3000000042' }, 'tag', '42'], [{ tid: '5000000042' }, 'tag', '42'], [{ tid: '7000000042' }, 'product_phone', '42'], [{ ttype: '5', targetRow: { id: '12' } }, 'tag', '12'], [{ targetRow: { id: '13', targetType: 'phone' } }, 'product_phone', '13'], [{ ttype: 'unsupported-old-type', targetRow: { id: '14', targetType: 'topic' } }, 'tag', '14']]) {
    const { instance, calls } = client(); const base = instance.request; instance.request = async (...parameters) => parameters[0] === '/v6/feed/detail' ? { data: { ...album(), ...extra } } : base(...parameters);
    await dispatchGoods(instance, 'goodsAlbumEdit', editArgs()); assert.equal(calls.at(-1).options.form.targetType, targetType); assert.equal(calls.at(-1).options.form.targetId, targetId);
  }
});
test('album owner, permission, history and exact feed identity are checked before any write', async () => {
  for (const [patch, code] of [[{ uid: '654321' }, 'FORBIDDEN'], [{ enableModify: -1 }, 'FORBIDDEN'], [{ enableModify: 0, status: -5 }, 'FORBIDDEN'], [{ isHistory: 1 }, 'INPUT'], [{ id: '999' }, 'API_ERROR'], [{ feedType: 'feed' }, 'API_ERROR'], [{ productAlbumDetailInfo: undefined }, 'API_ERROR'], [{ productAlbumType: 0 }, 'API_ERROR']]) {
    const { instance, calls } = client(); instance.request = async (endpoint, query, options) => { calls.push({ endpoint, query, options }); return { data: { ...album(), ...patch } }; };
    await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', editArgs()), error => error.code === code); assert.equal(calls.length, 1); assert.equal(calls[0].endpoint, '/v6/feed/detail');
  }
});
test('album editing rejects stale snapshots, foreign entries, duplicate names and changed associations', async () => {
  for (const [patch, code] of [[{ expectedItemIds: ['999'] }, 'CONFLICT'], [{ items: [{ ...editArgs().items[0], id: '999' }] }, 'INPUT'], [{ items: [editArgs().items[0], { item_name: ' 测试产品 ', item_id: '' }] }, 'INPUT'], [{ items: [{ ...editArgs().items[0], item_id: '8' }] }, 'INPUT'], [{ items: [{ ...editArgs().items[0], item_name: '其它产品' }] }, 'INPUT'], [{ items: [{ ...editArgs().items[0], item_images: Array(10).fill('https://image.coolapk.com/x.png').join(',') }] }, 'INPUT'], [{ items: [{ ...editArgs().items[0], server_only: 'x' }] }, 'INPUT'], [{ items: [{ ...editArgs().items[0], level: 6 }] }, 'INPUT']]) {
    const { instance, calls } = client(); await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', { ...editArgs(), ...patch }), error => error.code === code); assert.equal(calls.length, 1);
  }
  const { instance, calls } = client(); instance.request = async (endpoint, query, options) => { calls.push({ endpoint, query, options }); return { data: { ...album(), productAlbumDetailInfo: [] } }; };
  await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', { ...editArgs(), expectedItemIds: [] }), error => error.code === 'INPUT'); assert.equal(calls.length, 1);
});
test('album delete rechecks owner then sends ordinary delete queries without unknown administrator fields', async () => {
  const { instance, calls } = client(); await dispatchGoods(instance, 'goodsAlbumDelete', { id: '303' }); assert.deepEqual(calls[1], { endpoint: '/v6/feed/deleteFeed', query: { id: '303', notNotify: 0 }, options: { method: 'POST' } });
  const before = calls.length; await assert.rejects(dispatchGoods(instance, 'goodsAlbumDelete', { id: '303', blackType: 'anything' }), error => error.code === 'INPUT'); assert.equal(calls.length, before);
  for (const patch of [{ uid: '654321' }, { isHistory: 1 }]) { const other = client(); other.instance.request = async (endpoint, query, options) => { other.calls.push({ endpoint, query, options }); return { data: { ...album(), ...patch } }; }; await assert.rejects(dispatchGoods(other.instance, 'goodsAlbumDelete', { id: '303' })); assert.equal(other.calls.length, 1); }
});
test('album account changes during ownership read prevent edits and deletes', async () => {
  for (const operation of ['goodsAlbumEdit', 'goodsAlbumDelete']) for (const change of [instance => { instance.identity = { uid: '654321' }; }, instance => { instance.identity = { uid: '123456' }; }, instance => { instance.identity.uid = '654321'; }, instance => { instance.cookie = 'synthetic-new-cookie'; }, instance => { instance.deviceCode = 'synthetic-new-device'; }]) {
    const { instance, calls } = client(); instance.request = async (endpoint, query, options) => { calls.push({ endpoint, query, options }); change(instance); return { data: album() }; };
    await assert.rejects(dispatchGoods(instance, operation, operation === 'goodsAlbumEdit' ? editArgs() : { id: '303' }), error => error.code === 'ACCOUNT_CHANGED'); assert.equal(calls.length, 1);
  }
});
test('verification retry rechecks owner and preserves draft while a late switched-account result is rejected', async () => {
  const { instance, calls } = client(); const base = instance.request; let first = true; instance.request = async (...parameters) => { if (parameters[0] === '/v6/productAlbum/edit' && first) { first = false; calls.push({ endpoint: parameters[0], query: parameters[1], options: parameters[2] }); throw Object.assign(new Error('synthetic verification'), { code: 'VERIFY_REQUIRED' }); } return base(...parameters); };
  await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', editArgs()), error => error.code === 'VERIFY_REQUIRED'); await dispatchGoods(instance, 'goodsAlbumEdit', editArgs()); assert.deepEqual(calls.map(call => call.endpoint), ['/v6/feed/detail', '/v6/productAlbum/edit', '/v6/feed/detail', '/v6/productAlbum/edit']); assert.deepEqual(calls[1].options.form, calls[3].options.form);
  instance.request = async (...parameters) => { const result = await base(...parameters); if (parameters[0] === '/v6/productAlbum/edit') instance.identity = { uid: '654321' }; return result; }; await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', editArgs()), error => error.code === 'ACCOUNT_CHANGED');
});
test('unknown album association, excessive description and malformed edit confirmation remain explicit failures', async () => {
  const { instance, calls } = client(); const base = instance.request; instance.request = async (...parameters) => parameters[0] === '/v6/feed/detail' ? (calls.push({ endpoint: parameters[0] }), { data: { ...album(), tid: '9000000001', ttype: 'unconfirmed' } }) : base(...parameters);
  await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', editArgs()), error => error.code === 'UNSUPPORTED'); assert.equal(calls.length, 1);
  await assert.rejects(dispatchGoods(instance, 'goodsAlbumCreate', { title: 'x', description: 'x'.repeat(201), items: [] }), error => error.code === 'INPUT'); assert.equal(calls.length, 1);
  instance.request = async endpoint => ({ data: endpoint === '/v6/feed/detail' ? album() : { id: '999' } }); await assert.rejects(dispatchGoods(instance, 'goodsAlbumEdit', editArgs()), error => error.code === 'API_ERROR');
});
