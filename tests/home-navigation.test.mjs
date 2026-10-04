import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coolapkRoute } from '../core/navigation.mjs';
import { CoolapkClient, internalPageRoute } from '../core/client.mjs';
import { HOME_READ_LISTS } from '../core/home-navigation.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../research/home-navigation-fixtures.json', import.meta.url), 'utf8'));
test('all observed successful homepage list families navigate natively through their exact read-only contracts', async () => {
  const covered = new Set();
  for (const source of fixtures.lists) {
    const route = coolapkRoute(source); assert.equal(route?.kind, 'page', source);
    const target = new URL(source.startsWith('#/') ? source.slice(1) : source, 'https://www.coolapk.com'), direct = HOME_READ_LISTS[target.pathname].direct;
    covered.add(target.pathname);
    const resolved = internalPageRoute(route.url), expectedEndpoint = direct ? '/v6' + target.pathname : '/v6/page/dataList';
    assert.equal(resolved.endpoint, expectedEndpoint, source);
    if (!direct) assert.equal(resolved.query.url, '#' + target.pathname + target.search);
    let request;
    const client = new CoolapkClient({ fetchImpl: async (url, init) => { request = { url, init }; return new Response(JSON.stringify({ data: [{ entityType: 'feed', id: '42', message: 'synthetic' }] }), { headers: { 'content-type': 'application/json' } }); } });
    await client.dispatch('page', { url: route.url, page: 2, firstItem: 'first', lastItem: 'last' });
    assert.equal(request.url.pathname, expectedEndpoint); assert.equal(request.init.method, 'GET'); assert.equal(request.url.searchParams.get('page'), '2'); assert.equal(request.url.searchParams.get('firstItem'), 'first'); assert.equal(request.url.searchParams.get('lastItem'), 'last');
    if (!direct) assert.equal(request.url.searchParams.get('url'), '#' + target.pathname + target.search);
  }
  assert.deepEqual([...covered].sort(), Object.keys(HOME_READ_LISTS).sort());
});
test('the two separately bound app GET routes work directly, with hashes and within page wrappers', () => {
  for (const path of ['/apk/index', '/apk/giftList']) for (const source of [path, '#' + path, '/page?url=' + encodeURIComponent('#' + path)]) assert.equal(internalPageRoute(source).endpoint, '/v6' + path);
});
test('hot-search actions preserve their word and category for native, hash, mobile and page-wrapped links', () => {
  for (const source of ['searchTab://all?keyword=AI', '/search?type=hotSearch&keyword=AI', 'https://m.coolapk.com/search?type=hotSearch&keyword=AI', '#/search?type=hotSearch&keyword=AI', '/page?url=' + encodeURIComponent('searchTab://all?keyword=AI')]) assert.deepEqual(coolapkRoute(source), { kind: 'search', type: 'all', title: 'AI' });
  for (const [host, type] of [['topic', 'feedTopic'], ['feedTopic', 'feedTopic'], ['dyh', 'dyhMix'], ['app', 'apk'], ['user', 'user']]) assert.deepEqual(coolapkRoute(`searchTab://${host}?keyword=%E9%85%B7%E5%AE%89`), { kind: 'search', type, title: '酷安' });
});
test('malformed search actions cannot select writes, foreign hosts, credentials, fragments or duplicate parameters', () => {
  for (const source of ['searchTab://delete?keyword=AI', 'searchTab://all?keyword=', 'searchTab://all?keyword=%0AAI', 'searchTab://all?keyword=A%00I', 'searchTab://all?keyword=AI&keyword=other', 'searchTab://user:secret@all?keyword=AI', 'searchTab://all:443?keyword=AI', 'searchTab://all/feed?keyword=AI', 'searchTab://all?keyword=AI#foreign', 'https://evil.test/search?keyword=AI', '/search?type=delete&keyword=AI', '/search?keyword=AI&url=https://evil.test', '/search?keyword=AI&type=user&type=feed', 'searchTab://all?keyword=' + 'a'.repeat(201)]) assert.equal(coolapkRoute(source), null, source);
});
test('app and game search entry links request desktop input without sending a made-up query', () => {
  for (const [path, type] of [['/apk/search', 'apk'], ['/game/search', 'game']]) {
    for (const source of [path, '#' + path, 'https://m.coolapk.com' + path, '/page?url=' + encodeURIComponent(path)]) assert.deepEqual(coolapkRoute(source), { kind: 'search', type, title: '', inputOnly: true });
    for (const source of [path + '?keyword=AI', path + '?keyword=AI&keyword=other', path + '?url=https://evil.test', path + '/wrong', 'https://evil.test' + path, 'https://user:secret@www.coolapk.com' + path]) assert.equal(coolapkRoute(source), null, source);
  }
});
test('new list route validation rejects unknown/duplicate arguments, bad filters and nested redirects before any request', () => {
  for (const source of ['/feed/targetFeedList?sortField=delete', '/feed/targetFeedList?tagKeywords=A%00B', '/feed/targetFeedList?sortField=rank_score&sortField=lastupdate_desc', '/feed/targetFeedList?recentProductDay=-1', '/product/releasedProductList?categoryId=1000%3Bdelete', '/product/unreleasedProductList?entityTemplate=arbitraryCode', '/member/rankList?configCardExtraData=%7B%22url%22%3A%22https%3A%2F%2Fevil.test%22%7D', '/apk/index?url=https://evil.test', '/apk/giftList?apkId=bad', '/article/includeFeedList?order=delete', '/apk/rankList?page=1001', 'https://user:secret@www.coolapk.com/apk/index', 'https://www.coolapk.com:8443/apk/index', '/page?url=' + encodeURIComponent('#/feed/targetFeedList?url=/feed/deleteFeed?id=1')]) assert.throws(() => internalPageRoute(source), error => error.code === 'INPUT', source);
});
test('unavailable legacy and commerce/callback/write destinations are not added to the API whitelist', () => {
  for (const source of [...fixtures.legacyUnavailable, ...fixtures.notApiRoutes, '/feed/targetFeedDelete', '/member/delete', '/apk/uninstall']) assert.throws(() => internalPageRoute(source), source);
  assert.deepEqual(coolapkRoute('/goods/42'), { kind: 'goods', type: 'detail', id: '42', title: '好物详情' });
});
test('published navigation fixtures and reports contain no raw account/device fields or named user links', () => {
  const artifacts = ['home-navigation-fixtures.json', 'home-navigation-audit.json', 'home-navigation-live-checks.json'];
  const forbidden = new Set(['cookie', 'cookies', 'headers', 'token', 'verificationCookie', 'deviceCode', 'publicDeviceCode', 'deviceId', 'androidId', 'serial', 'username', 'userAvatar', 'identity', 'accounts', 'data', 'surfaceItems']);
  for (const name of artifacts) {
    const document = JSON.parse(readFileSync(new URL('../research/' + name, import.meta.url), 'utf8'));
    function visit(value) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, name + ':' + key); visit(child); } }
    visit(document);
    for (const row of document.routes || []) {
      if (/^\/(?:u|user)\//.test(row.destination)) assert.match(row.destination, /^\/(?:u|user)\/:(?:id|name)$/);
      assert.equal(row.destination.includes('?'), false, 'public audit must retain parameter names without values');
    }
  }
});
