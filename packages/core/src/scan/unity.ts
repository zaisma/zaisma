import { sha256Hex } from "../ids.ts";
import { CRUNCH_HEADER_MAXIMUM_SIZE_BYTES, readCrunchHeader, unpackCrunchLevel, type CrunchFormat } from "./crunch.ts";
import { matroskaHasVideo, picturesInside, sniffMedia } from "./images.ts";
import { decompressLz4Block } from "./lz4.ts";
import { decompressLzma } from "./lzma.ts";
import { encodePng } from "./png.ts";
import { MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT, MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT, MINIMUM_TEXTURE_SIDE_PIXEL_COUNT, decodeTexture, textureLevels, type TextureFormat, type TextureRegion } from "./textures.ts";

/** Bytes read by range, like a stored file: a big pack is never in memory whole. */
export interface ByteSource {
  sizeBytes: number;
  read(startIndex: number, sizeBytes: number): Promise<Uint8Array>;
}

/** A picture or video found inside a game engine's pack, ready to match. */
export interface PictureFound {
  /** What it is inside the pack, like `texture "Hero"` or `video "Intro"`. */
  label: string;
  /** What's sent: image/png for a decoded texture, or the picture or video's own type. */
  type: string;
  /** Identifies what it was made from: one cleared in the last 30 days isn't sent again. */
  sha256: string;
  /** The picture or video to send, read and decoded afresh each time. */
  body(): Promise<Uint8Array>;
}

/** A compressed bundle block bigger than this isn't unpacked: it would sit in memory whole (Unity's LZ4 blocks are 128 KB; LZMA is often one block). */
export const MAXIMUM_BUNDLE_BLOCK_SIZE_BYTES = 32 * 1024 * 1024;
/** A texture level or video inside a pack bigger than this isn't read: it would sit in memory whole (a 4096-pixel DXT5 or 2048-pixel RGBA texture fits). */
export const MAXIMUM_READ_INSIDE_SIZE_BYTES = 16 * 1024 * 1024;
/** How much of a pack is read from storage at a time while searching it. */
const READ_WINDOW_SIZE_BYTES = 8 * 1024 * 1024;
/** Unpacked bundle blocks kept while searching, so reads close together unpack each block once. */
const BLOCK_CACHE_SIZE_BYTES = 32 * 1024 * 1024;

/**
 * Whether reads keep what they read for the next one. On while a pack is searched; off once it's done, so the
 * pictures waiting to be sent hold no pack's bytes and each one reads only what it needs.
 */
interface ReadCache {
  isOn: boolean;
  readonly clears: (() => void)[];
}

const TEXTURE_CLASS_NUMBER = 28;
const SPRITE_CLASS_NUMBER = 213;
const VIDEO_CLIP_CLASS_NUMBER = 329;

/** Unity's TextureFormat numbers for the formats decoded; the rest (alpha only, two channel, HDR, PVRTC) aren't; crunched ones are in UNITY_CRUNCHED_FORMATS. */
const UNITY_TEXTURE_FORMATS: Record<number, TextureFormat> = {
  2: "argb4444",
  3: "rgb8",
  4: "rgba8",
  5: "argb8",
  7: "rgb565",
  9: "r16",
  10: "bc1",
  11: "bc2",
  12: "bc3",
  13: "rgba4444",
  14: "bgra8",
  25: "bc7",
  26: "bc4",
  34: "etc1",
  41: "eac_r",
  45: "etc2_rgb",
  46: "etc2_rgba1",
  47: "etc2_rgba8",
  60: "etc1",
  61: "etc2_rgba8",
  63: "r8",
  ...Object.fromEntries([4, 5, 6, 8, 10, 12].flatMap((sidePixelCount, i) => [[48 + i, `astc_${sidePixelCount}x${sidePixelCount}`], [54 + i, `astc_${sidePixelCount}x${sidePixelCount}`]])),
};

/** Unity's crunched TextureFormat numbers, each the block format crunch unpacks it to and the crunch format its header says. */
const UNITY_CRUNCHED_FORMATS: Record<number, { format: TextureFormat; crunchFormat: CrunchFormat }> = {
  28: { format: "bc1", crunchFormat: "dxt1" },
  29: { format: "bc3", crunchFormat: "dxt5" },
  64: { format: "etc1", crunchFormat: "etc1" },
  65: { format: "etc2_rgba8", crunchFormat: "etc2a" },
};

/** Whether these first bytes start a Unity web build's .data file or an asset bundle. */
export function isUnityPack(firstBytes: Uint8Array): boolean {
  const text = latin1(firstBytes.subarray(0, 16));
  return text === "UnityWebData1.0\0" || text.startsWith("UnityFS\0");
}

/**
 * Every picture and video inside a Unity web build's .data file or an asset bundle: textures decoded from their
 * GPU formats (at most MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT on a side), the part of a sprite sheet each sprite
 * shows, video clips, and picture files stored inside compressed bundles. Anything it can't read is skipped.
 */
