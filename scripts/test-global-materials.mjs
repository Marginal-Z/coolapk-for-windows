// Actual built Electron window, production preference flow and wallpaper IPC.
// API data and picker selection are isolated fixtures; no account/network writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(root, '.local', 'global-materials-check'); mkdirSync(output, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(join(output, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
const checks = [], errors = [], measurements = {};
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await desktop.evaluate(({ BrowserWindow, ipcMain, session }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1920, height: 1080 });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_, callback) => callback({ cancel: true }));
    ipcMain.removeHandler('coolapk:call');
    ipcMain.handle('coolapk:call', (_, operation, args = {}) => {
      const feeds = Array.from({ length: 16 }, (_, index) => ({ entityType: 'feed', id: String(76000 + index), uid: '770', username: '材质显示测试', message: '导航、顶部搜索、栏目与卡片共享整个窗口的背景。\n' + '保持内容清晰，桌面宽屏使用双列阅读。'.repeat(6), dateline: 1700000000, likenum: 1, replynum: 2 }));
      const categories = ['热门', '手机', '平板', '耳机', '穿戴设备', '数码配件'].map((title, index) => ({ entityType: 'productCategory', id: String(index + 1), title, url: '/product/list' }));
      return { ok: true, data: { data: operation === 'home' ? feeds : operation === 'catalogProductCategories' ? categories : [], hasMore: false } };
    });
    ipcMain.removeHandler('coolapk:phone'); ipcMain.handle('coolapk:phone', (_, operation) => ({ ok: true, data: { devices: operation === 'status' ? [{ serial: 'synthetic-material-device', model: '桌面材质测试手机', state: 'device', running: false }] : [] } }));
    ipcMain.removeHandler('coolapk:downloads'); ipcMain.handle('coolapk:downloads', () => ({ ok: true, data: { directory: 'D:\\测试下载目录', tasks: [{ id: 'synthetic-material-download', packageName: 'local.material.fixture', title: '材质测试安装包', versionName: '1.0', versionCode: '1', fileName: 'fixture.apk', status: 'failed', downloaded: 0, total: 0, speed: 0, verified: false, error: '独立界面测试记录', errorCode: 'FIXTURE', retryCount: 0, createdAt: 0, updatedAt: 0 }] } }));
  });
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('[data-feed-id]').length === 16);
  const media = await page.context().newCDPSession(page);
  const accessibility = (transparency = 'no-preference', colors = 'none') => media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: transparency }, { name: 'forced-colors', value: colors }] });
  await accessibility();
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1000; const context = canvas.getContext('2d');
    const colors = ['#14874e', '#b4ddc8', '#7eb499', '#eff8f1', '#518e6c'];
    for (let x = 0; x < canvas.width; x += 120) { context.fillStyle = colors[Math.floor(x / 120) % colors.length]; context.fillRect(x, 0, 120, canvas.height); }
    for (let y = 100; y < canvas.height; y += 180) { context.fillStyle = '#224e3540'; context.fillRect(0, y, canvas.width, 60); }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const wallpaper = join(output, 'wallpaper.png'); writeFileSync(wallpaper, Buffer.from(pixels, 'base64'));
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, wallpaper);
  const openDisplay = async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '设置', exact: true }); await modal.getByRole('tab', { name: '界面显示', exact: true }).click(); return modal;
  };
  let dialog = await openDisplay();
  await dialog.getByRole('button', { name: '选择背景图片', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.customBackground === 'true' && document.querySelector('.custom-background'));
  await dialog.getByLabel('背景图片不透明度').fill('100'); await dialog.getByLabel('内容区域不透明度').fill('74');
  const paint = async selectors => page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const drawing = canvas.getContext('2d');
    return selectors.map(selector => {
      const element = document.querySelector(selector), style = getComputedStyle(element);
      drawing.clearRect(0, 0, 1, 1); drawing.fillStyle = style.backgroundColor; drawing.fillRect(0, 0, 1, 1);
      return { selector, alpha: drawing.getImageData(0, 0, 1, 1).data[3] / 255, filter: style.backdropFilter, color: style.color, image: style.backgroundImage, opacity: style.opacity };
    });
  }, selectors);
  const surfaces = ['.sidebar', '.topbar', '.right-rail', '.home-feed-header', '.feed-card', '.settings-modal'];
  await record('wallpaper and saved opacity affect shell, content and settings without fading text', async () => {
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--surface-opacity') === '74%');
    const values = await paint(surfaces); measurements.translucency = values;
    for (const surface of values) { assert.ok(surface.alpha >= .63 && surface.alpha <= .75, JSON.stringify(surface)); assert.equal(surface.opacity, '1'); }
    assert.equal(await page.locator('.feed-copy').first().evaluate(node => getComputedStyle(node).opacity), '1');
    const preview = dialog.getByLabel('材质效果预览'); assert.ok((await preview.boundingBox()).height >= 120);
    await dialog.getByLabel('内容区域不透明度').fill('90'); await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--surface-opacity') === '90%');
    for (const surface of await paint(surfaces)) assert.ok(surface.alpha >= .79 && surface.alpha <= .91, JSON.stringify(surface));
    await dialog.getByLabel('内容区域不透明度').fill('74');
  });
  const signatures = [];
  for (const [mode, token] of [['full', 'coolapk-desktop-glass'], ['blur_only', 'blur(10px)'], ['fallback', 'none']]) await record(`${mode} changes the real material on every surface and paints a distinct native window`, async () => {
    await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(mode); await page.waitForFunction(mode => document.documentElement.dataset.materialEffect === mode, mode);
    for (const surface of await paint(surfaces)) { assert.ok(surface.filter.includes(token), JSON.stringify(surface)); assert.equal(surface.image === 'none', mode !== 'full'); }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    const image = await page.screenshot({ path: join(output, `home-${mode}.png`) }); signatures.push(createHash('sha256').update(image).digest('hex'));
    dialog = await openDisplay();
  });
  assert.equal(new Set(signatures).size, 3); measurements.distinctMaterialScreenshots = true;
  await record('dark and pure black themes preserve full-window material and text color', async () => {
    for (const theme of ['dark', 'black']) {
      await dialog.getByLabel('主题风格', { exact: true }).selectOption(theme); await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      for (const surface of await paint(surfaces)) { assert.ok(surface.alpha < 1); assert.notEqual(surface.color, 'rgb(38, 50, 45)'); }
      await page.screenshot({ path: join(output, `settings-${theme}.png`) });
    }
  });
  await record('reduced transparency and high contrast use opaque surfaces in every theme and keep preferences', async () => {
    for (const theme of ['light', 'dark', 'black']) {
      await dialog.getByLabel('主题风格', { exact: true }).selectOption(theme); await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      for (const setting of [['reduce', 'none'], ['no-preference', 'active']]) {
        await accessibility(...setting);
        for (const surface of await paint(surfaces)) { assert.equal(surface.filter, 'none', JSON.stringify(surface)); assert.equal(surface.alpha, 1, JSON.stringify(surface)); assert.equal(surface.image, 'none'); }
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).surfaceOpacity), .74);
      }
      await accessibility();
    }
  });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await record('home header remains anchored and readable while desktop feeds use two columns', async () => {
    const main = page.locator('.main-scroll'), before = await page.locator('.home-feed-header').boundingBox(); await main.evaluate(node => node.scrollTop = 700);
    const after = await page.locator('.home-feed-header').boundingBox(); assert.ok(Math.abs(before.y - after.y) < 2);
    assert.equal(await page.locator('.feed-list').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
    assert.equal(await page.locator('.home-feed-header').evaluate(node => getComputedStyle(node).borderTopLeftRadius), '12px');
  });
  await record('digital categories use a semantic two-column list with keyboard-reachable cards', async () => {
    await page.getByRole('navigation', { name: '社区导航' }).getByRole('button', { name: '数码', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.entity-list>.entity-card').length === 6);
    assert.equal(await page.locator('.entity-list').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
    const first = page.locator('.entity-list>.entity-card').first(); await first.focus(); assert.equal(await first.evaluate(node => document.activeElement === node), true); await page.screenshot({ path: join(output, 'digital-columns.png') });
  });
  await record('download records and phone collaboration cards use the same global material', async () => {
    const nav = page.getByRole('navigation', { name: '社区导航' });
    for (const [name, selector] of [['应用下载', '.download-task'], ['手机协同', '.phone-device']]) {
      await nav.getByRole('button', { name, exact: true }).click(); await page.locator(selector).first().waitFor();
      const [surface] = await paint([selector]); assert.ok(surface.alpha >= .73 && surface.alpha <= .75); assert.equal(surface.filter, 'none');
      if (name === '手机协同') {
        const [mode] = await paint(['.phone-screen-mode']); assert.ok(mode.alpha >= .73 && mode.alpha <= .75); assert.equal(mode.filter, 'none');
        assert.equal(await page.getByRole('checkbox', { name: '手机熄屏，桌面继续操作', exact: true }).isChecked(), false);
        await page.screenshot({ path: join(output, 'phone-material.png') });
      }
    }
    await nav.getByRole('button', { name: '数码', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.entity-list>.entity-card').length === 6);
  });
  await record('minimum desktop window keeps toolbar controls and a single-column entity list within bounds', async () => {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 620 }));
    await page.waitForFunction(() => Math.abs(outerWidth - 900) < 2);
    for (const selector of ['.topbar', '.main-scroll']) assert.equal(await page.locator(selector).evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const publish = page.locator('.topbar-publish'), topbar = await page.locator('.topbar').boundingBox(), button = await publish.boundingBox(); assert.ok(button && button.x + button.width <= topbar.x + topbar.width);
    assert.equal(await page.locator('.entity-list').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
    await page.screenshot({ path: join(output, 'minimum-window.png') });
  });
  assert.deepEqual(errors, []);
  const report = { checkedAt: new Date().toISOString(), fixture: 'Actual Electron shell and preferences/background IPC, synthetic read-only API/picker result; external network denied; no account writes; no ADB action or APK download', checks, measurements, errors, passed: true };
  writeFileSync(join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(root, 'research', 'global-materials-checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('GLOBAL_MATERIALS_PASS', checks.length);
} finally { await desktop.close(); }
