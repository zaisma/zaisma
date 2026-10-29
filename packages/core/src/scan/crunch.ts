/**
 * Crunched textures unpacked back into the GPU blocks they stand for (DXT1, DXT5, ETC1, ETC2 RGBA8), so
 * textures.ts decodes them like any other. Crunch stores a texture as palettes of block endpoints and selectors
 * plus Huffman-coded indices into them. Unity's fork changed how the indices and selectors are packed (Unity
 * 2017.3 on); older builds use the original, so both are read.
 *
 * The decoder follows crn_decomp.h from Unity's fork of crunch (Unity-Technologies/crunch, branch unity) and the
 * original (BinomialLLC/crunch), both zlib License: Copyright (c) 2010-2016 Richard Geldreich, Jr. and Binomial LLC,
 * with Unity Technologies' 2017 changes.
 */

import { MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT } from "./textures.ts";

/** The GPU block format a crunched texture unpacks to. */
export type CrunchFormat = "dxt1" | "dxt5" | "etc1" | "etc2a";

/** One of a crunched file's palettes: where its packed entries start, their size and how many there are. */
interface CrunchPalette {
  startIndex: number;
  sizeBytes: number;
  entryCount: number;
}

/** A crunched file's header, read and checked. */
export interface CrunchHeader {
  widthPixelCount: number;
  heightPixelCount: number;
  levelCount: number;
  crunchFormat: CrunchFormat;
  /** The whole crunched file's size, header included. */
  dataSizeBytes: number;
  /** Crunch's own format number, which says how the palettes and indices are packed. */
  formatNumber: number;
  colorEndpoints: CrunchPalette;
  colorSelectors: CrunchPalette;
  alphaEndpoints: CrunchPalette;
  alphaSelectors: CrunchPalette;
  /** The Huffman tables the level indices are coded with. */
  tables: { startIndex: number; sizeBytes: number };
  /** Where each mip level's coded indices start; each runs to the next one, the last to the file's end. */
  levelStartIndexes: number[];
}

const CRUNCH_SIGNATURE_NUMBER = 0x4878; // "Hx"
/** The header's fixed part; four bytes for each level's start follow it. */
const CRUNCH_HEADER_FIXED_SIZE_BYTES = 70;
/** Enough of a crunched file to read its header with 16 mip levels, the most crunch writes. */
export const CRUNCH_HEADER_MAXIMUM_SIZE_BYTES = CRUNCH_HEADER_FIXED_SIZE_BYTES + 4 * 16;

/** Crunch's format numbers for the color formats decoded; ETC1S and ETC2AS are Unity's ETC without subblocks. */
const CRUNCH_FORMATS: Record<number, CrunchFormat> = { 0: "dxt1", 2: "dxt5", 10: "etc1", 11: "etc1", 12: "etc2a", 13: "etc1", 14: "etc2a" };
const DXT1_FORMAT_NUMBER = 0;
const ETC1_FORMAT_NUMBER = 10;
const ETC2_FORMAT_NUMBER = 11;
const ETC2_ALPHA_FORMAT_NUMBER = 12;
const ETC1_WHOLE_BLOCK_FORMAT_NUMBER = 13;
const ETC2_ALPHA_WHOLE_BLOCK_FORMAT_NUMBER = 14;

/**
 * A crunched file's header from its first bytes (CRUNCH_HEADER_MAXIMUM_SIZE_BYTES are enough), or null when it
 * isn't one Zaisma unpacks. dataSizeBytes is how big the whole file is; a header claiming more was misread. The
 * header's checksum isn't required to match: crunch's own unpacker never checks it, so a game shows a texture
 * whose checksum is wrong, and it must be matched all the same.
 */
export function readCrunchHeader(bytes: Uint8Array, dataSizeBytes = bytes.length): CrunchHeader | null {
  if (bytes.length < CRUNCH_HEADER_FIXED_SIZE_BYTES + 4) return null;
  const numberAt = (index: number, sizeBytes: number) => {
    let readNumber = 0;
    for (let offsetIndex = 0; offsetIndex < sizeBytes; offsetIndex++) readNumber = readNumber * 256 + bytes[index + offsetIndex]!;
    return readNumber;
  };
  if (numberAt(0, 2) !== CRUNCH_SIGNATURE_NUMBER) return null;
  const headerSizeBytes = numberAt(2, 2);
  const fileSizeBytes = numberAt(6, 4);
  const widthPixelCount = numberAt(12, 2);
  const heightPixelCount = numberAt(14, 2);
  const levelCount = bytes[16]!;
  const faceCount = bytes[17]!;
  const formatNumber = bytes[18]!;
  const flagsCode = numberAt(19, 2);
  const crunchFormat = CRUNCH_FORMATS[formatNumber];
  // One face (cube maps aren't Texture2D), level data inside the file (not "segmented").
  if (!crunchFormat || faceCount !== 1 || flagsCode & 1) return null;
  if (widthPixelCount < 1 || heightPixelCount < 1 || widthPixelCount > MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT || heightPixelCount > MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT) return null;
  if (levelCount < 1 || levelCount > Math.floor(Math.log2(Math.max(widthPixelCount, heightPixelCount))) + 1) return null;
  if (headerSizeBytes < CRUNCH_HEADER_FIXED_SIZE_BYTES + 4 * levelCount || bytes.length < CRUNCH_HEADER_FIXED_SIZE_BYTES + 4 * levelCount) return null;
  if (fileSizeBytes > dataSizeBytes || fileSizeBytes <= headerSizeBytes) return null;
  const palette = (index: number): CrunchPalette | null => {
    const found = { startIndex: numberAt(index, 3), sizeBytes: numberAt(index + 3, 3), entryCount: numberAt(index + 6, 2) };
    return found.entryCount === 0 || (found.sizeBytes > 0 && found.startIndex >= headerSizeBytes && found.startIndex + found.sizeBytes <= fileSizeBytes) ? found : null;
  };
  const colorEndpoints = palette(33);
  const colorSelectors = palette(41);
  const alphaEndpoints = palette(49);
  const alphaSelectors = palette(57);
  if (!colorEndpoints || !colorSelectors || !alphaEndpoints || !alphaSelectors) return null;
  // Color formats need color palettes; DXT5 and ETC2A need alpha ones too.
  const hasAlpha = crunchFormat === "dxt5" || crunchFormat === "etc2a";
  if (!colorEndpoints.entryCount || !colorSelectors.entryCount || (hasAlpha && (!alphaEndpoints.entryCount || !alphaSelectors.entryCount))) return null;
  const tables = { startIndex: numberAt(67, 3), sizeBytes: numberAt(65, 2) };
  if (tables.sizeBytes < 1 || tables.startIndex < headerSizeBytes || tables.startIndex + tables.sizeBytes > fileSizeBytes) return null;
  const levelStartIndexes: number[] = [];
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex++) {
    const startIndex = numberAt(CRUNCH_HEADER_FIXED_SIZE_BYTES + 4 * levelIndex, 4);
    if (startIndex < headerSizeBytes || startIndex >= fileSizeBytes || startIndex <= (levelStartIndexes[levelIndex - 1] ?? -1)) return null;
    levelStartIndexes.push(startIndex);
  }
  return {
    widthPixelCount,
    heightPixelCount,
    levelCount,
    crunchFormat,
    dataSizeBytes: fileSizeBytes,
    formatNumber,
    colorEndpoints,
    colorSelectors,
    alphaEndpoints,
    alphaSelectors,
    tables,
    levelStartIndexes,
  };
}

