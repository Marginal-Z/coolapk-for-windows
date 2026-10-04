export const PERSONAL_PRODUCT_TABS = Object.freeze([
  Object.freeze({ id: 'following', title: '关注', operation: 'personalProductFollowing', args: Object.freeze({}) }),
  Object.freeze({ id: 'owner', title: '机主', operation: 'catalogMyProducts', args: Object.freeze({ type: 'owner' }) }),
  Object.freeze({ id: 'wish', title: '想买', operation: 'catalogMyProducts', args: Object.freeze({ type: 'wish' }) }),
  Object.freeze({ id: 'buy', title: '买过', operation: 'catalogMyProducts', args: Object.freeze({ type: 'buy' }) }),
]);

export const PERSONAL_ENTRIES = Object.freeze([
  Object.freeze({ id: 'products', title: '我的数码', description: '关注的数码吧、机主、想买和买过', page: Object.freeze({ kind: 'personal', type: 'products', title: '我的数码' }) }),
  Object.freeze({ id: 'dyhs', title: '我的看看号', description: '我关注的和我管理的看看号', page: Object.freeze({ kind: 'personal', type: 'dyhs', title: '我的看看号' }) }),
  Object.freeze({ id: 'lists', title: '我的清单', description: '自己创建的产品清单', page: Object.freeze({ kind: 'personal', type: 'lists', title: '我的清单' }) }),
  Object.freeze({ id: 'backups', title: '备份列表', description: '云端手机应用备份单与应用记录', page: Object.freeze({ kind: 'personal', type: 'backups', title: '备份列表' }) }),
  Object.freeze({ id: 'blocks', title: '首页屏蔽管理', description: '在头条中屏蔽节点、用户和关键字', page: Object.freeze({ kind: 'personal', type: 'blocks', title: '首页屏蔽管理' }) }),
]);

export function personalEntryPage(value) {
  const entry = PERSONAL_ENTRIES.find(item => item.id === value);
  return entry ? { ...entry.page } : null;
}

// Server list rows can contain navigation cards. Only confirmed product IDs
// become product-detail links; arbitrary URLs are never request capabilities.
export function personalProductTarget(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const info = row.productInfo && typeof row.productInfo === 'object' && !Array.isArray(row.productInfo) ? row.productInfo : row;
  const id = String(info.id ?? info.productId ?? info.entityId ?? '');
  if (!/^[1-9]\d{0,19}$/.test(id)) return null;
  if (info.entityType && !['product', 'product_phone'].includes(info.entityType)) return null;
  return { ...info, id, entityType: 'product' };
}

const blockText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(`${label}无效`);
  return value;
};
export function homeBlockChange(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !['node', 'user', 'word'].includes(args.scope) || !['add', 'cancel'].includes(args.action) || Object.keys(args).some(key => !['scope', 'action', 'value', 'tid', 'name'].includes(key))) throw new TypeError('首页屏蔽操作无效');
  if (args.scope === 'word') {
    const value = blockText(args.value, args.action === 'add' ? 15 : 200, '屏蔽关键字');
    // Official AddBlockDialog uses String.length and rejects Unicode P/S.
    if (args.action === 'add' && (value.length < 2 || /[\p{P}\p{S}]/u.test(value))) throw new TypeError('关键字需为2-15字，且不能包含标点或符号');
    if (args.tid != null || args.name != null) throw new TypeError('关键字屏蔽字段无效');
    return { word: { [args.action]: value } };
  }
  if (args.scope === 'user') {
    const value = String(args.value ?? '');
    if (!/^[1-9]\d{0,19}$/.test(value) || args.tid != null || args.name != null) throw new TypeError('屏蔽酷友编号无效');
    return { user: { [args.action]: value } };
  }
  const tid = String(args.tid ?? '');
  if (!/^\d{1,40}$/.test(tid) || args.value != null) throw new TypeError('屏蔽节点编号无效');
  const name = blockText(args.name, 200, '屏蔽节点名称');
  return { node: { [args.action]: [{ tid, name }] } };
}

