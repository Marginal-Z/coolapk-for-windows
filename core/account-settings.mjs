import { ApiError, assertLogin } from './client.mjs';
import { ACCOUNT_SETTING_DEFINITIONS, accountSettingsPatch } from './account-settings-models.mjs';
export const ACCOUNT_SETTINGS_OPERATIONS = Object.freeze(['accountSettings', 'accountSettingsUpdate']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function accountSettingsAccountGuard(client) {
  const identity = client.identity, uid = String(identity?.uid ?? ''), cookie = client.cookie, device = client.deviceCode;
  return () => { if (client.identity !== identity || String(client.identity?.uid ?? '') !== uid || client.cookie !== cookie || client.deviceCode !== device) throw new ApiError('账号已切换，请重新打开账号设置', 'ACCOUNT_CHANGED'); };
}
export function parseAccountSettings(data) {
  if (!object(data)) throw new ApiError('酷安未返回有效的账号设置', 'API_ERROR');
  let config = data.system_config;
  if (config == null || config === '') config = {};
  else if (typeof config === 'string' && config.length <= 256 * 1024) { try { config = JSON.parse(config); } catch { throw new ApiError('账号设置无法解析，请重新加载', 'API_ERROR'); } }
  if (!object(config)) throw new ApiError('账号设置格式异常，请重新加载', 'API_ERROR');
  const values = {}, present = [];
  for (const definition of ACCOUNT_SETTING_DEFINITIONS) {
    const key = definition.key;
    if (!Object.hasOwn(config, key)) { values[key] = definition.defaultValue; continue; }
    const raw = config[key], value = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
    if (definition.type === 'boolean') {
      if (!['0', '1'].includes(value)) throw new ApiError('酷安返回了未支持的账号设置值', 'API_ERROR');
      values[key] = value === '1';
    } else {
      if (!definition.options.some(option => option.value === value) && !(key === 'feed_disallow_reply' && value === '-1')) throw new ApiError('酷安返回了未支持的隐私范围', 'API_ERROR');
      values[key] = value;
    }
    present.push(key);
  }
  let guardExpiresAt = null;
  if (Object.hasOwn(config, 'net_abuse_guard_timestamp') && config.net_abuse_guard_timestamp != null && config.net_abuse_guard_timestamp !== '') {
    const raw = config.net_abuse_guard_timestamp, value = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
    if (typeof value !== 'string' || !/^\d{1,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('酷安返回的防护时间无效', 'API_ERROR');
    guardExpiresAt = Number(value); present.push('net_abuse_guard_timestamp');
  }
  return { values, present, guardExpiresAt, replyLocked: values.feed_disallow_reply === '-1' };
}
async function load(client, guard) {
  guard(); let result;
  try { result = await client.request('/v6/account/loadConfig', { key: 'system_config' }); }
  catch (error) { guard(); throw error; }
  guard();
  return parseAccountSettings(result.data);
}
export async function dispatchAccountSettings(client, operation, args = {}) {
  if (!ACCOUNT_SETTINGS_OPERATIONS.includes(operation)) return undefined;
  assertLogin(client.identity);
  if (!object(args) || Object.keys(args).some(key => operation === 'accountSettings' || key !== 'patch')) throw new ApiError('账号设置参数无效', 'INPUT');
  const guard = accountSettingsAccountGuard(client);
  if (operation === 'accountSettings') return { data: await load(client, guard) };
  const patch = accountSettingsPatch(args.patch), [key, value] = Object.entries(args.patch)[0];
  const before = await load(client, guard);
  if (['receive_at_message', 'receive_message', 'feed_disallow_reply'].includes(key) && before.values.net_abuse_guard || key === 'feed_disallow_reply' && before.replyLocked) throw new ApiError('当前防护或账号限制不允许修改此项', 'SETTINGS_LOCKED');
  if (before.present.includes(key) && before.values[key] === value) return { data: before };
  guard();
  let saved;
  try { saved = await client.request('/v6/account/updateConfig', {}, { method: 'POST', form: { key: 'system_config', value: JSON.stringify(patch) } }); }
  catch (error) { guard(); if (['NETWORK', 'HTTP'].includes(error.code)) throw new ApiError('设置提交结果尚未确认，请重新加载后核对', 'SETTINGS_UNCONFIRMED'); throw error; }
  guard();
  if (saved?.data === false || saved?.data === 0) throw new ApiError('酷安未接受此项设置，请重新加载后重试', 'API_ERROR');
  let current;
  try { current = await load(client, guard); }
  catch (error) { if (['ACCOUNT_CHANGED', 'VERIFY_REQUIRED', 'LOGIN_REQUIRED'].includes(error.code)) throw error; throw new ApiError('设置已提交，尚未完成回读核对，请重新加载', 'SETTINGS_UNCONFIRMED'); }
  const observed = { [key]: typeof current.values[key] === 'boolean' ? current.values[key] ? '1' : '0' : current.values[key] };
  if (key === 'net_abuse_guard' && value) observed.net_abuse_guard_timestamp = String(current.guardExpiresAt ?? '');
  if (Object.entries(patch).some(([field, next]) => !current.present.includes(field) || observed[field] !== next)) throw new ApiError('酷安返回的设置与修改值不一致，请重新加载后重试', 'SETTINGS_UNCONFIRMED');
  return { data: current };
}
