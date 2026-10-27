import { BackupStorage, type BackupStorageSettings, type BackupWait } from "./backup-storage.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { sendPush } from "./push.ts";

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
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKED_UP_BUCKET_NAMES = ["zaisma-games", "zaisma-saves"] as const;
type BackedUpBucketName = (typeof BACKED_UP_BUCKET_NAMES)[number];

/** One part of a night's copy, as a message on the zaisma-backup queue. */
export type BackupPart =
  | { run_date: string; part_kind: "main_database" }
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
}

/** What one part did: what it copied, and the part after it, if any. */
interface PartResult {
  copiedObjectCount: number;
  copiedSizeBytes: number;
  nextPart: BackupPart | null;
}

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
  const lastGood = await env.DB.prepare("SELECT started_at_ms FROM backup_runs WHERE finished_at_ms IS NOT NULL AND failure_message IS NULL ORDER BY started_at_ms DESC LIMIT 1").first<{ started_at_ms: number }>();
  const changedAfterMs = lastGood ? lastGood.started_at_ms - BACKUP_LIMITS.changeMarginMs : 0;
  const firstParts: BackupPart[] = [
    { run_date: runDate, part_kind: "main_database" },
    { run_date: runDate, part_kind: "game_databases", after_game_id: null },
    { run_date: runDate, part_kind: "kept_rooms", after_game_id: null, after_room_code: null },
    ...BACKED_UP_BUCKET_NAMES.map((bucketName): BackupPart => ({ run_date: runDate, part_kind: "bucket", bucket_name: bucketName, after_key: null })),
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
  const run = await env.DB.prepare("SELECT * FROM backup_runs WHERE run_date = ?").bind(part.run_date).first<BackupRun>();
  if (!run || run.finished_at_ms !== null) return message.ack();
  let partResult: PartResult;
  try {
    partResult = await backupPart(env, part, run, wait);
  } catch (error) {
    console.error("backup part failed", part, error);
    if (message.attempts < BACKUP_LIMITS.partTryCount) return message.retry({ delaySeconds: 60 * message.attempts });
    const failureMessage = `${partName(part)} failed ${message.attempts} times: ${error instanceof Error ? error.message : String(error)}`;
    await finishPart(env, part.run_date, { copiedObjectCount: 0, copiedSizeBytes: 0, nextPart: null }, failureMessage);
    await tellFailure(env, part.run_date);
    return message.ack();
  }
  await finishPart(env, part.run_date, partResult, null);
  if (partResult.nextPart) await env.BACKUP_QUEUE!.send(partResult.nextPart);
  message.ack();
}

/**
 * Counts a finished part, and the part it queues, in one write, so the night can't look finished between
 * them; the night finishes when every queued part has.
 */
async function finishPart(env: Env, runDate: string, partResult: PartResult, failureMessage: string | null): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE backup_runs SET finished_part_count = finished_part_count + 1, queued_part_count = queued_part_count + ?, copied_object_count = copied_object_count + ?, copied_size_bytes = copied_size_bytes + ?, failure_message = COALESCE(failure_message, ?) WHERE run_date = ?").bind(
      partResult.nextPart ? 1 : 0,
      partResult.copiedObjectCount,
      partResult.copiedSizeBytes,
      failureMessage,
      runDate,
    ),
    env.DB.prepare("UPDATE backup_runs SET finished_at_ms = ? WHERE run_date = ? AND finished_at_ms IS NULL AND finished_part_count >= queued_part_count").bind(Date.now(), runDate),
  ]);
}

function partName(part: BackupPart): string {
  if (part.part_kind === "main_database") return "The main database";
  if (part.part_kind === "game_databases") return `Games' databases after ${part.after_game_id ?? "the start"}`;
  if (part.part_kind === "kept_rooms") return `Kept rooms after ${part.after_game_id ? `${part.after_game_id}/${part.after_room_code}` : "the start"}`;
  return `${part.bucket_name} after ${part.after_key ?? "the start"}`;
}

