import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";

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

/** Answer a probe at once, as the SDK does; a connection the test already closed has nothing to answer. */
function answerProbe(ws: WebSocket, probeNumber: number) {
  try {
    ws.send(JSON.stringify({ type: "probe_answer", probeNumber }));
  } catch {
    // Closed.
  }
}

async function join(game: string, code: string, joinData?: unknown, samePass?: string) {
  const { pass, player } = samePass ? { pass: samePass, player: null as never } : await newPass(game);
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data as string);
    // Probes are answered at once, as the SDK does.
    if (m.type === "probe") return answerProbe(ws, m.probeNumber);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  /** The next message from the game (skipping the room's own player lists). */
  const fromGame = async () => {
    for (;;) {
      const m = await next();
      if (["message", "ended", "ending", "error", "kicked", "move"].includes(m.type)) return m;
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

  it("runs a real-time game server's input with its next tick, in order; one that throws doesn't stop the rest", async () => {
    await addSandboxGame(
      "fast-ticker",
      `export default {
  maximumPlayerCount: 100,
  ticksPerSec: 60,
  setup: () => ({ said: [], toldCount: 0 }),
  onMessage(state, player, message, room) {
    if (message === "bad") throw new Error("bad input");
    state.said.push(message);
  },
  onBytes(state, player, bytes, room) {
    state.said.push("bytes " + bytes.join(","));
  },
  onTick(state, tickDurationSec, room) {
    let work = 0;
    for (let i = 0; i < 200000; i++) work += i;
    if (state.said.length === state.toldCount) return;
    state.toldCount = state.said.length;
    room.broadcast({ said: state.said });
  },
};`,
    );
    const a = await join("fast-ticker", "TKRTKR");
    for (const said of ["one", "bad", "two"]) a.say(said);
    a.ws.send(new Uint8Array([4, 5]));
    let told: any;
    do told = await a.next();
    while (told.data.said.length < 3);
    expect(told.data.said).toEqual(["one", "two", "bytes 4,5"]);
    a.ws.close(1000);
    let use: any = null;
    for (let i = 0; i < 40 && !use; i++) {
      use = await e.DB.prepare("SELECT game_server_cpu_duration_ms, game_server_crash_count, message_count FROM room_usage WHERE game_id = 'gfastticker'").first();
      if (!use) await new Promise((r) => setTimeout(r, 25));
    }
    expect(use).toMatchObject({ game_server_crash_count: 1, message_count: 4 });
    expect(use.game_server_cpu_duration_ms).toBeGreaterThan(0);
    const error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = 'gfastticker'").first<{ message: string }>();
    expect(error!.message).toContain("bad input");
  });

  it("lets the game's own server turn friends' Join off for its room, and read it back", async () => {
    await addSandboxGame(
      "hushed",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    if (message === "private") room.setFriendJoinsEnabled(false);
    room.send(player.id, { friendJoinsEnabled: room.friendJoinsEnabled });
  },
};`,
    );
    const a = await join("hushed", "HSHD23");
    a.say("check");
    expect(await a.next()).toEqual({ type: "message", data: { friendJoinsEnabled: true } });
    a.say("private");
    expect(await a.next()).toEqual({ type: "message", data: { friendJoinsEnabled: false } });
    let row: { friend_joins_enabled: number } | null = null;
    for (let i = 0; i < 40 && row?.friend_joins_enabled !== 0; i++) {
      row = await e.DB.prepare("SELECT friend_joins_enabled FROM live_rooms WHERE room_code = 'HSHD23'").first();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toEqual({ friend_joins_enabled: 0 });
  });

  it("asks the room whether two players have a block between them, as a player's game says it made one", async () => {
    await addSandboxGame(
      "walled",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    const other = room.players.find((each) => each.id !== player.id);
    if (message === "check" && other) room.send(player.id, { hasBlockBetween: room.hasBlockBetween(player.id, other.id), areFriends: room.areFriends(player.id, other.id) });
  },
};`,
    );
    const a = await join("walled", "WALLED");
    const b = await join("walled", "WALLED");
    a.say("check");
    expect(await a.next()).toEqual({ type: "message", data: { hasBlockBetween: false, areFriends: false } });
    a.ws.send(JSON.stringify({ type: "block", playerId: b.player.id }));
    b.say("check");
    expect(await b.next()).toEqual({ type: "message", data: { hasBlockBetween: true, areFriends: false } });
  });

  it("reads each player's ping and the room's clock", async () => {
    await addSandboxGame(
      "pinged",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    room.send(player.id, { pingDurationMs: room.pingDurationMs(player.id), nobodyPingDurationMs: room.pingDurationMs("nobody"), serverTimeMs: room.serverTimeMs() });
  },
};`,
    );
    const a = await join("pinged", "PNGDRM");
    // The client answers its first probe as it arrives, just after welcome.
    let answer: any = null;
    for (let i = 0; i < 20 && typeof answer?.data.pingDurationMs !== "number"; i++) {
      if (i) await new Promise((r) => setTimeout(r, 20));
      a.say("ping?");
      answer = await a.next();
    }
    expect(typeof answer.data.pingDurationMs).toBe("number");
    expect(answer.data.nobodyPingDurationMs).toBeNull();
    expect(Math.abs(answer.data.serverTimeMs - Date.now())).toBeLessThan(1000);
  });

  it("hears a player whose connection dropped as away, lost, and back, with room.awayReason", async () => {
    await addSandboxGame(
      "dropper",
      `export default {
  reconnectTimeoutSec: 20,
  setup: () => ({}),
  onAway(state, player, room, reason) { room.broadcast({ away: player.id, reason, awayReason: room.awayReason(player.id) }); },
  onBack(state, player, room) { room.broadcast({ back: player.id, awayReason: room.awayReason(player.id) }); },
  onLeave(state, player, room) { room.broadcast({ left: player.id }); },
};`,
    );
    const a = await join("dropper", "DRPSBX");
    const b = await join("dropper", "DRPSBX");
    b.ws.close(3000);
    expect(await a.next()).toEqual({ type: "message", data: { away: b.player.id, reason: "lost", awayReason: "lost" } });
    const again = await join("dropper", "DRPSBX", undefined, b.pass);
    expect(await a.next()).toEqual({ type: "message", data: { back: b.player.id, awayReason: null } });
    a.ws.close(1000);
    again.ws.close(1000);
  });

  it("ticks", async () => {
    await addSandboxGame(
      "ticker",
      `export default { ticksPerSec: 20, setup: () => ({ tickCount: 0 }), onTick(state, tickDurationSec, room) { state.tickCount++; if (state.tickCount === 3) room.broadcast({ tickCount: state.tickCount, isTimed: tickDurationSec > 0 }); return state; } };`,
    );
    const a = await join("ticker", "ABCDEF");
    expect((await a.next()).data).toEqual({ tickCount: 3, isTimed: true });
  });

  it("keeps the game server off hosts its game doesn't list, away from our data, and within its limits", async () => {
    await addSandboxGame("hostile", COUNTER);
    const a = await join("hostile", "ABCDEF");
    await a.next(); // hi

    // The game lists no hosts, so the fetch is refused and nothing is broadcast (test/rooms/reach.test.ts has the rest).
    a.say("fetch");
    // Nothing of ours inside the sandbox: no bindings or data, only the flag that says it runs in Zaisma rooms (checkChat reads it).
    a.say("who");
    expect((await a.next()).data).toEqual({ globals: "undefined", keys: ["isZaismaRoomsSandbox"] });

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

  it("writes a new error within a minute of the game server hitting it, without waiting for the hourly check-in", async () => {
    await addSandboxGame("soon", COUNTER);
    const a = await join("soon", "ABCDEF");
    await a.next(); // hi
    a.say("crash");
    a.say("add");
    expect((await a.next()).data).toEqual({ count: 1 });
    const stub = e.ROOMS.get(e.ROOMS.idFromName("soon:ABCDEF"));
    // The room checked in just now, so the next hourly check-in is an hour away.
    await runInDurableObject(stub, (room: Room) => {
      (room as any).checkedInAtMs = Date.now();
      expect((room as any).hasUnrecordedError).toBe(true);
    });
    expect(await e.DB.prepare("SELECT kind FROM game_server_errors WHERE game_id = 'gsoon'").first()).toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await e.DB.prepare("SELECT kind, message, occurrence_count FROM game_server_errors WHERE game_id = 'gsoon'").first()).toMatchObject({ kind: "crash", occurrence_count: 1, message: expect.stringMatching(/^oops /) });
    a.ws.close(1000);
  });

  it("runs the game server's onEnding once the game has used the month's free tier, with room.endsAt", async () => {
    await addSandboxGame(
      "closing",
      `export default {
  setup: () => ({ endingCount: 0 }),
  onJoin(state, player, room) { room.send(player.id, { endsAt: room.endsAt }); },
  onEnding(state, room) { state.endingCount++; room.broadcast({ endsAt: room.endsAt, endingCount: state.endingCount }); return state; },
};`,
    );
    const a = await join("closing", "ABCDEF");
    expect(await a.next()).toEqual({ type: "message", data: { endsAt: null } });
    await e.DB.prepare("INSERT INTO room_usage (game_id, date, room_play_duration_sec) VALUES ('gclosing', ?, ?)").bind(new Date().toISOString().slice(0, 10), 1000 * 3600).run();
    // Make the room's 5-minute check on the free tier due now.
    const stub = e.ROOMS.get(e.ROOMS.idFromName("closing:ABCDEF"));
    await runInDurableObject(stub, (room: Room) => {
      (room as any).freeTierCheckedAtMs = 0;
    });
    await runDurableObjectAlarm(stub);
    const ending = await a.next();
    expect(ending.type).toBe("ending");
    expect(Date.parse(ending.endsAt) - Date.now()).toBeGreaterThan(3500_000);
    expect(await a.next()).toEqual({ type: "message", data: { endsAt: ending.endsAt, endingCount: 1 } });
    a.ws.close(1000);
  });

  it("won't start a game server with an option it doesn't take, and tells its developer which ones it does", async () => {
    await addSandboxGame("old-names", `export default { tickRate: 20, setup: () => ({}) };`);
    const up = await SELF.fetch(`${R}/v1/rooms/old-names/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    expect(up.status).toBe(404);
    const err = await e.DB.prepare("SELECT kind, message, occurrence_count, version_id FROM game_server_errors WHERE game_id = 'goldnames'").first<{ message: string }>();
    expect(err).toMatchObject({ kind: "crash", occurrence_count: 1, version_id: "voldnames" });
    // Errors are kept to 400 characters, which keeps the whole list of options.
    expect(err!.message).toMatch(
      /^Didn't start: tickRate isn't a game server option\. A game server takes: maximumPlayerCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, reconnectTimeoutSec, setup, onJoin, canJoin, onMoved, onLeave, onAway, onBack, onMessage, onBytes, onTick, onEnding, onRequest, schedules, onSchedule, onWebhook\./,
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

/** A stand-in for a session with a real-time game server: it keeps its state, as the sandbox does, and counts what it's asked. */
function tickingSession(asked: { method: string; queued?: any[]; roomChanges?: any }[], failing: { isFailing: boolean }) {
  let state: any;
  return {
    settings: async () => ({ optionNames: ["ticksPerSec", "setup", "onMessage", "onTick"], ticksPerSec: 10, handlerNames: ["setup", "onMessage", "onTick"] }),
    setup: async () => ((state = { tickCount: 0, said: [] as string[] }), { state, effects: [] }),
    call: async (hook: string, _handlerArguments: unknown[], roomChanges: unknown, _given: unknown, queued: any[]) => {
      asked.push({ method: `call ${hook}`, queued, roomChanges });
      return { effects: [] };
    },
    tick: async (queued: any[], _tickDurationSec: number, roomChanges: unknown) => {
      asked.push({ method: "tick", queued, roomChanges });
      if (failing.isFailing) throw new Error("Worker exceeded CPU time limit.");
      for (const input of queued) state.said.push(input.payload);
      state.tickCount++;
      return { effects: [] };
    },
    stateCopy: async () => structuredClone(state),
    restore: async (copy: unknown) => {
      asked.push({ method: "restore" });
      state = copy;
    },
  };
}

const ROOM = { players: [], isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {}, endsAt: null, pingDurationMs: () => null, awayReason: () => null, hasBlockBetween: () => false, areFriends: () => false, serverTimeMs: () => Date.now() } as never;
const PLAYER = { id: "player_a", name: "A", kind: "guest" as const };

describe("a game server whose sandbox keeps failing", () => {
  it("gets a fresh session after a failure that carries on from the last copy, and gives up after the second", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    const asked: { method: string }[] = [];
    const failing = { isFailing: false };
    let opened = 0;
    let broken = 0;
    const server = await wrapSession(async () => (opened++, tickingSession(asked, failing) as never), () => broken++);
    await server.setup!(null);
    await server.onTick!(undefined, 0.1, ROOM);
    await server.onTick!(undefined, 0.1, ROOM);
    expect(await server.stateCopy()).toMatchObject({ tickCount: 2 });
    await server.onTick!(undefined, 0.1, ROOM);
    failing.isFailing = true;
    await expect(server.onTick!(undefined, 0.1, ROOM)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 0]);
    // The fresh session starts from the copy, two ticks in: the third tick since is lost, not the match.
    failing.isFailing = false;
    asked.length = 0;
    await server.onTick!(undefined, 0.1, ROOM);
    expect(asked.map((each) => each.method)).toEqual(["restore", "tick"]);
    expect(await server.stateCopy()).toMatchObject({ tickCount: 3 });
    failing.isFailing = true;
    await expect(server.onTick!(undefined, 0.1, ROOM)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 1]);
    // From then on it fails at once, without asking the sandbox again.
    failing.isFailing = false;
    await expect(server.onTick!(undefined, 0.1, ROOM)).rejects.toThrow("stopped working");
    expect(server.stats.failureCount).toBe(2);
  });
});

