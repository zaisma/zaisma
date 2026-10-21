/** Small PNGs for tests, written as Cloudflare Images and browsers write them: 8-bit RGB, filters mixed. */

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** A PNG of RGB rows, each row with the filter given (1, sub, for every other row, to check unfiltering). */
export async function png(widthPx: number, heightPx: number, colorAt: (x: number, y: number) => [number, number, number]): Promise<Uint8Array> {
  const raw = new Uint8Array((widthPx * 3 + 1) * heightPx);
  for (let y = 0; y < heightPx; y++) {
    const filter = y % 2, start = y * (widthPx * 3 + 1);
    raw[start] = filter;
    for (let x = 0; x < widthPx; x++) {
      const color = colorAt(x, y), left = filter && x ? colorAt(x - 1, y) : [0, 0, 0];
      for (let channel = 0; channel < 3; channel++) raw[start + 1 + x * 3 + channel] = (color[channel]! - left[channel]! + 256) & 255;
    }
  }
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, widthPx); view.setUint32(4, heightPx); header[8] = 8; header[9] = 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
