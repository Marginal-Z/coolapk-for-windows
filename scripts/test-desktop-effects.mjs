import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = '.local/desktop-effects-check', port = Number(process.env.COOLAPK_DESKTOP_EFFECTS_TEST_PORT || 5208), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DesktopEffects}from'/src/DesktopEffects.tsx';import{Settings}from'/src/Settings.tsx';import{usePreferences}from'/src/preferences.ts';import{Modal}from'/src/components.tsx';import'/src/styles.css';function Harness(){const state=usePreferences();const[open,setOpen]=useState(false),[detail,setDetail]=useState(false);window.__effectsState=state.preferences;window.__effectsUpdate=state.updatePreferences;return <><div style={{background:'linear-gradient(30deg,#ffb28a,#73bad4,#765bb5)'}}><div className="main-scroll" data-testid="main-scroll" style={{height:400,overflow:'auto'}}><div style={{height:1800}}>可滚动内容</div></div><button onClick={()=>setOpen(true)}>打开设置</button><button onClick={()=>setDetail(true)}>打开动态</button></div>{open&&<Modal title="设置" onClose={()=>setOpen(false)}><Settings namespace="synthetic" accountCount={0} version="synthetic" preferences={state.preferences} onPreferencesChange={state.updatePreferences} onAccountPrivacy={()=>window.__effectsPrivacy=true} onAccountNotifications={()=>window.__effectsNotifications=true}/></Modal>}{detail&&<section className="detail-panel" role="dialog" aria-modal="true" aria-label="动态详情"><button onClick={()=>setDetail(false)}>关闭详情</button><div className="detail-scroll" data-testid="detail-scroll" style={{height:350,flex:'none',overflow:'auto'}}><div style={{height:1800}}>动态内容</div></div></section>}<div className="toast" data-testid="toast">通知位置</div><DesktopEffects preferences={state.preferences}/></>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = []; let mediaEnvironment;
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1120, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toDataURL; window.__effectsMapEncodes = 0;
    HTMLCanvasElement.prototype.toDataURL = function (...args) { if (this.width === 256 && this.height === 128) window.__effectsMapEncodes++; return encode.apply(this, args); };
  });
  page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/${output}/fixture.html`);
  mediaEnvironment = await page.evaluate(() => ({ reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches, forcedColors: matchMedia('(forced-colors: active)').matches }));
  // This preference comes from Windows in an ordinary native process, but can
  // differ inside the terminal sandbox. Exercise both branches explicitly.
  const media = await context.newCDPSession(page);
  const accessibilityMedia = async (transparency = 'no-preference', colors = 'none') => {
    await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: transparency }, { name: 'forced-colors', value: colors }] });
    assert.deepEqual(await page.evaluate(() => [matchMedia('(prefers-reduced-transparency: reduce)').matches, matchMedia('(forced-colors: active)').matches]), [transparency === 'reduce', colors === 'active']);
  };
  await page.getByRole('button', { name: '打开设置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await record('optional cloud settings entries invoke real callbacks', async () => { await dialog.getByRole('button', { name: '隐私设置', exact: true }).click(); await dialog.getByRole('button', { name: '订阅消息提醒', exact: true }).click(); assert.deepEqual(await page.evaluate(() => [window.__effectsPrivacy, window.__effectsNotifications]), [true, true]); });
  await dialog.getByRole('button', { name: /^界面显示/ }).click();
  await record('fresh material selection remains explicit in the original media environment', async () => {
    assert.equal(await dialog.getByRole('switch', { name: '跟随 Windows 透明效果', exact: true }).isChecked(), false);
    assert.equal(await page.evaluate(() => window.__effectsState.materialFollowSystem), false);
    if (!mediaEnvironment.forcedColors) assert.ok((await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
  });
  await accessibilityMedia();
  await record('all native material values persist and change the real backdrop pipeline', async () => {
    assert.deepEqual(await dialog.getByLabel('界面材质效果', { exact: true }).locator('option').allTextContents(), ['液态玻璃', '背景模糊', '半透明']);
    for (const [value, includes] of [['blur_only', 'blur(18px)'], ['fallback', 'none'], ['full', 'coolapk-desktop-glass']]) {
      await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(value); await page.waitForFunction(value => document.documentElement.dataset.materialEffect === value, value);
      const filter = await dialog.evaluate(node => getComputedStyle(node).backdropFilter); assert.ok(filter.includes(includes), `${value} expected ${includes}, got ${filter}`); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).materialEffect), value);
    }
    assert.match(await page.locator('#coolapk-desktop-glass feImage').getAttribute('href'), /^data:image\/png;base64,/); assert.equal(await page.getByTestId('toast').evaluate(node => getComputedStyle(node).position), 'fixed'); await page.screenshot({ path: `${output}/material.png` });
  });
  await record('visible modal installs optics at its own aspect ratio', async () => {
    await page.waitForFunction(() => /url\("?#coolapk-desktop-glass-\d+/.test(getComputedStyle(document.querySelector('[role="dialog"]')).backdropFilter));
    const actual = await dialog.evaluate(node => {
      const id = getComputedStyle(node).backdropFilter.match(/#(coolapk-desktop-glass-\d+)/)?.[1];
      return { width: node.offsetWidth, height: node.offsetHeight, href: document.getElementById(id)?.querySelector('feImage')?.getAttribute('href') };
    });
    const png = Buffer.from(actual.href.split(',')[1], 'base64'), width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.ok(width <= 1024 && height <= 1024 && width * height <= 181000);
    assert.ok(Math.abs(width / height - actual.width / actual.height) < .03, 'map must retain the modal aspect ratio');
  });
  await record('reading tokens settle after theme writes and reuse the shared fallback map', async () => {
    const originalMap = await page.locator('#coolapk-desktop-glass feImage').getAttribute('href');
    assert.equal(await page.evaluate(() => window.__effectsMapEncodes), 1, 'StrictMode should encode the displacement map only once');
    await page.evaluate(() => {
      window.__effectsUpdate({ surfaceOpacity: .4 });
      const root = document.documentElement; root.dataset.theme = 'dark'; root.style.setProperty('--surface', '#202823'); root.style.setProperty('--text', '#e3ebe6'); root.style.setProperty('--muted', '#a3b2a9'); root.style.setProperty('--accent', '#65cf94');
    });
    await page.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--material-reading-opacity')) >= 75);
    const settled = await page.evaluate(async () => {
      let count = 0; const observer = new MutationObserver(entries => count += entries.length); observer.observe(document.documentElement, { attributes: true });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))); observer.disconnect();
      return { count, tint: parseFloat(document.documentElement.style.getPropertyValue('--material-reading-opacity')) };
    });
    assert.equal(settled.count, 0, 'our token writes must not trigger an observer feedback loop'); assert.ok(settled.tint < 85, 'readability tint should preserve visible wallpaper');
    await page.evaluate(() => window.__effectsUpdate({ fontSize: 'large', showFPS: false }));
    assert.equal(await page.locator('#coolapk-desktop-glass feImage').getAttribute('href'), originalMap);
    assert.equal(await page.evaluate(() => window.__effectsMapEncodes), 1, 'preference rerenders should not regenerate or encode the static map');
    await page.evaluate(() => { const root = document.documentElement; delete root.dataset.theme; for (const key of ['--surface', '--text', '--muted', '--accent']) root.style.removeProperty(key); window.__effectsUpdate({ surfaceOpacity: .78, fontSize: 'system' }); });
  });
  await record('nested reading sections share their material owner without redundant backdrop passes', async () => {
    await dialog.evaluate(node => { const child = document.createElement('article'); child.className = 'feed-card'; child.id = 'nested-material-probe'; child.textContent = '可读内容'; node.append(child); });
    try {
      const nested = page.locator('#nested-material-probe'); assert.equal(await nested.evaluate(node => getComputedStyle(node).backdropFilter), 'none');
      assert.ok((await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
    } finally { await page.locator('#nested-material-probe').evaluate(node => node.remove()); }
  });
  await record('system high contrast disables translucent refraction without discarding the saved choice', async () => { await accessibilityMedia('no-preference', 'active'); assert.equal(await dialog.evaluate(node => getComputedStyle(node).backdropFilter), 'none'); assert.equal(await page.evaluate(() => window.__effectsState.materialEffect), 'full'); await accessibilityMedia(); });
  await record('reduced transparency only overrides an explicitly followed Windows setting and opting out restores material', async () => {
    await accessibilityMedia('reduce');
    try {
      assert.ok((await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
      const follow = dialog.getByRole('switch', { name: '跟随 Windows 透明效果', exact: true });
      await follow.check(); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'true');
      for (const value of ['full', 'blur_only', 'fallback']) {
        await dialog.getByLabel('界面材质效果', { exact: true }).selectOption(value); await page.waitForFunction(value => document.documentElement.dataset.materialEffect === value, value);
        const surface = await dialog.evaluate(node => {
          const style = getComputedStyle(node), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const drawing = canvas.getContext('2d');
          const pixel = color => { drawing.clearRect(0, 0, 1, 1); drawing.fillStyle = color; drawing.fillRect(0, 0, 1, 1); return Array.from(drawing.getImageData(0, 0, 1, 1).data); };
          return { filter: style.backdropFilter, actual: pixel(style.backgroundColor), expected: pixel(style.getPropertyValue('--surface').trim()) };
        });
        assert.equal(surface.filter, 'none'); assert.equal(surface.actual[3], 255); assert.deepEqual(surface.actual, surface.expected);
        assert.equal(await page.evaluate(() => window.__effectsState.materialEffect), value); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).materialEffect), value);
      }
      await follow.uncheck(); await page.waitForFunction(() => document.documentElement.dataset.materialFollowSystem === 'false');
      await dialog.getByLabel('界面材质效果', { exact: true }).selectOption('full'); await page.waitForFunction(() => document.documentElement.dataset.materialEffect === 'full');
      assert.ok((await dialog.evaluate(node => getComputedStyle(node).backdropFilter)).includes('coolapk-desktop-glass'));
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).materialFollowSystem), false);
      await accessibilityMedia('reduce', 'active'); assert.equal(await dialog.evaluate(node => getComputedStyle(node).backdropFilter), 'none');
    } finally { await accessibilityMedia(); await page.evaluate(() => window.__effectsUpdate({ materialEffect: 'full', materialFollowSystem: false })); }
  });
  await record('every material keeps the actual painted surface when long dialog content scrolls past its viewport', async () => {
    await page.evaluate(() => {
      const holder = document.createElement('div'); holder.id = 'material-scroll-probe'; holder.style.cssText = 'position:fixed;left:30px;top:30px;width:180px;height:110px;z-index:100;background:rgb(240,20,30)';
      const modal = document.createElement('div'); modal.className = 'modal'; modal.style.cssText = 'width:100%;height:100%;max-height:none;border-radius:0;border:0;padding:0';
      const content = document.createElement('div'); content.style.cssText = 'height:1000px;min-height:1000px'; modal.append(content); holder.append(modal); document.body.append(holder);
    });
    const probe = page.locator('#material-scroll-probe .modal'), bounds = await probe.boundingBox(), clip = { x: bounds.x + 25, y: bounds.y + bounds.height - 30, width: 20, height: 20 };
    try {
      for (const effect of ['full', 'blur_only', 'fallback']) {
        await page.evaluate(effect => window.__effectsUpdate({ materialEffect: effect }), effect); await page.waitForFunction(effect => document.documentElement.dataset.materialEffect === effect, effect);
        await probe.evaluate(node => node.scrollTop = 0); const before = await page.screenshot({ clip });
        await probe.evaluate(node => node.scrollTop = 800); assert.ok(await probe.evaluate(node => node.scrollTop > node.clientHeight));
        assert.deepEqual(await page.screenshot({ clip }), before, 'scrolling must not reveal the untinted underlying pixels: ' + effect);
      }
    } finally { await page.evaluate(() => { document.getElementById('material-scroll-probe').remove(); window.__effectsUpdate({ materialEffect: 'full' }); }); }
  });
  await dialog.getByRole('switch', { name: '显示快速回顶按钮', exact: true }).check(); await dialog.getByRole('button', { name: '返回设置', exact: true }).click(); await dialog.getByRole('button', { name: /^实验室/ }).click();
  await record('FPS diagnostics start from actual animation frames and are removable', async () => { assert.equal(await page.getByLabel('页面帧率', { exact: true }).count(), 0); await dialog.getByRole('switch', { name: '显示 FPS', exact: true }).check(); await page.waitForFunction(() => /^[1-9]\d* FPS$/.test(document.querySelector('.desktop-fps')?.textContent || '')); const value = await page.getByLabel('页面帧率', { exact: true }).textContent(); assert.ok(Number.parseInt(value) > 0); await dialog.getByRole('switch', { name: '显示 FPS', exact: true }).uncheck(); await page.getByLabel('页面帧率', { exact: true }).waitFor({ state: 'hidden' }); assert.equal(await page.getByLabel('页面帧率', { exact: true }).count(), 0); });
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await page.emulateMedia({ reducedMotion: 'reduce' });
  await record('return-to-top scrolls and focuses the active main page', async () => { const target = page.getByTestId('main-scroll'); await target.evaluate(node => node.scrollTop = 700); await page.getByRole('button', { name: '返回顶部', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="main-scroll"]').scrollTop === 0); assert.equal(await target.evaluate(node => document.activeElement === node), true); await page.getByRole('button', { name: '返回顶部', exact: true }).waitFor({ state: 'hidden' }); });
  await record('active dialogs isolate return-to-top from the underlying page and retain keyboard reachability', async () => { await page.getByTestId('main-scroll').evaluate(node => node.scrollTop = 600); await page.getByRole('button', { name: '打开动态', exact: true }).click(); await page.getByTestId('detail-scroll').evaluate(node => node.scrollTop = 600); const detail = page.getByRole('dialog', { name: '动态详情', exact: true }); await detail.getByRole('button', { name: '返回顶部', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid="detail-scroll"]').scrollTop === 0); assert.equal(await page.getByTestId('main-scroll').evaluate(node => node.scrollTop), 600); assert.equal(await page.getByTestId('detail-scroll').evaluate(node => document.activeElement === node), true); await detail.getByRole('button', { name: '关闭详情', exact: true }).click(); await detail.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '返回顶部', exact: true }).waitFor(); await page.evaluate(() => window.__effectsUpdate({ showFastReturnView: false })); await page.getByRole('button', { name: '返回顶部', exact: true }).waitFor({ state: 'hidden' }); });
  await page.setViewportSize({ width: 430, height: 860 }); await page.getByRole('button', { name: '打开设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^界面显示/ }).click();
  await record('narrow material settings remain reachable without horizontal overflow', async () => { const material = page.getByLabel('界面材质效果', { exact: true }); await material.scrollIntoViewIfNeeded(); assert.ok((await material.boundingBox()).width > 0); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); });
  assert.deepEqual(errors, []); writeFileSync('research/desktop-effects-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks, errors, mediaEnvironment, mode: 'isolated renderer; records original media and explicitly exercises normal, high-contrast and reduced-transparency media with following on/off; actual surface colors, animation callbacks and scroll/focus; native SVG pixel pipeline checked separately in global-materials', result: 'passed' }, null, 2) + '\n'); console.log(JSON.stringify({ result: 'passed', groups: checks.length, mediaEnvironment }));
} finally { if (browser) await browser.close(); await server.close(); }
