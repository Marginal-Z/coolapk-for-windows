import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, QrCode, Save, Shield, Star, UserRound, X } from 'lucide-react';
import { Avatar, Empty, ErrorNotice, LoadMore, Modal, Picture, Skeleton } from './components';
import { call, ClientError, plain, relativeTime, secureUrl, useResource } from './data';
import type { Account, Entity } from './types';
import regions from '../core/account-regions.json';
import './AccountCenter.css';

export type AccountSection = 'profile' | 'relations' | 'plugins' | 'cards' | 'channels' | 'history' | 'circles' | 'content' | 'status';
export type AccountCenterProps = { account: Account | null; namespace: string; section?: AccountSection; revision?: number; onLogin: () => void; onOpenEntity: (entity: Entity) => void; onLink: (url: string) => void; onUpdated?: () => void; onUsernameEdit?: () => unknown | Promise<unknown>; toast: (message: string) => void };
const sections: [AccountSection, string][] = [['profile', '个人资料'], ['relations', '好友与屏蔽'], ['circles', '关注圈子'], ['content', '我的内容'], ['status', '异常动态与回收站'], ['plugins', '头像与动态挂件'], ['cards', '主页卡片'], ['channels', '首页频道'], ['history', '云端浏览历史']];
type PanelProps = AccountCenterProps & { refresh: () => void; revision: number };
function useActions(props: PanelProps) {
  const [busy, setBusy] = useState(''), [error, setError] = useState<ClientError>();
  const pending = useRef<(() => Promise<void>) | null>(null), alive = useRef(true), owner = useRef(props.namespace); owner.current = props.namespace;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const active = (namespace: string) => alive.current && owner.current === namespace;
  async function run(key: string, work: () => Promise<any>, message = '设置已保存', refresh = true) {
    if (busy) return;
    const namespace = props.namespace;
    pending.current = () => run(key, work, message, refresh); setBusy(key); setError(undefined);
    try { const result = await work(); if (!active(namespace)) return; if (message) props.toast(message); if (refresh) { props.refresh(); props.onUpdated?.(); } return result; }
    catch (e) { if (active(namespace)) setError(e as ClientError); }
    finally { if (active(namespace)) setBusy(''); }
  }
  return { busy, error, run, active: () => active(props.namespace), notice: <ErrorNotice error={error} onLogin={props.onLogin} onRetry={() => void pending.current?.()} /> };
}
function Header({ title, text }: { title: string; text: string }) { return <div className="ac-heading"><h2>{title}</h2><p>{text}</p></div>; }
function Tabs({ items, value, onChange, label }: { items: [string, string][]; value: string; onChange: (s: any) => void; label: string }) { return <div className="ac-tabs" role="tablist" aria-label={label}>{items.map(([key, title]) => <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)}>{title}</button>)}</div>; }
export function AccountCenter(props: AccountCenterProps) {
  const [section, setSection] = useState<AccountSection>(props.section || 'profile'), [revision, setRevision] = useState(0);
  useEffect(() => setSection(props.section || 'profile'), [props.section]);
  const panel = { ...props, revision: revision + (props.revision || 0), refresh: () => setRevision(n => n + 1) };
  return <div className="account-center"><nav className="ac-navigation" aria-label="账号设置">{sections.map(([key, title]) => <button key={key} aria-current={key === section ? 'page' : undefined} onClick={() => setSection(key)}>{title}</button>)}</nav>{!props.account ? <Empty title="登录后管理你的账号" message="个人资料、屏蔽关系、挂件和云端记录会与酷安账号同步。"><button className="button" onClick={props.onLogin}>登录酷安</button></Empty> : <div className="ac-panel" key={props.namespace + ':' + section}>{section === 'profile' ? <ProfilePanel {...panel} /> : section === 'relations' ? <RelationsPanel {...panel} /> : section === 'plugins' ? <PluginsPanel {...panel} /> : section === 'history' ? <HistoryPanel {...panel} /> : ['circles', 'content', 'status'].includes(section) ? <AccountLists {...panel} kind={section as 'circles' | 'content' | 'status'} /> : <ConfigPanel {...panel} channels={section === 'channels'} />}</div>}</div>;
}

