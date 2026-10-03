import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import phone from '../electron/phone-bridge.cjs';
test('USB device list handles Windows adb and excludes network transports and emulators', () => {
  const devices = phone.parseDevices('List of devices attached\nUSB123 device product:test model:Phone_Test transport_id:1\nUSB456 unauthorized usb:1-2\n127.0.0.1:5555 device model:Virtual\nemulator-5554 device\nfoo._adb-tls-connect._tcp device\n');
  assert.deepEqual(devices.map(d => [d.serial, d.state]), [['USB123', 'device'], ['USB456', 'unauthorized']]);
});
test('phone bridge accepts only a connected authorized serial and fixed scrcpy arguments', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolapk-phone-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'adb.exe'), 'test'); fs.writeFileSync(path.join(dir, 'scrcpy.exe'), 'test');
    const commands = [], starts = [];
    const bridge = new phone.PhoneBridge({ runtimeDir: dir, userData: dir, dialog: {}, parent: () => null, run: async (file, args) => { commands.push({ file, args }); return { stdout: 'USB123 device model:Phone_Test\nUSB456 unauthorized\n' }; }, spawnProcess: (file, args, opts) => { starts.push({ file, args, opts }); const child = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { child.emit('exit', 0); }; return child; } });
    await assert.rejects(bridge.start('USB456')); await assert.rejects(bridge.start('USB123; rm anything')); await assert.rejects(bridge.dispatch('shell', { command: 'x' }));
    await bridge.start('USB123'); await bridge.start('USB123'); assert.equal(starts.length, 1); assert.ok(starts[0].args.includes('--start-app=com.coolapk.market')); assert.ok(starts[0].args.includes('--no-clipboard-autosync')); assert.equal(starts[0].opts.windowsHide, true);
    assert.equal((await bridge.status()).devices[0].running, true); bridge.close(); assert.equal((await bridge.status()).devices[0].running, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('downloaded APK registration requires the exact expected digest and grants no renderer file-path operation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolapk-phone-apk-test-'));
  try {
    const file = path.join(dir, 'synthetic.apk'), content = Buffer.from([80, 75, 3, 4, 10, 20, 30, 40]); fs.writeFileSync(file, content);
    const bridge = new phone.PhoneBridge({ runtimeDir: dir, userData: dir, dialog: {}, parent: () => null });
    await assert.rejects(bridge.registerApk(file, 'a'.repeat(64)), /发生变化/); assert.equal(bridge.files.size, 0); await assert.rejects(bridge.registerApk(file, 'invalid digest'), /校验值无效/);
    await assert.rejects(bridge.dispatch('registerApk', { file }), /不支持的手机操作/);
    const selected = await bridge.registerApk(file, createHash('sha256').update(content).digest('hex')); assert.equal(selected.size, 8); assert.equal(selected.name, 'synthetic.apk'); assert.equal(typeof selected.token, 'string'); assert.equal(Object.hasOwn(selected, 'path'), false); bridge.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('same-size APK tampering with restored mtime during USB authorization is rejected before adb install', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolapk-phone-apk-test-'));
  try {
    const file = path.join(dir, 'synthetic.apk'), content = Buffer.from([80, 75, 3, 4, 10, 20, 30, 40]), fixedTime = new Date('2024-01-01T00:00:00Z'); fs.writeFileSync(file, content); fs.utimesSync(file, fixedTime, fixedTime); const before = fs.statSync(file);
    fs.writeFileSync(path.join(dir, 'adb.exe'), 'synthetic'); fs.writeFileSync(path.join(dir, 'scrcpy.exe'), 'synthetic'); const commands = [];
    const bridge = new phone.PhoneBridge({ runtimeDir: dir, userData: dir, dialog: {}, parent: () => null, run: async (_, args) => { commands.push(args); if (args[0] === 'devices') { fs.writeFileSync(file, Buffer.from([80, 75, 3, 4, 10, 20, 30, 41])); fs.utimesSync(file, fixedTime, fixedTime); return { stdout: 'USB123 device model:Synthetic_Phone\n' }; } return { stdout: 'Success' }; } });
    const selected = await bridge.registerApk(file, createHash('sha256').update(content).digest('hex')); await assert.rejects(bridge.install('USB123', selected.token), /发生变化/);
    const after = fs.statSync(file); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(commands.some(args => args.includes('install')), false); assert.equal(bridge.files.has(selected.token), false); bridge.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('unchanged APK installs only on the authorized USB device and the capability cannot be reused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coolapk-phone-apk-test-'));
  try {
    const file = path.join(dir, 'synthetic.apk'), content = Buffer.from([80, 75, 3, 4, 10, 20, 30, 40]); fs.writeFileSync(file, content); fs.writeFileSync(path.join(dir, 'adb.exe'), 'synthetic'); fs.writeFileSync(path.join(dir, 'scrcpy.exe'), 'synthetic'); const commands = [];
    const bridge = new phone.PhoneBridge({ runtimeDir: dir, userData: dir, dialog: {}, parent: () => null, run: async (_, args) => { commands.push(args); return { stdout: args[0] === 'devices' ? 'USB123 device model:Synthetic_Phone\n' : 'Success' }; } });
    const selected = await bridge.registerApk(file, createHash('sha256').update(content).digest('hex')); assert.deepEqual(await bridge.install('USB123', selected.token), { installed: true }); assert.deepEqual(commands.find(args => args.includes('install')), ['-s', 'USB123', 'install', '-r', file]); await assert.rejects(bridge.install('USB123', selected.token), /过期/); assert.equal(commands.filter(args => args.includes('install')).length, 1); bridge.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
