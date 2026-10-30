import { BackupStorage, type BackupStorageSettings, type BackupWait } from "./backup-storage.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { sendPush } from "./push.ts";
import { restoreEventKey, type RestoreEvent } from "./restore-events.ts";

/**
 * Every night's copy of Zaisma to Backblaze B2, outside Cloudflare (docs/DECISIONS.md, "A copy outside
 * Cloudflare that nobody can delete"): the main database as a full SQL dump, every game's database, kept
 * rooms' worlds, cloud saves and game files. The daily cron starts a run (startBackupRun); its parts go on
 * the zaisma-backup queue, one at a time per kind, each a page of work that queues the next page
 * (backupPart). A part copies what changed after the last good night, plus what's due its refresh: every
 * live object is copied again every BACKUP_LIMITS.refreshIntervalDays, so it always has a copy younger than
 * the bucket's 28-day lock, after which the lifecycle rule hides and deletes it. That's how something
 * deleted from Zaisma leaves the backups within 30 days, with a key that can't delete.
 *
 * One key whose copy fails never stops the rest: it goes in backup_failed_keys, the failed_keys part tries it
 * again every night until it's copied, and each night it fails alerts. A night whose only failures are such
 * keys still counts as good for what the next one copies (is_key_failures_only).
 *
 * Each object keeps one key in the bucket, and each night that copies it adds a version:
 *   main-database.sql                         the main database (D1), every night
 *   game-databases/<game_id>.sql              a game's database, SQLite's own dump
 *   kept-rooms/<game_id>/<room_code>.jsonl    a kept room's storage, { key, value } per line
 *   zaisma-games/<key>, zaisma-saves/<key>    each object of those R2 buckets (not zaisma-games' brotli/ copies)
 * Not copied: game secrets (encrypted under a key that lives only in Cloudflare), rooms that aren't kept,
 * and Supabase's sign-ins, which Supabase backs up itself.
 */

