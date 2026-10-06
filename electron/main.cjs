const { app, BrowserWindow, ipcMain, Menu, shell, session, safeStorage, protocol, clipboard, dialog, powerMonitor, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { AccountScope } = require('./request-scope.cjs');
const { OfficialLoginFlow, OfficialLoginPageMonitor, officialLoginUrl } = require('./login-flow.cjs');
const { ReportWindowManager } = require('./report-flow.cjs');
const { TeenagerAccess } = require('./teenager-access.cjs');
const { PhoneBridge } = require('./phone-bridge.cjs');
const { LocalFiles } = require('./local-files.cjs');
const { ImageViewerManager } = require('./image-viewer.cjs');
const { DownloadManager } = require('./download-manager.cjs');
const { DesktopSettings } = require('./desktop-settings.cjs');
const { createSoftwareUpdates } = require('./software-updates.cjs');
const { BackgroundImageManager, BACKGROUND_SCHEME, createBackgroundDecoder } = require('./background-image.cjs');
let main, loginWindow, store, client, openingLogin, phoneBridge, downloadManager, softwareUpdates, reportWindows, teenagerAccess, teenagerTimer;
let confirmingUpdate = false;
let imageViewers;
const accountWindows = new Set();
const accountScope = new AccountScope();
const verificationRequests = new Map();
const verifiedResponses = new Map();
const verificationWindows = new Set();
protocol.registerSchemesAsPrivileged(['coolapk-image', BACKGROUND_SCHEME].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
const projectRoot = path.resolve(__dirname, '..');
const applicationIcon = path.join(__dirname, 'assets', 'coolapk.ico');
const devUrl = process.env.COOLAPK_DEV_URL;
if (devUrl && !/^http:\/\/127\.0\.0\.1:5173\/?$/.test(devUrl)) throw new Error('Invalid dev origin');
if (process.env.COOLAPK_TEST_DATA) { app.setPath('userData', path.resolve(process.env.COOLAPK_TEST_DATA)); app.disableHardwareAcceleration(); }
app.setName('酷安桌面端');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });

