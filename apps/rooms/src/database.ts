import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { DATABASE_LIMITS, DatabaseError, DumpCursorError, quoteName, TABLE_COLUMNS_SQL, answerDatabase, type DatabaseErrorCode, checkBatch, checkPlayerId, checkStatement, dumpPart, eraseRefused, eraseStatements, importStatements, integerTooLarge, plainRow, scanStatements, preview, readDatabaseAnswer, tablesFromColumns, tooManyRows, type DatabaseAnswer, type DatabaseRow, type DatabaseValue, type DumpPart, type ErasedTable, type GameDatabase } from "@zaisma/game-server/internal";
import { HOSTING_PAUSED_TEXT, MATCH_FINISH_DURATION_SEC, MAXIMUM_GAME_STORAGE_SIZE_BYTES, keptRoomsSizeBytes, nextMonthStartDate, recordPlayerErased, usageMonth } from "@zaisma/core";
import type { Env } from "./index.ts";
import { AwakeTime } from "./usage-counts.ts";

/** Rows read and written in a month, the way Cloudflare bills them. */
export interface Usage {
  month: string;
  readRowCount: number;
  writtenRowCount: number;
}

/** Rows read and written since they were last added to room_usage for the hosting meter, and on which day (UTC). */
interface UnrecordedUse {
  date: string;
  readRowCount: number;
  writtenRowCount: number;
  /** Calls the game made to it, and the time it was awake in ms (AwakeTime); missing in use saved before them. */
  callCount?: number;
  awakeDurationMs?: number;
}

/**
 * When the game's hosting paused this month, as the site's hosting job last said (setHostingPause): reads and
 * writes stop MATCH_FINISH_DURATION_SEC after it, so a running match's last save still lands. A new month clears it.
 */
interface HostingPause {
  month: string;
  pausedAtMs: number;
}

/** A game server's erase whose record in D1 failed, held until the next recordUse. */
interface HeldErase {
  playerId: string;
  erasedAtMs: number;
}

/** The most erases held: a player's ID is about 30 bytes and a key-value value holds 128 KB. */
const MAXIMUM_HELD_ERASE_COUNT = 1000;

/** One statement's rows, and the rows it read and wrote, as the developer API shows them. */
export interface StatementResult {
  rows: DatabaseRow[];
  readRowCount: number;
  writtenRowCount: number;
}

/** What the developer API gets back: a DatabaseError's codes, and answer_too_big, bad_cursor and database_restore_unavailable, which only it has. */
export type DeveloperDatabaseAnswer<T> = { queryResult: T } | { error: { code: DatabaseErrorCode | "answer_too_big" | "bad_cursor" | "database_restore_unavailable"; message: string; fix: string } };

/** Where a restore goes: a moment, or the bookmark an earlier restore's undo kept. */
export type RestoreTarget = { restoreToAtMs: number } | { bookmark: string };

/** Cloudflare's point-in-time recovery for one object's storage. */
export interface PointInTime {
  bookmarkForTime(atMs: number): Promise<string>;
  /** Restores to the bookmark when the object next starts; answers the bookmark for the moment just before, to undo it. */
  restoreOnNextStart(bookmark: string): Promise<string>;
}

/** A restore set for the next start: the bookmark that undoes it, and the use and hosting pause to carry over it. */
export interface PreparedRestore {
  undoBookmark: string;
  usage: Usage;
  hostingPause: HostingPause | null;
}

/** What a part of an import did. */
export interface ImportResult {
  statementCount: number;
  skippedStatementCount: number;
  readRowCount: number;
  writtenRowCount: number;
}

/** What the developer API shows of a database: its tables and indexes as SQLite keeps them, and this month's use. */
export interface DatabaseOverview {
  tables: { name: string; sql: string }[];
  indexes: { name: string; tableName: string; sql: string }[];
  usage: Usage & { storageSizeBytes: number };
}

/**
 * The most an answer to the developer API may hold, about, in bytes: well under what one call between
 * Workers carries, with room for base64. Game servers get their rows straight, so this is the API's alone.
 */
const MAXIMUM_DEVELOPER_ANSWER_SIZE_BYTES = 8 * 1024 * 1024;

/** An answer past MAXIMUM_DEVELOPER_ANSWER_SIZE_BYTES; the transaction undoes itself. */
class AnswerTooBig extends Error {}

/** Usage is kept at most this long, or this many statements, before it's saved: not one extra write per query. */
const USAGE_SAVE_MS = 60_000;
const USAGE_SAVE_STATEMENT_COUNT = 500;
/** Rows read and written, and the storage's size, go to room_usage for the hosting meter at most this often while the database is used. */
const RECORD_DELAY_MS = 60_000;
/** The game's kept rooms' size, which counts with the database's storage, is read from D1 at most this often: not once per write. */
const KEPT_ROOMS_READ_MS = 10 * 60_000;

/** The game's kept rooms' saved size as last read, and when. */
interface KeptRoomsSize {
  sizeBytes: number;
  readAtMs: number;
}

/**
 * One game's database: a SQLite-backed Durable Object of its own, named by the game's ID, used by
 * all its rooms (room.database) and kept between matches. Every statement is checked the same way
 * the Node runner checks it (checkStatement), and runs in a transaction, so a batch is all or
 * nothing and a statement past the most storage a game can have undoes itself. Its rows and storage
 * count on the game's hosting meter (hosting.ts): it adds them to room_usage about once a minute, and
 * stops reading and writing an hour after the site says the game's hosting paused. Cloudflare keeps its
 * own tables (_cf_…) out of the developer's reach; ours are only the usage and the pause, in the object's
 * key-value storage.
 */
