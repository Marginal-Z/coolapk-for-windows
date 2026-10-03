import type { Entity } from './types';
export type SearchSuggestionSelection = { kind: 'search'; query: string; type: string } | { kind: 'entity'; entity: Entity } | { kind: 'link'; url: string };
const types = new Set(['all', 'feed', 'user', 'apk', 'game', 'product', 'ershou', 'album', 'ask', 'goods', 'goods_list', 'question', 'answer']);
const typeAliases: Record<string, string> = { app: 'apk', topic: 'feedTopic', feedtopic: 'feedTopic', dyh: 'dyhMix', dyhmix: 'dyhMix' };
export function suggestionSelection(row: Entity): SearchSuggestionSelection {
  const source = String(row.url || row.actionUrl || row.link || '');
  try {
    const url = new URL(source);
    if (url.protocol.toLowerCase() === 'searchtab:') {
      const query = (url.searchParams.get('keyword') || '').trim(), host = url.hostname.toLowerCase(), type = typeAliases[host] || host;
      if (query && query.length <= 200 && !/[\x00-\x1f\x7f]/.test(query) && (types.has(type) || Object.values(typeAliases).includes(type))) return { kind: 'search', query, type };
    }
  } catch {}
  if (['apk', 'user', 'topic', 'product', 'dyh', 'album', 'event', 'live', 'collection', 'feed', 'question', 'answer'].includes(String(row.entityType))) return { kind: 'entity', entity: row };
  try { const url = new URL(source, 'https://www.coolapk.com'); if (source && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return { kind: 'link', url: url.href }; } catch {}
  return { kind: 'search', query: String(row.searchValue || row.title || row.name || row.username || row.entityTitle || '').trim().slice(0, 200), type: 'all' };
}
