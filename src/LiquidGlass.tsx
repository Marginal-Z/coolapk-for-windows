import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { glassGeometry, glassPixels } from '../core/liquid-glass.mjs';
import { useTransparencyState } from './preferences';

type OpticalMap = { id: string; url: string; scale: number; dispersion: boolean };
const maps = new Map<string, OpticalMap>();
let serial = 0;
function opticalMap(width: number, height: number, radius: number, dispersion = false): OpticalMap | undefined {
  const geometry = glassGeometry(width, height, radius);
  const key = `${width}:${height}:${radius}:${dispersion}`;
  const cached = maps.get(key); if (cached) { maps.delete(key); maps.set(key, cached); return cached; }
  const canvas = document.createElement('canvas'); canvas.width = geometry.rasterWidth; canvas.height = geometry.rasterHeight;
  const context = canvas.getContext('2d'); if (!context) return;
  const pixels = context.createImageData(canvas.width, canvas.height); pixels.data.set(glassPixels(geometry));
  context.putImageData(pixels, 0, 0);
  const map = { id: `coolapk-desktop-glass-${++serial}`, url: canvas.toDataURL('image/png'), scale: geometry.scale, dispersion };
  maps.set(key, map); if (maps.size > 48) maps.delete(maps.keys().next().value!);
  return map;
}

// Each independently painted plane gets optics measured in CSS pixels. The
// observer never reads posts or captures the screen; Chromium samples backdrop.
const owners = '.sidebar,.topbar,.right-rail,.main-scroll>.page-heading,.home-feed-header,.home-section,.catalog-screen>.tabs,.feed-card,.entity-card,.profile-card,.modal,.detail-panel,.toast,.preferences-material-sample,.preferences-background-sample,.desktop-return-top,.phone-device,.phone-help,.phone-screen-mode,.download-task,.community-header,.community-live,.notification-row,.catalog-hub>button,.catalog-specs,.catalog-gallery-item,.catalog-version-list article,.catalog-rating-summary,.app-introduction,.goods-hub>button,.goods-card,.goods-list-card,.goods-detail-header,.goods-item,.personal-hub>button,.personal-backup-list>button,.personal-backup-list>article,.personal-backup-summary,.personal-dyh-card,.secondhand-filters,.secondhand-model,.ac-panel,.ac-mine-counts,.ac-mine-grid,.ac-mine-card,.search-suggestions,.error-notice,.skeleton-feed,.teenager-card,.navigation-glass-lens,.search-box';

function OpticalFilter({ map, id = map.id }: { map: OpticalMap; id?: string }) {
  return <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feImage href={map.url} x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="glass-map" />
    {/* An 8-bit neutral value of 128 is 128/255, not 0.5. Correct it so the
        flat interior is stationary instead of shifting the entire backdrop. */}
    <feColorMatrix in="glass-map" type="matrix" values="1 0 0 0 -.0019607843  0 1 0 0 -.0019607843  0 0 1 0 0  0 0 0 1 0" result="glass-vectors" />
    {map.dispersion ? <>
      <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale * .98} xChannelSelector="R" yChannelSelector="G" result="red-warp" />
      <feColorMatrix in="red-warp" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
      <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale} xChannelSelector="R" yChannelSelector="G" result="green-warp" />
      <feColorMatrix in="green-warp" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
      <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale * 1.02} xChannelSelector="R" yChannelSelector="G" result="blue-warp" />
      <feColorMatrix in="blue-warp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
      <feBlend in="red" in2="green" mode="screen" result="red-green" /><feBlend in="red-green" in2="blue" mode="screen" />
    </> : <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale} xChannelSelector="R" yChannelSelector="G" />}
  </filter>;
}

