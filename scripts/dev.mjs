import { spawn } from 'node:child_process';
import electron from 'electron';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' });
let desktop;
const close = () => { desktop?.kill(); vite.kill(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
for (let i = 0; i < 100; i++) {
  await new Promise(resolve => setTimeout(resolve, 150));
  try { const response = await fetch('http://127.0.0.1:5173'); if (response.ok) break; } catch {}
  if (i === 99) { close(); throw new Error('Vite 启动超时'); }
}
const env = { ...process.env, COOLAPK_DEV_URL: 'http://127.0.0.1:5173' }; delete env.ELECTRON_RUN_AS_NODE;
desktop = spawn(electron, ['.'], { env, stdio: 'inherit' });
desktop.on('exit', code => { vite.kill(); process.exitCode = code ?? 0; });
