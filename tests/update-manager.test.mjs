import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { UpdateManager } = createRequire(import.meta.url)('../electron/update-manager.cjs');

const hash = Buffer.alloc(64, 42).toString('base64');
const info = (version = '0.6.0', patch = {}) => ({
  version,
  files: [{ url: `Coolapk-Desktop-Setup-${version}-x64.exe`, sha512: hash, size: 100 }],
  path: `Coolapk-Desktop-Setup-${version}-x64.exe`,
  sha512: hash,
  releaseDate: '2026-10-04T00:00:00.000Z',
  releaseNotes: '更新说明',
  ...patch,
});
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Token { cancelled = false; cancel() { this.cancelled = true; } }
class Adapter extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = [];
  candidate = info();
  available = true;
  async checkForUpdates() {
    this.checks++;
    this.emit(this.available ? 'update-available' : 'update-not-available', this.candidate);
    return { isUpdateAvailable: this.available, updateInfo: this.candidate };
  }
  async downloadUpdate(token) {
    this.downloads++;
    this.token = token;
    const file = `D:/update-cache/${this.candidate.path}`;
    this.emit('download-progress', { percent: 50, transferred: 50, total: 100, bytesPerSecond: 10 });
    this.emit('update-downloaded', { ...this.candidate, downloadedFile: file });
    return [file];
  }
  quitAndInstall(...args) { this.installs.push(args); }
}
function setup(options = {}) {
  const adapter = options.updater ?? new Adapter();
  const changes = [];
  const manager = new UpdateManager({ updater: adapter, version: '0.5.0', onChange: state => changes.push(state), now: () => Date.parse('2026-10-04T01:02:03Z'), tokenFactory: () => new Token(), ...options });
  return { manager, adapter, changes };
}
async function downloaded(options) {
  const context = setup(options);
  await context.manager.dispatch('check');
  await context.manager.dispatch('download');
  return context;
}

test('check, download and install require verified event and promise completion', async () => {
  const validations = [];
  const { manager, adapter, changes } = setup({ validatePackage: async value => { validations.push(value); return true; } });
  assert.equal(manager.state().status, 'idle');
  assert.throws(() => manager.dispatch('download'), { code: 'UPDATE_NOT_AVAILABLE' });
  assert.throws(() => manager.dispatch('install'), { code: 'UPDATE_NOT_DOWNLOADED' });
  const available = await manager.dispatch('check');
  assert.equal(available.status, 'available');
  assert.equal(available.availableVersion, '0.6.0');
  assert.equal(available.checkedAt, '2026-10-04T01:02:03.000Z');
  const ready = await manager.dispatch('download');
  assert.equal(ready.status, 'downloaded');
  assert.equal(ready.progress.percent, 100);
  assert.equal(validations.length, 1);
  assert.deepEqual(validations[0].paths, ['D:/update-cache/Coolapk-Desktop-Setup-0.6.0-x64.exe']);
  assert.equal(validations[0].info.sha512, hash);
  assert.equal(JSON.stringify(ready).includes('update-cache'), false);
  const installation = await manager.dispatch('install');
  assert.equal(installation.status, 'installing');
  assert.equal(validations.length, 2);
  assert.deepEqual(adapter.installs, [[false, true]]);
  assert.deepEqual(changes.map(value => value.status), ['checking', 'available', 'downloading', 'downloading', 'downloaded', 'installing']);
  manager.close();
});

test('equal or older stable releases never offer a downgrade', async () => {
  for (const version of ['0.5.0', '0.4.0']) {
    const { manager, adapter } = setup();
    adapter.candidate = info(version); adapter.available = false;
    const state = await manager.dispatch('check');
    assert.equal(state.status, 'current');
    assert.equal(state.availableVersion, null);
    assert.throws(() => manager.dispatch('download'), { code: 'UPDATE_NOT_AVAILABLE' });
    manager.close();
  }
});

