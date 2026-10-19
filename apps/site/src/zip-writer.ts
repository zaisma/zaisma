import { crc32 } from "node:zlib";

/**
 * A .zip written while it's sent, for "Export everything" (game-export.ts): files are stored as they
 * are (no compression), each followed by a data descriptor with its CRC-32 and size, so nothing is
 * held in memory but the central directory. Zip64 records go in where a size, an offset or the file
 * count needs them, the way Go's archive/zip writes them, so a game of several gigabytes and a file
 * of any size still open everywhere.
 */

/** One file in the zip: its path inside it and its bytes, whole or as a stream of unknown length. */
export interface ZipSource {
  path: string;
  bytes: Uint8Array | ReadableStream<Uint8Array>;
  modifiedAtMs: number;
}

const LARGEST_32_BIT_NUMBER = 0xffffffff;
const LARGEST_16_BIT_NUMBER = 0xffff;
/** Bit 3: sizes and CRC come after the data; bit 11: the path is UTF-8. */
const FLAGS_CODE = 0x0808;
const PLAIN_VERSION_NUMBER = 20;
const ZIP64_VERSION_NUMBER = 45;
/** Made on Unix, so the external attributes hold a file mode. */
const UNIX_MADE_BY_CODE = 3 << 8;
/** rw-r--r--, a regular file. */
const FILE_MODE_CODE = 0o100644;

const encoder = new TextEncoder();

