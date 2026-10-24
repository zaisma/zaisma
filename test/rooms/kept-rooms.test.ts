import { createExecutionContext, env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MAXIMUM_GAME_STORAGE_SIZE_BYTES, issueRoomKey, listRooms } from "@zaisma/core";
import { REMOVED_CLOSE_CODE } from "@zaisma/game-server";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";
import { gameDatabaseObject, type GameDatabaseObject } from "../../apps/rooms/src/database.ts";
import { GameStorageService } from "../../apps/rooms/src/game-storage.ts";

// Kept rooms (room.setKept): worlds that sleep with nobody in them and wake as they were.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

const gameIdOf = (slug: string) => `g${slug.replace(/-/g, "")}`;
const versionIdOf = (slug: string) => `v${slug.replace(/-/g, "")}`;
const roomOf = (slug: string, code: string) => e.ROOMS.get(e.ROOMS.idFromName(`${slug}:${code}`));

/** A live game set to run its own game server, with that server as its zaisma-server.js. */
async function addSandboxGame(slug: string, server: string) {
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)")
    .bind(gameIdOf(slug), slug, slug, versionIdOf(slug))
    .run();
  await addVersion(slug, versionIdOf(slug), server);
}

async function addVersion(slug: string, versionId: string, server: string) {
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameIdOf(slug), `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
}

let address = 0;
async function newPass(game: string) {
  const roomKey = await issueRoomKey(e.DB, gameIdOf(game));
  const res = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey }) });
  return res.json<{ pass: string; player: { id: string; name: string } }>();
}

async function join(game: string, code: string) {
  const { pass, player } = await newPass(game);
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data as string);
    if (m.type === "probe") {
      try {
        ws.send(JSON.stringify({ type: "probe_answer", probeNumber: m.probeNumber }));
      } catch {
        // Closed.
      }
      return;
    }
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  const closed = new Promise<number>((r) => ws.addEventListener("close", (ev) => r(ev.code)));
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  const fromGame = async () => {
    for (;;) {
      const m = await next();
      if (["message", "ended", "error"].includes(m.type)) return m;
    }
  };
  const say = (data: unknown) => ws.send(JSON.stringify({ type: "message", data }));
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: { isListed: true } }));
  expect((await next()).type).toBe("welcome");
  return { ws, player, say, next: fromGame, closed };
}

/** Wait until a check passes, a few seconds at most. */
async function until<T>(check: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let tries = 0; tries < 100; tries++) {
    const found = await check();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out");
}

/** A survival world: kept from its first player on, saving every second. */
const WORLD = `
export default {
  ticksPerSec: 20,
  stateSaveIntervalSec: 1,
  setup: () => ({ logCount: 0, restored: null }),
  onJoin(state, player, room) { room.setKept(true); room.setInfo({ name: "Northwatch" }); },
  onRestored(state, restoreInfo) { state.restored = restoreInfo; },
  onMessage(state, player, room, message) {
    if (message === "chop") state.logCount++;
    if (message === "how") room.send(player.id, { logCount: state.logCount, restored: state.restored, isKept: room.isKept });
    if (message === "unkeep") room.setKept(false);
    if (message === "end") room.end("The world ended.");
  },
};
`;

const keptRow = (slug: string, code: string) => e.DB.prepare("SELECT * FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(gameIdOf(slug), code).first<any>();
const liveRow = (slug: string, code: string) => e.DB.prepare("SELECT * FROM live_rooms WHERE game_id = ? AND room_code = ?").bind(gameIdOf(slug), code).first<any>();

describe("kept rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM kept_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("sleep with their world when everyone leaves, stay listed with nobody in them, and wake as they were", async () => {
    await addSandboxGame("frostbound", WORLD);
    const a = await join("frostbound", "NRTHWC");
    a.say("chop");
    a.say("chop");
    a.say("how");
    expect((await a.next()).data).toMatchObject({ logCount: 2, isKept: true });
    expect(await until(() => keptRow("frostbound", "NRTHWC"))).toMatchObject({ name: "Northwatch", created_at_ms: expect.any(Number) });

    a.ws.close(1000);
    const row = await until(async () => {
      const listed = await liveRow("frostbound", "NRTHWC");
      return listed?.player_count === 0 ? listed : null;
    });
    expect(row).toMatchObject({ is_kept: 1, is_listed: 1, name: "Northwatch" });
    const kept = await until(async () => {
      const found = await keptRow("frostbound", "NRTHWC");
      return found?.saved_size_bytes > 0 ? found : null;
    });
    expect(kept.saved_at_ms).toBeGreaterThan(0);
    expect(kept.last_played_at_ms).toBeGreaterThan(0);

    // On the Rooms tab and in Zaisma.rooms.list, with nobody playing in it.
    const list = await listRooms(e.DB, gameIdOf("frostbound"));
    expect(list.rooms).toMatchObject([{ roomCode: "NRTHWC", playerCount: 0, isKept: true, name: "Northwatch" }]);
    expect(list.playing).toMatchObject({ playerCount: 0, roomCount: 0 });

    // Asleep it never checks in, and its row stays listed however old it gets.
    await e.DB.prepare("UPDATE live_rooms SET updated_at_ms = 0 WHERE room_code = 'NRTHWC'").run();
    expect((await listRooms(e.DB, gameIdOf("frostbound"))).rooms).toHaveLength(1);

    // Its alarm never clears it, even days after it emptied: a kept room costs only its storage.
    const stub = roomOf("frostbound", "NRTHWC");
    await runInDurableObject(stub, async (_room: Room, state) => {
      await state.storage.put("emptiedAtMs", Date.now() - 3 * 24 * 3600_000);
      await state.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, async (_room: Room, state) => {
      expect(await state.storage.get("saved")).toMatchObject({ stateChunkCount: 1, isSavedEmpty: true });
      expect(await state.storage.getAlarm()).toBeNull();
    });

    // A restart, or a month asleep: the object goes, and the world comes back with the next player.
    await runInDurableObject(stub, (_room: Room, state) => state.abort("asleep")).catch(() => {});
    const b = await join("frostbound", "NRTHWC");
    b.say("how");
    const how = (await b.next()).data;
    expect(how).toMatchObject({ logCount: 2, isKept: true, restored: { lostDurationSec: 0, savedAt: new Date(kept.saved_at_ms).toISOString() } });
    b.ws.close(1000);
  });

  it("let a game keep only its one shared world, by the room's code, and turn players away from any other", async () => {
    await addSandboxGame(
      "one-world",
      `export default {
  setup: () => ({ visitCount: 0 }),
  canJoin(state, player, room) { return room.roomCode === "WRLD22" || { refusalMessage: "Join the main world." }; },
  onJoin(state, player, room) { room.setKept(true); state.visitCount++; room.send(player.id, { roomCode: room.roomCode, visitCount: state.visitCount }); return state; },
};`,
    );
    const a = await join("one-world", "WRLD22");
    expect((await a.next()).data).toEqual({ roomCode: "WRLD22", visitCount: 1 });
    await until(() => keptRow("one-world", "WRLD22"));
    // A changed page opening another code gets nowhere: the game server refuses, and nothing else is kept.
    const { pass } = await newPass("one-world");
    const up = await SELF.fetch(`${R}/v1/rooms/one-world/XTRA22`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    const ws = up.webSocket!;
    ws.accept();
    const refused = new Promise<any>((r) => ws.addEventListener("message", (ev) => r(JSON.parse(ev.data as string)), { once: true }));
    ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect(await refused).toMatchObject({ type: "error", message: "Join the main world." });
    expect(await e.DB.prepare("SELECT room_code FROM kept_rooms WHERE game_id = ?").bind(gameIdOf("one-world")).all()).toMatchObject({ results: [{ room_code: "WRLD22" }] });
    a.ws.close(1000);
  });

  it("stop being kept with setKept(false) or room.end(), and their rows go", async () => {
    await addSandboxGame("thawing", WORLD);
    const a = await join("thawing", "THAWED");
    await until(() => keptRow("thawing", "THAWED"));
    a.say("unkeep");
    await until(async () => !(await keptRow("thawing", "THAWED")));
    a.say("how");
    expect((await a.next()).data).toMatchObject({ isKept: false });
    a.ws.close(1000);
    // An ordinary room again: unlisted once empty, and cleared a day later.
    await until(async () => !(await liveRow("thawing", "THAWED")));

    const b = await join("thawing", "ENDZZZ");
    await until(() => keptRow("thawing", "ENDZZZ"));
    b.say("end");
    expect(await b.next()).toEqual({ type: "ended", message: "The world ended.", endReason: "game" });
    await until(async () => !(await keptRow("thawing", "ENDZZZ")));
    expect(await liveRow("thawing", "ENDZZZ")).toBeNull();
  });

  it("aren't kept while the game's storage is full at its 10 GB, and the game server's log says why", async () => {
    await addSandboxGame("full-world", WORLD);
    await e.DB.prepare("INSERT INTO kept_rooms (game_id, room_code, saved_size_bytes, created_at_ms) VALUES (?, 'BIGONE', ?, 0)").bind(gameIdOf("full-world"), MAXIMUM_GAME_STORAGE_SIZE_BYTES).run();
    const a = await join("full-world", "NRMMMM");
    const stub = roomOf("full-world", "NRMMMM");
    const lines = await until(() => runInDurableObject(stub, (room: Room) => ((room as any).logs?.waiting as { text: string }[] | undefined)?.filter((line) => /can't be kept/.test(line.text))).then((found) => (found?.length ? found : null)));
    expect(lines[0]!.text).toMatch(/^Zaisma: this room can't be kept, because this game's storage is full at its 10 GB\. Delete kept rooms \(zaisma kept-rooms\) or database rows to make room\.$/);
    a.say("how");
    expect((await a.next()).data).toMatchObject({ isKept: false });
    expect(await keptRow("full-world", "NRMMMM")).toBeNull();
    a.ws.close(1000);
  });

  it("are deleted by their developer: players are sent out, and everything the room keeps goes", async () => {
    await addSandboxGame("deleted-world", WORLD);
    const a = await join("deleted-world", "GNEXXX");
    await until(() => keptRow("deleted-world", "GNEXXX"));
    const stub = roomOf("deleted-world", "GNEXXX");
    // Another game's ID never reaches it.
    expect((await stub.fetch("https://room/delete", { method: "POST", headers: { "x-game-id": "gsomeoneelse" } })).status).toBe(404);
    expect((await stub.fetch("https://room/delete", { method: "POST", headers: { "x-game-id": gameIdOf("deleted-world") } })).status).toBe(204);
    expect(await a.next()).toEqual({ type: "ended", message: "This world was deleted.", endReason: "kept_room_deleted" });
    expect(await keptRow("deleted-world", "GNEXXX")).toBeNull();
    expect(await liveRow("deleted-world", "GNEXXX")).toBeNull();
    await runInDurableObject(stub, async (_room: Room, state) => {
      expect((await state.storage.list()).size).toBe(0);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("wake on the game's live version, saying which version saved them", async () => {
    await addSandboxGame("new-season", WORLD);
    const a = await join("new-season", "SEASNS");
    a.say("chop");
    a.say("how");
    expect((await a.next()).data).toMatchObject({ logCount: 1 });
    a.ws.close(1000);
    await until(async () => (await liveRow("new-season", "SEASNS"))?.player_count === 0);
    const stub = roomOf("new-season", "SEASNS");
    await runInDurableObject(stub, (_room: Room, state) => state.abort("asleep")).catch(() => {});

    // Published with the default match_update_mode: a world never reaches a next match, so it wakes on this one.
    await addVersion("new-season", "vnewseason2", WORLD);
    await e.DB.prepare("UPDATE games SET live_version_id = 'vnewseason2' WHERE id = ?").bind(gameIdOf("new-season")).run();
    const b = await join("new-season", "SEASNS");
    b.say("how");
    expect((await b.next()).data).toMatchObject({ logCount: 1, restored: { lostDurationSec: 0, savedVersionId: "vnewseason" } });
    expect(await runInDurableObject(roomOf("new-season", "SEASNS"), (room: Room) => (room as any).meta.versionId)).toBe("vnewseason2");
    expect((await liveRow("new-season", "SEASNS"))?.version_id).toBe("vnewseason2");
    b.ws.close(1000);
  });

  it("outlive their game being unavailable: players are sent out and the world sleeps, kept", async () => {
    await addSandboxGame("held-world", WORLD);
    const a = await join("held-world", "HELDXX");
    a.say("chop");
    a.say("how");
    expect((await a.next()).data).toMatchObject({ logCount: 1 });
    await until(() => keptRow("held-world", "HELDXX"));
    await e.DB.prepare("UPDATE games SET review_status = 'held' WHERE id = ?").bind(gameIdOf("held-world")).run();
    await runInDurableObject(roomOf("held-world", "HELDXX"), (room: Room) => {
      (room as any).lastCheckAtMs = 0;
    });
    a.say("chop");
    expect(await a.next()).toMatchObject({ type: "error", code: "game_unavailable" });
    expect(await a.closed).toBe(REMOVED_CLOSE_CODE);
    expect(await keptRow("held-world", "HELDXX")).not.toBeNull();
    expect(await liveRow("held-world", "HELDXX")).toBeNull();

    await e.DB.prepare("UPDATE games SET review_status = 'live' WHERE id = ?").bind(gameIdOf("held-world")).run();
    const b = await join("held-world", "HELDXX");
    b.say("how");
    expect((await b.next()).data).toMatchObject({ logCount: 1, isKept: true });
    b.ws.close(1000);
  });

  it("hand Zaisma's backup everything they keep, a line per key, and only to their own game", async () => {
    await addSandboxGame("backed-up", WORLD);
    const a = await join("backed-up", "BACKXX");
    a.say("chop");
    a.say("how");
    await a.next();
    await until(() => keptRow("backed-up", "BACKXX"));
    a.ws.close(1000);
    await until(async () => (await liveRow("backed-up", "BACKXX"))?.player_count === 0);
    const service = new GameStorageService(createExecutionContext(), e);
    const world = await service.keptRoomBackup(gameIdOf("backed-up"), "backed-up", "BACKXX");
    const lines = (await new Response(world).text()).trim().split("\n").map((line) => JSON.parse(line) as { key: string; value: unknown });
    const stored = await runInDurableObject(roomOf("backed-up", "BACKXX"), async (_room: Room, state) => [...(await state.storage.list()).entries()]);
    expect(lines.map((line) => [line.key, line.value])).toEqual(JSON.parse(JSON.stringify(stored)));
    expect(lines.map((line) => line.key)).toEqual(expect.arrayContaining(["meta", "saved"]));
    expect(await service.keptRoomBackup("gsomeoneelse", "backed-up", "BACKXX")).toBeNull();
  });

  it("go with their game's storage when the game is deleted", async () => {
    await addSandboxGame("deleted-game", WORLD);
    const a = await join("deleted-game", "WPEDXX");
    await until(() => keptRow("deleted-game", "WPEDXX"));
    a.ws.close(1000);
    await until(async () => (await liveRow("deleted-game", "WPEDXX"))?.player_count === 0);
    const service = new GameStorageService(createExecutionContext(), e);
    expect(await service.deleteGameStorage(gameIdOf("deleted-game"))).toEqual({ failureMessage: null });
    expect(await keptRow("deleted-game", "WPEDXX")).toBeNull();
    await runInDurableObject(roomOf("deleted-game", "WPEDXX"), async (_room: Room, state) => {
      expect((await state.storage.list()).size).toBe(0);
    });
  });

  it("count towards the game's storage with its database", async () => {
    const gameId = `gstorage${Date.now()}`;
    const database = gameDatabaseObject(e, gameId);
    // Kept rooms filling the 10 GB a game can have; the database reads their size in the background, at most every 10 minutes.
    await e.DB.prepare("INSERT INTO kept_rooms (game_id, room_code, saved_size_bytes, created_at_ms) VALUES (?, 'FULLXX', ?, 0)").bind(gameId, MAXIMUM_GAME_STORAGE_SIZE_BYTES).run();
    await database.query("CREATE TABLE logs (id INTEGER PRIMARY KEY, note TEXT)", []);
    await until(async () => (await runInDurableObject(database, (object: GameDatabaseObject) => (object as unknown as { keptRooms: { sizeBytes: number } }).keptRooms.sizeBytes)) > 0);
    // A database can't grow past what's left, but can still delete.
    const refused = (await database.query("INSERT INTO logs (note) VALUES (?)", ["x".repeat(100_000)])) as { error?: { code: string; message: string } };
    expect(refused.error).toMatchObject({ code: "database_full", message: expect.stringMatching(/^This game's storage \(its database and kept rooms\) would be over the 10 GB a game can have/) });
    expect(await database.query("DELETE FROM logs", [])).toMatchObject({ queryResult: [] });
  });
});