/** One part of a night's copy: what it copied and the part after it. */
export async function backupPart(env: Env, part: BackupPart, run: Pick<BackupRun, "started_at_ms" | "changed_after_ms">, wait?: BackupWait): Promise<PartResult> {
  const storage = new BackupStorage(backupStorageSettings(env), wait);
  const isDue = (key: string, changedAtMs: number) => changedAtMs > run.changed_after_ms || isRefreshDue(key, run);
  if (part.part_kind === "main_database") {
    const copiedSizeBytes = await storage.uploadObject("main-database.sql", encodedLines(mainDatabaseDump(env.DB)));
    await checkOldVersions(env, storage, run.started_at_ms);
    return { copiedObjectCount: 1, copiedSizeBytes, nextPart: null };
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
    const due = results.filter((row) => row.has_database === 1 && (row.is_changed === 1 || isRefreshDue(`game-databases/${row.game_id}.sql`, run)));
    const copied = await copyInTurn(due, async (row) => (env.GAME_DATABASES ? storage.uploadObject(`game-databases/${row.game_id}.sql`, encodedLines(gameDatabaseDump(env, row.game_id))) : 0));
    const lastGameId = copied.stoppedAfter?.game_id ?? (results.length === BACKUP_LIMITS.pageGameCount ? results.at(-1)!.game_id : null);
    return { ...copied, nextPart: lastGameId ? { ...part, after_game_id: lastGameId } : null };
  }
  if (part.part_kind === "kept_rooms") {
    const { results } = await env.DB.prepare(
      "SELECT kept_rooms.game_id, kept_rooms.room_code, kept_rooms.saved_at_ms, games.slug FROM kept_rooms JOIN games ON games.id = kept_rooms.game_id " +
        "WHERE (kept_rooms.game_id, kept_rooms.room_code) > (?, ?) ORDER BY kept_rooms.game_id, kept_rooms.room_code LIMIT ?",
    )
      .bind(part.after_game_id ?? "", part.after_room_code ?? "", BACKUP_LIMITS.pageKeptRoomCount)
      .all<{ game_id: string; room_code: string; saved_at_ms: number | null; slug: string }>();
    const keyOf = (row: { game_id: string; room_code: string }) => `kept-rooms/${row.game_id}/${row.room_code}.jsonl`;
    const due = results.filter((row) => isDue(keyOf(row), row.saved_at_ms ?? 0));
    const copied = await copyInTurn(due, async (row) => {
      const world = await env.GAME_STORAGE?.keptRoomBackup(row.game_id, row.slug, row.room_code);
      return world ? storage.uploadObject(keyOf(row), world) : 0;
    });
    const last = copied.stoppedAfter ?? (results.length === BACKUP_LIMITS.pageKeptRoomCount ? results.at(-1)! : null);
    return { ...copied, nextPart: last ? { ...part, after_game_id: last.game_id, after_room_code: last.room_code } : null };
  }
  const bucket = part.bucket_name === "zaisma-games" ? env.GAMES : env.SAVES;
  const listed = await bucket.list({ limit: BACKUP_LIMITS.listedObjectCount, ...(part.after_key ? { startAfter: part.after_key } : {}) });
  // Brotli copies of game files are made again from the files after a restore.
  const objects = listed.objects.filter((object) => !(part.bucket_name === "zaisma-games" && object.key.startsWith("brotli/")));
  const due = objects.filter((object) => isDue(`${part.bucket_name}/${object.key}`, object.uploaded.getTime()));
  const copied = await copyInTurn(due, async (listedObject) => {
    const object = await bucket.get(listedObject.key);
    // Deleted since it was listed: nothing to keep. Its content type and custom metadata go with it, for a restore.
    return object ? storage.uploadObject(`${part.bucket_name}/${listedObject.key}`, object.body, { contentType: object.httpMetadata?.contentType, customMetadata: object.customMetadata }) : 0;
  });
  const lastKey = copied.stoppedAfter?.key ?? (listed.truncated ? listed.objects.at(-1)!.key : null);
  return { ...copied, nextPart: lastKey ? { ...part, after_key: lastKey } : null };
}

/**
 * Copies the items a few at a time, in order, until a part's worth is copied: then it stops after a
 * whole group and says the last item it copied, where the next part goes on.
 */
async function copyInTurn<Item>(items: Item[], copy: (copied: Item) => Promise<number>): Promise<{ copiedObjectCount: number; copiedSizeBytes: number; stoppedAfter: Item | null }> {
  let copiedObjectCount = 0;
  let copiedSizeBytes = 0;
  for (let index = 0; index < items.length; index += BACKUP_LIMITS.copyConcurrency) {
    const group = items.slice(index, index + BACKUP_LIMITS.copyConcurrency);
    const sizes = await Promise.all(group.map(copy));
    copiedObjectCount += sizes.filter((sizeBytes) => sizeBytes > 0).length;
    copiedSizeBytes += sizes.reduce((totalSizeBytes, sizeBytes) => totalSizeBytes + sizeBytes, 0);
    const isLast = index + BACKUP_LIMITS.copyConcurrency >= items.length;
    if (!isLast && copiedSizeBytes >= BACKUP_LIMITS.partCopySizeBytes) return { copiedObjectCount, copiedSizeBytes, stoppedAfter: group.at(-1)! };
  }
  return { copiedObjectCount, copiedSizeBytes, stoppedAfter: null };
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

async function* encodedLines(lines: AsyncIterable<string>): AsyncGenerator<Uint8Array> {
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
