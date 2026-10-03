const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const MAX_APK_BYTES = 2 * 1024 ** 3;
const ACTIVE = new Set(['queued', 'resolving', 'downloading']);
const LINK_FALLBACK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP']);
const error = (message, code = 'DOWNLOAD_ERROR') => Object.assign(new Error(message), { code });
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
  constructor({ directory, openDownload, captureDownload, shell, onChange = () => {}, concurrency = 2, maxBytes = MAX_APK_BYTES }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || typeof openDownload !== 'function' && typeof captureDownload !== 'function') throw error('下载管理器配置无效');
    fs.mkdirSync(directory, { recursive: true }); this.directory = fs.realpathSync(directory);
    this.openDownload = openDownload; this.captureDownload = captureDownload; this.shell = shell; this.onChange = onChange;
    this.concurrency = Math.floor(Math.min(4, Math.max(1, Number(concurrency) || 2))); this.maxBytes = Math.floor(Math.min(MAX_APK_BYTES, Math.max(4, Number(maxBytes) || MAX_APK_BYTES)));
    this.tasks = new Map(); this.running = new Set(); this.closed = false;
    this.stateFile = path.join(this.directory, '.coolapk-downloads.json');
    try {
      const stateStat = fs.lstatSync(this.stateFile); if (!stateStat.isFile() || stateStat.isSymbolicLink() || stateStat.size > 1024 * 1024) throw error('下载历史文件无效');
      const saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (Array.isArray(saved)) for (const row of saved.slice(-200)) {
        if (!row || !/^[a-f0-9-]{36}$/.test(row.id) || !row.request || !['completed', 'failed', 'canceled', ...ACTIVE].includes(row.status)) continue;
        try { const request = downloadRequest(row.request); const task = { ...row, request, speed: 0, opener: null, abort: null, status: ACTIVE.has(row.status) ? 'failed' : row.status, error: ACTIVE.has(row.status) ? '应用已重启，请重试下载' : row.error || '' }; this.tasks.set(task.id, task); } catch {}
      }
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  }
  snapshot(task) {
    return { id: task.id, packageName: task.request.packageName, title: task.title || task.request.title || task.request.packageName, versionCode: task.versionCode || task.request.versionCode || '', versionName: task.versionName || '', fileName: task.fileName || '', status: task.status, downloaded: task.downloaded || 0, total: task.total || 0, speed: task.speed || 0, verified: task.verified === true, retryable: ['failed', 'canceled'].includes(task.status) && !this.running.has(task.id), sha256: task.sha256 || '', error: task.error || '', errorCode: task.errorCode || '', createdAt: task.createdAt, updatedAt: task.updatedAt, retryCount: task.retryCount || 0 };
  }
  list() { return { tasks: [...this.tasks.values()].map(task => this.snapshot(task)).sort((a, b) => b.createdAt - a.createdAt), directory: this.directory }; }
  persist() {
    if (fs.realpathSync(this.directory) !== this.directory) throw error('下载目录已改变');
    const rows = [...this.tasks.values()].slice(-200).map(task => ({ ...this.snapshot(task), request: task.request, size: task.size, mtimeMs: task.mtimeMs }));
    const temp = path.join(this.directory, `.coolapk-downloads-${randomUUID()}.tmp`);
    try { fs.writeFileSync(temp, JSON.stringify(rows), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, this.stateFile); } finally { try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  changed(task, final = false) {
    task.updatedAt = Date.now(); if (final) { try { this.persist(); } catch { task.persistenceError = true; } }
    try { this.onChange(this.list()); } catch {}
  }
  task(id) { if (typeof id !== 'string' || !this.tasks.has(id)) throw error('下载任务不存在', 'INPUT'); return this.tasks.get(id); }
  opener() { const value = this.captureDownload ? this.captureDownload() : this.openDownload; if (typeof value !== 'function') throw error('下载通道不可用'); return value; }
  add(args) {
    if (this.closed) throw error('下载中心已关闭'); const request = downloadRequest(args);
    const existing = [...this.tasks.values()].find(task => task.request.packageName === request.packageName && String(task.request.versionCode || '') === String(request.versionCode || '') && ACTIVE.has(task.status));
    if (existing) return this.snapshot(existing);
    if ([...this.tasks.values()].filter(task => ACTIVE.has(task.status)).length >= 100) throw error('下载队列已满，请先完成或取消部分任务');
    const id = randomUUID(), task = { id, request, status: 'queued', downloaded: 0, total: 0, speed: 0, verified: false, createdAt: Date.now(), updatedAt: Date.now(), retryCount: 0, opener: this.opener() };
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
    if (await fsp.realpath(this.directory) !== this.directory) throw error('下载目录已改变');
    const target = path.join(this.directory, task.fileName + (partial ? '.part' : ''));
    if (path.dirname(target) !== this.directory) throw error('下载文件超出目录范围');
    try { const stat = await fsp.lstat(target); if (stat.isSymbolicLink() || !stat.isFile()) throw error('下载目标不是普通文件'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return target;
  }
  async removePartial(task) {
    if (!task.fileName) return; const partial = await this.pathFor(task, true);
    try { await fsp.unlink(partial); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async run(task) {
    let handle, reader, response, target, published = false, onAbort;
    try {
      const opened = await task.opener(task.request, { signal: task.abort.signal }); response = opened.response;
      const current = () => { if (task.abort.signal.aborted || !ACTIVE.has(task.status)) throw error('下载已取消', 'CANCELED'); opened.assertCurrent?.(); };
      current(); const plan = opened.plan;
      if (opened.verified !== true || !plan || plan.packageName !== task.request.packageName || task.request.versionCode && String(plan.versionCode) !== task.request.versionCode || !response?.ok || !response.body) throw error('酷安未确认下载响应', 'DOWNLOAD_VERIFY_FAILED');
      const contentType = String(response.headers.get('content-type') || '').toLowerCase(); if (/^(?:text\/|application\/(?:json|xhtml\+xml))/.test(contentType)) throw error('下载响应不是安装包', 'DOWNLOAD_CONTENT');
      const length = Number(response.headers.get('content-length') || 0); if (!Number.isSafeInteger(length) || length < 0 || length > this.maxBytes) throw error('安装包体积超过下载限制', 'DOWNLOAD_SIZE');
      if (response.status === 206) { const range = response.headers.get('content-range')?.match(/^bytes 0-(\d+)\/(\d+)$/i); if (!range || Number(range[1]) + 1 !== Number(range[2]) || length && Number(range[2]) !== length) throw error('服务器返回的安装包不完整', 'DOWNLOAD_TRUNCATED'); }
      Object.assign(task, { title: String(plan.title || task.request.title || plan.packageName), versionCode: String(plan.versionCode), versionName: String(plan.versionName || ''), total: length, downloaded: 0, speed: 0, verified: true });
      task.fileName = fileName(task.title, task.request.packageName, task.versionCode, task.id); target = await this.pathFor(task); const partial = await this.pathFor(task, true);
      await this.removePartial(task); handle = await fsp.open(partial, 'wx', 0o600); task.status = 'downloading'; this.changed(task, true);
      const hash = createHash('sha256'); let header = Buffer.alloc(0), lastUpdate = Date.now(), lastBytes = 0; reader = response.body.getReader();
      onAbort = () => { void reader.cancel().catch(() => {}); }; task.abort.signal.addEventListener('abort', onAbort, { once: true });
      for (;;) {
        current(); const { done, value } = await reader.read(); current(); if (done) break;
        if (!(value instanceof Uint8Array) || !value.length) continue; if (task.downloaded + value.length > this.maxBytes || length && task.downloaded + value.length > length) throw error('安装包流长度超过限制或响应声明', 'DOWNLOAD_SIZE');
        if (header.length < 4) { header = Buffer.concat([header, Buffer.from(value.subarray(0, 4 - header.length))]); if (header.length === 4 && header.readUInt32LE(0) !== 0x04034b50) throw error('下载内容不是 APK/ZIP 安装包', 'DOWNLOAD_CONTENT'); }
        hash.update(value); let offset = 0; while (offset < value.length) { current(); const { bytesWritten } = await handle.write(value, offset, value.length - offset); if (!bytesWritten) throw error('写入下载文件失败'); offset += bytesWritten; }
        task.downloaded += value.length;
        const now = Date.now(); if (now - lastUpdate >= 200) { task.speed = Math.round((task.downloaded - lastBytes) * 1000 / (now - lastUpdate)); lastUpdate = now; lastBytes = task.downloaded; this.changed(task); }
      }
      current(); if (header.length < 4 || length && task.downloaded !== length) throw error('安装包下载不完整', 'DOWNLOAD_TRUNCATED');
      await handle.sync(); await handle.close(); handle = null; current();
      // Prefer an atomic hard link; unsupported file systems use exclusive copy.
      const publicationCurrent = () => { current(); if (fs.realpathSync(this.directory) !== this.directory) throw error('下载目录已改变'); };
      await publishApk(partial, target, publicationCurrent); published = true; current(); await fsp.unlink(partial); const stat = await fsp.stat(target); current();
      Object.assign(task, { status: 'completed', speed: 0, total: task.total || task.downloaded, sha256: hash.digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs, error: '', errorCode: '' }); this.changed(task, true);
    } catch (e) {
      if (task.status !== 'canceled' && task.errorCode !== 'ACCOUNT_CHANGED') { task.status = 'failed'; task.error = e.code === 'ACCOUNT_CHANGED' ? '账号已切换，请重试下载' : e.message || '下载失败，请重试'; task.errorCode = e.code || 'DOWNLOAD_ERROR'; }
      if (e.cleanupErrorCode) { task.error = `${task.error ? task.error + '；' : ''}无法清理未完成的安装包，请检查下载目录`; task.errorCode ||= 'DOWNLOAD_CLEANUP'; }
      task.speed = 0; task.verified = false;
      try { await handle?.close(); } catch {} handle = null;
      try { await this.removePartial(task); } catch { task.error ||= '无法清理临时下载文件'; }
      if (published) try { await fsp.unlink(target); } catch { task.error = `${task.error ? task.error + '；' : ''}无法清理未完成的安装包，请检查下载目录`; task.errorCode ||= 'DOWNLOAD_CLEANUP'; }
      this.changed(task, true);
    } finally { if (onAbort) task.abort.signal.removeEventListener('abort', onAbort); try { await reader?.cancel(); } catch {} try { reader?.releaseLock(); } catch {} if (!reader) try { await response?.body?.cancel(); } catch {} }
  }
  cancel(id) {
    const task = this.task(id); if (!ACTIVE.has(task.status)) return this.snapshot(task);
    task.status = 'canceled'; task.error = ''; task.errorCode = ''; task.speed = 0; task.verified = false; task.abort?.abort(error('下载已取消', 'CANCELED')); this.changed(task, true); this.pump(); return this.snapshot(task);
  }
  retry(id) {
    const task = this.task(id); if (ACTIVE.has(task.status) || this.running.has(id) || task.status === 'completed') throw error('此下载任务不能重试');
    task.opener = this.opener(); Object.assign(task, { status: 'queued', downloaded: 0, total: 0, speed: 0, verified: false, error: '', errorCode: '', retryCount: (task.retryCount || 0) + 1 }); this.changed(task, true); this.pump(); return this.snapshot(task);
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
  invalidateScope() { for (const task of this.tasks.values()) if (ACTIVE.has(task.status)) { task.status = 'failed'; task.error = '账号已切换，请重试下载'; task.errorCode = 'ACCOUNT_CHANGED'; task.verified = false; task.speed = 0; task.abort?.abort(error(task.error, task.errorCode)); this.changed(task, true); } }
  async dispatch(operation, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw error('下载操作参数无效', 'INPUT');
    if (operation === 'list') return this.list(); if (operation === 'add') return this.add(args); if (operation === 'cancel') return this.cancel(args.id); if (operation === 'retry') return this.retry(args.id); if (operation === 'open') return this.open(args.id); if (operation === 'reveal') return this.open(args.id, true); throw error('不支持的下载操作', 'INPUT');
  }
  close() { this.closed = true; for (const task of this.tasks.values()) if (ACTIVE.has(task.status)) this.cancel(task.id); }
}
module.exports = { DownloadManager, downloadRequest, fileName, publishApk, MAX_APK_BYTES };
