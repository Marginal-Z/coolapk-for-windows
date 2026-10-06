// Launch the unmodified packaged executable. Pause before its main script to
// install local read/image fixtures, so even startup cannot reach live services.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { deflateSync } from 'node:zlib';
import playwright from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, '.local', 'package-check'); mkdirSync(directory, { recursive: true });
const testData = mkdtempSync(join(directory, 'userdata-'));
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const executable = join(root, 'release', 'win-unpacked', `${metadata.build.productName}.exe`);
const reportPath = join(root, 'research', 'package-check.json');
const env = { ...process.env, COOLAPK_TEST_DATA: testData };
delete env.ELECTRON_RUN_AS_NODE; delete env.COOLAPK_DEV_URL;
const report = { checkedAt: new Date().toISOString(), status: 'running', mode: 'isolated unmodified packaged executable', executable, checks: [], errors: [], isolation: { userData: testData, network: 'blocked before packaged main executes', accounts: 'anonymous generated test store only', phone: 'disabled', updates: 'local status only; no check, download or install' } };
const brand = 'coolapk desktop', image = 'https://image.coolapk.com/package-check/image.png';
const feedId = '91901';
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
function raster(width, height) {
  const chunk = (name, data) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const index = y * (width * 3 + 1) + 1 + x * 3; pixels[index] = 24 + Math.floor(y / height * 140); pixels[index + 1] = 140; pixels[index + 2] = 88; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function unusedPort() {
  const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}

async function inspectorConnection(port) {
  const deadline = Date.now() + 15000; let target;
  while (Date.now() < deadline && !target) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json())[0]?.webSocketDebuggerUrl; } catch { /* Inspector is still starting. */ }
    if (!target) await new Promise(done => setTimeout(done, 100));
  }
  if (!target) throw new Error('Packaged Node inspector did not become available');
  const targetUrl = new URL(target); assert.equal(targetUrl.hostname, '127.0.0.1'); assert.equal(targetUrl.port, String(port));
  const socket = new WebSocket(target), pending = new Map(); let id = 0, resolvePaused;
  const paused = new Promise(done => { resolvePaused = done; });
  socket.addEventListener('message', event => {
    const response = JSON.parse(String(event.data));
    if (response.method === 'Debugger.paused') resolvePaused(response.params);
    const call = pending.get(response.id); if (!call) return;
    pending.delete(response.id); clearTimeout(call.timer); response.error ? call.reject(new Error(response.error.message)) : call.resolve(response.result);
  });
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  return {
    paused,
    send(method, params = {}) { return new Promise((resolveCall, reject) => { const callId = ++id, timer = setTimeout(() => { pending.delete(callId); reject(new Error('Inspector command timed out: ' + method)); }, 10000); pending.set(callId, { resolve: resolveCall, reject, timer }); socket.send(JSON.stringify({ id: callId, method, params })); }); },
    close() { socket.close(); for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Inspector connection closed')); } pending.clear(); },
  };
}

// This function is evaluated while --inspect-brk has stopped the real packaged
// main at entry. Electron documents this flag in its supported CLI switches.
function installFixture(fixture) {
  const { app, ipcMain, session } = require('electron');
  const fs = require('node:fs'), path = require('node:path');
  const mock = globalThis.packageCheck = { calls: [], unexpectedReads: [], blockedNodeNetwork: 0, blockedChromiumNetwork: 0, imageLoads: 0, installedBeforeWindows: false };
  mock.installedBeforeWindows = require('electron').BrowserWindow.getAllWindows().length === 0;
  for (const [name, relative] of [['appData', 'appData'], ['sessionData', 'session'], ['downloads', 'downloads'], ['crashDumps', 'crashDumps']]) { const target = path.join(fixture.testData, relative); fs.mkdirSync(target, { recursive: true }); app.setPath(name, target); }
  app.setPath('userData', fixture.testData);
  app.setAppLogsPath(path.join(fixture.testData, 'logs'));
  globalThis.fetch = async value => {
    if (String(value) === fixture.image) { mock.imageLoads++; return new Response(Buffer.from(fixture.png, 'base64'), { headers: { 'content-type': 'image/png' } }); }
    mock.blockedNodeNetwork++; throw new Error('External Node fetch blocked by packaged fixture');
  };
  for (const name of ['http', 'https']) { const transport = require('node:' + name); for (const method of ['request', 'get']) transport[method] = () => { mock.blockedNodeNetwork++; throw new Error('External Node transport blocked by packaged fixture'); }; }
  app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => { mock.blockedChromiumNetwork++; done({ cancel: true }); }));
  const register = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    if (channel === 'coolapk:phone') return register(channel, async (_, operation) => operation === 'status' ? { ok: true, data: { ready: false, devices: [], error: '' } } : { ok: false, error: { code: 'TEST_UNSUPPORTED', message: 'Phone operations disabled in package test' } });
    if (channel !== 'coolapk:call') return register(channel, handler);
    return register(channel, async (_, operation, args = {}) => {
      mock.calls.push({ operation, args });
      const reads = ['init', 'hotSearch', 'homeHotTopics', 'home', 'personalHomeBlocks', 'searchSuggestions', 'searchSuggestionsApp', 'notificationCount'];
      if (!reads.includes(operation)) { mock.unexpectedReads.push(operation); return { ok: false, error: { code: 'TEST_UNSUPPORTED', message: 'Only synthetic readonly calls allowed' } }; }
      const data = operation === 'home' ? [{ entityType: 'feed', id: fixture.feedId, uid: '42', username: '隔离安装包测试', message: '本地合成主页与原生图片窗口验收', picArr: [fixture.image], replynum: 0 }]
        : operation === 'personalHomeBlocks' ? { users: [], topics: [], products: [], keywords: [] } : operation === 'notificationCount' ? {} : [];
      return { ok: true, data: { data, surfaceItems: operation === 'home' ? data : [], hasMore: false } };
    });
  };
  return { pid: process.pid, installedBeforeWindows: mock.installedBeforeWindows };
}