function trusted(event) { if (!main || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('Untrusted caller'); }
function handler(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { try { trusted(event); teenagerAccess?.assertChannel(channel); const epoch = teenagerAccess?.epoch; const data = await fn(...args); if (channel !== 'coolapk:teenager' && epoch !== teenagerAccess?.epoch) throw Object.assign(new Error('模式已切换，请重新打开页面'), { code: 'TEENAGER_RESTRICTED' }); return { ok: true, data }; } catch (error) { return { ok: false, error: { message: error.message, code: error.code || 'APP_ERROR', ...(error.verificationId ? { verificationId: error.verificationId } : {}) } }; } }); }
function syncAccount() { const account = store.current(); client.cookie = account?.cookie || ''; client.identity = account; }
function notifyAccount() { accountScope.changed(); client.clearVerificationCookie(); downloadManager?.invalidateScope(); reportWindows?.closeAll(); imageViewers?.closeAll(); syncAccount(); verificationRequests.clear(); verifiedResponses.clear(); for (const window of [...verificationWindows, ...accountWindows]) if (!window.isDestroyed()) window.close(); if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close(); main?.webContents.send('coolapk:account', { ok: true, data: store.publicState() }); }
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
function rememberVerification(error, operation, args, context) {
  if (!error.detail?.challenge) return;
  const verificationId = randomUUID();
  verificationRequests.set(verificationId, { operation, args, challenge: error.detail.challenge, context, deadline: Date.now() + 300000 });
  if (verificationRequests.size > 30) verificationRequests.delete(verificationRequests.keys().next().value);
  error.verificationId = verificationId;
}
async function callApi(operation, args) {
  const context = accountScope.capture(client);
  const key = requestKey(operation, args, context);
  const cached = verifiedResponses.get(key);
  if (cached) { verifiedResponses.delete(key); if (cached.deadline > Date.now()) { if (cached.error) throw cached.error; return cached.result; } }
  try {
    const result = await context.client.dispatch(operation, args); accountScope.assert(context);
    if (operation === 'accountProfile' && result.data && store.updatePublicIdentity(context.client.identity.uid, result.data)) { syncAccount(); main?.webContents.send('coolapk:account', { ok: true, data: store.publicState(), metadataOnly: true }); }
    return result;
  }
  catch (error) {
    accountScope.assert(context);
    rememberVerification(error, operation, args, context);
    throw error;
  }
}
async function verifyRequest(id) {
  const request = verificationRequests.get(id);
  if (!request || request.deadline < Date.now()) throw new Error('验证请求已过期，请刷新内容');
  accountScope.assert(request.context);
  if (request.verifying) throw new Error('此请求正在验证，请完成已打开的验证窗口');
  const nonce = randomUUID();
  const verifier = new BrowserWindow({ icon: applicationIcon, title: '酷安安全验证', width: 460, height: 620, resizable: false, parent: main, modal: true, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'verify-preload.cjs'), additionalArguments: ['--verification-id=' + nonce], partition: 'coolapk-verification-' + nonce, contextIsolation: true, nodeIntegration: false, sandbox: true } });
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
      const prefix = `NEC:${request.challenge.id.slice(0, 8)}:`;
      if (typeof value !== 'string' || value.length > 8192 || !value.startsWith(prefix) || value.length <= prefix.length || /[^\x21-\x7e]|[;\\]/.test(value)) done(new Error('验证已取消或凭证无效'));
      else done(null, value);
    };
    const timer = setTimeout(() => { done(new Error('验证已超时，请重试')); verifier.close(); }, 300000);
    ipcMain.on('coolapk:verified', receive);
    verifier.once('closed', () => done(new Error('已取消验证')));
  });
  // Attach a rejection handler before loading the page so an early close cannot become unhandled.
  validation.catch(() => {});
  request.verifying = true;
  try {
    await verifier.loadFile(path.join(__dirname, 'verify.html'), { query: { captcha: request.challenge.id } });
    const token = await validation;
    accountScope.assert(request.context);
    verificationRequests.delete(id);
    if (request.deadline < Date.now()) throw new Error('验证请求已过期，请刷新内容');
    const verifiedClient = request.context.client;
    const verifiedReader = verifiedClient.getVerificationReader(request.operation);
    // The official app keeps its validated NEC proof in an in-memory API Cookie
    // as well as the challenged POST field. Never share login Cookies with the SDK.
    verifiedReader.setVerificationCookie({ id: request.challenge.id, token });
    client.getVerificationReader(request.operation).setVerificationCookie(verifiedReader.getVerificationCookie());
    verifiedClient.verification = { token, field: request.challenge.field };
    try {
      const result = await verifiedClient.dispatch(request.operation, request.args);
      accountScope.assert(request.context);
      verifiedResponses.set(requestKey(request.operation, request.args, request.context), { result, deadline: Date.now() + 30000 });
      return { verified: true };
    } catch (error) {
      accountScope.assert(request.context);
      // Deliver the actual replay outcome to the original caller. In particular,
      // a renewed official challenge gets a fresh ID; an uncertain write must
      // reach its existing no-resend UI instead of repeating the old proof.
      rememberVerification(error, request.operation, request.args, request.context);
      verifiedResponses.set(requestKey(request.operation, request.args, request.context), { error, deadline: Date.now() + 30000 });
      return { verified: false, retryRequired: true };
    } finally { delete verifiedClient.verification; }
  } finally { request.verifying = false; if (!verifier.isDestroyed()) verifier.close(); }
}