export async function* unityPicturesInside(source: ByteSource): AsyncGenerator<PictureFound> {
  const cache: ReadCache = { isOn: true, clears: [] };
  try {
    const files = await unityFiles(bufferedSource(source, READ_WINDOW_SIZE_BYTES, cache), cache);
    const byName = new Map<string, ByteSource>();
    for (const file of files) byName.set(baseName(file.name), file.source);
    for (const file of files) {
      const serialized = await openSerializedFile(file.source).catch(() => null);
      if (serialized) yield* serializedPictures(file.name, serialized, byName);
      else if (file.isUnpacked) yield* filePicturesInside(file.name, file.source);
    }
  } finally {
    stopCaching(cache);
  }
}

function stopCaching(cache: ReadCache): void {
  cache.isOn = false;
  for (const clear of cache.clears) clear();
}

interface UnityFile {
  name: string;
  source: ByteSource;
  /** It came out of a compressed bundle, so picture files inside it weren't visible before. */
  isUnpacked: boolean;
}

async function unityFiles(source: ByteSource, cache: ReadCache): Promise<UnityFile[]> {
  const head = await source.read(0, Math.min(source.sizeBytes, 16));
  const text = latin1(head);
  if (text.startsWith("UnityFS\0")) return bundleFiles(source, cache).catch(() => []);
  if (text !== "UnityWebData1.0\0") return [];
  const headerSizeBytes = new DataView((await source.read(16, 4)).buffer).getUint32(0, true);
  if (headerSizeBytes < 20 || headerSizeBytes > Math.min(source.sizeBytes, 16 * 1024 * 1024)) return [];
  const header = await source.read(0, headerSizeBytes);
  const view = new DataView(header.buffer, header.byteOffset, header.length);
  const files: UnityFile[] = [];
  for (let index = 20; index + 12 <= headerSizeBytes; ) {
    const startIndex = view.getUint32(index, true);
    const sizeBytes = view.getUint32(index + 4, true);
    const nameSizeBytes = view.getUint32(index + 8, true);
    const name = new TextDecoder().decode(header.subarray(index + 12, index + 12 + nameSizeBytes));
    index += 12 + nameSizeBytes;
    if (startIndex + sizeBytes > source.sizeBytes) continue;
    const entry = subSource(source, startIndex, sizeBytes);
    const entryHead = sizeBytes >= 8 ? await entry.read(0, 8) : new Uint8Array();
    if (latin1(entryHead) === "UnityFS\0") files.push(...(await bundleFiles(entry, cache).catch(() => [])));
    else files.push({ name, source: entry, isUnpacked: false });
  }
  return files;
}

/** The files inside a UnityFS bundle, each read through its blocks so only the blocks it touches are unpacked. */
async function bundleFiles(source: ByteSource, cache: ReadCache): Promise<UnityFile[]> {
  const head = await source.read(0, Math.min(source.sizeBytes, 256));
  const view = new DataView(head.buffer, head.byteOffset, head.length);
  let index = 8;
  const formatVersionNumber = view.getUint32(index);
  index += 4;
  for (let stringIndex = 0; stringIndex < 2; stringIndex++) index = head.indexOf(0, index) + 1; // Player and engine version strings.
  if (index === 0 || formatVersionNumber < 6) return [];
  index += 8; // The bundle's whole size.
  const compressedInfoSizeBytes = view.getUint32(index);
  const infoSizeBytes = view.getUint32(index + 4);
  const flagsCode = view.getUint32(index + 8);
  index += 12;
  if (formatVersionNumber >= 7) index = align(index, 16);
  const isInfoAtEnd = (flagsCode & 0x80) !== 0;
  const infoStartIndex = isInfoAtEnd ? source.sizeBytes - compressedInfoSizeBytes : index;
  if (compressedInfoSizeBytes > MAXIMUM_BUNDLE_BLOCK_SIZE_BYTES || infoSizeBytes > MAXIMUM_BUNDLE_BLOCK_SIZE_BYTES) return [];
  const blocksInfo = unpackBlock(await source.read(infoStartIndex, compressedInfoSizeBytes), infoSizeBytes, flagsCode & 0x3f);
  let dataStartIndex = isInfoAtEnd ? index : index + compressedInfoSizeBytes;
  if (flagsCode & 0x200) dataStartIndex = align(dataStartIndex, 16);
  const infoView = new DataView(blocksInfo.buffer, blocksInfo.byteOffset, blocksInfo.length);
  let infoIndex = 16; // A hash of the data.
  const blockCount = infoView.getUint32(infoIndex);
  infoIndex += 4;
  const blocks: Block[] = [];
  let startIndex = 0;
  let compressedStartIndex = dataStartIndex;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    const sizeBytes = infoView.getUint32(infoIndex);
    const compressedSizeBytes = infoView.getUint32(infoIndex + 4);
    const compressionCode = infoView.getUint16(infoIndex + 8) & 0x3f;
    infoIndex += 10;
    blocks.push({ startIndex, sizeBytes, compressedStartIndex, compressedSizeBytes, compressionCode });
    startIndex += sizeBytes;
    compressedStartIndex += compressedSizeBytes;
  }
  const unpacked = blockSource(source, blocks, cache);
  const isCompressed = blocks.some((block) => block.compressionCode !== 0);
  const nodeCount = infoView.getUint32(infoIndex);
  infoIndex += 4;
  const files: UnityFile[] = [];
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const nodeStartIndex = Number(infoView.getBigUint64(infoIndex));
    const nodeSizeBytes = Number(infoView.getBigUint64(infoIndex + 8));
    infoIndex += 20;
    const nameEndIndex = blocksInfo.indexOf(0, infoIndex);
    const name = new TextDecoder().decode(blocksInfo.subarray(infoIndex, nameEndIndex));
    infoIndex = nameEndIndex + 1;
    if (nodeStartIndex + nodeSizeBytes <= unpacked.sizeBytes) files.push({ name, source: subSource(unpacked, nodeStartIndex, nodeSizeBytes), isUnpacked: isCompressed });
  }
  return files;
}