/**
 * One mip level of a crunched file (bytes holds the whole file) unpacked into plain blocks of its crunchFormat,
 * stored like an uncrunched level: DXT1 or ETC1 8 bytes a block, DXT5 or ETC2 RGBA8 16, rows of blocks top first.
 * Null when the data can't be unpacked. ETC is only in Unity's version. DXT is tried as Unity's, then as the
 * original, since both write the same header: the right one reads the level and each smaller one to its last byte
 * (a level of a few bytes alone can't tell them apart).
 */
export function unpackCrunchLevel(bytes: Uint8Array, header: CrunchHeader, levelIndex: number): Uint8Array | null {
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= header.levelCount || bytes.length < header.dataSizeBytes) return null;
  const versions: CrunchVersion[] = header.crunchFormat === "dxt1" || header.crunchFormat === "dxt5" ? ["unity", "original"] : ["unity"];
  let firstUnpacked: Uint8Array | null = null;
  for (const version of versions) {
    try {
      const codes = readCodes(bytes, header, version);
      const unpacked = unpackLevel(bytes, header, codes, levelIndex);
      firstUnpacked ??= unpacked.blocks;
      let isWholeFileRead = unpacked.isWholeLevelRead;
      for (let smallerLevelIndex = levelIndex + 1; isWholeFileRead && smallerLevelIndex < header.levelCount; smallerLevelIndex++) {
        try {
          isWholeFileRead = unpackLevel(bytes, header, codes, smallerLevelIndex).isWholeLevelRead;
        } catch {
          isWholeFileRead = false;
        }
      }
      if (isWholeFileRead) return unpacked.blocks;
    } catch {
      continue;
    }
  }
  return firstUnpacked;
}

type CrunchVersion = "unity" | "original";

interface UnpackedLevel {
  blocks: Uint8Array;
  /** Whether unpacking read the level's coded indices to their last byte: the version that made it does. */
  isWholeLevelRead: boolean;
}

/** Thrown inside the unpacker on data that can't be unpacked; never leaves this file. */
class CrunchDataError extends Error {}

function fail(message: string): never {
  throw new CrunchDataError(message);
}

/** What a file's levels are unpacked with: its Huffman tables and palettes, read as one version packs them. */
interface Codes {
  version: CrunchVersion;
  models: Models;
  palettes: Palettes;
}

function readCodes(bytes: Uint8Array, header: CrunchHeader, version: CrunchVersion): Codes {
  const tables = new BitReader(bytes, header.tables.startIndex, header.tables.sizeBytes);
  const hasAlpha = header.alphaEndpoints.entryCount > 0;
  const models: Models = {
    referenceModel: readModel(tables),
    colorEndpointModel: readModel(tables),
    colorSelectorModel: readModel(tables),
    alphaEndpointModel: hasAlpha ? readModel(tables) : null,
    alphaSelectorModel: hasAlpha ? readModel(tables) : null,
  };
  const palettes: Palettes = {
    colorEndpoints: readColorEndpoints(bytes, header),
    colorSelectors: version === "unity" ? readUnityColorSelectors(bytes, header) : readOriginalColorSelectors(bytes, header),
    alphaEndpoints: hasAlpha ? readAlphaEndpoints(bytes, header) : new Uint16Array(),
    alphaSelectors: !hasAlpha ? new Uint8Array() : version === "original" ? readOriginalAlphaSelectors(bytes, header) : readUnityAlphaSelectors(bytes, header),
  };
  return { version, models, palettes };
}

function unpackLevel(bytes: Uint8Array, header: CrunchHeader, codes: Codes, levelIndex: number): UnpackedLevel {
  const levelEndIndex = header.levelStartIndexes[levelIndex + 1] ?? header.dataSizeBytes;
  const level = new BitReader(bytes, header.levelStartIndexes[levelIndex]!, levelEndIndex - header.levelStartIndexes[levelIndex]!);
  const blockColumnCount = Math.ceil(Math.max(1, header.widthPixelCount >> levelIndex) / 4);
  const blockRowCount = Math.ceil(Math.max(1, header.heightPixelCount >> levelIndex) / 4);
  const blockSizeBytes = header.crunchFormat === "dxt1" || header.crunchFormat === "etc1" ? 8 : 16;
  const out = new BlockWriter(blockColumnCount, blockRowCount, blockSizeBytes);
  const { models, palettes } = codes;
  if (codes.version === "original") unpackOriginal(level, models, palettes, out, header.crunchFormat === "dxt5");
  else if (header.formatNumber === DXT1_FORMAT_NUMBER || header.formatNumber === ETC1_WHOLE_BLOCK_FORMAT_NUMBER) unpackUnityDxt(level, models, palettes, out, false);
  else if (header.formatNumber === ETC1_FORMAT_NUMBER || header.formatNumber === ETC2_FORMAT_NUMBER || header.formatNumber === ETC2_ALPHA_FORMAT_NUMBER) unpackUnityEtc(level, models, palettes, out, header.formatNumber === ETC2_ALPHA_FORMAT_NUMBER);
  else unpackUnityDxt(level, models, palettes, out, true);
  // The encoder pads a level's last byte with up to 7 zero bits, so the right version ends within it.
  return { blocks: out.bytes, isWholeLevelRead: !level.isPastEnd && level.unreadBitCount < 16 };
}