test('strict stable versions compare numerically rather than lexically', async () => {
  const { manager, adapter } = setup({ version: '0.9.0' });
  adapter.candidate = info('0.10.0');
  assert.equal((await manager.dispatch('check')).availableVersion, '0.10.0');
  manager.close();
});

test('malformed, prerelease and falsely advertised downgrade versions are rejected', async () => {
  for (const version of ['0.5.0', '0.4.9', 'v0.6.0', '0.6.0-beta.1', '0.06.0', '1.2', '99999999999999999999.0.0']) {
    const { manager, adapter } = setup(); adapter.candidate = info(version);
    await assert.rejects(manager.dispatch('check'), { code: 'UPDATE_INVALID_METADATA' });
    assert.equal(manager.state().availableVersion, null);
    assert.throws(() => manager.dispatch('download'), { code: 'UPDATE_NOT_AVAILABLE' });
    manager.close();
  }
});

test('metadata rejects alternate filenames, URLs, traversal and invalid integrity hashes', async () => {
  const cases = [
    { files: [] },
    { files: [...info().files, ...info().files] },
    { files: [{ url: 'https://evil.example/Setup.exe', sha512: hash }] },
    { files: [{ url: '../Coolapk-Desktop-Setup-0.6.0-x64.exe', sha512: hash }] },
    { files: [{ url: 'D:/Coolapk-Desktop-Setup-0.6.0-x64.exe', sha512: hash }] },
    { files: [{ url: 'Coolapk-Desktop-Setup-0.6.0-x64.exe', sha512: 'a'.repeat(88) }] },
    { files: [{ url: 'Coolapk-Desktop-Setup-0.6.0-x64.exe', sha512: Buffer.alloc(32).toString('base64') }] },
    { files: [{ ...info().files[0], size: -1 }] },
    { path: 'Other.exe' },
    { sha512: Buffer.alloc(64).toString('base64') },
    { releaseDate: 'not-a-date' },
  ];
  for (const patch of cases) {
    const { manager, adapter } = setup(); adapter.candidate = info('0.6.0', patch);
    await assert.rejects(manager.dispatch('check'), { code: 'UPDATE_INVALID_METADATA' });
    assert.equal(manager.state().status, 'error'); manager.close();
  }
});

test('check result and real availability event must agree', async () => {
  const { manager, adapter } = setup();
  adapter.checkForUpdates = async () => { adapter.emit('update-available', info('0.7.0')); return { isUpdateAvailable: true, updateInfo: info('0.6.0') }; };
  await assert.rejects(manager.dispatch('check'), { code: 'UPDATE_INVALID_METADATA' });
  adapter.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: info() });
  await assert.rejects(manager.dispatch('check'), { code: 'UPDATE_INVALID_METADATA' });
  manager.close();
});

test('concurrent checks share one request while conflicting operations are rejected', async () => {
  const pending = gate(); const { manager, adapter } = setup();
  adapter.checkForUpdates = () => { adapter.checks++; return pending.promise; };
  const first = manager.dispatch('check'), second = manager.dispatch('check');
  assert.equal(first, second); assert.equal(adapter.checks, 1);
  for (const operation of ['download', 'cancel', 'install']) assert.throws(() => manager.dispatch(operation), { code: 'UPDATE_BUSY' });
  adapter.emit('update-available', info()); pending.resolve({ isUpdateAvailable: true, updateInfo: info() });
  assert.equal((await first).status, 'available'); manager.close();
});

test('check failure and retry expose only a fixed message without paths, credentials or URLs', async () => {
  const { manager, adapter } = setup(); const original = adapter.checkForUpdates.bind(adapter);
  adapter.checkForUpdates = async () => { const error = Error('https://user:password@private.example/?token=secret C:/Users/private'); adapter.emit('error', error); throw error; };
  await assert.rejects(manager.dispatch('check'), error => error.code === 'UPDATE_CHECK_FAILED' && !/secret|password|private/.test(error.message));
  assert.equal(/secret|password|private/.test(JSON.stringify(manager.state())), false);
  adapter.checkForUpdates = original;
  assert.equal((await manager.dispatch('check')).status, 'available'); manager.close();
});

