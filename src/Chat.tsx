import { useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { Avatar, Empty, ErrorNotice, LoadMore, Modal, RichText, Skeleton } from './components';
import { call, ClientError, useResource } from './data';
import { useInteraction } from './Community';
import type { Entity, Result } from './types';
import './media-composers.css';

export function ChatTools({ ukey, namespace, onDeleted, onLogin, onUser, uid, title = '酷友' }: { ukey: string; namespace: string; onDeleted: () => void; onLogin: () => void; onUser: (uid: string, name: string) => void; uid?: string; title?: string }) {
  const [confirm, setConfirm] = useState(false), [revision, setRevision] = useState(0);
  const read = useResource(ukey ? 'chatRead' : null, { ukey }, namespace, revision);
  const interaction = useInteraction(namespace + ':chat:' + ukey);
  if (!ukey) return null;
  return <section className="chat-tools"><div>{uid && <button className="text-button" onClick={() => onUser(uid, title)}>查看对方主页</button>}<button className="text-button" onClick={() => setRevision(value => value + 1)}>{read.loading ? '正在标记已读…' : '标记会话已读'}</button><button className="text-button" onClick={() => setConfirm(true)}><Trash2 size={14} />删除会话</button></div>{read.error && <ErrorNotice error={read.error} onRetry={() => setRevision(value => value + 1)} onLogin={onLogin} />}{confirm && <Modal title="删除私信会话" onClose={() => { if (!interaction.busy) setConfirm(false); }}><div className="community-form"><p>确认从酷安的私信列表删除与 {title} 的会话？操作会同步到当前账号。</p>{interaction.error && <ErrorNotice error={interaction.error} onRetry={interaction.retry} onLogin={onLogin} />}<footer><button className="button secondary" disabled={interaction.busy} onClick={() => setConfirm(false)}>取消</button><button className="button danger" disabled={interaction.locked} onClick={() => void interaction.run('chatDelete', { ukey }, () => { setConfirm(false); onDeleted(); })}>确认删除会话</button></footer></div></Modal>}</section>;
}

export function RecentContacts({ namespace, onUser, onLogin, onChat }: { namespace: string; onUser: (uid: string, name: string) => void; onLogin: () => void; onChat?: (uid: string, name: string) => void }) {
  const [revision, setRevision] = useState(0);
  const resource = useResource('chatRecent', {}, namespace, revision);
  const contacts: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  return <section className="recent-contacts"><h3>最近联系人</h3>{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}{resource.loading && !resource.data && <Skeleton />}{!resource.loading && !resource.error && !contacts.length && <Empty title="还没有最近联系人" />}{contacts.map((item, index) => { const uid = String(item.messageUid || item.uid || item.id || ''), name = item.messageUsername || item.username || item.userInfo?.username || '酷友'; return <button key={uid || index} className="recent-contact" onClick={() => (onChat || onUser)(uid, name)}><Avatar src={item.messageUserAvatar || item.userAvatar || item.userInfo?.userAvatar} name={name} size={34} /><span>{name}</span></button>; })}{contacts.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}</section>;
}

export function ChatComposer({ uid, namespace, loggedIn, onLogin, onSent }: { uid: string; namespace: string; loggedIn: boolean; onLogin: () => void; onSent: (result: Result) => void }) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<ClientError>();
  const generation = useRef(0);
  const latestAttachments = useRef(attachments);
  latestAttachments.current = attachments;
  useEffect(() => {
    generation.current++; clearAttachments(latestAttachments.current);
    setMessage(''); setAttachments([]); setBusy(false); setProgress(''); setError(undefined);
    return () => { generation.current++; };
  }, [uid, namespace]);
  const locked = busy || !!error?.verificationId;
  async function submit() {
    if (!loggedIn) return onLogin();
    if (busy || (!message.trim() && !attachments.length)) return;
    if (!/^\d+$/.test(uid)) { setError(new ClientError('未识别到对方的酷安账号，请重新打开会话', 'INPUT')); return; }
    const attempt = generation.current;
    const current = () => generation.current === attempt;
    setBusy(true); setProgress('发送私信…'); setError(undefined);
    try {
      const pic = await uploadAttachments(attachments, text => { if (current()) setProgress(text); }, { dir: 'message', toUid: uid, shouldContinue: current });
      if (!current()) return;
      const result = await call('action', { type: 'sendMessage', uid, message, ...(pic ? { pic } : {}) });
      if (!current()) return;
      const rows = Array.isArray(result.data) ? result.data : result.data && typeof result.data === 'object' ? [result.data] : [];
      const completeRows = rows.map((item: Entity) => item.id || item.entityId ? { ...item, fromuid: item.fromuid || namespace, uid: item.uid || uid, message: item.message ?? message, ...(pic && !item.message_pic ? { message_pic: pic } : {}) } : item);
      clearAttachments(attachments); setAttachments([]); setMessage(''); onSent({ ...result, data: Array.isArray(result.data) ? completeRows : completeRows[0] || result.data });
    } catch (e) { if (current()) setError(e instanceof ClientError ? e : new ClientError((e as Error).message)); }
    finally { if (current()) { setBusy(false); setProgress(''); } }
  }
  return <form className="chat-compose chat-compose-media" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="sr-only" htmlFor="chat-message">私信内容</label><textarea id="chat-message" rows={2} disabled={locked} maxLength={10000} value={message} onChange={event => { setMessage(event.target.value); setError(undefined); }} placeholder="写一条消息，也可以发送图片…" />
    <Attachments allowLive={false} values={attachments} onChange={next => { setAttachments(next); setError(undefined); }} disabled={locked} limit={1} onError={text => setError(new ClientError(text, 'INPUT'))} />
    {error && <ErrorNotice error={error} onRetry={() => void submit()} onLogin={onLogin} />}
    <div className="chat-compose-bottom"><span className="muted" role={busy ? 'status' : undefined}>{progress || '发送给当前会话的酷友'}</span><button className="button" type="submit" disabled={locked || (loggedIn && !message.trim() && !attachments.length)}><Send size={15} />{busy ? '发送中…' : loggedIn ? '发送' : '登录后发送'}</button></div>
  </form>;
}

