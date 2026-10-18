import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { DATABASE_LIMITS, DatabaseError, DumpCursorError, TABLE_COLUMNS_SQL, answerDatabase, type DatabaseErrorCode, checkBatch, checkPlayerId, checkStatement, dumpPart, eraseRefused, eraseStatements, importStatements, plainRow, preview, readDatabaseAnswer, tablesFromColumns, tooManyRows, type DatabaseAnswer, type DatabaseRow, type DatabaseValue, type DumpPart, type ErasedTable, type GameDatabase } from "@zaisma/game-server";
import { GAME_DATABASE_FREE_LIMITS, NEARLY_USED_PCT, nextMonthStartDate, usageMonth, type FreeUseAlertKind } from "@zaisma/core";
import type { Env } from "./index.ts";

/** Rows read and written in a month, the way Cloudflare bills them, and the month's free-use alerts already noticed. */
interface Usage {
  month: string;
  readRowCount: number;
  writtenRowCount: number;
  noticedAlertKinds: FreeUseAlertKind[];
}

/** One statement's rows, and the rows it read and wrote, as the developer API shows them. */
export interface StatementResult {
  rows: DatabaseRow[];
  readRowCount: number;
  writtenRowCount: number;
}

/** What the developer API gets back: a DatabaseError's codes, and answer_too_big and bad_cursor, which only it has. */
export type DeveloperDatabaseAnswer<T> = { queryResult: T } | { error: { code: DatabaseErrorCode | "answer_too_big" | "bad_cursor"; message: string; fix: string } };

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

/**
 * One game's database: a SQLite-backed Durable Object of its own, named by the game's ID, used by
 * all its rooms (room.database) and kept between matches. Every statement is checked the same way
 * the Node runner checks it (checkStatement), and runs in a transaction, so a batch is all or
 * nothing and a statement past the free use undoes itself. Cloudflare keeps its own tables (_cf_…)
 * out of the developer's reach; ours is only the usage, in the object's key-value storage.
 */
