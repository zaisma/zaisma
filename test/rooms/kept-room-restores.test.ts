import { createExecutionContext, env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MAXIMUM_GAME_STORAGE_SIZE_BYTES, issueRoomKey, listRooms } from "@zaisma/core";
import { REMOVED_CLOSE_CODE } from "@zaisma/game-server";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";
import { GameStorageService } from "../../apps/rooms/src/game-storage.ts";
import { GameRoomsService } from "../../apps/rooms/src/room-updates.ts";

// Kept rooms' worlds going back to a moment (apps/rooms/src/kept-room-restores.ts). Local storage keeps no history, so a stand-in for
// Cloudflare's point-in-time recovery puts the moment's storage back as the next start would. Its real proof ran on Cloudflare.

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
  setup: () => ({ logCount: 0, restored: null, restoredCount: 0 }),
  onJoin(state, player, room) { room.setKept(true); room.setInfo({ name: "Northwatch" }); },
  onRestored(state, restoreInfo) { state.restored = restoreInfo; state.restoredCount++; },
  onMessage(state, player, room, message) {
    if (message === "chop") state.logCount++;
    if (message === "how") room.send(player.id, { logCount: state.logCount, restored: state.restored, restoredCount: state.restoredCount, isKept: room.isKept });
  },
};
`;

const keptRow = (slug: string, code: string) => e.DB.prepare("SELECT * FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(gameIdOf(slug), code).first<any>();
const service = () => new GameRoomsService(createExecutionContext(), e);

/** What the moment's storage held, as Cloudflare's history would, by bookmark. */
const moments = new Map<string, Map<string, unknown>>();
let nextUndoNumber = 1;

/** The room's storage now, to go back to later, under a bookmark. */
async function keepMoment(slug: string, code: string, bookmark: string) {
  await runInDurableObject(roomOf(slug, code), async (_room: Room, state) => {
    moments.set(bookmark, new Map(await state.storage.list()));
  });
}

/** The room's next restore goes through the stand-in: every moment asked for by time is the named bookmark. */
async function standIn(slug: string, code: string, bookmark: string) {
  await runInDurableObject(roomOf(slug, code), (room: Room, state) => {
    (room as unknown as { pointInTime: () => unknown }).pointInTime = () => ({
      bookmarkForTime: async () => bookmark,
      restoreOnNextStart: async (restoredBookmark: string) => {
        const undoBookmark = `undo-${nextUndoNumber++}`;
        moments.set(undoBookmark, new Map(await state.storage.list()));
        await state.storage.deleteAll();
        for (const [key, value] of moments.get(restoredBookmark)!) await state.storage.put(key, value);
        return undoBookmark;
      },
    });
  });
}

/** Until a saved state holds this many logs. */
const savedLogs = (slug: string, code: string, logCount: number) =>
  until(() =>
    runInDurableObject(roomOf(slug, code), async (_room: Room, state) => {
      const chunk = await state.storage.get<string>("stateChunk:0");
      return chunk !== undefined && (JSON.parse(chunk) as { logCount: number }).logCount === logCount;
    }),
  );

const asked = async (player: Awaited<ReturnType<typeof join>>) => {
  player.say("how");
  return (await player.next()).data;
};

describe("a kept room's world going back to a moment", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM kept_rooms; DELETE FROM kept_room_restores; DELETE FROM player_erases; DELETE FROM versions; DELETE FROM games;");
  });

  it("goes back, players reconnect, its game server hears once, and the undo brings back everything since", async () => {
    await addSandboxGame("griefed", WORLD);
    const game = { gameId: gameIdOf("griefed"), slug: "griefed" };
    const a = await join("griefed", "GRFDXX");
    a.say("chop");
    a.say("chop");
    await until(() => keptRow("griefed", "GRFDXX"));
    await savedLogs("griefed", "GRFDXX", 2);
    await keepMoment("griefed", "GRFDXX", "the-moment");
    const row = await keptRow("griefed", "GRFDXX");
    a.say("chop");
    expect(await asked(a)).toMatchObject({ logCount: 3 });

    await standIn("griefed", "GRFDXX", "the-moment");
    const restoreToAtMs = Date.now();
    const restored = await service().restoreKeptRoom({ ...game, roomCode: "GRFDXX", restoreToAtMs });
    expect(restored).toMatchObject({ outcome: "restored", keptRoomRestore: { game_id: game.gameId, room_code: "GRFDXX", restore_to_at_ms: restoreToAtMs, undoes_kept_room_restore_id: null, undo_bookmark: expect.stringMatching(/^undo-/) } });
    await a.closed;
    expect(row.created_at_ms).toBeLessThanOrEqual(restoreToAtMs);

    const b = await join("griefed", "GRFDXX");
    const after = await asked(b);
    expect(after).toMatchObject({ logCount: 2, restoredCount: 1, isKept: true, restored: { keptRoomRestore: { id: (restored as any).keptRoomRestore.id, restoreToAt: new Date(restoreToAtMs).toISOString(), undoesKeptRoomRestoreId: null, erasedPlayerIds: [] } } });
    // Told once: a second player, and a room that wakes again, hear nothing new.
    expect(await asked(b)).toMatchObject({ restoredCount: 1 });

    // The undo goes to the state from just before, with what was only in memory saved first.
    await standIn("griefed", "GRFDXX", "unused");
    const undone = await service().undoKeptRoomRestore({ ...game, roomCode: "GRFDXX", keptRoomRestoreId: (restored as any).keptRoomRestore.id });
    expect(undone).toMatchObject({ outcome: "restored", keptRoomRestore: { undoes_kept_room_restore_id: (restored as any).keptRoomRestore.id } });
    await b.closed;
    const c = await join("griefed", "GRFDXX");
    expect(await asked(c)).toMatchObject({ logCount: 3, restored: { keptRoomRestore: { undoesKeptRoomRestoreId: (restored as any).keptRoomRestore.id } } });
    const rows = await e.DB.prepare("SELECT COUNT(*) AS found_count FROM kept_room_restores WHERE game_id = ?").bind(game.gameId).first<{ found_count: number }>();
    expect(rows!.found_count).toBe(2);
  });

  it("clears what the moment got wrong: a wait, its alarm, its use and who sat there, and it stays kept", async () => {
    await addSandboxGame("moment", WORLD);
    const game = { gameId: gameIdOf("moment"), slug: "moment" };
    const a = await join("moment", "MMENTX");
    await until(() => keptRow("moment", "MMENTX"));
    a.say("chop");
    await savedLogs("moment", "MMENTX", 1);
    a.ws.close(1000);
    await until(async () => (await keptRow("moment", "MMENTX"))?.last_played_at_ms);
    await runInDurableObject(roomOf("moment", "MMENTX"), async (_room: Room, state) => {
      const saved = (await state.storage.get<Record<string, unknown>>("saved"))!;
      const room = (await state.storage.get<Record<string, unknown>>("room"))!;
      // What the moment holds: mid-way through an earlier wait, unkept, with use not yet recorded.
      moments.set("waiting", new Map([...(await state.storage.list()), ["erasesAtMs", Date.now() + 60_000], ["emptiedAtMs", 1], ["saved", { ...saved, usage: { roomPlayDurationSec: 500, messageCount: 500 } }], ["room", { ...room, isKept: false }]]));
    });
    await standIn("moment", "MMENTX", "waiting");
    expect(await service().restoreKeptRoom({ ...game, roomCode: "MMENTX", restoreToAtMs: Date.now() })).toMatchObject({ outcome: "restored" });

    await until(async () => {
      try {
        return await runInDurableObject(roomOf("moment", "MMENTX"), async (_room: Room, state) => (await state.storage.get("keptRoomRestore")) !== undefined);
      } catch {
        return false;
      }
    });
    await runInDurableObject(roomOf("moment", "MMENTX"), async (_room: Room, state) => {
      expect(await state.storage.get("erasesAtMs")).toBeUndefined();
      expect(await state.storage.get("emptiedAtMs")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
      expect((await state.storage.get<{ isKept: boolean }>("room"))!.isKept).toBe(true);
      expect((await state.storage.get<{ usage: { messageCount: number } }>("saved"))!.usage.messageCount).toBe(0);
    });
    const b = await join("moment", "MMENTX");
    expect(await asked(b)).toMatchObject({ logCount: 1, isKept: true });
  });

  it("tells its game server who was erased since the moment, and leaves them out of what Zaisma holds", async () => {
    await addSandboxGame("erased-since", WORLD);
    const game = { gameId: gameIdOf("erased-since"), slug: "erased-since" };
    const a = await join("erased-since", "ERASED");
    await until(() => keptRow("erased-since", "ERASED"));
    a.say("chop");
    await savedLogs("erased-since", "ERASED", 1);
    await keepMoment("erased-since", "ERASED", "before-erase");
    const restoreToAtMs = Date.now();
    await e.DB.prepare("INSERT INTO player_erases (game_id, player_id, erase_status, attempt_count, next_attempt_at_ms, created_at_ms, erased_at_ms) VALUES (?, ?, 'erased', 0, 0, ?, ?)").bind(game.gameId, a.player.id, restoreToAtMs, restoreToAtMs + 1).run();
    await standIn("erased-since", "ERASED", "before-erase");
    expect(await service().restoreKeptRoom({ ...game, roomCode: "ERASED", restoreToAtMs })).toMatchObject({ outcome: "restored" });
    await a.closed;
    await until(() =>
      runInDurableObject(roomOf("erased-since", "ERASED"), async (_room: Room, state) => (await state.storage.get<{ erasedPlayerIds: string[] }>("keptRoomRestore"))?.erasedPlayerIds.includes(a.player.id)).catch(() => false),
    );
    await runInDurableObject(roomOf("erased-since", "ERASED"), async (_room: Room, state) => {
      const saved = (await state.storage.get<{ matchPlayers: { id: string }[] }>("saved"))!;
      expect(saved.matchPlayers.map((player) => player.id)).not.toContain(a.player.id);
      expect((await state.storage.get<{ knownPlayerIds: string[] }>("room"))!.knownPlayerIds).not.toContain(a.player.id);
    });
    const b = await join("erased-since", "ERASED");
    expect(await asked(b)).toMatchObject({ restored: { keptRoomRestore: { erasedPlayerIds: [a.player.id] } } });
  });

  it("refuses what isn't a kept world, a time it can't reach, and a store with no history", async () => {
    await addSandboxGame("refusing", WORLD);
    const game = { gameId: gameIdOf("refusing"), slug: "refusing" };
    await join("refusing", "REFUSE");
    const row = await until(() => keptRow("refusing", "REFUSE"));
    expect(await service().restoreKeptRoom({ ...game, roomCode: "NSUCHX", restoreToAtMs: Date.now() })).toEqual({ outcome: "no_kept_room" });
    expect(await service().restoreKeptRoom({ ...game, roomCode: "REFUSE", restoreToAtMs: row.created_at_ms - 1 })).toEqual({ outcome: "bad_time", earliestRestoreToAtMs: row.created_at_ms });
    expect(await service().restoreKeptRoom({ ...game, roomCode: "REFUSE", restoreToAtMs: Date.now() + 60_000 })).toMatchObject({ outcome: "bad_time" });
    expect(await service().undoKeptRoomRestore({ ...game, roomCode: "REFUSE", keptRoomRestoreId: "kept_room_restore_nosuch" })).toEqual({ outcome: "no_kept_room_restore" });
    // Local storage keeps no history, like a local preview.
    expect(await service().restoreKeptRoom({ ...game, roomCode: "REFUSE", restoreToAtMs: Date.now() })).toEqual({ outcome: "no_history" });
    // Another game can't reach it.
    expect(await service().restoreKeptRoom({ gameId: "gother", slug: "refusing", roomCode: "REFUSE", restoreToAtMs: Date.now() })).toEqual({ outcome: "no_kept_room" });
    // A deleted world goes back only once it's brought back.
    expect(await service().holdKeptRoom({ ...game, roomCode: "REFUSE", erasesAtMs: Date.now() + 60_000, message: null })).toEqual({ holdOutcome: "held" });
    await e.DB.prepare("UPDATE kept_rooms SET erases_at_ms = ? WHERE game_id = ? AND room_code = ?").bind(Date.now() + 60_000, game.gameId, "REFUSE").run();
    expect(await service().restoreKeptRoom({ ...game, roomCode: "REFUSE", restoreToAtMs: Date.now() })).toEqual({ outcome: "no_kept_room" });
  });

  it("goes nowhere when D1 can't keep the record: the world stays as it was", async () => {
    await addSandboxGame("no-record", WORLD);
    const game = { gameId: gameIdOf("no-record"), slug: "no-record" };
    const a = await join("no-record", "NRECDX");
    await until(() => keptRow("no-record", "NRECDX"));
    a.say("chop");
    await savedLogs("no-record", "NRECDX", 1);
    await keepMoment("no-record", "NRECDX", "earlier");
    a.say("chop");
    expect(await asked(a)).toMatchObject({ logCount: 2 });
    await standIn("no-record", "NRECDX", "earlier");
    await e.DB.exec("ALTER TABLE kept_room_restores RENAME TO kept_room_restores_away");
    try {
      expect(await service().restoreKeptRoom({ ...game, roomCode: "NRECDX", restoreToAtMs: Date.now() })).toEqual({ outcome: "failed" });
    } finally {
      await e.DB.exec("ALTER TABLE kept_room_restores_away RENAME TO kept_room_restores");
    }
    await a.closed;
    const b = await join("no-record", "NRECDX");
    expect(await asked(b)).toMatchObject({ logCount: 2, restored: { keptRoomRestore: null } });
  });

  it("is a game server's own to do, in its sandbox, with its mistakes thrown in its code", async () => {
    await addSandboxGame("own-screen", `
