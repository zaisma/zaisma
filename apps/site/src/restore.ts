import { BackupStorage, type BackupObjectVersion, type BackupStorageSettings, type BackupWait } from "./backup-storage.ts";
import { scanStatements } from "@zaisma/game-server/internal";
import { playersErasedSince } from "@zaisma/core";
import type { Env } from "./env.ts";
import { queueMissingCompression } from "./compress.ts";
import { restoreRuleOf, type RestoreRule } from "./restore-rules.ts";
import { replayRestoreEvents } from "./restore-events.ts";
import { BACKUP_LIMITS } from "./backups.ts";

/**
 * Zaisma back from its backups at Backblaze, in a Cloudflare account whose main database scripts/restore.mjs
 * has just loaded (docs/DECISIONS.md, "A copy outside Cloudflare that nobody can delete"). The script inserts
 * a restore_runs row; the site's cron starts it once the read key is set (RESTORE_KEY_ID, RESTORE_KEY_SECRET),
 * and its parts go on the zaisma-backup queue, a range of keys each, a page at a time. A range with more than
 * a page splits itself by the key's next character (KEY_SPLIT_CHARACTERS) into ranges that run side by side,
 * so millions of saves and game files come back in hours, not days.
 *
 * Each key comes back as its newest version uploaded before the restore's cutoff (the night after the
 * main database's copy), and only when the restored database still holds what owns it: a restore never
 * brings back what was deleted or taken down (restore-rules.ts). Before the copy, the takedowns and deletions
 * made since the night began are done again in the restored database (restore-events.ts), so one made after
 * the main database's copy stays done too. Game files and saves go into R2 with the
 * content type and custom metadata they were copied with; games' databases are imported as Zaisma's own
 * writes, then the players erased since are erased again; kept rooms get their worlds back. While a
 * restore runs, the cron runs nothing else, so no cleanup deletes files whose owners haven't come back yet.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const RESTORE_LIMITS = {
  /** Copies made at once within a part. */
  copyConcurrency: 6,
  /** A part stops once it has restored this much and queues the rest. */
  partCopySizeBytes: 1024 * 1024 * 1024,
  /** Versions listed per page of the backups. */
  listedVersionCount: 1000,
  /** A game database's dump goes in parts of about this much SQL, at whole statements (an import part takes 5 MB). */
  databasePartSizeBytes: 4 * 1024 * 1024,
  /** Tries per part before the restore is marked failed. */
  partTryCount: 3,
  /** How many times a range splits into smaller ones: 66 ways each time, so four levels reach any size Zaisma has. */
  maximumSplitLevel: 4,
  /** How long player_erases keeps an erase (webhooks.ts): every erase it still holds is done again. */
  erasedPlayerKeptDurationMs: 31 * 24 * 60 * 60 * 1000,
} as const;

/** The kinds of backup a restore brings back, each its own chain of parts. The main database is the script's. */
export const RESTORED_PREFIXES = ["zaisma-games/", "zaisma-saves/", "game-databases/", "kept-rooms/"] as const;
type RestoredPrefix = (typeof RESTORED_PREFIXES)[number];

/**
 * One part of a restore, as a message on the zaisma-backup queue: the keys under prefix from range_start_key
 * (a range's own start, where its splits begin) up to before_key (null: to the prefix's end), listed after
 * after_key (null: from the range's start).
 */
export interface RestorePart {
  restore_id: string;
  part_kind: "restore";
  prefix: RestoredPrefix;
  range_start_key: string;
  before_key: string | null;
  after_key: string | null;
  split_level: number;
}

/**
 * The characters a range splits on, in byte order, as Backblaze lists keys. The ranges between them are
 * contiguous, so a key with any other character still falls in one of them.
 */
export const KEY_SPLIT_CHARACTERS = "-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

