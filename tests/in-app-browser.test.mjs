import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { createInAppBrowserManager, normalizeWebUrl } = createRequire(import.meta.url)('../electron/in-app-browser.cjs');

function harness({ failLoad = false } = {}) {
  const created = [];
  const manager = createInAppBrowserManager({
    parent: () => ({ id: 'main-window' }), icon: 'app-icon',
    createWindow: options => {
      const listeners = new Map(); let popupHandler, destroyed = false;
      const window = {
        options, urls: [],
        webContents: {
          on: (event, callback) => listeners.set(event, callback),
          setWindowOpenHandler: callback => { popupHandler = callback; },
        },
        on: (event, callback) => listeners.set(event, callback),
        async loadURL(url) { this.urls.push(url); if (failLoad) throw new Error('synthetic load failure'); },
        isDestroyed: () => destroyed,
        close() { destroyed = true; listeners.get('closed')?.(); },
        popup: details => popupHandler(details),
        fire: (event, target) => { let prevented = false; listeners.get(event)?.({ preventDefault() { prevented = true; } }, target); return prevented; },
      };
      created.push(window); return window;
    },
  });
  return { manager, created };
}

test('in-app browser opens only safe web URLs in a sandboxed isolated session', async () => {
  const { manager, created } = harness();
  assert.deepEqual(await manager.open('https://example.test/path'), { opened: true });
  const window = created[0];
  assert.equal(window.urls[0], 'https://example.test/path');
  assert.equal(window.options.parent.id, 'main-window');
  assert.equal(window.options.webPreferences.partition, 'persist:coolapk-in-app-browser');
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.webviewTag, false);
  assert.equal(manager.count, 1);
  assert.deepEqual(window.popup({ url: 'https://example.test/next' }), { action: 'deny' });
  assert.equal(window.urls.at(-1), 'https://example.test/next');
  assert.deepEqual(window.popup({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.equal(window.urls.length, 2);
  assert.equal(window.fire('will-navigate', 'file:///secret'), true);
  assert.equal(window.fire('will-redirect', 'data:text/html,unsafe'), true);
  assert.equal(window.fire('will-navigate', 'https://example.test/ok'), false);
  manager.closeAll(); assert.equal(manager.count, 0);
});

test('in-app browser rejects credentials and non-web schemes before creating a window', async () => {
  const { manager, created } = harness();
  for (const value of ['file:///secret', 'javascript:alert(1)', 'mailto:user@example.test', 'https://user:pass@example.test', 'https://x.test/' + 'a'.repeat(8200)]) {
    await assert.rejects(manager.open(value), /网页链接无效|HTTP \/ HTTPS/);
  }
  assert.equal(created.length, 0);
  assert.equal(normalizeWebUrl('http://127.0.0.1:8888/test'), 'http://127.0.0.1:8888/test');
});

test('failed navigation closes its window and leaves no orphaned browser state', async () => {
  const { manager, created } = harness({ failLoad: true });
  await assert.rejects(manager.open('https://example.test'), /无法打开网页/);
  assert.equal(created[0].isDestroyed(), true);
  assert.equal(manager.count, 0);
});
