import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/hot-topics-check', { recursive: true });
writeFileSync('.local/hot-topics-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{HotTopics}from'/src/HotTopics.tsx';import{plain,refreshResources}from'/src/data.ts';import'/src/styles.css';
function Harness(){const[namespace,setNamespace]=useState('guest');useEffect(()=>{window.__hotNavigate=setNamespace;window.__hotRefresh=refreshResources},[]);return React.createElement('main',{'data-hot-account':namespace,style:{width:280,padding:20}},React.createElement(HotTopics,{key:namespace,namespace,onTopic:tag=>{window.__hotRoute={kind:'topic',tag,title:plain(tag)}},onLogin:()=>{window.__hotLogin=true}}))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_HOT_TOPICS_TEST_PORT || 5203), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser;
const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 880 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__hotMock = { calls: [], failure: '', emptyFor: '', holdFor: '', releaseRead: null, completedReads: 0, holdVerification: false, releaseVerification: null, completedVerifications: 0 };
    window.coolapk = {
      verify: async id => {
        mock.verificationId = id;
        if (mock.holdVerification) await new Promise(resolve => { mock.releaseVerification = resolve; });
        mock.failure = ''; mock.completedVerifications++;
        return { ok: true, data: {} };
      },
      call: async (operation, args) => {
        const scope = document.querySelector('main')?.getAttribute('data-hot-account');
        mock.calls.push({ operation, args: structuredClone(args), scope });
        if (operation !== 'homeHotTopics' || Object.keys(args).length) throw new Error('Unexpected hot-topic request');
        if (mock.holdFor === scope) await new Promise(resolve => { mock.releaseRead = resolve; });
        mock.completedReads++;
        if (mock.failure) return { ok: false, error: { code: mock.failure, message: '模拟热门话题读取失败', ...(mock.failure === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-hot-topic-verification' } : {}) } };
        const first = scope === 'guest' ? '<b>模拟热点</b><img src=x onerror="window.__hotInjected=true">' : '账号' + scope + '热点';
        return { ok: true, data: { data: mock.emptyFor === scope ? [] : [{ tag: first, count: 25000 }, ...Array.from({ length: 4 }, (_, index) => ({ tag: scope + '话题' + index, count: index }))], hasMore: false } };
      },
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/hot-topics-harness.html');
  const rail = page.getByRole('region', { name: '热门话题', exact: true });
  const topicButton = title => rail.getByRole('button').filter({ has: page.getByText(title, { exact: true }) });
  async function committed(scope, title) {
    await page.locator('main[data-hot-account="' + scope + '"]').waitFor();
    await topicButton(title).waitFor();
    await page.waitForFunction(scope => window.__hotMock.calls.some(call => call.scope === scope), scope);
  }
  async function renderTurn() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

  await record('sidebar renders five normalized topics and heat while escaping topic markup', async () => {
    await committed('guest', '模拟热点');
    assert.equal(await rail.getByRole('button').count(), 5);
    assert.equal(await rail.getByText('热度 2.5万', { exact: true }).count(), 1);
    assert.equal(await rail.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.__hotInjected), undefined);
    assert.deepEqual(await page.evaluate(() => window.__hotMock.calls.map(call => ({ operation: call.operation, args: call.args }))), [{ operation: 'homeHotTopics', args: {} }]);
    assert.equal(await page.getByRole('button', { name: '加载更多', exact: true }).count(), 0);
  });
  await record('clicking a hot topic preserves the tag and opens the existing topic route', async () => {
    await topicButton('模拟热点').click();
    assert.deepEqual(await page.evaluate(() => window.__hotRoute), { kind: 'topic', tag: '<b>模拟热点</b><img src=x onerror="window.__hotInjected=true">', title: '模拟热点' });
  });
  await record('initial network failures show an error and retry the same fixed read', async () => {
    await page.evaluate(() => { window.__hotMock.failure = 'NETWORK'; window.__hotNavigate('network'); });
    await rail.getByRole('alert').getByText('模拟热门话题读取失败', { exact: true }).waitFor();
    assert.equal(await rail.getByText('暂无热门话题', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__hotMock.failure = ''; });
    await rail.getByRole('button', { name: '重试', exact: true }).click();
    await committed('network', '账号network热点');
    const calls = await page.evaluate(() => window.__hotMock.calls.filter(call => call.scope === 'network'));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args);
    assert.equal(await rail.getByRole('alert').count(), 0);
  });
  await record('verification completion repeats the fixed read exactly once', async () => {
    await page.evaluate(() => { window.__hotMock.failure = 'VERIFY_REQUIRED'; window.__hotNavigate('verify'); });
    await rail.getByRole('button', { name: '完成验证', exact: true }).click();
    await committed('verify', '账号verify热点');
    assert.equal(await page.evaluate(() => window.__hotMock.verificationId), 'synthetic-hot-topic-verification');
    const calls = await page.evaluate(() => window.__hotMock.calls.filter(call => call.scope === 'verify'));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args);
  });
  await record('refresh failures retain the successful topics and remain retryable', async () => {
    await page.evaluate(() => { window.__hotMock.failure = 'NETWORK'; window.__hotRefresh(); });
    await rail.getByRole('alert').waitFor();
    assert.ok(await topicButton('账号verify热点').isVisible());
    await page.evaluate(() => { window.__hotMock.failure = ''; });
    await rail.getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
    assert.ok(await topicButton('账号verify热点').isVisible());
  });
  await record('a successful empty result shows the empty state without speculative fallback', async () => {
    await page.evaluate(() => { window.__hotMock.emptyFor = 'empty'; window.__hotNavigate('empty'); });
    await rail.getByText('暂无热门话题', { exact: true }).waitFor();
    assert.equal(await rail.getByRole('alert').count(), 0);
    assert.equal(await rail.getByRole('button').count(), 0);
    assert.equal(await page.evaluate(() => window.__hotMock.calls.filter(call => call.scope === 'empty').length), 1);
  });
  await record('a delayed old-account response cannot replace the committed new account topics', async () => {
    await page.evaluate(() => { window.__hotMock.holdFor = 'late-old'; window.__hotNavigate('late-old'); });
    await page.waitForFunction(() => !!window.__hotMock.releaseRead);
    assert.equal(await rail.getByRole('status').count(), 1);
    await page.evaluate(() => window.__hotNavigate('late-new'));
    await committed('late-new', '账号late-new热点');
    const reads = await page.evaluate(() => window.__hotMock.completedReads);
    await page.evaluate(() => window.__hotMock.releaseRead());
    await page.waitForFunction(reads => window.__hotMock.completedReads === reads + 1, reads);
    await renderTurn();
    assert.ok(await topicButton('账号late-new热点').isVisible());
    assert.equal(await rail.getByText('账号late-old热点', { exact: true }).count(), 0);
  });
  await record('verification from an old account cannot retry after a new account becomes ready', async () => {
    await page.evaluate(() => { window.__hotMock.failure = 'VERIFY_REQUIRED'; window.__hotMock.holdVerification = true; window.__hotNavigate('verify-old'); });
    await rail.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => !!window.__hotMock.releaseVerification);
    await page.evaluate(() => { window.__hotMock.failure = ''; window.__hotNavigate('verify-new'); });
    await committed('verify-new', '账号verify-new热点');
    const calls = await page.evaluate(() => window.__hotMock.calls.length);
    const completions = await page.evaluate(() => window.__hotMock.completedVerifications);
    await page.evaluate(() => window.__hotMock.releaseVerification());
    await page.waitForFunction(completions => window.__hotMock.completedVerifications === completions + 1, completions);
    await renderTurn();
    assert.equal(await page.evaluate(() => window.__hotMock.calls.length), calls);
    assert.ok(await topicButton('账号verify-new热点').isVisible());
    assert.equal(await rail.getByRole('alert').count(), 0);
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.local/hot-topics-check/sidebar.png' });
  writeFileSync('research/hot-topics-checks.json', JSON.stringify({ mode: 'synthetic renderer contract checks', externalRequests: 'blocked', checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
