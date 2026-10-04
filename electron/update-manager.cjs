const UPDATE_MESSAGES = Object.freeze({
  UPDATE_UNSUPPORTED: '当前运行方式不支持软件更新，请使用 Windows 安装版。',
  UPDATE_CLOSED: '软件更新服务已关闭。',
  UPDATE_BUSY: '更新操作正在进行，请稍后重试。',
  UPDATE_INVALID_OPERATION: '不支持的软件更新操作。',
  UPDATE_INVALID_METADATA: '更新信息无效，无法安全下载此版本。',
  UPDATE_CHECK_FAILED: '检查更新失败，请确认网络连接后重试。',
  UPDATE_DOWNLOAD_FAILED: '下载更新失败，请确认网络连接后重试。',
  UPDATE_PACKAGE_INVALID: '更新文件校验失败，请重新下载。',
  UPDATE_NOT_AVAILABLE: '请先检查并找到新版本。',
  UPDATE_NOT_DOWNLOADED: '请先完整下载并校验更新。',
  UPDATE_INSTALL_FAILED: '无法启动更新安装，请重试或从项目发布页下载安装版。',
});

function updateError(code) {
  return Object.assign(new Error(UPDATE_MESSAGES[code]), { code });
}

function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function plainNotes(notes) {
  const value = typeof notes === 'string' ? notes : Array.isArray(notes)
    ? notes.filter(item => item && typeof item.note === 'string').map(item => item.note).join('\n\n') : '';
  return value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 8192);
}

function parseInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !versionParts(value.version)) throw updateError('UPDATE_INVALID_METADATA');
  const filename = `Coolapk-Desktop-Setup-${value.version}-x64.exe`;
  if (!Array.isArray(value.files) || value.files.length !== 1) throw updateError('UPDATE_INVALID_METADATA');
  const file = value.files[0];
  if (!file || file.url !== filename || typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) throw updateError('UPDATE_INVALID_METADATA');
  const digest = Buffer.from(file.sha512, 'base64');
  if (digest.length !== 64 || digest.toString('base64') !== file.sha512) throw updateError('UPDATE_INVALID_METADATA');
  if (file.size !== undefined && (!Number.isSafeInteger(file.size) || file.size <= 0)) throw updateError('UPDATE_INVALID_METADATA');
  if (value.path !== undefined && value.path !== filename) throw updateError('UPDATE_INVALID_METADATA');
  if (value.sha512 !== undefined && value.sha512 !== file.sha512) throw updateError('UPDATE_INVALID_METADATA');
  let releaseDate = null;
  if (value.releaseDate !== undefined) {
    if (typeof value.releaseDate !== 'string' || !Number.isFinite(Date.parse(value.releaseDate))) throw updateError('UPDATE_INVALID_METADATA');
    releaseDate = new Date(value.releaseDate).toISOString();
  }
  return {
    version: value.version,
    files: [{ url: filename, sha512: file.sha512, ...(file.size === undefined ? {} : { size: file.size }) }],
    path: filename,
    sha512: file.sha512,
    releaseDate,
    releaseNotes: plainNotes(value.releaseNotes),
  };
}

function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0; }

class UpdateManager {
  constructor({ updater, version, distribution = 'installed', onChange = () => {}, now = Date.now, tokenFactory, validatePackage = async () => true }) {
    this.updater = updater;
    this.version = version;
    this.versionParts = versionParts(version);
    this.onChange = onChange;
    this.now = now;
    this.tokenFactory = tokenFactory || (() => new (require('electron-updater').CancellationToken)());
    this.validatePackage = validatePackage;
    this.closed = false;
    this.checkAttempt = null;
    this.downloadAttempt = null;
    this.installAttempt = null;
    this.candidate = null;
    this.downloadedPaths = null;
    this.supported = Boolean(updater && this.versionParts && ['installed', 'portable'].includes(distribution));
    this.snapshot = {
      currentVersion: version,
      status: this.supported ? 'idle' : 'unsupported',
      distribution,
      availableVersion: null,
      releaseDate: null,
      releaseNotes: '',
      progress: null,
      error: null,
      errorCode: null,
      checkedAt: null,
    };
    this.onError = () => {
      // Check/download promises carry their failures. Only installation can fail
      // after quitAndInstall has returned, so handle that event independently.
      if (!this.closed && this.installAttempt && this.snapshot.status === 'installing') {
        const attempt = this.installAttempt;
        attempt.failed = true;
        this.fail('UPDATE_INSTALL_FAILED');
        if (attempt.finished) this.installAttempt = null;
      }
    };
    if (this.supported) updater.on('error', this.onError);
  }

  state() {
    return { ...this.snapshot, progress: this.snapshot.progress ? { ...this.snapshot.progress } : null };
  }

  publish(patch) {
    if (this.closed) return;
    Object.assign(this.snapshot, patch);
    try { this.onChange(this.state()); } catch { /* A closing renderer must not interrupt an update. */ }
  }

