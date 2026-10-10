// Exercise the real shared viewer with decodable local rasters. No cloud writes,
// credentials or native windows are used; native chrome is checked separately.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = '.local/image-viewer-zoom', port = Number(process.env.COOLAPK_IMAGE_ZOOM_TEST_PORT || 5257), origin = `http://127.0.0.1:${port}`;
const checks = [], errors = [], measurements = {};
mkdirSync(directory, { recursive: true });
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
function raster(width, height) {
  const chunk = (name, data) => { const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const index = y * (width * 3 + 1) + 1 + x * 3; pixels[index] = 24 + Math.floor(y / height * 140); pixels[index + 1] = 140; pixels[index + 2] = 88; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const images = ['https://fixtures.invalid/zoom-fixture/long.png', 'https://fixtures.invalid/zoom-fixture/wide.png'];
writeFileSync(`${directory}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${directory}/fixture.tsx`, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ImageViewerContent}from'/src/components';import'/src/styles.css';function Harness(){const[mode,setMode]=useState('fallback'),[open,setOpen]=useState(true);window.__viewerMode=value=>{setMode(value);setOpen(true)};return open?<ImageViewerContent key={mode} images={${JSON.stringify(images)}} items={[{source:${JSON.stringify(images[0])},cover:${JSON.stringify(images[0])},live:mode==='live',video:'https://video.coolapk.com/zoom-fixture/live.mp4'},{source:${JSON.stringify(images[1])},cover:${JSON.stringify(images[1])},live:false}]} index={0} namespace="fixture" contextId="991" contextType={mode==='private'?'message':'feed'} standalone={mode!=='fallback'} onClose={()=>{window.__closed=(window.__closed||0)+1;setOpen(false)}}/>:<p>图片已关闭</p>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser, releaseVideo, activePage;
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  await context.addInitScript(() => {
    localStorage.setItem('coolapk-image-preferences', JSON.stringify({ version: 1, browsingMode: 'original', livePhotoAudio: false }));
    window.__saved = []; window.__external = []; window.__calls = [];
    window.coolapk = { saveImage: async args => { window.__saved.push(args); return { ok: true, data: { saved: true, name: 'fixture.png' } }; }, openExternal: async url => { window.__external.push(url); return { ok: true, data: true }; }, call: async (operation, args) => { window.__calls.push({ operation, args }); return { ok: false, error: { code: 'TEST_UNEXPECTED', message: 'Unexpected cloud operation' } }; } };
  });
  const long = raster(400, 8000), wide = raster(800, 400);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (images.includes(url)) return route.fulfill({ contentType: 'image/png', body: url === images[0] ? long : wide });
    if (url === 'https://video.coolapk.com/zoom-fixture/live.mp4') { await new Promise(resolve => { releaseVideo = resolve; }); return route.abort(); }
    return route.abort();
  });
  const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/${directory}/fixture.html`);
  const image = () => page.locator('.lightbox img');
  const metrics = () => page.evaluate(() => {
    const img = document.querySelector('.lightbox img'), scroll = document.querySelector('.lightbox-scroll'), tools = document.querySelector('.lightbox-tools').getBoundingClientRect();
    const bounds = img.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, scrollTop: scroll.scrollTop, toolbarTop: tools.top, toolbarBottom: tools.bottom, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
  const scale = () => page.getByLabel('图片缩放比例', { exact: true });
  await record('browser fallback fits a long image and retains a reachable portal close button', async () => {
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.naturalHeight === 8000 && document.querySelector('.lightbox img')?.getBoundingClientRect().height < 800);
    const dialog = page.getByRole('dialog', { name: '图片 1 / 2', exact: true });
    assert.equal(await dialog.evaluate(node => node.parentElement.parentElement === document.body), true);
    assert.equal(await page.getByRole('button', { name: '关闭', exact: true }).count(), 1);
    measurements.fit = await metrics(); assert.ok(measurements.fit.height <= measurements.fit.clientHeight); assert.equal(measurements.fit.documentWidth, measurements.fit.viewportWidth);
  });
  await record('fit below ten percent shares the same bounds across buttons, keys and Ctrl wheel', async () => {
    const height = measurements.fit.height;
    assert.ok(height / 8000 < .1, 'The fixture must exercise a fit smaller than 10%');
    assert.equal(await page.getByRole('button', { name: '缩小图片', exact: true }).isDisabled(), true);
    await page.keyboard.press('-');
    assert.equal(await image().evaluate(node => node.getBoundingClientRect().height), height);
    assert.equal(await page.getByRole('button', { name: '实际大小', exact: true }).count(), 1);
    await page.locator('.lightbox-scroll').evaluate(node => node.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(await image().evaluate(node => node.getBoundingClientRect().height), height);
    await page.keyboard.press('+');
    await page.waitForFunction(height => Math.abs(document.querySelector('.lightbox img')?.getBoundingClientRect().height - height * 1.25) < .1, height);
    await page.getByRole('button', { name: '缩小图片', exact: true }).click();
    await page.waitForFunction(height => Math.abs(document.querySelector('.lightbox img')?.getBoundingClientRect().height - height) < .1, height);
    await page.keyboard.press('0');
    await page.getByRole('button', { name: '放大图片', exact: true }).click();
    await page.waitForFunction(height => Math.abs(document.querySelector('.lightbox img')?.getBoundingClientRect().height - height * 1.25) < .1, height);
    await page.locator('.lightbox-scroll').evaluate(node => node.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true })));
    await page.waitForFunction(height => Math.abs(document.querySelector('.lightbox img')?.getBoundingClientRect().height - height) < .1, height);
    await page.keyboard.press('0');
  });
  await record('toolbar zoom changes real image pixels, scrolls long content and stays outside image scroll', async () => {
    await page.getByRole('button', { name: '实际大小', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 8000);
    await page.getByRole('button', { name: '放大图片', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 10000); assert.equal(await scale().innerText(), '125%');
    await page.getByRole('button', { name: '缩小图片', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 8000);
    await page.locator('.lightbox-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    measurements.long = await metrics(); assert.ok(measurements.long.scrollTop > 1000); assert.ok(measurements.long.toolbarTop >= 0 && measurements.long.toolbarBottom <= measurements.long.viewportHeight);
    const close = page.getByRole('button', { name: '关闭', exact: true });
    assert.equal(await close.evaluate(node => { const bounds = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); }), true);
  });
  await record('zoom boundaries are enforced, plus/minus and zero/one shortcuts work', async () => {
    for (let index = 0; index < 20; index++) await page.keyboard.press('+');
    assert.equal(await scale().innerText(), '800%'); assert.equal(await page.getByRole('button', { name: '放大图片', exact: true }).isDisabled(), true);
    assert.equal(await image().evaluate(node => node.getBoundingClientRect().height), 64000);
    for (let index = 0; index < 30; index++) await page.keyboard.press('-');
    assert.equal(await scale().innerText(), `${Math.round(measurements.fit.height / 8000 * 100)}%`); assert.equal(await page.getByRole('button', { name: '缩小图片', exact: true }).isDisabled(), true);
    await page.keyboard.press('1'); assert.equal(await scale().innerText(), '100%');
    await page.keyboard.press('0'); await page.getByRole('button', { name: '实际大小', exact: true }).waitFor();
    assert.ok((await metrics()).height < 800);
  });
  await record('ordinary mouse wheel zooms the image without zooming the document', async () => {
    await page.keyboard.press('1');
    await page.locator('.lightbox-scroll').hover(); await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 10000);
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);
    assert.equal(await scale().innerText(), '125%');
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 8000);
    assert.equal(await scale().innerText(), '100%');
  });
  await record('switching images restores fit and resizing keeps every toolbar control reachable', async () => {
    await page.keyboard.press('ArrowRight'); await page.getByRole('heading', { name: '图片 2 / 2', exact: true }).waitFor();
    await page.getByRole('button', { name: '实际大小', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.naturalWidth === 800);
    await page.setViewportSize({ width: 480, height: 360 });
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().width < 440);
    measurements.small = await metrics(); assert.equal(measurements.small.documentWidth, measurements.small.viewportWidth); assert.ok(measurements.small.toolbarBottom <= measurements.small.viewportHeight);
    for (const name of ['放大图片', '缩小图片', '保存原图', '实际大小', '关闭']) assert.equal(await page.getByRole('button', { name, exact: true }).isVisible(), true);
    await page.screenshot({ path: `${directory}/zoom-small-window.png` });
  });
  await record('saving after zoom retains the original source and closing the fallback remains functional', async () => {
    await page.getByRole('button', { name: '放大图片', exact: true }).click();
    await page.getByRole('button', { name: '保存原图', exact: true }).click(); await page.waitForFunction(() => window.__saved.length === 1);
    assert.equal(await page.evaluate(() => window.__saved[0].url), images[1]);
    await page.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByText('图片已关闭', { exact: true }).waitFor();
  });
  await record('standalone omits inner close; private images zoom without exposing original-save or external actions', async () => {
    await page.evaluate(() => window.__viewerMode('private'));
    await page.getByRole('heading', { name: '私信图片', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="放大图片"]').disabled);
    assert.equal(await page.getByRole('button', { name: '关闭', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '保存原图', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '查看原图', exact: true }).count(), 0);
    await page.keyboard.press('1'); await page.getByRole('button', { name: '放大图片', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 10000);
    await page.keyboard.press('Escape'); await page.getByText('图片已关闭', { exact: true }).waitFor();
  });
  await record('live photo cover and real video retain scaled dimensions and playback controls', async () => {
    await page.evaluate(() => window.__viewerMode('live'));
    await page.getByRole('heading', { name: '图片 1 / 2', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="放大图片"]').disabled);
    await page.keyboard.press('1'); await page.getByRole('button', { name: '放大图片', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.lightbox img')?.getBoundingClientRect().height === 10000);
    await page.getByRole('button', { name: '播放实况照片', exact: true }).click();
    const video = page.getByLabel('实况照片视频', { exact: true }); await video.waitFor();
    assert.equal(await video.evaluate(node => node.getBoundingClientRect().height), 10000); assert.equal(await video.evaluate(node => node.muted), true);
    assert.equal(await page.getByRole('button', { name: '开启实况声音', exact: true }).isVisible(), true);
    await page.keyboard.press('Escape'); await page.getByText('图片已关闭', { exact: true }).waitFor();
  });
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__calls), []);
  writeFileSync(`${directory}/checks.json`, JSON.stringify({ checkedAt: new Date().toISOString(), checks, measurements, errors, note: 'Synthetic images and a held HTML video request; native titlebar close and encoded playback are separate checks', result: 'passed' }, null, 2) + '\n');
  console.log('IMAGE_VIEWER_ZOOM_PASS', checks.length);
  releaseVideo?.(); await context.close();
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error(JSON.stringify(await activePage.evaluate(() => ({ html: document.querySelector('.lightbox')?.outerHTML, metrics: [...document.querySelectorAll('.lightbox,.lightbox-scroll,.lightbox-media,.lightbox img')].map(node => ({ className: node.className, rect: node.getBoundingClientRect().toJSON(), height: node.clientHeight, width: node.clientWidth, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight })), errors: document.body.textContent })), null, 2));
    await activePage.screenshot({ path: `${directory}/failed.png` });
  }
  throw error;
} finally { releaseVideo?.(); await browser?.close(); await server.close(); }
