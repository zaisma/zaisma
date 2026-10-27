import { sha256Hex } from "../ids.ts";
import { encodePng } from "./png.ts";
import { MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT, MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT, MINIMUM_TEXTURE_SIDE_PIXEL_COUNT, decodeTexture, textureLevels, type TextureFormat } from "./textures.ts";
import { MAXIMUM_READ_INSIDE_SIZE_BYTES, type ByteSource, type PictureFound } from "./unity.ts";

/** Godot 4's Image::Format numbers for the formats decoded (.ctex). */
const GODOT_4_FORMATS: Record<number, TextureFormat> = { 1: "la8", 4: "rgb8", 5: "rgba8", 17: "bc1", 18: "bc2", 19: "bc3", 22: "bc7", 25: "etc1", 30: "etc2_rgb", 31: "etc2_rgba8", 32: "etc2_rgba1", 35: "astc_4x4", 37: "astc_8x8" };
/** Godot 3's Image::Format numbers for the formats decoded (.stex). */
const GODOT_3_FORMATS: Record<number, TextureFormat> = { 1: "la8", 4: "rgb8", 5: "rgba8", 17: "bc1", 18: "bc2", 19: "bc3", 22: "bc7", 29: "etc1", 34: "etc2_rgb", 35: "etc2_rgba8", 36: "etc2_rgba1" };
/** Godot 3 .stex data stored as a PNG or WebP file: found as a picture file already. */
const GODOT_3_FILE_FORMAT_CODE = (1 << 20) | (1 << 21);
/** Godot's luminance format: one gray byte a pixel, decoded as gray with full alpha. */
const LUMINANCE_FORMAT_NUMBER = 0;

const WINDOW_SIZE_BYTES = 8 * 1024 * 1024;
/** The longest texture header: Godot 4's .ctex, up to its pixel data. */
const HEADER_SIZE_BYTES = 52;

/** Whether these first bytes start a Godot pack (.pck). */
export function isGodotPack(firstBytes: Uint8Array): boolean {
  return firstBytes[0] === 0x47 && firstBytes[1] === 0x44 && firstBytes[2] === 0x50 && firstBytes[3] === 0x43; // "GDPC".
}

/**
 * The GPU and raw textures inside a Godot pack (.pck), found by their headers (.ctex in Godot 4, .stex in
 * Godot 3) and decoded into pictures. Textures stored as PNG or WebP are picture files, matched already; an
 * encrypted pack holds no header to find, and passes.
 */
export async function* godotPicturesInside(source: ByteSource): AsyncGenerator<PictureFound> {
  let textureNumber = 0;
  for (let windowStartIndex = 0; windowStartIndex < source.sizeBytes; windowStartIndex += WINDOW_SIZE_BYTES) {
    const bytes = await source.read(windowStartIndex, Math.min(WINDOW_SIZE_BYTES + HEADER_SIZE_BYTES, source.sizeBytes - windowStartIndex));
    for (let index = bytes.indexOf(0x47); index >= 0 && index < WINDOW_SIZE_BYTES; index = bytes.indexOf(0x47, index + 1)) {
      if (bytes[index + 1] !== 0x53 && bytes[index + 1] !== 0x44) continue; // "GS" or "GD".
      const texture = readHeader(bytes.subarray(index, index + HEADER_SIZE_BYTES));
      if (!texture) continue;
      const dataStartIndex = windowStartIndex + index + texture.headerSizeBytes;
      // Most textures sit inside the window already read.
      const windowed: ByteSource = { sizeBytes: source.sizeBytes, read: async (startIndex, sizeBytes) => (startIndex >= windowStartIndex && startIndex + sizeBytes <= windowStartIndex + bytes.length ? bytes.slice(startIndex - windowStartIndex, startIndex - windowStartIndex + sizeBytes) : source.read(startIndex, sizeBytes)) };
      const found = await texturePicture(windowed, source, dataStartIndex, texture, ++textureNumber).catch(() => null);
      if (found) yield found;
    }
  }
}

interface GodotTexture {
  format: TextureFormat | "l8";
  widthPixelCount: number;
  heightPixelCount: number;
  hasMipmaps: boolean;
  headerSizeBytes: number;
}