// Bits and Huffman codes.

/** Bits read most significant first from part of the bytes; bits past its end read as 0, as crunch reads them. */
class BitReader {
  readonly bytes: Uint8Array;
  readonly startIndex: number;
  readonly endBitIndex: number;
  bitIndex = 0;

  constructor(bytes: Uint8Array, startIndex: number, sizeBytes: number) {
    if (sizeBytes < 1 || startIndex + sizeBytes > bytes.length) fail("A part past the data's end");
    this.bytes = bytes;
    this.startIndex = startIndex;
    this.endBitIndex = sizeBytes * 8;
  }

  get isPastEnd(): boolean {
    return this.bitIndex > this.endBitIndex;
  }

  get unreadBitCount(): number {
    return this.endBitIndex - this.bitIndex;
  }

  bit(): number {
    const bitIndex = this.bitIndex++;
    if (bitIndex >= this.endBitIndex) return 0;
    return (this.bytes[this.startIndex + (bitIndex >> 3)]! >> (7 - (bitIndex & 7))) & 1;
  }

  bits(bitCount: number): number {
    let readNumber = 0;
    for (let offsetIndex = 0; offsetIndex < bitCount; offsetIndex++) readNumber = readNumber * 2 + this.bit();
    return readNumber;
  }
}

/** A canonical Huffman code: symbols sorted by code size then number, and where each size's codes begin. */
interface HuffmanModel {
  symbolCount: number;
  /** By code size from 1 to 16: the first code of that size, how many there are, and where in sortedSymbols they start. */
  firstCodes: Int32Array;
  codeCounts: Int32Array;
  sortedStartIndexes: Int32Array;
  sortedSymbols: Uint16Array;
}

const MAXIMUM_CODE_BIT_COUNT = 16;
const MAXIMUM_SYMBOL_COUNT = 8192;

function huffmanModel(codeBitCounts: Uint8Array): HuffmanModel {
  const codeCounts = new Int32Array(MAXIMUM_CODE_BIT_COUNT + 1);
  for (const codeBitCount of codeBitCounts) if (codeBitCount) codeCounts[codeBitCount]!++;
  const firstCodes = new Int32Array(MAXIMUM_CODE_BIT_COUNT + 1);
  const sortedStartIndexes = new Int32Array(MAXIMUM_CODE_BIT_COUNT + 1);
  let code = 0;
  let sortedCount = 0;
  for (let codeBitCount = 1; codeBitCount <= MAXIMUM_CODE_BIT_COUNT; codeBitCount++) {
    firstCodes[codeBitCount] = code;
    sortedStartIndexes[codeBitCount] = sortedCount;
    code = (code + codeCounts[codeBitCount]!) * 2;
    sortedCount += codeCounts[codeBitCount]!;
  }
  const sortedSymbols = new Uint16Array(sortedCount);
  const nextIndexes = sortedStartIndexes.slice();
  codeBitCounts.forEach((codeBitCount, symbolNumber) => {
    if (codeBitCount) sortedSymbols[nextIndexes[codeBitCount]!++] = symbolNumber;
  });
  return { symbolCount: codeBitCounts.length, firstCodes, codeCounts, sortedStartIndexes, sortedSymbols };
}

function decodeSymbol(reader: BitReader, model: HuffmanModel | null): number {
  if (!model) fail("A model that isn't there");
  let code = 0;
  for (let codeBitCount = 1; codeBitCount <= MAXIMUM_CODE_BIT_COUNT; codeBitCount++) {
    code = code * 2 + reader.bit();
    const offsetIndex = code - model.firstCodes[codeBitCount]!;
    if (offsetIndex >= 0 && offsetIndex < model.codeCounts[codeBitCount]!) return model.sortedSymbols[model.sortedStartIndexes[codeBitCount]! + offsetIndex]!;
  }
  fail("Not a code");
}

/** The code sizes are sent coded too, most likely sizes first, with runs of zeros and repeats. */
const CODE_SIZE_SYMBOL_ORDER = [17, 18, 19, 20, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15, 16];

/** A Huffman model as crunch sends it; null when it sends none (no symbols). */
function readModel(reader: BitReader): HuffmanModel | null {
  const symbolCount = reader.bits(14);
  if (!symbolCount) return null;
  if (symbolCount > MAXIMUM_SYMBOL_COUNT) fail("Too many symbols");
  const sentSizeCount = reader.bits(5);
  if (sentSizeCount < 1 || sentSizeCount > CODE_SIZE_SYMBOL_ORDER.length) fail("Bad code size count");
  const sizeCodeBitCounts = new Uint8Array(CODE_SIZE_SYMBOL_ORDER.length);
  for (let sentIndex = 0; sentIndex < sentSizeCount; sentIndex++) sizeCodeBitCounts[CODE_SIZE_SYMBOL_ORDER[sentIndex]!] = reader.bits(3);
  const sizeModel = huffmanModel(sizeCodeBitCounts);
  const codeBitCounts = new Uint8Array(symbolCount);
  for (let symbolIndex = 0; symbolIndex < symbolCount; ) {
    const remainingCount = symbolCount - symbolIndex;
    const sizeSymbolNumber = decodeSymbol(reader, sizeModel);
    if (sizeSymbolNumber <= 16) {
      codeBitCounts[symbolIndex++] = sizeSymbolNumber;
      continue;
    }
    const runCount = sizeSymbolNumber === 17 ? reader.bits(3) + 3 : sizeSymbolNumber === 18 ? reader.bits(7) + 11 : sizeSymbolNumber === 19 ? reader.bits(2) + 3 : reader.bits(6) + 7;
    if (runCount > remainingCount) fail("A run past the last symbol");
    if (sizeSymbolNumber <= 18) {
      symbolIndex += runCount;
      continue;
    }
    const repeatedBitCount = symbolIndex ? codeBitCounts[symbolIndex - 1]! : 0;
    if (!repeatedBitCount) fail("A repeat of nothing");
    codeBitCounts.fill(repeatedBitCount, symbolIndex, symbolIndex + runCount);
    symbolIndex += runCount;
  }
  return huffmanModel(codeBitCounts);
}

