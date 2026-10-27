import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FRIEND_REQUEST_LIMITS, accountById, areFriends, createAccount, createGame, deleteOldFriendRequests, friendRequestRefusalFor, gameBySlug, hasPlayedWith, sendFriendRequest, setOwnServerRoom, socialModeSettings, waitingFriendRequestsTo, type Account } from "@zaisma/core";
import { pageDataOf } from "../strict-scripts.ts";

// Friend requests in games (docs/DECISIONS.md, "Friend requests in games"): who takes them (the setting, the band,
// People I play with, blocks), the sender who's never told of a turn-down, the limits against someone sending to
// many strangers, and the game page's calls behind Add friend, its card and /friends.

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";
const realFetch = globalThis.fetch;
const DAY_MS = 86400_000;
let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;
let ipCount = 0;

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The session cookie of a signed-in account, as Supabase would sign it. */
async function sessionCookie(accountId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "requests-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

/** A call from zaisma.com's own page, as an account (or nobody). */
async function call(accountId: string | null, path: string, init: { method?: string; body?: unknown; form?: boolean; origin?: string } = {}) {
  const isPost = (init.method ?? (init.body !== undefined || init.form ? "POST" : "GET")) === "POST";
  const response = await SELF.fetch(`${SITE}${path}`, {
    method: isPost ? "POST" : "GET",
    redirect: "manual",
    headers: {
      "cf-connecting-ip": `10.7.${Math.floor(ipCount / 250) % 250}.${ipCount++ % 250}`,
      ...(accountId ? { cookie: `${await sessionCookie(accountId)}; __Host-zaisma_in=1` } : {}),
      ...(isPost ? { origin: init.origin ?? SITE } : {}),
      ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.form ? "" : init.body !== undefined ? JSON.stringify(init.body) : isPost ? "" : undefined,
  });
  const text = await response.text();
  let answer: any = null;
  try {
    answer = JSON.parse(text);
  } catch {
    answer = text;
  }
  return { status: response.status, answer, location: response.headers.get("location") };
}

const account = async (id: string) => (await accountById(env.DB, id))!;
const playerIdOf = async (id: string) => (await account(id)).player_id;
/** Put a player in a Zaisma room now, as the room writes it. */
const seat = async (id: string, roomCode: string, gameId = "game_raid") =>
  env.DB.prepare("INSERT OR REPLACE INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").bind(gameId, roomCode, await playerIdOf(id), Date.now(), Date.now()).run();
const setRequests = (id: string, choice: "nobody" | "played_with" | "anyone") => env.DB.prepare("UPDATE accounts SET who_can_send_friend_requests = ? WHERE id = ?").bind(choice, id).run();

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "requests-test-key", alg: "ES256" }] });
    return realFetch(input, init);
  });
  await env.DB.exec("DELETE FROM friend_requests; DELETE FROM friendships; DELETE FROM blocks; DELETE FROM room_players; DELETE FROM room_visits; DELETE FROM profile_reports; DELETE FROM presences; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM accounts;");
  // Every 16+ account starts on friends-focused, which takes friend requests from anyone now.
  await createAccount(env.DB, { id: "alex", username: "Alex_Ray", ageBand: "18+" });
  await createAccount(env.DB, { id: "mia", username: "Mia_Stone", ageBand: "18+" });
  await createAccount(env.DB, { id: "sam", username: "Sam_Teen", ageBand: "16-17" });
  await createAccount(env.DB, { id: "lena", username: "Lena_Fox", ageBand: "13-15" });
  await createAccount(env.DB, { id: "noah", username: "Noah_Pike", ageBand: "13-15" });
  await createGame(env.DB, { slug: "hollow-reach", title: "Hollow Reach", description: "" });
});

afterEach(() => vi.unstubAllGlobals());

