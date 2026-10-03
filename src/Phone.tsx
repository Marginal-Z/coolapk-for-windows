import { useEffect, useState } from 'react';
import { Cable, MonitorPlay, RefreshCw, Smartphone } from 'lucide-react';
import { unwrap } from './data';
import { Empty, Modal } from './components';
import type { Entity } from './types';
export default function Phone({ toast }: { toast: (s: string) => void }) {
  const [status, setStatus] = useState<Entity>({ devices: [] });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [serial, setSerial] = useState('');
  const phone = async (op: string, args = {}) => { if (!window.coolapk?.phone) throw new Error('请在桌面应用中使用手机协同'); return unwrap(window.coolapk.phone(op, args)); };
  async function refresh() { try { setStatus(await phone('status')); } catch (e) { setStatus({ devices: [], error: (e as Error).message }); } }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer); }, []);
  async function perform(op: string, args: Entity) { setBusy(true); try { await phone(op, args); toast(op === 'install' ? '安装成功' : op === 'start' ? '手机协同窗口已启动' : '协同窗口已关闭'); setSelected(null); await refresh(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }
  async function pick(device: Entity) { try { setSerial(device.serial); setSelected(await phone('pickApk')); } catch (e) { toast((e as Error).message); } }
  return <section className="phone-page"><div className="section-heading"><div><h2><Cable size={24} /> USB 手机协同</h2><p>手机专属功能在桌面协同窗口中完成。</p></div><button className="text-button" onClick={() => void refresh()}><RefreshCw size={16} />检测连接</button></div>
    {status.error && <p role="alert" className="inline-error">{status.error}</p>}
    {status.devices?.map((device: Entity) => <article className="phone-device" key={device.serial}><Smartphone size={32} /><div><h3>{device.model}</h3><span>{device.state === 'device' ? 'USB 调试已授权' : device.state === 'unauthorized' ? '请在手机上允许 USB 调试' : '手机离线'}</span></div><button className="button" disabled={busy || device.state !== 'device'} onClick={() => void perform(device.running ? 'stop' : 'start', { serial: device.serial })}><MonitorPlay size={16} />{device.running ? '关闭窗口' : '打开酷安手机窗口'}</button><button className="button secondary" disabled={busy || device.state !== 'device'} onClick={() => void pick(device)}>安装 APK</button></article>)}
    {!status.devices?.length && <Empty title="等待手机连接" message="用 USB 连接 Android 手机，并在手机上启用和允许 USB 调试。" />}
    <div className="phone-help"><h3>协同窗口中的功能</h3><p>应用安装与更新、Android 系统权限、支付、依赖手机设备的直播操作。使用鼠标点击或拖动，键盘输入；右键返回，中键回到手机桌面。</p><p>手机和桌面账号分别登录。窗口关闭后手机内容仍保存在手机中。</p></div>
    {selected && <Modal title="在手机上安装 APK" onClose={() => setSelected(null)}><div className="compose-body"><p>即将在选中的手机安装 <strong>{selected.name}</strong>（{(selected.size / 1024 / 1024).toFixed(1)} MB）。同包名应用会更新，手机可能要求确认安装权限。</p><div className="compose-footer"><button className="button secondary" disabled={busy} onClick={() => setSelected(null)}>取消</button><button className="button" disabled={busy} onClick={() => void perform('install', { serial, token: selected.token })}>{busy ? '正在安装…' : '确认安装'}</button></div></div></Modal>}
  </section>;
}
