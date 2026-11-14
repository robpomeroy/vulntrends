// Tests for zip-reader.ts
//
// Creates a small in-memory zip archive using deflate and verifies
// that extractZipJsonEntries accurately parses and extracts JSON entries.

import { deflateRawSync } from 'node:zlib';
import { extractZipEntries, extractZipJsonEntries, iterateZipEntries, iterateZipJsonEntries } from './zip-reader.js';

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

// Test corruption detection: invalid central directory signature
const corruptZipBuf = Buffer.from(zipBuf);
// Corrupt the central directory signature (first 4 bytes of cdHeader at localHeader.length + compressed.length)
// Find cdOffset from EOCD
const eocdOffset = corruptZipBuf.length - 22;
const cdOffset = corruptZipBuf.readUInt32LE(eocdOffset + 16);
corruptZipBuf.writeUInt32LE(0xdeadbeef, cdOffset);

let threwCorrupt = false;
try {
  [...iterateZipEntries(corruptZipBuf)];
} catch (err) {
  threwCorrupt = true;
}
expect('corrupted central directory signature throws Error', threwCorrupt === true);

// Test truncated central directory
const truncatedZipBuf = corruptZipBuf.subarray(0, cdOffset + 10);
let threwTruncated = false;
try {
  [...iterateZipEntries(truncatedZipBuf)];
} catch (err) {
  threwTruncated = true;
}
expect('truncated central directory throws Error', threwTruncated === true);

// Test stored (uncompressed, method 0) entries
function createZipWithStoredEntry(filename, jsonContent) {
  const fileData = Buffer.from(JSON.stringify(jsonContent), 'utf8');
  const nameBuf = Buffer.from(filename, 'utf8');

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // method = stored
  localHeader.writeUInt32LE(0, 10);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(fileData.length, 18);
  localHeader.writeUInt32LE(fileData.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const cdOffset = localHeader.length + fileData.length;

  const cdHeader = Buffer.alloc(46 + nameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0, 8);
  cdHeader.writeUInt16LE(0, 10); // method = stored
  cdHeader.writeUInt32LE(0, 12);
  cdHeader.writeUInt32LE(0, 16);
  cdHeader.writeUInt32LE(fileData.length, 20);
  cdHeader.writeUInt32LE(fileData.length, 24);
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt16LE(0, 30);
  cdHeader.writeUInt16LE(0, 32);
  cdHeader.writeUInt16LE(0, 34);
  cdHeader.writeUInt16LE(0, 36);
  cdHeader.writeUInt32LE(0, 38);
  cdHeader.writeUInt32LE(localOffset, 42);
  nameBuf.copy(cdHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, fileData, cdHeader, eocd]);
}

const storedZip = createZipWithStoredEntry('stored.json', { ok: true, stored: 1 });
const storedResults = extractZipJsonEntries(storedZip);
expect('method 0 (STORED) entry is correctly extracted', storedResults.length === 1 && storedResults[0]?.stored === 1);

// Test corrupt local header signature throws
const corruptLocalZip = Buffer.from(zipBuf);
corruptLocalZip.writeUInt32LE(0xdeadbeef, 0);
let threwLocalSig = false;
try {
  [...iterateZipEntries(corruptLocalZip)];
} catch (err) {
  threwLocalSig = true;
}
expect('invalid local file header signature throws Error', threwLocalSig === true);

// Test zip bomb protection: uncompressedSize > 32 MB throws
const zipBombBuf = Buffer.from(zipBuf);
const eocdOff = zipBombBuf.length - 22;
const cdOff = zipBombBuf.readUInt32LE(eocdOff + 16);
zipBombBuf.writeUInt32LE(33 * 1024 * 1024, cdOff + 24);
let threwZipBomb = false;
try {
  [...iterateZipEntries(zipBombBuf)];
} catch (err) {
  threwZipBomb = true;
}
expect('uncompressed size exceeding 32MB limit throws Error', threwZipBomb === true);

// Test extractZipEntries helper
const extracted = extractZipEntries(zipBuf);
expect('extractZipEntries returns array of entries', extracted.length === 1 && extracted[0]?.filename === 'CVE-2026-9999.json');

// Test directory entries are skipped
const dirZip = createZipWithStoredEntry('somedir/', '');
const dirEntries = extractZipEntries(dirZip);
expect('directory entries ending with / are skipped', dirEntries.length === 0);

