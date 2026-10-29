/**
 * GPU textures decoded back into pictures, so image matching sees what a game draws. Unity and Godot store
 * most pictures as raw pixels or GPU block formats (BC, ETC, ASTC), not as PNG or JPEG files.
 *
 * The BC7, ETC and ASTC decoders follow texture2ddecoder (MIT License, Copyright (c) 2020 K0lb3), itself from
 * AssetStudio (MIT License, Copyright (c) 2016 Radu, Copyright (c) 2016-2020 Perfare).
 */

/** The texture formats Zaisma decodes, named by engine-neutral block format; single-channel ones decode as gray. Anything else is never a picture or isn't decoded. */
export type TextureFormat =
  | "rgba8"
  | "argb8"
  | "bgra8"
  | "rgb8"
  | "rgb565"
  | "rgba4444"
  | "argb4444"
  | "la8"
  | "r8"
  | "r16"
  | "bc1"
  | "bc2"
  | "bc3"
  | "bc7"
  | "bc4"
  | "etc1"
  | "etc2_rgb"
  | "etc2_rgba1"
  | "etc2_rgba8"
  | "eac_r"
  | `astc_${number}x${number}`;

/** A sent picture's longer side is at most this: both matchers match a smaller copy, and it keeps memory and time small. */
export const MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT = 1024;
/** Textures narrower or shorter than this aren't sent: too small to show anything (PhotoDNA needs 50). */
export const MINIMUM_TEXTURE_SIDE_PIXEL_COUNT = 32;
/** The largest texture side any engine makes; a header claiming more was misread. */
export const MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT = 16384;

/** A decoded picture, top row first, four bytes a pixel. */
export interface DecodedPicture {
  widthPixelCount: number;
  heightPixelCount: number;
  rgba: Uint8Array;
}

/** Part of a texture, in its stored rows: columns and rows count from its first stored pixel. */
export interface TextureRegion {
  columnIndex: number;
  rowIndex: number;
  widthPixelCount: number;
  heightPixelCount: number;
}

interface Layout {
  blockWidthPixelCount: number;
  blockHeightPixelCount: number;
  blockSizeBytes: number;
}

const PIXEL_SIZES_BYTES: Partial<Record<TextureFormat, number>> = { rgba8: 4, argb8: 4, bgra8: 4, rgb8: 3, rgb565: 2, rgba4444: 2, argb4444: 2, la8: 2, r8: 1, r16: 2 };
const BLOCK_SIZES_BYTES: Partial<Record<TextureFormat, number>> = { bc1: 8, bc2: 16, bc3: 16, bc7: 16, etc1: 8, etc2_rgb: 8, etc2_rgba1: 8, etc2_rgba8: 16, bc4: 8, eac_r: 8 };
const ASTC_BLOCK_SIDE_PIXEL_COUNTS = new Set([4, 5, 6, 8, 10, 12]);

function layoutOf(format: TextureFormat): Layout | null {
  const pixelSizeBytes = PIXEL_SIZES_BYTES[format];
  if (pixelSizeBytes) return { blockWidthPixelCount: 1, blockHeightPixelCount: 1, blockSizeBytes: pixelSizeBytes };
  const blockSizeBytes = BLOCK_SIZES_BYTES[format];
  if (blockSizeBytes) return { blockWidthPixelCount: 4, blockHeightPixelCount: 4, blockSizeBytes };
  const astcSides = /^astc_(\d+)x(\d+)$/.exec(format);
  if (astcSides && ASTC_BLOCK_SIDE_PIXEL_COUNTS.has(Number(astcSides[1])) && ASTC_BLOCK_SIDE_PIXEL_COUNTS.has(Number(astcSides[2]))) {
    return { blockWidthPixelCount: Number(astcSides[1]), blockHeightPixelCount: Number(astcSides[2]), blockSizeBytes: 16 };
  }
  return null;
}

/** The size of one mip level of a texture, or null for a format Zaisma doesn't decode. */
export function textureLevelSizeBytes(format: TextureFormat, widthPixelCount: number, heightPixelCount: number): number | null {
  const layout = layoutOf(format);
  if (!layout) return null;
  return Math.ceil(widthPixelCount / layout.blockWidthPixelCount) * Math.ceil(heightPixelCount / layout.blockHeightPixelCount) * layout.blockSizeBytes;
}

/** One mip level of a texture: where it starts, its size in pixels and in bytes. */
export interface TextureLevel {
  startIndex: number;
  widthPixelCount: number;
  heightPixelCount: number;
  sizeBytes: number;
}

/** Each of a texture's levelCount mip levels, or null for a format Zaisma doesn't decode. */
export function textureLevels(format: TextureFormat, widthPixelCount: number, heightPixelCount: number, levelCount: number): TextureLevel[] | null {
  const levels: TextureLevel[] = [];
  let startIndex = 0;
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex++) {
    const levelWidthPixelCount = Math.max(1, widthPixelCount >> levelIndex);
    const levelHeightPixelCount = Math.max(1, heightPixelCount >> levelIndex);
    const sizeBytes = textureLevelSizeBytes(format, levelWidthPixelCount, levelHeightPixelCount);
    if (sizeBytes === null) return null;
    levels.push({ startIndex, widthPixelCount: levelWidthPixelCount, heightPixelCount: levelHeightPixelCount, sizeBytes });
    startIndex += sizeBytes;
  }
  return levels;
}

/**
 * One mip level (or a region of it) decoded into a picture at most MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT on its
 * longer side, top row first. isBottomUp says the texture stores its bottom row first (Unity). Null when the
 * format isn't decoded or the bytes are too few.
 */
export function decodeTexture(format: TextureFormat, bytes: Uint8Array, widthPixelCount: number, heightPixelCount: number, options: { isBottomUp?: boolean; region?: TextureRegion } = {}): DecodedPicture | null {
  const layout = layoutOf(format);
  const levelSizeBytes = textureLevelSizeBytes(format, widthPixelCount, heightPixelCount);
  if (!layout || levelSizeBytes === null || bytes.length < levelSizeBytes) return null;
  const region = options.region ?? { columnIndex: 0, rowIndex: 0, widthPixelCount, heightPixelCount };
  if (region.columnIndex < 0 || region.rowIndex < 0 || region.widthPixelCount < 1 || region.heightPixelCount < 1) return null;
  if (region.columnIndex + region.widthPixelCount > widthPixelCount || region.rowIndex + region.heightPixelCount > heightPixelCount) return null;
  const canvas = new Canvas(region);
  const block = new Uint8Array(layout.blockWidthPixelCount * layout.blockHeightPixelCount * 4);
  const blockColumnCount = Math.ceil(widthPixelCount / layout.blockWidthPixelCount);
  const firstBlockColumnIndex = Math.floor(region.columnIndex / layout.blockWidthPixelCount);
  const lastBlockColumnIndex = Math.floor((region.columnIndex + region.widthPixelCount - 1) / layout.blockWidthPixelCount);
  const firstBlockRowIndex = Math.floor(region.rowIndex / layout.blockHeightPixelCount);
  const lastBlockRowIndex = Math.floor((region.rowIndex + region.heightPixelCount - 1) / layout.blockHeightPixelCount);
  const decodeBlock = blockDecoder(format, layout);
  for (let blockRowIndex = firstBlockRowIndex; blockRowIndex <= lastBlockRowIndex; blockRowIndex++) {
    for (let blockColumnIndex = firstBlockColumnIndex; blockColumnIndex <= lastBlockColumnIndex; blockColumnIndex++) {
      decodeBlock(bytes, (blockRowIndex * blockColumnCount + blockColumnIndex) * layout.blockSizeBytes, block);
      canvas.putBlock(blockColumnIndex * layout.blockWidthPixelCount, blockRowIndex * layout.blockHeightPixelCount, layout, block);
    }
  }
  return canvas.picture(options.isBottomUp ?? false);
}

/** Collects a region's pixels into a box-downscaled picture, so a big texture never sits in memory whole. */
class Canvas {
  readonly region: TextureRegion;
  /** How many texture pixels make one picture pixel, across and down. */
  readonly scaleNumber: number;
  readonly widthPixelCount: number;
  readonly heightPixelCount: number;
  readonly sums: Uint32Array;
  readonly sampleCounts: Uint16Array;

