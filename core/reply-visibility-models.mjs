const identifier = value => ['string', 'number'].includes(typeof value) && (typeof value !== 'number' || Number.isSafeInteger(value)) && /^[1-9]\d{0,19}$/.test(String(value)) ? String(value) : null;
const integer = value => (typeof value === 'number' || typeof value === 'string' && /^\d{1,10}$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 2147483647 ? Number(value) : null;

// FeedReply's Gson contract: fid, feedUid, block_status and a String quota.
// A list filter, comment ownership or an absent/default quota grants no capability.
export function replyVisibilityPermission(reply, { accountUid, feedId, feedAuthorUid } = {}) {
  const unavailable = reason => ({ visible: false, enabled: false, hidden: false, remaining: null, action: null, reason });
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) || !identifier(reply.id) || !identifier(feedId) || identifier(reply.fid) !== identifier(feedId)) return unavailable('评论与当前动态不匹配');
  const uid = identifier(accountUid), author = identifier(reply.feedUid);
  if (!uid || !author || author !== uid || (feedAuthorUid != null && identifier(feedAuthorUid) !== author)) return unavailable('仅原动态作者可隐藏回复');
  const status = integer(reply.block_status);
  const remaining = typeof reply.userHideReplyRemaining === 'string' && reply.userHideReplyRemaining.length ? integer(reply.userHideReplyRemaining) : null;
  if (remaining == null || status == null) return unavailable('酷安尚未提供有效的隐藏权限与额度');
  const hidden = status === 4;
  return { visible: true, enabled: remaining > 0, hidden, remaining, action: hidden ? 'resume' : 'hide', reason: remaining > 0 ? '' : '今日隐藏回复次数已用完，暂不能隐藏或取消隐藏' };
}

export function replyVisibilityMatches(reply, action) {
  const status = integer(reply?.block_status);
  return status != null && (action === 'hide' ? status === 4 : action === 'resume' && status !== 4);
}
