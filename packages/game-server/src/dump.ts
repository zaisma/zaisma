/**
 * The game database in and out as SQLite's own SQL dump (docs/DECISIONS.md, "Import, export and undo"):
 * the CREATE TABLEs and INSERTs that `sqlite3 game.sqlite .dump` writes, so a dump from Zaisma loads into
 * any SQLite (`sqlite3 game.sqlite < dump.sql`, the Node runner's file) and a dump from there loads into
 * Zaisma. Zaisma's database is a Durable Object (apps/rooms/src/database.ts); the upload command keeps a
 * copy of the same reading for .sqlite files (packages/cli/zaisma.mjs), held to this by test/node/dump.test.ts.
 */
import { DATABASE_LIMITS, DatabaseError, scanStatements, type DatabaseRow, type DatabaseValue } from "./database.ts";

/** Runs one SELECT for the dump: its rows, and the rows SQLite read for it (they count towards the month's reads). */
export type DumpRead = (sql: string, values: DatabaseValue[]) => { rows: DatabaseRow[]; readRowCount: number };

/** One part of a dump, and where the next one starts. */
export interface DumpPart {
  dumpSql: string;
  /** null on the last part. */
  nextCursor: string | null;
  readRowCount: number;
}

export const DUMP_LIMITS = {
  /** The most SQL one part of an export holds, unless a single row is bigger on its own. */
  exportPartSizeBytes: 4 * 1024 * 1024,
  /** The most one part of an import may hold: a little over an export's part, so every export part fits. */
  maximumImportPartSizeBytes: 5 * 1024 * 1024,
} as const;

/** A cursor that isn't an earlier part's next_cursor, or whose table is gone. */
export class DumpCursorError extends Error {}

/** Rows read per SELECT while dumping a table. */
const PAGE_ROW_COUNT = 500;

/** A dump starts and ends the way sqlite3's does, so it loads in one transaction anywhere. */
const DUMP_START = "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n";
const DUMP_END = "COMMIT;\n";

// What's in the database, in the order it was made: tables, views, indexes and triggers, with what kind
// of table each is (a normal one, a virtual one, or a virtual table's own "shadow" table) and whether it has
// rowids. Cloudflare's own tables (_cf_…) are never the developer's.
const SCHEMA_SQL =
  "SELECT entry.type AS type, entry.name AS name, entry.tbl_name AS table_name, entry.sql AS sql, listed.type AS table_kind, listed.wr AS is_without_rowid " +
  "FROM sqlite_schema AS entry LEFT JOIN pragma_table_list AS listed ON listed.schema = 'main' AND listed.name = entry.name " +
  "WHERE entry.sql IS NOT NULL AND substr(entry.tbl_name, 1, 4) <> '_cf_' ORDER BY entry.rowid";

interface SchemaEntry {
  type: string;
  name: string;
  table_name: string;
  sql: string;
  table_kind: string | null;
  is_without_rowid: number | null;
}

/** One column of a table's key, as the last row read held it: its SQLite type, and the value as text (text as it is, a blob in hex, a number as SQL writes it). */
interface KeyValue {
  key_type: "integer" | "real" | "text" | "blob" | "null";
  key_text: string | null;
}

/**
 * Where a part stops in a table: after the last key it read, so a game writing between parts can't move it
 * (a table with a primary key is read in key order, rowid last; one without, in rowid order).
 */
interface DumpPosition {
  table_name: string;
  last_rowid_number: number | null;
  last_key: KeyValue[] | null;
}

