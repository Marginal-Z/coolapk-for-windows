import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Archive, ChevronRight, List, Newspaper, Plus, RefreshCw, Search, Shield, Smartphone, Trash2 } from 'lucide-react';
import { PERSONAL_ENTRIES, PERSONAL_PRODUCT_TABS, homeBlockChange, homeBlockIncludes, homeNodeChoice, personalProductTarget, type HomeBlockConfig, type HomeBlockRule } from '../core/personal-models.mjs';
import { type GoodsProps } from './Goods';
import { Avatar, Empty, EntityCard, ErrorNotice, LoadMore, Modal, Skeleton } from './components';
import { useInteraction } from './Community';
import { call, ClientError, count, plain, refreshResources, relativeTime, useResource } from './data';
import type { Entity, Result } from './types';
import './personal.css';

export type PersonalProps = GoodsProps;
const rows = (value: unknown): Entity[] => Array.isArray(value) ? value : [];
const rowKey = (row: Entity, index = 0) => `${row.entityType || ''}:${row.id ?? row.entityId ?? row.productId ?? index}`;

function usePersonalResource(operation: string | null, args: Entity, namespace: string, revision: number) {
  const scope = `${namespace}:${operation}:${JSON.stringify(args)}:${revision}`;
  const sequence = useRef(0), active = useRef(false), inFlight = useRef(false), latestScope = useRef(scope);
  latestScope.current = scope;
  const failed = useRef<{ scope: string; args: Entity } | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<{ scope: string; data?: Result; loading: boolean; error?: ClientError; page: number }>({ scope, loading: true, page: 1 });
  const latestState = useRef(state); latestState.current = state;
  useEffect(() => {
    const current = ++sequence.current; active.current = !!operation; inFlight.current = !!operation; failed.current = null;
    setState(old => ({ scope, data: old.scope === scope ? old.data : undefined, loading: !!operation, page: 1 }));
    if (operation) call(operation, args).then(data => { if (active.current && current === sequence.current && latestScope.current === scope) setState({ scope, data, loading: false, page: 1 }); })
      .catch(error => { if (active.current && current === sequence.current && latestScope.current === scope) setState(old => ({ ...old, loading: false, error })); })
      .finally(() => { if (current === sequence.current) inFlight.current = false; });
    return () => { active.current = false; sequence.current++; };
  }, [scope, retryVersion]);
  const generation = sequence.current;
  const current = () => active.current && latestScope.current === scope && generation === sequence.current && latestState.current === state && state.scope === scope;
  async function more() {
    if (!operation || !current() || inFlight.current || state.loading || !state.data || state.data.hasMore === false) return;
    const nextArgs = failed.current?.scope === scope ? failed.current.args : { ...args, page: state.page + 1, firstItem: state.data.firstItem, lastItem: state.data.lastItem, ...(['personalProductFollowing', 'personalNodePicker', 'personalDyhRecommendations'].includes(operation) && state.data.pageContext ? { pageContext: state.data.pageContext } : {}) };
    const request = sequence.current; inFlight.current = true; setState(old => ({ ...old, loading: true, error: undefined }));
    try {
      const next = await call(operation, nextArgs);
      if (!active.current || latestScope.current !== scope || request !== sequence.current) return;
      const existing = rows(state.data.data), incoming = rows(next.data), known = new Set(existing.map(rowKey));
      const added = incoming.filter((row, index) => !known.has(rowKey(row, index)));
      failed.current = null;
      const sections: Entity[] = [];
      if (operation === 'personalDyhRecommendations') {
        for (const group of [...rows(state.data.sections), ...rows(next.sections)]) {
          const previous = sections.find(section => section.url === group.url && section.title === group.title);
          if (previous) { const seen = new Set(rows(previous.entities).map(rowKey)); previous.entities = [...rows(previous.entities), ...rows(group.entities).filter(item => !seen.has(rowKey(item)))]; }
          else sections.push({ ...group, entities: [...rows(group.entities)] });
        }
      }
      setState({ scope, data: { ...next, data: [...existing, ...added], ...(operation === 'personalDyhRecommendations' ? { sections } : {}), firstItem: state.data.firstItem || next.firstItem, hasMore: next.hasMore !== false && incoming.length > 0 && added.length > 0 }, loading: false, page: state.page + 1 });
    } catch (error) {
      if (active.current && latestScope.current === scope && request === sequence.current) { failed.current = { scope, args: nextArgs }; setState(old => ({ ...old, loading: false, error: error as ClientError })); }
    } finally { if (request === sequence.current) inFlight.current = false; }
  }
  function retry() {
    if (!current() || inFlight.current) return;
    if (failed.current?.scope === scope) void more(); else setRetryVersion(value => value + 1);
  }
  return { ...(state.scope === scope ? state : { scope, loading: true, page: 1, data: undefined, error: undefined }), retry, more };
}

