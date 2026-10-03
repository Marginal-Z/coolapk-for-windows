import { useEffect, useRef, useState } from 'react';
import { BookOpen, CalendarDays, Grid3X3, Image, Plus, Smartphone, Star } from 'lucide-react';
import { Avatar, Empty, EntityCard, ErrorNotice, FeedCard, Lightbox, LoadMore, Modal, Picture, RichText, Skeleton } from './components';
import { call, ClientError, photos, plain, secureUrl, useResource } from './data';
import type { AccountState, Entity, Page } from './types';
import './catalog.css';
import { AppDownload } from './Downloads';

export type CatalogProps = { page: Page; namespace: string; account: AccountState['current']; onLogin: () => void; go: (page: Page) => void; openEntity: (entity: Entity) => void; feedProps: any; toast: (message: string) => void };
const enabled = (value: unknown) => [true, 1, '1'].includes(value as any);
const ident = (item: Entity) => String(item.id ?? item.entityId ?? item.albumId ?? item.dyhId ?? '');
const rows = (value: any): Entity[] => Array.isArray(value) ? value : [value?.entities, value?.rows, value?.list, value?.data].find(Array.isArray) || [];
const sections = [{ type: 'products', title: '数码资料库', description: '查参数、比较机型、看真实点评', icon: Smartphone }, { type: 'apps', title: '应用发现', description: '版本、开发者与相关应用', icon: Grid3X3 }, { type: 'albums', title: '应用集', description: '发现好应用，整理自己的应用集', icon: BookOpen }, { type: 'dyhs', title: '酷安号', description: '关注、订阅与官方号文章', icon: BookOpen }, { type: 'events', title: '社区活动', description: '浏览活动说明与参与入口', icon: CalendarDays }, { type: 'pictures', title: '酷图', description: '按标签浏览社区图片', icon: Image }];
export function CatalogHub({ go }: { go: CatalogProps['go'] }) { return <div className="catalog-hub">{sections.map(item => <button key={item.type} onClick={() => go({ kind: 'catalog', type: item.type, title: item.title })}><item.icon size={25} /><strong>{item.title}</strong><span>{item.description}</span></button>)}</div>; }

function useCatalogAction(props: CatalogProps, refresh: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const attempt = useRef<{ operation: string; args: Entity; message: string; done?: () => void } | undefined>(undefined);
  const sequence = useRef(0);
  useEffect(() => { sequence.current++; attempt.current = undefined; setBusy(false); setError(undefined); return () => { sequence.current++; }; }, [props.namespace]);
  async function perform(operation: string, args: Entity, message: string, done?: () => void) {
    if (!props.account) return props.onLogin();
    if (busy) return;
    const current = sequence.current;
    attempt.current = { operation, args: JSON.parse(JSON.stringify(args)), message, done };
    setBusy(true); setError(undefined);
    try { await call(operation, attempt.current.args); if (current === sequence.current) { props.toast(message); done?.(); refresh(); } }
    catch (e) { if (current === sequence.current) setError(e as ClientError); }
    finally { if (current === sequence.current) setBusy(false); }
  }
  const retry = () => { const last = attempt.current; if (last) void perform(last.operation, last.args, last.message, last.done); };
  return { busy, error, locked: busy || !!error?.verificationId, perform, retry, clear: () => setError(undefined) };
}
function CatalogList({ resource, props, open, gallery = false, onRetry }: { resource: ReturnType<typeof useResource>; props: CatalogProps; open: (item: Entity) => void; gallery?: boolean; onRetry?: () => void }) {
  const [lightbox, setLightbox] = useState<string[]>();
  const items = rows(resource.data?.data);
  return <>{resource.error && <ErrorNotice error={resource.error} onRetry={resource.failedMore ? resource.retry : onRetry || resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}{!resource.loading && !resource.error && !items.length && <Empty />}
    <div className={gallery ? 'catalog-gallery' : 'feed-list'}>{items.map((item, index) => ['feed', 'dyhArticle'].includes(item.entityType || '') ? <FeedCard key={ident(item) || index} feed={item} {...props.feedProps} /> : gallery ? <button key={ident(item) || index} className="catalog-gallery-item" onClick={() => { const urls = photos(item); if (urls.length) setLightbox(urls); else open(item); }}><Picture src={secureUrl(item.pic || item.url || item.logo)} alt={plain(item.title || item.tag || '社区图片')} /><span>{plain(item.title || item.username || '')}</span></button> : <EntityCard key={ident(item) || index} entity={item} onOpen={open} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} />)}</div>{items.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}{lightbox && <Lightbox images={lightbox} index={0} onClose={() => setLightbox(undefined)} />}</>;
}

