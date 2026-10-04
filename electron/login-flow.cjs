const { createHash } = require('node:crypto');
const officialDomain = value => { const domain = String(value || '').replace(/^\./, '').toLowerCase(); return domain === 'coolapk.com' || domain.endsWith('.coolapk.com'); };
const validSession = value => typeof value === 'string' && !!value.trim() && !/^(deleted|expired)$/i.test(value.trim());
function officialLoginUrl() { return 'https://account.coolapk.com/auth/login?type=coolapk'; }
function officialLoginDiagnosticUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname === 'account.coolapk.com' && /^\/auth\/(?:login|callback)\/?$/.test(url.pathname);
}
// The official page remains isolated: the probe returns one boolean and never reads
// input values, form text, storage, cookies, HTML, request IDs, or authorization codes.
const LOGIN_BLOCK_PROBE = `(() => {
  if (location.protocol !== 'https:' || location.hostname !== 'account.coolapk.com' || location.port || !/^\\/auth\\/(?:login|callback)\\/?$/.test(location.pathname) || !document.body) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('form,input,textarea,select,script,style,noscript,[hidden],[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
      if (!parent.getClientRects().length) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let text = '', node;
  while (text.length < 32768 && (node = walker.nextNode())) text += ' ' + (node.textContent || '').slice(0, 32768 - text.length);
  return /edgeone/i.test(text) && /\\b567\\b/.test(text) && (/请求已被站点的安全策略拦截/.test(text.replace(/\\s+/g, '')) || /request.{0,80}blocked.{0,80}security\\s+polic/i.test(text));
})()`;
const LOGIN_BLOCKED_ERROR = Object.freeze({ code: 'LOGIN_BLOCKED', message: '酷安官方登录页面被站点安全策略拦截（EdgeOne 567）。请稍后重试，或在更换网络后重新打开登录。' });
class OfficialLoginPageMonitor {
  constructor({ getURL, inspect, isActive, onBlocked }) {
    Object.assign(this, { getURL, inspect, isActive, onBlocked }); this.navigation = 0; this.reported = false;
  }
  navigationStarted() { this.navigation++; this.reported = false; }
  async check() {
    let url;
    try { url = this.getURL(); } catch { return false; }
    if (!this.isActive() || this.reported || !officialLoginDiagnosticUrl(url)) return false;
    const navigation = this.navigation;
    let blocked; try { blocked = await this.inspect(LOGIN_BLOCK_PROBE); } catch { return false; }
    if (blocked !== true || !this.isActive() || this.reported || navigation !== this.navigation) return false;
    try { if (this.getURL() !== url) return false; } catch { return false; }
    this.reported = true; this.onBlocked(LOGIN_BLOCKED_ERROR); return true;
  }
}
function cookiePairs(header) {
  const pairs = new Map();
  if (typeof header !== 'string' || header.length > 16000 || /[\r\n\0]/.test(header)) return pairs;
  for (const part of header.split(';')) {
    const index = part.indexOf('='); if (index < 1) continue;
    const name = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && value && !/[\x00-\x20\x7f;]/.test(value) && (name !== 'SESSID' || validSession(value))) pairs.set(name, value);
  }
  return pairs;
}
const headerFrom = pairs => [...pairs].map(([name, value]) => `${name}=${value}`).join('; ');
function mergeLoginCookies(cookies, callbackCookie = '', now = Date.now() / 1000) {
  const pairs = cookiePairs(callbackCookie);
  const priority = domain => { const value = domain.replace(/^\./, '').toLowerCase(); return value === 'account.coolapk.com' ? 3 : value === 'coolapk.com' ? 2 : 1; };
  const current = cookies.filter(c => officialDomain(c.domain) && (!c.expirationDate || c.expirationDate > now)).sort((a, b) => priority(a.domain) - priority(b.domain) || String(a.path || '/').length - String(b.path || '/').length);
  for (const cookie of current) for (const [name, value] of cookiePairs(`${cookie.name}=${cookie.value}`)) pairs.set(name, value);
  return headerFrom(pairs);
}
function parseOfficialCallback(value) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const fragment = url.hash.slice(1);
  const [fragmentPath, fragmentQuery] = fragment.split('?');
  const callback = url.origin === 'https://account.coolapk.com' && url.pathname === '/auth/callback' || url.origin === 'https://www.coolapk.com' && (url.pathname === '/auth_callback' || fragmentPath === '/auth_callback');
  if (!callback) return null;
  const params = new URLSearchParams(url.search);
  if (fragmentQuery && fragmentPath === '/auth_callback') for (const [name, value] of new URLSearchParams(fragmentQuery)) if (!params.has(name)) params.set(name, value);
  const code = params.get('ac') === 'access_token' ? params.get('code')?.trim() : '';
  return { code: code && code.length <= 4096 && !/[\r\n\0]/.test(code) ? code : '', cookie: params.get('ck') || '' };
}
function withIdentity(cookie, identity) {
  const pairs = cookiePairs(cookie);
  pairs.set('uid', String(identity.uid)); pairs.set('username', encodeURIComponent(identity.username));
  const token = identity.refreshToken || identity.token;
  if (token) pairs.set('token', encodeURIComponent(token));
  return headerFrom(pairs);
}
function exchangeCookie(cookie) {
  const pairs = cookiePairs(cookie);
  for (const name of ['uid', 'username', 'token']) pairs.delete(name);
  return headerFrom(pairs);
}

