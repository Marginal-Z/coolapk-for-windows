import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, History, MessageCircle, Users } from 'lucide-react';
import { Avatar, Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Modal, Picture, RichText, Skeleton } from './components';
import { Attachments, clearAttachments, uploadAttachments, type Attachment } from './Attachments';
import { call, ClientError, count, imageUrl, plain, relativeTime, secureUrl, useResource } from './data';
import type { Entity } from './types';
import './community.css';

const enabled = (value: unknown) => [true, 1, '1', 'true'].includes(value as any);
const object = (value: any): Entity => { try { return typeof value === 'string' ? JSON.parse(value) : value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
export function isQuestion(feed: Entity) {
  const markers = [feed.feedType, feed.feed_type, feed.entityType, feed.entityTemplate, feed.type].map(value => String(value || '').toLowerCase());
  return !markers.some(value => /answer|回答/.test(value)) && (markers.some(value => /question|提问/.test(value)) || !!feed.question);
}
export function isFeedEntity(item: Entity) { return ['feed', 'question', 'answer', 'feedQuestion', 'feedAnswer', 'dyhArticle'].includes(item.entityType) || !!item.feedType && !!item.id; }

export function useInteraction(namespace: string) {
  const [error, setError] = useState<ClientError>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ operation: string; args: Entity; success?: (data: Entity) => void } | null>(null);
  const version = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => { version.current++; pending.current = null; inFlight.current = false; setError(undefined); setBusy(false); return () => { version.current++; }; }, [namespace]);
  async function run(operation: string, args: Entity, success?: (data: Entity) => void) {
    if (inFlight.current) return;
    const attempt = version.current; pending.current = { operation, args, success }; inFlight.current = true; setBusy(true); setError(undefined);
    try { const result = await call(operation, args); if (attempt === version.current) { success?.(result); return result; } }
    catch (e) { if (attempt === version.current) setError(e instanceof ClientError ? e : new ClientError((e as Error).message)); }
    finally { if (attempt === version.current) { inFlight.current = false; setBusy(false); } }
  }
  return { error, busy, locked: busy || !!error?.verificationId, run, retry: () => { const item = pending.current; if (item) void run(item.operation, item.args, item.success); } };
}

export function topicTabs(detail: Entity) {
  const source = detail.tabList || detail.tabApiList || detail.tab_list || detail.tabs || [];
  const entries = Array.isArray(source) ? source : source.data || source.entities || [];
  const tabs = entries.filter((item: Entity) => ![0, '0', false].includes(item.page_visibility ?? item.visibility ?? item.status ?? 1) && !item.hidden && item.visible !== false).map((item: Entity | string, index: number) => {
    const entry = typeof item === 'string' ? { title: item } : item;
    const title = plain(entry.title || entry.label || entry.name || entry.pageName || '讨论');
    const url = String(entry.url || entry.apiUrl || entry.pageUrl || entry.requestUrl || entry.requestArg || '');
    const descriptor = `${entry.pageName || entry.page_name || ''} ${title} ${url}`;
    return { id: String(entry.pageName || url || index), title, url, subTitle: String(entry.subTitle || ''), type: /device|设备|机型/.test(descriptor) ? 'device' : /question|问答|提问/.test(descriptor) ? 'question' : /feed|讨论/.test(descriptor) ? 'discussion' : 'generic' };
  });
  return tabs.length ? tabs : [{ id: 'feed', title: '讨论', url: '', subTitle: '', type: 'discussion' }];
}

