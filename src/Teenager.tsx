import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Clock3, KeyRound, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import type { TeenagerSnapshot } from '../core/teenager.mjs';
import { imageUrl, plain, unwrap } from './data';
import type { Entity, Reply } from './types';
import { LoadMore, Modal } from './components';
import './teenager.css';

type TeenagerContent = { data: Entity[]; page: number; hasMore: boolean };
type TeenagerOperation = 'info' | 'enable' | 'disable' | 'changePin' | 'content' | 'detail';
const teenagerCall = <T,>(operation: TeenagerOperation, args?: Entity) => unwrap<T>(window.coolapk?.teenager(operation, args) as Promise<Reply<T>> | undefined);
const pinValid = (pin: string) => /^\d{4}$/.test(pin);
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';
function PinInput({ label, value, onChange, disabled, autoFocus = false }: { label: string; value: string; onChange: (pin: string) => void; disabled: boolean; autoFocus?: boolean }) {
  return <label className="teenager-pin"><span>{label}</span><input type="password" aria-label={label} value={value} onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} minLength={4} required autoComplete="off" disabled={disabled} autoFocus={autoFocus} /></label>;
}
export function TeenagerSetup({ onEnabled, onCancel }: { onEnabled: (snapshot: TeenagerSnapshot) => void; onCancel?: () => void }) {
  const [stage, setStage] = useState<'intro' | 'pin'>('intro'), [pin, setPin] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(false), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function enable(event: FormEvent) {
    event.preventDefault(); if (pending.current || !pinValid(pin) || !pinValid(confirmation)) return;
    if (pin !== confirmation) { setError('两次输入的密码不一致。'); return; }
    pending.current = true; setBusy(true); setError('');
    try { const snapshot = await teenagerCall<TeenagerSnapshot>('enable', { pin, confirmation }); if (active.current) { setPin(''); setConfirmation(''); onEnabled(snapshot); } }
    catch (failure) { if (active.current) setError(messageOf(failure)); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  return <section className="teenager-setup" aria-label="开启青少年模式">
    <div className="teenager-emblem"><ShieldCheck size={30} aria-hidden="true" /></div><h3>青少年模式</h3>
    {stage === 'intro' ? <><p>开启后将退出当前账号，进入精选内容页面。</p><ul><li>无法登录、发布、回复和搜索。</li><li>每日使用时长不超过 40 分钟。</li><li>每天 22:00 至次日 06:00 无法浏览。</li><li>关闭模式和修改密码需要验证四位数字密码。</li></ul><p className="teenager-note">密码保存在当前 Windows 用户的本机设置中。请由监护人保管。</p><div className="teenager-actions">{onCancel && <button type="button" className="button secondary" onClick={onCancel}>取消</button>}<button type="button" className="button" onClick={() => setStage('pin')}>开启青少年模式</button></div></> : <form onSubmit={event => void enable(event)}><p>设置四位数字密码，用于关闭模式和修改密码。</p><PinInput label="设置四位密码" value={pin} onChange={setPin} disabled={busy} autoFocus /><PinInput label="再次输入密码" value={confirmation} onChange={setConfirmation} disabled={busy} />{error && <p className="teenager-error" role="alert">{error}</p>}<div className="teenager-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setPin(''); setConfirmation(''); setError(''); setStage('intro'); }}>返回</button><button type="submit" className="button" disabled={busy || !pinValid(pin) || !pinValid(confirmation)}>{busy ? '正在开启…' : '确认开启'}</button></div></form>}
  </section>;
}
function entityId(item: Entity) { const value = String(item.id ?? ''); return /^[1-9]\d{0,19}$/.test(value) ? value : ''; }
function feedItems(items: Entity[], depth = 0): Entity[] {
  if (depth > 8) return [];
  return items.slice(0, 1000).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    if (entityId(item) && item.entityType === 'feed') return [item];
    return Array.isArray(item.entities) ? feedItems(item.entities, depth + 1) : [];
  });
}
// Images remain confined to the image proxy's allowlisted Coolapk CDN hosts.
function pictures(item: Entity) {
  const candidates = Array.isArray(item.picArr) ? item.picArr.map((value: any) => typeof value === 'string' ? value : value?.url || value?.pic)
    : typeof item.pic === 'string' ? item.pic.split(',') : typeof item.message_cover === 'string' ? [item.message_cover] : [];
  return candidates.filter((value: unknown) => {
    try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && ['image.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com'].includes(url.hostname); } catch { return false; }
  }).map((value: string) => imageUrl(value));
}
function duration(time: number) { return `${Math.floor(time / 60_000)}:${String(Math.floor(time % 60_000 / 1000)).padStart(2, '0')}`; }
function ReadOnlyContent({ item, detail = false }: { item: Entity; detail?: boolean }) {
  const title = plain(item.title || item.message_title), text = plain(item.message || item.description || item.intro), images = pictures(item);
  return <>{title && <h3>{title}</h3>}<p className={`teenager-text ${detail ? 'full' : ''}`}>{text || '查看精选内容'}</p>{images.length > 0 && <div className={`teenager-pictures ${detail ? 'full' : ''}`}>{(detail ? images : images.slice(0, 3)).map((url: string, index: number) => <img key={url + index} src={url} alt={`精选图片 ${index + 1}`} loading="lazy" />)}</div>}{!detail && <span className="teenager-read-more">阅读内容</span>}</>;
}
export function TeenagerScreen({ snapshot, onSnapshot }: { snapshot: TeenagerSnapshot; onSnapshot: (snapshot: TeenagerSnapshot) => void }) {
  const [items, setItems] = useState<Entity[]>([]), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [failedPage, setFailedPage] = useState(1);
  const [detail, setDetail] = useState<Entity | null>(null), [detailBusy, setDetailBusy] = useState(false), [detailError, setDetailError] = useState('');
  const [passwordMode, setPasswordMode] = useState<'disable' | 'changePin' | null>(null), [pin, setPin] = useState(''), [newPin, setNewPin] = useState(''), [confirmation, setConfirmation] = useState(''), [pinBusy, setPinBusy] = useState(false), [pinError, setPinError] = useState('');
  const active = useRef(false), currentMode = useRef(snapshot), sequence = useRef(0), detailSequence = useRef(0), contentPending = useRef(false), detailPending = useRef(false), pinPending = useRef(false);
  currentMode.current = snapshot;
  const readable = snapshot.enabled && !snapshot.blocked;
  const current = (generation: number) => active.current && currentMode.current.enabled && !currentMode.current.blocked && sequence.current === generation;
  async function load(nextPage: number) {
    if (contentPending.current || !currentMode.current.enabled || currentMode.current.blocked) return;
    contentPending.current = true; const generation = sequence.current; setBusy(true); setError(''); setFailedPage(nextPage);
    try {
      const response = await teenagerCall<TeenagerContent>('content', { page: nextPage });
      if (!current(generation)) return;
      const incoming = feedItems(Array.isArray(response.data) ? response.data : []);
      setItems(previous => nextPage === 1 ? incoming : [...previous, ...incoming.filter(item => !previous.some(old => entityId(old) === entityId(item)))]);
      setPage(nextPage); setHasMore(response.hasMore === true);
    } catch (failure) { if (current(generation)) setError(messageOf(failure)); }
    finally { if (generation === sequence.current) { contentPending.current = false; if (active.current) setBusy(false); } }
  }
  useEffect(() => { active.current = true; return () => { active.current = false; sequence.current++; detailSequence.current++; }; }, []);
  useEffect(() => {
    sequence.current++; detailSequence.current++; contentPending.current = false; detailPending.current = false;
    setItems([]); setPage(0); setHasMore(true); setBusy(false); setError(''); setDetail(null); setDetailBusy(false); setDetailError('');
    if (readable) void load(1);
    return () => { sequence.current++; detailSequence.current++; };
  }, [readable, snapshot.day]);
  async function open(item: Entity) {
    if (detailPending.current || !currentMode.current.enabled || currentMode.current.blocked) return;
    const id = entityId(item); if (!id) return;
    detailPending.current = true; const generation = sequence.current, request = ++detailSequence.current;
    setDetail(item); setDetailBusy(true); setDetailError('');
    try { const response = await teenagerCall<{ data: Entity }>('detail', { id }); if (current(generation) && request === detailSequence.current) setDetail(response.data); }
    catch (failure) { if (current(generation) && request === detailSequence.current) setDetailError(messageOf(failure)); }
    finally { if (request === detailSequence.current) { detailPending.current = false; if (active.current) setDetailBusy(false); } }
  }
  const closeDetail = () => { detailSequence.current++; detailPending.current = false; setDetail(null); setDetailBusy(false); setDetailError(''); };
  const closePassword = () => { if (pinPending.current) return; setPasswordMode(null); setPin(''); setNewPin(''); setConfirmation(''); setPinError(''); };
  async function verify(event: FormEvent) {
    event.preventDefault(); if (pinPending.current || !pinValid(pin) || !passwordMode) return;
    if (passwordMode === 'changePin' && (!pinValid(newPin) || !pinValid(confirmation))) return;
    if (passwordMode === 'changePin' && newPin !== confirmation) { setPinError('两次输入的密码不一致。'); return; }
    pinPending.current = true; setPinBusy(true); setPinError('');
    try {
      const next = await teenagerCall<TeenagerSnapshot>(passwordMode, passwordMode === 'disable' ? { pin } : { oldPin: pin, newPin, confirmation });
      if (active.current) { setPasswordMode(null); setPin(''); setNewPin(''); setConfirmation(''); onSnapshot(next); }
    } catch (failure) { if (active.current) setPinError(messageOf(failure)); }
    finally { pinPending.current = false; if (active.current) setPinBusy(false); }
  }
  return <div className="teenager-shell">
    <header className="teenager-header"><div><ShieldCheck size={24} aria-hidden="true" /><span><strong>青少年模式</strong><small>精选内容</small></span></div><span className="teenager-remaining" aria-label="今日剩余时长"><Clock3 size={16} aria-hidden="true" />{duration(snapshot.remainingMilliseconds)}</span><button type="button" className="button secondary" disabled={snapshot.reason === 'state_error'} onClick={() => { setPasswordMode('disable'); setPinError(''); }}>关闭模式</button><button type="button" className="icon-button" aria-label="修改青少年密码" disabled={snapshot.reason === 'state_error'} onClick={() => { setPasswordMode('changePin'); setPinError(''); }}><KeyRound size={19} /></button></header>
    <main className="teenager-main" aria-label="青少年精选内容">
      {snapshot.blocked ? <section className="teenager-blocked" role="status"><LockKeyhole size={40} aria-hidden="true" /><h2>{snapshot.reason === 'night' ? '夜间休息时间' : snapshot.reason === 'daily_limit' ? '今日使用时间已结束' : '青少年模式记录无法读取'}</h2><p>{snapshot.reason === 'night' ? '每天 22:00 至次日 06:00 无法浏览，请明天再来。' : snapshot.reason === 'daily_limit' ? '每日使用时长不超过 40 分钟，请明天再来。' : '已限制访问，请检查本机存储后重新启动应用。'}</p>{snapshot.reason !== 'state_error' && <button type="button" className="button secondary" onClick={() => setPasswordMode('disable')}>验证密码并关闭模式</button>}</section> : <>
        <div className="teenager-list-heading"><h2>今日精选</h2><button type="button" className="icon-button" aria-label="刷新精选内容" disabled={busy} onClick={() => void load(1)}><RefreshCw size={18} /></button></div>
        {error && <div className="teenager-error" role="alert"><p>{error}</p><button type="button" className="button secondary" disabled={busy} onClick={() => void load(failedPage)}>重试</button></div>}
        {items.map(item => <article className="teenager-card" key={entityId(item)}><button type="button" onClick={() => void open(item)}><ReadOnlyContent item={item} /></button></article>)}
        {!busy && !error && !items.length && <p className="teenager-empty">暂时没有精选内容。</p>}{busy && <p className="teenager-empty" role="status">正在读取精选内容…</p>}
        {!!items.length && hasMore && !error && <LoadMore className="teenager-more" loading={busy} error={error} hasMore={hasMore} onClick={() => void load(page + 1)} />}
      </>}
    </main>
    {detail && readable && <Modal title="精选内容" onClose={closeDetail}><div className="teenager-detail"><button type="button" className="button secondary" onClick={closeDetail}><ArrowLeft size={16} />返回精选</button>{detailBusy && <p role="status">正在读取内容…</p>}{detailError && <p className="teenager-error" role="alert">{detailError}</p>}<ReadOnlyContent item={detail} detail /></div></Modal>}
    {passwordMode && <Modal title={passwordMode === 'disable' ? '关闭青少年模式' : '修改青少年密码'} onClose={closePassword}><form className="teenager-password" onSubmit={event => void verify(event)}><p>{passwordMode === 'disable' ? '请输入开启模式时设置的四位数字密码。' : '验证当前密码后，设置新的四位数字密码。'}</p><PinInput label="当前四位密码" value={pin} onChange={setPin} disabled={pinBusy} autoFocus />{passwordMode === 'changePin' && <><PinInput label="新的四位密码" value={newPin} onChange={setNewPin} disabled={pinBusy} /><PinInput label="确认新的密码" value={confirmation} onChange={setConfirmation} disabled={pinBusy} /></>}{pinError && <p className="teenager-error" role="alert">{pinError}</p>}<div className="teenager-actions"><button type="button" className="button secondary" disabled={pinBusy} onClick={closePassword}>取消</button><button type="submit" className="button" disabled={pinBusy || !pinValid(pin) || (passwordMode === 'changePin' && (!pinValid(newPin) || !pinValid(confirmation)))}>{pinBusy ? '正在验证…' : passwordMode === 'disable' ? '确认关闭' : '保存密码'}</button></div></form></Modal>}
  </div>;
}
