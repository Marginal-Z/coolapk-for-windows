import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '4.1';
const digest = '5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db';
const destination = path.join(root, '.local', 'tools', 'scrcpy');
const archive = path.join(root, '.local', 'tools', `scrcpy-win64-v${version}.zip`);
await mkdir(path.dirname(archive), { recursive: true });
let bytes;
try { bytes = await readFile(archive); } catch {}
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== digest) {
  const response = await fetch(`https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-win64-v${version}.zip`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`scrcpy 下载失败 HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 32 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('scrcpy 官方发行包校验失败');
  await writeFile(archive, bytes);
}
const staging = path.join(root, '.local', 'tools', `scrcpy-verified-${randomUUID()}`);
const quote = s => `'${s.replaceAll("'", "''")}'`;
execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(staging)}`], { windowsHide: true });
// Replace the runtime only from the just-verified archive, never from an old extracted cache.
if (path.relative(root, destination) !== path.join('.local', 'tools', 'scrcpy') || path.relative(root, staging).startsWith('..')) throw new Error('手机组件目标目录无效');
try { await rename(destination, path.join(root, '.local', 'tools', `scrcpy-old-${randomUUID()}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rename(path.join(staging, `scrcpy-win64-v${version}`), destination);
await writeFile(path.join(destination, 'coolapk-runtime.json'), JSON.stringify({ version, archiveSha256: digest, source: `https://github.com/Genymobile/scrcpy/releases/tag/v${version}` }, null, 2));
console.log(`官方 scrcpy ${version} 已准备，SHA-256 已验证`);
