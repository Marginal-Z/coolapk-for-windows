import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SECONDHAND_DEAL_TYPES, SECONDHAND_PUBLISH_LIMITS, SECONDHAND_PRICE_TYPES, SECONDHAND_STORE_TYPES, prepareSecondhand, type SecondhandConfiguration, type SecondhandPublishInput } from '../core/secondhand-publishing-models.mjs';
import type { SecondhandConfigGroup } from '../core/secondhand-publishing.mjs';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { Empty, ErrorNotice, Modal, Picture, RichText, Skeleton } from './components';
import { call, ClientError, imageUrl, plain, unwrap, useResource } from './data';
import type { Entity } from './types';
import './secondhand-editor.css';

export type SecondhandEditorProps = { id?: string; namespace: string; loggedIn: boolean; onLogin: () => void; onClose: () => void; onSaved: (feed: Entity) => void; toast: (message: string) => void; restrictionReason?: string };
type Draft = Required<SecondhandPublishInput>;
const defaults = (): Draft => ({ title: '', message: '', pic: '', categoryId: '100', productId: '', dealType: 0, storeType: 2, price: '', priceType: 0, link: '', configuration: { type: 'none' }, location: { name: '', city: '', country: '', province: '', cityCode: '', latitude: 0, longitude: 0 }, origin: 'general', visibility: 'public' });
const numeric = (value: unknown) => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : '';
const asError = (error: unknown) => error instanceof ClientError ? error : new ClientError((error as Error)?.message || '闲置操作失败', (error as any)?.code || 'APP_ERROR');
const children = (data: unknown, depth = 0): Entity[] => Array.isArray(data) && depth <= 8 ? data.flatMap(row => row && typeof row === 'object' ? [...(Array.isArray(row.entities) ? children(row.entities, depth + 1) : []), row] : []) : [];
const pictureList = (value: string) => value.split(',').filter(Boolean);
const sameField = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SecondhandDialog(props: SecondhandEditorProps) { return <OwnedDialog key={`${props.namespace}:${props.id || 'create'}:${props.loggedIn}`} {...props} />; }
function OwnedDialog(props: SecondhandEditorProps) {
  const latest = useRef(props.onClose); latest.current = props.onClose;
  const close = useCallback(() => latest.current(), []);
  return <Modal title={props.id ? '编辑二手信息' : '发布二手信息'} onClose={close} wide><SecondhandEditor {...props} /></Modal>;
}
export function SecondhandEditor(props: SecondhandEditorProps) { return <Editor key={`${props.namespace}:${props.id || 'create'}:${props.loggedIn}`} {...props} />; }
function Editor({ id, namespace, loggedIn, onLogin, onClose, onSaved, toast, restrictionReason }: SecondhandEditorProps) {
  const [draft, setDraft] = useState<Draft>(defaults), [retained, setRetained] = useState<string[]>([]), [pictures, setPictures] = useState<Attachment[]>([]);
  const [categories, setCategories] = useState<Entity[]>([]), [accepted, setAccepted] = useState<boolean | null>(null), [closed, setClosed] = useState(false);
  const [loading, setLoading] = useState(false), [readError, setReadError] = useState<ClientError>(), [error, setError] = useState<ClientError>(), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [productPicker, setProductPicker] = useState(false), [productTitle, setProductTitle] = useState(''), [agreementOpen, setAgreementOpen] = useState(false), [checkedMissing, setCheckedMissing] = useState(false), [locationOpen, setLocationOpen] = useState(false);
  const active = useRef(false), sequence = useRef(0), inFlight = useRef(false), hydrated = useRef(false), original = useRef<Draft | undefined>(undefined), pending = useRef<{ operation: string; args: Entity } | undefined>(undefined);
  const latestRestriction = useRef(restrictionReason); latestRestriction.current = restrictionReason;
  const uncertain = error?.code === 'WRITE_UNCONFIRMED', locked = loading || busy || !!error;
  useLayoutEffect(() => { active.current = true; sequence.current++; return () => { active.current = false; sequence.current++; inFlight.current = false; pending.current = undefined; }; }, []);
  useEffect(() => { void load(); }, []);
  useLayoutEffect(() => { if (restrictionReason && (busy || pending.current)) { sequence.current++; inFlight.current = false; pending.current = undefined; setBusy(false); setProgress(''); setError(undefined); } }, [restrictionReason]);
  async function load(force = false) {
    if (!loggedIn || inFlight.current || !active.current) return;
    if (force && id) hydrated.current = false;
    const attempt = ++sequence.current, current = () => active.current && attempt === sequence.current;
    inFlight.current = true; setLoading(true); setReadError(undefined);
    const requests = [call('secondhandPublishCategories'), call('secondhandAgreementState'), ...(id ? [call('secondhandEditable', { id })] : [])];
    const results = await Promise.allSettled(requests);
    if (!current()) return;
    const failed = results.find(result => result.status === 'rejected');
    try {
      if (results[0].status === 'fulfilled') {
        const rows = children(results[0].value.data).filter(row => numeric(row.id) && plain(row.title || row.name).trim());
        if (!rows.length) throw new ClientError('酷安未返回可用的闲置品类，请重新读取', 'API_ERROR');
        setCategories([...new Map(rows.map(row => [numeric(row.id), row])).values()]);
      }
      if (results[1].status === 'fulfilled') {
        if (typeof results[1].value.data?.accepted !== 'boolean') throw new ClientError('协议状态无法确认，请重新读取', 'API_ERROR');
        setAccepted(results[1].value.data.accepted);
      }
      if (id && results[2]?.status === 'fulfilled') {
        const value = results[2].value.data;
        if (!value?.fields || value.id !== id || typeof value.closed !== 'boolean') throw new ClientError('酷安未返回可编辑的闲置信息', 'API_ERROR');
        setClosed(value.closed);
        if (!hydrated.current || force) { const fields = prepareSecondhand(value.fields, true); original.current = structuredClone(fields); setDraft(fields); setRetained(pictureList(fields.pic)); clearAttachments(pictures); setPictures([]); hydrated.current = true; setProductTitle(fields.productId ? `原型号 #${fields.productId}` : ''); }
      }
      if (failed?.status === 'rejected') setReadError(asError(failed.reason));
      if (force) { pending.current = undefined; setError(undefined); setCheckedMissing(false); }
    } catch (e) { setReadError(asError(e)); }
    finally { inFlight.current = false; setLoading(false); }
  }
  function patch(value: Partial<Draft>) { if (!locked) { pending.current = undefined; setDraft(old => ({ ...old, ...value })); } }
  function changeDeal(value: number) { patch({ dealType: value as Draft['dealType'], storeType: value === 2 ? 2 : draft.storeType, price: '', priceType: value === 2 ? 3 : 0, configuration: { type: 'none' } }); }
  function changeCategory(categoryId: string) { patch({ categoryId, productId: '', configuration: { type: 'none' } }); setProductTitle(''); }
  function editingAgain() { pending.current = undefined; setError(undefined); setCheckedMissing(false); }
  async function submit(retry = false) {
    if (!loggedIn) return onLogin();
    if (!active.current || inFlight.current || restrictionReason || readError || loading || id && !hydrated.current || uncertain && !checkedMissing) return;
    if (accepted !== true) { setAgreementOpen(true); return; }
    const attempt = ++sequence.current, current = () => active.current && attempt === sequence.current && !latestRestriction.current;
    inFlight.current = true; setBusy(true); setError(undefined); setCheckedMissing(false);
    try {
      let intent = retry ? pending.current : undefined;
      if (!intent) {
        const snapshots = [...pictures], preserved = [...retained];
        const prepared = prepareSecondhand({ ...structuredClone(draft), pic: [...preserved, ...snapshots.map(item => item.url || 'pending-local-image')].join(',') }, !!id);
        const uploaded = snapshots.length ? await uploadAttachments(snapshots, value => { if (current()) setProgress(value); }, { shouldContinue: current }) : '';
        if (!current()) return;
        prepared.pic = [...preserved, ...pictureList(uploaded)].join(',');
        if (id) {
          if (!original.current) throw new ClientError('请重新读取原闲置', 'API_ERROR');
          const changes = Object.fromEntries(Object.entries(prepared).filter(([key, value]) => !sameField(value, original.current![key as keyof Draft])));
          if (!Object.keys(changes).length) { toast('内容尚未修改'); return; }
          intent = { operation: 'secondhandEdit', args: { id, patch: changes } };
        } else intent = { operation: 'secondhandCreate', args: { input: prepared } };
        pending.current = structuredClone(intent);
      }
      setProgress(id ? '正在保存…' : '正在发布…');
      const result = await call(intent.operation, structuredClone(intent.args));
      if (!current()) return;
      if (!numeric(result.data?.id) || id && String(result.data.id) !== id) throw new ClientError('闲置提交结果尚未确认，请先核对最新动态', 'WRITE_UNCONFIRMED');
      toast(id ? '二手信息已保存' : '二手信息已发布'); onSaved(result.data);
    } catch (e) { if (current()) { const failure = asError(e); if (failure.code === 'AGREEMENT_REQUIRED') { setAccepted(false); setAgreementOpen(true); pending.current = undefined; } else setError(failure); } }
    finally { if (current()) { inFlight.current = false; setBusy(false); setProgress(''); } }
  }
  if (!loggedIn) return <Empty title="登录后发布二手信息"><button className="button" onClick={onLogin}>登录酷安</button></Empty>;
  const categoryKnown = categories.some(row => numeric(row.id) === draft.categoryId);
  return <form className="secondhand-editor" aria-label={id ? '编辑二手信息' : '发布二手信息'} aria-busy={loading || busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
    {loading && <Skeleton />}
    {readError && <ErrorNotice error={readError} onLogin={onLogin} onRetry={() => void load()} />}
    {closed && <p role="status" className="secondhand-warning">此交易已关闭，编辑信息后仍不能重新开启。</p>}
    {restrictionReason && <p role="status" className="secondhand-warning">{restrictionReason}</p>}
    <fieldset disabled={locked || !!id && !hydrated.current}>
      <div className="secondhand-editor-row"><label>交易类型<select aria-label="交易类型" value={draft.dealType} onChange={event => changeDeal(Number(event.target.value))}>{SECONDHAND_DEAL_TYPES.map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
      <label>身份<select aria-label="交易身份" value={draft.storeType} disabled={locked || draft.dealType === 2} onChange={event => patch({ storeType: Number(event.target.value) as Draft['storeType'] })}>{SECONDHAND_STORE_TYPES.map(row => <option key={row.value} value={row.value} disabled={draft.dealType === 2 && row.value !== 2}>{row.label}</option>)}</select></label></div>
      <div className="secondhand-editor-row"><label>品类<select aria-label="发布闲置品类" value={draft.categoryId} onChange={event => changeCategory(event.target.value)}>{!categoryKnown && <option value={draft.categoryId}>{id ? '原品类' : '手机'} #{draft.categoryId}</option>}{categories.map(row => <option key={numeric(row.id)} value={numeric(row.id)}>{plain(row.title || row.name)}</option>)}</select></label>
      <div className="secondhand-model-control"><span>型号</span><button type="button" className="button secondary" onClick={() => setProductPicker(true)}><Search size={15} />{productTitle || '选择型号（选填）'}</button>{draft.productId && <button type="button" className="text-button" onClick={() => { patch({ productId: '', configuration: { type: 'none' } }); setProductTitle(''); }}>清除型号</button>}</div></div>
      <label>标题<input autoFocus aria-label="二手信息标题" value={draft.title} maxLength={SECONDHAND_PUBLISH_LIMITS.title} onChange={event => patch({ title: event.target.value })} placeholder="简要描述你的闲置（可选）" /><small>{draft.title.length} / 50</small></label>
      <label>描述<textarea aria-label="二手信息描述" rows={5} value={draft.message} maxLength={SECONDHAND_PUBLISH_LIMITS.bodyTransport} onChange={event => patch({ message: event.target.value })} placeholder="说明成色、使用情况和交易方式" /></label>
      <div className="secondhand-editor-photos" aria-label="闲置图片"><strong>实拍图片（至少1张，最多9张）</strong>{retained.length > 0 && <div className="secondhand-retained-pictures">{retained.map((url, index) => <div key={`${url}:${index}`}><Picture src={url} alt={`原闲置图片 ${index + 1}`} /><button type="button" className="icon-button" aria-label={`移除原闲置图片 ${index + 1}`} onClick={() => setRetained(values => values.filter((_, i) => i !== index))}><X size={16} /></button></div>)}</div>}<Attachments values={pictures} onChange={setPictures} disabled={locked} limit={9 - retained.length} onError={toast} /></div>
      <div className="secondhand-editor-row"><label>价格方式<select aria-label="闲置价格方式" value={draft.priceType} onChange={event => patch({ priceType: Number(event.target.value) as Draft['priceType'], ...(Number(event.target.value) === 3 ? { price: '' } : {}) })}>{SECONDHAND_PRICE_TYPES.filter(row => draft.dealType === 2 ? [1, 2, 3].includes(row.value) || row.value === draft.priceType : [0, 3].includes(row.value)).map(row => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
      {draft.priceType !== 3 && <label>{draft.priceType === 1 ? '卖家补差价' : draft.priceType === 2 ? '买家补差价' : draft.dealType === 1 ? '收购价格' : '出售价格'}<input aria-label="闲置价格" inputMode="decimal" value={draft.price} maxLength={32} onChange={event => patch({ price: event.target.value })} placeholder="金额（元）" /></label>}</div>
      <label>商品链接{draft.dealType === 1 && '（选填）'}<input aria-label="闲置商品链接" type="url" value={draft.link} maxLength={4096} onChange={event => patch({ link: event.target.value })} placeholder="填写闲鱼、转转等平台的商品链接" /><small>提交前由酷安核对并整理商品链接。</small></label>
      <SecondhandConfigurationPicker namespace={namespace} draft={draft} disabled={locked} onChange={configuration => patch({ configuration })} />
      <button type="button" className="text-button" aria-expanded={locationOpen} onClick={() => setLocationOpen(value => !value)}>所在地{draft.location.city ? `：${draft.location.city}` : ''}</button>
      {locationOpen && <div className="secondhand-editor-location"><label>位置名称<input aria-label="闲置位置名称" value={draft.location.name || ''} maxLength={200} onChange={event => patch({ location: { ...draft.location, name: event.target.value } })} /></label><label>省份<input aria-label="闲置省份" value={draft.location.province || ''} maxLength={200} onChange={event => patch({ location: { ...draft.location, province: event.target.value } })} /></label><label>城市<input aria-label="闲置城市" value={draft.location.city || ''} maxLength={200} onChange={event => patch({ location: { ...draft.location, city: event.target.value } })} /></label><small>可填写所在地。手机定位属于手机系统权限；桌面端不会伪造位置或自动取得手机定位。</small></div>}
      <label>可见范围<select aria-label="闲置可见范围" value={draft.visibility} onChange={event => patch({ visibility: event.target.value as Draft['visibility'] })}><option value="public">公开</option><option value="self">仅自己可见</option></select></label>
    </fieldset>
    <div className="secondhand-editor-agreement"><span>{accepted === true ? <><Check size={15} />已同意酷安二手交易协议</> : '发布前需要阅读并同意二手交易协议'}</span><button type="button" className="text-button" disabled={busy || loading} onClick={() => setAgreementOpen(true)}>阅读二手交易协议</button></div>
    {error && <ErrorNotice error={error} onLogin={onLogin} onRetry={pending.current && !uncertain ? () => void submit(true) : undefined} />}
    {uncertain && <div className="secondhand-warning" role="status"><p>此次提交结果尚未确认，请先检查交易详情或我的最新动态。</p>{id ? <button type="button" className="button secondary" disabled={busy || loading} onClick={() => void load(true)}>重新读取交易</button> : <><label className="secondhand-confirm"><input type="checkbox" checked={checkedMissing} onChange={event => setCheckedMissing(event.target.checked)} />我已检查我的最新动态，确认这次尚未发布</label><button type="button" className="button secondary" disabled={!checkedMissing || busy || !pending.current} onClick={() => void submit(true)}>重试原发布请求</button></>}</div>}
    {error && !uncertain && <button type="button" className="text-button" onClick={editingAgain}>返回修改内容</button>}
    <footer><span aria-live="polite">{progress || `${retained.length + pictures.length} / 9 张图片`}</span><button type="button" className="button secondary" onClick={onClose}>关闭</button><button type="submit" className="button" disabled={locked || !!readError || !!restrictionReason || !draft.message.trim() || !retained.length && !pictures.length || !!id && !hydrated.current}>{busy ? '正在提交…' : accepted !== true ? '阅读协议后继续' : id ? '保存二手信息' : '发布二手信息'}</button></footer>
    {productPicker && <SecondhandProductPicker namespace={namespace} onClose={() => setProductPicker(false)} onSelect={product => { patch({ productId: numeric(product.id), configuration: { type: 'none' } }); setProductTitle(plain(product.title || product.name)); setProductPicker(false); }} />}
    {agreementOpen && <SecondhandAgreement namespace={namespace} accepted={accepted === true} onAccepted={() => { setAccepted(true); setAgreementOpen(false); }} onClose={() => setAgreementOpen(false)} toast={toast} />}
  </form>;
}

function SecondhandConfigurationPicker({ namespace, draft, disabled, onChange }: { namespace: string; draft: Draft; disabled: boolean; onChange: (value: SecondhandConfiguration) => void }) {
  const selected = draft.configuration, type = selected.type;
  const resource = useResource(type === 'custom' ? 'secondhandPublishConfig' : type === 'preset' && draft.productId ? 'secondhandPublishPresets' : null, type === 'custom' ? { categoryId: draft.categoryId, productId: draft.productId, dealType: draft.dealType } : { productId: draft.productId }, namespace);
  const groups: SecondhandConfigGroup[] = type === 'custom' && Array.isArray(resource.data?.data) ? resource.data!.data : [], presets: Entity[] = type === 'preset' && Array.isArray(resource.data?.data) ? resource.data!.data : [];
  function choices(key: string, values: { value: string; other?: boolean }[]) { if (selected.type === 'custom') onChange({ type: 'custom', selections: { ...selected.selections, [key]: values } }); }
  if (draft.categoryId === '104') return <p className="muted">此品类无需填写型号配置。</p>;
  return <fieldset className="secondhand-configuration" disabled={disabled}><legend>型号配置</legend><label>填写方式<select aria-label="型号配置填写方式" value={type} onChange={event => onChange(event.target.value === 'preset' ? { type: 'preset', id: '' } : event.target.value === 'custom' ? { type: 'custom', selections: {} } : { type: event.target.value as 'none' | 'preserve' })}><option value="none">不填写</option>{type === 'preserve' && <option value="preserve">保留原配置</option>}{draft.productId && <option value="preset">选择型号配置</option>}<option value="custom">手动填写</option></select></label>
    {resource.loading && <Skeleton />}{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} />}
    {type === 'preserve' && <small>保存时保留服务端原配置。切换填写方式可重新选择。</small>}
    {type === 'preset' && <label>型号配置<select aria-label="选择型号配置" value={selected.id} onChange={event => onChange({ type: 'preset', id: event.target.value })}><option value="">请选择</option>{presets.map(row => <option key={row.id} value={row.id}>{plain(row.title)} {plain(row.ram)} {plain(row.rom)}</option>)}</select>{!resource.loading && !resource.error && !presets.length && <small>此型号没有可选配置，可改为手动填写。</small>}</label>}
    {type === 'custom' && groups.map(group => {
      const values = selected.selections[group.key] || [], current = values[0];
      return group.single ? <label key={group.key}>{group.label}{group.required && ' *'}<select aria-label={`配置${group.label}`} value={current?.other ? 'other:' : current?.value || ''} onChange={event => choices(group.key, event.target.value ? [{ value: event.target.value === 'other:' ? '' : event.target.value, ...(event.target.value === 'other:' ? { other: true } : {}) }] : [])}><option value="">请选择</option>{group.options.map(value => <option key={value} value={value === '其他' ? 'other:' : value}>{value}</option>)}</select>{current?.other && <input aria-label={`配置${group.label}其他内容`} value={current.value} maxLength={1000} onChange={event => choices(group.key, [{ value: event.target.value, other: true }])} placeholder="填写其他配置" />}</label> : <div key={group.key} className="secondhand-config-extra"><strong>{group.label}</strong>{group.options.filter(value => value !== '其他').map(value => <label key={value}><input type="checkbox" checked={values.some(choice => choice.value === value && !choice.other)} onChange={event => choices(group.key, event.target.checked ? [...values, { value }] : values.filter(choice => choice.value !== value || choice.other))} />{value}</label>)}{group.allowOther && <label>其他<input aria-label={`配置${group.label}其他内容`} value={values.find(choice => choice.other)?.value || ''} maxLength={1000} onChange={event => choices(group.key, [...values.filter(choice => !choice.other), ...(event.target.value ? [{ value: event.target.value, other: true }] : [])])} /></label>}</div>;
    })}
    {type === 'custom' && !resource.loading && !resource.error && !groups.length && <p className="muted">当前品类暂无手动配置选项。</p>}
  </fieldset>;
}
function SecondhandProductPicker({ namespace, onClose, onSelect }: { namespace: string; onClose: () => void; onSelect: (product: Entity) => void }) {
  const [query, setQuery] = useState(''), [keyword, setKeyword] = useState('');
  const resource = useResource(keyword ? 'search' : null, { type: 'product', query: keyword }, namespace);
  const rows = children(resource.data?.data).filter(row => row.entityType === 'product' && numeric(row.id));
  return <Overlay title="选择闲置型号" onClose={onClose}><div className="secondhand-product-picker"><form onSubmit={event => { event.preventDefault(); event.stopPropagation(); setKeyword(query.trim()); }}><label>搜索型号<input autoFocus aria-label="搜索闲置型号" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="输入手机或数码产品型号" /></label><button className="button" disabled={!query.trim()}>搜索</button></form>{resource.loading && <Skeleton />}{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} />}{rows.map(row => <button type="button" className="secondhand-product-choice" key={row.id} onClick={() => onSelect(row)}>{imageUrl(row.logo) && <Picture src={row.logo} alt={plain(row.title)} />}<span>{plain(row.title || row.name)}</span></button>)}{keyword && !resource.loading && !resource.error && !rows.length && <Empty title="没有匹配型号" />}</div></Overlay>;
}
function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const latest = useRef(onClose); latest.current = onClose;
  const close = useCallback(() => latest.current(), []);
  useLayoutEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true); }, [close]);
  return createPortal(<Modal title={title} onClose={close} wide={wide}>{children}</Modal>, document.body);
}
function safeAgreement(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,img,svg,math,form,input,button,meta,link').forEach(node => node.remove());
  return doc.body.innerHTML;
}
function SecondhandAgreement({ namespace, accepted, onAccepted, onClose, toast }: { namespace: string; accepted: boolean; onAccepted: () => void; onClose: () => void; toast: (message: string) => void }) {
  const resource = useResource('secondhandAgreementDetail', {}, namespace);
  const [remaining, setRemaining] = useState(10.5), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const active = useRef(false), sequence = useRef(0), inFlight = useRef(false), intent = useRef<'accept' | 'read'>('accept');
  useLayoutEffect(() => { active.current = true; sequence.current++; return () => { active.current = false; sequence.current++; inFlight.current = false; }; }, []);
  const html = typeof resource.data?.data?.html === 'string' ? resource.data.data.html : '';
  useEffect(() => { setRemaining(10.5); if (!html) return; const end = performance.now() + 10500; const timer = setInterval(() => setRemaining(Math.max(0, (end - performance.now()) / 1000)), 100); return () => clearInterval(timer); }, [html]);
  async function confirm(read = false) {
    if (!active.current || inFlight.current || !read && (!checked || remaining > 0 || !html || resource.error)) return;
    const attempt = ++sequence.current, current = () => active.current && sequence.current === attempt; intent.current = read ? 'read' : 'accept'; inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await call(read ? 'secondhandAgreementState' : 'secondhandAcceptAgreement', read ? {} : { confirmed: true });
      if (!current()) return;
      if (result.data?.accepted !== true) { setError(new ClientError('酷安尚未确认同意状态，请再次阅读后明确同意', 'AGREEMENT_REQUIRED')); return; }
      toast('已同意酷安二手交易协议'); onAccepted();
    } catch (e) { if (current()) setError(asError(e)); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }
  const uncertain = error?.code === 'WRITE_UNCONFIRMED' || error?.code === 'NETWORK' || error?.code === 'HTTP';
  return <Overlay title="酷安二手交易协议" onClose={onClose} wide><div className="secondhand-agreement">
    {resource.loading && <Skeleton />}{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} />}
    {html && <div className="secondhand-agreement-body" tabIndex={0}><RichText text={safeAgreement(html)} onLink={url => { void unwrap(window.coolapk?.openExternal(url)).catch(e => toast((e as Error).message)); }} /></div>}
    {!accepted && <label className="secondhand-confirm"><input type="checkbox" checked={checked} disabled={busy || !!error || !html} onChange={event => setChecked(event.target.checked)} />我已阅读并同意酷安二手交易协议</label>}
    {error && <ErrorNotice error={error} onRetry={!uncertain ? () => void confirm(intent.current === 'read') : undefined} />}
    {uncertain && <p className="secondhand-warning">同意结果尚未确认。请重新读取协议状态核对。</p>}
    <footer><button type="button" className="button secondary" onClick={onClose}>{accepted ? '关闭协议' : '取消'}</button>{accepted ? <span>当前账号已同意</span> : error ? <><button type="button" className="button secondary" disabled={busy} onClick={() => void confirm(true)}>重新读取同意状态</button>{!uncertain && <button type="button" className="text-button" disabled={busy} onClick={() => setError(undefined)}>返回阅读</button>}</> : <button type="button" className="button" disabled={busy || !html || !!resource.error || !checked || remaining > 0} onClick={() => void confirm()}>{busy ? '正在确认…' : remaining > 0 ? `请阅读协议（${Math.ceil(remaining)}秒）` : '同意协议'}</button>}</footer>
  </div></Overlay>;
}

