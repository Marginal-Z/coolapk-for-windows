import { useEffect, useRef, useState } from 'react';
import { Clipboard, Download, Image, Share2 } from 'lucide-react';
import { ErrorNotice, Modal } from './components';
import { call, ClientError, plain, unwrap } from './data';
import { readArticleModels } from './article-models';
import { photoItems } from './photo-items';
import type { Entity } from './types';
import './sharing.css';

export function exportFeed(feed: Entity) {
  const models = readArticleModels(feed.message);
  const shareText = (value: unknown) => plain(String(value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')).trim();
  const text = models ? models.map(model => model.type === 'text' ? shareText(model.message) : model.type === 'image' ? shareText(model.description || '') : '').filter(Boolean).join('\n\n') : shareText(feed.message_html || feed.article?.content || feed.message || feed.message_brief);
  const id = String(feed.id || '');
  return { id, author: plain(feed.username || feed.userInfo?.username || '酷友'), authorUid: String(feed.uid || feed.userInfo?.uid || ''), title: plain(feed.message_title || feed.messageTitle || feed.title || ''), text, publishedAt: Number(feed.dateline) || 0, url: /^\d+$/.test(id) ? `https://www.coolapk.com/feed/${id}` : '', images: photoItems(feed).map(item => item.source), video: !!(feed.mediaUrl || feed.media_url || feed.mediaInfo || feed.media_info) };
}
function markdown(item: ReturnType<typeof exportFeed>) {
  const escape = (value: string) => value.replace(/[\\`*_{}\[\]<>#]/g, '\\$&');
  return `## ${escape(item.title || item.author + '的动态')}\n\n作者：${escape(item.author)}\n\n${item.text}\n\n${item.images.map((url, index) => `[图片 ${index + 1}](${url})`).join('\n\n')}\n\n[在酷安查看](${item.url})\n`;
}
function card(item: ReturnType<typeof exportFeed>): Promise<Uint8Array> {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1500;
  const context = canvas.getContext('2d'); if (!context) throw new ClientError('无法生成分享图片');
  context.fillStyle = '#edf4ef'; context.fillRect(0, 0, 1080, 1500);
  context.fillStyle = '#ffffff'; context.beginPath(); context.roundRect(64, 64, 952, 1372, 30); context.fill();
  context.fillStyle = '#168451'; context.font = 'bold 40px "Microsoft YaHei", sans-serif'; context.fillText('酷安 · 酷友分享', 112, 148);
  const lines = (text: string, y: number, font: string, color: string, maximum: number) => {
    context.font = font; context.fillStyle = color; let line = '', row = 0;
    for (const char of text) {
      if (char === '\n' || context.measureText(line + char).width > 856) {
        context.fillText(line, 112, y + row * 56); line = ''; row++;
        if (row >= maximum) { context.fillText('…', 112, y + row * 56); return; }
      }
      if (char !== '\n') line += char;
    }
    if (line) context.fillText(line, 112, y + row * 56);
  };
  lines(item.author, 244, '32px "Microsoft YaHei", sans-serif', '#65756b', 1);
  if (item.title) lines(item.title, 342, 'bold 44px "Microsoft YaHei", sans-serif', '#182c20', 2);
  lines(item.text, item.title ? 510 : 360, '36px "Microsoft YaHei", sans-serif', '#283a2e', item.title ? 11 : 14);
  context.fillStyle = '#65756b'; context.font = '24px sans-serif'; context.fillText(item.url, 112, 1330);
  context.fillText('文字节选 · 图片和视频请在酷安查看', 112, 1382);
  return new Promise((resolve, reject) => canvas.toBlob(async blob => blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new ClientError('无法生成分享图片')), 'image/png'));
}
type SharePreview = { bytes: Uint8Array; url: string; photoCount: number };
function sharePhotoSource(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new ClientError('配图地址无效，可取消包含配图后生成文字卡片', 'INPUT'); }
  if (value.length > 4096 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !['avatar.coolapk.com', 'image.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com'].includes(url.hostname)) throw new ClientError('部分配图来源暂不支持，可取消包含配图后生成文字卡片', 'INPUT');
  url.protocol = 'https:'; return url.toString();
}
async function visualCard(item: ReturnType<typeof exportFeed>, includeImages: boolean, current: () => boolean, progress: (value: string) => void): Promise<SharePreview | undefined> {
  const images: ImageBitmap[] = [], sources = includeImages ? [...new Set(item.images)].slice(0, 4).map(sharePhotoSource) : [];
  try {
    for (const [index, source] of sources.entries()) {
      if (!current()) return;
      progress(`正在读取配图 ${index + 1} / ${sources.length}…`);
      const dataUrl = await unwrap(window.coolapk?.shareImageData({ url: source }));
      if (!current()) return;
      if (typeof dataUrl !== 'string' || dataUrl.length > 17 * 1024 ** 2 || !/^data:image\/(?:png|jpe?g|gif|webp|avif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) throw new ClientError('分享配图返回了无效的图片数据');
      let image: ImageBitmap;
      try { image = await createImageBitmap(await (await fetch(dataUrl)).blob()); }
      catch { throw new ClientError(`第 ${index + 1} 张配图无法解码，请重试或取消包含配图`); }
      if (!current()) { image.close(); return; }
      if (!image.width || !image.height || image.width * image.height > 32 * 1024 ** 2) { image.close(); throw new ClientError('配图尺寸超过分享卡加载限制'); }
      images.push(image);
    }
    if (!current()) return;
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw new ClientError('无法生成分享图片');
    const width = 1080, left = 96, contentWidth = width - left * 2;
    const wrap = (value: string, font: string, max: number) => {
      context.font = font; const lines: string[] = []; let line = '';
      for (const char of value.slice(0, 8000)) { if (char === '\n' || context.measureText(line + char).width > contentWidth) { lines.push(line); line = ''; if (lines.length === max) { lines[max - 1] = lines[max - 1].slice(0, -1) + '…'; return lines; } } if (char !== '\n') line += char; }
      if (line) lines.push(line); return lines;
    };
    const author = wrap(item.author, '32px "Microsoft YaHei", sans-serif', 2), title = wrap(item.title, 'bold 44px "Microsoft YaHei", sans-serif', 3), text = wrap(item.text || '暂无文字内容', '34px "Microsoft YaHei", sans-serif', images.length ? 10 : 18);
    const sizes = images.map(image => { const scale = Math.min(contentWidth / image.width, 1200 / image.height); return { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) }; });
    const bodyTop = 240 + author.length * 42, picturesTop = bodyTop + title.length * 56 + (title.length ? 24 : 0) + text.length * 48 + 32;
    canvas.width = width; canvas.height = Math.max(900, picturesTop + sizes.reduce((sum, size) => sum + size.height + 24, 0) + 210);
    if (canvas.height > 8192) throw new ClientError('分享卡超过图片导出尺寸限制');
    context.fillStyle = '#edf4ef'; context.fillRect(0, 0, width, canvas.height); context.fillStyle = '#fff'; context.beginPath(); context.roundRect(48, 48, width - 96, canvas.height - 96, 28); context.fill();
    const draw = (lines: string[], y: number, font: string, color: string, spacing: number) => { context.font = font; context.fillStyle = color; lines.forEach((line, index) => context.fillText(line, left, y + index * spacing)); };
    draw(['酷安 · 酷友分享'], 128, 'bold 38px "Microsoft YaHei", sans-serif', '#168451', 48);
    draw(author, 200, '32px "Microsoft YaHei", sans-serif', '#65756b', 42);
    draw(title, bodyTop, 'bold 44px "Microsoft YaHei", sans-serif', '#182c20', 56);
    draw(text, bodyTop + title.length * 56 + (title.length ? 24 : 0), '34px "Microsoft YaHei", sans-serif', '#283a2e', 48);
    let y = picturesTop;
    images.forEach((image, index) => { const size = sizes[index]; context.drawImage(image, (width - size.width) / 2, y, size.width, size.height); y += size.height + 24; });
    context.fillStyle = '#dbe7df'; context.fillRect(left, canvas.height - 170, contentWidth, 1);
    draw([item.url || '动态链接未提供'], canvas.height - 116, '26px sans-serif', '#168451', 38);
    draw([`正文节选${images.length ? ` · 包含 ${images.length} / ${item.images.length} 张配图` : ''} · 完整内容请在酷安查看`], canvas.height - 74, '23px "Microsoft YaHei", sans-serif', '#65756b', 32);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new ClientError('无法生成分享图片')), 'image/png'));
    if (!current()) return;
    if (blob.size > 16 * 1024 ** 2) throw new ClientError('分享卡超过图片导出大小限制');
    const bytes = new Uint8Array(await blob.arrayBuffer()); if (!current()) return;
    return { bytes, url: URL.createObjectURL(blob), photoCount: images.length };
  } finally { images.forEach(image => image.close()); }
}
export function ShareDialog({ feed, namespace = 'guest', onClose, toast }: { feed: Entity; namespace?: string; onClose: () => void; toast: (text: string) => void }) {
  const item = exportFeed(feed), baseScope = JSON.stringify([namespace, item]);
  const [settings, setSettings] = useState({ scope: baseScope, images: true });
  const includeImages = settings.scope === baseScope ? settings.images : true, scope = JSON.stringify([baseScope, includeImages]);
  const [state, setState] = useState<{ scope: string; busy: boolean; error?: ClientError; preview?: SharePreview; progress?: string }>({ scope, busy: false });
  const generation = useRef(0), active = useRef(false), inFlight = useRef(false), latestScope = useRef(scope), previewUrl = useRef(''); latestScope.current = scope;
  const lastWork = useRef<{ scope: string; work: (current: () => boolean) => Promise<unknown> } | undefined>(undefined);
  const release = () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = ''; };
  useEffect(() => { generation.current++; active.current = true; inFlight.current = false; lastWork.current = undefined; release(); setState({ scope, busy: false }); return () => { active.current = false; generation.current++; lastWork.current = undefined; release(); }; }, [scope]);
  const { busy, error, preview, progress } = state.scope === scope ? state : { busy: false, error: undefined, preview: undefined, progress: undefined };
  function cancel() { generation.current++; inFlight.current = false; lastWork.current = undefined; release(); setState({ scope, busy: false }); }
  function close() { cancel(); onClose(); }
  async function run(work: (current: () => boolean) => Promise<unknown>) {
    if (!active.current || inFlight.current || latestScope.current !== scope) return;
    const attempt = ++generation.current, current = () => active.current && latestScope.current === scope && generation.current === attempt;
    lastWork.current = { scope, work };
    inFlight.current = true; setState(value => ({ ...value, scope, busy: true, error: undefined }));
    try { await work(current); } catch (e) { if (current()) setState(value => ({ ...value, error: e instanceof ClientError ? e : new ClientError((e as Error).message) })); }
    finally { if (current()) { inFlight.current = false; setState(value => ({ ...value, busy: false, progress: '' })); } }
  }
  async function save(kind: 'markdown' | 'json' | 'png', current: () => boolean, visual = false) {
    const content = kind === 'markdown' ? markdown(item) : kind === 'json' ? JSON.stringify(item, null, 2) : visual ? preview?.bytes : await card(item);
    if (!current() || !content) return;
    const result = await unwrap(window.coolapk?.saveExport({ kind, content, name: `${item.title || item.author + '的动态'}-${item.id}` }));
    if (current() && result.saved) toast('已保存 ' + result.name);
  }
  async function generate(current: () => boolean) {
    release(); setState(value => ({ ...value, preview: undefined }));
    const result = await visualCard(item, includeImages, current, value => { if (current()) setState(state => ({ ...state, progress: value })); });
    if (!result) return;
    if (!current()) { URL.revokeObjectURL(result.url); return; }
    previewUrl.current = result.url; setState(value => ({ ...value, preview: result }));
  }
  return <Modal title="分享动态" onClose={close}><div className="share-content"><p className="muted">{item.title || item.author + '的动态'}</p><div className="share-link">{item.url}</div><div className="share-actions"><button className="button" disabled={busy || !item.url} onClick={() => void run(async current => { await navigator.clipboard.writeText(item.url); if (current()) toast('动态链接已复制'); })}><Clipboard size={17} />复制链接</button><button className="button secondary" disabled={busy} onClick={() => void run(current => save('png', current))}><Image size={17} />保存文字分享卡</button><button className="button secondary" disabled={busy} onClick={() => void run(current => save('markdown', current))}><Download size={17} />导出 Markdown</button><button className="button secondary" disabled={busy} onClick={() => void run(current => save('json', current))}><Download size={17} />导出 JSON</button></div><section className="share-visual"><div className="share-visual-heading"><strong>图文分享卡</strong><label><input type="checkbox" checked={includeImages} disabled={busy || !item.images.length} onChange={e => setSettings({ scope: baseScope, images: e.target.checked })} />包含动态图片{item.images.length > 4 ? '（前 4 张）' : ''}</label></div>{!item.images.length && <p className="muted">这条动态没有配图，将生成文字卡片。</p>}<div className="share-visual-actions"><button className="button secondary" disabled={busy} onClick={() => void run(generate)}><Image size={17} />{preview ? '重新生成预览' : '预览图文分享卡'}</button><button className="button" disabled={busy || !preview || !!error} onClick={() => void run(current => save('png', current, true))}><Download size={17} />保存图文分享卡</button>{busy && <button className="text-button" onClick={cancel}>取消生成</button>}</div>{progress && <p role="status">{progress}</p>}{preview && <div className="share-card-preview"><img src={preview.url} alt="图文分享卡预览" /><p className="muted">预览包含 {preview.photoCount} 张配图；保存时由系统选择文件位置。</p></div>}</section>{error && <ErrorNotice error={error} onRetry={() => { const failed = lastWork.current; if (failed?.scope === scope) void run(failed.work); }} />}</div></Modal>;
}
export function CollectionExport({ id, title, namespace, toast }: { id: string; title: string; namespace: string; toast: (text: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>(), [progress, setProgress] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setBusy(false); setError(undefined); return () => { generation.current++; }; }, [namespace, id]);
  async function save(kind: 'markdown' | 'json') {
    if (busy) return; const attempt = generation.current; const current = () => attempt === generation.current;
    setBusy(true); setError(undefined); setProgress('正在读取收藏单…');
    try {
      const feeds: ReturnType<typeof exportFeed>[] = [], seen = new Set<string>(), skipped = new Set<string>(); let firstItem = '', lastItem = '', finished = false;
      for (let page = 1; page <= 300; page++) {
        const result = await call('collectionFeeds', { id, page, firstItem, lastItem }); if (!current()) return;
        if (!Array.isArray(result.data)) throw new ClientError('收藏单数据结构异常');
        if (!result.data.length) { finished = true; break; }
        for (const [index, entity] of result.data.entries()) { if (entity.entityType !== 'feed' && !entity.feedType) { skipped.add(String(entity.entityType) + ':' + String(entity.id || entity.entityId || `${page}-${index}`)); continue; } const feed = exportFeed(entity); if (!feed.id || seen.has(feed.id)) continue; seen.add(feed.id); feeds.push(feed); }
        if (feeds.length > 5000) throw new ClientError('此收藏单超过单次导出 5000 条限制');
        setProgress(`已读取 ${feeds.length} 条动态…`);
        if (result.hasMore === false) { finished = true; break; }
        const next = String(result.lastItem || result.data.at(-1)?.entityId || result.data.at(-1)?.id || '');
        if (!next || next === lastItem) throw new ClientError('收藏单分页未继续，导出已停止。请刷新后重试。');
        firstItem ||= String(result.firstItem || result.data[0]?.entityId || result.data[0]?.id || ''); lastItem = next;
      }
      if (!finished) throw new ClientError('收藏单超过单次导出分页限制');
      if (!current()) return;
      const scope = `仅导出动态类内容，跳过 ${skipped.size} 条其它类型收藏。`;
      const content = kind === 'json' ? JSON.stringify({ title: plain(title), exportedAt: new Date().toISOString(), source: `https://www.coolapk.com/collection/${id}`, scope: 'feeds_only', skippedItems: skipped.size, note: scope, feeds }, null, 2) : `# ${plain(title)}\n\n${scope}\n\n${feeds.map(markdown).join('\n---\n\n')}`;
      const result = await unwrap(window.coolapk?.saveExport({ kind, name: title + '-收藏单', content }));
      if (current() && result.saved) toast(`已导出 ${feeds.length} 条动态到 ${result.name}${skipped.size ? `（跳过 ${skipped.size} 条其它类型）` : ''}`);
    } catch (e) { if (current()) setError(e instanceof ClientError ? e : new ClientError((e as Error).message)); }
    finally { if (current()) { setBusy(false); setProgress(''); } }
  }
  return <div className="collection-export"><span>导出收藏单动态</span><button className="text-button" disabled={busy} onClick={() => void save('markdown')}><Share2 size={15} />导出 Markdown</button><button className="text-button" disabled={busy} onClick={() => void save('json')}>导出 JSON</button>{progress && <span role="status">{progress}</span>}{error && <ErrorNotice error={error} />}</div>;
}
