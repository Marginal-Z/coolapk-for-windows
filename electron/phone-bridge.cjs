const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
async function apkDigest(file, expected) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !/\.apk$/i.test(file) || stat.size < 4 || stat.size > 2 * 1024 ** 3) throw new Error('安装包无效或超过 2 GB');
    const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0);
    if (header.readUInt32LE() !== 0x04034b50) throw new Error('所选文件不是有效 APK');
    const hash = require('node:crypto').createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
    const digest = hash.digest('hex'), after = await handle.stat();
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || expected && digest !== expected) throw new Error('安装包已发生变化，请重新选择');
    return { stat: after, sha256: digest };
  } finally { await handle.close(); }
}

function parseDevices(output) {
  return String(output).split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Za-z0-9_.:-]{1,160})\s+(device|unauthorized|offline)\s*(.*)$/);
    if (!match || match[1].includes(':') || /^emulator-|_adb-|\._tcp/.test(match[1])) return [];
    return [{ serial: match[1], state: match[2], model: (match[3].match(/\bmodel:(\S+)/)?.[1] || 'Android').replaceAll('_', ' ') }];
  });
}
class PhoneBridge {
  constructor({ runtimeDir, userData, dialog, parent, run = runFile, spawnProcess = spawn }) {
    this.runtimeDir = runtimeDir; this.dialog = dialog; this.parent = parent; this.run = run; this.spawnProcess = spawnProcess;
    this.env = { ...process.env, ANDROID_USER_HOME: path.join(userData, 'adb') };
    fs.mkdirSync(this.env.ANDROID_USER_HOME, { recursive: true });
    this.children = new Map(); this.screenModes = new Map(); this.files = new Map(); this.lastError = '';
  }
  get adb() { return path.join(this.runtimeDir, 'adb.exe'); }
  get scrcpy() { return path.join(this.runtimeDir, 'scrcpy.exe'); }
  async command(args, timeout = 20000) { return this.run(this.adb, args, { env: this.env, timeout, windowsHide: true, maxBuffer: 1024 * 1024 }); }
  async status() {
    if (!fs.existsSync(this.adb) || !fs.existsSync(this.scrcpy)) return { ready: false, devices: [], error: '缺少手机协同组件。开发环境请执行 pnpm prepare:phone；发行版已包含组件。' };
    try {
      const { stdout } = await this.command(['devices', '-l']);
      return { ready: true, devices: parseDevices(stdout).map(d => ({ ...d, running: this.children.has(d.serial), screenOff: this.screenModes.get(d.serial) === true })), error: this.lastError };
    } catch { return { ready: true, devices: [], error: '无法连接 ADB，请检查 USB 连接及手机调试授权' }; }
  }
  async authorized(serial) {
    if (typeof serial !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(serial)) throw new Error('手机编号无效');
    const status = await this.status();
    if (!status.devices.some(d => d.serial === serial && d.state === 'device')) throw new Error('手机尚未连接或未允许 USB 调试');
  }
  async start(serial, { screenOff = false } = {}) {
    if (typeof screenOff !== 'boolean') throw new Error('手机熄屏选项无效');
    await this.authorized(serial);
    if (this.children.has(serial)) return { started: true };
    this.lastError = '';
    // These are fixed scrcpy options, never renderer-supplied command arguments.
    // Screen-off mirrors the live display without dismissing Android's keyguard.
    // scrcpy restores the temporary USB stay-awake setting when its session ends.
    const args = ['--serial', serial, '--start-app=com.coolapk.market', '--window-title=酷安 · 手机协同', '--max-size=1920', '--max-fps=60', '--no-clipboard-autosync', '--keyboard=uhid'];
    if (screenOff) args.push('--turn-screen-off', '--stay-awake');
    const child = this.spawnProcess(this.scrcpy, args, { cwd: this.runtimeDir, env: { ...this.env, ADB: this.adb }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.set(serial, child);
    this.screenModes.set(serial, screenOff);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.stdout?.on('data', () => {});
    const remove = () => { if (this.children.get(serial) === child) { this.children.delete(serial); this.screenModes.delete(serial); } };
    child.once('error', () => { remove(); this.lastError = '手机协同窗口启动失败，请检查组件'; });
    child.once('exit', code => { remove(); if (code) this.lastError = '手机协同连接已中断，请检查手机调试授权后重试'; });
    return { started: true };
  }
  stop(serial) { if (typeof serial !== 'string') throw new Error('手机编号无效'); this.children.get(serial)?.kill(); this.children.delete(serial); this.screenModes.delete(serial); return { stopped: true }; }
  async pickApk() {
    const { canceled, filePaths } = await this.dialog.showOpenDialog(this.parent(), { title: '选择要在手机安装的 APK', properties: ['openFile'], filters: [{ name: 'Android 安装包', extensions: ['apk'] }] });
    if (canceled || filePaths.length !== 1) return null;
    return this.registerApk(filePaths[0]);
  }
  // Main-process capability only. The IPC dispatch never accepts a file path.
  async registerApk(file, expectedSha256) {
    if (expectedSha256 != null && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('安装包校验值无效');
    const { stat, sha256 } = await apkDigest(file, expectedSha256);
    this.files.clear(); const token = require('node:crypto').randomUUID();
    this.files.set(token, { file, stat, sha256, deadline: Date.now() + 300000 });
    return { token, name: path.basename(file), size: stat.size };
  }
  async install(serial, token) {
    await this.authorized(serial);
    const selected = this.files.get(token); this.files.delete(token);
    if (!selected || selected.deadline < Date.now()) throw new Error('安装包选择已过期，请重新选择');
    const current = fs.statSync(selected.file);
    if (current.size !== selected.stat.size || current.mtimeMs !== selected.stat.mtimeMs) throw new Error('安装包已发生变化，请重新选择');
    await apkDigest(selected.file, selected.sha256);
    const { stdout } = await this.command(['-s', serial, 'install', '-r', selected.file], 180000);
    if (!/\bSuccess\b/.test(stdout)) throw new Error('手机未接受安装，请在手机协同窗口中检查提示');
    return { installed: true };
  }
  async dispatch(operation, args = {}) {
    if (operation === 'status') return this.status();
    if (operation === 'start') return this.start(args.serial, { screenOff: args.screenOff });
    if (operation === 'stop') return this.stop(args.serial);
    if (operation === 'pickApk') return this.pickApk();
    if (operation === 'install') return this.install(args.serial, args.token);
    throw new Error('不支持的手机操作');
  }
  close() { for (const child of this.children.values()) child.kill(); this.children.clear(); this.screenModes.clear(); }
}
module.exports = { PhoneBridge, parseDevices };