// Palettes.

interface Palettes {
  /** DXT: both 565 endpoints, the first in the low 16 bits. ETC: the block's first 4 bytes' colors and table, low byte first. */
  colorEndpoints: Uint32Array;
  /** DXT: a block's 32 selector bits. ETC: a block's selector word, two per entry (unflipped, flipped) with subblocks. */
  colorSelectors: Uint32Array;
  /** Both alpha endpoints, the first in the low byte (EAC: base, then multiplier and table). */
  alphaEndpoints: Uint16Array;
  /** Selector bytes: DXT5 and ETC2AS 6 an entry, ETC2A 12 (unflipped, then flipped). */
  alphaSelectors: Uint8Array;
}

const isEtcFormat = (header: CrunchHeader) => header.formatNumber >= ETC1_FORMAT_NUMBER;
const hasSubblocks = (header: CrunchHeader) => header.formatNumber === ETC1_FORMAT_NUMBER || header.formatNumber === ETC2_FORMAT_NUMBER || header.formatNumber === ETC2_ALPHA_FORMAT_NUMBER;

function paletteReader(bytes: Uint8Array, palette: CrunchPalette): BitReader {
  return new BitReader(bytes, palette.startIndex, palette.sizeBytes);
}

/** Endpoints are sent as deltas from the last; the same in both versions for DXT. */
function readColorEndpoints(bytes: Uint8Array, header: CrunchHeader): Uint32Array {
  const reader = paletteReader(bytes, header.colorEndpoints);
  const isEtc = isEtcFormat(header);
  const fiveBitModel = readModel(reader);
  const sixBitModel = isEtc ? null : readModel(reader);
  const endpoints = new Uint32Array(header.colorEndpoints.entryCount);
  const channels = [0, 0, 0, 0, 0, 0];
  let packedNumber = 0;
  for (let entryIndex = 0; entryIndex < endpoints.length; entryIndex++) {
    if (isEtc) {
      // Four 5-bit fields, each a delta byte; carries run into the next field before each is cut to 5 bits.
      for (let shiftCount = 0; shiftCount < 32; shiftCount += 8) packedNumber = (packedNumber + ((decodeSymbol(reader, fiveBitModel) << shiftCount) >>> 0)) >>> 0;
      packedNumber = (packedNumber & 0x1f1f1f1f) >>> 0;
      endpoints[entryIndex] = hasSubblocks(header) ? packedNumber : ((packedNumber & 0x07000000) << 5) | ((packedNumber & 0x07000000) << 2) | 0x02000000 | ((packedNumber & 0x001f1f1f) << 3);
    } else {
      for (const [channelIndex, maximumNumber] of [[0, 31], [1, 63], [2, 31], [3, 31], [4, 63], [5, 31]] as const) {
        channels[channelIndex] = (channels[channelIndex]! + decodeSymbol(reader, maximumNumber === 63 ? sixBitModel : fiveBitModel)) & maximumNumber;
      }
      const [firstRedNumber, firstGreenNumber, firstBlueNumber, secondRedNumber, secondGreenNumber, secondBlueNumber] = channels as [number, number, number, number, number, number];
      endpoints[entryIndex] = firstBlueNumber | (firstGreenNumber << 5) | (firstRedNumber << 11) | (secondBlueNumber << 16) | (secondGreenNumber << 21) | (secondRedNumber << 27);
    }
  }
  return endpoints;
}

/** Unity's selectors: 32 bits sent as 4-bit xors of the last entry, in an order its encoder found smaller. */
function readUnityColorSelectors(bytes: Uint8Array, header: CrunchHeader): Uint32Array {
  const reader = paletteReader(bytes, header.colorSelectors);
  const model = readModel(reader);
  const isEtc = isEtcFormat(header);
  const withSubblocks = hasSubblocks(header);
  const entryCount = header.colorSelectors.entryCount;
  const selectors = new Uint32Array(withSubblocks ? entryCount * 2 : entryCount);
  let linearNumber = 0;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
    for (let shiftCount = 0; shiftCount < 32; shiftCount += 4) linearNumber = (linearNumber ^ (decodeSymbol(reader, model) << shiftCount)) >>> 0;
    if (!isEtc) {
      selectors[entryIndex] = ((linearNumber ^ (linearNumber << 1)) & 0xaaaaaaaa) | ((linearNumber >>> 1) & 0x55555555);
      continue;
    }
    // ETC's selector bits: each pixel's low bit in one half-word and its high bit in the other, by column, and
    // with subblocks once more transposed, for a flipped block.
    const selectorNumber = ((~linearNumber & 0xaaaaaaaa) | (~(linearNumber ^ (linearNumber >>> 1)) & 0x55555555)) >>> 0;
    let selectorShiftCount = 8;
    for (let rowIndex = 0; rowIndex < 4; rowIndex++, selectorShiftCount -= 15) {
      for (let columnIndex = 0; columnIndex < 4; columnIndex++, selectorShiftCount += 4) {
        if (withSubblocks) {
          const flippedBitsNumber = selectorNumber >>> ((columnIndex << 3) | (rowIndex << 1));
          selectors[entryIndex * 2] = selectors[entryIndex * 2]! | ((((flippedBitsNumber >>> 1) & 1) | ((flippedBitsNumber & 1) << 16)) << (selectorShiftCount & 15));
        }
        const pixelBitsNumber = selectorNumber >>> ((rowIndex << 3) | (columnIndex << 1));
        const targetIndex = withSubblocks ? entryIndex * 2 + 1 : entryIndex;
        selectors[targetIndex] = selectors[targetIndex]! | ((((pixelBitsNumber >>> 1) & 1) | ((pixelBitsNumber & 1) << 16)) << (selectorShiftCount & 15));
      }
    }
  }
  return selectors;
}