export class GameDatabaseObject extends DurableObject<Env> {
  private usage: Usage;
  private unrecordedUse: UnrecordedUse | null;
  private hostingPause: HostingPause | null;
  /** Players a game server erased whose record in D1 failed, sent with the next recordUse: the erase never fails, and a restore must erase them again. */
  private heldErases: HeldErase[];
  /**
   * When the use was last added to room_usage, or the object started. In memory only, and no alarm, which would add
   * a table of Cloudflare's (_cf_…) the developer's own SQL sees: use waiting is added at the next statement or read of it.
   */
  private recordedAtMs = Date.now();
  private unsavedStatementCount = 0;
  private savedAtMs = Date.now();
  /** A restore is set for the next start: nothing more runs on what's about to be replaced. */
  private isRestarting = false;
  /** The game's kept rooms' size (kept_rooms), in memory only: storing it would add a table the developer sees. */
  private keptRooms: KeptRoomsSize = { sizeBytes: 0, readAtMs: 0 };
  private isReadingKeptRooms = false;
  /** Its awake time as Cloudflare bills it, for the hosting meter. */
  private readonly awake = new AwakeTime();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const usage = ctx.storage.kv.get<Usage>("usage") ?? { month: usageMonth(), readRowCount: 0, writtenRowCount: 0 };
    this.usage = { month: usage.month, readRowCount: usage.readRowCount, writtenRowCount: usage.writtenRowCount };
    this.unrecordedUse = ctx.storage.kv.get<UnrecordedUse>("unrecorded_use") ?? null;
    this.hostingPause = ctx.storage.kv.get<HostingPause>("hosting_pause") ?? null;
    this.heldErases = ctx.storage.kv.get<HeldErase[]>("held_erases") ?? [];
  }

  /**
   * The game's kept rooms' size, which counts with the database's storage: the last read,
   * read again in the background once it's KEPT_ROOMS_READ_MS old, so a statement never waits for D1.
   */
  private keptRoomsSizeBytes(): number {
    const gameId = this.ctx.id.name;
    if (gameId && !this.isReadingKeptRooms && Date.now() - this.keptRooms.readAtMs >= KEPT_ROOMS_READ_MS) {
      this.isReadingKeptRooms = true;
      this.ctx.waitUntil(
        keptRoomsSizeBytes(this.env.DB, gameId)
          .then((sizeBytes) => {
            this.keptRooms = { sizeBytes, readAtMs: Date.now() };
          })
          .catch((error) => console.error("Couldn't read the game's kept rooms' size:", error))
          .finally(() => (this.isReadingKeptRooms = false)),
      );
    }
    return this.keptRooms.sizeBytes;
  }

  query(sql: unknown, values: unknown): DatabaseAnswer<DatabaseRow[]> {
    return answerDatabase(() => this.run([checkStatement(sql, values)])[0]!.rows);
  }

  batch(statements: unknown): DatabaseAnswer<DatabaseRow[][]> {
    return answerDatabase(() => this.run(checkBatch(statements)).map((statementResult) => statementResult.rows));
  }

  erasePlayer(playerId: unknown): DatabaseAnswer<ErasedTable[]> {
    return answerDatabase(() => this.erase(playerId).erasedTables);
  }

  /** Everything: the developer's tables and the usage, for a game being deleted (GameStorageService). */
  async deleteStorage(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.usage = { month: usageMonth(), readRowCount: 0, writtenRowCount: 0 };
    this.unrecordedUse = null;
    this.hostingPause = null;
    this.heldErases = [];
    this.unsavedStatementCount = 0;
  }

  /**
   * The site's hosting job says when the game's hosting paused this month, or null when it runs again (a top-up, a
   * higher budget). Reads and writes stop MATCH_FINISH_DURATION_SEC after the pause, with the game's rooms.
   */
  setHostingPause(pausedAtMs: number | null): void {
    this.hostingPause = pausedAtMs === null ? null : { month: usageMonth(pausedAtMs), pausedAtMs };
    if (this.hostingPause) this.ctx.storage.kv.put("hosting_pause", this.hostingPause);
    else this.ctx.storage.kv.delete("hosting_pause");
  }


  /** A game server's erase whose record in D1 failed: held here, and sent with the next recordUse. */
  holdErase(playerId: string, erasedAtMs: number): void {
    // The most a hold keeps (a few thousand IDs would pass the most a value holds); the oldest go first, with a note in the logs.
    this.heldErases = [...this.heldErases.filter((held) => held.playerId !== playerId), { playerId, erasedAtMs }].slice(-MAXIMUM_HELD_ERASE_COUNT);
    this.ctx.storage.kv.put("held_erases", this.heldErases);
  }

  /** erasePlayer() for the developer API and for deleted accounts, with the rows it wrote. */
  erasePlayerForDeveloper(playerId: unknown): DeveloperDatabaseAnswer<{ erasedTables: ErasedTable[]; writtenRowCount: number }> {
    return answerDatabase(() => this.erase(playerId));
  }

  /** query() for the developer API: the same checks, limits and use, plus what the statement read and wrote. */
  queryForDeveloper(sql: unknown, values: unknown): DeveloperDatabaseAnswer<StatementResult> {
    return answerForDeveloper(() => this.run([checkStatement(sql, values)], MAXIMUM_DEVELOPER_ANSWER_SIZE_BYTES)[0]!);
  }

  /** batch() for the developer API. */
  batchForDeveloper(statements: unknown): DeveloperDatabaseAnswer<StatementResult[]> {
    return answerForDeveloper(() => this.run(checkBatch(statements), MAXIMUM_DEVELOPER_ANSWER_SIZE_BYTES));
  }

  /**
   * One part of the database's dump, from where cursor says (null for the start): SQLite's own SQL,
   * up to 4 MB a part. Its reads count towards the month's use, but it works while the game's hosting is
   * paused: the data is always the developer's to take. One part runs in one go, so it's whole; between parts the game can write.
   */
  exportForDeveloper(cursor: string | null): DeveloperDatabaseAnswer<DumpPart> {
    return this.exportPart(cursor, true);
  }

  /** The same part for Zaisma's nightly backup (apps/site/src/backups.ts): Zaisma's own reads, never on the game's meter. */
  exportForBackup(cursor: string | null): DeveloperDatabaseAnswer<DumpPart> {
    return this.exportPart(cursor, false);
  }

  private exportPart(cursor: string | null, isUsageCounted: boolean): DeveloperDatabaseAnswer<DumpPart> {
    if (this.isRestarting) return answerDatabase(() => {
      throw restarting();
    });
    this.newMonth();
    const sql = this.ctx.storage.sql;
    let statementCount = 0;
    let readRowCount = 0;
    try {
      const part = dumpPart((statementSql, values) => {
        statementCount++;
        const cursor = sql.exec(statementSql, ...values.map((boundValue) => (boundValue instanceof Uint8Array ? boundValue.slice().buffer : boundValue)));
        const rows = cursor.toArray().map(plainRow);
        readRowCount += cursor.rowsRead;
        return { rows, readRowCount: cursor.rowsRead };
      }, cursor);
      return { queryResult: part };
    } catch (error) {
      if (error instanceof DumpCursorError) return { error: { code: "bad_cursor", message: error.message, fix: "Give the next_cursor the last part answered, or leave cursor out to start the export again." } };
      return answerDatabase(() => {
        throw error;
      });
    } finally {
      if (isUsageCounted) this.addUsage(readRowCount, 0, statementCount);
    }
  }

  /**
   * One part of a dump in: its CREATE and INSERT statements, in one transaction, with the same checks,
   * limits and use as any statement. The part is all or nothing; the parts before it stay in.
   */
  importForDeveloper(dumpSql: string): DeveloperDatabaseAnswer<ImportResult> {
    return answerDatabase(() => {
      const plan = importStatements(dumpSql);
      const checked = plan.statements.map((statement) => {
        try {
          return checkStatement(statement.sql, statement.values, DATABASE_LIMITS.maximumImportValueSizeBytes);
        } catch (error) {
          if (error instanceof DatabaseError) throw new DatabaseError(error.code, `Statement ${statement.statementNumber} of the dump (${preview(statement.sql)}): ${error.message.slice(0, -` ${error.fix} (${error.code})`.length)}`, error.fix);
          throw error;
        }
      });
      // Foreign keys are checked when the part commits, so a row can refer to one that comes after it in the part.
      const statementResults = this.importRun([{ sql: "PRAGMA defer_foreign_keys = ON", values: [] }, ...checked], (i, error) => {
        const statement = plan.statements[i - 1] ?? { statementNumber: 0, sql: "PRAGMA defer_foreign_keys = ON" };
        const sqliteMessage = String(error instanceof Error ? error.message : error).replace(/^Error: /, "").slice(0, 300);
        const fix = /already exists/.test(sqliteMessage)
          ? "Import adds to what's there and never replaces it. Drop or rename that first with query_database (like DROP TABLE scores), or leave its CREATE out, then send this part again. Parts before it stay imported; this one was undone."
          : "Fix that statement and send this part again: it was undone, and the parts before it stay imported.";
        return new DatabaseError("bad_sql", `Statement ${statement.statementNumber} of the dump (${preview(statement.sql)}) failed: SQLite: ${sqliteMessage}`, fix);
      });
      return {
        statementCount: plan.statementCount,
        skippedStatementCount: plan.skippedStatementCount,
        readRowCount: statementResults.reduce((rowCount, statementResult) => rowCount + statementResult.readRowCount, 0),
        writtenRowCount: statementResults.reduce((rowCount, statementResult) => rowCount + statementResult.writtenRowCount, 0),
      };
    });
  }

  /** run() for an import's part, whose first statement defers foreign keys: a reference that crosses parts fails at commit, and says so. */
  private importRun(statements: { sql: string; values: DatabaseValue[] }[], failure: (i: number, error: unknown) => DatabaseError): StatementResult[] {
    try {
      return this.run(statements, Infinity, failure);
    } catch (error) {
      if (!(error instanceof DatabaseError) && /FOREIGN KEY constraint failed/i.test(String(error instanceof Error ? error.message : error))) {
        throw new DatabaseError(FOREIGN_KEY_ACROSS_PARTS.code, FOREIGN_KEY_ACROSS_PARTS.message, FOREIGN_KEY_ACROSS_PARTS.fix);
      }
      throw error;
    }
  }

  /**
   * One part of a backup's dump in, for a restore from Zaisma's backups (apps/site/src/restore.ts): the
   * same statements an import takes, in one transaction, but Zaisma's own writes: never on the game's
   * meter, its free writes or its hosting pause, and never refused for size, since the game had it all before.
   * The first part clears what an earlier try of the same restore left half done: a restore only runs in an
   * account set up for it, where nothing else has written to a game's database.
   */
  importForBackup(dumpSql: string, isFirstPart: boolean): DeveloperDatabaseAnswer<{ statementCount: number }> {
    return answerDatabase(() => {
      if (this.isRestarting) throw restarting();
      const plan = importStatements(dumpSql);
      const sql = this.ctx.storage.sql;
      this.ctx.storage.transactionSync(() => {
        if (isFirstPart) {
          const schemaRows = sql.exec<{ type: string; name: string }>("SELECT type, name FROM sqlite_schema WHERE type IN ('table', 'view') AND substr(name, 1, 4) <> '_cf_' AND substr(name, 1, 7) <> 'sqlite_'").toArray();
          for (const schemaRow of schemaRows) sql.exec(`DROP ${schemaRow.type === "view" ? "VIEW" : "TABLE"} IF EXISTS ${quoteName(schemaRow.name)}`);
        }
        // As an import's part does: a row can refer to one that comes after it in the part.
        sql.exec("PRAGMA defer_foreign_keys = ON");
        for (const statement of plan.statements) sql.exec(statement.sql, ...statement.values.map((boundValue) => (boundValue instanceof Uint8Array ? boundValue.slice().buffer : boundValue))).toArray();
      });
      return { statementCount: plan.statements.length };
    });
  }

  /**
   * The tables and indexes, from SQLite's own list, without Cloudflare's (_cf_…) or SQLite's (sqlite_…).
   * Reading the list counts towards the month's use like any read, but works while the game's hosting is
   * paused, so the developer can always see what's there. No row counts: counting reads every row.
   */
  overview(): DatabaseOverview {
    if (this.isRestarting) throw restarting();
    const cursor = this.ctx.storage.sql.exec<{ type: string; name: string; tbl_name: string; sql: string }>(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE type IN ('table', 'index') AND sql IS NOT NULL AND substr(name, 1, 4) <> '_cf_' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name",
    );
    const schemaRows = cursor.toArray();
    this.addUsage(cursor.rowsRead, 0, 1);
    return {
      tables: schemaRows.filter((schemaRow) => schemaRow.type === "table").map((schemaRow) => ({ name: schemaRow.name, sql: schemaRow.sql })),
      indexes: schemaRows.filter((schemaRow) => schemaRow.type === "index").map((schemaRow) => ({ name: schemaRow.name, tableName: schemaRow.tbl_name, sql: schemaRow.sql })),
      usage: this.usageThisMonth(),
    };
  }

  /** This month's use. */
  usageThisMonth(): Usage & { storageSizeBytes: number } {
    if (this.isRestarting) throw restarting();
    this.newMonth();
    // The site reads this for the game's alerts: a quiet database's last minute reaches the meter then too.
    this.recordWhenDue();
    return { ...this.usage, storageSizeBytes: this.ctx.storage.sql.databaseSize };
  }

  /**
   * Erases one player: every row whose player_id column holds theirs, in every table that has one, in
   * one transaction (eraseStatements). It counts towards the month's use but works while the game's hosting
   * is paused: it only deletes, and erasing a player must never wait.
   */
  private erase(given: unknown): { erasedTables: ErasedTable[]; writtenRowCount: number } {
    if (this.isRestarting) throw restarting();
    const playerId = checkPlayerId(given);
    this.newMonth();
    const sql = this.ctx.storage.sql;
    let readRowCount = 0;
    let writtenRowCount = 0;
    let statementCount = 1;
    try {
      const columns = sql.exec<{ table_name: string; column_name: string }>(TABLE_COLUMNS_SQL);
      const tables = tablesFromColumns(columns.toArray());
      readRowCount += columns.rowsRead;
      const statements = eraseStatements(tables, playerId);
      statementCount += statements.length;
      const erasedTables = this.ctx.storage.transactionSync(() =>
        statements.map((statement) => {
          let cursor: SqlStorageCursor<Record<string, SqlStorageValue>>;
          try {
            cursor = sql.exec(statement.sql, ...statement.values);
            cursor.toArray();
          } catch (error) {
            throw eraseRefused(statement.tableName, error);
          }
          readRowCount += cursor.rowsRead;
          writtenRowCount += cursor.rowsWritten;
          // rowsWritten also counts index entries, so the rows themselves come from SQLite's changes().
          const erasedRowCount = sql.exec<{ erased_row_count: number }>("SELECT changes() AS erased_row_count").one().erased_row_count;
          return { tableName: statement.tableName, erasedRowCount };
        }),
      );
      return { erasedTables, writtenRowCount };
    } finally {
      this.addUsage(readRowCount, writtenRowCount, statementCount);
    }
  }

  /** Runs statements in one transaction. failure, when given, turns SQLite's error for the i-th statement into the error to answer. */
  private run(statements: { sql: string; values: DatabaseValue[] }[], maximumAnswerSizeBytes = Infinity, failure?: (i: number, error: unknown) => DatabaseError): StatementResult[] {
    if (this.isRestarting) throw restarting();
    this.newMonth();
    // The game's hosting paused: running matches get their hour, and their last saves land in it.
    if (this.hostingPause && this.hostingPause.month === this.usage.month && Date.now() >= this.hostingPause.pausedAtMs + MATCH_FINISH_DURATION_SEC * 1000) {
      throw new DatabaseError("hosting_paused", HOSTING_PAUSED_TEXT, `It works again on ${nextMonthStartDate()} (UTC), or as soon as its developer adds credit or raises the game's budget. Exports, the table list and erasing a player keep working.`);
    }
    // Kept rooms' saved worlds share the storage with the database.
    const storageSizeBytes = MAXIMUM_GAME_STORAGE_SIZE_BYTES - this.keptRoomsSizeBytes();
    const sql = this.ctx.storage.sql;
    let readRowCount = 0;
    let writtenRowCount = 0;
    let answerSizeBytes = 0;
    try {
      return this.ctx.storage.transactionSync(() =>
        statements.map((statement, i) => {
          const sizeBeforeBytes = sql.databaseSize;
          let cursor: SqlStorageCursor<Record<string, SqlStorageValue>>;
          try {
            cursor = sql.exec(statement.sql, ...statement.values.map((boundValue) => (boundValue instanceof Uint8Array ? boundValue.slice().buffer : boundValue)));
          } catch (error) {
            throw failure ? failure(i, error) : error;
          }
          const rows: DatabaseRow[] = [];
          try {
            for (const row of cursor) {
              if (rows.length >= DATABASE_LIMITS.maximumRowCount) throw tooManyRows();
              const plain = plainRow(row);
              answerSizeBytes += rowSizeBytes(plain);
              if (answerSizeBytes > maximumAnswerSizeBytes) throw new AnswerTooBig();
              rows.push(plain);
            }
            // The cursor gives a 64-bit INTEGER as the nearest JavaScript number: one past 2^53 is refused, as the Node runner refuses it.
            readRowCount += this.checkIntegers(statement, cursor.columnNames, rows);
          } catch (error) {
            // SQLite can also fail while stepping through, like a UNIQUE constraint on an INSERT.
            throw failure && !(error instanceof DatabaseError) && !(error instanceof AnswerTooBig) ? failure(i, error) : error;
          } finally {
            readRowCount += cursor.rowsRead;
            writtenRowCount += cursor.rowsWritten;
          }
          // A full database can still change and delete rows, just not grow.
          if (sql.databaseSize > storageSizeBytes && sql.databaseSize > sizeBeforeBytes) {
            throw new DatabaseError("database_full", `This game's storage (its database and kept rooms) would be over the ${MAXIMUM_GAME_STORAGE_SIZE_BYTES / 1024 ** 3} GB a game can have, so this statement was undone.`, "Reads, changes and deletes still work. Delete rows you no longer need (old matches, players who left long ago), or kept rooms nobody plays (zaisma kept-rooms), to make room.");
          }
          return { rows, readRowCount: cursor.rowsRead, writtenRowCount: cursor.rowsWritten };
        }),
      );
    } finally {
      this.addUsage(readRowCount, writtenRowCount, statements.length);
    }
  }

  /**
   * Throws integer_too_large for a whole number past 2^53 in rows. The Durable Object's cursor gives a REAL (1e20) and a
   * 64-bit INTEGER the same way, so for a SELECT it asks SQLite's typeof which is which; a statement that isn't one
   * (an INSERT … RETURNING) can't be asked again, and is refused. Answers the rows that took to read.
   */
  private checkIntegers(statement: { sql: string; values: DatabaseValue[] }, columnNames: string[], rows: DatabaseRow[]): number {
    const unsafe = rows.map((row) => Object.entries(row).filter(([, columnValue]) => typeof columnValue === "number" && Number.isInteger(columnValue) && !Number.isSafeInteger(columnValue)).map(([column]) => column));
    if (unsafe.every((columns) => columns.length === 0)) return 0;
    const firstWord = scanStatements(statement.sql)[0]?.leadingWords[0] ?? "";
    const firstColumn = unsafe.flat()[0]!;
    if (firstWord !== "SELECT" && firstWord !== "WITH" && firstWord !== "VALUES") throw integerTooLarge(firstColumn);
    const checkedIndexes = [...new Set(unsafe.flat().map((column) => columnNames.indexOf(column)))];
    const checkSql = `WITH answered(${columnNames.map((_, index) => `c${index}`).join(", ")}) AS (${statement.sql}) SELECT ${checkedIndexes.map((index) => `typeof(c${index}) AS t${index}`).join(", ")} FROM answered`;
    const check = this.ctx.storage.sql.exec(checkSql, ...statement.values.map((boundValue) => (boundValue instanceof Uint8Array ? boundValue.slice().buffer : boundValue)));
    const types = check.toArray();
    if (types.length !== rows.length) throw integerTooLarge(firstColumn);
    unsafe.forEach((columns, rowIndex) => {
      for (const column of columns) if (types[rowIndex]![`t${columnNames.indexOf(column)}`] !== "real") throw integerTooLarge(column);
    });
    return check.rowsRead;
  }

  /**
   * Sets the database to go back to a moment, or to an earlier restore's undo bookmark, when it next
   * starts (Cloudflare's point-in-time recovery, which keeps 30 days), and answers the bookmark that
   * undoes it and this month's use, which the restore would roll back with everything else. The caller
   * then restarts it (restart) and carries the use over (carryUsage). Until the restart, it answers nothing.
   */
  async prepareRestore(target: RestoreTarget): Promise<DeveloperDatabaseAnswer<PreparedRestore>> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.isRestarting) return answerDatabase((): never => {
        throw restarting();
      });
      // What's waiting for the hosting meter goes first: the restore would roll it back with everything else.
      await this.recordUse();
      const pointInTime = this.pointInTime();
      try {
        const bookmark = "bookmark" in target ? target.bookmark : await pointInTime.bookmarkForTime(target.restoreToAtMs);
        const undoBookmark = await pointInTime.restoreOnNextStart(bookmark);
        this.isRestarting = true;
        return { queryResult: { undoBookmark, usage: { ...this.usage }, hostingPause: this.hostingPause ? { ...this.hostingPause } : null } };
      } catch (error) {
        const cloudflareMessage = String(error instanceof Error ? error.message : error).slice(0, 300);
        if (/does not implement point-in-time recovery/.test(cloudflareMessage)) {
          return { error: { code: "database_restore_unavailable", message: "This Zaisma's game databases keep no history to go back to, like a local preview's.", fix: "On zaisma.com it works. Here, export_database before a risky change and import_database it back instead." } };
        }
        console.error("Game database restore refused:", error);
        return { error: { code: "database_unavailable", message: `The game's database couldn't go back: ${cloudflareMessage}`, fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers)." } };
      }
    });
  }

  /** Restarts the object, so a prepared restore happens. The call itself fails as the object goes. */
  restart(): void {
    this.ctx.abort("Restoring the game database to an earlier time");
  }

  /**
   * After a restore: this month's use as it was before, the larger of each count, since the restore
   * rolled the use back with everything else, and the hosting pause as it is now, since the restore brought back the one
   * the moment had (or none). Use waiting at that moment was added to room_usage before the restore (prepareRestore),
   * so the restored object's copy of it is dropped, or it would count twice.
   * The object going away still answers for a moment, and refuses, so the caller tries again until the restored one takes it.
   */
  carryUsage(carried: Usage, hostingPause: HostingPause | null = null): void {
    if (this.isRestarting) throw restarting();
    this.hostingPause = hostingPause;
    if (hostingPause) this.ctx.storage.kv.put("hosting_pause", hostingPause);
    else this.ctx.storage.kv.delete("hosting_pause");
    this.unrecordedUse = null;
    this.newMonth();
    if (carried.month === this.usage.month) {
      this.usage = {
        month: this.usage.month,
        readRowCount: Math.max(this.usage.readRowCount, carried.readRowCount),
        writtenRowCount: Math.max(this.usage.writtenRowCount, carried.writtenRowCount),
      };
    }
    this.save();
  }

  /**
   * A prepared restore the site couldn't keep a record of: the next start restores to the undo bookmark, the
   * state from before the restore was prepared (nothing has run since), instead. The caller restarts the object, as for a restore.
   */
  async abandonRestore(undoBookmark: string): Promise<void> {
    await this.pointInTime().restoreOnNextStart(undoBookmark);
  }

  /** Cloudflare's point-in-time recovery for this object's storage. Tests put a stand-in here: local storage has none. */
  protected pointInTime(): PointInTime {
    return {
      bookmarkForTime: (atMs) => this.ctx.storage.getBookmarkForTime(atMs),
      restoreOnNextStart: (bookmark) => this.ctx.storage.onNextSessionRestoreBookmark(bookmark),
    };
  }

  /** A new month starts from nothing. */
  private newMonth(): void {
    const month = usageMonth();
    if (this.usage.month === month) return;
    this.usage = { month, readRowCount: 0, writtenRowCount: 0 };
    this.save();
  }

  private addUsage(readRowCount: number, writtenRowCount: number, statementCount: number): void {
    this.usage.readRowCount += readRowCount;
    this.usage.writtenRowCount += writtenRowCount;
    this.unsavedStatementCount += statementCount;
    const date = new Date().toISOString().slice(0, 10);
    // Yesterday's use goes out under its own date first.
    if (this.unrecordedUse && this.unrecordedUse.date !== date) this.ctx.waitUntil(this.recordUse());
    const unrecorded = (this.unrecordedUse ??= { date, readRowCount: 0, writtenRowCount: 0, callCount: 0, awakeDurationMs: 0 });
    unrecorded.readRowCount += readRowCount;
    unrecorded.writtenRowCount += writtenRowCount;
    // Each call that counts its use is one call to the object, and a moment it's awake.
    unrecorded.callCount = (unrecorded.callCount ?? 0) + 1;
    unrecorded.awakeDurationMs = (unrecorded.awakeDurationMs ?? 0) + this.awake.note();
    this.recordWhenDue();
    // A restart can lose the last minute's counts; that's a little use off the meter, never a wrong pause.
    if (this.unsavedStatementCount >= USAGE_SAVE_STATEMENT_COUNT || Date.now() - this.savedAtMs >= USAGE_SAVE_MS) this.save();
  }

  /** Adds the use waiting to room_usage, in the background, once RECORD_DELAY_MS has passed since the last time. */
  private recordWhenDue(): void {
    if ((!this.unrecordedUse && this.heldErases.length === 0) || Date.now() - this.recordedAtMs < RECORD_DELAY_MS) return;
    this.recordedAtMs = Date.now();
    this.ctx.waitUntil(this.recordUse());
  }

  /**
   * Adds the rows read and written since the last time to the day's room_usage row, with the storage's size now
   * (its database and kept rooms), for the hosting meter. Never fails a statement: a write that fails is tried
   * again a minute later.
   */
  private async recordUse(): Promise<void> {
    // The object is reached by idFromName(gameId), so its name is the game's ID.
    const gameId = this.ctx.id.name;
    if (!gameId) return;
    // The use goes first, and its first step runs before any await: the size it records is the size now.
    await this.recordRows(gameId);
    await this.recordHeldErases(gameId);
  }

  private async recordRows(gameId: string): Promise<void> {
    const unrecorded = this.unrecordedUse;
    if (!unrecorded) return;
    this.unrecordedUse = null;
    this.save();
    try {
      // Its own row, and the saves of its use since the last (about one a minute), count as rows Zaisma wrote for the game.
      await this.env.DB.prepare(
        "INSERT INTO room_usage (game_id, date, database_read_row_count, database_written_row_count, database_size_bytes, database_call_count, database_awake_duration_sec, bookkeeping_written_row_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, date) DO UPDATE SET database_read_row_count = database_read_row_count + excluded.database_read_row_count, database_written_row_count = database_written_row_count + excluded.database_written_row_count, database_size_bytes = excluded.database_size_bytes, database_call_count = database_call_count + excluded.database_call_count, database_awake_duration_sec = database_awake_duration_sec + excluded.database_awake_duration_sec, bookkeeping_written_row_count = bookkeeping_written_row_count + excluded.bookkeeping_written_row_count",
      )
        .bind(gameId, unrecorded.date, unrecorded.readRowCount, unrecorded.writtenRowCount, this.ctx.storage.sql.databaseSize + this.keptRoomsSizeBytes(), unrecorded.callCount ?? 0, Math.round((unrecorded.awakeDurationMs ?? 0) / 1000), 2)
        .run();
    } catch (error) {
      console.error("Couldn't record the game database's use:", error);
      // Back with whatever came since, for the next try.
      const newerUse = this.unrecordedUse as UnrecordedUse | null;
      this.unrecordedUse = {
        date: unrecorded.date,
        readRowCount: unrecorded.readRowCount + (newerUse?.readRowCount ?? 0),
        writtenRowCount: unrecorded.writtenRowCount + (newerUse?.writtenRowCount ?? 0),
        callCount: (unrecorded.callCount ?? 0) + (newerUse?.callCount ?? 0),
        awakeDurationMs: (unrecorded.awakeDurationMs ?? 0) + (newerUse?.awakeDurationMs ?? 0),
      };
      this.save();
    }
  }

  /** Sends the erases whose record failed to player_erases; one that fails again stays held. */
  private async recordHeldErases(gameId: string): Promise<void> {
    if (this.heldErases.length === 0) return;
    const held = this.heldErases;
    const recorded = new Set<string>();
    for (const erase of held) {
      try {
        await recordPlayerErased(this.env.DB, gameId, erase.playerId, erase.erasedAtMs);
        recorded.add(erase.playerId);
      } catch (error) {
        console.error("Couldn't keep a player's erase:", error);
      }
    }
    // Erases held while these went out stay.
    this.heldErases = this.heldErases.filter((erase) => !recorded.has(erase.playerId));
    if (this.heldErases.length) this.ctx.storage.kv.put("held_erases", this.heldErases);
    else this.ctx.storage.kv.delete("held_erases");
  }

  private save(): void {
    this.ctx.storage.kv.put("usage", this.usage);
    if (this.unrecordedUse) this.ctx.storage.kv.put("unrecorded_use", this.unrecordedUse);
    else this.ctx.storage.kv.delete("unrecorded_use");
    this.unsavedStatementCount = 0;
    this.savedAtMs = Date.now();
  }
}