type CommunityProps = { kind: string; id?: string; tag?: string; namespace: string; feedProps: any; onOpenEntity: (entity: Entity) => void };
export function CommunityPage({ kind, id, tag, namespace, feedProps, onOpenEntity }: CommunityProps) {
  const [revision, setRevision] = useState(0), [tab, setTab] = useState(''), [sort, setSort] = useState('lastupdate_desc');
  const [following, setFollowing] = useState(false), [videoFailed, setVideoFailed] = useState(false);
  const interaction = useInteraction(namespace + ':' + kind + ':' + (tag || id || ''));
  const detailOperation = kind === 'topic' ? 'topicDetail' : kind === 'live' ? 'liveDetail' : null;
  const detail = useResource(detailOperation, kind === 'topic' ? { tag } : { id }, namespace, revision);
  const detailValue = detail.data?.data;
  const raw = object(Array.isArray(detailValue) ? detailValue[0] : detailValue); const value = raw.live || raw.liveInfo || raw.entity || raw;
  const tabs = kind === 'topic' ? topicTabs(value) : [];
  const selected = tabs.find((item: Entity) => item.id === tab) || tabs.find((item: Entity) => [item.id, item.title, item.url].includes(value.selectedTab)) || tabs[0];
  useEffect(() => { setFollowing(enabled(value.userAction?.follow ?? value.isFollow ?? value.followed ?? value.follow)); }, [detail.data]);
  let operation: string | null = { followedTopics: 'followedTopics' }[kind] || null;
  let args: Entity = {};
  if (kind === 'topic' && detail.data) { operation = selected.type === 'device' ? 'topicDevices' : selected.type === 'discussion' || !selected.url ? 'topicEntries' : 'topicServerTab'; args = operation === 'topicServerTab' ? { url: selected.url, title: selected.title, subTitle: selected.subTitle } : { tag, sort }; }
  const resource = useResource(operation, args, namespace, revision);
  const items: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  const liveStatus = Number(value.liveStatus ?? value.live_status ?? value.status ?? 0);
  const liveUrl = secureUrl(liveStatus === -1 ? value.videoPlaybackUrl || value.video_playback_url : value.videoLiveUrl || value.video_live_url);
  const liveImage = secureUrl(value.pic || value.cover || value.image || value.logo);
  function follow() {
    if (!feedProps.loggedIn) return feedProps.onLogin();
    void interaction.run(kind === 'topic' ? 'topicFollow' : 'liveFollow', { ...(kind === 'topic' ? { tag } : { id }), status: following ? 0 : 1 }, () => { setFollowing(!following); feedProps.toast(following ? '已取消关注' : kind === 'live' ? '已预约直播' : '已关注'); });
  }
  const protectedPage = ['followedTopics'].includes(kind);
  if (protectedPage && !feedProps.loggedIn) return <Empty title="登录后查看" message="这些内容属于你的账号。"><button className="button" onClick={feedProps.onLogin}>登录酷安</button></Empty>;
  return <div className="community-page">
    {detail.error && <ErrorNotice error={detail.error} onRetry={() => setRevision(value => value + 1)} onLogin={feedProps.onLogin} />}
    {detail.loading && !detail.data && <Skeleton />}
    {detail.data && <section className="community-header"><Avatar src={value.logo || value.pic || value.userAvatar} name={plain(value.title || value.tag || tag || '酷')} size={64} /><div><h2>{plain(value.title || value.tag || tag || '直播详情')}</h2><RichText text={value.description || value.intro || value.message} onLink={feedProps.onLink} /><small>{count(value.follownum || value.follower_num || value.followNum)} {kind === 'live' ? '人预约' : '关注'}{kind === 'live' && ` · ${liveStatus === 1 ? '直播中' : liveStatus === -1 ? '已结束' : '尚未开始'}`}</small>{kind === 'live' && value.showLiveTime && <p>{plain(value.showLiveTime)}</p>}</div>{(kind !== 'live' || liveStatus === 0) && <button className="button" disabled={interaction.locked} onClick={follow}>{following ? kind === 'live' ? '已预约' : '已关注' : kind === 'live' ? '预约直播' : '关注'}</button>}</section>}
    {interaction.error && <ErrorNotice error={interaction.error} onRetry={interaction.retry} onLogin={feedProps.onLogin} />}
    {kind === 'live' && detail.data && <section className="community-live">{liveUrl && !videoFailed ? <video controls src={liveUrl} poster={imageUrl(liveImage) || undefined} preload="metadata" onError={() => setVideoFailed(true)} /> : <>{liveImage && <Picture src={liveImage} alt="直播封面" />}<p>{videoFailed ? '当前视频暂时无法播放。' : liveStatus === 0 ? '直播尚未开始，预约后可在酷安查看提醒。' : '酷安暂未返回可播放的视频地址。'}</p></>}<button className="text-button" onClick={() => window.coolapk?.openExternal(secureUrl(value.liveUrl || value.webUrl) || `https://www.coolapk.com/live/${id}`)}>查看直播官方页面</button></section>}
    {tabs.length > 1 && <div className="tabs" role="tablist" aria-label="社区栏目">{tabs.map((item: Entity) => <button key={item.id} role="tab" aria-selected={selected.id === item.id} className={selected.id === item.id ? 'selected' : ''} onClick={() => setTab(item.id)}>{item.title}</button>)}</div>}
    {kind === 'topic' && selected?.type === 'discussion' && <div className="community-sort"><label>动态排序<select aria-label="话题动态排序" value={sort} onChange={event => setSort(event.target.value)}><option value="lastupdate_desc">最新回复</option><option value="dateline_desc">最新发布</option><option value="hot">热门</option></select></label></div>}
    {resource.error && <ErrorNotice error={resource.error} onRetry={() => setRevision(value => value + 1)} onLogin={feedProps.onLogin} />}
    {resource.loading && !resource.data && <Skeleton />}
    {operation && !resource.loading && !resource.error && !items.length && <Empty />}
    <div className="feed-list">{items.map((item, index) => isFeedEntity(item) ? <FeedCard key={item.id || index} feed={item} {...feedProps} /> : <div key={item.id || item.uid || index}><EntityCard entity={item} onOpen={onOpenEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} /></div>)}</div>
    {items.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </div>;
}

export function VoteCard({ feed, namespace, loggedIn, onLogin, toast }: { feed: Entity; namespace: string; loggedIn: boolean; onLogin: () => void; toast: (text: string) => void }) {
  const [vote, setVote] = useState(() => object(feed.vote));
  const initial = object(feed.vote);
  const selectedInitially = (value: Entity) => (Array.isArray(value.user_vote || value.userVote) ? value.user_vote || value.userVote : []).map((item: any) => String(typeof item === 'object' ? item.id || item.option_id || item.optionId : item)).filter((id: string) => /^\d+$/.test(id));
  const [selected, setSelected] = useState<string[]>(() => selectedInitially(initial));
  const hasVote = (value: Entity) => selectedInitially(value).length > 0 || enabled(value.is_vote ?? value.isVote ?? value.voted);
  const [submitted, setSubmitted] = useState(() => hasVote(initial));
  const interaction = useInteraction(namespace + ':vote:' + feed.id);
  useEffect(() => { const next = object(feed.vote); setVote(next); setSelected(selectedInitially(next)); setSubmitted(hasVote(next)); }, [feed.id, feed.vote, namespace]);
  const options: Entity[] = Array.isArray(vote.options || vote.voteOptions || vote.vote_options) ? [...(vote.options || vote.voteOptions || vote.vote_options)].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)) : [];
  if (!options.length) return null;
  const max = Math.max(1, Math.min(options.length, Number(vote.max_select_num ?? vote.maxSelectNum) || 1));
  const min = Math.max(1, Math.min(max, Number(vote.min_select_num ?? vote.minSelectNum) || 1));
  const expires = Number(vote.expire_time ?? vote.end_time ?? 0);
  const ended = enabled(vote.is_expired) || (expires > 0 && expires < Date.now() / 1000) || Number(vote.status) === -1;
  const total = Number(vote.total_vote_num ?? vote.totalVoteNum) || 0;
  function toggle(id: string) { if (interaction.locked || submitted || ended || !/^\d+$/.test(id)) return; if (selected.includes(id)) setSelected(selected.filter(value => value !== id)); else if (max === 1) setSelected([id]); else if (selected.length < max) setSelected([...selected, id]); else toast(`最多选择 ${max} 项`); }
  function submit() { if (!loggedIn) return onLogin(); void interaction.run('voteSubmit', { id: String(feed.id), optionIds: [...selected], anonymous: enabled(vote.anonymous_status ?? vote.anonymousStatus) }, result => { const returned = object(result.data?.vote || result.data); setVote(old => ({ ...old, ...returned })); setSubmitted(true); toast('投票已提交'); }); }
  return <section className="community-vote" aria-label="投票"><header><strong>{plain(vote.message_title || vote.title || '投票')}</strong><span>{max > 1 ? `最多选 ${max} 项` : '单选'} · {count(total)} 人参与</span></header><div>{options.map((option, index) => { const id = String(option.id ?? option.option_id ?? option.optionId ?? ''), votes = Number(option.vote_num ?? option.voteNum ?? option.count) || 0; return <button key={id || index} type="button" role={max === 1 ? 'radio' : 'checkbox'} aria-checked={selected.includes(id)} disabled={interaction.locked || submitted || ended || !/^\d+$/.test(id)} className={selected.includes(id) ? 'selected' : ''} onClick={() => toggle(id)}><span>{selected.includes(id) ? <Check size={15} /> : null}</span>{plain(option.title || option.name || option.text || '选项')}{(submitted || ended) && <small>{count(votes)} 票{total > 0 ? ` · ${Math.round(votes / total * 100)}%` : ''}</small>}</button>; })}</div>{interaction.error && <ErrorNotice error={interaction.error} onRetry={interaction.retry} onLogin={onLogin} />}<footer><span>{ended ? '投票已结束' : submitted ? '已参与投票' : `请选择至少 ${min} 项`}</span>{!submitted && !ended && <button className="button" type="button" disabled={interaction.locked || selected.length < min || selected.length > max} onClick={submit}>提交投票</button>}</footer></section>;
}

