import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve('.local/live-photo-check'), port = Number(process.env.COOLAPK_LIVE_PHOTO_TEST_PORT || 5179), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Attachments,uploadAttachments}from'/src/Attachments';import{LivePhoto}from'/src/LivePhoto';import'/src/styles.css';function Fixture(){const[values,setValues]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(''),[namespace,setNamespace]=useState('synthetic-account-a');window.__liveNamespace=setNamespace;async function send(){setBusy(true);setError('');try{const result=await uploadAttachments(values,()=>{}, {shouldContinue:()=>window.__liveMock.current});setDone(result)}catch(e){setError(e.message)}finally{setBusy(false)}}return <main data-namespace={namespace}><Attachments values={values} onChange={setValues} disabled={busy} onError={setError}/><button onClick={send}>上传附件</button><p role="status">{done}</p>{error&&<p role="alert">{error}</p>}<LivePhoto namespace={namespace} picUrl="https://image.coolapk.com/a.live.jpg" id="77" contentType="reply"/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__liveMock = { calls: [], current: true, fail: false, noLiveFlag: false, afterUploadSwitch: false, resolverPending: false, resolverCompleted: 0, release: undefined };
    window.createImageBitmap = async () => ({ width: 32, height: 24, close() {} });
    window.coolapk = { call: async (operation, args) => {
      mock.calls.push({ operation, id: args.id, contentType: args.contentType, imageBytes: args.bytes?.length, videoBytes: args.videoBytes?.length });
      if (operation === 'livePhotoVideo') { if (mock.resolverPending) await new Promise(resolve => { mock.release = resolve; }); mock.resolverCompleted++; return { ok: true, data: { data: { url: 'https://video.coolapk.com/a.mp4' } } }; }
      if (mock.fail) return { ok: false, error: { code: 'HTTP', message: '实况视频上传失败，未作为静态图片发送' } };
      if (mock.afterUploadSwitch) mock.current = false;
      return { ok: true, data: { data: 'https://image.coolapk.com/uploaded.live.png', livePhoto: !mock.noLiveFlag } };
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  if (process.env.COOLAPK_LIVE_PHOTO_TEST_CPU_RATE) {
    const rate = Number(process.env.COOLAPK_LIVE_PHOTO_TEST_CPU_RATE); assert.ok(rate >= 1 && rate <= 20, 'CPU test rate must be between 1 and 20');
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
  }
  const imageFile = { name: 'still.png', mimeType: 'image/png', buffer: Buffer.from('synthetic image bytes') }, videoFile = { name: 'motion.mp4', mimeType: 'video/mp4', buffer: Buffer.from('synthetic video bytes') };
  async function start() { await page.goto(`${origin}/.local/live-photo-check/test.html`); await page.getByRole('button', { name: '上传附件' }).waitFor(); await page.getByLabel('添加图片附件').setInputFiles(imageFile); }
  const bind = () => page.getByLabel('绑定图片 1 的实况视频').setInputFiles(videoFile);
  const calls = () => page.evaluate(() => window.__liveMock.calls);
  await record('attachments pair and unpair video without changing ordinary image contract', async () => {
    await start(); await bind(); await page.getByText('motion.mp4', { exact: true }).waitFor(); await page.getByRole('button', { name: '取消实况视频' }).click();
    await page.getByRole('button', { name: '上传附件' }).click(); await page.getByRole('status').filter({ hasText: 'uploaded.live.png' }).waitFor(); assert.equal((await calls()).at(-1).operation, 'uploadImage');
  });
  await record('paired attachment sends both byte arrays and requires live success flag', async () => {
    await start(); await bind(); await page.getByRole('button', { name: '上传附件' }).click(); await page.getByRole('status').filter({ hasText: 'uploaded.live.png' }).waitFor();
    const upload = (await calls()).at(-1); assert.equal(upload.operation, 'uploadLivePhoto'); assert.ok(upload.videoBytes > 0 && upload.imageBytes > 0);
    await start(); await bind(); await page.evaluate(() => { window.__liveMock.noLiveFlag = true; }); await page.getByRole('button', { name: '上传附件' }).click(); await page.getByRole('alert').filter({ hasText: '未确认实况照片' }).waitFor(); assert.equal(await page.getByRole('status').innerText(), '');
  });
  await record('video upload failure never falls back to static image or caches a success URL', async () => {
    await start(); await bind(); await page.evaluate(() => { window.__liveMock.fail = true; }); await page.getByRole('button', { name: '上传附件' }).click();
    await page.getByRole('alert').filter({ hasText: '未作为静态图片发送' }).waitFor(); assert.equal(await page.getByRole('status').innerText(), ''); assert.equal((await calls()).filter(item => item.operation === 'uploadImage').length, 0);
    await page.evaluate(() => { window.__liveMock.fail = false; }); await page.getByRole('button', { name: '上传附件' }).click(); await page.getByRole('status').filter({ hasText: 'uploaded.live.png' }).waitFor(); assert.equal((await calls()).filter(item => item.operation === 'uploadLivePhoto').length, 2);
  });
  await record('attachment generation cancellation ignores results after account/page switch', async () => {
    await start(); await bind(); await page.evaluate(() => { window.__liveMock.afterUploadSwitch = true; }); await page.getByRole('button', { name: '上传附件' }).click(); await page.getByRole('alert').filter({ hasText: '账号或页面已切换' }).waitFor(); assert.equal(await page.getByRole('status').innerText(), '');
  });
  await record('live preview resolves correct content type and ignores late account result', async () => {
    await start(); await page.evaluate(() => { window.__liveMock.resolverPending = true; }); await page.getByRole('button', { name: '播放实况照片' }).click();
    await page.waitForFunction(() => !!window.__liveMock.release && document.querySelector('.live-photo-cover')?.disabled === true); await page.evaluate(() => { window.__liveNamespace('synthetic-account-b'); });
    // The old loading button remains mounted. Visibility alone does not prove
    // the new account committed or that its generation-reset effect ran.
    await page.waitForFunction(() => document.querySelector('main')?.dataset.namespace === 'synthetic-account-b' && document.querySelector('.live-photo-cover')?.disabled === false);
    await page.evaluate(async () => {
      window.__lateVideoInsertions = [];
      const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof Element && (node.matches('video') || node.querySelector('video'))) window.__lateVideoInsertions.push('video'); });
      observer.observe(document.querySelector('.live-photo'), { childList: true, subtree: true });
      window.__liveMock.release();
      // Drain the resolver's continuation and renderer frames while retaining
      // evidence of even a transient stale video before any media-error removal.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer.disconnect();
    });
    assert.equal(await page.evaluate(() => window.__liveMock.resolverCompleted), 1); assert.deepEqual(await page.evaluate(() => window.__lateVideoInsertions), []);
    assert.equal(await page.getByLabel('实况照片视频').count(), 0); const resolver = (await calls()).find(item => item.operation === 'livePhotoVideo'); assert.equal(resolver.contentType, 'reply'); assert.equal(resolver.id, '77');
    await page.evaluate(() => { window.__liveMock.resolverPending = false; }); await page.getByRole('button', { name: '播放实况照片' }).click();
    await page.getByText('实况照片视频无法播放，请重试或使用支持此视频编码的客户端', { exact: true }).waitFor();
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/live-photo-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic isolated renderer; external network blocked; no real account writes', protocolTestCount: 8, checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