function ProfilePanel(props: PanelProps) {
  const resource = useResource('accountProfile', {}, props.namespace, props.revision), action = useActions(props);
  const [bio, setBio] = useState(''), [gender, setGender] = useState('-1'), [birthday, setBirthday] = useState(''), [province, setProvince] = useState(''), [city, setCity] = useState(''), [qrOpen, setQrOpen] = useState(false);
  const editVersions = useRef({ bio: 0, gender: 0, birthday: 0, location: 0 }), savedVersions = useRef({ bio: 0, gender: 0, birthday: 0, location: 0 });
  type ProfileField = keyof typeof editVersions.current;
  const edited = (field: ProfileField) => { editVersions.current[field]++; };
  const profile = resource.data?.data || {}, knownRegions: Record<string, string[]> = regions;
  // Refreshes may arrive while cached profile controls are being edited. Only clean fields hydrate.
  useEffect(() => {
    if (!resource.data) return;
    const clean = (field: ProfileField) => editVersions.current[field] === savedVersions.current[field];
    if (clean('bio')) setBio(profile.bio || profile.signature || '');
    if (clean('gender')) setGender(String(profile.gender ?? -1));
    if (clean('birthday')) setBirthday(profile.birthyear && profile.birthmonth && profile.birthday ? `${profile.birthyear}-${String(profile.birthmonth).padStart(2, '0')}-${String(profile.birthday).padStart(2, '0')}` : '');
    if (clean('location')) { setProvince(profile.province || ''); setCity(profile.city || ''); }
  }, [resource.data]);
  const submit = (field: ProfileField, args: Entity) => (event: FormEvent) => {
    event.preventDefault(); const submittedVersion = editVersions.current[field];
    void action.run(field, async () => {
      const result = await call('accountProfileUpdate', { field, ...args });
      // The replay keeps the original submission version, including during human verification.
      if (action.active() && editVersions.current[field] === submittedVersion) savedVersions.current[field] = submittedVersion;
      return result;
    });
  };
  async function changeImage(kind: 'avatar' | 'cover', file?: File) {
    if (!file) return;
    let uploaded = '';
    await action.run(kind, async () => {
      if (!file.size || file.size > 15 * 1024 * 1024) throw new ClientError('图片应为非空文件，最多 15 MB', 'INPUT');
      const bitmap = await createImageBitmap(file), { width, height } = bitmap; bitmap.close();
      const bytes = new Uint8Array(await file.arrayBuffer()); if (!action.active()) throw new ClientError('账号或页面已切换', 'ACCOUNT_CHANGED');
      if (kind === 'avatar') return call('accountAvatar', { bytes });
      if (!uploaded) { const result = await call('uploadImage', { bytes, width, height, dir: 'cover' }); if (typeof result.data !== 'string') throw new ClientError('背景图上传未返回地址'); uploaded = result.data; }
      if (!action.active()) throw new ClientError('账号或页面已切换', 'ACCOUNT_CHANGED');
      return call('accountCover', { url: uploaded });
    }, kind === 'avatar' ? '头像已更新' : '主页背景已更新');
  }
  return <><Header title="个人资料" text="每项设置单独保存到你的酷安账号。" /><ErrorNotice error={resource.error} onRetry={props.refresh} onLogin={props.onLogin} />{action.notice}{resource.loading && !resource.data ? <Skeleton /> : resource.data && <>
    <div className="ac-profile-summary"><Avatar src={profile.userAvatar || profile.avatar || props.account?.userAvatar} name={profile.username || props.account?.username} size={66} /><div><h3>{plain(profile.username || profile.userName || props.account?.username)}</h3><p>UID {props.account?.uid}</p></div><button className="button secondary" onClick={() => setQrOpen(true)}><QrCode size={16} />我的二维码</button><button className="button secondary" onClick={() => void action.run('username', async () => { if (props.onUsernameEdit) await props.onUsernameEdit(); else props.onLink('https://account.coolapk.com/account/changeUsername'); }, '', false)}>修改昵称</button></div>
    <div className="ac-image-settings"><label className="ac-image-choice"><UserRound size={20} /><strong>更换头像</strong><small>JPG、PNG、GIF、WebP</small><input aria-label="选择新头像" type="file" accept="image/jpeg,image/png,image/gif,image/webp" disabled={!!action.busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void changeImage('avatar', file); }} /></label><label className="ac-image-choice">{profile.cover || profile.coverUrl || profile.userCover ? <Picture src={profile.cover || profile.coverUrl || profile.userCover} alt="当前主页背景" className="ac-cover" /> : <Shield size={20} />}<strong>更换主页背景</strong><small>最多 15 MB，选取后保存</small><input aria-label="选择主页背景" type="file" accept="image/jpeg,image/png,image/gif,image/webp" disabled={!!action.busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void changeImage('cover', file); }} /></label></div>
    <form className="ac-form" onSubmit={submit('bio', { value: bio })}><label htmlFor="ac-bio">个性签名</label><textarea id="ac-bio" rows={3} maxLength={60} value={bio} onChange={e => { edited('bio'); setBio(e.target.value); }} /><div className="ac-form-footer"><small>{bio.length}/60</small><button className="button" disabled={!!action.busy}>保存签名</button></div></form>
    <form className="ac-row-form" onSubmit={submit('gender', { value: gender })}><label htmlFor="ac-gender">性别</label><select id="ac-gender" value={gender} onChange={e => { edited('gender'); setGender(e.target.value); }}><option value="-1">未设置</option><option value="0">女</option><option value="1">男</option></select><button className="button secondary" disabled={!!action.busy}>保存</button></form>
    <form className="ac-row-form" onSubmit={submit('birthday', { value: birthday })}><label htmlFor="ac-birthday">生日</label><input id="ac-birthday" type="date" max={new Date().toISOString().slice(0, 10)} value={birthday} onChange={e => { edited('birthday'); setBirthday(e.target.value); }} /><button className="button secondary" disabled={!!action.busy || !birthday}>保存</button></form>
    <form className="ac-form" onSubmit={submit('location', { province, city })}><label>所在地区</label><div className="ac-location"><select aria-label="省份" value={province} onChange={e => { edited('location'); setProvince(e.target.value); setCity(''); }}><option value="">选择省份</option>{province && !knownRegions[province] && <option value={province}>{province}</option>}{Object.keys(knownRegions).map(value => <option key={value}>{value}</option>)}</select><select aria-label="城市" value={city} disabled={!province} onChange={e => { edited('location'); setCity(e.target.value); }}><option value="">选择城市</option>{city && !(knownRegions[province] || []).includes(city) && <option value={city}>{city}</option>}{(knownRegions[province] || []).map(value => <option key={value}>{value}</option>)}</select><button className="button secondary" disabled={!!action.busy || !province || !city}>保存地区</button></div></form>
    {action.busy && <p className="ac-status" role="status">正在处理，请稍候…</p>}
  </>}{qrOpen && <Modal title="我的酷安二维码" onClose={() => setQrOpen(false)}><AccountQrPanel {...props} /></Modal>}</>;
}