export function PersonalHub({ go }: { go: PersonalProps['go'] }) {
  const icons = { products: Smartphone, dyhs: Newspaper, lists: List, backups: Archive, blocks: Shield };
  return <div className="personal-hub">{PERSONAL_ENTRIES.map(entry => { const Icon = icons[entry.id as keyof typeof icons]; return <button key={entry.id} onClick={() => go({ ...entry.page })}><Icon size={23} /><span><strong>{entry.title}</strong><small>{entry.description}</small></span><ChevronRight size={17} /></button>; })}</div>;
}

export default function PersonalScreen(props: PersonalProps) {
  if (props.page.type === 'hub' || !props.page.type) return <PersonalHub go={props.go} />;
  if (!props.account) return <Empty title="登录后查看我的内容" message="我的数码、看看号订阅和个人清单会与当前酷安账号同步。"><button className="button" onClick={props.onLogin}>登录酷安</button></Empty>;
  if (props.page.type === 'products') return <PersonalProducts key={props.namespace} {...props} />;
  if (props.page.type === 'dyhs') return <PersonalDyhs key={props.namespace + ':personal-dyhs'} {...props} />;
  if (props.page.type === 'dyh-recommend') return <PersonalDyhRecommendations key={props.namespace + ':dyh-recommend'} {...props} />;
  if (props.page.type === 'lists') return <PersonalLists key={props.namespace + ':personal-lists'} {...props} />;
  if (props.page.type === 'backups') return <PersonalBackups key={props.namespace + ':backups'} {...props} />;
  if (props.page.type === 'blocks') return <PersonalBlocks key={props.namespace + ':blocks'} {...props} />;
  if (props.page.type === 'backup' && /^[1-9]\d{0,19}$/.test(props.page.id || '')) return <PersonalBackup key={props.namespace + ':backup:' + props.page.id} {...props} />;
  return <Empty title="个人功能暂不可用" message="请从我的页面重新打开此功能。" />;
}

function PersonalLists(props: PersonalProps) {
  const [revision, setRevision] = useState(0), resource = usePersonalResource('goodsAlbums', { uid: props.account!.uid }, props.namespace, revision);
  const items = rows(resource.data?.data);
  return <section className="personal-lists" aria-label="我的清单"><div className="personal-heading"><div><h2>我的清单</h2><p>查看当前账号创建的产品清单。</p></div><button className="button secondary" onClick={() => setRevision(value => value + 1)} disabled={resource.loading}><RefreshCw size={15} />刷新我的清单</button></div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && resource.data && !items.length && <Empty title="还没有创建清单" message="你的产品清单会显示在这里。" />}
    <div className="feed-list">{items.map((item, index) => {
      const id = String(item.id ?? item.entityId ?? ''), title = plain(item.title || item.name || '产品清单');
      return /^[1-9]\d{0,19}$/.test(id) ? <EntityCard key={rowKey(item, index)} entity={item} onOpen={() => props.go({ kind: 'goods', type: 'album', id, uid: props.account!.uid, title })} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} /> : <article className="personal-unavailable-row" key={rowKey(item, index)}><strong>{title}</strong><p>{plain(item.description || item.subTitle || '')}</p></article>;
    })}</div>{items.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </section>;
}

