import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { brotliDecompressSync } from "node:zlib";
import { blobKey, brotliKeyOf, manifestKey, ownedBlobKey, sha256Hex, type CompressJob, type Manifest, type UploadFile } from "@zaisma/core";
import { handleCompressBatch, queueCompression, queueMissingCompression } from "../../apps/site/src/compress.ts";
import type { Env } from "../../apps/site/src/env.ts";

/** A queue that keeps what it was sent, so tests can see it. */
function recordingEnv(): { testEnv: Env; sent: CompressJob[] } {
  const sent: CompressJob[] = [];
  const queue = { sendBatch: async (messages: { body: CompressJob }[]) => void sent.push(...messages.map((message) => message.body)), send: async (body: CompressJob) => void sent.push(body) };
  return { testEnv: { ...env, COMPRESS_QUEUE: queue as unknown as Queue<CompressJob> }, sent };
}

/** One message the way the queue hands it over, saying what the consumer did with it. */
function batchOf(job: CompressJob, attemptCount = 1) {
  const outcome = { isAcked: false, retryDelaySec: null as number | null };
  const message = { id: "m1", timestamp: new Date(), body: job, attempts: attemptCount, ack: () => void (outcome.isAcked = true), retry: (options?: { delaySeconds?: number }) => void (outcome.retryDelaySec = options?.delaySeconds ?? 0) };
  return { batch: { queue: "zaisma-compress", messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<CompressJob>, outcome };
}

/** Bytes that shrink with Brotli but not to nothing: random, with bitCount bits of chance in each. */
function shrinkableBytes(sizeBytes: number, bitCount = 4): Uint8Array {
  const out = randomBytes(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) out[i] = 97 + (out[i]! & ((1 << bitCount) - 1));
  return out;
}

function randomBytes(sizeBytes: number): Uint8Array {
  const out = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(sizeBytes, i + 65536)));
  return out;
}

async function storeBlob(content: Uint8Array): Promise<CompressJob> {
  const sha256 = await sha256Hex(content);
  await env.GAMES.put(blobKey(sha256), content);
  await env.DB.prepare("INSERT INTO blobs (sha256, size_bytes, created_at_ms) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(sha256, content.byteLength, Date.now()).run();
  return { storageKey: blobKey(sha256), sha256 };
}

const rowOf = (storageKey: string) => env.DB.prepare("SELECT brotli_size_bytes FROM compressed_blobs WHERE storage_key = ?").bind(storageKey).first<{ brotli_size_bytes: number | null }>();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM compressed_blobs; DELETE FROM blobs; DELETE FROM owned_blobs; DELETE FROM versions; DELETE FROM games;");
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((object) => object.key));
});

