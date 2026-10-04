const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const BACKGROUND_SCHEME = 'coolapk-background';
const MAX_BACKGROUND_BYTES = 16 * 1024 ** 2;
const emptyState = () => ({ available: false, revision: '', url: '', width: 0, height: 0, name: '', bytes: 0 });
const inputError = message => Object.assign(new Error(message), { code: 'INPUT' });
const busyFileCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
const publicError = error => {
  if (['INPUT', 'ACCOUNT_CHANGED', 'TEENAGER_RESTRICTED', 'BACKGROUND_IO'].includes(error?.code)) return error;
  return Object.assign(new Error(busyFileCodes.has(error?.code) ? '背景图片文件暂时被占用，请稍后重试。' : '背景图片操作未完成，请稍后重试。'), { code: 'BACKGROUND_IO' });
};
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const backgroundUrl = revision => validRevision(revision) ? `${BACKGROUND_SCHEME}://local/${revision}` : '';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const validSize = (width, height) => Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 32 * 1024 ** 2;

function createBackgroundDecoder({ nativeImage, webContents }) {
  return async (bytes, type) => {
    if (type !== 'image/webp') { const image = nativeImage.createFromBuffer(bytes); return image.isEmpty() ? null : image.getSize(); }
    const target = webContents();
    if (!target || target.isDestroyed()) return null;
    // Electron's nativeImage does not decode WebP. Chromium does, in an
    // isolated renderer world with no filesystem bridge, DOM changes or URL
    // loading. The only variable source text is a bounded base64 literal.
    const code = `(async()=>{try{const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),value=>value.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/webp'}));const size={width:image.width,height:image.height};image.close();return size}catch{return null}})()`;
    return target.executeJavaScriptInIsolatedWorld(2001, [{ code }]);
  };
}

// Read dimensions before asking Electron to decode. This bounds a compressed
// image's allocation as well as its source bytes. Actual decoding is still
// required; matching a magic prefix alone never accepts a selected file.
function imageHeader(bytes) {
  let format, width, height;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    format = 'png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    format = 'webp'; const chunk = bytes.toString('ascii', 12, 16);
    if (bytes.readUInt32LE(16) > bytes.length - 20) throw inputError('背景图片已损坏，请选择其他图片。');
    if (chunk === 'VP8X' && bytes.length >= 30) { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); }
    else if (chunk === 'VP8L' && bytes[20] === 0x2f && bytes.length >= 25) { const bits = bytes.readUInt32LE(21); width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff); }
    else if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'jpg'; let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += size;
    }
  }
  if (!format || !validSize(width, height)) throw inputError('请选择有效的 JPEG、PNG 或 WebP 图片，单边不超过 8192 像素、总像素不超过 33,554,432。');
  return { format, type: `image/${format === 'jpg' ? 'jpeg' : format}`, width, height };
}

