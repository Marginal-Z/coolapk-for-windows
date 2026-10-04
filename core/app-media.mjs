// Coolapk's public APK API returns Tencent App Store CDN images as well as its
// own CDN. Only the two observed static image paths may use the public proxy.
const coolapkHosts = new Set(['avatar.coolapk.com', 'image.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com']);
const myappImagePath = /^\/(?:ma_icon\/\d+\/icon_\d+(?:_\d+)+\/\d+|ma_pic2\/\d+\/shot_\d+(?:_\d+)+\/\d+)$/;

export function publicImageSource(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  let url;
  try { url = new URL(value.trim().startsWith('//') ? 'https:' + value.trim() : value.trim()); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
  if (!coolapkHosts.has(url.hostname) && !(url.hostname === 'pp.myapp.com' && myappImagePath.test(url.pathname) && !url.search && !url.hash)) return '';
  url.protocol = 'https:';
  return url.toString();
}

export function appIconSource(app = {}) {
  for (const key of ['logo', 'apkRomIcon', 'icon', 'apkIcon', 'apkLogo', 'appIcon', 'bigIcon', 'pic', 'cover']) {
    const value = app[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value) && !/^https?:/i.test(value)) continue;
    const source = value.startsWith('//') || /^https?:/i.test(value) ? value : 'https://image.coolapk.com/' + value.replace(/^\/+/, '');
    const normalized = publicImageSource(source);
    if (normalized) return normalized;
  }
  return '';
}

export function appScreenshots(app = {}) {
  const output = [], seen = new Set();
  for (const key of ['screenList', 'screenshots', 'screenshotList']) {
    const values = Array.isArray(app[key]) ? app[key] : typeof app[key] === 'string' ? app[key].split(',') : [];
    for (const item of values) {
      const url = publicImageSource(typeof item === 'string' ? item : item?.url || item?.pic || '');
      if (url && !seen.has(url)) { seen.add(url); output.push(url); }
      if (output.length === 30) return output;
    }
  }
  return output;
}
