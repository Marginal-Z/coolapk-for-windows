import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, LEGACY_THEME_KEY, PREFERENCES_KEY, THEME_PALETTES, clockMinutes, isNightTime, loadPreferences, normalizePreferences, normalizeThemeColor, preferenceFontScale, preferenceThemeVariables, resolveTheme, savePreferences, themeColorContrast } from '../core/preferences.mjs';
function storage(initial = {}) { const values = new Map(Object.entries(initial)); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
function at(hours, minutes = 0) { return new Date(2026, 9, 4, hours, minutes); }
test('material switch persists independently and retired material choices migrate to supported effects', () => {
  assert.equal(normalizePreferences({ version: 3, materialEffect: 'blur_only' }).materialEnabled, true);
  const target = storage();
  savePreferences(target, { materialEnabled: false, materialEffect: 'full' });
  assert.equal(loadPreferences(target).materialEnabled, false); assert.equal(loadPreferences(target).materialEffect, 'blur_only');
  assert.equal(normalizePreferences({ materialEffect: 'transparent' }).materialEffect, 'fallback');
  for (const materialEnabled of ['false', 0, null]) assert.equal(normalizePreferences({ materialEnabled }).materialEnabled, true);
});
test('custom backgrounds persist bounded opacity metadata without paths, URLs or embedded image bytes', () => {
  const defaults = normalizePreferences({}); assert.equal(defaults.backgroundEnabled, false); assert.equal(defaults.backgroundOpacity, .6); assert.equal(defaults.surfaceOpacity, .78); assert.equal(defaults.feedColumns, 2);
  const valid = normalizePreferences({ backgroundEnabled: true, backgroundOpacity: .375, surfaceOpacity: .8, feedColumns: 4, backgroundUrl: 'file:///D:/private.png', backgroundBytes: 'large-base64' }); assert.equal(valid.backgroundOpacity, .38); assert.equal(valid.surfaceOpacity, .8); assert.equal(valid.feedColumns, 3); assert.equal(valid.backgroundEnabled, true); assert.equal(Object.hasOwn(valid, 'backgroundUrl'), false); assert.equal(Object.hasOwn(valid, 'backgroundBytes'), false);
  for (const value of [-1, 1.01, NaN, Infinity, '0.5', null]) assert.equal(normalizePreferences({ backgroundOpacity: value }).backgroundOpacity, .6);
  for (const value of [1.01, NaN, '0.9']) assert.equal(normalizePreferences({ surfaceOpacity: value }).surfaceOpacity, .78);
  assert.equal(normalizePreferences({ surfaceOpacity: .01 }).surfaceOpacity, .75); assert.equal(normalizePreferences({ surfaceOpacity: 0 }).surfaceOpacity, .75);
  for (const value of [0, 5, 1.5, '4']) assert.equal(normalizePreferences({ feedColumns: value }).feedColumns, 2);
  const target = storage(); savePreferences(target, valid); assert.deepEqual(loadPreferences(target), valid);
});
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
test('old saved appearance settings gain a white palette without losing their manual or scheduled night choice', () => {
  const old = { version: 1, theme: 'black', followSystem: false, autoNight: true, nightStart: '20:30', nightEnd: '07:15', fontSize: 'small' };
  const migrated = loadPreferences(storage({ [PREFERENCES_KEY]: JSON.stringify(old) }));
  assert.equal(migrated.palette, 'white'); assert.equal(migrated.customAccent, '#0f9d58');
  assert.equal(migrated.version, 5);
  for (const [key, value] of Object.entries(old)) if (key !== 'version') assert.equal(migrated[key], value);
});
test('custom colors accept only bounded hex colors and reject executable CSS or persistent unknown fields', () => {
  assert.equal(normalizeThemeColor(' #AbC '), '#aabbcc'); assert.equal(normalizeThemeColor('#DB4437'), '#db4437');
  for (const color of ['red', 'url(https://example.test)', '#abcd', '#abcdef00', 'var(--secret)', '#gggggg', null, 255]) assert.equal(normalizeThemeColor(color), null);
  const value = normalizePreferences({ palette: '__proto__', customAccent: 'url(synthetic)' });
  assert.equal(value.palette, 'white'); assert.equal(value.customAccent, '#0f9d58');
  const valid = normalizePreferences({ palette: 'custom', customAccent: '#aBc', privateValue: 'ignore' });
  assert.equal(valid.customAccent, '#aabbcc'); assert.equal(Object.hasOwn(valid, 'privateValue'), false);
});
test('every sampled palette keeps the exact native seed while links, controls and night transitions remain readable', () => {
  const native = ['#0f9d58', '#0f9d58', '#db4437', '#fb7299', '#3f51b5', '#009688', '#ff9800', '#673ab7', '#2196f3', '#795548', '#607d8b'];
  assert.deepEqual(THEME_PALETTES.map(palette => palette.color), native);
  for (const palette of [...THEME_PALETTES.map(palette => ({ palette: palette.id })), { palette: 'custom', customAccent: '#ffffff', customThemeDark: false }, { palette: 'custom', customAccent: '#000000' }, { palette: 'custom', customAccent: '#ffff00', customThemeDark: false }]) {
    for (const theme of ['light', 'dark', 'black']) {
      const variables = preferenceThemeVariables(palette, theme), surface = theme === 'black' ? '#0b0b0b' : theme === 'dark' ? '#202823' : '#ffffff';
      assert.ok(themeColorContrast(variables['--accent'], surface) >= 4.5, `${palette.palette}/${theme} link contrast`);
      assert.ok(themeColorContrast(variables['--theme-sidebar'], surface) >= 1, `${palette.palette}/${theme} sidebar color`);
      assert.ok(themeColorContrast(variables['--accent'], variables['--accent-on']) >= 4.5, `${palette.palette}/${theme} button contrast`);
      assert.ok(themeColorContrast(variables['--theme-header'], variables['--theme-header-text']) >= 4.5, `${palette.palette}/${theme} header contrast`);
      for (const value of Object.values(variables)) assert.match(value, /^#[0-9a-f]{6}$/);
    }
  }
});
test('palette survives saved theme and system/scheduled night transitions', () => {
  const selected = { palette: 'purple', followSystem: true, blackAtNight: true };
  assert.equal(preferenceThemeVariables(selected, resolveTheme(selected, true))['--theme-primary'], '#673ab7');
  assert.equal(preferenceThemeVariables(selected, resolveTheme(selected, false))['--theme-primary'], '#673ab7');
  assert.equal(preferenceThemeVariables(selected, 'black')['--theme-header'], '#0b0b0b');
  assert.equal(preferenceThemeVariables(selected, 'light')['--theme-header'], '#673ab7');
  const target = storage(); savePreferences(target, { ...selected, customAccent: '#aabbcc' });
  assert.equal(loadPreferences(target).palette, 'purple'); assert.equal(loadPreferences(target).customAccent, '#aabbcc');
});
test('native custom primary and accent are independent and primary text adapts to contrast', () => {
  const value = { palette: 'custom', customTheme: '#eeeeee', customAccent: '#673ab7', customThemeDark: false };
  const colors = preferenceThemeVariables(value, 'light');
  assert.equal(colors['--theme-primary'], '#eeeeee'); assert.equal(colors['--theme-accent'], '#673ab7'); assert.equal(colors['--theme-header'], '#eeeeee'); assert.equal(colors['--theme-header-text'], '#000000');
  assert.equal(preferenceThemeVariables({ ...value, customThemeDark: true }, 'light')['--theme-header-text'], '#000000');
  const old = normalizePreferences({ palette: 'custom', customAccent: '#123456' }); assert.equal(old.customTheme, '#123456');
  const bad = normalizePreferences({ customTheme: 'url(synthetic)', customThemeDark: 'true' }); assert.equal(bad.customTheme, '#0f9d58'); assert.equal(bad.customThemeDark, true);
});
test('only blur and semi-transparent materials persist, with at most three feed columns', () => {
  const defaults = normalizePreferences(null); assert.equal(defaults.materialEffect, 'blur_only'); assert.equal(defaults.showFastReturnView, false); assert.equal(defaults.showFPS, false);
  assert.equal(defaults.materialFollowSystem, false); assert.equal(defaults.version, 5);
  for (const materialEffect of ['blur_only', 'fallback']) assert.equal(normalizePreferences({ materialEffect }).materialEffect, materialEffect);
  assert.equal(normalizePreferences({ materialEffect: 'full' }).materialEffect, 'blur_only');
  assert.equal(normalizePreferences({ materialEffect: 'transparent' }).materialEffect, 'fallback');
  const invalid = normalizePreferences({ materialEffect: 'url(synthetic)', materialFollowSystem: 'true', showFastReturnView: 'true', showFPS: 1 }); assert.equal(invalid.materialEffect, 'blur_only'); assert.equal(invalid.materialFollowSystem, false); assert.equal(invalid.showFastReturnView, false); assert.equal(invalid.showFPS, false);
  const target = storage(); savePreferences(target, { materialEffect: 'transparent', materialFollowSystem: true, showFastReturnView: true, showFPS: true, feedColumns: 4, cookie: 'ignore' }); const restored = loadPreferences(target); assert.equal(restored.materialEffect, 'fallback'); assert.equal(restored.materialFollowSystem, true); assert.equal(restored.showFastReturnView, true); assert.equal(restored.showFPS, true); assert.equal(restored.feedColumns, 3); assert.equal(Object.hasOwn(restored, 'cookie'), false);
});
test('version one exact old opacity defaults migrate together without changing a saved custom opacity', () => {
  const old = { version: 1, backgroundEnabled: true, backgroundOpacity: .28, surfaceOpacity: .94, materialEffect: 'blur_only' };
  const migrated = loadPreferences(storage({ [PREFERENCES_KEY]: JSON.stringify(old) }));
  assert.equal(migrated.version, 5); assert.equal(migrated.backgroundOpacity, .6); assert.equal(migrated.surfaceOpacity, .78);
  assert.equal(migrated.backgroundEnabled, true); assert.equal(migrated.materialEffect, 'blur_only'); assert.equal(migrated.materialFollowSystem, false);
  for (const pair of [[.28, .93], [.27, .94], [.4, .8], [0, 1]]) {
    const custom = normalizePreferences({ ...old, backgroundOpacity: pair[0], surfaceOpacity: pair[1] });
    assert.equal(custom.backgroundOpacity, pair[0]); assert.equal(custom.surfaceOpacity, Math.max(.75, pair[1])); assert.equal(custom.version, 5);
  }
  const current = normalizePreferences({ ...old, version: 4 }); assert.equal(current.backgroundOpacity, .28); assert.equal(current.surfaceOpacity, .94); assert.equal(current.version, 5);
  const target = storage(); savePreferences(target, migrated); assert.deepEqual(loadPreferences(target), migrated);
});
