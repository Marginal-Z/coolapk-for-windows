import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glassGeometry, glassOffset, glassPixels } from '../core/liquid-glass.mjs';

test('glass leaves the flat interior and exterior stationary', () => {
  const geometry = glassGeometry(320, 80, 20);
  for (const [x, y] of [[160, 40], [80, 40], [-1, 40], [160, -1]]) assert.deepEqual(glassOffset(geometry, x, y), { x: 0, y: 0 });
  const pixels = glassPixels(geometry), center = (40 * geometry.rasterWidth + 160) * 4;
  assert.deepEqual([...pixels.slice(center, center + 4)], [128, 128, 128, 255]);
});
test('opposite rims refract symmetrically toward the interior', () => {
  const geometry = glassGeometry(320, 80, 20);
  const left = glassOffset(geometry, 2, 40), right = glassOffset(geometry, 318, 40);
  assert.ok(left.x > 0 && right.x < 0); assert.equal(left.x, -right.x); assert.equal(left.y, 0);
  const top = glassOffset(geometry, 160, 2), bottom = glassOffset(geometry, 160, 78);
  assert.equal(top.y, -bottom.y); assert.equal(top.x, 0); assert.ok(top.y > 0);
});
test('rim thickness stays in CSS pixels across different aspect ratios', () => {
  const narrow = glassGeometry(200, 80, 20), wide = glassGeometry(1400, 80, 20);
  for (const depth of [1, 5, 10, 17]) assert.deepEqual(glassOffset(narrow, depth, 40), glassOffset(wide, depth, 40));
  assert.deepEqual(glassOffset(wide, 25, 40), { x: 0, y: 0 });
});
test('rounded corners produce a diagonal normal while cut-away pixels stay still', () => {
  const geometry = glassGeometry(100, 100, 24), diagonal = glassOffset(geometry, 9, 9);
  assert.ok(diagonal.x > 0); assert.equal(diagonal.x, diagonal.y);
  assert.deepEqual(glassOffset(geometry, 1, 1), { x: 0, y: 0 });
});
test('raster allocation and displacement remain bounded for tiny and extreme sizes', () => {
  for (const geometry of [glassGeometry(Infinity, NaN, -3), glassGeometry(1, 1, 999), glassGeometry(100000, 100000, 999)]) {
    assert.ok(geometry.rasterWidth <= 1024 && geometry.rasterHeight <= 1024);
    assert.ok(geometry.rasterWidth * geometry.rasterHeight <= 181000);
    assert.ok(geometry.radius <= Math.min(geometry.width, geometry.height) / 2);
    const pixels = glassPixels(geometry); assert.equal(pixels.length, geometry.rasterWidth * geometry.rasterHeight * 4);
    const offset = glassOffset(geometry, .1, geometry.height / 2); assert.ok(Math.abs(offset.x) <= 15 && Math.abs(offset.y) <= 15);
  }
});
