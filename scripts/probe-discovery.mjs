// Bounded guest reads only. Report no content, IDs, device fields or headers.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoolapkClient, ApiError } from '../core/client.mjs';
import { createDeviceCode } from '../core/auth.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live') throw new Error('Usage: node scripts/probe-discovery.mjs --live (five guest operations, one page each)');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = new Set(['/v6/main/indexV8', '/v6/page/dataList', '/v6/feed/hotReplyList']);
let requests = 0;
const client = new CoolapkClient({ cookie: '', identity: null, deviceCode: createDeviceCode('synthetic-discovery-read-only'), fetchImpl: (value, options) => {
  const url = new URL(value), headers = new Headers(options.headers);
  if (++requests > 6 || url.origin !== 'https://api.coolapk.com' || !routes.has(url.pathname) || url.searchParams.get('page') !== '1' || (options.method || 'GET') !== 'GET' || headers.has('Cookie') || headers.has('Authorization') || options.body || options.redirect !== 'error') throw new ApiError('Guest probe boundary rejected request', 'PROBE_BOUNDARY');
  return fetch(url, options);
} });
const code = error => /^[A-Z][A-Z0-9_]{0,39}$/.test(String(error?.code)) ? error.code : 'ERROR';
async function probe(operation, dispatch, args) {
  try {
    const result = await client.dispatch(dispatch, { ...args, page: 1 });
    if (!Array.isArray(result?.data)) return { operation, state: 'unknown', count: null, code: 'INVALID_LIST' };
    if (!result.data.length) return { operation, state: 'unknown', count: 0, code: 'EMPTY_RESULT' };
    return { operation, state: 'verified', count: result.data.length, code: null };
  } catch (error) { return { operation, state: 'unknown', count: null, code: code(error) }; }
}

// This one prerequisite read supplies a public feed ID only in memory. Neither
// the ID nor the home response enters stdout or the persisted report.
let publicFeed, prerequisiteCode = 'NO_PUBLIC_FEED';
try {
  const home = await client.dispatch('home', { page: 1 });
  publicFeed = Array.isArray(home?.data) ? home.data.find(item => item?.entityType === 'feed' && /^[1-9]\d{0,19}$/.test(String(item.id)))?.id : undefined;
  if (!Array.isArray(home?.data)) prerequisiteCode = 'INVALID_LIST';
} catch (error) { prerequisiteCode = code(error); }

const results = [];
for (const [operation, dispatch, args] of [
  ['rank.favorite', 'rank', { type: 'favorite' }],
  ['rank.index', 'rank', { type: 'index' }],
  ['homeNews', 'homeNews', {}],
  ['homeDigest', 'homeDigest', {}]
]) results.push(await probe(operation, dispatch, args));
results.push(publicFeed == null ? { operation: 'hotReplies', state: 'unknown', count: null, code: prerequisiteCode } : await probe('hotReplies', 'hotReplies', { id: String(publicFeed) }));
await writeFile(path.join(root, 'research', 'discovery-live-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'guest, no Cookie, five fixed reads at page 1; one public home prerequisite', results }, null, 2) + '\n');
for (const result of results) console.log(JSON.stringify(result));
