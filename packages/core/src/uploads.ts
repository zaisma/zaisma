import { CONTENT_TYPES, extensionOf } from "./mime.ts";
import { UploadError, cleanPath } from "./zip.ts";
import { SERVER_DIR, SERVER_ENTRY, SERVER_FILE, type Version } from "./types.ts";

/**
 * File-by-file uploads. Each file is stored once, by its SHA-256, at blobs/<sha256> in the games
 * bucket, and shared by every version (and later every remix) that has it, so an update only
 * uploads what changed. A version is a manifest: path -> file, at manifests/<version id>.json.
 */

export const FILE_LIMITS = {
  maximumGameSizeBytes: 2 * 1024 * 1024 * 1024,
  maximumFileSizeBytes: 500 * 1024 * 1024,
  /** Requests through a Worker top out at 100 MB, so bigger files are sent in parts. */
  maximumDirectSizeBytes: 95 * 1024 * 1024,
  partSizeBytes: 50 * 1024 * 1024,
  maximumFileCount: 20_000,
  maximumVersionsPerDay: 20,
  maximumPatchNotesCharacterCount: 2000,
};

/** Approved versions kept besides the live one, for rolling back. */
export const KEPT_VERSION_COUNT = 5;

/** One file in a version's file list, as the developer API takes it. */
export interface UploadFile {
  path: string;
  sha256: string;
  size_bytes: number;
}

/** A version's files, stored as JSON. owner is set for big files sent in parts, which only that owner's versions can use. */
export interface Manifest {
  files: Record<string, { sha256: string; owner?: string }>;
}

export const blobKey = (sha256: string) => `blobs/${sha256}`;
export const ownedBlobKey = (ownerId: string, sha256: string) => `owned/${ownerId}/${sha256}`;
export const manifestKey = (versionId: string) => `manifests/${versionId}.json`;
export const SHA256 = /^[0-9a-f]{64}$/;

/** Check a version's file list against the same rules as zips, with the bigger limits. Throws UploadError. */
export function checkUploadList(input: unknown): UploadFile[] {
  if (!Array.isArray(input) || input.length === 0) throw new UploadError("Send the game's files as a list of { path, sha256, size_bytes }.");
  if (input.length > FILE_LIMITS.maximumFileCount) throw new UploadError(`The game has ${input.length} files; the limit is ${FILE_LIMITS.maximumFileCount.toLocaleString("en-US")}.`);
  const seen = new Set<string>();
  let totalSizeBytes = 0;
  const files: UploadFile[] = [];
  for (const givenFile of input) {
    const file = givenFile as Partial<UploadFile> | null;
    if (typeof file?.path !== "string" || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.size_bytes) || file.size_bytes! < 0) {
      throw new UploadError("Each file needs a path, its sha256 in lowercase hex and its size_bytes.");
    }
    const path = cleanPath(file.path);
    if (path.split("/").some((part) => part.startsWith("."))) throw new UploadError(`Hidden files aren't allowed: ${path}`);
    const extension = extensionOf(path);
    if (extension === "gz" || extension === "br") {
      throw new UploadError(`${path} is pre-compressed. Turn off compression in your engine's build settings; Zaisma compresses files for you.`);
    }
    if (!(extension in CONTENT_TYPES)) throw new UploadError(`${path}: .${extension || "(no extension)"} files aren't allowed in games.`);
    if (file.size_bytes! > FILE_LIMITS.maximumFileSizeBytes) throw new UploadError(`${path} is over ${megabytes(FILE_LIMITS.maximumFileSizeBytes)}. Split it into smaller files, or ask us if you need bigger ones.`);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new UploadError(`Two files share the path ${path}.`);
    seen.add(key);
    totalSizeBytes += file.size_bytes!;
    files.push({ path, sha256: file.sha256, size_bytes: file.size_bytes! });
  }
  if (!seen.has("index.html")) throw new UploadError("The game needs an index.html at the top level.");
  if (totalSizeBytes > FILE_LIMITS.maximumGameSizeBytes) throw new UploadError(`The game is ${megabytes(totalSizeBytes)}; the limit is ${megabytes(FILE_LIMITS.maximumGameSizeBytes)}. Ask us if you need more.`);
  return files;
}

/**
 * Where we already have each of these files: shared (checked by storage, any version can use it)
 * or owned (a big file this owner sent in parts). Files we don't have are left out.
 */
export async function locateBlobs(db: D1Database, hashes: string[], ownerId?: string): Promise<Map<string, "shared" | "owned">> {
  const unique = [...new Set(hashes)];
  const found = new Map<string, "shared" | "owned">();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(db.prepare(`SELECT sha256, 'shared' AS kind FROM blobs WHERE sha256 IN (${placeholders})`).bind(...chunk));
    if (ownerId) statements.push(db.prepare(`SELECT sha256, 'owned' AS kind FROM owned_blobs WHERE owner_id = ? AND sha256 IN (${placeholders})`).bind(ownerId, ...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const batch of await db.batch<{ sha256: string; kind: "shared" | "owned" }>(statements.slice(i, i + 50))) {
      for (const row of batch.results) if (found.get(row.sha256) !== "shared") found.set(row.sha256, row.kind);
    }
  }
  return found;
}

/** Which of these files we don't have yet. */
export async function missingBlobs(db: D1Database, hashes: string[], ownerId?: string): Promise<string[]> {
  const found = await locateBlobs(db, hashes, ownerId);
  return [...new Set(hashes)].filter((hash) => !found.has(hash));
}

