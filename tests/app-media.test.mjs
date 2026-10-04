import test from 'node:test';
import assert from 'node:assert/strict';
import { appIconSource, appScreenshots, publicImageSource } from '../core/app-media.mjs';
import { fetchImage, imageSource } from '../core/images.mjs';
import { createRequire } from 'node:module';
const { TeenagerAccess } = createRequire(import.meta.url)('../electron/teenager-access.cjs');

const icon = 'http://pp.myapp.com/ma_icon/0/icon_6633_1790172526/256';
const screenshot = 'http://pp.myapp.com/ma_pic2/0/shot_6633_1_1790172526/0';
test('known app-store icon and screenshot paths upgrade to HTTPS through the same bounded proxy', async () => {
  for (const source of [icon, screenshot]) {
    const requests = [];
    const image = await fetchImage(source, async (url, init) => { requests.push({ url, init }); return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/png' } }); });
    assert.equal(image.body.length, 2); assert.equal(requests[0].url.protocol, 'https:');
    assert.equal(requests[0].url.hostname, 'pp.myapp.com'); assert.equal(requests[0].init.redirect, 'error');
    assert.deepEqual(Object.keys(requests[0].init.headers), ['User-Agent']);
    assert.equal(imageSource(source).toString(), source.replace('http:', 'https:'));
  }
});
test('the new external CDN allowance rejects arbitrary paths, queries, credentials, ports and lookalike hosts before network', async () => {
  const invalid = ['https://pp.myapp.com/', 'https://pp.myapp.com/private/api', icon + '?token=synthetic', icon + '#secret', icon.replace('pp.myapp.com', 'pp.myapp.com.evil.test'), icon.replace('pp.myapp.com', 'evil.test'), icon.replace('pp.myapp.com', '127.0.0.1'), icon.replace('pp.myapp.com', 'user:pass@pp.myapp.com'), icon.replace('pp.myapp.com', 'pp.myapp.com:8080'), icon.replace('ma_icon', 'ma%5Ficon'), icon.replace('6633', '\n6633'), 'data:image/png;base64,QQ==', 'file:///C:/secret'];
  let requests = 0;
  for (const source of invalid) { assert.equal(publicImageSource(source), ''); await assert.rejects(fetchImage(source, async () => { requests++; }), error => error.code === 'INPUT'); }
  assert.equal(requests, 0);
});
test('external app image loading retains MIME, HTTP and size limits', async () => {
  for (const response of [new Response('<html>challenge</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }), new Response('', { status: 302 }), new Response('image', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(12 * 1024 ** 2 + 1) } })]) await assert.rejects(fetchImage(icon, async () => response));
});
test('app icon fields resolve public image sources without falling back to a user avatar', () => {
  assert.equal(appIconSource({ logo: icon, userAvatar: 'https://avatar.coolapk.com/never.png' }), icon.replace('http:', 'https:'));
  assert.equal(appIconSource({ apkRomIcon: 'apk_logo/sample.png' }), 'https://image.coolapk.com/apk_logo/sample.png');
  assert.equal(appIconSource({ logo: 'javascript:alert(1)', icon: '//image.coolapk.com/valid.png' }), 'https://image.coolapk.com/valid.png');
  assert.equal(appIconSource({ userAvatar: 'https://avatar.coolapk.com/user.png' }), '');
});
test('the actual screenList array and screenshots comma string are preserved in server order and deduplicated', () => {
  const second = screenshot.replace('shot_6633_1_', 'shot_6633_2_'), third = 'https://image.coolapk.com/apk_image/third.png';
  assert.deepEqual(appScreenshots({ screenList: [screenshot, second], screenshots: screenshot + ',' + second + ',' + third, screenshotList: [{ url: third }] }), [screenshot, second, third].map(url => url.replace('http:', 'https:')));
  assert.deepEqual(appScreenshots({ screenshots: screenshot + ',' + second }), [screenshot, second].map(url => url.replace('http:', 'https:')));
});
test('malformed screenshot entries are excluded without turning them into invented images', () => {
  assert.deepEqual(appScreenshots({ screenList: [null, {}, true, 'javascript:alert(1)', 'https://evil.test/picture.png', screenshot], screenshots: {} }), [screenshot.replace('http:', 'https:')]);
  assert.equal(appScreenshots({ screenList: Array.from({ length: 40 }, (_, index) => `https://image.coolapk.com/${index}.png`) }).length, 30);
});
test('existing Coolapk CDN URLs keep query processing and untrusted sources stay outside the public proxy', () => {
  assert.equal(publicImageSource('http://image.coolapk.com/test.png?x-oss-process=image/resize,w_500'), 'https://image.coolapk.com/test.png?x-oss-process=image/resize,w_500');
  assert.equal(publicImageSource('//static.coolapk.com/test.png'), 'https://static.coolapk.com/test.png');
  assert.equal(publicImageSource('https://avatar.coolapk.com.evil.test/a.png'), '');
});
test('the additional public app image paths cannot bypass the curated youth-mode image scope', () => {
  const access = new TeenagerAccess({ store: { info: () => ({ enabled: true, blocked: false }), tick: () => ({ enabled: true, blocked: false }) } });
  access.collectImages({ picArr: [icon, screenshot] });
  for (const source of [icon, screenshot]) assert.throws(() => access.assertImage(publicImageSource(source)), { code: 'TEENAGER_RESTRICTED' });
});
