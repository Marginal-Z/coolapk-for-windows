import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('.local/guest-comments-check');
const port = Number(process.env.COOLAPK_GUEST_COMMENTS_PORT || 5266), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{act,useState}from'react';import{createRoot}from'react-dom/client';import Detail from'/src/Detail.tsx';import'/src/styles.css';
window.IS_REACT_ACT_ENVIRONMENT=true;window.__guestFlush=fn=>act(async()=>fn());
function Fixture(){const[view,setView]=useState({id:'101',namespace:'guest',shown:true,ticket:0});window.__guestNavigate=patch=>setView(old=>({...old,...patch,ticket:old.ticket+1}));window.__guestMock.namespace=view.namespace;const feed={id:view.id,entityType:'feed',uid:'301',username:'公开作者',message:'公开动态 '+view.id,replynum:3};const props={loggedIn:false,accountUid:'',onLogin:()=>window.__guestMock.login++,onLink:()=>{},onUser:()=>{},onForward:()=>{},toast:()=>{}};return <main data-guest-scope={JSON.stringify([view.id,view.namespace,view.shown,view.ticket])}>{view.shown&&<Detail feed={feed} namespace={view.namespace} feedProps={props} onClose={()=>window.__guestNavigate({shown:false})}/>}</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser, context; const checks = [], errors = [];
async function record(name, run) {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try { await page.goto(`${origin}/.local/guest-comments-check/test.html`); await page.getByText('游客评论 101 第1页', { exact: true }).waitFor(); await run(page); checks.push(name); console.log('PASS', name); }
  catch (error) { await page.screenshot({ path: resolve(output, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); throw error; }
  finally { await page.close(); }
}
const calls = page => page.evaluate(() => window.__guestMock.calls);
const commentsFor = (records, id) => records.filter(record => record.operation === 'replies' && record.args.id === id);
const navigate = async (page, patch) => {
  const expected = await page.evaluate(patch => { window.__guestNavigate(patch); return patch; }, patch);
  await page.waitForFunction(expected => { const [id, namespace, shown] = JSON.parse(document.querySelector('main').dataset.guestScope); return (!('id' in expected) || id === expected.id) && (!('namespace' in expected) || namespace === expected.namespace) && (!('shown' in expected) || shown === expected.shown); }, expected);
};
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__guestMock = { calls: [], namespace: 'guest', failures: {}, login: 0, verifies: [], holdVerify: false, releaseVerify: null, cancelled: false };
    const key = (operation, args) => [operation, args.id || args.rid, args.page || 1].join(':');
    const ok = data => ({ ok: true, data });
    window.coolapk = {
      verify: async id => {
        mock.verifies.push(id);
        if (mock.holdVerify) await new Promise(resolve => { mock.releaseVerify = resolve; });
        if (mock.cancelled) return { ok: false, error: { code: 'APP_ERROR', message: '已取消验证，请重新读取评论' } };
        delete mock.failures[id]; return ok({ verified: true });
      },
      call: async (operation, args = {}) => {
        mock.calls.push({ operation, args: structuredClone(args), namespace: mock.namespace });
        if (['action', 'uploadImage', 'uploadLivePhoto', 'uploadVideo', 'publish'].includes(operation)) throw new Error('Guest test attempted a write: ' + operation);
        const request = key(operation, args), failure = mock.failures[request];
        if (failure) return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '官方要求验证当前公开读取', ...(failure === 'challenge' ? { verificationId: request } : {}) } };
        if (operation === 'detail') return ok({ data: { id: args.id, entityType: 'feed', uid: '301', username: '公开作者', message: '公开动态 ' + args.id, replynum: 3 } });
        if (operation === 'subReplies') return ok({ data: [{ id: '921', uid: '302', username: '楼中楼作者', message: '游客楼中楼 ' + args.rid }], hasMore: false });
        if (['replies', 'advancedReplies', 'hotReplies'].includes(operation)) {
          const page = args.page || 1;
          return ok({ data: [{ id: page === 1 ? '901' : '902', entityType: 'feedReply', uid: '302', username: '公开评论者', message: '游客评论 ' + args.id + ' 第' + page + '页', replynum: page === 1 ? 1 : 0 }], firstItem: '901', lastItem: page === 1 ? '901' : '902', hasMore: page === 1 });
        }
        return ok({ data: [] });
      },
    };
  });
  await record('guest can read public comments, expand sub-replies and change sort without any login or write', async page => {
    await page.getByRole('button', { name: '查看 1 条回复', exact: true }).click(); await page.getByText('游客楼中楼 901', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '评论排序' }).selectOption('dateline_desc'); await page.waitForFunction(() => window.__guestMock.calls.some(call => call.operation === 'advancedReplies'));
    await page.getByRole('combobox', { name: '评论排序' }).selectOption('popular'); await page.waitForFunction(() => window.__guestMock.calls.some(call => call.operation === 'replies' && call.args.sort === 'popular'));
    await page.getByRole('combobox', { name: '评论排序' }).selectOption('discussion'); await page.waitForFunction(() => window.__guestMock.calls.some(call => call.operation === 'hotReplies'));
    assert.equal(await page.evaluate(() => window.__guestMock.login), 0);
    assert.equal(await page.getByRole('option', { name: '折叠与隐藏', exact: true }).count(), 0);
    await page.getByRole('button', { name: '登录后评论', exact: true }).click(); assert.equal(await page.evaluate(() => window.__guestMock.login), 1);
    assert.ok((await calls(page)).every(record => !['action', 'publish'].includes(record.operation)));
  });
  await record('manual guest verification resumes comments and retries a parallel challenged detail once using the accepted proof', async page => {
    await page.evaluate(() => { window.__guestMock.failures['replies:102:1'] = 'challenge'; window.__guestMock.failures['detail:102:1'] = 'challenge'; });
    await navigate(page, { id: '102' }); await page.getByRole('status').filter({ hasText: '浏览评论无需先登录' }).waitFor();
    await page.getByRole('button', { name: '完成验证', exact: true }).last().click(); await page.getByText('游客评论 102 第1页', { exact: true }).waitFor();
    const requested = await calls(page), reads = commentsFor(requested, '102'); assert.equal(reads.length, 2); assert.deepEqual(reads[0].args, reads[1].args);
    assert.equal(requested.filter(record => record.operation === 'detail' && record.args.id === '102').length, 2); assert.equal(await page.getByRole('button', { name: '完成验证', exact: true }).count(), 1);
    assert.deepEqual(await page.evaluate(() => window.__guestMock.verifies), ['replies:102:1']); assert.equal(await page.evaluate(() => window.__guestMock.login), 0);
  });
  await record('comment page-two verification keeps page one and retries the same sort and cursors', async page => {
    await page.evaluate(() => { window.__guestMock.failures['replies:101:2'] = 'challenge'; });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('官方要求验证当前公开读取', { exact: true }).waitFor();
    assert.equal(await page.getByText('游客评论 101 第1页', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('游客评论 101 第2页', { exact: true }).waitFor();
    const reads = commentsFor(await calls(page), '101'); assert.deepEqual(reads.map(read => read.args.page || 1), [1, 2, 2]); assert.deepEqual(reads[1].args, reads[2].args);
    assert.equal(reads[2].args.firstItem, '901'); assert.equal(reads[2].args.lastItem, '901'); assert.equal(reads[2].args.sort, 'lastupdate_desc');
  });
  await record('verifying a detail retries only that detail and preserves the already loaded comments', async page => {
    await page.evaluate(() => { window.__guestMock.failures['detail:103:1'] = 'challenge'; }); await navigate(page, { id: '103' });
    await page.getByText('游客评论 103 第1页', { exact: true }).waitFor(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.getByRole('button', { name: '完成验证', exact: true }).waitFor({ state: 'hidden' });
    const records = await calls(page); assert.equal(records.filter(record => record.operation === 'detail' && record.args.id === '103').length, 2); assert.equal(commentsFor(records, '103').length, 1);
  });
  await record('cancelled verification and unsupported challenge stay visible, with an explicit way to read comments again', async page => {
    await page.evaluate(() => { window.__guestMock.failures['replies:104:1'] = 'challenge'; window.__guestMock.cancelled = true; }); await navigate(page, { id: '104' });
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('已取消验证，请重新读取评论', { exact: true }).waitFor();
    assert.equal(commentsFor(await calls(page), '104').length, 1);
    await page.evaluate(() => { window.__guestMock.cancelled = false; window.__guestMock.failures['replies:104:1'] = 'unsupported'; }); await page.getByRole('button', { name: '重新读取评论', exact: true }).click();
    await page.getByRole('button', { name: '重试', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '完成验证', exact: true }).count(), 0);
    await page.evaluate(() => { delete window.__guestMock.failures['replies:104:1']; }); await page.getByRole('button', { name: '重新读取评论', exact: true }).click(); await page.getByText('游客评论 104 第1页', { exact: true }).waitFor();
    assert.equal(commentsFor(await calls(page), '104').length, 3); assert.equal(await page.evaluate(() => window.__guestMock.login), 0);
  });
  await record('changing the feed and account namespace while verifying never issues the old comment read', async page => {
    await page.evaluate(() => { window.__guestMock.failures['replies:105:1'] = 'challenge'; window.__guestMock.holdVerify = true; }); await navigate(page, { id: '105' });
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__guestMock.releaseVerify);
    await navigate(page, { id: '106', namespace: 'guest-after-switch' }); await page.getByText('游客评论 106 第1页', { exact: true }).waitFor();
    await page.evaluate(() => window.__guestFlush(() => window.__guestMock.releaseVerify()));
    assert.equal(commentsFor(await calls(page), '105').length, 1); assert.equal(await page.getByText('游客评论 105 第1页', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__guestMock.login), 0);
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/guest-comment-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'Synthetic renderer only; outside browser requests blocked; no live captcha solved, account opened or content written', checks, errors, limitations: ['Official service may require a manual challenge for guest reads; this test verifies the explicit challenge flow, not real service acceptance.'] }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
