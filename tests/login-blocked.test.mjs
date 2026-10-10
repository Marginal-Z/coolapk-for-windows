import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OfficialLoginPageMonitor, LOGIN_BLOCK_PROBE, LOGIN_BLOCKED_ERROR, officialLoginUrl, officialLoginDiagnosticUrl } = require('../electron/login-flow.cjs');
const loginURL = 'https://account.coolapk.com/auth/login?type=coolapk';
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
function pageProbe(text, { url = loginURL, hidden = false } = {}) {
  const location = new URL(url), safeParent = { closest: () => hidden, getClientRects: () => [1] };
  const protectedParent = { closest: () => true, getClientRects: () => [1] };
  const nodes = [{ parentElement: protectedParent, get textContent() { throw new Error('form text must not be read'); } }, { parentElement: safeParent, textContent: text }];
  // Mirrors the browser TreeWalker filter before exposing a text node to the probe.
  const document = { body: {}, createTreeWalker(root, what, filter) { assert.equal(root, document.body); assert.equal(what, 4); let index = 0; return { nextNode() { while (index < nodes.length) { const node = nodes[index++]; if (filter.acceptNode(node) === 1) return node; } return null; } }; } };
  Object.defineProperties(document, { cookie: { get() { throw new Error('Cookie access denied'); } }, forms: { get() { throw new Error('form access denied'); } } });
  const storage = new Proxy({}, { get() { throw new Error('storage access denied'); } });
  return vm.runInNewContext(LOGIN_BLOCK_PROBE, { location, document, NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 }, localStorage: storage, sessionStorage: storage });
}
function setup(overrides = {}) {
  const state = { active: true, url: loginURL, inspections: 0, errors: [] };
  const monitor = new OfficialLoginPageMonitor({ getURL: () => state.url, inspect: async script => { state.inspections++; assert.equal(script, LOGIN_BLOCK_PROBE); return true; }, isActive: () => state.active, onBlocked: error => state.errors.push(error), ...overrides });
  return { state, monitor };
}

test('login uses the exact APK normal entry without an unverified fixed forward or browser impersonation', () => {
  const url = new URL(officialLoginUrl());
  assert.equal(url.href, 'https://account.coolapk.com/auth/login?type=coolapk');
  assert.deepEqual([...url.searchParams], [['type', 'coolapk']]);
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const loginSource = main.slice(main.indexOf('async function createLoginWindow()'), main.indexOf('async function installDownloaded'));
  assert.match(loginSource, /window\.loadURL\(officialLoginUrl\(\)\)/);
  assert.match(loginSource, /partition:\s*'persist:coolapk-official-login'/);
  assert.ok(!loginSource.includes('clearStorageData'), 'reopening the official login window must retain its trusted session');
  assert.ok(!loginSource.includes('setUserAgent')); assert.ok(!loginSource.includes('forward:')); assert.ok(!loginSource.includes('auth_callback'));
});

test('login block diagnostics inspect only exact HTTPS official login or callback routes', async () => {
  for (const url of ['https://account.coolapk.com/auth/login', 'https://account.coolapk.com/auth/callback?ac=access_token&code=synthetic']) assert.equal(officialLoginDiagnosticUrl(url), true);
  for (const url of ['http://account.coolapk.com/auth/login', 'https://account.coolapk.com.evil.test/auth/login', 'https://evil.test/auth/login', 'https://www.coolapk.com/auth/login', 'https://open.weixin.qq.com/auth/login', 'https://other@account.coolapk.com/auth/login', 'https://account.coolapk.com:444/auth/login', 'https://account.coolapk.com/account', 'about:blank', 'invalid']) {
    assert.equal(officialLoginDiagnosticUrl(url), false);
    const { state, monitor } = setup(); state.url = url; assert.equal(await monitor.check(), false); assert.equal(state.inspections, 0); assert.deepEqual(state.errors, []);
  }
});

