import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { CoolapkClient } from '../core/client.mjs';
import { createDeviceCode } from '../core/auth.mjs';

const { AccountScope } = createRequire(import.meta.url)('../electron/request-scope.cjs');
const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const challenge = (id = 'a'.repeat(32)) => Response.json({ code: 403, message: '当前访问需要验证码', messageExtra: { captchaType: 'NEC', captchaId: id, captchaField: '_v2_post_token' } });
const success = () => Response.json({ data: [{ id: '920', entityType: 'feedReply', message: '公开评论' }] });

// Execute the production IPC request/verification functions and real client.
// Only the native captcha window and server are synthetic; no proof is obtained
// or fabricated for a live service and no account storage is opened.
function harness(respond, options = {}) {
  const windows = [], requests = [], ipcMain = new EventEmitter();
  const accountScope = new AccountScope();
  let nonce = 0;
  class Window extends EventEmitter {
    constructor(config) {
      super(); this.config = config; this.dead = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
      windows.push(this);
    }
    isDestroyed() { return this.dead; }
    close() { if (!this.dead) { this.dead = true; this.emit('closed'); } }
    async loadFile(file, options) { this.captcha = options.query.captcha; }
  }
  const client = new CoolapkClient({ deviceCode: createDeviceCode('synthetic-public-comment-device'), ...options, fetchImpl: async (url, init) => {
    const entry = { path: url.pathname, query: Object.fromEntries(url.searchParams), method: init.method, cookie: init.headers.Cookie, device: init.headers['X-App-Device'], form: Object.fromEntries(new URLSearchParams(init.body)) };
    requests.push(entry); return respond(entry, requests.length);
  } });
  const sandbox = { client, accountScope, BrowserWindow: Window, ipcMain, applicationIcon: '', main: null, path: { join: (...values) => values.join('/') }, __dirname: 'electron', createHash, randomUUID: () => 'synthetic-' + ++nonce, verificationRequests: new Map(), verifiedResponses: new Map(), verificationWindows: new Set(), Date, setTimeout, clearTimeout, store: { updatePublicIdentity: () => false } };
  vm.createContext(sandbox);
  const start = source.indexOf('const requestKey ='), end = source.indexOf('async function importCookie(', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end) + ';globalThis.call=callApi;globalThis.verify=verifyRequest;', sandbox);
  const complete = (window = windows.at(-1), value = `NEC:${window.captcha.slice(0, 8)}:synthetic-local-proof`) => {
    const marker = window.config.webPreferences.additionalArguments[0].slice('--verification-id='.length);
    ipcMain.emit('coolapk:verified', { sender: window.webContents, senderFrame: window.webContents.mainFrame }, marker, value);
  };
  return { sandbox, windows, requests, complete, call: sandbox.call, verify: sandbox.verify, scope: accountScope };
}
async function getChallenge(h, operation = 'replies', args = { id: '101', sort: 'popular', page: 2, firstItem: '701', lastItem: '702' }) {
  let error;
  try { await h.call(operation, args); } catch (caught) { error = caught; }
  assert.equal(error?.code, 'VERIFY_REQUIRED'); assert.ok(error.verificationId);
  return { error, args, operation };
}

test('guest comment reads preserve the ordinary device, empty cookie and read-only APK routes', async () => {
  const h = harness(() => success());
  for (const [operation, args] of [['replies', { id: '101', sort: 'popular' }], ['subReplies', { id: '101', rid: '201' }], ['advancedReplies', { id: '101', sort: 'dateline_desc', authorOnly: true }], ['hotReplies', { id: '101' }]]) await h.call(operation, args);
  assert.ok(h.requests.every(request => request.method === 'GET' && request.cookie === undefined));
  assert.equal(new Set(h.requests.map(request => request.device)).size, 1);
  assert.deepEqual(h.requests.map(request => request.path), ['/v6/feed/replyList', '/v6/feed/replyList', '/v6/feed/replyList', '/v6/feed/hotReplyList']);
  assert.equal(h.requests[1].query.id, '201'); assert.equal(h.requests[1].query.feedType, 'feed_reply');
  const before = h.requests.length;
  for (const type of ['reply', 'likeReply', 'deleteReply']) await assert.rejects(h.call('action', { type, id: '201', message: '不能由游客发送' }), { code: 'LOGIN_REQUIRED' });
  assert.equal(h.requests.length, before);
});

