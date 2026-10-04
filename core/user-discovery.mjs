import { ApiError, CoolapkClient, flattenEntities, numericId, sanitizeCookie } from './client.mjs';
import { requestHeaders } from './auth.mjs';
import { imageFormat } from './upload.mjs';
import { USER_PUBLIC_TABS } from './user-discovery-models.mjs';
export { USER_PUBLIC_TABS, visibleUserTabs, userEntityTarget } from './user-discovery-models.mjs';

export const USER_DISCOVERY_OPERATIONS = ['userProfile', 'publicUserProfile', 'userSpace', 'publicUserSpace', 'userAppRatings', 'nodeAppFeeds', 'userQr', 'publicUserQr', 'userFollowNodes', 'publicUserFollowNodes', 'userHomepage', 'publicUserHomepage', 'userTabData', 'publicUserTabData'];
const guests = new WeakMap();
const cursor = args => {
  const page = args.page == null ? 1 : Number(args.page);
  if (!(typeof args.page === 'number' || args.page == null || typeof args.page === 'string' && /^[1-9]\d{0,3}$/.test(args.page)) || !Number.isInteger(page) || page < 1 || page > 1000) throw new ApiError('页码无效', 'INPUT');
  const query = { page };
  for (const key of ['firstItem', 'lastItem']) {
    if (args[key] == null || args[key] === '') continue;
    if (typeof args[key] !== 'string' || args[key].length > 120 || /[\x00-\x1f\x7f]/.test(args[key])) throw new ApiError('分页标记无效', 'INPUT');
    query[key] = args[key];
  }
  return query;
};
function guestFor(client) {
  let guest = guests.get(client);
  if (!guest) { guest = new CoolapkClient({ deviceCode: client.publicDeviceCode, fetchImpl: client.fetch }); guests.set(client, guest); }
  // Explicit verification still replays the original public operation with the same guest device.
  guest.verification = client.verification;
  return guest;
}
function list(result) {
  const source = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.rows, result.data?.list].find(Array.isArray);
  if (!source || result.hasMore != null && typeof result.hasMore !== 'boolean') throw new ApiError('酷安返回的列表结构异常', 'API_ERROR');
  const data = flattenEntities(source);
  const marker = (key, fallback) => {
    const value = result[key] ?? String(fallback?.entityId ?? fallback?.id ?? '');
    if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new ApiError('酷安返回的分页标记异常', 'API_ERROR');
    return value;
  };
  return { ...result, data, rawCount: source.length, firstItem: marker('firstItem', data[0]), lastItem: marker('lastItem', data.at(-1)) };
}
function profile(result, uid) {
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('酷安返回的资料结构异常', 'API_ERROR');
  for (const value of [data.uid, data.userInfo?.uid]) if (value != null && String(value) !== uid) throw new ApiError('酷安返回的资料与当前酷友不匹配', 'API_ERROR');
  return result;
}
async function tabData(reader, uid, args) {
  if (!USER_PUBLIC_TABS.some(tab => tab.id === args.tab)) throw new ApiError('此用户页类别没有公开读取合同', 'UNSUPPORTED');
  const direct = { feed: 'user/feedList', collection: 'collection/list', goods_store: 'goods/goodsStoreItemList', goods_rank: 'goodsList/list', developer_apps: 'apk/developerAppList', apk_follow: 'user/apkFollowList', article: 'user/htmlFeedList', qa: 'user/questionAndAnswerList', album: 'user/albumList', discovery: 'user/discoveryList' };
  const paging = cursor(args);
  if (Object.hasOwn(direct, args.tab)) return list(await reader.request('/v6/' + direct[args.tab], { uid, ...paging, ...(args.tab === 'feed' ? { showAnonymous: 0, isIncludeTop: 1, showDoing: 1 } : {}) }));
  const targets = { coolpic: '#/feed/userCoolPictureFeedList?fragmentTemplate=flex', goods: '#/goods/goodsFeedList?type=default&fragmentTemplate=flex', ershou: '#/feed/userErshouList?fragmentTemplate=flex&ershouStatus=userAll' };
  let url = targets[args.tab];
  if (args.tab === 'rating') { const target = args.ratingTarget ?? 'all'; if (!['all', 'apk', 'product'].includes(target)) throw new ApiError('评分对象无效', 'INPUT'); url = `#/feed/nodeRatingList?uid=${uid}&targetType=${target}&parseRatingToFeed=1`; }
  else url += '&uid=' + uid;
  return list(await reader.request('/v6/page/dataList', { url, title: { rating: '评分', coolpic: '酷图', goods: '好物', ershou: '二手' }[args.tab], subTitle: '', pageContext: 'user_space', ...paging }));
}
async function userQr(reader, uid) {
  const url = new URL('/v6/user/qrImage', 'https://api.coolapk.com'); url.searchParams.set('uid', uid);
  if (reader.verification) url.searchParams.set(reader.verification.field, reader.verification.token);
  const headers = { ...requestHeaders(reader.deviceCode), Accept: 'image/*' };
  if (reader.cookie) headers.Cookie = sanitizeCookie(reader.cookie);
  let response;
  try { response = await reader.fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError('用户二维码加载失败，请检查网络后重试', 'NETWORK'); }
  if (!response.ok) throw new ApiError('用户二维码暂不可用，请检查登录状态后重试', response.status === 401 ? 'LOGIN_REQUIRED' : 'HTTP');
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  const limit = 4 * 1024 ** 2;
  if (!response.body || Number(response.headers.get('content-length')) > limit) throw new ApiError('用户二维码图片超过加载限制或为空', 'API_ERROR');
  const stream = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const { done, value } = await stream.read(); if (done) break; size += value.length; if (size > limit) { await stream.cancel(); throw new ApiError('用户二维码图片超过加载限制', 'API_ERROR'); } chunks.push(value); } }
  catch (error) { if (error instanceof ApiError || error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError('二维码图片传输失败，请重试', 'NETWORK'); }
  finally { stream.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) throw new ApiError('用户二维码图片为空', 'API_ERROR');
  if (mime === 'application/json') {
    let raw; try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw new ApiError('二维码服务返回了无效数据', 'API_ERROR'); }
    const message = String(raw.message || '二维码服务未返回图片').replace(/[\r\n]/g, ' ').slice(0, 240);
    const code = /登录|login|认证/i.test(message) ? 'LOGIN_REQUIRED' : /验证|captcha|安全|风险/i.test(message) ? 'VERIFY_REQUIRED' : 'API_ERROR';
    let challenge;
    if (code === 'VERIFY_REQUIRED') { try { const extra = typeof raw.messageExtra === 'string' ? JSON.parse(raw.messageExtra) : raw.messageExtra; if (extra?.captchaType === 'NEC' && /^[a-f0-9]{32}$/i.test(extra.captchaId)) challenge = { id: extra.captchaId, field: /^_[A-Za-z0-9_]{1,63}$/.test(extra.captchaField) ? extra.captchaField : '_v2_post_token' }; } catch {} }
    throw new ApiError(message, code, { challenge });
  }
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) throw new ApiError('服务器未返回有效二维码图片', 'API_ERROR');
  try { if (imageFormat(bytes)[0] !== mime) throw new Error(); } catch { throw new ApiError('二维码图片格式与声明不匹配', 'API_ERROR'); }
  return { data: `data:${mime};base64,${bytes.toString('base64')}` };
}
export async function dispatchUserDiscovery(client, operation, args = {}) {
  if (!USER_DISCOVERY_OPERATIONS.includes(operation)) throw new ApiError('不支持的用户资料操作', 'INPUT');
  if (['userProfile', 'publicUserProfile', 'userSpace', 'publicUserSpace'].includes(operation)) {
    const reader = operation.startsWith('public') ? guestFor(client) : client;
    const uid = numericId(args.uid);
    return profile(await reader.request(operation.endsWith('Space') ? '/v6/user/space' : '/v6/user/profile', { uid }), uid);
  }
  if (/^(publicUser|user)(Qr|FollowNodes|Homepage|TabData)$/.test(operation)) {
    const uid = numericId(args.uid); if (/^0+$/.test(uid)) throw new ApiError('无效的酷友 UID', 'INPUT');
    const reader = operation.startsWith('public') ? guestFor(client) : client;
    if (operation.endsWith('Qr')) return userQr(reader, uid);
    if (operation.endsWith('FollowNodes')) return list(await reader.request('/v6/user/forumFollowList', { uid, firstItem: '', lastItem: '', ...cursor(args) }));
    if (operation.endsWith('TabData')) return tabData(reader, uid, args);
    const paging = cursor(args);
    if (paging.page > 1) return tabData(reader, uid, { ...args, tab: 'feed' });
    const space = profile(await reader.request('/v6/user/space', { uid }), uid);
    if (space.data.homeTabCardRows != null && !Array.isArray(space.data.homeTabCardRows)) throw new ApiError('酷安返回的主页卡片结构异常', 'API_ERROR');
    const cards = space.data.homeTabCardRows || [];
    if (!cards.length) return tabData(reader, uid, { ...args, tab: 'feed' });
    // Space's card IDs are not feed-list cursors. Home's first continuation is page two with empty cursors.
    return { ...list({ data: cards }), firstItem: '', lastItem: '', hasMore: true };
  }
  if (operation === 'userAppRatings') return list(await client.request('/v6/user/apkRatingList', { uid: numericId(args.uid), ...cursor(args) }));
  const id = String(args.id ?? '');
  if (!/^\d{1,20}$/.test(id) && !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(id)) throw new ApiError('应用编号无效', 'INPUT');
  if (args.sort != null && args.sort !== 'lastupdate_desc') throw new ApiError('节点讨论排序尚未确认', 'INPUT');
  return list(await client.request('/v6/page/dataList', { url: '#/feed/apkCommentList', id, sort: 'lastupdate_desc', ...cursor(args) }));
}
