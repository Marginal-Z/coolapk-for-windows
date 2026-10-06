import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowUpRight, Bookmark, Check, ChevronLeft, ChevronRight, ExternalLink, Flag, Heart, ImageOff, LoaderCircle, MessageCircle, MoreHorizontal, Play, RefreshCw, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { call, ClientError, count, imageUrl, plain, relativeTime, secureUrl, unwrap } from './data';
import type { Entity, ImageViewerPayload, ReportTarget } from './types';
import { isQuestion, VoteCard } from './Community';
import { ArticleBody } from './ArticleEditor';
import { readArticleModels } from './article-models';
import { photoItems, type PhotoItem } from './photo-items';
import { LivePhoto } from './LivePhoto';
import './photo-items.css';
import { ShareDialog } from './Sharing';
import { useImageNetwork, useImagePreferences } from './image-preferences';
import { preferredImageSource } from '../core/image-preferences.mjs';
import { appIconSource } from '../core/app-media.mjs';
import './app-media.css';
import './image-viewer.css';

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
export function AppIcon({ app, name, size = 64 }: { app: Entity; name: string; size?: number }) {
  const source = appIconSource(app);
  return <span className="app-icon" style={{ width: size, height: size }}>
    {source ? <Picture key={source} src={source} alt={`${name}应用图标`} className="app-icon-image" /> : <span className="app-icon-unavailable" role="img" aria-label={`${name}未提供应用图标`}><ImageOff size={24} /></span>}
  </span>;
}
export function RichText({ text, onLink }: { text: any; onLink: (url: string) => void }) {
  const source = String(text ?? ''), latestLink = useRef(onLink);
  useLayoutEffect(() => { latestLink.current = onLink; }, [onLink]);
  // Feed lists rerender while search and shell state change. Keep the parsed
  // safe element tree until its text changes, but dispatch links to the current
  // committed callback instead of retaining an old account/navigation closure.
  const content = useMemo(() => {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    function render(node: ChildNode, key: number): ReactNode {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!(node instanceof HTMLElement)) return null;
      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map(render);
      if (['script', 'style', 'iframe', 'object', 'form', 'input', 'svg', 'math'].includes(tag)) return null;
      if (tag === 'a') { const url = secureUrl(node.getAttribute('href')); return url ? <a key={key} href={url} onClick={e => { e.preventDefault(); e.stopPropagation(); latestLink.current(url); }}>{children}</a> : children; }
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
    return Array.from(doc.body.childNodes).map(render);
  }, [source]);
  return <div className="rich-text">{content}</div>;
}
export function ErrorNotice({ error, onRetry, onLogin }: { error?: ClientError; onRetry?: () => void; onLogin?: () => void }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  // Verification belongs to this error instance and its original operation.
  // A parent's ordinary rerender may replace an inline callback without replacing the error.
  const signature = error ? JSON.stringify([error.code, error.message, error.verificationId || '']) : '';
  const latestError = useRef(error), latestSignature = useRef(signature), active = useRef(false), sequence = useRef(0), inFlight = useRef(false);
  latestError.current = error; latestSignature.current = signature;
  // Invalidate during the commit: a promise can settle after DOM removal but
  // before passive effect cleanup has run.
  useLayoutEffect(() => {
    sequence.current++; active.current = true; inFlight.current = false; setVerifying(false); setVerifyError('');
    return () => { sequence.current++; active.current = false; };
  }, [error, signature]);
  if (!error) return null;
  async function verify() {
    if (!error?.verificationId || !active.current || inFlight.current || latestError.current !== error || latestSignature.current !== signature) return;
    const current = sequence.current, retry = onRetry, valid = () => active.current && current === sequence.current && latestError.current === error && latestSignature.current === signature;
    inFlight.current = true; setVerifying(true); setVerifyError('');
    try {
      const outcome = await unwrap(window.coolapk?.verify(error.verificationId));
      if (valid()) {
        if (outcome?.verified === true) window.dispatchEvent(new CustomEvent('coolapk:verification-completed', { detail: { id: error.verificationId } }));
        retry?.();
      }
    }
    catch (e) { if (valid()) setVerifyError((e as Error).message); }
    finally { if (valid()) { inFlight.current = false; setVerifying(false); } }
  }
  return <div role="alert" className="error-notice"><AlertCircle size={20} /><div><strong>{error.code === 'LOGIN_REQUIRED' ? '需要登录账号' : error.code === 'VERIFY_REQUIRED' ? '酷安要求安全验证' : '加载遇到问题'}</strong><p>{verifyError || error.message}</p></div>{error.verificationId ? <button type="button" className="button" disabled={verifying} onClick={verify}>{verifying ? '验证中…' : '完成验证'}</button> : error.code === 'LOGIN_REQUIRED' && onLogin ? <button type="button" className="button" onClick={onLogin}>登录</button> : onRetry ? <button type="button" className="icon-button" onClick={onRetry} aria-label="重试"><RefreshCw size={18} /></button> : null}</div>;
}
export function Skeleton() { return <div className="skeleton-list" aria-label="正在加载" role="status">{[0, 1, 2].map(n => <div className="skeleton-feed" key={n}><span className="skeleton-avatar" /><div><span style={{ width: '28%' }} /><span /><span style={{ width: '80%' }} /><span style={{ width: '57%' }} /></div></div>)}</div>; }
export function Empty({ title = '这里还没有内容', message = '换个频道看看，或者稍后刷新。', children }: { title?: string; message?: string; children?: ReactNode }) {
  return <div className="empty"><MessageCircle size={38} strokeWidth={1.25} /><h3>{title}</h3><p>{message}</p>{children}</div>;
}
export function LoadMore({ loading, hasMore, error, onClick, label = '加载更多', className = '' }: { loading: boolean; hasMore?: boolean; error?: unknown; onClick: () => void; label?: string; className?: string }) {
  const sentinel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || loading || error || hasMore === false) return;
    let ancestor = node.parentElement;
    while (ancestor && !/auto|scroll/.test(getComputedStyle(ancestor).overflowY)) ancestor = ancestor.parentElement;
    const root = ancestor || document.scrollingElement as HTMLElement;
    if (!root) return;
    let previous = root.scrollTop, queued = false, disposed = false, armed = false;
    const load = () => {
      if (disposed || queued || !armed || !node.getClientRects().length) return;
      const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(item => item.getClientRects().length).at(-1);
      if (dialog && !dialog.contains(node)) return;
      const bounds = node.getBoundingClientRect();
      const viewport = ancestor ? ancestor.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      if (bounds.top > viewport.bottom + 280 || bounds.bottom < viewport.top) return;
      queued = true; onClick();
    };
    const scroll = () => { const current = root.scrollTop; if (current > previous) load(); previous = current; };
    const wheel = (event: Event) => { if ((event as WheelEvent).deltaY > 0) { armed = true; load(); } };
    const keyboard = (event: Event) => { if (['ArrowDown', 'PageDown', 'End', ' '].includes((event as KeyboardEvent).key)) armed = true; };
    const pointer = () => { armed = true; };
    const target = ancestor || window;
    target.addEventListener('scroll', scroll, { passive: true });
    target.addEventListener('wheel', wheel, { passive: true });
    target.addEventListener('keydown', keyboard);
    target.addEventListener('pointerdown', pointer, { passive: true });
    target.addEventListener('touchmove', pointer, { passive: true });
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load();
    }, { root: ancestor, rootMargin: '0px 0px 280px 0px' }) : undefined;
    observer?.observe(node);
    return () => { disposed = true; observer?.disconnect(); target.removeEventListener('scroll', scroll); target.removeEventListener('wheel', wheel); target.removeEventListener('keydown', keyboard); target.removeEventListener('pointerdown', pointer); target.removeEventListener('touchmove', pointer); };
  }, [loading, hasMore, error, onClick]);
  return <button ref={sentinel} className={`load-more ${className}`.trim()} onClick={onClick} disabled={loading || hasMore === false} aria-label={!loading && hasMore !== false && !error ? label : undefined} aria-live="polite">{loading ? <><LoaderCircle size={18} className="spin" />正在加载</> : hasMore === false ? '已经看完了' : error ? `重试${label}` : `向下滚动自动加载 · ${label}`}</button>;
}
// Same-commit dialog replacements inherit the original page trigger while the
// outgoing dialog waits for the parent's inert cleanup before restoring focus.
let pendingModalFocus: { target: HTMLElement } | null = null;
export function Modal({ title, onClose, children, wide = false, className = '' }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null), latestClose = useRef(onClose);
  useLayoutEffect(() => { latestClose.current = onClose; }, [onClose]);
  useEffect(() => {
    const active = document.activeElement;
    previousFocus.current ||= active === document.body && pendingModalFocus?.target.isConnected ? pendingModalFocus.target : active instanceof HTMLElement ? active : null;
    const previous = previousFocus.current, dialog = ref.current;
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]') || []);
    focusables()[0]?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.stopPropagation(); latestClose.current(); }
      if (event.key === 'Tab') { const nodes = focusables(); const first = nodes[0], last = nodes.at(-1); if (!nodes.length) { event.preventDefault(); return; } if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      // Restore only after the parent removes inert from the underlying page.
      // StrictMode's initial effect replay keeps this dialog connected.
      const handoff = !dialog?.isConnected && previous?.isConnected ? { target: previous } : null;
      if (handoff) pendingModalFocus = handoff;
      queueMicrotask(() => {
        if (handoff && pendingModalFocus === handoff) pendingModalFocus = null;
        if (dialog?.isConnected || !previous?.isConnected || previous.closest('[inert]')) return;
        const current = document.activeElement;
        if (!current || current === document.body || dialog?.contains(current)) previous.focus({ preventScroll: true });
      });
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button onClick={onClose} className="icon-button" aria-label="关闭"><X size={20} /></button></div>{children}</div></div>;
}
type LightboxProps = ImageViewerPayload & { onClose: () => void };
export function Lightbox(props: LightboxProps) {
  const opening = useRef<Promise<Entity> | null>(null), close = useRef(props.onClose);
  const [error, setError] = useState<ClientError>();
  useLayoutEffect(() => { close.current = props.onClose; }, [props.onClose]);
  const native = window.coolapk?.openImageViewer;
  useEffect(() => {
    if (!native) return;
    // Reuse the same request during React StrictMode's effect replay.
    opening.current ||= unwrap(native({ images: props.contextType === 'message' ? [] : props.images, index: props.index, items: props.contextType === 'message' ? undefined : props.items, contextId: props.contextId, contextType: props.contextType, namespace: props.namespace }));
    let active = true;
    opening.current.then(() => { if (active) close.current(); }).catch(failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [native]);
  if (!native) return <ImageViewerContent {...props} />;
  return error ? <Modal title="无法打开图片窗口" onClose={props.onClose}><ErrorNotice error={error} /></Modal> : <span role="status" className="sr-only">正在打开图片窗口…</span>;
}
export function ImageViewerContent({ images, index, onClose, items, contextId, contextType = 'feed', namespace = 'guest', standalone = false }: LightboxProps & { standalone?: boolean }) {
  const [current, setCurrent] = useState(index);
  const { imagePreferences } = useImagePreferences(), network = useImageNetwork();
  const [originalTarget, setOriginalTarget] = useState('');
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState<ClientError>(), [saved, setSaved] = useState('');
  const scroll = useRef<HTMLDivElement>(null), media = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ key: '', width: 0, height: 0 });
  const [zoomState, setZoomState] = useState<{ key: string; value: number | null }>({ key: '', value: null });
  const zoomAnchor = useRef<{ key: string; x: number; y: number } | undefined>(undefined);
  const privateImage = contextType === 'message';
  const source = items?.[current]?.source || images[current];
  const originalKey = JSON.stringify([namespace, contextType, contextId, current, source]);
  const displayedSource = preferredImageSource({ source, cover: items?.[current]?.cover }, imagePreferences, originalTarget === originalKey, network), showingOriginal = displayedSource === source;
  const live = !!(items?.[current]?.live && contextId && !privateImage);
  const sizeKey = JSON.stringify([originalKey, privateImage || live ? source : displayedSource]);
  const natural = imageSize.key === sizeKey ? imageSize : { width: 0, height: 0 };
  const zoom = zoomState.key === originalKey ? zoomState.value : null;
  const fit = natural.width && viewport.width ? Math.min(1, viewport.width / natural.width, viewport.height / natural.height) : 1;
  const minimumScale = Math.min(.1, fit);
  const scale = zoom ?? fit, canZoom = natural.width > 0 && natural.height > 0;
  const mediaStyle = canZoom ? { width: natural.width * scale, height: natural.height * scale } : undefined;
  useEffect(() => { setOriginalTarget(''); }, [imagePreferences.browsingMode]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      setViewport({ width: Math.max(1, node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), height: Math.max(1, node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const readImageSize = () => {
    const image = media.current?.querySelector('img');
    if (image?.complete && image.naturalWidth && image.naturalHeight) setImageSize({ key: sizeKey, width: image.naturalWidth, height: image.naturalHeight });
  };
  useLayoutEffect(readImageSize, [sizeKey]);
  useLayoutEffect(() => { zoomAnchor.current = undefined; scroll.current?.scrollTo(0, 0); }, [originalKey]);
  useLayoutEffect(() => {
    const node = scroll.current, anchor = zoomAnchor.current;
    if (!node || !anchor || anchor.key !== originalKey || !canZoom) return;
    const padding = 16;
    node.scrollLeft = Math.max(0, natural.width * scale * anchor.x + padding - node.clientWidth / 2);
    node.scrollTop = Math.max(0, natural.height * scale * anchor.y + padding - node.clientHeight / 2);
    zoomAnchor.current = undefined;
  }, [zoom, originalKey, canZoom, natural.width, natural.height, scale]);
  function setZoom(value: number | null) {
    if (!canZoom) return;
    const bounded = value === null ? null : Math.max(minimumScale, Math.min(8, value));
    if (bounded === zoom || zoom === null && bounded === scale) return;
    const node = scroll.current, bounds = media.current?.getBoundingClientRect();
    if (node && bounds?.width && bounds.height) {
      const viewportBounds = node.getBoundingClientRect();
      zoomAnchor.current = { key: originalKey, x: Math.max(0, Math.min(1, (viewportBounds.left + node.clientWidth / 2 - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (viewportBounds.top + node.clientHeight / 2 - bounds.top) / bounds.height)) };
    }
    setZoomState({ key: originalKey, value: bounded });
  }
  useEffect(() => {
    if (!standalone) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [standalone, onClose]);
  async function save() { if (saving) return; setSaving(true); setSaveError(undefined); setSaved(''); try { const result = await unwrap(window.coolapk?.saveImage({ url: source, name: `酷安-${contextType}-${contextId || '图片'}-${current + 1}` })); if (result.saved) setSaved('已保存 ' + result.name); } catch (e) { setSaveError(e instanceof ClientError ? e : new ClientError((e as Error).message)); } finally { setSaving(false); } }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setCurrent(i => (i + images.length - 1) % images.length); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setCurrent(i => (i + 1) % images.length); }
      if (['+', '=', '-', '0', '1'].includes(e.key) && !e.altKey && !e.metaKey) {
        e.preventDefault(); setZoom(e.key === '0' ? null : e.key === '1' ? 1 : scale * (e.key === '-' ? .8 : 1.25));
      }
    };
    const wheel = (e: WheelEvent) => { if (e.ctrlKey && e.deltaY) { e.preventDefault(); setZoom(scale * (e.deltaY > 0 ? .8 : 1.25)); } };
    const node = scroll.current;
    document.addEventListener('keydown', key); node?.addEventListener('wheel', wheel, { passive: false });
    return () => { document.removeEventListener('keydown', key); node?.removeEventListener('wheel', wheel); };
  }, [images.length, scale, minimumScale, canZoom, originalKey]);
  const title = privateImage ? '私信图片' : `图片 ${current + 1} / ${images.length}`;
  const content = <><div className={`lightbox ${zoom === null ? 'image-fit' : 'image-zoomed'}`}><div className="lightbox-scroll" ref={scroll} tabIndex={0} aria-label="图片浏览区域"><div className="lightbox-media" ref={media} style={mediaStyle} onLoadCapture={readImageSize}>{live ? <LivePhoto picUrl={items![current].source} videoUrl={items![current].video} id={contextId!} contentType={contextType as 'feed' | 'reply' | 'article'} namespace={namespace} alt={`实况照片 ${current + 1}`} /> : privateImage ? <img src={source} alt="私信图片原图" /> : <Picture src={displayedSource} alt={`图片 ${current + 1}`} />}</div></div>{images.length > 1 && <><button className="image-prev icon-button" onClick={() => setCurrent(i => (i + images.length - 1) % images.length)} aria-label="上一张"><ChevronLeft /></button><button className="image-next icon-button" onClick={() => setCurrent(i => (i + 1) % images.length)} aria-label="下一张"><ChevronRight /></button></>}</div><div className="lightbox-tools"><div className="lightbox-zoom" role="group" aria-label="图片缩放"><button type="button" className="icon-button" disabled={!canZoom || scale <= minimumScale} onClick={() => setZoom(scale * .8)} aria-label="缩小图片" title="缩小（-）"><ZoomOut size={18} /></button><output aria-label="图片缩放比例">{Math.round(scale * 100)}%</output><button type="button" className="icon-button" disabled={!canZoom || scale >= 8} onClick={() => setZoom(scale * 1.25)} aria-label="放大图片" title="放大（+）"><ZoomIn size={18} /></button></div><button type="button" className="text-button" disabled={!canZoom} aria-pressed={zoom !== null} onClick={() => setZoom(zoom === null ? 1 : null)} title={zoom === null ? '实际大小（1）' : '适应窗口（0）'}>{zoom === null ? '实际大小' : '适应窗口'}</button>{!privateImage && <>{!showingOriginal && !items?.[current]?.live && <button type="button" className="text-button" onClick={() => setOriginalTarget(originalKey)}>加载原图</button>}<button className="text-button" onClick={() => window.coolapk?.openExternal(source)}>查看原图<ExternalLink size={14} /></button><button className="text-button" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存原图'}</button>{saved && <span role="status">{saved}</span>}</>}</div>{saveError && <ErrorNotice error={saveError} onRetry={() => void save()} />}</>;
  // Browser fallback must escape the feed's backdrop-filter/container boundary.
  // Otherwise fixed positioning is relative to the card and the shell can cover
  // its close button. React context and focus restoration survive the portal.
  return standalone ? <main className="image-viewer-window" aria-label="图片查看器"><header className="modal-header"><h2>{title}</h2></header>{content}</main> : createPortal(<Modal title={title} onClose={onClose} wide className="image-viewer-modal">{content}</Modal>, document.body);
}
type FeedProps = { feed: Entity; detailed?: boolean; onOpen: (feed: Entity) => void; onUser: (uid: string, name: string) => void; onLink: (url: string) => void; onLogin: () => void; onForward: (feed: Entity) => void; onCollect?: (feed: Entity) => void; onManage?: (feed: Entity) => void; onReport?: (target: ReportTarget) => void; onGoodsList?: (feed: Entity) => void; collectionEditable?: boolean; accountUid?: string; loggedIn: boolean; toast: (message: string) => void };
export function FeedCard(props: FeedProps) {
  const { feed, detailed, onOpen, onUser, onLink, onLogin, onForward, onCollect, onManage, onReport, collectionEditable, accountUid, loggedIn, toast } = props;
  const [liked, setLiked] = useState(!!feed.userAction?.like);
  const [saved, setSaved] = useState(!!feed.userAction?.favorite);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [share, setShare] = useState(false);
  const [error, setError] = useState<ClientError>();
  const pendingAction = useRef('');
  const imageItems = useMemo(() => photoItems(feed), [feed]), images = useMemo(() => imageItems.map(item => item.source), [imageItems]);
  const deviceLabel = useMemo(() => feed.device_title ? plain(feed.device_title) : '', [feed.device_title]);
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
    <div className="feed-header"><button className="author-button" onClick={() => onUser(String(feed.uid), username)}><Avatar src={feed.userAvatar || feed.userInfo?.userAvatar} name={username} /><span><strong>{username}</strong><span className="feed-meta">{relativeTime(feed.dateline)}{feed.device_title ? ` · ${deviceLabel}` : ''}</span></span></button>{feed.is_headline === 1 && <span className="badge">精选</span>}{onCollect && <button className="icon-button" aria-label="保存到收藏单" onClick={() => loggedIn ? onCollect(feed) : onLogin()}><Bookmark size={17} /></button>}{onManage && (collectionEditable || accountUid && String(feed.uid || feed.userInfo?.uid) === accountUid) && <button className="icon-button" aria-label={collectionEditable ? '管理收藏动态' : '管理我的动态'} onClick={() => onManage(feed)}><MoreHorizontal size={19} /></button>}{onReport && /^[1-9]\d{0,19}$/.test(String(feed.id)) && <button className="icon-button" aria-label="举报动态" onClick={() => onReport({ type: feed.entityType === 'dyhArticle' ? 'article' : 'feed', id: String(feed.id) })}><Flag size={17} /></button>}<button className="icon-button feed-open" aria-label="打开官方帖子" onClick={() => window.coolapk?.openExternal(`https://www.coolapk.com/feed/${feed.id}`)}><ArrowUpRight size={19} /></button></div>
    {isQuestion(feed) && <div className="question-badge">提问 · {count(feed.question_answer_num ?? feed.questionAnswerNum)} 个回答 · {count(feed.question_follow_num ?? feed.questionFollowNum)} 人关注</div>}
    {feed.feedType === 'answer' && <div className="question-badge">回答{feed.question_title ? ` · ${plain(feed.question_title)}` : ''}</div>}
    <div className={`feed-copy ${article ? 'article-content' : ''} ${detailed ? '' : 'clamped'}`} onClick={detailed ? undefined : () => onOpen(feed)}>{title && <h3>{plain(title)}</h3>}{!feed.message_html && !feed.article?.content && readArticleModels(feed.message) ? <ArticleBody message={feed.message} onLink={onLink} id={String(feed.id)} namespace={accountUid || 'guest'} /> : <RichText text={feed.message_html || feed.article?.content || feed.message || feed.message_brief} onLink={onLink} />}</div>
    {!detailed && <button className="text-button read-more" onClick={() => onOpen(feed)}>查看动态<ChevronRight size={14} /></button>}
    {images.length > 0 && <div className={`photo-grid photos-${Math.min(images.length, 3)} ${detailed ? 'expanded' : ''}`}>{images.slice(0, detailed ? 18 : 3).map((src, i) => <button className="photo-button" onClick={() => setLightbox(i)} key={src + i} aria-label={`查看图片 ${i + 1}`}><Picture src={imageItems[i].cover} alt={`${username}的动态配图 ${i + 1}`} />{imageItems[i].live && <span className="live-photo-badge">实况</span>}{!detailed && i === 2 && images.length > 3 && <span className="more-photos">+{images.length - 3}</span>}</button>)}</div>}
    {feed.goodsListInfo && props.onGoodsList && <button className="button secondary" onClick={() => props.onGoodsList?.(feed)}>查看完整好物清单</button>}
    <FeedVideo feed={feed} namespace={accountUid || 'guest'} />
    {feed.vote && <VoteCard feed={feed} namespace={accountUid || 'guest'} loggedIn={loggedIn} onLogin={onLogin} toast={toast} onLink={onLink} onUser={onUser} />}
    {feed.forwardSourceFeed && <button className="forward-preview" onClick={() => onOpen(feed.forwardSourceFeed)}><strong>@{feed.forwardSourceFeed.username}</strong><span>{plain(feed.forwardSourceFeed.message).slice(0, 160)}</span></button>}
    {feed.ttitle && <button className="topic-chip" onClick={() => onLink(feed.turl || `/t/${encodeURIComponent(feed.ttitle)}`)}># {plain(feed.ttitle)}</button>}
    <div className="feed-actions"><button className={liked ? 'active' : ''} disabled={busy || !!error?.verificationId} aria-label={liked ? '取消点赞' : '点赞'} onClick={() => action(liked ? 'unlike' : 'like')}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /><span>{count(Math.max(0, Number(feed.likenum || 0) + (liked && !feed.userAction?.like ? 1 : !liked && feed.userAction?.like ? -1 : 0)))}</span></button><button onClick={() => onOpen(feed)} aria-label="查看评论"><MessageCircle size={18} /><span>{count(feed.replynum)}</span></button><button onClick={() => { if (!loggedIn) onLogin(); else onForward(feed); }} aria-label="转发"><Share2 size={17} /><span>{count(feed.forwardnum)}</span></button><button className={saved ? 'active save-button' : 'save-button'} disabled={busy || !!error?.verificationId} aria-label={saved ? '取消收藏' : '收藏'} onClick={() => void action(saved ? 'unFavorite' : 'favorite')}><Bookmark size={18} fill={saved ? 'currentColor' : 'none'} /><span>{saved ? '已收藏' : '收藏'}</span></button></div>
    {error && <ErrorNotice error={error} onRetry={() => void action(pendingAction.current)} onLogin={onLogin} />}
    {lightbox != null && <Lightbox images={images} items={imageItems} contextId={String(feed.id)} namespace={accountUid || 'guest'} index={lightbox} onClose={() => setLightbox(null)} />}
    <button className="text-button" aria-label="分享动态" onClick={() => setShare(true)}><Share2 size={14} />分享</button>
    {share && <ShareDialog feed={feed} namespace={accountUid || 'guest'} onClose={() => setShare(false)} toast={toast} />}
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
  const isApp = type === 'apk' || type === 'game';
  return <button className="entity-card" onClick={() => isUser ? onUser(String(entity.uid || entity.id), title) : onOpen(entity)}>
    {isApp ? <AppIcon app={entity} name={title} size={56} /> : hasAvatar ? <Avatar src={entity.messageUserAvatar || entity.userAvatar || entity.avatar || entity.logo} name={title} size={48} /> : secureUrl(entity.logo || entity.pic || entity.cover) ? <Picture src={secureUrl(entity.logo || entity.pic || entity.cover)} alt={title} className="entity-picture" /> : <span className="entity-symbol">{type === 'topic' ? '#' : title.slice(0, 1)}</span>}
    <span className="entity-copy"><strong>{title}</strong><span>{plain(entity.description || entity.message || entity.intro || entity.subTitle).slice(0, 160)}</span><small>{entity.rating ? `${entity.rating} 分` : entity.fans ? `${count(entity.fans)} 位粉丝` : entity.commentnum ? `${count(entity.commentnum)} 条讨论` : ''}</small></span><ChevronRight size={17} />
  </button>;
}
