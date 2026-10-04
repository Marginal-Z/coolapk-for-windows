import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const TEENAGER_LIMIT_MILLISECONDS = 40 * 60 * 1000;
const PIN = /^\d{4}$/;
const HEX = /^[a-f0-9]{64}$/;
const LOCK_MILLISECONDS = 30 * 1000;
const MAX_FAILURES = 5;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class TeenagerError extends Error {
  constructor(message, code) { super(message); this.name = 'TeenagerError'; this.code = code; }
}
const dayOf = time => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
function localHour(time, hour) { const date = new Date(time); date.setHours(hour, 0, 0, 0); return date.getTime(); }
function validRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.version === 1
    && typeof value.enabled === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(value.day)
    && Number.isSafeInteger(value.usedMilliseconds) && value.usedMilliseconds >= 0 && value.usedMilliseconds <= TEENAGER_LIMIT_MILLISECONDS
    && Number.isSafeInteger(value.failedAttempts) && value.failedAttempts >= 0 && value.failedAttempts <= MAX_FAILURES
    && Number.isSafeInteger(value.lockedUntil) && value.lockedUntil >= 0
    && (!value.enabled || (HEX.test(value.salt) && HEX.test(value.verifier)));
}
function normalizeRecord(value) {
  return { version: 1, enabled: value.enabled, day: value.day, usedMilliseconds: value.usedMilliseconds,
    failedAttempts: value.failedAttempts, lockedUntil: value.lockedUntil,
    ...(value.enabled ? { salt: value.salt, verifier: value.verifier } : {}) };
}

