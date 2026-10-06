export const PREFERENCES_KEY = 'coolapk-preferences';
export const LEGACY_THEME_KEY = 'coolapk-theme';
// Labels/order were checked against the official 16.6.4 phone theme picker.
// The two blue entries use the APK's Indigo and Blue resources respectively.
export const THEME_PALETTES = Object.freeze([
  ['white', '白色', '#0f9d58', 'AppTheme.White'],
  ['green', '绿色', '#0f9d58', 'AppTheme.Green'],
  ['red', '红色', '#db4437', 'AppTheme.Red'],
  ['pink', '粉色', '#fb7299', 'AppTheme.Pink'],
  ['indigo', '蓝色（靛蓝）', '#3f51b5', 'AppTheme.Indigo'],
  ['teal', '青色', '#009688', 'AppTheme.Teal'],
  ['orange', '橙色', '#ff9800', 'AppTheme.Orange'],
  ['purple', '紫色', '#673ab7', 'AppTheme.DeepPurple'],
  ['blue', '蓝色（浅蓝）', '#2196f3', 'AppTheme.Blue'],
  ['brown', '棕色', '#795548', 'AppTheme.Brown'],
  ['blueGrey', '灰色', '#607d8b', 'AppTheme.BlueGrey'],
].map(([id, label, color, resource]) => Object.freeze({ id, label, color, resource })));
export const DEFAULT_PREFERENCES = Object.freeze({
  version: 2, fontSize: 'system', theme: 'light', followSystem: true,
  blackAtNight: false, autoNight: false, nightStart: '22:00', nightEnd: '06:00',
  palette: 'white', customTheme: '#0f9d58', customAccent: '#0f9d58', customThemeDark: true,
  materialEnabled: true, materialEffect: 'full', materialFollowSystem: false, showFastReturnView: false, showFPS: false,
  backgroundEnabled: false, backgroundOpacity: .6, surfaceOpacity: .78,
});
const themes = new Set(['light', 'dark', 'black']);
const fontSizes = new Set(['system', 'large', 'standard', 'small']);
const palettes = new Set([...THEME_PALETTES.map(palette => palette.id), 'custom']);
export function normalizeThemeColor(value) {
  if (typeof value !== 'string') return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(part => part + part).join('');
  return null;
}
export function clockMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes;
}
export function normalizePreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULT_PREFERENCES };
  if (themes.has(source.theme)) result.theme = source.theme;
  if (fontSizes.has(source.fontSize)) result.fontSize = source.fontSize;
  if (palettes.has(source.palette)) result.palette = source.palette;
  if (['full', 'blur_only', 'fallback'].includes(source.materialEffect)) result.materialEffect = source.materialEffect;
  const customAccent = normalizeThemeColor(source.customAccent);
  if (customAccent) result.customAccent = customAccent;
  const customTheme = normalizeThemeColor(source.customTheme);
  if (customTheme) result.customTheme = customTheme;
  else if (!Object.hasOwn(source, 'customTheme') && customAccent) result.customTheme = customAccent;
  for (const key of ['followSystem', 'blackAtNight', 'autoNight', 'customThemeDark', 'materialEnabled', 'materialFollowSystem', 'showFastReturnView', 'showFPS', 'backgroundEnabled']) if (typeof source[key] === 'boolean') result[key] = source[key];
  for (const [key, minimum] of [['backgroundOpacity', 0], ['surfaceOpacity', .4]]) if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= minimum && source[key] <= 1) result[key] = Math.round(source[key] * 100) / 100;
  // Upgrade only the exact legacy preset. Deliberate transparency choices and
  // all version-2 values (including this old pair) keep their saved values.
  if ((source.version === undefined || source.version === 1) && source.backgroundOpacity === .28 && source.surfaceOpacity === .94) {
    result.backgroundOpacity = DEFAULT_PREFERENCES.backgroundOpacity;
    result.surfaceOpacity = DEFAULT_PREFERENCES.surfaceOpacity;
  }
  for (const key of ['nightStart', 'nightEnd']) if (clockMinutes(source[key]) !== null) result[key] = source[key];
  if (result.nightStart === result.nightEnd) { result.nightStart = DEFAULT_PREFERENCES.nightStart; result.nightEnd = DEFAULT_PREFERENCES.nightEnd; }
  return result;
}
export function loadPreferences(storage) {
  try {
    const saved = storage.getItem(PREFERENCES_KEY);
    if (saved) { try { return normalizePreferences(JSON.parse(saved)); } catch { /* Preserve a prior valid theme below. */ } }
    const legacy = storage.getItem(LEGACY_THEME_KEY);
    if (themes.has(legacy)) return normalizePreferences({ theme: legacy, followSystem: false });
  } catch { /* Unavailable browser storage uses in-memory defaults. */ }
  return { ...DEFAULT_PREFERENCES };
}
export function savePreferences(storage, value) {
  const next = normalizePreferences(value);
  storage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  return next;
}
export function isNightTime(date, start = '22:00', end = '06:00') {
  const first = clockMinutes(start), last = clockMinutes(end);
  if (first === null || last === null || first === last || !(date instanceof Date) || !Number.isFinite(date.getTime())) return false;
  const minute = date.getHours() * 60 + date.getMinutes();
  return first < last ? minute >= first && minute < last : minute >= first || minute < last;
}
export function resolveTheme(value, systemDark = false, date = new Date()) {
  const preferences = normalizePreferences(value), night = preferences.blackAtNight ? 'black' : 'dark';
  if (preferences.followSystem) return systemDark ? night : 'light';
  if (preferences.autoNight) return isNightTime(date, preferences.nightStart, preferences.nightEnd) ? night : 'light';
  return preferences.theme;
}
export function preferenceFontScale(value) {
  return ({ system: 1, standard: 1, large: 1.15, small: 0.9 })[normalizePreferences(value).fontSize];
}
function rgb(color) { return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)); }
function mix(color, target, proportion) {
  const source = rgb(color), end = rgb(target);
  return '#' + source.map((channel, index) => Math.round(channel + (end[index] - channel) * proportion).toString(16).padStart(2, '0')).join('');
}
function luminance(color) {
  return rgb(color).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
export function themeColorContrast(first, second) {
  const a = normalizeThemeColor(first), b = normalizeThemeColor(second);
  if (!a || !b) return 0;
  const light = luminance(a), dark = luminance(b);
  return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05);
}
function readableAccent(color, background, dark) {
  // Keep the official seed as the primary/header color. Adjust only the small
  // text/link token, so orange/pink and arbitrary custom colors remain legible.
  if (themeColorContrast(color, background) >= 4.5) return color;
  const target = dark ? '#ffffff' : '#000000';
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(color, target, step / 100);
    if (themeColorContrast(candidate, background) >= 4.5) return candidate;
  }
  return target;
}
function onColor(color) { return themeColorContrast(color, '#ffffff') >= themeColorContrast(color, '#000000') ? '#ffffff' : '#000000'; }
export function preferenceThemeVariables(value, theme = resolveTheme(value)) {
  const preferences = normalizePreferences(value), dark = theme === 'dark' || theme === 'black';
  const seed = preferences.palette === 'custom' ? preferences.customAccent : THEME_PALETTES.find(palette => palette.id === preferences.palette).color;
  const primary = preferences.palette === 'custom' ? preferences.customTheme : seed;
  const surface = theme === 'black' ? '#0b0b0b' : dark ? '#202823' : '#ffffff';
  const accent = readableAccent(seed, surface, dark), header = dark || preferences.palette === 'white' ? surface : primary;
  const headerText = dark ? '#e3ebe6' : preferences.palette === 'white' ? '#26322d' : preferences.palette === 'custom' ? preferences.customThemeDark ? '#ffffff' : '#000000' : onColor(header);
  return {
    '--theme-primary': primary, '--theme-primary-on': preferences.palette === 'custom' ? preferences.customThemeDark ? '#ffffff' : '#000000' : onColor(primary), '--theme-accent': seed,
    '--accent': accent, '--accent-hover': mix(accent, dark ? '#ffffff' : '#000000', .18),
    '--accent-soft': mix(accent, surface, dark ? .8 : .91), '--accent-on': onColor(accent),
    '--theme-header': header, '--theme-header-text': headerText,
    '--theme-header-muted': mix(headerText, header, .15), '--theme-header-border': mix(headerText, header, .85),
  };
}
