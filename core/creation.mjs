import { ApiError, assertLogin, feedForm } from './client.mjs';
import { applyPublishOptions } from './publishing.mjs';
import { CREATION_LIMITS, POLL_DURATIONS, prepareQuestion, preparePoll, normalizeQuestionTitle } from './creation-models.mjs';
import { hasVoteAdminPrivilege } from './vote-comment-admin.mjs';

export const CREATION_OPERATIONS = Object.freeze(['questionCreate', 'pollCreate', 'relatedQuestions']);
function publishOptions(value) {
  const fields = ['targetType', 'targetId', 'originalType', 'visibleStatus', 'extraUrl', 'dyhId'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) || !['', 'tag', 'product_phone'].includes(value.targetType ?? '')) throw new ApiError('提问或投票的发布选项无效', 'INPUT');
  return value;
}
async function submit(client, form) {
  let result;
  try { result = await client.request('/v6/feed/createFeed', {}, { method: 'POST', form }); }
  catch (error) {
    if (error.code === 'NETWORK' || error.code === 'HTTP' || error.detail?.responseInvalid) throw new ApiError('提交结果尚未确认，请先检查你的最新动态，避免重复发布', 'WRITE_UNCONFIRMED');
    throw error;
  }
  if (!/^[1-9]\d{0,19}$/.test(String(result?.data?.id ?? ''))) throw new ApiError('服务端未返回发布结果，请先检查你的最新动态，避免重复发布', 'WRITE_UNCONFIRMED');
  return result;
}
function requestsAdminPollFeatures(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  return Object.hasOwn(args, 'showAuthor') || Object.hasOwn(args, 'votePage')
    || Array.isArray(args.options) && args.options.length > CREATION_LIMITS.pollOptions
    || !POLL_DURATIONS.includes(args.endTime ?? 604800);
}
async function hasConfirmedVoteAdminRole(client) {
  const self = String(client.identity.uid);
  const result = await client.request('/v6/user/profile', { uid: self, installTime: 0, showSettingTab: 1 });
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new ApiError('无法核验当前账号的管理员权限', 'API_ERROR');
  const profile = { ...result.data.userInfo, ...result.data };
  for (const uid of [result.data.uid, result.data.userInfo?.uid]) if (uid != null && String(uid) !== self) throw new ApiError('管理员资料与当前账号不匹配', 'API_ERROR');
  return hasVoteAdminPrivilege(profile.admintype ?? profile.adminType);
}
export async function dispatchCreation(client, operation, args = {}) {
  if (!CREATION_OPERATIONS.includes(operation)) return undefined;
  if (operation === 'relatedQuestions') {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'title')) throw new ApiError('相关问题参数无效', 'INPUT');
    const result = await client.request('/v6/feed/relatedQuestion', { title: normalizeQuestionTitle(args.title) });
    if (!Array.isArray(result.data)) throw new ApiError('酷安返回的相关问题结构异常', 'API_ERROR');
    return result;
  }
  assertLogin(client.identity);
  if (operation === 'questionCreate') {
    const input = prepareQuestion(args), options = publishOptions(input.publishOptions);
    if (typeof input.pic !== 'string') throw new ApiError('提问图片格式无效', 'INPUT');
    const pic = input.pic ? await client.validatePictures(input.pic) : '';
    const form = applyPublishOptions(feedForm(input.message, pic), options);
    Object.assign(form, { type: 'question', message_title: input.title });
    return submit(client, form);
  }
  const admin = requestsAdminPollFeatures(args);
  const input = preparePoll(args, { admin });
  if (admin && !await hasConfirmedVoteAdminRole(client)) throw new ApiError('此投票设置仅限酷安管理员', 'PERMISSION');
  const options = publishOptions(input.publishOptions);
  const form = applyPublishOptions(feedForm(input.message), options);
  const voteEndTime = input.endTime > 2592000 ? input.endTime - Math.floor(Date.now() / 1000) : input.endTime;
  Object.assign(form, { type: 'vote', message_title: input.title, vote_type: input.pollType, vote_min_select_num: 1, vote_max_select_num: input.maxSelectNum, vote_end_time: voteEndTime, vote_tag: '', vote_page: input.votePage, vote_show_author: input.showAuthor });
  input.options.forEach((option, i) => { form[`vote_option[${i}]`] = option; });
  input.colors?.forEach((color, i) => { form[`vote_option_color[${i}]`] = color; });
  return submit(client, form);
}
