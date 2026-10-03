import { ApiError, flattenEntities } from './client.mjs';
import { SECONDHAND_HOME, secondhandDescriptor, secondhandFilters } from './secondhand-routes.mjs';

export const SECONDHAND_CONTRACTS = Object.freeze([
  { operation: 'secondhandHome', endpoint: '/v6/page/dataList', method: 'GET', descriptor: SECONDHAND_HOME },
  { operation: 'secondhandBrands', endpoint: '/v6/erShou/brandList', method: 'GET' },
  { operation: 'secondhandProducts', endpoint: '/v6/erShou/productList', method: 'GET' },
  { operation: 'secondhandListings', endpoint: '/v6/page/dataList', method: 'GET', descriptor: '#/feed/ershouList' },
  { operation: 'secondhandSearch', endpoint: '/v6/search', method: 'GET' },
]);
export const SECONDHAND_OPERATIONS = Object.freeze(SECONDHAND_CONTRACTS.map(row => row.operation));
const input = (value, max = 200, required = false) => { if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value) || required && !value.trim()) throw new ApiError('闲置浏览参数无效', 'INPUT'); return value.trim(); };
const token = value => { const result = input(value, 120, true); if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new ApiError('闲置编号或列表类型无效', 'INPUT'); return result; };
const paginate = args => {
  const page = Number(args.page ?? 1); if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new ApiError('闲置页码无效', 'INPUT');
  return { page, ...(args.firstItem ? { firstItem: input(args.firstItem, 120) } : {}), ...(args.lastItem ? { lastItem: input(args.lastItem, 120) } : {}) };
};
const filters = value => { try { return secondhandFilters(value); } catch (error) { throw new ApiError(error.message, 'INPUT'); } };
export function secondhandResult(result, products = false) {
  const raw = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.rows, result.data?.list].find(Array.isArray);
  if (!raw) throw new ApiError('酷安没有返回有效闲置列表', 'API_ERROR');
  const data = products ? [] : flattenEntities(raw);
  if (products) {
    function visit(items, depth = 0) { if (depth > 8) return; for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || data.length >= 10000 || /sponsor|^ad$/i.test(item.entityType || item.entityTemplate || '')) continue;
      if (Array.isArray(item.entities)) { visit(item.entities, depth + 1); continue; }
      const type = String(item.entityType || '').toLowerCase(), template = String(item.entityTemplate || '').toLowerCase();
      if (['card', 'header', 'card_title', 'banner'].includes(type)) continue;
      if (item.id != null || item.entityId != null || item.productId != null || /productgroup(?:title|more)|series[-_](?:title|more)/.test(type + ' ' + template)) data.push(item);
    } }
    visit(raw);
  }
  const more = result.hasMore ?? result.has_more;
  return { ...result, data, rawCount: raw.length, hasMore: more == null ? raw.length > 0 : [true, 1, '1'].includes(more), firstItem: String(result.firstItem ?? result.first_item ?? data[0]?.id ?? data[0]?.entityId ?? ''), lastItem: String(result.lastItem ?? result.last_item ?? data.at(-1)?.id ?? data.at(-1)?.entityId ?? '') };
}
export async function dispatchSecondhand(client, operation, args = {}) {
  const contract = SECONDHAND_CONTRACTS.find(row => row.operation === operation); if (!contract) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('闲置浏览参数无效', 'INPUT');
  let query;
  if (operation === 'secondhandBrands') query = {};
  else if (operation === 'secondhandProducts') query = { id: token(args.brandId), listType: token(args.listType ?? 'recommend'), ...paginate(args) };
  else if (operation === 'secondhandHome') query = { url: SECONDHAND_HOME, title: '二手市场', ...paginate(args), ...(args.pageContext ? { pageContext: input(args.pageContext, 2000) } : {}) };
  else if (operation === 'secondhandListings') query = { url: secondhandDescriptor(filters(args.filters ?? {})), title: input(args.title ?? '闲置交易', 200), ...paginate(args), ...(args.pageContext ? { pageContext: input(args.pageContext, 2000) } : {}) };
  else {
    const selected = filters({ productId: args.productId ?? '', ershouType: args.ershouType ?? '' });
    if (args.sort != null && args.sort !== '') throw new ApiError('此二手排序方式尚未确认', 'INPUT');
    query = { type: 'ershou', sort: '', searchValue: input(args.keyword, 200, true), status: 1, deal_type: 'all', city_code: '', is_link: '', ershou_type: selected.ershouType, product_id: selected.productId, tags: '', ...paginate(args) };
  }
  return secondhandResult(await client.request(contract.endpoint, query), ['secondhandBrands', 'secondhandProducts'].includes(operation));
}
