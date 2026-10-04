import { CheckCircle2, Download, LoaderCircle, MonitorUp, RefreshCw } from 'lucide-react';
import './software-update.css';

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'unsupported';
export type UpdateState = {
  currentVersion: string;
  status: UpdatePhase;
  distribution: 'installed' | 'portable' | 'development';
  availableVersion?: string | null;
  releaseDate?: string | null;
  releaseNotes?: string;
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  error?: string | null;
  errorCode?: string | null;
  checkedAt?: string | null;
};
export type UpdateAction = 'check' | 'download' | 'cancel' | 'install';

function bytes(value: number | undefined) {
  if (!value || !Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function date(value: string | null | undefined) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const statusText: Record<UpdatePhase, string> = {
  idle: '检查是否有新版本', checking: '正在检查更新…', available: '发现新版本', current: '已是最新版本',
  downloading: '正在下载更新…', downloaded: '更新已下载', installing: '正在启动安装程序…',
  error: '更新未完成', unsupported: '当前运行方式不支持自动更新',
};

export function SoftwareUpdate({ state, busy = false, error, onAction, onInstaller }: {
  state: UpdateState | null; busy?: boolean; error?: string; onAction: (operation: UpdateAction) => void; onInstaller?: () => void;
}) {
  const phase = state?.status;
  const pending = busy || phase === 'checking' || phase === 'installing';
  const active = pending || phase === 'downloading';
  const unsupported = phase === 'unsupported' || state?.distribution === 'development';
  const hasDownload = !!state?.availableVersion && (phase === 'available' || phase === 'error');
  const percent = Math.min(100, Math.max(0, Number.isFinite(state?.progress?.percent) ? state!.progress!.percent : 0));
  const releaseDate = date(state?.releaseDate), checkedAt = date(state?.checkedAt);
  const failure = error || state?.error;
  const Icon = phase === 'current' ? CheckCircle2 : phase === 'downloading' ? Download : pending ? LoaderCircle : MonitorUp;
  return <div className="software-update-body">
    <div className="software-update-heading">
      <Icon size={29} aria-hidden="true" />
      <div><h3>酷安桌面端</h3><p>当前版本 {state?.currentVersion || '读取中…'}{state && <span> · {state.distribution === 'portable' ? '便携版' : state.distribution === 'development' ? '开发版' : '安装版'}</span>}</p></div>
    </div>
    <p className="software-update-status" role="status" aria-live="polite" aria-atomic="true">{phase ? statusText[phase] : '正在读取更新信息…'}</p>
    {state?.availableVersion && phase !== 'current' && <section className="software-update-release" aria-label="新版本信息">
      <div className="software-update-release-title"><strong>版本 {state.availableVersion}</strong>{releaseDate && <time dateTime={state.releaseDate || undefined}>{releaseDate}</time>}</div>
      {state.releaseNotes && <p className="software-update-notes">{state.releaseNotes}</p>}
    </section>}
    {phase === 'downloading' && <div className="software-update-download">
      <div className="software-update-progress-label"><span>下载进度</span><strong>{percent.toFixed(1)}%</strong></div>
      <progress aria-label="更新下载进度" max={100} value={percent} />
      <p>{bytes(state?.progress?.transferred)} / {state?.progress?.total ? bytes(state.progress.total) : '正在获取大小'}<span>{bytes(state?.progress?.bytesPerSecond)}/s</span></p>
      <small>关闭此窗口后，下载会继续。</small>
    </div>}
    {failure && <p className="software-update-error" role="alert">{failure}</p>}
    {state?.distribution === 'portable' && !unsupported && <p className="software-update-note">便携版更新会转为安装版。安装后请使用新的快捷方式启动，账号和本地设置会保留。</p>}
    {phase === 'downloaded' && <p className="software-update-note">安装将退出软件。请先保存正在编辑的内容，安装完成后重新打开。</p>}
    {unsupported ? <p className="software-update-note">请使用 Windows 安装版检查和安装更新。</p> : <p className="software-update-note">每次启动自动检查新版本。下载和安装均由你确认。</p>}
    <div className="software-update-actions">
      {phase === 'downloading' ? <button type="button" className="button secondary" disabled={busy} onClick={() => onAction('cancel')}>取消下载</button> : phase === 'downloaded' || phase === 'installing' ? <button type="button" className="button" disabled={pending} onClick={() => onAction('install')}><MonitorUp size={16} aria-hidden="true" />{phase === 'installing' ? '正在启动安装…' : '退出并安装'}</button> : <>
        <button type="button" className={`button ${hasDownload ? 'secondary' : ''}`} disabled={!state || active || unsupported} onClick={() => onAction('check')}><RefreshCw size={16} aria-hidden="true" />{phase === 'checking' ? '正在检查…' : phase === 'error' ? '重试检查' : '检查更新'}</button>
        {hasDownload && <button type="button" className="button" disabled={active || unsupported} onClick={() => onAction('download')}><Download size={16} aria-hidden="true" />{phase === 'error' ? '重试下载' : '下载更新'}</button>}
      </>}
      {state?.distribution === 'portable' && onInstaller && <button type="button" className="button secondary" disabled={pending} onClick={onInstaller}>下载安装版</button>}
    </div>
    {checkedAt && <p className="software-update-checked">上次检查 {checkedAt}</p>}
  </div>;
}
