const HDR_MARKER = /-([ux]?hdr)@\d+x\d+\.[a-z]+/i;

// Mirrors the filename marker recognized by Coolapk 16.6.4's StringExtendsKt.m740.
// Android 15+ adds the UHDR/XHDR variants; older images use the HDR spelling.
export function coolapkHdrSign(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) return 0;
  let name = value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (!/^https?:/i.test(value)) return 0;
    try { name = new URL(value).pathname; } catch { return 0; }
  }
  return HDR_MARKER.test(name) ? 1 : 0;
}

export function isCoolapkHdrImage(value) { return coolapkHdrSign(value) > 0; }
