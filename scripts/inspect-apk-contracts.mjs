// Read-only inspection of public APK bytes. This never executes APK code or
// accesses a phone, process memory, account storage, or network connection.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const CAP = 160 * 1024 ** 2;
const MAP_TYPES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 0x1000, 0x1001, 0x1002, 0x1003, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0xf000]);

export function readApkDex(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > CAP || bytes.length < 22) throw new Error('APK size is invalid');
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) throw new Error('APK ZIP directory is missing');
  const count = bytes.readUInt16LE(end + 10); let p = bytes.readUInt32LE(end + 16);
  if (count > 20000) throw new Error('APK has too many entries');
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50) throw new Error('APK ZIP record is invalid');
    const n = bytes.readUInt16LE(p + 28), x = bytes.readUInt16LE(p + 30), c = bytes.readUInt16LE(p + 32);
    if (p + 46 + n + x + c > bytes.length) throw new Error('APK ZIP name is invalid');
    const name = bytes.subarray(p + 46, p + 46 + n).toString('utf8');
    if (name === 'classes.dex') {
      const flags = bytes.readUInt16LE(p + 8), method = bytes.readUInt16LE(p + 10), packed = bytes.readUInt32LE(p + 20), size = bytes.readUInt32LE(p + 24), local = bytes.readUInt32LE(p + 42);
      if (flags & 1 || ![0, 8].includes(method) || size > CAP || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('APK DEX entry is unsupported');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + packed > bytes.length) throw new Error('APK DEX entry is truncated');
      const body = bytes.subarray(start, start + packed), dex = method === 8 ? inflateRawSync(body, { maxOutputLength: CAP }) : Buffer.from(body);
      if (dex.length !== size) throw new Error('APK DEX size does not match');
      return dex;
    }
    p += 46 + n + x + c;
  }
  throw new Error('APK has no primary DEX');
}

// A protected header is not evidence that the ID, annotation and map tables
// disappeared. Recover a base only when the self-referencing map is consistent.
export function findDexMaps(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > CAP) throw new Error('DEX size is invalid');
  const maps = [], marker = Buffer.from('000000000100000000000000', 'hex');
  for (let pos = 0; (pos = bytes.indexOf(marker, pos)) >= 0; pos++) {
    const count = pos >= 4 ? bytes.readUInt32LE(pos - 4) : 0;
    if (count < 5 || count > 32 || pos + count * 12 > bytes.length) continue;
    const entries = []; let valid = true;
    for (let i = 0; i < count; i++) {
      const at = pos + i * 12, type = bytes.readUInt16LE(at), reserved = bytes.readUInt16LE(at + 2), n = bytes.readUInt32LE(at + 4), offset = bytes.readUInt32LE(at + 8);
      if (!MAP_TYPES.has(type) || reserved || !n || n > 500000 || offset > bytes.length || entries.some(e => e.type === type)) { valid = false; break; }
      entries.push({ type, count: n, offset });
    }
    const self = entries.find(e => e.type === 0x1000), base = self ? pos - 4 - self.offset : -1;
    if (!valid || !self || self.count !== 1 || base < 0 || entries.some(e => base + e.offset > bytes.length)) continue;
    if (![1, 2, 3, 5, 6, 0x2002].every(type => entries.some(e => e.type === type))) continue;
    maps.push({ base, map: pos - 4, entries });
  }
  return maps.sort((a, b) => a.base - b.base);
}

