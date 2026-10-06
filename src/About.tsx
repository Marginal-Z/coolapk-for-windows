import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, HelpCircle, MessageSquare, MonitorUp } from 'lucide-react';
import desktopBrand from './assets/desktop-brand.png';
import { unwrap } from './data';
import './about.css';

const SOURCE_URL = 'https://github.com/Z-YO-YI/coolapk-for-windows';
const FEEDBACK_URL = SOURCE_URL + '/issues';

export function About({ version, onBack, onUpdates, onHelp, onAgreement }: {
  version: string; onBack: () => void; onUpdates?: () => void; onHelp?: () => void; onAgreement?: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function openProject(page: 'source' | 'feedback') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (!window.coolapk?.openExternal) throw new Error('桌面链接不可用');
      await unwrap(window.coolapk.openExternal(page === 'source' ? SOURCE_URL : FEEDBACK_URL));
    } catch {
      if (active.current) setError('无法打开链接，请检查系统默认浏览器后重试。');
    } finally {
      pending.current = false; if (active.current) setBusy(false);
    }
  }
  return <section className="about-page" aria-label="关于酷安客户端">
    <header className="preferences-heading"><button type="button" className="icon-button" aria-label="返回设置" onClick={onBack}><ArrowLeft size={18} /></button><h3>关于酷安</h3></header>
    <div className="about-identity"><img src={desktopBrand} alt="" width={64} height={64} /><div><h4>coolapk desktop</h4><p>非官方 Windows 桌面客户端</p><span className="about-version">版本 {version}</span></div></div>
    <section className="about-statement" aria-labelledby="about-statement-title"><h4 id="about-statement-title">第三方客户端声明</h4><p>本客户端由第三方独立开发和维护，不是酷安官方产品，与酷安官方无隶属关系，也不代表酷安官方。本项目未获得酷安官方的认可或背书。</p><p>酷安名称、标识及相关商标归相应权利人所有。社区内容、应用资料、图片等的权利归原作者或相应权利人所有；本客户端的展示不代表取得这些内容的所有权。</p><p>功能与数据依赖酷安官方服务，官方服务调整可能影响访问。账号登录及安全验证仍由你亲自完成，本客户端不会代做验证码或绕过账号安全检查。</p></section>
    <section className="about-project" aria-labelledby="about-project-title"><h4 id="about-project-title">项目与支持</h4><p>源码和本客户端的问题反馈在 GitHub 项目中维护。酷安账号及官方服务的问题，可通过酷安帮助处理。</p><div className="about-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => void openProject('source')}><ExternalLink size={16} aria-hidden="true" />查看源码</button><button type="button" className="button secondary" disabled={busy} onClick={() => void openProject('feedback')}><MessageSquare size={16} aria-hidden="true" />反馈客户端问题</button>{onUpdates && <button type="button" className="button" onClick={onUpdates}><MonitorUp size={16} aria-hidden="true" />检查软件更新</button>}{onHelp && <button type="button" className="text-button" onClick={onHelp}><HelpCircle size={16} aria-hidden="true" />酷安帮助</button>}{onAgreement && <button type="button" className="text-button" onClick={onAgreement}>酷安用户协议</button>}</div>{busy && <p className="about-status" role="status">正在打开浏览器…</p>}{error && <p className="about-error" role="alert">{error}</p>}</section>
  </section>;
}
