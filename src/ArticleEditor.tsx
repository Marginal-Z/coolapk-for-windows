import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { ErrorNotice, Picture, RichText } from './components';
import { ClientError, plain, secureUrl } from './data';
import { useInteraction } from './Community';
import { articleDraft, articleMetadataTypes, articlePreservedTypes, readArticleModels } from './article-models';
import type { Entity } from './types';
import './article-editor.css';
import { photoItem } from './photo-items';
import { LivePhoto } from './LivePhoto';

function ModelCard({ model, onLink }: { model: Entity; onLink: (url: string) => void }) {
  const url = secureUrl(model?.url || model?.shareUrl || model?.card?.url || model?.entity?.url);
  const title = plain(model?.title || model?.description || model?.card?.title || model?.entity?.title || (model?.type === 'shareUrl' ? '分享链接' : model?.type === 'card' ? '内容卡片' : '保留的文章内容')).slice(0, 300);
  return <div className="article-model-card"><strong>{title}</strong>{url && <button type="button" className="text-button" onClick={event => { event.stopPropagation(); onLink(url); }}>查看关联内容</button>}</div>;
}
export function ArticleBody({ message, onLink, id, namespace = 'guest' }: { message: any; onLink: (url: string) => void; id?: string; namespace?: string }) {
  const source = readArticleModels(message);
  if (!source) return <RichText text={message} onLink={onLink} />;
  return <div className="article-model-body">{source.slice(0, 300).filter(model => !articleMetadataTypes.has(model?.type)).map((model, index) => <section key={index} data-article-model-type={String(model?.type || 'unknown')}>{model?.type === 'text' && typeof model.message === 'string' ? <RichText text={model.message} onLink={onLink} /> : model?.type === 'image' && photoItem(model) ? <ArticleImage model={model} id={id} namespace={namespace} /> : <ModelCard model={model} onLink={onLink} />}</section>)}{source.length > 300 && <p className="muted">文章内容较多，请在官方页面查看完整正文。</p>}</div>;
}
function ArticleImage({ model, id, namespace }: { model: Entity; id?: string; namespace: string }) {
  const image = photoItem(model)!;
  return <figure>{image.live && id ? <LivePhoto picUrl={image.source} videoUrl={image.video} id={id} contentType="article" namespace={namespace} alt={plain(model.description || '文章实况照片')} /> : <Picture src={image.cover} alt={plain(model.description || '文章配图')} />}{model.description && <figcaption>{plain(model.description)}</figcaption>}</figure>;
}

