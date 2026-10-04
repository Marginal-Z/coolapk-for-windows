import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AtSign, Hash, Plus, Save, Trash2 } from 'lucide-react';
import { CREATION_LIMITS, normalizeQuestionTitle, preparePoll, prepareQuestion, type CreationPublishOptions } from '../core/creation-models.mjs';
import { composeSelection, insertComposeText } from '../core/compose-text.mjs';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import ComposeTools, { type ComposeTool } from './ComposeTools';
import { Empty, ErrorNotice, Modal, Skeleton } from './components';
import { call, ClientError, plain, useResource } from './data';
import type { Entity } from './types';
import './creation.css';

type Props = { kind: 'question' | 'poll'; namespace: string; loggedIn: boolean; restrictionReason?: string; onLogin: () => void; onClose: () => void; onCreated: (feed: Entity) => void; onOpenQuestion?: (id: string) => void; toast: (message: string) => void };
type Draft = { title: string; message: string; pollType: number; options: string[]; endTime: number; maxSelectNum: number; colors?: string[]; publishOptions: CreationPublishOptions };
const defaults: Draft = { title: '', message: '', pollType: 1, options: ['', '', '', ''], endTime: 604800, maxSelectNum: 1, publishOptions: { targetType: '', targetId: '', visibleStatus: 1, originalType: 0 } };
const numeric = (value: unknown) => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : '';
const asError = (error: unknown) => error instanceof ClientError ? error : new ClientError((error as Error)?.message || '提交失败', (error as any)?.code || 'APP_ERROR');

