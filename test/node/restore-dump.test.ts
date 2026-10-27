import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript without type declarations
import { ORDERED_DUMP_HEADER, writeImportParts } from "../../scripts/restore-dump.mjs";

// The main database's dump made ready for D1's import (scripts/restore-dump.mjs): parents first, in parts that
// each import on their own, at any size.

const folder = mkdtempSync(join(tmpdir(), "restore-dump-"));
const statementsOf = (paths: string[]) =>
  paths
    .map((path) => readFileSync(path, "utf8"))
    .join("")
    .split(";\n")
    .filter((text) => text && !text.startsWith("PRAGMA"));

describe("a dump made ready for D1's import", () => {
  it("puts an older dump's tables after the tables they refer to", async () => {
    const dumpPath = join(folder, "older.sql");
    writeFileSync(
      dumpPath,
      [
        "PRAGMA defer_foreign_keys=TRUE",
        "CREATE TABLE games (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES owners(id))",
        `INSERT INTO "games"("id","owner_id") VALUES('game_1','owner_1')`,
        "CREATE TABLE owners (id TEXT PRIMARY KEY)",
        `INSERT INTO "owners"("id") VALUES('owner_1')`,
        "CREATE INDEX games_by_owner ON games(owner_id)",
      ].map((text) => `${text};\n`).join(""),
    );
    const paths: string[] = await writeImportParts(dumpPath);
    expect(paths).toHaveLength(1);
    expect(readFileSync(paths[0]!, "utf8").startsWith("PRAGMA defer_foreign_keys=TRUE;\n")).toBe(true);
    expect(statementsOf(paths)).toEqual([
      "CREATE TABLE owners (id TEXT PRIMARY KEY)",
      `INSERT INTO "owners"("id") VALUES('owner_1')`,
      "CREATE TABLE games (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES owners(id))",
      `INSERT INTO "games"("id","owner_id") VALUES('game_1','owner_1')`,
      "CREATE INDEX games_by_owner ON games(owner_id)",
    ]);
  });

  it("splits an ordered dump as it streams, between statements, past a read's end", async () => {
    const dumpPath = join(folder, "ordered.sql");
    const filler = "x".repeat(1000);
    const rows = Array.from({ length: 10_000 }, (_, index) => `INSERT INTO "notes"("id","body") VALUES('note_${index}','${index === 8_400 ? "one;\nand two" : filler}')`);
    writeFileSync(dumpPath, `${ORDERED_DUMP_HEADER}\nPRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT);\n${rows.map((text) => `${text};\n`).join("")}`);
    const paths: string[] = await writeImportParts(dumpPath, 2 * 1024 * 1024);
    // 10 MB of rows, past the 8 MB read, in parts of up to 2 MB.
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const path of paths) expect(readFileSync(path, "utf8").startsWith("PRAGMA defer_foreign_keys=TRUE;\n")).toBe(true);
    const statements = paths.flatMap((path) => readFileSync(path, "utf8").slice("PRAGMA defer_foreign_keys=TRUE;\n".length).split(/;\n(?=INSERT|CREATE|$)/)).filter(Boolean);
    expect(statements[0]).toBe("CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)");
    expect(statements.slice(1)).toEqual(rows);
  });
});