  constructor(region: TextureRegion) {
    this.region = region;
    this.scaleNumber = Math.max(1, Math.ceil(Math.max(region.widthPixelCount, region.heightPixelCount) / MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT));
    this.widthPixelCount = Math.ceil(region.widthPixelCount / this.scaleNumber);
    this.heightPixelCount = Math.ceil(region.heightPixelCount / this.scaleNumber);
    this.sums = new Uint32Array(this.widthPixelCount * this.heightPixelCount * 4);
    this.sampleCounts = new Uint16Array(this.widthPixelCount * this.heightPixelCount);
  }

  putBlock(startColumnIndex: number, startRowIndex: number, layout: Layout, block: Uint8Array): void {
    const { region, scaleNumber } = this;
    for (let blockRowIndex = 0; blockRowIndex < layout.blockHeightPixelCount; blockRowIndex++) {
      const regionRowIndex = startRowIndex + blockRowIndex - region.rowIndex;
      if (regionRowIndex < 0 || regionRowIndex >= region.heightPixelCount) continue;
      const canvasRowStartIndex = Math.floor(regionRowIndex / scaleNumber) * this.widthPixelCount;
      for (let blockColumnIndex = 0; blockColumnIndex < layout.blockWidthPixelCount; blockColumnIndex++) {
        const regionColumnIndex = startColumnIndex + blockColumnIndex - region.columnIndex;
        if (regionColumnIndex < 0 || regionColumnIndex >= region.widthPixelCount) continue;
        const pixelIndex = canvasRowStartIndex + Math.floor(regionColumnIndex / scaleNumber);
        const blockIndex = (blockRowIndex * layout.blockWidthPixelCount + blockColumnIndex) * 4;
        for (let channelIndex = 0; channelIndex < 4; channelIndex++) this.sums[pixelIndex * 4 + channelIndex]! += block[blockIndex + channelIndex]!;
        this.sampleCounts[pixelIndex]!++;
      }
    }
  }

  picture(isBottomUp: boolean): DecodedPicture {
    const rgba = new Uint8Array(this.widthPixelCount * this.heightPixelCount * 4);
    for (let rowIndex = 0; rowIndex < this.heightPixelCount; rowIndex++) {
      const targetRowIndex = isBottomUp ? this.heightPixelCount - 1 - rowIndex : rowIndex;
      for (let columnIndex = 0; columnIndex < this.widthPixelCount; columnIndex++) {
        const pixelIndex = rowIndex * this.widthPixelCount + columnIndex;
        const sampleCount = this.sampleCounts[pixelIndex] || 1;
        const targetIndex = (targetRowIndex * this.widthPixelCount + columnIndex) * 4;
        for (let channelIndex = 0; channelIndex < 4; channelIndex++) rgba[targetIndex + channelIndex] = Math.round(this.sums[pixelIndex * 4 + channelIndex]! / sampleCount);
      }
    }
    return { widthPixelCount: this.widthPixelCount, heightPixelCount: this.heightPixelCount, rgba };
  }
}

type BlockDecoder = (bytes: Uint8Array, startIndex: number, out: Uint8Array) => void;

function blockDecoder(format: TextureFormat, layout: Layout): BlockDecoder {
  const sixteenBits = (bytes: Uint8Array, startIndex: number) => bytes[startIndex]! | (bytes[startIndex + 1]! << 8);
  switch (format) {
    case "rgba8":
      return (bytes, startIndex, out) => out.set(bytes.subarray(startIndex, startIndex + 4));
    case "argb8":
      return (bytes, startIndex, out) => setPixel(out, 0, [bytes[startIndex + 1]!, bytes[startIndex + 2]!, bytes[startIndex + 3]!, bytes[startIndex]!]);
    case "bgra8":
      return (bytes, startIndex, out) => setPixel(out, 0, [bytes[startIndex + 2]!, bytes[startIndex + 1]!, bytes[startIndex]!, bytes[startIndex + 3]!]);
    case "rgb8":
      return (bytes, startIndex, out) => setPixel(out, 0, [bytes[startIndex]!, bytes[startIndex + 1]!, bytes[startIndex + 2]!, 255]);
    case "la8":
      return (bytes, startIndex, out) => setPixel(out, 0, [bytes[startIndex]!, bytes[startIndex]!, bytes[startIndex]!, bytes[startIndex + 1]!]);
    case "r8":
      return (bytes, startIndex, out) => setPixel(out, 0, [bytes[startIndex]!, bytes[startIndex]!, bytes[startIndex]!, 255]);
    case "r16":
      // The high byte of each little-endian 16-bit value.
      return (bytes, startIndex, out) => setPixel(out, 0, [bytes[startIndex + 1]!, bytes[startIndex + 1]!, bytes[startIndex + 1]!, 255]);
    case "rgb565":
      return (bytes, startIndex, out) => setPixel(out, 0, rgb565(sixteenBits(bytes, startIndex)));
    case "rgba4444":
      return (bytes, startIndex, out) => {
        const colorCode = sixteenBits(bytes, startIndex);
        setPixel(out, 0, [(colorCode >> 12) * 17, ((colorCode >> 8) & 15) * 17, ((colorCode >> 4) & 15) * 17, (colorCode & 15) * 17]);
      };
    case "argb4444":
      return (bytes, startIndex, out) => {
        const colorCode = sixteenBits(bytes, startIndex);
        setPixel(out, 0, [((colorCode >> 8) & 15) * 17, ((colorCode >> 4) & 15) * 17, (colorCode & 15) * 17, (colorCode >> 12) * 17]);
      };
    case "bc1":
      return (bytes, startIndex, out) => decodeBc1(bytes, startIndex, out, true);
    case "bc2":
      return (bytes, startIndex, out) => {
        decodeBc1(bytes, startIndex + 8, out, false);
        for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++) out[pixelIndex * 4 + 3] = ((bytes[startIndex + (pixelIndex >> 1)]! >> ((pixelIndex & 1) * 4)) & 15) * 17;
      };
    case "bc3":
      return (bytes, startIndex, out) => {
        decodeBc1(bytes, startIndex + 8, out, false);
        decodeBc3Alpha(bytes, startIndex, out);
      };
    case "bc7":
      return decodeBc7;
    case "bc4":
      return (bytes, startIndex, out) => {
        decodeBc3Alpha(bytes, startIndex, out);
        alphaToGray(out);
      };
    case "etc1":
      return (bytes, startIndex, out) => decodeEtc2Color(bytes.subarray(startIndex, startIndex + 8), out, "etc1");
    case "etc2_rgb":
      return (bytes, startIndex, out) => decodeEtc2Color(bytes.subarray(startIndex, startIndex + 8), out, "rgb");
    case "etc2_rgba1":
      return (bytes, startIndex, out) => decodeEtc2Color(bytes.subarray(startIndex, startIndex + 8), out, "rgba1");
    case "etc2_rgba8":
      return (bytes, startIndex, out) => {
        decodeEtc2Color(bytes.subarray(startIndex + 8, startIndex + 16), out, "rgb");
        decodeEtc2Alpha(bytes.subarray(startIndex, startIndex + 8), out);
      };
    case "eac_r":
      return (bytes, startIndex, out) => {
        decodeEtc2Alpha(bytes.subarray(startIndex, startIndex + 8), out);
        alphaToGray(out);
      };
    default:
      return (bytes, startIndex, out) => decodeAstcBlock(bytes.subarray(startIndex, startIndex + 16), layout, out);
  }
}

/** A channel stored in bitCount bits, widened to 8 bits by repeating its top bits. */
const expandBits = (quantizedNumber: number, bitCount: number) => (quantizedNumber << (8 - bitCount)) | (quantizedNumber >> (2 * bitCount - 8));
const clampByte = (unclampedNumber: number) => (unclampedNumber < 0 ? 0 : unclampedNumber > 255 ? 255 : unclampedNumber);
const rgb565 = (colorCode: number) => [expandBits(colorCode >> 11, 5), expandBits((colorCode >> 5) & 63, 6), expandBits(colorCode & 31, 5), 255];

/** A single-channel block decoded into the alpha bytes, moved into gray and made opaque. */
function alphaToGray(out: Uint8Array): void {
  for (let pixelIndex = 0; pixelIndex < out.length / 4; pixelIndex++) setPixel(out, pixelIndex, [out[pixelIndex * 4 + 3]!, out[pixelIndex * 4 + 3]!, out[pixelIndex * 4 + 3]!, 255]);
}

/** Writes one pixel's red, green, blue and alpha bytes. */
function setPixel(out: Uint8Array, pixelIndex: number, color: number[]): void {
  out[pixelIndex * 4] = color[0]!;
  out[pixelIndex * 4 + 1] = color[1]!;
  out[pixelIndex * 4 + 2] = color[2]!;
  out[pixelIndex * 4 + 3] = color[3]!;
}

