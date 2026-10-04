export const PREFERENCES_KEY = 'coolapk-preferences';
export const LEGACY_THEME_KEY = 'coolapk-theme';
export const DEFAULT_PREFERENCES = Object.freeze({
  version: 1, fontSize: 'system', theme: 'light', followSystem: true,
  blackAtNight: false, autoNight: false, nightStart: '22:00', nightEnd: '06:00',
});
const themes = new Set(['light', 'dark', 'black']);
const fontSizes = new Set(['system', 'large', 'standard', 'small']);
export function clockMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes;
}
export function normalizePreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULT_PREFERENCES };
  if (themes.has(source.theme)) result.theme = source.theme;
  if (fontSizes.has(source.fontSize)) result.fontSize = source.fontSize;
  for (const key of ['followSystem', 'blackAtNight', 'autoNight']) if (typeof source[key] === 'boolean') result[key] = source[key];
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
