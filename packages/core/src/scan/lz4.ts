/** One LZ4 block (no frame), as Unity compresses its bundles, into exactly sizeBytes bytes. Throws on bytes that aren't one. */
export function decompressLz4Block(source: Uint8Array, sizeBytes: number): Uint8Array {
  const out = new Uint8Array(sizeBytes);
  let sourceIndex = 0;
  let outIndex = 0;
  // A length of 15 goes on in the bytes after it, each adding up to 255.
  const readLength = (startCount: number) => {
    let lengthCount = startCount;
    if (lengthCount === 15) {
      let extraByte: number;
      do {
        extraByte = source[sourceIndex++]!;
        if (extraByte === undefined) throw new Error("LZ4 block ends early");
        lengthCount += extraByte;
      } while (extraByte === 255);
    }
    return lengthCount;
  };
  while (sourceIndex < source.length) {
    const tokenByte = source[sourceIndex++]!;
    const literalCount = readLength(tokenByte >> 4);
    if (sourceIndex + literalCount > source.length || outIndex + literalCount > sizeBytes) throw new Error("LZ4 literals run past the end");
    out.set(source.subarray(sourceIndex, sourceIndex + literalCount), outIndex);
    sourceIndex += literalCount;
    outIndex += literalCount;
    if (sourceIndex >= source.length) break;
    const distanceCount = source[sourceIndex]! | (source[sourceIndex + 1]! << 8);
    sourceIndex += 2;
    const matchCount = readLength(tokenByte & 15) + 4;
    if (distanceCount === 0 || distanceCount > outIndex || outIndex + matchCount > sizeBytes) throw new Error("LZ4 match out of range");
    for (let i = 0; i < matchCount; i++, outIndex++) out[outIndex] = out[outIndex - distanceCount]!;
  }
  if (outIndex !== sizeBytes) throw new Error("LZ4 block is the wrong size");
  return out;
}