interface Block {
  startIndex: number;
  sizeBytes: number;
  compressedStartIndex: number;
  compressedSizeBytes: number;
  compressionCode: number;
}

function unpackBlock(bytes: Uint8Array, sizeBytes: number, compressionCode: number): Uint8Array {
  if (compressionCode === 0) return bytes;
  if (sizeBytes > MAXIMUM_BUNDLE_BLOCK_SIZE_BYTES) throw new Error("Bundle block too big to unpack");
  if (compressionCode === 1) return decompressLzma(bytes, sizeBytes);
  if (compressionCode === 2 || compressionCode === 3) return decompressLz4Block(bytes, sizeBytes);
  throw new Error(`Unknown bundle compression ${compressionCode}`);
}

/** A bundle's unpacked data, unpacking only the blocks a read touches, and while searching keeping the last few. */
function blockSource(source: ByteSource, blocks: Block[], cache: ReadCache): ByteSource {
  const last = blocks[blocks.length - 1];
  const sizeBytes = last ? last.startIndex + last.sizeBytes : 0;
  const kept = new Map<Block, Uint8Array>();
  let keptSizeBytes = 0;
  cache.clears.push(() => {
    kept.clear();
    keptSizeBytes = 0;
  });
  const unpacked = async (block: Block, fromIndex: number, toIndex: number) => {
    // A stored block is read only where it's needed.
    if (block.compressionCode === 0) return { bytes: await source.read(block.compressedStartIndex + fromIndex - block.startIndex, toIndex - fromIndex), startIndex: fromIndex };
    let bytes = kept.get(block);
    if (!bytes) {
      bytes = unpackBlock(await source.read(block.compressedStartIndex, block.compressedSizeBytes), block.sizeBytes, block.compressionCode);
      if (cache.isOn) {
        kept.set(block, bytes);
        keptSizeBytes += bytes.length;
        while (keptSizeBytes > BLOCK_CACHE_SIZE_BYTES && kept.size > 1) {
          const [oldest, oldestBytes] = kept.entries().next().value!;
          kept.delete(oldest);
          keptSizeBytes -= oldestBytes.length;
        }
      }
    }
    return { bytes, startIndex: block.startIndex };
  };
  return {
    sizeBytes,
    async read(startIndex, readSizeBytes) {
      const endIndex = Math.min(sizeBytes, startIndex + readSizeBytes);
      const out = new Uint8Array(Math.max(0, endIndex - startIndex));
      let lowIndex = 0;
      let highIndex = blocks.length - 1;
      while (lowIndex < highIndex) {
        const middleIndex = (lowIndex + highIndex + 1) >> 1;
        if (blocks[middleIndex]!.startIndex <= startIndex) lowIndex = middleIndex;
        else highIndex = middleIndex - 1;
      }
      for (let blockIndex = lowIndex; blockIndex < blocks.length && blocks[blockIndex]!.startIndex < endIndex; blockIndex++) {
        const block = blocks[blockIndex]!;
        const fromIndex = Math.max(startIndex, block.startIndex);
        const toIndex = Math.min(endIndex, block.startIndex + block.sizeBytes);
        const piece = await unpacked(block, fromIndex, toIndex);
        out.set(piece.bytes.subarray(fromIndex - piece.startIndex, toIndex - piece.startIndex), fromIndex - startIndex);
      }
      return out;
    },
  };
}

function subSource(source: ByteSource, startIndex: number, sizeBytes: number): ByteSource {
  return { sizeBytes, read: (index, readSizeBytes) => source.read(startIndex + index, Math.max(0, Math.min(readSizeBytes, sizeBytes - index))) };
}

