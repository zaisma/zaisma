import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { LOG_LIMITS, issueRoomKey, logPrefix, type StoredLogLine } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";
import type { GameServerObject } from "../../apps/rooms/src/game-server.ts";

// What a game server prints goes to its game's logs (apps/rooms/src/logs.ts), from rooms and from the
// game's object outside rooms.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addGame(slug: string, server: string) {
  const gameId = `g${slug.replace(/-/g, "")}`;
  const versionId = `v${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)")
    .bind(gameId, slug, slug, versionId)
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameId, `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
  return { gameId, versionId };
}

let address = 0;
async function newPass(slug: string) {
  const roomKey = await issueRoomKey(e.DB, `g${slug.replace(/-/g, "")}`);
  const response = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: slug, roomKey }) });
  return response.json<{ pass: string; player: { id: string; name: string } }>();
}

async function join(slug: string, code: string) {
  const { pass } = await newPass(slug);
  const up = await SELF.fetch(`${R}/v1/rooms/${slug}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data as string);
    const waiter = waiters.shift();
    waiter ? waiter(m) : inbox.push(m);
  });
  const next = async () => {
    for (;;) {
      const m = inbox.length ? inbox.shift() : await new Promise<any>((r) => waiters.push(r));
      if (["message", "ended", "error", "welcome"].includes(m.type)) return m;
    }
  };
  ws.send(JSON.stringify({ type: "hello", pass }));
  expect((await next()).type).toBe("welcome");
  return { ws, next, say: (data: unknown) => ws.send(JSON.stringify({ type: "message", data })) };
}

/** Every line in the game's logs, oldest first, with who wrote each file. */
async function linesOf(gameId: string): Promise<(StoredLogLine & { writerName: string })[]> {
  const listed = await e.GAMES.list({ prefix: logPrefix(gameId), include: ["customMetadata"] });
  const lines: (StoredLogLine & { writerName: string })[] = [];
  for (const object of listed.objects) {
    const text = await (await e.GAMES.get(object.key))!.text();
    const writerName = object.key.split("/").at(-1)!.split("-")[1]!;
    for (const line of text.split("\n")) lines.push({ ...(JSON.parse(line) as StoredLogLine), writerName });
  }
  return lines.sort((first, second) => first.atMs - second.atMs);
}

const CHATTY = `
console.log("loading the boss fight");
export default {
  setup: () => ({ round: 0 }),
  onJoin(state, player, room) { console.info("player joined:", room.players.length, "in room"); room.send(player.id, "hi"); },
  async onMessage(state, player, message, room) {
    if (message === "round") {
      state.round++;
      await room.database.query("SELECT 1");
      console.log("round", state.round, "starts", { bossHp: 900 });
      room.send(player.id, "ok");
    }
    if (message === "warn") { console.warn("slow tick", 48, "ms"); room.send(player.id, "ok"); }
    if (message === "crash") throw new TypeError("hp of undefined");
    if (message === "flood") { for (let i = 0; i < 1500; i++) console.debug("line", i); room.send(player.id, "ok"); }
    if (message === "long") { console.log("x".repeat(10000)); room.send(player.id, "ok"); }
    return state;
  },
};
`;

describe("a game server's logs from rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games; DELETE FROM game_log_days;");
  });

  it("keeps what the game server prints, with its level, room and version, and the crash in full", async () => {
    const { gameId, versionId } = await addGame("boss-fight", CHATTY);
    const anna = await join("boss-fight", "BSSS22");
    expect((await anna.next()).data).toBe("hi");
    anna.say("round");
    expect((await anna.next()).data).toBe("ok");
    anna.say("warn");
    expect((await anna.next()).data).toBe("ok");
    anna.say("crash");
    anna.say("round");
    expect((await anna.next()).data).toBe("ok");
    // Nothing is written until the room's alarm, so a chatty room writes once every 30 seconds.
    expect((await e.GAMES.list({ prefix: logPrefix(gameId) })).objects).toHaveLength(0);
    const stub = e.ROOMS.get(e.ROOMS.idFromName("boss-fight:BSSS22"));
    await runInDurableObject(stub, (room: Room) => expect((room as any).logs.writeDelayMs()).toBe(LOG_LIMITS.writeDelayMs));
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const lines = await linesOf(gameId);
    expect(lines.map((line) => [line.level, line.text])).toEqual([
      ["log", "loading the boss fight"],
      ["info", "player joined: 1 in room"],
      ["log", 'round 1 starts {"bossHp":900}'],
      ["warn", "slow tick 48 ms"],
      ["error", expect.stringMatching(/^TypeError: hp of undefined\n.*zaisma-server\.js:\d+:\d+/s)],
      ["log", 'round 2 starts {"bossHp":900}'],
    ]);
    expect(lines.every((line) => line.sourceKind === "room" && line.roomCode === "BSSS22" && line.versionId === versionId && line.writerName === "BSSS22")).toBe(true);
    expect(await e.DB.prepare("SELECT day FROM game_log_days WHERE game_id = ?").bind(gameId).all()).toMatchObject({ results: [{ day: new Date().toISOString().slice(0, 10) }] });
    anna.ws.close(1000);
  });

  it("keeps two rooms' lines apart though they share one sandbox, and writes when a room empties", async () => {
    const { gameId } = await addGame("two-rooms", CHATTY);
    const anna = await join("two-rooms", "RMAAAA");
    const ben = await join("two-rooms", "RMBBBB");
    await anna.next();
    await ben.next();
    anna.say("round");
    ben.say("round");
    ben.say("round");
    anna.say("warn");
    await anna.next();
    await ben.next();
    await ben.next();
    await anna.next();
    anna.ws.close(1000);
    ben.ws.close(1000);
    let lines: Awaited<ReturnType<typeof linesOf>> = [];
    for (let i = 0; i < 50 && lines.length < 6; i++) {
      lines = await linesOf(gameId);
      if (lines.length < 6) await new Promise((r) => setTimeout(r, 20));
    }
    const ofRoom = (code: string) => lines.filter((line) => line.roomCode === code && line.level !== "log" || (line.roomCode === code && line.text.startsWith("round"))).map((line) => line.text);
    expect(ofRoom("RMAAAA")).toEqual(["player joined: 1 in room", 'round 1 starts {"bossHp":900}', "slow tick 48 ms"]);
    expect(ofRoom("RMBBBB")).toEqual(["player joined: 1 in room", 'round 1 starts {"bossHp":900}', 'round 2 starts {"bossHp":900}']);
    expect(lines.every((line) => line.writerName === line.roomCode)).toBe(true);
  });

  it("keeps 1,000 lines a call and says how many it dropped, and cuts a long line", async () => {
    const { gameId } = await addGame("flood", CHATTY);
    const anna = await join("flood", "FLDD22");
    await anna.next();
    anna.say("flood");
    await anna.next();
    anna.say("long");
    await anna.next();
    const stub = e.ROOMS.get(e.ROOMS.idFromName("flood:FLDD22"));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const lines = (await linesOf(gameId)).filter((line) => line.text.startsWith("line ") || line.text.startsWith("Zaisma") || line.text.startsWith("xxx"));
    expect(lines.filter((line) => line.level === "debug")).toHaveLength(LOG_LIMITS.callLineCount);
    expect(lines.find((line) => line.text.startsWith("Zaisma"))).toMatchObject({ level: "warn", text: expect.stringContaining("500 more lines") });
    const long = lines.find((line) => line.text.startsWith("xxx"))!;
    expect(long.text).toHaveLength(LOG_LIMITS.lineCharacterCount);
    expect(long.text.endsWith("…")).toBe(true);
    // More than a file's lines went in more than one file.
    expect((await e.GAMES.list({ prefix: logPrefix(gameId) })).objects.length).toBeGreaterThan(2);
    anna.ws.close(1000);
  });

  it("writes every 2 seconds while someone has read the game's logs in the last 10 minutes", async () => {
    const { gameId } = await addGame("watched", CHATTY);
    await e.DB.prepare("UPDATE games SET logs_read_at_ms = ? WHERE id = ?").bind(Date.now(), gameId).run();
    const anna = await join("watched", "WATCH2");
    await anna.next();
    anna.say("round");
    await anna.next();
    const stub = e.ROOMS.get(e.ROOMS.idFromName("watched:WATCH2"));
    await runInDurableObject(stub, (room: Room) => {
      expect((room as any).logs.writeDelayMs()).toBe(LOG_LIMITS.watchedWriteDelayMs);
      expect((room as any).alarmAtMs - Date.now()).toBeLessThanOrEqual(LOG_LIMITS.watchedWriteDelayMs);
    });
    anna.ws.close(1000);
  });
});

const OUTSIDE = `
export default {
  async onRequest(player, request, server) {
    console.log("request", request.type);
    if (request.type === "crash") throw new Error("the shop is closed");
    return { isDone: true };
  },
  async onWebhook(event, server) {
    console.warn("webhook", event.type);
  },
};`;

describe("a game server's logs outside rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM versions; DELETE FROM games; DELETE FROM game_log_days;");
  });

  it("keeps what onRequest and onWebhook print, written by the game's object at its alarm", async () => {
    const { gameId, versionId } = await addGame("shop", OUTSIDE);
    const { pass } = await newPass("shop");
    for (const type of ["buy", "crash"]) {
      const response = await SELF.fetch(`${R}/v1/requests/shop`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ pass, request: { type } }) });
      expect(response.status).toBe(type === "buy" ? 200 : 500);
    }
    const stub = e.GAME_SERVER_OBJECTS.get(e.GAME_SERVER_OBJECTS.idFromName(gameId));
    await runInDurableObject(stub, (object: GameServerObject) => object.webhook(gameId, { type: "purchase_completed" }));
    await runInDurableObject(stub, (object: GameServerObject) => {
      expect((object as any).logsWriteAtMs).not.toBeNull();
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const lines = await linesOf(gameId);
    expect(lines.map((line) => [line.sourceKind, line.level, line.text.split("\n")[0]])).toEqual([
      ["request", "log", "request buy"],
      ["request", "log", "request crash"],
      ["request", "error", "Error: the shop is closed"],
      ["webhook", "warn", "webhook purchase_completed"],
    ]);
    expect(lines.every((line) => line.roomCode === null && line.versionId === versionId && line.writerName === "server")).toBe(true);
  });
});
