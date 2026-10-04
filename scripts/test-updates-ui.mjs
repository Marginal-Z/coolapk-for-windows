// Updater UI tests use synthetic release data and block all external traffic.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';

const output = '.local/software-update-check';
const port = Number(process.env.COOLAPK_UPDATES_UI_PORT || 5206), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{SoftwareUpdate}from'/src/SoftwareUpdate.tsx';import{Settings}from'/src/Settings.tsx';import{Modal}from'/src/components.tsx';import{normalizePreferences}from'/core/preferences.mjs';import'/src/styles.css';
function Harness(){const[state,setState]=useState({currentVersion:'0.5.0',distribution:'installed',status:'idle'});const[busy,setBusy]=useState(false),[error,setError]=useState(''),[screen,setScreen]=useState('settings');useEffect(()=>{window.__updateSetState=setState;window.__updateSetBusy=setBusy;window.__updateSetError=setError;window.__updateSetScreen=setScreen},[]);useEffect(()=>{window.__updateRendered={state,busy,error}},[state,busy,error]);const action=operation=>{window.__updateActions.push(operation);setBusy(true)};return <main style={{color:'var(--text)'}}><button onClick={()=>setScreen('settings')}>打开设置测试</button><button onClick={()=>setScreen('updates')}>打开软件更新测试</button>{screen==='settings'&&<Modal title="设置" onClose={()=>setScreen('')}><Settings namespace="guest" preferences={normalizePreferences(null)} onPreferencesChange={()=>{}} accountCount={0} version="0.5.0" onHelp={()=>window.__updateActions.push('help')} onAgreement={()=>{}} onUpdates={()=>setScreen('updates')}/></Modal>}{screen==='updates'&&<Modal title="软件更新" onClose={()=>setScreen('')}><SoftwareUpdate state={state} busy={busy} error={error} onAction={action} onInstaller={()=>window.__updateActions.push('installer')}/></Modal>}</main>}createRoot(document.getElementById('root')).render(<Harness/>);`);

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser;
const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1024, height: 820 }, timezoneId: 'Asia/Bangkok' });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => { window.__updateActions = []; });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/${output}/fixture.html`);
  let dialog = page.getByRole('dialog', { name: '软件更新', exact: true });
  const state = async next => {
    const expected = { currentVersion: '0.5.0', distribution: 'installed', ...next };
    await page.evaluate(expected => { window.__updateSetBusy(false); window.__updateSetError(''); window.__updateSetState(expected); }, expected);
    // A same-phase transition can change retry controls and errors while keeping
    // its status text. Wait for the full React commit rather than the old label.
    await page.waitForFunction(expected => {
      const rendered = window.__updateRendered;
      return rendered?.busy === false && rendered.error === '' && JSON.stringify(rendered.state) === JSON.stringify(expected);
    }, expected);
    await page.waitForFunction(status => document.querySelector('.software-update-status')?.textContent === status, {
      idle: '检查是否有新版本', checking: '正在检查更新…', available: '发现新版本', current: '已是最新版本', downloading: '正在下载更新…',
      downloaded: '更新已下载', installing: '正在启动安装程序…', error: '更新未完成', unsupported: '当前运行方式不支持自动更新',
    }[next.status]);
  };
  const actions = () => page.evaluate(() => window.__updateActions);
  await record('Settings opens a desktop software update dialog with the running version and no phone application action', async () => {
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: /^软件更新/ }).click();
    await dialog.waitFor(); await dialog.getByText('当前版本 0.5.0', { exact: false }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: /^应用更新/ }).count(), 0);
  });
  await record('manual check is dispatched once and stays disabled while a request or update check is pending', async () => {
    await dialog.getByRole('button', { name: '检查更新', exact: true }).click();
    assert.deepEqual(await actions(), ['check']);
    assert.equal(await dialog.getByRole('button', { name: '检查更新', exact: true }).isDisabled(), true);
    await state({ status: 'checking' });
    assert.equal(await dialog.getByRole('button', { name: '正在检查…', exact: true }).isDisabled(), true);
    await state({ status: 'current', checkedAt: '2026-10-04T07:00:00Z' });
    assert.equal(await dialog.getByRole('button', { name: '检查更新', exact: true }).isEnabled(), true);
    await dialog.getByText(/^上次检查/).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
  });
  await record('release notes remain inert plain text, preserve line breaks and display valid release metadata', async () => {
    const notes = '改进软件更新\n<img src="https://example.invalid/x" onerror="window.__notesExecuted=true">';
    await state({ status: 'available', availableVersion: '0.6.0', releaseDate: '2026-10-04T08:00:00Z', releaseNotes: notes });
    await dialog.getByText('版本 0.6.0', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.software-update-notes').innerText(), notes);
    assert.equal(await dialog.locator('.software-update-notes img').count(), 0);
    assert.equal(await page.evaluate(() => window.__notesExecuted), undefined);
    assert.equal(await dialog.locator('time').getAttribute('datetime'), '2026-10-04T08:00:00Z');
    await dialog.getByRole('button', { name: '下载更新', exact: true }).click();
    assert.deepEqual(await actions(), ['check', 'download']);
    assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).isDisabled(), true);
  });
  await record('download progress presents measurable bytes, speed and percentage and dispatches cancellation', async () => {
    await state({ status: 'downloading', availableVersion: '0.6.0', progress: { percent: 25, transferred: 25 * 1024 ** 2, total: 100 * 1024 ** 2, bytesPerSecond: 2 * 1024 ** 2 } });
    const progress = dialog.getByRole('progressbar', { name: '更新下载进度', exact: true });
    assert.equal(await progress.getAttribute('value'), '25');
    await dialog.getByText('25.0 MB / 100.0 MB', { exact: false }).waitFor();
    await dialog.getByText('2.0 MB/s', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '检查更新', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '取消下载', exact: true }).click();
    assert.equal((await actions()).at(-1), 'cancel');
    assert.equal(await dialog.getByRole('button', { name: '取消下载', exact: true }).isDisabled(), true);
    await state({ status: 'available', availableVersion: '0.6.0' });
    assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).isEnabled(), true);
  });
  await record('current release keeps its actual changelog visible without offering a duplicate download', async () => {
    await state({ status: 'current', releaseVersion: '0.5.0', releaseDate: '2026-10-04T08:00:00Z', releaseNotes: '修复手机协同\n优化桌面背景' });
    await dialog.getByRole('region', { name: '更新日志', exact: true }).waitFor();
    assert.equal(await dialog.locator('.software-update-notes').innerText(), '修复手机协同\n优化桌面背景');
    assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
    await state({ status: 'available', availableVersion: '0.6.0', releaseNotes: '' });
    await dialog.getByText('此版本未提供更新日志。', { exact: true }).waitFor();
  });
  await record('closing an update dialog leaves the download state intact and reopening resumes visible progress', async () => {
    await state({ status: 'downloading', availableVersion: '0.6.0', progress: { percent: 57.5, transferred: 57.5 * 1024 ** 2, total: 100 * 1024 ** 2, bytesPerSecond: 512 * 1024 } });
    const before = await actions();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await actions(), before);
    await page.getByRole('button', { name: '打开软件更新测试', exact: true }).click(); await dialog.waitFor();
    assert.equal(await dialog.getByRole('progressbar').getAttribute('value'), '57.5');
    assert.equal(await dialog.getByRole('button', { name: '取消下载', exact: true }).isEnabled(), true);
  });
  await record('network or checksum failures surface acknowledged errors with usable retry paths', async () => {
    await state({ status: 'error', availableVersion: '0.6.0', error: '更新包校验失败，请重新下载。' });
    await dialog.getByRole('alert').filter({ hasText: '更新包校验失败' }).waitFor();
    await dialog.getByRole('button', { name: '重试下载', exact: true }).click(); assert.equal((await actions()).at(-1), 'download');
    await state({ status: 'error', error: '无法连接更新服务，请检查网络后重试。' });
    assert.equal(await dialog.getByRole('button', { name: '重试下载', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '重试检查', exact: true }).click(); assert.equal((await actions()).at(-1), 'check');
    await page.evaluate(() => { window.__updateSetBusy(false); window.__updateSetError('安装程序未能启动，请重试。'); });
    await dialog.getByRole('alert').filter({ hasText: '安装程序未能启动' }).waitFor();
  });
  await record('installation requires an explicit action and pending installer prevents repeated launch', async () => {
    await state({ status: 'downloaded', availableVersion: '0.6.0' });
    await dialog.getByText('安装将退出软件。请先保存正在编辑的内容，安装完成后重新打开。', { exact: true }).waitFor();
    const before = (await actions()).length;
    assert.equal((await actions()).length, before);
    await dialog.getByRole('button', { name: '退出并安装', exact: true }).click(); assert.equal((await actions()).at(-1), 'install');
    assert.equal(await dialog.getByRole('button', { name: '退出并安装', exact: true }).isDisabled(), true);
    await state({ status: 'installing', availableVersion: '0.6.0' });
    assert.equal(await dialog.getByRole('button', { name: '正在启动安装…', exact: true }).isDisabled(), true);
  });
  await record('portable current releases expose a one-time installer migration without inventing a newer version', async () => {
    await state({ status: 'current', distribution: 'portable' });
    await dialog.getByText(/便携版更新会转为安装版/).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
    await dialog.getByRole('button', { name: '下载安装版', exact: true }).click(); assert.equal((await actions()).at(-1), 'installer');
    await state({ status: 'downloaded', distribution: 'portable', availableVersion: '0.6.0' });
    assert.equal(await dialog.getByRole('button', { name: '退出并安装', exact: true }).isEnabled(), true);
  });
  await record('development builds explain unsupported updates and expose no active updater operations', async () => {
    await state({ status: 'unsupported', distribution: 'development' });
    assert.equal(await dialog.getByRole('button', { name: '检查更新', exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name: '下载安装版', exact: true }).count(), 0);
    await dialog.getByText('请使用 Windows 安装版检查和安装更新。', { exact: true }).waitFor();
  });
  await record('invalid progress data and release dates stay bounded and do not render invalid metrics', async () => {
    await state({ status: 'downloading', availableVersion: '0.6.0', releaseDate: 'invalid-date', progress: { percent: 150, transferred: -1, total: 0, bytesPerSecond: 0 } });
    assert.equal(await dialog.getByRole('progressbar').getAttribute('value'), '100');
    assert.equal(await dialog.locator('time').count(), 0);
    await page.evaluate(() => window.__updateSetState({ currentVersion: '0.5.0', distribution: 'installed', status: 'downloading', progress: { percent: NaN, transferred: Infinity, total: 0, bytesPerSecond: NaN } }));
    await page.waitForFunction(() => document.querySelector('progress')?.value === 0);
    assert.equal((await dialog.innerText()).includes('NaN'), false); assert.equal((await dialog.innerText()).includes('Infinity'), false);
  });
  await record('narrow dark window keeps long notes and primary actions reachable with keyboard focus contained', async () => {
    await state({ status: 'available', availableVersion: '0.6.0', releaseNotes: '更新说明\n' + 'VeryLongUnbrokenReleaseNote'.repeat(40) });
    await page.setViewportSize({ width: 430, height: 650 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await dialog.getByRole('button', { name: '下载更新', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.waitForTimeout(150); // Existing button color transitions must settle before contrast and screenshot checks.
    const contrast = await dialog.getByRole('button', { name: '下载更新', exact: true }).evaluate(node => {
      const luminance = value => {
        const components = value.match(/[\d.]+/g).slice(0, 3).map(component => Number(component) / 255).map(component => component <= .04045 ? component / 12.92 : ((component + .055) / 1.055) ** 2.4);
        return components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
      };
      const style = getComputedStyle(node), a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    assert.ok(contrast >= 4.5, `primary action contrast ${contrast}`);
    await dialog.getByRole('button', { name: '下载更新', exact: true }).focus(); await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await dialog.getByRole('button', { name: '下载更新', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: `${output}/updates-dark-narrow.png`, fullPage: true });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '打开软件更新测试', exact: true }).evaluate(node => node === document.activeElement), true);
  });
  await record('initial information loading cannot dispatch updater actions before state is available', async () => {
    await page.getByRole('button', { name: '打开软件更新测试', exact: true }).click();
    await page.evaluate(() => window.__updateSetState(null));
    await dialog.getByText('正在读取更新信息…', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '检查更新', exact: true }).isDisabled(), true);
  });
  const appContext = await browser.newContext({ viewport: { width: 1120, height: 860 }, timezoneId: 'Asia/Bangkok' });
  await appContext.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await appContext.addInitScript(defaultSettings => {
    const mock = window.__appUpdates = { state: { currentVersion: '0.5.0', status: 'idle', distribution: 'installed' }, actions: [], listeners: new Set(), command: null, account: null, infoResolvers: [], external: [] };
    const ok = data => ({ ok: true, data });
    const push = window.__appUpdatePush = next => { mock.state = { ...mock.state, ...next }; for (const listener of mock.listeners) listener(structuredClone(mock.state)); };
    window.coolapk = {
      teenager: async operation => operation === 'info' ? ok({ enabled: false, blocked: false, reason: null, usedMilliseconds: 0, remainingMilliseconds: 2400000, limitMilliseconds: 2400000, day: '2026-10-04', lockedUntil: null }) : { ok: false, error: { code: 'TEST_UNSUPPORTED', message: '该测试仅模拟关闭的青少年模式' } },
      onTeenager: () => () => {},
      call: async operation => ok(operation === 'accountSettings' ? { data: { values: { ...defaultSettings }, present: Object.keys(defaultSettings), guardExpiresAt: null, replyLocked: false } } : { data: [], hasMore: false }), accounts: async () => ok({ accounts: [], current: null }), desktop: async () => ok({}),
      openExternal: async url => { mock.external.push(url); return ok({}); },
      onAccount: callback => { mock.account = callback; return () => { if (mock.account === callback) mock.account = null; }; },
      onCommand: callback => { mock.command = callback; return () => { if (mock.command === callback) mock.command = null; }; },
      onUpdates: callback => { mock.listeners.add(callback); return () => mock.listeners.delete(callback); },
      updates: async operation => {
        mock.actions.push(operation);
        if (operation === 'info') return await new Promise(resolve => mock.infoResolvers.push(resolve));
        if (operation === 'check') push({ status: 'checking' });
        if (operation === 'download') push({ status: 'downloading', progress: { percent: 0, transferred: 0, total: 100 * 1024 ** 2, bytesPerSecond: 0 } });
        if (operation === 'cancel') push({ status: 'available', progress: undefined });
        if (operation === 'install') push({ status: 'installing' });
        return ok(structuredClone(mock.state));
      },
    };
  }, DEFAULT_ACCOUNT_SETTINGS);
  const appPage = await appContext.newPage(); appPage.on('pageerror', error => errors.push(error.message));
  await appPage.goto(origin);
  const appDialog = appPage.getByRole('dialog', { name: '软件更新', exact: true });
  await appPage.waitForFunction(() => typeof window.__appUpdates.command === 'function' && window.__appUpdates.infoResolvers.length > 0);
  await record('real App listens for native update commands and ignores stale startup info after newer updater events', async () => {
    await appPage.evaluate(() => { window.__appUpdatePush({ status: 'available', availableVersion: '0.6.0', releaseNotes: '合成更新说明' }); window.__appUpdates.command('updates'); });
    await appDialog.getByText('版本 0.6.0', { exact: true }).waitFor();
    await appPage.evaluate(() => { for (const resolve of window.__appUpdates.infoResolvers) resolve({ ok: true, data: { currentVersion: '0.5.0', distribution: 'installed', status: 'idle' } }); });
    await appPage.waitForTimeout(50);
    await appDialog.getByRole('button', { name: '下载更新', exact: true }).waitFor();
    assert.equal(await appPage.locator('.workspace').evaluate(node => node.inert), true);
    assert.equal(await appPage.locator('.sidebar').evaluate(node => node.inert), true);
  });
  await record('real App Settings opens the same updater and download progress follows the fixed bridge', async () => {
    await appPage.keyboard.press('Escape'); await appDialog.waitFor({ state: 'hidden' });
    await appPage.locator('.sidebar').getByRole('button', { name: '设置', exact: true }).click();
    await appPage.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^软件更新/ }).click();
    await appDialog.getByRole('button', { name: '下载更新', exact: true }).click();
    await appDialog.getByRole('button', { name: '取消下载', exact: true }).waitFor();
    await appPage.waitForFunction(() => !document.querySelector('.software-update-actions button')?.disabled);
    await appDialog.getByRole('button', { name: '取消下载', exact: true }).focus();
    await appPage.evaluate(() => window.__appUpdatePush({ progress: { percent: 67, transferred: 67 * 1024 ** 2, total: 100 * 1024 ** 2, bytesPerSecond: 3 * 1024 ** 2 } }));
    await appPage.waitForFunction(() => document.querySelector('.software-update-download progress')?.value === 67);
    await appPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await appDialog.getByRole('button', { name: '取消下载', exact: true }).evaluate(node => node === document.activeElement), true, 'download progress must preserve keyboard focus on Cancel');
    assert.equal((await appPage.evaluate(() => window.__appUpdates.actions)).at(-1), 'download');
    await appPage.screenshot({ path: `${output}/app-downloading.png`, fullPage: true });
  });
  await record('real App retains software download across dialog closure and account events and cancels through IPC', async () => {
    await appPage.keyboard.press('Escape'); await appDialog.waitFor({ state: 'hidden' });
    await appPage.evaluate(() => { window.__appUpdates.account({ ok: true, data: { accounts: [], current: null } }); window.__appUpdates.command('updates'); });
    await appDialog.waitFor(); assert.equal(await appDialog.getByRole('progressbar').getAttribute('value'), '67');
    await appDialog.getByRole('button', { name: '取消下载', exact: true }).click();
    await appDialog.getByRole('button', { name: '下载更新', exact: true }).waitFor();
    assert.equal((await appPage.evaluate(() => window.__appUpdates.actions)).at(-1), 'cancel');
  });
  await record('real portable App exposes only the fixed repository release page for first installation', async () => {
    await appPage.evaluate(() => window.__appUpdatePush({ status: 'current', distribution: 'portable', availableVersion: undefined, progress: undefined }));
    await appDialog.getByRole('button', { name: '下载安装版', exact: true }).click();
    await appPage.waitForFunction(() => window.__appUpdates.external.length > 0);
    assert.deepEqual(await appPage.evaluate(() => window.__appUpdates.external), ['https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest']);
    assert.equal(await appDialog.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checkedAt: new Date().toISOString(), checks, errors }, null, 2));
  console.log(`PASS ${checks.length} updater UI checks`);
} catch (error) {
  const pages = browser?.contexts().flatMap(context => context.pages()) || [];
  if (pages[0]) await pages[0].screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally { await browser?.close(); await server.close(); }
