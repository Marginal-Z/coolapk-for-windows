import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
// All API responses are synthetic. Block every browser request outside the local test origin.
const port = Number(process.env.COOLAPK_MEDIA_TEST_PORT || 5176);
const origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
const options = process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {};
let browser;
try { browser = await chromium.launch({ headless: true, ...options }); } catch (error) { await server.close(); throw error; }
const context = await browser.newContext({ viewport: { width: 1360, height: 920 }, bypassCSP: true });
let syntheticVideo;
const videoUrls = new Set(['local-object', 'local-string', 'direct', 'remote', 'updated-local'].map(name => `https://video.coolapk.com/video/synthetic-${name}.webm`));
await context.route('**/*', route => {
  if (route.request().url().startsWith(origin + '/')) return route.continue();
  if (syntheticVideo && videoUrls.has(route.request().url())) return route.fulfill({ status: 200, contentType: 'video/webm', body: syntheticVideo, headers: { 'Accept-Ranges': 'bytes' } });
  return route.abort();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__mediaElementErrors = [];
  document.addEventListener('error', event => { if (event.target instanceof HTMLMediaElement) window.__mediaElementErrors.push({ source: event.target.src, code: event.target.error?.code }); }, true);
  const account = { uid: '42', username: 'UI 测试账号', userAvatar: '' };
  const feed = { entityType: 'feed', id: 101, uid: 43, username: '测试酷友', message: '评论和图片交互测试', likenum: 2, replynum: 2, dateline: 1791000000 };
  const media = (id, message, mediaInfo) => ({ ...feed, id, message, mediaInfo });
  const local = name => ({ fromType: 'localVideo', '0': `https://video.coolapk.com/video/synthetic-${name}.webm` });
  const remoteParams = JSON.stringify({ fromType: 'syntheticRemoteProvider', id: 'remote-player' });
  window.__mediaMalformed = false;
  const nonRecords = [null, 'null', [], '[]', 7, '7', true, 'true', '"text"'];
  const malformedFeeds = () => window.__mediaMalformed ? [
    ...nonRecords.map((value, index) => ({ ...media(900 + index, '非记录媒体信息' + index, value), videoUrl: 'https://video.coolapk.com/video/synthetic-direct.webm' })),
    ...nonRecords.map((value, index) => ({ ...media(910 + index, '非记录服务商信息' + index, { requestParams: value }), videoUrl: 'https://video.coolapk.com/video/synthetic-direct.webm' })),
    ...['null', '[]', '7', 'true', '"text"', 'opaque-provider=resolved;not-json'].map((value, index) => media(930 + index, '非记录或不透明选中参数' + index, { requestParams: { selected: value } })),
  ] : [];
  window.__mediaRemoteParams = remoteParams; window.__mediaUpdated = false; window.__mediaHold = false; window.__mediaRelease = null; window.__mediaCompleted = 0;
  const videoFeeds = () => [
    media(801, '已解析对象实况视频', { requestParams: { selected: local('local-object') } }),
    media(802, '已解析字符串实况视频', JSON.stringify({ requestParams: JSON.stringify({ selected: JSON.stringify(local('local-string')) }) })),
    { ...media(803, '已有直接视频地址', {}), videoUrl: 'https://video.coolapk.com/video/synthetic-direct.webm' },
    media(804, window.__mediaUpdated ? '同条动态媒体已经更新' : '需要解析的远端视频', { requestParams: { ignored: { fromType: 'unusedProvider', id: 'unused' }, selected: window.__mediaUpdated ? local('updated-local') : remoteParams } }),
  ];
  window.__mockCalls = []; window.__writes = 0; window.__verified = false; window.__deleted = false; window.__deleteVerified = false; window.__noSession = false; window.__newSent = false;
  window.coolapk = {
    accounts: async () => ({ ok: true, data: { accounts: [account], current: account } }),
    onAccount: callback => { window.__accountChange = callback; return () => {}; }, onCommand: () => () => {},
    openExternal: async url => { window.__external = url; return { ok: true, data: {} }; },
    verify: async ticket => { if (ticket === 'mock-delete') { window.__deleteVerified = true; window.__deleted = true; } else window.__verified = true; window.__writes++; return { ok: true, data: {} }; },
    call: async (operation, args = {}) => {
      window.__mockCalls.push({ operation, args: operation === 'uploadImage' ? { ...args, bytes: args.bytes.length } : args });
      const ok = data => ({ ok: true, data: { data } });
      if (operation === 'init' || operation === 'hotSearch') return ok([]);
      if (operation === 'home') return ok([feed, ...videoFeeds(), ...malformedFeeds()]);
      if (operation === 'detail') return ok(feed);
      if (operation === 'replies') return ok([{ entityType: 'feedReply', id: 201, uid: 44, username: '评论者', message: '楼层评论', likenum: 0, replynum: 1, replyRows: [{ id: 202, uid: 45, username: '楼中楼', message: '嵌套评论', likenum: 0 }] }, ...(!window.__deleted ? [{ entityType: 'feedReply', id: 203, uid: 42, username: 'UI 测试账号', message: '我自己的评论', likenum: 0 }] : [])]);
      if (operation === 'user') return ok({ uid: args.uid, username: '测试酷友' });
      if (operation === 'userFeeds') return ok([]);
      if (operation === 'uploadImage') return ok(`https://image.coolapk.com/${args.dir || 'feed'}/2026/mock-image.png`);
      if (operation === 'action' && args.type === 'reply') {
        if (!window.__verified) return { ok: false, error: { message: '模拟人工安全验证', code: 'VERIFY_REQUIRED', verificationId: 'mock-reply' } };
        return ok({ id: 999 });
      }
      if (operation === 'action' && args.type === 'sendMessage') { window.__writes++; if (window.__noSession) window.__newSent = true; return ok([{ id: window.__noSession ? 305 : 302, fromuid: 42, uid: args.uid, message: args.message, message_pic: args.pic || '' }]); }
      if (operation === 'action' && args.type === 'deleteReply') { if (!window.__deleteVerified) return { ok: false, error: { message: '模拟删除前人工验证', code: 'VERIFY_REQUIRED', verificationId: 'mock-delete' } }; return ok({ id: args.id }); }
      if (operation === 'messages') return ok(window.__noSession && !window.__newSent ? [] : [{ entityType: 'message', id: 301, messageUid: 43, uid: 42, fromuid: 42, messageUsername: '聊天酷友', title: '聊天酷友', message: '打开聊天测试', ukey: window.__noSession ? 'server-new-42-43' : '42_43' }]);
      if (operation === 'chat') return ok([{ id: 303, entityType: 'message', uid: 43, fromuid: 42, message: '我发出的消息', message_pic: '/message/test.png' }, { id: 304, entityType: 'message', uid: 42, fromuid: 43, message: '收到的消息' }]);
      if (operation === 'messageImage') { const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180; const context=canvas.getContext('2d'); context.fillStyle='#d7eadf'; context.fillRect(0,0,320,180); context.fillStyle='#1f6953'; context.font='20px sans-serif'; context.fillText('模拟私信图片',94,96); return ok(canvas.toDataURL()); }
      if (operation === 'video') {
        if (window.__mediaHold) await new Promise(resolve => { window.__mediaRelease = resolve; });
        window.__mediaCompleted++;
        return ok({ url: 'https://video.coolapk.com/video/synthetic-remote.webm' });
      }
      return ok([]);
    }
  };
});
const checks = [];
try {
  await page.goto(origin);
  // Produce a tiny decodable VP8/WebM fixture locally; no real CDN media is fetched.
  syntheticVideo = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    canvas.getContext('2d').fillRect(0, 0, 32, 32);
    const stream = canvas.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    return await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { recorder.stop(); reject(new Error('synthetic video did not produce an encoded frame')); }, 10000);
      recorder.onerror = event => reject(new Error(event.error?.message || 'synthetic video encoding failed'));
      recorder.ondataavailable = async event => { if (!event.data.size) return; chunks.push(event.data); const bytes = new Uint8Array(await event.data.arrayBuffer()); if (recorder.state === 'recording' && bytes.some((byte, index) => byte === 0x1f && bytes[index + 1] === 0x43 && bytes[index + 2] === 0xb6 && bytes[index + 3] === 0x75)) recorder.stop(); };
      recorder.onstop = async () => { clearTimeout(deadline); stream.getTracks().forEach(track => track.stop()); resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))); };
      recorder.start(100);
      let frames = 0; const draw = () => { canvas.getContext('2d').fillStyle = frames++ % 2 ? '#227753' : '#80c5a2'; canvas.getContext('2d').fillRect(0, 0, 32, 32); if (recorder.state === 'recording') requestAnimationFrame(draw); }; requestAnimationFrame(draw);
    });
  }));
  assert.ok(syntheticVideo.length > 100, 'locally encoded video must contain media data');
  mkdirSync('.local/media-check', { recursive: true }); writeFileSync('.local/media-check/synthetic.webm', syntheticVideo);
  async function playable(card, url) {
    const video = card.locator('video');
    try { await video.waitFor({ state: 'attached', timeout: 5000 }); }
    catch (error) { console.log(JSON.stringify({ mediaErrors: await page.evaluate(() => window.__mediaElementErrors), card: await card.innerText() })); throw error; }
    assert.equal(await video.getAttribute('src'), url);
    await page.waitForFunction(id => { const video = document.querySelector(`[data-feed-id="${id}"] video`); return video?.readyState >= 2 && video.videoWidth > 0; }, await card.getAttribute('data-feed-id'));
    await video.evaluate(video => { video.muted = true; video.loop = true; return video.play(); });
    await page.waitForFunction(id => document.querySelector(`[data-feed-id="${id}"] video`)?.getVideoPlaybackQuality().totalVideoFrames > 0, await card.getAttribute('data-feed-id'), { timeout: 10000 });
    await video.evaluate(video => video.pause());
  }
  for (const [id, name] of [['801', 'local-object'], ['802', 'local-string']]) {
    const card = page.locator(`[data-feed-id="${id}"]`);
    await card.getByRole('button', { name: '播放视频', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video').length), 0, 'already resolved localVideo must not call player/getUrl');
    await playable(card, `https://video.coolapk.com/video/synthetic-${name}.webm`);
  }
  checks.push('对象和字符串 localVideo 使用已解析地址播放，实际解码合成帧且不调用播放器解析');
  const directCard = page.locator('[data-feed-id="803"]');
  await directCard.getByRole('button', { name: '播放视频', exact: true }).click();
  await playable(directCard, 'https://video.coolapk.com/video/synthetic-direct.webm');
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video').length), 0);
  checks.push('已有直接视频地址继续播放，无额外解析请求');
  const remoteCard = page.locator('[data-feed-id="804"]');
  await remoteCard.getByRole('button', { name: '播放视频', exact: true }).click();
  await playable(remoteCard, 'https://video.coolapk.com/video/synthetic-remote.webm');
  const remoteCalls = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video'));
  assert.equal(remoteCalls.length, 1);
  assert.deepEqual(remoteCalls[0].args, { params: await page.evaluate(() => window.__mediaRemoteParams) });
  checks.push('远端视频仍使用最后一个服务商原参数解析并播放返回地址');
  // Remount just the home page, then hold a remote read while the same feed changes media.
  await page.locator('.sidebar').getByRole('button', { name: '热榜', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: '首页', exact: true }).click();
  await page.evaluate(() => { window.__mediaHold = true; });
  await remoteCard.getByRole('button', { name: '播放视频', exact: true }).click();
  await page.waitForFunction(() => !!window.__mediaRelease);
  await page.evaluate(() => { window.__mediaUpdated = true; });
  await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
  await remoteCard.getByText('同条动态媒体已经更新', { exact: true }).waitFor();
  await remoteCard.getByRole('button', { name: '播放视频', exact: true }).click();
  await playable(remoteCard, 'https://video.coolapk.com/video/synthetic-updated-local.webm');
  const completed = await page.evaluate(() => window.__mediaCompleted);
  await page.evaluate(() => window.__mediaRelease());
  await page.waitForFunction(completed => window.__mediaCompleted === completed + 1, completed);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await remoteCard.locator('video').count(), 1, 'late resolution must preserve the current scoped video');
  assert.equal(await remoteCard.locator('video').getAttribute('src'), 'https://video.coolapk.com/video/synthetic-updated-local.webm');
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video').length), 2);
  checks.push('同一动态更新媒体后重置播放器，迟到旧解析不覆盖新的已解析视频');
  const priorHomeReads = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'home').length);
  await page.evaluate(() => { window.__mediaMalformed = true; window.__mediaHold = false; });
  await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
  await page.waitForFunction(prior => window.__mockCalls.filter(call => call.operation === 'home').length > prior, priorHomeReads);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(errors, [], 'null and non-record media metadata must not crash the app');
  assert.equal(await page.locator('[data-feed-id="101"]').count(), 1);
  for (const id of [...Array.from({ length: 9 }, (_, index) => 900 + index), ...Array.from({ length: 9 }, (_, index) => 910 + index), ...Array.from({ length: 6 }, (_, index) => 930 + index)]) {
    assert.equal(await page.locator(`[data-feed-id="${id}"]`).count(), 1);
    assert.equal(await page.locator(`[data-feed-id="${id}"]`).getByRole('button', { name: '播放视频', exact: true }).count(), 1);
  }
  checks.push('JSON null、数组与基础类型媒体信息、服务商记录和选中参数不会使动态或整个App崩溃');
  const videoCallsBeforeFallback = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video').length);
  for (const id of ['901', '911']) {
    const card = page.locator(`[data-feed-id="${id}"]`);
    await card.getByRole('button', { name: '播放视频', exact: true }).click();
    await playable(card, 'https://video.coolapk.com/video/synthetic-direct.webm');
  }
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video').length), videoCallsBeforeFallback);
  checks.push('无效媒体或服务商记录仍保留已有直接地址回退，实际播放且不添加解析请求');
  const opaqueCard = page.locator('[data-feed-id="935"]');
  await opaqueCard.getByRole('button', { name: '播放视频', exact: true }).click();
  await playable(opaqueCard, 'https://video.coolapk.com/video/synthetic-remote.webm');
  const opaqueCalls = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'video'));
  assert.equal(opaqueCalls.length, videoCallsBeforeFallback + 1);
  assert.deepEqual(opaqueCalls.at(-1).args, { params: 'opaque-provider=resolved;not-json' });
  checks.push('合法不透明服务商参数不依赖JSON记录解析，原样交给播放器接口');
  await page.getByRole('button', { name: '查看动态', exact: true }).first().click();
  await page.locator('[data-comment-id="202"]').getByRole('button', { name: '回复', exact: true }).click();
  assert.ok(await page.locator('.reply-target').textContent().then(text => text.includes('楼中楼')));
  const canvasPng = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; canvas.getContext('2d').fillRect(0, 0, 4, 4); return canvas.toDataURL().split(',')[1]; });
  await page.locator('.reply-composer input[type=file]').setInputFiles({ name: 'mock.png', mimeType: 'image/png', buffer: Buffer.from(canvasPng, 'base64') });
  assert.ok(await page.locator('.reply-composer button[type=submit]').isEnabled());
  await page.locator('.reply-composer button[type=submit]').click();
  await page.locator('.reply-composer').getByRole('button', { name: '完成验证', exact: true }).waitFor();
  assert.ok(await page.locator('#reply-input').isDisabled()); mkdirSync('.local/media-check', { recursive: true }); await page.screenshot({ path: '.local/media-check/image-comment.png' });
  const replyBefore = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'action' && call.args.type === 'reply')[0]);
  assert.equal(replyBefore.args.id, '101'); assert.equal(replyBefore.args.rid, '202');
  assert.equal(replyBefore.args.message, ''); assert.match(replyBefore.args.pic, /^https:\/\/image.coolapk.com\/feed\//);
  checks.push('图片评论支持空文本且嵌套回复传递目标评论 ID');
  await page.locator('.reply-composer').getByRole('button', { name: '完成验证', exact: true }).click();
  await page.getByText('评论已发布', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__writes), 1);
  assert.equal(await page.locator('.reply-composer .attachment-previews img').count(), 0);
  const replies = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'action' && call.args.type === 'reply'));
  assert.deepEqual(replies[0].args, replies[1].args);
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'uploadImage').length), 1);
  checks.push('人工验证重试保留原请求并复用已上传图片');
  assert.equal(await page.locator('[data-comment-id="201"] > .comment-body > .comment-actions').getByRole('button', { name: '删除我的评论', exact: true }).count(), 0);
  await page.locator('[data-comment-id="203"]').getByRole('button', { name: '删除我的评论', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除我的评论', exact: true });
  await deletion.waitFor();
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'action' && call.args.type === 'deleteReply').length), 0);
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'action' && call.args.type === 'deleteReply').length), 0);
  await page.locator('[data-comment-id="203"]').getByRole('button', { name: '删除我的评论', exact: true }).click();
  await deletion.getByRole('button', { name: '确认删除评论', exact: true }).click();
  await deletion.getByRole('button', { name: '完成验证', exact: true }).waitFor();
  await page.screenshot({ path: '.local/media-check/delete-comment-confirm.png' });
  await deletion.getByRole('button', { name: '完成验证', exact: true }).click();
  await deletion.waitFor({ state: 'hidden' });
  await page.locator('[data-comment-id="203"]').waitFor({ state: 'hidden' });
  const deletions = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'action' && call.args.type === 'deleteReply'));
  assert.equal(deletions.length, 2); assert.deepEqual(deletions[0].args, { type: 'deleteReply', id: '203' }); assert.deepEqual(deletions[0].args, deletions[1].args);
  checks.push('本人评论删除需要明确确认，取消不写入，人工验证重试仍为原删除动作');
  await page.getByRole('button', { name: '关闭动态详情' }).click();
  await page.getByRole('button', { name: '打开官方帖子', exact: true }).first().click();
  assert.equal(await page.evaluate(() => window.__external), 'https://www.coolapk.com/feed/101');
  checks.push('官方帖子入口调用外部浏览器');
  await page.locator('.author-button').first().click();
  await page.getByRole('button', { name: '发私信', exact: true }).waitFor();
  await page.evaluate(() => { window.__noSession = true; });
  const priorChatCalls = await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'chat').length);
  await page.getByRole('button', { name: '发私信', exact: true }).click();
  await page.getByText('开始交流', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__mockCalls.filter(call => call.operation === 'chat').length), priorChatCalls);
  await page.locator('#chat-message').fill('从主页开启交流');
  await page.locator('.chat-compose-media button[type=submit]').click();
  await page.waitForFunction(() => window.__mockCalls.some(call => call.operation === 'chat' && call.args.ukey === 'server-new-42-43'));
  await page.getByText('从主页开启交流', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.__mockCalls.every(call => call.operation !== 'chat' || !!call.args.ukey)));
  checks.push('用户主页可以创建会话，空标识不请求聊天，首次发送后恢复服务端会话');
  await page.evaluate(() => { window.__noSession = false; });
  await page.locator('.sidebar').getByRole('button', { name: '私信', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '聊天酷友' }).first().click();
  await page.locator('.chat-compose-media').waitFor();
  assert.equal(await page.locator('.chat-message.mine').count(), 1);
  await page.getByRole('button', { name: '查看私信图片', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.private-picture-button img')?.naturalWidth > 0); await page.screenshot({ path: '.local/media-check/private-image-chat.png' }); checks.push('私信按 fromuid 判定发送者并请求受保护图片接口');
  const imageSendStart = await page.evaluate(() => window.__mockCalls.length);
  await page.locator('.chat-compose-media input[type=file]').setInputFiles({ name: 'chat.png', mimeType: 'image/png', buffer: Buffer.from(canvasPng, 'base64') });
  await page.locator('.chat-compose-media button[type=submit]').click();
  await page.waitForFunction(start => window.__mockCalls.slice(start).some(call => call.operation === 'action' && call.args.type === 'sendMessage' && call.args.uid === '43' && /\/message\//.test(call.args.pic || '')), imageSendStart);
  await page.locator('.chat-compose-media .attachment-previews img').waitFor({ state: 'hidden' });
  const imageSendCalls = await page.evaluate(start => window.__mockCalls.slice(start), imageSendStart);
  const uploads = imageSendCalls.filter(call => call.operation === 'uploadImage');
  const sends = imageSendCalls.filter(call => call.operation === 'action' && call.args.type === 'sendMessage');
  assert.equal(uploads.length, 1); assert.equal(sends.length, 1);
  const chatUpload = uploads[0];
  assert.equal(chatUpload.args.dir, 'message'); assert.equal(chatUpload.args.toUid, '43');
  const sent = sends[0];
  assert.equal(sent.args.uid, '43'); assert.equal(sent.args.message, ''); assert.match(sent.args.pic, /\/message\//);
  checks.push('纯图片私信使用 message 上传目录及目标 UID');
  await page.locator('#chat-message').fill('账号切换应清理草稿');
  await page.locator('.chat-compose-media input[type=file]').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from(canvasPng, 'base64') });
  await page.evaluate(() => window.__accountChange({ ok: true, data: { accounts: [], current: null } }));
  await page.waitForFunction(() => document.querySelector('.account-entry strong')?.textContent === '登录酷安');
  assert.equal(await page.locator('.private-picture-button').count(), 0);
  checks.push('账号切换移除私信草稿和图片');
  assert.deepEqual(await page.evaluate(() => window.__mediaElementErrors), []);
  assert.deepEqual(errors, []);
  mkdirSync('.local/media-check', { recursive: true });
  await page.screenshot({ path: '.local/media-check/guest-after-account-switch.png' });
  writeFileSync('research/media-checks.json', JSON.stringify({ mode: 'synthetic renderer contract checks', externalRequests: 'blocked', mediaResponses: 'only known synthetic CDN URLs fulfilled with a locally encoded VP8/WebM fixture; no network media fetched', checks, errors, note: '模拟接口 UI 验证；不包含真实账号或在线写入' }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); await server.close(); }
