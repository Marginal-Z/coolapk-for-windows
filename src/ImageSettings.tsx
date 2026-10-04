import { useEffect, useRef, useState } from 'react';
import type { ImageWatermarkPatch, ImageWatermarkSettings } from '../core/image-settings.mjs';
import { call } from './data';
import { useImagePreferences } from './image-preferences';
import './image-settings.css';

type Props = { namespace?: string; loggedIn?: boolean; onLogin?: () => void };
function CloudWatermarks({ namespace = 'anonymous', loggedIn = false, onLogin }: Props) {
  const [state, setState] = useState<{ owner: string; data?: ImageWatermarkSettings; busy: boolean; error?: string; status?: string; failedPatch?: ImageWatermarkPatch }>({ owner: namespace, busy: loggedIn });
  const owner = useRef(namespace), sequence = useRef(0), mounted = useRef(false), inFlight = useRef(false), lastPosition = useRef<'5' | '7' | '8' | '9'>('9');
  owner.current = namespace;
  const visible = state.owner === namespace ? state : { owner: namespace, busy: loggedIn };
  async function request(patch?: ImageWatermarkPatch) {
    if (!loggedIn || !mounted.current || inFlight.current) return;
    const scope = namespace, generation = ++sequence.current; inFlight.current = true;
    const current = () => mounted.current && owner.current === scope && sequence.current === generation;
    setState(previous => ({ ...(previous.owner === scope ? previous : {}), owner: scope, busy: true }));
    try {
      const result = await call(patch ? 'imageWatermarkSettingsUpdate' : 'imageWatermarkSettings', patch ? { patch } : {});
      if (!current()) return;
      const data = result.data as ImageWatermarkSettings;
      if (data.position !== '0') lastPosition.current = data.position;
      setState({ owner: scope, data, busy: false, ...(patch ? { status: '已保存并核对云端水印设置' } : {}) });
    } catch (error) {
      if (current()) setState(previous => ({ ...previous, busy: false, status: undefined, error: error instanceof Error ? error.message : '水印设置操作失败，请重试', ...(patch ? { failedPatch: patch } : {}) }));
    } finally { if (current()) inFlight.current = false; }
  }
  useEffect(() => {
    mounted.current = true; inFlight.current = false; lastPosition.current = '9';
    setState({ owner: namespace, busy: loggedIn }); void request();
    return () => { mounted.current = false; sequence.current++; inFlight.current = false; };
  }, [namespace, loggedIn]);
  const data = visible.data, disabled = visible.busy || !!visible.failedPatch;
  return <section className="image-settings-group" aria-label="图片水印"><h3>图片水印</h3>
    {!loggedIn ? <div className="image-settings-cloud-message"><p>登录后查看和修改账号的水印设置。</p>{onLogin && <button type="button" className="button secondary" onClick={onLogin}>登录酷安</button>}</div> : <>
      {visible.busy && <p className="image-settings-cloud-message" role="status">{data ? '正在保存或核对云端设置…' : '正在读取云端水印设置…'}</p>}
      {data && <>
        <label className="image-settings-row"><span><strong>动态图片水印</strong><small>发布动态图片时添加带有作者用户名的水印。</small></span><input type="checkbox" role="switch" aria-label="动态图片水印" checked={data.enabled} disabled={disabled} onChange={event => void request({ position: event.target.checked ? lastPosition.current : '0' })} /></label>
        <label className="image-settings-row"><span><strong>酷图水印</strong><small>发布原创酷图时添加水印，默认关闭。</small></span><input type="checkbox" role="switch" aria-label="酷图水印" checked={data.coolPictures} disabled={disabled || !data.enabled} onChange={event => void request({ coolPictures: event.target.checked })} /></label>
        <label className="image-settings-row"><span><strong>发布HDR图片时加水印</strong><small>开启后，官方图片处理会去掉 HDR 效果。</small></span><input type="checkbox" role="switch" aria-label="发布HDR图片时加水印" checked={data.hdr} disabled={disabled || !data.enabled} onChange={event => void request({ hdr: event.target.checked })} /></label>
        <label className="image-settings-row"><span><strong>水印类型</strong></span><select aria-label="水印类型" value={data.iconType} disabled={disabled || !data.enabled} onChange={event => void request({ iconType: event.target.value as '0' | '1' })}><option value="0">文字</option><option value="1">图标</option></select></label>
        <label className="image-settings-row"><span><strong>水印位置</strong></span><select aria-label="水印位置" value={data.enabled ? data.position : lastPosition.current} disabled={disabled || !data.enabled} onChange={event => void request({ position: event.target.value as '5' | '7' | '8' | '9' })}><option value="5">图片正中</option><option value="7">底部居左</option><option value="8">底部居中</option><option value="9">底部居右</option></select></label>
      </>}
      {visible.error && <div className="image-settings-cloud-message"><p className="image-settings-error" role="alert">{visible.error}{visible.failedPatch ? ' 修改结果尚未核对，可重试保存或重新加载。' : ''}</p><div className="image-settings-cloud-actions">{visible.failedPatch && <button type="button" className="button secondary" disabled={visible.busy} onClick={() => void request(visible.failedPatch)}>重试保存</button>}<button type="button" className="button secondary" disabled={visible.busy} onClick={() => void request()}>重新加载设置</button></div></div>}
      {visible.status && <p className="image-settings-cloud-message" role="status">{visible.status}</p>}
      <p className="image-settings-cloud-message image-settings-note">水印设置与酷安账号同步；每次修改后重新读取确认。发布图片按官方返回的规则处理，已上传的图片保持原样。</p>
    </>}
  </section>;
}
export function ImageSettings(props: Props = {}) {
  const { imagePreferences, updateImagePreferences, imagePreferenceError } = useImagePreferences();
  const [hdr, setHdr] = useState<{ high: boolean; p3: boolean }>();
  return <div className="image-settings-body">
    <section className="image-settings-group" aria-label="Live Photo 设置"><h3>Live Photo 设置</h3>
      <label className="image-settings-row"><span><strong>Live Photo 音频</strong><small>播放实况照片时播放音频，可在播放界面单独开关声音。</small></span><input type="checkbox" role="switch" aria-label="Live Photo 音频" checked={imagePreferences.livePhotoAudio} onChange={event => updateImagePreferences({ livePhotoAudio: event.target.checked })} /></label>
    </section>
    <section className="image-settings-group" aria-label="图片模式"><h3>图片模式</h3>
      <label className="image-settings-row"><span><strong>图片浏览设置</strong><small>选择图片查看器默认加载的清晰度，保存图片始终使用原图。</small></span><select aria-label="图片浏览设置" value={imagePreferences.browsingMode} onChange={event => updateImagePreferences({ browsingMode: event.target.value as 'original' | 'normal' | 'auto' })}><option value="normal">普清</option><option value="original">原图</option><option value="auto">网络自适应</option></select></label>
    </section>
    <CloudWatermarks {...props} />
    <section className="image-settings-group" aria-label="图片效果"><h3>图片效果</h3><div className="image-settings-row"><span><strong>HDR 检测</strong><small>检测当前窗口是否报告高动态范围和广色域显示能力。</small></span><button type="button" className="button secondary" onClick={() => setHdr({ high: window.matchMedia('(dynamic-range: high)').matches, p3: window.matchMedia('(color-gamut: p3)').matches })}>检测显示能力</button></div>{hdr && <p className="image-settings-hdr" role="status">{hdr.high ? '当前窗口报告支持高动态范围显示。' : '当前窗口未报告高动态范围显示能力，可在 Windows 显示设置中检查 HDR。'}{hdr.p3 ? '已报告 P3 广色域。' : '未报告 P3 广色域。'}保存原图会保留原始文件，显示能力检测不代表每张图片都含有 HDR 数据。</p>}<p className="image-settings-hdr">HDR 显示由 Windows 和当前显示器决定；完整 HDR 效果开关与自动识别 HDR 上传仍在核对。</p></section>
    {imagePreferenceError && <p className="image-settings-error" role="alert">{imagePreferenceError}</p>}
    <p className="image-settings-note">音频与浏览清晰度保存在本机。普清使用酷安返回的预览图片；打开图片后可切换原图。网络自适应在可识别的 Wi-Fi 或以太网使用原图，网络信息不可用时使用普清。</p>
  </div>;
}
