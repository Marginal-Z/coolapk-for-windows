// History is scoped to a desktop account. Older unscoped data has no proven
// owner, so it is never silently attached to a different account.
export function historyStorageKey(namespace = 'guest') {
  if (typeof namespace !== 'string' || !namespace || namespace.length > 120 || /[\x00-\x1f\x7f]/.test(namespace)) throw new Error('浏览历史账号无效');
  return 'coolapk-history:' + encodeURIComponent(namespace);
}
export function readLocalHistory(storage, namespace) {
  try {
    const data = JSON.parse(storage.getItem(historyStorageKey(namespace)) || '[]');
    return Array.isArray(data) ? data.filter(row => row && typeof row === 'object' && !Array.isArray(row) && /^[1-9]\d{0,19}$/.test(String(row.id))).slice(0, 150) : [];
  } catch { return []; }
}
export function saveLocalHistory(storage, namespace, items) {
  storage.setItem(historyStorageKey(namespace), JSON.stringify(items.slice(0, 150)));
}
export function clearLocalHistory(storage, namespace) {
  storage.removeItem(historyStorageKey(namespace));
  storage.removeItem('coolapk-history');
}