async function importCookie(value) {
  const context = accountScope.capture(client);
  const { sanitizeCookie, assertLogin } = await import('../core/client.mjs');
  teenagerAccess?.assertChannel('coolapk:import'); accountScope.assert(context);
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
  const context = accountScope.capture(client);
  const { assertLogin } = await import('../core/client.mjs');
  teenagerAccess?.assertChannel('coolapk:account-page'); accountScope.assert(context); assertLogin(context.client.identity);
  const partition = `coolapk-account-page-${randomUUID()}`, pageSession = session.fromPartition(partition);
  const window = new BrowserWindow({ icon: applicationIcon, title: page === 'username' ? '酷安 · 修改昵称' : '酷安 · 账号安全', width: 580, height: 760, parent: main, autoHideMenuBar: true, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } });
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
  const context = accountScope.capture(client), modeEpoch = teenagerAccess?.epoch;
  const loginSession = session.fromPartition('coolapk-official-login');
  await loginSession.clearStorageData();
  // The initiating scope must survive session cleanup before a window exists.
  // A mode/account transition cannot close a window that has not been created yet.
  teenagerAccess?.assertChannel('coolapk:login'); accountScope.assert(context);
  if (modeEpoch !== teenagerAccess?.epoch) throw Object.assign(new Error('模式已切换，请重新打开页面'), { code: 'TEENAGER_RESTRICTED' });
  const window = new BrowserWindow({ icon: applicationIcon, title: '酷安官方登录', width: 520, height: 740, parent: main, autoHideMenuBar: true, webPreferences: { partition: 'coolapk-official-login', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  loginWindow = window;
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
  const pageMonitor = new OfficialLoginPageMonitor({
    getURL: () => window.webContents.getURL(),
    inspect: script => window.webContents.executeJavaScript(script),
    isActive: () => isActive() && !flow.finished,
    onBlocked: error => { if (main && !main.isDestroyed()) main.webContents.send('coolapk:account', { ok: false, error }); },
  });
  const inspectLoginPage = () => { void pageMonitor.check(); };
  window.webContents.on('did-start-navigation', (_, __, ___, isMainFrame) => { if (isMainFrame) pageMonitor.navigationStarted(); });
  window.webContents.on('dom-ready', inspectLoginPage);
  window.webContents.on('did-finish-load', inspectLoginPage);
  const cookieChanged = () => complete();
  loginSession.cookies.on('changed', cookieChanged);
  window.webContents.setWindowOpenHandler(({ url }) => { if (allowedNavigation(url)) void window.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); complete(url); });
  window.webContents.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); complete(url); });
  window.webContents.on('did-navigate', (_, url) => complete(url));
  window.webContents.on('did-navigate-in-page', (_, url) => complete(url));
  window.on('closed', () => { loginSession.cookies.removeListener('changed', cookieChanged); if (loginWindow === window) loginWindow = null; });
  try { await window.loadURL(officialLoginUrl()); return { opened: true }; }
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
  teenagerAccess.assertChannel('coolapk:downloads');
  const verifiedFile = await downloadManager.completedFile(args.id);
  teenagerAccess.assertChannel('coolapk:downloads');
  const selection = await phoneBridge.registerApk(verifiedFile.path, verifiedFile.sha256);
  teenagerAccess.assertChannel('coolapk:downloads');
  return phoneBridge.install(selected.serial, selection.token);
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  const { CoolapkClient } = await import('../core/client.mjs');
  const { AccountStore } = await import('../core/account-store.mjs');
  const { fetchImage, fetchMessageImage } = await import('../core/images.mjs');
  const { PublicImageCache } = await import('../core/public-image-cache.mjs');
  const imageCache = new PublicImageCache(fetchImage);
  const backgroundImages = new BackgroundImageManager({ directory: path.join(app.getPath('userData'), 'background'), dialog, parent: () => main, decodeImage: createBackgroundDecoder({ nativeImage, webContents: () => main?.webContents }) });
  protocol.handle(BACKGROUND_SCHEME, async request => {
    try {
      const epoch = teenagerAccess?.epoch;
      teenagerAccess?.assertChannel('coolapk:background');
      const result = await backgroundImages.read(request.url);
      teenagerAccess?.assertChannel('coolapk:background');
      if (epoch !== teenagerAccess?.epoch) return new Response('', { status: 403 });
      return result ? new Response(result.body, { headers: { 'Content-Type': result.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response('', { status: 404 });
    } catch (error) { return new Response('', { status: error.code === 'TEENAGER_RESTRICTED' ? 403 : 404 }); }
  });
  protocol.handle('coolapk-image', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'image') return new Response('', { status: 400 });
      const target = url.searchParams.get('url');
      const epoch = teenagerAccess?.assertImage(target);
      const result = await imageCache.read(target);
      teenagerAccess?.assertImage(target, epoch);
      return new Response(result.body, { headers: { 'Content-Type': result.type, 'Cache-Control': 'max-age=3600' } });
    } catch (error) { return new Response('', { status: error.code === 'TEENAGER_RESTRICTED' ? 403 : 502 }); }
  });
  store = new AccountStore(app.getPath('userData'), safeStorage);
  if (!store.loadError && !fs.existsSync(store.path)) store.save();
  client = new CoolapkClient({ deviceCode: store.state.deviceCode }); syncAccount();
  const { TeenagerStore } = await import('../core/teenager.mjs');
  const teenagerStore = new TeenagerStore({ filePath: path.join(app.getPath('userData'), 'teenager-mode.v1'), encrypt: value => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 系统加密不可用，无法保存模式设置'); return safeStorage.encryptString(value); }, decrypt: value => safeStorage.decryptString(value) });
  const publishTeenager = state => { if (main && !main.isDestroyed()) main.webContents.send('coolapk:teenager', state); };
  const resetModeScope = state => {
    try { if (state.enabled) store.select(''); }
    finally { notifyAccount(); phoneBridge?.close(); if (state.enabled) { client.identity = null; client.cookie = ''; } }
  };
  let suspended = false;
  teenagerAccess = new TeenagerAccess({ store: teenagerStore, getClient: () => client, capture: current => accountScope.capture(current), assertCurrent: context => accountScope.assert(context), beforeDisable: () => store.select(''), onTransition: state => { resetModeScope(state); teenagerAccess.setActive(!suspended && !!main && main.isFocused() && !main.isMinimized()); }, onSnapshot: publishTeenager });
  if (teenagerAccess.state().enabled) { try { resetModeScope(teenagerAccess.state()); } catch { client.identity = null; client.cookie = ''; } }
  main = new BrowserWindow({ icon: applicationIcon, title: 'Coolapk desktop', width: 1360, height: 920, minWidth: 900, minHeight: 620, backgroundColor: '#f5f7f8', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  const updateTeenagerActivity = () => teenagerAccess.setActive(!suspended && main.isFocused() && !main.isMinimized());
  for (const event of ['focus', 'blur', 'minimize', 'restore']) main.on(event, updateTeenagerActivity);
  powerMonitor.on('suspend', () => { suspended = true; updateTeenagerActivity(); });
  powerMonitor.on('resume', () => { suspended = false; updateTeenagerActivity(); });
  teenagerTimer = setInterval(() => { if (teenagerAccess.state().enabled) teenagerAccess.tick(); }, 1000); teenagerTimer.unref();
  reportWindows = new ReportWindowManager({ createWindow: options => new BrowserWindow(options), createSession: partition => session.fromPartition(partition, { cache: false }), assertCurrent: context => accountScope.assert(context), parent: () => main, icon: applicationIcon, onClosed: () => { if (main && !main.isDestroyed()) main.webContents.send('coolapk:command', 'refresh'); } });
  const desktopSettings = new DesktopSettings({ webContents: main.webContents, imageCache, version: app.getVersion() });
  softwareUpdates = createSoftwareUpdates({ app, onChange: state => { if (main && !main.isDestroyed()) main.webContents.send('coolapk:updates', state); } });
  main.webContents.on('zoom-changed', (_, direction) => desktopSettings.zoomBy(direction === 'in' ? 1 : -1));
  phoneBridge = new PhoneBridge({ runtimeDir: app.isPackaged ? path.join(process.resourcesPath, 'scrcpy') : path.join(projectRoot, '.local', 'tools', 'scrcpy'), userData: app.getPath('userData'), dialog, parent: () => main });
  const localFiles = new LocalFiles({ dialog, parent: () => main, fetchImage });
  imageViewers = new ImageViewerManager({ createWindow: options => new BrowserWindow(options), parent: () => main, icon: applicationIcon, projectRoot, devUrl,
    capture: () => accountScope.capture(client), assertCurrent: context => accountScope.assert(context), modeEpoch: () => teenagerAccess.epoch,
    assertMode: epoch => { teenagerAccess.assertChannel('coolapk:open-image-viewer'); if (epoch !== teenagerAccess.epoch) throw new Error('模式已切换，请重新打开图片'); },
    readMessage: fetchMessageImage,
    readLive: (context, args) => context.client.dispatch('livePhotoVideo', args),
    openExternal: value => shell.openExternal(safeExternal(value)),
    saveImage: (window, args, guard) => new LocalFiles({ dialog, parent: () => window, fetchImage }).saveImage(args, guard),
  });
  main.on('closed', () => imageViewers.closeAll());
  handler('coolapk:open-image-viewer', value => imageViewers.open(value));
  ipcMain.handle('coolapk:image-viewer', async (event, operation, args) => {
    try { return { ok: true, data: await imageViewers.dispatch(event, operation, args) }; }
    catch (error) { return { ok: false, error: { message: error.message, code: error.code || 'APP_ERROR' } }; }
  });
  const { prepareApkDownload, openApkDownload } = await import('../core/download.mjs');
  downloadManager = new DownloadManager({ directory: path.join(process.env.COOLAPK_TEST_DATA || app.getPath('downloads'), '酷安下载'), stateFile: path.join(app.getPath('userData'), 'app-downloads.json'), shell, selectDirectory: async directory => {
    const epoch = teenagerAccess.epoch;
    const assertCurrent = () => { teenagerAccess.assertChannel('coolapk:downloads'); if (epoch !== teenagerAccess.epoch || !main || main.isDestroyed()) throw Object.assign(new Error('模式已切换，请重新打开下载页面'), { code: 'TEENAGER_RESTRICTED' }); };
    assertCurrent();
    const result = await dialog.showOpenDialog(main, { title: '选择应用下载保存位置', defaultPath: directory, properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
    assertCurrent();
    return { directory: result.canceled ? null : result.filePaths[0], assertCurrent };
  }, captureDownload: () => {
    const scope = accountScope.capture(client);
    return async (args, { signal, resume }) => { const { data: plan } = await prepareApkDownload(scope.client, args); accountScope.assert(scope); const opened = await openApkDownload(scope.client, plan, { signal, resume }); accountScope.assert(scope); return { ...opened, assertCurrent: () => accountScope.assert(scope) }; };
  }, onChange: state => { if (main && !main.isDestroyed()) main.webContents.send('coolapk:downloads', state); } });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', event => event.preventDefault());
  main.webContents.on('context-menu', (_, params) => {
    const template = [];
    if (params.isEditable) template.push({ role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' });
    else if (params.selectionText) template.push({ role: 'copy', label: '复制所选文字' });
    if (params.linkURL && !teenagerAccess.state().enabled) { try { const url = safeExternal(params.linkURL); template.push({ label: '复制链接', click: () => clipboard.writeText(url) }, { label: '用浏览器打开', click: () => { if (!teenagerAccess.state().enabled) return shell.openExternal(url); } }); } catch {} }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: main });
  });
  main.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(false));
  main.webContents.session.setPermissionCheckHandler(() => false);
  handler('coolapk:call', callApi);
  handler('coolapk:teenager', (operation, args) => teenagerAccess.dispatch(operation, args));
  handler('coolapk:accounts', () => store.publicState());
  handler('coolapk:login', openLogin);
  handler('coolapk:import', importCookie);
  handler('coolapk:verify', verifyRequest);
  handler('coolapk:select', uid => { const result = store.select(String(uid)); notifyAccount(); return result; });
  handler('coolapk:remove', uid => { const result = store.remove(String(uid)); notifyAccount(); return result; });
  handler('coolapk:external', value => shell.openExternal(safeExternal(value)));
  handler('coolapk:phone', (operation, args) => phoneBridge.dispatch(operation, args));
  handler('coolapk:account-page', openAccountPage);
  handler('coolapk:report', target => reportWindows.open(target, accountScope.capture(client)));
  handler('coolapk:desktop', (operation, args) => desktopSettings.dispatch(operation, args));
  handler('coolapk:background', async (operation, ...args) => {
    if (args.length) throw Object.assign(new Error('背景设置操作无效'), { code: 'INPUT' });
    const context = accountScope.capture(client), epoch = teenagerAccess.epoch;
    const guard = () => {
      accountScope.assert(context); teenagerAccess.assertChannel('coolapk:background');
      if (epoch !== teenagerAccess.epoch) throw Object.assign(new Error('模式已切换，请重新打开背景设置'), { code: 'TEENAGER_RESTRICTED' });
    };
    const result = await backgroundImages.dispatch(operation, guard);
    guard();
    return result;
  });
  handler('coolapk:updates', async (operation, ...args) => {
    if (args.length || !['info', 'check', 'download', 'cancel', 'install'].includes(operation)) throw new Error('软件更新操作无效');
    if (operation === 'download') { const pending = softwareUpdates.dispatch('download'); void Promise.resolve(pending).catch(() => {}); return softwareUpdates.state(); }
    if (operation === 'install') {
      if (confirmingUpdate || softwareUpdates.state().status !== 'downloaded') throw new Error('请先完成更新包下载');
      confirmingUpdate = true;
      try {
        const response = await dialog.showMessageBox(main, { type: 'question', title: '安装软件更新', message: '退出酷安桌面端并打开更新安装程序？', detail: '请先保存正在编辑的内容。安装版会保留本机账号、设置和草稿；免安装版会迁移到安装版。', buttons: ['取消', '退出并安装'], defaultId: 0, cancelId: 0 });
        if (response.response !== 1) return softwareUpdates.state();
        teenagerAccess.assertChannel('coolapk:updates');
        return await softwareUpdates.dispatch('install');
      } finally { confirmingUpdate = false; }
    }
    return softwareUpdates.dispatch(operation);
  });
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
  if (!process.env.COOLAPK_TEST_DATA && app.isPackaged) void softwareUpdates.dispatch('check').catch(() => {});
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
app.on('before-quit', () => { clearInterval(teenagerTimer); teenagerAccess?.setActive(false); phoneBridge?.close(); downloadManager?.close(); softwareUpdates?.close(); });
