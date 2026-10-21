import { constants, createBrotliCompress } from "node:zlib";
import { BROTLI_LIMITS, blobKey, blobSizes, brotliKeyOf, isCompressible, isCompressibleType, manifestKey, ownedBlobKey, type CompressJob, type Manifest, type UploadFile } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Brotli copies of game files (docs/DECISIONS.md, "Game files reach players small and from nearby, exactly
 * as uploaded"). Each new stored file a version uses is queued once; the queue's consumer reads it from
 * storage, checks its fingerprint while compressing it, and keeps the copy beside it at brotli/<storage key>
 * when it's small enough. The games Worker sends the copy to browsers that take Brotli. The original stays
 * exactly as uploaded: the scan, the export and range requests read it.
 */

/** Parts of a copy too big for one write: small, so little waits in memory. R2 wants every part but the last the same size, and at least 5 MB. */
const COPY_PART_SIZE_BYTES = 8 * 1024 * 1024;
/** Tries before a file is served as it is for good. */
const MAXIMUM_ATTEMPT_COUNT = 3;
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

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Where a copy is being written: it fills one 8 MB buffer, used again for each part, and whole parts go to an
 * R2 multipart upload as they're made, so a 500 MB file never sits in memory; the last part waits until the
 * file is checked, then is written or dropped.
 */
class CopyWriter {
  private part: Uint8Array;
  private partSizeBytes = 0;
  private upload: R2MultipartUpload | null = null;
  private parts: R2UploadedPart[] = [];
  sizeBytes = 0;

  /** originalSizeBytes sizes the buffer: a small file's copy never needs 8 MB. */
  constructor(
    private bucket: R2Bucket,
    private key: string,
    originalSizeBytes: number,
  ) {
    this.part = new Uint8Array(Math.min(COPY_PART_SIZE_BYTES, originalSizeBytes + 1024));
  }

  async add(chunk: Uint8Array): Promise<void> {
    this.sizeBytes += chunk.byteLength;
    for (let offsetBytes = 0; offsetBytes < chunk.byteLength; ) {
      if (this.partSizeBytes === this.part.byteLength) {
        // A copy bigger than its file: it won't be kept, but it's finished to check the fingerprint.
        const bigger = new Uint8Array(COPY_PART_SIZE_BYTES);
        bigger.set(this.part);
        this.part = bigger;
      }
      const takenBytes = Math.min(chunk.byteLength - offsetBytes, this.part.byteLength - this.partSizeBytes);
      this.part.set(chunk.subarray(offsetBytes, offsetBytes + takenBytes), this.partSizeBytes);
      this.partSizeBytes += takenBytes;
      offsetBytes += takenBytes;
      if (this.partSizeBytes === COPY_PART_SIZE_BYTES) {
        this.upload ??= await this.bucket.createMultipartUpload(this.key);
        this.parts.push(await this.upload.uploadPart(this.parts.length + 1, this.part));
        this.partSizeBytes = 0;
      }
    }
  }

  async keep(): Promise<void> {
    const rest = this.part.subarray(0, this.partSizeBytes);
    if (!this.upload) {
      await this.bucket.put(this.key, rest);
      return;
    }
    if (rest.byteLength) this.parts.push(await this.upload.uploadPart(this.parts.length + 1, rest));
    await this.upload.complete(this.parts);
  }

  async drop(): Promise<void> {
    await this.upload?.abort().catch(() => {});
  }
}

/**
 * Compress one stored file. Answers the copy's size, or null when no copy is kept: the file is gone, it
 * didn't shrink enough, or it isn't what its fingerprint says (only possible for a file sent in parts, which
 * storage couldn't check).
 */
export async function compressBlob(env: Env, job: CompressJob): Promise<{ brotliSizeBytes: number | null } | "gone"> {
  const object = await env.GAMES.get(job.storageKey);
  if (!object) return "gone";
  const qualityNumber = object.size <= BROTLI_LIMITS.bestQualityMaximumFileSizeBytes ? BROTLI_LIMITS.bestQuality : BROTLI_LIMITS.largeFileQuality;
  const brotli = createBrotliCompress({
    params: { [constants.BROTLI_PARAM_QUALITY]: qualityNumber, [constants.BROTLI_PARAM_LGWIN]: BROTLI_LIMITS.windowBits, [constants.BROTLI_PARAM_SIZE_HINT]: object.size },
  });
  const copy = new CopyWriter(env.GAMES, brotliKeyOf(job.storageKey), object.size);
  // The copy is written while the file is read, so neither waits for the other to finish.
  const written = (async () => {
    for await (const chunk of brotli) await copy.add(chunk as Uint8Array);
  })();
  // Read once, into both the fingerprint and the compressor: a tee would hold the whole file for the slower one.
  const digest = new crypto.DigestStream("SHA-256");
  const digestWriter = digest.getWriter();
  const reader = object.body.getReader();
  const isTooBig = () => copy.sizeBytes * 100 > object.size * BROTLI_LIMITS.maximumKeptSizePct;
  try {
    for (;;) {
      const { done: isDone, value: chunk } = await reader.read();
      if (isDone) break;
      await digestWriter.write(chunk);
      if (!brotli.write(chunk)) await new Promise<void>((resolve, reject) => brotli.once("drain", resolve).once("error", reject));
      // Already too big to keep: the rest isn't read.
      if (isTooBig()) {
        await reader.cancel();
        brotli.destroy();
        await written.catch(() => {});
        await copy.drop();
        return { brotliSizeBytes: null };
      }
    }
    brotli.end();
    await digestWriter.close();
    await written;
  } catch (error) {
    brotli.destroy();
    await written.catch(() => {});
    await copy.drop();
    throw error;
  }
  if (hex(await digest.digest) !== job.sha256) {
    await copy.drop();
    console.error("compress: a stored file isn't what its fingerprint says", job.storageKey);
    return { brotliSizeBytes: null };
  }
  if (isTooBig()) {
    await copy.drop();
    return { brotliSizeBytes: null };
  }
  await copy.keep();
  return { brotliSizeBytes: copy.sizeBytes };
}

async function noteCompressed(env: Env, storageKey: string, brotliSizeBytes: number | null): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO compressed_blobs (storage_key, brotli_size_bytes, compressed_at_ms) VALUES (?, ?, ?)").bind(storageKey, brotliSizeBytes, Date.now()).run();
}

/** The zaisma-compress queue's consumer, one file at a time: a big file takes most of a Worker's CPU limit. */
export async function handleCompressBatch(batch: MessageBatch<CompressJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;
    try {
      if ((await compressedKeys(env.DB, [job.storageKey])).size) {
        message.ack();
        continue;
      }
      const compressed = await compressBlob(env, job);
      if (compressed !== "gone") await noteCompressed(env, job.storageKey, compressed.brotliSizeBytes);
      message.ack();
    } catch (error) {
      console.error("compress failed", job.storageKey, error);
      // A file that can't be compressed is served as it is, and never tried again.
      if (message.attempts >= MAXIMUM_ATTEMPT_COUNT) {
        await noteCompressed(env, job.storageKey, null);
        message.ack();
      } else message.retry({ delaySeconds: 30 * message.attempts });
    }
  }
}
