import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(new URL('../research/parity-gaps.json', import.meta.url), 'utf8'));
const markdown = readFileSync(new URL('../research/mobile-parity-audit.md', import.meta.url), 'utf8');
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseManifest = JSON.parse(readFileSync(new URL('../research/release-manifest.json', import.meta.url), 'utf8'));
const apkBindings = JSON.parse(readFileSync(new URL('../research/apk-request-bindings.json', import.meta.url), 'utf8'));
const mobileBaseline = JSON.parse(readFileSync(new URL('../research/mobile-ui-baseline.json', import.meta.url), 'utf8'));
const teenagerLiveEvidence = JSON.parse(readFileSync(new URL('../research/teenager-live-checks.json', import.meta.url), 'utf8'));
const videoEditContract = JSON.parse(readFileSync(new URL('../research/video-edit-contract.json', import.meta.url), 'utf8'));
const replyEditContract = JSON.parse(readFileSync(new URL('../research/reply-edit-contract.json', import.meta.url), 'utf8'));
const livePhotoChatContract = JSON.parse(readFileSync(new URL('../research/live-photo-chat-contract.json', import.meta.url), 'utf8'));
const versionTuple = version => String(version).split('.').map(Number);
const compareVersions = (left, right) => {
  const a = versionTuple(left), b = versionTuple(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
};

test('package and parity audit target the candidate while GitHub branch and release status stay distinct', () => {
  assert.ok(versionTuple(releaseManifest.version).length === 3 && versionTuple(releaseManifest.version).every(Number.isInteger));
  assert.ok(compareVersions(releaseManifest.version, packageInfo.version) <= 0);
  assert.equal(report.sourceVersion, packageInfo.version);
  const versionStart = markdown.indexOf('版本口径：');
  const versionEnd = markdown.indexOf('\n\n', versionStart);
  const versionSection = markdown.slice(versionStart, versionEnd);
  assert.ok(versionSection.includes(`为 ${packageInfo.version}`));
  assert.ok(versionSection.includes(`是 ${releaseManifest.version} 的本地安装包验证记录`));
  assert.ok(versionSection.includes('本轮起点为 `main` / `7c2df08a08434b39b65ee764077ba79ca71362bf`'));
  assert.ok(versionSection.includes('与 GitHub `main` 同步'));
  assert.ok(versionSection.includes(`最新正式 Release 经本轮 GitHub 查询确认为 \`v${releaseManifest.version}\``));
  assert.ok(versionSection.includes(`本轮维护候选版本为 ${packageInfo.version}`));
  assert.ok(versionSection.includes('发布结果须以标签构建和 Release 验证为准'));
});

test('private-message live-photo pairing follows the recovered APK send contract', () => {
  const sends = apkBindings.contracts.filter(contract => contract.endpoint === 'message/send');
  assert.deepEqual(sends.map(contract => contract.methodIndex), livePhotoChatContract.messageSendContracts.map(contract => contract.methodIndex));
  for (const contract of livePhotoChatContract.messageSendContracts) {
    const binding = sends.find(item => item.methodIndex === contract.methodIndex);
    const names = binding.parameters.flatMap(parameter => parameter.annotations.map(annotation => `${annotation.kind}:${annotation.name}`));
    assert.deepEqual(names.filter(name => name.startsWith('Part:')).map(name => name.slice(5)), contract.parts);
    assert.ok(!contract.parts.some(name => /live.?video/i.test(name)));
  }
  assert.equal(livePhotoChatContract.messageModel.pairedLiveVideoField, false);
  const gap = report.gaps.find(item => item.feature === '实况照片发布/HDR');
  assert.match(gap.nextStep, /private-message pairing remains unverified/);
  assert.match(markdown, /私信 `message\/send` 有 `message_pic`、`message_extra`，但无专用配对视频字段/);
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
  assert.deepEqual(currentObservation.screens.freshVisibleLabels.首页频道, ['话题', '关注', '头条', '热榜', '快讯', '新机', '汽车']);
  assert.equal(currentObservation.screens.freshVisibleLabels.首页选中频道, '头条');
  assert.deepEqual(currentObservation.screens.freshVisibleLabels.数码栏目, ['数码库', '数码', '手机', '排行榜', '系统', '平板', '电脑']);
  assert.equal(currentObservation.screens.freshVisibleLabels.数码选中栏目, '数码');
  assert.deepEqual(currentObservation.screens.freshVisibleLabels.数码库子页, ['热门']);
  assert.deepEqual(currentObservation.screens.confirmedInternalRoutes, {
    数码库: '/product/categoryList',
    数码库热门: '/product/categoryDetailList?type=category&id=0',
  });
  assert.deepEqual(currentObservation.screens.freshVisibleLabels.发现栏目, ['酷品', '生活', '二手', '酷图', '宠物', '运动', '看看号']);
  assert.equal(currentObservation.screens.freshVisibleLabels.发现选中栏目, '酷图');
  assert.deepEqual(currentObservation.screens.freshVisibleLabels.我的快捷入口, ['动态', '关注', '粉丝', '我的关注', '我的收藏', '我的点评', '我的回复', '我的挂件', '更多']);
  assert.deepEqual(currentObservation.screens.freshVisibleLabels.设置分类, ['界面显示', '图片设置', '隐私设置', '实验室', '关于']);
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

test('teenager audit distinguishes verified anonymous endpoint access from remaining renderer parity', () => {
  const entry = report.gaps.find(gap => gap.feature === '青少年模式主进程限制与精选内容');
  assert.ok(entry);
  assert.equal(entry.implementationState, 'partial');
  assert.equal(entry.verificationState, 'native_local_and_guest_live_verified');
  assert.equal(entry.guestLivePageCount, 3);
  assert.deepEqual(entry.remainingUnknown, ['Full native curated-card inventory and feed-detail/media presentation parity']);
  assert.deepEqual(teenagerLiveEvidence.pages.map(page => [page.http, page.feedCount, page.queryTotal]), [[200, 20, 4461], [200, 19, 4461], [200, 20, 4461]]);
  assert.equal(teenagerLiveEvidence.phoneModeChanged, false);
  assert.equal(teenagerLiveEvidence.writesPerformed, false);
  assert.equal(teenagerLiveEvidence.rawResponsePersisted, false);
  assert.equal(teenagerLiveEvidence.configCard.renderingParityVerified, false);
  const workflow = report.workflowEvidence.find(item => item.family === 'teenager_curated_mode_and_main_access');
  assert.equal(workflow.guestLivePageCount, 3);
  assert.equal(workflow.guestLiveEvidence, 'research/teenager-live-checks.json');
  assert.match(markdown, /匿名只读核验了固定 `V12_TEENAGER` 接口/);
});

test('video feed editing follows the official text-only, media-preserving contract', () => {
  const entry = report.gaps.find(gap => gap.feature === '自有视频动态文字编辑（媒体保留）');
  assert.ok(entry, 'video editing contract must remain in the parity audit');
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
