// Actual App, preload, native menu and desktop-settings handler. Only business
// API/account responses are synthetic; network is blocked before main starts.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';
import { historyStorageKey } from '../core/local-history.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), directory = path.join(root, '.local/settings-native-check');
mkdirSync(directory, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(path.join(directory, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const bootstrap = path.join(directory, 'bootstrap.cjs');
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: packageMetadata.name, version: packageMetadata.version, main: 'bootstrap.cjs' }));
writeFileSync(bootstrap, `const {app,session,ipcMain}=require('electron');globalThis.settingsNativeEvents=new(require('node:events').EventEmitter)();
globalThis.settingsNative={identity:null,calls:[],blockedNetwork:0,cacheCalls:0,storageCalls:0,holdCache:false,failCache:false,releaseCache:null,accountSettings:{values:${JSON.stringify(DEFAULT_ACCOUNT_SETTINGS)},present:${JSON.stringify(Object.keys(DEFAULT_ACCOUNT_SETTINGS))},guardExpiresAt:null,replyLocked:false}};
app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,reply)=>{globalThis.settingsNative.blockedNetwork++;reply({cancel:true})});const target=session.defaultSession;const clear=target.clearCache.bind(target),storage=target.clearStorageData.bind(target);target.clearCache=async(...args)=>{const mock=globalThis.settingsNative;mock.cacheCalls++;if(mock.holdCache)await new Promise(resolve=>mock.releaseCache=resolve);if(mock.failCache)throw new Error('模拟原生缓存清理失败');return clear(...args)};target.clearStorageData=(...args)=>{globalThis.settingsNative.storageCalls++;return storage(...args)}});
const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>{if(channel==='coolapk:accounts')return register(channel,()=>({ok:true,data:{accounts:globalThis.settingsNative.identity?[globalThis.settingsNative.identity]:[],current:globalThis.settingsNative.identity}}));if(channel==='coolapk:call')return register(channel,(_,operation,args={})=>{const mock=globalThis.settingsNative;mock.calls.push({operation,args});globalThis.settingsNativeEvents.emit('call',operation);const data=operation==='accountSettings'?structuredClone(mock.accountSettings):operation==='notificationCount'?{}:operation==='accountOverview'?{...mock.identity,feed:0,follow:12,fans:34,level:9}:operation==='accountProfile'?{...mock.identity,bio:'隔离个人资料'}:operation==='detail'?{entityType:'feed',id:'719',uid:'777',username:'设置测试作者',message:'隔离设置测试动态详情'}:operation==='accountTabData'?[{id:931,entityType:'feed',title:'原生个人分类-'+args.tab}]:operation==='home'?[{entityType:'feed',id:'719',uid:'777',username:'设置测试作者',message:'隔离设置测试动态'}]:[];return{ok:true,data:{data,hasMore:false}}});return register(channel,handler)};require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const desktop = await playwright._electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 });
const checks = [], errors = [], measurements = {};
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
const waitNewCall = (operation, before) => desktop.evaluate((_, { operation, before }) => new Promise((resolve, reject) => {
  const events = globalThis.settingsNativeEvents;
  const finish = () => {
    const calls = globalThis.settingsNative.calls.filter(row => row.operation === operation);
    if (calls.length > before) { clearTimeout(timer); events.removeListener('call', finish); resolve(calls.at(-1)); }
  };
  const timer = setTimeout(() => { events.removeListener('call', finish); reject(new Error('Missing new actual App IPC call: ' + operation)); }, 5000);
  events.on('call', finish); finish();
}), { operation, before });
const zoom = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
async function waitZoom(expected) {
  await desktop.evaluate(async ({ BrowserWindow }, expected) => {
    const deadline = Date.now() + 3000;
    while (Math.abs(BrowserWindow.getAllWindows()[0].webContents.getZoomFactor() - expected) > .001) {
      if (Date.now() > deadline) throw new Error('Native zoom did not reach ' + expected);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }, expected);
  assert.ok(Math.abs(await zoom() - expected) < .001);
}
const menuClick = label => desktop.evaluate(({ Menu, BrowserWindow }, label) => {
  const item = Menu.getApplicationMenu().items.find(item => item.label === '视图').submenu.items.find(item => item.label === label);
  if (!item || !item.enabled) throw new Error('Missing enabled menu action ' + label); item.click(item, BrowserWindow.getAllWindows()[0]);
}, label);
async function account(identity) {
  await desktop.evaluate(({ BrowserWindow }, identity) => { globalThis.settingsNative.identity = identity; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: identity ? [identity] : [], current: identity } }); }, identity);
}
try {
  const page = await desktop.firstWindow(); page.on('pageerror', failure => errors.push(failure.message));
  await page.locator('[data-feed-id="719"]').waitFor();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const openSettings = async () => { if (!(await dialog.count())) await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await dialog.waitFor(); };
  const openDisplay = async () => { await openSettings(); if (!(await dialog.getByLabel('字体大小', { exact: true }).count())) await dialog.getByRole('button', { name: /^界面显示/ }).click(); };
  await record('isolated actual App uses the real desktop bridge/handler and package version', async () => {
    const info = await page.evaluate(() => window.coolapk.desktop('info'));
    assert.equal(info.ok, true); assert.equal(info.data.version, packageMetadata.version);
    await openSettings(); await dialog.getByText(packageMetadata.version, { exact: true }).waitFor();
    const invalid = await page.evaluate(() => window.coolapk.desktop('display', { fontSize: 'large', path: 'synthetic-rejected' }));
    assert.equal(invalid.ok, false); assert.match(invalid.error.message, /字体大小/);
    assert.equal((await page.evaluate(() => window.coolapk.desktop('clearStorageData'))).ok, false);
  });
  await record('actual native display persists explicit Windows transparency following and restores material after opting out', async () => {
    await openDisplay(); const follow = dialog.getByRole('switch', { name: '跟随 Windows 透明效果', exact: true });
    assert.equal(await follow.isChecked(), false); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'false');
    measurements.nativeTransparency = await page.evaluate(() => ({ reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches, forcedColors: matchMedia('(forced-colors: active)').matches, materialFollowSystem: JSON.parse(localStorage.getItem('coolapk-preferences')).materialFollowSystem }));
    const media = await page.context().newCDPSession(page);
    await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'forced-colors', value: 'none' }] });
    try {
      assert.ok((await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
      await follow.check(); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'true');
      assert.equal(await dialog.evaluate(node => getComputedStyle(node).backdropFilter), 'none');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).materialFollowSystem), true);
      await follow.uncheck(); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'false');
      assert.ok((await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
      assert.equal(await page.locator('.modal-backdrop').evaluate(node => getComputedStyle(node).backdropFilter), 'none', 'the backdrop must not become a root that blocks the modal material from sampling wallpaper');
    } finally { await media.send('Emulation.setEmulatedMedia', { features: [] }); }
  });
  await record('global font selections update actual Electron webContents zoom rather than only a preview', async () => {
    await openDisplay();
    await dialog.getByLabel('字体大小', { exact: true }).selectOption('large'); await waitZoom(1.15);
    await dialog.getByLabel('字体大小', { exact: true }).selectOption('small'); await waitZoom(.9);
    await dialog.getByLabel('字体大小', { exact: true }).selectOption('large'); await waitZoom(1.15);
    measurements.fontZoom = { large: 1.15, small: .9 };
  });
  await record('real native View menu combines manual zoom with fonts and reset preserves selected font', async () => {
    await menuClick('放大'); await waitZoom(1.265);
    await dialog.getByLabel('字体大小', { exact: true }).selectOption('small'); await waitZoom(.99);
    await menuClick('重置缩放'); await waitZoom(.9);
    await dialog.getByLabel('字体大小', { exact: true }).selectOption('large'); await waitZoom(1.15);
    await menuClick('缩小'); const reduced = 1.15 * .909; await waitZoom(reduced);
    await menuClick('重置缩放'); await waitZoom(1.15);
    measurements.nativeMenu = { largePlus: 1.265, smallPlus: .99, smallReset: .9, largeReset: 1.15 };
  });
  await record('real Electron nativeTheme media changes produce light/dark and actual pure-black colors', async () => {
    // Playwright defaults to an emulated light scheme even in Electron. Remove
    // that test override so the real nativeTheme is allowed to reach matchMedia.
    await page.emulateMedia({ colorScheme: null });
    await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).check();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await page.locator('.app-shell').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 28, 25)');
    await dialog.getByRole('switch', { name: '将A屏黑主题设为夜间模式' }).check();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'black');
    assert.equal(await page.locator('.app-shell').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)');
    const modalMaterial = await dialog.evaluate(node => {
      const modal = getComputedStyle(node), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const drawing = canvas.getContext('2d'); drawing.fillStyle = modal.backgroundColor; drawing.fillRect(0, 0, 1, 1);
      return { background: modal.backgroundColor, surface: modal.getPropertyValue('--surface').trim(), tintPixel: Array.from(drawing.getImageData(0, 0, 1, 1).data), filter: modal.backdropFilter, effect: document.documentElement.dataset.materialEffect, materialFollowSystem: document.documentElement.dataset.materialFollowSystem, reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches, forcedColors: matchMedia('(forced-colors: active)').matches };
    });
    assert.equal(modalMaterial.surface, '#0b0b0b'); assert.equal(modalMaterial.effect, 'full');
    if (modalMaterial.forcedColors || modalMaterial.reducedTransparency && modalMaterial.materialFollowSystem === 'true') {
      assert.equal(modalMaterial.filter, 'none'); assert.equal(modalMaterial.tintPixel[3], 255);
    } else {
      // The global material now uses the configured 78% surface opacity for
      // settings as well as content cards, including without a wallpaper.
      assert.ok(modalMaterial.filter.includes('coolapk-desktop-glass'), JSON.stringify(modalMaterial)); assert.equal(modalMaterial.tintPixel[3], 199);
    }
    assert.ok(modalMaterial.tintPixel.slice(0, 3).every(channel => channel >= 10 && channel <= 12));
    assert.equal(await dialog.locator('.preferences-body').evaluate(node => getComputedStyle(node).color), 'rgb(237, 237, 237)');
    measurements.themeColors = { dark: 'rgb(22, 28, 25)', black: 'rgb(0, 0, 0)', blackSurface: '#0b0b0b', modalMaterial };
    await dialog.getByRole('button', { name: '返回设置', exact: true }).click();
  });
  await record('native cache cleanup calls real session.clearCache once and preserves application storage', async () => {
    await page.evaluate(() => localStorage.setItem('settings-native-storage-canary', 'synthetic-preserved'));
    const before = await desktop.evaluate(() => ({ cache: globalThis.settingsNative.cacheCalls, storage: globalThis.settingsNative.storageCalls }));
    await desktop.evaluate(() => { globalThis.settingsNative.holdCache = true; });
    await dialog.getByRole('button', { name: /^缓存清理/ }).click();
    assert.equal(await dialog.getByRole('button', { name: /^缓存清理/ }).isDisabled(), true);
    await page.evaluate(() => { window.__secondNativeCache = window.coolapk.desktop('clearCache'); });
    await desktop.evaluate(() => { globalThis.settingsNative.holdCache = false; globalThis.settingsNative.releaseCache(); });
    await dialog.getByText('缓存已清理', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.__secondNativeCache)).ok, true);
    const after = await desktop.evaluate(() => ({ cache: globalThis.settingsNative.cacheCalls, storage: globalThis.settingsNative.storageCalls }));
    assert.equal(after.cache, before.cache + 1); assert.equal(after.storage, before.storage);
    assert.equal(await page.evaluate(() => localStorage.getItem('settings-native-storage-canary')), 'synthetic-preserved');
    measurements.cache = { nativeCalls: after.cache - before.cache, storageClearCalls: after.storage - before.storage };
  });
  await record('native cache failure displays its real error and retry confirms actual successful clearing', async () => {
    await desktop.evaluate(() => { globalThis.settingsNative.failCache = true; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click();
    await dialog.getByText('模拟原生缓存清理失败', { exact: true }).waitFor();
    assert.equal(await dialog.getByText('缓存已清理', { exact: true }).count(), 0);
    await desktop.evaluate(() => { globalThis.settingsNative.failCache = false; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click(); await dialog.getByText('缓存已清理', { exact: true }).waitFor();
  });
  await record('old guest cleanup does not refresh owner resources or announce success after namespace switch', async () => {
    await desktop.evaluate(() => { globalThis.settingsNative.holdCache = true; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click();
    await account({ uid: '98765', username: '原生设置隔离账号', userAvatar: '' }); await page.locator('.account-entry').getByText('原生设置隔离账号', { exact: true }).waitFor();
    await page.waitForTimeout(150); const before = await desktop.evaluate(() => globalThis.settingsNative.calls.length);
    await desktop.evaluate(() => { globalThis.settingsNative.holdCache = false; globalThis.settingsNative.releaseCache(); });
    await page.waitForTimeout(150);
    const after = await desktop.evaluate(() => globalThis.settingsNative.calls.length);
    assert.equal(after, before, 'old guest cache result must not issue fresh owner API requests');
    assert.equal(await dialog.getByText('缓存已清理', { exact: true }).count(), 0);
  });
  await record('old owner cleanup result is also rejected when returning to guest mode', async () => {
    await desktop.evaluate(() => { globalThis.settingsNative.holdCache = true; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click();
    await account(null); await page.locator('.account-entry').getByText('登录酷安', { exact: true }).waitFor();
    await page.waitForTimeout(150); const before = await desktop.evaluate(() => globalThis.settingsNative.calls.length);
    await desktop.evaluate(() => { globalThis.settingsNative.holdCache = false; globalThis.settingsNative.releaseCache(); });
    await page.waitForTimeout(150);
    assert.equal(await desktop.evaluate(() => globalThis.settingsNative.calls.length), before, 'old owner cache result must not refresh guest resources');
    assert.equal(await dialog.getByText('缓存已清理', { exact: true }).count(), 0);
  });
  await record('900x620 native window retains reachable settings/fonts and enabled menu controls with no horizontal overflow', async () => {
    await desktop.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]; main.setSize(900, 620); main.setMenuBarVisibility(true); });
    await openDisplay(); await dialog.getByLabel('字体大小', { exact: true }).selectOption('large'); await waitZoom(1.15);
    await page.screenshot({ path: path.join(directory, 'display-900-top.png') });
    await dialog.getByLabel('夜间结束时间').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const menu = await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '视图').submenu.items.filter(item => item.label).map(item => ({ label: item.label, enabled: item.enabled })));
    for (const label of ['放大', '缩小', '重置缩放']) assert.ok(menu.some(item => item.label === label && item.enabled));
    await page.screenshot({ path: path.join(directory, 'display-900.png') });
    await dialog.getByRole('button', { name: '返回设置', exact: true }).click(); await page.screenshot({ path: path.join(directory, 'settings-900.png') });
    measurements.minWindow = { width: 900, height: 620, font: 'large', zoom: await zoom(), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })) };
  });
  const mine = async () => {
    const modal = page.getByRole('dialog'); if (await modal.count()) await modal.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '查看我的主页', exact: true }).waitFor();
  };
  const more = async () => { await mine(); await page.locator('.ac-mine-grid').getByRole('button', { name: '更多', exact: true }).click(); return page.getByRole('dialog', { name: '全部功能', exact: true }); };
  const latestCall = operation => desktop.evaluate((_, operation) => globalThis.settingsNative.calls.filter(row => row.operation === operation).at(-1), operation);
  await record('root sidebar My route shows official-shaped counts and the exact eight principal entries', async () => {
    const before = await desktop.evaluate(() => Object.fromEntries(['accountOverview', 'accountCards'].map(operation => [operation, globalThis.settingsNative.calls.filter(row => row.operation === operation).length])));
    await openDisplay(); await dialog.getByLabel('字体大小', { exact: true }).selectOption('standard'); await waitZoom(1);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await desktop.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows()[0]; main.setSize(1360, 920); main.setMenuBarVisibility(false); });
    await account({ uid: '98765', username: '原生我的隔离账号', userAvatar: '' }); await page.locator('.account-entry').getByText('原生我的隔离账号', { exact: true }).waitFor();
    await mine(); await page.getByText('Lv.9', { exact: true }).waitFor();
    // Overview content becoming visible does not prove the independent card
    // request has reached IPC. Await each actual operation before inspecting it.
    const overviewCall = await waitNewCall('accountOverview', before.accountOverview), cardsCall = await waitNewCall('accountCards', before.accountCards);
    assert.deepEqual(await page.locator('.ac-mine-counts strong').allTextContents(), ['0', '12', '34']);
    assert.deepEqual(await page.locator('.ac-mine-grid button span').allTextContents(), ['我的关注', '我的收藏', '我的点评', '夜间模式', '我的图文', '我的回复', '我的挂件', '更多']);
    assert.equal(overviewCall.operation, 'accountOverview'); assert.deepEqual(overviewCall.args, {}); assert.deepEqual(cardsCall.args, { refresh: true });
    await page.screenshot({ path: path.join(directory, 'mine-native.png') });
  });
  await record('My night action invokes root preferences and updates both actual theme and selected button state', async () => {
    const night = page.locator('.ac-mine-grid').getByRole('button', { name: '夜间模式', exact: true });
    assert.equal(await night.getAttribute('aria-pressed'), 'true'); await night.click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); assert.equal(await night.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).followSystem), false);
    await night.click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await night.getAttribute('aria-pressed'), 'true');
  });
  await record('My reviews/articles/replies shortcuts open actual account tabs with their exact read operations', async () => {
    for (const [title, tab, activeLabel] of [['我的点评', 'rating', '评分'], ['我的图文', 'article', '图文'], ['我的回复', 'reply', '回复']]) {
      await mine(); await page.locator('.ac-mine-grid').getByRole('button', { name: title, exact: true }).click();
      await page.getByText('原生个人分类-' + tab, { exact: true }).waitFor();
      assert.equal(await page.getByRole('tab', { name: activeLabel, exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal((await latestCall('accountTabData')).args.tab, tab);
    }
  });
  await record('My draft shortcut opens the real Composer with initial drafts visible and can restore a synthetic local draft', async () => {
    await page.evaluate(() => localStorage.setItem('coolapk-drafts:98765', JSON.stringify([{ id: 'native-synthetic-draft', message: '原生草稿恢复正文', title: '原生隔离草稿', mode: 'feed', options: { targetType: '', targetId: '', visibleStatus: 1, originalType: 0 }, updated: Date.now() }])));
    const moreDialog = await more(); await moreDialog.getByRole('button', { name: '草稿箱', exact: true }).click();
    const composer = page.getByRole('dialog', { name: '发布动态', exact: true });
    await composer.locator('.composer-drafts').getByRole('button', { name: /原生隔离草稿/ }).waitFor();
    await composer.locator('.composer-drafts').getByRole('button', { name: /原生隔离草稿/ }).click();
    assert.equal(await composer.locator('#publish-message').inputValue(), '原生草稿恢复正文');
    assert.equal(await composer.locator('.composer-drafts').count(), 0);
    await composer.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('My More connects download, blacklist, settings and saved-account management to real App panels', async () => {
    let moreDialog = await more(); await moreDialog.getByRole('button', { name: '应用下载任务', exact: true }).click();
    await page.locator('.main-scroll').getByRole('heading', { name: '应用下载', exact: true, level: 1 }).waitFor(); await page.locator('.downloads-page').waitFor();
    moreDialog = await more(); await moreDialog.getByRole('button', { name: '黑名单管理', exact: true }).click();
    await page.getByRole('tab', { name: '黑名单', exact: true }).waitFor(); await page.getByText('列表为空', { exact: true }).waitFor(); assert.equal((await latestCall('accountUsers')).args.type, 'black');
    moreDialog = await more(); await moreDialog.getByRole('button', { name: '设置', exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole('button', { name: /^本机账号管理/ }).click();
    const accounts = page.getByRole('dialog', { name: '登录酷安', exact: true }); await accounts.waitFor(); await accounts.getByText('已保存的账号', { exact: true }).waitFor();
    await accounts.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await desktop.evaluate(() => globalThis.settingsNative.calls.some(row => /create|update|publish|delete|Relationship|Save$/.test(row.operation))), false);
  });
  await record('account-entry reset stays separate from metadata and detail navigation so unsaved profile text survives', async () => {
    await page.locator('.sidebar').getByRole('button', { name: '账号中心', exact: true }).click();
    const signature = page.getByLabel('个性签名', { exact: true }); await signature.waitFor(); await signature.fill('详情前未保存签名');
    await desktop.evaluate(({ BrowserWindow }) => {
      const identity = { ...globalThis.settingsNative.identity, username: '原生资料元数据更新' }; globalThis.settingsNative.identity = identity;
      BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, metadataOnly: true, data: { accounts: [identity], current: identity } });
    });
    await page.locator('.account-entry').getByText('原生资料元数据更新', { exact: true }).waitFor(); assert.equal(await signature.inputValue(), '详情前未保存签名');
    await page.getByLabel('搜索酷安', { exact: true }).fill('https://www.coolapk.com/feed/719'); await page.getByLabel('搜索酷安', { exact: true }).press('Enter');
    const detail = page.getByRole('dialog', { name: '动态详情', exact: true }); await detail.waitFor(); await detail.getByText('隔离设置测试动态详情', { exact: true }).waitFor();
    await detail.getByRole('button', { name: '关闭动态详情', exact: true }).click(); assert.equal(await signature.inputValue(), '详情前未保存签名');
    assert.equal(await desktop.evaluate(() => globalThis.settingsNative.calls.some(row => /create|update|publish|delete|Relationship|Save$/.test(row.operation))), false);
  });
  await record('native App respects cloud history permission and clears only the current account history key', async () => {
    const ownerKey = historyStorageKey('98765'), guestKey = historyStorageKey('guest');
    assert.ok((await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), ownerKey)).some(row => String(row.id) === '719'));
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify([{ id: '818', message: '隔离游客历史' }])), guestKey);
    const before = await desktop.evaluate(() => globalThis.settingsNative.calls.filter(row => row.operation === 'accountSettings').length);
    await desktop.evaluate(({ BrowserWindow }) => { globalThis.settingsNative.accountSettings.values.record_hit_history = false; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:command', 'refresh'); });
    await waitNewCall('accountSettings', before); await page.waitForFunction(key => localStorage.getItem(key) === null, ownerKey);
    assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), guestKey))[0].id, '818');
    await page.getByLabel('搜索酷安', { exact: true }).fill('https://www.coolapk.com/feed/719'); await page.getByLabel('搜索酷安', { exact: true }).press('Enter');
    await page.getByRole('dialog', { name: '动态详情', exact: true }).waitFor(); assert.equal(await page.evaluate(key => localStorage.getItem(key), ownerKey), null);
    await page.getByRole('dialog', { name: '动态详情', exact: true }).getByRole('button', { name: '关闭动态详情', exact: true }).click();
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify([{ id: '919', message: '隔离其他账号记录' }])), ownerKey);
    await account(null); await page.locator('.account-entry').getByText('登录酷安', { exact: true }).waitFor(); await openSettings();
    await dialog.getByRole('button', { name: /^清空本地浏览历史/ }).click(); await dialog.getByText('本地浏览历史已清空', { exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), guestKey), null); assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), ownerKey))[0].id, '919');
    measurements.history = { ownerKey, guestKey, cloudPermissionEnforced: true, currentAccountClearOnly: true };
  });
  assert.deepEqual(errors, []);
  const counters = await desktop.evaluate(() => ({ requests: globalThis.settingsNative.calls.length, blockedNetwork: globalThis.settingsNative.blockedNetwork, storageClearCalls: globalThis.settingsNative.storageCalls }));
  writeFileSync(path.join(root, 'research/settings-native-checks.json'), JSON.stringify({ checkedAt: '2026-10-04', fixture: 'Actual built App + actual Electron desktop settings IPC/menu/session handlers; fresh isolated userdata; synthetic business/account IPC and pre-start HTTP block', result: 'passed', checks, measurements, counters, accountScope: 'Synthetic guest and owner identity only; no phone, credentials, live API or account writes' }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', groups: checks.length, ...counters }));
} catch (failure) { console.error(failure); throw failure; }
finally { await desktop.close(); }
