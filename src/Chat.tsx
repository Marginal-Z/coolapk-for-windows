import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { Avatar, ErrorNotice, Modal, RichText } from './components';
import { call, ClientError } from './data';
import type { Entity, Result } from './types';
import './media-composers.css';

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
    <Attachments values={attachments} onChange={next => { setAttachments(next); setError(undefined); }} disabled={locked} limit={1} onError={text => setError(new ClientError(text, 'INPUT'))} />
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
