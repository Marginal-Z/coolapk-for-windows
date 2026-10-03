// Synthetic account UI verification: every account request is mocked in the isolated Electron process.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import electron from 'electron';
import playwright from 'playwright';
const root = resolve('.'), directory = join(root, '.local/account-ui-check'); mkdirSync(directory, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(join(directory, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  const page = await desktop.firstWindow();
  await desktop.evaluate(({ ipcMain }) => {
    const identity = { uid: '123456', username: '界面测试酷友', userAvatar: '' };
    const friend = { entityType: 'user', id: 1, uid: '654321', username: '界面测试好友', userAvatar: '', isSpecialFollow: 0 };
    globalThis.accountUiCalls = [];
    for (const channel of ['coolapk:accounts', 'coolapk:call', 'coolapk:account-page']) ipcMain.removeHandler(channel);
    ipcMain.handle('coolapk:accounts', () => ({ ok: true, data: { accounts: [identity], current: identity } }));
    ipcMain.handle('coolapk:account-page', (_, kind) => { globalThis.accountUiCalls.push({ operation: 'accountPage', args: { kind } }); return { ok: true, data: { opened: true } }; });
    ipcMain.handle('coolapk:call', async (_, operation, args = {}) => {
      globalThis.accountUiCalls.push({ operation, args });
      let data = [];
      if (operation === 'accountProfile') data = { ...identity, bio: '界面测试签名', gender: 1, birthyear: 2000, birthmonth: 2, birthday: 29, province: '广东', city: '深圳' };
      else if (operation === 'accountQr') { if (globalThis.holdAccountQr) await new Promise(resolve => { globalThis.releaseAccountQr = () => { globalThis.holdAccountQr = false; resolve(); }; }); data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII='; }
      else if (operation === 'accountFollowNodes') data = [{ id: 21, entityType: 'topic', tag: '界面测试圈子', title: '界面测试圈子', description: '关注的圈子' }];
      else if (operation === 'accountTabData') data = [{ id: 31, entityType: 'feed', title: '个人测试内容 ' + args.tab, description: '模拟个人内容，未访问真实账号' }];
      else if (operation === 'accountSpamFeeds') data = [{ id: 41, entityType: 'feed', title: '异常测试动态', reason: '模拟审核说明' }];
      else if (operation === 'accountUsers') data = [{ ...friend, remarkName: args.type === 'remarks' ? '测试备注' : '' }];
      else if (operation === 'accountPlugins') data = { status: 200, selectedAvatarPluginRow: { id: 7, plugin_type: 0, title: '测试头像挂件' }, selectedFeedPluginRow: { id: 8, plugin_type: 1, title: '测试动态挂件' }, avatarPluginList: [{ id: 7, plugin_type: 0, title: '测试头像挂件', can_use: 1 }, { id: 17, plugin_type: 0, title: '新头像挂件', can_use: 1 }], feedPluginList: [{ id: 8, plugin_type: 1, title: '测试动态挂件', can_use: 1 }, { id: 18, plugin_type: 1, title: '新动态挂件', can_use: 1 }], pluginList: args.store ? [{ id: 9, plugin_type: 0, title: '测试商店挂件', can_use: 1, getFuncStr: '测试获取条件', get_url: 'https://m.coolapk.com/mp/userPlugin/getPlugin?id=9' }] : [] };
      else if (operation === 'accountPluginSave' || operation === 'accountPluginClaim') data = { status: 200, message: 'mock success' };
      else if (operation === 'accountCardManager') data = [{ id: 1, title: '最近访问', page_visibility: 1 }, { id: 2, title: '我的收藏', page_visibility: 0 }];
      else if (operation === 'accountCards') data = [{ id: 1, entityType: 'card', title: '最近访问', entities: [{ id: 3, title: '测试浏览记录', url: '/feed/123' }] }];
      else if (operation === 'accountChannels') data = [{ id: 420, title: '头条', page_visibility: 1 }, { id: 415, title: '热榜', page_visibility: 0 }];
      else if (operation === 'accountHistory') data = [{ id: 1, entityType: 'history', title: '云端测试动态', url: '/feed/123', dateline: Math.floor(Date.now() / 1000) }];
      else if (['accountProfileUpdate', 'accountRelationship', 'accountCardSave', 'accountChannelSave'].includes(operation)) data = 1;
      return { ok: true, data: { data, hasMore: false } };
    });
  });
  page.on('pageerror', error => errors.push(error.message)); await page.reload();
  await page.locator('.sidebar').getByRole('button', { name: '账号中心', exact: true }).click();
  await record('profile fields load and signature saves with the expected action', async () => {
    await page.getByLabel('个性签名', { exact: true }).fill('新的测试签名');
    await page.getByRole('button', { name: '保存签名', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.ac-status'));
    await page.getByRole('button', { name: '修改昵称', exact: true }).click();
    const calls = await desktop.evaluate(() => globalThis.accountUiCalls);
    assert.ok(calls.some(row => row.operation === 'accountProfileUpdate' && row.args.field === 'bio' && row.args.value === '新的测试签名'));
    assert.ok(calls.some(row => row.operation === 'accountPage' && row.args.kind === 'username'));
    await page.screenshot({ path: join(directory, 'profile.png') });
  });
  await record('relationship controls can set special follow and remove a fan', async () => {
    await page.getByRole('button', { name: '好友与屏蔽', exact: true }).click();
    await page.getByRole('button', { name: '特别关注', exact: true }).click();
    await page.getByRole('tab', { name: '粉丝', exact: true }).click();
    await page.getByRole('button', { name: '移除粉丝', exact: true }).click();
    await page.getByRole('tab', { name: '黑名单', exact: true }).click();
    await page.getByRole('button', { name: '移出黑名单', exact: true }).waitFor();
    await page.screenshot({ path: join(directory, 'relations.png') });
  });
  await record('private account QR renders a dataURL in its dialog and restores focus on close', async () => {
    await page.getByRole('button', { name: '个人资料', exact: true }).click();
    await page.getByRole('button', { name: '我的二维码', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '我的酷安二维码', exact: true });
    await dialog.getByAltText('我的酷安主页二维码').waitFor();
    await page.waitForFunction(() => document.querySelector('.ac-qr img')?.naturalWidth === 1);
    assert.ok((await dialog.getByAltText('我的酷安主页二维码').getAttribute('src')).startsWith('data:image/png;base64,'));
    await page.screenshot({ path: join(directory, 'qr.png') });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '我的二维码', exact: true }).evaluate(node => node === document.activeElement), true);
  });
  await record('followed circles and all personal content categories use their documented UI operations', async () => {
    await page.getByRole('button', { name: '关注圈子', exact: true }).click();
    await page.getByRole('button', { name: /界面测试圈子/ }).waitFor();
    await page.getByRole('button', { name: '我的内容', exact: true }).click();
    for (const title of ['动态', '图文', '问答', '酷图', '评分', '回复', '赞过', '收藏单', '应用集', '关注应用', '开发的应用', '发现', '好物', '商品店', '好物榜单', '二手']) {
      await page.getByRole('tab', { name: title, exact: true }).click();
      await page.getByRole('button', { name: /个人测试内容/ }).waitFor();
    }
    await page.getByRole('tab', { name: '评分', exact: true }).click();
    await page.getByLabel('评分对象', { exact: true }).selectOption('product');
    await page.getByRole('button', { name: /个人测试内容 rating/ }).waitFor();
    const calls = await desktop.evaluate(() => globalThis.accountUiCalls);
    assert.ok(calls.some(row => row.operation === 'accountFollowNodes'));
    for (const tab of ['feed', 'article', 'qa', 'coolpic', 'rating', 'reply', 'like', 'collection', 'album', 'apk_follow', 'developer_apps', 'discovery', 'goods', 'goods_store', 'goods_rank', 'ershou']) assert.ok(calls.some(row => row.operation === 'accountTabData' && row.args.tab === tab), tab);
    assert.ok(calls.some(row => row.operation === 'accountTabData' && row.args.tab === 'rating' && row.args.ratingTarget === 'product'));
    await page.screenshot({ path: join(directory, 'content.png') });
  });
  await record('abnormal feed and recycle screens keep status read-only and preserve server reasons', async () => {
    await page.getByRole('button', { name: '异常动态与回收站', exact: true }).click();
    await page.getByText('模拟审核说明', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /申诉|恢复动态|解除限制/ }).count(), 0);
    await page.getByRole('tab', { name: '回收站', exact: true }).click();
    await page.getByRole('button', { name: /个人测试内容 recycle/ }).waitFor();
    const calls = await desktop.evaluate(() => globalThis.accountUiCalls);
    assert.ok(calls.some(row => row.operation === 'accountSpamFeeds'));
    assert.ok(calls.some(row => row.operation === 'accountTabData' && row.args.tab === 'recycle'));
    await page.screenshot({ path: join(directory, 'recycle.png') });
  });
  await record('plugin save retains both current ids and unsaved choices across category changes', async () => {
    await page.getByRole('button', { name: '头像与动态挂件', exact: true }).click();
    await page.getByRole('button', { name: '保存挂件', exact: true }).click();
    await page.getByRole('button', { name: '新头像挂件', exact: true }).click();
    await page.getByRole('tab', { name: '动态挂件', exact: true }).click();
    await page.getByRole('button', { name: '新动态挂件', exact: true }).click();
    await page.getByRole('tab', { name: '头像挂件', exact: true }).click();
    await page.getByRole('button', { name: '新头像挂件', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '新头像挂件', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '保存挂件', exact: true }).click();
    await page.getByRole('tab', { name: '挂件商店', exact: true }).click();
    await page.getByRole('button', { name: '获取', exact: true }).waitFor();
    const calls = await desktop.evaluate(() => globalThis.accountUiCalls);
    assert.ok(calls.some(row => row.operation === 'accountPluginSave' && row.args.avatarId === '7' && row.args.feedId === '8'));
    assert.ok(calls.some(row => row.operation === 'accountPluginSave' && row.args.avatarId === '17' && row.args.feedId === '18'));
    await page.screenshot({ path: join(directory, 'plugins.png') });
  });
  await record('cards and channels have accessible ordering / visibility controls', async () => {
    await page.getByRole('button', { name: '主页卡片', exact: true }).click();
    await page.getByRole('button', { name: '下移 最近访问', exact: true }).click();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByRole('button', { name: '首页频道', exact: true }).click();
    await page.getByRole('button', { name: '上移 热榜', exact: true }).click();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.screenshot({ path: join(directory, 'channels.png') });
  });
  await record('cloud history and narrow window layout render correctly', async () => {
    await page.getByRole('button', { name: '云端浏览历史', exact: true }).click();
    await page.getByRole('button', { name: /云端测试动态/ }).waitFor();
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 760));
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(width.scroll <= width.width);
    await page.screenshot({ path: join(directory, 'history-960.png') });
  });
  await record('account switching closes a pending private QR dialog and discards its delayed response', async () => {
    await page.getByRole('button', { name: '个人资料', exact: true }).click();
    await desktop.evaluate(() => { globalThis.holdAccountQr = true; });
    await page.getByRole('button', { name: '我的二维码', exact: true }).click();
    assert.equal(await desktop.evaluate(async () => { for (let i = 0; i < 100; i++) { if (globalThis.releaseAccountQr) return true; await new Promise(resolve => setTimeout(resolve, 20)); } return false; }), true);
    await desktop.evaluate(({ BrowserWindow }) => { const identity = { uid: '654321', username: '新模拟账号' }; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [identity], current: identity } }); });
    await page.locator('.page-heading').getByRole('heading', { name: '首页', exact: true }).waitFor();
    await desktop.evaluate(() => globalThis.releaseAccountQr());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('dialog', { name: '我的酷安二维码' }).count(), 0);
    assert.equal(await page.getByAltText('我的酷安主页二维码').count(), 0);
  });
  assert.deepEqual(errors, []);
  const calls = await desktop.evaluate(() => globalThis.accountUiCalls);
  assert.ok(calls.some(row => row.operation === 'accountRelationship' && row.args.action === 'special'));
  assert.ok(calls.some(row => row.operation === 'accountRelationship' && row.args.action === 'cancelFan'));
  writeFileSync('research/account-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), syntheticAccount: true, liveAccountWrites: false, checks, errors }, null, 2));
} finally { await desktop.close(); }
