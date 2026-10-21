import { extensionOf } from "./mime.ts";

/**
 * Zaisma's Brotli copies of game files (docs/DECISIONS.md, "Game files reach players small and from nearby,
 * exactly as uploaded"). Every stored file that isn't already compressed is tried; a copy is kept only when it's
 * at most maximumKeptSizePct of the original. Quality 11 runs near 1 MB/s, so files past
 * bestQualityMaximumFileSizeBytes get largeFileQuality, which keeps most of the gain and fits a 500 MB file
 * in the Worker's CPU limit. A 4 MB window (windowBits 22) keeps the compressor under 60 MB of a Worker's
 * 128 MB; a 16 MB one needs about 150 MB at quality 11 for 1% smaller copies.
 */
export const BROTLI_LIMITS = {
  minimumFileSizeBytes: 1024,
  maximumKeptSizePct: 90,
  bestQualityMaximumFileSizeBytes: 16 * 1024 * 1024,
  bestQuality: 11,
  largeFileQuality: 9,
  windowBits: 22,
};

/** Formats that are compressed already: never tried. */
export const ALREADY_COMPRESSED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "mp3", "ogg", "oga", "opus", "m4a", "aac", "mp4", "webm", "woff", "woff2", "zip", "basis"]);

/**
 * Whether a file of this type could have a copy. Pages aren't: they get Zaisma's scripts on the way out,
 * and Cloudflare compresses them then.
 */
export function isCompressibleType(path: string): boolean {
  const extension = extensionOf(path);
  return extension !== "html" && !ALREADY_COMPRESSED_EXTENSIONS.has(extension);
}

/** Whether Zaisma tries to make a Brotli copy of this file. */
export function isCompressible(path: string, sizeBytes: number): boolean {
  return isCompressibleType(path) && sizeBytes >= BROTLI_LIMITS.minimumFileSizeBytes;
}

/** Where a stored file's Brotli copy is: brotli/blobs/<sha256> or brotli/owned/<owner_id>/<sha256>. */
export const brotliKeyOf = (storageKey: string) => `brotli/${storageKey}`;

/** One stored file to make a Brotli copy of, checked against its fingerprint while it's read. */
export type CompressJob = { storageKey: string; sha256: string };