function AccountQrPanel(props: PanelProps) {
  const resource = useResource('accountQr', {}, props.namespace, props.revision), image = resource.data?.data;
  return <div className="ac-qr"><p>扫码打开我的酷安主页</p><ErrorNotice error={resource.error} onRetry={props.refresh} onLogin={props.onLogin} />{resource.loading && !image ? <Skeleton /> : typeof image === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(image) ? <img src={image} alt="我的酷安主页二维码" /> : !resource.error && <Empty title="二维码暂不可用" message="请刷新后重试。" />}<strong>{plain(props.account?.username)}</strong><small>UID {props.account?.uid}</small></div>;
}

const contentTabs: [string, string][] = [['feed', '动态'], ['article', '图文'], ['qa', '问答'], ['coolpic', '酷图'], ['rating', '评分'], ['reply', '回复'], ['like', '赞过'], ['collection', '收藏单'], ['album', '应用集'], ['apk_follow', '关注应用'], ['developer_apps', '开发的应用'], ['discovery', '发现'], ['goods', '好物'], ['goods_store', '商品店'], ['goods_rank', '好物榜单'], ['ershou', '二手']];
function AccountLists(props: PanelProps & { kind: 'circles' | 'content' | 'status' }) {
  const [tab, setTab] = useState(props.kind === 'status' ? 'spam' : 'feed'), [ratingTarget, setRatingTarget] = useState('all');
  const operation = props.kind === 'circles' ? 'accountFollowNodes' : props.kind === 'status' && tab === 'spam' ? 'accountSpamFeeds' : 'accountTabData';
  const args = operation === 'accountTabData' ? { tab: props.kind === 'status' ? 'recycle' : tab, ratingTarget } : {};
  const resource = useResource(operation, args, props.namespace, props.revision);
  const title = props.kind === 'circles' ? '关注圈子' : props.kind === 'status' ? '异常动态与回收站' : '我的内容';
  const text = props.kind === 'circles' ? '查看账号关注的论坛与圈子，点击继续浏览。' : props.kind === 'status' ? '部分列表仅对有权限的账号开放，内容状态以酷安服务器为准。' : '浏览账号下的动态、图文、问答与收藏内容。';
  const rows: Entity[] = Array.isArray(resource.data?.data) ? resource.data.data : [];
  return <><Header title={title} text={text} />{props.kind !== 'circles' && <Tabs items={props.kind === 'status' ? [['spam', '异常动态'], ['recycle', '回收站']] : contentTabs} value={tab} onChange={setTab} label={title + '类别'} />}{tab === 'rating' && <label className="ac-rating-filter">评分对象<select aria-label="评分对象" value={ratingTarget} onChange={event => setRatingTarget(event.target.value)}><option value="all">全部</option><option value="apk">应用</option><option value="product">数码产品</option></select></label>}<ErrorNotice error={resource.error} onRetry={resource.failedMore ? resource.retry : props.refresh} onLogin={props.onLogin} />{resource.loading && !resource.data ? <Skeleton /> : <div className="ac-content-list">{rows.map((row, index) => <button type="button" className="ac-content-row" key={row.id || row.entityId || index} onClick={() => props.onOpenEntity(row)}>{(row.logo || row.pic || row.userAvatar) && <Picture className="ac-card-image" src={row.logo || row.pic || row.userAvatar} alt="" />}<span><strong>{plain(row.title || row.message_title || row.messageTitle || row.tag || row.name || row.username || '查看内容')}</strong><p>{plain(row.description || row.subTitle || row.message || '').slice(0, 500)}</p>{props.kind === 'status' && (row.spamReason || row.reason || row.statusText || row.blockStatusText) && <small>{plain(row.spamReason || row.reason || row.statusText || row.blockStatusText)}</small>}</span>{row.dateline && <time>{relativeTime(row.dateline)}</time>}</button>)}</div>}{!resource.loading && !resource.error && resource.data && !rows.length && <Empty title={props.kind === 'circles' ? '还没有关注的圈子' : '这里暂时没有内容'} message="刷新后会同步服务器最新列表。" />}{resource.data && <LoadMore loading={resource.loading} hasMore={resource.data.hasMore} onClick={resource.more} />}</>;
}

