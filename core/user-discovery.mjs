import { ApiError, CoolapkClient, flattenEntities, numericId } from './client.mjs';

export const USER_DISCOVERY_OPERATIONS = ['userProfile', 'publicUserProfile', 'publicUserSpace', 'userAppRatings', 'nodeAppFeeds'];
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
export async function dispatchUserDiscovery(client, operation, args = {}) {
  if (!USER_DISCOVERY_OPERATIONS.includes(operation)) throw new ApiError('不支持的用户资料操作', 'INPUT');
  if (['userProfile', 'publicUserProfile', 'publicUserSpace'].includes(operation)) {
    const reader = operation.startsWith('public') ? guestFor(client) : client;
    const result = await reader.request(operation === 'publicUserSpace' ? '/v6/user/space' : '/v6/user/profile', { uid: numericId(args.uid) });
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new ApiError('酷安返回的资料结构异常', 'API_ERROR');
    return result;
  }
  if (operation === 'userAppRatings') return list(await client.request('/v6/user/apkRatingList', { uid: numericId(args.uid), ...cursor(args) }));
  const id = String(args.id ?? '');
  if (!/^\d{1,20}$/.test(id) && !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(id)) throw new ApiError('应用编号无效', 'INPUT');
  if (args.sort != null && args.sort !== 'lastupdate_desc') throw new ApiError('节点讨论排序尚未确认', 'INPUT');
  return list(await client.request('/v6/page/dataList', { url: '#/feed/apkCommentList', id, sort: 'lastupdate_desc', ...cursor(args) }));
}
