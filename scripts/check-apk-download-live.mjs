import { CoolapkClient } from '../core/client.mjs';
import { createDeviceCode } from '../core/auth.mjs';
import { prepareApkDownload, openApkDownload } from '../core/download.mjs';
import { writeFileSync } from 'node:fs';

if (!process.argv.includes('--live')) throw new Error('Pass --live to perform the bounded read-only official APK download check.');
const requests = [], abort = new AbortController();
const client = new CoolapkClient({ deviceCode: createDeviceCode(), fetchImpl: async (url, options) => {
  const response = await fetch(url, options), location = response.headers.get('location'), redirect = location ? new URL(location, url) : null;
  requests.push({ host: new URL(url).hostname, method: options.method, http: response.status, ...(redirect ? { redirectHost: redirect.hostname, redirectHttps: redirect.protocol === 'https:', redirectApk: redirect.pathname.endsWith('.apk') } : {}), contentType: response.headers.get('content-type'), apiCredentialsSent: !!(options.headers?.Cookie || options.headers?.['X-App-Token']) });
  return response;
} });
let plan, outcome, prefixBytesReceived = 0;
try {
  ({ data: plan } = await prepareApkDownload(client, { packageName: 'com.example.ourom' }));
  const opened = await openApkDownload(client, plan, { signal: abort.signal }), reader = opened.response.body.getReader();
  try {
    let prefix = Buffer.alloc(0);
    while (prefix.length < 4) { const { done, value } = await reader.read(); if (done) break; prefixBytesReceived += value.byteLength; prefix = Buffer.concat([prefix, Buffer.from(value.subarray(0, 4 - prefix.length))]); if (prefixBytesReceived > 65536) throw new Error('Bounded APK prefix exceeded'); }
    if (prefix.length !== 4 || prefix.readUInt32LE(0) !== 0x04034b50) throw new Error('APK ZIP prefix missing');
    outcome = { opened: true, officialDownloadVerify: opened.verified, zipPrefix: true, fileSaved: false, fullDownload: false, bytesReceived: prefixBytesReceived };
  } finally { await reader.cancel(); reader.releaseLock(); }
} catch (error) { outcome = { opened: false, code: error.code || 'CHECK_FAILED', message: error.code ? error.message : 'APK prefix validation failed', fileSaved: false, fullDownload: false }; }
finally { abort.abort(); }
const report = { checkedAt: new Date().toISOString(), mode: 'live, anonymous read-only official current-version resolution; bounded APK prefix canceled without saving', packageName: 'com.example.ourom', ...(plan ? { versionCode: plan.versionCode } : {}), requests, outcome, redaction: 'No full URLs, signed queries, cookies, device codes or API tokens stored. API authentication headers are never forwarded to either download delivery host.', limitations: ['Only current com.example.ourom version checked. Full-file saving, historical downloads, other CDN hosts and phone installation were not exercised.'] };
writeFileSync('research/download-live-checks.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
if (!outcome.opened) process.exitCode = 1;
