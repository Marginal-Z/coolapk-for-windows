import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import type { Preferences } from '../core/preferences.mjs';
import { materialEffectReadability } from '../core/material-readability.mjs';
import { LiquidGlassDefinitions } from './LiquidGlass';
import './desktop-effects.css';

function FrameRate() {
  const [fps, setFPS] = useState<number>();
  useEffect(() => {
    let frame = 0, count = 0, start: number | undefined;
    const tick = (time: number) => {
      if (document.hidden) return;
      if (start === undefined) start = time;
      else { count++; const elapsed = time - start; if (elapsed >= 1000) { setFPS(Math.round(count * 1000 / elapsed)); count = 0; start = time; } }
      frame = requestAnimationFrame(tick);
    };
    const resume = () => { cancelAnimationFrame(frame); count = 0; start = undefined; setFPS(undefined); if (!document.hidden) frame = requestAnimationFrame(tick); };
    resume(); document.addEventListener('visibilitychange', resume);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', resume); };
  }, []);
  return <output className="desktop-fps" aria-label="页面帧率" title="当前窗口动画帧回调频率；窗口隐藏时暂停统计">{fps === undefined ? '—' : fps} FPS</output>;
}
function ReturnTop() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let scheduled = 0;
    const refresh = () => {
      scheduled = 0;
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(node => node.getClientRects().length);
      const dialog = dialogs.at(-1), candidate = dialog ? dialog.querySelector<HTMLElement>('.detail-scroll') || dialog : document.querySelector<HTMLElement>('.main-scroll');
      setTarget(candidate && candidate.getClientRects().length && candidate.scrollTop > Math.min(300, candidate.clientHeight / 2) ? candidate : null);
    };
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(refresh); };
    const observer = new MutationObserver(schedule); observer.observe(document.body, { subtree: true, childList: true });
    document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); refresh();
    return () => { observer.disconnect(); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); cancelAnimationFrame(scheduled); };
  }, []);
  if (!target) return null;
  const portal = target.closest('[role="dialog"]') || document.body;
  return createPortal(<button type="button" className="desktop-return-top" aria-label="返回顶部" onClick={() => { target.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }}><ArrowUp size={19} /></button>, portal);
}
export function DesktopEffects({ preferences, backgroundActive = false }: { preferences: Preferences; backgroundActive?: boolean }) {
  useEffect(() => {
    const root = document.documentElement;
    const names = ['--material-reading-opacity', '--material-reading-floor', '--material-muted', '--material-accent', '--material-accent-on', '--material-accent-hover', '--material-header-opacity', '--material-header-text'];
    const previous = names.map(name => root.style.getPropertyValue(name)); let signature = '';
    const refresh = () => {
      const style = getComputedStyle(root), inputs = {
        theme: root.dataset.theme, opacity: preferences.surfaceOpacity,
        effect: preferences.materialEffect,
        surface: style.getPropertyValue('--surface').trim(), body: style.getPropertyValue('--text').trim(),
        muted: style.getPropertyValue('--muted').trim(), accent: style.getPropertyValue('--accent').trim(),
        header: style.getPropertyValue('--theme-header').trim(), headerText: style.getPropertyValue('--theme-header-text').trim(),
      };
      const next = JSON.stringify(inputs); if (next === signature) return; signature = next;
      const result = materialEffectReadability(inputs);
      const values = [`${result.opacity * 100}%`, `${result.floor * 100}%`, result.muted, result.accent, result.accentOn, result.accentHover, `${result.headerOpacity * 100}%`, result.headerText];
      names.forEach((name, index) => root.style.setProperty(name, values[index]));
    };
    // Palette/theme writes finish in the parent effect. Observe only root
    // metadata; unchanged input signatures stop our own token writes looping.
    const observer = new MutationObserver(refresh); observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'style'] }); refresh();
    return () => { observer.disconnect(); names.forEach((name, index) => { if (previous[index]) root.style.setProperty(name, previous[index]); else root.style.removeProperty(name); }); };
  }, [preferences.surfaceOpacity, preferences.materialEffect]);
  useEffect(() => {
    const root = document.documentElement, previous = root.dataset.materialEffect, followSystem = root.dataset.materialFollowSystem, enabled = root.dataset.materialEnabled;
    root.dataset.materialEnabled = String(preferences.materialEnabled);
    if (preferences.materialEnabled) root.dataset.materialEffect = preferences.materialEffect;
    else delete root.dataset.materialEffect;
    root.dataset.materialFollowSystem = String(preferences.materialFollowSystem);
    return () => {
      if (previous) root.dataset.materialEffect = previous; else delete root.dataset.materialEffect;
      if (followSystem === undefined) delete root.dataset.materialFollowSystem; else root.dataset.materialFollowSystem = followSystem;
      if (enabled === undefined) delete root.dataset.materialEnabled; else root.dataset.materialEnabled = enabled;
    };
  }, [preferences.materialEnabled, preferences.materialEffect, preferences.materialFollowSystem]);
  useEffect(() => {
    const root = document.documentElement, previous = root.dataset.customBackground;
    const opacity = root.style.getPropertyValue('--surface-opacity');
    root.dataset.customBackground = String(backgroundActive);
    root.style.setProperty('--surface-opacity', `${Math.round(preferences.surfaceOpacity * 100)}%`);
    return () => {
      if (previous === undefined) delete root.dataset.customBackground; else root.dataset.customBackground = previous;
      if (opacity) root.style.setProperty('--surface-opacity', opacity); else root.style.removeProperty('--surface-opacity');
    };
  }, [backgroundActive, preferences.surfaceOpacity]);
  return <><LiquidGlassDefinitions enabled={preferences.materialEnabled && preferences.materialEffect === 'full'} followSystem={preferences.materialFollowSystem} />{preferences.showFPS && <FrameRate />}{preferences.showFastReturnView && <ReturnTop />}</>;
}
