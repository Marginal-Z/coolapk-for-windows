import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { catalogContracts, catalogImage, catalogOperations, dispatchCatalog, productRatingDescriptor } from '../core/catalog.mjs';

const identity = { uid: '123456', username: '模拟酷友' };
function recorder(reply = []) {
  const requests = [];
  const client = new CoolapkClient({ identity, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    const data = typeof reply === 'function' ? reply(url, requests.length) : reply;
    return new Response(JSON.stringify({ data }));
  } });
  return { client, requests, run: (operation, args = {}) => dispatchCatalog(client, operation, args) };
}
const validArgs = { id: '7', packageName: 'com.example.app', type: '0', url: '/product/productList?id=7', title: '测试产品', subTitle: '手机', message: '测试内容', value: 5, score: 5, status: 1, tag: '摄影', developer: '测试开发者', query: '工具', uids: ['12', '13'], optionIds: ['1', '2'], subId: '3', order: 1 };
const special = {
  catalogProductBrandItems: { type: 'brand' }, catalogProductFeeds: { type: 'feed' }, catalogProductMedia: { type: 'image' }, catalogMyProducts: { type: 'owner' }, catalogAlbums: { type: 'hot' }, catalogDyhFeeds: { type: 'all' },
  catalogAlbumAddApp: { url: 'https://www.coolapk.com/apk/com.example.app' },
};
test('every declared catalog contract uses only its fixed official route and expected method', async () => {
  for (const contract of catalogContracts) {
    const { run, requests } = recorder(url => url.pathname === '/v6/album/detail' ? { id: 7, uid: identity.uid } : contract.operation === 'catalogAlbumCreate' ? { id: 7 } : []);
    await run(contract.operation, contract.operation === 'catalogProductRatingPage' ? { id: '7', url: '/product/feedList?id=7&type=rating' } : { ...validArgs, ...special[contract.operation] });
    const request = requests.at(-1);
    assert.equal(request.url.origin, 'https://api.coolapk.com', contract.operation);
    assert.equal(request.url.pathname, contract.endpoint, contract.operation);
    assert.equal(request.init.method, contract.method, contract.operation);
    assert.equal(request.init.redirect, 'error');
  }
  assert.equal(new Set(catalogOperations).size, catalogOperations.length);
});
test('all authenticated contracts reject guests before network or content reads', async () => {
  const client = new CoolapkClient({ fetchImpl: async () => { throw new Error('guest network access'); } });
  for (const operation of [...catalogContracts.filter(item => item.authenticated).map(item => item.operation), 'catalogProductReview', 'questionAnswer']) {
    await assert.rejects(dispatchCatalog(client, operation, validArgs), error => error.code === 'LOGIN_REQUIRED', operation);
  }
});
test('products preserve classification context and first/last pagination cursors', async () => {
  const { run, requests } = recorder([{ entityType: 'product', id: 7, entityId: 'product_7' }]);
  const result = await run('catalogProductCategoryItems', { url: '#/product/productList?category_id=2', title: '耳机', subTitle: '无线耳机', page: 2, firstItem: 'product_4', lastItem: 'product_5' });
  assert.equal(requests[0].url.searchParams.get('url'), '#/product/productList?category_id=2');
  assert.equal(requests[0].url.searchParams.get('title'), '耳机');
  assert.equal(requests[0].url.searchParams.get('lastItem'), 'product_5');
  assert.equal(result.lastItem, 'product_7');
  await assert.rejects(run('catalogProductCategoryItems', { url: '/feed/deleteFeed?id=1' }), error => error.code === 'INPUT');
  await assert.rejects(run('catalogProductCategoryItems', { url: 'https://evil.test/product/productList' }), error => error.code === 'INPUT');
});
test('product sub-board requests preserve server IDs and fixed card flags with independent cursors', async () => {
  const { run, requests } = recorder([{ entityType: 'feed', id: 70 }]);
  await run('catalogProductSubtab', { id: '007', subId: '004', page: 2, firstItem: 'feed_1', lastItem: 'feed_2' });
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { url: '/page?url=/product/feedList', cacheExpires: '60', type: 'subTabFeed', withSortCard: '1', withSubTabFeedCard: '1', ignoreEntityById: '1', id: '007', subId: '004', page: '2', firstItem: 'feed_1', lastItem: 'feed_2' });
  await assert.rejects(run('catalogProductSubtab', { id: 7, subId: '4&extra=bad' }), error => error.code === 'INPUT'); assert.equal(requests.length, 1);
});
test('product feed sorting and media filtering preserve confirmed read contracts', async () => {
  const { run, requests } = recorder([]);
  for (const sort of ['', 'dateline_desc', 'rank_score']) await run('catalogProductFeeds', { id: '007', type: 'article', sort });
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { url: '/page?url=/product/feedList', id: '007', type: 'article', page: '1' });
  assert.equal(requests[1].url.searchParams.get('listType'), 'dateline_desc'); assert.equal(requests[2].url.searchParams.get('listType'), 'rank_score');
  for (const [type, recommended] of [['image', 0], ['video', 0], ['image', 1]]) await run('catalogProductMedia', { id: '7', type, recommended });
  assert.deepEqual(requests.slice(3).map(request => Object.fromEntries(request.url.searchParams)), [
    { id: '7', type: 'image', is_recommend: '0', page: '1' }, { id: '7', type: 'video', is_recommend: '0', page: '1' }, { id: '7', type: 'image', is_recommend: '1', page: '1' },
  ]);
});
test('product rating sort cards retain only their own exact validated metadata and feed cursors', async () => {
  const descriptor = path => '/page?url=' + encodeURIComponent(path);
  const good = descriptor('/product/feedList?type=ratingByScore&id=007');
  const { run, requests } = recorder([
    { entityType: 'card', entityTemplate: 'otherCard', entities: [{ title: '伪排序', url: good }] },
    { entityType: 'card', entityTemplate: 'sortSelectCard', entities: [
      { title: '机主', url: descriptor('/product/feedList?type=rating&isOwner=1&id=007') }, { title: '好评', url: good }, { title: '重复', url: good },
      { title: '异机', url: descriptor('/product/feedList?type=rating&id=7') }, { title: '错误目标', url: descriptor('/product/feedList?type=rating&id=007&targetType=8') },
      { title: '写接口', url: '/feed/deleteFeed?id=007' }, { title: '外站', url: 'https://evil.test/product/feedList?type=rating&id=007' }, null,
    ] }, { entityType: 'singleRatingCard', id: 'my_rating' }, { entityType: 'feed', id: 70 }, { entityType: 'feed', entityId: 'feed_71', id: 71 },
  ]);
  const result = await run('catalogProductRatingPage', { id: '007', url: good, page: 2, firstItem: 'feed_1', lastItem: 'feed_2' });
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { url: '/product/feedList?type=ratingByScore&id=007', page: '2', firstItem: 'feed_1', lastItem: 'feed_2' });
  assert.deepEqual(result.ratingSortOptions.map(item => item.title), ['机主', '好评']); assert.equal(result.ratingSortOptions[1].url, good);
  assert.deepEqual(result.data.map(item => item.id), [70, 71]); assert.equal(result.firstItem, '70'); assert.equal(result.lastItem, 'feed_71'); assert.equal(result.hasMore, true);
  const empty = await recorder([]).run('catalogProductRatingPage', { id: '007', url: good }); assert.equal(empty.hasMore, false);
  await assert.rejects(recorder({ entities: [] }).run('catalogProductRatingPage', { id: '007', url: good }), error => error.code === 'API_ERROR');
});
test('product rating descriptors reject ambiguous, arbitrary, cross-product and unsupported filter routes before reads', async () => {
  const { run, requests } = recorder([]), good = '/product/feedList?type=rating&id=007';
  assert.equal(productRatingDescriptor('007', '/page?url=' + encodeURIComponent(good + '&targetType=7&targetId=007')), good + '&targetType=7&targetId=007');
  for (const url of [null, '//evil.test/product/feedList?type=rating&id=007', 'https://www.coolapk.com.evil.test/product/feedList?type=rating&id=007', '/feed/deleteFeed?id=007', good + '&id=007', good + '&targetId=7', good + '&targetType=8', good + '&star=5', good + '&listType=unknown', good + '&isOwner=0', good + '&page=2', good.replace('type=rating', 'type=feed'), good + '#x', '/page?url=' + encodeURIComponent(good) + '&url=' + encodeURIComponent(good)]) await assert.rejects(run('catalogProductRatingPage', { id: '007', url }), error => error.code === 'INPUT');
  for (const extra of [{ star: 4 }, { owner: true }, { targetType: 8 }, { targetId: 7 }]) await assert.rejects(run('catalogProductRatingPage', { id: '007', url: good, ...extra }), error => error.code === 'INPUT');
  assert.equal(requests.length, 0);
});
test('vote comment pagination sends only confirmed fid and page fields', async () => {
  const { run, requests } = recorder([]);
  await run('voteComments', { id: '70', page: 2, firstItem: 'obsolete_first', lastItem: 'obsolete_last' });
  assert.equal(requests[0].url.pathname, '/v6/vote/commentList'); assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { fid: '70', page: '2' });
});
test('purchasable versions and parameter configurations remain separate and rating filters omit unspecified fields', async () => {
  const { run, requests } = recorder([]);
  await run('catalogProductVersions', { id: '7' }); await run('catalogProductConfig', { id: '71' }); await run('catalogProductRatings', { id: '7', star: 0, owner: false }); await run('catalogProductRatings', { id: '7', star: 4, owner: true, page: 2 });
  assert.equal(requests[0].url.pathname, '/v6/product/getVersionList'); assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { product_id: '7' });
  assert.equal(requests[1].url.pathname, '/v6/product/config'); assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), { id: '71' });
  assert.deepEqual(Object.fromEntries(requests[2].url.searchParams), { url: '/feed/nodeRatingList', targetType: '7', targetId: '7', page: '1' });
  assert.deepEqual(Object.fromEntries(requests[3].url.searchParams), { url: '/feed/nodeRatingList', targetType: '7', targetId: '7', star: '4', isOwner: '1', page: '2' });
  await assert.rejects(run('catalogProductRatings', { id: 7, star: 6 }), error => error.code === 'INPUT'); assert.equal(requests.length, 4);
});
test('product wishlist/follow/config compare/rating use separate exact form contracts', async () => {
  const { run, requests } = recorder({});
  await run('catalogProductWish', { id: 7, status: 1 });
  await run('catalogProductFollow', { id: 7, status: 0 });
  await run('catalogCompareAdd', { id: 70 });
  await run('catalogCompareRemove', { id: 70 });
  await run('catalogRating', { id: 7, value: 5 });
  assert.deepEqual(Object.fromEntries(requests[0].init.body), { id: '7', status: '1' });
  assert.deepEqual(Object.fromEntries(requests[1].init.body), { id: '7', status: '0' });
  assert.deepEqual(Object.fromEntries(requests[2].init.body), { config_id: '70' });
  assert.deepEqual(Object.fromEntries(requests[3].init.body), { config_id: '70' });
  assert.equal(requests[4].url.pathname, '/v6/apk/rating');
  assert.equal(requests[4].url.searchParams.get('value'), '5');
  await assert.rejects(run('catalogRating', { id: 7, value: 6 }));
});
test('owned product review records bought status and demands returned published entity', async () => {
  const { run, requests } = recorder({ id: 70 });
  await run('catalogProductReview', { id: 7, score: 4, message: '实际使用感受', bought: true });
  const body = requests[0].init.body;
  assert.equal(body.get('type'), 'rating'); assert.equal(body.get('targetType'), 'product_phone');
  assert.equal(body.get('targetId'), '7'); assert.equal(body.get('rating_score_1'), '4'); assert.equal(body.get('buy_status'), '1');
  await assert.rejects(recorder({}).run('catalogProductReview', { id: 7, score: 4, message: '内容' }));
});
test('application historical versions resolve the numeric id before listing', async () => {
  const { run, requests } = recorder(url => url.pathname === '/v6/apk/detail' ? { aid: 99 } : [{ id: 4, versionName: '1.0' }]);
  await run('catalogAppVersions', { id: 'com.example.app', page: 2 });
  assert.equal(requests[0].url.searchParams.get('id'), 'com.example.app');
  assert.equal(requests[1].url.pathname, '/v6/apk/downloadVersionList');
  assert.equal(requests[1].url.searchParams.get('id'), '99');
  assert.equal(requests[1].url.searchParams.get('page'), '2');
});
test('application comments permit only confirmed sorts and keep the exact list type and pagination cursors', async () => {
  const { run, requests } = recorder([{ entityType: 'feed', id: 7 }]);
  for (const sort of ['lastupdate_desc', 'dateline_desc', 'popular']) {
    await run('catalogAppComments', { id: 'com.example.app', sort, page: 2, firstItem: 'feed_5', lastItem: 'feed_6' });
    assert.equal(requests.at(-1).url.pathname, '/v6/apk/commentList');
    assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { id: 'com.example.app', listType: sort, page: '2', firstItem: 'feed_5', lastItem: 'feed_6' });
  }
  await run('catalogAppComments', { id: 'com.example.app' }); assert.equal(requests.at(-1).url.searchParams.get('listType'), 'lastupdate_desc');
  for (const sort of ['hot', '', {}, 1, 'popular&admin=1']) await assert.rejects(run('catalogAppComments', { id: 'com.example.app', sort }), error => error.code === 'INPUT');
  assert.equal(requests.length, 4);
});
test('album edits and item removal check current account ownership before mutation', async () => {
  const { run, requests } = recorder(url => url.pathname === '/v6/album/detail' ? { id: 7, uid: identity.uid } : { id: 7 });
  await run('catalogAlbumEdit', { id: 7, title: '工具箱', intro: '介绍', cover: 'https://image.coolapk.com/feed/test.jpg' });
  assert.equal(requests[1].url.searchParams.get('id'), '7');
  assert.equal(requests[1].init.body.get('cover'), 'https://image.coolapk.com/feed/test.jpg');
  await run('catalogAlbumRemoveApp', { id: 7, packageName: 'com.example.app' });
  assert.equal(requests[3].init.body.get('packageName'), 'com.example.app');
  const other = recorder({ id: 7, uid: '654321' });
  await assert.rejects(other.run('catalogAlbumRemoveApp', { id: 7, packageName: 'com.example.app' }), error => error.code === 'INPUT');
  assert.equal(other.requests.length, 1);
});
test('catalog images, application links and scalar inputs are bounded', async () => {
  assert.equal(catalogImage('http://image.coolapk.com/a.jpg'), 'https://image.coolapk.com/a.jpg');
  for (const image of ['https://evil.test/a.jpg', 'https://image.coolapk.com:1234/a.jpg', 'data:image/png;base64,aaa', 'https://user:password@image.coolapk.com/a.jpg']) assert.throws(() => catalogImage(image));
  const { run, requests } = recorder();
  for (const [operation, args] of [['catalogAlbumCreate', { title: 'x', cover: 'https://evil.test/a.png' }], ['catalogAlbumAddApp', { id: 7, packageName: 'com.example.app', title: 'x', url: 'https://evil.test' }], ['catalogApp', { id: '../account/login' }], ['catalogPictures', { page: -1 }]]) await assert.rejects(run(operation, args));
  assert.equal(requests.length, 0);
});
test('question invitation is multipart, answering is createFeed and vote preserves bracketed option fields', async () => {
  const { run, requests } = recorder({ id: 70 });
  await run('questionInvite', { id: 7, uids: ['12', '13', '12'] });
  assert.ok(requests[0].init.body instanceof FormData);
  assert.deepEqual([...requests[0].init.body], [['uid', '12,13'], ['questionId', '7']]);
  await run('questionAnswer', { id: 7, message: '回答', pic: 'https://image.coolapk.com/feed/a.jpg' });
  assert.equal(requests[1].init.body.get('type'), 'answer'); assert.equal(requests[1].init.body.get('fid'), '7');
  await run('voteSubmit', { id: 7, optionIds: ['2', '3'], anonymous: true });
  assert.deepEqual(Object.fromEntries(requests[2].init.body), { id: '7', anonymous_status: '1', 'select_option[0]': '2', 'select_option[1]': '3' });
  await assert.rejects(run('voteSubmit', { id: 7, optionIds: [] }));
});
test('malformed lists, network failures and invalid operation stay failures', async () => {
  await assert.rejects(recorder({ surprise: true }).run('catalogEvents'), error => error.code === 'API_ERROR');
  const client = new CoolapkClient({ fetchImpl: async () => { throw new Error('private detail'); } });
  await assert.rejects(dispatchCatalog(client, 'catalogDyhs'), error => error.code === 'NETWORK' && !error.message.includes('private detail'));
  await assert.rejects(dispatchCatalog(client, '../arbitrary', {}), error => error.code === 'INPUT');
});
