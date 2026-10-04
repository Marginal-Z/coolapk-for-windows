import { ApiError, assertLogin, numericId, flattenEntities } from './client.mjs';

// Fixed protocol contracts cross-checked with the MIT reference client.rs.
const input = (value, max = 2000, required = false) => {
  if (typeof value !== 'string' || value.length > max || /[\0\r]/.test(value) || required && !value.trim()) throw new ApiError('输入内容无效', 'INPUT');
  return value.trim();
};
const integer = (value, min, max, fallback) => {
  if (value == null && fallback != null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new ApiError('数值超出允许范围', 'INPUT');
  return number;
};
const pick = (value, allowed, fallback) => { const selected = value ?? fallback; if (!allowed.includes(selected)) throw new ApiError('无效的栏目选项', 'INPUT'); return selected; };
const appId = value => {
  const id = input(String(value ?? ''), 200, true);
  if (!/^\d{1,20}$/.test(id) && !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(id)) throw new ApiError('应用包名或编号无效', 'INPUT');
  return id;
};
const ids = (value, max = 50) => {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  if (!entries.length || entries.length > max) throw new ApiError('请选择有效的内容', 'INPUT');
  return [...new Set(entries.map(numericId))];
};
export function catalogImage(value = '') {
  if (!value) return '';
  let url; try { url = new URL(input(value, 2048)); } catch { throw new ApiError('图片地址无效', 'INPUT'); }
  if (!['https:', 'http:'].includes(url.protocol) || !['image.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com'].includes(url.hostname) || url.port || url.username || url.password) throw new ApiError('仅支持酷安官方图片地址', 'INPUT');
  url.protocol = 'https:'; return url.toString();
}
const officialAppLink = (value, packageName) => {
  const url = new URL(value || `https://www.coolapk.com/apk/${packageName}`);
  if (url.origin !== 'https://www.coolapk.com' || url.username || url.password || !/^\/apk\/[A-Za-z0-9_.]+$/.test(url.pathname)) throw new ApiError('应用链接无效', 'INPUT');
  return url.toString();
};
function cursor(args) {
  return { page: integer(args.page, 1, 1000, 1), ...(args.firstItem ? { firstItem: input(String(args.firstItem), 120) } : {}), ...(args.lastItem ? { lastItem: input(String(args.lastItem), 120) } : {}) };
}
function listResult(result) {
  const rows = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.list, result.data?.rows, result.data?.data].find(Array.isArray);
  if (!rows) throw new ApiError('酷安返回的列表结构异常', 'API_ERROR');
  const data = flattenEntities(rows);
  return { ...result, data, rawCount: rows.length, firstItem: String(data[0]?.entityId ?? data[0]?.id ?? ''), lastItem: String(data.at(-1)?.entityId ?? data.at(-1)?.id ?? '') };
}
// ProductPage/productRatingSort.ts obtains these exact read descriptors from
// sortSelectCard. Keep its identity before flattening rather than treating any
// title+URL entity as a sorting control.
export function productRatingDescriptor(productId, value) {
  const id = numericId(productId), source = input(value, 2000, true);
  if (source.startsWith('//')) throw new ApiError('点评栏目地址无效', 'INPUT');
  let outer, inner;
  try { outer = new URL(source, 'https://www.coolapk.com'); inner = new URL(outer.pathname === '/page' ? outer.searchParams.get('url') || '' : source, outer.origin); }
  catch { throw new ApiError('点评栏目地址无效', 'INPUT'); }
  if (outer.origin !== 'https://www.coolapk.com' || inner.origin !== outer.origin || outer.username || outer.password || inner.username || inner.password || outer.port || inner.port || outer.hash || inner.hash
    || outer.pathname === '/page' && (outer.searchParams.getAll('url').length !== 1 || [...outer.searchParams.keys()].some(key => key !== 'url'))
    || inner.pathname !== '/product/feedList') throw new ApiError('点评栏目地址无效', 'INPUT');
  const fields = inner.searchParams;
  if ([...fields.keys()].some(key => !['id', 'type', 'listType', 'isOwner', 'targetType', 'targetId'].includes(key) || fields.getAll(key).length !== 1)
    || fields.get('id') !== id || !['rating', 'ratingByScore'].includes(fields.get('type'))
    || fields.has('listType') && fields.get('listType') !== 'dateline_desc'
    || fields.has('isOwner') && fields.get('isOwner') !== '1'
    || fields.has('targetType') && fields.get('targetType') !== '7'
    || fields.has('targetId') && fields.get('targetId') !== id) throw new ApiError('点评栏目与当前产品不匹配', 'INPUT');
  return inner.pathname + inner.search;
}
function productRatingResult(result, id) {
  if (!Array.isArray(result.data)) throw new ApiError('酷安返回的点评栏目结构异常', 'API_ERROR');
  const card = result.data.find(row => row && typeof row === 'object' && !Array.isArray(row) && row.entityTemplate === 'sortSelectCard');
  const seen = new Set(), ratingSortOptions = [];
  for (const entry of Array.isArray(card?.entities) ? card.entities.slice(0, 30) : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.url !== 'string') continue;
    try { const descriptor = productRatingDescriptor(id, entry.url); if (seen.has(descriptor)) continue; seen.add(descriptor); ratingSortOptions.push({ title: entry.title.trim().slice(0, 120), url: entry.url.trim() }); }
    catch (error) { if (!(error instanceof ApiError) || error.code !== 'INPUT') throw error; }
  }
  const data = flattenEntities(result.data).filter(row => row.entityType === 'feed');
  return { ...result, data, ratingSortOptions, rawCount: result.data.length, firstItem: result.firstItem || String(data[0]?.entityId ?? data[0]?.id ?? ''), lastItem: result.lastItem || String(data.at(-1)?.entityId ?? data.at(-1)?.id ?? ''), hasMore: result.hasMore ?? data.length > 0 };
}
const baseFeed = (message, type = 'feed') => ({ id: '', message, type, pic: '', status: 1, publish_status: 0, location: '', long_location: '', latitude: '0.0', longitude: '0.0', media_url: '', media_type: 0, media_pic: '', message_title: '', message_brief: '', extra_title: '', extra_url: '', extra_key: '', extra_pic: '', extra_info: '', message_cover: '', original_type: 0, is_editInDyh: 0, forwardid: '', fid: '', dyhId: '', targetType: '', productId: '', targetId: '', location_city: '', location_country: '', disallow_reply: 0, vote_score: 0, replyWithForward: 0, media_info: '', insert_product_media: 0, is_ks_doc: 0, goods_list_id: '', is_html_article: 0 });
const definitions = {
  catalogProduct: { path: '/v6/product/detail', query: a => a.name ? { name: input(a.name, 200, true) } : { id: numericId(a.id) } },
  catalogProductBrands: { path: '/v6/product/brandList', list: true },
  catalogProductCategories: { path: '/v6/product/categoryList', list: true },
  catalogProductBrandItems: { path: '/v6/product/productList', list: true, query: a => ({ id: numericId(a.id), type: input(a.type ?? '', 80) }) },
  catalogProductCategoryItems: { path: '/v6/page/dataList', list: true, query: a => {
    const url = input(a.url, 2000, true);
    if (!/^(?:#\/|\/page\?url=\/|\/)product\/(?:productList|list|newList)\b/.test(url)) throw new ApiError('产品分类地址无效', 'INPUT');
    return { url, title: input(a.title ?? '', 200), subTitle: input(a.subTitle ?? '', 200) };
  } },
  catalogProductVersions: { path: '/v6/product/getVersionList', query: a => ({ product_id: numericId(a.id) }) },
  catalogProductConfig: { path: '/v6/product/config', query: a => ({ id: numericId(a.id) }) },
  catalogProductFeeds: { path: '/v6/page/dataList', list: true, query: a => ({ url: '/page?url=/product/feedList', id: numericId(a.id), type: input(a.type ?? 'feed', 80, true), ...(a.sort === '' ? {} : { listType: input(a.sort ?? 'lastupdate_desc', 80) }) }) },
  catalogProductSubtab: { path: '/v6/page/dataList', list: true, query: a => ({ url: '/page?url=/product/feedList', cacheExpires: 60, type: 'subTabFeed', withSortCard: 1, withSubTabFeedCard: 1, ignoreEntityById: 1, id: numericId(a.id), subId: numericId(a.subId) }) },
  catalogProductMedia: { path: '/v6/product/mediaList', list: true, query: a => ({ id: numericId(a.id), type: pick(a.type, ['image', 'video', 'all'], 'image'), is_recommend: integer(a.recommended, 0, 1, 0) }) },
  catalogProductRatingChart: { path: '/v6/product/ratingChart', query: a => ({ id: numericId(a.id) }) },
  catalogProductRatings: { path: '/v6/page/dataList', list: true, query: a => ({ url: '/feed/nodeRatingList', targetType: 7, targetId: numericId(a.id), ...(Number(a.star) > 0 ? { star: integer(a.star, 1, 5) } : {}), ...(a.owner === true || a.owner === 1 ? { isOwner: 1 } : {}) }) },
  catalogProductRatingPage: { path: '/v6/page/dataList', list: true, query: a => {
    if (Object.keys(a).some(key => !['id', 'url', 'page', 'firstItem', 'lastItem'].includes(key))) throw new ApiError('点评排序不支持附加筛选字段', 'INPUT');
    return { url: productRatingDescriptor(a.id, a.url) };
  } },
  catalogMyProducts: { path: '/v6/page/dataList', list: true, login: true, query: a => ({ url: `#/product/productList?type=${pick(a.type, ['wish', 'buy', 'owner'], 'wish')}` }) },
  catalogProductWish: { path: '/v6/product/changeWishStatus', method: 'POST', login: true, form: a => ({ id: numericId(a.id), status: integer(a.status, 0, 1) }) },
  catalogProductFollow: { path: '/v6/product/changeFollowStatus', method: 'POST', login: true, form: a => ({ id: numericId(a.id), status: integer(a.status, 0, 1) }) },
  catalogProductWishUsers: { path: '/v6/product/wishList', list: true, method: 'POST', login: true, query: a => ({ id: numericId(a.id) }), form: () => ({}) },
  catalogProductBuyUsers: { path: '/v6/product/buyList', list: true, method: 'POST', login: true, query: a => ({ id: numericId(a.id) }), form: () => ({}) },
  catalogCompareAdd: { path: '/v6/product/addConfigCompare', method: 'POST', login: true, form: a => ({ config_id: numericId(a.id) }) },
  catalogCompareRemove: { path: '/v6/product/removeConfigCompare', method: 'POST', login: true, form: a => ({ config_id: numericId(a.id) }) },
  catalogRating: { path: '/v6/apk/rating', login: true, query: a => ({ id: appId(a.id), value: integer(a.value, 0, 5) }) },
  catalogApp: { path: '/v6/apk/detail', query: a => ({ id: appId(a.id) }) },
  catalogAppComments: { path: '/v6/apk/commentList', list: true, query: a => ({ id: appId(a.id), listType: pick(a.sort, ['lastupdate_desc', 'dateline_desc', 'popular'], 'lastupdate_desc') }) },
  catalogAppRelated: { path: '/v6/apk/search', list: true, query: a => ({ q: appId(a.id), apkType: 0, searchType: 'related' }) },
  catalogAppDeveloper: { path: '/v6/apk/search', list: true, query: a => ({ searchType: 'developer', developer: input(a.developer, 200, true) }) },
  catalogAppTag: { path: '/v6/apk/search', list: true, query: a => ({ searchType: 'tag', tag: input(a.tag, 200, true), apkType: pick(a.type, ['0', '1'], '0') }) },
  catalogAppRecommend: { path: '/v6/apk/recommendList', list: true, query: a => ({ apkType: pick(a.type, ['0', '1'], '0'), title: input(a.title ?? '', 200) }) },
  catalogAppDiscoverers: { path: '/v6/apk/discovererList', list: true, query: a => ({ id: appId(a.id) }) },
  catalogAppRatings: { path: '/v6/apk/ratingUserList', list: true, query: a => ({ id: appId(a.id) }) },
  catalogAppGifts: { path: '/v6/apk/giftList', list: true, query: a => a.id ? { apkId: appId(a.id) } : {} },
  catalogAppUrl: { path: '/v6/apk/url', query: a => ({ id: appId(a.id) }) },
  catalogAppQr: { path: '/v6/apk/qr', query: a => ({ id: appId(a.id) }) },
  catalogAppFavorite: { path: '/v6/apk/favorite', login: true, query: a => ({ id: appId(a.id) }) },
  catalogAppUnfavorite: { path: '/v6/apk/unFavorite', login: true, query: a => ({ id: appId(a.id) }) },
  catalogAppComment: { path: '/v6/apk/comment', method: 'POST', login: true, query: a => ({ id: appId(a.id) }), form: a => ({ message: input(a.message, 10000, true) }) },
  catalogAlbums: { path: '/v6/album/list', list: true, query: a => ({ listType: pick(a.type, ['hot', 'new'], 'hot') }) },
  catalogAlbumSearch: { path: '/v6/album/search', list: true, query: a => ({ q: input(a.query, 200, true) }) },
  catalogAlbum: { path: '/v6/album/detail', query: a => ({ id: numericId(a.id) }) },
  catalogMyAlbums: { path: '/v6/user/albumList', list: true, login: true, query: (_a, client) => ({ uid: client.identity.uid }) },
  catalogAlbumReplies: { path: '/v6/album/replyList', list: true, query: a => ({ id: numericId(a.id) }) },
  catalogAlbumCreate: { path: '/v6/album/create', method: 'POST', login: true, form: a => ({ title: input(a.title, 100, true), intro: input(a.intro ?? '', 2000), cover: catalogImage(a.cover) }) },
  catalogAlbumEdit: { path: '/v6/album/edit', method: 'POST', login: true, ownerAlbum: true, query: a => ({ id: numericId(a.id) }), form: a => ({ title: input(a.title, 100, true), intro: input(a.intro ?? '', 2000), cover: catalogImage(a.cover) }) },
  catalogAlbumAddApp: { path: '/v6/album/addApk', method: 'POST', login: true, ownerAlbum: true, query: a => ({ id: numericId(a.id) }), form: a => { const packageName = appId(a.packageName); return { packageName, title: input(a.title, 200, true), url: officialAppLink(a.url, packageName), note: input(a.note ?? '', 2000), displayOrder: integer(a.order, 0, 10000, 0), logo: catalogImage(a.logo) }; } },
  catalogAlbumRemoveApp: { path: '/v6/album/delApk', method: 'POST', login: true, ownerAlbum: true, query: a => ({ id: numericId(a.id) }), form: a => ({ packageName: appId(a.packageName) }) },
  catalogDyhs: { path: '/v6/dyh/list', list: true },
  catalogDyh: { path: '/v6/dyh/detail', query: a => ({ dyhId: numericId(a.id) }) },
  catalogDyhFeeds: { path: '/v6/dyhArticle/list', list: true, query: a => ({ dyhId: numericId(a.id), type: pick(a.type, ['all', 'square'], 'all') }) },
  catalogDyhFollow: { path: '/v6/dyh/follow', login: true, query: a => ({ dyhId: numericId(a.id) }) },
  catalogDyhUnfollow: { path: '/v6/dyh/unFollow', login: true, query: a => ({ dyhId: numericId(a.id) }) },
  catalogDyhFollowing: { path: '/v6/user/dyhFollowList', list: true, login: true },
  catalogDyhSubscriptions: { path: '/v6/user/dyhSubscribe', list: true, login: true },
  catalogDyhEditing: { path: '/v6/user/editorDyhList', list: true, login: true, query: () => ({ showNews: 1, showType: 1 }) },
  catalogEvents: { path: '/v6/event/list', list: true },
  catalogEvent: { path: '/v6/event/detail', query: a => ({ id: numericId(a.id) }) },
  catalogPictures: { path: '/v6/picture/list', list: true, query: a => ({ tag: input(a.tag ?? '', 200) }) },
  questionAnswers: { path: '/v6/question/answerList', list: true, query: a => ({ id: numericId(a.id), sort: pick(a.sort, ['reply', 'like', 'dateline'], 'reply') }) },
  questionFollow: { path: '/v6/question/follow', login: true, query: a => ({ id: numericId(a.id) }) },
  questionUnfollow: { path: '/v6/question/unFollow', login: true, query: a => ({ id: numericId(a.id) }) },
  questionInvite: { path: '/v6/question/inviteAnswer', method: 'POST', login: true, multipart: true, form: a => ({ uid: ids(a.uids).join(','), questionId: numericId(a.id) }) },
  voteComments: { path: '/v6/vote/commentList', list: true, pageOnly: true, query: a => ({ fid: numericId(a.id) }) },
  voteSubmit: { path: '/v6/vote/createUserVote', method: 'POST', login: true, form: a => {
    const selected = ids(a.optionIds, 50);
    return { id: numericId(a.id), anonymous_status: a.anonymous === true ? 1 : 0, ...Object.fromEntries(selected.map((id, index) => [`select_option[${index}]`, id])) };
  } },
};
export const catalogOperations = Object.freeze([...Object.keys(definitions), 'catalogAppVersions', 'catalogProductReview', 'questionAnswer']);
export const catalogContracts = Object.freeze(Object.entries(definitions).map(([operation, definition]) => ({ operation, endpoint: definition.path, method: definition.method || 'GET', authenticated: !!definition.login, list: !!definition.list })));

export async function dispatchCatalog(client, operation, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('请求参数无效', 'INPUT');
  if (operation === 'catalogAppVersions') {
    const detail = await client.request('/v6/apk/detail', { id: appId(args.id) });
    const id = numericId(detail.data?.aid ?? detail.data?.id);
    return listResult(await client.request('/v6/apk/downloadVersionList', { id, ...cursor(args) }));
  }
  if (operation === 'catalogProductReview' || operation === 'questionAnswer') {
    assertLogin(client.identity);
    const id = numericId(args.id), message = input(args.message, 10000, true);
    const form = baseFeed(message, operation === 'questionAnswer' ? 'answer' : 'rating');
    if (operation === 'questionAnswer') { form.fid = id; form.pic = args.pic ? await client.validatePictures(args.pic) : ''; }
    else Object.assign(form, { targetType: 'product_phone', targetId: id, rating_score_1: integer(args.score, 1, 5), buy_status: args.bought === true ? 1 : 0, comment_good: '', comment_general: '', comment_bad: '', comment_good_pic: '', comment_general_pic: '', comment_bad_pic: '' });
    const result = await client.request('/v6/feed/createFeed', {}, { method: 'POST', form });
    numericId(result.data?.id); return result;
  }
  const definition = definitions[operation];
  if (!definition) throw new ApiError('不支持的目录操作', 'INPUT');
  if (definition.login) assertLogin(client.identity);
  const query = { ...(definition.query?.(args, client) || {}), ...(definition.list ? definition.pageOnly ? { page: cursor(args).page } : cursor(args) : {}) };
  let form = definition.form?.(args, client);
  if (definition.ownerAlbum) {
    const original = await client.request('/v6/album/detail', { id: query.id });
    const album = original.data, owner = album?.uid ?? album?.userInfo?.uid;
    if (String(album?.id ?? album?.albumId) !== query.id || String(owner) !== String(client.identity.uid)) throw new ApiError('只能管理当前账号的应用集', 'INPUT');
  }
  if (definition.multipart) { const multipart = new FormData(); for (const [key, value] of Object.entries(form)) multipart.set(key, String(value)); form = multipart; }
  const result = await client.request(definition.path, query, { method: definition.method || 'GET', ...(form ? { form } : {}) });
  if (operation === 'catalogProductRatingPage') return productRatingResult(result, numericId(args.id));
  if (operation === 'catalogAlbumCreate') {
    try { numericId(result.data?.id ?? result.data?.albumId); } catch { throw new ApiError('服务端没有返回创建后的应用集，请刷新确认', 'API_ERROR'); }
  }
  return definition.list ? listResult(result) : result;
}
