import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_getMiniflareWorkerOptions } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { issueRoomKey } from "../../packages/core/src/rooms.ts";
import { generateSigningKey } from "../../packages/game-server/src/pass.ts";

/*
 * A full room at full speed: a sandboxed game server at 60 ticks a second with 100 players, each sending 30 messages a second, the
 * most a player may send, and getting the whole world every tick, for 20 seconds. The room runs in workerd, the runtime Cloudflare
 * runs rooms in, and its players here in Node, as real players are on machines of their own: inside the runtime they'd take its
 * thread from the room (6,000 world messages a second coming in), and the room would fall behind on their account.
 * ROOM_LIMITS.maximumPlayerCount is what this carries. The room keeps up when its measured round trip to the players stays low to
 * the end: a room that falls behind on its incoming messages shows it as a round trip that grows every second, and drops its players
 * as too far behind once their answers are 8 seconds late.
 */

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const PLAYER_COUNT = 100;
const TICKS_PER_SEC = 60;
const MESSAGES_PER_SEC = 30;
const DURATION_SEC = 20;
// The room's round trip to its players, averaged over the last seconds: a few milliseconds when it keeps up, and seconds when it doesn't.
const MAXIMUM_LAST_PING_DURATION_MS = 500;
// The share of 60 ticks a second the room makes. Its timer doesn't catch up a late tick, and on GitHub's 4-core runners the players
// here take cores of their own: 88 to 99% in 60 runs there. A room whose ticks got a fifth slower still fails.
const MINIMUM_TICK_SHARE = 0.8;

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

type ClientSocket = { accept(): void; send(text: string): void; close(code?: number): void; addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void): void };
let rooms: Miniflare;
let database: D1Database;

beforeAll(async () => {
  // The rooms Worker as wrangler would run it, bundled, with the settings its tests use (vitest.config.ts).
  const { workerOptions } = unstable_getMiniflareWorkerOptions("apps/rooms/wrangler.jsonc");
  const { serviceBindings: _chatCheck, ...options } = workerOptions as typeof workerOptions & { serviceBindings?: unknown };
  const bundle = await build({ entryPoints: ["apps/rooms/src/index.ts"], bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], external: ["cloudflare:*", "node:*"], write: false });
  rooms = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          ...options,
          name: "zaisma-rooms",
          modules: [{ type: "ESModule", path: "index.mjs", contents: bundle.outputFiles[0]!.text }],
          bindings: { ...(options.bindings ?? {}), ISSUER: R, SITE_ORIGIN: "https://zaisma.test", GAME_HOST_MODE: "path", GAME_ORIGIN: ORIGIN, GAME_DOMAIN: "", PASS_SIGNING_KEY: await generateSigningKey() },
        },
      ],
    } as Parameters<typeof convertV4MiniflareOptions>[0]),
  );
  database = (await rooms.getD1Database("DB")) as unknown as D1Database;
  for (const migration of await readD1Migrations("migrations")) await database.batch(migration.queries.map((query) => database.prepare(query)));
  await database.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES ('gfullworld', 'full-world', 'full-world', 'live', 'vfullworld', 'own', 'page', 0, 0)").run();
  await database.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('vfullworld', 'gfullworld', 'games/vfullworld', 2, 0, 'approved', 0)").run();
  await (await rooms.getR2Bucket("GAMES")).put("games/vfullworld/zaisma-server.js", WORLD);
}, 120_000);

afterAll(async () => {
  await rooms?.dispose();
});

let address = 0;
const nextAddress = () => `198.51.${++address % 250}.${address % 200}`;