/** A range split by the next character after its start: the ranges between each split point, in order, covering it whole. */
export function splitRange(part: RestorePart): RestorePart[] {
  const splitKeys = [...KEY_SPLIT_CHARACTERS].map((character) => part.range_start_key + character).filter((splitKey) => part.before_key === null || splitKey < part.before_key);
  const starts = [part.range_start_key, ...splitKeys];
  // A key equal to a split point is listed after it, so it would be missed: no key Zaisma writes ends one character after a range's start.
  return starts.map((rangeStartKey, index) => ({
    ...part,
    range_start_key: rangeStartKey,
    before_key: starts[index + 1] ?? part.before_key,
    after_key: index === 0 ? part.after_key : rangeStartKey,
    split_level: part.split_level + 1,
  }));
}

interface RestoreRun {
  id: string;
  cutoff_at_ms: number;
  started_at_ms: number | null;
  finished_at_ms: number | null;
}

/**
 * Starts a restore the script asked for, from the cron, once the read key is set: first the takedowns and deletions
 * since the restored night began, then the copy. Answers whether one is running, so the cron runs nothing else.
 */
export async function runWaitingRestore(env: Env, nowMs = Date.now(), wait?: BackupWait): Promise<boolean> {
  const running = await env.DB.prepare("SELECT id, cutoff_at_ms, started_at_ms FROM restore_runs WHERE finished_at_ms IS NULL ORDER BY requested_at_ms LIMIT 1")
    .first<{ id: string; cutoff_at_ms: number; started_at_ms: number | null }>()
    // Before migration 0163 there's no table, and nothing to restore.
    .catch(() => null);
  if (!running) return false;
  if (running.started_at_ms !== null || !env.RESTORE_KEY_ID || !env.RESTORE_KEY_SECRET || !env.BACKUP_QUEUE) return true;
  // The night began a day before the cutoff; what overlaps the night is done again harmlessly, as every replay is safe twice.
  const replayedEventCount = await replayRestoreEvents(env, new BackupStorage(restoreStorageSettings(env), wait), running.cutoff_at_ms - DAY_MS - BACKUP_LIMITS.changeMarginMs);
  const started = await env.DB.prepare("UPDATE restore_runs SET started_at_ms = ?, queued_part_count = ?, replayed_event_count = ? WHERE id = ? AND started_at_ms IS NULL").bind(nowMs, RESTORED_PREFIXES.length, replayedEventCount, running.id).run();
  if (started.meta.changes) await env.BACKUP_QUEUE.sendBatch(RESTORED_PREFIXES.map((prefix): { body: RestorePart } => ({ body: { restore_id: running.id, part_kind: "restore", prefix, range_start_key: prefix, before_key: null, after_key: null, split_level: 0 } })));
  return true;
}

/** One restore message from the zaisma-backup queue: does its part, records it, queues the next; after its last try, marks the restore failed. */
export async function handleRestoreMessage(env: Env, message: Message<RestorePart>, wait?: BackupWait): Promise<void> {
  const part = message.body;
  const run = await env.DB.prepare("SELECT id, cutoff_at_ms, started_at_ms, finished_at_ms FROM restore_runs WHERE id = ?").bind(part.restore_id).first<RestoreRun>();
  if (!run || run.finished_at_ms !== null) return message.ack();
  let partResult: RestorePartResult;
  try {
    partResult = await restorePart(env, part, run, wait);
  } catch (error) {
    console.error("restore part failed", part, error);
    if (message.attempts < RESTORE_LIMITS.partTryCount) return message.retry({ delaySeconds: 60 * message.attempts });
    const failureMessage = `${part.prefix} after ${part.after_key ?? "the start"} failed ${message.attempts} times: ${error instanceof Error ? error.message : String(error)}`;
    await finishPart(env, run.id, { restoredObjectCount: 0, restoredSizeBytes: 0, skippedObjectCount: 0, kindCounts: new Map(), nextParts: [] }, failureMessage);
    return message.ack();
  }
  const isFinished = await finishPart(env, run.id, partResult, null);
  for (let index = 0; index < partResult.nextParts.length; index += 100) await env.BACKUP_QUEUE!.sendBatch(partResult.nextParts.slice(index, index + 100).map((nextPart) => ({ body: nextPart })));
  // The restored database says Brotli copies exist that aren't in R2 any more: they're made again.
  if (isFinished) {
    await env.DB.prepare("DELETE FROM compressed_blobs").run();
    await queueMissingCompression(env);
  }
  message.ack();
}