/** Reads storage a window at a time while searching, keeping the last two, so many small reads close together cost one read. */
function bufferedSource(source: ByteSource, windowSizeBytes: number, cache: ReadCache): ByteSource {
  const windows = new Map<number, Promise<Uint8Array>>();
  cache.clears.push(() => windows.clear());
  const windowAt = (windowIndex: number) => {
    let window = windows.get(windowIndex);
    if (!window) {
      const startIndex = windowIndex * windowSizeBytes;
      window = source.read(startIndex, Math.min(windowSizeBytes, source.sizeBytes - startIndex));
      windows.set(windowIndex, window);
      if (windows.size > 2) windows.delete(windows.keys().next().value!);
    }
    return window;
  };
  return {
    sizeBytes: source.sizeBytes,
    async read(startIndex, sizeBytes) {
      const endIndex = Math.min(source.sizeBytes, startIndex + sizeBytes);
      if (!cache.isOn || endIndex - startIndex > windowSizeBytes) return source.read(startIndex, Math.max(0, endIndex - startIndex));
      const out = new Uint8Array(Math.max(0, endIndex - startIndex));
      for (let windowIndex = Math.floor(startIndex / windowSizeBytes); windowIndex * windowSizeBytes < endIndex; windowIndex++) {
        const window = await windowAt(windowIndex);
        const windowStartIndex = windowIndex * windowSizeBytes;
        const fromIndex = Math.max(startIndex, windowStartIndex);
        const toIndex = Math.min(endIndex, windowStartIndex + window.length);
        if (toIndex > fromIndex) out.set(window.subarray(fromIndex - windowStartIndex, toIndex - windowStartIndex), fromIndex - startIndex);
      }
      return out;
    },
  };
}

// Serialized files: Unity's asset files, a table of objects by class.

interface SerializedObject {
  pathId: bigint;
  startIndex: number;
  sizeBytes: number;
  classNumber: number;
}

interface SerializedFile {
  source: ByteSource;
  isLittleEndian: boolean;
  objects: SerializedObject[];
}

async function openSerializedFile(source: ByteSource): Promise<SerializedFile | null> {
  if (source.sizeBytes < 48) return null;
  const head = await source.read(0, 48);
  const view = new DataView(head.buffer, head.byteOffset, head.length);
  const formatNumber = view.getUint32(8);
  if (formatNumber < 14 || formatNumber > 40) return null;
  let metadataSizeBytes = view.getUint32(0);
  let fileSizeBytes = view.getUint32(4);
  let dataStartIndex = view.getUint32(12);
  let index = 20;
  if (formatNumber >= 22) {
    metadataSizeBytes = view.getUint32(20);
    fileSizeBytes = Number(view.getBigUint64(24));
    dataStartIndex = Number(view.getBigUint64(32));
    index = 48;
  }
  if (fileSizeBytes !== source.sizeBytes || dataStartIndex > fileSizeBytes || metadataSizeBytes > fileSizeBytes || metadataSizeBytes > MAXIMUM_READ_INSIDE_SIZE_BYTES) return null;
  const isLittleEndian = head[16] === 0;
  const metadata = await source.read(0, index + metadataSizeBytes);
  const reader = new Reader(metadata, isLittleEndian, index);
  reader.string(); // Unity formatNumber.
  reader.int32(); // Target platform.
  const hasTypeTree = reader.byte() !== 0;
  const typeCount = reader.int32();
  if (typeCount < 0 || typeCount > 100_000) return null;
  const classNumbers: number[] = [];
  for (let typeIndex = 0; typeIndex < typeCount; typeIndex++) {
    const classNumber = reader.int32();
    if (formatNumber >= 16) reader.byte();
    if (formatNumber >= 17) reader.int16();
    if ((formatNumber >= 16 && classNumber === 114) || (formatNumber < 16 && classNumber < 0)) reader.skip(16);
    reader.skip(16);
    if (hasTypeTree) {
      const nodeCount = reader.int32();
      const stringSizeBytes = reader.int32();
      reader.skip(nodeCount * (formatNumber >= 19 ? 32 : 24) + stringSizeBytes);
      if (formatNumber >= 21) reader.skip(reader.int32() * 4);
    }
    classNumbers.push(classNumber);
  }
  const objectCount = reader.int32();
  if (objectCount < 0 || objectCount > 1_000_000) return null;
  const objects: SerializedObject[] = [];
  for (let objectIndex = 0; objectIndex < objectCount; objectIndex++) {
    reader.align(4);
    const pathId = reader.int64();
    const startIndex = (formatNumber >= 22 ? Number(reader.int64()) : reader.uint32()) + dataStartIndex;
    const sizeBytes = reader.uint32();
    const typeIndex = reader.int32();
    let classNumber = classNumbers[typeIndex] ?? -1;
    if (formatNumber < 16) classNumber = reader.uint16();
    if (formatNumber < 17) reader.int16();
    if (formatNumber === 15 || formatNumber === 16) reader.byte();
    if (startIndex + sizeBytes <= fileSizeBytes) objects.push({ pathId, startIndex, sizeBytes, classNumber });
  }
  return { source, isLittleEndian, objects };
}

