import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageViewerContent } from './components';
import { unwrap } from './data';
import type { ImageViewerPayload } from './types';
import { loadPreferences, preferenceFontScale, preferenceThemeVariables, resolveTheme } from '../core/preferences.mjs';
import './styles.css';
import './image-viewer.css';

function ImageViewerWindow() {
  const [payload, setPayload] = useState<ImageViewerPayload>(), [error, setError] = useState('');
  const close = () => { void window.coolapkImageViewer?.close(); };
  useEffect(() => {
    let active = true;
    void unwrap(window.coolapkImageViewer?.state()).then(value => { if (active) setPayload(value); }).catch(failure => { if (active) setError(failure.message); });
    const appearance = () => {
      const preferences = loadPreferences(localStorage), theme = resolveTheme(preferences, matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = theme;
      for (const [key, value] of Object.entries(preferenceThemeVariables(preferences, theme))) document.documentElement.style.setProperty(key, String(value));
      document.documentElement.style.setProperty('--font-scale', String(preferenceFontScale(preferences)));
    };
    appearance(); window.addEventListener('storage', appearance);
    const system = matchMedia('(prefers-color-scheme: dark)'); system.addEventListener('change', appearance);
    return () => { active = false; window.removeEventListener('storage', appearance); system.removeEventListener('change', appearance); };
  }, []);
  useEffect(() => {
    if (payload) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [payload]);
  return payload ? <ImageViewerContent {...payload} standalone onClose={close} /> : <main className="image-viewer-window"><header className="modal-header"><h2>图片</h2></header><p role={error ? 'alert' : 'status'}>{error || '正在加载图片…'}</p></main>;
}
createRoot(document.getElementById('root')!).render(<ImageViewerWindow />);