export function ArticleEditor({ feed, namespace, onDone, toast }: { feed: Entity; namespace: string; onDone: () => void; toast: (text: string) => void }) {
  const initial = articleDraft(feed);
  const [models, setModels] = useState<Entity[]>(initial.models), [title, setTitle] = useState(initial.title), [cover, setCover] = useState(initial.cover);
  const [attachments, setAttachments] = useState<Attachment[]>([]), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState<ClientError>(), [progress, setProgress] = useState('');
  const interaction = useInteraction(namespace + ':article:' + feed.id);
  const generation = useRef(0), latestAttachments = useRef(attachments); latestAttachments.current = attachments;
  useEffect(() => { generation.current++; return () => { generation.current++; clearAttachments(latestAttachments.current); }; }, [feed.id, namespace]);
  const supported = initial.supported, locked = uploading || interaction.locked || !!uploadError?.verificationId;
  function update(index: number, patch: Entity) { setModels(items => items.map((model, current) => current === index ? { ...model, ...patch } : model)); }
  function move(index: number, offset: number) { setModels(items => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; }); }
  async function addImages() {
    if (uploading || !attachments.length || interaction.locked) return;
    const attempt = generation.current, current = () => attempt === generation.current;
    setUploading(true); setUploadError(undefined);
    try {
      const pictures = await uploadAttachments(attachments, text => { if (current()) setProgress(text); }, { shouldContinue: current });
      if (!current()) return;
      setModels(items => [...items, ...pictures.split(',').filter(Boolean).map(url => ({ type: 'image', url, description: '' }))]); clearAttachments(attachments); setAttachments([]);
    } catch (e) { if (current()) setUploadError(e instanceof ClientError ? e : new ClientError((e as Error).message)); }
    finally { if (current()) { setUploading(false); setProgress(''); } }
  }
  function save() {
    if (!supported || locked || !title.trim()) return;
    if (attachments.length) { setUploadError(new ClientError('请先将待上传图片加入正文，或移除待上传图片', 'INPUT')); return; }
    void interaction.run('editArticle', { id: String(feed.id), models: structuredClone(models), title, cover }, () => { toast('文章已更新'); onDone(); });
  }
  return <div className="article-editor">
    {!supported && <div className="error-notice" role="alert">原文包含无法编辑的文章模型，已停止保存以保留完整内容。</div>}
    <label>文章标题<input aria-label="文章标题" value={title} maxLength={100} disabled={locked || !supported} onChange={event => setTitle(event.target.value)} /></label>
    <label>文章封面<input aria-label="文章封面地址" value={cover} disabled={locked || !supported} onChange={event => setCover(event.target.value)} placeholder="官方图片地址；也可使用正文配图设为封面" /></label>
    {cover && secureUrl(cover) && <Picture src={cover} alt="文章封面预览" className="article-cover-preview" />}
    <div className="article-blocks">{models.map((model, index) => { const editable = model?.type === 'text' || model?.type === 'image'; return <section key={index} className="article-edit-block" data-article-model-type={model?.type || 'unknown'}><header><strong>{model?.type === 'text' ? '文字段落' : model?.type === 'image' ? '图片' : '保留内容'} {index + 1}</strong><span><button type="button" className="icon-button" aria-label={`上移段落 ${index + 1}`} disabled={locked || !supported || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" className="icon-button" aria-label={`下移段落 ${index + 1}`} disabled={locked || !supported || index === models.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" className="icon-button" aria-label={`删除段落 ${index + 1}`} disabled={locked || !supported || !editable} onClick={() => setModels(items => items.filter((_, current) => current !== index))}><Trash2 size={15} /></button></span></header>{model?.type === 'text' && typeof model.message === 'string' ? <textarea aria-label={`段落 ${index + 1} 内容`} value={model.message} rows={5} disabled={locked || !supported} onChange={event => update(index, { message: event.target.value })} /> : model?.type === 'image' ? <><Picture src={model.url} alt={plain(model.description || '文章配图')} /><label>图片说明<input aria-label={`图片 ${index + 1} 说明`} value={model.description || ''} maxLength={2000} disabled={locked || !supported} onChange={event => update(index, { description: event.target.value })} /></label><button type="button" className="text-button" disabled={locked || !supported} onClick={() => setCover(model.url)}>用这张图片做封面</button></> : <><ModelCard model={model} onLink={url => { void window.coolapk?.openExternal(url); }} /><small>{articlePreservedTypes.has(model?.type) ? '此内容完整保留，可调整位置。' : '未识别的模型，无法保存修改。'}</small></>}</section>; })}</div>
    <button type="button" className="button secondary" disabled={locked || !supported} onClick={() => setModels(items => [...items, { type: 'text', message: '' }])}><Plus size={15} />添加文字段落</button>
    {supported && <div className="article-image-add"><Attachments values={attachments} onChange={next => { setAttachments(next); setUploadError(undefined); }} disabled={locked} onError={text => setUploadError(new ClientError(text, 'INPUT'))} /><button type="button" className="button secondary" disabled={locked || !attachments.length} onClick={() => void addImages()}>{uploading ? progress || '正在上传…' : '将图片加入正文'}</button></div>}
    {uploadError && <ErrorNotice error={uploadError} onRetry={uploadError.verificationId ? () => void addImages() : undefined} />}
    {interaction.error && <ErrorNotice error={interaction.error} onRetry={interaction.retry} />}
    <footer><small>文字和图片按顺序保存，关联卡片与链接保持原始内容。</small><button type="button" className="button" disabled={locked || !supported || !title.trim() || !models.some(model => model?.type === 'text' && String(model.message).trim())} onClick={save}>{interaction.busy ? '正在保存…' : '保存文章'}</button></footer>
  </div>;
}