function RelationsPanel(props: PanelProps) {
  const [type, setType] = useState('follow'), [uid, setUid] = useState(''), [addType, setAddType] = useState('black'), [remark, setRemark] = useState<Entity | null>(null), [name, setName] = useState('');
  const resource = useResource('accountUsers', { type }, props.namespace, props.revision), action = useActions(props);
  const mutate = (args: Entity, message: string) => action.run(args.action + ':' + args.uid, () => call('accountRelationship', args), message);
  return <><Header title="好友与屏蔽" text="管理关注、粉丝、备注，以及黑名单和信息流屏蔽。" /><Tabs items={[["follow", "关注"], ["fans", "粉丝"], ["remarks", "备注"], ["black", "黑名单"], ["ignore", "屏蔽"], ["limit", "受限列表"]]} value={type} onChange={setType} label="关系类型" />
    <form className="ac-target" onSubmit={e => { e.preventDefault(); void mutate({ action: addType, uid }, '关系设置已更新'); }}><input aria-label="酷友 UID" placeholder="输入酷友 UID" inputMode="numeric" pattern="[0-9]+" required value={uid} onChange={e => setUid(e.target.value)} /><select aria-label="关系操作" value={addType} onChange={e => setAddType(e.target.value)}><option value="black">加入黑名单</option><option value="ignore">屏蔽动态</option><option value="follow">关注酷友</option></select><button className="button" disabled={!!action.busy}>确认</button></form>
    <ErrorNotice error={resource.error} onRetry={resource.failedMore ? resource.retry : props.refresh} onLogin={props.onLogin} />{action.notice}{resource.loading && !resource.data ? <Skeleton /> : <div className="ac-users">{(resource.data?.data || []).map((row: Entity) => <article className="ac-user" key={row.id || row.uid}><button className="ac-user-main" onClick={() => props.onOpenEntity(row)}><Avatar src={row.userAvatar} name={row.username} size={42} /><span><strong>{plain(row.remarkName || row.username)}</strong><small>{row.remarkName ? plain(row.username) + ' · ' : ''}UID {row.uid}</small></span></button><div className="ac-user-actions"><button className="icon-button" aria-label={`备注 ${row.username}`} onClick={() => { setRemark(row); setName(row.remarkName || ''); }}><Pencil size={16} /></button>{type === 'follow' && <><button className={`ac-small ${Number(row.isSpecialFollow) ? 'selected' : ''}`} disabled={!!action.busy} onClick={() => void mutate({ action: 'special', uid: row.uid, value: !Number(row.isSpecialFollow) }, '特别关注已更新')}><Star size={14} />{Number(row.isSpecialFollow) ? '取消特别关注' : '特别关注'}</button><button className="ac-small" disabled={!!action.busy} onClick={() => void mutate({ action: 'unfollow', uid: row.uid }, '已取消关注')}>取消关注</button></>}{type === 'fans' && <button className="ac-small" disabled={!!action.busy} onClick={() => void mutate({ action: 'cancelFan', uid: row.uid }, '已移除粉丝')}>移除粉丝</button>}{['black', 'ignore'].includes(type) && <button className="ac-small" disabled={!!action.busy} onClick={() => void mutate({ action: type === 'black' ? 'unblack' : 'unignore', uid: row.uid }, '已移出列表')}>移出{type === 'black' ? '黑名单' : '屏蔽'}</button>}</div></article>)}</div>}
    {!resource.loading && resource.data && !resource.data.data.length && <Empty title="列表为空" message="这里会显示该账号对应的酷友关系。" />}{resource.data && <LoadMore loading={resource.loading} hasMore={resource.data.hasMore} onClick={resource.more} />}
    {remark && <Modal title="修改备注" onClose={() => setRemark(null)}><form className="ac-remark" onSubmit={e => { e.preventDefault(); void action.run('remark', async () => { const result = await call('accountRelationship', { action: 'remark', uid: remark.uid, name }); if (action.active()) setRemark(null); return result; }, '备注已保存'); }}><p>{plain(remark.username)} · UID {remark.uid}</p><label htmlFor="ac-remark">备注名称，最多 30 字</label><input id="ac-remark" maxLength={30} autoFocus value={name} onChange={e => setName(e.target.value)} /><small>留空可取消备注。</small>{action.notice}<button className="button" disabled={!!action.busy}>保存备注</button></form></Modal>}
  </>;
}

