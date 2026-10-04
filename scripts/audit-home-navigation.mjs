import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coolapkRoute } from '../core/navigation.mjs';
import { CoolapkClient, internalPageRoute } from '../core/client.mjs';
import { HOME_READ_LISTS } from '../core/home-navigation.mjs';

const directory = resolve(process.env.COOLAPK_HOME_AUDIT_SOURCE || '.local/phone-home-20261005');
const files = readdirSync(directory).filter(name => /^channel-\d+-api\.json$/.test(name) || name === 'recommend-api.json').sort();
if (!files.length) throw new Error('No recorded official homepage responses found');
const legacyUnavailable = new Set(['/apk/hot', '/apk/linkList', '/picture/recommendList', '/main/topicTagList', '/main/headlineList']);
const routes = new Map(), candidates = new Map(); let linkOccurrences = 0;
function target(source, depth = 0) {
  if (depth > 4 || typeof source !== 'string' || !source.trim()) return null;
  const text = source.trim();
  if (/^[A-Z][A-Z0-9_]+$/.test(text)) return { descriptor: 'page:' + text, queryKeys: [], source: text, path: '' };
  try {
    const url = new URL(text.startsWith('#/') ? text.slice(1) : text, 'https://www.coolapk.com');
    if (url.protocol === 'searchtab:') return { descriptor: 'searchTab://' + url.hostname, queryKeys: [...new Set(url.searchParams.keys())], source: text, path: '' };
    if (!['coolapk.com', 'www.coolapk.com', 'm.coolapk.com'].includes(url.hostname)) return { descriptor: 'external:' + url.hostname, queryKeys: [], source: text, path: '', external: true };
    if (url.pathname === '/page' && url.searchParams.has('url')) return target(url.searchParams.get('url'), depth + 1);
    let path = url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
    if (/^\/(?:u|user)\/[^/]+$/.test(path) && !/^\/(?:u|user)\/:id$/.test(path)) path = '/u/:name';
    if (/^\/notice\/[^/]+$/.test(path)) path = '/notice/:slug';
    if (/^\/(?:t|topic)\/[^/]+$/.test(path) && !/(?:List|Detail|\/list|\/detail)$/.test(path)) path = '/t/:tag';
    if (/^\/apk\/[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(path)) path = '/apk/:package';
    return { descriptor: path, path: url.pathname, queryKeys: [...new Set(url.searchParams.keys())], source: text, external: false };
  } catch { return { descriptor: 'invalid-link', queryKeys: [], source: text, path: '' }; }
}
function record(source, file) {
  if (typeof source !== 'string' || !source.trim()) return;
  const row = target(source); if (!row) return; linkOccurrences++;
  let kind = 'unsupported-native-link', endpoint;
  if (row.external) kind = 'external-web';
  else if (row.path === '/feed/writer') kind = 'root-native-compose';
  else if (row.path.startsWith('/clickUrl/')) kind = 'official-commerce-phone-contract-gap';
  else if (row.path === '/mp/productSelector/configSearch') kind = 'official-Android-callback-contract-gap';
  else if (legacyUnavailable.has(row.path)) kind = 'official-list-unavailable-in-guest-probe';
  else if (['/apk/search', '/game/search'].includes(row.path)) kind = coolapkRoute(source)?.inputOnly ? 'native-search-input' : 'invalid-search-entry';
  else {
    const route = coolapkRoute(source);
    if (route?.kind === 'page') { try { endpoint = internalPageRoute(route.url).endpoint; kind = 'native-read-list'; } catch { kind = 'unsupported-native-read-list'; } }
    else if (route?.kind === 'search') kind = 'native-search';
    else if (route) kind = 'native-' + route.kind;
    else if (row.path === '/notice/feed-3609193' || /^\/picture\/\d+$/.test(row.path)) kind = 'official-web-only';
  }
  const key = row.descriptor + ':' + kind, old = routes.get(key) || { destination: row.descriptor, kind, endpoint, occurrences: 0, files: new Set(), queryKeys: new Set() };
  old.occurrences++; old.files.add(file); row.queryKeys.forEach(key => old.queryKeys.add(key)); routes.set(key, old);
  if (Object.hasOwn(HOME_READ_LISTS, row.path) && !candidates.has(row.path)) candidates.set(row.path, source);
}
function scan(value, file) {
  if (Array.isArray(value)) { value.forEach(row => scan(row, file)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      if (['url', 'turl', 'actionUrl', 'extra_url', 'url1', 'url2'].includes(key)) record(item, file);
      if (key === 'content') for (const line of item.split(/\r?\n/)) { const match = line.match(/^link,\s*[^,]+,\s*(.+)$/); if (match) record(match[1].replace(/,\s{2,}.*$/, '').trim(), file); }
      if (['message', 'message_html', 'content', 'description'].includes(key)) for (const match of item.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) record(match[2].replaceAll('&amp;', '&'), file);
    }
    scan(item, file);
  }
}
for (const file of files) scan(JSON.parse(readFileSync(resolve(directory, file), 'utf8')), file);
const routeRows = [...routes.values()].map(row => ({ ...row, files: row.files.size, queryKeys: [...row.queryKeys].sort() })).sort((a, b) => a.destination.localeCompare(b.destination));
const counts = {}; routeRows.forEach(row => counts[row.kind] = (counts[row.kind] || 0) + row.occurrences);
const commerceContracts = new Map();
if (existsSync(resolve(directory, 'init-api.json'))) {
  function commerce(value) {
    if (Array.isArray(value)) { value.forEach(commerce); return; }
    if (!value || typeof value !== 'object') return;
    for (const item of Object.values(value)) {
      if (typeof item === 'string' && item.startsWith('/clickUrl/')) { const url = new URL(item, 'https://www.coolapk.com'); commerceContracts.set(url.pathname, { destination: url.pathname, queryKeys: [...new Set(url.searchParams.keys())], source: 'init-api.json', kind: 'official-commerce-phone-contract-gap' }); }
      commerce(item);
    }
  }
  commerce(JSON.parse(readFileSync(resolve(directory, 'init-api.json'), 'utf8')));
}
const bindings = JSON.parse(readFileSync('research/apk-request-bindings.json', 'utf8'));
const report = {
  checkedAt: new Date().toISOString(), mode: 'read-only audit of recorded official homepage URLs and known GET bindings; route/parameter names only; no account fields or query values',
  sourceFiles: files.length, linkOccurrences, destinationGroups: routeRows.length, counts,
  limits: 'Counts include duplicate URLs present in flattened and raw response envelopes and are navigation coverage, not full mobile feature acceptance. No external URLs, commerce actions, writers or Android callbacks are requested by this audit.',
  apkSha256: bindings.apkSha256,
  bindings: bindings.contracts.filter(row => row.method === 'GET' && ['page/dataList', 'apk/index', 'apk/giftList'].includes(row.endpoint)).map(row => ({ method: row.method, endpoint: row.endpoint, methodIndex: row.methodIndex, parameterNames: row.parameters.flatMap(parameter => parameter.annotations.map(annotation => annotation.name).filter(Boolean)) })),
  addedReadListPaths: Object.keys(HOME_READ_LISTS).sort(), routes: routeRows,
  additionalUnsupportedContracts: [...commerceContracts.values()],
};
writeFileSync('research/home-navigation-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceFiles: files.length, linkOccurrences, destinationGroups: routeRows.length, counts, addedReadListPaths: Object.keys(HOME_READ_LISTS).length }));
if (process.argv.includes('--live')) {
  const client = new CoolapkClient(), output = resolve('.local/home-route-probe/live-normalized'); mkdirSync(output, { recursive: true });
  const checks = []; let index = 0; const entries = [...candidates];
  await Promise.all([0, 1].map(async () => { while (index < entries.length) {
    const [path, source] = entries[index++], contract = internalPageRoute(source);
    try {
      const result = await client.dispatch('page', { url: source, page: 1 });
      writeFileSync(resolve(output, path.replaceAll('/', '-').slice(1) + '.json'), JSON.stringify(result, null, 2));
      checks.push({ path, method: 'GET', endpoint: contract.endpoint, passed: Array.isArray(result.data), rawCount: result.rawCount, visibleCount: result.data?.length });
    } catch (error) { checks.push({ path, method: 'GET', endpoint: contract.endpoint, passed: false, code: error.code || 'ERROR', serverStatus: error.detail?.serverStatus }); }
    console.log(JSON.stringify(checks.at(-1)));
  } }));
  writeFileSync('research/home-navigation-live-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'fresh guest session; observed official known readonly routes only; GET page one; raw responses only in D:.local; no credentials or bypass', checks: checks.sort((a, b) => a.path.localeCompare(b.path)), passed: checks.length === Object.keys(HOME_READ_LISTS).length && checks.every(row => row.passed) }, null, 2) + '\n');
}
