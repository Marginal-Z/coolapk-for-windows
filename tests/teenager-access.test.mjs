import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { TeenagerAccess } = createRequire(import.meta.url)('../electron/teenager-access.cjs');
function harness() {
  const calls = [], state = { enabled: false, blocked: false, reason: null }, snapshots = [];
  const store = { info: () => ({ ...state }), tick: () => ({ ...state }), setActive: () => ({ ...state }), enable: async () => { state.enabled = true; return { ...state }; }, disable: async () => { state.enabled = false; return { ...state }; } };
  const client = { cookie: 'isolated-account-cookie', identity: { uid: '101' }, request: async (...args) => { calls.push({ args, identity: client.identity }); return { data: [{ entityType: 'feed', id: '42' }] }; } };
  const access = new TeenagerAccess({ store, getClient: () => client,
    capture: base => ({ client: { ...base, request: async (...args) => {
      calls.push({ args, cookie: '', identity: null });
      return { data: args[0].endsWith('/detail') ? { id: args[1].id, message: '精选正文' } : [{ entityType: 'card', entities: [{ entityType: 'feed', id: '42' }] }] };
    } } }), assertCurrent: () => {}, onSnapshot: data => snapshots.push(data) });
  return { access, state, calls, snapshots };
}
test('enabled mode rejects every remaining privileged channel, including account, updates and external links', async () => {
  const { access, calls } = harness(); await access.dispatch('enable', { pin: '1234', confirmation: '1234' });
  for (const channel of ['coolapk:call', 'coolapk:login', 'coolapk:accounts', 'coolapk:select', 'coolapk:import', 'coolapk:verify', 'coolapk:updates', 'coolapk:report', 'coolapk:external', 'coolapk:downloads', 'coolapk:save-export', 'coolapk:desktop']) assert.throws(() => access.assertChannel(channel), { code: 'TEENAGER_RESTRICTED' });
  access.assertChannel('coolapk:teenager'); assert.equal(calls.length, 0);
});
test('only fixed guest youth content and IDs returned by that content can be read', async () => {
  const { access, calls } = harness(); await assert.rejects(access.dispatch('content'), { code: 'TEENAGER_RESTRICTED' }); await access.dispatch('enable', { pin: '1234', confirmation: '1234' });
  await assert.rejects(access.dispatch('detail', { id: '42' }), { code: 'TEENAGER_RESTRICTED' });
  const result = await access.dispatch('content', { page: 1 }); assert.equal(result.page, 1); assert.equal(result.hasMore, true); assert.deepEqual(calls[0].args, ['/v6/page/dataList', { url: 'V12_TEENAGER', page: 1 }]); assert.equal(calls[0].cookie, ''); assert.equal(calls[0].identity, null);
  await access.dispatch('detail', { id: '42' }); assert.deepEqual(calls[1].args, ['/v6/feed/detail', { id: '42' }, { method: 'POST', form: { trace: '' } }]);
  await assert.rejects(access.dispatch('content', { url: '/main/headline' }), { code: 'INPUT' }); await assert.rejects(access.dispatch('detail', { id: '43' }), { code: 'TEENAGER_RESTRICTED' }); assert.equal(calls.length, 2);
});
test('mode changes invalidate old authorized IDs and delayed reads; blocked clocks cannot fetch', async () => {
  const { access, state, calls } = harness(); await access.dispatch('enable', { pin: '1234', confirmation: '1234' }); await access.dispatch('content'); await access.dispatch('disable', { pin: '1234' }); await access.dispatch('enable', { pin: '1234', confirmation: '1234' });
  await assert.rejects(access.dispatch('detail', { id: '42' }), { code: 'TEENAGER_RESTRICTED' }); state.blocked = true; state.reason = 'night'; await assert.rejects(access.dispatch('content'), { code: 'TEENAGER_RESTRICTED' }); assert.equal(calls.length, 1);
  state.blocked = false; const original = access.capture; access.capture = base => { const context = original(base), request = context.client.request; context.client.request = async (...args) => { const result = await request(...args); state.blocked = true; return result; }; return context; };
  await assert.rejects(access.dispatch('content'), { code: 'TEENAGER_RESTRICTED' });
});
test('a failed identity logout cannot disable mode and transition failures still broadcast the safe enabled state', async () => {
  const { access, snapshots } = harness(); access.onTransition = () => { throw Error('隔离退出失败'); };
  await assert.rejects(access.dispatch('enable', { pin: '1234', confirmation: '1234' }), /隔离退出失败/); assert.equal(snapshots.at(-1).enabled, true);
  access.beforeDisable = () => { throw Error('隔离退出失败'); }; await assert.rejects(access.dispatch('disable', { pin: '1234' }), /隔离退出失败/); assert.equal(access.state().enabled, true);
});
test('a storage fault becoming enabled at runtime closes the ordinary scope before dispatch', () => {
  const { access, state, snapshots } = harness(); let reset = 0; access.onTransition = () => reset++;
  state.enabled = true; state.blocked = true; state.reason = 'state_error';
  assert.throws(() => access.assertChannel('coolapk:call'), { code: 'TEENAGER_RESTRICTED' }); assert.equal(reset, 1); assert.equal(access.epoch, 1); assert.equal(snapshots.at(-1).reason, 'state_error');
  access.state(); assert.equal(reset, 1);
});
test('curated image URLs are canonical, scoped to returned feeds and cleared on a mode change', async () => {
  const { access, state } = harness();
  const before = access.assertImage('https://image.coolapk.com/ordinary.png');
  await access.dispatch('enable', { pin: '1234', confirmation: '1234' });
  assert.throws(() => access.assertImage('https://image.coolapk.com/ordinary.png', before), { code: 'TEENAGER_RESTRICTED' });
  access.collectImages({ picArr: ['https://image.coolapk.com/curated.png', 'https://image.coolapk.com:443/default-port.png', 'https://example.com/foreign.png', 'https://username@image.coolapk.com/private.png'] });
  access.assertImage('https://image.coolapk.com/curated.png');
  access.assertImage('https://image.coolapk.com/default-port.png');
  assert.throws(() => access.assertImage('https://example.com/foreign.png'), { code: 'TEENAGER_RESTRICTED' });
  assert.throws(() => access.assertImage('https://image.coolapk.com/private.png'), { code: 'TEENAGER_RESTRICTED' });
  state.blocked = true; assert.throws(() => access.assertImage('https://image.coolapk.com/curated.png'), { code: 'TEENAGER_RESTRICTED' });
  state.blocked = false; await access.dispatch('disable', { pin: '1234' }); await access.dispatch('enable', { pin: '1234', confirmation: '1234' });
  assert.throws(() => access.assertImage('https://image.coolapk.com/curated.png'), { code: 'TEENAGER_RESTRICTED' });
});
