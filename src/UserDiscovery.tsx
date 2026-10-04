import { useState } from 'react';
import { QrCode } from 'lucide-react';
import { userEntityTarget, visibleUserTabs } from '../core/user-discovery-models.mjs';
import { Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Modal, Skeleton } from './components';
import { plain, useResource } from './data';
import type { Entity } from './types';
import './user-discovery.css';

export type UserDiscoveryType = 'profile' | 'ratings' | 'home' | 'circles' | 'content';
type Props = { uid: string; type: UserDiscoveryType; namespace: string; loggedIn: boolean; revision: number; onLogin: () => void; openEntity: (entity: Entity) => void; feedProps: any };
const validUid = (uid: string) => /^[1-9]\d{0,19}$/.test(uid);
export function UserDiscovery(props: Props) {
  if (!validUid(props.uid)) return <Empty title="酷友 UID 无效" />;
  return <UserDiscoveryPane key={JSON.stringify([props.namespace, props.uid, props.type, props.loggedIn])} {...props} />;
}
function UserDiscoveryPane(props: Props) {
  const { uid, namespace, loggedIn, revision, onLogin, openEntity, feedProps } = props;
  const [type, setType] = useState<UserDiscoveryType>(props.type), [qrOpen, setQrOpen] = useState(false);
  const resource = useResource(type === 'profile' ? loggedIn ? 'userProfile' : 'publicUserProfile' : null, { uid }, namespace, revision);
  const data = resource.data?.data;
  const info = data?.userInfo && typeof data.userInfo === 'object' ? data.userInfo : {};
  const value = (keys: string[]) => keys.map(key => data?.[key] ?? info[key]).find(item => typeof item === 'string' && item.trim());
  const details = [['个人介绍', value(['introduce', 'bio', 'description'])], ['所在地', value(['city', 'province', 'location'])], ['IP 属地', value(['ipLocation', 'ip_location'])], ['认证', value(['verifyTitle', 'verify_title'])]];
  return <section className="user-discovery" aria-label={type === 'profile' ? '酷友资料' : type === 'ratings' ? '酷友应用评分' : type === 'circles' ? '酷友关注圈子' : type === 'home' ? '酷友主页' : '酷友公开内容'}>
    {props.type === 'profile' && type !== 'profile' && <button className="text-button" onClick={() => setType('profile')}>返回酷友资料</button>}
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}
    {resource.loading && !resource.data && <Skeleton />}
    {type === 'profile' && data && <><div className="profile-card"><div><h2>{plain(data.username || info.username || '酷友资料')}</h2><p>UID {uid}</p>{details.filter(([, content]) => content).map(([label, content]) => <p key={label}><strong>{label}：</strong>{plain(content)}</p>)}</div></div><div className="user-discovery-actions"><button className="button secondary" onClick={() => setQrOpen(true)}><QrCode size={16} />用户二维码</button><button className="button secondary" onClick={() => setType('circles')}>关注圈子</button><button className="button secondary" onClick={() => setType('home')}>查看主页</button><button className="button secondary" onClick={() => setType('content')}>公开内容</button></div>{Array.isArray(data.entities) && <UserRows rows={data.entities} {...props} />}</>}
    {type === 'profile' && !resource.loading && !resource.error && !data && <Empty title="资料暂不可用" />}
    {type === 'content' ? <UserContent key={namespace + ':' + uid} {...props} /> : type !== 'profile' && <UserList key={namespace + ':' + uid + ':' + type} {...props} type={type} />}
    {qrOpen && type === 'profile' && <Modal title="用户二维码" onClose={() => setQrOpen(false)}><UserQr {...props} /></Modal>}
  </section>;
}

