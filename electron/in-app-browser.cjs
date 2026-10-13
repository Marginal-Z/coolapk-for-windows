function normalizeWebUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('网页链接无效');
  let url;
  try { url = new URL(value); } catch { throw new Error('网页链接无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持 HTTP / HTTPS 链接');
  return url.toString();
}

function createInAppBrowserManager({ createWindow, parent = () => null, icon } = {}) {
  if (typeof createWindow !== 'function') throw new Error('应用内浏览器窗口工厂无效');
  const windows = new Set();
  const isWebUrl = value => { try { normalizeWebUrl(value); return true; } catch { return false; } };

  async function open(value) {
    const url = normalizeWebUrl(value);
    const owner = parent();
    const window = createWindow({
      title: 'coolapk desktop - 浏览器', width: 1080, height: 760, minWidth: 720, minHeight: 520,
      ...(owner ? { parent: owner } : {}), ...(icon ? { icon } : {}), autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:coolapk-in-app-browser', contextIsolation: true,
        nodeIntegration: false, sandbox: true, webviewTag: false,
      },
    });
    windows.add(window);
    window.on('closed', () => windows.delete(window));
    window.webContents.on('will-navigate', (event, target) => { if (!isWebUrl(target)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, target) => { if (!isWebUrl(target)) event.preventDefault(); });
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isWebUrl(target) && !window.isDestroyed()) void window.loadURL(normalizeWebUrl(target)).catch(() => {});
      return { action: 'deny' };
    });
    try {
      await window.loadURL(url);
      return { opened: true };
    } catch {
      if (!window.isDestroyed()) window.close();
      throw new Error('无法打开网页');
    }
  }

  function closeAll() {
    for (const window of [...windows]) if (!window.isDestroyed()) window.close();
    windows.clear();
  }

  return { open, closeAll, get count() { return windows.size; } };
}

module.exports = { createInAppBrowserManager, normalizeWebUrl };
