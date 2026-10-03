import test from 'node:test';
import assert from 'node:assert/strict';
import { communityList, dispatchCommunity, topicPageDescriptor } from '../core/community.mjs';

function mock(identity = { uid: '42' }) {
  const calls = [];
  return { calls, client: { identity, request: async (path, query) => { calls.push({ path, query }); return { data: [{ id: '301', entityId: 'cursor-301', uid: '43' }] }; } } };
}

test('community browsing retains cursors, nested cards and raw metadata', async () => {
  const { client, calls } = mock();
  const result = await dispatchCommunity(client, 'feedLikes', { id: '101', page: 2, firstItem: 'first', lastItem: 'last' });
  assert.equal(calls[0].path, '/v6/feed/likeList');
  assert.deepEqual(calls[0].query, { id: '101', listType: 'lastupdate_desc', page: 2, firstItem: 'first', lastItem: 'last' });
  assert.equal(result.data[0].entityType, 'user'); assert.equal(result.lastItem, 'cursor-301');
  const nested = communityList({ data: [{ entityType: 'card', entities: [{ entityType: 'feed', id: 3 }] }], pageContext: 'server-context' });
  assert.equal(nested.data[0].id, 3); assert.equal(nested.pageContext, 'server-context');
  assert.throws(() => communityList({ data: { invalid: [] } }), /列表结构异常/);
});

test('topic tabs reject external origins and write routes before any request', async () => {
  assert.equal(topicPageDescriptor('/page?url=%2Ftopic%2FtagFeedList%3Ftag%3DWindows'), '#/topic/tagFeedList?tag=Windows');
  assert.equal(topicPageDescriptor('/v6/topic/deviceFeedList?tag=手机'), '#/topic/deviceFeedList?tag=手机');
  assert.equal(topicPageDescriptor('V11_VERTICAL_TOPIC'), 'V11_VERTICAL_TOPIC');
  for (const url of ['https://evil.test/topic/tagList', '#/feed/deleteFeed?id=1', '/page?url=/user/addToBlackList?uid=1', '/topic/followTag']) assert.throws(() => topicPageDescriptor(url));
  const { client, calls } = mock();
  await assert.rejects(dispatchCommunity(client, 'topicServerTab', { url: '#/feed/deleteFeed?id=1' }));
  assert.equal(calls.length, 0);
});

test('community mutations need authentication and explicit valid intent', async () => {
  for (const [operation, args] of [['topicFollow', { tag: 'Windows', status: 1 }], ['liveFollow', { id: '9', status: 1 }], ['chatRead', { ukey: '42_43' }], ['chatDelete', { ukey: '42_43' }], ['chatRecent', {}], ['followedTopics', {}]]) {
    const { client, calls } = mock(null); await assert.rejects(dispatchCommunity(client, operation, args), error => error.code === 'LOGIN_REQUIRED'); assert.equal(calls.length, 0);
  }
  const { client, calls } = mock();
  await assert.rejects(dispatchCommunity(client, 'liveFollow', { id: '9' }), /缺少关注状态/);
  await assert.rejects(dispatchCommunity(client, 'chatDelete', { ukey: '' }));
  await assert.rejects(dispatchCommunity(client, 'feedChanges', { id: '1&uid=42' }));
  assert.equal(calls.length, 0);
  await dispatchCommunity(client, 'topicFollow', { tag: 'Windows', status: 1 });
  await dispatchCommunity(client, 'topicFollow', { tag: 'Windows', status: 0 });
  await dispatchCommunity(client, 'liveFollow', { id: '9', status: 1 });
  await dispatchCommunity(client, 'chatDelete', { ukey: '42_43' });
  assert.deepEqual(calls.map(call => call.path), ['/v6/feed/followTag', '/v6/feed/unFollowTag', '/v6/live/follow', '/v6/message/deleteChat']);
});

test('reply filters match author and hidden APK contracts', async () => {
  const { client, calls } = mock();
  await dispatchCommunity(client, 'advancedReplies', { id: '101', authorOnly: true });
  await dispatchCommunity(client, 'advancedReplies', { id: '101', hidden: true, page: 3 });
  assert.deepEqual(calls[0].query, { id: '101', listType: '', discussMode: 1, feedType: 'feed', blockStatus: 0, fromFeedAuthor: 1, page: 1 });
  assert.deepEqual(calls[1].query, { id: '101', listType: '', discussMode: 0, feedType: 'feed_reply', blockStatus: 4, fromFeedAuthor: 0, page: 3 });
  assert.equal(await dispatchCommunity(client, 'unknownOperation'), undefined);
});
