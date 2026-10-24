import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey } from "@zaisma/core";
import { BACKUP_LIMITS, backupPart, handleBackupMessage, isRefreshDue, mainDatabaseDump, startBackupRun, type BackupPart } from "../../apps/site/src/backups.ts";
import { BACKUP_STORAGE_LIMITS } from "../../apps/site/src/backup-storage.ts";
import type { Env } from "../../apps/site/src/env.ts";
import { letPublish } from "../helpers.ts";

// The nightly copy to Backblaze (apps/site/src/backups.ts), against a stand-in for its S3 API that keeps
// every version written and checks each request is signed and carries the Content-MD5 Object Lock needs.

const SITE = "https://zaisma.test";
const DAY_MS = 24 * 60 * 60 * 1000;
const realFetch = globalThis.fetch;

interface StoredVersion {
  bytes: Uint8Array;
  atMs: number;
}
let versions: Map<string, StoredVersion[]>;
let uploads: Map<string, Uint8Array[]>;
let requests: { method: string; key: string; query: URLSearchParams; headers: Headers }[];
/** Requests the stand-in answers 500 for, by key, to test a failing night. */
let failingKeys: Set<string>;

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
const base64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const newest = (key: string) => versions.get(key)?.at(-1);

async function backblaze(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const [, bucketName, ...keyParts] = url.pathname.split("/");
  const key = keyParts.map(decodeURIComponent).join("/");
  requests.push({ method: request.method, key, query: url.searchParams, headers: request.headers });
  expect(bucketName).toBe("zaisma-backups");
  expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-backup-key-id\/\d{8}\/us-east-005\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
  if (failingKeys.has(key)) return new Response("<Error><Code>InternalError</Code><Message>stand-in down</Message></Error>", { status: 500 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (request.method !== "GET") {
    // Object Lock refuses an upload without Content-MD5; the payload hash must match too.
    expect(request.headers.get("content-md5")).toBe(base64(await crypto.subtle.digest("MD5", body)));
    expect(request.headers.get("x-amz-content-sha256")).toBe(hex(await crypto.subtle.digest("SHA-256", body)));
  }
  const keep = (bytes: Uint8Array) => versions.set(key, [...(versions.get(key) ?? []), { bytes, atMs: Date.now() }]);
  if (request.method === "GET" && url.searchParams.has("versions")) {
    const prefix = url.searchParams.get("prefix") ?? "";
    const listed = [...versions].filter(([listedKey]) => listedKey.startsWith(prefix)).flatMap(([listedKey, kept]) => kept.map((version, index) => `<Version><Key>${listedKey}</Key><VersionId>v${index}</VersionId><LastModified>${new Date(version.atMs).toISOString()}</LastModified></Version>`));
    return new Response(`<ListVersionsResult>${listed.join("")}</ListVersionsResult>`);
  }
  if (request.method === "POST" && url.searchParams.has("uploads")) {
    uploads.set(key, []);
    return new Response(`<InitiateMultipartUploadResult><UploadId>upload-${key}</UploadId></InitiateMultipartUploadResult>`);
  }
  if (request.method === "PUT" && url.searchParams.has("partNumber")) {
    expect(url.searchParams.get("uploadId")).toBe(`upload-${key}`);
    uploads.get(key)![Number(url.searchParams.get("partNumber")) - 1] = body;
    return new Response(null, { headers: { etag: `"part-${url.searchParams.get("partNumber")}"` } });
  }
  if (request.method === "POST" && url.searchParams.has("uploadId")) {
    const parts = uploads.get(key)!;
    expect(text(body)).toBe(`<CompleteMultipartUpload>${parts.map((_, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>&quot;part-${index + 1}&quot;</ETag></Part>`).join("")}</CompleteMultipartUpload>`);
    const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.byteLength;
    }
    keep(joined);
    return new Response("<CompleteMultipartUploadResult></CompleteMultipartUploadResult>");
  }
  if (request.method === "PUT") {
    keep(body);
    return new Response(null, { headers: { etag: '"whole"' } });
  }
  return new Response("<Error><Code>NotImplemented</Code></Error>", { status: 501 });
}

/** A queue that keeps what's sent, so tests can run each part themselves. */
function recordingQueue() {
  const sent: BackupPart[] = [];
  return {
    sent,
    queue: {
      send: async (body: BackupPart) => void sent.push(body),
      sendBatch: async (messages: { body: BackupPart }[]) => void sent.push(...messages.map((message) => message.body)),
    } as unknown as Queue<BackupPart>,
  };
}

/** A queue message for handleBackupMessage, saying whether it was acked or retried. */
function message(body: BackupPart, attempts = 1) {
  const outcome = { acked: false, retried: false };
  return { outcome, message: { body, attempts, ack: () => void (outcome.acked = true), retry: () => void (outcome.retried = true) } as unknown as Message<BackupPart> };
}

/** Runs every part a night queues, as the queue would, until none are left. */
async function runNight(testEnv: Env, sent: BackupPart[]): Promise<void> {
  while (sent.length) await handleBackupMessage(testEnv, message(sent.shift()!).message);
}

async function clearBucket(bucket: R2Bucket): Promise<void> {
  const listed = await bucket.list();
  if (listed.objects.length) await bucket.delete(listed.objects.map((object) => object.key));
}

beforeEach(async () => {
  versions = new Map();
  uploads = new Map();
  requests = [];
  failingKeys = new Set();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).hostname === "backups.zaisma.test" ? backblaze(request) : realFetch(request);
  }) as typeof fetch;
  await env.DB.exec("DELETE FROM backup_runs; DELETE FROM room_usage; DELETE FROM kept_rooms;");
  await clearBucket(env.GAMES);
  await clearBucket(env.SAVES);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("starting a night's backup", () => {
  it("records the night and queues the first part of each kind, once a night", async () => {
    const { sent, queue } = recordingQueue();
    const testEnv = { ...env, BACKUP_QUEUE: queue } as Env;
    const nowMs = Date.UTC(2026, 9, 22, 3, 17);
    await startBackupRun(testEnv, nowMs);
    await startBackupRun(testEnv, nowMs + 60_000);
    expect(sent.map((part) => part.part_kind)).toEqual(["main_database", "game_databases", "kept_rooms", "bucket", "bucket"]);
    expect(sent.filter((part) => part.part_kind === "bucket").map((part) => (part as { bucket_name: string }).bucket_name)).toEqual(["zaisma-games", "zaisma-saves"]);
    const run = await env.DB.prepare("SELECT * FROM backup_runs").first<any>();
    expect(run).toMatchObject({ run_date: "2026-10-22", started_at_ms: nowMs, changed_after_ms: 0, queued_part_count: 5, finished_part_count: 0, finished_at_ms: null, failure_message: null });
  });

  it("copies what changed after the last good night, less an hour", async () => {
    const goodStartMs = Date.UTC(2026, 9, 21, 3, 17);
    await env.DB.prepare("INSERT INTO backup_runs (run_date, started_at_ms, finished_at_ms, changed_after_ms) VALUES ('2026-10-21', ?, ?, 0), ('2026-10-20', ?, ?, 0)").bind(goodStartMs, goodStartMs + 1000, goodStartMs - DAY_MS, goodStartMs - DAY_MS + 1000).run();
    // A failed night doesn't move it: the next one copies what that one missed.
    await env.DB.prepare("INSERT INTO backup_runs (run_date, started_at_ms, finished_at_ms, changed_after_ms, failure_message) VALUES ('2026-10-22', ?, ?, 0, 'down')").bind(goodStartMs + DAY_MS, goodStartMs + DAY_MS + 1000).run();
    const { queue } = recordingQueue();
    await startBackupRun({ ...env, BACKUP_QUEUE: queue } as Env, goodStartMs + 2 * DAY_MS);
    const run = await env.DB.prepare("SELECT changed_after_ms FROM backup_runs WHERE run_date = '2026-10-23'").first<{ changed_after_ms: number }>();
    expect(run!.changed_after_ms).toBe(goodStartMs - BACKUP_LIMITS.changeMarginMs);
  });

  it("fails the night and says so when the key isn't set, and tells once when a night never finished", async () => {
    const { sent, queue } = recordingQueue();
    const nowMs = Date.UTC(2026, 9, 22, 3, 17);
    await env.DB.prepare("INSERT INTO backup_runs (run_date, started_at_ms, changed_after_ms, queued_part_count, finished_part_count) VALUES ('2026-10-21', ?, 0, 5, 3)").bind(nowMs - DAY_MS).run();
    await startBackupRun({ ...env, BACKUP_QUEUE: queue, BACKUP_KEY_SECRET: undefined } as Env, nowMs);
    expect(sent).toEqual([]);
    const { results } = await env.DB.prepare("SELECT run_date, finished_at_ms, failure_message, is_failure_told FROM backup_runs ORDER BY run_date").all<any>();
    expect(results).toEqual([
      { run_date: "2026-10-21", finished_at_ms: nowMs, failure_message: expect.stringContaining("didn't finish"), is_failure_told: 1 },
      { run_date: "2026-10-22", finished_at_ms: nowMs, failure_message: expect.stringContaining("BACKUP_KEY_SECRET"), is_failure_told: 1 },
    ]);
  });
});

describe("a night's parts", () => {
  it("copies the main database as SQL that loads into an empty database, and every game file and save, then finishes", async () => {
    await env.GAMES.put("blobs/abc123", "<canvas></canvas>");
    await env.GAMES.put("brotli/blobs/abc123", "compressed copy");
    await env.SAVES.put("saves/account-1/game-1.json", '{"level":3}');
    const { sent, queue } = recordingQueue();
    const testEnv = { ...env, BACKUP_QUEUE: queue } as Env;
    await startBackupRun(testEnv);
    await runNight(testEnv, sent);

    const dump = text(newest("main-database.sql")!.bytes);
    expect(dump.startsWith("PRAGMA defer_foreign_keys=TRUE;\n")).toBe(true);
    expect(dump).toContain("CREATE TABLE backup_runs");
    expect(dump).toMatch(/INSERT INTO "backup_runs"\("run_date",.*\) VALUES\('\d{4}-\d{2}-\d{2}',/);
    // The forum's full-text search goes in through its virtual table, never its shadow tables.
    expect(dump).toContain("CREATE VIRTUAL TABLE forum_search");
    expect(dump).not.toContain("forum_search_data");
    expect(dump).not.toContain("BEGIN TRANSACTION");

    expect(text(newest("zaisma-games/blobs/abc123")!.bytes)).toBe("<canvas></canvas>");
    expect(text(newest("zaisma-saves/saves/account-1/game-1.json")!.bytes)).toBe('{"level":3}');
    expect(versions.has("zaisma-games/brotli/blobs/abc123")).toBe(false);

    const run = await env.DB.prepare("SELECT * FROM backup_runs").first<any>();
    expect(run).toMatchObject({ queued_part_count: 5, finished_part_count: 5, copied_object_count: 3, failure_message: null });
    expect(run.finished_at_ms).toEqual(expect.any(Number));
    // Nothing reads the bucket but the one check of old versions.
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(1);
  });

  it("writes each value so it loads back the same, quotes and line breaks included", async () => {
    await env.DB.prepare("INSERT INTO backup_runs (run_date, started_at_ms, changed_after_ms, failure_message) VALUES ('2026-01-01', 1, 0, ?)").bind("it's 'quoted'\nand on two lines").run();
    let dump = "";
    for await (const part of mainDatabaseDump(env.DB)) dump += part;
    const insert = /INSERT INTO "backup_runs"\([^)]*\) VALUES\(.*?\);\n/s.exec(dump)![0];
    await env.DB.exec("DROP TABLE IF EXISTS backup_runs_restored");
    await env.DB.exec("CREATE TABLE backup_runs_restored AS SELECT * FROM backup_runs WHERE 0");
    await env.DB.prepare(insert.replace('INSERT INTO "backup_runs"', 'INSERT INTO "backup_runs_restored"')).run();
    expect(await env.DB.prepare("SELECT * FROM backup_runs_restored").first()).toEqual(await env.DB.prepare("SELECT * FROM backup_runs").first());
    await env.DB.exec("DROP TABLE backup_runs_restored");
  });

  it("copies only what changed since the last good night, plus what's due its refresh", async () => {
    await env.SAVES.put("saves/old.json", "{}");
    const run = { started_at_ms: Date.now(), changed_after_ms: Date.now() + 60_000 };
    const result = await backupPart(env as Env, { run_date: "2026-10-22", part_kind: "bucket", bucket_name: "zaisma-saves", after_key: null }, run);
    expect(result.copiedObjectCount).toBe(isRefreshDue("zaisma-saves/saves/old.json", run) ? 1 : 0);
    expect(result.nextPart).toBeNull();
    const changed = await backupPart(env as Env, { run_date: "2026-10-22", part_kind: "bucket", bucket_name: "zaisma-saves", after_key: null }, { ...run, changed_after_ms: Date.now() - 60_000 });
    expect(changed.copiedObjectCount).toBe(1);
  });

  it("sends an object bigger than one request in parts", async () => {
    const bytes = new Uint8Array(BACKUP_STORAGE_LIMITS.partSizeBytes + 1000);
    for (let index = 0; index < bytes.length; index += 4096) bytes[index] = index % 251;
    await env.GAMES.put("owned/owner-1/big", bytes);
    await backupPart(env as Env, { run_date: "2026-10-22", part_kind: "bucket", bucket_name: "zaisma-games", after_key: null }, { started_at_ms: Date.now(), changed_after_ms: 0 });
    const copied = newest("zaisma-games/owned/owner-1/big")!.bytes;
    expect(copied.byteLength).toBe(bytes.byteLength);
    expect(hex(await crypto.subtle.digest("SHA-256", copied))).toBe(hex(await crypto.subtle.digest("SHA-256", bytes)));
    expect(uploads.get("zaisma-games/owned/owner-1/big")).toHaveLength(2);
  }, 60_000);

  it("copies a game's database whose game wrote to it, without counting on the game's meter", async () => {
    await env.DB.exec("DELETE FROM api_keys; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
    await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
    await letPublish(env.DB, "dev-1");
    const token = (await createApiKey(env.DB, "dev-1", "claude")).token;
    const created = await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Sky Hopper" }) });
    expect(created.status).toBe(201);
    const gameId = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'sky-hopper'").first<{ id: string }>())!.id;
    const batch = await env.GAME_DATABASES!.batch(gameId, [{ sql: "CREATE TABLE scores (player_id TEXT, points INTEGER)" }, { sql: "INSERT INTO scores VALUES ('player_1', 42)" }]);
    expect("queryResult" in batch).toBe(true);
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, database_written_row_count) VALUES (?, ?, 1)").bind(gameId, new Date().toISOString().slice(0, 10)).run();
    const before = await env.GAME_DATABASES!.usage(gameId);

    const result = await backupPart(env as Env, { run_date: "2026-10-22", part_kind: "game_databases", after_game_id: null }, { started_at_ms: Date.now(), changed_after_ms: Date.now() - DAY_MS });
    expect(result).toMatchObject({ copiedObjectCount: 1, nextPart: null });
    const dump = text(newest(`game-databases/${gameId}.sql`)!.bytes);
    expect(dump).toContain("CREATE TABLE scores");
    expect(dump).toMatch(/INSERT INTO "?scores"? VALUES\('player_1',42\);/);
    expect(await env.GAME_DATABASES!.usage(gameId)).toEqual(before);
  });

  it("tries a failing part again, then marks the night failed and tells once", async () => {
    failingKeys.add("main-database.sql");
    const { queue } = recordingQueue();
    const testEnv = { ...env, BACKUP_QUEUE: queue } as Env;
    await startBackupRun(testEnv);
    const runDate = new Date().toISOString().slice(0, 10);
    const first = message({ run_date: runDate, part_kind: "main_database" }, 1);
    // Backblaze's 500 is tried again 2 and 4 seconds later, kept here instead of waited out.
    const waitDurationsMs: number[] = [];
    const noWait = async (durationMs: number) => void waitDurationsMs.push(durationMs);
    await handleBackupMessage(testEnv, first.message, noWait);
    expect(first.outcome).toEqual({ acked: false, retried: true });
    expect(waitDurationsMs).toEqual([2000, 4000]);
    const last = message({ run_date: runDate, part_kind: "main_database" }, BACKUP_LIMITS.partTryCount);
    await handleBackupMessage(testEnv, last.message, noWait);
    expect(last.outcome).toEqual({ acked: true, retried: false });
    const run = await env.DB.prepare("SELECT finished_part_count, failure_message, is_failure_told FROM backup_runs").first<any>();
    expect(run).toEqual({ finished_part_count: 1, failure_message: expect.stringContaining("The main database failed 3 times: Backblaze refused PUT main-database.sql: 500 InternalError stand-in down"), is_failure_told: 1 });
  });

  it("alerts when the lifecycle rule leaves a copy past 31 days", async () => {
    versions.set("main-database.sql", [{ bytes: new Uint8Array(), atMs: Date.now() - 40 * DAY_MS }]);
    const logged: string[] = [];
    const realLog = console.log;
    console.log = (...parts: unknown[]) => void logged.push(parts.join(" "));
    try {
      await backupPart(env as Env, { run_date: "2026-10-22", part_kind: "main_database" }, { started_at_ms: Date.now(), changed_after_ms: 0 });
    } finally {
      console.log = realLog;
    }
    expect(logged).toContain("[alert] Backups kept too long");
  });
});

describe("refreshes", () => {
  it("falls on one night in every 24 for each key, and on every night after a long gap", () => {
    const startMs = Date.UTC(2026, 9, 1, 3, 17);
    const nights = Array.from({ length: BACKUP_LIMITS.refreshIntervalDays }, (_, index) => ({ started_at_ms: startMs + index * DAY_MS, changed_after_ms: startMs + (index - 1) * DAY_MS - BACKUP_LIMITS.changeMarginMs }));
    for (const key of ["zaisma-games/blobs/a", "zaisma-saves/saves/b.json", "main-database.sql"]) expect(nights.filter((night) => isRefreshDue(key, night))).toHaveLength(1);
    expect(isRefreshDue("zaisma-games/blobs/a", { started_at_ms: startMs, changed_after_ms: 0 })).toBe(true);
    expect(isRefreshDue("zaisma-games/blobs/a", { started_at_ms: startMs, changed_after_ms: startMs - 30 * DAY_MS })).toBe(true);
  });
});

describe("the privacy page", () => {
  it("names Backblaze, says the backup is in the United States and that deleted data leaves it within 30 days", async () => {
    const page = await (await SELF.fetch(`${SITE}/legal/privacy`)).text();
    expect(page).toContain("<strong>Backblaze</strong> keeps Zaisma's nightly backup, in the United States.");
    expect(page).toContain("for up to 30 days after something is deleted here, a copy of it can still be in the backup");
    expect(page).toContain("Their copies in our backup are gone within 30 days.");
  });
});
