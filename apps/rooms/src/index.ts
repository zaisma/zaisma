import { PLAYER_REPORT_REASONS, accountById, chatBandGroup, friendPlayerIdsOf, gameServerOf, type AccountRequirement, type MultiplayerMode, checkText, createReport, isIdOf, iso, leaveOut, listRooms, newId, pastFreeTier, playerProfile, readLabelParameter, readLeftParameter, tidyText, useRoomKey, type PlayerReportReason, type RoomList } from "@zaisma/core";
import { ERROR_TEXT, PassError, REQUEST_ERROR_HTTP_STATUS, guestName, isRoomCode, jwks, loadSigningKey, readRequestBody, requestError, roomCode, signPass, verifyPass, type Player, type RequestErrorCode, type SigningKey } from "@zaisma/game-server";
import { usesRooms } from "./registry.ts";
import type { GameDatabaseObject } from "./database.ts";
import { syncSchedules, type GameServerObject, type RequestOutcome } from "./game-server.ts";

export { Room } from "./room.ts";
export { GameDatabaseObject, GameDatabaseBinding, GameDatabaseService } from "./database.ts";
export { GameServerObject } from "./game-server.ts";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  LOADER: WorkerLoader;
  ROOMS: DurableObjectNamespace;
  GAME_DATABASES: DurableObjectNamespace<GameDatabaseObject>;
  GAME_SERVER_OBJECTS: DurableObjectNamespace<GameServerObject>;
  PASS_LIMIT?: RateLimit;
  ROOM_LIMIT?: RateLimit;
  REPORT_LIMIT?: RateLimit;
  FILTER_LIMIT?: RateLimit;
  CONNECT_LIMIT?: RateLimit;
  PROFILE_LIMIT?: RateLimit;
  REQUEST_LIMIT?: RateLimit;
  ISSUER: string;
  SITE_ORIGIN: string;
  GAME_HOST_MODE: "path" | "subdomain";
  GAME_ORIGIN: string;
  GAME_DOMAIN: string;
  PASS_SIGNING_KEY: string;
  /** How long each place keeps a copy of a game's room list. 10 unless set (tests set 0). */
  ROOM_LIST_CACHE_SECONDS?: string;
}

/** Passes last a day; the SDK keeps them only for the browser tab. */
const PASS_DURATION_SEC = 24 * 3600;

/** What rooms need of a game: its columns of the same names, and the game server its rooms run (gameServerOf). */
export interface RoomGame {
  id: string;
  slug: string;
  review_status: string;
  live_version_id: string | null;
  multiplayer_mode: MultiplayerMode;
  built_in_server: string | null;
  room_browsing: string;
  account_requirement: AccountRequirement;
}

export async function playableGame(database: D1Database, slug: string): Promise<RoomGame | null> {
  const game = await database.prepare("SELECT id, slug, review_status, live_version_id, multiplayer_mode, built_in_server, room_browsing, account_requirement FROM games WHERE slug = ?").bind(slug).first<RoomGame>();
  return game && game.review_status === "live" && game.live_version_id ? game : null;
}

/** The origin a game is served from. Only that origin may get passes or join its rooms. */
export async function isGameOrigin(env: Env, slug: string, origin: string | null): Promise<boolean> {
  return (await gameOrigin(env, slug, origin)) !== null;
}

/**
 * Whether origin serves this game, and the zaisma.com page its room links go to: the game page, or
 * for a tester link (<slug>--<token>, which may open a private game) the tester link itself, with
 * the link's ID so rooms can let its players go when it's turned off.
 */
