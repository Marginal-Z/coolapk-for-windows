import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('.local/resource-retry-check'), port = Number(process.env.COOLAPK_RESOURCE_RETRY_PORT || 5232), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';import{ClientError,useResource}from'/src/data.ts';import{ErrorNotice}from'/src/components.tsx';import'/src/styles.css';
function Resource({spec}){const resource=useResource(spec.operation,{id:spec.id},spec.namespace,spec.revision);window.__resourceCurrent=resource;return <section><h2>读取列表</h2>{resource.error&&<ErrorNotice error={resource.error} onRetry={resource.retry}/>}<div>{(resource.data?.data||[]).map(row=><p key={row.id}>{row.message}</p>)}</div><button onClick={resource.more}>下一页</button><button onClick={resource.retry}>重读列表</button></section>}
function CommitVerification({shown,complete}){useLayoutEffect(()=>{if(!shown&&complete){window.__resourceMock.commitCompletions++;window.__resourceMock.verifies[0].resolve()}},[shown,complete]);return null}
function Fixture(){const[spec,setSpec]=useState({operation:'listA',id:'10',namespace:'account-a',revision:0,shown:true});const[notice,setNotice]=useState({shown:false,id:'notice-original',message:'模拟验证',noise:0,completeOnUnmount:false,error:new ClientError('模拟验证','VERIFY_REQUIRED','notice-original')});window.__resourceSpec=patch=>setSpec(old=>({...old,...patch}));window.__noticeSpec=patch=>setNotice(old=>{const next={...old,...patch};return {...next,error:patch.replaceError||'id'in patch||'message'in patch?new ClientError(next.message,'VERIFY_REQUIRED',next.id):old.error}});window.__resourceMock.namespace=spec.namespace;return <main style={{maxWidth:900,padding:24}}>{spec.shown&&<Resource spec={spec}/>}<section>{notice.shown&&<ErrorNotice error={notice.error} onRetry={()=>window.__resourceMock.noticeCalls.push({id:notice.id,noise:notice.noise})}/>}</section><CommitVerification shown={notice.shown} complete={notice.completeOnUnmount}/></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser, context; const checks = [], errors = [], selected = process.env.COOLAPK_RESOURCE_RETRY_CASE;
async function record(id, name, run) {
  if (selected && selected !== id) return;
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try { await page.goto(`${origin}/.local/resource-retry-check/test.html`); await page.getByText('account-a/listA:10:p1', { exact: true }).waitFor(); await run(page); checks.push(name); console.log('PASS', name); }
  catch (error) { await page.screenshot({ path: resolve(output, `${id}-failure.png`) }); console.log('FAILURE_STATE', await page.locator('body').innerText()); throw error; }
  finally { await page.close(); }
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const calls = page => page.evaluate(() => window.__resourceMock.calls);
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__resourceMock = { calls: [], namespace: 'account-a', errors: {}, verifies: [], noticeCalls: [], commitCompletions: 0 };
    window.coolapk = { call: async (operation, args) => {
      const page = args.page || 1, key = `${operation}:${args.id}:${page}`; mock.calls.push({ operation, args: structuredClone(args), namespace: mock.namespace });
      if (mock.errors[key]) return { ok: false, error: { code: mock.errors[key], message: `模拟读取失败 ${key}`, ...(mock.errors[key] === 'VERIFY_REQUIRED' ? { verificationId: key } : {}) } };
      return { ok: true, data: { data: [{ entityType: 'feed', id: `${operation}:${args.id}:${page}`, message: `${mock.namespace}/${operation}:${args.id}:p${page}` }], firstItem: `${args.id}-first`, lastItem: `${args.id}-p${page}`, hasMore: page < 4 } };
    }, verify: id => new Promise((resolve, reject) => mock.verifies.push({ id, resolve: outcome => resolve({ ok: true, data: outcome || {} }), reject: () => reject(new Error('模拟验证失败')) })) };
  });
  await record('initial', 'initial read retry requests page one rather than a fabricated second page', async page => {
    await page.evaluate(() => { window.__resourceMock.errors['listA:11:1'] = 'NETWORK'; window.__resourceSpec({ id: '11' }); }); await page.getByText('模拟读取失败 listA:11:1', { exact: true }).waitFor();
    await page.evaluate(() => { delete window.__resourceMock.errors['listA:11:1']; window.__resourceCurrent.retry(); }); await page.getByText('account-a/listA:11:p1', { exact: true }).waitFor();
    assert.deepEqual((await calls(page)).filter(row => row.args.id === '11').map(row => row.args.page || 1), [1, 1]);
  });
  await record('pagination', 'network and verification retries repeat exact second-page cursors and keep loaded content', async page => {
    for (const [id, code] of [['12', 'NETWORK'], ['13', 'VERIFY_REQUIRED']]) {
      await page.evaluate(({ id, code }) => { window.__resourceSpec({ id }); window.__resourceMock.errors[`listA:${id}:2`] = code; }, { id, code }); await page.getByText(`account-a/listA:${id}:p1`, { exact: true }).waitFor();
      await page.getByRole('button', { name: '下一页', exact: true }).click(); await page.getByText(`模拟读取失败 listA:${id}:2`, { exact: true }).waitFor(); assert.equal(await page.getByText(`account-a/listA:${id}:p1`, { exact: true }).count(), 1);
      await page.evaluate(id => { delete window.__resourceMock.errors[`listA:${id}:2`]; }, id);
      if (code === 'NETWORK') await page.getByRole('button', { name: '重试', exact: true }).click();
      else { await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 1); await page.evaluate(() => window.__resourceMock.verifies[0].resolve()); }
      await page.getByText(`account-a/listA:${id}:p2`, { exact: true }).waitFor(); const requested = (await calls(page)).filter(row => row.args.id === id);
      assert.deepEqual(requested.map(row => row.args.page || 1), [1, 2, 2]); assert.deepEqual(requested[2].args, requested[1].args); assert.equal(await page.getByText(`account-a/listA:${id}:p1`, { exact: true }).count(), 1);
    }
  });
  await record('shared-proof', 'successful human verification retries only other blocked comment reads, not writes or unconfirmed challenges', async page => {
    for (const operation of ['replies', 'subReplies', 'feedCreate']) {
      await page.evaluate(operation => { window.__resourceMock.errors[`${operation}:41:1`] = 'VERIFY_REQUIRED'; window.__resourceSpec({ operation, id: '41' }); window.__noticeSpec({ shown: true }); }, operation);
      await page.getByText(`模拟读取失败 ${operation}:41:1`, { exact: true }).waitFor();
      const notice = page.getByRole('alert').filter({ hasText: '模拟验证' });
      await notice.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length > 0);
      const before = (await calls(page)).length;
      await page.evaluate(() => { window.__resourceMock.verifies.splice(0).forEach(item => item.resolve({ verified: false })); }); await settle(page); assert.equal((await calls(page)).length, before);
      await notice.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length > 0);
      await page.evaluate(() => { window.__resourceMock.errors = {}; window.__resourceMock.verifies.splice(0).forEach(item => item.resolve({ verified: true })); });
      if (operation === 'feedCreate') { await settle(page); assert.equal((await calls(page)).length, before); }
      else { await page.getByText(`account-a/${operation}:41:p1`, { exact: true }).waitFor(); assert.equal((await calls(page)).length, before + 1); }
      await page.evaluate(() => window.__noticeSpec({ shown: false }));
    }
  });
  await record('duplicate', 'synchronous duplicate pagination callbacks issue one request', async page => {
    const before = (await calls(page)).length; await page.evaluate(() => Promise.all([window.__resourceCurrent.more(), window.__resourceCurrent.more()])); await page.getByText('account-a/listA:10:p2', { exact: true }).waitFor(); assert.equal((await calls(page)).length, before + 1);
  });
  await record('stale-more', 'saved retry and more callbacks expire after account, operation or argument changes', async page => {
    for (const patch of [{ namespace: 'account-b' }, { operation: 'listB' }, { id: '20' }]) {
      await page.evaluate(patch => { window.__resourceSaved = { more: window.__resourceCurrent.more, retry: window.__resourceCurrent.retry }; window.__resourceSpec(patch); }, patch); await settle(page); await page.waitForFunction(() => !window.__resourceCurrent.loading);
      const before = (await calls(page)).length; await page.evaluate(async () => { await window.__resourceSaved.more(); window.__resourceSaved.retry(); }); await settle(page); assert.equal((await calls(page)).length, before);
    }
  });
  await record('generation', 'same-key refresh invalidates earlier callbacks without changing list scope', async page => {
    for (const refresh of ['revision', 'event', 'retry']) {
      const beforeRefresh = (await calls(page)).length;
      await page.evaluate(refresh => { window.__resourceSaved = { more: window.__resourceCurrent.more, retry: window.__resourceCurrent.retry }; if (refresh === 'revision') window.__resourceSpec({ revision: 1 }); else if (refresh === 'event') window.dispatchEvent(new Event('coolapk:refresh-resources')); else window.__resourceCurrent.retry(); }, refresh);
      await page.waitForFunction(count => window.__resourceMock.calls.length === count && !window.__resourceCurrent.loading, beforeRefresh + 1);
      const before = (await calls(page)).length; await page.evaluate(async () => { await window.__resourceSaved.more(); window.__resourceSaved.retry(); }); await settle(page); assert.equal((await calls(page)).length, before);
    }
  });
  await record('unmount', 'unmounted resources cannot use saved retry or more callbacks', async page => {
    await page.evaluate(() => { window.__resourceSaved = { more: window.__resourceCurrent.more, retry: window.__resourceCurrent.retry }; window.__resourceSpec({ shown: false }); }); await page.getByRole('heading', { name: '读取列表' }).waitFor({ state: 'hidden' });
    const before = (await calls(page)).length; await page.evaluate(async () => { await window.__resourceSaved.more(); window.__resourceSaved.retry(); }); await settle(page); assert.equal((await calls(page)).length, before);
  });
  await record('verification-scope', 'verification completion after an account or node change sends no stale retry request', async page => {
    for (const patch of [{ namespace: 'account-b' }, { id: '21' }]) {
      await page.evaluate(() => { const row = window.__resourceMock.calls.at(-1); window.__resourceMock.errors[`${row.operation}:${row.args.id}:2`] = 'VERIFY_REQUIRED'; }); await page.getByRole('button', { name: '下一页', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
      await page.waitForFunction(() => window.__resourceMock.verifies.length > 0); await page.evaluate(patch => window.__resourceSpec(patch), patch); await settle(page); await page.waitForFunction(() => !window.__resourceCurrent.loading);
      const before = (await calls(page)).length; await page.evaluate(() => { window.__resourceMock.errors = {}; window.__resourceMock.verifies.splice(0).forEach(item => item.resolve()); }); await settle(page); assert.equal((await calls(page)).length, before);
    }
  });
  await record('notice-change', 'a replaced verification error rejects the previous success callback', async page => {
    await page.evaluate(() => window.__noticeSpec({ shown: true })); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 1);
    await page.evaluate(() => window.__noticeSpec({ id: 'notice-replacement', message: '新验证错误' })); await page.getByText('新验证错误', { exact: true }).waitFor(); await page.evaluate(() => window.__resourceMock.verifies[0].resolve()); await settle(page);
    assert.deepEqual(await page.evaluate(() => window.__resourceMock.noticeCalls), []);
  });
  await record('notice-equivalent', 'a new error reference with the same verification values invalidates the earlier callback', async page => {
    await page.evaluate(() => window.__noticeSpec({ shown: true })); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 1);
    await page.evaluate(() => window.__noticeSpec({ replaceError: true, noise: 1 })); await settle(page); await page.evaluate(() => window.__resourceMock.verifies[0].resolve()); await settle(page); assert.deepEqual(await page.evaluate(() => window.__resourceMock.noticeCalls), []);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 2); await page.evaluate(() => window.__resourceMock.verifies[1].resolve()); await settle(page); assert.deepEqual(await page.evaluate(() => window.__resourceMock.noticeCalls), [{ id: 'notice-original', noise: 1 }]);
  });
  await record('notice-unmount', 'an unmounted verification notice rejects a success resolved during the unmount layout commit', async page => {
    await page.evaluate(() => window.__noticeSpec({ shown: true })); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 1);
    // Complete in a sibling layout effect, after DOM deletion but before passive
    // effect cleanup. Waiting for a hidden DOM node alone leaves this race untested.
    await page.evaluate(() => window.__noticeSpec({ shown: false, completeOnUnmount: true })); await page.getByRole('button', { name: '完成验证', exact: true }).waitFor({ state: 'hidden' }); await settle(page);
    assert.equal(await page.evaluate(() => window.__resourceMock.commitCompletions), 1); assert.deepEqual(await page.evaluate(() => window.__resourceMock.noticeCalls), []);
  });
  await record('notice-late-failure', 'a late verification failure cannot overwrite a new error or unlock its pending verification', async page => {
    await page.evaluate(() => window.__noticeSpec({ shown: true })); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 1);
    await page.evaluate(() => window.__noticeSpec({ id: 'notice-new', message: '新的独立验证错误' })); await page.getByText('新的独立验证错误', { exact: true }).waitFor(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 2);
    await page.evaluate(() => window.__resourceMock.verifies[0].reject()); await settle(page); assert.equal(await page.getByText('模拟验证失败', { exact: true }).count(), 0); assert.equal(await page.getByText('新的独立验证错误', { exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: '验证中…', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.__resourceMock.verifies[1].resolve()); await settle(page); assert.deepEqual(await page.evaluate(() => window.__resourceMock.noticeCalls), [{ id: 'notice-new', noise: 0 }]);
  });
  await record('notice-rerender', 'ordinary parent rerenders preserve verification and replay its original callback', async page => {
    await page.evaluate(() => window.__noticeSpec({ shown: true })); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__resourceMock.verifies.length === 1);
    await page.evaluate(() => window.__noticeSpec({ noise: 1 })); await settle(page); await page.evaluate(() => window.__resourceMock.verifies[0].resolve()); await settle(page);
    const completed = await page.evaluate(() => window.__resourceMock.noticeCalls); assert.deepEqual(completed, [{ id: 'notice-original', noise: 0 }]);
  });
  assert.deepEqual(errors, []); if (!checks.length) throw new Error('No matching resource retry checks');
  if (!selected) writeFileSync('research/resource-retry-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'isolated synthetic renderer; external network blocked; no real account writes', checks, errors }, null, 2));
} finally { await context?.close(); await browser?.close(); await server.close(); }
