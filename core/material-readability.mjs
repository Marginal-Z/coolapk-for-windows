import { normalizeThemeColor, themeColorContrast } from './preferences.mjs';
const channels = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
const color = (value, fallback) => normalizeThemeColor(value) || fallback;
const mix = (first, second, proportion) => '#' + channels(first).map((value, index) => Math.round(value + (channels(second)[index] - value) * proportion).toString(16).padStart(2, '0')).join('');
export function compositeMaterial(surface, backdrop, opacity) { return mix(backdrop, surface, opacity); }
const minimum = (foreground, backgrounds) => Math.min(...backgrounds.map(background => themeColorContrast(foreground, background)));
const contrastTarget = 4.6; // A small quantization margin protects actual 8-bit composited pixels.
function readable(foreground, target, backgrounds) {
  for (let step = 0; step <= 100; step++) { const candidate = mix(foreground, target, step / 100); if (minimum(candidate, backgrounds) >= contrastTarget) return candidate; }
  return target;
}
// A restrained reading tint bounds every possible wallpaper channel between
// its black/white composites. Small text and links are validated against both
// extremes, instead of estimating the average luminance of a photograph.
export function materialReadability(value = {}) {
  const dark = value.theme === 'dark' || value.theme === 'black';
  const surface = color(value.surface, value.theme === 'black' ? '#0b0b0b' : dark ? '#202823' : '#ffffff');
  const body = color(value.body, dark ? '#e3ebe6' : '#26322d');
  let floor = .75;
  while (floor < 1 && minimum(body, ['#000000', '#ffffff'].map(backdrop => compositeMaterial(surface, backdrop, floor))) < contrastTarget) floor = Math.round((floor + .01) * 100) / 100;
  const opacity = Math.max(floor, Math.min(1, Number.isFinite(value.opacity) ? value.opacity : .78));
  const backgrounds = ['#000000', '#ffffff'].map(backdrop => compositeMaterial(surface, backdrop, opacity));
  const muted = readable(color(value.muted, dark ? '#a3b2a9' : '#63746b'), body, backgrounds);
  const accent = readable(color(value.accent, dark ? '#65cf94' : '#14874e'), dark ? '#ffffff' : '#000000', backgrounds);
  const accentHover = mix(accent, dark ? '#ffffff' : '#000000', .18);
  const accentOn = minimum('#ffffff', [accent, accentHover]) >= minimum('#000000', [accent, accentHover]) ? '#ffffff' : '#000000';
  const header = color(value.header, surface), preferredHeaderText = color(value.headerText, body);
  let headerOpacity = opacity, headerText;
  for (; headerOpacity <= 1.001; headerOpacity = Math.round((headerOpacity + .01) * 100) / 100) {
    const headerBackgrounds = ['#000000', '#ffffff'].map(backdrop => compositeMaterial(header, backdrop, headerOpacity));
    headerText = [preferredHeaderText, '#000000', '#ffffff'].find(candidate => minimum(candidate, headerBackgrounds) >= contrastTarget);
    if (headerText) break;
  }
  // Near middle luminance no foreground can reach the extra 4.6 margin.
  // Its fully tinted toolbar still has a black/white choice above 4.5.
  if (!headerText) headerText = themeColorContrast('#ffffff', header) >= themeColorContrast('#000000', header) ? '#ffffff' : '#000000';
  return { floor, opacity, surface, body, muted, accent, accentHover, accentOn, header, headerOpacity: Math.min(1, headerOpacity), headerText };
}
