const { app, BrowserWindow, ipcMain, Menu, shell, session, safeStorage, protocol, clipboard, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { AccountScope } = require('./request-scope.cjs');
const { OfficialLoginFlow } = require('./login-flow.cjs');
const { PhoneBridge } = require('./phone-bridge.cjs');
const { LocalFiles } = require('./local-files.cjs');
const { DownloadManager } = require('./download-manager.cjs');
const { DesktopSettings } = require('./desktop-settings.cjs');
let main, loginWindow, store, client, openingLogin, phoneBridge, downloadManager;
const accountWindows = new Set();
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
function notifyAccount() { accountScope.changed(); downloadManager?.invalidateScope(); syncAccount(); verificationRequests.clear(); verifiedResponses.clear(); for (const window of [...verificationWindows, ...accountWindows]) if (!window.isDestroyed()) window.close(); if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close(); main?.webContents.send('coolapk:account', { ok: true, data: store.publicState() }); }
function safeExternal(value) { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持 HTTP / HTTPS 链接'); return url.toString(); }
const requestKey = (operation, args, context) => {
  let keyArgs = args || {};
  if (['uploadImage', 'accountAvatar', 'uploadVideo', 'uploadLivePhoto'].includes(operation)) {
    const limit = operation === 'uploadVideo' ? 256 : operation === 'accountAvatar' ? 15 : 20;
    if (!(args?.bytes instanceof Uint8Array) && !Array.isArray(args?.bytes) || !args.bytes.length || args.bytes.length > limit * 1024 * 1024) throw new Error('上传数据无效');
    keyArgs = { digest: createHash('sha256').update(Buffer.from(args.bytes)).digest('hex'), width: args.width, height: args.height, dir: args.dir, toUid: args.toUid };
    if (operation === 'uploadVideo') {
      if (!(args.coverBytes instanceof Uint8Array) && !Array.isArray(args.coverBytes) || !args.coverBytes.length || args.coverBytes.length > 8 * 1024 ** 2) throw new Error('视频封面无效');
      keyArgs = { ...keyArgs, coverDigest: createHash('sha256').update(Buffer.from(args.coverBytes)).digest('hex'), name: args.name, duration: args.duration };
    }
    if (operation === 'uploadLivePhoto') {
      if (!(args.videoBytes instanceof Uint8Array) && !Array.isArray(args.videoBytes) || !args.videoBytes.length || args.videoBytes.length > 64 * 1024 ** 2) throw new Error('实况视频数据无效');
      keyArgs = { ...keyArgs, videoDigest: createHash('sha256').update(Buffer.from(args.videoBytes)).digest('hex'), hdr: args.hdr };
    }
  }
  return JSON.stringify([context.epoch, context.client.identity?.uid || '', operation, keyArgs]);
};
async function callApi(operation, args) {
  const context = accountScope.capture(client);
  const key = requestKey(operation, args, context);
  const cached = verifiedResponses.get(key);
  if (cached) { verifiedResponses.delete(key); if (cached.deadline > Date.now()) return cached.result; }
  try {
    const result = await context.client.dispatch(operation, args); accountScope.assert(context);
    if (operation === 'accountProfile' && result.data && store.updatePublicIdentity(context.client.identity.uid, result.data)) { syncAccount(); main?.webContents.send('coolapk:account', { ok: true, data: store.publicState(), metadataOnly: true }); }
    return result;
  }
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

async function openAccountPage(page) {
  const routes = { username: 'https://account.coolapk.com/account/changeUsername', security: 'https://account.coolapk.com/account' };
  if (!Object.hasOwn(routes, page)) throw new Error('账号页面无效');
  const { assertLogin } = await import('../core/client.mjs'); assertLogin(client.identity);
  const context = accountScope.capture(client);
  const partition = `coolapk-account-page-${randomUUID()}`, pageSession = session.fromPartition(partition);
  const window = new BrowserWindow({ title: page === 'username' ? '酷安 · 修改昵称' : '酷安 · 账号安全', width: 580, height: 760, parent: main, autoHideMenuBar: true, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  accountWindows.add(window); window.once('closed', () => { accountWindows.delete(window); void pageSession.clearStorageData(); if (context.epoch === accountScope.epoch && main && !main.isDestroyed()) main.webContents.send('coolapk:command', 'refresh'); });
  pageSession.setPermissionRequestHandler((_, __, callback) => callback(false)); pageSession.setPermissionCheckHandler(() => false);
  const allowed = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'account.coolapk.com' || u.hostname === 'www.coolapk.com'); } catch { return false; } };
  window.webContents.setWindowOpenHandler(({ url }) => { if (allowed(url)) void window.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  try {
    for (const part of context.client.cookie.split(';')) {
      const divider = part.indexOf('='); if (divider < 1) continue;
      const name = part.slice(0, divider).trim(), value = part.slice(divider + 1).trim();
      if (/^[A-Za-z0-9_-]{1,100}$/.test(name) && value) await pageSession.cookies.set({ url: 'https://account.coolapk.com', domain: '.coolapk.com', name, value, path: '/', secure: true, httpOnly: /^(?:SESSID|token|ddid|refreshToken)$/i.test(name) });
    }
    accountScope.assert(context); if (window.isDestroyed()) throw new Error('账号页面已关闭');
    await window.loadURL(routes[page]); return { opened: true };
  } catch (error) { if (!window.isDestroyed()) window.close(); throw error; }
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
async function installDownloaded(args) {
  if (!args || typeof args.id !== 'string' || Object.keys(args).some(key => key !== 'id')) throw new Error('下载任务编号无效');
  const file = await downloadManager.completedFile(args.id);
  const status = await phoneBridge.status(), devices = status.devices.filter(device => device.state === 'device');
  if (!devices.length) throw new Error('请先连接 USB 手机，并在手机上允许调试');
  let selected = devices[0];
  if (devices.length > 1) {
    const choice = await dialog.showMessageBox(main, { type: 'question', title: '选择安装手机', message: '选择要安装此应用的 USB 手机', buttons: ['取消', ...devices.map(device => `${device.model} (${device.serial.slice(-4)})`)], defaultId: 0, cancelId: 0 });
    if (!choice.response) return { installed: false }; selected = devices[choice.response - 1];
  }
  const confirmation = await dialog.showMessageBox(main, { type: 'question', title: '安装到 USB 手机', message: `在 ${selected.model} 上安装应用？`, detail: `${file.name}\n\n将保留应用数据安装或更新。安装旧版本可能被 Android 拒绝。`, buttons: ['取消', '确认保留数据安装'], defaultId: 0, cancelId: 0 });
  if (confirmation.response !== 1) return { installed: false };
  const verifiedFile = await downloadManager.completedFile(args.id);
  const selection = await phoneBridge.registerApk(verifiedFile.path, verifiedFile.sha256);
  return phoneBridge.install(selected.serial, selection.token);
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  const { CoolapkClient } = await import('../core/client.mjs');
  const { AccountStore } = await import('../core/account-store.mjs');
  const { fetchImage } = await import('../core/images.mjs');
  const { PublicImageCache } = await import('../core/public-image-cache.mjs');
  const imageCache = new PublicImageCache(fetchImage);
  protocol.handle('coolapk-image', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'image') return new Response('', { status: 400 });
      const target = url.searchParams.get('url');
      const result = await imageCache.read(target);
      return new Response(result.body, { headers: { 'Content-Type': result.type, 'Cache-Control': 'max-age=3600' } });
    } catch { return new Response('', { status: 502 }); }
  });
  store = new AccountStore(app.getPath('userData'), safeStorage);
  if (!store.loadError && !fs.existsSync(store.path)) store.save();
  client = new CoolapkClient({ deviceCode: store.state.deviceCode }); syncAccount();
  main = new BrowserWindow({ title: '酷安桌面端 · 非官方客户端', width: 1360, height: 920, minWidth: 900, minHeight: 620, backgroundColor: '#f5f7f8', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  const desktopSettings = new DesktopSettings({ webContents: main.webContents, imageCache, version: app.getVersion() });
  main.webContents.on('zoom-changed', (_, direction) => desktopSettings.zoomBy(direction === 'in' ? 1 : -1));
  phoneBridge = new PhoneBridge({ runtimeDir: app.isPackaged ? path.join(process.resourcesPath, 'scrcpy') : path.join(projectRoot, '.local', 'tools', 'scrcpy'), userData: app.getPath('userData'), dialog, parent: () => main });
  const localFiles = new LocalFiles({ dialog, parent: () => main, fetchImage });
  const { prepareApkDownload, openApkDownload } = await import('../core/download.mjs');
  downloadManager = new DownloadManager({ directory: path.join(process.env.COOLAPK_TEST_DATA || app.getPath('downloads'), '酷安下载'), shell, captureDownload: () => {
    const scope = accountScope.capture(client);
    return async (args, { signal, resume }) => { const { data: plan } = await prepareApkDownload(scope.client, args); accountScope.assert(scope); const opened = await openApkDownload(scope.client, plan, { signal, resume }); accountScope.assert(scope); return { ...opened, assertCurrent: () => accountScope.assert(scope) }; };
  }, onChange: state => { if (main && !main.isDestroyed()) main.webContents.send('coolapk:downloads', state); } });
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
  handler('coolapk:phone', (operation, args) => phoneBridge.dispatch(operation, args));
  handler('coolapk:account-page', openAccountPage);
  handler('coolapk:desktop', (operation, args) => desktopSettings.dispatch(operation, args));
  handler('coolapk:save-image', args => localFiles.saveImage(args));
  handler('coolapk:share-image', async args => { const context = accountScope.capture(client); const result = await localFiles.shareImageData(args); accountScope.assert(context); return result; });
  handler('coolapk:save-export', args => { const context = accountScope.capture(client); return localFiles.saveExport(args, () => accountScope.assert(context)); });
  handler('coolapk:downloads', (operation, args) => operation === 'install' ? installDownloaded(args) : downloadManager.dispatch(operation, args));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '酷安', submenu: [{ label: '搜索', accelerator: 'CmdOrCtrl+K', click: () => main.webContents.send('coolapk:command', 'search') }, { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => main.webContents.send('coolapk:command', 'refresh') }, { label: '返回', accelerator: 'Alt+Left', click: () => main.webContents.send('coolapk:command', 'back') }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => desktopSettings.resetZoom() }, { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => desktopSettings.zoomBy(1) }, { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => desktopSettings.zoomBy(-1) }, { role: 'togglefullscreen' }] },
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
app.on('before-quit', () => { phoneBridge?.close(); downloadManager?.close(); });