test('real downloaded event cannot offer installation before download promise settles', async () => {
  const pending = gate(); const { manager, adapter } = setup(); await manager.dispatch('check');
  adapter.downloadUpdate = () => pending.promise;
  const downloading = manager.dispatch('download');
  const path = 'D:/update-cache/setup.exe';
  adapter.emit('update-downloaded', { ...info(), downloadedFile: path });
  assert.equal(manager.state().status, 'downloading');
  assert.throws(() => manager.dispatch('install'), { code: 'UPDATE_BUSY' });
  pending.resolve([path]); assert.equal((await downloading).status, 'downloaded'); manager.close();
});

test('download success without event, mismatched path, or candidate identity is rejected', async () => {
  for (const variant of ['no-event', 'path', 'version', 'hash']) {
    const { manager, adapter } = setup(); await manager.dispatch('check');
    adapter.downloadUpdate = async () => {
      if (variant !== 'no-event') adapter.emit('update-downloaded', { ...info(variant === 'version' ? '0.7.0' : '0.6.0'), ...(variant === 'hash' ? { files: [{ ...info().files[0], sha512: Buffer.alloc(64).toString('base64') }], sha512: Buffer.alloc(64).toString('base64') } : {}), downloadedFile: 'D:/download/setup.exe' });
      return [variant === 'path' ? 'D:/other/setup.exe' : 'D:/download/setup.exe'];
    };
    await assert.rejects(manager.dispatch('download'), { code: 'UPDATE_PACKAGE_INVALID' });
    assert.throws(() => manager.dispatch('install'), { code: 'UPDATE_NOT_DOWNLOADED' }); manager.close();
  }
});

test('package verification is awaited and cannot be skipped by a downloaded event', async () => {
  const verification = gate(); const { manager, adapter } = setup({ validatePackage: () => verification.promise }); await manager.dispatch('check');
  const download = manager.dispatch('download'); await Promise.resolve();
  assert.equal(manager.state().status, 'downloading'); assert.equal(adapter.installs.length, 0);
  verification.resolve(false);
  await assert.rejects(download, { code: 'UPDATE_PACKAGE_INVALID' });
  assert.equal(manager.state().status, 'error'); manager.close();
});

test('duplicate downloads share the attempt, progress never moves backwards and snapshots are detached', async () => {
  const pending = gate(); const { manager, adapter } = setup(); await manager.dispatch('check');
  adapter.downloadUpdate = () => { adapter.downloads++; return pending.promise; };
  const first = manager.dispatch('download'), second = manager.dispatch('download');
  assert.equal(first, second); assert.equal(adapter.downloads, 1);
  assert.equal(manager.state().status, 'downloading');
  assert.throws(() => manager.dispatch('check'), { code: 'UPDATE_BUSY' });
  adapter.emit('download-progress', { percent: 60, transferred: 60, total: 100, bytesPerSecond: 10 });
  const snapshot = manager.state(); snapshot.progress.percent = 1;
  adapter.emit('download-progress', { percent: 20, transferred: 20, total: 50, bytesPerSecond: NaN });
  assert.deepEqual(manager.state().progress, { percent: 60, transferred: 60, total: 100, bytesPerSecond: 0 });
  adapter.emit('download-progress', { percent: Infinity, transferred: -1, total: Infinity, bytesPerSecond: -1 });
  assert.deepEqual(manager.state().progress, { percent: 60, transferred: 60, total: 100, bytesPerSecond: 0 });
  const path = 'D:/download/setup.exe'; adapter.emit('update-downloaded', { ...info(), downloadedFile: path }); pending.resolve([path]);
  await first; manager.close();
});