export default function CatalogScreen(props: CatalogProps) {
  const family = props.page.type || 'hub';
  if (family === 'hub') return <CatalogHub go={props.go} />;
  if (family === 'product') return <ProductCatalog key={props.namespace + ':' + props.page.id} {...props} />;
  if (family === 'app') return <AppCatalog key={props.namespace + ':' + props.page.id} {...props} />;
  if (family === 'album') return <AlbumCatalog key={props.namespace + ':' + props.page.id} {...props} />;
  if (family === 'dyh' || family === 'event') return <EditorialCatalog {...props} />;
  return <DiscoveryCatalog key={props.namespace + ':' + family} {...props} />;
}
function DiscoveryCatalog(props: CatalogProps) {
  const family = props.page.type!, [tab, setTab] = useState(''), [query, setQuery] = useState(''), [submitted, setSubmitted] = useState('');
  const [editor, setEditor] = useState(false), [revision, setRevision] = useState(0), [category, setCategory] = useState<Entity>();
  let operation: string | null = null, args: Entity = {};
  if (family === 'products') {
    operation = category ? category.url ? 'catalogProductCategoryItems' : 'catalogProductBrandItems' : tab === 'brands' ? 'catalogProductBrands' : ['wish', 'buy', 'owner'].includes(tab) ? 'catalogMyProducts' : 'catalogProductCategories';
    args = category ? { id: ident(category), type: String(category.type || ''), url: category.url, title: category.title || '', subTitle: category.subTitle || '' } : { type: tab || 'wish' };
    if (submitted) { operation = 'search'; args = { query: submitted, type: 'product' }; }
  } else if (family === 'apps') { operation = submitted ? 'search' : 'catalogAppRecommend'; args = submitted ? { query: submitted, type: tab === 'game' ? 'game' : 'apk' } : { type: tab === 'game' ? '1' : '0' }; }
  else if (family === 'albums') { operation = submitted ? 'catalogAlbumSearch' : tab === 'mine' ? 'catalogMyAlbums' : 'catalogAlbums'; args = submitted ? { query: submitted } : { type: tab || 'hot' }; }
  else if (family === 'dyhs') operation = tab === 'following' ? 'catalogDyhFollowing' : tab === 'subscriptions' ? 'catalogDyhSubscriptions' : tab === 'editing' ? 'catalogDyhEditing' : 'catalogDyhs';
  else if (family === 'events') operation = 'catalogEvents';
  else if (family === 'pictures') { operation = 'catalogPictures'; args = { tag: submitted }; }
  const resource = useResource(operation, args, props.namespace, revision);
  const tabs = family === 'products' ? [['categories', '分类'], ['brands', '品牌'], ['wish', '想买'], ['buy', '已买'], ['owner', '拥有']] : family === 'apps' ? [['apk', '应用'], ['game', '游戏']] : family === 'albums' ? [['hot', '热门'], ['new', '最新'], ['mine', '我的应用集']] : family === 'dyhs' ? [['all', '全部'], ['following', '我的关注'], ['subscriptions', '我的订阅'], ['editing', '我管理的号']] : [];
  const open = (item: Entity) => {
    if (family === 'products' && !submitted && item.entityType !== 'product') { setCategory(item); return; }
    const next = family === 'products' ? 'product' : family === 'apps' ? 'app' : family === 'albums' ? 'album' : family === 'dyhs' ? 'dyh' : family === 'events' ? 'event' : '';
    if (next) props.go({ kind: 'catalog', type: next, id: next === 'app' ? String(item.packageName || ident(item)) : ident(item), title: plain(item.title || item.name || item.dyh_name || item.appName || '详情') }); else props.openEntity(item);
  };
  return <div className="catalog-screen"><div className="catalog-toolbar">{family !== 'dyhs' && family !== 'events' && <form className="catalog-search" onSubmit={e => { e.preventDefault(); setSubmitted(query.trim()); setCategory(undefined); }}><input aria-label={family === 'pictures' ? '酷图标签' : '搜索资料库'} value={query} onChange={e => setQuery(e.target.value)} placeholder={family === 'pictures' ? '输入图片标签' : '搜索名称'} /><button className="button secondary">搜索</button></form>}{family === 'albums' && <button className="button" onClick={() => props.account ? setEditor(true) : props.onLogin()}><Plus size={16} />创建应用集</button>}{category && <button className="text-button" onClick={() => setCategory(undefined)}>返回分类</button>}</div>{tabs.length > 0 && <div className="tabs" role="tablist">{tabs.map(([value, title], index) => <button key={value} role="tab" aria-selected={(tab || tabs[0][0]) === value} className={(tab || tabs[0][0]) === value ? 'selected' : ''} onClick={() => { setTab(value); setSubmitted(''); setCategory(undefined); }}>{title}</button>)}</div>}<CatalogList resource={resource} props={props} onRetry={() => setRevision(n => n + 1)} open={open} gallery={family === 'pictures'} />{editor && <AlbumEditor props={props} onClose={() => setEditor(false)} onDone={() => { setEditor(false); setRevision(n => n + 1); }} />}</div>;
}

