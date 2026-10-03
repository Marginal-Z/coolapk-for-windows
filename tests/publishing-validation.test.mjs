import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, CoolapkClient } from '../core/client.mjs';
import { applyPublishOptions } from '../core/publishing.mjs';
import { validateVideo } from '../core/video.mjs';

const identity = { uid: '42' };
const isInput = error => error instanceof ApiError && error.code === 'INPUT';
const mediaUrl = 'https://ugc-123.cos.ap-shanghai.myqcloud.com/test.mp4';
const coverUrl = 'https://ugc-123.cos.ap-shanghai.myqcloud.com/test.jpg';
const mediaInfo = overrides => JSON.stringify({ mediaType: 'video', duration: 5, cover: coverUrl, requestParams: JSON.stringify({ '普通': { '0': mediaUrl } }), ...overrides });
const video = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);
const cover = Buffer.from([255, 216, 255, 0]);
function mock(handler = () => ({ data: { id: 8 } })) {
  const calls = [];
  const client = new CoolapkClient({ identity, cookie: 'SESSID=synthetic-publishing-session', fetchImpl: async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json(handler(new URL(url), init));
  } });
  return { client, calls };
}

test('publishing mode flags reject strings, numbers and objects before submitting a feed', async () => {
  const { client, calls } = mock();
  for (const key of ['htmlArticle', 'largeCover']) for (const value of ['1', 'false', 1, 0, {}, []]) {
    const options = { [key]: value, ...(key === 'htmlArticle' ? { messageTitle: '文章标题' } : {}) };
    await assert.rejects(client.dispatch('publishAdvanced', { message: '正文', options }), isInput, `${key} must reject ${JSON.stringify(value)}`);
  }
  assert.equal(calls.length, 0);
  assert.equal(applyPublishOptions({}, { htmlArticle: false, largeCover: false }).is_html_article, 0);
  assert.equal(applyPublishOptions({}, { largeCover: true }).is_html_article, 2);
  assert.equal(applyPublishOptions({}, { htmlArticle: true, messageTitle: '文章标题' }).is_html_article, 1);
});

test('null, scalar or array video metadata consistently fails with INPUT and sends no request', async () => {
  const { client, calls } = mock();
  for (const value of ['null', '5', '"video"', '[]', '{bad json']) {
    await assert.rejects(client.dispatch('publishAdvanced', { message: '', options: { mediaUrl, mediaInfo: value } }), isInput);
  }
  assert.equal(calls.length, 0);
});

test('malformed or non-object video requestParams is an INPUT error rather than a raw JSON exception', async () => {
  const { client, calls } = mock();
  for (const requestParams of ['bad json', '', 'null', '[]', '5', '"params"', '{}']) {
    await assert.rejects(client.dispatch('publishAdvanced', { message: '', options: { mediaUrl, mediaInfo: mediaInfo({ requestParams }) } }), isInput, requestParams);
  }
  assert.equal(calls.length, 0);
  const form = applyPublishOptions({}, { mediaUrl, mediaInfo: mediaInfo({}) });
  assert.equal(form.media_url, mediaUrl);
});

test('purchase price JSON requires an object with a finite numeric positive price and valid configuration', async () => {
  const { client, calls } = mock();
  const options = { targetType: 'product_phone', targetId: '9', subTypeId: '6' };
  for (const subData of [
    'null', '[]', '5', '"price"',
    '{"final_price":"3999","config_id":1,"config_name":"256GB"}',
    '{"final_price":true,"config_id":1,"config_name":"256GB"}',
    '{"final_price":1e400,"config_id":1,"config_name":"256GB"}',
    '{"final_price":0,"config_id":1,"config_name":"256GB"}',
    '{"final_price":-1,"config_id":1,"config_name":"256GB"}',
    '{"final_price":3999,"config_id":"1","config_name":"256GB"}',
    '{"final_price":3999,"config_id":1,"config_name":"   "}',
  ]) await assert.rejects(client.dispatch('publishAdvanced', { message: '到手价', options: { ...options, subData } }), isInput, subData);
  assert.equal(calls.length, 0);
  await client.dispatch('publishAdvanced', { message: '到手价', options: { ...options, subData: '{"final_price":3999.5,"config_id":1,"config_name":"256GB"}' } });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body.get('tsubdata')).final_price, 3999.5);
});

test('article edits preserve opaque model multiplicity while allowing model reordering', async () => {
  const a = { type: 'card', entity: { id: 1, title: '卡片 A' } }, b = { type: 'shareUrl', url: 'https://www.coolapk.com/feed/2', title: '链接 B' };
  const original = { id: 8, uid: identity.uid, enableModify: 1, isHtmlArticle: 1, message: JSON.stringify([{ type: 'text', message: '原文' }, a, a, b]) };
  const { client, calls } = mock(url => ({ data: url.pathname.endsWith('/changeDetail') ? original : { id: 8 } }));
  for (const opaque of [[a, b, b], [a, b], [a, a, { ...b, title: '被改写的链接' }]]) {
    await assert.rejects(client.dispatch('editArticle', { id: '8', title: '标题', models: [{ type: 'text', message: '新正文' }, ...opaque] }), isInput);
  }
  assert.equal(calls.filter(row => row.url.pathname.endsWith('/changeFeed')).length, 0);
  const models = [{ type: 'text', message: '新正文' }, b, a, a];
  await client.dispatch('editArticle', { id: '8', title: '标题', models });
  const writes = calls.filter(row => row.url.pathname.endsWith('/changeFeed'));
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].init.body.get('message')), models);
});

test('uploads reject array-like objects, Buffer JSON, strings and alternate binary views before requesting credentials', async () => {
  const { client, calls } = mock();
  const invalid = [Object.assign({}, [...video], { length: video.length }), video.toJSON(), 'not binary', video.buffer, new DataView(video.buffer), new Uint16Array([0, 1, 2])];
  for (const bytes of invalid) {
    await assert.rejects(client.dispatch('uploadVideo', { bytes, coverBytes: cover, duration: 5, name: 'test.mp4' }), isInput);
    await assert.rejects(client.dispatch('uploadImage', { bytes }), isInput);
    await assert.rejects(client.dispatch('accountAvatar', { bytes }), isInput);
  }
  await assert.rejects(client.dispatch('uploadVideo', { bytes: video, coverBytes: Object.assign({}, [...cover], { length: cover.length }), duration: 5, name: 'test.mp4' }), isInput);
  assert.equal(calls.length, 0);
  assert.equal(validateVideo({ bytes: [...video], coverBytes: [...cover], duration: 5, name: 'test.mp4' }).kind, 'mp4');
  assert.equal(validateVideo({ bytes: new Uint8Array(video), coverBytes: new Uint8Array(cover), duration: 5, name: 'test.mp4' }).kind, 'mp4');
});
