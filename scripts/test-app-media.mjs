// Isolated synthetic renderer. No account, phone or external network requests.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_APP_MEDIA_TEST_PORT || 5198), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/app-media-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Catalog from'/src/Catalog.tsx';import{AppDiscovery}from'/src/AppDiscovery.tsx';import{AppIcon,Picture}from'/src/components.tsx';import{imageUrl,refreshResources}from'/src/data.ts';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'catalog',type:'app',id:'com.example.qq',title:'QQ'});const[namespace,setNamespace]=useState('guest');window.__appMediaPage=(value,scope='guest')=>{setPage(value);setNamespace(scope)};window.__appMediaImageUrl=imageUrl;window.__appMediaRefresh=refreshResources;const noop=()=>{};const props={page,namespace,account:null,go:setPage,onLogin:()=>window.__appMediaMock.login++,openEntity:noop,toast:noop,feedProps:{onUser:noop,onLink:noop,onLogin:noop,onOpen:noop,onForward:noop,loggedIn:false,toast:noop}};return <main data-route={page.type+':'+page.id+':'+namespace} style={{maxWidth:1500,margin:'auto',padding:24}}>{page.kind==='apps'?<AppDiscovery {...props}/>:<Catalog {...props}/>}</main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const entryPath = resolve(output, 'entry.tsx');
writeFileSync(entryPath, readFileSync(entryPath, 'utf8').replace('</main>}createRoot', '<Picture src="https://image.coolapk.com/probe.jpg" alt="图片回退测试" /></main>}createRoot'));
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const fallbackRequests = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === 'https://image.coolapk.com/probe.jpg') { fallbackRequests.push(url); return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#14874e"/></svg>' }); }
    return url.startsWith(origin + '/') ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    const mock = window.__appMediaMock = { calls: [], login: 0, hold: '', pending: [], variant: 'array', screenshotCount: 3, openedImages: [] };
    const icon = 'http://pp.myapp.com/ma_icon/0/icon_6633_1790172526/256';
    const screenshots = [1,2,3].map(index => `http://pp.myapp.com/ma_pic2/0/shot_6633_${index}_1790172526/0`);
    window.coolapk = { openExternal: async url => { mock.openedImages.push(url); return { ok: true, data: {} }; }, call: async (operation, args = {}) => {
      mock.calls.push({ operation, args });
      if (operation === 'catalogApp') {
        const selectedScreenshots = screenshots.slice(0, mock.screenshotCount);
        const data = { id: 9, packageName: args.id, title: args.id === 'com.example.other' ? '另一应用' : 'QQ', logo: icon, apkversionname: '9.3.70', developername: '公开开发者', introduce: '<p>公开应用介绍</p>', screenshots: selectedScreenshots.join(','), ...(mock.variant === 'array' ? { screenList: selectedScreenshots } : {}), userAction: {} };
        if (mock.hold === args.id) await new Promise(resolve => mock.pending.push(resolve));
        return { ok: true, data: { data } };
      }
      if (operation === 'appDiscovery' || operation === 'gameDiscovery') return { ok: true, data: { data: Array.from({ length: 6 }, (_, index) => ({ entityType: 'apk', id: index + 1, packageName: 'com.example.app' + index, title: '公开应用' + index, logo: icon, description: '用于测试电脑网格布局的说明' })), hasMore: false } };
      throw new Error('Unexpected synthetic operation: ' + operation);
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/.local/app-media-check/test.html`);
  await record('a failed public image proxy falls back once to the original HTTPS URL', async () => {
    const image = page.locator('img[alt="图片回退测试"]'); await image.waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('img[alt="图片回退测试"]'); return image?.src === 'https://image.coolapk.com/probe.jpg' && image.naturalWidth === 64; });
    assert.deepEqual(fallbackRequests, ['https://image.coolapk.com/probe.jpg']);
  });
  await record('actual public detail field aliases display without using a user avatar', async () => {
    await page.getByRole('heading', { name: 'QQ', exact: true }).waitFor();
    assert.equal(await page.locator('.app-detail-header .avatar').count(), 0);
    await page.getByText('9.3.70', { exact: true }).waitFor(); await page.getByText('公开开发者', { exact: true }).waitFor();
    await page.getByText('公开应用介绍', { exact: true }).waitFor();
    assert.match(await page.evaluate(() => window.__appMediaImageUrl('http://pp.myapp.com/ma_icon/0/icon_6633_1790172526/256')), /^coolapk-image:\/\/image\/\?url=https%3A%2F%2Fpp.myapp.com/);
  });
  await record('screenList and the comma-string alias produce one ordered screenshot strip', async () => {
    assert.equal(await page.getByRole('region', { name: '应用介绍截图' }).getByRole('button').count(), 3);
    assert.deepEqual(await page.locator('.app-screenshot-strip button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label'))), ['查看QQ截图 1', '查看QQ截图 2', '查看QQ截图 3']);
  });
  await record('screenshots open at the selected index and keyboard arrows preserve the sequence', async () => {
    await page.getByRole('button', { name: '查看QQ截图 2', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.match(await dialog.innerText(), /2\s*\/\s*3/);
    await page.keyboard.press('ArrowRight'); assert.match(await dialog.innerText(), /3\s*\/\s*3/);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  });
  await record('refresh reducing screenshots from three to one and then zero preserves the open preview snapshot', async () => {
    await page.getByRole('button', { name: '查看QQ截图 3', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    await page.evaluate(() => { window.__appMediaMock.screenshotCount = 1; window.__appMediaRefresh(); });
    await page.waitForFunction(() => document.querySelectorAll('.app-screenshot-strip > button').length === 1);
    assert.equal(await dialog.getAttribute('aria-label'), '图片 3 / 3');
    await dialog.getByRole('button', { name: '查看原图', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__appMediaMock.openedImages.at(-1)), 'https://pp.myapp.com/ma_pic2/0/shot_6633_3_1790172526/0');
    await page.evaluate(() => { window.__appMediaMock.screenshotCount = 0; window.__appMediaRefresh(); });
    await page.getByRole('region', { name: '应用介绍截图' }).waitFor({ state: 'hidden' });
    assert.equal(await dialog.getAttribute('aria-label'), '图片 3 / 3');
    await page.keyboard.press('ArrowLeft'); assert.equal(await dialog.getAttribute('aria-label'), '图片 2 / 3');
    await dialog.getByRole('button', { name: '查看原图', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__appMediaMock.openedImages.at(-1)), 'https://pp.myapp.com/ma_pic2/0/shot_6633_2_1790172526/0');
    await page.keyboard.press('ArrowRight'); assert.equal(await dialog.getAttribute('aria-label'), '图片 3 / 3');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__appMediaMock.screenshotCount = 3; window.__appMediaRefresh(); });
    await page.waitForFunction(() => document.querySelectorAll('.app-screenshot-strip > button').length === 3);
  });
  await record('the string-only API screenshot field renders and page navigation closes an open old preview', async () => {
    await page.getByRole('button', { name: '查看QQ截图 2', exact: true }).click(); await page.getByRole('dialog').waitFor();
    await page.evaluate(() => { window.__appMediaMock.variant = 'string'; window.__appMediaPage({ kind:'catalog', type:'app', id:'com.example.other', title:'另一应用' }); });
    await page.locator('main[data-route="app:com.example.other:guest"]').waitFor(); await page.getByRole('heading', { name: '另一应用', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /查看另一应用截图/ }).count(), 3); assert.equal(await page.getByRole('dialog').count(), 0);
  });
  await record('changing only the account namespace closes the open preview before a fresh profile is displayed', async () => {
    await page.getByRole('button', { name: '查看另一应用截图 2', exact: true }).click(); await page.getByRole('dialog').waitFor();
    await page.evaluate(() => window.__appMediaPage({ kind:'catalog', type:'app', id:'com.example.other', title:'另一应用' }, 'other-guest'));
    await page.locator('main[data-route="app:com.example.other:other-guest"]').waitFor(); await page.getByRole('heading', { name: '另一应用', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
  });
  await record('image transport failures remain visible rather than becoming user initials', async () => {
    await page.locator('.app-detail-header .app-icon .image-failed').waitFor();
    assert.equal(await page.locator('.app-detail-header .app-icon').innerText(), '图片暂时无法加载');
    assert.equal(await page.locator('.app-detail-header .avatar').count(), 0);
  });
  await record('public app list uses poster columns at desktop and narrow dark widths', async () => {
    await page.evaluate(() => window.__appMediaPage({ kind:'apps', type:'apps', title:'应用与游戏' })); await page.locator('.app-discovery-grid .entity-poster-open').first().waitFor();
    const desktopColumns = await page.locator('.app-discovery-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length); assert.ok(desktopColumns >= 3);
    assert.equal(await page.locator('.app-discovery-grid .entity-poster-cover-icon').count(), 6);
    await page.setViewportSize({ width: 640, height: 800 }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    assert.ok(await page.locator('.app-discovery-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length) >= 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.__appMediaMock.calls.every(item => ['catalogApp', 'appDiscovery', 'gameDiscovery'].includes(item.operation))), true);
  await page.screenshot({ path: resolve(output, 'app-list-narrow.png') });
  writeFileSync('research/app-media-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic React renderer under StrictMode; external network blocked; no real accounts or write operations', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: resolve(output, 'failure.png') }); throw error; }
finally { await browser?.close(); await server.close(); }
