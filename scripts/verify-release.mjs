// Offline verification of a completed Windows package against this checkout.
// No build, download, account operation or phone operation is started here.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check-only');
if (process.argv.slice(2).some(value => value !== '--check-only')) throw new Error('Usage: node scripts/verify-release.mjs [--check-only]');
const archive = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const scrcpySource = path.join(root, '.local', 'tools', 'scrcpy');
const scrcpyTarget = path.join(root, 'release', 'win-unpacked', 'resources', 'scrcpy');
const manifestPath = path.join(root, 'research', 'release-manifest.json');
const slash = value => value.split(path.sep).join('/');
const fail = message => { throw new Error(message); };
const stamps = new Map();

async function filesIn(directory, prefix = '') {
  const files = new Map();
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`Cannot verify symbolic link: ${relative}`);
    if (entry.isDirectory()) for (const [name, file] of await filesIn(absolute, relative)) files.set(name, file);
    else if (entry.isFile()) files.set(relative, absolute);
    else fail(`Cannot verify non-file entry: ${relative}`);
  }
  return files;
}
function checkSets(expected, actual, label) {
  const missing = [...expected.keys()].filter(key => !actual.has(key));
  const extra = [...actual.keys()].filter(key => !expected.has(key));
  if (missing.length || extra.length) fail(`${label} inventory differs. Missing (${missing.length}): ${missing.slice(0, 12).join(', ') || 'none'}. Unexpected (${extra.length}): ${extra.slice(0, 12).join(', ') || 'none'}`);
}
const unchanged = (before, after) => before.size === after.size && before.mtimeMs === after.mtimeMs && before.ino === after.ino;
async function hashFile(file) {
  const before = await stat(file); if (!before.isFile()) fail(`Not a regular file: ${slash(path.relative(root, file))}`);
  const hash = createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(file)) { size += bytes.length; hash.update(bytes); }
  const after = await stat(file);
  if (!unchanged(before, after) || size !== after.size) fail(`File changed during verification: ${slash(path.relative(root, file))}`);
  stamps.set(file, after);
  return { size, sha256: hash.digest('hex'), mtimeMs: after.mtimeMs };
}

