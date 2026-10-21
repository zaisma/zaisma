import type { BackgroundTone } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * A background's tone: its average color and the glass Zaisma puts over it, measured once from the whole picture (a background
 * picture, when it's added) or the still (a shader, when the check draws it) and kept on its row. Pages send it with the background,
 * so the home opens on the game's own color with its glass already right, and the backdrop script (components/backdrop-script.ts)
 * takes the glass from it instead of measuring. The rule is the backdrop script's pickGlass, which measures backgrounds kept before
 * tones were; keep the two in step: light glass (dark words) or smoked glass (light words), whichever can be thinner while every word
 * keeps its contrast against the harsh side of what's behind.
 */

type Color = [number, number, number];

function luminance(color: Color): number {
  const linear = (channelNumber: number) => { const shareNumber = channelNumber / 255; return shareNumber <= 0.03928 ? shareNumber / 12.92 : Math.pow((shareNumber + 0.055) / 1.055, 2.4); };
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}
function contrast(first: Color, second: Color): number {
  const firstNumber = luminance(first), secondNumber = luminance(second);
  return (Math.max(firstNumber, secondNumber) + 0.05) / (Math.min(firstNumber, secondNumber) + 0.05);
}
function blend(from: Color, to: Color, shareNumber: number): Color {
  return [from[0] + (to[0] - from[0]) * shareNumber, from[1] + (to[1] - from[1]) * shareNumber, from[2] + (to[2] - from[2]) * shareNumber];
}
const LIGHT_GLASS_BASE: Color = [255, 255, 255], SMOKED_GLASS_BASE: Color = [12, 15, 20];
/** How much of the average a kind of glass takes into its tint. */
const AVERAGE_SHARE = { light: 0.1, smoked: 0.3 };

function thinnestShare(isSmoked: boolean, base: Color, sorted: Color[]): number {
  const harsh = isSmoked ? sorted[Math.floor(sorted.length * 0.75)]! : sorted[Math.floor(sorted.length * 0.25)]!;
  for (let shareNumber = 0.3; shareNumber <= 0.95; shareNumber += 0.02) {
    const seen = blend(harsh, base, shareNumber), ink: Color = isSmoked ? [247, 249, 252] : [20, 23, 28], quiet: Color = isSmoked ? blend(seen, ink, 0.7) : [89, 96, 106];
    if (contrast(seen, quiet) >= 4.5 && contrast(seen, ink) >= 6) return shareNumber;
  }
  return 0.95;
}

const hex = (color: Color) => "#" + color.map((channelNumber) => Math.round(channelNumber).toString(16).padStart(2, "0")).join("").toUpperCase();
const fromHex = (hexColor: string): Color => [parseInt(hexColor.slice(1, 3), 16), parseInt(hexColor.slice(3, 5), 16), parseInt(hexColor.slice(5, 7), 16)];

/** The tone of a picture's pixels (RGBA, 8 bits each), sampled evenly. */
export function toneOfPixels(rgba: Uint8Array): BackgroundTone | null {
  const pixelCount = Math.floor(rgba.length / 4);
  if (!pixelCount) return null;
  const skippedPixelCount = Math.max(1, Math.floor(pixelCount / 2400)), colors: Color[] = [];
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += skippedPixelCount) colors.push([rgba[pixelIndex * 4]!, rgba[pixelIndex * 4 + 1]!, rgba[pixelIndex * 4 + 2]!]);
  const sum = colors.reduce<Color>((total, color) => [total[0] + color[0], total[1] + color[1], total[2] + color[2]], [0, 0, 0]);
  const average: Color = [sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length];
  const sorted = colors.slice().sort((first, second) => luminance(first) - luminance(second));
  const lightShareNumber = thinnestShare(false, blend(LIGHT_GLASS_BASE, average, AVERAGE_SHARE.light), sorted);
  const smokedShareNumber = thinnestShare(true, blend(SMOKED_GLASS_BASE, average, AVERAGE_SHARE.smoked), sorted);
  const isSmoked = lightShareNumber > smokedShareNumber;
  return { average_color: hex(average), is_glass_smoked: isSmoked ? 1 : 0, glass_tint_pct: Math.round(Math.min(lightShareNumber, smokedShareNumber) * 100) };
}

/** The tint the glass over it takes, as the backdrop script sets --glass-tint. */
export function glassTint(tone: BackgroundTone): string {
  const isSmoked = tone.is_glass_smoked === 1;
  const base = blend(isSmoked ? SMOKED_GLASS_BASE : LIGHT_GLASS_BASE, fromHex(tone.average_color), isSmoked ? AVERAGE_SHARE.smoked : AVERAGE_SHARE.light);
  return `rgba(${base.map(Math.round).join(", ")}, ${(tone.glass_tint_pct / 100).toFixed(2)})`;
}

/** What a page sends with a background: its color and its glass. */
export interface ShownTone {
  averageColor: string;
  isGlassSmoked: boolean;
  glassTint: string;
}
type KeptTone = { [Name in keyof BackgroundTone]: BackgroundTone[Name] | null };
export const shownTone = (kept: KeptTone): ShownTone | null =>
  kept.average_color !== null && kept.is_glass_smoked !== null && kept.glass_tint_pct !== null
    ? { averageColor: kept.average_color, isGlassSmoked: kept.is_glass_smoked === 1, glassTint: glassTint(kept as BackgroundTone) }
    : null;

