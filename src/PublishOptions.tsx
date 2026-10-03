import { useEffect, useState } from 'react';
import { call, plain, useResource } from './data';
import { ErrorNotice } from './components';
import type { Entity } from './types';
const rows = (value: any): Entity[] => Array.isArray(value) ? value.flatMap(x => Array.isArray(x.entities) ? x.entities : [x]) : [];
const dataObject = (source: string) => { try { const value = JSON.parse(source); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
export default function PublishOptions({ options, onChange, mode, namespace, disabled }: { options: Entity; onChange: (next: Entity) => void; mode: string; namespace: string; disabled: boolean }) {
  const [query, setQuery] = useState(''), [debounced, setDebounced] = useState(''), [name, setName] = useState('');
  const recentKey = 'coolapk:publish-topics:' + namespace;
  const [recentIds, setRecentIds] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem(recentKey) || '[]'); return Array.isArray(saved) ? [...new Set(saved.filter((id: unknown) => typeof id === 'string' && /^\d{1,20}$/.test(id)))].slice(0, 20) as string[] : []; } catch { return []; } });
  const target = options.targetType, sub = options.subTypeId;
  const set = (key: string, value: any) => onChange({ ...options, [key]: value });
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 350); return () => clearTimeout(timer); }, [query]);
  const search = useResource(target === 'tag' ? 'searchPublishTopics' : target && debounced ? 'search' : null, { query: debounced, ...(target === 'tag' ? { recentIds: recentIds.join(',') } : { type: target === 'apk' ? 'apk' : 'product' }) }, namespace);
  const product = useResource(target === 'product_phone' && options.targetId && sub === '6' ? 'catalogProductVersions' : null, { id: options.targetId }, namespace);
  const dyhs = useResource('catalogDyhEditing', {}, namespace);
  const configRows = rows(product.data?.data);
  const structured = dataObject(options.subData || '');
  function structuredValue(field: string, value: any) { const next = { ...structured, [field]: value }; if (value === '') delete next[field]; set('subData', JSON.stringify(next)); }
  function chooseBoard(item: Entity) {
    const title = plain(item.tag || item.title || item.appName).replace(/^#|#$/g, '').trim();
    const value = target === 'tag' ? title : target === 'apk' ? item.packageName || item.id : item.id;
    chooseTarget(String(value)); setName(title); setQuery('');
    if (target === 'tag' && /^\d{1,20}$/.test(String(item.id))) { const next = [String(item.id), ...recentIds.filter(id => id !== String(item.id))].slice(0, 20); setRecentIds(next); try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* Selection still works when local storage is unavailable. */ } }
  }
  function chooseTarget(value: string) { onChange({ ...options, targetId: value, ...(target === 'product_phone' && value !== options.targetId ? { subData: '' } : {}) }); }
  return <fieldset className="composer-options" disabled={disabled}>
    <label>发布板块<select aria-label="发布板块" value={target} onChange={e => { setQuery(''); setDebounced(''); setName(''); onChange({ ...options, targetType: e.target.value, targetId: '', subTypeId: '', subData: '' }); }}><option value="">个人动态</option><option value="tag">话题</option><option value="apk">应用</option><option value="product_phone">数码产品</option></select></label>
    {target && <div className="publish-board-picker"><label>搜索{target === 'tag' ? '话题' : target === 'apk' ? '应用' : '数码产品'}<input aria-label="搜索发布板块" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入名称查找…" /></label>{search.error && <ErrorNotice error={search.error} />}{rows(search.data?.data).filter(item => target === 'tag' ? item.tag || item.entityType === 'topic' : target === 'apk' ? item.packageName || item.entityType === 'apk' : item.entityType === 'product').slice(0, 6).map(item => <button className="publish-board-result" type="button" key={item.id || item.tag || item.packageName} onClick={() => chooseBoard(item)}>{plain(item.title || item.appName || item.tag)}</button>)}{name && <small>已选择：{name}</small>}<label>{target === 'tag' ? '话题名称' : '板块编号'}<input aria-label="发布板块编号" value={options.targetId} onChange={e => { setName(''); chooseTarget(e.target.value); }} /></label></div>}
    <label>可见范围<select aria-label="可见范围" value={options.visibleStatus} onChange={e => set('visibleStatus', Number(e.target.value))}><option value={1}>公开</option><option value={-1}>仅自己可见</option></select></label>
    <label>内容声明<select aria-label="内容声明" value={options.originalType} onChange={e => set('originalType', Number(e.target.value))}><option value={0}>无声明</option><option value={1}>原创</option><option value={2}>转载</option><option value={3}>非原创</option></select></label>
    {mode === 'feed' && <label className="composer-check"><input type="checkbox" checked={!!options.largeCover} onChange={e => set('largeCover', e.target.checked)} />大图封面动态</label>}
    <label>附加链接<input type="url" aria-label="附加链接" value={options.extraUrl || ''} onChange={e => set('extraUrl', e.target.value)} placeholder="https://" /></label>
    <label>发布到我的酷安号<select aria-label="发布到我的酷安号" value={options.dyhId || ''} onChange={e => set('dyhId', e.target.value)}><option value="">个人动态</option>{rows(dyhs.data?.data).map(item => <option key={item.id || item.dyhId} value={item.id || item.dyhId}>{plain(item.title || item.name)}</option>)}</select></label>{dyhs.error && <ErrorNotice error={dyhs.error} />}
    {target === 'product_phone' && <><label>数码子板块<select aria-label="数码子板块" value={sub || ''} onChange={e => onChange({ ...options, subTypeId: e.target.value, subData: '' })}><option value="">讨论</option>{[['1', '续航'], ['2', '跑分'], ['3', '上手'], ['4', '样张'], ['5', '反馈'], ['6', '到手价']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {sub === '1' && <label>续航小时数<input aria-label="续航小时数" type="number" min="0.1" step="0.1" value={options.subData || ''} onChange={e => set('subData', e.target.value)} /></label>}
      {sub === '5' && <label>反馈严重度<select aria-label="反馈严重度" value={options.subData || ''} onChange={e => set('subData', e.target.value)}><option value="">请选择</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
      {sub === '2' && [['antutu_score', '安兔兔总分'], ['geek_bench_single_score', 'Geekbench 单核'], ['geek_bench_multi_score', 'Geekbench 多核'], ['3d_mark_score', '3DMark 得分']].map(([field, label]) => <label key={field}>{label}<input aria-label={label} type="number" min="1" value={structured[field] || ''} onChange={e => structuredValue(field, e.target.value ? Number(e.target.value) : '')} /></label>)}
      {sub === '6' && <><label>实际到手价（元）<input aria-label="实际到手价" type="number" min="0.01" step="0.01" value={structured.final_price || ''} onChange={e => structuredValue('final_price', e.target.value ? Number(e.target.value) : '')} /></label><label>购买配置<select aria-label="购买配置" value={structured.config_id || ''} onChange={e => { const config = configRows.find(item => String(item.id || item.config_id) === e.target.value); set('subData', JSON.stringify({ ...structured, config_id: Number(e.target.value), config_name: plain(config?.title || config?.name || config?.config_name || '') })); }}><option value="">请选择配置</option>{configRows.map(item => <option key={item.id || item.config_id} value={item.id || item.config_id}>{plain(item.title || item.name || item.config_name)}</option>)}</select></label>{product.error && <ErrorNotice error={product.error} />}{!product.loading && !product.error && !configRows.length && <small>服务端未返回可购买配置，请先选择具体产品。</small>}</>}
    </>}
  </fieldset>;
}
