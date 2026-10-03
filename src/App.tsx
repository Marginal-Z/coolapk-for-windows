import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, Bookmark, Check, ChevronDown, Compass, Flame, Gamepad2, Hash, History, Home, Laptop, LogIn, LogOut, MessageCircle, Moon, Plus, RefreshCw, Search, Settings, ShoppingBag, Smartphone, Sun, Users, X } from 'lucide-react';
import { Avatar, Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Modal, RichText, Skeleton } from './components';
import { call, clearCache, count, plain, secureUrl, unwrap, useResource, type ClientError } from './data';
import Detail from './Detail';
import { ChatComposer, ChatMessage } from './Chat';
import { matchingSessionKey, sessionKey, sessionPartnerUid } from './chat-session';
import { CollectionEditor, CollectionPicker, FeedManager, collectionItemId } from './Collections';
import { Attachments, uploadAttachments, type Attachment } from './Attachments';
import type { AccountState, Entity, Page, Result } from './types';

const initialAccount: AccountState = { accounts: [], current: null };
const homePage: Page = { kind: 'home', title: '首页' };
const nav = [
  { kind: 'home', title: '首页', icon: Home }, { kind: 'rank', title: '热榜', icon: Flame },
  { kind: 'page', title: '话题广场', url: 'V9_HOME_TAB_TOPIC', icon: Hash },
  { kind: 'digital', title: '数码', icon: Smartphone },
  { kind: 'apps', title: '应用与游戏', icon: Gamepad2 },
  { kind: 'page', title: '二手', url: 'V11_FIND_GOOD_GOODS_HOME', icon: ShoppingBag },
];
const personal = [{ kind: 'following', title: '我的关注', icon: Users }, { kind: 'collections', title: '我的收藏', icon: Bookmark }, { kind: 'notifications', title: '通知', icon: Bell }, { kind: 'messages', title: '私信', icon: MessageCircle }, { kind: 'history', title: '浏览历史', icon: History }];
const searchTypes = [{ id: 'all', title: '综合' }, { id: 'feed', title: '动态' }, { id: 'user', title: '酷友' }, { id: 'topic', title: '话题' }, { id: 'apk', title: '应用' }, { id: 'game', title: '游戏' }, { id: 'product', title: '数码' }, { id: 'ershou', title: '二手' }];
function loadHistory(): Entity[] { try { return JSON.parse(localStorage.getItem('coolapk-history') || '[]'); } catch { return []; } }

