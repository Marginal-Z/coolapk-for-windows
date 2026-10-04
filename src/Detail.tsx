import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Heart, MessageCircle, Send, X } from 'lucide-react';
import { Avatar, Empty, ErrorNotice, FeedCard, Lightbox, LoadMore, Modal, Picture, RichText, Skeleton } from './components';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { call, ClientError, count, plain, relativeTime, useResource } from './data';
import type { Entity } from './types';
import { FeedAuxiliary, isQuestion, QuestionPane } from './Community';
import './media-composers.css';
import { photoItems } from './photo-items';
import { SecondhandCloseButton } from './SecondhandEditor';

export default function Detail({ feed, namespace, feedProps, onClose }: { feed: Entity; namespace: string; feedProps: any; onClose: () => void }) {
  const [revision, setRevision] = useState(0);
  const [sort, setSort] = useState('lastupdate_desc');
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<Entity | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<ClientError>();
  const [unconfirmedSent, setUnconfirmedSent] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const generation = useRef(0);
  const inFlight = useRef(false), unconfirmed = useRef(false);
  const pending = useRef<{ generation: number; message: string; targetId?: string; attachments: Attachment[]; args?: Entity } | undefined>(undefined);
  const latestAttachments = useRef(attachments);
  latestAttachments.current = attachments;
  const detail = useResource('detail', { id: String(feed.id) }, namespace, revision);
  const focusedReply = useResource(feed.__replyId ? 'replyDetail' : null, { id: String(feed.__replyId || '') }, namespace, revision);
  const focused = focusedReply.data?.data;
  const focusedValid = focused && String(focused.id) === String(feed.__replyId) && (!focused.feedid || String(focused.feedid) === String(feed.id));
  const advanced = filter !== 'all' || sort === 'dateline_desc';
  const replies = useResource(sort === 'discussion' && filter === 'all' ? 'hotReplies' : advanced ? 'advancedReplies' : 'replies', { id: String(feed.id), sort, ...(advanced ? { authorOnly: filter === 'author', hidden: filter === 'hidden' } : {}) }, namespace, revision);
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const value = detail.data?.data || (feed.message ? feed : null);
  const ownedSecondhand = value && (value.feedType === 'ershou' || value.type === 'ershou' || value.ershou_info) && feedProps.accountUid && String(value.uid || value.userInfo?.uid) === feedProps.accountUid;
  const comments: Entity[] = Array.isArray(replies.data?.data) ? replies.data!.data.filter((item: Entity) => !deletedIds.has(String(item.id))) : [];
  useLayoutEffect(() => {
    generation.current++;
    inFlight.current = false; unconfirmed.current = false; pending.current = undefined; setUnconfirmedSent(false);
    clearAttachments(latestAttachments.current);
    setAttachments([]); setMessage(''); setTarget(null); setError(undefined); setBusy(false); setProgress(''); setDeletedIds(new Set());
    panel.current?.scrollTo(0, 0);
    return () => { generation.current++; };
  }, [feed.id, feed.__replyId, namespace]);
  useEffect(() => { const prev = document.activeElement as HTMLElement; dialog.current?.querySelector<HTMLElement>('button')?.focus(); const key = (e: KeyboardEvent) => { if (document.querySelector('.modal-backdrop')) return; if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select,a[href]') || []).filter(node => node.getClientRects().length); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); prev?.focus(); }; }, [onClose]);
  async function submit(retry = false) {
    if (!feedProps.loggedIn) { feedProps.onLogin(); return; }
    if (inFlight.current || unconfirmed.current || !retry && !!error?.verificationId) return;
    const draft: typeof pending.current = retry ? pending.current : { generation: generation.current, message, targetId: target ? String(target.id) : undefined, attachments: [...attachments] };
    if (!draft || draft.generation !== generation.current || (!draft.message.trim() && !draft.attachments.length)) return;
    pending.current = draft; inFlight.current = true;
    const attempt = generation.current;
    const current = () => generation.current === attempt;
    let sending = false;
    setBusy(true); setError(undefined); setProgress('提交评论…');
    try {
      if (!draft.args) { const pic = await uploadAttachments(draft.attachments, text => { if (current()) setProgress(text); }, { shouldContinue: current }); draft.args = { type: 'reply', id: String(feed.id), ...(draft.targetId ? { rid: draft.targetId } : {}), message: draft.message, ...(pic ? { pic } : {}) }; }
      if (!current()) return;
      sending = true; await call('action', draft.args);
      if (!current()) return;
      clearAttachments(draft.attachments); pending.current = undefined; setAttachments([]); setMessage(''); setTarget(null); setRevision(r => r + 1); feedProps.toast('评论已发布');
    } catch (e) { if (current()) { const failure = e instanceof ClientError ? e : new ClientError((e as Error).message); if (sending && ['WRITE_UNCONFIRMED', 'NETWORK', 'HTTP'].includes(failure.code)) { unconfirmed.current = true; setUnconfirmedSent(true); } setError(failure); } }
    finally { if (current()) { inFlight.current = false; setBusy(false); setProgress(''); } }
  }
  const locked = busy || unconfirmedSent || !!error?.verificationId;
  const replyTo = (item: Entity) => { if (locked || inFlight.current || unconfirmed.current) return; pending.current = undefined; setTarget(item); input.current?.focus(); };
  const commentDeleted = (id: string) => {
    setDeletedIds(old => new Set([...old, id]));
    setTarget(old => old && String(old.id) === id ? null : old);
    setRevision(value => value + 1); feedProps.toast('评论已删除');
  };
  return <div className="detail-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} className="detail-panel" role="dialog" aria-modal="true" aria-label="动态详情"><header className="detail-header"><div><MessageCircle size={20} /><strong>动态详情</strong></div><button className="icon-button" onClick={onClose} aria-label="关闭动态详情"><X size={21} /></button></header><div className="detail-scroll" ref={panel}>
    {detail.error && <ErrorNotice error={detail.error} onRetry={detail.retry} onLogin={feedProps.onLogin} />}
    {detail.loading && !value && <Skeleton />}
    {value && <FeedCard key={'feed:' + feed.id + ':' + namespace} feed={value} {...feedProps} detailed onOpen={() => dialog.current?.querySelector('.comments-heading')?.scrollIntoView({ behavior: 'smooth' })} />}
    {ownedSecondhand && <div className="secondhand-toolbar"><button className="button secondary" disabled={feedProps.publicationRestricted} onClick={() => feedProps.onSecondhandEdit?.(String(feed.id))}>编辑闲置</button><SecondhandCloseButton id={String(feed.id)} namespace={namespace} loggedIn={feedProps.loggedIn} onLogin={feedProps.onLogin} onClosed={() => { setRevision(value => value + 1); feedProps.onChanged?.(); }} toast={feedProps.toast} /></div>}
    <FeedAuxiliary id={String(feed.id)} namespace={namespace} feedProps={feedProps} />
    {value && isQuestion(value) && <QuestionPane key={'question:' + feed.id + ':' + namespace} feed={value} namespace={namespace} feedProps={feedProps} onChanged={() => setRevision(value => value + 1)} />}
    {feed.__replyId && <section className="reply-focus" aria-label="定位评论"><h3>定位评论</h3>{focusedReply.loading && !focused && <Skeleton />}{focusedReply.error && <ErrorNotice error={focusedReply.error} onRetry={() => setRevision(r => r + 1)} onLogin={feedProps.onLogin} />}{focused && !focusedValid && <p role="alert">酷安返回的评论与当前动态不匹配。</p>}{focusedValid && !deletedIds.has(String(focused.id)) && <Comment key={focused.id + ':' + namespace} item={focused} feedId={String(feed.id)} namespace={namespace} onReply={replyTo} onDeleted={commentDeleted} deletedIds={deletedIds} feedProps={feedProps} />}</section>}
    <div className="comments-heading"><h3>评论 <span>{count(value?.replynum)}</span></h3><label className="comment-filter">范围<select value={filter} onChange={e => { setFilter(e.target.value); if (sort === 'discussion' && e.target.value !== 'all') setSort('lastupdate_desc'); }} aria-label="评论范围"><option value="all">全部评论</option><option value="author">只看楼主</option>{feedProps.loggedIn && <option value="hidden">折叠与隐藏</option>}</select></label><select value={sort} onChange={e => setSort(e.target.value)} aria-label="评论排序"><option value="lastupdate_desc">最新回复</option><option value="dateline_desc">最新发布</option><option value="popular">热门评论</option><option value="discussion" disabled={filter !== 'all'}>热门讨论</option></select></div>
    {replies.error && <><ErrorNotice error={replies.error} onRetry={replies.retry} onLogin={feedProps.onLogin} />{!feedProps.loggedIn && replies.error.code === 'VERIFY_REQUIRED' && <p className="muted" role="status">浏览评论无需先登录；酷安要求本次访问完成安全验证，请亲自验证后继续读取。</p>}<button type="button" className="text-button" disabled={replies.loading} onClick={replies.retry}>重新读取评论</button></>}
    {replies.loading && !replies.data && <Skeleton />}
    {!replies.loading && !replies.error && !comments.length && <Empty title="还没有评论" message="留下你的想法，成为第一个参与讨论的酷友。" />}
    {comments.map((item, i) => <Comment key={(item.id || i) + ':' + namespace} item={item} feedId={String(feed.id)} namespace={namespace} onReply={replyTo} onDeleted={commentDeleted} deletedIds={deletedIds} feedProps={feedProps} />)}
    {comments.length > 0 && <LoadMore loading={replies.loading} hasMore={replies.data?.hasMore} onClick={replies.more} />}
  </div><form className="reply-composer" onSubmit={e => { e.preventDefault(); void submit(); }}>{target && <div className="reply-target">回复 @{target.username || '酷友'}<button className="icon-button" disabled={locked} type="button" onClick={() => setTarget(null)} aria-label="取消回复对象"><X size={14} /></button></div>}<label htmlFor="reply-input" className="sr-only">评论内容</label><textarea ref={input} id="reply-input" disabled={locked} value={message} onChange={e => { if (locked || unconfirmed.current || inFlight.current) return; pending.current = undefined; setMessage(e.target.value); setError(undefined); }} rows={2} maxLength={10000} placeholder={feedProps.loggedIn ? '友善讨论，分享你的想法…' : '登录后，和酷友聊聊你的想法…'} /><Attachments values={attachments} onChange={next => { if (locked || unconfirmed.current || inFlight.current) return; pending.current = undefined; setAttachments(next); setError(undefined); }} disabled={locked} onError={text => { if (!unconfirmed.current) setError(new ClientError(text, 'INPUT')); }} />{error && <ErrorNotice error={error} onRetry={unconfirmedSent ? undefined : () => void submit(true)} onLogin={feedProps.onLogin} />}{unconfirmedSent && <div role="status"><p>评论发送结果尚未确认，内容、图片和回复对象已保留。请刷新核对评论，避免重复发送；可关闭当前详情。</p><button type="button" className="button secondary" onClick={() => setRevision(value => value + 1)}>刷新核对评论</button></div>}<div className="reply-bottom"><span role={busy ? 'status' : undefined}>{progress || '理性表达，友善交流'}</span><button className="button" disabled={locked || (feedProps.loggedIn && !message.trim() && !attachments.length)} type="submit"><Send size={15} />{busy ? '提交中…' : feedProps.loggedIn ? '发送' : '登录后评论'}</button></div></form></section></div>;
}

function Comment({ item, feedId, namespace, onReply, onDeleted, deletedIds, feedProps, nested = false }: { item: Entity; feedId: string; namespace: string; onReply: (item: Entity) => void; onDeleted: (id: string) => void; deletedIds: Set<string>; feedProps: any; nested?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [liked, setLiked] = useState(!!item.userAction?.like);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ClientError>();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<ClientError>();
  const deleteAttempt = useRef<Entity | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const own = !!feedProps.loggedIn && !!feedProps.accountUid && String(item.uid ?? item.userInfo?.uid ?? '') === feedProps.accountUid && /^[1-9]\d*$/.test(String(item.id));
  const imageItems = photoItems(item), images = imageItems.map(image => image.source);
  const sub = useResource(expanded ? 'subReplies' : null, { id: feedId, rid: String(item.id) }, namespace, revision);
  const preview: Entity[] = Array.isArray(item.replyRows) ? item.replyRows : [];
  const children: Entity[] = (expanded && Array.isArray(sub.data?.data) ? sub.data!.data : preview).filter((child: Entity) => !deletedIds.has(String(child.id)));
  useEffect(() => { setLiked(!!item.userAction?.like); setError(undefined); }, [item.id, item.userAction?.like, namespace]);
  async function like() { if (!feedProps.loggedIn) return feedProps.onLogin(); if (busy) return; setBusy(true); setError(undefined); try { await call('action', { type: liked ? 'unLikeReply' : 'likeReply', id: String(item.id) }); setLiked(v => !v); } catch (e) { setError(e instanceof ClientError ? e : new ClientError((e as Error).message)); } finally { setBusy(false); } }
  async function removeComment() {
    if (!own || deleteBusy) return;
    const args = deleteAttempt.current || { type: 'deleteReply', id: String(item.id) };
    deleteAttempt.current = args; setDeleteBusy(true); setDeleteError(undefined);
    try { await call('action', args); if (mounted.current) { setConfirmDelete(false); onDeleted(String(item.id)); } }
    catch (e) { if (mounted.current) setDeleteError(e instanceof ClientError ? e : new ClientError((e as Error).message)); }
    finally { if (mounted.current) setDeleteBusy(false); }
  }
  return <article className={`comment ${nested ? 'nested' : ''}`} data-comment-id={item.id}><button className="comment-avatar" onClick={() => feedProps.onUser(String(item.uid), item.username)}><Avatar src={item.userAvatar} name={item.username} size={nested ? 28 : 36} /></button><div className="comment-body"><div className="comment-author"><button onClick={() => feedProps.onUser(String(item.uid), item.username)}>{item.username || '酷友'}</button><span>{relativeTime(item.dateline)}</span></div>{item.rusername && <p className="reply-to">回复 @{item.rusername}</p>}<RichText text={item.message} onLink={feedProps.onLink} />{images.length > 0 && <div className="comment-photos">{images.map((src, i) => <button type="button" key={src + i} aria-label={`查看评论图片 ${i + 1}`} onClick={() => setLightbox(i)}><Picture src={imageItems[i].cover} alt={`评论图片 ${i + 1}`} />{imageItems[i].live && <span className="live-photo-badge">实况</span>}</button>)}</div>}<div className="comment-actions"><button onClick={() => onReply(item)}>回复</button>{feedProps.onReport && /^[1-9]\d{0,19}$/.test(String(item.id)) && <button type="button" onClick={() => feedProps.onReport({ type: 'feed_reply', id: String(item.id) })}>举报评论</button>}{own && <button className="comment-delete" type="button" onClick={() => { deleteAttempt.current = undefined; setDeleteError(undefined); setConfirmDelete(true); }}>删除我的评论</button>}<button disabled={busy || !!error?.verificationId} className={liked ? 'active' : ''} onClick={like} aria-label={liked ? '取消评论点赞' : '赞评论'}><Heart size={14} fill={liked ? 'currentColor' : 'none'} />{count(Math.max(0, Number(item.likenum || 0) + (liked && !item.userAction?.like ? 1 : !liked && item.userAction?.like ? -1 : 0)))}</button></div>
    {error && <ErrorNotice error={error} onRetry={() => void like()} onLogin={feedProps.onLogin} />}
    {!nested && children.length > 0 && <div className="sub-replies">{children.map((child, i) => <Comment nested key={(child.id || i) + ':' + namespace} item={child} feedId={feedId} namespace={namespace} onReply={onReply} onDeleted={onDeleted} deletedIds={deletedIds} feedProps={feedProps} />)}</div>}
    {!nested && Number(item.replynum) > 0 && <button className="text-button sub-replies-toggle" onClick={() => setExpanded(v => !v)}>{expanded ? '收起回复' : `查看 ${item.replynum} 条回复`}<ChevronDown size={14} /></button>}{expanded && sub.error && <ErrorNotice error={sub.error} onRetry={sub.retry} onLogin={feedProps.onLogin} />}{expanded && sub.loading && <p className="muted">正在加载回复…</p>}{expanded && children.length > 0 && <LoadMore loading={sub.loading} hasMore={sub.data?.hasMore} onClick={sub.more} />}
    {lightbox != null && <Lightbox images={images} items={imageItems} contextId={String(item.id)} contextType="reply" namespace={namespace} index={lightbox} onClose={() => setLightbox(null)} />}
    {confirmDelete && <Modal title="删除我的评论" onClose={() => { if (!deleteBusy) setConfirmDelete(false); }}><div className="comment-delete-confirm"><p>确认删除这条由你发布的评论？删除后无法在客户端恢复。</p><div className="comment-delete-preview">{plain(item.message).slice(0, 240) || '图片评论'}</div>{deleteError && <ErrorNotice error={deleteError} onRetry={() => void removeComment()} onLogin={feedProps.onLogin} />}<footer><button className="button secondary" disabled={deleteBusy} onClick={() => setConfirmDelete(false)}>取消</button><button className="button danger" disabled={deleteBusy || !!deleteError?.verificationId} onClick={() => void removeComment()}>{deleteBusy ? '删除中…' : '确认删除评论'}</button></footer></div></Modal>}
  </div></article>;
}
