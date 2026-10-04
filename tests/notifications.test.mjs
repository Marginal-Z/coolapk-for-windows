import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationCounts, notificationModel } from '../core/notifications.mjs';

test('notification count fields preserve authoritative zero and v18 totals', () => {
  const result = notificationCounts({ data: { badge_v18: 12, badge: 99, message: 2, commentme: 0, comment: 50, feedlike: 4, atme: 3 } });
  assert.equal(result.total, 12); assert.equal(result.community, 10); assert.equal(result.message, 2);
  assert.equal(result.categories.comment, 0); assert.equal(result.categories.like, 4); assert.equal(result.categories.atMe, 3);
  assert.equal(result.categories.follow, null);
});
test('official notification_v18 badge adds likes separately and ignores only that component when configured', () => {
  const response = { data: { notification_v18: 7, badge_v18: 90, message: 3, feedlike: 5 } };
  const visible = notificationCounts(response); assert.equal(visible.community, 12); assert.equal(visible.total, 15);
  const ignored = notificationCounts(response, [], { ignoreLikes: true }); assert.equal(ignored.community, 7); assert.equal(ignored.total, 10); assert.equal(ignored.message, 3); assert.equal(ignored.categories.like, 5);
  assert.equal(notificationCounts({ data: { notification_v18: 0, feedlike: 9 } }, [], { ignoreLikes: true }).community, 0);
  assert.equal(notificationCounts({ data: { badge_v18: 12, message: 2, feedlike: 4 } }, [], { ignoreLikes: true }).community, 10);
});
test('unknown counts stay unknown; embedded category snapshots are not added once per row', () => {
  assert.equal(notificationCounts(null).community, null);
  assert.equal(notificationCounts({ data: { badge: 'invalid', message: null, feedlike: true } }).total, null);
  const result = notificationCounts({}, [{ notifyCount: { feedlike: 2 } }, { notifyCount: { feedlike: 2, atcommentme: 3 } }]);
  assert.equal(result.categories.like, 2); assert.equal(result.categories.atComment, 3); assert.equal(result.community, 5);
  assert.equal(notificationCounts({ data: { contacts_follow: 2 } }).categories.follow, 2);
});
test('like notifications use the person who liked rather than the feed author', () => {
  const model = notificationModel({ uid: '1001', username: '原作者', userAvatar: 'author', likeUid: '2002', likeUsername: '点赞人', likeAvatar: 'liker', feedTypeName: '<b>文章</b>', message: '原动态' }, 'feedLikeList');
  assert.deepEqual(model.actor, { uid: '2002', username: '点赞人', avatar: 'liker' });
  assert.equal(model.note, '赞了你的文章');
  assert.equal(notificationModel({ uid: '1001', username: '作者' }, 'feedLikeList').actor.uid, '');
});
test('reply actors and row body use the dedicated sender and reply-row fields', () => {
  const model = notificationModel({ uid: '1001', fromUserInfo: { uid: '2002', username: '回复人', userAvatar: 'reply' }, replyRows: [{ message: '回复正文' }], note: '回复了你' });
  assert.equal(model.actor.uid, '2002'); assert.equal(model.actor.username, '回复人'); assert.equal(model.message, '回复正文');
});
test('official notification links preserve precise reply targets and override unrelated row ids', () => {
  const model = notificationModel({ id: '9009', note: '<a href="coolmarket://www.coolapk.com/feed/3003?rid=4004&amp;x=1">回复通知</a>', targetRow: { id: '9999', entityType: 'feed', message: '原动态' } });
  assert.equal(model.feedId, '3003'); assert.equal(model.replyId, '4004'); assert.equal(model.summary, '原动态');
});
test('notification and reply ids are never guessed as feed ids', () => {
  assert.equal(notificationModel({ id: '9009', message: '回复了你' }).feedId, '');
  assert.equal(notificationModel({ id: '9009', entityType: 'feedReply', message: '回复了你' }).feedId, '');
  const model = notificationModel({ id: '9009', entityType: 'feedReply', feedid: '3003' });
  assert.equal(model.feedId, '3003'); assert.equal(model.replyId, '9009');
});
test('non-feed targets remain typed entities; foreign or executable links do not become feed targets', () => {
  for (const entityType of ['product', 'apk', 'user', 'topic', 'album']) {
    const targetRow = { id: '123', entityType, message: '不是动态' }, model = notificationModel({ targetRow });
    assert.equal(model.feedId, ''); assert.deepEqual(model.entity, targetRow);
  }
  for (const note of ['<a href="https://evil.example/feed/123?rid=45">x</a>', '<a href="javascript:alert(1)">x</a>']) {
    const model = notificationModel({ id: '789', note }); assert.equal(model.feedId, ''); assert.equal(model.link, '');
  }
});
test('explicit parent ids, original-feed previews and row unread markers are preserved', () => {
  const model = notificationModel({ id: '9009', fid: '3003', unread_count: 0, isnew: 2, feedInfo: { entityType: 'feed', id: '3003', message_title: '原动态标题', message: '正文' } });
  assert.equal(model.feedId, '3003'); assert.equal(model.summary, '原动态标题'); assert.equal(model.unread, 2);
  assert.equal(notificationModel({ targetRow: { id: '3003', message: '旧接口未标记类型的动态正文' } }).feedId, '3003');
});
test('malformed metadata and system uid zero cannot create interactive targets', () => {
  for (const source of [null, [], false, 'data']) assert.equal(notificationModel(source).feedId, '');
  assert.equal(notificationModel({ fromuid: '0', feedInfo: null, targetRow: [] }).actor.uid, '');
});
