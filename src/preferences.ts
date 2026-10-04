import { useCallback, useEffect, useState } from 'react';
import { loadPreferences, normalizePreferences, preferenceFontScale, resolveTheme, savePreferences, type Preferences } from '../core/preferences.mjs';
export type { Preferences, FontPreference, ThemePreference } from '../core/preferences.mjs';

export function usePreferences(nativeSystemDark?: boolean) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try { return loadPreferences(window.localStorage); }
    catch { return normalizePreferences(null); }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [now, setNow] = useState(() => new Date());
  const [preferenceError, setPreferenceError] = useState('');
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)'), changed = () => setSystemDark(query.matches);
    changed(); query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const update = () => setNow(new Date());
    // Minute boundaries are sufficient for minute-precision settings. Focus also
    // repairs suspended timers and local timezone/clock changes after sleep.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { update(); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20); };
    timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    try { savePreferences(window.localStorage, preferences); setPreferenceError(''); }
    catch { setPreferenceError('当前设置已生效，但未能保存到本机。请检查存储空间后重试。'); }
  }, [preferences]);
  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences(previous => normalizePreferences({ ...previous, ...patch }));
  }, []);
  return { preferences, updatePreferences, preferenceError, resolvedTheme: resolveTheme(preferences, nativeSystemDark ?? systemDark, now), fontScale: preferenceFontScale(preferences) };
}
