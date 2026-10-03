import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountStore } from '../core/account-store.mjs';
import { createDeviceCode, requestHeaders } from '../core/auth.mjs';
const secret = 'synthetic-private-session';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).map(x => x ^ 90),
  decryptString: bytes => Buffer.from(bytes).map(x => x ^ 90).toString(),
};
const account = { uid: '123456', username: '测试酷友', userAvatar: '', cookie: `SESSID=${secret}` };
const fixture = () => ({ deviceCode: createDeviceCode('synthetic-device'), active: account.uid, accounts: [{ ...account }] });
function withDirectory(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'coolapk-account-validation-'));
  try { return fn(directory); } finally { rmSync(directory, { recursive: true }); }
}
function writeFixture(directory, value) { const bytes = encryption.encryptString(typeof value === 'string' ? value : JSON.stringify(value)); writeFileSync(join(directory, 'accounts.encrypted'), bytes); return bytes; }

test('current account files load with a usable device code and only public identity fields are exposed', () => withDirectory(directory => {
  const original = fixture(); original.accounts[0].internalToken = secret; original.accounts[0].cookie = 'Cookie: ' + original.accounts[0].cookie + ' ';
  writeFixture(directory, original);
  const store = new AccountStore(directory, encryption);
  assert.equal(store.loadError, undefined); assert.equal(store.current().uid, account.uid); assert.equal(store.current().cookie, account.cookie);
  assert.ok(!JSON.stringify(store.publicState()).includes(secret)); assert.equal(store.state.accounts[0].internalToken, undefined);
  assert.equal(requestHeaders(store.state.deviceCode)['X-App-Device'], original.deviceCode);
}));
test('numeric identity fields and missing optional display fields remain compatible', () => withDirectory(directory => {
  const original = fixture(); original.active = 123456; original.accounts[0] = { uid: 123456, cookie: `token=${secret}` };
  writeFixture(directory, original);
  const store = new AccountStore(directory, encryption);
  assert.equal(store.current().uid, '123456'); assert.equal(store.current().username, '酷友'); assert.equal(store.current().userAvatar, '');
}));
test('malformed decrypted state is retained and cannot be overwritten by guest selection or removal', () => {
  const mutations = [
    () => null, () => [], () => ({}), state => ({ ...state, accounts: {} }), state => ({ ...state, active: '999999' }),
    state => ({ ...state, accounts: [...state.accounts, { ...account }] }), state => ({ ...state, accounts: [{ ...account, uid: '0' }] }),
    state => ({ ...state, accounts: [{ ...account, uid: '10000' }] }), state => ({ ...state, accounts: [{ ...account, uid: '../1' }] }),
    state => ({ ...state, deviceCode: '' }), state => ({ ...state, deviceCode: 'not-a-device-code' }),
    state => ({ ...state, deviceCode: Buffer.from('synthetic\n; profile').toString('base64').replace(/=+$/, '').split('').reverse().join('') }),
    state => ({ ...state, accounts: [{ ...account, cookie: {} }] }), state => ({ ...state, accounts: [{ ...account, cookie: 'uid=123456' }] }),
    state => ({ ...state, accounts: [{ ...account, cookie: 'SESSID=deleted' }] }), state => ({ ...state, accounts: [{ ...account, cookie: `SESSID=${secret}\r\nAuthorization: synthetic` }] }),
  ];
  for (const mutate of mutations) withDirectory(directory => {
    const bytes = writeFixture(directory, mutate(fixture()));
    const store = new AccountStore(directory, encryption);
    assert.ok(store.loadError); assert.equal(store.current(), null); assert.ok(!JSON.stringify(store.publicState()).includes(secret));
    assert.throws(() => store.select('')); assert.throws(() => store.remove('123456')); assert.throws(() => store.save());
    assert.deepEqual(readFileSync(store.path), bytes); assert.equal(readdirSync(directory).length, 1);
  });
});
test('failed JSON parsing and decryption provide fixed warnings without disclosing file contents', () => withDirectory(directory => {
  const bytes = writeFixture(directory, `{"cookie":"${secret}", invalid JSON`);
  const malformed = new AccountStore(directory, encryption);
  assert.ok(malformed.loadError); assert.ok(!malformed.loadError.includes(secret)); assert.deepEqual(readFileSync(malformed.path), bytes);
  const failed = new AccountStore(directory, { ...encryption, decryptString: () => { throw new Error(secret); } });
  assert.ok(failed.loadError); assert.ok(!failed.loadError.includes(secret)); assert.deepEqual(readFileSync(failed.path), bytes);
}));
test('an explicit new login preserves the invalid encrypted original before saving a valid account', () => withDirectory(directory => {
  const original = writeFixture(directory, { cookie: secret });
  const store = new AccountStore(directory, encryption);
  store.add({ uid: account.uid, username: account.username }, account.cookie);
  assert.equal(store.loadError, null); assert.equal(store.current().uid, account.uid);
  const backups = readdirSync(directory).filter(name => /^accounts\.invalid-.*\.encrypted$/.test(name));
  assert.equal(backups.length, 1); assert.deepEqual(readFileSync(join(directory, backups[0])), original);
  assert.ok(!readFileSync(store.path).includes(Buffer.from(secret)));
  assert.equal(new AccountStore(directory, encryption).current().uid, account.uid);
}));
test('failed recovery and invalid additions retain original credentials and leave no temporary file', () => withDirectory(directory => {
  const original = writeFixture(directory, { cookie: secret });
  const store = new AccountStore(directory, { ...encryption, encryptString: () => { throw new Error('encryption unavailable'); } });
  assert.throws(() => store.add({ uid: account.uid }, account.cookie));
  assert.deepEqual(readFileSync(store.path), original); assert.ok(store.loadError); assert.equal(store.current(), null); assert.ok(!existsSync(store.path + '.tmp'));
  const normal = new AccountStore(directory, encryption);
  assert.throws(() => normal.add({ uid: '0' }, account.cookie));
  assert.deepEqual(readFileSync(normal.path), original); assert.equal(readdirSync(directory).length, 1);
}));
