// At most ten primary API GETs. No accounts, cookies, writes or persisted public IDs.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoolapkClient, ApiError } from '../core/client.mjs';
import { createDeviceCode } from '../core/auth.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live') throw new Error('Usage: node scripts/probe-app-user-discovery.mjs --live (bounded primary guest reads)');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const numeric = value => /^[1-9]\d{0,19}$/.test(String(value ?? ''));
const appId = value => numeric(value) || typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value);
let requests = 0, publicUid, publicApp, boundaryFailure = false;
const used = new Set();
const allowedQuery = (url, expected) => url.searchParams.size === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => url.searchParams.get(key) === String(value));
const allowedRoute = url => {
  if (url.pathname === '/v6/main/indexV8') return allowedQuery(url, { page: 1 });
  if (url.pathname === '/v6/search') return allowedQuery(url, { page: 1, type: 'game', searchValue: '手游', show_flag: 1 });
  if (url.pathname === '/v6/page/dataList') {
    if (['#/apk/rankList', '#/apk/newestList'].includes(url.searchParams.get('url'))) return allowedQuery(url, { page: 1, url: url.searchParams.get('url') });
    return publicApp != null && allowedQuery(url, { url: '#/feed/apkCommentList', id: publicApp, sort: 'lastupdate_desc', page: 1 });
  }
  if (['/v6/user/profile', '/v6/user/space'].includes(url.pathname)) return publicUid != null && allowedQuery(url, { uid: publicUid });
  if (url.pathname === '/v6/user/apkRatingList') return publicUid != null && allowedQuery(url, { uid: publicUid, page: 1 });
  return false;
};
const deviceCode = createDeviceCode('synthetic-app-user-discovery-read-only');
const client = new CoolapkClient({ cookie: '', identity: null, deviceCode, publicDeviceCode: deviceCode, fetchImpl: (value, options) => {
  const url = new URL(value), headers = new Headers(options.headers);
  const valid = ++requests <= 10 && url.origin === 'https://api.coolapk.com' && !url.username && !url.password && !url.hash && allowedRoute(url) && (options.method || 'GET') === 'GET' && !headers.has('Cookie') && !headers.has('Authorization') && options.body == null && options.redirect === 'error' && !used.has(url.href);
  if (!valid) { boundaryFailure = true; throw new ApiError('Guest probe boundary rejected request', 'PROBE_BOUNDARY'); }
  used.add(url.href);
  return fetch(url, options);
} });
const code = error => boundaryFailure ? 'PROBE_BOUNDARY' : /^[A-Z][A-Z0-9_]{0,39}$/.test(String(error?.code)) ? error.code : 'ERROR';
const results = [];
function record(result) { results.push(result); console.log(JSON.stringify(result)); }
async function read(operation, dispatch, args = {}, shape = 'list') {
  try {
    const result = await client.dispatch(dispatch, args);
    if (shape === 'object') {
      if (!result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) { record({ operation, state: 'unknown', count: null, code: 'INVALID_OBJECT' }); return; }
      if (!Object.keys(result.data).length) { record({ operation, state: 'unknown', count: 0, code: 'EMPTY_RESULT' }); return; }
      record({ operation, state: 'verified', count: 1, code: null }); return result.data;
    }
    if (!Array.isArray(result?.data)) { record({ operation, state: 'unknown', count: null, code: 'INVALID_LIST' }); return; }
    if (!result.data.length) { record({ operation, state: 'unknown', count: 0, code: 'EMPTY_RESULT' }); return; }
    record({ operation, state: 'verified', count: result.data.length, code: null }); return result.data;
  } catch (error) { record({ operation, state: 'unknown', count: null, code: code(error) }); }
}

// Identifiers are read from public results, kept in memory and never printed or saved.
const rank = await read('appDiscovery.recommend', 'appDiscovery', { category: 'recommend', page: 1 });
if (rank) {
  const first = rank.find(item => appId(item?.id) || appId(item?.packageName));
  if (first) publicApp = String(appId(first.id) ? first.id : first.packageName);
}
await read('appDiscovery.newest', 'appDiscovery', { category: 'newest', page: 1 });
await read('gameDiscovery.hot', 'gameDiscovery', { category: 'hot', page: 1 });
const home = await read('home.public-prerequisite', 'home', { page: 1 });
if (home) {
  const first = home.find(item => item?.entityType === 'feed' && numeric(item.uid ?? item.userInfo?.uid) && !['0', '10000'].includes(String(item.uid ?? item.userInfo?.uid)));
  if (first) publicUid = String(first.uid ?? first.userInfo.uid);
}
for (const [operation, shape] of [['publicUserProfile', 'object'], ['publicUserSpace', 'object'], ['userAppRatings', 'list']]) {
  if (publicUid == null) record({ operation, state: 'unknown', count: null, code: 'NO_PUBLIC_USER' });
  else await read(operation, operation, { uid: publicUid, ...(shape === 'list' ? { page: 1 } : {}) }, shape);
}
if (publicApp == null) record({ operation: 'nodeAppFeeds', state: 'unknown', count: null, code: 'NO_PUBLIC_APP' });
else await read('nodeAppFeeds', 'nodeAppFeeds', { id: publicApp, page: 1 });
await writeFile(path.join(root, 'research', 'app-user-discovery-live-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'bounded primary API guest reads, no Cookie or identity, page 1 only, at most ten GETs; IDs only in memory; no fallback', results }, null, 2) + '\n');
