import test from 'node:test';
import assert from 'node:assert/strict';
import { officialAccountPageRoute, officialAccountPageTitle, isOfficialAccountPageUrl } from '../core/official-pages.mjs';

test('official personal pages use fixed HTTPS routes and derive equipment identity from a validated UID', () => {
  assert.equal(officialAccountPageRoute('username'), 'https://account.coolapk.com/account/changeUsername');
  assert.equal(officialAccountPageRoute('security'), 'https://account.coolapk.com/account');
  assert.equal(officialAccountPageRoute('equipment', '123456'), 'https://m.coolapk.com/myDevice/123456');
  assert.equal(officialAccountPageTitle('equipment'), '酷安 · 我的装备');
  for (const uid of ['', '0', '-1', '123/x', '123?x=1', '1'.repeat(21)]) assert.throws(() => officialAccountPageRoute('equipment', uid));
  assert.throws(() => officialAccountPageRoute('arbitrary-url', '123456'));
});

test('official account windows allow only HTTPS on the fixed Coolapk first-party hosts', () => {
  for (const url of ['https://account.coolapk.com/account', 'https://www.coolapk.com/feed/1', 'https://m.coolapk.com/myDevice/123']) assert.equal(isOfficialAccountPageUrl(url), true);
  for (const url of ['http://m.coolapk.com/myDevice/123', 'https://m.coolapk.com.evil.test/myDevice/123', 'https://user@m.coolapk.com/myDevice/123', 'https://m.coolapk.com:444/myDevice/123', 'javascript:alert(1)']) assert.equal(isOfficialAccountPageUrl(url), false);
});
