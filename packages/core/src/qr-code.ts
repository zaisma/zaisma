/**
 * QR codes for game and room links (docs/DECISIONS.md, "QR codes"): players get one behind Share,
 * developers on the dashboard and through the API and MCP. Byte mode, error correction level M,
 * versions 1 to 10 (up to 213 bytes, far more than a link needs). Written here rather than taken from a
 * package so the site's page and the API draw the same code with no dependency; it follows ISO/IEC
 * 18004 the way Project Nayuki's reference encoder does.
 */

export const QR_CODE_LIMITS = {
  /** Version 10 at level M holds 213 bytes. */
  maximumTextBytes: 213,
  /** Light modules around the code, as the standard asks. */
  quietZoneModuleCount: 4,
} as const;

// Level M: error correction codewords per block and blocks, by version (index 0 unused).
const ERROR_CORRECTION_CODEWORD_COUNTS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const ERROR_CORRECTION_BLOCK_COUNTS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Error correction level M (medium)'s two bits in the format information. */
const MEDIUM_CORRECTION_FORMAT_NUMBER = 0;
const HIGHEST_VERSION_NUMBER = 10;

const isBitSet = (bitsNumber: number, bitIndex: number) => ((bitsNumber >>> bitIndex) & 1) !== 0;

function rawDataModuleCount(versionNumber: number): number {
  let moduleCount = (16 * versionNumber + 128) * versionNumber + 64;
  if (versionNumber >= 2) {
    const alignmentCount = Math.floor(versionNumber / 7) + 2;
    moduleCount -= (25 * alignmentCount - 10) * alignmentCount - 55;
    if (versionNumber >= 7) moduleCount -= 36;
  }
  return moduleCount;
}

const dataCodewordCount = (versionNumber: number) =>
  Math.floor(rawDataModuleCount(versionNumber) / 8) - ERROR_CORRECTION_CODEWORD_COUNTS_PER_BLOCK[versionNumber]! * ERROR_CORRECTION_BLOCK_COUNTS[versionNumber]!;

// Reed-Solomon over GF(256) with the polynomial 0x11D.
function multiplied(leftNumber: number, rightNumber: number): number {
  let productNumber = 0;
  for (let bitIndex = 7; bitIndex >= 0; bitIndex--) {
    productNumber = (productNumber << 1) ^ ((productNumber >>> 7) * 0x11d);
    productNumber ^= ((rightNumber >>> bitIndex) & 1) * leftNumber;
  }
  return productNumber;
}

function divisorOf(degreeCount: number): number[] {
  const coefficients = new Array<number>(degreeCount).fill(0);
  coefficients[degreeCount - 1] = 1;
  let rootNumber = 1;
  for (let stepIndex = 0; stepIndex < degreeCount; stepIndex++) {
    for (let index = 0; index < coefficients.length; index++) {
      coefficients[index] = multiplied(coefficients[index]!, rootNumber);
      if (index + 1 < coefficients.length) coefficients[index] = coefficients[index]! ^ coefficients[index + 1]!;
    }
    rootNumber = multiplied(rootNumber, 0x02);
  }
  return coefficients;
}

function remainderOf(codewords: number[], divisor: number[]): number[] {
  const remainders = divisor.map(() => 0);
  for (const codewordNumber of codewords) {
    const factorNumber = codewordNumber ^ remainders.shift()!;
    remainders.push(0);
    divisor.forEach((coefficientNumber, index) => (remainders[index] = remainders[index]! ^ multiplied(coefficientNumber, factorNumber)));
  }
  return remainders;
}

