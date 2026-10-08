import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Bell, Bookmark, Check, ChevronDown, Compass, Flame, Gamepad2, Hash, History, Home, Laptop, LogIn, LogOut, MessageCircle, Moon, Plus, RefreshCw, Search, Settings, ShoppingBag, Smartphone, Sun, Users, X } from 'lucide-react';
import desktopBrand from './assets/desktop-brand.png';
import { Avatar, Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Modal, RichText, Skeleton } from './components';
import { call, clearCache, refreshResources, count, plain, secureUrl, unwrap, useResource, type ClientError } from './data';
import Detail from './Detail';
import { ChatComposer, ChatMessage, ChatTools, RecentContacts } from './Chat';
import { CommunityPage, isFeedEntity } from './Community';
import CatalogScreen from './Catalog';
import { AppDiscovery } from './AppDiscovery';
import { UserDiscovery, type UserDiscoveryType } from './UserDiscovery';
import { AccountCenter, type AccountSection } from './AccountCenter';
import { preferenceThemeVariables } from '../core/preferences.mjs';
import PersonalScreen from './Personal';
import { personalHeadlineVisible } from '../core/personal-models.mjs';
import Phone from './Phone';
import { DownloadsPage, downloadCall } from './Downloads';
import GoodsScreen from './Goods';
import SecondhandScreen from './Secondhand';
import { parseSecondhandRoute, secondhandDescriptor, secondhandEntityTarget } from '../core/secondhand-routes.mjs';
import ComposeModal from './Composer';
import { CreationDialog } from './Creation';
import { matchingSessionKey, sessionKey, sessionPartnerUid } from './chat-session';
import { Notifications } from './Notifications';
import { notificationCounts } from '../core/notifications.mjs';
import { CollectionEditor, CollectionPicker, FeedManager, collectionItemId } from './Collections';
import type { AccountState, BackgroundState, Entity, Page, ReportTarget, Result } from './types';
import { coolapkRoute } from '../core/navigation.mjs';
import { CollectionExport } from './Sharing';
import { ChannelManager, homeChannels, savedHomeChannels } from './HomeChannels';
import { HomeContent } from './HomeContent';
import { PicturePosters } from './PicturePosters';
import { TopicDiscovery } from './TopicDiscovery';
import { homeHeaderItems, mergeSurfaceItems } from '../core/home-surface.mjs';
import './desktop-motion.css';
import { SearchSuggestions, type SearchSuggestionSelection } from './SearchSuggestions';
import { HotTopics } from './HotTopics';
import { Settings as SettingsPanel } from './Settings';
import { AccountSettings } from './AccountSettings';
import type { AccountSettingsData } from '../core/account-settings.mjs';
import { clearLocalHistory, readLocalHistory, saveLocalHistory } from '../core/local-history.mjs';
import { DesktopEffects } from './DesktopEffects';
import { LiquidGlassNavigation } from './LiquidGlass';
import { TeenagerScreen, TeenagerSetup } from './Teenager';
import type { TeenagerSnapshot } from '../core/teenager.mjs';
import { SoftwareUpdate } from './SoftwareUpdate';
import { SecondhandDialog } from './SecondhandEditor';
import { useSoftwareUpdates } from './software-update-state';
import { usePreferences } from './preferences';
import packageInfo from '../package.json';

const initialAccount: AccountState = { accounts: [], current: null };
const homePage: Page = { kind: 'home', title: '首页' };
const nav = [
  { kind: 'home', title: '首页', icon: Home }, { kind: 'rank', title: '热榜', icon: Flame },
  { kind: 'page', title: '话题广场', url: 'V11_VERTICAL_TOPIC', icon: Hash },
  { kind: 'digital', title: '数码', icon: Smartphone },
  { kind: 'apps', title: '应用与游戏', icon: Gamepad2 },
  { kind: 'secondhand', type: 'home', title: '二手', icon: ShoppingBag },
  { kind: 'catalog', type: 'hub', title: '发现更多', icon: Compass },
  { kind: 'goods', type: 'hub', title: '好物与清单', icon: ShoppingBag },
  { kind: 'downloads', title: '应用下载', icon: Smartphone },
  { kind: 'phone', title: '手机协同', icon: Laptop },
];
const personal = [{ kind: 'account', type: 'mine', title: '我的', icon: Home }, { kind: 'following', title: '我的关注', icon: Users }, { kind: 'collections', title: '我的收藏', icon: Bookmark }, { kind: 'notifications', title: '通知', icon: Bell }, { kind: 'messages', title: '私信', icon: MessageCircle }, { kind: 'history', title: '浏览历史', icon: History }, { kind: 'followedTopics', title: '订阅话题', icon: Hash }, { kind: 'account', type: 'profile', title: '账号中心', icon: Settings }];
const searchTypes = [{ id: 'all', title: '综合' }, { id: 'feed', title: '动态' }, { id: 'user', title: '酷友' }, { id: 'topic', title: '话题' }, { id: 'apk', title: '应用' }, { id: 'game', title: '游戏' }, { id: 'product', title: '数码' }, { id: 'ask', title: '问答' }, { id: 'question', title: '提问' }, { id: 'answer', title: '回答' }, { id: 'dyh', title: '酷安号' }, { id: 'album', title: '应用集' }, { id: 'ershou', title: '二手' }, { id: 'goods', title: '好物' }, { id: 'goods_list', title: '好物榜' }];

export default function App() {
  const [snapshot, setSnapshot] = useState<TeenagerSnapshot>(), [error, setError] = useState(''), [setupOpen, setSetupOpen] = useState(false);
  const sequence = useRef(0), mounted = useRef(false);
  const acceptSnapshot = useCallback((value: TeenagerSnapshot) => { if (!mounted.current) return; sequence.current++; setSnapshot(value); setError(''); if (value.enabled) { clearCache(); setSetupOpen(false); } }, []);
  const load = useCallback(async () => {
    const attempt = ++sequence.current;
    try { const value = await unwrap(window.coolapk?.teenager('info')) as TeenagerSnapshot; if (mounted.current && attempt === sequence.current) { setSnapshot(value); setError(''); } }
    catch (failure) { if (mounted.current && attempt === sequence.current) setError((failure as Error).message || '无法读取青少年模式设置'); }
  }, []);
  useEffect(() => { mounted.current = true; const cleanup = window.coolapk?.onTeenager(acceptSnapshot); void load(); return () => { mounted.current = false; sequence.current++; cleanup?.(); }; }, [acceptSnapshot, load]);
  if (!snapshot) return <div className="teenager-gate">{error ? <Empty title="无法读取模式设置" message={error}><button className="button" onClick={() => void load()}>重新加载</button></Empty> : <><p role="status">正在读取模式设置…</p><Skeleton /></>}</div>;
  if (snapshot.enabled) return <TeenagerScreen snapshot={snapshot} onSnapshot={acceptSnapshot} />;
  return <><NormalApp onTeenagerSetup={() => setSetupOpen(true)} />{setupOpen && <Modal title="青少年模式" onClose={() => setSetupOpen(false)}><TeenagerSetup onEnabled={acceptSnapshot} onCancel={() => setSetupOpen(false)} /></Modal>}</>;
}