export function LiquidGlassDefinitions({ enabled, followSystem }: { enabled: boolean; followSystem: boolean }) {
  const { highContrast, reducedTransparency } = useTransparencyState();
  const active = enabled && !highContrast && !(followSystem && reducedTransparency);
  const [definitions, setDefinitions] = useState<OpticalMap[]>([]);
  const [fallback] = useState(() => opticalMap(256, 128, 18));
  useEffect(() => {
    if (!active) { setDefinitions([]); return; }
    let frame = 0, signature = '';
    const original = new Map<HTMLElement, string>();
    const resize = new ResizeObserver(() => schedule());
    const restore = (node: HTMLElement) => { const value = original.get(node); if (value) node.style.setProperty('--glass-refraction', value); else node.style.removeProperty('--glass-refraction'); original.delete(node); resize.unobserve(node); };
    const refresh = () => {
      frame = 0; if (document.hidden) return;
      const next = new Map<string, OpticalMap>(), visible = new Set<HTMLElement>();
      for (const node of document.querySelectorAll<HTMLElement>(owners)) {
        if (next.size >= 40) break;
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 2 || bounds.height < 2 || bounds.bottom <= 0 || bounds.right <= 0 || bounds.top >= innerHeight || bounds.left >= innerWidth) continue;
        const style = getComputedStyle(node);
        if (style.backdropFilter === 'none') continue; // Nested planes and accessible fallback.
        visible.add(node);
        if (!original.has(node)) { original.set(node, node.style.getPropertyValue('--glass-refraction')); resize.observe(node); }
        // Quantization bounds cache churn during continuous window resizing.
        const w = Math.max(2, Math.round(bounds.width / 2) * 2), h = Math.max(2, Math.round(bounds.height / 2) * 2);
        const corner = style.borderTopLeftRadius;
        const radius = corner.includes('%') ? parseFloat(corner) * Math.min(w, h) / 100 : parseFloat(corner) || 0;
        const map = opticalMap(w, h, Math.round(Math.min(radius, w / 2, h / 2)), node.matches('.navigation-glass-lens,.preferences-material-sample'));
        if (map) { node.style.setProperty('--glass-refraction', `url(#${map.id})`); next.set(map.id, map); }
      }
      for (const node of original.keys()) if (!visible.has(node)) restore(node);
      const nextSignature = [...next.keys()].join(',');
      if (signature !== nextSignature) { signature = nextSignature; setDefinitions([...next.values()]); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    const theme = new MutationObserver(schedule); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    document.addEventListener('scroll', schedule, true); document.addEventListener('visibilitychange', schedule); window.addEventListener('resize', schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); mutation.disconnect(); theme.disconnect(); resize.disconnect(); document.removeEventListener('scroll', schedule, true); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('resize', schedule); for (const node of original.keys()) restore(node); };
  }, [active]);
  return <svg className="desktop-glass-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>{fallback && <OpticalFilter map={fallback} id="coolapk-desktop-glass" />}{definitions.map(map => <OpticalFilter key={map.id} map={map} />)}</defs></svg>;
}

export function LiquidGlassNavigation({ label, selectionKey, children }: { label: string; selectionKey: string; children: ReactNode }) {
  const host = useRef<HTMLElement>(null), lens = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const nav = host.current, glass = lens.current; if (!nav || !glass) return;
    const update = () => {
      const selected = nav.querySelector<HTMLElement>('.nav-item.selected');
      nav.dataset.glassSelected = String(!!selected);
      if (!selected) { glass.hidden = true; return; }
      const x = selected.offsetLeft, y = selected.offsetTop, w = selected.offsetWidth, h = selected.offsetHeight;
      glass.hidden = false;
      glass.style.width = `${w}px`; glass.style.height = `${h}px`;
      glass.style.transform = `translate3d(${x}px,${y}px,0)`;
    };
    update(); const observer = new ResizeObserver(update); observer.observe(nav);
    for (const button of nav.querySelectorAll('.nav-item')) observer.observe(button);
    return () => observer.disconnect();
  }, [selectionKey]);
  return <nav ref={host} className="glass-navigation" aria-label={label}><span ref={lens} className="navigation-glass-lens" aria-hidden="true" hidden />{children}</nav>;
}