/** DXT's 2-bit selector for each step from one endpoint to the other, and DXT5 alpha's 3-bit one. */
const DXT1_FROM_LINEAR = [0, 2, 3, 1];
const DXT5_FROM_LINEAR = [0, 2, 3, 4, 5, 6, 7, 1];

/** The original's selectors: 16 steps, sent two at a time as a pair of deltas from the last entry's. */
function readOriginalColorSelectors(bytes: Uint8Array, header: CrunchHeader): Uint32Array {
  return readOriginalSelectors(bytes, header.colorSelectors, 3, (steps) => {
    let selectorNumber = 0;
    for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++) selectorNumber |= DXT1_FROM_LINEAR[steps[pixelIndex]!]! << (pixelIndex * 2);
    return [selectorNumber >>> 0];
  });
}

function readOriginalAlphaSelectors(bytes: Uint8Array, header: CrunchHeader): Uint8Array {
  const words = readOriginalSelectors(bytes, header.alphaSelectors, 7, (steps) => {
    const selectorAt = (pixelIndex: number) => DXT5_FROM_LINEAR[steps[pixelIndex]!]!;
    return [
      (selectorAt(0) | (selectorAt(1) << 3) | (selectorAt(2) << 6) | (selectorAt(3) << 9) | (selectorAt(4) << 12) | (selectorAt(5) << 15)) & 0xffff,
      ((selectorAt(5) >> 1) | (selectorAt(6) << 2) | (selectorAt(7) << 5) | (selectorAt(8) << 8) | (selectorAt(9) << 11) | (selectorAt(10) << 14)) & 0xffff,
      ((selectorAt(10) >> 2) | (selectorAt(11) << 1) | (selectorAt(12) << 4) | (selectorAt(13) << 7) | (selectorAt(14) << 10) | (selectorAt(15) << 13)) & 0xffff,
    ];
  });
  return littleEndianBytes(Uint16Array.from(words));
}

function readOriginalSelectors(bytes: Uint8Array, palette: CrunchPalette, maximumStepNumber: number, pack: (steps: Uint8Array) => number[]): Uint32Array {
  const reader = paletteReader(bytes, palette);
  const model = readModel(reader);
  const deltaRangeCount = maximumStepNumber * 2 + 1;
  const steps = new Uint8Array(16);
  const packed: number[] = [];
  for (let entryIndex = 0; entryIndex < palette.entryCount; entryIndex++) {
    for (let pairIndex = 0; pairIndex < 8; pairIndex++) {
      const symbolNumber = decodeSymbol(reader, model);
      if (symbolNumber >= deltaRangeCount * deltaRangeCount) fail("A selector delta out of range");
      steps[pairIndex * 2] = (steps[pairIndex * 2]! + (symbolNumber % deltaRangeCount) - maximumStepNumber) & maximumStepNumber;
      steps[pairIndex * 2 + 1] = (steps[pairIndex * 2 + 1]! + Math.floor(symbolNumber / deltaRangeCount) - maximumStepNumber) & maximumStepNumber;
    }
    packed.push(...pack(steps));
  }
  return Uint32Array.from(packed);
}

function readAlphaEndpoints(bytes: Uint8Array, header: CrunchHeader): Uint16Array {
  const reader = paletteReader(bytes, header.alphaEndpoints);
  const model = readModel(reader);
  const endpoints = new Uint16Array(header.alphaEndpoints.entryCount);
  let firstNumber = 0;
  let secondNumber = 0;
  for (let entryIndex = 0; entryIndex < endpoints.length; entryIndex++) {
    firstNumber = (firstNumber + decodeSymbol(reader, model)) & 255;
    secondNumber = (secondNumber + decodeSymbol(reader, model)) & 255;
    endpoints[entryIndex] = firstNumber | (secondNumber << 8);
  }
  return endpoints;
}

/** Unity's alpha selectors: DXT5's 48 bits sent as 6-bit xors of the last entry; EAC's as 3-bit pairs of them. */
function readUnityAlphaSelectors(bytes: Uint8Array, header: CrunchHeader): Uint8Array {
  const reader = paletteReader(bytes, header.alphaSelectors);
  const model = readModel(reader);
  const entryCount = header.alphaSelectors.entryCount;
  if (header.formatNumber === ETC2_ALPHA_FORMAT_NUMBER || header.formatNumber === ETC2_ALPHA_WHOLE_BLOCK_FORMAT_NUMBER) {
    const isFlippable = header.formatNumber === ETC2_ALPHA_FORMAT_NUMBER;
    const entrySizeBytes = isFlippable ? 12 : 6;
    const selectorBytes = new Uint8Array(entryCount * entrySizeBytes);
    const linearBytes = new Uint8Array(8);
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
      const entryStartIndex = entryIndex * entrySizeBytes;
      let groupNumber = 0;
      for (let pixelIndex = 0; pixelIndex < 16; pixelIndex++) {
        if (pixelIndex & 1) {
          groupNumber >>= 3;
        } else {
          linearBytes[pixelIndex >> 1] = linearBytes[pixelIndex >> 1]! ^ decodeSymbol(reader, model);
          groupNumber = linearBytes[pixelIndex >> 1]!;
        }
        let selectorNumber = groupNumber & 7;
        if (selectorNumber <= 3) selectorNumber = 3 - selectorNumber;
        // EAC numbers its pixels down each column, most significant bits first; a flipped block's are transposed.
        const transposedEndBitIndex = 3 * (pixelIndex + 1) + 9 * ((pixelIndex & 3) - (pixelIndex >> 2));
        if (isFlippable) {
          putSelectorBits(selectorBytes, entryStartIndex, 3 * (pixelIndex + 1), selectorNumber);
          putSelectorBits(selectorBytes, entryStartIndex + 6, transposedEndBitIndex, selectorNumber);
        } else {
          putSelectorBits(selectorBytes, entryStartIndex, transposedEndBitIndex, selectorNumber);
        }
      }
    }
    return selectorBytes;
  }
  const dxt5FromLinear = Array.from({ length: 64 }, (_, stepsNumber) => DXT5_FROM_LINEAR[stepsNumber & 7]! | (DXT5_FROM_LINEAR[stepsNumber >> 3]! << 3));
  const words = new Uint16Array(entryCount * 3);
  const linearNumbers = [0, 0];
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex++) {
    const halves = [0, 0];
    for (let halfIndex = 0; halfIndex < 2; halfIndex++) {
      for (let shiftCount = 0; shiftCount < 24; shiftCount += 6) {
        linearNumbers[halfIndex] = (linearNumbers[halfIndex]! ^ (decodeSymbol(reader, model) << shiftCount)) >>> 0;
        halves[halfIndex] = halves[halfIndex]! | (dxt5FromLinear[(linearNumbers[halfIndex]! >>> shiftCount) & 0x3f]! << shiftCount);
      }
    }
    words[entryIndex * 3] = halves[0]! & 0xffff;
    words[entryIndex * 3 + 1] = ((halves[0]! >>> 16) | (halves[1]! << 8)) & 0xffff;
    words[entryIndex * 3 + 2] = (halves[1]! >>> 8) & 0xffff;
  }
  return littleEndianBytes(words);
}

