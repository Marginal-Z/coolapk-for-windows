// Browser-safe definitions recovered from the official 16.6.4 settings callers.
const toggle = (key, label, group, defaultValue = true, note = '') => Object.freeze({ key, label, group, type: 'boolean', defaultValue, note });
const choice = (key, label, group, options) => Object.freeze({ key, label, group, type: 'choice', defaultValue: '0', options: Object.freeze(options.map(([value, label]) => Object.freeze({ value, label }))) });
export const PRIVACY_SETTINGS = Object.freeze([
  toggle('net_abuse_guard', '一键防护', '互动管理', false, '开启后，7天内不接受未关注人的私信、评论、转发和@消息，不能被关注，并暂停自己的发布功能。'),
  choice('receive_at_message', '接收@消息', '互动管理', [['0', '接受所有人@'], ['1', '仅接收我关注的人'], ['-1', '不接收任何人@']]),
  choice('feed_disallow_reply', '动态回复控制', '互动管理', [['0', '所有人可回复'], ['2', '仅我关注的人'], ['3', '仅关注我的人'], ['1', '关闭回复']]),
  choice('receive_message', '接受私信的范围', '互动管理', [['0', '接收所有人私信'], ['1', '仅接受我关注的人私信'], ['-1', '不接收任何人私信']]),
  toggle('user_space_show_recent_like', '在个人主页显示我点赞过的内容', '与我相关'),
  toggle('my_device_visibility', '个人主页中我的装备对他人可见', '与我相关', true, '关闭后，其他用户无法从你的个人主页查看我的装备。'),
  toggle('record_hit_history', '开启浏览历史记录', '与我相关', true, '关闭后不再记录浏览历史，并关闭浏览历史卡片。'),
  toggle('record_recent_history', '开启我的常去记录', '与我相关', true, '关闭后不再记录常去节点，并关闭我的常去卡片。'),
  choice('hidden_history_feed', '动态公开时间范围', '动态', [['0', '全部可见'], ['1', '最近半年内可见']]),
  toggle('personalized_recommend', '个性化推荐头条', '个性化选项', true, '关闭后，头条不再根据常去节点、关注信息和设备机型推荐内容。'),
]);
export const NOTIFICATION_SETTINGS = Object.freeze([
  toggle('push_service_enabled', '订阅消息提醒', '推送服务', true, '管理账号的消息提醒订阅。'),
  toggle('subscribe_reply_notify', '订阅回复通知', '互动通知'),
  toggle('receive_like_notify', '点赞通知', '互动通知'),
  toggle('receive_follow_notify', '关注通知', '互动通知'),
  toggle('receive_at_notify', '@通知', '互动通知'),
  toggle('subscribe_special_follow_feed_notify', '订阅特别关注通知', '关注通知', false),
  toggle('is_push_collection_update', '关注收藏单更新通知', '关注通知', true, '关注的收藏单有新内容时接收更新推送。'),
  toggle('notification_ignore_like_count', '忽略点赞数量', '通知数字', false, '首页通知数字中不包含点赞量。'),
  toggle('receive_unread_count_notify', '未读回复较多提醒', '其他通知'),
  toggle('goods_list_vote_notification_enabled', '通知栏投票提醒', '其他通知', true, '管理他人对你投票的通知提醒。'),
]);
export const ACCOUNT_SETTING_DEFINITIONS = Object.freeze([...PRIVACY_SETTINGS, ...NOTIFICATION_SETTINGS]);
export const ACCOUNT_SETTING_KEYS = Object.freeze(ACCOUNT_SETTING_DEFINITIONS.map(item => item.key));
export const DEFAULT_ACCOUNT_SETTINGS = Object.freeze(Object.fromEntries(ACCOUNT_SETTING_DEFINITIONS.map(item => [item.key, item.defaultValue])));
const definitions = new Map(ACCOUNT_SETTING_DEFINITIONS.map(item => [item.key, item]));
function inputError(message) { const error = new Error(message); error.code = 'INPUT'; return error; }
export function accountSettingsPatch(value, now = Math.floor(Date.now() / 1000)) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw inputError('请一次修改一个账号设置');
  const [key, next] = Object.entries(value)[0], definition = definitions.get(key);
  if (!definition || definition.type === 'boolean' && typeof next !== 'boolean' || definition.type === 'choice' && !definition.options.some(option => option.value === next)) throw inputError('账号设置项或值无效');
  const result = { [key]: typeof next === 'boolean' ? next ? '1' : '0' : next };
  if (key === 'net_abuse_guard' && next) {
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - 604800) throw inputError('防护时间无效');
    result.net_abuse_guard_timestamp = String(now + 604800);
  }
  return result;
}
export function accountSettingConfirmation(key, value) {
  if (key === 'net_abuse_guard') return value ? { title: '开启一键防护', message: '开启后，仅我关注的人可以@我、给我发私信，并且会暂停我的发布动态、私信功能。手动关闭后必须相隔2小时才可再次开启，确认要开启吗？', action: '确定开启' } : { title: '关闭一键防护', message: '确定要关闭一键防护功能吗？关闭后下次开启需等待2小时。', action: '确定关闭' };
  if (key === 'record_hit_history' && value === false) return { title: '关闭浏览历史记录', message: '关闭后将清空已有的浏览历史记录，确定要关闭吗？', action: '确定关闭' };
  if (key === 'record_recent_history' && value === false) return { title: '关闭常去记录', message: '关闭后将清空已有的常去记录，确定要关闭吗？', action: '确定关闭' };
  if (key === 'personalized_recommend' && value === false) return { title: '关闭个性化头条', message: '关闭后可能导致头条内容变少，且可能会看到更多你不感兴趣的动态。', action: '确定关闭' };
  if (key === 'feed_disallow_reply' && value !== '0') return { title: '动态回复控制', message: '设置后将影响他人对您动态的回复权限，确定要设置吗？', action: '确定设置' };
  return null;
}
