import { createExecutionContext, createScheduledController, env, runDurableObjectAlarm, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../../apps/rooms/src/index.ts";
import { syncSchedules, type GameServerObject } from "../../apps/rooms/src/game-server.ts";
import type { GameDatabaseObject } from "../../apps/rooms/src/database.ts";

// A game's own game server running on its schedules (onSchedule), outside rooms and requests
// (apps/rooms/src/game-server.ts). The same schedules on the developer's own server: test/node/schedules.test.ts.

const ROOMS = "https://rooms.zaisma.test";
const e = env as unknown as Env;

/** A live game whose upload has this game server as its zaisma-server.js. */
async function addGame(slug: string, server: string, versionSuffix = "") {
  const gameId = `game_${slug.replace(/-/g, "")}`;
  const versionId = `version_${slug.replace(/-/g, "")}${versionSuffix}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, account_requirement, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'none', 'none', 'page', 0, 0) ON CONFLICT (id) DO UPDATE SET live_version_id = excluded.live_version_id")
    .bind(gameId, slug, slug, versionId)
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameId, `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
  return { gameId, versionId };
}

const objectOf = (gameId: string) => e.GAME_SERVER_OBJECTS.get(e.GAME_SERVER_OBJECTS.idFromName(gameId));
type Inside = { schedules: { versionId: string; schedules: { name: string; nextRunAtMs: number; lastRunAtMs: number | null }[] } | null; recordAtMs: number | null; scheduleRetryAtMs: number | null };

/** Make every schedule due now, and run the object's alarm. */
async function runDue(gameId: string) {
  await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
    for (const schedule of (object as unknown as Inside).schedules?.schedules ?? []) schedule.nextRunAtMs = Date.now() - 1000;
  });
  return runDurableObjectAlarm(objectOf(gameId));
}

/** Record the stats now rather than a minute from now. */
async function recordNow(gameId: string) {
  await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
    (object as unknown as Inside).recordAtMs = 0;
  });
  await runDurableObjectAlarm(objectOf(gameId));
}

async function gameRows(gameId: string, sql: string) {
  const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName(gameId));
  return runInDurableObject(stub, (database: GameDatabaseObject) => database.query(sql, []));
}

const WORLD = `
export default {
  schedules: [
    { name: "daily-reset", cron: "0 0 * * *" },
    { name: "world-turn", cron: "*/5 * * * *" },
  ],
  async onSchedule(run, server) {
    await server.database.query("CREATE TABLE IF NOT EXISTS runs (name TEXT, scheduled_at TEXT)");
    await server.database.query("INSERT INTO runs VALUES (?, ?)", [run.name, run.scheduledAt]);
    if (run.name === "daily-reset" && run.scheduledAt.endsWith("00:00:00.000Z") === false) throw new Error("reset at the wrong time");
  },
};`;

