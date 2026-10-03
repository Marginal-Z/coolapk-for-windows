import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, Tags } from 'lucide-react';
import { Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Modal, Picture, Skeleton } from './components';
import { isFeedEntity } from './Community';
import { call, ClientError, plain, secureUrl } from './data';
import { parseSecondhandRoute, secondhandDescriptor, secondhandEntityTarget, secondhandFilters } from '../core/secondhand-routes.mjs';
import type { GoodsProps } from './Goods';
import type { Entity, Result } from './types';
import './secondhand.css';

export type SecondhandProps = GoodsProps;
const idOf = (item: Entity) => String(item.id ?? item.entityId ?? '');
const titleOf = (item: Entity) => plain(item.title || item.name || item.label || item.product_name || '闲置型号');
const rows = (value: any): Entity[] => Array.isArray(value) ? value : [];
const first = (...values: any[]) => values.find(value => value != null && String(value) !== '') ?? '';
const childrenOf = (items: Entity[], depth = 0): Entity[] => depth > 8 ? [] : items.flatMap(item => [item, ...(Array.isArray(item.entities) ? childrenOf(item.entities, depth + 1) : [])]);
const entityKey = (item: Entity) => `${item.entityType || item.entityTemplate || ''}:${item.id ?? item.entityId ?? item.url ?? JSON.stringify(item)}`;
// Discovery paging carries the server pageContext as well as item cursors.
function useSecondhandResource(operation: string | null, args: Entity, namespace: string, revision = 0) {
  const key = namespace + ':' + operation + ':' + JSON.stringify(args), sequence = useRef(0), inFlight = useRef(false), active = useRef(false), latestKey = useRef(key);
  latestKey.current = key;
  const failedMore = useRef<{ key: string; args: Entity } | undefined>(undefined);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<{ key: string; data?: Result; loading: boolean; error?: ClientError; page: number }>({ key, loading: !!operation, page: 1 });
  useEffect(() => {
    const current = ++sequence.current; inFlight.current = !!operation; active.current = !!operation; failedMore.current = undefined;
    setState(old => ({ key, data: old.key === key ? old.data : undefined, loading: !!operation, page: 1 }));
    if (!operation) return;
    call(operation, args).then(data => { if (current === sequence.current) setState({ key, data, loading: false, page: 1 }); }).catch(error => { if (current === sequence.current) setState(old => ({ ...old, loading: false, error })); }).finally(() => { if (current === sequence.current) inFlight.current = false; });
    return () => { sequence.current++; active.current = false; };
  }, [key, revision, retryVersion]);
  async function more() {
    if (!operation || !active.current || latestKey.current !== key || inFlight.current || state.key !== key || state.data?.hasMore === false) return;
    const nextArgs = failedMore.current?.key === key ? failedMore.current.args : { ...args, page: state.page + 1, firstItem: state.data?.firstItem, lastItem: state.data?.lastItem, ...(state.data?.pageContext ? { pageContext: state.data.pageContext } : {}) };
    const current = sequence.current; inFlight.current = true; setState(old => ({ ...old, loading: true, error: undefined }));
    try {
      const next = await call(operation, nextArgs);
      if (current !== sequence.current) return;
      const known = new Set(rows(state.data?.data).map(entityKey)), incoming = rows(next.data), added = incoming.filter(item => !known.has(entityKey(item)));
      const data = { ...next, data: [...rows(state.data?.data), ...added], firstItem: state.data?.firstItem || next.firstItem, hasMore: next.hasMore !== false && incoming.length > 0 && added.length > 0 };
      failedMore.current = undefined; setState({ key, data, loading: false, page: state.page + 1 });
    } catch (error) { if (current === sequence.current) { failedMore.current = { key, args: nextArgs }; setState(old => ({ ...old, loading: false, error: error as ClientError })); } }
    finally { if (current === sequence.current) inFlight.current = false; }
  }
  function retry() {
    if (!active.current || latestKey.current !== key || inFlight.current) return;
    if (failedMore.current?.key === key) void more(); else setRetryVersion(value => value + 1);
  }
  return { ...(state.key === key ? state : { key, loading: !!operation, data: undefined, error: undefined }), more, retry };
}

