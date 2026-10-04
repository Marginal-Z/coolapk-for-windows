import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../core/client.mjs';
import { ACCOUNT_SETTING_DEFINITIONS, ACCOUNT_SETTING_KEYS, DEFAULT_ACCOUNT_SETTINGS, accountSettingConfirmation, accountSettingsPatch } from '../core/account-settings-models.mjs';
import { ACCOUNT_SETTINGS_OPERATIONS, dispatchAccountSettings, parseAccountSettings } from '../core/account-settings.mjs';
const nativeDefaults = Object.fromEntries(Object.entries(DEFAULT_ACCOUNT_SETTINGS).map(([key, value]) => [key, typeof value === 'boolean' ? value ? '1' : '0' : value]));
function fixture({ config = nativeDefaults, request } = {}) {
  let current = { ...config }; const calls = [];
  const client = { identity: { uid: '42' }, cookie: 'synthetic-only', deviceCode: 'synthetic-device', request: async (...args) => {
    calls.push(args); if (request) return request(args[0], args[1], args[2], client, calls.length);
    if (args[0].endsWith('/updateConfig')) { Object.assign(current, JSON.parse(args[2].form.value)); return { data: 'success' }; }
    return { data: { system_config: JSON.stringify(current), private_token: 'synthetic-must-not-return' } };
  } };
  return { client, calls, run: (operation, args) => dispatchAccountSettings(client, operation, args) };
}
test('guests are rejected before networking, unknown operations remain delegatable and read args cannot reset settings', async () => {
  const box = fixture(); box.client.identity = null;
  for (const operation of ACCOUNT_SETTINGS_OPERATIONS) await assert.rejects(box.run(operation), { code: 'LOGIN_REQUIRED' });
  assert.equal(await box.run('unrelated'), undefined); assert.equal(box.calls.length, 0);
  const signedIn = fixture();
  for (const args of [{ reSet: '1' }, { refresh: true }, { patch: {} }, [], null]) await assert.rejects(signedIn.run('accountSettings', args), { code: 'INPUT' });
  assert.equal(signedIn.calls.length, 0);
});
test('exact system_config read returns only the 20 confirmed fields and distinguishes native defaults from saved state', async () => {
  const box = fixture({ config: { receive_message: '-1', cookie: 'synthetic-secret', unverified_option: '1' } });
  const result = await box.run('accountSettings');
  assert.deepEqual(box.calls, [['/v6/account/loadConfig', { key: 'system_config' }]]);
  assert.equal(result.data.values.receive_message, '-1'); assert.deepEqual(result.data.present, ['receive_message']);
  assert.equal(result.data.values.subscribe_reply_notify, true); assert.equal(result.data.values.subscribe_special_follow_feed_notify, false);
  assert.equal(result.data.values.notification_ignore_like_count, false); assert.equal(result.data.values.net_abuse_guard, false);
  assert.equal(Object.keys(result.data.values).length, 20); assert.equal(JSON.stringify(result).includes('synthetic-'), false);
  for (const system_config of ['', null, undefined, '{}', {}]) assert.deepEqual(parseAccountSettings({ system_config }).values, DEFAULT_ACCOUNT_SETTINGS);
  assert.equal(parseAccountSettings({ system_config: { receive_like_notify: 1, receive_message: -1 } }).values.receive_like_notify, true);
});
test('malformed configs and unsupported explicit values cannot appear as successful defaults', () => {
  for (const data of [null, [], 'bad', { system_config: '{' }, { system_config: '[]' }, { system_config: 'x'.repeat(256 * 1024 + 1) }, ...[{ receive_like_notify: null }, { receive_like_notify: true }, { receive_like_notify: '2' }, { receive_at_message: '2' }, { receive_message: '' }, { feed_disallow_reply: '-2' }, { hidden_history_feed: '2' }, { net_abuse_guard_timestamp: -1 }, { net_abuse_guard_timestamp: 'Infinity' }, { net_abuse_guard_timestamp: '9007199254740992' }].map(system_config => ({ system_config }))]) assert.throws(() => parseAccountSettings(data), { code: 'API_ERROR' });
});
test('all native choice enums and boolean types are bounded; reply server sentinel is read-only', () => {
  for (const field of ACCOUNT_SETTING_DEFINITIONS) {
    const values = field.type === 'boolean' ? [false, true] : field.options.map(option => option.value);
    for (const value of values) assert.equal(accountSettingsPatch({ [field.key]: value }, 1000)[field.key], typeof value === 'boolean' ? value ? '1' : '0' : value);
  }
  assert.deepEqual(accountSettingsPatch({ net_abuse_guard: true }, 1000), { net_abuse_guard: '1', net_abuse_guard_timestamp: '605800' });
  assert.deepEqual(accountSettingsPatch({ net_abuse_guard: false }), { net_abuse_guard: '0' });
  assert.equal(parseAccountSettings({ system_config: { feed_disallow_reply: '-1' } }).replyLocked, true);
  assert.throws(() => accountSettingsPatch({ feed_disallow_reply: '-1' }), { code: 'INPUT' });
  assert.deepEqual(ACCOUNT_SETTING_KEYS.filter(key => key === 'net_abuse_guard_timestamp'), []);
});
test('arbitrary config/reset/credentials, caller timestamps, multiple settings and mismatched types reject without any network', async () => {
  const patches = [null, [], {}, { privacy_reset: true }, { reSet: true }, { read_clipboard: false }, { notification_vibrate: true }, { net_abuse_guard_timestamp: '1' }, { net_abuse_guard: true, net_abuse_guard_timestamp: '1' }, { receive_message: '0', cookie: 'bad' }, { receive_message: 0 }, { hidden_history_feed: true }, { subscribe_reply_notify: '0' }, { receive_like_notify: false, receive_follow_notify: false }];
  for (const patch of patches) { const box = fixture(); await assert.rejects(box.run('accountSettingsUpdate', { patch }), { code: 'INPUT' }); assert.equal(box.calls.length, 0); }
  const box = fixture(); await assert.rejects(box.run('accountSettingsUpdate', { patch: { receive_message: '1' }, reset: true }), { code: 'INPUT' }); assert.equal(box.calls.length, 0);
  assert.throws(() => accountSettingsPatch({ net_abuse_guard: true }, Infinity), { code: 'INPUT' });
});
test('saving uses confirmed one-key delta JSON inside a form, preserves unknown cloud fields, and reads before/after the write', async () => {
  const box = fixture({ config: { ...nativeDefaults, opaque_server_setting: 'do-not-replay', picture_watermark_position: '9' } });
  const result = await box.run('accountSettingsUpdate', { patch: { receive_message: '1' } });
  assert.deepEqual(box.calls, [
    ['/v6/account/loadConfig', { key: 'system_config' }],
    ['/v6/account/updateConfig', {}, { method: 'POST', form: { key: 'system_config', value: '{"receive_message":"1"}' } }],
    ['/v6/account/loadConfig', { key: 'system_config' }],
  ]);
  assert.equal(result.data.values.receive_message, '1'); assert.equal(result.data.present.includes('receive_message'), true);
  assert.equal(JSON.stringify(result).includes('opaque_server_setting'), false);
});
test('enable guard uses a generated seven-day timestamp and an already observed enabled guard never extends it on retry', async () => {
  const box = fixture(), start = Math.floor(Date.now() / 1000); const result = await box.run('accountSettingsUpdate', { patch: { net_abuse_guard: true } });
  const delta = JSON.parse(box.calls[1][2].form.value);
  assert.deepEqual(Object.keys(delta), ['net_abuse_guard', 'net_abuse_guard_timestamp']); assert.equal(delta.net_abuse_guard, '1');
  assert.ok(Number(delta.net_abuse_guard_timestamp) >= start + 604800 && Number(delta.net_abuse_guard_timestamp) <= Math.floor(Date.now() / 1000) + 604800);
  assert.equal(result.data.guardExpiresAt, Number(delta.net_abuse_guard_timestamp));
  await box.run('accountSettingsUpdate', { patch: { net_abuse_guard: true } }); assert.equal(box.calls.length, 4);
  await box.run('accountSettingsUpdate', { patch: { net_abuse_guard: false } }); assert.deepEqual(JSON.parse(box.calls[5][2].form.value), { net_abuse_guard: '0' });
});
test('fresh server guard and reply restriction prevent writes even if the renderer had older editable values', async () => {
  for (const key of ['receive_at_message', 'receive_message', 'feed_disallow_reply']) {
    const box = fixture({ config: { ...nativeDefaults, net_abuse_guard: '1' } });
    await assert.rejects(box.run('accountSettingsUpdate', { patch: { [key]: '1' } }), { code: 'SETTINGS_LOCKED' }); assert.equal(box.calls.length, 1);
  }
  const locked = fixture({ config: { ...nativeDefaults, feed_disallow_reply: '-1' } });
  await assert.rejects(locked.run('accountSettingsUpdate', { patch: { feed_disallow_reply: '0' } }), { code: 'SETTINGS_LOCKED' }); assert.equal(locked.calls.length, 1);
});
test('a missing key with the same default must be explicitly saved; an explicitly observed match is idempotent', async () => {
  const fresh = fixture({ config: {} }); await fresh.run('accountSettingsUpdate', { patch: { receive_like_notify: true } }); assert.equal(fresh.calls.length, 3);
  const existing = fixture(); const result = await existing.run('accountSettingsUpdate', { patch: { receive_like_notify: true } }); assert.equal(existing.calls.length, 1); assert.equal(result.data.values.receive_like_notify, true);
});
test('false rejection, stale or missing fields and failed readback never report saved state', async () => {
  for (const rejected of [false, 0]) {
    const box = fixture({ request: async endpoint => ({ data: endpoint.endsWith('/updateConfig') ? rejected : { system_config: nativeDefaults } }) });
    await assert.rejects(box.run('accountSettingsUpdate', { patch: { receive_like_notify: false } }), { code: 'API_ERROR' }); assert.equal(box.calls.length, 2);
  }
  for (const config of [nativeDefaults, {}]) {
    const box = fixture({ request: async endpoint => ({ data: endpoint.endsWith('/updateConfig') ? 'success' : { system_config: config } }) });
    await assert.rejects(box.run('accountSettingsUpdate', { patch: { receive_like_notify: false } }), { code: 'SETTINGS_UNCONFIRMED' }); assert.equal(box.calls.length, 3);
  }
  const failed = fixture({ request: async (endpoint, query, options, client, count) => { if (count === 3) throw new ApiError('synthetic read failure', 'NETWORK'); return { data: endpoint.endsWith('/updateConfig') ? 'success' : { system_config: nativeDefaults } }; } });
  await assert.rejects(failed.run('accountSettingsUpdate', { patch: { receive_like_notify: false } }), { code: 'SETTINGS_UNCONFIRMED' });
});
test('uncertain POST failures are not automatically retried, but verification challenges keep their explicit flow', async () => {
  for (const code of ['NETWORK', 'HTTP', 'VERIFY_REQUIRED']) {
    const box = fixture({ request: async endpoint => { if (endpoint.endsWith('/updateConfig')) throw new ApiError('synthetic POST error', code); return { data: { system_config: nativeDefaults } }; } });
    await assert.rejects(box.run('accountSettingsUpdate', { patch: { receive_like_notify: false } }), { code: code === 'VERIFY_REQUIRED' ? code : 'SETTINGS_UNCONFIRMED' }); assert.equal(box.calls.length, 2);
  }
});
test('a readback challenge can resume an already saved change without sending the POST twice', async () => {
  let current = { ...nativeDefaults }, challenge = true;
  const box = fixture({ request: async (endpoint, query, options, client, count) => {
    if (endpoint.endsWith('/updateConfig')) { Object.assign(current, JSON.parse(options.form.value)); return { data: 'success' }; }
    if (count === 3 && challenge) { challenge = false; throw new ApiError('synthetic verification', 'VERIFY_REQUIRED'); }
    return { data: { system_config: current } };
  } });
  const args = { patch: { receive_follow_notify: false } }; await assert.rejects(box.run('accountSettingsUpdate', args), { code: 'VERIFY_REQUIRED' });
  assert.equal((await box.run('accountSettingsUpdate', args)).data.values.receive_follow_notify, false);
  assert.equal(box.calls.filter(call => call[0].endsWith('/updateConfig')).length, 1);
});
test('account identity, UID, cookie or device changes invalidate each awaited boundary and stop further requests', async () => {
  const mutate = [client => { client.identity = { uid: '43' }; }, client => { client.identity.uid = '43'; }, client => { client.cookie = 'another-synthetic'; }, client => { client.deviceCode = 'another-device'; }];
  for (const change of mutate) for (const boundary of [1, 2, 3]) {
    const box = fixture({ request: async (endpoint, query, options, client, count) => { if (count === boundary) change(client); return { data: endpoint.endsWith('/updateConfig') ? 'success' : { system_config: { ...nativeDefaults, receive_like_notify: count === 3 ? '0' : '1' } } }; } });
    await assert.rejects(box.run('accountSettingsUpdate', { patch: { receive_like_notify: false } }), { code: 'ACCOUNT_CHANGED' }); assert.equal(box.calls.length, boundary);
  }
  const failedOldRead = fixture({ request: async (endpoint, query, options, client) => { client.identity = { uid: '43' }; throw new ApiError('synthetic previous account error', 'NETWORK'); } });
  await assert.rejects(failedOldRead.run('accountSettings'), { code: 'ACCOUNT_CHANGED' }); assert.equal(failedOldRead.calls.length, 1);
});
test('native destructive/interaction confirmations are precise while ordinary subscriptions remain directly editable', () => {
  assert.match(accountSettingConfirmation('net_abuse_guard', true).message, /2小时/);
  assert.match(accountSettingConfirmation('record_hit_history', false).message, /清空已有/);
  assert.match(accountSettingConfirmation('record_recent_history', false).message, /清空已有/);
  assert.match(accountSettingConfirmation('feed_disallow_reply', '2').message, /回复权限/);
  assert.equal(accountSettingConfirmation('feed_disallow_reply', '0'), null); assert.equal(accountSettingConfirmation('subscribe_reply_notify', true), null);
});
