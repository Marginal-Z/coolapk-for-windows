import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Download, ExternalLink, FileText, HelpCircle, History, Monitor, MonitorUp, Shield, Trash2, UserRound, Users } from 'lucide-react';
import { clockMinutes, preferenceFontScale, type Preferences } from '../core/preferences.mjs';
import './settings.css';

export type SettingsProps = {
  preferences: Preferences; onPreferencesChange: (patch: Partial<Preferences>) => void;
  namespace: string; accountCount: number; version: string; preferenceError?: string;
  onAccountProfile?: () => void; onAccountSecurity?: () => void | Promise<unknown>; onManageAccounts?: () => void;
  onDownloads?: () => void; onClearCache?: () => Promise<unknown>; onClearHistory?: () => void | Promise<unknown>;
  onHelp?: () => void; onAgreement?: () => void; onUpdates?: () => void;
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
  const [start, setStart] = useState(preferences.nightStart), [end, setEnd] = useState(preferences.nightEnd);
  const active = useRef(true), owner = useRef(props.namespace), pending = useRef<{ scope: string; key: string } | null>(null);
  owner.current = props.namespace;
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current = null; }; }, []);
  useEffect(() => { pending.current = null; setBusy(''); setError(''); setStatus(''); }, [props.namespace]);
  useEffect(() => { setStart(preferences.nightStart); setEnd(preferences.nightEnd); }, [preferences.nightStart, preferences.nightEnd]);
  async function run(key: string, work: () => void | Promise<unknown>, message = '') {
    if (pending.current) return;
    const request = { scope: props.namespace, key }; pending.current = request; setBusy(key); setError(''); setStatus('');
    const current = () => active.current && owner.current === request.scope && pending.current === request;
    try { await work(); if (current() && message) setStatus(message); }
    catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : '操作未完成，请重试。'); }
    finally { if (current()) { pending.current = null; setBusy(''); } }
  }
  const validTime = clockMinutes(start) !== null && clockMinutes(end) !== null && start !== end;
  const notifications = <>{props.preferenceError && <p className="preferences-error" role="alert">{props.preferenceError}</p>}{error && <p className="preferences-error" role="alert">{error}</p>}{busy && <p className="preferences-status" role="status">正在处理，请稍候…</p>}{status && <p className="preferences-status" role="status">{status}</p>}</>;
  return <div className="preferences-body">{display ? <>
    <header className="preferences-heading"><button type="button" className="icon-button" aria-label="返回设置" onClick={() => setDisplay(false)}><ArrowLeft size={18} /></button><h3>界面显示</h3></header>
    <section className="preferences-group" aria-label="界面显示设置">
      <label className="preferences-row"><span><strong>字体大小</strong><small>设置全局字体大小</small></span><select aria-label="字体大小" value={preferences.fontSize} onChange={event => update({ fontSize: event.target.value as Preferences['fontSize'] })}><option value="system">跟随系统</option><option value="large">大号</option><option value="standard">标准</option><option value="small">小号</option></select></label>
      <div className="preferences-preview" style={{ fontSize: `${14 * preferenceFontScale(preferences)}px` }}>发现好应用，聊聊新数码。<small>字体效果预览 · 系统显示缩放会自动适配</small></div>
      <label className="preferences-row"><span><strong>主题风格</strong><small>手动选择会关闭系统与定时切换</small></span><select aria-label="主题风格" value={preferences.theme} onChange={event => update({ theme: event.target.value as Preferences['theme'], followSystem: false, autoNight: false })}><option value="light">白色</option><option value="dark">黑色</option><option value="black">纯黑</option></select></label>
      <Toggle title="夜间模式跟随系统" note="启用后自动切换夜间模式将不可用" checked={preferences.followSystem} onChange={followSystem => update({ followSystem })} />
      <Toggle title="将A屏黑主题设为夜间模式" note="夜间使用纯黑背景" checked={preferences.blackAtNight} onChange={blackAtNight => update({ blackAtNight })} />
      <Toggle title="自动切换夜间模式" note="按本机时间切换日间和夜间主题" checked={preferences.autoNight} disabled={preferences.followSystem} onChange={autoNight => update({ autoNight })} />
      <form className={`preferences-times ${preferences.followSystem || !preferences.autoNight ? 'unavailable' : ''}`} onSubmit={event => { event.preventDefault(); if (validTime && !preferences.followSystem && preferences.autoNight) update({ nightStart: start, nightEnd: end }); }}>
        <div><strong>自定义夜间模式时间</strong><small>当前夜间时间为 {preferences.nightStart} ~ {preferences.nightEnd}</small></div>
        <fieldset disabled={preferences.followSystem || !preferences.autoNight}><legend className="sr-only">夜间时段</legend><label>开始<input type="time" aria-label="夜间开始时间" required value={start} onChange={event => setStart(event.target.value)} /></label><span aria-hidden="true">—</span><label>结束<input type="time" aria-label="夜间结束时间" required value={end} onChange={event => setEnd(event.target.value)} /></label><button type="submit" className="button secondary" disabled={!validTime}>保存时段</button></fieldset>
        {start === end && <p className="preferences-error" role="alert">开始和结束时间不能相同。</p>}
      </form>
    </section>
    <p className="preferences-note">设置保存在本机。跟随系统的字号由 Windows 显示缩放适配；定时主题支持跨午夜。</p>{notifications}
  </> : <>
    <section className="preferences-group" aria-label="账号与显示">
      {props.onAccountProfile && <Entry title="头像与个人信息" icon={<UserRound size={19} />} onClick={props.onAccountProfile} />}
      {props.onAccountSecurity && <Entry title="账号与绑定" note="打开酷安官方账号安全页面" icon={<Shield size={19} />} disabled={!!busy} onClick={() => void run('security', props.onAccountSecurity!)} />}
      {props.onManageAccounts && <Entry title="本机账号管理" note={props.accountCount ? `已保存 ${props.accountCount} 个账号` : '登录或添加酷安账号'} icon={<Users size={19} />} onClick={props.onManageAccounts} />}
      <Entry title="界面显示" note="字体大小、主题和夜间模式" icon={<Monitor size={19} />} onClick={() => setDisplay(true)} />
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
    {notifications}<div className="preferences-about"><h3>酷安桌面端 <small>{props.version}</small></h3><p>基于酷安 16.6.4 的非官方桌面客户端。</p><p>账号凭据使用 Windows 系统加密，仅保存在本机。</p><span><ExternalLink size={13} aria-hidden="true" />手机功能核对正在进行，完整设置仍在补齐。</span></div>
  </>}</div>;
}
