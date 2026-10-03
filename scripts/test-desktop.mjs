import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import electron from 'electron';
import playwright from 'playwright';
const root = resolve('.');
mkdirSync('.local/ui-check', { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: join(root, '.local/ui-check/userdata') }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: electron, args: [root], env, timeout: 30000 });
const errors = [];
const checks = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  const page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await record('native window loads real home feeds', async () => {
    await page.locator('[data-feed-id]').first().waitFor({ timeout: 30000 });
    assert.ok(await page.evaluate(() => !!window.coolapk));
    assert.ok((await page.locator('[data-feed-id]').count()) > 0);
    await page.locator('.photo-button img').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => { const image = document.querySelector('.photo-button img'); return image?.complete && image.naturalWidth > 0; }, null, { timeout: 20000 });
    await page.screenshot({ path: '.local/ui-check/home.png' });
  });
  await record('dark mode and window resize keep controls reachable', async () => {
    await page.getByRole('button', { name: '切换深色主题' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(960, 760); });
    await page.screenshot({ path: '.local/ui-check/dark-960.png' });
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(widths.scroll <= widths.width);
    await page.getByRole('button', { name: '切换浅色主题' }).click();
    await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1360, 920); });
  });
  await record('search submits and returns public posts', async () => {
    const search = page.getByRole('textbox', { name: '搜索酷安' });
    await search.fill('酷安'); await search.press('Enter');
    await page.locator('.page-heading h1').filter({ hasText: '搜索' }).waitFor();
    await page.getByRole('tab', { name: '动态', exact: true }).click();
    await page.locator('[data-feed-id]').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: '.local/ui-check/search.png' });
  });
  await record('feed details surface captcha and preserve visible content', async () => {
    await page.getByRole('button', { name: '查看动态', exact: true }).first().click();
    await page.getByRole('dialog', { name: '动态详情' }).waitFor();
    await page.locator('.detail-panel .feed-card').waitFor();
    // The current service may accept the request or require a human challenge.
    await page.waitForFunction(() => !document.querySelector('.detail-scroll [aria-label="正在加载"]'), null, { timeout: 30000 });
    await page.screenshot({ path: '.local/ui-check/detail.png' });
    const verifyButton = page.getByRole('button', { name: '完成验证', exact: true }).first();
    if (await verifyButton.isVisible()) {
      const nextWindow = desktop.waitForEvent('window');
      await verifyButton.click();
      const verifier = await nextWindow;
      await verifier.waitForFunction(() => typeof window.initNECaptcha === 'function', null, { timeout: 30000 });
      await verifier.screenshot({ path: '.local/ui-check/verification.png' });
      await verifier.getByRole('button', { name: '取消', exact: true }).click();
      checks.push('manual verification component loads (challenge not solved)');
    }
    await page.getByRole('button', { name: '关闭动态详情' }).click();
  });
  await record('guest protected screens provide a working login entry', async () => {
    await page.locator('.sidebar').getByRole('button', { name: '我的收藏', exact: true }).click();
    await page.getByText('登录后，社区更完整', { exact: true }).waitFor();
    await page.locator('main').getByRole('button', { name: '登录酷安', exact: true }).click();
    await page.getByRole('dialog', { name: '登录酷安' }).waitFor();
    assert.ok(await page.getByRole('button', { name: '打开官方登录', exact: true }).isVisible());
    await page.screenshot({ path: '.local/ui-check/login.png' });
    const nextWindow = desktop.waitForEvent('window');
    await page.getByRole('button', { name: '打开官方登录', exact: true }).click();
    const official = await nextWindow;
    await official.waitForURL(/account\.coolapk\.com/, { timeout: 30000 });
    assert.ok((await official.evaluate(() => document.body.innerText)).length > 0);
    await official.screenshot({ path: '.local/ui-check/official-login.png' });
    await official.close();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('public user profile and history navigation work', async () => {
    await page.locator('.sidebar').getByRole('button', { name: '首页', exact: true }).click();
    await page.locator('[data-feed-id]').first().waitFor({ timeout: 30000 });
    await page.locator('.author-button').first().click();
    await page.locator('.profile-card').waitFor({ timeout: 30000 });
    await page.locator('.sidebar').getByRole('button', { name: '浏览历史', exact: true }).click();
    assert.ok((await page.locator('.entity-card').count()) > 0);
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/desktop-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), checks, errors, screenshots: ['home', 'dark-960', 'search', 'detail', 'login'] }, null, 2));
} catch (error) {
  const page = await desktop.firstWindow();
  await page.screenshot({ path: '.local/ui-check/failure.png' });
  console.log('FAILURE_STATE', await page.locator('main').innerText());
  throw error;
} finally { await desktop.close(); }
