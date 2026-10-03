import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient, messagePicture } from '../core/client.mjs';

const identity = { uid: '123456', username: '测试酷友' };
const success = data => new Response(JSON.stringify({ data }));
function recorder(data = {}) {
  const requests = [];
  const client = new CoolapkClient({ identity, fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return success(typeof data === 'function' ? data(requests.length, url, init) : data);
  } });
  return { client, requests };
}

test('collection status carries the feed id, default collection and independent item metadata', async () => {
  const { client, requests } = recorder([{ entityType: 'collection', id: 7, isCollected: 1, collection_item_info: { id: 99 } }]);
  const status = await client.dispatch('collectionStatus', { id: 50 });
  const url = requests[0].url;
  assert.equal(url.pathname, '/v6/collection/list');
  assert.equal(url.searchParams.get('uid'), '');
  assert.equal(url.searchParams.get('id'), '50');
  assert.equal(url.searchParams.get('type'), 'feed');
  assert.equal(url.searchParams.get('showDefault'), '1');
  assert.equal(url.searchParams.get('firstItem'), '');
  assert.equal(url.searchParams.get('lastItem'), '');
  assert.equal(status.data[0].collection_item_info.id, 99);
  await client.dispatch('collectionFeeds', { id: 7, firstItem: '90', lastItem: '99', page: 2 });
  assert.equal(requests[1].url.pathname, '/v6/collection/itemlist');
  assert.equal(requests[1].url.searchParams.get('listType'), 'allFeedType');
  assert.equal(requests[1].url.searchParams.get('lastItem'), '99');
});

test('collection options retain default id zero and accept known list envelopes', async () => {
  for (const key of ['entities', 'list', 'rows', 'data']) {
    const { client, requests } = recorder({ [key]: [{ entityType: 'collection', id: 0, isBeCollected: 1, defaultCollected: 1 }] });
    const response = await client.dispatch('collectionStatus', { id: 50 });
    assert.equal(response.data[0].id, 0);
    assert.equal(response.data[0].isBeCollected, 1);
    await client.dispatch('action', { type: 'updateCollectionItems', collectionIds: [0], targetId: 50 });
    assert.equal(requests[1].init.body.get('id'), '0');
  }
  const { client } = recorder({ unexpected: true });
  await assert.rejects(client.dispatch('collectionStatus', { id: 50 }), e => e.code === 'API_ERROR');
});

test('create collection uses ordered multipart while update sends its id in form', async () => {
  const { client, requests } = recorder({ id: 7 });
  await client.dispatch('action', { type: 'createCollection', title: ' 收藏单 ', description: ' 描述 ', isOpen: 0 });
  assert.equal(requests[0].url.pathname, '/v6/collection/create');
  assert.equal(requests[0].init.method, 'POST');
  assert.ok(requests[0].init.body instanceof FormData);
  assert.deepEqual([...requests[0].init.body], [['isOpen', '0'], ['pic', ''], ['description', '描述'], ['title', '收藏单'], ['sourceId', '']]);
  await client.dispatch('action', { type: 'updateCollection', id: '7', title: '新标题', isOpen: true });
  assert.equal(requests[1].url.searchParams.has('id'), false);
  assert.equal(requests[1].init.body.get('id'), '7');
  assert.equal(requests[1].init.body.get('isOpen'), '1');
});

test('collection mutations retain item id and colId field contracts', async () => {
  const { client, requests } = recorder();
  await client.dispatch('action', { type: 'updateCollectionItems', collectionIds: ['1', '2', '1'], cancelIds: '3,4', targetId: '50' });
  assert.deepEqual(Object.fromEntries(requests[0].init.body), { id: '1,2', cancelId: '3,4', targetId: '50', type: 'feed', trace: '' });
  await client.dispatch('action', { type: 'removeCollectionItem', itemId: '99' });
  await client.dispatch('action', { type: 'clearCollectionInvalid', id: '7' });
  await client.dispatch('action', { type: 'deleteCollection', id: '7' });
  assert.equal(requests[1].init.body.get('itemId'), '99');
  assert.equal(requests[1].init.body.has('id'), false);
  assert.equal(requests[2].init.body.get('colId'), '7');
  assert.equal(requests[3].init.body.get('id'), '7');
  assert.ok(requests.every(request => request.init.method === 'POST' && request.url.search === ''));
});

