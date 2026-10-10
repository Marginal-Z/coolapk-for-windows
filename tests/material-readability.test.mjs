import test from 'node:test';
import assert from 'node:assert/strict';
import { compositeMaterial, materialReadability, materialEffectReadability } from '../core/material-readability.mjs';
import { THEME_PALETTES, preferenceThemeVariables, themeColorContrast } from '../core/preferences.mjs';
test('reading tint protects body, small text, links and colored toolbar controls over worst wallpaper endpoints', () => {
  for (const theme of ['light', 'dark', 'black']) for (const palette of [...THEME_PALETTES.map(value => value.id), 'custom']) for (const opacity of [.4, .74, .78, .9, 1]) {
    const seed = preferenceThemeVariables({ palette, customTheme: '#ffff00', customAccent: '#ff00ff', customThemeDark: true }, theme);
    const surface = theme === 'black' ? '#0b0b0b' : theme === 'dark' ? '#202823' : '#ffffff';
    const result = materialReadability({ theme, opacity, surface, accent: seed['--accent'], header: seed['--theme-header'], headerText: seed['--theme-header-text'] });
    assert.ok(result.opacity >= opacity && result.opacity <= 1); assert.ok(result.headerOpacity >= result.opacity && result.headerOpacity <= 1);
    for (const backdrop of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#808080']) {
      const background = compositeMaterial(surface, backdrop, result.opacity);
      for (const foreground of [result.body, result.muted, result.accent]) assert.ok(themeColorContrast(foreground, background) >= 4.5, JSON.stringify({ theme,palette,opacity,foreground,background,result }));
      assert.ok(themeColorContrast(result.headerText, compositeMaterial(result.header, backdrop, result.headerOpacity)) >= 4.5);
    }
    for (const background of [result.accent,result.accentHover]) assert.ok(themeColorContrast(result.accentOn, background) >= 4.5);
  }
});
test('low opacity stays visibly translucent and invalid metadata cannot become CSS', () => {
  for (const theme of ['light','dark','black']) { const result=materialReadability({ theme,opacity:.4 }); assert.ok(result.opacity<.85); assert.ok(result.floor<.85); }
  const invalid=materialReadability({ surface:'url(private)',accent:'var(--private)',opacity:NaN });assert.match(invalid.accent,/^#[a-f0-9]{6}$/);assert.equal(invalid.opacity,.78);
});
test('fully transparent material honors the exact opacity slider including zero while preserving readable text tokens', () => {
  for (const opacity of [0, .24, .78, 1]) {
    const result = materialEffectReadability({ effect: 'transparent', opacity, surface: '#ffffff', body: '#26322d', header: '#0f9d58' });
    assert.equal(result.opacity, opacity); assert.equal(result.headerOpacity, opacity); assert.equal(result.floor, 0);
    assert.ok(result.muted && result.accent && result.headerText);
  }
  assert.equal(materialEffectReadability({ effect: 'full', opacity: 0 }).opacity, .75);
});
test('middle-luminance custom headers choose the strongest foreground when the quantization margin is impossible', () => {
  for (const header of ['#328368', '#3b8356', '#737b67']) {
    const result = materialReadability({ header, headerText: '#26322d', opacity: .4 });
    for (const backdrop of ['#000000', '#ffffff']) assert.ok(themeColorContrast(result.headerText, compositeMaterial(header, backdrop, result.headerOpacity)) >= 4.5, JSON.stringify(result));
  }
});