/** An import part that left a foreign key broken: it was undone. */
const FOREIGN_KEY_ACROSS_PARTS = {
  code: "bad_sql",
  message: "A row in this part refers to a row that isn't in it or in a part before it (FOREIGN KEY constraint failed), so the part was undone.",
  fix: "Rows that refer to each other must go in together: send them in one part, or the part they refer to first. Parts before it stay imported.",
} as const;

/** Tries at carrying the use over to a restored database, 50 ms more apart each time: about 5 seconds in all. */
const CARRY_ATTEMPT_COUNT = 14;

/** What every call gets between a prepared restore and the restart. */
function restarting(): DatabaseError {
  return new DatabaseError("database_unavailable", "The game's database is restarting after a restore.", "Try again in a few seconds.");
}

/** About how many bytes a row takes in an answer: text as characters, blobs as base64, numbers as 8. */
function rowSizeBytes(row: DatabaseRow): number {
  let sizeBytes = 0;
  for (const [column, columnValue] of Object.entries(row)) {
    sizeBytes += column.length + (typeof columnValue === "string" ? columnValue.length : columnValue instanceof Uint8Array ? Math.ceil(columnValue.byteLength / 3) * 4 : 8);
  }
  return sizeBytes;
}

/** answerDatabase, plus answer_too_big for an answer past what the developer API sends. */
function answerForDeveloper<T>(work: () => T): DeveloperDatabaseAnswer<T> {
  // answerDatabase takes any error it doesn't know for SQLite's, so this one is noted on its way through.
  let isTooBig = false;
  const answer = answerDatabase(() => {
    try {
      return work();
    } catch (error) {
      if (error instanceof AnswerTooBig) isTooBig = true;
      throw error;
    }
  });
  if (!isTooBig) return answer;
  return {
    error: {
      code: "answer_too_big",
      message: `The answer is over ${MAXIMUM_DEVELOPER_ANSWER_SIZE_BYTES / 1024 / 1024} MB, so the statements were undone.`,
      fix: "Ask for fewer rows with LIMIT (and OFFSET or a WHERE on the last row for the next page), or fewer columns; leave big text and blobs out and read them a row at a time.",
    },
  };
}

