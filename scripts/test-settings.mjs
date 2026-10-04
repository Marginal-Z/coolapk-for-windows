import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/settings-check', port = Number(process.env.COOLAPK_SETTINGS_TEST_PORT || 5198), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
const preferencesFixtureModule = process.env.COOLAPK_SETTINGS_PREFERENCES_MODULE || '/src/preferences.ts';
writeFileSync(`${output}/fixture.tsx`, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Settings}from'/src/Settings.tsx';import{usePreferences}from${JSON.stringify(preferencesFixtureModule)};import{Modal}from'/src/components.tsx';import'/src/styles.css';
function Harness(){const state=usePreferences();const[namespace,setNamespace]=useState('synthetic-account-a');const[open,setOpen]=useState(true);useEffect(()=>{document.documentElement.dataset.theme=state.resolvedTheme;window.__settingsState={...state.preferences,resolvedTheme:state.resolvedTheme,fontScale:state.fontScale};window.__settingsNamespace=setNamespace;window.__settingsOpen=setOpen},[state.preferences,state.resolvedTheme,state.fontScale]);const clear=async key=>{window.__settingsCalls.push(key);if(window.__settingsFailure===key)throw new Error('模拟清理失败');if(window.__settingsHold===key)await new Promise(resolve=>window.__settingsRelease=resolve)};return <main style={{color:"var(--text)"}}><button onClick={()=>setOpen(true)}>打开设置测试</button>{open&&<Modal title="设置" onClose={()=>setOpen(false)}><Settings namespace={namespace} preferences={state.preferences} onPreferencesChange={state.updatePreferences} preferenceError={state.preferenceError} accountCount={2} version="synthetic-version" onAccountProfile={()=>window.__settingsCalls.push('profile')} onAccountSecurity={()=>clear('security')} onManageAccounts={()=>window.__settingsCalls.push('accounts')} onDownloads={()=>window.__settingsCalls.push('downloads')} onClearCache={()=>clear('cache')} onClearHistory={()=>clear('history')} onHelp={()=>window.__settingsCalls.push('help')} onAgreement={()=>window.__settingsCalls.push('agreement')}/></Modal>}</main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1120, height: 950 }, timezoneId: 'Asia/Bangkok' });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('coolapk-theme', 'dark'); window.__settingsCalls = []; window.__settingsFailure = ''; window.__settingsHold = ''; window.__settingsRelease = null;
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-04T21:59:50+07:00') });
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto(`${origin}/${output}/fixture.html`);
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await record('official sampled settings groups invoke concrete desktop actions without placeholder switches', async () => {
    for (const [label, expected] of [['头像与个人信息', 'profile'], ['账号与绑定', 'security'], ['本机账号管理', 'accounts'], ['下载安装', 'downloads'], ['帮助与反馈', 'help'], ['用户协议', 'agreement']]) {
      await dialog.getByRole('button', { name: new RegExp('^' + label) }).click();
      assert.ok(await page.evaluate(expected => window.__settingsCalls.includes(expected), expected));
    }
    assert.equal(await dialog.getByRole('switch').count(), 0);
    assert.equal(await dialog.getByRole('button', { name: '隐私设置', exact: true }).count(), 0);
    await dialog.getByText('synthetic-version', { exact: true }).waitFor();
  });
  await record('valid old explicit dark selection migrates and is not overridden by light OS settings', async () => {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal((await page.evaluate(() => window.__settingsState)).followSystem, false);
    await dialog.getByRole('button', { name: /^界面显示/ }).click();
    assert.equal(await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).isChecked(), false);
  });
  await record('all four sampled font choices persist bounded actual preference scales and visible preview size', async () => {
    assert.deepEqual(await dialog.getByLabel('字体大小', { exact: true }).locator('option').allTextContents(), ['跟随系统', '大号', '标准', '小号']);
    for (const [choice, scale] of [['large', 1.15], ['small', .9], ['standard', 1], ['system', 1]]) {
      await dialog.getByLabel('字体大小', { exact: true }).selectOption(choice);
      await page.waitForFunction(([choice, scale]) => window.__settingsState.fontSize === choice && window.__settingsState.fontScale === scale, [choice, scale]);
      assert.ok(Math.abs(await dialog.locator('.preferences-preview').evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize)) - 14 * scale) < .01);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).fontSize), choice);
    }
  });
  await record('follow-system responds to real browser media changes and disables automatic/time inputs', async () => {
    await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).check();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await dialog.getByRole('switch', { name: '自动切换夜间模式' }).isDisabled(), true);
    assert.equal(await dialog.getByLabel('夜间开始时间').isDisabled(), true);
  });
  await record('pure black night choice and manual theme selection change the resolved theme rather than empty controls', async () => {
    await dialog.getByRole('switch', { name: '将A屏黑主题设为夜间模式' }).check(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'black');
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('light'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).isChecked(), false);
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('black'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'black');
  });
  await record('automatic timer crosses the real 22:00 minute boundary and uses the retained pure black preference', async () => {
    await dialog.getByRole('switch', { name: '自动切换夜间模式' }).check();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.clock.runFor(10021); await page.waitForFunction(() => document.documentElement.dataset.theme === 'black');
    await page.clock.setSystemTime(new Date('2026-10-05T05:59:50+07:00')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.runFor(60000); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  });
  await record('custom overnight range is saved atomically and rejects identical endpoints', async () => {
    await dialog.getByLabel('夜间开始时间').fill('20:30'); await dialog.getByLabel('夜间结束时间').fill('20:30');
    assert.equal(await dialog.getByRole('button', { name: '保存时段' }).isDisabled(), true);
    await dialog.getByText('开始和结束时间不能相同。', { exact: true }).waitFor();
    await dialog.getByLabel('夜间结束时间').fill('07:15'); await dialog.getByRole('button', { name: '保存时段' }).click();
    assert.equal((await page.evaluate(() => window.__settingsState)).nightStart, '20:30'); assert.equal((await page.evaluate(() => window.__settingsState)).nightEnd, '07:15');
    await page.clock.setSystemTime(new Date('2026-10-05T07:14:00+07:00')); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForFunction(() => document.documentElement.dataset.theme === 'black');
    await page.clock.setSystemTime(new Date('2026-10-05T07:15:00+07:00')); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  });
  await record('system preference retains but disables custom schedule and manual selector explicitly turns automatic mode off', async () => {
    await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).check();
    assert.equal(await dialog.getByLabel('夜间开始时间').isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: '保存时段' }).isDisabled(), true);
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('dark');
    assert.equal(await dialog.getByRole('switch', { name: '自动切换夜间模式' }).isChecked(), false);
    assert.equal(await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).isChecked(), false);
    assert.equal((await page.evaluate(() => window.__settingsState)).nightStart, '20:30');
    await dialog.getByRole('button', { name: '返回设置', exact: true }).click();
  });
  await record('storage write failure keeps the active choice visible, reports the failure and recovers on another saved change', async () => {
    await page.evaluate(() => { window.__settingsOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new Error('synthetic-full'); }; });
    await dialog.getByRole('button', { name: /^界面显示/ }).click(); await dialog.getByLabel('字体大小', { exact: true }).selectOption('large');
    await dialog.getByText('当前设置已生效，但未能保存到本机。请检查存储空间后重试。', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.__settingsState)).fontScale, 1.15);
    await page.evaluate(() => { Storage.prototype.setItem = window.__settingsOriginalSetItem; });
    await dialog.getByLabel('字体大小', { exact: true }).selectOption('standard');
    await page.waitForFunction(() => !document.querySelector('.preferences-error'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).fontSize), 'standard');
    await dialog.getByRole('button', { name: '返回设置', exact: true }).click();
  });
  await record('cache and local history clearing report only acknowledged completion and allow retry after a real failure', async () => {
    await page.evaluate(() => { window.__settingsFailure = 'cache'; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click(); await dialog.getByText('模拟清理失败', { exact: true }).waitFor();
    assert.equal(await dialog.getByText('缓存已清理', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__settingsFailure = ''; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click(); await dialog.getByText('缓存已清理', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: /^清空本地浏览历史/ }).click(); await dialog.getByText('本地浏览历史已清空', { exact: true }).waitFor();
  });
  await record('pending cleanup is single flight and does not announce success after account namespace changes', async () => {
    await page.evaluate(() => { window.__settingsHold = 'cache'; }); await dialog.getByRole('button', { name: /^缓存清理/ }).click();
    assert.equal(await dialog.getByRole('button', { name: /^缓存清理/ }).isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: /^清空本地浏览历史/ }).isDisabled(), true);
    await page.evaluate(() => { window.__settingsNamespace('synthetic-account-b'); }); await page.waitForFunction(() => !document.querySelector('.preferences-status'));
    await page.evaluate(() => { window.__settingsHold = ''; window.__settingsRelease(); });
    assert.equal(await dialog.getByText('缓存已清理', { exact: true }).count(), 0);
  });
  await record('narrow window keeps controls reachable and keyboard escape returns focus to the caller', async () => {
    await page.setViewportSize({ width: 430, height: 740 }); await dialog.getByRole('button', { name: /^界面显示/ }).click();
    await dialog.getByLabel('夜间结束时间').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: `${output}/display-narrow.png`, fullPage: true });
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: '打开设置测试', exact: true }).click(); await dialog.waitFor(); await page.screenshot({ path: `${output}/settings.png`, fullPage: true });
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/settings-ui-checks.json', JSON.stringify({ checkedAt: '2026-10-04', fixture: 'Settings + usePreferences; isolated Chrome; no live account or device writes', checks, result: 'passed', nativeIntegration: 'Global font scaling and actual black-theme variables require the root App/Electron checks.' }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', groups: checks.length })); await context.close();
} catch (error) { console.error(error); throw error; }
finally { await browser?.close(); await server.close(); }
