// Types for performance.mjs, so the site and core import the asset notes type-checked.

export type AssetNoteCode = "images_could_be_ktx2" | "audio_could_be_opus" | "models_could_be_smaller" | "development_build";

export interface AssetFile {
  path: string;
  sizeBytes: number;
  /** The file's text for the checked text files (check.mjs), null for the rest. */
  contentText: string | null;
  /** The first bytes assetHeadSizes asked for, or null when they weren't read. */
  headBytes?: Uint8Array | null;
  /** An image's size, read already, in place of its headBytes. */
  sizePx?: { widthPx: number; heightPx: number } | null;
  /** A sound's length, read already, in place of its headBytes. */
  durationSec?: number | null;
}

export interface PerformanceNote {
  code: string;
  message: string;
  path: string | null;
  saved_size_bytes: number | null;
  fix: string;
}

export const ASSET_HEAD_SIZE_BYTES: number;
export const ASSET_NOTE_LIMITS: {
  minimumImageSizeBytes: number;
  minimumImagesSizeBytes: number;
  minimumImagesSavedSizeBytes: number;
  minimumAudioSizeBytes: number;
  minimumModelsSizeBytes: number;
  ktx2BytesPerPixel: number;
  opusBytesPerSec: number;
};
export const ASSET_NOTE_CODES: Record<AssetNoteCode, { meaning: string; fix: string }>;
export function assetHeadSizes(files: { path: string; sizeBytes: number }[]): Map<string, number>;
export function imageSizePx(bytes: Uint8Array | null | undefined): { widthPx: number; heightPx: number } | null;
export function audioDurationSec(bytes: Uint8Array | null | undefined, sizeBytes: number): number | null;
export function findAssetNotes(files: AssetFile[], options?: { isDrawnWithGpu?: boolean | null }): PerformanceNote[];
