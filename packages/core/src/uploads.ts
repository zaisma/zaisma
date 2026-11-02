import { CONTENT_TYPES, extensionOf } from "./mime.ts";
import { UploadError, cleanPath } from "./zip.ts";
import { PLAN_LIMITS, withProSize, type PlanKind } from "./plans.ts";
import { SERVER_FOLDER, SERVER_ENTRY, SERVER_FILE, isServerPath, type Version } from "./types.ts";

/**
 * File-by-file uploads. Each file is stored once, by its SHA-256, at blobs/<sha256> in the games
 * bucket, and shared by every version (and later every remix) that has it, so an update only
 * uploads what changed. A version is a manifest: path -> file, at manifests/<version id>.json.
 */

export const FILE_LIMITS = {
  maximumFileSizeBytes: 500 * 1024 * 1024,
  /** Requests through a Worker top out at 100 MB, so bigger files are sent in parts. */
  maximumDirectSizeBytes: 95 * 1024 * 1024,
  partSizeBytes: 50 * 1024 * 1024,
  maximumFileCount: 20_000,
  maximumPatchNotesCharacterCount: 2000,
};

/**
 * When an upload counts as a re-upload of another developer's game (docs/DECISIONS.md, "Copies never pay;
 * history does"): at least minimumMatchedFilePct of its distinct files were sent first by one other developer,
 * leaving out files commonFileOwnerCount or more developers have sent (engines, libraries, asset packs).
 * Counted by files, not bytes: a shared engine or library outweighs a small game's own files.
 */
export const COPY_LIMITS = {
  commonFileOwnerCount: 3,
  minimumMatchedFilePct: 80,
  /** The other developer's versions read to find which of their games it is. */
  maximumComparedManifestCount: 20,
};

/** How long a file the scan cleared (checked_files) is trusted before it's matched again: hash lists grow. */
export const CHECKED_FILE_KEPT_DURATION_DAYS = 30;

/**
 * How long VirusTotal's answer about a file (antivirus_lookups) is reused before it's looked up again, so
 * rescans stay inside its free limit of 4 lookups a minute: a count for a week, since verdicts change slowly,
 * and "doesn't know the file" for a day, since a new file can become known fast.
 */
export const ANTIVIRUS_ANSWER_KEPT_DURATION_DAYS = 7;
export const ANTIVIRUS_UNKNOWN_FILE_KEPT_DURATION_DAYS = 1;

/** Approved versions kept besides the live one, for rolling back. */
export const KEPT_VERSION_COUNT = 5;

/** One file in a version's file list, as the developer API takes it. */
export interface UploadFile {
  path: string;
  sha256: string;
  size_bytes: number;
}

/** A version's files, stored as JSON. owner_id is set for big files sent in parts, which only that owner's versions can use. */
export interface Manifest {
  files: Record<string, { sha256: string; owner_id?: string }>;
}

export const blobKey = (sha256: string) => `blobs/${sha256}`;
export const ownedBlobKey = (ownerId: string, sha256: string) => `owned/${ownerId}/${sha256}`;
export const manifestKey = (versionId: string) => `manifests/${versionId}.json`;
export const SHA256 = /^[0-9a-f]{64}$/;

const PATH_FIX = "Give paths relative to the game's folder, like index.html or assets/hero.png: no leading /, no . or .. parts, up to 200 characters.";

