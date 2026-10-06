// Real built App, Electron main and normal storage setup under isolated D-drive
// appData. Business IPC is synthetic; no real account or external service is used.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import electron from 'electron';
import playwright from 'playwright';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from '../core/preferences.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.local', 'branding-native');
mkdirSync(directory, { recursive: true });
const runDirectory = mkdtempSync(path.join(directory, 'run-'));
const fakeAppData = path.join(runDirectory, 'appData');
const fakeDownloads = path.join(runDirectory, 'downloads');
const legacyUserData = path.join(fakeAppData, '酷安桌面端');
mkdirSync(fakeAppData, { recursive: true });
mkdirSync(fakeDownloads, { recursive: true });
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const reportPath = path.join(root, 'research', 'branding-native-checks.json');
const report = { mode: 'isolated actual Electron and built App', status: 'running', checks: [], errors: [], cases: {}, isolation: { appData: fakeAppData, downloads: fakeDownloads, normalStorageBranch: true, realAccountData: 'not accessed', accounts: 'anonymous generated store only', network: 'Chromium HTTP(S) and Node fetch blocked; business IPC synthetic' } };
const brand = 'coolapk desktop';
const preferences = { ...DEFAULT_PREFERENCES, followSystem: false, theme: 'dark', palette: 'teal', fontSize: 'small' };
const draftsKey = 'coolapk-drafts:guest';
const drafts = [{ id: 'branding-preservation-marker', message: '隔离品牌启动测试的本机文字草稿', savedAt: 1700000000000 }];
const markerFiles = [
  ['account-preservation.marker', 'ordinary marker beside the anonymous account store'],
  [path.join('Local Storage', 'settings-preservation.marker'), 'ordinary marker beside Chromium settings storage'],
  ['drafts-preservation.marker', 'ordinary marker beside Chromium guest draft storage'],
];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.COOLAPK_TEST_DATA;
delete env.COOLAPK_DEV_URL;

writeFileSync(path.join(runDirectory, 'package.json'), JSON.stringify({ name: packageMetadata.name, version: packageMetadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(runDirectory, 'bootstrap.cjs'), `
const { app, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
delete process.env.COOLAPK_TEST_DATA;
delete process.env.COOLAPK_DEV_URL;
app.setPath('appData', ${JSON.stringify(fakeAppData)});
app.setPath('downloads', ${JSON.stringify(fakeDownloads)});
app.disableHardwareAcceleration();
fs.writeFileSync(path.join(__dirname, 'electron-pid.json'), JSON.stringify({ pid: process.pid, executable: process.execPath, bootstrap: __filename }));
globalThis.brandingNative = { businessCalls: [], blockedChromiumNetwork: 0, blockedNodeNetwork: 0 };
globalThis.fetch = async () => { globalThis.brandingNative.blockedNodeNetwork++; throw new Error('Isolated branding test blocks network'); };
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, reply) => { globalThis.brandingNative.blockedChromiumNetwork++; reply({ cancel: true }); }));
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === 'coolapk:phone') return register(channel, async (_, operation) => operation === 'status' ? { ok: true, data: { ready: false, devices: [], error: '' } } : { ok: false, error: { code: 'TEST_UNSUPPORTED', message: 'Phone operations disabled in branding test' } });
  if (channel === 'coolapk:call') return register(channel, async (_, operation) => {
    globalThis.brandingNative.businessCalls.push(operation);
    const reads = ['init', 'home', 'hotSearch', 'homeHotTopics', 'personalHomeBlocks', 'notificationCount'];
    if (!reads.includes(operation)) return { ok: false, error: { code: 'TEST_UNSUPPORTED', message: 'Only synthetic initial business reads allowed' } };
    const data = operation === 'personalHomeBlocks' ? { users: [], topics: [], products: [], keywords: [] } : operation === 'notificationCount' ? {} : [];
    return { ok: true, data: { data, surfaceItems: [], hasMore: false } };
  });
  return register(channel, handler);
};
require(${JSON.stringify(path.join(root, 'electron', 'main.cjs'))});
`);

async function record(name, work) {
  await work(); report.checks.push(name); console.log('PASS', name);
}
const samePath = (actual, expected) => assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

async function launchCase(name, work) {
  let desktop;
  try {
    desktop = await playwright._electron.launch({ executablePath: electron, args: [runDirectory], env, timeout: 30000 });
    const page = await desktop.firstWindow();
    page.on('pageerror', failure => report.errors.push(name + ': ' + failure.message));
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).waitFor();
    const metadata = await desktop.evaluate(({ app, BrowserWindow, session }) => ({
      name: app.getName(), version: app.getVersion(), appData: app.getPath('appData'), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), downloads: app.getPath('downloads'), windowTitle: BrowserWindow.getAllWindows()[0].getTitle(), testDataOverride: !!process.env.COOLAPK_TEST_DATA, development: !app.isPackaged, normalSession: BrowserWindow.getAllWindows()[0].webContents.session === session.defaultSession,
    }));
    report.cases[name] = metadata;
    assert.equal(metadata.name, brand); assert.equal(metadata.windowTitle, brand); assert.equal(await page.title(), brand);
    assert.equal(metadata.version, packageMetadata.version); assert.equal(metadata.testDataOverride, false); assert.equal(metadata.development, true); assert.equal(metadata.normalSession, true);
    samePath(metadata.appData, fakeAppData); samePath(metadata.userData, legacyUserData); samePath(metadata.sessionData, legacyUserData); samePath(metadata.downloads, fakeDownloads);
    await work({ desktop, page });
    report.cases[name].network = await desktop.evaluate(() => ({ blockedChromiumNetwork: globalThis.brandingNative.blockedChromiumNetwork, blockedNodeNetwork: globalThis.brandingNative.blockedNodeNetwork, businessCalls: globalThis.brandingNative.businessCalls }));
    await desktop.evaluate(({ session }) => session.defaultSession.flushStorageData());
  } finally {
    if (desktop) {
      const child = desktop.process();
      try { await desktop.close(); } finally { if (child.exitCode == null && child.signalCode == null) child.kill(); }
    } else if (existsSync(path.join(runDirectory, 'electron-pid.json'))) {
      // The bootstrap records only this run's Electron PID. A launch timeout
      // must not leave our native child running or touch another application.
      const child = JSON.parse(readFileSync(path.join(runDirectory, 'electron-pid.json'), 'utf8'));
      if (path.resolve(child.bootstrap) === path.join(runDirectory, 'bootstrap.cjs') && path.resolve(child.executable).toLowerCase() === path.resolve(electron).toLowerCase()) {
        try { process.kill(child.pid); } catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      }
    }
  }
}

