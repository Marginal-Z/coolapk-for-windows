import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(new URL('../research/parity-gaps.json', import.meta.url), 'utf8'));
const markdown = readFileSync(new URL('../research/mobile-parity-audit.md', import.meta.url), 'utf8');
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseManifest = JSON.parse(readFileSync(new URL('../research/release-manifest.json', import.meta.url), 'utf8'));

test('current package, release manifest, and parity audit all target the same app version', () => {
  assert.equal(releaseManifest.version, packageInfo.version);
  assert.equal(report.sourceVersion, packageInfo.version);
});

test('parity report totals match the generated audit and human-readable summary', () => {
  const gaps = report.gaps;
  const byState = state => gaps.filter(gap => gap.implementationState === state).length;
  const byPriority = priority => gaps.filter(gap => gap.priority === priority).length;
  const methodSummary = markdown.match(/静态对照发现参考客户端中的 (\d+) 个公开异步方法里，(\d+) 个可映射到当前桌面源码/);
  const gapSummary = markdown.match(/当前审计记录了 \*\*(\d+) 个仍需处理或验收的功能工作流\*\*：(\d+) 项明确缺失、(\d+) 项部分实现、(\d+) 项已有本地实现但尚未完成真实账户验收。按优先级分为 P0 (\d+) 项、P1 (\d+) 项。另有 (\d+) 个参考桌面客户端方法未映射；/);

  assert.ok(methodSummary, 'markdown must include the reference mapping summary');
  assert.deepEqual(methodSummary.slice(1).map(Number), [
    report.counts.referenceFunctions,
    report.counts.mappedSourceImplementations,
  ]);
  assert.ok(gapSummary, 'markdown must include the workflow gap summary');
  assert.deepEqual(gapSummary.slice(1).map(Number), [
    gaps.length,
    byState('missing'),
    byState('partial'),
    byState('implemented'),
    byPriority('P0'),
    byPriority('P1'),
    report.unmappedReferenceMethods.length,
  ]);
  assert.equal(report.counts.nativeFeatureGaps, gaps.length);
});

test('file upload progress helper is mapped to the current chunked upload implementation', () => {
  const entry = report.functions.find(item => item.function === 'upload_file_with_progress');
  assert.ok(entry, 'reference helper must remain in the audit');
  assert.notEqual(entry.status, 'unknown');
  assert.ok(entry.implementationCandidates.includes('core/upload.mjs'));
});

test('reference reader CAPTCHA bypass stays a separate, explicit assessment', () => {
  const entry = report.unmappedReferenceMethods.find(item => item.function === 'fetch_external_page');
  assert.ok(entry, 'reference-only reader must not disappear from source coverage');
  assert.equal(entry.assessment.scope, 'alternate_desktop_reference');
  assert.equal(entry.assessment.mobileParity, 'unverified');
  assert.match(entry.assessment.securityBoundary, /Cookie/);
  assert.match(entry.assessment.securityBoundary, /bypass(?:ing)? CAPTCHA risk control/i);
  assert.match(markdown, /不把绕过官方安全验证算作功能补齐/);
  assert.doesNotMatch(markdown, /没有对应的桌面用户界面入口/);
});