/** The data codewords with their error correction, split into blocks and interleaved. */
function withErrorCorrection(dataCodewords: number[], versionNumber: number): number[] {
  const blockCount = ERROR_CORRECTION_BLOCK_COUNTS[versionNumber]!;
  const blockCorrectionCount = ERROR_CORRECTION_CODEWORD_COUNTS_PER_BLOCK[versionNumber]!;
  const rawCodewordCount = Math.floor(rawDataModuleCount(versionNumber) / 8);
  const shortBlockCount = blockCount - (rawCodewordCount % blockCount);
  const shortBlockCodewordCount = Math.floor(rawCodewordCount / blockCount);
  const divisor = divisorOf(blockCorrectionCount);
  const blocks: number[][] = [];
  for (let blockIndex = 0, startIndex = 0; blockIndex < blockCount; blockIndex++) {
    const block = dataCodewords.slice(startIndex, startIndex + shortBlockCodewordCount - blockCorrectionCount + (blockIndex < shortBlockCount ? 0 : 1));
    startIndex += block.length;
    const correction = remainderOf(block, divisor);
    if (blockIndex < shortBlockCount) block.push(0);
    blocks.push(block.concat(correction));
  }
  const interleaved: number[] = [];
  for (let codewordIndex = 0; codewordIndex < blocks[0]!.length; codewordIndex++) {
    blocks.forEach((block, blockIndex) => {
      if (codewordIndex !== shortBlockCodewordCount - blockCorrectionCount || blockIndex >= shortBlockCount) interleaved.push(block[codewordIndex]!);
    });
  }
  return interleaved;
}

function alignmentIndexes(versionNumber: number, sideModuleCount: number): number[] {
  if (versionNumber === 1) return [];
  const alignmentCount = Math.floor(versionNumber / 7) + 2;
  const stepModuleCount = Math.ceil((versionNumber * 4 + 4) / (alignmentCount * 2 - 2)) * 2;
  const indexes = [6];
  for (let moduleIndex = sideModuleCount - 7; indexes.length < alignmentCount; moduleIndex -= stepModuleCount) indexes.splice(1, 0, moduleIndex);
  return indexes;
}

/** The standard's eight masks, by column and row. */
const MASKS: ((columnIndex: number, rowIndex: number) => boolean)[] = [
  (columnIndex, rowIndex) => (columnIndex + rowIndex) % 2 === 0,
  (...indexes) => indexes[1] % 2 === 0,
  (columnIndex) => columnIndex % 3 === 0,
  (columnIndex, rowIndex) => (columnIndex + rowIndex) % 3 === 0,
  (columnIndex, rowIndex) => (Math.floor(columnIndex / 3) + Math.floor(rowIndex / 2)) % 2 === 0,
  (columnIndex, rowIndex) => ((columnIndex * rowIndex) % 2) + ((columnIndex * rowIndex) % 3) === 0,
  (columnIndex, rowIndex) => (((columnIndex * rowIndex) % 2) + ((columnIndex * rowIndex) % 3)) % 2 === 0,
  (columnIndex, rowIndex) => (((columnIndex + rowIndex) % 2) + ((columnIndex * rowIndex) % 3)) % 2 === 0,
];

