import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/download-check', { recursive: true });
writeFileSync('.local/download-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{AppDownload,DownloadsPage}from'/src/Downloads.tsx';import'/src/styles.css';
function Harness(){const[namespace,setNamespace]=useState('42');useEffect(()=>{window.__downloadNamespace=setNamespace},[]);return React.createElement('main',{style:{maxWidth:'1100px',margin:'auto',padding:'24px'}},React.createElement(AppDownload,{packageName:'com.example.synthetic',title:'模拟应用',namespace,onLogin:()=>{window.__downloadMock.logins++},toast:text=>{window.__downloadMock.toasts.push(text)}}),React.createElement(DownloadsPage,{namespace,toast:()=>{},onInstall:task=>{window.__downloadMock.installSelections.push(task.id)}}))};createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
</script></body></html>`);
const port = Number(process.env.COOLAPK_DOWNLOAD_TEST_PORT || 5184), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, test) { await test(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1300, height: 950 }, bypassCSP: true });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__downloadMock = { tasks: [], apiCalls: [], bridgeCalls: [], listeners: new Set(), unsubscribeCount: 0, toasts: [], installSelections: [], logins: 0, failList: false, failVersions: false };
    const snapshot = () => ({ tasks: structuredClone(mock.tasks), directory: 'C:\\Synthetic Downloads\\酷安下载' });
    mock.emit = () => mock.listeners.forEach(listener => listener(snapshot()));
    window.coolapk = { verify: async () => ({ ok: true, data: {} }), call: async (operation, args) => {
      mock.apiCalls.push({ operation, args: structuredClone(args) });
      if (operation === 'apkDownloadPlan') return { ok: true, data: { data: { packageName: args.packageName, title: '模拟应用', versionCode: '30', versionName: '3.0' } } };
      if (operation === 'apkDownloadVersions') { if (mock.failVersions) return { ok: false, error: { code: 'NETWORK', message: '模拟历史版本获取失败' } }; return { ok: true, data: { data: args.page === 2 ? [{ id: 'ten', downloadVersionCode: '10', downloadVersionName: '1.0' }] : [{ id: 'twenty', downloadVersionCode: '20', downloadVersionName: '2.0' }, { id: 'no-code', downloadVersionCode: '', downloadVersionName: '无版本码' }], hasMore: args.page !== 2 } }; }
      return { ok: true, data: {} };
    }, downloads: async (operation, args = {}) => {
      mock.bridgeCalls.push({ operation, args: structuredClone(args) });
      if (operation === 'list') return mock.failList ? { ok: false, error: { code: 'DOWNLOAD_ERROR', message: '模拟下载中心读取失败' } } : { ok: true, data: snapshot() };
      if (operation === 'add') { const task = { id: `synthetic-task-${mock.tasks.length + 1}`, packageName: args.packageName, title: args.title || '模拟应用', versionCode: args.versionCode || '30', versionName: args.versionCode === '10' ? '1.0' : '3.0', fileName: '', status: 'queued', downloaded: 0, total: 0, speed: 0, verified: false, retryable: false, sha256: '', error: '', errorCode: '', createdAt: Date.now(), updatedAt: Date.now(), retryCount: 0 }; mock.tasks.push(task); mock.emit(); return { ok: true, data: structuredClone(task) }; }
      if (operation === 'clearFinished') { const before = mock.tasks.length; mock.tasks = mock.tasks.filter(task => !['completed', 'failed', 'canceled'].includes(task.status) || task.removable === false); mock.emit(); return { ok: true, data: { ...snapshot(), removedCount: before - mock.tasks.length } }; }
      const task = mock.tasks.find(task => task.id === args.id); if (!task) return { ok: false, error: { code: 'INPUT', message: '模拟任务不存在' } };
      if (operation === 'remove') { if (!['completed', 'failed', 'canceled'].includes(task.status) || task.removable === false) return { ok: false, error: { code: 'DOWNLOAD_ACTIVE', message: '模拟任务仍在收尾' } }; mock.tasks = mock.tasks.filter(value => value.id !== task.id); mock.emit(); return { ok: true, data: { ...snapshot(), removedCount: 1 } }; }
      if (operation === 'cancel') Object.assign(task, { status: 'canceled', retryable: true, speed: 0, verified: false });
      if (operation === 'pause') Object.assign(task, { status: 'paused', resumable: true, partialReusable: true, retryable: true, speed: 0, verified: false });
      if (operation === 'resume') Object.assign(task, { status: 'downloading', resumable: false, retryable: false, speed: 0, verified: false });
      if (operation === 'retry') Object.assign(task, { status: 'queued', retryable: false, downloaded: 0, speed: 0, verified: false, error: '', errorCode: '', retryCount: task.retryCount + 1 }); mock.emit(); return { ok: true, data: structuredClone(task) };
    }, onDownloads: listener => { mock.listeners.add(listener); return () => { mock.unsubscribeCount++; mock.oldListeners ||= []; mock.oldListeners.push(listener); mock.listeners.delete(listener); }; } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/download-harness.html');
  const picker = () => page.getByRole('dialog', { name: '下载 · 模拟应用' });
  await record('current version queues only package metadata and exposes a separate download center', async () => {
    await page.getByText('还没有下载任务', { exact: true }).waitFor(); await page.getByRole('button', { name: '下载安装包', exact: true }).click(); await picker().getByText('3.0 · 版本码 30', { exact: true }).waitFor(); await picker().getByRole('button', { name: '下载当前版本', exact: true }).click(); await picker().waitFor({ state: 'hidden' }); await page.getByText('等待下载', { exact: true }).waitFor();
    const added = await page.evaluate(() => window.__downloadMock.bridgeCalls.filter(call => call.operation === 'add')); assert.deepEqual(added[0].args, { packageName: 'com.example.synthetic', title: '模拟应用' }); assert.equal(added.length, 1); assert.equal(await page.getByRole('button', { name: '安装到 USB 手机', exact: true }).count(), 0);
  });
  await record('history pages require server version codes and pass the selected page back for verification', async () => {
    await page.getByRole('button', { name: '下载安装包', exact: true }).click(); await picker().getByRole('tab', { name: '历史版本', exact: true }).click(); await picker().getByText('未提供下载版本码，暂不可下载', { exact: true }).waitFor(); assert.equal(await picker().getByRole('button', { name: '下载历史版本 无版本码', exact: true }).isDisabled(), true); await picker().getByRole('button', { name: '下一页', exact: true }).click(); await picker().getByText('版本码 10', { exact: true }).waitFor(); await picker().getByRole('button', { name: '下载历史版本 1.0', exact: true }).click(); await picker().waitFor({ state: 'hidden' });
    const added = await page.evaluate(() => window.__downloadMock.bridgeCalls.filter(call => call.operation === 'add')); assert.deepEqual(added[1].args, { packageName: 'com.example.synthetic', title: '模拟应用', versionCode: '10', versionPage: 2 });
  });
  await record('main process events update progress, speed and unknown-length streams without inventing completion', async () => {
    await page.evaluate(() => { Object.assign(window.__downloadMock.tasks[0], { status: 'downloading', downloaded: 512, total: 1024, speed: 512 }); Object.assign(window.__downloadMock.tasks[1], { status: 'downloading', downloaded: 2048, total: 0, speed: 0 }); window.__downloadMock.emit(); }); const first = page.locator('[data-download-id="synthetic-task-1"]'), second = page.locator('[data-download-id="synthetic-task-2"]'); await first.getByText('512 B / 1.0 KB · 50%', { exact: true }).waitFor(); assert.equal(await first.locator('progress').getAttribute('value'), '50'); assert.equal(await second.locator('progress').getAttribute('value'), null); assert.equal(await first.getByText('512 B/s', { exact: true }).count(), 1); assert.equal(await page.getByText('下载完成 · 已通过酷安下载校验', { exact: true }).count(), 0); await page.screenshot({ path: '.local/download-check/progress.png' });
  });
  await record('pause preserves progress and explicit continue uses only the native task capability', async () => {
    const first = page.locator('[data-download-id="synthetic-task-1"]');
    await first.getByRole('button', { name: '暂停下载', exact: true }).click(); await first.getByText('已暂停', { exact: true }).waitFor();
    await first.getByText('512 B / 1.0 KB · 50%', { exact: true }).waitFor(); assert.equal(await first.getByRole('button', { name: '安装到 USB 手机', exact: true }).count(), 0);
    await first.getByRole('button', { name: '继续下载', exact: true }).click(); await first.getByText('正在下载', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__downloadMock.bridgeCalls.filter(call => ['pause','resume'].includes(call.operation)).map(call => ({ op: call.operation, args: call.args }))), [{op:'pause',args:{id:'synthetic-task-1'}},{op:'resume',args:{id:'synthetic-task-1'}}]);
    assert.equal(await first.locator('progress').getAttribute('value'), '50');
  });
  await record('pending pause cleanup locks continuation and restart while explaining unavailable validators', async () => {
    const first = page.locator('[data-download-id="synthetic-task-1"]');
    await page.evaluate(() => { Object.assign(window.__downloadMock.tasks[0], { status:'paused',resumable:false,retryable:false,partialReusable:false }); window.__downloadMock.emit(); });
    await first.getByText('正在保存暂停进度…', {exact:true}).waitFor(); assert.equal(await first.getByRole('button',{name:'继续下载',exact:true}).isDisabled(),true); assert.equal(await first.getByRole('button',{name:'重新下载',exact:true}).isDisabled(),true);
    await page.evaluate(() => { Object.assign(window.__downloadMock.tasks[0], { resumable:true,retryable:true }); window.__downloadMock.emit(); });
    await first.getByText('继续时重新下载；此连接未提供可用于续传的文件标识。', {exact:true}).waitFor(); await first.getByRole('button',{name:'继续下载',exact:true}).click(); await first.getByText('正在下载',{exact:true}).waitFor();
  });
  await record('cancel and retry are explicit bounded task actions and reset the queue progress', async () => {
    const first = page.locator('[data-download-id="synthetic-task-1"]'); await first.getByRole('button', { name: '取消下载', exact: true }).click(); await first.getByText('已取消', { exact: true }).waitFor(); await first.getByRole('button', { name: '重新下载', exact: true }).click(); await first.getByText('等待下载', { exact: true }).waitFor(); const state = await page.evaluate(() => ({ task: window.__downloadMock.tasks[0], calls: window.__downloadMock.bridgeCalls.filter(call => ['cancel', 'retry'].includes(call.operation)) })); assert.equal(state.task.downloaded, 0); assert.equal(state.task.retryCount, 1); assert.deepEqual(state.calls.map(call => ({ op: call.operation, args: call.args })), [{ op: 'cancel', args: { id: 'synthetic-task-1' } }, { op: 'retry', args: { id: 'synthetic-task-1' } }]);
  });
  await record('open, reveal and USB selection become available only after verified completion', async () => {
    await page.evaluate(() => { Object.assign(window.__downloadMock.tasks[0], { status: 'completed', downloaded: 1024, total: 1024, verified: true, fileName: 'synthetic-30.apk', sha256: 'a'.repeat(64) }); window.__downloadMock.emit(); }); const first = page.locator('[data-download-id="synthetic-task-1"]'); await first.getByText('下载完成 · 已通过酷安下载校验', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.__downloadMock.installSelections), []); await first.getByRole('button', { name: '打开文件', exact: true }).click(); await first.getByRole('button', { name: '显示所在目录', exact: true }).click(); await first.getByRole('button', { name: '安装到 USB 手机', exact: true }).click(); const selections = await page.evaluate(() => ({ installed: window.__downloadMock.installSelections, calls: window.__downloadMock.bridgeCalls.filter(call => ['open', 'reveal', 'install'].includes(call.operation)) })); assert.deepEqual(selections.installed, ['synthetic-task-1']); assert.deepEqual(selections.calls.map(call => call.operation), ['open', 'reveal']); assert.ok(selections.calls.every(call => Object.keys(call.args).join(',') === 'id')); await first.getByText('查看文件校验信息', { exact: true }).click(); await page.screenshot({ path: '.local/download-check/completed.png' });
  });
  await record('download failures retain explicit errors and list refresh failures keep completed history visible', async () => {
    await page.evaluate(() => { Object.assign(window.__downloadMock.tasks[1], { status: 'failed', error: '下载地址不在已适配的酷安官方服务器范围内', errorCode: 'UNSUPPORTED_DOWNLOAD_HOST', verified: false, retryable: true }); window.__downloadMock.emit(); }); const failed = page.locator('[data-download-id="synthetic-task-2"]'); await failed.getByText('下载地址不在已适配的酷安官方服务器范围内', { exact: true }).waitFor(); assert.equal(await failed.getByRole('button', { name: '打开文件', exact: true }).count(), 0); await page.evaluate(() => { window.__downloadMock.failList = true; }); await page.getByRole('button', { name: '刷新下载列表', exact: true }).click(); await page.getByText('模拟下载中心读取失败', { exact: true }).waitFor(); assert.equal(await page.locator('[data-download-id="synthetic-task-1"]').count(), 1); await page.evaluate(() => { window.__downloadMock.failList = false; }); await page.getByRole('button', { name: '刷新下载列表', exact: true }).click(); await page.getByRole('alert').waitFor({ state: 'hidden' });
  });
  await record('account changes release old subscriptions and history read errors do not appear as empty success', async () => {
    const baseline = await page.evaluate(() => window.__downloadMock.unsubscribeCount); await page.evaluate(() => window.__downloadNamespace('99')); await page.getByText('模拟应用', { exact: true }).first().waitFor(); await page.waitForFunction(baseline => window.__downloadMock.unsubscribeCount > baseline && window.__downloadMock.listeners.size === 1, baseline); await page.evaluate(() => { window.__downloadMock.failVersions = true; }); await page.getByRole('button', { name: '下载安装包', exact: true }).click(); await picker().getByRole('tab', { name: '历史版本', exact: true }).click(); await picker().getByText('模拟历史版本获取失败', { exact: true }).waitFor(); assert.equal(await picker().getByText('暂无历史版本', { exact: true }).count(), 0); await page.keyboard.press('Escape'); await picker().waitFor({ state: 'hidden' });
  });
  await record('a disposed account subscription cannot replace the current download history with a late event', async () => {
    await page.evaluate(() => { window.__downloadMock.oldListeners.at(-1)({ tasks:[{...window.__downloadMock.tasks[0],title:'旧账号下载状态'}],directory:'synthetic-old'}); });
    assert.equal(await page.getByText('旧账号下载状态',{exact:true}).count(),0); await page.locator('[data-download-id="synthetic-task-1"]').waitFor();
  });
  await record('single delete removes settled history by task ID and explicitly retains files', async () => {
    const failed = page.locator('[data-download-id="synthetic-task-2"]');
    await page.getByText('删除记录会保留已下载文件；暂停或进行中的任务请先取消。', { exact:true }).waitFor();
    await page.evaluate(() => { window.__downloadMock.tasks[1].removable = false; window.__downloadMock.emit(); });
    await page.waitForFunction(() => document.querySelector('[data-download-id="synthetic-task-2"] .download-status')?.textContent === '下载失败');
    assert.equal(await failed.getByRole('button', { name:'删除记录',exact:true }).isDisabled(), true);
    await page.evaluate(() => { window.__downloadMock.tasks[1].removable = true; window.__downloadMock.emit(); });
    await failed.getByRole('button', { name:'删除记录',exact:true }).click(); await failed.waitFor({state:'hidden'});
    await page.locator('[data-download-id="synthetic-task-1"]').waitFor();
    const calls = await page.evaluate(() => window.__downloadMock.bridgeCalls.filter(call => call.operation === 'remove'));
    assert.deepEqual(calls.map(call => call.args), [{id:'synthetic-task-2'}]);
  });
  await record('clear finished history leaves active tasks and paused continuation available', async () => {
    await page.evaluate(() => { const base = window.__downloadMock.tasks[0]; window.__downloadMock.tasks.push({...base,id:'synthetic-working',status:'downloading',verified:false,removable:false}); window.__downloadMock.tasks.push({...base,id:'synthetic-paused',status:'paused',verified:false,resumable:true,removable:false}); window.__downloadMock.emit(); });
    const working = page.locator('[data-download-id="synthetic-working"]'), paused = page.locator('[data-download-id="synthetic-paused"]');
    await working.getByText('正在下载',{exact:true}).waitFor(); assert.equal(await working.getByRole('button',{name:'删除记录',exact:true}).count(),0);
    await page.getByRole('button',{name:'清除已结束记录',exact:true}).click(); await page.locator('[data-download-id="synthetic-task-1"]').waitFor({state:'hidden'});
    await paused.getByRole('button',{name:'继续下载',exact:true}).waitFor(); await working.getByRole('button',{name:'取消下载',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'清除已结束记录',exact:true}).isDisabled(),true);
    const calls = await page.evaluate(() => window.__downloadMock.bridgeCalls.filter(call => call.operation === 'clearFinished'));
    assert.deepEqual(calls.map(call => call.args), [{}]);
    await page.screenshot({path:'.local/download-check/history-cleanup.png'});
  });
  assert.deepEqual(errors, []); writeFileSync('research/download-checks.json', JSON.stringify({ mode: 'synthetic renderer contract checks; no real APK downloads or USB installation', externalRequests: 'blocked', checks, errors }, null, 2));
} finally { await browser?.close(); await server.close(); }
