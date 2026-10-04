// Explicit native guest read-only media acceptance using the production bridge,
// production public-image protocol and a fresh account store on the D workspace.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import electron from 'electron';
import playwright from 'playwright';

if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly run native public read-only app/media acceptance.');
const root = resolve('.'), output = resolve('.local/app-media-native-check'); mkdirSync(output, { recursive: true });
// Production deliberately accepts only this exact development origin.
const port = 5173;
writeFileSync(join(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' https: data: blob: coolapk-image:; media-src https: blob:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(join(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Catalog from'/src/Catalog.tsx';import{AppDiscovery}from'/src/AppDiscovery.tsx';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'apps',type:'apps',title:'应用与游戏'});window.__publicMediaPage=setPage;const noop=()=>{};const props={page,namespace:'fresh-public-guest',account:null,go:setPage,onLogin:noop,openEntity:item=>setPage({kind:'catalog',type:'app',id:item.packageName,title:item.title}),toast:noop,feedProps:{onUser:noop,onLink:noop,onLogin:noop,onOpen:noop,onForward:noop,loggedIn:false,toast:noop}};return <main style={{maxWidth:1400,margin:'auto',padding:28}}>{page.kind==='apps'?<AppDiscovery {...props}/>:<Catalog {...props}/>}</main>}createRoot(document.getElementById('root')).render(<Fixture/>);`);
const server = await createServer({ logLevel: 'warn', plugins: [{ name: 'public-media-fixture', configureServer(server) { server.middlewares.use(async (request, response, next) => { if (request.url !== '/') return next(); const html = readFileSync(join(output, 'test.html'), 'utf8').replace('src="./entry.tsx"', 'src="/.local/app-media-native-check/entry.tsx"'); response.setHeader('Content-Type', 'text/html'); response.end(await server.transformIndexHtml('/', html)); }); } }], server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const env = { ...process.env, COOLAPK_DEV_URL: `http://127.0.0.1:${port}`, COOLAPK_TEST_DATA: mkdtempSync(join(output, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
let desktop; const checks = [], errors = [];
try {
  desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app-discovery-grid .entity-card').first().waitFor({ timeout: 30000 });
  const account = await page.evaluate(async () => (await window.coolapk.accounts()).data.current); assert.equal(account, null);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.app-discovery-grid .app-icon img')).slice(0, 6).length === 6 && Array.from(document.querySelectorAll('.app-discovery-grid .app-icon img')).slice(0, 6).every(image => image.complete && image.naturalWidth > 0), null, { timeout: 30000 });
  checks.push({ feature: 'public app rank icons', samples: 6, nativeDecoded: true });
  await page.screenshot({ path: join(output, 'app-icons.png') });
  for (const [id, expectedCount] of [['com.tencent.mobileqq', 5], ['com.coolapk.market', 6]]) {
    await page.evaluate(id => window.__publicMediaPage({ kind:'catalog', type:'app', id, title:'公开应用详情' }), id);
    await page.locator('.app-detail-header').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => { const image = document.querySelector('.app-detail-header .app-icon img'); return image?.complete && image.naturalWidth > 0; }, null, { timeout: 30000 });
    const buttons = page.locator('.app-screenshot-strip > button'); await buttons.first().scrollIntoViewIfNeeded(); assert.equal(await buttons.count(), expectedCount);
    for (let index = 0; index < expectedCount; index++) { await buttons.nth(index).scrollIntoViewIfNeeded(); await page.waitForFunction(index => { const image = document.querySelectorAll('.app-screenshot-strip img')[index]; return image?.complete && image.naturalWidth > 0; }, index, { timeout: 30000 }); }
    assert.equal(await page.locator('.app-detail-header .avatar').count(), 0);
    assert.equal(await page.locator('.app-screenshot-strip .image-failed').count(), 0);
    await buttons.nth(1).click(); const preview = page.getByRole('dialog'); await preview.waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('.lightbox img'); return image?.complete && image.naturalWidth > 0; }, null, { timeout: 30000 });
    await page.keyboard.press('Escape'); await preview.waitFor({ state: 'hidden' });
    checks.push({ feature: 'public app detail media', packageName: id, screenshotCount: expectedCount, nativeDecoded: true, previewDecoded: true });
    await page.screenshot({ path: join(output, id + '.png') });
  }
  assert.deepEqual(errors, []);
  writeFileSync('research/app-media-native-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'fresh guest account store; production Electron preload and public image protocol; public read-only rank/detail/images; no login, phone or write operations', checks, errors }, null, 2) + '\n');
  console.log('NATIVE_PUBLIC_APP_MEDIA_PASS', JSON.stringify(checks));
} catch (error) { if (desktop) { const page = await desktop.firstWindow(); await page.screenshot({ path: join(output, 'failure.png') }); } throw error; }
finally { await desktop?.close(); await server.close(); }
