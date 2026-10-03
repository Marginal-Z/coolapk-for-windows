import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const table = Buffer.from(readFileSync(new URL('./auth-table.b64', import.meta.url), 'utf8').trim(), 'base64');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const md5 = input => createHash('md5').update(input).digest('hex');
export const APK_PROFILE = Object.freeze({ version: '16.6.4', code: 2609291, sdk: 34 });

export function createDeviceCode(id = randomBytes(16).toString('hex')) {
  return Buffer.from(`${id}; ; ; ; Samsung; Samsung; SM-S9180; UP1A.231005.007; `).toString('base64').split('').reverse().join('').replace(/[=\r\n]/g, '');
}

// The table was extracted from the user-supplied libauth.so (base64 then XOR 0x5a).
// Algorithm cross-checked with daimiaopeng/coolapk-desktop, MIT licensed.
export function tokenAt(deviceCode, timestamp, appCode = APK_PROFILE.code) {
  const index = ((timestamp + appCode) % 100) * 4 + 0x80;
  const segment = Buffer.from(table.subarray(index, index + 0x80).toString(), 'base64').toString();
  const plain = `com.coolapk.market&${segment}&${md5(deviceCode)}&${timestamp}&${appCode}`;
  const password = md5(Buffer.from(plain).toString('base64'));
  const source = Buffer.from(`${timestamp.toString(16)}/${md5(plain)}`).toString('base64').slice(0, 22);
  const shifted = source.slice(0, -1) + alphabet[(alphabet.indexOf(source.at(-1)) + 59) % 64];
  if (!/^[./A-Za-z0-9]{22}$/.test(shifted)) throw new Error('Invalid bcrypt salt');
  const hash = bcrypt.hashSync(password, `$2y$04$${shifted}`);
  return 'v3' + Buffer.from(hash).toString('base64').replace(/=+$/, '');
}

export function createToken(deviceCode, profile = APK_PROFILE, now = Math.floor(Date.now() / 1000)) {
  for (let i = 0; i <= 15; i++) {
    try { return tokenAt(deviceCode, now + i, profile.code); } catch (error) { if (i === 15) throw error; }
  }
}

export function requestHeaders(deviceCode, profile = APK_PROFILE) {
  return {
    'User-Agent': `Dalvik/2.1.0 (Linux; U; Android 14; SM-S9180 Build/UP1A.231005.007) +CoolMarket/${profile.version}-${profile.code}-universal`,
    'X-Requested-With': 'XMLHttpRequest', 'X-Sdk-Int': String(profile.sdk), 'X-Sdk-Locale': 'zh-CN',
    'X-App-Mode': 'universal', 'X-App-Channel': 'coolapk', 'X-App-Id': 'com.coolapk.market',
    'X-App-Version': profile.version, 'X-App-Code': String(profile.code), 'X-App-Supported': String(profile.code),
    'X-Api-Version': '16', 'X-Dark-Mode': '0', 'X-App-Device': deviceCode, 'X-App-Token': createToken(deviceCode, profile),
  };
}
export function imageUserAgent() {
  return `Dalvik/2.1.0 (Linux; U; Android 14; SM-S9180 Build/UP1A.231005.007) +CoolMarket/${APK_PROFILE.version}-${APK_PROFILE.code}-universal`;
}
