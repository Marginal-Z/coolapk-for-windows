export const HEADLINE_CACHE_PREFIX = 'coolapk-headline-cache:v1:';
export const HEADLINE_CACHE_MAX_BYTES = 2 * 1024 * 1024;

function cacheKey(namespace) {
  if (typeof namespace !== 'string' || !namespace || namespace.length > 128) return '';
  return HEADLINE_CACHE_PREFIX + encodeURIComponent(namespace);
}

function isHeadlineResult(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Array.isArray(value.data) || Array.isArray(value.surfaceItems));
}

export function loadHeadlineCache(storage, namespace) {
  const key = cacheKey(namespace);
  if (!key || !storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== 'string' || !raw) return null;
    if (new TextEncoder().encode(raw).byteLength > HEADLINE_CACHE_MAX_BYTES) {
      storage.removeItem?.(key);
      return null;
    }
    const entry = JSON.parse(raw);
    if (entry?.version !== 1 || !Number.isSafeInteger(entry.savedAt) || !isHeadlineResult(entry.result)) {
      storage.removeItem?.(key);
      return null;
    }
    return entry.result;
  } catch {
    try { storage.removeItem?.(key); } catch { /* Storage can be unavailable or read-only. */ }
    return null;
  }
}

export function saveHeadlineCache(storage, namespace, result, now = Date.now()) {
  const key = cacheKey(namespace);
  if (!key || !storage || typeof storage.setItem !== 'function' || !isHeadlineResult(result) || !Number.isSafeInteger(now)) return false;
  try {
    const raw = JSON.stringify({ version: 1, savedAt: now, result });
    if (new TextEncoder().encode(raw).byteLength > HEADLINE_CACHE_MAX_BYTES) return false;
    storage.setItem(key, raw);
    return true;
  } catch { return false; }
}

export function clearHeadlineCache(storage, namespace) {
  const key = cacheKey(namespace);
  if (!key || !storage || typeof storage.removeItem !== 'function') return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}