/** A game's database, by its game ID. */
export function gameDatabaseObject(env: Env, gameId: string): DurableObjectStub<GameDatabaseObject> {
  return env.GAME_DATABASES.get(env.GAME_DATABASES.idFromName(gameId));
}

/** room.database for a game server built into this Worker. */
export function gameDatabase(env: Env, gameId: string): GameDatabase {
  return {
    query: async (sql, values) => readDatabaseAnswer(await gameDatabaseObject(env, gameId).query(sql, values ?? [])),
    batch: async (statements) => readDatabaseAnswer(await gameDatabaseObject(env, gameId).batch(statements)),
    erasePlayer: async (playerId) => {
      const erasedTables = readDatabaseAnswer(await gameDatabaseObject(env, gameId).erasePlayer(playerId));
      await recordErased(env, gameId, playerId);
      return erasedTables;
    },
  };
}

/**
 * Keeps that a game server erased a player, so a restore to a time before erases them again. Never fails the erase: when
 * D1 refuses, the database object holds it and sends it with its next recordUse.
 */
async function recordErased(env: Env, gameId: string, playerId: unknown): Promise<void> {
  const erasedAtMs = Date.now();
  try {
    await recordPlayerErased(env.DB, gameId, String(playerId), erasedAtMs);
  } catch (error) {
    console.error("Couldn't keep a player's erase:", error);
    try {
      await gameDatabaseObject(env, gameId).holdErase(String(playerId), erasedAtMs);
    } catch (holdError) {
      console.error("Couldn't hold a player's erase either:", holdError);
    }
  }
}

