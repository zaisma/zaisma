import { CONTENT_TYPES, extensionOf } from "./mime.ts";
import { UploadError, cleanPath } from "./zip.ts";
import type { Version } from "./types.ts";

/**
 * File-by-file uploads. Each file is stored once, by its SHA-256, at blobs/<sha256> in the games
 * bucket, and shared by every version (and later every remix) that has it, so an update only
 * uploads what changed. A version is a manifest: path -> file, at manifests/<version id>.json.
 */

export const FILE_LIMITS = {
  gameBytes: 2 * 1024 * 1024 * 1024,
  /** Requests through a Worker top out at 100 MB; bigger files come with multipart uploads. */
  fileBytes: 95 * 1024 * 1024,
  files: 20_000,
  versionsPerDay: 20,
  notes: 2000,
};

/** Approved versions kept besides the live one, for rolling back. */
export const KEEP_VERSIONS = 5;

export interface UploadFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface Manifest {
  files: Record<string, { sha256: string; bytes: number }>;
}

export const blobKey = (sha256: string) => `blobs/${sha256}`;
export const manifestKey = (versionId: string) => `manifests/${versionId}.json`;
export const SHA256 = /^[0-9a-f]{64}$/;

/** Check a version's file list against the same rules as zips, with the bigger limits. Throws UploadError. */
export function checkUploadList(input: unknown): UploadFile[] {
  if (!Array.isArray(input) || input.length === 0) throw new UploadError("Send the game's files as a list of { path, sha256, bytes }.");
  if (input.length > FILE_LIMITS.files) throw new UploadError(`The game has ${input.length} files; the limit is ${FILE_LIMITS.files.toLocaleString("en-US")}.`);
  const seen = new Set<string>();
  let total = 0;
  const files: UploadFile[] = [];
  for (const raw of input) {
    const f = raw as Partial<UploadFile>;
    if (typeof f?.path !== "string" || typeof f.sha256 !== "string" || !SHA256.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes! < 0) {
      throw new UploadError("Each file needs a path, its SHA-256 in lowercase hex and its size in bytes.");
    }
    const path = cleanPath(f.path);
    if (path.split("/").some((part) => part.startsWith("."))) throw new UploadError(`Hidden files aren't allowed: ${path}`);
    const ext = extensionOf(path);
    if (ext === "gz" || ext === "br") {
      throw new UploadError(`${path} is pre-compressed. Turn off compression in your engine's build settings; Zaisma compresses files for you.`);
    }
    if (!(ext in CONTENT_TYPES)) throw new UploadError(`${path}: .${ext || "(no extension)"} files aren't allowed in games.`);
    if (f.bytes! > FILE_LIMITS.fileBytes) throw new UploadError(`${path} is over ${mb(FILE_LIMITS.fileBytes)}. Split it into smaller files for now.`);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new UploadError(`Two files share the path ${path}.`);
    seen.add(key);
    total += f.bytes!;
    files.push({ path, sha256: f.sha256, bytes: f.bytes! });
  }
  if (!seen.has("index.html")) throw new UploadError("The game needs an index.html at the top level.");
  if (total > FILE_LIMITS.gameBytes) throw new UploadError(`The game is ${mb(total)}; the limit is ${mb(FILE_LIMITS.gameBytes)}. Ask us if you need more.`);
  return files;
}

/** Which of these files we don't have yet. */
export async function missingBlobs(db: D1Database, shas: string[]): Promise<string[]> {
  const unique = [...new Set(shas)];
  const have = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    statements.push(db.prepare(`SELECT sha256 FROM blobs WHERE sha256 IN (${chunk.map(() => "?").join(",")})`).bind(...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const res of await db.batch<{ sha256: string }>(statements.slice(i, i + 50))) for (const r of res.results) have.add(r.sha256);
  }
  return unique.filter((s) => !have.has(s));
}

export async function addBlob(db: D1Database, sha256: string, bytes: number): Promise<void> {
  await db.prepare("INSERT INTO blobs (sha256, bytes, created_at) VALUES (?, ?, ?) ON CONFLICT (sha256) DO NOTHING").bind(sha256, bytes, Date.now()).run();
}

export function toManifest(files: UploadFile[]): Manifest {
  const out: Manifest = { files: {} };
  for (const f of files) out.files[f.path] = { sha256: f.sha256, bytes: f.bytes };
  return out;
}

/** Where a version's file lives in the games bucket: under its prefix (zip uploads) or as a shared blob. */
export function fileKey(version: Pick<Version, "kind" | "r2_prefix">, manifest: Manifest | null, path: string): string | null {
  if (version.kind !== "files") return `${version.r2_prefix}/${path}`;
  const f = manifest?.files[path];
  return f ? blobKey(f.sha256) : null;
}

function mb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}
