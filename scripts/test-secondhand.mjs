import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_SECONDHAND_TEST_PORT || 5182), origin = `http://127.0.0.1:${port}`;
const directory = resolve('.local/secondhand-check'); mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(directory, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Secondhand from'/src/Secondhand.tsx';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'secondhand',type:'home',title:'二手市场'});const[uid,setUid]=useState('123456');window.__secondhandNavigate=(type,url)=>setPage({kind:'secondhand',type,url,title:'型号筛选'});window.__secondhandAccount=setUid;const noop=()=>{};return <main data-secondhand-account={uid||'guest'} style={{maxWidth:1000,margin:'auto',padding:30}}><Secondhand page={page} namespace={uid||'guest'} account={uid?{uid,username:'模拟酷友',userAvatar:''}:null} go={setPage} openEntity={item=>window.__secondhandMock.opened.push(item)} onLogin={noop} toast={noop} feedProps={{onOpen:item=>window.__secondhandMock.opened.push(item),onUser:noop,onLink:noop,onForward:noop,onLogin:noop,loggedIn:!!uid,accountUid:uid,toast:noop}}/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__secondhandMock = { calls: [], opened: [], holdBrand: '', held: [], failOnce: '', failCode: 'NETWORK', failInitialList: false, repeat: false, verifications: [], completedVerifications: 0, holdVerify: false, heldVerify: [] };
    const ok = data => ({ ok: true, data }), feed = (id, text) => ({ id, entityType: 'feed', feedType: 'ershou', username: '模拟卖家', uid: '987654', message: text, dateline: 1 });
    window.coolapk = { verify: async id => { mock.verifications.push(id); if (mock.holdVerify) await new Promise(resolve => mock.heldVerify.push(resolve)); mock.completedVerifications++; return ok({ verified: true }); }, call: async (operation, args = {}) => {
      const scope = document.querySelector('main')?.dataset.secondhandAccount;
      mock.calls.push({ operation, args: structuredClone(args), scope });
      if (operation === 'secondhandListings' && !args.page && mock.failInitialList) return { ok: false, error: { code: 'NETWORK', message: '模拟只读加载失败' } };
      if (mock.failOnce === operation) { mock.failOnce = ''; const code = mock.failCode; mock.failCode = 'NETWORK'; return { ok: false, error: { code, message: '模拟只读加载失败', ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-secondhand-verification' } : {}) } }; }
      if (operation === 'secondhandHome') return ok({ data: [{ id: 1, entityType: 'selectorLink', title: '闲置分类', entities: [{ id: 2, entityType: 'mainErshouType', title: '相机' }, { id: 3, entityType: 'mainErshouType', title: '手机' }, { id: 4, entityType: 'selectorLink', title: '深圳', cityId: '440300', cityTitle: '深圳', url: '#/feed/ershouList?cityId=440300&dataListType=staggered' }] }, feed(10, '首页闲置介绍')], hasMore: false });
      if (operation === 'secondhandBrands') return ok({ data: [{ id: 7, entityType: 'ershouBrand', title: '品牌甲', type: 'recommend' }, { id: 8, entityType: 'ershouBrand', title: '品牌乙', type: 'recent' }], hasMore: false });
      if (operation === 'secondhandProducts') {
        const output = ok({ data: [{ id: args.brandId === '7' ? 99 : 88, entityType: 'product', title: args.brandId === '7' ? '型号甲' : '型号乙' }], hasMore: false });
        if (args.brandId === mock.holdBrand) return new Promise(resolve => mock.held.push(() => resolve(output)));
        return output;
      }
      if (operation === 'secondhandListings') {
        if (args.page === 2) return ok({ data: mock.repeat ? [feed(20, '型号闲置第一页')] : [feed(21, '型号闲置第二页')], hasMore: false, firstItem: '20', lastItem: '21', pageContext: 'next-context' });
        return ok({ data: [feed(20, scope === '654321' ? '新账号闲置第一页' : '型号闲置第一页')], hasMore: true, firstItem: '20', lastItem: '20', pageContext: 'synthetic-context' });
      }
      if (operation === 'secondhandSearch') return ok({ data: [feed(30, '关键词搜索结果')], hasMore: false });
      throw new Error('Unexpected operation in read-only fixture: ' + operation);
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/.local/secondhand-check/test.html`); await page.getByRole('button', { name: '品牌与型号' }).waitFor();
  const navigate = (type, url) => page.evaluate(value => window.__secondhandNavigate(value.type, value.url), { type, url });
  const calls = () => page.evaluate(() => window.__secondhandMock.calls);
  const callsFor = async operation => (await calls()).filter(row => row.operation === operation);
  await record('home preserves nested category entities and available city filters', async () => {
    await page.getByText('首页闲置介绍', { exact: true }).waitFor(); await page.getByRole('button', { name: /相机/ }).click();
    await page.getByText('型号闲置第一页', { exact: true }).waitFor(); const last = (await callsFor('secondhandListings')).at(-1); assert.equal(last.args.filters.ershouType, '2'); assert.equal(last.args.filters.productId, '');
    await page.getByRole('combobox', { name: '闲置城市' }).selectOption('440300'); await page.getByRole('button', { name: '应用筛选' }).click(); await page.waitForFunction(() => window.__secondhandMock.calls.some(row => row.operation === 'secondhandListings' && row.args.filters.cityId === '440300'));
  });
  await record('brand/model picker uses exact brand type and preserves native model identity', async () => {
    await page.getByRole('button', { name: '品牌与型号' }).click(); const dialog = page.getByRole('dialog', { name: '选择闲置品牌与型号' }); await dialog.getByRole('button', { name: /型号甲/ }).waitFor(); await dialog.getByRole('button', { name: '品牌乙', exact: true }).click(); await dialog.getByRole('button', { name: /型号乙/ }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__secondhandMock.calls.some(row => row.operation === 'secondhandListings' && row.args.filters.productId === '88')); const selected = (await callsFor('secondhandListings')).at(-1); assert.equal(selected.args.filters.brand, '8'); assert.equal(selected.args.filters.ershouType, '100'); assert.equal(selected.args.filters.cityId, '440300'); assert.ok((await callsFor('secondhandProducts')).some(row => row.args.brandId === '8' && row.args.listType === 'recent'));
  });
  await record('listing pagination forwards original item cursors and server page context', async () => {
    await page.getByText('型号闲置第一页', { exact: true }).waitFor(); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('型号闲置第二页', { exact: true }).waitFor();
    const second = (await callsFor('secondhandListings')).at(-1); assert.equal(second.args.page, 2); assert.equal(second.args.firstItem, '20'); assert.equal(second.args.lastItem, '20'); assert.equal(second.args.pageContext, 'synthetic-context'); assert.equal(await page.getByRole('button', { name: '已经看完了', exact: true }).isDisabled(), true);
  });
  await record('scoped keyword search keeps model/type and never fabricates city search semantics', async () => {
    await page.getByRole('textbox', { name: '搜索闲置', exact: true }).fill('手机'); await page.getByRole('button', { name: '搜索闲置', exact: true }).click(); await page.getByText('关键词搜索结果', { exact: true }).waitFor();
    assert.deepEqual((await callsFor('secondhandSearch')).at(-1).args, { keyword: '手机', productId: '88', ershouType: '100' }); assert.equal(await page.getByRole('combobox', { name: '闲置城市' }).isDisabled(), true); await page.getByRole('button', { name: '清除搜索' }).click(); await page.getByText('型号闲置第一页', { exact: true }).waitFor();
  });
  await record('failed pagination retains successful content and displays an error rather than empty success', async () => {
    const before = (await callsFor('secondhandListings')).length;
    await page.evaluate(() => { window.__secondhandMock.failOnce = 'secondhandListings'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟只读加载失败', { exact: true }).waitFor(); assert.equal(await page.getByText('型号闲置第一页', { exact: true }).count(), 1); assert.equal(await page.getByText('暂时没有闲置内容', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('型号闲置第二页', { exact: true }).waitFor(); await page.getByText('模拟只读加载失败', { exact: true }).waitFor({ state: 'hidden' });
    const attempts = (await callsFor('secondhandListings')).slice(before); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].args, attempts[1].args); assert.equal(attempts[1].args.page, 2); assert.equal(attempts[1].args.pageContext, 'synthetic-context'); assert.equal(attempts[1].args.firstItem, '20'); assert.equal(attempts[1].args.lastItem, '20'); assert.equal(await page.getByText('型号闲置第一页', { exact: true }).count(), 1);
  });
  await record('pagination verification completion retries the same page and context while preserving prior rows', async () => {
    await navigate('list', '#/feed/ershouList?productId=99&ershouType=100'); await page.getByText('型号闲置第一页', { exact: true }).waitFor();
    const before = (await callsFor('secondhandListings')).length;
    await page.evaluate(() => { window.__secondhandMock.failOnce = 'secondhandListings'; window.__secondhandMock.failCode = 'VERIFY_REQUIRED'; });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).waitFor();
    assert.equal(await page.getByText('型号闲置第一页', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('型号闲置第二页', { exact: true }).waitFor();
    const attempts = (await callsFor('secondhandListings')).slice(before); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].args, attempts[1].args); assert.equal(attempts[1].args.page, 2); assert.equal(attempts[1].args.pageContext, 'synthetic-context');
    assert.equal(await page.getByText('型号闲置第一页', { exact: true }).count(), 1); assert.deepEqual(await page.evaluate(() => window.__secondhandMock.verifications), ['synthetic-secondhand-verification']);
  });
  await record('initial read failure retry stays on page one without item cursors or page context', async () => {
    await page.evaluate(() => { window.__secondhandMock.failInitialList = true; });
    const before = (await callsFor('secondhandListings')).length;
    await navigate('list', '#/feed/ershouList?productId=98&ershouType=100'); await page.getByText('模拟只读加载失败', { exact: true }).waitFor();
    await page.evaluate(() => { window.__secondhandMock.failInitialList = false; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('型号闲置第一页', { exact: true }).waitFor();
    const attempts = (await callsFor('secondhandListings')).slice(before); assert.ok(attempts.length >= 2); assert.deepEqual(attempts[0].args, attempts.at(-1).args); assert.equal(attempts.at(-1).args.page, undefined); assert.equal(attempts.at(-1).args.firstItem, undefined); assert.equal(attempts.at(-1).args.lastItem, undefined); assert.equal(attempts.at(-1).args.pageContext, undefined);
  });
  await record('late verification completion cannot retry an old list under a new account', async () => {
    await page.evaluate(() => { window.__secondhandMock.failOnce = 'secondhandListings'; window.__secondhandMock.failCode = 'VERIFY_REQUIRED'; window.__secondhandMock.holdVerify = true; });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => window.__secondhandMock.heldVerify.length > 0);
    await page.evaluate(() => window.__secondhandAccount('654321'));
    const currentAccount = page.locator('main[data-secondhand-account="654321"]');
    await currentAccount.waitFor(); await currentAccount.getByText('新账号闲置第一页', { exact: true }).waitFor();
    assert.equal(await currentAccount.getByText('型号闲置第一页', { exact: true }).count(), 0);
    assert.equal(await currentAccount.getByRole('button', { name: '加载更多', exact: true }).isEnabled(), true);
    assert.ok((await callsFor('secondhandListings')).some(row => row.scope === '654321' && row.args.page === undefined));
    const before = (await calls()).length;
    const completedBefore = await page.evaluate(() => window.__secondhandMock.completedVerifications);
    await page.evaluate(() => { window.__secondhandMock.heldVerify.splice(0).forEach(resolve => resolve()); window.__secondhandMock.holdVerify = false; });
    await page.waitForFunction(expected => window.__secondhandMock.completedVerifications === expected, completedBefore + 1);
    assert.equal((await calls()).length, before); assert.equal(await page.getByText('型号闲置第二页', { exact: true }).count(), 0);
  });
  await record('brand switch ignores a late result from the previous selected brand', async () => {
    await navigate('home'); await page.evaluate(() => { window.__secondhandMock.holdBrand = '7'; }); await page.getByRole('button', { name: '品牌与型号' }).click(); const dialog = page.getByRole('dialog', { name: '选择闲置品牌与型号' }); await page.waitForFunction(() => window.__secondhandMock.held.length > 0); await dialog.getByRole('button', { name: '品牌乙', exact: true }).click(); await dialog.getByRole('button', { name: /型号乙/ }).waitFor(); await page.evaluate(() => { window.__secondhandMock.held.forEach(release => release()); window.__secondhandMock.held = []; window.__secondhandMock.holdBrand = ''; }); assert.equal(await dialog.getByRole('button', { name: /型号甲/ }).count(), 0); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('unknown deep-link filters fail explicitly and make no broad fallback request', async () => {
    const before = (await calls()).length; await navigate('list', '#/feed/ershouList?price=1'); await page.getByText('闲置筛选链接暂不可用', { exact: true }).waitFor(); assert.equal((await calls()).length, before);
  });
  await record('account switch closes picker, resets search drafts and guest browsing remains read-only', async () => {
    await navigate('home'); await page.getByRole('textbox', { name: '搜索闲置', exact: true }).fill('账号甲草稿'); await page.getByRole('button', { name: '品牌与型号' }).click(); const dialog = page.getByRole('dialog', { name: '选择闲置品牌与型号' }); await page.evaluate(() => window.__secondhandAccount('')); await dialog.waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('textbox', { name: '搜索闲置', exact: true }).inputValue(), '');
    await page.getByText('首页闲置介绍', { exact: true }).waitFor(); assert.ok((await calls()).every(row => ['secondhandHome', 'secondhandBrands', 'secondhandProducts', 'secondhandListings', 'secondhandSearch'].includes(row.operation)));
  });
  await page.setViewportSize({ width: 620, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []); await page.screenshot({ path: resolve(directory, 'complete.png') });
  writeFileSync('research/secondhand-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic isolated renderer; external requests blocked; no real account writes', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: resolve(directory, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
