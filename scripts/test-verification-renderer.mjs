// Production captcha HTML/JS/preload in a fresh sandboxed Electron window.
// Default mode substitutes the SDK and never connects to external services.
// --live loads the official SDK/challenge only; it never solves a captcha.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';

const root = resolve('.'), directory = join(root, '.local', 'verification-renderer-check');
mkdirSync(directory, { recursive: true });
const userData = mkdtempSync(join(directory, 'userdata-'));
const entry = join(directory, 'entry.cjs');
writeFileSync(entry, `const{app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',process.env.COOLAPK_VERIFICATION_TEST_DATA);app.disableHardwareAcceleration();globalThis.verificationResults={complete:0,cancel:0,validPrefix:true};ipcMain.on('coolapk:verified',(event,nonce,value)=>{if(event.sender!==globalThis.verificationWindow?.webContents||event.senderFrame!==globalThis.verificationWindow.webContents.mainFrame||nonce!=='synthetic-renderer-check')return;if(value==='')globalThis.verificationResults.cancel++;else{globalThis.verificationResults.complete++;globalThis.verificationResults.validPrefix&&=/^NEC:[a-f0-9]{8}:.+/.test(value);}});app.whenReady().then(()=>{new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}}).loadURL('about:blank')});`);
const env = { ...process.env, COOLAPK_VERIFICATION_TEST_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [entry], env, timeout: 30000 });
const live = process.argv.includes('--live'), checks = [];
const fixtureId = '1234567890abcdef1234567890abcdef';
const publicHost = host => host.endsWith('.nstool.netease.com') ? '*.nstool.netease.com' : host;
const publicPath = url => url.hostname === 'necaptcha.nosdn.127.net' ? '/<challenge-image>' + (url.pathname.match(/\.(png|jpe?g|webp)$/i)?.[0] || '') : url.pathname;
const fixtureSdk = `window.__captchaFixture={runs:[],destroyed:0,refreshed:0};window.initNECaptcha=(options,onload,onerror)=>{new Function('return true')();const state=window.__captchaFixture;const instance={destroy(){state.destroyed++},refresh(){state.refreshed++}};state.runs.push({options,onload,onerror,instance});const button=document.createElement('button');button.textContent='合成验证码组件';document.querySelector('#captcha').append(button);onload(instance);};`;
let page;
async function open(sdk = fixtureSdk, captcha = fixtureId, clock = false) {
  if (page) await page.close();
  const opened = desktop.waitForEvent('window');
  await desktop.evaluate(({ BrowserWindow }, root) => {
    globalThis.verificationResults = { complete: 0, cancel: 0, validPrefix: true };
    globalThis.verificationWindow = new BrowserWindow({ show: false, width: 430, height: 580, webPreferences: { preload: root + '/electron/verify-preload.cjs', additionalArguments: ['--verification-id=synthetic-renderer-check'], partition: 'verification-renderer-check', contextIsolation: true, nodeIntegration: false, sandbox: true } });
    globalThis.verificationWindow.loadURL('about:blank');
  }, root);
  page = await opened;
  if (!live) {
    await page.route('https://**/*', route => route.request().url().startsWith('https://cstaticdun.126.net/load.min.js') && sdk !== null ? route.fulfill({ contentType: 'text/javascript', body: sdk }) : route.abort());
  }
  if (clock) await page.clock.install();
  await desktop.evaluate(async (_, { root, captcha }) => { await globalThis.verificationWindow.loadFile(root + '/electron/verify.html', { query: { captcha } }); }, { root, captcha });
  return page;
}
const result = () => desktop.evaluate(() => globalThis.verificationResults);
const ready = () => page.evaluate(() => { const run = window.__captchaFixture.runs.at(-1); run.options.onReady(run.instance); });
const record = async (name, run) => { await run(); checks.push(name); console.log('PASS', name); };

