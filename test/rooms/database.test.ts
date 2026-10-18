import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { GAME_DATABASE_FREE_LIMITS, issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { GameDatabaseObject } from "../../apps/rooms/src/database.ts";

// The game database (apps/rooms/src/database.ts): one SQLite database per game, used by its game servers as room.database.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addSandboxGame(slug: string, server: string) {
  const id = `g${slug.replace(/-/g, "")}`;
  const version = `v${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)")
    .bind(id, slug, slug, version)
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(version, id, `games/${version}`).run();
  await e.GAMES.put(`games/${version}/zaisma-server.js`, server);
}

let address = 0;
async function join(game: string, code: string) {
  const roomKey = await issueRoomKey(e.DB, `g${game.replace(/-/g, "")}`);
  const { pass } = await (await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey }) })).json<{ pass: string }>();
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((message: any) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string);
    if (message.type !== "message" && message.type !== "error") return;
    const waiter = waiters.shift();
    waiter ? waiter(message) : inbox.push(message);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((resolve) => waiters.push(resolve)));
  /** Send the game a message and answer what it sends back. */
  const ask = async (data: unknown) => {
    ws.send(JSON.stringify({ type: "message", data }));
    return (await next()).data;
  };
  ws.send(JSON.stringify({ type: "hello", pass }));
  return { ws, next, ask };
}

// A leaderboard, the way a developer's AI would write one, plus a way to run any statement.
const LEADERBOARD = `
const say = async (room, player, work) => {
  try { room.send(player.id, await work()); }
  catch (error) { room.send(player.id, { name: error.name, code: error.code, message: error.message }); }
};
export default {
  setup: () => ({}),
  async onJoin(state, player, room) {
    await room.database.query("CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
    room.send(player.id, "ready");
  },
  async onMessage(state, player, message, room) {
    if (message.score !== undefined) await say(room, player, () => room.database.query("INSERT INTO scores VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET best_score = max(best_score, excluded.best_score) RETURNING best_score", [message.id ?? player.id, message.score]));
    if (message.sql !== undefined) await say(room, player, () => room.database.query(message.sql, message.values));
    if (message.batch !== undefined) await say(room, player, () => room.database.batch(message.batch));
    if (message.erase !== undefined) await say(room, player, () => room.database.erasePlayer(message.erase));
  },
};
`;

describe("game database", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM alert_notices; DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("gives a game's own server a real SQLite database, kept between rooms", async () => {
    await addSandboxGame("scores", LEADERBOARD);
    const a = await join("scores", "ABCDEF");
    expect(await a.next()).toMatchObject({ data: "ready" });
    expect(await a.ask({ score: 1200 })).toEqual([{ best_score: 1200 }]);
    expect(await a.ask({ score: 900 })).toEqual([{ best_score: 1200 }]);
    a.ws.close(1000);

    // Another room of the same game, later: the same database.
    const b = await join("scores", "GHJKLM");
    await b.next();
    expect(await b.ask({ score: 300, id: "player_other" })).toEqual([{ best_score: 300 }]);
    expect(await b.ask({ sql: "SELECT best_score FROM scores ORDER BY best_score DESC" })).toEqual([{ best_score: 1200 }, { best_score: 300 }]);
    // Text, numbers, null and blobs go in and come back.
    expect(await b.ask({ sql: "SELECT ? AS word, ? AS amount, ? AS empty, hex(x'0102') AS blob_hex", values: ["docks", 2.5, null] })).toEqual([{ word: "docks", amount: 2.5, empty: null, blob_hex: "0102" }]);
  });

  it("keeps each game to its own database", async () => {
    await addSandboxGame("first", LEADERBOARD);
    await addSandboxGame("second", LEADERBOARD);
    const a = await join("first", "ABCDEF");
    await a.next();
    await a.ask({ score: 5 });
    await a.ask({ sql: "CREATE TABLE secrets (word TEXT)" });
    const b = await join("second", "ABCDEF");
    await b.next();
    expect(await b.ask({ sql: "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name" })).toEqual([{ name: "scores" }]);
    expect(await b.ask({ sql: "SELECT count(*) AS score_count FROM scores" })).toEqual([{ score_count: 0 }]);
    // Cloudflare's own tables, where the usage lives, are out of reach.
    expect(await b.ask({ sql: "SELECT * FROM _cf_KV" })).toMatchObject({ name: "DatabaseError", code: "bad_sql" });
  });

  it("runs a batch as one transaction, and says what went wrong with a code and a fix", async () => {
    await addSandboxGame("batchy", LEADERBOARD);
    const a = await join("batchy", "ABCDEF");
    await a.next();
    await a.ask({ score: 50 });
    // The second statement fails, so the first is undone.
    expect(await a.ask({ batch: [{ sql: "UPDATE scores SET best_score = 0" }, { sql: "INSERT INTO missing VALUES (1)" }] })).toMatchObject({ code: "bad_sql", message: expect.stringContaining("no such table: missing") });
    expect(await a.ask({ sql: "SELECT best_score FROM scores" })).toEqual([{ best_score: 50 }]);
    expect(await a.ask({ batch: [{ sql: "UPDATE scores SET best_score = best_score + 1 RETURNING best_score" }, { sql: "SELECT count(*) AS score_count FROM scores" }] })).toEqual([[{ best_score: 51 }], [{ score_count: 1 }]]);

    expect(await a.ask({ sql: "DELETE FROM scores; DROP TABLE scores" })).toMatchObject({ code: "bad_sql", message: expect.stringContaining("more than one statement") });
    expect(await a.ask({ sql: "BEGIN TRANSACTION" })).toMatchObject({ code: "bad_sql", message: expect.stringContaining("database.batch") });
    expect(await a.ask({ sql: "SELECT ?", values: [true] })).toMatchObject({ code: "bad_values", message: expect.stringContaining("Give 1 for true and 0 for false.") });
    expect(await a.ask({ sql: "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10001) SELECT i FROM n" })).toMatchObject({ code: "too_many_rows" });
    // A ; inside text or after the statement is fine.
    expect(await a.ask({ sql: "SELECT 'a;b' AS word; -- done" })).toEqual([{ word: "a;b" }]);
  });

  it("stops writes at the free rows written this month, and keeps reads working", async () => {
    await addSandboxGame("busy", LEADERBOARD);
    const a = await join("busy", "ABCDEF");
    await a.next();
    await a.ask({ score: 10 });
    const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName("gbusy"));
    await runInDurableObject(stub, (database: GameDatabaseObject) => {
      (database as unknown as { usage: { writtenRowCount: number } }).usage.writtenRowCount = GAME_DATABASE_FREE_LIMITS.writtenRowCountPerMonth;
    });
    expect(await a.ask({ score: 20 })).toMatchObject({ code: "database_write_limit", message: expect.stringContaining("500,000") });
    expect(await a.ask({ sql: "SELECT best_score FROM scores" })).toEqual([{ best_score: 10 }]);
  });

  it("notices once a month when the game's writes reach 80% and all of the free rows, for its alert_raised event", async () => {
    await addSandboxGame("noticed", LEADERBOARD);
    const a = await join("noticed", "ABCDEF");
    await a.next();
    await a.ask({ score: 10 });
    const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName("gnoticed"));
    const setWritten = (writtenRowCount: number) =>
      runInDurableObject(stub, (database: GameDatabaseObject, state) => {
        // The object knows its game by the name it's reached with.
        expect(state.id.name).toBe("gnoticed");
        (database as unknown as { usage: { writtenRowCount: number } }).usage.writtenRowCount = writtenRowCount;
      });
    const notices = async (want: (rows: any[]) => boolean) => {
      let found: any[] = [];
      for (let i = 0; i < 50; i++) {
        found = (await e.DB.prepare("SELECT game_id, alert_kind, month_start_date, noticed_at_ms, told_webhooks_at_ms FROM alert_notices ORDER BY alert_kind").all()).results;
        if (want(found)) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return found;
    };
    // Nothing near the line yet.
    expect(await notices(() => false)).toEqual([]);

    // One row short of 80%: the next write crosses it.
    await setWritten((GAME_DATABASE_FREE_LIMITS.writtenRowCountPerMonth * 80) / 100 - 1);
    expect(await a.ask({ score: 20 })).toEqual([{ best_score: 20 }]);
    const monthStartDate = `${new Date().toISOString().slice(0, 7)}-01`;
    const nearly = await notices((rows) => rows.length > 0);
    expect(nearly).toEqual([{ game_id: "gnoticed", alert_kind: "database_writes_nearly_paused", month_start_date: monthStartDate, noticed_at_ms: expect.any(Number), told_webhooks_at_ms: null }]);

    // More writes past it notice nothing new.
    expect(await a.ask({ score: 30 })).toEqual([{ best_score: 30 }]);
    expect(await a.ask({ score: 40 })).toEqual([{ best_score: 40 }]);
    expect(await notices(() => false)).toEqual(nearly);

    // One row short of all of them: the write that reaches the line still goes in, and is noticed.
    await setWritten(GAME_DATABASE_FREE_LIMITS.writtenRowCountPerMonth - 1);
    expect(await a.ask({ score: 50 })).toEqual([{ best_score: 50 }]);
    const both = await notices((rows) => rows.length > 1);
    expect(both.map((row) => row.alert_kind)).toEqual(["database_writes_nearly_paused", "database_writes_paused"]);
    // Kept with the month's usage, so a restart doesn't notice them again.
    await runInDurableObject(stub, (_database: GameDatabaseObject, state) => {
      expect(state.storage.kv.get<{ noticedAlertKinds: string[] }>("usage")?.noticedAlertKinds).toEqual(["database_writes_nearly_paused", "database_writes_paused"]);
    });
  });

  it("counts the rows read and written this month", async () => {
    await addSandboxGame("counted", LEADERBOARD);
    const a = await join("counted", "ABCDEF");
    await a.next();
    await a.ask({ score: 10 });
    await a.ask({ sql: "SELECT * FROM scores" });
    const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName("gcounted"));
    const usage = await stub.usageThisMonth();
    expect(usage.month).toBe(new Date().toISOString().slice(0, 7));
    expect(usage.writtenRowCount).toBeGreaterThan(0);
    expect(usage.readRowCount).toBeGreaterThan(0);
    expect(usage.storageSizeBytes).toBeGreaterThan(0);
  });

  it("erases a player from every table with a player_id column, in one transaction, past the free writes", async () => {
    await addSandboxGame("erasing", LEADERBOARD);
    const a = await join("erasing", "ABCDEF");
    await a.next();
    await a.ask({ score: 10, id: "player_mia" });
    await a.ask({ score: 20, id: "player_kai" });
    await a.ask({ sql: "CREATE TABLE matches (match_id INTEGER, winner_player_id TEXT)" });
    await a.ask({ sql: "INSERT INTO matches VALUES (1, 'player_mia')" });
    await a.ask({ sql: 'CREATE TABLE "Odd ""Name""" (Player_ID TEXT, item TEXT)' });
    await a.ask({ batch: [{ sql: 'INSERT INTO "Odd ""Name""" VALUES (?, ?)', values: ["player_mia", "sword"] }, { sql: 'INSERT INTO "Odd ""Name""" VALUES (?, ?)', values: ["player_mia", "shield"] }] });
    await a.ask({ sql: "CREATE TABLE nobody (player_id TEXT)" });
    // Past the month's free writes, the erase still runs: it only deletes.
    const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName("gerasing"));
    await runInDurableObject(stub, (database: GameDatabaseObject) => {
      (database as unknown as { usage: { writtenRowCount: number } }).usage.writtenRowCount = GAME_DATABASE_FREE_LIMITS.writtenRowCountPerMonth;
    });
    expect(await a.ask({ erase: "player_mia" })).toEqual([
      { tableName: 'Odd "Name"', erasedRowCount: 2 },
      { tableName: "nobody", erasedRowCount: 0 },
      { tableName: "scores", erasedRowCount: 1 },
    ]);
    expect(await a.ask({ sql: "SELECT player_id FROM scores" })).toEqual([{ player_id: "player_kai" }]);
    // Another column naming the player is left alone: it's other players' history too.
    expect(await a.ask({ sql: "SELECT winner_player_id FROM matches" })).toEqual([{ winner_player_id: "player_mia" }]);
    expect(await a.ask({ erase: "mia_plays" })).toMatchObject({ code: "bad_player_id" });
  });

  it("undoes the whole erase when a foreign key refuses it", async () => {
    await addSandboxGame("keyed", LEADERBOARD);
    const a = await join("keyed", "ABCDEF");
    await a.next();
    await a.ask({ score: 10, id: "player_mia" });
    await a.ask({ sql: "CREATE TABLE players (player_id TEXT PRIMARY KEY)" });
    await a.ask({ sql: "CREATE TABLE trophies (trophy_id INTEGER, owner TEXT REFERENCES players (player_id))" });
    await a.ask({ batch: [{ sql: "INSERT INTO players VALUES ('player_mia')" }, { sql: "INSERT INTO trophies VALUES (1, 'player_mia')" }] });
    expect(await a.ask({ erase: "player_mia" })).toMatchObject({ code: "bad_sql", message: expect.stringContaining("players") });
    expect(await a.ask({ sql: "SELECT player_id FROM scores" })).toEqual([{ player_id: "player_mia" }]);
    expect(await a.ask({ sql: "SELECT player_id FROM players" })).toEqual([{ player_id: "player_mia" }]);
  });
});