export default {
  ticksPerSec: 20,
  setup: () => ({}),
  onJoin(state, player, room) { room.setKept(true); },
  async onRequest(player, request, server) {
    try {
      if (request.kind === "list") return await server.listKeptRoomRestores(request.roomCode);
      if (request.kind === "undo") return await server.undoKeptRoomRestore(request.roomCode, request.keptRoomRestoreId);
      return await server.restoreKeptRoom(request.roomCode, request.restoreOptions);
    } catch (error) {
      return { code: error.code, field: error.field, message: error.message };
    }
  },
};
`);
    await join("own-screen", "SCREEN");
    const row = await until(() => keptRow("own-screen", "SCREEN"));
    const send = async (request: unknown) => {
      const { pass } = await newPass("own-screen");
      const response = await SELF.fetch(`${R}/v1/requests/own-screen`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ pass, request }) });
      return ((await response.json()) as { answer: any }).answer;
    };
    expect(await send({ kind: "list", roomCode: "SCREEN" })).toEqual({ earliestRestoreToAt: new Date(row.created_at_ms).toISOString(), restores: [] });
    expect(await send({ kind: "list", roomCode: "NSUCHX" })).toMatchObject({ code: "bad_room_call", field: "server.listKeptRoomRestores" });
    expect(await send({ kind: "restore", roomCode: "SCREEN", restoreOptions: { restoreToAt: "an hour ago" } })).toMatchObject({ code: "bad_room_call" });
    expect(await send({ kind: "restore", roomCode: "SCREEN", restoreOptions: { restoreToAt: new Date().toISOString(), extra: 1 } })).toMatchObject({ code: "bad_room_call" });
    expect(await send({ kind: "restore", roomCode: "SCREEN", restoreOptions: { restoreToAt: "2020-01-01T00:00:00Z" } })).toMatchObject({ code: "bad_room_call", message: expect.stringContaining("isn't a moment") });
    // Local storage keeps no history.
    expect(await send({ kind: "restore", roomCode: "SCREEN", restoreOptions: { restoreToAt: new Date().toISOString() } })).toMatchObject({ code: "room_call_unavailable" });
    expect(await send({ kind: "undo", roomCode: "SCREEN", keptRoomRestoreId: "kept_room_restore_nosuch" })).toMatchObject({ code: "bad_room_call" });
  });

  it("comes back from its last copy after it was erased, telling its game server", async () => {
    await addSandboxGame("from-copy", WORLD);
    const a = await join("from-copy", "FRMCPX");
    await until(() => keptRow("from-copy", "FRMCPX"));
    a.say("chop");
    await savedLogs("from-copy", "FRMCPX", 1);
    const storage = new GameStorageService(createExecutionContext(), e);
    const copy = await new Response(await storage.keptRoomBackup(gameIdOf("from-copy"), "from-copy", "FRMCPX")).text();
    expect(await service().deleteKeptRoom({ gameId: gameIdOf("from-copy"), slug: "from-copy", roomCode: "FRMCPX" })).toEqual({ isDeleted: true });
    await a.closed;

    const copySavedAtMs = Date.now() - 60_000;
    const lines = () => new Response(copy).body!;
    expect(await storage.bringBackKeptRoom(gameIdOf("from-copy"), "from-copy", "FRMCPX", lines(), copySavedAtMs, false)).toEqual({ isInUse: false });
    const b = await join("from-copy", "FRMCPX");
    expect(await asked(b)).toMatchObject({ logCount: 1, isKept: true, restored: { keptRoomRestore: { id: null, restoreToAt: new Date(copySavedAtMs).toISOString() } } });
    // A room under that code now is another world, which never gets replaced.
    expect(await storage.bringBackKeptRoom(gameIdOf("from-copy"), "from-copy", "FRMCPX", lines(), copySavedAtMs, false)).toEqual({ isInUse: true });
  });
});
