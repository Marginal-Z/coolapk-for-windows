import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, LEGACY_THEME_KEY, PREFERENCES_KEY, clockMinutes, isNightTime, loadPreferences, normalizePreferences, preferenceFontScale, resolveTheme, savePreferences } from '../core/preferences.mjs';
function storage(initial = {}) { const values = new Map(Object.entries(initial)); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
function at(hours, minutes = 0) { return new Date(2026, 9, 4, hours, minutes); }
test('new settings use system fonts and system night mode with observed default night range', () => {
  assert.deepEqual(loadPreferences(storage()), DEFAULT_PREFERENCES);
  assert.equal(clockMinutes('22:00'), 1320); assert.equal(clockMinutes('06:00'), 360);
});
test('legacy explicit light and dark themes migrate without silently following the system', () => {
  for (const theme of ['light', 'dark']) {
    const value = loadPreferences(storage({ [LEGACY_THEME_KEY]: theme }));
    assert.equal(value.theme, theme); assert.equal(value.followSystem, false); assert.equal(resolveTheme(value, theme !== 'dark'), theme);
  }
});
test('saved display settings take precedence over the old toolbar theme key', () => {
  const value = normalizePreferences({ fontSize: 'large', theme: 'black', followSystem: false, autoNight: false });
  assert.deepEqual(loadPreferences(storage({ [PREFERENCES_KEY]: JSON.stringify(value), [LEGACY_THEME_KEY]: 'light' })), value);
});
test('malformed persisted JSON falls back to a valid previous manual theme', () => {
  assert.equal(loadPreferences(storage({ [PREFERENCES_KEY]: '{bad', [LEGACY_THEME_KEY]: 'dark' })).theme, 'dark');
  assert.deepEqual(loadPreferences(storage({ [PREFERENCES_KEY]: '{bad', [LEGACY_THEME_KEY]: 'bogus' })), DEFAULT_PREFERENCES);
});
test('unavailable storage still returns fresh in-memory defaults', () => {
  assert.deepEqual(loadPreferences({ getItem() { throw new Error('denied'); } }), DEFAULT_PREFERENCES);
});
test('normalize copies only bounded known display fields and ignores credentials or invalid primitives', () => {
  const value = normalizePreferences({ version: 999, cookie: 'never-copy', fontSize: 'infinite', theme: 'evil', followSystem: 'true', autoNight: 1, nightStart: '24:00', nightEnd: '06:99' });
  assert.deepEqual(value, DEFAULT_PREFERENCES); assert.equal(Object.hasOwn(value, 'cookie'), false);
  for (const candidate of [null, true, 1, 'dark', []]) assert.deepEqual(normalizePreferences(candidate), DEFAULT_PREFERENCES);
});
test('strict time parsing rejects out of range, loose digits and date strings', () => {
  for (const value of ['6:00', '24:00', '00:60', '22:00:00', '2026-10-04', '', 2200, null]) assert.equal(clockMinutes(value), null);
  assert.equal(clockMinutes('00:00'), 0); assert.equal(clockMinutes('23:59'), 1439);
});
test('overnight interval is inclusive at 22:00 and exclusive at 06:00', () => {
  const cases = [[21, 59, false], [22, 0, true], [23, 59, true], [0, 0, true], [5, 59, true], [6, 0, false], [12, 0, false]];
  for (const [hour, minute, expected] of cases) assert.equal(isNightTime(at(hour, minute)), expected, `${hour}:${minute}`);
});
test('non-overnight custom interval preserves its two exact boundaries', () => {
  const cases = [[7, 29, false], [7, 30, true], [12, 29, true], [12, 30, false], [23, 59, false]];
  for (const [hour, minute, expected] of cases) assert.equal(isNightTime(at(hour, minute), '07:30', '12:30'), expected);
});
test('same-time or invalid direct intervals do not enable permanent night mode', () => {
  assert.equal(isNightTime(at(2), '06:00', '06:00'), false); assert.equal(isNightTime(new Date('bad')), false);
  const value = normalizePreferences({ nightStart: '01:00', nightEnd: '01:00' }); assert.equal(value.nightStart, '22:00'); assert.equal(value.nightEnd, '06:00');
});
test('system mode takes precedence over retained automatic settings and current time', () => {
  const value = { followSystem: true, autoNight: true, theme: 'black' };
  assert.equal(resolveTheme(value, false, at(23)), 'light'); assert.equal(resolveTheme(value, true, at(12)), 'dark');
  assert.equal(resolveTheme({ ...value, blackAtNight: true }, true, at(12)), 'black');
});
test('automatic mode uses local wall clock and selected black night appearance', () => {
  const value = { followSystem: false, autoNight: true, blackAtNight: true };
  assert.equal(resolveTheme(value, false, at(23)), 'black'); assert.equal(resolveTheme(value, true, at(12)), 'light');
  assert.equal(resolveTheme({ ...value, blackAtNight: false }, false, at(23)), 'dark');
});
test('manual modes ignore clock and system light preference', () => {
  for (const theme of ['light', 'dark', 'black']) assert.equal(resolveTheme({ followSystem: false, autoNight: false, theme }, true, at(23)), theme);
});
test('font selection exposes fixed bounded scales and preserves OS DPI for system/standard', () => {
  assert.equal(preferenceFontScale({ fontSize: 'system' }), 1); assert.equal(preferenceFontScale({ fontSize: 'standard' }), 1);
  assert.equal(preferenceFontScale({ fontSize: 'large' }), 1.15); assert.equal(preferenceFontScale({ fontSize: 'small' }), .9);
  assert.equal(preferenceFontScale({ fontSize: 1000 }), 1);
});
test('persistence stores validated display fields only and propagates real save failure', () => {
  const target = storage(); const result = savePreferences(target, { fontSize: 'small', cookie: 'synthetic-private', nightStart: '20:15' });
  assert.deepEqual(JSON.parse(target.getItem(PREFERENCES_KEY)), result); assert.equal(target.values.size, 1); assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
  assert.throws(() => savePreferences({ setItem() { throw new Error('full'); } }, result), /full/);
});
