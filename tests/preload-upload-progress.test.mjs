import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

test('main preload scopes progress events to one upload and removes its listener on completion', async () => {
  const exposed = {}, calls = [], listeners = new Map(), electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
    ipcRenderer: {
      on: (channel, listener) => listeners.set(channel, [...(listeners.get(channel) || []), listener]),
      removeListener: (channel, listener) => listeners.set(channel, (listeners.get(channel) || []).filter(item => item !== listener)),
      invoke: async (...args) => {
        calls.push(args);
        const [channel, , , id] = args;
        for (const listener of listeners.get('coolapk:upload-progress') || []) {
          listener({}, { id: 'another-upload', progress: { loaded: 9, total: 10, percent: 90 } });
          listener({}, { id, progress: { loaded: 4, total: 8, percent: 50 } });
          listener({}, { id, progress: { loaded: Infinity, total: 8, percent: 100 } });
        }
        return { ok: true, data: {} };
      },
    },
  };
  vm.runInNewContext(readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8'), { require: name => name === 'electron' ? electron : require(name) });
  const progress = [];
  const result = await exposed.coolapk.call('uploadImage', { bytes: [1] }, value => progress.push([value.loaded, value.total, value.percent]));
  assert.equal(result.ok, true);
  assert.deepEqual(progress, [[4, 8, 50]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'coolapk:call'); assert.equal(calls[0][1], 'uploadImage');
  assert.match(calls[0][3], /^\d{1,12}$/);
  assert.equal((listeners.get('coolapk:upload-progress') || []).length, 0);
});
