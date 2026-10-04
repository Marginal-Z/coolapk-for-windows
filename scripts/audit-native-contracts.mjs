// Compare fixed desktop request methods with statically recovered official
// Retrofit annotations. Dynamic routes and request bodies need caller review.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

export function auditNativeContracts(contracts, sources) {
  const official = new Map();
  for (const entry of contracts) {
    if (!entry || !['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(entry.method) || !/^[A-Za-z0-9_/]+$/.test(entry.endpoint)) continue;
    const path = '/v6/' + entry.endpoint, methods = official.get(path) || new Set(); methods.add(entry.method); official.set(path, methods);
  }
  const fixed = [];
  const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const property = (node, key) => ts.isObjectLiteralExpression(node) ? node.properties.find(item => ts.isPropertyAssignment(item) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === key)?.initializer : undefined;
  for (const [file, code] of Object.entries(sources)) {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const add = (endpoint, method, node, kind) => { if (/^\/v6\/[A-Za-z0-9_/]+$/.test(endpoint || '') && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].includes(method)) fixed.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, endpoint, method, kind }); };
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const direct = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'request';
        const social = ts.isIdentifier(node.expression) && node.expression.text === 'requestSocialWrite';
        if (direct || social) {
          const endpoint = literal(node.arguments[social ? 1 : 0]), options = node.arguments[social ? 3 : 2], kind = social ? 'social-write' : 'request';
          if (!options) add(endpoint, 'GET', node, kind);
          else if (ts.isObjectLiteralExpression(options)) { const method = property(options, 'method'); if (!method) add(endpoint, 'GET', node, kind); else if (literal(method)) add(endpoint, literal(method), node, kind); }
        }
      }
      if (ts.isObjectLiteralExpression(node)) {
        const endpoint = literal(property(node, 'path')), method = property(node, 'method');
        if (endpoint && (!method || literal(method))) add(endpoint, literal(method) || 'GET', node, 'descriptor');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const compared = fixed.filter(entry => official.has(entry.endpoint)).map(entry => ({ ...entry, officialMethods: [...official.get(entry.endpoint)].sort(), matchingMethod: official.get(entry.endpoint).has(entry.method) }));
  return { fixedRequestCount: fixed.length, recoveredEndpointCount: official.size, comparedRequestCount: compared.length, mismatches: compared.filter(entry => !entry.matchingMethod), unboundFixedRequests: fixed.filter(entry => !official.has(entry.endpoint)), limitations: ['Only literal direct requests, requestSocialWrite wrapper calls and descriptor methods are compared.', 'Matching a method is not evidence of complete query/body fields, caller semantics, permission state or live acceptance.', 'Unbound paths may belong to a dynamic Retrofit URL or a web API; their absence does not prove they are unsupported.'] };
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/audit-native-contracts.mjs')) {
  const [input, output = 'research/native-api-audit.json', ...extra] = process.argv.slice(2);
  if (!input || extra.length) throw Error('Usage: node scripts/audit-native-contracts.mjs CONTRACT_REPORT [OUTPUT_REPORT]');
  const report = JSON.parse(readFileSync(input, 'utf8'));
  if (!Array.isArray(report.contracts) || report.contracts.length > 3000) throw Error('Invalid official contract report');
  const sources = Object.fromEntries(readdirSync('core').filter(file => file.endsWith('.mjs')).map(file => ['core/' + file, readFileSync('core/' + file, 'utf8')]));
  const audit = { schemaVersion: 1, checkedAt: new Date().toISOString(), sourceApkSha256: report.apkSha256, evidence: 'Static Retrofit annotations reconstructed from the user-provided official APK; no account data or device memory', ...auditNativeContracts(report.contracts, sources) };
  writeFileSync(output, JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ compared: audit.comparedRequestCount, mismatches: audit.mismatches, output }, null, 2));
  if (audit.mismatches.length) process.exitCode = 1;
}
