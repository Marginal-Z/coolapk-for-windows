const path = require('node:path');
const fail = message => Object.assign(new Error(message), { code: 'INPUT' });
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
async function viewerPayload(value) {
  if (!record(value) || Object.keys(value).some(key => !['images', 'index', 'items', 'contextId', 'contextType', 'namespace'].includes(key))) throw fail('图片查看参数无效');
  const contextType = value.contextType || 'feed', contextId = value.contextId || '';
  if (!['feed', 'reply', 'article', 'message'].includes(contextType)) throw fail('图片类型无效');
  if (contextId && (typeof contextId !== 'string' || !/^[1-9]\d{0,19}$/.test(contextId))) throw fail('图片内容 ID 无效');
  // Private bytes come from the authenticated reader, never renderer paths/data.
  if (contextType === 'message') {
    if (!contextId || value.images !== undefined && (!Array.isArray(value.images) || value.images.length) || value.items !== undefined && (!Array.isArray(value.items) || value.items.length) || value.index !== 0) throw fail('私信图片参数无效');
    return { images: [], index: 0, contextId, contextType, items: [] };
  }
  if (!Array.isArray(value.images) || !value.images.length || value.images.length > 30 || !Number.isInteger(value.index) || value.index < 0 || value.index >= value.images.length) throw fail('图片列表无效');
  if (value.items !== undefined && (!Array.isArray(value.items) || value.items.length !== value.images.length)) throw fail('图片详情无效');
  const { publicImageSource } = await import('../core/app-media.mjs');
  const { livePhotoUrl } = await import('../core/live-photo.mjs');
  const image = source => { const url = publicImageSource(source); if (!url) throw fail('不支持的图片来源'); return url; };
  const images = Array.from(value.images, image);
  const items = images.map((source, index) => {
    const item = value.items?.[index];
    if (item !== undefined && (!record(item) || Object.keys(item).some(key => !['source', 'cover', 'live', 'video'].includes(key)))) throw fail('图片详情无效');
    if (item?.source && image(item.source) !== source) throw fail('图片详情与来源不符');
    if (item?.live && !contextId) throw fail('实况照片缺少内容 ID');
    return { source, cover: item?.cover ? image(item.cover) : source, live: item?.live === true, ...(item?.video ? { video: livePhotoUrl(item.video) } : {}) };
  });
  return { images, items, index: value.index, contextType, contextId };
}
class ImageViewerManager {
  constructor(options) { Object.assign(this, options); this.windows = new Map(); this.slots = new Set(); this.generation = 0; }
  closeAll() { this.generation++; for (const { window } of this.windows.values()) if (!window.isDestroyed()) window.close(); }
  async open(value) {
    if (this.slots.size >= 8) throw fail('请先关闭部分图片窗口');
    const slot = Symbol(); this.slots.add(slot);
    try { return await this.openWindow(value, () => this.slots.delete(slot)); }
    catch (error) { this.slots.delete(slot); throw error; }
  }
  async openWindow(value, release) {
    const context = this.capture(), epoch = this.modeEpoch(), generation = this.generation;
    let openedWindow;
    const guard = () => { this.assertCurrent(context); this.assertMode(epoch); if (generation !== this.generation || openedWindow?.isDestroyed()) throw fail('图片窗口已关闭'); };
    guard(); const payload = await viewerPayload(value); guard();
    payload.namespace = String(context.client.identity?.uid || 'guest');
    if (payload.contextType === 'message') {
      if (!context.client.identity?.uid) throw fail('请先登录以查看私信图片');
      const result = await this.readMessage(context.client, payload.contextId); guard();
      if (typeof result.data !== 'string' || result.data.length > 17 * 1024 ** 2 || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(result.data)) throw fail('私信图片数据无效');
      payload.images = [result.data];
    }
    const window = this.createWindow({ icon: this.icon, title: '酷安 · 图片', width: 1000, height: 780, minWidth: 480, minHeight: 360, show: false, parent: this.parent(), autoHideMenuBar: true, backgroundColor: '#f5f7f8', webPreferences: { preload: path.join(__dirname, 'image-viewer-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
    openedWindow = window;
    const id = window.webContents.id;
    this.windows.set(id, { window, payload, guard, context });
    window.once('closed', () => { this.windows.delete(id); release(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); window.close(); } });
    try {
      if (this.devUrl) await window.loadURL(new URL('image-viewer.html', this.devUrl.endsWith('/') ? this.devUrl : this.devUrl + '/').toString());
      else await window.loadFile(path.join(this.projectRoot, 'dist/image-viewer.html'));
      guard(); if (window.isDestroyed()) throw fail('图片窗口已关闭');
      window.show(); return { opened: true };
    } catch (error) { if (!window.isDestroyed()) window.close(); throw error; }
  }
  async dispatch(event, operation, args) {
    const entry = this.windows.get(event.sender?.id);
    if (!entry || event.sender !== entry.window.webContents || event.senderFrame !== entry.window.webContents.mainFrame) throw fail('Untrusted image viewer');
    const { window, payload, guard, context } = entry;
    if (operation === 'close' && args === undefined) { window.close(); return { closed: true }; }
    guard();
    if (operation === 'state' && args === undefined) return payload;
    if (operation === 'save' || operation === 'external') {
      if (payload.contextType === 'message') throw fail('私信图片不可使用公开图片操作');
      if (!record(args) || Object.keys(args).some(key => !['url', 'name'].includes(key)) || !payload.images.includes(args.url)) throw fail('图片来源与窗口不符');
      if (operation === 'external') return this.openExternal(args.url);
      const result = await this.saveImage(window, { url: args.url, name: '酷安原图' }, guard); guard(); return result;
    }
    if (operation === 'livePhotoVideo') {
      if (!record(args) || Object.keys(args).some(key => !['picUrl', 'id', 'contentType'].includes(key)) || args.id !== payload.contextId || args.contentType !== payload.contextType || !payload.items.some(item => item.live && item.source === args.picUrl)) throw fail('实况照片与窗口不符');
      const result = await this.readLive(context, args); guard(); return result;
    }
    throw fail('图片窗口操作无效');
  }
}
module.exports = { ImageViewerManager, viewerPayload };