/** The zip of these files, a chunk at a time, as the reader asks for more. */
export function zipStream(sources: AsyncIterable<ZipSource>): ReadableStream<Uint8Array> {
  const chunks = zipChunks(sources);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

async function* zipChunks(sources: AsyncIterable<ZipSource>): AsyncGenerator<Uint8Array> {
  const directory: Uint8Array[] = [];
  let atByte = 0;
  for await (const source of sources) {
    const name = encoder.encode(source.path);
    const [dosTimeCode, dosDateCode] = dosTimeAndDate(source.modifiedAtMs);
    const headerAtByte = atByte;
    const header = localHeader(name, dosTimeCode, dosDateCode);
    yield header;
    atByte += header.length;
    let crcCode = 0;
    let sizeBytes = 0;
    if (source.bytes instanceof Uint8Array) {
      crcCode = crc32(source.bytes);
      sizeBytes = source.bytes.length;
      if (sizeBytes) yield source.bytes;
    } else {
      const reader = source.bytes.getReader();
      for (;;) {
        const { value: chunk, done: isDone } = await reader.read();
        if (isDone) break;
        if (!chunk.length) continue;
        crcCode = crc32(chunk, crcCode);
        sizeBytes += chunk.length;
        yield chunk;
      }
    }
    atByte += sizeBytes;
    const descriptor = dataDescriptor(crcCode, sizeBytes);
    yield descriptor;
    atByte += descriptor.length;
    directory.push(directoryRecord(name, dosTimeCode, dosDateCode, crcCode, sizeBytes, headerAtByte));
  }

  const directoryAtByte = atByte;
  let directorySizeBytes = 0;
  // Sent in batches, so a big directory isn't thousands of tiny chunks.
  for (let i = 0; i < directory.length; i += 256) {
    const batch = concat(directory.slice(i, i + 256));
    yield batch;
    directorySizeBytes += batch.length;
  }
  atByte += directorySizeBytes;
  yield directoryEnd(directory.length, directorySizeBytes, directoryAtByte, atByte);
}

function localHeader(name: Uint8Array, dosTimeCode: number, dosDateCode: number): Uint8Array {
  const bytes = new Uint8Array(30 + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, PLAIN_VERSION_NUMBER, true);
  view.setUint16(6, FLAGS_CODE, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTimeCode, true);
  view.setUint16(12, dosDateCode, true);
  // CRC and sizes are 0 here: the data descriptor after the file has them.
  view.setUint16(26, name.length, true);
  bytes.set(name, 30);
  return bytes;
}

function dataDescriptor(crcCode: number, sizeBytes: number): Uint8Array {
  const isZip64 = sizeBytes >= LARGEST_32_BIT_NUMBER;
  const bytes = new Uint8Array(isZip64 ? 24 : 16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, crcCode, true);
  if (isZip64) {
    view.setBigUint64(8, BigInt(sizeBytes), true);
    view.setBigUint64(16, BigInt(sizeBytes), true);
  } else {
    view.setUint32(8, sizeBytes, true);
    view.setUint32(12, sizeBytes, true);
  }
  return bytes;
}

function directoryRecord(name: Uint8Array, dosTimeCode: number, dosDateCode: number, crcCode: number, sizeBytes: number, headerAtByte: number): Uint8Array {
  const isBig = sizeBytes >= LARGEST_32_BIT_NUMBER;
  const isFar = headerAtByte >= LARGEST_32_BIT_NUMBER;
  const extraSizeBytes = isBig || isFar ? 4 + (isBig ? 16 : 0) + (isFar ? 8 : 0) : 0;
  const bytes = new Uint8Array(46 + name.length + extraSizeBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, UNIX_MADE_BY_CODE | ZIP64_VERSION_NUMBER, true);
  view.setUint16(6, extraSizeBytes ? ZIP64_VERSION_NUMBER : PLAIN_VERSION_NUMBER, true);
  view.setUint16(8, FLAGS_CODE, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTimeCode, true);
  view.setUint16(14, dosDateCode, true);
  view.setUint32(16, crcCode, true);
  view.setUint32(20, isBig ? LARGEST_32_BIT_NUMBER : sizeBytes, true);
  view.setUint32(24, isBig ? LARGEST_32_BIT_NUMBER : sizeBytes, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, extraSizeBytes, true);
  view.setUint32(38, FILE_MODE_CODE * 0x10000, true);
  view.setUint32(42, isFar ? LARGEST_32_BIT_NUMBER : headerAtByte, true);
  bytes.set(name, 46);
  if (extraSizeBytes) {
    let atByte = 46 + name.length;
    view.setUint16(atByte, 0x0001, true);
    view.setUint16(atByte + 2, extraSizeBytes - 4, true);
    atByte += 4;
    if (isBig) {
      view.setBigUint64(atByte, BigInt(sizeBytes), true);
      view.setBigUint64(atByte + 8, BigInt(sizeBytes), true);
      atByte += 16;
    }
    if (isFar) view.setBigUint64(atByte, BigInt(headerAtByte), true);
  }
  return bytes;
}

/** The end of central directory record, after the zip64 one and its locator when the count, size or offset needs them. */
function directoryEnd(fileCount: number, directorySizeBytes: number, directoryAtByte: number, zip64EndAtByte: number): Uint8Array {
  const isZip64 = fileCount >= LARGEST_16_BIT_NUMBER || directorySizeBytes >= LARGEST_32_BIT_NUMBER || directoryAtByte >= LARGEST_32_BIT_NUMBER;
  const bytes = new Uint8Array((isZip64 ? 56 + 20 : 0) + 22);
  const view = new DataView(bytes.buffer);
  let atByte = 0;
  if (isZip64) {
    view.setUint32(0, 0x06064b50, true);
    view.setBigUint64(4, 44n, true);
    view.setUint16(12, UNIX_MADE_BY_CODE | ZIP64_VERSION_NUMBER, true);
    view.setUint16(14, ZIP64_VERSION_NUMBER, true);
    view.setBigUint64(24, BigInt(fileCount), true);
    view.setBigUint64(32, BigInt(fileCount), true);
    view.setBigUint64(40, BigInt(directorySizeBytes), true);
    view.setBigUint64(48, BigInt(directoryAtByte), true);
    view.setUint32(56, 0x07064b50, true);
    view.setBigUint64(64, BigInt(zip64EndAtByte), true);
    view.setUint32(72, 1, true);
    atByte = 76;
  }
  view.setUint32(atByte, 0x06054b50, true);
  view.setUint16(atByte + 8, Math.min(fileCount, LARGEST_16_BIT_NUMBER), true);
  view.setUint16(atByte + 10, Math.min(fileCount, LARGEST_16_BIT_NUMBER), true);
  view.setUint32(atByte + 12, Math.min(directorySizeBytes, LARGEST_32_BIT_NUMBER), true);
  view.setUint32(atByte + 16, Math.min(directoryAtByte, LARGEST_32_BIT_NUMBER), true);
  return bytes;
}

/** MS-DOS time and date, in UTC, as zips keep them (to two seconds, from 1980). */
function dosTimeAndDate(atMs: number): [number, number] {
  const date = new Date(Math.max(atMs, Date.UTC(1980, 0, 1)));
  const dosTimeCode = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const dosDateCode = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return [dosTimeCode, dosDateCode];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((totalSizeBytes, part) => totalSizeBytes + part.length, 0));
  let atByte = 0;
  for (const part of parts) {
    bytes.set(part, atByte);
    atByte += part.length;
  }
  return bytes;
}
