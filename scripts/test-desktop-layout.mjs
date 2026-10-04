// Built App/preload, real window/scroll geometry and background decoder/storage.
// Only API responses and the system file-picker result are isolated fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';
import { BackgroundImageManager } from '../electron/background-image.cjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = join(root, '.local', 'desktop-layout-check');
mkdirSync(directory, { recursive: true });
const userData = mkdtempSync(join(directory, 'userdata-'));
const env = { ...process.env, COOLAPK_TEST_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
const checks = [], errors = [], measurements = {};
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await desktop.evaluate(({ BrowserWindow, ipcMain }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1920, height: 1080 });
    globalThis.layoutMock = { requests: [], generation: 1 };
    ipcMain.removeHandler('coolapk:call');
    ipcMain.handle('coolapk:call', (_, operation, args = {}) => {
      const mock = globalThis.layoutMock; mock.requests.push({ operation, args });
      const entities = operation === 'home' ? Array.from({ length: 30 }, (_, index) => ({ entityType: 'feed', id: String(70000 + (args.page || 1) * 100 + index), uid: '770', username: '桌面布局测试', message: `刷新批次 ${mock.generation} · 第 ${args.page || 1} 页 · 测试动态 ${index + 1}\n${'桌面阅读应保持清晰，固定栏目方便切换。'.repeat(8)}`, dateline: 1700000000, likenum: 1, replynum: 2 })) : [];
      return { ok: true, data: { data: entities, hasMore: operation === 'home' && (args.page || 1) === 1 } };
    });
  });
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('[data-feed-id]').length === 30 && document.querySelector('.main-scroll').scrollHeight - document.querySelector('.main-scroll').clientHeight > 1000);
  const main = page.locator('.main-scroll');
  await record('provided sidebar artwork replaces the old mark and desktop subtitle is removed', async () => {
    const brand = page.getByRole('button', { name: '酷安首页', exact: true });
    assert.equal((await brand.innerText()).trim(), '酷安');
    assert.equal(await brand.locator('small').count(), 0);
    assert.equal(await brand.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  });
  await record('search is centered within the desktop workspace at a wide window', async () => {
    const workspace = await page.locator('.workspace').boundingBox(), search = await page.locator('.search-box').boundingBox();
    assert.ok(workspace && search); assert.ok(Math.abs(search.x + search.width / 2 - workspace.x - workspace.width / 2) < 2);
    assert.ok(search.width >= 420); measurements.search = { width: search.width, centered: true };
  });
  await record('home heading and channels stay visible while feeds scroll', async () => {
    const before = await page.locator('.home-feed-header').boundingBox();
    await main.evaluate(node => { node.scrollTop = 900; });
    try { await page.waitForFunction(() => document.querySelector('.main-scroll').scrollTop >= 850, null, { timeout: 5000 }); }
    catch (error) { console.log('SCROLL_GEOMETRY', await main.evaluate(node => ({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, feeds: node.querySelectorAll('[data-feed-id]').length, overflow: getComputedStyle(node).overflowY, clientWidth: node.clientWidth }))); throw error; }
    const after = await page.locator('.home-feed-header').boundingBox();
    assert.ok(before && after); assert.ok(Math.abs(before.y - after.y) < 2);
    assert.equal(await page.getByRole('tab', { name: '推荐', exact: true }).isVisible(), true);
    measurements.fixedHomeHeader = { height: after.height, stableY: true };
  });
  await record('refresh returns to top and reads the newest first page after pagination', async () => {
    await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-feed-id]').length === 60);
    await main.evaluate(node => { node.scrollTop = 1000; });
    await desktop.evaluate(() => { globalThis.layoutMock.generation = 2; });
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.main-scroll').scrollTop === 0 && document.querySelectorAll('[data-feed-id]').length === 30 && document.querySelector('.feed-copy')?.textContent.includes('刷新批次 2'));
    const last = await desktop.evaluate(() => globalThis.layoutMock.requests.filter(row => row.operation === 'home').at(-1));
    assert.equal(last.args.page || 1, 1);
  });
  await record('native refresh command also returns the current feed to top', async () => {
    await main.evaluate(node => { node.scrollTop = 1000; });
    await desktop.evaluate(({ BrowserWindow }) => { globalThis.layoutMock.generation = 3; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:command', 'refresh'); });
    await page.waitForFunction(() => document.querySelector('.main-scroll').scrollTop === 0 && document.querySelector('.feed-copy')?.textContent.includes('刷新批次 3'));
  });
  await record('desktop settings use a wide navigation and content layout', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
    const bounds = await dialog.boundingBox(), navigation = await dialog.locator('.preferences-navigation').boundingBox(), content = await dialog.locator('.preferences-content').boundingBox();
    assert.ok(bounds.width >= 950 && bounds.width <= 1120); assert.ok(navigation && content && content.x > navigation.x + navigation.width - 2);
    measurements.settings = { width: bounds.width, navigationWidth: navigation.width, contentWidth: content.width };
    await dialog.getByRole('tab', { name: '界面显示', exact: true }).click();
    await dialog.getByLabel('背景图片不透明度').waitFor();
  });
  const files = {};
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = await page.evaluate(format => { const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160; const context = canvas.getContext('2d'); context.fillStyle = '#14874e'; context.fillRect(0, 0, 240, 160); context.fillStyle = '#f6fff9'; context.fillRect(20, 20, 90, 120); return canvas.toDataURL(`image/${format}`).split(',')[1]; }, format);
    files[format] = join(directory, `background.${format === 'jpeg' ? 'jpg' : format}`); writeFileSync(files[format], Buffer.from(bytes, 'base64'));
  }
  for (const format of ['png', 'jpeg', 'webp']) await record(`actual ${format.toUpperCase()} background selection decodes, saves and displays through the controlled protocol`, async () => {
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, files[format]);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: /^(选择背景图片|更换背景图片)$/ }).click();
    const expectedRevision = createHash('sha256').update(readFileSync(files[format])).digest('hex');
    await page.waitForFunction(revision => document.querySelector('.app-shell')?.dataset.customBackground === 'true' && document.querySelector('.preferences-background-preview img')?.src.endsWith(revision) && document.querySelector('.preferences-background-preview img')?.complete && document.querySelector('.preferences-background-preview img')?.naturalWidth === 240, expectedRevision);
    const result = await page.evaluate(() => window.coolapk.background('state')); assert.equal(result.ok, true); assert.equal(result.data.width, 240); assert.equal(result.data.height, 160);
    assert.equal(result.data.revision, expectedRevision);
    assert.equal(await settings.getByRole('alert').count(), 0);
    assert.match(result.data.url, /^coolapk-background:\/\/local\/[a-f0-9]{64}$/); assert.equal(JSON.stringify(result).includes(userData), false);
  });
  await record('opacity controls update the background and panels without fading text', async () => {
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.getByLabel('背景图片不透明度').fill('50'); await dialog.getByLabel('内容区域不透明度').fill('87');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.custom-background')).opacity === '0.5' && document.querySelector('.app-shell').style.getPropertyValue('--surface-opacity') === '87%');
    assert.equal(await page.locator('.feed-copy').first().evaluate(node => getComputedStyle(node).opacity), '1');
  });
  await record('background survives restarting its storage manager and rejects arbitrary URL reads', async () => {
    const state = await page.evaluate(() => window.coolapk.background('state'));
    const manager = new BackgroundImageManager({ directory: join(userData, 'background'), decodeImage: () => null });
    const verified = { persisted: await manager.state(), allowed: !!(await manager.read(state.data.url)), forbidden: (await manager.read('coolapk-background://local/../../private')) === null };
    assert.equal(verified.persisted.available, true); assert.equal(verified.allowed, true); assert.equal(verified.forbidden, true);
  });
  await page.screenshot({ path: join(directory, 'settings-background.png') });
  await record('remove restores plain theme and removes the selected background file', async () => {
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.getByRole('button', { name: '删除背景并恢复默认', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.custom-background'));
    assert.equal((await page.evaluate(() => window.coolapk.background('state'))).data.available, false);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  for (const size of [{ width: 2560, height: 1440 }, { width: 1100, height: 780 }]) await record(`${size.width}px window uses available desktop space without horizontal overflow`, async () => {
    await desktop.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setBounds(size), size);
    await page.waitForFunction(width => Math.abs(window.outerWidth - width) < 2, size.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    const search = await page.locator('.search-box').boundingBox(); assert.ok(search && search.width >= 210);
    await page.screenshot({ path: join(directory, `home-${size.width}.png`) });
  });
  assert.deepEqual(errors, []);
  writeFileSync(join(root, 'research', 'desktop-layout-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, fixture: 'Actual built App, production preload/background IPC and PNG/JPEG/WebP decoders, independent user data; API and picker results synthetic; no real account writes', checks, measurements, result: 'passed' }, null, 2) + '\n');
  console.log('DESKTOP_LAYOUT_PASS', JSON.stringify({ groups: checks.length, measurements }));
} finally { await desktop.close(); }
