import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoLoadVideoWhenWifi } from '../core/video-autoload.mjs';

const enabled = { autoLoadVideoWhenWifi: true };
test('automatic playback requires enabled preference, explicit Wi-Fi, and visibility', () => {
  assert.equal(shouldAutoLoadVideoWhenWifi(enabled, { type: 'wifi', saveData: false }, true), true);
  assert.equal(shouldAutoLoadVideoWhenWifi(enabled, { type: 'wifi' }, true), true);
});
test('automatic playback stays off on unknown, metered, or off-screen connections', () => {
  for (const [preferences, network, visible] of [
    [enabled, undefined, true],
    [enabled, { type: undefined }, true],
    [enabled, { type: 'cellular' }, true],
    [enabled, { type: 'wifi', saveData: true }, true],
    [enabled, { type: 'wifi' }, false],
    [{ autoLoadVideoWhenWifi: false }, { type: 'wifi' }, true],
  ]) assert.equal(shouldAutoLoadVideoWhenWifi(preferences, network, visible), false);
});
