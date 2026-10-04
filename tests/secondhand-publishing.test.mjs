import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, CoolapkClient } from '../core/client.mjs';
import { prepareSecondhand } from '../core/secondhand-publishing-models.mjs';
import { dispatchSecondhandPublishing, parseSecondhandConfig, serializeSecondhandSelections } from '../core/secondhand-publishing.mjs';

const photo = 'https://image.coolapk.com/feed/2026/100.png';
const input = { title: '测试闲置', message: '实拍描述', pic: photo, categoryId: '100', price: '123.456', link: 'https://2.taobao.com/item?id=1', storeType: 2 };
const feed = (patch = {}) => ({ id: '81', uid: '42', feedType: 'ershou', message_title: '原标题', message_source: '原正文', picArr: [photo], publish_status: 1, original_type: 2, long_location: '完整地址', tid: '7000000077', enableModify: 1, ershou_info: { feed_id: '81', ershou_status: 1, store_type: 2, deal_type: 0, ershou_type_id: 100, ershou_product_id: '77', product_price: '99', exchange_price_type: 0, is_face_deal: 0, link_url: input.link, product_config_source: '{"ram":{"value":"12GB","other":"0"}}', city: '杭州', province: '浙江', city_code: '330100' }, ...patch });
const manual = { data: [{ entityType: 'deviceParams', key: 'ram', title: '内存', checkBox: 1, option: ['8GB', '12GB', '其他'] }, { entityType: 'deviceParams', key: 'extra', title: '附加说明', checkBox: 0, option: ['保修', '有发票', '其他'] }] };
function fixture(options = {}) {
  let agreed = options.agreed ?? true, currentClosed = false;
  const calls = [], client = { identity: { uid: '42' }, cookie: 'synthetic-session', deviceCode: 'synthetic-device',
    validatePictures: async pic => { if (options.pictures) return options.pictures(pic, client); return pic; },
    request: async (endpoint, query = {}, config) => {
      calls.push([endpoint, query, ...(config ? [config] : [])]);
      if (options.request) return options.request(endpoint, query, config, client, calls.length);
      if (endpoint.endsWith('/checkAgree')) { if (!agreed) throw new ApiError('请先同意', 'API_ERROR', { serverStatus: -1 }); return { data: 0 }; }
      if (endpoint.endsWith('/agreement')) { agreed = true; return { data: 0 }; }
      if (endpoint.endsWith('/agreementDetail')) return { data: '<p>二手交易协议</p>' };
      if (endpoint.endsWith('/categoryList')) return { data: [{ entityType: 'ershouCategory', id: '100', title: '手机' }] };
      if (endpoint.endsWith('/configList')) return { data: [{ entityType: 'deviceParams', configId: '3', title: '原厂配置', ram: '12GB', rom: '256GB' }] };
      if (endpoint.endsWith('/config')) return manual;
      if (endpoint.endsWith('/checkUrl')) return { data: config.form.ershou_link };
      if (endpoint.endsWith('/changeDetail') || endpoint.endsWith('/detail')) return { data: options.feed ?? feed({ ershou_info: { ...feed().ershou_info, ershou_status: currentClosed ? -1 : 1 } }) };
      if (endpoint.endsWith('/changeStatus')) { currentClosed = true; return { data: feed({ ershou_info: { ...feed().ershou_info, ershou_status: -1 } }) }; }
      if (endpoint.endsWith('/createFeed') || endpoint.endsWith('/changeFeed')) return { data: feed({ message_source: config.form.message }) };
      throw new Error(endpoint);
    },
  };
  return { client, calls, run: (operation, args) => dispatchSecondhandPublishing(client, operation, args) };
}
test('native publishing limits and all recovered sale/purchase/exchange fields are bounded before any network', () => {
  const prepared = prepareSecondhand(input); assert.equal(prepared.price, '123.456'); assert.equal(prepared.title, input.title);
  assert.equal(prepareSecondhand({ ...input, priceType: 3 }).price, '');
  assert.equal(prepareSecondhand({ ...input, dealType: 1, link: '' }).link, '');
  for (const value of [{ ...input, title: 'a'.repeat(51) }, { ...input, message: '  ' }, { ...input, pic: '' }, { ...input, pic: Array(10).fill(photo).join(',') }, { ...input, pic: photo + ',' }, { ...input, dealType: 3 }, { ...input, storeType: 0 }, { ...input, dealType: 2, storeType: 1 }, { ...input, priceType: 4 }, { ...input, price: '-1' }, { ...input, link: '' }, { ...input, link: 'javascript:alert(1)' }, { ...input, link: 'https://account:secret@2.taobao.com/' }, { ...input, raw: '{}' }, { ...input, configuration: { type: 'preserve' } }, { ...input, categoryId: '104', configuration: { type: 'preset', id: '3' } }, { ...input, location: { latitude: 91 } }]) assert.throws(() => prepareSecondhand(value), { code: 'INPUT' });
});
test('unknown operations are ignored, guests and unknown argument fields reject before reads', async () => {
  const box = fixture(); assert.equal(await box.run('unknown'), undefined); box.client.identity = {}; await assert.rejects(box.run('secondhandPublishCategories'), { code: 'LOGIN_REQUIRED' }); assert.equal(box.calls.length, 0);
  const user = fixture(); for (const [op, args] of [['secondhandCreate', { input, cookie: 'bad' }], ['secondhandClose', { id: '81', confirmed: false }], ['secondhandEdit', { id: '81', patch: { raw: '{}' } }], ['secondhandAcceptAgreement', { confirmed: false }]]) await assert.rejects(user.run(op, args), { code: 'INPUT' }); assert.equal(user.calls.length, 0);
});
test('dynamic config is bound to official category/deal/product queries; native category104 needs no config request', async () => {
  const box = fixture(); const result = await box.run('secondhandPublishConfig', { categoryId: '100', productId: '77', dealType: 2 });
  assert.deepEqual(box.calls, [['/v6/erShou/config', { productId: '77', ershouTypeId: '100', ershou_deal_type: '2' }]]);
  assert.deepEqual(result.data.map(group => [group.key, group.required, group.single, group.allowOther]), [['ram', true, true, true], ['extra', false, false, true]]);
  assert.deepEqual(await box.run('secondhandPublishConfig', { categoryId: '104' }), { data: [] }); assert.equal(box.calls.length, 1);
  for (const row of [{ key: 'unknown', checkBox: 0 }, { key: '__proto__' }, { option: ['8GB', '8GB'] }, { checkBox: null }]) assert.throws(() => parseSecondhandConfig({ data: [{ ...manual.data[0], ...row }] }), { code: 'UNSUPPORTED' });
});
test('manual config reproduces the native string flags, custom Other text and extra arrays without accepting renderer JSON', () => {
  const groups = parseSecondhandConfig(manual);
  assert.deepEqual(JSON.parse(serializeSecondhandSelections(groups, { ram: [{ value: '16GB', other: true }], extra: [{ value: '保修' }, { value: '带保护壳', other: true }] })), { ram: { value: '16GB', other: '1' }, extra: { value: ['保修', '带保护壳'] } });
  for (const selections of [{}, { ram: [{ value: '16GB' }] }, { ram: [{ value: '其他' }] }, { ram: [{ value: '8GB' }, { value: '12GB' }] }, { ram: [{ value: '8GB', other: '1' }] }, { ram: [{ value: '8GB', raw: 'bad' }] }, { ram: [{ value: '8GB' }], unknown: [] }, { ram: [{ value: '8GB' }], extra: [{ value: '保修' }, { value: '保修' }] }]) assert.throws(() => serializeSecondhandSelections(groups, selections), { code: 'INPUT' });
});
test('successful checkAgree means accepted even with data0; only status-1 is an agreement prompt', async () => {
  assert.deepEqual(await fixture().run('secondhandAgreementState'), { data: { accepted: true } });
  const pending = fixture({ agreed: false }); assert.deepEqual(await pending.run('secondhandAgreementState'), { data: { accepted: false } });
  for (const error of [new ApiError('fail', 'NETWORK'), new ApiError('denied', 'API_ERROR', { serverStatus: -2 }), new ApiError('unknown', 'API_ERROR')]) await assert.rejects(fixture({ request: async () => { throw error; } }).run('secondhandAgreementState'), { code: error.code });
  const detail = await fixture().run('secondhandAgreementDetail'); assert.equal(detail.data.minimumReadSeconds, 10.5); assert.match(detail.data.html, /协议/);
});
test('agreement acceptance is explicit GET write, reads before/after and never auto-accepts on publication', async () => {
  const box = fixture({ agreed: false }); await assert.rejects(box.run('secondhandCreate', { input }), { code: 'AGREEMENT_REQUIRED' }); assert.equal(box.calls.some(([url]) => url.endsWith('/agreement')), false); assert.equal(box.calls.some(([url]) => url.endsWith('/createFeed')), false);
  await box.run('secondhandAcceptAgreement', { confirmed: true }); assert.deepEqual(box.calls.slice(-3).map(([url]) => url), ['/v6/erShou/checkAgree', '/v6/erShou/agreement', '/v6/erShou/checkAgree']);
  const observed = box.calls.length; await box.run('secondhandAcceptAgreement', { confirmed: true }); assert.equal(box.calls.length, observed + 1);
  const failed = fixture({ request: async (url, _query, _config, _client, count) => { if (count === 1) throw new ApiError('agree first', 'API_ERROR', { serverStatus: -1 }); if (count === 2) return { data: 0 }; throw new ApiError('read failed', 'NETWORK'); } }); await assert.rejects(failed.run('secondhandAcceptAgreement', { confirmed: true }), { code: 'WRITE_UNCONFIRMED' }); assert.equal(failed.calls.length, 3);
});
test('creation sends exact verified form fields and independent product association only for product-origin entry', async () => {
  const box = fixture(); await box.run('secondhandCreate', { input: { ...input, productId: '77', origin: 'product', priceType: 3, visibility: 'self', location: { city: '杭州', province: '浙江', cityCode: '330100' } } });
  const [url, query, options] = box.calls.at(-1); assert.equal(url, '/v6/feed/createFeed'); assert.deepEqual(query, {}); assert.equal(options.method, 'POST'); assert.equal(Object.hasOwn(options, 'json'), false);
  const form = options.form; assert.equal(form.type, 'ershou'); assert.equal(form.ershouTypeId, '100'); assert.equal(form.ershou_deal_type, 0); assert.equal(form.store_type, 2); assert.equal(form.agree, 0); assert.equal(form.exchange_type, 3); assert.equal(form.face_deal, 1); assert.equal(form.ershou_price, ''); assert.equal(form.publish_status, 1); assert.equal(form.targetType, 'product_phone'); assert.equal(form.targetId, '77'); assert.equal(form.ershou_config, '');
  const general = fixture(); await general.run('secondhandCreate', { input: { ...input, productId: '77' } }); assert.equal(general.calls.at(-1)[2].form.targetType, '');
  const purchase = fixture(); await purchase.run('secondhandCreate', { input: { ...input, dealType: 1, link: '' } }); assert.equal(purchase.calls.some(([url]) => url.endsWith('/checkUrl')), false);
});
test('preset is re-read from server and serializes native numeric other flags; unsupported option never submits', async () => {
  const box = fixture(); await box.run('secondhandCreate', { input: { ...input, productId: '77', configuration: { type: 'preset', id: '3' } } });
  assert.deepEqual(JSON.parse(box.calls.at(-1)[2].form.ershou_config), { configId: '3', configTitle: { value: '原厂配置', other: 0 }, ram: { value: '12GB', other: 0 }, rom: { value: '256GB', other: 0 } });
  const missing = fixture(); await assert.rejects(missing.run('secondhandCreate', { input: { ...input, productId: '77', configuration: { type: 'preset', id: '4' } } }), { code: 'INPUT' }); assert.equal(missing.calls.some(([url]) => url.endsWith('/createFeed')), false);
  const custom = fixture(); await custom.run('secondhandCreate', { input: { ...input, configuration: { type: 'custom', selections: { ram: [{ value: '8GB' }] } } } }); assert.equal(custom.calls.at(-1)[2].form.ershou_config, '{"ram":{"value":"8GB","other":"0"}}');
});
test('edit re-reads owner/permission and preserves server configuration, title, location, target and visibility', async () => {
  const box = fixture(); const current = await box.run('secondhandEditable', { id: '81' }); assert.equal(current.data.fields.visibility, 'self'); assert.equal(current.data.fields.configuration.type, 'preserve');
  await box.run('secondhandEdit', { id: '81', patch: { message: '修改正文' } }); const form = box.calls.at(-1)[2].form;
  assert.equal(box.calls.at(-1)[0], '/v6/feed/changeFeed'); assert.equal(form.id, '81'); assert.equal(form.message, '修改正文'); assert.equal(form.message_title, '原标题'); assert.equal(form.productId, '77'); assert.equal(form.ershou_config, feed().ershou_info.product_config_source); assert.equal(form.original_type, '2'); assert.equal(form.long_location, '完整地址'); assert.equal(form.targetType, 'product_phone'); assert.equal(form.targetId, '77'); assert.equal(form.publish_status, 1);
  for (const bad of [feed({ uid: '43' }), feed({ enableModify: 0 }), feed({ feedType: 'feed' }), feed({ mediaType: 2 }), feed({ ershou_info: { ...feed().ershou_info, store_type: 0 } }), feed({ tid: 'bad', targetRow: {} })]) { const fail = fixture({ feed: bad }); await assert.rejects(fail.run('secondhandEdit', { id: '81', patch: { message: 'change' } })); assert.equal(fail.calls.some(([url]) => url.endsWith('/changeFeed')), false); }
});
test('close checks owner and sends only irreversible status-1, closed state is idempotent; malformed post results remain uncertain', async () => {
  const box = fixture(); assert.deepEqual(await box.run('secondhandClose', { id: '81', confirmed: true }), { data: { id: '81', closed: true } });
  assert.deepEqual(box.calls[1], ['/v6/erShou/changeStatus', {}, { method: 'POST', form: { id: '81', status: '-1' } }]); assert.deepEqual(box.calls[2], ['/v6/feed/detail', { id: '81' }, { method: 'POST', form: { trace: '' } }]);
  const closed = fixture({ feed: feed({ ershou_info: { ...feed().ershou_info, ershou_status: -1 } }) }); assert.equal((await closed.run('secondhandClose', { id: '81', confirmed: true })).data.alreadyClosed, true); assert.equal(closed.calls.length, 1);
  for (const status of [null, '', {}, NaN]) { const bad = fixture({ feed: feed({ ershou_info: { ...feed().ershou_info, ershou_status: status } }) }); await assert.rejects(bad.run('secondhandClose', { id: '81', confirmed: true }), { code: 'API_ERROR' }); assert.equal(bad.calls.length, 1); }
  const malformed = fixture({ request: async (_url, _query, _config, _client, count) => ({ data: count === 1 ? feed() : {} }) }); await assert.rejects(malformed.run('secondhandClose', { id: '81', confirmed: true }), { code: 'WRITE_UNCONFIRMED' }); assert.equal(malformed.calls.length, 2);
});
test('account changes during async reads, uploads and failed writes cannot produce a later account operation', async () => {
  for (const failure of [false, true]) {
    const box = fixture({ request: async (_url, _query, _config, client) => { client.identity = { uid: '43' }; if (failure) throw new ApiError('late error', 'NETWORK'); return { data: [] }; } }); await assert.rejects(box.run('secondhandPublishCategories'), { code: 'ACCOUNT_CHANGED' }); assert.equal(box.calls.length, 1);
  }
  const uploaded = fixture({ pictures: async (_pic, client) => { client.identity = { uid: '43' }; throw new Error('upload failed'); } }); await assert.rejects(uploaded.run('secondhandCreate', { input }), { code: 'ACCOUNT_CHANGED' }); assert.equal(uploaded.calls.length, 0);
  const switched = fixture({ request: async (_url, _query, _config, client, count) => { if (count === 1) return { data: feed() }; client.cookie = 'changed'; throw new ApiError('late error', 'NETWORK'); } }); await assert.rejects(switched.run('secondhandClose', { id: '81', confirmed: true }), { code: 'ACCOUNT_CHANGED' });
});
test('uncertain create/close responses never cause automatic replay, while explicit verification is preserved', async () => {
  for (const code of ['NETWORK', 'HTTP', 'VERIFY_REQUIRED']) {
    const box = fixture({ request: async (url, _query, config) => { if (url.endsWith('/checkUrl')) return { data: config.form.ershou_link }; if (url.endsWith('/checkAgree')) return { data: 0 }; throw new ApiError('synthetic failure', code, code === 'VERIFY_REQUIRED' ? { challenge: { id: 'a'.repeat(32), field: '_v2_post_token' } } : {}); } });
    await assert.rejects(box.run('secondhandCreate', { input }), { code: code === 'VERIFY_REQUIRED' ? code : 'WRITE_UNCONFIRMED' }); assert.equal(box.calls.filter(([url]) => url.endsWith('/createFeed')).length, 1);
  }
  const wrongOwner = fixture({ request: async (url, _query, config) => ({ data: url.endsWith('/checkUrl') ? config.form.ershou_link : url.endsWith('/checkAgree') ? 0 : feed({ uid: '43' }) }) }); await assert.rejects(wrongOwner.run('secondhandCreate', { input }), { code: 'WRITE_UNCONFIRMED' });
});
test('real client response decoding failures after a write remain uncertain; a confirmed server denial or actual challenge stays actionable', async () => {
  for (const sample of [
    { response: () => new Response('<html>challenge</html>'), code: 'WRITE_UNCONFIRMED' },
    { response: () => ({ ok: true, text: async () => { throw new TypeError('synthetic response stream'); } }), code: 'WRITE_UNCONFIRMED' },
    ...['null', '[]', '{}', '{"unexpected":true}'].map(raw => ({ response: () => new Response(raw), code: 'WRITE_UNCONFIRMED' })),
    { response: () => new Response('{"status":-2,"message":"明确拒绝"}'), code: 'API_ERROR' },
    { response: () => new Response(JSON.stringify({ status: -1, message: '需要验证码', messageExtra: { captchaType: 'NEC', captchaId: 'a'.repeat(32), captchaField: '_v2_post_token' } })), code: 'VERIFY_REQUIRED' },
  ]) {
    const calls = [], client = new CoolapkClient({ identity: { uid: '42' }, deviceCode: 'synthetic-offline-device', fetchImpl: async (url, options) => {
      const path = new URL(url).pathname; calls.push({ path, method: options.method });
      if (path.endsWith('/checkUrl')) return new Response(JSON.stringify({ data: input.link }));
      if (path.endsWith('/checkAgree')) return new Response('{"data":0}');
      assert.equal(path, '/v6/feed/createFeed'); assert.equal(options.body instanceof URLSearchParams, true); return sample.response();
    } }); client.validatePictures = async value => value;
    await assert.rejects(dispatchSecondhandPublishing(client, 'secondhandCreate', { input }), { code: sample.code }); assert.equal(calls.filter(call => call.path.endsWith('/createFeed')).length, 1);
  }
});
test('editing only body preserves top-level province and city-code fallbacks; status inspection never changes server state', async () => {
  const original = feed({ province: '原省份', city_code: '330100', ershou_info: { ...feed().ershou_info, province: undefined, city_code: undefined } });
  const box = fixture({ feed: original }); await box.run('secondhandEdit', { id: '81', patch: { message: '只改正文' } }); const form = box.calls.at(-1)[2].form; assert.equal(form.province, '原省份'); assert.equal(form.city_code, '330100');
  const state = fixture(); assert.deepEqual(await state.run('secondhandStatus', { id: '81' }), { data: { id: '81', closed: false } }); assert.deepEqual(state.calls, [['/v6/feed/detail', { id: '81' }, { method: 'POST', form: { trace: '' } }]]);
});
test('close readback failure or still-open detail cannot report success or trigger another close write', async () => {
  for (const kind of ['readFailure', 'stillOpen']) {
    const box = fixture({ request: async (_url, _query, _config, _client, count) => { if (count === 1) return { data: feed() }; if (count === 2) return { data: feed({ ershou_info: { ...feed().ershou_info, ershou_status: -1 } }) }; if (kind === 'readFailure') throw new ApiError('synthetic readback failure', 'NETWORK'); return { data: feed() }; } });
    await assert.rejects(box.run('secondhandClose', { id: '81', confirmed: true }), { code: 'WRITE_UNCONFIRMED' }); assert.equal(box.calls.filter(([url]) => url.endsWith('/changeStatus')).length, 1); assert.equal(box.calls.length, 3);
  }
});