test('cancel ignores late events and settles old request before permitting a fresh token', async () => {
  const pending = gate(); const { manager, adapter } = setup(); await manager.dispatch('check');
  const original = adapter.downloadUpdate.bind(adapter); let token;
  adapter.downloadUpdate = value => { token = value; return pending.promise; };
  const download = manager.dispatch('download');
  const cancel = manager.dispatch('cancel');
  assert.equal(manager.state().status, 'available'); assert.equal(token.cancelled, true);
  assert.equal(manager.dispatch('cancel'), cancel);
  let canceled = false; void cancel.then(() => { canceled = true; }); await Promise.resolve(); assert.equal(canceled, false);
  adapter.emit('download-progress', { percent: 99, transferred: 99, total: 100, bytesPerSecond: 10 });
  adapter.emit('update-downloaded', { ...info(), downloadedFile: 'D:/late/setup.exe' });
  assert.equal(manager.state().progress, null);
  assert.throws(() => manager.dispatch('download'), { code: 'UPDATE_BUSY' });
  pending.reject(Error('cancelled C:/private')); assert.equal((await download).status, 'available'); assert.equal((await cancel).status, 'available');
  adapter.downloadUpdate = original;
  assert.equal((await manager.dispatch('download')).status, 'downloaded'); assert.notEqual(adapter.token, token); assert.equal(adapter.token.cancelled, false);
  manager.close();
});

test('cancel during checksum validation prevents later readiness', async () => {
  const verification = gate(); const { manager } = setup({ validatePackage: () => verification.promise }); await manager.dispatch('check');
  const download = manager.dispatch('download'); await Promise.resolve();
  const cancellation = manager.dispatch('cancel'); verification.resolve(true);
  assert.equal((await download).status, 'available');
  assert.equal((await cancellation).status, 'available');
  assert.throws(() => manager.dispatch('install'), { code: 'UPDATE_NOT_DOWNLOADED' }); manager.close();
});

test('download errors can retry with fresh token and sanitized state', async () => {
  const { manager, adapter } = setup(); await manager.dispatch('check'); const original = adapter.downloadUpdate.bind(adapter);
  adapter.downloadUpdate = async () => { throw Error('https://private.example/?token=private C:/Users/private'); };
  await assert.rejects(manager.dispatch('download'), { code: 'UPDATE_DOWNLOAD_FAILED' });
  assert.equal(manager.state().availableVersion, '0.6.0'); assert.equal(JSON.stringify(manager.state()).includes('private'), false);
  adapter.downloadUpdate = original; assert.equal((await manager.dispatch('download')).status, 'downloaded'); manager.close();
});

test('installer is revalidated to reject file changes after download', async () => {
  let validations = 0;
  const { manager, adapter } = await downloaded({ validatePackage: async () => ++validations === 1 });
  await assert.rejects(manager.dispatch('install'), { code: 'UPDATE_PACKAGE_INVALID' });
  assert.equal(validations, 2); assert.equal(adapter.installs.length, 0);
  assert.throws(() => manager.dispatch('install'), { code: 'UPDATE_NOT_DOWNLOADED' }); manager.close();
});

test('installer failure events and exceptions report actionable fixed errors', async () => {
  for (const variant of ['throw', 'event', 'false']) {
    const { manager, adapter } = await downloaded();
    adapter.quitAndInstall = () => { if (variant === 'throw') throw Error('D:/private/setup.exe'); if (variant === 'event') adapter.emit('error', Error('private')); return false; };
    await assert.rejects(manager.dispatch('install'), { code: 'UPDATE_INSTALL_FAILED' });
    assert.equal(JSON.stringify(manager.state()).includes('private'), false);
    assert.equal((await manager.dispatch('download')).status, 'downloaded'); manager.close();
  }
});