// Test filter callback in iterateZipEntries
const multiZip = Buffer.concat([
  createZipWithStoredEntry('item1.json', { id: 1 }).subarray(0, -22), // remove eocd to combine
]);
const filtered = extractZipEntries(zipBuf, (name) => name.includes('nonexistent'));
expect('filter callback filters out non-matching entries', filtered.length === 0);

// Test corrupt JSON in iterateZipJsonEntries is gracefully skipped
const corruptJsonZip = createZipWithStoredEntry('bad.json', 'not valid json {{{');
// Overwrite payload with raw non-JSON text
const badJsonData = Buffer.from('not valid json {{{', 'utf8');
const badLocal = Buffer.alloc(30 + 8);
badLocal.writeUInt32LE(0x04034b50, 0);
badLocal.writeUInt16LE(20, 4);
badLocal.writeUInt16LE(0, 6);
badLocal.writeUInt16LE(0, 8); // stored
badLocal.writeUInt32LE(badJsonData.length, 18);
badLocal.writeUInt32LE(badJsonData.length, 22);
badLocal.writeUInt16LE(8, 26);
Buffer.from('bad.json').copy(badLocal, 30);
const badCd = Buffer.alloc(46 + 8);
badCd.writeUInt32LE(0x02014b50, 0);
badCd.writeUInt16LE(20, 4);
badCd.writeUInt16LE(20, 6);
badCd.writeUInt16LE(0, 8);
badCd.writeUInt16LE(0, 10);
badCd.writeUInt32LE(badJsonData.length, 20);
badCd.writeUInt32LE(badJsonData.length, 24);
badCd.writeUInt16LE(8, 28);
badCd.writeUInt32LE(0, 42);
Buffer.from('bad.json').copy(badCd, 46);
const badEocd = Buffer.alloc(22);
badEocd.writeUInt32LE(0x06054b50, 0);
badEocd.writeUInt16LE(1, 8);
badEocd.writeUInt16LE(1, 10);
badEocd.writeUInt32LE(badCd.length, 12);
badEocd.writeUInt32LE(badLocal.length + badJsonData.length, 16);
const badZip = Buffer.concat([badLocal, badJsonData, badCd, badEocd]);
const badResults = [...iterateZipJsonEntries(badZip)];
expect('corrupt JSON entry is ignored and yields empty array', badResults.length === 0);

// Test missing EOCD in buffer throws
let threwNoEocd = false;
try {
  [...iterateZipEntries(Buffer.alloc(15))];
} catch (err) {
  threwNoEocd = true;
}
expect('missing EOCD throws Error', threwNoEocd === true);

// Test unsupported compression method throws
const unsupportedMethodZip = Buffer.from(storedZip);
// Find central directory method offset: localHeader.length + fileData.length + 10
const cdOffStored = storedZip.readUInt32LE(storedZip.length - 22 + 16);
unsupportedMethodZip.writeUInt16LE(9, cdOffStored + 10); // method = 9
let threwUnsupported = false;
try {
  [...iterateZipEntries(unsupportedMethodZip)];
} catch (err) {
  threwUnsupported = true;
}
expect('unsupported compression method throws Error', threwUnsupported === true);

// Test STORED method size mismatch throws
const storedMismatchZip = Buffer.from(storedZip);
storedMismatchZip.writeUInt32LE(999, cdOffStored + 20); // compressedSize = 999
let threwStoredMismatch = false;
try {
  [...iterateZipEntries(storedMismatchZip)];
} catch (err) {
  threwStoredMismatch = true;
}
expect('STORED method size mismatch throws Error', threwStoredMismatch === true);

// Test localHeaderOffset out of bounds throws
const oobLocalZip = Buffer.from(zipBuf);
const cdOffZip = zipBuf.readUInt32LE(zipBuf.length - 22 + 16);
oobLocalZip.writeUInt32LE(999999, cdOffZip + 42); // localHeaderOffset out of bounds
let threwOobLocal = false;
try {
  [...iterateZipEntries(oobLocalZip)];
} catch (err) {
  threwOobLocal = true;
}
expect('out of bounds localHeaderOffset throws Error', threwOobLocal === true);

// Test compressed data exceeds archive length throws
const oobDataZip = Buffer.from(zipBuf);
oobDataZip.writeUInt32LE(999999, cdOffZip + 20); // compressedSize out of bounds
let threwOobData = false;
try {
  [...iterateZipEntries(oobDataZip)];
} catch (err) {
  threwOobData = true;
}
expect('compressed data exceeding archive length throws Error', threwOobData === true);

