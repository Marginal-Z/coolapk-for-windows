import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/video-autoload-check';
const port = Number(process.env.COOLAPK_VIDEO_AUTOLOAD_PORT || 5326);
const origin = `http://127.0.0.1:${port}`;
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script>');
writeFileSync(`${output}/fixture.tsx`, `import React from 'react';import{createRoot}from'react-dom/client';import{FeedCard}from'/src/components.tsx';function Harness(){return <FeedCard feed={{id:'123',uid:'5',username:'test',message:'视频测试',videoUrl:'https://video.coolapk.com/test.mp4',media_pic:'https://image.coolapk.com/test.jpg'}} onOpen={()=>{}} onUser={()=>{}} onLink={()=>{}} onLogin={()=>{}} onForward={()=>{}} loggedIn={false} autoLoadVideoWhenWifi={true} toast={()=>{}}/>}createRoot(document.getElementById('root')).render(<Harness/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const connection = new EventTarget(); connection.type = 'cellular'; connection.saveData = false; window.__network = connection;
    Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
    window.__intersectionCallbacks = [];
    window.IntersectionObserver = class { constructor(callback) { this.callback = callback; window.__intersectionCallbacks.push(this); } observe(target) { this.target = target; } disconnect() {} };
    window.__showVideo = () => window.__intersectionCallbacks.forEach(observer => observer.callback([{ target: observer.target, isIntersecting: true }]));
    window.__setNetwork = type => { connection.type = type; connection.dispatchEvent(new Event('change')); };
    const nativeSetAttribute = Element.prototype.setAttribute, nativeGetAttribute = Element.prototype.getAttribute;
    Element.prototype.setAttribute = function(name, value) { if (this instanceof HTMLMediaElement && name.toLowerCase() === 'src') { this.dataset.mockSrc = String(value); return; } nativeSetAttribute.call(this, name, value); };
    Element.prototype.getAttribute = function(name) { if (this instanceof HTMLMediaElement && name.toLowerCase() === 'src') return this.dataset.mockSrc ?? null; return nativeGetAttribute.call(this, name); };
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return this.dataset.mockSrc || ''; }, set(value) { this.dataset.mockSrc = String(value); } });
    HTMLMediaElement.prototype.play = function() { this.dataset.playCalled = 'true'; return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function() { this.dataset.pauseCalled = 'true'; };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/${output}/fixture.html`);
  await page.getByRole('button', { name: '播放视频' }).waitFor();
  await page.evaluate(() => window.__setNetwork('wifi'));
  await page.waitForTimeout(50);
  assert.equal(await page.locator('video').count(), 0, 'must wait until card enters the viewport');
  await page.evaluate(() => window.__showVideo());
  const video = page.locator('.feed-video video'); await video.waitFor();
  assert.equal(await video.evaluate(node => node.dataset.mockSrc), 'https://video.coolapk.com/test.mp4');
  assert.equal(await video.evaluate(node => node.autoplay), true);
  assert.equal(await video.evaluate(node => node.muted), true);
  await page.waitForFunction(() => document.querySelector('.feed-video video')?.dataset.playCalled === 'true');
  await page.evaluate(() => window.__setNetwork('cellular'));
  await page.waitForFunction(() => document.querySelector('.feed-video video')?.dataset.pauseCalled === 'true');
  assert.deepEqual(errors, []);
  writeFileSync('research/video-autoload-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), packageVersion, result: 'passed', transport: 'Isolated Edge renderer; synthetic connection changes and mocked media element; no external video request', checks: ['Wi-Fi setting plus visible card requests autoplay', 'autoplay is muted', 'non-Wi-Fi transition pauses autoplay', 'off-screen card stays manual'] }, null, 2) + '\n');
  console.log('VIDEO_AUTOLOAD_PASS', JSON.stringify({ version: packageVersion, visibleWifiAutoplay: true, muted: true, cellularPause: true }));
} finally {
  await browser?.close();
  await server.close();
}
