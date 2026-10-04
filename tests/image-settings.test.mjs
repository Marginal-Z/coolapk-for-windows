import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../core/client.mjs';
import { IMAGE_SETTINGS_OPERATIONS, dispatchImageSettings, imageWatermarkPatch, parseImageWatermarkSettings } from '../core/image-settings.mjs';
const values = { picture_watermark_position: '9', watermark_icon_type: '0', cool_picture_watermark_option: '0', hdr_watermark: '0' };
function fixture({ config = values, request } = {}) {
  let current = { ...config }; const calls = [];
  const client = { identity: { uid: '42' }, cookie: 'synthetic-only', deviceCode: 'synthetic-device', request: async (...args) => {
    calls.push(args); if (request) return request(args[0], args[1], args[2], client, calls.length);
    if (args[0].endsWith('/updateConfig')) { current = { ...current, ...JSON.parse(args[2].form.value) }; return { data: 'success' }; }
    return { data: { system_config: JSON.stringify(current), private_token: 'synthetic-must-not-return' } };
  } };
  return { client, calls, run: (operation, args) => dispatchImageSettings(client, operation, args) };
}
test('watermark operations reject guests before networking and keep unknown dispatch delegatable', async () => {
  const box = fixture(); box.client.identity = null;
  for (const operation of IMAGE_SETTINGS_OPERATIONS) await assert.rejects(box.run(operation), { code: 'LOGIN_REQUIRED' });
  assert.equal(await box.run('unrelated'), undefined); assert.equal(box.calls.length, 0);
});
test('cloud watermark reads use system_config and return only bounded confirmed native fields', async () => {
  const box = fixture(); const result = await box.run('imageWatermarkSettings');
  assert.deepEqual(box.calls, [['/v6/account/loadConfig', { key: 'system_config' }]]);
  assert.equal(result.data.enabled, true); assert.equal(result.data.position, '9'); assert.equal(result.data.iconType, '0');
  assert.equal(result.data.coolPictures, false); assert.equal(result.data.hdr, false);
  assert.equal(JSON.stringify(result).includes('synthetic-must-not-return'), false);
  const fresh = parseImageWatermarkSettings({ system_config: '' }); assert.equal(fresh.position, '9'); assert.deepEqual(fresh.present, []);
  assert.equal(parseImageWatermarkSettings({ system_config: JSON.stringify({ picture_watermark_position: 7, watermark_icon_type: 1, hdr_watermark: 1 }) }).hdr, true);
});
test('malformed or unfamiliar cloud fields cannot appear as successful defaults', () => {
  for (const data of [null, [], 'bad', { system_config: '{' }, { system_config: '[]' }, { system_config: 'x'.repeat(256 * 1024 + 1) }, ...[{ picture_watermark_position: null }, { picture_watermark_position: '6' }, { watermark_icon_type: '2' }, { hdr_watermark: true }, { cool_picture_watermark_option: 2 }].map(value => ({ system_config: JSON.stringify(value) }))]) assert.throws(() => parseImageWatermarkSettings(data), error => error.code === 'API_ERROR');
});
test('watermark patch rejects arbitrary system and privacy settings before writing', async () => {
  for (const patch of [null, [], {}, { position: 9 }, { position: '../9' }, { iconType: true }, { hdr: '1' }, { coolPictures: 1 }, { receive_message: '1' }, { position: '9', cookie: 'bad' }]) assert.throws(() => imageWatermarkPatch(patch), error => error.code === 'INPUT');
  const box = fixture(); await assert.rejects(box.run('imageWatermarkSettingsUpdate', { patch: { token: 'bad' } }), { code: 'INPUT' }); assert.equal(box.calls.length, 0);
});
test('native cloud update sends only changed fields and re-reads each field before reporting success', async () => {
  const box = fixture(); const result = await box.run('imageWatermarkSettingsUpdate', { patch: { position: '7', iconType: '1', coolPictures: true, hdr: false } });
  assert.deepEqual(box.calls[0], ['/v6/account/updateConfig', {}, { method: 'POST', form: { key: 'system_config', value: JSON.stringify({ picture_watermark_position: '7', watermark_icon_type: '1', cool_picture_watermark_option: '1', hdr_watermark: '0' }) } }]);
  assert.deepEqual(box.calls[1], ['/v6/account/loadConfig', { key: 'system_config' }]); assert.equal(result.data.position, '7'); assert.equal(result.data.coolPictures, true);
  await box.run('imageWatermarkSettingsUpdate', { patch: { position: '0' } });
  assert.deepEqual(JSON.parse(box.calls[2][2].form.value), { picture_watermark_position: '0' });
});
test('cloud rejection, stale values and omitted saved fields do not produce a save success', async () => {
  for (const rejected of [false, 0, null]) {
    const box = fixture({ request: async () => ({ data: rejected }) }); await assert.rejects(box.run('imageWatermarkSettingsUpdate', { patch: { hdr: true } }), { code: 'API_ERROR' }); assert.equal(box.calls.length, 1);
  }
  for (const config of [values, {}]) {
    const box = fixture({ request: async endpoint => endpoint.endsWith('/updateConfig') ? { data: 'success' } : { data: { system_config: JSON.stringify(config) } } });
    await assert.rejects(box.run('imageWatermarkSettingsUpdate', { patch: { hdr: true } }), { code: 'API_ERROR' });
  }
});
test('account, identity and cookie changes invalidate cloud results and stop further writes or reads', async () => {
  for (const changed of [client => { client.identity = { uid: '43' }; }, client => { client.identity.uid = '43'; }, client => { client.cookie = 'other-synthetic'; }]) {
    const box = fixture({ request: async (endpoint, query, options, client) => { changed(client); return { data: endpoint.endsWith('/updateConfig') ? 'success' : { system_config: JSON.stringify(values) } }; } });
    await assert.rejects(box.run('imageWatermarkSettingsUpdate', { patch: { hdr: true } }), { code: 'ACCOUNT_CHANGED' }); assert.equal(box.calls.length, 1);
  }
  const read = fixture({ request: async (endpoint, query, options, client) => { client.identity = { uid: '99' }; return { data: { system_config: JSON.stringify(values) } }; } });
  await assert.rejects(read.run('imageWatermarkSettings'), { code: 'ACCOUNT_CHANGED' });
});
test('retry after a saved-but-unverified request reuses the intended field and returns the subsequently observed state', async () => {
  let current = { ...values }, failRead = true;
  const box = fixture({ request: async (endpoint, query, options) => {
    if (endpoint.endsWith('/updateConfig')) { Object.assign(current, JSON.parse(options.form.value)); return { data: 'success' }; }
    if (failRead) { failRead = false; throw new ApiError('模拟读取失败', 'NETWORK'); }
    return { data: { system_config: JSON.stringify(current) } };
  } });
  const args = { patch: { position: '5' } }; await assert.rejects(box.run('imageWatermarkSettingsUpdate', args), { code: 'NETWORK' });
  const result = await box.run('imageWatermarkSettingsUpdate', args); assert.equal(result.data.position, '5');
  assert.equal(box.calls[0][2].form.value, box.calls[2][2].form.value);
});
