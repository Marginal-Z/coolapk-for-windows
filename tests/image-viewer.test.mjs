import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { ImageViewerManager, viewerPayload } = require('../electron/image-viewer.cjs');
const { AccountScope } = require('../electron/request-scope.cjs');
const { LocalFiles } = require('../electron/local-files.cjs');
const source = 'https://image.coolapk.com/feed/original.png';
const cover = 'https://image.coolapk.com/feed/cover.png';
const video = 'https://video.coolapk.com/feed/live.mp4';
const privateImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=';
const gallery = overrides => ({ images: [source], index: 0, ...overrides });
const message = overrides => ({ contextType: 'message', contextId: '77', index: 0, ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class FakeWindow extends EventEmitter {
  constructor(options, id, load) {
    super(); this.options = options; this.dead = false; this.shows = 0; this.loads = []; this.load = load;
    this.webContents = new EventEmitter(); this.webContents.id = id; this.webContents.mainFrame = {};
    this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
  }
  isDestroyed() { return this.dead; }
  async loadFile(file) { this.loads.push({ file }); await this.load?.(this); }
  async loadURL(url) { this.loads.push({ url }); await this.load?.(this); }
  show() { assert.equal(this.dead, false); this.shows++; }
  close() { if (!this.dead) { this.dead = true; this.emit('closed'); } }
}

function setup(options = {}) {
  class Client { constructor(value = {}) { Object.assign(this, value); this.fetch = value.fetchImpl || (async () => {}); } }
  const scope = new AccountScope();
  const client = new Client({ identity: options.guest ? null : { uid: '101' }, cookie: 'synthetic-session', deviceCode: 'synthetic-device' });
  const state = { modeEpoch: 0, restricted: false, windows: [], privateReads: [], liveReads: [], saves: [], external: [] };
  const manager = new ImageViewerManager({
    projectRoot: path.resolve('.'), devUrl: options.devUrl, icon: 'synthetic-icon.ico', parent: () => 'synthetic-parent',
    capture: () => scope.capture(client), assertCurrent: context => scope.assert(context), modeEpoch: () => state.modeEpoch,
    assertMode: epoch => { if (state.restricted || epoch !== state.modeEpoch) throw Object.assign(new Error('mode changed'), { code: 'TEENAGER_RESTRICTED' }); },
    createWindow: settings => { const window = new FakeWindow(settings, state.windows.length + 1, options.load); state.windows.push(window); return window; },
    readMessage: async (reader, id) => { state.privateReads.push({ reader, id }); return options.readMessage ? options.readMessage(reader, id) : { data: privateImage }; },
    readLive: async (context, args) => { state.liveReads.push({ context, args }); return options.readLive ? options.readLive(context, args) : { data: { url: video } }; },
    saveImage: async (window, args, guard) => { state.saves.push({ window, args }); return options.saveImage ? options.saveImage(window, args, guard) : { saved: true }; },
    openExternal: async url => { state.external.push(url); return undefined; },
  });
  return {
    manager, state, scope, client,
    event: (window = state.windows.at(-1)) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }),
    changeAccount() { scope.changed(); client.identity = { uid: '202' }; },
    changeMode() { state.modeEpoch++; state.restricted = true; },
  };
}

test('public galleries canonicalize official sources while retaining real covers and live context', async () => {
  const myapp = 'https://pp.myapp.com/ma_pic2/0/shot_6633_2_1790172526/0';
  const payload = await viewerPayload({ images: [source.replace('https:', 'http:'), myapp], index: 1, contextType: 'reply', contextId: '123', namespace: 'renderer-owner', items: [{ source, cover, live: true, video: video.replace('https:', 'http:') }, { source: myapp, live: false }] });
  assert.deepEqual(payload, { images: [source, myapp], index: 1, contextType: 'reply', contextId: '123', items: [{ source, cover, live: true, video }, { source: myapp, cover: myapp, live: false }] });
  assert.equal('namespace' in payload, false);
});

