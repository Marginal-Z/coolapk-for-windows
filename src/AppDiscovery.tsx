import { useState } from 'react';
import type { CatalogProps } from './Catalog';
import { Empty, EntityCard, ErrorNotice, LoadMore, Skeleton } from './components';
import { useResource } from './data';
import type { Entity } from './types';
import './catalog.css';

const appCategories = [['recommend', '推荐榜'], ['newest', '最新应用'], ['tools', '系统工具'], ['social', '社交聊天'], ['media', '影音播放'], ['beauty', '主题美化']];
const gameCategories = [['hot', '热门游戏'], ['new', '新游戏'], ['single', '单机游戏'], ['online', '网络游戏'], ['casual', '休闲游戏'], ['indie', '独立游戏']];

export function AppDiscovery(props: CatalogProps) {
  const initialMode = props.page.type === 'games' || props.page.type === 'game' ? 'game' : 'app';
  return <DiscoveryList key={props.namespace + ':' + initialMode} {...props} initialMode={initialMode} />;
}
function DiscoveryList(props: CatalogProps & { initialMode: string }) {
  const [mode, setMode] = useState(props.initialMode), [appCategory, setAppCategory] = useState('recommend'), [gameCategory, setGameCategory] = useState('hot'), [revision, setRevision] = useState(0);
  const category = mode === 'game' ? gameCategory : appCategory;
  const resource = useResource(mode === 'game' ? 'gameDiscovery' : 'appDiscovery', { category, page: 1 }, props.namespace, revision);
  const items: Entity[] = Array.isArray(resource.data?.data) ? resource.data.data : [];
  const categories = mode === 'game' ? gameCategories : appCategories;
  return <section className="catalog-screen" aria-label="应用和游戏发现">
    <div className="tabs" role="group" aria-label="应用类型">{[['app', '应用'], ['game', '游戏']].map(([value, title]) => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? 'selected' : ''} onClick={() => setMode(value)}>{title}</button>)}</div>
    <div className="catalog-toolbar"><label>{mode === 'game' ? '游戏分类' : '应用分类'} <select aria-label={mode === 'game' ? '游戏分类' : '应用分类'} value={category} onChange={event => mode === 'game' ? setGameCategory(event.target.value) : setAppCategory(event.target.value)}>{categories.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label><button type="button" className="text-button" onClick={() => setRevision(value => value + 1)} disabled={resource.loading}>刷新列表</button></div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}
    {resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && !items.length && <Empty title={mode === 'game' ? '这个分类暂时没有游戏' : '这个分类暂时没有应用'} />}
    <div className="feed-list">{items.map((item, index) => <EntityCard key={String(item.id || item.packageName || index)} entity={item} onOpen={props.openEntity} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} />)}</div>
    {resource.data && <LoadMore loading={resource.loading} hasMore={resource.data.hasMore} onClick={resource.more} />}
  </section>;
}
export default AppDiscovery;