export default function App() {
  const [accounts, setAccounts] = useState<AccountState>(initialAccount);
  const [pages, setPages] = useState<Page[]>([homePage]);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<Entity | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compose, setCompose] = useState<Entity | null>(null);
  const [collectFeed, setCollectFeed] = useState<Entity | null>(null);
  const [manageFeed, setManageFeed] = useState<Entity | null>(null);
  const [collectionEdit, setCollectionEdit] = useState<Entity | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [history, setHistory] = useState<Entity[]>(loadHistory);
  const [theme, setTheme] = useState(() => localStorage.getItem('coolapk-theme') || 'light');
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const page = pages.at(-1)!;
  const account = accounts.current;
  const namespace = account?.uid || 'guest';
  const init = useResource('init', {}, namespace);
  const hot = useResource('hotSearch', {}, namespace);
  const unread = useResource(account ? 'notificationCount' : null, {}, namespace, revision);
  const unreadData = unread.data?.data || {};
  const messageCount = Math.max(0, Number(unreadData.message ?? unreadData.messageCount) || 0);
  const totalUnread = Math.max(0, Number(unreadData.badge_v18 ?? unreadData.badge ?? unreadData.count ?? unreadData.total) || 0);
  const notificationCount = Math.max(0, totalUnread - messageCount);
  const toast = useCallback((message: string) => { setToastMessage(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMessage(''), 5000); }, []);
  const go = useCallback((next: Page, root = false) => { setPages(old => root ? [next] : [...old, next]); setDetail(null); }, []);
  const back = useCallback(() => { if (detail) setDetail(null); else setPages(old => old.length > 1 ? old.slice(0, -1) : old); }, [detail]);
  const onUser = (uid: string, title: string) => go({ kind: 'user', uid, title });
  const openFeed = (feed: Entity) => {
    if (!feed.id) { toast('这条内容没有动态编号'); return; }
    setDetail(feed);
    const item = { id: feed.id, uid: feed.uid, username: feed.username, userAvatar: feed.userAvatar, message: plain(feed.message).slice(0, 180), message_title: feed.message_title, dateline: feed.dateline, entityType: 'feed', viewedAt: Date.now() };
    setHistory(old => { const next = [item, ...old.filter(x => String(x.id) !== String(item.id))].slice(0, 150); localStorage.setItem('coolapk-history', JSON.stringify(next)); return next; });
  };
  function onLink(value: string) {
    const target = secureUrl(value); if (!target) return;
    const url = new URL(target);
    if (url.hostname === 'coolapk.com' || url.hostname.endsWith('.coolapk.com')) {
      const feedMatch = url.pathname.match(/^\/feed\/(\d+)/);
      const userMatch = url.pathname.match(/^\/u\/(\d+)/);
      const topicMatch = url.pathname.match(/^\/t\/(.+)/);
      const apkMatch = url.pathname.match(/^\/apk\/(.+)/);
      if (feedMatch) { openFeed({ id: feedMatch[1] }); return; }
      if (userMatch) { onUser(userMatch[1], '酷友主页'); return; }
      if (topicMatch) { const tag = decodeURIComponent(topicMatch[1]); go({ kind: 'topic', tag, title: tag }); return; }
      if (apkMatch) { go({ kind: 'app', id: apkMatch[1], title: '应用详情' }); return; }
      if (url.pathname === '/page' || /^\/main\//.test(url.pathname)) { go({ kind: 'page', title: '发现', url: url.pathname + url.search }); return; }
    }
    void unwrap(window.coolapk?.openExternal(target)).catch(e => toast(e.message));
  }
  function openEntity(entity: Entity) {
    if (entity.entityType === 'feed' || entity.entityType === 'feedReply') { openFeed(entity.entityType === 'feedReply' && entity.feedid ? { id: entity.feedid } : entity); return; }
    if (entity.entityType === 'user') { onUser(String(entity.uid || entity.id), entity.username || entity.title); return; }
    if (entity.entityType === 'topic') { const tag = entity.tag || entity.title; go({ kind: 'topic', tag, title: plain(tag) }); return; }
    if (entity.entityType === 'apk') { go({ kind: 'app', id: String(entity.packageName || entity.id), title: plain(entity.title || entity.appName) }); return; }
    if (entity.entityType === 'product') { go({ kind: 'product', id: String(entity.id), title: plain(entity.title || entity.name) }); return; }
    if (entity.entityType === 'collection') { go({ kind: 'collection', id: String(entity.id), title: plain(entity.title) }); return; }
    if (entity.ukey || entity.entityType === 'message' || entity.messageUid) {
      const uid = sessionPartnerUid(entity, account?.uid);
      if (!uid) { toast('未识别到对方的酷安账号，请刷新私信列表'); return; }
      go({ kind: 'chat', ukey: sessionKey(entity), uid, title: plain(entity.messageUsername || entity.username || entity.userInfo?.username || '私信') }); return;
    }
    if (entity.feedid) { openFeed({ id: entity.feedid }); return; }
    if (entity.url) { if (/^[A-Z][A-Z0-9_]+$/.test(entity.url) || entity.url.startsWith('#/')) go({ kind: 'page', title: plain(entity.title), url: entity.url }); else onLink(entity.url); return; }
    if (entity.page_name) { go({ kind: 'page', title: plain(entity.title), url: entity.page_name }); return; }
    toast('此内容暂未适配桌面端');
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme; localStorage.setItem('coolapk-theme', theme);
  }, [theme]);
  useEffect(() => {
    const surfaces = document.querySelectorAll<HTMLElement>('.workspace,.sidebar');
    surfaces.forEach(node => { node.inert = !!(detail || loginOpen || settingsOpen || compose || collectFeed || manageFeed || collectionEdit); });
    return () => surfaces.forEach(node => { node.inert = false; });
  }, [detail, loginOpen, settingsOpen, compose, collectFeed, manageFeed, collectionEdit]);
  useEffect(() => {
    unwrap(window.coolapk?.accounts()).then(setAccounts).catch(e => toast(e.message));
    const cleanup = window.coolapk?.onAccount(result => { if (result.ok) { setAccounts(result.data); clearCache(); setDetail(null); setCompose(null); setCollectFeed(null); setManageFeed(null); setCollectionEdit(null); setPages([homePage]); setRevision(r => r + 1); setLoginOpen(false); toast(result.data.current ? `已登录 ${result.data.current.username}` : '已切换为游客'); } else toast(result.error.message); });
    return cleanup;
  }, [toast]);
  useEffect(() => window.coolapk?.onCommand(command => { if (command === 'search') searchRef.current?.focus(); if (command === 'refresh') setRevision(r => r + 1); if (command === 'back') back(); }), [back]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); } }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, []);
  const feedProps = { onOpen: openFeed, onUser, onLink, onLogin: () => setLoginOpen(true), onForward: (feed: Entity) => { setDetail(null); setCompose(feed); }, onCollect: (feed: Entity) => { setDetail(null); setCollectFeed(feed); }, onManage: (feed: Entity) => { setDetail(null); setManageFeed(feed); }, accountUid: account?.uid, loggedIn: !!account, toast };
  const changed = () => { clearCache(); setRevision(r => r + 1); };
  const configurations: Entity[] = init.data?.data || [];
  const topicCard = configurations.find(x => String(x.title).startsWith('话题 -'));
  const hotWords: Entity[] = hot.data?.data || [];
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => go(homePage, true)} aria-label="酷安首页"><span className="brand-mark"><MessageCircle size={29} strokeWidth={2.6} /><span /></span><span>酷安<small>桌面端</small></span></button>
      <div className="sidebar-scroll"><nav aria-label="社区导航">{nav.map(item => <button key={item.title} className={`nav-item ${page.kind === item.kind && (item.kind !== 'page' || page.url === item.url) ? 'selected' : ''}`} onClick={() => go(item, true)}><item.icon size={21} /><span>{item.title}</span></button>)}</nav><div className="nav-label">我的社区</div><nav aria-label="个人导航">{personal.map(item => <button key={item.kind} className={`nav-item ${page.kind === item.kind ? 'selected' : ''}`} onClick={() => go(item, true)}><item.icon size={20} /><span>{item.title}</span>{(item.kind === 'notifications' ? notificationCount : item.kind === 'messages' ? messageCount : 0) > 0 && <span className="nav-badge">{Math.min(99, item.kind === 'notifications' ? notificationCount : messageCount)}</span>}</button>)}</nav>
      <button className="publish-button" onClick={() => account ? setCompose({}) : setLoginOpen(true)}><Plus size={20} />发布动态</button></div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings size={20} /><span>设置</span></button><button className="account-entry" onClick={() => account ? go({ kind: 'user', uid: account.uid, title: '我的主页' }) : setLoginOpen(true)}><Avatar src={account?.userAvatar} name={account?.username || '酷'} size={38} /><span><strong>{account?.username || '登录酷安'}</strong><small>{account ? '查看我的主页' : '与酷友一起发现更多'}</small></span><ChevronDown size={15} /></button><div className="unofficial">非官方客户端 · 本地开发版</div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button" onClick={back} aria-label="返回" disabled={pages.length === 1 && !detail}><ArrowLeft size={19} /></button><span>社区</span><span className="breadcrumb-divider">/</span><strong>{page.title}</strong></div><form className="search-box" onSubmit={e => { e.preventDefault(); if (search.trim()) go({ kind: 'search', title: search.trim() }); }}><Search size={18} /><input ref={searchRef} aria-label="搜索酷安" placeholder="搜索动态、酷友、应用…" value={search} onChange={e => setSearch(e.target.value)} /><kbd>Ctrl K</kbd></form><div className="topbar-actions"><button className="icon-button" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="icon-button" aria-label="刷新当前页" onClick={() => setRevision(r => r + 1)}><RefreshCw size={18} /></button><button className="icon-button" aria-label="通知" onClick={() => go({ kind: 'notifications', title: '通知' }, true)}><Bell size={20} /></button></div></header>
      <div className="body-layout"><main className="main-scroll" key={namespace + JSON.stringify(page)}><div className="page-heading"><div><h1>{page.kind === 'search' ? `搜索“${page.title}”` : page.title}</h1><p>{page.kind === 'home' ? '数码与生活，都有酷友的声音。' : page.kind === 'rank' ? '看看酷友们正在聊什么。' : page.kind === 'history' ? '回到那些你看过的精彩内容。' : page.kind === 'messages' ? '和酷友继续聊下去。' : '发现、分享，也听听不一样的想法。'}</p></div>{page.kind === 'home' && <span className="live-indicator"><span />正在发生</span>}</div>
        {page.kind === 'history' ? <><div className="history-toolbar"><span>{history.length} 条浏览记录</span><button className="text-button" onClick={() => { setHistory([]); localStorage.removeItem('coolapk-history'); }}>清空历史</button></div>{history.length ? history.map(item => <EntityCard key={item.id} entity={{ ...item, title: item.message_title || item.username + '的动态' }} onOpen={openFeed} onUser={onUser} onLink={onLink} />) : <Empty title="还没有浏览记录" message="打开一条动态，之后就能在这里找到它。" />}</> : <PageScreen page={page} configurations={configurations} namespace={namespace} account={account} revision={revision} refresh={() => setRevision(r => r + 1)} go={go} openEntity={openEntity} feedProps={feedProps} onLogin={() => setLoginOpen(true)} onCollectionEdit={setCollectionEdit} />}
      </main><aside className="right-rail"><div className="welcome-panel"><div className="welcome-icon"><Compass size={26} /></div><h2>{account ? `你好，${account.username}` : '欢迎来到酷安'}</h2><p>{account ? '看看关注的酷友有什么新发现。' : '发现好应用，聊聊新数码，分享生活里的小惊喜。'}</p><button className="button" onClick={() => account ? go({ kind: 'following', title: '我的关注' }, true) : setLoginOpen(true)}>{account ? '看看我的关注' : '登录，加入讨论'}{!account && <LogIn size={16} />}</button></div>
        {hotWords.length > 0 && <section className="rail-section"><h2><Flame size={18} />大家都在搜</h2><div className="hot-words">{hotWords.filter(x => x.title || x.searchValue || x.entityType === 'hotSearch').slice(0, 8).map((word, index) => { const title = plain(word.title || word.searchValue || word.name); return <button key={title + index} onClick={() => { setSearch(title); go({ kind: 'search', title }); }}><span className={index < 3 ? 'hot-number' : ''}>{index + 1}</span><strong>{title}</strong>{index === 0 && <span className="hot-tag">热</span>}</button>; })}</div></section>}
        {topicCard?.entities?.length > 0 && <section className="rail-section"><h2><Hash size={18} />发现话题</h2><div className="rail-topics">{(topicCard?.entities || []).slice(0, 6).map((topic: Entity, index: number) => <button key={index} onClick={() => topic.tag || topic.entityType === 'topic' ? go({ kind: 'topic', tag: topic.tag || topic.title, title: plain(topic.title) }) : openEntity(topic)}><span>#</span>{plain(topic.title)}</button>)}</div></section>}
        <div className="rail-footer"><p>Ctrl K 搜索 · Alt ← 返回</p><p>酷安名称及商标归其权利人所有</p><button onClick={() => onLink('https://www.coolapk.com')} className="text-button">酷安官方网站</button></div>
      </aside></div>
    </div>
    {detail && <Detail feed={detail} namespace={namespace} feedProps={feedProps} onClose={() => setDetail(null)} />}
    {loginOpen && <LoginModal accounts={accounts} onClose={() => setLoginOpen(false)} toast={toast} />}
    {settingsOpen && <Modal title="设置" onClose={() => setSettingsOpen(false)}><div className="settings-body"><div className="setting-row"><div><strong>外观</strong><p>选择适合你的阅读主题</p></div><select value={theme} onChange={e => setTheme(e.target.value)} aria-label="外观主题"><option value="light">浅色</option><option value="dark">深色</option></select></div><div className="setting-row"><div><strong>账号管理</strong><p>{accounts.accounts.length ? `已保存 ${accounts.accounts.length} 个账号` : '登录后可以切换多个账号'}</p></div><button className="button secondary" onClick={() => { setSettingsOpen(false); setLoginOpen(true); }}>管理</button></div><div className="about-box"><h3>酷安桌面端 <small>0.2.0</small></h3><p>由酷安 16.6.4 APK 协议分析构建的非官方桌面客户端。公开浏览可直接使用；互动操作需要登录，受官方接口和账号权限限制。</p><p>账号凭据使用 Windows 系统加密，仅保存在本机。浏览历史最多保留 150 条，可在历史页清空。</p></div></div></Modal>}
    {compose && <ComposeModal forward={compose.id ? compose : undefined} onClose={() => setCompose(null)} onDone={() => { setCompose(null); setRevision(r => r + 1); }} toast={toast} />}
    {collectFeed && <CollectionPicker key={namespace + ':' + collectFeed.id} feed={collectFeed} namespace={namespace} onClose={() => setCollectFeed(null)} onDone={() => { setCollectFeed(null); changed(); }} toast={toast} />}
    {collectionEdit && <CollectionEditor key={namespace + ':' + (collectionEdit.id || 'new')} collection={collectionEdit.id ? collectionEdit : undefined} onClose={() => setCollectionEdit(null)} onDone={() => { if (collectionEdit.id) go({ kind: 'collections', title: '我的收藏' }, true); setCollectionEdit(null); changed(); }} toast={toast} />}
    {manageFeed && <FeedManager key={namespace + ':' + manageFeed.id} feed={manageFeed} namespace={namespace} removeItemId={collectionItemId(manageFeed) || undefined} onClose={() => setManageFeed(null)} onDone={() => { setManageFeed(null); setDetail(null); changed(); }} toast={toast} />}
    {toastMessage && <div className="toast" role="status"><Check size={18} /><span>{toastMessage}</span><button onClick={() => setToastMessage('')} aria-label="关闭提示"><X size={16} /></button></div>}
  </div>;
}

type ScreenProps = { page: Page; configurations: Entity[]; namespace: string; account: AccountState['current']; revision: number; refresh: () => void; go: (page: Page) => void; openEntity: (entity: Entity) => void; feedProps: any; onLogin: () => void; onCollectionEdit: (collection: Entity) => void };
function PageScreen({ page, configurations, namespace, account, revision, refresh, go, openEntity, feedProps, onLogin, onCollectionEdit }: ScreenProps) {
  const [tab, setTab] = useState('');
  const [subtype, setSubtype] = useState('');
  const [actionError, setActionError] = useState<ClientError>();
  const [actionBusy, setActionBusy] = useState(false);
  const [chatKey, setChatKey] = useState(page.ukey || '');
  const [chatLookupRevision, setChatLookupRevision] = useState(0);
  const [sentRows, setSentRows] = useState<Entity[]>([]);
  const [chatSent, setChatSent] = useState(false);
  const pendingAction = useRef<{ operation: string; args: Entity } | null>(null);
  const locked = ['following', 'collections', 'notifications', 'messages', 'chat'].includes(page.kind) && !account;
  const tabs: Entity[] = page.kind === 'home' ? [{ title: '推荐', url: '' }, ...(configurations.find(x => x.title === '首页')?.entities || []).filter((x: Entity) => x.title !== '关注' && x.title !== '话题' && x.title !== '头条')] : page.kind === 'digital' ? configurations.find(x => x.title === '数码')?.entities || [] : [];
  const selectedConfig = tabs.find(x => x.title === tab) || (page.kind === 'digital' ? tabs.find(x => x.title === '数码') : tabs[0]) || tabs[0];
  let operation: string | null = 'home', args: Entity = {};
  switch (page.kind) {
    case 'home': if (selectedConfig?.url) { operation = 'page'; args = { url: selectedConfig.url }; } break;
    case 'page': operation = 'page'; args = { url: page.url }; break;
    case 'rank': operation = 'rank'; args = { type: subtype || 'week' }; break;
    case 'digital': operation = selectedConfig ? 'page' : null; args = { url: selectedConfig?.url || selectedConfig?.page_name }; break;
    case 'apps': operation = 'search'; args = { query: subtype === 'game' ? '手游' : '常用应用', type: subtype || 'apk' }; break;
    case 'search': operation = 'search'; args = { query: page.title, type: subtype || 'all' }; break;
    case 'user': operation = 'userFeeds'; args = { uid: page.uid, type: subtype || 'feed' }; if (subtype === 'follow' || subtype === 'fans') { operation = 'userFollows'; args = { uid: page.uid, type: subtype }; } break;
    case 'topic': operation = 'topicFeeds'; args = { tag: page.tag, sort: subtype || 'lastupdate_desc' }; break;
    case 'product': operation = 'productFeeds'; args = { id: page.id }; break;
    case 'app': operation = 'appFeeds'; args = { id: page.id }; break;
    case 'following': operation = subtype === 'users' ? 'userFollows' : 'followingFeeds'; args = { uid: account?.uid }; break;
    case 'collections': operation = 'collections'; break;
    case 'collection': operation = 'collectionFeeds'; args = { id: page.id }; break;
    case 'notifications': operation = 'notifications'; args = { type: subtype || 'list' }; break;
    case 'messages': operation = 'messages'; break;
    case 'chat': operation = chatKey ? 'chat' : null; args = { ukey: chatKey }; break;
  }
  if (locked) operation = null;
  const resource = useResource(operation, args, namespace, revision);
  const chatLookup = useResource(page.kind === 'chat' && account && !chatKey ? 'messages' : null, {}, namespace, revision + chatLookupRevision);
  useEffect(() => {
    if (page.kind !== 'chat' || chatKey || !Array.isArray(chatLookup.data?.data)) return;
    const key = matchingSessionKey(chatLookup.data.data, String(page.uid || ''), account?.uid);
    if (key) setChatKey(key);
  }, [chatLookup.data, chatKey, page.kind, page.uid, account?.uid]);
  const profile = useResource(page.kind === 'user' ? 'user' : page.kind === 'topic' ? 'topic' : page.kind === 'app' ? 'app' : page.kind === 'product' ? 'product' : page.kind === 'collection' ? 'collection' : null, page.kind === 'user' ? { uid: page.uid } : page.kind === 'topic' ? { tag: page.tag } : { id: page.id }, namespace, revision);
  const serverItems: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data : [];
  const serverIds = new Set(serverItems.map(item => String(item.id || item.entityId || '')));
  const items = page.kind === 'chat' ? [...serverItems, ...sentRows.filter(item => !serverIds.has(String(item.id || item.entityId || '')))] : serverItems;
  const feedItems = page.kind === 'home' ? items.filter((item: Entity) => item.entityType === 'feed') : items;
  const discovery = page.kind === 'home' ? items.filter((item: Entity) => item.entityType !== 'feed' && item.url).slice(0, 4) : [];
  const profileData = profile.data?.data;
  const displayTabs = page.kind === 'rank' ? [{ id: 'week', title: '周榜' }, { id: 'day', title: '日榜' }, { id: 'month', title: '月榜' }, { id: 'picture', title: '酷图' }] : page.kind === 'search' ? searchTypes : page.kind === 'apps' ? [{ id: 'apk', title: '应用' }, { id: 'game', title: '游戏' }] : page.kind === 'user' ? [{ id: 'feed', title: '动态' }, { id: 'favorite', title: '收藏' }, { id: 'like', title: '赞过' }, { id: 'follow', title: '关注' }, { id: 'fans', title: '粉丝' }] : page.kind === 'topic' ? [{ id: 'lastupdate_desc', title: '最新' }, { id: 'hot', title: '热门' }] : page.kind === 'following' ? [{ id: 'feeds', title: '关注动态' }, { id: 'users', title: '关注的酷友' }] : page.kind === 'notifications' ? [{ id: 'list', title: '评论与回复' }, { id: 'atMeList', title: '@我的' }, { id: 'atCommentMeList', title: '评论@我' }, { id: 'feedLikeList', title: '收到的赞' }, { id: 'contactsFollowList', title: '新关注' }] : [];
  async function perform(operation: string, args: Entity) {
    if (actionBusy) return;
    pendingAction.current = { operation, args }; setActionBusy(true); setActionError(undefined);
    try { await call(operation, args); refresh(); }
    catch (e) { setActionError(e as ClientError); } finally { setActionBusy(false); }
  }
  const retryAction = () => { const pending = pendingAction.current; if (pending) void perform(pending.operation, pending.args); };
  async function follow() { if (!account) return onLogin(); await perform('action', { type: profileData?.isFollow ? 'unfollow' : 'follow', uid: page.uid }); }
  function startChat() {
    if (!account) return onLogin();
    if (!page.uid || page.uid === account.uid) return;
    go({ kind: 'chat', uid: page.uid, title: plain(profileData?.username || page.title) });
  }
  function chatMessageSent(result: Result) {
    const rows: Entity[] = (Array.isArray(result.data) ? result.data : result.data && typeof result.data === 'object' ? [result.data] : []).filter((item: Entity) => item.id || item.entityId);
    setSentRows(old => {
      const known = new Set(old.map(item => String(item.id || item.entityId)));
      return [...old, ...rows.filter(item => !known.has(String(item.id || item.entityId)))];
    });
    const returnedKey = sessionKey({ ukey: result.ukey || (!Array.isArray(result.data) && result.data?.ukey) || rows.find(item => item.ukey)?.ukey });
    if (returnedKey) setChatKey(returnedKey);
    setChatSent(true); setChatLookupRevision(value => value + 1); refresh(); feedProps.toast('私信已发送');
  }
  async function collectionFollow() { if (!account) return onLogin(); await perform('action', { type: Number(profileData?.isFollow || profileData?.userAction?.follow) === 1 ? 'unfollowCollection' : 'followCollection', id: page.id }); }
  async function clearUnread() { await perform('clearNotificationCount', { type: page.kind === 'messages' ? 'message' : 'feed' }); }
  const defaultCollection = String(page.id) === '0' || Number(profileData?.defaultCollected ?? profileData?.isDefault) === 1;
  const ownCollection = page.kind === 'collection' && !defaultCollection && !!account && String(profileData?.uid || profileData?.userInfo?.uid) === account.uid;
  const collectionProps = { ...feedProps, collectionEditable: ownCollection };
  return <>
    {account && page.kind === 'collections' && <div className="collection-toolbar"><span className="muted">整理喜欢的动态与发现</span><button className="button" onClick={() => onCollectionEdit({})}><Plus size={16} />新建收藏单</button></div>}
    {account && ['notifications', 'messages'].includes(page.kind) && <div className="collection-toolbar"><span className="muted">{page.kind === 'messages' ? '私信会话' : '社区消息'}</span><button className="text-button" disabled={actionBusy || !!actionError?.verificationId} onClick={() => void clearUnread()}>标记当前类别已读</button></div>}
    {actionError && <ErrorNotice error={actionError} onRetry={retryAction} onLogin={onLogin} />}
    {tabs.length > 0 && <div className="tabs" role="tablist">{tabs.map((item, i) => <button key={item.title + i} role="tab" aria-selected={selectedConfig === item} className={selectedConfig === item ? 'selected' : ''} onClick={() => setTab(item.title)}>{item.title}</button>)}</div>}
    {displayTabs.length > 0 && <div className="tabs" role="tablist">{displayTabs.map((item, i) => <button key={item.id} role="tab" aria-selected={subtype ? subtype === item.id : i === 0} className={(subtype ? subtype === item.id : i === 0) ? 'selected' : ''} onClick={() => setSubtype(item.id)}>{item.title}</button>)}</div>}
    {profile.error && <ErrorNotice error={profile.error} onRetry={refresh} onLogin={onLogin} />}
    {profileData && <section className="profile-card"><Avatar src={profileData.userAvatar || profileData.logo} name={profileData.username || profileData.title || page.title} size={72} /><div><h2>{plain(profileData.username || profileData.title || profileData.appName || page.title)}</h2><p>{plain(profileData.introduce || profileData.description || profileData.intro || '')}</p><div className="profile-stats">{profileData.fans != null && <span><b>{count(profileData.fans)}</b> 粉丝</span>}{profileData.follow != null && <span><b>{count(profileData.follow)}</b> 关注</span>}{profileData.feed != null && <span><b>{count(profileData.feed)}</b> 动态</span>}{profileData.rating && <span><b>{profileData.rating}</b> 应用评分</span>}</div></div>{page.kind === 'user' && account?.uid !== page.uid && <div className="profile-actions"><button className="button secondary" disabled={actionBusy || !!actionError?.verificationId} onClick={follow}>{profileData.isFollow ? '已关注' : '关注'}</button><button className="button secondary" onClick={startChat}><MessageCircle size={15} />发私信</button></div>}{page.kind === 'collection' && !defaultCollection && <div className="collection-actions">{ownCollection ? <button className="button secondary" onClick={() => onCollectionEdit(profileData)}>编辑收藏单</button> : <button className="button secondary" disabled={actionBusy || !!actionError?.verificationId} onClick={() => void collectionFollow()}>{Number(profileData.isFollow || profileData.userAction?.follow) === 1 ? '已订阅' : '订阅收藏单'}</button>}</div>}{page.kind === 'app' && <button className="button secondary" onClick={() => void window.coolapk?.openExternal(`https://www.coolapk.com/apk/${page.id}`)}>官方下载</button>}</section>}
    {locked ? <Empty title="登录后，社区更完整" message="查看关注、收藏、通知和私信，也能参与讨论。"><button className="button" onClick={onLogin}>登录酷安</button></Empty> : <>
      {resource.error && <ErrorNotice error={resource.error} onRetry={refresh} onLogin={onLogin} />}
      {resource.loading && !resource.data && <Skeleton />}
      {page.kind === 'chat' && !chatKey && chatLookup.error && <ErrorNotice error={chatLookup.error} onRetry={() => setChatLookupRevision(value => value + 1)} onLogin={onLogin} />}
      {page.kind === 'chat' && !chatKey && chatLookup.loading && <p className="muted" role="status">正在查找已有会话…</p>}
      {!resource.loading && !resource.error && !items.length && (page.kind === 'chat' && !chatKey ? <Empty title={chatSent ? '私信已发送' : '开始交流'} message={chatSent ? '会话记录暂未同步，刷新后继续查看。' : `向 ${page.title} 发送第一条消息，开启新的交流。`} /> : <Empty />)}
      {page.kind === 'chat' && chatSent && !chatKey && <div className="chat-sync-notice"><span>消息已发出，正在等待酷安同步会话记录。</span><button className="text-button" disabled={chatLookup.loading} onClick={() => setChatLookupRevision(value => value + 1)}>刷新会话</button></div>}
      {discovery.length > 0 && <div className="discovery-strip">{discovery.map((entity: Entity, index: number) => <button key={index} onClick={() => openEntity(entity)}><Hash size={15} />{plain(entity.title)}</button>)}</div>}
      <div className={page.kind === 'chat' ? 'chat-list' : 'feed-list'}>{feedItems.map((entity: Entity, index: number) => entity.entityType === 'feed' ? <FeedCard key={entity.entityType + ':' + (entity.id || index)} feed={entity} {...collectionProps} /> : page.kind === 'chat' ? <ChatMessage key={entity.id || index} item={entity} accountUid={account?.uid} namespace={namespace} onLink={feedProps.onLink} onLogin={onLogin} /> : <EntityCard key={entity.entityType + ':' + (entity.id || entity.entityId || index)} entity={entity} onOpen={openEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />)}</div>
      {items.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} onClick={resource.more} />}
      {page.kind === 'chat' && <ChatComposer uid={String(page.uid || '')} namespace={namespace} loggedIn={!!account} onLogin={onLogin} onSent={chatMessageSent} />}
    </>}
  </>;
}

function LoginModal({ accounts, onClose, toast }: { accounts: AccountState; onClose: () => void; toast: (s: string) => void }) {
  const [cookie, setCookie] = useState('');
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  async function official() { setError(''); try { await unwrap(window.coolapk?.login()); } catch (e) { setError((e as Error).message); } }
  async function submit() { setImporting(true); setError(''); try { await unwrap(window.coolapk?.importCookie(cookie)); setCookie(''); onClose(); } catch (e) { setError((e as Error).message); } finally { setImporting(false); } }
  return <Modal title="登录酷安" onClose={onClose}><div className="login-body"><div className="login-illustration"><Users size={42} strokeWidth={1.4} /></div><h3>和酷友一起，发现更多</h3><p>打开酷安官方登录页面，使用扫码或手机验证码登录。</p><button className="button full" onClick={official}><LogIn size={18} />打开官方登录</button>{accounts.warning && <p className="form-error">{accounts.warning}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      {accounts.accounts.length > 0 && <div className="saved-accounts"><h4>已保存的账号</h4>{accounts.accounts.map(a => <div className="saved-account" key={a.uid}><Avatar src={a.userAvatar} name={a.username} size={36} /><strong>{a.username}</strong><button className="text-button" onClick={() => unwrap(window.coolapk?.selectAccount(a.uid)).then(onClose).catch(e => toast(e.message))}>{accounts.current?.uid === a.uid ? '当前账号' : '切换'}</button><button className="icon-button" aria-label={`移除账号 ${a.username}`} onClick={() => unwrap(window.coolapk?.removeAccount(a.uid)).catch(e => toast(e.message))}><X size={16} /></button></div>)}{accounts.current && <button className="text-button" onClick={() => unwrap(window.coolapk?.selectAccount('')).then(onClose).catch(e => toast(e.message))}><LogOut size={16} />切换为游客</button>}</div>}
      <button className="text-button import-toggle" onClick={() => setShowImport(v => !v)}>{showImport ? '收起凭据导入' : '使用已有 Cookie 登录'}<ChevronDown size={14} /></button>{showImport && <form className="cookie-form" onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="cookie">你自己的酷安 Cookie</label><textarea id="cookie" value={cookie} onChange={e => setCookie(e.target.value)} rows={4} autoComplete="off" spellCheck={false} placeholder="SESSID=…; uid=…; token=…" maxLength={16000} /><button className="button secondary full" disabled={importing || !cookie.trim()}>{importing ? '正在验证…' : '验证并登录'}</button></form>}<p className="privacy-note">登录凭据经 Windows 系统加密，仅保存在本机。</p></div></Modal>;
}

function ComposeModal({ forward, onClose, onDone, toast }: { forward?: Entity; onClose: () => void; onDone: () => void; toast: (message: string) => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ClientError | undefined>();
  const [pictures, setPictures] = useState<Attachment[]>([]);
  const [progress, setProgress] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; return () => { generation.current++; }; }, []);
  async function submit() {
    if (busy) return;
    const attempt = generation.current, current = () => generation.current === attempt;
    setBusy(true); setError(undefined);
    try {
      const pic = await uploadAttachments(pictures, text => { if (current()) setProgress(text); }, { shouldContinue: current });
      if (!current()) return;
      setProgress('正在发布…');
      await call('action', { type: forward ? 'forward' : 'publish', id: forward ? String(forward.id) : undefined, message, pic });
      if (current()) { toast(forward ? '已转发' : '动态已发布'); onDone(); }
    } catch (e) { if (current()) setError(e as ClientError); }
    finally { if (current()) { setBusy(false); setProgress(''); } }
  }
  return <Modal title={forward ? '转发动态' : '发布动态'} onClose={onClose}><form className="compose-body" onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="publish-message">{forward ? '说说你的想法' : '今天有什么想和酷友分享？'}</label><textarea id="publish-message" rows={8} value={message} maxLength={10000} disabled={busy || !!error?.verificationId} onChange={e => setMessage(e.target.value)} placeholder="写下你的发现…" /><Attachments values={pictures} onChange={setPictures} disabled={busy || !!error?.verificationId} onError={toast} />{forward && <div className="forward-preview"><strong>@{forward.username}</strong><p>{plain(forward.message).slice(0, 180)}</p></div>}{error && <ErrorNotice error={error} onRetry={submit} />}<div className="compose-footer"><span>{progress || `${message.length} / 10000`}</span><button className="button" disabled={busy || !!error?.verificationId || (!message.trim() && !pictures.length)}>{busy ? '正在提交…' : forward ? '转发' : '发布'}</button></div></form></Modal>;
}
