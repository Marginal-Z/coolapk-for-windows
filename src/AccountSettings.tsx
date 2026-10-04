import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOTIFICATION_SETTINGS, PRIVACY_SETTINGS, accountSettingConfirmation, type AccountSettingKey, type AccountSettingsPatch } from '../core/account-settings-models.mjs';
import type { AccountSettingsData } from '../core/account-settings.mjs';
import { Empty, ErrorNotice, Modal, Skeleton } from './components';
import { call, ClientError } from './data';
import './account-settings.css';

type Props = { page: 'privacy' | 'notifications'; namespace: string; loggedIn: boolean; onLogin?: () => void; onChanged?: (data: AccountSettingsData) => void };
type Confirmation = { patch: AccountSettingsPatch; title: string; message: string; action: string };
const clientError = (error: unknown) => error instanceof ClientError ? error : new ClientError((error as Error)?.message || '账号设置操作失败，请重试', (error as any)?.code || 'APP_ERROR');

export function AccountSettings(props: Props) { return <OwnedSettings key={`${props.namespace}:${props.loggedIn}:${props.page}`} {...props} />; }
function OwnedSettings({ page, loggedIn, onLogin, onChanged }: Props) {
  const [data, setData] = useState<AccountSettingsData>(), [busy, setBusy] = useState(loggedIn), [error, setError] = useState<ClientError>();
  const [status, setStatus] = useState(''), [confirmation, setConfirmation] = useState<Confirmation>();
  const active = useRef(false), generation = useRef(0), inFlight = useRef(false), pending = useRef<AccountSettingsPatch | undefined>(undefined);
  const callback = useRef(onChanged); callback.current = onChanged;
  useLayoutEffect(() => {
    active.current = true; generation.current++;
    return () => { active.current = false; generation.current++; inFlight.current = false; pending.current = undefined; };
  }, []);
  const cancelConfirmation = useCallback(() => setConfirmation(undefined), []);
  async function request(patch?: AccountSettingsPatch) {
    if (!loggedIn || !active.current || inFlight.current) return;
    const intended = patch ? Object.freeze({ ...patch }) : undefined;
    const attempt = ++generation.current, current = () => active.current && generation.current === attempt;
    pending.current = intended; inFlight.current = true; setBusy(true); setError(undefined); setStatus(''); setConfirmation(undefined);
    try {
      const result = await call(intended ? 'accountSettingsUpdate' : 'accountSettings', intended ? { patch: intended } : {});
      if (!current()) return;
      const next = result.data as AccountSettingsData;
      setData(next); pending.current = undefined;
      if (intended) setStatus('已保存并核对账号设置');
      callback.current?.(next);
    } catch (caught) { if (current()) setError(clientError(caught)); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  }
  useEffect(() => { void request(); }, []);
  function change(key: AccountSettingKey, value: boolean | string) {
    if (!data || busy || error || confirmation) return;
    const patch = Object.freeze({ [key]: value }) as AccountSettingsPatch;
    const prompt = accountSettingConfirmation(key, value);
    if (prompt) setConfirmation({ ...prompt, patch }); else void request(patch);
  }
  const fields = page === 'privacy' ? PRIVACY_SETTINGS : NOTIFICATION_SETTINGS, title = page === 'privacy' ? '隐私设置' : '订阅消息提醒';
  const groups = [...new Set(fields.map(field => field.group))], locked = busy || !!error || !!confirmation;
  const uncertain = error?.code === 'SETTINGS_UNCONFIRMED';
  if (!loggedIn) return <Empty title={`登录后管理${title}`} message="设置与当前酷安账号同步。">{onLogin && <button type="button" className="button" onClick={onLogin}>登录酷安</button>}</Empty>;
  return <div className="account-settings" aria-label={title} aria-busy={busy}>
    {busy && (data ? <p role="status" className="account-settings-message">正在保存或核对账号设置…</p> : <Skeleton />)}
    {data && groups.map(group => <section className="account-settings-group" key={group} aria-label={group}><h3>{group}</h3>{fields.filter(field => field.group === group).map(field => {
      const restricted = !!data.values.net_abuse_guard && ['receive_at_message', 'receive_message', 'feed_disallow_reply'].includes(field.key);
      const replyLocked = field.key === 'feed_disallow_reply' && data.replyLocked;
      return <label className="account-settings-row" key={field.key}><span><strong>{field.label}</strong>{field.note && <small>{field.note}</small>}{restricted && <small>一键防护开启期间无法修改</small>}{replyLocked && <small>当前账号的回复权限受限</small>}</span>{field.type === 'boolean' ? <input type="checkbox" role="switch" aria-label={field.label} checked={data.values[field.key] === true} disabled={locked || restricted || replyLocked} onChange={event => change(field.key, event.target.checked)} /> : <select aria-label={field.label} value={String(data.values[field.key])} disabled={locked || restricted || replyLocked} onChange={event => change(field.key, event.target.value)}>{replyLocked && <option value="-1">回复权限受限</option>}{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</label>;
    })}</section>)}
    {data?.values.net_abuse_guard && page === 'privacy' && data.guardExpiresAt != null && data.guardExpiresAt * 1000 <= 8.64e15 && <p className="account-settings-message">防护到期时间：{new Date(data.guardExpiresAt * 1000).toLocaleString()}</p>}
    {error && <div className="account-settings-errors"><ErrorNotice error={error} onLogin={onLogin} onRetry={error.verificationId ? () => void request(pending.current) : undefined} /><div className="account-settings-actions">{pending.current && !uncertain && !error.verificationId && !['ACCOUNT_CHANGED', 'LOGIN_REQUIRED'].includes(error.code) && <button type="button" className="button secondary" disabled={busy} onClick={() => void request(pending.current)}>重试保存</button>}<button type="button" className="button secondary" disabled={busy} onClick={() => void request()}>重新加载设置</button></div></div>}
    {status && <p role="status" className="account-settings-message">{status}</p>}
    {data && <><div className="account-settings-actions"><button type="button" className="text-button" disabled={busy || !!confirmation} onClick={() => void request()}>刷新账号设置</button></div><p className="account-settings-note">每次修改后从酷安重新读取确认。账号尚未保存的项目采用手机客户端默认值。</p>{page === 'notifications' && <p className="account-settings-note">这些开关管理酷安账号的消息订阅。Windows 后台推送接收仍在开发中，可在桌面端消息页查看互动和私信。</p>}</>}
    {confirmation && <Modal title={confirmation.title} onClose={cancelConfirmation}><div className="account-settings-confirm"><p>{confirmation.message}</p><div className="account-settings-actions"><button type="button" className="button secondary" onClick={cancelConfirmation}>取消</button><button type="button" className="button" onClick={() => void request(confirmation.patch)}>{confirmation.action}</button></div></div></Modal>}
  </div>;
}
