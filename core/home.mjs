import { ApiError, assertLogin, flattenEntities, numericId } from './client.mjs';
export const HOME_OPERATIONS = ['homeHeadline', 'homeUpdates', 'homeEditorChoice', 'homeNews', 'homeDigest', 'homeTabConfig', 'homeHotTopics'];
function topicCount(topic) {
  for (const key of ['hot_num', 'commentnum', 'comment_num']) {
    const value = topic[key];
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\+?\d+$/.test(value.trim()))) continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}
export async function dispatchHome(client, operation, args = {}) {
  if (!HOME_OPERATIONS.includes(operation)) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('首页栏目参数无效', 'INPUT');
  if (operation === 'homeHotTopics') {
    if (Object.keys(args).length) throw new ApiError('热门话题不支持自定义栏目或分页', 'INPUT');
    const result = await client.request('/v6/page/dataList', { url: 'V9_HOME_TAB_TOPIC', page: 1 });
    if (!Array.isArray(result.data)) throw new ApiError('酷安返回的热门话题数据异常', 'API_ERROR');
    const data = result.data.filter(topic => topic?.entityType === 'topic' && typeof topic.title === 'string' && topic.title.trim())
      .slice(0, 5).map(topic => ({ tag: topic.title.trim(), count: topicCount(topic) }));
    return { ...result, data, hasMore: false };
  }
  if (operation === 'homeTabConfig') {
    assertLogin(client.identity);
    if (!Array.isArray(args.tabs) || !args.tabs.length || args.tabs.length > 100) throw new ApiError('首页栏目配置无效', 'INPUT');
    const seen = new Set();
    const config = args.tabs.map(tab => {
      const id = numericId(tab?.id); if (seen.has(id)) throw new ApiError('首页栏目重复', 'INPUT'); seen.add(id);
      if (typeof tab.title !== 'string' || !tab.title.trim() || tab.title.length > 200 || /[\u0000-\u001f]/.test(tab.title) || !['0', '1'].includes(String(tab.page_visibility))) throw new ApiError('首页栏目配置无效', 'INPUT');
      return { id, title: tab.title.trim(), page_visibility: String(tab.page_visibility) };
    });
    if (!config.some(tab => tab.page_visibility === '1')) throw new ApiError('至少保留一个栏目', 'INPUT');
    return client.request('/v6/account/updateConfig', {}, { method: 'POST', form: { home_tab_config: JSON.stringify(config) } });
  }
  const pageValue = args.page ?? 1, page = Number(pageValue);
  if (!(typeof pageValue === 'number' || typeof pageValue === 'string' && /^[1-9]\d{0,3}$/.test(pageValue)) || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('首页栏目页码无效', 'INPUT');
  const query = { page };
  for (const key of ['firstItem', 'lastItem']) {
    if (args[key] == null || args[key] === '') continue;
    if (typeof args[key] !== 'string' || args[key].length > 120 || /[\u0000-\u001f\u007f]/.test(args[key])) throw new ApiError('首页栏目分页标记无效', 'INPUT');
    query[key] = args[key];
  }
  const routes = { homeHeadline: '/v6/main/headline', homeUpdates: '/v6/main/updateList', homeEditorChoice: '/v6/feed/editorChoiceList', homeNews: '/v6/page/dataList', homeDigest: '/v6/page/dataList' };
  if (operation === 'homeNews') Object.assign(query, { url: 'V11_HOME_TAB_NEWS', title: '快讯' });
  if (operation === 'homeDigest') Object.assign(query, { url: '#/feed/digestList', title: '精选' });
  const result = await client.request(routes[operation], query);
  if (!Array.isArray(result.data)) throw new ApiError('酷安返回的栏目数据异常', 'API_ERROR');
  const data = flattenEntities(result.data);
  return { ...result, data, rawCount: result.data.length, firstItem: String(result.firstItem ?? data[0]?.entityId ?? data[0]?.id ?? ''), lastItem: String(result.lastItem ?? data.at(-1)?.entityId ?? data.at(-1)?.id ?? ''), hasMore: result.hasMore ?? result.data.length > 0 };
}