/** Check a version's file list against the same rules as zips, with the bigger limits, and the game size of the developer's plan. Throws UploadError with its code, field and fix. */
export function checkUploadList(input: unknown, plan: PlanKind = "free"): UploadFile[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new UploadError("files isn't a list of files.", { code: "bad_files", field: "files", fix: 'Send the game\'s files as a list of { "path", "sha256", "size_bytes" }, with index.html among them.' });
  }
  if (input.length > FILE_LIMITS.maximumFileCount) {
    throw new UploadError(`The game has ${input.length} files; the limit is ${FILE_LIMITS.maximumFileCount.toLocaleString("en-US")}.`, {
      code: "too_many_files",
      field: "files",
      fix: "Leave out files the game doesn't load, or pack small ones together (like sprites into an atlas).",
    });
  }
  const seen = new Set<string>();
  let totalSizeBytes = 0;
  const files: UploadFile[] = [];
  for (const [i, givenFile] of input.entries()) {
    const file = givenFile as Partial<UploadFile> | null;
    if (typeof file?.path !== "string" || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.size_bytes) || file.size_bytes! < 0) {
      throw new UploadError(`files[${i}] isn't { "path", "sha256", "size_bytes" }.`, { code: "bad_files", field: `files[${i}]`, fix: "Give each file its path, its SHA-256 in lowercase hex and its size_bytes." });
    }
    const field = `files[${i}].path`;
    let path: string;
    try {
      path = cleanPath(file.path);
    } catch (error) {
      if (error instanceof UploadError) throw new UploadError(`${JSON.stringify(file.path.slice(0, 80))} isn't a path a game can have.`, { code: "bad_path", field, fix: PATH_FIX });
      throw error;
    }
    if (path.split("/").some((part) => part.startsWith("."))) throw new UploadError(`${path} is hidden: a name in it starts with a dot.`, { code: "hidden_file", field, fix: "Leave hidden files and folders out of the upload." });
    const extension = extensionOf(path);
    if (extension === "gz" || extension === "br") {
      throw new UploadError(`${path} is pre-compressed.`, { code: "precompressed_file", field, fix: "Turn off compression in your engine's build settings and upload again; Zaisma compresses files for players itself, even Unity and Godot data files." });
    }
    if (!(extension in CONTENT_TYPES)) {
      throw new UploadError(`${path}: .${extension || "(no extension)"} files aren't allowed in games.`, { code: "file_type_not_allowed", field, fix: `Leave it out. Games can have: ${Object.keys(CONTENT_TYPES).join(", ")}.` });
    }
    if (file.size_bytes! > FILE_LIMITS.maximumFileSizeBytes) {
      throw new UploadError(`${path} is over ${megabytes(FILE_LIMITS.maximumFileSizeBytes)}.`, {
        code: "file_too_big",
        field: `files[${i}].size_bytes`,
        fix: "Split it into smaller files, or ask Zaisma (message_zaisma, kind gap) if the game needs bigger ones.",
      });
    }
    const key = path.toLowerCase();
    if (seen.has(key)) throw new UploadError(`Two files share the path ${path} (paths don't depend on case).`, { code: "duplicate_path", field, fix: "Give each file its own path." });
    seen.add(key);
    totalSizeBytes += file.size_bytes!;
    files.push({ path, sha256: file.sha256, size_bytes: file.size_bytes! });
  }
  if (!seen.has("index.html")) {
    throw new UploadError("There's no index.html at the top of the game.", {
      code: "no_index_html",
      field: "files",
      fix: "Send the game's start page with the path index.html, not game/index.html: paths are relative to the folder players get.",
    });
  }
  if (totalSizeBytes > PLAN_LIMITS[plan].maximumGameSizeBytes) {
    throw new UploadError(`The game is ${megabytes(totalSizeBytes)}; the limit is ${withProSize(plan)}.`, {
      code: "game_too_big",
      field: "files",
      fix: "Leave out files the game doesn't load, or ask Zaisma (message_zaisma, kind gap) for more.",
    });
  }
  return files;
}

/**
 * Which of these files this owner may use, and where they are: shared (one copy, checked by storage,
 * that this owner sent themselves) or owned (a big file this owner sent in parts). Files this owner
 * hasn't sent are left out, even when another owner has: naming someone else's file by its SHA-256
 * neither gets it nor says whether Zaisma has it.
 */
export async function locateBlobs(database: D1Database, hashes: string[], ownerId: string): Promise<Map<string, "shared" | "owned">> {
  const unique = [...new Set(hashes)];
  const found = new Map<string, "shared" | "owned">();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(database.prepare(`SELECT blobs.sha256, 'shared' AS kind FROM blob_owners JOIN blobs ON blobs.sha256 = blob_owners.sha256 WHERE blob_owners.owner_id = ? AND blob_owners.sha256 IN (${placeholders})`).bind(ownerId, ...chunk));
    statements.push(database.prepare(`SELECT sha256, 'owned' AS kind FROM owned_blobs WHERE owner_id = ? AND sha256 IN (${placeholders})`).bind(ownerId, ...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const batch of await database.batch<{ sha256: string; kind: "shared" | "owned" }>(statements.slice(i, i + 50))) {
      for (const row of batch.results) if (found.get(row.sha256) !== "shared") found.set(row.sha256, row.kind);
    }
  }
  return found;
}

/** Which of these files this owner hasn't sent yet. */
export async function missingBlobs(database: D1Database, hashes: string[], ownerId: string): Promise<string[]> {
  const found = await locateBlobs(database, hashes, ownerId);
  return [...new Set(hashes)].filter((hash) => !found.has(hash));
}

export async function addOwnedBlob(database: D1Database, ownerId: string, sha256: string, sizeBytes: number): Promise<void> {
  await database
    .prepare("INSERT INTO owned_blobs (owner_id, sha256, size_bytes, created_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, sha256) DO NOTHING")
    .bind(ownerId, sha256, sizeBytes, Date.now())
    .run();
}