/**
 * What a game's own game server, in its sandbox, gets as its database: this Worker's own entrypoint,
 * fixed to that game by props it can't see or change, so it reaches its own game's database and
 * nothing else. The sandbox's harness turns its answers into room.database.
 */
export class GameDatabaseBinding extends WorkerEntrypoint<Env, { gameId: string }> {
  query(sql: unknown, values: unknown): Promise<DatabaseAnswer<DatabaseRow[]>> {
    return this.reach((database) => database.query(sql, values));
  }

  batch(statements: unknown): Promise<DatabaseAnswer<DatabaseRow[][]>> {
    return this.reach((database) => database.batch(statements));
  }

  async erasePlayer(playerId: unknown): Promise<DatabaseAnswer<ErasedTable[]>> {
    const answer = await this.reach((database) => database.erasePlayer(playerId));
    if (!("error" in answer)) this.ctx.waitUntil(recordErased(this.env, this.ctx.props.gameId, playerId));
    return answer;
  }

  private async reach<T>(work: (database: DurableObjectStub<GameDatabaseObject>) => Promise<DatabaseAnswer<T>>): Promise<DatabaseAnswer<T>> {
    try {
      return await work(gameDatabaseObject(this.env, this.ctx.props.gameId));
    } catch (error) {
      console.error("Game database unavailable:", error);
      return { error: { code: "database_unavailable", message: "The game's database didn't answer.", fix: "Try again in a moment; if it keeps happening, tell Zaisma on the forum." } };
    }
  }
}

