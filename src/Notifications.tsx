import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCheck, RefreshCw } from 'lucide-react';
import { NOTIFICATION_TABS, notificationCounts, notificationModel } from '../core/notifications.mjs';
import { Avatar, Empty, ErrorNotice, LoadMore, RichText, Skeleton } from './components';
import { call, ClientError, plain, relativeTime, useResource } from './data';
import type { Entity } from './types';
import './notifications.css';

type Props = { namespace: string; loggedIn: boolean; revision: number; ignoreLikes?: boolean; onLogin: () => void; onLink: (url: string) => void; onUser: (uid: string, title: string) => void; onOpen: (entity: Entity) => void; onCountChanged: () => void };
export function Notifications({ namespace, loggedIn, revision, ignoreLikes = false, onLogin, onLink, onUser, onOpen, onCountChanged }: Props) {
  const [type, setType] = useState('list'), [refresh, setRefresh] = useState(0);
  const [clearing, setClearing] = useState(false), [error, setError] = useState<ClientError>();
  const active = useRef(false), inFlight = useRef(false), latestNamespace = useRef(namespace);
  const pending = useRef<{ namespace: string; type: 'feed' | 'all' } | null>(null);
  latestNamespace.current = namespace;
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current = null; }; }, []);
  const list = useResource(loggedIn ? 'notifications' : null, { type }, namespace, revision + refresh);
  const counts = useResource(loggedIn ? 'notificationCount' : null, {}, namespace, revision + refresh);
  const items: Entity[] = Array.isArray(list.data?.data) ? list.data!.data : [];
  const snapshot = notificationCounts(counts.data, items, { ignoreLikes });
  async function clearUnread(requestedType: 'feed' | 'all' = 'feed', retry = false) {
    if (!loggedIn || !active.current || inFlight.current) return;
    const operation = retry ? pending.current : { namespace, type: requestedType };
    if (!operation || operation.namespace !== latestNamespace.current) return;
    pending.current = operation; inFlight.current = true; setClearing(true); setError(undefined);
    try {
      await call('clearNotificationCount', { type: operation.type });
      if (!active.current || latestNamespace.current !== operation.namespace) return;
      pending.current = null; setRefresh(value => value + 1); onCountChanged();
    } catch (failure) { if (active.current && latestNamespace.current === operation.namespace) setError(failure as ClientError); }
    finally { if (active.current && latestNamespace.current === operation.namespace) { inFlight.current = false; setClearing(false); } }
  }
  if (!loggedIn) return <Empty title="登录后查看通知" message="查看评论回复、提及、收到的赞和新关注。"><button className="button" onClick={onLogin}>登录酷安</button></Empty>;
  return <section className="notifications-center" aria-label="通知中心">
    <div className="notification-toolbar"><span className="muted">{snapshot.community === null ? '社区消息' : `${snapshot.community} 条社区未读`}</span><div><button className="text-button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} />刷新通知</button><button className="text-button" disabled={clearing || !!error?.verificationId} onClick={() => void clearUnread()}><CheckCheck size={15} />{clearing ? '正在清除…' : '清除社区未读'}</button><button className="text-button" disabled={clearing || !!error?.verificationId} onClick={() => void clearUnread('all')}>全部标记已读（含私信）</button></div></div>
    <div className="tabs notification-tabs" role="tablist" aria-label="通知分类">{NOTIFICATION_TABS.map(tab => <button key={tab.id} role="tab" aria-selected={type === tab.id} className={type === tab.id ? 'selected' : ''} onClick={() => setType(tab.id)}>{tab.title}{Number(snapshot.categories[tab.category]) > 0 && <span className="notification-badge">{Math.min(99, Number(snapshot.categories[tab.category]))}</span>}</button>)}</div>
    {error && <ErrorNotice error={error} onRetry={() => void clearUnread('feed', true)} onLogin={onLogin} />}
    {counts.error && <ErrorNotice error={counts.error} onRetry={counts.retry} onLogin={onLogin} />}
    {list.error && <ErrorNotice error={list.error} onRetry={list.retry} onLogin={onLogin} />}
    {list.loading && !list.data && <Skeleton />}
    {!list.loading && !list.error && !items.length && <Empty title="暂无这类通知" message="有新的互动时会显示在这里。" />}
    <div className="notification-list">{items.map((item, index) => {
      const model = notificationModel(item, type), actor = model.actor;
      return <article className={`notification-row ${model.unread ? 'unread' : ''}`} key={`${type}:${item.id || item.entityId || index}`}>
        {actor.uid ? <button className="notification-avatar" aria-label={`查看${plain(actor.username)}的主页`} onClick={() => onUser(actor.uid, plain(actor.username))}><Avatar src={actor.avatar} name={actor.username} size={42} /></button> : <Avatar src={actor.avatar} name={actor.username} size={42} />}
        <div className="notification-content"><header>{actor.uid ? <button className="text-button notification-actor" onClick={() => onUser(actor.uid, plain(actor.username))}>{plain(actor.username)}</button> : <strong>{plain(actor.username)}</strong>}<span>{model.time > 0 && <time>{relativeTime(model.time)}</time>}{model.unread > 0 && <span className="notification-badge" aria-label="这条通知的未读数">{model.unread}</span>}</span></header>
          {model.note && <div className="notification-note"><RichText text={model.note} onLink={onLink} /></div>}
          {model.message && <div className="notification-message"><RichText text={model.message} onLink={onLink} /></div>}
          {model.title && model.title !== model.message && <div className="notification-target"><RichText text={model.title} onLink={onLink} /></div>}
          {model.feedId ? <button className="notification-original" onClick={() => onOpen({ id: model.feedId, entityType: 'feed', ...(model.replyId ? { __replyId: model.replyId } : {}) })}><span>原动态</span><strong>{plain(model.summary).slice(0, 160) || '查看完整动态'}</strong><small>{model.replyId ? '查看对应评论' : '查看原动态'}<ArrowUpRight size={14} /></small></button> : model.entity ? <button className="text-button" onClick={() => onOpen(model.entity!)}>查看{plain(model.entity.title || model.entity.username || '通知目标')}<ArrowUpRight size={14} /></button> : model.link ? <button className="text-button" onClick={() => onLink(model.link)}>查看通知目标<ArrowUpRight size={14} /></button> : null}
        </div>
      </article>;
    })}</div>
    {items.length > 0 && <LoadMore loading={list.loading} hasMore={list.data?.hasMore} onClick={list.more} />}
  </section>;
}