/** A name in double quotes, as SQLite takes any table or column name. */
export function quoteName(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * One part of the database's dump, up to partSizeBytes of SQL (more only when one row is bigger on its own),
 * starting where cursor says, or at the start for null. The parts, put together in order, are one whole dump. It reads
 * table by table, so a game writing while it runs can land between parts: it isn't a snapshot.
 */
export function dumpPart(read: DumpRead, cursor: string | null, partSizeBytes: number = DUMP_LIMITS.exportPartSizeBytes): DumpPart {
  let readRowCount = 0;
  const select = <Row>(sql: string, values: DatabaseValue[] = []) => {
    const answer = read(sql, values);
    readRowCount += answer.readRowCount;
    return answer.rows as unknown as Row[];
  };
  const entries = select<SchemaEntry>(SCHEMA_SQL);
  const tables = entries.filter((entry) => entry.type === "table" && (entry.table_kind === "table" || entry.table_kind === "virtual") && !entry.name.startsWith("sqlite_"));

  let dumpSql = "";
  let dumpSizeBytes = 0;
  let hasRows = false;
  const add = (sql: string) => {
    dumpSql += sql;
    dumpSizeBytes += utf8SizeBytes(sql);
  };
  let tableIndex = 0;
  let position: DumpPosition | null = null;
  if (cursor === null) {
    add(DUMP_START);
    // Every table is made before any row goes in, so a row can refer to a table made after it.
    for (const table of tables) add(`${table.sql};\n`);
  } else {
    position = readCursor(cursor);
    tableIndex = tables.findIndex((table) => table.name === position!.table_name);
    if (tableIndex === -1) throw new DumpCursorError(`The table ${position.table_name} isn't there any more.`);
  }

  for (; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex]!;
    position ??= { table_name: table.name, last_rowid_number: null, last_key: null };
    const columns = select<{ name: string; is_insertable: number; primary_key_number: number }>("SELECT name, hidden = 0 AS is_insertable, pk AS primary_key_number FROM pragma_table_xinfo(?) ORDER BY cid", [table.name]);
    // Generated columns, and a virtual table's hidden ones, can't be inserted: the INSERTs name the rest.
    const insertedColumns = columns.filter((column) => column.is_insertable === 1);
    // A search table's rows are known by their rowids, so they go in with them.
    const isVirtual = table.table_kind === "virtual";
    const insertInto = `INSERT INTO ${quoteName(table.name)}${insertedColumns.length < columns.length || isVirtual ? `(${[...(isVirtual ? ["rowid"] : []), ...insertedColumns.map((column) => quoteName(column.name))].join(",")})` : ""} VALUES(`;
    // quote() writes each value as SQL, the way sqlite3's .dump does: 'text' with '' for a quote, X'…' for bytes.
    const valuesSql = insertedColumns.map((column, i) => `quote(${quoteName(column.name)}) AS value_${i}`).join(", ");
    // A table with a declared primary key is read in its key order (rowid last, where it has one), so a row the game deletes or
    // replaces on the other side of the cursor can't move it; a table without one, in rowid order.
    const primaryKey = columns.filter((column) => column.primary_key_number > 0).sort((first, second) => first.primary_key_number - second.primary_key_number);
    const tableName = quoteName(table.name);
    const keyExpressions = primaryKey.length ? [...primaryKey.map((column) => `${tableName}.${quoteName(column.name)}`), ...(table.is_without_rowid ? [] : [`${tableName}.rowid`])] : [];
    while (true) {
      let rows: DatabaseRow[];
      if (keyExpressions.length) {
        const keySql = keyExpressions.map((expression, i) => `typeof(${expression}) AS key_type_${i}, CASE typeof(${expression}) WHEN 'text' THEN ${expression} WHEN 'blob' THEN hex(${expression}) WHEN 'null' THEN NULL ELSE quote(${expression}) END AS key_text_${i}`).join(", ");
        const after = keyAfter(keyExpressions, position.last_key);
        rows = select<DatabaseRow>(`SELECT ${keySql}${valuesSql ? `, ${valuesSql}` : ""} FROM ${tableName}${after.sql ? ` WHERE ${after.sql}` : ""} ORDER BY ${keyExpressions.join(", ")} LIMIT ${PAGE_ROW_COUNT}`, after.values);
      } else {
        rows = select<DatabaseRow>(`SELECT rowid AS paging_rowid${valuesSql ? `, ${valuesSql}` : ""} FROM ${tableName} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_ROW_COUNT}`, [position.last_rowid_number ?? 0]);
      }
      for (const row of rows) {
        const insert = `${insertInto}${[...(isVirtual ? [row.paging_rowid] : []), ...insertedColumns.map((_, i) => row[`value_${i}`])].join(",")});\n`;
        // The part ends before a row that would take it past partSizeBytes; the next starts with that row.
        if (hasRows && dumpSizeBytes + utf8SizeBytes(insert) > partSizeBytes) return { dumpSql, nextCursor: writeCursor(position), readRowCount };
        add(insert);
        hasRows = true;
        if (keyExpressions.length) position.last_key = keyExpressions.map((_, i) => ({ key_type: row[`key_type_${i}`] as KeyValue["key_type"], key_text: row[`key_text_${i}`] as string | null }));
        else position.last_rowid_number = row.paging_rowid as number;
      }
      if (rows.length < PAGE_ROW_COUNT) break;
    }
    position = null;
  }

  // The rest is small: AUTOINCREMENT's counters, then views, indexes and triggers, made after the rows
  // so triggers don't fire on them, then the end.
  if (entries.some((entry) => entry.name === "sqlite_sequence")) {
    add("DELETE FROM sqlite_sequence;\n");
    for (const counter of select<{ name_sql: string; counter_sql: string }>("SELECT quote(name) AS name_sql, quote(seq) AS counter_sql FROM sqlite_sequence")) add(`INSERT INTO sqlite_sequence VALUES(${counter.name_sql},${counter.counter_sql});\n`);
  }
  for (const entry of entries) {
    if ((entry.type === "view" || entry.type === "index" || entry.type === "trigger") && !entry.table_name.startsWith("sqlite_")) add(`${entry.sql};\n`);
  }
  add(DUMP_END);
  return { dumpSql, nextCursor: null, readRowCount };
}

