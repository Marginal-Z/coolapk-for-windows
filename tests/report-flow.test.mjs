import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildReportRoute, allowedReportNavigation, ReportWindowManager } = require('../electron/report-flow.cjs');
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const context = () => ({ epoch: 0, client: { identity: { uid: '12345' }, cookie: 'SESSID=synthetic-session; token=synthetic-token; uid=12345' } });
class FakeWindow extends EventEmitter {
  constructor(options, load) { super(); this.options = options; this.loads = []; this.dead = false; this.forced = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; }; this.load = load; }
  isDestroyed() { return this.dead; }
  async loadURL(url) { this.loads.push(url); await this.load?.(url); }
  close() { if (!this.dead) { this.dead = true; this.emit('closed'); } }
  destroy() { this.forced = true; this.close(); }
}
function setup({ setCookie, load } = {}) {
  const state = { epoch: 0, windows: [], sessions: [], refreshed: 0, nextId: 0 };
  const manager = new ReportWindowManager({
    createWindow: options => { const window = new FakeWindow(options, load); state.windows.push(window); return window; },
    createSession: partition => { const page = new EventEmitter(); Object.assign(page, { partition, values: [], clears: 0, cacheClears: 0, cookies: { set: async cookie => { page.values.push(cookie); await setCookie?.(cookie); } }, clearStorageData: async () => { page.clears++; }, clearCache: async () => { page.cacheClears++; }, setPermissionRequestHandler: fn => { page.requestPermission = fn; }, setPermissionCheckHandler: fn => { page.checkPermission = fn; } }); state.sessions.push(page); return page; },
    assertCurrent: captured => { if (state.epoch !== captured.epoch) throw Object.assign(new Error('account changed'), { code: 'ACCOUNT_CHANGED' }); },
    parent: () => 'synthetic-parent', icon: 'synthetic-icon.ico', onClosed: () => { state.refreshed++; }, makeId: () => 'synthetic-' + ++state.nextId,
  });
  return { state, manager };
}

test('report targets construct only verified official routes and preserve article/reply types', () => {
  for (const type of ['feed', 'article', 'feed_reply']) assert.equal(buildReportRoute({ type, id: '123' }), `https://m.coolapk.com/mp/do?c=feed&m=report&type=${type}&id=123`);
  assert.equal(buildReportRoute({ type: 'user', id: '456' }), 'https://m.coolapk.com/mp/do?c=user&m=report&id=456');
  assert.equal(buildReportRoute({ type: 'apk', packageName: 'com.example.synthetic_app' }), 'https://m.coolapk.com/mp/apk/report?apkname=com.example.synthetic_app');
  for (const target of [null, [], { type: 'unknown', id: '123' }, { type: 'feed', id: 123 }, { type: 'feed', id: '0' }, { type: 'feed', id: '001' }, { type: 'user', id: '1&c=other' }, { type: 'feed', id: '123', url: 'https://evil.test' }, { type: 'apk', packageName: 'com.example/app' }, { type: 'apk', packageName: 'com.example?other=1' }, { type: 'apk', packageName: 'com..example' }, { type: 'apk', packageName: 'com.example', id: '123' }]) assert.throws(() => buildReportRoute(target), error => error.code === 'INPUT');
});

test('official form redirects allow exact HTTPS origins without credentials or arbitrary subdomains', () => {
  for (const url of ['https://m.coolapk.com/mp/do?c=feed&m=report', 'https://account.coolapk.com/auth/login', 'https://www.coolapk.com/feed/123']) assert.equal(allowedReportNavigation(url), true);
  for (const url of ['http://m.coolapk.com/mp/do', 'https://m.coolapk.com.evil.test/mp/do', 'https://evil.test/', 'https://api.coolapk.com/v6/feed/createFeed', 'https://sub.m.coolapk.com/mp/do', 'https://m.coolapk.com:444/mp/do', 'https://other@m.coolapk.com/mp/do', 'javascript:alert(1)', 'file:///synthetic', 'about:blank']) assert.equal(allowedReportNavigation(url), false);
});

