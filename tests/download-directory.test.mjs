import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import path from 'node:path';
const { DownloadManager } = createRequire(import.meta.url)('../electron/download-manager.cjs');
const bytes = Uint8Array.from([80, 75, 3, 4, 10, 20, 30, 40]);
const packageName = 'com.example.synthetic';
const response = request => ({ plan: { packageName: request.packageName, title: '模拟下载', versionCode: '30' }, verified: true, response: new Response(bytes, { headers: { 'content-length': '8' } }) });
const until = async condition => { const end = Date.now() + 4000; while (!condition()) { if (Date.now() > end) throw new Error('Synthetic download directory timeout'); await new Promise(resolve => setTimeout(resolve, 10)); } };
async function fixture(run) {
  const root = path.join(process.cwd(), '.local', 'download-directory-tests'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(path.join(root, 'synthetic-')), original = path.join(folder, 'original'), chosen = path.join(folder, 'chosen'), stateFile = path.join(folder, 'userdata', 'app-downloads.json');
  await mkdir(original); await mkdir(chosen); const managers = [];
  const create = options => { const manager = new DownloadManager({ directory: original, stateFile, selectDirectory: async () => ({ directory: chosen }), openDownload: async request => response(request), ...options }); managers.push(manager); return manager; };
  try { await run({ folder, original, chosen, stateFile, create }); }
  finally { for (const manager of managers) manager.close(); await until(() => managers.every(manager => manager.running.size === 0 && [...manager.tasks.values()].every(task => !task.cleanup))); assert.equal(path.dirname(folder), root); await rm(folder, { recursive: true }); }
}

test('native directory selection persists before publishing the new default and survives restart', async () => {
  await fixture(async ({ chosen, stateFile, create }) => {
    const events = [], manager = create({ onChange: snapshot => events.push(snapshot) });
    const picked = await manager.dispatch('chooseDirectory'); assert.equal(picked.canceled, false); assert.equal(picked.changed, true); assert.equal(picked.directory, await import('node:fs/promises').then(fs => fs.realpath(chosen)));
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).directory, picked.directory); assert.equal(events.at(-1).directory, picked.directory);
    const restored = create({ openDownload: () => { throw new Error('No automatic download on restart'); } }); assert.equal(restored.directory, picked.directory); assert.deepEqual(await readdir(chosen), []);
  });
});

test('a saved custom directory survives an inaccessible original default without probing it', async t => {
  await fixture(async ({ original, create }) => {
    const manager = create(), picked = await manager.dispatch('chooseDirectory');
    const originalPath = path.resolve(original).toLowerCase();
    for (const code of ['EACCES', 'ENODEV']) {
      let accesses = 0;
      const mocks = [];
      try {
        for (const [owner, method] of [[fs, 'mkdirSync'], [fs.realpathSync, 'native'], [fs, 'lstatSync'], [fs, 'readFileSync']]) {
          const unpatched = owner[method];
          mocks.push(t.mock.method(owner, method, function (location, ...args) {
            const resolved = typeof location === 'string' ? path.resolve(location).toLowerCase() : '';
            if (resolved === originalPath || resolved.startsWith(originalPath + path.sep)) { accesses++; throw Object.assign(new Error('Original default unavailable'), { code }); }
            return unpatched.call(this, location, ...args);
          }));
        }
        const restored = create({ openDownload: () => { throw new Error('No automatic download on restart'); } });
        assert.equal(restored.directory, picked.directory); assert.deepEqual(restored.list().tasks, []);
        assert.equal(accesses, 0, `Saved custom directory must not access the original default (${code})`);
      } finally { for (const mocked of mocks.reverse()) mocked.mock.restore(); }
    }
  });
});

test('canceling the system folder picker preserves both current selection and persisted history', async () => {
  await fixture(async ({ stateFile, create }) => {
    const manager = create({ selectDirectory: async () => ({ directory: null }) }); manager.persist(); const before = await readFile(stateFile, 'utf8'), oldDirectory = manager.directory;
    const result = await manager.dispatch('chooseDirectory'); assert.equal(result.canceled, true); assert.equal(result.changed, false); assert.equal(manager.directory, oldDirectory); assert.equal(await readFile(stateFile, 'utf8'), before);
  });
});

