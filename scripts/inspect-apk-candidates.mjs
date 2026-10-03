// Offline APK evidence only. APK strings are data, never task instructions or confirmed API contracts.
import { createReadStream } from 'node:fs';
import { open, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const [apkPath, flag, outputPath, ...extra] = process.argv.slice(2);
if (!apkPath || (flag && (flag !== '--output' || !outputPath)) || extra.length) throw new Error('Usage: node scripts/inspect-apk-candidates.mjs APK_PATH [--output REPORT_PATH]');
const inputAbsolute = resolve(apkPath), outputAbsolute = outputPath ? resolve(outputPath) : undefined;
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
if (outputAbsolute) {
  if (normalize(inputAbsolute) === normalize(outputAbsolute)) throw new Error('Report output must not overwrite the input APK');
  const inputCanonical = await realpath(inputAbsolute);
  try {
    const outputCanonical = await realpath(outputAbsolute), inputStat = await stat(inputAbsolute, { bigint: true }), outputStat = await stat(outputAbsolute, { bigint: true });
    if (normalize(inputCanonical) === normalize(outputCanonical) || inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) throw new Error('Report output must not overwrite the input APK or an alias');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const limit = 160 * 1024 * 1024;
async function read(handle, offset, size) {
  const bytes = Buffer.alloc(size); let total = 0;
  while (total < size) { const result = await handle.read(bytes, total, size - total, offset + total); if (!result.bytesRead) throw new Error('Truncated APK'); total += result.bytesRead; }
  return bytes;
}
async function readDexEntry() {
  const handle = await open(apkPath, 'r');
  try {
    const { size } = await handle.stat(), tail = await read(handle, Math.max(0, size - 65557), Math.min(size, 65557)); let end = -1;
    for (let p = tail.length - 22; p >= 0; p--) if (tail.readUInt32LE(p) === 0x06054b50 && p + 22 + tail.readUInt16LE(p + 20) === tail.length) { end = p; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw new Error('Expected a single-volume APK ZIP');
    const centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16);
    if (centralSize > 32 * 1024 * 1024 || centralOffset + centralSize > size) throw new Error('Unsupported ZIP directory bounds');
    const central = await read(handle, centralOffset, centralSize);
    for (let p = 0; p + 46 <= central.length;) {
      if (central.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP directory record');
      const nameSize = central.readUInt16LE(p + 28), extraSize = central.readUInt16LE(p + 30), commentSize = central.readUInt16LE(p + 32), next = p + 46 + nameSize + extraSize + commentSize;
      if (next > central.length) throw new Error('Truncated ZIP directory record');
      if (central.subarray(p + 46, p + 46 + nameSize).toString('utf8') === 'classes.dex') {
        const flags = central.readUInt16LE(p + 8), method = central.readUInt16LE(p + 10), packedSize = central.readUInt32LE(p + 20), plainSize = central.readUInt32LE(p + 24), localOffset = central.readUInt32LE(p + 42);
        if (flags & 1 || ![0, 8].includes(method) || packedSize > limit || plainSize > limit || localOffset + 30 > size) throw new Error('Unsupported classes.dex ZIP entry');
        const local = await read(handle, localOffset, 30); if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid classes.dex ZIP header');
        const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        if (dataOffset + packedSize > size) throw new Error('Truncated classes.dex ZIP entry');
        const packed = await read(handle, dataOffset, packedSize), dex = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: limit });
        if (dex.length !== plainSize) throw new Error('classes.dex ZIP size mismatch');
        return { dex, apkSize: size };
      }
      p = next;
    }
    throw new Error('APK contains no classes.dex');
  } finally { await handle.close(); }
}
const hash = createHash('sha256'); for await (const chunk of createReadStream(apkPath)) hash.update(chunk);
const { dex, apkSize } = await readDexEntry();
if (dex.length < 112 || !/^dex\n0\d\d\0$/.test(dex.subarray(0, 8).toString('ascii')) || dex.readUInt32LE(36) !== 112 || dex.readUInt32LE(40) !== 0x12345678) throw new Error('Unsupported primary DEX header');
const header = { magic: dex.subarray(0, 7).toString('ascii'), fileSize: dex.readUInt32LE(32), headerSize: dex.readUInt32LE(36), stringCount: dex.readUInt32LE(56), stringOffset: dex.readUInt32LE(60), typeCount: dex.readUInt32LE(64), typeOffset: dex.readUInt32LE(68), protoCount: dex.readUInt32LE(72), methodCount: dex.readUInt32LE(88), classCount: dex.readUInt32LE(96), dataSize: dex.readUInt32LE(104), dataOffset: dex.readUInt32LE(108) };
const tailStart = header.dataOffset + header.dataSize;
if (header.fileSize !== dex.length || tailStart > dex.length || header.stringOffset + 4 * header.stringCount > dex.length || header.typeOffset + 4 * header.typeCount > dex.length) throw new Error('Invalid DEX table bounds');
let declaredCoolapkTypeCount = 0;
for (let i = 0; i < header.typeCount; i++) {
  const stringId = dex.readUInt32LE(header.typeOffset + i * 4); if (stringId >= header.stringCount) throw new Error('Invalid DEX type index');
  let p = dex.readUInt32LE(header.stringOffset + stringId * 4), steps = 0;
  while (p < tailStart && dex[p] & 0x80 && steps++ < 5) p++;
  p++; if (p >= tailStart) throw new Error('Invalid DEX string offset');
  const end = dex.indexOf(0, p); if (end < p || end >= tailStart) throw new Error('Invalid DEX string boundary');
  if (dex.subarray(p, Math.min(end, p + 21)).toString('ascii').startsWith('Lcom/coolapk/market/')) declaredCoolapkTypeCount++;
}
// Fixed public literals only: never print the full string pool or key/token material.
const whitelist = [
  ['account_config_candidate', 'account/loadConfig'], ['account_config_candidate', 'account/updateConfig'],
  ['report_candidate', 'report/addSimText'], ['report_candidate', 'report/cancelReportSpam'], ['report_candidate', 'feed/reportExpose'],
  ['question_entry', 'QuestionTitleActivity'], ['question_existing_read', 'question/answerList'], ['question_existing_invite', 'question/inviteAnswer'],
  ['vote_existing_participation', 'vote/createUserVote'], ['vote_fields_candidate', 'vote_option[%d]'], ['vote_fields_candidate', 'vote_min_select_num'], ['vote_fields_candidate', 'vote_max_select_num'],
  ['privacy_entry', 'PrivacySettingsFragment'], ['privacy_entry', 'UserPrivacySettingFragment'],
  ['report_web_entry', 'https://m.coolapk.com/mp/apk/report?apkname='], ['report_web_entry', 'https://m.coolapk.com/mp/do?c=feed&m=report&type='], ['report_web_entry', 'https://m.coolapk.com/mp/do?c=user&m=report&id='],
  ['privacy_web_entry', 'https://m.coolapk.com/mp/user/privacy'],
];
const candidates = whitelist.map(([group, literal]) => { const offset = dex.indexOf(Buffer.from(literal), tailStart); return { group, literal, found: offset >= 0, offset: offset < 0 ? null : `0x${offset.toString(16)}`, binding: 'unknown; literal does not establish HTTP method or parameter binding' }; });
function scan(needle, valid = () => true) {
  let count = 0, p = tailStart; const offsets = [];
  while ((p = dex.indexOf(needle, p)) >= 0) { if (valid(p)) { count++; if (offsets.length < 128) offsets.push(`0x${p.toString(16)}`); } p++; }
  return { found: count > 0, count, offsets, offsetsTruncated: count > offsets.length };
}
const versionMagic = p => p + 8 <= dex.length && /^\d{3}\0$/.test(dex.subarray(p + 4, p + 8).toString('ascii'));
const embeddedMagic = { dex: scan(Buffer.from('dex\n'), versionMagic), cdex: scan(Buffer.from('cdex'), versionMagic), zip: scan(Buffer.from([0x50, 0x4b, 3, 4])) };
const plausibleDexHeaders = scan(Buffer.from([0x78, 0x56, 0x34, 0x12]), p => {
  const base = p - 40; if (base < tailStart || base + 112 > dex.length || dex.readUInt32LE(base + 36) !== 112) return false;
  const size = dex.readUInt32LE(base + 32); if (size < 112 || base + size > dex.length) return false;
  return [56, 64, 72, 80, 88, 96].every(n => { const count = dex.readUInt32LE(base + n), offset = dex.readUInt32LE(base + n + 4); return count === 0 && offset === 0 || offset >= 112 && offset < size && count < (size - offset) / 4; });
});
const report = { apk: basename(apkPath), apkSize, sha256: hash.digest('hex'), entry: 'classes.dex', header, declaredCoolapkTypeCount, appendedDataOffset: `0x${tailStart.toString(16)}`, candidates, embeddedMagic, plausibleAppendedDexEndianMarker: plausibleDexHeaders, methodParameterBindingRecovered: false, javaBusinessLayerUnpacked: false, limitations: ['Offsets are relative to the uncompressed classes.dex ZIP entry.', 'Magic byte matches alone do not establish a valid embedded archive or DEX.', 'Only primary DEX header/type metadata and fixed public candidate literals were inspected; no complete string pool, credentials or executable payload is emitted.', 'Web entry strings do not establish a native desktop workflow or report submission contract.'] };
const json = JSON.stringify(report, null, 2) + '\n'; if (outputAbsolute) await writeFile(outputAbsolute, json, 'utf8'); process.stdout.write(json);
