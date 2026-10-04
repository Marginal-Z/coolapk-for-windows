import { homepageListRoute, searchNavigation } from './home-navigation.mjs';

// Only known content links are translated. All resulting actions are local navigation.
export function coolapkRoute(value, depth = 0) {
  if (typeof value !== 'string' || value.length > 4096 || depth > 3) return null;
  const raw = value.trim();
  try {
    const source = raw.startsWith('#/') ? raw.slice(1) : raw;
    const url = new URL(source, 'https://www.coolapk.com');
    if (url.protocol.toLowerCase() === 'searchtab:') {
      return !url.username && !url.password && !url.port && !url.hash && (!url.pathname || url.pathname === '/') && url.searchParams.size === 1 ? searchNavigation(url.hostname, url.searchParams.get('keyword')) : null;
    }
    const deep = url.protocol === 'coolmarket:';
    if (url.username || url.password || url.port || !['http:', 'https:', 'coolmarket:'].includes(url.protocol)) return null;
    if (!(deep ? ['coolapk.com', 'www.coolapk.com', 'm.coolapk.com', 'com.coolapk.market', 'com.coolapk.desktop'] : ['coolapk.com', 'www.coolapk.com', 'm.coolapk.com']).includes(url.hostname)) return null;
    if (url.hash.startsWith('#/')) return coolapkRoute(url.hash.slice(1), depth + 1);
    const id = candidate => /^\d{1,20}$/.test(candidate || '') ? candidate : null;
    const query = url.searchParams;
    if (['/apk/search', '/game/search'].includes(url.pathname)) return !url.hash && query.size === 0 ? { kind: 'search', type: url.pathname === '/apk/search' ? 'apk' : 'game', title: '', inputOnly: true } : null;
    if (url.pathname === '/search') return !url.hash && query.getAll('keyword').length === 1 && query.getAll('type').length <= 1 && [...query.keys()].every(name => ['keyword', 'type'].includes(name)) ? searchNavigation(query.get('type'), query.get('keyword')) : null;
    const homeList = homepageListRoute(url);
    if (homeList) return { kind: 'page', title: homeList.title, url: homeList.pageUrl };
    if (['/feed/digestList', '/feed/statList', '/product/productList', '/product/feedList'].includes(url.pathname)) return { kind: 'page', title: query.get('title') || '发现', url: '/page?url=' + encodeURIComponent('#' + url.pathname + url.search) };
    if (url.pathname === '/topic/userFollowTagList') return { kind: 'followedTopics', title: '订阅话题' };
    if (url.pathname === '/dyh/list') return { kind: 'page', title: query.get('title') || '看看号', url: url.pathname + url.search };
    if (url.pathname === '/topic/tagList' || url.pathname === '/topic/list') return { kind: 'page', title: query.get('title') || '话题列表', url: '/page?url=' + encodeURIComponent(url.pathname + url.search) };
    const match = url.pathname.match(/^\/(feed|u|user|product|dyh|album|event|live|collection|goods)\/(\d+)\/?$/);
    if (match) {
      const [_, kind, contentId] = match;
      if (!id(contentId)) return null;
      if (kind === 'feed') return { kind: 'feed', id: contentId, replyId: id(query.get('rid')) || undefined };
      if (kind === 'u' || kind === 'user') return { kind: 'user', uid: contentId, title: '酷友主页' };
      if (kind === 'goods') return { kind: 'goods', type: 'detail', id: contentId, title: '好物详情' };
      return { kind: ['collection', 'live', 'product'].includes(kind) ? kind : 'catalog', type: kind, id: contentId, title: '详情' };
    }
    const detail = url.pathname.match(/^\/(feed|product|dyh|album|event|live)\/detail\/?$/);
    if (detail && id(query.get('id'))) return coolapkRoute(`/${detail[1]}/${query.get('id')}${detail[1] === 'feed' && id(query.get('rid')) ? '?rid=' + query.get('rid') : ''}`, depth + 1);
    if (url.pathname === '/apk/detail') { const packageName = query.get('packageName') || query.get('package_name'); if (/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(packageName || '')) return { kind: 'app', id: packageName, title: '应用详情' }; }
    const apk = url.pathname.match(/^\/apk\/([^/?#]+)\/?$/);
    if (apk && !['detail', 'list'].includes(apk[1])) { const name = decodeURIComponent(apk[1]); if (/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(name)) return { kind: 'app', id: name, title: '应用详情' }; }
    const topic = url.pathname.match(/^\/(?:t|topic)\/([^/?#]+)\/?$/);
    if (topic && !['tagFeedList', 'tagList', 'list', 'detail', 'userFollowTagList', 'tagDetail', 'newTagDetail', 'questionList', 'deviceFeedList'].includes(topic[1])) { const tag = decodeURIComponent(topic[1]); return tag.length <= 200 ? { kind: 'topic', tag, title: tag } : null; }
    if (['/topic/tagFeedList', '/feed/multiTagFeedList'].includes(url.pathname)) { const tag = query.get('tag') || query.get('title'); return tag && tag.length <= 200 ? { kind: 'topic', tag, title: tag } : null; }
    if (url.pathname === '/page') {
      const nested = query.get('url'); if (!nested) return null;
      const route = coolapkRoute(nested, depth + 1); if (route) return route;
      return { kind: 'page', title: query.get('title') || '发现', url: url.pathname + url.search };
    }
    if (['/notifications', '/messages'].includes(url.pathname)) return { kind: url.pathname.slice(1), title: url.pathname === '/messages' ? '私信' : '通知' };
    if (/^\/main\//.test(url.pathname)) return { kind: 'page', title: '发现', url: url.pathname + url.search };
    return null;
  } catch { return null; }
}
export function deepLinkWebUrl(value) {
  const route = coolapkRoute(value);
  if (!route || !String(value).startsWith('coolmarket:')) return '';
  const url = new URL(value);
  return `https://www.coolapk.com${url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname + url.search}`;
}
