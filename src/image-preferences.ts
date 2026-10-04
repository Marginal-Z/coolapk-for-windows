import { useEffect, useState, useSyncExternalStore } from 'react';
import { IMAGE_PREFERENCES_KEY, loadImagePreferences, normalizeImagePreferences, saveImagePreferences, type ImagePreferences } from '../core/image-preferences.mjs';
export type { ImagePreferences, ImageBrowsingMode } from '../core/image-preferences.mjs';

type Snapshot = { imagePreferences: ImagePreferences; imagePreferenceError: string };
let snapshot: Snapshot | undefined;
const listeners = new Set<() => void>();
function read(): Snapshot {
  if (!snapshot) {
    let imagePreferences: ImagePreferences;
    try { imagePreferences = loadImagePreferences(window.localStorage); } catch { imagePreferences = normalizeImagePreferences(null); }
    snapshot = { imagePreferences, imagePreferenceError: '' };
  }
  return snapshot;
}
function emit() { for (const listener of listeners) listener(); }
function storageChanged(event: StorageEvent) {
  if (event.key !== null && event.key !== IMAGE_PREFERENCES_KEY) return;
  const previous = read(); let next: ImagePreferences;
  try { if (event.storageArea !== window.localStorage) return; next = loadImagePreferences(window.localStorage); }
  catch { return; }
  if (JSON.stringify(previous.imagePreferences) !== JSON.stringify(next) || previous.imagePreferenceError) { snapshot = { imagePreferences: next, imagePreferenceError: '' }; emit(); }
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', storageChanged);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', storageChanged); };
}
export function updateImagePreferences(patch: Partial<ImagePreferences>) {
  const imagePreferences = normalizeImagePreferences({ ...read().imagePreferences, ...patch }); let imagePreferenceError = '';
  try { saveImagePreferences(window.localStorage, imagePreferences); }
  catch { imagePreferenceError = '当前图片设置已生效，但未能保存到本机。请检查存储空间后重试。'; }
  snapshot = { imagePreferences, imagePreferenceError }; emit();
}
export function useImagePreferences() {
  return { ...useSyncExternalStore(subscribe, read, read), updateImagePreferences };
}
type ImageConnection = EventTarget & { type?: string; saveData?: boolean };
export function useImageNetwork() {
  const connection = (navigator as Navigator & { connection?: ImageConnection }).connection;
  const describe = () => ({ type: connection?.type, saveData: connection?.saveData });
  const [network, setNetwork] = useState(describe);
  useEffect(() => { const changed = () => setNetwork(describe()); connection?.addEventListener('change', changed); return () => connection?.removeEventListener('change', changed); }, [connection]);
  return network;
}