/** A score for how hard a masked code is to read (lower is better), from the standard's rules. */
function penaltyPointCount(modules: boolean[][]): number {
  const sideModuleCount = modules.length;
  let pointCount = 0;
  const scoreLines = (isDarkAt: (lineIndex: number, alongIndex: number) => boolean) => {
    for (let lineIndex = 0; lineIndex < sideModuleCount; lineIndex++) {
      let runModuleCount = 0;
      let isRunDark = false;
      const line: boolean[] = [];
      for (let alongIndex = 0; alongIndex < sideModuleCount; alongIndex++) {
        const isDark = isDarkAt(lineIndex, alongIndex);
        line.push(isDark);
        if (alongIndex > 0 && isDark === isRunDark) {
          runModuleCount++;
          if (runModuleCount === 5) pointCount += 3;
          else if (runModuleCount > 5) pointCount++;
        } else {
          isRunDark = isDark;
          runModuleCount = 1;
        }
      }
      // Finder-like runs: dark-light-dark-dark-dark-light-dark with four light modules on a side.
      const padded = [false, false, false, false, ...line, false, false, false, false];
      for (let startIndex = 0; startIndex + 11 <= padded.length; startIndex++) {
        const isDarkAtOffset = (offsetIndex: number) => padded[startIndex + offsetIndex]!;
        if (!(isDarkAtOffset(4) && !isDarkAtOffset(5) && isDarkAtOffset(6) && isDarkAtOffset(7) && isDarkAtOffset(8) && !isDarkAtOffset(9) && isDarkAtOffset(10))) continue;
        const isLightBefore = !isDarkAtOffset(0) && !isDarkAtOffset(1) && !isDarkAtOffset(2) && !isDarkAtOffset(3);
        const isLightAfter = startIndex + 15 <= padded.length && !isDarkAtOffset(11) && !isDarkAtOffset(12) && !isDarkAtOffset(13) && !isDarkAtOffset(14);
        if (isLightBefore || isLightAfter) pointCount += 40;
      }
    }
  };
  scoreLines((rowIndex, columnIndex) => modules[rowIndex]![columnIndex]!);
  scoreLines((columnIndex, rowIndex) => modules[rowIndex]![columnIndex]!);
  for (let rowIndex = 0; rowIndex + 1 < sideModuleCount; rowIndex++) {
    for (let columnIndex = 0; columnIndex + 1 < sideModuleCount; columnIndex++) {
      const isDark = modules[rowIndex]![columnIndex];
      if (isDark === modules[rowIndex]![columnIndex + 1] && isDark === modules[rowIndex + 1]![columnIndex] && isDark === modules[rowIndex + 1]![columnIndex + 1]) pointCount += 3;
    }
  }
  const darkModuleCount = modules.flat().filter(Boolean).length;
  const moduleCount = sideModuleCount * sideModuleCount;
  pointCount += (Math.ceil(Math.abs(darkModuleCount * 20 - moduleCount * 10) / moduleCount) - 1) * 10;
  return pointCount;
}

/**
 * The code's modules for `text`, as rows of dark (true) and light (false), with no quiet zone. Throws
 * a RangeError when the text is over QR_CODE_LIMITS.maximumTextBytes in UTF-8.
 */
