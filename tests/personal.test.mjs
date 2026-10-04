import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchPersonal, PERSONAL_OPERATIONS, personalListResult } from '../core/personal.mjs';
import { PERSONAL_PRODUCT_TABS, PERSONAL_ENTRIES, homeBlockChange, homeBlockIncludes, homeNodeChoice, normalizeHomeBlocks, personalEntryPage, personalHeadlineVisible, personalProductTarget } from '../core/personal-models.mjs';
const require = createRequire(import.meta.url);
const { AccountScope } = require('../electron/request-scope.cjs');
const identity = { uid: '123456' };
const json = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
function mock(fetcher = () => json([]), loggedIn = true) {
  const calls = [];
  const client = new CoolapkClient({ identity: loggedIn ? identity : null, cookie: loggedIn ? 'session=test-only' : '', fetchImpl: async (value, init) => { const url = new URL(value); calls.push({ url, init }); return fetcher(url, init, calls.length); } });
  return { client, calls, run: (operation, args) => dispatchPersonal(client, operation, args) };
}

test('personal products match the four official phone tabs and reuse existing exact contracts', () => {
  assert.deepEqual(PERSONAL_PRODUCT_TABS.map(({ id, title, operation, args }) => ({ id, title, operation, args })), [
    { id: 'following', title: '关注', operation: 'personalProductFollowing', args: {} },
    { id: 'owner', title: '机主', operation: 'catalogMyProducts', args: { type: 'owner' } },
    { id: 'wish', title: '想买', operation: 'catalogMyProducts', args: { type: 'wish' } },
    { id: 'buy', title: '买过', operation: 'catalogMyProducts', args: { type: 'buy' } },
  ]);
  for (const entry of PERSONAL_ENTRIES) assert.deepEqual(personalEntryPage(entry.id), entry.page);
  const copy = personalEntryPage('products'); copy.title = 'changed'; assert.equal(personalEntryPage('products').title, '我的数码');
  assert.equal(personalEntryPage('delete-account'), null);
});

test('product navigation accepts confirmed product IDs and never promotes arbitrary server URLs', () => {
  assert.deepEqual(personalProductTarget({ id: 17, entityType: 'product', title: '数码' }), { id: '17', entityType: 'product', title: '数码' });
  assert.equal(personalProductTarget({ id: 17, entityType: 'user', uid: '18', url: '/account/delete' }), null);
  assert.equal(personalProductTarget({ id: 'javascript:alert(1)', entityType: 'product' }), null);
  assert.equal(personalProductTarget({ title: '未来卡片', url: '/account/delete' }), null);
  assert.equal(personalProductTarget({ productInfo: { productId: 22, title: '已关注数码' } }).id, '22');
});

test('followed digital products use the fixed reference read descriptor with pageContext and exact cursors', async () => {
  const { run, calls } = mock(() => new Response(JSON.stringify({ data: [{ entityType: 'card', entities: [{ id: 17, entityType: 'product', title: '数码' }] }], pageContext: 'synthetic-context', hasMore: true })));
  const result = await run('personalProductFollowing', { page: 2, firstItem: '3', lastItem: '16', pageContext: 'prior-context' });
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { url: '#/product/followProductList?&title=我关注的数码吧', title: '我关注的数码吧', subTitle: '', page: '2', firstItem: '3', lastItem: '16', pageContext: 'prior-context' });
  assert.equal(calls[0].url.pathname, '/v6/page/dataList'); assert.equal(calls[0].init.method, 'GET'); assert.equal(result.data[0].id, 17); assert.equal(result.firstItem, '17'); assert.equal(result.pageContext, 'synthetic-context');
  await run('personalProductFollowing'); assert.equal(calls[1].url.searchParams.get('page'), '1'); assert.equal(calls[1].url.searchParams.get('firstItem'), '');
});

