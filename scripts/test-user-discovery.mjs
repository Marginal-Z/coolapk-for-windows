import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/user-discovery-check', { recursive: true });
writeFileSync('.local/user-discovery-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{UserDiscovery}from'/src/UserDiscovery.tsx';import'/src/styles.css';
function Harness(){const[state,setState]=useState({uid:'77',type:'profile',namespace:'guest',loggedIn:false});useEffect(()=>{window.__userNavigate=next=>setState(old=>({...old,...next}))},[]);return React.createElement(UserDiscovery,{key:state.uid+':'+state.type+':'+state.namespace,...state,revision:0,onLogin:()=>{},openEntity:entity=>{window.__userOpened=entity.id},feedProps:{onUser:()=>{},onLink:()=>{}}})}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_USER_DISCOVERY_PORT || 5196), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 880 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__userMock = { calls: [], failPage: false, hold: false, release: null };
    window.coolapk = { verify: async () => { mock.failPage = false; return { ok: true, data: {} }; }, call: async (operation, args) => {
      mock.calls.push({ operation, args: structuredClone(args) });
      if (args.uid === '77' && mock.hold) await new Promise(resolve => { mock.release = resolve; });
      if (operation.includes('Profile')) return { ok: true, data: { data: { uid: args.uid, username: '模拟酷友' + args.uid, introduce: '<b>公开资料</b><script>window.__privateExecuted=true</script>', city: '模拟城市' } } };
      if (mock.failPage && args.page === 2) return { ok: false, error: { code: mock.failPage === 'verify' ? 'VERIFY_REQUIRED' : 'NETWORK', message: '模拟评分分页失败', ...(mock.failPage === 'verify' ? { verificationId: 'synthetic-rating-page2' } : {}) } };
      const id = args.page === 2 ? '8' : '7';
      return { ok: true, data: { data: [{ entityType: 'apk', id, title: '模拟评分应用' + id, appName: '模拟评分应用' + id, rating: 5 }], firstItem: 'apk_7', lastItem: 'apk_' + id, hasMore: args.page !== 2 } };
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/user-discovery-harness.html');
  await record('guest public profiles render escaped fields with the dedicated guest operation', async () => {
    await page.getByText('模拟酷友77', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__userMock.calls[0].operation), 'publicUserProfile');
    assert.equal(await page.evaluate(() => window.__privateExecuted), undefined);
    await page.getByText('所在地：', { exact: true }).waitFor();
  });
  await record('signed-in profile reads use the authenticated operation after account isolation', async () => {
    await page.evaluate(() => window.__userNavigate({ namespace: '42', loggedIn: true })); await page.getByText('模拟酷友77', { exact: true }).waitFor();
    await page.waitForFunction(() => window.__userMock.calls.some(call => call.operation === 'userProfile'));
  });
  await record('application ratings paginate with exact server cursors and preserve successful rows on failure', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'ratings' })); await page.getByText('模拟评分应用7', { exact: true }).waitFor();
    await page.evaluate(() => { window.__userMock.failPage = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟评分分页失败', { exact: true }).waitFor(); assert.ok(await page.getByText('模拟评分应用7', { exact: true }).isVisible());
    const request = await page.evaluate(() => window.__userMock.calls.filter(call => call.operation === 'userAppRatings').at(-1));
    assert.deepEqual(request.args, { uid: '77', page: 2, firstItem: 'apk_7', lastItem: 'apk_7' });
    await page.evaluate(() => { window.__userMock.failPage = false; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('模拟评分应用8', { exact: true }).waitFor();
    const retried = await page.evaluate(() => window.__userMock.calls.filter(call => call.operation === 'userAppRatings').at(-1)); assert.deepEqual(retried.args, request.args);
  });
  await record('page two verification retries the exact request and retains the earlier ratings', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'ratings', uid: '88' })); await page.getByText('模拟评分应用7', { exact: true }).waitFor();
    await page.evaluate(() => { window.__userMock.failPage = 'verify'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.getByText('模拟评分应用8', { exact: true }).waitFor(); assert.ok(await page.getByText('模拟评分应用7', { exact: true }).isVisible());
    const calls = await page.evaluate(() => window.__userMock.calls.filter(call => call.operation === 'userAppRatings' && call.args.uid === '88'));
    assert.equal(calls.filter(call => !call.args.page || call.args.page === 1).length, 1); assert.deepEqual(calls[1].args, calls[2].args); assert.equal(calls[2].args.page, 2);
  });
  await record('late profile results cannot replace a different user after navigation', async () => {
    await page.evaluate(() => { window.__userMock.hold = true; window.__userNavigate({ type: 'profile', uid: '77', namespace: '43' }); });
    await page.waitForFunction(() => !!window.__userMock.release);
    await page.evaluate(() => window.__userNavigate({ uid: '88' })); await page.getByText('模拟酷友88', { exact: true }).waitFor();
    await page.evaluate(() => window.__userMock.release()); await page.waitForFunction(() => document.body.innerText.includes('模拟酷友88'));
    assert.equal(await page.getByText('模拟酷友77', { exact: true }).count(), 0);
  });
  assert.deepEqual(errors, []); writeFileSync('research/user-discovery-checks.json', JSON.stringify({ mode: 'synthetic renderer contract checks', externalRequests: 'blocked', checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
