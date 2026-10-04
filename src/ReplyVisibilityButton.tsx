import { useLayoutEffect, useRef, useState } from 'react';
import { replyVisibilityMatches, replyVisibilityPermission, type ReplyVisibilityAction } from '../core/reply-visibility-models.mjs';
import { ErrorNotice, Modal } from './components';
import { call, ClientError, plain } from './data';
import type { Entity } from './types';

type Props = { reply: Entity; feedId: string; namespace: string; accountUid?: string; loggedIn: boolean; onLogin: () => void; onConfirmed: (reply: Entity) => void; toast: (text: string) => void };

export default function ReplyVisibilityButton({ reply, feedId, namespace, accountUid, loggedIn, onLogin, onConfirmed, toast }: Props) {
  const permission = replyVisibilityPermission(reply, { accountUid: loggedIn ? accountUid : undefined, feedId });
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Entity>(), [error, setError] = useState<ClientError>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const generation = useRef(0), inFlight = useRef(false), desired = useRef<ReplyVisibilityAction | undefined>(undefined);
  const scope = JSON.stringify([namespace, accountUid || '', loggedIn, feedId, reply.id]);
  useLayoutEffect(() => {
    generation.current++; inFlight.current = false; desired.current = undefined;
    setOpen(false); setBusy(false); setSnapshot(undefined); setError(undefined); setUnconfirmed(false);
    return () => { generation.current++; };
  }, [scope]);
  const asError = (failure: unknown) => failure instanceof ClientError ? failure : new ClientError((failure as Error).message);
  const freshPermission = snapshot ? replyVisibilityPermission(snapshot, { accountUid, feedId }) : null;

  async function read(checkOnly = false) {
    if (!loggedIn || !permission.visible || inFlight.current) return;
    const attempt = generation.current, target = desired.current;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await call('replyVisibility', { id: String(reply.id), feedId });
      if (attempt !== generation.current) return;
      const value = result.data?.reply;
      if (!value || String(value.id) !== String(reply.id) || String(value.fid) !== feedId || String(value.feedUid) !== accountUid) throw new ClientError('酷安返回的原评论或作者不匹配', 'API_ERROR');
      const capability = result.data?.permission;
      if (!capability?.visible) throw new ClientError(capability?.reason || '酷安未提供有效隐藏权限', 'REPLY_VISIBILITY_UNAVAILABLE');
      setSnapshot(value);
      if (checkOnly && target) {
        if (!replyVisibilityMatches(value, target)) throw new ClientError('原评论尚未显示目标状态；已保留评论列表，请稍后重新读取核对', 'WRITE_UNCONFIRMED');
        onConfirmed(value); setOpen(false); setUnconfirmed(false); desired.current = undefined;
        toast(target === 'hide' ? '已确认回复隐藏，曝光减少' : '已确认取消隐藏回复');
      } else desired.current = undefined;
    } catch (failure) { if (attempt === generation.current) setError(asError(failure)); }
    finally { if (attempt === generation.current) { inFlight.current = false; setBusy(false); } }
  }

  async function submit(retry = false) {
    if (!freshPermission?.enabled || !freshPermission.action || !snapshot || inFlight.current || unconfirmed || !retry && error?.verificationId) return;
    const action = desired.current || freshPermission.action, attempt = generation.current;
    desired.current = action; inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await call('replyVisibilityUpdate', { id: String(reply.id), feedId, action });
      if (attempt !== generation.current) return;
      const value = result.data?.reply;
      if (result.confirmed !== true || !value || String(value.id) !== String(reply.id) || String(value.fid) !== feedId || String(value.feedUid) !== accountUid || !replyVisibilityMatches(value, action)) throw new ClientError('隐藏结果尚未确认，请重新读取原评论核对', 'WRITE_UNCONFIRMED');
      onConfirmed(value); setOpen(false); desired.current = undefined;
      toast(action === 'hide' ? '已确认回复隐藏，曝光减少' : '已确认取消隐藏回复');
    } catch (failure) {
      if (attempt !== generation.current) return;
      const value = asError(failure); setError(value);
      if (['WRITE_UNCONFIRMED', 'NETWORK', 'HTTP'].includes(value.code)) setUnconfirmed(true);
    } finally { if (attempt === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  const close = () => {
    if (inFlight.current) return;
    generation.current++; desired.current = undefined; setOpen(false); setSnapshot(undefined); setError(undefined); setUnconfirmed(false);
    toast(unconfirmed ? '已关闭核对窗口，提交结果仍未确认' : '已取消回复隐藏操作');
  };
  if (!permission.visible) return null;
  const label = permission.hidden ? '取消隐藏回复' : '隐藏回复';
  return <>
    <button type="button" disabled={!permission.enabled || busy} title={permission.reason || `今日还可隐藏 ${permission.remaining} 条回复`} onClick={() => { setOpen(true); setSnapshot(undefined); setError(undefined); setUnconfirmed(false); desired.current = undefined; void read(); }}>{label}</button>
    {permission.hidden && <span className="muted" aria-label="回复已隐藏">已隐藏 · 减少曝光</span>}
    {!permission.enabled && <span className="muted" role="status">{permission.reason}</span>}
    {open && <Modal title={unconfirmed ? '核对回复隐藏结果' : '管理回复曝光'} onClose={close}>
      <div className="comment-delete-confirm" data-reply-visibility={reply.id}>
        {busy && <p role="status">正在读取或确认原评论…</p>}
        {snapshot && <><p>确定要{freshPermission?.action === 'resume' ? '取消隐藏' : '隐藏'} @{snapshot.username || snapshot.userInfo?.username || '酷友'} 的回复吗？</p><div className="comment-delete-preview">{plain(snapshot.message).slice(0, 240) || '图片评论'}</div><p>被隐藏的回复会减少曝光，仍可能被查看。酷安当前提供的今日剩余额度：{freshPermission?.remaining ?? '未确认'} 条；额度用尽时隐藏与取消隐藏均不可用。</p>{freshPermission && !freshPermission.enabled && <p role="status">{freshPermission.reason}</p>}</>}
        {error && <ErrorNotice error={error} onLogin={onLogin} onRetry={unconfirmed ? () => void read(true) : snapshot && desired.current ? () => void submit(true) : () => void read()} />}
        {unconfirmed && <p role="status">提交结果尚未确认，评论、排序与已加载的回复均已保留。请先重新读取原评论核对，避免重复提交。</p>}
        <footer><button type="button" className="button secondary" disabled={busy} onClick={close}>{unconfirmed ? '关闭核对窗口' : '取消'}</button>{unconfirmed ? <button type="button" className="button" disabled={busy || !!error?.verificationId} onClick={() => void read(true)}>重新读取原评论核对</button> : <button type="button" className="button" disabled={busy || !freshPermission?.enabled || !!error?.verificationId} onClick={() => void submit()}>{freshPermission?.action === 'resume' ? '确认取消隐藏' : '确认隐藏回复'}</button>}</footer>
      </div>
    </Modal>}
  </>;
}
