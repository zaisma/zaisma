import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addGame(slug: string, opts: { status?: string; server?: string | null; browsing?: string } = {}) {
  const id = `g${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, game_server, room_browsing, created_at, updated_at) VALUES (?, ?, ?, ?, 'v1', ?, ?, 0, 0)")
    .bind(id, slug, slug, opts.status ?? "live", opts.server === undefined ? "relay" : opts.server, opts.browsing ?? "page")
    .run();
  return id;
}

// Each request comes from its own made-up address, so the tests don't run into the per-address limits.
let address = 0;
async function post(path: string, game: string, origin = ORIGIN) {
  return SELF.fetch(`${R}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ game }) });
}

async function getPass(game: string): Promise<{ pass: string; player: { id: string; name: string } }> {
  const res = await post("/v1/pass", game);
  expect(res.status).toBe(200);
  return res.json();
}

/** A connected test client that collects what the room sends. */
async function connect(game: string, code: string, origin = ORIGIN, from?: { country: string; continent: string }) {
  const res = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: origin }, ...(from ? { cf: from } : {}) });
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

async function join(game: string, code: string, opts: { listed?: false; from?: { country: string; continent: string } } = {}) {
  const { pass, player } = await getPass(game);
  const c = await connect(game, code, ORIGIN, opts.from);
  c.ws.send(JSON.stringify({ t: "hello", pass, room: opts.listed === false ? { listed: false } : undefined }));
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
    expect(Object.keys(row).sort()).toEqual(["day", "game_id", "messages", "player_seconds", "rooms", "server_broken_rooms", "server_calls", "server_crashes", "server_stops"]);
  });
});

describe("game server registry", () => {
  it("matches the list admins pick from", async () => {
    const { GAME_SERVERS } = await import("../../apps/rooms/src/registry.ts");
    const { BUILT_IN_GAME_SERVERS } = await import("@zaisma/core");
    expect(Object.keys(GAME_SERVERS).sort()).toEqual([...BUILT_IN_GAME_SERVERS].sort());
  });
});

describe("reserved rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM live_rooms; DELETE FROM games;");
  });

  const until = async (c: { next: () => Promise<any> }, t: string) => {
    for (;;) {
      const m = await c.next();
      if (m.t === t) return m;
    }
  };

  async function hello(game: string, code: string, msg: Record<string, unknown>, pass?: { pass: string; player: { id: string; name: string } }) {
    const p = pass ?? (await getPass(game));
    const c = await connect(game, code);
    c.ws.send(JSON.stringify({ t: "hello", pass: p.pass, ...msg }));
    return { ...c, pass: p.pass, player: p.player, first: await c.next() };
  }

  it("move a lobby's players to a match room set up for them, which nobody else can join", async () => {
    await addGame("four", { server: "four-in-a-row" });
    const a = await hello("four", "LBBYAA", { room: { labels: { Room: "Lobby" } } });
    const b = await hello("four", "LBBYAA", {});
    expect([a.first.t, b.first.t]).toEqual(["welcome", "welcome"]);
    const [ma, mb] = [await until(a, "move"), await until(b, "move")];
    expect(ma.code).toBe(mb.code);

    // The room is waiting for them before they hear its code, so nobody else can start it first.
    const stranger = await hello("four", ma.code, {});
    expect(stranger.first).toMatchObject({ t: "error", code: "closed" });

    const bIn = await hello("four", ma.code, {}, b);
    expect(bIn.first).toMatchObject({ t: "welcome", room: { listed: false, open: false } });
    const board = await until(bIn, "msg");
    expect(board.d.seats).toEqual([a.player.id, b.player.id]);
    expect(board.d.names).toEqual([a.player.name, b.player.name]);
    const aIn = await hello("four", ma.code, {}, a);
    expect(aIn.first.t).toBe("welcome");
    // Hidden from the game's room list.
    const live = async () => e.DB.prepare("SELECT listed, open, players FROM live_rooms WHERE code = ?").bind(ma.code).first();
    for (let i = 0; i < 40 && (await live())?.players !== 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await live()).toEqual({ listed: 0, open: 0, players: 2 });
  });

  it("refuse join data that's too big", async () => {
    await addGame("four", { server: "four-in-a-row" });
    const c = await hello("four", "DATAAA", { data: "x".repeat(5000) });
    expect(c.first).toMatchObject({ t: "error", code: "too-big" });
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
    const row = await e.DB.prepare("SELECT * FROM reports WHERE game_id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "player", player_reason: "harassment", player_id: "g_123", player_name: "Swift Fox 42", room_code: "ABCDEF", details: "kept spamming" });
  });

  it("refuses bad reasons, codes and other sites", async () => {
    await addGame("arena");
    expect((await report({ code: "ABCDEF", player: "g_1", reason: "spam" })).status).toBe(400);
    expect((await report({ code: "nope", player: "g_1", reason: "other" })).status).toBe(400);
    expect((await report({ code: "ABCDEF", player: "g_1", reason: "other" }, "https://evil.example")).status).toBe(403);
  });
});