test('guest verification replays only the challenged page and hands its result to the original read once', async () => {
  const h = harness(request => request.cookie === 'validate=NEC%3Aaaaaaaaa%3Asynthetic-local-proof' ? success() : challenge());
  const { error, args } = await getChallenge(h);
  const validating = h.verify(error.verificationId); h.complete();
  assert.equal((await validating).verified, true);
  const result = await h.call('replies', args); assert.equal(result.data[0].message, '公开评论');
  assert.equal(h.requests.length, 2);
  const [initial, replay] = h.requests;
  assert.equal(initial.cookie, undefined); assert.equal(replay.cookie, 'validate=NEC%3Aaaaaaaaa%3Asynthetic-local-proof'); assert.equal(replay.device, initial.device); assert.equal(replay.method, 'GET');
  assert.deepEqual(replay.query, { ...initial.query, _v2_post_token: 'NEC:aaaaaaaa:synthetic-local-proof' });
  assert.equal(h.sandbox.client.verification, undefined);
  await assert.rejects(h.verify(error.verificationId), /过期/);
});

test('a renewed official challenge is delivered with a fresh ID instead of replaying the spent proof', async () => {
  const h = harness((request, index) => index === 1 ? challenge() : index === 2 ? challenge('b'.repeat(32)) : success());
  const original = await getChallenge(h);
  const validating = h.verify(original.error.verificationId); h.complete();
  assert.equal((await validating).retryRequired, true);
  const renewed = await getChallenge(h, 'replies', original.args);
  assert.notEqual(renewed.error.verificationId, original.error.verificationId);
  assert.equal(h.requests.length, 2); await assert.rejects(h.verify(original.error.verificationId), /过期/);
  const next = h.verify(renewed.error.verificationId); h.complete(); await next;
  assert.equal((await h.call('replies', original.args)).data[0].id, '920'); assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].query._v2_post_token, 'NEC:bbbbbbbb:synthetic-local-proof');
  assert.equal(h.requests[2].cookie, 'validate=NEC%3Abbbbbbbb%3Asynthetic-local-proof');
});

test('a completed proof is retained by fresh comment-page scopes without copying the temporary query field', async () => {
  const h = harness(request => request.cookie === 'validate=NEC%3Aaaaaaaaa%3Asynthetic-local-proof' ? success() : challenge());
  const { error, args } = await getChallenge(h);
  const validating = h.verify(error.verificationId); h.complete(); await validating;
  await h.call('replies', args);
  await h.call('replies', { ...args, page: 3, lastItem: '920' });
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].cookie, 'validate=NEC%3Aaaaaaaaa%3Asynthetic-local-proof');
  assert.equal(h.requests[2].query.page, '3');
  assert.equal(h.requests[2].query._v2_post_token, undefined);
  assert.equal(h.requests[2].device, h.requests[0].device);
});

test('authenticated replay merges the in-memory validate Cookie and keeps the original POST form', async () => {
  const expected = 'SESSID=synthetic-account-only; validate=NEC%3Aaaaaaaaa%3Asynthetic-local-proof';
  const h = harness(request => request.cookie === expected ? success() : challenge(), { identity: { uid: '42' }, cookie: 'SESSID=synthetic-account-only' });
  const { error, args } = await getChallenge(h, 'detail', { id: '101' });
  const validating = h.verify(error.verificationId); h.complete(); await validating;
  await h.call('detail', args);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].method, 'POST');
  assert.equal(h.requests[1].cookie, expected);
  assert.deepEqual(h.requests[1].form, { trace: '', _v2_post_token: 'NEC:aaaaaaaa:synthetic-local-proof' });
  assert.equal(h.sandbox.client.cookie, 'SESSID=synthetic-account-only');
});

test('network failure after verification returns its real read error and cannot reuse the spent challenge', async () => {
  const h = harness((request, index) => { if (index === 1) return challenge(); throw new Error('synthetic network failure'); });
  const { error, args } = await getChallenge(h);
  const validating = h.verify(error.verificationId); h.complete(); await validating;
  await assert.rejects(h.call('replies', args), { code: 'NETWORK' }); assert.equal(h.requests.length, 2);
  await assert.rejects(h.verify(error.verificationId), /过期/); assert.equal(h.requests.length, 2);
});