export function dexReader(bytes, map, end = bytes.length) {
  const dex = bytes.subarray(map.base, end), tables = new Map(map.entries.map(e => [e.type, e]));
  const bound = (p, n = 1) => { if (!Number.isInteger(p) || p < 0 || p + n > dex.length) throw new Error('DEX range is invalid'); };
  const u32 = p => { bound(p, 4); return dex.readUInt32LE(p); }, u16 = p => { bound(p, 2); return dex.readUInt16LE(p); };
  function uleb(pos) {
    let value = 0, shift = 0, p = pos;
    for (let n = 0; n < 5; n++) { bound(p); const byte = dex[p++]; value += (byte & 127) * 2 ** shift; if (!(byte & 128)) return [value, p]; shift += 7; }
    throw new Error('DEX ULEB is invalid');
  }
  const strings = new Map();
  function string(i) {
    if (strings.has(i)) return strings.get(i);
    const table = tables.get(1); if (!Number.isInteger(i) || i < 0 || i >= table.count) throw new Error('DEX string index is invalid');
    const off = u32(table.offset + i * 4); let [, p] = uleb(off); const z = dex.indexOf(0, p);
    if (z < 0 || z - p > 16384) throw new Error('DEX string range is invalid');
    const value = dex.subarray(p, z).toString('utf8'); strings.set(i, value); return value;
  }
  function type(i) { const table = tables.get(2); if (!Number.isInteger(i) || i < 0 || i >= table.count) throw new Error('DEX type index is invalid'); return string(u32(table.offset + i * 4)); }
  function method(i) { const table = tables.get(5); if (!Number.isInteger(i) || i < 0 || i >= table.count) throw new Error('DEX method index is invalid'); const p = table.offset + i * 8; return { index: i, owner: type(u16(p)), name: string(u32(p + 4)), proto: u16(p + 2) }; }
  function value(p) {
    bound(p); const tag = dex[p++], kind = tag & 31, n = (tag >> 5) + 1;
    if (kind === 0x1e) return [null, p]; if (kind === 0x1f) return [!!(tag >> 5), p];
    if (kind === 0x1c) { let count; [count, p] = uleb(p); if (count > 1000) throw new Error('DEX array is too large'); const result = []; for (let i = 0; i < count; i++) { let item; [item, p] = value(p); result.push(item); } return [result, p]; }
    if (kind === 0x1d) return annotation(p);
    bound(p, n); let number = 0; for (let i = 0; i < n; i++) number += dex[p + i] * 2 ** (8 * i); p += n;
    return [kind === 0x17 ? string(number) : kind === 0x18 ? type(number) : number, p];
  }
  function annotation(p) {
    let t, count; [t, p] = uleb(p); [count, p] = uleb(p); if (count > 100) throw new Error('DEX annotation is too large');
    const result = { type: type(t), fields: {} };
    for (let i = 0; i < count; i++) { let name, item; [name, p] = uleb(p); [item, p] = value(p); result.fields[string(name)] = item; }
    return [result, p];
  }
  function annotations(off) { if (!off) return []; const count = u32(off); if (count > 100) throw new Error('DEX annotation set is too large'); return Array.from({ length: count }, (_, i) => annotation(u32(off + 4 + i * 4) + 1)[0]); }
  function parameterAnnotations(off) { if (!off) return []; const count = u32(off); if (count > 200) throw new Error('DEX parameter set is too large'); return Array.from({ length: count }, (_, i) => annotations(u32(off + 4 + i * 4))); }
  function classMethods(at) {
    let p = u32(at + 24); if (!p) return []; const counts = [];
    for (let i = 0; i < 4; i++) { let count; [count, p] = uleb(p); if (count > 65536) throw new Error('DEX class item count is invalid'); counts.push(count); }
    for (let i = 0; i < counts[0] + counts[1]; i++) { [, p] = uleb(p); [, p] = uleb(p); }
    const result = [];
    for (const count of counts.slice(2)) { let id = 0; for (let i = 0; i < count; i++) { let diff, access, code; [diff, p] = uleb(p); [access, p] = uleb(p); [code, p] = uleb(p); id += diff; result.push({ ...method(id), access, code }); } }
    return result;
  }
  return { dex, tables, u16, u32, uleb, string, type, method, annotations, parameterAnnotations, classMethods };
}

