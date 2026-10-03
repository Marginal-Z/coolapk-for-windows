import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CoolapkClient, assertLogin } from '../core/client.mjs';
const require = createRequire(import.meta.url);
const { AccountScope } = require('../electron/request-scope.cjs');
const { OfficialLoginFlow, parseOfficialCallback, mergeLoginCookies } = require('../electron/login-flow.cjs');
const callback = 'https://account.coolapk.com/auth/callback?ac=access_token&code=synthetic-code';
const identity = { uid: '123456', username: '测试酷友', refreshToken: 'synthetic-token' };
const sessionCookie = { domain: 'account.coolapk.com', name: 'SESSID', value: 'synthetic-session' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
function setup(overrides = {}) {
  const state = { exchanges: 0, checks: 0, commits: [], active: true };
  const flow = new OfficialLoginFlow({
    getCookies: async () => [sessionCookie],
    exchange: async () => { state.exchanges++; return { data: identity }; },
    checkLogin: async () => { state.checks++; return { data: identity }; },
    assertIdentity: assertLogin,
    commit: (who, cookie) => state.commits.push({ who, cookie }),
    isActive: () => state.active,
    ...overrides,
  });
  return { flow, state };
}

test('login accepts only official callbacks and keeps encoded code / Cookie intact', () => {
  const url = new URL('https://www.coolapk.com/#/auth_callback');
  const params = new URLSearchParams({ ac: 'access_token', code: 'synthetic+code=', ck: 'SESSID=synthetic-session; uid=0' });
  url.hash = '/auth_callback?' + params;
  assert.deepEqual(parseOfficialCallback(url.toString()), { code: 'synthetic+code=', cookie: 'SESSID=synthetic-session; uid=0' });
  for (const value of ['https://account.coolapk.com.evil.test/auth/callback?ac=access_token&code=one', 'https://www.coolapk.com/feed/1?ac=access_token&code=one', 'http://account.coolapk.com/auth/callback?ac=access_token&code=one', 'https://other@account.coolapk.com/auth/callback?ac=access_token&code=one']) assert.equal(parseOfficialCallback(value), null);
});
test('official cookies override callback values by domain priority and omit deleted / expired sessions', () => {
  const cookies = [sessionCookie, { domain: '.coolapk.com', name: 'SESSID', value: 'synthetic-root' }, { domain: 'www.coolapk.com', name: 'SESSID', value: 'synthetic-web' }, { ...sessionCookie, value: 'deleted' }, { ...sessionCookie, value: 'synthetic-expired', expirationDate: 1 }, { domain: 'evil.test', name: 'other', value: 'synthetic-value' }];
  const cookie = mergeLoginCookies(cookies, 'SESSID=synthetic-callback; uid=0');
  assert.equal(cookie, 'SESSID=synthetic-session; uid=0');
  assert.equal(mergeLoginCookies([], 'SESSID=expired'), '');
  assert.equal(mergeLoginCookies([], 'SESSID=synthetic-session\r\nAuthorization: synthetic'), '');
});
test('duplicate navigation callbacks consume a one-time code once and prefer refreshToken', async () => {
  const pending = gate();
  const { flow, state } = setup({ exchange: async (code, cookie) => { state.exchanges++; assert.equal(code, 'synthetic-code'); assert.equal(cookie, 'SESSID=synthetic-session'); await pending.promise; return { data: { ...identity, token: 'synthetic-short-token' } }; } });
  const first = flow.complete(callback), second = flow.complete(callback); pending.release();
  await Promise.all([first, second]);
  assert.equal(state.exchanges, 1); assert.equal(state.commits.length, 1);
  assert.ok(state.commits[0].cookie.includes('token=synthetic-token'));
  assert.ok(!state.commits[0].cookie.includes('synthetic-short-token'));
});
test('a callback arriving before Cookie persistence can complete after the Cookie event', async () => {
  let cookies = [];
  const { flow, state } = setup({ getCookies: async () => cookies });
  assert.equal(await flow.complete(callback), false); assert.equal(state.exchanges, 0);
  cookies = [sessionCookie]; assert.equal(await flow.complete(), true); assert.equal(state.exchanges, 1);
});
test('a Cookie event during a pending read queues a second read instead of losing completion', async () => {
  const pending = gate(); let reads = 0;
  const { flow, state } = setup({ getCookies: async () => { if (++reads === 1) { await pending.promise; return []; } return [sessionCookie]; } });
  const first = flow.complete(callback), second = flow.complete(); pending.release();
  await Promise.all([first, second]); assert.equal(state.commits.length, 1); assert.equal(state.exchanges, 1);
});
test('an unavailable one-time code falls back to server validation of the same official session', async () => {
  const { flow, state } = setup({ exchange: async () => { state.exchanges++; throw new Error('authorization code unavailable'); } });
  assert.equal(await flow.complete(callback), true);
  assert.equal(state.exchanges, 1); assert.equal(state.checks, 1); assert.equal(state.commits.length, 1);
});
test('closing or replacing a login window discards its in-flight authorization result', async () => {
  const pending = gate();
  const { flow, state } = setup({ exchange: async () => { await pending.promise; return { data: identity }; } });
  const completion = flow.complete(callback);
  await Promise.resolve(); state.active = false; pending.release();
  assert.equal(await completion, false); assert.equal(state.commits.length, 0);
});
test('a rejected session neither saves a guest identity nor repeatedly consumes the same code', async () => {
  const { flow, state } = setup({ exchange: async () => { state.exchanges++; return { data: { uid: '0' } }; }, checkLogin: async () => { state.checks++; return { data: { uid: '0' } }; } });
  await assert.rejects(flow.complete(callback)); assert.equal(await flow.complete(callback), false);
  assert.equal(state.exchanges, 1); assert.equal(state.commits.length, 0);
});
test('account requests retain a credential snapshot and reject completion after switching back to the same uid', async () => {
  const scope = new AccountScope();
  const source = new CoolapkClient({ deviceCode: 'synthetic-device', cookie: 'SESSID=synthetic-first', identity, fetchImpl: async () => new Response('{"data":[]}') });
  const captured = scope.capture(source);
  source.cookie = 'SESSID=synthetic-second'; source.identity = { uid: '654321' }; scope.changed();
  assert.equal(captured.client.cookie, 'SESSID=synthetic-first'); assert.equal(captured.client.identity.uid, identity.uid);
  source.identity = identity; scope.changed();
  await assert.rejects((async () => { await captured.client.dispatch('home'); scope.assert(captured); })(), error => error.code === 'ACCOUNT_CHANGED');
  scope.assert(scope.capture(source));
});
