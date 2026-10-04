import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { CoolapkClient } from '../core/client.mjs';
import { REPLY_VISIBILITY_CONTRACTS } from '../core/reply-visibility.mjs';
import { replyVisibilityMatches, replyVisibilityPermission } from '../core/reply-visibility-models.mjs';
const { AccountScope } = createRequire(import.meta.url)('../electron/request-scope.cjs');
const identity = { uid: '123456' }, feed = { id: '101', uid: identity.uid };
const reply = { id: '201', fid: feed.id, feedUid: identity.uid, uid: '654321', block_status: 0, userHideReplyRemaining: '3', message: 'synthetic reply' };
const json = data => Response.json({ data });
function mock({ initial = reply, next, owner = feed, identity: account = identity, mutate } = {}) {
  const calls = []; let replyReads = 0;
  const client = new CoolapkClient({ identity: account, fetchImpl: async (url, init) => {
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: init.method, form: init.body == null ? null : Object.fromEntries(new URLSearchParams(init.body)) });
    if (url.pathname === '/v6/feed/replyDetail') return json(replyReads++ === 0 ? initial : next ?? initial);
    if (url.pathname === '/v6/feed/detail') return json(owner);
    if (['/v6/feed/hideReply', '/v6/feed/resumeHideReply'].includes(url.pathname)) return mutate ? mutate(url, init) : json('服务器模拟提示');
    throw new Error('Unexpected fixture route ' + url.pathname);
  }});
  return { client, calls, run: (args = { id: reply.id, feedId: feed.id, action: 'hide' }, operation = 'replyVisibilityUpdate') => client.dispatch(operation, args) };
}
const mutations = calls => calls.filter(call => /\/(hideReply|resumeHideReply)$/.test(call.path));

test('hide and resume retain both exact APK POST Query-id bindings, including no form encoding', () => {
  const bindings = JSON.parse(readFileSync(new URL('../research/apk-request-bindings.json', import.meta.url))).contracts;
  for (const contract of REPLY_VISIBILITY_CONTRACTS) {
    const binding = bindings.find(item => item.methodIndex === contract.methodIndex);
    assert.equal(binding.method, 'POST'); assert.equal('/v6/' + binding.endpoint, contract.endpoint); assert.equal(binding.encoding, 'none');
    assert.deepEqual(binding.parameters.flatMap(parameter => parameter.annotations.map(annotation => [annotation.kind, annotation.name])), [['Query', 'id']]);
  }
});

test('permission comes from original feed author, explicit String quota and official fid/block_status fields', () => {
  const context = { accountUid: identity.uid, feedId: feed.id, feedAuthorUid: identity.uid };
  assert.deepEqual(replyVisibilityPermission(reply, context), { visible: true, enabled: true, hidden: false, remaining: 3, action: 'hide', reason: '' });
  assert.equal(replyVisibilityPermission({ ...reply, block_status: 4 }, context).action, 'resume');
  for (const patch of [{ userHideReplyRemaining: undefined }, { userHideReplyRemaining: '' }, { userHideReplyRemaining: '1.5' }, { userHideReplyRemaining: '1e2' }, { userHideReplyRemaining: 3 }, { userHideReplyRemaining: '-1' }, { userHideReplyRemaining: '2147483648' }, { block_status: undefined, blockStatus: 4 }, { fid: undefined, feedid: feed.id }, { feedUid: undefined }, { feedUid: '654321' }]) assert.equal(replyVisibilityPermission({ ...reply, ...patch }, context).visible, false, JSON.stringify(patch));
  assert.equal(replyVisibilityPermission(reply, { ...context, accountUid: reply.uid }).visible, false, 'comment author is not feed author');
  assert.equal(replyVisibilityPermission(reply, { ...context, feedAuthorUid: '999999' }).visible, false);
  assert.equal(replyVisibilityPermission(reply, { feedId: feed.id }).visible, false);
  const exhausted = replyVisibilityPermission({ ...reply, block_status: 4, userHideReplyRemaining: '0' }, context);
  assert.equal(exhausted.visible, true); assert.equal(exhausted.enabled, false); assert.equal(exhausted.action, 'resume');
  assert.equal(replyVisibilityMatches({ blockStatus: 4 }, 'hide'), false);
});

test('native hide rereads ownership, posts only query id and confirms the same reply with quota allowed to reach zero', async () => {
  const subject = mock({ next: { ...reply, block_status: 4, userHideReplyRemaining: '0' } });
  const result = await subject.run();
  assert.equal(result.confirmed, true); assert.equal(result.data.reply.block_status, 4); assert.equal(result.data.permission.enabled, false);
  assert.deepEqual(subject.calls, [
    { path: '/v6/feed/replyDetail', query: { id: '201' }, method: 'GET', form: null },
    { path: '/v6/feed/detail', query: { id: '101' }, method: 'POST', form: { trace: '' } },
    { path: '/v6/feed/hideReply', query: { id: '201' }, method: 'POST', form: null },
    { path: '/v6/feed/replyDetail', query: { id: '201' }, method: 'GET', form: null },
    { path: '/v6/feed/detail', query: { id: '101' }, method: 'POST', form: { trace: '' } },
  ]);
});

test('native resume uses hidden block_status=4 and official quota rules, with no unrestricted cancel path', async () => {
  const hidden = { ...reply, block_status: 4 };
  const subject = mock({ initial: hidden, next: { ...reply, userHideReplyRemaining: '2' } });
  assert.equal((await subject.run({ id: reply.id, feedId: feed.id, action: 'resume' })).confirmed, true);
  assert.deepEqual(mutations(subject.calls), [{ path: '/v6/feed/resumeHideReply', query: { id: '201' }, method: 'POST', form: null }]);
  const exhausted = mock({ initial: { ...hidden, userHideReplyRemaining: '0' } });
  await assert.rejects(exhausted.run({ id: reply.id, feedId: feed.id, action: 'resume' }), error => error.code === 'REPLY_HIDE_LIMIT');
  assert.equal(mutations(exhausted.calls).length, 0);
});