test('subscription and like collection actions use their exact GET route casing', async () => {
  const { client, requests } = recorder();
  for (const type of ['followCollection', 'unfollowCollection', 'likeCollection', 'unlikeCollection']) await client.dispatch('action', { type, id: '7' });
  assert.deepEqual(requests.map(r => r.url.pathname), ['/v6/collection/follow', '/v6/collection/unFollow', '/v6/collection/like', '/v6/collection/unLike']);
  assert.ok(requests.every(r => r.init.method === 'GET' && r.url.searchParams.get('id') === '7'));
});

test('guest or invalid collection data never reaches a write endpoint', async () => {
  const { client, requests } = recorder();
  const actions = [
    { type: 'createCollection', title: '' },
    { type: 'createCollection', title: 'x', isOpen: 2 },
    { type: 'createCollection', title: 'x', cover: 'https://evil.test/a.jpg' },
    { type: 'updateCollectionItems', collectionIds: '1,../2', targetId: 1 },
    { type: 'updateCollectionItems', targetId: 1 },
    { type: 'removeCollectionItem', id: 1 },
  ];
  for (const args of actions) await assert.rejects(client.dispatch('action', args));
  const guest = new CoolapkClient({ fetchImpl: async () => { throw new Error('guest touched network'); } });
  for (const operation of ['collections', 'collectionStatus', 'editableFeed', 'followingFeeds', 'notificationCount', 'clearNotificationCount', 'messageImage']) await assert.rejects(guest.dispatch(operation, { id: 1, type: 'all' }), e => e.code === 'LOGIN_REQUIRED');
  for (const type of ['createCollection', 'deleteCollection', 'removeCollectionItem', 'editFeed', 'deleteReply']) await assert.rejects(guest.dispatch('action', { type, id: 1 }), e => e.code === 'LOGIN_REQUIRED');
  assert.equal(requests.length, 0);
});

test('editing re-reads owner and server permission, preserving metadata and submitted replacement pictures', async () => {
  const original = { id: 50, uid: identity.uid, enableModify: 1, feedType: 'feed', targetType: 'product', targetId: '4', productId: '4', latitude: '1.2', longLocation: '原位置', disallowReply: 1, messageTitle: '原标题', mediaInfo: { height: 10 } };
  const { client, requests } = recorder(index => index === 1 ? original : { ...original, message: '修改后' });
  await client.dispatch('action', { type: 'editFeed', id: '50', message: '修改后', pic: 'https://image.coolapk.com/feed/new.jpg' });
  assert.equal(requests[0].url.pathname, '/v6/feed/changeDetail');
  assert.equal(requests[0].url.searchParams.get('rid'), '');
  const request = requests[1];
  assert.equal(request.url.pathname, '/v6/feed/changeFeed');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.body.get('id'), '50');
  assert.equal(request.init.body.get('message'), '修改后');
  assert.equal(request.init.body.get('targetId'), '4');
  assert.equal(request.init.body.get('long_location'), '原位置');
  assert.equal(request.init.body.get('disallow_reply'), '1');
  assert.equal(request.init.body.get('media_info'), '{"height":10}');
  assert.equal(request.init.body.get('pic'), 'https://image.coolapk.com/feed/new.jpg');
});

test('editing refuses other owners, denied permission, video, article and mismatching result without mutation', async () => {
  for (const change of [{ uid: '654321' }, { id: '51' }, { enableModify: 0 }, { mediaType: 1 }, { isHtmlArticle: 1 }, { feedType: 'rating' }]) {
    const { client, requests } = recorder({ id: '50', uid: identity.uid, feedType: 'feed', enableModify: 1, ...change });
    await assert.rejects(client.dispatch('action', { type: 'editFeed', id: '50', message: '修改' }));
    assert.equal(requests.length, 1);
  }
  const { client } = recorder(index => index === 1 ? { id: 50, uid: identity.uid, feedType: 'feed' } : {});
  await assert.rejects(client.dispatch('action', { type: 'editFeed', id: '50', message: '修改' }), e => e.code === 'API_ERROR');
});

