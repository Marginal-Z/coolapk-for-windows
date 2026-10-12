import { coolapkRoute } from './navigation.mjs';

// Response fields cross-checked with the MIT reference's notificationItem,
// notificationNavigation and notificationCount helpers. No mutation is inferred.
export const NOTIFICATION_TABS = Object.freeze([
  { id: 'list', title: '评论与回复', category: 'comment', keys: ['commentme', 'commentMe', 'comment'] },
  { id: 'atMeList', title: '@我的', category: 'atMe', keys: ['atme', 'atMe'] },
  { id: 'atCommentMeList', title: '评论@我', category: 'atComment', keys: ['atcommentme', 'atCommentMe'] },
  { id: 'feedLikeList', title: '收到的赞', category: 'like', keys: ['feedlike', 'feedLike'] },
  { id: 'contactsFollowList', title: '新关注', category: 'follow', keys: ['contacts_follow', 'contactsFollow', 'follow'] },
]);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value : '';
const numeric = value => /^[1-9]\d{0,19}$/.test(String(value ?? '').replace(/^feed:/i, '')) ? String(value).replace(/^feed:/i, '') : '';
const safeCount = value => value !== null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : null;
const nativeCounterKeys = new Set([...NOTIFICATION_TABS.map(tab => tab.keys[0]), 'message', 'notification_v18', 'badge_v18', 'badge', 'cloudInstall', 'notification', 'lastSplashUpdate', 'dateline']);
function nativeCountPayload(response) {
  const envelope = record(response);
  if (Object.hasOwn(envelope, 'data')) {
    return envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) ? envelope.data : null;
  }
  return [...nativeCounterKeys].some(key => Object.hasOwn(envelope, key)) ? envelope : null;
}
function nativeCount(source, key) {
  if (!Object.hasOwn(source, key) || source[key] === null) return 0;
  return safeCount(source[key]);
}
const sumCounts = (...counts) => counts.some(count => count === null) ? null : counts.reduce((sum, count) => sum + count, 0);
function countFrom(value, keys) {
  const source = record(value);
  for (const key of keys) if (Object.hasOwn(source, key)) { const count = safeCount(source[key]); if (count !== null) return count; }
  return null;
}
export function notificationCounts(response, items = [], { ignoreLikes = false } = {}) {
  const envelope = record(response), native = nativeCountPayload(response);
  const source = record(native ?? (envelope.data ?? response)), categories = {};
  for (const tab of NOTIFICATION_TABS) {
    let count = native ? nativeCount(native, tab.keys[0]) : countFrom(source, tab.keys);
    if (count === null && !native) {
      for (const item of Array.isArray(items) ? items : []) {
        for (const embedded of [record(item).notifyCount, record(item).notify_count, record(item).notificationCount]) {
          const found = countFrom(embedded, tab.keys);
          if (found !== null) count = Math.max(count ?? 0, found);
        }
      }
    }
    categories[tab.category] = count;
  }
  const message = native ? nativeCount(native, 'message') : countFrom(source, ['message', 'messageCount']);
  // Official NotifyCount and AppNotification: notification_v18 excludes likes
  // and private messages. The mobile preference affects its main badge only;
  // the like category remains readable. NotifyCount's generated Gson adapter
  // initializes absent and null integer counters to zero; badge_v18 is unused.
  const nativeTotal = native ? nativeCount(native, 'notification_v18') : null;
  const total = native ? sumCounts(nativeTotal, ignoreLikes ? 0 : categories.like, message)
    : countFrom(source, ['badge_v18', 'badge', 'count', 'fcount', 'total', 'totalCount', 'notificationCount', 'unreadCount']);
  const known = Object.values(categories).filter(value => value !== null);
  const community = native ? sumCounts(nativeTotal, ignoreLikes ? 0 : categories.like)
    : total !== null && message !== null ? Math.max(0, total - message) : known.length ? known.reduce((sum, count) => sum + count, 0) : null;
  return { categories, total, message, community };
}
// For OS reminders, only use a successful NotifyCount-shaped object. The APK's
// generated adapter defaults absent/null primitive counters to zero.
export function exactNotificationTotal(response, { ignoreLikes = false } = {}) {
  const source = nativeCountPayload(response);
  if (!source) return null;
  const community = nativeCount(source, 'notification_v18');
  const likes = ignoreLikes ? 0 : nativeCount(source, 'feedlike');
  const messages = nativeCount(source, 'message');
  if (community === null || likes === null || messages === null) return null;
  return community + likes + messages;
}
function officialLinks(value) {
  const raw = text(value);
  // Explicit links only; never treat an arbitrary URL's /feed path as a Coolapk target.
  const links = [...raw.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  if (!raw.includes('<')) links.push(raw);
  return links.map(link => link.replace(/&amp;/g, '&')).filter(link => link.length <= 4096);
}
function feedTarget(value) {
  const source = record(value), type = String(source.entityType || source.feedType || '').toLowerCase();
  if (/reply|notification|product|device|apk|goods|user|topic|dyh|album/.test(type)) return false;
  return ['feed', 'question', 'answer', 'feedquestion', 'feedanswer'].includes(type) || !type && !!(source.message || source.message_title || source.replyRows);
}
export function notificationModel(item, type = 'list') {
  const source = record(item), like = type === 'feedLikeList';
  const actorInfo = record(like ? source.likeUserInfo : source.fromUserInfo || source.userInfo || source.messageUserInfo);
  const actor = {
    uid: numeric(like ? source.likeUid || source.like_uid || actorInfo.uid : source.fromuid || actorInfo.uid || source.uid),
    username: text(like ? source.likeUsername || actorInfo.username : source.fromusername || actorInfo.username || source.username || source.title) || '酷友',
    avatar: text(like ? source.likeAvatar || actorInfo.userAvatar : source.fromUserAvatar || actorInfo.userAvatar || source.userAvatar || source.pic),
  };
  const nested = [source.feedInfo, source.targetFeed, source.targetRow].map(record);
  const candidates = [source, ...nested];
  let feedId = '', replyId = '', link = '';
  for (const candidate of candidates) {
    for (const value of [candidate.note, candidate.message, candidate.infoHtml, candidate.url, candidate.targetUrl, candidate.target_url, candidate.targetTitle]) {
      for (const valueLink of officialLinks(value)) {
        const route = coolapkRoute(valueLink);
        if (route?.kind === 'feed' && numeric(route.id)) { feedId ||= route.id; if (feedId === route.id) replyId ||= numeric(route.replyId); }
        else if (route && !link) link = valueLink;
      }
    }
  }
  if (!feedId) {
    for (const candidate of candidates) feedId ||= numeric(candidate.feedId || candidate.feed_id || candidate.feedid || candidate.fid);
  }
  if (!feedId) for (const candidate of nested) if (feedTarget(candidate)) feedId ||= numeric(candidate.id || candidate.entityId);
  if (!feedId && feedTarget(source) && source.entityType) feedId = numeric(source.id || source.entityId);
  const original = nested.find(candidate => feedTarget(candidate)) || {};
  // Reply identity requires an explicit reply entity, never the notification's id.
  if (!replyId && feedId && source.entityType === 'feedReply') replyId = numeric(source.id);
  const target = record(source.targetRow);
  let entity = null;
  if (!feedId && ['product', 'apk', 'user', 'topic', 'dyh', 'album', 'event', 'live', 'collection'].includes(target.entityType)) entity = target;
  const note = like ? `赞了你的${text(source.feedTypeName || source.infoHtml).replace(/<[^>]*>/g, '').trim() || '动态'}` : text(source.note || source.message_title || original.message_title);
  const message = text(source.message || record(Array.isArray(source.replyRows) ? source.replyRows[0] : null).message || original.message);
  const title = text(source.targetTitle || original.message_title || original.title);
  const unread = Math.max(safeCount(source.unread_count ?? source.unreadCount) || 0, safeCount(source.isnew ?? source.isNew) || 0);
  return { actor, note, message, title, unread, time: Number(source.likeTime || source.dateline) || 0, feedId, replyId, link, entity, summary: text(original.message_title || original.title || original.message || title || message) };
}
