/**
 * LZMA as Unity compresses asset bundles: 5 bytes of properties, then the stream, with the unpacked size known
 * from the bundle. Follows the LZMA specification's reference decoder (public domain, Igor Pavlov). Throws on
 * bytes that aren't LZMA.
 */
export function decompressLzma(source: Uint8Array, sizeBytes: number): Uint8Array {
  if (source.length < 5) throw new Error("LZMA properties missing");
  const propertiesByte = source[0]!;
  if (propertiesByte >= 9 * 5 * 5) throw new Error("LZMA properties invalid");
  // How many high bits of the previous byte, and low bits of the position, pick a literal's and a match's model.
  const literalContextBitCount = propertiesByte % 9;
  const literalPositionBitCount = Math.floor(propertiesByte / 9) % 5;
  const positionBitCount = Math.floor(propertiesByte / 45);
  const out = new Uint8Array(sizeBytes);
  let outIndex = 0;
  const range = new RangeDecoder(source, 5);
  const literalProbabilities = probabilities(0x300 << (literalContextBitCount + literalPositionBitCount));
  const isMatch = probabilities(12 << 4);
  const isRepeat = probabilities(12);
  const isRepeatFirst = probabilities(12);
  const isRepeatSecond = probabilities(12);
  const isRepeatThird = probabilities(12);
  const isRepeatFirstLong = probabilities(12 << 4);
  const distanceSlots = [0, 1, 2, 3].map(() => probabilities(1 << 6));
  const distanceProbabilities = probabilities(1 + 114);
  const alignProbabilities = probabilities(1 << 4);
  const matchLengths = new LengthDecoder();
  const repeatLengths = new LengthDecoder();
  let stateNumber = 0;
  const repeatDistances = [0, 0, 0, 0];
  const positionMaskNumber = (1 << positionBitCount) - 1;
  const literalPositionMaskNumber = (1 << literalPositionBitCount) - 1;
  while (outIndex < sizeBytes) {
    const positionStateNumber = outIndex & positionMaskNumber;
    if (range.bit(isMatch, (stateNumber << 4) + positionStateNumber) === 0) {
      const previousByte = outIndex > 0 ? out[outIndex - 1]! : 0;
      const modelIndex = 0x300 * (((outIndex & literalPositionMaskNumber) << literalContextBitCount) + (previousByte >> (8 - literalContextBitCount)));
      let symbolNumber = 1;
      if (stateNumber >= 7) {
        let matchByte = out[outIndex - repeatDistances[0]! - 1]!;
        do {
          const matchBitNumber = (matchByte >> 7) & 1;
          matchByte <<= 1;
          const bitNumber = range.bit(literalProbabilities, modelIndex + ((1 + matchBitNumber) << 8) + symbolNumber);
          symbolNumber = (symbolNumber << 1) | bitNumber;
          if (matchBitNumber !== bitNumber) break;
        } while (symbolNumber < 0x100);
      }
      while (symbolNumber < 0x100) symbolNumber = (symbolNumber << 1) | range.bit(literalProbabilities, modelIndex + symbolNumber);
      out[outIndex++] = symbolNumber & 0xff;
      stateNumber = stateNumber < 4 ? 0 : stateNumber < 10 ? stateNumber - 3 : stateNumber - 6;
      continue;
    }
    let lengthCount: number;
    if (range.bit(isRepeat, stateNumber) !== 0) {
      if (outIndex === 0) throw new Error("LZMA repeat before any data");
      if (range.bit(isRepeatFirst, stateNumber) === 0) {
        if (range.bit(isRepeatFirstLong, (stateNumber << 4) + positionStateNumber) === 0) {
          stateNumber = stateNumber < 7 ? 9 : 11;
          out[outIndex] = out[outIndex - repeatDistances[0]! - 1]!;
          outIndex++;
          continue;
        }
      } else {
        let distanceCount: number;
        if (range.bit(isRepeatSecond, stateNumber) === 0) distanceCount = repeatDistances[1]!;
        else {
          if (range.bit(isRepeatThird, stateNumber) === 0) distanceCount = repeatDistances[2]!;
          else {
            distanceCount = repeatDistances[3]!;
            repeatDistances[3] = repeatDistances[2]!;
          }
          repeatDistances[2] = repeatDistances[1]!;
        }
        repeatDistances[1] = repeatDistances[0]!;
        repeatDistances[0] = distanceCount;
      }
      lengthCount = repeatLengths.decode(range, positionStateNumber);
      stateNumber = stateNumber < 7 ? 8 : 11;
    } else {
      repeatDistances[3] = repeatDistances[2]!;
      repeatDistances[2] = repeatDistances[1]!;
      repeatDistances[1] = repeatDistances[0]!;
      lengthCount = matchLengths.decode(range, positionStateNumber);
      stateNumber = stateNumber < 7 ? 7 : 10;
      const slotNumber = range.bitTree(distanceSlots[Math.min(lengthCount, 3)]!, 6);
      let distanceCount: number;
      if (slotNumber < 4) distanceCount = slotNumber;
      else {
        const directBitCount = (slotNumber >> 1) - 1;
        distanceCount = (2 | (slotNumber & 1)) * 2 ** directBitCount;
        if (slotNumber < 14) distanceCount += range.reverseBitTree(distanceProbabilities, distanceCount - slotNumber, directBitCount);
        else {
          distanceCount += range.directBits(directBitCount - 4) * 16;
          distanceCount += range.reverseBitTree(alignProbabilities, 0, 4);
          if (distanceCount === 0xffffffff) break; // The end marker.
        }
      }
      repeatDistances[0] = distanceCount;
    }
    lengthCount += 2;
    if (repeatDistances[0]! >= outIndex) throw new Error("LZMA match before the start");
    if (outIndex + lengthCount > sizeBytes) throw new Error("LZMA data runs past its size");
    for (let copiedCount = 0; copiedCount < lengthCount; copiedCount++, outIndex++) out[outIndex] = out[outIndex - repeatDistances[0]! - 1]!;
  }
  if (outIndex !== sizeBytes) throw new Error("LZMA data is the wrong size");
  return out;
}

