import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releasePlan, compareReleaseAssets, assertNewerVersion } from '../scripts/publish-release.mjs';

const version = '0.5.0', commit = 'a'.repeat(40);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-publish-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = [`Coolapk-Desktop-${version}-x64.exe`, `Coolapk-Desktop-Setup-${version}-x64.exe`, `Coolapk-Desktop-Setup-${version}-x64.exe.blockmap`, 'latest.yml'];
  const records = [];
  for (const [index, name] of names.entries()) {
    const bytes = Buffer.from(`test release asset ${index}`);
    await writeFile(path.join(directory, name), bytes);
    records.push({ file: `release/${name}`, size: bytes.length, sha256: hash(bytes) });
  }
  const manifest = {
    schemaVersion: 3, version, contentMatches: true, ...records[0],
    updates: { provider: 'github', owner: 'Z-YO-YI', repo: 'coolapk-for-windows', channel: 'latest', installerIntegrityMatches: true, packagedConfig: { sourceMatches: true }, installer: records[1], blockmap: records[2], metadata: records[3] }
  };
  const save = () => writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest));
  await save();
  return { directory, manifest, save, input: { directory, metadata: { version }, tag: `v${version}`, commit } };
}
const uploaded = assets => assets.map(asset => ({ name: asset.name, size: asset.size, digest: `sha256:${asset.sha256}`, state: 'uploaded' }));

test('release plan verifies and publishes exactly installer, portable, updater metadata, blockmap and manifest', async t => {
  const { input } = await fixture(t), plan = await releasePlan(input);
  assert.equal(plan.tag, 'v0.5.0'); assert.equal(plan.commit, commit);
  assert.deepEqual(plan.assets.map(item => item.name), ['Coolapk-Desktop-0.5.0-x64.exe', 'Coolapk-Desktop-Setup-0.5.0-x64.exe', 'Coolapk-Desktop-Setup-0.5.0-x64.exe.blockmap', 'latest.yml', 'release-manifest.json']);
  assert.deepEqual(compareReleaseAssets(uploaded(plan.assets), plan.assets), []);
});
test('tag mismatch and prerelease cannot become the stable updater feed', async t => {
  const { input } = await fixture(t);
  await assert.rejects(releasePlan({ ...input, tag: 'v0.4.0' }), /tag must exactly match/);
  await assert.rejects(releasePlan({ ...input, metadata: { version: '0.5.0-beta.1' }, tag: 'v0.5.0-beta.1' }), /stable package version/);
  await assert.rejects(releasePlan({ ...input, commit: 'main' }), /full Git commit SHA/);
});
test('tampered installer and updater metadata fail before publication', async t => {
  const { input, directory } = await fixture(t);
  await writeFile(path.join(directory, 'Coolapk-Desktop-Setup-0.5.0-x64.exe'), 'modified installer');
  await assert.rejects(releasePlan(input), /differs from the verified manifest/);
  await writeFile(path.join(directory, 'Coolapk-Desktop-Setup-0.5.0-x64.exe'), 'test release asset 1');
  await writeFile(path.join(directory, 'latest.yml'), 'modified metadata');
  await assert.rejects(releasePlan(input), /latest.yml/);
});
test('unverified source, foreign feed, and manifest path traversal fail closed', async t => {
  const { input, manifest, save } = await fixture(t);
  manifest.contentMatches = false; await save();
  await assert.rejects(releasePlan(input), /must verify the current/);
  manifest.contentMatches = true; manifest.updates.owner = 'other-owner'; await save();
  await assert.rejects(releasePlan(input), /source is invalid/);
  manifest.updates.owner = 'Z-YO-YI'; manifest.updates.installer.file = '../installer.exe'; await save();
  await assert.rejects(releasePlan(input), /asset is invalid/);
});
test('published assets are immutable and require server digest and completed upload', async t => {
  const { input } = await fixture(t), { assets } = await releasePlan(input), actual = uploaded(assets);
  actual[1].digest = 'sha256:' + 'b'.repeat(64);
  assert.throws(() => compareReleaseAssets(actual, assets), /refusing replacement/);
  actual[1] = { ...uploaded(assets)[1], state: 'starter' };
  assert.throws(() => compareReleaseAssets(actual, assets), /refusing replacement/);
  actual[1] = { ...uploaded(assets)[1], digest: null };
  assert.throws(() => compareReleaseAssets(actual, assets), /refusing replacement/);
});
test('matching drafts can resume missing uploads but public incomplete or unexpected assets fail', async t => {
  const { input } = await fixture(t), { assets } = await releasePlan(input), actual = uploaded(assets).slice(0, 2);
  assert.deepEqual(compareReleaseAssets(actual, assets, { allowMissing: true }).map(item => item.name), assets.slice(2).map(item => item.name));
  assert.throws(() => compareReleaseAssets(actual, assets), /release is incomplete/);
  assert.throws(() => compareReleaseAssets([...uploaded(assets), { name: 'foreign.exe' }], assets), /unexpected or duplicate/);
  assert.throws(() => compareReleaseAssets([...uploaded(assets), uploaded(assets)[0]], assets), /unexpected or duplicate/);
});
test('stable feed cannot regress and compares version components numerically', () => {
  assert.doesNotThrow(() => assertNewerVersion('0.10.0', 'v0.9.12'));
  assert.doesNotThrow(() => assertNewerVersion('1.0.0', 'v0.99.99'));
  assert.throws(() => assertNewerVersion('0.5.0', 'v0.5.0'), /same or an older/);
  assert.throws(() => assertNewerVersion('0.5.0', 'v0.6.0'), /same or an older/);
  assert.throws(() => assertNewerVersion('0.5.0', 'v0.5.0-beta.1'), /ordering cannot be verified/);
});
