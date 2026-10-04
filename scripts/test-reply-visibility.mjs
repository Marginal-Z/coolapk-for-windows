import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/reply-visibility-check', { recursive: true });
writeFileSync('.local/reply-visibility-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><main id="root"></main><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import Detail from'/src/Detail.tsx';import{clearCache,refreshResources}from'/src/data.ts';import'/src/styles.css';
function Harness(){const[state,setState]=useState({namespace:'visibility-owner',accountUid:'123456',loggedIn:true});useEffect(()=>{window.__replyView=patch=>setState(old=>({...old,...patch}));window.__replyRefresh=()=>refreshResources();window.__replyClear=()=>clearCache();},[]);return React.createElement(Detail,{feed:{id:'101',uid:'123456',username:'原动态作者',message:'原动态测试内容',replynum:20},namespace:state.namespace,onClose:()=>{window.__replyClosed=true;},feedProps:{...state,onLogin:()=>{window.__replyLogin=true;},onUser:()=>{},onLink:()=>{},onOpen:()=>{},onForward:()=>{},toast:text=>{window.__replyToast=text;}}});}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_REPLY_VISIBILITY_PORT || 5304), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const checks = [], errors = []; let browser;
const record = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const row = (id, patch = {}) => ({ entityType: 'feed_reply', id: String(id), fid: '101', feedUid: '123456', uid: '654321', username: '测试评论者 ' + id, message: '评论内容 ' + id + '。 '.repeat(20), block_status: 0, userHideReplyRemaining: '3', replynum: 0, ...patch });
    const mock = window.__replyMock = { calls: [], rows: [row(201, { replynum: 1, replyRows: [row(211)] }), row(202, { userHideReplyRemaining: undefined }), row(203, { feedUid: '777777', uid: '123456' }), row(204, { block_status: 4, userHideReplyRemaining: '0' }), row(205, { block_status: 4 }), row(206, { userHideReplyRemaining: '2.5' }), row(207, { fid: '102' }), row(208)], records: {}, fail: null, hold: false, release: null, holdVerify: false, releaseVerify: null, verified: false };
    const lookup = id => mock.records[id] || mock.rows.find(item => item.id === id) || row(id);
    const permission = value => ({ visible: value.feedUid === '123456' && /^\d+$/.test(value.userHideReplyRemaining || '') && value.fid === '101', enabled: Number(value.userHideReplyRemaining) > 0, action: value.block_status === 4 ? 'resume' : 'hide', reason: Number(value.userHideReplyRemaining) === 0 ? '今日隐藏回复次数已用完，暂不能隐藏或取消隐藏' : '' });
    window.coolapk = {
      openExternal: async () => ({ ok: true, data: {} }),
      verify: async () => { if (mock.holdVerify) await new Promise(resolve => { mock.releaseVerify = resolve; }); mock.verified = true; return { ok: true, data: { verified: true } }; },
      call: async (operation, args = {}) => {
        mock.calls.push({ operation, args: structuredClone(args) });
        const result = data => ({ ok: true, data }), rows = data => result({ data, hasMore: false });
        if (operation === 'detail') return result({ data: { id: '101', uid: '123456', username: '原动态作者', message: '原动态测试内容', replynum: 20 } });
        if (['replies', 'hotReplies', 'advancedReplies'].includes(operation)) { const page = Number(args.page || 1); return result({ data: page === 1 ? structuredClone(mock.rows) : [row(301)], firstItem: '201', lastItem: page === 1 ? '208' : '301', hasMore: page < 2 }); }
        if (operation === 'subReplies') return rows([row(211)]);
        if (operation === 'replyVisibility') { const value = structuredClone(lookup(args.id)); return result({ data: { reply: value, permission: permission(value) } }); }
        if (operation === 'replyVisibilityUpdate') {
          if (mock.hold) await new Promise(resolve => { mock.release = resolve; });
          if (mock.fail === 'captcha' && !mock.verified) return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟官方要求验证码', verificationId: 'reply-visibility-synthetic-challenge' } };
          if (mock.fail === 'unconfirmed') return { ok: false, error: { code: 'WRITE_UNCONFIRMED', message: '模拟提交响应丢失' } };
          const value = { ...structuredClone(lookup(args.id)), block_status: args.action === 'hide' ? 4 : 0, userHideReplyRemaining: '2' };
          mock.records[args.id] = value;
          return result({ data: { reply: value, permission: permission(value) }, confirmed: true });
        }
        if (operation === 'action') throw new Error('This author-hide test must never dispatch a general social action');
        return rows([]);
      },
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/reply-visibility-harness.html');
  const comment = id => page.locator(`[data-comment-id="${id}"]`).first();
  const modal = () => page.getByRole('dialog', { name: '管理回复曝光', exact: true });
  const calls = operation => page.evaluate(operation => window.__replyMock.calls.filter(call => call.operation === operation), operation);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await comment('201').waitFor();
  await record('only original author with valid explicit quota sees hide; missing fields, other author and invalid context do not invent permission', async () => {
    assert.equal(await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).count(), 1);
    for (const id of ['202', '203', '206', '207']) assert.equal(await comment(id).locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: /^(隐藏回复|取消隐藏回复)$/ }).count(), 0);
    assert.equal(await comment('203').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '删除我的评论', exact: true }).count(), 1);
    assert.equal(await comment('204').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).isDisabled(), true);
    assert.equal((await calls('replyVisibilityUpdate')).length, 0);
  });
  await record('hide preparation rereads exact comment and cancel closes clearly without a mutation', async () => {
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByText(/剩余额度：3 条/).waitFor();
    assert.deepEqual((await calls('replyVisibility')).at(-1).args, { id: '201', feedId: '101' });
    assert.match(await modal().textContent(), /减少曝光，仍可能被查看/);
    await modal().getByRole('button', { name: '取消', exact: true }).click(); assert.equal((await calls('replyVisibilityUpdate')).length, 0);
    assert.equal(await page.evaluate(() => window.__replyToast), '已取消回复隐藏操作');
  });
  await record('fresh server quota supersedes a stale enabled row and cannot be confirmed after exhaustion', async () => {
    await page.evaluate(() => { const mock = window.__replyMock; mock.records['208'] = { ...mock.rows.find(item => item.id === '208'), userHideReplyRemaining: '0' }; });
    await comment('208').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click();
    await modal().getByText(/剩余额度：0 条/).waitFor(); assert.equal(await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).isDisabled(), true);
    await modal().getByRole('button', { name: '取消', exact: true }).click(); assert.equal((await calls('replyVisibilityUpdate')).length, 0);
    await page.evaluate(() => { delete window.__replyMock.records['208']; });
  });
  await record('confirmed hide preserves paging, sorting, scroll and expanded replies and updates the record from readback', async () => {
    await comment('201').getByRole('button', { name: '查看 1 条回复', exact: true }).click(); await comment('211').waitFor();
    await page.getByRole('button', { name: '加载更多', exact: true }).last().click(); await comment('301').waitFor();
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).waitFor();
    await page.evaluate(() => { document.querySelector('.detail-scroll').scrollTop = 100; }); await settle();
    const before = await page.evaluate(() => ({ scroll: document.querySelector('.detail-scroll').scrollTop, sort: document.querySelector('[aria-label="评论排序"]').value, reads: window.__replyMock.calls.filter(call => ['replies','hotReplies','advancedReplies'].includes(call.operation)).length }));
    await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).click(); await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).waitFor();
    assert.deepEqual((await calls('replyVisibilityUpdate')).at(-1).args, { id: '201', feedId: '101', action: 'hide' });
    assert.equal(await comment('301').count(), 1); assert.equal(await comment('211').count(), 1);
    assert.equal(await comment('201').getByRole('button', { name: '收起回复', exact: true }).count(), 1);
    const after = await page.evaluate(() => ({ scroll: document.querySelector('.detail-scroll').scrollTop, sort: document.querySelector('[aria-label="评论排序"]').value, reads: window.__replyMock.calls.filter(call => ['replies','hotReplies','advancedReplies'].includes(call.operation)).length }));
    assert.deepEqual(after, before); assert.equal(await page.evaluate(() => window.__replyToast), '已确认回复隐藏，曝光减少');
  });
  await record('resume uses the explicit hidden-state action and preserves the visible comment', async () => {
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认取消隐藏', exact: true }).click();
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).waitFor(); assert.deepEqual((await calls('replyVisibilityUpdate')).at(-1).args, { id: '201', feedId: '101', action: 'resume' }); assert.equal(await comment('201').count(), 1);
  });
  await record('a newer page-one server refresh supersedes prior local confirmations without changing sort selection', async () => {
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).click(); await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).waitFor();
    await page.evaluate(() => { const mock = window.__replyMock; mock.rows[0] = { ...mock.rows[0], block_status: 0, userHideReplyRemaining: '1' }; delete mock.records['201']; window.__replyRefresh(); });
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).waitFor(); assert.equal(await page.getByRole('combobox', { name: '评论排序', exact: true }).inputValue(), 'lastupdate_desc');
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByText(/剩余额度：1 条/).waitFor(); await modal().getByRole('button', { name: '取消', exact: true }).click();
  });
  await record('unconfirmed writes keep comments and only reread the original record without automatic mutation replay', async () => {
    await page.evaluate(() => { window.__replyMock.fail = 'unconfirmed'; });
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).click();
    const check = page.getByRole('dialog', { name: '核对回复隐藏结果', exact: true }); await check.getByText('模拟提交响应丢失', { exact: true }).waitFor();
    const before = (await calls('replyVisibilityUpdate')).length; await check.getByRole('button', { name: '重新读取原评论核对', exact: true }).click(); await check.getByText(/原评论尚未显示目标状态/).waitFor(); assert.equal((await calls('replyVisibilityUpdate')).length, before);
    await page.evaluate(() => { const mock = window.__replyMock; mock.records['201'] = { ...mock.rows[0], block_status: 4, userHideReplyRemaining: '0' }; });
    await check.getByRole('button', { name: '重新读取原评论核对', exact: true }).click(); await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).waitFor(); assert.equal(await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).isDisabled(), true); assert.equal((await calls('replyVisibilityUpdate')).length, before);
  });
  await record('manual official verification replays the same confirmed action and leaves no unrelated write capability', async () => {
    await page.evaluate(() => { const mock = window.__replyMock; mock.fail = 'captcha'; mock.verified = false; mock.records['201'] = { ...mock.rows[0], block_status: 0, userHideReplyRemaining: '3' }; mock.rows[0] = mock.records['201']; window.__replyRefresh(); });
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).waitFor(); await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '完成验证', exact: true }).click();
    await comment('201').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).waitFor(); const writes = await calls('replyVisibilityUpdate'); assert.deepEqual(writes.at(-1).args, writes.at(-2).args); assert.equal((await calls('action')).length, 0);
  });
  await record('changing account while a write resolves drops its result and never applies old-author state to the new account', async () => {
    await page.evaluate(() => { const mock = window.__replyMock; mock.fail = null; mock.hold = true; mock.release = null; });
    await comment('205').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '取消隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认取消隐藏', exact: true }).click(); await page.waitForFunction(() => !!window.__replyMock.release);
    const toast = await page.evaluate(() => window.__replyToast); await page.evaluate(() => window.__replyView({ accountUid: '777777' })); await settle(); await page.evaluate(() => window.__replyMock.release()); await settle();
    assert.equal(await comment('205').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: /^(隐藏回复|取消隐藏回复)$/ }).count(), 0); assert.equal(await page.getByRole('dialog', { name: '管理回复曝光', exact: true }).count(), 0); assert.equal(await page.evaluate(() => window.__replyToast), toast);
  });
  await record('an old verification finishing after an account change cannot replay or show a successful hide', async () => {
    await page.evaluate(() => { const mock = window.__replyMock; mock.hold = false; mock.fail = 'captcha'; mock.verified = false; mock.holdVerify = true; mock.releaseVerify = null; window.__replyView({ accountUid: '123456', namespace: 'visibility-verify-owner' }); });
    await comment('208').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).waitFor(); await comment('208').locator(':scope > .comment-body > .comment-actions').getByRole('button', { name: '隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '确认隐藏回复', exact: true }).click(); await modal().getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__replyMock.releaseVerify);
    const before = (await calls('replyVisibilityUpdate')).length; await page.evaluate(() => window.__replyView({ accountUid: '777777', namespace: 'visibility-after-verify' })); await settle(); await page.evaluate(() => window.__replyMock.releaseVerify()); await settle(); assert.equal((await calls('replyVisibilityUpdate')).length, before);
  });
  await record('guest reading never offers author hiding or authenticated visibility calls', async () => {
    const before = (await calls('replyVisibility')).length; await page.evaluate(() => window.__replyView({ accountUid: '', loggedIn: false, namespace: 'visibility-guest' })); await comment('201').waitFor(); await settle();
    assert.equal(await page.getByRole('button', { name: /^(隐藏回复|取消隐藏回复)$/ }).count(), 0); assert.equal((await calls('replyVisibility')).length, before);
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/reply-visibility-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'isolated real Detail renderer with synthetic bridge; external network blocked; no real mutation or phone credential access', acceptance: { implementation: 'native API binding and readback guarded', synthetic: 'passed', authenticatedLive: 'not performed; requires desktop login and real server permission/quota' }, checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