function configValues(config: Entity): Record<string, string> {
  const values: Record<string, string> = {};
  const labels: Record<string, string> = { title: '版本', price: '价格', cpu: '处理器', ram: '内存', release_time: '上市日期', phone_material: '机身材质', screen_material: '屏幕材质' };
  for (const [key, label] of Object.entries(labels)) if (config[key] != null && config[key] !== '') values[label] = plain(config[key]);
  let parsed = config.config_data;
  if (typeof parsed === 'string') try { parsed = JSON.parse(parsed); } catch { parsed = undefined; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) for (const [group, fields] of Object.entries(parsed)) if (fields && typeof fields === 'object' && !Array.isArray(fields)) for (const [name, value] of Object.entries(fields)) if (value != null && typeof value !== 'object') values[`${group} · ${name}`] = plain(value);
  return values;
}
type ProductTab = { key: string; title: string; kind: string; type?: string; subId?: string; url?: string };
// Detail tabList is authoritative: preserve its labels, order and numeric IDs.
function productTabs(productId: string, value: unknown): ProductTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 50).flatMap((entry: Entity, index) => {
    if (!entry || typeof entry !== 'object' || [0, '0', false].includes(entry.is_open ?? 1) || typeof entry.url !== 'string') return [];
    const title = plain(entry.title).trim().slice(0, 120), source = entry.url.trim();
    if (!title || !source || source.startsWith('//')) return [];
    try {
      const outer = new URL(source, 'https://www.coolapk.com');
      if (outer.origin !== 'https://www.coolapk.com' || outer.username || outer.password || outer.port) return [];
      if (outer.pathname === '/page' && outer.searchParams.getAll('url').length !== 1) return [];
      const inner = new URL(outer.pathname === '/page' ? outer.searchParams.get('url') || '' : source, 'https://www.coolapk.com');
      if (inner.origin !== outer.origin || inner.username || inner.password || inner.port) return [];
      let tab: ProductTab;
      if (inner.pathname === '/product/feedList') {
        if (inner.searchParams.getAll('id').length !== 1 || inner.searchParams.get('id') !== productId || inner.searchParams.getAll('type').length !== 1) return [];
        const type = inner.searchParams.get('type') || '';
        if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(type)) return [];
        if (type === 'main') tab = { key: 'server:config', title, kind: 'config' };
        else if (type === 'rating') tab = { key: 'server:ratings', title, kind: 'ratings' };
        else if (type === 'subTabFeed') {
          const subId = inner.searchParams.get('subId') || '';
          if (inner.searchParams.getAll('subId').length !== 1 || !/^\d{1,20}$/.test(subId)) return [];
          tab = { key: `server:subtab:${subId}`, title, kind: 'subtab', subId };
        } else tab = { key: `server:${type}`, title, kind: 'feeds', type };
      } else if (/^\/topic\/(?:list|tagList|tagFeedList)$/.test(inner.pathname)) {
        tab = { key: `server:page:${String(entry.page_name || index)}`, title, kind: 'page', url: source };
      } else return [];
      if (seen.has(tab.key)) return [];
      seen.add(tab.key); return [tab];
    } catch { return []; }
  });
}
const productTools: ProductTab[] = [['config', '参数对比'], ['versions', '可购买版本'], ['ratings', '评分'], ['trend', '评分趋势'], ['media', '媒体'], ['wishUsers', '想买的酷友'], ['buyUsers', '已买的酷友']].map(([key, title]) => ({ key, title, kind: key }));

