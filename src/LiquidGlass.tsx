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
const owners = '.sidebar,.topbar,.right-rail,.main-scroll>.page-heading,.home-feed-header,.home-section,.catalog-screen>.tabs,.feed-card,.entity-card,.profile-card,.modal,.detail-panel,.toast,.preferences-material-sample,.preferences-background-sample,.desktop-return-top,.phone-device,.phone-help,.phone-screen-mode,.download-task,.download-directory-settings,.community-header,.community-live,.notification-row,.catalog-hub>button,.catalog-specs,.catalog-gallery-item,.catalog-version-list article,.catalog-rating-summary,.app-introduction,.goods-hub>button,.goods-card,.goods-list-card,.goods-detail-header,.goods-item,.personal-hub>button,.personal-backup-list>button,.personal-backup-list>article,.personal-backup-summary,.personal-dyh-card,.secondhand-filters,.secondhand-model,.ac-panel,.ac-mine-counts,.ac-mine-grid,.ac-mine-card,.search-suggestions,.error-notice,.skeleton-feed,.teenager-card,.navigation-glass-lens,.search-box,.picture-poster';

function OpticalFilter({ map, id = map.id }: { map: OpticalMap; id?: string }) {
  return <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feImage href={map.url} x="0%" y="0%" width="100%" height="100%" preserveAspectRatio="none" result="glass-map" />
    {/* An 8-bit neutral value of 128 is 128/255, not 0.5. Correct it so the
        flat interior is stationary instead of shifting the entire backdrop. */}
    <feColorMatrix in="glass-map" type="matrix" values="1 0 0 0 -.0019607843  0 1 0 0 -.0019607843  0 0 1 0 0  0 0 0 1 0" result="glass-vectors" />
    {map.dispersion ? <>
      <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale * .98} xChannelSelector="R" yChannelSelector="G" result="red-warp" />
      <feColorMatrix in="red-warp" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="red" />
      <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale} xChannelSelector="R" yChannelSelector="G" result="green-warp" />
      <feColorMatrix in="green-warp" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1" result="green" />
      <feDisplacementMap in="SourceGraphic" in2="glass-vectors" scale={map.scale * 1.02} xChannelSelector="R" yChannelSelector="G" result="blue-warp" />
      <feColorMatrix in="blue-warp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1" result="blue" />
      {/* Blend opaque color channels, then restore one source alpha. Keeping
          alpha on all three channels would compound the backdrop opacity. */}
      <feBlend in="red" in2="green" mode="screen" result="red-green" /><feBlend in="red-green" in2="blue" mode="screen" result="glass-color" />
      <feComposite in="glass-color" in2="green-warp" operator="in" />
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
    let frame = 0, signature = '', disposed = false;
    type Owner = { original: string; priority: string; applied?: string; map?: OpticalMap };
    const registered = new Map<HTMLElement, Owner>(), visible = new Set<HTMLElement>(), dirty = new Set<HTMLElement>(), painted = new Set<HTMLElement>();
    const restore = (node: HTMLElement) => {
      const owner = registered.get(node); if (!owner?.applied) return;
      if (owner.original) node.style.setProperty('--glass-refraction', owner.original, owner.priority); else node.style.removeProperty('--glass-refraction');
      owner.applied = undefined; painted.delete(node);
    };
    const invalidate = (node: HTMLElement) => { dirty.add(node); schedule(); };
    const resize = new ResizeObserver(entries => { for (const entry of entries) if (registered.has(entry.target as HTMLElement)) invalidate(entry.target as HTMLElement); });
    // Chromium tracks intersection through the actual scroll/clipping roots.
    // Scroll events therefore need no JS owner scan or repeated style reads.
    const intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const node = entry.target as HTMLElement; if (!registered.has(node)) continue;
        if (entry.isIntersecting) { visible.add(node); dirty.add(node); }
        else visible.delete(node);
      }
      schedule();
    });
    const register = (node: HTMLElement) => {
      if (!registered.has(node)) {
        registered.set(node, { original: node.style.getPropertyValue('--glass-refraction'), priority: node.style.getPropertyPriority('--glass-refraction') });
        resize.observe(node); intersection.observe(node);
      }
      invalidate(node);
    };
    const unregister = (node: HTMLElement) => {
      restore(node); registered.delete(node); visible.delete(node); dirty.delete(node); resize.unobserve(node); intersection.unobserve(node);
      schedule();
    };
    const discover = (root: HTMLElement) => {
      if (root.matches(owners)) register(root);
      if (root.childElementCount) for (const node of root.querySelectorAll<HTMLElement>(owners)) register(node);
    };
    const updateSubtree = (root: HTMLElement, discoverNew = true) => {
      for (const node of registered.keys()) if (node === root || root.contains(node)) {
        if (!node.isConnected || !node.matches(owners)) unregister(node); else invalidate(node);
      }
      if (discoverNew && root.isConnected) discover(root);
    };
    const invalidateStyles = () => { for (const node of registered.keys()) dirty.add(node); schedule(); };
    const refresh = () => {
      frame = 0; if (disposed || document.hidden) return;
      // Finish all geometry/style reads before assigning any filter variables.
      // Entries keep their geometry until resized, restyled or newly visible.
      for (const node of dirty) {
        if (!visible.has(node)) continue;
        dirty.delete(node);
        const owner = registered.get(node); if (!owner) continue;
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 2 || bounds.height < 2) { owner.map = undefined; continue; }
        // Shell backgrounds are sibling pseudo-elements, so navigation/search
        // are not trapped inside the containers' filtered BackdropRoots.
        const style = getComputedStyle(node, node.matches('.sidebar,.topbar') ? '::before' : null);
        if (style.backdropFilter === 'none') { owner.map = undefined; continue; } // Nested planes and accessible fallback.
        // Quantization bounds cache churn during continuous window resizing.
        const w = Math.max(2, Math.round(bounds.width / 2) * 2), h = Math.max(2, Math.round(bounds.height / 2) * 2);
        const corner = style.borderTopLeftRadius;
        const radius = corner.includes('%') ? parseFloat(corner) * Math.min(w, h) / 100 : parseFloat(corner) || 0;
        owner.map = opticalMap(w, h, Math.round(Math.min(radius, w / 2, h / 2)), node.matches('.navigation-glass-lens,.preferences-material-sample'));
      }
      const next = new Map<string, OpticalMap>(), selected = new Set<HTMLElement>();
      for (const node of visible) {
        const owner = registered.get(node), map = owner?.map; if (!owner || !map || (next.size >= 40 && !next.has(map.id))) continue;
        next.set(map.id, map); selected.add(node);
        const value = `url(#${map.id})`;
        if (owner.applied !== value) { node.style.setProperty('--glass-refraction', value); owner.applied = value; painted.add(node); }
      }
      for (const node of painted) if (!selected.has(node)) restore(node);
      const nextSignature = [...next.keys()].join(',');
      if (signature !== nextSignature) { signature = nextSignature; setDefinitions([...next.values()]); }
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(refresh); };
    const withoutOptics = (style: string | null) => (style || '').replace(/(?:^|;)\s*--glass-refraction\s*:[^;]*(?=;|$)/g, '').replace(/^;|;$/g, '').trim();
    const mutation = new MutationObserver(records => {
      for (const record of records) {
        // React adds/removes our own SVG definitions. They contain no owners.
        if (!(record.target instanceof HTMLElement)) continue;
        if (record.type === 'childList') {
          for (const removed of record.removedNodes) if (removed instanceof HTMLElement) updateSubtree(removed);
          for (const added of record.addedNodes) if (added instanceof HTMLElement && added.isConnected) discover(added);
        } else if (record.attributeName !== 'style' || withoutOptics(record.oldValue) !== withoutOptics(record.target.getAttribute('style'))) updateSubtree(record.target, record.attributeName === 'class');
      }
    });
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'style'] });
    const theme = new MutationObserver(invalidateStyles); theme.observe(document.documentElement, { attributes: true });
    document.addEventListener('visibilitychange', schedule); window.addEventListener('resize', invalidateStyles);
    discover(document.body);
    return () => { disposed = true; cancelAnimationFrame(frame); mutation.disconnect(); theme.disconnect(); resize.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('resize', invalidateStyles); for (const node of painted) restore(node); registered.clear(); visible.clear(); dirty.clear(); };
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
