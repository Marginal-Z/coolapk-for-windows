import { ApiError } from './client.mjs';

// Fixed reference contracts: client.rs get_app_list / get_game_list, 3542–3657.
export const APP_DISCOVERY_OPERATIONS = Object.freeze(['appDiscovery', 'gameDiscovery']);
export const APP_DISCOVERY_CATEGORIES = Object.freeze(['recommend', 'newest', 'tools', 'social', 'media', 'beauty']);
export const GAME_DISCOVERY_CATEGORIES = Object.freeze(['hot', 'new', 'single', 'online', 'casual', 'indie']);
const appWords = Object.freeze({ tools: '系统工具', social: '社交聊天', media: '影音播放', beauty: '主题美化' });
const gameWords = Object.freeze({ hot: '手游', new: '新游戏', single: '单机游戏', online: '网游', casual: '休闲游戏', indie: '独立游戏' });
const packagePattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const cursorValue = value => typeof value === 'string' && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value);

function queryArgs(args, categories) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || ![Object.prototype, null].includes(Object.getPrototypeOf(args)) || Object.keys(args).some(key => !['category', 'page', 'firstItem', 'lastItem'].includes(key))) throw new ApiError('应用浏览参数无效', 'INPUT');
  const category = args.category ?? categories[0];
  if (!categories.includes(category)) throw new ApiError('应用浏览分类无效', 'INPUT');
  const pageValue = args.page ?? 1, page = Number(pageValue);
  if (!(typeof pageValue === 'number' || typeof pageValue === 'string' && /^[1-9]\d{0,3}$/.test(pageValue)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('应用浏览页码无效', 'INPUT');
  const query = { page };
  for (const key of ['firstItem', 'lastItem']) {
    if (args[key] == null || args[key] === '') continue;
    if (!cursorValue(args[key])) throw new ApiError('应用浏览分页标记无效', 'INPUT');
    query[key] = args[key];
  }
  return { category, query };
}

function leaves(items, output = [], depth = 0) {
  if (depth > 8) throw new ApiError('应用列表嵌套层级异常', 'API_ERROR');
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (/ad|sponsor/i.test(item.entityTemplate || '') || ['ad', 'sponsor'].includes(item.entityType)) continue;
    if (Array.isArray(item.entities)) leaves(item.entities, output, depth + 1);
    else output.push(item);
  }
  return output;
}
function text(item, keys) {
  for (const key of keys) if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  return '';
}
function appEntity(item, game) {
  const type = text(item, ['entityType', 'entity_type']);
  if (type && !['apk', 'game'].includes(type)) return null;
  const title = text(item, ['title', 'shorttitle', 'appName', 'apkname', 'label', 'entityTitle']);
  const packageName = text(item, ['packageName', 'package_name', 'apkname']);
  const candidate = packagePattern.test(packageName) ? packageName : String(item.id ?? item.entityId ?? '');
  if (!title || candidate.length > 200 || !(packagePattern.test(candidate) || /^\d{1,20}$/.test(candidate))) return null;
  const category = text(item, ['catName', 'category_title', 'category_name', 'category', 'tag', 'apkTypeName']);
  const apkType = Number(item.apktype ?? item.apkType ?? item.apk_type);
  const isGame = type === 'game' || apkType === 2 || /游戏|手游|动作|射击|角色|策略|卡牌|赛车|竞技|二次元|模拟器/.test(category);
  const isUtility = /游戏盒|游戏大厅|游戏交易|游戏翻译|游戏串|游戏助手|单反相机/.test(title) || category.includes('相机');
  if (game ? isUtility : isGame) return null;
  let logo = text(item, ['apkRomIcon', 'logo', 'icon', 'pic', 'cover', 'apkIcon', 'apkLogo', 'appIcon', 'bigIcon']);
  if (logo.startsWith('//')) logo = 'https:' + logo;
  else if (logo && !/^https?:\/\//i.test(logo)) logo = 'https://image.coolapk.com/' + logo.replace(/^\/+/, '');
  return { ...item, entityType: 'apk', id: String(item.id ?? item.entityId ?? candidate), packageName: candidate, title, logo, description: text(item, ['subTitle', 'description', 'target_row_title', 'comment']), ...(item.rating != null ? {} : item.score != null ? { rating: item.score } : {}) };
}
function resultList(result, game) {
  const raw = Array.isArray(result?.data) ? result.data : result?.data && ['entities', 'list', 'rows', 'items', 'data'].map(key => result.data[key]).find(Array.isArray);
  if (!raw || result.hasMore != null && typeof result.hasMore !== 'boolean') throw new ApiError('酷安返回的应用列表结构异常', 'API_ERROR');
  const entries = leaves(raw), data = entries.map(item => appEntity(item, game)).filter(Boolean);
  const cursor = (key, fallback) => {
    if (result[key] != null && result[key] !== '') {
      const value = typeof result[key] === 'number' && Number.isSafeInteger(result[key]) && result[key] >= 0 ? String(result[key]) : result[key];
      if (!cursorValue(value)) throw new ApiError('酷安返回的应用分页标记异常', 'API_ERROR');
      return value;
    }
    const value = String(fallback?.entityId ?? fallback?.id ?? fallback?.packageName ?? '');
    return cursorValue(value) ? value : '';
  };
  return { ...result, data, rawCount: raw.length, firstItem: cursor('firstItem', entries[0]), lastItem: cursor('lastItem', entries.at(-1)), hasMore: result.hasMore ?? raw.length > 0 };
}

export async function dispatchAppDiscovery(client, operation, args = {}) {
  if (!APP_DISCOVERY_OPERATIONS.includes(operation)) return undefined;
  const game = operation === 'gameDiscovery';
  const { category, query } = queryArgs(args, game ? GAME_DISCOVERY_CATEGORIES : APP_DISCOVERY_CATEGORIES);
  let path = '/v6/search';
  if (!game && ['recommend', 'newest'].includes(category)) {
    path = '/v6/page/dataList'; query.url = category === 'recommend' ? '#/apk/rankList' : '#/apk/newestList';
  } else Object.assign(query, { type: game ? 'game' : 'apk', searchValue: game ? gameWords[category] : appWords[category], show_flag: 1 });
  // A failed rank request remains an error; keyword search is not a successful rank response.
  return resultList(await client.request(path, query), game);
}
