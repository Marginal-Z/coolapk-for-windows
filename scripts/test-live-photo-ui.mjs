import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/photo-gallery-check', { recursive: true });
writeFileSync('.local/photo-gallery-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{FeedCard}from'/src/components.tsx';import Detail from'/src/Detail.tsx';import{photoItems}from'/src/photo-items.ts';import'/src/styles.css';
window.__photoItems=photoItems;function Harness(){const[view,setView]=useState('feed');useEffect(()=>{window.__photoNavigate=setView},[]);const props={accountUid:'42',loggedIn:true,onOpen:()=>setView('detail'),onUser:()=>{},onLink:()=>{},onLogin:()=>{},onForward:()=>{},toast:()=>{}};return React.createElement('main',{style:{maxWidth:'900px',margin:'auto',padding:'24px'}},view==='detail'?React.createElement(Detail,{feed:window.__photoMock.feed,namespace:'42',feedProps:props,onClose:()=>setView('feed')}):React.createElement(FeedCard,{feed:view==='article'?window.__photoMock.article:window.__photoMock.feed,...props,detailed:true}))};createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
</script></body></html>`);
const port = Number(process.env.COOLAPK_PHOTO_GALLERY_TEST_PORT || 5183), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(title, test) { await test(); checks.push(title); console.log('PASS', title); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1320, height: 920 }, bypassCSP: true });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const source = 'https://image.coolapk.com/feed/synthetic-livepic@4x4.png', cover = 'https://image.coolapk.com/feed/synthetic-cover.png';
    const feed = { entityType: 'feed', id: '701', uid: '43', username: '模拟酷友', message: '带实况照片的动态', imageUriList: [{ sourceUrl: source, compressedUrl: cover, livePhotoEnable: 1 }] };
    const reply = { id: '702', uid: '43', username: '模拟酷友', message: '带实况照片的评论', image_uri_list: [{ source_url: source, compressed_url: cover, live_photo_enable: '1' }] };
    const article = { ...feed, id: '703', is_html_article: 1, message_title: '实况照片文章', imageUriList: [], message: JSON.stringify([{ type: 'text', message: '文章正文' }, { type: 'image', url: source, description: '正文实况图片', is_live_photo: true }]) };
    const mock = window.__photoMock = { feed, reply, article, source, cover, calls: [] };
    window.coolapk = { openExternal: async () => ({ ok: true, data: {} }), call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: structuredClone(args) }); const ok = data => ({ ok: true, data: { data, hasMore: false } });
      if (operation === 'detail') return ok(feed); if (operation === 'replies') return ok([reply]); if (operation === 'livePhotoVideo') return ok({ url: 'https://video.coolapk.com/synthetic-unavailable.mp4' }); return ok([]);
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/photo-gallery-harness.html');
  await record('metadata normalization preserves original/cover/live fields and rejects executable URLs', async () => {
    const result = await page.evaluate(() => ({ actual: window.__photoItems(window.__photoMock.feed), fallback: window.__photoItems({ pic: 'https://image.coolapk.com/ordinary.png' }), unsafe: window.__photoItems({ pic: 'javascript:alert(1)' }) }));
    assert.deepEqual(result.actual, [{ source: 'https://image.coolapk.com/feed/synthetic-livepic@4x4.png', cover: 'https://image.coolapk.com/feed/synthetic-cover.png', video: '', live: true }]); assert.equal(result.fallback[0].live, false); assert.deepEqual(result.unsafe, []);
  });
  await record('feed gallery resolves feed context and surfaces unsupported playback instead of showing static success', async () => {
    await page.getByRole('button', { name: '查看图片 1', exact: true }).click(); const gallery = page.getByRole('dialog', { name: '图片 1 / 1', exact: true }); await gallery.getByRole('button', { name: '播放实况照片', exact: true }).click(); await gallery.getByText('实况照片视频无法播放，请重试或使用支持此视频编码的客户端', { exact: true }).waitFor();
    const request = await page.evaluate(() => window.__photoMock.calls.find(call => call.operation === 'livePhotoVideo')); assert.deepEqual(request.args, { id: '701', contentType: 'feed', picUrl: 'https://image.coolapk.com/feed/synthetic-livepic@4x4.png' }); await page.screenshot({ path: '.local/photo-gallery-check/feed.png' }); await gallery.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('comment gallery requests the exact reply id and reply content type', async () => {
    await page.evaluate(() => window.__photoNavigate('detail')); await page.locator('[data-comment-id="702"]').getByRole('button', { name: '查看评论图片 1', exact: true }).click(); const gallery = page.getByRole('dialog', { name: '图片 1 / 1', exact: true }); await gallery.getByRole('button', { name: '播放实况照片', exact: true }).click(); await gallery.getByText('实况照片视频无法播放，请重试或使用支持此视频编码的客户端', { exact: true }).waitFor(); const request = await page.evaluate(() => window.__photoMock.calls.find(call => call.operation === 'livePhotoVideo' && call.args.contentType === 'reply')); assert.equal(request.args.id, '702'); await gallery.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('article image models expose live preview with article context and original source', async () => {
    await page.evaluate(() => window.__photoNavigate('article')); await page.getByRole('button', { name: '播放实况照片', exact: true }).click(); await page.getByText('实况照片视频无法播放，请重试或使用支持此视频编码的客户端', { exact: true }).waitFor(); const request = await page.evaluate(() => window.__photoMock.calls.find(call => call.operation === 'livePhotoVideo' && call.args.contentType === 'article')); assert.deepEqual(request.args, { id: '703', contentType: 'article', picUrl: 'https://image.coolapk.com/feed/synthetic-livepic@4x4.png' });
  });
  assert.deepEqual(errors, []); writeFileSync('research/photo-gallery-checks.json', JSON.stringify({ mode: 'synthetic renderer integration checks', externalRequests: 'blocked', playback: 'unavailable CDN fixture deliberately tests the visible decode error path; no codec support claim', checks, errors }, null, 2));
} finally { await browser?.close(); await server.close(); }
