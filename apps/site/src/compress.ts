import { blobKey, blobSizes, isCompressible, isCompressibleType, manifestKey, ownedBlobKey, type CompressJob, type Manifest, type UploadFile } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Brotli copies of game files (docs/DECISIONS.md, "Game files reach players small and from nearby, exactly
 * as uploaded"). Each new stored file a version uses is queued once on zaisma-compress; the compress Worker
 * (apps/compress) makes the copy. The games Worker sends the copy to browsers that take Brotli. The original
 * stays exactly as uploaded: the scan, the export and range requests read it.
 */

/** Files the daily backfill queues at most. */
const BACKFILL_MAXIMUM_FILE_COUNT = 2000;

const storageKeyOf = (file: Manifest["files"][string]) => (file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : blobKey(file.sha256));

/** Which of these storage keys already have a compressed_blobs row (a copy, or the answer that none is kept). */
async function compressedKeys(database: D1Database, storageKeys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < storageKeys.length; i += 100) {
    const chunk = storageKeys.slice(i, i + 100);
    const { results } = await database.prepare(`SELECT storage_key FROM compressed_blobs WHERE storage_key IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<{ storage_key: string }>();
    for (const row of results) found.add(row.storage_key);
  }
  return found;
}

async function sendJobs(env: Env, jobs: CompressJob[]): Promise<void> {
  for (let i = 0; i < jobs.length; i += 100) await env.COMPRESS_QUEUE.sendBatch(jobs.slice(i, i + 100).map((job) => ({ body: job })));
}

/** Queue a Brotli copy of each file in a new version that could have one and hasn't been tried. Answers how many were queued. */
export async function queueCompression(env: Env, manifest: Manifest, files: UploadFile[]): Promise<number> {
  const jobs = new Map<string, CompressJob>();
  for (const file of files) {
    const stored = manifest.files[file.path];
    if (!stored || !isCompressible(file.path, file.size_bytes)) continue;
    const storageKey = storageKeyOf(stored);
    jobs.set(storageKey, { storageKey, sha256: stored.sha256 });
  }
  const done = await compressedKeys(env.DB, [...jobs.keys()]);
  const due = [...jobs.values()].filter((job) => !done.has(job.storageKey));
  await sendJobs(env, due);
  return due.length;
}

/**
 * Once a day: queue the files live versions use that were never tried, such as those uploaded before copies
 * were made. Answers how many were queued.
 */
export async function queueMissingCompression(env: Env): Promise<number> {
  const { results: versions } = await env.DB.prepare("SELECT versions.id FROM games JOIN versions ON versions.id = games.live_version_id WHERE versions.kind = 'files'").all<{ id: string }>();
  const jobs = new Map<string, CompressJob & { path: string }>();
  for (const version of versions) {
    const stored = await env.GAMES.get(manifestKey(version.id));
    if (!stored) continue;
    for (const [path, file] of Object.entries(((await stored.json()) as Manifest).files)) {
      if (isCompressibleType(path)) jobs.set(storageKeyOf(file), { storageKey: storageKeyOf(file), sha256: file.sha256, path });
    }
  }
  const done = await compressedKeys(env.DB, [...jobs.keys()]);
  const untried = [...jobs.values()].filter((job) => !done.has(job.storageKey));
  const sizes = await blobSizes(env.DB, untried.map((job) => job.sha256));
  const due = untried.filter((job) => isCompressible(job.path, sizes.get(job.sha256) ?? 0)).slice(0, BACKFILL_MAXIMUM_FILE_COUNT);
  await sendJobs(env, due.map(({ storageKey, sha256 }) => ({ storageKey, sha256 })));
  return due.length;
}
