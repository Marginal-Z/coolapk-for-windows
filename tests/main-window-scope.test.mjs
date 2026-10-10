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
function harness(name, next = null, { holdImport = false, holdLoad = false } = {}) {
  const module = gate(), load = gate(), windows = [], requests = [], writes = [], partitions = [];
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
    loadURL(value) { this.url = value; return holdLoad ? load.promise : Promise.resolve(); }
  }
  const cookies = new EventEmitter(); cookies.get = async () => []; cookies.set = async () => {};
  let storageClears = 0;
  const pageSession = { clearStorageData: () => { storageClears++; return Promise.resolve(); }, cookies, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
  const teenagerAccess = { epoch: 0, enabled: false, assertChannel() { if (this.enabled) throw Object.assign(new Error('restricted'), { code: 'TEENAGER_RESTRICTED' }); } };
  const fakeModule = { sanitizeCookie: value => value, assertLogin: identity => { if (!identity?.uid) throw Error('guest'); } };
  if (!holdImport) module.release(fakeModule);
  const sandbox = {
    session: { fromPartition: partition => { partitions.push(partition); return pageSession; } }, BrowserWindow: Window, applicationIcon: '', main: null, loginWindow: undefined,
    client, accountScope, teenagerAccess, accountWindows: new Set(), randomUUID: () => 'synthetic-id',
    OfficialLoginFlow: class { constructor(options) { Object.assign(this, options); } },
    OfficialLoginPageMonitor: class { check() { return Promise.resolve(); } navigationStarted() {} },
    officialLoginUrl: () => 'https://account.coolapk.com/auth/login?type=coolapk',
    store: { add(...args) { writes.push(args); }, publicState: () => ({}) },
    notifyAccount() {}, __module: module.promise,
  };
  const begin = source.indexOf(`async function ${name}(`), end = next
    ? source.indexOf(`async function ${next}(`, begin)
    : source.indexOf('\napp.whenReady().then', begin);
  assert.ok(begin >= 0 && end > begin);
  vm.createContext(sandbox);
  vm.runInContext(source.slice(begin, end).replaceAll("import('../core/client.mjs')", '__module') + `;globalThis.start=${name}`, sandbox);
  return {
    sandbox, windows, requests, writes, partitions, storageClears: () => storageClears, releaseLoad: () => load.release(), releaseImport: () => module.release(fakeModule),
    transition(enabled) { teenagerAccess.enabled = enabled; teenagerAccess.epoch++; accountScope.changed(); for (const window of windows) if (!window.dead) window.close(); },
  };
}

test('official login reuses its persistent session without clearing stored cookies', async () => {
  const h = harness('createLoginWindow');
  assert.equal((await h.sandbox.start()).opened, true);
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].dead, false);
  assert.equal(h.windows[0].url, 'https://account.coolapk.com/auth/login?type=coolapk');
  assert.deepEqual(h.partitions, ['persist:coolapk-official-login']); assert.equal(h.storageClears(), 0);
});

test('enabling teenager mode while the login page loads closes it and rejects the opening request', async () => {
  const h = harness('createLoginWindow', null, { holdLoad: true });
  const opening = h.sandbox.start(); assert.equal(h.windows.length, 1);
  h.transition(true); h.releaseLoad();
  await assert.rejects(opening, error => error.code === 'TEENAGER_RESTRICTED');
  assert.equal(h.windows[0].dead, true); assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
});

test('an account change while the login page loads invalidates the opening request', async () => {
  const h = harness('createLoginWindow', null, { holdLoad: true });
  const opening = h.sandbox.start(); assert.equal(h.windows.length, 1);
  h.sandbox.accountScope.changed(); h.windows[0].close(); h.releaseLoad();
  await assert.rejects(opening, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(h.windows[0].dead, true);
});

test('a full teenager enable/disable cycle cannot revive an older login opening', async () => {
  const h = harness('createLoginWindow', null, { holdLoad: true });
  const opening = h.sandbox.start(); h.transition(true); h.transition(false); h.releaseLoad();
  await assert.rejects(opening, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(h.windows.length, 1); assert.equal(h.windows[0].dead, true);
});

test('login also checks the mode epoch independently and does not close a newer window', async () => {
  const h = harness('createLoginWindow', null, { holdLoad: true });
  const opening = h.sandbox.start(); h.sandbox.teenagerAccess.epoch++;
  const replacement = { closed: false, close() { this.closed = true; } }; h.sandbox.loginWindow = replacement; h.releaseLoad();
  await assert.rejects(opening, error => error.code === 'TEENAGER_RESTRICTED');
  assert.equal(h.windows[0].dead, true); assert.equal(replacement.closed, false);
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
