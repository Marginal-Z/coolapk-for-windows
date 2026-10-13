import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { createNetworkTypeReader, parseNetworkType } = createRequire(import.meta.url)('../electron/network-type.cjs');

test('network classification accepts only the three non-identifying labels', () => {
  assert.equal(parseNetworkType('wifi\r\n'), 'wifi');
  assert.equal(parseNetworkType('other'), 'other');
  assert.equal(parseNetworkType('unknown'), 'unknown');
  assert.equal(parseNetworkType('SSID: private-network\nwifi'), 'wifi');
  assert.equal(parseNetworkType('connected'), 'unknown');
});
test('network reader is fail-closed off Windows and on query failure', async () => {
  assert.equal(await createNetworkTypeReader({ platform: 'linux' })(), 'unknown');
  const failed = createNetworkTypeReader({ platform: 'win32', execFileImpl: (_file, _args, _options, callback) => callback(new Error('unavailable'), '') });
  assert.equal(await failed(), 'unknown');
});
test('network reader shares in-flight queries and caches only its type result', async () => {
  let callback, calls = 0, now = 100;
  const read = createNetworkTypeReader({ platform: 'win32', now: () => now, cacheMs: 5000, execFileImpl: (_file, _args, _options, cb) => { calls++; callback = cb; } });
  const first = read(), second = read();
  assert.equal(calls, 1); callback(null, 'wifi\r\n');
  assert.equal(await first, 'wifi'); assert.equal(await second, 'wifi');
  assert.equal(await read(), 'wifi'); assert.equal(calls, 1);
  now += 5001; const next = read(); assert.equal(calls, 2); callback(null, 'other'); assert.equal(await next, 'other');
});
