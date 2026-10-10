// Full production App, styles and preferences; isolated synthetic read bridge.
// This exercises user paths rather than importing implementation selectors alone.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';

const directory = '.local/desktop-polish', port = Number(process.env.COOLAPK_DESKTOP_POLISH_TEST_PORT || 5276), origin = `http://127.0.0.1:${port}`;
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/fixture.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const checks = [], errors = [], measurements = {};
let browser, activePage;
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 980 }, reducedMotion: 'no-preference' });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y0k0AAAAASUVORK5CYII=', 'base64');
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (url.startsWith('https://fixtures.invalid/polish/')) return route.fulfill({ contentType: 'image/png', body: pixel });
    return route.abort();
  });
  await context.addInitScript(defaultSettings => {
    const account = { uid: '42', username: '版式验收账号', userAvatar: '' };
    const posters = Array.from({ length: 5 }, (_, index) => ({ entityType: 'feed', id: String(1001 + index), uid: '43', username: '酷图作者', message_title: `海报照片 ${index + 1}`, message: `海报照片 ${index + 1} 的原动态正文`, picArr: index === 0 ? ['https://fixtures.invalid/polish/one.png', 'https://fixtures.invalid/polish/two.png'] : ['https://fixtures.invalid/polish/one.png'], likenum: 10 + index, replynum: 0 }));
    const noImage = { entityType: 'feed', id: '1100', uid: '43', username: '无图作者', message: '保留没有图片的原动态', likenum: 0, replynum: 0 };
    const appItem = { entityType: 'apk', id: 'com.synthetic.catalog', title: '保留非动态条目', rating: '8.0' };
    const home = Array.from({ length: 8 }, (_, index) => ({ ...noImage, id: String(1201 + index), message: `首页只读动态 ${index + 1} ` + '用于核对刷新后的列表与滚动位置。'.repeat(6) }));
    const init = [{ title: '首页', entities: [{ id: '66', title: '关注', url: 'V15_HOME_TAB_FOLLOW', page_visibility: '1' }, { id: '67', title: '话题', url: 'V9_HOME_TAB_TOPIC', page_visibility: '0' }, { id: '68', title: '酷图', url: 'V11_HOME_TAB_PICTURE', page_visibility: '1' }] }];
    window.__polish = { reads: [], writes: [], rejected: [], updates: [], updateSnapshot: { currentVersion: '0.8.1', status: 'idle', distribution: 'installed' } };
    const ok = data => ({ ok: true, data });
    window.coolapk = {
      accounts: async () => ok({ accounts: [account], current: account }), onAccount: () => () => {}, onCommand: callback => { window.__polish.command = callback; return () => {}; },
      teenager: async () => ok({ enabled: false, blocked: false, reason: null, usedMilliseconds: 0, remainingMilliseconds: 2400000, limitMilliseconds: 2400000, day: '2026-10-06', lockedUntil: null }), onTeenager: () => () => {},
      background: async () => ok({ available: false, revision: '', url: '', width: 0, height: 0, name: '', bytes: 0 }),
      updates: async operation => { window.__polish.updates.push(operation); return ok(window.__polish.updateSnapshot); }, onUpdates: callback => { window.__polish.updateEvent = callback; return () => {}; },
      openExternal: async () => ok({ opened: true }),
      call: async (operation, args = {}) => {
        const fixture = window.__polish; fixture.reads.push({ operation, args });
        const result = data => ok({ data, hasMore: false });
        if (operation === 'init') return result(init);
        if (operation === 'accountSettings') return result({ values: { ...defaultSettings }, present: Object.keys(defaultSettings), guardExpiresAt: null, replyLocked: false });
        if (operation === 'notificationCount') return result({});
        if (['hotSearch', 'homeHotTopics', 'replies', 'hotReplies', 'advancedReplies'].includes(operation)) return result([]);
        if (operation === 'home') return result(home);
        if (operation === 'rank' || operation === 'page' && args.url === 'V11_HOME_TAB_PICTURE') return result([...posters, noImage, appItem]);
        if (operation === 'detail') return result([...posters, noImage, ...home].find(item => item.id === String(args.id)));
        if (operation === 'page' && ['V15_HOME_TAB_FOLLOW', 'V9_HOME_TAB_TOPIC'].includes(args.url)) return result(home);
        fixture.rejected.push({ operation, args });
        if (operation === 'action' || /Update$|Config$/.test(operation)) fixture.writes.push({ operation, args });
        return { ok: false, error: { code: 'TEST_BLOCKED', message: '隔离回归不允许未声明操作：' + operation } };
      },
    };
  }, DEFAULT_ACCOUNT_SETTINGS);
  const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const media = await context.newCDPSession(page);
  await media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }, { name: 'forced-colors', value: 'none' }] });
  const loaded = async () => { await page.locator('.account-entry strong').getByText('版式验收账号', { exact: true }).waitFor(); await page.locator('.main-scroll[data-page-kind="home"] [data-feed-id="1201"]').waitFor(); };
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
  const openSettings = async () => { await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await settings().waitFor(); };
  const closeSettings = async () => { await settings().getByRole('button', { name: '关闭', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
  const homeTabs = () => page.locator('.home-feed-header').getByRole('tablist', { name: '首页栏目', exact: true });
  const manager = () => page.getByRole('dialog', { name: '管理首页栏目', exact: true });
  const openManager = async () => { await openSettings(); await settings().getByRole('button', { name: /^管理首页栏目/ }).click(); await manager().waitFor(); assert.equal(await settings().count(), 0); };
  await page.goto(`${origin}/${directory}/fixture.html`); await loaded();
  await record('home removes activity status and channel management while the compact navigation remains functional', async () => {
    assert.equal(await page.locator('.home-feed-header').getByText('正在发生', { exact: true }).count(), 0);
    assert.equal(await page.locator('.home-feed-header').getByRole('button', { name: /管理栏目|管理首页栏目/ }).count(), 0);
    measurements.sidebar = await page.locator('.sidebar').evaluate(node => ({ width: node.getBoundingClientRect().width, items: [...node.querySelectorAll('.nav-item')].map(item => ({ height: item.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(item).fontSize) })) }));
    assert.ok(measurements.sidebar.width <= 210); assert.ok(measurements.sidebar.items.every(item => item.height >= 32 && item.height <= 38 && item.fontSize >= 12));
    assert.equal(await homeTabs().getByRole('tab', { name: '话题', exact: true }).count(), 0);
  });
  await record('settings channel manager saves visibility and order, immediately updates home and survives reopening/reload', async () => {
    await openManager(); await manager().getByRole('checkbox', { name: '话题', exact: true }).check();
    await manager().getByRole('button', { name: '上移话题', exact: true }).click(); await manager().getByRole('button', { name: '保存到本机', exact: true }).click();
    await manager().waitFor({ state: 'hidden' });
    assert.deepEqual((await homeTabs().getByRole('tab').allTextContents()).slice(0, 4), ['推荐', '话题', '关注', '酷图']);
    await openManager(); assert.equal(await manager().getByRole('checkbox', { name: '话题', exact: true }).isChecked(), true);
    assert.deepEqual((await manager().getByRole('checkbox').evaluateAll(nodes => nodes.map(node => node.parentElement.textContent))).slice(0, 4), ['推荐', '话题', '关注', '酷图']);
    await manager().getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload(); await loaded();
    assert.deepEqual((await homeTabs().getByRole('tab').allTextContents()).slice(0, 4), ['推荐', '话题', '关注', '酷图']);
  });
  await record('software update has one About action and no overview entry; actual App opens the updater', async () => {
    await openSettings(); assert.equal(await settings().getByRole('button', { name: /软件更新/ }).count(), 0);
    await settings().getByRole('tab', { name: '关于酷安', exact: true }).click();
    assert.equal(await settings().getByRole('button', { name: /软件更新/ }).count(), 1);
    await settings().getByRole('button', { name: '检查软件更新', exact: true }).click();
    const update = page.getByRole('dialog', { name: '软件更新', exact: true }); await update.waitFor();
    assert.equal(await settings().count(), 0); await update.getByText('当前版本 0.8.1', { exact: false }).waitFor();
    await update.getByRole('button', { name: '关闭', exact: true }).click(); await update.waitFor({ state: 'hidden' });
  });
  await record('material switch removes real filters on shell/cards/settings and restores the selected blur type', async () => {
    await openSettings(); await settings().getByRole('tab', { name: '界面显示', exact: true }).click();
    await settings().getByLabel('界面材质效果', { exact: true }).selectOption('blur_only');
    const blurActive = () => getComputedStyle(document.querySelector('.topbar')).backdropFilter.includes('blur(');
    await page.waitForFunction(blurActive);
    await settings().getByRole('switch', { name: '开启界面材质效果', exact: true }).uncheck();
    const noFilters = () => [...document.querySelectorAll('.sidebar,.topbar,.home-feed-header,.feed-card,.settings-modal,.preferences-group,.search-box')].every(node => ['', '::before', '::after'].every(pseudo => getComputedStyle(node, pseudo || null).backdropFilter === 'none'));
    await page.waitForFunction(noFilters);
    assert.equal(await settings().getByLabel('界面材质效果', { exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('coolapk-preferences')); return [saved.materialEnabled, saved.materialEffect]; }), [false, 'blur_only']);
    await closeSettings(); await page.reload(); await loaded(); await page.waitForFunction(noFilters);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.materialEnabled), 'false');
    await openSettings(); await settings().getByRole('tab', { name: '界面显示', exact: true }).click();
    assert.equal(await settings().getByRole('switch', { name: '开启界面材质效果', exact: true }).isChecked(), false);
    await settings().getByRole('switch', { name: '开启界面材质效果', exact: true }).check();
    await page.waitForFunction(blurActive);
    assert.equal(await settings().getByLabel('界面材质效果', { exact: true }).inputValue(), 'blur_only');
    await closeSettings();
  });
  await record('ordinary window widths reserve publish and all toolbar actions without search overlap', async () => {
    measurements.toolbar = [];
    for (const width of [1600, 1150, 900, 760]) {
      await page.setViewportSize({ width, height: 980 });
      const bounds = await page.locator('.topbar').evaluate(node => {
        const search = node.querySelector('.search-box').getBoundingClientRect(), publish = node.querySelector('.topbar-publish').getBoundingClientRect(), toolbar = node.getBoundingClientRect();
        return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, searchRight: search.right, publishLeft: publish.left, toolbarRight: toolbar.right, actions: [...node.querySelectorAll('.topbar-actions button')].map(button => { const rect = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label') || button.textContent, left: rect.left, right: rect.right, width: rect.width, receivesPointer: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) }; }) };
      });
      measurements.toolbar.push(bounds);
      assert.equal(bounds.documentWidth, width); assert.ok(bounds.searchRight <= bounds.publishLeft, `Search overlaps publish at ${width}px`);
      assert.ok(bounds.actions.every(action => action.width >= 30 && action.left >= 0 && action.right <= width && action.receivesPointer), `Toolbar action is covered at ${width}px`);
    }
    await page.screenshot({ path: `${directory}/toolbar-narrow.png` }); await page.setViewportSize({ width: 1600, height: 980 });
  });
  await record('refresh resets content to latest top and animates the actual SVG; reduced motion disables that animation', async () => {
    await page.locator('.main-scroll').evaluate(node => { node.scrollTop = 500; });
    assert.ok(await page.locator('.main-scroll').evaluate(node => node.scrollTop) > 0);
    const before = await page.evaluate(() => window.__polish.reads.filter(item => item.operation === 'home').length);
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="刷新当前页"] svg')?.getAnimations().some(animation => animation.animationName === 'desktop-refresh-turn'));
    assert.equal(await page.locator('.main-scroll').evaluate(node => node.scrollTop), 0);
    await page.waitForFunction(before => window.__polish.reads.filter(item => item.operation === 'home').length > before, before);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '刷新当前页', exact: true }).click();
    assert.equal(await page.locator('[aria-label="刷新当前页"] svg').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  await record('rank cool pictures use multiple poster columns, decoded cover images and retain no-image/nonfeed entries', async () => {
    await page.getByRole('group', { name: '社区导航', exact: true }).getByRole('button', { name: '热榜', exact: true }).click();
    await page.getByRole('tab', { name: '酷图', exact: true }).click();
    await page.locator('.picture-poster').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.picture-poster-image img')].length === 5 && [...document.querySelectorAll('.picture-poster-image img')].every(image => image.complete && image.naturalWidth > 0));
    measurements.posters = await page.locator('.picture-posters').evaluate(node => ({ columns: getComputedStyle(node).gridTemplateColumns.split(' ').length, rows: [...node.querySelectorAll('.picture-poster')].map(item => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y })), imageFit: getComputedStyle(node.querySelector('.picture-poster-image img')).objectFit }));
    assert.ok(measurements.posters.columns >= 2); assert.ok(measurements.posters.rows[0].x < measurements.posters.rows[1].x); assert.equal(measurements.posters.rows[0].y, measurements.posters.rows[1].y); assert.equal(measurements.posters.imageFit, 'cover');
    await page.locator('.picture-posters [data-feed-id="1100"]').getByText('保留没有图片的原动态', { exact: true }).waitFor();
    const textCard = await page.locator('.picture-posters [data-feed-id="1100"]').evaluate(node => ({ width: node.getBoundingClientRect().width, gridWidth: node.parentElement.getBoundingClientRect().width }));
    assert.ok(Math.abs(textCard.width - textCard.gridWidth) < 1, 'Text-only feed must span the poster grid');
    await page.locator('.picture-posters').getByText('保留非动态条目', { exact: true }).waitFor();
    assert.equal(await page.locator('.picture-poster[data-feed-id="1001"] .picture-poster-count').innerText(), '2');
    await page.screenshot({ path: `${directory}/picture-posters-wide.png` });
  });
  await record('poster and text-only cards open the correct original detail instead of a cropped preview', async () => {
    await page.getByRole('button', { name: '查看酷图：海报照片 1', exact: true }).click();
    await page.getByRole('dialog', { name: '动态详情', exact: true }).getByText('海报照片 1 的原动态正文', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__polish.reads.some(item => item.operation === 'detail' && item.args.id === '1001')), true);
    await page.getByRole('button', { name: '关闭动态详情', exact: true }).click();
    await page.locator('.picture-posters [data-feed-id="1100"]').getByRole('button', { name: '查看动态', exact: true }).click();
    await page.getByRole('dialog', { name: '动态详情', exact: true }).getByText('保留没有图片的原动态', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__polish.reads.some(item => item.operation === 'detail' && item.args.id === '1100')), true);
    await page.getByRole('button', { name: '关闭动态详情', exact: true }).click();
  });
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.__polish.rejected), []); assert.deepEqual(await page.evaluate(() => window.__polish.writes), []);
  writeFileSync(`${directory}/checks.json`, JSON.stringify({ checkedAt: new Date().toISOString(), checks, measurements, errors, realCloudWrites: 0, result: 'passed' }, null, 2) + '\n');
  console.log('DESKTOP_POLISH_PASS', checks.length); await context.close();
} catch (error) {
  if (activePage && !activePage.isClosed()) { console.error(JSON.stringify({ errors, state: await activePage.evaluate(() => ({ dataset: { ...document.documentElement.dataset }, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.getAttribute('aria-label')), filters: [...document.querySelectorAll('.sidebar,.topbar,.home-feed-header,.feed-card,.settings-modal,.preferences-group,.search-box')].slice(0, 12).map(node => ({ className: node.className, filters: ['', '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo || null).backdropFilter) })), rejected: window.__polish.rejected })) }, null, 2)); await activePage.screenshot({ path: `${directory}/failed.png` }); }
  throw error;
} finally { await browser?.close(); await server.close(); }