test('the browser probe returns only a boolean and needs EdgeOne, 567 and the policy message together', () => {
  assert.equal(pageProbe('EdgeOne 567 请求已被站点的安全策略拦截'), true);
  assert.equal(pageProbe('EdgeOne 567 请求已被站点的 安全策略拦截'), true);
  assert.equal(pageProbe('EdgeOne 567 Request has been blocked by the site security policy'), true);
  for (const text of ['登录酷安', '567 请求已被站点的安全策略拦截', 'EdgeOne 请求已被站点的安全策略拦截', 'EdgeOne 567 网络异常', 'EdgeOne 567 请求已被站点的安全策略拦截']) {
    const result = pageProbe(text, { hidden: text.startsWith('EdgeOne 567 请求') }); assert.equal(result, false); assert.equal(typeof result, 'boolean');
  }
  assert.equal(pageProbe('EdgeOne 567 请求已被站点的安全策略拦截', { url: 'https://evil.test/auth/login' }), false);
});

test('duplicate load notifications emit one fixed diagnostic per main frame navigation', async () => {
  const { state, monitor } = setup(); await Promise.all([monitor.check(), monitor.check()]);
  assert.deepEqual(state.errors, [LOGIN_BLOCKED_ERROR]);
  assert.deepEqual(Object.keys(state.errors[0]).sort(), ['code', 'message']); assert.equal(state.errors[0].code, 'LOGIN_BLOCKED');
  assert.equal(await monitor.check(), false); monitor.navigationStarted(); assert.equal(await monitor.check(), true); assert.equal(state.errors.length, 2);
});

test('closed windows, changed accounts and navigations discard in-flight page diagnostics', async () => {
  for (const change of [state => { state.active = false; }, state => { state.url = 'https://account.coolapk.com/auth/callback'; }, (_, monitor) => monitor.navigationStarted()]) {
    const pending = gate(); const { state, monitor } = setup({ inspect: async () => pending.promise });
    const checking = monitor.check(); change(state, monitor); pending.release(true); assert.equal(await checking, false); assert.deepEqual(state.errors, []);
  }
  const { state, monitor } = setup(); state.active = false; assert.equal(await monitor.check(), false); assert.equal(state.inspections, 0);
});

test('failed probes and non-boolean values never turn into a login block or authentication success', async () => {
  for (const inspect of [async () => false, async () => 'true', async () => ({ blocked: true, identity: 'synthetic' }), async () => { throw new Error('page changed'); }]) {
    const { state, monitor } = setup({ inspect }); assert.equal(await monitor.check(), false); assert.deepEqual(state.errors, []);
  }
});

test('login source keeps its sandbox and trusted event checks; diagnostics have no sensitive browser APIs', () => {
  for (const forbidden of ['.value', 'document.cookie', 'localStorage', 'sessionStorage', 'innerHTML', 'outerHTML', 'fetch(', 'XMLHttpRequest', 'querySelector', 'location.search', 'location.hash']) assert.ok(!LOGIN_BLOCK_PROBE.includes(forbidden), forbidden);
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const loginSource = main.slice(main.indexOf('async function createLoginWindow()'), main.indexOf('async function installDownloaded'));
  assert.match(loginSource, /sandbox: true, contextIsolation: true, nodeIntegration: false/);
  assert.match(loginSource, /isActive: \(\) => isActive\(\) && !flow\.finished/);
  assert.match(loginSource, /getURL: \(\) => window\.webContents\.getURL\(\)/);
  assert.match(loginSource, /inspect: script => window\.webContents\.executeJavaScript\(script\)/);
  assert.match(loginSource, /did-start-navigation[^\n]*isMainFrame[^\n]*pageMonitor\.navigationStarted/);
  assert.match(main, /event\.sender !== main\.webContents \|\| event\.senderFrame !== main\.webContents\.mainFrame/);
  assert.match(loginSource, /will-navigate[^\n]*allowedNavigation\(url\)[^\n]*event\.preventDefault/);
  assert.match(loginSource, /will-redirect[^\n]*allowedNavigation\(url\)[^\n]*event\.preventDefault/);
});
