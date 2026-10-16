import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { DATABASE_LIMITS, DatabaseError, answerDatabase, checkBatch, checkStatement, plainRow, readDatabaseAnswer, tooManyRows, type DatabaseAnswer, type DatabaseRow, type DatabaseValue, type GameDatabase } from "@zaisma/game-server";
import { GAME_DATABASE_FREE_LIMITS, nextMonthStartDate, usageMonth } from "@zaisma/core";
import type { Env } from "./index.ts";

/** Rows read and written in a month, the way Cloudflare bills them. */
interface Usage {
  month: string;
  readRowCount: number;
  writtenRowCount: number;
}

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
    this.usage = ctx.storage.kv.get<Usage>("usage") ?? { month: usageMonth(), readRowCount: 0, writtenRowCount: 0 };
  }

  query(sql: unknown, values: unknown): DatabaseAnswer<DatabaseRow[]> {
    return answerDatabase(() => this.run([checkStatement(sql, values)])[0]!);
  }

  batch(statements: unknown): DatabaseAnswer<DatabaseRow[][]> {
    return answerDatabase(() => this.run(checkBatch(statements)));
  }

  /** This month's use, for tests now and the developer API next. */
  usageThisMonth(): Usage & { storageSizeBytes: number } {
    this.newMonth();
    return { ...this.usage, storageSizeBytes: this.ctx.storage.sql.databaseSize };
  }

  private run(statements: { sql: string; values: DatabaseValue[] }[]): DatabaseRow[][] {
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
    try {
      return this.ctx.storage.transactionSync(() =>
        statements.map((statement) => {
          const sizeBeforeBytes = sql.databaseSize;
          const cursor = sql.exec(statement.sql, ...statement.values.map((boundValue) => (boundValue instanceof Uint8Array ? boundValue.slice().buffer : boundValue)));
          const rows: DatabaseRow[] = [];
          try {
            for (const row of cursor) {
              if (rows.length >= DATABASE_LIMITS.maximumRowCount) throw tooManyRows();
              rows.push(plainRow(row));
            }
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
          return rows;
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
    this.usage = { month, readRowCount: 0, writtenRowCount: 0 };
    this.save();
  }

  private addUsage(readRowCount: number, writtenRowCount: number, statementCount: number): void {
    this.usage.readRowCount += readRowCount;
    this.usage.writtenRowCount += writtenRowCount;
    this.unsavedStatementCount += statementCount;
    // A restart can lose the last minute's counts; that's a little free use, never a wrong limit.
    if (this.unsavedStatementCount >= USAGE_SAVE_STATEMENT_COUNT || Date.now() - this.savedAtMs >= USAGE_SAVE_MS) this.save();
  }

  private save(): void {
    this.ctx.storage.kv.put("usage", this.usage);
    this.unsavedStatementCount = 0;
    this.savedAtMs = Date.now();
  }
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

  private async reach<T>(work: (database: DurableObjectStub<GameDatabaseObject>) => Promise<DatabaseAnswer<T>>): Promise<DatabaseAnswer<T>> {
    try {
      return await work(gameDatabaseObject(this.env, this.ctx.props.gameId));
    } catch (error) {
      console.error("Game database unavailable:", error);
      return { error: { code: "database_unavailable", message: "The game's database didn't answer.", fix: "Try again in a moment; if it keeps happening, tell Zaisma on the forum." } };
    }
  }
}
