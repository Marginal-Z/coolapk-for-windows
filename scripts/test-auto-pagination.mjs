import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('.local/auto-pagination'), port = Number(process.env.COOLAPK_AUTO_PAGINATION_PORT || 5236), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{useResource}from'/src/data.ts';import{LoadMore,ErrorNotice}from'/src/components.tsx';
function surfaceRows(rows){return(rows||[]).flatMap(row=>row.entities?.length?surfaceRows(row.entities):[row])}
function List({owner,id,dialog=false}){const r=useResource('list',{id,...(id==='bound'?{page:1000}:{})},owner);(window.__snapshots||={})[id]=r.data;return <section role={dialog?'dialog':undefined} style={{height:480,overflowY:'auto',border:'1px solid',width:650}} data-list={id}>{r.error&&<ErrorNotice error={r.error} onRetry={r.retry}/>}<div>{[...(r.data?.data||[]),...surfaceRows(r.data?.surfaceItems)].map(row=><p key={row.id||row.entityId} style={{height:120}}>{row.message||row.title}</p>)}</div>{r.data&&<LoadMore loading={r.loading} error={r.error} hasMore={r.data.hasMore} onClick={r.more}/>}</section>}
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
      if (mock.empty && args.page === 2) return {ok:true,data:{data:[],lastItem:'changed-empty',hasMore:true}};
      if(args.id.startsWith('surface')) {
        if(args.id==='surface-flat'&&page>1)return{ok:true,data:{data:[{entityType:'feed',id:'flat-page-two',message:'flat page two'}],hasMore:false}};
        const header={entityType:'card',entityTemplate:'iconLinkGridCard',entityId:'header',entityFixed:1,entities:[{entityType:'navigation',id:page===1?'nav-original':'nav-replaced',title:page===1?'original header':'replaced header'}]};
        const group={entityType:'card',entityTemplate:'feedCard',entityId:'recent',entities:[{entityType:'feed',id:'surface-a',message:'surface feed A'},...(page>1?[{entityType:'feed',id:'surface-b',message:'surface feed B'}]:[])]};
        return{ok:true,data:{data:[],surfaceItems:[header,group],lastItem:'surface-cursor-'+page,...(args.id==='surface-inferred'&&page>1?{}:{hasMore:true})}};
      }
      return { ok: true, data: { data: Array.from({ length: mock.short ? 1 : 10 }, (_, i) => ({ entityType: 'feed', id: args.id + ':' + page + ':' + i, message: args.id + '/p' + page + '/' + i })), firstItem: 'first', lastItem: mock.changedCursor && args.page === 2 ? 'changed-duplicate' : 'p' + page, hasMore: args.id==='bound' || page < 3 } };
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
  await check('duplicate pages with changing cursors stop until an explicit same-page retry', async page => {
    await page.evaluate(() => {window.__mock.repeat=true;window.__mock.changedCursor=true});await scroll(page);await page.getByText('列表暂未返回新的内容，请稍后重试',{exact:true}).waitFor();
    await scroll(page);assert.equal(await count(page),2);await page.evaluate(()=>window.__mock.repeat=false);await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('home/p2/0',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.__mock.calls.map(x=>x.page||1)),[1,2,2]);
  });
  await check('empty pages advertising more with a different cursor cannot advance or repeatedly load', async page => {
    await page.evaluate(()=>window.__mock.empty=true);await scroll(page);await page.getByText('列表暂未返回新的内容，请稍后重试',{exact:true}).waitFor();await scroll(page);assert.equal(await count(page),2);
    await page.evaluate(()=>window.__mock.empty=false);await page.getByRole('button',{name:'重试加载更多',exact:true}).click();await page.getByText('home/p2/0',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.__mock.calls.map(x=>x.page||1)),[1,2,2]);
  });
  await check('explicit initial page honors the API bound and never requests page 1001', async page => {
    await page.evaluate(()=>window.__spec({id:'bound'}));await page.getByText('bound/p1000/0',{exact:true}).waitFor();await scroll(page,'bound');await page.getByText('已达到列表的分页上限，请刷新后继续浏览',{exact:true}).waitFor();await scroll(page,'bound');
    assert.deepEqual(await page.evaluate(()=>window.__mock.calls.map(x=>[x.id,x.page||1])),[['home',1],['bound',1000]]);
  });
  await check('structured pages merge nested new feeds while retaining the initial fixed header', async page => {
    await page.evaluate(()=>window.__spec({id:'surface'}));await page.getByText('original header',{exact:true}).waitFor();await scroll(page,'surface');await page.getByText('surface feed B',{exact:true}).waitFor();
    assert.equal(await page.getByText('original header',{exact:true}).count(),1);assert.equal(await page.getByText('replaced header',{exact:true}).count(),0);assert.equal(await page.getByText('surface feed A',{exact:true}).count(),1);
    assert.equal(await page.getByText('列表暂未返回新的内容，请稍后重试',{exact:true}).count(),0);await scroll(page,'surface');await page.getByText('列表暂未返回新的内容，请稍后重试',{exact:true}).waitFor();await scroll(page,'surface');
    assert.deepEqual(await page.evaluate(()=>window.__mock.calls.map(x=>[x.id,x.page||1])),[['home',1],['surface',1],['surface',2],['surface',3]]);
  });
  await check('new structured content implies another page when the response omits hasMore', async page => {
    await page.evaluate(()=>window.__spec({id:'surface-inferred'}));await page.getByText('original header',{exact:true}).waitFor();await scroll(page,'surface-inferred');await page.getByText('surface feed B',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__snapshots['surface-inferred'].hasMore),true);assert.equal(await page.getByRole('button',{name:'已经看完了',exact:true}).count(),0);
  });
  await check('a later flat-only page retains structured first-page navigation', async page => {
    await page.evaluate(()=>window.__spec({id:'surface-flat'}));await page.getByText('original header',{exact:true}).waitFor();await scroll(page,'surface-flat');await page.getByText('flat page two',{exact:true}).waitFor();
    assert.equal(await page.getByText('original header',{exact:true}).count(),1);assert.equal(await page.getByText('surface feed A',{exact:true}).count(),1);await page.getByRole('button',{name:'已经看完了',exact:true}).waitFor();
  });
  await check('keyboard users retain an explicit pagination button', async page => {
    const more = page.getByRole('button', { name: '加载更多', exact: true }); await more.evaluate(node => node.focus({ preventScroll: true })); await page.keyboard.press('Enter'); await page.getByText('home/p2/0', { exact: true }).waitFor(); assert.equal(await count(page), 2);
  });
  assert.deepEqual(errors, []);
  writeFileSync(resolve('research/auto-pagination-checks.json'), JSON.stringify({ mode: 'isolated-browser-fixtures', checks, passed: true }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