test('list, index, context and extra-field bounds reject input before window creation', async () => {
  assert.equal((await viewerPayload(gallery({ images: Array(30).fill(source), index: 29 }))).images.length, 30);
  const invalid = [null, [], {}, gallery({ images: [] }), gallery({ images: Array(31).fill(source) }), gallery({ images: new Array(1) }), gallery({ images: [source, , cover], index: 1 }), gallery({ images: { length: 2 ** 32 } }), gallery({ items: [] }), gallery({ items: {} }), gallery({ contextId: '0' }), gallery({ contextId: '01' }), gallery({ contextId: '1'.repeat(21) }), gallery({ contextId: 123 }), gallery({ contextType: 'unknown' })];
  for (const index of [-1, 1, .5, NaN, Infinity, '0']) invalid.push(gallery({ index }));
  for (const extra of [{ path: 'D:/private.png' }, { cookie: 'synthetic' }, { headers: {} }, { partition: 'persist:account' }]) invalid.push(gallery(extra));
  const h = setup();
  for (const value of invalid) await assert.rejects(h.manager.open(value), { code: 'INPUT' });
  assert.equal(h.state.windows.length, 0); assert.equal(h.manager.slots.size, 0);
});

test('image policy refuses arbitrary hosts, paths, wrapper schemes and credential URLs', async () => {
  const invalid = ['https://evil.test/a.png', 'https://image.coolapk.com.evil.test/a.png', 'https://sub.image.coolapk.com/a.png', 'file:///D:/private.png', 'data:image/png;base64,AA==', 'blob:https://image.coolapk.com/synthetic', 'javascript:alert(1)', 'coolapk-image://image/?url=' + encodeURIComponent(source), 'https://user:pass@image.coolapk.com/a.png', 'https://image.coolapk.com:444/a.png', 'https://image.coolapk.com/a\n.png', source + '?x=' + 'a'.repeat(4096), 'https://pp.myapp.com/private.png', 'https://pp.myapp.com/ma_pic2/0/shot_6633_2_1790172526/0?secret=1'];
  for (const url of invalid) await assert.rejects(viewerPayload(gallery({ images: [url] })), { code: 'INPUT' });
  for (const items of [[{ source: cover }], [{ cover: invalid[0] }], [{ source, live: true }], [{ source, path: 'D:/private.png' }], [{ source, video: invalid[0] }]]) await assert.rejects(viewerPayload(gallery({ items })), { code: 'INPUT' });
});

test('private requests cannot supply bytes or an alternate source to the authenticated reader', async () => {
  assert.deepEqual(await viewerPayload(message()), { images: [], items: [], index: 0, contextType: 'message', contextId: '77' });
  assert.deepEqual(await viewerPayload(message({ images: [], items: [] })), await viewerPayload(message()));
  for (const value of [message({ contextId: '' }), message({ index: 1 }), message({ images: [privateImage] }), message({ images: {} }), message({ images: '' }), message({ items: [{ source }] }), message({ items: {} }), message({ items: null }), message({ url: source }), message({ cookie: 'synthetic' })]) await assert.rejects(viewerPayload(value), { code: 'INPUT' });
  const guest = setup({ guest: true }); await assert.rejects(guest.manager.open(message()), { code: 'INPUT' });
  assert.equal(guest.state.privateReads.length, 0); assert.equal(guest.state.windows.length, 0);
});