test('personal reads require login and reject arbitrary endpoints, owners and malformed pagination before fetching', async () => {
  const guest = mock(undefined, false);
  for (const operation of PERSONAL_OPERATIONS) await assert.rejects(guest.run(operation, { id: '17' }), e => e.code === 'LOGIN_REQUIRED');
  assert.equal(guest.calls.length, 0);
  const { run, calls } = mock();
  for (const args of [{ uid: '654321' }, { endpoint: '/v6/account/delete' }, { url: '#/account/delete' }, { page: 0 }, { page: 1001 }, { page: [] }, { page: '1e0' }, { firstItem: '\n' }, { pageContext: 'a'.repeat(2001) }]) await assert.rejects(run('personalProductFollowing', args), e => e.code === 'INPUT');
  for (const args of [{ pageContext: 'arbitrary' }, { uid: '654321' }, { page: 0 }, { page: true }]) await assert.rejects(run('personalBackups', args), e => e.code === 'INPUT');
  assert.equal(calls.length, 0); assert.equal(await run('futureOperation'), undefined);
});

test('personal lists retain unknown entities and do not convert malformed or failed envelopes into empty success', async () => {
  const row = { entityType: 'future-card', title: '未来内容', futureField: 'preserved' };
  assert.deepEqual(personalListResult({ data: [row], has_more: '0' }).data, [row]);
  assert.equal(personalListResult({ data: [] }).hasMore, false);
  for (const result of [{ data: { future: [] } }, { data: [], hasMore: 'unknown' }, { data: [], pageContext: {} }, { data: [], lastItem: 'a'.repeat(121) }]) assert.throws(() => personalListResult(result), e => e.code === 'API_ERROR');
  await assert.rejects(mock(() => new Response(JSON.stringify({ status: 403, message: '备份权限不可用' }))).run('personalBackups'), e => e.code === 'API_ERROR');
});

test('backup reads use recovered official annotations and preserve BackupInfo application records', async () => {
  const info = { id: '17', uid: identity.uid, title: '测试备份', apk_num: 2, localEntities: [{ id: 11, entityType: 'apk', title: '应用一' }], unLocalEntities: [{ appName: '未收录应用' }] };
  const { run, calls } = mock(url => json(url.pathname.endsWith('/detail') ? info : [info]));
  const result = await run('personalBackups', { page: 2, firstItem: '1', lastItem: '16' }); assert.equal(result.data[0].title, '测试备份');
  assert.equal(calls[0].url.pathname, '/v6/backList/list'); assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { page: '2', firstItem: '1', lastItem: '16' }); assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual((await run('personalBackup', { id: '17' })).data, info); assert.equal(calls[1].url.pathname, '/v6/backList/detail'); assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), { id: '17' });
  await assert.rejects(mock(() => json([{ id: '17', uid: '654321' }])).run('personalBackups'), e => e.code === 'API_ERROR');
});

test('backup deletion re-reads exact ID and current ownership before recovered GET deletion, never trusting renderer uid', async () => {
  const { run, calls } = mock(url => json(url.pathname.endsWith('/detail') ? { id: '17', uid: identity.uid, localEntities: [] } : 1));
  await run('personalBackupDelete', { id: '17' });
  assert.deepEqual(calls.map(call => call.url.pathname), ['/v6/backList/detail', '/v6/backList/delete']); assert.ok(calls.every(call => call.init.method === 'GET')); assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), { id: '17' });
  await assert.rejects(run('personalBackupDelete', { id: '17', uid: identity.uid }), e => e.code === 'INPUT'); assert.equal(calls.length, 2);
  for (const info of [{ id: '17', uid: '654321' }, { id: '18', uid: identity.uid }, { id: '17' }, []]) {
    const other = mock(() => json(info)); await assert.rejects(other.run('personalBackupDelete', { id: '17' }), e => e.code === 'INPUT'); assert.equal(other.calls.length, 1);
  }
});

