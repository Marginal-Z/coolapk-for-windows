// Shared pure route contract; safe to import in the renderer without API credentials.
export const SECONDHAND_HOME = 'V11_FIND_GOOD_GOODS_HOME';
export const SECONDHAND_FILTER_KEYS = Object.freeze(['brand', 'productId', 'cityId', 'ershouType', 'dataListType']);
const text = value => typeof value === 'string' && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value);
export function secondhandFilters(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !SECONDHAND_FILTER_KEYS.includes(key))) throw new TypeError('闲置筛选字段无效');
  const result = { brand: '', productId: '', cityId: '', ershouType: '', dataListType: 'staggered', ...value };
  if (!text(result.brand)) throw new TypeError('闲置品牌无效');
  for (const key of ['productId', 'cityId', 'ershouType']) if (typeof result[key] !== 'string' || !/^(?:\d{1,20})?$/.test(result[key])) throw new TypeError('闲置筛选编号无效');
  if (typeof result.dataListType !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(result.dataListType)) throw new TypeError('闲置列表布局无效');
  return result;
}
export function secondhandDescriptor(value = {}) {
  const filters = secondhandFilters(value), params = new URLSearchParams();
  for (const key of SECONDHAND_FILTER_KEYS) if (filters[key]) params.set(key, filters[key]);
  return '#/feed/ershouList?' + params.toString();
}
export function parseSecondhandRoute(value, depth = 0) {
  if (typeof value !== 'string' || value.length > 4096 || depth > 3) return null;
  if ([SECONDHAND_HOME, '/page?url=' + SECONDHAND_HOME].includes(value)) return { type: 'home' };
  try {
    const source = value.startsWith('#/') ? value.slice(1) : value;
    const url = new URL(source, 'https://www.coolapk.com');
    const hosts = url.protocol === 'coolmarket:' ? ['coolapk.com', 'www.coolapk.com', 'm.coolapk.com', 'com.coolapk.market', 'com.coolapk.desktop'] : ['coolapk.com', 'www.coolapk.com', 'm.coolapk.com'];
    if (!['https:', 'http:', 'coolmarket:'].includes(url.protocol) || !hosts.includes(url.hostname) || url.username || url.password || url.port) return null;
    if (url.hash.startsWith('#/')) return parseSecondhandRoute(url.hash, depth + 1);
    if (url.pathname === '/page') return parseSecondhandRoute(url.searchParams.get('url'), depth + 1);
    if (url.pathname !== '/feed/ershouList' || [...url.searchParams.keys()].some(key => !SECONDHAND_FILTER_KEYS.includes(key) || url.searchParams.getAll(key).length !== 1)) return null;
    return { type: 'list', filters: secondhandFilters(Object.fromEntries(url.searchParams)) };
  } catch { return null; }
}
export function secondhandEntityTarget(entity, brand = '', forceModel = false) {
  if (!entity || typeof entity !== 'object') return null;
  const type = `${entity.entityType || ''} ${entity.entityTemplate || ''}`.toLowerCase();
  const main = /mainershoutype|mainershou|mainsecondhandtype/.test(type);
  const model = forceModel || /ershouproduct|secondhandproduct/.test(type);
  const explicit = parseSecondhandRoute(entity.url || entity.targetUrl || entity.target_url || '');
  if (explicit?.type === 'list') return explicit;
  if (explicit?.type === 'home') return explicit;
  if (!main && !model) return null;
  const first = (...values) => values.find(value => value != null && String(value) !== '') ?? '';
  try {
    return { type: 'list', filters: secondhandFilters({
      brand: String(first(entity.brandId, entity.brand_id, entity.brand, brand, entity.brandName, entity.brand_name)),
      productId: String(first(entity.productId, entity.product_id, ...(main ? [] : [entity.id, entity.entityId]))),
      cityId: String(first(entity.cityId, entity.city_id)),
      ershouType: String(first(entity.secondHandSthType, entity.second_hand_sth_type, entity.ershouType, entity.ershou_type, entity.secondHandType, entity.second_hand_type, main ? entity.id : '100')),
      dataListType: String(first(entity.dataListType, entity.data_list_type, 'staggered')),
    }) };
  } catch { return null; }
}
