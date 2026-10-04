// Limits and values recovered from the official 16.6.4 editor and request model.
// This module is browser-safe: it contains no authentication or network code.
export const CREATION_LIMITS = Object.freeze({ questionTitle: 60, pollTitle: 50, ordinaryBody: 1000, pollOptions: 10, pkOption: 10, pollOption: 20, pictures: 9 });
export const POLL_DURATIONS = Object.freeze([86400, 604800, 2592000]);
const fail = message => { const error = new Error(message); error.code = 'INPUT'; throw error; };
const text = (value, max, multiline = false) => {
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\0\r\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail('发布内容格式无效');
  return value.trim();
};
const shape = (args, fields) => { if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !fields.includes(key))) fail('发布请求包含未知字段'); };
function body(value = '') { const result = text(value, 10000, true); if ([...result].length > CREATION_LIMITS.ordinaryBody) fail('正文最多 1000 字'); return result; }

export function normalizeQuestionTitle(value) {
  let title = text(value, CREATION_LIMITS.questionTitle);
  if (!title) fail('请填写问题标题');
  if (!/[?？]$/.test(title)) title += '？';
  if (title.length > CREATION_LIMITS.questionTitle) fail('问题过长，请精简；包含问号最多 60 个字符');
  return title;
}

export function prepareQuestion(args) {
  shape(args, ['title', 'message', 'pic', 'publishOptions']);
  return { title: normalizeQuestionTitle(args.title), message: body(args.message), pic: args.pic ?? '', publishOptions: args.publishOptions ?? {} };
}

export function preparePoll(args) {
  shape(args, ['title', 'message', 'pollType', 'options', 'endTime', 'maxSelectNum', 'colors', 'publishOptions']);
  const title = text(args.title, CREATION_LIMITS.pollTitle); if (!title) fail('请填写投票标题');
  const pollType = args.pollType ?? 1; if (![0, 1].includes(pollType)) fail('投票类型无效');
  const optionLimit = pollType === 0 ? CREATION_LIMITS.pkOption : CREATION_LIMITS.pollOption;
  if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > (pollType === 0 ? 2 : CREATION_LIMITS.pollOptions)) fail(pollType === 0 ? 'PK 投票需要正反方两项观点' : '投票需要 2 至 10 个选项');
  const options = args.options.map(value => { const result = text(value, optionLimit); if (!result) fail('请填写每个投票选项'); return result; });
  const endTime = args.endTime ?? 604800; if (!POLL_DURATIONS.includes(endTime)) fail('截止时间须为 24 小时、7 天或 30 天');
  const maxSelectNum = args.maxSelectNum ?? 1;
  if (!Number.isInteger(maxSelectNum) || maxSelectNum < 1 || maxSelectNum > (pollType === 0 ? 1 : options.length)) fail('投票上限无效');
  let colors;
  if (args.colors !== undefined) {
    if (pollType !== 0 || !Array.isArray(args.colors) || args.colors.length !== 2 || args.colors.some(value => typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) fail('PK 投票颜色无效');
    colors = args.colors.map(value => value.toUpperCase());
  }
  return { title, message: body(args.message), pollType, options, endTime, maxSelectNum, ...(colors ? { colors } : {}), publishOptions: args.publishOptions ?? {} };
}