let desktop, inspector, launchPromise, electronPid;
async function record(name, work) { await work(); report.checks.push(name); console.log('PASS', name); }
try {
  assert.equal(metadata.build.productName, brand); assert.equal(metadata.build.appId, 'local.coolapk.desktop'); assert.ok(existsSync(executable), 'Build release/win-unpacked before running package acceptance');
  const port = await unusedPort();
  // Keep launch pending while a separate loopback inspector installs fixtures.
  // No files inside the package or product source are modified by this test.
  launchPromise = playwright._electron.launch({ executablePath: executable, args: [`--inspect-brk=127.0.0.1:${port}`, '--disable-background-networking'], cwd: root, env, timeout: 30000 });
  launchPromise.catch(() => {});
  inspector = await inspectorConnection(port);
  await inspector.send('Runtime.enable'); await inspector.send('Debugger.enable'); await inspector.send('Runtime.runIfWaitingForDebugger');
  await Promise.race([inspector.paused, new Promise((_, reject) => setTimeout(() => reject(new Error('Packaged main did not stop before execution')), 10000))]);
  const installed = await inspector.send('Runtime.evaluate', { expression: `(${installFixture.toString()})(${JSON.stringify({ testData, image, png: raster(640, 360).toString('base64'), feedId })})`, includeCommandLineAPI: true, returnByValue: true });
  if (installed.exceptionDetails) throw new Error('Could not isolate packaged startup: ' + (installed.exceptionDetails.exception?.description || installed.exceptionDetails.text));
  electronPid = installed.result.value.pid; assert.equal(installed.result.value.installedBeforeWindows, true);
  await inspector.send('Debugger.resume'); inspector.close(); inspector = null;
  desktop = await launchPromise;
  const page = await desktop.firstWindow(); page.on('pageerror', failure => report.errors.push('main: ' + failure.message));
  await page.locator(`[data-feed-id="${feedId}"]`).waitFor();
  await page.waitForFunction(() => document.querySelector('.photo-button img')?.naturalWidth === 640);
  await record('packaged executable uses lowercase app, native window and HTML names with an isolated anonymous account store', async () => {
    const native = await desktop.evaluate(({ app, BrowserWindow }) => ({ name: app.getName(), windowTitle: BrowserWindow.getAllWindows()[0].getTitle(), packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() }));
    const state = await page.evaluate(async () => ({ bridge: !!window.coolapk, shareImageReader: typeof window.coolapk?.shareImageData === 'function', feeds: document.querySelectorAll('[data-feed-id]').length, accountState: await window.coolapk.accounts(), sandboxed: typeof window.require === 'undefined' && typeof window.process === 'undefined', title: document.title }));
    assert.equal(native.name, brand); assert.equal(native.windowTitle, brand); assert.equal(state.title, brand); assert.equal(native.packaged, true); assert.equal(native.version, metadata.version);
    assert.equal(resolve(native.userData).toLowerCase(), resolve(testData).toLowerCase()); assert.match(native.appPath, /app\.asar$/);
    assert.equal(native.preferences.sandbox, true); assert.equal(native.preferences.contextIsolation, true); assert.equal(native.preferences.nodeIntegration, false);
    assert.ok(state.bridge && state.shareImageReader && state.feeds === 1 && state.accountState.ok && state.sandboxed); assert.deepEqual(state.accountState.data.accounts, []); assert.equal(state.accountState.data.current, null);
    Object.assign(report, { bridge: state.bridge, shareImageReader: state.shareImageReader, feeds: state.feeds, accounts: true, sandboxed: state.sandboxed, title: state.title, name: native.name, windowTitle: native.windowTitle, version: native.version, electron: native.electron, chrome: native.chrome, appPath: native.appPath, packaged: true });
  });
  const openViewer = async () => {
    const opened = desktop.waitForEvent('window'); await page.getByRole('button', { name: '查看图片 1', exact: true }).click();
    const viewer = await opened; viewer.on('pageerror', failure => report.errors.push('viewer: ' + failure.message));
    await viewer.getByRole('heading', { name: '图片 1 / 1', exact: true }).waitFor();
    await viewer.waitForFunction(() => document.querySelector('.lightbox img')?.naturalWidth === 640); return viewer;
  };
  await record('packaged photo opens an independent sandboxed window with native-only close and a restricted bridge', async () => {
    const viewer = await openViewer();
    assert.equal((await desktop.windows()).length, 2); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await viewer.getByRole('button', { name: '关闭', exact: true }).count(), 0);
    assert.deepEqual(await viewer.evaluate(() => ({ require: typeof window.require, accounts: typeof window.coolapk.accounts, phone: typeof window.coolapk.phone, node: typeof window.process })), { require: 'undefined', accounts: 'undefined', phone: 'undefined', node: 'undefined' });
    const native = await desktop.evaluate(({ BrowserWindow }, title) => { const target = BrowserWindow.getAllWindows().find(window => window.getTitle() === title); const prefs = target.webContents.getLastWebPreferences(); return { title: target.getTitle(), closable: target.isClosable(), modal: target.isModal(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }; }, brand + ' · 图片');
    assert.deepEqual(native, { title: brand + ' · 图片', closable: true, modal: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
    const denied = await viewer.evaluate(() => window.coolapk.call('action', { type: 'like', id: '91901' })); assert.equal(denied.ok, false);
    await viewer.screenshot({ path: join(directory, 'image-window.png') });
    const closed = viewer.waitForEvent('close'); await desktop.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find(window => window.getTitle() === title).close(), brand + ' · 图片'); await closed;
    assert.equal((await desktop.windows()).length, 1); report.independentImageWindow = true; report.nativeClose = true;
  });
  await record('Escape closes a reopened packaged viewer and the main search remains editable after both closes', async () => {
    const input = page.getByLabel('搜索酷安', { exact: true }); await input.fill('原生关闭后仍可输入'); assert.equal(await input.inputValue(), '原生关闭后仍可输入'); await input.fill('');
    const viewer = await openViewer(), closed = viewer.waitForEvent('close'); await viewer.keyboard.press('Escape').catch(failure => { if (!viewer.isClosed()) throw failure; }); await closed;
    assert.equal((await desktop.windows()).length, 1); assert.equal(await page.getByRole('dialog').count(), 0);
    await input.fill('Escape 后仍可输入'); assert.equal(await input.inputValue(), 'Escape 后仍可输入'); await input.fill('');
    assert.equal(await input.evaluate(node => !!node.closest('[inert]')), false); report.escapeClose = true; report.mainEditableAfterClose = true;
    await page.screenshot({ path: join(directory, 'home.png') });
  });
  await record('packaged About and software update status both display the lowercase brand without checking online', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.getByRole('button', { name: /^关于酷安/ }).click();
    await settings.getByRole('heading', { name: brand, exact: true }).waitFor();
    await settings.getByRole('button', { name: '检查软件更新', exact: true }).click();
    const updates = page.getByRole('dialog', { name: '软件更新', exact: true }); await updates.getByRole('heading', { name: brand, exact: true }).waitFor();
    assert.equal(await updates.locator('.software-update-heading h3').textContent(), brand);
    await updates.getByRole('button', { name: '关闭', exact: true }).click(); report.softwareUpdateBrand = brand;
  });
  report.fixture = await desktop.evaluate(() => globalThis.packageCheck);
  assert.deepEqual(report.fixture.unexpectedReads, []); assert.equal(report.fixture.blockedNodeNetwork, 0); assert.equal(report.fixture.blockedChromiumNetwork, 0); assert.ok(report.fixture.imageLoads >= 1);
  assert.deepEqual(report.errors, []); report.status = 'passed'; console.log('PACKAGED_APP_PASS', JSON.stringify({ version: report.version, checks: report.checks.length, title: report.title, independentImageWindow: report.independentImageWindow, nativeClose: report.nativeClose, escapeClose: report.escapeClose, mainEditableAfterClose: report.mainEditableAfterClose }));
} catch (failure) {
  report.status = 'failed'; report.failure = failure.stack || failure.message; throw failure;
} finally {
  inspector?.close();
  if (!desktop && launchPromise) desktop = await launchPromise.catch(() => null);
  try { if (desktop) await desktop.close(); }
  finally {
    if (electronPid) { try { process.kill(electronPid); } catch (failure) { if (failure.code !== 'ESRCH') throw failure; } }
    mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
}