function PluginsPanel(props: PanelProps) {
  const [mode, setMode] = useState('mine'), [type, setType] = useState('0'), [page, setPage] = useState(1), [rowState, setRowState] = useState<{ key: string; rows: Entity[] }>({ key: '', rows: [] }), [selected, setSelected] = useState(['0', '0']);
  const previous = useRef(''), selectionRevision = useRef(''), contextKey = JSON.stringify([props.namespace, mode, type]), key = JSON.stringify([contextKey, props.revision]), latestKey = useRef(key);
  latestKey.current = key;
  const requestedPage = previous.current === key ? page : 1;
  const resource = useResource('accountPlugins', { store: mode === 'store', type: Number(type), page: requestedPage }, props.namespace, props.revision), action = useActions(props);
  // Scope changes hide accumulated rows during the first render, before effects clear state.
  const rows = rowState.key === contextKey ? rowState.rows : [];
  useEffect(() => { if (previous.current !== key) { previous.current = key; setPage(1); setRowState(old => old.key === contextKey ? old : { key: contextKey, rows: [] }); } }, [key]);
  useEffect(() => {
    const data = resource.data?.data; if (!data || resource.loading || resource.error) return;
    const current = mode === 'store' ? data.pluginList : data[type === '0' ? 'avatarPluginList' : 'feedPluginList'] || data.pluginList;
    if (!Array.isArray(current)) return;
    setRowState(old => ({ key: contextKey, rows: [...new Map([...(requestedPage === 1 || old.key !== contextKey ? [] : old.rows), ...current, ...(mode === 'mine' && data[type === '0' ? 'selectedAvatarPluginRow' : 'selectedFeedPluginRow']?.id ? [data[type === '0' ? 'selectedAvatarPluginRow' : 'selectedFeedPluginRow']] : [])].map(row => [String(row.id), row])).values()] }));
    const currentRevision = props.namespace + ':' + props.revision;
    // Changing categories must retain both unsaved choices. Refresh after saving reloads the server selection.
    if (requestedPage === 1 && mode === 'mine' && !resource.loading && selectionRevision.current !== currentRevision) {
      selectionRevision.current = currentRevision;
      setSelected([String(data.selectedAvatarPluginRow?.id || 0), String(data.selectedFeedPluginRow?.id || 0)]);
    }
  }, [resource.data, resource.loading, resource.error]);
  const image = (row: Entity) => Number(row.plugin_type) === 0 ? row.avatar_plugin_logo || row.avatar_plugin : row.feed_plugin_logo || row.feed_plugin;
  const usable = (row: Entity) => !Number(row.expired) && (row.can_use == null || Number(row.can_use) === 1);
  async function claim(row: Entity) {
    if (mode !== 'store' || latestKey.current !== key || rowState.key !== contextKey || !rows.includes(row)) return;
    const target = secureUrl(row.get_url); if (!target) { props.toast('服务端没有提供可用的获取入口'); return; }
    const url = new URL(target);
    if (url.hostname !== 'm.coolapk.com' || url.pathname !== '/mp/userPlugin/getPlugin') { props.onLink(target); return; }
    await action.run('claim:' + row.id, async () => { if (latestKey.current !== key) throw new ClientError('挂件页面已切换，请重新选择', 'PAGE_CHANGED'); const result = await call('accountPluginClaim', { id: row.id }); if (result.data?.forwardUrl && action.active() && latestKey.current === key) { const forward = secureUrl(result.data.forwardUrl); if (forward) props.onLink(forward); } return result; }, '挂件获取请求已完成');
  }
  const current = resource.data?.data || {}, nextRows = mode === 'store' ? current.pluginList : current[type === '0' ? 'avatarPluginList' : 'feedPluginList'] || current.pluginList;
  return <><Header title="头像与动态挂件" text="选择已拥有的挂件，或查看官方挂件商店的获取条件。" /><Tabs items={[["mine", "我的挂件"], ["store", "挂件商店"]]} value={mode} onChange={setMode} label="挂件页面" />{mode === 'mine' && <Tabs items={[["0", "头像挂件"], ["1", "动态挂件"]]} value={type} onChange={setType} label="挂件类别" />}<ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={props.onLogin} />{action.notice}{resource.loading && !rows.length ? <Skeleton /> : <div className="ac-plugin-grid">{mode === 'mine' && <button className="ac-plugin" aria-pressed={selected[Number(type)] === '0'} disabled={!!action.busy} onClick={() => setSelected(old => old.map((value, i) => i === Number(type) ? '0' : value))}><span><X size={28} /></span><strong>不使用挂件</strong></button>}{rows.map(row => <article className={`ac-plugin ${mode === 'mine' && selected[Number(type)] === String(row.id) ? 'chosen' : ''}`} key={row.id}><button disabled={!!action.busy || mode === 'mine' && !usable(row)} aria-pressed={mode === 'mine' ? selected[Number(type)] === String(row.id) : undefined} onClick={() => mode === 'mine' && setSelected(old => old.map((value, i) => i === Number(type) ? String(row.id) : value))}>{image(row) ? <Picture src={image(row)} alt={plain(row.title)} className="ac-plugin-image" /> : <Star size={26} />}<strong>{plain(row.title)}</strong></button><small>{Number(row.plugin_type) === 0 ? '头像挂件' : '动态挂件'}{!usable(row) ? ' · 已过期或不可用' : row.day_left ? ' · ' + plain(row.day_left) : ''}</small>{mode === 'store' && <><p>{plain(row.getFuncStr || '')}</p><button className="button secondary" disabled={!!action.busy || Number(row.is_get) === 1 || Number(row.get_start_time) > Date.now() / 1000 || Number(row.get_expire_time) > 0 && Number(row.get_expire_time) < Date.now() / 1000} onClick={() => void claim(row)}>{Number(row.is_get) === 1 ? '已获取' : '获取'}</button></>}</article>)}</div>}
    {!resource.error && Array.isArray(nextRows) && nextRows.length > 0 && <LoadMore loading={resource.loading} onClick={() => setPage(n => n + 1)} />}{mode === 'mine' && resource.data && <div className="ac-save-bar"><button className="button" disabled={!!action.busy || resource.loading} onClick={() => void action.run('savePlugins', () => call('accountPluginSave', { avatarId: selected[0], feedId: selected[1] }), '挂件设置已保存')}><Save size={16} />保存挂件</button></div>}
  </>;
}