/** A PNG's pixels as RGBA: 8 bits a channel, gray, RGB or RGBA, not interlaced. Anything else answers null. */
export async function pngPixels(bytes: Uint8Array): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47) return null;
  let chunkIndex = 8, widthPx = 0, heightPx = 0, colorTypeNumber = -1;
  const compressed: Uint8Array[] = [];
  while (chunkIndex + 8 <= bytes.length) {
    const chunkSizeBytes = view.getUint32(chunkIndex), chunkType = String.fromCharCode(...bytes.subarray(chunkIndex + 4, chunkIndex + 8));
    const chunkBytes = bytes.subarray(chunkIndex + 8, chunkIndex + 8 + chunkSizeBytes);
    if (chunkType === "IHDR") {
      widthPx = view.getUint32(chunkIndex + 8); heightPx = view.getUint32(chunkIndex + 12); colorTypeNumber = chunkBytes[9]!;
      if (chunkBytes[8] !== 8 || chunkBytes[12] !== 0 || ![0, 2, 4, 6].includes(colorTypeNumber)) return null;
    } else if (chunkType === "IDAT") compressed.push(chunkBytes);
    else if (chunkType === "IEND") break;
    chunkIndex += 12 + chunkSizeBytes;
  }
  if (!widthPx || !heightPx || !compressed.length) return null;
  const channelCount = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorTypeNumber as 0 | 2 | 4 | 6], rowSizeBytes = widthPx * channelCount;
  const filtered = new Uint8Array(await new Response(new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  if (filtered.length < (rowSizeBytes + 1) * heightPx) return null;
  // Each row starts with its filter: none, sub (from the left), up, average or Paeth.
  const rows = new Uint8Array(rowSizeBytes * heightPx);
  for (let rowIndex = 0; rowIndex < heightPx; rowIndex++) {
    const filterNumber = filtered[rowIndex * (rowSizeBytes + 1)]!, source = filtered.subarray(rowIndex * (rowSizeBytes + 1) + 1, (rowIndex + 1) * (rowSizeBytes + 1)), rowStartIndex = rowIndex * rowSizeBytes;
    for (let byteIndex = 0; byteIndex < rowSizeBytes; byteIndex++) {
      const leftNumber = byteIndex >= channelCount ? rows[rowStartIndex + byteIndex - channelCount]! : 0;
      const upNumber = rowIndex ? rows[rowStartIndex - rowSizeBytes + byteIndex]! : 0;
      const upLeftNumber = rowIndex && byteIndex >= channelCount ? rows[rowStartIndex - rowSizeBytes + byteIndex - channelCount]! : 0;
      const predictedNumber = filterNumber === 1 ? leftNumber : filterNumber === 2 ? upNumber : filterNumber === 3 ? (leftNumber + upNumber) >> 1 : filterNumber === 4 ? paeth(leftNumber, upNumber, upLeftNumber) : 0;
      rows[rowStartIndex + byteIndex] = (source[byteIndex]! + predictedNumber) & 255;
    }
  }
  const rgba = new Uint8Array(widthPx * heightPx * 4), isGray = channelCount <= 2;
  for (let pixelIndex = 0; pixelIndex < widthPx * heightPx; pixelIndex++) {
    const sourceIndex = pixelIndex * channelCount;
    rgba[pixelIndex * 4] = rows[sourceIndex]!;
    rgba[pixelIndex * 4 + 1] = isGray ? rows[sourceIndex]! : rows[sourceIndex + 1]!;
    rgba[pixelIndex * 4 + 2] = isGray ? rows[sourceIndex]! : rows[sourceIndex + 2]!;
    rgba[pixelIndex * 4 + 3] = 255;
  }
  return rgba;
}
function paeth(leftNumber: number, upNumber: number, upLeftNumber: number): number {
  const estimateNumber = leftNumber + upNumber - upLeftNumber;
  const leftDistanceNumber = Math.abs(estimateNumber - leftNumber), upDistanceNumber = Math.abs(estimateNumber - upNumber), upLeftDistanceNumber = Math.abs(estimateNumber - upLeftNumber);
  return leftDistanceNumber <= upDistanceNumber && leftDistanceNumber <= upLeftDistanceNumber ? leftNumber : upDistanceNumber <= upLeftDistanceNumber ? upNumber : upLeftNumber;
}

export async function toneOfPng(bytes: Uint8Array): Promise<BackgroundTone | null> {
  const rgba = await pngPixels(bytes);
  return rgba ? toneOfPixels(rgba) : null;
}

/** A picture's tone, made small with Cloudflare Images and measured; null without the Images binding or when it fails. */
export async function toneOfPicture(env: Env, bytes: Uint8Array): Promise<BackgroundTone | null> {
  if (!env.IMAGES) return null;
  try {
    const small = await env.IMAGES.input(new Blob([bytes]).stream()).transform({ width: 96, height: 96, fit: "scale-down" }).output({ format: "image/png" });
    return await toneOfPng(new Uint8Array(await new Response(small.image()).arrayBuffer()));
  } catch (error) {
    console.error("background tone failed", error);
    return null;
  }
}
