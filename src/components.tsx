import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, ExternalLink, Heart, ImageOff, LoaderCircle, MessageCircle, MoreHorizontal, Play, RefreshCw, Share2, X } from 'lucide-react';
import { call, ClientError, count, imageUrl, plain, relativeTime, secureUrl, unwrap } from './data';
import type { Entity } from './types';
import { isQuestion, VoteCard } from './Community';
import { ArticleBody } from './ArticleEditor';
import { readArticleModels } from './article-models';
import { photoItems, type PhotoItem } from './photo-items';
import { LivePhoto } from './LivePhoto';
import './photo-items.css';
import { ShareDialog } from './Sharing';

export function Avatar({ src, name = '酷友', size = 40 }: { src?: string; name?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const url = imageUrl(src);
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * .36 }}>{url && !failed ? <img src={url} alt={`${name}的头像`} loading="lazy" onError={() => setFailed(true)} /> : name.slice(0, 1)}</span>;
}
export function Picture({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <div className={`image-failed ${className || ''}`}><ImageOff size={24} />{className !== 'entity-picture' && <span>图片暂时无法加载</span>}</div> : <img className={className} src={imageUrl(src)} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
export function RichText({ text, onLink }: { text: any; onLink: (url: string) => void }) {
  const doc = new DOMParser().parseFromString(String(text ?? ''), 'text/html');
  function render(node: ChildNode, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(render);
    if (['script', 'style', 'iframe', 'object', 'form', 'input', 'svg', 'math'].includes(tag)) return null;
    if (tag === 'a') { const url = secureUrl(node.getAttribute('href')); return url ? <a key={key} href={url} onClick={e => { e.preventDefault(); e.stopPropagation(); onLink(url); }}>{children}</a> : children; }
    if (tag === 'br') return <br key={key} />;
    if (tag === 'img') { const url = secureUrl(node.getAttribute('src')); return url ? <Picture key={key} src={url} alt={node.getAttribute('alt') || '动态配图'} className="inline-image" /> : null; }
    if (['p', 'div', 'h1', 'h2', 'h3', 'blockquote'].includes(tag)) return <div key={key} className={['h1', 'h2', 'h3'].includes(tag) ? 'rich-heading' : tag === 'blockquote' ? 'quote' : undefined}>{children}</div>;
    if (tag === 'strong' || tag === 'b') return <strong key={key}>{children}</strong>;
    if (tag === 'em' || tag === 'i') return <em key={key}>{children}</em>;
    if (tag === 'pre') return <pre key={key} className="rich-pre">{node.textContent}</pre>;
    if (tag === 'code') return <code key={key}>{children}</code>;
    if (['ul', 'ol'].includes(tag)) return createElement(tag, { key, className: 'rich-list' }, children);
    if (tag === 'li') return <li key={key}>{children}</li>;
    if (tag === 'table') return <div key={key} className="rich-table-scroll"><table className="rich-table">{children}</table></div>;
    if (['thead', 'tbody', 'tfoot', 'tr', 'th', 'td'].includes(tag)) return createElement(tag, { key }, children);
    return <span key={key}>{children}</span>;
  }
  return <div className="rich-text">{Array.from(doc.body.childNodes).map(render)}</div>;
}
export function ErrorNotice({ error, onRetry, onLogin }: { error?: ClientError; onRetry?: () => void; onLogin?: () => void }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  // Verification belongs to this error instance and its original operation.
  // A parent's ordinary rerender may replace an inline callback without replacing the error.
  const signature = error ? JSON.stringify([error.code, error.message, error.verificationId || '']) : '';
  const latestError = useRef(error), latestSignature = useRef(signature), active = useRef(false), sequence = useRef(0), inFlight = useRef(false);
  latestError.current = error; latestSignature.current = signature;
  useEffect(() => {
    sequence.current++; active.current = true; inFlight.current = false; setVerifying(false); setVerifyError('');
    return () => { sequence.current++; active.current = false; };
  }, [error, signature]);
  if (!error) return null;
  async function verify() {
    if (!error?.verificationId || !active.current || inFlight.current || latestError.current !== error || latestSignature.current !== signature) return;
    const current = sequence.current, retry = onRetry, valid = () => active.current && current === sequence.current && latestError.current === error && latestSignature.current === signature;
    inFlight.current = true; setVerifying(true); setVerifyError('');
    try { await unwrap(window.coolapk?.verify(error.verificationId)); if (valid()) retry?.(); }
    catch (e) { if (valid()) setVerifyError((e as Error).message); }
    finally { if (valid()) { inFlight.current = false; setVerifying(false); } }
  }
  return <div role="alert" className="error-notice"><AlertCircle size={20} /><div><strong>{error.code === 'LOGIN_REQUIRED' ? '需要登录账号' : error.code === 'VERIFY_REQUIRED' ? '酷安要求安全验证' : '加载遇到问题'}</strong><p>{verifyError || error.message}</p></div>{error.verificationId ? <button type="button" className="button" disabled={verifying} onClick={verify}>{verifying ? '验证中…' : '完成验证'}</button> : error.code === 'LOGIN_REQUIRED' && onLogin ? <button type="button" className="button" onClick={onLogin}>登录</button> : onRetry ? <button type="button" className="icon-button" onClick={onRetry} aria-label="重试"><RefreshCw size={18} /></button> : null}</div>;
}
export function Skeleton() { return <div className="skeleton-list" aria-label="正在加载" role="status">{[0, 1, 2].map(n => <div className="skeleton-feed" key={n}><span className="skeleton-avatar" /><div><span style={{ width: '28%' }} /><span /><span style={{ width: '80%' }} /><span style={{ width: '57%' }} /></div></div>)}</div>; }
export function Empty({ title = '这里还没有内容', message = '换个频道看看，或者稍后刷新。', children }: { title?: string; message?: string; children?: ReactNode }) {
  return <div className="empty"><MessageCircle size={38} strokeWidth={1.25} /><h3>{title}</h3><p>{message}</p>{children}</div>;
}
export function LoadMore({ loading, hasMore, onClick }: { loading: boolean; hasMore?: boolean; onClick: () => void }) { return <button className="load-more" onClick={onClick} disabled={loading || hasMore === false}>{loading ? <><LoaderCircle size={18} className="spin" />正在加载</> : hasMore === false ? '已经看完了' : '加载更多'}</button>; }
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]') || []);
    focusables()[0]?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') { const nodes = focusables(); const first = nodes[0], last = nodes.at(-1); if (!nodes.length) { event.preventDefault(); return; } if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    }
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button onClick={onClose} className="icon-button" aria-label="关闭"><X size={20} /></button></div>{children}</div></div>;
}
export function Lightbox({ images, index, onClose, items, contextId, contextType = 'feed', namespace = 'guest' }: { images: string[]; index: number; onClose: () => void; items?: PhotoItem[]; contextId?: string; contextType?: 'feed' | 'reply' | 'article'; namespace?: string }) {
  const [current, setCurrent] = useState(index);
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<ClientError>(), [saved, setSaved] = useState('');
  const source = items?.[current]?.source || images[current];
  async function save() { if (saving) return; setSaving(true); setSaveError(undefined); setSaved(''); try { const result = await unwrap(window.coolapk?.saveImage({ url: source, name: `酷安-${contextType}-${contextId || '图片'}-${current + 1}` })); if (result.saved) setSaved('已保存 ' + result.name); } catch (e) { setSaveError(e instanceof ClientError ? e : new ClientError((e as Error).message)); } finally { setSaving(false); } }
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') setCurrent(i => (i + images.length - 1) % images.length); if (e.key === 'ArrowRight') setCurrent(i => (i + 1) % images.length); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [images.length]);
  return <Modal title={`图片 ${current + 1} / ${images.length}`} onClose={onClose} wide><div className="lightbox">{items?.[current]?.live && contextId ? <LivePhoto picUrl={items[current].source} videoUrl={items[current].video} id={contextId} contentType={contextType} namespace={namespace} alt={`实况照片 ${current + 1}`} /> : <Picture src={source} alt={`图片 ${current + 1}`} />}{images.length > 1 && <><button className="image-prev icon-button" onClick={() => setCurrent(i => (i + images.length - 1) % images.length)} aria-label="上一张"><ChevronLeft /></button><button className="image-next icon-button" onClick={() => setCurrent(i => (i + 1) % images.length)} aria-label="下一张"><ChevronRight /></button></>}</div><div className="lightbox-tools"><button className="text-button" onClick={() => window.coolapk?.openExternal(source)}>查看原图<ExternalLink size={14} /></button><button className="text-button" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存原图'}</button>{saved && <span role="status">{saved}</span>}</div>{saveError && <ErrorNotice error={saveError} onRetry={() => void save()} />}</Modal>;
}
type FeedProps = { feed: Entity; detailed?: boolean; onOpen: (feed: Entity) => void; onUser: (uid: string, name: string) => void; onLink: (url: string) => void; onLogin: () => void; onForward: (feed: Entity) => void; onCollect?: (feed: Entity) => void; onManage?: (feed: Entity) => void; onGoodsList?: (feed: Entity) => void; collectionEditable?: boolean; accountUid?: string; loggedIn: boolean; toast: (message: string) => void };
export function FeedCard(props: FeedProps) {
  const { feed, detailed, onOpen, onUser, onLink, onLogin, onForward, onCollect, onManage, collectionEditable, accountUid, loggedIn, toast } = props;
  const [liked, setLiked] = useState(!!feed.userAction?.like);
  const [saved, setSaved] = useState(!!feed.userAction?.favorite);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [share, setShare] = useState(false);
  const [error, setError] = useState<ClientError>();
  const pendingAction = useRef('');
  const imageItems = photoItems(feed), images = imageItems.map(item => item.source);
  const username = String(feed.username || feed.userInfo?.username || '酷友');
  const article = [true, 1, '1'].includes(feed.is_html_article ?? feed.isHtmlArticle) || feed.entityType === 'dyhArticle' || ['article', 'articleFeed'].includes(feed.feedType);
  const title = feed.message_title || feed.messageTitle || ((article || isQuestion(feed) || feed.feedType === 'answer') && !String(feed.title).endsWith('的动态') ? feed.title : '');
  useEffect(() => { setLiked(!!feed.userAction?.like); setSaved(!!feed.userAction?.favorite); setError(undefined); pendingAction.current = ''; setShare(false); }, [feed.id, feed.userAction?.like, feed.userAction?.favorite, accountUid]);
  async function action(type: string) {
    if (!loggedIn) { onLogin(); return; }
    if (busy) return;
    pendingAction.current = type; setBusy(true); setError(undefined);
    try { await call('action', { type, id: String(feed.id) }); if (type === 'like' || type === 'unlike') setLiked(type === 'like'); else setSaved(type === 'favorite'); }
    catch (error) { setError(error instanceof ClientError ? error : new ClientError((error as Error).message)); }
    finally { setBusy(false); }
  }
  return <article className={`feed-card ${detailed ? 'detailed' : ''}`} data-feed-id={feed.id}>
    <div className="feed-header"><button className="author-button" onClick={() => onUser(String(feed.uid), username)}><Avatar src={feed.userAvatar || feed.userInfo?.userAvatar} name={username} /><span><strong>{username}</strong><span className="feed-meta">{relativeTime(feed.dateline)}{feed.device_title ? ` · ${plain(feed.device_title)}` : ''}</span></span></button>{feed.is_headline === 1 && <span className="badge">精选</span>}{onCollect && <button className="icon-button" aria-label="保存到收藏单" onClick={() => loggedIn ? onCollect(feed) : onLogin()}><Bookmark size={17} /></button>}{onManage && (collectionEditable || accountUid && String(feed.uid || feed.userInfo?.uid) === accountUid) && <button className="icon-button" aria-label={collectionEditable ? '管理收藏动态' : '管理我的动态'} onClick={() => onManage(feed)}><MoreHorizontal size={19} /></button>}<button className="icon-button feed-open" aria-label="打开官方帖子" onClick={() => window.coolapk?.openExternal(`https://www.coolapk.com/feed/${feed.id}`)}><ArrowUpRight size={19} /></button></div>
    {isQuestion(feed) && <div className="question-badge">提问 · {count(feed.question_answer_num ?? feed.questionAnswerNum)} 个回答 · {count(feed.question_follow_num ?? feed.questionFollowNum)} 人关注</div>}
    {feed.feedType === 'answer' && <div className="question-badge">回答{feed.question_title ? ` · ${plain(feed.question_title)}` : ''}</div>}
    <div className={`feed-copy ${article ? 'article-content' : ''} ${detailed ? '' : 'clamped'}`} onClick={detailed ? undefined : () => onOpen(feed)}>{title && <h3>{plain(title)}</h3>}{!feed.message_html && !feed.article?.content && readArticleModels(feed.message) ? <ArticleBody message={feed.message} onLink={onLink} id={String(feed.id)} namespace={accountUid || 'guest'} /> : <RichText text={feed.message_html || feed.article?.content || feed.message || feed.message_brief} onLink={onLink} />}</div>
    {!detailed && <button className="text-button read-more" onClick={() => onOpen(feed)}>查看动态<ChevronRight size={14} /></button>}
    {images.length > 0 && <div className={`photo-grid photos-${Math.min(images.length, 3)} ${detailed ? 'expanded' : ''}`}>{images.slice(0, detailed ? 18 : 3).map((src, i) => <button className="photo-button" onClick={() => setLightbox(i)} key={src + i} aria-label={`查看图片 ${i + 1}`}><Picture src={imageItems[i].cover} alt={`${username}的动态配图 ${i + 1}`} />{imageItems[i].live && <span className="live-photo-badge">实况</span>}{!detailed && i === 2 && images.length > 3 && <span className="more-photos">+{images.length - 3}</span>}</button>)}</div>}
    {feed.goodsListInfo && props.onGoodsList && <button className="button secondary" onClick={() => props.onGoodsList?.(feed)}>查看完整好物清单</button>}
    <FeedVideo feed={feed} namespace={accountUid || 'guest'} />
    {feed.vote && <VoteCard feed={feed} namespace={accountUid || 'guest'} loggedIn={loggedIn} onLogin={onLogin} toast={toast} />}
    {feed.forwardSourceFeed && <button className="forward-preview" onClick={() => onOpen(feed.forwardSourceFeed)}><strong>@{feed.forwardSourceFeed.username}</strong><span>{plain(feed.forwardSourceFeed.message).slice(0, 160)}</span></button>}
    {feed.ttitle && <button className="topic-chip" onClick={() => onLink(feed.turl || `/t/${encodeURIComponent(feed.ttitle)}`)}># {plain(feed.ttitle)}</button>}
    <div className="feed-actions"><button className={liked ? 'active' : ''} disabled={busy || !!error?.verificationId} aria-label={liked ? '取消点赞' : '点赞'} onClick={() => action(liked ? 'unlike' : 'like')}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /><span>{count(Math.max(0, Number(feed.likenum || 0) + (liked && !feed.userAction?.like ? 1 : !liked && feed.userAction?.like ? -1 : 0)))}</span></button><button onClick={() => onOpen(feed)} aria-label="查看评论"><MessageCircle size={18} /><span>{count(feed.replynum)}</span></button><button onClick={() => { if (!loggedIn) onLogin(); else onForward(feed); }} aria-label="转发"><Share2 size={17} /><span>{count(feed.forwardnum)}</span></button><button className={saved ? 'active save-button' : 'save-button'} disabled={busy || !!error?.verificationId} aria-label={saved ? '取消收藏' : '收藏'} onClick={() => void action(saved ? 'unFavorite' : 'favorite')}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /><span>{saved ? '已收藏' : '收藏'}</span></button></div>
    {error && <ErrorNotice error={error} onRetry={() => void action(pendingAction.current)} onLogin={onLogin} />}
    {lightbox != null && <Lightbox images={images} items={imageItems} contextId={String(feed.id)} namespace={accountUid || 'guest'} index={lightbox} onClose={() => setLightbox(null)} />}
    <button className="text-button" aria-label="分享动态" onClick={() => setShare(true)}><Share2 size={14} />分享</button>
    {share && <ShareDialog feed={feed} onClose={() => setShare(false)} toast={toast} />}
  </article>;
}

function videoRecord(value: unknown): Entity {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}
function FeedVideo({ feed, namespace }: { feed: Entity; namespace: string }) {
  const info = videoRecord(feed.mediaInfo || feed.media_info);
  const providers = videoRecord(info.requestParams);
  const selected = Object.values(providers).at(-1);
  const providerParams = typeof selected === 'string' ? selected : selected && typeof selected === 'object' ? JSON.stringify(selected) : '';
  const local = videoRecord(providerParams);
  const direct = secureUrl(local.fromType === 'localVideo' ? local['0'] : feed.videoUrl || feed.video_url || feed.video?.url || (['video', '2'].includes(String(info.mediaType || feed.media_type)) ? feed.media_url || info.url : ''));
  const params = direct && local.fromType === 'localVideo' ? '' : providerParams;
  const poster = secureUrl(feed.media_pic || feed.videoPic || info.cover || info.pic);
  const scope = JSON.stringify([namespace, String(feed.id), params, direct]);
  const [playback, setPlayback] = useState({ scope, source: '', loading: false, error: '' });
  const generation = useRef(0), active = useRef(false), inFlight = useRef(false), latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(() => {
    generation.current++; active.current = true; inFlight.current = false;
    setPlayback({ scope, source: '', loading: false, error: '' });
    return () => { generation.current++; active.current = false; };
  }, [scope]);
  const { source, loading, error } = playback.scope === scope ? playback : { source: '', loading: false, error: '' };
  if (!direct && !params) return null;
  async function play() {
    if (!active.current || latestScope.current !== scope || inFlight.current) return;
    const attempt = generation.current, valid = () => active.current && attempt === generation.current && latestScope.current === scope;
    inFlight.current = true; setPlayback({ scope, source: '', loading: true, error: '' });
    try {
      let url = direct;
      if (params) {
        const result = await call('video', { params });
        if (!valid()) return;
        const queue: any[] = [result]; url = '';
        for (let i = 0; i < 50 && queue.length; i++) { const value = queue.shift(); if (typeof value === 'string' && /^https?:\/\//.test(value)) { url = secureUrl(value); break; } if (Array.isArray(value)) queue.push(...value); else if (value && typeof value === 'object') for (const key of ['url', 'videoUrl', 'video_url', 'final_url', 'data', 'result', 'urlList', 'urls']) if (value[key]) queue.push(value[key]); }
      }
      if (!url) throw new Error('酷安未返回可播放的视频地址');
      if (valid()) setPlayback({ scope, source: url, loading: false, error: '' });
    } catch (e) { if (valid()) setPlayback({ scope, source: '', loading: false, error: (e as Error).message }); }
    finally { if (valid()) { inFlight.current = false; setPlayback(state => ({ ...state, loading: false })); } }
  }
  return <div className="feed-video">{source && !error ? <video controls src={source} poster={imageUrl(poster) || undefined} preload="metadata" onError={() => { if (active.current && latestScope.current === scope) setPlayback({ scope, source: '', loading: false, error: '该视频暂时无法播放，可在官方页面查看。' }); }} /> : <button className="video-cover" disabled={loading} onClick={play}>{poster && <Picture src={poster} alt="视频封面" />}<span><Play size={20} fill="currentColor" />{loading ? '正在加载…' : '播放视频'}</span></button>}{error && <div className="video-error"><p>{error}</p><button className="text-button" onClick={() => window.coolapk?.openExternal(`https://www.coolapk.com/feed/${feed.id}`)}>在官方页面查看</button></div>}</div>;
}

export function EntityCard({ entity, onOpen, onUser, onLink }: { entity: Entity; onOpen: (entity: Entity) => void; onUser: (uid: string, name: string) => void; onLink: (url: string) => void }) {
  const type = entity.entityType;
  const title = plain(entity.messageUsername || entity.title || entity.username || entity.appName || entity.name || '查看内容');
  const isUser = type === 'user';
  const hasAvatar = isUser || type === 'message' || !!entity.messageUid;
  return <button className="entity-card" onClick={() => isUser ? onUser(String(entity.uid || entity.id), title) : onOpen(entity)}>
    {hasAvatar ? <Avatar src={entity.messageUserAvatar || entity.userAvatar || entity.avatar || entity.logo} name={title} size={48} /> : secureUrl(entity.logo || entity.pic || entity.cover) ? <Picture src={secureUrl(entity.logo || entity.pic || entity.cover)} alt={title} className="entity-picture" /> : <span className="entity-symbol">{type === 'topic' ? '#' : title.slice(0, 1)}</span>}
    <span className="entity-copy"><strong>{title}</strong><span>{plain(entity.description || entity.message || entity.intro || entity.subTitle).slice(0, 160)}</span><small>{entity.rating ? `${entity.rating} 分` : entity.fans ? `${count(entity.fans)} 位粉丝` : entity.commentnum ? `${count(entity.commentnum)} 条讨论` : ''}</small></span><ChevronRight size={17} />
  </button>;
}
