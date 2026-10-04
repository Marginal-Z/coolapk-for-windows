// Real App/preload/IPC and electron-updater check/download/hash implementation.
// A loopback feed replaces GitHub only in this test bootstrap. Installer launch
// and confirmation are recorded; no process is installed or real account used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.local/updates-native-check'); mkdirSync(directory, { recursive: true });
const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const nextVersion = metadata.version.replace(/\d+$/, value => Number(value) + 1);
const filename = `Coolapk-Desktop-Setup-${nextVersion}-x64.exe`;
const bytes = Buffer.alloc(3 * 1024 ** 2, 42), digest = createHash('sha512').update(bytes).digest('base64');
const requests = [], timers = new Set();
let corruptPayload = false;
const server = createServer((request, response) => {
  requests.push({ path: new URL(request.url, 'http://localhost').pathname, cookie: !!request.headers.cookie, authorization: !!request.headers.authorization });
  if (request.url.startsWith('/latest.yml')) {
    response.setHeader('Content-Type', 'text/yaml');
    response.end(`version: ${nextVersion}\nfiles:\n  - url: ${filename}\n    sha512: ${digest}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${digest}\nreleaseDate: '2026-10-04T00:00:00.000Z'\nreleaseNotes: '<b>隔离更新说明</b>'\n`); return;
  }
  if (new URL(request.url, 'http://localhost').pathname !== '/' + filename) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
  const payload = corruptPayload ? Buffer.alloc(bytes.length, 43) : bytes;
  let offset = 0;
  const timer = setInterval(() => {
    if (response.destroyed) { clearInterval(timer); timers.delete(timer); return; }
    response.write(payload.subarray(offset, offset + 65536)); offset += 65536;
    if (offset >= bytes.length) { clearInterval(timer); timers.delete(timer); response.end(); }
  }, 45);
  timers.add(timer); response.on('close', () => { clearInterval(timer); timers.delete(timer); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const feed = `http://127.0.0.1:${server.address().port}/`;
const userdata = mkdtempSync(path.join(directory, 'userdata-'));
const updateConfig = path.join(directory, 'app-update.yml'); writeFileSync(updateConfig, `provider: generic\nurl: ${feed}\nupdaterCacheDirName: isolated-updates\n`);
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'updates-native-fixture', version: metadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(directory, 'bootstrap.cjs'), `
const {app,session,ipcMain,dialog}=require('electron');
Object.defineProperty(app,'isPackaged',{get:()=>true});
globalThis.updateNative={handlers:new Map(),installs:[],confirmations:[],responses:[],blocked:0,updater:null};
globalThis.updateNative.installEvents=new(require('node:events').EventEmitter)();
const originalLoad=require('node:module')._load;
require('node:module')._load=function(id,parent,isMain){
 const exports=originalLoad.apply(this,arguments);
 if(id!=='electron-updater')return exports;
 return {...exports,NsisUpdater:class extends exports.NsisUpdater{
  constructor(options){super({provider:'generic',url:${JSON.stringify(feed)}});globalThis.updateNative.provider=options;globalThis.updateNative.updater=this;this.updateConfigPath=${JSON.stringify(updateConfig)};Object.defineProperty(this.app,'baseCachePath',{get:()=>${JSON.stringify(path.join(userdata, 'update-cache'))}});this.disableDifferentialDownload=true;}
  quitAndInstall(...args){globalThis.updateNative.installs.push(args);globalThis.updateNative.installEvents.emit('install');}
 }};
};
dialog.showMessageBox=async(_,options)=>{globalThis.updateNative.confirmations.push(options.title);return{response:globalThis.updateNative.responses.shift()??0}};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(request,reply)=>{const allowed=request.url.startsWith(${JSON.stringify(feed)});if(!allowed)globalThis.updateNative.blocked++;reply({cancel:!allowed})}));
const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>{
 if(channel==='coolapk:accounts')return register(channel,()=>({ok:true,data:{accounts:[],current:null}}));
 if(channel==='coolapk:call')return register(channel,(_,operation)=>({ok:true,data:{data:operation==='home'?[{entityType:'feed',id:'809',uid:'777',username:'隔离测试',message:'更新原生测试'}]:[],hasMore:false}}));
 globalThis.updateNative.handlers.set(channel,handler);return register(channel,handler);
};require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});
`);
const env = { ...process.env, COOLAPK_TEST_DATA: userdata }; delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_FILE;
let desktop; const checks = [], errors = [];
async function record(name, run) { await run(); checks.push(name); console.log('PASS', name); }
try {
  desktop = await playwright._electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 });
  const page = await desktop.firstWindow(); page.on('pageerror', failure => errors.push(failure.message));
  await page.locator('[data-feed-id="809"]').waitFor();
  const panel = page.getByRole('dialog', { name: '软件更新', exact: true });
  const invoke = operation => page.evaluate(operation => window.coolapk.updates(operation), operation);
  const phase = async expected => {
    const deadline = Date.now() + 30000;
    let state;
    do {
      const reply = await invoke('info');
      assert.equal(reply.ok, true, 'Updater state IPC failed');
      state = reply.data;
      if (state.status === expected) {
        assert.equal(state.status, expected);
        return state;
      }
      if (state.status === 'error' && expected !== 'error') assert.fail(`Updater failed while waiting for ${expected}: ${state.error}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.fail(`Updater did not reach ${expected} within 30 s; final status: ${state?.status}`);
  };
  await record('actual Settings and native help menu open the shared updater through the real preload', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: /^软件更新/ }).click(); await panel.waitFor();
    await panel.getByText(`当前版本 ${metadata.version}`, { exact: false }).waitFor();
    assert.equal((await invoke('info')).data.distribution, 'installed');
    await panel.getByRole('button', { name: '关闭', exact: true }).click();
    await desktop.evaluate(({ Menu, BrowserWindow }) => { const item=Menu.getApplicationMenu().items.find(item=>item.label==='帮助').submenu.items.find(item=>item.label==='检查软件更新');item.click(item,BrowserWindow.getAllWindows()[0]); }); await panel.waitFor();
    assert.equal(requests.length, 0, 'isolated test disables automatic startup traffic');
  });
  await record('real updater checks a complete manifest without cookies and displays the available stable version', async () => {
    await panel.getByRole('button', { name: '检查更新', exact: true }).click(); await panel.getByText('发现新版本', { exact: true }).waitFor();
    await panel.getByText(`版本 ${nextVersion}`, { exact: true }).waitFor(); await panel.getByText('隔离更新说明', { exact: true }).waitFor();
    assert.equal(await panel.locator('b').count(), 0);
    const provider = await desktop.evaluate(() => globalThis.updateNative.provider);
    assert.deepEqual(provider, { provider:'github', owner:'Z-YO-YI', repo:'coolapk-for-windows', private:false });
    assert.equal(await desktop.evaluate(() => globalThis.updateNative.updater.autoInstallOnAppQuit), false);
    assert.equal(await desktop.evaluate(({session}) => globalThis.updateNative.updater.httpExecutor.cachedSession === session.defaultSession), false);
  });
  await record('privileged update handler rejects custom feed arguments and untrusted callers', async () => {
    const results = await desktop.evaluate(async ({ BrowserWindow }) => {
      const contents=BrowserWindow.getAllWindows()[0].webContents,handler=globalThis.updateNative.handlers.get('coolapk:updates');
      return [await handler({sender:contents,senderFrame:contents.mainFrame},'check',{url:'https://invalid.example'}),await handler({sender:null,senderFrame:null},'download'),await handler({sender:contents,senderFrame:contents.mainFrame},'execute')];
    }); assert.ok(results.every(result => result.ok === false));
  });
  await record('real streamed download can cancel, ignore late events and retry without closing the application', async () => {
    await panel.getByRole('button', { name: '下载更新', exact: true }).click(); await panel.getByRole('button', { name: '取消下载', exact: true }).waitFor();
    await panel.getByRole('button', { name: '取消下载', exact: true }).click(); await phase('available');
    await desktop.evaluate(async () => { const deadline=Date.now()+5000;while(globalThis.updateNative.updater.downloadPromise){if(Date.now()>deadline)throw new Error('Canceled download did not settle');await new Promise(resolve=>setTimeout(resolve,20));} });
    await panel.getByRole('button', { name: '下载更新', exact: true }).click(); await panel.getByRole('progressbar', { name: '更新下载进度' }).waitFor();
    await page.waitForFunction(() => document.querySelector('progress')?.value > 0);
    await phase('downloaded'); await panel.getByRole('button', { name: '退出并安装', exact: true }).waitFor();
    assert.deepEqual(await desktop.evaluate(() => globalThis.updateNative.installs), []);
  });
  await record('native install confirmation can cancel while preserving a verified download', async () => {
    await panel.getByRole('button', { name: '退出并安装', exact: true }).click(); await phase('downloaded');
    assert.deepEqual(await desktop.evaluate(() => globalThis.updateNative.installs), []);
    assert.equal(await desktop.evaluate(() => globalThis.updateNative.confirmations.length), 1);
  });
  await record('cache tampering is detected again before install and the UI offers a download retry', async () => {
    const cached = await desktop.evaluate(() => globalThis.updateNative.updater.installerPath);
    writeFileSync(cached, 'tampered');
    await desktop.evaluate(() => globalThis.updateNative.responses.push(1));
    await panel.getByRole('button', { name: '退出并安装', exact: true }).click(); await phase('error');
    await panel.getByRole('alert').waitFor(); assert.deepEqual(await desktop.evaluate(() => globalThis.updateNative.installs), []);
  });
  await record('real electron-updater rejects corrupted streamed bytes against manifest SHA512 before allowing install', async () => {
    corruptPayload = true;
    await panel.getByRole('button', { name: '重试下载', exact: true }).click(); await phase('downloading'); await phase('error');
    assert.deepEqual(await desktop.evaluate(() => globalThis.updateNative.installs), []);
    corruptPayload = false;
    await panel.getByRole('button', { name: '重试下载', exact: true }).click(); await phase('downloaded');
  });
  await record('verified install explicitly invokes the NSIS assisted installer once', async () => {
    await desktop.evaluate(() => globalThis.updateNative.responses.push(1));
    await panel.getByRole('button', { name: '退出并安装', exact: true }).click(); await phase('installing');
    await desktop.evaluate(() => new Promise((resolve,reject) => {
      const fixture=globalThis.updateNative;
      if(fixture.installs.length)return resolve();
      const timer=setTimeout(()=>{fixture.installEvents.removeListener('install',complete);reject(new Error('Installer was not invoked after integrity verification'));},5000);
      function complete(){clearTimeout(timer);resolve();}fixture.installEvents.once('install',complete);
    }));
    assert.deepEqual(await desktop.evaluate(() => globalThis.updateNative.installs), [[false,true]]);
  });
  assert.deepEqual(errors, []); assert.ok(requests.length >= 3); assert.ok(requests.every(request => !request.cookie && !request.authorization));
  const report={checkedAt:new Date().toISOString(),result:'passed',groups:checks.length,checks,version:metadata.version,fixtureVersion:nextVersion,transport:'Real electron-updater 6.8.x NSIS check/download/hash; synthetic loopback manifest and bytes; actual App/preload/trusted IPC; installer launch recorded only',requests:requests.length,credentialHeaders:0,realInstallations:0};
  writeFileSync(path.join(root,'research/updates-native-checks.json'),JSON.stringify(report,null,2)+'\n'); console.log('UPDATES_NATIVE_PASS',JSON.stringify({groups:checks.length,requests:requests.length,realInstallations:0}));
} catch (error) {
  if (desktop) {
    const page = await desktop.firstWindow();
    console.error('UPDATER_TEST_STATE', JSON.stringify(await page.evaluate(() => window.coolapk.updates('info'))));
    console.error('UPDATER_TEST_REQUESTS', JSON.stringify(requests));
  }
  throw error;
} finally { if(desktop)await desktop.close();for(const timer of timers)clearInterval(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
