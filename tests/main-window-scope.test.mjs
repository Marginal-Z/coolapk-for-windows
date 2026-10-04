import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const { AccountScope } = createRequire(import.meta.url)('../electron/request-scope.cjs');
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

// Exercise the actual main-process window functions with held Electron awaits.
// Only the dynamic module import is substituted; no Electron, network, or account
// storage is started, and the initiating scope uses the production AccountScope.
function harness(name, next, { holdImport = false } = {}) {
  const cleanup = gate(), module = gate(), windows = [], requests = [], writes = [];
  const accountScope = new AccountScope();
  class Client {
    constructor(options = {}) { Object.assign(this, options); this.fetch = options.fetchImpl; }
    async request(...args) { requests.push(args); return { data: { uid: '101', username: 'synthetic' } }; }
  }
  const client = new Client({ identity: { uid: '101', username: 'synthetic' }, cookie: 'SESSID=synthetic-session' });
  class Window extends EventEmitter {
    constructor() {
      super(); this.dead = false; this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {}; this.webContents.getURL = () => this.url || '';
      this.webContents.executeJavaScript = async () => false; windows.push(this);
    }
    isDestroyed() { return this.dead; }
    close() { this.dead = true; this.emit('closed'); }
    loadURL(value) { this.url = value; return Promise.resolve(); }
  }
  const cookies = new EventEmitter(); cookies.get = async () => []; cookies.set = async () => {};
  const pageSession = { clearStorageData: () => cleanup.promise, cookies, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
  const teenagerAccess = { epoch: 0, enabled: false, assertChannel() { if (this.enabled) throw Object.assign(new Error('restricted'), { code: 'TEENAGER_RESTRICTED' }); } };
  const fakeModule = { sanitizeCookie: value => value, assertLogin: identity => { if (!identity?.uid) throw Error('guest'); } };
  if (!holdImport) module.release(fakeModule);
  const sandbox = {
    session: { fromPartition: () => pageSession }, BrowserWindow: Window, applicationIcon: '', main: null, loginWindow: undefined,
    client, accountScope, teenagerAccess, accountWindows: new Set(), randomUUID: () => 'synthetic-id',
    OfficialLoginFlow: class { constructor(options) { Object.assign(this, options); } },
    OfficialLoginPageMonitor: class { check() { return Promise.resolve(); } navigationStarted() {} },
    officialLoginUrl: () => 'https://account.coolapk.com/auth/login?type=coolapk',
    store: { add(...args) { writes.push(args); }, publicState: () => ({}) },
    notifyAccount() {}, __module: module.promise,
  };
  const begin = source.indexOf(`async function ${name}(`), end = source.indexOf(`async function ${next}(`, begin);
  assert.ok(begin >= 0 && end > begin);
  vm.createContext(sandbox);
  vm.runInContext(source.slice(begin, end).replaceAll("import('../core/client.mjs')", '__module') + `;globalThis.start=${name}`, sandbox);
  return {
    sandbox, windows, requests, writes, cleanup, releaseImport: () => module.release(fakeModule),
    transition(enabled) { teenagerAccess.enabled = enabled; teenagerAccess.epoch++; accountScope.changed(); for (const window of windows) if (!window.dead) window.close(); },
  };
}

test('official login preserves its initiating scope while clearing the session', async () => {
  const h = harness('createLoginWindow', 'installDownloaded');
  const opening = h.sandbox.start(); assert.equal(h.windows.length, 0);
  h.cleanup.release(); assert.equal((await opening).opened, true);
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].dead, false);
  assert.equal(h.windows[0].url, 'https://account.coolapk.com/auth/login?type=coolapk');
});

test('enabling teenager mode during login session cleanup creates no late login window', async () => {
  const h = harness('createLoginWindow', 'installDownloaded');
  const opening = h.sandbox.start(); h.transition(true); h.cleanup.release();
  await assert.rejects(opening, error => error.code === 'TEENAGER_RESTRICTED');
  assert.equal(h.windows.length, 0); assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
});

test('switching away and back during login cleanup still invalidates the opening request', async () => {
  const h = harness('createLoginWindow', 'installDownloaded');
  const opening = h.sandbox.start(); h.sandbox.accountScope.changed(); h.sandbox.accountScope.changed(); h.cleanup.release();
  await assert.rejects(opening, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(h.windows.length, 0);
});

test('a full teenager enable/disable cycle cannot revive an older login opening', async () => {
  const h = harness('createLoginWindow', 'installDownloaded');
  const opening = h.sandbox.start(); h.transition(true); h.transition(false); h.cleanup.release();
  await assert.rejects(opening, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(h.windows.length, 0);
});

test('login also checks the mode epoch independently and does not close a newer window', async () => {
  const h = harness('createLoginWindow', 'installDownloaded');
  const opening = h.sandbox.start(); h.sandbox.teenagerAccess.epoch++;
  const replacement = { closed: false, close() { this.closed = true; } }; h.sandbox.loginWindow = replacement; h.cleanup.release();
  await assert.rejects(opening, error => error.code === 'TEENAGER_RESTRICTED');
  assert.equal(h.windows.length, 0); assert.equal(replacement.closed, false);
});

test('account pages cannot be created after a held module import crosses a mode transition', async () => {
  const h = harness('openAccountPage', 'createLoginWindow', { holdImport: true });
  const opening = h.sandbox.start('security'); h.transition(true); h.releaseImport();
  await assert.rejects(opening, error => error.code === 'TEENAGER_RESTRICTED'); assert.equal(h.windows.length, 0);
});

test('account pages cannot silently attach to a different account after a held import', async () => {
  const h = harness('openAccountPage', 'createLoginWindow', { holdImport: true });
  const opening = h.sandbox.start('security'); h.sandbox.accountScope.changed(); h.releaseImport();
  await assert.rejects(opening, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(h.windows.length, 0);
});

test('an import initiated before teenager mode cannot validate or save a late session', async () => {
  const h = harness('importCookie', 'openLogin', { holdImport: true });
  const importing = h.sandbox.start('SESSID=synthetic-session'); h.transition(true); h.releaseImport();
  await assert.rejects(importing, error => error.code === 'TEENAGER_RESTRICTED');
  assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
});

test('switching accounts during a held session import cannot rebase its credential snapshot', async () => {
  const h = harness('importCookie', 'openLogin', { holdImport: true });
  const importing = h.sandbox.start('SESSID=synthetic-session'); h.sandbox.accountScope.changed(); h.releaseImport();
  await assert.rejects(importing, error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
});
