import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUTS, loadShortcuts, moveShortcut, normalizeShortcuts, saveShortcuts, shortcutStorageKey } from '../core/shortcuts.mjs';

test('quick-entry changes persist to the exact account and preserve an intentionally empty list', () => {
  const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  assert.deepEqual(loadShortcuts(storage, 'account-a'), DEFAULT_SHORTCUTS);
  saveShortcuts(storage, 'account-a', ['drafts', 'collections', 'following']);
  assert.deepEqual(loadShortcuts(storage, 'account-b'), DEFAULT_SHORTCUTS);
  assert.deepEqual(loadShortcuts(storage, 'account-a'), ['drafts', 'collections', 'following']);
  saveShortcuts(storage, 'account-b', []);
  assert.deepEqual(loadShortcuts(storage, 'account-b'), []);
  assert.notEqual(shortcutStorageKey('a:b'), shortcutStorageKey('a%3Ab'));
});
test('damaged or future quick-entry storage cannot introduce executable or duplicate targets', () => {
  assert.deepEqual(normalizeShortcuts(['drafts', 'drafts', '__proto__', 'constructor', { key: 'following' }]), ['drafts']);
  assert.deepEqual(loadShortcuts({ getItem: () => '{broken' }, 'account-a'), DEFAULT_SHORTCUTS);
  assert.deepEqual(loadShortcuts({ getItem() { throw Error('unavailable'); } }, 'account-a'), DEFAULT_SHORTCUTS);
  assert.throws(() => saveShortcuts({ setItem() { throw Error('full'); } }, 'account-a', ['drafts']), /full/);
});
test('moving a shortcut retains its identity and rejects out-of-range targets', () => {
  const order = ['drafts', 'following', 'collections'];
  assert.deepEqual(moveShortcut(order, 'collections', 0), ['collections', 'drafts', 'following']);
  assert.deepEqual(order, ['drafts', 'following', 'collections']);
  assert.deepEqual(moveShortcut(order, 'drafts', -1), order);
  assert.deepEqual(moveShortcut(order, 'plugins', 0), order);
});