function PersonalDyhs(props: PersonalProps) {
  const [tab, setTab] = useState('following'), [revision, setRevision] = useState(0), resource = usePersonalResource(tab === 'following' ? 'catalogDyhFollowing' : 'catalogDyhEditing', {}, props.namespace, revision);
  const items = rows(resource.data?.data);
  return <section className="personal-dyhs" aria-label="我的看看号"><div className="personal-heading"><div><h2>我的看看号</h2><p>查看我关注的和我管理的看看号。</p></div><div className="personal-toolbar"><button className="button secondary" onClick={() => props.go({ kind: 'personal', type: 'dyh-recommend', title: '推荐订阅' })}><Plus size={15} />添加更多看看号</button><button className="button secondary" disabled={resource.loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />刷新看看号</button></div></div>
    <div className="tabs personal-tabs" role="tablist" aria-label="我的看看号分类">{[['following', '我关注的'], ['editing', '我管理的']].map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{title}</button>)}</div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && resource.data && !items.length && <Empty title={tab === 'following' ? '还没有订阅看看号，去订阅' : '还没有管理的看看号'} message={tab === 'following' ? '添加更多看看号，发现感兴趣的内容。' : '你管理的看看号会显示在这里。'}>{tab === 'following' && <button className="button secondary" onClick={() => props.go({ kind: 'personal', type: 'dyh-recommend', title: '推荐订阅' })}>去订阅</button>}</Empty>}
    <div className="feed-list">{items.map((item, index) => <EntityCard key={rowKey(item, index)} entity={item} onOpen={() => { const id = String(item.id ?? item.dyhId ?? ''); if (/^[1-9]\d{0,19}$/.test(id)) props.go({ kind: 'catalog', type: 'dyh', id, title: plain(item.title || '看看号') }); }} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} />)}</div>{items.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </section>;
}

function PersonalDyhRecommendationCard({ item, props }: { item: Entity; props: PersonalProps }) {
  const id = String(item.id ?? item.dyhId ?? ''), [followed, setFollowed] = useState([true, 1, '1'].includes(item.userAction?.follow));
  const action = useInteraction(props.namespace + ':dyh-recommend:' + id), title = plain(item.title || '看看号');
  useEffect(() => setFollowed([true, 1, '1'].includes(item.userAction?.follow)), [item.userAction?.follow]);
  return <article className="personal-dyh-card"><button className="personal-dyh-open" onClick={() => props.go({ kind: 'catalog', type: 'dyh', id, title })}><Avatar src={item.logo} name={title} size={48} /><strong>{title}</strong>{item.follownum != null && <small>{count(item.follownum)} 人订阅</small>}</button><button className="button secondary" disabled={action.locked} onClick={() => void action.run(followed ? 'catalogDyhUnfollow' : 'catalogDyhFollow', { id }, () => { setFollowed(!followed); props.toast(followed ? '已取消订阅' : '已订阅看看号'); refreshResources(); })}>{followed ? '取消订阅' : '订阅'}</button>{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}</article>;
}
function PersonalDyhRecommendations(props: PersonalProps) {
  const [revision, setRevision] = useState(0), resource = usePersonalResource('personalDyhRecommendations', {}, props.namespace, revision);
  const items = rows(resource.data?.data), sections: Entity[] = Array.isArray(resource.data?.sections) && resource.data.sections.length ? resource.data.sections : [{ title: '推荐订阅', entities: items }];
  const shown = new Set<string>();
  return <section className="personal-dyh-recommend" aria-label="推荐订阅"><div className="personal-heading"><div><h2>推荐订阅</h2><p>发现感兴趣的看看号并订阅。</p></div><div className="personal-toolbar"><button className="button secondary" onClick={() => props.go({ kind: 'personal', type: 'dyhs', title: '我的看看号' })}><ArrowLeft size={15} />我的看看号</button><button className="button secondary" disabled={resource.loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />刷新推荐订阅</button></div></div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && resource.data && !items.length && <Empty title="暂无推荐订阅" message="稍后刷新看看号推荐。" />}
    {sections.map((section, index) => { const entries = rows(section.entities).filter(item => { const id = String(item.id ?? item.dyhId ?? ''); if (item.entityType !== 'dyh' || !/^[1-9]\d{0,19}$/.test(id) || shown.has(id)) return false; shown.add(id); return true; }); return entries.length > 0 ? <section className="personal-dyh-section" key={section.url || section.title || index}><div className="personal-heading"><h3>{plain(section.title || '看看号')}</h3>{section.url && <button className="text-button" onClick={() => props.feedProps.onLink(section.url)}>查看更多</button>}</div><div className="personal-dyh-grid">{entries.map(item => <PersonalDyhRecommendationCard key={String(item.id ?? item.dyhId)} item={item} props={props} />)}</div></section> : null; })}
    <div className="feed-list">{items.filter(item => item.entityType !== 'dyh' && !Array.isArray(item.entities)).map((item, index) => <EntityCard key={rowKey(item, index)} entity={item} onOpen={props.openEntity} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} />)}</div>{items.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </section>;
}