function UserQr({ uid, namespace, loggedIn, revision, onLogin }: Props) {
  const resource = useResource(loggedIn ? 'userQr' : 'publicUserQr', { uid }, namespace, revision), image = resource.data?.data;
  return <div className="user-discovery-qr"><p>扫码打开酷友主页 · UID {uid}</p>{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}{resource.loading && !image && <Skeleton />}{typeof image === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(image) ? <img src={image} alt="用户主页二维码" /> : !resource.loading && !resource.error && <Empty title="二维码暂不可用" />}</div>;
}
function UserContent(props: Props) {
  const [tab, setTab] = useState('feed'), [ratingTarget, setRatingTarget] = useState('all');
  const space = useResource(props.loggedIn ? 'userSpace' : 'publicUserSpace', { uid: props.uid }, props.namespace, props.revision);
  const tabs = visibleUserTabs(space.data?.data), selected = tabs.some(item => item.id === tab) ? tab : 'feed';
  return <><p className="muted">UID {props.uid} 的公开内容</p>{space.error && <ErrorNotice error={space.error} onRetry={space.retry} onLogin={props.onLogin} />}<div className="tabs user-public-tabs" role="tablist" aria-label="酷友公开内容分类">{tabs.map(item => <button type="button" role="tab" aria-selected={selected === item.id} className={selected === item.id ? 'selected' : ''} key={item.id} onClick={() => { setTab(item.id); setRatingTarget('all'); }}>{item.title}</button>)}</div>{selected === 'rating' && <label className="user-rating-filter">评分对象<select aria-label="酷友评分对象" value={ratingTarget} onChange={event => setRatingTarget(event.target.value)}><option value="all">全部</option><option value="apk">应用</option><option value="product">数码产品</option></select></label>}<UserList key={props.namespace + ':' + props.uid + ':' + selected + ':' + ratingTarget} {...props} type="content" tab={selected} ratingTarget={ratingTarget} /></>;
}
function UserList(props: Props & { tab?: string; ratingTarget?: string }) {
  const { type, uid, namespace, loggedIn, revision, onLogin } = props;
  const operation = type === 'ratings' ? 'userAppRatings' : (loggedIn ? 'user' : 'publicUser') + (type === 'circles' ? 'FollowNodes' : type === 'home' ? 'Homepage' : 'TabData');
  const resource = useResource(operation, { uid, ...(type === 'content' ? { tab: props.tab, ...(props.tab === 'rating' ? { ratingTarget: props.ratingTarget } : {}) } : {}) }, namespace, revision);
  const rows: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  return <><div className="user-discovery-list-heading"><h3>{type === 'circles' ? '关注圈子' : type === 'home' ? '主页内容' : type === 'ratings' ? '应用评分' : '公开内容'}</h3><span className="muted">UID {uid}</span></div>{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}{resource.loading && !resource.data && <Skeleton />}<UserRows rows={rows} {...props} />{!resource.loading && !resource.error && !rows.length && <Empty title={type === 'ratings' ? '没有可见的应用评分' : type === 'circles' ? '没有可见的关注圈子' : '没有可见的内容'} />}{resource.data && (rows.length > 0 || resource.data.hasMore) && <LoadMore loading={resource.loading} hasMore={resource.data.hasMore} onClick={resource.more} />}</>;
}
function UserRows({ rows, openEntity, feedProps }: Props & { rows: Entity[] }) {
  return <div className="feed-list user-discovery-rows">{rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)).map((row, index) => {
    const target = userEntityTarget(row), key = (row.entityType || 'unknown') + ':' + (row.id || row.entityId || index);
    if (!target) return <article className="user-unknown-row" key={key}><strong>{plain(row.title || row.name || row.message_title || '主页内容')}</strong><p>{plain(row.message || row.description || row.subTitle || '')}</p></article>;
    if (['feed', 'question', 'answer', 'feedQuestion', 'feedAnswer', 'dyhArticle'].includes(row.entityType)) return <FeedCard key={key} feed={target} {...feedProps} onOpen={feedProps.onOpen || openEntity} />;
    return <EntityCard key={key} entity={target} onOpen={openEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />;
  })}</div>;
}
