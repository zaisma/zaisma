import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DatabaseError, dumpPart, importStatements, scanStatements, utf8SizeBytes } from "../../packages/game-server/src/index.ts";
import { dumpParts, nodeRead, trickyDatabase } from "./dump-fixtures.ts";

// The game database's SQL dump (packages/game-server/src/dump.ts), over Node's own SQLite: the same reading
// Zaisma's Durable Object does, and what the upload command's .sqlite files hold.

describe("the SQL dump", () => {
  it("writes what sqlite3 needs to make the same database, triggers after the rows", () => {
    const [dumpSql] = dumpParts(trickyDatabase());
    expect(dumpSql!.split("\n").filter((line) => !line.startsWith("CREATE"))).toEqual([
      "PRAGMA foreign_keys=OFF;",
      "BEGIN TRANSACTION;",
      `INSERT INTO "players"("id","name","speed","replay") VALUES(1,'it''s`,
      `me; -- not a comment',2.0,X'000102FF');`,
      `INSERT INTO "players"("id","name","speed","replay") VALUES(2,'Ünïcode 🎮',NULL,NULL);`,
      `INSERT INTO "inventories" VALUES(1,'apple',7);`,
      `INSERT INTO "inventories" VALUES(1,'golden_wing',2);`,
      `INSERT INTO "inventories" VALUES(2,'boots',1);`,
      `INSERT INTO "odd ""name""" VALUES('/* not */','x');`,
      "DELETE FROM sqlite_sequence;",
      "INSERT INTO sqlite_sequence VALUES('players',3);",
      "COMMIT;",
      "",
    ]);
    expect(dumpSql!.indexOf("CREATE TRIGGER")).toBeGreaterThan(dumpSql!.indexOf("INSERT INTO sqlite_sequence"));
    const copy = new DatabaseSync(":memory:");
    copy.exec(dumpSql!);
    expect(dumpParts(copy)).toEqual([dumpSql]);
    expect(copy.prepare("SELECT speed FROM players ORDER BY id").all()).toEqual([{ speed: 2 }, { speed: null }]);
  });

  it("cuts parts at whole rows, never past the size unless one row is bigger, and they add up to the whole dump", () => {
    const database = trickyDatabase();
    const [whole] = dumpParts(database);
    const parts = dumpParts(database, 120);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.join("")).toBe(whole);
    for (const part of parts) {
      expect(part.endsWith(";\n")).toBe(true);
      const statementCount = scanStatements(part).length;
      if (statementCount > 1) expect(utf8SizeBytes(part)).toBeLessThanOrEqual(120 + "DELETE FROM sqlite_sequence;\n".length * 20);
    }
  });

  it("refuses a cursor it didn't write", () => {
    expect(() => dumpPart(nodeRead(trickyDatabase()), "nonsense")).toThrow("The cursor isn't one an export answered.");
  });

  it("counts UTF-8 bytes", () => {
    for (const text of ["plain", "Ünïcode", "🎮 games", "日本語"]) expect(utf8SizeBytes(text)).toBe(Buffer.byteLength(text));
  });
});

describe("reading a dump to import", () => {
  it("keeps a trigger's BEGIN … END as one statement, and ; in quotes and comments", () => {
    const statements = scanStatements("CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET c = ';'; DELETE FROM d; END; -- a; comment\nINSERT INTO a VALUES('x;y'); /* ; */ SELECT 1");
    expect(statements.map((statement) => statement.leadingWords.slice(0, 2))).toEqual([["CREATE", "TRIGGER"], ["INSERT", "INTO"], ["SELECT", "1"]]);
  });

  it("binds text and blobs as values, decodes unistr, leaves out what sqlite3 writes around a dump, and only raises counters", () => {
    const plan = importStatements("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nINSERT INTO \"t\" VALUES(1,'it''s',X'00ff',unistr('a\\u000ab\\\\'),2.5,NULL);\nINSERT INTO sqlite_sequence VALUES('t',9);\nCOMMIT;");
    expect(plan).toMatchObject({ statementCount: 5, skippedStatementCount: 3 });
    expect(plan.statements[0]).toEqual({ sql: 'INSERT INTO "t" VALUES(1,?,?,?,2.5,NULL)', values: ["it's", new Uint8Array([0, 255]), "a\nb\\"], statementNumber: 3 });
    expect(plan.statements.slice(1).map((statement) => statement.sql)).toEqual([
      "INSERT INTO sqlite_sequence (name, seq) SELECT ?, 9 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)",
      "UPDATE sqlite_sequence SET seq = max(seq, 9) WHERE name = ?",
    ]);
  });

  it("imports its own dump into Node's SQLite the same way", () => {
    const [dumpSql] = dumpParts(trickyDatabase());
    const copy = new DatabaseSync(":memory:");
    for (const statement of importStatements(dumpSql!).statements) copy.prepare(statement.sql).run(...(statement.values as never[]));
    expect(dumpParts(copy)).toEqual([dumpSql]);
  });

  it("refuses what isn't a CREATE or INSERT, naming the statement", () => {
    const refusal = (dumpSql: string) => {
      try {
        importStatements(dumpSql);
      } catch (error) {
        return error as DatabaseError;
      }
      throw new Error("not refused");
    };
    expect(refusal("CREATE TABLE a (b);\nDROP TABLE a;")).toMatchObject({ code: "bad_sql", message: expect.stringContaining("Statement 2 of the dump (DROP TABLE a): DROP isn't a CREATE or INSERT.") });
    expect(refusal("PRAGMA journal_mode=WAL;").code).toBe("bad_sql");
    expect(refusal("INSERT INTO a VALUES(X'0g');").message).toContain("isn't bytes in hex");
    expect(refusal(`INSERT INTO a VALUES(${Array.from({ length: 101 }, () => "'x'").join(",")});`).code).toBe("bad_values");
  });
});