export function FeedAuxiliary({ id, namespace, feedProps }: { id: string; namespace: string; feedProps: any }) {
  const [tab, setTab] = useState(''), [revision, setRevision] = useState(0);
  const operations: Entity = { forwards: 'feedForwards', likes: 'feedLikes', changes: 'feedChanges' };
  const resource = useResource(operations[tab] || null, { id }, namespace, revision);
  const items: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  return <section className="feed-auxiliary"><div className="feed-auxiliary-tabs">{[{ id: 'forwards', title: '转发记录', icon: MessageCircle }, { id: 'likes', title: '赞过的人', icon: Users }, { id: 'changes', title: '修改历史', icon: History }].map(item => <button className={tab === item.id ? 'selected' : ''} key={item.id} type="button" onClick={() => setTab(tab === item.id ? '' : item.id)}><item.icon size={14} />{item.title}</button>)}</div>{tab && <div className="feed-auxiliary-list">{resource.error && <ErrorNotice error={resource.error} onRetry={() => setRevision(value => value + 1)} onLogin={feedProps.onLogin} />}{resource.loading && !resource.data && <Skeleton />}{!resource.loading && !resource.error && !items.length && <Empty title="暂时没有记录" />}{items.map((item, index) => tab === 'likes' ? <EntityCard key={item.id || item.uid || index} entity={{ ...item, entityType: 'user' }} onOpen={() => feedProps.onUser(String(item.uid || item.id), item.username)} onUser={feedProps.onUser} onLink={feedProps.onLink} /> : tab === 'forwards' && isFeedEntity(item) ? <FeedCard key={item.id || index} feed={item} {...feedProps} /> : <article key={item.id || index} className="feed-change"><small>{relativeTime(item.dateline || item.created_at)}</small><RichText text={item.message || item.content || item.message_diff || item.title} onLink={feedProps.onLink} /></article>)}{items.length > 0 && tab !== 'changes' && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}</div>}</section>;
}