interface RestorePartResult {
  restoredObjectCount: number;
  restoredSizeBytes: number;
  skippedObjectCount: number;
  /** Keys restored and left out, by kind (keyKindOf). */
  kindCounts: Map<string, { restoredCount: number; skippedCount: number }>;
  /** The page after this one, or the ranges this one split into. */
  nextParts: RestorePart[];
}

/** A key's kind for restore_kind_counts: a game file's area (zaisma-games/logs), or the kind of backup (zaisma-saves, game-databases). */
export const keyKindOf = (backupKey: string) => (backupKey.startsWith("zaisma-games/") ? backupKey.split("/").slice(0, 2).join("/") : backupKey.split("/")[0]!);

/** Counts a finished part, and the part it queues, in one write; answers whether that finished the restore. */
async function finishPart(env: Env, restoreId: string, partResult: RestorePartResult, failureMessage: string | null): Promise<boolean> {
  const [, finished] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE restore_runs SET finished_part_count = finished_part_count + 1, queued_part_count = queued_part_count + ?, restored_object_count = restored_object_count + ?, restored_size_bytes = restored_size_bytes + ?, skipped_object_count = skipped_object_count + ?, failure_message = COALESCE(failure_message, ?) WHERE id = ?",
    ).bind(partResult.nextParts.length, partResult.restoredObjectCount, partResult.restoredSizeBytes, partResult.skippedObjectCount, failureMessage, restoreId),
    env.DB.prepare("UPDATE restore_runs SET finished_at_ms = ? WHERE id = ? AND finished_at_ms IS NULL AND finished_part_count >= queued_part_count").bind(Date.now(), restoreId),
    ...[...partResult.kindCounts].map(([keyKind, counts]) =>
      env.DB.prepare(
        "INSERT INTO restore_kind_counts (restore_id, key_kind, restored_count, skipped_count) VALUES (?, ?, ?, ?) ON CONFLICT (restore_id, key_kind) DO UPDATE SET restored_count = restored_count + excluded.restored_count, skipped_count = skipped_count + excluded.skipped_count",
      ).bind(restoreId, keyKind, counts.restoredCount, counts.skippedCount),
    ),
  ]);
  return Boolean(finished!.meta.changes);
}

/**
 * One page of a restore: each key's newest version before the cutoff, put back when its owner is in the
 * restored database. A range's first page that isn't its last splits the range instead, so its pieces run side by side.
 */