function ProductCatalog(props: CatalogProps) {
  const [tab, setTab] = useState(''), [revision, setRevision] = useState(0), [compare, setCompare] = useState<Entity[]>([]), [configId, setConfigId] = useState(''), [configRevision, setConfigRevision] = useState(0), [review, setReview] = useState(false), [comparePicker, setComparePicker] = useState(false);
  const [ratingStar, setRatingStar] = useState('0'), [ratingOwner, setRatingOwner] = useState(false);
  const profile = useResource('catalogProduct', { id: props.page.id }, props.namespace, revision), product = profile.data?.data || {};
  const configs = rows(product.configRows), config = useResource(configId ? 'catalogProductConfig' : null, { id: configId }, props.namespace, configRevision);
  const serverTabs = productTabs(String(props.page.id), product.tabList), selected = [...serverTabs, ...productTools].find(item => item.key === tab) || serverTabs[0] || productTools[0], kind = selected.kind;
  const operation = kind === 'trend' ? 'catalogProductRatingChart' : kind === 'ratings' ? 'catalogProductRatings' : kind === 'versions' ? 'catalogProductVersions' : kind === 'media' ? 'catalogProductMedia' : kind === 'wishUsers' ? 'catalogProductWishUsers' : kind === 'buyUsers' ? 'catalogProductBuyUsers' : kind === 'subtab' ? 'catalogProductSubtab' : kind === 'feeds' ? 'catalogProductFeeds' : kind === 'page' ? 'page' : null;
  const args = kind === 'ratings' ? { id: props.page.id, star: Number(ratingStar), owner: ratingOwner } : kind === 'subtab' ? { id: props.page.id, subId: selected.subId } : kind === 'feeds' ? { id: props.page.id, type: selected.type } : kind === 'page' ? { url: selected.url } : kind === 'media' ? { id: props.page.id, type: 'image', recommended: 0 } : { id: props.page.id };
  const resource = useResource(profile.data ? operation : null, args, props.namespace, revision);
  const versionRows = resource.data && (Array.isArray(resource.data.data) ? resource.data.data : [resource.data.data?.entities, resource.data.data?.rows, resource.data.data?.list, resource.data.data?.data].find(Array.isArray));
  const validVersions = Array.isArray(versionRows) && versionRows.every(item => item && typeof item === 'object' && !Array.isArray(item) && /^\d{1,20}$/.test(String(item.id ?? item.config_id ?? '')));
  const versionError = kind === 'versions' && resource.data && !validVersions ? new ClientError('酷安返回的可购买版本结构异常', 'API_ERROR') : undefined;
  function selectTab(value: string) { setTab(value); setRatingStar('0'); setRatingOwner(false); }
  const action = useCatalogAction(props, () => setRevision(n => n + 1));
  useEffect(() => { if (!configs.some(item => ident(item) === configId)) setConfigId(configs.length ? ident(configs[0]) : ''); }, [profile.data]);
  async function addCompare() { if (!config.data?.data) return; setCompare(old => old.some(item => ident(item) === configId) ? old : [...old, { ...config.data!.data, id: configId }].slice(-4)); }
  const keys = [...new Set(compare.flatMap(item => Object.keys(configValues(item))))];
  return <div className="catalog-screen">{profile.error && <ErrorNotice error={profile.error} onRetry={() => setRevision(n => n + 1)} />}{profile.loading && !profile.data && <Skeleton />}{profile.data && <section className="profile-card"><Avatar src={product.logo || product.pic} name={plain(product.title || props.page.title)} size={72} /><div><h2>{plain(product.title || product.name || props.page.title)}</h2><p>{plain(product.description || product.intro || '')}</p><p className="muted">{product.rating_average_score && `${product.rating_average_score} 分`}{product.price_min && ` · ¥${product.price_min} 起`}{enabled(product.userAction?.buy) ? ' · 已买' : ''}</p></div><div className="catalog-actions"><button className="button secondary" disabled={action.locked} onClick={() => void action.perform('catalogProductWish', { id: props.page.id, status: enabled(product.userAction?.wish) ? 0 : 1 }, '想买状态已更新')}>{enabled(product.userAction?.wish) ? '已想买' : '想买'}</button><button className="button secondary" disabled={action.locked} onClick={() => void action.perform('catalogProductFollow', { id: props.page.id, status: enabled(product.userAction?.follow) ? 0 : 1 }, '关注状态已更新')}>{enabled(product.userAction?.follow) ? '已关注' : '关注'}</button><button className="button" onClick={() => props.account ? setReview(true) : props.onLogin()}><Star size={15} />评分与已买点评</button></div></section>}{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}{profile.data && serverTabs.length > 0 && <div className="tabs" role="tablist" aria-label="产品栏目">{serverTabs.map(item => <button key={item.key} role="tab" aria-selected={selected.key === item.key} className={selected.key === item.key ? 'selected' : ''} onClick={() => selectTab(item.key)}>{item.title}</button>)}</div>}{profile.data && !serverTabs.length && <p className="muted catalog-tab-status">服务端暂未提供可用的产品栏目。</p>}<div className="tabs catalog-tool-tabs" role="tablist" aria-label="产品功能">{productTools.map(item => <button key={item.key} role="tab" aria-selected={selected.key === item.key} className={selected.key === item.key ? 'selected' : ''} onClick={() => selectTab(item.key)}>{item.title}</button>)}</div>{kind === 'ratings' && <div className="catalog-toolbar catalog-rating-filters"><label>点评星级<select aria-label="点评星级" value={ratingStar} onChange={e => setRatingStar(e.target.value)}><option value="0">全部星级</option>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} 星</option>)}</select></label><label className="catalog-filter-check"><input type="checkbox" checked={ratingOwner} onChange={e => setRatingOwner(e.target.checked)} />仅看拥有者点评</label></div>}{kind === 'config' ? <><div className="catalog-toolbar"><select aria-label="产品版本配置" value={configId} onChange={e => setConfigId(e.target.value)}>{configs.map(item => <option key={ident(item)} value={ident(item)}>{plain(item.title || item.name || `版本 ${ident(item)}`)}</option>)}</select><button className="button secondary" disabled={!config.data} onClick={() => void addCompare()}>加入本次对比</button><button className="button secondary" onClick={() => setComparePicker(true)}>添加其他机型</button><button className="button secondary" disabled={!configId || action.locked} onClick={() => void action.perform('catalogCompareAdd', { id: configId }, '已加入账号对比列表')}>同步到账号对比</button><button className="text-button" disabled={!configId || action.locked} onClick={() => void action.perform('catalogCompareRemove', { id: configId }, '已移出账号对比列表')}>移出账号对比</button></div>{config.error && <ErrorNotice error={config.error} onRetry={() => setConfigRevision(n => n + 1)} />}{config.loading && <Skeleton />}{config.data && <dl className="catalog-specs">{Object.entries(configValues(config.data.data)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}{!configs.length && <Empty title="这个产品暂未提供版本参数" />}{compare.length > 0 && <div className="catalog-comparison"><table><thead><tr><th>参数</th>{compare.map(item => <th key={ident(item)}>{plain(item.title || `配置 ${ident(item)}`)}<button className="text-button" onClick={() => setCompare(old => old.filter(value => ident(value) !== ident(item)))}>移除</button></th>)}</tr></thead><tbody>{keys.map(key => <tr key={key} className={new Set(compare.map(item => configValues(item)[key] || '')).size > 1 ? 'different' : ''}><th>{key}</th>{compare.map(item => <td key={ident(item)}>{configValues(item)[key] || '—'}</td>)}</tr>)}</tbody></table></div>}</> : kind === 'versions' ? <>{(resource.error || versionError) && <ErrorNotice error={resource.error || versionError} onRetry={() => setRevision(n => n + 1)} />}{resource.loading && !resource.data && <Skeleton />}{!resource.loading && !resource.error && !versionError && resource.data && versionRows?.length === 0 && <Empty title="暂未提供可购买版本" />}{!versionError && versionRows && <div className="catalog-version-list">{versionRows.map((item: Entity, index: number) => <article key={String(item.id ?? item.config_id ?? index)}><strong>{plain(item.title || item.name || item.config_name || '产品版本')}</strong><span className="muted">配置编号 {String(item.id ?? item.config_id ?? '未提供')}</span>{item.price != null && <span>¥{plain(item.price)}</span>}</article>)}</div>}</> : kind === 'trend' ? <RatingTrend data={resource.data?.data} loading={resource.loading} error={resource.error} onRetry={() => setRevision(n => n + 1)} /> : <CatalogList resource={resource} props={props} onRetry={() => setRevision(n => n + 1)} open={props.openEntity} gallery={kind === 'media'} />}{comparePicker && <ComparePicker props={props} onClose={() => setComparePicker(false)} onSelect={item => { setCompare(old => old.some(value => ident(value) === ident(item)) ? old : [...old, item].slice(-4)); setComparePicker(false); }} />}{review && <ReviewEditor props={props} product={product} onClose={() => setReview(false)} onDone={() => { setReview(false); setRevision(n => n + 1); }} />}</div>;
}

function ComparePicker({ props, onClose, onSelect }: { props: CatalogProps; onClose: () => void; onSelect: (config: Entity) => void }) {
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [productId, setProductId] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState<ClientError>();
  const found = useResource(search ? 'search' : null, { query: search, type: 'product' }, props.namespace);
  const profile = useResource(productId ? 'catalogProduct' : null, { id: productId }, props.namespace);
  async function select(id: string) {
    setLoading(true); setError(undefined);
    try { const result = await call('catalogProductConfig', { id }); onSelect({ ...result.data, id }); }
    catch (e) { setError(e as ClientError); } finally { setLoading(false); }
  }
  return <Modal title="添加对比机型" onClose={onClose}><div className="catalog-form"><form className="catalog-search" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); setProductId(''); }}><input aria-label="搜索对比机型" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入另一款产品的名称" /><button className="button secondary">搜索机型</button></form>{(found.loading || profile.loading || loading) && <Skeleton />}{(error || found.error || profile.error) && <ErrorNotice error={error || found.error || profile.error} />}{!productId ? rows(found.data?.data).filter(item => item.entityType === 'product').map(item => <button className="button secondary" key={ident(item)} onClick={() => setProductId(ident(item))}>{plain(item.title || item.name)}</button>) : <><button className="text-button" onClick={() => setProductId('')}>返回搜索结果</button>{rows(profile.data?.data?.configRows).map(item => <button className="button secondary" disabled={loading} key={ident(item)} onClick={() => void select(ident(item))}>{plain(item.title || item.name || '选择此版本')}</button>)}{profile.data && !rows(profile.data.data?.configRows).length && <Empty title="此产品没有公开版本参数" />}</>}</div></Modal>;
}

