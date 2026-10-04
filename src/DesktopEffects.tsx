import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import type { Preferences } from '../core/preferences.mjs';
import './desktop-effects.css';

// Neutral in the middle, outward surface normals at the rounded rim. A
// negative SVG scale samples inward and magnifies the background at the edge.
function glassMap() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext('2d'); if (!context) return '';
  const image = context.createImageData(canvas.width, canvas.height), radius = 18, rim = 14;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const dx = x + .5 - canvas.width / 2, dy = y + .5 - canvas.height / 2;
    const qx = Math.abs(dx) - (canvas.width / 2 - radius), qy = Math.abs(dy) - (canvas.height / 2 - radius);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const distance = outside + Math.min(Math.max(qx, qy), 0) - radius;
    const strength = distance < 0 ? Math.max(0, 1 + distance / rim) ** 2 : 0;
    const nx = qx > 0 && qy > 0 ? Math.sign(dx) * qx / outside : qx > qy ? Math.sign(dx) : 0;
    const ny = qx > 0 && qy > 0 ? Math.sign(dy) * qy / outside : qy >= qx ? Math.sign(dy) : 0;
    const offset = (y * canvas.width + x) * 4;
    image.data[offset] = Math.round(128 + nx * strength * 127); image.data[offset + 1] = Math.round(128 + ny * strength * 127); image.data[offset + 2] = 128; image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0); return canvas.toDataURL('image/png');
}
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
export function DesktopEffects({ preferences }: { preferences: Preferences }) {
  const map = useMemo(glassMap, []);
  useEffect(() => {
    const root = document.documentElement, previous = root.dataset.materialEffect;
    root.dataset.materialEffect = preferences.materialEffect;
    return () => { if (previous) root.dataset.materialEffect = previous; else delete root.dataset.materialEffect; };
  }, [preferences.materialEffect]);
  return <><svg className="desktop-glass-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs><filter id="coolapk-desktop-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB"><feImage href={map} x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="glass-map" /><feDisplacementMap in="SourceGraphic" in2="glass-map" scale="-22" xChannelSelector="R" yChannelSelector="G" /></filter></defs></svg>{preferences.showFPS && <FrameRate />}{preferences.showFastReturnView && <ReturnTop />}</>;
}
