// Rounded glass optics in CSS pixels. Snell's-law profile inspired by
// iyinchao/liquid-glass-studio (MIT); see docs/liquid-glass.md.
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function glassGeometry(width, height, radius = 18) {
  const w = Math.min(8192, Math.max(1, finite(width, 1)));
  const h = Math.min(8192, Math.max(1, finite(height, 1)));
  const r = Math.min(w / 2, h / 2, Math.max(0, finite(radius, 18)));
  const ratio = Math.min(1, 1024 / Math.max(w, h), Math.sqrt(180000 / (w * h)));
  return { width: w, height: h, radius: r, rim: Math.min(18, Math.min(w, h) / 3), rasterWidth: Math.max(1, Math.round(w * ratio)), rasterHeight: Math.max(1, Math.round(h * ratio)), scale: 32 };
}

export function glassOffset(geometry, x, y) {
  const { width, height, radius, rim } = geometry;
  const dx = x - width / 2, dy = y - height / 2;
  const qx = Math.abs(dx) - (width / 2 - radius), qy = Math.abs(dy) - (height / 2 - radius);
  const corner = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const distance = corner + Math.min(Math.max(qx, qy), 0) - radius;
  if (distance >= 0 || distance <= -rim) return { x: 0, y: 0 };
  const nx = qx > 0 && qy > 0 ? Math.sign(dx) * qx / corner : qx > qy ? Math.sign(dx) : 0;
  const ny = qx > 0 && qy > 0 ? Math.sign(dy) * qy / corner : qy >= qx ? Math.sign(dy) : 0;
  const slope = (1 + distance / rim) ** 2;
  const incident = Math.asin(slope), refracted = Math.asin(slope / 1.4);
  const offset = Math.min(15, -Math.tan(refracted - incident) * 14);
  return { x: nx ? -nx * offset : 0, y: ny ? -ny * offset : 0 };
}

export function glassPixels(geometry) {
  const { rasterWidth: w, rasterHeight: h, width, height, scale } = geometry;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const offset = glassOffset(geometry, (x + .5) * width / w, (y + .5) * height / h);
    const i = (y * w + x) * 4;
    pixels[i] = Math.round(128 + 255 * offset.x / scale);
    pixels[i + 1] = Math.round(128 + 255 * offset.y / scale);
    pixels[i + 2] = 128; pixels[i + 3] = 255;
  }
  return pixels;
}
