import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingSessionKey, sessionKey, sessionPartnerUid } from '../src/chat-session.ts';

test('session partner uses dedicated messageUid and never points to current account', () => {
  assert.equal(sessionPartnerUid({ messageUid: 73, uid: 42, fromuid: 99 }, '42'), '73');
  assert.equal(sessionPartnerUid({ uid: 73, fromuid: 42 }, '42'), '73');
  assert.equal(sessionPartnerUid({ uid: 42, fromuid: 73 }, '42'), '73');
  assert.equal(sessionPartnerUid({ uid: 42, senderUid: 73 }, '42'), '73');
  assert.equal(sessionPartnerUid({ uid: 42, fromuid: 42 }, '42'), '');
  assert.equal(sessionPartnerUid({ messageUid: 'invalid', uid: 42 }, '42'), '');
});

test('new conversations resolve their server key without using a temporary local id', () => {
  assert.equal(sessionKey({ id: 'new-73' }), '');
  assert.equal(sessionKey({ ukey: 'invalid\nkey' }), '');
  assert.equal(matchingSessionKey([{ uid: 42, fromuid: 73, ukey: 'server-42-73' }, { messageUid: 99, ukey: 'other' }], '73', '42'), 'server-42-73');
  assert.equal(matchingSessionKey([{ uid: 73, fromuid: 42, id: '42_73' }], '73', '42'), '42_73');
  assert.equal(matchingSessionKey([], '73', '42'), '');
});