function ConfigPanel(props: PanelProps & { channels: boolean }) {
  const [mode, setMode] = useState('manage'), [rows, setRows] = useState<Entity[]>([]);
  const operation = props.channels ? 'accountChannels' : mode === 'manage' ? 'accountCardManager' : 'accountCards';
  const resource = useResource(operation, props.channels ? { reset: false } : { refresh: true }, props.namespace, props.revision), action = useActions(props);
  useEffect(() => { let data = resource.data?.data; if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } } if (!Array.isArray(data)) return; if (props.channels) data = data.find((row: Entity) => row.title === '首页' && Array.isArray(row.entities))?.entities || data; setRows(data.map((row: Entity) => ({ ...row, visible: Number(row.page_visibility) === 1 }))); }, [resource.data]);
  function move(index: number, delta: number) { setRows(old => { const next = [...old], to = index + delta; if (to < 0 || to >= next.length) return old; [next[index], next[to]] = [next[to], next[index]]; return next; }); }
  function save() { void action.run('saveConfig', () => props.channels ? call('accountChannelSave', { channels: rows.map(row => ({ id: row.id ?? row.entityId, title: plain(row.title), visible: row.visible })) }) : call('accountCardSave', { show: rows.filter(row => row.visible).map(row => Number(row.id)), hide: rows.filter(row => !row.visible).map(row => Number(row.id)) }), props.channels ? '首页频道已保存' : '主页卡片已保存'); }
  return <><Header title={props.channels ? '首页频道' : '主页卡片'} text="调整显示状态和顺序，保存后同步到酷安账号。" />{!props.channels && <Tabs items={[["manage", "卡片管理"], ["view", "我的卡片"]]} value={mode} onChange={setMode} label="卡片页面" />}<ErrorNotice error={resource.error} onRetry={props.refresh} onLogin={props.onLogin} />{action.notice}{resource.loading && !resource.data ? <Skeleton /> : mode === 'view' && !props.channels ? <div className="ac-cards">{rows.map((row, i) => <section key={row.entityId || row.id || i}><h3>{plain(row.title)}</h3>{(row.entities || []).map((item: Entity, index: number) => <button className="ac-card-item" key={item.id || index} onClick={() => item.url ? props.onLink(item.url) : props.onOpenEntity(item)}>{(item.logo || item.pic || item.userAvatar) && <Picture src={item.logo || item.pic || item.userAvatar} alt="" className="ac-card-image" />}<span><strong>{plain(item.title || item.username)}</strong><small>{plain(item.subTitle || item.description || item.typeName)}</small></span></button>)}{!row.entities?.length && <p>{plain(row.emptyText || row.description || '暂无内容')}</p>}</section>)}</div> : <div className="ac-config-list">{rows.map((row, index) => <article className="ac-config-row" key={row.id || row.entityId || index}><label><input type="checkbox" checked={!!row.visible} disabled={!!action.busy || props.channels && Number(row.page_fixed) === 1} onChange={e => setRows(old => old.map((item, i) => i === index ? { ...item, visible: e.target.checked } : item))} /><span>{plain(row.title)}</span>{Number(row.page_fixed) === 1 && <small>固定</small>}</label><button className="icon-button" aria-label={`上移 ${plain(row.title)}`} disabled={!!action.busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button className="icon-button" aria-label={`下移 ${plain(row.title)}`} disabled={!!action.busy || index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button></article>)}</div>}
    {resource.data && (mode === 'manage' || props.channels) && <div className="ac-save-bar"><button className="button" disabled={!!action.busy || resource.loading || !rows.length} onClick={save}><Check size={16} />保存设置</button>{props.channels && <button className="button secondary" disabled={!!action.busy} onClick={() => void action.run('resetChannels', () => call('accountChannels', { reset: true }), '已请求恢复默认频道')}>恢复默认频道</button>}</div>}
  </>;
}

function HistoryPanel(props: PanelProps) {
  const [type, setType] = useState('feed'), resource = useResource('accountHistory', { type }, props.namespace, props.revision);
  return <><Header title="云端浏览历史" text="读取酷安账号的历史记录，可继续查看曾经访问的内容。" /><Tabs items={[["feed", "看过的动态"], ["recent", "最近访问"]]} value={type} onChange={setType} label="云端历史类型" /><ErrorNotice error={resource.error} onRetry={resource.failedMore ? resource.retry : props.refresh} onLogin={props.onLogin} />{resource.loading && !resource.data ? <Skeleton /> : <div className="ac-history">{(resource.data?.data || []).map((row: Entity, index: number) => <button className="ac-history-row" key={row.id || row.entityId || index} onClick={() => row.url ? props.onLink(row.url) : props.onOpenEntity(row)}>{row.logo || row.pic || row.userAvatar ? <Picture src={row.logo || row.pic || row.userAvatar} alt="" className="ac-card-image" /> : <UserRound size={28} />}<span><strong>{plain(row.title || row.message_title || row.username || '浏览记录')}</strong><small>{plain(row.subTitle || row.description || row.historyType || '')}</small></span><time>{row.dateline ? relativeTime(row.dateline) : ''}</time></button>)}</div>}{!resource.loading && resource.data && !resource.data.data.length && <Empty title="还没有云端记录" message="浏览后，官方记录会出现在这里。" />}{resource.data && <LoadMore loading={resource.loading} hasMore={resource.data.hasMore} onClick={resource.more} />}</>;
}