/**
 * Every game's database for the developer API on zaisma.com (apps/site/src/game-database.ts), through
 * a service binding: only Zaisma's own Workers reach it, never a game server or the internet. The site
 * checks the caller owns the game before it names the game here.
 */
export class GameDatabaseService extends WorkerEntrypoint<Env> {
  query(gameId: string, sql: unknown, values: unknown): Promise<DeveloperDatabaseAnswer<StatementResult>> {
    return this.reach(gameId, (database) => database.queryForDeveloper(sql, values));
  }

  batch(gameId: string, statements: unknown): Promise<DeveloperDatabaseAnswer<StatementResult[]>> {
    return this.reach(gameId, (database) => database.batchForDeveloper(statements));
  }

  overview(gameId: string): Promise<DeveloperDatabaseAnswer<DatabaseOverview>> {
    return this.reach(gameId, async (database) => ({ queryResult: await database.overview() }));
  }

  /** This month's use alone, for the game's alerts: reads no rows, so it costs the game nothing. */
  usage(gameId: string): Promise<DeveloperDatabaseAnswer<Usage & { storageSizeBytes: number }>> {
    return this.reach(gameId, async (database) => ({ queryResult: await database.usageThisMonth() }));
  }

  /** The site's hosting job: when the game's hosting paused this month, or null when it runs again (GameDatabaseObject.setHostingPause). */
  async setHostingPause(gameId: string, pausedAtMs: number | null): Promise<void> {
    await gameDatabaseObject(this.env, gameId).setHostingPause(pausedAtMs);
  }

