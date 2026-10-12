import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addGame(slug: string, opts: { status?: string; server?: string | null } = {}) {
  const id = `g${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, game_server, created_at, updated_at) VALUES (?, ?, ?, ?, 'v1', ?, 0, 0)")
    .bind(id, slug, slug, opts.status ?? "live", opts.server === undefined ? "relay" : opts.server)
    .run();
  return id;
}

async function post(path: string, game: string, origin = ORIGIN) {
  return SELF.fetch(`${R}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify({ game }) });
}

async function getPass(game: string): Promise<{ pass: string; player: { id: string; name: string } }> {
  const res = await post("/v1/pass", game);
  expect(res.status).toBe(200);
  return res.json();
}

/** A connected test client that collects what the room sends. */
async function connect(game: string, code: string, origin = ORIGIN) {
  const res = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: origin } });
  if (!res.webSocket) return { res, ws: null as never, inbox: [] as any[], next: async () => null as any, closed: Promise.resolve(0) };
  const ws = res.webSocket;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  let closedResolve: (code: number) => void;
  const closed = new Promise<number>((r) => (closedResolve = r));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data as string);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  ws.addEventListener("close", (ev) => closedResolve(ev.code));
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  return { res, ws, inbox, next, closed };
}

async function join(game: string, code: string) {
  const { pass, player } = await getPass(game);
  const c = await connect(game, code);
  c.ws.send(JSON.stringify({ t: "hello", pass }));
  const welcome = await c.next();
  expect(welcome.t).toBe("welcome");
  return { ...c, player, pass };
}

describe("rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM domains; DELETE FROM games;");
  });

  it("issues guest passes only to the game's own origin", async () => {
    await addGame("arena");
    const { pass, player } = await getPass("arena");
    expect(pass.split(".")).toHaveLength(3);
    expect(player.name).toMatch(/ \d\d$/);
    expect((await post("/v1/pass", "arena", "https://evil.example")).status).toBe(403);
    expect((await post("/v1/pass", "arena", "https://zaisma.test")).status).toBe(403);
    await addGame("held-one", { status: "held" });
    expect((await post("/v1/pass", "held-one")).status).toBe(404);
  });

  it("publishes the pass key", async () => {
    const res = await SELF.fetch(`${R}/.well-known/jwks.json`);
    const body = await res.json<{ keys: JsonWebKey[] }>();
    expect(body.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    expect(body.keys[0]).not.toHaveProperty("d");
  });

  it("makes room codes only for games with a game server", async () => {
    await addGame("arena");
    await addGame("solo", { server: null });
    const { code } = await (await post("/v1/rooms", "arena")).json<{ code: string }>();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect((await post("/v1/rooms", "solo")).status).toBe(404);
  });

  it("relays messages between two players and tells everyone who's in", async () => {
    await addGame("arena");
    const a = await join("arena", "ABCDEF");
    const b = await join("arena", "ABCDEF");
    expect((await a.next()).players).toHaveLength(1);
    expect((await a.next()).players.map((p: any) => p.id)).toEqual([a.player.id, b.player.id]);
    await b.next(); // b's player list

    a.ws.send(JSON.stringify({ t: "msg", d: { x: 3 } }));
    expect(await b.next()).toEqual({ t: "msg", d: { from: a.player.id, data: { x: 3 } } });

    b.ws.close(1000);
    expect((await a.next()).players.map((p: any) => p.id)).toEqual([a.player.id]);
  });

  it("needs a valid pass first, from the game's origin", async () => {
    await addGame("arena");
    await addGame("other");
    const wrongOrigin = await connect("arena", "ABCDEF", "https://evil.example");
    expect(wrongOrigin.res.status).toBe(403);

    const noHello = await connect("arena", "ABCDEF");
    noHello.ws.send(JSON.stringify({ t: "msg", d: 1 }));
    expect(await noHello.next()).toMatchObject({ t: "error", code: "no-hello" });

    const { pass } = await getPass("other");
    const wrongGame = await connect("arena", "ABCDEF");
    wrongGame.ws.send(JSON.stringify({ t: "hello", pass }));
    expect(await wrongGame.next()).toMatchObject({ t: "error", code: "bad-pass" });
  });

  it("a reconnect with the same pass keeps the same player", async () => {
    await addGame("arena");
    const a = await join("arena", "QRSTUV");
    const again = await connect("arena", "QRSTUV");
    again.ws.send(JSON.stringify({ t: "hello", pass: a.pass }));
    expect((await again.next()).me.id).toBe(a.player.id);
    expect(await a.closed).toBe(4001);
  });

  it("a takedown ends running rooms and refuses new players", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "HJKLMN");
    await e.DB.prepare("UPDATE games SET status = 'removed' WHERE id = ?").bind(id).run();
    // Make the room's once-a-minute check due now.
    await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName("arena:HJKLMN")), async (room: Room) => {
      (room as any).lastCheck = 0;
    });
    expect((await a.next()).t).toBe("players");
    a.ws.send(JSON.stringify({ t: "msg", d: 1 }));
    expect(await a.next()).toMatchObject({ t: "ended" });
    expect((await connect("arena", "HJKLMN")).res.status).toBe(404);
  });

  it("records usage when the room empties, with nothing about players", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "WXYZ23");
    a.ws.send(JSON.stringify({ t: "msg", d: 1 }));
    a.ws.close(1000);
    await a.closed;
    let row: any = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await e.DB.prepare("SELECT * FROM room_usage WHERE game_id = ?").bind(id).first();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ game_id: id, rooms: 1, messages: 1 });
    expect(Object.keys(row).sort()).toEqual(["day", "game_id", "messages", "player_seconds", "rooms"]);
  });
});