function RatingTrend({ data, loading, error, onRetry }: { data: Entity | undefined; loading: boolean; error?: ClientError; onRetry: () => void }) {
  const [period, setPeriod] = useState('week'), [owners, setOwners] = useState(false), [metric, setMetric] = useState('score');
  const periodData = data?.[period], chart = owners ? periodData?.ownerRatingChart : periodData?.ratingChart || periodData?.ownerRatingChart;
  const points = rows(chart?.x).filter(item => item.score != null && Number.isFinite(Number(item.score)) && Number(item.score) > 0 && Number(item.score) <= 10 && Number(item.count) !== 0).slice(-100);
  const name = (item: Entity) => plain(item.datelineStr || item.startDate || item.dateline || '');
  const scores = points.map(item => Number(item.score)), axis = chart?.y?.[0];
  const minimum = metric === 'count' ? 0 : Number.isFinite(Number(axis?.min)) ? Math.min(Number(axis.min), ...scores) : 0;
  const maximum = metric === 'count' ? Math.max(1, ...points.map(item => Number(item.count) || 0)) : Math.max(Number.isFinite(Number(axis?.max)) ? Number(axis.max) : 10, ...scores);
  const yPosition = (item: Entity) => 170 - Math.max(0, Math.min(1, ((metric === 'count' ? Number(item.count) : Number(item.score)) - minimum) / Math.max(1, maximum - minimum))) * 140;
  const svgPoints = points.map((item, index) => `${20 + index * 540 / Math.max(1, points.length - 1)},${yPosition(item)}`).join(' ');
  return <div className="catalog-trend"><div className="catalog-toolbar"><select aria-label="评分趋势周期" value={period} onChange={e => setPeriod(e.target.value)}>{[['day', '日'], ['week', '周'], ['month', '月']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select><select aria-label="评分趋势指标" value={metric} onChange={e => setMetric(e.target.value)}><option value="score">平均分</option><option value="count">评分人数</option></select><label><input type="checkbox" checked={owners} onChange={e => setOwners(e.target.checked)} />仅看拥有者评分</label></div>{error && <ErrorNotice error={error} onRetry={onRetry} />}{loading && !data && <Skeleton />}{!loading && !error && !points.length && <Empty title="此周期尚无评分趋势数据" />}{points.length > 0 && <><svg viewBox="0 0 580 200" role="img" aria-label="评分趋势曲线"><line x1="20" y1="170" x2="560" y2="170" stroke="var(--border)" /><polyline points={svgPoints} fill="none" stroke="var(--accent)" strokeWidth="3" />{points.map((item, index) => <circle key={index} cx={20 + index * 540 / Math.max(1, points.length - 1)} cy={yPosition(item)} r="4" fill="var(--accent)"><title>{name(item)}：{Number(item.score).toFixed(2)} 分，{item.count ?? '—'} 人</title></circle>)}</svg><dl className="catalog-specs">{points.map((item, index) => <div key={index}><dt>{name(item)}</dt><dd>{Number(item.score).toFixed(2)} 分 · {item.count ?? '—'} 人</dd></div>)}</dl></>}</div>;
}

function ReviewEditor({ props, product, onClose, onDone }: { props: CatalogProps; product: Entity; onClose: () => void; onDone: () => void }) {
  const [score, setScore] = useState(Number(product.userAction?.rating) || 5), [message, setMessage] = useState(''), [bought, setBought] = useState(enabled(product.userAction?.buy));
  const action = useCatalogAction(props, onDone);
  return <Modal title="产品评分与点评" onClose={onClose}><form className="catalog-form" onSubmit={e => { e.preventDefault(); void action.perform('catalogProductReview', { id: props.page.id, score, message, bought }, '产品点评已发布'); }}><label>评分<select aria-label="产品评分" value={score} onChange={e => setScore(Number(e.target.value))} disabled={action.locked}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} 星</option>)}</select></label><label>使用感受<textarea aria-label="产品点评" rows={6} value={message} onChange={e => setMessage(e.target.value)} disabled={action.locked} maxLength={10000} /></label><label className="catalog-check"><input type="checkbox" checked={bought} onChange={e => setBought(e.target.checked)} disabled={action.locked} />我已经购买这款产品</label>{action.error && <ErrorNotice error={action.error} onRetry={action.retry} />}<button className="button" disabled={action.locked || !message.trim()}>发布点评</button><button type="button" className="text-button" disabled={action.locked} onClick={() => void action.perform('catalogRating', { id: props.page.id, value: 0 }, '已取消评分')}>取消我的评分</button></form></Modal>;
}

