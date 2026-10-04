import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';
const output = '.local/account-settings-check', port = Number(process.env.COOLAPK_ACCOUNT_SETTINGS_TEST_PORT || 5211), origin = `http://127.0.0.1:${port}`, checks = [], errors = [];
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><style>html,body{background:var(--bg);color:var(--text)}</style><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountSettings}from'/src/AccountSettings';import'/src/styles.css';function Harness(){const[owner,setOwner]=useState('42'),[page,setPage]=useState('privacy'),[loggedIn,setLoggedIn]=useState(false),[visible,setVisible]=useState(true);window.__accountOwner=owner;window.__setOwner=setOwner;window.__setPage=setPage;window.__setLoggedIn=setLoggedIn;window.__setVisible=setVisible;return <main style={{padding:20,maxWidth:820,margin:'auto'}}>{visible&&<AccountSettings namespace={owner} page={page} loggedIn={loggedIn} onLogin={()=>setLoggedIn(true)} onChanged={()=>window.__accountChanges++}/>}</main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser;
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1050, height: 850 } });
  await context.addInitScript(defaults => {
    window.__accountCalls = []; window.__accountChanges = 0; window.__accountHold = false; window.__accountPending = []; window.__accountFailure = null; window.__commitThenFail = false; window.__verifyHold = false; window.__verifyPending = []; window.__verifyCalls = [];
    const profiles = window.__profiles = { '42': { ...defaults }, '43': { ...defaults, receive_message: '1', subscribe_special_follow_feed_notify: true } };
    window.coolapk = {
      verify: async id => { window.__verifyCalls.push(id); if (window.__verifyHold) { window.__verifyHold = false; await new Promise(resolve => window.__verifyPending.push(resolve)); } return { ok: true, data: {} }; },
      call: async (operation, args = {}) => {
        const owner = window.__accountOwner; window.__accountCalls.push({ owner, operation, args: structuredClone(args) });
        if (window.__accountFailure) { const error = window.__accountFailure; if ((window.__accountFailureTimes || 1) <= 1) { window.__accountFailure = null; window.__accountFailureTimes = 0; } else window.__accountFailureTimes--; return { ok: false, error }; }
        if (operation === 'accountSettingsUpdate') { Object.assign(profiles[owner], args.patch); if (args.patch.net_abuse_guard) profiles[owner].net_abuse_guard_timestamp = Math.floor(Date.now() / 1000) + 604800; }
        if (window.__commitThenFail) { window.__commitThenFail = false; return { ok: false, error: { code: 'SETTINGS_UNCONFIRMED', message: '模拟设置提交结果尚未确认，请重新加载后核对' } }; }
        const snapshot = { values: Object.fromEntries(Object.entries(profiles[owner]).filter(([key]) => key !== 'net_abuse_guard_timestamp')), present: Object.keys(profiles[owner]), guardExpiresAt: profiles[owner].net_abuse_guard_timestamp || null, replyLocked: profiles[owner].feed_disallow_reply === '-1' };
        const result = { ok: true, data: { data: snapshot } };
        if (window.__accountHold) { window.__accountHold = false; return new Promise(resolve => window.__accountPending.push(() => resolve(result))); }
        return result;
      },
    };
  }, DEFAULT_ACCOUNT_SETTINGS);
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/${output}/fixture.html`);
  const ready = async () => page.waitForFunction(() => !!document.querySelector('[aria-label="隐私设置"],[aria-label="订阅消息提醒"]') && !document.querySelector('[aria-busy="true"]'));
  const switchPage = async kind => { await page.evaluate(value => window.__setPage(value), kind); await ready(); };
  const writeCount = async () => page.evaluate(() => window.__accountCalls.filter(call => call.operation === 'accountSettingsUpdate').length);
  await record('guest settings perform no account reads; login loads the current server profile', async () => {
    assert.equal(await page.evaluate(() => window.__accountCalls.length), 0); await page.getByRole('button', { name: '登录酷安', exact: true }).click(); await ready();
    assert.equal(await page.getByRole('switch', { name: '一键防护', exact: true }).isChecked(), false); assert.equal(await page.getByRole('switch').count(), 6);
    assert.equal(await page.getByLabel('接受私信的范围', { exact: true }).inputValue(), '0');
  });
  await record('the privacy selectors use the recovered official order and save the exact single intended key', async () => {
    assert.deepEqual(await page.getByLabel('动态回复控制', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['0', '2', '3', '1']);
    assert.deepEqual(await page.getByLabel('接收@消息', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['0', '1', '-1']);
    assert.deepEqual(await page.getByLabel('接受私信的范围', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['0', '1', '-1']);
    assert.deepEqual(await page.getByLabel('动态公开时间范围', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['0', '1']);
    await page.getByLabel('接受私信的范围', { exact: true }).selectOption('-1'); await ready();
    assert.deepEqual(await page.evaluate(() => window.__accountCalls.filter(call => call.operation === 'accountSettingsUpdate').at(-1).args), { patch: { receive_message: '-1' } });
    assert.equal(await page.getByLabel('接受私信的范围', { exact: true }).inputValue(), '-1'); await page.getByRole('status').filter({ hasText: '已保存并核对账号设置' }).waitFor();
  });
  await record('changing reply restrictions requires confirmation and Escape cancels without any write', async () => {
    const before = await writeCount(); await page.getByLabel('动态回复控制', { exact: true }).selectOption('2');
    const dialog = page.getByRole('dialog', { name: '动态回复控制', exact: true }); await dialog.waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await writeCount(), before); assert.equal(await page.getByLabel('动态回复控制', { exact: true }).inputValue(), '0');
    await page.getByLabel('动态回复控制', { exact: true }).selectOption('3'); await page.getByRole('dialog').getByRole('button', { name: '确定设置', exact: true }).click(); await ready();
    assert.equal(await page.getByLabel('动态回复控制', { exact: true }).inputValue(), '3');
  });
  await record('one-key protection displays its real restrictions; enabling and disabling require the official warnings', async () => {
    const before = await writeCount(); await page.getByRole('switch', { name: '一键防护', exact: true }).click();
    await page.getByRole('dialog').getByText(/相隔2小时/).waitFor(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await writeCount(), before);
    await page.getByRole('switch', { name: '一键防护', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确定开启', exact: true }).click(); await ready();
    assert.equal(await page.getByRole('switch', { name: '一键防护', exact: true }).isChecked(), true);
    for (const label of ['接收@消息', '动态回复控制', '接受私信的范围']) assert.equal(await page.getByLabel(label, { exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__accountCalls.filter(call => call.operation === 'accountSettingsUpdate').at(-1).args), { patch: { net_abuse_guard: true } });
    await page.getByText(/防护到期时间/).waitFor();
    await page.getByRole('switch', { name: '一键防护', exact: true }).click(); await page.getByRole('dialog').getByText(/下次开启需等待2小时/).waitFor(); await page.getByRole('dialog').getByRole('button', { name: '确定关闭', exact: true }).click(); await ready();
    assert.equal(await page.getByLabel('接收@消息', { exact: true }).isDisabled(), false);
  });
  await record('history clearing must be explicitly confirmed; cancel retains the observed account state', async () => {
    const before = await writeCount(); await page.getByRole('switch', { name: '开启浏览历史记录', exact: true }).click(); await page.getByRole('dialog').getByText(/清空已有的浏览历史/).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await writeCount(), before); assert.equal(await page.getByRole('switch', { name: '开启浏览历史记录', exact: true }).isChecked(), true);
    await page.getByRole('switch', { name: '开启我的常去记录', exact: true }).click(); await page.getByRole('dialog').getByText(/清空已有的常去/).waitFor(); await page.getByRole('dialog').getByRole('button', { name: '确定关闭', exact: true }).click(); await ready();
    assert.equal(await page.getByRole('switch', { name: '开启我的常去记录', exact: true }).isChecked(), false);
  });
  await record('the server-only reply restriction is displayed but never offered as an editable value', async () => {
    await page.evaluate(() => { window.__profiles['42'].feed_disallow_reply = '-1'; }); await page.getByRole('button', { name: '刷新账号设置', exact: true }).click(); await ready();
    assert.equal(await page.getByLabel('动态回复控制', { exact: true }).inputValue(), '-1'); assert.equal(await page.getByLabel('动态回复控制', { exact: true }).isDisabled(), true); await page.getByText('当前账号的回复权限受限', { exact: true }).waitFor();
    await page.evaluate(() => { window.__profiles['42'].feed_disallow_reply = '0'; });
  });
  await record('all ten recovered notification subscriptions show real defaults and save account subscription state', async () => {
    await switchPage('notifications'); assert.equal(await page.getByRole('switch').count(), 10);
    assert.equal(await page.getByRole('switch', { name: '订阅特别关注通知', exact: true }).isChecked(), false); assert.equal(await page.getByRole('switch', { name: '忽略点赞数量', exact: true }).isChecked(), false);
    for (const label of ['订阅消息提醒', '订阅回复通知', '点赞通知', '关注通知', '@通知', '关注收藏单更新通知', '未读回复较多提醒', '通知栏投票提醒']) assert.equal(await page.getByRole('switch', { name: label, exact: true }).isChecked(), true);
    await page.getByRole('switch', { name: '订阅回复通知', exact: true }).click(); await ready(); assert.equal(await page.getByRole('switch', { name: '订阅回复通知', exact: true }).isChecked(), false);
    assert.deepEqual(await page.evaluate(() => window.__accountCalls.filter(call => call.operation === 'accountSettingsUpdate').at(-1).args), { patch: { subscribe_reply_notify: false } });
    await page.getByText(/Windows 后台推送接收仍在开发中/).waitFor();
  });
  await record('a failed save cannot show optimistic success; explicit retry retains the exact intended key and value', async () => {
    await page.evaluate(() => { window.__accountFailure = { code: 'API_ERROR', message: '模拟云端拒绝保存' }; });
    await page.getByRole('switch', { name: '点赞通知', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '模拟云端拒绝保存' }).waitFor();
    assert.equal(await page.getByRole('switch', { name: '点赞通知', exact: true }).isChecked(), true); assert.equal(await page.getByRole('switch', { name: '关注通知', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '重试保存', exact: true }).click(); await ready(); assert.equal(await page.getByRole('switch', { name: '点赞通知', exact: true }).isChecked(), false);
    assert.deepEqual(await page.evaluate(() => window.__accountCalls.filter(call => call.operation === 'accountSettingsUpdate').slice(-2).map(call => call.args)), [{ patch: { receive_like_notify: false } }, { patch: { receive_like_notify: false } }]);
  });
  await record('an unconfirmed write exposes a read-only reload and never silently resends the change', async () => {
    await page.evaluate(() => { window.__commitThenFail = true; }); const before = await writeCount(); await page.getByRole('switch', { name: '关注通知', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '模拟设置提交结果尚未确认' }).waitFor(); assert.equal(await page.getByRole('switch', { name: '关注通知', exact: true }).isChecked(), true); assert.equal(await page.getByRole('button', { name: '重试保存', exact: true }).count(), 0);
    await page.getByRole('button', { name: '重新加载设置', exact: true }).click(); await ready(); assert.equal(await page.getByRole('switch', { name: '关注通知', exact: true }).isChecked(), false); assert.equal(await writeCount(), before + 1); assert.equal(await page.getByRole('status').filter({ hasText: '已保存并核对账号设置' }).count(), 0);
  });
  await record('verification resumes the immutable original subscription intent after an explicit completion', async () => {
    await page.evaluate(() => { window.__accountFailure = { code: 'VERIFY_REQUIRED', message: '模拟官方验证', verificationId: 'synthetic-verification' }; });
    await page.getByRole('switch', { name: '@通知', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await ready();
    assert.equal(await page.getByRole('switch', { name: '@通知', exact: true }).isChecked(), false);
    assert.deepEqual(await page.evaluate(() => window.__accountCalls.filter(call => call.operation === 'accountSettingsUpdate').slice(-2).map(call => call.args)), [{ patch: { receive_at_notify: false } }, { patch: { receive_at_notify: false } }]);
  });
  await record('held writes are single flight and late results cannot change a newly selected account or show a success status', async () => {
    await page.evaluate(() => { window.__accountHold = true; }); await page.getByRole('switch', { name: '订阅特别关注通知', exact: true }).click(); await page.waitForFunction(() => window.__accountPending.length === 1);
    assert.equal(await page.getByRole('switch', { name: '订阅回复通知', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.__setOwner('43')); await ready(); assert.equal(await page.getByRole('switch', { name: '订阅回复通知', exact: true }).isChecked(), true); assert.equal(await page.getByRole('switch', { name: '订阅特别关注通知', exact: true }).isChecked(), true);
    const changed = await page.evaluate(() => window.__accountChanges); await page.evaluate(() => window.__accountPending.shift()());
    await page.waitForFunction(() => !window.__accountPending.length); assert.equal(await page.evaluate(() => window.__accountChanges), changed); assert.equal(await page.getByRole('status').filter({ hasText: '已保存并核对账号设置' }).count(), 0);
  });
  await record('account switching while official verification is held cancels its old retry', async () => {
    await page.evaluate(() => { window.__accountFailure = { code: 'VERIFY_REQUIRED', message: '模拟待完成官方验证', verificationId: 'old-account-verification' }; window.__verifyHold = true; });
    await page.getByRole('switch', { name: '忽略点赞数量', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__verifyPending.length === 1);
    const before = await writeCount(); await page.evaluate(() => window.__setOwner('42')); await ready(); await page.evaluate(() => window.__verifyPending.shift()()); await page.waitForFunction(() => !window.__verifyPending.length);
    assert.equal(await writeCount(), before); assert.equal(await page.getByRole('switch', { name: '忽略点赞数量', exact: true }).isChecked(), false);
  });
  await record('unmounting during a held request invalidates its completion callback and status', async () => {
    await page.evaluate(() => { window.__accountHold = true; }); await page.getByRole('switch', { name: '未读回复较多提醒', exact: true }).click(); await page.waitForFunction(() => window.__accountPending.length === 1);
    const changed = await page.evaluate(() => window.__accountChanges); await page.evaluate(() => window.__setVisible(false)); await page.locator('.account-settings').waitFor({ state: 'hidden' }); await page.evaluate(() => window.__accountPending.shift()());
    await page.waitForFunction(() => !window.__accountPending.length); assert.equal(await page.evaluate(() => window.__accountChanges), changed);
    await page.evaluate(() => window.__setVisible(true)); await ready(); assert.equal(await page.getByRole('status').filter({ hasText: '已保存并核对账号设置' }).count(), 0);
  });
  await record('failed loading reveals retry without invented controls; a narrow dark window remains keyboard accessible', async () => {
    await page.evaluate(() => { window.__accountFailure = { code: 'API_ERROR', message: '模拟账号设置读取失败' }; window.__accountFailureTimes = 2; window.__setPage('privacy'); }); await page.getByRole('alert').filter({ hasText: '模拟账号设置读取失败' }).waitFor();
    assert.equal(await page.getByRole('switch').count(), 0); await page.getByRole('button', { name: '重新加载设置', exact: true }).click(); await ready();
    await page.setViewportSize({ width: 390, height: 740 }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.getByLabel('接收@消息', { exact: true }).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await ready();
    await page.getByLabel('动态公开时间范围', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/privacy.png`, fullPage: true }); await switchPage('notifications'); await page.getByRole('switch', { name: '通知栏投票提醒', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/notifications.png`, fullPage: true }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/account-settings-ui-checks.json', JSON.stringify({ checkedAt: '2026-10-04', checks, errors, result: 'passed', mode: 'isolated synthetic account profiles; held IPC and verification responses; all non-local HTTP requests aborted; no real account settings or mobile notification service writes' }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', groups: checks.length })); await context.close();
} finally { await browser?.close(); await server.close(); }