describe("who takes friend requests", () => {
  it("starts friends-focused on Anyone at 16 and up, and every preset on Invites only at 13–15", () => {
    expect(socialModeSettings("friends_focused", "18+").who_can_send_friend_requests).toBe("anyone");
    expect(socialModeSettings("friends_focused", "16-17").who_can_send_friend_requests).toBe("anyone");
    expect(socialModeSettings("solo_focused", "18+").who_can_send_friend_requests).toBe("nobody");
    expect(socialModeSettings("friends_focused", "13-15").who_can_send_friend_requests).toBe("nobody");
    expect(socialModeSettings("solo_focused", "13-15").who_can_send_friend_requests).toBe("nobody");
  });

  it("follows the setting, stays in the band, and stops at a block", async () => {
    const alex = await account("alex");
    expect(await friendRequestRefusalFor(env.DB, alex, await playerIdOf("mia"))).toBeNull();
    // An adult and a 16-year-old never see Add friend on each other.
    expect(await friendRequestRefusalFor(env.DB, alex, await playerIdOf("sam"))).toBe("not_taking_requests");
    expect(await friendRequestRefusalFor(env.DB, await account("sam"), await playerIdOf("alex"))).toBe("not_taking_requests");
    await setRequests("mia", "nobody");
    expect(await friendRequestRefusalFor(env.DB, alex, await playerIdOf("mia"))).toBe("not_taking_requests");
    await setRequests("mia", "anyone");
    await env.DB.prepare("INSERT INTO blocks (account_id, blocked_account_id, created_at_ms) VALUES ('mia', 'alex', ?)").bind(Date.now()).run();
    expect(await friendRequestRefusalFor(env.DB, alex, await playerIdOf("mia"))).toBe("not_taking_requests");
    expect(await friendRequestRefusalFor(env.DB, null, await playerIdOf("mia"))).toBe("account_needed");
    expect(await friendRequestRefusalFor(env.DB, alex, alex.player_id)).toBe("own_player");
    expect(await friendRequestRefusalFor(env.DB, alex, "player_nobody")).toBe("not_an_account");
  });

  it("lets 13–15 take them only from players they play with, once they turn it on, and never past their band", async () => {
    const noah = await account("noah");
    expect(await friendRequestRefusalFor(env.DB, noah, await playerIdOf("lena"))).toBe("not_taking_requests");
    await setRequests("lena", "played_with");
    expect(await friendRequestRefusalFor(env.DB, noah, await playerIdOf("lena"))).toBe("not_taking_requests");
    await seat("noah", "RAID01");
    await seat("lena", "RAID01");
    expect(await friendRequestRefusalFor(env.DB, noah, await playerIdOf("lena"))).toBeNull();
    // Anyone stored for a 13–15 account counts as People I play with: the band's limit holds wherever settings are used.
    await setRequests("lena", "anyone");
    await env.DB.exec("DELETE FROM room_players");
    expect(await friendRequestRefusalFor(env.DB, noah, await playerIdOf("lena"))).toBe("not_taking_requests");
  });

  it("counts the same room now, and for an hour after one of them left, on Zaisma's rooms and a game's own", async () => {
    const [alexPlayer, miaPlayer] = [await playerIdOf("alex"), await playerIdOf("mia")];
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(false);
    await seat("alex", "RAID01");
    await seat("mia", "RAID02");
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(false);
    await seat("mia", "RAID01");
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(true);
    // Mia left a while ago: her visit counts for an hour.
    await env.DB.exec("DELETE FROM room_players");
    const visit = (playerId: string, atMs: number, serverUrl: string | null = null) =>
      env.DB.prepare("INSERT OR REPLACE INTO room_visits (game_id, room_code, server_url, player_id, last_seen_at_ms) VALUES ('game_raid', 'RAID01', ?, ?, ?)").bind(serverUrl, playerId, atMs).run();
    await visit(alexPlayer, Date.now() - 10 * 60_000);
    await visit(miaPlayer, Date.now() - 20 * 60_000);
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(true);
    await visit(miaPlayer, Date.now() - 2 * 3600_000);
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(false);
    await deleteOldFriendRequests(env.DB);
    expect(await env.DB.prepare("SELECT COUNT(*) AS visit_count FROM room_visits").first("visit_count")).toBe(1);
    // A game's own server: the room it said, and the one it left becomes a visit.
    await env.DB.exec("DELETE FROM room_visits");
    await setOwnServerRoom(env.DB, "game_raid", alexPlayer, { server_url: "wss://play.example.com", room_code: "LOBBY1", friend_joins_enabled: true });
    await setOwnServerRoom(env.DB, "game_raid", miaPlayer, { server_url: "wss://play.example.com", room_code: "LOBBY1", friend_joins_enabled: true });
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(true);
    await setOwnServerRoom(env.DB, "game_raid", miaPlayer, null);
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(true);
    // The same code on another server is another room.
    await env.DB.exec("DELETE FROM room_visits; DELETE FROM room_players");
    await setOwnServerRoom(env.DB, "game_raid", alexPlayer, { server_url: "wss://play.example.com", room_code: "LOBBY1", friend_joins_enabled: true });
    await setOwnServerRoom(env.DB, "game_raid", miaPlayer, { server_url: "wss://eu.example.com", room_code: "LOBBY1", friend_joins_enabled: true });
    expect(await hasPlayedWith(env.DB, alexPlayer, miaPlayer)).toBe(false);
  });
});

