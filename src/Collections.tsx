import { useEffect, useRef, useState } from 'react';
import { Bookmark, Plus, Trash2 } from 'lucide-react';
import { Empty, ErrorNotice, LoadMore, Modal, Skeleton } from './components';
import { call, ClientError, photos, plain, useResource } from './data';
import type { Entity } from './types';
import './collections.css';
import { ArticleEditor } from './ArticleEditor';

type ModalProps = { onClose: () => void; onDone: () => void; toast: (text: string) => void };
const enabled = (value: unknown) => [true, 1, '1', 'true'].includes(value as any);
const idOf = (item: Entity) => String(item.id ?? item.collectionId ?? item.entityId ?? '');
const selectedInitially = (item: Entity) => enabled(item.isBeCollected ?? item.is_be_collected ?? item.isCollected);
const isDefaultCollection = (item: Entity) => idOf(item) === '0' || enabled(item.defaultCollected ?? item.default_collected ?? item.isDefault ?? item.is_default ?? item.isDefaultCollection);
export const collectionItemId = (feed: Entity) => String(feed.collectionItem?.id || feed.collectionItem?.itemId || feed.collection_item_info?.id || feed.collection_item_info?.itemId || feed.collection_item_info?.item_id || feed.collectionItemId || feed.collection_item_id || '');

