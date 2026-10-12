import test from 'node:test';
import assert from 'node:assert/strict';
import { clearHeadlineCache, HEADLINE_CACHE_MAX_BYTES, HEADLINE_CACHE_PREFIX, loadHeadlineCache, saveHeadlineCache } from '../core/headline-cache.mjs';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

const headline = { data: [{ id: '1', entityType: 'feed', message: 'cached' }], surfaceItems: [{ entityType: 'banner', title: 'campaign' }], hasMore: true, firstItem: '1' };

test('headline cache restores one bounded result per account and clears only the selected account', () => {
  const target = storage();
  assert.equal(saveHeadlineCache(target, '12345', headline, 1234), true);
  assert.deepEqual(loadHeadlineCache(target, '12345'), headline);
  assert.equal(loadHeadlineCache(target, 'guest'), null);
  assert.equal(saveHeadlineCache(target, 'guest', { data: [] }, 1235), true);
  assert.equal(clearHeadlineCache(target, '12345'), true);
  assert.equal(loadHeadlineCache(target, '12345'), null);
  assert.deepEqual(loadHeadlineCache(target, 'guest'), { data: [] });
  assert.equal([...target.values.keys()].every(key => key.startsWith(HEADLINE_CACHE_PREFIX)), true);
});

test('headline cache rejects malformed, unsupported, oversized and unserializable entries', () => {
  const target = storage();
  assert.equal(saveHeadlineCache(target, '12345', { data: 'not a list' }), false);
  assert.equal(saveHeadlineCache(target, '12345', { data: [] }, NaN), false);
  assert.equal(saveHeadlineCache(target, '12345', { data: ['x'.repeat(HEADLINE_CACHE_MAX_BYTES)] }), false);
  assert.equal(saveHeadlineCache(target, '12345', { data: [1n] }), false);
  const key = HEADLINE_CACHE_PREFIX + '12345';
  target.values.set(key, '{bad');
  assert.equal(loadHeadlineCache(target, '12345'), null);
  assert.equal(target.values.has(key), false);
  target.values.set(key, JSON.stringify({ version: 2, savedAt: 1234, result: headline }));
  assert.equal(loadHeadlineCache(target, '12345'), null);
  assert.equal(target.values.has(key), false);
  target.values.set(key, 'x'.repeat(HEADLINE_CACHE_MAX_BYTES + 1));
  assert.equal(loadHeadlineCache(target, '12345'), null);
  assert.equal(target.values.has(key), false);
});

test('headline cache handles unavailable storage and rejects invalid account scopes', () => {
  assert.equal(loadHeadlineCache(null, '12345'), null);
  assert.equal(saveHeadlineCache(null, '12345', headline), false);
  assert.equal(clearHeadlineCache(null, '12345'), false);
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(loadHeadlineCache(denied, '12345'), null);
  assert.equal(saveHeadlineCache(denied, '12345', headline), false);
  assert.equal(clearHeadlineCache(denied, '12345'), false);
  assert.equal(saveHeadlineCache(storage(), '', headline), false);
  assert.equal(loadHeadlineCache(storage(), 'x'.repeat(129)), null);
});
