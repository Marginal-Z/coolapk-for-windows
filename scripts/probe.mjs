import { createDeviceCode, requestHeaders, APK_PROFILE } from '../core/auth.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('.local/probe', { recursive: true });
const deviceCode = createDeviceCode('synthetic-protocol-verification');
const probes = [
  ['/v6/main/init', {}], ['/v6/main/indexV8', { page: '1' }],
  ['/v6/page/dataList', { url: '#/feed/statList?statType=7days&sortField=likenum', page: '1' }],
  ['/v6/search', { type: 'feed', searchValue: '酷安', page: '1' }],
];
const reports = [];
for (const [endpoint, query] of probes) {
  try {
    const url = new URL(endpoint, 'https://api.coolapk.com');
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { headers: requestHeaders(deviceCode), signal: AbortSignal.timeout(20000), redirect: 'error' });
    const body = await response.text();
    let json; try { json = JSON.parse(body); } catch {}
    const report = { endpoint, profile: APK_PROFILE, http: response.status, status: json?.status, message: json?.message, items: Array.isArray(json?.data) ? json.data.length : undefined, keys: Object.keys(json || {}) };
    reports.push(report); console.log(JSON.stringify(report));
    writeFileSync(`.local/probe/${endpoint.split('/').at(-1)}.json`, body);
  } catch (error) { const report = { endpoint, error: error.message }; reports.push(report); console.log(JSON.stringify(report)); }
}
writeFileSync('research/probe-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2));