function NormalApp({ onTeenagerSetup }: { onTeenagerSetup: () => void }) {
  const [accounts, setAccounts] = useState<AccountState>(initialAccount);
  const [pages, setPages] = useState<Page[]>([homePage]);
  const [search, setSearch] = useState('');
  // Empty application/game entry points set the input scope. Suggestions and
  // links carrying a keyword select a result category for that search only.
  const [searchType, setSearchType] = useState('all');
  const [searchActive, setSearchActive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<Entity | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelManager, setChannelManager] = useState(false);
  const [refreshMotion, setRefreshMotion] = useState(0);
  const [accountSettingsPage, setAccountSettingsPage] = useState<'privacy' | 'notifications' | null>(null);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const closeUpdates = useCallback(() => setUpdatesOpen(false), []);
  const updates = useSoftwareUpdates();
  const announcedUpdate = useRef('');
  const [compose, setCompose] = useState<Entity | null>(null);
  const [creation, setCreation] = useState<'question' | 'poll' | null>(null);
  const [secondhandEditor, setSecondhandEditor] = useState<{ id?: string } | null>(null);
  const [collectFeed, setCollectFeed] = useState<Entity | null>(null);
  const [manageFeed, setManageFeed] = useState<Entity | null>(null);
  const [collectionEdit, setCollectionEdit] = useState<Entity | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [historyState, setHistoryState] = useState<{ owner: string; items: Entity[] }>({ owner: 'guest', items: [] });
  const [accountConfiguration, setAccountConfiguration] = useState<{ owner: string; data: AccountSettingsData }>();
  const { preferences, updatePreferences, preferenceError, resolvedTheme: theme } = usePreferences();
  const [background, setBackground] = useState<BackgroundState>();
  const toggleTheme = () => updatePreferences({ theme: theme === 'light' ? 'dark' : 'light', followSystem: false, autoNight: false });
  const searchRef = useRef<HTMLInputElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const refreshCurrentPage = useCallback(() => {
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(node => node.getClientRects().length);
    const dialog = dialogs.at(-1);
    const scroll = dialog ? dialog.querySelector<HTMLElement>('.detail-scroll') || dialog : mainScrollRef.current;
    if (scroll) scroll.scrollTop = 0;
    setRefreshMotion(value => value + 1); refreshResources(); setRevision(value => value + 1);
    requestAnimationFrame(() => { if (scroll?.isConnected) scroll.scrollTop = 0; });
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationSequence = useRef(0);
  const accountEntrySequence = useRef(0);
  const accountGeneration = useRef(0);
  const page = pages.at(-1)!;
  const account = accounts.current;
  const namespace = account?.uid || 'guest';
  const history = historyState.owner === namespace ? historyState.items : [];
  const privacy = accountConfiguration?.owner === namespace ? accountConfiguration.data : undefined;
  const accountSettingsResource = useResource(account ? 'accountSettings' : null, {}, namespace, revision);
  const recordHistory = !account || privacy?.values.record_hit_history === true;
  const publicationRestricted = privacy?.values.net_abuse_guard === true;
  const init = useResource('init', {}, namespace);
  const hot = useResource('hotSearch', {}, namespace);
  const unread = useResource(account ? 'notificationCount' : null, {}, namespace, revision);
  const unreadSnapshot = notificationCounts(unread.data, [], { ignoreLikes: privacy?.values.notification_ignore_like_count === true });
  const messageCount = unreadSnapshot.message || 0;
  const notificationCount = unreadSnapshot.community || 0;
  const toast = useCallback((message: string) => { setToastMessage(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastMessage(''), 5000); }, []);
  useEffect(() => {
    if (!window.coolapk?.background) return;
    let active = true;
    void unwrap(window.coolapk.background('state')).then(value => { if (active) setBackground(value); }).catch(error => { if (active) toast(error.message); });
    return () => { active = false; };
  }, [toast]);
  useEffect(() => { setHistoryState({ owner: namespace, items: readLocalHistory(localStorage, namespace) }); }, [namespace]);
  useEffect(() => { const data = accountSettingsResource.data?.data; if (data?.values && Array.isArray(data.present)) setAccountConfiguration({ owner: namespace, data }); }, [namespace, accountSettingsResource.data]);
  useEffect(() => {
    if (privacy?.values.record_hit_history === false) {
      setHistoryState({ owner: namespace, items: [] });
      try { clearLocalHistory(localStorage, namespace); } catch { toast('本机浏览历史清理失败，请在设置中重试'); }
    }
  }, [namespace, privacy, publicationRestricted, toast]);
  const clearHistory = () => { clearLocalHistory(localStorage, namespace); setHistoryState({ owner: namespace, items: [] }); };
  useEffect(() => {
    if (updates.state.status === 'available' && updates.state.availableVersion && announcedUpdate.current !== updates.state.availableVersion) {
      announcedUpdate.current = updates.state.availableVersion;
      toast(`发现桌面端 ${updates.state.availableVersion}，可在设置 → 关于酷安 → 检查软件更新中下载。`);
    }
  }, [updates.state.status, updates.state.availableVersion, toast]);
  const go = useCallback((next: Page, root = false) => {
    navigationSequence.current++;
    // Explicit account navigation reopens its requested section. Opening a feed
    // or refreshing metadata leaves the background account draft mounted.
    const destination = next.kind === 'account' ? { ...next, accountEntry: ++accountEntrySequence.current } : next;
    setPages(old => root ? [destination] : [...old, destination]); setDetail(null);
  }, []);
  const back = useCallback(() => { navigationSequence.current++; if (detail) setDetail(null); else setPages(old => old.length > 1 ? old.slice(0, -1) : old); }, [detail]);
  const onUser = (uid: string, title: string) => go({ kind: 'user', uid, title });
  const openFeed = (feed: Entity) => {
    if (!feed.id) { toast('这条内容没有动态编号'); return; }
    navigationSequence.current++;
    setDetail(feed);
    if (!recordHistory) return;
    const item = { id: feed.id, uid: feed.uid, username: feed.username, userAvatar: feed.userAvatar, message: plain(feed.message).slice(0, 180), message_title: feed.message_title, dateline: feed.dateline, entityType: 'feed', viewedAt: Date.now() };
    const next = [item, ...history.filter(x => String(x.id) !== String(item.id))].slice(0, 150);
    try { saveLocalHistory(localStorage, namespace, next); setHistoryState({ owner: namespace, items: next }); }
    catch { toast('本机浏览记录保存失败'); }
  };
  function onLink(value: string) {
    const secondhand = parseSecondhandRoute(value);
    if (secondhand) { go({ kind: 'secondhand', type: secondhand.type, ...(secondhand.type === 'list' ? { url: secondhandDescriptor(secondhand.filters) } : {}), title: '二手市场' }); return; }
    const route = coolapkRoute(value);
    if (route?.kind === 'search' && route.inputOnly) { setSearch(''); setSearchType(route.type || 'all'); setSearchActive(true); searchRef.current?.focus(); return; }
    if (route?.kind === 'search') { setSearch(route.title || ''); setSearchActive(false); }
    if (route) { if (route.kind === 'feed') openFeed({ id: route.id, __replyId: route.replyId }); else go({ ...route, title: route.title || '详情' }); return; }
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
      const catalogMatch = url.pathname.match(/^\/(product|dyh|album|event|live)\/(\d+)/);
      if (catalogMatch) { go({ kind: catalogMatch[1] === 'live' ? 'live' : 'catalog', type: catalogMatch[1], id: catalogMatch[2], title: '详情' }); return; }
      if (url.pathname === '/page' || /^\/main\//.test(url.pathname)) { go({ kind: 'page', title: '发现', url: url.pathname + url.search }); return; }
    }
    void unwrap(window.coolapk?.openExternal(target)).catch(e => toast(e.message));
  }
  function openEntity(entity: Entity) {
    if (entity.entityType === 'phoneUpdates') { go({ kind: 'phone', type: 'updates', title: '手机应用更新' }); return; }
    if (typeof entity.url === 'string') {
      const source = secureUrl(entity.url), writer = source ? new URL(source) : null;
      if (writer?.origin === 'https://www.coolapk.com' && writer.pathname === '/feed/writer') { if (!account) { setLoginOpen(true); return; } if (publicationRestricted) { toast('一键防护开启期间暂停发布动态'); return; } const mode = writer.searchParams.get('type'); setCompose({ __initialMode: mode === 'article' || mode === 'video' ? mode : 'feed', __initialMessage: writer.searchParams.get('tag') ? `#${writer.searchParams.get('tag')}# ` : '' }); return; }
    }
    if (entity.entityType === 'feedReply') { void openReply(entity); return; }
    const secondhand = secondhandEntityTarget(entity);
    if (secondhand) { go({ kind: 'secondhand', type: secondhand.type, ...(secondhand.type === 'list' ? { url: secondhandDescriptor(secondhand.filters) } : {}), title: plain(entity.title || '二手市场') }); return; }
    if (entity.goodsListInfo || ['goodsList', 'goods_list'].includes(entity.entityType)) { go({ kind: 'goods', type: 'list', id: String(entity.feedid || entity.feed_id || entity.id), title: plain(entity.goodsListInfo?.title || entity.title || '好物清单') }); return; }
    if (['goods', 'product_goods'].includes(entity.entityType)) { go({ kind: 'goods', type: 'detail', id: String(entity.product_goods_id || entity.id || entity.entityId), title: plain(entity.goods_title || entity.title || '好物详情') }); return; }
    if (entity.entityType === 'productAlbum') { go({ kind: 'goods', type: 'album', id: String(entity.id || entity.entityId), uid: String(entity.uid || entity.userInfo?.uid || account?.uid || ''), title: plain(entity.title || '产品专辑') }); return; }
    if (isFeedEntity(entity)) { openFeed(entity); return; }
    if (entity.entityType === 'user') { onUser(String(entity.uid || entity.id), entity.username || entity.title); return; }
    if (entity.entityType === 'topic') { const tag = entity.tag || entity.title; go({ kind: 'topic', tag, title: plain(tag) }); return; }
    if (entity.entityType === 'apk') { go({ kind: 'app', id: String(entity.packageName || entity.id), title: plain(entity.title || entity.appName) }); return; }
    if (entity.entityType === 'product') { go({ kind: 'product', id: String(entity.id), title: plain(entity.title || entity.name) }); return; }
    if (['dyh', 'album', 'event', 'live'].includes(entity.entityType)) { go({ kind: entity.entityType === 'live' ? 'live' : 'catalog', type: entity.entityType, id: String(entity.id || entity.entityId), title: plain(entity.title || entity.name || '详情') }); return; }
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
  async function openReply(entity: Entity) {
    const replyId = String(entity.id || entity.entityId || '');
    if (!/^\d{1,20}$/.test(replyId)) { toast('此评论缺少编号'); return; }
    const attempt = ++navigationSequence.current;
    try {
      const result = await call('replyDetail', { id: replyId }); if (attempt !== navigationSequence.current) return;
      const reply = result.data, feedId = String(reply?.feedid || reply?.feedId || reply?.feed_id || entity.feedid || '');
      if (String(reply?.id) !== replyId || !/^\d{1,20}$/.test(feedId)) throw new Error('酷安未返回此评论所属的动态');
      openFeed({ id: feedId, __replyId: replyId });
    } catch (e) { if (attempt === navigationSequence.current) toast((e as Error).message); }
  }
  function chooseSuggestion(selection: SearchSuggestionSelection) {
    setSearchActive(false);
    if (selection.kind === 'search') { setSearch(selection.query); go({ kind: 'search', type: selection.type, title: selection.query }); }
    else if (selection.kind === 'entity') openEntity(selection.entity);
    else onLink(selection.url);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = preferences.palette;
    for (const [name, value] of Object.entries(preferenceThemeVariables(preferences, theme))) document.documentElement.style.setProperty(name, value);
  }, [theme, preferences.palette, preferences.customTheme, preferences.customAccent, preferences.customThemeDark]);
  useEffect(() => {
    const request = window.coolapk?.desktop?.('display', { fontSize: preferences.fontSize });
    if (request) void unwrap(request).catch(error => toast(error.message));
  }, [preferences.fontSize, toast]);
  useEffect(() => {
    const surfaces = document.querySelectorAll<HTMLElement>('.workspace,.sidebar');
    surfaces.forEach(node => { node.inert = !!(detail || loginOpen || settingsOpen || channelManager || updatesOpen || compose || creation || secondhandEditor || accountSettingsPage || collectFeed || manageFeed || collectionEdit); });
    return () => surfaces.forEach(node => { node.inert = false; });
  }, [detail, loginOpen, settingsOpen, channelManager, updatesOpen, compose, creation, secondhandEditor, accountSettingsPage, collectFeed, manageFeed, collectionEdit]);
  useEffect(() => {
    unwrap(window.coolapk?.accounts()).then(state => { accountGeneration.current++; setAccounts(state); }).catch(e => toast(e.message));
    const cleanup = window.coolapk?.onAccount(result => { if (result.ok) { setAccounts(result.data); if (result.metadataOnly) return; accountGeneration.current++; navigationSequence.current++; clearCache(); setDetail(null); setCompose(null); setCreation(null); setSecondhandEditor(null); setAccountSettingsPage(null); setCollectFeed(null); setManageFeed(null); setCollectionEdit(null); setPages([homePage]); setRevision(r => r + 1); setLoginOpen(false); toast(result.data.current ? `已登录 ${result.data.current.username}` : '已切换为游客'); } else { if (result.error.code === 'LOGIN_BLOCKED') { setAccounts(old => ({ ...old, warning: result.error.message })); setLoginOpen(true); } toast(result.error.message); } });
    return cleanup;
  }, [toast]);
  useEffect(() => window.coolapk?.onCommand(command => { if (command === 'search') searchRef.current?.focus(); if (command === 'refresh') refreshCurrentPage(); if (command === 'back') back(); if (command === 'updates') { setSettingsOpen(false); setUpdatesOpen(true); } }), [back, refreshCurrentPage]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); } }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, []);
  const report = async (target: ReportTarget) => { if (!account) { setLoginOpen(true); return; } try { await unwrap(window.coolapk?.report(target)); } catch (error) { toast((error as Error).message); } };
  const feedProps = { onReport: report, onOpen: openFeed, onUser, onLink, onGoodsList: (feed: Entity) => go({ kind: 'goods', type: 'list', id: String(feed.id), title: plain(feed.goodsListInfo?.title || '好物清单') }), onLogin: () => setLoginOpen(true), publicationRestricted, onForward: (feed: Entity) => { if (publicationRestricted) { toast('一键防护开启期间暂停发布动态'); return; } setDetail(null); setCompose(feed); }, onCollect: (feed: Entity) => { setDetail(null); setCollectFeed(feed); }, onSecondhandEdit: (id?: string) => { setDetail(null); setSecondhandEditor({ id }); }, onChanged: () => changed(), onManage: (feed: Entity) => { setDetail(null); if (!collectionItemId(feed) && account?.uid === String(feed.uid || feed.userInfo?.uid) && (feed.feedType === 'ershou' || feed.type === 'ershou' || feed.ershou_info)) setSecondhandEditor({ id: String(feed.id) }); else setManageFeed(feed); }, accountUid: account?.uid, loggedIn: !!account, toast };
  const changed = () => { clearCache(); refreshResources(); setRevision(r => r + 1); };
  const configurations: Entity[] = init.data?.data || [];
  const topicCard = configurations.find(x => String(x.title).startsWith('话题 -'));
  const hotWords: Entity[] = hot.data?.data || [];
  const customBackground = preferences.backgroundEnabled && !!background?.available && /^coolapk-background:\/\/local\/[a-f0-9]{64}$/.test(background.url);
  return <div className="app-shell" data-custom-background={customBackground || undefined} style={{ '--background-opacity': preferences.backgroundOpacity, '--surface-opacity': `${Math.round(preferences.surfaceOpacity * 100)}%` } as CSSProperties}>
    {customBackground && <div className="custom-background" aria-hidden="true" style={{ backgroundImage: `url("${background!.url}")` }} />}
    <aside className="sidebar">
      <button className="brand" onClick={() => go(homePage, true)} aria-label="酷安首页"><span className="brand-mark"><img src={desktopBrand} alt="" width={46} height={46} /></span><span>酷安</span></button>
      <div className="sidebar-scroll"><LiquidGlassNavigation label="社区导航" selectionKey={`${page.kind}:${page.url || ''}:${page.type || ''}`}>{nav.map(item => <button key={item.title} className={`nav-item ${page.kind === item.kind && (item.kind !== 'page' || page.url === item.url) ? 'selected' : ''}`} onClick={() => go(item, true)}><item.icon size={21} /><span>{item.title}</span></button>)}</LiquidGlassNavigation><div className="nav-label">我的社区</div><LiquidGlassNavigation label="个人导航" selectionKey={`${page.kind}:${page.type || ''}`}>{personal.map(item => <button key={item.title} className={`nav-item ${page.kind === item.kind && (item.kind !== 'account' || page.type === item.type) ? 'selected' : ''}`} onClick={() => go(item, true)}><item.icon size={20} /><span>{item.title}</span>{(item.kind === 'notifications' ? notificationCount : item.kind === 'messages' ? messageCount : 0) > 0 && <span className="nav-badge">{Math.min(99, item.kind === 'notifications' ? notificationCount : messageCount)}</span>}</button>)}</LiquidGlassNavigation>
      </div>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings size={20} /><span>设置</span></button><button className="account-entry" onClick={() => account ? go({ kind: 'account', type: 'mine', title: '我的' }, true) : setLoginOpen(true)}><Avatar src={account?.userAvatar} name={account?.username || '酷'} size={38} /><span><strong>{account?.username || '登录酷安'}</strong><small>{account ? '打开我的' : '与酷友一起发现更多'}</small></span><ChevronDown size={15} /></button><div className="unofficial">非官方客户端 · 本地开发版</div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button" onClick={back} aria-label="返回" disabled={pages.length === 1 && !detail}><ArrowLeft size={19} /></button><span>社区</span><span className="breadcrumb-divider">/</span><strong>{page.title}</strong></div><form className="search-box" style={{ position: 'relative' }} onSubmit={e => { e.preventDefault(); setSearchActive(false); if (search.trim()) { const route = coolapkRoute(search.trim()); if (route) onLink(search.trim()); else go({ kind: 'search', type: searchType, title: search.trim() }); } }}><Search size={18} /><input ref={searchRef} aria-label="搜索酷安" placeholder={searchType === 'apk' ? '搜索应用…' : searchType === 'game' ? '搜索游戏…' : '搜索动态、酷友、应用…'} value={search} onFocus={() => setSearchActive(true)} onChange={e => { setSearch(e.target.value); setSearchActive(true); }} /><kbd>Ctrl K</kbd><SearchSuggestions query={search} namespace={namespace} inputRef={searchRef} active={searchActive} scope={searchType === 'apk' || searchType === 'game' ? 'app' : 'all'} onSelect={chooseSuggestion} onDismiss={() => setSearchActive(false)} /></form><div className="topbar-actions"><button className="button topbar-publish" onClick={() => !account ? setLoginOpen(true) : publicationRestricted ? toast('一键防护开启期间暂停发布动态') : setCompose({})}><Plus size={18} /><span>发布动态</span></button><button className="icon-button" onClick={toggleTheme} aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="icon-button" aria-label="刷新当前页" onClick={refreshCurrentPage}><RefreshCw key={refreshMotion} size={18} className={refreshMotion ? "refresh-animate" : undefined} /></button><button className="icon-button" aria-label="通知" onClick={() => go({ kind: 'notifications', title: '通知' }, true)}><Bell size={20} /></button></div></header>
      <div className="body-layout"><main ref={mainScrollRef} className="main-scroll" data-page-kind={page.kind} key={namespace + JSON.stringify(page)}>{page.kind !== 'home' && <PageHeading page={page} />}
        {page.kind === 'history' ? <><div className="history-toolbar"><span>{history.length} 条浏览记录</span><button className="text-button" onClick={() => { try { clearHistory(); } catch { toast('本机浏览历史清理失败'); } }}>清空历史</button></div>{history.length ? history.map(item => <EntityCard key={item.id} entity={{ ...item, title: item.message_title || item.username + '的动态' }} onOpen={openFeed} onUser={onUser} onLink={onLink} />) : <Empty title="还没有浏览记录" message="打开一条动态，之后就能在这里找到它。" />}</> : page.kind === 'notifications' ? <Notifications key={namespace} namespace={namespace} loggedIn={!!account} revision={revision} ignoreLikes={privacy?.values.notification_ignore_like_count === true} onLogin={() => setLoginOpen(true)} onLink={onLink} onUser={onUser} onOpen={openEntity} onCountChanged={() => setRevision(value => value + 1)} /> : page.kind === 'secondhand' ? <SecondhandScreen page={page} namespace={namespace} account={account} onLogin={() => setLoginOpen(true)} go={go} openEntity={openEntity} feedProps={feedProps} toast={toast} /> : page.kind === 'goods' ? <GoodsScreen page={page} namespace={namespace} account={account} onLogin={() => setLoginOpen(true)} go={go} openEntity={openEntity} feedProps={feedProps} toast={toast} /> : page.kind === 'downloads' ? <DownloadsPage namespace={namespace} onLogin={() => setLoginOpen(true)} toast={toast} onInstall={async task => { const result = await downloadCall('install', { id: task.id }); toast(result.installed ? '应用已安装到手机' : '已取消安装'); }} /> : page.kind === 'phone' ? <Phone toast={toast} target={page.type} /> : page.kind === 'personal' ? <PersonalScreen page={page} namespace={namespace} account={account} onLogin={() => setLoginOpen(true)} go={go} openEntity={openEntity} feedProps={feedProps} toast={toast} onPhoneBackup={() => go({ kind: 'phone', type: 'backups', title: '手机应用备份' })} /> : page.kind === 'account' ? <AccountCenter key={namespace + ':' + (page.type || 'mine')} onFollowing={() => go({ kind: 'following', title: '我的关注' })} onCollections={() => go({ kind: 'collections', title: '我的收藏' })} onToggleTheme={toggleTheme} theme={theme} onSettings={() => setSettingsOpen(true)} onMessages={() => go({ kind: 'notifications', title: '通知' })} onMyHome={() => account && onUser(account.uid, '我的主页')} onUpdates={() => go({ kind: 'phone', title: '手机应用管理' })} onScan={() => go({ kind: 'phone', title: '手机扫码' })} onDrafts={() => setCompose({ __showDrafts: true })} onDownloads={() => go({ kind: 'downloads', title: '应用下载' })} onPhoneApps={() => go({ kind: 'phone', type: 'apps', title: '手机应用管理' })} onPersonal={type => { const entries: Record<string, Page> = { digital: { kind: 'personal', type: 'products', title: '我的数码' }, lists: { kind: 'personal', type: 'lists', title: '我的清单' }, kankan: { kind: 'personal', type: 'dyhs', title: '看看号' }, backups: { kind: 'personal', type: 'backups', title: '备份单' }, blocks: { kind: 'personal', type: 'blocks', title: '首页屏蔽管理' } }; if (entries[type]) go(entries[type]); }} account={account} namespace={namespace} revision={revision} section={page.type as AccountSection} onLogin={() => setLoginOpen(true)} onOpenEntity={openEntity} onLink={onLink} onUpdated={changed} onUsernameEdit={async () => { try { await unwrap(window.coolapk?.openAccountPage('username')); } catch (e) { toast((e as Error).message); } }} toast={toast} /> : ['topic', 'live', 'followedTopics'].includes(page.kind) ? <CommunityPage kind={page.kind as 'topic' | 'live' | 'followedTopics'} id={page.id} tag={page.tag} namespace={namespace} feedProps={feedProps} onOpenEntity={openEntity} /> : page.kind === 'apps' || (page.kind === 'catalog' && ['apps', 'games'].includes(page.type || '')) ? <AppDiscovery page={page} namespace={namespace} account={account} onLogin={() => setLoginOpen(true)} go={go} openEntity={openEntity} feedProps={feedProps} toast={toast} /> : ['catalog', 'digital', 'app', 'product'].includes(page.kind) ? <CatalogScreen page={page.kind === 'catalog' ? page : { ...page, kind: 'catalog', type: page.kind === 'digital' ? 'products' : page.kind }} namespace={namespace} account={account} onLogin={() => setLoginOpen(true)} go={go} openEntity={openEntity} feedProps={feedProps} toast={toast} /> : <PageScreen page={page} configurations={configurations} namespace={namespace} account={account} revision={revision} refresh={() => setRevision(r => r + 1)} go={go} openEntity={openEntity} feedProps={feedProps} onLogin={() => setLoginOpen(true)} onCollectionEdit={setCollectionEdit} />}
      </main><aside className="right-rail"><div className="welcome-panel"><div className="welcome-icon"><Compass size={26} /></div><h2>{account ? `你好，${account.username}` : '欢迎来到酷安'}</h2><p>{account ? '看看关注的酷友有什么新发现。' : '发现好应用，聊聊新数码，分享生活里的小惊喜。'}</p><button className="button" onClick={() => account ? go({ kind: 'following', title: '我的关注' }, true) : setLoginOpen(true)}>{account ? '看看我的关注' : '登录，加入讨论'}{!account && <LogIn size={16} />}</button></div>
        {hotWords.length > 0 && <section className="rail-section"><h2><Flame size={18} />大家都在搜</h2><div className="hot-words">{hotWords.filter(x => x.title || x.searchValue || x.entityType === 'hotSearch').slice(0, 8).map((word, index) => { const title = plain(word.title || word.searchValue || word.name); return <button key={title + index} onClick={() => { setSearch(title); go({ kind: 'search', title }); }}><span className={index < 3 ? 'hot-number' : ''}>{index + 1}</span><strong>{title}</strong>{index === 0 && <span className="hot-tag">热</span>}</button>; })}</div></section>}
        <HotTopics key={namespace} namespace={namespace} onTopic={tag => go({ kind: 'topic', tag, title: plain(tag) })} onLogin={() => setLoginOpen(true)} />
        {topicCard?.entities?.length > 0 && <section className="rail-section"><h2><Hash size={18} />发现话题</h2><div className="rail-topics">{(topicCard?.entities || []).slice(0, 6).map((topic: Entity, index: number) => <button key={index} onClick={() => topic.tag || topic.entityType === 'topic' ? go({ kind: 'topic', tag: topic.tag || topic.title, title: plain(topic.title) }) : openEntity(topic)}><span>#</span>{plain(topic.title)}</button>)}</div></section>}
        <div className="rail-footer"><p>Ctrl K 搜索 · Alt ← 返回</p><p>酷安名称及商标归其权利人所有</p><button onClick={() => onLink('https://www.coolapk.com')} className="text-button">酷安官方网站</button></div>
      </aside></div>
    </div>
    {detail && <Detail feed={detail} namespace={namespace} feedProps={feedProps} onClose={() => setDetail(null)} />}
    {loginOpen && <LoginModal accounts={accounts} onClose={() => setLoginOpen(false)} toast={toast} />}
    {channelManager && <ChannelManager key={namespace} channels={savedHomeChannels(homeChannels(configurations), namespace)} defaults={homeChannels(configurations)} namespace={namespace} loggedIn={!!account} onSave={() => setRevision(value => value + 1)} onClose={() => setChannelManager(false)} toast={toast} />}
    {updatesOpen && <Modal title="软件更新" onClose={closeUpdates}><SoftwareUpdate state={updates.state} busy={updates.busy} error={updates.error} onAction={updates.action} onInstaller={() => onLink('https://github.com/Marginal-Z/coolapk-for-windows/releases/latest')} /></Modal>}
    {settingsOpen && <Modal title="设置" className="settings-modal" onClose={() => setSettingsOpen(false)}><SettingsPanel onHomeChannels={() => { setSettingsOpen(false); setChannelManager(true); }} onBackgroundChange={setBackground} onTeenager={() => { setSettingsOpen(false); onTeenagerSetup(); }} onAgreement={() => onLink('https://m.coolapk.com/mp/user/agreement')} onAccountPrivacy={() => { setSettingsOpen(false); setAccountSettingsPage('privacy'); }} onAccountNotifications={() => { setSettingsOpen(false); setAccountSettingsPage('notifications'); }} loggedIn={!!account} onLogin={() => { setSettingsOpen(false); setLoginOpen(true); }} onUpdates={() => { setSettingsOpen(false); setUpdatesOpen(true); }} namespace={namespace} accountCount={accounts.accounts.length} version={packageInfo.version} preferences={preferences} onPreferencesChange={updatePreferences} preferenceError={preferenceError} onAccountProfile={() => { setSettingsOpen(false); go({ kind: 'account', type: 'profile', title: '头像与个人信息' }); }} onAccountSecurity={async () => { if (!account) { setSettingsOpen(false); setLoginOpen(true); return; } await unwrap(window.coolapk?.openAccountPage('security')); }} onManageAccounts={() => { setSettingsOpen(false); setLoginOpen(true); }} onDownloads={() => { setSettingsOpen(false); go({ kind: 'downloads', title: '应用下载' }); }} onClearCache={async () => { const generation = accountGeneration.current; await unwrap(window.coolapk?.desktop('clearCache')); if (generation !== accountGeneration.current) return; clearCache(); refreshResources(); setRevision(value => value + 1); }} onClearHistory={clearHistory} onHelp={() => onLink('https://m.coolapk.com/mp/do?c=help&m=list')} /></Modal>}
    {accountSettingsPage && <Modal title={accountSettingsPage === 'privacy' ? '隐私设置' : '订阅消息提醒'} onClose={() => { setAccountSettingsPage(null); setSettingsOpen(true); }}><AccountSettings key={namespace + ':' + accountSettingsPage} page={accountSettingsPage} namespace={namespace} loggedIn={!!account} onLogin={() => { setAccountSettingsPage(null); setLoginOpen(true); }} onChanged={data => { setAccountConfiguration({ owner: namespace, data }); changed(); }} /></Modal>}
    {creation && <CreationDialog restrictionReason={publicationRestricted ? '一键防护开启期间暂停发布动态' : undefined} key={namespace + ':' + creation} kind={creation} namespace={namespace} loggedIn={!!account} onLogin={() => setLoginOpen(true)} onClose={() => setCreation(null)} onCreated={feed => { setCreation(null); changed(); openFeed(feed); }} onOpenQuestion={id => { setCreation(null); openFeed({ entityType: 'feed', id }); }} toast={toast} />}
    {secondhandEditor && <SecondhandDialog key={namespace + ':' + (secondhandEditor.id || 'create')} id={secondhandEditor.id} namespace={namespace} loggedIn={!!account} onLogin={() => setLoginOpen(true)} restrictionReason={publicationRestricted ? '一键防护开启期间暂停发布动态' : undefined} onClose={() => setSecondhandEditor(null)} onSaved={feed => { setSecondhandEditor(null); changed(); openFeed(feed); }} toast={toast} />}
    {compose && <ComposeModal restrictionReason={publicationRestricted ? '一键防护开启期间暂停发布动态' : undefined} key={namespace} namespace={namespace} initialShowDrafts={!!compose.__showDrafts} initialMode={compose.__initialMode === 'article' || compose.__initialMode === 'video' ? compose.__initialMode : 'feed'} initialMessage={typeof compose.__initialMessage === 'string' ? compose.__initialMessage : ''} onSpecial={kind => { setCompose(null); if (kind === 'secondhand') setSecondhandEditor({}); else setCreation(kind); }} forward={compose.id ? compose : undefined} onClose={() => setCompose(null)} onDone={() => { setCompose(null); changed(); }} toast={toast} />}
    {collectFeed && <CollectionPicker key={namespace + ':' + collectFeed.id} feed={collectFeed} namespace={namespace} onClose={() => setCollectFeed(null)} onDone={() => { setCollectFeed(null); changed(); }} toast={toast} />}
    {collectionEdit && <CollectionEditor key={namespace + ':' + (collectionEdit.id || 'new')} collection={collectionEdit.id ? collectionEdit : undefined} onClose={() => setCollectionEdit(null)} onDone={() => { if (collectionEdit.id) go({ kind: 'collections', title: '我的收藏' }, true); setCollectionEdit(null); changed(); }} toast={toast} />}
    {manageFeed && <FeedManager key={namespace + ':' + manageFeed.id} feed={manageFeed} namespace={namespace} removeItemId={collectionItemId(manageFeed) || undefined} onClose={() => setManageFeed(null)} onDone={() => { setManageFeed(null); setDetail(null); changed(); }} toast={toast} />}
    <DesktopEffects preferences={preferences} backgroundActive={!!customBackground} />
    {toastMessage && <div className="toast" role="status"><Check size={18} /><span>{toastMessage}</span><button onClick={() => setToastMessage('')} aria-label="关闭提示"><X size={16} /></button></div>}
  </div>;
}

type ScreenProps = { page: Page; configurations: Entity[]; namespace: string; account: AccountState['current']; revision: number; refresh: () => void; go: (page: Page) => void; openEntity: (entity: Entity) => void; feedProps: any; onLogin: () => void; onCollectionEdit: (collection: Entity) => void };
function PageHeading({ page }: { page: Page }) { return <div className="page-heading"><div><h1>{page.kind === 'search' ? `搜索“${page.title}”` : page.title}</h1><p>{page.kind === 'home' ? '数码与生活，都有酷友的声音。' : page.kind === 'rank' ? '看看酷友们正在聊什么。' : page.kind === 'history' ? '回到那些你看过的精彩内容。' : page.kind === 'messages' ? '和酷友继续聊下去。' : '发现、分享，也听听不一样的想法。'}</p></div></div>; }

function PageScreen({ page, configurations, namespace, account, revision, refresh, go, openEntity, feedProps, onLogin, onCollectionEdit }: ScreenProps) {
  const [tab, setTab] = useState('');
  const homeHeader = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = homeHeader.current, owner = header?.closest<HTMLElement>('.main-scroll');
    if (!header || !owner) return;
    const measure = () => owner.style.setProperty('--page-header-height', `${Math.ceil(header.getBoundingClientRect().height) + 12}px`);
    const observer = new ResizeObserver(measure); observer.observe(header); measure();
    return () => { observer.disconnect(); owner.style.removeProperty('--page-header-height'); };
  }, [page.kind]);

  const [subtype, setSubtype] = useState(page.kind === 'search' ? page.type || '' : '');
  const [actionError, setActionError] = useState<ClientError>();
  const [actionBusy, setActionBusy] = useState(false);
  const [chatKey, setChatKey] = useState(page.ukey || '');
  const [chatLookupRevision, setChatLookupRevision] = useState(0);
  const [sentRows, setSentRows] = useState<Entity[]>([]);
  const [chatSent, setChatSent] = useState(false);
  const pendingAction = useRef<{ operation: string; args: Entity } | null>(null);
  const locked = ['following', 'collections', 'notifications', 'messages', 'chat'].includes(page.kind) && !account;
  const channels = page.kind === 'home' ? savedHomeChannels(homeChannels(configurations), namespace) : [];
  const tabs: Entity[] = page.kind === 'home' ? channels.filter(item => ![false, 0, '0'].includes(item.page_visibility ?? 1)) : page.kind === 'digital' ? configurations.find(x => x.title === '数码')?.entities || [] : [];
  const selectedConfig = tabs.find(x => x.title === tab) || (page.kind === 'digital' ? tabs.find(x => x.title === '数码') : tabs[0]) || tabs[0];
  let operation: string | null = 'home', args: Entity = {};
  switch (page.kind) {
    case 'home': if (selectedConfig?.operation) operation = selectedConfig.operation; else if (selectedConfig?.url) { operation = 'page'; args = { url: selectedConfig.url }; } break;
    case 'page': operation = 'page'; args = { url: page.url }; break;
    case 'rank': operation = 'rank'; args = { type: subtype || 'week' }; break;
    case 'digital': operation = selectedConfig ? 'page' : null; args = { url: selectedConfig?.url || selectedConfig?.page_name }; break;
    case 'apps': operation = 'search'; args = { query: subtype === 'game' ? '手游' : '常用应用', type: subtype || 'apk' }; break;
    case 'search': operation = 'search'; args = { query: page.title, type: subtype || 'all' }; break;
    case 'user': if (['profile', 'ratings', 'home', 'circles', 'content'].includes(subtype)) { operation = null; break; } operation = 'userFeeds'; args = { uid: page.uid, type: subtype || 'feed' }; if (subtype === 'follow' || subtype === 'fans') { operation = 'userFollows'; args = { uid: page.uid, type: subtype }; } break;
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
  const topicDiscovery = (page.kind === 'home' || page.kind === 'page') && String(selectedConfig?.url || page.url || '').includes('V11_VERTICAL_TOPIC');
  if (locked || topicDiscovery) operation = null;
  const resource = useResource(operation, args, namespace, revision);
  const headline = page.kind === 'home' && (operation === 'homeHeadline' || operation === 'page' && /^(?:#\/|\/)main\/headline(?:[?]|$)/.test(String(args.url || '')));
  const homeBlocks = useResource(headline && account ? 'personalHomeBlocks' : null, {}, namespace, revision);
  const blockPending = headline && !!account && !homeBlocks.data;
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
  const feedItems = page.kind === 'home' ? items.filter((item: Entity) => item.entityType === 'feed' && !blockPending && (!headline || personalHeadlineVisible(item, homeBlocks.data?.data))) : items;
  // Android shares these fixed cards across the recommendation and headline feeds.
  const headlineHeader = useResource(headline ? 'home' : null, {}, namespace, revision);
  const structuredContent = page.kind === 'home' || page.kind === 'page' && Array.isArray(resource.data?.surfaceItems);
  const serverSurfaceItems: Entity[] = useMemo(() => structuredContent ? mergeSurfaceItems(headline ? homeHeaderItems(headlineHeader.data?.surfaceItems) : [], resource.data?.surfaceItems || items) || [] : [], [structuredContent, headline, headlineHeader.data?.surfaceItems, resource.data?.surfaceItems, items]);
  const surfaceItems = useMemo(() => {
    if (page.kind !== 'home' || !(headline || operation === 'home') || !resource.data) return serverSurfaceItems;
    const headerItems = homeHeaderItems(serverSurfaceItems), fixed = new Set(headerItems);
    return [...headerItems, ...serverSurfaceItems.filter(item => !fixed.has(item))];
  }, [page.kind, headline, operation, resource.data, serverSurfaceItems]);
  const visibleHomeFeed = useCallback((item: Entity) => !blockPending && (!headline || personalHeadlineVisible(item, homeBlocks.data?.data)), [blockPending, headline, homeBlocks.data]);
  const profileData = profile.data?.data;
  const displayTabs = page.kind === 'rank' ? [{ id: 'week', title: '周榜' }, { id: 'day', title: '日榜' }, { id: 'month', title: '月榜' }, { id: 'picture', title: '酷图' }, { id: 'favorite', title: '收藏榜' }, { id: 'index', title: '指数榜' }] : page.kind === 'search' ? searchTypes : page.kind === 'apps' ? [{ id: 'apk', title: '应用' }, { id: 'game', title: '游戏' }] : page.kind === 'user' ? [{ id: 'feed', title: '动态' }, { id: 'home', title: '主页' }, { id: 'profile', title: '资料' }, { id: 'circles', title: '关注圈子' }, { id: 'content', title: '公开内容' }, { id: 'ratings', title: '应用评分' }, { id: 'favorite', title: '收藏' }, ...(account?.uid === page.uid ? [{ id: 'like', title: '赞过' }] : []), { id: 'follow', title: '关注' }, { id: 'fans', title: '粉丝' }] : page.kind === 'topic' ? [{ id: 'lastupdate_desc', title: '最新' }, { id: 'hot', title: '热门' }] : page.kind === 'following' ? [{ id: 'feeds', title: '关注动态' }, { id: 'users', title: '关注的酷友' }] : page.kind === 'notifications' ? [{ id: 'list', title: '评论与回复' }, { id: 'atMeList', title: '@我的' }, { id: 'atCommentMeList', title: '评论@我' }, { id: 'feedLikeList', title: '收到的赞' }, { id: 'contactsFollowList', title: '新关注' }] : [];
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
    {page.kind === 'home' && <header ref={homeHeader} className="home-feed-header"><PageHeading page={page} /><div className="collection-toolbar"><span className="muted">首页栏目</span></div><div className="tabs" role="tablist" aria-label="首页栏目">{tabs.map((item, i) => <button key={item.title + i} role="tab" aria-selected={selectedConfig === item} className={selectedConfig === item ? 'selected' : ''} onClick={event => { setTab(item.title); const scroll = event.currentTarget.closest<HTMLElement>('.main-scroll'); if (scroll) scroll.scrollTop = 0; }}>{item.title}</button>)}</div></header>}

    {account && page.kind === 'collections' && <div className="collection-toolbar"><span className="muted">整理喜欢的动态与发现</span><button className="button" onClick={() => onCollectionEdit({})}><Plus size={16} />新建收藏单</button></div>}
    {page.kind === 'collection' && profileData && <CollectionExport id={String(page.id)} title={plain(profileData.title || page.title)} namespace={namespace} toast={feedProps.toast} />}
    {account && ['notifications', 'messages'].includes(page.kind) && <div className="collection-toolbar"><span className="muted">{page.kind === 'messages' ? '私信会话' : '社区消息'}</span><button className="text-button" disabled={actionBusy || !!actionError?.verificationId} onClick={() => void clearUnread()}>标记当前类别已读</button></div>}
    {actionError && <ErrorNotice error={actionError} onRetry={retryAction} onLogin={onLogin} />}
    {page.kind !== 'home' && tabs.length > 0 && <div className="tabs" role="tablist">{tabs.map((item, i) => <button key={item.title + i} role="tab" aria-selected={selectedConfig === item} className={selectedConfig === item ? 'selected' : ''} onClick={() => setTab(item.title)}>{item.title}</button>)}</div>}
    {displayTabs.length > 0 && <div className="tabs" role="tablist">{displayTabs.map((item, i) => <button key={item.id} role="tab" aria-selected={subtype ? subtype === item.id : i === 0} className={(subtype ? subtype === item.id : i === 0) ? 'selected' : ''} onClick={() => setSubtype(item.id)}>{item.title}</button>)}</div>}
    {profile.error && <ErrorNotice error={profile.error} onRetry={refresh} onLogin={onLogin} />}
    {profileData && <section className="profile-card"><Avatar src={profileData.userAvatar || profileData.logo} name={profileData.username || profileData.title || page.title} size={72} /><div><h2>{plain(profileData.username || profileData.title || profileData.appName || page.title)}</h2><p>{plain(profileData.introduce || profileData.description || profileData.intro || '')}</p><div className="profile-stats">{profileData.fans != null && <span><b>{count(profileData.fans)}</b> 粉丝</span>}{profileData.follow != null && <span><b>{count(profileData.follow)}</b> 关注</span>}{profileData.feed != null && <span><b>{count(profileData.feed)}</b> 动态</span>}{profileData.rating && <span><b>{profileData.rating}</b> 应用评分</span>}</div></div>{page.kind === 'user' && account?.uid !== page.uid && <div className="profile-actions"><button className="button secondary" disabled={actionBusy || !!actionError?.verificationId} onClick={follow}>{profileData.isFollow ? '已关注' : '关注'}</button><button className="button secondary" onClick={startChat}><MessageCircle size={15} />发私信</button>{feedProps.onReport && <button className="text-button" onClick={() => feedProps.onReport({ type: 'user', id: String(page.uid) })}>举报用户</button>}</div>}{page.kind === 'collection' && !defaultCollection && <div className="collection-actions">{ownCollection ? <button className="button secondary" onClick={() => onCollectionEdit(profileData)}>编辑收藏单</button> : <button className="button secondary" disabled={actionBusy || !!actionError?.verificationId} onClick={() => void collectionFollow()}>{Number(profileData.isFollow || profileData.userAction?.follow) === 1 ? '已订阅' : '订阅收藏单'}</button>}</div>}{page.kind === 'app' && <button className="button secondary" onClick={() => void window.coolapk?.openExternal(`https://www.coolapk.com/apk/${page.id}`)}>官方下载</button>}</section>}
    {page.kind === 'user' && ['profile', 'ratings', 'home', 'circles', 'content'].includes(subtype) && <UserDiscovery key={namespace + ':' + page.uid + ':' + subtype} uid={String(page.uid || '')} type={subtype as UserDiscoveryType} namespace={namespace} loggedIn={!!account} revision={revision} onLogin={onLogin} openEntity={openEntity} feedProps={feedProps} />}
    {topicDiscovery ? <TopicDiscovery namespace={namespace} revision={revision} loggedIn={!!account} onLogin={onLogin} onOpen={openEntity} /> : locked ? <Empty title="登录后，社区更完整" message="查看关注、收藏、通知和私信，也能参与讨论。"><button className="button" onClick={onLogin}>登录酷安</button></Empty> : <>
      {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}
      {headline && headlineHeader.error && <ErrorNotice error={headlineHeader.error} onRetry={headlineHeader.retry} onLogin={onLogin} />}
      {headline && homeBlocks.error && <ErrorNotice error={homeBlocks.error} onRetry={homeBlocks.retry} onLogin={onLogin} />}
      {(resource.loading && !resource.data || blockPending && homeBlocks.loading) && <Skeleton />}
      {headline && !blockPending && !resource.loading && items.some(item => item.entityType === 'feed') && !feedItems.length && <Empty title="本页动态已按屏蔽设置过滤" message="可以继续加载后续动态，或在首页屏蔽管理中调整规则。" />}
      {page.kind === 'chat' && !chatKey && chatLookup.error && <ErrorNotice error={chatLookup.error} onRetry={() => setChatLookupRevision(value => value + 1)} onLogin={onLogin} />}
      {page.kind === 'chat' && !chatKey && chatLookup.loading && <p className="muted" role="status">正在查找已有会话…</p>}
      {!resource.loading && !resource.error && !items.length && !(page.kind === 'user' && ['profile', 'ratings', 'home', 'circles', 'content'].includes(subtype)) && (page.kind === 'chat' && !chatKey ? <Empty title={chatSent ? '私信已发送' : '开始交流'} message={chatSent ? '会话记录暂未同步，刷新后继续查看。' : `向 ${page.title} 发送第一条消息，开启新的交流。`} /> : <Empty />)}
      {page.kind === 'chat' && chatSent && !chatKey && <div className="chat-sync-notice"><span>消息已发出，正在等待酷安同步会话记录。</span><button className="text-button" disabled={chatLookup.loading} onClick={() => setChatLookupRevision(value => value + 1)}>刷新会话</button></div>}
      {(page.kind === "rank" && subtype === "picture" || page.kind === "home" && /酷图/.test(selectedConfig?.title || "")) ? <PicturePosters items={feedItems} onOpen={openEntity} onUser={feedProps.onUser} feedProps={collectionProps} /> : structuredContent ? <HomeContent items={surfaceItems} visibleFeed={visibleHomeFeed} openEntity={openEntity} feedProps={collectionProps} /> : <div className={page.kind === 'chat' ? 'chat-list' : 'feed-list'}>{feedItems.map((entity: Entity, index: number) => isFeedEntity(entity) ? <FeedCard key={entity.entityType + ':' + (entity.id || index)} feed={entity} {...collectionProps} /> : page.kind === 'chat' ? <ChatMessage key={entity.id || index} item={entity} accountUid={account?.uid} namespace={namespace} onLink={feedProps.onLink} onLogin={onLogin} /> : <EntityCard key={entity.entityType + ':' + (entity.id || entity.entityId || index)} entity={entity} onOpen={openEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />)}</div>}
      {items.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
      {page.kind === 'messages' && <RecentContacts namespace={namespace} onUser={feedProps.onUser} onLogin={onLogin} onChat={(uid, title) => go({ kind: 'chat', uid, title })} />}
      {page.kind === 'chat' && chatKey && <ChatTools ukey={chatKey} uid={page.uid} title={page.title} namespace={namespace} onLogin={onLogin} onUser={feedProps.onUser} onDeleted={() => go({ kind: 'messages', title: '私信' })} />}
      {page.kind === 'chat' && <ChatComposer uid={String(page.uid || '')} namespace={namespace} loggedIn={!!account} restrictionReason={feedProps.publicationRestricted ? '一键防护开启期间暂停发送私信' : undefined} onLogin={onLogin} onSent={chatMessageSent} />}
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