/** bitCount (at most 48) bits from bitIndex on, least significant bit first; bits past the end read as 0. */
function readBits(bytes: Uint8Array, bitIndex: number, bitCount: number): number {
  let bitsNumber = 0;
  for (let offsetIndex = 0; offsetIndex < bitCount; offsetIndex++) {
    const sourceIndex = bitIndex + offsetIndex;
    if (((bytes[sourceIndex >> 3] ?? 0) >> (sourceIndex & 7)) & 1) bitsNumber += 2 ** offsetIndex;
  }
  return bitsNumber;
}

// BC1 to BC3 (DXT1, DXT3, DXT5).

function decodeBc1(bytes: Uint8Array, startIndex: number, out: Uint8Array, hasPunchThrough: boolean): void {
  const firstColorCode = bytes[startIndex]! | (bytes[startIndex + 1]! << 8);
  const secondColorCode = bytes[startIndex + 2]! | (bytes[startIndex + 3]! << 8);
  const first = rgb565(firstColorCode);
  const second = rgb565(secondColorCode);
  const mixed = (firstShareCount: number, secondShareCount: number) => [0, 1, 2].map((channelIndex) => Math.floor((first[channelIndex]! * firstShareCount + second[channelIndex]! * secondShareCount) / (firstShareCount + secondShareCount))).concat(255);
  const colors = firstColorCode > secondColorCode || !hasPunchThrough ? [first, second, mixed(2, 1), mixed(1, 2)] : [first, second, mixed(1, 1), [0, 0, 0, 255]];
  let packedIndexNumber = (bytes[startIndex + 4]! | (bytes[startIndex + 5]! << 8) | (bytes[startIndex + 6]! << 16) | (bytes[startIndex + 7]! << 24)) >>> 0;
  for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++, packedIndexNumber >>>= 2) setPixel(out, pixelIndex, colors[packedIndexNumber & 3]!);
}

function decodeBc3Alpha(bytes: Uint8Array, startIndex: number, out: Uint8Array): void {
  const firstAlphaByte = bytes[startIndex]!;
  const secondAlphaByte = bytes[startIndex + 1]!;
  const alphas = [firstAlphaByte, secondAlphaByte];
  const stepCount = firstAlphaByte > secondAlphaByte ? 7 : 5;
  for (let stepIndex = 1; stepIndex < stepCount; stepIndex++) alphas.push(Math.floor((firstAlphaByte * (stepCount - stepIndex) + secondAlphaByte * stepIndex) / stepCount));
  if (stepCount === 5) alphas.push(0, 255);
  for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++) out[pixelIndex * 4 + 3] = alphas[readBits(bytes, startIndex * 8 + 16 + pixelIndex * 3, 3)]!;
}

// BC7.

/** Each 2-subset partition as 16 bits, pixel 0 the lowest. */
const BC7_PARTITIONS_2 = [
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800, 0xffe8, 0xff00, 0xfff0, 0xf000, 0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce, 0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
  0xaaaa, 0xf0f0, 0x5a5a, 0x33cc, 0x3c3c, 0x55aa, 0x9696, 0xa55a, 0x73ce, 0x13c8, 0x324c, 0x3bdc, 0x6996, 0xc33c, 0x9966, 0x0660, 0x0272, 0x04e4, 0x4e40, 0x2720, 0xc936, 0x936c, 0x39c6, 0x639c, 0x9336, 0x9cc6, 0x817e, 0xe718, 0xccf0, 0x0fcc, 0x7744, 0xee22,
];
/** Each 3-subset partition as 32 bits, two a pixel, pixel 0 the lowest. */
const BC7_PARTITIONS_3 = [
  0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050, 0xaa550000, 0xaa555500, 0xaaaa5500, 0x90909090, 0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250, 0xa5945040, 0x0a425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040,
  0xa4a45000, 0x1a1a0500, 0x0050a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200, 0xa9a58000, 0x5090a0a8, 0xa8a09050, 0x24242424, 0x00aa5500, 0x24924924, 0x24499224, 0x50a50a50, 0x500aa550, 0xaaaa4444, 0x66660000,
  0xa5a0a5a0, 0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600, 0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414, 0x96960000, 0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000, 0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254,
];
const BC7_ANCHORS_2 = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15];
const BC7_ANCHORS_3 = [
  [3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15, 8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3],
  [15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8, 15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8],
];
const BC7_WEIGHTS = [
  [0, 21, 43, 64],
  [0, 9, 18, 27, 37, 46, 55, 64],
  [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
];
/** Each mode's bit layout. */
const BC7_MODES = [
  { subsetCount: 3, partitionBitCount: 4, rotationBitCount: 0, selectionBitCount: 0, colorBitCount: 4, alphaBitCount: 0, endpointParityBitCount: 1, sharedParityBitCount: 0, firstIndexBitCount: 3, secondIndexBitCount: 0 },
  { subsetCount: 2, partitionBitCount: 6, rotationBitCount: 0, selectionBitCount: 0, colorBitCount: 6, alphaBitCount: 0, endpointParityBitCount: 0, sharedParityBitCount: 1, firstIndexBitCount: 3, secondIndexBitCount: 0 },
  { subsetCount: 3, partitionBitCount: 6, rotationBitCount: 0, selectionBitCount: 0, colorBitCount: 5, alphaBitCount: 0, endpointParityBitCount: 0, sharedParityBitCount: 0, firstIndexBitCount: 2, secondIndexBitCount: 0 },
  { subsetCount: 2, partitionBitCount: 6, rotationBitCount: 0, selectionBitCount: 0, colorBitCount: 7, alphaBitCount: 0, endpointParityBitCount: 1, sharedParityBitCount: 0, firstIndexBitCount: 2, secondIndexBitCount: 0 },
  { subsetCount: 1, partitionBitCount: 0, rotationBitCount: 2, selectionBitCount: 1, colorBitCount: 5, alphaBitCount: 6, endpointParityBitCount: 0, sharedParityBitCount: 0, firstIndexBitCount: 2, secondIndexBitCount: 3 },
  { subsetCount: 1, partitionBitCount: 0, rotationBitCount: 2, selectionBitCount: 0, colorBitCount: 7, alphaBitCount: 8, endpointParityBitCount: 0, sharedParityBitCount: 0, firstIndexBitCount: 2, secondIndexBitCount: 2 },
  { subsetCount: 1, partitionBitCount: 0, rotationBitCount: 0, selectionBitCount: 0, colorBitCount: 7, alphaBitCount: 7, endpointParityBitCount: 1, sharedParityBitCount: 0, firstIndexBitCount: 4, secondIndexBitCount: 0 },
  { subsetCount: 2, partitionBitCount: 6, rotationBitCount: 0, selectionBitCount: 0, colorBitCount: 5, alphaBitCount: 5, endpointParityBitCount: 1, sharedParityBitCount: 0, firstIndexBitCount: 2, secondIndexBitCount: 0 },
];

function decodeBc7(bytes: Uint8Array, startIndex: number, out: Uint8Array): void {
  const block = bytes.subarray(startIndex, startIndex + 16);
  let bitIndex = 0;
  const read = (bitCount: number) => {
    const bitsNumber = readBits(block, bitIndex, bitCount);
    bitIndex += bitCount;
    return bitsNumber;
  };
  let modeIndex = 0;
  while (modeIndex < 8 && read(1) === 0) modeIndex++;
  const mode = BC7_MODES[modeIndex];
  if (!mode) {
    out.fill(0);
    return;
  }
  const parityBitCount = mode.endpointParityBitCount || mode.sharedParityBitCount;
  const partitionIndex = read(mode.partitionBitCount);
  const rotationNumber = read(mode.rotationBitCount);
  const selectionNumber = read(mode.selectionBitCount);
  const endpointCount = mode.subsetCount * 2;
  const endpoints = [[], [], [], []] as number[][];
  for (let channelIndex = 0; channelIndex < 3; channelIndex++) for (let endpointIndex = 0; endpointIndex < endpointCount; endpointIndex++) endpoints[channelIndex]![endpointIndex] = read(mode.colorBitCount) << parityBitCount;
  for (let endpointIndex = 0; endpointIndex < endpointCount; endpointIndex++) endpoints[3]![endpointIndex] = mode.alphaBitCount ? read(mode.alphaBitCount) << parityBitCount : 255;
  if (parityBitCount) {
    for (let subsetIndex = 0; subsetIndex < mode.subsetCount; subsetIndex++) {
      const firstParityNumber = read(1);
      const secondParityNumber = mode.sharedParityBitCount ? firstParityNumber : read(1);
      for (let channelIndex = 0; channelIndex < (mode.alphaBitCount ? 4 : 3); channelIndex++) {
        endpoints[channelIndex]![subsetIndex * 2]! |= firstParityNumber;
        endpoints[channelIndex]![subsetIndex * 2 + 1]! |= secondParityNumber;
      }
    }
  }
  const expandQuantized = (quantizedNumber: number, bitCount: number) => {
    const shiftedByte = (quantizedNumber << (8 - bitCount)) & 255;
    return shiftedByte | (shiftedByte >> bitCount);
  };
  for (let channelIndex = 0; channelIndex < 4; channelIndex++) {
    const bitCount = (channelIndex === 3 ? mode.alphaBitCount : mode.colorBitCount) + parityBitCount;
    if (channelIndex === 3 && !mode.alphaBitCount) continue;
    for (let endpointIndex = 0; endpointIndex < endpointCount; endpointIndex++) endpoints[channelIndex]![endpointIndex] = expandQuantized(endpoints[channelIndex]![endpointIndex]!, bitCount);
  }
  const firstWeights = BC7_WEIGHTS[mode.firstIndexBitCount - 2]!;
  const secondWeights = mode.secondIndexBitCount ? BC7_WEIGHTS[mode.secondIndexBitCount - 2]! : firstWeights;
  const indexStartIndexes = [bitIndex, bitIndex + mode.subsetCount * (16 * mode.firstIndexBitCount - 1)];
  for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++) {
    let subsetIndex = 0;
    let anchorIndex = 0;
    if (mode.subsetCount === 2) {
      subsetIndex = (BC7_PARTITIONS_2[partitionIndex]! >> pixelIndex) & 1;
      anchorIndex = subsetIndex ? BC7_ANCHORS_2[partitionIndex]! : 0;
    } else if (mode.subsetCount === 3) {
      subsetIndex = (BC7_PARTITIONS_3[partitionIndex]! >>> (2 * pixelIndex)) & 3;
      anchorIndex = subsetIndex ? BC7_ANCHORS_3[subsetIndex - 1]![partitionIndex]! : 0;
    }
    // An anchor pixel's index leaves out its top bit, which is always 0.
    const isAnchor = pixelIndex === anchorIndex ? 1 : 0;
    const firstReadBitCount = mode.firstIndexBitCount - isAnchor;
    const secondReadBitCount = mode.secondIndexBitCount ? mode.secondIndexBitCount - isAnchor : 0;
    const firstWeightIndex = readBits(block, indexStartIndexes[0]!, firstReadBitCount);
    const secondWeightIndex = mode.secondIndexBitCount ? readBits(block, indexStartIndexes[1]!, secondReadBitCount) : firstWeightIndex;
    indexStartIndexes[0]! += firstReadBitCount;
    indexStartIndexes[1]! += secondReadBitCount;
    const weightsBySelection = [firstWeights[firstWeightIndex]!, secondWeights[secondWeightIndex]!];
    const colorWeightNumber = weightsBySelection[selectionNumber]!;
    const alphaWeightNumber = weightsBySelection[selectionNumber ? 0 : 1]!;
    const mix = (channelIndex: number, weightNumber: number) => (endpoints[channelIndex]![subsetIndex * 2]! * (64 - weightNumber) + endpoints[channelIndex]![subsetIndex * 2 + 1]! * weightNumber + 32) >> 6;
    const color = [mix(0, colorWeightNumber), mix(1, colorWeightNumber), mix(2, colorWeightNumber), mix(3, alphaWeightNumber)];
    if (rotationNumber) [color[3], color[rotationNumber - 1]] = [color[rotationNumber - 1]!, color[3]!];
    setPixel(out, pixelIndex, color);
  }
}