export class GameDatabaseObject extends DurableObject<Env> {
  private usage: Usage;
  private unsavedStatementCount = 0;
  private savedAtMs = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const usage = ctx.storage.kv.get<Usage>("usage") ?? { month: usageMonth(), readRowCount: 0, writtenRowCount: 0, noticedAlertKinds: [] };
    this.usage = { ...usage, noticedAlertKinds: usage.noticedAlertKinds ?? [] };
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
   * up to 4 MB a part. Its reads count towards the month's use, but it works past the free reads: the data is
   * always the developer's to take. One part runs in one go, so it's whole; between parts the game can write.
   */
  exportForDeveloper(cursor: string | null): DeveloperDatabaseAnswer<DumpPart> {
    this.newMonth();
    const sql = this.ctx.storage.sql;
    let statementCount = 0;
    let readRowCount = 0;
    try {
      const part = dumpPart((statementSql, values) => {
        statementCount++;
        const cursor = sql.exec(statementSql, ...values);
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
      this.addUsage(readRowCount, 0, statementCount);
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
          return checkStatement(statement.sql, statement.values);
        } catch (error) {
          if (error instanceof DatabaseError) throw new DatabaseError(error.code, `Statement ${statement.statementNumber} of the dump (${preview(statement.sql)}): ${error.message.slice(0, -` ${error.fix} (${error.code})`.length)}`, error.fix);
          throw error;
        }
      });
      const statementResults = this.run(checked, Infinity, (i, error) => {
        const statement = plan.statements[i]!;
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

  /**
   * The tables and indexes, from SQLite's own list, without Cloudflare's (_cf_…) or SQLite's (sqlite_…).
   * Reading the list counts towards the month's use like any read, but works past the free reads, so the
   * developer can always see what's there. No row counts: counting reads every row.
   */
  overview(): DatabaseOverview {
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
    this.newMonth();
    return { ...this.usage, storageSizeBytes: this.ctx.storage.sql.databaseSize };
  }

  /**
   * Erases one player: every row whose player_id column holds theirs, in every table that has one, in
   * one transaction (eraseStatements). It counts towards the month's use but skips the free limits: it
   * only deletes, and erasing a player must never wait for next month.
   */
  private erase(given: unknown): { erasedTables: ErasedTable[]; writtenRowCount: number } {
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
    this.newMonth();
    const limits = GAME_DATABASE_FREE_LIMITS;
    const resetDate = nextMonthStartDate();
    if (this.usage.readRowCount >= limits.readRowCountPerMonth) {
      throw new DatabaseError("database_read_limit", `This game's database has read its free ${limits.readRowCountPerMonth.toLocaleString("en-US")} rows this month.`, `It works again on ${resetDate} (UTC). Read less: add indexes for your WHEREs, and keep results the game reads often in the room's state.`);
    }
    const canWrite = this.usage.writtenRowCount < limits.writtenRowCountPerMonth;
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
          } catch (error) {
            // SQLite can also fail while stepping through, like a UNIQUE constraint on an INSERT.
            throw failure && !(error instanceof DatabaseError) && !(error instanceof AnswerTooBig) ? failure(i, error) : error;
          } finally {
            readRowCount += cursor.rowsRead;
            writtenRowCount += cursor.rowsWritten;
          }
          if (!canWrite && cursor.rowsWritten > 0) {
            throw new DatabaseError("database_write_limit", `This game's database has written its free ${limits.writtenRowCountPerMonth.toLocaleString("en-US")} rows this month, so this statement was undone.`, `Reads still work; writes start again on ${resetDate} (UTC). Write less often, like saving scores once at the end of a match.`);
          }
          // A database at its free storage can still change and delete rows, just not grow.
          if (sql.databaseSize > limits.storageSizeBytes && sql.databaseSize > sizeBeforeBytes) {
            throw new DatabaseError("database_storage_limit", `This game's database would be over its free ${limits.storageSizeBytes / 1024 / 1024} MB, so this statement was undone.`, "Reads, changes and deletes still work. Delete rows you no longer need (old matches, players who left long ago) to make room.");
          }
          return { rows, readRowCount: cursor.rowsRead, writtenRowCount: cursor.rowsWritten };
        }),
      );
    } finally {
      this.addUsage(readRowCount, writtenRowCount, statements.length);
    }
  }

  /** A new month starts from nothing. */
  private newMonth(): void {
    const month = usageMonth();
    if (this.usage.month === month) return;
    this.usage = { month, readRowCount: 0, writtenRowCount: 0, noticedAlertKinds: [] };
    this.save();
  }

  private addUsage(readRowCount: number, writtenRowCount: number, statementCount: number): void {
    this.usage.readRowCount += readRowCount;
    this.usage.writtenRowCount += writtenRowCount;
    this.unsavedStatementCount += statementCount;
    // A restart can lose the last minute's counts; that's a little free use, never a wrong limit.
    if (this.unsavedStatementCount >= USAGE_SAVE_STATEMENT_COUNT || Date.now() - this.savedAtMs >= USAGE_SAVE_MS) this.save();
    this.notice();
  }

  /**
   * The month's free-use lines this database just reached (80% and all of its reads, writes and
   * storage), each written once a month to alert_notices for the game's alert_raised event. Never
   * fails or slows the statement.
   */
  private notice(): void {
    const limits = GAME_DATABASE_FREE_LIMITS;
    const sizeBytes = this.ctx.storage.sql.databaseSize;
    const reached: [FreeUseAlertKind, boolean][] = [
      ["database_nearly_paused", this.usage.readRowCount >= limits.readRowCountPerMonth * NEARLY_USED_PCT / 100],
      ["database_paused", this.usage.readRowCount >= limits.readRowCountPerMonth],
      ["database_writes_nearly_paused", this.usage.writtenRowCount >= limits.writtenRowCountPerMonth * NEARLY_USED_PCT / 100],
      ["database_writes_paused", this.usage.writtenRowCount >= limits.writtenRowCountPerMonth],
      ["database_nearly_full", sizeBytes >= limits.storageSizeBytes * NEARLY_USED_PCT / 100],
      ["database_full", sizeBytes >= limits.storageSizeBytes],
    ];
    const kinds = reached.filter(([kind, isReached]) => isReached && !this.usage.noticedAlertKinds.includes(kind)).map(([kind]) => kind);
    // The object is reached by idFromName(gameId), so its name is the game's ID.
    const gameId = this.ctx.id.name;
    if (!kinds.length || !gameId) return;
    this.usage.noticedAlertKinds.push(...kinds);
    this.save();
    const monthStartDate = `${this.usage.month}-01`;
    const nowMs = Date.now();
    const insert = this.env.DB.prepare("INSERT OR IGNORE INTO alert_notices (game_id, alert_kind, month_start_date, noticed_at_ms) VALUES (?, ?, ?, ?)");
    this.ctx.waitUntil(
      this.env.DB.batch(kinds.map((kind) => insert.bind(gameId, kind, monthStartDate, nowMs))).then(
        () => undefined,
        (error) => console.error("Couldn't notice the database's alert:", error),
      ),
    );
  }

  private save(): void {
    this.ctx.storage.kv.put("usage", this.usage);
    this.unsavedStatementCount = 0;
    this.savedAtMs = Date.now();
  }
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
    erasePlayer: async (playerId) => readDatabaseAnswer(await gameDatabaseObject(env, gameId).erasePlayer(playerId)),
  };
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

  erasePlayer(playerId: unknown): Promise<DatabaseAnswer<ErasedTable[]>> {
    return this.reach((database) => database.erasePlayer(playerId));
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

  exportDump(gameId: string, cursor: string | null): Promise<DeveloperDatabaseAnswer<DumpPart>> {
    return this.reach(gameId, (database) => database.exportForDeveloper(cursor));
  }

  /** Erase one player from a game's database: the erase_player call, and a deleted account's erase (apps/site/src/webhooks.ts). */
  erasePlayer(gameId: string, playerId: unknown): Promise<DeveloperDatabaseAnswer<{ erasedTables: ErasedTable[]; writtenRowCount: number }>> {
    return this.reach(gameId, (database) => database.erasePlayerForDeveloper(playerId));
  }

  importDump(gameId: string, dumpSql: string): Promise<DeveloperDatabaseAnswer<ImportResult>> {
    return this.reach(gameId, (database) => database.importForDeveloper(dumpSql));
  }

  private async reach<T>(gameId: string, work: (database: DurableObjectStub<GameDatabaseObject>) => Promise<DeveloperDatabaseAnswer<T>>): Promise<DeveloperDatabaseAnswer<T>> {
    try {
      return await work(gameDatabaseObject(this.env, gameId));
    } catch (error) {
      console.error("Game database unavailable:", error);
      return { error: { code: "database_unavailable", message: "The game's database didn't answer.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers)." } };
    }
  }
}