/** How many bytes text takes as UTF-8, without making the bytes. */
export function utf8SizeBytes(text: string): number {
  let sizeBytes = 0;
  for (let i = 0; i < text.length; i++) {
    const codeUnitNumber = text.charCodeAt(i);
    // A surrogate pair is one character of 4 bytes, 2 for each half.
    sizeBytes += codeUnitNumber < 0x80 ? 1 : codeUnitNumber < 0x800 ? 2 : codeUnitNumber >= 0xd800 && codeUnitNumber < 0xe000 ? 2 : 3;
  }
  return sizeBytes;
}

function writeCursor(position: DumpPosition): string {
  const bytes = new TextEncoder().encode(JSON.stringify(position));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function readCursor(cursor: string): DumpPosition {
  let position: unknown;
  try {
    const binary = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    position = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch {
    throw new DumpCursorError("The cursor isn't one an export answered.");
  }
  const { table_name: tableName, last_rowid_number: lastRowidNumber, last_key: lastKey } = (position ?? {}) as Partial<DumpPosition>;
  const isKey = (key: unknown) => {
    const { key_type: keyType, key_text: keyText } = (key ?? {}) as Partial<KeyValue>;
    return (keyType === "null" ? keyText === null : (keyType === "integer" || keyType === "real" || keyType === "text" || keyType === "blob") && typeof keyText === "string") && (keyType !== "integer" || /^-?\d+$/.test(keyText!)) && (keyType !== "real" || /^-?[0-9.]+(e[+-]?\d+)?$/i.test(keyText!)) && (keyType !== "blob" || /^([0-9A-Fa-f]{2})*$/.test(keyText!));
  };
  if (typeof tableName !== "string" || !(lastRowidNumber === null || Number.isInteger(lastRowidNumber)) || !(lastKey === null || (Array.isArray(lastKey) && lastKey.length > 0 && lastKey.length <= 64 && lastKey.every(isKey)))) throw new DumpCursorError("The cursor isn't one an export answered.");
  return { table_name: tableName, last_rowid_number: lastRowidNumber as number | null, last_key: lastKey as KeyValue[] | null };
}

/**
 * The WHERE for the rows after a key, for ORDER BY the key's columns: one OR per column, each holding the ones before it equal
 * and itself greater (NULLs sort first). The key's values are bound, numbers as text SQLite casts back, so none loses digits.
 */
function keyAfter(keyExpressions: string[], lastKey: KeyValue[] | null): { sql: string; values: DatabaseValue[] } {
  if (!lastKey) return { sql: "", values: [] };
  if (lastKey.length !== keyExpressions.length) throw new DumpCursorError("The cursor isn't one an export answered.");
  const values: DatabaseValue[] = [];
  const operand = (key: KeyValue) => {
    values.push(key.key_type === "blob" ? Uint8Array.from({ length: key.key_text!.length / 2 }, (_, byteIndex) => parseInt(key.key_text!.slice(byteIndex * 2, byteIndex * 2 + 2), 16)) : key.key_text);
    return key.key_type === "integer" ? "CAST(? AS INTEGER)" : key.key_type === "real" ? "CAST(? AS REAL)" : "?";
  };
  const terms = keyExpressions.map((expression, i) => {
    const conditions = keyExpressions.slice(0, i).map((earlier, earlierIndex) => (lastKey[earlierIndex]!.key_type === "null" ? `${earlier} IS NULL` : `${earlier} IS ${operand(lastKey[earlierIndex]!)}`));
    conditions.push(lastKey[i]!.key_type === "null" ? `${expression} IS NOT NULL` : `${expression} > ${operand(lastKey[i]!)}`);
    return `(${conditions.join(" AND ")})`;
  });
  return { sql: terms.join(" OR "), values };
}

/** A statement of a dump, ready to run: its SQL, the values for its ?s, and which statement of the part it came from (from 1). */
export interface ImportStatement {
  sql: string;
  values: DatabaseValue[];
  statementNumber: number;
}

/** What a part of a dump runs: its statements, and how many it left out (the transaction and settings sqlite3 writes around them). */
export interface ImportPlan {
  statements: ImportStatement[];
  statementCount: number;
  skippedStatementCount: number;
}

const IMPORT_FIX = "Import takes a dump's CREATE and INSERT statements, as sqlite3's .dump or export_database writes them; it only adds. Run other changes with query_database or batch_database.";

/** The name a statement starts with after `CREATE TABLE [IF NOT EXISTS]` or `INSERT INTO`, however it's quoted. */
function tableNameAfter(text: string, introduction: RegExp): string | null {
  const match = new RegExp(`^${introduction.source}\\s*(?:"((?:[^"]|"")*)"|'((?:[^']|'')*)'|\`([^\`]*)\`|\\[([^\\]]*)\\]|(\\w+))`, "i").exec(text);
  if (!match) return null;
  const [, doubleQuoted, singleQuoted, backQuoted, bracketed, bare] = match;
  return doubleQuoted?.replaceAll('""', '"') ?? singleQuoted?.replaceAll("''", "'") ?? backQuoted ?? bracketed ?? bare ?? null;
}

/** The shadow tables an FTS5 table makes for itself: sqlite3's .dump writes them as ordinary tables, and a search table makes them again. */
const FTS5_SHADOW_SUFFIXES = ["data", "idx", "content", "docsize", "config"] as const;

/** A search table sqlite3's .dump creates by writing to the schema table: its CREATE VIRTUAL TABLE, and the columns its rows go in by. */
interface DumpedSearchTable {
  name: string;
  createSql: string;
  columnNames: string[];
}

const SEARCH_TABLE_FIX = "Import takes a search table made with fts5. For others, import the database file instead: npx @zaisma/cli database import <slug> game.sqlite.";

/** The columns of an fts5(…) table from its CREATE VIRTUAL TABLE: the arguments that aren't options (name=value). */
function searchColumnNames(createSql: string): string[] {
  const openIndex = createSql.indexOf("(", createSql.search(/fts5/i));
  const closeIndex = createSql.lastIndexOf(")");
  if (openIndex === -1 || closeIndex <= openIndex) return [];
  const argumentTexts: string[] = [];
  let current = "";
  let openParenthesisCount = 0;
  let quote: string | null = null;
  for (const character of createSql.slice(openIndex + 1, closeIndex)) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
      current += character;
    } else if (character === "(") {
      openParenthesisCount++;
      current += character;
    } else if (character === ")") {
      openParenthesisCount--;
      current += character;
    } else if (character === "," && openParenthesisCount === 0) {
      argumentTexts.push(current);
      current = "";
    } else current += character;
  }
  argumentTexts.push(current);
  const names: string[] = [];
  for (const argument of argumentTexts) {
    const trimmed = argument.trim();
    if (!trimmed || /^[\w.]+\s*=/.test(trimmed)) continue;
    const first = /^(?:"((?:[^"]|"")*)"|'([^']*)'|`([^`]*)`|\[([^\]]*)\]|(\w+))/.exec(trimmed);
    const name = first?.[1]?.replaceAll('""', '"') ?? first?.[2] ?? first?.[3] ?? first?.[4] ?? first?.[5];
    if (name) names.push(name);
  }
  return names;
}