// ETC1, ETC2 and EAC.

const ETC1_MODIFIERS = [
  [2, 8],
  [5, 17],
  [9, 29],
  [13, 42],
  [18, 60],
  [24, 80],
  [33, 106],
  [47, 183],
];
const ETC2_DISTANCES = [3, 6, 11, 16, 23, 32, 41, 64];
const ETC_SUBBLOCKS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
];
/** ETC numbers its pixels down each column; this is where each pixel of that order goes in a row-by-row block. */
const ETC_WRITE_ORDER = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
const EAC_MODIFIERS = [
  [-3, -6, -9, -15, 2, 5, 8, 14],
  [-3, -7, -10, -13, 2, 6, 9, 12],
  [-2, -5, -8, -13, 1, 4, 7, 12],
  [-2, -4, -6, -13, 1, 3, 5, 12],
  [-3, -6, -8, -12, 2, 5, 7, 11],
  [-3, -7, -9, -11, 2, 6, 8, 10],
  [-4, -7, -8, -11, 3, 6, 7, 10],
  [-3, -5, -8, -11, 2, 4, 7, 10],
  [-2, -6, -8, -10, 1, 5, 7, 9],
  [-2, -5, -8, -10, 1, 4, 7, 9],
  [-2, -4, -8, -10, 1, 3, 7, 9],
  [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9],
  [-1, -2, -3, -10, 0, 1, 2, 9],
  [-4, -6, -8, -9, 3, 5, 7, 8],
  [-3, -5, -7, -9, 2, 4, 6, 8],
];