describe("room browsing", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM live_rooms; DELETE FROM room_usage; DELETE FROM games;");
  });

  /** A room writes its row just after welcoming the player, so wait for it to settle. */
  async function rows(gameId: string, want: (r: any[]) => boolean = () => true): Promise<any[]> {
    let found: any[] = [];
    for (let i = 0; i < 40; i++) {
      found = (await e.DB.prepare("SELECT * FROM live_rooms WHERE game_id = ? ORDER BY code").bind(gameId).all()).results;
      if (want(found)) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return found;
  }

  it("lists a room while players are in it, and drops it when they've all gone", async () => {
    const id = await addGame("party");
    const a = await join("party", "BCDFGH", { from: { country: "DE", continent: "EU" } });
    expect(await rows(id, (r) => r.length === 1)).toMatchObject([{ code: "BCDFGH", players: 1, max_players: 16, open: 1, country: "DE", continent: "EU" }]);
    // The room stays where its first player was.
    const b = await join("party", "BCDFGH", { from: { country: "US", continent: "NA" } });
    expect((await rows(id, (r) => r[0]?.players === 2))[0]).toMatchObject({ players: 2, country: "DE" });
    b.ws.close(1000);
    expect((await rows(id, (r) => r[0]?.players === 1))[0].players).toBe(1);
    a.ws.close(1000);
    expect(await rows(id, (r) => r.length === 0)).toEqual([]);
  });

  it("never lists a room its maker hid, or any room of a game that turned browsing off, but counts their players", async () => {
    const id = await addGame("party");
    const a = await join("party", "JKMN3P", { listed: false });
    await join("party", "JKMN3P");
    a.ws.send(JSON.stringify({ t: "msg", d: 1 }));
    expect(await rows(id, (r) => r[0]?.players === 2)).toMatchObject([{ code: "JKMN3P", players: 2, listed: 0 }]);
    const party = await (await SELF.fetch(`${R}/v1/rooms/party`, { headers: { Origin: ORIGIN } })).json<any>();
    expect(party).toMatchObject({ rooms: [], playing: { players: 2, rooms: 1, closed: 0 }, joinable: 0, regions: [] });

    const off = await addGame("quiet", { browsing: "off" });
    await join("quiet", "QRSTVW");
    expect(await rows(off, (r) => r.length === 1)).toMatchObject([{ listed: 0 }]);
    const list = await SELF.fetch(`${R}/v1/rooms/quiet`, { headers: { Origin: ORIGIN } });
    expect(await list.json()).toMatchObject({ rooms: [], joinable: 0, regions: [] });
  });

  it("lets the first player close a relay room: it's listed as closed, and newcomers are refused", async () => {
    const id = await addGame("party");
    const a = await join("party", "XYZ234");
    const b = await join("party", "XYZ234");
    const next = async (c: { next: () => Promise<any> }, t: string) => {
      for (;;) {
        const m = await c.next();
        if (m.t === t) return m;
      }
    };
    b.ws.send(JSON.stringify({ t: "room", open: false }));
    expect(await next(b, "error")).toMatchObject({ code: "not-allowed" });
    a.ws.send(JSON.stringify({ t: "room", open: false }));
    expect(await next(a, "room")).toEqual({ t: "room", room: { listed: true, open: false, name: null, labels: {} } });
    expect((await rows(id, (r) => r[0]?.open === 0))[0]).toMatchObject({ players: 2, open: 0 });

    const { pass } = await getPass("party");
    const c = await connect("party", "XYZ234");
    c.ws.send(JSON.stringify({ t: "hello", pass }));
    expect(await c.next()).toMatchObject({ t: "error", code: "closed" });
    // b drops out and comes back: they were in the match.
    b.ws.close(1000);
    await b.closed;
    const again = await connect("party", "XYZ234");
    again.ws.send(JSON.stringify({ t: "hello", pass: b.pass }));
    expect((await again.next()).t).toBe("welcome");
  });

  it("lists rooms to the game itself: with space first, the player's country and continent first, then the busiest, never who's in them", async () => {
    // Its own game: rooms from the tests before can still be settling.
    const id = await addGame("lister");
    const now = Date.now();
    const add = (code: string, players: number, max: number, open: number, country: string | null, continent: string | null, at = now) =>
      e.DB.prepare("INSERT INTO live_rooms (game_id, code, players, max_players, open, country, continent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, code, players, max, open, country, continent, at, at)
        .run();
    await add("AAAAAA", 8, 8, 1, "DE", "EU"); // full
    await add("BBBBBB", 2, 8, 1, "US", "NA");
    await add("CCCCCC", 5, 8, 1, "US", "NA");
    await add("DDDDDD", 1, 8, 1, "FR", "EU");
    await add("GGGGGG", 1, 8, 1, "DE", "EU");
    await add("HHHHHH", 2, 8, 1, "XX", null); // unknown
    await add("EEEEEE", 4, 8, 0, "DE", "EU"); // closed
    await add("FFFFFF", 3, 8, 1, "DE", "EU", now - 3 * 3600_000); // stopped checking in

    const res = await SELF.fetch(`${R}/v1/rooms/lister`, { headers: { Origin: ORIGIN }, cf: { country: "DE", continent: "EU" } } as RequestInit);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const body = await res.json<{ rooms: any[]; playing: unknown }>();
    expect(body.rooms.map((r) => r.code)).toEqual(["GGGGGG", "DDDDDD", "CCCCCC", "BBBBBB", "HHHHHH", "AAAAAA", "EEEEEE"]);
    expect(body.rooms[0]).toEqual({ code: "GGGGGG", players: 1, max: 8, open: true, location: { country: "DE", name: "Germany", continent: "EU" }, near: true, name: null, labels: {}, link: "https://zaisma.test/g/lister?room=GGGGGG" });
    expect(body.rooms.find((r) => r.code === "HHHHHH").location).toBeNull();
    expect(body.playing).toEqual({ players: 23, rooms: 7, closed: 1 });
    expect(body).toMatchObject({ joinable: 5, region: null, more: 0 });
    // Regions to filter by, busiest first; a room whose region isn't known only counts in All.
    expect((body as any).regions).toEqual([
      { code: "EU", name: "Europe", rooms: 4, players: 14 },
      { code: "NA", name: "North America", rooms: 2, players: 7 },
    ]);
    const na = await (await SELF.fetch(`${R}/v1/rooms/lister?region=NA`, { headers: { Origin: ORIGIN } })).json<any>();
    expect(na.rooms.map((r: any) => r.code)).toEqual(["CCCCCC", "BBBBBB"]);
    expect(na).toMatchObject({ region: "NA", playing: { rooms: 7 }, joinable: 5 });
    expect((await SELF.fetch(`${R}/v1/rooms/lister`, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });

  it("keeps a room's name and labels, filters by labels, and drops a name a person hid", async () => {
    const id = await addGame("named");
    const { pass } = await getPass("named");
    const c = await connect("named", "NMDRM2");
    c.ws.send(JSON.stringify({ t: "hello", pass, room: { name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } } }));
    expect((await c.next()).room).toMatchObject({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });
    expect((await rows(id, (r) => r.length === 1))[0]).toMatchObject({ name: "Ana's castle", labels: '{"Mode":"Classic","Map":"Docks"}' });
    const add = (code: string, labels: string) =>
      e.DB.prepare("INSERT INTO live_rooms (game_id, code, players, max_players, open, labels, created_at, updated_at) VALUES (?, ?, 1, 8, 1, ?, ?, ?)").bind(id, code, labels, Date.now(), Date.now()).run();
    await add("NMDRM3", '{"Mode":"Hardcore"}');
    await add("NMDRM4", '{"Mode":"classic"}');
    const list = (q = "") => SELF.fetch(`${R}/v1/rooms/named${q}`, { headers: { Origin: ORIGIN } }).then((r) => r.json<any>());
    const all = await list();
    expect(all.rooms.find((r: any) => r.code === "NMDRM2")).toMatchObject({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });
    // "Classic" and "classic" are one choice.
    expect(all.filters.map((f: any) => [f.label, f.values.map((v: string) => v.toLowerCase())])).toEqual([["Mode", ["classic", "hardcore"]]]);
    const classic = await list(`?labels=${encodeURIComponent(JSON.stringify({ Mode: "Classic" }))}`);
    expect(classic.rooms.map((r: any) => r.code).sort()).toEqual(["NMDRM2", "NMDRM4"]);
    await e.DB.prepare("UPDATE live_rooms SET name_hidden = 1 WHERE code = 'NMDRM2'").run();
    expect((await list()).rooms.find((r: any) => r.code === "NMDRM2")).toMatchObject({ name: null, labels: {} });
    // A room renaming itself doesn't bring back a name a person hid.
    c.ws.send(JSON.stringify({ t: "room", name: "Ana's castle 2" }));
    await rows(id, (r) => r.find((x) => x.code === "NMDRM2")?.name === "Ana's castle 2");
    expect((await list()).rooms.find((r: any) => r.code === "NMDRM2").name).toBeNull();
  });

  it("offers games Zaisma's text filter", async () => {
    await addGame("named");
    const check = (text: string) => SELF.fetch(`${R}/v1/filter`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: JSON.stringify({ game: "named", text }) }).then((r) => r.json<any>());
    expect(await check(" Ana's\u200b castle ")).toEqual({ text: "Ana's castle", ok: true });
    expect(await check("add me on snap")).toMatchObject({ ok: false, reason: "contact" });
  });

  it("checks in every hour, and a room that stopped without hearing its players go drops off", async () => {
    const id = await addGame("checker");
    const a = await join("checker", "GHJKMN");
    await rows(id, (r) => r.length === 1);
    await e.DB.prepare("UPDATE live_rooms SET updated_at = 1").run();
    const stub = e.ROOMS.get(e.ROOMS.idFromName("checker:GHJKMN"));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await rows(id))[0].updated_at).toBeGreaterThan(1);

    // A room that lost its players without hearing them go (as after a restart) leaves its row on the next check.
    await runInDurableObject(stub, async (_room: Room, state) => {
      for (const ws of state.getWebSockets()) ws.serializeAttachment({ stage: "gone" });
      await state.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(stub); // Due now, so it may already have run by itself.
    expect(await rows(id, (r) => r.length === 0)).toEqual([]);
    a.ws.close(1000);
  });
});
