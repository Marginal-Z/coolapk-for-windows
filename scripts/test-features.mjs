import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';

// Isolated renderer contract checks. Every API/interaction is synthetic, and all
// browser requests outside the local Vite origin are blocked.
const port = Number(process.env.COOLAPK_UI_TEST_PORT || 5175);
const origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/feature-check');
mkdirSync(output, { recursive: true });
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
const browserOptions = process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {};
let browser;
const checks = [], errors = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...browserOptions });
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 }, bypassCSP: true });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(defaultSettings => {
    const accountA = { uid: '123456', username: '测试账号甲', userAvatar: '' };
    const accountB = { uid: '654321', username: '测试账号乙', userAvatar: '' };
    const feed = { entityType: 'feed', id: '50', uid: accountA.uid, username: accountA.username, message: '<p>原动态正文</p>', dateline: 1791000000, picArr: ['https://image.coolapk.com/feed/a.jpg', 'https://image.coolapk.com/feed/b.jpg'], userAction: {} };
    const mock = window.__featureMock = {
      calls: [], account: accountA, failOnce: '', listeners: new Set(), nextId: 8,
      collections: [
        { entityType: 'collection', id: 0, uid: accountA.uid, title: '默认收藏单', defaultCollected: 1, isOpen: 1 },
        { entityType: 'collection', id: 7, uid: accountA.uid, title: '数码笔记', description: '收藏单介绍', isOpen: 1, cover: 'https://image.coolapk.com/feed/cover.jpg' },
      ],
      selected: new Set(['0']),
      switchAccount(uid) {
        this.account = uid === accountB.uid ? accountB : uid === accountA.uid ? accountA : null;
        const result = { ok: true, data: { accounts: [accountA, accountB], current: this.account } };
        for (const listener of this.listeners) listener(result);
        return result;
      },
    };
    const result = data => ({ ok: true, data });
    const list = data => ({ data, hasMore: false, firstItem: String(data[0]?.id ?? ''), lastItem: String(data.at(-1)?.id ?? '') });
    window.coolapk = {
      teenager: async operation => operation === 'info' ? result({ enabled: false, blocked: false, reason: null, usedMilliseconds: 0, remainingMilliseconds: 2400000, limitMilliseconds: 2400000, day: '2026-10-04', lockedUntil: null }) : { ok: false, error: { code: 'TEST_UNSUPPORTED', message: '该测试仅模拟关闭的青少年模式' } },
      onTeenager: () => () => {},
      accounts: async () => result({ accounts: [accountA, accountB], current: mock.account }),
      onAccount: callback => { mock.listeners.add(callback); return () => mock.listeners.delete(callback); },
      onCommand: () => () => {},
      selectAccount: async uid => mock.switchAccount(uid), removeAccount: async () => result({ accounts: [accountA], current: accountA }),
      login: async () => result({}), importCookie: async () => result({ accounts: [accountA], current: accountA }),
      verify: async () => result({}), openExternal: async () => result(undefined),
      call: async (operation, args = {}) => {
        mock.calls.push({ operation, args: JSON.parse(JSON.stringify(args)) });
        if (operation === 'accountSettings') return result({ data: { values: { ...defaultSettings }, present: Object.keys(defaultSettings), guardExpiresAt: null, replyLocked: false } });
        if (operation === 'init' || operation === 'hotSearch') return result(list([]));
        if (operation === 'home' || operation === 'followingFeeds' || operation === 'userFeeds') return result(list([{ ...feed, userAction: {}, collection_item_info: { id: 99 } }]));
        if (operation === 'notificationCount') return result({ data: { badge: 3, message: 1 } });
        if (operation === 'collections') return result(list(mock.collections));
        if (operation === 'collection') return result({ data: mock.collections.find(item => String(item.id) === String(args.id)) });
        if (operation === 'collectionFeeds') return result(list([{ ...feed, collection_item_info: { id: 99 } }]));
        if (operation === 'collectionStatus') {
          const items = Number(args.page || 1) === 1 ? mock.collections.slice(0, 2) : Number(args.page) === 2 ? [{ entityType: 'collection', id: 9, uid: accountA.uid, title: '第二页收藏单', isOpen: 1 }] : [];
          return result({ ...list(items.map(item => ({ ...item, isBeCollected: mock.selected.has(String(item.id)) ? 1 : 0 }))), hasMore: Number(args.page || 1) < 2 });
        }
        if (operation === 'editableFeed' || operation === 'detail') return result({ data: { ...feed, enableModify: 1, feedType: 'feed' } });
        if (operation === 'replies' || operation === 'notifications' || operation === 'messages') return result(list([]));
        if (operation === 'user') return result({ data: { ...mock.account } });
        if (operation === 'clearNotificationCount') return result({ data: {} });
        if (operation !== 'action') return result(list([]));
        if (mock.failOnce === args.type) {
          mock.failOnce = '';
          return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟人工验证', verificationId: 'synthetic-verification' } };
        }
        if (args.type === 'createCollection') {
          const item = { entityType: 'collection', id: mock.nextId++, uid: mock.account.uid, title: args.title, description: args.description, isOpen: args.isOpen };
          mock.collections.push(item); return result({ data: item });
        }
        if (args.type === 'updateCollection') {
          const item = mock.collections.find(item => String(item.id) === String(args.id));
          Object.assign(item, { title: args.title, description: args.description, isOpen: args.isOpen, cover: args.cover });
          return result({ data: item });
        }
        if (args.type === 'deleteCollection') mock.collections = mock.collections.filter(item => String(item.id) !== String(args.id));
        if (args.type === 'updateCollectionItems') {
          for (const id of args.collectionIds || []) mock.selected.add(String(id));
          for (const id of args.cancelIds || []) mock.selected.delete(String(id));
        }
        return result({ data: { id: args.id || '100' } });
      },
    };
  }, DEFAULT_ACCOUNT_SETTINGS);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('[data-feed-id="50"]').waitFor();
  const actions = () => page.evaluate(() => window.__featureMock.calls.filter(item => item.operation === 'action'));
  const sidebar = page.locator('.sidebar');
  const dialog = title => page.getByRole('dialog', { name: title, exact: true });
  const home = async () => { await sidebar.getByRole('button', { name: '首页', exact: true }).click(); await page.locator('[data-feed-id="50"]').waitFor(); };
  const collections = async () => { await sidebar.getByRole('button', { name: '我的收藏', exact: true }).click(); await page.getByRole('button', { name: '数码笔记', exact: false }).waitFor(); };
  const openCollection = async () => { await collections(); await page.locator('.entity-card').filter({ hasText: '数码笔记' }).click(); await page.getByRole('button', { name: '编辑收藏单', exact: true }).waitFor(); };

  await record('creating a collection closes after success under React StrictMode', async () => {
    await collections(); await page.getByRole('button', { name: '新建收藏单', exact: true }).click();
    await dialog('新建收藏单').getByRole('textbox', { name: '收藏单名称' }).fill('新收藏单');
    await dialog('新建收藏单').getByRole('textbox', { name: '收藏单介绍' }).fill('界面测试');
    await dialog('新建收藏单').getByRole('button', { name: '保存', exact: true }).click();
    await dialog('新建收藏单').waitFor({ state: 'hidden' });
    assert.ok((await actions()).some(item => item.args.type === 'createCollection' && item.args.title === '新收藏单'));
    await page.locator('.entity-card').filter({ hasText: '新收藏单' }).waitFor();
  });
  await record('collection editing preserves cover and human verification repeats the same operation', async () => {
    await openCollection(); await page.getByRole('button', { name: '编辑收藏单', exact: true }).click();
    await dialog('编辑收藏单').getByRole('button', { name: '删除收藏单', exact: true }).click();
    await page.evaluate(() => { window.__featureMock.failOnce = 'updateCollection'; });
    const before = (await actions()).length;
    await dialog('编辑收藏单').getByRole('button', { name: '保存', exact: true }).click();
    await dialog('编辑收藏单').getByRole('button', { name: '完成验证', exact: true }).click();
    await dialog('编辑收藏单').waitFor({ state: 'hidden' });
    const writes = (await actions()).slice(before);
    assert.deepEqual(writes.map(item => item.args.type), ['updateCollection', 'updateCollection']);
    assert.ok(writes.every(item => item.args.cover === 'https://image.coolapk.com/feed/cover.jpg'));
  });
  await record('collection selection survives pagination and saves a post into the chosen collection', async () => {
    await home(); await page.getByRole('button', { name: '保存到收藏单', exact: true }).click();
    const picker = dialog('保存到收藏单'), chosen = picker.locator('.collection-choice').filter({ hasText: '数码笔记' }).getByRole('checkbox');
    await chosen.check(); await picker.getByRole('button', { name: '加载更多', exact: true }).click();
    await picker.getByText('第二页收藏单', { exact: true }).waitFor();
    assert.equal(await chosen.isChecked(), true);
    await picker.getByRole('button', { name: '完成', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
    const write = (await actions()).at(-1);
    assert.equal(write.args.type, 'updateCollectionItems'); assert.equal(write.args.targetId, '50');
    assert.deepEqual(write.args.collectionIds, ['7']); assert.deepEqual(write.args.cancelIds, []);
  });
  await record('all collection memberships including default id zero can be cancelled explicitly', async () => {
    await page.getByRole('button', { name: '保存到收藏单', exact: true }).click();
    const picker = dialog('保存到收藏单');
    await picker.locator('.collection-choice').filter({ hasText: '默认收藏单' }).getByRole('checkbox').uncheck();
    await picker.locator('.collection-choice').filter({ hasText: '数码笔记' }).getByRole('checkbox').uncheck();
    await picker.getByRole('button', { name: '完成', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
    const write = (await actions()).at(-1);
    assert.deepEqual(write.args.collectionIds, []); assert.deepEqual(write.args.cancelIds.sort(), ['0', '7']);
  });
  await record('editing an own feed retains the complete original image list', async () => {
    await home(); await page.getByRole('button', { name: '管理我的动态', exact: true }).click();
    const manager = dialog('管理动态'); await manager.getByRole('button', { name: '编辑我的动态', exact: true }).click();
    await manager.getByRole('textbox', { name: '编辑动态内容', exact: true }).fill('新的正文');
    await manager.getByRole('button', { name: '保存修改', exact: true }).click(); await manager.waitFor({ state: 'hidden' });
    const write = (await actions()).at(-1);
    assert.equal(write.args.type, 'editFeed'); assert.equal(write.args.message, '新的正文');
    assert.equal(write.args.pic, 'https://image.coolapk.com/feed/a.jpg,https://image.coolapk.com/feed/b.jpg');
  });
  await record('delete feed needs confirmation and cancelling causes no write', async () => {
    await page.getByRole('button', { name: '管理我的动态', exact: true }).click();
    const manager = dialog('管理动态'), before = (await actions()).length;
    await manager.getByRole('button', { name: '删除我的动态', exact: true }).click();
    assert.equal((await actions()).length, before);
    await manager.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal((await actions()).length, before);
    await page.getByRole('button', { name: '管理我的动态', exact: true }).click();
    await manager.getByRole('button', { name: '删除我的动态', exact: true }).click();
    await manager.getByRole('button', { name: '确认删除动态', exact: true }).click(); await manager.waitFor({ state: 'hidden' });
    assert.equal((await actions()).at(-1).args.type, 'deleteFeed');
  });
  await record('removing a collection item uses its independent item id', async () => {
    await openCollection(); await page.getByRole('button', { name: '管理收藏动态', exact: true }).click();
    const manager = dialog('管理动态'); await manager.getByRole('button', { name: '移出当前收藏单', exact: true }).click();
    await manager.getByRole('button', { name: '确认移出', exact: true }).click(); await manager.waitFor({ state: 'hidden' });
    assert.equal((await actions()).at(-1).args.itemId, '99');
  });
  await record('default collection exposes no editing or deletion action', async () => {
    await collections(); await page.locator('.entity-card').filter({ hasText: '默认收藏单' }).click();
    await page.locator('.profile-card').waitFor();
    assert.equal(await page.getByRole('button', { name: '编辑收藏单', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '删除收藏单', exact: true }).count(), 0);
  });
  await record('switching account closes collection and post drafts', async () => {
    await collections(); await page.getByRole('button', { name: '新建收藏单', exact: true }).click();
    await dialog('新建收藏单').getByRole('textbox', { name: '收藏单名称' }).fill('不能带到另一个账号');
    const before = (await actions()).length;
    await page.evaluate(() => window.__featureMock.switchAccount('654321'));
    await dialog('新建收藏单').waitFor({ state: 'hidden' });
    assert.equal((await actions()).length, before);
    await sidebar.getByRole('button', { name: '发布动态', exact: true }).click();
    await dialog('发布动态').getByRole('textbox').fill('另一个未提交草稿');
    await page.evaluate(() => window.__featureMock.switchAccount('123456'));
    await dialog('发布动态').waitFor({ state: 'hidden' });
    assert.equal((await actions()).length, before);
  });
  await record('deleting a collection requires explicit confirmation', async () => {
    await openCollection(); await page.getByRole('button', { name: '编辑收藏单', exact: true }).click();
    const editor = dialog('编辑收藏单'), before = (await actions()).length;
    await editor.getByRole('button', { name: '删除收藏单', exact: true }).click(); assert.equal((await actions()).length, before);
    await editor.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal((await actions()).length, before);
    await page.getByRole('button', { name: '编辑收藏单', exact: true }).click();
    await editor.getByRole('button', { name: '删除收藏单', exact: true }).click();
    await editor.getByRole('button', { name: '确认删除此收藏单', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    assert.equal((await actions()).at(-1).args.type, 'deleteCollection');
    assert.equal((await actions()).at(-1).args.id, '7');
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'complete.png') });
  writeFileSync('research/feature-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic renderer API mock; no real account writes', checks, errors }, null, 2));
  await context.close();
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await server.close(); }
