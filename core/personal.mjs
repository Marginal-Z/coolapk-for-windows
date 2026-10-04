import { ApiError, assertLogin, flattenEntities, numericId } from './client.mjs';
import { homeBlockChange, homeBlockIncludes, normalizeHomeBlocks } from './personal-models.mjs';

// Reference src/api/coolapk.ts getFollowedProducts + getDiscoveryPageData.
// This is the missing fourth list observed on the official 16.6.4 phone.
export const PERSONAL_OPERATIONS = Object.freeze(['personalProductFollowing', 'personalBackups', 'personalBackup', 'personalBackupDelete', 'personalHomeBlocks', 'personalHomeBlockUpdate', 'personalNodePicker', 'personalDyhRecommendations']);
export const PERSONAL_CONTRACTS = Object.freeze([
  Object.freeze({ operation: 'personalProductFollowing', endpoint: '/v6/page/dataList', method: 'GET', descriptor: '#/product/followProductList?&title=我关注的数码吧', authenticated: true }),
  Object.freeze({ operation: 'personalBackups', endpoint: '/v6/backList/list', method: 'GET', authenticated: true }),
  Object.freeze({ operation: 'personalBackup', endpoint: '/v6/backList/detail', method: 'GET', authenticated: true }),
  Object.freeze({ operation: 'personalBackupDelete', endpoint: '/v6/backList/delete', method: 'GET', authenticated: true }),
  Object.freeze({ operation: 'personalHomeBlocks', endpoint: '/v6/user/spamWordList', method: 'GET', authenticated: true }),
  Object.freeze({ operation: 'personalHomeBlockUpdate', endpoint: '/v6/account/updateConfig', method: 'POST', authenticated: true }),
  Object.freeze({ operation: 'personalNodePicker', endpoint: '/v6/page/dataList', method: 'GET', authenticated: true }),
  Object.freeze({ operation: 'personalDyhRecommendations', endpoint: '/v6/page/dataList', method: 'GET', descriptor: '#V8_CHANNEL_DYH_RECOMMEND', authenticated: true }),
]);
const marker = (value, max = 120) => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new ApiError('个人列表分页标记无效', 'INPUT');
  return value;
};

export function personalListResult(result) {
  const source = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.list, result.data?.rows, result.data?.data].find(Array.isArray);
  if (!source) throw new ApiError('酷安未返回有效的个人列表', 'API_ERROR');
  const data = flattenEntities(source);
  const more = result.hasMore ?? result.has_more;
  if (more != null && ![true, false, 1, 0, '1', '0'].includes(more)) throw new ApiError('个人列表分页状态无效', 'API_ERROR');
  const cursor = (key, fallback) => {
    const value = String(result[key] ?? result[key === 'firstItem' ? 'first_item' : 'last_item'] ?? fallback?.entityId ?? fallback?.id ?? '');
    if (value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new ApiError('个人列表分页标记无效', 'API_ERROR');
    return value;
  };
  const context = result.pageContext ?? result.page_context;
  if (context != null && (typeof context !== 'string' || context.length > 2000 || /[\x00-\x1f\x7f]/.test(context))) throw new ApiError('个人列表分页上下文无效', 'API_ERROR');
  return { ...result, data, rawCount: source.length, firstItem: cursor('firstItem', data[0]), lastItem: cursor('lastItem', data.at(-1)), hasMore: more == null ? source.length > 0 : [true, 1, '1'].includes(more), ...(context ? { pageContext: context } : {}) };
}

