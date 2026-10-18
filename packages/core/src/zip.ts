import { unzipSync } from "fflate";
import { CONTENT_TYPES, extensionOf } from "./mime.ts";
import type { ErrorCode } from "./errors.ts";

export const ZIP_LIMITS = {
  maximumZipSizeBytes: 25 * 1024 * 1024,
  maximumUnpackedSizeBytes: 100 * 1024 * 1024,
  maximumFileSizeBytes: 25 * 1024 * 1024,
  maximumFileCount: 2000,
  maximumPathCharacterCount: 200,
};

/** Why an upload was refused. From the developer API's file list it also says its error code, the input at fault and the fix. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly problem?: { code: ErrorCode; field: string | null; fix: string },
  ) {
    super(message);
  }
}

export interface ZipEntry {
  /** Path inside the zip, as stored. */
  zipName: string;
  /** Cleaned path we serve the file at, relative to the game root. */
  path: string;
  sizeBytes: number;
}

export interface GameFile {
  path: string;
  bytes: Uint8Array;
}

// Files Macs and Windows add to zips. Dropped silently, never served.
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

/**
 * Read the zip's file list and check it against our rules without
 * unpacking anything. Throws UploadError with a message for the developer.
 */
export function listGameFiles(zip: Uint8Array): ZipEntry[] {
  if (zip.byteLength > ZIP_LIMITS.maximumZipSizeBytes) {
    throw new UploadError(`The zip is over ${megabytes(ZIP_LIMITS.maximumZipSizeBytes)}.`);
  }
  const raw: { name: string; sizeBytes: number }[] = [];
  try {
    unzipSync(zip, {
      filter(file) {
        raw.push({ name: file.name, sizeBytes: file.originalSize });
        return false;
      },
    });
  } catch {
    throw new UploadError("That file isn't a readable zip.");
  }

  const files = raw.filter((file) => !file.name.endsWith("/") && !JUNK.test(file.name));
  if (files.length === 0) throw new UploadError("The zip is empty.");
  if (files.length > ZIP_LIMITS.maximumFileCount) {
    throw new UploadError(`The zip has ${files.length} files; the limit is ${ZIP_LIMITS.maximumFileCount}.`);
  }

  const cleaned = files.map((file) => ({ zipName: file.name, path: cleanPath(file.name), sizeBytes: file.sizeBytes }));

  // Games zipped as a folder: strip the single top folder.
  if (!cleaned.some((entry) => entry.path === "index.html")) {
    const tops = new Set(cleaned.map((entry) => entry.path.split("/")[0]));
    const [top] = tops;
    if (tops.size === 1 && top && cleaned.some((entry) => entry.path === `${top}/index.html`)) {
      for (const entry of cleaned) entry.path = entry.path.slice(top.length + 1);
    } else {
      throw new UploadError("The zip needs an index.html at the top level.");
    }
  }

  let totalSizeBytes = 0;
  const seen = new Set<string>();
  for (const entry of cleaned) {
    if (entry.path.split("/").some((part) => part.startsWith("."))) {
      throw new UploadError(`Hidden files aren't allowed: ${entry.path}`);
    }
    const extension = extensionOf(entry.path);
    if (extension === "gz" || extension === "br") {
      throw new UploadError(
        `${entry.path} is pre-compressed. Turn off compression in your engine's build settings; Zaisma compresses files for you.`,
      );
    }
    if (!(extension in CONTENT_TYPES)) {
      throw new UploadError(`${entry.path}: .${extension || "(no extension)"} files aren't allowed in games.`);
    }
    if (entry.sizeBytes > ZIP_LIMITS.maximumFileSizeBytes) throw new UploadError(`${entry.path} is over ${megabytes(ZIP_LIMITS.maximumFileSizeBytes)}.`);
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new UploadError(`Two files share the path ${entry.path}.`);
    seen.add(key);
    totalSizeBytes += entry.sizeBytes;
  }
  if (totalSizeBytes > ZIP_LIMITS.maximumUnpackedSizeBytes) {
    throw new UploadError(`The game unpacks to ${megabytes(totalSizeBytes)}; the limit is ${megabytes(ZIP_LIMITS.maximumUnpackedSizeBytes)}.`);
  }
  return cleaned;
}

/**
 * Unpack files in batches so a whole game never sits in memory at once
 * (Workers get 128 MB). Each file is checked for executable content.
 */
export function* unpackGameFiles(zip: Uint8Array, entries: ZipEntry[], maximumBatchSizeBytes = 16 * 1024 * 1024): Generator<GameFile[]> {
  let i = 0;
  while (i < entries.length) {
    const batch = new Map<string, ZipEntry>();
    let batchSizeBytes = 0;
    while (i < entries.length && (batch.size === 0 || batchSizeBytes + entries[i]!.sizeBytes <= maximumBatchSizeBytes)) {
      const entry = entries[i++]!;
      batch.set(entry.zipName, entry);
      batchSizeBytes += entry.sizeBytes;
    }
    const out = unzipSync(zip, { filter: (file) => batch.has(file.name) });
    const files: GameFile[] = [];
    for (const [name, entry] of batch) {
      const bytes = out[name];
      if (!bytes || bytes.byteLength !== entry.sizeBytes) {
        throw new UploadError(`${entry.path} is damaged or its size doesn't match the zip.`);
      }
      const bad = forbiddenContent(bytes);
      if (bad) throw new UploadError(`${entry.path} looks like ${bad}, which isn't allowed in games.`);
      files.push({ path: entry.path, bytes });
    }
    yield files;
  }
}

export function cleanPath(name: string): string {
  const path = name.replace(/\\/g, "/");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new UploadError("A file name contains control characters.");
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) throw new UploadError(`Absolute paths aren't allowed: ${name}`);
  const parts = path.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) throw new UploadError(`Unsafe path in zip: ${name}`);
  if (path.length > ZIP_LIMITS.maximumPathCharacterCount) throw new UploadError(`Path too long: ${name.slice(0, 60)}…`);
  return path;
}

/** Name of the forbidden format if the bytes are an executable or archive, whatever the extension. */
export function forbiddenContent(bytes: Uint8Array): string | null {
  const startsWith = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (startsWith(0x4d, 0x5a)) return "a Windows program";
  if (startsWith(0x7f, 0x45, 0x4c, 0x46)) return "a Linux program";
  if (startsWith(0xfe, 0xed, 0xfa, 0xce) || startsWith(0xfe, 0xed, 0xfa, 0xcf) || startsWith(0xce, 0xfa, 0xed, 0xfe) || startsWith(0xcf, 0xfa, 0xed, 0xfe)) {
    return "a Mac program";
  }
  if (startsWith(0xca, 0xfe, 0xba, 0xbe)) return "a Mac or Java program";
  if (startsWith(0x23, 0x21)) return "a shell script";
  if (startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06)) return "a zip-based archive (zip, jar, apk, docx)";
  if (startsWith(0x52, 0x61, 0x72, 0x21)) return "a RAR archive";
  if (startsWith(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return "a 7-Zip archive";
  if (startsWith(0x1f, 0x8b)) return "a gzip archive";
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "a PDF";
  return null;
}

function megabytes(sizeBytes: number): string {
  return `${Math.round(sizeBytes / 1024 / 1024)} MB`;
}
