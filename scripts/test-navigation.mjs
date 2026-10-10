// Native navigation / refresh contracts with isolated userdata and synthetic IPC responses.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.local', 'navigation-ui-check');
mkdirSync(directory, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(path.join(directory, 'userdata-')) };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
const checks = [], errors = [], refreshCounts = {};
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
const requestCount = operation => desktop.evaluate((_, operation) => globalThis.navigationMock.calls.filter(value => value === operation).length, operation);
async function waitForRequest(operation, before, expectedArgs) {
  const result = await desktop.evaluate(async (_, { operation, before, expectedArgs }) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const requests = globalThis.navigationMock.requests.filter(value => value.operation === operation);
      const request = requests.slice(before).find(candidate => !expectedArgs || Object.keys(candidate.args).length === Object.keys(expectedArgs).length && Object.entries(expectedArgs).every(([key, expectedValue]) => expectedValue === candidate.args[key]));
      if (request) return { count: requests.length, request };
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return null;
  }, { operation, before, expectedArgs });
  assert.ok(result && result.count > before, `${operation} must submit a new request${expectedArgs ? ' with the exact named arguments' : ''}`);
  if (expectedArgs) assert.deepEqual(result.request.args, expectedArgs);
  return result.count;
}
const prepareAppRead = marker => desktop.evaluate((_, marker) => { globalThis.navigationMock.appMarker = marker; return globalThis.navigationMock.calls.filter(value => value === 'appDiscovery').length; }, marker);
async function updateMetadata(username) {
  await desktop.evaluate(({ BrowserWindow }, username) => {
    globalThis.navigationMock.identity = { ...globalThis.navigationMock.identity, username };
    const identity = globalThis.navigationMock.identity;
    BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, metadataOnly: true, data: { accounts: [identity], current: identity } });
  }, username);
}
try {
  const page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await desktop.evaluate(({ ipcMain }) => {
    globalThis.navigationMock = { identity: { uid: '123456', username: '导航测试账号', userAvatar: '' }, profile: { bio: '测试资料', gender: 1, birthyear: 2000, birthmonth: 2, birthday: 29, province: '广东', city: '深圳' }, calls: [], requests: [], failApplication: false, appMarker: '应用首次响应', profilePending: [], verifyPending: [] };
    for (const channel of ['coolapk:accounts', 'coolapk:call', 'coolapk:account-page', 'coolapk:verify']) ipcMain.removeHandler(channel);
    ipcMain.handle('coolapk:accounts', () => ({ ok: true, data: { accounts: [globalThis.navigationMock.identity], current: globalThis.navigationMock.identity } }));
    ipcMain.handle('coolapk:account-page', () => ({ ok: true, data: { opened: true } }));
    ipcMain.handle('coolapk:verify', async (_, verificationId) => { const mock = globalThis.navigationMock; mock.calls.push('verify'); mock.requests.push({ operation: 'verify', args: { verificationId } }); if (mock.holdVerification) await new Promise(resolve => mock.verifyPending.push(resolve)); return { ok: true, data: {} }; });
    ipcMain.handle('coolapk:call', async (_, operation, args = {}) => {
      const mock = globalThis.navigationMock; mock.calls.push(operation); mock.requests.push({ operation, args });
      if (operation === 'accountProfile') {
        const profile = { ...mock.identity, ...mock.profile }; if (mock.holdProfile) await new Promise(resolve => mock.profilePending.push(resolve));
        return { ok: true, data: { data: profile, hasMore: false } };
      }
      if (operation === 'accountProfileUpdate') {
        if (mock.profileUpdateChallenge) { mock.profileUpdateChallenge = false; return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟资料保存验证', verificationId: 'synthetic-profile-save' } }; }
        if (args.field === 'bio') mock.profile.bio = '服务端规范签名';
        if (args.field === 'gender') mock.profile.gender = Number(args.value);
        return { ok: true, data: { data: 1 } };
      }
      if (operation === 'appDiscovery' && mock.failApplication) return { ok: false, error: { message: '模拟刷新失败', code: 'NETWORK' } };
      const data = operation === 'home' ? [{ entityType: 'feed', id: '700', uid: mock.identity.uid, username: mock.identity.username, message: '包含清单的动态', goodsListInfo: { id: '7000', title: '导航清单' } }]
        : operation === 'goodsListFeed' ? { entityType: 'feed', id: '700', uid: mock.identity.uid, message: '清单说明', goodsListInfo: { id: '7000', title: '导航清单' }, goodsListItem: [] }
        : operation === 'search' ? [{ entityType: 'goods', id: 'goods_synthetic', title: '搜索商品入口' }, { entityType: 'productAlbum', id: '800', uid: mock.identity.uid, title: '搜索产品专辑入口' }, { entityType: 'user', uid: '771', username: '模拟酷友入口', title: '模拟酷友入口' }]
        : operation === 'goodsDetail' ? { id: 'goods_synthetic', goods_title: '搜索商品入口' }
        : operation === 'goodsAlbum' ? { id: '800', title: '搜索产品专辑入口', productItems: [] }
        : operation === 'user' ? { uid: args.uid, username: '模拟酷友主页' }
        : operation === 'userProfile' ? { uid: args.uid, username: '资料测试酷友', city: '模拟城市' }
        : operation === 'userSpace' ? { uid: args.uid, albumNum: 1 }
        : operation === 'userQr' ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT5kAAAAASUVORK5CYII='
        : operation === 'userHomepage' ? [{ entityType: 'collection', id: '51', title: '原生酷友主页卡片' }]
        : operation === 'userFollowNodes' ? [{ entityType: 'topic', id: '41', tag: '原生关注圈子', title: '原生关注圈子' }]
        : operation === 'userTabData' ? [{ entityType: 'feed', id: '71', uid: args.uid, username: '资料测试酷友', message: '原生公开内容-' + args.tab }]
        : operation === 'userAppRatings' ? [{ entityType: 'apk', id: '77', packageName: 'com.example.rating', title: '模拟评分应用', appName: '模拟评分应用', rating: 5 }]
        : operation === 'notificationCount' ? {}
        : operation === 'accountPlugins' ? { avatarPluginList: [], feedPluginList: [] }
        : operation === 'appDiscovery' ? [{ entityType: 'apk', id: '1', packageName: 'com.example.navigation.mock', title: '模拟推荐应用', appName: '模拟推荐应用', description: mock.appMarker }]
        : [];
      return { ok: true, data: { data, hasMore: false } };
    });
  });
  await page.reload();
  const navigation = ['首页', '热榜', '话题广场', '数码', '应用与游戏', '二手', '发现更多', '好物与清单', '应用下载', '我的关注', '我的收藏', '通知', '私信', '浏览历史', '订阅话题', '账号中心'];
  await record('all 16 sidebar destinations render their corresponding page', async () => {
    for (const name of navigation) {
      const group = ['我的关注', '我的收藏', '通知', '私信', '浏览历史', '订阅话题', '账号中心'].includes(name) ? '个人导航' : '社区导航';
      await page.locator(`.sidebar [aria-label="${group}"]`).getByRole('button', { name, exact: true }).click();
      await page.locator('.page-heading').getByRole('heading', { name, exact: true }).waitFor();
    }
    await page.waitForFunction(() => document.querySelector('#ac-bio')?.value === '测试资料');
  });
  await record('global toolbar refresh refetches the account center', async () => {
    const before = await requestCount('accountProfile');
    await desktop.evaluate(() => { globalThis.navigationMock.holdProfile = true; globalThis.navigationMock.profile.gender = 0; });
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    const after = await waitForRequest('accountProfile', before);
    assert.equal(await desktop.evaluate(() => globalThis.navigationMock.profilePending.length), 1);
    refreshCounts.accountProfile = { before, after };
  });
  await record('same-account metadata updates preserve the current page and unsaved profile draft', async () => {
    await page.getByLabel('个性签名', { exact: true }).fill('尚未保存的签名草稿');
    await updateMetadata('新的测试昵称');
    await page.locator('.account-entry').getByText('新的测试昵称', { exact: true }).waitFor();
    assert.equal(await page.locator('.page-heading h1').innerText(), '账号中心');
    assert.equal(await page.getByLabel('个性签名', { exact: true }).inputValue(), '尚未保存的签名草稿');
  });
  await record('a delayed profile refresh preserves an edited draft while untouched fields hydrate', async () => {
    await desktop.evaluate(() => { const mock = globalThis.navigationMock; mock.holdProfile = false; mock.profilePending.splice(0).forEach(resolve => resolve()); });
    await page.waitForFunction(() => document.querySelector('#ac-gender')?.value === '0');
    assert.equal(await page.getByLabel('个性签名', { exact: true }).inputValue(), '尚未保存的签名草稿');
  });
  await record('saving another profile field preserves unsaved drafts and a successful own save reads server normalization', async () => {
    await page.getByLabel('个性签名', { exact: true }).fill('另一份未保存签名'); await page.getByLabel('性别', { exact: true }).selectOption('1');
    await desktop.evaluate(() => { globalThis.navigationMock.profile.city = '珠海'; });
    let before = await requestCount('accountProfileUpdate'); await page.locator('form').filter({ has: page.getByLabel('性别', { exact: true }) }).getByRole('button', { name: '保存', exact: true }).click();
    await waitForRequest('accountProfileUpdate', before, { field: 'gender', value: '1' }); await page.waitForFunction(() => document.querySelector('[aria-label="城市"]')?.value === '珠海');
    assert.equal(await page.getByLabel('个性签名', { exact: true }).inputValue(), '另一份未保存签名');
    await page.getByLabel('个性签名', { exact: true }).fill('待保存签名'); before = await requestCount('accountProfileUpdate'); await page.getByRole('button', { name: '保存签名', exact: true }).click();
    await waitForRequest('accountProfileUpdate', before, { field: 'bio', value: '待保存签名' }); await page.waitForFunction(() => document.querySelector('#ac-bio')?.value === '服务端规范签名');
  });
  await record('verification replays the original profile save while preserving edits made during verification', async () => {
    await page.getByLabel('个性签名', { exact: true }).fill('验证时提交的签名');
    const before = await requestCount('accountProfileUpdate'), verifyBefore = await requestCount('verify'); await desktop.evaluate(() => { const mock = globalThis.navigationMock; mock.profileUpdateChallenge = true; mock.holdVerification = true; mock.profile.gender = 0; });
    await page.getByRole('button', { name: '保存签名', exact: true }).click(); await page.getByText('模拟资料保存验证', { exact: true }).waitFor(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await waitForRequest('verify', verifyBefore, { verificationId: 'synthetic-profile-save' }); await page.getByLabel('个性签名', { exact: true }).fill('验证期间更新后的草稿');
    await desktop.evaluate(() => { const mock = globalThis.navigationMock; mock.holdVerification = false; mock.verifyPending.splice(0).forEach(resolve => resolve()); });
    await waitForRequest('accountProfileUpdate', before + 1, { field: 'bio', value: '验证时提交的签名' }); await page.waitForFunction(() => document.querySelector('#ac-gender')?.value === '0');
    assert.equal(await page.getByLabel('个性签名', { exact: true }).inputValue(), '验证期间更新后的草稿');
    const submitted = await desktop.evaluate((_, before) => globalThis.navigationMock.requests.filter(row => row.operation === 'accountProfileUpdate').slice(before), before);
    assert.deepEqual(submitted.map(row => row.args), [{ field: 'bio', value: '验证时提交的签名' }, { field: 'bio', value: '验证时提交的签名' }]);
  });
  await record('same-account metadata updates keep an open settings dialog', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    await updateMetadata('再次更新的测试昵称');
    await page.locator('.account-entry').getByText('再次更新的测试昵称', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 1);
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  });
  const appReentryBefore = await prepareAppRead('应用重入响应');
  await page.locator('.sidebar [aria-label="社区导航"]').getByRole('button', { name: '应用与游戏', exact: true }).click();
  await waitForRequest('appDiscovery', appReentryBefore, { category: 'recommend', page: 1 });
  await page.locator('.main-scroll').getByText('应用重入响应', { exact: true }).waitFor();
  await page.locator('.main-scroll').getByText('模拟推荐应用', { exact: true }).waitFor();
  await record('global toolbar refresh refetches catalog data without replacing the page', async () => {
    const before = await prepareAppRead('工具栏刷新响应');
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    const after = await waitForRequest('appDiscovery', before, { category: 'recommend', page: 1 });
    await page.locator('.main-scroll').getByText('工具栏刷新响应', { exact: true }).waitFor();
    assert.equal(await page.locator('.page-heading h1').innerText(), '应用与游戏');
    refreshCounts.catalogToolbar = { before, after };
  });
  await record('native refresh menu command reaches resources in catalog pages', async () => {
    const before = await prepareAppRead('菜单刷新响应');
    await desktop.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === '刷新');
      if (!item || item.accelerator !== 'CmdOrCtrl+R') throw new Error('Native refresh accelerator is missing');
      item.click();
    });
    const after = await waitForRequest('appDiscovery', before, { category: 'recommend', page: 1 });
    await page.locator('.main-scroll').getByText('菜单刷新响应', { exact: true }).waitFor();
    assert.equal(await page.locator('.page-heading h1').innerText(), '应用与游戏');
    refreshCounts.catalogMenu = { before, after };
  });
  await record('a failed refresh keeps previously loaded catalog items visible', async () => {
    await desktop.evaluate(() => { globalThis.navigationMock.failApplication = true; });
    const before = await requestCount('appDiscovery');
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await waitForRequest('appDiscovery', before, { category: 'recommend', page: 1 });
    await page.getByText('模拟刷新失败', { exact: true }).waitFor();
    assert.equal(await page.locator('.main-scroll').getByText('模拟推荐应用', { exact: true }).count(), 1);
    await desktop.evaluate(() => { globalThis.navigationMock.failApplication = false; });
    const recoveryBefore = await prepareAppRead('刷新恢复响应');
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await waitForRequest('appDiscovery', recoveryBefore, { category: 'recommend', page: 1 });
    await page.locator('.main-scroll').getByText('刷新恢复响应', { exact: true }).waitFor();
    await page.getByText('模拟刷新失败', { exact: true }).waitFor({ state: 'hidden' });
  });
  await record('an actual account change still returns to the home page', async () => {
    await desktop.evaluate(({ BrowserWindow }) => {
      const identity = { uid: '654321', username: '切换后的测试账号', userAvatar: '' };
      globalThis.navigationMock.identity = identity;
      BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [identity], current: identity } });
    });
    await page.locator('.page-heading').getByRole('heading', { name: '首页', exact: true }).waitFor();
    await page.locator('.account-entry').getByText('切换后的测试账号', { exact: true }).waitFor();
  });
  await record('a feed opens its own full goods list through the native navigation', async () => {
    const before = await requestCount('goodsListFeed');
    await page.getByRole('button', { name: '查看完整好物清单', exact: true }).click();
    await waitForRequest('goodsListFeed', before);
    await page.locator('.page-heading h1').getByText('导航清单', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '评论', exact: true }).click();
    await page.getByRole('button', { name: '查看并参与完整评论', exact: true }).waitFor();
  });
  await record('global search goods and product albums open native detail pages', async () => {
    const input = page.getByLabel('搜索酷安', { exact: true });
    await input.fill('测试商品'); await input.press('Enter');
    let before = await requestCount('goodsDetail');
    await page.locator('.entity-card').filter({ hasText: '搜索商品入口' }).click();
    await waitForRequest('goodsDetail', before);
    await page.locator('.page-heading h1').getByText('搜索商品入口', { exact: true }).waitFor();
    await input.fill('测试专辑'); await input.press('Enter');
    before = await requestCount('goodsAlbum');
    await page.locator('.entity-card').filter({ hasText: '搜索产品专辑入口' }).click();
    await waitForRequest('goodsAlbum', before);
    await page.locator('.page-heading h1').getByText('搜索产品专辑入口', { exact: true }).waitFor();
  });
  await record('user profile and application ratings are reachable through actual native navigation', async () => {
    const input = page.getByLabel('搜索酷安', { exact: true }); await input.fill('测试酷友'); await input.press('Enter');
    await page.locator('.entity-card').filter({ hasText: '模拟酷友入口' }).click();
    await page.getByRole('tab', { name: '资料', exact: true }).click(); await page.getByText('资料测试酷友', { exact: true }).waitFor();
    let request = await desktop.evaluate(() => globalThis.navigationMock.requests.filter(item => item.operation === 'userProfile').at(-1)); assert.deepEqual(request.args, { uid: '771' });
    await page.getByRole('tab', { name: '应用评分', exact: true }).click(); await page.getByText('模拟评分应用', { exact: true }).waitFor();
    request = await desktop.evaluate(() => globalThis.navigationMock.requests.filter(item => item.operation === 'userAppRatings').at(-1)); assert.deepEqual(request.args, { uid: '771' });
  });
  await record('other-user QR and followed circles keep the exact target through actual native navigation', async () => {
    await page.getByRole('tab', {name:'资料',exact:true}).click(); await page.getByRole('button',{name:'用户二维码',exact:true}).click();
    const modal = page.getByRole('dialog',{name:'用户二维码',exact:true}); await modal.getByAltText('用户主页二维码').waitFor();
    await page.waitForFunction(()=>{const image=document.querySelector('.user-discovery-qr img');return image?.complete&&image?.naturalWidth>0;});
    assert.deepEqual(await desktop.evaluate(()=>globalThis.navigationMock.requests.filter(item=>item.operation==='userQr').at(-1).args),{uid:'771'});
    await modal.getByRole('button',{name:'关闭',exact:true}).click(); await page.getByRole('tab',{name:'关注圈子',exact:true}).click(); await page.locator('.user-discovery').getByText('原生关注圈子',{exact:true}).waitFor();
    assert.deepEqual(await desktop.evaluate(()=>globalThis.navigationMock.requests.filter(item=>item.operation==='userFollowNodes').at(-1).args),{uid:'771'});
    assert.equal(await page.getByRole('tab',{name:'赞过',exact:true}).count(),0);
  });
  await record('other-user home and public content tabs mount dedicated components without duplicate generic reads', async () => {
    await page.getByRole('tab',{name:'主页',exact:true}).click(); await page.getByText('原生酷友主页卡片',{exact:true}).waitFor();
    assert.deepEqual(await desktop.evaluate(()=>globalThis.navigationMock.requests.filter(item=>item.operation==='userHomepage').at(-1).args),{uid:'771'});
    await page.getByRole('tab',{name:'公开内容',exact:true}).click(); await page.getByText('原生公开内容-feed',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'图文',exact:true}).click(); await page.getByText('原生公开内容-article',{exact:true}).waitFor();
    assert.deepEqual(await desktop.evaluate(()=>globalThis.navigationMock.requests.filter(item=>item.operation==='userTabData').at(-1).args),{uid:'771',tab:'article'});
    assert.equal(await page.getByRole('tab',{name:'回收站',exact:true}).count(),0); assert.equal(await page.getByRole('tab',{name:'我的回复',exact:true}).count(),0);
  });
  await record('favorites and view-index rank tabs request their own named rankings', async () => {
    await page.locator('.sidebar [aria-label="社区导航"]').getByRole('button', { name: '热榜', exact: true }).click();
    for (const [name, type] of [['收藏榜', 'favorite'], ['指数榜', 'index']]) {
      const before = await requestCount('rank'); await page.getByRole('tab', { name, exact: true }).click(); await waitForRequest('rank', before, { type });
      const request = await desktop.evaluate((_, { before, type }) => globalThis.navigationMock.requests.filter(item => item.operation === 'rank').slice(before).find(item => item.args.type === type), { before, type }); assert.equal(request.args.type, type); assert.deepEqual(request.args, { type });
    }
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, 'main-navigation.png') });
  writeFileSync(path.join(root, 'research', 'navigation-ui-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), syntheticAccount: true, liveAccountWrites: false, navigationPages: navigation.length, checks, refreshCounts, errors }, null, 2));
} finally { await desktop.close(); }