class BackgroundImageManager {
  constructor({ directory, dialog, parent, decodeImage, io = fs, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
    if (!directory || typeof decodeImage !== 'function') throw new TypeError('Background storage and an image decoder are required');
    Object.assign(this, { directory: path.resolve(directory), dialog, parent, decodeImage, io, wait }); this.busy = false;
  }
  async ensureDirectory() {
    await this.io.mkdir(this.directory, { recursive: true });
    const stat = await this.io.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw inputError('背景存储目录不可用。');
  }
  async manifest() {
    try {
      const file = path.join(this.directory, 'active.json'), stat = await this.io.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) return null;
      const value = JSON.parse(await this.io.readFile(file, 'utf8'));
      if (!value || !validRevision(value.revision) || !['jpg', 'png', 'webp'].includes(value.format) || !validSize(value.width, value.height) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_BACKGROUND_BYTES || typeof value.name !== 'string' || value.name.length > 180 || /[\\/\x00-\x1f\x7f]/.test(value.name)) return null;
      return { revision: value.revision, format: value.format, width: value.width, height: value.height, bytes: value.bytes, name: value.name };
    } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }
  file(value) { return path.join(this.directory, `${value.revision}.${value.format}`); }
  async content(value) {
    const file = this.file(value), stat = await this.io.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== value.bytes) throw inputError('背景图片不可用，请重新选择图片。');
    const body = await this.io.readFile(file);
    if (body.length !== value.bytes || digest(body) !== value.revision) throw inputError('背景图片已损坏，请重新选择图片。');
    return body;
  }
  publicState(value) { return value ? { available: true, revision: value.revision, url: backgroundUrl(value.revision), width: value.width, height: value.height, name: value.name, bytes: value.bytes } : emptyState(); }
  async rename(from, to, guard = () => {}) {
    // Windows readers/scanners can briefly lock the current manifest. Retry the
    // atomic replace, never delete the old active file to make rename succeed.
    for (let attempt = 0; ; attempt++) {
      guard();
      try { await this.io.rename(from, to); return; }
      catch (error) {
        if (!busyFileCodes.has(error.code) || attempt >= 4) throw error;
        await this.wait(25 * 2 ** attempt);
      }
    }
  }
  async replaceManifest(value, guard = () => {}) {
    const temporary = path.join(this.directory, `pending-${randomUUID()}.json`);
    try {
      guard(); await this.io.writeFile(temporary, JSON.stringify(value), { flag: 'wx' }); guard();
      await this.rename(temporary, path.join(this.directory, 'active.json'), guard);
    } finally { await this.io.unlink(temporary).catch(() => {}); }
  }
  async previousImage(value) {
    if (!value) return undefined;
    try { return await this.content(value); }
    catch (error) { if (['ENOENT', 'INPUT'].includes(error.code)) return undefined; throw error; }
  }
  async restore(value, bytes) {
    if (!value) { await this.io.unlink(path.join(this.directory, 'active.json')).catch(error => { if (error.code !== 'ENOENT') throw error; }); return; }
    if (bytes) {
      try { await this.io.writeFile(this.file(value), bytes, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; await this.content(value); }
    }
    await this.replaceManifest(value);
  }
  async state() {
    await this.ensureDirectory(); const value = await this.manifest();
    if (!value) return emptyState();
    try { await this.content(value); return this.publicState(value); } catch (error) { if (error.code === 'ENOENT' || error.code === 'INPUT') return emptyState(); throw error; }
  }
  async read(url) {
    let target; try { target = new URL(url); } catch { return null; }
    const revision = target.pathname.slice(1);
    if (target.protocol !== `${BACKGROUND_SCHEME}:` || target.hostname !== 'local' || target.username || target.password || target.port || target.search || target.hash || !validRevision(revision) || target.pathname !== '/' + revision) return null;
    await this.ensureDirectory(); const value = await this.manifest();
    if (!value || value.revision !== revision) return null;
    try { return { body: await this.content(value), type: `image/${value.format === 'jpg' ? 'jpeg' : value.format}` }; } catch (error) { if (error.code === 'ENOENT' || error.code === 'INPUT') return null; throw error; }
  }
  async choose(guard) {
    guard();
    const result = await this.dialog.showOpenDialog(this.parent?.(), { title: '选择酷安背景图片', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }], properties: ['openFile'] });
    guard();
    if (result.canceled || !result.filePaths?.length) { const state = await this.state(); guard(); return { ...state, cancelled: true }; }
    const source = result.filePaths[0];
    if (result.filePaths.length !== 1 || typeof source !== 'string' || !/\.(jpe?g|png|webp)$/i.test(source)) throw inputError('请选择 JPEG、PNG 或 WebP 图片。');
    const stat = await this.io.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_BACKGROUND_BYTES) throw inputError('背景图片必须小于 16 MB，请选择其他图片。');
    const bytes = await this.io.readFile(source);
    if (bytes.length !== stat.size || bytes.length > MAX_BACKGROUND_BYTES) throw inputError('背景图片读取失败，请重新选择。');
    const metadata = imageHeader(bytes), decoded = await this.decodeImage(bytes, metadata.type);
    const sameDimensions = decoded && (decoded.width === metadata.width && decoded.height === metadata.height || metadata.format === 'jpg' && decoded.width === metadata.height && decoded.height === metadata.width);
    if (!decoded || !validSize(decoded.width, decoded.height) || !sameDimensions) throw inputError('背景图片无法打开，请选择其他图片。');
    guard(); await this.ensureDirectory(); const previous = await this.manifest(), previousBytes = await this.previousImage(previous); guard();
    const value = { revision: digest(bytes), format: metadata.format, width: metadata.width, height: metadata.height, bytes: bytes.length, name: path.basename(source).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) };
    const imageFile = this.file(value);
    let newFile = false, committed = false;
    try {
      try { await this.io.writeFile(imageFile, bytes, { flag: 'wx' }); newFile = true; } catch (error) { if (error.code !== 'EEXIST') throw error; await this.content(value); }
      guard(); await this.replaceManifest(value, guard); committed = true; guard();
      if (previous && previous.revision !== value.revision) await this.io.unlink(this.file(previous)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      guard();
    } catch (error) {
      // A scope change can occur while rename or old-image cleanup is awaiting.
      // Preserve the old bytes until the final guard; restore both when needed.
      if (committed) await this.restore(previous, previousBytes);
      if (newFile && previous?.revision !== value.revision) await this.io.unlink(imageFile).catch(() => {});
      throw error;
    }
    return this.publicState(value);
  }
  async remove(guard) {
    guard(); await this.ensureDirectory(); const value = await this.manifest(), bytes = await this.previousImage(value); guard();
    let removed = false;
    try {
      await this.io.unlink(path.join(this.directory, 'active.json')).then(() => { removed = true; }, error => { if (error.code !== 'ENOENT') throw error; });
      guard();
      if (value) await this.io.unlink(this.file(value)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      guard();
    } catch (error) { if (removed) await this.restore(value, bytes); throw error; }
    return emptyState();
  }
  async dispatch(operation, guard = () => {}, args) {
    if (args !== undefined || !['state', 'choose', 'remove'].includes(operation)) throw inputError('背景设置操作无效。');
    guard();
    try {
      if (operation === 'state') { const state = await this.state(); guard(); return state; }
      if (this.busy) throw inputError('正在处理背景图片，请稍候。');
      this.busy = true; try { return await this[operation](guard); } finally { this.busy = false; }
    } catch (error) { throw publicError(error); }
  }
}
module.exports = { BackgroundImageManager, BACKGROUND_SCHEME, MAX_BACKGROUND_BYTES, backgroundUrl, imageHeader, createBackgroundDecoder };
