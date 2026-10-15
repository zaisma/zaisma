import { unzipSync } from "fflate";
import { CONTENT_TYPES, extensionOf } from "./mime.ts";
import type { ErrorCode } from "./errors.ts";

export const LIMITS = {
  zipBytes: 25 * 1024 * 1024,
  unpackedBytes: 100 * 1024 * 1024,
  fileBytes: 25 * 1024 * 1024,
  files: 2000,
  pathLength: 200,
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
  size: number;
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
  if (zip.byteLength > LIMITS.zipBytes) {
    throw new UploadError(`The zip is over ${mb(LIMITS.zipBytes)}.`);
  }
  const raw: { name: string; size: number }[] = [];
  try {
    unzipSync(zip, {
      filter(f) {
        raw.push({ name: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    throw new UploadError("That file isn't a readable zip.");
  }

  const files = raw.filter((f) => !f.name.endsWith("/") && !JUNK.test(f.name));
  if (files.length === 0) throw new UploadError("The zip is empty.");
  if (files.length > LIMITS.files) {
    throw new UploadError(`The zip has ${files.length} files; the limit is ${LIMITS.files}.`);
  }

  const cleaned = files.map((f) => ({ zipName: f.name, path: cleanPath(f.name), size: f.size }));

  // Games zipped as a folder: strip the single top folder.
  if (!cleaned.some((f) => f.path === "index.html")) {
    const tops = new Set(cleaned.map((f) => f.path.split("/")[0]));
    const [top] = tops;
    if (tops.size === 1 && top && cleaned.some((f) => f.path === `${top}/index.html`)) {
      for (const f of cleaned) f.path = f.path.slice(top.length + 1);
    } else {
      throw new UploadError("The zip needs an index.html at the top level.");
    }
  }

  let total = 0;
  const seen = new Set<string>();
  for (const f of cleaned) {
    if (f.path.split("/").some((part) => part.startsWith("."))) {
      throw new UploadError(`Hidden files aren't allowed: ${f.path}`);
    }
    const ext = extensionOf(f.path);
    if (ext === "gz" || ext === "br") {
      throw new UploadError(
        `${f.path} is pre-compressed. Turn off compression in your engine's build settings; Zaisma compresses files for you.`,
      );
    }
    if (!(ext in CONTENT_TYPES)) {
      throw new UploadError(`${f.path}: .${ext || "(no extension)"} files aren't allowed in games.`);
    }
    if (f.size > LIMITS.fileBytes) throw new UploadError(`${f.path} is over ${mb(LIMITS.fileBytes)}.`);
    const key = f.path.toLowerCase();
    if (seen.has(key)) throw new UploadError(`Two files share the path ${f.path}.`);
    seen.add(key);
    total += f.size;
  }
  if (total > LIMITS.unpackedBytes) {
    throw new UploadError(`The game unpacks to ${mb(total)}; the limit is ${mb(LIMITS.unpackedBytes)}.`);
  }
  return cleaned;
}

/**
 * Unpack files in batches so a whole game never sits in memory at once
 * (Workers get 128 MB). Each file is checked for executable content.
 */
export function* unpackGameFiles(zip: Uint8Array, entries: ZipEntry[], batchBytes = 16 * 1024 * 1024): Generator<GameFile[]> {
  let i = 0;
  while (i < entries.length) {
    const batch = new Map<string, ZipEntry>();
    let size = 0;
    while (i < entries.length && (batch.size === 0 || size + entries[i]!.size <= batchBytes)) {
      const e = entries[i++]!;
      batch.set(e.zipName, e);
      size += e.size;
    }
    const out = unzipSync(zip, { filter: (f) => batch.has(f.name) });
    const files: GameFile[] = [];
    for (const [name, entry] of batch) {
      const bytes = out[name];
      if (!bytes || bytes.byteLength !== entry.size) {
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
  if (parts.some((p) => p === ".." || p === "." || p === "")) throw new UploadError(`Unsafe path in zip: ${name}`);
  if (path.length > LIMITS.pathLength) throw new UploadError(`Path too long: ${name.slice(0, 60)}…`);
  return path;
}

/** Name of the forbidden format if the bytes are an executable or archive, whatever the extension. */
export function forbiddenContent(b: Uint8Array): string | null {
  const at = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (at(0x4d, 0x5a)) return "a Windows program";
  if (at(0x7f, 0x45, 0x4c, 0x46)) return "a Linux program";
  if (at(0xfe, 0xed, 0xfa, 0xce) || at(0xfe, 0xed, 0xfa, 0xcf) || at(0xce, 0xfa, 0xed, 0xfe) || at(0xcf, 0xfa, 0xed, 0xfe)) {
    return "a Mac program";
  }
  if (at(0xca, 0xfe, 0xba, 0xbe)) return "a Mac or Java program";
  if (at(0x23, 0x21)) return "a shell script";
  if (at(0x50, 0x4b, 0x03, 0x04) || at(0x50, 0x4b, 0x05, 0x06)) return "a zip-based archive (zip, jar, apk, docx)";
  if (at(0x52, 0x61, 0x72, 0x21)) return "a RAR archive";
  if (at(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return "a 7-Zip archive";
  if (at(0x1f, 0x8b)) return "a gzip archive";
  if (at(0x25, 0x50, 0x44, 0x46)) return "a PDF";
  return null;
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
