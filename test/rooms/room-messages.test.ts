import { createExecutionContext, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import { GameRoomsService } from "../../apps/rooms/src/room-updates.ts";
import { sendDueRoomMessages } from "../../apps/rooms/src/room-reach.ts";

// A game reaching its own live rooms on Zaisma (apps/rooms/src/room-reach.ts): a sandboxed game server's
// room.sendToRoom, sendToEveryRoom and listRooms, the developer's sends, kicks and ends through
// GameRoomsService (what the site's API calls), and scheduled sends on the every-minute cron.
// The same calls on the Node runner: test/node/room-messages.test.ts.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;
const service = () => new GameRoomsService(createExecutionContext(), e);

/** Worlds that tell each other things; a game server whose rooms all hand room messages to onRoomMessage. */
const WORLDS = `
export default {
  maximumPlayerCount: 4,
  setup: () => ({}),
  async onMessage(state, player, room, message) {
    if (message.kind === "tell") room.send(player.id, { told: await room.sendToRoom(message.toRoomCode, { kind: "party", from: player.name }) });
    if (message.kind === "everyone") room.send(player.id, { everyone: await room.sendToEveryRoom({ kind: "news" }, message.labels ? { labels: message.labels } : undefined) });
    if (message.kind === "list") room.send(player.id, { listed: (await room.listRooms()).rooms.map((listed) => listed.roomCode).sort() });
    if (message.kind === "label") { room.setInfo({ labels: message.labels }); room.send(player.id, { labelled: true }); }
    if (message.kind === "burst") {
      try { for (let index = 0; index < 21; index++) room.sendToRoom(message.toRoomCode, { index }); } catch (error) { room.send(player.id, { refused: error.code }); }
    }
  },
  onRoomMessage(state, roomMessage, room) { room.broadcast({ heard: roomMessage }); },
  onLeave(state, player, room, leaveInfo) { room.broadcast({ left: player.name, reason: leaveInfo.reason }); },
};
`;

/** A game server with no onRoomMessage: its players' games hear room messages themselves. */
const QUIET = `export default { maximumPlayerCount: 4, setup: () => ({}) };`;

const gameIdOf = (slug: string) => `g${slug.replace(/-/g, "")}`;

async function addSandboxGame(slug: string, server: string) {
  const version = `v${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)").bind(gameIdOf(slug), slug, slug, version).run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(version, gameIdOf(slug), `games/${version}`).run();
  await e.GAMES.put(`games/${version}/zaisma-server.js`, server);
}

let address = 0;
async function join(game: string, code: string) {
  const roomKey = await issueRoomKey(e.DB, gameIdOf(game));
  const passed = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey }) });
  const { pass, player } = await passed.json<{ pass: string; player: { id: string; name: string } }>();
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((message: any) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string);
    if (message.type === "probe") {
      try {
        ws.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
      } catch {
        // Closed.
      }
      return;
    }
    const waiter = waiters.shift();
    waiter ? waiter(message) : inbox.push(message);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((resolve) => waiters.push(resolve)));
  const until = async (type: string) => {
    for (;;) {
      const message = await next();
      if (message.type === type) return message;
    }
  };
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
  await until("welcome");
  return { ws, player, until, say: (data: unknown) => ws.send(JSON.stringify({ type: "message", data })), fromGame: async () => (await until("message")).data };
}

/** Wait until the rooms' list has caught up with what a room did. */
const untilListed = (test: () => Promise<boolean>) => vi.waitFor(async () => expect(await test()).toBe(true), { timeout: 2000 });
const listedCount = async (slug: string) => (await e.DB.prepare("SELECT count(*) AS room_count FROM live_rooms WHERE game_id = ?").bind(gameIdOf(slug)).first<number>("room_count")) ?? 0;

describe("reaching live rooms on Zaisma", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM scheduled_room_messages; DELETE FROM kept_rooms; DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("a room's message reaches another room's onRoomMessage, every room with someone in it but the sender, and rooms by label", async () => {
    await addSandboxGame("worlds", WORLDS);
    const ana = await join("worlds", "AAAAAA");
    const ben = await join("worlds", "BBBBBB");
    const cleo = await join("worlds", "CCCCCC");
    await untilListed(async () => (await listedCount("worlds")) === 3);

    ana.say({ kind: "tell", toRoomCode: "BBBBBB" });
    expect(await ben.fromGame()).toEqual({ heard: { message: { kind: "party", from: ana.player.name }, senderKind: "room", fromRoomCode: "AAAAAA", sentAt: expect.any(String) } });
    expect(await ana.fromGame()).toEqual({ told: { isDelivered: true } });
    // A code that names no room of the game wakes nothing.
    ana.say({ kind: "tell", toRoomCode: "ZZZZZZ" });
    expect(await ana.fromGame()).toEqual({ told: { isDelivered: false } });

    ana.say({ kind: "everyone" });
    expect(await ben.fromGame()).toMatchObject({ heard: { message: { kind: "news" }, senderKind: "room", fromRoomCode: "AAAAAA" } });
    expect(await cleo.fromGame()).toMatchObject({ heard: { message: { kind: "news" } } });
    expect(await ana.fromGame()).toEqual({ everyone: { roomCount: 2 } });

    cleo.say({ kind: "label", labels: { Region: "North" } });
    expect(await cleo.fromGame()).toEqual({ labelled: true });
    await untilListed(async () => (await e.DB.prepare("SELECT labels FROM live_rooms WHERE game_id = ? AND room_code = 'CCCCCC'").bind(gameIdOf("worlds")).first<string>("labels")) === '{"Region":"North"}');
    ana.say({ kind: "everyone", labels: { Region: "North" } });
    expect(await cleo.fromGame()).toMatchObject({ heard: { message: { kind: "news" } } });
    expect(await ana.fromGame()).toEqual({ everyone: { roomCount: 1 } });

    ana.say({ kind: "list" });
    expect(await ana.fromGame()).toEqual({ listed: ["AAAAAA", "BBBBBB", "CCCCCC"] });
    // 20 room messages a second from one room, counted in its sandbox as on the developer's own server.
    ana.say({ kind: "burst", toRoomCode: "BBBBBB" });
    expect(await ana.fromGame()).toEqual({ refused: "room_call_limit" });
    for (const each of [ana, ben, cleo]) each.ws.close();
  });

  it("the developer's message reaches players' games as roomMessage without onRoomMessage, and a room takes 100 a second", async () => {
    await addSandboxGame("quiet", QUIET);
    const ana = await join("quiet", "QQQQQQ");
    await untilListed(async () => (await listedCount("quiet")) === 1);
    const game = { gameId: gameIdOf("quiet"), slug: "quiet" };
    expect(await service().sendRoomMessage({ ...game, roomCode: "QQQQQQ", message: { kind: "announcement" } })).toEqual({ deliveryOutcome: "delivered" });
    expect(await ana.until("room_message")).toEqual({ type: "room_message", roomMessage: { message: { kind: "announcement" }, senderKind: "developer", fromRoomCode: null, sentAt: expect.any(String) } });
    expect(await service().sendRoomMessage({ ...game, roomCode: "WWWWWW", message: 1 })).toEqual({ deliveryOutcome: "no_room" });
    const outcomes = await Promise.all(Array.from({ length: 110 }, (_, index) => service().sendRoomMessage({ ...game, roomCode: "QQQQQQ", message: index })));
    expect(outcomes.some((outcome) => outcome.deliveryOutcome === "room_busy")).toBe(true);
    ana.ws.close();
  });

  it("the developer looks into a room, removes a player (onLeave hears kicked) and ends it", async () => {
    await addSandboxGame("moderated", WORLDS);
    const ana = await join("moderated", "MMMMMM");
    const ben = await join("moderated", "MMMMMM");
    await untilListed(async () => (await listedCount("moderated")) === 1);
    const game = { gameId: gameIdOf("moderated"), slug: "moderated" };
    const found = await service().getRoom({ ...game, roomCode: "MMMMMM" });
    expect(found!.room).toMatchObject({ roomCode: "MMMMMM", playerCount: 2, isKept: false });
    expect(found!.players.map((each) => [each.playerId, each.isSpectator, each.isAway])).toEqual([
      [ana.player.id, false, false],
      [ben.player.id, false, false],
    ]);
    expect(await service().getRoom({ ...game, roomCode: "NNNNNN" })).toBeNull();

    expect(await service().kickPlayer({ ...game, roomCode: "MMMMMM", playerId: "player_nobodyhere", message: "", isKeptOut: false })).toEqual({ kickOutcome: "no_player_in_room" });
    expect(await service().kickPlayer({ ...game, roomCode: "MMMMMM", playerId: ana.player.id, message: "Removed for griefing.", isKeptOut: true })).toEqual({ kickOutcome: "kicked" });
    expect(await ana.until("kicked")).toEqual({ type: "kicked", message: "Removed for griefing.", isKeptOut: true });
    expect(await ben.fromGame()).toEqual({ left: ana.player.name, reason: "kicked" });

    expect(await service().endRoom({ ...game, roomCode: "MMMMMM", message: "Closing for maintenance." })).toEqual({ endOutcome: "ended" });
    expect(await ben.until("ended")).toEqual({ type: "ended", message: "Closing for maintenance.", endReason: "game" });
    expect(await service().endRoom({ ...game, roomCode: "NNNNNN", message: null })).toEqual({ endOutcome: "no_room" });
  });

  it("a scheduled send goes out on the cron run after its time, records how many rooms took it, and none for a game that can't be played", async () => {
    await addSandboxGame("events", WORLDS);
    await addSandboxGame("held", WORLDS);
    const ana = await join("events", "EEEEEE");
    const ben = await join("events", "FFFFFF");
    await untilListed(async () => (await listedCount("events")) === 2);
    const nowMs = Date.now();
    await e.DB.prepare("INSERT INTO scheduled_room_messages (id, game_id, room_message_json, labels_json, send_at_ms, created_at_ms) VALUES ('scheduled_room_message_due', ?, '{\"kind\":\"blood_moon\"}', NULL, ?, ?), ('scheduled_room_message_later', ?, '{\"kind\":\"later\"}', NULL, ?, ?), ('scheduled_room_message_held', ?, '{\"kind\":\"held\"}', NULL, ?, ?)")
      .bind(gameIdOf("events"), nowMs - 1000, nowMs - 60_000, gameIdOf("events"), nowMs + 3_600_000, nowMs, gameIdOf("held"), nowMs - 1000, nowMs - 60_000)
      .run();
    await e.DB.prepare("UPDATE games SET review_status = 'held' WHERE id = ?").bind(gameIdOf("held")).run();

    expect(await sendDueRoomMessages(e, nowMs)).toBe(2);
    expect(await ana.fromGame()).toMatchObject({ heard: { message: { kind: "blood_moon" }, senderKind: "developer", fromRoomCode: null } });
    expect(await ben.fromGame()).toMatchObject({ heard: { message: { kind: "blood_moon" } } });
    const { results } = await e.DB.prepare("SELECT id, sent_at_ms, delivered_room_count FROM scheduled_room_messages ORDER BY id").all<{ id: string; sent_at_ms: number | null; delivered_room_count: number | null }>();
    expect(results).toEqual([
      { id: "scheduled_room_message_due", sent_at_ms: nowMs, delivered_room_count: 2 },
      { id: "scheduled_room_message_held", sent_at_ms: nowMs, delivered_room_count: 0 },
      { id: "scheduled_room_message_later", sent_at_ms: null, delivered_room_count: null },
    ]);
    // Claimed once: a run that overlaps sends nothing twice.
    expect(await sendDueRoomMessages(e, nowMs)).toBe(0);
    ana.ws.close();
    ben.ws.close();
  });

  it("the game sends to every room up to 10 times a minute, its game server and the developer together", async () => {
    await addSandboxGame("busy", WORLDS);
    const game = { gameId: gameIdOf("busy"), slug: "busy" };
    const sent = [];
    for (let index = 0; index < 11; index++) sent.push(await service().sendToEveryRoom({ ...game, labels: null, message: index }));
    expect(sent.slice(0, 10).every((each) => !each.isLimited)).toBe(true);
    expect(sent[10]).toEqual({ roomCount: 0, isLimited: true });
  });
});
