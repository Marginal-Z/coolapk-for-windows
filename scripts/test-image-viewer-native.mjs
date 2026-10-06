// Production main/preloads and built UI; isolated reads and raster bytes only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import electron from 'electron';
import playwright from 'playwright';
const root = path.resolve('.'), directory = path.join(root, '.local/image-viewer-native');
mkdirSync(directory, { recursive: true });
const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(path.join(directory, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
function raster(width, height) {
  const chunk = (name, data) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const index = y * (width * 3 + 1) + 1 + x * 3; pixels[index] = 24 + Math.floor(y / height * 140); pixels[index + 1] = 140; pixels[index + 2] = 88; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const base = 'https://image.coolapk.com/native-viewer/', images = [base + 'long.png', base + 'wide.png'], cover = base + 'cover.png';
const fixtures = { images, cover, long: raster(360, 8000).toString('base64'), wide: raster(800, 400).toString('base64'), small: raster(120, 240).toString('base64') };
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(directory, 'bootstrap.cjs'), `const{app,ipcMain}=require('electron');const f=${JSON.stringify(fixtures)};
globalThis.imageViewerTest={unexpectedReads:[],blockedNetwork:0};
globalThis.fetch=async value=>{const url=String(value);if(f.images.includes(url)||url===f.cover)return new Response(Buffer.from(url===f.images[0]?f.long:url===f.images[1]?f.wide:f.small,'base64'),{headers:{'content-type':'image/png'}});globalThis.imageViewerTest.blockedNetwork++;throw Error('No external network in fixture')};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>handle(channel,channel!=='coolapk:call'?fn:async(event,op,args)=>{const ok=data=>({ok:true,data});if(op==='init'||op==='hotSearch'||op==='homeHotTopics')return ok({data:[],hasMore:false});if(op==='home')return ok({data:[{entityType:'feed',id:'991',uid:'42',username:'图片窗口测试',message:'隔离图片测试',picArr:[{url:f.images[0],coverUrl:f.cover},f.images[1]],replynum:0}],hasMore:false});globalThis.imageViewerTest.unexpectedReads.push(op);return{ok:false,error:{code:'TEST_UNSUPPORTED',message:'Isolated read rejected'}}});
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const desktop = await playwright._electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 });
const checks = [], errors = [], measurements = {};
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.locator('[data-feed-id="991"]').waitFor();
  await page.evaluate(() => localStorage.setItem('coolapk-image-preferences', JSON.stringify({ browsingMode: 'normal', livePhotoAudio: false })));
  await record('photo click opens one independent sandboxed window with restricted bridge', async () => {
    const opened = desktop.waitForEvent('window'); await page.getByRole('button', { name: '查看图片 1', exact: true }).click();
    const viewer = await opened; globalThis.viewer = viewer; viewer.on('pageerror', error => errors.push(error.message));
    await viewer.getByRole('heading', { name: '图片 1 / 2', exact: true }).waitFor();
    assert.equal((await desktop.windows()).length, 2); assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(await viewer.evaluate(() => ({ require: typeof window.require, accounts: typeof window.coolapk.accounts, phone: typeof window.coolapk.phone, node: typeof process })), { require: 'undefined', accounts: 'undefined', phone: 'undefined', node: 'undefined' });
    const denied = await viewer.evaluate(() => window.coolapk.call('action', { type: 'like', id: '991' })); assert.equal(denied.ok, false);
  });
  const viewer = globalThis.viewer;
  await record('preview preference and original action remain effective in the new window', async () => {
    await viewer.waitForFunction(() => document.querySelector('.lightbox img')?.naturalWidth === 120);
    await viewer.getByRole('button', { name: '加载原图', exact: true }).click();
    await viewer.waitForFunction(() => document.querySelector('.lightbox img')?.naturalHeight === 8000);
    await viewer.getByRole('button', { name: '实际大小', exact: true }).click();
  });
  await record('long-image scroll never moves or obscures close and toolbar at minimum window size', async () => {
    await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.getTitle() === '酷安 · 图片').setSize(480, 360); });
    await viewer.locator('.lightbox-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    measurements.longImage = await viewer.evaluate(() => { const close = document.querySelector('button[aria-label="关闭"]').getBoundingClientRect(), scroll = document.querySelector('.lightbox-scroll'); return { closeTop: close.top, closeBottom: close.bottom, height: innerHeight, scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, width: innerWidth, documentWidth: document.documentElement.scrollWidth }; });
    assert.ok(measurements.longImage.scrollTop > 1000); assert.ok(measurements.longImage.closeTop >= 0 && measurements.longImage.closeBottom < measurements.longImage.height);
    assert.equal(measurements.longImage.width, measurements.longImage.documentWidth);
    assert.ok(await viewer.getByRole('button', { name: '关闭', exact: true }).isVisible());
    await viewer.screenshot({ path: path.join(directory, 'long-image-fixed-close.png') });
  });
  await record('keyboard switches images and cross-window image preference storage is live', async () => {
    await viewer.keyboard.press('ArrowRight'); await viewer.getByRole('heading', { name: '图片 2 / 2', exact: true }).waitFor();
    await viewer.keyboard.press('ArrowLeft'); await viewer.getByRole('heading', { name: '图片 1 / 2', exact: true }).waitFor();
    await page.evaluate(() => localStorage.setItem('coolapk-image-preferences', JSON.stringify({ browsingMode: 'original', livePhotoAudio: false })));
    await viewer.waitForFunction(() => document.querySelector('.lightbox img')?.naturalHeight === 8000);
    await page.evaluate(() => localStorage.setItem('coolapk-image-preferences', JSON.stringify({ browsingMode: 'normal', livePhotoAudio: false })));
    await viewer.waitForFunction(() => document.querySelector('.lightbox img')?.naturalWidth === 120);
  });
  await record('native Escape closes the viewer while the main page remains interactive', async () => {
    const closed = viewer.waitForEvent('close'); await viewer.keyboard.press('Escape').catch(failure => { if (!viewer.isClosed()) throw failure; }); await closed;
    assert.equal((await desktop.windows()).length, 1);
    measurements.mainAfterClose = await page.evaluate(() => ({ title: document.title, inputs: [...document.querySelectorAll('input')].map(node => ({ label: node.getAttribute('aria-label'), inert: !!node.closest('[inert]') })), dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.textContent) }));
    await page.getByLabel('搜索酷安', { exact: true }).fill('仍可输入', { timeout: 5000 });
  });
  await record('fixed close button closes a reopened viewer; account change also closes viewers', async () => {
    let opened = desktop.waitForEvent('window'); await page.getByRole('button', { name: '查看图片 1', exact: true }).click(); let next = await opened; await next.getByRole('button', { name: '关闭', exact: true }).waitFor();
    let closed = next.waitForEvent('close'); await next.getByRole('button', { name: '关闭', exact: true }).click(); await closed;
    opened = desktop.waitForEvent('window'); await page.getByRole('button', { name: '查看图片 1', exact: true }).click(); next = await opened; await next.getByRole('heading', { name: '图片 1 / 2', exact: true }).waitFor();
    closed = next.waitForEvent('close'); await page.evaluate(() => window.coolapk.selectAccount('')); await closed;
    assert.equal((await desktop.windows()).length, 1);
  });
  assert.deepEqual(errors, []); assert.deepEqual(await desktop.evaluate(() => globalThis.imageViewerTest.unexpectedReads), []);
  const report = { checkedAt: new Date().toISOString(), version: metadata.version, checks, measurements, errors };
  writeFileSync(path.join(directory, 'checks.json'), JSON.stringify(report, null, 2)); console.log('IMAGE_VIEWER_NATIVE_PASS', checks.length);
} finally { await desktop.close(); }
