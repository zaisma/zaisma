// The main database's dump, made ready for D1's import (scripts/restore.mjs): each table and its rows after the
// tables it refers to, as backups now write it (apps/site/src/backups.ts, mainDatabaseDump), and in parts
// small enough for one import each. D1's import checks foreign keys as it goes and resets the database on a
// row whose parent isn't in yet; it took 300 MB in about a minute and refused 1 GB in one go (Oct 27, 2026).

import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { scanStatements } from "../packages/game-server/src/database.ts";

/** The most SQL one import takes from the restore: 300 MB went in whole, so parts stay under that. */
export const IMPORT_PART_SIZE_BYTES = 250 * 1024 * 1024;
/** The first line of a dump written in reference order (apps/site/src/backups.ts, MAIN_DATABASE_DUMP_HEADER). */
export const ORDERED_DUMP_HEADER = "-- Zaisma's main database: each table after the tables it refers to.";
/** An older dump is reordered whole in memory: they were all small, and a string can't hold much more. */
const REORDERED_DUMP_MAXIMUM_SIZE_BYTES = 256 * 1024 * 1024;
/** SQL read at a time while splitting an ordered dump. */
const READ_SIZE_BYTES = 8 * 1024 * 1024;

/** The dump's statements by table, the tables in reference order (parents first), and the rest (indexes, views, triggers). */
export function dumpInReferenceOrder(dumpPath) {
  const dumpSql = readFileSync(dumpPath, "utf8");
  const statements = scanStatements(dumpSql).map((statement) => dumpSql.slice(statement.startIndex, statement.endIndex));
  const tableNameOf = (text) => (/^CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i.exec(text) ?? /^INSERT\s+INTO\s+"?(\w+)"?\s*\(/i.exec(text))?.[1]?.toLowerCase() ?? null;
  const groups = new Map();
  const rest = [];
  for (const text of statements) {
    if (/^PRAGMA\b/i.test(text)) continue;
    const tableName = tableNameOf(text);
    if (tableName) groups.set(tableName, [...(groups.get(tableName) ?? []), text]);
    else rest.push(text);
  }
  const referencesOf = (tableName) => [...(groups.get(tableName)?.[0] ?? "").matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map((match) => match[1].toLowerCase()).filter((name) => name !== tableName && groups.has(name));
  const ordered = [];
  const placed = new Set();
  const place = (tableName, path = new Set()) => {
    if (placed.has(tableName) || path.has(tableName)) return;
    path.add(tableName);
    for (const parent of referencesOf(tableName)) place(parent, path);
    placed.add(tableName);
    ordered.push(tableName);
  };
  for (const tableName of groups.keys()) place(tableName);
  return { groups, ordered, rest };
}

/**
 * The dump in parts of up to partSizeBytes for D1's import, cut between statements, each deferring foreign keys
 * to its own end, so a part's rows refer only to tables in it or before it. A dump written in reference order
 * is split as it streams, at any size; an older one is put in that order first. Answers the parts' paths, in order.
 */
export async function writeImportParts(dumpPath, partSizeBytes = IMPORT_PART_SIZE_BYTES) {
  const paths = [];
  let part = "";
  let partSize = 0;
  const flush = () => {
    if (!partSize) return;
    const path = `${dumpPath}.part-${paths.length + 1}.sql`;
    writeFileSync(path, `PRAGMA defer_foreign_keys=TRUE;\n${part}`);
    paths.push(path);
    part = "";
    partSize = 0;
  };
  const add = (text) => {
    if (/^PRAGMA\b/i.test(text)) return;
    const line = `${text};\n`;
    const lineSize = Buffer.byteLength(line);
    if (partSize && partSize + lineSize > partSizeBytes) flush();
    part += line;
    partSize += lineSize;
  };
  if (isOrderedDump(dumpPath)) {
    // The last statement read may be cut off mid-way: it waits for the next read.
    let held = "";
    for await (const chunk of createReadStream(dumpPath, { encoding: "utf8", highWaterMark: READ_SIZE_BYTES })) {
      held += chunk;
      const statements = scanStatements(held);
      const last = statements.pop();
      for (const statement of statements) add(held.slice(statement.startIndex, statement.endIndex));
      held = last ? held.slice(last.startIndex) : "";
    }
    for (const statement of scanStatements(held)) add(held.slice(statement.startIndex, statement.endIndex));
  } else {
    if (statSync(dumpPath).size > REORDERED_DUMP_MAXIMUM_SIZE_BYTES) throw new Error(`${dumpPath} isn't in reference order and is too big to reorder in memory.`);
    const { groups, ordered, rest } = dumpInReferenceOrder(dumpPath);
    for (const text of [...ordered.flatMap((tableName) => groups.get(tableName)), ...rest]) add(text);
  }
  flush();
  return paths;
}

/** Whether the dump starts with the line backups write since they put tables in reference order. */
function isOrderedDump(dumpPath) {
  const file = openSync(dumpPath, "r");
  const start = Buffer.alloc(ORDERED_DUMP_HEADER.length);
  readSync(file, start, 0, start.length, 0);
  closeSync(file);
  return start.toString("utf8") === ORDERED_DUMP_HEADER;
}