test('account switch while verifying backup ownership prevents the delete request and discards its result', async () => {
  let release; const hold = new Promise(resolve => { release = resolve; });
  const { client, calls } = mock(async () => { await hold; return json({ id: '17', uid: identity.uid }); });
  const accountScope = new AccountScope(), context = accountScope.capture(client);
  const pending = dispatchPersonal(context.client, 'personalBackupDelete', { id: '17' }); accountScope.changed(); client.identity = { uid: '654321' }; release();
  await assert.rejects(pending, e => e.code === 'ACCOUNT_CHANGED'); assert.equal(calls.length, 1);
});

const blockData = (config = {}, maxCount = 100) => ({ spam_word_config: JSON.stringify(config), spam_word_config_max_count: maxCount });
test('official cloud block response distinguishes stored custom words from submitted word changes and preserves known fields', () => {
  const parsed = normalizeHomeBlocks(blockData({ custom: [{ title: '关键字' }], user: [{ uid: '654321', name: '示例酷友', logo: 'https://avatar.coolapk.com/synthetic.png' }], node: [{ targetFullId: '7000000017', title: '示例数码', type: 'product', logo: '' }] }, '100'));
  assert.deepEqual(parsed, { maxCount: 100, rules: [{ scope: 'word', value: '关键字', title: '关键字' }, { scope: 'node', tid: '7000000017', name: '示例数码', title: '示例数码', nodeType: 'product', logo: '' }, { scope: 'user', value: '654321', title: '示例酷友', logo: 'https://avatar.coolapk.com/synthetic.png' }] });
  assert.deepEqual(normalizeHomeBlocks({ spam_word_config: '' }), { rules: [], maxCount: null });
  assert.deepEqual(normalizeHomeBlocks({ spam_word_config: null, spam_word_config_max_count: 100 }), { rules: [], maxCount: 100 });
  for (const input of [null, [], {}, { spam_word_config: {} }, { spam_word_config: '[1]' }, { spam_word_config: 'bad' }, blockData({ custom: 'bad' }), blockData({ node: [{ targetFullId: '/account/delete', title: 'bad' }] }), blockData({ user: [{ uid: 'javascript:1' }] }), blockData({}, -1)]) assert.throws(() => normalizeHomeBlocks(input));
});

test('home block changes use exact node array, user uid string and word forms with official add validation', () => {
  assert.deepEqual(homeBlockChange({ scope: 'node', action: 'add', tid: '7000000017', name: '示例数码' }), { node: { add: [{ tid: '7000000017', name: '示例数码' }] } });
  assert.deepEqual(homeBlockChange({ scope: 'user', action: 'cancel', value: '654321' }), { user: { cancel: '654321' } });
  assert.deepEqual(homeBlockChange({ scope: 'word', action: 'add', value: 'Android' }), { word: { add: 'Android' } });
  for (const word of ['一', '字'.repeat(16), '安卓!', '😀安卓', '安卓，手机', '   ', '安卓\n手机']) assert.throws(() => homeBlockChange({ scope: 'word', action: 'add', value: word }));
  assert.deepEqual(homeBlockChange({ scope: 'word', action: 'cancel', value: '旧版关键字!' }), { word: { cancel: '旧版关键字!' } });
  for (const args of [{ scope: 'user', action: 'add', value: '123,456' }, { scope: 'node', action: 'delete', tid: '1', name: '节点' }, { scope: 'word', action: 'add', value: '安卓', endpoint: '/v6/other' }, { scope: 'node', action: 'add', tid: '1', name: '节点', value: '1' }]) assert.throws(() => homeBlockChange(args));
});

