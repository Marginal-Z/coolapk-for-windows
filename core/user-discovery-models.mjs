// Pure browser model. UserPage.vue:614-657 exposes these public tabs; private lists are excluded.
export const USER_PUBLIC_TABS = Object.freeze([
  { id: 'feed', title: '动态' }, { id: 'rating', title: '评分' }, { id: 'article', title: '图文' },
  { id: 'qa', title: '问答' }, { id: 'coolpic', title: '酷图' }, { id: 'ershou', title: '二手' },
  { id: 'goods', title: '好物' }, { id: 'goods_rank', title: '好物榜' }, { id: 'collection', title: '收藏单' },
  { id: 'album', title: '应用集' }, { id: 'developer_apps', title: '开发的应用' },
  { id: 'apk_follow', title: '关注应用' }, { id: 'discovery', title: '发现' }, { id: 'goods_store', title: '商品店' },
]);
export function visibleUserTabs(data = {}) {
  const info = data && typeof data === 'object' && !Array.isArray(data) ? { ...data.userInfo, ...data } : {};
  const positive = (...keys) => keys.some(key => Number(info[key]) > 0);
  const optional = { album: positive('albumNum', 'album_num'), developer_apps: positive('apkDevNum', 'apk_dev_num') || [1, '1', true].includes(info.isDeveloper), apk_follow: positive('apkFollowNum', 'apk_follow_num'), discovery: positive('discoveryNum', 'discovery_num'), goods_store: positive('goodsCount', 'goods_count') || Number(info.goodsStoreStatus ?? info.goods_store_status) === 1 };
  return USER_PUBLIC_TABS.filter(tab => !(tab.id in optional) || optional[tab.id]);
}
export function userEntityTarget(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const positive = value => /^[1-9]\d{0,19}$/.test(String(value ?? ''));
  const type = row.entityType;
  if (type === 'user') return positive(row.uid) ? row : null;
  if (type === 'topic') return typeof (row.tag || row.title) === 'string' && (row.tag || row.title).trim() && (row.tag || row.title).length <= 200 ? row : null;
  if (type === 'apk') { const packageName = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(row.packageName || '') ? row.packageName : ''; return packageName || positive(row.id) ? { ...row, packageName } : null; }
  // Album navigation also needs its owner; never let the current viewer become a missing owner.
  if (type === 'productAlbum') return positive(row.id) && positive(row.uid || row.userInfo?.uid) ? row : null;
  if (['feed', 'question', 'answer', 'feedQuestion', 'feedAnswer', 'dyhArticle', 'feedReply', 'product', 'dyh', 'album', 'event', 'live', 'collection', 'goods', 'product_goods', 'goodsList', 'goods_list'].includes(type) && positive(row.id)) return row;
  return null;
}