export async function addOwnedBlob(db: D1Database, ownerId: string, sha256: string, sizeBytes: number): Promise<void> {
  await db
    .prepare("INSERT INTO owned_blobs (owner_id, sha256, size_bytes, created_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, sha256) DO NOTHING")
    .bind(ownerId, sha256, sizeBytes, Date.now())
    .run();
}

export async function addBlob(db: D1Database, sha256: string, sizeBytes: number): Promise<void> {
  await db.prepare("INSERT INTO blobs (sha256, size_bytes, created_at_ms) VALUES (?, ?, ?) ON CONFLICT (sha256) DO NOTHING").bind(sha256, sizeBytes, Date.now()).run();
}

/** Each stored file's size by its hash, from the blobs tables: the one record of every stored file's size. */
export async function blobSizes(db: D1Database, hashes: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(hashes)];
  const sizes = new Map<string, number>();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 45) {
    const chunk = unique.slice(i, i + 45);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(db.prepare(`SELECT sha256, size_bytes FROM blobs WHERE sha256 IN (${placeholders}) UNION ALL SELECT sha256, size_bytes FROM owned_blobs WHERE sha256 IN (${placeholders})`).bind(...chunk, ...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const batch of await db.batch<{ sha256: string; size_bytes: number }>(statements.slice(i, i + 50))) {
      for (const row of batch.results) sizes.set(row.sha256, row.size_bytes);
    }
  }
  return sizes;
}

export function toManifest(files: UploadFile[], found: Map<string, "shared" | "owned">, ownerId: string): Manifest {
  const manifest: Manifest = { files: {} };
  for (const file of files) manifest.files[file.path] = { sha256: file.sha256, ...(found.get(file.sha256) === "owned" ? { owner: ownerId } : {}) };
  return manifest;
}

/** Where a version's file lives in the games bucket: under its prefix (zip uploads) or as a shared blob. */
export function fileKey(version: Pick<Version, "kind" | "r2_prefix">, manifest: Manifest | null, path: string): string | null {
  if (version.kind !== "files") return `${version.r2_prefix}/${path}`;
  const file = manifest?.files[path];
  return file ? (file.owner ? ownedBlobKey(file.owner, file.sha256) : blobKey(file.sha256)) : null;
}

function megabytes(sizeBytes: number): string {
  return sizeBytes >= 1024 ** 3 ? `${(sizeBytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(sizeBytes / 1024 / 1024)} MB`;
}

/** What a game server may add up to: its files, and their size together. */
export const SERVER_LIMITS = { maximumFileCount: 500, maximumSizeBytes: 5 * 1024 * 1024 };
/** Files in a zaisma-server/ folder the game server can import: code, data (like levels) and WebAssembly (like a physics engine). */
export const SERVER_MODULE = /\.(js|json|wasm)$/;

/**
 * A version's own game server: the zaisma-server/ folder's .js, .json and .wasm files, or else the
 * one zaisma-server.js. Null when it has neither; an error when it's over SERVER_LIMITS.
 */
export async function serverModules(
  bucket: R2Bucket,
  version: Pick<Version, "kind" | "r2_prefix">,
  manifest: Manifest | null,
): Promise<{ entry: string; files: { path: string; key: string; sizeBytes: number }[] } | { error: string } | null> {
  let found: { path: string; key: string; sizeBytes: number | null }[] = [];
  if (version.kind === "files") {
    // Sizes come from storage once the files are chosen: a manifest lists only where each file is.
    for (const path of Object.keys(manifest?.files ?? {})) {
      if ((path.startsWith(SERVER_DIR) && SERVER_MODULE.test(path)) || path === SERVER_FILE) found.push({ path, key: fileKey(version, manifest, path)!, sizeBytes: null });
    }
  } else {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: `${version.r2_prefix}/${SERVER_DIR}`, cursor });
      for (const object of page.objects) if (SERVER_MODULE.test(object.key)) found.push({ path: object.key.slice(version.r2_prefix.length + 1), key: object.key, sizeBytes: object.size });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && found.length <= SERVER_LIMITS.maximumFileCount);
    const single = await bucket.head(`${version.r2_prefix}/${SERVER_FILE}`);
    if (single) found.push({ path: SERVER_FILE, key: single.key, sizeBytes: single.size });
  }
  const hasFolder = found.some((file) => file.path === SERVER_ENTRY);
  found = hasFolder ? found.filter((file) => file.path !== SERVER_FILE) : found.filter((file) => file.path === SERVER_FILE);
  if (!found.length) return null;
  if (found.length > SERVER_LIMITS.maximumFileCount) return { error: `A game server can have up to ${SERVER_LIMITS.maximumFileCount} files.` };
  const files = await Promise.all(found.map(async (file) => ({ ...file, sizeBytes: file.sizeBytes ?? (await bucket.head(file.key))?.size ?? 0 })));
  if (files.reduce((totalSizeBytes, file) => totalSizeBytes + file.sizeBytes, 0) > SERVER_LIMITS.maximumSizeBytes) return { error: `A game server can be up to ${SERVER_LIMITS.maximumSizeBytes / 1024 / 1024} MB.` };
  return { entry: hasFolder ? SERVER_ENTRY : SERVER_FILE, files };
}
