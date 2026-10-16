/**
 * The game database: one SQLite database per game, which its game server reads and changes with
 * plain SQL (room.database). In Zaisma rooms it's a Durable Object of its own (apps/rooms/src/database.ts);
 * on the developer's own server the Node runner keeps it in a local file (bin/node.js). Both check every
 * call here first, so a query that works in one works the same in the other.
 */

/** A value a query takes for a ? and gives back in a column. Blobs come back as Uint8Array. */
export type DatabaseValue = string | number | null | Uint8Array;

/** One row, by column name. */
export type DatabaseRow = Record<string, DatabaseValue>;

/** One statement of a batch: its SQL, and the values for its ?s in order. */
export interface DatabaseStatement {
  sql: string;
  values?: DatabaseValue[];
}

export interface GameDatabase {
  /**
   * Run one SQL statement and answer its rows ([] for a statement that returns none). values fill
   * its ?s in order: text, numbers, null or a Uint8Array (use 1 and 0 for true and false). To see
   * what an INSERT, UPDATE or DELETE changed, add RETURNING.
   *
   *   await room.database.query("CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
   *   await room.database.query("INSERT INTO scores VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET best_score = max(best_score, excluded.best_score)", [player.id, 1200]);
   *   const top = await room.database.query("SELECT player_id, best_score FROM scores ORDER BY best_score DESC LIMIT 10");
   */
  query(sql: string, values?: DatabaseValue[]): Promise<DatabaseRow[]>;
  /**
   * Run several statements in one transaction: all of them happen, or, if one fails, none do.
   * Answers each statement's rows, in order. For moving an item between two inventories, say.
   */
  batch(statements: DatabaseStatement[]): Promise<DatabaseRow[][]>;
}

export const DATABASE_LIMITS = {
  /** One statement's SQL. */
  maximumSqlCharacterCount: 100_000,
  /** Values for one statement's ?s. */
  maximumValueCount: 100,
  /** One text or blob value, in a query and in the database. */
  maximumValueSizeBytes: 1024 * 1024,
  /** Statements in one batch. */
  maximumStatementCount: 100,
  /** Rows one statement may answer; past it, page with LIMIT and OFFSET or a WHERE. */
  maximumRowCount: 10_000,
} as const;

export type DatabaseErrorCode = "bad_sql" | "bad_values" | "too_many_rows" | "database_write_limit" | "database_read_limit" | "database_storage_limit" | "database_unavailable";

/** A call the database refused, with a code, what happened and what to do (like the developer API's errors, docs/NAMING.md). */
export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  readonly fix: string;
  constructor(code: DatabaseErrorCode, message: string, fix: string) {
    super(`${message} ${fix} (${code})`);
    this.name = "DatabaseError";
    this.code = code;
    this.fix = fix;
  }
}

/** What a database answers across a boundary (the sandbox, RPC): the result, or the error to throw. */
export type DatabaseAnswer<T> = { queryResult: T } | { error: { code: DatabaseErrorCode; message: string; fix: string } };

/** The answer's result, or its error thrown as a DatabaseError. */
export function readDatabaseAnswer<T>(answer: DatabaseAnswer<T>): T {
  if ("error" in answer) throw new DatabaseError(answer.error.code, answer.error.message, answer.error.fix);
  return answer.queryResult;
}

/** Run work, answering its result or the DatabaseError it threw; any other error is SQLite's (bad_sql). */
export function answerDatabase<T>(work: () => T): DatabaseAnswer<T> {
  try {
    return { queryResult: work() };
  } catch (error) {
    // The error's own message ends with its fix and code, which the answer gives apart.
    if (error instanceof DatabaseError) return { error: { code: error.code, message: error.message.slice(0, -` ${error.fix} (${error.code})`.length), fix: error.fix } };
    return { error: { code: "bad_sql", message: `SQLite: ${String(error instanceof Error ? error.message : error).replace(/^Error: /, "").slice(0, 500)}`, fix: "Check the statement against SQLite's syntax and your tables; list them with SELECT name, sql FROM sqlite_schema." } };
  }
}