test('directory IPC refuses renderer paths and duplicate picker requests before native selection', async () => {
  await fixture(async ({ create }) => {
    let picks = 0, release; const manager = create({ selectDirectory: () => { picks++; return new Promise(resolve => { release = resolve; }); } });
    for (const args of [{ path: 'D:/arbitrary' }, { directory: 'D:/arbitrary' }, { filePaths: ['D:/arbitrary'] }, [], null]) await assert.rejects(manager.dispatch('chooseDirectory', args), e => e.code === 'INPUT');
    assert.equal(picks, 0); const first = manager.dispatch('chooseDirectory'); await assert.rejects(manager.dispatch('chooseDirectory'), e => e.code === 'DOWNLOAD_BUSY'); assert.equal(picks, 1); release({ directory: null }); await first;
  });
});

test('switching with running and queued tasks affects only subsequent new task destinations', async () => {
  await fixture(async ({ original, chosen, create }) => {
    let release; const manager = create({ concurrency: 1, openDownload: async request => { if (request.packageName === packageName) await new Promise(resolve => { release = resolve; }); return response(request); } });
    const running = manager.add({ packageName }), queued = manager.add({ packageName: 'com.example.queued' }); assert.equal(manager.task(queued.id).status, 'queued');
    await manager.dispatch('chooseDirectory'); const fresh = manager.add({ packageName: 'com.example.fresh' }); release();
    await until(() => manager.running.size === 0 && manager.list().tasks.every(task => task.status === 'completed'));
    for (const task of [running, queued]) assert.equal(path.dirname((await manager.completedFile(task.id)).path), await import('node:fs/promises').then(fs => fs.realpath(original)));
    assert.equal(path.dirname((await manager.completedFile(fresh.id)).path), manager.directory); assert.equal(manager.directory, await import('node:fs/promises').then(fs => fs.realpath(chosen)));
    const restored = create({ openDownload: () => { throw new Error('No automatic download'); } });
    assert.equal(restored.directory, manager.directory); for (const task of [running, queued, fresh]) assert.equal((await restored.completedFile(task.id)).path, (await manager.completedFile(task.id)).path);
  });
});

test('completed files remain in the old folder and history removal does not resurrect legacy records', async () => {
  await fixture(async ({ original, chosen, stateFile, create }) => {
    const legacy = create({ stateFile: undefined }); const task = legacy.add({ packageName }); await until(() => legacy.running.size === 0);
    const file = await legacy.completedFile(task.id), legacyFile = path.join(original, '.coolapk-downloads.json');
    const rows = JSON.parse(await readFile(legacyFile, 'utf8')).tasks.map(({ directory, ...row }) => row); await writeFile(legacyFile, JSON.stringify(rows)); legacy.close();
    const imported = create(); assert.equal(imported.list().tasks.length, 1); assert.equal((await imported.completedFile(task.id)).path, file.path); assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).tasks[0].directory, imported.directory);
    await imported.dispatch('chooseDirectory'); assert.equal((await imported.completedFile(task.id)).path, file.path); await imported.dispatch('remove', { id: task.id });
    assert.deepEqual(new Uint8Array(await readFile(file.path)), bytes); assert.deepEqual(await readdir(chosen), []); assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).length, 1);
    const restored = create(); assert.deepEqual(restored.list().tasks, []); assert.equal(restored.directory, imported.directory);
  });
});

