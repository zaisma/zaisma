import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DATABASE_LIMITS, DatabaseError, checkStatement, dumpPart, importStatements, scanStatements, utf8SizeBytes } from "../../packages/game-server/src/internal.ts";
import { dumpParts, importInto, nodeRead, trickyDatabase } from "./dump-fixtures.ts";

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
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.join("")).toBe(whole);
    // The first part holds every CREATE TABLE, whatever its size.
    for (const part of parts.slice(1)) {
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

describe("a dump Zaisma wrote comes back whole", () => {
  it("makes every table before any row, so a row can refer to a table made after it, and imports in one transaction", () => {
    const source = new DatabaseSync(":memory:");
    source.exec(`
      CREATE TABLE comments (id INTEGER PRIMARY KEY, reply_to INTEGER REFERENCES comments (id), post_id INTEGER REFERENCES posts (id));
      CREATE TABLE posts (id INTEGER PRIMARY KEY);
      INSERT INTO posts VALUES (5);
      INSERT INTO comments VALUES (1, 2, 5), (2, NULL, 5);
    `);
    const dumpSql = dumpParts(source).join("");
    expect(dumpSql.lastIndexOf("CREATE TABLE")).toBeLessThan(dumpSql.indexOf("INSERT INTO"));
    const copy = new DatabaseSync(":memory:");
    importInto(copy, dumpSql);
    expect(copy.prepare("SELECT id, reply_to FROM comments ORDER BY id").all()).toEqual([{ id: 1, reply_to: 2 }, { id: 2, reply_to: null }]);

    // sqlite3 writes a table's rows straight after its CREATE: import makes the tables first.
    const ordered = importStatements("CREATE TABLE a (id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b (id));\nINSERT INTO a VALUES(1,1);\nCREATE TABLE b (id INTEGER PRIMARY KEY);\nINSERT INTO b VALUES(1);\nCREATE INDEX a_by_b ON a (b_id);");
    expect(ordered.statements.map((statement) => statement.sql.slice(0, 12))).toEqual(["CREATE TABLE", "CREATE TABLE", "INSERT INTO ", "INSERT INTO ", "CREATE INDEX"]);
  });

  it("brings back a value past 1 MB that SQL made, which a game server's own values can't be", () => {
    const source = new DatabaseSync(":memory:");
    source.exec("CREATE TABLE worlds (id INTEGER PRIMARY KEY, world_json TEXT, replay BLOB)");
    source.prepare("INSERT INTO worlds VALUES (1, hex(zeroblob(750000)), zeroblob(1500000))").run();
    const [dumpSql] = dumpParts(source);
    const { statements } = importStatements(dumpSql!);
    const insert = statements.find((statement) => statement.sql.startsWith("INSERT"))!;
    expect(() => checkStatement(insert.sql, insert.values)).toThrow(/Value 1 is 1500000 bytes/);
    const copy = new DatabaseSync(":memory:");
    importInto(copy, dumpSql!);
    expect(copy.prepare("SELECT length(world_json) AS text_length, length(replay) AS blob_length FROM worlds").all()).toEqual([{ text_length: 1500000, blob_length: 1500000 }]);
    for (const statement of statements) checkStatement(statement.sql, statement.values, DATABASE_LIMITS.maximumImportValueSizeBytes);
  });

  it("brings a search table back with the same rowids, gaps and all", () => {
    const source = new DatabaseSync(":memory:");
    source.exec("CREATE VIRTUAL TABLE lore USING fts5(title, body)");
    source.exec("INSERT INTO lore (rowid, title, body) VALUES (3, 'Dragons', 'fire and ice'), (10, 'Elves', 'trees'), (400, 'Dwarves', 'stone')");
    const [dumpSql] = dumpParts(source);
    expect(dumpSql).toContain(`INSERT INTO "lore"(rowid,"title","body") VALUES(10,'Elves','trees');`);
    const copy = new DatabaseSync(":memory:");
    importInto(copy, dumpSql!);
    expect(copy.prepare("SELECT rowid, title FROM lore ORDER BY rowid").all()).toEqual([{ rowid: 3, title: "Dragons" }, { rowid: 10, title: "Elves" }, { rowid: 400, title: "Dwarves" }]);
    expect(copy.prepare("SELECT rowid FROM lore WHERE lore MATCH 'stone'").all()).toEqual([{ rowid: 400 }]);
  });

  it("imports what sqlite3's own .dump writes for a search table: its CREATE VIRTUAL TABLE, its rows under their rowids, no shadow tables", () => {
    // sqlite3 3.54's .dump of: CREATE VIRTUAL TABLE lore USING fts5(title, body, tokenize='porter'); two rows at rowids 3 and 10; a table that refers to one.
    const sqlite3Dump = `/* WARNING: Script requires that SQLITE_DBCONFIG_DEFENSIVE be disabled */
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
PRAGMA writable_schema=ON;
INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql)VALUES('table','lore','lore',0,'CREATE VIRTUAL TABLE lore USING fts5(title, body, tokenize=''porter'')');
CREATE TABLE IF NOT EXISTS 'lore_data'(id INTEGER PRIMARY KEY, block BLOB);
INSERT INTO lore_data VALUES(1,x'020404');
INSERT INTO lore_data VALUES(137438953473,x'0000004c0430616e6403060101030106647261676f6e0302020103656c760a');
CREATE TABLE IF NOT EXISTS 'lore_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
INSERT INTO lore_idx VALUES(1,x'',2);
CREATE TABLE IF NOT EXISTS 'lore_content'(id INTEGER PRIMARY KEY, c0, c1);
INSERT INTO lore_content VALUES(3,'Dragons','Fire and ice');
INSERT INTO lore_content VALUES(10,'It''s elves','Trees');
CREATE TABLE IF NOT EXISTS 'lore_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
INSERT INTO lore_docsize VALUES(3,x'0103');
CREATE TABLE IF NOT EXISTS 'lore_config'(k PRIMARY KEY, v) WITHOUT ROWID;
INSERT INTO lore_config VALUES('version',4);
CREATE TABLE notes(id INTEGER PRIMARY KEY, lore_id INTEGER);
INSERT INTO notes VALUES(1,10);
PRAGMA writable_schema=OFF;
COMMIT;
`;
    const plan = importStatements(sqlite3Dump);
    expect(plan.statementCount).toBe(20);
    // The writable_schema lines, the shadow tables' CREATEs (5) and their rows (6) are left out.
    expect(plan.skippedStatementCount).toBe(2 + 2 + 5 + 6 + 0);
    expect(plan.statements.map((statement) => statement.sql.replace(/\(.*/s, ""))).toEqual(["CREATE VIRTUAL TABLE lore USING fts5", "CREATE TABLE notes", `INSERT INTO "lore"`, `INSERT INTO "lore"`, "INSERT INTO notes VALUES"]);
    const copy = new DatabaseSync(":memory:");
    importInto(copy, sqlite3Dump);
    expect(copy.prepare("SELECT rowid, title, body FROM lore ORDER BY rowid").all()).toEqual([{ rowid: 3, title: "Dragons", body: "Fire and ice" }, { rowid: 10, title: "It's elves", body: "Trees" }]);
    expect(copy.prepare("SELECT rowid FROM lore WHERE lore MATCH 'dragon'").all()).toEqual([{ rowid: 3 }]);
    expect(copy.prepare("SELECT lore_id FROM notes").all()).toEqual([{ lore_id: 10 }]);
    // Zaisma's own export of what it made reads back the same.
    expect(dumpParts(copy).join("")).toContain(`INSERT INTO "lore"(rowid,"title","body") VALUES(10,'It''s elves','Trees');`);
  });

  it("refuses a virtual table that isn't an fts5 table, and a write to the schema table that isn't a virtual table", () => {
    const refusal = (dumpSql: string) => {
      try {
        importStatements(dumpSql);
      } catch (error) {
        return error as DatabaseError;
      }
      throw new Error("not refused");
    };
    expect(refusal("INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql)VALUES('table','boxes','boxes',0,'CREATE VIRTUAL TABLE boxes USING rtree(id, x0, x1)');")).toMatchObject({ code: "bad_sql", fix: expect.stringContaining("database import <slug> game.sqlite") });
    expect(refusal("INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql)VALUES('table','a','a',2,'CREATE TABLE a (b)');").message).toContain("writes to the schema table");
  });

  it("keeps every row the game never touched when it deletes an exported row between parts (WITHOUT ROWID), and none twice", () => {
    const source = new DatabaseSync(":memory:");
    source.exec("CREATE TABLE inventories (player_id TEXT, item TEXT, item_count INTEGER, PRIMARY KEY (player_id, item)) WITHOUT ROWID");
    const insert = source.prepare("INSERT INTO inventories VALUES (?, ?, 1)");
    for (let i = 0; i < 40; i++) insert.run(`player_${String(i % 4)}`, `item_${String(i).padStart(2, "0")}`);
    const parts: string[] = [];
    let cursor: string | null = null;
    do {
      const part = dumpPart(nodeRead(source), cursor, 400);
      parts.push(part.dumpSql);
      cursor = part.nextCursor;
      // After the first part, the game deletes the first row, which that part already holds.
      if (parts.length === 1) source.exec("DELETE FROM inventories WHERE item = 'item_00'");
    } while (cursor);
    expect(parts.length).toBeGreaterThan(3);
    const items = parts.join("").match(/'item_\d+'/g)!;
    expect(items.length).toBe(40);
    expect(new Set(items).size).toBe(40);
  });

  it("imports an export taken while the game replaced a row it had already exported (INSERT OR REPLACE)", () => {
    const source = new DatabaseSync(":memory:");
    source.exec("CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)");
    const insert = source.prepare("INSERT INTO scores VALUES (?, ?)");
    for (let i = 0; i < 30; i++) insert.run(`player_${String(i).padStart(2, "0")}`, i);
    const parts: string[] = [];
    let cursor: string | null = null;
    do {
      const part = dumpPart(nodeRead(source), cursor, 300);
      parts.push(part.dumpSql);
      cursor = part.nextCursor;
      if (parts.length === 1) source.exec("INSERT OR REPLACE INTO scores VALUES ('player_00', 99)");
    } while (cursor);
    expect(parts.length).toBeGreaterThan(3);
    const copy = new DatabaseSync(":memory:");
    expect(() => copy.exec(parts.join(""))).not.toThrow();
    expect(copy.prepare("SELECT count(*) AS score_count FROM scores").get()).toEqual({ score_count: 30 });
  });

  it("pages by a key of any type, NULLs and blobs included, and parts add up to the whole", () => {
    const source = new DatabaseSync(":memory:");
    source.exec("CREATE TABLE odd_keys (a, b, label TEXT, PRIMARY KEY (a, b))");
    const insert = source.prepare("INSERT INTO odd_keys VALUES (?, ?, ?)");
    insert.run(null, 1, "n1");
    insert.run(null, 2, "n2");
    insert.run(new Uint8Array([0, 255]), 1.5, "blob");
    insert.run("it's", 1e20, "text");
    insert.run(9007199254740993n, "x", "big");
    insert.run(2.5, "y", "real");
    const whole = dumpParts(source)[0]!;
    const parts = dumpParts(source, 150);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.join("")).toBe(whole);
  });
});