export function qrCodeModules(text: string): boolean[][] {
  const textBytes = [...new TextEncoder().encode(text)];
  const neededBitCount = (candidateNumber: number) => 4 + (candidateNumber < 10 ? 8 : 16) + textBytes.length * 8;
  let versionNumber = 1;
  while (versionNumber <= HIGHEST_VERSION_NUMBER && neededBitCount(versionNumber) > dataCodewordCount(versionNumber) * 8) versionNumber++;
  if (versionNumber > HIGHEST_VERSION_NUMBER) throw new RangeError(`The text is ${textBytes.length} bytes; a QR code here holds at most ${QR_CODE_LIMITS.maximumTextBytes}.`);

  // The bit stream: byte mode, the length, the bytes, a terminator, then padding.
  const capacityBitCount = dataCodewordCount(versionNumber) * 8;
  const bits: number[] = [];
  const append = (bitsNumber: number, bitCount: number) => {
    for (let bitIndex = bitCount - 1; bitIndex >= 0; bitIndex--) bits.push((bitsNumber >>> bitIndex) & 1);
  };
  append(0b0100, 4);
  append(textBytes.length, versionNumber < 10 ? 8 : 16);
  for (const textByte of textBytes) append(textByte, 8);
  append(0, Math.min(4, capacityBitCount - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let padByte = 0xec; bits.length < capacityBitCount; padByte ^= 0xec ^ 0x11) append(padByte, 8);
  const dataCodewords: number[] = [];
  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 8) dataCodewords.push(bits.slice(bitIndex, bitIndex + 8).reduce((byteNumber, bitNumber) => (byteNumber << 1) | bitNumber, 0));
  const codewords = withErrorCorrection(dataCodewords, versionNumber);

  const sideModuleCount = versionNumber * 4 + 17;
  const modules = Array.from({ length: sideModuleCount }, () => new Array<boolean>(sideModuleCount).fill(false));
  const isFunction = Array.from({ length: sideModuleCount }, () => new Array<boolean>(sideModuleCount).fill(false));
  const setFunction = (columnIndex: number, rowIndex: number, isDark: boolean) => {
    modules[rowIndex]![columnIndex] = isDark;
    isFunction[rowIndex]![columnIndex] = true;
  };

  for (let moduleIndex = 0; moduleIndex < sideModuleCount; moduleIndex++) {
    setFunction(6, moduleIndex, moduleIndex % 2 === 0);
    setFunction(moduleIndex, 6, moduleIndex % 2 === 0);
  }
  const finderCenters = [[3, 3], [sideModuleCount - 4, 3], [3, sideModuleCount - 4]] as const;
  for (const [centerColumnIndex, centerRowIndex] of finderCenters) {
    for (let rowOffsetIndex = -4; rowOffsetIndex <= 4; rowOffsetIndex++) {
      for (let columnOffsetIndex = -4; columnOffsetIndex <= 4; columnOffsetIndex++) {
        const columnIndex = centerColumnIndex + columnOffsetIndex;
        const rowIndex = centerRowIndex + rowOffsetIndex;
        const ringIndex = Math.max(Math.abs(columnOffsetIndex), Math.abs(rowOffsetIndex));
        if (columnIndex >= 0 && columnIndex < sideModuleCount && rowIndex >= 0 && rowIndex < sideModuleCount) setFunction(columnIndex, rowIndex, ringIndex !== 2 && ringIndex !== 4);
      }
    }
  }
  const alignments = alignmentIndexes(versionNumber, sideModuleCount);
  const lastAlignmentIndex = alignments.length - 1;
  alignments.forEach((centerColumnIndex, alignmentColumnIndex) =>
    alignments.forEach((centerRowIndex, alignmentRowIndex) => {
      const isCorner =
        (alignmentColumnIndex === 0 && alignmentRowIndex === 0) || (alignmentColumnIndex === 0 && alignmentRowIndex === lastAlignmentIndex) || (alignmentColumnIndex === lastAlignmentIndex && alignmentRowIndex === 0);
      if (isCorner) return;
      for (let rowOffsetIndex = -2; rowOffsetIndex <= 2; rowOffsetIndex++) {
        for (let columnOffsetIndex = -2; columnOffsetIndex <= 2; columnOffsetIndex++) {
          setFunction(centerColumnIndex + columnOffsetIndex, centerRowIndex + rowOffsetIndex, Math.max(Math.abs(columnOffsetIndex), Math.abs(rowOffsetIndex)) !== 1);
        }
      }
    }),
  );
  const drawFormat = (maskIndex: number) => {
    const formatNumber = (MEDIUM_CORRECTION_FORMAT_NUMBER << 3) | maskIndex;
    let remainderNumber = formatNumber;
    for (let stepIndex = 0; stepIndex < 10; stepIndex++) remainderNumber = (remainderNumber << 1) ^ ((remainderNumber >>> 9) * 0x537);
    const formatBitsNumber = ((formatNumber << 10) | remainderNumber) ^ 0x5412;
    for (let bitIndex = 0; bitIndex <= 5; bitIndex++) setFunction(8, bitIndex, isBitSet(formatBitsNumber, bitIndex));
    setFunction(8, 7, isBitSet(formatBitsNumber, 6));
    setFunction(8, 8, isBitSet(formatBitsNumber, 7));
    setFunction(7, 8, isBitSet(formatBitsNumber, 8));
    for (let bitIndex = 9; bitIndex < 15; bitIndex++) setFunction(14 - bitIndex, 8, isBitSet(formatBitsNumber, bitIndex));
    for (let bitIndex = 0; bitIndex < 8; bitIndex++) setFunction(sideModuleCount - 1 - bitIndex, 8, isBitSet(formatBitsNumber, bitIndex));
    for (let bitIndex = 8; bitIndex < 15; bitIndex++) setFunction(8, sideModuleCount - 15 + bitIndex, isBitSet(formatBitsNumber, bitIndex));
    setFunction(8, sideModuleCount - 8, true);
  };
  drawFormat(0);
  if (versionNumber >= 7) {
    let remainderNumber = versionNumber;
    for (let stepIndex = 0; stepIndex < 12; stepIndex++) remainderNumber = (remainderNumber << 1) ^ ((remainderNumber >>> 11) * 0x1f25);
    const versionBitsNumber = (versionNumber << 12) | remainderNumber;
    for (let bitIndex = 0; bitIndex < 18; bitIndex++) {
      const farIndex = sideModuleCount - 11 + (bitIndex % 3);
      const nearIndex = Math.floor(bitIndex / 3);
      setFunction(farIndex, nearIndex, isBitSet(versionBitsNumber, bitIndex));
      setFunction(nearIndex, farIndex, isBitSet(versionBitsNumber, bitIndex));
    }
  }

  // The codewords, zigzagging up and down two columns at a time from the bottom right.
  let codewordBitIndex = 0;
  for (let rightColumnIndex = sideModuleCount - 1; rightColumnIndex >= 1; rightColumnIndex -= 2) {
    if (rightColumnIndex === 6) rightColumnIndex = 5;
    for (let stepIndex = 0; stepIndex < sideModuleCount; stepIndex++) {
      for (let pairIndex = 0; pairIndex < 2; pairIndex++) {
        const columnIndex = rightColumnIndex - pairIndex;
        const rowIndex = ((rightColumnIndex + 1) & 2) === 0 ? sideModuleCount - 1 - stepIndex : stepIndex;
        if (!isFunction[rowIndex]![columnIndex] && codewordBitIndex < codewords.length * 8) {
          modules[rowIndex]![columnIndex] = isBitSet(codewords[codewordBitIndex >>> 3]!, 7 - (codewordBitIndex & 7));
          codewordBitIndex++;
        }
      }
    }
  }

  // The mask that reads best.
  const masked = (maskIndex: number) => {
    const copy = modules.map((row) => row.slice());
    for (let rowIndex = 0; rowIndex < sideModuleCount; rowIndex++) {
      for (let columnIndex = 0; columnIndex < sideModuleCount; columnIndex++) {
        if (!isFunction[rowIndex]![columnIndex] && MASKS[maskIndex]!(columnIndex, rowIndex)) copy[rowIndex]![columnIndex] = !copy[rowIndex]![columnIndex];
      }
    }
    return copy;
  };
  let bestMaskIndex = 0;
  let bestPointCount = Infinity;
  for (let maskIndex = 0; maskIndex < MASKS.length; maskIndex++) {
    drawFormat(maskIndex);
    const pointCount = penaltyPointCount(masked(maskIndex));
    if (pointCount < bestPointCount) {
      bestMaskIndex = maskIndex;
      bestPointCount = pointCount;
    }
  }
  drawFormat(bestMaskIndex);
  return masked(bestMaskIndex);
}

/** The code for `text` as an SVG document: dark modules on white, with the quiet zone, one unit a module. */
export function qrCodeSvg(text: string): string {
  const modules = qrCodeModules(text);
  const marginModuleCount = QR_CODE_LIMITS.quietZoneModuleCount;
  const sideModuleCount = modules.length + marginModuleCount * 2;
  let path = "";
  modules.forEach((row, rowIndex) => {
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      if (!row[columnIndex]) continue;
      let runEndIndex = columnIndex;
      while (runEndIndex + 1 < row.length && row[runEndIndex + 1]) runEndIndex++;
      const runModuleCount = runEndIndex - columnIndex + 1;
      path += `M${columnIndex + marginModuleCount} ${rowIndex + marginModuleCount}h${runModuleCount}v1h-${runModuleCount}z`;
      columnIndex = runEndIndex;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sideModuleCount} ${sideModuleCount}" shape-rendering="crispEdges"><rect width="${sideModuleCount}" height="${sideModuleCount}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