export function SecondhandCloseButton(props: { id: string; namespace: string; loggedIn: boolean; onLogin: () => void; onClosed: () => void; toast: (message: string) => void; disabled?: boolean }) { return <CloseButton key={`${props.namespace}:${props.id}:${props.loggedIn}`} {...props} />; }
function CloseButton({ id, loggedIn, onLogin, onClosed, toast, disabled }: { id: string; namespace: string; loggedIn: boolean; onLogin: () => void; onClosed: () => void; toast: (message: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const active = useRef(false), sequence = useRef(0), inFlight = useRef(false);
  useLayoutEffect(() => { active.current = true; sequence.current++; return () => { active.current = false; sequence.current++; inFlight.current = false; }; }, []);
  function dismiss() { if (inFlight.current) return; sequence.current++; setOpen(false); setError(undefined); }
  async function close(read = false) {
    if (!active.current || inFlight.current || disabled) return;
    const attempt = ++sequence.current, current = () => active.current && sequence.current === attempt; inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await call(read ? 'secondhandStatus' : 'secondhandClose', read ? { id } : { id, confirmed: true });
      if (!current()) return;
      if (result.data?.id !== id) throw new ClientError('交易状态无法确认，请重新读取核对', 'WRITE_UNCONFIRMED');
      if (result.data?.closed !== true) { setError(new ClientError('交易仍显示开放，请核对后重新确认关闭', 'NOT_CLOSED')); return; }
      toast('交易已关闭'); onClosed(); setOpen(false);
    } catch (e) { if (current()) setError(asError(e)); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }
  const uncertain = error && ['WRITE_UNCONFIRMED', 'NETWORK', 'HTTP'].includes(error.code);
  return <><button type="button" className="text-button danger" disabled={disabled || busy} onClick={() => { if (!loggedIn) return onLogin(); setError(undefined); setOpen(true); }}>关闭交易</button>{open && <Overlay title="关闭交易" onClose={dismiss}><div className="secondhand-close-confirm" aria-busy={busy}><p>确定要关闭此交易吗？<br />关闭后无法再开启</p>{error && <ErrorNotice error={error} onLogin={onLogin} onRetry={error.code === 'VERIFY_REQUIRED' ? () => void close() : undefined} />}{uncertain && <p className="secondhand-warning">关闭结果尚未确认，请刷新核对。</p>}<footer><button type="button" className="button secondary" disabled={busy} onClick={dismiss}>取消</button>{error ? <><button type="button" className="button secondary" disabled={busy} onClick={() => void close(true)}>重新读取交易状态</button>{error.code === 'NOT_CLOSED' && <button type="button" className="text-button" disabled={busy} onClick={() => setError(undefined)}>返回确认</button>}</> : <button type="button" className="button danger" disabled={busy} onClick={() => void close()}>{busy ? '正在关闭…' : '确定关闭交易'}</button>}</footer></div></Overlay>}</>;
}
