import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, Bell, ChevronRight, Download, ExternalLink, FileText, FlaskConical, HelpCircle, History, Image, Monitor, MonitorUp, Shield, Trash2, UserRound, Users } from 'lucide-react';
import { clockMinutes, normalizeThemeColor, preferenceFontScale, preferenceThemeVariables, themeColorContrast, THEME_PALETTES, type Preferences } from '../core/preferences.mjs';
import './settings.css';
import './desktop-settings.css';
import { ImageSettings } from './ImageSettings';
import { unwrap } from './data';
import type { BackgroundState } from './types';

export type SettingsProps = {
  preferences: Preferences; onPreferencesChange: (patch: Partial<Preferences>) => void;
  namespace: string; accountCount: number; version: string; preferenceError?: string;
  onAccountProfile?: () => void; onAccountSecurity?: () => void | Promise<unknown>; onManageAccounts?: () => void;
  onAccountPrivacy?: () => void; onAccountNotifications?: () => void;
  onDownloads?: () => void; onClearCache?: () => Promise<unknown>; onClearHistory?: () => void | Promise<unknown>;
  onHelp?: () => void; onAgreement?: () => void; onUpdates?: () => void; onTeenager?: () => void;
  loggedIn?: boolean; onLogin?: () => void;
  onBackgroundChange?: (state: BackgroundState) => void;
};
function Entry({ title, note, icon, onClick, disabled }: { title: string; note?: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="preferences-entry" onClick={onClick} disabled={disabled}>{icon}<span><strong>{title}</strong>{note && <small>{note}</small>}</span><ChevronRight size={17} aria-hidden="true" /></button>;
}
function Toggle({ title, note, checked, onChange, disabled = false }: { title: string; note?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className={`preferences-row ${disabled ? 'unavailable' : ''}`}><span><strong>{title}</strong>{note && <small>{note}</small>}</span><input type="checkbox" role="switch" aria-label={title} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /></label>;
}
export function Settings(props: SettingsProps) {
  const { preferences, onPreferencesChange: update } = props;
  const [display, setDisplay] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [imageSettings, setImageSettings] = useState(false);
  const [laboratory, setLaboratory] = useState(false);
  const [background, setBackground] = useState<BackgroundState>();
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const backgroundSequence = useRef(0);
  const [start, setStart] = useState(preferences.nightStart), [end, setEnd] = useState(preferences.nightEnd);
  const [customColor, setCustomColor] = useState(preferences.customTheme), [customAccent, setCustomAccent] = useState(preferences.customAccent), [customDark, setCustomDark] = useState(preferences.customThemeDark), [customEditor, setCustomEditor] = useState(false);
  const active = useRef(true), owner = useRef(props.namespace), pending = useRef<{ scope: string; key: string } | null>(null);
  owner.current = props.namespace;
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current = null; }; }, []);
  useEffect(() => { pending.current = null; setBusy(''); setError(''); setStatus(''); }, [props.namespace]);
  useEffect(() => { setStart(preferences.nightStart); setEnd(preferences.nightEnd); }, [preferences.nightStart, preferences.nightEnd]);
  useEffect(() => { setCustomColor(preferences.customTheme); setCustomAccent(preferences.customAccent); setCustomDark(preferences.customThemeDark); }, [preferences.customTheme, preferences.customAccent, preferences.customThemeDark]);
  useEffect(() => {
    if (!display || !window.coolapk?.background) return;
    let active = true; const sequence = ++backgroundSequence.current; const current = () => active && sequence === backgroundSequence.current; setBackgroundLoading(true);
    unwrap(window.coolapk.background('state')).then(value => { if (current()) setBackground(value); }).catch(failure => { if (current()) setError(failure instanceof Error ? failure.message : '背景图片读取失败。'); }).finally(() => { if (current()) setBackgroundLoading(false); });
    return () => { active = false; };
  }, [display, props.namespace]);
  const section = laboratory ? 'laboratory' : imageSettings ? 'images' : display ? 'display' : 'overview';
  const sectionTitle = ({ overview: '设置总览', display: '界面显示', images: '图片设置', laboratory: '实验室' })[section];
  function navigate(value: typeof section) { setDisplay(value === 'display'); setImageSettings(value === 'images'); setLaboratory(value === 'laboratory'); setError(''); setStatus(''); }
  function navigateKey(event: KeyboardEvent<HTMLElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const sections = ['overview', 'display', 'images', 'laboratory'] as const, current = sections.indexOf(section);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (current + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + sections.length) % sections.length;
    event.preventDefault(); navigate(sections[next]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  async function changeBackground(operation: 'choose' | 'remove') {
    if (pending.current) return;
    backgroundSequence.current++; setBackgroundLoading(false);
    const scope = props.namespace;
    await run('background', async () => {
      const value = await unwrap(window.coolapk?.background(operation));
      if (!active.current || owner.current !== scope) return;
      setBackground(value); props.onBackgroundChange?.(value);
      if (operation === 'remove') update({ backgroundEnabled: false, backgroundOpacity: .28, surfaceOpacity: .94 });
      else if (value.available && !value.cancelled) update({ backgroundEnabled: true });
    });
  }
  async function run(key: string, work: () => void | Promise<unknown>, message = '') {
    if (pending.current) return;
    const request = { scope: props.namespace, key }; pending.current = request; setBusy(key); setError(''); setStatus('');
    const current = () => active.current && owner.current === request.scope && pending.current === request;
    try { await work(); if (current() && message) setStatus(message); }
    catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); }
    finally { if (current()) { pending.current = null; setBusy(''); } }
  }
  const validTime = clockMinutes(start) !== null && clockMinutes(end) !== null && start !== end;
  const selectedStyle = customEditor ? 'custom' : preferences.theme !== 'light' ? preferences.theme : preferences.palette === 'white' ? 'light' : preferences.palette;
  const validCustomColor = normalizeThemeColor(customColor), validCustomAccent = normalizeThemeColor(customAccent), preview = preferenceThemeVariables({ ...preferences, palette: 'custom', customTheme: validCustomColor || preferences.customTheme, customAccent: validCustomAccent || preferences.customAccent, customThemeDark: customDark }, 'light');
  function chooseStyle(value: string) {
    if (value === 'custom') { setCustomEditor(true); return; }
    setCustomEditor(false);
    if (value === 'dark' || value === 'black') update({ theme: value, followSystem: false, autoNight: false });
    else update({ theme: 'light', palette: value === 'light' ? 'white' : value as Preferences['palette'], followSystem: false, autoNight: false });
  }
  const notifications = <>{props.preferenceError && <p className="preferences-error" role="alert">{props.preferenceError}</p>}{error && <p className="preferences-error" role="alert">{error}</p>}{busy && <p className="preferences-status" role="status">正在处理，请稍候…</p>}{status && <p className="preferences-status" role="status">{status}</p>}</>;
  return <div className={`preferences-body preferences-section-${section}`}><aside className="preferences-navigation"><p>偏好设置</p><nav role="tablist" aria-label="设置分类" aria-orientation="vertical" onKeyDown={navigateKey}>{([['overview', '总览', <Monitor size={18} />], ['display', '界面显示', <Monitor size={18} />], ['images', '图片设置', <Image size={18} />], ['laboratory', '实验室', <FlaskConical size={18} />]] as const).map(([value, label, icon]) => <button key={value} type="button" role="tab" id={`settings-tab-${value}`} aria-selected={section === value} tabIndex={section === value ? 0 : -1} aria-controls="settings-content" onClick={() => navigate(value)}>{icon}<span>{label}</span></button>)}</nav><small>设置自动保存在本机</small></aside><main className="preferences-content" id="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${section}`} aria-label={sectionTitle}>{laboratory ? <><header className="preferences-heading"><button type="button" className="icon-button" aria-label="返回设置" onClick={() => navigate('overview')}><ArrowLeft size={18} /></button><h3>实验室</h3></header><section className="preferences-group" aria-label="实验室设置"><Toggle title="显示 FPS" note="显示当前窗口动画帧回调频率，窗口隐藏时暂停统计" checked={preferences.showFPS} onChange={showFPS => update({ showFPS })} /></section><p className="preferences-note">实验功能会在当前桌面窗口实际生效。手机系统返回动画、安装列表与推送日志仍在继续核对。</p>{notifications}</> : imageSettings ? <><header className="preferences-heading"><button type="button" className="icon-button" aria-label="返回设置" onClick={() => navigate('overview')}><ArrowLeft size={18} /></button><h3>图片设置</h3></header><ImageSettings namespace={props.namespace} loggedIn={props.loggedIn} onLogin={props.onLogin} /></> : display ? <>
    <header className="preferences-heading"><button type="button" className="icon-button" aria-label="返回设置" onClick={() => navigate('overview')}><ArrowLeft size={18} /></button><h3>界面显示</h3></header>
    <section className="preferences-group" aria-label="界面显示设置">
      <label className="preferences-row"><span><strong>字体大小</strong><small>设置全局字体大小</small></span><select aria-label="字体大小" value={preferences.fontSize} onChange={event => update({ fontSize: event.target.value as Preferences['fontSize'] })}><option value="system">跟随系统</option><option value="large">大号</option><option value="standard">标准</option><option value="small">小号</option></select></label>
      <div className="preferences-preview" style={{ fontSize: `${14 * preferenceFontScale(preferences)}px` }}>发现好应用，聊聊新数码。<small>字体效果预览 · 系统显示缩放会自动适配</small></div>
      <label className="preferences-row"><span><strong>主题风格</strong><small>手动选择会关闭系统与定时切换</small></span><select aria-label="主题风格" value={selectedStyle} onChange={event => chooseStyle(event.target.value)}>{THEME_PALETTES.map(palette => <option key={palette.id} value={palette.id === 'white' ? 'light' : palette.id}>{palette.label}</option>)}<option value="dark">黑色</option><option value="black">纯黑</option><option value="custom">自定义</option></select></label>
      <label className="preferences-row"><span><strong>界面材质效果</strong><small>应用于导航、顶部栏、内容卡片和设置；降低透明度时自动使用实色</small></span><select aria-label="界面材质效果" value={preferences.materialEffect} onChange={event => update({ materialEffect: event.target.value as Preferences['materialEffect'] })}><option value="full">液态玻璃</option><option value="blur_only">背景模糊</option><option value="fallback">半透明</option></select></label>
      <div className="preferences-material-preview" role="group" data-preview-material={preferences.materialEffect} aria-label="材质效果预览"><div aria-hidden="true" className="preferences-material-landscape" /><div className="preferences-material-sample"><strong>{preferences.materialEffect === 'full' ? '液态玻璃' : preferences.materialEffect === 'blur_only' ? '背景模糊' : '半透明'}</strong><span>导航、卡片与弹窗保持统一材质</span></div></div>
      <div className="preferences-palettes" role="group" aria-label="主题配色"><p>主题颜色会用于标题栏、选中项目、链接和操作按钮。</p><div>{THEME_PALETTES.map(palette => <button type="button" key={palette.id} className="preferences-palette" aria-label={`使用${palette.label}主题`} aria-pressed={preferences.palette === palette.id && preferences.theme === 'light'} onClick={() => chooseStyle(palette.id === 'white' ? 'light' : palette.id)}><span aria-hidden="true" style={{ background: palette.id === 'white' ? '#fff' : palette.color }} /><strong>{palette.label}</strong></button>)}</div></div>
      {(customEditor || preferences.palette === 'custom') && <form className="preferences-custom" onSubmit={event => { event.preventDefault(); if (validCustomColor && validCustomAccent) { update({ theme: 'light', palette: 'custom', customTheme: validCustomColor, customAccent: validCustomAccent, customThemeDark: customDark, followSystem: false, autoNight: false }); setCustomEditor(false); } }}>
        <div><strong>选择主题色</strong><small>用于标题栏背景，选择颜色或输入十六进制色值。</small></div>
        <div className="preferences-color-inputs"><label>色盘<input type="color" aria-label="自定义主题色色盘" value={validCustomColor || preferences.customTheme} onChange={event => setCustomColor(event.target.value)} /></label><label>色值<input type="text" aria-label="自定义主题色色值" value={customColor} maxLength={7} autoComplete="off" spellCheck={false} aria-invalid={!validCustomColor} aria-describedby={!validCustomColor ? 'preferences-color-error' : undefined} onChange={event => setCustomColor(event.target.value)} /></label></div>
        {!validCustomColor && <p id="preferences-color-error" className="preferences-error" role="alert">请输入有效的颜色，例如 #0f9d58。</p>}
        <div className="preferences-custom-accent"><strong>选择强调色</strong><small>用于选中项目、链接和操作按钮。</small></div><div className="preferences-color-inputs"><label>色盘<input type="color" aria-label="自定义强调色色盘" value={validCustomAccent || preferences.customAccent} onChange={event => setCustomAccent(event.target.value)} /></label><label>色值<input type="text" aria-label="自定义强调色色值" value={customAccent} maxLength={7} autoComplete="off" spellCheck={false} aria-invalid={!validCustomAccent} aria-describedby={!validCustomAccent ? 'preferences-accent-error' : undefined} onChange={event => setCustomAccent(event.target.value)} /></label></div>{!validCustomAccent && <p id="preferences-accent-error" className="preferences-error" role="alert">请输入有效的强调色，例如 #0f9d58。</p>}
        <fieldset className="preferences-custom-style"><legend>主题色风格</legend><label><input type="radio" name="custom-theme-style" checked={customDark} onChange={() => setCustomDark(true)} />暗色风格</label><label><input type="radio" name="custom-theme-style" checked={!customDark} onChange={() => setCustomDark(false)} />亮色风格</label></fieldset>
        <div className="preferences-color-preview" style={{ background: preview['--theme-primary'], color: preview['--theme-primary-on'] }}>酷安 · 主题色预览</div><div className="preferences-accent-preview" style={{ color: preview['--accent'] }}>强调色预览 · 选中项目与链接</div>
        {themeColorContrast(preview['--theme-primary'], preview['--theme-primary-on']) < 4.5 && <p className="preferences-color-warning">当前文字风格与主题色的对比较低，建议选择另一种文字风格。</p>}
        <div className="preferences-custom-actions"><button type="button" className="button secondary" onClick={() => { setCustomColor(preferences.customTheme); setCustomAccent(preferences.customAccent); setCustomDark(preferences.customThemeDark); setCustomEditor(false); }}>取消</button><button type="submit" className="button" disabled={!validCustomColor || !validCustomAccent}>保存主题色</button></div>
      </form>}
      <Toggle title="夜间模式跟随系统" note="启用后自动切换夜间模式将不可用" checked={preferences.followSystem} onChange={followSystem => update({ followSystem })} />
      <Toggle title="将A屏黑主题设为夜间模式" note="夜间使用纯黑背景" checked={preferences.blackAtNight} onChange={blackAtNight => update({ blackAtNight })} />
      <Toggle title="自动切换夜间模式" note="按本机时间切换日间和夜间主题" checked={preferences.autoNight} disabled={preferences.followSystem} onChange={autoNight => update({ autoNight })} />
      <form className={`preferences-times ${preferences.followSystem || !preferences.autoNight ? 'unavailable' : ''}`} onSubmit={event => { event.preventDefault(); if (validTime && !preferences.followSystem && preferences.autoNight) update({ nightStart: start, nightEnd: end }); }}>
        <div><strong>自定义夜间模式时间</strong><small>当前夜间时间为 {preferences.nightStart} ~ {preferences.nightEnd}</small></div>
        <fieldset disabled={preferences.followSystem || !preferences.autoNight}><legend className="sr-only">夜间时段</legend><label>开始<input type="time" aria-label="夜间开始时间" required value={start} onChange={event => setStart(event.target.value)} /></label><span aria-hidden="true">—</span><label>结束<input type="time" aria-label="夜间结束时间" required value={end} onChange={event => setEnd(event.target.value)} /></label><button type="submit" className="button secondary" disabled={!validTime}>保存时段</button></fieldset>
        {start === end && <p className="preferences-error" role="alert">开始和结束时间不能相同。</p>}
      </form>
      <Toggle title="显示快速回顶按钮" note="滚动浏览后显示，可回到当前页面或动态详情顶部" checked={preferences.showFastReturnView} onChange={showFastReturnView => update({ showFastReturnView })} />
    </section>
    <section className="preferences-group preferences-background" aria-label="自定义背景设置"><div className="preferences-background-header"><div><h4>自定义背景</h4><p>全窗口使用同一张背景，导航、顶部栏和内容面板同步生效。</p></div><button type="button" className="button secondary" disabled={!!busy || !window.coolapk?.background} onClick={() => void changeBackground('choose')}>{background?.available ? '更换背景图片' : '选择背景图片'}</button></div>
      <div className="preferences-background-preview">{background?.available ? <><img src={background.url} alt="已选择的背景预览" style={{ opacity: preferences.backgroundOpacity }} /><div className="preferences-background-sample" style={{ background: `color-mix(in srgb, var(--surface) ${Math.round(preferences.surfaceOpacity * 100)}%, transparent)` }}><strong>酷安</strong><span>动态与生活，清晰可读</span></div></> : <span>{backgroundLoading ? '正在读取背景…' : '尚未选择背景图片'}</span>}</div>
      {background?.available && <p className="preferences-background-file">{background.name} · {background.width} × {background.height}</p>}
      <Toggle title="启用自定义背景" checked={preferences.backgroundEnabled && !!background?.available} disabled={!background?.available || !!busy} onChange={backgroundEnabled => update({ backgroundEnabled })} />
      <label className="preferences-row preferences-background-range"><span><strong>背景图片不透明度</strong><small>调低后图片更淡，不影响文字清晰度</small></span><div><input type="range" aria-label="背景图片不透明度" min={0} max={100} step={1} value={Math.round(preferences.backgroundOpacity * 100)} onChange={event => update({ backgroundOpacity: Number(event.target.value) / 100 })} /><output>{Math.round(preferences.backgroundOpacity * 100)}%</output></div></label>
      <label className="preferences-row preferences-background-range"><span><strong>内容区域不透明度</strong><small>同时调整导航、顶部栏、卡片和设置；建议保持 85% 以上</small></span><div><input type="range" aria-label="内容区域不透明度" min={40} max={100} step={1} value={Math.round(preferences.surfaceOpacity * 100)} onChange={event => update({ surfaceOpacity: Number(event.target.value) / 100 })} /><output>{Math.round(preferences.surfaceOpacity * 100)}%</output></div></label>
      <div className="preferences-background-footer"><small>支持 JPEG、PNG、WebP，最大 16 MB。图片副本仅保存在本机。</small><button type="button" className="text-button" disabled={!!busy || !background?.available} onClick={() => void changeBackground('remove')}>删除背景并恢复默认</button></div>
    </section>
    <p className="preferences-note">设置保存在本机。跟随系统的字号由 Windows 显示缩放适配；定时主题支持跨午夜，配色在夜间切换后保留。强调色用于小字时会自动调整以便阅读。</p>{notifications}
  </> : <>
    <header className="preferences-overview-heading"><h3>让酷安更适合你</h3><p>管理账号、显示偏好与本机数据。</p></header><div className="preferences-overview-grid"><section className="preferences-group preferences-account-group" aria-label="账号与显示">
      {props.onAccountProfile && <Entry title="头像与个人信息" icon={<UserRound size={19} />} onClick={props.onAccountProfile} />}
      {props.onAccountSecurity && <Entry title="账号与绑定" note="打开酷安官方账号安全页面" icon={<Shield size={19} />} disabled={!!busy} onClick={() => void run('security', props.onAccountSecurity!)} />}
      {props.onManageAccounts && <Entry title="本机账号管理" note={props.accountCount ? `已保存 ${props.accountCount} 个账号` : '登录或添加酷安账号'} icon={<Users size={19} />} onClick={props.onManageAccounts} />}
      <Entry title="界面显示" note="字体大小、主题和夜间模式" icon={<Monitor size={19} />} onClick={() => setDisplay(true)} />
      <Entry title="图片设置" note="实况音频、清晰度、水印与 HDR 检测" icon={<Image size={19} />} onClick={() => setImageSettings(true)} />
      {props.onAccountNotifications && <Entry title="订阅消息提醒" icon={<Bell size={19} />} onClick={props.onAccountNotifications} />}
      {props.onAccountPrivacy && <Entry title="隐私设置" icon={<Shield size={19} />} onClick={props.onAccountPrivacy} />}
      {props.onTeenager && <Entry title="青少年模式" note="精选内容、每日时长与夜间使用限制" icon={<Shield size={19} />} onClick={props.onTeenager} />}
      <Entry title="实验室" note="页面帧率与其他实验功能" icon={<FlaskConical size={19} />} onClick={() => setLaboratory(true)} />
    </section>
    {(props.onDownloads || props.onClearCache || props.onClearHistory) && <section className="preferences-group" aria-label="下载与清理">
      {props.onDownloads && <Entry title="下载安装" note="查看下载进度与手机安装" icon={<Download size={19} />} onClick={props.onDownloads} />}
      {props.onClearCache && <Entry title="缓存清理" note="清理图片与网页缓存，保留登录和下载文件" icon={<Trash2 size={19} />} disabled={!!busy} onClick={() => void run('cache', props.onClearCache!, '缓存已清理')} />}
      {props.onClearHistory && <Entry title="清空本地浏览历史" note="清除本机记录，云端历史保留" icon={<History size={19} />} disabled={!!busy} onClick={() => void run('history', props.onClearHistory!, '本地浏览历史已清空')} />}
    </section>}
    {(props.onHelp || props.onAgreement || props.onUpdates) && <section className="preferences-group" aria-label="帮助与协议">
      {props.onUpdates && <Entry title="软件更新" note="检查、下载并安装酷安桌面端的新版本" icon={<MonitorUp size={19} />} onClick={props.onUpdates} />}
      {props.onHelp && <Entry title="帮助与反馈" icon={<HelpCircle size={19} />} onClick={props.onHelp} />}
      {props.onAgreement && <Entry title="用户协议" icon={<FileText size={19} />} onClick={props.onAgreement} />}
    </section>}
    </div>{notifications}<div className="preferences-about"><h3>酷安 <small>{props.version}</small></h3><p>基于酷安 16.6.4 的非官方桌面客户端。</p><p>账号凭据使用 Windows 系统加密，仅保存在本机。</p><span><ExternalLink size={13} aria-hidden="true" />手机功能核对正在进行，完整设置仍在补齐。</span></div>
  </>}</main></div>;
}
