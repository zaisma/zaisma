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
  const roomKey = await issueRoomKey(e.DB, `g${game.replace(/-/g, "")}`);
  const res = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey }) });
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

/** Join with a pass and join data, and say the first thing the game itself sends (or the room's error). */
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
  const fromGame = async () => {
    for (;;) {
      const m = await next();
      if (["message", "ended", "error", "kicked", "move"].includes(m.type)) return m;
    }
  };
  const say = (data: unknown) => ws.send(JSON.stringify({ type: "message", data }));
  ws.send(JSON.stringify({ type: "hello", pass, ...(joinData !== undefined ? { joinData } : {}) }));
  expect((await next()).type).toBe("welcome");
  return { ws, player, pass, say, next: fromGame };
}

const COUNTER = `
export default {
  maximumPlayerCount: 4,
  setup: (setupData) => ({ count: 0 }),
  onJoin(state, player, room) { room.send(player.id, { hi: player.name, players: room.players.length }); },
  onMessage(state, player, message, room) {
    if (message === "add") { state.count++; room.broadcast({ count: state.count }); }
    if (message === "fetch") fetch("https://example.com").then(() => room.broadcast("reached the internet"), () => {});
    if (message === "spin") for (;;) {}
    if (message === "crash") throw new Error("oops");
    if (message === "who") room.send(player.id, { globals: typeof env, keys: Object.keys(globalThis).filter((k) => /zaisma|DB|GAMES/i.test(k)) });
    if (message === "end") room.end("Game over");
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

    a.say("add");
    a.say("add");
    expect((await b.next()).data).toEqual({ count: 1 });
    expect((await b.next()).data).toEqual({ count: 2 });

    a.say("end");
    expect(await b.next()).toMatchObject({ type: "ended", message: "Game over" });
  });

  it("ticks", async () => {
    await addSandboxGame(
      "ticker",
      `export default { ticksPerSec: 20, setup: () => ({ tickCount: 0 }), onTick(state, tickDurationSec, room) { state.tickCount++; if (state.tickCount === 3) room.broadcast({ tickCount: state.tickCount, isTimed: tickDurationSec > 0 }); return state; } };`,
    );
    const a = await join("ticker", "ABCDEF");
    expect((await a.next()).data).toEqual({ tickCount: 3, isTimed: true });
  });

  it("keeps the game server off the internet, away from our data, and within its limits", async () => {
    await addSandboxGame("hostile", COUNTER);
    const a = await join("hostile", "ABCDEF");
    await a.next(); // hi

    // No internet: the fetch fails, so nothing is broadcast.
    a.say("fetch");
    // Nothing of ours inside the sandbox.
    a.say("who");
    expect((await a.next()).data).toEqual({ globals: "undefined", keys: [] });

    // A crash loses that one message; the room and its state carry on. (So does a loop that never
    // ends, cut off by the CPU limit, but only Cloudflare enforces that: locally it would hang the test.)
    a.say("crash");
    a.say("add");
    expect((await a.next()).data).toEqual({ count: 1 });
  });

  it("records the game server's work and errors for its developer, saying where in the file", async () => {
    await addSandboxGame("oops", COUNTER);
    const a = await join("oops", "ABCDEF");
    await a.next(); // hi
    a.say("crash");
    a.say("crash");
    a.say("add");
    expect((await a.next()).data).toEqual({ count: 1 });
    a.ws.close(1000);
    let row: any = null;
    for (let i = 0; i < 50 && !row; i++) {
      row = await e.DB.prepare("SELECT * FROM room_usage WHERE game_id = 'goops'").first();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ room_count: 1, game_server_crash_count: 2, game_server_stopped_count: 0, game_server_ended_match_count: 0 });
    expect(row.game_server_call_count).toBeGreaterThanOrEqual(5);
    const err = await e.DB.prepare("SELECT kind, message, occurrence_count, version_id FROM game_server_errors WHERE game_id = 'goops'").first();
    expect(err).toMatchObject({ kind: "crash", occurrence_count: 2, version_id: "voops" });
    expect(err!.message).toMatch(/^oops \(zaisma-server\.js:\d+:\d+\)$/);
  });

  it("won't start a game server with an option it doesn't take, and tells its developer which ones it does", async () => {
    await addSandboxGame("old-names", `export default { tickRate: 20, setup: () => ({}) };`);
    const up = await SELF.fetch(`${R}/v1/rooms/old-names/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    expect(up.status).toBe(404);
    const err = await e.DB.prepare("SELECT kind, message, occurrence_count, version_id FROM game_server_errors WHERE game_id = 'goldnames'").first<{ message: string }>();
    expect(err).toMatchObject({ kind: "crash", occurrence_count: 1, version_id: "voldnames" });
    expect(err!.message).toBe(
      "Didn't start: tickRate isn't a game server option. A game server takes: maximumPlayerCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, setup, onJoin, canJoin, onMoved, onLeave, onAway, onBack, onMessage, onTick, onRequest, schedules, onSchedule. (unknown_option)",
    );
  });

  it("turns a player away when canJoin answers a string, and tells the developer what to answer instead", async () => {
    // A string used to mean "no, with this reason": a truthy "no" an AI could write meaning yes.
    await addSandboxGame("texty", `export default { setup: () => ({}), canJoin() { return "Welcome!"; } };`);
    expect(await knock("texty", "ABCDEF")).toEqual({ type: "error", code: "refused", message: "The game didn't let you into this room." });
    // Recorded at once, though nobody ever gets in for the room to empty.
    let row: { kind: string; message: string } | null = null;
    for (let i = 0; i < 50 && !row; i++) {
      row = await e.DB.prepare("SELECT kind, message FROM game_server_errors WHERE game_id = 'gtexty'").first<{ kind: string; message: string }>();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ kind: "crash" });
    expect(row!.message).toContain('canJoin answered the text "Welcome!", so the player was turned away. Answer true (or nothing) to let them in');
  });

  it("waits for an async canJoin, and lets in a player when it answers nothing", async () => {
    await addSandboxGame("asyncy", `export default { setup: () => ({}), async canJoin(state, player, room, joinData) { if (!joinData) return { refusalMessage: "Pick a team." }; }, onJoin(state, player, room, joinData) { room.send(player.id, joinData); } };`);
    expect(await knock("asyncy", "ABCDEF")).toEqual({ type: "error", code: "refused", message: "Pick a team." });
    const a = await join("asyncy", "ABCDEF", { team: "red" });
    expect((await a.next()).data).toEqual({ team: "red" });
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
        onMessage(state, player, message, room) {
          const other = room.players.find((p) => p.id !== player.id);
          if (message === "kick" && other) room.kick(other.id, { message: "Too rough.", keepOut: true });
          if (message === "out") room.kick(player.id);
        },
      };`,
    );
    const turnedAway = await knock("guarded", "ABCDEF", { password: "nope" });
    expect(turnedAway).toEqual({ type: "error", code: "refused", message: "Wrong password." });

    const a = await join("guarded", "ABCDEF", { password: "docks" });
    const b = await join("guarded", "ABCDEF", { password: "docks" });
    a.say("kick");
    expect(await b.next()).toEqual({ type: "kicked", message: "Too rough.", isKeptOut: true });

    // Kept out, even with the password and a fresh connection under the same pass.
    const again = await knock("guarded", "ABCDEF", { password: "docks" }, b.pass);
    expect(again).toEqual({ type: "error", code: "kept_out", message: "Too rough." });

    // Kicking the last player empties the room like everyone leaving: it drops out of the room list.
    expect(await e.DB.prepare("SELECT player_count FROM live_rooms WHERE game_id = 'gguarded'").first()).toEqual({ player_count: 1 });
    a.say("out");
    expect(await a.next()).toEqual({ type: "kicked", message: "You were removed from this room.", isKeptOut: false });
    let row: unknown = {};
    for (let i = 0; i < 50 && row; i++) {
      row = await e.DB.prepare("SELECT player_count FROM live_rooms WHERE game_id = 'gguarded'").first();
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
        onJoin(state, player, room, joinData, joinInfo) { if (joinInfo.fromRoomCode) room.send(player.id, { arrived: joinData, fromRoomCode: joinInfo.fromRoomCode }); },
        onMessage(state, player, message, room) {
          if (message === "lock") state.locked = true;
          if (typeof message === "string" && message.startsWith("go ")) room.moveTo(message.slice(3), { playerIds: [player.id], joinData: { door: "north" } });
          return state;
        },
        onMoved(state, moveResult, room) {
          for (const refusal of moveResult.refusals) room.send(refusal.player.id, { stayed: refusal.message, code: refusal.code });
        },
      };`,
    );
    const forest = await join("world", "FRSTAA");
    const town = await join("world", "TWNAAA");
    town.say("go FRSTAA");
    expect(await town.next()).toEqual({ type: "move", roomCode: "FRSTAA" });

    // Same pass, the forest room: it gets the town's join data, not anything the browser sends.
    expect(await arrive("world", "FRSTAA", { door: "cheat" }, town.pass)).toEqual({ type: "message", data: { arrived: { door: "north" }, fromRoomCode: "TWNAAA" } });

    // A room that's locked, and one that isn't running, both say no; the player stays put.
    forest.say("lock");
    const other = await join("world", "THRDAA");
    other.say("go FRSTAA");
    expect(await other.next()).toEqual({ type: "message", data: { stayed: "This area is locked.", code: "refused" } });
    other.say("go ZZZZZZ");
    expect(await other.next()).toEqual({ type: "message", data: { stayed: "That room isn't running.", code: "no_room" } });
  });

  it("leaves a game without a game server file unavailable", async () => {
    await addSandboxGame("empty", COUNTER);
    await e.GAMES.delete("games/vempty/zaisma-server.js");
    const up = await SELF.fetch(`${R}/v1/rooms/empty/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    expect(up.status).toBe(404);
  });
});

describe("a game server whose sandbox keeps failing", () => {
  it("gets a fresh session after a failure, and gives up after the second", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    let opened = 0;
    let fail = false;
    let broken = 0;
    const session = {
      settings: async () => ({ optionNames: ["ticksPerSec", "setup", "onTick"], ticksPerSec: 10, handlerNames: ["setup", "onTick"] }),
      setup: async () => ({ state: { tickCount: 0 }, effects: [] }),
      call: async (_hook: string, state: any) => {
        if (fail) throw new Error("Worker exceeded CPU time limit.");
        return { state: { tickCount: state.tickCount + 1 }, effects: [] };
      },
    };
    const server = await wrapSession(async () => (opened++, session as never), () => broken++);
    const room = { players: [], isListed: true, isOpen: true, name: null, labels: {} } as never;

    expect(await server.onTick!({ tickCount: 0 }, 0.1, room)).toEqual({ tickCount: 1 });
    fail = true;
    await expect(server.onTick!({ tickCount: 1 }, 0.1, room)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 0]);
    await expect(server.onTick!({ tickCount: 1 }, 0.1, room)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 1]);
    // From then on it fails at once, without asking the sandbox again.
    fail = false;
    await expect(server.onTick!({ tickCount: 1 }, 0.1, room)).rejects.toThrow("stopped working");
    expect(server.stats.failureCount).toBe(2);
  });
});