class Reader {
  index: number;
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly isLittleEndian: boolean;

  constructor(bytes: Uint8Array, isLittleEndian: boolean, index = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    this.isLittleEndian = isLittleEndian;
    this.index = index;
  }

  byte(): number {
    return this.view.getUint8(this.index++);
  }

  int16(): number {
    const readNumber = this.view.getInt16(this.index, this.isLittleEndian);
    this.index += 2;
    return readNumber;
  }

  uint16(): number {
    const readNumber = this.view.getUint16(this.index, this.isLittleEndian);
    this.index += 2;
    return readNumber;
  }

  int32(): number {
    const readNumber = this.view.getInt32(this.index, this.isLittleEndian);
    this.index += 4;
    return readNumber;
  }

  uint32(): number {
    const readNumber = this.view.getUint32(this.index, this.isLittleEndian);
    this.index += 4;
    return readNumber;
  }

  int64(): bigint {
    const readNumber = this.view.getBigInt64(this.index, this.isLittleEndian);
    this.index += 8;
    return readNumber;
  }

  skip(sizeBytes: number): void {
    if (sizeBytes < 0 || this.index + sizeBytes > this.bytes.length) throw new RangeError("Reads past the end");
    this.index += sizeBytes;
  }

  align(boundaryBytes: number): void {
    this.index = align(this.index, boundaryBytes);
  }

  string(): string {
    const endIndex = this.bytes.indexOf(0, this.index);
    if (endIndex < 0) throw new RangeError("Unended string");
    const text = latin1(this.bytes.subarray(this.index, endIndex));
    this.index = endIndex + 1;
    return text;
  }
}

// Texture2D, Sprite and VideoClip objects. Player builds leave out the type trees that describe each object's
// fields, and the fields move between Unity versions, so each is found by what it must hold and checked: a
// texture's data must be exactly as big as its size, format and mip levels say.

interface UnityTexture {
  name: string;
  format: TextureFormat;
  widthPixelCount: number;
  heightPixelCount: number;
  levelCount: number;
  /** Whether its data is a crunched file (format is then the block format it unpacks to), not plain levels. */
  isCrunched: boolean;
  /** Where its pixel data is: inside the object, or in a resource file beside it. */
  pixelSource: ByteSource;
}

/** How much of an object is read to find its fields: names, sizes and references are near the start. */
const OBJECT_HEAD_SIZE_BYTES = 4096;

async function* serializedPictures(fileName: string, file: SerializedFile, resources: Map<string, ByteSource>): AsyncGenerator<PictureFound> {
  const textures = new Map<bigint, Promise<UnityTexture | null>>();
  const textureOf = (object: SerializedObject) => {
    let texture = textures.get(object.pathId);
    if (!texture) {
      texture = readTexture(file, object, resources).catch(() => null);
      textures.set(object.pathId, texture);
    }
    return texture;
  };
  const textureObjects = new Map(file.objects.filter((object) => object.classNumber === TEXTURE_CLASS_NUMBER).map((object) => [object.pathId, object]));
  for (const object of textureObjects.values()) {
    const texture = await textureOf(object);
    if (!texture || texture.widthPixelCount < MINIMUM_TEXTURE_SIDE_PIXEL_COUNT || texture.heightPixelCount < MINIMUM_TEXTURE_SIDE_PIXEL_COUNT) continue;
    const found = await texturePicture(texture, `texture "${texture.name}"`).catch(() => null);
    if (found) yield found;
  }
  const crops = new Set<string>();
  for (const object of file.objects.filter((candidate) => candidate.classNumber === SPRITE_CLASS_NUMBER)) {
    const sprite = await readSprite(file, object, textureObjects).catch(() => null);
    if (!sprite) continue;
    const texture = await textureOf(textureObjects.get(sprite.texturePathId)!);
    if (!texture) continue;
    const region = sprite.region;
    const isWhole = region.widthPixelCount >= texture.widthPixelCount && region.heightPixelCount >= texture.heightPixelCount;
    if (isWhole || region.widthPixelCount < MINIMUM_TEXTURE_SIDE_PIXEL_COUNT || region.heightPixelCount < MINIMUM_TEXTURE_SIDE_PIXEL_COUNT || region.columnIndex + region.widthPixelCount > texture.widthPixelCount || region.rowIndex + region.heightPixelCount > texture.heightPixelCount) continue;
    const key = `${sprite.texturePathId}:${region.columnIndex},${region.rowIndex},${region.widthPixelCount},${region.heightPixelCount}`;
    if (crops.has(key)) continue;
    crops.add(key);
    const found = await texturePicture(texture, `sprite "${sprite.name}"`, region).catch(() => null);
    if (found) yield found;
  }
  for (const object of file.objects.filter((candidate) => candidate.classNumber === VIDEO_CLIP_CLASS_NUMBER)) {
    const found = await readVideo(file, object, resources).catch(() => null);
    if (found) yield found;
  }
}