function decodeEtc2Color(block: Uint8Array, out: Uint8Array, kind: "etc1" | "rgb" | "rgba1"): void {
  let lowIndexBitsNumber = (block[6]! << 8) | block[7]!;
  let highIndexBitsNumber = (block[4]! << 8) | block[5]!;
  // Punch-through alpha has no individual mode: its "differential" bit says whether the block is opaque.
  const isOpaque = kind !== "rgba1" || (block[3]! & 2) !== 0;
  const isDifferential = kind === "rgba1" || (block[3]! & 2) !== 0;
  const put = (pixelIndex: number, color: number[], isTransparent = false) => setPixel(out, ETC_WRITE_ORDER[pixelIndex]!, isTransparent ? [0, 0, 0, 0] : [color[0]!, color[1]!, color[2]!, 255]);
  const shifted = (color: number[], modifierNumber: number) => color.map((channelByte) => clampByte(channelByte + modifierNumber));
  const subblocks = (baseColors: number[][]) => {
    const tableIndexes = [block[3]! >> 5, (block[3]! >> 2) & 7];
    const subblockOfPixel = ETC_SUBBLOCKS[block[3]! & 1]!;
    for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++, lowIndexBitsNumber >>= 1, highIndexBitsNumber >>= 1) {
      const subblockIndex = subblockOfPixel[pixelIndex]!;
      const isNegative = (highIndexBitsNumber & 1) === 1;
      const isLarge = (lowIndexBitsNumber & 1) === 1;
      const modifierNumber = !isOpaque && !isLarge ? 0 : ETC1_MODIFIERS[tableIndexes[subblockIndex]!]![isLarge ? 1 : 0]!;
      put(pixelIndex, shifted(baseColors[subblockIndex]!, isNegative ? -modifierNumber : modifierNumber), !isOpaque && isNegative && !isLarge);
    }
  };
  const highNibble = (packedByte: number) => (packedByte & 0xf0) | (packedByte >> 4);
  const lowNibble = (packedByte: number) => (packedByte & 0x0f) | ((packedByte << 4) & 0xf0);
  if (!isDifferential) {
    subblocks([[0, 1, 2].map((channelIndex) => highNibble(block[channelIndex]!)), [0, 1, 2].map((channelIndex) => lowNibble(block[channelIndex]!))]);
    return;
  }
  const base = [0, 1, 2].map((channelIndex) => block[channelIndex]! & 0xf8);
  const deltas = [0, 1, 2].map((channelIndex) => ((block[channelIndex]! << 3) & 0x18) - ((block[channelIndex]! << 3) & 0x20));
  const overflows = [0, 1, 2].map((channelIndex) => base[channelIndex]! + deltas[channelIndex]! < 0 || base[channelIndex]! + deltas[channelIndex]! > 255);
  if (kind === "etc1" || !overflows.some(Boolean)) {
    const second = base.map((channelByte, channelIndex) => channelByte + deltas[channelIndex]!);
    subblocks([base.map((channelByte) => channelByte | (channelByte >> 5)), second.map((channelByte) => channelByte | (channelByte >> 5))]);
    return;
  }
  const indexed = (colors: number[][]) => {
    highIndexBitsNumber <<= 1;
    for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++, lowIndexBitsNumber >>= 1, highIndexBitsNumber >>= 1) {
      const colorIndex = (highIndexBitsNumber & 2) | (lowIndexBitsNumber & 1);
      put(pixelIndex, colors[colorIndex]!, !isOpaque && colorIndex === 2);
    }
  };
  if (overflows[0]) {
    // T mode.
    const first = [((block[0]! << 3) & 0xc0) | ((block[0]! << 4) & 0x30) | ((block[0]! >> 1) & 0xc) | (block[0]! & 3), highNibble(block[1]!), lowNibble(block[1]!)];
    const second = [highNibble(block[2]!), lowNibble(block[2]!), highNibble(block[3]!)];
    const distanceNumber = ETC2_DISTANCES[((block[3]! >> 1) & 6) | (block[3]! & 1)]!;
    indexed([first, shifted(second, distanceNumber), second, shifted(second, -distanceNumber)]);
  } else if (overflows[1]) {
    // H mode.
    const first = [((block[0]! << 1) & 0xf0) | ((block[0]! >> 3) & 0xf), ((block[0]! << 5) & 0xe0) | (block[1]! & 0x10), (block[1]! & 8) | ((block[1]! << 1) & 6) | (block[2]! >> 7)];
    first[1] = first[1]! | (first[1]! >> 4);
    first[2] = first[2]! | ((first[2]! << 4) & 0xf0);
    const second = [((block[2]! << 1) & 0xf0) | ((block[2]! >> 3) & 0xf), ((block[2]! << 5) & 0xe0) | ((block[3]! >> 3) & 0x10), ((block[3]! << 1) & 0xf0) | ((block[3]! >> 3) & 0xf)];
    second[1] = second[1]! | (second[1]! >> 4);
    let distanceIndex = (block[3]! & 4) | ((block[3]! << 1) & 2);
    if (first[0]! > second[0]! || (first[0] === second[0] && (first[1]! > second[1]! || (first[1] === second[1] && first[2]! >= second[2]!)))) distanceIndex++;
    const distanceNumber = ETC2_DISTANCES[distanceIndex]!;
    indexed([shifted(first, distanceNumber), shifted(first, -distanceNumber), shifted(second, distanceNumber), shifted(second, -distanceNumber)]);
  } else {
    // Planar mode.
    const origin = [((block[0]! << 1) & 0xfc) | ((block[0]! >> 5) & 3), ((block[0]! << 7) & 0x80) | (block[1]! & 0x7e) | (block[0]! & 1), ((block[1]! << 7) & 0x80) | ((block[2]! << 2) & 0x60) | ((block[2]! << 3) & 0x18) | ((block[3]! >> 5) & 4)];
    origin[2] = origin[2]! | (origin[2]! >> 6);
    const horizontal = [((block[3]! << 1) & 0xf8) | ((block[3]! << 2) & 4) | ((block[3]! >> 5) & 3), (block[4]! & 0xfe) | (block[4]! >> 7), ((block[4]! << 7) & 0x80) | ((block[5]! >> 1) & 0x7c)];
    horizontal[2] = horizontal[2]! | (horizontal[2]! >> 6);
    const vertical = [((block[5]! << 5) & 0xe0) | ((block[6]! >> 3) & 0x1c) | ((block[5]! >> 1) & 3), ((block[6]! << 3) & 0xf8) | ((block[7]! >> 5) & 0x6) | ((block[6]! >> 4) & 1), ((block[7]! << 2) & 0xfc) | ((block[7]! >> 4) & 3)];
    for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
      for (let columnIndex = 0; columnIndex < 4; columnIndex++) {
        const channel = (channelIndex: number) => clampByte((columnIndex * (horizontal[channelIndex]! - origin[channelIndex]!) + rowIndex * (vertical[channelIndex]! - origin[channelIndex]!) + 4 * origin[channelIndex]! + 2) >> 2);
        setPixel(out, rowIndex * 4 + columnIndex, [channel(0), channel(1), channel(2), 255]);
      }
    }
  }
}

function decodeEtc2Alpha(block: Uint8Array, out: Uint8Array): void {
  const baseByte = block[0]!;
  const multiplierNumber = block[1]! >> 4;
  const modifiers = EAC_MODIFIERS[block[1]! & 15]!;
  for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++) {
    // 48 bits of 3-bit indices, most significant first, numbered down each column.
    const bitIndex = 16 + pixelIndex * 3;
    let modifierIndex = 0;
    for (let offsetIndex = 0; offsetIndex < 3; offsetIndex++) modifierIndex = (modifierIndex << 1) | ((block[(bitIndex + offsetIndex) >> 3]! >> (7 - ((bitIndex + offsetIndex) & 7))) & 1);
    out[ETC_WRITE_ORDER[pixelIndex]! * 4 + 3] = multiplierNumber ? clampByte(baseByte + multiplierNumber * modifiers[modifierIndex]!) : baseByte;
  }
}

// ASTC, low dynamic range: blocks using its high-dynamic-range endpoint modes decode to magenta, like an error block.

const ASTC_WEIGHT_DIGIT_RANGES = [0, 0, 0, 3, 0, 5, 3, 0, 0, 0, 5, 3, 0, 5, 3, 0];
const ASTC_WEIGHT_BIT_COUNTS = [0, 0, 1, 0, 2, 0, 1, 3, 0, 0, 1, 2, 4, 2, 3, 5];
const ASTC_ENDPOINT_DIGIT_RANGES = [0, 3, 5, 0, 3, 5, 0, 3, 5, 0, 3, 5, 0, 3, 5, 0, 3, 0, 0];
const ASTC_ENDPOINT_BIT_COUNTS = [8, 6, 5, 7, 5, 4, 6, 4, 3, 5, 3, 2, 4, 2, 1, 3, 1, 2, 1];
const ASTC_HIGH_DYNAMIC_RANGE_MODES = new Set([2, 3, 7, 11, 14, 15]);
const MAGENTA = [255, 0, 255, 255];

/** The trit (5 per 8 bits) and quint (3 per 7 bits) digits each packed value holds, one string per digit position. */
const digitsOf = (digits: string) => [...digits].map(Number);
const TRITS = [
  "0120012101220122012001210122012001200121012201220120012101220121012001210122012201200121012201220120012101220122012001210122012201200121012201220120012101220120012001210122012201200121012201210120012101220122012001210122012201200121012201220120012101220122",
  "0000111022202220000111112221000000001110222022200001111122211110000011102220222000011111222122200000111022202220000111112221222000001110222022200001111122210001000011102220222000011111222111110000111022202220000111112221222100001110222022200001111122212221",
  "0002000200022222111211121112000200020002000222221112111211120002000200020002222211121112111200020002000200022222111211121112222200020002000222221112111211121112000200020002222211121112111211120002000200022222111211121112111200020002000222221112111211122222",
  "0000000000000000000000000000222211111111111111111111111111112222222222222222222222222222222222220000000000000000000000000000222200000000000000000000000000002222111111111111111111111111111122222222222222222222222222222222222211111111111111111111111111112222",
  "0000000000000000000000000000222200000000000000000000000000002222000000000000000000000000000022222222222222222222222222222222222211111111111111111111111111112222111111111111111111111111111122221111111111111111111111111111222222222222222222222222222222222222",
].map(digitsOf);
const QUINTS = [
  "01234044012341440123424401234344012340400123414101234242012343430123402301234123012342230123432301234001012341010123420101234301",
  "00000444111114442222244433333444000004041111141422222424333334340000040011111411222224223333343300000400111114112222242233333433",
  "00000004000000140000002400000034111111441111114411111144111111442222224422222244222222442222224433333344333333443333334433333344",
].map(digitsOf);

interface AstcParameters {
  blockWidthPixelCount: number;
  blockHeightPixelCount: number;
  gridColumnCount: number;
  gridRowCount: number;
  partitionCount: number;
  isDualPlane: boolean;
  planeSelectorIndex: number;
  weightRangeIndex: number;
  weightCount: number;
  endpointModes: number[];
  endpointRangeIndex: number;
  endpointValueCount: number;
  endpoints: number[][];
}

/** bitsNumber holds a value's low bits, digitNumber its trit or quint (0 when the range has none). */
interface SequenceValue {
  bitsNumber: number;
  digitNumber: number;
}

