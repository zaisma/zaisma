import { DatabaseSync } from "node:sqlite";
import { dumpPart, type DatabaseRow } from "../../packages/game-server/src/index.ts";

// Databases and helpers for the SQL dump's tests (test/node/dump.test.ts, test/node/cli.test.ts).

/** A database with what a dump has to get right: AUTOINCREMENT, no rowids, generated columns, odd names and text, blobs, a view, an index and a trigger. */
export function trickyDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, speed REAL, replay BLOB, name_length INTEGER GENERATED ALWAYS AS (length(name)));
    CREATE TABLE inventories (player_id INTEGER, item TEXT, item_count INTEGER, PRIMARY KEY (player_id, item)) WITHOUT ROWID;
    CREATE TABLE "odd ""name""" ("semi;colon" TEXT, [bracket] TEXT);
    INSERT INTO players (name, speed, replay) VALUES ('it''s
me; -- not a comment', 2.0, X'000102FF'), ('Ünïcode 🎮', NULL, NULL), ('gone', 1, NULL);
    DELETE FROM players WHERE name = 'gone';
    INSERT INTO inventories VALUES (1, 'golden_wing', 2), (2, 'boots', 1), (1, 'apple', 7);
    INSERT INTO "odd ""name""" VALUES ('/* not */', 'x');
    CREATE INDEX players_by_speed ON players (speed);
    CREATE VIEW fast_players AS SELECT name FROM players WHERE speed > 1;
    CREATE TRIGGER count_items AFTER INSERT ON inventories BEGIN UPDATE players SET speed = coalesce(speed, 0) + 1 WHERE id = NEW.player_id; SELECT CASE WHEN 1 THEN 1 ELSE 0 END; END;
  `);
  return database;
}

/** dumpPart's reads, from Node's SQLite. */
export const nodeRead = (database: DatabaseSync) => (sql: string, values: unknown[]) => ({ rows: database.prepare(sql).all(...(values as never[])) as DatabaseRow[], readRowCount: 0 });

/** Every part of a database's dump, in order. */
export function dumpParts(database: DatabaseSync, partSizeBytes?: number): string[] {
  const parts: string[] = [];
  let cursor: string | null = null;
  do {
    const part = dumpPart(nodeRead(database), cursor, partSizeBytes);
    parts.push(part.dumpSql);
    cursor = part.nextCursor;
  } while (cursor);
  return parts;
}