export function normalizeHomeBlocks(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.hasOwn(data, 'spam_word_config') && !Object.hasOwn(data, 'spam_word_config_max_count') || data.spam_word_config != null && typeof data.spam_word_config !== 'string') throw new TypeError('服务器未返回有效的首页屏蔽设置');
  let config;
  try { config = data.spam_word_config == null || data.spam_word_config === '' ? {} : JSON.parse(data.spam_word_config); } catch { throw new TypeError('首页屏蔽设置格式无效'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('首页屏蔽设置格式无效');
  const rules = [];
  for (const [key, scope] of [['custom', 'word'], ['node', 'node'], ['user', 'user']]) {
    if (config[key] == null) continue;
    if (!Array.isArray(config[key]) || config[key].length > 10000) throw new TypeError('首页屏蔽列表格式无效');
    for (const item of config[key]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('首页屏蔽项目格式无效');
      if (scope === 'word') {
        const value = blockText(item.title, 200, '云端屏蔽关键字');
        rules.push({ scope, value, title: value });
      } else if (scope === 'user') {
        const value = String(item.uid ?? '');
        if (!/^[1-9]\d{0,19}$/.test(value)) throw new TypeError('云端屏蔽酷友编号无效');
        rules.push({ scope, value, title: typeof item.name === 'string' ? item.name.slice(0, 200) : '酷友', logo: typeof item.logo === 'string' ? item.logo.slice(0, 2048) : '' });
      } else {
        const tid = String(item.targetFullId ?? '');
        if (!/^\d{1,40}$/.test(tid)) throw new TypeError('云端屏蔽节点编号无效');
        rules.push({ scope, tid, name: blockText(item.title, 200, '云端屏蔽节点名称'), title: item.title, logo: typeof item.logo === 'string' ? item.logo.slice(0, 2048) : '', nodeType: typeof item.type === 'string' ? item.type.slice(0, 80) : '' });
      }
    }
  }
  const value = data.spam_word_config_max_count;
  const maxCount = value == null ? null : Number(value);
  if (maxCount != null && (!Number.isSafeInteger(maxCount) || maxCount < 0 || maxCount > 100000)) throw new TypeError('首页屏蔽数量上限无效');
  return { rules, maxCount };
}

export function homeBlockIncludes(config, args) {
  return config.rules.some(rule => rule.scope === args.scope && (rule.scope === 'node' ? (rule.tid === String(args.tid) || String(args.tid) === '0' && rule.tid.startsWith('300')) && rule.name === args.name : rule.value === String(args.value)));
}

// BlockNodeListFragment applies a remainder plus a type-specific full ID.
// The picker accepts actual search entities, never user-entered numeric IDs.
export function homeNodeChoice(row, category) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const type = row.entityType;
  const title = typeof row.title === 'string' ? row.title : typeof row.tag === 'string' ? row.tag : '';
  if (!title.trim() || title.length > 200 || /[\x00-\x1f\x7f<>]/.test(title)) return null;
  let prefix, nodeType;
  if (category === 'topic' && ['topic', 'feedTopic'].includes(type)) { prefix = 3000000000; nodeType = '话题'; }
  else if (category === 'product' && ['product', 'product_phone'].includes(type)) { prefix = 7000000000; nodeType = '数码'; }
  else if (category === 'apk' && ['apk', 'game'].includes(type)) { prefix = 1000000000; nodeType = type === 'game' ? '游戏' : '应用'; }
  else return null;
  const id = String(category === 'apk' ? row.aid ?? row.id ?? '' : row.id ?? '');
  if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return null;
  const tid = String(Number(id) % 1000000000 + prefix);
  return { scope: 'node', tid, name: title, title, nodeType, logo: typeof row.logo === 'string' ? row.logo.slice(0, 2048) : '' };
}

function feedNodeChoice(target) {
  if (!target || typeof target !== 'object') return null;
  const url = typeof target.url === 'string' ? target.url : '';
  const id = String(target.id ?? ''), name = typeof target.title === 'string' ? target.title : '';
  if (!name || !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return null;
  if (url.startsWith('/product')) return { scope: 'node', tid: String(Number(id) + 7000000000), name };
  if (url.startsWith('/t')) return { scope: 'node', tid: '0', name };
  if (url.startsWith('/apk') || url.startsWith('/game')) return { scope: 'node', tid: String((Number(id) + 1000000000) | 0), name };
  return null;
}

// Java Pattern's UNICODE_CASE uses simple character case mappings, without
// expanding a single character into multiple letters (e.g. ß never becomes SS).
function simpleCaseFold(value) {
  return Array.from(value, character => {
    const upper = Array.from(character.toUpperCase());
    return Array.from((upper.length === 1 ? upper[0] : character).toLowerCase())[0];
  }).join('');
}

// EntityBlockSpamHelper checks these original Feed strings individually.
// The third argument is retained for compatibility; rendered text must not
// replace the official raw-message matching, including its HTML attributes.
export function personalHeadlineVisible(feed, config, _text) {
  if (!feed || typeof feed !== 'object' || !config || !Array.isArray(config.rules)) return true;
  if (feed.entityType && feed.entityType !== 'feed') return true;
  const target = feed.targetRow && typeof feed.targetRow === 'object' ? feed.targetRow : {};
  const searchable = [feed.messagesource, feed.message, feed.message_title, feed.comment_good, feed.comment_general, feed.comment_bad, target.title].filter(value => typeof value === 'string' && value.length > 0).map(simpleCaseFold);
  const uid = String(feed.uid ?? '');
  const tags = typeof feed.tags === 'string' ? feed.tags.replace(/#/g, '').split(',').filter(Boolean) : [];
  const primary = feedNodeChoice(target);
  return !config.rules.some(rule => rule.scope === 'word' ? searchable.some(value => value.includes(simpleCaseFold(String(rule.value)))) : rule.scope === 'user' ? uid === rule.value : rule.scope === 'node' ? primary && (primary.tid === rule.tid || primary.tid === '0' && primary.name === rule.name) || (rule.tid === '0' || rule.tid.startsWith('300')) && tags.includes(rule.name) : false);
}