try {
  await record('lowercase display branding keeps the established application id and built HTML title', async () => {
    assert.equal(packageMetadata.build.productName, brand); assert.equal(packageMetadata.build.appId, 'local.coolapk.desktop');
    for (const relative of ['index.html', path.join('dist', 'index.html')]) assert.equal(readFileSync(path.join(root, relative), 'utf8').match(/<title>([^<]+)<\/title>/)?.[1], brand);
    assert.equal(existsSync(legacyUserData), false);
  });
  await record('fresh normal startup creates legacy storage under fake appData and shows lowercase native and UI names', async () => {
    await launchCase('fresh', async ({ page }) => {
      assert.ok(existsSync(legacyUserData)); assert.ok(existsSync(path.join(legacyUserData, 'accounts.encrypted')));
      const accounts = await page.evaluate(() => window.coolapk.accounts());
      assert.equal(accounts.ok, true); assert.deepEqual(accounts.data.accounts, []); assert.equal(accounts.data.current, null);
      await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      await settings.getByRole('button', { name: /^关于酷安/ }).click();
      await settings.getByRole('heading', { name: brand, exact: true }).waitFor();
      await page.evaluate(({ preferences, preferencesKey, draftsKey, drafts }) => {
        localStorage.setItem(preferencesKey, JSON.stringify(preferences)); localStorage.setItem(draftsKey, JSON.stringify(drafts));
      }, { preferences, preferencesKey: PREFERENCES_KEY, draftsKey, drafts });
    });
    for (const [relative, content] of markerFiles) { const file = path.join(legacyUserData, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); }
  });
  const accountHash = hash(path.join(legacyUserData, 'accounts.encrypted'));
  await record('existing legacy account file, settings, guest drafts and ordinary markers survive renamed startup', async () => {
    await launchCase('existing', async ({ desktop, page }) => {
      assert.equal(hash(path.join(legacyUserData, 'accounts.encrypted')), accountHash);
      for (const [relative, content] of markerFiles) assert.equal(readFileSync(path.join(legacyUserData, relative), 'utf8'), content);
      const saved = await page.evaluate(({ preferencesKey, draftsKey }) => ({ preferences: JSON.parse(localStorage.getItem(preferencesKey)), drafts: JSON.parse(localStorage.getItem(draftsKey)), theme: document.documentElement.dataset.theme }), { preferencesKey: PREFERENCES_KEY, draftsKey });
      assert.deepEqual(saved.preferences, preferences); assert.deepEqual(saved.drafts, drafts); assert.equal(saved.theme, 'dark');
      const accounts = await page.evaluate(() => window.coolapk.accounts()); assert.equal(accounts.ok, true); assert.deepEqual(accounts.data.accounts, []); assert.equal(accounts.data.current, null);
      assert.ok(Math.abs(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()) - .9) < .001);
      await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.getByRole('button', { name: /^关于酷安/ }).click();
      await settings.getByRole('heading', { name: brand, exact: true }).waitFor();
      await page.screenshot({ path: path.join(runDirectory, 'existing-about.png') });
      report.cases.existing.preservation = { accountFileBytes: 'unchanged anonymous encrypted store', settings: 'same stored preferences and applied dark theme / small font', drafts: 'same guest localStorage text draft', ordinaryMarkers: markerFiles.map(([relative]) => relative) };
    });
    assert.equal(existsSync(path.join(fakeAppData, brand)), false, 'display name must not create a replacement userData directory');
  });
  assert.deepEqual(report.errors, []); report.status = 'passed';
} catch (failure) {
  report.status = 'failed'; report.failure = failure.stack || failure.message; throw failure;
} finally {
  mkdirSync(path.dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
