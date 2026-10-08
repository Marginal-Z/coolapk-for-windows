// Production settings/About components; isolated bridge and blocked external traffic.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/about-check', port = Number(process.env.COOLAPK_ABOUT_TEST_PORT || 5234), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root" style="color:var(--text)"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Settings}from'/src/Settings.tsx';import{Modal}from'/src/components.tsx';import{usePreferences}from'/src/preferences.ts';import{preferenceThemeVariables}from'/core/preferences.mjs';import'/src/styles.css';import'/src/desktop-layout.css';
window.__about={urls:[],actions:[],hold:false,fail:false};window.coolapk={openExternal:async url=>{const mock=window.__about;mock.urls.push(url);if(mock.hold)await new Promise(resolve=>mock.release=resolve);return mock.fail?{ok:false,error:{code:'FIXTURE',message:'Private fixture details must not be echoed'}}:{ok:true,data:null}},background:async()=>({ok:true,data:{available:false,revision:'',url:'',width:0,height:0,name:'',bytes:0}})};
function Harness(){const state=usePreferences();const[version,setVersion]=useState('0.6.4'),[open,setOpen]=useState(true);useEffect(()=>{window.__aboutVersion=setVersion;window.__aboutTheme=state.updatePreferences},[]);useEffect(()=>{document.documentElement.dataset.theme=state.resolvedTheme;for(const[key,value]of Object.entries(preferenceThemeVariables(state.preferences,state.resolvedTheme)))document.documentElement.style.setProperty(key,value)},[state.preferences,state.resolvedTheme]);return <><button onClick={()=>setOpen(true)}>打开设置测试</button>{open&&<Modal title="设置" className="settings-modal" onClose={()=>setOpen(false)}><Settings namespace="synthetic-about" accountCount={0} version={version} preferences={state.preferences} onPreferencesChange={state.updatePreferences} onUpdates={()=>window.__about.actions.push('updates')} onHelp={()=>window.__about.actions.push('help')} onAgreement={()=>window.__about.actions.push('agreement')}/></Modal>}</>}createRoot(document.getElementById('root')).render(<Harness/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 980 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/${output}/fixture.html`);
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }), about = dialog.getByRole('tabpanel', { name: '关于酷安', exact: true });
  await record('overview and a desktop About tab expose the same current version and factual unofficial disclosure', async () => {
    assert.ok((await dialog.boundingBox()).width >= 1000);
    await dialog.getByRole('button', { name: /^关于酷安/ }).click(); await about.waitFor();
    await about.getByText('版本 0.6.4', { exact: true }).waitFor();
    await about.getByRole('heading', { name: '第三方客户端声明', exact: true }).waitFor();
    const text = await about.innerText();
    assert.ok(text.includes('不是酷安官方产品') && text.includes('与酷安官方无隶属关系') && text.includes('未获得酷安官方的认可或背书'));
    assert.ok(text.includes('原作者或相应权利人所有') && text.includes('账号登录及安全验证仍由你亲自完成'));
    assert.equal(/概不负责|不承担任何责任/.test(text), false);
    await page.evaluate(() => window.__aboutVersion('0.6.5')); await about.getByText('版本 0.6.5', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/about-wide.png` });
  });
  await record('keyboard section navigation selects About with valid tab relationships and preserves existing display controls', async () => {
    await about.getByRole('button', { name: '返回设置', exact: true }).click();
    const overview = dialog.getByRole('tab', { name: '总览', exact: true }); await overview.focus(); await overview.press('End'); await about.waitFor();
    const tab = dialog.getByRole('tab', { name: '关于酷安', exact: true }); assert.equal(await tab.getAttribute('aria-selected'), 'true'); assert.equal(await tab.evaluate(node => node === document.activeElement), true);
    assert.equal(await dialog.locator('[role="tab"][aria-selected="true"]').count(), 1); assert.equal(await about.getAttribute('aria-labelledby'), await tab.getAttribute('id'));
    await tab.press('Home'); await dialog.getByRole('tabpanel', { name: '总览', exact: true }).waitFor();
    await overview.press('ArrowDown'); await dialog.getByLabel('字体大小', { exact: true }).waitFor();
    await dialog.locator('.preferences-content').evaluate(node => node.scrollTop = node.scrollHeight);
    await dialog.getByRole('tab', { name: '关于酷安', exact: true }).click(); await about.waitFor();
    assert.equal(await about.evaluate(node => node.scrollTop), 0);
  });
  await record('source and client feedback use only fixed project URLs through the existing trusted bridge', async () => {
    await about.getByRole('button', { name: '查看源码', exact: true }).click(); await page.waitForFunction(() => window.__about.urls.length === 1);
    await about.getByRole('button', { name: '反馈客户端问题', exact: true }).click(); await page.waitForFunction(() => window.__about.urls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__about.urls), ['https://github.com/Marginal-Z/coolapk-for-windows', 'https://github.com/Marginal-Z/coolapk-for-windows/issues']);
    assert.equal(await about.locator('a[target],iframe,script').count(), 0);
  });
  await record('update, official help and agreement actions reuse callbacks without performing account or network writes', async () => {
    for (const name of ['检查软件更新', '酷安帮助', '酷安用户协议']) await about.getByRole('button', { name, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__about.actions), ['updates', 'help', 'agreement']);
    assert.equal(await page.evaluate(() => window.__about.urls.length), 2);
  });
  await record('pending external launches suppress duplicate requests and failures provide a bounded usable retry', async () => {
    await page.evaluate(() => { window.__about.hold = true; window.__about.fail = true; });
    const source = about.getByRole('button', { name: '查看源码', exact: true }); await source.click();
    await about.getByRole('status').filter({ hasText: '正在打开浏览器' }).waitFor(); assert.equal(await source.isDisabled(), true);
    assert.equal(await about.getByRole('button', { name: '反馈客户端问题', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__about.urls.length), 3);
    await page.evaluate(() => window.__about.release()); await about.getByRole('alert').getByText('无法打开链接，请检查系统默认浏览器后重试。', { exact: true }).waitFor();
    assert.equal((await about.innerText()).includes('Private fixture'), false);
    await page.evaluate(() => { window.__about.hold = false; window.__about.fail = false; }); await source.click();
    await page.waitForFunction(() => window.__about.urls.length === 4); await page.waitForFunction(() => !document.querySelector('.about-error') && !document.querySelector('.about-status'));
  });
  await record('narrow dark settings retain readable disclosure and keyboard-accessible actions without horizontal overflow', async () => {
    await page.setViewportSize({ width: 480, height: 720 }); await page.evaluate(() => window.__aboutTheme({ theme: 'dark', followSystem: false })); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await about.getByRole('button', { name: '检查软件更新', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await about.evaluate(node => node.scrollWidth > node.clientWidth + 1), false); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const source = about.getByRole('button', { name: '查看源码', exact: true }); await page.keyboard.press('Tab'); await source.focus();
    assert.equal(await source.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    await page.keyboard.press('Tab'); assert.equal(await about.getByRole('button', { name: '反馈客户端问题', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: `${output}/about-dark-narrow.png` });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), checks, errors, syntheticBridge: true, externalNetworkBlocked: true, accountWrites: 0 }, null, 2) + '\n');
  console.log('ABOUT_UI_PASS', checks.length);
} finally { await browser?.close(); await server.close(); }