async function texturePicture(texture: UnityTexture, label: string, region?: TextureRegion): Promise<PictureFound | null> {
  if (texture.isCrunched) return crunchedTexturePicture(texture, label, region);
  const levels = textureLevels(texture.format, texture.widthPixelCount, texture.heightPixelCount, texture.levelCount);
  if (!levels) return null;
  // The first mip level small enough to send whole; a crop always comes from the full-size level.
  const level = region ? levels[0]! : (levels.find((candidate) => Math.max(candidate.widthPixelCount, candidate.heightPixelCount) <= MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT) ?? levels[0]!);
  if (level.sizeBytes > MAXIMUM_READ_INSIDE_SIZE_BYTES) return null;
  const read = () => texture.pixelSource.read(level.startIndex, level.sizeBytes);
  const bytes = await read();
  if (bytes.length < level.sizeBytes) return null;
  const description = new TextEncoder().encode(`unity-texture:${texture.format}:${level.widthPixelCount}x${level.heightPixelCount}:${region ? `${region.columnIndex},${region.rowIndex},${region.widthPixelCount},${region.heightPixelCount}` : "whole"}:`);
  const sha256 = await sha256Hex(concat(description, bytes));
  return {
    label,
    type: "image/png",
    sha256,
    async body() {
      const picture = decodeTexture(texture.format, await read(), level.widthPixelCount, level.heightPixelCount, { isBottomUp: true, region });
      if (!picture) throw new Error(`${label} couldn't be decoded`);
      return encodePng(picture);
    },
  };
}

/**
 * A crunched texture's picture: the same mip level an uncrunched one would send, unpacked from the whole crunched
 * file. Its cache name hashes the whole file, since a level's blocks aren't known without unpacking it.
 */
async function crunchedTexturePicture(texture: UnityTexture, label: string, region?: TextureRegion): Promise<PictureFound | null> {
  const sizeBytes = texture.pixelSource.sizeBytes;
  if (sizeBytes > MAXIMUM_READ_INSIDE_SIZE_BYTES) return null;
  const read = () => texture.pixelSource.read(0, sizeBytes);
  const bytes = await read();
  const header = readCrunchHeader(bytes);
  const levels = header && textureLevels(texture.format, header.widthPixelCount, header.heightPixelCount, header.levelCount);
  if (!header || !levels) return null;
  const levelIndex = region ? 0 : Math.max(0, levels.findIndex((candidate) => Math.max(candidate.widthPixelCount, candidate.heightPixelCount) <= MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT));
  const level = levels[levelIndex]!;
  if (level.sizeBytes > MAXIMUM_READ_INSIDE_SIZE_BYTES) return null;
  const description = new TextEncoder().encode(`unity-texture:crunched-${texture.format}:${level.widthPixelCount}x${level.heightPixelCount}:${region ? `${region.columnIndex},${region.rowIndex},${region.widthPixelCount},${region.heightPixelCount}` : "whole"}:`);
  const sha256 = await sha256Hex(concat(description, bytes));
  return {
    label,
    type: "image/png",
    sha256,
    async body() {
      const crunched = await read();
      const crunchedHeader = readCrunchHeader(crunched);
      const blocks = crunchedHeader && unpackCrunchLevel(crunched, crunchedHeader, levelIndex);
      const picture = blocks && decodeTexture(texture.format, blocks, level.widthPixelCount, level.heightPixelCount, { isBottomUp: true, region });
      if (!picture) throw new Error(`${label} couldn't be decoded`);
      return encodePng(picture);
    },
  };
}

async function readObjectHead(file: SerializedFile, object: SerializedObject): Promise<Reader> {
  return new Reader(await file.source.read(object.startIndex, Math.min(object.sizeBytes, OBJECT_HEAD_SIZE_BYTES)), file.isLittleEndian);
}

/** An object's name, the aligned string every named Unity object starts with. */
function readName(reader: Reader): string {
  const nameSizeBytes = reader.int32();
  if (nameSizeBytes < 0 || nameSizeBytes > 1024) throw new RangeError("Not a name");
  const text = new TextDecoder().decode(reader.bytes.subarray(reader.index, reader.index + nameSizeBytes));
  reader.skip(nameSizeBytes);
  reader.align(4);
  return text.replace(/[^\p{L}\p{N} ._()-]/gu, "").slice(0, 100);
}

