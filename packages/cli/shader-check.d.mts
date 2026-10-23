// Types for shader-check.mjs, so core and the site import the shader check's drawing type-checked. The shapes the API shows are core's.
import type { BackgroundScreen, BackgroundTone, ShaderBufferName, ShaderChannel, ShaderDrawPass, ShaderManifest, ShaderQualityCheck } from "../core/src/developers.ts";

export const MOST_GLASS_PANE_COUNT: number;
export const GLASS_LIGHT_PASS: string;
export const BUFFER_PASS: string;
export const SHADER_HEAD: string;
export const SHADER_VERTEX_SOURCE: string;
export const CHECK_REFERENCE_SHADER: string;
export const SHADER_CHECK_PAGE: string;

export const SHADER_LIMITS: {
  maximumPassSizeBytes: number;
  maximumBufferCount: number;
  maximumChannelCount: number;
  maximumShaderTextureCount: number;
  maximumGameTextureCount: number;
  maximumTextureSidePx: number;
  maximumTextureSizeBytes: number;
  checkWidthPx: number;
  checkHeightPx: number;
  checkFrameCount: number;
  checkFrameStepSec: number;
  referenceFrameMs: number;
  qualityLevels: { qualityLevel: number; maximumCheckFrameMs: number }[];
  stillQualityLevelByScreen: Record<BackgroundScreen, number>;
  maximumFlashCountPerSec: number;
  stillTimeSec: number;
  stillWidthPx: number;
  stillHeightPx: number;
  bufferedStillWidthPx: number;
  bufferedStillHeightPx: number;
  sampledHistoryStepSec: number;
  sampledFrameCount: number;
  sampledFramesOverSec: number;
  checkTimeoutSec: number;
  maximumShaderChecksPerDay: number;
  checkSheetKeptDurationSec: number;
  keptShaderCount: number;
  runtimeMaximumFps: number;
  runtimeResolutionScale: number;
  runtimeDrawShareNumber: number;
  runtimeUpscaleNumber: number;
  runtimeIdleTimeoutSec: number;
  runtimeIdleFramesPerSec: number;
};

export const SHADER_BUFFER_NAMES: readonly ShaderBufferName[];
export function shaderPassesInDrawOrder(manifest: ShaderManifest): ShaderDrawPass[];
export function shaderWithoutComments(source: string): string;
export function shaderReadsQuality(manifest: ShaderManifest): boolean;
export function shaderChannelSampling(channel: Pick<ShaderChannel, "input_kind" | "filter" | "wrap">): { minificationFilterName: string; magnificationFilterName: string; wrapName: string; hasMipmaps: boolean };
export const SHADER_TEXTURE_BITMAP_OPTIONS: { readonly imageOrientation: "flipY"; readonly premultiplyAlpha: "none"; readonly colorSpaceConversion: "none" };
export function wrapShader(source: string): string;
export function wrapShaderBuffer(source: string): string;
export function wrapShaderPass(pass: Pick<ShaderDrawPass, "bufferName" | "source">): string;

/** One quality level's timed frames. */
export interface ShaderLevelRender {
  qualityLevel: number;
  /** Each timed frame's draw, in milliseconds. Fewer than checkFrameCount when it stopped early for being slow. */
  frameTimesMs: number[];
  /** Each timed frame's mean relative luminance, 0 to 1. */
  frameLuminances: number[];
}

/** One shader on the check's renderer: what it drew, or the first compiler error. */
export interface ShaderRender {
  /** The compiler's first error line, a buffer's starting with its name; null when every pass compiled. */
  compileError: string | null;
  /** The reference shader's frames, timed in the same browser first; empty when none was given. */
  referenceFrameTimesMs: number[];
  /** Each quality level timed, in order; a level after one far too slow isn't drawn. */
  levels: ShaderLevelRender[];
  /** The still at stillTimeSec, at its full size (checkSizes), as PNG. */
  stillPng: Uint8Array | null;
  /** The still again at the check's size, for the listing check and its tone (the full one can be over its size limit). */
  smallStillPng: Uint8Array | null;
  /** sampledFrameCount frames over the first sampledFramesOverSec seconds, as PNG: at the check's size, or the still's for a shader with buffers. */
  framePngs: Uint8Array[];
  /** Two frames drawn 1/30 s apart at the check's size, for the shimmer note; only when the sheet was asked for. */
  shimmerPngs: Uint8Array[];
  /** The sheet picture a check before sending answers with; only when it was asked for. */
  sheetPng: Uint8Array | null;
}

