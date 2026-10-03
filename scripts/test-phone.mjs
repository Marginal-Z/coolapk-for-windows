import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import phone from '../electron/phone-bridge.cjs';
if (!process.argv.includes('--live')) throw new Error('真实 USB 手机验证需要显式 --live');
const bridge = new phone.PhoneBridge({ runtimeDir: path.resolve('.local/tools/scrcpy'), userData: path.resolve('.local/phone-check'), dialog: {}, parent: () => null });
try {
  const state = await bridge.status(); assert.equal(state.ready, true);
  const device = state.devices.find(d => d.state === 'device'); assert.ok(device, '没有已授权 USB 手机');
  const version = (await bridge.command(['-s', device.serial, 'shell', 'dumpsys', 'package', 'com.coolapk.market'])).stdout.match(/versionName=([^\s]+)/)?.[1];
  await bridge.start(device.serial); const child = bridge.children.get(device.serial); let log = ''; for (const output of [child.stdout, child.stderr]) output.on('data', chunk => { log += chunk.toString(); });
  await new Promise(resolve => setTimeout(resolve, 7000));
  assert.equal(bridge.children.has(device.serial), true, '协同进程未持续运行');
  const texture = /Texture:|Renderer:|Display:|Video orientation:/i.test(log);
  assert.ok(texture, '协同进程未报告视频渲染就绪');
  const resumed = (await bridge.command(['-s', device.serial, 'shell', 'dumpsys', 'activity', 'activities'])).stdout;
  assert.ok(/(?:ResumedActivity|topResumedActivity)[^\n]*com\.coolapk\.market/.test(resumed), '手机酷安没有成为前台应用');
  fs.writeFileSync('research/phone-checks.json', JSON.stringify({ generatedAt: new Date().toISOString(), scrcpyVersion: '4.1', apkVersion: version, usbAuthorized: true, videoRendererReady: texture, coolapkForeground: true, clipboardAutosync: false, installOrSocialWriteTested: false }, null, 2) + '\n');
  console.log('PASS USB 手机授权、官方酷安前台启动、scrcpy 视频渲染；未测试付款/安装/社交写操作');
} finally { bridge.close(); }
