import { writeFileSync } from 'node:fs';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchSecondhand } from '../core/secondhand.mjs';
import { secondhandEntityTarget } from '../core/secondhand-routes.mjs';

if (!process.argv.includes('--live')) throw new Error('Use --live for explicit guest public read-only secondhand probes.');
const client = new CoolapkClient(), results = [];
async function probe(operation, args = {}) {
  try {
    const result = await dispatchSecondhand(client, operation, args);
    results.push({ operation, status: 'verified', mode: 'guest_public_read_only_live', count: result.data.length, entityTypes: [...new Set(result.data.map(item => item.entityType || item.entityTemplate || 'untyped'))], observedFields: [...new Set(result.data.slice(0, 5).flatMap(Object.keys))].filter(key => !/cookie|token|session|password/i.test(key)), hasMore: result.hasMore });
    return result.data;
  } catch (error) { results.push({ operation, status: 'unknown', mode: 'live_request_failed', code: error.code || 'ERROR', message: String(error.message).slice(0, 160) }); return []; }
}
const [brands] = await Promise.all([probe('secondhandBrands'), probe('secondhandHome')]);
const brand = brands.find(item => /^[A-Za-z0-9_-]{1,120}$/.test(String(item.id ?? item.entityId ?? '')));
if (brand) {
  const models = await probe('secondhandProducts', { brandId: String(brand.id ?? brand.entityId), listType: String(brand.type || 'recommend') });
  const target = models.map(item => secondhandEntityTarget(item, String(brand.id ?? brand.entityId), true)).find(item => item?.type === 'list');
  if (target) await probe('secondhandListings', { filters: target.filters });
}
await probe('secondhandSearch', { keyword: '手机' });
writeFileSync('research/secondhand-live-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'guest public read-only; no account cookies, writes, purchase or private listings', results }, null, 2) + '\n');
for (const result of results) console.log(result.operation, result.status, result.count ?? result.code);
