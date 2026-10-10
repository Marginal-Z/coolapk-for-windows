import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { THEME_PALETTES, themeColorContrast } from '../core/preferences.mjs';
import { materialEffectReadability } from '../core/material-readability.mjs';

const output = '.local/settings-check', port = Number(process.env.COOLAPK_SETTINGS_TEST_PORT || 5198), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
const preferencesFixtureModule = process.env.COOLAPK_SETTINGS_PREFERENCES_MODULE || '/src/preferences.ts';
writeFileSync(`${output}/fixture.tsx`, `import React,{act,useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{Settings}from'/src/Settings.tsx';import{usePreferences}from${JSON.stringify(preferencesFixtureModule)};import{Modal}from'/src/components.tsx';import{preferenceThemeVariables}from'/core/preferences.mjs';import'/src/styles.css';
function Harness(){const state=usePreferences();const[namespace,setNamespace]=useState('synthetic-account-a');const[open,setOpen]=useState(true);useEffect(()=>{document.documentElement.dataset.theme=state.resolvedTheme;document.documentElement.dataset.palette=state.preferences.palette;for(const[name,value]of Object.entries(preferenceThemeVariables(state.preferences,state.resolvedTheme)))document.documentElement.style.setProperty(name,value);window.__settingsState={...state.preferences,resolvedTheme:state.resolvedTheme,fontScale:state.fontScale};window.__settingsNamespace=setNamespace;window.__settingsOpen=setOpen;window.__settingsReleaseHeld=async()=>{const previous=globalThis.IS_REACT_ACT_ENVIRONMENT;globalThis.IS_REACT_ACT_ENVIRONMENT=true;try{await act(async()=>{window.__settingsHold='';window.__settingsRelease()})}finally{globalThis.IS_REACT_ACT_ENVIRONMENT=previous}}},[state.preferences,state.resolvedTheme,state.fontScale]);const clear=async key=>{window.__settingsCalls.push(key);if(window.__settingsFailure===key)throw new Error('模拟清理失败');if(window.__settingsHold===key)await new Promise(resolve=>window.__settingsRelease=resolve)};return <main data-settings-owner={namespace} style={{color:"var(--text)"}}><header className="topbar" data-testid="global-theme-header"><div className="breadcrumb"><strong>全局主题预览</strong></div><button className="button" data-testid="global-theme-action">操作按钮</button></header><button onClick={()=>setOpen(true)}>打开设置测试</button>{open&&<Modal title="设置" onClose={()=>setOpen(false)}><Settings namespace={namespace} preferences={state.preferences} onPreferencesChange={state.updatePreferences} preferenceError={state.preferenceError} accountCount={2} version="synthetic-version" onAccountProfile={()=>window.__settingsCalls.push('profile')} onAccountSecurity={()=>clear('security')} onManageAccounts={()=>window.__settingsCalls.push('accounts')} onDownloads={()=>window.__settingsCalls.push('downloads')} onClearCache={()=>clear('cache')} onClearHistory={()=>clear('history')} onHelp={()=>window.__settingsCalls.push('help')} onAgreement={()=>window.__settingsCalls.push('agreement')}/></Modal>}</main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);
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
  await record('all theme colors share one picker and drive global colors with readable foregrounds', async () => {
    assert.equal(await dialog.locator('.preferences-palettes').count(), 0, 'duplicate palette grid should be removed');
    const options = await dialog.getByLabel('主题风格', { exact: true }).locator('option').allTextContents();
    assert.deepEqual(options, [...THEME_PALETTES.map(palette => palette.label), '黑色', '纯黑', '自定义']);
    for (const palette of THEME_PALETTES) {
      await dialog.getByLabel('主题风格', { exact: true }).selectOption(palette.id === 'white' ? 'light' : palette.id);
      await page.waitForFunction(id => window.__settingsState.palette === id && document.documentElement.dataset.palette === id && document.documentElement.dataset.theme === 'light', palette.id);
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-primary')), palette.color);
      const foregrounds = await page.evaluate(() => ['--theme-primary-on', '--theme-nav-active', '--theme-nav-active-text', '--theme-sidebar'].map(name => document.documentElement.style.getPropertyValue(name)));
      assert.ok(themeColorContrast(foregrounds[1], foregrounds[2]) >= 4.5, `${palette.label} selected-navigation contrast`);
      const header = await page.getByTestId('global-theme-header').evaluate(node => getComputedStyle(node).backgroundColor), expected = palette.id === 'white' ? '#ffffff' : palette.color;
      assert.equal(header, `rgb(${[1, 3, 5].map(index => parseInt(expected.slice(index, index + 2), 16)).join(', ')})`);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-preferences')).palette), palette.id);
    }
  });
  await record('feed card columns stop at three and semi-transparent material keeps a readable tint', async () => {
    const columns = dialog.getByLabel('信息流卡片列数', { exact: true });
    assert.deepEqual(await columns.locator('option').allTextContents(), ['单列', '2 列', '3 列']);
    for (const value of ['1', '3', '2']) {
      await columns.selectOption(value);
      await page.waitForFunction(value => JSON.parse(localStorage.getItem('coolapk-preferences')).feedColumns === Number(value), value);
    }
    const material = dialog.getByLabel('界面材质效果', { exact: true });
    assert.deepEqual(await material.locator('option').allTextContents(), ['背景模糊', '半透明']);
    await material.selectOption('fallback');
    const opacity = dialog.getByLabel('内容区域不透明度', { exact: true });
    assert.equal(await opacity.getAttribute('min'), '75');
    await opacity.evaluate(node => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(node, '0'); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => { const saved = JSON.parse(localStorage.getItem('coolapk-preferences')); return saved.materialEffect === 'fallback' && saved.surfaceOpacity === .75; });
    assert.equal(await dialog.locator('.preferences-material-preview').getAttribute('data-preview-material'), 'fallback');
    assert.ok(materialEffectReadability({ effect: 'fallback', opacity: 0, surface: '#ffffff', body: '#26322d' }).opacity >= .75);
  });
  await record('custom color validates a real global save, rejects arbitrary CSS and preserves readable foreground for very bright colors', async () => {
    const previousPrimary = await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-primary'));
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('custom');
    await dialog.getByLabel('自定义主题色色值', { exact: true }).fill('invalid');
    assert.equal(await dialog.getByRole('button', { name: '保存主题色', exact: true }).isDisabled(), true);
    await dialog.getByText('请输入有效的颜色，例如 #0f9d58。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-primary')), previousPrimary);
    await dialog.getByLabel('自定义主题色色值', { exact: true }).fill('#FFF'); await dialog.getByRole('button', { name: '保存主题色', exact: true }).click();
    await page.waitForFunction(() => window.__settingsState.customTheme === '#ffffff' && document.documentElement.style.getPropertyValue('--theme-primary') === '#ffffff');
    const colors = await page.evaluate(() => ['--accent', '--accent-on', '--theme-header', '--theme-header-text'].map(name => document.documentElement.style.getPropertyValue(name)));
    assert.ok(themeColorContrast(colors[0], '#ffffff') >= 4.5); assert.ok(themeColorContrast(colors[0], colors[1]) >= 4.5); assert.ok(themeColorContrast(colors[2], colors[3]) >= 4.5);
    await dialog.getByLabel('自定义强调色色盘', { exact: true }).fill('#8a55dd'); await dialog.getByRole('button', { name: '保存主题色', exact: true }).click();
    await page.waitForFunction(() => window.__settingsState.customAccent === '#8a55dd' && document.documentElement.style.getPropertyValue('--theme-accent') === '#8a55dd');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-primary')), '#ffffff');
    await dialog.getByLabel('自定义强调色色值', { exact: true }).fill('invalid'); assert.equal(await dialog.getByRole('button', { name: '保存主题色', exact: true }).isDisabled(), true); await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="自定义强调色色值"]')?.value === '#8a55dd');
    assert.equal(await dialog.getByLabel('自定义强调色色值', { exact: true }).inputValue(), '#8a55dd');
    await dialog.getByLabel('自定义主题色色值', { exact: true }).fill('#26322d'); await dialog.getByRole('button', { name: '保存主题色', exact: true }).click();
    await page.waitForFunction(() => window.__settingsState.customTheme === '#26322d' && document.documentElement.style.getPropertyValue('--theme-header-text') === '#ffffff');
    await page.reload(); await dialog.getByRole('button', { name: /^界面显示/ }).click();
    await page.waitForFunction(() => window.__settingsState.palette === 'custom' && document.documentElement.style.getPropertyValue('--theme-primary') === '#26322d');
    assert.equal(await dialog.getByLabel('自定义主题色色值', { exact: true }).inputValue(), '#26322d'); assert.equal(await dialog.getByLabel('自定义强调色色值', { exact: true }).inputValue(), '#8a55dd'); assert.equal(await dialog.getByLabel('主题风格', { exact: true }).inputValue(), 'custom');
  });
  await record('system night switching preserves the chosen palette and returns to its native header color in daylight', async () => {
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('purple');
    await dialog.getByRole('switch', { name: '夜间模式跟随系统' }).check();
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'black');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-primary')), '#673ab7');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-header')), '#0b0b0b');
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--theme-header')), '#673ab7');
    await dialog.getByLabel('主题风格', { exact: true }).selectOption('light');
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
    await page.waitForFunction(() => window.__settingsState.nightStart === '20:30' && window.__settingsState.nightEnd === '07:15');
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
    await page.evaluate(() => { window.__settingsNamespace('synthetic-account-b'); }); await page.waitForFunction(() => document.querySelector('[data-settings-owner]')?.dataset.settingsOwner === 'synthetic-account-b' && !document.querySelector('.preferences-status') && [...document.querySelectorAll('.preferences-entry')].find(node => node.textContent.startsWith('缓存清理'))?.disabled === false);
    // Test-only act drains the held reply and its React work before absence checks.
    await page.evaluate(() => window.__settingsReleaseHeld());
    assert.equal(await dialog.getByText('缓存已清理', { exact: true }).count(), 0);
  });
  await record('narrow window keeps controls reachable and keyboard escape returns focus to the caller', async () => {
    await page.setViewportSize({ width: 430, height: 740 }); await dialog.getByRole('button', { name: /^界面显示/ }).click();
    await dialog.getByLabel('夜间结束时间').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: `${output}/display-narrow.png`, fullPage: true });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: '打开设置测试', exact: true }).click(); await dialog.waitFor(); await page.screenshot({ path: `${output}/settings.png`, fullPage: true });
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/settings-ui-checks.json', JSON.stringify({ checkedAt: '2026-10-04', fixture: 'Settings + usePreferences; isolated Chrome; no live account or device writes', checks, result: 'passed', nativeIntegration: 'Global font scaling and actual black-theme variables require the root App/Electron checks.' }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', groups: checks.length })); await context.close();
} catch (error) { console.error(error); throw error; }
finally { await browser?.close(); await server.close(); }
