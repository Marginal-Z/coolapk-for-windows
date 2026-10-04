import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/teenager-check', port = Number(process.env.COOLAPK_TEENAGER_TEST_PORT || 5209), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{act,useState}from'react';import{createRoot}from'react-dom/client';import{TeenagerSetup,TeenagerScreen}from'/src/Teenager.tsx';import'/src/styles.css';const initial={enabled:false,blocked:false,reason:null,usedMilliseconds:0,remainingMilliseconds:2400000,limitMilliseconds:2400000,day:'2026-10-04',lockedUntil:null};window.__teenCalls=[];window.__teenFail={};window.__teenHold={};window.__teenResolve={};window.__teenSnapshot=initial;let validPin='2468';window.coolapk={teenager:async(operation,args={})=>{window.__teenCalls.push({operation,args});if(window.__teenHold[operation])await new Promise(resolve=>{window.__teenResolve[operation]=resolve});if(window.__teenFail[operation]){delete window.__teenFail[operation];return{ok:false,error:{code:'SYNTHETIC_FAILURE',message:'模拟请求失败'}}}if(operation==='enable')return{ok:true,data:{...initial,enabled:true}};if(operation==='disable'||operation==='changePin'){if(args[operation==='disable'?'pin':'oldPin']!==validPin)return{ok:false,error:{code:'TEENAGER_PIN_INVALID',message:'密码错误，请重新输入。'}};if(operation==='changePin'){validPin=args.newPin;return{ok:true,data:window.__teenSnapshot}}return{ok:true,data:{...initial,enabled:false}}}if(operation==='content')return{ok:true,data:{page:args.page,hasMore:args.page===1,data:args.page===1?[{id:'101',entityType:'feed',title:'今日精选',message:'<a href="https://example.invalid">精选第一条</a><img src="https://example.invalid/private.png" onerror="window.__unsafe=true">',picArr:['https://example.invalid/private.png']},{entityType:'card',entities:[{id:'102',entityType:'feed',message:'精选第二条'}]}]:[{id:'101',entityType:'feed',message:'重复'},{id:'103',entityType:'feed',message:'精选第三条'}]}};if(operation==='detail')return{ok:true,data:{data:{id:args.id,entityType:'feed',title:'详情 '+args.id,message:'<a href="https://example.invalid">纯文本详情 '+args.id+'</a>'}}};return{ok:true,data:window.__teenSnapshot}},call:()=>{throw new Error('Ordinary API must not be used')}};function Harness(){const[snapshot,setSnapshot]=useState(initial);window.__teenSetSnapshot=setSnapshot;window.__teenRelease=async(operation)=>{const previous=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;try{await act(async()=>{delete window.__teenHold[operation];window.__teenResolve[operation]()})}finally{globalThis.IS_REACT_ACT_ENVIRONMENT=previous}};window.__teenSnapshot=snapshot;return snapshot.enabled?<TeenagerScreen snapshot={snapshot} onSnapshot={setSnapshot}/>:<TeenagerSetup onEnabled={setSnapshot} onCancel={()=>window.__teenCancelled=true}/>;}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 870 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(`${origin}/${output}/fixture.html`);
  const calls = operation => page.evaluate(operation => window.__teenCalls.filter(call => call.operation === operation), operation);
  await record('intro states native logout, social restrictions, daily quota and night hours', async () => {
    await page.getByRole('heading', { name: '青少年模式', exact: true }).waitFor(); const text = await page.locator('.teenager-setup').textContent();
    for (const expected of ['退出当前账号', '无法登录、发布、回复和搜索', '40 分钟', '22:00', '06:00', '四位数字密码']) assert.ok(text.includes(expected));
    assert.equal(await page.getByRole('textbox').count(), 0); await page.screenshot({ path: `${output}/intro.png` });
  });
  await page.getByRole('button', { name: '开启青少年模式', exact: true }).click();
  await record('masked numeric PIN requires four digits and matching confirmation before IPC', async () => {
    const pin = page.getByLabel('设置四位密码', { exact: true }), confirmation = page.getByLabel('再次输入密码', { exact: true });
    assert.equal(await pin.getAttribute('type'), 'password'); assert.equal(await pin.getAttribute('inputmode'), 'numeric');
    await pin.fill('2a4'); assert.equal(await pin.inputValue(), '24'); await confirmation.fill('2468'); assert.equal(await page.getByRole('button', { name: '确认开启', exact: true }).isDisabled(), true);
    await pin.fill('2468'); await confirmation.fill('8642'); await page.getByRole('button', { name: '确认开启', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor(); assert.equal((await calls('enable')).length, 0);
    await confirmation.fill('2468');
  });
  await record('failed enable stays in setup and double clicks issue one pending mutation', async () => {
    await page.evaluate(() => { window.__teenFail.enable = true; }); await page.getByRole('button', { name: '确认开启', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '模拟请求失败' }).waitFor(); assert.equal(await page.locator('.teenager-shell').count(), 0);
    await page.evaluate(() => { window.__teenHold.enable = true; }); const submit = page.getByRole('button', { name: '确认开启', exact: true }); await submit.click();
    await page.getByRole('button', { name: '正在开启…', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '正在开启…', exact: true }).isDisabled(), true); assert.equal((await calls('enable')).length, 2);
    await page.evaluate(() => { delete window.__teenHold.enable; window.__teenResolve.enable(); }); await page.getByLabel('青少年精选内容', { exact: true }).waitFor(); await page.getByText('精选第一条', { exact: true }).waitFor();
  });
  await record('curated content uses only teen IPC, strips rich links and contains no social entry points', async () => {
    assert.equal(await page.locator('.teenager-card').count(), 2); assert.equal(await page.locator('a,img').count(), 0); assert.equal(await page.evaluate(() => window.__unsafe || false), false);
    for (const label of ['登录', '发布', '回复', '搜索', '私信']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
    assert.ok((await calls('content')).every(call => Object.keys(call.args).join(',') === 'page')); await page.screenshot({ path: `${output}/content.png` });
  });
  await record('pagination keeps existing curated content on failure and deduplicates retry', async () => {
    await page.evaluate(() => { window.__teenFail.content = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '模拟请求失败' }).waitFor(); assert.equal(await page.locator('.teenager-card').count(), 2);
    await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('精选第三条', { exact: true }).waitFor(); assert.equal(await page.locator('.teenager-card').count(), 3); assert.equal(await page.getByRole('button', { name: '加载更多', exact: true }).count(), 0);
    assert.deepEqual((await calls('content')).slice(-2).map(call => call.args.page), [2, 2]);
  });
  await record('refresh retry repeats the failed first page rather than advancing pagination', async () => {
    await page.evaluate(() => { window.__teenFail.content = true; }); await page.getByRole('button', { name: '刷新精选内容', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '模拟请求失败' }).waitFor();
    await page.getByRole('button', { name: '重试', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.teenager-card').length === 2); assert.deepEqual((await calls('content')).slice(-2).map(call => call.args.page), [1, 1]);
  });
  await record('details remain read-only and late closed-detail responses are discarded', async () => {
    await page.locator('.teenager-card').first().getByRole('button').click(); await page.getByRole('dialog', { name: '精选内容', exact: true }).getByText('纯文本详情 101', { exact: true }).waitFor(); assert.equal(await page.locator('a').count(), 0); assert.equal(await page.getByRole('button', { name: '回复', exact: true }).count(), 0);
    await page.getByRole('button', { name: '返回精选', exact: true }).click(); await page.evaluate(() => { window.__teenHold.detail = true; }); await page.locator('.teenager-card').last().getByRole('button').click(); await page.getByText('正在读取内容…', { exact: true }).waitFor(); await page.getByRole('button', { name: '返回精选', exact: true }).click(); await page.getByRole('dialog', { name: '精选内容', exact: true }).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__teenRelease('detail')); assert.equal(await page.getByRole('dialog', { name: '精选内容', exact: true }).count(), 0);
  });
  await record('night and daily blocks clear details, suppress content requests and ignore pending responses', async () => {
    await page.evaluate(() => { window.__teenHold.content = true; }); await page.getByRole('button', { name: '刷新精选内容', exact: true }).click();
    await page.waitForFunction(() => typeof window.__teenResolve.content === 'function');
    await page.evaluate(() => { window.__teenSetSnapshot({ ...window.__teenSnapshot, blocked: true, reason: 'night' }); }); await page.getByRole('heading', { name: '夜间休息时间', exact: true }).waitFor();
    await page.evaluate(() => window.__teenRelease('content')); assert.equal(await page.locator('.teenager-card').count(), 0); assert.equal(await page.getByRole('button', { name: '刷新精选内容', exact: true }).count(), 0);
    await page.evaluate(() => window.__teenSetSnapshot({ ...window.__teenSnapshot, blocked: true, reason: 'daily_limit', remainingMilliseconds: 0 })); await page.getByRole('heading', { name: '今日使用时间已结束', exact: true }).waitFor(); assert.equal(await page.getByLabel('今日剩余时长', { exact: true }).textContent(), '0:00');
  });
  await record('blocked mode still requires a verified PIN to exit and preserves state on failure', async () => {
    await page.getByRole('button', { name: '验证密码并关闭模式', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '关闭青少年模式', exact: true }); await dialog.getByLabel('当前四位密码', { exact: true }).fill('1111'); await dialog.getByRole('button', { name: '确认关闭', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: '密码错误' }).waitFor(); assert.equal(await page.locator('.teenager-shell').count(), 1); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  });
  await page.evaluate(() => window.__teenSetSnapshot({ ...window.__teenSnapshot, blocked: false, reason: null, usedMilliseconds: 100_000, remainingMilliseconds: 2300_000, day: '2026-10-05' })); await page.getByText('精选第一条', { exact: true }).waitFor();
  await record('change PIN validates matching new values and uses the separate verified operation', async () => {
    await page.getByRole('button', { name: '修改青少年密码', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '修改青少年密码', exact: true }); await dialog.getByLabel('当前四位密码', { exact: true }).fill('2468'); await dialog.getByLabel('新的四位密码', { exact: true }).fill('9876'); await dialog.getByLabel('确认新的密码', { exact: true }).fill('9870'); await dialog.getByRole('button', { name: '保存密码', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor(); assert.equal((await calls('changePin')).length, 0);
    await dialog.getByLabel('确认新的密码', { exact: true }).fill('9876'); await dialog.getByRole('button', { name: '保存密码', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.deepEqual((await calls('changePin'))[0].args, { oldPin: '2468', newPin: '9876', confirmation: '9876' });
  });
  await page.setViewportSize({ width: 430, height: 860 });
  await record('narrow curated page and password dialog remain keyboard reachable without overflow', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.getByRole('button', { name: '关闭模式', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '关闭青少年模式', exact: true }); await dialog.getByLabel('当前四位密码', { exact: true }).fill('9876'); await dialog.getByRole('button', { name: '确认关闭', exact: true }).focus(); assert.equal(await dialog.getByRole('button', { name: '确认关闭', exact: true }).evaluate(node => document.activeElement === node), true); await page.keyboard.press('Enter'); await page.getByRole('heading', { name: '青少年模式', exact: true }).waitFor();
  });
  await record('corrupt state shows a closed gate rather than exposing content or an unverified exit', async () => {
    await page.evaluate(() => window.__teenSetSnapshot({ ...window.__teenSnapshot, enabled: true, blocked: true, reason: 'state_error' })); await page.getByRole('heading', { name: '青少年模式记录无法读取', exact: true }).waitFor(); assert.equal(await page.locator('.teenager-card').count(), 0); assert.equal(await page.getByRole('button', { name: '关闭模式', exact: true }).isDisabled(), true); assert.equal(await page.getByRole('button', { name: '修改青少年密码', exact: true }).isDisabled(), true);
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/teenager-ui-checks.json', JSON.stringify({ checkedAt: '2026-10-04', checks, errors, mode: 'isolated renderer; synthetic mode and curated IPC; no real account, phone or cloud writes; main IPC guards verified separately', result: 'passed' }, null, 2) + '\n'); console.log(JSON.stringify({ result: 'passed', groups: checks.length }));
} finally { if (browser) await browser.close(); await server.close(); }
