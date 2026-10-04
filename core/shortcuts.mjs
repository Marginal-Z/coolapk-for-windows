// Personal quick-entry order is a local appearance preference. No cloud write
// is implied: the official phone menu was sampled without changing its order.
export const DEFAULT_SHORTCUTS = Object.freeze(['following', 'collections', 'rating', 'night', 'article', 'reply', 'plugins']);
export const SHORTCUT_TITLES = Object.freeze({
  following: '我的关注', collections: '我的收藏', rating: '我的点评', night: '夜间模式', article: '我的图文', reply: '我的回复', plugins: '我的挂件',
  drafts: '草稿箱', digital: '我的数码', lists: '我的清单', likes: '我的赞', coolpic: '我的酷图', qa: '我的问答', goods: '我的好物', goodsRank: '我的好物榜',
  albums: '应用集', blacklist: '黑名单管理', blocks: '首页屏蔽管理', backups: '备份单', downloads: '应用下载任务', phoneApps: '手机应用管理', kankan: '看看号', settings: '设置',
});
export function normalizeShortcuts(value) {
  if (!Array.isArray(value)) return [...DEFAULT_SHORTCUTS];
  return [...new Set(value.filter(key => typeof key === 'string' && Object.hasOwn(SHORTCUT_TITLES, key)))];
}
export function shortcutStorageKey(namespace) {
  if (typeof namespace !== 'string' || !namespace || namespace.length > 200 || /[\0\r\n]/.test(namespace)) throw new TypeError('无效的账号范围');
  return 'coolapk-quick-entries:' + encodeURIComponent(namespace);
}
export function loadShortcuts(storage, namespace) {
  try { const raw = storage.getItem(shortcutStorageKey(namespace)); return raw ? normalizeShortcuts(JSON.parse(raw)) : [...DEFAULT_SHORTCUTS]; }
  catch { return [...DEFAULT_SHORTCUTS]; }
}
export function saveShortcuts(storage, namespace, value) {
  const normalized = normalizeShortcuts(value);
  storage.setItem(shortcutStorageKey(namespace), JSON.stringify(normalized));
  return normalized;
}
export function moveShortcut(value, key, target) {
  const order = normalizeShortcuts(value), index = order.indexOf(key);
  if (index < 0 || !Number.isInteger(target) || target < 0 || target >= order.length) return order;
  order.splice(index, 1); order.splice(target, 0, key); return order;
}
