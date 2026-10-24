import { createExecutionContext, env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import roomsWorker, { gameOrigin, isGameOrigin, signingKey, type Env } from "../../apps/rooms/src/index.ts";
import { configuredRateLimit, countingRateLimiter } from "../rate-limits.ts";
import roomsWranglerText from "../../apps/rooms/wrangler.jsonc?raw";
import { HOSTING_PAUSED_END_MESSAGE, passesAreFriends, canChat, passesHaveBlockBetween, verifyPass } from "@zaisma/game-server";
import { loadSigningKey } from "@zaisma/game-server/internal";
import { acceptFriendInvite, addTesterLink, blockPlayer, blocksAmong, createAccount, createFriendInvite, deleteAccount, friendPlayerIdsOf, friendsAmong, issueRoomKey, MATCH_FINISH_DURATION_SEC, monthStartDateOf, noteQuickJoin, removeFriend, revokeTesterLink, unblockPlayer } from "@zaisma/core";
import type { Room } from "../../apps/rooms/src/room.ts";
import { GameRoomsService } from "../../apps/rooms/src/room-updates.ts";
import { ERROR_TEXT } from "@zaisma/game-server/internal";
import { TRANSCRIPT_GAME_SERVER_SOURCE, playTranscript, type TranscriptDriver } from "../rooms-transcript.ts";

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

/** Answer a probe at once, as the SDK does; a connection the test already closed has nothing to answer. */
function answerProbe(ws: WebSocket, probeNumber: number) {
  try {
    ws.send(JSON.stringify({ type: "probe_answer", probeNumber }));
  } catch {
    // Closed.
  }
}

/** A binary frame from a room, as the SDK reads it. */
function readFrame(frame: Uint8Array) {
  const fromLength = frame[0]!;
  return { type: "bytes", fromPlayerId: fromLength ? new TextDecoder().decode(frame.subarray(1, 1 + fromLength)) : null, bytes: [...frame.subarray(1 + fromLength)] };
}

/** A connected test client that collects what the room sends. */
async function connect(game: string, code: string, origin = ORIGIN, from?: { country: string; continent: string }, answersProbes = true) {
  const res = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: origin, "cf-connecting-ip": `198.51.100.${++address % 250}` }, ...(from ? { cf: from } : {}) });
  if (!res.webSocket) return { res, ws: null as never, inbox: [] as any[], next: async () => null as any, closed: Promise.resolve(0), pongs: [] as number[], probes: [] as any[] };
  const ws = res.webSocket;
  ws.accept();
  // Bytes as an ArrayBuffer, as the SDK takes them.
  ws.binaryType = "arraybuffer";
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  const pongs: number[] = [];
  let closedResolve: (code: number) => void;
  const closed = new Promise<number>((r) => (closedResolve = r));
  // Probes are answered at once, as the SDK does (unless the test says not to), and kept apart with what came before each.
  const probes: { probe: any; afterTypes: string[] }[] = [];
  const types: string[] = [];
  ws.addEventListener("message", (ev) => {
    if (ev.data === "pong") return void pongs.push(Date.now());
    // Bytes come as a binary frame: who they're from (none for the game server), then the bytes.
    const m = typeof ev.data === "string" ? JSON.parse(ev.data) : readFrame(new Uint8Array(ev.data as ArrayBuffer));
    if (m.type === "probe") {
      probes.push({ probe: m, afterTypes: [...types] });
      return answersProbes ? answerProbe(ws, m.probeNumber) : undefined;
    }
    types.push(m.type);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  ws.addEventListener("close", (ev) => closedResolve(ev.code));
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  return { res, ws, inbox, next, closed, pongs, probes };
}

/** The next message a client gets that matches, skipping others. */
async function until(c: { next: () => Promise<any> }, want: (m: any) => boolean): Promise<any> {
  for (;;) {
    const m = await c.next();
    if (want(m)) return m;
  }
}

async function join(game: string, code: string, opts: { listed?: false; from?: { country: string; continent: string }; answersProbes?: false } = {}) {
  const { pass, player } = await getPass(game);
  const c = await connect(game, code, ORIGIN, opts.from, opts.answersProbes !== false);
  c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: { isListed: opts.listed !== false } }));
  const welcome = await c.next();
  expect(welcome.type).toBe("welcome");
  return { ...c, player, pass };
}

