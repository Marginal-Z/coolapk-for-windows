import { coolapkRoute } from './navigation.mjs';

// These are already consumed by the desktop user/space header. Missing values
// stay missing; a returned zero is a real statistic, not a loading placeholder.
export function accountStatistic(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
export function accountOverviewSummary(data, uid) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.uid != null && String(data.uid) !== String(uid)) return {};
  return { ...Object.fromEntries(['feed', 'follow', 'fans', 'level'].map(key => [key, accountStatistic(data[key])])) };
}

const listPaths = Object.freeze({ '/member/recentHistoryList': 'recent', '/member/hitHistoryList': 'history', '/topic/myFollowTopicList': 'topics', '/collection/myCollectionList': 'collections', '/feed/myQaFeedList': 'qa' });
const templates = new Set(['iconScrollCard', 'textLinkListCard']);
export function accountCardTarget(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (typeof row.url === 'string' && row.url.length <= 4096) {
    try {
      const url = new URL(row.url.startsWith('#/') ? row.url.slice(1) : row.url, 'https://www.coolapk.com');
      if (!url.username && !url.password && !url.port && ['https:', 'http:'].includes(url.protocol) && ['coolapk.com', 'www.coolapk.com', 'm.coolapk.com'].includes(url.hostname) && !url.search && !url.hash && Object.hasOwn(listPaths, url.pathname)) return { kind: listPaths[url.pathname] };
    } catch { /* An unknown route remains a read-only card. */ }
    const route = coolapkRoute(row.url);
    if (route && ['feed', 'user', 'topic', 'app', 'collection', 'product', 'live', 'catalog'].includes(route.kind)) return { kind: 'link', url: row.url };
  }
  const positiveId = value => /^[1-9]\d{0,19}$/.test(String(value ?? ''));
  const type = row.entityType;
  if (type === 'topic' && typeof row.tag === 'string' && row.tag.trim() && row.tag.length <= 200) return { kind: 'entity', entity: row };
  if (type === 'user' && positiveId(row.uid)) return { kind: 'entity', entity: row };
  if (['feed', 'collection', 'product', 'album', 'dyh', 'live'].includes(type) && positiveId(row.id)) return { kind: 'entity', entity: row };
  if (type === 'apk' && (positiveId(row.id) || /^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(row.packageName || row.package || ''))) return { kind: 'entity', entity: row };
  return null;
}
export function accountOverviewCards(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return { cards: [], invalid: true }; } }
  if (!Array.isArray(value)) return { cards: [], invalid: true };
  const cards = value.filter(row => row && typeof row === 'object' && !Array.isArray(row) && Number(row.page_visibility ?? 1) !== 0).map(row => {
    const supported = row.entityType === 'card' && (!row.entityTemplate || templates.has(row.entityTemplate));
    return { ...row, supported, target: supported ? accountCardTarget(row) : null, items: Array.isArray(row.entities) ? row.entities.map(item => ({ ...item, target: supported ? accountCardTarget(item) : null })) : [] };
  });
  return { cards, invalid: false };
}
