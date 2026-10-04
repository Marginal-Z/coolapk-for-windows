// Publish only verified, versioned artifacts. Drafts keep incomplete uploads out
// of the updater's public latest feed; published assets are never replaced.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repository = 'Z-YO-YI/coolapk-for-windows';
const fail = message => { throw new Error(message); };
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function releaseChanges(changelog, version) {
  if (!stableVersion.test(version)) fail('Release changelog version is invalid');
  const heading = `## ${version}`;
  const lines = String(changelog).replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === heading);
  if (start < 0) fail('Release changelog is missing this version');
  const next = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const changes = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
  if (!changes || changes.length > 6000 || /\x00/.test(changes)) fail('Release changelog is empty or too long');
  return changes;
}

async function fingerprint(file) {
  const before = await lstat(file);
  if (!before.isFile() || !before.size) fail(`Release asset is not a nonempty file: ${path.basename(file)}`);
  const hash = createHash('sha256'); let size = 0;
  for await (const bytes of createReadStream(file)) { hash.update(bytes); size += bytes.length; }
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || size !== before.size) fail(`Release asset changed: ${path.basename(file)}`);
  return { size, sha256: hash.digest('hex') };
}

export async function releasePlan({ directory, metadata, tag, commit }) {
  if (!stableVersion.test(metadata?.version) || tag !== `v${metadata.version}`) fail('Release tag must exactly match the stable package version');
  if (!/^[a-f0-9]{40}$/.test(commit || '')) fail('Release commit must be a full Git commit SHA');
  const portableName = `Coolapk-Desktop-${metadata.version}-x64.exe`;
  const installerName = `Coolapk-Desktop-Setup-${metadata.version}-x64.exe`;
  const manifestPath = path.join(directory, 'release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 3 || manifest.version !== metadata.version || manifest.contentMatches !== true || manifest.updates?.installerIntegrityMatches !== true || manifest.updates?.packagedConfig?.sourceMatches !== true) fail('Release manifest must verify the current application and updater');
  if (manifest.updates.provider !== 'github' || manifest.updates.owner !== 'Z-YO-YI' || manifest.updates.repo !== 'coolapk-for-windows' || manifest.updates.channel !== 'latest') fail('Release manifest update source is invalid');
  const records = [
    { ...manifest, file: manifest.file, name: portableName },
    { ...manifest.updates.installer, name: installerName },
    { ...manifest.updates.blockmap, name: installerName + '.blockmap' },
    { ...manifest.updates.metadata, name: 'latest.yml' }
  ];
  const assets = [];
  for (const item of records) {
    if (item.file !== `release/${item.name}` || !Number.isSafeInteger(item.size) || item.size <= 0 || !digestPattern.test(item.sha256 || '')) fail(`Release manifest asset is invalid: ${item.name}`);
    const file = path.join(directory, item.name), actual = await fingerprint(file);
    if (actual.size !== item.size || actual.sha256 !== item.sha256) fail(`Release asset differs from the verified manifest: ${item.name}`);
    assets.push({ name: item.name, file, ...actual });
  }
  assets.push({ name: 'release-manifest.json', file: manifestPath, ...await fingerprint(manifestPath) });
  return { tag, commit, version: metadata.version, assets };
}

export function compareReleaseAssets(actual, expected, { allowMissing = false } = {}) {
  if (!Array.isArray(actual)) fail('GitHub release assets are unavailable');
  const names = new Map(expected.map(asset => [asset.name, asset]));
  const seen = new Set();
  for (const asset of actual) {
    const wanted = names.get(asset.name);
    if (!wanted || seen.has(asset.name)) fail(`Existing release has an unexpected or duplicate asset: ${asset.name}`);
    if (asset.state !== 'uploaded' || asset.size !== wanted.size || asset.digest !== `sha256:${wanted.sha256}`) fail(`Existing release asset differs; refusing replacement: ${asset.name}`);
    seen.add(asset.name);
  }
  const missing = expected.filter(asset => !seen.has(asset.name));
  if (!allowMissing && missing.length) fail(`Existing release is incomplete: ${missing.map(asset => asset.name).join(', ')}`);
  return missing;
}

export function assertNewerVersion(version, latestTag) {
  const latestVersion = String(latestTag).replace(/^v/, '');
  if (!stableVersion.test(version) || !stableVersion.test(latestVersion)) fail('Stable release version ordering cannot be verified');
  const next = version.split('.').map(BigInt), previous = latestVersion.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (next[index] > previous[index]) return;
    if (next[index] < previous[index]) break;
  }
  fail('Refusing to move the latest update feed to the same or an older version');
}

