const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { UpdateManager } = require('./update-manager.cjs');

const UPDATE_RELEASES = 'https://github.com/Marginal-Z/coolapk-for-windows/releases/latest';
const UPDATE_PROVIDER = Object.freeze({ provider: 'github', owner: 'Marginal-Z', repo: 'coolapk-for-windows', private: false });

// The updater verifies the download against latest.yml. Repeat that check
// before installing so a modified file in the local cache is never launched.
async function validateUpdatePackage({ info, paths }) {
  const invalid = () => { const error = new Error('更新安装包校验失败，请重新下载。'); error.code = 'UPDATE_INTEGRITY'; throw error; };
  if (!Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== 'string') invalid();
  const file = paths[0], before = await fs.promises.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || !before.size) invalid();
  const metadata = info.files?.[0];
  if (!metadata || typeof metadata.sha512 !== 'string' || (metadata.size != null && metadata.size !== before.size)) invalid();
  const hash = createHash('sha512');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  const after = await fs.promises.lstat(file);
  if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || hash.digest('base64') !== metadata.sha512) invalid();
}

function createSoftwareUpdates({ app, onChange }) {
  const distribution = !app.isPackaged || process.platform !== 'win32' ? 'development' : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed';
  let updater = null;
  if (distribution !== 'development') {
    const { NsisUpdater, NoOpLogger } = require('electron-updater');
    updater = new NsisUpdater(UPDATE_PROVIDER);
    updater.logger = new NoOpLogger();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.disableWebInstaller = true;
  }
  return new UpdateManager({ updater, version: app.getVersion(), distribution, onChange, validatePackage: async value => {
    try { await validateUpdatePackage(value); }
    catch (error) {
      // electron-updater trusts its in-memory cache within one session. Drop
      // that cache after failed revalidation so Retry fetches fresh bytes.
      await updater?.downloadedUpdateHelper?.clear().catch(() => {});
      throw error;
    }
  } });
}

module.exports = { createSoftwareUpdates, validateUpdatePackage, UPDATE_PROVIDER, UPDATE_RELEASES };