/** Local policy and PIN verification. The main process alone supplies activity events and time. */
export class TeenagerStore {
  #record; #filePath; #encrypt; #decrypt; #now; #active = false; #sample; #fault = false; #queue = Promise.resolve();
  constructor({ filePath, encrypt, decrypt, now = Date.now }) {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('TeenagerStore requires an absolute filePath');
    if ((encrypt && !decrypt) || (decrypt && !encrypt)) throw new TypeError('TeenagerStore requires both encrypt and decrypt');
    this.#filePath = filePath; this.#encrypt = encrypt; this.#decrypt = decrypt; this.#now = now;
    this.#sample = this.#clock();
    this.#record = { version: 1, enabled: false, day: dayOf(this.#sample), usedMilliseconds: 0, failedAttempts: 0, lockedUntil: 0 };
    try {
      const bytes = readFileSync(filePath);
      if (bytes.length > 1024 * 1024) throw new Error('Invalid record');
      const data = JSON.parse(this.#decrypt ? this.#decrypt(bytes) : bytes.toString('utf8'));
      if (!validRecord(data)) throw new Error('Invalid record');
      this.#record = normalizeRecord(data);
    } catch (error) { if (error?.code !== 'ENOENT') this.#fault = true; }
  }
  #clock() {
    const time = this.#now();
    if (!Number.isSafeInteger(time) || time < 0 || !Number.isFinite(new Date(time).getTime())) throw new TypeError('Invalid main-process time');
    return time;
  }
  #persist(record) {
    const temporary = `${this.#filePath}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const text = JSON.stringify(record), bytes = this.#encrypt ? this.#encrypt(text) : Buffer.from(text, 'utf8');
      if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Invalid encrypted record');
      mkdirSync(dirname(this.#filePath), { recursive: true });
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.#filePath);
    } catch {
      try { unlinkSync(temporary); } catch { /* The temporary file may not have been created. */ }
      throw new TeenagerError('青少年模式设置未保存，请检查本机存储后重试。', 'TEENAGER_STORAGE');
    }
    this.#record = record;
  }
  #refresh() {
    let time;
    try { time = this.#clock(); } catch { this.#fault = true; return; }
    if (this.#fault) { this.#sample = time; return; }
    const previousSample = this.#sample;
    // A backwards clock never grants another quota or subtracts recorded usage.
    this.#sample = Math.max(time, previousSample);
    let record = this.#record, next = record;
    const day = dayOf(time);
    if (day > record.day) next = { ...record, day, usedMilliseconds: 0 };
    if (record.enabled && this.#active && time > previousSample && day === next.day) {
      const from = Math.max(previousSample, localHour(time, 6)), to = Math.min(time, localHour(time, 22));
      if (to > from) next = { ...next, usedMilliseconds: Math.min(TEENAGER_LIMIT_MILLISECONDS, next.usedMilliseconds + to - from) };
    }
    if (next !== record) {
      try { this.#persist(next); } catch { this.#fault = true; }
    }
  }
  #snapshot() {
    let time; try { time = this.#clock(); } catch { this.#fault = true; time = this.#sample; }
    const night = new Date(time).getHours() < 6 || new Date(time).getHours() >= 22;
    const enabled = this.#fault || this.#record.enabled;
    const reason = this.#fault ? 'state_error' : !enabled ? null : night ? 'night' : this.#record.usedMilliseconds >= TEENAGER_LIMIT_MILLISECONDS ? 'daily_limit' : null;
    return Object.freeze({ enabled, blocked: reason !== null, reason,
      usedMilliseconds: this.#record.usedMilliseconds,
      remainingMilliseconds: Math.max(0, TEENAGER_LIMIT_MILLISECONDS - this.#record.usedMilliseconds),
      limitMilliseconds: TEENAGER_LIMIT_MILLISECONDS, day: this.#record.day,
      lockedUntil: this.#record.lockedUntil > time ? this.#record.lockedUntil : null });
  }
  info() { this.#refresh(); return this.#snapshot(); }
  tick() { return this.info(); }
  setActive(active) {
    if (typeof active !== 'boolean') throw new TypeError('Activity must be a boolean');
    this.#refresh(); this.#active = active;
    // Do not move the activity baseline backwards when the OS clock changes.
    this.#sample = Math.max(this.#sample, this.#clock());
    return this.#snapshot();
  }
  #enqueue(work) {
    const task = this.#queue.then(work);
    this.#queue = task.catch(() => undefined);
    return task;
  }
  #ready() {
    this.#refresh();
    if (this.#fault) throw new TeenagerError('青少年模式记录无法读取，已限制访问。请修复本机存储后重新启动。', 'TEENAGER_STATE');
  }
  #validate(pin, confirmation) {
    if (typeof pin !== 'string' || !PIN.test(pin)) throw new TeenagerError('请输入四位数字密码。', 'TEENAGER_PIN_FORMAT');
    if (confirmation !== undefined && confirmation !== pin) throw new TeenagerError('两次输入的密码不一致。', 'TEENAGER_PIN_MISMATCH');
  }
  async #verify(pin) {
    this.#validate(pin);
    if (this.#record.lockedUntil > this.#clock()) throw new TeenagerError('密码尝试过于频繁，请稍后重试。', 'TEENAGER_PIN_LOCKED');
    const actual = await scrypt(pin, Buffer.from(this.#record.salt, 'hex'), 32, SCRYPT);
    if (!timingSafeEqual(actual, Buffer.from(this.#record.verifier, 'hex'))) {
      const failedAttempts = this.#record.failedAttempts + 1;
      this.#persist({ ...this.#record, failedAttempts: failedAttempts >= MAX_FAILURES ? 0 : failedAttempts,
        lockedUntil: failedAttempts >= MAX_FAILURES ? this.#clock() + LOCK_MILLISECONDS : 0 });
      throw new TeenagerError(failedAttempts >= MAX_FAILURES ? '密码尝试过于频繁，请 30 秒后重试。' : '密码错误，请重新输入。', failedAttempts >= MAX_FAILURES ? 'TEENAGER_PIN_LOCKED' : 'TEENAGER_PIN_INVALID');
    }
  }
  enable(pin, confirmation) {
    return this.#enqueue(async () => {
      this.#ready(); this.#validate(pin, confirmation);
      if (confirmation === undefined) throw new TeenagerError('请再次输入密码以确认。', 'TEENAGER_PIN_MISMATCH');
      if (this.#record.enabled) throw new TeenagerError('青少年模式已开启。', 'TEENAGER_ALREADY_ENABLED');
      const salt = randomBytes(32).toString('hex'), verifier = (await scrypt(pin, Buffer.from(salt, 'hex'), 32, SCRYPT)).toString('hex');
      this.#ready();
      this.#persist({ version: 1, enabled: true, day: dayOf(this.#clock()), usedMilliseconds: 0, salt, verifier, failedAttempts: 0, lockedUntil: 0 });
      this.#sample = Math.max(this.#sample, this.#clock());
      return this.#snapshot();
    });
  }
  disable(pin) {
    return this.#enqueue(async () => {
      this.#ready();
      if (!this.#record.enabled) throw new TeenagerError('青少年模式尚未开启。', 'TEENAGER_NOT_ENABLED');
      await this.#verify(pin); this.#ready();
      this.#persist({ version: 1, enabled: false, day: dayOf(this.#clock()), usedMilliseconds: 0, failedAttempts: 0, lockedUntil: 0 });
      return this.#snapshot();
    });
  }
  changePin(oldPin, newPin, confirmation) {
    return this.#enqueue(async () => {
      this.#ready(); this.#validate(newPin, confirmation);
      if (confirmation === undefined) throw new TeenagerError('请再次输入密码以确认。', 'TEENAGER_PIN_MISMATCH');
      if (!this.#record.enabled) throw new TeenagerError('青少年模式尚未开启。', 'TEENAGER_NOT_ENABLED');
      await this.#verify(oldPin);
      const salt = randomBytes(32).toString('hex'), verifier = (await scrypt(newPin, Buffer.from(salt, 'hex'), 32, SCRYPT)).toString('hex');
      this.#ready(); this.#persist({ ...this.#record, salt, verifier, failedAttempts: 0, lockedUntil: 0 });
      return this.#snapshot();
    });
  }
}