export function CreationDialog(props: Props) { return <OwnedDialog key={props.namespace + ':' + props.kind} {...props} />; }
function OwnedDialog(props: Props) {
  const latest = useRef(props.onClose); latest.current = props.onClose;
  const close = useCallback(() => latest.current(), []);
  return <Modal title={props.kind === 'question' ? '提问' : '发起投票'} onClose={close} wide><CreationEditor {...props} /></Modal>;
}
export function CreationEditor(props: Props) { return <Editor key={props.namespace + ':' + props.kind} {...props} />; }
function Editor({ kind, namespace, loggedIn, restrictionReason, onLogin, onClose, onCreated, onOpenQuestion, toast }: Props) {
  const [draft, setDraft] = useState<Draft>(() => structuredClone(defaults)), [pictures, setPictures] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState<ClientError>();
  const [checkedMissing, setCheckedMissing] = useState(false), [settings, setSettings] = useState(false), [tool, setTool] = useState<ComposeTool>();
  const [saved, setSaved] = useState(false), [relatedTitle, setRelatedTitle] = useState('');
  const generation = useRef(0), active = useRef(false), inFlight = useRef(false), pending = useRef<{ operation: string; args: Entity } | undefined>(undefined);
  const editor = useRef<HTMLTextAreaElement>(null), selection = useRef({ start: 0, end: 0 }), draftKey = `coolapk:creation-draft:${namespace}:${kind}`;
  const locked = busy || !!error;
  const uncertain = !!error && ['WRITE_UNCONFIRMED', 'NETWORK', 'HTTP'].includes(error.code);
  useLayoutEffect(() => { active.current = true; generation.current++; return () => { active.current = false; generation.current++; inFlight.current = false; pending.current = undefined; }; }, []);
  useEffect(() => { if (restrictionReason) { generation.current++; inFlight.current = false; pending.current = undefined; setBusy(false); setProgress(''); setError(undefined); } }, [restrictionReason]);
  useEffect(() => { try { setSaved(!!localStorage.getItem(draftKey)); } catch { setSaved(false); } }, [draftKey]);
  useEffect(() => {
    if (kind !== 'question' || !draft.title.trim()) { setRelatedTitle(''); return; }
    const timer = setTimeout(() => { try { setRelatedTitle(normalizeQuestionTitle(draft.title)); } catch { setRelatedTitle(''); } }, 500);
    return () => clearTimeout(timer);
  }, [draft.title, kind]);
  const related = useResource(kind === 'question' && relatedTitle ? 'relatedQuestions' : null, { title: relatedTitle }, namespace);
  const relatedRows: Entity[] = Array.isArray(related.data?.data) ? related.data!.data : [];
  function patch(value: Partial<Draft>) { if (!locked) { pending.current = undefined; setDraft(previous => ({ ...previous, ...value })); } }
  function rememberSelection() { if (editor.current) selection.current = composeSelection(draft.message, editor.current.selectionStart, editor.current.selectionEnd); }
  function insert(kind: ComposeTool, values: Entity[]) {
    if (locked) return false;
    try { const next = insertComposeText(draft.message, selection.current, kind, values, CREATION_LIMITS.ordinaryBody); patch({ message: next.message }); selection.current = { start: next.start, end: next.end }; requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(next.start, next.end); }); return true; }
    catch (e) { toast((e as Error).message); return false; }
  }
  function saveDraft() {
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); setSaved(true); toast('文字草稿已保存；本地图片需要重新选择'); }
    catch { toast('无法保存草稿，请检查本地存储空间'); }
  }
  function loadDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (!value || typeof value.title !== 'string' || typeof value.message !== 'string' || value.title.length > 60 || value.message.length > 2000 || !Array.isArray(value.options) || value.options.length > 10 || value.options.some((option: unknown) => typeof option !== 'string' || option.length > 20)) throw new Error('invalid draft');
      patch({ ...defaults, ...value }); clearAttachments(pictures); setPictures([]); toast('已载入文字草稿，请重新选择本地图片');
    } catch { toast('草稿格式无效，未载入'); }
  }
  function editable() { generation.current++; pending.current = undefined; setError(undefined); setCheckedMissing(false); }
  async function submit(retry = false) {
    if (!loggedIn) return onLogin();
    if (restrictionReason) return;
    if (!active.current || inFlight.current || uncertain && !checkedMissing) return;
    const attempt = ++generation.current, current = () => active.current && generation.current === attempt;
    inFlight.current = true; setBusy(true); setError(undefined); setCheckedMissing(false);
    try {
      let request = retry ? pending.current : undefined;
      if (!request) {
        const input = kind === 'question' ? prepareQuestion({ title: draft.title, message: draft.message, publishOptions: draft.publishOptions }) : preparePoll({ title: draft.title, message: draft.message, pollType: draft.pollType, options: draft.options, endTime: draft.endTime, maxSelectNum: draft.maxSelectNum, colors: draft.colors, publishOptions: draft.publishOptions });
        const args: Entity = structuredClone(input);
        if (kind === 'question') { const values = [...pictures]; args.pic = await uploadAttachments(values, value => { if (current()) setProgress(value); }, { shouldContinue: current }); }
        if (!current()) return;
        request = { operation: kind === 'question' ? 'questionCreate' : 'pollCreate', args }; pending.current = request;
      }
      setProgress('正在发布…'); const result = await call(request.operation, request.args);
      if (!current()) return;
      if (!numeric(result.data?.id)) throw new ClientError('服务端未返回发布结果，请先检查最新动态，避免重复发布', 'WRITE_UNCONFIRMED');
      try { localStorage.removeItem(draftKey); } catch { /* The confirmed post remains usable when storage is unavailable. */ }
      setSaved(false); toast(kind === 'question' ? '问题已发布' : '投票已发布'); onCreated(result.data);
    } catch (e) { if (current()) setError(asError(e)); }
    finally { if (current()) { inFlight.current = false; setBusy(false); setProgress(''); } }
  }
  if (!loggedIn) return <Empty title="登录后发布"><button className="button" onClick={onLogin}>登录酷安</button></Empty>;
  return <form className="creation-editor" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {restrictionReason && <p role="status" className="muted">{restrictionReason}，可以继续编辑或保存文字草稿。</p>}
    <label>{kind === 'question' ? '问题标题' : '投票标题'}<input autoFocus aria-label={kind === 'question' ? '问题标题' : '投票标题'} value={draft.title} disabled={locked} maxLength={kind === 'question' ? CREATION_LIMITS.questionTitle : CREATION_LIMITS.pollTitle} onChange={event => patch({ title: event.target.value })} placeholder={kind === 'question' ? '描述清楚你想问的问题' : '输入投票标题'} /><small>{draft.title.length} / {kind === 'question' ? 60 : 50}{kind === 'question' && '；发布时补齐问号'}</small></label>
    {kind === 'question' && relatedRows.length > 0 && onOpenQuestion && <aside className="creation-related" aria-label="相似问题"><strong>相似问题</strong>{relatedRows.slice(0, 6).filter(row => numeric(row.id)).map(row => <button type="button" className="text-button" key={row.id} disabled={busy} onClick={() => onOpenQuestion(String(row.id))}>{plain(row.messageTitle || row.message_title || row.title || '查看问题')}</button>)}</aside>}
    {kind === 'question' && related.error && <ErrorNotice error={related.error} onRetry={related.retry} />}
    <label>{kind === 'question' ? '问题补充' : '投票说明'}<textarea ref={editor} rows={5} aria-label={kind === 'question' ? '问题补充' : '投票说明'} value={draft.message} disabled={locked} maxLength={2000} onSelect={rememberSelection} onBlur={rememberSelection} onChange={event => { if ([...event.target.value].length <= 1000) { patch({ message: event.target.value }); selection.current = composeSelection(event.target.value, event.target.selectionStart, event.target.selectionEnd); } else toast('正文最多 1000 字'); }} placeholder={kind === 'question' ? '补充背景、遇到的问题和已经尝试的方法' : '填写投票说明（可选）'} /></label>
    <div className="creation-tools" role="toolbar" aria-label="正文工具">{(['mention', 'topic'] as const).map(value => <button key={value} type="button" className="text-button" disabled={locked} aria-expanded={tool === value} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => setTool(tool === value ? undefined : value)}>{value === 'mention' ? <AtSign size={16} /> : <Hash size={16} />}{value === 'mention' ? '@用户' : '添加话题'}</button>)}</div>
    {tool && <ComposeTools kind={tool} namespace={namespace} disabled={locked} onInsert={insert} onClose={() => { setTool(undefined); editor.current?.focus(); }} />}
    {kind === 'question' && <Attachments values={pictures} onChange={setPictures} disabled={locked} onError={toast} limit={9} />}
    {kind === 'poll' && <fieldset className="creation-poll" disabled={locked}><legend>投票设置</legend>
      <label>投票类型<select aria-label="投票类型" value={draft.pollType} onChange={event => { const type = Number(event.target.value); patch({ pollType: type, options: type === 0 ? draft.options.slice(0, 2) : draft.options, maxSelectNum: 1, colors: undefined }); }}><option value={1}>选项投票</option><option value={0}>PK 投票</option></select></label>
      <div className="creation-options">{draft.options.map((value, index) => <div key={index}><label>{draft.pollType === 0 ? index === 0 ? '正方观点' : '反方观点' : `选项 ${index + 1}`}<input aria-label={draft.pollType === 0 ? index === 0 ? '正方观点' : '反方观点' : `投票选项 ${index + 1}`} value={value} maxLength={draft.pollType === 0 ? 10 : 20} onChange={event => patch({ options: draft.options.map((old, i) => i === index ? event.target.value : old) })} /><small>{value.length} / {draft.pollType === 0 ? 10 : 20}</small></label>{draft.pollType === 1 && draft.options.length > 2 && <button type="button" className="icon-button" aria-label={`删除选项 ${index + 1}`} onClick={() => patch({ options: draft.options.filter((_, i) => i !== index), maxSelectNum: Math.min(draft.maxSelectNum, draft.options.length - 1) })}><Trash2 size={16} /></button>}</div>)}</div>
      {draft.pollType === 1 && <button type="button" className="text-button" disabled={draft.options.length >= 10} onClick={() => patch({ options: [...draft.options, ''] })}><Plus size={16} />添加选项（{draft.options.length} / 10）</button>}
      <div className="creation-poll-controls"><label>截止时间<select aria-label="投票截止时间" value={draft.endTime} onChange={event => patch({ endTime: Number(event.target.value) })}><option value={86400}>24 小时</option><option value={604800}>7 天</option><option value={2592000}>30 天</option></select></label>
      {draft.pollType === 1 && <label>投票上限<select aria-label="投票上限" value={draft.maxSelectNum} onChange={event => patch({ maxSelectNum: Number(event.target.value) })}>{draft.options.map((_, i) => <option key={i + 1} value={i + 1}>{i === 0 ? '单项' : `${i + 1} 项`}</option>)}</select></label>}
      {draft.pollType === 0 && <><label>正方颜色<input type="color" aria-label="正方颜色" value={draft.colors?.[0] || '#e57373'} onChange={event => patch({ colors: [event.target.value, draft.colors?.[1] || '#64b5f6'] })} /></label><label>反方颜色<input type="color" aria-label="反方颜色" value={draft.colors?.[1] || '#64b5f6'} onChange={event => patch({ colors: [draft.colors?.[0] || '#e57373', event.target.value] })} /></label></>}
      </div></fieldset>}
    <button type="button" className="text-button" disabled={locked} aria-expanded={settings} onClick={() => setSettings(value => !value)}>发布板块、可见范围与内容声明</button>
    {settings && <CreationOptions namespace={namespace} value={draft.publishOptions} onChange={value => patch({ publishOptions: value })} disabled={locked} />}
    {error && <ErrorNotice error={error} onLogin={onLogin} onRetry={pending.current && !uncertain ? () => void submit(true) : undefined} />}
    {uncertain && <label className="creation-confirm"><input type="checkbox" checked={checkedMissing} onChange={event => setCheckedMissing(event.target.checked)} />我已检查最新动态，确认这次内容尚未发布<button type="button" className="button secondary" disabled={!checkedMissing || busy || !pending.current} onClick={() => void submit(true)}>重试原发布请求</button></label>}
    {error && !uncertain && <button type="button" className="text-button" disabled={busy} onClick={editable}>返回修改内容</button>}
    <footer><span aria-live="polite">{progress || `${[...draft.message].length} / 1000`}</span><button type="button" className="text-button" disabled={locked} onClick={saveDraft}><Save size={16} />保存文字草稿</button>{saved && <button type="button" className="text-button" disabled={locked} onClick={loadDraft}>载入草稿</button>}<button type="button" className="button secondary" onClick={onClose}>关闭</button><button type="submit" className="button" disabled={!!restrictionReason || locked || !draft.title.trim()}>{busy ? '正在提交…' : kind === 'question' ? '发布问题' : '发布投票'}</button></footer>
  </form>;
}