test('independent windows load only their local entry and take an immutable gallery snapshot', async () => {
  const h = setup(); const input = gallery({ namespace: 'forged', items: [{ source, cover, live: false }] });
  assert.deepEqual(await h.manager.open(input), { opened: true });
  const window = h.state.windows[0];
  input.images[0] = 'https://evil.test/changed.png'; input.items[0].cover = 'https://evil.test/changed-cover.png';
  const saved = await h.manager.dispatch(h.event(), 'state');
  assert.equal(saved.namespace, '101'); assert.deepEqual(saved.images, [source]); assert.equal(saved.items[0].cover, cover);
  assert.equal(window.options.parent, 'synthetic-parent'); assert.equal(window.options.show, false);
  assert.equal(window.options.webPreferences.sandbox, true); assert.equal(window.options.webPreferences.contextIsolation, true); assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(path.basename(window.options.webPreferences.preload), 'image-viewer-preload.cjs');
  assert.deepEqual(window.loads, [{ file: path.join(path.resolve('.'), 'dist/image-viewer.html') }]); assert.equal(window.shows, 1);
  const development = setup({ devUrl: 'http://127.0.0.1:5173' }); await development.manager.open(gallery());
  assert.deepEqual(development.state.windows[0].loads, [{ url: 'http://127.0.0.1:5173/image-viewer.html' }]);
});

test('registered sender identity and main-frame identity are both required for every operation', async () => {
  const h = setup(); await h.manager.open(gallery()); const window = h.state.windows[0];
  const forged = [{}, { sender: { id: window.webContents.id }, senderFrame: window.webContents.mainFrame }, { sender: window.webContents, senderFrame: {} }, { sender: window.webContents }, { sender: { id: 999 }, senderFrame: {} }];
  for (const event of forged) for (const operation of ['state', 'close', 'save', 'external', 'livePhotoVideo']) await assert.rejects(h.manager.dispatch(event, operation, { url: source }), { code: 'INPUT' });
  assert.equal(window.isDestroyed(), false); assert.equal(h.state.saves.length, 0); assert.equal(h.state.external.length, 0); assert.equal(h.state.liveReads.length, 0);
  await h.manager.open(gallery());
  await assert.rejects(h.manager.dispatch({ sender: window.webContents, senderFrame: h.state.windows[1].webContents.mainFrame }, 'state'), { code: 'INPUT' });
});

test('navigation and new-window requests are denied and only native Escape keyDown closes', async () => {
  const h = setup(); await h.manager.open(gallery()); const window = h.state.windows[0];
  for (const eventName of ['will-navigate', 'will-redirect']) {
    let prevented = false; window.webContents.emit(eventName, { preventDefault() { prevented = true; } }, 'https://evil.test/'); assert.equal(prevented, true);
  }
  assert.deepEqual(window.openHandler({ url: source }), { action: 'deny' }); assert.equal(window.loads.length, 1);
  const event = h.event(); let prevented = 0; const key = { preventDefault() { prevented++; } };
  window.webContents.emit('before-input-event', key, { type: 'keyUp', key: 'Escape' });
  window.webContents.emit('before-input-event', key, { type: 'keyDown', key: 'ArrowRight' }); assert.equal(window.isDestroyed(), false);
  window.webContents.emit('before-input-event', key, { type: 'keyDown', key: 'Escape' });
  assert.equal(prevented, 1); assert.equal(window.isDestroyed(), true); assert.equal(h.manager.windows.size, 0); assert.equal(h.manager.slots.size, 0);
  await assert.rejects(h.manager.dispatch(event, 'state'), { code: 'INPUT' });
});

test('viewer operations cannot choose new sources or invoke the main application API', async () => {
  const h = setup(); await h.manager.open(gallery({ items: [{ source, cover, live: false }] })); const event = h.event();
  for (const operation of ['accounts', 'login', 'publish', 'phone', 'downloads', 'saveExport', 'unsupported']) await assert.rejects(h.manager.dispatch(event, operation, {}), { code: 'INPUT' });
  for (const operation of ['save', 'external']) for (const args of [null, [], {}, { url: cover }, { url: source + '?different=1' }, { url: source, path: 'D:/injected.png' }, { url: source, Cookie: 'synthetic' }]) await assert.rejects(h.manager.dispatch(event, operation, args), { code: 'INPUT' });
  for (const operation of ['state', 'close']) await assert.rejects(h.manager.dispatch(event, operation, {}), { code: 'INPUT' });
  assert.equal(h.state.saves.length, 0); assert.equal(h.state.external.length, 0);
  assert.deepEqual(await h.manager.dispatch(event, 'save', { url: source, name: '../renderer-name' }), { saved: true });
  assert.deepEqual(h.state.saves[0].args, { url: source, name: '酷安原图' }); assert.equal(h.state.saves[0].window, h.state.windows[0]);
  await h.manager.dispatch(event, 'external', { url: source }); assert.deepEqual(h.state.external, [source]);
});

