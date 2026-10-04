import test from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { articleModels, applyPublishOptions } from '../core/publishing.mjs';
import { cosUpload, validateVideo, videoUrl } from '../core/video.mjs';
import scope from '../electron/request-scope.cjs';
const identity = { uid: '42' };
const video = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
const cover = Buffer.from([255, 216, 255, 0]);
const prepared = { storageBucket: 'ugc', storageRegionV5: 'ap-shanghai', storageAppId: 123, vodSessionKey: 'session-test', tempCertificate: { secretKey: 'synthetic-secret', secretId: 'synthetic-id', token: 'synthetic-token', expiredTime: 2000000000 }, video: { storagePath: 'video/test.mp4' }, cover: { storagePath: 'cover/test.jpg' } };
function client(fetchImpl) { return new CoolapkClient({ identity, cookie: 'SESSID=synthetic-session', fetchImpl }); }
test('article publishing uses official JSON models, separate title/cover and no duplicate pic field', async () => {
  let form;
  const api = client(async (_url, init) => { form = init.body; return Response.json({ data: { id: 8 } }); });
  await api.dispatch('publishAdvanced', { message: '正文 <script>作为文字</script>', pic: 'https://image.coolapk.com/feed/p.jpg', options: { htmlArticle: true, messageTitle: '文章', messageCover: 'https://image.coolapk.com/feed/p.jpg', visibleStatus: -1, originalType: 1 } });
  assert.deepEqual(JSON.parse(form.get('message')), [{ type: 'text', message: '正文 <script>作为文字</script>' }, { type: 'image', url: 'https://image.coolapk.com/feed/p.jpg', description: '' }]);
  assert.equal(form.get('pic'), ''); assert.equal(form.get('is_html_article'), '1'); assert.equal(form.get('message_title'), '文章'); assert.equal(form.get('publish_status'), '1');
});
test('publishing guards scope, limits, wrong board options and missing server confirmation', async () => {
  let count = 0; const api = client(async () => { count++; return Response.json({ data: {} }); });
  for (const args of [{ message: '' }, { message: '字'.repeat(1001) }, { message: '文章', options: { htmlArticle: true } }, { message: '内容', options: { targetType: 'apk' } }, { message: '内容', options: { extraUrl: 'javascript:alert(1)' } }, { message: '内容', options: { unknown: 1 } }]) await assert.rejects(api.dispatch('publishAdvanced', args));
  assert.equal(count, 0); await assert.rejects(api.dispatch('publishAdvanced', { message: '内容' }), { code: 'WRITE_UNCONFIRMED' });
  await assert.rejects(new CoolapkClient().dispatch('publishAdvanced', { message: '内容' }), e => e.code === 'LOGIN_REQUIRED');
  assert.throws(() => articleModels('字'.repeat(12001)), /12000/);
  assert.throws(() => applyPublishOptions({ pic: '' }, { targetType: 'product_phone', targetId: '42', subTypeId: '4' }), /至少需要/);
});
test('article editing rechecks owner, retains opaque cards and original metadata', async () => {
  const card = { type: 'card', entity: { id: 1, title: '保留卡片' } }, original = { id: 8, uid: '42', enableModify: 1, isHtmlArticle: 1, message: JSON.stringify([{ type: 'text', message: '旧正文' }, card]), targetType: 'tag', targetId: 'Windows', disallow_reply: 1 };
  const calls = []; const api = client(async (url, init) => { calls.push({ url, init }); return Response.json({ data: String(url).includes('changeDetail') ? original : { id: 8 } }); });
  await api.dispatch('editArticle', { id: '8', models: [{ type: 'text', message: '新正文' }, card], title: '新标题', cover: '' });
  const form = calls.at(-1).init.body; assert.equal(form.get('targetId'), 'Windows'); assert.equal(form.get('disallow_reply'), '1'); assert.equal(form.get('message_title'), '新标题'); assert.deepEqual(JSON.parse(form.get('message'))[1], card);
  await assert.rejects(api.dispatch('editArticle', { id: '8', models: [{ type: 'text', message: '丢弃卡片' }], title: '标题' }), /保留内容/);
  original.uid = '43'; await assert.rejects(api.dispatch('editArticle', { id: '8', models: [{ type: 'text', message: '正文' }, card], title: '标题' }), /当前账号/);
});
test('video validation and COS targets cannot select arbitrary hosts, paths or expired credentials', () => {
  assert.equal(validateVideo({ bytes: video, coverBytes: cover, duration: 5, name: 'test.mp4' }).kind, 'mp4');
  assert.throws(() => validateVideo({ bytes: Buffer.from('fake'), coverBytes: cover, duration: 5, name: 'x.mp4' }));
  assert.throws(() => videoUrl('https://attacker.example/test.mp4'));
  assert.throws(() => cosUpload(prepared, '../secret', 'video/mp4', 1900000000));
  assert.throws(() => cosUpload({ ...prepared, storageBucket: 'evil.example/' }, 'v.mp4', 'video/mp4', 1900000000));
  assert.throws(() => cosUpload(prepared, 'v.mp4', 'video/mp4', 2000000001));
});
test('video uploads separate Coolapk, VOD and COS credentials and return validated metadata', async () => {
  const calls = []; const api = client(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('TXUgc')) return Response.json({ data: 'synthetic-signature' });
    if (String(url).includes('ApplyUpload')) return Response.json({ code: 0, data: prepared });
    if (init.method === 'PUT') return new Response('');
    return Response.json({ code: 0, data: { video: { url: 'https://ugc-123.cos.ap-shanghai.myqcloud.com/test.mp4' }, cover: { url: 'https://ugc-123.cos.ap-shanghai.myqcloud.com/test.jpg' } } });
  });
  const result = await api.dispatch('uploadVideo', { bytes: video, coverBytes: cover, duration: 5, name: 'test.mp4' });
  assert.equal(calls.length, 5); assert.equal(calls[0].init.headers.Cookie, 'SESSID=synthetic-session');
  for (const call of calls.slice(1)) { assert.equal(call.init.headers.Cookie, undefined); assert.equal(call.init.headers['X-App-Token'], undefined); }
  assert.equal(calls[2].init.headers['x-cos-security-token'], 'synthetic-token');
  assert.equal(JSON.parse(result.data.mediaInfo).mediaType, 'video'); assert.equal(JSON.parse(JSON.parse(result.data.mediaInfo).requestParams)['普通']['0'], result.data.mediaUrl);
});
test('switching account between upload stages prevents further transfer or publish', async () => {
  const accountScope = new scope.AccountScope(); let calls = 0;
  const original = client(async () => { calls++; accountScope.changed(); return Response.json({ data: 'signature' }); });
  const captured = accountScope.capture(original);
  await assert.rejects(captured.client.dispatch('uploadVideo', { bytes: video, coverBytes: cover, duration: 5, name: 'test.mp4' }), e => e.code === 'ACCOUNT_CHANGED');
  assert.equal(calls, 1);
});