describe("a real-time game server in the sandbox", () => {
  it("gets the messages since the last tick with the tick, in one call and in order", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    const asked: { method: string; queued?: any[] }[] = [];
    const server = await wrapSession(async () => tickingSession(asked, { isFailing: false }) as never, () => {});
    await server.setup!(null);
    for (const said of ["one", "two", "three"]) expect(server.onMessage!(undefined, PLAYER, said, ROOM)).toBeUndefined();
    expect(asked).toEqual([]);
    await server.onTick!(undefined, 1 / 60, ROOM);
    expect(asked.map((each) => [each.method, each.queued!.map((input) => input.payload)])).toEqual([["tick", ["one", "two", "three"]]]);
    expect(await server.stateCopy()).toMatchObject({ said: ["one", "two", "three"], tickCount: 1 });
    // Messages that came before a join go first, with the join's call.
    server.onMessage!(undefined, PLAYER, "four", ROOM);
    await server.onJoin!(undefined, PLAYER, ROOM, null, { fromRoomCode: null, isReturning: false });
    expect(asked.at(-1)).toMatchObject({ method: "call onJoin", queued: [{ hook: "onMessage", payload: "four" }] });
    expect(server.stats.callCount).toBe(3);
  });

  it("sends only what changed in the room since the last call", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    const { RoomCore } = await import("@zaisma/game-server");
    const asked: { method: string; roomChanges?: any }[] = [];
    const server = await wrapSession(async () => tickingSession(asked, { isFailing: false }) as never, () => {});
    const core = new RoomCore(server, { send: () => {}, close: () => {} });
    await core.settled();
    core.join({ id: "player_a", name: "A", kind: "account" });
    core.join({ id: "player_b", name: "B", kind: "account" });
    await core.settled();
    core.tick(0.1);
    await core.settled();
    // The second join's call had the players; the tick after it, nothing new but the clock.
    expect(Object.keys(asked.at(-1)!.roomChanges)).toEqual(["serverTimeMs"]);
    core.setFriends("player_a", ["player_b"]);
    core.tick(0.1);
    await core.settled();
    expect(asked.at(-1)!.roomChanges).toMatchObject({ friendPairs: [["player_a", "player_b"]], blockPairs: [] });
    core.tick(0.1);
    await core.settled();
    expect(asked.at(-1)!.roomChanges.friendPairs).toBeUndefined();
  });
});

describe("a game server's new errors", () => {
  it("are new once a session, even after the room recorded them", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    let message = "boom";
    const session = {
      settings: async () => ({ optionNames: ["setup", "onTick"], handlerNames: ["setup", "onTick"] }),
      setup: async () => ({ state: {}, effects: [] }),
      call: async (_hook: string, state: unknown) => ({ state, effects: [], error: `Error: ${message}` }),
    };
    let newErrorCount = 0;
    const server = await wrapSession(async () => session as never, () => {}, {}, () => newErrorCount++);
    const room = { players: [], isListed: true, isOpen: true, name: null, labels: {}, endsAt: null , serverTimeMs: () => Date.now() } as never;
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("boom");
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("boom");
    expect(newErrorCount).toBe(1);
    // The room recorded them (recordUsage empties the list): the same error again isn't new.
    server.stats.errors.clear();
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("boom");
    expect(newErrorCount).toBe(1);
    message = "another";
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("another");
    expect(newErrorCount).toBe(2);
  });
});
