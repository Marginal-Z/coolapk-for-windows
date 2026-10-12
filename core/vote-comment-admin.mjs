const numericId = value => {
  const id = String(value ?? '');
  return /^[1-9]\d{0,19}$/.test(id) ? id : '';
};

export function hasVoteAdminPrivilege(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  const adminType = Number(value);
  return Number.isSafeInteger(adminType);
}

export function voteCommentRecommendation(row, adminType) {
  if (!hasVoteAdminPrivilege(adminType) || !row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (row.feedType !== 'voteComment' && row.feed_type !== 'voteComment') return null;
  const commentId = numericId(row.id);
  const value = row.is_recommend_vote_comment ?? row.isRecommendVoteComment;
  if (!commentId || ![0, 1, '0', '1'].includes(value)) return null;
  return { commentId, recommended: Number(value) === 1 };
}
