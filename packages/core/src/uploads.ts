import { CONTENT_TYPES, extensionOf } from "./mime.ts";
import { UploadError, cleanPath } from "./zip.ts";
import { SERVER_DIR, SERVER_ENTRY, SERVER_FILE, type Version } from "./types.ts";

/**
 * File-by-file uploads. Each file is stored once, by its SHA-256, at blobs/<sha256> in the games
 * bucket, and shared by every version (and later every remix) that has it, so an update only
 * uploads what changed. A version is a manifest: path -> file, at manifests/<version id>.json.
 */

export const FILE_LIMITS = {
  gameBytes: 2 * 1024 * 1024 * 1024,
  fileBytes: 500 * 1024 * 1024,
  /** Requests through a Worker top out at 100 MB, so bigger files are sent in parts. */
  directBytes: 95 * 1024 * 1024,
  partBytes: 50 * 1024 * 1024,
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
  /** owner is set for big files sent in parts, which only that owner's versions can use. */
  files: Record<string, { sha256: string; bytes: number; owner?: string }>;
}

export const blobKey = (sha256: string) => `blobs/${sha256}`;
export const ownedBlobKey = (ownerId: string, sha256: string) => `owned/${ownerId}/${sha256}`;
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
    if (f.bytes! > FILE_LIMITS.fileBytes) throw new UploadError(`${path} is over ${mb(FILE_LIMITS.fileBytes)}. Split it into smaller files, or ask us if you need bigger ones.`);
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

/**
 * Where we already have each of these files: shared (checked by storage, any version can use it)
 * or owned (a big file this owner sent in parts). Files we don't have are left out.
 */
export async function locateBlobs(db: D1Database, shas: string[], ownerId?: string): Promise<Map<string, "shared" | "owned">> {
  const unique = [...new Set(shas)];
  const found = new Map<string, "shared" | "owned">();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const marks = chunk.map(() => "?").join(",");
    statements.push(db.prepare(`SELECT sha256, 'shared' AS kind FROM blobs WHERE sha256 IN (${marks})`).bind(...chunk));
    if (ownerId) statements.push(db.prepare(`SELECT sha256, 'owned' AS kind FROM owned_blobs WHERE owner_id = ? AND sha256 IN (${marks})`).bind(ownerId, ...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const res of await db.batch<{ sha256: string; kind: "shared" | "owned" }>(statements.slice(i, i + 50))) {
      for (const r of res.results) if (found.get(r.sha256) !== "shared") found.set(r.sha256, r.kind);
    }
  }
  return found;
}

/** Which of these files we don't have yet. */
export async function missingBlobs(db: D1Database, shas: string[], ownerId?: string): Promise<string[]> {
  const found = await locateBlobs(db, shas, ownerId);
  return [...new Set(shas)].filter((s) => !found.has(s));
}

export async function addOwnedBlob(db: D1Database, ownerId: string, sha256: string, bytes: number): Promise<void> {
  await db
    .prepare("INSERT INTO owned_blobs (owner_id, sha256, bytes, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, sha256) DO NOTHING")
    .bind(ownerId, sha256, bytes, Date.now())
    .run();
}

export async function addBlob(db: D1Database, sha256: string, bytes: number): Promise<void> {
  await db.prepare("INSERT INTO blobs (sha256, bytes, created_at) VALUES (?, ?, ?) ON CONFLICT (sha256) DO NOTHING").bind(sha256, bytes, Date.now()).run();
}

export function toManifest(files: UploadFile[], found: Map<string, "shared" | "owned">, ownerId: string): Manifest {
  const out: Manifest = { files: {} };
  for (const f of files) out.files[f.path] = { sha256: f.sha256, bytes: f.bytes, ...(found.get(f.sha256) === "owned" ? { owner: ownerId } : {}) };
  return out;
}

/** Where a version's file lives in the games bucket: under its prefix (zip uploads) or as a shared blob. */
export function fileKey(version: Pick<Version, "kind" | "r2_prefix">, manifest: Manifest | null, path: string): string | null {
  if (version.kind !== "files") return `${version.r2_prefix}/${path}`;
  const f = manifest?.files[path];
  return f ? (f.owner ? ownedBlobKey(f.owner, f.sha256) : blobKey(f.sha256)) : null;
}

function mb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** What a game server may add up to: its files, and their size together. */
export const SERVER_LIMITS = { files: 500, bytes: 5 * 1024 * 1024 };
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
): Promise<{ entry: string; files: { path: string; key: string; bytes: number }[] } | { error: string } | null> {
  let found: { path: string; key: string; bytes: number }[] = [];
  if (version.kind === "files") {
    for (const [path, f] of Object.entries(manifest?.files ?? {})) {
      if ((path.startsWith(SERVER_DIR) && SERVER_MODULE.test(path)) || path === SERVER_FILE) found.push({ path, key: fileKey(version, manifest, path)!, bytes: f.bytes });
    }
  } else {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: `${version.r2_prefix}/${SERVER_DIR}`, cursor });
      for (const o of page.objects) if (SERVER_MODULE.test(o.key)) found.push({ path: o.key.slice(version.r2_prefix.length + 1), key: o.key, bytes: o.size });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && found.length <= SERVER_LIMITS.files);
    const single = await bucket.head(`${version.r2_prefix}/${SERVER_FILE}`);
    if (single) found.push({ path: SERVER_FILE, key: single.key, bytes: single.size });
  }
  const folder = found.some((f) => f.path === SERVER_ENTRY);
  found = folder ? found.filter((f) => f.path !== SERVER_FILE) : found.filter((f) => f.path === SERVER_FILE);
  if (!found.length) return null;
  if (found.length > SERVER_LIMITS.files) return { error: `A game server can have up to ${SERVER_LIMITS.files} files.` };
  if (found.reduce((n, f) => n + f.bytes, 0) > SERVER_LIMITS.bytes) return { error: `A game server can be up to ${SERVER_LIMITS.bytes / 1024 / 1024} MB.` };
  return { entry: folder ? SERVER_ENTRY : SERVER_FILE, files: found };
}
