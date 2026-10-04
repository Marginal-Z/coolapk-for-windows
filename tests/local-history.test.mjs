import test from 'node:test';
import assert from 'node:assert/strict';
import { historyStorageKey, readLocalHistory, saveLocalHistory, clearLocalHistory } from '../core/local-history.mjs';
test('account history never reassigns old unscoped records or exposes another account', () => {
  const values = new Map([['coolapk-history', '[{"id":"12"}]']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  assert.deepEqual(readLocalHistory(storage, '101'), []);
  saveLocalHistory(storage, '101', [{ id: '123', message: '隔离浏览记录' }]);
  assert.equal(readLocalHistory(storage, '101')[0].id, '123'); assert.deepEqual(readLocalHistory(storage, '102'), []);
  saveLocalHistory(storage, '102', [{ id: '124' }]); clearLocalHistory(storage, '101');
  assert.deepEqual(readLocalHistory(storage, '101'), []); assert.equal(readLocalHistory(storage, '102')[0].id, '124'); assert.equal(values.has('coolapk-history'), false);
});
test('invalid persisted history is bounded and storage failures do not become successful writes', () => {
  for (const value of ['{}', '[null,1,{}, {"id":"not-an-id"}]', 'broken']) assert.deepEqual(readLocalHistory({ getItem: () => value }, '101'), []);
  assert.throws(() => saveLocalHistory({ setItem() { throw Error('存储已满'); } }, '101', [{ id: '123' }]), /存储已满/);
  assert.notEqual(historyStorageKey('101:102'), historyStorageKey('101'));
});
