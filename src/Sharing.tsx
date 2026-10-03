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
  const text = models ? models.map(model => model.type === 'text' ? plain(model.message) : model.type === 'image' ? plain(model.description || '') : '').filter(Boolean).join('\n\n') : plain(feed.message_html || feed.article?.content || feed.message || feed.message_brief);
  const id = String(feed.id || '');
  return { id, author: plain(feed.username || feed.userInfo?.username || '酷友'), authorUid: String(feed.uid || feed.userInfo?.uid || ''), title: plain(feed.message_title || feed.messageTitle || ''), text, publishedAt: Number(feed.dateline) || 0, url: /^\d+$/.test(id) ? `https://www.coolapk.com/feed/${id}` : '', images: photoItems(feed).map(item => item.source), video: !!(feed.mediaUrl || feed.media_url || feed.mediaInfo || feed.media_info) };
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
export function ShareDialog({ feed, onClose, toast }: { feed: Entity; onClose: () => void; toast: (text: string) => void }) {
  const item = exportFeed(feed), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>();
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(work: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(undefined); try { await work(); } catch (e) { if (mounted.current) setError(e instanceof ClientError ? e : new ClientError((e as Error).message)); } finally { if (mounted.current) setBusy(false); } }
  async function save(kind: 'markdown' | 'json' | 'png') {
    const content = kind === 'markdown' ? markdown(item) : kind === 'json' ? JSON.stringify(item, null, 2) : await card(item);
    if (!mounted.current) return;
    const result = await unwrap(window.coolapk?.saveExport({ kind, content, name: `${item.title || item.author + '的动态'}-${item.id}` }));
    if (result.saved) toast('已保存 ' + result.name);
  }
  return <Modal title="分享动态" onClose={onClose}><div className="share-content"><p className="muted">{item.title || item.author + '的动态'}</p><div className="share-link">{item.url}</div><div className="share-actions"><button className="button" disabled={busy || !item.url} onClick={() => void run(async () => { await navigator.clipboard.writeText(item.url); toast('动态链接已复制'); })}><Clipboard size={17} />复制链接</button><button className="button secondary" disabled={busy} onClick={() => void run(() => save('png'))}><Image size={17} />保存文字分享卡</button><button className="button secondary" disabled={busy} onClick={() => void run(() => save('markdown'))}><Download size={17} />导出 Markdown</button><button className="button secondary" disabled={busy} onClick={() => void run(() => save('json'))}><Download size={17} />导出 JSON</button></div>{error && <ErrorNotice error={error} />}</div></Modal>;
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