export function CollectionEditor({ collection, onClose, onDone, toast }: ModalProps & { collection?: Entity }) {
  const [title, setTitle] = useState(plain(collection?.title || ''));
  const [description, setDescription] = useState(plain(collection?.description || ''));
  const [isOpen, setIsOpen] = useState(collection ? enabled(collection.isOpen ?? collection.is_open) : true);
  const [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastAttempt = useRef(false);
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(remove = false) {
    if (collection && isDefaultCollection(collection)) { setError(new ClientError('默认收藏单不能修改或删除', 'INPUT')); return; }
    if (busy) return; setBusy(true); setError(undefined);
    lastAttempt.current = remove;
    try {
      await call('action', remove ? { type: 'deleteCollection', id: idOf(collection!) } : { type: collection ? 'updateCollection' : 'createCollection', ...(collection ? { id: idOf(collection) } : {}), title, description, isOpen: isOpen ? 1 : 0, cover: collection?.cover || collection?.coverPic || collection?.cover_pic || collection?.pic || '' });
      if (mounted.current) { toast(remove ? '收藏单已删除' : '收藏单已保存'); onDone(); }
    } catch (e) { if (mounted.current) setError(e as ClientError); }
    finally { if (mounted.current) setBusy(false); }
  }
  const locked = busy || !!error?.verificationId || !!(collection && isDefaultCollection(collection));
  return <Modal title={collection ? '编辑收藏单' : '新建收藏单'} onClose={onClose}><form className="collection-form" onSubmit={e => { e.preventDefault(); void submit(); }}><label>收藏单名称<input aria-label="收藏单名称" value={title} maxLength={100} disabled={locked} onChange={e => setTitle(e.target.value)} placeholder="为喜欢的内容起个名字" /></label><label>介绍<textarea aria-label="收藏单介绍" value={description} maxLength={2000} rows={4} disabled={locked} onChange={e => setDescription(e.target.value)} placeholder="这个收藏单记录什么？" /></label><label className="collection-toggle"><input type="checkbox" checked={isOpen} disabled={locked} onChange={e => setIsOpen(e.target.checked)} /><span>公开收藏单，允许其他酷友浏览</span></label>{error && <ErrorNotice error={error} onRetry={() => void submit(lastAttempt.current)} />}<div className="collection-form-footer">{collection && <button type="button" className="text-button danger" disabled={locked} onClick={() => setConfirmDelete(v => !v)}><Trash2 size={15} />删除收藏单</button>}<button className="button" disabled={locked || !title.trim()}>{busy ? '正在保存…' : '保存'}</button></div>{confirmDelete && <div className="delete-confirm"><p>删除“{plain(collection?.title)}”后，收藏单中的内容关联也会被移除。</p><button type="button" className="button danger" disabled={locked} onClick={() => void submit(true)}>确认删除此收藏单</button></div>}</form></Modal>;
}

export function CollectionPicker({ feed, namespace, onClose, onDone, toast }: ModalProps & { feed: Entity; namespace: string }) {
  const resource = useResource('collectionStatus', { id: String(feed.id) }, namespace);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const [creating, setCreating] = useState(false), [revision, setRevision] = useState(0);
  const initializedIds = useRef(new Set<string>());
  const all = useResource(creating ? null : 'collections', {}, namespace, revision);
  const serverItems: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  const known = new Map(serverItems.map(item => [idOf(item), item]));
  const items: Entity[] = [...serverItems, ...(Array.isArray(all.data?.data) ? all.data!.data.filter((item: Entity) => !known.has(idOf(item))) : [])];
  useEffect(() => {
    if (!resource.data) return;
    const newlySelected = serverItems.filter(item => !initializedIds.current.has(idOf(item)) && selectedInitially(item)).map(idOf);
    serverItems.forEach(item => initializedIds.current.add(idOf(item)));
    if (newlySelected.length) setSelected(old => new Set([...old, ...newlySelected]));
  }, [resource.data]);
  async function save() {
    const original = new Set(serverItems.filter(selectedInitially).map(idOf));
    const add = [...selected].filter(id => !original.has(id)), cancel = [...original].filter(id => !selected.has(id));
    if (!add.length && !cancel.length) return onClose();
    setBusy(true); setError(undefined);
    try { await call('action', { type: 'updateCollectionItems', targetId: String(feed.id), collectionIds: add, cancelIds: cancel }); toast('收藏单已更新'); onDone(); }
    catch (e) { setError(e as ClientError); } finally { setBusy(false); }
  }
  if (creating) return <CollectionEditor onClose={() => setCreating(false)} onDone={() => { setCreating(false); setRevision(n => n + 1); }} toast={toast} />;
  const locked = busy || !!error?.verificationId;
  return <Modal title="保存到收藏单" onClose={onClose}><div className="collection-picker"><button className="text-button" disabled={locked} onClick={() => setCreating(true)}><Plus size={16} />新建收藏单</button>{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} />}{all.error && <ErrorNotice error={all.error} onRetry={() => setRevision(n => n + 1)} />}{(resource.loading || all.loading) && !items.length && <Skeleton />}{!resource.loading && !all.loading && !items.length && <Empty title="还没有收藏单" message="新建一个，整理你喜欢的内容。" />}{items.map(item => { const id = idOf(item); return <label className="collection-choice" key={id}><Bookmark size={19} /><span><strong>{plain(item.title || item.name || '收藏单')}</strong><small>{plain(item.description || '')}</small></span><input type="checkbox" checked={selected.has(id)} disabled={locked || resource.loading || !!resource.error} onChange={() => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; })} /></label>; })}{resource.data?.hasMore !== false && serverItems.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}{error && <ErrorNotice error={error} onRetry={() => void save()} />}<button className="button full" disabled={locked || resource.loading || !!resource.error} onClick={() => void save()}>{busy ? '正在保存…' : '完成'}</button></div></Modal>;
}