export const BACKUP_LIMITS = {
  /** Every live object is copied again this often, under the bucket's 28-day lock with four nights to spare. */
  refreshIntervalDays: 24,
  /** A version this old means the lifecycle rule isn't deleting: the privacy page promises 30 days. */
  keptVersionMaximumAgeDays: 31,
  /** Copies made at once within a part. */
  copyConcurrency: 6,
  /** A part stops once it has copied this much and queues the rest, to stay well inside a queue run's CPU time. */
  partCopySizeBytes: 1024 * 1024 * 1024,
  /** Objects listed per page of a bucket. */
  listedObjectCount: 1000,
  /** Games looked at per part for their databases, and kept rooms per part. */
  pageGameCount: 500,
  pageKeptRoomCount: 200,
  /** What changed this long before the last good night began is copied again, for writes in flight as it listed. */
  changeMarginMs: 60 * 60 * 1000,
  /** Tries per part before the night is marked failed. */
  partTryCount: 3,
  /** Keys that failed on earlier nights tried again per night, oldest first. */
  pageFailedKeyCount: 100,
  /** Failed keys a night's alert names; the rest are counted. */
  toldFailedKeyCount: 10,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKED_UP_BUCKET_NAMES = ["zaisma-games", "zaisma-saves"] as const;
type BackedUpBucketName = (typeof BACKED_UP_BUCKET_NAMES)[number];

/**
 * One part of a night's copy, as a message on the zaisma-backup queue; or a takedown or deletion to keep
 * outside Cloudflare as it happens (restore_event, outside any night).
 */
export type BackupPart =
  | { run_date: string; part_kind: "main_database" }
  | { run_date: string; part_kind: "failed_keys" }
  | { part_kind: "restore_event"; event: RestoreEvent }
  | { run_date: string; part_kind: "game_databases"; after_game_id: string | null }
  | { run_date: string; part_kind: "kept_rooms"; after_game_id: string | null; after_room_code: string | null }
  | { run_date: string; part_kind: "bucket"; bucket_name: BackedUpBucketName; after_key: string | null };

interface BackupRun {
  run_date: string;
  started_at_ms: number;
  finished_at_ms: number | null;
  changed_after_ms: number;
  queued_part_count: number;
  finished_part_count: number;
  copied_object_count: number;
  copied_size_bytes: number;
  failure_message: string | null;
  is_failure_told: number;
  is_key_failures_only: number;
}

type NightPart = Exclude<BackupPart, { part_kind: "restore_event" }>;

/** A key whose copy failed, as the backups bucket names it, with what's needed to copy it again. */
interface FailedKey {
  backup_key: string;
  part_kind: "game_databases" | "kept_rooms" | "bucket";
  bucket_name: BackedUpBucketName | null;
  failure_message: string;
}

/** What one part did: what it copied, the keys that failed and the earlier failed keys now copied, and the part after it, if any. */
interface PartResult {
  copiedObjectCount: number;
  copiedSizeBytes: number;
  failedKeys: FailedKey[];
  recoveredKeys: string[];
  nextPart: NightPart | null;
}

const EMPTY_PART_RESULT: PartResult = { copiedObjectCount: 0, copiedSizeBytes: 0, failedKeys: [], recoveredKeys: [], nextPart: null };

const runDateOf = (atMs: number) => new Date(atMs).toISOString().slice(0, 10);

/**
 * Starts the night's copy from the daily cron: says when last night's never finished, then queues the
 * first part of each kind. Without the key, the night is recorded as failed and Zaisma hears. Twice in
 * one night starts once.
 */
export async function startBackupRun(env: Env, nowMs = Date.now()): Promise<void> {
  if (!env.BACKUP_QUEUE || !env.BACKUP_ENDPOINT) return;
  await tellUnfinishedRuns(env, nowMs);
  const runDate = runDateOf(nowMs);
  // A night whose only failures were single keys is good: those keys are tried again by failed_keys, not by copying everything since.
  const lastGood = await env.DB.prepare("SELECT started_at_ms FROM backup_runs WHERE finished_at_ms IS NOT NULL AND (failure_message IS NULL OR is_key_failures_only = 1) ORDER BY started_at_ms DESC LIMIT 1").first<{ started_at_ms: number }>();
  const changedAfterMs = lastGood ? lastGood.started_at_ms - BACKUP_LIMITS.changeMarginMs : 0;
  const firstParts: NightPart[] = [
    { run_date: runDate, part_kind: "failed_keys" },
    { run_date: runDate, part_kind: "main_database" },
    { run_date: runDate, part_kind: "game_databases", after_game_id: null },
    { run_date: runDate, part_kind: "kept_rooms", after_game_id: null, after_room_code: null },
    ...BACKED_UP_BUCKET_NAMES.map((bucketName): NightPart => ({ run_date: runDate, part_kind: "bucket", bucket_name: bucketName, after_key: null })),
  ];
  const hasKey = Boolean(env.BACKUP_KEY_ID && env.BACKUP_KEY_SECRET);
  const started = await env.DB.prepare("INSERT INTO backup_runs (run_date, started_at_ms, changed_after_ms, queued_part_count, finished_at_ms, failure_message) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (run_date) DO NOTHING")
    .bind(runDate, nowMs, changedAfterMs, hasKey ? firstParts.length : 0, hasKey ? null : nowMs, hasKey ? null : "The backup key isn't set: BACKUP_KEY_ID and BACKUP_KEY_SECRET are Worker secrets.")
    .run();
  if (!started.meta.changes) return;
  if (!hasKey) {
    await tellFailure(env, runDate);
    return;
  }
  await env.BACKUP_QUEUE.sendBatch(firstParts.map((part) => ({ body: part })));
}

/** A night still running when the next one starts never finished: marked failed, and Zaisma hears. */
async function tellUnfinishedRuns(env: Env, nowMs: number): Promise<void> {
  const { results } = await env.DB.prepare("SELECT run_date FROM backup_runs WHERE finished_at_ms IS NULL AND started_at_ms < ?").bind(nowMs - DAY_MS / 2).all<{ run_date: string }>();
  for (const { run_date: runDate } of results) {
    await env.DB.prepare("UPDATE backup_runs SET finished_at_ms = ?, failure_message = COALESCE(failure_message, ?) WHERE run_date = ?").bind(nowMs, "It didn't finish before the next night began: a part stopped without saying why.", runDate).run();
    await tellFailure(env, runDate);
  }
}

/** Alerts Zaisma about a failed night, once. */
async function tellFailure(env: Env, runDate: string): Promise<void> {
  const claimed = await env.DB.prepare("UPDATE backup_runs SET is_failure_told = 1 WHERE run_date = ? AND is_failure_told = 0 AND failure_message IS NOT NULL RETURNING failure_message").bind(runDate).first<{ failure_message: string }>();
  if (!claimed) return;
  const message = `The copy to Backblaze for ${runDate} failed: ${claimed.failure_message} The next night copies what this one missed.`;
  await Promise.all([sendAlert(env, `Backup failed: ${runDate}`, message), sendPush(env, { title: "Backup failed", message, priorityNumber: 1 })]);
}

/** One message from the zaisma-backup queue: does its part, records it, queues the next; after its last try, marks the night failed. */
export async function handleBackupMessage(env: Env, message: Message<BackupPart>, wait?: BackupWait): Promise<void> {
  const part = message.body;
  if (part.part_kind === "restore_event") return keepRestoreEvent(env, message as Message<Extract<BackupPart, { part_kind: "restore_event" }>>, wait);
  const run = await env.DB.prepare("SELECT * FROM backup_runs WHERE run_date = ?").bind(part.run_date).first<BackupRun>();
  if (!run || run.finished_at_ms !== null) return message.ack();
  let partResult: PartResult;
  try {
    partResult = await backupPart(env, part, run, wait);
  } catch (error) {
    console.error("backup part failed", part, error);
    if (message.attempts < BACKUP_LIMITS.partTryCount) return message.retry({ delaySeconds: 60 * message.attempts });
    const failureMessage = `${partName(part)} failed ${message.attempts} times: ${errorText(error)}`;
    await finishPart(env, run, EMPTY_PART_RESULT, failureMessage);
    await tellFailure(env, part.run_date);
    return message.ack();
  }
  await finishPart(env, run, partResult, null);
  if (partResult.nextPart) await env.BACKUP_QUEUE!.send(partResult.nextPart);
  message.ack();
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Counts a finished part, and the part it queues, in one write, so the night can't look finished between
 * them, with the keys it couldn't copy and the earlier failed keys it did; the night finishes when every
 * queued part has, and then says which keys failed.
 */
async function finishPart(env: Env, run: Pick<BackupRun, "run_date" | "started_at_ms">, partResult: PartResult, failureMessage: string | null): Promise<void> {
  const nowMs = Date.now();
  const [, finished] = await env.DB.batch([
    env.DB.prepare("UPDATE backup_runs SET finished_part_count = finished_part_count + 1, queued_part_count = queued_part_count + ?, copied_object_count = copied_object_count + ?, copied_size_bytes = copied_size_bytes + ?, failure_message = COALESCE(failure_message, ?) WHERE run_date = ?").bind(
      partResult.nextPart ? 1 : 0,
      partResult.copiedObjectCount,
      partResult.copiedSizeBytes,
      failureMessage,
      run.run_date,
    ),
    env.DB.prepare("UPDATE backup_runs SET finished_at_ms = ? WHERE run_date = ? AND finished_at_ms IS NULL AND finished_part_count >= queued_part_count").bind(nowMs, run.run_date),
    ...(partResult.recoveredKeys.length ? [env.DB.prepare("DELETE FROM backup_failed_keys WHERE backup_key IN (SELECT value FROM json_each(?))").bind(JSON.stringify(partResult.recoveredKeys))] : []),
    ...(partResult.failedKeys.length
      ? [
          env.DB.prepare(
            `INSERT INTO backup_failed_keys (backup_key, part_kind, bucket_name, failure_count, first_failed_at_ms, last_failed_at_ms, failure_message)
             SELECT json_extract(value, '$.backup_key'), json_extract(value, '$.part_kind'), json_extract(value, '$.bucket_name'), 1, ?1, ?1, json_extract(value, '$.failure_message') FROM json_each(?2) WHERE true
             ON CONFLICT (backup_key) DO UPDATE SET failure_count = failure_count + 1, last_failed_at_ms = excluded.last_failed_at_ms, failure_message = excluded.failure_message`,
          ).bind(Math.max(nowMs, run.started_at_ms), JSON.stringify(partResult.failedKeys.map((failedKey) => ({ ...failedKey, failure_message: failedKey.failure_message.slice(0, 500) })))),
        ]
      : []),
  ]);
  if (finished!.meta.changes) await tellFailedKeys(env, run);
}

/** A night that finished with keys it couldn't copy: its failure names them, and when they were its only failures it still counts as good. */
async function tellFailedKeys(env: Env, run: Pick<BackupRun, "run_date" | "started_at_ms">): Promise<void> {
  const failed = await env.DB.prepare("SELECT COUNT(*) AS key_count, (SELECT json_group_array(backup_key) FROM (SELECT backup_key FROM backup_failed_keys WHERE last_failed_at_ms >= ?1 ORDER BY backup_key LIMIT ?2)) AS keys_json FROM backup_failed_keys WHERE last_failed_at_ms >= ?1")
    .bind(run.started_at_ms, BACKUP_LIMITS.toldFailedKeyCount)
    .first<{ key_count: number; keys_json: string }>();
  if (!failed?.key_count) return;
  const keys = JSON.parse(failed.keys_json) as string[];
  const failureMessage = `${failed.key_count} ${failed.key_count === 1 ? "key" : "keys"} failed to copy: ${keys.join(", ")}${failed.key_count > keys.length ? "…" : ""}. Every other key was copied, and each that failed is tried again every night until it's copied.`;
  await env.DB.prepare("UPDATE backup_runs SET failure_message = ?, is_key_failures_only = 1 WHERE run_date = ? AND failure_message IS NULL").bind(failureMessage, run.run_date).run();
  await tellFailure(env, run.run_date);
}

function partName(part: NightPart): string {
  if (part.part_kind === "failed_keys") return "Keys that failed on earlier nights";
  if (part.part_kind === "main_database") return "The main database";
  if (part.part_kind === "game_databases") return `Games' databases after ${part.after_game_id ?? "the start"}`;
  if (part.part_kind === "kept_rooms") return `Kept rooms after ${part.after_game_id ? `${part.after_game_id}/${part.after_room_code}` : "the start"}`;
  return `${part.bucket_name} after ${part.after_key ?? "the start"}`;
}

/** One part of a night's copy: what it copied, the keys that failed, and the part after it. */
export async function backupPart(env: Env, part: NightPart, run: Pick<BackupRun, "started_at_ms" | "changed_after_ms">, wait?: BackupWait): Promise<PartResult> {
  const storage = new BackupStorage(backupStorageSettings(env), wait);
  const isDue = (key: string, changedAtMs: number) => changedAtMs > run.changed_after_ms || isRefreshDue(key, run);
  if (part.part_kind === "main_database") {
    const copiedSizeBytes = await storage.uploadObject("main-database.sql", encodedLines(mainDatabaseDump(env.DB)));
    await checkOldVersions(env, storage, run.started_at_ms);
    return { ...EMPTY_PART_RESULT, copiedObjectCount: 1, copiedSizeBytes };
  }
  if (part.part_kind === "failed_keys") {
    const { results } = await env.DB.prepare("SELECT backup_key, part_kind, bucket_name FROM backup_failed_keys ORDER BY first_failed_at_ms, backup_key LIMIT ?")
      .bind(BACKUP_LIMITS.pageFailedKeyCount)
      .all<Omit<FailedKey, "failure_message">>();
    const copied = await copyInTurn(results, (row) => row.backup_key, (row) => copyFailedKey(env, storage, row));
    const rowOf = new Map(results.map((row) => [row.backup_key, row]));
    // What a part stopped before waits for the next night.
    return { ...copied, failedKeys: copied.failedKeys.map((failedKey) => ({ ...rowOf.get(failedKey.backup_key)!, ...failedKey })), recoveredKeys: copied.succeededKeys, nextPart: null };
  }
  if (part.part_kind === "game_databases") {
    const changedAfterDate = runDateOf(run.changed_after_ms);
    const { results } = await env.DB.prepare(
      "SELECT games.id AS game_id, " +
        "EXISTS (SELECT 1 FROM room_usage WHERE room_usage.game_id = games.id AND room_usage.database_written_row_count > 0) AS has_database, " +
        "(EXISTS (SELECT 1 FROM room_usage WHERE room_usage.game_id = games.id AND room_usage.date >= ? AND room_usage.database_written_row_count > 0) " +
        "OR EXISTS (SELECT 1 FROM database_restores WHERE database_restores.game_id = games.id AND database_restores.restored_at_ms > ?)) AS is_changed " +
        "FROM games WHERE games.id > ? ORDER BY games.id LIMIT ?",
    )
      .bind(changedAfterDate, run.changed_after_ms, part.after_game_id ?? "", BACKUP_LIMITS.pageGameCount)
      .all<{ game_id: string; has_database: number; is_changed: number }>();
    const due = results.filter((row) => row.has_database === 1 && (row.is_changed === 1 || isRefreshDue(gameDatabaseKey(row.game_id), run)));
    const copied = await copyInTurn(due, (row) => gameDatabaseKey(row.game_id), (row) => copyGameDatabase(env, storage, row.game_id));
    const lastGameId = copied.stoppedAfter?.game_id ?? (results.length === BACKUP_LIMITS.pageGameCount ? results.at(-1)!.game_id : null);
    return { ...copied, failedKeys: failedKeysOf(copied, "game_databases", null), recoveredKeys: [], nextPart: lastGameId ? { ...part, after_game_id: lastGameId } : null };
  }
  if (part.part_kind === "kept_rooms") {
    const { results } = await env.DB.prepare(
      "SELECT kept_rooms.game_id, kept_rooms.room_code, kept_rooms.saved_at_ms, games.slug FROM kept_rooms JOIN games ON games.id = kept_rooms.game_id " +
        "WHERE (kept_rooms.game_id, kept_rooms.room_code) > (?, ?) ORDER BY kept_rooms.game_id, kept_rooms.room_code LIMIT ?",
    )
      .bind(part.after_game_id ?? "", part.after_room_code ?? "", BACKUP_LIMITS.pageKeptRoomCount)
      .all<{ game_id: string; room_code: string; saved_at_ms: number | null; slug: string }>();
    const due = results.filter((row) => isDue(keptRoomKey(row), row.saved_at_ms ?? 0));
    const copied = await copyInTurn(due, keptRoomKey, (row) => copyKeptRoom(env, storage, row));
    const last = copied.stoppedAfter ?? (results.length === BACKUP_LIMITS.pageKeptRoomCount ? results.at(-1)! : null);
    return { ...copied, failedKeys: failedKeysOf(copied, "kept_rooms", null), recoveredKeys: [], nextPart: last ? { ...part, after_game_id: last.game_id, after_room_code: last.room_code } : null };
  }
  const bucket = part.bucket_name === "zaisma-games" ? env.GAMES : env.SAVES;
  const listed = await bucket.list({ limit: BACKUP_LIMITS.listedObjectCount, ...(part.after_key ? { startAfter: part.after_key } : {}) });
  // Brotli copies of game files are made again from the files after a restore.
  const objects = listed.objects.filter((object) => !(part.bucket_name === "zaisma-games" && object.key.startsWith("brotli/")));
  const due = objects.filter((object) => isDue(`${part.bucket_name}/${object.key}`, object.uploaded.getTime()));
  const copied = await copyInTurn(due, (listedObject) => `${part.bucket_name}/${listedObject.key}`, (listedObject) => copyBucketObject(env, storage, part.bucket_name, listedObject.key));
  const lastKey = copied.stoppedAfter?.key ?? (listed.truncated ? listed.objects.at(-1)!.key : null);
  return { ...copied, failedKeys: failedKeysOf(copied, "bucket", part.bucket_name), recoveredKeys: [], nextPart: lastKey ? { ...part, after_key: lastKey } : null };
}

const gameDatabaseKey = (gameId: string) => `game-databases/${gameId}.sql`;
const keptRoomKey = (row: { game_id: string; room_code: string }) => `kept-rooms/${row.game_id}/${row.room_code}.jsonl`;

const copyGameDatabase = async (env: Env, storage: BackupStorage, gameId: string) => (env.GAME_DATABASES ? storage.uploadObject(gameDatabaseKey(gameId), encodedLines(gameDatabaseDump(env, gameId))) : 0);

async function copyKeptRoom(env: Env, storage: BackupStorage, row: { game_id: string; room_code: string; slug: string }): Promise<number> {
  const world = await env.GAME_STORAGE?.keptRoomBackup(row.game_id, row.slug, row.room_code);
  return world ? storage.uploadObject(keptRoomKey(row), world) : 0;
}

async function copyBucketObject(env: Env, storage: BackupStorage, bucketName: BackedUpBucketName, key: string): Promise<number> {
  const object = await (bucketName === "zaisma-games" ? env.GAMES : env.SAVES).get(key);
  // Deleted since it was listed: nothing to keep. Its content type and custom metadata go with it, for a restore.
  return object ? storage.uploadObject(`${bucketName}/${key}`, object.body, { contentType: object.httpMetadata?.contentType, customMetadata: object.customMetadata }) : 0;
}

/** A key that failed on an earlier night, copied again the way its kind is; one whose game, room or object is gone since has nothing to keep. */
async function copyFailedKey(env: Env, storage: BackupStorage, row: Omit<FailedKey, "failure_message">): Promise<number> {
  if (row.part_kind === "bucket" && row.bucket_name) return copyBucketObject(env, storage, row.bucket_name, row.backup_key.slice(row.bucket_name.length + 1));
  if (row.part_kind === "game_databases") {
    const gameId = row.backup_key.slice("game-databases/".length, -".sql".length);
    return (await env.DB.prepare("SELECT 1 AS is_found FROM games WHERE id = ?").bind(gameId).first()) ? copyGameDatabase(env, storage, gameId) : 0;
  }
  const [, gameId = "", fileName = ""] = row.backup_key.split("/");
  const room = await env.DB.prepare("SELECT kept_rooms.game_id, kept_rooms.room_code, games.slug FROM kept_rooms JOIN games ON games.id = kept_rooms.game_id WHERE kept_rooms.game_id = ? AND kept_rooms.room_code = ?")
    .bind(gameId, fileName.slice(0, -".jsonl".length))
    .first<{ game_id: string; room_code: string; slug: string }>();
  return room ? copyKeptRoom(env, storage, room) : 0;
}

const failedKeysOf = (copied: { failedKeys: { backup_key: string; failure_message: string }[] }, partKind: FailedKey["part_kind"], bucketName: BackedUpBucketName | null): FailedKey[] =>
  copied.failedKeys.map((failedKey) => ({ ...failedKey, part_kind: partKind, bucket_name: bucketName }));

/**
 * Copies the items a few at a time, in order, until a part's worth is copied: then it stops after a
 * whole group and says the last item it copied, where the next part goes on. Each item has its own try,
 * so one that fails is named by its key and the rest are still copied.
 */
async function copyInTurn<Item>(
  items: Item[],
  keyOf: (listed: Item) => string,
  copy: (copied: Item) => Promise<number>,
): Promise<{ copiedObjectCount: number; copiedSizeBytes: number; stoppedAfter: Item | null; failedKeys: { backup_key: string; failure_message: string }[]; succeededKeys: string[] }> {
  let copiedObjectCount = 0;
  let copiedSizeBytes = 0;
  const failedKeys: { backup_key: string; failure_message: string }[] = [];
  const succeededKeys: string[] = [];
  for (let index = 0; index < items.length; index += BACKUP_LIMITS.copyConcurrency) {
    const group = items.slice(index, index + BACKUP_LIMITS.copyConcurrency);
    const settled = await Promise.allSettled(group.map(copy));
    settled.forEach((outcome, groupIndex) => {
      const backupKey = keyOf(group[groupIndex]!);
      if (outcome.status === "rejected") {
        console.error("backup key failed", backupKey, outcome.reason);
        failedKeys.push({ backup_key: backupKey, failure_message: errorText(outcome.reason) });
        return;
      }
      succeededKeys.push(backupKey);
      if (outcome.value > 0) copiedObjectCount++;
      copiedSizeBytes += outcome.value;
    });
    const isLast = index + BACKUP_LIMITS.copyConcurrency >= items.length;
    if (!isLast && copiedSizeBytes >= BACKUP_LIMITS.partCopySizeBytes) return { copiedObjectCount, copiedSizeBytes, stoppedAfter: group.at(-1)!, failedKeys, succeededKeys };
  }
  return { copiedObjectCount, copiedSizeBytes, stoppedAfter: null, failedKeys, succeededKeys };
}

/**
 * A takedown or deletion, kept in the backups bucket as it happens (restore-events.ts), so a restore can do it
 * again. The queue tries it again; after its last try Zaisma hears, and the takedown itself already stands.
 */
async function keepRestoreEvent(env: Env, message: Message<Extract<BackupPart, { part_kind: "restore_event" }>>, wait?: BackupWait): Promise<void> {
  if (!env.BACKUP_ENDPOINT || !env.BACKUP_KEY_ID || !env.BACKUP_KEY_SECRET) {
    console.error("A restore event wasn't kept: the backup key isn't set", message.body.event);
    return message.ack();
  }
  const { event } = message.body;
  try {
    const storage = new BackupStorage(backupStorageSettings(env), wait);
    await storage.uploadObject(restoreEventKey(event), encodedLines([JSON.stringify(event)]), { contentType: "application/json" });
  } catch (error) {
    console.error("restore event failed", event, error);
    if (message.attempts < BACKUP_LIMITS.partTryCount) return message.retry({ delaySeconds: 60 * message.attempts });
    const alertMessage = `A restore event couldn't be copied to Backblaze: ${event.event_kind} at ${new Date(event.at_ms).toISOString()} (${JSON.stringify(event)}) failed ${message.attempts} times: ${errorText(error)} A restore from the backups wouldn't do it again.`;
    await Promise.all([sendAlert(env, "Restore event not kept", alertMessage), sendPush(env, { title: "Restore event not kept", message: alertMessage, priorityNumber: 1 })]);
  }
  message.ack();
}

/**
 * Whether the object's refresh falls on a night since the last good one: each key has its night in
 * every refreshIntervalDays, by a hash of the key, so the refresh is spread evenly over the nights.
 */
export function isRefreshDue(key: string, run: Pick<BackupRun, "started_at_ms" | "changed_after_ms">): boolean {
  if (run.changed_after_ms === 0) return true;
  const todayNumber = Math.floor(run.started_at_ms / DAY_MS);
  const lastGoodDayNumber = Math.floor((run.changed_after_ms + BACKUP_LIMITS.changeMarginMs) / DAY_MS);
  if (todayNumber - lastGoodDayNumber >= BACKUP_LIMITS.refreshIntervalDays) return true;
  const refreshSlotNumber = fnv1a(key) % BACKUP_LIMITS.refreshIntervalDays;
  for (let dayNumber = lastGoodDayNumber + 1; dayNumber <= todayNumber; dayNumber++) if (dayNumber % BACKUP_LIMITS.refreshIntervalDays === refreshSlotNumber) return true;
  return false;
}

function fnv1a(text: string): number {
  let hashNumber = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hashNumber = Math.imul(hashNumber ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hashNumber;
}

/** Once a night: a version of the main database older than the lifecycle rule allows means it isn't deleting, and Zaisma hears. */
async function checkOldVersions(env: Env, storage: BackupStorage, nowMs: number): Promise<void> {
  let versions;
  try {
    versions = await storage.listObjectVersions("main-database.sql");
  } catch (error) {
    console.error("couldn't list the main database's backup versions", error);
    return;
  }
  const oldestAtMs = Math.min(...versions.map((version) => version.lastModifiedAtMs));
  if (!Number.isFinite(oldestAtMs) || nowMs - oldestAtMs <= BACKUP_LIMITS.keptVersionMaximumAgeDays * DAY_MS) return;
  const message = `The backups still hold a copy of the main database from ${new Date(oldestAtMs).toISOString().slice(0, 10)}: Backblaze's lifecycle rule on zaisma-backups isn't deleting copies after 28 days, so the privacy page's 30 days don't hold.`;
  await Promise.all([sendAlert(env, "Backups kept too long", message), sendPush(env, { title: "Backups kept too long", message, priorityNumber: 1 })]);
}

function backupStorageSettings(env: Env): BackupStorageSettings {
  return { endpointUrl: env.BACKUP_ENDPOINT!, regionName: env.BACKUP_REGION!, bucketName: env.BACKUP_BUCKET_NAME!, keyId: env.BACKUP_KEY_ID!, keySecret: env.BACKUP_KEY_SECRET! };
}

async function* encodedLines(lines: AsyncIterable<string> | Iterable<string>): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for await (const text of lines) yield encoder.encode(text);
}

/** A game's database as SQLite's own dump, part after part, read without counting on the game's meter. */
async function* gameDatabaseDump(env: Env, gameId: string): AsyncGenerator<string> {
  let cursor: string | null = null;
  do {
    const answer = await env.GAME_DATABASES!.backupDump(gameId, cursor);
    if ("error" in answer) throw new Error(`${gameId}'s database: ${answer.error.message}`);
    yield answer.queryResult.dumpSql;
    cursor = answer.queryResult.nextCursor;
  } while (cursor);
}

/** The dump's first line, so a restore knows its tables are in reference order and splits it as it streams (scripts/restore-dump.mjs). */
export const MAIN_DATABASE_DUMP_HEADER = "-- Zaisma's main database: each table after the tables it refers to.";

/** Rows per SELECT while dumping a table of the main database. */
const MAIN_DATABASE_PAGE_ROW_COUNT = 500;

/**
 * The main database as SQL that loads into an empty D1 (wrangler d1 execute --file): its tables, their
 * rows, then indexes, views and triggers, the way D1's own export writes them, with no transaction (D1
 * refuses one in a file); a virtual table's rows go in through it, never its shadow tables. Each table
 * comes after the tables it refers to (orderedByReferences): D1's import checks foreign keys as it goes and
 * resets the database on the first row whose parent isn't in yet ({"D1_RESET_DO":true}, nothing more). Each table is
 * read a page at a time by rowid (or, without rowids, by its primary key), so it isn't one moment's
 * snapshot: rows written while it runs may be in or not. D1's own Time Travel keeps exact moments for 30
 * days inside Cloudflare.
 */
export async function* mainDatabaseDump(database: D1Database): AsyncGenerator<string> {
  const { results: entries } = await database
    .prepare("SELECT type, name, tbl_name AS table_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND tbl_name NOT LIKE '_cf_%' ORDER BY rowid")
    .all<{ type: string; name: string; table_name: string; sql: string }>();
  yield `${MAIN_DATABASE_DUMP_HEADER}\nPRAGMA defer_foreign_keys=TRUE;\n`;
  // A virtual table (the forum's full-text search) makes its own shadow tables, so only its rows are dumped.
  const virtualNames = entries.filter((entry) => entry.type === "table" && /^CREATE\s+VIRTUAL\s+TABLE/i.test(entry.sql)).map((entry) => entry.name);
  const isShadowTable = (name: string) => virtualNames.some((virtualName) => name.startsWith(`${virtualName}_`));
  const tables = entries.filter((entry) => entry.type === "table" && !isShadowTable(entry.name));
  const parentNamesOf = new Map<string, string[]>();
  for (const table of tables) {
    const { results: references } = await database.prepare("SELECT DISTINCT \"table\" AS parent_name FROM pragma_foreign_key_list(?)").bind(table.name).all<{ parent_name: string }>();
    parentNamesOf.set(table.name, references.map((reference) => reference.parent_name));
  }
  for (const table of orderedByReferences(tables, (name) => parentNamesOf.get(name) ?? [])) {
    yield `${table.sql};\n`;
    const { results: columns } = await database.prepare("SELECT name, pk AS primary_key_number FROM pragma_table_info(?) ORDER BY cid").bind(table.name).all<{ name: string; primary_key_number: number }>();
    const valuesSql = columns.map((column, index) => `quote(${quoteName(column.name)}) AS value_${index}`).join(", ");
    const insertInto = `INSERT INTO ${quoteName(table.name)}(${columns.map((column) => quoteName(column.name)).join(",")}) VALUES(`;
    const isWithoutRowid = /\bWITHOUT\s+ROWID\b/i.test(table.sql);
    const primaryKey = columns.filter((column) => column.primary_key_number > 0).sort((first, second) => first.primary_key_number - second.primary_key_number);
    let lastRowidNumber = 0;
    let dumpedRowCount = 0;
    while (true) {
      const { results: rows } = isWithoutRowid
        ? await database.prepare(`SELECT ${valuesSql} FROM ${quoteName(table.name)} ORDER BY ${primaryKey.map((column) => quoteName(column.name)).join(", ")} LIMIT ${MAIN_DATABASE_PAGE_ROW_COUNT} OFFSET ?`).bind(dumpedRowCount).all<Record<string, string | number>>()
        : await database.prepare(`SELECT rowid AS paging_rowid, ${valuesSql} FROM ${quoteName(table.name)} WHERE rowid > ? ORDER BY rowid LIMIT ${MAIN_DATABASE_PAGE_ROW_COUNT}`).bind(lastRowidNumber).all<Record<string, string | number>>();
      let lines = "";
      for (const row of rows) {
        lines += `${insertInto}${columns.map((_, index) => row[`value_${index}`]).join(",")});\n`;
        if (!isWithoutRowid) lastRowidNumber = row.paging_rowid as number;
      }
      dumpedRowCount += rows.length;
      if (lines) yield lines;
      if (rows.length < MAIN_DATABASE_PAGE_ROW_COUNT) break;
    }
  }
  for (const entry of entries) if (entry.type !== "table") yield `${entry.sql};\n`;
}

const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Tables in their creation order, except that each comes after the tables it refers to. A table that refers
 * to itself, or a loop of them, keeps its place: D1's import defers foreign keys only within its own steps.
 */
export function orderedByReferences<Table extends { name: string }>(tables: Table[], parentNamesOf: (name: string) => string[]): Table[] {
  const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
  const ordered: Table[] = [];
  const placed = new Set<string>();
  const place = (name: string, path: Set<string>) => {
    if (placed.has(name) || path.has(name) || !byName.has(name)) return;
    path.add(name);
    for (const parentName of parentNamesOf(byName.get(name)!.name)) place(parentName.toLowerCase(), path);
    placed.add(name);
    ordered.push(byName.get(name)!);
  };
  for (const table of tables) place(table.name.toLowerCase(), new Set());
  return ordered;
}