/** bitCount bits of packedNumber (up to 48 bits) from shiftCount on. */
const bitsOfNumber = (packedNumber: number, shiftCount: number, bitCount: number) => Math.floor(packedNumber / 2 ** shiftCount) % 2 ** bitCount;

/** The values of an integer sequence (bits and a trit or quint each, by digitRangeNumber 3 or 5), read forward from bitIndex. */
function decodeIntegerSequence(bytes: Uint8Array, bitIndex: number, digitRangeNumber: number, bitCount: number, valueCount: number): SequenceValue[] {
  const values: SequenceValue[] = [];
  if (digitRangeNumber === 0) {
    for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) values.push({ bitsNumber: readBits(bytes, bitIndex + valueIndex * bitCount, bitCount), digitNumber: 0 });
    return values;
  }
  // Trits come five to a group in 8 bits, quints three to a group in 7, spread between the values' bits.
  const isTrits = digitRangeNumber === 3;
  const groupValueCount = isTrits ? 5 : 3;
  const groupBitCount = (isTrits ? 8 : 7) + groupValueCount * bitCount;
  const lastGroupValueCount = ((valueCount + groupValueCount - 1) % groupValueCount) + 1;
  const lastGroupBitCount = Math.floor((groupBitCount * lastGroupValueCount + groupValueCount - 1) / groupValueCount);
  const groupCount = Math.floor((valueCount + groupValueCount - 1) / groupValueCount);
  const valueStartBitCounts = isTrits ? [0, 2, 4, 5, 7] : [0, 3, 5];
  const digitPieces = isTrits
    ? [
        [bitCount, 2, 0],
        [2 * bitCount + 2, 2, 2],
        [3 * bitCount + 4, 1, 4],
        [4 * bitCount + 5, 2, 5],
        [5 * bitCount + 7, 1, 7],
      ]
    : [
        [bitCount, 3, 0],
        [2 * bitCount + 3, 2, 3],
        [3 * bitCount + 5, 2, 5],
      ];
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const packedNumber = readBits(bytes, bitIndex + groupIndex * groupBitCount, groupIndex < groupCount - 1 ? groupBitCount : lastGroupBitCount);
    let packedDigitsNumber = 0;
    for (const [shiftCount, pieceBitCount, targetShiftCount] of digitPieces) packedDigitsNumber |= bitsOfNumber(packedNumber, shiftCount!, pieceBitCount!) << targetShiftCount!;
    for (let digitIndex = 0; digitIndex < groupValueCount && values.length < valueCount; digitIndex++) {
      values.push({ bitsNumber: bitsOfNumber(packedNumber, valueStartBitCounts[digitIndex]! + bitCount * digitIndex, bitCount), digitNumber: (isTrits ? TRITS : QUINTS)[digitIndex]![packedDigitsNumber]! });
    }
  }
  return values;
}

function sequenceBitCount(digitRangeNumber: number, bitCount: number, valueCount: number): number {
  if (digitRangeNumber === 3) return valueCount * bitCount + Math.floor((valueCount * 8 + 4) / 5);
  if (digitRangeNumber === 5) return valueCount * bitCount + Math.floor((valueCount * 7 + 2) / 3);
  return valueCount * bitCount;
}

function decodeAstcBlock(block: Uint8Array, layout: Layout, out: Uint8Array): void {
  const pixelCount = layout.blockWidthPixelCount * layout.blockHeightPixelCount;
  const fill = (color: number[]) => {
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) setPixel(out, pixelIndex, color);
  };
  if (block[0] === 0xfc && (block[1]! & 1) === 1) {
    // A void-extent block: one color, each channel's high byte.
    fill(block[1]! & 2 ? MAGENTA : [block[9]!, block[11]!, block[13]!, block[15]!]);
    return;
  }
  if (((block[0]! & 0xc3) === 0xc0 && (block[1]! & 1) === 1) || (block[0]! & 0xf) === 0) {
    fill(MAGENTA);
    return;
  }
  const parameters = astcParameters(block, layout);
  if (!parameters || parameters.endpointModes.some((modeNumber) => ASTC_HIGH_DYNAMIC_RANGE_MODES.has(modeNumber))) {
    fill(MAGENTA);
    return;
  }
  astcEndpoints(block, parameters);
  const weights = astcWeights(block, parameters);
  const partitions = parameters.partitionCount > 1 ? astcPartitions(block, parameters) : null;
  const planeOfChannel = [0, 0, 0, 0];
  if (parameters.isDualPlane) planeOfChannel[parameters.planeSelectorIndex] = 1;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    const endpoints = parameters.endpoints[partitions ? partitions[pixelIndex]! : 0]!;
    const channel = (channelIndex: number) => {
      const firstEndpointByte = endpoints[channelIndex]!;
      const secondEndpointByte = endpoints[channelIndex + 4]!;
      const weightNumber = weights[pixelIndex * 2 + planeOfChannel[channelIndex]!]!;
      const sixteenBitNumber = (((firstEndpointByte << 8) | firstEndpointByte) * (64 - weightNumber) + ((secondEndpointByte << 8) | secondEndpointByte) * weightNumber + 32) >> 6;
      return Math.floor((sixteenBitNumber * 255 + 32768) / 65536);
    };
    setPixel(out, pixelIndex, [channel(0), channel(1), channel(2), channel(3)]);
  }
}

function astcParameters(block: Uint8Array, layout: Layout): AstcParameters | null {
  const sixteenBits = (startIndex: number) => block[startIndex]! | (block[startIndex + 1]! << 8);
  let isDualPlane = (block[1]! & 4) !== 0;
  let weightRangeIndex = ((block[0]! >> 4) & 1) | ((block[1]! << 2) & 8);
  let gridColumnCount = 0;
  let gridRowCount = 0;
  if (block[0]! & 3) {
    weightRangeIndex |= (block[0]! << 1) & 6;
    const layoutCode = block[0]! & 0xc;
    if (layoutCode === 0) [gridColumnCount, gridRowCount] = [((sixteenBits(0) >> 7) & 3) + 4, ((block[0]! >> 5) & 3) + 2];
    else if (layoutCode === 4) [gridColumnCount, gridRowCount] = [((sixteenBits(0) >> 7) & 3) + 8, ((block[0]! >> 5) & 3) + 2];
    else if (layoutCode === 8) [gridColumnCount, gridRowCount] = [((block[0]! >> 5) & 3) + 2, ((sixteenBits(0) >> 7) & 3) + 8];
    else if (block[1]! & 1) [gridColumnCount, gridRowCount] = [((block[0]! >> 7) & 1) + 2, ((block[0]! >> 5) & 3) + 2];
    else [gridColumnCount, gridRowCount] = [((block[0]! >> 5) & 3) + 2, ((block[0]! >> 7) & 1) + 6];
  } else {
    weightRangeIndex |= (block[0]! >> 1) & 6;
    const layoutCode = sixteenBits(0) & 0x180;
    if (layoutCode === 0) [gridColumnCount, gridRowCount] = [12, ((block[0]! >> 5) & 3) + 2];
    else if (layoutCode === 0x80) [gridColumnCount, gridRowCount] = [((block[0]! >> 5) & 3) + 2, 12];
    else if (layoutCode === 0x100) {
      [gridColumnCount, gridRowCount] = [((block[0]! >> 5) & 3) + 6, ((block[1]! >> 1) & 3) + 6];
      isDualPlane = false;
      weightRangeIndex &= 7;
    } else [gridColumnCount, gridRowCount] = block[0]! & 0x20 ? [10, 6] : [6, 10];
  }
  if (gridColumnCount > layout.blockWidthPixelCount || gridRowCount > layout.blockHeightPixelCount) return null;
  const partitionCount = ((block[1]! >> 3) & 3) + 1;
  const weightCount = gridColumnCount * gridRowCount * (isDualPlane ? 2 : 1);
  if (weightCount > 64) return null;
  const weightBitCount = sequenceBitCount(ASTC_WEIGHT_DIGIT_RANGES[weightRangeIndex]!, ASTC_WEIGHT_BIT_COUNTS[weightRangeIndex]!, weightCount);
  const endpointModes: number[] = [];
  let configBitCount: number;
  let modeBaseNumber = 0;
  if (partitionCount === 1) {
    endpointModes.push((sixteenBits(1) >> 5) & 0xf);
    configBitCount = 17;
  } else {
    modeBaseNumber = (sixteenBits(2) >> 7) & 3;
    if (modeBaseNumber === 0) {
      for (let partitionIndex = 0; partitionIndex < partitionCount; partitionIndex++) endpointModes.push((block[3]! >> 1) & 0xf);
      configBitCount = 29;
    } else {
      for (let partitionIndex = 0; partitionIndex < partitionCount; partitionIndex++) endpointModes.push((((block[3]! >> (partitionIndex + 1)) & 1) + modeBaseNumber - 1) << 2);
      if (partitionCount === 2) {
        endpointModes[0]! |= (block[3]! >> 3) & 3;
        endpointModes[1]! |= readBits(block, 126 - weightBitCount, 2);
      } else if (partitionCount === 3) {
        endpointModes[0]! |= (block[3]! >> 4) & 1;
        endpointModes[0]! |= readBits(block, 122 - weightBitCount, 2) & 2;
        endpointModes[1]! |= readBits(block, 124 - weightBitCount, 2);
        endpointModes[2]! |= readBits(block, 126 - weightBitCount, 2);
      } else for (let partitionIndex = 0; partitionIndex < 4; partitionIndex++) endpointModes[partitionIndex]! |= readBits(block, 120 + partitionIndex * 2 - weightBitCount, 2);
      configBitCount = 25 + partitionCount * 3;
    }
  }
  let planeSelectorIndex = 0;
  if (isDualPlane) {
    configBitCount += 2;
    planeSelectorIndex = readBits(block, modeBaseNumber ? 130 - weightBitCount - partitionCount * 3 : 126 - weightBitCount, 2);
  }
  const remainingBitCount = 128 - configBitCount - weightBitCount;
  const endpointValueCount = endpointModes.reduce((totalCount, modeNumber) => totalCount + ((modeNumber >> 1) & 6) + 2, 0);
  if (endpointValueCount > 18) return null;
  const endpointRangeIndex = ASTC_ENDPOINT_BIT_COUNTS.findIndex((bitCount, rangeIndex) => sequenceBitCount(ASTC_ENDPOINT_DIGIT_RANGES[rangeIndex]!, bitCount, endpointValueCount) <= remainingBitCount);
  if (endpointRangeIndex < 0) return null;
  return { ...layout, gridColumnCount, gridRowCount, partitionCount, isDualPlane, planeSelectorIndex, weightRangeIndex, weightCount, endpointModes, endpointRangeIndex, endpointValueCount, endpoints: [] };
}

