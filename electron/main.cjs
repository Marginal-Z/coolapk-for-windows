const { app, BrowserWindow, ipcMain, Menu, shell, session, safeStorage, protocol, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { AccountScope } = require('./request-scope.cjs');
const { OfficialLoginFlow } = require('./login-flow.cjs');
let main, loginWindow, store, client, openingLogin;
const accountScope = new AccountScope();
const verificationRequests = new Map();
const verifiedResponses = new Map();
const verificationWindows = new Set();
protocol.registerSchemesAsPrivileged([{ scheme: 'coolapk-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const projectRoot = path.resolve(__dirname, '..');
const devUrl = process.env.COOLAPK_DEV_URL;
if (devUrl && !/^http:\/\/127\.0\.0\.1:5173\/?$/.test(devUrl)) throw new Error('Invalid dev origin');
if (process.env.COOLAPK_TEST_DATA) { app.setPath('userData', path.resolve(process.env.COOLAPK_TEST_DATA)); app.disableHardwareAcceleration(); }
app.setName('酷安桌面端');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });

function trusted(event) { if (!main || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('Untrusted caller'); }
function handler(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { try { trusted(event); return { ok: true, data: await fn(...args) }; } catch (error) { return { ok: false, error: { message: error.message, code: error.code || 'APP_ERROR', ...(error.verificationId ? { verificationId: error.verificationId } : {}) } }; } }); }
function syncAccount() { const account = store.current(); client.cookie = account?.cookie || ''; client.identity = account; }
function notifyAccount() { accountScope.changed(); syncAccount(); verificationRequests.clear(); verifiedResponses.clear(); for (const window of verificationWindows) if (!window.isDestroyed()) window.close(); if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close(); main?.webContents.send('coolapk:account', { ok: true, data: store.publicState() }); }
function safeExternal(value) { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持 HTTP / HTTPS 链接'); return url.toString(); }
const requestKey = (operation, args, context) => {
  let keyArgs = args || {};
  if (operation === 'uploadImage') {
    if (!args?.bytes || args.bytes.length > 20 * 1024 * 1024) throw new Error('图片数据无效');
    keyArgs = { digest: createHash('sha256').update(Buffer.from(args.bytes)).digest('hex'), width: args.width, height: args.height, dir: args.dir, toUid: args.toUid };
  }
  return JSON.stringify([context.epoch, context.client.identity?.uid || '', operation, keyArgs]);
};
async function callApi(operation, args) {
  const context = accountScope.capture(client);
  const key = requestKey(operation, args, context);
  const cached = verifiedResponses.get(key);
  if (cached) { verifiedResponses.delete(key); if (cached.deadline > Date.now()) return cached.result; }
  try { const result = await context.client.dispatch(operation, args); accountScope.assert(context); return result; }
  catch (error) {
    accountScope.assert(context);
    if (error.detail?.challenge) {
      const verificationId = randomUUID();
      verificationRequests.set(verificationId, { operation, args, challenge: error.detail.challenge, context, deadline: Date.now() + 300000 });
      if (verificationRequests.size > 30) verificationRequests.delete(verificationRequests.keys().next().value);
      error.verificationId = verificationId;
    }
    throw error;
  }
}
async function verifyRequest(id) {
  const request = verificationRequests.get(id);
  if (!request || request.deadline < Date.now()) throw new Error('验证请求已过期，请刷新内容');
  accountScope.assert(request.context);
  const nonce = randomUUID();
  const verifier = new BrowserWindow({ title: '酷安安全验证', width: 430, height: 580, resizable: false, parent: main, modal: true, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'verify-preload.cjs'), additionalArguments: ['--verification-id=' + nonce], partition: 'coolapk-verification', contextIsolation: true, nodeIntegration: false, sandbox: true } });
  verificationWindows.add(verifier); verifier.once('closed', () => verificationWindows.delete(verifier));
  verifier.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  verifier.webContents.on('will-navigate', event => event.preventDefault());
  verifier.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
  verifier.webContents.session.setPermissionCheckHandler(() => false);
  const validation = new Promise((resolve, reject) => {
    let finished = false;
    const done = (error, value) => { if (finished) return; finished = true; ipcMain.removeListener('coolapk:verified', receive); clearTimeout(timer); error ? reject(error) : resolve(value); };
    const receive = (event, receivedNonce, value) => {
      if (event.sender !== verifier.webContents || event.senderFrame !== verifier.webContents.mainFrame || receivedNonce !== nonce) return;
      if (typeof value !== 'string' || value.length > 8192 || !value.startsWith(`NEC:${request.challenge.id.slice(0, 8)}:`)) done(new Error('验证已取消或凭证无效'));
      else done(null, value);
    };
    const timer = setTimeout(() => { done(new Error('验证已超时，请重试')); verifier.close(); }, 300000);
    ipcMain.on('coolapk:verified', receive);
    verifier.once('closed', () => done(new Error('已取消验证')));
  });
  // Attach a rejection handler before loading the page so an early close cannot become unhandled.
  validation.catch(() => {});
  try {
    await verifier.loadFile(path.join(__dirname, 'verify.html'), { query: { captcha: request.challenge.id } });
    const token = await validation;
    accountScope.assert(request.context);
    const verifiedClient = request.context.client;
    verifiedClient.verification = { token, field: request.challenge.field };
    const result = await verifiedClient.dispatch(request.operation, request.args);
    accountScope.assert(request.context);
    verifiedResponses.set(requestKey(request.operation, request.args, request.context), { result, deadline: Date.now() + 30000 });
    verificationRequests.delete(id); return { verified: true };
  } finally { if (!verifier.isDestroyed()) verifier.close(); }
}

async function importCookie(value) {
  const { sanitizeCookie, assertLogin } = await import('../core/client.mjs');
  const context = accountScope.capture(client);
  const cookie = sanitizeCookie(value);
  if (!/(?:^|;\s*)(SESSID|token)=([^;\s]+)/i.test(cookie)) throw new Error('Cookie 中缺少有效的 SESSID 或 token');
  const result = await context.client.request('/v6/account/checkLoginInfo', { checkInit: 1 }, { cookie });
  accountScope.assert(context);
  assertLogin(result.data); store.add(result.data, cookie); notifyAccount(); return store.publicState();
}

async function openLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return { opened: true }; }
  if (openingLogin) return openingLogin;
  openingLogin = createLoginWindow().finally(() => { openingLogin = null; });
  return openingLogin;
}
async function createLoginWindow() {
  const loginSession = session.fromPartition('coolapk-official-login');
  await loginSession.clearStorageData();
  const window = new BrowserWindow({ title: '酷安官方登录', width: 520, height: 740, parent: main, autoHideMenuBar: true, webPreferences: { partition: 'coolapk-official-login', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  loginWindow = window;
  const context = accountScope.capture(client);
  loginSession.setPermissionRequestHandler((_, __, cb) => cb(false));
  loginSession.setPermissionCheckHandler(() => false);
  const allowedNavigation = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'coolapk.com' || u.hostname.endsWith('.coolapk.com') || u.hostname === 'open.weixin.qq.com'); } catch { return false; } };
  const isActive = () => loginWindow === window && !window.isDestroyed() && context.epoch === accountScope.epoch;
  const { assertLogin } = await import('../core/client.mjs');
  const flow = new OfficialLoginFlow({
    getCookies: () => loginSession.cookies.get({}),
    exchange: (code, cookie) => context.client.request('/v6/account/accessToken', { code }, { cookie }),
    checkLogin: cookie => context.client.request('/v6/account/checkLoginInfo', { checkInit: 1 }, { cookie }),
    assertIdentity: assertLogin,
    isActive,
    commit: (identity, cookie) => { store.add(identity, cookie); notifyAccount(); if (!window.isDestroyed()) window.close(); },
  });
  const complete = value => { void flow.complete(value).catch(error => { if (isActive()) main?.webContents.send('coolapk:account', { ok: false, error: { message: error.message, code: error.code || 'LOGIN_ERROR' } }); }); };
  const cookieChanged = () => complete();
  loginSession.cookies.on('changed', cookieChanged);
  window.webContents.setWindowOpenHandler(({ url }) => { if (allowedNavigation(url)) void window.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); complete(url); });
  window.webContents.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); complete(url); });
  window.webContents.on('did-navigate', (_, url) => complete(url));
  window.webContents.on('did-navigate-in-page', (_, url) => complete(url));
  window.on('closed', () => { loginSession.cookies.removeListener('changed', cookieChanged); if (loginWindow === window) loginWindow = null; });
  const loginUrl = new URL('https://account.coolapk.com/auth/login');
  loginUrl.search = new URLSearchParams({ type: 'coolapk', forward: 'https://www.coolapk.com/auth_callback' }).toString();
  try { await window.loadURL(loginUrl.toString()); return { opened: true }; }
  catch { if (!window.isDestroyed()) window.close(); throw new Error('官方登录页面加载失败，请检查网络后重试'); }
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  const { CoolapkClient } = await import('../core/client.mjs');
  const { AccountStore } = await import('../core/account-store.mjs');
  const { fetchImage } = await import('../core/images.mjs');
  const imageCache = new Map(); let imageCacheSize = 0;
  protocol.handle('coolapk-image', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'image') return new Response('', { status: 400 });
      const target = url.searchParams.get('url');
      let result = imageCache.get(target);
      if (!result) { result = await fetchImage(target); imageCache.set(target, result); imageCacheSize += result.body.length; while (imageCacheSize > 48 * 1024 * 1024 && imageCache.size > 1) { const oldest = imageCache.keys().next().value; imageCacheSize -= imageCache.get(oldest).body.length; imageCache.delete(oldest); } }
      return new Response(result.body, { headers: { 'Content-Type': result.type, 'Cache-Control': 'max-age=3600' } });
    } catch { return new Response('', { status: 502 }); }
  });
  store = new AccountStore(app.getPath('userData'), safeStorage);
  if (!store.loadError && !fs.existsSync(store.path)) store.save();
  client = new CoolapkClient({ deviceCode: store.state.deviceCode }); syncAccount();
  main = new BrowserWindow({ title: '酷安桌面端 · 非官方客户端', width: 1360, height: 920, minWidth: 900, minHeight: 620, backgroundColor: '#f5f7f8', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', event => event.preventDefault());
  main.webContents.on('context-menu', (_, params) => {
    const template = [];
    if (params.isEditable) template.push({ role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' });
    else if (params.selectionText) template.push({ role: 'copy', label: '复制所选文字' });
    if (params.linkURL) { try { const url = safeExternal(params.linkURL); template.push({ label: '复制链接', click: () => clipboard.writeText(url) }, { label: '用浏览器打开', click: () => shell.openExternal(url) }); } catch {} }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: main });
  });
  main.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
  main.webContents.session.setPermissionCheckHandler(() => false);
  handler('coolapk:call', callApi);
  handler('coolapk:accounts', () => store.publicState());
  handler('coolapk:login', openLogin);
  handler('coolapk:import', importCookie);
  handler('coolapk:verify', verifyRequest);
  handler('coolapk:select', uid => { const result = store.select(String(uid)); notifyAccount(); return result; });
  handler('coolapk:remove', uid => { const result = store.remove(String(uid)); notifyAccount(); return result; });
  handler('coolapk:external', value => shell.openExternal(safeExternal(value)));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '酷安', submenu: [{ label: '搜索', accelerator: 'CmdOrCtrl+K', click: () => main.webContents.send('coolapk:command', 'search') }, { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => main.webContents.send('coolapk:command', 'refresh') }, { label: '返回', accelerator: 'Alt+Left', click: () => main.webContents.send('coolapk:command', 'back') }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  if (devUrl) await main.loadURL(devUrl); else await main.loadFile(path.join(projectRoot, 'dist/index.html'));
  main.show();
  if (process.argv.includes('--smoke')) {
    setTimeout(async () => {
      try {
        const result = await main.webContents.executeJavaScript(`({title:document.title,bridge:!!window.coolapk,feeds:document.querySelectorAll('[data-feed-id]').length,error:document.querySelector('[role="alert"]')?.textContent,scrollWidth:document.documentElement.scrollWidth,width:innerWidth})`);
        const target = path.join(projectRoot, '.local', 'desktop-smoke.png');
        const capture = await main.webContents.capturePage();
        if (!capture.isEmpty()) fs.writeFileSync(target, capture.toPNG());
        result.screenshotCaptured = !capture.isEmpty();
        console.log('DESKTOP_SMOKE', JSON.stringify(result));
        fs.writeFileSync(path.join(projectRoot, 'research', 'desktop-smoke.json'), JSON.stringify(result, null, 2));
        app.exit(result.bridge && result.feeds > 0 && !result.error ? 0 : 1);
      } catch (error) { console.error(error.message); app.exit(1); }
    }, 10000);
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
