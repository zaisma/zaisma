import { createExecutionContext, env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";
import { GameRoomsService } from "../../apps/rooms/src/room-updates.ts";

// A version published "now" reaching a live match (docs/DEVELOPER-API.md, "Updates"): the room hears it,
// the game server may hold it, then the room saves, closes its connections and the new version carries on.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

/** A live game running its own game server, on its first version, with that server's file. */
async function addSandboxGame(slug: string, server: string) {
  const id = `g${slug.replace(/-/g, "")}`;
  const version = `v${slug.replace(/-/g, "")}1`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)").bind(id, slug, slug, version).run();
  await addVersion(id, version, server);
  return { gameId: id, versionId: version };
}
async function addVersion(gameId: string, versionId: string, server: string) {
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameId, `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
}
/** The game publishes versionId "now", as publishVersion writes it. */
async function publishNow(gameId: string, versionId: string, hasGameFileChanges: boolean) {
  await e.DB.prepare("UPDATE games SET live_version_id = ?, live_version_match_update_mode = 'now', has_live_version_game_file_changes = ?, live_version_published_at_ms = ? WHERE id = ?").bind(versionId, hasGameFileChanges ? 1 : 0, Date.now(), gameId).run();
}

let address = 0;
async function newPass(game: string) {
  const roomKey = await issueRoomKey(e.DB, `g${game.replace(/-/g, "")}`);
  const response = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey }) });
  return response.json<{ pass: string; player: { id: string; name: string } }>();
}

async function join(game: string, code: string, samePass?: string, helloFields: Record<string, unknown> = {}) {
  const { pass, player } = samePass ? { pass: samePass, player: null as never } : await newPass(game);
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data as string);
    if (m.type === "probe") {
      try {
        ws.send(JSON.stringify({ type: "probe_answer", probeNumber: m.probeNumber }));
      } catch {
        // Closed.
      }
      return;
    }
    const waiter = waiters.shift();
    waiter ? waiter(m) : inbox.push(m);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((resolve) => waiters.push(resolve)));
  const until = async (type: string) => {
    for (;;) {
      const m = await next();
      if (m.type === type) return m;
    }
  };
  const say = (data: unknown) => ws.send(JSON.stringify({ type: "message", data }));
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, ...helloFields }));
  expect((await next()).type).toBe("welcome");
  return { ws, player, pass, say, next, until, closed };
}

/** A turn-based game server that counts and says which version it is; with onVersionUpdate it holds the switch until "round over". */
const server = (versionLabel: string, holds: boolean) => `export default {
  setup: () => ({ count: 0, restored: null, heldFor: null }),
  onMessage(state, player, room, message) {
    if (message === "add") state.count++;
    if (message === "round over") room.applyVersionUpdate();
    if (message === "how") room.send(player.id, { version: "${versionLabel}", count: state.count, restored: state.restored, heldFor: state.heldFor });
    return state;
  },
  onRestored(state, restoreInfo) { state.restored = restoreInfo; return state; },
  ${holds ? "onVersionUpdate(state, versionUpdate) { state.heldFor = versionUpdate.versionId; return state; }," : ""}
};`;

const service = () => new GameRoomsService(createExecutionContext(), e);
const roomStub = (slug: string, code: string) => e.ROOMS.get(e.ROOMS.idFromName(`${slug}:${code}`));

describe("a match moving to a version published now", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("waits for a game server with onVersionUpdate, then carries on from the saved state on the new version", async () => {
    const { gameId } = await addSandboxGame("holder", server("one", true));
    const lucas = await join("holder", "HLDRNW");
    lucas.say("add");
    lucas.say("add");
    // The room is listed once it has a player, so the rooms Worker finds it.
    for (let tries = 0; tries < 50 && !(await e.DB.prepare("SELECT 1 FROM live_rooms WHERE game_id = ?").bind(gameId).first()); tries++) await new Promise((r) => setTimeout(r, 50));
    await addVersion(gameId, "vholder2", server("two", true));
    await publishNow(gameId, "vholder2", false);

    expect(await service().updateMatches({ gameId, slug: "holder", versionId: "vholder2", hasGameFileChanges: false })).toEqual({ toldRoomCount: 1 });
    const coming = await lucas.until("version_update");
    expect(coming).toMatchObject({ step: "coming", versionId: "vholder2", isReloading: false });
    // Held: up to 5 minutes, while the game server finishes its round.
    expect(Date.parse(coming.appliesAt) - Date.now()).toBeGreaterThan(290_000);
    lucas.say("how");
    expect((await lucas.until("message")).data).toMatchObject({ version: "one", count: 2, heldFor: "vholder2" });

    lucas.say("round over");
    expect(await lucas.until("version_update")).toMatchObject({ step: "now", versionId: "vholder2" });
    expect(await lucas.closed).toBe(4004);

    // Back in on the new version, from the saved state, told which version saved it.
    const back = await join("holder", "HLDRNW", lucas.pass);
    back.say("how");
    const how = (await back.until("message")).data;
    expect(how).toMatchObject({ version: "two", count: 2 });
    expect(how.restored).toMatchObject({ savedVersionId: "vholder1" });
    back.ws.close(1000);
  });

  it("switches after its notice without onVersionUpdate, and finds a version it wasn't told about when it checks the game", async () => {
    const { gameId } = await addSandboxGame("noticer", server("one", false));
    const emma = await join("noticer", "NTCRNW");
    emma.say("add");
    await addVersion(gameId, "vnoticer2", server("two", false));
    await publishNow(gameId, "vnoticer2", true);
    // Not told: the room's next check of the game finds it.
    await runInDurableObject(roomStub("noticer", "NTCRNW"), (room: Room) => void ((room as any).lastCheckAtMs = 0));
    emma.say("add");
    const coming = await emma.until("version_update");
    expect(coming).toMatchObject({ step: "coming", versionId: "vnoticer2", isReloading: true });
    const noticeMs = Date.parse(coming.appliesAt) - Date.now();
    expect(noticeMs).toBeGreaterThan(5_000);
    expect(noticeMs).toBeLessThanOrEqual(10_000);
    // Its time comes (the alarm, if the room slept meanwhile).
    await runInDurableObject(roomStub("noticer", "NTCRNW"), async (room: Room, state) => {
      (room as any).pendingVersionUpdate.appliesAtMs = Date.now() - 1;
      await state.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(roomStub("noticer", "NTCRNW"));
    expect(await emma.until("version_update")).toMatchObject({ step: "now", isReloading: true });
    expect(await emma.closed).toBe(4004);
    const back = await join("noticer", "NTCRNW", emma.pass);
    back.say("how");
    expect((await back.until("message")).data).toMatchObject({ version: "two", count: 2, restored: { savedVersionId: "vnoticer1" } });
    back.ws.close(1000);
  });

  it("moves an empty room at once, so whoever rejoins it gets the new version", async () => {
    const { gameId } = await addSandboxGame("sleeper", server("one", true));
    const mia = await join("sleeper", "SLPRNW");
    mia.say("add");
    mia.say("how");
    expect((await mia.until("message")).data).toMatchObject({ count: 1 });
    mia.ws.close(1000);
    await new Promise((r) => setTimeout(r, 100));
    await addVersion(gameId, "vsleeper2", server("two", true));
    await runInDurableObject(roomStub("sleeper", "SLPRNW"), async (room: Room) => {
      await (room as any).startVersionUpdate("vsleeper2", false);
      expect((room as any).meta.versionId).toBe("vsleeper2");
    });
    const back = await join("sleeper", "SLPRNW", mia.pass);
    back.say("how");
    expect((await back.until("message")).data).toMatchObject({ version: "two", count: 1, restored: { savedVersionId: "vsleeper1" } });
    back.ws.close(1000);
  });
});

/** A hello the room may turn away: its first answer and the code its connection closes with. */
async function knock(game: string, code: string, helloFields: Record<string, unknown>) {
  const { pass } = await newPass(game);
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const ws = up.webSocket!;
  ws.accept();
  const first = new Promise<any>((resolve) => ws.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), { once: true }));
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (event) => resolve(event.code)));
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, ...helloFields }));
  return { ws, first: await first, closed };
}

const roomRow = async (gameId: string) => {
  for (let tries = 0; tries < 50; tries++) {
    const row = await e.DB.prepare("SELECT version_id FROM live_rooms WHERE game_id = ?").bind(gameId).first<{ version_id: string | null }>();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

// A player always plays the version their room runs (docs/DEVELOPER-API.md, "Updates"): a newcomer whose game
// runs another version is turned away with other_version and the room's, so their game reloads at it first.
describe("a room on another version than the player's game", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("turns a newcomer on another version away with the room's, and lets in one on its own or who doesn't say", async () => {
    const { gameId, versionId } = await addSandboxGame("finisher", server("one", false));
    const olivia = await join("finisher", "FNSHRA", undefined, { versionId });
    // Its row names the version, for the game domain.
    expect(await roomRow(gameId)).toEqual({ version_id: versionId });
    // The next version goes live for the next match: this one finishes on the first.
    await addVersion(gameId, "vfinisher2", server("two", false));
    await e.DB.prepare("UPDATE games SET live_version_id = 'vfinisher2' WHERE id = ?").bind(gameId).run();

    const newer = await knock("finisher", "FNSHRA", { versionId: "vfinisher2" });
    expect(newer.first).toEqual({ type: "error", code: "other_version", message: "This room runs another version of the game, so the game reloads at it first.", versionId });
    expect(await newer.closed).toBe(4001);

    const same = await join("finisher", "FNSHRA", undefined, { versionId });
    const unsaid = await join("finisher", "FNSHRA");
    // Already in the room: coming back on another version never bounces them out of the match.
    olivia.ws.close(1000);
    await olivia.closed;
    const back = await join("finisher", "FNSHRA", olivia.pass, { versionId: "vfinisher2" });
    for (const player of [same, unsaid, back]) player.ws.close(1000);
  });

  it("writes the new version into its row when it switches, before anyone reloads", async () => {
    const { gameId, versionId } = await addSandboxGame("switcher", server("one", false));
    const noah = await join("switcher", "SWTCHR", undefined, { versionId });
    expect(await roomRow(gameId)).toEqual({ version_id: versionId });
    await addVersion(gameId, "vswitcher2", server("two", false));
    await publishNow(gameId, "vswitcher2", true);
    await runInDurableObject(roomStub("switcher", "SWTCHR"), async (room: Room) => {
      await (room as any).startVersionUpdate("vswitcher2", true);
      await (room as any).applyVersionUpdate();
    });
    expect(await noah.closed).toBe(4004);
    expect(await roomRow(gameId)).toEqual({ version_id: "vswitcher2" });
  });

  it("never turns anyone away in a room without a game server of the game's own, and its row has no version", async () => {
    await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES ('grelayer', 'relayer', 'relayer', 'live', 'vrelayer1', 'relay', 'page', 0, 0)").run();
    const ava = await join("relayer", "RLYRAB", undefined, { versionId: "vrelayer1" });
    const other = await join("relayer", "RLYRAB", undefined, { versionId: "vrelayer0" });
    expect(await roomRow("grelayer")).toEqual({ version_id: null });
    for (const player of [ava, other]) player.ws.close(1000);
  });
});