test('the actual dedicated preload exposes only viewer capabilities and routes generic calls to rejection', async () => {
  const h = setup(); await h.manager.open(gallery()); const event = h.event(), exposed = {}, channels = [];
  const electron = { contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } }, ipcRenderer: { invoke: async (channel, operation, args) => { channels.push(channel); return h.manager.dispatch(event, operation, args); } } };
  vm.runInNewContext(readFileSync(new URL('../electron/image-viewer-preload.cjs', import.meta.url), 'utf8'), { require: name => { assert.equal(name, 'electron'); return electron; } });
  assert.deepEqual(Object.keys(exposed.coolapk).sort(), ['call', 'openExternal', 'saveImage']);
  assert.deepEqual(Object.keys(exposed.coolapkImageViewer).sort(), ['close', 'state']);
  assert.deepEqual((await exposed.coolapkImageViewer.state()).images, [source]);
  for (const operation of ['publish', 'messageImage', 'accounts', 'downloads', 'uploadImage']) await assert.rejects(exposed.coolapk.call(operation, { id: '77' }), { code: 'INPUT' });
  await exposed.coolapk.saveImage({ url: source }); await exposed.coolapk.openExternal(source);
  assert.equal(h.state.saves.length, 1); assert.deepEqual(h.state.external, [source]); assert.ok(channels.every(channel => channel === 'coolapk:image-viewer'));
  assert.deepEqual(await exposed.coolapkImageViewer.close(), { closed: true }); assert.equal(h.manager.windows.size, 0);
});

test('private state contains authenticated raster bytes but exposes no public image operations', async () => {
  const h = setup(); await h.manager.open(message({ namespace: 'forged' })); const event = h.event(); const payload = await h.manager.dispatch(event, 'state');
  assert.deepEqual(payload.images, [privateImage]); assert.equal(payload.namespace, '101'); assert.equal(payload.contextId, '77');
  assert.equal(h.state.privateReads[0].id, '77'); assert.equal(h.state.privateReads[0].reader.identity.uid, '101'); assert.equal(JSON.stringify(payload).includes('synthetic-session'), false);
  for (const operation of ['save', 'external']) await assert.rejects(h.manager.dispatch(event, operation, { url: privateImage }), { code: 'INPUT' });
  await assert.rejects(h.manager.dispatch(event, 'livePhotoVideo', { picUrl: source, id: '77', contentType: 'message' }), { code: 'INPUT' });
  assert.equal(h.state.saves.length, 0); assert.equal(h.state.external.length, 0); assert.equal(h.state.liveReads.length, 0);
});