  fail(code) {
    this.publish({ status: 'error', error: UPDATE_MESSAGES[code], errorCode: code });
    return updateError(code);
  }

  listen(attempt, name, callback) {
    this.updater.on(name, callback);
    attempt.listeners.push([name, callback]);
  }

  unlisten(attempt) {
    for (const [name, callback] of attempt?.listeners || []) this.updater.removeListener(name, callback);
    if (attempt) attempt.listeners.length = 0;
  }

  current(attempt, kind) { return !this.closed && !attempt.cancelled && this[kind] === attempt; }

  dispatch(operation, ...args) {
    if (args.length || !['info', 'check', 'download', 'cancel', 'install'].includes(operation)) throw updateError('UPDATE_INVALID_OPERATION');
    if (operation === 'info') return this.state();
    if (this.closed) throw updateError('UPDATE_CLOSED');
    if (!this.supported) throw updateError('UPDATE_UNSUPPORTED');
    if (operation === 'check') return this.check();
    if (operation === 'download') return this.download();
    if (operation === 'cancel') return this.cancel();
    return this.install();
  }

  check() {
    if (this.checkAttempt) return this.checkAttempt.promise;
    if (this.downloadAttempt || this.installAttempt) throw updateError('UPDATE_BUSY');
    if (this.snapshot.status === 'downloaded') return Promise.resolve(this.state());
    this.candidate = null;
    this.downloadedPaths = null;
    const attempt = { listeners: [], cancelled: false, event: null, info: null, metadataError: false, promise: null };
    this.checkAttempt = attempt;
    const accept = available => info => {
      if (!this.current(attempt, 'checkAttempt')) return;
      try { attempt.info = parseInfo(info); attempt.event = available; } catch { attempt.metadataError = true; }
    };
    this.listen(attempt, 'update-available', accept(true));
    this.listen(attempt, 'update-not-available', accept(false));
    this.publish({ status: 'checking', availableVersion: null, releaseDate: null, releaseNotes: '', progress: null, error: null, errorCode: null });
    attempt.promise = (async () => {
      try {
        const result = await this.updater.checkForUpdates();
        if (!this.current(attempt, 'checkAttempt')) return this.state();
        if (!result) throw updateError('UPDATE_UNSUPPORTED');
        const info = parseInfo(result.updateInfo);
        if (typeof result.isUpdateAvailable !== 'boolean' || attempt.metadataError || attempt.event === null || attempt.event !== result.isUpdateAvailable || attempt.info?.version !== info.version || attempt.info?.sha512 !== info.sha512) throw updateError('UPDATE_INVALID_METADATA');
        const relation = compareVersions(versionParts(info.version), this.versionParts);
        if (result.isUpdateAvailable && relation <= 0 || !result.isUpdateAvailable && relation > 0) throw updateError('UPDATE_INVALID_METADATA');
        const checkedAt = new Date(this.now()).toISOString();
        if (result.isUpdateAvailable) {
          this.candidate = info;
          this.publish({ status: 'available', availableVersion: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes, checkedAt });
        } else {
          this.publish({ status: 'current', checkedAt });
        }
        return this.state();
      } catch (error) {
        if (!this.current(attempt, 'checkAttempt')) return this.state();
        const code = error?.code === 'UPDATE_INVALID_METADATA' ? error.code : error?.code === 'UPDATE_UNSUPPORTED' ? error.code : 'UPDATE_CHECK_FAILED';
        throw this.fail(code);
      } finally {
        this.unlisten(attempt);
        if (this.checkAttempt === attempt) this.checkAttempt = null;
      }
    })();
    return attempt.promise;
  }

