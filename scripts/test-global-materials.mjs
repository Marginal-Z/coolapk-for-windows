// Actual built Electron window, production preference flow and wallpaper IPC.
// API data and picker selection are isolated fixtures; no account/network writes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hardware = process.env.COOLAPK_MATERIAL_GPU === '1';
const output = join(root, '.local', hardware ? 'global-materials-hardware-check' : 'global-materials-check'); mkdirSync(output, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(join(output, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
let entry = root;
if (hardware) {
  // Set every mutable Electron path before production main runs, preserving
  // its normal GPU path without touching any installed user/account data.
  entry = env.COOLAPK_TEST_DATA; delete env.COOLAPK_TEST_DATA; delete env.COOLAPK_DEV_URL;
  const paths = Object.fromEntries(['userData', 'sessionData', 'downloads', 'crashDumps'].map(name => [name, join(entry, name)]));
  for (const directory of [...Object.values(paths), join(entry, 'logs')]) mkdirSync(directory, { recursive: true });
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
  writeFileSync(join(entry, 'bootstrap.cjs'), `const {app,session}=require('electron');const path=require('node:path');const isolation=${JSON.stringify(paths)};for(const[key,value]of Object.entries(isolation))app.setPath(key,value);app.setAppLogsPath(${JSON.stringify(join(entry, 'logs'))});app.whenReady().then(()=>{for(const[key,value]of Object.entries(isolation))if(path.resolve(app.getPath(key))!==path.resolve(value))throw new Error('Path escaped isolation: '+key);session.defaultSession.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_,done)=>done({cancel:true}))});require(${JSON.stringify(join(root, 'electron', 'main.cjs'))});for(const[key,value]of Object.entries(isolation))if(path.resolve(app.getPath(key))!==path.resolve(value))throw new Error('Path escaped isolation after main: '+key);`);
}
const desktop = await playwright._electron.launch({ executablePath: electron, args: [entry], env, timeout: 30000 });
const checks = [], errors = [], measurements = {};
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  measurements.nativeEnvironment = await page.evaluate(() => ({ reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches, forcedColors: matchMedia('(forced-colors: active)').matches, userAgent: navigator.userAgent }));
  measurements.nativeTheme = await desktop.evaluate(({ nativeTheme, app }) => ({ reducedTransparency: nativeTheme.prefersReducedTransparency, highContrast: nativeTheme.shouldUseHighContrastColors, hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(), gpu: app.getGPUFeatureStatus(), paths: Object.fromEntries(['userData', 'sessionData', 'downloads', 'crashDumps', 'logs'].map(name => [name, app.getPath(name)])) }));
  if (hardware) { assert.equal(measurements.nativeTheme.hardwareAccelerationEnabled, true); for (const path of Object.values(measurements.nativeTheme.paths)) assert.ok(resolve(path).startsWith(resolve(entry) + '\\'), path); }
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
  const follow = () => dialog.getByRole('switch', { name: '跟随 Windows 透明效果', exact: true });
  await record('fresh native window defaults to explicit material and visible wallpaper opacity without overriding the OS preference', async () => {
    assert.equal(await follow().isChecked(), false); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'false');
    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')));
    assert.equal(settings.version, 2); assert.equal(settings.backgroundOpacity, .6); assert.equal(settings.surfaceOpacity, .78);
    if (!measurements.nativeEnvironment.forcedColors) assert.ok((await page.locator('.feed-card').first().evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
  });
  await accessibility('reduce');
  await dialog.getByRole('button', { name: /^(选择|更换)背景图片$/ }).click();
  await page.waitForFunction(() => document.documentElement.dataset.customBackground === 'true' && document.querySelector('.custom-background'));
  await record('default wallpaper opacity visibly changes navigation pixels rather than only its computed color', async () => {
    const enabled = dialog.getByRole('switch', { name: '启用自定义背景', exact: true }), sidebar = page.locator('.sidebar');
    const active = await sidebar.screenshot({ scale: 'css' }); await enabled.uncheck(); await page.waitForFunction(() => document.documentElement.dataset.customBackground === 'false');
    const plain = await sidebar.screenshot({ scale: 'css' }); await enabled.check(); await page.waitForFunction(() => document.documentElement.dataset.customBackground === 'true');
    const difference = await page.evaluate(async sources => {
      const pixels = await Promise.all(sources.map(async source => { const picture = new Image(); picture.src = 'data:image/png;base64,' + source; await picture.decode(); const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data; }));
      if (pixels[0].length !== pixels[1].length) throw new Error('Wallpaper comparison dimensions changed'); let sum = 0, count = 0;
      for (let index = 0; index < pixels[0].length; index += 4) for (let channel = 0; channel < 3; channel++) { sum += Math.abs(pixels[0][index + channel] - pixels[1][index + channel]); count++; }
      return sum / count;
    }, [active.toString('base64'), plain.toString('base64')]);
    measurements.defaultWallpaperMeanDifference = difference; assert.ok(difference > 4, 'saved default wallpaper must noticeably reach global navigation pixels: ' + difference);
  });
  await dialog.getByLabel('背景图片不透明度').fill('100'); await dialog.getByLabel('内容区域不透明度').fill('74');
  const paint = async selectors => page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const drawing = canvas.getContext('2d');
    return selectors.map(selector => {
      const element = document.querySelector(selector), pseudo = element.matches('.sidebar,.topbar') && getComputedStyle(element, '::before').content !== 'none' ? '::before' : null, style = getComputedStyle(element, pseudo);
      drawing.clearRect(0, 0, 1, 1); drawing.fillStyle = style.backgroundColor; drawing.fillRect(0, 0, 1, 1);
      return { selector, paintPlane: pseudo || 'element', alpha: drawing.getImageData(0, 0, 1, 1).data[3] / 255, filter: style.backdropFilter, color: getComputedStyle(element).color, image: style.backgroundImage, opacity: getComputedStyle(element).opacity };
    });
  }, selectors);
  const surfaces = ['.sidebar', '.topbar', '.right-rail', '.home-feed-header', '.feed-card', '.settings-modal', '.preferences-background-sample'];
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
  for (const [mode, token] of [['full', 'coolapk-desktop-glass'], ['blur_only', 'blur(18px)'], ['fallback', 'none']]) await record(`${mode} reaches all native surfaces even when reduced transparency is active and following is off`, async () => {
    await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(mode); await page.waitForFunction(mode => document.documentElement.dataset.materialEffect === mode, mode);
    for (const surface of await paint(surfaces)) { assert.ok(surface.filter.includes(token), JSON.stringify(surface)); assert.equal(surface.image === 'none', mode !== 'full' || surface.selector === '.topbar'); }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.screenshot({ path: join(output, `home-${mode}.png`) });
    dialog = await openDisplay();
  });
  await record('actual text backdrops keep 4.5 contrast across three materials, extreme wallpapers and colored toolbars at saved forty percent', async () => {
    await dialog.getByLabel('内容区域不透明度').fill('40');
    const rows = [], selectors = ['.feed-copy', '.feed-meta', '.nav-item:not(.selected)>span', '.nav-item.selected>span', '.breadcrumb strong', '.topbar-publish>span'];
    const hiding = await page.addStyleTag({ content: '[data-material-contrast-probe],[data-material-contrast-probe] *{color:transparent!important;text-shadow:none!important}' });
    const wallpapers = {};
    for (const pattern of ['white', 'black', 'frequency']) {
      const encoded = await page.evaluate(pattern => {
        const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1000; const context = canvas.getContext('2d');
        context.fillStyle = pattern === 'black' ? '#000' : '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        if (pattern === 'frequency') for (let y = 0; y < canvas.height; y += 12) for (let x = 0; x < canvas.width; x += 12) { context.fillStyle = ((x + y) / 12) % 2 ? '#fff' : '#000'; context.fillRect(x, y, 12, 12); }
        return canvas.toDataURL('image/png').split(',')[1];
      }, pattern);
      wallpapers[pattern] = join(output, `contrast-wallpaper-${pattern}.png`); writeFileSync(wallpapers[pattern], Buffer.from(encoded, 'base64'));
    }
    try {
      for (const [pattern, file] of Object.entries(wallpapers)) {
        await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
        await dialog.getByRole('button', { name: /^(选择|更换)背景图片$/ }).click();
        // Include two chromatic headers in native pixels; unit tests exhaustively cover all palettes.
        for (const theme of (process.env.COOLAPK_MATERIAL_FOCUS_CUSTOM ? ['custom'] : ['light', 'dark', 'black', 'pink', 'orange', 'custom'])) for (const mode of ['full', 'blur_only', 'fallback']) {
          await dialog.getByLabel('主题风格', { exact: true }).selectOption(theme);
          if (theme === 'custom') {
            await dialog.getByLabel('自定义主题色色值', { exact: true }).fill('#328368');
            await dialog.getByLabel('自定义强调色色值', { exact: true }).fill('#ff00ff');
            await dialog.getByRole('radio', { name: '亮色风格', exact: true }).check();
            await dialog.getByRole('button', { name: '保存主题色', exact: true }).click();
          }
          await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(mode);
          await page.waitForFunction(({ theme, mode }) => document.documentElement.dataset.materialEffect === mode && document.documentElement.dataset.theme === (['dark', 'black'].includes(theme) ? theme : 'light'), { theme, mode });
          await dialog.getByRole('button', { name: '关闭', exact: true }).click();
          await page.locator('.main-scroll').evaluate(node => node.scrollTop = 0); await page.mouse.move(1800, 12);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const targets = await page.evaluate(selectors => selectors.map(selector => {
            const node = document.querySelector(selector); if (!node) throw new Error('Missing text contrast target: ' + selector); const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.fillStyle = style.color; context.fillRect(0, 0, 1, 1);
            const result = { selector, foreground: Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, fontSize: style.fontSize };
            node.dataset.materialContrastProbe = ''; return result;
          }), selectors);
          const png = await page.screenshot({ scale: 'css' });
          const contrasts = await page.evaluate(async ({ encoded, targets }) => {
            const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const luminance = channels => channels.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
            return targets.map(({ selector, rect, foreground, fontSize }) => {
              const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2), light = luminance(foreground); let minimum = Infinity;
              for (let dy = -2; dy <= 2; dy++) for (let dx = -Math.min(24, Math.floor(rect.width / 3)); dx <= Math.min(24, Math.floor(rect.width / 3)); dx++) {
                const offset = ((y + dy) * canvas.width + x + dx) * 4, backdrop = luminance(Array.from(pixels.slice(offset, offset + 3)));
                minimum = Math.min(minimum, (Math.max(light, backdrop) + .05) / (Math.min(light, backdrop) + .05));
              }
              return { selector, fontSize, foreground, minimum };
            });
          }, { encoded: png.toString('base64'), targets });
          await page.evaluate(() => document.querySelectorAll('[data-material-contrast-probe]').forEach(node => delete node.dataset.materialContrastProbe));
          for (const value of contrasts) {
            if (value.minimum < 4.5) {
              await page.screenshot({ path: join(output, 'contrast-failure.png'), scale: 'css' });
              const diagnostics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio, root: document.documentElement.style.cssText, topbar: { color: getComputedStyle(document.querySelector('.topbar')).color, background: getComputedStyle(document.querySelector('.topbar')).backgroundColor }, saved: JSON.parse(localStorage.getItem('coolapk-preferences')) }));
              writeFileSync(join(output, 'contrast-failure.json'), JSON.stringify({ pattern, theme, mode, value, targets, diagnostics }, null, 2));
            }
            assert.ok(value.minimum >= 4.5, JSON.stringify({ pattern, theme, mode, ...value }));
          }
          rows.push({ pattern, theme, mode, contrasts });
          if (pattern === 'frequency' && ['light', 'dark'].includes(theme)) await page.screenshot({ path: join(output, `readability-${theme}-${mode}.png`) });
          dialog = await openDisplay();
        }
      }
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).surfaceOpacity), .4);
      measurements.nativeTextContrast = { method: 'Actual Electron screenshot after hiding text only; minimum background-pixel contrast in its unchanged text box against the real computed foreground; saved opacity 40%, wallpaper 100%; WCAG sRGB luminance', minimum: Math.min(...rows.flatMap(row => row.contrasts.map(value => value.minimum))), rows };
      writeFileSync(join(output, 'contrast-pixels.json'), JSON.stringify(measurements.nativeTextContrast, null, 2) + '\n');
    } finally {
      await hiding.evaluate(node => node.remove()); await page.evaluate(() => document.querySelectorAll('[data-material-contrast-probe]').forEach(node => delete node.dataset.materialContrastProbe));
    }
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, wallpaper);
    await dialog.getByRole('button', { name: /^(选择|更换)背景图片$/ }).click();
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('light'); await dialog.getByLabel('内容区域不透明度').fill('74');
  });
  await record('native pixels distinguish frosted blur and SVG refraction with identical tint, sheen and rim', async () => {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => {
      const holder = document.createElement('div'); holder.id = 'global-material-pixel-probe';
      holder.style.cssText = 'position:fixed;left:32px;top:80px;width:480px;height:300px;z-index:1000;background:repeating-linear-gradient(125deg,#18231e 0 18px,#d7efdf 18px 36px)';
      const sample = document.createElement('div'); sample.className = 'feed-card';
      sample.style.cssText = 'position:absolute;left:32px;top:32px;width:416px;height:236px;border:0;border-radius:18px;padding:0;margin:0;background-color:rgba(255,255,255,.3);background-image:none;box-shadow:none'; holder.append(sample); document.body.append(holder);
    });
    const probe = page.locator('#global-material-pixel-probe .feed-card');
    const capture = async name => {
      const png = await probe.screenshot({ path: join(output, `pixels-${name}.png`), scale: 'css' });
      return page.evaluate(async encoded => {
        const picture = new Image(); picture.src = 'data:image/png;base64,' + encoded; await picture.decode();
        const canvas = document.createElement('canvas'); canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0);
        return { width: canvas.width, height: canvas.height, pixels: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
      }, png.toString('base64'));
    };
    const gradient = image => {
      let total = 0, count = 0;
      for (let y = 45; y < image.height - 45; y++) for (let x = 45; x < image.width - 45; x++) { const index = (y * image.width + x) * 4; total += Math.abs(image.pixels[index] - image.pixels[index + 4]); count++; }
      return total / count;
    };
    const difference = (left, right, rimOnly = false) => {
      assert.equal(left.width, right.width); assert.equal(left.height, right.height); let total = 0, count = 0;
      for (let y = 12; y < left.height - 12; y++) for (let x = 12; x < left.width - 12; x++) {
        if (rimOnly && x >= 45 && x < left.width - 45 && y >= 45 && y < left.height - 45) continue;
        const index = (y * left.width + x) * 4; for (let channel = 0; channel < 3; channel++) { total += Math.abs(left.pixels[index + channel] - right.pixels[index + channel]); count++; }
      }
      return total / count;
    };
    try {
      // Fixed tint, no sheen and no rim: changes in these pixels must come from
      // filtering the striped backdrop, not from cosmetic mode decoration.
      await probe.evaluate(node => { node.style.backdropFilter = 'none'; node.style.webkitBackdropFilter = 'none'; }); const clear = await capture('clear');
      await probe.evaluate(node => { node.style.removeProperty('backdrop-filter'); node.style.removeProperty('-webkit-backdrop-filter'); });
      await page.evaluate(() => document.documentElement.dataset.materialEffect = 'blur_only'); const frosted = await capture('frosted');
      await page.evaluate(() => document.documentElement.dataset.materialEffect = 'full'); const refracted = await capture('refracted');
      await probe.evaluate(node => { node.style.backdropFilter = 'blur(4px) saturate(1.06)'; node.style.webkitBackdropFilter = 'blur(4px) saturate(1.06)'; }); const baseline = await capture('full-without-svg');
      await probe.evaluate(node => { node.style.removeProperty('backdrop-filter'); node.style.removeProperty('-webkit-backdrop-filter'); }); const repeated = await capture('refracted-repeat');
      const values = { clearGradient: gradient(clear), frostedGradient: gradient(frosted), svgRimMeanDifference: difference(refracted, baseline, true), fullVersusFrosted: difference(refracted, frosted), repeatedFullDifference: difference(refracted, repeated) };
      measurements.nativePixelPipeline = values;
      assert.ok(values.clearGradient > 2, JSON.stringify(values)); assert.ok(values.frostedGradient < values.clearGradient * .45, JSON.stringify(values));
      assert.ok(values.svgRimMeanDifference > .3, 'SVG must move visible backdrop pixels, not only appear in computed CSS: ' + JSON.stringify(values));
      assert.ok(values.fullVersusFrosted > 2, JSON.stringify(values));
      assert.ok(values.repeatedFullDifference < .1, 'returning to the same filter must reproduce the same pixels, ruling out stale backdrop captures: ' + JSON.stringify(values));
    } finally { await page.evaluate(() => { document.getElementById('global-material-pixel-probe')?.remove(); document.documentElement.dataset.materialEffect = JSON.parse(localStorage.getItem('coolapk-preferences')).materialEffect; }); }
    dialog = await openDisplay();
  });
  await record('actual writing forms keep a quiet reading plane and opaque inputs without another backdrop filter', async () => {
    const identity = { uid: '77099', username: '隔离材质测试账号', userAvatar: '' };
    await desktop.evaluate(({ BrowserWindow }, identity) => BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [identity], current: identity } }), identity);
    const values = [];
    for (const [mode, token] of [['full', 'coolapk-desktop-glass'], ['blur_only', 'blur(18px)'], ['fallback', 'none']]) {
      await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(mode); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('.account-entry').getByText(identity.username, { exact: true }).waitFor();
      await page.locator('.topbar-publish').click(); const composer = page.getByRole('dialog', { name: '发布动态', exact: true });
      await composer.getByRole('tab', { name: '图文文章', exact: true }).click();
      await composer.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))); });
      const surfaces = await paint(['.modal:not(.settings-modal)', '.compose-body.advanced-compose', '.advanced-compose input', '.advanced-compose textarea']);
      assert.ok(surfaces[0].filter.includes(token)); assert.equal(surfaces[0].opacity, '1');
      assert.ok(surfaces[1].alpha > .84 && surfaces[1].alpha < .86); assert.equal(surfaces[1].filter, 'none'); assert.equal(surfaces[1].opacity, '1');
      for (const field of surfaces.slice(2)) { assert.equal(field.alpha, 1); assert.equal(field.opacity, '1'); }
      assert.equal(await composer.getByRole('button', { name: '发布', exact: true }).isDisabled(), true);
      await page.screenshot({ path: join(output, `composer-${mode}-steady.png`), scale: 'css' }); values.push({ mode, surfaces });
      await composer.getByRole('button', { name: '关闭', exact: true }).click(); dialog = await openDisplay();
    }
    measurements.writingSurfaces = values;
  });
  await record('dark and pure black themes preserve full-window material and text color', async () => {
    for (const theme of ['dark', 'black']) {
      await dialog.getByLabel('主题风格', { exact: true }).selectOption(theme); await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      for (const surface of await paint(surfaces)) { assert.ok(surface.alpha < 1); assert.notEqual(surface.color, 'rgb(38, 50, 45)'); }
      await page.screenshot({ path: join(output, `settings-${theme}.png`) });
    }
  });
  await record('following Windows alone makes reduced transparency opaque while forced colors always remain opaque', async () => {
    for (const theme of ['light', 'dark', 'black', 'pink', 'orange']) {
      await dialog.getByLabel('主题风格', { exact: true }).selectOption(theme); await page.waitForFunction(theme => document.documentElement.dataset.theme === (['dark', 'black'].includes(theme) ? theme : 'light'), theme);
      await follow().check(); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'true');
      await accessibility('reduce');
      for (const surface of await paint(surfaces)) { assert.equal(surface.filter, 'none', JSON.stringify(surface)); assert.equal(surface.alpha, 1, JSON.stringify(surface)); assert.equal(surface.image, 'none'); }
      assert.equal(await page.locator('.breadcrumb strong').evaluate(node => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d');
        const pixels = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data).join(','); };
        return pixels(getComputedStyle(node).color) === pixels(getComputedStyle(document.documentElement).getPropertyValue('--text').trim());
      }), true, 'solid fallback must restore the toolbar foreground with its background');
      await follow().uncheck(); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'false');
      for (const surface of await paint(surfaces)) assert.ok(surface.alpha < 1, JSON.stringify(surface));
      for (const followed of [false, true]) {
        await accessibility('reduce');
        await follow().setChecked(followed); await page.waitForFunction(followed => document.documentElement.dataset.materialFollowSystem === String(followed), followed);
        await accessibility('reduce', 'active');
        await page.waitForFunction(() => document.querySelector('input[aria-label="跟随 Windows 透明效果"]')?.disabled && document.querySelector('select[aria-label="界面材质效果"]')?.disabled);
        assert.equal(await follow().isDisabled(), true); assert.equal(await dialog.getByLabel('界面材质效果', { exact: true }).isDisabled(), true);
        for (const surface of await paint(surfaces)) { assert.equal(surface.filter, 'none', JSON.stringify(surface)); assert.equal(surface.alpha, 1, JSON.stringify(surface)); assert.equal(surface.image, 'none'); }
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).surfaceOpacity), .74);
      }
      await accessibility('reduce');
      await follow().uncheck(); await accessibility('reduce');
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
  const initializedGPU = await desktop.evaluate(async ({ app }) => { const info = await app.getGPUInfo('basic'); return { info, status: app.getGPUFeatureStatus() }; });
  measurements.nativeTheme.initialGPU = measurements.nativeTheme.gpu; measurements.nativeTheme.gpu = initializedGPU.status; measurements.nativeTheme.gpuInfo = initializedGPU.info;
  const report = { checkedAt: new Date().toISOString(), fixture: 'Actual Electron shell and preferences/background IPC, synthetic read-only API/picker result; external network denied; no account writes; no ADB action or APK download', checks, measurements, errors, passed: true };
  writeFileSync(join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  if (!hardware) {
    const contrast = measurements.nativeTextContrast, rows = contrast.rows;
    const summary = { ...contrast, rows: undefined, combinations: rows.length,
      coverage: { wallpaper: [...new Set(rows.map(row => row.pattern))], theme: [...new Set(rows.map(row => row.theme))], material: [...new Set(rows.map(row => row.mode))] },
      minimumBySelector: Object.fromEntries(rows[0].contrasts.map(value => [value.selector, Math.min(...rows.flatMap(row => row.contrasts.filter(item => item.selector === value.selector).map(item => item.minimum)))])) };
    writeFileSync(join(root, 'research', 'global-materials-checks.json'), JSON.stringify({ ...report, measurements: { ...measurements, nativeTextContrast: summary } }, null, 2) + '\n');
  }
  console.log('GLOBAL_MATERIALS_PASS', checks.length);
} finally { await desktop.close(); }
