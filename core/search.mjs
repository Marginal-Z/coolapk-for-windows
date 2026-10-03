import { ApiError, numericId } from './client.mjs';

export const SEARCH_OPERATIONS = Object.freeze(['searchSuggestions', 'searchSuggestionsApp', 'searchPublishTopics']);
const fail = () => { throw new ApiError('搜索参数无效', 'INPUT'); };
const queryText = value => { if (typeof value !== 'string' || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) fail(); return value.trim(); };
const keys = ['id', 'entityId', 'entityType', 'entityTemplate', 'title', 'name', 'entityTitle', 'searchValue', 'tag', 'uid', 'username', 'userAvatar', 'logo', 'icon', 'pic', 'subTitle', 'description', 'packageName', 'appName', 'url', 'actionUrl', 'link', 'productId', 'albumId', 'dyhId'];
export function searchRows(value) {
  let source = value;
  if (!Array.isArray(source) && source && typeof source === 'object') source = ['entities', 'list', 'rows', 'items', 'data'].map(key => source[key]).find(Array.isArray);
  if (!Array.isArray(source)) throw new ApiError('服务器未返回有效搜索建议', 'API_ERROR');
  const rows = [];
  function visit(items, depth = 0) {
    if (depth > 8) return;
    for (const item of items) {
      if (rows.length >= 1000) return;
      if (!item || typeof item !== 'object' || Array.isArray(item) || [item.entityType, item.entityTemplate].some(value => /^sponsor|^ad$/i.test(String(value || ''))) || item.sponsorType && item.sponsorType !== '0') continue;
      const children = item.entities || item.data;
      if (Array.isArray(children)) visit(children, depth + 1);
      else rows.push(Object.fromEntries(keys.filter(key => ['string', 'number', 'boolean'].includes(typeof item[key])).map(key => [key, item[key]])));
      if (rows.length >= 1000) return;
    }
  }
  visit(source); return rows;
}
export async function dispatchSearch(client, operation, args = {}) {
  if (!SEARCH_OPERATIONS.includes(operation)) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail();
  const query = queryText(args.query ?? '');
  if (operation !== 'searchPublishTopics' && !query) return { data: [] };
  let result;
  if (operation === 'searchPublishTopics') {
    const page = Number(args.page ?? 1); if (!Number.isSafeInteger(page) || page < 1 || page > 1000) fail();
    const recentIds = args.recentIds ?? ''; if (typeof recentIds !== 'string' || recentIds.length > 650) fail();
    const ids = recentIds ? recentIds.split(',').map(numericId) : []; if (ids.length > 30 || new Set(ids).size !== ids.length) fail();
    result = await client.request('/v6/feed/searchTag', { q: query, page, recentIds: ids.join(',') });
    const data = searchRows(result.data).filter(item => (!item.entityType || ['topic', 'feedTopic', 'tag'].includes(String(item.entityType))) && /^\d{1,20}$/.test(String(item.id)) && (item.title || item.tag || item.entityTitle)).map(item => ({ ...item, id: String(item.id), title: String(item.title || item.tag || item.entityTitle).replace(/^#|#$/g, '').trim(), entityType: 'topic' })).filter(item => item.title);
    return { ...result, data: [...new Map(data.map(item => [item.id, item])).values()], hasMore: data.length > 0 };
  }
  result = await client.request('/v6/search/suggestSearchWordsNew', { searchValue: query, ...(operation === 'searchSuggestionsApp' ? { type: 'app' } : {}) });
  const data = searchRows(result.data).filter(item => item.title || item.searchValue || item.name || item.username || item.entityTitle);
  return { ...result, data: [...new Map(data.map(item => [String(item.url || item.actionUrl || '') + ':' + String(item.title || item.searchValue || item.name || item.username || item.entityTitle), item])).values()].slice(0, 20), hasMore: false };
}
