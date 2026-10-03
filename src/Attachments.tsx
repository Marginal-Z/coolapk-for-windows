import { useEffect, useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { call } from './data';
export type Attachment = { file: File; preview: string; url?: string };
export function clearAttachments(values: Attachment[]) { values.forEach(item => URL.revokeObjectURL(item.preview)); }
export function Attachments({ values, onChange, disabled, onError, limit = 9 }: { values: Attachment[]; onChange: (next: Attachment[]) => void; disabled?: boolean; onError: (s: string) => void; limit?: number }) {
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => () => clearAttachments(latest.current), []);
  const unavailable = disabled || values.length >= limit;
  return <div className="attachments"><div className="attachment-previews">{values.map((item, i) => <div key={item.preview}><img src={item.preview} alt={`待发送图片 ${i + 1}`} /><button type="button" disabled={disabled} aria-label={`移除图片 ${i + 1}`} onClick={() => { URL.revokeObjectURL(item.preview); onChange(values.filter((_, n) => n !== i)); }}><X size={14} /></button></div>)}</div><label className={`attachment-picker ${unavailable ? 'disabled' : ''}`}><ImagePlus size={18} /><span>添加图片</span><input aria-label="添加图片附件" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple={limit > 1} disabled={unavailable} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.some(f => !f.size || f.size > 20 * 1024 * 1024)) { onError('请选取非空图片，单张不能超过 20 MB'); return; } if (files.some(f => f.type && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.type))) { onError('支持 JPG、PNG、GIF 和 WebP 图片'); return; } if (files.length + values.length > limit) { onError(`最多添加 ${limit} 张图片`); return; } onChange([...values, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]); }} /></label><small>最多 {limit} 张，发送时上传</small></div>;
}
export async function uploadAttachments(values: Attachment[], progress: (s: string) => void, options: { dir?: 'feed' | 'message'; toUid?: string; shouldContinue?: () => boolean } = {}) {
  const uploaded: Attachment[] = [];
  for (const [index, item] of values.entries()) {
    if (options.shouldContinue && !options.shouldContinue()) throw new Error('账号或页面已切换，请重新发送');
    if (item.url) { uploaded.push(item); continue; }
    progress(`上传图片 ${index + 1} / ${values.length}`);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(item.file); } catch { throw new Error('图片无法解码，请选择有效的 JPG、PNG、GIF 或 WebP 图片'); }
    const { width, height } = bitmap; bitmap.close();
    if (options.shouldContinue && !options.shouldContinue()) throw new Error('账号或页面已切换，请重新发送');
    const result = await call('uploadImage', { bytes: new Uint8Array(await item.file.arrayBuffer()), width, height, ...(options.dir ? { dir: options.dir } : {}), ...(options.toUid ? { toUid: options.toUid } : {}) });
    if (typeof result.data !== 'string' || !result.data) throw new Error('图片上传成功但没有返回图片地址');
    item.url = result.data; uploaded.push(item);
  }
  return uploaded.map(item => item.url).join(',');
}
