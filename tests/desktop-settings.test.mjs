import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { PublicImageCache } from '../core/public-image-cache.mjs';
const { DesktopSettings } = createRequire(import.meta.url)('../electron/desktop-settings.cjs');
const image = size => ({ body: Buffer.alloc(size), type: 'image/png' });
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('public image cache shares concurrent reads and evicts the least recently used content', async () => {
  let reads = 0;
  const cache = new PublicImageCache(async () => { reads++; return image(3); }, 6);
  await Promise.all([cache.read('a'), cache.read('a')]); assert.equal(reads, 1);
  await cache.read('b'); await cache.read('a'); await cache.read('c');
  assert.deepEqual(cache.stats, { entries: 2, bytes: 6 });
  await cache.read('b'); assert.equal(reads, 4);
});
test('cleared image cache cannot be refilled or unlock a fresh request by an older response', async () => {
  const first = gate(), second = gate(); let reads = 0;
  const cache = new PublicImageCache(() => (++reads === 1 ? first.promise : second.promise), 10);
  const old = cache.read('same'); await Promise.resolve(); cache.clear();
  const fresh = cache.read('same'); await Promise.resolve(); first.resolve(image(2)); await old;
  assert.deepEqual(cache.stats, { entries: 0, bytes: 0 });
  const duplicate = cache.read('same'); second.resolve(image(5)); await Promise.all([fresh, duplicate]);
  assert.equal(reads, 2); assert.deepEqual(cache.stats, { entries: 1, bytes: 5 });
});
test('failed or oversized image results are not retained', async () => {
  let reads = 0;
  const cache = new PublicImageCache(async () => { if (++reads === 1) throw Error('network'); return image(20); }, 10);
  await assert.rejects(cache.read('a'), /network/); await cache.read('a'); await cache.read('a');
  assert.equal(reads, 3); assert.deepEqual(cache.stats, { entries: 0, bytes: 0 });
});
function desktop(clear = async () => {}) {
  const scales = [], imageCache = { clears: 0, clear() { this.clears++; } };
  const settings = new DesktopSettings({ webContents: { setZoomFactor: value => scales.push(value), session: { clearCache: clear } }, imageCache, version: 'test' });
  return { settings, scales, imageCache };
}
test('font size and native menu zoom combine and reset keeps the chosen font size', () => {
  const {settings, scales} = desktop(); settings.dispatch('display', {fontSize:'large'}); settings.zoomBy(1);
  assert.ok(Math.abs(scales.at(-1) - 1.265) < 0.001);
  settings.resetZoom(); assert.equal(scales.at(-1), 1.15);
  settings.dispatch('display', {fontSize:'small'}); assert.equal(scales.at(-1), 0.9);
  for (let i=0;i<100;i++)settings.zoomBy(-1); assert.equal(settings.userZoom, 0.75);
  for (let i=0;i<100;i++)settings.zoomBy(1); assert.equal(settings.userZoom, 2);
});
test('desktop settings accept only fixed operations and font options', () => {
  const {settings} = desktop(); assert.deepEqual(settings.dispatch('info'), {version:'test'});
  for (const [op,args] of [['display',{fontSize:'__proto__'}],['display',{fontSize:'large',path:'D:/'}],['display',{fontSize:1.5}],['clearCache',{path:'D:/'}],['clearStorageData',{}],['info',[]]])assert.throws(()=>settings.dispatch(op,args));
});
test('cache cleanup joins concurrent requests and retries browser failure without touching storage', async () => {
  const blocked = gate(); let calls = 0;
  const {settings,imageCache} = desktop(async () => { calls++; if(calls===1){await blocked.promise;throw Error('cache busy');} });
  const first = settings.dispatch('clearCache'), second = settings.dispatch('clearCache');
  assert.equal(first,second); blocked.resolve(); await assert.rejects(first,/cache busy/);
  assert.equal(imageCache.clears,1); assert.equal(calls,1);
  assert.deepEqual(await settings.dispatch('clearCache'),{cleared:true}); assert.equal(calls,2); assert.equal(imageCache.clears,2);
});