  exportDump(gameId: string, cursor: string | null): Promise<DeveloperDatabaseAnswer<DumpPart>> {
    return this.reach(gameId, (database) => database.exportForDeveloper(cursor));
  }

  /** One part of the dump for Zaisma's nightly backup, whose reads aren't the developer's to pay for. */
  backupDump(gameId: string, cursor: string | null): Promise<DeveloperDatabaseAnswer<DumpPart>> {
    return this.reach(gameId, (database) => database.exportForBackup(cursor));
  }

  /** Erase one player from a game's database: the erase_player call, and a deleted account's erase (apps/site/src/webhooks.ts). */
  erasePlayer(gameId: string, playerId: unknown): Promise<DeveloperDatabaseAnswer<{ erasedTables: ErasedTable[]; writtenRowCount: number }>> {
    return this.reach(gameId, (database) => database.erasePlayerForDeveloper(playerId));
  }

  importDump(gameId: string, dumpSql: string): Promise<DeveloperDatabaseAnswer<ImportResult>> {
    return this.reach(gameId, (database) => database.importForDeveloper(dumpSql), (error) =>
      // Cloudflare ends a transaction that commits with a foreign key broken by resetting the object to how it was: the part is undone.
      /constraints were violated|FOREIGN KEY constraint failed/i.test(String(error instanceof Error ? error.message : error)) ? { error: FOREIGN_KEY_ACROSS_PARTS } : null,
    );
  }

