import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync, rmSync, constants, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDeviceCode } from './auth.mjs';
import { sanitizeCookie } from './client.mjs';

const invalid = () => { throw new Error('账号文件格式无效'); };
function accountUid(value) {
  const uid = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  if (!/^[1-9]\d{0,19}$/.test(uid) || uid === '10000') invalid();
  return uid;
}
function deviceCode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{16,4096}$/.test(value)) invalid();
  const bytes = Buffer.from(value.split('').reverse().join(''), 'base64');
  const decoded = bytes.toString('utf8');
  if (!decoded.includes(';') || /[\x00-\x1f\x7f\ufffd]/.test(decoded) || bytes.toString('base64').replace(/=+$/, '').split('').reverse().join('') !== value) invalid();
  return value;
}
function accountCookie(value) {
  const cookie = sanitizeCookie(value);
  if (/[\x00-\x1f\x7f]/.test(cookie) || !cookie.split(';').some(part => {
    const match = /^(?:SESSID|token)=([^\s;]+)$/i.exec(part.trim());
    return match && !/^(deleted|expired)$/i.test(match[1]);
  })) invalid();
  return cookie;
}
function displayString(value, fallback, max) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > max || /[\0\r]/.test(value)) invalid();
  return value;
}
function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.accounts)) invalid();
  const accounts = value.accounts.map(account => {
    if (!account || typeof account !== 'object' || Array.isArray(account)) invalid();
    return { uid: accountUid(account.uid), username: displayString(account.username, '酷友', 1024), userAvatar: displayString(account.userAvatar, '', 4096), cookie: accountCookie(account.cookie) };
  });
  if (new Set(accounts.map(a => a.uid)).size !== accounts.length) invalid();
  const active = value.active === '' ? '' : accountUid(value.active);
  if (active && !accounts.some(a => a.uid === active)) invalid();
  return { deviceCode: deviceCode(value.deviceCode), active, accounts };
}
const publicAccount = account => account ? { uid: account.uid, username: account.username, userAvatar: account.userAvatar } : null;

export class AccountStore {
  constructor(directory, encryption) {
    this.path = join(directory, 'accounts.encrypted'); this.encryption = encryption;
    this.state = { deviceCode: createDeviceCode(), active: '', accounts: [] };
    mkdirSync(directory, { recursive: true });
    if (existsSync(this.path)) {
      try { if (statSync(this.path).size > 8 * 1024 * 1024) invalid(); this.state = validateState(JSON.parse(encryption.decryptString(readFileSync(this.path)))); }
      catch { this.loadError = '本地账号文件无效或无法解密，请重新登录。原文件已保留。'; }
    }
  }
  save(next = this.state, { recover = false } = {}) {
    if (this.loadError && !recover) throw new Error('请重新登录后恢复账号文件，原文件已保留');
    if (!this.encryption.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，账号不会保存');
    const checked = validateState(next);
    const encrypted = this.encryption.encryptString(JSON.stringify(checked));
    const tmp = this.path + '.tmp';
    try {
      writeFileSync(tmp, encrypted);
      if (this.loadError && existsSync(this.path)) {
        const backup = join(dirname(this.path), `accounts.invalid-${Date.now()}-${randomUUID()}.encrypted`);
        copyFileSync(this.path, backup, constants.COPYFILE_EXCL);
      }
      renameSync(tmp, this.path); this.state = checked; this.loadError = null;
    } catch (error) { rmSync(tmp, { force: true }); throw error; }
  }
  current() { return this.state.accounts.find(a => a.uid === this.state.active) || null; }
  publicState() { return { accounts: this.state.accounts.map(publicAccount), current: publicAccount(this.current()), warning: this.loadError }; }
  updatePublicIdentity(uid, identity) {
    const current = this.current(); if (!current || current.uid !== String(uid)) throw new Error('账号已切换');
    const username = typeof identity.username === 'string' ? identity.username : current.username;
    const userAvatar = typeof identity.userAvatar === 'string' ? identity.userAvatar : current.userAvatar;
    if (username === current.username && userAvatar === current.userAvatar) return false;
    this.save({ ...this.state, accounts: this.state.accounts.map(account => account.uid === current.uid ? { ...account, username, userAvatar } : account) });
    return true;
  }
  add(identity, cookie) {
    const account = { uid: String(identity.uid ?? identity.id), username: identity.username ?? identity.userName ?? '酷友', userAvatar: identity.userAvatar ?? identity.avatar ?? '', cookie };
    this.save({ ...this.state, accounts: [...this.state.accounts.filter(a => a.uid !== account.uid), account], active: account.uid }, { recover: true }); return this.publicState();
  }
  select(uid) { if (uid && !this.state.accounts.some(a => a.uid === uid)) throw new Error('账号不存在'); this.save({ ...this.state, active: uid }); return this.publicState(); }
  remove(uid) { this.save({ ...this.state, accounts: this.state.accounts.filter(a => a.uid !== uid), active: this.state.active === uid ? '' : this.state.active }); return this.publicState(); }
}