async function readTexture(file: SerializedFile, object: SerializedObject, resources: Map<string, ByteSource>): Promise<UnityTexture | null> {
  const reader = await readObjectHead(file, object);
  const name = readName(reader);
  const view = reader.view;
  const little = file.isLittleEndian;
  const int32At = (index: number) => (index + 4 <= view.byteLength ? view.getInt32(index, little) : -1);
  // Width, height and the whole data size come a few fields after the name (more in newer versions), then the
  // format and mip count, with a stripped-mips count between them since 2020.1.
  for (let index = reader.index; index <= reader.index + 32; index += 4) {
    const widthPixelCount = int32At(index);
    const heightPixelCount = int32At(index + 4);
    const completeSizeBytes = int32At(index + 8);
    if (widthPixelCount < 1 || heightPixelCount < 1 || widthPixelCount > MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT || heightPixelCount > MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT || completeSizeBytes < 1) continue;
    for (const formatIndex of [index + 12, index + 16]) {
      const levelCount = int32At(formatIndex + 4);
      if (levelCount < 1 || levelCount > 15) continue;
      const crunched = UNITY_CRUNCHED_FORMATS[int32At(formatIndex)];
      if (crunched) {
        // A crunched texture's data is a crunched file as big as the whole data size, holding the same picture size.
        const pixelSource = findImageData(file, object, reader.bytes, formatIndex + 8, completeSizeBytes, resources);
        if (!pixelSource) continue;
        const header = readCrunchHeader(await pixelSource.read(0, Math.min(completeSizeBytes, CRUNCH_HEADER_MAXIMUM_SIZE_BYTES)), completeSizeBytes);
        if (!header || header.crunchFormat !== crunched.crunchFormat || header.widthPixelCount !== widthPixelCount || header.heightPixelCount !== heightPixelCount || header.dataSizeBytes !== completeSizeBytes) continue;
        return { name, format: crunched.format, widthPixelCount, heightPixelCount, levelCount: header.levelCount, isCrunched: true, pixelSource };
      }
      const format = UNITY_TEXTURE_FORMATS[int32At(formatIndex)];
      if (!format) continue;
      const levels = textureLevels(format, widthPixelCount, heightPixelCount, levelCount);
      const last = levels?.[levels.length - 1];
      if (!last || last.startIndex + last.sizeBytes !== completeSizeBytes) continue;
      const pixelSource = findImageData(file, object, reader.bytes, formatIndex + 8, completeSizeBytes, resources);
      if (pixelSource) return { name, format, widthPixelCount, heightPixelCount, levelCount, isCrunched: false, pixelSource };
    }
  }
  return null;
}

/** The texture's pixel data: right after its size inside the object, or where its streamed-data reference points. */
function findImageData(file: SerializedFile, object: SerializedObject, head: Uint8Array, fromIndex: number, sizeBytes: number, resources: Map<string, ByteSource>): ByteSource | null {
  const view = new DataView(head.buffer, head.byteOffset, head.length);
  const little = file.isLittleEndian;
  for (let index = fromIndex; index + 4 <= head.length; index += 4) {
    const fieldNumber = view.getInt32(index, little);
    if (fieldNumber === sizeBytes && index + 4 + sizeBytes <= object.sizeBytes) return subSource(file.source, object.startIndex + index + 4, sizeBytes);
    if (fieldNumber !== 0) continue;
    // Streamed: an resourceStartIndex (8 bytes since 2020.1, else 4), the size, then the resource file's path.
    for (const offsetSizeBytes of [8, 4]) {
      const sizeIndex = index + 4 + offsetSizeBytes;
      if (sizeIndex + 8 > head.length || view.getUint32(sizeIndex, little) !== sizeBytes) continue;
      const resourceStartIndex = offsetSizeBytes === 8 ? Number(view.getBigUint64(index + 4, little)) : view.getUint32(index + 4, little);
      const pathSizeBytes = view.getInt32(sizeIndex + 4, little);
      if (pathSizeBytes < 1 || pathSizeBytes > 1024 || sizeIndex + 8 + pathSizeBytes > head.length) continue;
      const resource = resources.get(baseName(new TextDecoder().decode(head.subarray(sizeIndex + 8, sizeIndex + 8 + pathSizeBytes))));
      if (resource && resourceStartIndex + sizeBytes <= resource.sizeBytes) return subSource(resource, resourceStartIndex, sizeBytes);
    }
  }
  return null;
}

