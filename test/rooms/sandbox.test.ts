import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../apps/rooms/src/index.ts";

// Developers' own game servers, run in a sandbox (apps/rooms/src/sandbox.ts).

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

/** A live game set to run its own game server, with that server as its zaisma-server.js. */
async function addSandboxGame(slug: string, server: string) {
  const id = `g${slug.replace(/-/g, "")}`;
  const version = `v${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, game_server, room_browsing, created_at, updated_at) VALUES (?, ?, ?, 'live', ?, 'sandbox', 'page', 0, 0)")
    .bind(id, slug, slug, version)
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, created_at) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(version, id, `games/${version}`).run();
  await e.GAMES.put(`games/${version}/zaisma-server.js`, server);
}

let address = 0;
async function join(game: string, code: string) {
  const res = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ game }) });
  const { pass, player } = await res.json<{ pass: string; player: { id: string; name: string } }>();
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN } });
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
      if (m.t === "msg" || m.t === "ended" || m.t === "error") return m;
    }
  };
  ws.send(JSON.stringify({ t: "hello", pass }));
  expect((await next()).t).toBe("welcome");
  return { ws, player, next: game_ };
}

const COUNTER = `
export default {
  maxPlayers: 4,
  setup: (data) => ({ count: 0 }),
  onJoin(state, player, room) { room.send(player.id, { hi: player.name, players: room.players.length }); },
  onMessage(state, player, msg, room) {
    if (msg === "add") { state.count++; room.broadcast({ count: state.count }); }
    if (msg === "fetch") fetch("https://example.com").then(() => room.broadcast("reached the internet"), () => {});
    if (msg === "spin") for (;;) {}
    if (msg === "crash") throw new Error("oops");
    if (msg === "who") room.send(player.id, { globals: typeof env, keys: Object.keys(globalThis).filter((k) => /zaisma|DB|GAMES/i.test(k)) });
    if (msg === "end") room.end("Game over");
    return state;
  },
};
`;

describe("sandboxed game servers", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("runs the game's own server: state, messages and the room API", async () => {
    await addSandboxGame("counter", COUNTER);
    const a = await join("counter", "ABCDEF");
    expect(await a.next()).toEqual({ t: "msg", d: { hi: a.player.name, players: 1 } });
    const b = await join("counter", "ABCDEF");
    expect(await b.next()).toEqual({ t: "msg", d: { hi: b.player.name, players: 2 } });

    a.ws.send(JSON.stringify({ t: "msg", d: "add" }));
    a.ws.send(JSON.stringify({ t: "msg", d: "add" }));
    expect((await b.next()).d).toEqual({ count: 1 });
    expect((await b.next()).d).toEqual({ count: 2 });

    a.ws.send(JSON.stringify({ t: "msg", d: "end" }));
    expect(await b.next()).toMatchObject({ t: "ended", reason: "Game over" });
  });

  it("ticks", async () => {
    await addSandboxGame("ticker", `export default { tickRate: 20, setup: () => ({ n: 0 }), onTick(state, dt, room) { state.n++; if (state.n === 3) room.broadcast({ n: state.n, dt: dt > 0 }); return state; } };`);
    const a = await join("ticker", "ABCDEF");
    expect((await a.next()).d).toEqual({ n: 3, dt: true });
  });

  it("keeps the game server off the internet, away from our data, and within its limits", async () => {
    await addSandboxGame("hostile", COUNTER);
    const a = await join("hostile", "ABCDEF");
    await a.next(); // hi

    // No internet: the fetch fails, so nothing is broadcast.
    a.ws.send(JSON.stringify({ t: "msg", d: "fetch" }));
    // Nothing of ours inside the sandbox.
    a.ws.send(JSON.stringify({ t: "msg", d: "who" }));
    expect((await a.next()).d).toEqual({ globals: "undefined", keys: [] });

    // A crash loses that one message; the room and its state carry on. (So does a loop that never
    // ends, cut off by the CPU limit, but only Cloudflare enforces that: locally it would hang the test.)
    a.ws.send(JSON.stringify({ t: "msg", d: "crash" }));
    a.ws.send(JSON.stringify({ t: "msg", d: "add" }));
    expect((await a.next()).d).toEqual({ count: 1 });
  });

  it("leaves a game without a game server file unavailable", async () => {
    await addSandboxGame("empty", COUNTER);
    await e.GAMES.delete("games/vempty/zaisma-server.js");
    const up = await SELF.fetch(`${R}/v1/rooms/empty/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN } });
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
      settings: async () => ({ tickRate: 10 }),
      setup: async () => ({ state: { n: 0 }, effects: [] }),
      call: async (_hook: string, state: any) => {
        if (fail) throw new Error("Worker exceeded CPU time limit.");
        return { state: { n: state.n + 1 }, effects: [] };
      },
    };
    const server = await wrapSession(async () => (opened++, session as never), () => broken++);
    const room = { players: [], listed: true, open: true, name: null, labels: {} } as never;

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
