import type { DecodedPicture } from "./textures.ts";

/** A decoded picture as a PNG file, for image matching. Compressed with the platform's own deflate. */
export async function encodePng(picture: DecodedPicture): Promise<Uint8Array> {
  const { widthPixelCount, heightPixelCount, rgba } = picture;
  const rowSizeBytes = widthPixelCount * 4 + 1;
  const rows = new Uint8Array(rowSizeBytes * heightPixelCount);
  for (let rowIndex = 0; rowIndex < heightPixelCount; rowIndex++) rows.set(rgba.subarray(rowIndex * widthPixelCount * 4, (rowIndex + 1) * widthPixelCount * 4), rowIndex * rowSizeBytes + 1);
  const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, widthPixelCount);
  view.setUint32(4, heightPixelCount);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA, deflate, no filter method, not interlaced.
  const chunks = [chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(8 + chunks.reduce((totalBytes, part) => totalBytes + part.length, 0));
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let index = 8;
  for (const part of chunks) {
    png.set(part, index);
    index += part.length;
  }
  return png;
}

function chunk(type: string, contents: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(contents.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, contents.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(contents, 8);
  view.setUint32(8 + contents.length, crc32(bytes.subarray(4, 8 + contents.length)));
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let byteIndex = 0; byteIndex < 256; byteIndex++) {
    let remainderCode = byteIndex;
    for (let bitIndex = 0; bitIndex < 8; bitIndex++) remainderCode = remainderCode & 1 ? 0xedb88320 ^ (remainderCode >>> 1) : remainderCode >>> 1;
    table[byteIndex] = remainderCode >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let checksumCode = 0xffffffff;
  for (const byte of bytes) checksumCode = CRC_TABLE[(checksumCode ^ byte) & 0xff]! ^ (checksumCode >>> 8);
  return (checksumCode ^ 0xffffffff) >>> 0;
}
