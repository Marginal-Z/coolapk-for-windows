import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fsp, { mkdtemp, readFile, readdir, writeFile, utimes, rm, mkdir, rename, symlink } from 'node:fs/promises';
import { constants, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { DownloadManager, downloadRequest, fileName, publishApk } = createRequire(import.meta.url)('../electron/download-manager.cjs');
const bytes = Uint8Array.from([80, 75, 3, 4, 10, 20, 30, 40]), pn = 'com.example.synthetic';
const next = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate) { const deadline = Date.now() + 4000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Synthetic task timed out'); await next(); } }
const opened = (request, response = new Response(bytes, { headers: { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(bytes.length) } })) => ({ plan: { packageName: request.packageName, title: '模拟应用', versionCode: request.versionCode || '30', versionName: '3.0' }, response, verified: true, assertCurrent: () => {} });
async function withManager(options, run) { const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-download-test-')); const manager = new DownloadManager({ directory, openDownload: async request => opened(request), ...options }); try { await run(manager, manager.directory); } catch (e) { e.message += `\nSynthetic download states: ${JSON.stringify(manager.list().tasks)}`; throw e; } finally { manager.close(); await until(() => manager.running.size === 0); await rm(directory, { recursive: true }); } }

test('Windows directory aliases use the same native canonical identity for synchronous and asynchronous checks', { skip: process.platform !== 'win32' }, async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'coolapk-download-casing-test-')), directory = path.join(parent, 'MiXeD'); await mkdir(directory);
  const alias = directory.toLowerCase(), canonical = realpathSync.native(alias);
  assert.notEqual(realpathSync(alias), canonical, 'fixture must reproduce legacy/native Windows casing differences');
  const manager = new DownloadManager({ directory: alias, openDownload: async request => opened(request) });
  try {
    assert.equal(manager.directory, canonical); assert.equal(await fsp.realpath(manager.directory), canonical); manager.persist();
    const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).status === 'completed' && manager.running.size === 0);
    assert.equal(path.dirname((await manager.completedFile(task.id)).path), canonical);
  } catch (e) { e.message += `\nSynthetic download states: ${JSON.stringify(manager.list().tasks)}`; throw e; }
  finally { manager.close(); await until(() => manager.running.size === 0); await rm(parent, { recursive: true }); }
});

test('canonicalization still rejects replacement of the download directory by a different junction target', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'coolapk-download-directory-test-')), directory = path.join(parent, 'downloads'), original = path.join(parent, 'original'), replacement = path.join(parent, 'replacement'); await mkdir(directory); await mkdir(replacement);
  const manager = new DownloadManager({ directory, openDownload: async request => opened(request) });
  try {
    const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).status === 'completed' && manager.running.size === 0);
    await rename(directory, original); await symlink(replacement, directory, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => manager.persist(), /目录已改变/); await assert.rejects(manager.completedFile(task.id), /目录已改变/); assert.deepEqual(await readdir(replacement), []);
  } finally { manager.close(); await until(() => manager.running.size === 0); await rm(parent, { recursive: true }); }
});

