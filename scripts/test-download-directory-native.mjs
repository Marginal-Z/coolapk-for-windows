// Actual built App/preload/main/download-manager. Only business reads and the
// native folder dialog result are synthetic. No APK network transfer or install.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import electron from 'electron';
import playwright from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), directory = path.join(root, '.local/download-directory-native');
mkdirSync(directory, { recursive: true }); const userData = mkdtempSync(path.join(directory, 'userdata-')), oldFolder = path.join(userData, '酷安下载'), selected = path.join(userData, 'custom-downloads');
mkdirSync(oldFolder); mkdirSync(selected); const bytes = Buffer.from([80, 75, 3, 4, 10, 20, 30, 40]), fileName = 'synthetic-existing.apk', oldFile = path.join(oldFolder, fileName), id = randomUUID();
writeFileSync(oldFile, bytes); const stat = statSync(oldFile);
const record = { id, request: { packageName: 'com.example.synthetic' }, title: '隔离历史安装包', versionCode: '30', versionName: '3.0', fileName, status: 'completed', downloaded: bytes.length, total: bytes.length, verified: true, sha256: createHash('sha256').update(bytes).digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs, createdAt: Date.now(), updatedAt: Date.now() };
const legacyFile = path.join(oldFolder, '.coolapk-downloads.json'), stateFile = path.join(userData, 'app-downloads.json'); writeFileSync(legacyFile, JSON.stringify([record]));
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: packageMetadata.name, version: packageMetadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(directory, 'bootstrap.cjs'), `const {app,session,dialog,ipcMain}=require('electron');
globalThis.downloadDirectoryNative={calls:[],outcome:'chosen',selected:${JSON.stringify(selected)},blockedNetwork:0};
dialog.showOpenDialog=async(parent,options)=>{const mock=globalThis.downloadDirectoryNative;mock.calls.push({parentId:parent?.id,options});return mock.outcome==='cancel'?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[mock.selected]}};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,reply)=>{globalThis.downloadDirectoryNative.blockedNetwork++;reply({cancel:true})}));
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>{if(channel==='coolapk:call')return handle(channel,(_,operation)=>({ok:true,data:{data:operation==='home'?[{entityType:'feed',id:'719',uid:'777',username:'下载测试作者',message:'隔离下载目录验收'}]:[],hasMore:false}}));return handle(channel,fn)};
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const env = { ...process.env, COOLAPK_TEST_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE; delete env.COOLAPK_DEV_URL;
let desktop; const checks = [], errors = [];
async function check(name, work) { await work(); checks.push(name); console.log('PASS', name); }
async function launch() {
  desktop = await playwright._electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 });
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.locator('[data-feed-id="719"]').waitFor();
  await page.locator('.sidebar').getByRole('button', { name: '应用下载', exact: true }).click(); await page.getByText('隔离历史安装包', { exact: true }).waitFor(); return page;
}
const saved = () => JSON.parse(readFileSync(stateFile, 'utf8'));
try {
  let page = await launch();
  await check('real main imports legacy history once and retains the completed APK in its original folder', async () => {
    const result = await page.evaluate(() => window.coolapk.downloads('list')); assert.equal(result.ok, true); assert.equal(result.data.tasks[0].id, id); assert.equal(path.normalize(result.data.tasks[0].directory), path.normalize(oldFolder));
    assert.equal(saved().version, 1); assert.equal(saved().tasks[0].id, id); assert.deepEqual(readFileSync(oldFile), bytes); assert.equal(JSON.parse(readFileSync(legacyFile, 'utf8')).length, 1);
  });
  await check('real preload rejects renderer supplied paths without invoking a native folder picker', async () => {
    for (const args of [{ directory: selected }, { path: selected }, { filePaths: [selected] }]) { const result = await page.evaluate(args => window.coolapk.downloads('chooseDirectory', args), args); assert.equal(result.ok, false); assert.equal(result.error.code, 'INPUT'); }
    assert.equal(await desktop.evaluate(() => globalThis.downloadDirectoryNative.calls.length), 0);
  });
  await check('actual download page selects through the parented native dialog and shows old task location', async () => {
    await page.getByRole('button', { name: '更改保存位置', exact: true }).click(); await page.locator('.download-directory span').getByText(selected, { exact: true }).waitFor();
    await page.locator(`[data-download-id="${id}"] .download-task-directory`).waitFor();
    const calls = await desktop.evaluate(({ BrowserWindow }) => ({ calls: globalThis.downloadDirectoryNative.calls, mainId: BrowserWindow.getAllWindows()[0].id }));
    assert.equal(calls.calls[0].parentId, calls.mainId); assert.deepEqual(calls.calls[0].options.properties, ['openDirectory', 'createDirectory', 'dontAddToRecent']); assert.equal(path.normalize(saved().directory), path.normalize(selected)); assert.equal(path.normalize(saved().tasks[0].directory), path.normalize(oldFolder));
    assert.deepEqual(readFileSync(oldFile), bytes); assert.deepEqual(readdirSync(selected), []); await page.screenshot({ path: path.join(directory, 'selected-directory.png') });
  });
  await check('native cancellation leaves persisted configuration and task identities intact', async () => {
    const before = readFileSync(stateFile, 'utf8'); await desktop.evaluate(() => { globalThis.downloadDirectoryNative.outcome = 'cancel'; });
    const result = await page.evaluate(() => window.coolapk.downloads('chooseDirectory')); assert.equal(result.ok, true); assert.equal(result.data.canceled, true); assert.equal(result.data.changed, false); assert.equal(readFileSync(stateFile, 'utf8'), before);
  });
  await check('a second native window cannot use the trusted main window directory picker capability', async () => {
    const before = await desktop.evaluate(() => globalThis.downloadDirectoryNative.calls.length);
    const result = await desktop.evaluate(async ({ BrowserWindow }, files) => { const window = new BrowserWindow({ show: false, webPreferences: { preload: files.preload, contextIsolation: true, sandbox: true, nodeIntegration: false } }); try { await window.loadFile(files.index); return await window.webContents.executeJavaScript("window.coolapk.downloads('chooseDirectory')"); } finally { window.destroy(); } }, { preload: path.join(root, 'electron/preload.cjs'), index: path.join(root, 'dist/index.html') });
    assert.equal(result.ok, false); assert.match(result.error.message, /Untrusted caller/); assert.equal(await desktop.evaluate(() => globalThis.downloadDirectoryNative.calls.length), before);
  });
  await desktop.close(); desktop = null; page = await launch();
  await check('actual main restart restores custom directory and old history; delete keeps the original APK', async () => {
    await page.locator('.download-directory span').getByText(selected, { exact: true }).waitFor(); await page.locator(`[data-download-id="${id}"] .download-task-directory`).waitFor();
    await page.locator(`[data-download-id="${id}"]`).getByRole('button', { name: '删除记录', exact: true }).click(); await page.getByText('还没有下载任务', { exact: true }).waitFor(); assert.deepEqual(readFileSync(oldFile), bytes); assert.deepEqual(saved().tasks, []);
  });
  await desktop.close(); desktop = null;
  desktop = await playwright._electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 }); page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.locator('[data-feed-id="719"]').waitFor(); await page.locator('.sidebar').getByRole('button', { name: '应用下载', exact: true }).click();
  await check('deleted records stay deleted across a further actual restart despite the untouched legacy history', async () => {
    await page.getByText('还没有下载任务', { exact: true }).waitFor(); assert.deepEqual((await page.evaluate(() => window.coolapk.downloads('list'))).data.tasks, []); assert.equal(JSON.parse(readFileSync(legacyFile, 'utf8')).length, 1); assert.deepEqual(readFileSync(oldFile), bytes);
  });
  assert.deepEqual(errors, []); writeFileSync(path.join(root, 'research/download-directory-native-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'Actual built App, sandboxed preload, trusted main IPC and DownloadManager; only business reads and native directory dialog selections mocked; external requests blocked; synthetic existing APK bytes only; no phone or installer actions', checks, errors }, null, 2) + '\n');
} finally { await desktop?.close(); }