describe("rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM tester_links; DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM room_message_types; DELETE FROM room_keys; DELETE FROM domains; DELETE FROM games;");
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

  it("refuses players in a country the game is blocked in, and only there", async () => {
    const id = await addGame("blocked-here");
    const block = { country_code: "GB", review_reason: { code: "country_law_notice", message: "A notice under GB law names this: the poster.", content_rule: null }, blocked_at_ms: 1 };
    await e.DB.prepare("UPDATE games SET country_blocks = ? WHERE id = ?").bind(JSON.stringify([block]), id).run();
    const there = await connect("blocked-here", "ABCDEF", ORIGIN, { country: "GB", continent: "EU" });
    // Told on the socket why it's turned away, since a browser never sees an HTTP status on a WebSocket.
    expect(there.res.status).toBe(101);
    expect(await there.next()).toMatchObject({ type: "error", code: "game_unavailable" });
    expect(await there.closed).toBe(4001);
    const passThere = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: "blocked-here", roomKey: await keyFor("blocked-here") }), cf: { country: "GB" } } as RequestInit);
    expect(passThere.status).toBe(404);
    const elsewhere = await connect("blocked-here", "ABCDEF", ORIGIN, { country: "DE", continent: "EU" });
    expect(elsewhere.res.status).toBe(101);
    elsewhere.ws.close();
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
    const account = await createAccount(e.DB, { id: "supabase-user-1", username: "Night_Owl", ageBand: "18+" });
    const passFor = async (gameSlug: string, gameId: string) => {
      const response = await post("/v1/pass", gameSlug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) });
      expect(response.status).toBe(200);
      return response.json<{ pass: string; player: { id: string; name: string; kind: string } }>();
    };
    const { pass, player } = await passFor("arena", arena);
    expect(player).toEqual({ id: account.player_id, name: "Night_Owl", kind: "account" });
    expect(account.player_id).toMatch(/^player_[a-z0-9]{20}$/);
    // The pass proves who, for which game and until when; the name and the sign-in's own ID stay out of it.
    const claims = JSON.parse(atob(pass.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(Object.keys(claims).sort()).toEqual(["aud", "block_player_tag_ids", "exp", "friend_player_tag_ids", "iat", "iss", "kind", "owned_item_names", "pass_version_number", "player_tag_id", "sub", "who_can_chat"]);
    expect(claims).toMatchObject({ sub: account.player_id, kind: "account", aud: "arena", who_can_chat: "friends", friend_player_tag_ids: [] });
    expect(pass).not.toContain(account.id);
    expect((await passFor("other", other)).player.id).toBe(account.player_id);

    // Rooms show the account's name, and the game server sees its kind.
    const c = await connect("arena", "ACCNTS");
    c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect((await c.next()).me).toEqual({ id: account.player_id, name: "Night_Owl", kind: "account" });
    c.ws.close(1000);
    // A guest beside them is still a guest.
    expect((await getPass("arena")).player.kind).toBe("guest");

    // Once the account is deleted, its passes stop working and its keys give nothing.
    const leftoverKey = await issueRoomKey(e.DB, arena, account.id);
    await deleteAccount(e.DB, account.id);
    const late = await connect("arena", "ACCNTS");
    late.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect(await late.next()).toMatchObject({ type: "error", code: "bad_pass" });
    expect((await post("/v1/pass", "arena", ORIGIN, { roomKey: leftoverKey })).status).toBe(403);
  });

  it("puts the permanent items an account owns in its passes, which the game server sees and other players' games never do", async () => {
    const arena = await addGame("arena");
    const account = await createAccount(e.DB, { id: "supabase-user-owner", username: "Gold_Owl", ageBand: "18+" });
    const nowMs = Date.now();
    const purchase = (id: string, itemName: string, itemKind: string, purchaseStatus: string) =>
      e.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES (?, ?, ?, ?, ?, 'grant', ?, ?, ?)").bind(id, arena, itemName, itemKind, account.player_id, purchaseStatus, nowMs, nowMs);
    await e.DB.batch([
      e.DB.prepare("DELETE FROM purchases WHERE game_id = ?").bind(arena),
      purchase("purchase_ownedcrown01", "gold_crown", "permanent", "completed"),
      // Consumables are delivered, not owned; a refunded item is no longer owned.
      purchase("purchase_ownedrevive1", "revive", "consumable", "completed"),
      purchase("purchase_refundedcape", "spare_cape", "permanent", "refunded"),
    ]);
    const response = await post("/v1/pass", "arena", ORIGIN, { roomKey: await issueRoomKey(e.DB, arena, account.id) });
    const { pass } = await response.json<{ pass: string }>();
    const claims = await verifyPass(pass, [(await signingKey(e)).publicKey], { gameSlug: "arena", issuerUrl: R });
    expect(claims.owned_item_names).toEqual(["gold_crown"]);
    // A guest's pass owns nothing.
    const guestClaims = JSON.parse(atob((await getPass("arena")).pass.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(guestClaims.owned_item_names).toEqual([]);

    // Players' games never hear what anyone owns; the room keeps it for its game server through a sleep.
    const c = await connect("arena", "CRWNS2");
    c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    const welcome = await c.next();
    expect(welcome.me).toEqual({ id: account.player_id, name: "Gold_Owl", kind: "account" });
    expect(welcome.players).toEqual([{ id: account.player_id, name: "Gold_Owl", kind: "account", awayReason: null }]);
    await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName("arena:CRWNS2")), async (_room: Room, state) => {
      expect(await state.storage.get(`ownedItemNames:${account.player_id}`)).toEqual(["gold_crown"]);
    });
    c.ws.close(1000);
    await e.DB.prepare("DELETE FROM purchases WHERE game_id = ?").bind(arena).run();
  });

  it("keeps which accounts are in a room, never guests, for friends' Join", async () => {
    const arena = await addGame("arena");
    const account = await createAccount(e.DB, { id: "supabase-user-seated", username: "Seated_Owl", ageBand: "18+" });
    const { pass } = await (await post("/v1/pass", "arena", ORIGIN, { roomKey: await issueRoomKey(e.DB, arena, account.id) })).json<{ pass: string }>();
    const seated = async () => (await e.DB.prepare("SELECT game_id, room_code, player_id FROM room_players WHERE room_code = 'SEATED'").all()).results;
    const until = async (count: number) => {
      for (let i = 0; i < 50 && (await seated()).length !== count; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const c = await connect("arena", "SEATED");
    c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect((await c.next()).type).toBe("welcome");
    const guest = await connect("arena", "SEATED");
    guest.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: (await getPass("arena")).pass }));
    expect((await guest.next()).type).toBe("welcome");
    await until(1);
    expect(await seated()).toEqual([{ game_id: arena, room_code: "SEATED", player_id: account.player_id }]);
    // Gone as soon as they leave, while the guest plays on.
    c.ws.close(1000);
    await until(0);
    expect(await seated()).toEqual([]);
    guest.ws.close(1000);
  });

  it("says in the pass who an account can chat with, never its age, and canChat follows it", async () => {
    const arena = await addGame("arena");
    const other = await addGame("other");
    const accountFor = (id: string, ageBand: "13-15" | "16-17" | "18+", socialMode: "solo_focused" | "friends_focused" | "open_and_social") => createAccount(e.DB, { id, username: id, ageBand, socialMode });
    const claimsOf = async (account: { id: string }, gameSlug = "arena", gameId = arena) => {
      const { pass } = await (await post("/v1/pass", gameSlug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) })).json<{ pass: string }>();
      return verifyPass(pass, [(await signingKey(e)).publicKey], { gameSlug: gameSlug, issuerUrl: e.ISSUER });
    };
    const teen = await claimsOf(await accountFor("teen-open-1", "16-17", "open_and_social"));
    const teenToo = await claimsOf(await accountFor("teen-open-2", "16-17", "open_and_social"));
    const adult = await claimsOf(await accountFor("adult-open-1", "18+", "open_and_social"));
    const adultToo = await claimsOf(await accountFor("adult-open-2", "18+", "open_and_social"));
    const friendsOnly = await claimsOf(await accountFor("adult-friends", "18+", "friends_focused"));
    const young = await claimsOf(await accountFor("young-solo", "13-15", "solo_focused"));
    const guest = await verifyPass((await getPass("arena")).pass, [(await signingKey(e)).publicKey], { gameSlug: "arena", issuerUrl: e.ISSUER });

    // Opaque groups: the same within a band group and a game, never naming an age.
    expect(teen.chat_group_id).toMatch(/^chat_group_[a-f0-9]{20}$/);
    expect(teen.chat_group_id).toBe(teenToo.chat_group_id);
    expect(adult.chat_group_id).toBe(adultToo.chat_group_id);
    expect(teen.chat_group_id).not.toBe(adult.chat_group_id);
    expect(JSON.stringify([teen, adult, young])).not.toMatch(/13-15|16-17|18\+/);
    // Another game gets other groups, so groups can't be matched across games.
    expect((await claimsOf({ id: "teen-open-1" }, "other", other)).chat_group_id).not.toBe(teen.chat_group_id);
    // Only chat with anyone carries a group; guests carry no chat setting at all.
    expect(teen).toMatchObject({ who_can_chat: "anyone" });
    expect(friendsOnly).toMatchObject({ who_can_chat: "friends" });
    expect(friendsOnly.chat_group_id).toBeUndefined();
    expect(young).toMatchObject({ who_can_chat: "nobody" });
    expect(guest.who_can_chat).toBeUndefined();

    expect(canChat(teen, teenToo)).toBe(true);
    expect(canChat(adult, adultToo)).toBe(true);
    expect(canChat(teen, adult)).toBe(false);
    expect(canChat(adult, friendsOnly)).toBe(false);
    expect(canChat(young, teen)).toBe(false);
    expect(canChat(guest, adult)).toBe(false);
    expect(canChat(adult, adult)).toBe(false);
    expect(guest.friend_player_tag_ids).toBeUndefined();

    // A row past its band's limits (only a bug could write one) still goes out within them.
    await e.DB.prepare("UPDATE accounts SET who_can_chat = 'anyone' WHERE id = 'young-solo'").run();
    const forced = await claimsOf({ id: "young-solo" });
    expect(forced).toMatchObject({ who_can_chat: "friends" });
    expect(forced.chat_group_id).toBeUndefined();
  });

  it("puts an account's friends in its passes as opaque tags, so friends chat and strangers don't", async () => {
    const arena = await addGame("arena");
    const ana = await createAccount(e.DB, { id: "friend-ana", username: "Ana", ageBand: "18+", socialMode: "friends_focused" });
    const ben = await createAccount(e.DB, { id: "friend-ben", username: "Ben", ageBand: "13-15", socialMode: "friends_focused" });
    const stranger = await createAccount(e.DB, { id: "friend-stranger", username: "Cy", ageBand: "18+", socialMode: "friends_focused" });
    const claimsOf = async (account: { id: string }) => {
      const { pass } = await (await post("/v1/pass", "arena", ORIGIN, { roomKey: await issueRoomKey(e.DB, arena, account.id) })).json<{ pass: string }>();
      return verifyPass(pass, [(await signingKey(e)).publicKey], { gameSlug: "arena", issuerUrl: e.ISSUER });
    };
    const made = await createFriendInvite(e.DB, ana.id);
    if (!("invite" in made)) throw new Error("no invite");
    expect(await acceptFriendInvite(e.DB, ben.id, made.invite.invite_code)).toMatchObject({ friend: { player_id: ana.player_id, name: "Ana" } });

    const [anaClaims, benClaims, strangerClaims] = [await claimsOf(ana), await claimsOf(ben), await claimsOf(stranger)];
    // Games see what the public sees: tags that match the friends' own, never their player IDs.
    expect(anaClaims.friend_player_tag_ids).toEqual([benClaims.player_tag_id]);
    expect(benClaims.friend_player_tag_ids).toEqual([anaClaims.player_tag_id]);
    expect(JSON.stringify(anaClaims)).not.toContain(ben.player_id);
    expect(passesAreFriends(anaClaims, benClaims)).toBe(true);
    expect(passesAreFriends(anaClaims, strangerClaims)).toBe(false);
    expect(canChat(anaClaims, benClaims)).toBe(true);
    expect(canChat(anaClaims, strangerClaims)).toBe(false);

    // Removed on one side is removed on both, from the next pass on.
    await removeFriend(e.DB, ben.id, ana.player_id);
    expect((await claimsOf(ana)).friend_player_tag_ids).toEqual([]);
    expect(canChat(await claimsOf(ana), benClaims)).toBe(false);
  });

  it("gives a game the player's friends playing it, with their room when they could join, and tells it which room on its own servers they're in", async () => {
    const arena = await addGame("arena");
    const other = await addGame("other");
    await e.DB.prepare(`UPDATE games SET own_server_urls = '["wss://play.example.com"]' WHERE id = ?`).bind(arena).run();
    const accountFor = (id: string) => createAccount(e.DB, { id, username: id, ageBand: "18+", socialMode: "friends_focused" });
    const [ana, ben, cy, dee, eve, fay] = [await accountFor("ingame_ana"), await accountFor("ingame_ben"), await accountFor("ingame_cy"), await accountFor("ingame_dee"), await accountFor("ingame_eve"), await accountFor("ingame_fay")];
    for (const friend of [ben, cy, dee, eve]) {
      const made = await createFriendInvite(e.DB, ana.id);
      if (!("invite" in made)) throw new Error("no invite");
      await acceptFriendInvite(e.DB, friend.id, made.invite.invite_code);
    }
    const passOf = async (account: { id: string }, gameSlug = "arena", gameId = arena) => (await (await post("/v1/pass", gameSlug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) })).json<{ pass: string }>()).pass;
    const friendsOf = async (pass: string, gameSlug = "arena") => post("/v1/friends", gameSlug, ORIGIN, { pass });
    const nowMs = Date.now();
    // Ben is in a Zaisma room of Arena; Cy plays the other game; Dee hides what she plays; Eve pressed Play on Arena but isn't in a room; Fay is no friend.
    const seat = (account: { player_id: string }, gameId: string, roomCode: string) =>
      e.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").bind(gameId, roomCode, account.player_id, nowMs, nowMs).run();
    await seat(ben, arena, "FRNDAA");
    await e.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES (?, 'FRNDAA', 2, 8, 1, ?, ?)").bind(arena, nowMs, nowMs).run();
    await seat(cy, other, "FRNDCC");
    await seat(dee, arena, "FRNDAA");
    await e.DB.prepare("UPDATE accounts SET who_sees_playing_now = 'nobody' WHERE id = ?").bind(dee.id).run();
    await e.DB.prepare("INSERT INTO presences (account_id, seen_at_ms, game_id, game_seen_at_ms) VALUES (?, ?, ?, ?)").bind(eve.id, nowMs, arena, nowMs).run();
    await seat(fay, arena, "FRNDAA");

    const answer = await friendsOf(await passOf(ana));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    // Only friends playing this game, never who's online or what else friends play.
    expect(await answer.json()).toEqual({
      friends: [
        { player_id: ben.player_id, username: "ingame_ben", room_code: "FRNDAA", server_url: null, join_refusal: null },
        { player_id: eve.player_id, username: "ingame_eve", room_code: null, server_url: null, join_refusal: "friend_not_in_room" },
      ],
    });
    // A full room, or a friend who doesn't take joins, gives the reason instead of the room.
    await e.DB.prepare("UPDATE live_rooms SET player_count = 8 WHERE room_code = 'FRNDAA'").run();
    expect((await (await friendsOf(await passOf(ana))).json<{ friends: unknown[] }>()).friends[0]).toMatchObject({ room_code: null, join_refusal: "room_full" });
    await e.DB.prepare("UPDATE accounts SET who_can_join = 'nobody' WHERE id = ?").bind(ben.id).run();
    expect((await (await friendsOf(await passOf(ana))).json<{ friends: unknown[] }>()).friends[0]).toMatchObject({ room_code: null, join_refusal: "friend_not_taking_joins" });
    await e.DB.prepare("UPDATE accounts SET who_can_join = 'friends' WHERE id = ?").bind(ben.id).run();
    // The game's switches: a private room, then Join off for the whole game, which goes first.
    const benNow = async () => (await (await friendsOf(await passOf(ana))).json<{ friends: unknown[] }>()).friends[0];
    await e.DB.prepare("UPDATE live_rooms SET player_count = 2, friend_joins_enabled = 0 WHERE room_code = 'FRNDAA'").run();
    expect(await benNow()).toMatchObject({ room_code: null, join_refusal: "private_room" });
    await e.DB.prepare("UPDATE games SET friend_joins_enabled = 0 WHERE id = ?").bind(arena).run();
    expect(await benNow()).toMatchObject({ room_code: null, join_refusal: "game_not_taking_joins" });
    await e.DB.prepare("UPDATE games SET friend_joins_enabled = 1 WHERE id = ?").bind(arena).run();
    await e.DB.prepare("UPDATE live_rooms SET friend_joins_enabled = 1 WHERE room_code = 'FRNDAA'").run();
    expect(await benNow()).toMatchObject({ room_code: "FRNDAA", join_refusal: null });
    // The other game sees Cy, and nobody from Arena.
    expect((await (await friendsOf(await passOf(ana, "other", other), "other")).json<{ friends: { username: string }[] }>()).friends.map((friend) => friend.username)).toEqual(["ingame_cy"]);
    // Guests have no friends; a pass for another game, or none, is refused.
    expect(await (await friendsOf((await getPass("arena")).pass)).json()).toMatchObject({ error: { code: "account_needed" } });
    expect((await friendsOf(await passOf(ana, "other", other))).status).toBe(401);
    expect((await post("/v1/friends", "arena", "https://evil.example")).status).toBe(403);

    // Eve's game plays on its own server, and says so: her Join now goes there.
    const setRoom = async (body: Record<string, unknown>) => post("/v1/friends/room", "arena", ORIGIN, { pass: await passOf(eve), ...body });
    expect(await (await setRoom({ serverUrl: "wss://elsewhere.example.com", roomCode: "WNRMAA" })).json()).toMatchObject({ error: { code: "unlisted_server" } });
    expect(await (await setRoom({ serverUrl: "ws://play.example.com", roomCode: "WNRMAA" })).json()).toMatchObject({ error: { code: "bad_server_url" } });
    expect(await (await setRoom({ serverUrl: "wss://play.example.com", roomCode: "nope" })).json()).toMatchObject({ error: { code: "bad_room_code" } });
    expect((await setRoom({ serverUrl: "wss://play.example.com/", roomCode: "wnrmaa" })).status).toBe(200);
    const eveNow = async () => (await (await friendsOf(await passOf(ana))).json<{ friends: { username: string }[] }>()).friends.find((friend) => friend.username === "ingame_eve");
    expect(await eveNow()).toEqual({ player_id: eve.player_id, username: "ingame_eve", room_code: "WNRMAA", server_url: "wss://play.example.com", join_refusal: null });
    // Her game turns Join off for that room, and on again: only false turns it off.
    await setRoom({ serverUrl: "wss://play.example.com", roomCode: "WNRMAA", friendJoinsEnabled: false });
    expect(await eveNow()).toMatchObject({ room_code: null, server_url: null, join_refusal: "private_room" });
    await setRoom({ serverUrl: "wss://play.example.com", roomCode: "WNRMAA" });
    expect(await eveNow()).toMatchObject({ room_code: "WNRMAA", join_refusal: null });
    // A move to another room replaces it; leaving takes it away.
    await setRoom({ serverUrl: "wss://play.example.com", roomCode: "WNRMAB" });
    expect(await e.DB.prepare("SELECT room_code FROM room_players WHERE player_id = ?").bind(eve.player_id).all()).toMatchObject({ results: [{ room_code: "WNRMAB" }] });
    // A page that stopped saying it for 5 minutes no longer counts.
    await e.DB.prepare("UPDATE room_players SET updated_at_ms = ? WHERE player_id = ?").bind(nowMs - 6 * 60_000, eve.player_id).run();
    expect(await eveNow()).toMatchObject({ room_code: null, join_refusal: "friend_not_in_room" });
    expect((await setRoom({ serverUrl: null, roomCode: null })).status).toBe(200);
    expect(await e.DB.prepare("SELECT COUNT(*) AS row_count FROM room_players WHERE player_id = ?").bind(eve.player_id).first("row_count")).toBe(0);

    // A Zaisma room asks which of the players it remembers are a joining player's friends, for room.areFriends.
    expect(await friendsAmong(e.DB, ana.player_id, [ben.player_id, fay.player_id, ana.player_id])).toEqual([ben.player_id]);
  });

  it("puts blocks in passes as opaque tags both ways, walls players off in rooms, and quickJoin passes over rooms with them", async () => {
    const arena = await addGame("arena");
    const other = await addGame("other");
    const kit = await createAccount(e.DB, { id: "block-kit", username: "Kit_Blocks", ageBand: "18+", socialMode: "friends_focused" });
    const mia = await createAccount(e.DB, { id: "block-mia", username: "Mia_Blocked", ageBand: "18+", socialMode: "friends_focused" });
    const cy = await createAccount(e.DB, { id: "block-cy", username: "Cy_Bystander", ageBand: "18+", socialMode: "friends_focused" });
    const made = await createFriendInvite(e.DB, kit.id);
    if (!("invite" in made)) throw new Error("no invite");
    await acceptFriendInvite(e.DB, mia.id, made.invite.invite_code);
    // Kit blocks Mia: they're no longer friends, on both sides.
    expect(await blockPlayer(e.DB, kit.id, mia.player_id)).toMatchObject({ blocked: { player_id: mia.player_id, name: "Mia_Blocked" } });
    expect(await friendPlayerIdsOf(e.DB, kit.id)).toEqual([]);
    expect(await friendPlayerIdsOf(e.DB, mia.id)).toEqual([]);

    const passOf = async (account: { id: string }, gameSlug = "arena", gameId = arena) => (await (await post("/v1/pass", gameSlug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) })).json<{ pass: string }>()).pass;
    const claimsOf = async (account: { id: string }, gameSlug = "arena", gameId = arena) => verifyPass(await passOf(account, gameSlug, gameId), [(await signingKey(e)).publicKey], { gameSlug: gameSlug, issuerUrl: e.ISSUER });
    const [kitClaims, miaClaims, cyClaims] = [await claimsOf(kit), await claimsOf(mia), await claimsOf(cy)];
    expect(kitClaims.player_tag_id).toMatch(/^player_tag_[a-f0-9]{20}$/);
    // Both ways, so neither pass says who made it, and no player IDs in sight.
    expect(kitClaims.block_player_tag_ids).toEqual([miaClaims.player_tag_id]);
    expect(miaClaims.block_player_tag_ids).toEqual([kitClaims.player_tag_id]);
    expect(cyClaims.block_player_tag_ids).toEqual([]);
    expect(JSON.stringify(kitClaims)).not.toContain(mia.player_id);
    expect(passesHaveBlockBetween(kitClaims, miaClaims)).toBe(true);
    expect(passesHaveBlockBetween(kitClaims, cyClaims)).toBe(false);
    expect(canChat(kitClaims, miaClaims)).toBe(false);
    // Another game gets other tags, so they can't be matched across games.
    expect((await claimsOf(kit, "other", other)).player_tag_id).not.toBe(kitClaims.player_tag_id);

    const enter = async (account: { id: string }, roomCode: string, hello: Record<string, unknown> = {}) => {
      const c = await connect("arena", roomCode);
      c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: await passOf(account), ...hello }));
      return { ...c, first: await c.next() };
    };
    // The wall goes up both ways as Mia joins, with neither game saying a thing; Cy hears nothing of it.
    const kitIn = await enter(kit, "WALLED");
    const cyIn = await enter(cy, "WALLED");
    const miaIn = await enter(mia, "WALLED");
    expect(miaIn.first.type).toBe("welcome");
    expect(await until(miaIn, (m) => m.type === "blocks")).toEqual({ type: "blocks", playerIds: [kit.player_id] });
    expect(await until(kitIn, (m) => m.type === "blocks")).toEqual({ type: "blocks", playerIds: [mia.player_id] });
    expect(await until(cyIn, (m) => m.type === "players" && m.players.length === 3)).toBeTruthy();
    expect(cyIn.inbox.some((m) => m.type === "blocks")).toBe(false);

    // quickJoin's first try is turned away from a room with someone the player blocked, before anyone hears of them.
    kitIn.ws.close(1000);
    await until(miaIn, (m) => m.type === "players" && m.players.length === 2);
    expect((await enter(kit, "WALLED", { avoidBlockedPlayers: true })).first).toMatchObject({ type: "error", code: "blocked_player_here" });
    // When nothing else fits, it joins anyway, with the wall still up.
    const kitBack = await enter(kit, "WALLED");
    expect(kitBack.first.type).toBe("welcome");
    expect(await until(kitBack, (m) => m.type === "blocks")).toEqual({ type: "blocks", playerIds: [mia.player_id] });
    // Being blocked never turns anyone away: Mia didn't block Kit.
    const miaAgain = await enter(mia, "WALLED", { avoidBlockedPlayers: true });
    expect(miaAgain.first.type).toBe("welcome");

    // A full room's worth of players is one lookup, within D1's 100 values a query.
    const crowd = [...Array.from({ length: 63 }, (_, i) => `player_crowd${i}`), mia.player_id];
    expect(await blocksAmong(e.DB, kit.player_id, crowd)).toEqual([{ blocker_player_id: kit.player_id, blocked_player_id: mia.player_id }]);
    expect(await blocksAmong(e.DB, mia.player_id, [kit.player_id])).toEqual([{ blocker_player_id: kit.player_id, blocked_player_id: mia.player_id }]);

    // Unblocked: Mia's next join finds the block gone, and Kit's game hears the wall is down.
    await unblockPlayer(e.DB, kit.id, mia.player_id);
    const miaLast = await enter(mia, "WALLED");
    expect(miaLast.first.type).toBe("welcome");
    expect(await until(kitBack, (m) => m.type === "blocks")).toEqual({ type: "blocks", playerIds: [] });
    expect((await claimsOf(kit)).block_player_tag_ids).toEqual([]);
  });

  it("gives guests no passes for a game that needs accounts, and rooms turn away guest passes made before", async () => {
    const arena = await addGame("arena");
    const account = await createAccount(e.DB, { id: "supabase-user-3", username: "Tall_Pine", ageBand: "18+" });
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
    late.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: earlier.pass }));
    expect(await late.next()).toMatchObject({ type: "error", code: "account_needed" });
    // Guests welcome again: passes as before.
    await e.DB.prepare("UPDATE games SET account_requirement = 'none' WHERE id = ?").bind(arena).run();
    expect((await getPass("arena")).player.kind).toBe("guest");
  });

  it("gives younger accounts no passes for a game for older players, and removes them when the age rises", async () => {
    const grown = await addGame("grown");
    const teen = await createAccount(e.DB, { id: "supabase-teen-age", username: "Quiet_Comet", ageBand: "13-15" });
    const sixteen = await createAccount(e.DB, { id: "supabase-sixteen-age", username: "Tall_Birch", ageBand: "16-17" });
    const passFor = async (accountId: string) => post("/v1/pass", "grown", ORIGIN, { roomKey: await issueRoomKey(e.DB, grown, accountId) });

    // Everyone 13 and up: the teen plays, and joins a room.
    const teenPass = (await (await passFor(teen.id)).json<{ pass: string }>()).pass;
    const teenInRoom = await connect("grown", "GRWNPL");
    teenInRoom.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: teenPass }));
    expect((await teenInRoom.next()).type).toBe("welcome");

    // 16 and up: no pass for the teen, and the pass never says why beyond the code.
    await e.DB.prepare("UPDATE games SET account_requirement = 'whole_game', minimum_player_age_years = 16 WHERE id = ?").bind(grown).run();
    const refused = await passFor(teen.id);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { code: "game_not_open_to_player", message: "This game isn't open to this account." } });
    const sixteenAnswer = await (await passFor(sixteen.id)).json<{ pass: string; player: { kind: string } }>();
    expect(sixteenAnswer.player.kind).toBe("account");
    // No age in the pass.
    expect(JSON.stringify(await verifyPass(sixteenAnswer.pass, [(await signingKey(e)).publicKey], { gameSlug: "grown", issuerUrl: e.ISSUER }))).not.toMatch(/age|band/);

    // The room checks the game on the next join, and the teen already in it leaves with the same code.
    const sixteenInRoom = await connect("grown", "GRWNPL");
    sixteenInRoom.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: sixteenAnswer.pass }));
    expect((await until(sixteenInRoom, (m) => m.type === "welcome")).type).toBe("welcome");
    expect(await until(teenInRoom, (m) => m.type === "error")).toMatchObject({ type: "error", code: "game_not_open_to_player" });
    // And a pass the teen got before can't get back in.
    const late = await connect("grown", "GRWNPL");
    late.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: teenPass }));
    expect(await late.next()).toMatchObject({ type: "error", code: "game_not_open_to_player" });
  });

  it("looks up an account's public profile by player ID, for any site or server", async () => {
    const account = await createAccount(e.DB, { id: "supabase-user-2", username: "Quiet_Heron", ageBand: "16-17" });
    const lookUp = (playerId: string) => SELF.fetch(`${R}/v1/players/${playerId}`, { headers: { "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    const found = await lookUp(account.player_id);
    expect(found.status).toBe(200);
    expect(found.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // What a stranger sees: never the email, the age or the sign-in's own ID.
    expect(await found.json()).toEqual({ player: { id: account.player_id, name: "Quiet_Heron", username: "Quiet_Heron", display_name: null, bio: null, link_urls: [], profile_url: "https://zaisma.test/@Quiet_Heron", is_profile_private: true, published_games: [], played_games: [], playing_now: null } });
    const { player: guest } = await (await addGame("arena").then(() => getPass("arena")));
    for (const playerId of [guest.id, "player_nobodyhasthis1", "supabase-user-2"]) {
      const missing = await lookUp(playerId);
      expect(missing.status).toBe(404);
      expect((await missing.json<{ error: { code: string } }>()).error.code).toBe("no_player");
    }
  });

  it("limits how many room connections one address opens in a minute", async () => {
    expect(configuredRateLimit(roomsWranglerText, "CONNECT_LIMIT")).toEqual({ limit: 60, period: 60 });
    // Counted with no clock: Miniflare's own limiter starts again on the clock's minute, which 61 calls can straddle.
    const connectLimit = countingRateLimiter(60);
    // A game that isn't there answers quickly, and still counts toward the limit.
    const open = (address: string) =>
      roomsWorker.fetch(new Request(`${R}/v1/rooms/no-such-game/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": address } }), { ...e, CONNECT_LIMIT: connectLimit });
    /** What a turned-away socket says and how it closes: refusals come on a socket, never as an HTTP status. */
    const refusal = async (res: Response) => {
      expect(res.status).toBe(101);
      const ws = res.webSocket!;
      const said = new Promise<any>((resolve) => ws.addEventListener("message", (ev) => resolve(JSON.parse(ev.data as string)), { once: true }));
      const closeCode = new Promise<number>((resolve) => ws.addEventListener("close", (ev) => resolve(ev.code), { once: true }));
      ws.accept();
      return { said: await said, closeCode: await closeCode };
    };
    for (let i = 0; i < 60; i++) expect(await refusal(await open("203.0.113.9"))).toMatchObject({ said: { type: "error", code: "game_unavailable" }, closeCode: 4001 });
    // Past the limit it says busy, and its close code (1013) has the SDK try again later.
    expect(await refusal(await open("203.0.113.9"))).toMatchObject({ said: { type: "error", code: "busy" }, closeCode: 1013 });
    expect(new Set(connectLimit.keys)).toEqual(new Set(["203.0.113.9"]));
    // Another address has its own count.
    expect(await refusal(await open("203.0.113.10"))).toMatchObject({ said: { code: "game_unavailable" }, closeCode: 4001 });
  });

  it("lets the tester address in for the link it names, with room links back through it", async () => {
    const id = await addGame("hidden-arena");
    const sub = { ...e, GAME_HOST_MODE: "subdomain", GAME_DOMAIN: "zaismausercontent.com" } as Env;
    const link = await addTesterLink(e.DB, id, "Team");
    const at = (host: string, testerId: string | null = link.id) => gameOrigin(sub, "hidden-arena", `https://${host}`, testerId);
    expect(await at("hidden-arena.zaismausercontent.com", null)).toEqual({ page: "/g/hidden-arena" });
    expect(await at("hidden-arena--tester.zaismausercontent.com")).toEqual({ page: `/t/${link.token}`, tester: link.id });
    // Rooms and room lists need the link that's on; other calls only the address.
    expect(await at("hidden-arena--tester.zaismausercontent.com", null)).toBeNull();
    expect(await isGameOrigin(sub, "hidden-arena", "https://hidden-arena--tester.zaismausercontent.com")).toBe(true);
    expect(await at("other--tester.zaismausercontent.com")).toBeNull();
    expect(await at("hidden-arena--tester.evil.example")).toBeNull();
    expect(await at("hidden-arena--preview.zaismausercontent.com")).toBeNull();
    expect(await isGameOrigin(sub, "hidden-arena", "https://hidden-arena--preview.zaismausercontent.com")).toBe(false);
    const other = await addGame("other-arena");
    const theirs = await addTesterLink(e.DB, other, "Team");
    expect(await at("hidden-arena--tester.zaismausercontent.com", theirs.id)).toBeNull();
    await e.DB.prepare("UPDATE tester_links SET ends_at_ms = ? WHERE id = ?").bind(Date.now() - 1, link.id).run();
    expect(await at("hidden-arena--tester.zaismausercontent.com")).toBeNull();
    await e.DB.prepare("UPDATE tester_links SET ends_at_ms = NULL WHERE id = ?").bind(link.id).run();
    await revokeTesterLink(e.DB, id, link.id);
    expect(await at("hidden-arena--tester.zaismausercontent.com")).toBeNull();
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
    tester.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: (await getPass("arena")).pass }));
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

  it("publishes the receipt key at its own address, apart from the pass key, never a private part", async () => {
    const passKeyId = (await signingKey(e)).publicKey.kid;
    const receiptKeyId = (await loadSigningKey(e.RECEIPT_SIGNING_KEY!)).publicKey.kid;
    expect(passKeyId).not.toBe(receiptKeyId);
    const passKeys = await (await SELF.fetch(`${R}/.well-known/jwks.json`)).json<{ keys: { kid: string }[] }>();
    expect(passKeys.keys.map((key) => key.kid)).toEqual([passKeyId]);
    const receiptKeys = await (await SELF.fetch(`${R}/.well-known/receipt-jwks.json`)).json<{ keys: { kid: string }[] }>();
    expect(receiptKeys.keys.map((key) => key.kid)).toEqual([receiptKeyId]);
    for (const key of [...passKeys.keys, ...receiptKeys.keys]) expect(key).not.toHaveProperty("d");
  });

  it("makes room codes only for games with a game server", async () => {
    await addGame("arena");
    await addGame("solo", { server: null });
    const { roomCode } = await (await post("/v1/rooms", "arena")).json<{ roomCode: string }>();
    expect(roomCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    const refused = await post("/v1/rooms", "solo");
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: { code: "zaisma_rooms_not_used" } });
  });

  it("says a game that doesn't use Zaisma rooms has no room list", async () => {
    await addGame("solo-list", { server: null });
    const list = await SELF.fetch(`${R}/v1/rooms/solo-list`, { headers: { Origin: ORIGIN } });
    expect(list.status).toBe(404);
    expect(await list.json()).toMatchObject({ error: { code: "zaisma_rooms_not_used" } });
  });

  it("relays messages between two players and tells everyone who's in", async () => {
    await addGame("arena");
    const a = await join("arena", "ABCDEF");
    const b = await join("arena", "ABCDEF");
    expect((await a.next()).players).toHaveLength(1);
    expect((await a.next()).players.map((p: any) => p.id)).toEqual([a.player.id, b.player.id]);
    await b.next(); // b's player list

    a.ws.send(JSON.stringify({ type: "message", data: { x: 3 } }));
    expect(await b.next()).toEqual({ type: "message", data: { x: 3 }, fromPlayerId: a.player.id });

    b.ws.close(1000);
    expect((await a.next()).players.map((p: any) => p.id)).toEqual([a.player.id]);
  });

  it("lets a player into an empty room while connections with no pass wait to say hello", async () => {
    await addGame("arena");
    // More silent connections than the room has places for players and spectators.
    const silent = [];
    for (let i = 0; i < 30; i++) silent.push(await connect("arena", "HUSH22"));
    expect(silent.map((client) => client.res.status)).toEqual(silent.map(() => 101));
    // The oldest were let go to make way for newer ones, and the room never filled.
    expect(await silent[0]!.closed).toBe(4001);
    const a = await join("arena", "HUSH22");
    expect((await a.next()).players).toHaveLength(1);
    a.ws.close(1000);
    for (const client of silent) client.ws.close(1000);
  });

  it("relays bytes between players, saying whose they are, and wants a hello as text", async () => {
    await addGame("arena");
    const a = await join("arena", "BYTES2");
    const b = await join("arena", "BYTES2");
    a.ws.send(new Uint8Array([1, 2, 255]));
    expect(await until(b, (m) => m.type === "bytes")).toEqual({ type: "bytes", fromPlayerId: a.player.id, bytes: [1, 2, 255] });
    a.ws.send(new Uint8Array(16 * 1024 + 1));
    expect(await until(a, (m) => m.type === "error")).toMatchObject({ code: "too_big" });

    const { pass } = await getPass("arena");
    const c = await connect("arena", "BYTES2");
    c.ws.send(new TextEncoder().encode(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass })));
    expect(await c.next()).toMatchObject({ type: "error", code: "no_hello" });
  });

  it("probes each player right after welcome", async () => {
    await addGame("arena");
    const a = await join("arena", "PRBWLC");
    for (let i = 0; i < 50 && a.probes.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(a.probes[0]).toMatchObject({ probe: { type: "probe", probeNumber: 1, pingDurationMs: null }, afterTypes: ["welcome"] });
    expect(Math.abs(a.probes[0]!.probe.serverTimeMs - Date.now())).toBeLessThan(5000);
    // Its answer brings another, carrying the ping the room measured.
    expect(typeof a.probes[1]!.probe.pingDurationMs).toBe("number");
    a.ws.close(1000);
  });

  it("drops a player who falls too far behind, with 4003, and the room carries on", async () => {
    await addGame("arena");
    const slow = await join("arena", "BHNDRM", { answersProbes: false });
    const quick = await join("arena", "BHNDRM");
    const big = "x".repeat(15 * 1024);
    // The relay passes quick's messages to slow, who never answers a probe: 2 MB later, slow is dropped.
    let sentCount = 0;
    const closedCode = await Promise.race([
      slow.closed,
      (async () => {
        for (; sentCount < 400; sentCount++) {
          quick.ws.send(JSON.stringify({ type: "message", data: big }));
          await new Promise((r) => setTimeout(r, 25));
        }
        return 0;
      })(),
    ]);
    expect(closedCode).toBe(4003);
    expect(sentCount).toBeGreaterThan(100);
    // slow stays in the match, reconnecting, and the room carries on for quick.
    const players = (await until(quick, (m) => m.type === "players" && m.players.some((p: any) => p.awayReason === "lost"))).players;
    expect(players.map((p: any) => [p.id, p.awayReason])).toEqual([[slow.player.id, "lost"], [quick.player.id, null]]);
    quick.ws.close(1000);
  }, 20_000);

  it("keeps a player whose connection dropped in the match until they're back, or their time runs out", async () => {
    await addGame("arena");
    const a = await join("arena", "DRPRMA");
    const b = await join("arena", "DRPRMA");
    await until(a, (m) => m.type === "players" && m.players.length === 2);
    // b's connection drops (not closed on purpose): a sees them reconnecting.
    b.ws.close(3000);
    const dropped = await until(a, (m) => m.type === "players" && m.players.some((p: any) => p.awayReason === "lost"));
    expect(dropped.players.map((p: any) => [p.id, p.awayReason])).toEqual([[a.player.id, null], [b.player.id, "lost"]]);

    // b's game reconnects with the same pass: they're playing again, and a hears it.
    const back = await connect("arena", "DRPRMA");
    back.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: b.pass }));
    expect(await back.next()).toMatchObject({ type: "welcome", players: [{ id: a.player.id, awayReason: null }, { id: b.player.id, awayReason: null }] });
    await until(a, (m) => m.type === "players" && m.players.every((p: any) => p.awayReason === null));

    // Dropped again, and this time the time runs out: the room's alarm takes them out of the match.
    back.ws.close(3000);
    await until(a, (m) => m.type === "players" && m.players.some((p: any) => p.awayReason === "lost"));
    const stub = e.ROOMS.get(e.ROOMS.idFromName("arena:DRPRMA"));
    await runInDurableObject(stub, async (room: Room) => {
      const core = (room as any).core;
      expect(core.nextReconnectDeadlineMs()).toBeGreaterThan(Date.now() + 25_000);
      for (const id of core.reconnectUntilMs.keys()) core.reconnectUntilMs.set(id, Date.now() - 1);
    });
    await runDurableObjectAlarm(stub);
    expect((await until(a, (m) => m.type === "players" && m.players.length === 1)).players[0].id).toBe(a.player.id);
    a.ws.close(1000);
  });

  it("wakes for players whose connection dropped when nobody else is connected, then empties", async () => {
    await addGame("arena");
    const a = await join("arena", "MPTYRM");
    const b = await join("arena", "MPTYRM");
    await until(a, (m) => m.type === "players" && m.players.length === 2);
    b.ws.close(3000);
    await until(a, (m) => m.type === "players" && m.players.some((p: any) => p.awayReason === "lost"));
    a.ws.close(3000);
    const stub = e.ROOMS.get(e.ROOMS.idFromName("arena:MPTYRM"));
    for (let i = 0; i < 40; i++) {
      const isKept = await runInDurableObject(stub, async (_room: Room, state) => Object.keys((await state.storage.get<any>("room"))?.reconnecting ?? {}).length === 2);
      if (isKept) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await runInDurableObject(stub, async (room: Room, state) => {
      expect(Object.keys((await state.storage.get<any>("room")).reconnecting).sort()).toEqual([a.player.id, b.player.id].sort());
      // The room wakes when the first of them runs out of time, not a day later.
      expect(await state.storage.getAlarm()).toBeLessThanOrEqual(Date.now() + 30_000);
      const core = (room as any).core;
      for (const id of core.reconnectUntilMs.keys()) core.reconnectUntilMs.set(id, Date.now() - 1);
    });
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, async (room: Room, state) => {
      expect((room as any).core.players.size).toBe(0);
      expect((await state.storage.get<any>("room")).reconnecting).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + 3600_000);
    });
  });

  it("needs a valid pass first, from the game's origin", async () => {
    await addGame("arena");
    await addGame("other");
    const wrongOrigin = await connect("arena", "ABCDEF", "https://evil.example");
    expect(wrongOrigin.res.status).toBe(101);
    expect(await wrongOrigin.next()).toMatchObject({ type: "error", code: "bad_origin" });
    expect(await wrongOrigin.closed).toBe(4001);

    const noHello = await connect("arena", "ABCDEF");
    noHello.ws.send(JSON.stringify({ type: "message", data: 1 }));
    expect(await noHello.next()).toMatchObject({ type: "error", code: "no_hello" });

    const { pass } = await getPass("other");
    const wrongGame = await connect("arena", "ABCDEF");
    wrongGame.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect(await wrongGame.next()).toMatchObject({ type: "error", code: "bad_pass" });
  });

  it("a reconnect with the same pass keeps the same player", async () => {
    await addGame("arena");
    const a = await join("arena", "QRSTUV");
    const again = await connect("arena", "QRSTUV");
    again.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: a.pass }));
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
    expect(await a.next()).toEqual({ type: "ended", message: "This game isn't available right now.", endReason: "game_unavailable" });
    expect(await a.closed).toBe(4000);
    const turnedAway = await connect("arena", "HJKLMN");
    expect(turnedAway.res.status).toBe(101);
    expect(await turnedAway.next()).toMatchObject({ type: "error", code: "game_unavailable" });
    expect(await turnedAway.closed).toBe(4001);
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
    expect(row).toMatchObject({ game_id: id, room_count: 1, message_count: 1, inbound_size_bytes: JSON.stringify({ type: "message", data: 1 }).length, game_server_cpu_duration_ms: 0 });
    // Out: the welcome, the player list and the probes, all Zaisma's own.
    expect(row.outbound_message_count).toBeGreaterThanOrEqual(2);
    expect(row.outbound_size_bytes).toBeGreaterThan(100);
    expect(Object.keys(row).sort()).toEqual(["database_read_row_count", "database_size_bytes", "database_written_row_count", "date", "game_id", "game_server_call_count", "game_server_cpu_duration_ms", "game_server_crash_count", "game_server_ended_match_count", "game_server_request_count", "game_server_scheduled_run_count", "game_server_stopped_count", "inbound_size_bytes", "message_count", "outbound_message_count", "outbound_size_bytes", "outside_room_cpu_duration_ms", "relay_credential_count", "relayed_size_bytes", "room_count", "room_play_duration_sec"]);
    const { results: types } = await e.DB.prepare("SELECT message_type, direction, message_count FROM room_message_types WHERE game_id = ? ORDER BY direction, message_type").bind(id).all();
    expect(types).toEqual([
      { message_type: "(none)", direction: "inbound", message_count: 1 },
      { message_type: "(zaisma)", direction: "outbound", message_count: row.outbound_message_count },
    ]);
  });

  it("records at most 10 message types each way, the biggest", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "TYPES2");
    for (let i = 0; i < 14; i++) a.ws.send(JSON.stringify({ type: "message", data: { type: `kind${i}`, padding: "x".repeat(i * 10) } }));
    a.ws.close(1000);
    await a.closed;
    let types: { message_type: string }[] = [];
    for (let i = 0; i < 20 && !types.length; i++) {
      types = (await e.DB.prepare("SELECT message_type FROM room_message_types WHERE game_id = ? AND direction = 'inbound' ORDER BY size_bytes DESC").bind(id).all<{ message_type: string }>()).results;
      if (!types.length) await new Promise((r) => setTimeout(r, 20));
    }
    expect(types.map((type) => type.message_type)).toEqual(Array.from({ length: 10 }, (_, i) => `kind${13 - i}`));
  });

  it("while its game's hosting is paused, opens no new rooms, and a running match takes back only its own players and ends an hour after the pause", async () => {
    const id = await addGame("arena");
    const a = await join("arena", "CAPPDA");
    const b = await join("arena", "CAPPDA");
    const now = new Date();
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    // The site's hosting job paused it 20 minutes ago, so the match has 40 minutes left, like the game's other rooms.
    const pausedAtMs = Date.now() - 20 * 60_000;
    const paused = (monthStartDate: string) => e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms, paused_reason) VALUES (?, ?, 500, ?, 'free_used')").bind(id, monthStartDate, pausedAtMs).run();
    // Last month's pause is over.
    await paused(lastMonthStart);
    expect((await post("/v1/rooms", "arena")).status).toBe(200);
    await paused(monthStartDateOf());

    const made = await post("/v1/rooms", "arena");
    expect(made.status).toBe(403);
    expect(await made.json()).toMatchObject({ error: { code: "hosting_paused" } });
    const fresh = await connect("arena", "NEWRMA");
    fresh.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: (await getPass("arena")).pass }));
    expect(await fresh.next()).toMatchObject({ type: "error", code: "hosting_paused" });
    const reserve = await e.ROOMS.get(e.ROOMS.idFromName("arena:RSRVDA")).fetch("https://room/reserve", {
      method: "POST",
      headers: { "x-game-id": id, "x-game-slug": "arena", "x-game-server": "relay", "x-room-code": "RSRVDA" },
      body: JSON.stringify({ playerIds: [a.player.id], setupData: null }),
    });
    expect(reserve.status).toBe(403);

    // The running match takes no new players, and the one who knocked tells it when it ends: an hour after the pause.
    const stranger = await connect("arena", "CAPPDA");
    stranger.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: (await getPass("arena")).pass }));
    expect(await stranger.next()).toMatchObject({ type: "error", code: "hosting_paused" });
    const ending = await until(a, (m) => m.type === "ending");
    expect(Date.parse(ending.endsAt)).toBe(pausedAtMs + MATCH_FINISH_DURATION_SEC * 1000);
    expect(await until(b, (m) => m.type === "ending")).toEqual(ending);

    // Its own players come back, and hear when it ends; once it empties, still only they do.
    b.ws.close(1000);
    await b.closed;
    const bBack = await connect("arena", "CAPPDA");
    bBack.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: b.pass }));
    expect(await bBack.next()).toMatchObject({ type: "welcome", me: { id: b.player.id }, endsAt: ending.endsAt });
    a.ws.close(1000);
    bBack.ws.close(1000);
    await Promise.all([a.closed, bBack.closed]);
    const another = await connect("arena", "CAPPDA");
    another.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: (await getPass("arena")).pass }));
    expect(await another.next()).toMatchObject({ type: "error", code: "hosting_paused" });
    const back = await connect("arena", "CAPPDA");
    back.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: a.pass }));
    expect(await back.next()).toMatchObject({ type: "welcome", me: { id: a.player.id }, endsAt: ending.endsAt });
    back.ws.close(1000);
  });

  it("finds on its next check that the game's hosting paused, and ends the match an hour after the pause", async () => {
    const id = await addGame("finisher");
    const a = await join("finisher", "FNSHRA");
    const pausedAtMs = Date.now();
    await e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms, paused_reason) VALUES (?, ?, 500, ?, 'free_used')").bind(id, monthStartDateOf(), pausedAtMs).run();
    const stub = e.ROOMS.get(e.ROOMS.idFromName("finisher:FNSHRA"));
    // Checked on a's join, before the pause; the next check, every 5 minutes, is due now.
    await runInDurableObject(stub, async (room: Room, state) => {
      expect(await state.storage.get<number>("hostingCheckedAtMs")).toBeGreaterThan(Date.now() - 60_000);
      (room as any).hostingCheckedAtMs = 0;
      await state.storage.put("hostingCheckedAtMs", 0);
    });
    await runDurableObjectAlarm(stub);
    const ending = await until(a, (m) => m.type === "ending");
    expect(Date.parse(ending.endsAt)).toBe(pausedAtMs + MATCH_FINISH_DURATION_SEC * 1000);
    // Kept for when the room wakes from hibernation, so the hour doesn't start again.
    await runInDurableObject(stub, async (_room: Room, state) => {
      expect((await state.storage.get<{ endsAt?: string }>("room"))?.endsAt).toBe(ending.endsAt);
    });

    // The hour is up: the next check ends the match and tells the players why.
    await runInDurableObject(stub, async (room: Room) => {
      (room as any).core.endsAt = new Date(Date.now() - 1000).toISOString();
    });
    await runDurableObjectAlarm(stub);
    expect(await until(a, (m) => m.type === "ended")).toEqual({ type: "ended", message: HOSTING_PAUSED_END_MESSAGE, endReason: "hosting_paused" });
    await a.closed;
    // The room is over for good, even for its own players.
    const late = await connect("finisher", "FNSHRA");
    late.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: a.pass }));
    expect(await late.next()).toMatchObject({ type: "error", code: "ended" });
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
    c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: p.pass, ...msg }));
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
    expect(stranger.first).toMatchObject({ type: "error", code: "room_closed" });

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

  it("keep a player whose connection dropped through a sleep, and give them the board when they're back", async () => {
    await addGame("four", { server: "four-in-a-row" });
    const a = await join("four", "DRPSLP");
    const b = await join("four", "DRPSLP");
    const stub = e.ROOMS.get(e.ROOMS.idFromName("four:DRPSLP"));
    a.ws.send(JSON.stringify({ type: "message", data: { column: 3 } }));
    await until(b, (m) => m.type === "message" && m.data.board[38] === 1);
    a.ws.close(3000);
    await until(b, (m) => m.type === "players" && m.players.some((p: any) => p.awayReason === "lost"));

    // The room sleeps: it wakes with only the players it has connections for, and its saved room.
    await runInDurableObject(stub, async (room: Room, state) => {
      const saved = await state.storage.get<{ state: unknown }>("saved");
      expect(Object.keys((await state.storage.get<any>("room")).reconnecting)).toEqual([a.player.id]);
      (room as any).core = null;
      (room as any).saved = saved!.state;
    });
    const back = await connect("four", "DRPSLP");
    back.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: a.pass }));
    expect(await back.next()).toMatchObject({ type: "welcome", players: [{ id: b.player.id, awayReason: null }, { id: a.player.id, awayReason: null }] });
    // onBack sends the board as it is, with a still in seat 1.
    const shared = await until(back, (m) => m.type === "message" && m.data.board);
    expect(shared.data.board[38]).toBe(1);
    expect(shared.data.seatPlayerIds).toEqual([a.player.id, b.player.id]);
    await until(b, (m) => m.type === "players" && m.players.every((p: any) => p.awayReason === null));
    back.ws.close(1000);
    b.ws.close(1000);
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

  it("takes every reason a player can pick, the longest included", async () => {
    const id = await addGame("arena");
    // From its own address, so the rate limit stays out of the other tests' way.
    const fromElsewhere = (reason: string) =>
      SELF.fetch(`${R}/v1/report`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "CF-Connecting-IP": "198.51.100.77" }, body: JSON.stringify({ gameSlug: "arena", roomCode: "ABCDEF", playerId: "player_123abc", reason }) });
    expect((await fromElsewhere("following_after_block")).status).toBe(200);
    expect(await e.DB.prepare("SELECT player_reason FROM reports WHERE game_id = ?").bind(id).first("player_reason")).toBe("following_after_block");
    expect((await fromElsewhere("threats_or_private_details")).status).toBe(400);
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
    b.ws.send(JSON.stringify({ type: "room", room: { isOpen: false } }));
    expect(await next(b, "error")).toMatchObject({ code: "not_allowed" });
    a.ws.send(JSON.stringify({ type: "room", room: { isOpen: false } }));
    expect(await next(a, "room")).toEqual({ type: "room", room: { isListed: true, isOpen: false, friendJoinsEnabled: true, name: null, labels: {} }, spectatorCount: 0 });
    expect((await rows(id, (r) => r[0]?.is_open === 0))[0]).toMatchObject({ player_count: 2, is_open: 0 });

    const { pass } = await getPass("party");
    const c = await connect("party", "XYZ234");
    c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect(await c.next()).toMatchObject({ type: "error", code: "room_closed" });
    // b drops out and comes back: they were in the match.
    b.ws.close(1000);
    await b.closed;
    const again = await connect("party", "XYZ234");
    again.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: b.pass }));
    expect((await again.next()).type).toBe("welcome");
  });

  it("keeps a room's Join switch in its row, from its maker and the relay's host, and notes a game's quick joins once a day", async () => {
    const id = await addGame("hideout");
    const { pass } = await getPass("hideout");
    const a = await connect("hideout", "PRVT23");
    // Made private by its first player, and from quickJoin.
    a.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: { friendJoinsEnabled: false }, isQuickJoin: true }));
    expect(await a.next()).toMatchObject({ type: "welcome", room: { friendJoinsEnabled: false } });
    // The room's row is written once the player is in, after the quick join is noted.
    expect((await rows(id, (r) => r.length === 1))[0]).toMatchObject({ room_code: "PRVT23", friend_joins_enabled: 0 });
    const quickJoinedAtMs = await e.DB.prepare("SELECT quick_joined_at_ms FROM games WHERE id = ?").bind(id).first<number>("quick_joined_at_ms");
    expect(quickJoinedAtMs).toBeGreaterThan(Date.now() - 60_000);
    // The host turns Join back on.
    a.ws.send(JSON.stringify({ type: "room", room: { friendJoinsEnabled: true } }));
    expect((await rows(id, (r) => r[0]?.friend_joins_enabled === 1))[0]).toMatchObject({ friend_joins_enabled: 1 });
    // Another quick join the same day doesn't write again.
    await noteQuickJoin(e.DB, id, quickJoinedAtMs! + 3_600_000);
    expect(await e.DB.prepare("SELECT quick_joined_at_ms FROM games WHERE id = ?").bind(id).first("quick_joined_at_ms")).toBe(quickJoinedAtMs);
    await noteQuickJoin(e.DB, id, quickJoinedAtMs! + 25 * 3_600_000);
    expect(await e.DB.prepare("SELECT quick_joined_at_ms FROM games WHERE id = ?").bind(id).first("quick_joined_at_ms")).toBe(quickJoinedAtMs! + 25 * 3_600_000);
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
      spectatorCount: 0,
      maximumSpectatorCount: 0,
      isOpen: true,
      location: { countryCode: "DE", countryName: "Germany", region: "EU" },
      isNear: true,
      name: null,
      labels: {},
      isKept: false,
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
    c.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: { isListed: true, name: "Ana's castle", labels: { Mode: "Classic", Map: "Docks" } } }));
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
    c.ws.send(JSON.stringify({ type: "room", room: { name: "Ana's castle 2" } }));
    await rows(id, (r) => r.find((x) => x.code === "NMDRM2")?.name === "Ana's castle 2");
    expect((await list()).rooms.find((r: any) => r.roomCode === "NMDRM2").name).toBeNull();
  });

  it("offers games Zaisma's chat filter, with swearing flagged for the game", async () => {
    await addGame("named");
    const check = (text: string) => SELF.fetch(`${R}/v1/filter`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: JSON.stringify({ gameSlug: "named", text }) }).then((r) => r.json<any>());
    expect(await check(" Ana's\u200b castle ")).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: false, text: "Ana's castle" });
    expect(await check("add me on snap")).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false, text: "add me on snap" });
    expect(await check("this level is shit")).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: true, text: "this level is shit" });
    // What the rules can't tell goes to the AI; when it can't answer, the message is stopped.
    expect(await check("where are you [ai sexual]")).toMatchObject({ isAllowed: false, reason: "sexual", message: "That can't be sent here." });
    expect(await check("where are you")).toMatchObject({ isAllowed: true, reason: null });
    expect(await check("where are you [ai down]")).toMatchObject({ isAllowed: false, reason: "unchecked", message: "This message couldn't be checked. Try again in a moment." });
    // Line breaks stay in the text to send, and never join the words on either side for the check.
    expect(await check("good game\n\n\n\nsee you")).toMatchObject({ isAllowed: true, text: "good game\n\nsee you" });
    expect(await check("add me on\nsnap")).toMatchObject({ isAllowed: false, reason: "contact_details" });
    // The whole message is checked, up to 2000 characters; a longer one is refused, never cut.
    expect(await check(`${"what a match ".repeat(150)}call me 555 123 4567`)).toMatchObject({ isAllowed: false, reason: "contact_details" });
    expect(await check("a".repeat(2001))).toEqual({ isAllowed: false, reason: "too_long", message: "That message is too long to send.", hasSwearing: false, text: "" });
  });

  it("checks chat for developers' own servers by their players' passes", async () => {
    const id = await addGame("own-chat", { server: null });
    await addGame("elsewhere-chat", { server: null });
    const passFor = async (account: { id: string }, slug = "own-chat", gameId = id) => (await (await post("/v1/pass", slug, ORIGIN, { roomKey: await issueRoomKey(e.DB, gameId, account.id) })).json<{ pass: string }>()).pass;
    const adult = await createAccount(e.DB, { id: "chat-check-adult", username: "chat_check_adult", ageBand: "18+", socialMode: "open_and_social" });
    const teen = await createAccount(e.DB, { id: "chat-check-teen", username: "chat_check_teen", ageBand: "16-17", socialMode: "open_and_social" });
    const otherAdult = await createAccount(e.DB, { id: "chat-check-adult2", username: "chat_check_adult2", ageBand: "18+", socialMode: "open_and_social" });
    const otherTeen = await createAccount(e.DB, { id: "chat-check-teen2", username: "chat_check_teen2", ageBand: "16-17", socialMode: "open_and_social" });
    const chatCheck = (body: Record<string, unknown>) => SELF.fetch(`${R}/v1/chat/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameSlug: "own-chat", recentTexts: [], ...body }) });
    const [adultPass, teenPass, otherAdultPass, otherTeenPass] = [await passFor(adult), await passFor(teen), await passFor(otherAdult), await passFor(otherTeen)];

    // A pass for another game is refused, saying which one.
    const otherGame = await chatCheck({ senderPass: adultPass, receiverPasses: [await passFor(teen, "elsewhere-chat", "gelsewherechat")], text: "gg" });
    expect(otherGame.status).toBe(401);
    expect((await otherGame.json<any>()).error).toMatchObject({ code: "bad_pass", field: "receiverPasses" });
    expect((await (await chatCheck({ senderPass: "nope", receiverPasses: [teenPass], text: "gg" })).json<any>()).error).toMatchObject({ code: "bad_pass", field: "senderPass" });
    expect((await (await chatCheck({ senderPass: adultPass, receiverPasses: "everyone", text: "gg" })).json<any>()).error).toMatchObject({ code: "bad_request", field: "receiverPasses" });

    // Good passes get the filter's answer, with no CORS: it's server to server.
    const answer = await chatCheck({ senderPass: otherTeenPass, receiverPasses: [teenPass], text: "add me on snap" });
    expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    expect(await answer.json()).toEqual({ isAllowed: false, reason: "contact_details", message: "Contact details can't be sent here.", hasSwearing: false });
    expect(await (await chatCheck({ senderPass: adultPass, receiverPasses: [otherAdultPass], text: "nice jump" })).json()).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: false });
    expect(await (await chatCheck({ senderPass: adultPass, receiverPasses: [otherAdultPass], text: "a".repeat(2001) })).json()).toMatchObject({ isAllowed: false, reason: "too_long" });

    // canChat's rule, applied by Zaisma too: an adult and a teen who aren't friends never chat, whatever the
    // text, and one receiver who may not stops the whole message without saying which.
    const notAllowed = { isAllowed: false, reason: "not_allowed_to_chat", message: "Chat isn't open for this message.", hasSwearing: false };
    expect(await (await chatCheck({ senderPass: adultPass, receiverPasses: [teenPass], text: "nice jump" })).json()).toEqual(notAllowed);
    expect(await (await chatCheck({ senderPass: adultPass, receiverPasses: [otherAdultPass, teenPass], text: "nice jump" })).json()).toEqual(notAllowed);

    // An account whose chat is paused chats with nobody in its next pass, so own servers stop it too.
    await e.DB.prepare("UPDATE accounts SET chat_stopped_reason = 'paused_for_repeats', chat_stopped_until_ms = ? WHERE id = ?").bind(Date.now() + 60_000, adult.id).run();
    const paused = await verifyPass(await passFor(adult), [(await signingKey(e)).publicKey], { gameSlug: "own-chat", issuerUrl: e.ISSUER });
    expect(paused.who_can_chat).toBe("nobody");
    expect(await (await chatCheck({ senderPass: await passFor(adult), receiverPasses: [otherAdultPass], text: "nice jump" })).json()).toEqual(notAllowed);
    await e.DB.prepare("UPDATE accounts SET chat_stopped_until_ms = ? WHERE id = ?").bind(Date.now() - 1, adult.id).run();
    expect((await verifyPass(await passFor(adult), [(await signingKey(e)).publicKey], { gameSlug: "own-chat", issuerUrl: e.ISSUER })).who_can_chat).toBe("anyone");
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
    await until(a, (m) => m.type === "players" && m.players.some((p: any) => p.id === b.player.id && p.awayReason === "lost"));
    // Not playing now, but still in the match while they reconnect.
    expect((await rows(id, (r) => r[0]?.player_count === 1))[0]).toMatchObject({ player_count: 1, held_seat_count: 0 });
    const back = await connect("pinger", "PNGRMA");
    back.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: b.pass }));
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
    expect(await until(b, (m) => m.type === "away")).toEqual({ type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
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
    back.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: b.pass }));
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

describe("a real-time room's saved state", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM room_message_types; DELETE FROM room_keys; DELETE FROM live_rooms; DELETE FROM games;");
  });

  it("is written in chunks with one put and read back whole, and not at all past 32 MB, which the game's logs say", async () => {
    await addGame("racer", { server: "arena" });
    const a = await join("racer", "RCRSTV");
    const stub = e.ROOMS.get(e.ROOMS.idFromName("racer:RCRSTV"));
    const result = await runInDurableObject(stub, async (room: Room, state) => {
      const inside = room as any;
      const core = inside.core;
      const printed: string[] = [];
      inside.printed = (lines: { text: string }[]) => printed.push(...lines.map((line) => line.text));
      // 3 MB of state: six chunks of 512 KB of text, under the 2 MB a stored value may be.
      core.state = { ...core.state, track: "x".repeat(3 * 1024 * 1024) };
      await inside.save(true);
      const saved = await state.storage.get<any>("saved");
      // A fresh copy of the room, as after a restart, reads it back whole.
      const restarted = new (room.constructor as any)(state, e);
      await state.blockConcurrencyWhile(async () => {});
      const readBack = restarted.saved;
      // Smaller again: the chunks past the new count go in the same write.
      core.state = { ...core.state, track: "short" };
      await inside.save(true);
      const keysAfter = [...(await state.storage.list({ prefix: "stateChunk:" })).keys()];
      // Past 32 MB: nothing written, one log line, however often it tries.
      core.state = { ...core.state, track: "y".repeat(33 * 1024 * 1024) };
      await inside.save(true);
      await inside.save(true);
      const afterTooBig = await state.storage.get<string>("stateChunk:0");
      inside.stopTicking();
      return { stateChunkCount: saved.stateChunkCount, matchPlayerIds: saved.matchPlayers.map((player: any) => player.id), trackSizeBytes: readBack.track.length, keysAfter, isStillShort: JSON.parse(afterTooBig!).track === "short", printed };
    });
    expect(result).toEqual({
      stateChunkCount: 7,
      matchPlayerIds: [a.player.id],
      trackSizeBytes: 3 * 1024 * 1024,
      keysAfter: ["stateChunk:0"],
      isStillShort: true,
      printed: ["Zaisma: this room's state is over 32 MB, so it isn't saved and a restart starts it fresh."],
    });
    a.ws.close(1000);
  });

  it("is gone once the match ends, so the room never wakes with it", async () => {
    await addGame("finisher", { server: "arena" });
    const a = await join("finisher", "FNSHRS");
    const stub = e.ROOMS.get(e.ROOMS.idFromName("finisher:FNSHRS"));
    const keys = await runInDurableObject(stub, async (room: Room, state) => {
      const inside = room as any;
      await inside.save(true);
      const before = [...(await state.storage.list({ prefix: "stateChunk:" })).keys()];
      inside.core.end("Over");
      await inside.finish();
      return { before, after: [...(await state.storage.list({ prefix: "stateChunk:" })).keys()], saved: await state.storage.get("saved") };
    });
    expect(keys).toEqual({ before: ["stateChunk:0"], after: [], saved: { hasEnded: true } });
    await a.closed;
  });
});

describe("the v1 room contract in Zaisma rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM tester_links; DELETE FROM room_keys; DELETE FROM game_hosting_months; DELETE FROM games;");
  });

  /** What a turned-away socket says and how it closes: refusals come on a socket, never as an HTTP status. */
  const refusal = async (res: Response) => {
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const said = new Promise<any>((resolve) => ws.addEventListener("message", (ev) => resolve(JSON.parse(ev.data as string)), { once: true }));
    const closeCode = new Promise<number>((resolve) => ws.addEventListener("close", (ev) => resolve(ev.code), { once: true }));
    ws.accept();
    return { said: await said, closeCode: await closeCode };
  };

  it("turns away a first message that isn't a hello with no_hello, three ways, and closes with 4001", async () => {
    await addGame("arena");
    const message = await connect("arena", "NHEJLA");
    message.ws.send(JSON.stringify({ type: "message", data: 1 }));
    expect(await message.next()).toEqual({ type: "error", code: "no_hello", message: ERROR_TEXT.no_hello });
    expect(await message.closed).toBe(4001);

    // A hello whose pass isn't a string.
    const numberPass = await connect("arena", "NHEJLA");
    numberPass.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: 12345 }));
    expect(await numberPass.next()).toEqual({ type: "error", code: "no_hello", message: ERROR_TEXT.no_hello });
    expect(await numberPass.closed).toBe(4001);

    // A hello as a binary frame: bytes only come after it.
    const { pass } = await getPass("arena");
    const binary = await connect("arena", "NHEJLA");
    binary.ws.send(new TextEncoder().encode(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass })));
    expect(await binary.next()).toEqual({ type: "error", code: "no_hello", message: ERROR_TEXT.no_hello });
    expect(await binary.closed).toBe(4001);
  });

  it("turns away the player past maximumPlayerCount with room_full and 4001", async () => {
    await addGame("arena");
    // The relay seats 16.
    const players = [];
    for (let seat = 0; seat < 16; seat++) players.push(await join("arena", "FULLRM"));
    const { pass } = await getPass("arena");
    const late = await connect("arena", "FULLRM");
    late.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect(await late.next()).toEqual({ type: "error", code: "room_full", message: ERROR_TEXT.room_full });
    expect(await late.closed).toBe(4001);
    // A seat freed on purpose is free for the newcomer.
    players[0]!.ws.close(1000);
    await players[0]!.closed;
    const again = await connect("arena", "FULLRM");
    again.ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    expect((await again.next()).type).toBe("welcome");
    for (const player of players.slice(1)) player.ws.close(1000);
    again.ws.close(1000);
  });

  it("clears a reserved room nobody joins after 10 minutes, on a fake clock", async () => {
    const id = await addGame("arena");
    const stub = e.ROOMS.get(e.ROOMS.idFromName("arena:RSRVTM"));
    const startMs = Date.now();
    const reserve = await stub.fetch("https://room/reserve", {
      method: "POST",
      headers: { "x-game-id": id, "x-game-slug": "arena", "x-game-server": "relay", "x-room-code": "RSRVTM" },
      body: JSON.stringify({ playerIds: ["player_reservedaaaaaaaaaaa"], setupData: null }),
    });
    expect(reserve.status).toBe(204);
    const kept = () => runInDurableObject(stub, async (_room: Room, state) => ({ size: (await state.storage.list()).size, alarmAtMs: await state.storage.getAlarm() }));
    const reserved = await kept();
    expect(reserved.size).toBeGreaterThan(0);
    expect(reserved.alarmAtMs! - startMs).toBeGreaterThanOrEqual(600_000);
    expect(reserved.alarmAtMs! - startMs).toBeLessThan(600_000 + 5_000);
    // The clock, not the alarm's time, decides: one millisecond short of 10 minutes keeps it, and 10 minutes clears it.
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => void vi.useRealTimers());
    vi.setSystemTime(reserved.alarmAtMs! - 1);
    await runDurableObjectAlarm(stub);
    expect((await kept()).size).toBeGreaterThan(0);
    vi.setSystemTime(reserved.alarmAtMs!);
    await runDurableObjectAlarm(stub);
    expect((await kept()).size).toBe(0);
    vi.useRealTimers();
  });

  it("tells everyone the match ended with endReason game_server_stopped when the game's server keeps failing, and closes with 4000", async () => {
    await addGame("arena");
    const a = await join("arena", "STPPDM");
    const b = await join("arena", "STPPDM");
    await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName("arena:STPPDM")), (room: Room) => void (room as any).broken());
    expect(await until(a, (m) => m.type === "ended")).toEqual({ type: "ended", message: "This game's server stopped working.", endReason: "game_server_stopped" });
    expect(await until(b, (m) => m.type === "ended")).toEqual({ type: "ended", message: "This game's server stopped working.", endReason: "game_server_stopped" });
    expect([await a.closed, await b.closed]).toEqual([4000, 4000]);
  });

  it("answers busy with 1013 when the room's Durable Object answers 429 or 503 or fails, room_full with 4001 for 409, and game_unavailable with 4001 for 404", async () => {
    await addGame("arena");
    const asked = (answer: () => Promise<Response>) =>
      roomsWorker.fetch(new Request(`${R}/v1/rooms/arena/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } }), {
        ...e,
        ROOMS: { idFromName: (name: string) => name, get: () => ({ fetch: answer }) } as never,
      });
    for (const status of [429, 503, 500]) expect(await refusal(await asked(async () => new Response("Try again", { status })))).toEqual({ said: { type: "error", code: "busy", message: ERROR_TEXT.busy }, closeCode: 1013 });
    expect(await refusal(await asked(async () => Promise.reject(new Error("Durable Object limit"))))).toEqual({ said: { type: "error", code: "busy", message: ERROR_TEXT.busy }, closeCode: 1013 });
    expect(await refusal(await asked(async () => new Response("This room is full", { status: 409 })))).toEqual({ said: { type: "error", code: "room_full", message: ERROR_TEXT.room_full }, closeCode: 4001 });
    expect(await refusal(await asked(async () => new Response("Gone", { status: 404 })))).toEqual({ said: { type: "error", code: "game_unavailable", message: ERROR_TEXT.game_unavailable }, closeCode: 4001 });
  });
});

