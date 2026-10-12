import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLivePhotoHeader } from '../core/live-photo-codec.mjs';

const box = (type, payload) => { const value = Buffer.alloc(8 + payload.length); value.writeUInt32BE(value.length); value.write(type, 4); payload.copy(value, 8); return value; };

test('live-photo header inspection reports container and codec sample entries', () => {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isom'));
  const sample = box('avc1', Buffer.alloc(0));
  const stsdHeader = Buffer.alloc(8); stsdHeader.writeUInt32BE(1, 4);
  const stsd = box('stsd', Buffer.concat([stsdHeader, sample]));
  const stbl = box('stbl', stsd), minf = box('minf', stbl), mdia = box('mdia', minf), trak = box('trak', mdia), moov = box('moov', trak);
  assert.deepEqual(inspectLivePhotoHeader(Buffer.concat([ftyp, moov])), { container: 'MP4', brand: 'isom', codecs: ['avc1'] });
});

test('live-photo header inspection handles partial headers and rejects oversized input', () => {
  assert.deepEqual(inspectLivePhotoHeader(box('ftyp', Buffer.from('qt  \0\0\0\0qt  '))), { container: 'QuickTime/MOV', brand: 'qt', codecs: [] });
  assert.throws(() => inspectLivePhotoHeader(new Uint8Array(0)));
  assert.throws(() => inspectLivePhotoHeader(new Uint8Array(256 * 1024 + 1)));
});