/** Probabilities out of 2048 that the next bit is 0, all starting even. */
const probabilities = (probabilityCount: number) => new Uint16Array(probabilityCount).fill(1024);

class RangeDecoder {
  private rangeNumber = 0xffffffff;
  private codeNumber = 0;
  private index: number;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array, startIndex: number) {
    this.bytes = bytes;
    this.index = startIndex + 1; // The first byte is always 0.
    for (let byteIndex = 0; byteIndex < 4; byteIndex++) this.codeNumber = ((this.codeNumber << 8) | this.next()) >>> 0;
  }

  private next(): number {
    if (this.index >= this.bytes.length) throw new Error("LZMA stream ends early");
    return this.bytes[this.index++]!;
  }

  private normalize(): void {
    if (this.rangeNumber < 0x1000000) {
      this.rangeNumber = (this.rangeNumber << 8) >>> 0;
      this.codeNumber = ((this.codeNumber << 8) | this.next()) >>> 0;
    }
  }

  bit(probabilityList: Uint16Array, probabilityIndex: number): number {
    const probabilityNumber = probabilityList[probabilityIndex]!;
    const boundNumber = (this.rangeNumber >>> 11) * probabilityNumber;
    let bitNumber: number;
    if (this.codeNumber < boundNumber) {
      probabilityList[probabilityIndex] = probabilityNumber + ((2048 - probabilityNumber) >>> 5);
      this.rangeNumber = boundNumber;
      bitNumber = 0;
    } else {
      probabilityList[probabilityIndex] = probabilityNumber - (probabilityNumber >>> 5);
      this.codeNumber = (this.codeNumber - boundNumber) >>> 0;
      this.rangeNumber = (this.rangeNumber - boundNumber) >>> 0;
      bitNumber = 1;
    }
    this.normalize();
    return bitNumber;
  }

  bitTree(probabilityList: Uint16Array, bitCount: number, startIndex = 0): number {
    let nodeIndex = 1;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex++) nodeIndex = (nodeIndex << 1) + this.bit(probabilityList, startIndex + nodeIndex);
    return nodeIndex - (1 << bitCount);
  }

  reverseBitTree(probabilityList: Uint16Array, startIndex: number, bitCount: number): number {
    let nodeIndex = 1;
    let symbolNumber = 0;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex++) {
      const bitNumber = this.bit(probabilityList, startIndex + nodeIndex);
      nodeIndex = (nodeIndex << 1) + bitNumber;
      symbolNumber |= bitNumber << bitIndex;
    }
    return symbolNumber;
  }

  directBits(bitCount: number): number {
    let bitsNumber = 0;
    for (let remainingCount = bitCount; remainingCount > 0; remainingCount--) {
      this.rangeNumber = this.rangeNumber >>> 1;
      let bitNumber = 0;
      if (this.codeNumber >= this.rangeNumber) {
        this.codeNumber = (this.codeNumber - this.rangeNumber) >>> 0;
        bitNumber = 1;
      }
      bitsNumber = bitsNumber * 2 + bitNumber;
      this.normalize();
    }
    return bitsNumber;
  }
}

class LengthDecoder {
  private readonly choice = probabilities(2);
  private readonly low = probabilities(16 << 3);
  private readonly middle = probabilities(16 << 3);
  private readonly high = probabilities(1 << 8);

  decode(range: RangeDecoder, positionStateNumber: number): number {
    if (range.bit(this.choice, 0) === 0) return range.bitTree(this.low, 3, positionStateNumber << 3);
    if (range.bit(this.choice, 1) === 0) return 8 + range.bitTree(this.middle, 3, positionStateNumber << 3);
    return 16 + range.bitTree(this.high, 8);
  }
}
