import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';

test('official detail reads use form POST without turning them into content mutations', async () => {
  const requests = [];
  const client = new CoolapkClient({ fetchImpl: async (url, options) => {
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: options.method, form: Object.fromEntries(new URLSearchParams(options.body)) });
    return Response.json({ data: { id: '101', packageName: 'com.example.synthetic', uid: '42', message: 'synthetic' } });
  }});
  await client.dispatch('detail', { id: '101' });
  await client.dispatch('app', { id: 'com.example.synthetic' });
  await client.dispatch('catalogApp', { id: 'com.example.synthetic' });
  assert.deepEqual(requests, [
    { path: '/v6/feed/detail', query: { id: '101' }, method: 'POST', form: { trace: '' } },
    { path: '/v6/apk/detail', query: { id: 'com.example.synthetic', installed: '0' }, method: 'POST', form: { extraAnalysisData: '' } },
    { path: '/v6/apk/detail', query: { id: 'com.example.synthetic', installed: '0' }, method: 'POST', form: { extraAnalysisData: '' } },
  ]);
});

test('feed detail verification remains an explicit challenge and token replay stays in the POST form', async () => {
  const requests = [];
  const client = new CoolapkClient({ fetchImpl: async (url, options) => {
    requests.push({ query: Object.fromEntries(url.searchParams), method: options.method, form: Object.fromEntries(new URLSearchParams(options.body)) });
    if (requests.length === 1) return Response.json({ code: 403, messageStatus: 'err_request_captcha_v2', message: '当前访问需要验证码', messageExtra: { requestCaptcha: 'synthetic' } });
    return Response.json({ data: { id: '101' } });
  }});
  await assert.rejects(client.dispatch('detail', { id: '101' }), error => error.code === 'VERIFY_REQUIRED');
  client.verification = { field: 'requestCaptcha', token: 'synthetic-proof' };
  await client.dispatch('detail', { id: '101' });
  assert.deepEqual(requests[1], { query: { id: '101' }, method: 'POST', form: { trace: '', requestCaptcha: 'synthetic-proof' } });
});
