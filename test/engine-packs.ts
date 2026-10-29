/** Small Unity and Godot packs built byte by byte, laid out as the engines write them, for the image-matching tests. */

const enc = (text: string) => new TextEncoder().encode(text);

/** Bytes written in order, little-endian unless asked. */
class Writer {
  readonly parts: number[] = [];

  bytes(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.parts.push(bytes[i]!);
    return this;
  }

  u8(value: number): this {
    this.parts.push(value & 255);
    return this;
  }

  u16(value: number, isBigEndian = false): this {
    const view = new DataView(new ArrayBuffer(2));
    view.setUint16(0, value, !isBigEndian);
    return this.bytes(new Uint8Array(view.buffer));
  }

  i32(value: number, isBigEndian = false): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, value, !isBigEndian);
    return this.bytes(new Uint8Array(view.buffer));
  }

  u32(value: number, isBigEndian = false): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setUint32(0, value, !isBigEndian);
    return this.bytes(new Uint8Array(view.buffer));
  }

  f32(value: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    return this.bytes(new Uint8Array(view.buffer));
  }

  u64(value: number | bigint, isBigEndian = false): this {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, BigInt(value), !isBigEndian);
    return this.bytes(new Uint8Array(view.buffer));
  }

  cString(text: string): this {
    return this.bytes(enc(text)).u8(0);
  }

  /** A Unity aligned string: its length, its bytes, then padding to 4. */
  alignedString(text: string): this {
    const bytes = enc(text);
    return this.i32(bytes.length).bytes(bytes).align(4);
  }

  align(boundary: number): this {
    while (this.parts.length % boundary) this.parts.push(0);
    return this;
  }

  get length(): number {
    return this.parts.length;
  }

  done(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

/** Unity's TextureFormat numbers used here. */
export const UNITY_FORMAT = { alpha8: 1, rgba32: 4, r16: 9, dxt1: 10, bc4: 26, dxt1Crunched: 28, dxt5Crunched: 29, eacR: 41, r8: 63, etc1Crunched: 64, etc2Rgba8Crunched: 65 } as const;

/** A Texture2D object as Unity 2020.3 writes it, its pixels inside or streamed from a resource file. */
export function texture2d(name: string, widthPixelCount: number, heightPixelCount: number, format: number, pixels: Uint8Array, options: { streamedFrom?: { path: string; offset: number }; levelCount?: number } = {}): Uint8Array {
  const writer = new Writer().alignedString(name).i32(4).u8(0).u8(0).align(4);
  writer.i32(widthPixelCount).i32(heightPixelCount).i32(pixels.length).i32(0).i32(format).i32(options.levelCount ?? 1);
  writer.u8(0).u8(0).u8(0).u8(0).align(4).i32(0).i32(1).i32(2);
  writer.i32(1).i32(1).f32(0).i32(1).i32(1).i32(1).i32(6).i32(1).i32(0);
  if (options.streamedFrom) writer.i32(0).u64(options.streamedFrom.offset).u32(pixels.length).alignedString(options.streamedFrom.path);
  else writer.i32(pixels.length).bytes(pixels).align(4).u64(0).u32(0).alignedString("");
  return writer.done();
}

/** A Sprite object pointing at a texture in the same file, showing the rectangle x, y, width, height of it. */
export function sprite(name: string, texturePathId: number, rect: [number, number, number, number]): Uint8Array {
  const writer = new Writer().alignedString(name);
  for (const value of rect) writer.f32(value);
  writer.f32(0).f32(0).f32(0).f32(0).f32(0).f32(0).f32(100).f32(0.5).f32(0.5).u32(1).u8(0).align(4);
  writer.bytes(new Uint8Array(16)).u64(7).i32(0); // Render data key, then no atlas tags.
  writer.i32(0).u64(0); // No sprite atlas.
  writer.i32(0).u64(texturePathId).i32(0).u64(0).i32(0); // Texture, alpha texture, no secondary textures.
  writer.bytes(new Uint8Array(40)); // Submeshes and vertex data.
  for (const value of rect) writer.f32(value);
  return writer.f32(0).f32(0).done();
}

/** A VideoClip object whose video is in a resource file. */
export function videoClip(name: string, resourcePath: string, offset: number, sizeBytes: number): Uint8Array {
  return new Writer().alignedString(name).alignedString(`Assets/${name}.mp4`).u32(64).u32(64).u32(64).u32(64).u32(1).u32(1).bytes(new Uint8Array(8)).u64(30).i32(0).i32(0).i32(0).i32(0).i32(0).alignedString(resourcePath).u64(offset).u64(sizeBytes).u8(0).align(4).done();
}

/** A serialized file (format 22, Unity 2020.3) holding these objects. */
export function serializedFile(objects: { classId: number; pathId: number; bytes: Uint8Array }[]): Uint8Array {
  const classIds = [...new Set(objects.map((object) => object.classId))];
  const data = new Writer();
  const placed = objects.map((object) => {
    data.align(8);
    const startIndex = data.length;
    data.bytes(object.bytes);
    return { ...object, startIndex };
  });
  const metadata = new Writer().cString("2020.3.16f1").i32(20).u8(0).i32(classIds.length);
  for (const classId of classIds) metadata.i32(classId).u8(0).u16(0xffff).bytes(new Uint8Array(16));
  metadata.i32(objects.length);
  for (const object of placed) {
    while ((48 + metadata.length) % 4) metadata.u8(0);
    metadata.u64(object.pathId).u64(object.startIndex).u32(object.bytes.length).i32(classIds.indexOf(object.classId));
  }
  metadata.i32(0).i32(0).i32(0).u8(0);
  const dataStartIndex = Math.ceil((48 + metadata.length) / 16) * 16;
  const fileSizeBytes = dataStartIndex + data.length;
  const file = new Writer().u32(0, true).u32(0, true).u32(22, true).u32(0, true).u8(0).bytes([0, 0, 0]);
  file.u32(metadata.length, true).u64(fileSizeBytes, true).u64(dataStartIndex, true).u64(0, true).bytes(metadata.done());
  while (file.length < dataStartIndex) file.u8(0);
  return file.bytes(data.done()).done();
}

/** One LZ4 block holding these bytes: literals only, the simplest valid block. */
export function lz4Literals(bytes: Uint8Array): Uint8Array {
  const writer = new Writer().u8(Math.min(bytes.length, 15) << 4);
  if (bytes.length >= 15) {
    let rest = bytes.length - 15;
    while (rest >= 255) {
      writer.u8(255);
      rest -= 255;
    }
    writer.u8(rest);
  }
  return writer.bytes(bytes).done();
}

/** A UnityFS bundle (format 7) holding these files, in blocks of blockSizeBytes, LZ4-compressed unless asked. */
export function unityBundle(files: { name: string; bytes: Uint8Array }[], options: { isCompressed?: boolean; blockSizeBytes?: number } = {}): Uint8Array {
  const isCompressed = options.isCompressed ?? true;
  const blockSizeBytes = options.blockSizeBytes ?? 4096;
  const data = new Writer();
  const nodes = files.map((file) => {
    const startIndex = data.length;
    data.bytes(file.bytes);
    return { name: file.name, startIndex, sizeBytes: file.bytes.length };
  });
  const unpacked = data.done();
  const blocks: { sizeBytes: number; packed: Uint8Array }[] = [];
  for (let index = 0; index < unpacked.length; index += blockSizeBytes) {
    const block = unpacked.subarray(index, index + blockSizeBytes);
    blocks.push({ sizeBytes: block.length, packed: isCompressed ? lz4Literals(block) : block });
  }
  const info = new Writer().bytes(new Uint8Array(16)).u32(blocks.length, true);
  for (const block of blocks) info.u32(block.sizeBytes, true).u32(block.packed.length, true).u16(isCompressed ? 2 : 0, true);
  info.u32(nodes.length, true);
  for (const node of nodes) info.u64(node.startIndex, true).u64(node.sizeBytes, true).u32(4, true).cString(node.name);
  const infoBytes = info.done();
  const bundle = new Writer().cString("UnityFS").u32(7, true).cString("5.x.x").cString("2020.3.16f1");
  const sizeIndex = bundle.length;
  bundle.u64(0, true).u32(infoBytes.length, true).u32(infoBytes.length, true).u32(0x40, true).align(16).bytes(infoBytes);
  for (const block of blocks) bundle.bytes(block.packed);
  const out = bundle.done();
  new DataView(out.buffer).setBigUint64(sizeIndex, BigInt(out.length));
  return out;
}

/** A Unity web build's .data file holding these files. */
export function unityWebData(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const headerSizeBytes = 20 + files.reduce((sum, file) => sum + 12 + enc(file.name).length, 0);
  const header = new Writer().bytes(enc("UnityWebData1.0\0")).u32(headerSizeBytes);
  let startIndex = headerSizeBytes;
  for (const file of files) {
    header.u32(startIndex).u32(file.bytes.length).u32(enc(file.name).length).bytes(enc(file.name));
    startIndex += file.bytes.length;
  }
  for (const file of files) header.bytes(file.bytes);
  return header.done();
}

/** A Godot pack holding Godot 4 (.ctex) and Godot 3 (.stex) textures between other bytes. */
export function godotPack(textures: { version: 3 | 4; widthPixelCount: number; heightPixelCount: number; format: number; pixels: Uint8Array }[]): Uint8Array {
  const pack = new Writer().bytes(enc("GDPC")).u32(2).u32(4).u32(3).u32(0).bytes(new Uint8Array(200).fill(9));
  for (const texture of textures) {
    if (texture.version === 4) {
      pack.bytes(enc("GST2")).u32(1).u32(texture.widthPixelCount).u32(texture.heightPixelCount).u32(0).i32(0).u32(0).u32(0).u32(0);
      pack.u32(0).u16(texture.widthPixelCount).u16(texture.heightPixelCount).u32(0).u32(texture.format).bytes(texture.pixels);
    } else {
      pack.bytes(enc("GDST")).u16(texture.widthPixelCount).u16(0).u16(texture.heightPixelCount).u16(0).u32(0).u32(texture.format).bytes(texture.pixels);
    }
    pack.bytes(new Uint8Array(100).fill(7));
  }
  return pack.done();
}

/** widthPixelCount by heightPixelCount of RGBA, each pixel made by color(x, y). */
export function rgbaPixels(widthPixelCount: number, heightPixelCount: number, color: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(widthPixelCount * heightPixelCount * 4);
  for (let y = 0; y < heightPixelCount; y++) for (let x = 0; x < widthPixelCount; x++) pixels.set(color(x, y), (y * widthPixelCount + x) * 4);
  return pixels;
}

/** A PNG's size and pixels (8-bit RGBA, no filters, as encodePng writes it). */
export async function readPng(png: Uint8Array): Promise<{ widthPixelCount: number; heightPixelCount: number; rgba: Uint8Array }> {
  const view = new DataView(png.buffer, png.byteOffset, png.length);
  const widthPixelCount = view.getUint32(16);
  const heightPixelCount = view.getUint32(20);
  const idatLength = view.getUint32(33);
  const compressed = png.subarray(41, 41 + idatLength);
  const rows = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const rgba = new Uint8Array(widthPixelCount * heightPixelCount * 4);
  for (let y = 0; y < heightPixelCount; y++) rgba.set(rows.subarray(y * (widthPixelCount * 4 + 1) + 1, (y + 1) * (widthPixelCount * 4 + 1)), y * widthPixelCount * 4);
  return { widthPixelCount, heightPixelCount, rgba };
}