export async function gameOrigin(env: Env, slug: string, origin: string | null): Promise<{ page: string; tester?: string } | null> {
  if (!origin) return null;
  const page = { page: `/g/${slug}` };
  if (env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN) {
    if (origin === `https://${slug}.${env.GAME_DOMAIN}`) return page;
    const host = URL.canParse(origin) ? new URL(origin).hostname : "";
    const tester = origin === `https://${host}` ? host.match(/^([a-z0-9-]+?)--([a-z0-9]{20})\./) : null;
    if (tester) {
      if (tester[1] !== slug || host !== `${tester[1]}--${tester[2]}.${env.GAME_DOMAIN}`) return null;
      const link = await env.DB.prepare("SELECT tester_links.id FROM tester_links JOIN games ON games.id = tester_links.game_id WHERE tester_links.token = ? AND tester_links.revoked_at_ms IS NULL AND games.slug = ?").bind(tester[2], slug).first<{ id: string }>();
      return link ? { page: `/t/${tester[2]}`, tester: link.id } : null;
    }
    const custom = await env.DB.prepare("SELECT 1 FROM domains JOIN games ON games.id = domains.game_id WHERE domains.hostname = ? AND games.slug = ?").bind(host, slug).first();
    return custom !== null && origin === `https://${host}` ? page : null;
  }
  return origin === new URL(env.GAME_ORIGIN).origin ? page : null;
}

let signing: { secret: string; key: Promise<SigningKey> } | null = null;
export function signingKey(env: Env): Promise<SigningKey> {
  if (signing?.secret !== env.PASS_SIGNING_KEY) signing = { secret: env.PASS_SIGNING_KEY, key: loadSigningKey(env.PASS_SIGNING_KEY) };
  return signing.key;
}

/**
 * The opaque chat group an open-and-social account carries in this game's passes: a keyed hash of the
 * game and the band group, so players in the same group match and nobody can tell which group is which
 * age, or link a group across games. Keyed with the pass signing secret, which never leaves Zaisma.
 */
export async function chatGroupId(env: Env, slug: string, bandGroup: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PASS_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`chat_group:${slug}:${bandGroup}`)));
  return `chat_group_${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 20)}`;
}

function json(body: unknown, httpStatus = 200, origin?: string): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return Response.json(body, { status: httpStatus, headers });
}

/**
 * The codes the SDK's calls answer with besides the room error codes, which the SDK passes on as
 * err.code. Every error is { error: { code, message } }.
 */
type CallErrorCode = "bad_origin" | "game_unavailable" | "slow_down" | "unchecked" | "no_rooms" | "bad_report" | "month_limit" | "no_player" | "account_needed";

function failure(code: CallErrorCode, message: string, httpStatus: number, origin?: string): Response {
  return json({ error: { code, message } }, httpStatus, origin);
}

/** Body is sent as text/plain JSON so the browser doesn't need a preflight request. */
async function readBody(request: Request): Promise<{ slug: string | null; body: Record<string, unknown> }> {
  try {
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    return { slug: typeof body.gameSlug === "string" && /^[a-z0-9-]{1,40}$/.test(body.gameSlug) ? body.gameSlug : null, body };
  } catch {
    return { slug: null, body: {} };
  }
}

const plainText = (given: unknown, maximumCharacterCount: number) => (typeof given === "string" ? given.slice(0, maximumCharacterCount).replace(/[\u0000-\u001f]/g, " ").trim() : "");

