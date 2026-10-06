import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const names = ['推荐','热门','我的关注','值得买','摄影','系统','玩机','苹果','电脑','配件','车','AI','美化','游戏','情感','生活','交易','运动','学习','动漫','户外','酷安人均','手机SoC','处理器'];
const categories = names.map(title => ({ entityType: 'verticalColumnsFullPage', title, url: title === '热门' ? '/page?url=V11_VERTICL_TOPIIC_HOT_TAB' : title === '我的关注' ? '#/topic/userFollowTagList?cacheExpires=60' : '#/topic/tagList?keywords=' + encodeURIComponent(title) + '&sort=hot_num' }));
const directory = '.local/topic-discovery-check'; mkdirSync(directory, { recursive: true });
writeFileSync('.local/topic-discovery-icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#14874e"/><circle cx="32" cy="32" r="14" fill="white"/></svg>');
writeFileSync('.local/topic-discovery-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{TopicDiscovery}from'/src/TopicDiscovery.tsx';import'/src/styles.css';
function Harness(){const[state,setState]=useState({namespace:'guest',revision:0,loggedIn:false,visible:true});useEffect(()=>{window.__topicPatch=patch=>setState(old=>({...old,...patch}))},[]);return React.createElement('main',{'data-topic-namespace':state.namespace,'data-topic-revision':state.revision,style:{width:'100%',maxWidth:1000,height:640,padding:20,overflowY:'auto',margin:'16px auto'}},state.visible&&React.createElement(TopicDiscovery,{namespace:state.namespace,revision:state.revision,loggedIn:state.loggedIn,onLogin:()=>window.__topicLogin=(window.__topicLogin||0)+1,onOpen:entity=>window.__topicOpened=entity}))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_TOPIC_DISCOVERY_TEST_PORT || 5235), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 920 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(({ categories, origin }) => {
    const mock = window.__topicMock = { categories, calls: [], failures: {}, hold: '', release: null, completed: 0, heldVerification: false, releaseVerification: null, verificationCount: 0, moreFailure: false, flatCatalog: false, emptyCategory: '', duplicatePage: false };
    window.coolapk = {
      verify: async id => {
        mock.verificationId = id;
        if (mock.heldVerification) await new Promise(resolve => { mock.releaseVerification = resolve; });
        mock.verificationCount++; mock.failures = {}; return { ok: true, data: { verified: true } };
      },
      call: async (operation, args) => {
        const namespace = document.querySelector('main')?.getAttribute('data-topic-namespace'), revision = Number(document.querySelector('main')?.getAttribute('data-topic-revision'));
        mock.calls.push({ operation, args: structuredClone(args), namespace, revision });
        if (operation !== 'page' || ![...mock.categories.map(category => category.url), 'V11_VERTICAL_TOPIC'].includes(args.url)) throw new Error('Unexpected topic route');
        const requestKey = namespace + '|' + args.url, page = args.page || 1;
        if (mock.hold === requestKey || mock.hold === requestKey + '|' + page || mock.hold === requestKey + '|revision:' + revision) await new Promise(resolve => { mock.release = resolve; });
        mock.completed++;
        const code = mock.failures[requestKey] || (mock.moreFailure && page === 2 ? 'NETWORK' : '');
        if (code) return { ok: false, error: { code, message: '模拟话题读取失败', ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-topic-challenge' } : {}) } };
        if (args.url === 'V11_VERTICAL_TOPIC') return { ok: true, data: { data: mock.flatCatalog ? mock.categories : [], surfaceItems: mock.flatCatalog ? undefined : [{ entityType: 'card', entityTemplate: 'verticalColumnsFullPageCard', entities: mock.categories, extraData: JSON.stringify({ selectedTab: '热门' }) }], hasMore: false } };
        const category = mock.categories.find(category => category.url === args.url), generation = mock.duplicatePage && page > 1 ? 1 : page;
        const items = mock.emptyCategory === category.title ? [] : Array.from({ length: page > 1 ? 4 : 20 }, (_, index) => ({ entityType: 'topic', id: category.title + '-' + generation + '-' + index, title: category.title + '话题 ' + generation + '-' + index, ownerScope: namespace, ownerRevision: revision, logo: index === 0 ? origin + '/.local/topic-discovery-icon.svg' : '', hot_num: index === 0 ? 125000 : 200 + index, url: '/t/' + encodeURIComponent(category.title + '-' + index) }));
        return { ok: true, data: { data: items, firstItem: items[0]?.id || '', lastItem: items.at(-1)?.id || '', hasMore: mock.duplicatePage || page < 3 } };
      },
    };
  }, { categories, origin });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/topic-discovery-harness.html');
  const discovery = page.getByRole('region', { name: '发现话题', exact: true });
  const tab = name => discovery.getByRole('tab', { name, exact: true });
  const topic = (name, generation = 1, index = 0) => discovery.getByRole('button').filter({ has: page.getByText(name + '话题 ' + generation + '-' + index, { exact: true }) });
  async function ready(name) { await topic(name).waitFor(); await page.waitForFunction(() => !document.querySelector('[role="tabpanel"][aria-busy="true"]')); }
  async function renderTurn() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
  const reads = namespace => page.evaluate(namespace => window.__topicMock.calls.filter(call => call.namespace === namespace), namespace);
  await record('official topic surface exposes all 24 categories, selects configured hot tab and renders icons and heat', async () => {
    await ready('热门'); assert.deepEqual(await discovery.getByRole('tab').allTextContents(), names);
    assert.equal(await tab('热门').getAttribute('aria-selected'), 'true');
    assert.equal(await discovery.locator('.topic-discovery-topic').count(), 20);
    assert.equal(await discovery.locator('.topic-discovery-grid .entity-poster-open').count(), 20);
    assert.ok(await topic('热门').locator('img').evaluate(image => image.complete && image.naturalWidth > 0));
    assert.equal(await topic('热门').locator('img').getAttribute('alt'), '');
    assert.equal(await discovery.getByText('热度 12.5万', { exact: true }).count(), 1);
    assert.deepEqual((await reads('guest')).map(call => call.args.url), ['V11_VERTICAL_TOPIC', categories[1].url]);
    await topic('热门').click(); assert.equal(await page.evaluate(() => window.__topicOpened.id), '热门-1-0');
  });
  await record('every public category retains its supplied route; following as guest presents login without an authenticated call', async () => {
    for (const category of categories) {
      await tab(category.title).click();
      if (category.title === '我的关注') { await discovery.getByRole('alert').getByText('登录后查看你关注的话题。', { exact: true }).waitFor(); await discovery.getByRole('button', { name: '登录', exact: true }).click(); }
      else await ready(category.title);
    }
    const calls = await reads('guest');
    assert.equal(calls.filter(call => call.args.url === categories[2].url).length, 0);
    assert.equal(await page.evaluate(() => window.__topicLogin), 1);
    for (const category of categories.filter(category => category.title !== '我的关注')) assert.ok(calls.some(call => call.args.url === category.url));
  });
  await record('arrow, Home and End keys move one roving tab stop and preserve visible keyboard focus', async () => {
    await tab('推荐').focus(); await page.keyboard.press('End'); await ready('处理器'); assert.equal(await tab('处理器').evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Home'); await ready('推荐'); await page.keyboard.press('ArrowRight'); await ready('热门');
    assert.equal(await discovery.getByRole('tab').evaluateAll(nodes => nodes.filter(node => node.tabIndex === 0).length), 1);
    assert.equal(await tab('热门').evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
  });
  await record('initial errors stay visible, retry exactly the selected category and never masquerade as empty results', async () => {
    await page.evaluate(url => { window.__topicMock.failures['error|' + url] = 'NETWORK'; window.__topicPatch({ namespace: 'error' }); }, categories[1].url);
    await discovery.getByRole('alert').waitFor(); assert.equal(await discovery.getByText('暂无话题', { exact: true }).count(), 0);
    await page.evaluate(() => window.__topicMock.failures = {}); await discovery.getByRole('button', { name: '重试', exact: true }).click(); await ready('热门');
    assert.equal((await reads('error')).filter(call => call.args.url === categories[1].url).length, 2);
  });
  await record('manual official verification retries its challenged category once', async () => {
    await page.evaluate(url => { window.__topicMock.failures['challenge|' + url] = 'VERIFY_REQUIRED'; window.__topicPatch({ namespace: 'challenge' }); }, categories[1].url);
    await discovery.getByRole('button', { name: '完成验证', exact: true }).click(); await ready('热门');
    assert.equal(await page.evaluate(() => window.__topicMock.verificationId), 'synthetic-topic-challenge');
    assert.equal((await reads('challenge')).filter(call => call.args.url === categories[1].url).length, 2);
  });
  await record('wheel scrolling loads page 2 once, keeps topics on failure and explicitly retries the same failed page', async () => {
    await page.evaluate(() => { window.__topicMock.moreFailure = true; });
    await page.locator('main').evaluate(node => { node.scrollTop = node.scrollHeight; }); await page.locator('main').hover(); await page.mouse.wheel(0, 500);
    await discovery.getByRole('alert').waitFor(); assert.equal(await discovery.locator('.topic-discovery-topic').count(), 20);
    const before = (await reads('challenge')).length; await page.mouse.wheel(0, 500); await renderTurn(); assert.equal((await reads('challenge')).length, before);
    await page.evaluate(() => window.__topicMock.moreFailure = false); await discovery.getByRole('button', { name: '重试加载更多话题', exact: true }).click();
    await topic('热门', 2).waitFor();
    const pageTwo = (await reads('challenge')).filter(call => call.args.page === 2); assert.equal(pageTwo.length, 2); assert.deepEqual(pageTwo[0].args, pageTwo[1].args);
    await discovery.getByRole('button', { name: '加载更多话题', exact: true }).click(); await topic('热门', 3).waitFor();
    assert.equal(await discovery.locator('.topic-discovery-topic').count(), 28); assert.ok(await discovery.getByRole('button', { name: '已经看完了', exact: true }).isDisabled());
    const exhausted = (await reads('challenge')).length; await page.mouse.wheel(0, 500); await renderTurn(); assert.equal((await reads('challenge')).length, exhausted);
  });
  await record('late category, account and revision responses cannot replace the current topic panel', async () => {
    await page.evaluate(url => { window.__topicMock.hold = 'challenge|' + url; window.__topicMock.release = null; }, categories[4].url);
    await tab('摄影').click(); await page.waitForFunction(() => !!window.__topicMock.release);
    await tab('AI').click(); await ready('AI'); const completed = await page.evaluate(() => window.__topicMock.completed);
    await page.evaluate(() => window.__topicMock.release()); await page.waitForFunction(completed => window.__topicMock.completed > completed, completed); await renderTurn();
    assert.ok(await topic('AI').isVisible()); assert.equal(await topic('摄影').count(), 0);
    await page.evaluate(url => { window.__topicMock.hold = 'old-account|' + url; window.__topicMock.release = null; window.__topicPatch({ namespace: 'old-account' }); }, categories[1].url);
    await page.waitForFunction(() => !!window.__topicMock.release); await page.evaluate(() => { window.__topicMock.hold = ''; window.__topicPatch({ namespace: 'new-account', revision: 1 }); }); await ready('热门');
    await page.evaluate(() => window.__topicMock.release()); await renderTurn(); assert.ok(await topic('热门').isVisible()); await topic('热门').click(); assert.equal(await page.evaluate(() => window.__topicOpened.ownerScope), 'new-account');
    const before = (await reads('new-account')).length; await page.evaluate(() => window.__topicPatch({ revision: 2 }));
    await page.waitForFunction(before => window.__topicMock.calls.filter(call => call.namespace === 'new-account').length === before + 2, before); await ready('热门');
    await page.evaluate(url => { window.__topicMock.hold = 'revision-account|' + url + '|revision:0'; window.__topicMock.release = null; window.__topicPatch({ namespace: 'revision-account', revision: 0 }); }, categories[1].url);
    await page.waitForFunction(() => !!window.__topicMock.release); await page.evaluate(() => window.__topicPatch({ revision: 1 })); await ready('热门');
    await page.evaluate(() => window.__topicMock.release()); await renderTurn(); await topic('热门').click(); assert.equal(await page.evaluate(() => window.__topicOpened.ownerRevision), 1);
  });
  await record('flattened catalogs remain usable and signed-in follow categories request their official route', async () => {
    await page.evaluate(() => { window.__topicMock.flatCatalog = true; window.__topicPatch({ namespace: 'flat-account', loggedIn: true }); }); await ready('推荐');
    assert.equal(await discovery.getByRole('tab').count(), 24); await tab('我的关注').click(); await ready('我的关注');
    assert.equal((await reads('flat-account')).filter(call => call.args.url === categories[2].url).length, 1);
    await page.evaluate(() => { window.__topicMock.emptyCategory = '摄影'; }); await tab('摄影').click(); await discovery.getByText('暂无话题', { exact: true }).waitFor();
    assert.equal(await discovery.getByRole('button', { name: '加载更多话题', exact: true }).count(), 0);
  });
  await record('topic posters and category direction respond to available panel width without document overflow', async () => {
    await tab('AI').click(); await ready('AI');
    const columns = () => discovery.locator('.topic-discovery-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    const wideColumns = await columns(); assert.ok(wideColumns >= 3);
    await page.locator('main').evaluate(node => { node.style.maxWidth = '480px'; });
    await page.waitForFunction(() => document.querySelector('[role="tablist"]').getAttribute('aria-orientation') === 'horizontal');
    const confinedColumns = await columns(); assert.ok(confinedColumns >= 2 && confinedColumns < wideColumns);
    assert.equal(await discovery.getByRole('tablist').evaluate(node => getComputedStyle(node).flexDirection), 'row');
    assert.ok(await discovery.getByRole('tabpanel').evaluate(node => node.scrollWidth <= node.clientWidth));
    await page.locator('main').evaluate(node => { node.style.maxWidth = '1000px'; });
    await page.waitForFunction(() => document.querySelector('[role="tablist"]').getAttribute('aria-orientation') === 'vertical');
    assert.equal(await columns(), wideColumns);
    await page.setViewportSize({ width: 390, height: 850 });
    await page.waitForFunction(() => document.querySelector('[role="tablist"]').getAttribute('aria-orientation') === 'horizontal');
    const narrowColumns = await columns(); assert.ok(narrowColumns >= 1 && narrowColumns <= confinedColumns);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await tab('AI').focus(); await page.keyboard.press('End'); await ready('处理器'); assert.ok(await tab('处理器').isVisible());
    await page.screenshot({ path: directory + '/narrow.png' }); await page.setViewportSize({ width: 1280, height: 920 });
  });
  await record('verification completing after unmount does not retry a detached category', async () => {
    await page.evaluate(url => { window.__topicMock.flatCatalog = false; window.__topicMock.failures['unmount|' + url] = 'VERIFY_REQUIRED'; window.__topicMock.heldVerification = true; window.__topicPatch({ namespace: 'unmount' }); }, categories[1].url);
    await discovery.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__topicMock.releaseVerification);
    await page.evaluate(() => window.__topicPatch({ visible: false })); await discovery.waitFor({ state: 'detached' }); const before = (await reads('unmount')).length;
    await page.evaluate(() => window.__topicMock.releaseVerification()); await page.waitForFunction(() => window.__topicMock.verificationCount === 2); await renderTurn(); assert.equal((await reads('unmount')).length, before);
  });
  assert.deepEqual(errors, []);
  await page.evaluate(() => { window.__topicMock.heldVerification = false; window.__topicPatch({ visible: true, namespace: 'screenshot', loggedIn: false }); }); await ready('热门');
  await page.screenshot({ path: directory + '/desktop.png' });
  writeFileSync(directory + '/checks.json', JSON.stringify({ mode: 'isolated renderer contracts', externalRequests: 'blocked', checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
