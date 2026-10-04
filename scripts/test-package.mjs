import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import playwright from 'playwright';
const root = resolve('.');
mkdirSync('.local/package-check', { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(join(root, '.local/package-check/userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await playwright._electron.launch({ executablePath: join(root, 'release/win-unpacked/酷安桌面端.exe'), args: [], env, timeout: 30000 });
try {
  const page = await desktop.firstWindow();
  await page.locator('[data-feed-id]').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => { const image = document.querySelector('.photo-button img'); return image?.complete && image.naturalWidth > 0; }, null, { timeout: 20000 });
  const state = await page.evaluate(async () => ({ bridge: !!window.coolapk, shareImageReader: typeof window.coolapk?.shareImageData === 'function', feeds: document.querySelectorAll('[data-feed-id]').length, accounts: (await window.coolapk.accounts()).ok, sandboxed: typeof window.require === 'undefined', title: document.title }));
  assert.ok(state.bridge && state.shareImageReader && state.feeds > 0 && state.accounts && state.sandboxed);
  await page.screenshot({ path: '.local/package-check/home.png' });
  const versions = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }));
  writeFileSync('research/package-check.json', JSON.stringify({ checkedAt: new Date().toISOString(), ...state, ...versions }, null, 2));
  console.log('PACKAGED_APP_PASS', JSON.stringify({ ...state, ...versions }));
} finally { await desktop.close(); }
