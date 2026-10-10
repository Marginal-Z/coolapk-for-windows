// Actual main/preload/App, real local encryption and policy. Only API responses,
// foreground activity and time are synthetic; no phone or external account writes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import electron from 'electron';
import { _electron } from 'playwright';

const root = process.cwd(), directory = path.join(root, '.local/teenager-native');
mkdirSync(directory, { recursive: true });
const data = mkdtempSync(path.join(directory, 'userdata-'));
const env = { ...process.env, COOLAPK_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(directory, 'bootstrap.cjs'), `const {app,session,BrowserWindow}=require('electron');
globalThis.teenTest={now:new Date(2030,4,1,12).getTime(),calls:[],images:[],blockedNetwork:0};
Date.now=()=>globalThis.teenTest.now;
BrowserWindow.prototype.isFocused=()=>true;BrowserWindow.prototype.isMinimized=()=>false;
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,reply)=>{globalThis.teenTest.blockedNetwork++;reply({cancel:true})}));
import(${JSON.stringify(pathToFileURL(path.join(root, 'core/client.mjs')).href)}).then(({CoolapkClient})=>{
CoolapkClient.prototype.request=async function(endpoint,query={},options={}){
globalThis.teenTest.calls.push({endpoint,query,method:options.method||'GET',form:options.form,guest:!this.cookie&&!this.identity});
if(endpoint.endsWith('/checkLoginInfo'))return{data:{uid:'98765',username:'隔离青少年测试账号',userAvatar:''}};
if(endpoint==='/v6/page/dataList'&&query.url==='V12_TEENAGER')return{data:[{entityType:'feed',id:'451',message:'仅限精选正文',pic:'https://image.coolapk.com/curated.png'}],hasMore:false};
if(endpoint==='/v6/feed/detail')return{data:{entityType:'feed',id:query.id,message:'精选详情正文',pic:'https://image.coolapk.com/curated-detail.png'}};
return{data:[]};};});
import(${JSON.stringify(pathToFileURL(path.join(root, 'core/public-image-cache.mjs')).href)}).then(({PublicImageCache})=>{PublicImageCache.prototype.read=async function(target){globalThis.teenTest.images.push(target);return{body:Buffer.from('isolated image'),type:'image/png'}}});
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const checks = [], errors = [];
let desktop;
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
const launch = async () => { desktop = await _electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 }); const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message)); return page; };
try {
  let page = await launch();
  await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).waitFor();
  await record('real encrypted account storage is populated only with an isolated synthetic identity', async () => {
    const result = await page.evaluate(() => window.coolapk.importCookie('SESSID=isolated-teenager-test'));
    assert.equal(result.ok, true); await page.locator('.account-entry').getByText('隔离青少年测试账号', { exact: true }).waitFor();
  });
  await record('the actual settings setup enables mode, exits the current identity and renders only curated content', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^青少年模式/ }).click();
    await page.getByRole('button', { name: '开启青少年模式', exact: true }).click();
    await page.getByLabel('设置四位密码', { exact: true }).fill('2468'); await page.getByLabel('再次输入密码', { exact: true }).fill('2468');
    await page.getByRole('button', { name: '确认开启', exact: true }).click(); await page.getByText('仅限精选正文', { exact: true }).waitFor();
    assert.equal(await page.locator('.sidebar').count(), 0); assert.equal(await page.getByLabel('搜索酷安', { exact: true }).count(), 0);
    const calls = await desktop.evaluate(() => globalThis.teenTest.calls.filter(row => row.query.url === 'V12_TEENAGER'));
    assert.ok(calls.length); assert.ok(calls.every(row => row.guest && row.method === 'GET'));
  });
  await record('every ordinary privileged preload entry is rejected by the actual main guard before side effects', async () => {
    const replies = await page.evaluate(async () => {
      const api = window.coolapk;
      return Promise.all([api.call('feedCreate', { message: 'must never send' }), api.accounts(), api.login(), api.importCookie('SESSID=synthetic'), api.selectAccount('98765'), api.removeAccount('98765'), api.verify('synthetic'), api.openExternal('https://www.coolapk.com'), api.openAccountPage('privacy'), api.report({ type: 'feed', id: '451' }), api.desktop('info'), api.updates('info'), api.saveImage({}), api.shareImageData({}), api.saveExport({}), api.downloads('list'), api.background('choose')]);
    });
    assert.equal(replies.length, 17); assert.ok(replies.every(reply => !reply.ok && reply.error.code === 'TEENAGER_RESTRICTED'));
    assert.equal((await desktop.evaluate(() => globalThis.teenTest.calls)).some(row => row.endpoint.endsWith('/createFeed')), false);
  });
  await record('only source IDs and image URLs can be opened; the real protocol denies arbitrary CDN images', async () => {
    const arbitrary = await page.evaluate(() => window.coolapk.teenager('detail', { id: '452' })); assert.equal(arbitrary.ok, false);
    await page.locator('.teenager-card button').click(); await page.getByText('精选详情正文', { exact: true }).waitFor();
    const detail = await desktop.evaluate(() => globalThis.teenTest.calls.find(row => row.endpoint.endsWith('/feed/detail')));
    assert.equal(detail.guest, true); assert.equal(detail.method, 'POST'); assert.deepEqual(detail.form, { trace: '' });
    const status = await desktop.evaluate(async ({ net }) => (await net.fetch('coolapk-image://image/?url=' + encodeURIComponent('https://image.coolapk.com/unlisted.png'))).status);
    assert.equal(status, 403); assert.equal((await desktop.evaluate(() => globalThis.teenTest.images)).includes('https://image.coolapk.com/unlisted.png'), false);
    const backgroundStatus = await desktop.evaluate(async ({ net }) => (await net.fetch('coolapk-background://local/' + 'a'.repeat(64))).status);
    assert.equal(backgroundStatus, 403);
    await page.getByRole('button', { name: '返回精选', exact: true }).click();
  });
  await record('wrong PIN remains enabled; changing the PIN requires the original verification', async () => {
    await page.getByRole('button', { name: '关闭模式', exact: true }).click(); await page.getByLabel('当前四位密码', { exact: true }).fill('1111'); await page.getByRole('button', { name: '确认关闭', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '密码' }).waitFor(); assert.equal((await page.evaluate(() => window.coolapk.teenager('info'))).data.enabled, true);
    await page.getByRole('dialog', { name: '关闭青少年模式', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '修改青少年密码', exact: true }).click(); await page.getByLabel('当前四位密码', { exact: true }).fill('2468'); await page.getByLabel('新的四位密码', { exact: true }).fill('8642'); await page.getByLabel('确认新的密码', { exact: true }).fill('8642'); await page.getByRole('button', { name: '保存密码', exact: true }).click();
    await page.getByRole('dialog', { name: '修改青少年密码', exact: true }).waitFor({ state: 'hidden' });
    const recordBytes = readFileSync(path.join(data, 'teenager-mode.v1')); assert.equal(recordBytes.includes(Buffer.from('8642')), false); assert.equal(recordBytes.includes(Buffer.from('verifier')), false);
  });
  await record('forty-minute and night restrictions are enforced in main and clear rendered content', async () => {
    await desktop.evaluate(() => { globalThis.teenTest.now += 40 * 60 * 1000; });
    const exhausted = await page.evaluate(() => window.coolapk.teenager('info')); assert.equal(exhausted.data.reason, 'daily_limit'); await page.getByRole('heading', { name: '今日使用时间已结束', exact: true }).waitFor();
    assert.equal(await page.locator('.teenager-card').count(), 0); assert.equal((await page.evaluate(() => window.coolapk.teenager('content'))).error.code, 'TEENAGER_RESTRICTED');
    await desktop.evaluate(() => { globalThis.teenTest.now = new Date(2030, 4, 1, 22).getTime(); }); assert.equal((await page.evaluate(() => window.coolapk.teenager('info'))).data.reason, 'night'); await page.getByRole('heading', { name: '夜间休息时间', exact: true }).waitFor();
    await desktop.evaluate(() => { globalThis.teenTest.now = new Date(2030, 4, 2, 6).getTime(); }); const reset = await page.evaluate(() => window.coolapk.teenager('info')); assert.equal(reset.data.reason, null); assert.equal(reset.data.usedMilliseconds, 0); await page.getByText('仅限精选正文', { exact: true }).waitFor();
  });
  await desktop.close(); desktop = undefined;
  await record('encrypted mode survives a process restart without mounting the ordinary app or reading account content', async () => {
    page = await launch(); await page.getByLabel('青少年精选内容', { exact: true }).waitFor();
    assert.equal(await page.locator('.sidebar').count(), 0); assert.ok((await desktop.evaluate(() => globalThis.teenTest.calls)).every(row => row.query.url === 'V12_TEENAGER'));
  });
  await record('verified exit returns to guest mode and does not silently restore the stored account', async () => {
    await page.getByRole('button', { name: '关闭模式', exact: true }).click(); await page.getByLabel('当前四位密码', { exact: true }).fill('8642'); await page.getByRole('button', { name: '确认关闭', exact: true }).click();
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).waitFor();
    const accounts = await page.evaluate(() => window.coolapk.accounts()); assert.equal(accounts.ok, true); assert.equal(accounts.data.current, null); assert.equal(accounts.data.accounts.length, 1);
    assert.equal((await page.evaluate(() => window.coolapk.teenager('info'))).data.enabled, false);
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/teenager-native-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'Actual built main/preload/App, Windows safeStorage and disk persistence; isolated synthetic API responses, main-process clock and foreground activity; external requests blocked before startup; no actual account or phone writes', checks, errors }, null, 2) + '\n');
  console.log(`Teenager native: ${checks.length} groups passed`);
} finally { await desktop?.close(); }
