import { useEffect, useRef, useState } from 'react';
import { Play, Volume2, VolumeX } from 'lucide-react';
import { ErrorNotice, Picture } from './components';
import { call, ClientError } from './data';
import { useImagePreferences } from './image-preferences';
import { inspectLivePhotoHeader } from '../core/live-photo-codec.mjs';
import './live-photo.css';

function officialVideo(value?: string): string {
  try { const url = new URL(value || ''); if (!['http:', 'https:'].includes(url.protocol) || !['image.coolapk.com', 'video.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com'].includes(url.hostname) || url.username || url.password || url.port || url.hash) return ''; url.protocol = 'https:'; return url.toString(); } catch { return ''; }
}
export type LivePhotoProps = { picUrl: string; id: string; contentType?: 'feed' | 'reply' | 'article'; namespace: string; videoUrl?: string; alt?: string };
export function LivePhoto({ picUrl, id, contentType = 'feed', namespace, videoUrl, alt = '实况照片' }: LivePhotoProps) {
  const { imagePreferences, updateImagePreferences } = useImagePreferences();
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<ClientError>(), [muted, setMuted] = useState(!imagePreferences.livePhotoAudio), [diagnosing, setDiagnosing] = useState(false), [diagnostic, setDiagnostic] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setUrl(''); setError(undefined); setBusy(false); setDiagnosing(false); setDiagnostic(''); setMuted(!imagePreferences.livePhotoAudio); return () => { generation.current++; }; }, [namespace, picUrl, id, contentType, videoUrl]);
  useEffect(() => { setMuted(!imagePreferences.livePhotoAudio); }, [imagePreferences.livePhotoAudio]);
  async function play() {
    if (busy) return; const attempt = generation.current; setBusy(true); setError(undefined);
    try { const result = officialVideo(videoUrl) ? { data: { url: officialVideo(videoUrl) } } : await call('livePhotoVideo', { picUrl, id, contentType }); const resolved = officialVideo(result.data?.url); if (!resolved) throw new Error('酷安没有返回有效的实况视频地址'); if (attempt === generation.current) setUrl(resolved); }
    catch (e) { if (attempt === generation.current) setError(e as ClientError); }
    finally { if (attempt === generation.current) setBusy(false); }
  }
  async function diagnose() {
    const source = officialVideo(url);
    if (!source || diagnosing) return;
    setDiagnosing(true); setDiagnostic('');
    try {
      const result = await call('livePhotoVideoHeader', { url: source });
      if (typeof result.data !== 'string') throw new Error('酷安未返回视频头信息');
      const binary = atob(result.data), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const info = inspectLivePhotoHeader(bytes);
      setDiagnostic(`${info.container}${info.brand ? `（${info.brand}）` : ''}${info.codecs.length ? ` · 编码标记：${info.codecs.join('、')}` : ' · 文件头范围内未发现视频编码标记'}`);
    } catch (cause) { setDiagnostic((cause as Error).message || '视频头读取失败'); }
    finally { setDiagnosing(false); }
  }
  return <div className="live-photo">{url && !error ? <><video aria-label="实况照片视频" src={url} autoPlay loop muted={muted} controls playsInline onError={() => setError({ message: '实况照片视频无法播放，请重试或检查此设备支持的编码格式', code: 'VIDEO_UNSUPPORTED' } as ClientError)} /><button type="button" className="live-photo-sound" aria-label={muted ? '开启实况声音' : '关闭实况声音'} onClick={() => updateImagePreferences({ livePhotoAudio: muted })}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></> : <button type="button" className="live-photo-cover" aria-label="播放实况照片" disabled={busy} onClick={() => void play()}><Picture src={picUrl} alt={alt} /><span><Play size={16} />{busy ? '加载实况照片…' : '实况照片'}</span></button>}{error && <><ErrorNotice error={error} onRetry={() => void play()} />{url && <button type="button" className="text-button" disabled={diagnosing} onClick={() => void diagnose()}>{diagnosing ? '正在读取视频头…' : '检查视频编码'}</button>}{diagnostic && <p className="muted" role="status">{diagnostic}</p>}</>}</div>;
}
