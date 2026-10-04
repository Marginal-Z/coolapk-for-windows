// Real App/Electron search UI with synthetic IPC; no authenticated API request is used.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import electron from 'electron';
import playwright from 'playwright';
const root = resolve('.'), directory = join(root, '.local/search-ui-check'); mkdirSync(directory, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(join(directory, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
const checks = [], errors = [];
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
async function held() { assert.equal(await desktop.evaluate(async () => { for (let i = 0; i < 100; i++) { if (globalThis.searchUiMock.release) return true; await new Promise(resolve => setTimeout(resolve, 20)); } return false; }), true); }
const callCount = () => desktop.evaluate(() => globalThis.searchUiMock.calls.length);
async function waitForCall(operation, args, { before = 0, uid, complete = false } = {}) {
  const request = await desktop.evaluate(async (_, { operation, args, before, uid, complete }) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = globalThis.searchUiMock.calls.slice(before).find(row => row.operation === operation && (!uid || row.uid === uid) && (!complete || row.complete) && Object.keys(row.args).length === Object.keys(args).length && Object.entries(args).every(([key, value]) => row.args[key] === value));
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return null;
  }, { operation, args, before, uid, complete });
  assert.ok(request, `${operation} must ${complete ? 'complete' : 'submit'} the exact requested arguments in its account scope`);
  assert.deepEqual(request.args, args); if (uid) assert.equal(request.uid, uid);
  return request;
}
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await desktop.evaluate(({ ipcMain }) => {
    const mock = globalThis.searchUiMock = { identity: { uid: '123456', username: '搜索测试账号' }, calls: [], holdQuery: '', holdUid: '', release: null, fail: false, external: [] };
    for (const channel of ['coolapk:accounts', 'coolapk:call', 'coolapk:external']) ipcMain.removeHandler(channel);
    ipcMain.handle('coolapk:accounts', () => ({ ok: true, data: { accounts: [mock.identity], current: mock.identity } }));
    ipcMain.handle('coolapk:external', (_, url) => { mock.external.push(url); return { ok: true, data: {} }; });
    ipcMain.handle('coolapk:call', async (_, operation, args = {}) => {
      const uid = mock.identity.uid, request = { operation, args, uid, complete: false }; mock.calls.push(request); let data = [], surfaceItems;
      try {
        if (operation === 'searchSuggestions' || operation === 'searchSuggestionsApp') {
          if (mock.holdQuery === args.query && (!mock.holdUid || mock.holdUid === uid)) await new Promise(resolve => { mock.release = () => { mock.release = null; mock.holdQuery = ''; mock.holdUid = ''; resolve(); }; });
          if (mock.fail) return { ok: false, error: { code: 'NETWORK', message: '模拟建议网络错误' } };
          if (args.query === '键盘') data = [{ title: '搜索用户 键盘', url: 'searchTab://user?keyword=%E5%AE%9E%E9%99%85%E9%85%B7%E5%8F%8B' }, { title: '搜索话题 键盘', url: 'searchTab://topic?keyword=%E9%94%AE%E7%9B%98' }];
          else if (args.query.startsWith('入口类别建议')) data = [{ title: '搜索用户 ' + args.query, url: 'searchTab://user?keyword=' + encodeURIComponent(args.query + '酷友') }];
          else if (args.query === '应用实体') data = [{ id: 7, title: '测试建议应用', entityType: 'apk', packageName: 'com.example.searchmock' }];
          else if (args.query === '切号同词建议') data = [{ title: `${uid === '123456' ? '旧账号' : '新账号'} 同词建议`, url: 'searchTab://feed?keyword=' + encodeURIComponent(args.query) }];
          else data = [{ title: '<b>建议 ' + args.query + '</b>', url: 'searchTab://feed?keyword=' + encodeURIComponent(args.query) }];
        } else if (operation === 'accountProfile') data = { ...mock.identity, bio: '合成测试资料' };
        else if (operation === 'home') {
          data = [{ entityType: 'page', id: '7101', title: '应用搜索入口', url: '/apk/search' }, { entityType: 'page', id: '7102', title: '游戏搜索入口', url: '/game/search' }];
          surfaceItems = [{ entityType: 'card', entityTemplate: 'iconLinkGridCard', title: '搜索入口', entities: data }];
        }
        return { ok: true, data: { data, hasMore: false, ...(surfaceItems ? { surfaceItems } : {}) } };
      } finally { request.complete = true; }
    });
  });
  await page.reload(); const input = page.getByRole('combobox', { name: '搜索酷安' });
  await record('actual App searchbar uses Arrow keys / Enter and searchTab keyword with its category', async () => {
    await input.fill('键盘'); await page.getByRole('option', { name: '搜索用户 键盘', exact: true }).waitFor();
    assert.equal(await input.getAttribute('aria-expanded'), 'true');
    await input.press('ArrowDown'); assert.ok(await input.getAttribute('aria-activedescendant'));
    const before = await callCount(); await input.press('Enter'); await page.getByRole('heading', { name: '搜索“实际酷友”', exact: true }).waitFor();
    await waitForCall('search', { query: '实际酷友', type: 'user' }, { before, uid: '123456' });
    const calls = await desktop.evaluate(() => globalThis.searchUiMock.calls);
    assert.ok(calls.some(row => row.operation === 'search' && row.args.query === '实际酷友' && row.args.type === 'user'));
    assert.equal(await input.inputValue(), '实际酷友'); assert.equal(await input.getAttribute('aria-expanded'), 'false');
  });
  await record('Escape dismisses suggestions and ordinary Enter still searches the typed phrase', async () => {
    await input.fill('取消建议'); await page.getByRole('option', { name: '建议 取消建议', exact: true }).waitFor();
    await input.press('Escape'); assert.equal(await input.getAttribute('aria-expanded'), 'false'); assert.equal(await page.getByRole('listbox').count(), 0);
    const before = await callCount(); await input.press('Enter'); await page.getByRole('heading', { name: '搜索“取消建议”', exact: true }).waitFor();
    await waitForCall('search', { query: '取消建议', type: 'all' }, { before, uid: '123456' });
  });
  await record('blur and focus reopen the same query while HTML labels remain plain text', async () => {
    await input.fill('重新展开'); await page.getByRole('option', { name: '建议 重新展开', exact: true }).waitFor();
    await page.getByRole('button', { name: '刷新当前页', exact: true }).focus();
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    await input.focus(); await page.getByRole('option', { name: '建议 重新展开', exact: true }).waitFor();
    assert.equal(await page.locator('.search-suggestions b').count(), 0);
    assert.equal(await input.evaluate(node => node === document.activeElement), true);
  });
  await record('late old-query suggestions cannot replace the current phrase', async () => {
    await desktop.evaluate(() => { globalThis.searchUiMock.holdQuery = '旧关键词'; });
    await input.fill('旧关键词'); await held();
    await input.fill('新关键词'); await page.getByRole('option', { name: '建议 新关键词', exact: true }).waitFor();
    await desktop.evaluate(() => globalThis.searchUiMock.release());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => !document.querySelector('.search-suggestions')?.textContent.includes('旧关键词'));
    assert.equal(await page.getByRole('option', { name: '建议 新关键词', exact: true }).count(), 1);
  });
  await record('account namespace changes discard a held suggestion response', async () => {
    const query = '切号同词建议', before = await callCount();
    await desktop.evaluate(() => { globalThis.searchUiMock.holdQuery = '切号同词建议'; globalThis.searchUiMock.holdUid = '123456'; });
    await input.fill(query); await held(); await waitForCall('searchSuggestions', { query }, { before, uid: '123456' });
    await desktop.evaluate(({ BrowserWindow }) => { globalThis.searchUiMock.identity = { uid: '654321', username: '新的搜索账号' }; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [globalThis.searchUiMock.identity], current: globalThis.searchUiMock.identity } }); });
    await page.locator('.account-entry').getByText('新的搜索账号', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), query);
    await waitForCall('searchSuggestions', { query }, { before, uid: '654321', complete: true });
    await page.getByRole('option', { name: '新账号 同词建议', exact: true }).waitFor();
    assert.equal(await page.getByRole('option', { name: '旧账号 同词建议', exact: true }).count(), 0);
    await desktop.evaluate(() => globalThis.searchUiMock.release());
    await waitForCall('searchSuggestions', { query }, { before, uid: '123456', complete: true });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await input.inputValue(), query); assert.equal(await page.getByRole('option', { name: '新账号 同词建议', exact: true }).count(), 1);
    assert.equal(await page.getByRole('option', { name: '旧账号 同词建议', exact: true }).count(), 0);
  });
  await record('suggestion failure retains an accessible error and ordinary search works', async () => {
    await desktop.evaluate(() => { globalThis.searchUiMock.fail = true; });
    await input.fill('网络失败'); await page.getByText('搜索建议暂不可用，仍可直接搜索。', { exact: true }).waitFor();
    const before = await callCount(); await input.press('Enter'); await page.getByRole('heading', { name: '搜索“网络失败”', exact: true }).waitFor();
    await waitForCall('search', { query: '网络失败', type: 'all' }, { before, uid: '654321' });
    await desktop.evaluate(() => { globalThis.searchUiMock.fail = false; });
  });
  await record('entity suggestions open an App page without an external browser', async () => {
    await input.fill('应用实体'); await page.getByRole('option', { name: '测试建议应用', exact: true }).waitFor();
    await page.getByRole('option', { name: '测试建议应用', exact: true }).click();
    await page.getByRole('heading', { name: '测试建议应用', exact: true, level: 1 }).waitFor();
    assert.deepEqual(await desktop.evaluate(() => globalThis.searchUiMock.external), []);
  });
  await record('a keyword-bearing search link chooses its result category for one search only', async () => {
    await input.fill('searchTab://topic?keyword=入口单次话题'); await input.press('Escape');
    let before = await callCount(); await input.press('Enter');
    await page.getByRole('heading', { name: '搜索“入口单次话题”', exact: true }).waitFor();
    await waitForCall('search', { query: '入口单次话题', type: 'feedTopic' }, { before, uid: '654321' });
    await input.fill('分类链接后的普通搜索'); await input.press('Escape'); before = await callCount(); await input.press('Enter');
    await waitForCall('search', { query: '分类链接后的普通搜索', type: 'all' }, { before, uid: '654321' });
  });
  for (const [type, label] of [['apk', '应用'], ['game', '游戏']]) {
    await record(`${type} input-only home entry preserves its scope through ordinary Enter and a classified suggestion`, async () => {
      await input.press('Escape'); await page.locator('.sidebar').getByRole('button', { name: '首页', exact: true }).click();
      const shortcut = page.locator('.home-shortcut').filter({ hasText: label + '搜索入口' }); await shortcut.waitFor();
      await input.fill('应清空的旧关键词'); await input.press('Escape');
      const entryBefore = await callCount(); await shortcut.click();
      assert.equal(await input.inputValue(), ''); assert.equal(await input.getAttribute('placeholder'), '搜索' + label + '…');
      assert.equal(await input.evaluate(node => node === document.activeElement), true);
      await input.press('Enter'); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await desktop.evaluate((_, before) => globalThis.searchUiMock.calls.slice(before).filter(row => row.operation === 'search').length, entryBefore), 0, 'empty entry must not submit a search');
      const query = label + '入口直接输入'; await input.fill(query); await input.press('Escape');
      let before = await callCount(); await input.press('Enter');
      await waitForCall('search', { query, type }, { before, uid: '654321' });
      const suggestionQuery = '入口类别建议' + label; before = await callCount(); await input.fill(suggestionQuery);
      await waitForCall('searchSuggestionsApp', { query: suggestionQuery }, { before, uid: '654321', complete: true });
      await page.getByRole('option', { name: '搜索用户 ' + suggestionQuery, exact: true }).waitFor();
      await input.press('ArrowDown'); before = await callCount(); await input.press('Enter');
      await waitForCall('search', { query: suggestionQuery + '酷友', type: 'user' }, { before, uid: '654321' });
      assert.equal(await input.getAttribute('placeholder'), '搜索' + label + '…');
      const afterSuggestion = label + '分类建议后的普通搜索'; await input.fill(afterSuggestion); await input.press('Escape'); before = await callCount(); await input.press('Enter');
      await waitForCall('search', { query: afterSuggestion, type }, { before, uid: '654321' });
      assert.deepEqual(await desktop.evaluate(() => globalThis.searchUiMock.external), []);
    });
  }
  await record('desktop dropdown remains within the viewport in light/dark themes at 960px', async () => {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 760));
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切换深色主题' : '切换浅色主题' }).click();
      await input.fill('主题' + theme); await page.getByRole('option', { name: '建议 主题' + theme, exact: true }).waitFor();
      await input.press('ArrowDown');
      const rect = await page.locator('.search-suggestions').evaluate(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: innerWidth }));
      assert.ok(rect.left >= 0 && rect.right <= rect.width);
      await page.screenshot({ path: join(directory, theme + '-960.png') });
    }
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/search-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), surface: 'actual App in isolated Electron', syntheticAccount: true, liveAccountWrites: false, checks, errors }, null, 2));
} finally { await desktop.close(); }