test('node choices and feed matching follow official full ID offsets and topic zero/name matching', () => {
  const product = homeNodeChoice({ id: '17', title: '示例数码', entityType: 'product' }, 'product'); assert.equal(product.tid, '7000000017');
  const app = homeNodeChoice({ id: 'com.example.synthetic', aid: '18', title: '示例应用', entityType: 'apk' }, 'apk'); assert.equal(app.tid, '1000000018');
  const topic = homeNodeChoice({ id: '19', title: '测试话题', entityType: 'feedTopic' }, 'topic'); assert.equal(topic.tid, '3000000019');
  assert.equal(homeNodeChoice({ id: '1000000017', title: '示例数码', entityType: 'product' }, 'product').tid, '7000000017');
  for (const row of [{ id: 17, entityType: 'user', title: '例' }, { id: 'com.example.synthetic', entityType: 'apk', title: '例' }, { id: '2147483648', entityType: 'product', title: '例' }]) assert.equal(homeNodeChoice(row, row.entityType === 'apk' ? 'apk' : 'product'), null);
  const config = normalizeHomeBlocks(blockData({ custom: [{ title: 'ANDROID' }], user: [{ uid: '654321', name: '示例酷友' }], node: [{ targetFullId: product.tid, title: product.name }, { targetFullId: app.tid, title: app.name }, { targetFullId: topic.tid, title: topic.name }] }));
  assert.ok(homeBlockIncludes(config, topic)); assert.ok(homeBlockIncludes(config, { scope: 'node', tid: '0', name: '测试话题' }));
  for (const feed of [{ message: 'android 手机' }, { uid: '654321', message: '普通动态' }, { targetRow: { id: '17', url: '/product/17', title: '示例数码' } }, { targetRow: { id: '18', url: '/apk/com.example.synthetic', title: '示例应用' } }, { tags: '#测试话题#,其他话题' }, { targetRow: { id: '19', url: '/t/测试话题', title: '测试话题' } }]) assert.equal(personalHeadlineVisible(feed, config), false);
  assert.equal(personalHeadlineVisible({ uid: '123', message: '普通动态', tags: '#其他话题#' }, config), true);
  assert.equal(personalHeadlineVisible({ message: '<a href="https://android.example">普通动态</a>' }, config, '普通动态'), false);
  assert.equal(personalHeadlineVisible({ targetRow: { id: '17', url: '/product/17', title: '不同数码名称' } }, config), false);
  assert.equal(personalHeadlineVisible({ targetRow: { id: '18', url: '/product/18', title: product.name } }, config), true);
});

test('headline words inspect exact original Feed fields and preserve unrelated cards and sources', () => {
  const config = normalizeHomeBlocks(blockData({ custom: [{ title: 'Android' }] }));
  for (const field of ['messagesource', 'message', 'message_title', 'comment_good', 'comment_general', 'comment_bad']) assert.equal(personalHeadlineVisible({ entityType: 'feed', [field]: 'aNdRoId 功能' }, config), false, field);
  assert.equal(personalHeadlineVisible({ entityType: 'feed', targetRow: { title: 'Android 数码吧' } }, config), false);
  for (const field of ['title', 'message_source', 'comment_good_source', 'comment_general_source', 'comment_bad_source', 'message_keywords']) assert.equal(personalHeadlineVisible({ entityType: 'feed', [field]: 'Android' }, config), true, field);
  assert.equal(personalHeadlineVisible({ entityType: 'product', message: 'Android' }, config), true);
  assert.equal(personalHeadlineVisible({ message: 'And', message_title: 'roid' }, config), true);
  const nodeConfig = normalizeHomeBlocks(blockData({ node: [{ targetFullId: '7000000017', title: '同名节点' }] }));
  assert.equal(personalHeadlineVisible({ targetRow: { id: '19', url: '/t/同名节点', title: '同名节点' } }, nodeConfig), false);
  assert.equal(personalHeadlineVisible({ targetFullId: '7000000017', targetRow: { title: '同名节点' } }, nodeConfig), true);
});

