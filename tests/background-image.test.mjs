import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs, { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { BackgroundImageManager, BACKGROUND_SCHEME, MAX_BACKGROUND_BYTES, backgroundUrl, imageHeader, createBackgroundDecoder } = createRequire(import.meta.url)('../electron/background-image.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=', 'base64');
test('WebP decoding uses only bounded literal bytes in an isolated world and never renderer filesystem APIs', async () => {
  const calls = [];
  const decoder = createBackgroundDecoder({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }) }, webContents: () => ({ isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async (world, scripts) => { calls.push({ world, scripts }); return { width: 2, height: 3 }; } }) });
  assert.deepEqual(await decoder(png, 'image/png'), { width: 1, height: 1 }); assert.equal(calls.length, 0);
  const image = Buffer.from("synthetic');window.coolapk.background('remove');"); assert.deepEqual(await decoder(image, 'image/webp'), { width: 2, height: 3 }); assert.equal(calls[0].world, 2001); assert.ok(calls[0].scripts[0].code.includes(image.toString('base64'))); assert.equal(calls[0].scripts[0].code.includes('window.coolapk'), false); assert.equal(calls[0].scripts[0].code.includes('fetch('), false); assert.ok(calls[0].scripts[0].code.includes('image.close()'));
});
async function harness(t, options = {}) {
  const base = path.resolve('.local/background-unit-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'case-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, '测试背景.png'); await writeFile(source, png); const directory = path.join(root, 'userdata', 'background');
  const calls = []; let selected = { canceled: false, filePaths: [source] };
  const manager = new BackgroundImageManager({ directory, parent: () => 'synthetic-parent', dialog: { showOpenDialog: async (...args) => { calls.push(args); return selected; } }, decodeImage: async () => ({ width: 1, height: 1 }), ...options });
  return { root, source, directory, manager, calls, select: value => { selected = value; } };
}
test('choosing copies verified bytes to userData and exposes only an opaque protocol URL', async t => {
  const h = await harness(t); const state = await h.manager.dispatch('choose');
  assert.equal(state.available, true); assert.equal(state.name, '测试背景.png'); assert.equal(state.width, 1);
  assert.equal(JSON.stringify(state).includes(h.root), false); assert.equal(JSON.stringify(state).includes('base64'), false);
  assert.equal(state.url, backgroundUrl(createHash('sha256').update(png).digest('hex')));
  assert.equal(h.calls[0][0], 'synthetic-parent'); assert.deepEqual(h.calls[0][1].properties, ['openFile']); assert.deepEqual(h.calls[0][1].filters[0].extensions, ['jpg', 'jpeg', 'png', 'webp']);
  await writeFile(h.source, 'changed source'); assert.deepEqual((await h.manager.read(state.url)).body, png);
  assert.deepEqual(await h.manager.state(), state); assert.deepEqual(await readFile(path.join(h.directory, state.revision + '.png')), png);
});
test('cancel retains a disabled or existing image without choosing a renderer supplied destination', async t => {
  const h = await harness(t), first = await h.manager.dispatch('choose'); h.select({ canceled: true, filePaths: [] });
  assert.deepEqual(await h.manager.dispatch('choose'), { ...first, cancelled: true });
  for (const args of [{ path: h.source }, { cookie: 'synthetic' }, {}, null]) await assert.rejects(h.manager.dispatch('choose', () => {}, args), { code: 'INPUT' });
  for (const operation of ['write', 'file', '__proto__', null]) await assert.rejects(h.manager.dispatch(operation), { code: 'INPUT' });
});
test('controlled reader refuses arbitrary origins, paths, query selectors and stale revisions', async t => {
  const h = await harness(t), first = await h.manager.dispatch('choose');
  for (const url of ['file://' + h.source, 'https://example.test/a.png', `${BACKGROUND_SCHEME}://evil/${first.revision}`, `${BACKGROUND_SCHEME}://user:pass@local/${first.revision}`, `${BACKGROUND_SCHEME}://local:123/${first.revision}`, first.url + '?path=' + h.source, first.url + '#x', `${BACKGROUND_SCHEME}://local/active.json`, `${BACKGROUND_SCHEME}://local/${'a'.repeat(64)}`]) assert.equal(await h.manager.read(url), null, url);
  await h.manager.dispatch('remove'); assert.equal(await h.manager.read(first.url), null);
});
test('invalid raster data and failed actual decoding cannot replace the selected background', async t => {
  const h = await harness(t); const selected = await h.manager.dispatch('choose');
  for (const [name, bytes] of [['fake.png', Buffer.from('<svg/>')], ['file.exe', png]]) { const source = path.join(h.root, name); await writeFile(source, bytes); h.select({ filePaths: [source] }); await assert.rejects(h.manager.dispatch('choose'), { code: 'INPUT' }); }
  h.select({ filePaths: [h.source] }); h.manager.decodeImage = async () => null; await assert.rejects(h.manager.dispatch('choose'), { code: 'INPUT' });
  assert.deepEqual(await h.manager.state(), selected); assert.deepEqual((await h.manager.read(selected.url)).body, png);
});
test('byte and decoded-pixel bounds are enforced before persistence', async t => {
  const h = await harness(t); await writeFile(h.source, Buffer.alloc(MAX_BACKGROUND_BYTES + 1)); await assert.rejects(h.manager.dispatch('choose'), { code: 'INPUT' });
  const huge = Buffer.from(png); huge.writeUInt32BE(8193, 16); assert.throws(() => imageHeader(huge), { code: 'INPUT' }); huge.writeUInt32BE(8192, 16); huge.writeUInt32BE(8192, 20); assert.throws(() => imageHeader(huge), { code: 'INPUT' });
  await writeFile(h.source, png); h.manager.decodeImage = async () => ({ width: 8193, height: 1 }); await assert.rejects(h.manager.dispatch('choose'), { code: 'INPUT' }); assert.equal((await h.manager.state()).available, false);
});
test('changed account while native file selector is pending cannot read or persist the chosen file', async t => {
  let release; const h = await harness(t, { dialog: { showOpenDialog: () => new Promise(resolve => { release = resolve; }) } }); let valid = true;
  const work = h.manager.dispatch('choose', () => { if (!valid) throw Object.assign(new Error('changed'), { code: 'ACCOUNT_CHANGED' }); });
  valid = false; release({ filePaths: [h.source] }); await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); assert.equal((await h.manager.state()).available, false); assert.deepEqual(await readdir(h.directory), []);
});
test('changed account during actual image decoding prevents all background writes', async t => {
  let release, started; const entered = new Promise(resolve => { started = resolve; });
  const h = await harness(t, { decodeImage: () => { started(); return new Promise(resolve => { release = resolve; }); } }); let valid = true;
  const work = h.manager.dispatch('choose', () => { if (!valid) throw Object.assign(new Error('changed'), { code: 'ACCOUNT_CHANGED' }); });
  await entered; valid = false; release({ width: 1, height: 1 }); await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); assert.equal((await h.manager.state()).available, false); assert.deepEqual(await readdir(h.directory), []);
});
test('only one choose or remove can run while the native selector is open', async t => {
  let release; const h = await harness(t, { dialog: { showOpenDialog: () => new Promise(resolve => { release = resolve; }) } });
  const work = h.manager.dispatch('choose'); await assert.rejects(h.manager.dispatch('choose'), { code: 'INPUT' }); await assert.rejects(h.manager.dispatch('remove'), { code: 'INPUT' });
  release({ canceled: true }); await work; assert.equal((await h.manager.dispatch('remove')).available, false);
});
test('removal deletes only the owned manifest and selected copy, leaving original and unrelated files intact', async t => {
  const h = await harness(t), state = await h.manager.dispatch('choose'); await writeFile(path.join(h.directory, 'unrelated.txt'), 'preserve');
  assert.equal((await h.manager.dispatch('remove')).available, false); assert.deepEqual(await readFile(h.source), png); assert.equal(await readFile(path.join(h.directory, 'unrelated.txt'), 'utf8'), 'preserve'); assert.deepEqual(await readdir(h.directory), ['unrelated.txt']); assert.equal(await h.manager.read(state.url), null);
});
test('corrupt stored data and malicious manifest paths never become readable protocol resources', async t => {
  const h = await harness(t), state = await h.manager.dispatch('choose'); await writeFile(path.join(h.directory, state.revision + '.png'), 'tampered');
  assert.equal((await h.manager.state()).available, false); assert.equal(await h.manager.read(state.url), null);
  await writeFile(path.join(h.directory, 'active.json'), JSON.stringify({ revision: '../private', format: 'png', name: 'private', width: 1, height: 1, bytes: 3 })); assert.equal((await h.manager.state()).available, false); assert.equal(await h.manager.read(state.url), null);
});