  download() {
    if (this.downloadAttempt) {
      if (this.downloadAttempt.cancelled) throw updateError('UPDATE_BUSY');
      return this.downloadAttempt.promise;
    }
    if (this.checkAttempt || this.installAttempt) throw updateError('UPDATE_BUSY');
    if (this.snapshot.status === 'downloaded') return Promise.resolve(this.state());
    if (!this.candidate) throw updateError('UPDATE_NOT_AVAILABLE');
    const info = this.candidate;
    const attempt = { listeners: [], cancelled: false, token: this.tokenFactory(), event: null, metadataError: false, promise: null };
    this.downloadAttempt = attempt;
    this.downloadedPaths = null;
    this.listen(attempt, 'download-progress', value => {
      if (!this.current(attempt, 'downloadAttempt')) return;
      const previous = this.snapshot.progress;
      const total = Math.max(previous?.total || 0, finiteNumber(value?.total));
      const transferred = Math.max(previous?.transferred || 0, total ? Math.min(total, finiteNumber(value?.transferred)) : 0);
      const percent = Math.max(previous?.percent || 0, Math.min(100, finiteNumber(value?.percent)));
      this.publish({ progress: { percent, total, transferred, bytesPerSecond: finiteNumber(value?.bytesPerSecond) } });
    });
    this.listen(attempt, 'update-downloaded', value => {
      if (!this.current(attempt, 'downloadAttempt')) return;
      try {
        const eventInfo = parseInfo(value);
        if (eventInfo.version !== info.version || eventInfo.sha512 !== info.sha512 || typeof value.downloadedFile !== 'string' || !value.downloadedFile) throw updateError('UPDATE_INVALID_METADATA');
        attempt.event = value.downloadedFile;
      } catch { attempt.metadataError = true; }
    });
    this.publish({ status: 'downloading', error: null, errorCode: null, progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    attempt.promise = (async () => {
      try {
        const paths = await this.updater.downloadUpdate(attempt.token);
        if (!this.current(attempt, 'downloadAttempt')) return this.state();
        if (attempt.metadataError || !attempt.event || !Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== 'string' || paths[0] !== attempt.event) throw updateError('UPDATE_PACKAGE_INVALID');
        try {
          const valid = await this.validatePackage({ info: structuredClone(info), paths: [...paths] });
          if (valid === false) throw updateError('UPDATE_PACKAGE_INVALID');
        } catch { throw updateError('UPDATE_PACKAGE_INVALID'); }
        if (!this.current(attempt, 'downloadAttempt')) return this.state();
        this.downloadedPaths = [...paths];
        const progress = this.snapshot.progress;
        this.publish({ status: 'downloaded', progress: { percent: 100, total: progress.total, transferred: progress.total, bytesPerSecond: 0 } });
        return this.state();
      } catch (error) {
        if (!this.current(attempt, 'downloadAttempt')) return this.state();
        throw this.fail(error?.code === 'UPDATE_PACKAGE_INVALID' ? error.code : 'UPDATE_DOWNLOAD_FAILED');
      } finally {
        this.unlisten(attempt);
        if (this.downloadAttempt === attempt) this.downloadAttempt = null;
      }
    })();
    return attempt.promise;
  }

  cancel() {
    if (this.checkAttempt || this.installAttempt) throw updateError('UPDATE_BUSY');
    const attempt = this.downloadAttempt;
    if (!attempt) return this.state();
    if (attempt.cancelled) return attempt.cancelPromise;
    attempt.cancelled = true;
    this.unlisten(attempt);
    attempt.token.cancel();
    this.downloadedPaths = null;
    this.publish({ status: 'available', progress: null, error: null, errorCode: null });
    // Keep the renderer's cancel action busy until network/file verification has
    // settled; a fresh download must never join the canceled library promise.
    attempt.cancelPromise = Promise.resolve(attempt.promise).then(() => this.state(), () => this.state());
    return attempt.cancelPromise;
  }

  install() {
    if (this.checkAttempt || this.downloadAttempt || this.installAttempt) throw updateError('UPDATE_BUSY');
    if (this.snapshot.status !== 'downloaded' || !this.downloadedPaths || !this.candidate) throw updateError('UPDATE_NOT_DOWNLOADED');
    const attempt = { cancelled: false, finished: false, failed: false, promise: null };
    this.installAttempt = attempt;
    this.publish({ status: 'installing', error: null, errorCode: null });
    attempt.promise = (async () => {
      try {
        try {
          const valid = await this.validatePackage({ info: structuredClone(this.candidate), paths: [...this.downloadedPaths] });
          if (valid === false) throw updateError('UPDATE_PACKAGE_INVALID');
        } catch { this.downloadedPaths = null; throw updateError('UPDATE_PACKAGE_INVALID'); }
        if (!this.current(attempt, 'installAttempt')) return this.state();
        if (attempt.failed) throw updateError('UPDATE_INSTALL_FAILED');
        const installed = this.updater.quitAndInstall(false, true);
        attempt.finished = true;
        if (installed === false || this.snapshot.status === 'error') throw updateError('UPDATE_INSTALL_FAILED');
        return this.state();
      } catch (error) {
        if (!this.current(attempt, 'installAttempt')) return this.state();
        throw this.fail(error?.code === 'UPDATE_PACKAGE_INVALID' ? error.code : 'UPDATE_INSTALL_FAILED');
      } finally {
        // Keep listening for asynchronous installer spawn failures until close.
        if (this.installAttempt === attempt && this.snapshot.status !== 'installing') this.installAttempt = null;
      }
    })();
    return attempt.promise;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.checkAttempt) this.checkAttempt.cancelled = true;
    if (this.downloadAttempt) { this.downloadAttempt.cancelled = true; this.downloadAttempt.token.cancel(); }
    if (this.installAttempt) this.installAttempt.cancelled = true;
    this.unlisten(this.checkAttempt);
    this.unlisten(this.downloadAttempt);
    if (this.supported) this.updater.removeListener('error', this.onError);
    this.downloadedPaths = null;
  }
}

module.exports = { UpdateManager };