test('verified synthetic APK is atomically saved, hashed and opened only by task capability', async () => {
  const shellCalls = [], snapshots = []; await withManager({ shell: { openPath: async file => { shellCalls.push(['open', file]); return ''; }, showItemInFolder: file => shellCalls.push(['reveal', file]) }, onChange: snapshot => snapshots.push(snapshot) }, async (manager, directory) => {
    const task = manager.add({ packageName: pn, versionCode: '30' }); await until(() => manager.task(task.id).status === 'completed');
    const snapshot = manager.snapshot(manager.task(task.id)); assert.equal(snapshot.downloaded, bytes.length); assert.equal(snapshot.total, bytes.length); assert.equal(snapshot.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(snapshot.verified, true); assert.ok(!JSON.stringify(snapshot).includes('requestUrl')); assert.ok(!JSON.stringify(snapshot).includes('cookie'));
    const file = await manager.completedFile(task.id); assert.deepEqual(new Uint8Array(await readFile(file.path)), bytes); assert.equal(path.dirname(file.path), directory); assert.equal((await readdir(directory)).filter(file => file.endsWith('.part')).length, 0); await manager.dispatch('open', { id: task.id }); await manager.dispatch('reveal', { id: task.id }); assert.deepEqual(shellCalls.map(row => row[0]), ['open', 'reveal']); assert.ok(snapshots.some(s => s.tasks[0]?.status === 'downloading'));
    const stat = await import('node:fs/promises').then(fs => fs.stat(file.path)); await writeFile(file.path, Uint8Array.from([80, 75, 3, 4, 10, 20, 30, 41])); await utimes(file.path, stat.atime, stat.mtime); await assert.rejects(manager.completedFile(task.id), /修改|改变/);
  });
});

test('queue captures account scope before scheduling, cancels queued/running tasks and retries from zero', async () => {
  let captures = 0, started = []; const streams = new Map();
  await withManager({ concurrency: 1, captureDownload: () => { const capture = ++captures; return async (request, { signal }) => { started.push({ pn: request.packageName, capture }); const body = new ReadableStream({ start(controller) { streams.set(request.packageName, controller); controller.enqueue(bytes.slice(0, 4)); signal.addEventListener('abort', () => { try { controller.error(signal.reason); } catch {} }); } }); return opened(request, new Response(body)); }; } }, async manager => {
    const first = manager.add({ packageName: pn }), second = manager.add({ packageName: 'com.example.second' }); assert.equal(captures, 2); assert.equal(manager.task(second.id).status, 'queued'); assert.equal(manager.add({ packageName: pn }).id, first.id);
    await until(() => manager.task(first.id).downloaded === 4); manager.cancel(second.id); manager.cancel(first.id); await until(() => manager.running.size === 0); assert.equal(started.length, 1); assert.equal(manager.task(first.id).status, 'canceled'); assert.equal(manager.snapshot(manager.task(first.id)).retryable, true);
    manager.retry(first.id); await until(() => started.length === 2 && manager.task(first.id).downloaded === 4); assert.equal(captures, 3); assert.equal(started[1].capture, 3); streams.get(pn).enqueue(bytes.slice(4)); streams.get(pn).close(); await until(() => manager.task(first.id).status === 'completed'); assert.equal(manager.task(first.id).downloaded, 8); assert.equal(manager.task(first.id).retryCount, 1); assert.equal(started.some(row => row.pn === 'com.example.second'), false);
  });
});

test('APK magic, declared length, complete range, size and verify result all guard publication', async () => {
  const cases = [
    ['DOWNLOAD_CONTENT', () => new Response('not an APK')],
    ['DOWNLOAD_CONTENT', () => new Response(bytes, { headers: { 'content-type': 'text/html' } })],
    ['DOWNLOAD_TRUNCATED', () => new Response(bytes.slice(0, 4), { headers: { 'content-length': '8' } })],
    ['DOWNLOAD_TRUNCATED', () => new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 8-15/16', 'content-length': '8' } })],
    ['DOWNLOAD_SIZE', () => new Response(bytes, { headers: { 'content-length': '4' } })],
    ['DOWNLOAD_SIZE', () => new Response(bytes, { headers: { 'content-length': '100' } })]
  ];
  for (const [code, response] of cases) await withManager({ maxBytes: 64, openDownload: async request => opened(request, response()) }, async (manager, directory) => { const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).status === 'failed' && manager.running.size === 0); assert.equal(manager.task(task.id).errorCode, code); assert.equal((await readdir(directory)).filter(name => /\.apk(?:\.part)?$/.test(name)).length, 0); await assert.rejects(manager.open(task.id), /尚未完成校验/); });
  await withManager({ openDownload: async request => ({ ...opened(request), verified: false }) }, async manager => { const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).status === 'failed'); assert.equal(manager.task(task.id).errorCode, 'DOWNLOAD_VERIFY_FAILED'); });
});

test('scope invalidation stops an in-flight body, keeps its explicit reason and permits a fresh retry', async () => {
  await withManager({ openDownload: async request => opened(request, new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 4)); } }))) }, async (manager, directory) => {
    const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).downloaded === 4); manager.invalidateScope(); await until(() => manager.running.size === 0); assert.equal(manager.task(task.id).status, 'failed'); assert.equal(manager.task(task.id).errorCode, 'ACCOUNT_CHANGED'); assert.equal((await readdir(directory)).filter(name => name.endsWith('.part')).length, 0);
    manager.openDownload = async request => opened(request); manager.retry(task.id); await until(() => manager.task(task.id).status === 'completed');
  });
});

test('publication never replaces an existing file and interrupted persisted tasks require explicit retry', async () => {
  let controller; await withManager({ openDownload: async request => opened(request, new Response(new ReadableStream({ start(value) { controller = value; controller.enqueue(bytes.slice(0, 4)); } }))) }, async (manager, directory) => {
    const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).downloaded === 4); const name = manager.task(task.id).fileName, target = path.join(directory, name); await writeFile(target, 'existing user file'); controller.enqueue(bytes.slice(4)); controller.close(); await until(() => manager.task(task.id).status === 'failed' && manager.running.size === 0); assert.equal(await readFile(target, 'utf8'), 'existing user file'); assert.equal((await readdir(directory)).filter(name => name.endsWith('.part')).length, 0);
    manager.task(task.id).status = 'queued'; manager.persist(); let requests = 0; const restored = new DownloadManager({ directory, openDownload: () => { requests++; throw new Error('No automatic account requests'); } }); assert.equal(restored.list().tasks[0].status, 'failed'); assert.match(restored.list().tasks[0].error, /重启/); assert.equal(requests, 0); restored.task(task.id).fileName = '../../escape.apk'; restored.task(task.id).status = 'completed'; restored.task(task.id).verified = true; restored.task(task.id).sha256 = 'a'.repeat(64); await assert.rejects(restored.completedFile(task.id), /文件名无效/); restored.close(); manager.task(task.id).status = 'failed';
  });
});