function PersonalBackups(props: PersonalProps) {
  const [revision, setRevision] = useState(0), resource = usePersonalResource('personalBackups', {}, props.namespace, revision);
  const items = rows(resource.data?.data);
  return <section className="personal-backups" aria-label="备份列表"><div className="personal-heading"><div><h2>备份列表</h2><p>查看与管理保存在酷安账号中的备份单。</p></div><div className="personal-toolbar"><button className="button secondary" disabled={resource.loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />刷新备份列表</button></div></div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && resource.data && !items.length && <Empty title="你还没有创建过备份单" message="在酷安中创建备份单后，可在这里查看记录。" />}
    <div className="personal-backup-list">{items.map((item, index) => {
      const id = String(item.id ?? item.entityId ?? ''), valid = /^[1-9]\d{0,19}$/.test(id) && item.entityType !== 'backupHeader';
      const content = <><Archive size={21} /><span><strong>{plain(item.title || item.device_title || '手机应用备份')}</strong><small>{item.apk_num != null ? `${plain(item.apk_num)} 个应用` : plain(item.subTitle || item.description || '')}{item.createdate || item.dateline ? ` · ${relativeTime(item.createdate || item.dateline)}` : ''}</small></span>{valid && <ChevronRight size={17} />}</>;
      return valid ? <button key={rowKey(item, index)} onClick={() => props.go({ kind: 'personal', type: 'backup', id, title: plain(item.title || '备份单') })}>{content}</button> : <article key={rowKey(item, index)}>{content}</article>;
    })}</div>{items.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </section>;
}
function PersonalBackup(props: PersonalProps) {
  const [revision, setRevision] = useState(0), [confirm, setConfirm] = useState(false);
  const resource = useResource('personalBackup', { id: props.page.id }, props.namespace, revision);
  const info = resource.data?.data || {}, action = useInteraction(props.namespace + ':backup:' + props.page.id);
  const apps = [...rows(info.localEntities), ...rows(info.unLocalEntities)];
  const remove = () => void action.run('personalBackupDelete', { id: props.page.id }, () => { props.toast('备份单已删除'); props.go({ kind: 'personal', type: 'backups', title: '备份列表' }); });
  return <section className="personal-backup-detail" aria-label="备份单详情"><div className="personal-heading"><button className="text-button" onClick={() => props.go({ kind: 'personal', type: 'backups', title: '备份列表' })}><ArrowLeft size={15} />返回备份列表</button><div className="personal-toolbar">{resource.data && <button className="button secondary danger" disabled={action.locked} onClick={() => setConfirm(true)}><Trash2 size={15} />删除备份单</button>}</div></div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}
    {resource.data && <><div className="personal-backup-summary"><h2>{plain(info.title || '手机应用备份')}</h2><p>{plain(info.device_title || info.device_name || '')}{info.apk_num != null ? ` · ${plain(info.apk_num)} 个应用` : ''}</p>{info.createdate && <p>备份时间：{relativeTime(info.createdate)}</p>}</div><div className="feed-list">{apps.map((app, index) => {
      const packageName = String(app.packageName || app.package_name || ''), id = String(app.id || app.entityId || '');
      const target = app.entityType === 'apk' || /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(packageName) ? { ...app, entityType: 'apk', id: packageName || id, appName: app.appName || app.title || app.name || packageName } : null;
      return target && target.id ? <EntityCard key={rowKey(app, index)} entity={target} onOpen={props.openEntity} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} /> : <article className="personal-unavailable-row" key={rowKey(app, index)}><strong>{plain(app.appName || app.title || app.name || '未收录应用')}</strong><p>{plain(app.versionName || app.version_name || app.description || '')}</p></article>;
    })}</div>{!apps.length && <Empty title="备份单里没有应用" message="此备份单没有返回可见的应用记录。" />}</>}
    {confirm && <Modal title="删除备份单" onClose={() => { if (!action.locked) setConfirm(false); }}><div className="personal-delete-confirm"><p>确定要删除「{plain(info.title || '手机应用备份')}」吗？删除后无法恢复此云端备份单。</p>{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}<div className="personal-toolbar"><button className="button secondary" disabled={action.locked} onClick={() => setConfirm(false)}>取消</button><button className="button danger" disabled={action.locked} onClick={remove}>确认删除备份单</button></div></div></Modal>}
  </section>;
}

