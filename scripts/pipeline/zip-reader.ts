/**
 * Lightweight ZIP archive extractor for OSV bulk data.
 *
 * Reads ZIP archives directly from a Buffer using Node's native `node:zlib`
 * (`inflateRawSync`) without any third-party dependencies.
 * Supports both standard ZIP and ZIP64 formats.
 */

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  filename: string;
  data: Buffer;
}

/** Maximum allowed uncompressed size per file entry (32 MB) to prevent zip-bomb DoS. */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

export function* iterateZipEntries(
  buffer: Buffer,
  filter?: (filename: string) => boolean,
): Generator<ZipEntry> {
  // Find End of Central Directory (EOCD) signature: 0x06054b50
  // Search from the end backwards (comments can be up to 65535 bytes)
  let eocdOffset = -1;
  const maxSearch = Math.min(buffer.length, 65535 + 22);
  for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP file: End of Central Directory record not found');
  }

  let totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  // Check for ZIP64 EOCD locator (20 bytes immediately preceding standard EOCD)
  if (eocdOffset >= 20 && buffer.readUInt32LE(eocdOffset - 20) === 0x07064b50) {
    const zip64EocdOffset = Number(buffer.readBigUInt64LE(eocdOffset - 20 + 8));
    if (zip64EocdOffset >= 0 && zip64EocdOffset + 56 <= buffer.length) {
      if (buffer.readUInt32LE(zip64EocdOffset) === 0x06064b50) {
        totalEntries = Number(buffer.readBigUInt64LE(zip64EocdOffset + 32));
        cdOffset = Number(buffer.readBigUInt64LE(zip64EocdOffset + 48));
      }
    }
  }

  let curOffset = cdOffset;
  let entriesParsed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (curOffset + 46 > buffer.length) {
      throw new Error(
        `Invalid ZIP file: truncated central directory header at offset ${curOffset} (entry ${i + 1}/${totalEntries})`,
      );
    }

    const sig = buffer.readUInt32LE(curOffset);
    if (sig !== 0x02014b50) {
      throw new Error(
        `Invalid ZIP file: expected central directory signature 0x02014b50 at offset ${curOffset}, found 0x${sig.toString(16)}`,
      );
    }
    entriesParsed++;

    const method = buffer.readUInt16LE(curOffset + 10);
    let compressedSize = buffer.readUInt32LE(curOffset + 20);
    let uncompressedSize = buffer.readUInt32LE(curOffset + 24);
    const fileNameLen = buffer.readUInt16LE(curOffset + 28);
    const extraLen = buffer.readUInt16LE(curOffset + 30);
    const commentLen = buffer.readUInt16LE(curOffset + 32);
    let localHeaderOffset = buffer.readUInt32LE(curOffset + 42);

    if (curOffset + 46 + fileNameLen > buffer.length) {
      throw new Error(
        `Invalid ZIP file: filename extends past archive buffer at offset ${curOffset}`,
      );
    }

    const filename = buffer.toString(
      'utf8',
      curOffset + 46,
      curOffset + 46 + fileNameLen,
    );

    // Read ZIP64 extra field if needed
    if (extraLen > 0) {
      let extraPos = curOffset + 46 + fileNameLen;
      const extraEnd = Math.min(buffer.length, extraPos + extraLen);
      while (extraPos + 4 <= extraEnd) {
        const headerId = buffer.readUInt16LE(extraPos);
        const dataSize = buffer.readUInt16LE(extraPos + 2);
        if (headerId === 0x0001) {
          // ZIP64 extended information extra field
          let offsetField = extraPos + 4;
          if (uncompressedSize === 0xffffffff && offsetField + 8 <= extraEnd) {
            uncompressedSize = Number(buffer.readBigUInt64LE(offsetField));
            offsetField += 8;
          }
          if (compressedSize === 0xffffffff && offsetField + 8 <= extraEnd) {
            compressedSize = Number(buffer.readBigUInt64LE(offsetField));
            offsetField += 8;
          }
          if (localHeaderOffset === 0xffffffff && offsetField + 8 <= extraEnd) {
            localHeaderOffset = Number(buffer.readBigUInt64LE(offsetField));
            offsetField += 8;
          }
          break;
        }
        extraPos += 4 + dataSize;
      }
    }

    curOffset += 46 + fileNameLen + extraLen + commentLen;

    // Skip directories and entries not matching filter
    if (filename.endsWith('/') || (filter && !filter(filename))) {
      continue;
    }

    // Protect against zip bombs: reject entries whose declared uncompressed size exceeds limit
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error(
        `Invalid ZIP file: entry ${filename} uncompressed size ${uncompressedSize} exceeds ${MAX_ENTRY_BYTES} bytes limit`,
      );
    }

    // Verify local header offset and signature
    if (localHeaderOffset < 0 || localHeaderOffset + 30 > buffer.length) {
      throw new Error(
        `Invalid ZIP file: local header offset ${localHeaderOffset} out of bounds for ${filename}`,
      );
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(
        `Invalid ZIP file: corrupted local header signature 0x${buffer.readUInt32LE(localHeaderOffset).toString(16)} for ${filename}`,
      );
    }

    const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

    if (dataStart + compressedSize > buffer.length) {
      throw new Error(
        `Invalid ZIP file: compressed data for ${filename} exceeds archive length (${dataStart + compressedSize} > ${buffer.length})`,
      );
    }

    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    let decompressed: Buffer;
    if (method === 0) {
      if (compressedSize !== uncompressedSize) {
        throw new Error(
          `Invalid ZIP file: STORED method size mismatch for ${filename} (${compressedSize} vs ${uncompressedSize})`,
        );
      }
      decompressed = Buffer.from(compressedData);
    } else if (method === 8) {
      decompressed = inflateRawSync(compressedData, { maxOutputLength: MAX_ENTRY_BYTES });
    } else {
      throw new Error(`Invalid ZIP file: unsupported compression method ${method} for ${filename}`);
    }

    if (decompressed.length !== uncompressedSize) {
      throw new Error(
        `Invalid ZIP file: decompressed size mismatch for ${filename} (${decompressed.length} vs expected ${uncompressedSize})`,
      );
    }

    yield {
      filename,
      data: decompressed,
    };
  }

  if (entriesParsed !== totalEntries) {
    throw new Error(
      `Invalid ZIP file: expected ${totalEntries} central directory entries, but only parsed ${entriesParsed}`,
    );
  }
}

export function extractZipEntries(
  buffer: Buffer,
  filter?: (filename: string) => boolean,
): ZipEntry[] {
  return [...iterateZipEntries(buffer, filter)];
}

export function* iterateZipJsonEntries<T>(
  buffer: Buffer,
  filter?: (filename: string) => boolean,
): Generator<T> {
  for (const entry of iterateZipEntries(buffer, (name) => {
    if (!name.endsWith('.json')) return false;
    return filter ? filter(name) : true;
  })) {
    try {
      const parsed = JSON.parse(entry.data.toString('utf8')) as T;
      yield parsed;
    } catch {
      // Ignore corrupted individual JSON files in upstream archives
    }
  }
}

export function extractZipJsonEntries<T>(
  buffer: Buffer,
  filter?: (filename: string) => boolean,
): T[] {
  return [...iterateZipJsonEntries<T>(buffer, filter)];
}