describe("the v1 rooms transcript, in Zaisma rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM tester_links; DELETE FROM room_keys; DELETE FROM game_hosting_months; DELETE FROM games;");
  });

  const SLUG = "transcript";
  const GAME_ID = "gtranscript";

  /** A live game running the transcript's game server as its own, on its first version. */
  async function addVersion(versionId: string) {
    await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, GAME_ID, `games/${versionId}`).run();
    await e.GAMES.put(`games/${versionId}/zaisma-server.js`, TRANSCRIPT_GAME_SERVER_SOURCE);
  }

  it("plays every step the transcript has for Zaisma rooms", async () => {
    await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'vtranscript1', 'own', 'page', 0, 0)").bind(GAME_ID, SLUG, SLUG).run();
    await addVersion("vtranscript1");
    const driver: TranscriptDriver = {
      runtime: "rooms",
      newPlayer: async () => {
        const { pass, player } = await getPass(SLUG);
        return { playerId: player.id, name: player.name, pass };
      },
      connect: async (how, roomCode) => {
        const client = how === "other_site" ? await connect(SLUG, roomCode, "https://evil.example") : how === "unknown_game" ? await connect("no-such-game", roomCode) : await connect(SLUG, roomCode);
        return { send: (data) => client.ws.send(data), next: client.next, closed: client.closed, close: (code) => client.ws.close(code) };
      },
      action: async (action, roomCode) => {
        const stub = e.ROOMS.get(e.ROOMS.idFromName(`${SLUG}:${roomCode}`));
        if (action === "publish_version_now") {
          await addVersion("vtranscript2");
          await e.DB.prepare("UPDATE games SET live_version_id = 'vtranscript2', live_version_match_update_mode = 'now', has_live_version_game_file_changes = 0, live_version_published_at_ms = ? WHERE id = ?").bind(Date.now(), GAME_ID).run();
          // The room is in the game's room table once it has a player, so the rooms Worker finds it.
          for (let tries = 0; tries < 50 && !(await e.DB.prepare("SELECT 1 FROM live_rooms WHERE game_id = ?").bind(GAME_ID).first()); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
          expect(await new GameRoomsService(createExecutionContext(), e).updateMatches({ gameId: GAME_ID, slug: SLUG, versionId: "vtranscript2", hasGameFileChanges: false })).toEqual({ toldRoomCount: 1 });
        } else {
          await runInDurableObject(stub, async (room: Room, state) => {
            (room as any).pendingVersionUpdate.appliesAtMs = Date.now() - 1;
            await state.storage.setAlarm(Date.now());
          });
          await runDurableObjectAlarm(stub);
        }
      },
    };
    const { stepCount, skippedStepCount } = await playTranscript(driver);
    expect(stepCount).toBeGreaterThan(20);
    expect(skippedStepCount).toBe(0);
  });
});
