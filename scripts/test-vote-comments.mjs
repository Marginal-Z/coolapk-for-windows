import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
mkdirSync('.local/vote-comments-check', { recursive: true });
writeFileSync('.local/vote-comments-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{VoteCard}from'/src/Community.tsx';import'/src/styles.css';
function Harness(){const[view,setView]=useState({id:'42',namespace:'A'});useEffect(()=>{window.__voteCommentsNavigate=setView},[]);return React.createElement('main',{style:{maxWidth:800,margin:'auto',padding:20}},React.createElement(VoteCard,{feed:{id:view.id,vote:{title:'模拟投票',options:[{id:'1',title:'选项甲'},{id:'2',title:'选项乙'}]}},namespace:view.namespace,loggedIn:false,onLogin:()=>{window.__voteLogin=true},toast:()=>{},onLink:url=>{window.__voteLink=url},onUser:(uid,title)=>{window.__voteUser={uid,title}}}))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_VOTE_COMMENTS_TEST_PORT || 5244), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1180, height: 860 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__voteCommentsMock = { calls: [], failure: '', holdId: '', releaseRead: null, holdVerify: false, releaseVerify: null, empty: false };
    window.coolapk = {
      verify: async () => { if (mock.holdVerify) await new Promise(resolve => { mock.releaseVerify = resolve; }); mock.failure = ''; return { ok: true, data: {} }; },
      call: async (operation, args) => {
        mock.calls.push({ operation, args: structuredClone(args) });
        if (operation !== 'voteComments') throw new Error('Unexpected mutation or non-vote operation: ' + operation);
        if (mock.holdId === args.id) await new Promise(resolve => { mock.releaseRead = resolve; });
        if (mock.failure === 'verify') return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟投票讨论验证', verificationId: 'synthetic-vote-discussion-verification' } };
        if (mock.failure === 'network' && args.page === 2) return { ok: false, error: { code: 'NETWORK', message: '模拟讨论翻页失败' } };
        const page = args.page || 1;
        const data = mock.empty ? [] : page === 1 ? [
          { id: '901', entityType: 'feedReply', feedid: args.id, uid: '2002', username: '模拟讨论者', message: '投票' + args.id + '的第一条讨论' },
          { id: '902', entityType: 'unknownVoteRecord', message: '未知结构的讨论正文' },
        ] : [{ id: '903', message: '投票' + args.id + '的第二页讨论' }];
        return { ok: true, data: { data, firstItem: '901', lastItem: page === 1 ? '902' : '903', hasMore: !mock.empty && page === 1 } };
      },
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/vote-comments-harness.html');
  const discussion = page.getByRole('dialog', { name: '投票讨论', exact: true });
  const open = () => page.getByRole('button', { name: '投票讨论', exact: true }).click();
  await record('existing poll opens its dedicated discussion only on explicit click', async () => {
    await page.getByRole('button', { name: '投票讨论', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__voteCommentsMock.calls.length), 0);
    await open(); await discussion.getByText('投票42的第一条讨论', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__voteCommentsMock.calls[0]), { operation: 'voteComments', args: { id: '42' } });
    await discussion.getByRole('button', { name: '模拟讨论者', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__voteUser), { uid: '2002', title: '模拟讨论者' });
    await discussion.getByRole('button', { name: '查看对应评论', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__voteLink), 'https://www.coolapk.com/feed/42?rid=901');
  });
  await record('unknown discussion records remain read-only and are not assigned feed or author permissions', async () => {
    const unknown = discussion.locator('[data-vote-row-id="902"]'); await unknown.getByText('未知结构的讨论正文', { exact: true }).waitFor();
    assert.equal(await unknown.getByRole('button').count(), 0);
    assert.equal(await discussion.getByRole('button', { name: /点赞|删除|编辑|发送/ }).count(), 0);
  });
  await record('pagination failure retains loaded discussions and repeats the failed request unchanged', async () => {
    await page.evaluate(() => { window.__voteCommentsMock.failure = 'network'; });
    await discussion.getByRole('button', { name: '加载更多', exact: true }).click(); await discussion.getByText('模拟讨论翻页失败', { exact: true }).waitFor();
    assert.equal(await discussion.getByText('投票42的第一条讨论', { exact: true }).count(), 1);
    await page.evaluate(() => { window.__voteCommentsMock.failure = ''; }); await discussion.getByRole('button', { name: '重试', exact: true }).click();
    await discussion.getByText('投票42的第二页讨论', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__voteCommentsMock.calls.filter(call => call.args.page === 2));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  });
  await record('closing or switching poll hides old rows and suppresses its late result', async () => {
    await discussion.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => { window.__voteCommentsMock.holdId = '43'; window.__voteCommentsNavigate({ id: '43', namespace: 'A' }); }); await open();
    await page.waitForFunction(() => !!window.__voteCommentsMock.releaseRead);
    await page.evaluate(() => window.__voteCommentsNavigate({ id: '44', namespace: 'B' })); await discussion.waitFor({ state: 'hidden' });
    await open(); await discussion.getByText('投票44的第一条讨论', { exact: true }).waitFor();
    await page.evaluate(() => { window.__voteCommentsMock.holdId = ''; window.__voteCommentsMock.releaseRead(); }); await page.waitForTimeout(80);
    assert.equal(await discussion.getByText('投票43的第一条讨论', { exact: true }).count(), 0);
    assert.equal(await discussion.getByText('投票42的第一条讨论', { exact: true }).count(), 0);
  });
  await record('verification replays the exact read; switching account suppresses old verification replay', async () => {
    await discussion.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => { window.__voteCommentsMock.failure = 'verify'; window.__voteCommentsNavigate({ id: '45', namespace: 'B' }); }); await open();
    await discussion.getByText('模拟投票讨论验证', { exact: true }).waitFor(); await discussion.getByRole('button', { name: '完成验证', exact: true }).click();
    await discussion.getByText('投票45的第一条讨论', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__voteCommentsMock.calls.filter(call => call.args.id === '45')); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    await discussion.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => { window.__voteCommentsMock.failure = 'verify'; window.__voteCommentsMock.holdVerify = true; window.__voteCommentsNavigate({ id: '46', namespace: 'B' }); }); await open();
    await discussion.getByText('模拟投票讨论验证', { exact: true }).waitFor(); await discussion.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => !!window.__voteCommentsMock.releaseVerify);
    await page.evaluate(() => window.__voteCommentsNavigate({ id: '47', namespace: 'C' })); await discussion.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__voteCommentsMock.releaseVerify()); await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__voteCommentsMock.calls.filter(call => call.args.id === '46').length), 1);
  });
  await record('empty vote discussions are explicit and no test issued a mutation', async () => {
    await page.evaluate(() => { window.__voteCommentsMock.empty = true; }); await open(); await discussion.getByText('暂无投票讨论', { exact: true }).waitFor();
    assert.equal(await discussion.getByRole('button', { name: '加载更多', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__voteCommentsMock.calls.every(call => call.operation === 'voteComments')), true);
  });
  assert.deepEqual(errors, []); await page.screenshot({ path: '.local/vote-comments-check/complete.png' });
  writeFileSync('research/vote-comment-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic renderer reads; outside requests blocked; no real votes or comments posted', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: '.local/vote-comments-check/failure.png' }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error;
} finally { await browser?.close(); await server.close(); }
