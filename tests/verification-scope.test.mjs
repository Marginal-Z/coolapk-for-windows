import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CoolapkClient } from '../core/client.mjs';
import { createDeviceCode } from '../core/auth.mjs';

const { AccountScope } = createRequire(import.meta.url)('../electron/request-scope.cjs');
const proof = (letter = 'a') => ({ id: letter.repeat(32), token: `NEC:${letter.repeat(8)}:synthetic-local-proof-${letter}` });
const device = label => createDeviceCode('synthetic-verification-scope-' + label);

// Only synthetic request responses and proofs are used. No real captcha is
// solved or submitted and no native application or account storage is opened.
function clientHarness(options = {}) {
  const requests = [];
  const client = new CoolapkClient({ deviceCode: device('main'), publicDeviceCode: device('public'), ...options, fetchImpl: async (url, init) => {
    requests.push({ url, init }); return Response.json({ data: [] });
  } });
  return { client, requests, scope: new AccountScope() };
}
function validateCookie(request) {
  const value = request.init.headers.Cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('validate='));
  return value ? decodeURIComponent(value.slice('validate='.length).replace(/\+/g, '%20')) : undefined;
}

test('captured guest proof keeps its original device and cannot be changed through a returned copy', async () => {
  const h = clientHarness(); h.client.setVerificationCookie(proof());
  const captured = h.scope.capture(h.client);
  const copy = h.client.getVerificationCookie(); copy.token = proof('b').token; copy.deviceCode = device('other');
  h.client.setVerificationCookie(proof('b'));
  await captured.client.dispatch('replies', { id: '101' });
  await h.scope.capture(h.client).client.dispatch('replies', { id: '101' });
  assert.equal(validateCookie(h.requests[0]), proof().token);
  assert.equal(validateCookie(h.requests[1]), proof('b').token);
  assert.equal(h.requests[0].init.headers['X-App-Device'], h.requests[1].init.headers['X-App-Device']);
  assert.equal(h.client.cookie, ''); assert.equal(captured.client.cookie, '');
});

