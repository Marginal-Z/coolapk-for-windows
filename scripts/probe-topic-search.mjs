import { writeFileSync } from 'node:fs';
import { CoolapkClient } from '../core/client.mjs';
if (!process.argv.includes('--live')) throw new Error('Use --live for one guest, read-only topic search.');
let requests = 0;
const client = new CoolapkClient({ fetchImpl: (url, options = {}) => {
  const target = new URL(url);
  if (target.origin !== 'https://api.coolapk.com' || target.pathname !== '/v6/search' || options.method !== 'GET' || options.headers?.Cookie) throw new Error('Unexpected request outside guest topic-search scope');
  if (++requests > 1) throw new Error('Probe is bounded to one request');
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.any([options.signal, AbortSignal.timeout(20000)].filter(Boolean)) });
} });
const args = { tag: 'Windows', query: '软件', sort: 'latest', feedType: 'feed', page: 1 };
let result;
try {
  const response = await client.dispatch('topicSearch', args);
  const rows = Array.isArray(response.data) ? response.data : [];
  result = { operation: 'topicSearch', args, state: 'verified_read_response', count: rows.length, entityTypes: [...new Set(rows.map(row => typeof row.entityType === 'string' ? row.entityType : 'untyped'))], nonemptySampleObserved: rows.length > 0 };
} catch (error) { result = { operation: 'topicSearch', args, state: 'unknown', code: error.code || 'ERROR' }; }
const report = { checkedAt: new Date().toISOString(), mode: 'one guest GET; no account cookies, phone access, writes, captcha solving or retries', requestCount: requests, result };
writeFileSync('research/topic-search-live-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
