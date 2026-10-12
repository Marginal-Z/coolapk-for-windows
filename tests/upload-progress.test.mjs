import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { uploadBytesWithProgress } from '../core/upload.mjs';

test('OSS transport reports monotonic bytes written and preserves the exact payload', async () => {
  const body = Buffer.alloc(320 * 1024 + 17, 0x5a), events = [];
  let received = 0; const chunks = [];
  const server = http.createServer((request, response) => {
    request.on('data', chunk => { received += chunk.length; chunks.push(Buffer.from(chunk)); });
    request.on('end', () => { response.writeHead(201); response.end(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const { port } = server.address();
    const result = await uploadBytesWithProgress({ fetch }, `http://127.0.0.1:${port}/signed-object`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(5000) }, value => events.push(value));
    assert.equal(result.ok, true); assert.equal(result.status, 201);
    assert.equal(received, body.length);
    assert.deepEqual(Buffer.concat(chunks), body);
    assert.ok(events.length > 2);
    assert.deepEqual(events[0], { loaded: 0, total: body.length, percent: 0 });
    assert.equal(events.at(-1).percent, 99, 'transport progress stays below 100 until the server-side upload is confirmed');
    assert.equal(events.at(-1).total, body.length);
    assert.ok(events.length <= 102, 'renderer progress updates should be bounded by percentage changes');
    assert.ok(events.every((event, index) => event.total === body.length && (index === 0 || event.loaded >= events[index - 1].loaded)));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('upload progress listener errors do not abort the request', async () => {
  const body = Buffer.from('synthetic image payload');
  const server = http.createServer((request, response) => { request.resume(); request.on('end', () => { response.end(); }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const { port } = server.address();
    const result = await uploadBytesWithProgress({ fetch }, `http://127.0.0.1:${port}/signed-object`, { method: 'PUT', headers: {}, body, signal: AbortSignal.timeout(5000) }, () => { throw new Error('view closed'); });
    assert.equal(result.ok, true); assert.equal(result.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('account-scope guard is checked between upload chunks and aborts the stream', async () => {
  const body = Buffer.alloc(160 * 1024, 0x31);
  let checks = 0;
  await assert.rejects(uploadBytesWithProgress(
    { fetch: async (_url, init) => {
      const reader = init.body.getReader();
      await reader.read();
      await reader.read();
      return new Response(null);
    } },
    'https://synthetic.oss-cn-shenzhen.aliyuncs.com/object',
    { method: 'PUT', headers: {}, body },
    undefined,
    () => { if (++checks > 1) throw Object.assign(new Error('account changed'), { code: 'ACCOUNT_CHANGED' }); },
  ), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(checks, 2);
});