async function limited(limit: RateLimit | undefined, request: Request): Promise<boolean> {
  // Keyed by connection address, checked by Cloudflare and never stored.
  return limit ? !(await limit.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success : false;
}

const SLOW_DOWN = "Too many requests. Try again in a minute.";

/** A request's error, as the SDK reads it (err.code). */
function requestFailure(code: RequestErrorCode, origin?: string, message?: string): Response {
  return json(requestError(code, message), REQUEST_ERROR_HTTP_STATUS[code], origin);
}

/** Accounts' names by player ID, for requests: kept 5 minutes, like the Node runner's. */
const accountNames = new Map<string, { name: string | null; fetchedAtMs: number }>();

async function accountName(env: Env, playerId: string): Promise<string | null> {
  const cached = accountNames.get(playerId);
  if (cached && Date.now() - cached.fetchedAtMs < 300_000) return cached.name;
  const name = (await playerProfile(env.DB, playerId))?.name ?? null;
  if (accountNames.size > 10_000) accountNames.clear();
  accountNames.set(playerId, { name, fetchedAtMs: Date.now() });
  return name;
}

/**
 * A request from the game to its own game server (Zaisma.server.request), outside any room: the
 * player's pass says who's asking, and the game's object runs onRequest (game-server.ts).
 */
async function answerGameRequest(request: Request, env: Env, slug: string): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!(await isGameOrigin(env, slug, origin))) return requestFailure("bad_origin");
  const cors = origin!;
  if (await limited(env.REQUEST_LIMIT, request)) return requestFailure("slow_down", cors);
  // The request, its pass and the JSON around them; anything much bigger isn't read.
  if (Number(request.headers.get("content-length") ?? 0) > 32 * 1024) return requestFailure("too_big", cors);
  const text = await request.text();
  if (text.length > 32 * 1024) return requestFailure("too_big", cors);
  const body = readRequestBody(text);
  if ("code" in body) return requestFailure(body.code, cors);
  const game = await playableGame(env.DB, slug);
  if (!game) return requestFailure("game_unavailable", cors);

  let player: Player;
  try {
    const claims = await verifyPass(body.pass, [(await signingKey(env)).publicKey], { game: slug, issuer: env.ISSUER });
    // An account's pass is proof only: its name comes from its profile, and a deleted account's pass stops working.
    const name = claims.kind === "account" ? await accountName(env, claims.sub) : claims.name;
    if (!name) return requestFailure("bad_pass", cors);
    player = { id: claims.sub, name, kind: claims.kind };
  } catch (error) {
    if (!(error instanceof PassError)) throw error;
    return requestFailure("bad_pass", cors);
  }
  // Passes aren't given to guests of games that need accounts; this catches one given before the game changed.
  if (player.kind === "guest" && game.account_requirement !== "none") return requestFailure("account_needed", cors);

  try {
    // RPC's types can't carry unknown, so the answer is named here.
    const outcome = (await env.GAME_SERVER_OBJECTS.get(env.GAME_SERVER_OBJECTS.idFromName(game.id)).request(game.id, game.live_version_id!, player, body.request)) as RequestOutcome;
    if ("code" in outcome) return requestFailure(outcome.code, cors, outcome.message);
    return json({ answer: outcome.answer }, 200, cors);
  } catch (error) {
    console.error("Game server unavailable for requests:", error);
    return requestFailure("busy", cors);
  }
}

