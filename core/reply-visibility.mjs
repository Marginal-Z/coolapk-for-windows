import { ApiError, assertLogin, requestSocialWrite } from './client.mjs';
import { replyVisibilityMatches, replyVisibilityPermission } from './reply-visibility-models.mjs';

export const REPLY_VISIBILITY_OPERATIONS = Object.freeze(['replyVisibility', 'replyVisibilityUpdate']);
export const REPLY_VISIBILITY_CONTRACTS = Object.freeze([
  Object.freeze({ operation: 'replyVisibilityUpdate', action: 'hide', method: 'POST', endpoint: '/v6/feed/hideReply', query: Object.freeze(['id']), methodIndex: 45080 }),
  Object.freeze({ operation: 'replyVisibilityUpdate', action: 'resume', method: 'POST', endpoint: '/v6/feed/resumeHideReply', query: Object.freeze(['id']), methodIndex: 44892 }),
]);
const id = value => {
  if (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isSafeInteger(value) || !/^[1-9]\d{0,19}$/.test(String(value))) throw new ApiError('评论或动态编号无效', 'INPUT');
  return String(value);
};
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export async function dispatchReplyVisibility(client, operation, args = {}) {
  if (!REPLY_VISIBILITY_OPERATIONS.includes(operation)) return undefined;
  assertLogin(client.identity);
  const fields = operation === 'replyVisibility' ? ['id', 'feedId'] : ['id', 'feedId', 'action'];
  if (!record(args) || Object.keys(args).some(key => !fields.includes(key))) throw new ApiError('隐藏回复参数无效', 'INPUT');
  const replyId = id(args.id), feedId = id(args.feedId), ownerUid = id(client.identity.uid);
  if (operation === 'replyVisibilityUpdate' && !['hide', 'resume'].includes(args.action)) throw new ApiError('隐藏回复操作无效', 'INPUT');
  const current = () => { if (String(client.identity?.uid || '') !== ownerUid) throw new ApiError('账号已切换，请重新发起请求', 'ACCOUNT_CHANGED'); };
  async function read() {
    current();
    const response = await client.request('/v6/feed/replyDetail', { id: replyId }); current();
    const reply = response?.data;
    if (!record(reply) || String(reply.id) !== replyId || String(reply.fid) !== feedId) throw new ApiError('酷安返回的评论与当前动态不匹配', 'API_ERROR');
    // Confirm the original author's identity from both fresh server records.
    const feed = await client.request('/v6/feed/detail', { id: feedId }, { method: 'POST', form: { trace: '' } }); current();
    if (!record(feed?.data) || String(feed.data.id) !== feedId) throw new ApiError('酷安返回的原动态不匹配', 'API_ERROR');
    try { id(feed.data.uid); } catch { throw new ApiError('酷安尚未提供有效的原动态作者身份', 'API_ERROR'); }
    const permission = replyVisibilityPermission(reply, { accountUid: ownerUid, feedId, feedAuthorUid: feed.data.uid });
    return { data: { reply, permission } };
  }
  const fresh = await read();
  if (operation === 'replyVisibility') return fresh;
  const permission = fresh.data.permission;
  if (!permission.visible) throw new ApiError(permission.reason, 'REPLY_VISIBILITY_UNAVAILABLE');
  // A lost response can be checked/retried without consuming a second quota:
  // only an already-confirmed target state returns unchanged without a write.
  if (replyVisibilityMatches(fresh.data.reply, args.action)) return { ...fresh, unchanged: true, confirmed: true };
  if (!permission.enabled) throw new ApiError(permission.reason, 'REPLY_HIDE_LIMIT');
  current();
  const contract = REPLY_VISIBILITY_CONTRACTS.find(item => item.action === args.action);
  const response = await requestSocialWrite(client, contract.endpoint, { id: replyId }, { method: 'POST' }); current();
  if (typeof response?.data !== 'string') throw new ApiError('酷安返回的隐藏结果格式未知，请重新读取原评论核对；不要重复提交', 'WRITE_UNCONFIRMED');
  let confirmed;
  try { confirmed = await read(); }
  catch (error) {
    if (error?.code === 'ACCOUNT_CHANGED') throw error;
    // Do not replay a mutation in order to solve a readback challenge.
    throw new ApiError('请求已提交，但原评论状态尚未确认，请重新读取核对；不要重复提交', 'WRITE_UNCONFIRMED');
  }
  if (!confirmed.data.permission.visible || !replyVisibilityMatches(confirmed.data.reply, args.action)) throw new ApiError('酷安尚未确认原评论的隐藏状态，请重新读取核对；不要重复提交', 'WRITE_UNCONFIRMED');
  return { ...confirmed, confirmed: true };
}
