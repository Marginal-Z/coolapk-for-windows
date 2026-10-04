import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { LocalFiles, exportPayload, fileName } = createRequire(import.meta.url)('../electron/local-files.cjs');
function harness(dialogResult = { filePath: 'D:\\chosen\\result.md' }) {
  const calls = [], writes = [];
  const files = new LocalFiles({ parent: () => null, dialog: { showSaveDialog: async (_, args) => { calls.push(args); return dialogResult; } }, fetchImage: async () => ({ body: Buffer.from('image'), type: 'image/webp' }), writeFile: async (target, bytes) => writes.push({ target, bytes }) });
  return { files, calls, writes };
}
test('export destinations are chosen exclusively by native dialog and extension is retained', async () => {
  const { files, calls, writes } = harness();
  const result = await files.saveExport({ kind: 'markdown', name: '../CON', content: '# 已选择内容', path: 'D:\\unexpected.txt' });
  assert.equal(result.saved, true); assert.equal(writes[0].target, 'D:\\chosen\\result.md'); assert.equal(writes[0].bytes.toString(), '# 已选择内容'); assert.equal(calls[0].defaultPath.includes('/'), false);
});
test('cancel and changed account cannot produce a saved file', async () => {
  const cancelled = harness({ canceled: true }); assert.equal((await cancelled.files.saveExport({ kind: 'json', name: '内容', content: '{}' })).saved, false); assert.equal(cancelled.writes.length, 0);
  const changed = harness(); let guards = 0;
  await assert.rejects(changed.files.saveExport({ kind: 'json', name: '内容', content: '{}' }, () => { if (++guards === 2) throw Object.assign(new Error('账号已切换'), { code: 'ACCOUNT_CHANGED' }); }), { code: 'ACCOUNT_CHANGED' }); assert.equal(changed.writes.length, 0);
});
test('executable formats, huge arraylike allocations, malformed JSON and PNG are refused', () => {
  for (const args of [{ kind: 'exe', content: 'x' }, { kind: 'json', content: '{invalid' }, { kind: 'png', content: { length: 2 ** 32 } }, { kind: 'png', content: [NaN] }, { kind: 'png', content: new Uint8Array(33) }]) assert.throws(() => exportPayload(args), { code: 'INPUT' });
});
test('Windows filenames cannot use paths or device names', () => {
  assert.equal(fileName('CON', 'json'), '_CON.json'); assert.equal(fileName('目录/好物?清单.json', 'json'), '目录_好物_清单.json'); assert.equal(fileName('NUL.txt', 'md'), '_NUL.txt.md');
});
test('original image writer uses fetched bytes and actual MIME extension', async () => {
  const { files, calls, writes } = harness({ filePath: 'D:\\chosen\\原图' });
  const result = await files.saveImage({ url: 'https://image.coolapk.com/original.webp', name: '原图' });
  assert.equal(result.saved, true); assert.equal(calls[0].defaultPath, '原图.webp'); assert.equal(writes[0].target, 'D:\\chosen\\原图.webp'); assert.equal(writes[0].bytes.toString(), 'image');
});
test('share image data resolves only exact public official URLs without any destination or account fields', async () => {
  const calls = [], writes = [];
  const files = new LocalFiles({ fetchImage: async url => { calls.push(url); return { body: Buffer.from([0, 1, 254, 255]), type: 'image/png; charset=binary' }; }, writeFile: async (...args) => writes.push(args) });
  assert.equal(await files.shareImageData({ url: 'http://image.coolapk.com/feed/original.png?width=100' }), 'data:image/png;base64,AAH+/w==');
  assert.deepEqual(calls, ['https://image.coolapk.com/feed/original.png?width=100']); assert.equal(writes.length, 0);
  for (const url of ['file:///D:/private.png', 'data:image/png;base64,AA==', 'https://image.coolapk.com.evil.test/a.png', 'https://evil.test/a.png', 'https://user:pass@image.coolapk.com/a.png', 'https://image.coolapk.com:444/a.png', 'coolapk-image://image/?url=x', '//image.coolapk.com/a.png']) await assert.rejects(files.shareImageData({ url }), { code: 'INPUT' });
  for (const extra of [{ namespace: '42' }, { path: 'D:\\target.png' }, { Cookie: 'synthetic' }, { cookie: 'synthetic' }]) await assert.rejects(files.shareImageData({ url: 'https://image.coolapk.com/a.png', ...extra }), { code: 'INPUT' });
  assert.equal(calls.length, 1);
});
test('share image loading refuses non-raster, malformed, empty and oversized bytes and preserves read failures', async () => {
  for (const reply of [{ body: Buffer.from('svg'), type: 'image/svg+xml' }, { body: [], type: 'image/png' }, { body: { length: 2 ** 32 }, type: 'image/png' }, { body: new Uint8Array(), type: 'image/png' }, { body: new Uint8Array(12 * 1024 ** 2 + 1), type: 'image/png' }]) await assert.rejects(new LocalFiles({ fetchImage: async () => reply }).shareImageData({ url: 'https://image.coolapk.com/a.png' }), { code: 'INPUT' });
  await assert.rejects(new LocalFiles({ fetchImage: async () => { throw new Error('image network failed'); } }).shareImageData({ url: 'https://image.coolapk.com/a.png' }), /image network failed/);
});
