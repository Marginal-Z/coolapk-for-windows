const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const MAX_APK_BYTES = 2 * 1024 ** 3;
const ACTIVE = new Set(['queued', 'resolving', 'downloading']);
const FINISHED = new Set(['completed', 'failed', 'canceled']);
const LINK_FALLBACK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP']);
const error = (message, code = 'DOWNLOAD_ERROR') => Object.assign(new Error(message), { code });
const strongTag = value => typeof value === 'string' && /^"[\x21\x23-\x7e]{1,256}"$/.test(value);
async function partialDigest(file, maximum) {
  const handle = await fsp.open(file, 'r');
  try {
    const before = await handle.stat(); if (!before.isFile() || before.size < 4 || before.size > maximum) throw error('断点文件大小无效', 'DOWNLOAD_RESUME');
    const hash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat(); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw error('断点文件已改变', 'DOWNLOAD_RESUME');
    return { size: after.size, digest: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function publishApk(partial, target, current, io = fsp) {
  let created = false, cleanCopyFailure = false;
  try {
    current();
    try { await io.link(partial, target); created = true; }
    catch (linkError) {
      if (!LINK_FALLBACK.has(linkError.code)) throw linkError;
      current();
      // A link may report unsupported before checking an existing destination.
      try { await io.lstat(target); throw error('下载目标文件已经存在', 'EEXIST'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      current();
      try { await io.copyFile(partial, target, fs.constants.COPYFILE_EXCL); created = true; }
      catch (copyError) { cleanCopyFailure = copyError.code !== 'EEXIST'; throw copyError; }
    }
    current();
  } catch (e) {
    if (created || cleanCopyFailure) {
      try { await io.unlink(target); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') e.cleanupErrorCode = cleanupError.code || 'DOWNLOAD_CLEANUP'; }
    }
    throw e;
  }
}
function downloadRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['packageName', 'versionCode', 'title', 'versionPage'].includes(key))) throw error('下载请求参数无效', 'INPUT');
  if (typeof value.packageName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value.packageName) || value.packageName.length > 200) throw error('应用包名无效', 'INPUT');
  if (value.versionCode != null && value.versionCode !== '' && !/^\d{1,20}$/.test(String(value.versionCode))) throw error('应用版本码无效', 'INPUT');
  if (value.title != null && (typeof value.title !== 'string' || value.title.length > 200 || /[\x00-\x1f]/.test(value.title))) throw error('应用名称无效', 'INPUT');
  if (value.versionPage != null && (!Number.isInteger(Number(value.versionPage)) || Number(value.versionPage) < 1 || Number(value.versionPage) > 1000)) throw error('历史版本页码无效', 'INPUT');
  return { packageName: value.packageName, ...(value.versionCode != null ? { versionCode: String(value.versionCode) } : {}), ...(value.versionPage != null ? { versionPage: Number(value.versionPage) } : {}), ...(value.title ? { title: value.title } : {}) };
}
function fileName(title, packageName, versionCode, id) {
  let stem = String(title || packageName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+/g, '_').trim().replace(/[. ]+$/, '').slice(0, 70) || 'coolapk';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) stem = '_' + stem;
  return `${stem}-${String(versionCode || 'latest').slice(0, 20)}-${id.slice(0, 8)}.apk`;
}

class DownloadManager {
  constructor({ directory, stateFile, selectDirectory, openDownload, captureDownload, shell, onChange = () => {}, concurrency = 2, maxBytes = MAX_APK_BYTES }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof openDownload !== 'function' && typeof captureDownload !== 'function') throw error('下载管理器配置无效');
    // Read the independent configuration before touching the original default.
    // A previously selected folder must still load if Downloads is unavailable.
    let defaultDirectory;
    const initializeDefault = () => {
      if (!defaultDirectory) {
        // Match fsp.realpath on Windows, including 8.3 aliases and actual casing.
        fs.mkdirSync(directory, { recursive: true }); defaultDirectory = fs.realpathSync.native(directory);
      }
      return defaultDirectory;
    };
    this.directory = directory;
    this.openDownload = openDownload; this.captureDownload = captureDownload; this.shell = shell; this.onChange = onChange;
    this.concurrency = Math.floor(Math.min(4, Math.max(1, Number(concurrency) || 2))); this.maxBytes = Math.floor(Math.min(MAX_APK_BYTES, Math.max(4, Number(maxBytes) || MAX_APK_BYTES)));
    this.tasks = new Map(); this.running = new Set(); this.closed = false; this.selectDirectory = selectDirectory; this.selectingDirectory = false;
    if (stateFile != null && (typeof stateFile !== 'string' || !path.isAbsolute(stateFile))) throw error('下载历史配置无效');
    this.stateFile = stateFile || path.join(initializeDefault(), '.coolapk-downloads.json');
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true }); this.stateDirectory = fs.realpathSync.native(path.dirname(this.stateFile));
    this.stateFile = path.join(this.stateDirectory, path.basename(this.stateFile));
    let migrated = false, configuredDirectory = false;
    try {
      let source = this.stateFile;
      try { fs.lstatSync(source); } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const legacyStateFile = path.join(initializeDefault(), '.coolapk-downloads.json');
        if (source !== legacyStateFile) { source = legacyStateFile; migrated = true; }
      }
      const stateStat = fs.lstatSync(source); if (!stateStat.isFile() || stateStat.isSymbolicLink() || stateStat.size > 1024 * 1024) throw error('下载历史文件无效');
      const saved = JSON.parse(fs.readFileSync(source, 'utf8')), versioned = !Array.isArray(saved) && saved?.version === 1 && Array.isArray(saved.tasks);
      if (versioned && typeof saved.directory === 'string' && path.isAbsolute(saved.directory)) { this.directory = saved.directory; configuredDirectory = true; }
      else this.directory = initializeDefault();
      const rows = versioned ? saved.tasks : saved;
      if (Array.isArray(rows)) for (const row of rows.slice(-200)) {
        if (!row || !/^[a-f0-9-]{36}$/.test(row.id) || !row.request || !['completed', 'failed', 'canceled', 'paused', ...ACTIVE].includes(row.status)) continue;
        try { const request = downloadRequest(row.request), taskDirectory = versioned ? row.directory : this.directory; if (typeof taskDirectory !== 'string' || !path.isAbsolute(taskDirectory)) continue; const task = { ...row, request, directory: taskDirectory, speed: 0, opener: null, abort: null, status: ACTIVE.has(row.status) ? 'failed' : row.status, error: ACTIVE.has(row.status) ? '应用已重启，请重试下载' : row.error || '' }; this.tasks.set(task.id, task); } catch {}
      }
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (!configuredDirectory) this.directory = initializeDefault();
    // Commit an independent history before the first directory change. The old
    // file stays untouched, but it will never resurrect deleted records later.
    if (migrated) this.persist();
  }
  snapshot(task) {
    return { id: task.id, packageName: task.request.packageName, title: task.title || task.request.title || task.request.packageName, versionCode: task.versionCode || task.request.versionCode || '', versionName: task.versionName || '', fileName: task.fileName || '', directory: task.directory, status: task.status, downloaded: task.downloaded || 0, total: task.total || 0, speed: task.speed || 0, verified: task.verified === true, retryable: ['failed', 'canceled', 'paused'].includes(task.status) && !this.running.has(task.id) && !task.cleanup, removable: this.removable(task), resumable: task.status === 'paused' && !this.running.has(task.id) && !task.cleanup, partialReusable: task.status === 'paused' && !!task.resumeInfo, sha256: task.sha256 || '', error: task.error || '', errorCode: task.errorCode || '', createdAt: task.createdAt, updatedAt: task.updatedAt, retryCount: task.retryCount || 0 };
  }
  list() { return { tasks: [...this.tasks.values()].map(task => this.snapshot(task)).sort((a, b) => b.createdAt - a.createdAt), directory: this.directory }; }
  persist(directory = this.directory) {
    if (fs.realpathSync.native(this.stateDirectory) !== this.stateDirectory) throw error('下载历史目录已改变');
    try { const stat = fs.lstatSync(this.stateFile); if (!stat.isFile() || stat.isSymbolicLink()) throw error('下载历史文件无效'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const rows = [...this.tasks.values()].slice(-200).map(task => ({ ...this.snapshot(task), request: task.request, size: task.size, mtimeMs: task.mtimeMs, resumeInfo: task.resumeInfo }));
    const temp = path.join(this.stateDirectory, `.coolapk-downloads-${randomUUID()}.tmp`);
    try { fs.writeFileSync(temp, JSON.stringify({ version: 1, directory, tasks: rows }), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, this.stateFile); } finally { try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  async chooseDirectory() {
    if (this.closed) throw error('下载中心已关闭');
    if (this.selectingDirectory) throw error('保存位置选择窗口已打开', 'DOWNLOAD_BUSY');
    if (typeof this.selectDirectory !== 'function') throw error('保存位置选择功能不可用');
    this.selectingDirectory = true;
    try {
      const result = await this.selectDirectory(this.directory);
      if (this.closed) throw error('下载中心已关闭');
      result?.assertCurrent?.();
      if (!result?.directory) return { ...this.list(), canceled: true, changed: false };
      if (typeof result.directory !== 'string' || !path.isAbsolute(result.directory)) throw error('请选择有效的保存文件夹', 'INPUT');
      const directory = await fsp.realpath(result.directory), stat = await fsp.stat(directory);
      if (!stat.isDirectory()) throw error('保存位置必须是文件夹', 'DOWNLOAD_DIRECTORY');
      // Test the selected location with a new exclusive file. Neither existing
      // APKs nor download records in that folder are read, moved or overwritten.
      const probe = path.join(directory, `.coolapk-write-test-${randomUUID()}.tmp`);
      let handle;
      try { handle = await fsp.open(probe, 'wx', 0o600); }
      finally { if (handle) { try { await handle.close(); } finally { await fsp.unlink(probe); } } }
      result.assertCurrent?.();
      if (this.closed) throw error('下载中心已关闭');
      if (await fsp.realpath(directory) !== directory) throw error('保存目录已改变', 'DOWNLOAD_DIRECTORY');
      result.assertCurrent?.();
      const changed = directory !== this.directory;
      this.persist(directory); this.directory = directory;
      const snapshot = this.list(); try { this.onChange(snapshot); } catch {}
      return { ...snapshot, canceled: false, changed };
    } catch (e) {
      if (['EACCES', 'EPERM', 'EROFS'].includes(e.code)) throw error('无法保存到所选位置，请检查文件夹权限或选择其他位置', 'DOWNLOAD_DIRECTORY');
      if (['ENOENT', 'ENOTDIR'].includes(e.code)) throw error('保存文件夹已不存在，请重新选择保存位置', 'DOWNLOAD_DIRECTORY');
      throw e;
    } finally { this.selectingDirectory = false; }
  }
  changed(task, final = false) {
    task.updatedAt = Date.now(); if (final) { try { this.persist(); } catch { task.persistenceError = true; } }
    try { this.onChange(this.list()); } catch {}
  }
  task(id) { if (typeof id !== 'string' || !this.tasks.has(id)) throw error('下载任务不存在', 'INPUT'); return this.tasks.get(id); }
  opener() { const value = this.captureDownload ? this.captureDownload() : this.openDownload; if (typeof value !== 'function') throw error('下载通道不可用'); return value; }
  add(args) {
    if (this.closed) throw error('下载中心已关闭'); const request = downloadRequest(args);
    const existing = [...this.tasks.values()].find(task => task.request.packageName === request.packageName && String(task.request.versionCode || '') === String(request.versionCode || '') && (ACTIVE.has(task.status) || task.status === 'paused'));
    if (existing) return this.snapshot(existing);
    if ([...this.tasks.values()].filter(task => ACTIVE.has(task.status)).length >= 100) throw error('下载队列已满，请先完成或取消部分任务');
    if (fs.realpathSync.native(this.directory) !== this.directory) throw error('保存目录已改变，请重新选择保存位置', 'DOWNLOAD_DIRECTORY');
    const id = randomUUID(), task = { id, request, directory: this.directory, status: 'queued', downloaded: 0, total: 0, speed: 0, verified: false, createdAt: Date.now(), updatedAt: Date.now(), retryCount: 0, opener: this.opener() };
    this.tasks.set(id, task); this.changed(task, true); this.pump(); return this.snapshot(task);
  }
  pump() {
    if (this.closed) return;
    while (this.running.size < this.concurrency) {
      const task = [...this.tasks.values()].find(task => task.status === 'queued' && !this.running.has(task.id)); if (!task) return;
      this.running.add(task.id); task.status = 'resolving'; task.abort = new AbortController(); this.changed(task);
      void this.run(task).finally(() => { this.running.delete(task.id); task.abort = null; this.changed(task); this.pump(); });
    }
  }
  async pathFor(task, partial = false) {
    if (typeof task.fileName !== 'string' || path.basename(task.fileName) !== task.fileName || !/\.apk$/i.test(task.fileName) || /[\x00-\x1f<>:"/\\|?*]/.test(task.fileName)) throw error('下载文件名无效');
    if (typeof task.directory !== 'string' || !path.isAbsolute(task.directory) || await fsp.realpath(task.directory) !== task.directory) throw error('下载目录已改变');
    const target = path.join(task.directory, task.fileName + (partial ? '.part' : ''));
    if (path.dirname(target) !== task.directory) throw error('下载文件超出目录范围');
    try { const stat = await fsp.lstat(target); if (stat.isSymbolicLink() || !stat.isFile()) throw error('下载目标不是普通文件'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return target;
  }
  async removePartial(task) {
    if (!task.fileName) return; const partial = await this.pathFor(task, true);
    try { await fsp.unlink(partial); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  discardPartial(task) {
    task.resumeInfo = undefined;
    task.cleanup = this.removePartial(task).catch(() => { task.error = `${task.error ? task.error + '；' : ''}无法清理临时下载文件`; }).finally(() => { task.cleanup = null; task.downloaded = 0; this.changed(task, true); });
    return task.cleanup;
  }
  async run(task) {
    let handle, reader, response, target, published = false, onAbort;
    try {
      let resume, resumeDigest;
      if (task.resumeInfo) {
        const stored = task.resumeInfo, partial = await this.pathFor(task, true), actual = await partialDigest(partial, this.maxBytes);
        if (actual.size !== stored.offset || actual.digest !== stored.digest || !strongTag(stored.etag) || !/^[a-f0-9]{64}$/.test(stored.resourceSha256) || !Number.isSafeInteger(stored.total) || stored.total <= stored.offset || stored.total > this.maxBytes || String(stored.versionCode) !== task.versionCode) throw error('断点文件或原版本信息已改变，请重新下载', 'DOWNLOAD_RESUME');
        resume = { offset: stored.offset, total: stored.total, etag: stored.etag, versionCode: stored.versionCode, resourceSha256: stored.resourceSha256 };
        resumeDigest = stored.digest;
      }
      const opened = await task.opener(task.request, { signal: task.abort.signal, ...(resume ? { resume } : {}) }); response = opened.response;
      const current = () => { if (task.abort.signal.aborted || !ACTIVE.has(task.status)) throw error(task.status === 'paused' ? '下载已暂停' : '下载已取消', task.status === 'paused' ? 'PAUSED' : 'CANCELED'); opened.assertCurrent?.(); };
      current(); const plan = opened.plan;
      if (opened.verified !== true || !plan || plan.packageName !== task.request.packageName || task.request.versionCode && String(plan.versionCode) !== task.request.versionCode || !response?.ok || !response.body) throw error('酷安未确认下载响应', 'DOWNLOAD_VERIFY_FAILED');
      if (resume && String(plan.versionCode) !== resume.versionCode) throw error('应用版本已更新，请重新下载', 'DOWNLOAD_RESUME');
      const contentType = String(response.headers.get('content-type') || '').toLowerCase(); if (/^(?:text\/|application\/(?:json|xhtml\+xml))/.test(contentType)) throw error('下载响应不是安装包', 'DOWNLOAD_CONTENT');
      if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw error('安装包响应不能使用压缩传输', 'DOWNLOAD_CONTENT');
      const length = Number(response.headers.get('content-length') || 0); if (!Number.isSafeInteger(length) || length < 0 || length > this.maxBytes) throw error('安装包体积超过下载限制', 'DOWNLOAD_SIZE');
      let offset = 0, total = length;
      if (response.status === 206) {
        const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i); offset = opened.rangeOffset ?? (resume ? resume.offset : 0); total = Number(range?.[3]);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset && (!resume || offset !== resume.offset || opened.resourceSha256 !== resume.resourceSha256)) throw error('断点资源地址已改变，请重新下载', 'DOWNLOAD_RESUME');
        if (!range || Number(range[1]) !== offset || Number(range[2]) + 1 !== total || !Number.isSafeInteger(total) || total > this.maxBytes || length && total - offset !== length || offset && (total !== resume.total || response.headers.get('etag') !== resume.etag || String(plan.versionCode) !== resume.versionCode)) throw error('服务器返回的安装包范围或文件标识已改变，请重新下载', 'DOWNLOAD_TRUNCATED');
      } else if (response.status !== 200) throw error('服务器未返回完整安装包', 'DOWNLOAD_TRUNCATED');
      Object.assign(task, { title: String(plan.title || task.request.title || plan.packageName), versionCode: String(plan.versionCode), versionName: String(plan.versionName || ''), total, downloaded: offset, speed: 0, verified: true, resumeInfo: undefined, resourceSha256: opened.resourceSha256, etag: strongTag(response.headers.get('etag')) ? response.headers.get('etag') : '' });
      // A public title can change while the bytes and version stay the same.
      // Preserve the checked partial-file identity throughout this continuation.
      if (!resume || !task.fileName) task.fileName = fileName(task.title, task.request.packageName, task.versionCode, task.id);
      target = await this.pathFor(task); const partial = await this.pathFor(task, true);
      const hash = createHash('sha256'); let header = Buffer.alloc(0);
      if (offset) {
        handle = await fsp.open(partial, 'r+'); if ((await handle.stat()).size !== offset) throw error('断点文件长度已改变', 'DOWNLOAD_RESUME');
        const previousHash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false, start: 0, end: offset - 1 })) { current(); hash.update(chunk); previousHash.update(chunk); if (header.length < 4) header = Buffer.concat([header, chunk.subarray(0, 4 - header.length)]); }
        if (previousHash.digest('hex') !== resumeDigest || header.length !== 4 || header.readUInt32LE(0) !== 0x04034b50) throw error('断点文件校验已改变', 'DOWNLOAD_RESUME');
      } else { await this.removePartial(task); handle = await fsp.open(partial, 'wx', 0o600); }
      current(); task.status = 'downloading'; this.changed(task, true);
      let lastUpdate = Date.now(), lastBytes = offset; reader = response.body.getReader();
      onAbort = () => { void reader.cancel().catch(() => {}); }; task.abort.signal.addEventListener('abort', onAbort, { once: true });
      for (;;) {
        current(); const { done, value } = await reader.read(); current(); if (done) break;
        if (!(value instanceof Uint8Array) || !value.length) continue; if (task.downloaded + value.length > this.maxBytes || total && task.downloaded + value.length > total) throw error('安装包流长度超过限制或响应声明', 'DOWNLOAD_SIZE');
        if (header.length < 4) { header = Buffer.concat([header, Buffer.from(value.subarray(0, 4 - header.length))]); if (header.length === 4 && header.readUInt32LE(0) !== 0x04034b50) throw error('下载内容不是 APK/ZIP 安装包', 'DOWNLOAD_CONTENT'); }
        hash.update(value); let chunkOffset = 0; while (chunkOffset < value.length) { current(); const { bytesWritten } = await handle.write(value, chunkOffset, value.length - chunkOffset, task.downloaded + chunkOffset); if (!bytesWritten) throw error('写入下载文件失败'); chunkOffset += bytesWritten; }
        task.downloaded += value.length;
        const now = Date.now(); if (now - lastUpdate >= 200) { task.speed = Math.round((task.downloaded - lastBytes) * 1000 / (now - lastUpdate)); lastUpdate = now; lastBytes = task.downloaded; this.changed(task); }
      }
      current(); if (header.length < 4 || total && task.downloaded !== total) throw error('安装包下载不完整', 'DOWNLOAD_TRUNCATED');
      await handle.sync(); await handle.close(); handle = null; current();
      // Prefer an atomic hard link; unsupported file systems use exclusive copy.
      const publicationCurrent = () => { current(); if (fs.realpathSync.native(task.directory) !== task.directory) throw error('下载目录已改变'); };
      await publishApk(partial, target, publicationCurrent); published = true; current(); await fsp.unlink(partial); const stat = await fsp.stat(target); current();
      Object.assign(task, { status: 'completed', speed: 0, total: task.total || task.downloaded, sha256: hash.digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs, error: '', errorCode: '' }); this.changed(task, true);
    } catch (e) {
      if (e.code === 'ACCOUNT_CHANGED') { task.status = 'failed'; task.error = '账号已切换，请重试下载'; task.errorCode = e.code; }
      if (task.status !== 'canceled' && task.status !== 'paused' && task.errorCode !== 'ACCOUNT_CHANGED') { task.status = 'failed'; task.error = e.code === 'ACCOUNT_CHANGED' ? '账号已切换，请重试下载' : e.message || '下载失败，请重试'; task.errorCode = e.code || 'DOWNLOAD_ERROR'; }
      if (e.cleanupErrorCode) { task.error = `${task.error ? task.error + '；' : ''}无法清理未完成的安装包，请检查下载目录`; task.errorCode ||= 'DOWNLOAD_CLEANUP'; }
      task.speed = 0; task.verified = false;
      try { if (task.status === 'paused') await handle?.sync(); await handle?.close(); } catch {} handle = null;
      task.resumeInfo = undefined;
      if (task.status === 'paused' && !published && strongTag(task.etag) && /^[a-f0-9]{64}$/.test(task.resourceSha256) && task.total > 4) {
        try { const partial = await partialDigest(await this.pathFor(task, true), this.maxBytes); if (task.status === 'paused' && partial.size < task.total) { task.resumeInfo = { offset: partial.size, total: task.total, etag: task.etag, versionCode: task.versionCode, resourceSha256: task.resourceSha256, digest: partial.digest }; task.downloaded = partial.size; } } catch {}
      }
      if (!task.resumeInfo) { try { await this.removePartial(task); task.downloaded = 0; } catch { task.error ||= '无法清理临时下载文件'; } }
      if (published) try { await fsp.unlink(target); } catch { task.error = `${task.error ? task.error + '；' : ''}无法清理未完成的安装包，请检查下载目录`; task.errorCode ||= 'DOWNLOAD_CLEANUP'; }
      this.changed(task, true);
    } finally { if (onAbort) task.abort.signal.removeEventListener('abort', onAbort); try { await reader?.cancel(); } catch {} try { reader?.releaseLock(); } catch {} if (!reader) try { await response?.body?.cancel(); } catch {} }
  }
  async cancel(id) {
    const task = this.task(id); if (!ACTIVE.has(task.status) && task.status !== 'paused') return this.snapshot(task);
    task.status = 'canceled'; task.error = ''; task.errorCode = ''; task.speed = 0; task.verified = false; task.resumeInfo = undefined; task.abort?.abort(error('下载已取消', 'CANCELED')); if (!this.running.has(id)) await this.discardPartial(task); this.changed(task, true); this.pump(); return this.snapshot(task);
  }
  pause(id) {
    const task = this.task(id); if (!ACTIVE.has(task.status)) throw error('此下载任务不能暂停');
    task.status = 'paused'; task.error = ''; task.errorCode = ''; task.speed = 0; task.verified = false; task.abort?.abort(error('下载已暂停', 'PAUSED')); this.changed(task, true); this.pump(); return this.snapshot(task);
  }
  resume(id) {
    const task = this.task(id); if (task.status !== 'paused' || this.running.has(id) || task.cleanup || this.closed) throw error('此下载尚未完成暂停，请稍后继续');
    task.opener = this.opener(); Object.assign(task, { status: 'queued', speed: 0, verified: false, error: '', errorCode: '' }); this.changed(task, true); this.pump(); return this.snapshot(task);
  }
  retry(id) {
    const task = this.task(id); if (ACTIVE.has(task.status) || this.running.has(id) || task.cleanup || task.status === 'completed' || this.closed) throw error('此下载任务不能重试');
    task.opener = this.opener(); Object.assign(task, { status: 'queued', downloaded: 0, total: 0, speed: 0, verified: false, resumeInfo: undefined, error: '', errorCode: '', retryCount: (task.retryCount || 0) + 1 }); this.changed(task, true); this.pump(); return this.snapshot(task);
  }
  removable(task) { return FINISHED.has(task.status) && !this.running.has(task.id) && !task.cleanup; }
  removeRecords(ids) {
    if (this.closed) throw error('下载中心已关闭');
    const previous = new Map(this.tasks);
    for (const id of ids) this.tasks.delete(id);
    // Remove only history, never APKs or caller-supplied filesystem paths. A
    // persistence failure must not report success or lose the in-memory record.
    try { this.persist(); } catch (e) { this.tasks = previous; throw error('下载记录未能保存，请重试', e.code || 'DOWNLOAD_PERSIST'); }
    const snapshot = this.list(); try { this.onChange(snapshot); } catch {}
    return { ...snapshot, removedCount: ids.length };
  }
  remove(id) {
    const task = this.task(id);
    if (!this.removable(task)) throw error('进行中、暂停或正在收尾的任务不能删除记录，请先取消下载', 'DOWNLOAD_ACTIVE');
    return this.removeRecords([id]);
  }
  clearFinished() {
    const ids = [...this.tasks.values()].filter(task => this.removable(task)).map(task => task.id);
    return ids.length ? this.removeRecords(ids) : { ...this.list(), removedCount: 0 };
  }
  async completedFile(id) {
    const task = this.task(id); if (task.status !== 'completed' || !task.verified || !task.sha256) throw error('此下载尚未完成校验');
    const target = await this.pathFor(task), handle = await fsp.open(target, 'r');
    try {
      const stat = await handle.stat(); if (!stat.isFile() || stat.size !== task.size || stat.mtimeMs !== task.mtimeMs) throw error('下载文件已被修改，请重新下载');
      const hash = createHash('sha256'); for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
      const after = await handle.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || hash.digest('hex') !== task.sha256) throw error('下载文件校验已改变，请重新下载');
      return { path: target, name: task.fileName, size: stat.size, mtimeMs: stat.mtimeMs, sha256: task.sha256 };
    } finally { await handle.close(); }
  }
  async open(id, reveal = false) {
    const file = await this.completedFile(id); if (!this.shell) throw error('文件打开功能不可用');
    if (reveal) this.shell.showItemInFolder(file.path); else { const result = await this.shell.openPath(file.path); if (result) throw error('系统无法打开此安装包，请查看文件所在目录'); }
    return { opened: true };
  }
  invalidateScope() { for (const task of this.tasks.values()) if (ACTIVE.has(task.status) || task.status === 'paused') { task.status = 'failed'; task.error = '账号已切换，请重试下载'; task.errorCode = 'ACCOUNT_CHANGED'; task.verified = false; task.speed = 0; task.resumeInfo = undefined; task.abort?.abort(error(task.error, task.errorCode)); if (!this.running.has(task.id)) void this.discardPartial(task); this.changed(task, true); } }
  async dispatch(operation, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw error('下载操作参数无效', 'INPUT');
    if (operation === 'chooseDirectory') { if (Object.keys(args).length) throw error('保存位置只能通过系统文件夹选择窗口设置', 'INPUT'); return this.chooseDirectory(); }
    if (operation === 'remove') { if (Object.keys(args).some(key => key !== 'id')) throw error('删除记录只能提供任务编号', 'INPUT'); return this.remove(args.id); }
    if (operation === 'clearFinished') { if (Object.keys(args).length) throw error('清除记录不接受文件路径或其他参数', 'INPUT'); return this.clearFinished(); }
    if (operation === 'list') return this.list(); if (operation === 'add') return this.add(args); if (operation === 'cancel') return this.cancel(args.id); if (operation === 'pause') return this.pause(args.id); if (operation === 'resume') return this.resume(args.id); if (operation === 'retry') return this.retry(args.id); if (operation === 'open') return this.open(args.id); if (operation === 'reveal') return this.open(args.id, true); throw error('不支持的下载操作', 'INPUT');
  }
  close() { this.closed = true; for (const task of this.tasks.values()) if (ACTIVE.has(task.status)) this.pause(task.id); }
}
module.exports = { DownloadManager, downloadRequest, fileName, publishApk, MAX_APK_BYTES };