test('strict arguments and guest identity reject before any network activity', async () => {
  for (const args of [{ id: '0', feedId: '101', action: 'hide' }, { id: '201', feedId: '101', action: 'delete' }, { id: '201', feedId: '101', action: 'hide', uid: identity.uid }, { id: '../201', feedId: '101', action: 'hide' }, { id: 9007199254740992, feedId: '101', action: 'hide' }, { id: '201', feedId: '101' }, { id: {}, feedId: '101', action: 'hide' }]) {
    const subject = mock(); await assert.rejects(subject.run(args), error => error.code === 'INPUT'); assert.equal(subject.calls.length, 0);
  }
  const guest = mock({ identity: null }); await assert.rejects(guest.run(), error => error.code === 'LOGIN_REQUIRED'); assert.equal(guest.calls.length, 0);
  const extraRead = mock(); await assert.rejects(extraRead.run({ id: '201', feedId: '101', action: 'hide' }, 'replyVisibility'), error => error.code === 'INPUT'); assert.equal(extraRead.calls.length, 0);
});

test('renderer-supplied IDs never grant ownership; stale/mismatched records and missing quota block mutations', async () => {
  for (const options of [{ initial: { ...reply, id: '202' } }, { initial: { ...reply, fid: '102' } }, { initial: { ...reply, feedUid: '777777' } }, { owner: { ...feed, uid: '777777' } }, { owner: { ...feed, uid: undefined } }, { owner: { ...feed, id: '102' } }, { initial: { ...reply, userHideReplyRemaining: undefined } }, { initial: { ...reply, userHideReplyRemaining: '0' } }]) {
    const subject = mock(options); await assert.rejects(subject.run(), error => ['API_ERROR', 'REPLY_VISIBILITY_UNAVAILABLE', 'REPLY_HIDE_LIMIT'].includes(error.code)); assert.equal(mutations(subject.calls).length, 0);
  }
});

test('read-only preparation cannot mutate or interpret range filters as author hiding', async () => {
  const subject = mock(); const result = await subject.run({ id: '201', feedId: '101' }, 'replyVisibility');
  assert.equal(result.data.permission.enabled, true); assert.equal(mutations(subject.calls).length, 0);
  const bad = mock(); await assert.rejects(bad.run({ id: '201', feedId: '101', hidden: true }, 'replyVisibility'), error => error.code === 'INPUT'); assert.equal(bad.calls.length, 0);
});

test('unknown success shape, conflicting readback and lost transport remain unconfirmed rather than inferred success', async () => {
  for (const options of [{ next: { ...reply, block_status: 0 } }, { next: { ...reply, block_status: 4, userHideReplyRemaining: undefined } }, { next: { ...reply, block_status: undefined, blockStatus: 4 } }, { next: { ...reply, id: '202', block_status: 4 } }, { mutate: () => json(1), next: { ...reply, block_status: 4 } }, { mutate: () => { throw new Error('synthetic lost response'); } }]) {
    const subject = mock(options); await assert.rejects(subject.run(), error => error.code === 'WRITE_UNCONFIRMED'); assert.equal(mutations(subject.calls).length, 1);
  }
});

test('explicit server rejection/challenge preserves its error without success readback or a second mutation', async () => {
  for (const payload of [{ status: -1, message: '今日次数已用完' }, { code: 403, message: '当前访问需要验证码', messageExtra: { captchaType: 'NEC', captchaId: 'abcdef0123456789abcdef0123456789', captchaField: '_v2_post_token' } }]) {
    const subject = mock({ mutate: () => Response.json(payload) });
    await assert.rejects(subject.run(), error => error.code === (payload.code === 403 ? 'VERIFY_REQUIRED' : 'API_ERROR'));
    assert.equal(mutations(subject.calls).length, 1); assert.equal(subject.calls.filter(call => call.path.endsWith('/replyDetail')).length, 1);
  }
});

test('confirmed target state after a lost response is idempotent and consumes no new quota', async () => {
  for (const [action, status] of [['hide', 4], ['resume', 0]]) {
    const subject = mock({ initial: { ...reply, block_status: status, userHideReplyRemaining: '0' } });
    const result = await subject.run({ id: reply.id, feedId: feed.id, action });
    assert.equal(result.unchanged, true); assert.equal(result.confirmed, true); assert.equal(mutations(subject.calls).length, 0);
  }
});

test('account switch while preparing ownership prevents write, and late final readback fails the native account scope', async () => {
  for (const holdIndex of [1, 5]) {
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    let reads = 0;
    const subject = mock({ next: { ...reply, block_status: 4 } });
    const originalFetch = subject.client.fetch;
    subject.client.fetch = async (...args) => { const response = await originalFetch(...args); if (++reads === holdIndex) { entered(); await new Promise(resolve => { release = resolve; }); } return response; };
    const scope = new AccountScope(), context = scope.capture(subject.client);
    const pending = context.client.dispatch('replyVisibilityUpdate', { id: reply.id, feedId: feed.id, action: 'hide' }).then(result => { scope.assert(context); return result; });
    await waiting; scope.changed(); subject.client.identity = { uid: '654321' }; release();
    await assert.rejects(pending, error => error.code === 'ACCOUNT_CHANGED'); assert.equal(mutations(subject.calls).length, holdIndex === 1 ? 0 : 1);
  }
});