test('uncertain authenticated comment replay reaches the no-resend caller without issuing another POST', async () => {
  const h = harness((request, index) => { if (index === 1) return challenge(); throw new Error('response lost after POST'); }, { identity: { uid: '42' }, cookie: 'SESSID=synthetic-account-only' });
  const args = { type: 'reply', id: '101', rid: '201', message: '只允许合成服务接收' };
  const { error } = await getChallenge(h, 'action', args);
  const validating = h.verify(error.verificationId); h.complete(); await validating;
  await assert.rejects(h.call('action', args), { code: 'WRITE_UNCONFIRMED' });
  assert.equal(h.requests.length, 2); assert.ok(h.requests.every(request => request.method === 'POST'));
  await assert.rejects(h.verify(error.verificationId), /过期/); assert.equal(h.requests.length, 2);
});

test('one verification window owns a challenge and cancelling lets the user try that unused challenge again', async () => {
  const h = harness(() => challenge()); const { error } = await getChallenge(h);
  const first = h.verify(error.verificationId);
  await assert.rejects(h.verify(error.verificationId), /正在验证/); assert.equal(h.windows.length, 1);
  h.windows[0].close(); await assert.rejects(first, /取消/); assert.equal(h.requests.length, 1);
  const second = h.verify(error.verificationId); assert.equal(h.windows.length, 2);
  h.windows[1].close(); await assert.rejects(second, /取消/); assert.equal(h.requests.length, 1);
});

test('proof for another challenge is rejected before any replay and untrusted completion cannot resolve the window', async () => {
  const h = harness(() => challenge()); const { error } = await getChallenge(h);
  const first = h.verify(error.verificationId); h.complete(h.windows[0], 'NEC:bbbbbbbb:synthetic-other-proof');
  await assert.rejects(first, /凭证无效/); assert.equal(h.requests.length, 1);
  const second = h.verify(error.verificationId), window = h.windows[1];
  const marker = window.config.webPreferences.additionalArguments[0].slice('--verification-id='.length);
  h.sandbox.ipcMain.emit('coolapk:verified', { sender: {}, senderFrame: window.webContents.mainFrame }, marker, 'NEC:aaaaaaaa:synthetic-local-proof');
  h.sandbox.ipcMain.emit('coolapk:verified', { sender: window.webContents, senderFrame: {} }, marker, 'NEC:aaaaaaaa:synthetic-local-proof');
  h.sandbox.ipcMain.emit('coolapk:verified', { sender: window.webContents, senderFrame: window.webContents.mainFrame }, 'wrong-window-nonce', 'NEC:aaaaaaaa:synthetic-local-proof');
  window.close(); await assert.rejects(second, /取消/); assert.equal(h.requests.length, 1);
});

test('account changes during guest verification reject both the proof and late replay', async () => {
  const h = harness(() => challenge()); const { error } = await getChallenge(h);
  const validating = h.verify(error.verificationId); h.scope.changed(); h.complete();
  await assert.rejects(validating, { code: 'ACCOUNT_CHANGED' }); assert.equal(h.requests.length, 1);
  assert.equal(h.sandbox.verifiedResponses.size, 0);
});

test('account changes during the verified network read discard the late outcome and cache no guest result', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const h = harness((request, index) => index === 1 ? challenge() : response);
  const { error } = await getChallenge(h);
  const validating = h.verify(error.verificationId); h.complete();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.requests.length, 2);
  h.scope.changed(); release(success());
  await assert.rejects(validating, { code: 'ACCOUNT_CHANGED' }); assert.equal(h.sandbox.verifiedResponses.size, 0);
});

test('an expired challenge is not resurrected by a late successful manual completion', async () => {
  const h = harness(() => challenge()); const { error } = await getChallenge(h);
  const validating = h.verify(error.verificationId);
  h.sandbox.verificationRequests.get(error.verificationId).deadline = Date.now() - 1; h.complete();
  await assert.rejects(validating, /过期/); assert.equal(h.requests.length, 1);
  assert.equal(h.sandbox.verificationRequests.has(error.verificationId), false);
});
