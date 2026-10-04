import assert from 'node:assert/strict';
import test from 'node:test';
import { auditNativeContracts } from '../scripts/audit-native-contracts.mjs';
test('native API audit detects a real method mismatch without resolving dynamic strings or merging distinct overloads', () => {
  const contracts = [{ endpoint: 'user/unfollow', method: 'POST' }, { endpoint: 'sample/list', method: 'GET' }, { endpoint: 'sample/list', method: 'POST' }];
  const result = auditNativeContracts(contracts, { 'core/synthetic.mjs': "client.request('/v6/user/unfollow', {uid});\nclient.request('/v6/sample/list');\nconst definition={path:'/v6/sample/list',method:'POST'};\nclient.request('/v6/' + name);\nclient.request('/v6/custom/read');" });
  assert.equal(result.fixedRequestCount, 4); assert.equal(result.comparedRequestCount, 3);
  assert.deepEqual(result.mismatches, [{ file: 'core/synthetic.mjs', line: 1, endpoint: '/v6/user/unfollow', method: 'GET', kind: 'request', officialMethods: ['POST'], matchingMethod: false }]);
  assert.deepEqual(result.unboundFixedRequests.map(item => item.endpoint), ['/v6/custom/read']);
});
test('social write wrapper calls retain their actual methods in the native audit', () => {
  const result = auditNativeContracts([{ endpoint: 'feed/createFeed', method: 'POST' }], {
    'core/synthetic.mjs': "requestSocialWrite(client, '/v6/feed/createFeed', {}, {method:'POST', form});\nrequestSocialWrite(client, '/v6/feed/createFeed', {});\nrequestSocialWrite(client, '/v6/' + path, {}, {method:'POST'});"
  });
  assert.equal(result.fixedRequestCount, 2);
  assert.equal(result.comparedRequestCount, 2);
  assert.deepEqual(result.mismatches.map(({ line, method, kind }) => ({ line, method, kind })), [{ line: 2, method: 'GET', kind: 'social-write' }]);
});
