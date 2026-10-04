import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('.local/plugin-pagination-check'), port = Number(process.env.COOLAPK_PLUGIN_PAGINATION_PORT || 5243), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountCenter}from'/src/AccountCenter.tsx';import'/src/styles.css';
function Fixture(){const[namespace,setNamespace]=useState('account-a');window.__owner=setNamespace;window.__pluginMock.namespace=namespace;return <main className="main-scroll" style={{height:480,width:780,overflowY:'auto',margin:20,padding:16}}><AccountCenter section="plugins" account={{uid:'1',username:'模拟账号'}} namespace={namespace} onLogin={()=>{}} onOpenEntity={()=>{}} onLink={()=>{}} toast={()=>{}}/></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser; const checks = [], errors = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const calls = page => page.evaluate(() => window.__pluginMock.calls);
async function wheel(page) { const box = await page.locator('.main-scroll').boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width / 2, box.y + 220); await page.mouse.wheel(0, 4000); await settle(page); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__pluginMock = { calls: [], namespace: 'account-a', duplicate: false, empty: false, fail: false, pending: false, resolve: null };
    window.coolapk = { call: async (operation, args) => {
      if (operation !== 'accountPlugins') throw new Error('Only read-only plugin requests are allowed in this fixture');
      const owner = mock.namespace, page = args.page || 1; mock.calls.push({ owner, ...structuredClone(args) });
      if (args.store && page === 2 && mock.pending) await new Promise(resolve => mock.resolve = resolve);
      if (args.store && page === 2 && mock.fail) return { ok: false, error: { code: 'NETWORK', message: '挂件分页网络失败' } };
      const rows = mock.empty && args.store ? [] : [0, 1].map(index => ({ id: (args.store ? 's' : 'm') + (mock.duplicate && page === 2 ? 1 : page) + ':' + index, title: owner + '/' + (args.store ? 'store' : 'mine') + '/p' + (mock.duplicate && page === 2 ? 1 : page) + '/' + index, plugin_type: 0, can_use: 1, is_get: 1 }));
      return { ok: true, data: { data: { pluginList: rows, avatarPluginList: rows }, hasMore: !!args.store && (mock.duplicate || mock.empty || page < 3) } };
    } };
  });
  async function check(name, run) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    try { await page.goto(`${origin}/.local/plugin-pagination-check/test.html`); await page.getByText('account-a/mine/p1/0', { exact: true }).waitFor(); await run(page); checks.push(name); console.log('PASS', name); }
    catch (error) { await page.screenshot({ path: resolve(output, `failure-${checks.length}.png`) }); console.log('FAILURE_STATE', await page.locator('body').innerText()); throw error; }
    finally { await page.close(); }
  }
  const store = async page => { await page.getByRole('tab', { name: '挂件商店', exact: true }).click(); await page.getByText('account-a/store/p1/0', { exact: true }).waitFor(); };
  await check('plugin store scrolling adds one page per gesture and stops at the end', async page => {
    await store(page); await wheel(page); await page.getByText('account-a/store/p2/0', { exact: true }).waitFor(); assert.equal((await calls(page)).length, 3);
    await wheel(page); await page.getByText('account-a/store/p3/0', { exact: true }).waitFor(); await page.getByRole('button', { name: '已经看完了', exact: true }).waitFor(); await wheel(page);
    assert.deepEqual((await calls(page)).map(row => [row.store, row.page]), [[false, 1], [true, 1], [true, 2], [true, 3]]);
  });
  await check('duplicate plugin pages retain earlier rows and explicit retry repeats the stalled page', async page => {
    await page.evaluate(() => window.__pluginMock.duplicate = true); await store(page); await wheel(page); await page.getByText('挂件列表暂未返回新的内容，请稍后重试', { exact: true }).waitFor(); await wheel(page);
    assert.equal((await calls(page)).length, 3); assert.equal(await page.getByText('account-a/store/p1/0', { exact: true }).count(), 1);
    await page.evaluate(() => window.__pluginMock.duplicate = false); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('account-a/store/p2/0', { exact: true }).waitFor();
    assert.deepEqual((await calls(page)).map(row => row.page), [1, 1, 2, 2]);
  });
  await check('an empty first plugin page advertising more shows retry rather than a false end', async page => {
    await page.evaluate(() => window.__pluginMock.empty = true); await page.getByRole('tab', { name: '挂件商店', exact: true }).click(); await page.getByText('挂件列表暂未返回新的内容，请稍后重试', { exact: true }).waitFor(); await wheel(page);
    assert.equal((await calls(page)).length, 2); assert.equal(await page.getByRole('button', { name: '已经看完了', exact: true }).count(), 0);
    await page.evaluate(() => window.__pluginMock.empty = false); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('account-a/store/p1/0', { exact: true }).waitFor();
    assert.deepEqual((await calls(page)).map(row => row.page), [1, 1, 1]);
  });
  await check('network failure keeps plugin rows and retries the same requested page only', async page => {
    await store(page); await page.evaluate(() => window.__pluginMock.fail = true); await wheel(page); await page.getByText('挂件分页网络失败', { exact: true }).waitFor(); await wheel(page);
    assert.equal((await calls(page)).length, 3); assert.equal(await page.getByText('account-a/store/p1/0', { exact: true }).count(), 1);
    await page.evaluate(() => window.__pluginMock.fail = false); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('account-a/store/p2/0', { exact: true }).waitFor(); assert.deepEqual((await calls(page)).map(row => row.page), [1, 1, 2, 2]);
  });
  await check('rapid wheels cannot duplicate an in-flight page and a later account discards its result', async page => {
    await store(page); await page.evaluate(() => window.__pluginMock.pending = true); await wheel(page); await page.waitForFunction(() => !!window.__pluginMock.resolve); await wheel(page); await wheel(page); assert.equal((await calls(page)).length, 3);
    await page.evaluate(() => window.__owner('account-b')); await page.getByText('account-b/mine/p1/0', { exact: true }).waitFor(); await page.evaluate(() => window.__pluginMock.resolve()); await settle(page);
    assert.equal(await page.getByText('account-a/store/p2/0', { exact: true }).count(), 0); assert.equal(await page.getByText('account-a/store/p1/0', { exact: true }).count(), 0); assert.equal((await calls(page)).length, 4);
  });
  assert.deepEqual(errors, []);
  writeFileSync(resolve('research/plugin-pagination-checks.json'), JSON.stringify({ mode: 'isolated-browser-fixtures', checks, passed: true }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
