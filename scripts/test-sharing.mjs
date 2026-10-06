import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';
const port = Number(process.env.COOLAPK_SHARING_TEST_PORT || 5187), origin = `http://127.0.0.1:${port}`, checks = [], errors = [];
mkdirSync('.local/sharing-check', { recursive: true });
writeFileSync('.local/sharing-check/fixture.html', '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
const sharingFixtureModule = process.env.COOLAPK_SHARING_FIXTURE_MODULE || '/src/Sharing.tsx';
writeFileSync('.local/sharing-check/fixture.tsx', `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ShareDialog}from${JSON.stringify(sharingFixtureModule)};import'/src/styles.css';function Fixture(){const[feed,setFeed]=useState(window.__shareCases.photo);const[namespace,setNamespace]=useState('42');const[open,setOpen]=useState(true);window.__shareFixtureFeed=name=>setFeed(window.__shareCases[name]);window.__shareFixtureScope=value=>setNamespace(value);return <main data-share-scope={namespace} data-share-feed={feed.id}><button onClick={()=>setOpen(true)}>打开测试分享</button>{open&&<ShareDialog feed={feed} namespace={namespace} onClose={()=>setOpen(false)} toast={value=>window.__shareToasts.push(value)}/>}</main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser;
try { browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) }); } catch (error) { await server.close(); throw error; }
const context = await browser.newContext({ viewport: { width: 1360, height: 920 }, permissions: ['clipboard-read', 'clipboard-write'], bypassCSP: true });
await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
const page = await context.newPage(); page.on('pageerror', error => { errors.push(error.message); console.log('PAGE_ERROR', error.message); });
await page.addInitScript(defaultSettings => {
  const account = { uid: '42', username: '分享模拟账号', userAvatar: '' };
  const feed = { entityType: 'feed', id: 101, uid: 43, username: '分享酷友', message_title: '有图片的测试动态', message: '只读分享内容 <a href="coolmarket://com.coolapk.market/feed/101?rid=201">定位这条评论</a> <a href="/collection/55">打开测试收藏单</a>', imageUriList: [{ sourceUrl: 'https://image.coolapk.com/original.jpg', compressedUrl: 'https://image.coolapk.com/thumb.jpg' }], cookie: 'synthetic-sensitive-field', likenum: 0, replynum: 1 };
  window.__exports = []; window.__images = []; window.__calls = []; window.__failPage = false; window.__configFailure = false;
  const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 60; const drawing = canvas.getContext('2d'); drawing.fillStyle = '#f41744'; drawing.fillRect(0, 0, 50, 60); drawing.fillStyle = '#1839e8'; drawing.fillRect(50, 0, 50, 60); const photoData = canvas.toDataURL('image/png');
  drawing.fillStyle = '#e8b718'; drawing.fillRect(0, 0, 100, 60); const alternateData = canvas.toDataURL('image/png');
  const photo = { id: 301, username: '分享卡作者', message_title: '图文卡测试标题', message: '<p>第一段图文正文</p><p>第二段正文</p>', imageUriList: [{ sourceUrl: 'https://image.coolapk.com/share/original.png', compressedUrl: 'https://image.coolapk.com/share/thumbnail.png' }, { sourceUrl: 'https://static.coolapk.com/share/second.png' }], cookie: 'never-export-synthetic-private' };
  window.__shareCases = { photo, noImage: { ...photo, id: 302, message_title: '无图分享标题', imageUriList: [] }, unsafe: { ...photo, id: 303, imageUriList: [{ sourceUrl: 'https://evil.test/private.png' }] }, alternate: { ...photo, id: 304, message_title: '另一条动态标题', message: '另一条动态正文', imageUriList: [{ sourceUrl: 'https://cdn.coolapk.com/share/alternate.png' }] }, updated: { ...photo, message_title: '同条动态更新标题', imageUriList: [{ sourceUrl: 'https://cdn.coolapk.com/share/alternate.png' }] } };
  window.__shareReads = []; window.__sharePending = []; window.__shareCompleted = 0; window.__shareToasts = []; window.__shareMode = ''; window.__shareSaveMode = ''; window.__shareDrawn = []; window.__shareSaveAttempts = [];
  const fillText = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__shareDrawn.push(String(text)); return fillText.call(this, text, ...args); };
  window.coolapk = {
    teenager: async operation => operation === 'info' ? { ok: true, data: { enabled: false, blocked: false, reason: null, usedMilliseconds: 0, remainingMilliseconds: 2400000, limitMilliseconds: 2400000, day: '2026-10-04', lockedUntil: null } } : { ok: false, error: { code: 'TEST_UNSUPPORTED', message: '该测试仅模拟关闭的青少年模式' } },
    onTeenager: () => () => {},
    accounts: async () => ({ ok: true, data: { accounts: [account], current: account } }), onAccount: () => () => {}, onCommand: () => () => {}, openExternal: async () => ({ ok: true, data: {} }),
    saveExport: async args => { window.__shareSaveAttempts.push(args); const mode = window.__shareSaveMode; window.__shareSaveMode = ''; if (mode === 'cancel') return { ok: true, data: { saved: false } }; if (mode === 'error') return { ok: false, error: { code: 'FILE_ERROR', message: '模拟分享卡保存失败' } }; window.__exports.push(args); return { ok: true, data: { saved: true, name: '模拟导出文件' } }; },
    shareImageData: async args => {
      window.__shareReads.push(args); const mode = window.__shareMode; window.__shareMode = '';
      const data = args.url.includes('alternate') ? alternateData : photoData;
      if (mode === 'hold') return new Promise(resolve => window.__sharePending.push(() => { window.__shareCompleted++; resolve({ ok: true, data }); }));
      if (mode === 'error') return { ok: false, error: { code: 'NETWORK', message: '模拟配图读取失败' } };
      return { ok: true, data: mode === 'invalid' ? 'data:image/png;base64,AA==' : data };
    },
    saveImage: async args => { window.__images.push(args); return { ok: true, data: { saved: true, name: '模拟原图.jpg' } }; },
    call: async (operation, args = {}) => {
      window.__calls.push({ operation, args }); const ok = data => ({ ok: true, data: { data } });
      if (operation === 'accountSettings') return ok({ values: { ...defaultSettings }, present: Object.keys(defaultSettings), guardExpiresAt: null, replyLocked: false });
      if (operation === 'init') return ok([{ title: '首页', entities: [{ id: 66, title: '关注', url: 'V15_HOME_TAB_FOLLOW', page_visibility: '1' }, { id: 67, title: '话题', url: 'V9_HOME_TAB_TOPIC', page_visibility: '0' }] }]);
      if (operation === 'homeHeadline' || operation === 'homeEditorChoice') return ok([feed]);
      if (operation === 'homeTabConfig') return window.__configFailure ? { ok: false, error: { code: 'NETWORK', message: '模拟栏目同步失败' } } : ok(true);
      if (operation === 'home') return ok([feed]); if (operation === 'detail') return ok(feed);
      if (operation === 'replyDetail') return ok({ id: 201, feedid: 101, uid: 44, username: '被定位的酷友', message: '准确定位到评论正文', replynum: 1 });
      if (operation === 'collection') return ok({ id: 55, uid: 42, title: '测试收藏单' });
      if (operation === 'collectionFeeds') {
        if (args.page === 2 && window.__failPage) return { ok: false, error: { code: 'NETWORK', message: '模拟第二页失败' } };
        if (args.page === 2) return { ok: true, data: { data: [{ entityType: 'apk', id: 'com.synthetic.saved', title: '应用收藏' }], firstItem: '101', lastItem: 'com.synthetic.saved', hasMore: true } };
        if (args.page === 3) return { ok: true, data: { data: [{ ...feed, id: 102, message: '第三页的动态' }], firstItem: '101', lastItem: '102', hasMore: false } };
        return { ok: true, data: { data: [feed], firstItem: '101', lastItem: '101', hasMore: true } };
      }
      return ok([]);
    }
  };
}, DEFAULT_ACCOUNT_SETTINGS);
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  await page.goto(origin);
  await record('home channels expose known headline/editor/update reads and retain native show/hide order with confirmed cloud fields', async () => {
    await page.getByRole('tab', { name: '头条', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeHeadline'));
    await page.getByRole('tab', { name: '编辑精选', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeEditorChoice'));
    await page.getByRole('tab', { name: '更新', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeUpdates'));
    await page.getByRole('tab', { name: '快讯', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeNews'));
    await page.getByRole('tab', { name: '社区精选', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeDigest'));
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^管理首页栏目/ }).click(); const modal = page.getByRole('dialog', { name: '管理首页栏目' });
    await modal.getByRole('checkbox', { name: '话题', exact: true }).check(); await modal.getByRole('button', { name: '保存到本机', exact: true }).click(); await page.getByRole('tab', { name: '话题', exact: true }).waitFor();
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^管理首页栏目/ }).click(); await modal.getByRole('button', { name: '保存并同步账号', exact: true }).click();
    await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeTabConfig')); const tabs = await page.evaluate(() => window.__calls.find(call => call.operation === 'homeTabConfig').args.tabs); assert.deepEqual(tabs.map(tab => String(tab.id)), ['66', '67']); assert.ok(tabs.every(tab => tab.page_visibility === '1'));
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^管理首页栏目/ }).click(); await page.evaluate(() => { window.__configFailure = true; }); await modal.getByRole('button', { name: '保存并同步账号', exact: true }).click(); await modal.getByText('模拟栏目同步失败', { exact: true }).waitFor(); await modal.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('tab', { name: '推荐', exact: true }).click();
  });
  await record('feed share JSON exports only selected public fields and Markdown contains original image URLs', async () => {
    await page.getByRole('button', { name: '分享动态', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '分享动态' }); await dialog.getByRole('button', { name: '导出 JSON', exact: true }).click();
    await page.waitForFunction(() => window.__exports.length === 1);
    const item = await page.evaluate(() => JSON.parse(window.__exports[0].content)); assert.equal(item.id, '101'); assert.equal(item.cookie, undefined); assert.equal(item.images[0], 'https://image.coolapk.com/original.jpg');
    await dialog.getByRole('button', { name: '导出 Markdown', exact: true }).click(); await page.waitForFunction(() => window.__exports.length === 2);
    assert.match(await page.evaluate(() => window.__exports[1].content), /https:\/\/image.coolapk.com\/original.jpg/);
  });
  await record('text share card generates real decodable PNG and link clipboard has the correct post URL', async () => {
    const dialog = page.getByRole('dialog', { name: '分享动态' }); await dialog.getByRole('button', { name: '保存文字分享卡', exact: true }).click();
    await page.waitForFunction(() => window.__exports.length === 3);
    const dimensions = await page.evaluate(async () => { const bitmap = await createImageBitmap(new Blob([window.__exports[2].content], { type: 'image/png' })); return [bitmap.width, bitmap.height]; }); assert.deepEqual(dimensions, [1080, 1500]);
    await dialog.getByRole('button', { name: '复制链接', exact: true }).click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://www.coolapk.com/feed/101');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('save original photo passes the source URL rather than the thumbnail', async () => {
    await page.getByRole('button', { name: '查看图片 1', exact: true }).click(); await page.getByRole('button', { name: '保存原图', exact: true }).click();
    await page.waitForFunction(() => window.__images.length === 1); assert.equal(await page.evaluate(() => window.__images[0].url), 'https://image.coolapk.com/original.jpg');
    const imageDialog = page.getByRole('dialog', { name: '图片 1 / 1', exact: true });
    assert.equal(await imageDialog.evaluate(node => node.parentElement.parentElement === document.body), true, 'Fallback must escape feed containment');
    const close = imageDialog.getByRole('button', { name: '关闭', exact: true });
    for (const width of [1360, 760]) {
      await page.setViewportSize({ width, height: 920 });
      assert.ok(await close.evaluate(node => { const bounds = node.getBoundingClientRect(); return bounds.top >= 0 && bounds.bottom <= innerHeight && node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)); }), 'Image close must be visible and receive pointer input');
    }
    await close.click(); await page.setViewportSize({ width: 1360, height: 920 });
  });
  await record('official native deep link opens the feed and preserves the target comment', async () => {
    await page.getByRole('link', { name: '定位这条评论', exact: true }).click(); const focused = page.getByRole('region', { name: '定位评论' });
    await focused.getByText('准确定位到评论正文', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__calls.some(call => call.operation === 'replyDetail' && call.args.id === '201')), true);
    await focused.getByRole('button', { name: '回复', exact: true }).click(); assert.match(await page.locator('.reply-target').innerText(), /被定位的酷友/);
    await page.getByRole('button', { name: '关闭动态详情', exact: true }).click();
  });
  await record('collection export paginates to completion and refuses to save a partial failed result', async () => {
    await page.getByRole('link', { name: '打开测试收藏单', exact: true }).click(); await page.locator('.collection-export').getByRole('button', { name: '导出 JSON', exact: true }).click();
    await page.waitForFunction(() => window.__exports.length === 4); const json = await page.evaluate(() => JSON.parse(window.__exports[3].content)); assert.deepEqual(json.feeds.map(feed => feed.id), ['101', '102']); assert.equal(json.scope, 'feeds_only'); assert.equal(json.skippedItems, 1);
    await page.evaluate(() => { window.__failPage = true; }); await page.locator('.collection-export').getByRole('button', { name: '导出 Markdown', exact: true }).click();
    await page.getByText('模拟第二页失败', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__exports.length), 4);
  });
  await page.goto(origin + '/.local/sharing-check/fixture.html');
  const dialog = page.getByRole('dialog', { name: '分享动态', exact: true });
  const choose = async name => { await page.evaluate(name => window.__shareFixtureFeed(name), name); await page.waitForFunction(name => document.querySelector('main')?.dataset.shareFeed === String(window.__shareCases[name].id), name); };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const preview = async () => { await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await page.waitForFunction(() => { const image = document.querySelector('img[alt="图文分享卡预览"]'); const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '保存图文分享卡'); return image?.complete && image.naturalWidth === 1080 && button?.disabled === false; }); };
  const exportsCount = () => page.evaluate(() => window.__exports.length), readsCount = () => page.evaluate(() => window.__shareReads.length);
  const releaseHeld = async () => { const done = await page.evaluate(() => window.__shareCompleted); await page.evaluate(() => window.__sharePending.splice(0).forEach(resolve => resolve())); await page.waitForFunction(done => window.__shareCompleted > done, done); await settle(); };
  const decoded = index => page.evaluate(async index => { const bitmap = await createImageBitmap(new Blob([window.__exports[index].content], { type: 'image/png' })); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; let red = 0, blue = 0, yellow = 0; for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] === 244 && pixels[i + 1] === 23 && pixels[i + 2] === 68) red++; if (pixels[i] === 24 && pixels[i + 1] === 57 && pixels[i + 2] === 232) blue++; if (pixels[i] === 232 && pixels[i + 1] === 183 && pixels[i + 2] === 24) yellow++; } bitmap.close(); return { width: canvas.width, height: canvas.height, red, blue, yellow }; }, index);
  const digest = index => page.evaluate(async index => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', window.__exports[index].content))).join(','), index);
  await record('image-rich share card is opt-in, embeds original decoded pixels and known title/body/author/official link before explicit export', async () => {
    assert.equal(await readsCount(), 0); assert.equal(await exportsCount(), 0); assert.equal(await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).isEnabled(), false);
    await preview(); assert.equal(await exportsCount(), 0); await page.screenshot({ path: '.local/sharing-check/image-rich.png' });
    assert.deepEqual(await page.evaluate(() => window.__shareReads), [{ url: 'https://image.coolapk.com/share/original.png' }, { url: 'https://static.coolapk.com/share/second.png' }]);
    const drawn = await page.evaluate(() => window.__shareDrawn); for (const text of ['分享卡作者', '图文卡测试标题', '第一段图文正文', '第二段正文', 'https://www.coolapk.com/feed/301']) assert.ok(drawn.includes(text), text); assert.equal(drawn.includes('never-export-synthetic-private'), false);
    await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__exports.length === 1);
    const image = await decoded(0); assert.equal(image.width, 1080); assert.ok(image.height > 900 && image.height <= 8192); assert.ok(image.red > 10000 && image.blue > 10000); assert.equal(image.yellow, 0);
    assert.deepEqual(await page.evaluate(() => Object.keys(window.__exports[0]).sort()), ['content', 'kind', 'name']);
  });
  await record('native save cancellation creates no success while save failure retries the exact preview bytes without refetching pictures', async () => {
    const toasts = await page.evaluate(() => window.__shareToasts.length), reads = await readsCount(); await page.evaluate(() => { window.__shareSaveMode = 'cancel'; }); await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__shareSaveAttempts.length === 2); await settle(); assert.equal(await exportsCount(), 1); assert.equal(await page.evaluate(() => window.__shareToasts.length), toasts);
    await page.evaluate(() => { window.__shareSaveMode = 'error'; }); await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).click(); await dialog.getByText('模拟分享卡保存失败', { exact: true }).waitFor(); await dialog.getByRole('button', { name: '重试', exact: true }).click(); await page.waitForFunction(() => window.__exports.length === 2);
    assert.equal(await readsCount(), reads); assert.equal(await digest(0), await digest(1)); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 1);
  });
  await record('no-image sharing remains a decoded text preview and switching feeds hides the previous card before export', async () => {
    await choose('noImage'); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0); assert.equal(await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).isEnabled(), false);
    await dialog.getByText('这条动态没有配图，将生成文字卡片。', { exact: true }).waitFor(); const reads = await readsCount(); await preview(); assert.equal(await readsCount(), reads); await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__exports.length === 3); const image = await decoded(2); assert.deepEqual([image.width, image.red, image.blue, image.yellow], [1080, 0, 0, 0]);
  });
  await record('read and decode failures block incomplete previews/exports and explicit retry reloads selected originals', async () => {
    await choose('photo'); const before = await exportsCount(); await page.evaluate(() => { window.__shareMode = 'error'; }); await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await dialog.getByText('模拟配图读取失败', { exact: true }).waitFor(); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0); assert.equal(await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).isEnabled(), false); assert.equal(await exportsCount(), before);
    await dialog.getByRole('button', { name: '重试', exact: true }).click(); await dialog.getByRole('button', { name: '重新生成预览', exact: true }).waitFor(); await page.evaluate(() => { window.__shareMode = 'invalid'; }); await dialog.getByRole('button', { name: '重新生成预览', exact: true }).click(); await dialog.getByText('第 1 张配图无法解码，请重试或取消包含配图', { exact: true }).waitFor(); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0); assert.equal(await exportsCount(), before);
    await dialog.getByRole('button', { name: '重试', exact: true }).click(); await page.waitForFunction(() => document.querySelector('img[alt="图文分享卡预览"]')?.naturalWidth === 1080);
  });
  await record('unsupported photo sources never reach the bridge and image omission requires explicit user choice', async () => {
    await choose('unsafe'); const reads = await readsCount(); await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await dialog.getByText('部分配图来源暂不支持，可取消包含配图后生成文字卡片', { exact: true }).waitFor(); assert.equal(await readsCount(), reads); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0);
    await dialog.getByRole('checkbox', { name: '包含动态图片', exact: true }).uncheck(); await preview(); assert.equal(await readsCount(), reads); await dialog.getByText('预览包含 0 张配图；保存时由系统选择文件位置。', { exact: true }).waitFor();
  });
  await record('cancelled image generation never resumes later photo reads, preview creation or native export', async () => {
    await choose('photo'); await page.evaluate(() => { window.__shareMode = 'hold'; }); await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__sharePending.length === 1); const reads = await readsCount(), exports = await exportsCount(); await dialog.getByRole('button', { name: '取消生成', exact: true }).click(); await releaseHeld(); assert.equal(await readsCount(), reads, 'cancelled generation must not read subsequent photos'); assert.equal(await exportsCount(), exports); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0); assert.equal(await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).isEnabled(), false);
    await preview(); const source = await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await page.evaluate(async source => { try { await fetch(source); return true; } catch { return false; } }, source), false);
  });
  await record('closing and reopening during a held image read cannot replace the newer feed preview or perform an export', async () => {
    await page.getByRole('button', { name: '打开测试分享', exact: true }).click(); await page.evaluate(() => { window.__shareMode = 'hold'; }); await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__sharePending.length === 1); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await choose('alternate'); await page.getByRole('button', { name: '打开测试分享', exact: true }).click(); await preview(); const source = await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'), reads = await readsCount(), exports = await exportsCount(); await releaseHeld(); assert.equal(await readsCount(), reads); assert.equal(await exportsCount(), exports); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'), source);
    await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).click(); await page.waitForFunction(count => window.__exports.length === count + 1, exports); const image = await decoded(exports); assert.ok(image.yellow > 10000); assert.equal(image.red, 0);
  });
  await record('same-feed metadata updates hide previous previews and late image reads cannot overwrite changed media', async () => {
    await choose('photo'); await page.evaluate(() => { window.__shareMode = 'hold'; }); await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__sharePending.length === 1); await choose('updated'); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0); await preview(); const source = await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'), reads = await readsCount(); await releaseHeld(); assert.equal(await readsCount(), reads); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'), source); assert.ok((await page.evaluate(() => window.__shareDrawn)).includes('同条动态更新标题'));
  });
  await record('namespace changes invalidate old generation/preview before saving and keep bridge payloads public-image-only', async () => {
    await choose('photo'); await page.evaluate(() => { window.__shareMode = 'hold'; }); await dialog.getByRole('button', { name: '预览图文分享卡', exact: true }).click(); await page.waitForFunction(() => window.__sharePending.length === 1); await page.evaluate(() => window.__shareFixtureScope('77')); await page.waitForFunction(() => document.querySelector('main')?.dataset.shareScope === '77'); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).count(), 0); assert.equal(await dialog.getByRole('button', { name: '保存图文分享卡', exact: true }).isEnabled(), false); await preview(); const source = await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'), reads = await readsCount(), exports = await exportsCount(); await releaseHeld(); assert.equal(await readsCount(), reads); assert.equal(await exportsCount(), exports); assert.equal(await dialog.getByRole('img', { name: '图文分享卡预览', exact: true }).getAttribute('src'), source); assert.ok(await page.evaluate(() => window.__shareReads.every(args => Object.keys(args).length === 1 && typeof args.url === 'string' && !args.url.includes('thumbnail'))));
  });
  assert.deepEqual(errors, []); mkdirSync('.local/sharing-check', { recursive: true }); await page.screenshot({ path: '.local/sharing-check/collection.png' });
  writeFileSync('research/sharing-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'mock; local generated image bytes; external network blocked', liveAccountWrites: false, actualFileWrites: false, checks, errors, sourceBoundary: 'known feed photo metadata and original URLs; reference feedShareImage.ts and FeedShareImageDialog.vue; selected first four images; no hot comments/emoji/avatar/QR/system-share parity claim' }, null, 2));
} catch (error) { await page.screenshot({ path: '.local/sharing-check/failure.png' }); console.log('FAILURE_STATE', await page.locator('body').innerText(), errors); throw error; }
finally { await browser.close(); await server.close(); }