function readHeader(header: Uint8Array): GodotTexture | null {
  if (header.length < HEADER_SIZE_BYTES) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.length);
  const magic = String.fromCharCode(...header.subarray(0, 4));
  let texture: GodotTexture | null = null;
  if (magic === "GST2") {
    const isImageData = view.getUint32(36, true) === 0;
    const widthPixelCount = view.getUint16(40, true);
    const heightPixelCount = view.getUint16(42, true);
    const formatNumber = view.getUint32(48, true);
    const format = formatNumber === LUMINANCE_FORMAT_NUMBER ? "l8" : GODOT_4_FORMATS[formatNumber];
    if (!isImageData || !format || view.getUint32(4, true) > 1 || view.getUint32(8, true) !== widthPixelCount || view.getUint32(12, true) !== heightPixelCount) return null;
    texture = { format, widthPixelCount, heightPixelCount, hasMipmaps: view.getUint32(44, true) > 0, headerSizeBytes: 52 };
  } else if (magic === "GDST") {
    const widthPixelCount = view.getUint16(4, true);
    const heightPixelCount = view.getUint16(8, true);
    const dataFormatCode = view.getUint32(16, true);
    const formatNumber = dataFormatCode & 0xfffff;
    const format = formatNumber === LUMINANCE_FORMAT_NUMBER ? "l8" : GODOT_3_FORMATS[formatNumber];
    if (!format || dataFormatCode & GODOT_3_FILE_FORMAT_CODE) return null;
    texture = { format, widthPixelCount, heightPixelCount, hasMipmaps: (dataFormatCode & (1 << 23)) !== 0, headerSizeBytes: 20 };
  }
  if (!texture || texture.widthPixelCount < MINIMUM_TEXTURE_SIDE_PIXEL_COUNT || texture.heightPixelCount < MINIMUM_TEXTURE_SIDE_PIXEL_COUNT || texture.widthPixelCount > MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT || texture.heightPixelCount > MAXIMUM_TEXTURE_SIDE_PIXEL_COUNT) return null;
  return texture;
}

async function texturePicture(searching: ByteSource, source: ByteSource, dataStartIndex: number, texture: GodotTexture, textureNumber: number): Promise<PictureFound | null> {
  const isLuminance = texture.format === "l8";
  // Luminance is read as gray-and-alpha pairs over half the width's bytes: decoded below a byte a pixel instead.
  const format: TextureFormat = isLuminance ? "la8" : (texture.format as TextureFormat);
  const levelCount = texture.hasMipmaps ? Math.floor(Math.log2(Math.max(texture.widthPixelCount, texture.heightPixelCount))) + 1 : 1;
  const levels = isLuminance ? [{ startIndex: 0, widthPixelCount: texture.widthPixelCount, heightPixelCount: texture.heightPixelCount, sizeBytes: texture.widthPixelCount * texture.heightPixelCount }] : textureLevels(format, texture.widthPixelCount, texture.heightPixelCount, levelCount);
  if (!levels) return null;
  const level = levels.find((candidate) => Math.max(candidate.widthPixelCount, candidate.heightPixelCount) <= MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT) ?? levels[0]!;
  if (level.sizeBytes > MAXIMUM_READ_INSIDE_SIZE_BYTES || dataStartIndex + level.startIndex + level.sizeBytes > source.sizeBytes) return null;
  const read = () => source.read(dataStartIndex + level.startIndex, level.sizeBytes);
  const description = new TextEncoder().encode(`godot-texture:${texture.format}:${level.widthPixelCount}x${level.heightPixelCount}:`);
  const bytes = await searching.read(dataStartIndex + level.startIndex, level.sizeBytes);
  const identity = new Uint8Array(description.length + bytes.length);
  identity.set(description);
  identity.set(bytes, description.length);
  return {
    label: `texture ${textureNumber}`,
    type: "image/png",
    sha256: await sha256Hex(identity),
    async body() {
      let pixels = await read();
      if (isLuminance) {
        const pairs = new Uint8Array(pixels.length * 2);
        pixels.forEach((grayByte, i) => pairs.set([grayByte, 255], i * 2));
        pixels = pairs;
      }
      const picture = decodeTexture(format, pixels, level.widthPixelCount, level.heightPixelCount);
      if (!picture) throw new Error(`Texture ${textureNumber} couldn't be decoded`);
      return encodePng(picture);
    },
  };
}
