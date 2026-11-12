// Tests for zip-reader.ts
//
// Creates a small in-memory zip archive using deflate and verifies
// that extractZipJsonEntries accurately parses and extracts JSON entries.

import { deflateRawSync } from 'node:zlib';
import { extractZipJsonEntries, iterateZipEntries, iterateZipJsonEntries } from './zip-reader.js';

let passed = 0;
let failed = 0;
function expect(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n── zip-reader in-memory test ──');

// Helper to construct a minimal valid ZIP file Buffer with one entry
function createZipWithEntry(filename, jsonContent) {
  const fileData = Buffer.from(JSON.stringify(jsonContent), 'utf8');
  const compressed = deflateRawSync(fileData);
  const nameBuf = Buffer.from(filename, 'utf8');

  // Local file header: 30 bytes + nameBuf.length
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // method = deflate
  localHeader.writeUInt32LE(0, 10); // time/date
  localHeader.writeUInt32LE(0, 14); // crc32 (not checked by our reader)
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(fileData.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra len
  nameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const cdOffset = localHeader.length + compressed.length;

  // Central directory header: 46 bytes + nameBuf.length
  const cdHeader = Buffer.alloc(46 + nameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0); // signature
  cdHeader.writeUInt16LE(20, 4); // version made by
  cdHeader.writeUInt16LE(20, 6); // version needed
  cdHeader.writeUInt16LE(0, 8); // flags
  cdHeader.writeUInt16LE(8, 10); // method = deflate
  cdHeader.writeUInt32LE(0, 12); // time/date
  cdHeader.writeUInt32LE(0, 16); // crc32
  cdHeader.writeUInt32LE(compressed.length, 20);
  cdHeader.writeUInt32LE(fileData.length, 24);
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt16LE(0, 30); // extra len
  cdHeader.writeUInt16LE(0, 32); // comment len
  cdHeader.writeUInt16LE(0, 34); // disk start
  cdHeader.writeUInt16LE(0, 36); // internal attr
  cdHeader.writeUInt32LE(0, 38); // external attr
  cdHeader.writeUInt32LE(localOffset, 42); // relative offset of local header
  nameBuf.copy(cdHeader, 46);

  // EOCD: 22 bytes
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // cd disk
  eocd.writeUInt16LE(1, 8); // disk entries
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(cdHeader.length, 12); // cd size
  eocd.writeUInt32LE(cdOffset, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([localHeader, compressed, cdHeader, eocd]);
}

const testObj = { id: 'CVE-2026-9999', title: 'Test ZIP extracted' };
const zipBuf = createZipWithEntry('CVE-2026-9999.json', testObj);

const results = extractZipJsonEntries(zipBuf);
expect('extracts 1 entry', results.length === 1);
expect('content matches original JSON', results[0]?.id === 'CVE-2026-9999');

// Test generator streaming
const streamedEntries = [...iterateZipEntries(zipBuf)];
expect('iterateZipEntries streams 1 entry', streamedEntries.length === 1);
expect('streamed entry filename matches', streamedEntries[0]?.filename === 'CVE-2026-9999.json');

const streamedJson = [...iterateZipJsonEntries(zipBuf)];
expect('iterateZipJsonEntries streams 1 JSON object', streamedJson.length === 1);
expect('streamed JSON content matches', streamedJson[0]?.id === 'CVE-2026-9999');

console.log(
  `\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`,
);
if (failed > 0) process.exit(1);