async function readSprite(file: SerializedFile, object: SerializedObject, textureObjects: Map<bigint, SerializedObject>): Promise<{ name: string; texturePathId: bigint; region: TextureRegion } | null> {
  const reader = await readObjectHead(file, object);
  const name = readName(reader);
  const view = reader.view;
  const little = file.isLittleEndian;
  const float = (index: number) => view.getFloat32(index, little);
  const rect = [0, 4, 8, 12].map((offsetBytes) => float(reader.index + offsetBytes));
  if (!rect.every(Number.isFinite) || rect[2]! < 1 || rect[3]! < 1) return null;
  // The render data's texture reference: a file id of 0 (this file) and the path id of one of its textures.
  for (let index = reader.index + 16; index + 12 <= view.byteLength; index += 4) {
    if (view.getInt32(index, little) !== 0) continue;
    const texturePathId = view.getBigInt64(index + 4, little);
    if (!textureObjects.has(texturePathId)) continue;
    // Where the sprite sits in that texture: its own rectangle when the render data repeats it (no atlas),
    // else the first rectangle after the reference as big as the sprite (its place in a packed atlas).
    const candidates: number[][] = [];
    for (let rectIndex = index + 12; rectIndex + 16 <= view.byteLength; rectIndex += 4) candidates.push([0, 4, 8, 12].map((offsetBytes) => float(rectIndex + offsetBytes)));
    const isRect = (candidate: number[]) => candidate.every((sideNumber, sideIndex) => sideNumber === rect[sideIndex]);
    const isSameSize = (candidate: number[]) => candidate[2] === rect[2] && candidate[3] === rect[3] && candidate[0]! >= 0 && candidate[1]! >= 0 && Number.isFinite(candidate[0]) && Number.isFinite(candidate[1]);
    const place = candidates.find(isRect) ?? candidates.find(isSameSize) ?? rect;
    return { name, texturePathId, region: { columnIndex: Math.floor(place[0]!), rowIndex: Math.floor(place[1]!), widthPixelCount: Math.round(rect[2]!), heightPixelCount: Math.round(rect[3]!) } };
  }
  return null;
}

async function readVideo(file: SerializedFile, object: SerializedObject, resources: Map<string, ByteSource>): Promise<PictureFound | null> {
  const reader = await readObjectHead(file, object);
  const name = readName(reader);
  const view = reader.view;
  const little = file.isLittleEndian;
  // The clip's resource: the path of a .resource file, then its resourceStartIndex and size there.
  for (let index = reader.index; index + 8 <= view.byteLength; index += 4) {
    const pathSizeBytes = view.getInt32(index, little);
    if (pathSizeBytes < 9 || pathSizeBytes > 1024 || index + 4 + pathSizeBytes > view.byteLength) continue;
    const path = new TextDecoder().decode(reader.bytes.subarray(index + 4, index + 4 + pathSizeBytes));
    if (!path.endsWith(".resource")) continue;
    const sizeIndex = align(index + 4 + pathSizeBytes, 4);
    if (sizeIndex + 16 > view.byteLength) return null;
    const resourceStartIndex = Number(view.getBigUint64(sizeIndex, little));
    const sizeBytes = Number(view.getBigUint64(sizeIndex + 8, little));
    const resource = resources.get(baseName(path));
    if (!resource || sizeBytes < 1 || sizeBytes > MAXIMUM_READ_INSIDE_SIZE_BYTES || resourceStartIndex + sizeBytes > resource.sizeBytes) return null;
    const read = () => resource.read(resourceStartIndex, sizeBytes);
    const bytes = await read();
    const type = sniffMedia(bytes.subarray(0, 64));
    if (type !== "video/mp4" && !(type === "video/webm" && matroskaHasVideo(bytes.subarray(0, 64 * 1024)))) return null;
    return { label: `video "${name}"`, type, sha256: await sha256Hex(bytes), body: read };
  }
  return null;
}

/** Picture files (PNG, JPEG, GIF, WebP) stored inside a file that came out of a compressed bundle. */
async function* filePicturesInside(fileName: string, source: ByteSource): AsyncGenerator<PictureFound> {
  let pictureNumber = 0;
  for (let windowStartIndex = 0; windowStartIndex < source.sizeBytes; ) {
    const bytes = await source.read(windowStartIndex, Math.min(READ_WINDOW_SIZE_BYTES, source.sizeBytes - windowStartIndex));
    if (bytes.length === 0) break;
    const { pictures, unfinishedStartIndex } = picturesInside(bytes);
    for (const picture of pictures) {
      const sizeBytes = picture.endIndex - picture.startIndex;
      if (sizeBytes < 1024) continue;
      pictureNumber++;
      const pictureStartIndex = windowStartIndex + picture.startIndex;
      yield { label: `picture ${pictureNumber} in ${baseName(fileName)}`, type: picture.type, sha256: await sha256Hex(bytes.subarray(picture.startIndex, picture.endIndex)), body: () => source.read(pictureStartIndex, sizeBytes) };
    }
    if (windowStartIndex + bytes.length >= source.sizeBytes) break;
    windowStartIndex += unfinishedStartIndex === null ? bytes.length : Math.max(1, unfinishedStartIndex);
  }
}

const align = (index: number, boundaryBytes: number) => Math.ceil(index / boundaryBytes) * boundaryBytes;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(first.length + second.length);
  out.set(first);
  out.set(second, first.length);
  return out;
}