export async function restorePart(env: Env, part: RestorePart, run: Pick<RestoreRun, "cutoff_at_ms">, wait?: BackupWait, listedVersionCount: number = RESTORE_LIMITS.listedVersionCount): Promise<RestorePartResult> {
  const storage = new BackupStorage(restoreStorageSettings(env), wait);
  const listed = await storage.listVersionPage(part.prefix, part.after_key ?? (part.range_start_key === part.prefix ? null : part.range_start_key), listedVersionCount);
  // The range ends at before_key: keys from there on are another range's.
  const isInRange = (key: string) => part.before_key === null || key < part.before_key;
  const page = { versions: listed.versions.filter((version) => isInRange(version.key)), nextAfterKey: listed.nextAfterKey !== null && isInRange(listed.nextAfterKey) && listed.versions.every((version) => isInRange(version.key)) ? listed.nextAfterKey : null };
  const isFirstPage = part.after_key === null || part.after_key === part.range_start_key;
  // A range too narrow to split (its first split point is already past its end) goes on page by page.
  const splitParts = isFirstPage && page.nextAfterKey !== null && part.split_level < RESTORE_LIMITS.maximumSplitLevel ? splitRange(part) : [];
  if (splitParts.length > 1) return { restoredObjectCount: 0, restoredSizeBytes: 0, skippedObjectCount: 0, kindCounts: new Map(), nextParts: splitParts };
  // Versions come newest first for each key: the first before the cutoff is the one, unless it's Backblaze hiding a key Zaisma stopped copying.
  const chosen = new Map<string, BackupObjectVersion | null>();
  for (const version of page.versions) if (!chosen.has(version.key) && version.lastModifiedAtMs < run.cutoff_at_ms) chosen.set(version.key, version.isHidden ? null : version);
  const keys = [...new Set(page.versions.map((version) => version.key))];
  const candidates = keys.map((key) => ({ key, version: chosen.get(key) ?? null, rule: restoreRuleOf(key) }));
  const owned = candidates.filter((candidate): candidate is typeof candidate & { rule: Extract<RestoreRule, { kind: "owned" }> } => candidate.version !== null && candidate.rule.kind === "owned");
  const ownerRows = owned.length ? await env.DB.batch(owned.map((candidate) => env.DB.prepare(candidate.rule.ownerSql).bind(...candidate.rule.ownerValues))) : [];
  const ownerOf = new Map(owned.map((candidate, index) => [candidate.key, (ownerRows[index]!.results[0] as OwnerRow | undefined) ?? null]));
  const due = candidates.filter((candidate) => candidate.version !== null && (candidate.rule.kind === "always" || (candidate.rule.kind === "owned" && ownerOf.get(candidate.key))));
  let restoredObjectCount = 0;
  let restoredSizeBytes = 0;
  let stoppedAfterKey: string | null = null;
  const restoredKeys = new Set<string>();
  for (let index = 0; index < due.length; index += RESTORE_LIMITS.copyConcurrency) {
    const group = due.slice(index, index + RESTORE_LIMITS.copyConcurrency);
    const sizes = await Promise.all(group.map((candidate) => restoreKey(env, storage, candidate.key, candidate.version!, candidate.rule, ownerOf.get(candidate.key) ?? null, run)));
    group.forEach((candidate, groupIndex) => sizes[groupIndex] !== null && restoredKeys.add(candidate.key));
    restoredObjectCount += sizes.filter((sizeBytes) => sizeBytes !== null).length;
    restoredSizeBytes += sizes.reduce<number>((totalSizeBytes, sizeBytes) => totalSizeBytes + (sizeBytes ?? 0), 0);
    if (index + RESTORE_LIMITS.copyConcurrency < due.length && restoredSizeBytes >= RESTORE_LIMITS.partCopySizeBytes) {
      stoppedAfterKey = group.at(-1)!.key;
      break;
    }
  }
  const handledKeys = stoppedAfterKey === null ? keys : keys.filter((key) => key <= stoppedAfterKey!);
  const skippedObjectCount = handledKeys.length - restoredObjectCount;
  const kindCounts = new Map<string, { restoredCount: number; skippedCount: number }>();
  for (const key of handledKeys) {
    const counts = kindCounts.get(keyKindOf(key)) ?? { restoredCount: 0, skippedCount: 0 };
    if (restoredKeys.has(key)) counts.restoredCount++;
    else counts.skippedCount++;
    kindCounts.set(keyKindOf(key), counts);
  }
  const nextAfterKey = stoppedAfterKey ?? page.nextAfterKey;
  return { restoredObjectCount, restoredSizeBytes, skippedObjectCount, kindCounts, nextParts: nextAfterKey ? [{ ...part, after_key: nextAfterKey }] : [] };
}

interface OwnerRow {
  has_owner: number;
  content_type?: string | null;
  version_number?: number | null;
}