function PersonalProducts(props: PersonalProps) {
  const [tab, setTab] = useState('following'), [revision, setRevision] = useState(0);
  const selected = PERSONAL_PRODUCT_TABS.find(item => item.id === tab)!;
  const resource = usePersonalResource(selected.operation, { ...selected.args }, props.namespace, revision);
  const items = rows(resource.data?.data);
  return <section className="personal-products" aria-label="我的数码">
    <div className="personal-heading"><div><h2>我的数码</h2><p>查看当前账号关注的数码吧与购买记录。</p></div><button className="button secondary" onClick={() => setRevision(value => value + 1)} disabled={resource.loading}><RefreshCw size={15} />刷新我的数码</button></div>
    <div className="tabs personal-tabs" role="tablist" aria-label="我的数码分类">{PERSONAL_PRODUCT_TABS.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} onClick={() => setTab(item.id)}>{item.title}</button>)}</div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}
    {resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && resource.data && !items.length && <Empty title={tab === 'following' ? '还没有关注数码吧' : tab === 'owner' ? '还没有机主记录' : tab === 'wish' ? '还没有想买的数码' : '还没有买过的数码'} message="在数码详情页更新关注和购买状态后，可在这里查看。" />}
    <div className="feed-list personal-product-list">{items.map((row, index) => {
      const target = personalProductTarget(row);
      return target ? <EntityCard key={rowKey(row, index)} entity={target} onOpen={props.openEntity} onUser={props.feedProps.onUser} onLink={props.feedProps.onLink} /> : <article className="personal-unavailable-row" key={rowKey(row, index)}><strong>{plain(row.title || row.name || '数码列表内容')}</strong><p>{plain(row.description || row.subTitle || '')}</p></article>;
    })}</div>
    {items.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </section>;
}

const blockTypes = [
  { id: 'node', title: '节点屏蔽', description: '在头条中屏蔽数码、话题、应用' },
  { id: 'user', title: '用户屏蔽', description: '在头条中屏蔽用户' },
  { id: 'word', title: '关键字屏蔽', description: '在头条中屏蔽关键字' },
] as const;
function blockArgs(rule: HomeBlockRule, action: 'add' | 'cancel') {
  return rule.scope === 'node' ? { scope: rule.scope, action, tid: rule.tid, name: rule.name } : { scope: rule.scope, action, value: rule.value };
}
function blockKey(rule: HomeBlockRule) { return JSON.stringify([rule.scope, rule.tid || rule.value, rule.name || '']); }

