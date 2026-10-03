import { ApiError, assertLogin, flattenEntities, numericId } from './client.mjs';

const input = (value, max = 4096, empty = false) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (!empty && !value.trim())) throw new ApiError('输入内容无效', 'INPUT');
  return value.trim();
};
const flag = value => { if ([true, 1, '1'].includes(value)) return 1; if ([false, 0, '0', undefined].includes(value)) return 0; throw new ApiError('状态参数无效', 'INPUT'); };
const writeFlag = value => { if (value === undefined) throw new ApiError('缺少关注状态', 'INPUT'); return flag(value); };
const choice = (value, options, fallback) => { const selected = value ?? fallback; if (!options.includes(selected)) throw new ApiError('不支持的筛选条件', 'INPUT'); return selected; };
const pagination = args => ({ page: Math.max(1, Math.min(1000, Math.floor(Number(args.page) || 1))), ...(args.firstItem ? { firstItem: input(args.firstItem, 160) } : {}), ...(args.lastItem ? { lastItem: input(args.lastItem, 160) } : {}), ...(args.pageContext ? { pageContext: input(args.pageContext, 2000) } : {}) });

export function communityList(result, entityType) {
  const raw = Array.isArray(result.data) ? result.data : result.data && ['list', 'items', 'rows', 'entities', 'data'].map(key => result.data[key]).find(Array.isArray);
  if (!raw) throw new ApiError('酷安返回的列表结构异常', 'API_ERROR');
  const data = flattenEntities(raw).map(item => entityType && !item.entityType ? { ...item, entityType, id: item.id ?? item.uid ?? item.entityId } : item);
  const cursor = item => String(item?.entityId ?? item?.id ?? item?.ukey ?? item?.uid ?? '');
  return { ...result, data, firstItem: result.firstItem || cursor(data[0]), lastItem: result.lastItem || cursor(data.at(-1)), rawCount: raw.length, hasMore: result.hasMore ?? raw.length > 0 };
}

// Only read-only topic/category descriptors from the service may reach page/dataList.
export function topicPageDescriptor(value) {
  let descriptor = input(value, 3000);
  if (/^[A-Z][A-Z0-9_]+$/.test(descriptor)) return descriptor;
  if (/^https?:\/\//i.test(descriptor)) {
    const url = new URL(descriptor);
    if (url.hostname !== 'www.coolapk.com' || url.username || url.password || url.port) throw new ApiError('话题栏目地址无效', 'INPUT');
    descriptor = url.pathname + url.search;
  }
  if (descriptor.startsWith('#')) descriptor = descriptor.slice(1);
  if (descriptor.startsWith('/v6/')) descriptor = descriptor.slice(3);
  if (descriptor.startsWith('/page?')) {
    const url = new URL(descriptor, 'https://www.coolapk.com');
    return topicPageDescriptor(url.searchParams.get('url') || '');
  }
  if (!descriptor.startsWith('/')) descriptor = '/' + descriptor;
  const path = descriptor.split('?')[0];
  if (!/^\/(?:topic\/(?:tagFeedList|deviceFeedList|tagList|hotTagList|userFollowTagList|questionList|newTagList|tagDetail)|feed\/(?:tagFeedList|digestList|statList)|page\/dataList)$/.test(path)) throw new ApiError('此话题栏目尚未适配', 'UNSUPPORTED');
  if (path === '/page/dataList') {
    const url = new URL(descriptor, 'https://www.coolapk.com');
    return topicPageDescriptor(url.searchParams.get('url') || '');
  }
  return '#' + descriptor;
}

export const COMMUNITY_OPERATIONS = ['topicDetail', 'topicEntries', 'topicServerTab', 'topicFollow', 'followedTopics', 'topicDevices', 'feedForwards', 'feedLikes', 'feedChanges', 'advancedReplies', 'replyDetail', 'liveDetail', 'liveFollow', 'chatRecent', 'chatRead', 'chatDelete'];

export async function dispatchCommunity(client, operation, args = {}) {
  if (!COMMUNITY_OPERATIONS.includes(operation)) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('请求参数无效', 'INPUT');
  const page = pagination(args);
  const requestList = async (path, query, type) => communityList(await client.request(path, query), type);
  switch (operation) {
    case 'topicDetail': return client.request('/v6/topic/newTagDetail', { tag: input(args.tag, 200) });
    case 'topicEntries': return requestList('/v6/topic/tagFeedList', { tag: input(args.tag, 200), listType: choice(args.sort, ['lastupdate_desc', 'dateline_desc', 'hot', 'popular'], 'lastupdate_desc'), blockStatus: 0, ...page });
    case 'topicDevices': return requestList('/v6/topic/deviceFeedList', { tag: input(args.tag, 200), listType: 'lastupdate_desc', ...page });
    case 'topicServerTab': return requestList('/v6/page/dataList', { url: topicPageDescriptor(args.url), title: input(args.title || '', 200, true), subTitle: input(args.subTitle || '', 200, true), ...page });
    case 'topicFollow': assertLogin(client.identity); return client.request(writeFlag(args.status) ? '/v6/feed/followTag' : '/v6/feed/unFollowTag', { tag: input(args.tag, 200) });
    case 'followedTopics': assertLogin(client.identity); return requestList('/v6/page/dataList', { url: '#/topic/userFollowTagList?&title=我关注的话题', title: '我关注的话题', ...page });
    case 'feedForwards': return requestList('/v6/feed/forwardList', { id: numericId(args.id), type: 'feed', ...page });
    case 'feedLikes': return requestList('/v6/feed/likeList', { id: numericId(args.id), listType: 'lastupdate_desc', ...page }, 'user');
    case 'feedChanges': return requestList('/v6/feed/changeHistoryList', { id: numericId(args.id) });
    case 'replyDetail': return client.request('/v6/feed/replyDetail', { id: numericId(args.id) });
    case 'advancedReplies': {
      const hidden = flag(args.hidden), author = flag(args.authorOnly);
      if (hidden) assertLogin(client.identity);
      return requestList('/v6/feed/replyList', { id: numericId(args.id), listType: hidden || author ? '' : choice(args.sort, ['lastupdate_desc', 'dateline_desc', 'popular'], 'lastupdate_desc'), discussMode: hidden ? 0 : 1, feedType: hidden ? 'feed_reply' : 'feed', blockStatus: hidden ? 4 : 0, fromFeedAuthor: author, ...page });
    }
    case 'liveDetail': return client.request('/v6/live/detail', { id: numericId(args.id) });
    case 'liveFollow': assertLogin(client.identity); return client.request(writeFlag(args.status) ? '/v6/live/follow' : '/v6/live/unFollow', { id: numericId(args.id) });
    case 'chatRecent': assertLogin(client.identity); return requestList('/v6/message/recentChatUser', page, 'user');
    case 'chatRead': case 'chatDelete': assertLogin(client.identity); return client.request(operation === 'chatRead' ? '/v6/message/read' : '/v6/message/deleteChat', { ukey: input(args.ukey, 160) });
  }
}
