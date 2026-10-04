import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = '.local/desktop-settings-check', port = Number(process.env.COOLAPK_DESKTOP_SETTINGS_TEST_PORT || 5227), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/background.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII=', 'base64'));
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Settings}from'/src/Settings.tsx';import{usePreferences}from'/src/preferences.ts';import{Modal}from'/src/components.tsx';import'/src/styles.css';import'/src/desktop-layout.css';
const empty={available:false,revision:'',url:'',width:0,height:0,name:'',bytes:0};const image={available:true,revision:'a'.repeat(64),url:${JSON.stringify(origin + '/' + output + '/background.png')},width:1,height:1,name:'示例背景.png',bytes:68};window.__desktopSettings={calls:[],backgroundCalls:[],changes:[],state:empty,holdState:false,holdChoose:false,cancel:false,fail:false};window.coolapk={background:async operation=>{const mock=window.__desktopSettings;mock.backgroundCalls.push(operation);const captured={...mock.state};if(operation==='state'&&mock.holdState)await new Promise(resolve=>mock.releaseState=resolve);if(operation==='choose'&&mock.holdChoose)await new Promise(resolve=>mock.releaseChoose=resolve);if(mock.fail)return{ok:false,error:{code:'INPUT',message:'模拟背景图片无法打开'}};if(operation==='state')return{ok:true,data:captured};if(operation==='choose'&&mock.cancel)return{ok:true,data:{...mock.state,cancelled:true}};mock.state=operation==='choose'?image:empty;return{ok:true,data:mock.state}}};
function Harness(){const state=usePreferences();const[namespace,setNamespace]=useState('synthetic-a'),[open,setOpen]=useState(true);useEffect(()=>{window.__desktopSettings.preferences=state.preferences;window.__desktopSettings.owner=namespace;window.__desktopSettingsOwner=setNamespace;window.__desktopSettingsUpdate=state.updatePreferences},[namespace,state.preferences]);return <><button onClick={()=>setOpen(true)}>打开设置测试</button>{open&&<Modal title="设置" className="settings-modal" onClose={()=>setOpen(false)}><Settings namespace={namespace} accountCount={2} version="synthetic" preferences={state.preferences} onPreferencesChange={state.updatePreferences} onBackgroundChange={value=>window.__desktopSettings.changes.push(value)} onAccountProfile={()=>window.__desktopSettings.calls.push('profile')} onAccountSecurity={()=>window.__desktopSettings.calls.push('security')} onManageAccounts={()=>window.__desktopSettings.calls.push('accounts')} onDownloads={()=>window.__desktopSettings.calls.push('downloads')} onClearCache={()=>window.__desktopSettings.calls.push('cache')} onClearHistory={()=>window.__desktopSettings.calls.push('history')} onUpdates={()=>window.__desktopSettings.calls.push('updates')} onHelp={()=>window.__desktopSettings.calls.push('help')} onAgreement={()=>window.__desktopSettings.calls.push('agreement')}/></Modal>}</>}createRoot(document.getElementById('root')).render(<Harness/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/${output}/fixture.html`);
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const display = () => dialog.getByRole('tab', { name: '界面显示', exact: true }).click();
  await record('desktop settings use a wide sidebar and two-column overview while preserving every concrete action', async () => {
    assert.ok((await dialog.boundingBox()).width >= 1000);
    const grid = await dialog.locator('.preferences-account-group').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length); assert.equal(grid, 2);
    for (const [label, value] of [['头像与个人信息', 'profile'], ['账号与绑定', 'security'], ['本机账号管理', 'accounts'], ['下载安装', 'downloads'], ['缓存清理', 'cache'], ['清空本地浏览历史', 'history'], ['软件更新', 'updates'], ['帮助与反馈', 'help'], ['用户协议', 'agreement']]) { await dialog.getByRole('button', { name: new RegExp('^' + label) }).click(); await page.waitForFunction(value => window.__desktopSettings.calls.includes(value), value); }
    await page.screenshot({ path: `${output}/overview-wide.png` });
  });
  await record('sidebar supports keyboard section navigation and only content owns vertical scrolling', async () => {
    const tab = dialog.getByRole('tab', { name: '总览', exact: true }); await tab.focus(); await tab.press('ArrowDown'); await dialog.getByLabel('字体大小', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('tab', { name: '界面显示', exact: true }).getAttribute('aria-selected'), 'true');
    const before = await dialog.locator('.preferences-navigation').boundingBox(), header = await dialog.locator('.modal-header').boundingBox();
    await dialog.locator('.preferences-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.equal((await dialog.locator('.preferences-navigation').boundingBox()).y, before.y); assert.equal((await dialog.locator('.modal-header').boundingBox()).y, header.y);
    assert.equal(await dialog.evaluate(node => node.scrollTop), 0);
  });
  await record('background chooser displays a local preview and enables the selected image', async () => {
    await dialog.getByRole('button', { name: '选择背景图片', exact: true }).click(); await page.waitForFunction(() => window.__desktopSettings.preferences.backgroundEnabled === true);
    await dialog.getByAltText('已选择的背景预览', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('.preferences-background-preview img')?.naturalWidth === 1);
    assert.equal(await dialog.getByRole('switch', { name: '启用自定义背景', exact: true }).isChecked(), true); assert.equal(await page.evaluate(() => window.__desktopSettings.changes.length), 1);
  });
  await record('independent opacity sliders work by keyboard and persist metadata without encoded images or file paths', async () => {
    const image = dialog.getByRole('slider', { name: '背景图片不透明度', exact: true }), surface = dialog.getByRole('slider', { name: '内容区域不透明度', exact: true });
    await image.focus(); await image.press('ArrowRight'); await page.waitForFunction(() => window.__desktopSettings.preferences.backgroundOpacity === .61);
    await surface.focus(); await surface.press('ArrowLeft'); await page.waitForFunction(() => window.__desktopSettings.preferences.surfaceOpacity === .77);
    assert.equal(await image.inputValue(), '61'); assert.equal(await surface.inputValue(), '77'); assert.equal(await dialog.getByAltText('已选择的背景预览').evaluate(node => getComputedStyle(node).opacity), '0.61');
    const saved = await page.evaluate(() => localStorage.getItem('coolapk-preferences')); assert.ok(saved.length < 1500); assert.equal(saved.includes('base64'), false); assert.equal(saved.includes('示例背景.png'), false); assert.equal(saved.includes('background.png'), false);
    await page.screenshot({ path: `${output}/background-wide.png` });
  });
  await record('cancel does not re-enable an existing disabled background or reset its transparency', async () => {
    await dialog.getByRole('switch', { name: '启用自定义背景' }).uncheck(); await page.evaluate(() => { window.__desktopSettings.cancel = true; });
    await dialog.getByRole('button', { name: '更换背景图片', exact: true }).click(); await page.waitForFunction(() => window.__desktopSettings.changes.at(-1)?.cancelled === true);
    const preferences = await page.evaluate(() => window.__desktopSettings.preferences); assert.equal(preferences.backgroundEnabled, false); assert.equal(preferences.backgroundOpacity, .61); assert.equal(preferences.surfaceOpacity, .77); await page.evaluate(() => { window.__desktopSettings.cancel = false; });
  });
  await record('late initial state cannot overwrite a more recent completed background choice', async () => {
    await dialog.getByRole('tab', { name: '总览', exact: true }).click(); await page.evaluate(() => { window.__desktopSettings.state = { available: false, revision: '', url: '', width: 0, height: 0, name: '', bytes: 0 }; window.__desktopSettings.holdState = true; });
    await display(); await page.waitForFunction(() => typeof window.__desktopSettings.releaseState === 'function');
    await dialog.getByRole('button', { name: '更换背景图片', exact: true }).click(); await page.waitForFunction(() => window.__desktopSettings.preferences.backgroundEnabled === true);
    await page.evaluate(() => { window.__desktopSettings.holdState = false; window.__desktopSettings.releaseState(); });
    await page.waitForFunction(() => !document.querySelector('.preferences-status')); assert.equal(await dialog.getByAltText('已选择的背景预览').count(), 1); assert.equal(await dialog.getByRole('switch', { name: '启用自定义背景' }).isChecked(), true);
  });
  await record('account switch invalidates a pending background callback without committing old UI preferences', async () => {
    await dialog.getByRole('switch', { name: '启用自定义背景' }).uncheck(); const before = await page.evaluate(() => window.__desktopSettings.changes.length);
    await page.evaluate(() => { window.__desktopSettings.holdChoose = true; }); await dialog.getByRole('button', { name: '更换背景图片', exact: true }).click(); await page.waitForFunction(() => typeof window.__desktopSettings.releaseChoose === 'function');
    await page.evaluate(() => window.__desktopSettingsOwner('synthetic-b')); await page.waitForFunction(() => window.__desktopSettings.owner === 'synthetic-b');
    await page.evaluate(() => { window.__desktopSettings.holdChoose = false; window.__desktopSettings.releaseChoose(); });
    await dialog.getByRole('button', { name: '更换背景图片', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.__desktopSettings.changes.length), before); assert.equal(await page.evaluate(() => window.__desktopSettings.preferences.backgroundEnabled), false);
  });
  await record('failed selection preserves settings and deletion restores default opacity and removes the preview', async () => {
    await page.evaluate(() => { window.__desktopSettings.fail = true; }); await dialog.getByRole('button', { name: '更换背景图片', exact: true }).click(); await dialog.getByRole('alert').getByText('模拟背景图片无法打开', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__desktopSettings.preferences.backgroundEnabled), false); await page.evaluate(() => { window.__desktopSettings.fail = false; });
    await dialog.getByRole('button', { name: '删除背景并恢复默认', exact: true }).click(); await page.waitForFunction(() => window.__desktopSettings.preferences.backgroundOpacity === .6 && window.__desktopSettings.preferences.surfaceOpacity === .78);
    assert.equal(await dialog.getByAltText('已选择的背景预览').count(), 0); assert.equal(await dialog.getByRole('switch', { name: '启用自定义背景' }).isDisabled(), true);
  });
  await record('small windows use horizontal categories with no clipped controls and Escape closes the dialog', async () => {
    await page.setViewportSize({ width: 560, height: 740 }); const size = await dialog.boundingBox(); assert.ok(size.width <= 560); assert.ok(size.height <= 740);
    assert.equal(await dialog.locator('.preferences-body').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
    assert.equal(await dialog.locator('.preferences-content').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await dialog.getByRole('tab', { name: '实验室', exact: true }).click(); await dialog.getByRole('switch', { name: '显示 FPS' }).waitFor(); await page.waitForFunction(() => document.querySelector('#settings-tab-laboratory')?.getAttribute('aria-selected') === 'true'); await page.screenshot({ path: `${output}/settings-small.png` });
    await dialog.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  });
  assert.deepEqual(errors, []); console.log('DESKTOP_SETTINGS_UI_PASS', checks.length);
  writeFileSync('research/desktop-settings-checks.json', JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), checks, scenarios: { realAccountWrites: 0, networkOutsideFixture: false, syntheticBridge: true }, screenshots: [`${output}/overview-wide.png`, `${output}/background-wide.png`, `${output}/settings-small.png`] }, null, 2) + '\n');
  await context.close();
} finally { await browser?.close(); await server.close(); }
