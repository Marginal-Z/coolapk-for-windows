import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchCreation } from '../core/creation.mjs';

const fixtures = [
  () => new Response('<html>incomplete upstream response</html>'),
  () => ({ ok: true, text: async () => { throw Error('response body disconnected'); } }),
  () => new Response('null'),
  () => new Response('[]'),
  () => new Response('{}'),
];
test('unusable responses retain explicit uncertainty metadata while server refusals remain distinct', async () => {
  for (const fixture of fixtures) {
    const client = new CoolapkClient({ fetchImpl: async () => fixture() });
    await assert.rejects(client.request('/v6/main/init'), error => error.detail?.responseInvalid === true);
  }
  const refused = new CoolapkClient({ fetchImpl: async () => new Response(JSON.stringify({ status: -1, message: '当前权限不允许' })) });
  await assert.rejects(refused.request('/v6/main/init'), error => error.code === 'API_ERROR' && error.detail.serverStatus === -1 && !error.detail.responseInvalid);
});
test('a question or poll sent before an unusable response cannot be presented as a safe resend', async () => {
  for (const fixture of fixtures) for (const [operation, args] of [
    ['questionCreate', { title: '模拟提问', message: '仅在测试内存' }],
    ['pollCreate', { title: '模拟投票', options: ['甲', '乙'], pollType: 1, endTime: 604800, maxSelectNum: 1 }],
  ]) {
    let writes = 0;
    const client = new CoolapkClient({ identity: { uid: '42' }, fetchImpl: async () => { writes++; return fixture(); } });
    await assert.rejects(dispatchCreation(client, operation, args), error => error.code === 'WRITE_UNCONFIRMED');
    assert.equal(writes, 1);
  }
});
