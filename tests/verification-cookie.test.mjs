import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { createDeviceCode } from '../core/auth.mjs';

// Synthetic proofs only exercise official request encoding and local scope.
// These values never contact the live CAPTCHA service or a user's account.
const id = 'a'.repeat(32);
const token = 'NEC:aaaaaaaa:synthetic-local-proof';
const encoded = 'NEC%3Aaaaaaaaa%3Asynthetic-local-proof';
const deviceCode = createDeviceCode('verification-cookie-test-device');
function client(options = {}) {
  const requests = [];
  const value = new CoolapkClient({ deviceCode, ...options, fetchImpl: async (url, init) => {
    requests.push({ url, ...init });
    return Response.json({ data: [] });
  } });
  return { value, requests };
}

test('a completed guest proof travels as the official validate Cookie on a GET comment read', async () => {
  const { value, requests } = client();
  value.setVerificationCookie({ id, token });
  await value.dispatch('replies', { id: '101', page: 2, lastItem: '301' });
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].headers.Cookie, 'validate=' + encoded);
  assert.equal(requests[0].headers['X-App-Device'], deviceCode);
  assert.equal(requests[0].url.searchParams.get('page'), '2');
  assert.equal(requests[0].url.searchParams.get('lastItem'), '301');
  assert.equal(requests[0].url.searchParams.has('_v2_post_token'), false);
});