/** Puts a 3-bit selector so it ends at endBitIndex of a 48-bit big-endian field. */
function putSelectorBits(selectorBytes: Uint8Array, fieldStartIndex: number, endBitIndex: number, selectorNumber: number): void {
  const byteIndex = fieldStartIndex + (endBitIndex >> 3);
  const bitOffsetCount = endBitIndex & 7;
  if (bitOffsetCount) selectorBytes[byteIndex] = selectorBytes[byteIndex]! | ((selectorNumber << (8 - bitOffsetCount)) & 0xff);
  if (bitOffsetCount < 3) selectorBytes[byteIndex - 1] = selectorBytes[byteIndex - 1]! | (selectorNumber >> bitOffsetCount);
}

function littleEndianBytes(words: Uint16Array): Uint8Array {
  const out = new Uint8Array(words.length * 2);
  words.forEach((wordNumber, wordIndex) => {
    out[wordIndex * 2] = wordNumber & 0xff;
    out[wordIndex * 2 + 1] = wordNumber >> 8;
  });
  return out;
}

// Levels: each block's palette entries, coded as references to the blocks beside and above it.

interface Models {
  referenceModel: HuffmanModel | null;
  colorEndpointModel: HuffmanModel | null;
  colorSelectorModel: HuffmanModel | null;
  alphaEndpointModel: HuffmanModel | null;
  alphaSelectorModel: HuffmanModel | null;
}

/** A level's blocks, written as they're unpacked; blocks outside the level (the padding to whole pairs) aren't. */
class BlockWriter {
  readonly columnCount: number;
  readonly rowCount: number;
  readonly blockSizeBytes: number;
  readonly bytes: Uint8Array;

  constructor(columnCount: number, rowCount: number, blockSizeBytes: number) {
    this.columnCount = columnCount;
    this.rowCount = rowCount;
    this.blockSizeBytes = blockSizeBytes;
    this.bytes = new Uint8Array(columnCount * rowCount * blockSizeBytes);
  }

  isInside(columnIndex: number, rowIndex: number): boolean {
    return columnIndex < this.columnCount && rowIndex < this.rowCount;
  }

  /** Writes a 32-bit word, low byte first, at wordIndex (counted in 4 bytes) of the block. */
  putWord(columnIndex: number, rowIndex: number, wordIndex: number, wordNumber: number): void {
    const startIndex = (rowIndex * this.columnCount + columnIndex) * this.blockSizeBytes + wordIndex * 4;
    for (let byteIndex = 0; byteIndex < 4; byteIndex++) this.bytes[startIndex + byteIndex] = (wordNumber >>> (byteIndex * 8)) & 0xff;
  }

  /** Writes an 8-byte alpha block: its endpoints, then 6 selector bytes. */
  putAlpha(columnIndex: number, rowIndex: number, endpointPairNumber: number, selectorBytes: Uint8Array, selectorStartIndex: number): void {
    const startIndex = (rowIndex * this.columnCount + columnIndex) * this.blockSizeBytes;
    this.bytes[startIndex] = endpointPairNumber & 0xff;
    this.bytes[startIndex + 1] = endpointPairNumber >> 8;
    if (selectorStartIndex + 6 > selectorBytes.length) fail("An alpha selector out of range");
    this.bytes.set(selectorBytes.subarray(selectorStartIndex, selectorStartIndex + 6), startIndex + 2);
  }
}

function entryOf<T extends Uint32Array | Uint16Array>(entries: T, entryIndex: number): number {
  if (entryIndex >= entries.length) fail("A palette entry out of range");
  return entries[entryIndex]!;
}

/** Adds a delta to a palette index, wrapping once past the end, as crunch does. */
function stepIndex(entryIndex: number, deltaNumber: number, entryCount: number): number {
  const steppedIndex = entryIndex + deltaNumber;
  return steppedIndex >= entryCount ? steppedIndex - entryCount : steppedIndex;
}

/**
 * Unity's DXT1, DXT5 and ETC without subblocks: blocks in rows, each pair of rows sharing a reference symbol per
 * 2x2 group that says, for each block, whether it takes a new endpoint, its left neighbor's or the one above.
 */
