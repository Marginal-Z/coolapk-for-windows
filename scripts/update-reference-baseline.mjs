import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/update-reference-baseline.mjs <MIT reference client.rs path>');
const sourcePath = resolve(process.argv[2]);
const outputPath = resolve(root, 'research/reference-client-baseline.json');
const source = readFileSync(sourcePath, 'utf8');
const hash = createHash('sha256').update(source).digest('hex');

function maskRust(value) {
  const output = value.split('');
  const blank = (start, end) => { for (let i = start; i < end; i++) if (output[i] !== '\n' && output[i] !== '\r') output[i] = ' '; };
  let i = 0;
  while (i < value.length) {
    if (value.startsWith('//', i)) { const end = value.indexOf('\n', i); blank(i, end < 0 ? value.length : end); i = end < 0 ? value.length : end; continue; }
    if (value.startsWith('/*', i)) { const start = i; let depth = 1; i += 2; while (i < value.length && depth) { if (value.startsWith('/*', i)) { depth++; i += 2; } else if (value.startsWith('*/', i)) { depth--; i += 2; } else i++; } blank(start, i); continue; }
    const raw = value.slice(i).match(/^(?:br|r)(#+)?"/);
    if (raw) { const start = i, ending = `"${raw[1] || ''}`, end = value.indexOf(ending, i + raw[0].length); i = end < 0 ? value.length : end + ending.length; blank(start, i); continue; }
    if (value[i] === '"') { const start = i++; while (i < value.length) { if (value[i] === '\\') i += 2; else if (value[i++] === '"') break; } blank(start, i); continue; }
    const char = value.slice(i).match(/^'(?:\\(?:u\{[\da-f]+\}|x[\da-f]{2}|.)|[^'\r\n])'/i);
    if (char) { blank(i, i + char[0].length); i += char[0].length; continue; }
    i++;
  }
  return output.join('');
}

const masked = maskRust(source), methods = [];
const declaration = /\b(?:(pub)\s+)?(?:(async)\s+)?fn\s+([a-zA-Z_][a-zA-Z_0-9]*)\s*(?:<[^;{}]*>)?\s*\(/g;
for (const match of masked.matchAll(declaration)) {
  const start = masked.indexOf('{', match.index + match[0].length);
  if (start < 0) continue;
  let depth = 1, end = start + 1;
  while (end < masked.length && depth) { if (masked[end] === '{') depth++; else if (masked[end] === '}') depth--; end++; }
  const body = source.slice(start, end);
  const strings = [...body.matchAll(/"(?:\\.|[^"\\])*"/g)].map(item => item[0].slice(1, -1));
  const endpoints = [...new Set(strings.flatMap(value => {
    if (/^\/v\d+\//.test(value)) return [value.split('?')[0]];
    if (/^https?:\/\/(?:api|www|m|account)\.coolapk\.com\//.test(value)) return [value.replace(/^https?:\/\/api\.coolapk\.com/, '').split('?')[0]];
    return [];
  }))];
  const descriptors = [...new Set(strings.filter(value => /^(?:#?\/(?:page\?|topic\/|feed\/|product\/|goods\/)|V\d+_|(?:V|HOME|DISCOVER)_)/.test(value)))];
  methods.push({
    name: match[3], publicAsync: !!match[1] && !!match[2],
    line: source.slice(0, match.index).split('\n').length,
    endpoints, descriptors,
    calls: [...body.matchAll(/(?:self\s*\.\s*|Self::)([a-zA-Z_][a-zA-Z_0-9]*)\s*(?:<[^>]*>)?\s*\(/g)].map(item => item[1]),
  });
}
const publicAsyncFunctionCount = methods.filter(method => method.publicAsync).length;
if (publicAsyncFunctionCount !== 251) throw new Error(`Reference changed: expected 251 public async functions; found ${publicAsyncFunctionCount}. Review before updating the baseline.`);
writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 1, repository: 'daimiaopeng/coolapk-desktop', license: 'MIT', source: 'src-tauri/src/coolapk/client.rs', sha256: hash, publicAsyncFunctionCount, methods }, null, 2)}\n`);
console.log(JSON.stringify({ output: 'research/reference-client-baseline.json', sha256: hash, methods: methods.length, publicAsyncFunctionCount }));
