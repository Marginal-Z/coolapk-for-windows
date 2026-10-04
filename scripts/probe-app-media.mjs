// Explicit, public read-only probe. No account store, cookies or write calls.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchAppDiscovery } from '../core/app-discovery.mjs';
import { dispatchCatalog } from '../core/catalog.mjs';
import { appIconSource, appScreenshots } from '../core/app-media.mjs';
import { fetchImage } from '../core/images.mjs';

if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly request public, read-only app metadata and image bytes.');
const client = new CoolapkClient(), checks = [];
assert.equal(client.identity, null); assert.equal(client.cookie, '');
async function image(source) {
  const { body, type } = await fetchImage(source);
  assert.ok(body.length > 0);
  return { host: new URL(source).hostname, mime: type.split(';')[0], bytes: body.length };
}
for (const operation of ['appDiscovery', 'gameDiscovery']) {
  const result = await dispatchAppDiscovery(client, operation);
  const samples = result.data.slice(0, 6);
  assert.equal(samples.length, 6);
  for (const app of samples) {
    const result = await image(appIconSource(app));
    checks.push({ operation, title: app.title, packageName: app.packageName, media: 'icon', ...result });
    console.log('PUBLIC_APP_ICON_PASS', app.title, result.host, result.mime, result.bytes);
  }
}
for (const id of ['com.tencent.mobileqq', 'com.coolapk.market']) {
  const { data: app } = await dispatchCatalog(client, 'catalogApp', { id });
  const screens = appScreenshots(app);
  assert.ok(screens.length > 0);
  const icon = await image(appIconSource(app));
  const screenshots = [];
  for (const source of screens) screenshots.push(await image(source));
  checks.push({ operation: 'catalogApp', packageName: id, media: 'detail', icon, sourceFields: { screenList: Array.isArray(app.screenList), screenshots: typeof app.screenshots }, screenshotCount: screens.length, screenshots });
  console.log('PUBLIC_APP_DETAIL_MEDIA_PASS', id, screens.length);
}
writeFileSync('research/app-media-live-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'guest public read-only API and bounded public image reader; no account cookies, phone access or write calls', checks }, null, 2) + '\n');
