import { ApiError, assertLogin, flattenEntities, numericId } from './client.mjs';
import { catalogImage } from './catalog.mjs';
import { isIP } from 'node:net';

const text = (value, max = 2000, required = false) => { if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value) || required && !value.trim()) throw new ApiError('好物参数无效', 'INPUT'); return value.trim(); };
const integer = (value, min, max, fallback) => { const number = value == null ? fallback : Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new ApiError('好物数值参数无效', 'INPUT'); return number; };
const flag = value => { if ([true, 1, '1'].includes(value)) return 1; if ([false, 0, '0', undefined].includes(value)) return 0; throw new ApiError('好物状态参数无效', 'INPUT'); };
const identifier = value => { const id = String(value ?? ''); if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ApiError('商品编号无效', 'INPUT'); return id; };
const optionalId = value => value == null || value === '' ? '' : identifier(value);
const page = args => integer(args.page, 1, 1000, 1);
const uid = (client, args) => { if (args.uid) return numericId(args.uid); assertLogin(client.identity); return numericId(client.identity.uid); };
export function goodsLink(value) {
  const source = text(value, 4096, true); let url; try { url = new URL(source); } catch { throw new ApiError('商品链接无效', 'INPUT'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !url.hostname.includes('.') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || /(?:^|\.)(?:localhost|local)$/i.test(url.hostname)) throw new ApiError('请提供公开商城商品链接', 'INPUT');
  return url.toString();
}
export function goodsListResult(result, words = false) {
  const raw = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.rows, result.data?.list, result.data?.data].find(Array.isArray);
  if (!raw) throw new ApiError('好物服务没有返回有效列表', 'API_ERROR');
  const data = words ? raw.map((item, index) => typeof item === 'string' ? { id: `word_${index}`, title: item } : item).filter(item => item && typeof item === 'object') : flattenEntities(raw);
  return { ...result, data, rawCount: raw.length, hasMore: result.hasMore ?? raw.length > 0, firstItem: result.firstItem || String(data[0]?.id ?? data[0]?.entityId ?? ''), lastItem: result.lastItem || String(data.at(-1)?.id ?? data.at(-1)?.entityId ?? '') };
}
const infoId = feed => numericId(feed.goodsListInfo?.id ?? feed.id);
async function listFeed(client, id, owner = false) {
  const result = await client.request('/v6/feed/detail', { id: numericId(id) });
  const feed = result.data;
  if (!feed || typeof feed !== 'object' || String(feed.id) !== String(id) || !feed.goodsListInfo || typeof feed.goodsListInfo !== 'object') throw new ApiError('此动态没有返回完整好物清单资料', 'API_ERROR');
  if (owner && String(feed.uid ?? feed.userInfo?.uid) !== String(client.identity.uid)) throw new ApiError('只能管理自己的好物清单', 'FORBIDDEN');
  infoId(feed); return { ...result, data: feed };
}
function selectedItem(feed, args) {
  const itemId = identifier(args.itemId), goodsId = identifier(args.goodsId);
  if (!Array.isArray(feed.goodsListItem)) throw new ApiError('清单项目明细未返回，已停止修改', 'API_ERROR');
  const item = feed.goodsListItem.find(row => String(row.id ?? row.entityId ?? row.feed_id) === itemId && String(row.product_goods_id) === goodsId);
  if (!item) throw new ApiError('该商品已不在此清单，刷新后重试', 'INPUT');
  return item;
}
function picture(value, previous = '') {
  if (value == null) value = previous;
  if (!value) return '';
  // Server-provided marketplace cover may be preserved unchanged. User replacements
  // must be uploaded to the official Coolapk image service first.
  if (value === previous) { goodsLink(value); return text(value, 2048); }
  return catalogImage(value);
}
function listForm(args) {
  return { title: text(args.title, 100, true), message: text(args.message ?? '', 10000), cover: args.cover == null ? undefined : text(args.cover, 2048), top_limit: integer(args.topLimit, 0, 1000, 0), is_open_vote: flag(args.isOpenVote), list_type: text(String(args.listType ?? 'feed'), 120, true) };
}
function created(result, label, numeric = true) {
  const value = typeof result.data === 'string' || typeof result.data === 'number' ? result.data : result.data?.id ?? result.data?.entityId;
  if (!(numeric ? /^\d{1,20}$/.test(String(value ?? '')) : /^[A-Za-z0-9_-]{1,120}$/.test(String(value ?? ''))) || String(value) === '0') throw new ApiError(`${label}未返回有效编号，请刷新列表确认，避免重复提交`, 'API_ERROR');
  return { ...result, createdId: String(value) };
}
export const GOODS_CONTRACTS = Object.freeze([
  ['goodsHotWords', '/v6/goods/searchHotWords', 'GET', false], ['goodsSearch', '/v6/goods/search', 'GET', false], ['goodsPrepare', '/v6/goods/addGoods', 'POST', true], ['goodsDetail', '/v6/goods/detail', 'GET', false], ['goodsListTypes', '/v6/goodsList/listType', 'GET', false], ['goodsLists', '/v6/goodsList/list', 'GET', false], ['goodsStore', '/v6/goods/goodsStoreItemList', 'GET', false], ['goodsAlbums', '/v6/user/productAlbumList', 'GET', false], ['goodsMyFeeds', '/v6/page/dataList', 'GET', false], ['goodsListFeed', '/v6/feed/detail', 'GET', false], ['goodsAlbum', '/v6/user/productAlbumList', 'GET', false], ['goodsListCreate', '/v6/goodsList/create', 'POST', true], ['goodsListEdit', '/v6/goodsList/edit', 'POST', true], ['goodsItemAdd', '/v6/goodsList/addGoods', 'POST', true], ['goodsItemRemove', '/v6/goodsList/deleteItems', 'POST', true], ['goodsItemEdit', '/v6/goodsList/editGoodsItem', 'POST', true], ['goodsItemVote', '/v6/goodsList/vote', 'POST', true], ['goodsListBind', '/v6/goodsList/bindFeedToGoodsList', 'POST', true], ['goodsAlbumCreate', '/v6/productAlbum/create', 'POST', true],
].map(([operation, endpoint, method, authenticated]) => ({ operation, endpoint, method, authenticated })));
export const GOODS_OPERATIONS = Object.freeze(GOODS_CONTRACTS.map(row => row.operation));
export async function dispatchGoods(client, operation, args = {}) {
  const contract = GOODS_CONTRACTS.find(row => row.operation === operation); if (!contract) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('好物参数无效', 'INPUT');
  if (contract.authenticated) assertLogin(client.identity);
  const post = form => client.request(contract.endpoint, {}, { method: 'POST', form });
  switch (operation) {
    case 'goodsHotWords': return goodsListResult(await client.request(contract.endpoint), true);
    case 'goodsSearch': {
      const sorts = { default: ['default', 'default'], sell: ['sell', 'sell'], price_asc: ['price', 'asc'], price_desc: ['price', 'desc'] }, selected = sorts[args.sort ?? 'default'];
      if (!Object.hasOwn(sorts, args.sort ?? 'default')) throw new ApiError('好物排序无效', 'INPUT');
      return goodsListResult(await client.request(contract.endpoint, { keyword: text(args.keyword, 200, true), sortName: selected[0], sort: selected[1], isCoupon: flag(args.coupon), page: page(args) }));
    }
    case 'goodsPrepare': return created(await post({ url: goodsLink(args.url) }), '商品转换', false);
    case 'goodsDetail': { const result = await client.request(contract.endpoint, { id: identifier(args.id) }); if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new ApiError('商品详情没有返回有效资料', 'API_ERROR'); return result; }
    case 'goodsListTypes': return goodsListResult(await client.request(contract.endpoint));
    case 'goodsLists': return goodsListResult(await client.request(contract.endpoint, { page: page(args), ...(args.uid ? { uid: numericId(args.uid) } : {}), ...(args.goodsId ? { goodsId: identifier(args.goodsId) } : {}) }));
    case 'goodsStore': case 'goodsAlbums': return goodsListResult(await client.request(contract.endpoint, { uid: uid(client, args), page: page(args) }));
    case 'goodsMyFeeds': {
      const type = args.type ?? 'all'; if (!['all', 'wish', 'buy'].includes(type)) throw new ApiError('好物类型无效', 'INPUT');
      return goodsListResult(await client.request(contract.endpoint, { url: `/goods/goodsFeedList?uid=${uid(client, args)}${type === 'all' ? '' : `&type=${type}`}`, page: page(args) }));
    }
    case 'goodsListFeed': return listFeed(client, args.id);
    case 'goodsAlbum': {
      const id = numericId(args.id), owner = uid(client, args); let firstItem = '', lastItem = '';
      for (let current = 1; current <= 20; current++) { const result = goodsListResult(await client.request(contract.endpoint, { uid: owner, page: current })); const album = result.data.find(row => String(row.id ?? row.entityId) === id); if (album) return { data: album }; if (!result.data.length || result.hasMore === false || current > 1 && result.firstItem === firstItem && result.lastItem === lastItem) break; firstItem = result.firstItem; lastItem = result.lastItem; }
      throw new ApiError('该用户的产品专辑分页未返回此专辑，未以其它清单代替', 'API_ERROR');
    }
    case 'goodsListCreate': { const form = listForm(args); form.cover = catalogImage(form.cover ?? ''); if (args.targetId) form.targetId = text(String(args.targetId), 200, true); if (args.targetType) form.targetType = text(args.targetType, 50, true); return created(await post(form), '好物清单'); }
    case 'goodsListEdit': { const form = listForm(args), feed = (await listFeed(client, numericId(args.id), true)).data; form.cover = picture(form.cover, feed.goodsListInfo.cover || feed.goodsListInfo.coverPic || ''); return post({ id: infoId(feed), ...form }); }
    case 'goodsItemAdd': { const goodsId = identifier(args.goodsId), note = text(args.note ?? '', 2000), pic = catalogImage(args.pic ?? ''), feed = (await listFeed(client, numericId(args.id), true)).data; return post({ feedId: infoId(feed), goodsId, note, pic }); }
    case 'goodsItemEdit': case 'goodsItemRemove': {
      identifier(args.itemId); identifier(args.goodsId); const note = text(args.note ?? '', 2000), feed = (await listFeed(client, numericId(args.id), true)).data, item = selectedItem(feed, args), itemFeedId = numericId(item.feed_id ?? feed.id);
      return operation === 'goodsItemRemove' ? post({ cancelFeedId: itemFeedId, goodsId: identifier(args.goodsId) }) : post({ feedId: itemFeedId, goodsId: identifier(args.goodsId), note, pic: picture(args.pic, item.product_goods_cover || item.pic || '') });
    }
    case 'goodsItemVote': {
      const value = integer(args.value, -1, 1); if (![1, -1].includes(value)) throw new ApiError('好物投票只支持赞同或取消', 'INPUT');
      const feed = (await listFeed(client, numericId(args.id))).data, item = selectedItem(feed, args);
      if (!flag(feed.goodsListInfo.is_open_vote)) throw new ApiError('此清单没有开启投票', 'INPUT');
      return post({ id: infoId(feed), item_id: identifier(item.id ?? item.feed_id ?? item.entityId), value });
    }
    case 'goodsListBind': {
      const target = numericId(args.feedId), feed = (await listFeed(client, numericId(args.id), true)).data;
      const result = await client.request('/v6/feed/detail', { id: target });
      if (String(result.data?.id) !== target || String(result.data?.uid ?? result.data?.userInfo?.uid) !== String(client.identity.uid)) throw new ApiError('只能将自己的动态绑定到清单', 'FORBIDDEN');
      return post({ feedId: target, goodsListId: infoId(feed) });
    }
    case 'goodsAlbumCreate': {
      if (args.albumType != null && Number(args.albumType) !== 0) throw new ApiError('当前确认的产品专辑类型为自定义清单', 'INPUT');
      const items = args.items ?? []; if (!Array.isArray(items) || items.length > 50) throw new ApiError('产品专辑最多包含 50 个项目', 'INPUT');
      const form = { title: text(args.title, 100, true), description: text(args.description ?? '', 4000), album_type: 0, targetType: text(args.targetType ?? '', 50), targetId: text(String(args.targetId ?? ''), 200) };
      items.forEach((item, index) => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError('产品专辑项目无效', 'INPUT'); const images = item.item_images ? text(item.item_images, 20000).split(',').map(catalogImage).join(',') : ''; const row = { id: optionalId(item.id), level: String(integer(item.level, 1, 100, 1)), item_id: optionalId(item.item_id), item_logo: catalogImage(item.item_logo ?? ''), item_name: text(item.item_name, 200, true), item_description: text(item.item_description ?? '', 2000), item_images: images, display_order: index }; for (const [key, value] of Object.entries(row)) form[`productItems[${index}][${key}]`] = value; });
      return created(await post(form), '产品专辑');
    }
  }
}