test('asynchronous installer failure resets busy state for retry', async () => {
  const { manager, adapter } = await downloaded();
  await manager.dispatch('install'); adapter.emit('error', Error('private spawn path'));
  assert.equal(manager.state().errorCode, 'UPDATE_INSTALL_FAILED');
  assert.equal((await manager.dispatch('download')).status, 'downloaded'); manager.close();
});

test('an installer error during validation prevents launching the installer', async () => {
  const pending = gate(); let validations = 0;
  const { manager, adapter } = await downloaded({ validatePackage: () => ++validations === 1 ? true : pending.promise });
  const installation = manager.dispatch('install');
  adapter.emit('error', Error('private failure')); pending.resolve(true);
  await assert.rejects(installation, { code: 'UPDATE_INSTALL_FAILED' });
  assert.equal(adapter.installs.length, 0); manager.close();
});

test('development mode and unavailable adapter refuse mutations while supporting info', () => {
  for (const options of [{ updater: null, distribution: 'development' }, { distribution: 'development' }]) {
    const { manager } = setup(options);
    assert.equal(manager.dispatch('info').status, 'unsupported');
    for (const operation of ['check', 'download', 'cancel', 'install']) assert.throws(() => manager.dispatch(operation), { code: 'UPDATE_UNSUPPORTED' });
    manager.close();
  }
});

test('portable distribution offers only a newer installer, with no same-version fake update', async () => {
  const { manager, adapter } = setup({ distribution: 'portable' });
  adapter.candidate = info('0.5.0'); adapter.available = false;
  assert.equal((await manager.dispatch('check')).status, 'current');
  assert.throws(() => manager.dispatch('download'), { code: 'UPDATE_NOT_AVAILABLE' });
  adapter.candidate = info(); adapter.available = true;
  assert.equal((await manager.dispatch('check')).availableVersion, '0.6.0'); manager.close();
});

test('fixed operation allowlist rejects arguments and arbitrary actions', () => {
  const { manager } = setup();
  for (const operation of ['setFeedURL', 'open', '__proto__', '']) assert.throws(() => manager.dispatch(operation), { code: 'UPDATE_INVALID_OPERATION' });
  assert.throws(() => manager.dispatch('check', { url: 'https://evil.example' }), { code: 'UPDATE_INVALID_OPERATION' }); manager.close();
});

test('close removes owned listeners and canceled requests cannot revive UI or installation', async () => {
  const pending = gate(); const { manager, adapter, changes } = setup(); await manager.dispatch('check');
  adapter.downloadUpdate = token => { adapter.token = token; return pending.promise; };
  const download = manager.dispatch('download'); manager.close(); const count = changes.length;
  assert.equal(adapter.token.cancelled, true); assert.equal(adapter.listenerCount('download-progress'), 0); assert.equal(adapter.listenerCount('update-downloaded'), 0); assert.equal(adapter.listenerCount('error'), 0);
  adapter.emit('update-downloaded', { ...info(), downloadedFile: 'D:/late/setup.exe' }); pending.resolve(['D:/late/setup.exe']); await download;
  assert.equal(changes.length, count); assert.equal(adapter.installs.length, 0);
  assert.throws(() => manager.dispatch('install'), { code: 'UPDATE_CLOSED' }); manager.close();
});

test('closing while installation validation is pending does not launch installer', async () => {
  const pending = gate(); let validations = 0;
  const { manager, adapter } = await downloaded({ validatePackage: () => ++validations === 1 ? true : pending.promise });
  const install = manager.dispatch('install'); manager.close(); pending.resolve(true); await install;
  assert.equal(adapter.installs.length, 0);
});

test('renderer notification exceptions cannot break backend update state', async () => {
  const { manager } = setup({ onChange: () => { throw Error('renderer closed'); } });
  assert.equal((await manager.dispatch('check')).status, 'available');
  assert.equal((await manager.dispatch('download')).status, 'downloaded'); manager.close();
});