export function FeedManager({ feed, namespace, onClose, onDone, toast, removeItemId }: ModalProps & { feed: Entity; namespace: string; removeItemId?: string }) {
  const [mode, setMode] = useState<'choose' | 'edit' | 'delete' | 'remove'>('choose');
  const [revision, setRevision] = useState(0);
  const original = useResource(mode === 'edit' ? 'editableFeed' : null, { id: String(feed.id) }, namespace, revision);
  const [draft, setDraft] = useState<{ key: string; message: string }>(), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const [articleSource, setArticleSource] = useState<{ key: string; feed: Entity }>();
  const own = String(feed.uid || feed.userInfo?.uid) === namespace;
  const editable = original.data?.data;
  const article = editable && Number(editable.isHtmlArticle ?? editable.is_html_article) === 1;
  const video = editable && (Number(editable.mediaType ?? editable.media_type ?? 0) > 0 || editable.mediaUrl || editable.media_url);
  const draftKey = namespace + ':' + String(feed.id);
  const lastAttempt = useRef<{ key: string; args: Entity } | undefined>(undefined);
  // Initialize in the same render as the field, before it can receive input. A refresh must not replace a typed draft.
  const message = draft?.key === draftKey ? draft.message : plain(editable?.message);
  const editReady = !!editable && !original.loading && !original.error;
  // Mount from a current successful response, then keep the same source while refreshing so article drafts survive.
  const articleSession = articleSource?.key === draftKey ? articleSource.feed : undefined;
  if (mode === 'edit' && editReady && article && !video && !articleSession) setArticleSource({ key: draftKey, feed: editable });
  async function submit(retry = false) {
    if (busy || (!retry && error?.verificationId) || (mode === 'edit' && (!own || !editReady || article || video || !message.trim()))) return;
    if (retry && lastAttempt.current?.key !== draftKey) return;
    const args = retry ? lastAttempt.current!.args : mode === 'remove' ? { type: 'removeCollectionItem', itemId: removeItemId } : mode === 'delete' ? { type: 'deleteFeed', id: String(feed.id) } : { type: 'editFeed', id: String(feed.id), message, pic: photos(editable!).join(',') };
    lastAttempt.current = { key: draftKey, args };
    setBusy(true); setError(undefined);
    try {
      await call('action', args);
      toast(mode === 'delete' ? '动态已删除' : mode === 'remove' ? '已移出收藏单' : '动态已更新'); onDone();
    } catch (e) { setError(e as ClientError); } finally { setBusy(false); }
  }
  const locked = busy || !!error?.verificationId;
  return <Modal title="管理动态" onClose={onClose}><div className="collection-form">{mode === 'choose' ? <div className="feed-management-options">{own && <><button className="button secondary" onClick={() => { setDraft(undefined); setArticleSource(undefined); setError(undefined); setMode('edit'); }}>编辑我的动态</button><button className="button secondary danger" onClick={() => setMode('delete')}>删除我的动态</button></>}{removeItemId && <button className="button secondary" onClick={() => setMode('remove')}>移出当前收藏单</button>}</div> : <>{mode === 'edit' ? <>{original.loading && <Skeleton />}{original.error && <ErrorNotice error={original.error} onRetry={() => setRevision(value => value + 1)} />}{original.data && !article && !video && <label>动态内容<textarea aria-label="编辑动态内容" value={message} disabled={locked || !editReady} onChange={e => setDraft({ key: draftKey, message: e.target.value })} rows={8} maxLength={1000} /><small>保留原有配图。</small></label>}</> : <p>{mode === 'delete' ? '确认删除这条由你发布的动态？删除后无法在客户端恢复。' : '确认将这条动态移出当前收藏单？'}</p>}{mode === 'edit' && articleSession && <ArticleEditor key={draftKey} feed={articleSession} namespace={namespace} onDone={onDone} toast={toast} disabled={!own || !editReady || !article || !!video} />}{mode === 'edit' && video && <p role="status">当前暂不支持编辑视频动态。</p>}{error && <ErrorNotice error={error} onRetry={() => void submit(true)} />}<div className="collection-form-footer"><button className="button secondary" disabled={locked} onClick={() => setMode('choose')}>返回</button>{!(mode === 'edit' && (article || video || articleSession)) && <button className={`button ${mode === 'delete' ? 'danger' : ''}`} disabled={locked || (mode === 'edit' && (!editReady || !message.trim()))} onClick={() => void submit()}>{busy ? '提交中…' : mode === 'delete' ? '确认删除动态' : mode === 'remove' ? '确认移出' : '保存修改'}</button>}</div></>}</div></Modal>;
}
