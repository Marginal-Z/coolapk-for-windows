// Isolated renderer with synthetic IPC; every non-fixture network request is blocked.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_APP_DISCOVERY_TEST_PORT || 5192), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/app-discovery-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="color:var(--text);background:var(--bg)"><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AppDiscovery}from'/src/AppDiscovery.tsx';import'/src/styles.css';function Fixture(){const[scope,setScope]=useState('guest');const[type,setType]=useState('apps');window.__discoveryScope=value=>{window.__discoveryMock.scope=value;setScope(value)};window.__discoveryPage=setType;const noop=()=>{};return <main style={{maxWidth:1000,margin:'auto',padding:20}}><AppDiscovery page={{kind:'apps',type,title:'应用和游戏'}} namespace={scope} account={null} go={noop} onLogin={()=>window.__discoveryMock.login++} openEntity={item=>window.__discoveryMock.opened.push(item)} toast={noop} feedProps={{onUser:noop,onLink:noop}}/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__discoveryMock = { scope: 'guest', calls: [], opened: [], login: 0, hold: '', pending: [], fail: null, empty: '' };
    const ok = data => ({ ok: true, data });
    window.coolapk = {
      verify: async () => { mock.fail = null; return ok({}); },
      call: async (operation, args = {}) => {
        const scope = mock.scope, category = args.category, page = args.page || 1;
        mock.calls.push({ operation, args: { ...args }, scope });
        if (mock.hold === category) await new Promise(resolve => mock.pending.push(resolve));
        if (mock.fail && mock.fail.category === category && mock.fail.page === page) return { ok: false, error: { code: mock.fail.code || 'NETWORK', message: '模拟应用网络错误', ...(mock.fail.code === 'VERIFY_REQUIRED' ? { verificationId: 'synthetic-app-discovery-verification' } : {}) } };
        if (mock.empty === category) return ok({ data: [], hasMore: false, firstItem: '', lastItem: '' });
        const entity = (suffix, label) => ({ entityType: 'apk', id: category + ':' + suffix, packageName: 'com.example.' + category + '.' + suffix, title: category + ':' + scope + ':' + label, description: '合成应用说明' });
        const data = page === 1 ? [entity('one', '1'), entity('two', '2')] : [entity('one', '1'), entity('three', '3')];
        return ok({ data, hasMore: page === 1, firstItem: category + ':first', lastItem: category + ':tail:' + page });
      },
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/.local/app-discovery-check/test.html`);
  const calls = () => page.evaluate(() => window.__discoveryMock.calls);
  const appSelect = () => page.getByRole('combobox', { name: '应用分类' });
  const gameSelect = () => page.getByRole('combobox', { name: '游戏分类' });
  const card = label => page.locator('.entity-card').filter({ has: page.getByText(label, { exact: true }) });
  async function held() { await page.waitForFunction(() => window.__discoveryMock.pending.length > 0); }
  async function release() { await page.evaluate(() => { const pending = window.__discoveryMock.pending.splice(0); window.__discoveryMock.hold = ''; pending.forEach(resolve => resolve()); }); }

  await record('guest default uses the app rank operation and native category control', async () => {
    await card('recommend:guest:1').waitFor(); assert.equal(await appSelect().inputValue(), 'recommend');
    assert.ok((await calls()).some(item => item.operation === 'appDiscovery' && item.args.category === 'recommend' && item.args.page === 1));
    assert.equal(await page.getByRole('button', { name: '应用', exact: true }).getAttribute('aria-pressed'), 'true');
  });
  await record('all six app choices use their fixed discovery categories', async () => {
    for (const category of ['newest', 'tools', 'social', 'media', 'beauty', 'recommend']) { await appSelect().selectOption(category); await card(category + ':guest:1').waitFor(); const last = (await calls()).at(-1); assert.equal(last.operation, 'appDiscovery'); assert.deepEqual(last.args, { category, page: 1 }); }
  });
  await record('all six game choices are reachable by native mode and category controls', async () => {
    await page.getByRole('button', { name: '游戏', exact: true }).click();
    for (const category of ['hot', 'new', 'single', 'online', 'casual', 'indie']) { await gameSelect().selectOption(category); await card(category + ':guest:1').waitFor(); const last = (await calls()).at(-1); assert.equal(last.operation, 'gameDiscovery'); assert.deepEqual(last.args, { category, page: 1 }); }
  });
  await record('pagination preserves opaque cursors, deduplicates and disables the terminal page', async () => {
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await card('indie:guest:3').waitFor();
    assert.equal(await page.locator('.entity-card').count(), 3); const last = (await calls()).at(-1); assert.deepEqual(last.args, { category: 'indie', page: 2, firstItem: 'indie:first', lastItem: 'indie:tail:1' });
    assert.equal(await page.getByRole('button', { name: '已经看完了', exact: true }).isDisabled(), true);
    await gameSelect().selectOption('casual'); await card('casual:guest:1').waitFor(); assert.deepEqual((await calls()).at(-1).args, { category: 'casual', page: 1 }); assert.equal(await card('indie:guest:3').count(), 0);
  });
  await record('delayed previous-category response cannot replace the current category', async () => {
    await page.evaluate(() => { window.__discoveryMock.hold = 'single'; }); await gameSelect().selectOption('single'); await held();
    await gameSelect().selectOption('online'); await card('online:guest:1').waitFor(); await release(); await card('online:guest:1').waitFor();
    assert.equal(await card('single:guest:1').count(), 0);
  });
  await record('namespace changes reset page one and discard held responses under StrictMode', async () => {
    await page.getByRole('button', { name: '应用', exact: true }).click(); await appSelect().selectOption('recommend'); await card('recommend:guest:1').waitFor();
    await page.evaluate(() => { window.__discoveryMock.hold = 'social'; }); await appSelect().selectOption('social'); await held();
    await page.evaluate(() => window.__discoveryScope('synthetic-new-account')); await card('recommend:synthetic-new-account:1').waitFor(); await release();
    assert.equal(await card('social:guest:1').count(), 0); assert.deepEqual((await calls()).filter(item => item.scope === 'synthetic-new-account').at(-1).args, { category: 'recommend', page: 1 });
  });
  await record('failure is visible, is not an empty success, and retry reloads the same category', async () => {
    await page.evaluate(() => { window.__discoveryMock.fail = { category: 'tools', page: 1 }; }); await appSelect().selectOption('tools'); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('这个分类暂时没有应用', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__discoveryMock.fail = null; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await card('tools:synthetic-new-account:1').waitFor(); assert.deepEqual((await calls()).at(-1).args, { category: 'tools', page: 1 });
  });
  await record('accessible network-error retry repeats page two with exact cursors and retains page one', async () => {
    const firstPageCount = (await calls()).filter(item => item.args.category === 'tools' && item.args.page === 1).length;
    await page.evaluate(() => { window.__discoveryMock.fail = { category: 'tools', page: 2 }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('alert').waitFor(); assert.equal(await page.locator('.entity-card').count(), 2);
    await card('tools:synthetic-new-account:1').waitFor(); await card('tools:synthetic-new-account:2').waitFor();
    await page.evaluate(() => { window.__discoveryMock.fail = null; }); await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click(); await card('tools:synthetic-new-account:3').waitFor();
    const attempts = (await calls()).filter(item => item.args.category === 'tools' && item.args.page === 2); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].args, attempts[1].args);
    assert.deepEqual(attempts[1].args, { category: 'tools', page: 2, firstItem: 'tools:first', lastItem: 'tools:tail:1' });
    assert.equal((await calls()).filter(item => item.args.category === 'tools' && item.args.page === 1).length, firstPageCount); assert.equal(await page.locator('.entity-card').count(), 3);
  });
  await record('challenge failures stay visible until synthetic verification and retry', async () => {
    await page.evaluate(() => { window.__discoveryMock.fail = { category: 'media', page: 1, code: 'VERIFY_REQUIRED' }; }); await appSelect().selectOption('media'); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await card('media:synthetic-new-account:1').waitFor();
  });
  await record('page-two verification repeats the challenged cursors and accumulates without resetting page one', async () => {
    const firstPageCount = (await calls()).filter(item => item.args.category === 'media' && item.args.page === 1).length;
    await page.evaluate(() => { window.__discoveryMock.fail = { category: 'media', page: 2, code: 'VERIFY_REQUIRED' }; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByRole('alert').getByRole('button', { name: '完成验证', exact: true }).waitFor(); assert.equal(await page.locator('.entity-card').count(), 2); await card('media:synthetic-new-account:1').waitFor();
    await page.getByRole('alert').getByRole('button', { name: '完成验证', exact: true }).click(); await card('media:synthetic-new-account:3').waitFor();
    const attempts = (await calls()).filter(item => item.args.category === 'media' && item.args.page === 2); assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].args, attempts[1].args); assert.deepEqual(attempts[1].args, { category: 'media', page: 2, firstItem: 'media:first', lastItem: 'media:tail:1' });
    assert.equal((await calls()).filter(item => item.args.category === 'media' && item.args.page === 1).length, firstPageCount); assert.equal(await page.locator('.entity-card').count(), 3); await card('media:synthetic-new-account:2').waitFor();
  });
  await record('empty successful responses have an explicit empty state and no active pagination', async () => {
    await page.evaluate(() => { window.__discoveryMock.empty = 'beauty'; }); await appSelect().selectOption('beauty'); await page.getByText('这个分类暂时没有应用', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '已经看完了', exact: true }).isDisabled(), true);
  });
  await record('APK cards open the existing entity route and controls work at narrow dark width', async () => {
    await appSelect().selectOption('newest'); await card('newest:synthetic-new-account:1').click(); assert.equal(await page.evaluate(() => window.__discoveryMock.opened.at(-1).entityType), 'apk');
    await page.setViewportSize({ width: 640, height: 800 }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await appSelect().focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    await card('recommend:synthetic-new-account:1').waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.entity-card')).color]), ['rgb(22, 28, 25)', 'rgb(227, 235, 230)']);
    await page.evaluate(() => window.__discoveryPage('games')); await card('hot:synthetic-new-account:1').waitFor(); assert.equal(await gameSelect().inputValue(), 'hot');
  });
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => window.__discoveryMock.calls.every(item => ['appDiscovery', 'gameDiscovery'].includes(item.operation))), true);
  await page.screenshot({ path: resolve(output, 'complete.png') });
  writeFileSync('research/app-discovery-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic isolated React renderer under StrictMode; external network blocked; no real account or phone requests', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: resolve(output, 'failure.png') }); throw error; }
finally { await browser?.close(); await server.close(); }
