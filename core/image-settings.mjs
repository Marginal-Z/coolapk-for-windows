import { ApiError, assertLogin } from './client.mjs';

export const IMAGE_SETTINGS_OPERATIONS = Object.freeze(['imageWatermarkSettings', 'imageWatermarkSettingsUpdate']);
export const WATERMARK_POSITIONS = Object.freeze(['5', '7', '8', '9']);
const fields = { position: 'picture_watermark_position', iconType: 'watermark_icon_type', coolPictures: 'cool_picture_watermark_option', hdr: 'hdr_watermark' };
export function imageSettingsAccountGuard(client) {
  const identity = client.identity, uid = String(identity?.uid ?? ''), cookie = client.cookie, device = client.deviceCode;
  return () => {
    if (client.identity !== identity || String(client.identity?.uid ?? '') !== uid || client.cookie !== cookie || client.deviceCode !== device) throw new ApiError('账号已切换，请重新打开图片设置', 'ACCOUNT_CHANGED');
  };
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function parseImageWatermarkSettings(data) {
  if (!object(data)) throw new ApiError('酷安没有返回有效的图片设置', 'API_ERROR');
  let config = data.system_config;
  if (config == null || config === '') config = {};
  else if (typeof config === 'string' && config.length <= 256 * 1024) { try { config = JSON.parse(config); } catch { throw new ApiError('酷安图片设置无法解析，请重试', 'API_ERROR'); } }
  if (!object(config)) throw new ApiError('酷安图片设置格式异常，请重试', 'API_ERROR');
  // Native Gson primitive reads use getAsString. Accept integral enum/binary
  // JSON primitives as well as the string values written by its sync queue.
  config = Object.fromEntries(Object.values(fields).filter(key => Object.hasOwn(config, key)).map(key => [key, typeof config[key] === 'number' && Number.isInteger(config[key]) ? String(config[key]) : config[key]]));
  const present = Object.values(fields).filter(key => Object.hasOwn(config, key));
  const position = Object.hasOwn(config, 'picture_watermark_position') ? config.picture_watermark_position : '9', iconType = Object.hasOwn(config, 'watermark_icon_type') ? config.watermark_icon_type : '0';
  if (!['0', ...WATERMARK_POSITIONS].includes(position) || !['0', '1'].includes(iconType)) throw new ApiError('酷安返回了未支持的水印类型或位置', 'API_ERROR');
  for (const key of ['cool_picture_watermark_option', 'hdr_watermark']) if (Object.hasOwn(config, key) && !['0', '1'].includes(config[key])) throw new ApiError('酷安返回了无效的图片水印开关', 'API_ERROR');
  return { enabled: position !== '0', position, iconType, coolPictures: config.cool_picture_watermark_option === '1', hdr: config.hdr_watermark === '1', present };
}
export function imageWatermarkPatch(patch) {
  if (!object(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !Object.hasOwn(fields, key))) throw new ApiError('图片设置修改项无效', 'INPUT');
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'position' && !['0', ...WATERMARK_POSITIONS].includes(value) || key === 'iconType' && !['0', '1'].includes(value) || ['coolPictures', 'hdr'].includes(key) && typeof value !== 'boolean') throw new ApiError('图片水印设置值无效', 'INPUT');
    result[fields[key]] = typeof value === 'boolean' ? value ? '1' : '0' : value;
  }
  return result;
}
async function load(client, guard) {
  guard(); const result = await client.request('/v6/account/loadConfig', { key: 'system_config' }); guard();
  return parseImageWatermarkSettings(result.data);
}
export async function dispatchImageSettings(client, operation, args = {}) {
  if (!IMAGE_SETTINGS_OPERATIONS.includes(operation)) return undefined;
  assertLogin(client.identity);
  if (!object(args)) throw new ApiError('图片设置参数无效', 'INPUT');
  const guard = imageSettingsAccountGuard(client);
  if (operation === 'imageWatermarkSettings') return { data: await load(client, guard) };
  const patch = imageWatermarkPatch(args.patch); guard();
  const saved = await client.request('/v6/account/updateConfig', {}, { method: 'POST', form: { key: 'system_config', value: JSON.stringify(patch) } }); guard();
  if (saved.data == null || saved.data === false || saved.data === 0) throw new ApiError('酷安没有确认图片设置已保存，请重试', 'API_ERROR');
  const current = await load(client, guard);
  const observed = imageWatermarkPatch({ position: current.position, iconType: current.iconType, coolPictures: current.coolPictures, hdr: current.hdr });
  if (Object.entries(patch).some(([key, value]) => !current.present.includes(key) || observed[key] !== value)) throw new ApiError('酷安返回的图片设置与修改值不一致，请重新加载后重试', 'API_ERROR');
  return { data: current };
}