test('malformed or oversized private-reader results cannot create a window', async () => {
  const invalid = [null, '', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PGh0bWw+', 'data:image/png;base64,', 'data:image/png;base64,AA==\n', 'data:image/png;base64,' + 'A'.repeat(17 * 1024 ** 2), { length: 2 ** 32 }];
  for (const data of invalid) {
    const h = setup({ readMessage: async () => ({ data }) }); await assert.rejects(h.manager.open(message()), { code: 'INPUT' });
    assert.equal(h.state.windows.length, 0); assert.equal(h.manager.slots.size, 0);
  }
});

for (const transition of ['account', 'mode', 'closeAll']) test(`${transition} during private fetch cannot create a late window`, async () => {
  const entered = deferred(), pending = deferred(); const h = setup({ readMessage: () => { entered.resolve(); return pending.promise; } });
  const opening = h.manager.open(message()); await entered.promise;
  if (transition === 'account') h.changeAccount(); else if (transition === 'mode') h.changeMode(); else h.manager.closeAll();
  pending.resolve({ data: privateImage });
  await assert.rejects(opening, { code: transition === 'account' ? 'ACCOUNT_CHANGED' : transition === 'mode' ? 'TEENAGER_RESTRICTED' : 'INPUT' });
  assert.equal(h.state.windows.length, 0); assert.equal(h.manager.windows.size, 0); assert.equal(h.manager.slots.size, 0);
});

for (const transition of ['account', 'mode', 'closeAll', 'nativeClose']) test(`${transition} during entry loading prevents a successful or visible window`, async () => {
  const entered = deferred(), pending = deferred(); const h = setup({ load: () => { entered.resolve(); return pending.promise; } });
  const opening = h.manager.open(gallery()); await entered.promise; const window = h.state.windows[0];
  if (transition === 'account') h.changeAccount(); else if (transition === 'mode') h.changeMode(); else if (transition === 'closeAll') h.manager.closeAll(); else window.close();
  pending.resolve();
  await assert.rejects(opening, { code: transition === 'account' ? 'ACCOUNT_CHANGED' : transition === 'mode' ? 'TEENAGER_RESTRICTED' : 'INPUT' });
  assert.equal(window.isDestroyed(), true); assert.equal(window.shows, 0); assert.equal(h.manager.windows.size, 0); assert.equal(h.manager.slots.size, 0);
});

test('failed entry loads release capacity and permit a subsequent independent window', async () => {
  let fail = true; const h = setup({ load: async () => { if (fail) throw new Error('synthetic load failed'); } });
  await assert.rejects(h.manager.open(gallery()), /synthetic load failed/); assert.equal(h.state.windows[0].isDestroyed(), true); assert.equal(h.manager.slots.size, 0);
  fail = false; assert.deepEqual(await h.manager.open(gallery()), { opened: true }); assert.equal(h.manager.windows.size, 1);
  h.manager.closeAll(); h.manager.closeAll(); assert.equal(h.manager.windows.size, 0); assert.equal(h.manager.slots.size, 0);
});

test('eight loading windows consume eight slots once and native closing releases a slot', async () => {
  const entered = deferred(), pending = deferred(); let loads = 0;
  const h = setup({ load: () => { if (++loads === 8) entered.resolve(); return pending.promise; } });
  const openings = Array.from({ length: 8 }, () => h.manager.open(gallery())); await entered.promise;
  assert.equal(h.state.windows.length, 8); assert.equal(h.manager.slots.size, 8);
  await assert.rejects(h.manager.open(gallery()), { code: 'INPUT' }); pending.resolve(); await Promise.all(openings);
  await assert.rejects(h.manager.open(gallery()), { code: 'INPUT' }); h.state.windows[0].close();
  assert.deepEqual(await h.manager.open(gallery()), { opened: true }); assert.equal(h.manager.slots.size, 8);
  h.manager.closeAll(); assert.equal(h.manager.slots.size, 0);
});

test('pending private reads are bounded and cancelled reads release their reservations', async () => {
  const entered = deferred(), pending = deferred(); let reads = 0;
  const h = setup({ readMessage: () => { if (++reads === 8) entered.resolve(); return pending.promise; } });
  const openings = Array.from({ length: 8 }, () => h.manager.open(message())); await entered.promise;
  await assert.rejects(h.manager.open(message()), { code: 'INPUT' }); assert.equal(h.state.windows.length, 0);
  h.manager.closeAll(); pending.resolve({ data: privateImage }); const outcomes = await Promise.allSettled(openings);
  assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason.code === 'INPUT')); assert.equal(h.manager.slots.size, 0); assert.equal(h.state.windows.length, 0);
  assert.deepEqual(await h.manager.open(message()), { opened: true }); h.manager.closeAll();
});