function astcEndpoints(block: Uint8Array, parameters: AstcParameters): void {
  const digitRangeNumber = ASTC_ENDPOINT_DIGIT_RANGES[parameters.endpointRangeIndex]!;
  const bitCount = ASTC_ENDPOINT_BIT_COUNTS[parameters.endpointRangeIndex]!;
  const sequence = decodeIntegerSequence(block, parameters.partitionCount === 1 ? 17 : 29, digitRangeNumber, bitCount, parameters.endpointValueCount);
  const values = sequence.map(({ bitsNumber, digitNumber }) => {
    if (digitRangeNumber === 0) {
      return [0, bitsNumber * 0xff, bitsNumber * 0x55, (bitsNumber << 5) | (bitsNumber << 2) | (bitsNumber >> 1), (bitsNumber << 4) | bitsNumber, (bitsNumber << 3) | (bitsNumber >> 2), (bitsNumber << 2) | (bitsNumber >> 4), (bitsNumber << 1) | (bitsNumber >> 6), bitsNumber][bitCount]!;
    }
    const signMaskNumber = (bitsNumber & 1) * 0x1ff;
    const highBitsNumber = bitsNumber >> 1;
    const isTrits = digitRangeNumber === 3;
    const scaleNumber = (isTrits ? [0, 204, 93, 44, 22, 11, 5] : [0, 113, 54, 26, 13, 6])[bitCount]!;
    const spreadNumber = (
      isTrits
        ? [0, 0, 0b100010110 * highBitsNumber, (highBitsNumber << 7) | (highBitsNumber << 2) | highBitsNumber, (highBitsNumber << 6) | highBitsNumber, (highBitsNumber << 5) | (highBitsNumber >> 2), (highBitsNumber << 4) | (highBitsNumber >> 4)]
        : [0, 0, 0b100001100 * highBitsNumber, (highBitsNumber << 7) | (highBitsNumber << 1) | (highBitsNumber >> 1), (highBitsNumber << 6) | (highBitsNumber >> 1), (highBitsNumber << 5) | (highBitsNumber >> 3)]
    )[bitCount]!;
    return (signMaskNumber & 0x80) | (((digitNumber * scaleNumber + spreadNumber) ^ signMaskNumber) >> 2);
  });
  let valueIndex = 0;
  for (const modeNumber of parameters.endpointModes) {
    const pairValueCount = ((modeNumber >> 2) + 1) * 2;
    parameters.endpoints.push(astcEndpointPair(modeNumber, values.slice(valueIndex, valueIndex + pairValueCount)));
    valueIndex += pairValueCount;
  }
}

/** One partition's two endpoints, red, green, blue and alpha each, from its endpoint mode and values. */
function astcEndpointPair(modeNumber: number, values: number[]): number[] {
  const valueAt = (valueIndex: number) => values[valueIndex] ?? 0;
  const clamped = (bytes: number[]) => bytes.map(clampByte);
  // Blue contraction: red and green were stored as their average with blue.
  const blueContracted = (colors: number[]) => [(colors[0]! + colors[2]!) >> 1, (colors[1]! + colors[2]!) >> 1, colors[2]!, colors[3]!, (colors[4]! + colors[6]!) >> 1, (colors[5]! + colors[6]!) >> 1, colors[6]!, colors[7]!];
  // Moves one bit from the high value into the low one, leaving the high value a signed 6-bit offset.
  const transfer = (highIndex: number, lowIndex: number) => {
    values[lowIndex] = (valueAt(lowIndex) >> 1) | (valueAt(highIndex) & 0x80);
    values[highIndex] = (valueAt(highIndex) >> 1) & 0x3f;
    if (valueAt(highIndex) & 0x20) values[highIndex] = valueAt(highIndex) - 0x40;
  };
  switch (modeNumber) {
    case 0:
      return [valueAt(0), valueAt(0), valueAt(0), 255, valueAt(1), valueAt(1), valueAt(1), 255];
    case 1: {
      const firstLuminanceByte = (valueAt(0) >> 2) | (valueAt(1) & 0xc0);
      const secondLuminanceByte = clampByte(firstLuminanceByte + (valueAt(1) & 0x3f));
      return [firstLuminanceByte, firstLuminanceByte, firstLuminanceByte, 255, secondLuminanceByte, secondLuminanceByte, secondLuminanceByte, 255];
    }
    case 4:
      return [valueAt(0), valueAt(0), valueAt(0), valueAt(2), valueAt(1), valueAt(1), valueAt(1), valueAt(3)];
    case 5:
      transfer(1, 0);
      transfer(3, 2);
      return clamped([valueAt(0), valueAt(0), valueAt(0), valueAt(2), valueAt(0) + valueAt(1), valueAt(0) + valueAt(1), valueAt(0) + valueAt(1), valueAt(2) + valueAt(3)]);
    case 6:
      return [(valueAt(0) * valueAt(3)) >> 8, (valueAt(1) * valueAt(3)) >> 8, (valueAt(2) * valueAt(3)) >> 8, 255, valueAt(0), valueAt(1), valueAt(2), 255];
    case 8:
      return valueAt(0) + valueAt(2) + valueAt(4) <= valueAt(1) + valueAt(3) + valueAt(5) ? [valueAt(0), valueAt(2), valueAt(4), 255, valueAt(1), valueAt(3), valueAt(5), 255] : blueContracted([valueAt(1), valueAt(3), valueAt(5), 255, valueAt(0), valueAt(2), valueAt(4), 255]);
    case 9:
      transfer(1, 0);
      transfer(3, 2);
      transfer(5, 4);
      return valueAt(1) + valueAt(3) + valueAt(5) >= 0
        ? clamped([valueAt(0), valueAt(2), valueAt(4), 255, valueAt(0) + valueAt(1), valueAt(2) + valueAt(3), valueAt(4) + valueAt(5), 255])
        : clamped(blueContracted([valueAt(0) + valueAt(1), valueAt(2) + valueAt(3), valueAt(4) + valueAt(5), 255, valueAt(0), valueAt(2), valueAt(4), 255]));
    case 10:
      return [(valueAt(0) * valueAt(3)) >> 8, (valueAt(1) * valueAt(3)) >> 8, (valueAt(2) * valueAt(3)) >> 8, valueAt(4), valueAt(0), valueAt(1), valueAt(2), valueAt(5)];
    case 12:
      return valueAt(0) + valueAt(2) + valueAt(4) <= valueAt(1) + valueAt(3) + valueAt(5) ? [valueAt(0), valueAt(2), valueAt(4), valueAt(6), valueAt(1), valueAt(3), valueAt(5), valueAt(7)] : blueContracted([valueAt(1), valueAt(3), valueAt(5), valueAt(7), valueAt(0), valueAt(2), valueAt(4), valueAt(6)]);
    case 13:
      transfer(1, 0);
      transfer(3, 2);
      transfer(5, 4);
      transfer(7, 6);
      return valueAt(1) + valueAt(3) + valueAt(5) >= 0
        ? clamped([valueAt(0), valueAt(2), valueAt(4), valueAt(6), valueAt(0) + valueAt(1), valueAt(2) + valueAt(3), valueAt(4) + valueAt(5), valueAt(6) + valueAt(7)])
        : clamped(blueContracted([valueAt(0) + valueAt(1), valueAt(2) + valueAt(3), valueAt(4) + valueAt(5), valueAt(6) + valueAt(7), valueAt(0), valueAt(2), valueAt(4), valueAt(6)]));
    default:
      return [...MAGENTA, ...MAGENTA];
  }
}