async function verify() {
  const sourcePackage = await readFile(path.join(root, 'package.json'));
  const metadata = JSON.parse(sourcePackage.toString('utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version)) fail('Source version is invalid');
  const artifactTemplate = metadata.build?.win?.artifactName;
  if (typeof artifactTemplate !== 'string') fail('Windows artifactName must be configured');
  const artifactName = artifactTemplate.replaceAll('${version}', metadata.version).replaceAll('${arch}', 'x64').replaceAll('${ext}', 'exe');
  if (artifactName.includes('${') || path.basename(artifactName) !== artifactName || /[\\/]/.test(artifactName) || !artifactName.endsWith('.exe')) fail('Windows portable artifactName is unsupported');
  const portable = path.join(root, 'release', artifactName);
  const archiveBefore = await stat(archive); if (!archiveBefore.isFile()) fail('app.asar is not a regular file');

  // Resolve the packaging tool's own pnpm dependency, not a machine-specific path.
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const appRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
  const asar = appRequire('@electron/asar');
  const { createTransformer } = appRequire('./out/fileTransformer.js');
  const builderVersion = appRequire('./package.json').version;
  const transform = createTransformer(root, metadata.build || {}, metadata.build?.extraMetadata, null);
  // Electron Builder removes build-only package fields. Compare its exact output;
  // all other scoped files are compared byte for byte with the checkout.
  const transformedPackage = await transform(path.join(root, 'package.json'));
  const expectedPackage = transformedPackage == null ? sourcePackage : Buffer.from(transformedPackage);

  const expected = new Map(), counts = { core: 0, electron: 0, dist: 0, metadata: 2 };
  for (const group of ['core', 'electron', 'dist']) {
    const entries = await filesIn(path.join(root, group)); if (!entries.size) fail(`Source ${group} is empty`);
    counts[group] = entries.size;
    for (const [relative, file] of entries) expected.set(group + '/' + relative, file);
  }
  if (!expected.has('dist/index.html') || ![...expected.keys()].some(name => /^dist\/assets\/.+\.js$/.test(name))) fail('Source dist is not a built application');
  for (const name of ['package.json', 'THIRD-PARTY-NOTICES.md']) expected.set(name, path.join(root, name));

  const bundled = new Map();
  for (const raw of asar.listPackage(archive, { isPack: false })) {
    const relative = raw.replaceAll('\\', '/').replace(/^\/+/, '');
    const pieces = relative.split('/');
    if (pieces.some(piece => !piece || piece === '.' || piece === '..' || piece.includes('\0'))) fail('Invalid path in app.asar');
    const group = pieces[0].toLowerCase();
    if (!['core', 'electron', 'dist'].includes(group) && !['package.json', 'third-party-notices.md'].includes(relative.toLowerCase())) continue;
    // ASAR's internal lookup follows Windows path.sep on Windows. Passing a
    // slash-normalized nested filename directly would miss deeper entries.
    const internal = path.join(...pieces), entry = asar.statFile(archive, internal);
    if (entry.files) continue;
    if (entry.link) fail(`Cannot verify ASAR symbolic link: ${relative}`);
    if (bundled.has(relative)) fail(`Duplicate core ASAR file: ${relative}`);
    bundled.set(relative, internal);
  }
  checkSets(expected, bundled, 'Application bundle');
  const mismatches = [];
  for (const [relative, file] of expected) {
    const before = await lstat(file); if (!before.isFile() || before.isSymbolicLink()) fail(`Source must be a regular file: ${relative}`);
    const current = relative === 'package.json' ? expectedPackage : await readFile(file);
    const packaged = asar.extractFile(archive, bundled.get(relative));
    if (!current.equals(packaged)) mismatches.push(relative);
    const after = await stat(file);
    if (!unchanged(before, after)) fail(`Source changed during verification: ${relative}`);
    stamps.set(file, after);
  }
  if (mismatches.length) fail(`Application bundle is stale: ${mismatches.length}/${expected.size} compared files differ: ${mismatches.slice(0, 12).join(', ')}`);
  if (!unchanged(archiveBefore, await stat(archive))) fail('app.asar changed during verification');

  const sourceRuntime = await filesIn(scrcpySource), packagedRuntime = await filesIn(scrcpyTarget);
  checkSets(sourceRuntime, packagedRuntime, 'scrcpy resources');
  const runtimeNames = new Set([...sourceRuntime.keys()].map(name => name.toLowerCase()));
  for (const name of ['adb.exe', 'scrcpy.exe', 'scrcpy-server', 'coolapk-runtime.json', 'adbwinapi.dll', 'adbwinusbapi.dll', 'sdl3.dll', 'libusb-1.0.dll']) if (!runtimeNames.has(name)) fail(`Required scrcpy runtime file missing: ${name}`);
  for (const family of ['avcodec', 'avformat', 'avutil', 'swresample']) if (![...runtimeNames].some(name => name.startsWith(family + '-') && name.endsWith('.dll'))) fail(`Required scrcpy runtime library missing: ${family}`);
  const licenses = [...sourceRuntime.keys()].filter(name => /(?:^|\/)(?:license|copying)(?:\.[^/]*)?$/i.test(name));
  if (!licenses.length) fail('scrcpy license is missing');
  for (const [relative, source] of sourceRuntime) {
    const current = await hashFile(source), packaged = await hashFile(packagedRuntime.get(relative));
    if (!current.size || current.size !== packaged.size || current.sha256 !== packaged.sha256) fail(`scrcpy runtime mismatch or empty file: ${relative}`);
  }
  const runtime = JSON.parse(await readFile(path.join(scrcpySource, 'coolapk-runtime.json'), 'utf8'));
  if (!/^\d+(?:\.\d+){1,3}$/.test(runtime.version) || !/^[a-f0-9]{64}$/.test(runtime.archiveSha256) || runtime.source !== `https://github.com/Genymobile/scrcpy/releases/tag/v${runtime.version}`) fail('scrcpy runtime metadata is invalid');

  const executable = await hashFile(portable);
  if (!executable.size) fail('Portable executable is empty');
  if (executable.mtimeMs < archiveBefore.mtimeMs) fail('Portable executable is older than app.asar; finish packaging before verification');
  // Recheck inventories and file metadata before committing the report, so a
  // concurrent build cannot quietly replace a file after its comparison.
  for (const group of ['core', 'electron', 'dist']) checkSets(new Map([...expected].filter(([name]) => name.startsWith(group + '/')).map(([name, file]) => [name.slice(group.length + 1), file])), await filesIn(path.join(root, group)), `Source ${group}`);
  checkSets(sourceRuntime, await filesIn(scrcpySource), 'Source scrcpy');
  checkSets(packagedRuntime, await filesIn(scrcpyTarget), 'Packaged scrcpy');
  for (const [file, stamp] of stamps) if (!unchanged(stamp, await stat(file))) fail(`File changed before manifest commit: ${slash(path.relative(root, file))}`);
  if (!unchanged(archiveBefore, await stat(archive))) fail('app.asar changed before manifest commit');

  const report = {
    schemaVersion: 2, checkedAt: new Date().toISOString(), version: metadata.version,
    file: slash(path.relative(root, portable)), size: executable.size, sha256: executable.sha256,
    packagedFilesCompared: expected.size, contentMatches: true,
    bundle: { archive: slash(path.relative(root, archive)), filesByGroup: counts, allScopedFilesCompared: bundled.size === expected.size, packageJsonComparison: transformedPackage == null ? 'source bytes' : `exact electron-builder ${builderVersion} createTransformer output` },
    scrcpy: { version: runtime.version, archiveSha256: runtime.archiveSha256, source: runtime.source, packagedFilesCompared: sourceRuntime.size, contentMatches: true, licenses }
  };
  if (!checkOnly) {
    const temporary = path.join(path.dirname(manifestPath), `release-manifest-${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, manifestPath); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  console.log('VERIFY_RELEASE_PASS', JSON.stringify({ version: report.version, packagedFilesCompared: report.packagedFilesCompared, filesByGroup: counts, scrcpyFilesCompared: sourceRuntime.size, licenses: licenses.length, portableBytes: executable.size, portableSha256: executable.sha256, manifestUpdated: !checkOnly }));
}

try { await verify(); }
catch (error) { console.error('VERIFY_RELEASE_FAIL:', error.message); process.exitCode = 1; }
