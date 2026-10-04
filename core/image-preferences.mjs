export const IMAGE_PREFERENCES_KEY = 'coolapk-image-preferences';
export const DEFAULT_IMAGE_PREFERENCES = Object.freeze({ version: 1, livePhotoAudio: false, browsingMode: 'original' });
export function normalizeImagePreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_IMAGE_PREFERENCES,
    ...(typeof source.livePhotoAudio === 'boolean' ? { livePhotoAudio: source.livePhotoAudio } : {}),
    ...(['original', 'normal', 'auto'].includes(source.browsingMode) ? { browsingMode: source.browsingMode } : {}),
  };
}
export function loadImagePreferences(storage) {
  try { return normalizeImagePreferences(JSON.parse(storage.getItem(IMAGE_PREFERENCES_KEY) || 'null')); }
  catch { return { ...DEFAULT_IMAGE_PREFERENCES }; }
}
export function saveImagePreferences(storage, value) {
  const next = normalizeImagePreferences(value);
  storage.setItem(IMAGE_PREFERENCES_KEY, JSON.stringify(next)); return next;
}
function imageSource(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}
export function preferOriginalImage(preferences, network = {}) {
  const mode = normalizeImagePreferences(preferences).browsingMode;
  if (mode !== 'auto') return mode === 'original';
  // Android's AUTO mode reads a connection-state boolean and defaults false.
  // A desktop whose renderer cannot identify the transport also uses normal
  // quality, rather than incorrectly declaring an unknown link unmetered.
  return network.saveData !== true && ['wifi', 'ethernet'].includes(network.type);
}
export function preferredImageSource(item, preferences, forceOriginal = false, network = {}) {
  const source = imageSource(item?.source), cover = imageSource(item?.cover);
  if (forceOriginal || preferOriginalImage(preferences, network)) return source || cover;
  // Use the compressed URL the server actually returned; do not guess CDN
  // suffixes or rewrite a Live Photo source into an invented static asset.
  return cover || source;
}
