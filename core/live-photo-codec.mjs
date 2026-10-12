const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
const codecs = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v', 'encv']);
const readAscii = (bytes, offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
const readType = (bytes, offset) => String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

function scanBoxes(bytes, start, end, depth, found) {
  if (depth > 8) return;
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false), type = readType(bytes, offset);
    let size = size32, headerSize = 8;
    if (size32 === 1) {
      if (offset + 16 > end) return;
      const large = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 8).getBigUint64(0, false);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(large); headerSize = 16;
    } else if (size32 === 0) size = end - offset;
    if (size < headerSize || offset + size > end) return;
    const payload = offset + headerSize, boxEnd = offset + size;
    if (type === 'ftyp' && size >= headerSize + 8 && !found.brand) found.brand = readAscii(bytes, payload);
    if (type === 'stsd' && size >= headerSize + 8) {
      const count = new DataView(bytes.buffer, bytes.byteOffset + payload + 4, 4).getUint32(0, false);
      let sample = payload + 8;
      for (let index = 0; index < Math.min(count, 32) && sample + 8 <= boxEnd; index++) {
        const sampleSize = new DataView(bytes.buffer, bytes.byteOffset + sample, 4).getUint32(0, false), sampleType = readType(bytes, sample);
        if (sampleSize < 8 || sample + sampleSize > boxEnd) break;
        if (codecs.has(sampleType)) found.codecs.add(sampleType);
        sample += sampleSize;
      }
    } else if (containers.has(type)) scanBoxes(bytes, payload, boxEnd, depth + 1, found);
    offset = boxEnd;
  }
}

export function inspectLivePhotoHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > 256 * 1024) throw new TypeError('Live Photo header must be a Uint8Array no larger than 256 KiB');
  const found = { brand: '', codecs: new Set() };
  scanBoxes(bytes, 0, bytes.length, 0, found);
  const brand = found.brand;
  return {
    container: brand === 'qt  ' ? 'QuickTime/MOV' : brand ? 'MP4' : '未知容器',
    brand: brand.trim() || null,
    codecs: [...found.codecs],
  };
}
