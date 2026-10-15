import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";

// Developers' own game servers, run in a sandbox (apps/rooms/src/sandbox.ts).

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

/** A live game set to run its own game server, with that server as its zaisma-server.js. */
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
async function newPass(game: string) {
  // The key the game page gets when Cloudflare's check on Play passes.
  const key = await issueRoomKey(e.DB, `g${game.replace(/-/g, "")}`);
  const res = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey: key }) });
  return res.json<{ pass: string; player: { id: string; name: string } }>();
}

/** Try to join, and say what the room answered first. */
async function knock(game: string, code: string, joinData?: unknown, pass?: string) {
  pass ??= (await newPass(game)).pass;
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const ws = up.webSocket!;
  ws.accept();
  const first = new Promise<any>((r) => ws.addEventListener("message", (ev) => r(JSON.parse(ev.data as string)), { once: true }));
  ws.send(JSON.stringify({ type: "hello", pass, joinData }));
  return first;
}

/** Join with a pass and joinData, and say the first thing the game itself sends (or the room's error). */
async function arrive(game: string, code: string, joinData: unknown, pass: string) {
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const ws = up.webSocket!;
  ws.accept();
  const got = new Promise<any>((r) =>
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.type === "message" || m.type === "error") r(m);
    }),
  );
  ws.send(JSON.stringify({ type: "hello", pass, joinData }));
  return got;
}

async function join(game: string, code: string, joinData?: unknown) {
  const { pass, player } = await newPass(game);
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data as string);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  /** The next message from the game (skipping the room's own player lists). */
  const game_ = async () => {
    for (;;) {
      const m = await next();
      if (m.type === "message" || m.type === "ended" || m.type === "error" || m.type === "kicked" || m.type === "move") return m;
    }
  };
  ws.send(JSON.stringify({ type: "hello", pass, ...(joinData !== undefined ? { joinData } : {}) }));
  expect((await next()).type).toBe("welcome");
  return { ws, player, pass, next: game_ };
}

const COUNTER = `
export default {
  maximumPlayerCount: 4,
  setup: (startData) => ({ count: 0 }),
  onJoin(state, player, room) { room.send(player.id, { hi: player.name, players: room.players.length }); },
  onMessage(state, player, messageData, room) {
    if (messageData === "add") { state.count++; room.broadcast({ count: state.count }); }
    if (messageData === "fetch") fetch("https://example.com").then(() => room.broadcast("reached the internet"), () => {});
    if (messageData === "spin") for (;;) {}
    if (messageData === "crash") throw new Error("oops");
    if (messageData === "who") room.send(player.id, { globals: typeof env, keys: Object.keys(globalThis).filter((k) => /zaisma|DB|GAMES/i.test(k)) });
    if (messageData === "end") room.end("Game over");
    return state;
  },
};
`;

