import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { ErrorNotice, Modal } from './components';
import { call, ClientError, plain } from './data';
import type { Entity } from './types';
export function homeChannels(configurations: Entity[]): Entity[] {
  const source = configurations.find(item => item.title === '首页')?.entities;
  const list = Array.isArray(source) ? source : [];
  const channels = [{ id: 'local-recommend', title: '推荐', url: '', operation: 'home', page_visibility: '1' }, ...list.filter(item => item && item.title && (item.url || item.page_name)).map(item => ({ ...item, id: String(item.id || item.page_name || item.url), url: item.url || item.page_name, title: plain(item.title), operation: /头条/.test(item.title) && !item.url ? 'homeHeadline' : undefined }))];
  if (!channels.some(item => item.title === '头条')) channels.push({ id: 'local-headline', title: '头条', url: '', operation: 'homeHeadline', page_visibility: '1' });
  if (!channels.some(item => item.title === '编辑精选')) channels.push({ id: 'local-editor', title: '编辑精选', url: '', operation: 'homeEditorChoice', page_visibility: '1' });
  if (!channels.some(item => item.title === '更新')) channels.push({ id: 'local-updates', title: '更新', url: '', operation: 'homeUpdates', page_visibility: '1' });
  if (!channels.some(item => item.title.includes('快讯') || String(item.url).includes('V11_HOME_TAB_NEWS'))) channels.push({ id: 'local-news', title: '快讯', url: '', operation: 'homeNews', page_visibility: '1' });
  if (!channels.some(item => item.title === '社区精选' || String(item.url).includes('/feed/digestList'))) channels.push({ id: 'local-digest', title: '社区精选', url: '', operation: 'homeDigest', page_visibility: '1' });
  const seen = new Set<string>(); return channels.filter(item => !seen.has(item.id) && !!seen.add(item.id));
}
export function savedHomeChannels(channels: Entity[], namespace: string): Entity[] {
  try {
    const value = JSON.parse(localStorage.getItem('coolapk-home-channels-' + namespace) || 'null');
    if (!Array.isArray(value) || value.length > 100) return channels;
    const byId = new Map(channels.map(item => [String(item.id), item])); const ordered: Entity[] = [];
    for (const item of value) { const original = byId.get(String(item?.id)); if (!original) continue; byId.delete(String(item.id)); ordered.push({ ...original, page_visibility: item.visible ? '1' : '0' }); }
    return [...ordered, ...byId.values()];
  } catch { return channels; }
}
export function ChannelManager({ channels, loggedIn, namespace, onSave, onClose, toast }: { channels: Entity[]; loggedIn: boolean; namespace: string; onSave: () => void; onClose: () => void; toast: (text: string) => void }) {
  const [rows, setRows] = useState(channels), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const attempt = useRef<Entity[] | undefined>(undefined), mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const visible = (item: Entity) => ![false, 0, '0'].includes(item.page_visibility ?? 1);
  function move(index: number, delta: number) { const next = [...rows]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setRows(next); }
  function persist() { localStorage.setItem('coolapk-home-channels-' + namespace, JSON.stringify(rows.map(item => ({ id: item.id, visible: visible(item) })))); onSave(); onClose(); }
  async function sync() {
    if (busy) return; const config = attempt.current || rows.filter(item => /^\d{1,20}$/.test(String(item.id))).map(item => ({ id: item.id, title: item.title, page_visibility: visible(item) ? '1' : '0' }));
    if (!config.length) { setError(new ClientError('酷安未返回可同步的官方栏目编号')); return; }
    attempt.current = config; setBusy(true); setError(undefined);
    try { await call('homeTabConfig', { tabs: config }); if (mounted.current) { persist(); toast('首页栏目已保存并提交账号同步'); } }
    catch (e) { if (mounted.current) setError(e as ClientError); }
    finally { if (mounted.current) setBusy(false); }
  }
  const locked = busy || !!error?.verificationId;
  return <Modal title="管理首页栏目" onClose={onClose}><div className="home-channel-manager"><p className="muted">调整本机顺序与显示状态。账号同步只包含酷安返回了编号的官方栏目。</p>{rows.map((item, index) => <div className="home-channel-row" key={item.id}><label><input type="checkbox" disabled={locked} checked={visible(item)} onChange={event => { setRows(old => old.map(row => row.id === item.id ? { ...row, page_visibility: event.target.checked ? '1' : '0' } : row)); attempt.current = undefined; }} />{item.title}</label><button className="icon-button" disabled={locked || !index} aria-label={'上移' + item.title} onClick={() => { move(index, -1); attempt.current = undefined; }}><ArrowUp size={16} /></button><button className="icon-button" disabled={locked || index === rows.length - 1} aria-label={'下移' + item.title} onClick={() => { move(index, 1); attempt.current = undefined; }}><ArrowDown size={16} /></button></div>)}{error && <ErrorNotice error={error} onRetry={() => void sync()} />}<div className="home-channel-footer"><button className="button secondary" disabled={locked || !rows.some(visible)} onClick={persist}>保存到本机</button>{loggedIn && <button className="button" disabled={locked || !rows.some(visible)} onClick={() => void sync()}>{busy ? '同步中…' : '保存并同步账号'}</button>}</div></div></Modal>;
}
