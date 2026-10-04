import test from 'node:test';
import assert from 'node:assert/strict';
import { coolapkRoute, deepLinkWebUrl } from '../core/navigation.mjs';
test('official mobile, hash and native feed links retain the target reply', () => {
  for (const source of ['https://m.coolapk.com/feed/123?rid=45', 'https://www.coolapk.com/#/feed/123?rid=45', 'coolmarket://com.coolapk.market/feed/123?rid=45', 'coolmarket://com.coolapk.desktop/feed/123?rid=45']) assert.deepEqual(coolapkRoute(source), { kind: 'feed', id: '123', replyId: '45' });
  assert.equal(deepLinkWebUrl('coolmarket://m.coolapk.com/#/feed/123?rid=45'), 'https://www.coolapk.com/feed/123?rid=45');
});
test('app/detail, product/detail and wrapped topic URLs reach the correct entity', () => {
  assert.equal(coolapkRoute('/apk/detail?packageName=com.coolapk.market').id, 'com.coolapk.market'); assert.equal(coolapkRoute('/product/detail?id=42').kind, 'product');
  assert.equal(coolapkRoute('/page?url=%2Ftopic%2FtagFeedList%3Ftag%3DAndroid%252016').tag, 'Android 16');
  assert.equal(coolapkRoute('/apk/list'), null);
  assert.equal(coolapkRoute('#/topic/userFollowTagList?uid=123').kind, 'followedTopics');
  assert.equal(coolapkRoute('/topic/tagList?title=讨论区').kind, 'page');
});
test('foreign hosts, credentials, ports, malformed IDs and arbitrary deep actions cannot navigate internally', () => {
  for (const source of ['coolmarket://evil.example/feed/123', 'coolmarket://user@com.coolapk.market/feed/123', 'https://www.coolapk.com:8443/feed/123', 'https://www.coolapk.com.evil/feed/123', 'javascript:alert(1)', '/feed/123456789012345678901', 'coolmarket://com.coolapk.market/feed/deleteFeed?id=123', '/topic/%E0%A4%A']) assert.equal(coolapkRoute(source), null);
});
test('Kankan more links keep the read-only list and its server filters', () => {
  const route = { kind: 'page', title: '小编推荐', url: '/dyh/list?type=editor&title=%E5%B0%8F%E7%BC%96%E6%8E%A8%E8%8D%90' };
  assert.deepEqual(coolapkRoute('#' + route.url), route);
  assert.deepEqual(coolapkRoute('/page?url=' + encodeURIComponent(route.url)), route);
  assert.equal(coolapkRoute('#/dyh/follow?id=91'), null);
});
