import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/user-discovery-check', { recursive: true });
writeFileSync('.local/user-discovery-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{UserDiscovery}from'/src/UserDiscovery.tsx';import'/src/styles.css';
function Harness(){const[state,setState]=useState({uid:'77',type:'profile',namespace:'guest',loggedIn:false,revision:0});useEffect(()=>{window.__userNavigate=next=>setState(old=>({...old,...next}))},[]);return React.createElement(UserDiscovery,{...state,onLogin:()=>{window.__userLogin=(window.__userLogin||0)+1},openEntity:entity=>{window.__userOpened=entity},feedProps:{onUser:(uid,name)=>{window.__userAuthor={uid,name}},onLink:url=>{window.__userLink=url}}})}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_USER_DISCOVERY_PORT || 5196), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 880 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__userMock = { calls: [], failPage: false, hold: false, release: null, qrError: '', readError: null, holdVerify: false, releaseVerify: null, optional: true, heldRead: null, releaseRead: null };
    window.coolapk = { verify: async () => { if (mock.holdVerify) await new Promise(resolve => { mock.releaseVerify = resolve; }); mock.failPage = false; mock.qrError = ''; mock.readError = null; return { ok: true, data: {} }; }, call: async (operation, args) => {
      mock.calls.push({ operation, args: structuredClone(args) });
      if (args.uid === '77' && mock.hold) await new Promise(resolve => { mock.release = resolve; });
      if (mock.heldRead && args.uid === mock.heldRead.uid && operation.endsWith(mock.heldRead.operation) && (!mock.heldRead.tab || args.tab === mock.heldRead.tab)) await new Promise(resolve => { mock.releaseRead = resolve; });
      if (operation.includes('Profile')) return { ok: true, data: { data: { uid: args.uid, username: '模拟酷友' + args.uid, introduce: '<b>公开资料</b><script>window.__privateExecuted=true</script>', city: '模拟城市' } } };
      if (operation.endsWith('Space')) return { ok: true, data: { data: { uid: args.uid, ...(mock.optional ? { albumNum: 1, isDeveloper: 1, apkFollowNum: 2, discoveryNum: 1, goodsStoreStatus: 1 } : {}) } } };
      if (operation.endsWith('Qr')) return mock.qrError ? { ok: false, error: { code: mock.qrError, message: '模拟用户二维码失败', ...(mock.qrError === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-user-qr' } : {}) } } : { ok: true, data: { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=' } };
      if (mock.readError && operation.endsWith(mock.readError.operation) && (args.page || 1) === mock.readError.page && (!mock.readError.tab || mock.readError.tab === args.tab)) return { ok: false, error: { code: mock.readError.code, message: '模拟用户列表失败', ...(mock.readError.code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-user-list' } : {}) } };
      if (operation.endsWith('FollowNodes')) { const page = args.page || 1; return { ok: true, data: { data: [{ entityType: 'topic', id: page === 1 ? '41' : '43', tag: '圈子' + args.uid + '第' + page + '页', title: '圈子' + args.uid + '第' + page + '页' }, ...(page === 1 ? [{ entityType: 'unknownForum', id: '42', title: '未知圈子记录', url: '/page?url=/user/private' }] : [])], firstItem: 'node:first', lastItem: 'node:p' + page, hasMore: page === 1 } }; }
      if (operation.endsWith('Homepage')) { const page = args.page || 1; return { ok: true, data: { data: [{ entityType: 'collection', id: page === 1 ? '51' : '53', title: '主页' + args.uid + '第' + page + '页' }], firstItem: page === 1 ? '' : 'home:first', lastItem: page === 1 ? '' : 'home:p' + page, hasMore: page === 1 } }; }
      if (operation.endsWith('TabData')) { const page = args.page || 1; return { ok: true, data: { data: [{ entityType: 'apk', id: page === 1 ? '61' : '63', title: '内容' + args.uid + '-' + args.tab + '-' + (args.ratingTarget || '') + '第' + page + '页' }], firstItem: args.tab + ':first', lastItem: args.tab + ':p' + page, hasMore: page === 1 } }; }
      if (operation !== 'userAppRatings') throw new Error('Unexpected synthetic user operation: ' + operation);
      if (mock.failPage && args.page === 2) return { ok: false, error: { code: mock.failPage === 'verify' ? 'VERIFY_REQUIRED' : 'NETWORK', message: '模拟评分分页失败', ...(mock.failPage === 'verify' ? { verificationId: 'synthetic-rating-page2' } : {}) } };
      const id = args.page === 2 ? '8' : '7';
      return { ok: true, data: { data: [{ entityType: 'apk', id, title: '模拟评分应用' + id, appName: '模拟评分应用' + id, rating: 5 }], firstItem: 'apk_7', lastItem: 'apk_' + id, hasMore: args.page !== 2 } };
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/user-discovery-harness.html');
  await record('guest public profiles render escaped fields with the dedicated guest operation', async () => {
    await page.getByText('模拟酷友77', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__userMock.calls[0].operation), 'publicUserProfile');
    assert.equal(await page.evaluate(() => window.__privateExecuted), undefined);
    await page.getByText('所在地：', { exact: true }).waitFor();
  });
  await record('signed-in profile reads use the authenticated operation after account isolation', async () => {
    await page.evaluate(() => window.__userNavigate({ namespace: '42', loggedIn: true })); await page.getByText('模拟酷友77', { exact: true }).waitFor();
    await page.waitForFunction(() => window.__userMock.calls.some(call => call.operation === 'userProfile'));
  });
  await record('application ratings paginate with exact server cursors and preserve successful rows on failure', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'ratings' })); await page.getByText('模拟评分应用7', { exact: true }).waitFor();
    await page.evaluate(() => { window.__userMock.failPage = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟评分分页失败', { exact: true }).waitFor(); assert.ok(await page.getByText('模拟评分应用7', { exact: true }).isVisible());
    const request = await page.evaluate(() => window.__userMock.calls.filter(call => call.operation === 'userAppRatings').at(-1));
    assert.deepEqual(request.args, { uid: '77', page: 2, firstItem: 'apk_7', lastItem: 'apk_7' });
    await page.evaluate(() => { window.__userMock.failPage = false; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('模拟评分应用8', { exact: true }).waitFor();
    const retried = await page.evaluate(() => window.__userMock.calls.filter(call => call.operation === 'userAppRatings').at(-1)); assert.deepEqual(retried.args, request.args);
  });
  await record('page two verification retries the exact request and retains the earlier ratings', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'ratings', uid: '88' })); await page.getByText('模拟评分应用7', { exact: true }).waitFor();
    await page.evaluate(() => { window.__userMock.failPage = 'verify'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.getByText('模拟评分应用8', { exact: true }).waitFor(); assert.ok(await page.getByText('模拟评分应用7', { exact: true }).isVisible());
    const calls = await page.evaluate(() => window.__userMock.calls.filter(call => call.operation === 'userAppRatings' && call.args.uid === '88'));
    assert.equal(calls.filter(call => !call.args.page || call.args.page === 1).length, 1); assert.deepEqual(calls[1].args, calls[2].args); assert.equal(calls[2].args.page, 2);
  });
  await record('late profile results cannot replace a different user after navigation', async () => {
    await page.evaluate(() => { window.__userMock.hold = true; window.__userNavigate({ type: 'profile', uid: '77', namespace: '43' }); });
    await page.waitForFunction(() => !!window.__userMock.release);
    await page.evaluate(() => window.__userNavigate({ uid: '88' })); await page.getByText('模拟酷友88', { exact: true }).waitFor();
    await page.evaluate(() => window.__userMock.release()); await page.waitForFunction(() => document.body.innerText.includes('模拟酷友88'));
    assert.equal(await page.getByText('模拟酷友77', { exact: true }).count(), 0);
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const requests = suffix => page.evaluate(suffix => window.__userMock.calls.filter(call => call.operation.endsWith(suffix)), suffix);
  await page.evaluate(() => { window.__userMock.hold = false; });
  await record('profile exposes target-user QR and public entry points; the QR is fetched only after opening and closes with restored focus', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'profile', uid: '91', namespace: 'guest', loggedIn: false })); await page.getByText('模拟酷友91', { exact: true }).waitFor(); assert.equal((await requests('Qr')).length, 0);
    for (const name of ['用户二维码', '关注圈子', '查看主页', '公开内容']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1);
    await page.getByRole('button', { name: '用户二维码', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '用户二维码', exact: true }); await dialog.getByAltText('用户主页二维码').waitFor(); await page.waitForFunction(() => document.querySelector('.user-discovery-qr img')?.naturalWidth === 1);
    assert.deepEqual((await requests('Qr')).at(-1), { operation: 'publicUserQr', args: { uid: '91' } }); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await page.getByRole('button', { name: '用户二维码', exact: true }).evaluate(node => node === document.activeElement), true);
  });
  await record('QR network retry preserves its UID; server login requirements offer login without fabricating a QR', async () => {
    await page.evaluate(() => { window.__userMock.qrError = 'NETWORK'; window.__userNavigate({ uid: '92' }); }); await page.getByText('模拟酷友92', { exact: true }).waitFor(); await page.getByRole('button', { name: '用户二维码', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '用户二维码', exact: true }); await dialog.getByText('模拟用户二维码失败', { exact: true }).waitFor(); assert.equal(await dialog.getByAltText('用户主页二维码').count(), 0);
    await page.evaluate(() => { window.__userMock.qrError = ''; }); await dialog.getByRole('button', { name: '重试', exact: true }).click(); await dialog.getByAltText('用户主页二维码').waitFor(); const qr = (await requests('Qr')).filter(call => call.args.uid === '92'); assert.equal(qr.length, 2); assert.deepEqual(qr[0], qr[1]); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => { window.__userMock.qrError = 'LOGIN_REQUIRED'; window.__userNavigate({ uid: '93' }); }); await page.getByText('模拟酷友93', { exact: true }).waitFor(); await page.getByRole('button', { name: '用户二维码', exact: true }).click(); await dialog.getByRole('button', { name: '登录', exact: true }).click(); assert.equal(await page.evaluate(() => window.__userLogin), 1); assert.equal(await dialog.getByAltText('用户主页二维码').count(), 0); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('QR verification replays exact target parameters and a later account or UID suppresses the old replay', async () => {
    await page.evaluate(() => { window.__userMock.qrError = 'VERIFY_REQUIRED'; window.__userNavigate({ uid: '94', namespace: '42', loggedIn: true }); }); await page.getByText('模拟酷友94', { exact: true }).waitFor(); await page.getByRole('button', { name: '用户二维码', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '用户二维码', exact: true }); await dialog.getByRole('button', { name: '完成验证', exact: true }).click(); await dialog.getByAltText('用户主页二维码').waitFor(); const qr = (await requests('Qr')).filter(call => call.args.uid === '94'); assert.equal(qr.length, 2); assert.deepEqual(qr[0], qr[1]); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => { window.__userMock.qrError = 'VERIFY_REQUIRED'; window.__userMock.holdVerify = true; window.__userNavigate({ uid: '95' }); }); await page.getByText('模拟酷友95', { exact: true }).waitFor(); await page.getByRole('button', { name: '用户二维码', exact: true }).click(); await dialog.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__userMock.releaseVerify);
    await page.evaluate(() => window.__userNavigate({ uid: '96', namespace: '43' })); await page.getByText('模拟酷友96', { exact: true }).waitFor(); const count = (await requests('Qr')).length; await page.evaluate(() => { window.__userMock.releaseVerify(); window.__userMock.holdVerify = false; window.__userMock.releaseVerify = null; }); await settle(); assert.equal((await requests('Qr')).length, count); assert.equal(await dialog.count(), 0);
  });
  await record('other-user circle lists paginate with exact cursors, retain rows on network or verification errors and leave unknown records noninteractive', async () => {
    for (const [uid, code] of [['97', 'NETWORK'], ['98', 'VERIFY_REQUIRED']]) {
      await page.evaluate(uid => window.__userNavigate({ type: 'circles', uid }), uid); await page.getByText('圈子' + uid + '第1页', { exact: true }).waitFor(); const unknown = page.locator('.user-unknown-row').filter({ hasText: '未知圈子记录' }); assert.equal(await unknown.getByRole('button').count(), 0);
      await page.locator('.entity-card').filter({ has: page.getByText('圈子' + uid + '第1页', { exact: true }) }).click(); assert.equal(await page.evaluate(() => window.__userOpened.entityType), 'topic'); assert.equal(await page.evaluate(() => window.__userLink), undefined);
      await page.evaluate(code => { window.__userMock.readError = { operation: 'FollowNodes', page: 2, code }; }, code); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟用户列表失败', { exact: true }).waitFor(); assert.equal(await page.getByText('圈子' + uid + '第1页', { exact: true }).count(), 1);
      if (code === 'NETWORK') { await page.evaluate(() => { window.__userMock.readError = null; }); await page.getByRole('button', { name: '重试', exact: true }).click(); } else await page.getByRole('button', { name: '完成验证', exact: true }).click();
      await page.getByText('圈子' + uid + '第2页', { exact: true }).waitFor(); const rows = (await requests('FollowNodes')).filter(call => call.args.uid === uid); assert.deepEqual(rows.map(call => call.args.page || 1), [1, 2, 2]); assert.deepEqual(rows[1].args, { uid, page: 2, firstItem: 'node:first', lastItem: 'node:p1' }); assert.deepEqual(rows[1], rows[2]);
    }
  });
  await record('native homepage continuation uses page two with empty card cursors and keeps its cards on failed-page retry', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'home', uid: '99' })); await page.getByText('主页99第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.readError = { operation: 'Homepage', page: 2, code: 'NETWORK' }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟用户列表失败', { exact: true }).waitFor(); assert.equal(await page.getByText('主页99第1页', { exact: true }).count(), 1); await page.evaluate(() => { window.__userMock.readError = null; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('主页99第2页', { exact: true }).waitFor();
    const home = (await requests('Homepage')).filter(call => call.args.uid === '99'); assert.deepEqual(home.map(call => call.args.page || 1), [1, 2, 2]); assert.deepEqual(home[1].args, { uid: '99', page: 2, firstItem: '', lastItem: '' }); assert.deepEqual(home[1], home[2]); assert.equal(await page.getByText('主页99第1页', { exact: true }).count(), 1);
  });
  await record('public tabs expose only supported public categories and rating filters reset between categories', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'content', uid: '101' })); await page.getByText('内容101-feed-第1页', { exact: true }).waitFor(); await page.getByRole('tab', { name: '应用集', exact: true }).waitFor();
    for (const name of ['赞过', '回复', '黑名单', '回收站']) assert.equal(await page.getByRole('tab', { name, exact: true }).count(), 0);
    await page.getByRole('tab', { name: '评分', exact: true }).click(); await page.getByText('内容101-rating-all第1页', { exact: true }).waitFor(); await page.getByLabel('酷友评分对象', { exact: true }).selectOption('product'); await page.getByText('内容101-rating-product第1页', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '问答', exact: true }).click(); await page.getByText('内容101-qa-第1页', { exact: true }).waitFor(); await page.getByRole('tab', { name: '评分', exact: true }).click(); await page.getByText('内容101-rating-all第1页', { exact: true }).waitFor(); assert.equal(await page.getByLabel('酷友评分对象', { exact: true }).inputValue(), 'all');
    const product = (await requests('TabData')).find(call => call.args.ratingTarget === 'product'); assert.deepEqual(product.args, { uid: '101', tab: 'rating', ratingTarget: 'product' });
    await page.getByRole('tab', { name: '应用集', exact: true }).click(); await page.getByText('内容101-album-第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.optional = false; window.__userNavigate({ revision: 1 }); }); await page.getByRole('tab', { name: '应用集', exact: true }).waitFor({ state: 'hidden' }); await page.getByText('内容101-feed-第1页', { exact: true }).waitFor();
  });
  await record('content pagination repeats exact UID, category and opaque cursors after verification without restarting page one', async () => {
    await page.getByRole('tab', { name: '图文', exact: true }).click(); await page.getByText('内容101-article-第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.readError = { operation: 'TabData', tab: 'article', page: 2, code: 'VERIFY_REQUIRED' }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('内容101-article-第2页', { exact: true }).waitFor();
    const article = (await requests('TabData')).filter(call => call.args.uid === '101' && call.args.tab === 'article'); assert.deepEqual(article.map(call => call.args.page || 1), [1, 2, 2]); assert.deepEqual(article[1].args, { uid: '101', tab: 'article', page: 2, firstItem: 'article:first', lastItem: 'article:p1' }); assert.deepEqual(article[1], article[2]);
  });
  await record('a late category response and verification cannot replace or re-request a different user and account', async () => {
    await page.evaluate(() => { window.__userMock.heldRead = { operation: 'TabData', uid: '102', tab: 'feed' }; window.__userNavigate({ uid: '102' }); }); await page.waitForFunction(() => !!window.__userMock.releaseRead); await page.evaluate(() => window.__userNavigate({ uid: '103', namespace: '44' })); await page.getByText('内容103-feed-第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.heldRead = null; window.__userMock.releaseRead(); }); await settle(); assert.equal(await page.getByText('内容102-feed-第1页', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__userMock.readError = { operation: 'TabData', page: 2, code: 'VERIFY_REQUIRED' }; window.__userMock.holdVerify = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__userMock.releaseVerify); await page.getByRole('tab', { name: '问答', exact: true }).click(); await page.getByText('内容103-qa-第1页', { exact: true }).waitFor(); const before = (await requests('TabData')).length; await page.evaluate(() => { window.__userMock.releaseVerify(); window.__userMock.holdVerify = false; }); await settle(); assert.equal((await requests('TabData')).length, before);
  });
  await record('guest circle permission errors offer login, initial retry requests page one and invalid UID issues no RPC', async () => {
    await page.evaluate(() => { window.__userMock.readError = { operation: 'FollowNodes', page: 1, code: 'LOGIN_REQUIRED' }; window.__userNavigate({ type: 'circles', uid: '104', namespace: 'guest', loggedIn: false }); }); await page.getByRole('button', { name: '登录', exact: true }).click(); assert.equal(await page.evaluate(() => window.__userLogin), 2); assert.equal(await page.getByText('没有可见的关注圈子', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__userMock.readError = { operation: 'FollowNodes', page: 1, code: 'NETWORK' }; window.__userNavigate({ revision: 2 }); }); await page.getByRole('button', { name: '重试', exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.readError = null; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('圈子104第1页', { exact: true }).waitFor(); const circle = (await requests('FollowNodes')).filter(call => call.args.uid === '104'); assert.deepEqual(circle.map(call => call.args.page || 1), [1, 1, 1]); assert.ok(circle.every(call => call.operation === 'publicUserFollowNodes'));
    const count = await page.evaluate(() => window.__userMock.calls.length); await page.evaluate(() => window.__userNavigate({ uid: '../104' })); await page.getByText('酷友 UID 无效', { exact: true }).waitFor(); await settle(); assert.equal(await page.evaluate(() => window.__userMock.calls.length), count);
  });
  await record('a delayed QR image cannot reopen its modal after the selected user changes', async () => {
    await page.evaluate(() => { window.__userMock.heldRead = { operation: 'Qr', uid: '105' }; window.__userMock.releaseRead = null; window.__userNavigate({ type: 'profile', uid: '105' }); }); await page.getByText('模拟酷友105', { exact: true }).waitFor(); await page.getByRole('button', { name: '用户二维码', exact: true }).click(); await page.waitForFunction(() => !!window.__userMock.releaseRead);
    await page.evaluate(() => window.__userNavigate({ uid: '106' })); await page.getByText('模拟酷友106', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.heldRead = null; window.__userMock.releaseRead(); }); await settle(); assert.equal(await page.getByRole('dialog', { name: '用户二维码', exact: true }).count(), 0);
    await page.getByRole('button', { name: '用户二维码', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '用户二维码', exact: true }); await dialog.getByAltText('用户主页二维码').waitFor(); assert.deepEqual((await requests('Qr')).at(-1), { operation: 'publicUserQr', args: { uid: '106' } }); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('homepage verification repeats page two exactly and preserves the first-page home cards', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'home', uid: '107' })); await page.getByText('主页107第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.readError = { operation: 'Homepage', page: 2, code: 'VERIFY_REQUIRED' }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('主页107第2页', { exact: true }).waitFor();
    const home = (await requests('Homepage')).filter(call => call.args.uid === '107'); assert.deepEqual(home.map(call => call.args.page || 1), [1, 2, 2]); assert.deepEqual(home[1], home[2]); assert.equal(await page.getByText('主页107第1页', { exact: true }).count(), 1);
  });
  await record('guest public content retries a network-failed page with its original UID, tab and cursors', async () => {
    await page.evaluate(() => window.__userNavigate({ type: 'content', uid: '108' })); await page.getByText('内容108-feed-第1页', { exact: true }).waitFor(); await page.getByRole('tab', { name: '问答', exact: true }).click(); await page.getByText('内容108-qa-第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__userMock.readError = { operation: 'TabData', tab: 'qa', page: 2, code: 'NETWORK' }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟用户列表失败', { exact: true }).waitFor(); assert.equal(await page.getByText('内容108-qa-第1页', { exact: true }).count(), 1); await page.evaluate(() => { window.__userMock.readError = null; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('内容108-qa-第2页', { exact: true }).waitFor();
    const qa = (await requests('TabData')).filter(call => call.args.uid === '108' && call.args.tab === 'qa'); assert.deepEqual(qa.map(call => call.args.page || 1), [1, 2, 2]); assert.deepEqual(qa[1].args, { uid: '108', tab: 'qa', page: 2, firstItem: 'qa:first', lastItem: 'qa:p1' }); assert.deepEqual(qa[1], qa[2]); assert.ok(qa.every(call => call.operation === 'publicUserTabData'));
  });
  assert.deepEqual(errors, []); writeFileSync('research/user-discovery-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic renderer contract checks; no actual account writes', externalRequests: 'blocked', checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
