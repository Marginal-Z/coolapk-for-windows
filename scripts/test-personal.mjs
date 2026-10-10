import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/personal-check', { recursive: true });
writeFileSync('.local/personal-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><main id="root"></main><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import PersonalScreen from'/src/Personal.tsx';import'/src/styles.css';
function Harness(){const[state,setState]=useState({namespace:'123456',account:{uid:'123456',username:'测试账号'},page:{kind:'personal',type:'products',title:'我的数码'}});useEffect(()=>{window.__personalNavigate=next=>setState(old=>({...old,...next}));},[]);return React.createElement('div',{'data-personal-route':JSON.stringify({type:state.page.type,id:state.page.id||'',namespace:state.namespace,uid:state.account?.uid||''})},React.createElement(PersonalScreen,{...state,onLogin:()=>{window.__personalLogins=(window.__personalLogins||0)+1;},go:page=>{window.__personalOpened=page;if(page.kind==='personal')setState(old=>({...old,page}));},openEntity:entity=>{window.__personalOpenedEntity=entity;},feedProps:{onUser:()=>{},onLink:url=>{window.__personalLinked=url;},onOpen:()=>{}},toast:message=>{window.__personalToast=message;}}));}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_PERSONAL_PORT || 5296), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
const record = async (name, action) => { await action(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1050, height: 850 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__personalMock = { calls: [], fail: null, hold: false, release: null, heldVerify: false, releaseVerify: null, deleteError: false, blockError: false, blocks: [], empty: false };
    window.coolapk = {
      verify: async () => { if (mock.heldVerify) await new Promise(resolve => { mock.releaseVerify = resolve; }); mock.fail = null; mock.deleteError = false; mock.blockError = false; return { ok: true, data: {} }; },
      openExternal: async url => { window.__personalExternal = url; return { ok: true, data: null }; },
      call: async (operation, args) => {
        mock.calls.push({ operation, args: structuredClone(args) });
        const delayedRead = mock.hold && operation === 'personalProductFollowing';
        if (delayedRead) await new Promise(resolve => { mock.release = resolve; });
        if (mock.fail && operation === mock.fail.operation && Number(args.page || 1) === mock.fail.page) return { ok: false, error: { message: '模拟个人列表失败', code: mock.fail.code || 'NETWORK', ...(mock.fail.code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-personal-verify' } : {}) } };
        if (operation === 'personalBackupDelete' && mock.deleteError) return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟删除需要验证', verificationId: 'synthetic-personal-verify' } };
        if (operation === 'personalBackupDelete') return { ok: true, data: { data: 1 } };
        if (operation === 'personalHomeBlocks') return { ok: true, data: { data: { rules: structuredClone(mock.blocks), maxCount: 100 } } };
        if (operation === 'personalHomeBlockUpdate') {
          if (mock.blockError) return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟屏蔽需要验证', verificationId: 'synthetic-block-verify' } };
          const same = rule => rule.scope === args.scope && (args.scope === 'node' ? rule.tid === args.tid && rule.name === args.name : rule.value === args.value);
          if (args.action === 'cancel') mock.blocks = mock.blocks.filter(rule => !same(rule));
          else if (!mock.blocks.some(same)) mock.blocks.push({ scope: args.scope, ...(args.scope === 'node' ? { tid: args.tid, name: args.name, title: args.name } : { value: args.value, title: args.scope === 'user' ? '模拟搜索酷友' : args.value }) });
          return { ok: true, data: { data: { rules: structuredClone(mock.blocks), maxCount: 100 } } };
        }
        if (operation === 'personalNodePicker') return { ok: true, data: { data: args.category === 'recent' && !args.keyword ? [] : args.category === 'product' ? [{ id: '17', entityType: 'product', title: '模拟搜索数码' }] : args.category === 'apk' ? [{ id: '18', entityType: 'apk', title: '模拟搜索应用' }] : [{ id: '19', entityType: 'feedTopic', title: '模拟搜索话题' }], hasMore: false } };
        if (operation === 'personalDyhRecommendations') { const page = Number(args.page || 1), sections = [{ title: '小编推荐', url: '#/dyh/list?type=editor', entities: [{ id: '21', entityType: 'dyh', title: '小编模拟看看号', follownum: 20, userAction: { follow: 0 } }, ...(page > 1 ? [{ id: '23', entityType: 'dyh', title: '分页模拟看看号', follownum: 30, userAction: { follow: 0 } }] : [])] }, ...(page === 1 ? [{ title: '站内订阅', entities: [{ id: '22', entityType: 'dyh', title: '站内模拟看看号', follownum: 40, userAction: { follow: 1 } }] }] : [])]; return { ok: true, data: { data: sections.flatMap(section => section.entities), sections, hasMore: page < 2, firstItem: '21', lastItem: page === 1 ? '22' : '23', pageContext: 'recommend-synthetic-context' } }; }
        if (operation === 'catalogDyhFollow' || operation === 'catalogDyhUnfollow') return { ok: true, data: { data: 1 } };
        if (operation === 'search') return { ok: true, data: { data: args.type === 'user' ? [{ uid: '987654', entityType: 'user', username: '模拟搜索酷友' }] : [{ id: '17', entityType: 'product', title: '模拟搜索数码' }], hasMore: false } };
        if (operation === 'personalBackup') return { ok: true, data: { data: { id: args.id, uid: '123456', title: '模拟备份单', device_title: '模拟手机', apk_num: 2, localEntities: [{ id: '91', entityType: 'apk', title: '备份应用甲', packageName: 'com.example.synthetic' }], unLocalEntities: [{ appName: '未收录应用乙', versionName: '1.0' }] } } };
        if (operation === 'personalBackups') return { ok: true, data: { data: mock.empty ? [] : [{ id: '17', uid: '123456', entityType: 'back', title: '模拟备份单', apk_num: 2 }], hasMore: false } };
        if (operation === 'goodsAlbums') return { ok: true, data: { data: mock.empty ? [] : [{ id: '41', entityType: 'productAlbum', title: '模拟我的清单' }], hasMore: false } };
        if (operation.startsWith('catalogDyh')) return { ok: true, data: { data: [{ id: '21', entityType: 'dyh', title: '模拟看看号' }], hasMore: false } };
        const page = Number(args.page || 1), title = operation === 'personalProductFollowing' ? '关注' : args.type;
        return { ok: true, data: { data: mock.empty ? [] : [{ id: String(page + 30), entityType: 'product', title: delayedRead ? '旧账号迟到数码' : '模拟数码-' + title + '-' + page }], firstItem: '31', lastItem: String(page + 30), pageContext: 'synthetic-personal-context', hasMore: page < 2 } };
      },
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/personal-harness.html'); await page.getByText('模拟数码-关注-1', { exact: true }).waitFor();
  const calls = operation => page.evaluate(operation => window.__personalMock.calls.filter(call => call.operation === operation), operation);
  // A React setter schedules a commit; it does not make old same-name content safe to inspect.
  const navigate = async (type, patch = {}) => {
    const expected = await page.evaluate(({ type, patch }) => {
      const previous = JSON.parse(document.querySelector('[data-personal-route]').getAttribute('data-personal-route'));
      const next = { page: { kind: 'personal', type, title: '个人功能' }, ...patch };
      window.__personalNavigate(next);
      return JSON.stringify({ type: next.page.type, id: next.page.id || '', namespace: next.namespace ?? previous.namespace, uid: 'account' in next ? next.account?.uid || '' : previous.uid });
    }, { type, patch });
    await page.waitForFunction(expected => document.querySelector('[data-personal-route]')?.getAttribute('data-personal-route') === expected, expected);
  };
  await record('my digital default follows, exact four ordered phone tabs and reused owner/wish/buy requests', async () => {
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['关注', '机主', '想买', '买过']); assert.deepEqual((await calls('personalProductFollowing'))[0].args, {});
    for (const [title, type] of [['机主', 'owner'], ['想买', 'wish'], ['买过', 'buy']]) { await page.getByRole('tab', { name: title, exact: true }).click(); await page.getByText('模拟数码-' + type + '-1', { exact: true }).waitFor(); assert.deepEqual((await calls('catalogMyProducts')).at(-1).args, { type }); }
    await page.getByText('模拟数码-buy-1', { exact: true }).click(); assert.equal(await page.evaluate(() => window.__personalOpenedEntity.entityType), 'product');
  });
  await record('follow pagination retains first-page rows and retries exact cursors and pageContext after failure', async () => {
    await page.getByRole('tab', { name: '关注', exact: true }).click(); await page.getByText('模拟数码-关注-1', { exact: true }).waitFor();
    await page.evaluate(() => { window.__personalMock.fail = { operation: 'personalProductFollowing', page: 2 }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟个人列表失败', { exact: true }).waitFor();
    assert.equal(await page.getByText('模拟数码-关注-1', { exact: true }).count(), 1);
    await page.evaluate(() => { window.__personalMock.fail = null; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('模拟数码-关注-2', { exact: true }).waitFor();
    const requests = (await calls('personalProductFollowing')).filter(call => call.args.page === 2); assert.deepEqual(requests[0].args, { page: 2, firstItem: '31', lastItem: '31', pageContext: 'synthetic-personal-context' }); assert.deepEqual(requests[0], requests[1]);
  });
  await record('read error offers retry and never shows a successful empty list, while actual empty results show the correct state', async () => {
    await page.evaluate(() => { window.__personalMock.fail = { operation: 'personalProductFollowing', page: 1 }; }); await page.getByRole('button', { name: '刷新我的数码', exact: true }).click(); await page.getByText('模拟个人列表失败', { exact: true }).waitFor(); assert.equal(await page.getByText('还没有关注数码吧', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__personalMock.fail = null; window.__personalMock.empty = true; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('还没有关注数码吧', { exact: true }).waitFor(); await page.evaluate(() => { window.__personalMock.empty = false; });
  });
  await record('late account-owned product results cannot appear after selecting a new account', async () => {
    await page.evaluate(() => { window.__personalMock.hold = true; }); await navigate('products', { namespace: 'old-account' }); await page.waitForFunction(() => !!window.__personalMock.release);
    await page.evaluate(() => { window.__personalMock.hold = false; }); await navigate('products', { namespace: '654321', account: { uid: '654321', username: '新账号' } }); await page.getByText('模拟数码-关注-1', { exact: true }).waitFor(); await page.evaluate(() => window.__personalMock.release()); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByText('模拟数码-关注-1', { exact: true }).count(), 1); assert.equal(await page.getByText('旧账号迟到数码', { exact: true }).count(), 0);
  });
  await record('my lists bind current account uid, display the native read list and open existing album detail without an invented create button', async () => {
    await navigate('lists'); await page.getByText('模拟我的清单', { exact: true }).waitFor(); assert.deepEqual((await calls('goodsAlbums')).at(-1).args, { uid: '654321' }); assert.equal(await page.getByRole('button', { name: /创建/ }).count(), 0);
    await page.getByText('模拟我的清单', { exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.__personalOpened), { kind: 'goods', type: 'album', id: '41', uid: '654321', title: '模拟我的清单' });
  });
  await record('my kankan follows the exact two phone tabs and reuses following/editor read contracts', async () => {
    await navigate('dyhs'); await page.getByText('模拟看看号', { exact: true }).waitFor();
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['我关注的', '我管理的']);
    for (const [title, operation] of [['我关注的', 'catalogDyhFollowing'], ['我管理的', 'catalogDyhEditing']]) { await page.getByRole('tab', { name: title, exact: true }).click(); await page.getByRole('tab', { name: title, exact: true, selected: true }).waitFor(); await page.waitForFunction(operation => window.__personalMock.calls.some(call => call.operation === operation), operation); assert.ok((await calls(operation)).length); }
    assert.equal((await calls('catalogDyhSubscriptions')).length, 0);
  });
  await record('my kankan plus button opens native recommendation groups, subscribe actions and server more links', async () => {
    await page.getByRole('button', { name: '添加更多看看号', exact: true }).click(); await page.getByText('小编模拟看看号', { exact: true }).waitFor(); assert.equal(await page.getByRole('heading', { name: '小编推荐', exact: true }).count(), 1); assert.equal(await page.getByRole('heading', { name: '站内订阅', exact: true }).count(), 1); assert.deepEqual((await calls('personalDyhRecommendations')).at(-1).args, {});
    await page.getByRole('button', { name: '查看更多', exact: true }).click(); assert.equal(await page.evaluate(() => window.__personalLinked), '#/dyh/list?type=editor');
    await page.getByRole('button', { name: '订阅', exact: true }).click(); await page.waitForFunction(() => window.__personalMock.calls.some(call => call.operation === 'catalogDyhFollow')); assert.deepEqual((await calls('catalogDyhFollow')).at(-1).args, { id: '21' });
    await page.getByRole('button', { name: '取消订阅', exact: true }).last().click(); await page.waitForFunction(() => window.__personalMock.calls.some(call => call.operation === 'catalogDyhUnfollow')); assert.deepEqual((await calls('catalogDyhUnfollow')).at(-1).args, { id: '22' });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('分页模拟看看号', { exact: true }).waitFor(); assert.equal(await page.getByText('小编模拟看看号', { exact: true }).count(), 1); assert.equal(await page.getByText('站内模拟看看号', { exact: true }).count(), 1); assert.deepEqual((await calls('personalDyhRecommendations')).at(-1).args, { page: 2, firstItem: '21', lastItem: '22', pageContext: 'recommend-synthetic-context' });
    await page.getByRole('button', { name: '小编模拟看看号', exact: false }).click(); assert.deepEqual(await page.evaluate(() => window.__personalOpened), { kind: 'catalog', type: 'dyh', id: '21', title: '小编模拟看看号' });
  });
  await record('backup list and detail show application records, omit phone handoff and require explicit confirmed deletion', async () => {
    await navigate('backups', { namespace: '123456', account: { uid: '123456', username: '测试账号' } }); await page.getByText('模拟备份单', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '创建手机应用备份', exact: true }).count(), 0);
    await page.getByText('模拟备份单', { exact: true }).click(); await page.getByText('备份应用甲', { exact: true }).waitFor(); await page.getByText('未收录应用乙', { exact: true }).waitFor(); assert.deepEqual((await calls('personalBackup')).at(-1).args, { id: '17' });
    assert.equal(await page.getByRole('button', { name: '在手机上恢复应用', exact: true }).count(), 0);
    await page.getByRole('button', { name: '删除备份单', exact: true }).click(); await page.getByRole('dialog', { name: '删除备份单' }).waitFor(); assert.equal((await calls('personalBackupDelete')).length, 0); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal((await calls('personalBackupDelete')).length, 0);
    await page.getByRole('button', { name: '删除备份单', exact: true }).click(); await page.evaluate(() => { window.__personalMock.deleteError = true; }); await page.getByRole('button', { name: '确认删除备份单', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByRole('heading', { name: '备份列表', exact: true }).waitFor(); const deletes = await calls('personalBackupDelete'); assert.equal(deletes.length, 2); assert.deepEqual(deletes[0].args, { id: '17' }); assert.deepEqual(deletes[0], deletes[1]);
  });
  await record('late delete verification after account switch cannot replay the old backup operation', async () => {
    await page.getByText('模拟备份单', { exact: true }).click(); await page.getByText('备份应用甲', { exact: true }).waitFor(); await page.getByRole('button', { name: '删除备份单', exact: true }).click(); await page.evaluate(() => { window.__personalMock.deleteError = true; window.__personalMock.heldVerify = true; }); await page.getByRole('button', { name: '确认删除备份单', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__personalMock.releaseVerify);
    const before = (await calls('personalBackupDelete')).length; await navigate('products', { namespace: 'new-owner-123', account: { uid: '654321', username: '新账号' } }); await page.getByText('模拟数码-关注-1', { exact: true }).waitFor(); await page.evaluate(() => window.__personalMock.releaseVerify()); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal((await calls('personalBackupDelete')).length, before);
  });
  await record('home block tabs mirror cloud counts, validate phone keyword rules, synchronize writes and confirm cancellation', async () => {
    await navigate('blocks', { namespace: '123456', account: { uid: '123456', username: '测试账号' } }); await page.getByText('暂无节点屏蔽', { exact: true }).waitFor(); assert.deepEqual(await page.getByRole('tab').allTextContents(), ['节点屏蔽（0）', '用户屏蔽（0）', '关键字屏蔽（0）']);
    await page.getByRole('button', { name: '屏蔽说明', exact: true }).click(); assert.equal(await page.evaluate(() => window.__personalExternal), 'https://m.coolapk.com/mp/user/spamWordListDescription');
    await page.getByRole('tab', { name: '关键字屏蔽（0）', exact: true }).click(); await page.getByRole('button', { name: '添加关键字', exact: true }).click(); await page.getByRole('textbox', { name: '首页屏蔽关键字', exact: true }).fill('一'); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '关键字需为2-15字' }).waitFor(); assert.equal((await calls('personalHomeBlockUpdate')).length, 0);
    await page.getByRole('textbox', { name: '首页屏蔽关键字', exact: true }).fill('模拟关键词'); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.getByRole('tab', { name: '关键字屏蔽（1）', exact: true }).waitFor(); assert.deepEqual((await calls('personalHomeBlockUpdate')).at(-1).args, { scope: 'word', action: 'add', value: '模拟关键词' });
    await page.getByRole('button', { name: '取消屏蔽 模拟关键词', exact: true }).click(); const before = (await calls('personalHomeBlockUpdate')).length; await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal((await calls('personalHomeBlockUpdate')).length, before);
    await page.getByRole('button', { name: '取消屏蔽 模拟关键词', exact: true }).click(); await page.getByRole('button', { name: '确认取消屏蔽', exact: true }).click(); await page.getByRole('tab', { name: '关键字屏蔽（0）', exact: true }).waitFor(); assert.deepEqual((await calls('personalHomeBlockUpdate')).at(-1).args, { scope: 'word', action: 'cancel', value: '模拟关键词' });
  });
  await record('node picker uses real recent/search categories and submits confirmed full ID; user selection submits a uid', async () => {
    await page.getByRole('tab', { name: '节点屏蔽（0）', exact: true }).click(); await page.getByRole('button', { name: '添加节点', exact: true }).click(); await page.getByRole('dialog', { name: '选择屏蔽节点', exact: true }).waitFor(); assert.deepEqual(await page.getByRole('dialog').getByRole('tab').allTextContents(), ['最近', '话题', '数码', '应用']);
    await page.getByRole('dialog').getByRole('tab', { name: '数码', exact: true }).click(); await page.getByText('模拟搜索数码', { exact: true }).waitFor(); await page.getByText('模拟搜索数码', { exact: true }).click(); await page.getByRole('button', { name: '确定屏蔽', exact: true }).click(); await page.getByRole('tab', { name: '节点屏蔽（1）', exact: true }).waitFor(); assert.deepEqual((await calls('personalHomeBlockUpdate')).at(-1).args, { scope: 'node', action: 'add', tid: '7000000017', name: '模拟搜索数码' });
    await page.getByRole('tab', { name: '用户屏蔽（0）', exact: true }).click(); await page.getByRole('button', { name: '添加用户', exact: true }).click(); await page.getByRole('searchbox', { name: '搜索屏蔽用户', exact: true }).fill('模拟'); await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click(); await page.getByText('模拟搜索酷友', { exact: true }).click(); await page.getByRole('button', { name: '确定屏蔽', exact: true }).click(); await page.getByRole('tab', { name: '用户屏蔽（1）', exact: true }).waitFor(); assert.deepEqual((await calls('personalHomeBlockUpdate')).at(-1).args, { scope: 'user', action: 'add', value: '987654' });
  });
  await record('node keyword switches recent to combined search and each tab retains the submitted query', async () => {
    await page.getByRole('tab', { name: '节点屏蔽（1）', exact: true }).click(); await page.getByRole('button', { name: '添加节点', exact: true }).click(); await page.getByRole('searchbox', { name: '搜索屏蔽节点', exact: true }).fill('安卓'); await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click(); await page.getByRole('dialog').getByRole('tab', { name: '综合', exact: true }).waitFor(); assert.deepEqual((await calls('personalNodePicker')).at(-1).args, { category: 'recent', keyword: '安卓' });
    await page.getByRole('dialog').getByRole('tab', { name: '应用', exact: true }).click(); await page.getByText('模拟搜索应用', { exact: true }).waitFor(); assert.deepEqual((await calls('personalNodePicker')).at(-1).args, { category: 'apk', keyword: '安卓' }); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  });
  await record('cloud block read errors preserve prior records and old verification cannot replay into a new account', async () => {
    await page.getByRole('tab', { name: '用户屏蔽（1）', exact: true }).click();
    await page.evaluate(() => { window.__personalMock.fail = { operation: 'personalHomeBlocks', page: 1 }; }); await page.getByRole('button', { name: '刷新屏蔽设置', exact: true }).click(); await page.getByText('模拟个人列表失败', { exact: true }).waitFor(); assert.equal(await page.getByText('模拟搜索酷友', { exact: true }).count(), 1); await page.evaluate(() => { window.__personalMock.fail = null; }); await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('tab', { name: '关键字屏蔽（0）', exact: true }).click(); await page.getByRole('button', { name: '添加关键字', exact: true }).click(); await page.getByRole('textbox', { name: '首页屏蔽关键字', exact: true }).fill('迟到关键词'); await page.evaluate(() => { window.__personalMock.blockError = true; window.__personalMock.heldVerify = true; window.__personalMock.releaseVerify = null; }); await page.getByRole('button', { name: '确定', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__personalMock.releaseVerify);
    const before = (await calls('personalHomeBlockUpdate')).length; await navigate('products', { namespace: 'new-block-owner', account: { uid: '654321', username: '新账号' } }); await page.getByText('模拟数码-关注-1', { exact: true }).waitFor(); await page.evaluate(() => window.__personalMock.releaseVerify()); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal((await calls('personalHomeBlockUpdate')).length, before);
  });
  await record('guest personal pages do not issue authenticated reads and offer login, while narrow keyboard navigation stays usable', async () => {
    const before = (await calls('personalProductFollowing')).length; await navigate('products', { namespace: 'guest', account: null }); await page.getByRole('button', { name: '登录酷安', exact: true }).click(); assert.equal(await page.evaluate(() => window.__personalLogins), 1); assert.equal((await calls('personalProductFollowing')).length, before);
    await navigate('hub'); await page.setViewportSize({ width: 560, height: 760 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/personal-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic renderer contracts, external requests blocked, no real cloud writes or phone operations', checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
