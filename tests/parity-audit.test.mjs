import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(new URL('../research/parity-gaps.json', import.meta.url), 'utf8'));
const markdown = readFileSync(new URL('../research/mobile-parity-audit.md', import.meta.url), 'utf8');
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseManifest = JSON.parse(readFileSync(new URL('../research/release-manifest.json', import.meta.url), 'utf8'));
const apkBindings = JSON.parse(readFileSync(new URL('../research/apk-request-bindings.json', import.meta.url), 'utf8'));
const mobileBaseline = JSON.parse(readFileSync(new URL('../research/mobile-ui-baseline.json', import.meta.url), 'utf8'));
const videoEditContract = JSON.parse(readFileSync(new URL('../research/video-edit-contract.json', import.meta.url), 'utf8'));
const replyEditContract = JSON.parse(readFileSync(new URL('../research/reply-edit-contract.json', import.meta.url), 'utf8'));

test('current package, release manifest, and parity audit all target the same app version', () => {
  assert.equal(releaseManifest.version, packageInfo.version);
  assert.equal(report.sourceVersion, packageInfo.version);
});

test('fresh MuMu inventory stores only allowlisted functional labels and its inspection limit', () => {
  const observation = mobileBaseline.followupObservations.find(item => item.date === '2026-10-11' && item.device.includes('MuMu'));
  assert.ok(observation, 'latest emulator label inventory must be retained');
  assert.deepEqual(observation.screens.mainNavigation, ['首页', '数码', '发现', '我的']);
  assert.deepEqual(observation.screens.发现, ['二手', '酷图', '更多']);
  assert.match(observation.morePanel, /SimpleAlphaActivity/);
  assert.match(observation.limits, /no feed text, profile content, raw hierarchy, screenshots or social writes/);
  assert.match(markdown, /数码页含手机、排行榜、平板、电脑栏目/);

  const currentObservation = mobileBaseline.followupObservations.find(item => item.date === '2026-10-12' && item.device.includes('MuMu'));
  assert.ok(currentObservation, 'current MuMu navigation label check must be retained');
  assert.deepEqual(currentObservation.screens.数码, ['手机', '排行榜', '平板', '电脑', '耳机', '笔记本', '智能家居', '路由器', '全部']);
  assert.deepEqual(currentObservation.screens.发现, ['二手', '酷图', '看看号', '更多']);
  assert.deepEqual(currentObservation.screens.我的更多ObservedAcrossScroll, ['我的关注', '我的收藏', '我的点评', '我的数码', '我的清单', '我的装备', '我的赞', '我的回复', '我的挂件', '草稿箱', '看看号', '编辑', '设置', '返回']);
  assert.match(currentObservation.limits, /no feed or profile content/i);
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

test('video feed editing follows the official text-only, media-preserving contract', () => {
  const entry = report.gaps.find(gap => gap.feature === '自有视频动态文字编辑（媒体保留）');
  assert.ok(entry, 'video editing contract must remain in the 0.8.2 parity audit');
  assert.equal(entry.implementationState, 'partial');
  assert.equal(entry.protocolState, 'partial_apk_recovered');
  assert.match(entry.evidence.join(' '), /media_url.*media_type.*media_pic.*message_cover.*media_info/);
  assert.match(entry.nextStep, /editing only the text of an owned video feed/);
  assert.match(entry.nextStep, /本审计轮没有执行真实写入/);
  assert.match(markdown, /官方编辑配置在存在 `mediaInfo` 时隐藏图片选择器/);
  assert.deepEqual(videoEditContract.requestFieldsSerialized, ['media_url', 'media_type', 'media_pic', 'message_cover', 'media_info']);
  assert.equal(videoEditContract.verification.conversionCoroutineFullyReconstructed, false);
  assert.equal(videoEditContract.verification.realServerWritePerformed, false);
});

test('question editing and phone-install scope match current source and APK evidence', () => {
  const question = report.gaps.find(gap => gap.feature === '创建/编辑提问');
  assert.ok(question);
  assert.equal(question.implementationState, 'partial');
  assert.ok(question.endpoints.includes('/v6/feed/changeDetail'));
  assert.ok(question.endpoints.includes('/v6/feed/changeFeed'));
  assert.match(question.nextStep, /enableModify=1/);
  assert.match(question.nextStep, /real authenticated save\/readback/i);
  assert.match(question.nextStep, /admin edits/);
  assert.match(markdown, /本人问题标题\/正文编辑/);

  const downloads = report.gaps.find(gap => gap.feature === '应用后台下载/校验/历史版本下载（本机）');
  assert.ok(downloads);
  assert.match(downloads.nextStep, /Phone installation and USB collaboration were removed by user request/);
  assert.doesNotMatch(downloads.nextStep, /USB install handoff are implemented/i);
  assert.match(markdown, /手机安装和 USB 协同已按要求移除/);
});

test('comment editing is not added without an APK action or dedicated update contract', () => {
  const entry = report.gaps.find(gap => gap.feature === '独立评论编辑/评论详情导航');
  assert.ok(entry);
  assert.equal(entry.implementationState, 'partial');
  assert.deepEqual(entry.remainingUnknown, ['Official live nested-comment navigation']);
  assert.match(entry.nextStep, /no standalone edit action/i);
  assert.match(entry.nextStep, /no dedicated reply-content update route/i);

  assert.equal(replyEditContract.apk.sha256, report.officialApk.sha256);
  assert.equal(replyEditContract.bindingInventoryCount, report.officialApk.recoveredRequestCount);
  assert.deepEqual(replyEditContract.dedicatedReplyContentUpdateEndpointsFound, []);
  assert.equal(replyEditContract.bindingInventoryCount, apkBindings.contracts.length);
  const replyMutations = apkBindings.contracts.filter(contract => /reply|comment/i.test(contract.endpoint) && /edit|update|modify/i.test(contract.endpoint));
  const knownNonContentMutations = new Set(replyEditContract.relatedButDifferentEndpoints);
  assert.ok(replyMutations.some(contract => contract.endpoint === 'feed/updateDisallowReply'));
  assert.ok(replyMutations.some(contract => contract.endpoint === 'vote/updateRecommendComment'));
  assert.deepEqual(replyMutations.map(contract => contract.endpoint).filter(endpoint => !knownNonContentMutations.has(endpoint)), []);
  assert.deepEqual(replyEditContract.caller.declaredActions, [
    'Top', 'Copy', 'ViewChat', 'Forward', 'ViewPic', 'Report', 'Delete', 'Hide', 'Like',
  ]);
  assert.match(replyEditContract.conclusion, /Do not infer that the server cannot accept an update/);
  assert.match(replyEditContract.verificationLimits.join(' '), /Nested-comment deep-link behavior still requires live Android verification/);
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
