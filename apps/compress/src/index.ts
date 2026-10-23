import { constants, createBrotliCompress } from "node:zlib";
import { BROTLI_LIMITS, brotliKeyOf, type CompressJob } from "@zaisma/core";

/**
 * The compress Worker: makes the Brotli copy of each game file the site queues on zaisma-compress
 * (docs/DECISIONS.md, "Game files reach players small and from nearby, exactly as uploaded"). It reads the
 * file from storage once, checks its fingerprint while compressing it, and keeps the copy beside it at
 * brotli/<storage key> when it's small enough. A Worker of its own: compressing keeps its isolate busy for
 * up to minutes, which zaisma.com's pages must never wait behind.
 */

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
}

/** Parts of a copy too big for one write: small, so little waits in memory. R2 wants every part but the last the same size, and at least 5 MB. */
const COPY_PART_SIZE_BYTES = 8 * 1024 * 1024;
/** How much is handed to the compressor at a time, with a pause after each so other work in the process gets a turn. */
const WRITE_SIZE_BYTES = 64 * 1024;
/**
 * At the best quality Brotli holds back what it's given and compresses it in one long step, over 7 seconds for an
 * 8 MB file, which no pause between writes breaks up. Flushing after each megabyte keeps every step to about a second,
 * with the same size of copy, so the preview's other Workers on the same thread keep answering.
 */
const FLUSH_SIZE_BYTES = 1024 * 1024;
/** Tries before a file is served as it is for good. */
const MAXIMUM_ATTEMPT_COUNT = 3;

async function hasCompressedRow(database: D1Database, storageKey: string): Promise<boolean> {
  return (await database.prepare("SELECT 1 AS is_found FROM compressed_blobs WHERE storage_key = ?").bind(storageKey).first()) !== null;
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
  let unflushedSizeBytes = 0;
  const isTooBig = () => copy.sizeBytes * 100 > object.size * BROTLI_LIMITS.maximumKeptSizePct;
  try {
    for (;;) {
      const { done: isDone, value: chunk } = await reader.read();
      if (isDone) break;
      await digestWriter.write(chunk);
      // The compressor runs on this thread: in small pieces, each followed by a pause, nothing else waits long.
      for (let offsetBytes = 0; offsetBytes < chunk.byteLength; offsetBytes += WRITE_SIZE_BYTES) {
        await new Promise<void>((resolve, reject) => brotli.write(chunk.subarray(offsetBytes, offsetBytes + WRITE_SIZE_BYTES), (error) => (error ? reject(error) : resolve())));
        await new Promise((resolve) => setTimeout(resolve, 0));
        unflushedSizeBytes += Math.min(WRITE_SIZE_BYTES, chunk.byteLength - offsetBytes);
        if (unflushedSizeBytes >= FLUSH_SIZE_BYTES) {
          await new Promise<void>((resolve) => brotli.flush(constants.BROTLI_OPERATION_FLUSH, () => resolve()));
          await new Promise((resolve) => setTimeout(resolve, 0));
          unflushedSizeBytes = 0;
        }
      }
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

/** The zaisma-compress queue's consumer, one file at a time: a big file takes about half a Worker's CPU limit. */
export async function handleCompressBatch(batch: MessageBatch<CompressJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const job = message.body;
    try {
      if (await hasCompressedRow(env.DB, job.storageKey)) {
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

export default {
  queue: handleCompressBatch,
} satisfies ExportedHandler<Env, CompressJob>;