function unpackUnityDxt(level: BitReader, models: Models, palettes: Palettes, out: BlockWriter, hasAlpha: boolean): void {
  const pairedColumnCount = (out.columnCount + 1) & ~1;
  const pairedRowCount = (out.rowCount + 1) & ~1;
  const aboveReferences = new Uint8Array(pairedColumnCount);
  const aboveColorIndexes = new Uint32Array(pairedColumnCount);
  const aboveAlphaIndexes = new Uint32Array(pairedColumnCount);
  let colorIndex = 0;
  let alphaIndex = 0;
  let referenceGroupNumber = 0;
  for (let rowIndex = 0; rowIndex < pairedRowCount; rowIndex++) {
    for (let columnIndex = 0; columnIndex < pairedColumnCount; columnIndex++) {
      if (!(rowIndex & 1) && !(columnIndex & 1)) referenceGroupNumber = decodeSymbol(level, models.referenceModel) & 0xff;
      let referenceNumber: number;
      if (rowIndex & 1) {
        referenceNumber = aboveReferences[columnIndex]!;
      } else {
        referenceNumber = referenceGroupNumber & 3;
        aboveReferences[columnIndex] = (referenceGroupNumber >> 2) & 3;
        referenceGroupNumber >>= 4;
      }
      if (referenceNumber === 0) {
        colorIndex = stepIndex(colorIndex, decodeSymbol(level, models.colorEndpointModel), palettes.colorEndpoints.length);
        aboveColorIndexes[columnIndex] = colorIndex;
        if (hasAlpha) {
          alphaIndex = stepIndex(alphaIndex, decodeSymbol(level, models.alphaEndpointModel), palettes.alphaEndpoints.length);
          aboveAlphaIndexes[columnIndex] = alphaIndex;
        }
      } else if (referenceNumber === 1) {
        aboveColorIndexes[columnIndex] = colorIndex;
        aboveAlphaIndexes[columnIndex] = alphaIndex;
      } else {
        colorIndex = aboveColorIndexes[columnIndex]!;
        alphaIndex = aboveAlphaIndexes[columnIndex]!;
      }
      const colorSelectorIndex = decodeSymbol(level, models.colorSelectorModel);
      const alphaSelectorIndex = hasAlpha ? decodeSymbol(level, models.alphaSelectorModel) : 0;
      if (!out.isInside(columnIndex, rowIndex)) continue;
      const colorWordIndex = hasAlpha ? 2 : 0;
      if (hasAlpha) out.putAlpha(columnIndex, rowIndex, entryOf(palettes.alphaEndpoints, alphaIndex), palettes.alphaSelectors, alphaSelectorIndex * 6);
      out.putWord(columnIndex, rowIndex, colorWordIndex, entryOf(palettes.colorEndpoints, colorIndex));
      out.putWord(columnIndex, rowIndex, colorWordIndex + 1, entryOf(palettes.colorSelectors, colorSelectorIndex));
    }
  }
}

/**
 * Unity's ETC1 and ETC2 RGBA8: each block's two subblocks take one endpoint each, the second new, the same as the
 * first, or the one diagonally above; the block is built in differential mode when they're close, else individual.
 */
function unpackUnityEtc(level: BitReader, models: Models, palettes: Palettes, out: BlockWriter, hasAlpha: boolean): void {
  const pairedColumnCount = (out.columnCount + 1) & ~1;
  const pairedRowCount = (out.rowCount + 1) & ~1;
  // Two slots a column: the first subblock's endpoint above, and the second's (the next row's diagonal).
  const aboveReferences = new Uint8Array(pairedColumnCount);
  const aboveColorIndexes = new Uint32Array(pairedColumnCount * 2);
  const aboveAlphaIndexes = new Uint32Array(pairedColumnCount * 2);
  let colorIndex = 0;
  let diagonalColorIndex = 0;
  let alphaIndex = 0;
  let diagonalAlphaIndex = 0;
  for (let rowIndex = 0; rowIndex < pairedRowCount; rowIndex++) {
    for (let columnIndex = 0; columnIndex < pairedColumnCount; columnIndex++) {
      const slotIndex = columnIndex * 2;
      let referenceNumber: number;
      if (rowIndex & 1) {
        referenceNumber = aboveReferences[columnIndex]!;
      } else {
        const referenceGroupNumber = decodeSymbol(level, models.referenceModel) & 0xff;
        referenceNumber = (referenceGroupNumber & 3) | ((referenceGroupNumber >> 2) & 12);
        aboveReferences[columnIndex] = ((referenceGroupNumber >> 2) & 3) | ((referenceGroupNumber >> 4) & 12);
      }
      if (!(referenceNumber & 3)) {
        colorIndex = stepIndex(colorIndex, decodeSymbol(level, models.colorEndpointModel), palettes.colorEndpoints.length);
        if (hasAlpha) alphaIndex = stepIndex(alphaIndex, decodeSymbol(level, models.alphaEndpointModel), palettes.alphaEndpoints.length);
        aboveColorIndexes[slotIndex] = colorIndex;
        aboveAlphaIndexes[slotIndex] = alphaIndex;
      } else if ((referenceNumber & 3) === 1) {
        aboveColorIndexes[slotIndex] = colorIndex;
        aboveAlphaIndexes[slotIndex] = alphaIndex;
      } else if ((referenceNumber & 3) === 3) {
        aboveColorIndexes[slotIndex] = colorIndex = diagonalColorIndex;
        aboveAlphaIndexes[slotIndex] = alphaIndex = diagonalAlphaIndex;
      } else {
        colorIndex = aboveColorIndexes[slotIndex]!;
        alphaIndex = aboveAlphaIndexes[slotIndex]!;
      }
      referenceNumber >>= 2;
      const firstColorIndex = colorIndex;
      const colorSelectorIndex = decodeSymbol(level, models.colorSelectorModel);
      const alphaSelectorIndex = hasAlpha ? decodeSymbol(level, models.alphaSelectorModel) : 0;
      if (referenceNumber) colorIndex = stepIndex(colorIndex, decodeSymbol(level, models.colorEndpointModel), palettes.colorEndpoints.length);
      diagonalColorIndex = aboveColorIndexes[slotIndex + 1]!;
      diagonalAlphaIndex = aboveAlphaIndexes[slotIndex + 1]!;
      aboveColorIndexes[slotIndex + 1] = colorIndex;
      aboveAlphaIndexes[slotIndex + 1] = alphaIndex;
      if (!out.isInside(columnIndex, rowIndex)) continue;
      const firstEndpointNumber = entryOf(palettes.colorEndpoints, firstColorIndex);
      const secondEndpointNumber = entryOf(palettes.colorEndpoints, colorIndex);
      const firstChannel = (channelIndex: number) => (firstEndpointNumber >>> (channelIndex * 8)) & 0xff;
      const secondChannel = (channelIndex: number) => (secondEndpointNumber >>> (channelIndex * 8)) & 0xff;
      const flipNumber = (referenceNumber >> 1) ^ 1;
      let differentialNumber = 1;
      for (let channelIndex = 0; differentialNumber && channelIndex < 3; channelIndex++) {
        if (!(firstChannel(channelIndex) + 3 >= secondChannel(channelIndex) && secondChannel(channelIndex) + 4 >= firstChannel(channelIndex))) differentialNumber = 0;
      }
      let blockWordNumber = 0;
      for (let channelIndex = 0; channelIndex < 3; channelIndex++) {
        const channelByte = differentialNumber
          ? ((firstChannel(channelIndex) << 3) | ((secondChannel(channelIndex) - firstChannel(channelIndex)) & 7)) & 0xff
          : ((firstChannel(channelIndex) << 3) & 0xf0) | (secondChannel(channelIndex) >> 1);
        blockWordNumber |= channelByte << (channelIndex * 8);
      }
      blockWordNumber |= (((firstChannel(3) << 5) | (secondChannel(3) << 2) | (differentialNumber << 1) | flipNumber) & 0xff) << 24;
      const colorWordIndex = hasAlpha ? 2 : 0;
      if (hasAlpha) out.putAlpha(columnIndex, rowIndex, entryOf(palettes.alphaEndpoints, alphaIndex), palettes.alphaSelectors, alphaSelectorIndex * 12 + (flipNumber ? 6 : 0));
      out.putWord(columnIndex, rowIndex, colorWordIndex, blockWordNumber);
      out.putWord(columnIndex, rowIndex, colorWordIndex + 1, entryOf(palettes.colorSelectors, (colorSelectorIndex * 2) | flipNumber));
    }
  }
}

