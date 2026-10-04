import test from 'node:test';
import assert from 'node:assert/strict';
import { composeSelection, composeTopics, composeUsers, insertComposeText } from '../core/compose-text.mjs';

test('mention rows use verified user fields rather than an arbitrary row id', () => {
  assert.deepEqual(composeUsers([{ id: '42', title: '不是酷友' }, { fuid: '7', fusername: '甲', fUserAvatar: 'https://avatar.coolapk.com/a' }, { userInfo: { uid: 8, username: '乙' } }, { uid: '8', username: '重复' }, { uid: '9', username: '<b>未知格式</b>' }, { uid: '10', username: '换\n行' }]), [
    { uid: '7', username: '甲', userAvatar: 'https://avatar.coolapk.com/a' }, { uid: '8', username: '重复', userAvatar: '' },
  ]);
});
test('only typed topic rows with numeric ids can become body topics', () => {
  assert.deepEqual(composeTopics([{ id: 3, tag: '#数码生活#', entityType: 'topic' }, { id: 4, title: '非话题', entityType: 'feed' }, { id: 'bad', title: '无效编号' }, { id: 5, title: '坏#话题' }]), [{ id: '3', title: '数码生活' }]);
});
test('UTF-16 selections preserve emoji when collapsed, backwards or inside a surrogate pair', () => {
  assert.deepEqual(composeSelection('中😀文', 2, 2), { start: 1, end: 1 });
  assert.deepEqual(composeSelection('中😀文', 3, 2), { start: 1, end: 3 });
  assert.deepEqual(composeSelection('中😀文', -100, 100), { start: 0, end: 4 });
});
test('multiple selected mentions replace exactly the selected range and return UTF-16 caret', () => {
  const result = insertComposeText('前😀选中后', { start: 3, end: 5 }, 'mention', [{ uid: '7', username: '张三' }, { uid: '8', username: 'emoji😀酷友' }]);
  assert.equal(result.message, '前😀@张三 @emoji😀酷友 后');
  assert.equal(result.start, result.message.length - 1); assert.equal(result.end, result.start);
});
test('body topics use official delimiters and keep trailing body text unchanged', () => {
  assert.deepEqual(insertComposeText('前😀后', { start: 3, end: 3 }, 'topic', [{ id: '3', title: 'Windows体验' }]), { message: '前😀#Windows体验# 后', start: 15, end: 15 });
});
test('oversized insertion and malformed records fail without trimming the original text', () => {
  assert.throws(() => insertComposeText('字'.repeat(999), { start: 999, end: 999 }, 'mention', [{ uid: '7', username: '甲' }]), /不能超过/);
  assert.throws(() => insertComposeText('原文', { start: 0, end: 2 }, 'mention', [{ uid: '7', username: '甲' }, { uid: 'no', username: '乙' }]), /有效/);
  assert.throws(() => insertComposeText('原文', { start: 0, end: 2 }, 'topic', [{ id: '3', title: '甲' }, { id: '4', title: '乙' }]), /有效/);
});
test('astral characters count once for the publishing limit while the caret uses code units', () => {
  const result = insertComposeText('😀'.repeat(996), { start: 1992, end: 1992 }, 'mention', [{ uid: '7', username: '甲' }]);
  assert.equal([...result.message].length, 999); assert.equal(result.start, 1995);
});
