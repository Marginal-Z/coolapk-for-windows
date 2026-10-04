// Phone-guided layout; all account data is synthetic and external requests are blocked.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const directory = '.local/account-overview-check'; mkdirSync(directory, { recursive: true });
writeFileSync('.local/account-overview-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{AccountCenter}from'/src/AccountCenter.tsx';import'/src/styles.css';
function Harness(){const[state,setState]=useState({account:null,namespace:'guest',revision:0,theme:'light'});useEffect(()=>{window.__mineNavigate=next=>setState(old=>({...old,...next}));},[]);const event=kind=>()=>{window.__mineEvents.push(kind)};return React.createElement(AccountCenter,{...state,onLogin:event('login'),onOpenEntity:entity=>window.__mineEvents.push({entity}),onLink:url=>window.__mineEvents.push({url}),onFollowing:event('following'),onCollections:event('collections'),onToggleTheme:event('theme'),onSettings:event('settings'),onMessages:event('messages'),onUpdates:event('updates'),onScan:event('scan'),onMyHome:event('home'),onDrafts:event('drafts'),onDownloads:event('downloads'),onPhoneApps:event('phoneApps'),toast:event('toast')})}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_ACCOUNT_OVERVIEW_PORT || 5197), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__mineMock = { uid: '77', calls: [], omitLevel: false, cardError: false, pageError: false, hold: '', release: null };
    window.__mineEvents = [];
    window.coolapk = { call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: structuredClone(args) }); const uid = mock.uid;
      if (operation === mock.hold) await new Promise(resolve => { mock.release = resolve; });
      if (operation === 'accountOverview') return { ok: true, data: { data: { uid, username: '合成酷友' + uid, feed: 0, follow: 0, fans: 0, ...(mock.omitLevel ? {} : { level: 0 }) } } };
      if (operation === 'accountCards') {
        if (mock.cardError) return { ok: false, error: { code: 'NETWORK', message: '合成卡片刷新失败' } };
        return { ok: true, data: { data: [
          { entityType: 'card', entityId: '1', title: '我关注的话题', url: '/topic/myFollowTopicList', emptyText: '你还没有关注任何话题', entities: [] },
          { entityType: 'card', entityId: '2', entityTemplate: 'iconScrollCard', title: '合成关注卡片' + uid, entities: [{ entityType: 'topic', id: '22', tag: '合成话题', title: '合成话题' }] },
          { entityType: 'card', entityId: '3', entityTemplate: 'textLinkListCard', title: '合成历史卡片', entities: [{ title: '合成最近访问', url: '/member/recentHistoryList' }, { title: '合成看过动态', url: '/member/hitHistoryList' }, { title: '合成我的问答', url: '/feed/myQaFeedList' }, { title: '合成收藏入口', url: '/collection/myCollectionList' }] },
          { entityType: 'card', entityId: '4', entityTemplate: 'future-private-template', title: '合成未知卡片', url: '/feed/44', entities: [{ entityType: 'feed', id: '44', title: '合成只读内容', url: '/page?url=/private' }] },
        ] } };
      }
      if (operation === 'accountTabData') { const second = args.page === 2; if (second && mock.pageError) return { ok: false, error: { code: 'NETWORK', message: '合成内容第二页失败' } }; return { ok: true, data: { data: [{ id: second ? 32 : 31, entityType: 'feed', title: '合成个人内容 ' + args.tab + ' 第' + (second ? 2 : 1) + '页' }], firstItem: 'first:31', lastItem: second ? 'last:32' : 'last:31', hasMore: !second } }; }
      if (operation === 'accountUsers') return { ok: true, data: { data: [], hasMore: false } };
      if (operation === 'accountHistory') return { ok: true, data: { data: [{ id: 51, entityType: 'history', title: '合成历史 ' + args.type, url: '/feed/51' }], hasMore: false } };
      if (operation === 'accountQr') return { ok: true, data: { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=' } };
      if (operation === 'accountProfile') return { ok: true, data: { data: { uid, username: '合成酷友' + uid } } };
      if (operation === 'accountPlugins') return { ok: true, data: { data: { avatarPluginList: [], feedPluginList: [] }, hasMore: false } };
      if (operation === 'accountCardManager') return { ok: true, data: { data: [{ id: 1, title: '合成管理卡片', page_visibility: 1 }] } };
      throw new Error('Unexpected synthetic overview operation: ' + operation);
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/account-overview-harness.html');
  const calls = operation => page.evaluate(op => window.__mineMock.calls.filter(row => row.operation === op), operation);
  const mine = async () => { await page.getByRole('navigation', { name: '账号设置' }).getByRole('button', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '查看我的主页', exact: true }).waitFor(); };
  const signedIn = async uid => { await page.evaluate(uid => { window.__mineMock.uid = uid; window.__mineNavigate({ account: { uid, username: '合成酷友' + uid, userAvatar: '' }, namespace: uid }); }, uid); await page.getByText('合成酷友' + uid, { exact: true }).waitFor(); };
  await record('guest my overview offers login and makes no private account requests', async () => {
    await page.getByText('登录后管理你的账号', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.__mineMock.calls), []); await page.getByRole('button', { name: '登录酷安', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.__mineEvents), ['login']);
  });
  await record('phone-guided my overview renders the ordered eight entries, known level and real zero counts', async () => {
    await signedIn('77'); await page.getByText('Lv.0', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('.ac-mine-grid button span').allTextContents(), ['我的关注', '我的收藏', '我的点评', '夜间模式', '我的图文', '我的回复', '我的挂件', '更多']);
    assert.deepEqual(await page.locator('.ac-mine-counts strong').allTextContents(), ['0', '0', '0']); assert.equal(await page.locator('progress').count(), 0);
    await page.getByText('你还没有关注任何话题', { exact: true }).waitFor(); await page.screenshot({ path: directory + '/mine.png', fullPage: true });
  });
  await record('my statistics open the exact dynamic, following and fan categories', async () => {
    await page.getByRole('button', { name: '查看我的动态', exact: true }).click(); await page.getByText('合成个人内容 feed 第1页', { exact: true }).waitFor(); assert.equal((await calls('accountTabData')).at(-1).args.tab, 'feed');
    await mine(); await page.getByRole('button', { name: '查看我的关注', exact: true }).click(); await page.getByRole('tab', { name: '关注', exact: true }).waitFor(); assert.equal((await calls('accountUsers')).at(-1).args.type, 'follow');
    await mine(); await page.getByRole('button', { name: '查看我的粉丝', exact: true }).click(); await page.getByRole('tab', { name: '粉丝', exact: true }).waitFor(); assert.equal((await calls('accountUsers')).at(-1).args.type, 'fans');
  });
  await record('my review, article and reply shortcuts select their initial content tabs directly', async () => {
    for (const [title, tab] of [['我的点评', 'rating'], ['我的图文', 'article'], ['我的回复', 'reply']]) { await mine(); await page.getByRole('button', { name: title, exact: true }).click(); await page.getByText('合成个人内容 ' + tab + ' 第1页', { exact: true }).waitFor(); assert.equal((await calls('accountTabData')).at(-1).args.tab, tab); }
    await mine(); await page.getByRole('button', { name: '我的挂件', exact: true }).click(); await page.getByRole('heading', { name: '头像与动态挂件', exact: true }).waitFor(); assert.ok((await calls('accountPlugins')).length > 0);
  });
  await record('external overview shortcuts call root callbacks without invented server mutations', async () => {
    await mine(); await page.evaluate(() => { window.__mineEvents = []; });
    for (const name of ['我的关注', '我的收藏', '夜间模式', '设置', '消息', '应用更新', '扫一扫', '查看我的主页']) await page.getByRole('button', { name, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__mineEvents), ['following', 'collections', 'theme', 'settings', 'messages', 'updates', 'scan', 'home']);
    await page.evaluate(() => window.__mineNavigate({ theme: 'dark' })); assert.equal(await page.getByRole('button', { name: '夜间模式', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.__mineNavigate({ theme: 'black' })); assert.equal(await page.getByRole('button', { name: '夜间模式', exact: true }).getAttribute('aria-pressed'), 'true');
  });
  await record('phone-confirmed more menu opens only implemented fixed personal content and management actions', async () => {
    for (const [title, tab] of [['我的赞', 'like'], ['我的酷图', 'coolpic'], ['我的问答', 'qa'], ['我的好物', 'goods'], ['我的好物榜', 'goods_rank'], ['应用集', 'album']]) { await mine(); await page.getByRole('button', { name: '更多', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '全部功能', exact: true }); await dialog.getByRole('button', { name: title, exact: true }).click(); await page.getByText('合成个人内容 ' + tab + ' 第1页', { exact: true }).waitFor(); assert.equal((await calls('accountTabData')).at(-1).args.tab, tab); }
    await mine(); await page.getByRole('button', { name: '更多', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '全部功能', exact: true }); assert.equal(await dialog.getByRole('button', { name: '我的装备', exact: true }).count(), 0); assert.equal(await dialog.getByRole('button', { name: '首页屏蔽管理', exact: true }).count(), 0); await dialog.getByRole('button', { name: '黑名单管理', exact: true }).click(); await page.getByRole('tab', { name: '黑名单', exact: true }).waitFor(); assert.equal((await calls('accountUsers')).at(-1).args.type, 'black');
    for (const [title, event] of [['草稿箱', 'drafts'], ['应用下载任务', 'downloads'], ['手机应用管理', 'phoneApps']]) { await mine(); await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('dialog', { name: '全部功能', exact: true }).getByRole('button', { name: title, exact: true }).click(); assert.equal((await page.evaluate(() => window.__mineEvents)).at(-1), event); }
  });
  await record('known cards retain horizontal and text layouts while unknown templates remain read-only', async () => {
    await mine();
    await page.getByRole('button', { name: '合成话题', exact: true }).click(); assert.equal((await page.evaluate(() => window.__mineEvents)).at(-1).entity.tag, '合成话题');
    assert.equal(await page.locator('.ac-mine-card-horizontal').count(), 1); assert.equal(await page.locator('.ac-mine-card-text').count(), 1); assert.equal(await page.getByRole('button', { name: '合成只读内容', exact: true }).count(), 0);
    await page.getByText('合成只读内容', { exact: true }).click(); assert.ok(!(await page.evaluate(() => window.__mineMock.calls)).some(call => call.args.url || call.operation === 'page'));
  });
  await record('my card aliases open fixed own-account destinations and exact history types', async () => {
    await page.getByRole('button', { name: '我关注的话题', exact: true }).click(); assert.deepEqual((await page.evaluate(() => window.__mineEvents)).at(-1), { url: '/topic/userFollowTagList' });
    await page.getByRole('button', { name: '合成收藏入口', exact: true }).click(); assert.equal((await page.evaluate(() => window.__mineEvents)).at(-1), 'collections');
    for (const [title, type] of [['合成最近访问', 'recent'], ['合成看过动态', 'feed']]) { await mine(); await page.getByRole('button', { name: title, exact: true }).click(); await page.getByText('合成历史 ' + type, { exact: true }).waitFor(); assert.equal((await calls('accountHistory')).at(-1).args.type, type); }
    await mine(); await page.getByRole('button', { name: '合成我的问答', exact: true }).click(); await page.getByText('合成个人内容 qa 第1页', { exact: true }).waitFor(); assert.equal((await calls('accountTabData')).at(-1).args.tab, 'qa');
  });
  await record('my overview card refresh preserves prior successful cards and retries its original read', async () => {
    await mine(); await page.evaluate(() => { window.__mineMock.cardError = true; window.__mineNavigate({ revision: 1 }); }); await page.getByText('合成卡片刷新失败', { exact: true }).waitFor(); assert.equal(await page.getByText('合成关注卡片77', { exact: true }).count(), 1);
    await page.evaluate(() => { window.__mineMock.cardError = false; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('合成卡片刷新失败', { exact: true }).waitFor({ state: 'hidden' });
    const requests = await calls('accountCards'); assert.deepEqual(requests.at(-2), requests.at(-1)); assert.deepEqual(requests.at(-1).args, { refresh: true });
  });
  await record('personal content page retry keeps existing records, category and exact cursors', async () => {
    await page.getByRole('button', { name: '我的回复', exact: true }).click(); await page.getByText('合成个人内容 reply 第1页', { exact: true }).waitFor(); await page.evaluate(() => { window.__mineMock.pageError = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('合成内容第二页失败', { exact: true }).waitFor(); assert.equal(await page.getByText('合成个人内容 reply 第1页', { exact: true }).count(), 1);
    await page.evaluate(() => { window.__mineMock.pageError = false; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('合成个人内容 reply 第2页', { exact: true }).waitFor(); const requests = (await calls('accountTabData')).filter(row => row.args.tab === 'reply'); assert.deepEqual(requests.at(-2), requests.at(-1)); assert.deepEqual(requests.at(-1).args, { tab: 'reply', ratingTarget: 'all', page: 2, firstItem: 'first:31', lastItem: 'last:31' });
  });
  await record('account switching closes a pending overview QR and discards its delayed image', async () => {
    await mine(); await page.evaluate(() => { window.__mineMock.hold = 'accountQr'; }); await page.getByRole('button', { name: '我的二维码', exact: true }).click(); await page.waitForFunction(() => typeof window.__mineMock.release === 'function'); await signedIn('88'); await page.evaluate(() => { window.__mineMock.hold = ''; window.__mineMock.release(); }); await page.getByText('合成关注卡片88', { exact: true }).waitFor(); assert.equal(await page.getByRole('dialog', { name: '我的酷安二维码', exact: true }).count(), 0); assert.equal(await page.getByAltText('我的酷安主页二维码').count(), 0);
  });
  await record('missing level and experience stay absent and late account summary cannot replace the new account', async () => {
    await page.evaluate(() => { window.__mineMock.omitLevel = true; window.__mineMock.release = null; window.__mineMock.hold = 'accountOverview'; window.__mineMock.uid = '99'; window.__mineNavigate({ account: { uid: '99', username: '合成酷友99', userAvatar: '' }, namespace: '99' }); }); await page.waitForFunction(() => typeof window.__mineMock.release === 'function'); const release = await page.evaluateHandle(() => window.__mineMock.release);
    await page.evaluate(() => { window.__mineMock.hold = ''; }); await signedIn('100'); await page.evaluate(release => release(), release); await page.getByText('合成关注卡片100', { exact: true }).waitFor(); assert.equal(await page.getByText('合成酷友99', { exact: true }).count(), 0); assert.equal(await page.locator('.ac-mine-level').count(), 0); assert.equal(await page.locator('progress').count(), 0);
  });
  await record('my overview stays usable in a narrow desktop window with reachable card management', async () => {
    await page.setViewportSize({ width: 460, height: 960 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false); await page.screenshot({ path: directory + '/mine-narrow.png', fullPage: true }); await page.getByRole('button', { name: '卡片管理', exact: true }).click(); await page.getByText('合成管理卡片', { exact: true }).waitFor(); assert.ok((await calls('accountCardManager')).length > 0);
  });
  assert.deepEqual(errors, []); writeFileSync('research/account-overview-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'phone-guided synthetic renderer checks; no actual account writes', externalRequests: 'blocked', checks, errors }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
