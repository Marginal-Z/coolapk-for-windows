import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';

mkdirSync('.local/notification-check', { recursive: true });
writeFileSync('.local/notification-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Notifications}from'/src/Notifications.tsx';import App from'/src/App.tsx';import'/src/styles.css';
function Harness(){const[scope,setScope]=useState('A'),[app,setApp]=useState(false);useEffect(()=>{window.__noticeNavigate=setScope;window.__noticeShowApp=()=>setApp(true)},[]);return app?React.createElement(App):React.createElement('main',{'data-notice-scope':scope,style:{width:'min(100%,850px)',margin:'auto',padding:20}},React.createElement(Notifications,{key:scope,namespace:scope,loggedIn:scope!=='guest',revision:0,onLogin:()=>{window.__noticeLogin=true},onLink:url=>{window.__noticeLink=url},onUser:(uid,title)=>{window.__noticeUser={uid,title}},onOpen:entity=>{window.__noticeEntity=entity},onCountChanged:()=>{window.__noticeCountChanged=(window.__noticeCountChanged||0)+1}}))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_NOTIFICATION_TEST_PORT || 5243), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(defaultSettings => {
    const mock = window.__noticeMock = { namespace: 'A', calls: [], failure: '', moreFailure: false, holdType: '', releaseList: null, holdVerify: false, releaseVerify: null, verified: false };
    window.coolapk = {
      teenager: async operation => operation === 'info' ? { ok: true, data: { enabled: false, blocked: false, reason: null, usedMilliseconds: 0, remainingMilliseconds: 2400000, limitMilliseconds: 2400000, day: '2026-10-04', lockedUntil: null } } : { ok: false, error: { code: 'TEST_UNSUPPORTED', message: '该测试仅模拟关闭的青少年模式' } },
      onTeenager: () => () => {},
      accounts: async () => ({ ok: true, data: { accounts: [{ uid: '123456', username: '模拟账号' }], current: { uid: '123456', username: '模拟账号' } } }),
      onAccount: () => () => {}, onCommand: () => () => {},
      verify: async () => { if (mock.holdVerify) await new Promise(resolve => { mock.releaseVerify = resolve; }); mock.verified = true; return { ok: true, data: {} }; },
      call: async (operation, args) => {
        const scope = mock.namespace, type = args.type || 'list', page = args.page || 1;
        mock.calls.push({ operation, args: structuredClone(args), scope });
        const result = data => ({ ok: true, data });
        if (operation === 'accountSettings') return result({ data: { values: { ...defaultSettings }, present: Object.keys(defaultSettings), guardExpiresAt: null, replyLocked: false } });
        if (operation === 'notificationCount') return result({ data: { badge_v18: 12, message: 2, commentme: 2, atme: 3, atcommentme: 1, feedlike: 3, contacts_follow: 1 } });
        if (operation === 'clearNotificationCount') {
          if (mock.failure === 'clear-verify' && !mock.verified) return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟通知验证', verificationId: 'synthetic-notification-verification' } };
          return result({ data: {} });
        }
        if (operation === 'notifications') {
          if (mock.holdType === type) await new Promise(resolve => { mock.releaseList = resolve; });
          if (mock.failure === type || mock.moreFailure && page === 2) return { ok: false, error: { code: 'NETWORK', message: '模拟通知读取失败' } };
          let rows;
          if (type === 'feedLikeList') rows = [{ id: '9009', uid: '1001', username: '原作者', likeUid: '2002', likeUsername: scope + '点赞人', feedTypeName: '动态', feedId: '3003', feedInfo: { entityType: 'feed', id: '3003', message: scope + '原动态正文' } }];
          else if (type === 'contactsFollowList') rows = [{ id: '9010', fromuid: '2003', fromusername: scope + '新粉丝', note: '关注了你', targetRow: { entityType: 'user', uid: '2003', username: scope + '新粉丝' } }];
          else rows = [{ id: String(9000 + page), fromuid: '2004', fromusername: scope + '回复人', note: '<a href="https://www.coolapk.com/feed/3003?rid=4004">回复了你</a>', message: scope + '-' + type + '-第' + page + '页正文', isnew: 1, feedInfo: { entityType: 'feed', id: '3003', message_title: '原动态标题' } }];
          return result({ data: rows, hasMore: type === 'list' && page === 1, firstItem: '9001', lastItem: String(9000 + page) });
        }
        return result({ data: [], hasMore: false });
      },
    };
  }, DEFAULT_ACCOUNT_SETTINGS);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/notification-harness.html');
  const center = page.getByRole('region', { name: '通知中心', exact: true });
  const tab = name => center.getByRole('tab', { name: new RegExp('^' + name) });
  const calls = operation => page.evaluate(operation => window.__noticeMock.calls.filter(call => call.operation === operation), operation);
  await record('dedicated center renders all five categories, authoritative counts and original-feed preview', async () => {
    await center.getByText('A-list-第1页正文', { exact: true }).waitFor();
    assert.equal(await center.getByRole('tab').count(), 5);
    assert.equal(await center.getByText('10 条社区未读', { exact: true }).count(), 1);
    assert.equal(await center.getByText('原动态标题', { exact: true }).count(), 2);
    await center.getByRole('button', { name: /原动态.*查看对应评论/ }).click();
    assert.deepEqual(await page.evaluate(() => window.__noticeEntity), { id: '3003', entityType: 'feed', __replyId: '4004' });
  });
  await record('liked-feed author is replaced by the actual liking actor and its exact profile UID', async () => {
    await tab('收到的赞').click(); await center.getByText('A点赞人', { exact: true }).waitFor();
    assert.equal(await center.getByText('原作者', { exact: true }).count(), 0);
    await center.getByRole('button', { name: 'A点赞人', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__noticeUser), { uid: '2002', title: 'A点赞人' });
  });
  await record('late old-category rows cannot replace a newly selected category', async () => {
    await page.evaluate(() => { window.__noticeMock.holdType = 'atMeList'; }); await tab('@我的').click();
    await page.waitForFunction(() => !!window.__noticeMock.releaseList);
    await tab('新关注').click(); await center.getByText('A新粉丝', { exact: true }).waitFor();
    await page.evaluate(() => { window.__noticeMock.holdType = ''; window.__noticeMock.releaseList(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await center.getByText('A-atMeList-第1页正文', { exact: true }).count(), 0);
    await center.getByRole('button', { name: '查看A新粉丝', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__noticeEntity), { entityType: 'user', uid: '2003', username: 'A新粉丝' });
  });
  await record('failed second page keeps loaded rows and retries identical category and cursors', async () => {
    await tab('评论与回复').click(); await center.getByText('A-list-第1页正文', { exact: true }).waitFor();
    await page.evaluate(() => { window.__noticeMock.moreFailure = true; });
    await center.getByRole('button', { name: '加载更多', exact: true }).click();
    await center.getByRole('alert').getByText('模拟通知读取失败').waitFor();
    assert.equal(await center.getByText('A-list-第1页正文', { exact: true }).count(), 1);
    await page.evaluate(() => { window.__noticeMock.moreFailure = false; }); await center.getByRole('button', { name: '重试', exact: true }).click();
    await center.getByText('A-list-第2页正文', { exact: true }).waitFor();
    const requests = (await calls('notifications')).filter(call => call.args.page === 2);
    assert.equal(requests.length, 2); assert.deepEqual(requests[0].args, requests[1].args);
    assert.deepEqual(requests[0].args, { type: 'list', page: 2, firstItem: '9001', lastItem: '9001' });
  });
  await record('explicit clear uses community feed scope and never clears private messages', async () => {
    await center.getByRole('button', { name: '清除社区未读', exact: true }).click();
    await page.waitForFunction(() => window.__noticeCountChanged === 1);
    assert.deepEqual((await calls('clearNotificationCount')).map(call => call.args), [{ type: 'feed' }]);
  });
  await record('a verification completion retries the exact clear while an old account completion cannot replay', async () => {
    await page.evaluate(() => { window.__noticeMock.failure = 'clear-verify'; });
    await center.getByRole('button', { name: '清除社区未读', exact: true }).click(); await center.getByText('模拟通知验证', { exact: true }).waitFor();
    await center.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => window.__noticeCountChanged === 2);
    let requests = await calls('clearNotificationCount'); assert.deepEqual(requests.at(-2).args, requests.at(-1).args);
    await page.evaluate(() => { window.__noticeMock.verified = false; window.__noticeMock.holdVerify = true; });
    await center.getByRole('button', { name: '清除社区未读', exact: true }).click(); await center.getByText('模拟通知验证', { exact: true }).waitFor();
    await center.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__noticeMock.releaseVerify);
    const count = (await calls('clearNotificationCount')).length;
    await page.evaluate(() => { window.__noticeMock.namespace = 'B'; window.__noticeNavigate('B'); });
    await center.getByText('B-list-第1页正文', { exact: true }).waitFor();
    await page.evaluate(() => { window.__noticeMock.releaseVerify(); }); await page.waitForTimeout(80);
    assert.equal((await calls('clearNotificationCount')).length, count);
    assert.equal(await center.getByText('A-list-第1页正文', { exact: true }).count(), 0);
  });
  await record('guest center offers login and issues no account requests', async () => {
    const count = (await calls('notifications')).length;
    await page.evaluate(() => { window.__noticeMock.namespace = 'guest'; window.__noticeNavigate('guest'); });
    await page.getByText('登录后查看通知', { exact: true }).waitFor(); await page.getByRole('button', { name: '登录酷安', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__noticeLogin), true); assert.equal((await calls('notifications')).length, count);
  });
  await record('the actual app navigation mounts the dedicated notification center', async () => {
    await page.evaluate(() => { window.__noticeMock.namespace = 'A'; window.__noticeShowApp(); });
    await page.getByRole('navigation', { name: '个人导航' }).getByRole('button', { name: '通知', exact: true }).click();
    await center.getByText('A-list-第1页正文', { exact: true }).waitFor();
    assert.equal(await center.getByRole('tab').count(), 5);
  });
  await record('clearing all including private messages requires the explicitly named all-scope action', async () => {
    await center.getByRole('button', { name: '全部标记已读（含私信）', exact: true }).click();
    await page.waitForFunction(() => window.__noticeMock.calls.some(call => call.operation === 'clearNotificationCount' && call.args.type === 'all'));
    assert.deepEqual((await calls('clearNotificationCount')).at(-1).args, { type: 'all' });
  });
  assert.deepEqual(errors, []); await page.screenshot({ path: '.local/notification-check/complete.png', fullPage: true });
  writeFileSync('research/notification-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic renderer and App navigation; external requests blocked; no actual account writes', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: '.local/notification-check/failure.png' }); console.log('FAILURE_STATE', await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await server.close(); }
