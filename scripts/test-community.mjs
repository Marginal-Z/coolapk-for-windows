import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Synthetic community feature checks; every remote browser request is blocked.
mkdirSync('.local/community-check', { recursive: true });
writeFileSync('.local/community-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {CommunityPage} from '/src/Community.tsx';import Detail from '/src/Detail.tsx';import {ChatComposer,ChatTools,RecentContacts} from '/src/Chat.tsx';import {uploadAttachments} from '/src/Attachments.tsx';import '/src/styles.css';
function Harness(){const [view,setView]=useState({kind:'topic',tag:'Windows'}),[defaultLatestNodeSort,setDefaultLatestNodeSort]=useState(false);useEffect(()=>{window.__communityNavigate=setView;window.__communityDefaultLatest=setDefaultLatestNodeSort;window.__communityUploadAttachments=uploadAttachments},[]);const props={defaultLatestNodeSort,accountUid:'42',loggedIn:true,onLogin:()=>{},toast:text=>{window.__communityToast=text},onUser:()=>{},onLink:url=>{window.__communityLink=url},onForward:()=>{},onOpen:feed=>setView({kind:'detail',feed})};return React.createElement('main',{style:{maxWidth:'1000px',margin:'auto',padding:'24px'}},view.kind==='detail'?React.createElement(Detail,{feed:view.feed,namespace:'42',feedProps:props,onClose:()=>setView({kind:'topic',tag:'Windows'})}):view.kind==='chat'?React.createElement(React.Fragment,null,React.createElement(ChatTools,{ukey:view.ukey,namespace:'42',onUser:()=>{},onLogin:()=>{},onDeleted:()=>{window.__communityDeleted=true},uid:'43',title:'模拟酷友'}),React.createElement(ChatComposer,{uid:'43',namespace:'42',loggedIn:true,onLogin:()=>{},onSent:()=>{}}),React.createElement(RecentContacts,{namespace:'42',onUser:()=>{},onLogin:()=>{}})):React.createElement(CommunityPage,{...view,namespace:'42',feedProps:props,onOpenEntity:()=>{}}))};createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
</script></body></html>`);
const port = Number(process.env.COOLAPK_COMMUNITY_TEST_PORT || 5177);
const origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
let browser;
const checks = [], errors = [];
async function record(title, fn) { await fn(); checks.push(title); console.log('PASS', title); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 }, bypassCSP: true });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const question = { entityType: 'feed', id: '501', uid: '43', username: '模拟酷友', feedType: 'question', title: '模拟问题', message: '<h2>文章小标题</h2><table><tbody><tr><th>项目</th><td>内容</td></tr></tbody></table><pre>&lt;safe-code&gt;</pre><script>window.__articleExecuted=true</script>', question_answer_num: 1, question_follow_num: 2, vote: { title: '模拟投票', max_select_num: 2, min_select_num: 1, total_vote_num: 3, options: [{ id: 10, title: '选项甲', vote_num: 1 }, { id: 11, title: '选项乙', vote_num: 2 }, { id: 12, title: '选项丙', vote_num: 0 }] } };
    const mock = window.__communityMock = { calls: [], question, failOnce: '', answers: [], followed: false, pagingTopic: false, failTopicMore: false, verifications: [] };
    const result = data => ({ ok: true, data: { data, hasMore: false } });
    window.coolapk = {
      verify: async id => { mock.verifications.push(id); return { ok: true, data: {} }; }, openExternal: async () => ({ ok: true, data: {} }),
      call: async (operation, args = {}) => {
        mock.calls.push({ operation, args: operation === 'uploadImage' ? { ...args, bytes: args.bytes.length } : structuredClone(args) });
        if (mock.failOnce === operation) { mock.failOnce = ''; return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟人工验证', verificationId: 'synthetic-community' } }; }
        if (operation === 'topicEntries' && mock.pagingTopic) {
          if (args.page === 2 && mock.failTopicMore) { mock.failTopicMore = false; return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟话题第二页验证', verificationId: 'synthetic-topic-page2' } }; }
          return { ok: true, data: { data: [{ entityType: 'feed', id: args.page === 2 ? '104' : '101', uid: '43', username: '模拟酷友', message: args.page === 2 ? '话题第二页' : '话题第一页' }], firstItem: 'topic_first', lastItem: args.page === 2 ? 'topic_next' : 'topic_first', hasMore: args.page !== 2 } };
        }
        if (operation === 'topicDetail') return result({ tag: 'Windows', title: 'Windows 话题', description: '服务器栏目配置', tabList: [{ pageName: 'feed', title: '讨论' }, { pageName: 'device', title: '机型' }, { pageName: 'related', title: '相关话题', url: '#/topic/tagList?sort=hot' }, { pageName: 'hidden', title: '不可见栏目', hidden: true }] });
        if (operation === 'topicEntries') return result([{ entityType: 'feed', id: '101', uid: '43', username: '模拟酷友', message: '话题动态' }]);
        if (operation === 'topicSearch') return result([{ entityType: 'feed', id: '110', uid: '43', username: '模拟酷友', message: '话题内匹配结果' }]);
        if (operation === 'topicDevices') return result([{ entityType: 'product', id: '2', title: '模拟机型' }]);
        if (operation === 'topicServerTab') return result([{ entityType: 'topic', id: '3', title: '相关话题卡片' }]);
        if (operation === 'topicFollow') { mock.followed = !!args.status; return result({}); }
        if (operation === 'liveDetail') return result({ id: '71', title: '模拟直播', liveStatus: 0, followNum: 5, description: '直播说明', showLiveTime: '明天 20:00' });
        if (operation === 'liveFollow') return result({});
        if (operation === 'detail') return result(mock.detailOverride?.id === args.id ? mock.detailOverride : question);
        if (operation === 'replies' || operation === 'advancedReplies') return result([]);
        if (operation === 'hotReplies') return result([{ entityType: 'feedReply', id: '903', uid: '43', username: '热门讨论酷友', message: '独立热门讨论内容' }]);
        if (operation === 'feedLikes') return result([{ entityType: 'user', id: '43', uid: '43', username: '赞过的酷友' }]);
        if (operation === 'feedForwards') return result([{ entityType: 'feed', id: '102', uid: '44', username: '转发者', message: '转发的想法' }]);
        if (operation === 'feedChanges') return result([{ id: '103', dateline: 1791000000, message: '修改历史正文' }]);
        if (operation === 'questionAnswers') return result(mock.answers);
        if (operation === 'questionFollow' || operation === 'questionUnfollow' || operation === 'questionInvite') return result({});
        if (operation === 'userSearch') return result(Array.from({ length: 11 }, (_, index) => ({ entityType: 'user', id: String(index + 1), uid: String(index + 1), username: `测试酷友 ${index + 1}`, userAvatar: '' })));
        if (operation === 'questionAnswer') { mock.answers.push({ entityType: 'feed', id: '502', uid: '42', username: '模拟本人', feedType: 'answer', message: args.message, pic: args.pic }); return result({ id: '502' }); }
        if (operation === 'voteSubmit') return result({ vote: { is_vote: 1, user_selected_option: args.optionIds.join(','), user_change_vote_status: 0, user_vote_comment_status: 0 } });
        if (operation === 'chatRecent') return result([{ entityType: 'user', id: '43', uid: '43', username: '最近联系酷友' }]);
        if (operation === 'chatRead' || operation === 'chatDelete') return result({});
        if (operation === 'uploadImage') return result('https://image.coolapk.com/feed/synthetic-answer.png');
        return result([]);
      },
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/community-harness.html');
  await record('topic server tabs render, hidden tabs disappear and all read modes stay distinct', async () => {
    await page.evaluate(() => window.__communityDefaultLatest(true));
    await page.getByRole('heading', { name: 'Windows 话题' }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '不可见栏目' }).count(), 0);
    await page.getByRole('tab', { name: '机型', exact: true }).click(); await page.getByText('模拟机型', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '相关话题', exact: true }).click(); await page.getByText('相关话题卡片', { exact: true }).waitFor();
    const request = await page.evaluate(() => window.__communityMock.calls.find(call => call.operation === 'topicServerTab'));
    assert.equal(request.args.url, '#/topic/tagList?sort=hot');
    await page.getByRole('tab', { name: '讨论', exact: true }).click(); await page.waitForFunction(() => window.__communityMock.calls.some(call => call.operation === 'topicEntries' && call.args.sort === 'dateline_desc'));
    await page.getByRole('combobox', { name: '话题动态排序' }).selectOption('lastupdate_desc');
    await page.waitForFunction(() => window.__communityMock.calls.some(call => call.operation === 'topicEntries' && call.args.sort === 'lastupdate_desc'));
    await page.waitForFunction(() => window.__communityMock.calls.some(call => call.operation === 'topicEntries' && call.args.sort === 'dateline_desc'));
    await page.screenshot({ path: '.local/community-check/topic.png' });
  });
  await record('topic contribution opens the existing tagged composer without submitting a mutation', async () => {
    const before = await page.evaluate(() => window.__communityMock.calls.length);
    await page.getByRole('button', { name: '发布话题动态', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__communityLink), 'https://www.coolapk.com/feed/writer?tag=Windows');
    assert.equal(await page.evaluate(() => window.__communityMock.calls.length), before);
  });
  await record('the actual topic page opens scoped search and restores ordinary browsing on exit', async () => {
    await page.getByRole('button', { name: '话题内搜索', exact: true }).click();
    const search = page.getByRole('region', { name: '话题内搜索', exact: true });
    await search.getByRole('searchbox', { name: '话题内搜索关键词', exact: true }).fill('驱动');
    await search.getByRole('button', { name: '搜索话题', exact: true }).click();
    await search.getByText('话题内匹配结果', { exact: true }).waitFor();
    const request = await page.evaluate(() => window.__communityMock.calls.find(call => call.operation === 'topicSearch'));
    assert.deepEqual(request.args, { tag: 'Windows', query: '驱动', sort: 'default', feedType: 'all', page: 1 });
    assert.equal(await page.getByText('话题动态', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '退出话题搜索', exact: true }).click();
    await search.waitFor({ state: 'hidden' }); await page.getByText('话题动态', { exact: true }).waitFor();
  });
  await record('topic follow verification retries exactly the chosen mutation', async () => {
    await page.evaluate(() => { window.__communityMock.failOnce = 'topicFollow'; });
    await page.getByRole('button', { name: '关注', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.getByRole('button', { name: '已关注', exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'topicFollow'));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args); assert.equal(calls[1].args.status, 1);
  });
  await record('topic second-page verification repeats the same page and cursors while retaining loaded feeds', async () => {
    await page.evaluate(() => { const mock = window.__communityMock; mock.pagingTopic = true; mock.paginationStart = mock.calls.length; });
    await page.getByRole('tab', { name: '机型', exact: true }).click(); await page.getByRole('tab', { name: '讨论', exact: true }).click(); await page.getByText('话题第一页', { exact: true }).waitFor();
    await page.evaluate(() => { window.__communityMock.failTopicMore = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟话题第二页验证', { exact: true }).waitFor(); assert.equal(await page.getByText('话题第一页', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('话题第二页', { exact: true }).waitFor();
    const requested = await page.evaluate(() => window.__communityMock.calls.slice(window.__communityMock.paginationStart).filter(item => item.operation === 'topicEntries'));
    assert.deepEqual(requested.map(item => item.args.page || 1), [1, 2, 2]); assert.deepEqual(requested[2].args, requested[1].args);
    assert.ok(await page.evaluate(() => window.__communityMock.verifications.includes('synthetic-topic-page2'))); assert.equal(await page.getByText('话题第一页', { exact: true }).count(), 1);
    await page.evaluate(() => { window.__communityMock.pagingTopic = false; });
  });
  await record('scheduled live details and reservation are available in the desktop view', async () => {
    await page.evaluate(() => window.__communityNavigate({ kind: 'live', id: '71' }));
    await page.getByRole('heading', { name: '模拟直播' }).waitFor(); await page.getByRole('button', { name: '预约直播', exact: true }).click();
    await page.getByRole('button', { name: '已预约', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.__communityMock.calls.some(call => call.operation === 'liveFollow' && call.args.id === '71' && call.args.status === 1)));
    await page.screenshot({ path: '.local/community-check/live.png' });
  });
  await page.evaluate(() => window.__communityNavigate({ kind: 'detail', feed: window.__communityMock.question }));
  await page.getByRole('dialog', { name: '动态详情', exact: true }).waitFor();
  await record('question and article content preserves tables/code while stripping scripts', async () => {
    await page.getByRole('button', { name: '写回答', exact: true }).waitFor();
    assert.equal(await page.locator('.detail-panel table').count(), 1); assert.equal(await page.locator('.detail-panel pre').textContent(), '<safe-code>');
    assert.equal(await page.evaluate(() => window.__articleExecuted), undefined);
    await page.getByRole('combobox', { name: '回答排序', exact: true }).selectOption('like');
    await page.waitForFunction(() => window.__communityMock.calls.some(call => call.operation === 'questionAnswers' && call.args.sort === 'like'));
  });
  await record('poll selection limits, APK-authorized vote changes and captcha retries preserve the chosen option ids', async () => {
    const vote = page.getByRole('region', { name: '投票' });
    await vote.getByRole('checkbox', { name: /选项甲/ }).click(); await vote.getByRole('checkbox', { name: /选项乙/ }).click(); await vote.getByRole('checkbox', { name: /选项丙/ }).click();
    assert.equal(await vote.getByRole('checkbox', { name: /选项丙/ }).getAttribute('aria-checked'), 'false');
    await page.evaluate(() => { window.__communityMock.failOnce = 'voteSubmit'; });
    await vote.getByRole('button', { name: '提交投票', exact: true }).click(); await vote.getByRole('button', { name: '完成验证', exact: true }).click(); await vote.getByText('已参与投票', { exact: true }).waitFor();
    let calls = await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'voteSubmit'));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args); assert.deepEqual(calls[1].args.optionIds, ['10', '11']);
    await vote.getByRole('button', { name: '修改投票', exact: true }).click();
    await vote.getByRole('checkbox', { name: /选项甲/ }).click(); await vote.getByRole('checkbox', { name: /选项丙/ }).click();
    assert.equal(await vote.getByRole('checkbox', { name: /选项甲/ }).getAttribute('aria-checked'), 'false');
    await page.evaluate(() => { window.__communityMock.failOnce = 'voteSubmit'; });
    await vote.getByRole('button', { name: '保存修改', exact: true }).click(); await vote.getByRole('button', { name: '完成验证', exact: true }).click();
    await vote.getByRole('button', { name: '修改投票', exact: true }).waitFor();
    calls = await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'voteSubmit'));
    assert.equal(calls.length, 4); assert.deepEqual(calls[2].args, calls[3].args); assert.deepEqual(calls[3].args.optionIds, ['11', '12']);
    await vote.getByRole('button', { name: '修改投票', exact: true }).click(); await vote.getByRole('button', { name: '取消修改', exact: true }).click();
    assert.equal(await vote.getByRole('checkbox', { name: /选项乙/ }).getAttribute('aria-checked'), 'true');
    assert.equal(await vote.getByRole('checkbox', { name: /选项丙/ }).getAttribute('aria-checked'), 'true');
    await page.screenshot({ path: '.local/community-check/question-vote.png' });
  });
  await record('votes marked non-changeable by the APK never expose the edit action', async () => {
    await page.evaluate(() => { const feed = structuredClone(window.__communityMock.question); feed.id = '509'; feed.vote = { ...feed.vote, user_selected_option: '10', user_change_vote_status: 1, user_vote_comment_status: 0 }; window.__communityMock.detailOverride = feed; window.__communityNavigate({ kind: 'detail', feed }); });
    const vote = page.getByRole('region', { name: '投票' }); await vote.getByRole('checkbox', { name: /选项甲/ }).waitFor();
    assert.equal(await vote.getByRole('button', { name: '修改投票', exact: true }).count(), 0);
    assert.equal(await vote.getByRole('checkbox', { name: /选项甲/ }).isDisabled(), true);
    await page.evaluate(() => { window.__communityMock.detailOverride = undefined; window.__communityNavigate({ kind: 'detail', feed: window.__communityMock.question }); });
    await page.getByRole('combobox', { name: '评论排序', exact: true }).waitFor();
  });
  await record('feed forwards/likers/change history and author/hidden reply filters are reachable', async () => {
    await page.getByRole('combobox', { name: '评论排序', exact: true }).selectOption('discussion'); await page.getByText('独立热门讨论内容', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.__communityMock.calls.some(call => call.operation === 'hotReplies' && call.args.id === '501')));
    await page.getByRole('button', { name: '赞过的人', exact: true }).click(); await page.getByText('赞过的酷友', { exact: true }).waitFor();
    await page.getByRole('button', { name: '转发记录', exact: true }).click(); await page.getByText('转发的想法', { exact: true }).waitFor();
    await page.getByRole('button', { name: '修改历史', exact: true }).click(); await page.getByText('修改历史正文', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '评论范围', exact: true }).selectOption('author');
    assert.equal(await page.getByRole('combobox', { name: '评论排序', exact: true }).inputValue(), 'lastupdate_desc');
    await page.waitForFunction(() => window.__communityMock.calls.some(call => call.operation === 'advancedReplies' && call.args.authorOnly));
    await page.getByRole('combobox', { name: '评论范围', exact: true }).selectOption('hidden');
    await page.waitForFunction(() => window.__communityMock.calls.some(call => call.operation === 'advancedReplies' && call.args.hidden));
  });
  await record('question invitations search users, cap selections at ten, and retain manual UID fallback', async () => {
    await page.getByRole('button', { name: '写回答', exact: true }).click(); const answer = page.getByRole('dialog', { name: '写回答', exact: true });
    await answer.getByRole('textbox', { name: '回答内容' }).fill('模拟回答正文'); await answer.getByRole('button', { name: '发布回答', exact: true }).click(); await answer.waitFor({ state: 'hidden' });
    await page.getByText('模拟回答正文', { exact: true }).waitFor();
    await page.getByRole('button', { name: '邀请回答', exact: true }).click(); const invite = page.getByRole('dialog', { name: '邀请回答', exact: true });
    await invite.getByRole('textbox', { name: '搜索酷友' }).fill('测试');
    const candidates = invite.getByRole('checkbox'); await candidates.first().waitFor(); await candidates.nth(10).waitFor();
    for (let index = 0; index < 10; index++) await candidates.nth(index).click();
    await candidates.nth(10).click(); await invite.getByText('最多邀请 10 位酷友', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'questionInvite').length), 0);
    await candidates.first().click(); await candidates.nth(10).click();
    await invite.getByRole('button', { name: '发送邀请', exact: true }).click(); await invite.waitFor({ state: 'hidden' });
    const searchedInvite = await page.evaluate(() => window.__communityMock.calls.find(call => call.operation === 'questionInvite')); assert.deepEqual(searchedInvite.args.uids, ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    assert.ok(await page.evaluate(() => window.__communityMock.calls.some(call => call.operation === 'userSearch' && call.args.query === '测试')));
    await page.getByRole('button', { name: '邀请回答', exact: true }).click(); const manualInvite = page.getByRole('dialog', { name: '邀请回答', exact: true });
    await manualInvite.getByRole('textbox', { name: '邀请酷友 UID' }).fill('77, 88'); await manualInvite.getByRole('button', { name: '发送邀请', exact: true }).click(); await manualInvite.waitFor({ state: 'hidden' });
    const requests = await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'questionInvite')); assert.deepEqual(requests[1].args.uids, ['77', '88']);
  });
  await page.evaluate(() => window.__communityNavigate({ kind: 'chat', ukey: '42_43' })); await page.getByText('最近联系酷友', { exact: true }).waitFor();
  await record('private-message live-photo pairing stays gated until the APK contract is confirmed', async () => {
    await page.getByRole('textbox', { name: '私信内容', exact: true }).waitFor();
    assert.equal(await page.getByLabel('添加图片附件').count(), 1);
    assert.equal(await page.getByLabel(/绑定图片 .* 的实况视频/).count(), 0);
    const before = await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'uploadImage').length);
    const failure = await page.evaluate(async () => {
      try {
        const image = new File(['synthetic'], 'photo.jpg', { type: 'image/jpeg' });
        const video = new File(['synthetic'], 'photo.mp4', { type: 'video/mp4' });
        await window.__communityUploadAttachments([{ file: image, preview: 'blob:synthetic', liveVideo: video }], () => {}, { dir: 'message', toUid: '43' });
        return '';
      } catch (error) { return error.message; }
    });
    assert.equal(failure, '私信实况视频协议尚未确认，请取消视频绑定后发送图片');
    const after = await page.evaluate(() => window.__communityMock.calls.filter(call => call.operation === 'uploadImage').length);
    assert.equal(after, before);
  });
  await record('recent contacts and chat read/delete have an explicit confirmation boundary', async () => {
    assert.ok(await page.evaluate(() => window.__communityMock.calls.some(call => call.operation === 'chatRead' && call.args.ukey === '42_43')));
    await page.getByRole('button', { name: '删除会话', exact: true }).click(); const confirm = page.getByRole('dialog', { name: '删除私信会话', exact: true });
    await confirm.getByRole('button', { name: '取消', exact: true }).click(); assert.ok(await page.evaluate(() => !window.__communityMock.calls.some(call => call.operation === 'chatDelete')));
    await page.getByRole('button', { name: '删除会话', exact: true }).click(); await confirm.getByRole('button', { name: '确认删除会话', exact: true }).click(); await confirm.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__communityDeleted), true);
    const request = await page.evaluate(() => window.__communityMock.calls.find(call => call.operation === 'chatDelete')); assert.deepEqual(request.args, { ukey: '42_43' });
  });
  assert.deepEqual(errors, []); await page.screenshot({ path: '.local/community-check/chat.png' });
  writeFileSync('research/community-checks.json', JSON.stringify({ mode: 'synthetic renderer contract checks', externalRequests: 'blocked', checks, errors }, null, 2));
} finally { await browser?.close(); await server.close(); }