function AppCatalog(props: CatalogProps) {
  const [tab, setTab] = useState('info'), [revision, setRevision] = useState(0), [message, setMessage] = useState(''), [rating, setRating] = useState(5), [commentSort, setCommentSort] = useState('lastupdate_desc');
  const profile = useResource('catalogApp', { id: props.page.id }, props.namespace, revision), app = profile.data?.data || {};
  const operations: Record<string, string> = { comments: 'catalogAppComments', node: 'nodeAppFeeds', versions: 'catalogAppVersions', related: 'catalogAppRelated', discoverers: 'catalogAppDiscoverers', ratings: 'catalogAppRatings', gifts: 'catalogAppGifts', developer: 'catalogAppDeveloper' };
  const resource = useResource(operations[tab] || null, tab === 'node' ? { id: props.page.id, sort: 'lastupdate_desc' } : tab === 'comments' ? { id: props.page.id, sort: commentSort } : { id: props.page.id, developer: app.developer || app.developerName || '' }, props.namespace, revision);
  const action = useCatalogAction(props, () => { setMessage(''); setRevision(n => n + 1); });
  const packageName = String(app.packageName || props.page.id);
  return <div className="catalog-screen">{profile.error && <ErrorNotice error={profile.error} onRetry={() => setRevision(n => n + 1)} />}{profile.loading && !profile.data && <Skeleton />}{profile.data && <section className="profile-card"><Avatar src={app.logo || app.icon} name={plain(app.appName || app.title || props.page.title)} size={72} /><div><h2>{plain(app.appName || app.title || props.page.title)}</h2><p>{plain(app.shortDescription || app.intro || '')}</p></div><button className="button secondary" disabled={action.locked} onClick={() => void action.perform(enabled(app.userAction?.favorite) ? 'catalogAppUnfavorite' : 'catalogAppFavorite', { id: packageName }, '应用收藏已更新')}>{enabled(app.userAction?.favorite) ? '已收藏' : '收藏应用'}</button><AppDownload packageName={packageName} title={plain(app.appName || app.title || props.page.title)} namespace={props.namespace} onLogin={props.onLogin} toast={props.toast} onQueued={() => props.go({ kind: 'downloads', title: '应用下载' })} /><button className="text-button" onClick={() => void window.coolapk?.openExternal(`https://www.coolapk.com/apk/${packageName}`)}>官方下载页</button></section>}{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}<div className="tabs" role="tablist">{[['info', '信息'], ['comments', '点评'], ['node', '节点讨论'], ['versions', '历史版本'], ['related', '相关应用'], ['discoverers', '发现者'], ['ratings', '评分酷友'], ['gifts', '礼包'], ['developer', '开发者应用']].map(([value, title]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{title}</button>)}</div>{tab === 'comments' && <div className="catalog-toolbar"><label htmlFor="app-comment-sort">点评排序</label><select id="app-comment-sort" aria-label="应用点评排序" value={commentSort} onChange={e => setCommentSort(e.target.value)}><option value="lastupdate_desc">最近回复</option><option value="dateline_desc">最新发布</option><option value="popular">热门</option></select></div>}{tab === 'info' ? <><div className="catalog-toolbar"><select aria-label="应用评分" value={rating} onChange={e => setRating(Number(e.target.value))} disabled={action.locked}>{[5,4,3,2,1].map(value => <option key={value} value={value}>{value} 星</option>)}</select><button className="button secondary" disabled={action.locked} onClick={() => void action.perform('catalogRating', {id: props.page.id, value: rating}, '应用评分已保存')}>保存应用评分</button><button className="text-button" disabled={action.locked} onClick={() => void action.perform('catalogRating', {id: props.page.id, value: 0}, '应用评分已取消')}>取消应用评分</button></div><dl className="catalog-specs">{[['版本', app.apkversion || app.versionName], ['包名', packageName], ['开发者', app.developer || app.developerName], ['大小', app.apksize || app.size], ['下载量', app.downCount || app.downloadCount], ['评分', app.rating]].filter(([, value]) => value != null).map(([title, value]) => <div key={String(title)}><dt>{title}</dt><dd>{plain(value)}</dd></div>)}</dl><RichText text={app.description || app.introduce || app.intro} onLink={props.feedProps.onLink} />{rows(app.screenshots || app.screenshotList).length > 0 && <div className="catalog-gallery">{rows(app.screenshots || app.screenshotList).map((item, index) => <Picture key={index} src={secureUrl(typeof item === 'string' ? item : item.url || item.pic)} alt={`应用截图 ${index + 1}`} />)}</div>}</> : <CatalogList resource={resource} props={props} onRetry={() => setRevision(n => n + 1)} open={item => item.entityType === 'apk' || item.packageName ? props.go({ kind: 'catalog', type: 'app', id: String(item.packageName || ident(item)), title: plain(item.title || item.appName) }) : props.openEntity(item)} />}{tab === 'comments' && <form className="catalog-form" onSubmit={e => { e.preventDefault(); void action.perform('catalogAppComment', { id: props.page.id, message }, '应用评价已发布'); }}><label>发表应用评价<textarea aria-label="应用评价" rows={3} value={message} onChange={e => setMessage(e.target.value)} disabled={action.locked} /></label><button className="button" disabled={action.locked || !message.trim()}>发布评价</button></form>}</div>;
}

function AlbumEditor({ props, album, onClose, onDone }: { props: CatalogProps; album?: Entity; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(plain(album?.title)), [intro, setIntro] = useState(plain(album?.intro || album?.description)), [cover, setCover] = useState(String(album?.cover || album?.pic || ''));
  const action = useCatalogAction(props, onDone);
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState<ClientError>();
  const generation = useRef(0), reading = useRef(false);
  const pending = useRef<{ bytes: Uint8Array; width: number; height: number } | undefined>(undefined);
  useEffect(() => () => { generation.current++; pending.current = undefined; reading.current = false; }, []);
  const cancelUpload = () => { generation.current++; pending.current = undefined; reading.current = false; setUploading(false); setUploadError(undefined); };
  async function upload(payload: NonNullable<typeof pending.current>, current: number) {
    if (current !== generation.current || pending.current !== payload) return;
    reading.current = true; setUploading(true); setUploadError(undefined);
    try {
      const result = await call('uploadImage', { bytes: payload.bytes, width: payload.width, height: payload.height, dir: 'album' });
      if (current !== generation.current || pending.current !== payload) return;
      if (typeof result.data !== 'string' || !result.data) throw new ClientError('封面上传未返回图片地址', 'API_ERROR');
      setCover(result.data); pending.current = undefined;
    } catch (error) { if (current === generation.current) setUploadError(error instanceof ClientError ? error : new ClientError('封面上传失败，请重新选择图片', 'INPUT')); }
    finally { if (current === generation.current) { reading.current = false; setUploading(false); } }
  }
  async function selectCover(file?: File) {
    if (!file || action.locked || reading.current || uploadError) return;
    if (!props.account) return props.onLogin();
    const current = ++generation.current; reading.current = true; setUploading(true); setUploadError(undefined);
    let bitmap: ImageBitmap | undefined;
    try {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) throw new ClientError('请选择不超过 20 MB 的 JPG、PNG、GIF 或 WebP 图片', 'INPUT');
      bitmap = await createImageBitmap(file);
      const width = bitmap.width, height = bitmap.height;
      bitmap.close(); bitmap = undefined;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (current !== generation.current) return;
      const payload = { bytes, width, height }; pending.current = payload;
      await upload(payload, current);
    } catch (error) { if (current === generation.current) setUploadError(error instanceof ClientError ? error : new ClientError('无法读取封面图片，请重新选择', 'INPUT')); }
    finally { bitmap?.close(); if (current === generation.current) { reading.current = false; setUploading(false); } }
  }
  const uploadAttempt = pending.current, uploadGeneration = generation.current;
  const retryUpload = uploadAttempt ? () => { if (!reading.current) void upload(uploadAttempt, uploadGeneration); } : undefined;
  const uploadLocked = uploading || !!uploadError, close = () => { cancelUpload(); onClose(); };
  return <Modal title={album ? '编辑应用集' : '创建应用集'} onClose={close}><form className="catalog-form" onSubmit={e => { e.preventDefault(); if (action.locked || uploadLocked || !title.trim()) return; void action.perform(album ? 'catalogAlbumEdit' : 'catalogAlbumCreate', { ...(album ? { id: ident(album) } : {}), title, intro, cover }, '应用集已保存'); }}><label>应用集名称<input aria-label="应用集名称" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} disabled={action.locked} /></label><label>介绍<textarea aria-label="应用集介绍" value={intro} onChange={e => setIntro(e.target.value)} rows={4} maxLength={2000} disabled={action.locked} /></label><label>封面图片<input aria-label="应用集封面" value={cover} onChange={e => setCover(e.target.value)} placeholder="酷安图片地址，可留空" disabled={action.locked || uploadLocked} /></label><label>选择本地封面<input type="file" aria-label="选择应用集封面图片" accept="image/jpeg,image/png,image/gif,image/webp" disabled={action.locked || uploadLocked} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void selectCover(file); }} /><span className="muted">JPG、PNG、GIF 或 WebP，最大 20 MB；上传完成后保存应用集。</span></label>{uploading && <p role="status">正在上传应用集封面…</p>}{uploadError && <ErrorNotice error={uploadError} onRetry={retryUpload} onLogin={props.onLogin} />}{uploadLocked && <button type="button" className="text-button" onClick={cancelUpload}>取消本次封面上传</button>}{action.error && <ErrorNotice error={action.error} onRetry={action.retry} />}<button className="button" disabled={action.locked || uploadLocked || !title.trim()}>保存应用集</button></form></Modal>;
}
function AlbumCatalog(props: CatalogProps) {
  const [revision, setRevision] = useState(0), [tab, setTab] = useState('apps'), [editor, setEditor] = useState(false), [adding, setAdding] = useState(false), [remove, setRemove] = useState<Entity>(), [packageName, setPackageName] = useState(''), [name, setName] = useState(''), [note, setNote] = useState('');
  const profile = useResource('catalogAlbum', { id: props.page.id }, props.namespace, revision), album = profile.data?.data || {};
  const replies = useResource(tab === 'comments' ? 'catalogAlbumReplies' : null, { id: props.page.id }, props.namespace, revision);
  const action = useCatalogAction(props, () => setRevision(n => n + 1));
  const own = String(album.uid ?? album.userInfo?.uid) === props.account?.uid;
  const appList = [album.apkList, album.apks, album.entities, album.data].find(Array.isArray), apps = rows(appList);
  return <div className="catalog-screen">{profile.error && <ErrorNotice error={profile.error} onRetry={() => setRevision(n => n + 1)} />}{profile.loading && !profile.data && <Skeleton />}{profile.data && <section className="profile-card"><Avatar src={album.cover || album.pic} name={plain(album.title || props.page.title)} size={72} /><div><h2>{plain(album.title || props.page.title)}</h2><p>{plain(album.intro || album.description)}</p></div>{own && <><button className="button secondary" onClick={() => setEditor(true)}>编辑应用集</button><button className="button" onClick={() => setAdding(true)}>添加应用</button></>}</section>}{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}<div className="tabs" role="tablist">{[['apps', '应用'], ['comments', '评论']].map(([value, title]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{title}</button>)}</div>{tab === 'comments' ? <CatalogList resource={replies} props={props} onRetry={() => setRevision(n => n + 1)} open={props.openEntity} /> : apps.length ? apps.map((app, index) => <div className="catalog-album-row" key={app.packageName || index}><EntityCard entity={{ ...app, entityType: 'apk' }} onOpen={() => props.go({ kind: 'catalog', type: 'app', id: String(app.packageName || ident(app)), title: plain(app.title || app.appName) })} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} />{own && <button className="text-button danger" disabled={action.locked} onClick={() => setRemove(app)}>移除应用</button>}</div>) : !profile.loading && <Empty title={appList ? "应用集还没有内容" : "应用列表暂不可用"} message={appList ? "可以向自己的应用集添加应用。" : "此应用集详情没有返回应用明细，请稍后重试或在官方页面查看。"} />}{editor && <AlbumEditor props={props} album={album} onClose={() => setEditor(false)} onDone={() => { setEditor(false); setRevision(n => n + 1); }} />}{adding && <Modal title="添加应用到应用集" onClose={() => setAdding(false)}><form className="catalog-form" onSubmit={e => { e.preventDefault(); void action.perform('catalogAlbumAddApp', { id: props.page.id, packageName, title: name, note }, '应用已添加', () => { setAdding(false); setPackageName(''); setName(''); setNote(''); }); }}><label>应用包名<input aria-label="应用包名" value={packageName} onChange={e => setPackageName(e.target.value)} disabled={action.locked} placeholder="com.example.app" /></label><label>应用名称<input aria-label="应用名称" value={name} onChange={e => setName(e.target.value)} disabled={action.locked} /></label><label>推荐理由<textarea aria-label="推荐理由" value={note} onChange={e => setNote(e.target.value)} disabled={action.locked} /></label>{action.error && <ErrorNotice error={action.error} onRetry={action.retry} />}<button className="button" disabled={action.locked || !packageName || !name}>确认添加</button></form></Modal>}{remove && <Modal title="移除应用" onClose={() => setRemove(undefined)}><div className="catalog-form"><p>确认从应用集中移除“{plain(remove.title || remove.packageName)}”？</p>{action.error && <ErrorNotice error={action.error} onRetry={action.retry} />}<button className="button danger" disabled={action.locked} onClick={() => void action.perform('catalogAlbumRemoveApp', { id: props.page.id, packageName: String(remove.packageName || remove.package_name) }, '应用已移出', () => setRemove(undefined))}>确认移除应用</button></div></Modal>}</div>;
}
function EditorialCatalog(props: CatalogProps) {
  const isDyh = props.page.type === 'dyh', [tab, setTab] = useState('all'), [revision, setRevision] = useState(0);
  const profile = useResource(isDyh ? 'catalogDyh' : 'catalogEvent', { id: props.page.id }, props.namespace, revision), info = profile.data?.data || {};
  const resource = useResource(isDyh ? 'catalogDyhFeeds' : null, { id: props.page.id, type: tab }, props.namespace, revision);
  const action = useCatalogAction(props, () => setRevision(n => n + 1));
  const external = secureUrl(info.url || info.link);
  return <div className="catalog-screen">{profile.error && <ErrorNotice error={profile.error} onRetry={() => setRevision(n => n + 1)} />}{profile.loading && !profile.data && <Skeleton />}{profile.data && <section className="profile-card"><Avatar src={info.logo || info.pic} name={plain(info.title || info.dyh_name || props.page.title)} size={72} /><div><h2>{plain(info.title || info.dyh_name || props.page.title)}</h2><p>{plain(info.description || info.intro || '')}</p></div>{isDyh ? <button className="button" disabled={action.locked} onClick={() => void action.perform((enabled(info.isFollow) || enabled(info.userAction?.follow)) ? 'catalogDyhUnfollow' : 'catalogDyhFollow', { id: props.page.id }, '关注状态已更新')}>{(enabled(info.isFollow) || enabled(info.userAction?.follow)) ? '已关注' : '关注酷安号'}</button> : external && <button className="button" onClick={() => void window.coolapk?.openExternal(external)}>查看活动参与页面</button>}</section>}{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}{isDyh ? <><div className="tabs" role="tablist">{[['all', '文章'], ['square', '广场']].map(([value, title]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{title}</button>)}</div><CatalogList resource={resource} props={props} onRetry={() => setRevision(n => n + 1)} open={props.openEntity} /></> : <RichText text={info.message || info.description || info.intro || ''} onLink={props.feedProps.onLink} />}</div>;
}