function PersonalBlocks(props: PersonalProps) {
  const [scope, setScope] = useState<'node' | 'user' | 'word'>('node'), [adding, setAdding] = useState(false), [removing, setRemoving] = useState<HomeBlockRule | null>(null);
  const [revision, setRevision] = useState(0), resource = useResource('personalHomeBlocks', {}, props.namespace, revision);
  const config: HomeBlockConfig | undefined = resource.data?.data, items = config?.rules.filter(rule => rule.scope === scope) || [];
  const selected = blockTypes.find(item => item.id === scope)!;
  function changed() { setAdding(false); setRemoving(null); refreshResources(); props.toast('首页屏蔽设置已同步'); }
  return <section className="personal-blocks" aria-label="首页屏蔽管理">
    <div className="personal-heading"><div><h2>首页屏蔽管理</h2><p>屏蔽设置与酷安账号同步，仅作用于首页头条。</p></div><div className="personal-toolbar"><button className="button secondary" disabled={resource.loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={15} />刷新屏蔽设置</button><button className="text-button" onClick={() => void window.coolapk?.openExternal('https://m.coolapk.com/mp/user/spamWordListDescription')}>屏蔽说明</button></div></div>
    <div className="tabs personal-tabs" role="tablist" aria-label="首页屏蔽类型">{blockTypes.map(item => <button key={item.id} role="tab" aria-selected={scope === item.id} className={scope === item.id ? 'selected' : ''} onClick={() => { setScope(item.id); setAdding(false); setRemoving(null); }}>{item.title}（{config?.rules.filter(rule => rule.scope === item.id).length ?? '…'}）</button>)}</div>
    <div className="personal-heading"><p>{selected.description}</p><button className="button secondary" disabled={!config || resource.loading} onClick={() => setAdding(true)}><Plus size={15} />添加{scope === 'word' ? '关键字' : scope === 'user' ? '用户' : '节点'}</button></div>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />}{resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && config && !items.length && <Empty title={`暂无${selected.title}`} message={selected.description} />}
    <div className="personal-block-list">{items.map(rule => <article key={blockKey(rule)}><Avatar src={rule.logo} name={rule.title} size={38} /><span><strong>{plain(rule.title)}</strong>{rule.scope === 'node' && rule.nodeType && <small>{plain(rule.nodeType)}</small>}</span><button className="text-button danger" aria-label={`取消屏蔽 ${plain(rule.title)}`} onClick={() => setRemoving(rule)}><Trash2 size={15} />取消屏蔽</button></article>)}</div>
    {config?.maxCount != null && <p className="personal-block-limit">已屏蔽 {config.rules.length} 项 · 账号上限 {config.maxCount} 项</p>}
    {adding && config && (scope === 'word' ? <PersonalKeywordDialog {...props} config={config} onClose={() => setAdding(false)} onDone={changed} /> : <PersonalBlockPicker {...props} scope={scope} config={config} onClose={() => setAdding(false)} onDone={changed} />)}
    {removing && <PersonalBlockRemove {...props} rule={removing} onClose={() => setRemoving(null)} onDone={changed} />}
  </section>;
}

function PersonalBlockRemove(props: PersonalProps & { rule: HomeBlockRule; onClose: () => void; onDone: () => void }) {
  const action = useInteraction(props.namespace + ':home-block-remove:' + blockKey(props.rule));
  return <Modal title="取消首页屏蔽" onClose={() => { if (!action.locked) props.onClose(); }}><div className="personal-block-form"><p>取消屏蔽“{plain(props.rule.title)}”后，相关内容可重新出现在首页头条中。</p>{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}<div className="personal-toolbar"><button className="button secondary" disabled={action.locked} onClick={props.onClose}>取消</button><button className="button" disabled={action.locked} onClick={() => void action.run('personalHomeBlockUpdate', blockArgs(props.rule, 'cancel'), props.onDone)}>确认取消屏蔽</button></div></div></Modal>;
}

function PersonalKeywordDialog(props: PersonalProps & { config: HomeBlockConfig; onClose: () => void; onDone: () => void }) {
  const [word, setWord] = useState(''), [error, setError] = useState(''), action = useInteraction(props.namespace + ':home-block-keyword');
  function submit() {
    const args = { scope: 'word', action: 'add', value: word };
    try { homeBlockChange(args); } catch (error) { setError((error as Error).message); return; }
    if (homeBlockIncludes(props.config, args)) { setError('这个关键字已经在屏蔽列表中'); return; }
    setError(''); void action.run('personalHomeBlockUpdate', args, props.onDone);
  }
  return <Modal title="添加屏蔽关键字" onClose={() => { if (!action.locked) props.onClose(); }}><form className="personal-block-form" onSubmit={event => { event.preventDefault(); submit(); }}><label>输入你想在首页屏蔽的关键字<input aria-label="首页屏蔽关键字" value={word} onChange={event => { setWord(event.target.value); setError(''); }} maxLength={15} disabled={action.locked} /></label><p className="personal-block-hint">2-15字，不区分大小写；不能包含标点或符号。</p>{error && <p className="personal-input-error" role="alert">{error}</p>}{action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}<div className="personal-toolbar"><button className="button secondary" type="button" disabled={action.locked} onClick={props.onClose}>取消</button><button className="button" disabled={action.locked || !word}>确定</button></div></form></Modal>;
}