describe("Brotli copies of game files", () => {
  it("are made beside a file that shrinks, and match it", async () => {
    const content = shrinkableBytes(256 * 1024);
    const job = await storeBlob(content);
    const { batch, outcome } = batchOf(job);
    await handleCompressBatch(batch, env);
    expect(outcome.isAcked).toBe(true);
    const copy = await env.GAMES.get(brotliKeyOf(job.storageKey));
    expect(copy).not.toBeNull();
    const copied = new Uint8Array(await copy!.arrayBuffer());
    expect(copied.byteLength).toBeLessThan(content.byteLength * 0.9);
    expect(new Uint8Array(brotliDecompressSync(copied))).toEqual(content);
    expect((await rowOf(job.storageKey))?.brotli_size_bytes).toBe(copied.byteLength);
    // The original stays as it was uploaded.
    expect(new Uint8Array(await (await env.GAMES.get(job.storageKey))!.arrayBuffer())).toEqual(content);

    // A second message for the same file does nothing.
    await env.GAMES.delete(brotliKeyOf(job.storageKey));
    const again = batchOf(job);
    await handleCompressBatch(again.batch, env);
    expect(again.outcome.isAcked).toBe(true);
    expect(await env.GAMES.head(brotliKeyOf(job.storageKey))).toBeNull();
  });

  it("are written in parts when they're big", async () => {
    // Six bits of chance a byte shrinks to about three quarters: a copy of three parts.
    const content = shrinkableBytes(23 * 1024 * 1024, 6);
    const job = await storeBlob(content);
    const { batch, outcome } = batchOf(job);
    await handleCompressBatch(batch, env);
    expect(outcome.isAcked).toBe(true);
    const copy = new Uint8Array(await (await env.GAMES.get(brotliKeyOf(job.storageKey)))!.arrayBuffer());
    expect(copy.byteLength).toBeGreaterThan(16 * 1024 * 1024);
    expect(await sha256Hex(new Uint8Array(brotliDecompressSync(copy)))).toBe(job.sha256);
  }, 120_000);

  it("aren't kept when a file barely shrinks", async () => {
    const job = await storeBlob(randomBytes(256 * 1024));
    await handleCompressBatch(batchOf(job).batch, env);
    expect(await env.GAMES.head(brotliKeyOf(job.storageKey))).toBeNull();
    expect(await rowOf(job.storageKey)).toEqual({ brotli_size_bytes: null });
  });

  it("aren't kept when a file sent in parts isn't what its fingerprint says", async () => {
    const claimed = "ab".repeat(32);
    const storageKey = ownedBlobKey("owner_1", claimed);
    await env.GAMES.put(storageKey, shrinkableBytes(64 * 1024));
    const { batch, outcome } = batchOf({ storageKey, sha256: claimed });
    await handleCompressBatch(batch, env);
    expect(outcome.isAcked).toBe(true);
    expect(await env.GAMES.head(brotliKeyOf(storageKey))).toBeNull();
    expect(await rowOf(storageKey)).toEqual({ brotli_size_bytes: null });
  });

  it("are tried again later when compressing fails, then given up on", async () => {
    const { storageKey, sha256 } = await storeBlob(shrinkableBytes(4096));
    const failing = { ...env, GAMES: { ...env.GAMES, get: env.GAMES.get.bind(env.GAMES), put: async () => Promise.reject(new Error("storage down")), createMultipartUpload: env.GAMES.createMultipartUpload.bind(env.GAMES) } } as unknown as Env;
    const first = batchOf({ storageKey, sha256 }, 1);
    await handleCompressBatch(first.batch, failing);
    expect(first.outcome).toEqual({ isAcked: false, retryDelaySec: 30 });
    const last = batchOf({ storageKey, sha256 }, 3);
    await handleCompressBatch(last.batch, failing);
    expect(last.outcome.isAcked).toBe(true);
    expect(await rowOf(storageKey)).toEqual({ brotli_size_bytes: null });
  });

  it("are queued for a new version's files that could have one and weren't tried", async () => {
    const { testEnv, sent } = recordingEnv();
    const sha = (character: string) => character.repeat(64);
    const files: UploadFile[] = [
      { path: "index.html", sha256: sha("a"), size_bytes: 5000 },
      { path: "Build/game.data", sha256: sha("b"), size_bytes: 5_000_000 },
      { path: "Build/game.wasm", sha256: sha("c"), size_bytes: 9_000_000 },
      { path: "hero.png", sha256: sha("d"), size_bytes: 80_000 },
      { path: "tiny.js", sha256: sha("e"), size_bytes: 500 },
      { path: "levels.json", sha256: sha("f"), size_bytes: 20_000 },
    ];
    const manifest: Manifest = { files: Object.fromEntries(files.map((file) => [file.path, { sha256: file.sha256, ...(file.path === "Build/game.wasm" ? { owner_id: "owner_1" } : {}) }])) };
    await env.DB.prepare("INSERT INTO compressed_blobs (storage_key, brotli_size_bytes, compressed_at_ms) VALUES (?, 100, 0)").bind(blobKey(sha("f"))).run();
    expect(await queueCompression(testEnv, manifest, files)).toBe(2);
    expect(sent).toEqual([
      { storageKey: blobKey(sha("b")), sha256: sha("b") },
      { storageKey: ownedBlobKey("owner_1", sha("c")), sha256: sha("c") },
    ]);
  });

  it("are queued each day for live files never tried", async () => {
    const { testEnv, sent } = recordingEnv();
    const data = await storeBlob(shrinkableBytes(8000));
    const page = await storeBlob(new TextEncoder().encode("<!doctype html>".padEnd(4000, " ")));
    const tried = await storeBlob(shrinkableBytes(9000));
    await env.DB.prepare("INSERT INTO compressed_blobs (storage_key, brotli_size_bytes, compressed_at_ms) VALUES (?, NULL, 0)").bind(tried.storageKey).run();
    const manifest: Manifest = { files: { "index.html": { sha256: page.sha256 }, "game.data": { sha256: data.sha256 }, "old.data": { sha256: tried.sha256 } } };
    await env.GAMES.put(manifestKey("version_live"), JSON.stringify(manifest));
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, created_at_ms, updated_at_ms) VALUES ('game_one', 'one', 'One', 'live', 'version_live', 0, 0)").run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, created_at_ms) VALUES ('version_live', 'game_one', 'manifests/version_live', 3, 0, 'approved', 'files', 0)").run();
    expect(await queueMissingCompression(testEnv)).toBe(1);
    expect(sent).toEqual([data]);
  });
});