describe("game server schedules", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM game_server_schedules; DELETE FROM versions; DELETE FROM games;");
  });

  it("are read within a minute of a publish, by the rooms Worker's cron", async () => {
    const { gameId, versionId } = await addGame("world", WORLD);
    const context = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "* * * * *" }), e, context);
    await waitOnExecutionContext(context);
    const { results: rows } = await e.DB.prepare("SELECT schedule_name, cron, version_id, next_run_at_ms, last_run_at_ms FROM game_server_schedules WHERE game_id = ? ORDER BY schedule_name")
      .bind(gameId)
      .all<{ schedule_name: string; cron: string; version_id: string; next_run_at_ms: number; last_run_at_ms: number | null }>();
    expect(rows.map((row) => [row.schedule_name, row.cron, row.version_id, row.last_run_at_ms])).toEqual([
      ["daily-reset", "0 0 * * *", versionId, null],
      ["world-turn", "*/5 * * * *", versionId, null],
    ]);
    const nowMs = Date.now();
    expect(new Date(rows[0]!.next_run_at_ms).toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(rows[1]!.next_run_at_ms % (5 * 60_000)).toBe(0);
    expect(rows[1]!.next_run_at_ms - nowMs).toBeLessThanOrEqual(5 * 60_000);
    expect(await e.DB.prepare("SELECT game_server_schedules_version_id FROM games WHERE id = ?").bind(gameId).first()).toEqual({ game_server_schedules_version_id: versionId });
    // Read once: the next cron run leaves it be.
    const { results: waiting } = await e.DB.prepare("SELECT id FROM games WHERE live_version_id IS NOT game_server_schedules_version_id").all();
    expect(waiting).toEqual([]);
  });

  it("run with the game's database, and count in the developer's stats", async () => {
    const { gameId } = await addGame("world", WORLD);
    await syncSchedules(e);
    expect(await runDue(gameId)).toBe(true);
    const runs = (await gameRows(gameId, "SELECT name, scheduled_at FROM runs ORDER BY name")) as { queryResult: { name: string; scheduled_at: string }[] };
    expect(runs.queryResult.map((run) => run.name)).toEqual(["daily-reset", "world-turn"]);
    // scheduledAt is the minute each was due.
    expect(runs.queryResult[0]!.scheduled_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await recordNow(gameId);
    expect(await e.DB.prepare("SELECT game_server_scheduled_run_count FROM room_usage WHERE game_id = ?").bind(gameId).first()).toEqual({ game_server_scheduled_run_count: 2 });
    const { results } = await e.DB.prepare("SELECT schedule_name, next_run_at_ms, last_run_at_ms FROM game_server_schedules WHERE game_id = ? ORDER BY schedule_name").bind(gameId).all<{ schedule_name: string; next_run_at_ms: number; last_run_at_ms: number | null }>();
    for (const row of results) {
      expect(row.last_run_at_ms).not.toBeNull();
      expect(row.next_run_at_ms).toBeGreaterThan(Date.now());
    }
  });

  it("say what went wrong in a run, with the schedule's name", async () => {
    const { gameId, versionId } = await addGame("broken-world", WORLD);
    await syncSchedules(e);
    await runDue(gameId);
    await recordNow(gameId);
    const error = await e.DB.prepare("SELECT kind, message, version_id FROM game_server_errors WHERE game_id = ?").bind(gameId).first<{ kind: string; message: string; version_id: string }>();
    expect(error).toEqual({ kind: "crash", message: expect.stringMatching(/^Schedule daily-reset: reset at the wrong time \(zaisma-server\.js:\d+:\d+\)$/), version_id: versionId });
    expect(await e.DB.prepare("SELECT game_server_crash_count, game_server_scheduled_run_count FROM room_usage WHERE game_id = ?").bind(gameId).first()).toEqual({ game_server_crash_count: 1, game_server_scheduled_run_count: 2 });
  });

  it("that don't read keep the game server from starting, and say why", async () => {
    const { gameId } = await addGame("typo-world", `export default { schedules: [{ name: "reset", cron: "0 0 * * MON" }], onSchedule() {} };`);
    await syncSchedules(e);
    expect(await e.DB.prepare("SELECT COUNT(*) AS schedule_count FROM game_server_schedules WHERE game_id = ?").bind(gameId).first()).toEqual({ schedule_count: 0 });
    await recordNow(gameId);
    const error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = ?").bind(gameId).first<{ message: string }>();
    expect(error!.message).toMatch(/^Didn't start: Schedule "reset": The cron "0 0 \* \* MON" has "MON" as its day of the week/);
    // It's read again in a while, in case it was the sandbox and not the code.
    await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
      expect((object as unknown as Inside).scheduleRetryAtMs).toBeGreaterThan(Date.now());
    });
  });

  it("follow the live version", async () => {
    const { gameId } = await addGame("world", WORLD);
    await syncSchedules(e);
    const { versionId: newVersionId } = await addGame("world", `export default { schedules: [{ name: "weekly-reset", cron: "0 0 * * 1" }], onSchedule() {}, onRequest: () => "hi" };`, "v2");
    await syncSchedules(e);
    const { results } = await e.DB.prepare("SELECT schedule_name, version_id FROM game_server_schedules WHERE game_id = ?").bind(gameId).all();
    expect(results).toEqual([{ schedule_name: "weekly-reset", version_id: newVersionId }]);
    // An old version's schedules never run: before each run the object checks which version is live.
    const { versionId: thirdVersionId } = await addGame("world", "export default { onRequest: () => 1 };", "v3");
    expect(await runDue(gameId)).toBe(true);
    expect(await e.DB.prepare("SELECT COUNT(*) AS schedule_count FROM game_server_schedules WHERE game_id = ?").bind(gameId).first()).toEqual({ schedule_count: 0 });
    expect(await e.DB.prepare("SELECT game_server_schedules_version_id FROM games WHERE id = ?").bind(gameId).first()).toEqual({ game_server_schedules_version_id: thirdVersionId });
    await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
      expect((object as unknown as Inside).schedules).toBeNull();
    });
  });

  it("stop while the game can't be played, and start again with it", async () => {
    const { gameId, versionId } = await addGame("paused-world", WORLD);
    await syncSchedules(e);
    await e.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = ?").bind(gameId).run();
    await runDue(gameId);
    expect(await gameRows(gameId, "SELECT name FROM sqlite_master WHERE name = 'runs'")).toEqual({ queryResult: [] });
    expect(await e.DB.prepare("SELECT game_server_schedules_version_id FROM games WHERE id = ?").bind(gameId).first()).toEqual({ game_server_schedules_version_id: null });
    await e.DB.prepare("UPDATE games SET review_status = 'live' WHERE id = ?").bind(gameId).run();
    await syncSchedules(e);
    const { results } = await e.DB.prepare("SELECT schedule_name FROM game_server_schedules WHERE game_id = ? AND version_id = ?").bind(gameId, versionId).all();
    expect(results).toHaveLength(2);
  });

  it("are enough for a game server, which then answers no requests", async () => {
    const { gameId } = await addGame("world", WORLD);
    await syncSchedules(e);
    const answer = await runInDurableObject(objectOf(gameId), (object: GameServerObject) => object.request(gameId, "version_world", { id: "player_ana", name: "Ana", kind: "guest" }, null));
    expect(answer).toMatchObject({ code: "no_request_handler" });
  });
});