export function ChatMessage({ item, accountUid, namespace, onLink, onLogin }: { item: Entity; accountUid?: string; namespace: string; onLink: (url: string) => void; onLogin: () => void }) {
  // Chat rows use fromuid for the sender and uid for the recipient.
  const sender = String(item.fromuid || item.userInfo?.uid || item.uid || '');
  const mine = !!accountUid && sender === accountUid;
  const hasPicture = !!(item.message_pic || item.messagePic);
  return <div className={`chat-message ${mine ? 'mine' : ''}`} data-message-id={item.id || item.entityId}><Avatar src={item.userAvatar || item.userInfo?.userAvatar} name={item.username || item.userInfo?.username} size={32} /><div><RichText text={item.message || item.text || item.content} onLink={onLink} />{hasPicture && <PrivateMessageImage id={String(item.id || item.entityId || '')} namespace={namespace} onLogin={onLogin} />}<small>{item.dateline ? new Date(Number(item.dateline) * 1000).toLocaleString('zh-CN') : ''}</small></div></div>;
}

function PrivateMessageImage({ id, namespace, onLogin }: { id: string; namespace: string; onLogin: () => void }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; image?: string; error?: ClientError }>({ key: '' });
  const [expanded, setExpanded] = useState(false);
  const key = namespace + ':' + id;
  useEffect(() => {
    let active = true;
    setState({ key }); setExpanded(false);
    if (!/^\d+$/.test(id)) { setState({ key, error: new ClientError('图片消息缺少服务端 ID，请刷新会话', 'INPUT') }); return; }
    call('messageImage', { id }).then(result => {
      const image = result.data;
      if (typeof image !== 'string' || !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(image)) throw new ClientError('酷安未返回有效的私信图片', 'API_ERROR');
      if (active) setState({ key, image });
    }).catch(e => { if (active) setState({ key, error: e instanceof ClientError ? e : new ClientError((e as Error).message) }); });
    return () => { active = false; };
  }, [key, revision]);
  const visible = state.key === key ? state : { key };
  return <div className="private-message-image">{visible.image ? <button type="button" className="private-picture-button" aria-label="查看私信图片" onClick={() => setExpanded(true)}><img src={visible.image} alt="私信图片" /></button> : visible.error ? <ErrorNotice error={visible.error} onRetry={() => setRevision(value => value + 1)} onLogin={onLogin} /> : <p className="muted" role="status">正在加载私信图片…</p>}{expanded && visible.image && <Modal title="私信图片" onClose={() => setExpanded(false)} wide><div className="lightbox"><img src={visible.image} alt="私信图片原图" /></div></Modal>}</div>;
}