describe("sandboxed game servers", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("runs the game's own server: state, messages and the room API", async () => {
    await addSandboxGame("counter", COUNTER);
    const a = await join("counter", "ABCDEF");
    expect(await a.next()).toEqual({ type: "message", data: { hi: a.player.name, players: 1 } });
    const b = await join("counter", "ABCDEF");
    expect(await b.next()).toEqual({ type: "message", data: { hi: b.player.name, players: 2 } });

    a.ws.send(JSON.stringify({ type: "message", data: "add" }));
    a.ws.send(JSON.stringify({ type: "message", data: "add" }));
    expect((await b.next()).data).toEqual({ count: 1 });
    expect((await b.next()).data).toEqual({ count: 2 });

    a.ws.send(JSON.stringify({ type: "message", data: "end" }));
    expect(await b.next()).toMatchObject({ type: "ended", message: "Game over" });
  });

  it("ticks", async () => {
    await addSandboxGame("ticker", `export default { ticksPerSec: 20, setup: () => ({ n: 0 }), onTick(state, tickDurationSec, room) { state.n++; if (state.n === 3) room.broadcast({ n: state.n, dt: tickDurationSec > 0 }); return state; } };`);
    const a = await join("ticker", "ABCDEF");
    expect((await a.next()).data).toEqual({ n: 3, dt: true });
  });

  it("keeps the game server off the internet, away from our data, and within its limits", async () => {
    await addSandboxGame("hostile", COUNTER);
    const a = await join("hostile", "ABCDEF");
    await a.next(); // hi

    // No internet: the fetch fails, so nothing is broadcast.
    a.ws.send(JSON.stringify({ type: "message", data: "fetch" }));
    // Nothing of ours inside the sandbox.
    a.ws.send(JSON.stringify({ type: "message", data: "who" }));
    expect((await a.next()).data).toEqual({ globals: "undefined", keys: [] });

    // A crash loses that one message; the room and its state carry on. (So does a loop that never
    // ends, cut off by the CPU limit, but only Cloudflare enforces that: locally it would hang the test.)
    a.ws.send(JSON.stringify({ type: "message", data: "crash" }));
    a.ws.send(JSON.stringify({ type: "message", data: "add" }));
    expect((await a.next()).data).toEqual({ count: 1 });
  });

  it("records the game server's work and errors for its developer, saying where in the file", async () => {
    await addSandboxGame("oops", COUNTER);
    const a = await join("oops", "ABCDEF");
    await a.next(); // hi
    a.ws.send(JSON.stringify({ type: "message", data: "crash" }));
    a.ws.send(JSON.stringify({ type: "message", data: "crash" }));
    a.ws.send(JSON.stringify({ type: "message", data: "add" }));
    expect((await a.next()).data).toEqual({ count: 1 });
    a.ws.close(1000);
    let row: any = null;
    for (let i = 0; i < 50 && !row; i++) {
      row = await e.DB.prepare("SELECT * FROM room_usage WHERE game_id = 'goops'").first();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ rooms: 1, server_crashes: 2, server_stops: 0, server_broken_rooms: 0 });
    expect(row.server_calls).toBeGreaterThanOrEqual(5);
    const err = await e.DB.prepare("SELECT kind, message, count, version_id FROM game_server_errors WHERE game_id = 'goops'").first();
    expect(err).toMatchObject({ kind: "crash", count: 2, version_id: "voops" });
    expect(err!.message).toMatch(/^oops \(zaisma-server\.js:\d+:\d+\)$/);
  });

  it("runs a game server split into files in a zaisma-server/ folder", async () => {
    await addSandboxGame("split", COUNTER);
    await e.GAMES.delete("games/vsplit/zaisma-server.js");
    await e.GAMES.put("games/vsplit/zaisma-server/index.js", `import { greet } from "./lib/words.js";\nexport default { setup: () => ({}), onJoin(state, player, room) { room.send(player.id, greet(player.name)); } };`);
    await e.GAMES.put("games/vsplit/zaisma-server/lib/words.js", `export const greet = (name) => "Hello " + name;`);
    const a = await join("split", "ABCDEF");
    expect((await a.next()).data).toBe(`Hello ${a.player.name}`);
  });

  it("loads data and WebAssembly from the folder", async () => {
    await addSandboxGame("wasm", COUNTER);
    await e.GAMES.delete("games/vwasm/zaisma-server.js");
    // A tiny WebAssembly module whose answer() returns 42.
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11]);
    await e.GAMES.put("games/vwasm/zaisma-server/answer.wasm", wasm);
    await e.GAMES.put("games/vwasm/zaisma-server/levels.json", JSON.stringify({ first: "Docks" }));
    await e.GAMES.put(
      "games/vwasm/zaisma-server/index.js",
      `import mod from "./answer.wasm";\nimport levels from "./levels.json";\nconst wasm = new WebAssembly.Instance(mod);\nexport default { setup: () => ({}), onJoin(state, player, room) { room.send(player.id, { answer: wasm.exports.answer(), level: levels.first }); } };`,
    );
    const a = await join("wasm", "ABCDEF");
    expect((await a.next()).data).toEqual({ answer: 42, level: "Docks" });
  });

  it("lets the game's own server turn players away and kick them, keeping kicked players out", async () => {
    await addSandboxGame(
      "guarded",
      `export default {
        setup: () => ({}),
        canJoin(state, player, room, joinData) { return (joinData && joinData.password === "docks") || { refusalMessage: "Wrong password." }; },
        onMessage(state, player, messageData, room) {
          const other = room.players.find((p) => p.id !== player.id);
          if (messageData === "kick" && other) room.kick(other.id, { message: "Too rough.", keepOut: true });
          if (messageData === "out") room.kick(player.id);
        },
      };`,
    );
    const turnedAway = await knock("guarded", "ABCDEF", { password: "nope" });
    expect(turnedAway).toEqual({ type: "error", code: "refused", message: "Wrong password." });

    const a = await join("guarded", "ABCDEF", { password: "docks" });
    const b = await join("guarded", "ABCDEF", { password: "docks" });
    a.ws.send(JSON.stringify({ type: "message", data: "kick" }));
    expect(await b.next()).toEqual({ type: "kicked", message: "Too rough.", isKeptOut: true });

    // Kept out, even with the password and a fresh connection under the same pass.
    const again = await knock("guarded", "ABCDEF", { password: "docks" }, b.pass);
    expect(again).toEqual({ type: "error", code: "kept_out", message: "Too rough." });

    // Kicking the last player empties the room like everyone leaving: it drops out of the room list.
    expect(await e.DB.prepare("SELECT players FROM live_rooms WHERE game_id = 'gguarded'").first()).toEqual({ players: 1 });
    a.ws.send(JSON.stringify({ type: "message", data: "out" }));
    expect(await a.next()).toEqual({ type: "kicked", message: "You were removed from this room.", isKeptOut: false });
    let row: unknown = {};
    for (let i = 0; i < 50 && row; i++) {
      row = await e.DB.prepare("SELECT players FROM live_rooms WHERE game_id = 'gguarded'").first();
      if (row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toBeNull();
  });

  it("moves players to another room that's already running, which can say no", async () => {
    await addSandboxGame(
      "world",
      `export default {
        setup: () => ({ locked: false }),
        canJoin(state, player, room, joinData, joinInfo) { return !(state.locked && joinInfo.fromRoomCode) || { refusalMessage: "This area is locked." }; },
        onJoin(state, player, room, joinData, joinInfo) { if (joinInfo.fromRoomCode) room.send(player.id, { arrived: joinData, from: joinInfo.fromRoomCode, isReturning: joinInfo.isReturning }); },
        onMessage(state, player, messageData, room) {
          if (messageData === "lock") state.locked = true;
          if (typeof messageData === "string" && messageData.startsWith("go ")) room.moveTo(messageData.slice(3), { playerIds: [player.id], joinData: { door: "north" } });
          return state;
        },
        onMoved(state, moveResult, room) {
          for (const refused of moveResult.refusedPlayers) room.send(refused.player.id, { stayed: refused.error.message, code: refused.error.code, roomCode: moveResult.roomCode });
        },
      };`,
    );
    const forest = await join("world", "FRSTAA");
    const town = await join("world", "TWNAAA");
    town.ws.send(JSON.stringify({ type: "message", data: "go FRSTAA" }));
    expect(await town.next()).toEqual({ type: "move", roomCode: "FRSTAA" });

    // Same pass, the forest room: it gets the town's data, not anything the browser sends.
    expect(await arrive("world", "FRSTAA", { door: "cheat" }, town.pass)).toEqual({ type: "message", data: { arrived: { door: "north" }, from: "TWNAAA", isReturning: false } });

    // A room that's locked, and one that isn't running, both say no; the player stays put.
    forest.ws.send(JSON.stringify({ type: "message", data: "lock" }));
    const other = await join("world", "THRDAA");
    other.ws.send(JSON.stringify({ type: "message", data: "go FRSTAA" }));
    expect(await other.next()).toEqual({ type: "message", data: { stayed: "This area is locked.", code: "refused", roomCode: "FRSTAA" } });
    other.ws.send(JSON.stringify({ type: "message", data: "go ZZZZZZ" }));
    expect(await other.next()).toEqual({ type: "message", data: { stayed: "That room isn't running.", code: "no_room", roomCode: "ZZZZZZ" } });
  });

  it("leaves a game without a game server file unavailable", async () => {
    await addSandboxGame("empty", COUNTER);
    await e.GAMES.delete("games/vempty/zaisma-server.js");
    const up = await SELF.fetch(`${R}/v1/rooms/empty/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    expect(up.status).toBe(404);
  });

  /** The first error a game version's server recorded for its developer, waiting a moment for the room to write it. */
  async function firstError(gameId: string) {
    let row: { kind: string; message: string; count: number; version_id: string } | null = null;
    for (let i = 0; i < 50 && !row; i++) {
      row = await e.DB.prepare("SELECT kind, message, count, version_id FROM game_server_errors WHERE game_id = ?").bind(gameId).first();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    return row;
  }

  it("doesn't open a room for a game server with an option it doesn't take, and tells its developer why", async () => {
    // tickRate is the old name of ticksPerSec: no aliases.
    await addSandboxGame("oldnames", `export default { tickRate: 20, setup: () => ({}) };`);
    const up = await SELF.fetch(`${R}/v1/rooms/oldnames/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    expect(up.status).toBe(404);
    expect(up.webSocket).toBeFalsy();
    const error = await firstError("goldnames");
    expect(error).toMatchObject({ kind: "crash", count: 1, version_id: "voldnames" });
    expect(error!.message).toMatch(/^A game server doesn't take tickRate\. It takes maximumPlayerCount, ticksPerSec, /);
  });

  it("records a call with an option it doesn't take as a crash, saying what the call takes", async () => {
    await addSandboxGame(
      "kicker",
      `export default {
        setup: () => ({}),
        onMessage(state, player, messageData, room) {
          if (messageData === "kick") room.kick(player.id, { reason: "Too rough." });
          if (messageData === "still") room.send(player.id, "still here");
        },
      };`,
    );
    const a = await join("kicker", "ABCDEF");
    a.ws.send(JSON.stringify({ type: "message", data: "kick" }));
    a.ws.send(JSON.stringify({ type: "message", data: "still" }));
    // The kick never happened: the player is still in the room.
    expect(await a.next()).toEqual({ type: "message", data: "still here" });
    a.ws.close(1000);
    const error = await firstError("gkicker");
    expect(error).toMatchObject({ kind: "crash", count: 1 });
    expect(error!.message).toMatch(/^room\.kick doesn't take reason\. It takes message, keepOut\. \(zaisma-server\.js:\d+:\d+\)$/);
  });

  it("turns a player away when canJoin answers with a string, as a mistake", async () => {
    await addSandboxGame("stringy", `export default { setup: () => ({}), canJoin() { return "Wrong password."; } };`);
    expect(await knock("stringy", "ABCDEF")).toEqual({ type: "error", code: "refused", message: "The game didn't let you into this room." });
  });
});

describe("a game server whose sandbox keeps failing", () => {
  it("gets a fresh session after a failure, and gives up after the second", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    let opened = 0;
    let fail = false;
    let broken = 0;
    const session = {
      // As the sandbox describes the game server's options, each handler as "(handler)".
      options: async () => ({ ticksPerSec: 10, setup: "(handler)", onTick: "(handler)" }),
      setup: async () => ({ state: { n: 0 }, effects: [] }),
      call: async (_hook: string, state: any) => {
        if (fail) throw new Error("Worker exceeded CPU time limit.");
        return { state: { n: state.n + 1 }, effects: [] };
      },
    };
    const server = await wrapSession(async () => (opened++, session as never), () => broken++);
    const room = { players: [], isListed: true, isOpen: true, name: null, labels: {} } as never;

    expect(await server.onTick!({ n: 0 }, 0.1, room)).toEqual({ n: 1 });
    fail = true;
    await expect(server.onTick!({ n: 1 }, 0.1, room)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 0]);
    await expect(server.onTick!({ n: 1 }, 0.1, room)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 1]);
    // From then on it fails at once, without asking the sandbox again.
    fail = false;
    await expect(server.onTick!({ n: 1 }, 0.1, room)).rejects.toThrow("stopped working");
    expect(server.stats.failures).toBe(2);
  });
});
