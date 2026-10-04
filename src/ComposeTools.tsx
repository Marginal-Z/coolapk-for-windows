import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { composeTopics, composeUsers } from '../core/compose-text.mjs';
import { Avatar, ErrorNotice, LoadMore } from './components';
import { call, ClientError } from './data';
import type { Entity, Result } from './types';
import './compose-tools.css';

export type ComposeTool = 'mention' | 'topic';
type Request = { operation: string; args: Entity; scope: string };
type List = { scope: string; items: Entity[]; loading: boolean; page: number; hasMore: boolean; firstItem?: string; lastItem?: string; error?: ClientError; failed?: Request };
const recentUsersKey = (namespace: string) => `coolapk:publish-mentions:${namespace}`;
const recentTopicsKey = (namespace: string) => `coolapk:publish-topics:${namespace}`;
function recentUsers(namespace: string) { try { return composeUsers(JSON.parse(localStorage.getItem(recentUsersKey(namespace)) || '[]')).slice(0, 50); } catch { return []; } }
function recentTopics(namespace: string): string[] { try { const ids = JSON.parse(localStorage.getItem(recentTopicsKey(namespace)) || '[]'); return Array.isArray(ids) ? [...new Set(ids.filter(value => typeof value === 'string' && /^\d{1,20}$/.test(value)))].slice(0, 20) : []; } catch { return []; } }

