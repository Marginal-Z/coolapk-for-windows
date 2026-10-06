// Production phone UI with synthetic devices; this check never connects to a real phone.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/phone-ui-check', port = Number(process.env.COOLAPK_PHONE_UI_TEST_PORT || 5259), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:var(--bg)"><div id="root" style="color:var(--text)"></div><script type="module" src="./fixture.tsx"></script></body></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import Phone from'/src/Phone.tsx';import'/src/styles.css';import'/src/composer.css';import'/src/desktop-layout.css';
window.__phoneUI={devices:[],calls:[],toasts:[]};window.coolapk={phone:async(op,args={})=>{const mock=window.__phoneUI;mock.calls.push({op,args});if(op==='status')return{ok:true,data:{devices:structuredClone(mock.devices)}};if(op==='start'||op==='stop'){const device=mock.devices.find(item=>item.serial===args.serial);device.running=op==='start';device.screenOff=!!args.screenOff;return{ok:true,data:null}}return{ok:false,error:{message:'Unsupported synthetic operation'}}}};
function Harness(){const[target,setTarget]=useState(undefined);useEffect(()=>{window.__phoneTarget=setTarget},[]);return <main style={{padding:24,maxWidth:1000,margin:'auto'}}><Phone target={target} toast={message=>window.__phoneUI.toasts.push(message)}/></main>}createRoot(document.getElementById('root')).render(<Harness/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1200, height: 920 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/${output}/fixture.html`);
  const updates = page.getByRole('region', { name: '手机应用更新', exact: true });
  await record('phone overview owns the update entry even when no phone is connected', async () => {
    await updates.waitFor(); await page.getByText('等待手机连接', { exact: true }).waitFor();
    const steps = updates.getByRole('button', { name: '查看更新步骤', exact: true });
    assert.equal(await steps.getAttribute('aria-expanded'), 'false');
    await steps.focus(); await page.keyboard.press('Enter');
    const close = updates.getByRole('button', { name: '收起更新步骤', exact: true });
    assert.equal(await close.getAttribute('aria-expanded'), 'true');
    await updates.getByText('在手机酷安首页点击右上角 APP 图标，进入应用市场。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__phoneUI.calls.some(call => call.op !== 'status')), false);
    await close.click();
  });
  await record('the existing phone updates route expands the same instructions without duplicating the card', async () => {
    await page.evaluate(() => window.__phoneTarget('updates'));
    await updates.getByRole('button', { name: '收起更新步骤', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '手机应用更新', exact: true }).count(), 1);
    assert.ok((await updates.innerText()).includes('设置 → 关于酷安 → 检查软件更新'));
    await page.evaluate(() => window.__phoneTarget('backups'));
    await page.getByRole('heading', { name: '手机应用备份与恢复', exact: true }).waitFor();
    await updates.getByRole('button', { name: '查看更新步骤', exact: true }).waitFor();
  });
  await record('updates retain explicit authorized-device selection and opt-in screen-off collaboration', async () => {
    await page.evaluate(() => { window.__phoneUI.devices = [{ serial: 'TEST-USB-1', model: 'Synthetic phone', state: 'device' }, { serial: 'TEST-USB-2', model: 'Unauthorized phone', state: 'unauthorized' }]; });
    await page.getByRole('button', { name: '检测连接', exact: true }).click();
    const device = page.locator('.phone-device').filter({ hasText: 'Synthetic phone' }), unauthorized = page.locator('.phone-device').filter({ hasText: 'Unauthorized phone' });
    await device.waitFor(); assert.equal(await unauthorized.getByRole('button', { name: '打开酷安手机窗口', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__phoneUI.calls.some(call => call.op === 'start')), false);
    await page.getByRole('checkbox', { name: '手机熄屏，桌面继续操作', exact: true }).check();
    await device.getByRole('button', { name: '打开酷安手机窗口', exact: true }).click();
    await device.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__phoneUI.calls.filter(call => call.op === 'start')), [{ op: 'start', args: { serial: 'TEST-USB-1', screenOff: true } }]);
    assert.equal(await page.getByRole('checkbox', { name: '手机熄屏，桌面继续操作', exact: true }).isDisabled(), true);
  });
  await record('compact dark phone updates keep instructions and keyboard actions within the viewport', async () => {
    await page.setViewportSize({ width: 480, height: 720 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.__phoneTarget('updates'); });
    const close = updates.getByRole('button', { name: '收起更新步骤', exact: true }); await close.waitFor(); await close.scrollIntoViewIfNeeded(); await close.focus();
    assert.equal(await close.evaluate(node => node === document.activeElement), true);
    assert.equal(await updates.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await updates.getByRole('heading', { name: '手机应用更新', exact: true }).evaluate(node => getComputedStyle(node).color), 'rgb(227, 235, 230)');
    await page.screenshot({ path: `${output}/phone-updates-narrow.png` });
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), checks, errors, syntheticBridge: true, externalNetworkBlocked: true, realPhoneOperations: 0 }, null, 2) + '\n');
  console.log('PHONE_UI_PASS', checks.length);
} finally { await browser?.close(); await server.close(); }
