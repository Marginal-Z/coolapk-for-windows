import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('.local/auto-pagination'), port = Number(process.env.COOLAPK_AUTO_PAGINATION_PORT || 5236), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{useResource}from'/src/data.ts';import{LoadMore,ErrorNotice}from'/src/components.tsx';
function List({owner,id,dialog=false}){const r=useResource('list',{id},owner);return <section role={dialog?'dialog':undefined} style={{height:480,overflowY:'auto',border:'1px solid',width:650}} data-list={id}>{r.error&&<ErrorNotice error={r.error} onRetry={r.retry}/>}<div>{(r.data?.data||[]).map(row=><p key={row.id} style={{height:120}}>{row.message}</p>)}</div>{r.data&&<LoadMore loading={r.loading} error={r.error} hasMore={r.data.hasMore} onClick={r.more}/>}</section>}
function App(){const[s,set]=useState({owner:'guest',id:'home',shown:true,dialog:false});window.__spec=p=>set(v=>({...v,...p}));return <main>{s.shown&&<List key={s.owner+':'+s.id} owner={s.owner} id={s.id}/>} {s.dialog&&<List owner={s.owner} id="dialog" dialog/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 1100 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__mock = { calls: [], fail: false, pending: false, resolve: null };
    window.coolapk = { call: async (operation, args) => {
      const page = mock.repeat && (args.page || 1) > 1 ? 1 : args.page || 1; mock.calls.push(structuredClone(args));
      if (page === 2 && args.id === 'home' && mock.fail) return { ok: false, error: { code: 'NETWORK', message: '分页暂时失败' } };
      if (page === 2 && args.id === 'home' && mock.pending) await new Promise(resolve => mock.resolve = resolve);
      return { ok: true, data: { data: Array.from({ length: mock.short ? 1 : 10 }, (_, i) => ({ entityType: 'feed', id: args.id + ':' + page + ':' + i, message: args.id + '/p' + page + '/' + i })), firstItem: 'first', lastItem: 'p' + page, hasMore: page < 3 } };
    } };
  });
  const count = page => page.evaluate(() => window.__mock.calls.length);
  const scroll = async (page, id = 'home') => {
    const box = await page.locator(`[data-list="${id}"]`).boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width / 2, box.y + 180); await page.mouse.wheel(0, 6000); await settle(page);
  };
  const settle = async page => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  async function check(name, run) {
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    try { await page.goto(`${origin}/.local/auto-pagination/test.html`); await page.getByText('home/p1/0', { exact: true }).waitFor(); await run(page); checks.push(name); console.log('PASS', name); }
    catch (e) { await page.screenshot({ path: resolve(output, `failure-${checks.length}.png`) }); throw e; }
    finally { await page.close(); }
  }
  await check('downward scrolling loads each page once and stops at the end', async page => {
    assert.equal(await count(page), 1); await scroll(page); await page.getByText('home/p2/0', { exact: true }).waitFor();
    await scroll(page); await page.getByText('home/p3/0', { exact: true }).waitFor(); await page.getByRole('button', { name: '已经看完了' }).waitFor();
    await scroll(page); await settle(page); assert.deepEqual(await page.evaluate(() => window.__mock.calls.map(x => x.page || 1)), [1, 2, 3]);
  });
  await check('failed pagination keeps content and stops automatic retries until a manual retry', async page => {
    await page.evaluate(() => window.__mock.fail = true); await scroll(page); await page.getByText('分页暂时失败', { exact: true }).waitFor();
    assert.equal(await page.getByText('home/p1/0', { exact: true }).count(), 1);
    await page.locator('[data-list="home"]').evaluate(node => node.scrollTop -= 20); await scroll(page); await settle(page); assert.equal(await count(page), 2);
    await page.evaluate(() => window.__mock.fail = false); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('home/p2/0', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__mock.calls); assert.deepEqual(calls.map(x => x.page || 1), [1, 2, 2]); assert.deepEqual(calls[1], calls[2]);
  });
  await check('a late page cannot append after the account and list change', async page => {
    await page.evaluate(() => window.__mock.pending = true); await scroll(page); await page.waitForFunction(() => !!window.__mock.resolve);
    await page.evaluate(() => window.__spec({ owner: 'account-b', id: 'changed' })); await page.getByText('changed/p1/0', { exact: true }).waitFor();
    await page.evaluate(() => window.__mock.resolve()); await settle(page); assert.equal(await page.getByText('home/p2/0', { exact: true }).count(), 0); assert.equal(await count(page), 3);
  });
  await check('the active dialog owns scrolling and background lists stay idle', async page => {
    await page.evaluate(() => window.__spec({ dialog: true })); await page.getByText('dialog/p1/0', { exact: true }).waitFor();
    await scroll(page); await settle(page); assert.equal(await count(page), 2);
    await scroll(page, 'dialog'); await page.getByText('dialog/p2/0', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__mock.calls.map(x => [x.id, x.page || 1])), [['home', 1], ['dialog', 1], ['dialog', 2]]);
  });
  await check('a repeated page with an unchanged cursor cannot create an automatic request loop', async page => {
    await page.evaluate(() => window.__mock.repeat = true); await scroll(page); await page.getByText('列表暂未返回新的内容，请稍后重试', { exact: true }).waitFor();
    await scroll(page); await settle(page); assert.equal(await count(page), 2); assert.equal(await page.getByText('home/p1/0', { exact: true }).count(), 1);
  });
  await check('a downward wheel also loads short lists and programmatic scrolling stays idle', async page => {
    await page.locator('[data-list="home"]').evaluate(node => node.scrollTop = node.scrollHeight); await settle(page); assert.equal(await count(page), 1);
    await page.evaluate(() => { window.__mock.short = true; window.__spec({ id: 'short' }); }); await page.getByText('short/p1/0', { exact: true }).waitFor();
    const box = await page.locator('[data-list="short"]').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 180); await page.mouse.wheel(0, 1000);
    await page.getByText('short/p2/0', { exact: true }).waitFor(); assert.equal(await count(page), 3);
  });
  await check('keyboard users retain an explicit pagination button', async page => {
    const more = page.getByRole('button', { name: '加载更多', exact: true }); await more.evaluate(node => node.focus({ preventScroll: true })); await page.keyboard.press('Enter'); await page.getByText('home/p2/0', { exact: true }).waitFor(); assert.equal(await count(page), 2);
  });
  assert.deepEqual(errors, []);
  writeFileSync(resolve('research/auto-pagination-checks.json'), JSON.stringify({ mode: 'isolated-browser-fixtures', checks, passed: true }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
