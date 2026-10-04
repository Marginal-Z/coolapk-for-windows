const fontScales = Object.freeze({ system: 1, standard: 1, small: 0.9, large: 1.15 });

class DesktopSettings {
  constructor({ webContents, imageCache, version }) {
    this.webContents = webContents; this.imageCache = imageCache; this.version = version;
    this.fontSize = 'system'; this.userZoom = 1; this.clearing = null;
  }
  applyZoom() {
    const scale = fontScales[this.fontSize] * this.userZoom;
    this.webContents.setZoomFactor(scale);
    return { fontSize: this.fontSize, fontScale: fontScales[this.fontSize], userZoom: this.userZoom, zoomFactor: scale };
  }
  zoomBy(direction) {
    this.userZoom = Math.min(2, Math.max(0.75, Math.round(this.userZoom * (direction > 0 ? 1.1 : 1 / 1.1) * 1000) / 1000));
    return this.applyZoom();
  }
  resetZoom() { this.userZoom = 1; return this.applyZoom(); }
  dispatch(operation, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('桌面设置参数无效');
    const keys = Object.keys(args);
    if (operation === 'display') {
      if (keys.length !== 1 || keys[0] !== 'fontSize' || !Object.hasOwn(fontScales, args.fontSize)) throw new Error('字体大小选项无效');
      this.fontSize = args.fontSize; return this.applyZoom();
    }
    if (keys.length) throw new Error('桌面设置不接受额外参数');
    if (operation === 'info') return { version: this.version };
    if (operation === 'clearCache') {
      if (!this.clearing) {
        this.imageCache.clear();
        this.clearing = Promise.resolve().then(() => this.webContents.session.clearCache()).then(() => ({ cleared: true })).finally(() => { this.clearing = null; });
      }
      return this.clearing;
    }
    throw new Error('不支持的桌面设置操作');
  }
}
module.exports = { DesktopSettings };