/** Puts one key back where it lives: R2, a game's database or a kept room. Answers its size, or null when there was nothing to put back. */
async function restoreKey(env: Env, storage: BackupStorage, backupKey: string, version: BackupObjectVersion, rule: RestoreRule, owner: OwnerRow | null, run: Pick<RestoreRun, "cutoff_at_ms">): Promise<number | null> {
  const [kind = "", ...rest] = backupKey.split("/");
  const key = rest.join("/");
  const object = await storage.getObject(backupKey, version.versionId);
  if (kind === "zaisma-games" || kind === "zaisma-saves") {
    const bucket = kind === "zaisma-games" ? env.GAMES : env.SAVES;
    // A copy from before the backup kept metadata: the type from its owner or its name, and a save's number from its row.
    // Backblaze answers a default type for a copy sent without one.
    const isDefaultType = !object.contentType || ["application/octet-stream", "binary/octet-stream"].includes(object.contentType);
    const contentType = isDefaultType ? (owner?.content_type ?? (rule.kind === "never" ? undefined : rule.contentType)) : object.contentType;
    const customMetadata = object.customMetadata ?? (owner?.version_number != null ? { version_number: String(owner.version_number) } : undefined);
    const { readable, writable } = new FixedLengthStream(version.sizeBytes);
    const [, written] = await Promise.all([object.body.pipeTo(writable), bucket.put(key, readable, { ...(contentType ? { httpMetadata: { contentType } } : {}), ...(customMetadata ? { customMetadata } : {}) })]);
    return written ? version.sizeBytes : null;
  }
  if (kind === "game-databases") {
    if (!env.GAME_DATABASES) throw new Error("The site has no GAME_DATABASES binding to restore games' databases through.");
    const gameId = key.slice(0, -".sql".length);
    await importGameDatabase(env, gameId, object.body);
    for (const playerId of await playersErasedSince(env.DB, gameId, run.cutoff_at_ms - RESTORE_LIMITS.erasedPlayerKeptDurationMs)) {
      const erased = await env.GAME_DATABASES.erasePlayer(gameId, playerId);
      if ("error" in erased) throw new Error(`${gameId}'s database didn't erase ${playerId} again: ${erased.error.message}`);
    }
    return version.sizeBytes;
  }
  // kept-rooms/<game_id>/<room_code>.jsonl: the room's object is named by the game's link name.
  const [gameId = "", fileName = ""] = key.split("/");
  const game = await env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(gameId).first<{ slug: string }>();
  if (!game || !env.GAME_STORAGE) {
    await object.body.cancel();
    return null;
  }
  await env.GAME_STORAGE.restoreKeptRoom(gameId, game.slug, fileName.slice(0, -".jsonl".length), object.body);
  return version.sizeBytes;
}

/** A game's dump into its database in parts of whole statements, read as it streams so a big database never sits whole in memory. */
async function importGameDatabase(env: Env, gameId: string, body: ReadableStream<Uint8Array>): Promise<void> {
  let isFirstPart = true;
  const send = async (dumpSql: string) => {
    if (!dumpSql.trim() && !isFirstPart) return;
    const imported = await env.GAME_DATABASES!.importBackup(gameId, dumpSql, isFirstPart);
    if ("error" in imported) throw new Error(`${gameId}'s database refused its backup: ${imported.error.message}`);
    isFirstPart = false;
  };
  const decoder = new TextDecoder();
  let held = "";
  for await (const chunk of body) {
    held += decoder.decode(chunk, { stream: true });
    if (held.length < RESTORE_LIMITS.databasePartSizeBytes) continue;
    // The last statement may be cut off mid-way: everything before it goes now.
    const statements = scanStatements(held);
    const lastStartIndex = statements.at(-1)?.startIndex ?? 0;
    await send(held.slice(0, lastStartIndex));
    held = held.slice(lastStartIndex);
  }
  await send(held + decoder.decode());
}

function restoreStorageSettings(env: Env): BackupStorageSettings {
  return { endpointUrl: env.BACKUP_ENDPOINT!, regionName: env.BACKUP_REGION!, bucketName: env.BACKUP_BUCKET_NAME!, keyId: env.RESTORE_KEY_ID!, keySecret: env.RESTORE_KEY_SECRET! };
}
