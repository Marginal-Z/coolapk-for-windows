const { randomUUID } = require('node:crypto');
const REPORT_TYPES = Object.freeze(['feed', 'article', 'feed_reply', 'user', 'apk']);
function failure(message, code = 'INPUT') { const error = new Error(message); error.code = code; return error; }
function buildReportRoute(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target) || !REPORT_TYPES.includes(target.type)) throw failure('举报对象无效');
  const expected = target.type === 'apk' ? ['type', 'packageName'] : ['type', 'id'];
  if (Object.keys(target).some(key => !expected.includes(key))) throw failure('举报对象参数无效');
  if (target.type === 'apk') {
    if (typeof target.packageName !== 'string' || target.packageName.length > 255 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(target.packageName)) throw failure('应用包名无效');
    const url = new URL('https://m.coolapk.com/mp/apk/report'); url.search = new URLSearchParams({ apkname: target.packageName }); return url.toString();
  }
  if (typeof target.id !== 'string' || !/^[1-9]\d{0,19}$/.test(target.id)) throw failure('举报对象编号无效');
  const url = new URL('https://m.coolapk.com/mp/do');
  url.search = new URLSearchParams(target.type === 'user' ? { c: 'user', m: 'report', id: target.id } : { c: 'feed', m: 'report', type: target.type, id: target.id });
  return url.toString();
}
function allowedReportNavigation(value) {
  let url; try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  // The mobile client uses an official web form. Keep its redirects and result
  // pages on these exact official hosts; never grant a preload or external shell.
  return url.hostname === 'm.coolapk.com' || url.hostname === 'account.coolapk.com' || url.hostname === 'www.coolapk.com';
}
function reportCookies(header) {
  if (typeof header !== 'string' || header.length > 16000 || /[\r\n\0]/.test(header)) throw failure('账号会话格式无效', 'LOGIN_REQUIRED');
  const result = [];
  for (const part of header.split(';')) {
    const divider = part.indexOf('='); if (divider < 1) continue;
    const name = part.slice(0, divider).trim(), value = part.slice(divider + 1).trim();
    if (/^[A-Za-z0-9_-]{1,100}$/.test(name) && value && !/[\x00-\x20\x7f;]/.test(value)) result.push({ url: 'https://m.coolapk.com', domain: '.coolapk.com', name, value, path: '/', secure: true, httpOnly: /^(?:SESSID|token|ddid|refreshToken)$/i.test(name) });
  }
  if (!result.some(cookie => /^(?:SESSID|token)$/.test(cookie.name) && !/^(?:deleted|expired)$/i.test(cookie.value))) throw failure('请先登录酷安账号', 'LOGIN_REQUIRED');
  return result;
}
class ReportWindowManager {
  constructor({ createWindow, createSession, assertCurrent, parent, icon, onClosed, makeId = randomUUID }) {
    Object.assign(this, { createWindow, createSession, assertCurrent, parent, icon, onClosed, makeId }); this.windows = new Set();
  }
  closeAll() { for (const window of [...this.windows]) if (!window.isDestroyed()) window.destroy(); }
  async open(target, context) {
    const route = buildReportRoute(target); this.assertCurrent(context);
    const owner = String(context?.client?.identity?.uid ?? '');
    if (!/^[1-9]\d{0,19}$/.test(owner) || owner === '10000') throw failure('请先登录酷安账号', 'LOGIN_REQUIRED');
    const cookies = reportCookies(context.client.cookie);
    if (this.windows.size >= 4) throw failure('请先关闭已打开的举报窗口', 'REPORT_LIMIT');
    const pageSession = this.createSession(`coolapk-report-${this.makeId()}`);
    const window = this.createWindow({ icon: this.icon, title: '酷安 · 官方举报', width: 580, height: 760, parent: this.parent(), autoHideMenuBar: true, webPreferences: { session: pageSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.windows.add(window);
    const clearSession = async () => { try { await pageSession.clearStorageData(); await pageSession.clearCache?.(); } catch {} };
    const active = () => { this.assertCurrent(context); if (window.isDestroyed()) throw failure('举报窗口已关闭', 'REPORT_CLOSED'); };
    window.once('closed', () => {
      this.windows.delete(window);
      void clearSession();
      try { this.assertCurrent(context); this.onClosed?.(); } catch {}
    });
    pageSession.setPermissionRequestHandler((_, __, callback) => callback(false)); pageSession.setPermissionCheckHandler(() => false);
    pageSession.on('will-download', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(({ url }) => {
      try { active(); if (allowedReportNavigation(url)) void window.loadURL(url).catch(() => {}); } catch {}
      return { action: 'deny' };
    });
    for (const eventName of ['will-navigate', 'will-redirect']) window.webContents.on(eventName, (event, url) => {
      try { active(); if (!allowedReportNavigation(url)) event.preventDefault(); } catch { event.preventDefault(); }
    });
    try {
      for (const cookie of cookies) { active(); await pageSession.cookies.set(cookie); }
      active(); await window.loadURL(route); active(); return { opened: true };
    } catch (error) {
      if (!window.isDestroyed()) window.destroy(); await clearSession();
      if (['ACCOUNT_CHANGED', 'REPORT_CLOSED'].includes(error?.code)) throw error;
      throw failure('官方举报页面加载失败，请检查网络后重试', 'REPORT_ERROR');
    }
  }
}
module.exports = { REPORT_TYPES, buildReportRoute, allowedReportNavigation, ReportWindowManager };