// Test decompressed size mismatch throws
const decompMismatchZip = Buffer.from(zipBuf);
decompMismatchZip.writeUInt32LE(2, cdOffZip + 24); // uncompressedSize wrong
let threwDecompMismatch = false;
try {
  [...iterateZipEntries(decompMismatchZip)];
} catch (err) {
  threwDecompMismatch = true;
}
expect('decompressed size mismatch throws Error', threwDecompMismatch === true);

// Test filename extending past buffer throws
const fnOverflowZip = Buffer.from(zipBuf);
fnOverflowZip.writeUInt16LE(50000, cdOffZip + 28); // fileNameLen huge
let threwFnOverflow = false;
try {
  [...iterateZipEntries(fnOverflowZip)];
} catch (err) {
  threwFnOverflow = true;
}
expect('filename extending past archive buffer throws Error', threwFnOverflow === true);

// Test ZIP64 archive parsing with ZIP64 EOCD locator, ZIP64 EOCD record, and extra field
function createZip64WithEntry(filename, jsonContent) {
  const fileData = Buffer.from(JSON.stringify(jsonContent), 'utf8');
  const compressed = deflateRawSync(fileData);
  const nameBuf = Buffer.from(filename, 'utf8');

  // Local header
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(45, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(fileData.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const cdOffset = localHeader.length + compressed.length;

  // Central directory header with ZIP64 extra field (headerId 0x0001, 24 bytes data)
  // Extra field: headerId(2) + size(2) + uncompressedSize(8) + compressedSize(8) + localHeaderOffset(8) = 28 bytes
  const extraBuf = Buffer.alloc(28);
  extraBuf.writeUInt16LE(0x0001, 0);
  extraBuf.writeUInt16LE(24, 2);
  extraBuf.writeBigUInt64LE(BigInt(fileData.length), 4);
  extraBuf.writeBigUInt64LE(BigInt(compressed.length), 12);
  extraBuf.writeBigUInt64LE(BigInt(localOffset), 20);

  const cdHeader = Buffer.alloc(46 + nameBuf.length + extraBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(45, 4);
  cdHeader.writeUInt16LE(45, 6);
  cdHeader.writeUInt16LE(0, 8);
  cdHeader.writeUInt16LE(8, 10);
  cdHeader.writeUInt32LE(0xffffffff, 20); // compressed size in extra
  cdHeader.writeUInt32LE(0xffffffff, 24); // uncompressed size in extra
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt16LE(extraBuf.length, 30);
  cdHeader.writeUInt32LE(0xffffffff, 42); // local header offset in extra
  nameBuf.copy(cdHeader, 46);
  extraBuf.copy(cdHeader, 46 + nameBuf.length);

  const zip64EocdOffset = cdOffset + cdHeader.length;

  // ZIP64 EOCD record: 56 bytes
  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0); // signature
  zip64Eocd.writeBigUInt64LE(BigInt(44), 4); // size of remaining record
  zip64Eocd.writeUInt16LE(45, 12);
  zip64Eocd.writeUInt16LE(45, 14);
  zip64Eocd.writeBigUInt64LE(BigInt(1), 24); // entries on disk
  zip64Eocd.writeBigUInt64LE(BigInt(1), 32); // total entries
  zip64Eocd.writeBigUInt64LE(BigInt(cdHeader.length), 40); // cd size
  zip64Eocd.writeBigUInt64LE(BigInt(cdOffset), 48); // cd offset

  // ZIP64 EOCD locator: 20 bytes
  const zip64Locator = Buffer.alloc(20);
  zip64Locator.writeUInt32LE(0x07064b50, 0); // signature
  zip64Locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8); // relative offset of zip64 eocd
  zip64Locator.writeUInt32LE(1, 16); // total disks

  // Standard EOCD: 22 bytes
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8);
  eocd.writeUInt16LE(0xffff, 10);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([localHeader, compressed, cdHeader, zip64Eocd, zip64Locator, eocd]);
}

const zip64Buf = createZip64WithEntry('zip64-test.json', { zip64: true });
const zip64Results = extractZipJsonEntries(zip64Buf);
expect('ZIP64 archive with locator and extra field parses correctly', zip64Results.length === 1 && zip64Results[0]?.zip64 === true);

console.log(
  `\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`,
);
if (failed > 0) process.exit(1);