  /** One part of a backup's dump in, for a restore from Zaisma's backups: Zaisma's writes, never the game's (GameDatabaseObject.importForBackup). */
  importBackup(gameId: string, dumpSql: string, isFirstPart: boolean): Promise<DeveloperDatabaseAnswer<{ statementCount: number }>> {
    return this.reach(gameId, (database) => database.importForBackup(dumpSql, isFirstPart));
  }

  /**
   * Sets a game's database to go back to a moment, or to an earlier restore's undo bookmark, and answers the bookmark
   * that undoes it. Nothing is restored until finishRestore; until then the database answers nothing. The site keeps the
   * restore's record first, and calls abandonRestore instead when it can't.
   */
  prepareRestore(gameId: string, target: RestoreTarget): Promise<DeveloperDatabaseAnswer<PreparedRestore>> {
    return this.reach(gameId, (database) => database.prepareRestore(target));
  }

  /** The restore happening: the object restarts to restore, then gets this month's use and hosting pause back. */
  async finishRestore(gameId: string, prepared: PreparedRestore): Promise<void> {
    try {
      await gameDatabaseObject(this.env, gameId).restart();
    } catch {
      // The restart ends the call: that's the restore happening.
    }
    // Until the restored object takes the use (the old one refuses it), nothing else should reach it either.
    for (let attemptNumber = 1; attemptNumber <= CARRY_ATTEMPT_COUNT; attemptNumber++) {
      try {
        await gameDatabaseObject(this.env, gameId).carryUsage(prepared.usage, prepared.hostingPause);
        break;
      } catch (error) {
        if (attemptNumber === CARRY_ATTEMPT_COUNT) console.error("Couldn't carry a restored game database's use over:", error);
        else await new Promise((resolve) => setTimeout(resolve, attemptNumber * 50));
      }
    }
  }

  /** A prepared restore that won't happen: the object restarts to the state it had when it was prepared, so nothing changes. */
  async abandonRestore(gameId: string, prepared: PreparedRestore): Promise<void> {
    await gameDatabaseObject(this.env, gameId).abandonRestore(prepared.undoBookmark);
    await this.finishRestore(gameId, prepared);
  }

  private async reach<T>(gameId: string, work: (database: DurableObjectStub<GameDatabaseObject>) => Promise<DeveloperDatabaseAnswer<T>>, translate?: (error: unknown) => DeveloperDatabaseAnswer<T> | null): Promise<DeveloperDatabaseAnswer<T>> {
    try {
      return await work(gameDatabaseObject(this.env, gameId));
    } catch (error) {
      const translated = translate?.(error);
      if (translated) return translated;
      console.error("Game database unavailable:", error);
      return { error: { code: "database_unavailable", message: "The game's database didn't answer.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers)." } };
    }
  }
}