test('constructor refuses a proof transferred to another device, account, or anonymous identity', async () => {
  const h = clientHarness({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-account-only' });
  h.client.setVerificationCookie(proof()); const state = h.client.getVerificationCookie();
  for (const changes of [{ deviceCode: device('other') }, { identity: { uid: '43' } }, { identity: null }]) {
    const client = new CoolapkClient({ deviceCode: h.client.deviceCode, identity: { uid: '42' }, verificationCookie: state, ...changes });
    assert.equal(client.getVerificationCookie(), null);
  }
  const same = new CoolapkClient({ deviceCode: h.client.deviceCode, identity: { uid: '42' }, verificationCookie: state });
  assert.equal(same.getVerificationCookie().token, proof().token);
});

test('changing an existing client device or account invalidates its in-memory proof', () => {
  for (const change of [client => { client.deviceCode = device('changed'); }, client => { client.identity = { uid: '43' }; }, client => { client.identity = null; }]) {
    const { client } = clientHarness({ identity: { uid: '42' } });
    client.setVerificationCookie(proof()); change(client);
    assert.equal(client.getVerificationCookie(), null);
    client.deviceCode = device('main'); client.identity = { uid: '42' };
    assert.equal(client.getVerificationCookie(), null);
  }
});

test('separate captured requests keep their own proof while the ordinary client stays untouched', async () => {
  const h = clientHarness({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-account-only' });
  const first = h.scope.capture(h.client), second = h.scope.capture(h.client);
  first.client.setVerificationCookie(proof()); second.client.setVerificationCookie(proof('b'));
  await Promise.all([first.client.dispatch('replies', { id: '101' }), second.client.dispatch('replies', { id: '102' })]);
  const byId = new Map(h.requests.map(request => [request.url.searchParams.get('id'), request]));
  assert.equal(validateCookie(byId.get('101')), proof().token);
  assert.equal(validateCookie(byId.get('102')), proof('b').token);
  assert.ok(h.requests.every(request => request.init.headers.Cookie.startsWith('SESSID=synthetic-account-only; ')));
  assert.equal(h.client.getVerificationCookie(), null);
  assert.equal(h.client.cookie, 'SESSID=synthetic-account-only');
});

test('account epoch changes stop captured proofs before any late request reaches the transport', async () => {
  const h = clientHarness({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-account-only' });
  h.client.setVerificationCookie(proof()); const captured = h.scope.capture(h.client);
  h.scope.changed(); h.client.clearVerificationCookie(); h.client.identity = { uid: '43' }; h.client.cookie = 'SESSID=synthetic-other-account';
  await assert.rejects(captured.client.dispatch('replies', { id: '101' }), { code: 'ACCOUNT_CHANGED' });
  assert.equal(h.requests.length, 0);
  await h.scope.capture(h.client).client.dispatch('replies', { id: '101' });
  assert.equal(validateCookie(h.requests[0]), undefined);
  assert.equal(h.requests[0].init.headers.Cookie, 'SESSID=synthetic-other-account');
});

test('captured public proofs keep the anonymous device and are independent from normal account proofs', async () => {
  const h = clientHarness({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-account-only' });
  h.client.setVerificationCookie(proof()); h.client.getPublicReader().setVerificationCookie(proof('b'));
  const captured = h.scope.capture(h.client), copy = h.client.getPublicVerificationCookie();
  copy.token = proof('c').token; copy.ownerUid = '43';
  h.client.getPublicReader().setVerificationCookie(proof('c'));
  await captured.client.dispatch('publicUserFollowNodes', { uid: '77' });
  await captured.client.dispatch('replies', { id: '101' });
  await h.scope.capture(h.client).client.dispatch('publicUserFollowNodes', { uid: '77' });
  assert.equal(validateCookie(h.requests[0]), proof('b').token);
  assert.equal(h.requests[0].init.headers['X-App-Device'], h.client.publicDeviceCode);
  assert.equal(h.requests[0].init.headers.Cookie, 'validate=' + encodeURIComponent(proof('b').token));
  assert.equal(validateCookie(h.requests[1]), proof().token);
  assert.equal(h.requests[1].init.headers['X-App-Device'], h.client.deviceCode);
  assert.ok(h.requests[1].init.headers.Cookie.startsWith('SESSID=synthetic-account-only; '));
  assert.equal(validateCookie(h.requests[2]), proof('c').token);
});

test('public proof inheritance rejects another owner, public device or authenticated reader', () => {
  const h = clientHarness({ identity: { uid: '42' } });
  h.client.getPublicReader().setVerificationCookie(proof()); const state = h.client.getPublicVerificationCookie();
  for (const changes of [{ identity: { uid: '43' } }, { identity: null }, { publicDeviceCode: device('other-public') }, { publicVerificationCookie: { ...state, uid: '42' } }]) {
    const client = new CoolapkClient({ deviceCode: h.client.deviceCode, publicDeviceCode: h.client.publicDeviceCode, identity: { uid: '42' }, publicVerificationCookie: state, ...changes });
    assert.equal(client.getPublicVerificationCookie(), null); assert.equal(client.getVerificationCookie(), null);
  }
  const same = new CoolapkClient({ publicDeviceCode: h.client.publicDeviceCode, identity: { uid: '42' }, publicVerificationCookie: state });
  assert.equal(same.getPublicVerificationCookie().token, proof().token); assert.equal(same.getVerificationCookie(), null);
});

test('changing the public device or owner clears its proof without bringing it back on a later return', () => {
  for (const change of [client => { client.publicDeviceCode = device('changed-public'); }, client => { client.identity = { uid: '43' }; }, client => { client.identity = null; }]) {
    const h = clientHarness({ identity: { uid: '42' } }); h.client.getPublicReader().setVerificationCookie(proof());
    change(h.client); assert.equal(h.client.getPublicVerificationCookie(), null);
    h.client.publicDeviceCode = device('public'); h.client.identity = { uid: '42' };
    assert.equal(h.client.getPublicVerificationCookie(), null);
    assert.equal(h.client.getPublicReader().getVerificationCookie(), null);
  }
});

test('production account transition clears proofs, pending outcomes and SDK windows even when reselecting the same UID', async () => {
  const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('function syncAccount()'), end = source.indexOf('function safeExternal(', start);
  assert.ok(start >= 0 && end > start);
  for (const next of [{ uid: '42', cookie: 'SESSID=synthetic-reselected' }, { uid: '43', cookie: 'SESSID=synthetic-other' }, null]) {
    const h = clientHarness({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-original' });
    h.client.setVerificationCookie(proof()); h.client.getPublicReader().setVerificationCookie(proof('b')); const old = h.scope.capture(h.client);
    let closed = 0;
    const window = { isDestroyed: () => false, close: () => { closed++; } };
    const sandbox = { client: h.client, accountScope: h.scope, store: { current: () => next, publicState: () => ({}) },
      verificationRequests: new Map([['pending', {}]]), verifiedResponses: new Map([['outcome', {}]]),
      verificationWindows: new Set([window]), accountWindows: new Set(), downloadManager: null, reportWindows: null, loginWindow: null, main: null };
    vm.createContext(sandbox); vm.runInContext(source.slice(start, end) + ';globalThis.transition=notifyAccount;', sandbox);
    sandbox.transition();
    assert.equal(h.client.getVerificationCookie(), null); assert.equal(h.client.getPublicVerificationCookie(), null); assert.equal(closed, 1);
    assert.equal(sandbox.verificationRequests.size, 0); assert.equal(sandbox.verifiedResponses.size, 0);
    await assert.rejects(old.client.dispatch('replies', { id: '101' }), { code: 'ACCOUNT_CHANGED' });
    await assert.rejects(old.client.dispatch('publicUserFollowNodes', { uid: '77' }), { code: 'ACCOUNT_CHANGED' });
    assert.equal(h.requests.length, 0);
    await h.scope.capture(h.client).client.dispatch('replies', { id: '101' });
    assert.equal(validateCookie(h.requests[0]), undefined);
    assert.equal(h.requests[0].init.headers.Cookie, next?.cookie);
  }
});