test('report windows use unique memory sessions, sandboxed pages and existing account snapshots', async () => {
  const { state, manager } = setup(), captured = context();
  assert.deepEqual(await manager.open({ type: 'feed', id: '123' }, captured), { opened: true });
  assert.deepEqual(await manager.open({ type: 'user', id: '456' }, captured), { opened: true });
  const window = state.windows[0], page = state.sessions[0];
  assert.notEqual(state.sessions[0].partition, state.sessions[1].partition); assert.ok(state.sessions.every(session => session.partition.startsWith('coolapk-report-') && !session.partition.startsWith('persist:')));
  assert.deepEqual(window.options.webPreferences, { session: page, sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(window.options.parent, 'synthetic-parent'); assert.equal(window.loads.length, 1); assert.equal(window.loads[0], buildReportRoute({ type: 'feed', id: '123' }));
  assert.equal(page.values.find(value => value.name === 'SESSID').value, 'synthetic-session'); assert.ok(page.values.every(value => value.secure && value.domain === '.coolapk.com' && value.url === 'https://m.coolapk.com'));
  assert.ok(page.values.find(value => value.name === 'token').httpOnly); assert.equal(page.checkPermission(), false);
  let permitted; page.requestPermission(null, 'camera', value => { permitted = value; }); assert.equal(permitted, false);
  let downloadPrevented = false; page.emit('will-download', { preventDefault() { downloadPrevented = true; } }); assert.equal(downloadPrevented, true);
  window.close(); await Promise.resolve(); assert.equal(manager.windows.size, 1); assert.ok(page.clears > 0); assert.equal(state.refreshed, 1);
});

test('guest or malformed targets cannot create a window or read the session', async () => {
  const { state, manager } = setup();
  for (const captured of [{ epoch: 0, client: { identity: null } }, { epoch: 0, client: { identity: { uid: '0' } } }, { epoch: 0, client: { identity: { uid: '10000' }, cookie: 'SESSID=synthetic-session' } }, { epoch: 0, client: { identity: { uid: '123' }, cookie: 'SESSID=deleted' } }, { epoch: 0, client: { identity: { uid: '123' }, cookie: 'SESSID=synthetic\r\nInjected: value' } }]) await assert.rejects(manager.open({ type: 'feed', id: '123' }, captured), error => error.code === 'LOGIN_REQUIRED');
  await assert.rejects(manager.open({ type: 'feed', id: '123', reason: 'automatic submission forbidden' }, context()), error => error.code === 'INPUT');
  assert.equal(state.windows.length, 0); assert.equal(state.sessions.length, 0);
});

test('navigation and popup events deny unsafe URLs and stop old account windows', async () => {
  const { state, manager } = setup(); await manager.open({ type: 'feed_reply', id: '123' }, context()); const window = state.windows[0];
  for (const eventName of ['will-navigate', 'will-redirect']) for (const url of ['https://evil.test/', 'https://account.coolapk.com/auth/login']) {
    let prevented = false; window.webContents.emit(eventName, { preventDefault() { prevented = true; } }, url); assert.equal(prevented, url.includes('evil.test'));
  }
  assert.deepEqual(window.openHandler({ url: 'https://evil.test/' }), { action: 'deny' }); assert.equal(window.loads.length, 1);
  assert.deepEqual(window.openHandler({ url: 'https://m.coolapk.com/mp/do?c=feed&m=report&id=123' }), { action: 'deny' }); assert.equal(window.loads.length, 2);
  state.epoch++; let prevented = false; window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://m.coolapk.com/mp/do'); assert.equal(prevented, true);
  manager.closeAll(); assert.ok(window.isDestroyed() && window.forced); assert.equal(state.refreshed, 0); assert.equal(manager.windows.size, 0);
});

test('account changes and closed windows reject pending cookie and page loads without reporting success', async () => {
  for (const phase of ['cookie', 'load']) {
    const pending = gate(); const { state, manager } = setup(phase === 'cookie' ? { setCookie: () => pending.promise } : { load: () => pending.promise });
    const opening = manager.open({ type: 'feed', id: '123' }, context());
    for (let i = 0; i < 8; i++) await Promise.resolve(); state.epoch++; manager.closeAll(); pending.release();
    await assert.rejects(opening, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(manager.windows.size, 0); assert.ok(state.sessions[0].clears >= 2); assert.equal(state.refreshed, 0);
    if (phase === 'cookie') assert.equal(state.windows[0].loads.length, 0);
  }
  const pending = gate(); const { state, manager } = setup({ load: () => pending.promise }); const opening = manager.open({ type: 'user', id: '123' }, context());
  for (let i = 0; i < 8; i++) await Promise.resolve(); state.windows[0].close(); pending.release(); await assert.rejects(opening, error => error.code === 'REPORT_CLOSED');
});

test('session or page failures clear credentials and return only a fixed public error', async () => {
  for (const phase of ['cookie', 'load']) {
    const fail = async () => { throw new Error('synthetic-private-session-value'); };
    const { state, manager } = setup(phase === 'cookie' ? { setCookie: fail } : { load: fail });
    await assert.rejects(manager.open({ type: 'feed', id: '123' }, context()), error => error.code === 'REPORT_ERROR' && !error.message.includes('synthetic-private'));
    assert.equal(manager.windows.size, 0); assert.ok(state.windows[0].forced); assert.ok(state.sessions[0].clears > 0);
  }
});

test('main IPC is trusted, closes reports on account change and uses non-persistent sessions', () => {
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /handler\('coolapk:report', target => reportWindows\.open\(target, accountScope\.capture\(client\)\)\)/);
  assert.match(main, /function notifyAccount\(\)[^\n]*accountScope\.changed\(\)[^\n]*reportWindows\?\.closeAll\(\)/);
  assert.match(main, /createSession: partition => session\.fromPartition\(partition, \{ cache: false \}\)/);
  assert.match(main, /event\.sender !== main\.webContents \|\| event\.senderFrame !== main\.webContents\.mainFrame/);
  const flow = readFileSync(new URL('../electron/report-flow.cjs', import.meta.url), 'utf8');
  for (const forbidden of ['executeJavaScript', 'preload:', 'shell.openExternal', 'persist:', 'fetch(', 'cookies.get', 'webRequest', 'localStorage', 'sessionStorage']) assert.ok(!flow.includes(forbidden), forbidden);
});