test('deleting own feed and reply checks official record then POSTs id in query', async () => {
  for (const type of ['deleteFeed', 'deleteReply']) {
    const { client, requests } = recorder({ id: 50, uid: identity.uid });
    await client.dispatch('action', { type, id: '50' });
    assert.equal(requests[0].url.pathname, type === 'deleteFeed' ? '/v6/feed/detail' : '/v6/feed/replyDetail');
    assert.equal(requests[1].url.pathname, `/v6/feed/${type}`);
    assert.equal(requests[1].url.searchParams.get('id'), '50');
    assert.equal(requests[1].init.method, 'POST');
    assert.equal(requests[1].init.headers['X-Requested-With'], 'XMLHttpRequest');
    const other = recorder({ id: 50, uid: '654321' });
    await assert.rejects(other.client.dispatch('action', { type, id: '50' }), e => e.code === 'INPUT');
    assert.equal(other.requests.length, 1);
  }
});

test('private image message uses one relative path in multipart and accepts no text', async () => {
  const { client, requests } = recorder();
  await client.dispatch('action', { type: 'sendMessage', uid: '54321', message: '', pic: '/message/2026/10/test.jpg' });
  assert.equal(requests[0].url.searchParams.get('uid'), '54321');
  assert.equal(requests[0].url.searchParams.get('quick_reply'), '1');
  assert.ok(requests[0].init.body instanceof FormData);
  assert.deepEqual([...requests[0].init.body], [['message', ''], ['message_pic', '/message/2026/10/test.jpg'], ['message_extra', '']]);
  assert.equal(messagePicture('https://image.coolapk.com/message/2026/test.jpg'), '/message/2026/test.jpg');
  for (const source of ['https://evil.test/message/a.jpg', '/message/../a.jpg', '/message/a/../a.jpg', 'https://image.coolapk.com/message/a/../a.jpg', '/message/a.jpg,b.jpg', '/message/a.jpg?x=1', '/message/%2e%2e/a.jpg']) assert.throws(() => messagePicture(source));
});

test('pure picture reply keeps the APK feed type and rejects empty or too many pictures', async () => {
  const { client, requests } = recorder();
  await client.dispatch('action', { type: 'reply', id: '50', message: '', pic: 'https://image.coolapk.com/feed/a.jpg' });
  assert.equal(requests[0].url.searchParams.get('type'), 'feed');
  assert.equal(requests[0].init.body.get('message'), '');
  await assert.rejects(client.dispatch('action', { type: 'reply', id: '50', message: '', pic: '' }));
  await assert.rejects(client.dispatch('action', { type: 'reply', id: '50', message: '', pic: Array(10).fill('https://image.coolapk.com/feed/a.jpg').join(',') }));
  assert.equal(requests.length, 1);
});

test('following uses the APK tab and clearing notification counts is POST with a bounded category', async () => {
  const { client, requests } = recorder([]);
  await client.dispatch('followingFeeds', { page: 2, firstItem: '50', lastItem: '51' });
  assert.equal(requests[0].url.searchParams.get('url'), 'V15_HOME_TAB_FOLLOW');
  assert.equal(requests[0].url.searchParams.get('lastItem'), '51');
  await client.dispatch('notificationCount');
  assert.equal(requests[1].url.pathname, '/v6/notification/checkCount');
  await client.dispatch('clearNotificationCount', { type: 'feed' });
  assert.equal(requests[2].url.pathname, '/v6/notification/clearCount');
  assert.equal(requests[2].init.method, 'POST');
  assert.equal(requests[2].url.searchParams.get('type'), 'feed');
  await assert.rejects(client.dispatch('clearNotificationCount', { type: '../all' }));
  assert.equal(requests.length, 3);
});