test('headline case matching follows Java simple Unicode case mappings without multi-letter expansion', () => {
  for (const [keyword, message, blocked] of [['ANDROID', 'android', true], ['ΣΑ', 'ςα', true], ['İI', 'iı', true], ['ßß', 'SSSS', false], ['Ka', 'ka', true], ['ſa', 'sa', true], ['ﬀa', 'ffa', false], ['𐐀a', '𐐨a', true], ['安卓', '安卓', true]]) {
    const config = normalizeHomeBlocks(blockData({ custom: [{ title: keyword }] }));
    assert.equal(personalHeadlineVisible({ message }, config), !blocked, `${keyword} / ${message}`);
  }
});

test('home block read uses recovered no-argument spamWordList and rejects unexpected renderer fields', async () => {
  const { run, calls } = mock(() => json(blockData({ custom: [{ title: '模拟词语' }] })));
  assert.equal((await run('personalHomeBlocks')).data.rules[0].title, '模拟词语');
  assert.equal(calls[0].url.pathname, '/v6/user/spamWordList'); assert.equal(calls[0].url.search, ''); assert.equal(calls[0].init.method, 'GET');
  for (const args of [{ uid: '654321' }, { key: 'spam_word_config' }]) await assert.rejects(run('personalHomeBlocks', args), e => e.code === 'INPUT');
  await assert.rejects(run('personalHomeBlockUpdate', { scope: 'user', action: 'add', value: identity.uid }), e => e.code === 'INPUT');
  await assert.rejects(run('personalHomeBlockUpdate', { scope: 'word', action: 'add', value: 'a' }), e => e.code === 'INPUT'); assert.equal(calls.length, 1);
  await assert.rejects(mock(() => json({})).run('personalHomeBlocks'), e => e.code === 'API_ERROR');
});

test('cloud home block changes re-read state, POST exact diff and confirm server readback; completed retries do not duplicate writes', async () => {
  let config = {};
  const { run, calls } = mock((url, init) => {
    if (url.pathname === '/v6/account/updateConfig') { const fields = Object.fromEntries(new URLSearchParams(init.body)); assert.equal(fields.key, 'spam_word_config'); assert.deepEqual(Object.keys(fields), ['key', 'value']); const change = JSON.parse(fields.value); if (change.word?.add) config.custom = [{ title: change.word.add }]; if (change.word?.cancel) config.custom = []; return json(1); }
    assert.equal(url.pathname, '/v6/user/spamWordList'); return json(blockData(config));
  });
  const args = { scope: 'word', action: 'add', value: '模拟关键词' }; const result = await run('personalHomeBlockUpdate', args); assert.equal(result.data.rules[0].title, args.value);
  assert.deepEqual(calls.map(call => [call.url.pathname, call.init.method]), [['/v6/user/spamWordList', 'GET'], ['/v6/account/updateConfig', 'POST'], ['/v6/user/spamWordList', 'GET']]);
  assert.deepEqual(JSON.parse(new URLSearchParams(calls[1].init.body).get('value')), { word: { add: args.value } });
  assert.equal((await run('personalHomeBlockUpdate', args)).unchanged, true); assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  await run('personalHomeBlockUpdate', { ...args, action: 'cancel' }); assert.equal(config.custom.length, 0); assert.equal((await run('personalHomeBlockUpdate', { ...args, action: 'cancel' })).unchanged, true);
});

test('topic mutation accepts official readback full ID while unconfirmed or lost readback is an error and safe retry', async () => {
  let config = {}, readCount = 0;
  const { run, calls } = mock((url, init) => {
    if (init.method === 'POST') { assert.deepEqual(JSON.parse(new URLSearchParams(init.body).get('value')), { node: { add: [{ tid: '0', name: '测试话题' }] } }); config.node = [{ targetFullId: '300000019', title: '测试话题' }]; return json(1); }
    readCount++; if (readCount === 2) throw new Error('synthetic lost readback'); return json(blockData(config));
  });
  const args = { scope: 'node', action: 'add', tid: '0', name: '测试话题' };
  await assert.rejects(run('personalHomeBlockUpdate', args)); assert.equal((await run('personalHomeBlockUpdate', args)).unchanged, true); assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  await assert.rejects(mock(() => json(blockData({}))).run('personalHomeBlockUpdate', { scope: 'word', action: 'add', value: '无效读回' }), e => e.code === 'API_ERROR');
});