test('paused continuations use their original partial file after selecting a different directory', async () => {
  await fixture(async ({ original, chosen, create }) => {
    let controller; const calls = [];
    const manager = create({ openDownload: async (request, { resume }) => {
      calls.push(resume);
      return { ...response(request), resourceSha256: 'b'.repeat(64), ...(resume ? { rangeOffset: 4 } : {}), response: resume ? new Response(bytes.slice(4), { status: 206, headers: { 'content-length': '4', 'content-range': 'bytes 4-7/8', etag: '"synthetic"' } }) : new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(bytes.slice(0, 4)); } }), { headers: { 'content-length': '8', etag: '"synthetic"' } }) };
    } });
    const task = manager.add({ packageName }); await until(() => manager.task(task.id).downloaded === 4); manager.pause(task.id); await until(() => manager.running.size === 0); assert.equal(manager.task(task.id).resumeInfo.offset, 4);
    await manager.dispatch('chooseDirectory'); manager.resume(task.id); await until(() => manager.running.size === 0 && manager.task(task.id).status === 'completed');
    assert.equal(calls[1].offset, 4); assert.equal(path.dirname((await manager.completedFile(task.id)).path), await import('node:fs/promises').then(fs => fs.realpath(original))); assert.deepEqual(await readdir(chosen), []);
    assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(task.id)).path)), bytes); assert.ok(controller);
  });
});

test('retries retain the task destination while new tasks receive the selected default', async () => {
  await fixture(async ({ create }) => {
    const manager = create({ openDownload: async () => { throw new Error('Synthetic unavailable network'); } }); const failed = manager.add({ packageName }); await until(() => manager.running.size === 0); const originalDirectory = manager.task(failed.id).directory;
    await manager.dispatch('chooseDirectory'); manager.openDownload = async request => response(request); manager.retry(failed.id); await until(() => manager.running.size === 0);
    assert.equal(path.dirname((await manager.completedFile(failed.id)).path), originalDirectory); const fresh = manager.add({ packageName: 'com.example.next' }); await until(() => manager.running.size === 0); assert.equal(path.dirname((await manager.completedFile(fresh.id)).path), manager.directory);
  });
});

test('failed configuration persistence rolls back the directory and retains all file identities', async () => {
  await fixture(async ({ stateFile, create }) => {
    const manager = create(); const task = manager.add({ packageName }); await until(() => manager.running.size === 0); const file = await manager.completedFile(task.id), before = await readFile(stateFile, 'utf8'), oldDirectory = manager.directory, persist = manager.persist;
    manager.persist = () => { throw Object.assign(new Error('Synthetic disk full'), { code: 'ENOSPC' }); };
    await assert.rejects(manager.dispatch('chooseDirectory'), e => e.code === 'ENOSPC'); manager.persist = persist;
    assert.equal(manager.directory, oldDirectory); assert.equal(await readFile(stateFile, 'utf8'), before); assert.equal((await manager.completedFile(task.id)).path, file.path);
  });
});

test('invalid folders and mode transitions do not commit paths or leave write probes', async () => {
  await fixture(async ({ folder, chosen, create }) => {
    const existing = path.join(folder, 'existing-user-file.txt'); await writeFile(existing, 'keep existing user file');
    for (const selected of ['relative', existing]) { const manager = create({ selectDirectory: async () => ({ directory: selected }) }); const before = manager.directory; await assert.rejects(manager.dispatch('chooseDirectory')); assert.equal(manager.directory, before); }
    let checks = 0; const manager = create({ selectDirectory: async () => ({ directory: chosen, assertCurrent: () => { if (++checks === 2) throw Object.assign(new Error('Mode changed'), { code: 'TEENAGER_RESTRICTED' }); } }) }); const before = manager.directory;
    await assert.rejects(manager.dispatch('chooseDirectory'), e => e.code === 'TEENAGER_RESTRICTED'); assert.equal(manager.directory, before); assert.deepEqual(await readdir(chosen), []); assert.equal(await readFile(existing, 'utf8'), 'keep existing user file');
  });
});

test('replaced old task directory cannot redirect completed-file opening into another selected folder', async () => {
  await fixture(async ({ folder, original, chosen, create }) => {
    const manager = create(); const task = manager.add({ packageName }); await until(() => manager.running.size === 0); await manager.dispatch('chooseDirectory');
    await rename(original, path.join(folder, 'original-moved')); await symlink(chosen, original, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(manager.completedFile(task.id), /目录已改变/); manager.persist(); assert.deepEqual(await readdir(chosen), []);
  });
});