const nodePickerTabs = [['recent', '最近'], ['topic', '话题'], ['product', '数码'], ['apk', '应用']];
function PersonalBlockPicker(props: PersonalProps & { scope: 'node' | 'user'; config: HomeBlockConfig; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState(props.scope === 'user' ? 'user' : 'recent'), [query, setQuery] = useState(''), [keyword, setKeyword] = useState(''), [revision, setRevision] = useState(0), [selected, setSelected] = useState<HomeBlockRule | null>(null);
  const action = useInteraction(props.namespace + ':home-block-picker:' + props.scope), found = usePersonalResource(props.scope === 'node' ? 'personalNodePicker' : keyword ? 'search' : null, props.scope === 'node' ? { category: tab, keyword } : { query: keyword, type: 'user' }, props.namespace, revision);
  const choices = rows(found.data?.data).flatMap(row => {
    if (props.scope === 'node') { const category = tab === 'recent' ? ['product', 'product_phone'].includes(row.entityType) ? 'product' : ['topic', 'feedTopic'].includes(row.entityType) ? 'topic' : 'apk' : tab; const node = homeNodeChoice({ ...row, title: plain(row.title || row.tag || '') }, category); return node ? [node] : []; }
    const value = String(row.uid ?? row.id ?? '');
    return row.entityType === 'user' && /^[1-9]\d{0,19}$/.test(value) && value !== props.account!.uid ? [{ scope: 'user' as const, value, title: plain(row.username || row.title || '酷友'), logo: row.userAvatar || row.logo || '' }] : [];
  });
  function choose(rule: HomeBlockRule) { if (!action.locked && !homeBlockIncludes(props.config, blockArgs(rule, 'add'))) setSelected(rule); }
  function save() {
    if (!selected) return;
    void action.run('personalHomeBlockUpdate', blockArgs(selected, 'add'), props.onDone);
  }
  return <Modal title={props.scope === 'node' ? '选择屏蔽节点' : '选择屏蔽用户'} onClose={() => { if (!action.locked) props.onClose(); }} wide><div className="personal-block-form"><form className="personal-block-search" onSubmit={event => { event.preventDefault(); setKeyword(query.trim()); setSelected(null); setRevision(value => value + 1); }}><input type="search" aria-label={props.scope === 'node' ? '搜索屏蔽节点' : '搜索屏蔽用户'} placeholder={props.scope === 'node' ? '搜索话题、数码或应用' : '搜索酷友昵称'} value={query} onChange={event => setQuery(event.target.value)} disabled={action.locked} maxLength={200} /><button className="button secondary" disabled={action.locked}><Search size={15} />搜索</button></form>
    {props.scope === 'node' && <div className="tabs" role="tablist" aria-label="屏蔽节点分类">{nodePickerTabs.map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} disabled={action.locked} onClick={() => { setTab(id); setSelected(null); }}>{id === 'recent' && keyword ? '综合' : title}</button>)}</div>}
    {found.error && <ErrorNotice error={found.error} onRetry={found.retry} onLogin={props.onLogin} />}{found.loading && !found.data && <Skeleton />}
    {!found.loading && !found.error && !choices.length && <Empty title={tab === 'recent' && !keyword ? '最近还没有参与过数码或应用讨论' : keyword ? '没有找到可屏蔽的内容' : props.scope === 'node' ? '当前分类没有可屏蔽的内容' : '输入关键词开始搜索'} message={props.scope === 'node' ? '从话题、数码或应用中选择一个节点。' : '选择想在首页头条中屏蔽的酷友。'} />}
    <div className="personal-block-choices">{choices.map(rule => { const exists = homeBlockIncludes(props.config, blockArgs(rule, 'add')), checked = selected && blockKey(selected) === blockKey(rule); return <button key={blockKey(rule)} className={checked ? 'selected' : ''} aria-pressed={!!checked} disabled={action.locked || exists} onClick={() => choose(rule)}><Avatar src={rule.logo} name={rule.title} size={35} /><span><strong>{plain(rule.title)}</strong><small>{exists ? '已屏蔽' : rule.nodeType || '酷友'}</small></span>{checked && <span>已选择</span>}</button>; })}</div>
    {choices.length > 0 && <LoadMore loading={found.loading} error={found.error} hasMore={found.data?.hasMore} onClick={found.more} />}
    {action.error && <ErrorNotice error={action.error} onRetry={action.retry} onLogin={props.onLogin} />}<div className="personal-toolbar"><button className="button secondary" disabled={action.locked} onClick={props.onClose}>取消</button><button className="button" disabled={action.locked || !selected} onClick={save}>确定屏蔽</button></div></div></Modal>;
}
