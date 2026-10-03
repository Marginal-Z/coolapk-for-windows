import { Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Skeleton } from './components';
import { plain, useResource } from './data';
import type { Entity } from './types';

export function UserDiscovery({ uid, type, namespace, loggedIn, revision, onLogin, openEntity, feedProps }: { uid: string; type: 'profile' | 'ratings'; namespace: string; loggedIn: boolean; revision: number; onLogin: () => void; openEntity: (entity: Entity) => void; feedProps: any }) {
  const resource = useResource(type === 'ratings' ? 'userAppRatings' : loggedIn ? 'userProfile' : 'publicUserProfile', { uid }, namespace, revision);
  const data = resource.data?.data;
  const items: Entity[] = Array.isArray(data) ? data : [];
  const info = data?.userInfo && typeof data.userInfo === 'object' ? data.userInfo : {};
  const value = (keys: string[]) => keys.map(key => data?.[key] ?? info[key]).find(item => typeof item === 'string' && item.trim());
  const details = [['个人介绍', value(['introduce', 'bio', 'description'])], ['所在地', value(['city', 'province', 'location'])], ['IP 属地', value(['ipLocation', 'ip_location'])], ['认证', value(['verifyTitle', 'verify_title'])]];
  return <section aria-label={type === 'profile' ? '酷友资料' : '酷友应用评分'}>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}
    {resource.loading && !resource.data && <Skeleton />}
    {type === 'profile' && data && <><div className="profile-card"><div><h2>{plain(data.username || info.username || '酷友资料')}</h2><p>UID {uid}</p>{details.filter(([, content]) => content).map(([label, content]) => <p key={label}><strong>{label}：</strong>{plain(content)}</p>)}</div></div>{Array.isArray(data.entities) && data.entities.map((entity: Entity, index: number) => <EntityCard key={entity.id || index} entity={entity} onOpen={openEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />)}</>}
    {type === 'ratings' && <><div className="feed-list">{items.map((entity, index) => entity.entityType === 'feed' ? <FeedCard key={entity.id || index} feed={entity} {...feedProps} /> : <EntityCard key={entity.id || index} entity={entity} onOpen={openEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />)}</div>{items.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}</>}
    {!resource.loading && !resource.error && !data && <Empty title="资料暂不可用" />}
    {type === 'ratings' && !resource.loading && !resource.error && !items.length && <Empty title="没有可见的应用评分" />}
  </section>;
}