export default function ComposeTools(props: { kind: ComposeTool; namespace: string; disabled: boolean; onInsert: (kind: ComposeTool, values: Entity[]) => boolean; onClose: () => void }) {
  // Own the account boundary even when a caller keeps this component mounted.
  return <Picker key={props.namespace + ':' + props.kind} {...props} />;
}
function Picker({ kind, namespace, disabled, onInsert, onClose }: { kind: ComposeTool; namespace: string; disabled: boolean; onInsert: (kind: ComposeTool, values: Entity[]) => boolean; onClose: () => void }) {
  const [input, setInput] = useState(''), [query, setQuery] = useState(''), [source, setSource] = useState('recent'), [selected, setSelected] = useState<Entity[]>([]), [localRevision, setLocalRevision] = useState(0);
  const scope = JSON.stringify([namespace, kind, source, query, localRevision]);
  const [list, setList] = useState<List>({ scope, items: [], loading: true, page: 0, hasMore: false });
  const generation = useRef(0), active = useRef(false), liveScope = useRef(scope), inFlight = useRef(false), searchInput = useRef<HTMLInputElement>(null), topicRecentIds = useRef(recentTopics(namespace).join(','));
  liveScope.current = scope;
  const visible = list.scope === scope ? list : { scope, items: [], loading: true, page: 0, hasMore: false };
  const normalize = (items: unknown): Entity[] => kind === 'mention' ? composeUsers(items) : composeTopics(items);
  async function load(request: Request, attempt: number) {
    const current = () => active.current && generation.current === attempt && liveScope.current === request.scope;
    if (!current() || inFlight.current) return;
    inFlight.current = true; setList(previous => ({ ...previous, scope: request.scope, loading: true, error: undefined, failed: undefined }));
    try {
      const result: Result = await call(request.operation, request.args);
      if (!current()) return;
      if (!Array.isArray(result.data)) throw new ClientError('酷安未返回有效列表，请重试', 'API_ERROR');
      const items = normalize(result.data), page = Number(request.args.page);
      setList(previous => {
        const old = page > 1 && previous.scope === request.scope ? previous.items : [];
        const merged = [...new Map([...old, ...items].map(item => [String(kind === 'mention' ? item.uid : item.id), item])).values()];
        return { scope: request.scope, items: merged, loading: false, page, firstItem: page > 1 ? previous.firstItem || result.firstItem : result.firstItem, lastItem: result.lastItem, hasMore: result.hasMore !== false && items.length > 0 && (page === 1 || merged.length > old.length) };
      });
    } catch (error) {
      if (current()) setList(previous => ({ ...previous, loading: false, error: error instanceof ClientError ? error : new ClientError((error as Error).message), failed: request }));
    } finally { if (current()) inFlight.current = false; }
  }
  function request(page: number): Request {
    if (kind === 'topic') return { operation: 'searchPublishTopics', args: { query, page, recentIds: topicRecentIds.current }, scope };
    return query ? { operation: 'search', args: { type: 'user', query, page }, scope } : { operation: 'accountUsers', args: { type: source, page }, scope };
  }
  useEffect(() => {
    const attempt = ++generation.current; active.current = true; inFlight.current = false; topicRecentIds.current = recentTopics(namespace).join(',');
    setList({ scope, items: [], loading: false, page: 0, hasMore: false });
    if (kind === 'mention' && !query && source === 'recent') setList({ scope, items: recentUsers(namespace), loading: false, page: 1, hasMore: false });
    else void load(request(1), attempt);
    return () => { active.current = false; generation.current++; };
  }, [scope]);
  useEffect(() => { searchInput.current?.focus(); }, []);
  function retry() { if (visible.failed && visible.scope === liveScope.current && !disabled) void load(visible.failed, generation.current); }
  function more() {
    if (!visible.hasMore || visible.loading || visible.error || visible.scope !== liveScope.current || disabled) return;
    const next = request(visible.page + 1);
    if (kind === 'mention') { if (visible.firstItem) next.args.firstItem = visible.firstItem; if (visible.lastItem) next.args.lastItem = visible.lastItem; }
    void load(next, generation.current);
  }
  function insert(values: Entity[]) {
    if (disabled || !onInsert(kind, values)) return;
    try {
      if (kind === 'mention') localStorage.setItem(recentUsersKey(namespace), JSON.stringify(composeUsers([...values, ...recentUsers(namespace)]).slice(0, 50)));
      else localStorage.setItem(recentTopicsKey(namespace), JSON.stringify([String(values[0].id), ...recentTopics(namespace).filter(id => id !== String(values[0].id))].slice(0, 20)));
    } catch { /* Insertion works when local storage is unavailable. */ }
    onClose();
  }
  function toggle(user: Entity) { setSelected(previous => previous.some(item => item.uid === user.uid) ? previous.filter(item => item.uid !== user.uid) : [...previous, user]); }
  const title = kind === 'mention' ? '@用户' : '添加话题';
  return <section className="compose-tools" aria-label={title} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><strong>{title}</strong><button type="button" className="icon-button" aria-label="关闭正文工具" onClick={onClose}><X size={17} /></button></header>
    <div className="compose-tools-search"><label><span>{kind === 'mention' ? '搜索酷友昵称' : '搜索正文话题'}</span><input ref={searchInput} value={input} maxLength={200} disabled={disabled} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setQuery(input.trim()); } }} placeholder={kind === 'mention' ? '搜索用户' : '搜索话题'} /></label><button type="button" className="button secondary" disabled={disabled} onClick={() => setQuery(input.trim())}><Search size={16} />搜索</button>{query && <button type="button" className="text-button" disabled={disabled} onClick={() => { setInput(''); setQuery(''); }}>清除搜索</button>}</div>
    {kind === 'mention' && !query && <div className="compose-tool-tabs" role="tablist" aria-label="酷友来源">{[['recent', '最近提醒'], ['follow', '关注'], ['fans', '粉丝']].map(([value, label]) => <button type="button" role="tab" aria-selected={source === value} disabled={disabled} key={value} onClick={() => setSource(value)}>{label}</button>)}</div>}
    {kind === 'topic' && !query && <p className="compose-tool-heading">热门话题</p>}
    {kind === 'mention' && !query && source === 'recent' && visible.items.length > 0 && <button type="button" className="text-button compose-clear-recent" disabled={disabled} onClick={() => { try { localStorage.removeItem(recentUsersKey(namespace)); setLocalRevision(value => value + 1); } catch { /* Storage failure retains recent items. */ } }}>清空最近提醒</button>}
    {visible.error && <ErrorNotice error={visible.error} onRetry={retry} />}
    <div className="compose-tool-results" aria-busy={visible.loading}>{visible.items.map(item => kind === 'mention' ? <label key={item.uid} className="compose-tool-user"><Avatar src={item.userAvatar} name={item.username} size={32} /><span>{item.username}</span><input type="checkbox" checked={selected.some(user => user.uid === item.uid)} disabled={disabled} onChange={() => toggle(item)} aria-label={`选择酷友 ${item.username}`} /></label> : <button type="button" className="compose-tool-topic" key={item.id} disabled={disabled} onClick={() => insert([item])}><span aria-hidden="true">#</span><strong>{item.title}</strong></button>)}</div>
    {visible.loading && <p role="status" className="compose-tool-state">正在获取{kind === 'mention' ? '酷友' : '话题'}…</p>}
    {!visible.loading && !visible.error && !visible.items.length && <p className="compose-tool-state">{kind === 'mention' && !query && source === 'recent' ? '暂无最近提醒，可搜索或从关注、粉丝中选择。' : `暂无${kind === 'mention' ? '酷友' : '话题'}。`}</p>}
    {visible.hasMore && !visible.error && <LoadMore loading={disabled || visible.loading} error={visible.error} hasMore={visible.hasMore} onClick={more} label={kind === 'mention' ? '加载更多酷友' : '加载更多话题'} />}
    {kind === 'mention' && <footer><div className="compose-tool-selection">{selected.map(user => <button type="button" key={user.uid} disabled={disabled} aria-label={`移除提醒 ${user.username}`} onClick={() => toggle(user)}>@{user.username}<X size={13} /></button>)}</div><button type="button" className="button" disabled={disabled || !selected.length} onClick={() => insert(selected)}>插入提醒{selected.length ? `（${selected.length}）` : ''}</button></footer>}
  </section>;
}