test('changing active account during home block read prevents any ensuing cloud write', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const { client, calls } = mock(async () => { await wait; return json(blockData()); });
  const scope = new AccountScope(), context = scope.capture(client), pending = dispatchPersonal(context.client, 'personalHomeBlockUpdate', { scope: 'word', action: 'add', value: '模拟屏蔽词' });
  scope.changed(); client.identity = { uid: '654321' }; release(); await assert.rejects(pending, e => e.code === 'ACCOUNT_CHANGED'); assert.equal(calls.length, 1);
});

test('official node selector reads real cloud recent/popular descriptors and searches the exact per-tab types', async () => {
  const { run, calls } = mock(() => json([{ id: '17', entityType: 'product', title: '模拟数码' }]));
  for (const [category, descriptor, type] of [['recent', '/member/recentFeedTargetList', 'apkAndProduct'], ['topic', '/topic/hotTagList?hotType=total&recommend=1', 'feedTopic'], ['product', '/product/categoryDetailList?type=category&id=0', 'product'], ['apk', '/apk/apkStatList?type=today&column=commentnum', 'localApkGame']]) {
    await run('personalNodePicker', { category }); assert.equal(calls.at(-1).url.pathname, '/v6/page/dataList'); assert.deepEqual(Object.fromEntries(calls.at(-1).url.searchParams), { url: descriptor, title: '', subTitle: '', page: '1' });
    await run('personalNodePicker', { category, keyword: '安卓', page: 2, firstItem: '1', lastItem: '16', pageContext: 'node-synthetic' }); assert.equal(calls.at(-1).url.pathname, '/v6/search'); assert.deepEqual(Object.fromEntries(calls.at(-1).url.searchParams), { type, searchValue: '安卓', page: '2', firstItem: '1', lastItem: '16', pageContext: 'node-synthetic' });
  }
  const before = calls.length;
  for (const args of [{ category: 'user' }, { category: 'apk', endpoint: '/v6/write' }, { category: 'recent', uid: '654321' }, { category: 'recent', keyword: '\n安卓' }, { category: 'recent', page: true }]) await assert.rejects(run('personalNodePicker', args), e => e.code === 'INPUT');
  assert.equal(calls.length, before);
});

test('my kankan recommendation uses the exact official plus-button descriptor and retains server headings and more URLs', async () => {
  const groups = [{ entityType: 'card', title: '小编推荐', url: '#/dyh/list?type=editor', entities: [{ id: '17', entityType: 'dyh', title: '模拟看看号' }] }, { entityType: 'card', title: '站内订阅', entities: [{ id: '18', entityType: 'dyh', title: '另一模拟号' }] }];
  const { run, calls } = mock(() => json(groups)); const result = await run('personalDyhRecommendations', { page: 2, firstItem: '1', lastItem: '16', pageContext: 'dyh-synthetic' });
  assert.equal(calls[0].url.pathname, '/v6/page/dataList'); assert.equal(calls[0].init.method, 'GET'); assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { url: '#V8_CHANNEL_DYH_RECOMMEND', title: '推荐订阅', subTitle: '', page: '2', firstItem: '1', lastItem: '16', pageContext: 'dyh-synthetic' });
  assert.deepEqual(result.sections.map(section => section.title), ['小编推荐', '站内订阅']); assert.equal(result.sections[0].url, groups[0].url); assert.equal(result.sections[0].entities[0].id, '17'); assert.equal(result.data.length, 2);
  await assert.rejects(run('personalDyhRecommendations', { url: '#/account/delete' }), e => e.code === 'INPUT'); assert.equal(calls.length, 1);
});