test('renderer arguments cannot select arbitrary paths and task persistence does not resume account requests', async () => {
  for (const input of [{ packageName: pn, path: 'C:/arbitrary.apk' }, { packageName: pn, url: 'https://evil.test/app.apk' }, { packageName: '../payload' }, { packageName: pn, versionCode: '30&extra=bad' }, null]) assert.throws(() => downloadRequest(input));
  assert.ok(fileName('CON', pn, '30', 'abcdef12-1234').startsWith('_CON')); assert.ok(!/[<>:"/\\|?*]/.test(fileName('../../bad:name', pn, '30', 'abcdef12-1234')));
  await withManager({}, async (manager, directory) => { const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).status === 'completed' && manager.running.size === 0); const restored = new DownloadManager({ directory, openDownload: () => { throw new Error('Must not auto-download'); } }); assert.equal(restored.list().tasks[0].status, 'completed'); assert.equal((await restored.completedFile(task.id)).size, 8); await assert.rejects(restored.dispatch('open', { id: '../arbitrary' }), /不存在/); await assert.rejects(restored.dispatch('add', { packageName: pn, path: 'arbitrary' }), e => e.code === 'INPUT'); restored.close(); });
});

test('unsupported hard links fall back to exclusive copy and always preserve existing destinations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-download-fallback-test-'));
  try {
    const partial = path.join(directory, 'synthetic.apk.part'); await writeFile(partial, bytes);
    for (const code of ['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP']) {
      const target = path.join(directory, `${code}.apk`); let copies = 0, checks = 0;
      const io = { ...fsp, link: async () => { throw Object.assign(new Error('Synthetic unsupported hard link'), { code }); }, copyFile: async (source, destination, flags) => { copies++; assert.equal(flags, constants.COPYFILE_EXCL); await fsp.copyFile(source, destination, flags); } };
      await publishApk(partial, target, () => { checks++; }, io); assert.equal(copies, 1); assert.ok(checks >= 3); assert.deepEqual(new Uint8Array(await readFile(target)), bytes);
      await assert.rejects(publishApk(partial, target, () => {}, io), e => e.code === 'EEXIST'); assert.equal(copies, 1); assert.deepEqual(new Uint8Array(await readFile(target)), bytes);
    }
    let copies = 0; await assert.rejects(publishApk(partial, path.join(directory, 'io-failure.apk'), () => {}, { ...fsp, link: async () => { throw Object.assign(new Error('Synthetic I/O failure'), { code: 'EIO' }); }, copyFile: async () => { copies++; } }), e => e.code === 'EIO'); assert.equal(copies, 0);
  } finally { await rm(directory, { recursive: true }); }
});

test('exclusive-copy failures and account/cancel changes clean only new output and keep original errors', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-download-fallback-test-'));
  try {
    const partial = path.join(directory, 'synthetic.apk.part'); await writeFile(partial, bytes);
    const link = async () => { throw Object.assign(new Error('Synthetic unsupported link'), { code: 'EPERM' }); };
    const diskFull = path.join(directory, 'disk-full.apk'); await assert.rejects(publishApk(partial, diskFull, () => {}, { ...fsp, link, copyFile: async (source, target, flags) => { await fsp.copyFile(source, target, flags); throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }); } }), e => e.code === 'ENOSPC'); await assert.rejects(fsp.stat(diskFull), e => e.code === 'ENOENT');
    const changed = path.join(directory, 'account-changed.apk'); let valid = true; await assert.rejects(publishApk(partial, changed, () => { if (!valid) throw Object.assign(new Error('Synthetic account change'), { code: 'ACCOUNT_CHANGED' }); }, { ...fsp, link, copyFile: async (source, target, flags) => { await fsp.copyFile(source, target, flags); valid = false; } }), e => e.code === 'ACCOUNT_CHANGED'); await assert.rejects(fsp.stat(changed), e => e.code === 'ENOENT');
    const canceled = path.join(directory, 'canceled.apk'); let checks = 0, copies = 0; await assert.rejects(publishApk(partial, canceled, () => { if (++checks === 2) throw Object.assign(new Error('Synthetic cancel'), { code: 'CANCELED' }); }, { ...fsp, link, copyFile: async () => { copies++; } }), e => e.code === 'CANCELED'); assert.equal(copies, 0); await assert.rejects(fsp.stat(canceled), e => e.code === 'ENOENT');
    const raced = path.join(directory, 'existing-race.apk'); await assert.rejects(publishApk(partial, raced, () => {}, { ...fsp, link, copyFile: async (source, target, flags) => { await writeFile(target, 'existing user data'); return fsp.copyFile(source, target, flags); } }), e => e.code === 'EEXIST'); assert.equal(await readFile(raced, 'utf8'), 'existing user data');
    const cleanup = path.join(directory, 'cleanup-error.apk'); await assert.rejects(publishApk(partial, cleanup, () => {}, { ...fsp, link, copyFile: async (source, target, flags) => { await fsp.copyFile(source, target, flags); throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }); }, unlink: async () => { throw Object.assign(new Error('Synthetic cleanup denied'), { code: 'EACCES' }); } }), e => e.code === 'ENOSPC' && e.cleanupErrorCode === 'EACCES'); assert.deepEqual(new Uint8Array(await readFile(partial)), bytes);
  } finally { await rm(directory, { recursive: true }); }
});