try {
  await desktop.firstWindow();
  if (live) {
    const { CoolapkClient } = await import(pathToFileURL(join(root, 'core/client.mjs')).href);
    const { createDeviceCode } = await import(pathToFileURL(join(root, 'core/auth.mjs')).href);
    const client = new CoolapkClient({ deviceCode: createDeviceCode('synthetic-captcha-renderer-live-check') });
    const home = await client.dispatch('home');
    const feed = home.data.find(item => item.entityType === 'feed' && Number(item.replynum) > 0);
    let challenge;
    try { await client.dispatch('replies', { id: String(feed.id), sort: 'lastupdate_desc' }); }
    catch (error) { challenge = error.detail?.challenge; }
    assert.ok(challenge, 'A real official guest challenge is required for the live renderer check');
    const opened = desktop.waitForEvent('window');
    await desktop.evaluate(({ BrowserWindow }, root) => { globalThis.verificationWindow = new BrowserWindow({ show: false, width: 430, height: 580, webPreferences: { preload: root + '/electron/verify-preload.cjs', additionalArguments: ['--verification-id=synthetic-renderer-check'], partition: 'verification-renderer-live-check', contextIsolation: true, nodeIntegration: false, sandbox: true } }); globalThis.verificationWindow.loadURL('about:blank'); }, root);
    page = await opened;
    const requests = [], failures = [], violations = [];
    page.on('response', response => { const url = new URL(response.url()); if (url.protocol === 'https:') requests.push({ host: publicHost(url.hostname), path: publicPath(url), status: response.status() }); });
    page.on('requestfailed', request => { const url = new URL(request.url()); failures.push({ host: publicHost(url.hostname), path: publicPath(url), category: request.failure()?.errorText || 'network' }); });
    page.on('pageerror', () => violations.push('renderer_error'));
    await page.addInitScript(() => { window.__captchaCsp = []; document.addEventListener('securitypolicyviolation', event => { let host = ''; try { host = new URL(event.blockedURI).hostname; if (host.endsWith('.nstool.netease.com')) host = '*.nstool.netease.com'; } catch {} window.__captchaCsp.push({ directive: event.effectiveDirective, host, kind: event.blockedURI === 'eval' ? 'eval' : 'resource' }); }); });
    await desktop.evaluate(async (_, { root, captcha }) => { await globalThis.verificationWindow.loadFile(root + '/electron/verify.html', { query: { captcha } }); }, { root, captcha: challenge.id });
    let visible = false;
    try { await page.waitForFunction(() => document.querySelector('#error').textContent || document.querySelector('#status').textContent === '请按上方提示完成验证' && document.querySelector('#captcha').childElementCount > 0, null, { timeout: 40000 }); } catch {}
    const state = await page.evaluate(() => ({ status: document.querySelector('#status').textContent, error: document.querySelector('#error').textContent, captchaChildren: document.querySelector('#captcha').childElementCount, csp: window.__captchaCsp }));
    visible = state.status === '请按上方提示完成验证' && state.captchaChildren > 0;
    const report = { checkedAt: new Date().toISOString(), mode: 'Fresh guest challenge and official SDK in the production isolated verification page; no solving, no user identity, no social writes', componentReady: visible, state, requests, failures, errors: violations, completionCalls: (await result()).complete, officialDocs: 'https://support.dun.163.com/documents/15588062143475712?docId=294963751458885632', limitations: [visible ? 'The official component became ready in this probe; no real human verification or post-verification API acceptance is claimed.' : 'The official component did not become ready in this probe; no usability or post-verification acceptance is claimed.', 'Only public domain/path shape/status and classified errors are retained; dynamic probe host and challenge-image identifiers are redacted. No captcha ID, proof, query, cookie or user data is recorded.'] };
    writeFileSync(join(root, 'research', 'verification-renderer-live-checks.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (visible) { await desktop.evaluate(() => globalThis.verificationWindow.show()); await page.screenshot({ path: join(directory, 'official-component.png'), timeout: 5000 }); }
    assert.ok(visible, 'Official captcha component did not become ready');
    assert.equal(report.completionCalls, 0);
  } else {
    await record('SDK template evaluation is permitted only inside the isolated captcha page', async () => {
      assert.ok(readFileSync(join(root, 'electron/verify.html'), 'utf8').includes("'unsafe-eval'"));
      assert.ok(!readFileSync(join(root, 'index.html'), 'utf8').includes("'unsafe-eval'"));
      await open(); await page.waitForFunction(() => window.__captchaFixture?.runs.length === 1); await ready();
      await page.getByText('请按上方提示完成验证', { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => ({ protocol: window.__captchaFixture.runs[0].options.protocol, node: typeof window.require, bridge: Object.keys(window.verification).sort() })), { protocol: 'https', node: 'undefined', bridge: ['cancel', 'complete'] });
    });
    await record('root SDK download errors are visible and can be retried', async () => { await open(null); await page.getByText('官方验证组件下载失败，请检查网络后重新加载。', { exact: true }).waitFor(); assert.equal(await page.locator('#retry').isEnabled(), true); });
    await record('missing SDK export and invalid challenge configuration fail visibly', async () => { await open('void 0;'); await page.getByText('官方验证组件未能初始化，请重新加载。', { exact: true }).waitFor(); await open(fixtureSdk, 'invalid'); await page.getByText('验证请求配置无效，请关闭窗口后重新读取评论。', { exact: true }).waitFor(); });
    await record('SDK initialization exceptions do not leave the page permanently loading', async () => { await open('window.initNECaptcha=()=>{throw Error("synthetic error")};'); await page.getByText('官方验证组件运行失败，请重新加载；持续失败时请更新客户端。', { exact: true }).waitFor(); });
    await record('blocked SDK resources identify the client policy failure without exposing URLs', async () => { await open('window.initNECaptcha=()=>{const script=document.createElement("script");script.src="https://invalid.example/sdk.js?proof=synthetic";document.head.append(script)};'); await page.getByText('官方验证资源被客户端安全策略阻止，请更新客户端后重新加载。', { exact: true }).waitFor(); assert.ok(!(await page.locator('body').innerText()).includes('synthetic')); });
    await record('asynchronous SDK failures display a recovery action', async () => { await open('window.initNECaptcha=()=>{Promise.reject(Error("synthetic error"))};'); await page.getByText('验证码初始化失败，请重新加载；持续失败时请更新客户端。', { exact: true }).waitFor(); });
    await record('full initialization timeout covers the gap between instance creation and challenge readiness', async () => { await open(fixtureSdk, fixtureId, true); await page.waitForFunction(() => window.__captchaFixture?.runs.length === 1); await page.clock.fastForward(31000); await page.getByText('验证码加载超时，请重新加载。若持续失败，请检查网络后重新读取评论。', { exact: true }).waitFor(); assert.equal((await result()).complete, 0); });
    await record('SDK verification failure retains its official refresh flow and sends no proof', async () => { await open(); await page.waitForFunction(() => window.__captchaFixture?.runs.length === 1); await ready(); await page.evaluate(() => window.__captchaFixture.runs[0].options.onVerify(new Error('synthetic failure'))); await page.getByText('验证未通过，请按验证码提示重试；需要时可重新加载。', { exact: true }).waitFor(); assert.equal((await result()).complete, 0); assert.equal(await page.evaluate(() => window.__captchaFixture.refreshed), 0); });
    await record('reload destroys the old instance and rejects old ready and verification callbacks', async () => { await open(); await page.waitForFunction(() => window.__captchaFixture?.runs.length === 1); await ready(); await page.locator('#retry').click(); await page.waitForFunction(() => window.__captchaFixture.runs.length === 2); await page.evaluate(() => { const old = window.__captchaFixture.runs[0]; old.options.onReady(old.instance); old.options.onVerify(null, { validate: 'synthetic-old-proof' }); }); assert.equal((await result()).complete, 0); assert.ok(await page.evaluate(() => window.__captchaFixture.destroyed > 0)); await ready(); });
    await record('successful synthetic completion is emitted once and late errors cannot undo it', async () => { await page.evaluate(() => { const run = window.__captchaFixture.runs.at(-1); run.options.onVerify(null, { validate: 'synthetic-valid-proof' }); run.options.onVerify(null, { validate: 'synthetic-duplicate-proof' }); run.onerror(new Error('synthetic late error')); }); await page.getByText('验证已完成，正在继续请求…', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('#retry').disabled); assert.deepEqual(await result(), { complete: 1, cancel: 0, validPrefix: true }); });
    await record('cancellation invalidates held SDK callbacks without completing verification', async () => { await open(); await page.waitForFunction(() => window.__captchaFixture?.runs.length === 1); await page.locator('#cancel').click(); await page.evaluate(() => window.__captchaFixture.runs[0].options.onVerify(null, { validate: 'synthetic-cancelled-proof' })); assert.deepEqual(await result(), { complete: 0, cancel: 1, validPrefix: true }); });
    writeFileSync(join(root, 'research', 'verification-renderer-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'Production HTML/JS/preload in isolated Electron with a synthetic SDK and synthetic callback proofs; every external request blocked or substituted', checks, realCaptchaSolved: false, actualBackendAcceptance: false, limitations: ['Synthetic SDK callbacks exercise only the renderer lifecycle and bridge.', 'Live official component loading is a separate --live probe and is never run automatically in CI.'] }, null, 2) + '\n');
  }
} finally { await desktop.close(); }
