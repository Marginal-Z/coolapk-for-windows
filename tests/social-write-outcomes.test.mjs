import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, CoolapkClient, requestSocialWrite } from '../core/client.mjs';

const operations = [
  { name: 'publish', operation: 'action', args: { type: 'publish', message: 'synthetic body' }, endpoint: '/v6/feed/createFeed', feed: true },
  { name: 'forward', operation: 'action', args: { type: 'forward', id: '82', message: 'synthetic forward' }, endpoint: '/v6/feed/createFeed', feed: true },
  { name: 'advanced publish', operation: 'publishAdvanced', args: { message: 'synthetic article', options: { htmlArticle: true, messageTitle: 'synthetic title' } }, endpoint: '/v6/feed/createFeed', feed: true },
  { name: 'reply', operation: 'action', args: { type: 'reply', id: '82', message: 'synthetic reply' }, endpoint: '/v6/feed/reply' },
  { name: 'private message', operation: 'action', args: { type: 'sendMessage', uid: '83', message: 'synthetic message' }, endpoint: '/v6/message/send' },
];
function fixture(response) {
  const calls = [];
  const client = new CoolapkClient({ deviceCode: 'synthetic-offline-device', identity: { uid: '42' }, cookie: 'SESSID=synthetic-session', fetchImpl: async (url, options) => {
    calls.push({ endpoint: new URL(url).pathname, options }); return response();
  } });
  return { client, calls };
}
const captcha = { status: -1, message: '需要验证码', messageExtra: { captchaType: 'NEC', captchaId: 'a'.repeat(32), captchaField: '_v2_post_token' } };

for (const entry of operations) {
  test(`${entry.name}: response loss and malformed responses remain uncertain with one POST`, async () => {
    for (const response of [
      () => { throw Error('synthetic accepted request with lost response'); },
      () => new Response('synthetic unavailable', { status: 503 }),
      () => new Response('<html>synthetic challenge</html>'),
      () => ({ ok: true, text: async () => { throw new TypeError('synthetic stream failure'); } }),
      ...['null', '[]', '{}', '{"unexpected":true}'].map(raw => () => new Response(raw)),
      () => Response.json({ message: 'synthetic unknown result' }),
    ]) {
      const { client, calls } = fixture(response);
      await assert.rejects(client.dispatch(entry.operation, entry.args), error => error.code === 'WRITE_UNCONFIRMED' && !error.detail?.challenge);
      assert.equal(calls.length, 1); assert.equal(calls[0].endpoint, entry.endpoint); assert.equal(calls[0].options.method, 'POST');
    }
  });
  test(`${entry.name}: an explicit rejection, authentication refusal or real captcha stays actionable`, async () => {
    for (const sample of [
      { response: () => Response.json({ status: -2, message: '明确拒绝' }), code: 'API_ERROR', status: -2 },
      { response: () => Response.json({ status: 403, message: '明确拒绝' }), code: 'API_ERROR', status: 403 },
      { response: () => Response.json({ status: -1, message: '需要登录' }), code: 'LOGIN_REQUIRED', status: -1 },
      { response: () => new Response('', { status: 401 }), code: 'LOGIN_REQUIRED' },
      { response: () => Response.json(captcha), code: 'VERIFY_REQUIRED', status: -1, challenge: true },
    ]) {
      const { client, calls } = fixture(sample.response);
      await assert.rejects(client.dispatch(entry.operation, entry.args), error => error.code === sample.code && (sample.status == null || error.detail.serverStatus === sample.status) && (!sample.challenge || error.detail.challenge.id === captcha.messageExtra.captchaId));
      assert.equal(calls.length, 1);
    }
  });
  if (entry.feed) test(`${entry.name}: a missing, zero, malformed or unsafe created ID cannot report success`, async () => {
    for (const id of [undefined, null, 0, '0', '', 'bad', {}, '123456789012345678901', 9007199254740992]) {
      const { client, calls } = fixture(() => Response.json({ data: { id } }));
      await assert.rejects(client.dispatch(entry.operation, entry.args), { code: 'WRITE_UNCONFIRMED' }); assert.equal(calls.length, 1);
    }
    const { client, calls } = fixture(() => Response.json({ data: { id: '812' } }));
    assert.equal((await client.dispatch(entry.operation, entry.args)).data.id, '812'); assert.equal(calls.length, 1);
  });
}

test('reply/message success shape is passed through without guessing a new ID contract', async () => {
  for (const entry of operations.filter(item => !item.feed)) {
    const { client } = fixture(() => Response.json({ data: 0 }));
    assert.equal((await client.dispatch(entry.operation, entry.args)).data, 0);
  }
});

test('local validation and picture validation failures before the final POST stay safe to correct', async () => {
  for (const entry of operations) {
    const { client, calls } = fixture(() => { throw Error('no POST expected'); });
    await assert.rejects(client.dispatch(entry.operation, { ...entry.args, message: '' }), { code: 'INPUT' }); assert.equal(calls.length, 0);
    client.validatePictures = async () => { throw new ApiError('synthetic picture validation failed', 'NETWORK'); };
    await assert.rejects(client.dispatch(entry.operation, { ...entry.args, pic: 'https://image.coolapk.com/feed/synthetic.jpg' }), { code: entry.name === 'private message' ? 'INPUT' : 'NETWORK' }); assert.equal(calls.length, 0);
  }
});

test('unknown POST exceptions are conservative while responseInvalid always overrides apparent rejection', async () => {
  for (const error of [new Error('synthetic unknown exception'), new ApiError('synthetic unknown API result', 'API_ERROR'), new ApiError('synthetic non-JSON', 'VERIFY_REQUIRED'), new ApiError('synthetic contradictory response', 'API_ERROR', { serverStatus: -2, responseInvalid: true })]) {
    let writes = 0;
    await assert.rejects(requestSocialWrite({ request: async () => { writes++; throw error; } }, '/v6/feed/createFeed', {}, { method: 'POST', form: {} }), { code: 'WRITE_UNCONFIRMED' }); assert.equal(writes, 1);
  }
  const changed = new ApiError('synthetic scope change', 'ACCOUNT_CHANGED');
  await assert.rejects(requestSocialWrite({ request: async () => { throw changed; } }, '/v6/feed/createFeed', {}, { method: 'POST', form: {} }), error => error === changed);
});
