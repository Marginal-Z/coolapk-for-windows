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
