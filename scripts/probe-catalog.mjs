import { writeFileSync } from 'node:fs';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchCatalog } from '../core/catalog.mjs';

if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly run public read-only Coolapk catalog probes.');
const client = new CoolapkClient();
const jobs = [
  ['catalogProductCategories', {}], ['catalogProductBrands', {}], ['catalogApp', { id: 'com.coolapk.market' }],
  ['catalogAlbums', { type: 'hot' }], ['catalogDyhs', {}], ['catalogEvents', {}],
  ['catalogPictures', { tag: '风景' }], ['catalogAppVersions', { id: 'com.coolapk.market' }], ['catalogAppRelated', { id: 'com.coolapk.market' }],
];
const results = [];
for (let start = 0; start < jobs.length; start += 3) {
  const batch = await Promise.all(jobs.slice(start, start + 3).map(async ([operation, args]) => {
    try {
      const response = await dispatchCatalog(client, operation, args);
      return { operation, state: 'verified', verification: 'public_read_only_live', shape: Array.isArray(response.data) ? 'list' : typeof response.data, count: Array.isArray(response.data) ? response.data.length : undefined, entityTypes: Array.isArray(response.data) ? [...new Set(response.data.map(item => item.entityType || 'untyped'))] : undefined };
    } catch (error) { return { operation, state: 'unknown', verification: 'live_request_not_successful', code: error.code || 'ERROR', message: String(error.message).slice(0, 180) }; }
  }));
  results.push(...batch); for (const result of batch) console.log(result.operation, result.state, result.count ?? result.code ?? result.shape);
}
writeFileSync('research/catalog-live-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'guest public read-only requests; no account cookies or write requests', results }, null, 2));
