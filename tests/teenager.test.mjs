import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { TeenagerStore, TEENAGER_LIMIT_MILLISECONDS as LIMIT } from '../core/teenager.mjs';

function fixture(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'coolapk-teenager-'));
  t.after(() => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/')); rmSync(directory, { recursive: true, force: true }); });
  let time = new Date(2026, 9, 4, 12, 0).getTime();
  const filePath = join(directory, 'state.json'), options = { filePath, now: () => time, ...extra };
  const store = new TeenagerStore(options);
  return { store, filePath, options, setTime: value => { time = value; }, advance: value => { time += value; } };
}
test('disabled state does not expose password material; confirmation and format are required', async t => {
  const { store } = fixture(t);
  assert.equal(store.info().enabled, false); assert.equal(store.info().blocked, false);
  for (const [pin, confirmation, code] of [['123', '123', 'TEENAGER_PIN_FORMAT'], ['abcd', 'abcd', 'TEENAGER_PIN_FORMAT'], ['1234', '9999', 'TEENAGER_PIN_MISMATCH'], ['1234', undefined, 'TEENAGER_PIN_MISMATCH']]) await assert.rejects(store.enable(pin, confirmation), { code });
  assert.equal(store.info().enabled, false);
  const state = await store.enable('1234', '1234');
  assert.equal(state.enabled, true); assert.equal(state.blocked, false); assert.equal(state.remainingMilliseconds, LIMIT);
  assert.deepEqual(Object.keys(state).sort(), ['blocked', 'day', 'enabled', 'limitMilliseconds', 'lockedUntil', 'reason', 'remainingMilliseconds', 'usedMilliseconds'].sort());
});
test('PIN uses a random salted verifier and survives restart without plaintext', async t => {
  const { store, filePath, options } = fixture(t);
  await store.enable('7638', '7638'); const first = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.match(first.salt, /^[a-f0-9]{64}$/); assert.match(first.verifier, /^[a-f0-9]{64}$/); assert.equal(Object.hasOwn(first, 'pin'), false); assert.equal(Object.hasOwn(first, 'password'), false);
  const restored = new TeenagerStore(options); assert.equal(restored.info().enabled, true);
  await assert.rejects(restored.disable('7368'), { code: 'TEENAGER_PIN_INVALID' }); assert.equal(restored.info().enabled, true);
  await restored.disable('7638'); assert.equal(restored.info().enabled, false);
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(filePath, 'utf8')), 'verifier'), false);
  await restored.enable('7638', '7638'); assert.notEqual(JSON.parse(readFileSync(filePath, 'utf8')).salt, first.salt);
});
test('foreground clock counts exactly 40 minutes; blur and suspension do not consume usage', async t => {
  const { store, advance } = fixture(t); await store.enable('1234', '1234');
  advance(10 * 60_000); assert.equal(store.tick().usedMilliseconds, 0);
  store.setActive(true); advance(17 * 60_000); assert.equal(store.tick().usedMilliseconds, 17 * 60_000);
  store.setActive(false); advance(60 * 60_000); assert.equal(store.tick().usedMilliseconds, 17 * 60_000);
  store.setActive(true); advance(23 * 60_000); const state = store.tick();
  assert.equal(state.usedMilliseconds, LIMIT); assert.equal(state.remainingMilliseconds, 0); assert.equal(state.reason, 'daily_limit');
  advance(120 * 60_000); assert.equal(store.tick().usedMilliseconds, LIMIT);
});
test('night interval uses local 22:00–06:00 and only records eligible foreground minutes', async t => {
  const { store, setTime } = fixture(t); setTime(new Date(2026, 9, 4, 21, 55).getTime()); await store.enable('1234', '1234'); store.setActive(true);
  setTime(new Date(2026, 9, 4, 22, 5).getTime()); assert.equal(store.tick().reason, 'night'); assert.equal(store.info().usedMilliseconds, 5 * 60_000);
  setTime(new Date(2026, 9, 5, 5, 59).getTime()); assert.equal(store.tick().reason, 'night'); assert.equal(store.info().usedMilliseconds, 0);
  setTime(new Date(2026, 9, 5, 6, 1).getTime()); assert.equal(store.tick().blocked, false); assert.equal(store.info().usedMilliseconds, 60_000);
});
test('daily quota persists through restart and resets on a later local calendar day', async t => {
  const { store, options, advance, setTime } = fixture(t); await store.enable('1234', '1234'); store.setActive(true); advance(LIMIT); assert.equal(store.tick().blocked, true);
  const restored = new TeenagerStore(options); assert.equal(restored.info().reason, 'daily_limit');
  setTime(new Date(2026, 9, 5, 12).getTime()); assert.equal(restored.tick().blocked, false); assert.equal(restored.info().usedMilliseconds, 0);
});
test('backwards clock does not subtract usage or grant a fresh day quota', async t => {
  const { store, setTime, advance } = fixture(t); await store.enable('1234', '1234'); store.setActive(true); advance(15 * 60_000); store.tick();
  setTime(new Date(2026, 9, 3, 12).getTime()); assert.equal(store.tick().usedMilliseconds, 15 * 60_000); assert.equal(store.info().day, '2026-10-04');
  setTime(new Date(2026, 9, 4, 12, 10).getTime()); assert.equal(store.tick().usedMilliseconds, 15 * 60_000);
  setTime(new Date(2026, 9, 4, 12, 20).getTime()); assert.equal(store.tick().usedMilliseconds, 20 * 60_000);
});
test('wrong PIN lockout persists across restart and expires by the main clock', async t => {
  const { store, options, advance } = fixture(t); await store.enable('1234', '1234');
  for (let n = 0; n < 5; n++) await assert.rejects(store.disable('4321'), { code: n === 4 ? 'TEENAGER_PIN_LOCKED' : 'TEENAGER_PIN_INVALID' });
  const restored = new TeenagerStore(options); assert.ok(restored.info().lockedUntil);
  await assert.rejects(restored.disable('1234'), { code: 'TEENAGER_PIN_LOCKED' }); assert.equal(restored.info().enabled, true);
  advance(30_001); assert.equal(restored.info().lockedUntil, null); assert.equal((await restored.disable('1234')).enabled, false);
});
test('change PIN requires the old verifier and preserves quota', async t => {
  const { store, advance } = fixture(t); await store.enable('1234', '1234'); store.setActive(true); advance(6 * 60_000); store.tick();
  await assert.rejects(store.changePin('4321', '9876', '9876'), { code: 'TEENAGER_PIN_INVALID' });
  assert.equal((await store.changePin('1234', '9876', '9876')).usedMilliseconds, 6 * 60_000);
  await assert.rejects(store.disable('1234'), { code: 'TEENAGER_PIN_INVALID' }); assert.equal((await store.disable('9876')).enabled, false);
});
test('concurrent mode mutations serialize and cannot bypass password verification', async t => {
  const { store } = fixture(t);
  const results = await Promise.allSettled([store.enable('1234', '1234'), store.enable('9876', '9876')]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'TEENAGER_ALREADY_ENABLED');
  const exits = await Promise.allSettled([store.disable('9876'), store.disable('1234')]); assert.equal(exits[0].status, 'rejected'); assert.equal(exits[1].status, 'fulfilled'); assert.equal(store.info().enabled, false);
});
test('corrupt, unsupported or unreadable state fails closed without ordinary access', async t => {
  const { filePath, options } = fixture(t);
  for (const data of ['not json', JSON.stringify({ version: 99, enabled: false }), JSON.stringify({ version: 1, enabled: true, day: '2026-10-04', usedMilliseconds: 0, failedAttempts: 0, lockedUntil: 0, verifier: 'wrong', salt: 'wrong' })]) {
    writeFileSync(filePath, data); const store = new TeenagerStore(options);
    assert.equal(store.info().enabled, true); assert.equal(store.info().reason, 'state_error'); await assert.rejects(store.enable('1234', '1234'), { code: 'TEENAGER_STATE' });
  }
  rmSync(filePath); mkdirSync(filePath); const inaccessible = new TeenagerStore(options); assert.equal(inaccessible.info().reason, 'state_error');
});
test('failed persistence never reports a completed mode change', async t => {
  let fail = false;
  const { store } = fixture(t, { encrypt: text => { if (fail) throw new Error('disk unavailable'); return Buffer.from(text); }, decrypt: bytes => bytes.toString() });
  fail = true; await assert.rejects(store.enable('1234', '1234')); assert.equal(store.info().enabled, false);
  fail = false; await store.enable('1234', '1234'); fail = true;
  await assert.rejects(store.disable('1234')); assert.equal(store.info().enabled, true);
});
test('main-process encryption adapter protects the complete record and restores it', async t => {
  const encode = text => Buffer.from(Buffer.from(text).toString('base64')), decode = bytes => Buffer.from(bytes.toString(), 'base64').toString();
  const { store, filePath, options } = fixture(t, { encrypt: encode, decrypt: decode }); await store.enable('1234', '1234');
  assert.throws(() => JSON.parse(readFileSync(filePath, 'utf8'))); assert.equal(new TeenagerStore(options).info().enabled, true);
});
test('usage checkpoint failure closes the gate and never grants a fresh quota', async t => {
  let fail = false;
  const { store, advance } = fixture(t, { encrypt: text => { if (fail) throw new Error('storage failed'); return Buffer.from(text); }, decrypt: bytes => bytes.toString() });
  await store.enable('1234', '1234'); store.setActive(true); fail = true; advance(60_000);
  assert.equal(store.tick().reason, 'state_error'); assert.equal(store.info().enabled, true); await assert.rejects(store.disable('1234'), { code: 'TEENAGER_STATE' });
});
