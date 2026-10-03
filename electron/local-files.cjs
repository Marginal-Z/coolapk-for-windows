const fs = require('node:fs/promises');
const path = require('node:path');

const fail = message => Object.assign(new Error(message), { code: 'INPUT' });
const formats = { markdown: { extension: 'md', label: 'Markdown 文档' }, json: { extension: 'json', label: 'JSON 文档' }, png: { extension: 'png', label: 'PNG 图片' } };
function fileName(value, extension) {
  const name = typeof value === 'string' ? value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 100) : '';
  const stem = name.replace(/\.(?:png|md|json)$/i, '') || '酷安导出';
  return `${/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem) ? '_' : ''}${stem}.${extension}`;
}
function exportPayload(args) {
  if (!args || !Object.hasOwn(formats, args.kind)) throw fail('不支持的导出格式');
  let bytes;
  if (args.kind === 'png') {
    if (!(args.content instanceof Uint8Array) && !Array.isArray(args.content) || !args.content.length || args.content.length > 16 * 1024 ** 2) throw fail('分享图片数据无效');
    if (Array.isArray(args.content) && args.content.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw fail('分享图片数据无效');
    bytes = Buffer.from(args.content);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw fail('分享图片必须为 PNG');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 8192) throw fail('分享图片尺寸无效');
  } else {
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content, 'utf8') > 16 * 1024 ** 2 || args.content.includes('\0')) throw fail('导出内容无效或过大');
    if (args.kind === 'json') { try { JSON.parse(args.content); } catch { throw fail('导出 JSON 格式无效'); } }
    bytes = Buffer.from(args.content, 'utf8');
  }
  return { bytes, ...formats[args.kind], name: fileName(args.name, formats[args.kind].extension) };
}
class LocalFiles {
  constructor({ dialog, parent, fetchImage, writeFile = fs.writeFile }) { Object.assign(this, { dialog, parent, fetchImage, writeFile }); }
  async save(payload, guard = () => {}) {
    guard();
    const result = await this.dialog.showSaveDialog(this.parent(), { title: '保存酷安内容', defaultPath: payload.name, filters: [{ name: payload.label, extensions: [payload.extension] }], properties: ['showOverwriteConfirmation'] });
    guard();
    if (result.canceled || !result.filePath) return { saved: false };
    // The renderer cannot supply a destination. Only the native save dialog chooses it.
    const target = result.filePath.toLowerCase().endsWith('.' + payload.extension) ? result.filePath : result.filePath + '.' + payload.extension;
    await this.writeFile(target, payload.bytes);
    return { saved: true, name: path.basename(target), bytes: payload.bytes.length };
  }
  saveExport(args, guard) { return this.save(exportPayload(args), guard); }
  async saveImage(args) {
    if (typeof args?.url !== 'string' || args.url.length > 4096) throw fail('原图地址无效');
    const result = await this.fetchImage(args.url);
    const mime = result.type.split(';')[0].toLowerCase();
    const extension = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' }[mime];
    if (!extension) throw fail('此图片格式暂不支持保存');
    return this.save({ bytes: result.body, extension, label: '酷安图片', name: fileName(args.name || '酷安原图', extension) });
  }
}
module.exports = { LocalFiles, exportPayload, fileName };
