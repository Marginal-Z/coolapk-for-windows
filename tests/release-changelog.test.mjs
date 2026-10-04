import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseChanges } from '../scripts/publish-release.mjs';

test('release notes select only the exact version and preserve Markdown line breaks', () => {
  assert.equal(releaseChanges('# Changes\r\n## 0.6.3\r\n\r\n- First\r\n- Second\r\n\r\n## 0.6.2\r\nOld', '0.6.3'), '- First\n- Second');
  assert.equal(releaseChanges('## 0.6.2\nOld\n## 0.6.3\nNew', '0.6.3'), 'New');
});
test('publishing requires bounded nonempty notes for its exact stable version', () => {
  for (const text of ['## 0.6.30\nWrong', '## 0.6.3\n\n## 0.6.2\nOld', '## 0.6.3\n' + 'x'.repeat(6001), '## 0.6.3\n\x00']) assert.throws(() => releaseChanges(text, '0.6.3'));
  assert.throws(() => releaseChanges('## 0.6.3\nOK', '0.6.3-beta'));
});