const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const changedGuard = state => () => { if (!state.valid) throw Object.assign(new Error('account changed'), { code: 'ACCOUNT_CHANGED' }); };
async function replacement(h) {
  const bytes = Buffer.concat([png, Buffer.from('different synthetic verified image')]);
  const source = path.join(h.root, '替换背景.png'); await writeFile(source, bytes); h.select({ filePaths: [source] }); return bytes;
}
async function assertPreserved(h, state) {
  assert.deepEqual(await h.manager.state(), state); assert.deepEqual((await h.manager.read(state.url)).body, png);
  assert.deepEqual((await readdir(h.directory)).sort(), ['active.json', state.revision + '.png'].sort());
}
for (const code of ['EPERM', 'EACCES', 'EBUSY']) test(`a transient ${code} retries atomic manifest replace without removing the current background`, async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose'), waits = []; const bytes = await replacement(h);
  let calls = 0;
  h.manager.wait = async duration => { waits.push(duration); };
  h.manager.io = { ...fs, rename: async (from, to) => {
    calls++; assert.deepEqual(JSON.parse(await readFile(to, 'utf8')).revision, initial.revision);
    if (calls === 1) throw Object.assign(new Error(`${code}: rename '${from}' -> '${to}'`), { code });
    return fs.rename(from, to);
  } };
  const result = await h.manager.dispatch('choose'); assert.equal(calls, 2); assert.deepEqual(waits, [25]);
  assert.notEqual(result.revision, initial.revision); assert.deepEqual((await h.manager.read(result.url)).body, bytes);
  assert.deepEqual((await readdir(h.directory)).sort(), ['active.json', result.revision + '.png'].sort());
});
test('a persistent Windows replace lock is bounded, retains the original background and exposes no absolute paths', async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose'); await replacement(h); const waits = []; let calls = 0;
  h.manager.wait = async duration => { waits.push(duration); };
  h.manager.io = { ...fs, rename: async (from, to) => { calls++; throw Object.assign(new Error(`EPERM: rename '${from}' -> '${to}'`), { code: 'EPERM' }); } };
  await assert.rejects(h.manager.dispatch('choose'), error => error.code === 'BACKGROUND_IO' && error.message.includes('稍后重试') && !error.message.includes(h.root) && !error.message.includes('rename'));
  assert.equal(calls, 5); assert.deepEqual(waits, [25, 50, 100, 200]); await assertPreserved(h, initial);
});
test('an account change during the final rename restores the previous manifest and image bytes', async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose'); await replacement(h);
  const entered = deferred(), finish = deferred(), state = { valid: true }; let held = true;
  h.manager.io = { ...fs, rename: async (from, to) => { if (held) { held = false; entered.release(); await finish.promise; } return fs.rename(from, to); } };
  const work = h.manager.dispatch('choose', changedGuard(state)); await entered.promise; state.valid = false; finish.release();
  await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); await assertPreserved(h, initial);
});
test('an account change during the first manifest commit leaves no selected background or temporary files', async t => {
  const h = await harness(t), entered = deferred(), finish = deferred(), state = { valid: true };
  h.manager.io = { ...fs, rename: async (...args) => { entered.release(); await finish.promise; return fs.rename(...args); } };
  const work = h.manager.dispatch('choose', changedGuard(state)); await entered.promise; state.valid = false; finish.release();
  await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); assert.equal((await h.manager.state()).available, false); assert.deepEqual(await readdir(h.directory), []);
});
test('an account change while rename waits to retry cancels before committing a new manifest', async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose'); await replacement(h);
  const entered = deferred(), finish = deferred(), state = { valid: true }; let calls = 0;
  h.manager.io = { ...fs, rename: async () => { calls++; throw Object.assign(new Error('synthetic busy file'), { code: 'EBUSY' }); } };
  h.manager.wait = async () => { entered.release(); await finish.promise; };
  const work = h.manager.dispatch('choose', changedGuard(state)); await entered.promise; state.valid = false; finish.release();
  await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); assert.equal(calls, 1); await assertPreserved(h, initial);
});
test('an account change during old-image cleanup restores the manifest and the already removed old copy', async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose'); await replacement(h);
  const oldImage = path.join(h.directory, initial.revision + '.png'), entered = deferred(), finish = deferred(), state = { valid: true }; let held = true;
  h.manager.io = { ...fs, unlink: async file => { if (held && file === oldImage) { held = false; entered.release(); await finish.promise; } return fs.unlink(file); } };
  const work = h.manager.dispatch('choose', changedGuard(state)); await entered.promise; state.valid = false; finish.release();
  await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); await assertPreserved(h, initial);
});
for (const target of ['manifest', 'image']) test(`an account change during remove ${target} unlink restores both original files`, async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose');
  const file = path.join(h.directory, target === 'manifest' ? 'active.json' : initial.revision + '.png'), entered = deferred(), finish = deferred(), state = { valid: true }; let held = true;
  h.manager.io = { ...fs, unlink: async value => { if (held && value === file) { held = false; entered.release(); await finish.promise; } return fs.unlink(value); } };
  const work = h.manager.dispatch('remove', changedGuard(state)); await entered.promise; state.valid = false; finish.release();
  await assert.rejects(work, { code: 'ACCOUNT_CHANGED' }); await assertPreserved(h, initial);
});
test('a failed background removal restores the original manifest and reports only a Chinese retryable error', async t => {
  const h = await harness(t), initial = await h.manager.dispatch('choose'), file = path.join(h.directory, initial.revision + '.png');
  h.manager.io = { ...fs, unlink: async value => { if (value === file) throw Object.assign(new Error(`EACCES: unlink '${file}'`), { code: 'EACCES' }); return fs.unlink(value); } };
  await assert.rejects(h.manager.dispatch('remove'), error => error.code === 'BACKGROUND_IO' && error.message.includes('稍后重试') && !error.message.includes(h.root));
  await assertPreserved(h, initial);
});
test('filesystem errors while reading background state never expose local paths to the renderer', async t => {
  const h = await harness(t); h.manager.io = { ...fs, mkdir: async () => { throw Object.assign(new Error(`EACCES: mkdir '${h.directory}'`), { code: 'EACCES' }); } };
  await assert.rejects(h.manager.dispatch('state'), error => error.code === 'BACKGROUND_IO' && !error.message.includes(h.directory));
});
