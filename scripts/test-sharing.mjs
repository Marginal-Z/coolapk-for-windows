import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const port = 5187, origin = `http://127.0.0.1:${port}`, checks = [], errors = [];
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser;
try { browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) }); } catch (error) { await server.close(); throw error; }
const context = await browser.newContext({ viewport: { width: 1360, height: 920 }, permissions: ['clipboard-read', 'clipboard-write'], bypassCSP: true });
await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const account = { uid: '42', username: '分享模拟账号', userAvatar: '' };
  const feed = { entityType: 'feed', id: 101, uid: 43, username: '分享酷友', message_title: '有图片的测试动态', message: '只读分享内容 <a href="coolmarket://com.coolapk.market/feed/101?rid=201">定位这条评论</a> <a href="/collection/55">打开测试收藏单</a>', imageUriList: [{ sourceUrl: 'https://image.coolapk.com/original.jpg', compressedUrl: 'https://image.coolapk.com/thumb.jpg' }], cookie: 'synthetic-sensitive-field', likenum: 0, replynum: 1 };
  window.__exports = []; window.__images = []; window.__calls = []; window.__failPage = false; window.__configFailure = false;
  window.coolapk = {
    accounts: async () => ({ ok: true, data: { accounts: [account], current: account } }), onAccount: () => () => {}, onCommand: () => () => {}, openExternal: async () => ({ ok: true, data: {} }),
    saveExport: async args => { window.__exports.push(args); return { ok: true, data: { saved: true, name: '模拟导出文件' } }; },
    saveImage: async args => { window.__images.push(args); return { ok: true, data: { saved: true, name: '模拟原图.jpg' } }; },
    call: async (operation, args = {}) => {
      window.__calls.push({ operation, args }); const ok = data => ({ ok: true, data: { data } });
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
});
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  await page.goto(origin);
  await record('home channels expose known headline/editor/update reads and retain native show/hide order with confirmed cloud fields', async () => {
    await page.getByRole('tab', { name: '头条', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeHeadline'));
    await page.getByRole('tab', { name: '编辑精选', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeEditorChoice'));
    await page.getByRole('tab', { name: '更新', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeUpdates'));
    await page.getByRole('tab', { name: '快讯', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeNews'));
    await page.getByRole('tab', { name: '社区精选', exact: true }).click(); await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeDigest'));
    await page.getByRole('button', { name: '管理栏目', exact: true }).click(); const modal = page.getByRole('dialog', { name: '管理首页栏目' });
    await modal.getByRole('checkbox', { name: '话题', exact: true }).check(); await modal.getByRole('button', { name: '保存到本机', exact: true }).click(); await page.getByRole('tab', { name: '话题', exact: true }).waitFor();
    await page.getByRole('button', { name: '管理栏目', exact: true }).click(); await modal.getByRole('button', { name: '保存并同步账号', exact: true }).click();
    await page.waitForFunction(() => window.__calls.some(call => call.operation === 'homeTabConfig')); const tabs = await page.evaluate(() => window.__calls.find(call => call.operation === 'homeTabConfig').args.tabs); assert.deepEqual(tabs.map(tab => String(tab.id)), ['66', '67']); assert.ok(tabs.every(tab => tab.page_visibility === '1'));
    await page.getByRole('button', { name: '管理栏目', exact: true }).click(); await page.evaluate(() => { window.__configFailure = true; }); await modal.getByRole('button', { name: '保存并同步账号', exact: true }).click(); await modal.getByText('模拟栏目同步失败', { exact: true }).waitFor(); await modal.getByRole('button', { name: '关闭', exact: true }).click();
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
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
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
  assert.deepEqual(errors, []); mkdirSync('.local/sharing-check', { recursive: true }); await page.screenshot({ path: '.local/sharing-check/collection.png' });
  writeFileSync('research/sharing-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'mock', liveAccountWrites: false, actualFileWrites: false, checks, errors }, null, 2));
} finally { await browser.close(); await server.close(); }
