import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/compose-tools-check', { recursive: true });
writeFileSync('.local/compose-tools-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import Composer from'/src/Composer.tsx';import'/src/styles.css';
function Harness(){const[namespace,setNamespace]=useState('account-a'),[open,setOpen]=useState(true),[toast,setToast]=useState('');useEffect(()=>{window.__composeToolsSwitch=next=>{window.__composeToolsMock.namespace=next;setNamespace(next)};window.__composeToolsOpen=()=>setOpen(true)},[]);return React.createElement(React.Fragment,null,React.createElement('output',{'data-testid':'tools-toast'},toast),React.createElement('output',{'data-testid':'tools-namespace'},namespace),open&&React.createElement(Composer,{namespace,onClose:()=>setOpen(false),onDone:()=>setOpen(false),toast:setToast}))};createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
</script></body></html>`);
const port = Number(process.env.COOLAPK_COMPOSE_TOOLS_TEST_PORT || 5196), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(title, fn) { await fn(); checks.push(title); console.log('PASS', title); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1040 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__composeToolsMock = { namespace: 'account-a', calls: [], failures: {}, holds: {}, pending: [], holdVerify: false, releaseVerify: null };
    const ok = (data, extra = {}) => ({ ok: true, data: { data, ...extra } });
    const key = (op, args) => `${mock.namespace}:${op}:${args.query ?? args.type ?? ''}:${args.page || 1}`;
    window.coolapk = { verify: async () => { if (mock.holdVerify) { mock.holdVerify = false; await new Promise(resolve => { mock.releaseVerify = resolve; }); } return ok({}); }, call: async (op, args = {}) => {
      const requestKey = key(op, args), namespace = mock.namespace; mock.calls.push({ namespace, op, args: structuredClone(args) });
      if (mock.holds[requestKey]) { delete mock.holds[requestKey]; await new Promise(resolve => { mock.pending.push({ key: requestKey, release: resolve }); }); }
      if (mock.failures[requestKey]) { const code = mock.failures[requestKey]; return { ok: false, error: { code, message: `模拟读取失败 ${requestKey}`, ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-compose-tools' } : {}) } }; }
      if (op === 'action' || op === 'publishAdvanced') return ok({ id: '880' });
      if (op === 'accountUsers' || op === 'search') {
        if (args.query === '新查询') return ok([{ uid: '551', username: '新查询酷友', entityType: 'user' }], { hasMore: false });
        if (args.query === '旧查询') return ok([{ uid: '552', username: '旧查询酷友', entityType: 'user' }], { hasMore: false });
        const prefix = namespace === 'account-b' ? '乙号' : '';
        return Number(args.page) > 1 ? ok([{ uid: '503', username: prefix + '分页酷友', entityType: 'user' }, { uid: '501', username: prefix + '甲酷友', entityType: 'user' }], { firstItem: 'cursor-first', lastItem: 'cursor-page-2', hasMore: false }) : ok([{ userInfo: { uid: '501', username: prefix + '甲酷友' }, entityType: 'user', id: 'relation-1' }, { fuid: '502', fusername: prefix + '乙😀酷友', entityType: 'user', id: 'relation-2' }, { id: '999', title: '非酷友行' }], { firstItem: 'cursor-first', lastItem: 'cursor-page-1', hasMore: true });
      }
      if (op === 'searchPublishTopics') return Number(args.page) > 1 ? ok([{ id: '903', title: '分页话题', entityType: 'topic' }], { hasMore: false }) : ok([{ id: '901', title: args.query ? '搜索话题' : 'Windows体验', entityType: 'topic' }, { id: '902', tag: '#数码生活#', entityType: 'topic' }, { id: '904', title: '广告动态', entityType: 'feed' }], { hasMore: true });
      return ok([]);
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/compose-tools-harness.html');
  const dialog = () => page.getByRole('dialog', { name: '发布动态', exact: true });
  const editor = () => dialog().locator('#publish-message');
  const picker = kind => dialog().getByRole('region', { name: kind === 'mention' ? '@用户' : '添加话题', exact: true });
  async function calls() { return page.evaluate(() => window.__composeToolsMock.calls); }
  async function open(kind) {
    await dialog().getByRole('toolbar', { name: '正文工具' }).getByRole('button', { name: kind === 'mention' ? '@用户' : '添加话题', exact: true }).click(); await picker(kind).waitFor();
    // Mounting a visible picker precedes its passive effect's list commit.
    // Wait for that observable state before asserting recent-row counts.
    await picker(kind).locator('.compose-tool-results[aria-busy="false"]').waitFor({ state: 'attached' });
  }
  async function switchAccount(namespace) {
    await page.evaluate(namespace => window.__composeToolsSwitch(namespace), namespace);
    // An already visible old editor is not evidence of the new render. This
    // marker commits in the same React tree as the scoped ComposeModal.
    await page.waitForFunction(namespace => document.querySelector('[data-testid="tools-namespace"]')?.textContent === namespace, namespace);
  }
  async function closePicker(kind) { await picker(kind).getByRole('button', { name: '关闭正文工具' }).click(); await picker(kind).waitFor({ state: 'hidden' }); }
  async function search(kind, query) { await picker(kind).getByRole('textbox').fill(query); await picker(kind).getByRole('button', { name: '搜索', exact: true }).click(); }
  async function select(start, end = start) { await editor().evaluate((element, range) => { element.focus(); element.setSelectionRange(range[0], range[1]); element.dispatchEvent(new Event('select', { bubbles: true })); }, [start, end]); }
  async function release(key) { await page.evaluate(key => { const pending = window.__composeToolsMock.pending.find(item => item.key === key); if (!pending) throw new Error('Missing pending ' + key); pending.release(); }, key); }
  async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

  await record('phone @ and topic tools are labelled, preserve editor selection and focus search', async () => {
    await editor().fill('前😀选中后'); await select(3, 5); const start = (await calls()).length; await open('mention');
    assert.equal(await picker('mention').getByRole('textbox').evaluate(node => node === document.activeElement), true); assert.equal((await calls()).slice(start).length, 0);
    await picker('mention').getByRole('tab', { name: '关注', exact: true }).click(); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).check(); await picker('mention').getByLabel('选择酷友 乙😀酷友', { exact: true }).check();
    assert.equal(await picker('mention').getByText('非酷友行', { exact: true }).count(), 0); await picker('mention').getByRole('button', { name: '插入提醒（2）', exact: true }).click();
    assert.equal(await editor().inputValue(), '前😀@甲酷友 @乙😀酷友 后'); assert.deepEqual(await editor().evaluate(node => [node.selectionStart, node.selectionEnd, node === document.activeElement]), [15, 15, true]);
  });
  await record('empty topic query reads official popular topics and insertion preserves body and board', async () => {
    await select(3); const start = (await calls()).length; await open('topic'); await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).waitFor();
    assert.equal(await picker('topic').getByText('热门话题', { exact: true }).count(), 1); assert.equal(await picker('topic').getByText('广告动态', { exact: true }).count(), 0);
    const read = (await calls()).slice(start).find(item => item.op === 'searchPublishTopics'); assert.deepEqual(read.args, { query: '', page: 1, recentIds: '' });
    await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).click(); assert.equal(await editor().inputValue(), '前😀#Windows体验# @甲酷友 @乙😀酷友 后');
    assert.equal((await calls()).filter(item => ['action', 'publishAdvanced'].includes(item.op)).length, 0);
  });
  for (const code of ['NETWORK', 'VERIFY_REQUIRED']) await record(`user search ${code} retry repeats exact second-page cursors and keeps selection`, async () => {
    await open('mention'); await search('mention', '分页搜索'); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).waitFor(); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).check();
    await page.evaluate(code => { window.__composeToolsMock.failures['account-a:search:分页搜索:2'] = code; }, code); const start = (await calls()).length; await picker('mention').getByRole('button', { name: '加载更多酷友', exact: true }).click(); await picker('mention').getByRole('alert').waitFor();
    assert.equal(await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).isChecked(), true); await page.evaluate(() => { delete window.__composeToolsMock.failures['account-a:search:分页搜索:2']; });
    await picker('mention').getByRole('button', { name: code === 'NETWORK' ? '重试' : '完成验证', exact: true }).click(); await picker('mention').getByLabel('选择酷友 分页酷友', { exact: true }).waitFor();
    const reads = (await calls()).slice(start); assert.equal(reads.length, 2); assert.deepEqual(reads[0].args, { type: 'user', query: '分页搜索', page: 2, firstItem: 'cursor-first', lastItem: 'cursor-page-1' }); assert.deepEqual(reads[1].args, reads[0].args); assert.equal(await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).count(), 1); await closePicker('mention');
  });
  await record('topic network retry freezes page and recent ids while keeping loaded rows', async () => {
    await open('topic'); await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).waitFor(); await page.evaluate(() => { window.__composeToolsMock.failures['account-a:searchPublishTopics::2'] = 'NETWORK'; }); const start = (await calls()).length;
    await picker('topic').getByRole('button', { name: '加载更多话题', exact: true }).click(); await picker('topic').getByRole('alert').waitFor(); assert.equal(await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).count(), 1);
    await page.evaluate(() => { delete window.__composeToolsMock.failures['account-a:searchPublishTopics::2']; localStorage.setItem('coolapk:publish-topics:account-a', '["905"]'); }); await picker('topic').getByRole('button', { name: '重试', exact: true }).click(); await picker('topic').getByRole('button', { name: '分页话题', exact: true }).waitFor();
    const reads = (await calls()).slice(start); assert.deepEqual(reads.map(item => item.args), [{ query: '', page: 2, recentIds: '901' }, { query: '', page: 2, recentIds: '901' }]); await closePicker('topic');
  });
  await record('following and fans have named fixed account contracts and preserve page cursors', async () => {
    await open('mention'); const start = (await calls()).length; await picker('mention').getByRole('tab', { name: '粉丝', exact: true }).click(); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).waitFor(); await picker('mention').getByRole('button', { name: '加载更多酷友', exact: true }).click(); await picker('mention').getByLabel('选择酷友 分页酷友', { exact: true }).waitFor();
    const reads = (await calls()).slice(start); assert.deepEqual(reads.map(item => [item.op, item.args]), [['accountUsers', { type: 'fans', page: 1 }], ['accountUsers', { type: 'fans', page: 2, firstItem: 'cursor-first', lastItem: 'cursor-page-1' }]]); await closePicker('mention');
  });
  await record('changing source during verification never replays the old request', async () => {
    await open('mention'); await page.evaluate(() => { window.__composeToolsMock.failures['account-a:search:需验证:1'] = 'VERIFY_REQUIRED'; window.__composeToolsMock.holdVerify = true; }); await search('mention', '需验证'); await picker('mention').getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__composeToolsMock.releaseVerify);
    const start = (await calls()).length; await picker('mention').getByRole('button', { name: '清除搜索', exact: true }).click(); await picker('mention').getByRole('tab', { name: '粉丝', exact: true }).click(); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).waitFor(); await page.evaluate(() => window.__composeToolsMock.releaseVerify()); await settle();
    assert.equal((await calls()).slice(start).filter(item => item.op === 'search').length, 0); await closePicker('mention');
  });
  await record('late search response cannot replace a newer query', async () => {
    await open('mention'); await page.evaluate(() => { window.__composeToolsMock.holds['account-a:search:旧查询:1'] = true; }); await search('mention', '旧查询'); await page.waitForFunction(() => window.__composeToolsMock.pending.some(item => item.key === 'account-a:search:旧查询:1')); await search('mention', '新查询'); await picker('mention').getByLabel('选择酷友 新查询酷友', { exact: true }).waitFor();
    await release('account-a:search:旧查询:1'); await settle(); assert.equal(await picker('mention').getByLabel('选择酷友 旧查询酷友', { exact: true }).count(), 0); await closePicker('mention');
  });
  await record('closing during a lookup discards its late result and keeps the body untouched', async () => {
    const body = await editor().inputValue(); await open('mention'); await page.evaluate(() => { window.__composeToolsMock.holds['account-a:search:关闭查询:1'] = true; }); await search('mention', '关闭查询'); await page.waitForFunction(() => window.__composeToolsMock.pending.some(item => item.key === 'account-a:search:关闭查询:1')); await closePicker('mention');
    await release('account-a:search:关闭查询:1'); await settle(); assert.equal(await picker('mention').count(), 0); assert.equal(await editor().inputValue(), body);
  });
  await record('drafts retain inserted text and recent mentions stay scoped to the account', async () => {
    const body = await editor().inputValue(); await dialog().getByRole('button', { name: '保存文字草稿', exact: true }).click(); await switchAccount('account-b'); assert.equal(await editor().inputValue(), ''); await open('mention'); assert.equal(await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).count(), 0); await closePicker('mention');
    await switchAccount('account-a'); await dialog().getByRole('button', { name: '草稿（1）', exact: true }).click(); await dialog().locator('.composer-drafts>div>button:first-child').click(); assert.equal(await editor().inputValue(), body); assert.deepEqual(await editor().evaluate(node => [node.selectionStart, node.selectionEnd]), [body.length, body.length]); await open('mention'); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).waitFor(); assert.equal(await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).count(), 1); await closePicker('mention');
  });
  await record('same mounted composer account switch discards old pending lookup and selection', async () => {
    await open('mention'); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).check(); await page.evaluate(() => { window.__composeToolsMock.holds['account-a:accountUsers:follow:1'] = true; }); await picker('mention').getByRole('tab', { name: '关注', exact: true }).click(); await page.waitForFunction(() => window.__composeToolsMock.pending.some(item => item.key === 'account-a:accountUsers:follow:1'));
    await switchAccount('account-b'); await release('account-a:accountUsers:follow:1'); await settle(); assert.equal(await editor().inputValue(), ''); assert.equal(await picker('mention').count(), 0); await open('mention'); assert.equal(await picker('mention').getByRole('button', { name: /插入提醒/ }).isDisabled(), true); await closePicker('mention'); await switchAccount('account-a');
  });
  await record('account switch while verifying cannot read old arguments with the new identity', async () => {
    await open('mention'); await page.evaluate(() => { window.__composeToolsMock.failures['account-a:search:跨账号验证:1'] = 'VERIFY_REQUIRED'; window.__composeToolsMock.holdVerify = true; window.__composeToolsMock.releaseVerify = null; }); await search('mention', '跨账号验证'); await picker('mention').getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__composeToolsMock.releaseVerify);
    const start = (await calls()).length; await switchAccount('account-b'); await page.evaluate(() => window.__composeToolsMock.releaseVerify()); await settle(); assert.equal((await calls()).slice(start).length, 0); await switchAccount('account-a');
  });
  await record('oversize insert leaves original body and selection unchanged without a partial insertion', async () => {
    await editor().fill('字'.repeat(999)); await select(999); await open('topic'); await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).click(); assert.equal(await editor().inputValue(), '字'.repeat(999)); assert.equal(await page.getByTestId('tools-toast').innerText(), '插入后正文不能超过 1000 字'); assert.equal(await picker('topic').count(), 1); await closePicker('topic');
  });
  await record('publishing character count accepts astral text up to the same core limit', async () => {
    await editor().fill('😀'.repeat(996)); assert.equal(await editor().inputValue(), '😀'.repeat(996)); await select(1992); await open('mention'); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).check(); await picker('mention').getByRole('button', { name: '插入提醒（1）', exact: true }).click(); assert.equal(await editor().inputValue(), '😀'.repeat(996));
    await closePicker('mention'); await editor().fill('😀'.repeat(990)); await select(1980); await open('mention'); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).check(); await picker('mention').getByRole('button', { name: '插入提醒（1）', exact: true }).click(); assert.equal(await editor().inputValue(), '😀'.repeat(990) + '@甲酷友 '); assert.equal(await dialog().locator('.compose-footer>span').innerText(), '995 / 1000');
  });
  await record('Enter searches and Escape closes only the picker, returning focus and selection', async () => {
    await editor().fill('中😀文'); await select(3); await open('topic'); await picker('topic').getByRole('textbox').fill('键盘话题'); await picker('topic').getByRole('textbox').press('Enter'); await picker('topic').getByRole('button', { name: '搜索话题', exact: true }).waitFor(); await picker('topic').getByRole('textbox').press('Escape'); await picker('topic').waitFor({ state: 'hidden' });
    assert.equal(await dialog().count(), 1); assert.deepEqual(await editor().evaluate(node => [node.selectionStart, node.selectionEnd, node === document.activeElement]), [3, 3, true]);
  });
  await record('explicit publication alone sends inserted body through the existing feed contract', async () => {
    await open('topic'); await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).click(); const body = await editor().inputValue(); await open('mention'); await picker('mention').getByLabel('选择酷友 甲酷友', { exact: true }).check(); await picker('mention').getByRole('button', { name: '插入提醒（1）', exact: true }).click(); const inserted = await editor().inputValue(); assert.ok(inserted.includes(body.slice(0, -1)));
    assert.equal((await calls()).filter(item => ['action', 'publishAdvanced'].includes(item.op)).length, 0); await dialog().getByRole('button', { name: '发布', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
    const writes = (await calls()).filter(item => ['action', 'publishAdvanced'].includes(item.op)); assert.deepEqual(writes.map(item => [item.op, item.args]), [['action', { type: 'publish', id: undefined, message: inserted, pic: '' }]]);
  });
  await page.evaluate(() => window.__composeToolsOpen()); await editor().fill('分享今天的 Windows 使用体验'); await open('topic'); await picker('topic').getByRole('button', { name: 'Windows体验', exact: true }).waitFor(); await page.screenshot({ path: '.local/compose-tools-check/topic-picker.png', fullPage: true });
  assert.deepEqual(errors, []); writeFileSync('research/compose-tools-checks.json', JSON.stringify({ mode: 'synthetic Chromium checks of actual ComposeModal and ComposeTools; no real account requests', externalRequests: 'blocked', checks, errors, phoneEvidence: ['16.6.4 ordinary composer @ user and topic tools', 'user picker search; topic picker search and popular topic list'], limitations: ['Phone friends and recommended high-quality users are not established by follow/fans contracts', 'No unknown question/poll/report form fields added', 'Emoji tools and full advanced attachments remain separate gaps'] }, null, 2));
} finally { await browser?.close(); await server.close(); }