function CreationOptions({ namespace, value, onChange, disabled }: { namespace: string; value: CreationPublishOptions; onChange: (value: CreationPublishOptions) => void; disabled: boolean }) {
  const [query, setQuery] = useState(''), [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 350); return () => clearTimeout(timer); }, [query]);
  const topic = value.targetType === 'tag';
  const resource = useResource(value.targetType && debounced ? topic ? 'searchPublishTopics' : 'search' : null, topic ? { query: debounced, recentIds: '' } : { type: 'product', query: debounced }, namespace);
  const dyhs = useResource('catalogDyhEditing', {}, namespace);
  const rows = (source: any): Entity[] => Array.isArray(source) ? source.flatMap(row => Array.isArray(row.entities) ? row.entities : [row]) : [];
  return <fieldset className="creation-publish-options" disabled={disabled}>
    <label>发布板块<select aria-label="发布板块" value={value.targetType || ''} onChange={event => { setQuery(''); setDebounced(''); onChange({ ...value, targetType: event.target.value as CreationPublishOptions['targetType'], targetId: '' }); }}><option value="">个人动态</option><option value="tag">话题</option><option value="product_phone">数码产品</option></select></label>
    {value.targetType && <div className="creation-board-picker"><label>搜索{topic ? '话题' : '数码产品'}<input aria-label="搜索发布板块" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>{resource.loading && <Skeleton />}{resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} />}{rows(resource.data?.data).filter(row => topic ? row.entityType === 'topic' || row.tag : row.entityType === 'product').slice(0, 6).map(row => <button type="button" className="text-button" key={row.id || row.tag} onClick={() => onChange({ ...value, targetId: topic ? plain(row.tag || row.title).replace(/^#|#$/g, '').trim() : String(row.id) })}>{plain(row.title || row.tag)}</button>)}{value.targetId && <small>已选择：{value.targetId}</small>}</div>}
    <label>可见范围<select aria-label="可见范围" value={value.visibleStatus ?? 1} onChange={event => onChange({ ...value, visibleStatus: Number(event.target.value) })}><option value={1}>公开</option><option value={-1}>仅自己可见</option></select></label>
    <label>内容声明<select aria-label="内容声明" value={value.originalType ?? 0} onChange={event => onChange({ ...value, originalType: Number(event.target.value) })}><option value={0}>无声明</option><option value={1}>原创</option><option value={2}>转载</option><option value={3}>非原创</option></select></label>
    <label>附加链接<input type="url" aria-label="附加链接" value={value.extraUrl || ''} onChange={event => onChange({ ...value, extraUrl: event.target.value })} placeholder="https://" /></label>
    <label>发布到我的酷安号<select aria-label="发布到我的酷安号" value={value.dyhId || ''} onChange={event => onChange({ ...value, dyhId: event.target.value })}><option value="">个人动态</option>{rows(dyhs.data?.data).map(row => <option key={row.id || row.dyhId} value={row.id || row.dyhId}>{plain(row.title || row.name)}</option>)}</select></label>{dyhs.error && <ErrorNotice error={dyhs.error} onRetry={dyhs.retry} />}
  </fieldset>;
}
