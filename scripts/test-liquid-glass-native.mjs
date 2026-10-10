// Actual Electron App; all API, account and suggestion data below are synthetic.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), hardware = process.env.COOLAPK_MATERIAL_GPU === '1';
const output = join(root, '.local', 'liquid-glass-native', hardware ? 'hardware' : 'software'); mkdirSync(output, { recursive: true });
const independent = mkdtempSync(join(output, 'userdata-'));
const env = { ...process.env, COOLAPK_TEST_DATA: independent }; delete env.ELECTRON_RUN_AS_NODE; delete env.COOLAPK_DEV_URL;
let entry = independent;
{
  if (hardware) delete env.COOLAPK_TEST_DATA;
  const paths = Object.fromEntries(['appData', 'userData', 'sessionData', 'downloads', 'crashDumps'].map(name => [name, join(entry, name)]));
  // Hardware mode exercises normal startup, which retains the historical
  // folder under appData. Isolate appData before main creates that directory.
  if (hardware) paths.userData = join(paths.appData, '酷安桌面端');
  if (!hardware) env.COOLAPK_TEST_DATA = paths.userData;
  for (const directory of [...Object.values(paths), join(entry, 'logs')]) mkdirSync(directory, { recursive: true });
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
  writeFileSync(join(entry, 'bootstrap.cjs'), `const {app,session}=require('electron');const path=require('node:path');global.fetch=async()=>{throw new Error('External Node fetch denied in isolated native fixture')};for(const name of ['http','https']){const transport=require('node:'+name);for(const method of ['request','get'])transport[method]=()=>{throw new Error('External Node transport denied in isolated native fixture')}};const isolation=${JSON.stringify(paths)};for(const[key,value]of Object.entries(isolation))app.setPath(key,value);app.setAppLogsPath(${JSON.stringify(join(entry, 'logs'))});app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['https://*/*','http://*/*']},(_,done)=>done({cancel:true})));require(${JSON.stringify(join(root, 'electron/main.cjs'))});for(const[key,value]of Object.entries(isolation))if(path.resolve(app.getPath(key))!==path.resolve(value))throw new Error('Path escaped isolation: '+key);`);
}
const app = await playwright._electron.launch({ executablePath: electron, args: [entry], env, timeout: 30000 });
const checks = [], errors = [], measurements = [];
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
    const mock = globalThis.liquidNative = { calls: [] };
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1360, height: 920 });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_, done) => done({ cancel: true }));
    ipcMain.removeHandler('coolapk:call'); ipcMain.handle('coolapk:call', (_, operation, args = {}) => {
      mock.calls.push({ operation, args });
      const data = operation === 'detail' ? { id: '90000', entityType: 'feed', uid: '770', username: '隔离玻璃测试', message: '隔离动态详情阅读样例。'.repeat(12), dateline: 1700000000 } : operation === 'searchSuggestions' ? [{ title: '原生玻璃搜索建议', url: 'searchTab://feed?keyword=%E5%8E%9F%E7%94%9F%E7%8E%BB%E7%92%83' }] : operation === 'home' || operation === 'rank' ? Array.from({ length: 20 }, (_, index) => ({ id: String(90000 + index), entityType: 'feed', uid: '770', username: '隔离玻璃测试', message: '独立材质层的合成阅读样例。'.repeat(6), dateline: 1700000000 })) : [];
      return { ok: true, data: { data, hasMore: false } };
    });
  });
  await page.reload(); await page.locator('.glass-navigation').first().waitFor();
  const input = page.getByRole('combobox', { name: '搜索酷安' });
  const navigation = page.getByRole('navigation', { name: '社区导航' });
  const lens = navigation.locator('.navigation-glass-lens');
  const media = await page.context().newCDPSession(page);
  const accessibility = (transparency = 'no-preference', colors = 'none') => media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: transparency }, { name: 'forced-colors', value: colors }] });
  await accessibility();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const openSettings = async () => { await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.getByRole('tab', { name: '界面显示', exact: true }).click(); return dialog; };
  const closeSettings = dialog => dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const wallpaper = join(output, 'native-wallpaper.png');
  const encodedWallpaper = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1000; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#b9e3d2'; ctx.fillRect(0, 0, 1800, 1000);
    // Wider edges survive the parent plane's blur on both native pipelines.
    for (let y = 0; y < 1000; y += 32) for (let x = 0; x < 1800; x += 32) { ctx.fillStyle = (x + y) / 32 % 2 ? '#13271d' : '#f4fff7'; ctx.fillRect(x, y, 32, 32); }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(wallpaper, Buffer.from(encodedWallpaper, 'base64'));
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, wallpaper);
  const initialSettings = await openSettings();
  await initialSettings.getByLabel('界面材质效果', { exact: true }).selectOption('fallback');
  await initialSettings.getByRole('button', { name: /^(选择|更换)背景图片$/ }).click();
  await initialSettings.getByLabel('背景图片不透明度').fill('100'); await initialSettings.getByLabel('内容区域不透明度').fill('74');
  await initialSettings.getByLabel('界面材质效果', { exact: true }).selectOption('full');
  await page.waitForFunction(() => document.documentElement.dataset.materialEffect === 'full' && document.documentElement.dataset.customBackground === 'true');
  await closeSettings(initialSettings);
  async function measured(selector) {
    await page.waitForFunction(selector => { const value = document.querySelector(selector)?.style.getPropertyValue('--glass-refraction'), id = value?.match(/^url\(#(coolapk-desktop-glass-\d+)\)$/)?.[1]; return !!id && !!document.getElementById(id)?.querySelector('feImage'); }, selector);
    const value = await page.locator(selector).first().evaluate(async node => {
      const bounds = node.getBoundingClientRect(), id = node.style.getPropertyValue('--glass-refraction').match(/#(coolapk-desktop-glass-\d+)/)?.[1], filter = document.getElementById(id);
      const image = new Image(); image.src = filter.querySelector('feImage').getAttribute('href'); await image.decode();
      const pseudo = node.matches('.sidebar,.topbar') ? '::before' : null;
      return { selector: node.className, paintPlane: pseudo || 'element', id, width: bounds.width, height: bounds.height, rasterWidth: image.naturalWidth, rasterHeight: image.naturalHeight, composite: !!filter.querySelector('feComposite[in2="green-warp"]'), computed: getComputedStyle(node, pseudo).backdropFilter };
    });
    assert.ok(value.computed.includes(value.id)); value.relativeAspectError = Math.abs((value.width / value.height) / (value.rasterWidth / value.rasterHeight) - 1); assert.ok(value.relativeAspectError < .02, JSON.stringify(value));
    assert.ok(value.rasterWidth <= 1024 && value.rasterHeight <= 1024 && value.rasterWidth * value.rasterHeight <= 181000); return value;
  }
  await record('native navigation, search and cards install independent measured optics', async () => {
    const values = await Promise.all(['.sidebar', '.topbar', '.search-box', '.home-feed-header', '.feed-card', '.navigation-glass-lens'].map(measured));
    assert.equal(values[0].paintPlane, '::before');
    assert.equal(await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backdropFilter), 'none');
    assert.equal(values[1].paintPlane, '::before');
    assert.equal(await page.locator('.topbar').evaluate(node => getComputedStyle(node).backdropFilter), 'none');
    assert.ok(new Set(values.map(value => value.id)).size >= 5); assert.equal(values.at(-1).composite, true); measurements.push({ measured: values });
  });
  let phase = 'normal-motion';
  const pixelDifference = (a, b, rimOnly = false, region) => page.evaluate(async ({ encoded, rimOnly, region }) => {
    const pictures = await Promise.all(encoded.map(async value => {
      const image = new Image(); image.src = 'data:image/png;base64,' + value; await image.decode();
      const left = Math.max(0, Math.floor(region?.x ?? 0)), top = Math.max(0, Math.floor(region?.y ?? 0));
      const right = Math.min(image.naturalWidth, Math.ceil((region?.x ?? 0) + (region?.width ?? image.naturalWidth)));
      const bottom = Math.min(image.naturalHeight, Math.ceil((region?.y ?? 0) + (region?.height ?? image.naturalHeight)));
      const canvas = document.createElement('canvas'); canvas.width = right - left; canvas.height = bottom - top;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    }));
    const [a, b] = pictures; if (a.width !== b.width || a.height !== b.height) throw new Error('Native owner pixel dimensions changed');
    let sum = 0, count = 0, maximum = 0, changedPixels = 0;
    for (let y = 2; y < a.height - 2; y++) for (let x = 2; x < a.width - 2; x++) {
      if (rimOnly && x > 18 && x < a.width - 18 && y > 18 && y < a.height - 18) continue;
      const offset = (y * a.width + x) * 4; let changed = false;
      for (let channel = 0; channel < 3; channel++) { const delta = Math.abs(a.data[offset + channel] - b.data[offset + channel]); sum += delta; maximum = Math.max(maximum, delta); changed ||= delta !== 0; count++; }
      if (changed) changedPixels++;
    }
    return { mean: sum / count, maximum, changedFraction: changedPixels / (count / 3) };
  }, { encoded: [a, b].map(png => png.toString('base64')), rimOnly, region });
  async function filteredPixels(selector) {
    const target = page.locator(selector).first(), optics = await measured(selector); let captureBox;
    await target.evaluate(async node => { await Promise.all(node.getAnimations({ subtree: true }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))); });
    const capture = async label => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
      let box = await target.boundingBox(), stable = false; for (let attempt = 0; attempt < 10; attempt++) { await page.waitForTimeout(50); const next = await target.boundingBox(); stable = !!box && !!next && ['x', 'y', 'width', 'height'].every(key => Math.abs(box[key] - next[key]) < .1); box = next; if (stable) break; } assert.ok(stable, 'Actual owner bounds must settle before screenshot: ' + selector);
      captureBox = box;
      // Capture the viewport once and crop the owner's pixels in memory. Native
      // backdrop filters can deadlock Chromium's clipped-screenshot path when
      // the window is composited in software; full captures remain available.
      const options = { scale: 'css', timeout: 60000 };
      // A settled DOM does not guarantee the first GPU filter paint is settled.
      // Compare successive captures of this unchanged state before using it.
      let previous = await page.screenshot(options);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const current = await page.screenshot(options), stability = await pixelDifference(previous, current, false, captureBox);
        measurements.push({ captureStability: { phase, selector, label, attempt, ...stability } });
        if (stability.mean < .01) return current;
        previous = current;
      }
      assert.fail('Native filter pixels did not settle in five repeated captures: ' + selector + '/' + label);
    };
    const before = await capture('svg');
    const original = await target.evaluate(node => { const values = [node.style.getPropertyValue('backdrop-filter'), node.style.getPropertyValue('-webkit-backdrop-filter')]; const baseline = getComputedStyle(node).backdropFilter.replace(/url\([^)]*\)\s*/g, ''); node.style.backdropFilter = baseline; node.style.webkitBackdropFilter = baseline; return values; });
    let without;
    try { without = await capture('without-svg'); } finally { await target.evaluate((node, original) => { for (let i = 0; i < 2; i++) { const key = ['backdrop-filter', '-webkit-backdrop-filter'][i]; if (original[i]) node.style.setProperty(key, original[i]); else node.style.removeProperty(key); } }, original); }
    const repeated = await capture('svg-repeated');
    // Keep typed pixel buffers in the renderer; do not serialize millions of
    // RGBA numbers over CDP for every native surface.
    const rim = await pixelDifference(before, without, true, captureBox), repeat = await pixelDifference(before, repeated, false, captureBox);
    const differences = { svgRimMeanDifference: rim.mean, svgRimMaximumDifference: rim.maximum, svgRimChangedFraction: rim.changedFraction, repeatDifference: repeat.mean };
    const values = { phase, selector, optics, ...differences };
    measurements.push({ actualOwnedPixelPipeline: values });
    assert.ok(values.svgRimMeanDifference > .05, 'measured SVG must change the actual owner backdrop: ' + JSON.stringify(values));
    assert.ok(values.repeatDifference < .2, 'owner pixels must return to the same rendered filter: ' + JSON.stringify(values));
  }
  await record('actual navigation lens and search measured SVG alter backdrop pixels without altering content', async () => {
    await filteredPixels('.navigation-glass-lens'); await filteredPixels('.search-box');
  });
  await record('actual settings modal uses its independently sized SVG in the native pixel pipeline', async () => {
    const settings = await openSettings(); await filteredPixels('.settings-modal'); await closeSettings(settings);
  });
  const openDetail = async () => { await page.locator('.feed-card').first().getByRole('button', { name: '查看动态', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '动态详情', exact: true }); await dialog.waitFor(); return dialog; };
  const closeDetail = dialog => dialog.getByRole('button', { name: '关闭动态详情', exact: true }).click();
  await record('actual detail panel preserves measured SVG pixels after its entry animation completes', async () => {
    const dialog = await openDetail(); await filteredPixels('.detail-panel'); await closeDetail(dialog);
  });
  await record('navigation lens persists, follows actual buttons and never intercepts mouse/keyboard', async () => {
    await lens.evaluate(node => node.dataset.nativeProbe = 'persistent');
    for (const label of ['热榜', '首页']) {
      const button = navigation.getByRole('button', { name: label, exact: true }); await button.focus(); await button.press('Enter'); await page.getByRole('heading', { name: label, exact: true, level: 1 }).waitFor();
      await lens.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
      assert.equal(await lens.getAttribute('data-native-probe'), 'persistent');
      const selected = await button.boundingBox(), glass = await lens.boundingBox(); assert.ok(Math.abs(selected.x - glass.x) < 2 && Math.abs(selected.y - glass.y) < 2 && Math.abs(selected.width - glass.width) < 2);
      assert.equal(await lens.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
      assert.equal(await button.evaluate(node => { const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit); }), true);
    }
  });
  for (const width of [900, 1280, 1360]) await record(`${width}px native search/publication layout stays reachable after optics resize`, async () => {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 800 }), width);
    await page.waitForFunction(width => Math.abs(outerWidth - width) < 2, width); await settle();
    const optics = await measured('.search-box'); measurements.push({ width, searchOptics: optics });
    const values = await page.evaluate(() => { const search = document.querySelector('.search-box').getBoundingClientRect(), actions = document.querySelector('.topbar-actions').getBoundingClientRect(); return { width: innerWidth, scroll: document.documentElement.scrollWidth, searchRight: search.right, actionLeft: actions.left, actionRight: actions.right, reachable: [...document.querySelectorAll('.topbar-actions button')].every(node => { const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit === node || node.contains(hit); }) }; });
    assert.ok(values.scroll <= values.width && values.searchRight < values.actionLeft && values.actionRight <= values.width && values.reachable);
    await page.keyboard.press('Control+k'); assert.equal(await input.evaluate(node => node === document.activeElement), true); await input.fill('原生玻璃-' + width); await page.getByRole('option', { name: '原生玻璃搜索建议', exact: true }).waitFor();
    const suggestions = await page.locator('.search-suggestions').boundingBox(), search = await page.locator('.search-box').boundingBox(); assert.ok(Math.abs(suggestions.x - search.x) < 2 && suggestions.y >= search.y + search.height && suggestions.x + suggestions.width <= values.width);
    await measured('.search-suggestions'); await input.press('Escape');
  });
  await record('mode switching cleans measured variables and restores ordinary navigation selection', async () => {
    for (const [mode, expected] of [['blur_only', 'blur(18px)'], ['fallback', 'none'], ['transparent', 'none']]) {
      const dialog = await openSettings(); await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(mode); await closeSettings(dialog);
      await page.waitForFunction(mode => document.documentElement.dataset.materialEffect === mode && !document.querySelector('.search-box').style.getPropertyValue('--glass-refraction'), mode);
      assert.equal(await page.locator('.feed-card').first().evaluate(node => getComputedStyle(node).backdropFilter), expected);
      assert.equal(await lens.isVisible(), false); assert.equal(await page.locator('filter[id^="coolapk-desktop-glass-"]').count(), 0);
    }
    const dialog = await openSettings(); await dialog.getByLabel('界面材质效果', { exact: true }).selectOption('full'); await closeSettings(dialog); await measured('.search-box');
  });
  await record('native high contrast and followed reduced transparency disable navigation/search optics', async () => {
    let dialog = await openSettings(); await dialog.getByRole('switch', { name: '跟随 Windows 透明效果', exact: true }).check(); await closeSettings(dialog); await accessibility('reduce');
    await page.waitForFunction(() => !document.querySelector('.search-box').style.getPropertyValue('--glass-refraction'));
    for (const selector of ['.search-box', '.sidebar', '.topbar', '.feed-card']) assert.equal(await page.locator(selector).first().evaluate(node => getComputedStyle(node).backdropFilter), 'none');
    assert.equal(await lens.isVisible(), false);
    dialog = await openSettings(); await dialog.getByRole('switch', { name: '跟随 Windows 透明效果', exact: true }).uncheck(); await closeSettings(dialog); await measured('.search-box');
    await accessibility('reduce', 'active'); await page.waitForFunction(() => !document.querySelector('.search-box').style.getPropertyValue('--glass-refraction'));
    assert.equal(await page.locator('.search-box').evaluate(node => getComputedStyle(node).backdropFilter), 'none'); assert.equal(await lens.isVisible(), false);
    assert.equal(await page.locator('filter[id^="coolapk-desktop-glass-"]').count(), 0);
    await accessibility(); await measured('.search-box');
  });
  await record('reduced motion removes lens transitions without losing keyboard navigation', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await lens.evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    const hot = navigation.getByRole('button', { name: '热榜', exact: true }); await hot.focus(); await hot.press('Enter'); await page.getByRole('heading', { name: '热榜', exact: true, level: 1 }).waitFor();
    const selected = await hot.boundingBox(), glass = await lens.boundingBox(); assert.ok(Math.abs(selected.y - glass.y) < 2);
  });
  await record('reduced motion retains real measured modal and detail backdrop pixels', async () => {
    phase = 'reduced-motion';
    const settings = await openSettings(); await filteredPixels('.settings-modal'); await closeSettings(settings);
    const detail = await openDetail(); await filteredPixels('.detail-panel'); await closeDetail(detail);
  });
  await record('native dispersion restores original source alpha in the flat interior', async () => {
    const optics = await measured('.navigation-glass-lens');
    await page.evaluate(id => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'native-alpha-probe'; svg.setAttribute('width', '440'); svg.setAttribute('height', '100'); svg.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:white;pointer-events:none';
      for (const x of [20, 240]) { const rect = document.createElementNS(svg.namespaceURI, 'rect'); for (const [key, value] of Object.entries({ x, y: 20, width: 180, height: 60, fill: '#f05028', 'fill-opacity': '.3', ...(x === 20 ? { filter: `url(#${id})` } : {}) })) rect.setAttribute(key, String(value)); svg.append(rect); } document.body.append(svg);
    }, optics.id);
    try {
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: 440, height: 100 }, scale: 'css' });
      const colors = await page.evaluate(async encoded => { const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = 440; canvas.height = 100; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return [110, 330].map(x => Array.from(ctx.getImageData(x, 50, 1, 1).data)); }, png.toString('base64'));
      for (let channel = 0; channel < 4; channel++) assert.ok(Math.abs(colors[0][channel] - colors[1][channel]) <= 1, JSON.stringify(colors)); measurements.push({ sourceAlphaPixels: colors });
    } finally { await page.evaluate(() => document.getElementById('native-alpha-probe').remove()); }
  });
  assert.deepEqual(errors, []);
  const native = await app.evaluate(async ({ app }) => ({ hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(), gpu: app.getGPUFeatureStatus() }));
  assert.equal(native.hardwareAccelerationEnabled, hardware);
  writeFileSync(join(output, 'checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, fixture: 'Actual built Electron, isolated data and denied external network, synthetic API responses; no real account writes', hardware, checks, measurements, native, errors, passed: true }, null, 2) + '\n');
  console.log('LIQUID_NATIVE_PASS', checks.length, hardware ? 'hardware' : 'software');
} catch (error) { const page = await app.firstWindow(); await page.screenshot({ path: join(output, 'failure.png') }); writeFileSync(join(output, 'failure.txt'), String(error)); writeFileSync(join(output, 'failure.json'), JSON.stringify({ hardware, checks, measurements, errors, error: String(error) }, null, 2)); throw error; }
finally { await app.close(); }