export default function SecondhandScreen(props: SecondhandProps) {
  if (props.page.url && !parseSecondhandRoute(props.page.url)) return <Empty title="闲置筛选链接暂不可用" message="此链接包含尚未确认的筛选字段，请从品牌与型号重新选择。" />;
  return <SecondhandPage key={`${props.namespace}:${props.page.type || 'home'}:${props.page.url || ''}`} {...props} />;
}
function SecondhandPage(props: SecondhandProps) {
  const [picker, setPicker] = useState(false), [query, setQuery] = useState(''), [keyword, setKeyword] = useState('');
  const parsed = props.page.url ? parseSecondhandRoute(props.page.url) : null;
  const initial = parsed?.type === 'list' ? parsed.filters : secondhandFilters({});
  const [selected, setSelected] = useState(initial);
  const home = useSecondhandResource('secondhandHome', {}, props.namespace);
  const listing = props.page.type === 'list' || parsed?.type === 'list';
  const resource = useSecondhandResource(keyword ? 'secondhandSearch' : listing ? 'secondhandListings' : null, keyword ? { keyword, productId: selected.productId, ershouType: selected.ershouType } : { filters: initial, title: props.page.title }, props.namespace);
  const visible = keyword || listing ? resource : home;
  const homeEntities = childrenOf(rows(home.data?.data));
  const categories = homeEntities.filter(item => /mainershoutype|mainershou|mainsecondhandtype/i.test(`${item.entityType || ''} ${item.entityTemplate || ''}`));
  const cities = [...new Map(homeEntities.filter(item => first(item.cityId, item.city_id) !== '' && first(item.cityTitle, item.city_name, item.cityName, item.title) !== '').map(item => [String(first(item.cityId, item.city_id)), { id: String(first(item.cityId, item.city_id)), title: plain(first(item.cityTitle, item.city_name, item.cityName, item.title)) }])).values()];
  function goList(filters: Entity, title = '闲置交易') { props.go({ kind: 'secondhand', type: 'list', url: secondhandDescriptor(filters), title }); }
  function open(item: Entity) {
    const target = secondhandEntityTarget(item);
    if (target?.type === 'list') goList(target.filters, titleOf(item));
    else if (target?.type === 'home') props.go({ kind: 'secondhand', type: 'home', title: '二手市场' });
    else props.openEntity(item);
  }
  if (props.page.type === 'brands') return <BrandBrowser props={props} onSelect={(filters, title) => goList(filters, title)} />;
  return <section className="secondhand-screen">
    <div className="secondhand-heading"><div><h2>{listing ? props.page.title || '闲置交易' : '二手市场'}</h2><p>浏览酷友闲置，按品牌和型号查找。</p></div><div className="secondhand-toolbar">
      {listing && <button className="text-button" onClick={() => props.go({ kind: 'secondhand', type: 'home', title: '二手市场' })}><ArrowLeft size={15} />二手市场</button>}
      <button className="button secondary" onClick={() => setPicker(true)}><Tags size={16} />品牌与型号</button>
    </div></div>
    <form className="secondhand-search" onSubmit={event => { event.preventDefault(); setKeyword(query.trim()); }}><input aria-label="搜索闲置" placeholder="搜索闲置名称" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /><button className="button secondary"><Search size={15} />搜索闲置</button>{keyword && <button type="button" className="text-button" onClick={() => { setQuery(''); setKeyword(''); }}>清除搜索</button>}</form>
    <form className="secondhand-filters" onSubmit={event => { event.preventDefault(); setQuery(''); setKeyword(''); goList(selected, selected.productId ? props.page.title : '闲置交易'); }}>
      <label>品类<select aria-label="闲置品类" value={selected.ershouType} onChange={event => setSelected(old => ({ ...old, productId: '', brand: '', ershouType: event.target.value }))}><option value="">全部品类</option>{categories.map(item => { const target = secondhandEntityTarget(item); return target?.type === 'list' ? <option key={idOf(item)} value={target.filters.ershouType}>{titleOf(item)}</option> : null; })}{selected.ershouType && !categories.some(item => secondhandEntityTarget(item)?.filters?.ershouType === selected.ershouType) && <option value={selected.ershouType}>{selected.productId ? '已选型号品类' : '已选品类'}</option>}</select></label>
      <label>城市<select aria-label="闲置城市" value={selected.cityId} disabled={!!keyword} onChange={event => setSelected(old => ({ ...old, cityId: event.target.value }))}><option value="">全部城市</option>{cities.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}{selected.cityId && !cities.some(item => item.id === selected.cityId) && <option value={selected.cityId}>指定城市</option>}</select></label>
      <button className="button secondary" disabled={!!keyword}>应用筛选</button>
      {(selected.productId || selected.brand || selected.cityId || selected.ershouType) && <button type="button" className="text-button" onClick={() => { setQuery(''); setKeyword(''); goList(secondhandFilters({})); }}>重置全部筛选</button>}
      {selected.productId && <span className="secondhand-selection">当前型号：{props.page.title || '已选型号'}</span>}
    </form>
    {keyword && <p className="muted secondhand-caption">搜索保留当前型号和品类；城市筛选可在清除搜索后使用。</p>}
    {visible.error && <ErrorNotice error={visible.error} onRetry={visible.retry} />}
    {visible.loading && !visible.data && <Skeleton />}
    {!visible.loading && !visible.error && visible.data && !rows(visible.data.data).length && <Empty title={keyword ? '没有找到匹配闲置' : '暂时没有闲置内容'} />}
    <div className="secondhand-results">{rows(visible.data?.data).map((item, index) => isFeedEntity(item) ? <FeedCard key={idOf(item) || index} feed={item} {...props.feedProps} /> : <SecondhandEntity key={idOf(item) || index} item={item} feedProps={props.feedProps} onOpen={open} />)}</div>
    {visible.data && <LoadMore loading={visible.loading} hasMore={visible.data?.hasMore} onClick={visible.more} />}
    {picker && <Modal title="选择闲置品牌与型号" onClose={() => setPicker(false)} wide><BrandBrowser props={props} onSelect={(filters, title) => { setPicker(false); goList({ ...filters, cityId: selected.cityId || filters.cityId }, title); }} /></Modal>}
  </section>;
}
function SecondhandEntity({ item, onOpen, feedProps, depth = 0 }: { item: Entity; onOpen: (item: Entity) => void; feedProps: any; depth?: number }) {
  const source = secureUrl(item.logo || item.pic || item.cover || item.icon);
  if (depth < 8 && Array.isArray(item.entities)) return <section className="secondhand-entity-group">{item.title && <h3 className="secondhand-section-title">{titleOf(item)}</h3>}<div className="secondhand-model-grid">{item.entities.map((child: Entity, index: number) => <SecondhandEntity item={child} key={entityKey(child) || index} feedProps={feedProps} onOpen={onOpen} depth={depth + 1} />)}</div></section>;
  const header = /^(?:title|titleCard|entityTitle|sectionHeader)|productGroupTitle|series[-_]title/i.test(`${item.entityType || ''} ${item.entityTemplate || ''}`);
  if (header && !item.url) return <h3 className="secondhand-section-title">{titleOf(item)}</h3>;
  if (!source) return <EntityCard entity={item} onOpen={onOpen} onUser={feedProps.onUser} onLink={feedProps.onLink} />;
  return <button className="secondhand-model" onClick={() => onOpen(item)}><Picture src={source} alt={titleOf(item)} /><span><strong>{titleOf(item)}</strong>{(item.description || item.subTitle) && <small>{plain(item.description || item.subTitle)}</small>}{first(item.ershou_num, item.ershouNum, item.productNum, item.product_num) !== '' && <small>{plain(first(item.ershou_num, item.ershouNum, item.productNum, item.product_num))} 件闲置</small>}</span></button>;
}
function BrandBrowser({ props, onSelect }: { props: SecondhandProps; onSelect: (filters: Entity, title: string) => void }) {
  const [brand, setBrand] = useState<Entity>();
  const brands = useSecondhandResource('secondhandBrands', {}, props.namespace);
  const products = useSecondhandResource(brand ? 'secondhandProducts' : null, { brandId: brand ? idOf(brand) : '', listType: String(brand?.type || 'recommend') }, props.namespace);
  useEffect(() => { if (!brand && rows(brands.data?.data).length) setBrand(brands.data!.data[0]); }, [brands.data]);
  return <div className="secondhand-browser">
    <aside><h3>品牌</h3>{brands.error && <ErrorNotice error={brands.error} onRetry={brands.retry} />}{brands.loading && !brands.data && <Skeleton />}{!brands.loading && !brands.error && brands.data && !rows(brands.data.data).length && <Empty title="暂无闲置品牌" />}<nav aria-label="闲置品牌列表">{rows(brands.data?.data).map(item => <button key={idOf(item)} aria-pressed={idOf(brand || {}) === idOf(item)} className={idOf(brand || {}) === idOf(item) ? 'selected' : ''} onClick={() => setBrand(item)}>{titleOf(item)}</button>)}</nav></aside>
    <div className="secondhand-models"><h3>{brand ? titleOf(brand) + ' · 型号' : '选择品牌查看型号'}</h3>{products.error && <ErrorNotice error={products.error} onRetry={products.retry} />}{products.loading && !products.data && <Skeleton />}{!products.loading && !products.error && products.data && !rows(products.data.data).length && <Empty title="该品牌暂无闲置型号" />}<div className="secondhand-model-grid">{rows(products.data?.data).map((item, index) => <SecondhandEntity key={idOf(item) || index} item={item} feedProps={props.feedProps} onOpen={selectedItem => { const target = secondhandEntityTarget(selectedItem, idOf(brand || {}), true); if (target?.type === 'list') onSelect(target.filters, titleOf(selectedItem)); else props.openEntity(selectedItem); }} />)}</div>{brand && products.data && <LoadMore loading={products.loading} hasMore={products.data.hasMore} onClick={products.more} />}</div>
  </div>;
}