/** What the renderer draws: the passes in draw order, each its whole fragment shader (wrapShaderPass), and the textures they read. */
export interface ShaderRenderInput {
  passes: { bufferName: ShaderBufferName | null; fragmentSource: string; channels: ShaderChannel[] }[];
  /** Each texture a channel names, by its image_id: a missing one reads black. */
  textures: { imageId: string; bytes: Uint8Array }[];
  screen: BackgroundScreen;
  /** Timed first, to measure the renderer's speed. */
  referenceSource: string;
  /** The levels to time, each from iTime 0: all three for a shader that reads iQuality, else level 0 alone. */
  qualityLevels: number[];
  /** Whether to draw the sheet and the frames for the shimmer note too: a check before sending. */
  isSheetWanted: boolean;
}

/** What SHADER_CHECK_PAGE's zaismaCheck answers: shaderRenderFromPage turns its data URLs into PNG bytes. */
export interface ShaderPageDrawing {
  compileError: string | null;
  referenceFrameTimesMs: number[];
  levels: ShaderLevelRender[];
  stillDataUrl: string | null;
  smallStillDataUrl: string | null;
  frameDataUrls: string[];
  shimmerDataUrls: string[];
  sheetDataUrl: string | null;
}

/** A note a check before sending answers with: something worth fixing that never holds a shader. */
export interface ShaderCheckNote {
  code: "shimmers_when_small" | "forces_thick_glass";
  message: string;
  fix: string;
}

/** The shader_check answer (schemas.ts, SHADER_CHECK). */
export interface ShaderCheckAnswer {
  compile_error: string | null;
  quality_checks: ShaderQualityCheck[];
  flash_count: number | null;
  is_glass_smoked: boolean | null;
  glass_tint_pct: number | null;
  notes: ShaderCheckNote[];
  sheet_url: string | null;
  sheet_expires_at: string | null;
}

export function checkSizes(screen: BackgroundScreen, isBuffered?: boolean): { checkWidthPx: number; checkHeightPx: number; stillWidthPx: number; stillHeightPx: number };
export const SAMPLED_TIMES_SEC: number[];
export function shaderRenderInputOf(manifest: ShaderManifest, screen: BackgroundScreen, textures: ShaderRenderInput["textures"], isSheetWanted: boolean): ShaderRenderInput;
export function shaderCheckPageInput(input: ShaderRenderInput): Record<string, unknown>;
export function shaderCheckPageExpressions(input: ShaderRenderInput): { textureExpressions: string[]; checkExpression: string };
export function shaderRenderFromPage(drawn: ShaderPageDrawing | null, input: Pick<ShaderRenderInput, "qualityLevels">): ShaderRender;
export function mostFlashesInOneSecond(frameLuminances: number[], frameStepSec?: number): number;
export function measureQualityLevels(drawn: Pick<ShaderRender, "referenceFrameTimesMs" | "levels">): { qualityChecks: ShaderQualityCheck[]; tooSlow: ShaderQualityCheck | null };
export function mostFlashes(drawn: Pick<ShaderRender, "levels">): number;
export const SHIMMER_LIMITS: { acrossTileCount: number; downTileCount: number; speckledTileNumber: number; shimmeringTilePct: number };
export function frameShimmer(first: Uint8Array, second: Uint8Array, widthPx: number, heightPx: number): { meanChangeNumber: number; speckledTilePct: number; tileSpeckleNumbers: number[] };
export function toneOfPixels(rgba: Uint8Array): BackgroundTone | null;
export function glassTint(tone: BackgroundTone): string;
export function pngPixels(bytes: Uint8Array): Promise<Uint8Array | null>;
export function toneOfPng(bytes: Uint8Array): Promise<BackgroundTone | null>;
export const THICK_GLASS_TINT_PCT: number;
export function shaderCheckNotes(shimmerPngs: Uint8Array[], tone: BackgroundTone | null, checkWidthPx: number, checkHeightPx: number): Promise<ShaderCheckNote[]>;
export function compileMessage(compileError: string): string;
export function shaderDraftAnswer(drawn: ShaderRender, screen: BackgroundScreen): Promise<ShaderCheckAnswer>;
export function isShaderCheckPassing(shaderCheck: Pick<ShaderCheckAnswer, "compile_error" | "quality_checks" | "flash_count">): boolean;
