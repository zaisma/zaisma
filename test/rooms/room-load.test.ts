import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";

// A full room at full speed: a sandboxed game server at 60 ticks a second with 100 players, each sending
// 30 messages a second, the most a player may send, and getting the whole world every tick. It runs in
// workerd, the runtime Cloudflare runs rooms in; ROOM_LIMITS.maximumPlayerCount is what this carries.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

const PLAYER_COUNT = 100;
const TICKS_PER_SEC = 60;
const MESSAGES_PER_SEC = 30;
const DURATION_SEC = 10;

// Each player's position as the game server broadcasts it, about 20 bytes a player: 2 KB a tick for 100.
const WORLD = `
export default {
  maximumPlayerCount: ${PLAYER_COUNT},
  ticksPerSec: ${TICKS_PER_SEC},
  setup: () => ({ tickNumber: 0, positions: {} }),
  onJoin(state, player) { state.positions[player.id] = [0, 0]; },
  onLeave(state, player) { delete state.positions[player.id]; },
  onMessage(state, player, message) {
    const position = state.positions[player.id];
    if (position && message && typeof message.x === "number") { position[0] = message.x; position[1] = message.y; }
  },
  onTick(state, tickDurationSec, room) {
    state.tickNumber++;
    room.broadcast({ type: "world", tickNumber: state.tickNumber, positions: Object.values(state.positions) });
  },
};
`;

let address = 0;

async function addWorld(slug: string) {
  const id = `g${slug.replace(/-/g, "")}`;
  const version = `v${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)").bind(id, slug, slug, version).run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(version, id, `games/${version}`).run();
  await e.GAMES.put(`games/${version}/zaisma-server.js`, WORLD);
  return id;
}

/** A player in the room who counts the world broadcasts they get, answers probes as the SDK does, and keeps any error. */
async function player(slug: string, code: string) {
  const roomKey = await issueRoomKey(e.DB, `g${slug.replace(/-/g, "")}`);
  const passAnswer = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.${++address % 250}.${address % 200}` }, body: JSON.stringify({ gameSlug: slug, roomKey }) });
  const { pass } = await passAnswer.json<{ pass: string }>();
  const up = await SELF.fetch(`${R}/v1/rooms/${slug}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.${++address % 250}.${address % 200}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const got = { worldCount: 0, lastTickNumber: 0, errors: [] as string[], isClosed: false, isWelcomed: false };
  ws.addEventListener("message", (event) => {
    const text = event.data as string;
    // Most of what comes is the world: counted without reading it all.
    if (text.startsWith('{"type":"message","data":{"type":"world"')) {
      got.worldCount++;
      got.lastTickNumber = Number(text.slice(text.indexOf('"tickNumber":') + 13, text.indexOf(",", text.indexOf('"tickNumber":'))));
      return;
    }
    const message = JSON.parse(text);
    if (message.type === "probe") ws.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
    else if (message.type === "welcome") got.isWelcomed = true;
    else if (message.type === "error") got.errors.push(message.code);
  });
  ws.addEventListener("close", () => (got.isClosed = true));
  ws.send(JSON.stringify({ type: "hello", pass }));
  return { ws, got };
}

describe("a full room at full speed", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM room_message_types; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it(`carries ${PLAYER_COUNT} players at ${TICKS_PER_SEC} ticks a second, each sending ${MESSAGES_PER_SEC} messages a second`, async () => {
    await addWorld("full-world");
    const players: Awaited<ReturnType<typeof player>>[] = [];
    for (let i = 0; i < PLAYER_COUNT; i++) players.push(await player("full-world", "WRLDAA"));
    for (let i = 0; i < 100 && players.some((each) => !each.got.isWelcomed); i++) await new Promise((r) => setTimeout(r, 20));
    expect(players.filter((each) => each.got.isWelcomed)).toHaveLength(PLAYER_COUNT);

    const startCounts = players.map((each) => each.got.worldCount);
    const startTickNumber = Math.max(...players.map((each) => each.got.lastTickNumber));
    let sendCount = 0;
    const sending = setInterval(() => {
      sendCount++;
      for (const [i, each] of players.entries()) {
        try {
          each.ws.send(JSON.stringify({ type: "message", data: { x: i, y: sendCount } }));
        } catch {
          // Closed: the checks below say so.
        }
      }
    }, 1000 / MESSAGES_PER_SEC);
    await new Promise((r) => setTimeout(r, DURATION_SEC * 1000));
    clearInterval(sending);
    await new Promise((r) => setTimeout(r, 200));

    const tickCount = Math.max(...players.map((each) => each.got.lastTickNumber)) - startTickNumber;
    const receivedCounts = players.map((each, i) => each.got.worldCount - startCounts[i]!);
    const summary = { playerCount: PLAYER_COUNT, sentPerPlayer: sendCount, tickCount, expectedTickCount: TICKS_PER_SEC * DURATION_SEC, fewestReceived: Math.min(...receivedCounts), closedCount: players.filter((each) => each.got.isClosed).length, errors: [...new Set(players.flatMap((each) => each.got.errors))] };
    console.log("Room load:", JSON.stringify(summary));
    expect(summary.closedCount).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(tickCount).toBeGreaterThanOrEqual(TICKS_PER_SEC * DURATION_SEC * 0.9);
    expect(summary.fewestReceived).toBeGreaterThanOrEqual(tickCount * 0.9);
    for (const each of players) each.ws.close(1000);
  }, 120_000);
});
