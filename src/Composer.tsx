import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AtSign, FileText, Film, Hash, Save, Trash2 } from 'lucide-react';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { ErrorNotice, Modal } from './components';
import { call, plain, ClientError } from './data';
import type { Entity } from './types';
import './composer.css';
import PublishOptions from './PublishOptions';
import ComposeTools, { type ComposeTool } from './ComposeTools';
import { composeSelection, insertComposeText } from '../core/compose-text.mjs';
type Draft = { id: string; message: string; title: string; mode: string; options: Entity; updated: number; forwardId?: string };
function readDrafts(key: string): Draft[] { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.filter(x => typeof x.id === 'string' && typeof x.message === 'string').slice(0, 20) : []; } catch { return []; } }
type ComposeProps = { forward?: Entity; namespace: string; restrictionReason?: string; initialShowDrafts?: boolean; initialMode?: 'feed' | 'article' | 'video'; initialMessage?: string; onSpecial?: (kind: 'question' | 'poll' | 'secondhand') => void; onClose: () => void; onDone: () => void; toast: (message: string) => void };
export default function ComposeModal(props: ComposeProps) { return <ComposeBody key={props.namespace} {...props} />; }
function ComposeBody({ forward, namespace, restrictionReason, initialShowDrafts = false, initialMessage = '', initialMode = 'feed', onSpecial, onClose, onDone, toast }: ComposeProps) {
  const [message, setMessage] = useState(initialMessage), [title, setTitle] = useState(''), [mode, setMode] = useState<string>(initialMode);
  const [options, setOptions] = useState<Entity>({ targetType: '', targetId: '', visibleStatus: 1, originalType: 0 });
  const [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [pictures, setPictures] = useState<Attachment[]>([]), [video, setVideo] = useState<File>();
  const [videoPreview, setVideoPreview] = useState(''), [videoResult, setVideoResult] = useState<Entity>();
  const [progress, setProgress] = useState(''), [preview, setPreview] = useState(false), [advanced, setAdvanced] = useState(false);
  const key = `coolapk-drafts:${namespace}`, [drafts, setDrafts] = useState(() => readDrafts(key)), [draftId, setDraftId] = useState(''), [showDrafts, setShowDrafts] = useState(initialShowDrafts);
  const generation = useRef(0), active = useRef(false), inFlight = useRef(false), uncertain = useRef(false), pendingArgs = useRef<Entity | undefined>(undefined);
  const [tool, setTool] = useState<ComposeTool>(), [restoreSelection, setRestoreSelection] = useState<{ start: number; end: number }>();
  const editor = useRef<HTMLTextAreaElement>(null), selection = useRef({ start: 0, end: 0 });
  const locked = busy || !!error?.verificationId;
  const max = mode === 'article' ? 12000 : 1000;
  useLayoutEffect(() => { active.current = true; generation.current++; return () => { active.current = false; generation.current++; inFlight.current = false; }; }, []);
  useLayoutEffect(() => { if (restrictionReason) { generation.current++; pendingArgs.current = undefined; inFlight.current = false; setBusy(false); setProgress(''); setError(undefined); } }, [restrictionReason]);
  useLayoutEffect(() => { if (restoreSelection && editor.current) { editor.current.focus(); editor.current.setSelectionRange(restoreSelection.start, restoreSelection.end); selection.current = restoreSelection; } }, [restoreSelection, preview, message]);
  useEffect(() => { if (!video) { setVideoPreview(''); return; } const url = URL.createObjectURL(video); setVideoPreview(url); return () => URL.revokeObjectURL(url); }, [video]);
  function option(field: string, value: any) { setOptions(old => ({ ...old, [field]: value })); }
  function rememberSelection() { if (editor.current) selection.current = composeSelection(message, editor.current.selectionStart, editor.current.selectionEnd); }
  function closeTool() { setTool(undefined); setPreview(false); setRestoreSelection({ ...selection.current }); }
  function insert(kind: ComposeTool, values: Entity[]) {
    if (locked) return false;
    try { const next = insertComposeText(message, selection.current, kind, values, max); setMessage(next.message); selection.current = { start: next.start, end: next.end }; setRestoreSelection({ ...selection.current }); pendingArgs.current = undefined; return true; }
    catch (error) { toast((error as Error).message); return false; }
  }
  function saveDraft() {
    const item = { id: draftId || crypto.randomUUID(), message, title, mode, options, updated: Date.now(), ...(forward?.id ? { forwardId: String(forward.id) } : {}) };
    const next = [item, ...drafts.filter(d => d.id !== item.id)].slice(0, 20);
    try { localStorage.setItem(key, JSON.stringify(next)); setDrafts(next); setDraftId(item.id); toast('文字草稿已保存；再次发送时重新选择本地附件'); return true; }
    catch { toast('文字草稿未保存，请检查本地存储空间'); return false; }
  }
  function special(kind: 'question' | 'poll' | 'secondhand') {
    if (locked || !onSpecial) return;
    if ((message.trim() || title.trim() || pictures.length || video) && !saveDraft()) return;
    onSpecial(kind);
  }
  function deleteDraft(id: string) { const next = drafts.filter(d => d.id !== id); localStorage.setItem(key, JSON.stringify(next)); setDrafts(next); if (id === draftId) setDraftId(''); }
  function loadDraft(draft: Draft) {
    if (locked) return;
    if ((draft.forwardId || '') !== (forward?.id ? String(forward.id) : '')) { toast('这是转发草稿，请从对应的原动态打开转发后载入'); return; }
    generation.current++; pendingArgs.current = undefined;
    clearAttachments(pictures); setPictures([]);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideo(undefined); setVideoPreview(''); setVideoResult(undefined);
    setError(undefined); setProgress(''); setMessage(draft.message); setTitle(draft.title); setMode(draft.mode); setOptions(draft.options); setDraftId(draft.id);
    setShowDrafts(false); setTool(undefined); setPreview(false);
    selection.current = { start: draft.message.length, end: draft.message.length }; setRestoreSelection({ ...selection.current });
  }
  async function prepareVideo(file: File, current: () => boolean) {
    const objectUrl = URL.createObjectURL(file), element = document.createElement('video'); element.preload = 'auto'; element.muted = true; element.src = objectUrl;
    try {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('无法读取视频，请选择可播放的 MP4 或 MOV')), 20000); element.onloadeddata = () => { clearTimeout(timer); resolve(); }; element.onerror = () => { clearTimeout(timer); reject(new Error('无法读取视频，请选择 MP4 或 MOV')); }; element.load(); });
      if (!Number.isFinite(element.duration) || element.duration <= 0) throw new Error('无法识别视频时长');
      const canvas = document.createElement('canvas'), ratio = Math.min(1, 1280 / Math.max(element.videoWidth, element.videoHeight)); canvas.width = Math.round(element.videoWidth * ratio); canvas.height = Math.round(element.videoHeight * ratio);
      canvas.getContext('2d')!.drawImage(element, 0, 0, canvas.width, canvas.height);
      const cover = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('视频封面生成失败')), 'image/jpeg', .9));
      const bytes = new Uint8Array(await file.arrayBuffer()), coverBytes = new Uint8Array(await cover.arrayBuffer());
      if (!current()) throw new Error('页面或账号已切换');
      const result = await call('uploadVideo', { bytes, coverBytes, duration: Math.ceil(element.duration), name: file.name });
      if (!result.data?.mediaUrl || !result.data?.mediaInfo) throw new Error('视频上传未返回可发布的结果');
      if (current()) setVideoResult(result.data); return result.data;
    } finally { element.pause(); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(objectUrl); }
  }
  async function submit() {
    if (!active.current || inFlight.current || uncertain.current || restrictionReason) return;
    const attempt = generation.current, current = () => active.current && generation.current === attempt;
    let writeIssued = false;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      let args = pendingArgs.current;
      if (!args) {
        const pic = await uploadAttachments(pictures, text => { if (current()) setProgress(text); }, { shouldContinue: current });
        if (!current()) return;
        let uploaded = videoResult;
        if (mode === 'video' && !uploaded) { if (!video) throw new Error('请选择视频'); setProgress('正在上传视频和封面…'); uploaded = await prepareVideo(video, current); }
        if (!current()) return;
        const advancedOptions = { ...options, ...(mode === 'article' ? { htmlArticle: true, messageTitle: title, messageCover: pictures[0]?.url || '' } : {}), ...(mode === 'video' ? { mediaUrl: uploaded!.mediaUrl, mediaInfo: uploaded!.mediaInfo } : {}) };
        const simple = mode === 'feed' && !options.targetType && !options.dyhId && !options.largeCover && !options.extraUrl && options.visibleStatus === 1 && options.originalType === 0;
        args = { operation: forward || simple ? 'action' : 'publishAdvanced', parameters: forward || simple ? { type: forward ? 'forward' : 'publish', id: forward?.id ? String(forward.id) : undefined, message, pic } : { message, pic, options: advancedOptions } };
        pendingArgs.current = args;
      }
      setProgress('正在发布…'); writeIssued = true;
      const result = await call(args.operation, args.parameters);
      if (!current()) return;
      if (!/^[1-9]\d{0,19}$/.test(String(result.data?.id ?? ''))) throw new ClientError('服务端未返回有效的发布结果，请先检查你的最新动态，避免重复发布', 'WRITE_UNCONFIRMED');
      if (current()) { if (draftId) deleteDraft(draftId); toast(forward ? '已转发' : mode === 'article' ? '文章已发布' : mode === 'video' ? '视频已发布' : '动态已发布'); onDone(); }
    } catch (e) { if (current()) {
      let failure = e instanceof ClientError ? e : new ClientError((e as Error).message);
      if (writeIssued && (failure.code === 'WRITE_UNCONFIRMED' || ['NETWORK', 'HTTP', 'APP_ERROR'].includes(failure.code) || failure.code === 'VERIFY_REQUIRED' && !failure.verificationId)) {
        uncertain.current = true; setUnconfirmed(true);
        failure = new ClientError('提交结果尚未确认，请先查看“我的”中的最新动态；核对后另开编辑，避免重复发布', 'WRITE_UNCONFIRMED');
        saveDraft();
      }
      setError(failure); if (!failure.verificationId) pendingArgs.current = undefined;
    } }
    finally { if (current()) { inFlight.current = false; setBusy(false); setProgress(''); } }
  }
  return <Modal title={forward ? '转发动态' : '发布动态'} onClose={onClose} wide={!forward}><form className="compose-body advanced-compose" onSubmit={e => { e.preventDefault(); void submit(); }}>
    {restrictionReason && <p role="status" className="muted">{restrictionReason}，可以继续编辑或保存文字草稿。</p>}
    {unconfirmed && <p role="status" className="muted">本次提交结果尚未确认，已暂停再次发送。可以保存文字草稿或关闭；先到“我的”核对最新动态，再另开编辑。</p>}
    {!forward && <div className="composer-tabs" role="tablist" aria-label="发布类型">{[['feed', '动态'], ['article', '图文文章'], ['video', '视频']].map(([id, label]) => <button type="button" role="tab" aria-selected={mode === id} disabled={locked} key={id} onClick={() => { setMode(id); if (id === 'article') setOptions(old => ({ ...old, largeCover: false })); pendingArgs.current = undefined; }}>{id === 'article' ? <FileText size={16} /> : id === 'video' ? <Film size={16} /> : null}{label}</button>)}<button type="button" className="text-button" disabled={locked} onClick={() => setShowDrafts(v => !v)}>草稿（{drafts.length}）</button></div>}
    {forward && <button type="button" className="text-button" disabled={locked} onClick={() => setShowDrafts(v => !v)}>草稿（{drafts.length}）</button>}
    {!forward && onSpecial && <div className="composer-text-tools" role="toolbar" aria-label="更多发布类型"><button type="button" className="text-button" disabled={locked} onClick={() => special('question')}>提问</button><button type="button" className="text-button" disabled={locked} onClick={() => special('poll')}>发起投票</button><button type="button" className="text-button" disabled={locked} onClick={() => special('secondhand')}>闲置交易</button></div>}
    {showDrafts && <div className="composer-drafts">{drafts.length ? drafts.map(draft => <div key={draft.id}><button type="button" disabled={locked} onClick={() => loadDraft(draft)}>{draft.title || draft.message.slice(0, 50) || '未命名草稿'}<small>{new Date(draft.updated).toLocaleString()}</small></button><button type="button" className="icon-button" aria-label="删除草稿" disabled={locked} onClick={() => deleteDraft(draft.id)}><Trash2 size={16} /></button></div>) : <p>尚未保存文字草稿。</p>}</div>}
    {mode === 'article' && <label>文章标题<input aria-label="文章标题" value={title} maxLength={100} disabled={locked} onChange={e => setTitle(e.target.value)} placeholder="输入文章标题" /></label>}
    <div className="compose-preview-toggle"><label htmlFor="publish-message">{forward ? '说说你的想法' : mode === 'article' ? '文章正文' : '今天有什么想和酷友分享？'}</label><button type="button" className="text-button" onClick={() => setPreview(v => !v)}>{preview ? '继续编辑' : '预览'}</button></div>
    {preview ? <div className="composer-preview"><h2>{title}</h2><div>{message}</div>{pictures.map(item => <img key={item.preview} src={item.preview} alt="待发布图片" />)}</div> : <textarea ref={editor} id="publish-message" rows={8} value={message} maxLength={max * 2} disabled={locked} onSelect={rememberSelection} onBlur={rememberSelection} onChange={e => { if ([...e.target.value].length > max) { toast(`正文不能超过 ${max} 字`); return; } setMessage(e.target.value); selection.current = composeSelection(e.target.value, e.target.selectionStart, e.target.selectionEnd); setRestoreSelection(undefined); pendingArgs.current = undefined; }} placeholder="写下你的发现…" />}
    <div className="composer-text-tools" role="toolbar" aria-label="正文工具">{[['mention', '@用户'], ['topic', '添加话题']].map(([kind, label]) => <button type="button" className="text-button" key={kind} aria-expanded={tool === kind} disabled={locked} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => { rememberSelection(); setTool(tool === kind ? undefined : kind as ComposeTool); }}>{kind === 'mention' ? <AtSign size={18} /> : <Hash size={18} />}{label}</button>)}</div>
    {tool && <ComposeTools namespace={namespace} kind={tool} disabled={locked} onInsert={insert} onClose={closeTool} />}
    {mode !== 'video' && <Attachments values={pictures} onChange={setPictures} disabled={locked} onError={toast} />}
    {mode === 'video' && <div className="composer-video"><label>选择视频<input aria-label="选择视频附件" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" disabled={locked} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > 256 * 1024 ** 2 || !file.size) { toast('视频必须非空且不超过 256 MB'); return; } setVideo(file); setVideoResult(undefined); pendingArgs.current = undefined; }} /></label>{videoPreview && <video src={videoPreview} controls preload="metadata" />}<small>MP4 / MOV，最大 256 MB；上传时自动生成 JPG 封面。</small></div>}
    {forward && <div className="forward-preview"><strong>@{forward.username}</strong><p>{plain(forward.message).slice(0, 180)}</p></div>}
    {!forward && <><button type="button" className="text-button" disabled={locked} onClick={() => setAdvanced(v => !v)}>{advanced ? '收起发布设置' : '发布板块、可见范围与内容声明'}</button>{advanced && <PublishOptions options={options} onChange={setOptions} mode={mode} namespace={namespace} disabled={locked} />}</>}
    {error && <ErrorNotice error={error} onRetry={unconfirmed ? undefined : submit} />}<div className="compose-footer"><span>{progress || `${[...message].length} / ${max}`}</span><button type="button" className="text-button" disabled={locked} onClick={saveDraft}><Save size={16} />保存文字草稿</button><button className="button" disabled={unconfirmed || !!restrictionReason || locked || (mode === 'article' && !title.trim()) || (!message.trim() && !pictures.length && !video)}>{busy ? '正在提交…' : forward ? '转发' : '发布'}</button></div>
  </form></Modal>;
}
