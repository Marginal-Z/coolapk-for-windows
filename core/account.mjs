import { ApiError, assertLogin, numericId, sanitizeCookie, flattenEntities } from './client.mjs';
import { imageFormat, officialImageUrl } from './upload.mjs';
import { APK_PROFILE, requestHeaders } from './auth.mjs';

export const ACCOUNT_OPERATIONS = Object.freeze(['accountOverview', 'accountProfile', 'accountProfileUpdate', 'accountAvatar', 'accountCover', 'accountUsers', 'accountRelationship', 'accountPlugins', 'accountPluginSave', 'accountPluginClaim', 'accountCards', 'accountCardManager', 'accountCardSave', 'accountChannels', 'accountChannelSave', 'accountHistory', 'accountQr', 'accountFollowNodes', 'accountTabData', 'accountSpamFeeds']);
const input = (value, max, required = false) => { if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value) || required && !value.trim()) throw new ApiError('输入内容无效', 'INPUT'); return value; };
const page = value => { const n = Number(value ?? 1); if (!Number.isSafeInteger(n) || n < 1 || n > 1000) throw new ApiError('页码无效', 'INPUT'); return n; };
const zeroId = value => { if (String(value) === '0') return '0'; return numericId(value); };
const bool = value => { if (typeof value !== 'boolean') throw new ApiError('状态参数无效', 'INPUT'); return value ? 1 : 0; };
const fieldNames = ['uid', 'username', 'userName', 'displayUserName', 'userAvatar', 'avatar', 'cover', 'coverUrl', 'userCover', 'background', 'bio', 'signature', 'sign', 'gender', 'birthyear', 'birthmonth', 'birthday', 'province', 'city', 'zodiacSign', 'level'];
const fields = (value, names) => Object.fromEntries(names.filter(key => value?.[key] != null).map(key => [key, value[key]]));
function list(result, mapper = row => row) {
  if (!Array.isArray(result.data)) throw new ApiError('服务器未返回有效列表', 'API_ERROR');
  const data = flattenEntities(result.data).map(mapper).filter(Boolean);
  return { ...result, data, firstItem: String(data[0]?.id ?? data[0]?.entityId ?? ''), lastItem: String(data.at(-1)?.id ?? data.at(-1)?.entityId ?? ''), hasMore: data.length > 0 };
}
const cursors = args => ({ page: page(args.page), ...(args.firstItem ? { firstItem: input(String(args.firstItem), 120) } : {}), ...(args.lastItem ? { lastItem: input(String(args.lastItem), 120) } : {}) });
async function accountQr(client, uid) {
  const url = new URL('/v6/user/qrImage', 'https://api.coolapk.com'); url.searchParams.set('uid', uid);
  const headers = { ...requestHeaders(client.deviceCode), Accept: 'image/*', Cookie: sanitizeCookie(client.cookie) };
  let response;
  try { response = await client.fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError('二维码加载失败，请检查网络后重试', 'NETWORK'); }
  if (!response.ok) throw new ApiError('二维码暂不可用，请检查登录状态后重试', response.status === 401 ? 'LOGIN_REQUIRED' : 'API_ERROR');
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) || !response.body) throw new ApiError('服务器未返回二维码图片', 'API_ERROR');
  const limit = 4 * 1024 ** 2; if (Number(response.headers.get('content-length')) > limit) throw new ApiError('二维码图片超过加载限制', 'API_ERROR');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new ApiError('二维码图片超过加载限制', 'API_ERROR'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  if (!size) throw new ApiError('二维码图片为空，请稍后重试', 'API_ERROR');
  const bytes = Buffer.concat(chunks);
  try { if (imageFormat(bytes)[0] !== mime) throw new Error('Image type mismatch'); }
  catch { throw new ApiError('服务器返回的二维码图片格式无效', 'API_ERROR'); }
  return { data: `data:${mime};base64,${bytes.toString('base64')}` };
}
export const ACCOUNT_CONTENT_TABS = Object.freeze(['feed', 'reply', 'collection', 'goods_store', 'goods_rank', 'developer_apps', 'apk_follow', 'article', 'qa', 'album', 'like', 'discovery', 'coolpic', 'rating', 'goods', 'ershou', 'recycle']);
async function accountTabData(client, uid, args) {
  if (!ACCOUNT_CONTENT_TABS.includes(args.tab)) throw new ApiError('个人内容类型无效', 'INPUT');
  const direct = { feed: 'user/feedList', reply: 'user/replyList', collection: 'collection/list', goods_store: 'goods/goodsStoreItemList', goods_rank: 'goodsList/list', developer_apps: 'apk/developerAppList', apk_follow: 'user/apkFollowList', article: 'user/htmlFeedList', qa: 'user/questionAndAnswerList', album: 'user/albumList', like: 'user/likeList', discovery: 'user/discoveryList' };
  let result;
  if (Object.hasOwn(direct, args.tab)) result = await client.request('/v6/' + direct[args.tab], { uid, ...cursors(args), ...(args.tab === 'feed' ? { showAnonymous: 0, isIncludeTop: 1, showDoing: 1 } : {}) });
  else {
    const targets = { coolpic: ['#/feed/userCoolPictureFeedList?fragmentTemplate=flex', '酷图'], goods: ['#/goods/goodsFeedList?type=default&fragmentTemplate=flex', '好物'], ershou: ['#/feed/userErshouList?fragmentTemplate=flex&ershouStatus=userAll', '二手'], recycle: ['#/feed/userDeleteFeedList', '回收站'] };
    let descriptor = targets[args.tab];
    if (args.tab === 'rating') { const target = args.ratingTarget ?? 'all'; if (!['all', 'apk', 'product'].includes(target)) throw new ApiError('评分对象无效', 'INPUT'); descriptor = [`#/feed/nodeRatingList?uid=${uid}&targetType=${target}&parseRatingToFeed=1`, '评分']; }
    const [base, title] = descriptor, url = base.includes('uid=') ? base : base + (base.includes('?') ? '&' : '?') + 'uid=' + uid;
    result = await client.request('/v6/page/dataList', { url, title, subTitle: '', pageContext: 'user_space', ...cursors(args) });
  }
  if (!Array.isArray(result.data) && Array.isArray(result.data?.entities)) result = { ...result, data: result.data.entities };
  return list(result);
}
function profileChange(args) {
  if (args.field === 'bio') return { key: 'bio', value: input(args.value, 60) };
  if (args.field === 'gender' && ['-1', '0', '1'].includes(String(args.value))) return { key: 'gender', value: String(args.value) };
  if (args.field === 'birthday') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(args.value));
    if (!match) throw new ApiError('生日格式应为 YYYY-MM-DD', 'INPUT');
    const [year, month, day] = match.slice(1).map(Number), date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date > new Date()) throw new ApiError('生日日期无效', 'INPUT');
    return { key: '', value: JSON.stringify({ birthyear: year, birthmonth: month, birthday: day }) };
  }
  if (args.field === 'location') return { key: '', value: JSON.stringify({ province: input(args.province, 60, true).trim(), city: input(args.city, 60, true).trim() }) };
  throw new ApiError('此资料字段没有可靠的原生修改契约', 'UNSUPPORTED');
}
function configIds(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some(n => !Number.isSafeInteger(n) || n < 0)) throw new ApiError('卡片编号列表无效', 'INPUT');
  return value;
}
const pluginFields = ['id', 'title', 'plugin_type', 'avatar_plugin', 'avatar_plugin_logo', 'feed_plugin', 'feed_plugin_logo', 'can_use', 'expired', 'day_left', 'expire_days', 'is_get', 'get_url', 'getFuncStr', 'get_start_time', 'get_expire_time', 'use_start_time', 'expire_time', 'get_start_time_txt', 'get_expire_time_txt', 'use_start_time_txt', 'expire_time_txt'];
async function pluginRequest(client, path, query, form) {
  const url = new URL(`https://m.coolapk.com/mp/userPlugin/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const cookies = new Map(sanitizeCookie(client.cookie).split(';').map(part => { const i = part.indexOf('='); return i < 1 ? ['', ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()]; }).filter(([name]) => name));
  if (!cookies.size) throw new ApiError('请重新登录后管理挂件', 'LOGIN_REQUIRED');
  if (!['getPlugin', 'savePlugin'].includes(path)) cookies.delete('ddid');
  const did = Buffer.from(client.deviceCode.split('').reverse().join(''), 'base64').toString().split(';')[0].trim();
  if (did && did.length <= 256 && !/[\x00-\x20\x7f]/.test(did)) cookies.set('DID', encodeURIComponent(did));
  const headers = { 'User-Agent': `Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 (#Build; Samsung; SM-S9180; UP1A.231005.007; Android) +CoolMarket/${APK_PROFILE.version}-${APK_PROFILE.code}-universal`, 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://m.coolapk.com/mp/userPlugin/myPlugin?autoTheme=1', Origin: 'https://m.coolapk.com', Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  let response;
  try { response = await client.fetch(url, { method: form ? 'POST' : 'GET', headers, body: form ? new URLSearchParams(form) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') throw error; throw new ApiError('挂件服务连接失败，请检查网络或重试', 'NETWORK'); }
  if (!response.ok) throw new ApiError(`挂件服务返回 HTTP ${response.status}`, response.status === 401 ? 'LOGIN_REQUIRED' : 'HTTP');
  let raw; try { raw = await response.json(); } catch { throw new ApiError('挂件服务未返回有效 JSON，请重新登录或完成官方验证', 'VERIFY_REQUIRED'); }
  if (!raw || typeof raw !== 'object' || Number(raw.status ?? 200) !== 200 && !raw.forwardUrl) throw new ApiError(String(raw?.message || '挂件请求未成功').slice(0, 240), 'API_ERROR');
  const data = fields(raw, ['avatarPluginUrl', 'feedPluginUrl', 'deviceTitle', 'status', 'message', 'forwardUrl']);
  for (const key of ['avatarPluginList', 'feedPluginList', 'pluginList']) if (Array.isArray(raw[key])) data[key] = raw[key].map(row => fields(row, pluginFields));
  for (const key of ['selectedAvatarPluginRow', 'selectedFeedPluginRow']) if (raw[key] && typeof raw[key] === 'object') data[key] = fields(raw[key], pluginFields);
  if (['store', 'myPlugin'].includes(path) && !['avatarPluginList', 'feedPluginList', 'pluginList'].some(key => Array.isArray(data[key]))) throw new ApiError('挂件列表未返回，请重新登录后重试', 'API_ERROR');
  if (['getPlugin', 'savePlugin'].includes(path) && Number(data.status) !== 200 && !data.forwardUrl) throw new ApiError('挂件服务未确认操作成功', 'API_ERROR');
  return { data };
}

export async function dispatchAccount(client, operation, args = {}) {
  if (!ACCOUNT_OPERATIONS.includes(operation)) return undefined;
  assertLogin(client.identity);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ApiError('请求参数无效', 'INPUT');
  const self = numericId(client.identity.uid);
  switch (operation) {
    case 'accountQr': return accountQr(client, self);
    case 'accountOverview': {
      const result = await client.request('/v6/user/space', { uid: self });
      if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new ApiError('我的主页未返回有效数据', 'API_ERROR');
      const profile = { ...result.data.userInfo, ...result.data };
      for (const uid of [result.data.uid, result.data.userInfo?.uid]) if (uid != null && String(uid) !== self) throw new ApiError('我的主页与当前账号不匹配', 'API_ERROR');
      const publicFields = fields(profile, [...fieldNames, 'feed', 'follow', 'fans']);
      // Do not forward the raw envelope or nested objects from user/space.
      const stringLimits = { uid: 20, username: 200, userName: 200, displayUserName: 200, bio: 1000, signature: 1000, sign: 1000, province: 100, city: 100, zodiacSign: 100 };
      return { data: Object.fromEntries(Object.entries(publicFields).filter(([key, value]) => typeof value === 'string' && value.length <= (stringLimits[key] || 4096) || typeof value === 'number' && Number.isSafeInteger(value))) };
    }
    case 'accountFollowNodes': return list(await client.request('/v6/user/forumFollowList', { uid: self, page: page(args.page), firstItem: input(String(args.firstItem || ''), 120), lastItem: input(String(args.lastItem || ''), 120) }));
    case 'accountTabData': return accountTabData(client, self, args);
    case 'accountSpamFeeds': return list(await client.request('/v6/feed/spamFeedList', { type: 'feed', channel: 'feed', spamType: 'feed', subType: 'feed', ...cursors(args) }), row => ({ ...row, entityType: row.entityType || 'feed' }));
    case 'accountProfile': { const result = await client.request('/v6/user/profile', { uid: self, installTime: 0, showSettingTab: 1 }); if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new ApiError('个人资料未返回有效数据', 'API_ERROR'); const profile = { ...result.data.userInfo, ...result.data }; if (profile.uid != null && String(profile.uid) !== self) throw new ApiError('个人资料与当前账号不匹配', 'API_ERROR'); return { ...result, data: fields(profile, fieldNames) }; }
    case 'accountProfileUpdate': return client.request('/v6/account/changeProfile', {}, { method: 'POST', form: profileChange(args) });
    case 'accountAvatar': {
      if (!(args.bytes instanceof Uint8Array) && !Array.isArray(args.bytes)) throw new ApiError('请提供头像图片', 'INPUT');
      const bytes = Buffer.from(args.bytes); if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new ApiError('头像不能超过 15 MB', 'INPUT');
      const [mime, ext] = imageFormat(bytes), form = new FormData(); form.append('imgFile', new Blob([bytes], { type: mime }), `avatar.${ext}`);
      return client.request('/v6/account/changeAvatar', {}, { method: 'POST', form });
    }
    case 'accountCover': return client.request('/v6/account/changeAvatarCover', {}, { method: 'POST', form: { url: officialImageUrl(input(args.url, 4096, true)) } });
    case 'accountUsers': {
      const routes = { black: 'blackList', ignore: 'ignoreList', limit: 'limitList', follow: 'followList', fans: 'fansList', remarks: 'remarkList' };
      if (!Object.hasOwn(routes, args.type)) throw new ApiError('用户列表类型无效', 'INPUT');
      const type = args.type, result = await client.request('/v6/user/' + routes[type], { ...cursors(args), ...(['follow', 'fans', 'remarks'].includes(type) ? { uid: self } : {}), ...(type === 'fans' ? { isIncludeTop: 1 } : {}) });
      if (type === 'remarks' && result.data && !Array.isArray(result.data)) for (const key of ['data', 'list', 'items', 'entities', 'rows', 'userRemarkList', 'user_remark_list', 'remarkList', 'remarks']) if (Array.isArray(result.data[key])) { result.data = result.data[key]; break; }
      return list(result, row => {
        const info = type === 'fans' ? row.userInfo || row.fUserInfo || {} : row.fUserInfo || row.userInfo || {};
        const uid = String(type === 'remarks' ? row.remarkUid || row.remark_uid || row.uid || info.uid || '' : info.uid || row.fuid || row.uid || '');
        if (!/^\d+$/.test(uid) || ['follow', 'fans'].includes(type) && uid === self) return null;
        return { ...row, ...info, entityType: 'user', uid, username: info.username || info.displayUserName || row.fusername || row.username || '酷友', userAvatar: info.userAvatar || info.avatar || row.fUserAvatar || row.userAvatar || '', remarkName: row.remarkName || row.remark_name || info.remarkName || '', id: row.id ?? uid };
      });
    }
    case 'accountRelationship': {
      const uid = numericId(args.uid); if (uid === self) throw new ApiError('不能对自己执行此关系操作', 'INPUT');
      const getRoutes = { black: 'addToBlackList', unblack: 'removeFromBlackList', ignore: 'addToIgnoreList', unignore: 'removeFromIgnoreList', unfollow: 'unfollow' };
      if (Object.hasOwn(getRoutes, args.action)) return client.request('/v6/user/' + getRoutes[args.action], { uid });
      if (args.action === 'special') return client.request('/v6/user/specialFollowUser', { uid, special: bool(args.value) }, { method: 'POST', form: {} });
      if (args.action === 'cancelFan') return client.request('/v6/user/cancelFollower', { uid }, { method: 'POST', form: {} });
      if (args.action === 'follow') return client.request('/v6/user/follow', { uid }, { method: 'POST', form: {} });
      if (args.action === 'remark') return client.request('/v6/user/updateRemark', {}, { method: 'POST', form: { uid, name: input(args.name, 30) } });
      throw new ApiError('关系操作无效', 'INPUT');
    }
    case 'accountPlugins': if (![0, 1].includes(Number(args.type ?? 0))) throw new ApiError('挂件类型无效', 'INPUT'); else return pluginRequest(client, args.store ? 'store' : 'myPlugin', { page: page(args.page), type: Number(args.type ?? 0) });
    case 'accountPluginSave': return pluginRequest(client, 'savePlugin', {}, { avatar_id: zeroId(args.avatarId), feed_id: zeroId(args.feedId) });
    case 'accountPluginClaim': { const id = numericId(args.id); if (!Number(id)) throw new ApiError('挂件编号无效', 'INPUT'); return pluginRequest(client, 'getPlugin', { id }); }
    case 'accountCards': return client.request('/v6/account/loadConfig', { key: 'my_page_card_config', refresh: args.refresh ? 1 : 0 });
    case 'accountCardManager': return client.request('/v6/account/myPageCardManage', { key: 'my_page_card_config' });
    case 'accountCardSave': {
      const show = configIds(args.show), hide = configIds(args.hide); if (new Set([...show, ...hide]).size !== show.length + hide.length) throw new ApiError('卡片配置包含重复编号', 'INPUT');
      const result = await client.request('/v6/account/updateConfig', {}, { method: 'POST', form: { key: 'my_page_card_config', value: JSON.stringify({ show, hide }) } });
      if (String(result.data) !== '1') throw new ApiError('服务器未确认卡片设置已保存', 'API_ERROR'); return result;
    }
    case 'accountChannels': return client.request('/v6/account/loadConfig', { key: 'home_tab_config', reSet: args.reset ? 1 : 0 });
    case 'accountChannelSave': {
      if (!Array.isArray(args.channels) || !args.channels.length || args.channels.length > 100) throw new ApiError('首页频道配置无效', 'INPUT');
      const channels = args.channels.map(row => ({ id: numericId(row?.id), title: input(row.title, 100, true), page_visibility: String(bool(row.visible)) }));
      if (new Set(channels.map(row => row.id)).size !== channels.length) throw new ApiError('频道编号重复', 'INPUT');
      return client.request('/v6/account/updateConfig', {}, { method: 'POST', form: { home_tab_config: JSON.stringify(channels) } });
    }
    case 'accountHistory': return list(await client.request('/v6/user/' + (args.type === 'recent' ? 'recentHistoryList' : 'hitHistoryList'), { ...cursors(args), ...(args.type === 'recent' ? {} : { type: 'feed' }) }), row => ({ ...row, url: typeof row.url === 'string' && row.url && !/^(?:https?:\/\/|\/)/.test(row.url) ? '/' + row.url : row.url, logo: typeof row.logo === 'string' && row.logo && !/^(?:https?:\/\/|\/)/.test(row.logo) ? 'https://image.coolapk.com/' + row.logo : row.logo }));
  }
}