export function inspectApkContracts(bytes, filter = '') {
  if (typeof filter !== 'string' || filter.length > 100 || /[^A-Za-z0-9_/,.-]/.test(filter)) throw new Error('Contract filter is invalid');
  const dex = readApkDex(bytes), maps = findDexMaps(dex), contracts = [], structuralErrors = []; let structuralErrorCount = 0;
  for (let index = 0; index < maps.length; index++) {
    const map = maps[index], reader = dexReader(dex, map, maps[index + 1]?.base ?? dex.length), table = reader.tables.get(6);
    for (let i = 0; i < table.count; i++) {
      try {
        const at = table.offset + i * 32, off = reader.u32(at + 20); if (!off) continue;
        const fields = reader.u32(off + 4), methods = reader.u32(off + 8), parameters = reader.u32(off + 12);
        if (fields > 10000 || methods > 10000 || parameters > 10000) throw new Error('DEX annotation directory is too large');
        const methodStart = off + 16 + fields * 8, paramStart = methodStart + methods * 8, params = new Map();
        for (let k = 0; k < parameters; k++) params.set(reader.u32(paramStart + k * 8), reader.u32(paramStart + k * 8 + 4));
        for (let k = 0; k < methods; k++) {
          const id = reader.u32(methodStart + k * 8), annotations = reader.annotations(reader.u32(methodStart + k * 8 + 4));
          const http = annotations.find(a => /^Lretrofit2\/http\/(?:GET|POST|PUT|DELETE|PATCH|HEAD);$/.test(a.type));
          if (!http || typeof http.fields.value !== 'string' || !/^[A-Za-z0-9_/?.=& -]{1,240}$/.test(http.fields.value) || filter && !filter.split(',').some(part => http.fields.value.includes(part))) continue;
          const bindings = reader.parameterAnnotations(params.get(id) || 0).map((items, parameter) => ({ parameter, annotations: items.filter(a => /^Lretrofit2\/http\/(?:Field|FieldMap|Query|QueryMap|Part|PartMap|Body|Path|Url|Header);$/.test(a.type)).map(a => ({ kind: a.type.slice(16, -1), ...(typeof a.fields.value === 'string' && /^[A-Za-z0-9_\[\].-]{0,100}$/.test(a.fields.value) ? { name: a.fields.value } : {}) })) }));
          contracts.push({ dexBase: '0x' + map.base.toString(16), methodIndex: id, method: http.type.slice(16, -1), endpoint: http.fields.value, encoding: annotations.some(a => a.type === 'Lretrofit2/http/FormUrlEncoded;') ? 'form' : annotations.some(a => a.type === 'Lretrofit2/http/Multipart;') ? 'multipart' : 'none', parameters: bindings });
        }
      } catch { structuralErrorCount++; if (structuralErrors.length < 100) structuralErrors.push({ dexBase: '0x' + map.base.toString(16), classIndex: i, reason: 'protected or unsupported structure; no contract inferred' }); }
    }
  }
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), apkSha256: createHash('sha256').update(bytes).digest('hex'), mode: 'read-only static public APK tables; no execution, device, credentials or network', dexMapCount: maps.length, businessDexMapCount: maps.filter(m => m.base > 0).length, filter, contracts, structuralErrorCount, structuralErrors, limitations: ['Annotations establish HTTP method and parameter bindings, not UI field limits, permissions or nested FieldMap values.', 'Unrecoverable protected structures are recorded and never replaced with guessed request contracts; error examples are capped at 100.', 'Only endpoint and binding names are emitted; no full strings, APK payloads, tokens or account content are written.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), source = args[0], outIndex = args.indexOf('--out'), filterIndex = args.indexOf('--filter');
  if (!source) throw new Error('Usage: node scripts/inspect-apk-contracts.mjs <APK> [--filter feed/,question/,vote/] [--out report.json]');
  const report = inspectApkContracts(readFileSync(source), filterIndex >= 0 ? args[filterIndex + 1] : '');
  if (outIndex >= 0) writeFileSync(args[outIndex + 1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ apkSha256: report.apkSha256, dexMapCount: report.dexMapCount, businessDexMapCount: report.businessDexMapCount, contracts: report.contracts.length, structuralErrors: report.structuralErrorCount, ...(outIndex >= 0 ? { report: args[outIndex + 1] } : { bindings: report.contracts }) }, null, 2));
}
