import { useEffect, useRef, useState } from 'react';
import type { Entity, Result, Reply } from './types';
import { deepLinkWebUrl } from '../core/navigation.mjs';
import { publicImageSource } from '../core/app-media.mjs';

export class ClientError extends Error { code: string; verificationId?: string; constructor(message: string, code = 'APP_ERROR', verificationId?: string) { super(message); this.code = code; this.verificationId = verificationId; } }
export async function unwrap<T>(promise: Promise<Reply<T>> | undefined): Promise<T> {
  if (!promise) throw new ClientError('请使用桌面应用打开此页面', 'NO_DESKTOP');
  const result = await promise; if (!result.ok) throw new ClientError(result.error.message, result.error.code, result.error.verificationId); return result.data;
}
export const call = (operation: string, args: Entity = {}) => unwrap(window.coolapk?.call(operation, args));
const cache = new Map<string, Result>();
export function clearCache() { cache.clear(); }
export function refreshResources() { window.dispatchEvent(new Event('coolapk:refresh-resources')); }

// Keep the last successful result visible on refresh failure. Sequence guards reject stale responses.
export function useResource(operation: string | null, args: Entity, namespace: string, revision = 0) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => { const refresh = () => setRefreshVersion(value => value + 1); window.addEventListener('coolapk:refresh-resources', refresh); return () => window.removeEventListener('coolapk:refresh-resources', refresh); }, []);
  const key = namespace + ':' + operation + ':' + JSON.stringify(args);
  const scope = JSON.stringify([key, revision, refreshVersion]);
  const [state, setState] = useState<{ key: string; data?: Result; loading: boolean; error?: ClientError; page: number; failedMore?: boolean }>({ key, data: cache.get(key), loading: !!operation, page: 1 });
  const sequence = useRef(0), active = useRef(false), inFlight = useRef(false), latestScope = useRef(scope), latestState = useRef(state);
  latestScope.current = scope; latestState.current = state;
  useEffect(() => {
    const current = ++sequence.current; active.current = !!operation; inFlight.current = !!operation;
    setState(previous => ({ key, data: cache.get(key) || (previous.key === key ? previous.data : undefined), loading: !!operation, page: 1 }));
    if (operation) call(operation, args).then(data => {
      if (!active.current || latestScope.current !== scope || current !== sequence.current) return;
      cache.set(key, data); if (cache.size > 80) cache.delete(cache.keys().next().value!);
      setState({ key, data, loading: false, page: 1 });
    }).catch(error => { if (active.current && latestScope.current === scope && current === sequence.current) setState(s => ({ ...s, loading: false, error })); }).finally(() => { if (current === sequence.current) inFlight.current = false; });
    return () => { sequence.current++; active.current = false; };
  }, [key, revision, refreshVersion]);
  const visible: typeof state = state.key === key ? state : { key, data: cache.get(key), loading: !!operation, page: 1 };
  // A saved callback belongs to this mounted request generation and state. A
  // late verification must not issue old arguments with the newly active account.
  const generation = sequence.current;
  const currentCapability = () => active.current && latestScope.current === scope && generation === sequence.current && latestState.current === state && state.key === key;
  const more = async () => {
    if (!operation || !currentCapability() || inFlight.current || state.loading || !state.data || state.data.hasMore === false) return;
    const current = sequence.current; inFlight.current = true;
    setState(s => ({ ...s, loading: true, error: undefined, failedMore: false }));
    try {
      const next = await call(operation, { ...args, page: state.page + 1, firstItem: state.data?.firstItem, lastItem: state.data?.lastItem });
      if (!active.current || latestScope.current !== scope || current !== sequence.current) return;
      const oldItems = Array.isArray(state.data?.data) ? state.data!.data : [];
      const nextItems = Array.isArray(next.data) ? next.data : [];
      const known = new Set(oldItems.map((x: Entity) => x.entityType + ':' + (x.id ?? x.entityId)));
      const added = nextItems.filter((x: Entity) => !known.has(x.entityType + ':' + (x.id ?? x.entityId)));
      if (!added.length && next.hasMore === true && JSON.stringify(next.lastItem) === JSON.stringify(state.data.lastItem)) throw new ClientError('列表暂未返回新的内容，请稍后重试', 'PAGINATION_STALLED');
      const data = { ...next, data: [...oldItems, ...added], firstItem: state.data?.firstItem || next.firstItem, hasMore: next.hasMore ?? nextItems.length > 0 };
      cache.set(key, data); setState({ key, data, loading: false, page: state.page + 1 });
    } catch (error) { if (active.current && latestScope.current === scope && current === sequence.current) setState(s => ({ ...s, loading: false, error: error as ClientError, failedMore: true })); }
    finally { if (current === sequence.current) inFlight.current = false; }
  };
  const retry = () => {
    if (!operation || !currentCapability() || inFlight.current || state.loading) return;
    if (state.failedMore) void more(); else { inFlight.current = true; setRefreshVersion(value => value + 1); }
  };
  useEffect(() => {
    // Parallel detail/comment reads may have been challenged before another
    // read was verified. Retry these reads once with the newly accepted proof;
    // mutations never participate, and a renewed server challenge stays visible.
    if (!operation || !['detail', 'replies', 'hotReplies', 'advancedReplies', 'subReplies', 'replyDetail'].includes(operation) || !state.error?.verificationId) return;
    const completed = (event: Event) => {
      const id = (event as CustomEvent).detail?.id;
      if (typeof id === 'string' && id !== state.error?.verificationId && currentCapability()) retry();
    };
    window.addEventListener('coolapk:verification-completed', completed);
    return () => window.removeEventListener('coolapk:verification-completed', completed);
  }, [scope, state]);
  return { ...visible, more, retry };
}

export function secureUrl(value: any): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (value.startsWith('coolmarket:')) return deepLinkWebUrl(value);
  try { const url = new URL(value, 'https://www.coolapk.com'); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''; if (url.protocol === 'http:' && (url.hostname === 'coolapk.com' || url.hostname.endsWith('.coolapk.com'))) url.protocol = 'https:'; return url.toString(); } catch { return ''; }
}
export function imageUrl(value: any): string {
  const url = secureUrl(value); if (!url) return '';
  const proxied = publicImageSource(url);
  if (proxied) return `coolapk-image://image/?url=${encodeURIComponent(proxied)}`;
  return url;
}
export function plain(value: any): string {
  const doc = new DOMParser().parseFromString(String(value ?? ''), 'text/html'); return doc.body.textContent || '';
}
export function count(value: any) { const n = Number(value) || 0; return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n); }
export function relativeTime(value: any) {
  const date = new Date(Number(value) * 1000); if (!Number.isFinite(date.getTime())) return '';
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds >= 0 && seconds < 60) return '刚刚';
  if (seconds >= 0 && seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds >= 0 && seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
export function photos(entity: Entity) {
  const values = Array.isArray(entity.picArr) && entity.picArr.length ? entity.picArr.map((p: any) => typeof p === 'string' ? p : p.url || p.pic) : entity.pic ? String(entity.pic).split(',') : entity.message_cover ? [entity.message_cover] : [];
  return values.map(secureUrl).filter(Boolean) as string[];
}