test('verification Cookie supplements the existing POST proof field without changing the body', async () => {
  const { value, requests } = client({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-account' });
  value.setVerificationCookie({ id, token });
  value.verification = { token, field: '_v2_post_token' };
  await value.request('/v6/feed/detail', { id: '101' }, { method: 'POST', form: { trace: '', original: 'original value' } });
  assert.equal(requests[0].headers.Cookie, 'SESSID=synthetic-account; validate=' + encoded);
  assert.deepEqual(Object.fromEntries(requests[0].body), { trace: '', original: 'original value', _v2_post_token: token });
});

test('request-specific Cookie overrides retain their account fields and replace every stale validate value', async () => {
  const { value, requests } = client({ cookie: 'SESSID=main-account' });
  value.setVerificationCookie({ id, token });
  await value.request('/v6/account/checkLoginInfo', {}, { cookie: 'Cookie: SESSID=override-account; validate=expired; marker=synthetic; validate=duplicate' });
  assert.equal(requests[0].headers.Cookie, 'SESSID=override-account; marker=synthetic; validate=' + encoded);
  assert.equal(value.cookie, 'SESSID=main-account');
});

test('Cookie proof encoding matches Java URLEncoder for reserved characters', async () => {
  const { value, requests } = client();
  value.setVerificationCookie({ id, token: "NEC:aaaaaaaa:synthetic~!()*'=+/:%" });
  await value.dispatch('replies', { id: '101' });
  assert.equal(requests[0].headers.Cookie, 'validate=NEC%3Aaaaaaaaa%3Asynthetic%7E%21%28%29*%27%3D%2B%2F%3A%25');
});

test('invalid or empty NEC proofs never install Cookie state or issue a request', () => {
  const { value, requests } = client();
  for (const input of [null, {}, { id: 'bad', token }, { id, token: 'NEC:bbbbbbbb:other-proof' }, { id, token: 'NEC:aaaaaaaa:' }, { id, token: 'NEC:aaaaaaaa:space proof' }, { id, token: 'NEC:aaaaaaaa:proof\r\nCookie: injected' }, { id, token: 'NEC:aaaaaaaa:proof;injected=x' }, { id, token: 'NEC:aaaaaaaa:proof\\suffix' }, { id, token: 'NEC:aaaaaaaa:' + 'x'.repeat(8192) }]) {
    assert.throws(() => value.setVerificationCookie(input), input === null ? TypeError : { code: 'INPUT' });
    assert.equal(value.getVerificationCookie(), null);
  }
  assert.equal(requests.length, 0);
});

test('matching account and device clones inherit runtime proof state', async () => {
  const first = client({ identity: { uid: '42' } });
  first.value.setVerificationCookie({ id, token });
  const copy = client({ identity: { uid: '42' }, verificationCookie: first.value.getVerificationCookie() });
  await copy.value.dispatch('replies', { id: '101' });
  assert.equal(copy.requests[0].headers.Cookie, 'validate=' + encoded);
});

test('another account or another device cannot inherit a proof', async () => {
  const first = client({ identity: { uid: '42' } });
  first.value.setVerificationCookie({ id, token });
  const state = first.value.getVerificationCookie();
  for (const options of [{ identity: { uid: '43' } }, { identity: null }, { identity: { uid: '42' }, deviceCode: createDeviceCode('other-device') }]) {
    const next = client({ ...options, verificationCookie: state });
    assert.equal(next.value.getVerificationCookie(), null);
    await next.value.dispatch('replies', { id: '101' });
    assert.equal(next.requests[0].headers.Cookie, undefined);
  }
});

test('an identity change clears runtime proof permanently instead of restoring it when the old UID returns', () => {
  const { value } = client({ identity: { uid: '42' } });
  value.setVerificationCookie({ id, token });
  value.identity = { uid: '43' };
  assert.equal(value.getVerificationCookie(), null);
  value.identity = { uid: '42' };
  assert.equal(value.getVerificationCookie(), null);
});

test('changing the bound device invalidates its old proof', () => {
  const { value } = client();
  value.setVerificationCookie({ id, token });
  value.deviceCode = createDeviceCode('changed-device');
  assert.equal(value.getVerificationCookie(), null);
});

test('proof state is private, copied on read and never included in client serialization', () => {
  const { value } = client();
  value.setVerificationCookie({ id, token });
  const state = value.getVerificationCookie();
  state.token = 'changed-by-reader';
  assert.equal(value.getVerificationCookie().token, token);
  assert.equal(JSON.stringify(value).includes('synthetic-local-proof'), false);
});

test('clearing proof restores ordinary account Cookie behavior', async () => {
  const { value, requests } = client({ cookie: 'SESSID=synthetic-account' });
  value.setVerificationCookie({ id, token });
  value.clearVerificationCookie();
  await value.dispatch('replies', { id: '101' });
  assert.equal(requests[0].headers.Cookie, 'SESSID=synthetic-account');
});

test('a new challenge proof replaces the previous Cookie instead of retaining both values', async () => {
  const { value, requests } = client();
  value.setVerificationCookie({ id, token });
  value.setVerificationCookie({ id: 'b'.repeat(32), token: 'NEC:bbbbbbbb:synthetic-renewed-proof' });
  await value.dispatch('replies', { id: '101' });
  assert.equal(requests[0].headers.Cookie, 'validate=NEC%3Abbbbbbbb%3Asynthetic-renewed-proof');
});

test('a verification proof does not make a newline-containing Cookie override valid', async () => {
  const { value, requests } = client();
  value.setVerificationCookie({ id, token });
  await assert.rejects(value.request('/v6/feed/replyList', {}, { cookie: 'SESSID=synthetic\r\nInjected: value' }), { code: 'INPUT' });
  assert.equal(requests.length, 0);
});

test('proof-bearing requests cannot redirect or choose a third-party endpoint', async () => {
  const { value, requests } = client();
  value.setVerificationCookie({ id, token });
  await assert.rejects(value.request('https://third-party.example/collect'), { code: 'INPUT' });
  assert.equal(requests.length, 0);
  await value.dispatch('replies', { id: '101' });
  assert.equal(requests[0].url.origin, 'https://api.coolapk.com');
  assert.equal(requests[0].redirect, 'error');
});

test('public-profile proof belongs to its separate guest reader and cannot appear on authenticated comments', async () => {
  const { value, requests } = client({ identity: { uid: '42' }, cookie: 'SESSID=synthetic-account' });
  const guest = value.getVerificationReader('publicUserProfile');
  assert.equal(guest, value.getVerificationReader('publicUserQr'));
  assert.notEqual(guest.deviceCode, value.deviceCode);
  assert.equal(guest.deviceCode, value.publicDeviceCode);
  assert.equal(guest.identity, null);
  assert.equal(guest.cookie, '');
  guest.setVerificationCookie({ id, token });
  await guest.request('/v6/user/profile', { uid: '77' });
  await value.dispatch('replies', { id: '101' });
  assert.equal(requests[0].headers.Cookie, 'validate=' + encoded);
  assert.equal(requests[1].headers.Cookie, 'SESSID=synthetic-account');
  assert.equal(value.getVerificationCookie(), null);
  assert.equal(value.getVerificationReader('replies'), value);
  assert.equal(value.getVerificationReader('publicInventedOperation'), value);
});

test('matching public proof clones preserve the original guest device and parent account scope', async () => {
  const first = client({ identity: { uid: '42' } });
  first.value.getPublicReader().setVerificationCookie({ id, token });
  const state = first.value.getPublicVerificationCookie();
  assert.equal(state.ownerUid, '42');
  assert.equal(state.uid, '');
  const copy = client({ identity: { uid: '42' }, publicDeviceCode: first.value.publicDeviceCode, publicVerificationCookie: state });
  assert.equal(copy.value.getPublicReader().requestCookie(), 'validate=' + encoded);
  assert.equal(copy.value.requestCookie(), '');
  assert.equal(copy.value.getPublicReader().deviceCode, first.value.getPublicReader().deviceCode);
});

test('a public proof cannot be cloned into another account or public device', () => {
  const first = client({ identity: { uid: '42' } });
  first.value.getPublicReader().setVerificationCookie({ id, token });
  const state = first.value.getPublicVerificationCookie();
  for (const options of [{ identity: { uid: '43' }, publicDeviceCode: first.value.publicDeviceCode }, { identity: { uid: '42' }, publicDeviceCode: createDeviceCode('different-public-device') }]) {
    const next = client({ ...options, publicVerificationCookie: state });
    assert.equal(next.value.getPublicVerificationCookie(), null);
    assert.equal(next.value.getPublicReader().requestCookie(), '');
  }
});

test('clearing or changing the account owner also clears its public guest proof', () => {
  const { value } = client({ identity: { uid: '42' } });
  value.getPublicReader().setVerificationCookie({ id, token });
  value.clearVerificationCookie();
  assert.equal(value.getPublicVerificationCookie(), null);
  value.getPublicReader().setVerificationCookie({ id, token });
  value.identity = { uid: '43' };
  assert.equal(value.getPublicVerificationCookie(), null);
  value.identity = { uid: '42' };
  assert.equal(value.getPublicVerificationCookie(), null);
  assert.equal(value.getPublicReader().requestCookie(), '');
});
