import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/material-preferences-check';
const port = Number(process.env.COOLAPK_MATERIAL_PREFERENCES_PORT || 5314);
const origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Settings}from'/src/Settings.tsx';import{DesktopEffects}from'/src/DesktopEffects.tsx';import{DEFAULT_PREFERENCES,normalizePreferences}from'/core/preferences.mjs';import'/src/styles.css';function Harness(){const[p,set]=useState({...DEFAULT_PREFERENCES});useEffect(()=>{window.__preferences=p},[p]);return <><main className="app-shell"><aside className="sidebar">导航</aside><section className="workspace"><div className="topbar">搜索</div><main className="main-scroll">内容</main></section></main><Settings namespace="test" accountCount={0} version="0.8.1" preferences={p} onPreferencesChange={v=>set(old=>normalizePreferences({...old,...v}))}/><DesktopEffects preferences={p} backgroundActive/></>}createRoot(document.getElementById('root')).render(<Harness/>);`);

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(`${origin}/${output}/fixture.html`);
  await page.getByRole('button', { name: /^界面显示/ }).click();
  const materials = page.getByLabel('界面材质效果', { exact: true });
  const columns = page.getByLabel('信息流卡片列数', { exact: true });
  assert.deepEqual(await materials.locator('option').allTextContents(), ['背景模糊', '半透明']);
  assert.deepEqual(await materials.locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['blur_only', 'fallback']);
  assert.deepEqual(await columns.locator('option').allTextContents(), ['单列', '2 列', '3 列']);
  await materials.selectOption('blur_only');
  await page.waitForFunction(() => document.documentElement.dataset.materialEffect === 'blur_only');
  assert.match(await page.locator('.preferences-material-sample').evaluate(node => getComputedStyle(node).backdropFilter), /blur\(/);
  await materials.selectOption('fallback');
  await page.waitForFunction(() => document.documentElement.dataset.materialEffect === 'fallback');
  assert.equal(await page.locator('.preferences-material-sample').evaluate(node => getComputedStyle(node).backdropFilter), 'none');
  const opacity = page.getByLabel('内容区域不透明度', { exact: true });
  assert.equal(await opacity.getAttribute('min'), '75');
  await opacity.evaluate(node => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(node, '0'); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => window.__preferences.surfaceOpacity === .75);
  assert.equal(await opacity.inputValue(), '75');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--material-reading-opacity')), '75%');
  await columns.selectOption('3');
  await page.waitForFunction(() => document.querySelector('[aria-label="信息流卡片列数"]').value === '3');
  assert.deepEqual(errors, []);
  console.log('MATERIAL_PREFERENCES_PASS', JSON.stringify({ materialOptions: 2, maxFeedColumns: 3, checks: 1 }));
} finally {
  await browser?.close();
  await server.close();
}
