import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releasePlan, compareReleaseAssets, assertNewerVersion, findReleaseByTag, publishDraftRelease, repository } from '../scripts/publish-release.mjs';

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

test('draft lookup uses authenticated release inventory and REST ID without the tag endpoint', async t => {
  const { input } = await fixture(t), { assets } = await releasePlan(input);
  const draft = { id: 512, tag_name: 'v0.5.0', target_commitish: commit, draft: true, prerelease: false, assets: uploaded(assets) };
  const requests = [];
  const result = await findReleaseByTag('v0.5.0', endpoint => {
    requests.push(endpoint);
    if (endpoint === `repos/${repository}/releases?per_page=100&page=1`) return [draft];
    if (endpoint === `repos/${repository}/releases/512`) return draft;
    throw new Error('Draft tag endpoint is unavailable');
  });
  assert.equal(result.id, 512); assert.equal(result.target_commitish, commit); assert.equal(result.draft, true);
  assert.deepEqual(compareReleaseAssets(result.assets, assets), []);
  assert.deepEqual(requests, [`repos/${repository}/releases?per_page=100&page=1`, `repos/${repository}/releases/512`]);
});

test('release lookup finds a requested draft on a later page and returns null only after the inventory ends', async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, tag_name: `v1.0.${index}`, target_commitish: commit }));
  const draft = { id: 200, tag_name: 'v0.5.0', target_commitish: commit, draft: true, prerelease: false, assets: [] };
  const requests = [];
  const request = endpoint => {
    requests.push(endpoint);
    if (endpoint.endsWith('page=1')) return pageOne;
    if (endpoint.endsWith('page=2')) return [draft];
    if (endpoint.endsWith('/200')) return draft;
    throw new Error('Unexpected endpoint');
  };
  assert.equal((await findReleaseByTag('v0.5.0', request)).id, 200);
  assert.equal(requests.length, 3);
  requests.length = 0;
  assert.equal(await findReleaseByTag('v9.0.0', request), null);
  assert.equal(requests.length, 2);
});

test('release lookup rejects duplicate tags and identity changes instead of resuming an ambiguous draft', async () => {
  const draft = { id: 100, tag_name: 'v0.5.0', target_commitish: commit, draft: true, prerelease: false, assets: [] };
  await assert.rejects(findReleaseByTag('v0.5.0', () => [draft, { ...draft, id: 101 }]), /Multiple GitHub releases/);
  await assert.rejects(findReleaseByTag('v0.5.0', endpoint => endpoint.includes('?') ? [draft] : { ...draft, target_commitish: 'b'.repeat(40) }), /identity changed/);
  await assert.rejects(findReleaseByTag('v0.5.0', endpoint => endpoint.includes('?') ? [draft] : { ...draft, id: 101 }), /identity changed/);
  await assert.rejects(findReleaseByTag('v0.5.0', () => null), /inventory is unavailable/);
  await assert.rejects(findReleaseByTag('v0.5.0', () => [draft, draft]), /invalid or duplicate identity/);
});

test('draft publication rejects a newer release that appeared during installer upload without issuing PATCH', async t => {
  const { input } = await fixture(t), plan = await releasePlan(input);
  const draft = { id: 512, tag_name: plan.tag, target_commitish: commit, draft: true, prerelease: false, assets: uploaded(plan.assets) };
  assert.doesNotThrow(() => assertNewerVersion(plan.version, 'v0.4.0'));
  let mutations = 0;
  await assert.rejects(publishDraftRelease(plan, draft, {
    request: endpoint => {
      assert.equal(endpoint, `repos/${repository}/releases/latest`);
      return { tag_name: 'v0.6.0', draft: false, prerelease: false };
    },
    run: () => { mutations++; }
  }), /same or an older version/);
  assert.equal(mutations, 0);
});

test('draft publication checks latest immediately before PATCH and verifies the same release after publication', async t => {
  const { input } = await fixture(t), plan = await releasePlan(input);
  const draft = { id: 512, tag_name: plan.tag, target_commitish: commit, draft: true, prerelease: false, assets: uploaded(plan.assets) };
  const published = { ...draft, draft: false, html_url: 'https://github.com/Z-YO-YI/coolapk-for-windows/releases/tag/v0.5.0' };
  const operations = [];
  const result = await publishDraftRelease(plan, draft, {
    request: endpoint => {
      operations.push(endpoint);
      if (endpoint.endsWith('/latest')) return { tag_name: 'v0.4.0' };
      assert.equal(endpoint, `repos/${repository}/releases/512`);
      return published;
    },
    run: args => {
      operations.push('PATCH');
      assert.deepEqual(args, ['api', '--method', 'PATCH', '-H', 'X-GitHub-Api-Version: 2022-11-28', `repos/${repository}/releases/512`, '-F', 'draft=false', '-f', 'make_latest=true']);
    }
  });
  assert.equal(result, published);
  assert.deepEqual(operations, [`repos/${repository}/releases/latest`, 'PATCH', `repos/${repository}/releases/512`]);
});