/** A shared file this owner sent: stored once, and theirs to use from now on. */
export async function addBlob(database: D1Database, ownerId: string, sha256: string, sizeBytes: number): Promise<void> {
  const nowMs = Date.now();
  await database.batch([
    database.prepare("INSERT INTO blobs (sha256, size_bytes, created_at_ms) VALUES (?, ?, ?) ON CONFLICT (sha256) DO NOTHING").bind(sha256, sizeBytes, nowMs),
    database.prepare("INSERT INTO blob_owners (owner_id, sha256, created_at_ms) VALUES (?, ?, ?) ON CONFLICT (owner_id, sha256) DO NOTHING").bind(ownerId, sha256, nowMs),
  ]);
}

/** Each stored file's size by its hash, from the blobs tables: the one record of every stored file's size. */
export async function blobSizes(database: D1Database, hashes: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(hashes)];
  const sizes = new Map<string, number>();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < unique.length; i += 45) {
    const chunk = unique.slice(i, i + 45);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(database.prepare(`SELECT sha256, size_bytes FROM blobs WHERE sha256 IN (${placeholders}) UNION ALL SELECT sha256, size_bytes FROM owned_blobs WHERE sha256 IN (${placeholders})`).bind(...chunk, ...chunk));
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const batch of await database.batch<{ sha256: string; size_bytes: number }>(statements.slice(i, i + 50))) {
      for (const row of batch.results) sizes.set(row.sha256, row.size_bytes);
    }
  }
  return sizes;
}

export function toManifest(files: UploadFile[], found: Map<string, "shared" | "owned">, ownerId: string): Manifest {
  const manifest: Manifest = { files: {} };
  for (const file of files) manifest.files[file.path] = { sha256: file.sha256, ...(found.get(file.sha256) === "owned" ? { owner_id: ownerId } : {}) };
  return manifest;
}

/**
 * Returning players skip file checks: a version's files also have an address of their own,
 * <base>_zaisma/versions/<version_id>/<path>, and its pages are served there, so the files they name by a
 * relative path never change at their address and the browser keeps them for good. Pages are still checked on
 * every load, so a takedown or a new version applies at once.
 */
const VERSION_ADDRESS_PATTERN = /^_zaisma\/versions\/([^/]+)\/(.*)$/s;

/** The version and the path inside it, when a path inside a game is under a version's own address. */
export function readVersionAddress(path: string): { versionId: string; path: string } | null {
  const match = VERSION_ADDRESS_PATTERN.exec(path);
  return match ? { versionId: match[1]!, path: match[2]! } : null;
}

/**
 * A file an update didn't change is already in a returning player's browser: a file at its version's own address
 * redirects, for good, to <base>_zaisma/content/<sha256>/<path>, the same address in every version that has it, so
 * only what changed downloads. The address serves a file only to whoever may open a version of this game that has
 * it at that path; the path stays in it for the file's type and for loaders that read a response's own address.
 */
const CONTENT_ADDRESS_PATTERN = /^_zaisma\/content\/([0-9a-f]{64})\/(.+)$/s;

/** The fingerprint and the path inside the game, when a path inside a game is under a file's content address. */
export function readContentAddress(path: string): { sha256: string; path: string } | null {
  const match = CONTENT_ADDRESS_PATTERN.exec(path);
  return match ? { sha256: match[1]!, path: match[2]! } : null;
}

/**
 * Files a browser reads from wherever they ended up: pages, scripts (a module's imports, and one module has to keep
 * one address), workers, stylesheets, playlists and the like resolve the relative paths inside them against their
 * own final address, so moved to one shared across versions they'd load another version's files. They stay at their
 * version's address.
 */
const FILES_READ_FROM_THEIR_ADDRESS = new Set(["html", "htm", "xhtml", "js", "mjs", "cjs", "css", "svg", "xml", "xsl", "webmanifest", "m3u8", "mpd"]);

/** Whether a path in a version redirects to a content address: a file of the game's own that names no other files by where it is. */
export function hasContentAddress(path: string): boolean {
  if (path.startsWith("_zaisma/") || isServerPath(path)) return false;
  return !FILES_READ_FROM_THEIR_ADDRESS.has(extensionOf(path));
}

/** Where a version's file lives in the games bucket: under its prefix (zip uploads) or as a shared blob. */
export function fileKey(version: Pick<Version, "kind" | "r2_prefix">, manifest: Manifest | null, path: string): string | null {
  if (version.kind !== "files") return `${version.r2_prefix}/${path}`;
  const file = manifest?.files[path];
  return file ? (file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : blobKey(file.sha256)) : null;
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
      if ((path.startsWith(SERVER_FOLDER) && SERVER_MODULE.test(path)) || path === SERVER_FILE) found.push({ path, key: fileKey(version, manifest, path)!, sizeBytes: null });
    }
  } else {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: `${version.r2_prefix}/${SERVER_FOLDER}`, cursor });
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