describe("sending and answering", () => {
  it("sends one, which waits for Mia, and Accept makes them friends on both sides", async () => {
    const game = (await gameBySlug(env.DB, "hollow-reach"))!;
    expect(await sendFriendRequest(env.DB, await account("alex"), await playerIdOf("mia"), game.id)).toEqual({ status: "sent", is_paused_now: false });
    expect(await friendRequestRefusalFor(env.DB, await account("alex"), await playerIdOf("mia"))).toBe("already_sent");
    expect((await call("alex", "/friends/requests")).answer).toEqual({ requests: [], accepted: [] });
    // Hollow Reach isn't out yet, so Mia sees no game with it.
    expect(await waitingFriendRequestsTo(env.DB, "mia")).toEqual([{ player_id: await playerIdOf("alex"), name: "Alex_Ray", created_at_ms: expect.any(Number), game_slug: null }]);
    const accepted = await call("mia", `/friends/requests/${await playerIdOf("alex")}/accept`, { body: {} });
    expect(accepted).toMatchObject({ status: 200, answer: { answer: "accepted" } });
    expect(await areFriends(env.DB, "alex", "mia")).toBe(true);
    expect(await areFriends(env.DB, "mia", "alex")).toBe(true);
    expect(await waitingFriendRequestsTo(env.DB, "mia")).toEqual([]);
    // Alex hears of the accept: on the game page's check-in, and in the list its card reads.
    expect((await call("alex", "/api/presence", { body: { game_slug: "hollow-reach" } })).answer).toEqual({ waiting_friend_request_count: 0, accepted_friend_request_count: 1 });
    expect((await call("alex", "/friends/requests")).answer).toEqual({ requests: [], accepted: [{ player_id: await playerIdOf("mia"), name: "Mia_Stone", answered_at_ms: expect.any(Number) }] });
    expect((await call("alex", `/friends/requests/about/${await playerIdOf("mia")}`)).answer).toMatchObject({ can_send: false, has_sent: false, is_friend: true });
    // A day on, the news is old.
    await env.DB.prepare("UPDATE friend_requests SET answered_at_ms = ?").bind(Date.now() - DAY_MS - 1000).run();
    expect((await call("alex", "/friends/requests")).answer.accepted).toEqual([]);
    // Answering twice finds nothing.
    expect((await call("mia", `/friends/requests/${await playerIdOf("alex")}/accept`, { body: {} })).status).toBe(404);
  });

  it("makes them friends at once when the other has one waiting the other way", async () => {
    await sendFriendRequest(env.DB, await account("alex"), await playerIdOf("mia"), null);
    expect(await sendFriendRequest(env.DB, await account("mia"), await playerIdOf("alex"), null)).toEqual({ status: "friends" });
    expect(await areFriends(env.DB, "alex", "mia")).toBe(true);
    expect(await waitingFriendRequestsTo(env.DB, "alex")).toEqual([]);
    // Alex sent first, so Alex hears of it like an accept.
    expect((await call("alex", "/friends/requests")).answer.accepted).toEqual([{ player_id: await playerIdOf("mia"), name: "Mia_Stone", answered_at_ms: expect.any(Number) }]);
  });

  it("never tells the sender of a turn-down, and waits 30 days before they can ask again", async () => {
    const alex = await account("alex");
    const mia = await playerIdOf("mia");
    await sendFriendRequest(env.DB, alex, mia, null);
    expect((await call("mia", `/friends/requests/${await playerIdOf("alex")}/turn-down`, { body: {} })).answer).toEqual({ answer: "turned_down" });
    // To Alex it still looks waiting, and no news ever comes of it.
    expect(await friendRequestRefusalFor(env.DB, alex, mia)).toBe("already_sent");
    expect((await call("alex", "/friends/requests")).answer.accepted).toEqual([]);
    expect((await call("alex", `/friends/requests/about/${mia}`)).answer).toEqual({ player: { player_id: mia, name: "Mia_Stone" }, can_send: false, has_sent: true, is_friend: false });
    // Run out: Add friend stays away for the rest of the 30 days.
    await env.DB.prepare("UPDATE friend_requests SET created_at_ms = ?, expires_at_ms = ?").bind(Date.now() - 8 * DAY_MS, Date.now() - DAY_MS).run();
    expect(await friendRequestRefusalFor(env.DB, alex, mia)).toBe("not_taking_requests");
    await env.DB.prepare("UPDATE friend_requests SET created_at_ms = ?, expires_at_ms = ?").bind(Date.now() - 31 * DAY_MS, Date.now() - 24 * DAY_MS).run();
    expect(await friendRequestRefusalFor(env.DB, alex, mia)).toBeNull();
    // One left to run out, unanswered, can be sent again once it has.
    await env.DB.exec("DELETE FROM friend_requests");
    await sendFriendRequest(env.DB, alex, mia, null);
    await env.DB.prepare("UPDATE friend_requests SET created_at_ms = ?, expires_at_ms = ?").bind(Date.now() - 8 * DAY_MS, Date.now() - DAY_MS).run();
    expect(await friendRequestRefusalFor(env.DB, alex, mia)).toBeNull();
  });

  it("caps a day's requests at 20, and 10 from a 13–15 account", async () => {
    const alex = await account("alex");
    const others: string[] = [];
    for (let index = 0; index < FRIEND_REQUEST_LIMITS.dailyCount; index++) {
      const made = await createAccount(env.DB, { id: `stranger-${index}`, username: `Stranger_${index}`, ageBand: "18+" });
      others.push(made.player_id);
    }
    // All accepted, so no pause gets in the way.
    for (const playerId of others) expect(await sendFriendRequest(env.DB, alex, playerId, null)).toMatchObject({ status: "sent" });
    await env.DB.exec("UPDATE friend_requests SET answer = 'accepted'");
    expect(await sendFriendRequest(env.DB, alex, await playerIdOf("mia"), null)).toEqual({ error: "too_many_friend_requests" });
    // A day later it's open again.
    await env.DB.prepare("UPDATE friend_requests SET created_at_ms = ?").bind(Date.now() - DAY_MS - 1000).run();
    expect(await sendFriendRequest(env.DB, alex, await playerIdOf("mia"), null)).toMatchObject({ status: "sent" });
    const noah = await account("noah");
    for (let index = 0; index < FRIEND_REQUEST_LIMITS.teenDailyCount; index++) {
      await env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms, answer) VALUES ('noah', ?, ?, ?, 'accepted')").bind(`teen-${index}`, Date.now(), Date.now() + DAY_MS).run();
    }
    await setRequests("lena", "played_with");
    await seat("noah", "RAID01");
    await seat("lena", "RAID01");
    expect(await sendFriendRequest(env.DB, noah, await playerIdOf("lena"), null)).toEqual({ error: "too_many_friend_requests" });
  });

  it("pauses a sender whose requests are mostly turned down or left, without telling them, and flags a 13–15 one to a person", async () => {
    // Twelve requests Noah sent over the last weeks: ten turned down or left for days, two accepted.
    const nowMs = Date.now();
    for (let index = 0; index < 12; index++) {
      const answer = index < 6 ? "turned_down" : index < 10 ? null : "accepted";
      await env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms, answer) VALUES ('noah', ?, ?, ?, ?)").bind(`kid-${index}`, nowMs - 5 * DAY_MS, nowMs + 2 * DAY_MS, answer).run();
    }
    await setRequests("lena", "played_with");
    await seat("noah", "RAID01");
    await seat("lena", "RAID01");
    const lena = await playerIdOf("lena");
    const sent = await call("noah", "/friends/requests", { body: { player_id: lena, game_slug: "hollow-reach" } });
    // To Noah it was sent, and it looks waiting from then on.
    expect(sent).toMatchObject({ status: 200, answer: { status: "sent" } });
    expect((await call("noah", `/friends/requests/about/${lena}`)).answer).toMatchObject({ can_send: false, has_sent: true });
    // Lena never sees it.
    expect((await call("lena", "/friends/requests")).answer).toEqual({ requests: [], accepted: [] });
    expect((await account("noah")).friend_requests_paused_until_ms).toBeGreaterThan(nowMs + 6 * DAY_MS);
    // A person looks: the reports queue has Noah, from Zaisma.
    expect(await env.DB.prepare("SELECT reporter_account_id, reason FROM profile_reports WHERE account_id = 'noah'").first()).toEqual({ reporter_account_id: "zaisma", reason: "friend_request_pattern" });
  });

  it("leaves an honest sender alone, whose requests are accepted", async () => {
    const nowMs = Date.now();
    for (let index = 0; index < 14; index++) {
      await env.DB.prepare("INSERT INTO friend_requests (sender_account_id, recipient_account_id, created_at_ms, expires_at_ms, answer) VALUES ('alex', ?, ?, ?, ?)").bind(`pal-${index}`, nowMs - 5 * DAY_MS, nowMs + 2 * DAY_MS, index < 10 ? "turned_down" : "accepted").run();
    }
    // Ten of fourteen turned down, but more than one in four accepted: no pause.
    expect(await sendFriendRequest(env.DB, await account("alex"), await playerIdOf("mia"), null)).toEqual({ status: "sent", is_paused_now: false });
    expect(await waitingFriendRequestsTo(env.DB, "mia")).toHaveLength(1);
  });
});

