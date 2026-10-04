import { createDeviceCode, requestHeaders } from './auth.mjs';
import { homepageListRoute } from './home-navigation.mjs';

export class ApiError extends Error {
  constructor(message, code = 'API_ERROR', detail = {}) { super(message); this.code = code; this.detail = detail; }
}
// Wrap only the final non-idempotent POST, after input checks and media work.
// Once its response is lost, retrying may create a second post/message/reply.
export async function requestSocialWrite(client, endpoint, query, options) {
  try { return await client.request(endpoint, query, options); }
  catch (error) {
    const detail = error?.detail || {};
    const challenge = error?.code === 'VERIFY_REQUIRED' && /^[a-f0-9]{32}$/i.test(detail.challenge?.id || '') && /^_[A-Za-z0-9_]{1,63}$/.test(detail.challenge?.field || '');
    const rejected = Number.isSafeInteger(detail.serverStatus) && (detail.serverStatus < 0 || detail.serverStatus >= 400);
    const beforeWrite = error?.code === 'ACCOUNT_CHANGED' || error?.code === 'INPUT';
    const unauthorized = error?.code === 'LOGIN_REQUIRED' && detail.status === 401;
    if (!detail.responseInvalid && error?.code !== 'NETWORK' && error?.code !== 'HTTP' && (challenge || rejected || beforeWrite || unauthorized)) throw error;
    throw new ApiError('提交结果尚未确认，请先查看最新内容核对，避免重复发送', 'WRITE_UNCONFIRMED');
  }
}
export function confirmCreatedFeed(result) {
  const id = result?.data?.id;
  if (!['string', 'number'].includes(typeof id) || typeof id === 'number' && !Number.isSafeInteger(id) || !/^[1-9]\d{0,19}$/.test(String(id))) throw new ApiError('服务端未返回有效的发布结果，请先检查你的最新动态，避免重复发布', 'WRITE_UNCONFIRMED');
  return result;
}
export const numericId = value => {
  const id = String(value ?? '');
  if (!/^\d{1,20}$/.test(id)) throw new ApiError('无效的内容编号', 'INPUT');
  return id;
};
const text = (value, max = 4096) => {
  if (typeof value !== 'string' || value.length > max || /[\0\r]/.test(value)) throw new ApiError('输入内容无效', 'INPUT');
  return value;
};
const pageNum = value => Math.max(1, Math.min(1000, Number(value) || 1));
const idList = value => {
  if (value == null || value === '') return '';
  const ids = Array.isArray(value) ? value : text(value, 2200).split(',');
  if (ids.length > 100) throw new ApiError('一次最多选择 100 个收藏单', 'INPUT');
  return [...new Set(ids.map(numericId))].join(',');
};
const binaryFlag = value => {
  if (value === false || value === 0 || value === '0') return '0';
  if (value == null || value === true || value === 1 || value === '1') return '1';
  throw new ApiError('公开状态无效', 'INPUT');
};
export function messagePicture(value) {
  const source = text(value, 2048).trim();
  if (/[\\%]/.test(source) || source.split('/').some(part => part === '.' || part === '..')) throw new ApiError('私信图片路径无效', 'INPUT');
  let path = source;
  if (/^https?:\/\//.test(source)) {
    const url = new URL(source);
    if (!['image.coolapk.com', 'message.coolapk.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) throw new ApiError('私信图片地址无效', 'INPUT');
    path = url.pathname;
  }
  if (!/^\/message\/[A-Za-z0-9_./@-]{1,2000}$/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw new ApiError('私信图片必须使用酷安上传返回的路径', 'INPUT');
  return path;
}
export const feedForm = (message, pic = '') => ({
  id: '', message, type: 'feed', pic, status: 1, publish_status: 0, location: '', long_location: '', latitude: '0.0', longitude: '0.0',
  media_url: '', media_type: 0, media_pic: '', message_title: '', message_brief: '', extra_title: '', extra_url: '', extra_key: '', extra_pic: '', extra_info: '',
  message_cover: '', original_type: 0, is_editInDyh: 0, forwardid: '', fid: '', dyhId: '', targetType: '', productId: '', targetId: '', location_city: '', location_country: '',
  disallow_reply: 0, vote_score: 0, replyWithForward: 0, media_info: '', insert_product_media: 0, is_ks_doc: 0, goods_list_id: '', is_html_article: 0,
});
const feedFieldAliases = {
  publish_status: 'publishStatus', long_location: 'longLocation', media_url: 'mediaUrl', media_type: 'mediaType', media_pic: 'mediaPic',
  message_title: 'messageTitle', message_brief: 'messageBrief', extra_title: 'extraTitle', extra_url: 'extraUrl', extra_key: 'extraKey', extra_pic: 'extraPic', extra_info: 'extraInfo',
  message_cover: 'messageCover', original_type: 'originalType', is_editInDyh: 'isEditInDyh', forwardid: 'forwardId', dyhId: 'dyh_id', targetType: 'target_type',
  productId: 'product_id', targetId: 'target_id', location_city: 'locationCity', location_country: 'locationCountry', disallow_reply: 'disallowReply', vote_score: 'voteScore',
  replyWithForward: 'reply_with_forward', media_info: 'mediaInfo', insert_product_media: 'insertProductMedia', is_ks_doc: 'isKsDoc', goods_list_id: 'goodsListId', is_html_article: 'isHtmlArticle', city_code: 'cityCode',
};
export function sanitizeCookie(value) {
  if (typeof value !== 'string' || value.length > 16000 || /[\r\n\0]/.test(value)) throw new ApiError('Cookie 格式无效', 'INPUT');
  return value.trim().replace(/^Cookie:\s*/i, '');
}
// Match CookieInterceptor.setCookie's java.net.URLEncoder encoding. This
// runtime verification proof is separate from saved account credentials.
const verificationCookieValue = value => encodeURIComponent(value).replace(/[!'()~]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
const mergeVerificationCookie = (cookie, token) => {
  const original = cookie ? sanitizeCookie(cookie) : '';
  const parts = original.split(';').map(part => part.trim()).filter(part => part && part.slice(0, part.indexOf('=')).trim() !== 'validate');
  return [...parts, 'validate=' + verificationCookieValue(token)].join('; ');
};
const publicVerificationOperations = new Set(['publicUserProfile', 'publicUserSpace', 'publicUserQr', 'publicUserFollowNodes', 'publicUserHomepage', 'publicUserTabData']);
export function assertLogin(identity) {
  if (!identity?.uid || !/^\d+$/.test(String(identity.uid)) || ['0', '10000'].includes(String(identity.uid))) throw new ApiError('请先登录酷安账号', 'LOGIN_REQUIRED');
}
export function flattenEntities(data) {
  const result = [];
  function walk(items, depth = 0) {
    if (!Array.isArray(items) || depth > 8) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (/ad|sponsor/i.test(item.entityTemplate || '') || item.entityType === 'ad') continue;
      if (item.entityType === 'card' && Array.isArray(item.entities) && item.entities.length) walk(item.entities, depth + 1);
      else if (item.entityType !== 'card' || item.title || item.description) result.push(item);
    }
  }
  walk(data);
  return result;
}
export function internalPageRoute(value, depth = 0) {
  const source = text(value);
  if (depth > 3) throw new ApiError('栏目地址嵌套过深', 'INPUT');
  if (/^[A-Z][A-Z0-9_]+$/.test(source)) return { endpoint: '/v6/page/dataList', query: { url: source } };
  if (source.startsWith('#/')) { const route = internalPageRoute(source.slice(1), depth + 1); if (['/v6/apk/index', '/v6/apk/giftList'].includes(route.endpoint)) return route; return { endpoint: '/v6/page/dataList', query: { url: source } }; }
  const url = new URL(source, 'https://www.coolapk.com');
  if (url.origin !== 'https://www.coolapk.com' || url.username || url.password || url.port) throw new ApiError('不支持的栏目地址', 'INPUT');
  if (url.pathname === '/page') { const nested = text(url.searchParams.get('url') || ''); const route = internalPageRoute(nested, depth + 1); if (['/v6/apk/index', '/v6/apk/giftList'].includes(route.endpoint)) return route; return { endpoint: '/v6/page/dataList', query: { url: nested } }; }
  try { const homeList = homepageListRoute(url); if (homeList) return { endpoint: homeList.endpoint, query: homeList.query }; }
  catch { throw new ApiError('首页列表参数无效', 'INPUT'); }
  // Only known read-only API routes can be supplied by server-driven page navigation.
  if (!/^\/(main\/(headline|follow|indexV8|updateList)|apk\/(list|ratingList)|feed\/(digestList|statList|statHotList|newestList|editorChoiceList|tagFeedList|multiTagFeedList|ershouList|nodeRatingList|userDeleteFeedList)|product\/(list|newList|categoryList|productList|brandList|feedList)|topic\/(list|tagList|tagFeedList|userFollowTagList)|dyh\/list|page\/dataList)$/.test(url.pathname)) throw new ApiError('此栏目暂不支持，可在官方网页查看', 'UNSUPPORTED');
  return { endpoint: '/v6' + url.pathname, query: Object.fromEntries(url.searchParams) };
}

export class CoolapkClient {
  #verificationCookie = null;
  #publicReader = null;
  #publicReaderOwnerUid = '';
  constructor({ deviceCode = createDeviceCode(), publicDeviceCode = createDeviceCode(), fetchImpl = fetch, cookie = '', identity = null, verificationCookie = null, publicVerificationCookie = null } = {}) {
    this.deviceCode = deviceCode; this.publicDeviceCode = publicDeviceCode; this.fetch = fetchImpl; this.cookie = cookie; this.identity = identity;
    if (verificationCookie?.deviceCode === this.deviceCode && verificationCookie.uid === String(this.identity?.uid || '')) this.setVerificationCookie(verificationCookie);
    if (publicVerificationCookie?.deviceCode === this.publicDeviceCode && publicVerificationCookie.uid === '' && publicVerificationCookie.ownerUid === String(this.identity?.uid || '')) this.getPublicReader().setVerificationCookie(publicVerificationCookie);
  }
  setVerificationCookie({ id, token } = {}) {
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/i.test(id) || typeof token !== 'string' || token.length > 8192 || !token.startsWith(`NEC:${id.slice(0, 8)}:`) || !/^[\x21-\x7e]+$/.test(token.slice(13)) || /[;\\]/.test(token)) throw new ApiError('验证凭证格式无效', 'INPUT');
    this.#verificationCookie = { id, token, deviceCode: this.deviceCode, uid: String(this.identity?.uid || '') };
  }
  getVerificationCookie() {
    const value = this.#verificationCookie;
    if (!value) return null;
    if (value.deviceCode !== this.deviceCode || value.uid !== String(this.identity?.uid || '')) { this.clearVerificationCookie(); return null; }
    return { ...value };
  }
  clearVerificationCookie() { this.#verificationCookie = null; this.#publicReader?.clearVerificationCookie(); }
  getPublicReader() {
    const ownerUid = String(this.identity?.uid || '');
    if (!this.#publicReader || this.#publicReader.deviceCode !== this.publicDeviceCode || this.#publicReaderOwnerUid !== ownerUid) {
      this.#publicReader?.clearVerificationCookie();
      this.#publicReader = new CoolapkClient({ deviceCode: this.publicDeviceCode, fetchImpl: this.fetch });
      this.#publicReaderOwnerUid = ownerUid;
    }
    // Keep the existing, operation-local form/query proof compatibility while
    // storing the API verification Cookie on the actual guest device only.
    this.#publicReader.verification = this.verification;
    return this.#publicReader;
  }
  getVerificationReader(operation) { return publicVerificationOperations.has(operation) ? this.getPublicReader() : this; }
  getPublicVerificationCookie() {
    if (!this.#publicReader) return null;
    if (this.#publicReader.deviceCode !== this.publicDeviceCode || this.#publicReaderOwnerUid !== String(this.identity?.uid || '')) { this.#publicReader.clearVerificationCookie(); return null; }
    const value = this.#publicReader.getVerificationCookie();
    return value ? { ...value, ownerUid: this.#publicReaderOwnerUid } : null;
  }
  requestCookie(cookie = this.cookie) {
    const verificationCookie = this.getVerificationCookie();
    return verificationCookie ? mergeVerificationCookie(cookie, verificationCookie.token) : cookie ? sanitizeCookie(cookie) : '';
  }
  async request(endpoint, query = {}, { method = 'GET', form, cookie = this.cookie } = {}) {
    if (!/^\/v6\/[A-Za-z0-9_/]+$/.test(endpoint)) throw new ApiError('无效接口地址', 'INPUT');
    const url = new URL(endpoint, 'https://api.coolapk.com');
    if (this.verification) {
      if (method === 'GET') query = { ...query, [this.verification.field]: this.verification.token };
      else if (form && !(form instanceof FormData)) form = { ...form, [this.verification.field]: this.verification.token };
      else if (form instanceof FormData) form.set(this.verification.field, this.verification.token);
    }
    for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
    const headers = requestHeaders(this.deviceCode);
    const requestCookie = this.requestCookie(cookie);
    if (requestCookie) headers.Cookie = requestCookie;
    let body;
    if (form instanceof FormData) body = form;
    else if (form) { body = new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v ?? '')])); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    let response;
    try { response = await this.fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError(error.name === 'TimeoutError' ? '请求超时，请稍后重试' : '无法连接酷安，请检查网络后重试', 'NETWORK'); }
    if (!response.ok) throw new ApiError(`酷安服务返回 HTTP ${response.status}`, response.status === 401 ? 'LOGIN_REQUIRED' : 'HTTP', { status: response.status });
    let raw;
    try { raw = await response.text(); } catch { throw new ApiError('酷安响应读取失败，请检查网络后重试', 'NETWORK', { responseInvalid: true }); }
    let json; try { json = JSON.parse(raw); } catch { throw new ApiError('酷安返回了非 JSON 内容，可能需要验证', 'VERIFY_REQUIRED', { responseInvalid: true }); }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ApiError('酷安返回的数据结构异常', 'API_ERROR', { responseInvalid: true });
    const status = json.status ?? json.code;
    if (Number(status) < 0 || Number(status) >= 400 || (json.message && !Object.hasOwn(json, 'data') && status !== 1 && status !== 200)) {
      const message = String(json.message || '酷安暂未接受请求').replace(/[\r\n]/g, ' ').slice(0, 240);
      const code = /登录|login|认证/i.test(message) ? 'LOGIN_REQUIRED' : /验证|captcha|安全|风险/i.test(message) ? 'VERIFY_REQUIRED' : 'API_ERROR';
      let challenge;
      if (code === 'VERIFY_REQUIRED') {
        try { const extra = typeof json.messageExtra === 'string' ? JSON.parse(json.messageExtra) : json.messageExtra; if (extra?.captchaType === 'NEC' && /^[a-f0-9]{32}$/i.test(extra.captchaId)) challenge = { id: extra.captchaId, field: /^_[A-Za-z0-9_]{1,63}$/.test(extra.captchaField) ? extra.captchaField : '_v2_post_token' }; } catch {}
      }
      const serverStatus = Number.isSafeInteger(Number(status)) && status !== null && status !== '' ? Number(status) : undefined;
      throw new ApiError(message, code, { challenge, ...(serverStatus === undefined ? {} : { serverStatus }) });
    }
    if (!Object.hasOwn(json, 'data') && status !== 1 && status !== 200) throw new ApiError('酷安返回的数据结构异常', 'API_ERROR', { responseInvalid: true });
    return json;
  }
  async dispatch(operation, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('请求参数无效', 'INPUT');
    const { catalogOperations, dispatchCatalog } = await import('./catalog.mjs');
    if (catalogOperations.includes(operation)) return dispatchCatalog(this, operation, args);
    const { ACCOUNT_OPERATIONS, dispatchAccount } = await import('./account.mjs');
    if (ACCOUNT_OPERATIONS.includes(operation)) return dispatchAccount(this, operation, args);
    const { COMMUNITY_OPERATIONS, dispatchCommunity } = await import('./community.mjs');
    if (COMMUNITY_OPERATIONS.includes(operation)) return dispatchCommunity(this, operation, args);
    const { LIVE_PHOTO_OPERATIONS, dispatchLivePhoto } = await import('./live-photo.mjs');
    if (LIVE_PHOTO_OPERATIONS.includes(operation)) return dispatchLivePhoto(this, operation, args);
    const { HOME_OPERATIONS, dispatchHome } = await import('./home.mjs');
    if (HOME_OPERATIONS.includes(operation)) return dispatchHome(this, operation, args);
    const { SEARCH_OPERATIONS, dispatchSearch } = await import('./search.mjs');
    if (SEARCH_OPERATIONS.includes(operation)) return dispatchSearch(this, operation, args);
    const { DOWNLOAD_OPERATIONS, dispatchDownload } = await import('./download.mjs');
    if (DOWNLOAD_OPERATIONS.includes(operation)) return dispatchDownload(this, operation, args);
    const { GOODS_OPERATIONS, dispatchGoods } = await import('./goods.mjs');
    if (GOODS_OPERATIONS.includes(operation)) return dispatchGoods(this, operation, args);
    const { SECONDHAND_OPERATIONS, dispatchSecondhand } = await import('./secondhand.mjs');
    if (SECONDHAND_OPERATIONS.includes(operation)) return dispatchSecondhand(this, operation, args);
    const { APP_DISCOVERY_OPERATIONS, dispatchAppDiscovery } = await import('./app-discovery.mjs');
    if (APP_DISCOVERY_OPERATIONS.includes(operation)) return dispatchAppDiscovery(this, operation, args);
    const { USER_DISCOVERY_OPERATIONS, dispatchUserDiscovery } = await import('./user-discovery.mjs');
    if (USER_DISCOVERY_OPERATIONS.includes(operation)) return dispatchUserDiscovery(this, operation, args);
    const { PERSONAL_OPERATIONS, dispatchPersonal } = await import('./personal.mjs');
    if (PERSONAL_OPERATIONS.includes(operation)) return dispatchPersonal(this, operation, args);
    const { IMAGE_SETTINGS_OPERATIONS, dispatchImageSettings } = await import('./image-settings.mjs');
    if (IMAGE_SETTINGS_OPERATIONS.includes(operation)) return dispatchImageSettings(this, operation, args);
    const { ACCOUNT_SETTINGS_OPERATIONS, dispatchAccountSettings } = await import('./account-settings.mjs');
    if (ACCOUNT_SETTINGS_OPERATIONS.includes(operation)) return dispatchAccountSettings(this, operation, args);
    const { CREATION_OPERATIONS, dispatchCreation } = await import('./creation.mjs');
    if (CREATION_OPERATIONS.includes(operation)) return dispatchCreation(this, operation, args);
    const { SECONDHAND_PUBLISHING_OPERATIONS, dispatchSecondhandPublishing } = await import('./secondhand-publishing.mjs');
    if (SECONDHAND_PUBLISHING_OPERATIONS.includes(operation)) return dispatchSecondhandPublishing(this, operation, args);
    const page = pageNum(args.page);
    const cursors = { page, ...(args.firstItem ? { firstItem: text(args.firstItem, 120) } : {}), ...(args.lastItem ? { lastItem: text(args.lastItem, 120) } : {}), ...(args.pageContext ? { pageContext: text(args.pageContext, 2000) } : {}) };
    let result;
    switch (operation) {
      case 'init': return this.request('/v6/main/init');
      case 'home': result = await this.request('/v6/main/indexV8', cursors); break;
      case 'followingFeeds': assertLogin(this.identity); result = await this.request('/v6/page/dataList', { url: 'V15_HOME_TAB_FOLLOW', title: '关注', ...cursors }); break;
      case 'page': { const route = internalPageRoute(args.url); result = await this.request(route.endpoint, { ...route.query, ...cursors }); break; }
      case 'rank': {
        const ranks = { week: '#/feed/statList?statType=7days&sortField=likenum', day: '#/feed/statHotList?period=24h', month: '#/feed/statList?statType=30days&sortField=likenum', picture: '#/feed/statList?statType=30days&sortField=likenum&type=8', favorite: '#/feed/statList?statType=7days&sortField=favnum', index: '#/feed/statList?statType=7days&sortField=detailnum' };
        if (args.type != null && !Object.hasOwn(ranks, args.type)) throw new ApiError('榜单类型无效', 'INPUT');
        result = await this.request('/v6/page/dataList', { url: ranks[args.type || 'week'], ...((args.type || 'week') === 'week' ? { title: '热门' } : {}), ...cursors }); break;
      }
      case 'search': {
        const requested = args.type || 'all', alias = { topic: 'feedTopic', dyh: 'dyhMix', question: 'ask', answer: 'ask' };
        const type = alias[requested] || requested;
        if (!['all', 'feed', 'user', 'feedTopic', 'apk', 'game', 'product', 'ershou', 'ask', 'dyhMix', 'album', 'goods', 'goods_list'].includes(type)) throw new ApiError('不支持的搜索类别', 'INPUT');
        const query = { type, searchValue: text(args.query, 200), show_flag: 1, showAnonymous: -1, ...cursors };
        if (['feed', 'ask'].includes(type)) { query.feedType = requested === 'question' || requested === 'answer' ? requested : 'all'; query.isStrict = 0; if (type === 'feed') { query.pageType = 'search'; query.sort = 'default'; } }
        if (type === 'ershou') Object.assign(query, { sort: '', status: 1, deal_type: 'all', city_code: '', is_link: '', ershou_type: '', product_id: '', tags: '' });
        result = await this.request('/v6/search', query); break;
      }
      case 'hotSearch': result = await this.request('/v6/search', { type: 'hotSearch', returnType: 'all', refresh: 0 }); break;
      case 'detail': return this.request('/v6/feed/detail', { id: numericId(args.id) }, { method: 'POST', form: { trace: '' } });
      case 'replyDetail': return this.request('/v6/feed/replyDetail', { id: numericId(args.id) });
      case 'editableFeed': assertLogin(this.identity); return this.editableFeed(numericId(args.id));
      case 'replies': result = await this.request('/v6/feed/replyList', { id: numericId(args.id), listType: args.sort === 'popular' ? 'popular' : 'lastupdate_desc', discussMode: 1, feedType: 'feed', blockStatus: 0, ...cursors }); break;
      case 'hotReplies': result = await this.request('/v6/feed/hotReplyList', { id: numericId(args.id), page, discussMode: 1 }); break;
      case 'subReplies': result = await this.request('/v6/feed/replyList', { id: numericId(args.rid), listType: '', feedType: 'feed_reply', discussMode: 0, blockStatus: 0, fromFeedAuthor: 0, ...cursors }); break;
      case 'user': return this.request('/v6/user/space', { uid: numericId(args.uid) });
      case 'userFeeds': result = await this.request(`/v6/user/${args.type === 'favorite' ? 'favList' : args.type === 'like' ? 'likeList' : 'feedList'}`, { uid: numericId(args.uid), isIncludeTop: 1, ...cursors }); break;
      case 'userFollows': result = await this.request(`/v6/user/${args.type === 'fans' ? 'fansList' : 'followList'}`, { uid: numericId(args.uid), ...cursors }); break;
      case 'topic': return this.request('/v6/topic/newTagDetail', { tag: text(args.tag, 200) });
      case 'topicFeeds': result = await this.request('/v6/topic/tagFeedList', { tag: text(args.tag, 200), listType: args.sort === 'hot' ? 'hot' : 'lastupdate_desc', blockStatus: 0, ...cursors }); break;
      case 'product': return this.request('/v6/product/detail', { id: numericId(args.id) });
      case 'productFeeds': result = await this.request('/v6/page/dataList', { url: '/page?url=/product/feedList', id: numericId(args.id), type: 'feed', listType: 'lastupdate_desc', ...cursors }); break;
      case 'app': return this.request('/v6/apk/detail', { id: text(String(args.id), 200), installed: 0 }, { method: 'POST', form: { extraAnalysisData: '' } });
      case 'appFeeds': result = await this.request('/v6/apk/commentList', { id: text(String(args.id), 200), ...cursors }); break;
      case 'collections': assertLogin(this.identity); result = await this.request('/v6/collection/list', { uid: this.identity.uid, showDefault: 1, firstItem: '', lastItem: '', ...cursors }); break;
      case 'collection': return this.request('/v6/collection/detail', { id: numericId(args.id) });
      case 'collectionStatus': {
        assertLogin(this.identity);
        result = await this.request('/v6/collection/list', { uid: '', id: numericId(args.id), type: 'feed', showDefault: 1, firstItem: '', lastItem: '', ...cursors });
        const collections = Array.isArray(result.data) ? result.data : [result.data?.entities, result.data?.list, result.data?.rows, result.data?.data].find(Array.isArray);
        if (!collections) throw new ApiError('酷安返回的收藏单结构异常', 'API_ERROR');
        result = { ...result, data: collections };
        break;
      }
      case 'collectionFeeds': result = await this.request('/v6/collection/itemlist', { id: numericId(args.id), listType: 'allFeedType', ...cursors }); break;
      case 'notificationCount': assertLogin(this.identity); return this.request('/v6/notification/checkCount');
      case 'clearNotificationCount': {
        assertLogin(this.identity);
        if (!['feed', 'message', 'all'].includes(args.type)) throw new ApiError('通知类别无效', 'INPUT');
        return this.request('/v6/notification/clearCount', { type: args.type }, { method: 'POST' });
      }
      case 'notifications': {
        assertLogin(this.identity);
        const type = ['list', 'atMeList', 'atCommentMeList', 'feedLikeList', 'contactsFollowList'].includes(args.type) ? args.type : 'list';
        result = await this.request(`/v6/notification/${type}`, cursors); break;
      }
      case 'messages': assertLogin(this.identity); result = await this.request('/v6/message/list', cursors); break;
      case 'chat': assertLogin(this.identity); result = await this.request('/v6/message/chat', { ukey: text(args.ukey, 160), ...cursors }); break;
      case 'messageImage': { assertLogin(this.identity); const { fetchMessageImage } = await import('./images.mjs'); return fetchMessageImage(this, numericId(args.id)); }
      case 'checkLogin': return this.request('/v6/account/checkLoginInfo', { checkInit: 1 });
      case 'uploadImage': { const { uploadImage } = await import('./upload.mjs'); return uploadImage(this, args); }
      case 'uploadVideo': { const { uploadVideo } = await import('./video.mjs'); return uploadVideo(this, args); }
      case 'publishAdvanced': { const { publishAdvanced } = await import('./publishing.mjs'); return publishAdvanced(this, args); }
      case 'editArticle': { const { editArticle } = await import('./publishing.mjs'); return editArticle(this, args); }
      case 'video': return this.request('/v6/player/getUrl', {}, { method: 'POST', form: { params: text(args.params, 10000) } });
      case 'action': return this.action(args);
      default: throw new ApiError('不支持的操作', 'INPUT');
    }
    const rawItems = Array.isArray(result.data) ? result.data : result.data && ['entities', 'list', 'rows', 'items', 'data'].map(key => result.data[key]).find(Array.isArray);
    if (!rawItems) throw new ApiError('酷安返回的列表结构异常，请刷新后重试', 'API_ERROR');
    const data = flattenEntities(rawItems);
    return { ...result, data, ...(['home', 'page'].includes(operation) ? { surfaceItems: rawItems } : {}), rawCount: rawItems.length, firstItem: result.firstItem || String(data[0]?.entityId ?? data[0]?.id ?? ''), lastItem: result.lastItem || String(data.at(-1)?.entityId ?? data.at(-1)?.id ?? ''), hasMore: result.hasMore ?? rawItems.length > 0 };
  }
  async action(args) {
    assertLogin(this.identity);
    const id = args.id != null ? numericId(args.id) : null;
    switch (args.type) {
      case 'like': case 'unlike': case 'likeReply': case 'unLikeReply': return this.request(`/v6/feed/${args.type}`, { id }, { method: 'POST', form: {} });
      case 'favorite': case 'unFavorite': return this.request(`/v6/feed/${args.type}`, { id });
      case 'follow': return this.request('/v6/user/follow', { uid: numericId(args.uid) }, { method: 'POST', form: {} });
      case 'unfollow': return this.request('/v6/user/unfollow', { uid: numericId(args.uid) }, { method: 'POST' });
      case 'reply': {
        const message = text(args.message, 10000).trim();
        const pic = args.pic ? await this.validatePictures(args.pic) : '';
        if (!message && !pic) throw new ApiError('评论不能为空', 'INPUT');
        return requestSocialWrite(this, '/v6/feed/reply', { id: args.rid ? numericId(args.rid) : numericId(args.id), type: args.rid ? 'reply' : 'feed' }, { method: 'POST', form: { message, ...(pic ? { pic } : {}) } });
      }
      case 'publish': case 'forward': {
        const message = text(args.message, 10000).trim();
        if (!message && !args.pic) throw new ApiError('动态内容不能为空', 'INPUT');
        if ([...message].length > 1000) throw new ApiError('普通动态不能超过 1000 字', 'INPUT');
        const form = { ...feedForm(message, args.pic ? await this.validatePictures(args.pic) : ''), forwardid: args.type === 'forward' ? numericId(args.id) : '' };
        return confirmCreatedFeed(await requestSocialWrite(this, '/v6/feed/createFeed', {}, { method: 'POST', form }));
      }
      case 'editFeed': return this.updateFeed(numericId(args.id), args);
      case 'deleteFeed': case 'deleteReply': {
        const targetId = numericId(args.id);
        const detail = args.type === 'deleteFeed'
          ? await this.request('/v6/feed/detail', { id: targetId }, { method: 'POST', form: { trace: '' } })
          : await this.request('/v6/feed/replyDetail', { id: targetId });
        this.assertOwnRecord(detail.data, targetId);
        return this.request(`/v6/feed/${args.type}`, { id: targetId }, { method: 'POST' });
      }
      case 'createCollection': case 'updateCollection': {
        const title = text(args.title, 100).trim(), description = text(args.description ?? '', 2000).trim();
        if (!title) throw new ApiError('收藏单标题不能为空', 'INPUT');
        const { officialImageUrl } = await import('./upload.mjs');
        const pic = args.cover ? officialImageUrl(text(args.cover, 2048)) : '';
        const isOpen = binaryFlag(args.isOpen);
        if (args.type === 'updateCollection') return this.request('/v6/collection/update', {}, { method: 'POST', form: { id: numericId(args.id), title, description, pic, isOpen } });
        const sourceId = args.sourceId == null || args.sourceId === '' ? '' : numericId(args.sourceId);
        const form = new FormData();
        for (const [key, value] of Object.entries({ isOpen, pic, description, title, sourceId })) form.set(key, value);
        return this.request('/v6/collection/create', {}, { method: 'POST', form });
      }
      case 'deleteCollection': return this.request('/v6/collection/delete', {}, { method: 'POST', form: { id: numericId(args.id) } });
      case 'updateCollectionItems': {
        const collectionIds = idList(args.collectionIds), cancelIds = idList(args.cancelIds);
        if (!collectionIds && !cancelIds) throw new ApiError('请选择要修改的收藏单', 'INPUT');
        if (args.feedType != null && args.feedType !== 'feed') throw new ApiError('目前仅支持收藏动态', 'INPUT');
        return this.request('/v6/collection/addItem', {}, { method: 'POST', form: { id: collectionIds, cancelId: cancelIds, targetId: numericId(args.targetId), type: 'feed', trace: text(args.trace ?? '', 1000) } });
      }
      case 'removeCollectionItem': return this.request('/v6/collection/removeItem', {}, { method: 'POST', form: { itemId: numericId(args.itemId) } });
      case 'clearCollectionInvalid': return this.request('/v6/collection/removeUnUseItem', {}, { method: 'POST', form: { colId: numericId(args.id) } });
      case 'followCollection': case 'unfollowCollection': case 'likeCollection': case 'unlikeCollection': {
        const endpoint = { followCollection: 'follow', unfollowCollection: 'unFollow', likeCollection: 'like', unlikeCollection: 'unLike' }[args.type];
        return this.request(`/v6/collection/${endpoint}`, { id: numericId(args.id) });
      }
      case 'sendMessage': {
        const message = text(args.message ?? '', 10000).trim(), pic = args.pic ? messagePicture(args.pic) : '';
        if (!message && !pic) throw new ApiError('消息不能为空', 'INPUT');
        const form = new FormData();
        for (const [key, val] of Object.entries({ message, message_pic: pic, message_extra: '' })) form.set(key, val);
        return requestSocialWrite(this, '/v6/message/send', { uid: numericId(args.uid), quick_reply: 1 }, { method: 'POST', form });
      }
      default: throw new ApiError('不支持的互动操作', 'INPUT');
    }
  }
  assertOwnRecord(record, id) {
    if (!record || String(record.id) !== id) throw new ApiError('酷安没有返回匹配的内容', 'API_ERROR');
    const uid = record.uid ?? record.userInfo?.uid ?? record.user?.uid;
    if (String(uid) !== String(this.identity.uid)) throw new ApiError('只能修改或删除当前账号的内容', 'INPUT');
  }
  async editableFeed(id) {
    const result = await this.request('/v6/feed/changeDetail', { id, rid: '', noticeId: '', fromApi: '' });
    this.assertOwnRecord(result.data, id);
    return result;
  }
  async updateFeed(id, args) {
    const message = text(args.message, 10000).trim(), pic = args.pic ? await this.validatePictures(args.pic) : '';
    if (!message && !pic) throw new ApiError('动态内容不能为空', 'INPUT');
    if ([...message].length > 1000) throw new ApiError('普通动态不能超过 1000 字', 'INPUT');
    const result = await this.editableFeed(id), original = result.data;
    const allowed = original.enableModify ?? original.enable_modify;
    if (allowed != null && Number(allowed) !== 1) throw new ApiError('此动态当前不允许编辑或编辑次数已用尽', 'UNSUPPORTED');
    if ((original.feedType ?? original.feed_type ?? 'feed') !== 'feed' || Number(original.isHtmlArticle ?? original.is_html_article ?? 0) !== 0 || Number(original.mediaType ?? original.media_type ?? 0) !== 0 || (original.mediaUrl ?? original.media_url)) throw new ApiError('目前支持重新编辑普通图文动态，请在手机客户端编辑文章、视频和特殊动态', 'UNSUPPORTED');
    const form = feedForm(message, pic);
    for (const key of [...Object.keys(form), 'province', 'city_code']) {
      if (['id', 'message', 'pic', 'type', 'status'].includes(key)) continue;
      const value = original[key] ?? original[feedFieldAliases[key]];
      if (value != null) {
        const serialized = typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'object' ? JSON.stringify(value) : String(value);
        form[key] = text(serialized, 20000);
      }
    }
    form.id = id;
    const updated = await this.request('/v6/feed/changeFeed', {}, { method: 'POST', form });
    if (String(updated.data?.id) !== id) throw new ApiError('服务端未返回修改后的动态，请刷新确认', 'API_ERROR');
    return updated;
  }
  async validatePictures(value) {
    const { officialImageUrl } = await import('./upload.mjs');
    const pics = text(value, 20000).split(',');
    if (pics.length > 9) throw new ApiError('最多发布 9 张图片', 'INPUT');
    return pics.map(officialImageUrl).join(',');
  }
}
