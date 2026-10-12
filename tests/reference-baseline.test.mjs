import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(readFileSync(new URL('../research/reference-client-baseline.json', import.meta.url), 'utf8'));

test('checked-in MIT reference baseline is self-contained, unique and complete for its recorded public methods', () => {
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(baseline.license, 'MIT');
  assert.match(baseline.sha256, /^[a-f\d]{64}$/);
  assert.ok(Array.isArray(baseline.methods));
  const names = baseline.methods.map(method => method.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(baseline.methods.filter(method => method.publicAsync).length, baseline.publicAsyncFunctionCount);
  assert.equal(baseline.publicAsyncFunctionCount, 251);
  for (const method of baseline.methods) {
    assert.ok(Number.isInteger(method.line) && method.line > 0);
    assert.ok(Array.isArray(method.endpoints));
    assert.ok(Array.isArray(method.descriptors));
    assert.ok(Array.isArray(method.calls));
    assert.equal(Object.hasOwn(method, 'body'), false, 'the baseline stores extracted metadata, not copied reference source');
  }
});