// Statements that run their own transactions or reach other files. batch() is the transaction.
const REFUSED_FIRST_WORDS = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE", "ATTACH", "DETACH"]);

/**
 * Check one statement and its values before it runs: one statement only, no transaction control,
 * values of the kinds SQLite takes. Throws a DatabaseError; answers the statement to run (without a
 * trailing ; or comment, which SQLite in a Durable Object takes as an empty statement) and its values.
 */
export function checkStatement(sql: unknown, values: unknown): { sql: string; values: DatabaseValue[] } {
  if (typeof sql !== "string" || !sql.trim()) throw new DatabaseError("bad_sql", "The SQL isn't text.", 'Give one SQL statement as text, like "SELECT * FROM scores WHERE player_id = ?".');
  if (sql.length > DATABASE_LIMITS.maximumSqlCharacterCount) throw new DatabaseError("bad_sql", `The SQL is ${sql.length} characters.`, `Keep one statement under ${DATABASE_LIMITS.maximumSqlCharacterCount} characters, and pass data as values instead of writing it into the SQL.`);
  const words = statementWords(sql);
  if (words.statementCount > 1) throw new DatabaseError("bad_sql", "The SQL has more than one statement.", "Give one statement per query, or several in a batch (room.database.batch([{ sql, values }, ...]) in a game server, batch_database through the API), which also runs them in one transaction.");
  if (REFUSED_FIRST_WORDS.has(words.firstWord)) throw new DatabaseError("bad_sql", `${words.firstWord} isn't allowed.`, "For a transaction, use a batch (room.database.batch([{ sql, values }, ...]) in a game server, batch_database through the API): its statements all happen or none do.");
  const given = values === undefined || values === null ? [] : values;
  if (!Array.isArray(given)) throw new DatabaseError("bad_values", "values isn't a list.", 'Give the values for the ?s as a list, in order, like ["player_8f3k2m", 1200].');
  if (given.length > DATABASE_LIMITS.maximumValueCount) throw new DatabaseError("bad_values", `There are ${given.length} values.`, `Give up to ${DATABASE_LIMITS.maximumValueCount} values per statement; split big inserts into several statements in one batch.`);
  return { sql: sql.slice(0, words.statementEndIndex), values: given.map(checkValue) };
}

/** One value for a ?, the i-th (from 0). */
function checkValue(givenValue: unknown, i: number): DatabaseValue {
  if (givenValue === null || typeof givenValue === "string" || givenValue instanceof Uint8Array || (typeof givenValue === "number" && Number.isFinite(givenValue))) {
    const sizeBytes = typeof givenValue === "string" ? new TextEncoder().encode(givenValue).length : givenValue instanceof Uint8Array ? givenValue.byteLength : 0;
    if (sizeBytes > DATABASE_LIMITS.maximumValueSizeBytes) throw new DatabaseError("bad_values", `Value ${i + 1} is ${sizeBytes} bytes.`, `Keep each text or blob under ${DATABASE_LIMITS.maximumValueSizeBytes / 1024 / 1024} MB; store big files somewhere else and keep a link here.`);
    return givenValue;
  }
  const kind = typeof givenValue === "boolean" ? "true or false" : typeof givenValue === "number" ? String(givenValue) : Array.isArray(givenValue) ? "a list" : typeof givenValue;
  const fix = typeof givenValue === "boolean" ? "Give 1 for true and 0 for false." : typeof givenValue === "object" ? "Give text, a number, null or a Uint8Array; to store an object, give JSON.stringify(object) and read it back with JSON.parse or SQLite's JSON functions." : "Give text, a finite number, null or a Uint8Array.";
  throw new DatabaseError("bad_values", `Value ${i + 1} is ${kind}.`, fix);
}