/**
 * Reads a part of a dump into the statements to run. Import only adds: it takes CREATE and INSERT
 * statements, and leaves out what sqlite3 writes around them (the transaction, PRAGMAs, ANALYZE and its
 * sqlite_stat1 rows). The values in an INSERT become values for ?s, since Zaisma's database takes
 * statements up to 100 KB and a row of a dump can be bigger; unistr('…'), which sqlite3 writes for text with
 * line breaks, becomes the text it stands for. AUTOINCREMENT's counters only ever go up. The tables are made
 * first, so a row can refer to a table made after it. A search table in sqlite3's own dump (its
 * `INSERT INTO sqlite_schema` under writable_schema, and its shadow tables) becomes its CREATE VIRTUAL TABLE, filled again
 * from its _content rows with their rowids.
 */
export function importStatements(dumpSql: string): ImportPlan {
  const statements: ImportStatement[] = [];
  const scanned = scanStatements(dumpSql);
  let skippedStatementCount = 0;
  const textOf = (scannedStatement: (typeof scanned)[number]) => dumpSql.slice(scannedStatement.startIndex, scannedStatement.endIndex);
  const refuseAt = (statementNumber: number, text: string, message: string, fix: string = IMPORT_FIX) => new DatabaseError("bad_sql", `Statement ${statementNumber} of the dump (${preview(text)}): ${message}`, fix);

  // sqlite3's .dump creates a virtual table by writing its row in the schema table: those come first, so the shadow tables are known.
  const searchTables = new Map<number, DumpedSearchTable>();
  const shadowNames = new Map<string, DumpedSearchTable & { suffix: string }>();
  scanned.forEach((scannedStatement, i) => {
    const [firstWord = "", secondWord = "", thirdWord = ""] = scannedStatement.leadingWords;
    if (!(firstWord === "INSERT" && secondWord === "INTO" && (thirdWord === "SQLITE_SCHEMA" || thirdWord === "SQLITE_MASTER"))) return;
    const text = textOf(scannedStatement);
    const match = /^INSERT\s+INTO\s+sqlite_(?:schema|master)\s*\([^)]*\)\s*VALUES\s*\(\s*'table'\s*,\s*'((?:[^']|'')*)'\s*,\s*'(?:[^']|'')*'\s*,\s*\d+\s*,\s*'((?:[^']|'')*)'\s*\)$/i.exec(text);
    const createSql = match?.[2]?.replaceAll("''", "'");
    if (!match || !createSql || !/^CREATE\s+VIRTUAL\s+TABLE\s/i.test(createSql)) throw refuseAt(i + 1, text, "it writes to the schema table, and only a virtual table's can be read from there.");
    if (!/\bUSING\s+fts5\b/i.test(createSql)) throw refuseAt(i + 1, text, "this virtual table isn't an fts5 search table.", SEARCH_TABLE_FIX);
    const name = match[1]!.replaceAll("''", "'");
    const table = { name, createSql, columnNames: searchColumnNames(createSql) };
    searchTables.set(i, table);
    for (const suffix of FTS5_SHADOW_SUFFIXES) shadowNames.set(`${name}_${suffix}`.toLowerCase(), { ...table, suffix });
  });

  scanned.forEach((scannedStatement, i) => {
    const statementNumber = i + 1;
    const text = textOf(scannedStatement);
    const [firstWord = "", secondWord = "", thirdWord = ""] = scannedStatement.leadingWords;
    const words = scannedStatement.leadingWords.join(" ");
    const isSkipped =
      ["BEGIN", "COMMIT", "END", "ROLLBACK", "ANALYZE"].includes(firstWord) ||
      (firstWord === "PRAGMA" && (secondWord === "FOREIGN_KEYS" || secondWord === "WRITABLE_SCHEMA")) ||
      /^CREATE TABLE (IF NOT EXISTS )?SQLITE_SEQUENCE$/.test(words) ||
      words === "DELETE FROM SQLITE_SEQUENCE" ||
      (firstWord === "INSERT" && secondWord === "INTO" && (thirdWord === "SQLITE_STAT1" || thirdWord === "SQLITE_STAT4"));
    if (isSkipped) {
      skippedStatementCount++;
      return;
    }
    const refuse = (message: string) => refuseAt(statementNumber, text, message);
    if (firstWord === "INSERT" && secondWord === "INTO" && (thirdWord === "SQLITE_SCHEMA" || thirdWord === "SQLITE_MASTER")) {
      statements.push({ sql: searchTables.get(i)!.createSql, values: [], statementNumber });
      return;
    }
    if (shadowNames.size) {
      const shadow = shadowNames.get(tableNameAfter(text, firstWord === "CREATE" ? /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?/ : /INSERT\s+INTO/)?.toLowerCase() ?? "");
      if (shadow && (firstWord === "CREATE" || firstWord === "INSERT")) {
        if (firstWord === "CREATE" || shadow.suffix !== "content") {
          skippedStatementCount++;
          return;
        }
        // The rows of a search table are in its _content, by rowid; they go back in through the table itself.
        const bound = bindLiterals(text, refuse);
        const insertInto = `INSERT INTO ${quoteName(shadow.name)}(${["rowid", ...shadow.columnNames.map(quoteName)].join(",")}) VALUES(`;
        const replaced = bound.sql.replace(/^INSERT\s+INTO\s+(?:"(?:[^"]|"")*"|\w+)\s+VALUES\s*\(/i, insertInto);
        if (replaced === bound.sql) throw refuse("a search table's content rows are INSERT INTO \"name_content\" VALUES(…).");
        if (bound.values.length > DATABASE_LIMITS.maximumValueCount) throw new DatabaseError("bad_values", `Statement ${statementNumber} of the dump (${preview(text)}) has ${bound.values.length} text and blob values.`, `Give each row its own INSERT, as sqlite3's .dump does: the database takes up to ${DATABASE_LIMITS.maximumValueCount} values a statement.`);
        statements.push({ sql: replaced, values: bound.values, statementNumber });
        return;
      }
    }
    if (firstWord === "CREATE") {
      statements.push({ sql: text, values: [], statementNumber });
      return;
    }
    if (firstWord !== "INSERT") throw refuse(`${firstWord || "it"} isn't a CREATE or INSERT.`);
    if (secondWord === "OR" && thirdWord === "REPLACE") throw refuse("INSERT OR REPLACE changes rows that are there.");
    const bound = bindLiterals(text, refuse);
    if (thirdWord === "SQLITE_SEQUENCE") {
      // sqlite_sequence has a row per table and no key: set the counter, never lower it.
      const counterMatch = /VALUES\s*\(\s*\?\s*,\s*(\d+)\s*\)$/i.exec(bound.sql);
      if (!counterMatch || bound.values.length !== 1) throw refuse("sqlite_sequence takes a table's name and its counter, like INSERT INTO sqlite_sequence VALUES('scores',12).");
      const tableName = bound.values[0]!;
      const counter = counterMatch[1]!;
      // The counter goes in the SQL (it's digits only): bound, a number would be stored as a REAL.
      statements.push({ sql: `INSERT INTO sqlite_sequence (name, seq) SELECT ?, ${counter} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)`, values: [tableName, tableName], statementNumber });
      statements.push({ sql: `UPDATE sqlite_sequence SET seq = max(seq, ${counter}) WHERE name = ?`, values: [tableName], statementNumber });
      return;
    }
    if (bound.values.length > DATABASE_LIMITS.maximumValueCount) throw new DatabaseError("bad_values", `Statement ${statementNumber} of the dump (${preview(text)}) has ${bound.values.length} text and blob values.`, `Give each row its own INSERT, as sqlite3's .dump does: the database takes up to ${DATABASE_LIMITS.maximumValueCount} values a statement.`);
    statements.push({ sql: bound.sql, values: bound.values, statementNumber });
  });
  // Tables first, in the order given, then the rest in theirs: a row may refer to a table made after it.
  const isTable = (statement: ImportStatement) => /^CREATE\s+(?:VIRTUAL\s+)?TABLE\s/i.test(statement.sql);
  return { statements: [...statements.filter(isTable), ...statements.filter((statement) => !isTable(statement))], statementCount: scanned.length, skippedStatementCount };
}