/** A room list for a game, in the SDK's words; inviteUrl is the link that drops a player into each room. */
function roomListForGame(list: Omit<RoomList, "changedAtMs">, inviteUrl: (code: string) => string) {
  return { ...list, rooms: list.rooms.map((room) => ({ ...room, inviteUrl: inviteUrl(room.roomCode) })) };
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (url.pathname === "/.well-known/jwks.json") {
      const key = await signingKey(env);
      return Response.json(jwks([key.publicKey]), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
    }

    // An account's public profile by player ID, for any game, server or site: what a stranger sees, read-only.
    const profileMatch = url.pathname.match(/^\/v1\/players\/([a-z0-9_-]{1,60})$/);
    if (profileMatch && request.method === "GET") {
      const open = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
      if (await limited(env.PROFILE_LIMIT, request)) return Response.json({ error: { code: "slow_down", message: SLOW_DOWN } }, { status: 429, headers: { ...open, "Cache-Control": "no-store" } });
      const profile = await playerProfile(env.DB, profileMatch[1]!);
      if (!profile) return Response.json({ error: { code: "no_player", message: "No account has that player ID. Guests have no profile, and a deleted account's is gone." } }, { status: 404, headers: open });
      return Response.json({ player: profile }, { headers: open });
    }

    if (request.method === "POST" && (url.pathname === "/v1/pass" || url.pathname === "/v1/rooms" || url.pathname === "/v1/report" || url.pathname === "/v1/filter")) {
      const { slug, body } = await readBody(request);
      if (!slug || !(await isGameOrigin(env, slug, origin))) return failure("bad_origin", "Not allowed from here.", 403);
      const cors = origin!;
      const game = await playableGame(env.DB, slug);
      if (!game) return failure("game_unavailable", ERROR_TEXT.game_unavailable, 404, cors);

      // Zaisma's text filter, for games that want to check what players type (Zaisma.filterText).
      if (url.pathname === "/v1/filter") {
        if (await limited(env.FILTER_LIMIT, request)) return failure("slow_down", SLOW_DOWN, 429, cors);
        const text = tidyText(body.text, 500);
        const checked = checkText(text);
        return json({ isAllowed: checked.isAllowed, reason: checked.isAllowed ? null : checked.reason, text }, 200, cors);
      }

      if (url.pathname === "/v1/pass") {
        if (await limited(env.PASS_LIMIT, request)) return failure("slow_down", SLOW_DOWN, 429, cors);
        // Only for a browser Cloudflare's check on Play said is real: the game page's key, a few passes each.
        const key = await useRoomKey(env.DB, game.id, body.roomKey);
        if (!key) return failure("unchecked", "Zaisma couldn't check this browser, so it can't play online. Reload the game to try again.", 403, cors);
        const nowSec = Math.floor(Date.now() / 1000);
        // A signed-in player is their account, with the same player ID in every game; anyone else a new guest.
        const account = key.accountId ? await accountById(env.DB, key.accountId) : null;
        // A game that needs accounts, for multiplayer or the whole game, gives guests no passes, so its own servers see only accounts too.
        if (!account && game.account_requirement !== "none") return failure("account_needed", ERROR_TEXT.account_needed, 403, cors);
        const player: Player = account ? { id: account.player_id, name: account.username, kind: "account" } : { id: newId("player"), name: guestName(), kind: "guest" };
        // The pass is proof only: an account's carries no name, which games look up (/v1/players/<id>).
        // It says who the account can chat with, never its age: its social mode, an opaque chat group when open and social, and its friends.
        const bandGroup = account ? chatBandGroup(account) : null;
        const chat = account
          ? { social_mode: account.social_mode, ...(bandGroup ? { chat_group: await chatGroupId(env, slug, bandGroup) } : {}), friend_player_ids: await friendPlayerIdsOf(env.DB, account.id) }
          : {};
        const claims = { sub: player.id, ...(player.kind === "guest" ? { name: player.name } : {}), aud: slug, iss: env.ISSUER, kind: player.kind, ...chat, iat: nowSec, exp: nowSec + PASS_DURATION_SEC };
        const pass = await signPass(await signingKey(env), claims);
        return json({ pass, player, expiresAt: iso((nowSec + PASS_DURATION_SEC) * 1000) }, 200, cors);
      }

      // A player reporting another player. Like every report, nothing about the reporter is kept.
      if (url.pathname === "/v1/report") {
        if (await limited(env.REPORT_LIMIT, request)) return failure("slow_down", "Too many reports. Try again in a minute.", 429, cors);
        const reason = plainText(body.reason, 20) as PlayerReportReason;
        const reportedRoomCode = plainText(body.roomCode, 6);
        const playerId = plainText(body.playerId, 40);
        if (!(reason in PLAYER_REPORT_REASONS) || !isRoomCode(reportedRoomCode) || !isIdOf("player", playerId)) {
          return failure("bad_report", `Choose what happened (${Object.keys(PLAYER_REPORT_REASONS).join(", ")}), with the room's code and the player's ID.`, 400, cors);
        }
        await createReport(env.DB, {
          gameId: game.id,
          reason: "player",
          playerText: plainText(body.details, 500),
          versionId: game.live_version_id,
          roomCode: reportedRoomCode,
          player: { id: playerId, name: plainText(body.playerName, 40), reason },
        });
        return json({ isReported: true }, 200, cors);
      }

      if (!usesRooms(gameServerOf(game))) return failure("no_rooms", "This game doesn't use Zaisma rooms.", 404, cors);
      if (await limited(env.ROOM_LIMIT, request)) return failure("slow_down", SLOW_DOWN, 429, cors);
      if (await pastFreeTier(env.DB, game.id)) return failure("month_limit", ERROR_TEXT.month_limit, 403, cors);
      return json({ roomCode: roomCode() }, 200, cors);
    }

    const requestMatch = url.pathname.match(/^\/v1\/requests\/([a-z0-9-]{1,40})$/);
    if (requestMatch && request.method === "POST") return answerGameRequest(request, env, requestMatch[1]!);

    // The game's listed rooms, for games that show them themselves (Zaisma.rooms.list).
    const listMatch = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})$/);
    if (listMatch && request.method === "GET") {
      const slug = listMatch[1]!;
      const from = await gameOrigin(env, slug, origin);
      if (!from) return failure("bad_origin", "Not allowed from here.", 403);
      const game = await playableGame(env.DB, slug);
      if (!game || !usesRooms(gameServerOf(game))) return failure("no_rooms", "This game doesn't use Zaisma rooms.", 404, origin!);
      const inviteUrl = (code: string) => `${env.SITE_ORIGIN}${from.page}?room=${code}`;
      if (game.room_browsing === "off") {
        const nothing = { rooms: [], playing: { playerCount: 0, roomCount: 0, closedRoomCount: 0 }, joinableRoomCount: 0, openRoomCount: 0, regions: [], region: null, moreOpenRoomCount: 0, filters: [] };
        return json(roomListForGame(nothing, inviteUrl), 200, origin!);
      }
      // The SDK says which room this player just left, so they don't see themselves in it while lists catch up.
      const left = readLeftParameter(url.searchParams.get("left"));
      const listed = await listRooms(env.DB, game.id, {
        country: request.cf?.country as string | undefined,
        continent: request.cf?.continent as string | undefined,
        region: url.searchParams.get("region"),
        labels: readLabelParameter(url.searchParams.get("labels")),
        cacheDurationSec: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
      });
      const { changedAtMs: _, ...found } = left ? leaveOut(listed, left) : listed;
      return json(roomListForGame(found, inviteUrl), 200, origin!);
    }

    const roomMatch = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/);
    if (roomMatch && request.method === "GET") {
      const [, slug, code] = roomMatch as unknown as [string, string, string];
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      // Checked first: a script claiming to be the game's page can't keep waking rooms.
      if (await limited(env.CONNECT_LIMIT, request)) return new Response("Too many connections. Try again in a minute.", { status: 429 });
      const from = isRoomCode(code) ? await gameOrigin(env, slug, origin) : null;
      if (!from) return new Response("Not allowed from here", { status: 403 });
      const game = await playableGame(env.DB, slug);
      if (!game || !usesRooms(gameServerOf(game))) return new Response("This game isn't available right now", { status: 404 });

      const headers = new Headers(request.headers);
      headers.set("x-game-id", game.id);
      headers.set("x-game-slug", game.slug);
      headers.set("x-game-server", gameServerOf(game)!);
      headers.set("x-game-version", game.live_version_id!);
      headers.set("x-room-code", code);
      // Players who came through a tester link leave when it's turned off. Never taken from the player.
      if (from.tester) headers.set("x-tester-link", from.tester);
      else headers.delete("x-tester-link");
      // Where the room's first player is (country and continent), so room lists can say where it runs.
      headers.set("x-room-country", String(request.cf?.country ?? ""));
      headers.set("x-room-continent", String(request.cf?.continent ?? ""));
      try {
        return await env.ROOMS.get(env.ROOMS.idFromName(`${slug}:${code}`)).fetch(new Request(request, { headers }));
      } catch (error) {
        // Past the free plan's daily Durable Object limit, say so instead of failing silently.
        console.error("Room unavailable:", error);
        return new Response("Rooms are busy. Try again soon.", { status: 503 });
      }
    }

    if (url.pathname === "/") return Response.redirect(env.SITE_ORIGIN, 302);
    return new Response("Not found", { status: 404 });
  },

  // Every minute: games' schedules after a publish (game-server.ts).
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(syncSchedules(env));
  },
} satisfies ExportedHandler<Env>;
