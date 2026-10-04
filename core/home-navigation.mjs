// Read-only homepage list destinations observed in the official APK response.
// Page-rendering routes use the APK's GET page/dataList wrapper; two older app
// screens have separate GET bindings and were verified against those bindings.
const word = value => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
const flag = value => value === '0' || value === '1';
const integer = (min, max) => value => /^\d{1,10}$/.test(value) && Number(value) >= min && Number(value) <= max;
const ids = value => /^\d{1,20}(?:,\d{1,20}){0,31}$/.test(value);
const id = value => /^\d{1,20}$/.test(value);
const text = max => value => !!value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const enumValue = values => value => values.includes(value);
const common = { title: text(200), page: integer(1, 1000), firstItem: text(256), lastItem: text(256) };
const cacheExpires = integer(0, 604800);
const rankingConfig = value => {
  try { const row = JSON.parse(value); return row && !Array.isArray(row) && Object.keys(row).length === 1 && Object.hasOwn(row, 'withRanking') && [0, 1].includes(row.withRanking); } catch { return false; }
};
export function searchNavigation(type, value) {
  const aliases = { app: 'apk', topic: 'feedTopic', feedtopic: 'feedTopic', dyh: 'dyhMix', dyhmix: 'dyhMix', hotsearch: 'all' }, requested = String(type || 'all').toLowerCase(), category = aliases[requested] || requested;
  const keyword = typeof value === 'string' ? value.trim() : '';
  return keyword && typeof value === 'string' && text(200)(value) && ['all', 'feed', 'user', 'apk', 'game', 'product', 'ershou', 'album', 'ask', 'goods', 'goods_list', 'question', 'answer', 'feedTopic', 'dyhMix'].includes(category) ? { kind: 'search', type: category, title: keyword } : null;
}
const list = (title, parameters = {}, direct = false) => Object.freeze({ title, parameters: Object.freeze({ ...common, ...parameters }), direct });
export const HOME_READ_LISTS = Object.freeze({
  '/feed/targetFeedList': list('相关动态', { tagKeywords: text(200), recentProductCategoryId: ids, sortField: enumValue(['rank_score', 'lastupdate_desc', 'hot_rank_score', 'dateline_desc']), feedType: ids, recentProductDay: integer(1, 3650), cacheExpires }),
  '/feed/mediaList': list('视频动态', { uid: id, filterRepeatUser: flag, cacheExpires, orderBy: enumValue(['rank_score']) }),
  '/product/releasedProductList': list('上市新机', { categoryId: ids, entityTemplate: enumValue(['productTimelineWithLogo', 'productTimeline']) }),
  '/product/unreleasedProductList': list('发布日历', { id: ids, sortType: enumValue(['ASC', 'DESC']), entityTemplate: enumValue(['productTimeline']), sortField: enumValue(['wish_count']) }),
  '/member/rankList': list('优质酷友', { cacheExpires, withFansFollow: flag, withConfigCard: flag, configCardExtraData: rankingConfig }),
  '/member/userDeviceWithHitRecentList': list('最近访问'),
  '/article/articlesList': list('资讯', { dyhId: ids, entityTemplate: enumValue(['articleNews']) }),
  '/article/includeFeedList': list('专题动态', { dyhId: ids, removeExtraTitle: flag, isDigest: flag, order: enumValue(['id', 'feed_id']), orderBy: enumValue(['lastupdate']), feedOrder: enumValue(['lastupdate']) }),
  '/collectionItem/itemList': list('收藏单', { collectionId: id }),
  '/appForum/newestForumList': list('应用讨论区'),
  '/searchWord/hotList': list('大家都在搜', { cardEntityTemplate: enumValue(['capsuleListCard']), contentEntityType: enumValue(['hotSearch']), filterSpamWords: flag, addCardWord: flag }),
  '/apk/updateList': list('今日更新'),
  '/apk/recommendList': list('好软推荐'),
  '/apk/hotGameList': list('热门游戏'),
  '/apk/newestList': list('最新应用'),
  '/apk/rankList': list('应用排行'),
  '/apk/developerAppList': list('开发者应用'),
  '/apk/cpsGameList': list('游戏专区'),
  '/apk/topList': list('应用榜单'),
  '/album/recommendList': list('推荐应用集'),
  '/apk/index': list('应用', { apkType: integer(0, 2), listType: enumValue(['cat']), catId: id, rankType: word }, true),
  '/apk/giftList': list('应用礼包', { apkId: id }, true),
});

export function homepageListRoute(url) {
  const definition = HOME_READ_LISTS[url.pathname];
  if (!definition) return null;
  const known = new Set();
  for (const [name, value] of url.searchParams) {
    if (known.has(name) || !Object.hasOwn(definition.parameters, name) || !definition.parameters[name](value)) throw new RangeError('首页列表参数无效');
    known.add(name);
  }
  const address = url.pathname + url.search;
  return { title: url.searchParams.get('title') || definition.title, endpoint: definition.direct ? '/v6' + url.pathname : '/v6/page/dataList', query: definition.direct ? Object.fromEntries(url.searchParams) : { url: '#' + address }, pageUrl: definition.direct ? address : '/page?url=' + encodeURIComponent('#' + address) };
}
