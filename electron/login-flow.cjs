const { createHash } = require('node:crypto');
const officialDomain = value => { const domain = String(value || '').replace(/^\./, '').toLowerCase(); return domain === 'coolapk.com' || domain.endsWith('.coolapk.com'); };
const validSession = value => typeof value === 'string' && !!value.trim() && !/^(deleted|expired)$/i.test(value.trim());
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
module.exports = { OfficialLoginFlow, parseOfficialCallback, mergeLoginCookies, validSession };
