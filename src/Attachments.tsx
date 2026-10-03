import { useEffect, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { call } from './data';
import './live-photo.css';
export type Attachment = { file: File; preview: string; url?: string; liveVideo?: File };
export function clearAttachments(values: Attachment[]) { values.forEach(item => URL.revokeObjectURL(item.preview)); }
export function Attachments({ values, onChange, disabled, onError, limit = 9, allowLive = true }: { values: Attachment[]; onChange: (next: Attachment[]) => void; disabled?: boolean; onError: (s: string) => void; limit?: number; allowLive?: boolean }) {
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => () => clearAttachments(latest.current), []);
  const unavailable = disabled || values.length >= limit;
  function bindVideo(index: number, file?: File) {
    if (file && (!file.size || file.size > 64 * 1024 ** 2 || !/\.(?:mp4|mov)$/i.test(file.name) || file.type && !['video/mp4', 'video/quicktime', 'video/x-quicktime'].includes(file.type))) { onError('请选择非空 MP4 或 MOV 实况小视频，不能超过 64 MB'); return; }
    onChange(values.map((item, current) => current === index ? { ...item, url: undefined, liveVideo: file } : item));
  }
  return <div className="attachments"><div className="attachment-previews">{values.map((item, i) => <div key={item.preview}>
    <img src={item.preview} alt={`待发送图片 ${i + 1}`} />
    <button type="button" disabled={disabled} aria-label={`移除图片 ${i + 1}`} onClick={() => { URL.revokeObjectURL(item.preview); onChange(values.filter((_, n) => n !== i)); }}><X size={14} /></button>
    {allowLive && <label className={`attachment-live-picker ${disabled ? 'disabled' : ''}`}><span>{item.liveVideo ? '更换实况视频' : '绑定实况视频'}</span><input aria-label={`绑定图片 ${i + 1} 的实况视频`} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) bindVideo(i, file); }} /></label>}
    {item.liveVideo && <><div className="attachment-live-name" title={item.liveVideo.name}>{item.liveVideo.name}</div><button type="button" className="attachment-live-remove" disabled={disabled} onClick={() => bindVideo(i)}>取消实况视频</button></>}
  </div>)}</div><label className={`attachment-picker ${unavailable ? 'disabled' : ''}`}><ImagePlus size={18} /><span>添加图片</span><input aria-label="添加图片附件" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple={limit > 1} disabled={unavailable} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.some(f => !f.size || f.size > 20 * 1024 * 1024)) { onError('请选取非空图片，单张不能超过 20 MB'); return; } if (files.some(f => f.type && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.type))) { onError('支持 JPG、PNG、GIF 和 WebP 图片'); return; } if (files.length + values.length > limit) { onError(`最多添加 ${limit} 张图片`); return; } onChange([...values, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]); }} /></label><small>最多 {limit} 张，发送时上传{allowLive ? '；可绑定 MP4/MOV 实况视频' : ''}</small></div>;
}
export async function uploadAttachments(values: Attachment[], progress: (s: string) => void, options: { dir?: 'feed' | 'message'; toUid?: string; shouldContinue?: () => boolean } = {}) {
  const uploaded: Attachment[] = [];
  const current = () => { if (options.shouldContinue && !options.shouldContinue()) throw new Error('账号或页面已切换，请重新发送'); };
  if (options.dir === 'message' && values.some(item => item.liveVideo)) throw new Error('私信实况视频协议尚未确认，请取消视频绑定后发送图片');
  for (const [index, item] of values.entries()) {
    current();
    if (item.url) { uploaded.push(item); continue; }
    progress(`上传${item.liveVideo ? '实况照片' : '图片'} ${index + 1} / ${values.length}`);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(item.file); } catch { throw new Error('图片无法解码，请选择有效的 JPG、PNG、GIF 或 WebP 图片'); }
    const { width, height } = bitmap; bitmap.close();
    current();
    const bytes = new Uint8Array(await item.file.arrayBuffer()), videoBytes = item.liveVideo ? new Uint8Array(await item.liveVideo.arrayBuffer()) : undefined; current();
    const result = item.liveVideo ? await call('uploadLivePhoto', { bytes, videoBytes, width, height }) : await call('uploadImage', { bytes, width, height, ...(options.dir ? { dir: options.dir } : {}), ...(options.toUid ? { toUid: options.toUid } : {}) });
    current();
    if (typeof result.data !== 'string' || !result.data || item.liveVideo && result.livePhoto !== true) throw new Error(item.liveVideo ? '酷安未确认实况照片视频上传，已停止发送' : '图片上传成功但没有返回图片地址');
    item.url = result.data; uploaded.push(item);
  }
  return uploaded.map(item => item.url).join(',');
}
