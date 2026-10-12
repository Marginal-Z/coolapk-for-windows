import test from 'node:test';
import assert from 'node:assert/strict';
import { hasVoteAdminPrivilege, voteCommentRecommendation } from '../core/vote-comment-admin.mjs';

test('vote comment recommendation menu requires an explicit positive integer admin type', () => {
  for (const value of [undefined, null, '', '0', '01', '1.0', 0, -1, 0.5, true, 'admin', Number.MAX_SAFE_INTEGER + 1]) assert.equal(hasVoteAdminPrivilege(value), false);
  for (const value of [1, 2, '1', '8']) assert.equal(hasVoteAdminPrivilege(value), true);
});

test('vote comment recommendation state requires a voteComment row, numeric id, and known server flag', () => {
  const row = { id: '901', feedType: 'voteComment', is_recommend_vote_comment: 0 };
  assert.deepEqual(voteCommentRecommendation(row, 1), { commentId: '901', recommended: false });
  assert.deepEqual(voteCommentRecommendation({ ...row, is_recommend_vote_comment: '1' }, '1'), { commentId: '901', recommended: true });
  for (const value of [0, '0', 1, '1']) assert.equal(voteCommentRecommendation({ ...row, is_recommend_vote_comment: value }, 0), null);
  for (const invalid of [
    { ...row, feedType: 'feed' },
    { ...row, id: '0' },
    { ...row, id: 'bad' },
    { id: '901', feedType: 'voteComment' },
    { ...row, is_recommend_vote_comment: 2 },
  ]) assert.equal(voteCommentRecommendation(invalid, 1), null);
  assert.equal(voteCommentRecommendation(null, 1), null);
});