describe("the game page's calls", () => {
  it("are for signed-in players on zaisma.com's own pages, with closed inputs", async () => {
    const mia = await playerIdOf("mia");
    expect((await call(null, "/friends/requests")).status).toBe(401);
    expect((await call("alex", "/friends/requests", { body: { player_id: mia }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("alex", "/friends/requests", { body: { player_id: mia, note: "hi" } })).answer.error.code).toBe("unknown_field");
    expect((await call("alex", "/friends/requests", { body: { player_id: "Mia" } })).answer.error.code).toBe("bad_player_id");
    expect((await call("alex", `/friends/requests/about/${mia}`, { method: "POST", body: {} })).status).toBe(405);
    expect((await call("alex", "/friends/requests", { body: { player_id: mia, game_slug: "hollow-reach" } })).answer).toEqual({ status: "sent" });
    expect((await call("alex", "/friends/requests", { body: { player_id: mia } })).answer.error.code).toBe("already_sent");
    expect((await call("alex", "/friends/requests", { body: { player_id: await playerIdOf("sam") } })).answer.error.code).toBe("not_taking_requests");
  });

  it("brings the count on a game page's check-in, and the list to the card, Players and /friends", async () => {
    await env.DB.prepare("UPDATE games SET review_status = 'live', visibility = 'listed', live_version_id = 'version_live' WHERE slug = 'hollow-reach'").run();
    await call("alex", "/friends/requests", { body: { player_id: await playerIdOf("mia"), game_slug: "hollow-reach" } });
    expect((await call("mia", "/api/presence", { body: { game_slug: "hollow-reach" } })).answer).toEqual({ waiting_friend_request_count: 1, accepted_friend_request_count: 0 });
    expect((await call("mia", "/api/presence", { body: {} })).status).toBe(204);
    expect((await call("mia", "/friends/requests")).answer).toEqual({ requests: [{ player_id: await playerIdOf("alex"), name: "Alex_Ray", created_at_ms: expect.any(Number), game_slug: "hollow-reach" }], accepted: [] });
    const friendsPage = (await call("mia", "/friends")).answer as string;
    expect(friendsPage).toContain("Friend requests (1)");
    expect(friendsPage).toContain(`action="/friends/requests/${await playerIdOf("alex")}/accept"`);
    expect(friendsPage).toContain("/@Alex_Ray/report");
    // Turn down from /friends, as a form.
    const turnedDown = await call("mia", `/friends/requests/${await playerIdOf("alex")}/turn-down`, { form: true });
    expect(turnedDown.location).toBe("/friends?turned-down#requests");
    expect((await call("mia", "/friends")).answer as string).not.toContain("Friend requests (");
  });

  it("puts the sheet, the card and their script on a game page", async () => {
    await env.DB.prepare("UPDATE games SET review_status = 'live', visibility = 'listed', live_version_id = 'version_live', multiplayer_mode = 'relay' WHERE slug = 'hollow-reach'").run();
    await env.DB.prepare("INSERT OR REPLACE INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) SELECT 'version_live', id, 'games/hollow/live', 1, 0, 'approved', ? FROM games WHERE slug = 'hollow-reach'").bind(Date.now()).run();
    const page = (await call("alex", "/g/hollow-reach")).answer as string;
    expect(page).toContain('id="friend-request"');
    expect(page).toContain('id="friend-request-card"');
    expect(page).toContain('id="friend-accepted-card"');
    expect(page).toContain('id="players-player-friend"');
    expect(pageDataOf(page, "friend-request-data")).toMatchObject({ slug: "hollow-reach" });
  });
});
