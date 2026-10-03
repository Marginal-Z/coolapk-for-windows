import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSecondhand, SECONDHAND_CONTRACTS, SECONDHAND_OPERATIONS, secondhandResult } from '../core/secondhand.mjs';
import { parseSecondhandRoute, secondhandDescriptor, secondhandEntityTarget, SECONDHAND_HOME } from '../core/secondhand-routes.mjs';

const client = () => { const calls = []; return { calls, request: async (path, query) => { calls.push({ path, query }); return { data: [{ id: 9, entityType: 'feed' }], hasMore: false }; } }; };
test('five secondhand operations issue only fixed official GET paths and no mutation exists', async () => {
  const api = client(); for (const operation of SECONDHAND_OPERATIONS) await dispatchSecondhand(api, operation, { brandId: '7', keyword: '手机' });
  assert.equal(SECONDHAND_OPERATIONS.length, 5); assert.ok(SECONDHAND_CONTRACTS.every(row => row.method === 'GET')); assert.ok(api.calls.every(row => ['/v6/erShou/brandList', '/v6/erShou/productList', '/v6/page/dataList', '/v6/search'].includes(row.path)));
  assert.equal(await dispatchSecondhand(api, 'secondhandPublish', {}), undefined);
});
test('brands and models follow exact id/listType/cursor protocol', async () => {
  const api = client(); await dispatchSecondhand(api, 'secondhandProducts', { brandId: '7', listType: 'recommend', page: 3, firstItem: '91', lastItem: '99' });
  assert.deepEqual(api.calls[0], { path: '/v6/erShou/productList', query: { id: '7', listType: 'recommend', page: 3, firstItem: '91', lastItem: '99' } });
});
test('home keeps native discovery entities and transmitted page context', async () => {
  const api = client(); await dispatchSecondhand(api, 'secondhandHome', { page: 2, firstItem: '3', lastItem: '9', pageContext: '{"source":"test"}' });
  assert.deepEqual(api.calls[0].query, { url: SECONDHAND_HOME, title: '二手市场', page: 2, firstItem: '3', lastItem: '9', pageContext: '{"source":"test"}' });
});
test('filtered listing uses only evidenced camel-case native descriptor fields', async () => {
  const api = client(), filters = { brand: '7', productId: '99', cityId: '440300', ershouType: '100', dataListType: 'staggered' };
  await dispatchSecondhand(api, 'secondhandListings', { filters, title: '型号甲', page: 2, pageContext: 'next' });
  assert.equal(api.calls[0].query.url, '#/feed/ershouList?brand=7&productId=99&cityId=440300&ershouType=100&dataListType=staggered');
  assert.equal(api.calls[0].query.pageContext, 'next'); assert.equal(api.calls[0].query.title, '型号甲');
});
test('ershou search keeps fixed evidenced availability/deal fields and selected model/type', async () => {
  const api = client(); await dispatchSecondhand(api, 'secondhandSearch', { keyword: '手机', productId: '99', ershouType: '100', page: 2, firstItem: '90', lastItem: '95' });
  assert.deepEqual(api.calls[0].query, { type: 'ershou', sort: '', searchValue: '手机', status: 1, deal_type: 'all', city_code: '', is_link: '', ershou_type: '100', product_id: '99', tags: '', page: 2, firstItem: '90', lastItem: '95' });
  await assert.rejects(dispatchSecondhand(api, 'secondhandSearch', { keyword: 'x', sort: 'price_asc' }), { code: 'INPUT' });
});
test('official route parsing rejects unknown filters, duplicate fields and external hosts', () => {
  const descriptor = secondhandDescriptor({ productId: '99', ershouType: '100' }); assert.equal(parseSecondhandRoute(descriptor).filters.productId, '99');
  assert.equal(parseSecondhandRoute('/page?url=' + encodeURIComponent(descriptor)).filters.ershouType, '100');
  assert.equal(parseSecondhandRoute('coolmarket://com.coolapk.market/feed/ershouList?cityId=440300').filters.cityId, '440300');
  for (const source of ['https://evil.test/feed/ershouList', 'https://www.coolapk.com:999/feed/ershouList', '#/feed/ershouList?productId=1&productId=2', '#/feed/ershouList?dealType=0', '#/feed/ershouList?productId=../1', 'https://com.coolapk.market/feed/ershouList']) assert.equal(parseSecondhandRoute(source), null, source);
});
test('native main categories do not turn category id into a product id', () => {
  const category = secondhandEntityTarget({ id: 2, entityType: 'mainErshouType', title: '相机' }); assert.equal(category.filters.ershouType, '2'); assert.equal(category.filters.productId, '');
  const model = secondhandEntityTarget({ id: 99, entityType: 'product', title: '型号甲' }, '7', true); assert.equal(model.filters.productId, '99'); assert.equal(model.filters.ershouType, '100'); assert.equal(model.filters.brand, '7');
  assert.equal(secondhandEntityTarget({ id: 99, entityType: 'feed' }), null);
});
test('malformed envelopes remain errors, snake-case paging flags normalize and wrappers preserve models', () => {
  assert.throws(() => secondhandResult({ data: {} }), { code: 'API_ERROR' });
  const result = secondhandResult({ data: [{ entityType: 'card', entities: [{ entityType: 'product', id: 9 }] }], has_more: '0', first_item: '8', last_item: '9', pageContext: 'ctx' });
  assert.equal(result.hasMore, false); assert.equal(result.data[0].id, 9); assert.equal(result.firstItem, '8'); assert.equal(result.lastItem, '9'); assert.equal(result.pageContext, 'ctx');
});
test('brand/model extractor expands non-card wrappers while retaining native group titles and category ids', () => {
  const result = secondhandResult({ data: [{ entities: [{ id: 7, entityType: 'ershouBrand', title: '品牌甲' }] }, { entityType: 'productGroupTitle', title: '系列' }, { id: 2, entityType: 'mainErshouType', title: '相机' }, { entityType: 'banner', id: 10 }, { entityType: 'ad', id: 11 }] }, true);
  assert.deepEqual(result.data.map(item => item.entityType), ['ershouBrand', 'productGroupTitle', 'mainErshouType']); assert.equal(result.data[0].id, 7); assert.equal(result.data[2].id, 2);
});
test('invalid numeric pagination, cursor controls and unconfirmed filters stop before network', async () => {
  const api = client(); for (const args of [{ page: -1 }, { page: 2.5 }, { lastItem: 'bad\n' }]) await assert.rejects(dispatchSecondhand(api, 'secondhandHome', args), { code: 'INPUT' });
  for (const filters of [{ price: '1' }, { productId: '-1' }, { ershouType: '100&x=1' }, { dataListType: 'x/y' }, { brand: 'bad\n' }]) await assert.rejects(dispatchSecondhand(api, 'secondhandListings', { filters }), { code: 'INPUT' });
  assert.equal(api.calls.length, 0);
});
