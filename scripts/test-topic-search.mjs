// Reproducible isolated React renderer; all external requests are blocked.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_TOPIC_SEARCH_TEST_PORT || 5198), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/topic-search-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="color:var(--text);background:var(--bg)"><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TopicSearch}from'/src/TopicSearch.tsx';import'/src/styles.css';function Fixture(){const[scope,setScope]=useState('guest');const[tag,setTag]=useState('手机摄影');const[shown,setShown]=useState(true);window.__topicScope=value=>{window.__topicMock.scope=value;setScope(value)};window.__topicTag=setTag;window.__topicShown=setShown;const noop=()=>{};return <main style={{maxWidth:1000,margin:'auto',padding:20}}><output data-testid="fixture-scope">{scope}</output><output data-testid="fixture-tag">{tag}</output>{shown&&<TopicSearch tag={tag} namespace={scope} onOpenEntity={item=>window.__topicMock.opened.push(item)} feedProps={{loggedIn:false,onLogin:()=>window.__topicMock.login++,onOpen:item=>window.__topicMock.feeds.push(item),onUser:noop,onLink:noop,onForward:noop,toast:noop}}/>}</main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__topicMock = { scope: 'guest', calls: [], opened: [], feeds: [], login: 0, fail: null, holdQuery: '', pending: [], verifyHold: false, verifyPending: [], verifyCalls: 0, emptyQuery: '' };
    const ok = data => ({ ok: true, data });
    const marker = (args, scope, page) => `${args.tag}|${args.query}|${args.sort}|${args.feedType}|${scope}|${page}`;
    const rows = (args, scope, page) => [{ entityType: 'feed', id: String(100 + page), message: '匹配 ' + marker(args, scope, page), username: '合成酷友', uid: '700', dateline: 1700000000 }, { entityType: 'future-entity', id: String(900 + page), title: '未知 ' + marker(args, scope, page), message: '服务端未知实体', feedType: 'feed' }];
    window.coolapk = {
      verify: async () => { mock.verifyCalls++; if (mock.verifyHold) await new Promise(resolve => mock.verifyPending.push(resolve)); mock.fail = null; return ok({}); },
      call: async (operation, args = {}) => {
        const scope = mock.scope, page = args.page || 1;
        const item = { operation, args: { ...args }, scope, done: false }; mock.calls.push(item);
        if (operation !== 'topicSearch') throw new Error('unexpected operation ' + operation);
        if (mock.holdQuery === args.query) await new Promise(resolve => mock.pending.push(resolve));
        if (mock.fail?.query === args.query && mock.fail.page === page) {
          item.done = true;
          return { ok: false, error: { code: mock.fail.code, message: '模拟话题搜索错误', ...(mock.fail.code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-topic-verification' } : {}) } };
        }
        item.done = true;
        if (mock.emptyQuery === args.query) return ok({ data: [], hasMore: false });
        return ok({ data: page === 1 ? rows(args, scope, 1) : [rows(args, scope, 1)[0], ...rows(args, scope, page)], firstItem: 'head-' + marker(args, scope, 1), lastItem: 'tail-' + marker(args, scope, page), hasMore: page === 1 });
      },
      openExternal: async () => ok({}),
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/topic-search-check/test.html');
  const section = page.getByRole('region', { name: '话题内搜索', exact: true });
  const keyword = () => section.getByLabel('话题内搜索关键词', { exact: true });
  const sortSelect = () => section.getByLabel('话题搜索排序', { exact: true });
  const typeSelect = () => section.getByLabel('话题搜索内容类型', { exact: true });
  const marker = (query, { tag = '手机摄影', sort = 'default', feedType = 'all', scope = 'guest', page = 1 } = {}) => `${tag}|${query}|${sort}|${feedType}|${scope}|${page}`;
  const feed = (query, options = {}) => section.getByText('匹配 ' + marker(query, options), { exact: true });
  const unknown = (query, options = {}) => section.locator('.entity-card').filter({ has: page.getByText('未知 ' + marker(query, options), { exact: true }) });
  const callCount = () => page.evaluate(() => window.__topicMock.calls.length);
  const callsSince = start => page.evaluate(start => window.__topicMock.calls.slice(start).map(({ operation, args, scope }) => ({ operation, args, scope })), start);
  const args = (query, overrides = {}) => ({ tag: '手机摄影', query, sort: 'default', feedType: 'all', page: 1, ...overrides });
  async function waitCall(start, expected, scope = 'guest') {
    await page.waitForFunction(({ start, expected, scope }) => window.__topicMock.calls.slice(start).some(item => item.operation === 'topicSearch' && item.scope === scope && item.done && JSON.stringify(item.args) === JSON.stringify(expected)), { start, expected, scope });
  }
  async function submit(query, options = {}) { await keyword().fill(query); await section.getByRole('button', { name: '搜索话题', exact: true }).click(); await feed(query.trim(), options).waitFor(); }
  async function clear() { await section.getByRole('button', { name: '清空搜索', exact: true }).click(); await sortSelect().waitFor({ state: 'hidden' }); }

  await record('initial scope does not issue an empty search or assign actions to unknown entities', async () => {
    await keyword().waitFor(); assert.equal(await callCount(), 0);
    assert.equal(await sortSelect().count(), 0); assert.equal(await section.getByRole('button', { name: '搜索话题', exact: true }).isDisabled(), true);
  });
  await record('explicit submission trims only the query and fixes the current topic', async () => {
    const start = await callCount(); await submit('  样张  '); await waitCall(start, args('样张'));
    assert.deepEqual(await callsSince(start), [{ operation: 'topicSearch', args: args('样张'), scope: 'guest' }]);
    await unknown('样张').click(); assert.equal(await page.evaluate(() => window.__topicMock.opened.at(-1)?.entityType), 'future-entity');
    assert.equal(await unknown('样张').locator('button').count(), 0);
    assert.equal(await section.locator('.feed-card').count(), 1);
    await section.getByRole('button', { name: '查看动态', exact: true }).click(); assert.equal(await page.evaluate(() => window.__topicMock.feeds.length), 1);
  });
  await record('page two sends exact first and last cursors and accumulates without duplicate feeds', async () => {
    const start = await callCount(); await section.getByRole('button', { name: '加载更多', exact: true }).click();
    await feed('样张', { page: 2 }).waitFor();
    assert.deepEqual(await callsSince(start), [{ operation: 'topicSearch', args: args('样张', { page: 2, firstItem: 'head-' + marker('样张'), lastItem: 'tail-' + marker('样张') }), scope: 'guest' }]);
    assert.equal(await feed('样张').count(), 1); assert.equal(await section.locator('.feed-card').count(), 2); assert.equal(await section.locator('.entity-card').count(), 2);
  });
  await record('five reference sorts reset pagination and retain the topic and exact query', async () => {
    assert.deepEqual(await sortSelect().locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['default', 'latest', 'hot', 'comment', 'accurate']);
    for (const sort of ['latest', 'hot', 'comment', 'accurate', 'default']) {
      const start = await callCount(); await sortSelect().selectOption(sort); await feed('样张', { sort }).waitFor(); await waitCall(start, args('样张', { sort }));
      assert.deepEqual(await callsSince(start), [{ operation: 'topicSearch', args: args('样张', { sort }), scope: 'guest' }]);
      assert.equal(await section.locator('.feed-card').count(), 1);
    }
  });
  await record('ten reference types reset pagination without broadening topic scope', async () => {
    const types = ['all', 'feed', 'feedArticle', 'picture', 'question', 'answer', 'comment', 'video', 'ershou', 'vote'];
    assert.deepEqual(await typeSelect().locator('option').evaluateAll(nodes => nodes.map(node => node.value)), types);
    for (const feedType of [...types.slice(1), 'all']) {
      const start = await callCount(); await typeSelect().selectOption(feedType); await feed('样张', { feedType }).waitFor(); await waitCall(start, args('样张', { feedType }));
      assert.deepEqual(await callsSince(start), [{ operation: 'topicSearch', args: args('样张', { feedType }), scope: 'guest' }]);
    }
  });
  await record('page-two network retry preserves page one and repeats the exact failed cursor', async () => {
    await submit('翻页失败'); await page.evaluate(() => { window.__topicMock.fail = { query: '翻页失败', page: 2, code: 'NETWORK' }; });
    const start = await callCount(); await section.getByRole('button', { name: '加载更多', exact: true }).click(); await section.getByRole('alert').waitFor(); await feed('翻页失败').waitFor();
    const failed = (await callsSince(start))[0];
    await page.evaluate(() => { window.__topicMock.fail = null; });
    await section.getByRole('button', { name: '重试', exact: true }).click(); await feed('翻页失败', { page: 2 }).waitFor();
    assert.deepEqual((await callsSince(start))[1], failed); assert.equal(await feed('翻页失败').count(), 1); assert.equal(await section.getByRole('alert').count(), 0);
  });
  await record('page-two verification retries the same request and accumulates the original first page', async () => {
    await submit('翻页验证'); await page.evaluate(() => { window.__topicMock.fail = { query: '翻页验证', page: 2, code: 'VERIFY_REQUIRED' }; });
    const start = await callCount(); await section.getByRole('button', { name: '加载更多', exact: true }).click(); await section.getByRole('button', { name: '完成验证', exact: true }).waitFor();
    const failed = (await callsSince(start))[0]; await section.getByRole('button', { name: '完成验证', exact: true }).click(); await feed('翻页验证', { page: 2 }).waitFor();
    assert.deepEqual((await callsSince(start))[1], failed); assert.equal(await feed('翻页验证').count(), 1);
  });
  await record('initial failure is an error rather than an empty result and retries page one', async () => {
    await page.evaluate(() => { window.__topicMock.fail = { query: '首次失败', page: 1, code: 'NETWORK' }; });
    const start = await callCount(); await keyword().fill('首次失败'); await section.getByRole('button', { name: '搜索话题', exact: true }).click(); await section.getByRole('alert').waitFor();
    assert.equal(await section.getByText('当前话题没有搜索结果', { exact: true }).count(), 0); assert.equal(await section.locator('.feed-card').count(), 0);
    await page.evaluate(() => { window.__topicMock.fail = null; }); await section.getByRole('button', { name: '重试', exact: true }).click(); await feed('首次失败').waitFor();
    assert.deepEqual(await callsSince(start), [{ operation: 'topicSearch', args: args('首次失败'), scope: 'guest' }, { operation: 'topicSearch', args: args('首次失败'), scope: 'guest' }]);
  });
  await record('an actual empty success is distinct from failure and cannot paginate', async () => {
    await page.evaluate(() => { window.__topicMock.emptyQuery = '无结果'; }); await keyword().fill('无结果'); await section.getByRole('button', { name: '搜索话题', exact: true }).click();
    await section.getByText('当前话题没有搜索结果', { exact: true }).waitFor(); assert.equal(await section.getByRole('alert').count(), 0); assert.equal(await section.getByRole('button', { name: '加载更多', exact: true }).count(), 0);
  });
  await record('clear cancels a delayed search and does not restore its result', async () => {
    await page.evaluate(() => { window.__topicMock.holdQuery = '清空迟到'; }); await keyword().fill('清空迟到'); await section.getByRole('button', { name: '搜索话题', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.pending.length > 0); await clear();
    await page.evaluate(() => { window.__topicMock.holdQuery = ''; window.__topicMock.pending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => window.__topicMock.calls.filter(item => item.args.query === '清空迟到').every(item => item.done));
    assert.equal(await feed('清空迟到').count(), 0); assert.equal(await keyword().inputValue(), '');
  });
  await record('a newer query wins over a delayed old response', async () => {
    await page.evaluate(() => { window.__topicMock.holdQuery = '旧关键词'; }); await keyword().fill('旧关键词'); await section.getByRole('button', { name: '搜索话题', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.pending.length > 0); await submit('新关键词');
    await page.evaluate(() => { window.__topicMock.holdQuery = ''; window.__topicMock.pending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => window.__topicMock.calls.filter(item => item.args.query === '旧关键词').every(item => item.done));
    await feed('新关键词').waitFor(); assert.equal(await feed('旧关键词').count(), 0);
  });
  await record('same-query account switch commits its new scope before the old result is released', async () => {
    await page.evaluate(() => { window.__topicMock.holdQuery = '同词切号'; }); await keyword().fill('同词切号'); await section.getByRole('button', { name: '搜索话题', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.pending.length > 0);
    await page.evaluate(() => { window.__topicMock.holdQuery = ''; window.__topicScope('synthetic-new-account'); });
    await page.getByTestId('fixture-scope').filter({ hasText: /^synthetic-new-account$/ }).waitFor(); assert.equal(await keyword().inputValue(), '');
    const start = await callCount(); await submit('同词切号', { scope: 'synthetic-new-account' }); await waitCall(start, args('同词切号'), 'synthetic-new-account');
    await page.evaluate(() => window.__topicMock.pending.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => window.__topicMock.calls.filter(item => item.args.query === '同词切号' && item.scope === 'guest').every(item => item.done));
    await feed('同词切号', { scope: 'synthetic-new-account' }).waitFor(); assert.equal(await feed('同词切号').count(), 0);
  });
  await record('changing the topic resets the form and ignores an old same-query response', async () => {
    await page.evaluate(() => { window.__topicMock.holdQuery = '同词换话题'; }); await keyword().fill('同词换话题'); await section.getByRole('button', { name: '搜索话题', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.pending.length > 0);
    await page.evaluate(() => { window.__topicMock.holdQuery = ''; window.__topicTag('桌面软件'); }); await page.getByTestId('fixture-tag').filter({ hasText: /^桌面软件$/ }).waitFor();
    assert.equal(await keyword().inputValue(), ''); const start = await callCount(); await submit('同词换话题', { tag: '桌面软件', scope: 'synthetic-new-account' });
    await waitCall(start, args('同词换话题', { tag: '桌面软件' }), 'synthetic-new-account');
    await page.evaluate(() => window.__topicMock.pending.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => window.__topicMock.calls.filter(item => item.args.query === '同词换话题' && item.args.tag === '手机摄影').every(item => item.done));
    assert.equal(await feed('同词换话题', { scope: 'synthetic-new-account' }).count(), 0);
  });
  await record('late verification after clear cannot repeat an obsolete request', async () => {
    await page.evaluate(() => { window.__topicMock.fail = { query: '过期验证', page: 1, code: 'VERIFY_REQUIRED' }; window.__topicMock.verifyHold = true; });
    await keyword().fill('过期验证'); await section.getByRole('button', { name: '搜索话题', exact: true }).click(); await section.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.verifyPending.length === 1); await clear(); const count = await callCount();
    await page.evaluate(() => { window.__topicMock.verifyHold = false; window.__topicMock.verifyPending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => window.__topicMock.fail === null); assert.equal(await callCount(), count); assert.equal(await section.getByRole('alert').count(), 0);
  });
  await record('late verification after account switch cannot replay with the new identity', async () => {
    await page.evaluate(() => { window.__topicMock.fail = { query: '切号验证', page: 1, code: 'VERIFY_REQUIRED' }; window.__topicMock.verifyHold = true; });
    await keyword().fill('切号验证'); await section.getByRole('button', { name: '搜索话题', exact: true }).click(); await section.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.verifyPending.length === 1); await page.evaluate(() => window.__topicScope('synthetic-third-account'));
    await page.getByTestId('fixture-scope').filter({ hasText: /^synthetic-third-account$/ }).waitFor(); assert.equal(await keyword().inputValue(), ''); const count = await callCount();
    await page.evaluate(() => { window.__topicMock.verifyHold = false; window.__topicMock.verifyPending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => window.__topicMock.fail === null); assert.equal(await callCount(), count);
  });
  await record('unmount disposes delayed reads and remount starts with no active search', async () => {
    await page.evaluate(() => { window.__topicMock.holdQuery = '关闭迟到'; }); await keyword().fill('关闭迟到'); await section.getByRole('button', { name: '搜索话题', exact: true }).click();
    await page.waitForFunction(() => window.__topicMock.pending.length > 0); await page.evaluate(() => window.__topicShown(false)); await section.waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__topicMock.holdQuery = ''; window.__topicMock.pending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => window.__topicMock.calls.filter(item => item.args.query === '关闭迟到').every(item => item.done));
    await page.evaluate(() => window.__topicShown(true)); await keyword().waitFor(); assert.equal(await keyword().inputValue(), ''); assert.equal(await sortSelect().count(), 0);
  });
  await record('narrow dark view keeps controls and result text within the window', async () => {
    await page.setViewportSize({ width: 460, height: 900 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await submit('布局', { tag: '桌面软件', scope: 'synthetic-third-account' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(await page.evaluate(() => { const style = getComputedStyle(document.querySelector('.topic-search input')); return [style.backgroundColor, style.color]; }), ['rgb(32, 40, 35)', 'rgb(227, 235, 230)']);
    assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.feed-card')).color]), ['rgb(22, 28, 25)', 'rgb(227, 235, 230)']);
  });
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.__topicMock.calls.every(item => item.operation === 'topicSearch')), true);
  await page.screenshot({ path: resolve(output, 'complete.png') });
  writeFileSync('research/topic-search-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic isolated React renderer under StrictMode; external network blocked; no real accounts, phone or server writes', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: resolve(output, 'failure.png') }); throw error; }
finally { await browser?.close(); await server.close(); }