function astcWeights(block: Uint8Array, parameters: AstcParameters): number[] {
  // Weights are stored backwards from the block's last bit: reading the bit-reversed block forward gets them in order.
  const reversed = new Uint8Array(16);
  for (let byteIndex = 0; byteIndex < 16; byteIndex++) {
    let sourceByte = block[15 - byteIndex]!;
    let flippedByte = 0;
    for (let bitIndex = 0; bitIndex < 8; bitIndex++, sourceByte >>= 1) flippedByte = (flippedByte << 1) | (sourceByte & 1);
    reversed[byteIndex] = flippedByte;
  }
  const digitRangeNumber = ASTC_WEIGHT_DIGIT_RANGES[parameters.weightRangeIndex]!;
  const bitCount = ASTC_WEIGHT_BIT_COUNTS[parameters.weightRangeIndex]!;
  const gridWeights = decodeIntegerSequence(reversed, 0, digitRangeNumber, bitCount, parameters.weightCount).map(({ bitsNumber, digitNumber }) => {
    // Each weight to 0..64.
    if (digitRangeNumber === 0) {
      const weightNumber = [0, bitsNumber ? 63 : 0, (bitsNumber << 4) | (bitsNumber << 2) | bitsNumber, (bitsNumber << 3) | bitsNumber, (bitsNumber << 2) | (bitsNumber >> 2), (bitsNumber << 1) | (bitsNumber >> 4)][bitCount]!;
      return weightNumber > 32 ? weightNumber + 1 : weightNumber;
    }
    if (bitCount === 0) return digitNumber * (digitRangeNumber === 3 ? 32 : 16);
    const spreadNumber =
      digitRangeNumber === 3
        ? [0, digitNumber * 50, digitNumber * 23 + (bitsNumber & 2 ? 0b1000101 : 0), digitNumber * 11 + (((bitsNumber << 4) | (bitsNumber >> 1)) & 0b1100011)][bitCount]!
        : [0, digitNumber * 28, digitNumber * 13 + (bitsNumber & 2 ? 0b1000010 : 0)][bitCount]!;
    const signMaskNumber = (bitsNumber & 1) * 0x7f;
    const weightNumber = (signMaskNumber & 0x20) | ((spreadNumber ^ signMaskNumber) >> 2);
    return weightNumber > 32 ? weightNumber + 1 : weightNumber;
  });
  // Infill from the weight grid to every pixel.
  const { blockWidthPixelCount, blockHeightPixelCount, gridColumnCount, gridRowCount } = parameters;
  const planeCount = parameters.isDualPlane ? 2 : 1;
  const columnStepNumber = Math.floor((1024 + Math.floor(blockWidthPixelCount / 2)) / (blockWidthPixelCount - 1));
  const rowStepNumber = Math.floor((1024 + Math.floor(blockHeightPixelCount / 2)) / (blockHeightPixelCount - 1));
  const weights = new Array<number>(blockWidthPixelCount * blockHeightPixelCount * 2).fill(0);
  const gridWeight = (gridIndex: number, planeIndex: number) => gridWeights[gridIndex * planeCount + planeIndex] ?? 0;
  for (let rowIndex = 0, pixelIndex = 0; rowIndex < blockHeightPixelCount; rowIndex++) {
    for (let columnIndex = 0; columnIndex < blockWidthPixelCount; columnIndex++, pixelIndex++) {
      const gridColumnNumber = (columnStepNumber * columnIndex * (gridColumnCount - 1) + 32) >> 6;
      const gridRowNumber = (rowStepNumber * rowIndex * (gridRowCount - 1) + 32) >> 6;
      const columnFractionNumber = gridColumnNumber & 0xf;
      const rowFractionNumber = gridRowNumber & 0xf;
      const gridIndex = (gridColumnNumber >> 4) + (gridRowNumber >> 4) * gridColumnCount;
      const bothFractionsNumber = (columnFractionNumber * rowFractionNumber + 8) >> 4;
      const shares = [16 - columnFractionNumber - rowFractionNumber + bothFractionsNumber, columnFractionNumber - bothFractionsNumber, rowFractionNumber - bothFractionsNumber, bothFractionsNumber];
      const neighbors = [gridIndex, gridIndex + 1, gridIndex + gridColumnCount, gridIndex + gridColumnCount + 1];
      for (let planeIndex = 0; planeIndex < planeCount; planeIndex++) {
        weights[pixelIndex * 2 + planeIndex] = (neighbors.reduce((totalNumber, neighborIndex, shareIndex) => totalNumber + gridWeight(neighborIndex, planeIndex) * shares[shareIndex]!, 0) + 8) >> 4;
      }
    }
  }
  return weights;
}

function astcPartitions(block: Uint8Array, parameters: AstcParameters): number[] {
  const isSmallBlock = parameters.blockWidthPixelCount * parameters.blockHeightPixelCount < 31;
  const seedNumber = (((block[1]! | (block[2]! << 8) | (block[3]! << 16)) >> 5) & 0x3ff) | ((parameters.partitionCount - 1) << 10);
  let randomNumber = seedNumber >>> 0;
  randomNumber = (randomNumber ^ (randomNumber >>> 15)) >>> 0;
  randomNumber = (randomNumber - (randomNumber << 17)) >>> 0;
  randomNumber = (randomNumber + (randomNumber << 7)) >>> 0;
  randomNumber = (randomNumber + (randomNumber << 4)) >>> 0;
  randomNumber = (randomNumber ^ (randomNumber >>> 5)) >>> 0;
  randomNumber = (randomNumber + (randomNumber << 16)) >>> 0;
  randomNumber = (randomNumber ^ (randomNumber >>> 7)) >>> 0;
  randomNumber = (randomNumber ^ (randomNumber >>> 3)) >>> 0;
  randomNumber = (randomNumber ^ (randomNumber << 6)) >>> 0;
  randomNumber = (randomNumber ^ (randomNumber >>> 17)) >>> 0;
  const shiftCounts = [seedNumber & 2 ? 4 : 5, parameters.partitionCount === 3 ? 6 : 5];
  const seeds = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ((randomNumber >>> (i * 4)) & 0xf) ** 2 >> (seedNumber & 1 ? shiftCounts[i % 2]! : shiftCounts[1 - (i % 2)]!));
  const partitions: number[] = [];
  for (let rowIndex = 0; rowIndex < parameters.blockHeightPixelCount; rowIndex++) {
    for (let columnIndex = 0; columnIndex < parameters.blockWidthPixelCount; columnIndex++) {
      const scaledColumnNumber = isSmallBlock ? columnIndex << 1 : columnIndex;
      const scaledRowNumber = isSmallBlock ? rowIndex << 1 : rowIndex;
      const scores = [0, 1, 2, 3].map((i) => (i >= parameters.partitionCount ? 0 : (seeds[i * 2]! * scaledColumnNumber + seeds[i * 2 + 1]! * scaledRowNumber + (randomNumber >>> (14 - i * 4))) & 0x3f));
      partitions.push(scores.indexOf(Math.max(...scores)));
    }
  }
  return partitions;
}