export async function dispatchPersonal(client, operation, args = {}) {
  if (!PERSONAL_OPERATIONS.includes(operation)) return undefined;
  assertLogin(client.identity);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('个人列表参数无效', 'INPUT');
  if (operation === 'personalNodePicker' || operation === 'personalDyhRecommendations') {
    const picker = operation === 'personalNodePicker';
    const accepted = picker ? ['category', 'keyword', 'page', 'firstItem', 'lastItem', 'pageContext'] : ['page', 'firstItem', 'lastItem', 'pageContext'];
    if (Object.keys(args).some(key => !accepted.includes(key))) throw new ApiError('个人选择列表字段无效', 'INPUT');
    const page = Number(args.page ?? 1);
    if (!(args.page == null || typeof args.page === 'number' || typeof args.page === 'string' && /^[1-9]\d{0,3}$/.test(args.page)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('个人选择列表页码无效', 'INPUT');
    const paging = { page, ...(args.firstItem ? { firstItem: marker(args.firstItem) } : {}), ...(args.lastItem ? { lastItem: marker(args.lastItem) } : {}), ...(args.pageContext ? { pageContext: marker(args.pageContext, 2000) } : {}) };
    let query, endpoint = '/v6/page/dataList';
    if (picker) {
      const categories = { recent: ['/member/recentFeedTargetList', 'apkAndProduct'], topic: ['/topic/hotTagList?hotType=total&recommend=1', 'feedTopic'], product: ['/product/categoryDetailList?type=category&id=0', 'product'], apk: ['/apk/apkStatList?type=today&column=commentnum', 'localApkGame'] };
      if (typeof args.category !== 'string' || !Object.hasOwn(categories, args.category)) throw new ApiError('节点选择分类无效', 'INPUT');
      const keyword = marker(args.keyword ?? '', 200).trim();
      if (keyword) { endpoint = '/v6/search'; query = { type: categories[args.category][1], searchValue: keyword, ...paging }; }
      else query = { url: categories[args.category][0], title: '', subTitle: '', ...paging };
    } else query = { url: '#V8_CHANNEL_DYH_RECOMMEND', title: '推荐订阅', subTitle: '', ...paging };
    const result = await client.request(endpoint, query), list = personalListResult(result);
    if (!picker) {
      const raw = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.list, result.data?.rows].find(Array.isArray) || [];
      // Retain server group boundaries so recommendation headings and links do
      // not disappear when the shared entity flattener unwraps a card.
      list.sections = raw.filter(row => row && typeof row === 'object' && Array.isArray(row.entities)).map(row => ({ title: typeof row.title === 'string' ? row.title : '', url: typeof row.url === 'string' ? row.url : '', entities: flattenEntities(row.entities) }));
    }
    return list;
  }
  if (['personalHomeBlocks', 'personalHomeBlockUpdate'].includes(operation)) {
    let change;
    if (operation === 'personalHomeBlocks' && Object.keys(args).length) throw new ApiError('首页屏蔽列表不接受附加字段', 'INPUT');
    if (operation === 'personalHomeBlockUpdate') {
      try { change = homeBlockChange(args); } catch (error) { throw new ApiError(error.message, 'INPUT'); }
      if (args.scope === 'user' && String(args.value) === String(client.identity.uid)) throw new ApiError('不能在首页屏蔽自己', 'INPUT');
    }
    const read = async () => {
      const result = await client.request('/v6/user/spamWordList');
      try { return { ...result, data: normalizeHomeBlocks(result.data) }; } catch (error) { throw new ApiError(error.message, 'API_ERROR'); }
    };
    const original = await read();
    if (operation === 'personalHomeBlocks') return original;
    // A successful write followed by a lost readback is safe to retry: read
    // the current state first, and do not duplicate an already applied change.
    const exists = homeBlockIncludes(original.data, args);
    if (exists === (args.action === 'add')) return { ...original, unchanged: true };
    await client.request('/v6/account/updateConfig', {}, { method: 'POST', form: { key: 'spam_word_config', value: JSON.stringify(change) } });
    const confirmed = await read();
    if (homeBlockIncludes(confirmed.data, args) !== (args.action === 'add')) throw new ApiError('酷安尚未确认首页屏蔽变更，请刷新后重试', 'API_ERROR');
    return confirmed;
  }
  if (['personalBackup', 'personalBackupDelete'].includes(operation)) {
    if (Object.keys(args).some(key => key !== 'id')) throw new ApiError('备份详情不支持额外请求字段', 'INPUT');
    const id = numericId(args.id), detail = await client.request('/v6/backList/detail', { id });
    const info = detail.data;
    // BackupInfo's recovered Gson adapter binds id/uid. Never infer ownership
    // from a renderer-supplied row, nor issue deletion before checking it.
    if (!info || typeof info !== 'object' || Array.isArray(info) || String(info.id) !== id || String(info.uid) !== String(client.identity.uid)) throw new ApiError('只能查看或删除当前账号的备份单', 'INPUT');
    if (operation === 'personalBackupDelete') return client.request('/v6/backList/delete', { id });
    for (const key of ['localEntities', 'unLocalEntities']) if (info[key] != null && !Array.isArray(info[key])) throw new ApiError('备份应用列表格式无效', 'API_ERROR');
    return detail;
  }
  if (operation === 'personalBackups') {
    if (Object.keys(args).some(key => !['page', 'firstItem', 'lastItem'].includes(key))) throw new ApiError('备份列表不支持额外请求字段', 'INPUT');
    const page = Number(args.page ?? 1);
    if (!(args.page == null || typeof args.page === 'number' || typeof args.page === 'string' && /^[1-9]\d{0,3}$/.test(args.page)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('备份列表页码无效', 'INPUT');
    const result = personalListResult(await client.request('/v6/backList/list', { page, ...(args.firstItem ? { firstItem: marker(args.firstItem) } : {}), ...(args.lastItem ? { lastItem: marker(args.lastItem) } : {}) }));
    for (const row of result.data) if (row.uid != null && String(row.uid) !== String(client.identity.uid)) throw new ApiError('备份列表与当前账号不匹配', 'API_ERROR');
    return result;
  }
  if (Object.keys(args).some(key => !['page', 'firstItem', 'lastItem', 'pageContext'].includes(key))) throw new ApiError('个人列表不支持额外请求字段', 'INPUT');
  const page = Number(args.page ?? 1);
  if (!(args.page == null || typeof args.page === 'number' || typeof args.page === 'string' && /^[1-9]\d{0,3}$/.test(args.page)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('个人列表页码无效', 'INPUT');
  const query = { url: PERSONAL_CONTRACTS[0].descriptor, title: '我关注的数码吧', subTitle: '', page, firstItem: marker(args.firstItem ?? ''), lastItem: marker(args.lastItem ?? ''), pageContext: marker(args.pageContext ?? '', 2000) };
  return personalListResult(await client.request('/v6/page/dataList', query));
}
