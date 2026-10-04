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
  const result = await client.request('/v6/feed/detail', { id: numericId(id) }, { method: 'POST', form: { trace: '' } });
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
async function createOnce(client, endpoint, form, label) {
  try { return created(await client.request(endpoint, {}, { method: 'POST', form }), label); }
  catch (error) {
    const rejected = ['ACCOUNT_CHANGED', 'INPUT', 'LOGIN_REQUIRED', 'VERIFY_REQUIRED', 'FORBIDDEN', 'UNSUPPORTED'].includes(error?.code) || error?.code === 'API_ERROR' && Number.isInteger(error.detail?.serverStatus);
    // A lost response or a missing created id cannot prove that creation failed.
    // Keep explicit server rejection / verification retryable, without replaying
    // an operation which may already have created another feed.
    if (error?.detail?.responseInvalid || !rejected) throw new ApiError(`${label}提交结果尚未确认，请先查看我的清单核对，避免重复创建`, 'WRITE_UNCONFIRMED');
    throw error;
  }
}
function albumAccountGuard(client) {
  const identity = client.identity, owner = String(identity?.uid ?? ''), cookie = client.cookie, device = client.deviceCode;
  return () => { if (client.identity !== identity || String(client.identity?.uid ?? '') !== owner || client.cookie !== cookie || client.deviceCode !== device) throw new ApiError('账号已切换，请重新打开产品清单', 'ACCOUNT_CHANGED'); };
}
async function albumFeed(client, id, owner = false) {
  id = numericId(id); const guard = albumAccountGuard(client);
  const result = await client.request('/v6/feed/detail', { id }, { method: 'POST', form: { trace: '' } }); guard();
  const feed = result.data;
  if (!feed || typeof feed !== 'object' || Array.isArray(feed) || String(feed.id) !== id || !['anythingList', 'productAlbum'].includes(feed.feedType)) throw new ApiError('此动态未返回产品清单资料', 'API_ERROR');
  if (Array.isArray(feed.productAlbumDetailInfo) && feed.productAlbumDetailInfo.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new ApiError('产品清单项目资料无效', 'API_ERROR');
  if (owner && String(feed.uid ?? '') !== String(client.identity.uid)) throw new ApiError('只能管理自己的产品清单', 'FORBIDDEN');
  return { result, feed, guard };
}
function albumItemsForm(items, previous = []) {
  if (!Array.isArray(items) || items.length > 50) throw new ApiError('产品专辑最多包含 50 个项目', 'INPUT');
  const form = {}, names = new Set(), ids = new Set();
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['id', 'level', 'item_id', 'item_logo', 'item_name', 'item_description', 'item_images', 'display_order'].includes(key))) throw new ApiError('产品清单项目字段无效', 'INPUT');
    const id = optionalId(item.id), old = id ? previous.find(row => String(row.id) === id) : undefined;
    if (id && !old || id && ids.has(id)) throw new ApiError('项目编号已变化，请刷新清单后重试', 'INPUT');
    if (id) ids.add(id);
    const name = text(item.item_name, 200, true); if (names.has(name)) throw new ApiError('清单内存在重复的产品名称', 'INPUT'); names.add(name);
    const itemId = optionalId(item.item_id);
    if (old && itemId !== String(old.item_id ?? '')) throw new ApiError('已有清单项目关联的产品已变化，请刷新后重试', 'INPUT');
    if (old && itemId && itemId !== '0' && name !== String(old.item_name ?? '').trim()) throw new ApiError('关联产品名称由酷安提供，只能修改自定义产品的名称', 'INPUT');
    const images = item.item_images == null ? old?.item_images || '' : text(item.item_images, 20000);
    if (images !== (old?.item_images || '') && images.split(',').filter(Boolean).length > 9) throw new ApiError('每个产品最多只能添加 9 张图片', 'INPUT');
    const row = { ...(id ? { id } : {}), level: String(integer(item.level == null || item.level === '' ? old?.level || 1 : item.level, 1, 5, 1)), item_id: itemId, item_logo: picture(item.item_logo, old?.item_logo || ''), item_name: name, item_description: text(item.item_description ?? '', 2000), item_images: images === (old?.item_images || '') ? images : images.split(',').filter(Boolean).map(catalogImage).join(','), display_order: index };
    for (const [key, value] of Object.entries(row)) form[`productItems[${index}][${key}]`] = value;
  });
  return form;
}
function albumRelation(feed) {
  const target = feed.targetRow && typeof feed.targetRow === 'object' ? feed.targetRow : {};
  const aliases = { product: 'product_phone', phone: 'product_phone', product_phone: 'product_phone', '7': 'product_phone', apk: 'apk', '1': 'apk', tag: 'tag', topic: 'tag', '3': 'tag', '5': 'tag' };
  // AnythingListActionHelper uses EntityExtendsKt's encoded tid prefix first,
  // then ttype / targetRow.targetType. The last nine tid digits are the node id.
  const tid = String(feed.tid ?? ''), encoded = /^\d{10,}$/.test(tid), prefix = encoded ? tid.slice(0, -9) : '';
  const prefixType = ['1', '3', '5', '7'].includes(prefix) ? aliases[prefix] : '';
  const type = String(feed.ttype || '').toLowerCase(), rowType = String(target.targetType || '').toLowerCase();
  const targetType = prefixType || (Object.hasOwn(aliases, type) ? aliases[type] : '') || (Object.hasOwn(aliases, rowType) ? aliases[rowType] : '');
  const rowId = String(target.id ?? ''), targetId = text(rowId || (encoded ? String(Number(tid.slice(-9))) : ''), 200);
  if (!targetType && (type || rowType || targetId || encoded)) throw new ApiError('该清单的关联节点类型尚未确认，已停止编辑', 'UNSUPPORTED');
  return { targetType, targetId };
}
export const GOODS_CONTRACTS = Object.freeze([
  ['goodsHotWords', '/v6/goods/searchHotWords', 'GET', false], ['goodsSearch', '/v6/goods/search', 'GET', false], ['goodsPrepare', '/v6/goods/addGoods', 'POST', true], ['goodsDetail', '/v6/goods/detail', 'GET', false], ['goodsListTypes', '/v6/goodsList/listType', 'GET', false], ['goodsLists', '/v6/goodsList/list', 'GET', false], ['goodsStore', '/v6/goods/goodsStoreItemList', 'GET', false], ['goodsAlbums', '/v6/user/productAlbumList', 'GET', false], ['goodsMyFeeds', '/v6/page/dataList', 'GET', false], ['goodsListFeed', '/v6/feed/detail', 'POST', false], ['goodsAlbum', '/v6/feed/detail', 'POST', false], ['goodsListCreate', '/v6/goodsList/create', 'POST', true], ['goodsListEdit', '/v6/goodsList/edit', 'POST', true], ['goodsItemAdd', '/v6/goodsList/addGoods', 'POST', true], ['goodsItemRemove', '/v6/goodsList/deleteItems', 'POST', true], ['goodsItemEdit', '/v6/goodsList/editGoodsItem', 'POST', true], ['goodsItemVote', '/v6/goodsList/vote', 'POST', true], ['goodsListBind', '/v6/goodsList/bindFeedToGoodsList', 'POST', true], ['goodsAlbumCreate', '/v6/productAlbum/create', 'POST', true], ['goodsAlbumEdit', '/v6/productAlbum/edit', 'POST', true], ['goodsAlbumDelete', '/v6/feed/deleteFeed', 'POST', true],
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
      const { result, feed } = await albumFeed(client, args.id);
      if (args.uid != null && numericId(args.uid) !== String(feed.uid)) throw new ApiError('此清单所属酷友与当前页面不一致', 'API_ERROR');
      const owned = !!client.identity?.uid && String(feed.uid) === String(client.identity.uid);
      return { ...result, data: { ...feed, title: feed.message_title || '', description: feed.message || '', album_type: Number(feed.productAlbumType), productItems: feed.productAlbumDetailInfo, canEdit: owned && Number(feed.enableModify) === 1 && Array.isArray(feed.productAlbumDetailInfo) && ['1', '2'].includes(String(feed.productAlbumType)) && Number(feed.isHistory || 0) !== 1, canDelete: owned && Number(feed.isHistory || 0) !== 1 } };
    }
    case 'goodsListCreate': { const form = listForm(args); form.cover = catalogImage(form.cover ?? ''); if (args.targetId) form.targetId = text(String(args.targetId), 200, true); if (args.targetType) form.targetType = text(args.targetType, 50, true); return createOnce(client, contract.endpoint, form, '好物清单'); }
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
      const result = await client.request('/v6/feed/detail', { id: target }, { method: 'POST', form: { trace: '' } });
      if (String(result.data?.id) !== target || String(result.data?.uid ?? result.data?.userInfo?.uid) !== String(client.identity.uid)) throw new ApiError('只能将自己的动态绑定到清单', 'FORBIDDEN');
      return post({ feedId: target, goodsListId: infoId(feed) });
    }
    case 'goodsAlbumCreate': {
      const albumType = integer(args.albumType, 1, 2, 1);
      const form = { title: text(args.title, 100, true), description: text(args.description ?? '', 200), album_type: albumType, targetType: text(args.targetType ?? '', 50), targetId: text(String(args.targetId ?? ''), 200), ...albumItemsForm(args.items ?? []) };
      return createOnce(client, contract.endpoint, form, '产品专辑');
    }
    case 'goodsAlbumEdit': case 'goodsAlbumDelete': {
      const allowed = operation === 'goodsAlbumDelete' ? ['id'] : ['id', 'title', 'description', 'items', 'expectedItemIds'];
      if (Object.keys(args).some(key => !allowed.includes(key))) throw new ApiError('产品清单操作字段无效', 'INPUT');
      const id = numericId(args.id), title = operation === 'goodsAlbumEdit' ? text(args.title, 100, true) : '', description = operation === 'goodsAlbumEdit' ? text(args.description ?? '', 200) : '';
      const { feed, guard } = await albumFeed(client, id, true);
      if (Number(feed.isHistory || 0) === 1) throw new ApiError('历史版本不能作为当前产品清单修改或删除', 'INPUT');
      if (operation === 'goodsAlbumDelete') { guard(); const result = await client.request(contract.endpoint, { id, notNotify: 0 }, { method: 'POST' }); guard(); return result; }
      if (Number(feed.enableModify) !== 1) throw new ApiError(Number(feed.enableModify) === -1 ? '此清单编辑次数已用尽' : Number(feed.status) === -5 ? '此清单正在审核中，暂时不能编辑' : '酷安未开放此清单的编辑权限', 'FORBIDDEN');
      if (!Array.isArray(feed.productAlbumDetailInfo) || !['1', '2'].includes(String(feed.productAlbumType))) throw new ApiError('完整清单项目或类型未返回，已停止修改', 'API_ERROR');
      if (args.expectedItemIds != null) { if (!Array.isArray(args.expectedItemIds) || args.expectedItemIds.length > 50) throw new ApiError('清单项目快照无效', 'INPUT'); const expected = args.expectedItemIds.map(identifier).sort(), actual = feed.productAlbumDetailInfo.map(row => identifier(row.id)).sort(); if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new ApiError('清单项目已在其它设备变化，请刷新后重新编辑', 'CONFLICT'); }
      const form = { id, title, description, album_type: Number(feed.productAlbumType), ...albumRelation(feed), ...albumItemsForm(args.items, feed.productAlbumDetailInfo) };
      guard(); const result = created(await post(form), '清单编辑'); guard();
      if (result.createdId !== id) throw new ApiError('酷安未确认原清单编号，请刷新后核对修改结果', 'API_ERROR');
      return result;
    }
  }
}