function gh(args, { permit404 = false } = {}) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15 * 60 * 1000 }).trim(); }
  catch (error) {
    if (permit404 && /HTTP 404/.test(String(error.stderr))) return null;
    fail(`GitHub release command failed (${error.status ?? error.code ?? 'unknown'}); release was not marked complete`);
  }
}
const api = (endpoint, options) => {
  const body = gh(['api', '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint], options);
  return body == null ? null : JSON.parse(body);
};

// The tag endpoint can omit drafts even for the workflow that created them.
// Enumerate authenticated releases, then read the stable REST release ID.
export async function findReleaseByTag(tag, request = api) {
  if (!stableVersion.test(String(tag).replace(/^v/, '')) || !String(tag).startsWith('v')) fail('Release lookup requires a stable version tag');
  let match = null;
  const seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const releases = await request(`repos/${repository}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) fail('GitHub release inventory is unavailable');
    for (const release of releases) {
      if (!Number.isSafeInteger(release?.id) || release.id <= 0 || seen.has(release.id)) fail('GitHub release inventory contains an invalid or duplicate identity');
      seen.add(release.id);
      if (release.tag_name !== tag) continue;
      if (match) fail('Multiple GitHub releases use the requested tag; refusing to select a draft');
      match = release;
    }
    if (releases.length < 100) {
      if (!match) return null;
      const result = await request(`repos/${repository}/releases/${match.id}`);
      if (!result || result.id !== match.id || result.tag_name !== tag || result.target_commitish !== match.target_commitish || typeof result.draft !== 'boolean' || typeof result.prerelease !== 'boolean') fail('GitHub release identity changed during lookup');
      return result;
    }
  }
  fail('GitHub release inventory exceeded the bounded lookup limit');
}

export async function publishDraftRelease(plan, draft, { request = api, run = gh } = {}) {
  if (!Number.isSafeInteger(draft?.id) || draft.id <= 0 || !draft.draft || draft.prerelease || draft.target_commitish !== plan.commit || draft.tag_name !== plan.tag) fail('Draft release identity differs after upload');
  compareReleaseAssets(draft.assets, plan.assets);
  // Uploading large installers can take minutes. Recheck at the point of
  // publication while the repository-wide workflow lock is still held.
  const latest = await request(`repos/${repository}/releases/latest`, { permit404: true });
  if (latest) assertNewerVersion(plan.version, latest.tag_name);
  await run(['api', '--method', 'PATCH', '-H', 'X-GitHub-Api-Version: 2022-11-28', `repos/${repository}/releases/${draft.id}`, '-F', 'draft=false', '-f', 'make_latest=true']);
  const published = await request(`repos/${repository}/releases/${draft.id}`);
  if (published?.id !== draft.id || published?.tag_name !== plan.tag || published?.draft || published?.prerelease || published?.target_commitish !== plan.commit) fail('Release publication was not confirmed');
  compareReleaseAssets(published.assets, plan.assets);
  return published;
}

async function publish(plan) {
  const changes = releaseChanges(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), plan.version);
  let existing = await findReleaseByTag(plan.tag);
  if (!existing || existing.draft) {
    const latest = api(`repos/${repository}/releases/latest`, { permit404: true });
    if (latest) assertNewerVersion(plan.version, latest.tag_name);
  }
  if (existing) {
    if (existing.tag_name !== plan.tag || existing.target_commitish !== plan.commit || existing.prerelease) fail('Existing release identity differs; refusing replacement');
    const missing = compareReleaseAssets(existing.assets, plan.assets, { allowMissing: existing.draft });
    if (!existing.draft) { console.log(`RELEASE_ALREADY_PUBLISHED ${existing.html_url}`); return; }
    if (missing.length) gh(['release', 'upload', plan.tag, '--repo', repository, ...missing.map(asset => asset.file)]);
  } else {
    const temporary = await mkdtemp(path.join(tmpdir(), 'coolapk-release-'));
    try {
      const notes = path.join(temporary, 'notes.md');
      await writeFile(notes, `Coolapk desktop ${plan.version}\n\n${changes}\n\n下载 Setup 安装版后，可从“设置 → 软件更新”检查、下载并安装后续版本。便携版也可下载相同安装器并在确认后迁移到安装版；账号和设置保留在本机用户目录。\n\n- \`Coolapk-Desktop-Setup-${plan.version}-x64.exe\`：Windows x64 安装版。\n- \`Coolapk-Desktop-${plan.version}-x64.exe\`：Windows x64 便携版。\n- \`latest.yml\` 与 \`.blockmap\`：软件内更新元数据。\n- \`release-manifest.json\`：本次构建的文件摘要及离线验证记录。\n\n完整复刻手机客户端仍在开发中，具体已实现能力与未完成项见仓库 README 和 research/parity-gaps.json。\n`);
      gh(['release', 'create', plan.tag, '--repo', repository, '--verify-tag', '--target', plan.commit, '--title', `酷安桌面端 ${plan.version}`, '--notes-file', notes, '--draft', ...plan.assets.map(asset => asset.file)]);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  existing = await findReleaseByTag(plan.tag);
  const published = await publishDraftRelease(plan, existing);
  console.log(`RELEASE_PUBLISHED ${published.html_url}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (process.argv.slice(2).some(value => value !== '--dry-run')) fail('Usage: node scripts/publish-release.mjs [--dry-run]');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const tag = process.env.GITHUB_REF_NAME || `v${metadata.version}`;
  const plan = await releasePlan({ directory: path.join(root, 'release'), metadata, tag, commit });
  if (dryRun) { console.log('RELEASE_PLAN_PASS', JSON.stringify({ repository, tag, commit, assets: plan.assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })) })); return; }
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_REF !== `refs/tags/${tag}` || process.env.GITHUB_SHA !== commit) fail('Publishing is restricted to this repository’s matching tag-push workflow');
  const tagCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  if (tagCommit !== commit) fail('Release tag does not point to the checked commit');
  execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: root });
  await publish(plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('RELEASE_PUBLISH_FAIL:', error.message); process.exitCode = 1; });
}