export function QuestionPane({ feed, namespace, feedProps, onChanged }: { feed: Entity; namespace: string; feedProps: any; onChanged: () => void }) {
  const [sort, setSort] = useState('reply'), [revision, setRevision] = useState(0), [mode, setMode] = useState('');
  const [message, setMessage] = useState(''), [uids, setUids] = useState(''), [attachments, setAttachments] = useState<Attachment[]>([]), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState<ClientError>(), [progress, setProgress] = useState('');
  const [followed, setFollowed] = useState(enabled(feed.userAction?.follow ?? feed.question?.isFollow));
  const interaction = useInteraction(namespace + ':question:' + feed.id);
  const resource = useResource('questionAnswers', { id: String(feed.id), sort }, namespace, revision);
  const answers: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  const mounted = useRef(true), latestAttachments = useRef(attachments); latestAttachments.current = attachments;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearAttachments(latestAttachments.current); }; }, []);
  const locked = uploading || interaction.locked || !!uploadError?.verificationId;
  function open(next: string) { if (!feedProps.loggedIn) return feedProps.onLogin(); if (interaction.locked) return; setUploadError(undefined); setMode(next); }
  function done(text: string) { if (!mounted.current) return; clearAttachments(attachments); setAttachments([]); setMessage(''); setUids(''); setMode(''); setRevision(value => value + 1); onChanged(); feedProps.toast(text); }
  async function submitAnswer() {
    if (locked && !uploadError?.verificationId || !mounted.current) return;
    setUploading(true); setUploadError(undefined);
    try { const pic = await uploadAttachments(attachments, setProgress, { shouldContinue: () => mounted.current }); if (!mounted.current) return; await interaction.run('questionAnswer', { id: String(feed.id), message, pic }, () => done('回答已发布')); }
    catch (e) { if (mounted.current) setUploadError(e instanceof ClientError ? e : new ClientError((e as Error).message)); }
    finally { if (mounted.current) { setUploading(false); setProgress(''); } }
  }
  function invite() { const ids = uids.trim().split(/[\s,，]+/).filter(Boolean); if (!ids.length || ids.some(id => !/^\d+$/.test(id))) { setUploadError(new ClientError('请输入数字 UID，使用逗号或空格分隔', 'INPUT')); return; } void interaction.run('questionInvite', { id: String(feed.id), uids: [...new Set(ids)] }, () => done('回答邀请已发送')); }
  return <section className="question-pane"><div className="question-actions"><strong>问答 · {count(feed.question_answer_num ?? feed.questionAnswerNum ?? answers.length)} 个回答</strong><button className="button secondary" disabled={interaction.locked} onClick={() => { if (!feedProps.loggedIn) return feedProps.onLogin(); void interaction.run(followed ? 'questionUnfollow' : 'questionFollow', { id: String(feed.id) }, () => setFollowed(!followed)); }}>{followed ? '已关注问题' : '关注问题'}</button><button className="text-button" onClick={() => open('invite')}>邀请回答</button><button className="button" onClick={() => open('answer')}>写回答</button></div>{interaction.error && !mode && <ErrorNotice error={interaction.error} onRetry={interaction.retry} onLogin={feedProps.onLogin} />}<div className="community-sort"><label>回答排序<select aria-label="回答排序" value={sort} onChange={event => setSort(event.target.value)}><option value="reply">最多讨论</option><option value="like">最多赞</option><option value="dateline">最新回答</option></select></label></div>{resource.error && <ErrorNotice error={resource.error} onRetry={() => setRevision(value => value + 1)} onLogin={feedProps.onLogin} />}{resource.loading && !resource.data && <Skeleton />}{!resource.loading && !resource.error && !answers.length && <Empty title="暂时没有回答" />}{answers.map((item, index) => <FeedCard key={item.id || index} feed={{ ...item, feedType: 'answer' }} {...feedProps} />)}{answers.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}{mode && <Modal title={mode === 'answer' ? '写回答' : '邀请回答'} onClose={() => { if (!uploading && !interaction.busy) setMode(''); }}><form className="community-form" onSubmit={event => { event.preventDefault(); if (mode === 'answer') void submitAnswer(); else invite(); }}>{mode === 'answer' ? <><label>回答内容<textarea aria-label="回答内容" value={message} disabled={locked} onChange={event => setMessage(event.target.value)} rows={7} maxLength={10000} /></label><Attachments values={attachments} onChange={setAttachments} disabled={locked} onError={text => setUploadError(new ClientError(text, 'INPUT'))} /></> : <label>邀请酷友 UID<input aria-label="邀请酷友 UID" value={uids} disabled={locked} onChange={event => setUids(event.target.value)} placeholder="多个数字 UID 用逗号或空格分隔" /></label>}{uploadError && <ErrorNotice error={uploadError} onRetry={() => mode === 'invite' ? invite() : void submitAnswer()} onLogin={feedProps.onLogin} />}{interaction.error && <ErrorNotice error={interaction.error} onRetry={interaction.retry} onLogin={feedProps.onLogin} />}<footer><span role="status">{progress || (mode === 'invite' ? '发送后，对方会在酷安收到提醒。' : '友善交流，分享你的经验。')}</span><button className="button" disabled={locked || (mode === 'answer' ? !message.trim() && !attachments.length : !uids.trim())}>{mode === 'answer' ? '发布回答' : '发送邀请'}</button></footer></form></Modal>}</section>;
}
