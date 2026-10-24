import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../../packages/game-server/bin/node.js";
// @ts-expect-error plain JavaScript without type declarations
import { localDatabase } from "../../packages/game-server/bin/node-parts.js";
import { checkStatement, defineGameServer, generateSigningKey, loadSigningKey, signPass, type GameDatabase } from "../../packages/game-server/src/internal.ts";

// The game database on the developer's own server: a local SQLite file, with the same calls and checks as in Zaisma rooms (test/rooms/database.test.ts).

const folder = mkdtempSync(join(tmpdir(), "zaisma-database-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** What a call answers, or the error it threw, as the game would see it. */
const attempt = (work: Promise<unknown>) => work.catch((error) => ({ name: error.name, code: error.code, message: error.message }));

describe("checking statements", () => {
  it("takes one statement, cutting off a trailing ; or comment", () => {
    expect(checkStatement("SELECT 1; ", [])).toEqual({ sql: "SELECT 1", values: [] });
    expect(checkStatement("SELECT 'a;b' -- note", undefined)).toEqual({ sql: "SELECT 'a;b'", values: [] });
    expect(checkStatement('SELECT "odd;name" FROM [my;table] /* ; */', [])).toEqual({ sql: 'SELECT "odd;name" FROM [my;table]', values: [] });
    expect(checkStatement("SELECT 'it''s; fine'", [])).toEqual({ sql: "SELECT 'it''s; fine'", values: [] });
    expect(() => checkStatement("SELECT 1; SELECT 2", [])).toThrow(/more than one statement.*\(bad_sql\)$/);
    expect(() => checkStatement("  begin; ", [])).toThrow(/BEGIN isn't allowed/);
    expect(() => checkStatement("ATTACH 'other.sqlite' AS other", [])).toThrow(/ATTACH isn't allowed/);
    expect(() => checkStatement("", [])).toThrow(/isn't text/);
  });

  it("takes text, numbers, null and blobs, and says how to give anything else", () => {
    const blob = new Uint8Array([1, 2]);
    expect(checkStatement("SELECT ?, ?, ?, ?", ["a", 1.5, null, blob]).values).toEqual(["a", 1.5, null, blob]);
    expect(() => checkStatement("SELECT ?", [true])).toThrow("Value 1 is true or false. Give 1 for true and 0 for false. (bad_values)");
    expect(() => checkStatement("SELECT ?", [{ hat: "red" }])).toThrow(/JSON\.stringify/);
    expect(() => checkStatement("SELECT ?", [Number.NaN])).toThrow(/finite number/);
    expect(() => checkStatement("SELECT ?", "a")).toThrow(/values isn't a list/);
  });
});

describe("a local database file", () => {
  it("answers rows, runs batches as one transaction, and keeps its data in the file", async () => {
    const file = join(folder, "scores.sqlite");
    const database: GameDatabase = localDatabase(file);
    expect(existsSync(file)).toBe(false);
    await database.query("CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
    expect(await database.query("INSERT INTO scores VALUES (?, ?) RETURNING best_score", ["player_a", 1200])).toEqual([{ best_score: 1200 }]);
    expect(await attempt(database.batch([{ sql: "UPDATE scores SET best_score = 0" }, { sql: "INSERT INTO missing VALUES (1)" }]))).toMatchObject({ code: "bad_sql", message: expect.stringContaining("no such table: missing") });
    expect(await database.batch([{ sql: "SELECT best_score FROM scores" }, { sql: "SELECT count(*) AS score_count FROM scores" }])).toEqual([[{ best_score: 1200 }], [{ score_count: 1 }]]);
    expect(await database.query("SELECT ? AS word, ? AS amount, ? AS empty, x'0102' AS blob", ["docks", 2.5, null])).toEqual([{ word: "docks", amount: 2.5, empty: null, blob: new Uint8Array([1, 2]) }]);
    expect(await attempt(database.query("SELECT 1; SELECT 2"))).toMatchObject({ name: "DatabaseError", code: "bad_sql" });
    expect(await attempt(database.query("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10001) SELECT i FROM n"))).toMatchObject({ code: "too_many_rows" });
    expect(await database.query("SELECT 'a;b' AS word; -- done")).toEqual([{ word: "a;b" }]);

    // Another open of the same file, like the runner after a restart, sees the same data.
    expect(await localDatabase(file).query("SELECT player_id, best_score FROM scores")).toEqual([{ player_id: "player_a", best_score: 1200 }]);
  });

  it("refuses whole numbers past 2^53 going in (bad_values) and coming out (bad_sql), and reads them as text", async () => {
    const database: GameDatabase = localDatabase(join(folder, "big.sqlite"));
    await database.query("CREATE TABLE totals (player_id TEXT PRIMARY KEY, amount INTEGER NOT NULL)");
    expect(await attempt(database.query("INSERT INTO totals VALUES (?, ?)", ["player_a", 2 ** 53]))).toMatchObject({ name: "DatabaseError", code: "bad_values", message: expect.stringContaining("Store it as text") });
    expect(await database.query("INSERT INTO totals VALUES (?, ?) RETURNING amount", ["player_b", Number.MAX_SAFE_INTEGER])).toEqual([{ amount: Number.MAX_SAFE_INTEGER }]);
    await database.query("INSERT INTO totals VALUES ('player_c', 9223372036854775807)");
    expect(await attempt(database.query("SELECT amount FROM totals WHERE player_id = 'player_c'"))).toMatchObject({ name: "DatabaseError", code: "bad_sql", message: expect.stringContaining("CAST(amount AS TEXT)") });
    expect(await database.query("SELECT CAST(amount AS TEXT) AS amount FROM totals WHERE player_id = 'player_c'")).toEqual([{ amount: "9223372036854775807" }]);
  });

  it("erases a player the same way Zaisma rooms do, and makes no file to erase from", async () => {
    const file = join(folder, "erase.sqlite");
    const database: GameDatabase = localDatabase(file);
    expect(await database.erasePlayer("player_mia")).toEqual([]);
    expect(existsSync(file)).toBe(false);
    await database.batch([
      { sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)" },
      { sql: "CREATE TABLE matches (match_id INTEGER, winner_player_id TEXT)" },
      { sql: "CREATE TABLE inventory (PLAYER_ID TEXT, item TEXT)" },
      { sql: "INSERT INTO scores VALUES ('player_mia', 10), ('player_kai', 20)" },
      { sql: "INSERT INTO matches VALUES (1, 'player_mia')" },
      { sql: "INSERT INTO inventory VALUES ('player_mia', 'sword'), ('player_mia', 'shield')" },
    ]);
    expect(await database.erasePlayer("player_mia")).toEqual([
      { tableName: "inventory", erasedRowCount: 2 },
      { tableName: "scores", erasedRowCount: 1 },
    ]);
    expect(await database.query("SELECT player_id FROM scores")).toEqual([{ player_id: "player_kai" }]);
    expect(await database.query("SELECT winner_player_id FROM matches")).toEqual([{ winner_player_id: "player_mia" }]);
    expect(await attempt(database.erasePlayer("mia_plays"))).toMatchObject({ code: "bad_player_id" });

    // A foreign key that refuses the delete undoes the whole erase.
    const keyed: GameDatabase = localDatabase(join(folder, "keyed.sqlite"));
    await keyed.query("CREATE TABLE scores (player_id TEXT)");
    await keyed.query("CREATE TABLE players (player_id TEXT PRIMARY KEY)");
    await keyed.query("CREATE TABLE trophies (owner TEXT REFERENCES players (player_id))");
    await keyed.query("PRAGMA foreign_keys = ON");
    await keyed.batch([{ sql: "INSERT INTO scores VALUES ('player_mia')" }, { sql: "INSERT INTO players VALUES ('player_mia')" }, { sql: "INSERT INTO trophies VALUES ('player_mia')" }]);
    expect(await attempt(keyed.erasePlayer("player_mia"))).toMatchObject({ code: "bad_sql", message: expect.stringContaining("players") });
    expect(await keyed.query("SELECT player_id FROM scores")).toEqual([{ player_id: "player_mia" }]);
  });
});

describe("room.database on the Node runner", () => {
  const ISS = "https://rooms.zaisma.test";
  const ORIGIN = "https://arena.zaismausercontent.com";

  it("gives the game server the same database in every room, from the file", async () => {
    const signing = await loadSigningKey(await generateSigningKey());
    const leaderboard = defineGameServer({
      setup: () => ({}),
      async onJoin(state, player, room) {
        await room.database.query("CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
        await room.database.query("INSERT INTO scores VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET best_score = best_score + 1", [player.id, 1]);
        room.send(player.id, await room.database.query("SELECT player_id, best_score FROM scores ORDER BY player_id"));
      },
    });
    const file = join(folder, "runner.sqlite");
    const own = startServer({ gameServer: leaderboard, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], database: localDatabase(file), roomStateFile: null });
    await new Promise((resolve) => own.httpServer.once("listening", resolve));
    const at = (own.httpServer.address() as { port: number }).port;
    const scoresOnJoin = async (sub: string, code: string) => {
      const ws = new WebSocket(`ws://localhost:${at}/v1/rooms/arena/${code}`, { origin: ORIGIN });
      const got = new Promise<unknown>((resolve) => ws.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === "message") resolve(message.data);
      }));
      await new Promise((resolve) => ws.on("open", resolve));
      const nowSec = Math.floor(Date.now() / 1000);
      ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub, name: sub, aud: "arena", iss: ISS, pass_version_number: 1, kind: "guest", iat: nowSec, exp: nowSec + 60 }) }));
      const data = await got;
      ws.close();
      return data;
    };
    expect(await scoresOnJoin("player_a", "ABCDEF")).toEqual([{ player_id: "player_a", best_score: 1 }]);
    expect(await scoresOnJoin("player_b", "GHJKLM")).toEqual([{ player_id: "player_a", best_score: 1 }, { player_id: "player_b", best_score: 1 }]);
    expect(await scoresOnJoin("player_a", "GHJKLM")).toEqual([{ player_id: "player_a", best_score: 2 }, { player_id: "player_b", best_score: 1 }]);
    await own.close();
    expect(existsSync(file)).toBe(true);
  });
});