/** A player in the room who counts the world broadcasts they get, answers probes as the SDK does, and keeps the room's measured round trip. */
async function player() {
  const passAnswer = await rooms.dispatchFetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": nextAddress() }, body: JSON.stringify({ gameSlug: "full-world", roomKey: await issueRoomKey(database, "gfullworld") }) });
  const { pass } = (await passAnswer.json()) as { pass: string };
  const up = await rooms.dispatchFetch(`${R}/v1/rooms/full-world/WRLDAA`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": nextAddress() } });
  expect(up.status).toBe(101);
  const ws = up.webSocket as unknown as ClientSocket;
  ws.accept();
  // isLeaving: the test is closing the socket, so a probe that comes after gets no answer (a closing socket can't send).
  const got = { worldCount: 0, lastTickNumber: 0, errors: [] as string[], isClosed: false, isLeaving: false, isWelcomed: false, pings: [] as { atMs: number; pingDurationMs: number }[] };
  ws.addEventListener("message", (event) => {
    const text = String(event.data);
    // Most of what comes is the world: counted without reading it all.
    if (text.startsWith('{"type":"message","data":{"type":"world"')) {
      got.worldCount++;
      got.lastTickNumber = Number(text.slice(text.indexOf('"tickNumber":') + 13, text.indexOf(",", text.indexOf('"tickNumber":'))));
      return;
    }
    const message = JSON.parse(text);
    if (message.type === "probe") {
      if (message.pingDurationMs !== null) got.pings.push({ atMs: Date.now(), pingDurationMs: message.pingDurationMs });
      if (!got.isClosed && !got.isLeaving) ws.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
    } else if (message.type === "welcome") got.isWelcomed = true;
    else if (message.type === "error") got.errors.push(message.code);
  });
  ws.addEventListener("close", () => (got.isClosed = true));
  ws.send(JSON.stringify({ type: "hello", pass }));
  return { ws, got };
}

describe("a full room at full speed", () => {
  it(`carries ${PLAYER_COUNT} players at ${TICKS_PER_SEC} ticks a second, each sending ${MESSAGES_PER_SEC} messages a second, and keeps up`, async () => {
    const players: Awaited<ReturnType<typeof player>>[] = [];
    for (let i = 0; i < PLAYER_COUNT; i++) players.push(await player());
    for (let i = 0; i < 250 && players.some((each) => !each.got.isWelcomed); i++) await new Promise((r) => setTimeout(r, 20));
    expect(players.filter((each) => each.got.isWelcomed)).toHaveLength(PLAYER_COUNT);

    const startCounts = players.map((each) => each.got.worldCount);
    const startTickNumber = Math.max(...players.map((each) => each.got.lastTickNumber));
    const startedAtMs = Date.now();
    let sendCount = 0;
    const sending = setInterval(() => {
      sendCount++;
      for (const [i, each] of players.entries()) if (!each.got.isClosed) each.ws.send(JSON.stringify({ type: "message", data: { x: i, y: sendCount } }));
    }, 1000 / MESSAGES_PER_SEC);
    await new Promise((r) => setTimeout(r, DURATION_SEC * 1000));
    clearInterval(sending);
    await new Promise((r) => setTimeout(r, 200));

    const tickCount = Math.max(...players.map((each) => each.got.lastTickNumber)) - startTickNumber;
    const receivedCounts = players.map((each, i) => each.got.worldCount - startCounts[i]!);
    // The room's round trip as it measured it in the last 4 seconds, and in the first 4, averaged over every player.
    const averagePing = (fromMs: number, toMs: number) => {
      const pings = players.flatMap((each) => each.got.pings.filter((ping) => ping.atMs >= fromMs && ping.atMs < toMs).map((ping) => ping.pingDurationMs));
      return pings.length ? Math.round(pings.reduce((sum, pingDurationMs) => sum + pingDurationMs, 0) / pings.length) : null;
    };
    const endedAtMs = startedAtMs + DURATION_SEC * 1000;
    const summary = {
      playerCount: PLAYER_COUNT,
      sentPerPlayer: sendCount,
      tickCount,
      expectedTickCount: TICKS_PER_SEC * DURATION_SEC,
      fewestReceived: Math.min(...receivedCounts),
      closedCount: players.filter((each) => each.got.isClosed).length,
      errors: [...new Set(players.flatMap((each) => each.got.errors))],
      firstPingDurationMs: averagePing(startedAtMs, startedAtMs + 4000),
      lastPingDurationMs: averagePing(endedAtMs - 4000, endedAtMs + 1000),
    };
    console.log("Room load:", JSON.stringify(summary));
    expect(summary.closedCount).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(summary.lastPingDurationMs).not.toBeNull();
    expect(summary.lastPingDurationMs!).toBeLessThan(MAXIMUM_LAST_PING_DURATION_MS);
    expect(tickCount).toBeGreaterThanOrEqual(TICKS_PER_SEC * DURATION_SEC * MINIMUM_TICK_SHARE);
    expect(summary.fewestReceived).toBeGreaterThanOrEqual(tickCount * 0.9);
    for (const each of players) {
      each.got.isLeaving = true;
      if (!each.got.isClosed) each.ws.close(1000);
    }
  }, 120_000);
});
