import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { gameOrigin, signingKey, type Env } from "../../apps/rooms/src/index.ts";
import { canChat, verifyPass } from "@zaisma/game-server";
import { acceptFriendInvite, addTesterLink, createAccount, createFriendInvite, deleteAccount, issueRoomKey, removeFriend, revokeTesterLink } from "@zaisma/core";
import type { Room } from "../../apps/rooms/src/room.ts";

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addGame(slug: string, opts: { status?: string; server?: string | null; browsing?: string } = {}) {
  const id = `g${slug.replace(/-/g, "")}`;
  // The game server its rooms run, as the games table keeps it: a multiplayer mode, and which built-in server.
  const server = opts.server === undefined ? "relay" : opts.server;
  const mode = server === null ? "none" : server === "relay" ? "relay" : server === "sandbox" ? "own" : "built-in";
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, built_in_server, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, 'v1', ?, ?, ?, 0, 0)")
    .bind(id, slug, slug, opts.status ?? "live", mode, mode === "built-in" ? server : null, opts.browsing ?? "page")
    .run();
  return id;
}

// Each request comes from its own made-up address, so the tests don't run into the per-address limits.
let address = 0;
async function post(path: string, game: string, origin = ORIGIN, extra: Record<string, unknown> = {}) {
  return SELF.fetch(`${R}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, ...extra }) });
}

/** The key the game page gets when Cloudflare's check on Play passes (apps/site/src/plays.ts). */
async function keyFor(game: string) {
  const row = await e.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(game).first<{ id: string }>();
  return issueRoomKey(e.DB, row?.id ?? "none");
}

async function getPass(game: string): Promise<{ pass: string; player: { id: string; name: string; kind: string }; expiresAt: string }> {
  const res = await post("/v1/pass", game, ORIGIN, { roomKey: await keyFor(game) });
  expect(res.status).toBe(200);
  return res.json();
}

/** A connected test client that collects what the room sends. */
async function connect(game: string, code: string, origin = ORIGIN, from?: { country: string; continent: string }) {
  const res = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: origin, "cf-connecting-ip": `198.51.100.${++address % 250}` }, ...(from ? { cf: from } : {}) });
  if (!res.webSocket) return { res, ws: null as never, inbox: [] as any[], next: async () => null as any, closed: Promise.resolve(0), pongs: [] as number[] };
  const ws = res.webSocket;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  const pongs: number[] = [];
  let closedResolve: (code: number) => void;
  const closed = new Promise<number>((r) => (closedResolve = r));
  ws.addEventListener("message", (ev) => {
    if (ev.data === "pong") return void pongs.push(Date.now());
    const m = JSON.parse(ev.data as string);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  ws.addEventListener("close", (ev) => closedResolve(ev.code));
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  return { res, ws, inbox, next, closed, pongs };
}

/** The next message a client gets that matches, skipping others. */
async function until(c: { next: () => Promise<any> }, want: (m: any) => boolean): Promise<any> {
  for (;;) {
    const m = await c.next();
    if (want(m)) return m;
  }
}

async function join(game: string, code: string, opts: { listed?: false; from?: { country: string; continent: string } } = {}) {
  const { pass, player } = await getPass(game);
  const c = await connect(game, code, ORIGIN, opts.from);
  c.ws.send(JSON.stringify({ type: "hello", pass, room: opts.listed === false ? { isListed: false } : undefined }));
  const welcome = await c.next();
  expect(welcome.type).toBe("welcome");
  return { ...c, player, pass };
}

describe("rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM tester_links; DELETE FROM room_usage; DELETE FROM room_keys; DELETE FROM domains; DELETE FROM games;");
  });

  it("issues guest passes only to the game's own origin", async () => {
    await addGame("arena");
    const { pass, player, expiresAt } = await getPass("arena");
    expect(pass.split(".")).toHaveLength(3);
    expect(player.name).toMatch(/ \d\d$/);
    // A guest's ID says its kind, and the pass's expiry is an ISO time a day ahead.
    expect(player.id).toMatch(/^player_[a-z0-9]{20}$/);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect((await post("/v1/pass", "arena", "https://evil.example")).status).toBe(403);
    expect((await post("/v1/pass", "arena", "https://zaisma.test")).status).toBe(403);
    await addGame("held-one", { status: "held" });
    expect((await post("/v1/pass", "held-one")).status).toBe(404);
  });

  it("gives passes only for a browser the check on Play let in, a few per key", async () => {
    await addGame("arena");
    await addGame("other");
    const none = await post("/v1/pass", "arena");
    expect(none.status).toBe(403);
    expect(await none.json()).toEqual({ error: { code: "unchecked", message: "Zaisma couldn't check this browser, so it can't play online. Reload the game to try again." } });
    expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: "madeupkey123" })).status).toBe(403);
    expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: await keyFor("other") })).status).toBe(403);

    const key = await keyFor("arena");
    for (let i = 0; i < 5; i++) expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: key })).status).toBe(200);
    expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: key })).status).toBe(403);

    // A key is good for 6 hours.
    const old = await keyFor("arena");
    await e.DB.prepare("UPDATE room_keys SET issued_at_ms = ? WHERE id = ?").bind(Date.now() - 6 * 3_600_000 - 1000, old).run();
    expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: old })).status).toBe(403);
  });

  it("gives a signed-in player their account's pass: the same ID in every game, proof only, with their name in rooms", async () => {
    const arena = await addGame("arena");
    const other = await addGame("other");
    const account = await createAccount(e.DB, { id: "supabase-user-1", name: "Night Owl", ageBand: "18+" });
    const passFor = async (gameSlug: string, gameId: string) => {
      const response = await post("/v1/pass", gameSlug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) });
      expect(response.status).toBe(200);
      return response.json<{ pass: string; player: { id: string; name: string; kind: string } }>();
    };
    const { pass, player } = await passFor("arena", arena);
    expect(player).toEqual({ id: account.player_id, name: "Night Owl", kind: "account" });
    expect(account.player_id).toMatch(/^player_[a-z0-9]{20}$/);
    // The pass proves who, for which game and until when; the name and the sign-in's own ID stay out of it.
    const claims = JSON.parse(atob(pass.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "friend_player_ids", "iat", "iss", "kind", "social_mode", "sub"]);
    expect(claims).toMatchObject({ sub: account.player_id, kind: "account", aud: "arena", social_mode: "friends_focused", friend_player_ids: [] });
    expect(pass).not.toContain(account.id);
    expect((await passFor("other", other)).player.id).toBe(account.player_id);

    // Rooms show the account's name, and the game server sees its kind.
    const c = await connect("arena", "ACCNTS");
    c.ws.send(JSON.stringify({ type: "hello", pass }));
    expect((await c.next()).me).toEqual({ id: account.player_id, name: "Night Owl", kind: "account" });
    c.ws.close(1000);
    // A guest beside them is still a guest.
    expect((await getPass("arena")).player.kind).toBe("guest");

    // Once the account is deleted, its passes stop working and its keys give nothing.
    const leftoverKey = await issueRoomKey(e.DB, arena, account.id);
    await deleteAccount(e.DB, account.id);
    const late = await connect("arena", "ACCNTS");
    late.ws.send(JSON.stringify({ type: "hello", pass }));
    expect(await late.next()).toMatchObject({ type: "error", code: "bad_pass" });
    expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: leftoverKey })).status).toBe(403);
  });

  it("says in the pass who an account can chat with, never its age, and canChat follows it", async () => {
    const arena = await addGame("arena");
    const other = await addGame("other");
    const accountFor = (id: string, ageBand: "13-15" | "16-17" | "18+", socialMode: "solo_focused" | "friends_focused" | "open_and_social") => createAccount(e.DB, { id, name: id, ageBand, socialMode });
    const claimsOf = async (account: { id: string }, gameSlug = "arena", gameId = arena) => {
      const { pass } = await (await post("/v1/pass", gameSlug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) })).json<{ pass: string }>();
      return verifyPass(pass, [(await signingKey(e)).publicKey], { game: gameSlug, issuer: e.ISSUER });
    };
    const teen = await claimsOf(await accountFor("teen-open-1", "16-17", "open_and_social"));
    const teenToo = await claimsOf(await accountFor("teen-open-2", "16-17", "open_and_social"));
    const adult = await claimsOf(await accountFor("adult-open-1", "18+", "open_and_social"));
    const adultToo = await claimsOf(await accountFor("adult-open-2", "18+", "open_and_social"));
    const friendsOnly = await claimsOf(await accountFor("adult-friends", "18+", "friends_focused"));
    const young = await claimsOf(await accountFor("young-solo", "13-15", "solo_focused"));
    const guest = await verifyPass((await getPass("arena")).pass, [(await signingKey(e)).publicKey], { game: "arena", issuer: e.ISSUER });

    // Opaque groups: the same within a band group and a game, never naming an age.
    expect(teen.chat_group).toMatch(/^chat_group_[a-f0-9]{20}$/);
    expect(teen.chat_group).toBe(teenToo.chat_group);
    expect(adult.chat_group).toBe(adultToo.chat_group);
    expect(teen.chat_group).not.toBe(adult.chat_group);
    expect(JSON.stringify([teen, adult, young])).not.toMatch(/13-15|16-17|18\+/);
    // Another game gets other groups, so groups can't be matched across games.
    expect((await claimsOf({ id: "teen-open-1" }, "other", other)).chat_group).not.toBe(teen.chat_group);
    // Only open and social carries a group; guests carry no social mode at all.
    expect(friendsOnly).toMatchObject({ social_mode: "friends_focused" });
    expect(friendsOnly.chat_group).toBeUndefined();
    expect(young).toMatchObject({ social_mode: "solo_focused" });
    expect(guest.social_mode).toBeUndefined();

    expect(canChat(teen, teenToo)).toBe(true);
    expect(canChat(adult, adultToo)).toBe(true);
    expect(canChat(teen, adult)).toBe(false);
    expect(canChat(adult, friendsOnly)).toBe(false);
    expect(canChat(young, teen)).toBe(false);
    expect(canChat(guest, adult)).toBe(false);
    expect(canChat(adult, adult)).toBe(false);
    expect(guest.friend_player_ids).toBeUndefined();
  });

  it("puts an account's friends in its passes, so friends chat and strangers don't", async () => {
    const arena = await addGame("arena");
    const ana = await createAccount(e.DB, { id: "friend-ana", name: "Ana", ageBand: "18+", socialMode: "friends_focused" });
    const ben = await createAccount(e.DB, { id: "friend-ben", name: "Ben", ageBand: "13-15", socialMode: "friends_focused" });
    const stranger = await createAccount(e.DB, { id: "friend-stranger", name: "Cy", ageBand: "18+", socialMode: "friends_focused" });
    const claimsOf = async (account: { id: string }) => {
      const { pass } = await (await post("/v1/pass", "arena", ORIGIN, { roomKey: await issueRoomKey(e.DB, arena, account.id) })).json<{ pass: string }>();
      return verifyPass(pass, [(await signingKey(e)).publicKey], { game: "arena", issuer: e.ISSUER });
    };
    const made = await createFriendInvite(e.DB, ana.id);
    if (!("invite" in made)) throw new Error("no invite");
    expect(await acceptFriendInvite(e.DB, ben.id, made.invite.invite_code)).toMatchObject({ friend: { player_id: ana.player_id, name: "Ana" } });

    const [anaClaims, benClaims, strangerClaims] = [await claimsOf(ana), await claimsOf(ben), await claimsOf(stranger)];
    expect(anaClaims.friend_player_ids).toEqual([ben.player_id]);
    expect(benClaims.friend_player_ids).toEqual([ana.player_id]);
    expect(canChat(anaClaims, benClaims)).toBe(true);
    expect(canChat(anaClaims, strangerClaims)).toBe(false);

    // Removed on one side is removed on both, from the next pass on.
    await removeFriend(e.DB, ben.id, ana.player_id);
    expect((await claimsOf(ana)).friend_player_ids).toEqual([]);
    expect(canChat(await claimsOf(ana), benClaims)).toBe(false);
  });

  it("gives guests no passes for a game that needs accounts, and rooms turn away guest passes made before", async () => {
    const arena = await addGame("arena");
    const account = await createAccount(e.DB, { id: "supabase-user-3", name: "Tall Pine", ageBand: "18+" });
    const earlier = await getPass("arena");
    for (const requirement of ["multiplayer", "whole_game"]) {
      await e.DB.prepare("UPDATE games SET account_requirement = ? WHERE id = ?").bind(requirement, arena).run();
      const refused = await post("/v1/pass", "arena", ORIGIN, { roomKey: await keyFor("arena") });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: { code: "account_needed", message: "Playing online needs a Zaisma account. Sign in on the game's page to play." } });
      const signedIn = await post("/v1/pass", "arena", ORIGIN, { roomKey: await issueRoomKey(e.DB, arena, account.id) });
      expect((await signedIn.json<{ player: { kind: string } }>()).player.kind).toBe("account");
    }
    // A guest's pass from before the change no longer gets into a room.
    const late = await connect("arena", "GSTWAY");
    late.ws.send(JSON.stringify({ type: "hello", pass: earlier.pass }));
    expect(await late.next()).toMatchObject({ type: "error", code: "account_needed" });
    // Guests welcome again: passes as before.
    await e.DB.prepare("UPDATE games SET account_requirement = 'none' WHERE id = ?").bind(arena).run();
    expect((await getPass("arena")).player.kind).toBe("guest");
  });

  it("looks up an account's public profile by player ID, for any site or server", async () => {
    const account = await createAccount(e.DB, { id: "supabase-user-2", name: "Quiet Heron", ageBand: "16-17" });
    const lookUp = (playerId: string) => SELF.fetch(`${R}/v1/players/${playerId}`, { headers: { "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    const found = await lookUp(account.player_id);
    expect(found.status).toBe(200);
    expect(found.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // What a stranger sees: never the email, the age or the sign-in's own ID.
    expect(await found.json()).toEqual({ player: { id: account.player_id, name: "Quiet Heron" } });
    const { player: guest } = await (await addGame("arena").then(() => getPass("arena")));
    for (const playerId of [guest.id, "player_nobodyhasthis1", "supabase-user-2"]) {
      const missing = await lookUp(playerId);
      expect(missing.status).toBe(404);
      expect((await missing.json<{ error: { code: string } }>()).error.code).toBe("no_player");
    }
  });

  it("limits how many room connections one address opens in a minute", async () => {
    // A game that isn't there answers quickly, and still counts toward the limit.
    const open = () => SELF.fetch(`${R}/v1/rooms/no-such-game/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": "203.0.113.9" } });
    for (let i = 0; i < 60; i++) expect((await open()).status).toBe(404);
    expect((await open()).status).toBe(429);
    const other = await SELF.fetch(`${R}/v1/rooms/no-such-game/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": "203.0.113.10" } });
    expect(other.status).toBe(404);
  });

  it("lets a tester link's origin in, with room links back through it", async () => {
    const id = await addGame("hidden-arena");
    const sub = { ...e, GAME_HOST_MODE: "subdomain", GAME_DOMAIN: "zaismausercontent.com" } as Env;
    const link = await addTesterLink(e.DB, id, "Team");
    const at = (host: string) => gameOrigin(sub, "hidden-arena", `https://${host}`);
    expect(await at("hidden-arena.zaismausercontent.com")).toEqual({ page: "/g/hidden-arena" });
    expect(await at(`hidden-arena--${link.token}.zaismausercontent.com`)).toEqual({ page: `/t/${link.token}`, tester: link.id });
    expect(await at(`other--${link.token}.zaismausercontent.com`)).toBeNull();
    expect(await at(`hidden-arena--${link.token}.evil.example`)).toBeNull();
    expect(await at(`hidden-arena--${"a".repeat(20)}.zaismausercontent.com`)).toBeNull();
    await revokeTesterLink(e.DB, id, link.id);
    expect(await at(`hidden-arena--${link.token}.zaismausercontent.com`)).toBeNull();
    await e.DB.exec("DELETE FROM tester_links;");
  });

  it("lets players go once the tester link they came through is turned off", async () => {
    const id = await addGame("arena");
    const link = await addTesterLink(e.DB, id, "Team");
    // As the rooms Worker hands over a player from a tester link's origin.
    const res = await e.ROOMS.get(e.ROOMS.idFromName("arena:TSTRMS")).fetch("https://room/", {
      headers: { Upgrade: "websocket", "x-game-id": id, "x-game-slug": "arena", "x-game-server": "relay", "x-game-version": "v1", "x-room-code": "TSTRMS", "x-tester-link": link.id },
    });
    const tester = res.webSocket!;
    tester.accept();
    const said: any[] = [];
    tester.addEventListener("message", (ev) => said.push(JSON.parse(ev.data as string)));
    const testerClosed = new Promise<number>((r) => tester.addEventListener("close", (ev) => r(ev.code)));
    tester.send(JSON.stringify({ type: "hello", pass: (await getPass("arena")).pass }));
    const other = await join("arena", "TSTRMS");
    expect((await other.next()).players).toHaveLength(2);

    // Still on: nothing happens.
    other.ws.send(JSON.stringify({ type: "message", data: 1 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(said.some((m) => m.type === "error")).toBe(false);

    await revokeTesterLink(e.DB, id, link.id);
    await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName("arena:TSTRMS")), (room: Room) => {
      (room as unknown as { lastTesterCheckAtMs: number }).lastTesterCheckAtMs = 0;
    });
    other.ws.send(JSON.stringify({ type: "message", data: 2 }));
    expect(await testerClosed).toBe(4001);
    expect(said).toContainEqual(expect.objectContaining({ type: "error", code: "game_unavailable" }));
    // Everyone else plays on without them.
    let left: any;
    do left = await other.next();
    while (!left.players || left.players.length !== 1);
    expect(left.players.map((p: any) => p.id)).toEqual([other.player.id]);
    await e.DB.exec("DELETE FROM tester_links;");
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
    const { roomCode } = await (await post("/v1/rooms", "arena")).json<{ roomCode: string }>();
    expect(roomCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect((await post("/v1/rooms", "solo")).status).toBe(404);
  });

  it("relays messages between two players and tells everyone who's in", async () => {
    await addGame("arena");
    const a = await join("arena", "ABCDEF");
    const b = await join("arena", "ABCDEF");
    expect((await a.next()).players).toHaveLength(1);
    expect((await a.next()).players.map((p: any) => p.id)).toEqual([a.player.id, b.player.id]);
    await b.next(); // b's player list

    a.ws.send(JSON.stringify({ type: "message", data: { x: 3 } }));
    expect(await b.next()).toEqual({ type: "message", data: { fromPlayerId: a.player.id, data: { x: 3 } } });

    b.ws.close(1000);
    expect((await a.next()).players.map((p: any) => p.id)).toEqual([a.player.id]);
  });

  it("needs a valid pass first, from the game's origin", async () => {
    await addGame("arena");
    await addGame("other");
    const wrongOrigin = await connect("arena", "ABCDEF", "https://evil.example");
    expect(wrongOrigin.res.status).toBe(403);

    const noHello = await connect("arena", "ABCDEF");
    noHello.ws.send(JSON.stringify({ type: "message", data: 1 }));
    expect(await noHello.next()).toMatchObject({ type: "error", code: "no_hello" });

    const { pass } = await getPass("other");
    const wrongGame = await connect("arena", "ABCDEF");
    wrongGame.ws.send(JSON.stringify({ type: "hello", pass }));
    expect(await wrongGame.next()).toMatchObject({ type: "error", code: "bad_pass" });
  });

  it("a reconnect with the same pass keeps the same player", async () => {
    await addGame("arena");
    const a = await join("arena", "QRSTUV");
    const again = await connect("arena", "QRSTUV");
    again.ws.send(JSON.stringify({ type: "hello", pass: a.pass }));
    expect((await again.next()).me.id).toBe(a.player.id);
    expect(await a.closed).toBe(4001);
  });

  it("a takedown ends running rooms and refuses new players", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "HJKLMN");
    await e.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = ?").bind(id).run();
    // Make the room's once-a-minute check due now.
    await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName("arena:HJKLMN")), async (room: Room) => {
      (room as any).lastCheckAtMs = 0;
    });
    expect((await a.next()).type).toBe("players");
    a.ws.send(JSON.stringify({ type: "message", data: 1 }));
    expect(await a.next()).toMatchObject({ type: "ended" });
    expect((await connect("arena", "HJKLMN")).res.status).toBe(404);
  });

  it("records usage when the room empties, with nothing about players", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "WXYZ23");
    a.ws.send(JSON.stringify({ type: "message", data: 1 }));
    a.ws.close(1000);
    await a.closed;
    let row: any = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await e.DB.prepare("SELECT * FROM room_usage WHERE game_id = ?").bind(id).first();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ game_id: id, room_count: 1, message_count: 1 });
    expect(Object.keys(row).sort()).toEqual(["date", "game_id", "game_server_call_count", "game_server_crash_count", "game_server_ended_match_count", "game_server_stopped_count", "message_count", "room_count", "room_play_duration_sec"]);
  });

  it("past the month's free player-hours, opens no new rooms while running ones carry on", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "CAPPDA");
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 10);
    const used = (date: string, roomPlayDurationSec: number) => e.DB.prepare("INSERT INTO room_usage (game_id, date, room_play_duration_sec) VALUES (?, ?, ?)").bind(id, date, roomPlayDurationSec).run();
    // Last month's time doesn't count.
    await used(lastMonth, 4_000_000);
    expect((await post("/v1/rooms", "arena")).status).toBe(200);
    await used(`${now.toISOString().slice(0, 7)}-01`, 1000 * 3600);

    const made = await post("/v1/rooms", "arena");
    expect(made.status).toBe(403);
    expect(await made.json()).toMatchObject({ error: { code: "month_limit" } });
    const fresh = await connect("arena", "NEWRMA");
    fresh.ws.send(JSON.stringify({ type: "hello", pass: (await getPass("arena")).pass }));
    expect(await fresh.next()).toMatchObject({ type: "error", code: "month_limit" });
    const reserve = await e.ROOMS.get(e.ROOMS.idFromName("arena:RSRVDA")).fetch("https://room/reserve", {
      method: "POST",
      headers: { "x-game-id": id, "x-game-slug": "arena", "x-game-server": "relay", "x-room-code": "RSRVDA" },
      body: JSON.stringify({ playerIds: [a.player.id], setupData: null }),
    });
    expect(reserve.status).toBe(403);

    // The running room still takes players, and once it empties, only its own players come back.
    const b = await join("arena", "CAPPDA");
    a.ws.close(1000);
    b.ws.close(1000);
    await Promise.all([a.closed, b.closed]);
    const stranger = await connect("arena", "CAPPDA");
    stranger.ws.send(JSON.stringify({ type: "hello", pass: (await getPass("arena")).pass }));
    expect(await stranger.next()).toMatchObject({ type: "error", code: "month_limit" });
    const back = await connect("arena", "CAPPDA");
    back.ws.send(JSON.stringify({ type: "hello", pass: a.pass }));
    expect(await back.next()).toMatchObject({ type: "welcome", me: { id: a.player.id } });
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
      if (m.type === t) return m;
    }
  };

  async function hello(game: string, code: string, msg: Record<string, unknown>, pass?: { pass: string; player: { id: string; name: string } }) {
    const p = pass ?? (await getPass(game));
    const c = await connect(game, code);
    c.ws.send(JSON.stringify({ type: "hello", pass: p.pass, ...msg }));
    return { ...c, pass: p.pass, player: p.player, first: await c.next() };
  }

  it("move a lobby's players to a match room set up for them, which nobody else can join", async () => {
    await addGame("four", { server: "four-in-a-row" });
    const a = await hello("four", "LBBYAA", { room: { labels: { Room: "Lobby" } } });
    const b = await hello("four", "LBBYAA", {});
    expect([a.first.type, b.first.type]).toEqual(["welcome", "welcome"]);
    const [ma, mb] = [await until(a, "move"), await until(b, "move")];
    expect(ma.roomCode).toBe(mb.roomCode);

    // The room is waiting for them before they hear its code, so nobody else can start it first.
    const stranger = await hello("four", ma.roomCode, {});
    expect(stranger.first).toMatchObject({ type: "error", code: "closed" });

    const bIn = await hello("four", ma.roomCode, {}, b);
    expect(bIn.first).toMatchObject({ type: "welcome", room: { isListed: false, isOpen: false } });
    const board = await until(bIn, "message");
    expect(board.data.seatPlayerIds).toEqual([a.player.id, b.player.id]);
    expect(board.data.seatNames).toEqual([a.player.name, b.player.name]);
    const aIn = await hello("four", ma.roomCode, {}, a);
    expect(aIn.first.type).toBe("welcome");
    // Hidden from the game's room list.
    const live = async () => e.DB.prepare("SELECT is_listed, is_open, player_count FROM live_rooms WHERE room_code = ?").bind(ma.roomCode).first();
    for (let i = 0; i < 40 && (await live())?.player_count !== 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await live()).toEqual({ is_listed: 0, is_open: 0, player_count: 2 });
  });

  it("refuse join data that's too big", async () => {
    await addGame("four", { server: "four-in-a-row" });
    const c = await hello("four", "DATAAA", { joinData: "x".repeat(5000) });
    expect(c.first).toMatchObject({ type: "error", code: "too_big" });
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
    a.ws.send(JSON.stringify({ type: "message", data: { column: 3 } }));
    let board: number[] = [];
    for (let i = 0; i < 20 && board[38] !== 1; i++) {
      const m = await b.next();
      if (m.type === "message") board = m.data.board;
    }
    expect(board[38]).toBe(1);

    // Throw away the in-memory game, as hibernation does, and reload what was saved.
    await runInDurableObject(stub, async (room: Room, state) => {
      const saved = await state.storage.get<{ state: { board: number[] } }>("saved");
      expect(saved?.state.board[38]).toBe(1);
      (room as any).core = null;
      (room as any).saved = saved!.state;
    });
    b.ws.send(JSON.stringify({ type: "message", data: { column: 4 } }));
    for (let i = 0; i < 20 && board[39] !== 2; i++) {
      const m = await a.next();
      if (m.type === "message") board = m.data.board;
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
    SELF.fetch(`${R}/v1/report`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify({ gameSlug: "arena", ...body }) });

  it("files a report with the room and the player's temporary ID, nothing about the reporter", async () => {
    const id = await addGame("arena");
    const res = await report({ roomCode: "ABCDEF", playerId: "player_123abc", playerName: "Swift Fox 42", reason: "harassment", details: "kept spamming" });
    expect(await res.json()).toEqual({ isReported: true });
    expect(res.status).toBe(200);
    const row = await e.DB.prepare("SELECT * FROM reports WHERE game_id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "player", player_reason: "harassment", player_id: "player_123abc", player_name: "Swift Fox 42", room_code: "ABCDEF", player_text: "kept spamming" });
  });

  it("refuses bad reasons, codes and other sites", async () => {
    await addGame("arena");
    const refused = await report({ roomCode: "ABCDEF", playerId: "player_1", reason: "spam" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: "bad_report" } });
    expect((await report({ roomCode: "nope", playerId: "player_1", reason: "other" })).status).toBe(400);
    // A player ID of another kind, or an old guest ID, isn't a player.
    expect((await report({ roomCode: "ABCDEF", playerId: "game_1", reason: "other" })).status).toBe(400);
    expect((await report({ roomCode: "ABCDEF", playerId: "g_1", reason: "other" })).status).toBe(400);
    const elsewhere = await report({ roomCode: "ABCDEF", playerId: "player_1", reason: "other" }, "https://evil.example");
    expect(elsewhere.status).toBe(403);
    expect(await elsewhere.json()).toMatchObject({ error: { code: "bad_origin" } });
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
      found = (await e.DB.prepare("SELECT * FROM live_rooms WHERE game_id = ? ORDER BY room_code").bind(gameId).all()).results;
      if (want(found)) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return found;
  }

  it("lists a room while players are in it, and drops it when they've all gone", async () => {
    const id = await addGame("party");
    const a = await join("party", "BCDFGH", { from: { country: "DE", continent: "EU" } });
    expect(await rows(id, (r) => r.length === 1)).toMatchObject([{ room_code: "BCDFGH", player_count: 1, maximum_player_count: 16, is_open: 1, country: "DE", continent: "EU" }]);
    // The room stays where its first player was.
    const b = await join("party", "BCDFGH", { from: { country: "US", continent: "NA" } });
    expect((await rows(id, (r) => r[0]?.player_count === 2))[0]).toMatchObject({ player_count: 2, country: "DE" });
    b.ws.close(1000);
    expect((await rows(id, (r) => r[0]?.player_count === 1))[0].player_count).toBe(1);
    a.ws.close(1000);
    expect(await rows(id, (r) => r.length === 0)).toEqual([]);
  });

  it("never lists a room its maker hid, or any room of a game that turned browsing off, but counts their players", async () => {
    const id = await addGame("party");
    const a = await join("party", "JKMN3P", { listed: false });
    await join("party", "JKMN3P");
    a.ws.send(JSON.stringify({ type: "message", data: 1 }));
    expect(await rows(id, (r) => r[0]?.player_count === 2)).toMatchObject([{ room_code: "JKMN3P", player_count: 2, is_listed: 0 }]);
    const party = await (await SELF.fetch(`${R}/v1/rooms/party`, { headers: { Origin: ORIGIN } })).json<any>();
    expect(party).toMatchObject({ rooms: [], playing: { playerCount: 2, roomCount: 1, closedRoomCount: 0 }, joinableRoomCount: 0, regions: [] });

    const off = await addGame("quiet", { browsing: "off" });
    await join("quiet", "QRSTVW");
    expect(await rows(off, (r) => r.length === 1)).toMatchObject([{ is_listed: 0 }]);
    const list = await SELF.fetch(`${R}/v1/rooms/quiet`, { headers: { Origin: ORIGIN } });
    expect(await list.json()).toEqual({
      rooms: [],
      playing: { playerCount: 0, roomCount: 0, closedRoomCount: 0 },
      joinableRoomCount: 0,
      openRoomCount: 0,
      regions: [],
      region: null,
      moreOpenRoomCount: 0,
      filters: [],
    });
  });

  it("lets the first player close a relay room: it's listed as closed, and newcomers are refused", async () => {
    const id = await addGame("party");
    const a = await join("party", "XYZ234");
    const b = await join("party", "XYZ234");
    const next = async (c: { next: () => Promise<any> }, t: string) => {
      for (;;) {
        const m = await c.next();
        if (m.type === t) return m;
      }
    };
    b.ws.send(JSON.stringify({ type: "room", isOpen: false }));
    expect(await next(b, "error")).toMatchObject({ code: "not_allowed" });
    a.ws.send(JSON.stringify({ type: "room", isOpen: false }));
    expect(await next(a, "room")).toEqual({ type: "room", room: { isListed: true, isOpen: false, name: null, labels: {} } });
    expect((await rows(id, (r) => r[0]?.is_open === 0))[0]).toMatchObject({ player_count: 2, is_open: 0 });

    const { pass } = await getPass("party");
    const c = await connect("party", "XYZ234");
    c.ws.send(JSON.stringify({ type: "hello", pass }));
    expect(await c.next()).toMatchObject({ type: "error", code: "closed" });
    // b drops out and comes back: they were in the match.
    b.ws.close(1000);
    await b.closed;
    const again = await connect("party", "XYZ234");
    again.ws.send(JSON.stringify({ type: "hello", pass: b.pass }));
    expect((await again.next()).type).toBe("welcome");
  });

  it("lists rooms to the game itself: with space first, the player's country and continent first, then the busiest, never who's in them", async () => {
    // Its own game: rooms from the tests before can still be settling.
    const id = await addGame("lister");
    const now = Date.now();
    const add = (code: string, players: number, max: number, open: number, country: string | null, continent: string | null, at = now) =>
      e.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
    expect(body.rooms.map((r) => r.roomCode)).toEqual(["GGGGGG", "DDDDDD", "CCCCCC", "BBBBBB", "HHHHHH", "AAAAAA", "EEEEEE"]);
    expect(body.rooms[0]).toEqual({
      roomCode: "GGGGGG",
      playerCount: 1,
      heldSeatCount: 0,
      maximumPlayerCount: 8,
      isOpen: true,
      location: { countryCode: "DE", countryName: "Germany", region: "EU" },
      isNear: true,
      name: null,
      labels: {},
      inviteUrl: "https://zaisma.test/g/lister?room=GGGGGG",
    });
    expect(body.rooms.find((r) => r.roomCode === "HHHHHH").location).toBeNull();
    expect(body.playing).toEqual({ playerCount: 23, roomCount: 7, closedRoomCount: 1 });
    expect(body).toMatchObject({ joinableRoomCount: 5, openRoomCount: 6, region: null, moreOpenRoomCount: 0 });
    // Regions to filter by, busiest first; a room whose region isn't known only counts in All.
    expect((body as any).regions).toEqual([
      { region: "EU", name: "Europe", roomCount: 4, playerCount: 14 },
      { region: "NA", name: "North America", roomCount: 2, playerCount: 7 },
    ]);
    const na = await (await SELF.fetch(`${R}/v1/rooms/lister?region=NA`, { headers: { Origin: ORIGIN } })).json<any>();
    expect(na.rooms.map((r: any) => r.roomCode)).toEqual(["CCCCCC", "BBBBBB"]);
    expect(na).toMatchObject({ region: "NA", playing: { roomCount: 7 }, joinableRoomCount: 5 });
    expect((await SELF.fetch(`${R}/v1/rooms/lister`, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });

  it("keeps a room's name and labels, filters by labels, and drops a name a person hid", async () => {
    const id = await addGame("named");
    const { pass } = await getPass("named");
    const c = await connect("named", "NMDRM2");
    c.ws.send(JSON.stringify({ type: "hello", pass, room: { name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } } }));
    expect((await c.next()).room).toMatchObject({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });
    expect((await rows(id, (r) => r.length === 1))[0]).toMatchObject({ name: "Ana's castle", labels: '{"Mode":"Classic","Map":"Docks"}' });
    const add = (code: string, labels: string) =>
      e.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, labels, created_at_ms, updated_at_ms) VALUES (?, ?, 1, 8, 1, ?, ?, ?)").bind(id, code, labels, Date.now(), Date.now()).run();
    await add("NMDRM3", '{"Mode":"Hardcore"}');
    await add("NMDRM4", '{"Mode":"classic"}');
    const list = (q = "") => SELF.fetch(`${R}/v1/rooms/named${q}`, { headers: { Origin: ORIGIN } }).then((r) => r.json<any>());
    const all = await list();
    expect(all.rooms.find((r: any) => r.roomCode === "NMDRM2")).toMatchObject({ name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } });
    // "Classic" and "classic" are one choice.
    expect(all.filters.map((f: any) => [f.label, f.values.map((v: string) => v.toLowerCase())])).toEqual([["Mode", ["classic", "hardcore"]]]);
    const classic = await list(`?labels=${encodeURIComponent(JSON.stringify({ Mode: "Classic" }))}`);
    expect(classic.rooms.map((r: any) => r.roomCode).sort()).toEqual(["NMDRM2", "NMDRM4"]);
    await e.DB.prepare("UPDATE live_rooms SET is_name_hidden = 1 WHERE room_code = 'NMDRM2'").run();
    expect((await list()).rooms.find((r: any) => r.roomCode === "NMDRM2")).toMatchObject({ name: null, labels: {} });
    // A room renaming itself doesn't bring back a name a person hid.
    c.ws.send(JSON.stringify({ type: "room", name: "Ana's castle 2" }));
    await rows(id, (r) => r.find((x) => x.code === "NMDRM2")?.name === "Ana's castle 2");
    expect((await list()).rooms.find((r: any) => r.roomCode === "NMDRM2").name).toBeNull();
  });

  it("offers games Zaisma's text filter", async () => {
    await addGame("named");
    const check = (text: string) => SELF.fetch(`${R}/v1/filter`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: JSON.stringify({ gameSlug: "named", text }) }).then((r) => r.json<any>());
    expect(await check(" Ana's\u200b castle ")).toEqual({ isAllowed: true, reason: null, text: "Ana's castle" });
    expect(await check("add me on snap")).toEqual({ isAllowed: false, reason: "contact", text: "add me on snap" });
  });

  it("answers pings without waking the room, and drops a connection that stops answering, holding its seat", async () => {
    const id = await addGame("pinger");
    const a = await join("pinger", "PNGRMA");
    const b = await join("pinger", "PNGRMA");
    await until(a, (m) => m.type === "players" && m.players.length === 2);
    await rows(id, (r) => r[0]?.player_count === 2);
    a.ws.send("ping");
    for (let i = 0; i < 40 && !a.pongs.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(a.pongs).toHaveLength(1);

    // b's game went quiet: no ping or message for over 75 seconds (a closed laptop). a pinged just now.
    const stub = e.ROOMS.get(e.ROOMS.idFromName("pinger:PNGRMA"));
    await runInDurableObject(stub, async (_room: Room, state) => {
      for (const ws of state.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att.id === b.player.id) ws.serializeAttachment({ ...att, joinedAtMs: Date.now() - 100_000, seenAtMs: Date.now() - 100_000 });
      }
      await state.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(stub);
    expect(await b.closed).toBe(4003);
    await until(a, (m) => m.type === "players" && m.players.length === 1 && m.players[0].id === a.player.id);
    // Not playing now, but their seat is held for when they reconnect.
    expect((await rows(id, (r) => r[0]?.player_count === 1))[0]).toMatchObject({ player_count: 1, held_seat_count: 1 });
    const back = await connect("pinger", "PNGRMA");
    back.ws.send(JSON.stringify({ type: "hello", pass: b.pass }));
    expect((await back.next()).type).toBe("welcome");
    expect((await rows(id, (r) => r[0]?.player_count === 2))[0]).toMatchObject({ player_count: 2, held_seat_count: 0 });
    a.ws.close(1000);
    back.ws.close(1000);
  });

  it("takes a player who walked away out of the match and out of the counts, and lets them back", async () => {
    const id = await addGame("idler");
    const a = await join("idler", "DLRRMA");
    const b = await join("idler", "DLRRMA");
    await until(a, (m) => m.type === "players" && m.players.length === 2);
    b.ws.send(JSON.stringify({ type: "idle" }));
    expect(await until(b, (m) => m.type === "away")).toEqual({ type: "away", reason: "idle", seatHoldDurationSec: 300 });
    await until(a, (m) => m.type === "players" && m.players.length === 1);
    expect((await rows(id, (r) => r[0]?.player_count === 1))[0]).toMatchObject({ player_count: 1, held_seat_count: 1 });
    const list = await SELF.fetch(`${R}/v1/rooms/idler`, { headers: { Origin: ORIGIN } }).then((r) => r.json<any>());
    expect(list.playing.playerCount).toBe(1);
    expect(list.rooms[0]).toMatchObject({ playerCount: 1, heldSeatCount: 1 });

    b.ws.send(JSON.stringify({ type: "back" }));
    await until(b, (m) => m.type === "welcome");
    expect((await rows(id, (r) => r[0]?.player_count === 2))[0]).toMatchObject({ player_count: 2, held_seat_count: 0 });

    // Out again, and this time the seat runs out: the room's check frees it and closes b's connection.
    b.ws.send(JSON.stringify({ type: "idle" }));
    await until(b, (m) => m.type === "away");
    await rows(id, (r) => r[0]?.held_seat_count === 1);
    const stub = e.ROOMS.get(e.ROOMS.idFromName("idler:DLRRMA"));
    await runInDurableObject(stub, async (room: Room, state) => {
      for (const held of (room as any).core.held.values()) held.untilMs = Date.now() - 1;
      await state.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(stub);
    expect(await b.closed).toBe(4002);
    expect((await rows(id, (r) => r[0]?.held_seat_count === 0))[0]).toMatchObject({ player_count: 1, held_seat_count: 0 });
    const back = await connect("idler", "DLRRMA");
    back.ws.send(JSON.stringify({ type: "hello", pass: b.pass }));
    expect((await back.next()).type).toBe("welcome");

    // A room where everyone walked away has no row: nobody's playing in it.
    a.ws.send(JSON.stringify({ type: "idle" }));
    back.ws.send(JSON.stringify({ type: "idle" }));
    expect(await rows(id, (r) => r.length === 0)).toEqual([]);
    a.ws.close(1000);
    back.ws.close(1000);
  });

  it("leaves the player who just left out of the room list, while lists catch up", async () => {
    const id = await addGame("leaver");
    // Rows the rooms last wrote 20 seconds ago, as a list copy from before the player left would have them.
    const then = Date.now() - 20_000;
    for (const [code, players] of [["LVRRMA", 1], ["LVRRMB", 3]] as const) {
      await e.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 8, 1, 'DE', 'EU', ?, ?)").bind(id, code, players, then, then).run();
    }
    const list = (left = "") => SELF.fetch(`${R}/v1/rooms/leaver${left ? `?left=${left}` : ""}`, { headers: { Origin: ORIGIN } }).then((r) => r.json<any>());
    const all = await list();
    expect(all.playing).toEqual({ playerCount: 4, roomCount: 2, closedRoomCount: 0 });
    expect(all.changedAtMs).toBeUndefined();
    // Joined 25 seconds ago (so the rows count them) and left the room on its own 3 seconds ago: it's gone from their list.
    const alone = await list("LVRRMA.3000.25000");
    expect(alone.rooms.map((r: any) => r.roomCode)).toEqual(["LVRRMB"]);
    expect(alone).toMatchObject({ playing: { playerCount: 3, roomCount: 1, closedRoomCount: 0 }, joinableRoomCount: 1, openRoomCount: 1, regions: [{ region: "EU", roomCount: 1, playerCount: 3 }] });
    expect((await list("LVRRMB.3000.25000")).rooms.find((r: any) => r.roomCode === "LVRRMB").playerCount).toBe(2);
    // Rows from before they joined never counted them, so nothing comes off.
    expect((await list("LVRRMB.3000.10000")).rooms.find((r: any) => r.roomCode === "LVRRMB").playerCount).toBe(3);
    // A row the room wrote as the player went already counts them out; so does a list long after.
    await e.DB.prepare("UPDATE live_rooms SET player_count = 2, updated_at_ms = ? WHERE room_code = 'LVRRMB'").bind(Date.now() - 2_500).run();
    expect((await list("LVRRMB.3000.25000")).rooms.find((r: any) => r.roomCode === "LVRRMB").playerCount).toBe(2);
    expect((await list("LVRRMA.40000.50000")).rooms).toHaveLength(2);
    expect((await list("LVRRMA.3000")).rooms).toHaveLength(2);
    expect((await list("nope")).rooms).toHaveLength(2);
  });

  it("checks in every hour, and a room that stopped without hearing its players go drops off", async () => {
    const id = await addGame("checker");
    const a = await join("checker", "GHJKMN");
    await rows(id, (r) => r.length === 1);
    await e.DB.prepare("UPDATE live_rooms SET updated_at_ms = 1").run();
    const stub = e.ROOMS.get(e.ROOMS.idFromName("checker:GHJKMN"));
    // The room wakes every half a minute to check on its players, and checks in once an hour has passed.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await rows(id))[0].updated_at_ms).toBe(1);
    await runInDurableObject(stub, async (room: Room, state) => {
      (room as any).checkedInAtMs = Date.now() - 3600_000;
      await state.storage.setAlarm(Date.now());
    });
    await runDurableObjectAlarm(stub); // Due now, so it may already have run by itself.
    expect((await rows(id, (r) => r[0]?.updated_at_ms > 1))[0].updated_at_ms).toBeGreaterThan(1);

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
