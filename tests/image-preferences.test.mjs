import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_PREFERENCES_KEY, DEFAULT_IMAGE_PREFERENCES, normalizeImagePreferences, loadImagePreferences, saveImagePreferences, preferOriginalImage, preferredImageSource } from '../core/image-preferences.mjs';
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
test('image defaults preserve original viewing and the sampled native silent Live Photo setting', () => {
  assert.deepEqual(loadImagePreferences(storage()), DEFAULT_IMAGE_PREFERENCES);
  assert.equal(DEFAULT_IMAGE_PREFERENCES.livePhotoAudio, false); assert.equal(DEFAULT_IMAGE_PREFERENCES.browsingMode, 'original');
});
test('only actual implemented image fields persist and unsafe values cannot enable new options', () => {
  for (const value of [null, [], 'original', { livePhotoAudio: 'true', browsingMode: 'wifi', watermark: true, cookie: 'ignore' }]) assert.deepEqual(normalizeImagePreferences(value), DEFAULT_IMAGE_PREFERENCES);
  const target = storage(), next = saveImagePreferences(target, { livePhotoAudio: true, browsingMode: 'normal', token: 'ignore' });
  assert.deepEqual(loadImagePreferences(target), next); assert.equal(target.getItem(IMAGE_PREFERENCES_KEY).includes('ignore'), false);
});
test('missing, malformed and unavailable image storage fall back to safe fresh defaults', () => {
  const target = storage(); target.setItem(IMAGE_PREFERENCES_KEY, '{bad'); assert.deepEqual(loadImagePreferences(target), DEFAULT_IMAGE_PREFERENCES);
  assert.deepEqual(loadImagePreferences({ getItem() { throw new Error('blocked'); } }), DEFAULT_IMAGE_PREFERENCES);
  assert.throws(() => saveImagePreferences({ setItem() { throw new Error('full'); } }, {}), /full/);
});
test('compressed viewing selects only the server preview while original viewing and explicit override preserve the source', () => {
  const item = { source: 'https://image.coolapk.com/original.jpg', cover: 'https://image.coolapk.com/compressed.jpg' };
  assert.equal(preferredImageSource(item, {}), item.source);
  assert.equal(preferredImageSource(item, { browsingMode: 'normal' }), item.cover);
  assert.equal(preferredImageSource(item, { browsingMode: 'normal' }, true), item.source);
  assert.equal(preferredImageSource({ source: item.source }, { browsingMode: 'normal' }), item.source);
});
test('image source selection refuses credential URLs and non-web schemes without inventing CDN transformations', () => {
  const safe = 'https://image.coolapk.com/livepic@100x100.jpg';
  for (const source of ['javascript:alert(1)', 'file:///D:/secret', 'https://name:pass@image.coolapk.com/private.jpg']) assert.equal(preferredImageSource({ source, cover: safe }, {}), safe);
  assert.equal(preferredImageSource({ source: safe, cover: 'javascript:alert(1)' }, { browsingMode: 'normal' }), safe);
  assert.equal(preferredImageSource({ source: safe }, { browsingMode: 'original' }), safe);
});
test('adaptive image mode uses known unrestricted transports and defaults to normal for unknown or metered connections', () => {
  assert.equal(preferOriginalImage({ browsingMode: 'auto' }), false);
  for (const type of ['wifi', 'ethernet']) assert.equal(preferOriginalImage({ browsingMode: 'auto' }, { type }), true);
  for (const type of ['cellular', 'unknown', undefined]) assert.equal(preferOriginalImage({ browsingMode: 'auto' }, { type }), false);
  assert.equal(preferOriginalImage({ browsingMode: 'auto' }, { type: 'wifi', saveData: true }), false);
  assert.equal(preferOriginalImage({ browsingMode: 'original' }, { type: 'cellular', saveData: true }), true);
  assert.equal(preferOriginalImage({ browsingMode: 'normal' }, { type: 'ethernet' }), false);
});
