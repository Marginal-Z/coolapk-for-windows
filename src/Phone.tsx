import { useEffect, useId, useState } from 'react';
import { Cable, Download, MonitorPlay, RefreshCw, Smartphone } from 'lucide-react';
import { unwrap } from './data';
import { Empty, Modal } from './components';
import type { Entity } from './types';
export default function Phone({ toast, target }: { toast: (s: string) => void; target?: string }) {
  const [status, setStatus] = useState<Entity>({ devices: [] });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [serial, setSerial] = useState('');
  const [screenOff, setScreenOff] = useState(false);
  const [showUpdates, setShowUpdates] = useState(target === 'updates');
  const updateInstructionsId = useId();
  const phone = async (op: string, args = {}) => { if (!window.coolapk?.phone) throw new Error('请在桌面应用中使用手机协同'); return unwrap(window.coolapk.phone(op, args)); };
  async function refresh() { try { setStatus(await phone('status')); } catch (e) { setStatus({ devices: [], error: (e as Error).message }); } }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { setShowUpdates(target === 'updates'); }, [target]);
  async function perform(op: string, args: Entity) { setBusy(true); try { await phone(op, args); toast(op === 'install' ? '安装成功' : op === 'start' ? '手机协同窗口已启动' : '协同窗口已关闭'); setSelected(null); await refresh(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }
  async function pick(device: Entity) { try { setSerial(device.serial); setSelected(await phone('pickApk')); } catch (e) { toast((e as Error).message); } }
  return <section className="phone-page"><div className="section-heading"><div><h2><Cable size={24} /> USB 手机协同</h2><p>手机专属功能在桌面协同窗口中完成。</p></div><button className="text-button" onClick={() => void refresh()}><RefreshCw size={16} />检测连接</button></div>
    {status.error && <p role="alert" className="inline-error">{status.error}</p>}
    <div className="phone-screen-mode"><label><input type="checkbox" checked={screenOff} disabled={busy || status.devices?.some((device: Entity) => device.running)} onChange={event => setScreenOff(event.target.checked)} /><strong>手机熄屏，桌面继续操作</strong></label><p>开启后在启动协同窗口时关闭手机屏幕，USB 连接期间保持协同。关闭窗口后恢复原来的保持唤醒设置；按手机电源键可点亮屏幕。已有窗口请关闭后重新打开以切换模式。</p><p>手机设有安全锁时，请先本人解锁；桌面协同仍会遵守手机的锁屏验证。</p></div>
    {target === 'backups' && <div className="phone-help"><h3>手机应用备份与恢复</h3><p>打开酷安手机窗口，进入“我的 → 更多 → 备份单”。选择“创建备份单”备份手机应用；打开已有备份单可恢复安装。完成后返回桌面备份单页面刷新。</p></div>}
    <section className="phone-help phone-updates" aria-labelledby={`${updateInstructionsId}-title`}>
      <div className="phone-updates-heading"><div><h3 id={`${updateInstructionsId}-title`}><Download size={20} aria-hidden="true" />手机应用更新</h3><p>在手机协同窗口中查看和更新已安装的 Android 应用。</p></div><button className="button secondary" aria-expanded={showUpdates} aria-controls={updateInstructionsId} onClick={() => setShowUpdates(value => !value)}>{showUpdates ? '收起更新步骤' : '查看更新步骤'}</button></div>
      <div id={updateInstructionsId} hidden={!showUpdates}><ol><li>在下方选择已授权的手机，点击“打开酷安手机窗口”。</li><li>在手机酷安首页点击右上角 APP 图标，进入应用市场。</li><li>点击右上角带更新数量的下载图标，进入“应用管理 → 更新”。</li></ol><p>更新数量由手机酷安显示；桌面客户端的版本更新在“设置 → 软件更新”中管理。</p></div>
    </section>
    {status.devices?.map((device: Entity) => <article className="phone-device" key={device.serial}><Smartphone size={32} /><div><h3>{device.model}</h3><span>{device.state === 'device' ? 'USB 调试已授权' : device.state === 'unauthorized' ? '请在手机上允许 USB 调试' : '手机离线'}{device.running && device.screenOff ? ' · 熄屏协同中' : ''}</span></div><button className="button" disabled={busy || device.state !== 'device'} onClick={() => void perform(device.running ? 'stop' : 'start', { serial: device.serial, ...(device.running ? {} : { screenOff }) })}><MonitorPlay size={16} />{device.running ? '关闭窗口' : '打开酷安手机窗口'}</button><button className="button secondary" disabled={busy || device.state !== 'device'} onClick={() => void pick(device)}>安装 APK</button></article>)}
    {!status.devices?.length && <Empty title="等待手机连接" message="用 USB 连接 Android 手机，并在手机上启用和允许 USB 调试。" />}
    <div className="phone-help"><h3>协同窗口中的功能</h3><p>应用安装与更新、Android 系统权限、支付、依赖手机设备的直播操作。使用鼠标点击或拖动，键盘输入；右键返回，中键回到手机桌面。</p><p>手机和桌面账号分别登录。窗口关闭后手机内容仍保存在手机中。</p></div>
    {selected && <Modal title="在手机上安装 APK" onClose={() => setSelected(null)}><div className="compose-body"><p>即将在选中的手机安装 <strong>{selected.name}</strong>（{(selected.size / 1024 / 1024).toFixed(1)} MB）。同包名应用会更新，手机可能要求确认安装权限。</p><div className="compose-footer"><button className="button secondary" disabled={busy} onClick={() => setSelected(null)}>取消</button><button className="button" disabled={busy} onClick={() => void perform('install', { serial, token: selected.token })}>{busy ? '正在安装…' : '确认安装'}</button></div></div></Modal>}
  </section>;
}