describe("game server registry", () => {
  it("matches the list admins pick from", async () => {
    const { GAME_SERVERS } = await import("../../apps/rooms/src/registry.ts");
    const { BUILT_IN_GAME_SERVERS } = await import("@zaisma/core");
    expect(Object.keys(GAME_SERVERS).sort()).toEqual([...BUILT_IN_GAME_SERVERS].sort());
  });
});

describe("turn-based rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM games;");
  });

  it("save the game after each move and pick it up again after waking", async () => {
    await addGame("four", { server: "four-in-a-row" });
    const a = await join("four", "MNPQRS");
    const b = await join("four", "MNPQRS");
    const stub = e.ROOMS.get(e.ROOMS.idFromName("four:MNPQRS"));
    a.ws.send(JSON.stringify({ t: "msg", d: { col: 3 } }));
    let board: number[] = [];
    for (let i = 0; i < 20 && board[38] !== 1; i++) {
      const m = await b.next();
      if (m.t === "msg") board = m.d.board;
    }
    expect(board[38]).toBe(1);

    // Throw away the in-memory game, as hibernation does, and reload what was saved.
    await runInDurableObject(stub, async (room: Room, state) => {
      const saved = await state.storage.get<{ state: { board: number[] } }>("saved");
      expect(saved?.state.board[38]).toBe(1);
      (room as any).core = null;
      (room as any).saved = saved!.state;
    });
    b.ws.send(JSON.stringify({ t: "msg", d: { col: 4 } }));
    for (let i = 0; i < 20 && board[39] !== 2; i++) {
      const m = await a.next();
      if (m.t === "msg") board = m.d.board;
    }
    expect(board[38]).toBe(1);
    expect(board[39]).toBe(2);
  });
});

describe("reporting a player", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM reports; DELETE FROM games;");
  });

  const report = (body: Record<string, unknown>, origin = ORIGIN) =>
    SELF.fetch(`${R}/v1/report`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify({ game: "arena", ...body }) });

  it("files a report with the room and the player's temporary ID, nothing about the reporter", async () => {
    const id = await addGame("arena");
    const res = await report({ code: "ABCDEF", player: "g_123", name: "Swift Fox 42", reason: "harassment", details: "kept spamming" });
    expect(res.status).toBe(200);
    const row = await e.DB.prepare("SELECT * FROM reports WHERE game_id = ?").bind(id).first<{ reason: string; details: string }>();
    expect(row?.reason).toBe("player");
    expect(row?.details).toContain("Harassing or bullying: Swift Fox 42 (temporary ID g_123) in room ABCDEF.");
    expect(row?.details).toContain("kept spamming");
  });

  it("refuses bad reasons, codes and other sites", async () => {
    await addGame("arena");
    expect((await report({ code: "ABCDEF", player: "g_1", reason: "spam" })).status).toBe(400);
    expect((await report({ code: "nope", player: "g_1", reason: "other" })).status).toBe(400);
    expect((await report({ code: "ABCDEF", player: "g_1", reason: "other" }, "https://evil.example")).status).toBe(403);
  });
});