/** The original's chunks of 2x2 blocks: which blocks share an endpoint (a tile), and each block's tile. */
const ORIGINAL_CHUNK_TILE_COUNTS = [1, 2, 2, 3, 3, 3, 3, 4];
const ORIGINAL_CHUNK_TILES = [
  [0, 0, 0, 0],
  [0, 0, 1, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 2],
  [1, 2, 0, 0],
  [0, 1, 0, 2],
  [1, 0, 2, 0],
  [0, 1, 2, 3],
];

/**
 * The original's DXT1 and DXT5: chunks of 2x2 blocks in rows that snake left and right, three chunks' layouts in
 * a symbol, endpoints per tile and selectors per block, all as deltas from the last.
 */
function unpackOriginal(level: BitReader, models: Models, palettes: Palettes, out: BlockWriter, hasAlpha: boolean): void {
  const chunkColumnCount = (out.columnCount + 1) >> 1;
  const chunkRowCount = (out.rowCount + 1) >> 1;
  const alphaSelectorCount = palettes.alphaSelectors.length / 6;
  let layoutBitsNumber = 1;
  let colorEndpointIndex = 0;
  let colorSelectorIndex = 0;
  let alphaEndpointIndex = 0;
  let alphaSelectorIndex = 0;
  const colorEndpoints = [0, 0, 0, 0];
  const alphaEndpoints = [0, 0, 0, 0];
  for (let chunkRowIndex = 0; chunkRowIndex < chunkRowCount; chunkRowIndex++) {
    const isReversed = (chunkRowIndex & 1) === 1;
    for (let orderIndex = 0; orderIndex < chunkColumnCount; orderIndex++) {
      const chunkColumnIndex = isReversed ? chunkColumnCount - 1 - orderIndex : orderIndex;
      if (layoutBitsNumber === 1) layoutBitsNumber = decodeSymbol(level, models.referenceModel) | 512;
      const layoutIndex = layoutBitsNumber & 7;
      layoutBitsNumber >>= 3;
      const tileCount = ORIGINAL_CHUNK_TILE_COUNTS[layoutIndex]!;
      if (hasAlpha) {
        for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
          alphaEndpointIndex = stepIndex(alphaEndpointIndex, decodeSymbol(level, models.alphaEndpointModel), palettes.alphaEndpoints.length);
          alphaEndpoints[tileIndex] = entryOf(palettes.alphaEndpoints, alphaEndpointIndex);
        }
      }
      for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
        colorEndpointIndex = stepIndex(colorEndpointIndex, decodeSymbol(level, models.colorEndpointModel), palettes.colorEndpoints.length);
        colorEndpoints[tileIndex] = entryOf(palettes.colorEndpoints, colorEndpointIndex);
      }
      for (let blockIndex = 0; blockIndex < 4; blockIndex++) {
        const columnIndex = chunkColumnIndex * 2 + (blockIndex & 1);
        const rowIndex = chunkRowIndex * 2 + (blockIndex >> 1);
        if (hasAlpha) alphaSelectorIndex = stepIndex(alphaSelectorIndex, decodeSymbol(level, models.alphaSelectorModel), alphaSelectorCount);
        colorSelectorIndex = stepIndex(colorSelectorIndex, decodeSymbol(level, models.colorSelectorModel), palettes.colorSelectors.length);
        if (!out.isInside(columnIndex, rowIndex)) continue;
        const tileIndex = ORIGINAL_CHUNK_TILES[layoutIndex]![blockIndex]!;
        const colorWordIndex = hasAlpha ? 2 : 0;
        if (hasAlpha) out.putAlpha(columnIndex, rowIndex, alphaEndpoints[tileIndex]!, palettes.alphaSelectors, alphaSelectorIndex * 6);
        out.putWord(columnIndex, rowIndex, colorWordIndex, colorEndpoints[tileIndex]!);
        out.putWord(columnIndex, rowIndex, colorWordIndex + 1, entryOf(palettes.colorSelectors, colorSelectorIndex));
      }
    }
  }
}