/** Check a batch's statements; answers each with its values to bind. */
export function checkBatch(statements: unknown): { sql: string; values: DatabaseValue[] }[] {
  if (!Array.isArray(statements) || statements.length === 0) throw new DatabaseError("bad_sql", "The batch isn't a list of statements.", 'Give a list like [{ sql: "UPDATE ...", values: [...] }, { sql: "INSERT ...", values: [...] }].');
  if (statements.length > DATABASE_LIMITS.maximumStatementCount) throw new DatabaseError("bad_sql", `The batch has ${statements.length} statements.`, `Give up to ${DATABASE_LIMITS.maximumStatementCount} statements per batch.`);
  return statements.map((statement, i) => {
    if (!statement || typeof statement !== "object" || Array.isArray(statement)) throw new DatabaseError("bad_sql", `Statement ${i + 1} isn't { sql, values }.`, 'Give each statement as { sql: "...", values: [...] }.');
    for (const field of Object.keys(statement)) if (field !== "sql" && field !== "values") throw new DatabaseError("bad_sql", `Statement ${i + 1} has ${field}.`, "A statement takes only sql and values.");
    const { sql, values } = statement as { sql: unknown; values?: unknown };
    return checkStatement(sql, values);
  });
}

/** A row as the game gets it: a plain object, with blobs as Uint8Array. */
export function plainRow(row: Record<string, unknown>): DatabaseRow {
  const plain: DatabaseRow = {};
  for (const [column, columnValue] of Object.entries(row)) plain[column] = columnValue instanceof ArrayBuffer ? new Uint8Array(columnValue) : (columnValue as DatabaseValue);
  return plain;
}

export function tooManyRows(): DatabaseError {
  return new DatabaseError("too_many_rows", `The statement answered more than ${DATABASE_LIMITS.maximumRowCount} rows.`, "Ask for fewer with LIMIT (and OFFSET or a WHERE on the last row for the next page), or count with SELECT count(*).");
}

/**
 * How many statements the SQL holds, its first word and where the first one ends, reading past
 * quotes and comments: a ; inside 'text' or a comment doesn't end a statement, and a trailing ; is fine.
 */
function statementWords(sql: string): { statementCount: number; firstWord: string; statementEndIndex: number } {
  let statementCount = 0;
  let statementEndIndex = 0;
  let hasWords = false;
  let firstWord = "";
  let i = 0;
  while (i < sql.length) {
    const character = sql[i]!;
    if (character === "-" && sql[i + 1] === "-") {
      const endIndex = sql.indexOf("\n", i);
      i = endIndex === -1 ? sql.length : endIndex + 1;
    } else if (character === "/" && sql[i + 1] === "*") {
      const endIndex = sql.indexOf("*/", i + 2);
      i = endIndex === -1 ? sql.length : endIndex + 2;
    } else if (character === "'" || character === '"' || character === "`" || character === "[") {
      const close = character === "[" ? "]" : character;
      let endIndex = i + 1;
      // A quote is escaped by doubling it.
      while (endIndex < sql.length && !(sql[endIndex] === close && sql[endIndex + 1] !== close)) endIndex += sql[endIndex] === close ? 2 : 1;
      if (!hasWords) statementCount++;
      hasWords = true;
      i = endIndex + 1;
      if (statementCount === 1) statementEndIndex = Math.min(i, sql.length);
    } else if (character === ";") {
      hasWords = false;
      i++;
    } else if (/\s/.test(character)) {
      i++;
    } else {
      if (!hasWords) {
        statementCount++;
        if (statementCount === 1) firstWord = /^[A-Za-z]+/.exec(sql.slice(i))?.[0]?.toUpperCase() ?? "";
      }
      hasWords = true;
      i++;
      if (statementCount === 1) statementEndIndex = i;
    }
  }
  return { statementCount, firstWord, statementEndIndex };
}
