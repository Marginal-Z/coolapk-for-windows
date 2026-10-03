import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountStore } from '../core/account-store.mjs';

const first = { uid: '123456', username: '原昵称', userAvatar: 'https://avatar.coolapk.com/first.jpg' };
const second = { uid: '654321', username: '另一个账号', userAvatar: '' };
const firstCookie = 'SESSID=synthetic-first-session; token=synthetic-first-token; uid=123456';
const secondCookie = 'SESSID=synthetic-second-session; uid=654321';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value).map(byte => byte ^ 90),
  decryptString: bytes => Buffer.from(bytes).map(byte => byte ^ 90).toString(),
};
function withStore(work) {
  const directory = mkdtempSync(join(tmpdir(), 'coolapk-public-identity-'));
  try { return work(new AccountStore(directory, encryption), directory); }
  finally {
    const target = resolve(directory), allowed = resolve(tmpdir()) + sep;
    if (!target.startsWith(allowed)) throw new Error('Unexpected test directory');
    rmSync(target, { recursive: true, force: true });
  }
}
function populate(store) { store.add(first, firstCookie); store.add(second, secondCookie); store.select(first.uid); }

test('profile synchronization changes only public identity and preserves credentials, device code and other accounts', () => withStore((store, directory) => {
  populate(store);
  const before = structuredClone(store.state);
  assert.equal(store.updatePublicIdentity(first.uid, { username: '新昵称', userAvatar: 'https://avatar.coolapk.com/updated.jpg', cookie: 'SESSID=synthetic-replacement', token: 'synthetic-unwanted-field', deviceCode: 'invalid' }), true);
  assert.equal(store.state.active, before.active);
  assert.equal(store.state.deviceCode, before.deviceCode);
  assert.equal(store.current().cookie, firstCookie);
  assert.deepEqual(store.state.accounts.find(account => account.uid === second.uid), before.accounts.find(account => account.uid === second.uid));
  assert.deepEqual(store.publicState().current, { ...first, username: '新昵称', userAvatar: 'https://avatar.coolapk.com/updated.jpg' });
  const saved = new AccountStore(directory, encryption);
  assert.equal(saved.current().cookie, firstCookie);
  assert.equal(saved.current().username, '新昵称');
  assert.equal(saved.current().token, undefined);
  assert.ok(!JSON.stringify(saved.publicState()).includes('synthetic-'));
}));

test('wrong uid, inactive account and stale results after switching cannot change an account or its file', () => withStore(store => {
  populate(store);
  for (const uid of ['999999', second.uid]) {
    const before = readFileSync(store.path), state = structuredClone(store.state);
    assert.throws(() => store.updatePublicIdentity(uid, { username: '不可保存' }), /账号已切换/);
    assert.deepEqual(store.state, state); assert.deepEqual(readFileSync(store.path), before);
  }
  store.select(second.uid);
  const before = readFileSync(store.path), state = structuredClone(store.state);
  assert.throws(() => store.updatePublicIdentity(first.uid, { username: '过期结果' }), /账号已切换/);
  assert.deepEqual(store.state, state); assert.deepEqual(readFileSync(store.path), before);
}));

test('guest mode rejects profile synchronization without saving or exposing the previous login', () => withStore(store => {
  assert.throws(() => store.updatePublicIdentity(first.uid, first), /账号已切换/);
  assert.equal(existsSync(store.path), false);
  populate(store); store.select('');
  const before = readFileSync(store.path), state = structuredClone(store.state);
  assert.throws(() => store.updatePublicIdentity(first.uid, { username: '游客不能更新' }), /账号已切换/);
  assert.deepEqual(store.state, state); assert.deepEqual(readFileSync(store.path), before);
  assert.equal(store.publicState().current, null);
  assert.ok(!JSON.stringify(store.publicState()).includes('synthetic-'));
}));

test('partial public updates retain omitted fields and unchanged data does not rewrite the encrypted file', () => withStore(store => {
  store.add(first, firstCookie);
  assert.equal(store.updatePublicIdentity(first.uid, { username: '只改昵称' }), true);
  assert.equal(store.current().userAvatar, first.userAvatar);
  assert.equal(store.updatePublicIdentity(first.uid, { userAvatar: '' }), true);
  assert.equal(store.current().username, '只改昵称');
  const before = readFileSync(store.path);
  assert.equal(store.updatePublicIdentity(first.uid, { username: '只改昵称', userAvatar: '', cookie: 'ignored' }), false);
  assert.deepEqual(readFileSync(store.path), before);
  assert.equal(store.current().cookie, firstCookie);
}));

test('invalid display data and unavailable encryption retain the last valid account and encrypted file', () => withStore(store => {
  store.add(first, firstCookie);
  const before = readFileSync(store.path), state = structuredClone(store.state);
  for (const username of ['x'.repeat(1025), 'invalid\rname', 'invalid\0name']) {
    assert.throws(() => store.updatePublicIdentity(first.uid, { username }));
    assert.deepEqual(store.state, state); assert.deepEqual(readFileSync(store.path), before);
  }
  store.encryption = { ...encryption, isEncryptionAvailable: () => false };
  assert.throws(() => store.updatePublicIdentity(first.uid, { username: '不能保存' }), /加密不可用/);
  assert.deepEqual(store.state, state); assert.deepEqual(readFileSync(store.path), before);
}));