test('live-photo reads use the captured account and exact permitted item/context only', async () => {
  for (const contextType of ['feed', 'reply', 'article']) {
    const h = setup(); await h.manager.open(gallery({ contextType, contextId: '123', items: [{ source, cover, live: true }] })); const event = h.event();
    const args = { picUrl: source, id: '123', contentType: contextType };
    for (const extra of [{ id: '124' }, { contentType: 'message' }, { picUrl: cover }, { Cookie: 'synthetic' }, { url: video }]) await assert.rejects(h.manager.dispatch(event, 'livePhotoVideo', { ...args, ...extra }), { code: 'INPUT' });
    assert.equal(h.state.liveReads.length, 0);
    assert.deepEqual(await h.manager.dispatch(event, 'livePhotoVideo', args), { data: { url: video } });
    assert.deepEqual(h.state.liveReads[0].args, args); assert.equal(h.state.liveReads[0].context.client.identity.uid, '101'); h.manager.closeAll();
  }
  const ordinary = setup(); await ordinary.manager.open(gallery({ contextId: '123' }));
  await assert.rejects(ordinary.manager.dispatch(ordinary.event(), 'livePhotoVideo', { picUrl: source, id: '123', contentType: 'feed' }), { code: 'INPUT' }); assert.equal(ordinary.state.liveReads.length, 0);
});

for (const transition of ['account', 'mode', 'nativeClose']) test(`${transition} during live-photo resolution cannot return a late account result`, async () => {
  const entered = deferred(), pending = deferred(); const h = setup({ readLive: () => { entered.resolve(); return pending.promise; } });
  await h.manager.open(gallery({ contextId: '123', items: [{ source, live: true }] }));
  const resolving = h.manager.dispatch(h.event(), 'livePhotoVideo', { picUrl: source, id: '123', contentType: 'feed' }); await entered.promise;
  if (transition === 'account') h.changeAccount(); else if (transition === 'mode') h.changeMode(); else h.state.windows[0].close();
  pending.resolve({ data: { url: video } }); await assert.rejects(resolving, { code: transition === 'account' ? 'ACCOUNT_CHANGED' : transition === 'mode' ? 'TEENAGER_RESTRICTED' : 'INPUT' });
});

for (const phase of ['fetch', 'dialog']) for (const transition of ['account', 'mode', 'nativeClose']) test(`${transition} during original-image ${phase} prevents a filesystem write`, async () => {
  const entered = deferred(), pending = deferred(); const writes = [], dialogs = [];
  const h = setup({ saveImage: (window, args, guard) => new LocalFiles({ parent: () => window, fetchImage: async () => { if (phase === 'fetch') { entered.resolve(); await pending.promise; } return { body: Buffer.from('synthetic raster bytes'), type: 'image/png' }; }, dialog: { showSaveDialog: async parent => { dialogs.push(parent); if (phase === 'dialog') { entered.resolve(); await pending.promise; } return { filePath: 'D:/chosen/viewer.png' }; } }, writeFile: async (...args) => writes.push(args) }).saveImage(args, guard) });
  await h.manager.open(gallery()); const saving = h.manager.dispatch(h.event(), 'save', { url: source }); await entered.promise;
  if (transition === 'account') h.changeAccount(); else if (transition === 'mode') h.changeMode(); else h.state.windows[0].close();
  pending.resolve(); await assert.rejects(saving, { code: transition === 'account' ? 'ACCOUNT_CHANGED' : transition === 'mode' ? 'TEENAGER_RESTRICTED' : 'INPUT' });
  assert.equal(writes.length, 0); if (phase === 'fetch') assert.equal(dialogs.length, 0); else assert.equal(dialogs[0], h.state.windows[0]);
});

test('stale viewers refuse state/actions but can still close themselves', async () => {
  const h = setup(); await h.manager.open(gallery()); const event = h.event(); h.changeAccount();
  for (const operation of ['state', 'save', 'external']) await assert.rejects(h.manager.dispatch(event, operation, operation === 'state' ? undefined : { url: source }), { code: 'ACCOUNT_CHANGED' });
  assert.equal(h.state.saves.length, 0); assert.equal(h.state.external.length, 0);
  assert.deepEqual(await h.manager.dispatch(event, 'close'), { closed: true }); assert.equal(h.manager.windows.size, 0);
});