/** The start of a statement, for an error. */
export function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine;
}

/**
 * An INSERT with its text and blob literals as ?s, and their values: 'it''s' becomes "it's", X'00ff' the
 * bytes and unistr('a\u000ab') the text it stands for. Numbers, NULL and names stay as they are.
 */
function bindLiterals(text: string, refuse: (message: string) => DatabaseError): { sql: string; values: DatabaseValue[] } {
  const values: DatabaseValue[] = [];
  let sql = "";
  let i = 0;
  /** The text of the 'quoted' literal starting at startIndex, and where it ends. */
  const readQuoted = (startIndex: number) => {
    let endIndex = startIndex + 1;
    let literal = "";
    while (endIndex < text.length) {
      if (text[endIndex] === "'") {
        if (text[endIndex + 1] !== "'") return { literal, endIndex: endIndex + 1 };
        literal += "'";
        endIndex += 2;
      } else literal += text[endIndex++];
    }
    throw refuse("a quote isn't closed.");
  };
  const isWordCharacter = (character: string | undefined) => character !== undefined && /[A-Za-z0-9_$]/.test(character);
  while (i < text.length) {
    const character = text[i]!;
    const afterWord = isWordCharacter(text[i - 1]);
    if (character === "-" && text[i + 1] === "-") {
      const endIndex = text.indexOf("\n", i);
      i = endIndex === -1 ? text.length : endIndex + 1;
      sql += " ";
    } else if (character === "/" && text[i + 1] === "*") {
      const endIndex = text.indexOf("*/", i + 2);
      i = endIndex === -1 ? text.length : endIndex + 2;
      sql += " ";
    } else if (character === '"' || character === "`" || character === "[") {
      // A name: copied as it is.
      const close = character === "[" ? "]" : character;
      let endIndex = i + 1;
      while (endIndex < text.length && !(text[endIndex] === close && text[endIndex + 1] !== close)) endIndex += text[endIndex] === close ? 2 : 1;
      sql += text.slice(i, endIndex + 1);
      i = endIndex + 1;
    } else if (character === "'") {
      const { literal, endIndex } = readQuoted(i);
      values.push(literal);
      sql += "?";
      i = endIndex;
    } else if ((character === "x" || character === "X") && text[i + 1] === "'" && !afterWord) {
      const { literal, endIndex } = readQuoted(i + 1);
      if (literal.length % 2 || /[^0-9A-Fa-f]/.test(literal)) throw refuse(`X'${literal.slice(0, 20)}' isn't bytes in hex.`);
      values.push(Uint8Array.from({ length: literal.length / 2 }, (_, byteIndex) => parseInt(literal.slice(byteIndex * 2, byteIndex * 2 + 2), 16)));
      sql += "?";
      i = endIndex;
    } else if (!afterWord && /^unistr\s*\(\s*'/i.test(text.slice(i, i + 40))) {
      const quoteIndex = text.indexOf("'", i);
      const { literal, endIndex } = readQuoted(quoteIndex);
      const closeMatch = /^\s*\)/.exec(text.slice(endIndex));
      if (!closeMatch) throw refuse("unistr( takes one 'text'.");
      values.push(literal.replace(/\\(\\|u[0-9A-Fa-f]{4}|\+[0-9A-Fa-f]{6}|U[0-9A-Fa-f]{8}|[0-9A-Fa-f]{4})/g, (_, escape: string) => (escape === "\\" ? "\\" : String.fromCodePoint(parseInt(escape.replace(/^[uU+]/, ""), 16)))));
      sql += "?";
      i = endIndex + closeMatch[0].length;
    } else if (isWordCharacter(character)) {
      let endIndex = i + 1;
      while (isWordCharacter(text[endIndex])) endIndex++;
      sql += text.slice(i, endIndex);
      i = endIndex;
    } else {
      sql += character;
      i++;
    }
  }
  return { sql, values };
}