// Navigation and Cookie events share one exchange so a one-time authorization code is never consumed twice.
class OfficialLoginFlow {
  constructor({ getCookies, exchange, checkLogin, assertIdentity, commit, isActive }) {
    Object.assign(this, { getCookies, exchange, checkLogin, assertIdentity, commit, isActive });
    this.attemptedCodes = new Set(); this.pending = null; this.running = null; this.finished = false; this.lastAttempt = '';
  }
  complete(value) {
    const callback = value ? parseOfficialCallback(value) : this.pending;
    if (!callback || this.finished || !this.isActive()) return Promise.resolve(false);
    this.pending = callback;
    if (this.running) return this.running.then(() => this.complete(), () => this.complete());
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async run() {
    const callback = this.pending;
    const cookie = mergeLoginCookies(await this.getCookies(), callback.cookie);
    if (!this.isActive() || !validSession(cookiePairs(cookie).get('SESSID'))) return false;
    const fingerprint = createHash('sha256').update(JSON.stringify([callback.code, cookie])).digest('hex');
    if (fingerprint === this.lastAttempt) return false;
    this.lastAttempt = fingerprint;
    let identity, storedCookie = cookie, exchangeError;
    if (callback.code && !this.attemptedCodes.has(callback.code)) {
      this.attemptedCodes.add(callback.code);
      try {
        const result = await this.exchange(callback.code, exchangeCookie(cookie)); identity = result.data;
        this.assertIdentity(identity);
        if (!identity.username || !(identity.refreshToken || identity.token)) throw new Error('官方授权未返回完整账号信息');
        storedCookie = withIdentity(exchangeCookie(cookie), identity);
      } catch (error) { exchangeError = error; identity = null; }
    }
    if (!this.isActive()) return false;
    if (!identity) {
      try { const result = await this.checkLogin(cookie); identity = result.data; this.assertIdentity(identity); }
      catch (error) { throw exchangeError || error; }
    }
    if (!this.isActive()) return false;
    this.commit(identity, storedCookie); this.finished = true; return true;
  }
}
module.exports = { OfficialLoginFlow, OfficialLoginPageMonitor, LOGIN_BLOCK_PROBE, LOGIN_BLOCKED_ERROR, officialLoginUrl, officialLoginDiagnosticUrl, parseOfficialCallback, mergeLoginCookies, validSession };
