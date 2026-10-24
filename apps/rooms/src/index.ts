import { CHAT_BLOCK_MESSAGES, CHAT_FILTER_LIMITS, itemsOf, ownedItemNames, priceFor, priceText, PLAYER_REPORT_REASONS, accountById, checkChatText, isChatStopped, isBlockedInCountry, isOldEnoughFor, requestCountryCode, type AgeBand, gameAddress, accountUsernameOf, blockPlayerIdsOf, chatBandGroup, socialSettingsOf, friendPlayerIdsOf, friendsInGameOf, gameServerOf, isOwnServerUrl, ownServerUrlsOf, setOwnServerRoom, type AccountRequirement, type MultiplayerMode, createReport, isIdOf, iso, leaveOut, listRooms, newId, isHostingPaused, playerProfile, readLabelParameter, readLeftParameter, tidyChatText, tidyText, useRoomKey, type PlayerReportReason, type RoomList } from "@zaisma/core";
import { ERROR_TEXT, PassError, REQUEST_ERROR_HTTP_STATUS, REQUEST_LIMITS, canChat, guestName, isRoomCode, jwks, readRequestBody, requestError, roomCode, signPass, verifyPass, type Player, type PassClaims, type RequestErrorCode } from "@zaisma/game-server";
import { usesRooms } from "./registry.ts";
import { signingKey } from "./signing.ts";
import type { GameDatabaseObject } from "./database.ts";
import type { GameSecretsObject } from "./secrets.ts";
import { syncSchedules, type GameServerObject, type RequestOutcome } from "./game-server.ts";
import { relayCredentials, syncRelayUse, type RelayEnv } from "./relay.ts";
import { filterChatMessage } from "./chat-filter.ts";
import type { ChatCheckService } from "../../site/src/chat-check.ts";

export { Room } from "./room.ts";
export { GameDatabaseObject, GameDatabaseBinding, GameDatabaseService } from "./database.ts";
export { GameServerObject, GameServerWebhookService } from "./game-server.ts";
export { GameSecretsObject, GameSecretsService } from "./secrets.ts";
export { GameServerOutbound } from "./outbound.ts";
export { GameStorageService } from "./game-storage.ts";
export { GameRoomsService } from "./room-updates.ts";
export { ReceiptSigningService } from "./receipts.ts";

export interface Env extends RelayEnv {
  DB: D1Database;
  GAMES: R2Bucket;
  LOADER: WorkerLoader;
  ROOMS: DurableObjectNamespace;
  GAME_DATABASES: DurableObjectNamespace<GameDatabaseObject>;
  GAME_SERVER_OBJECTS: DurableObjectNamespace<GameServerObject>;
  /** Each game's secrets (secrets.ts). */
  GAME_SECRETS: DurableObjectNamespace<GameSecretsObject>;
  PASS_LIMIT?: RateLimit;
  ROOM_LIMIT?: RateLimit;
  REPORT_LIMIT?: RateLimit;
  FILTER_LIMIT?: RateLimit;
  CONNECT_LIMIT?: RateLimit;
  PROFILE_LIMIT?: RateLimit;
  REQUEST_LIMIT?: RateLimit;
  /** Relay credentials for connections between players (relay.ts), like passes. */
  RELAY_LIMIT?: RateLimit;
  /** A game asking for the player's friends playing it, or saying which room on its own servers they're in (Zaisma.friends). */
  FRIENDS_LIMIT?: RateLimit;
  /** Game servers' calls to other servers, per game (outbound.ts). */
  OUTSIDE_CALL_LIMIT?: RateLimit;
  /** Developers' own servers checking chat (POST /v1/chat/check), per game and sender. */
  CHAT_CHECK_LIMIT?: RateLimit;
  /** The chat filter's AI step, in the site Worker (apps/site/src/chat-check.ts). Without it, teens' messages the rules can't tell are stopped. */
  CHAT_CHECK?: Service<ChatCheckService>;
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
  minimum_player_age_years: number;
  country_blocks: string;
}

/**
 * Whether an account is younger than the game's minimum age (docs/DECISIONS.md, "Games can keep out younger
 * age bands"). Read from D1 by account or player ID, never from a pass, which never carries an age; only
 * for games above 13, so other games cost no read.
 */
async function isTooYoungFor(database: D1Database, game: Pick<RoomGame, "minimum_player_age_years">, account: { accountId: string } | { playerId: string }): Promise<boolean> {
  if (game.minimum_player_age_years <= 13) return false;
  const row = "accountId" in account
    ? await database.prepare("SELECT age_band FROM accounts WHERE id = ?").bind(account.accountId).first<{ age_band: AgeBand }>()
    : await database.prepare("SELECT age_band FROM accounts WHERE player_id = ?").bind(account.playerId).first<{ age_band: AgeBand }>();
  return !row || !isOldEnoughFor(row.age_band, game.minimum_player_age_years);
}

/** A live game, or null; given the player's country (a browser's own call), also null when the game is blocked there (country-blocks.ts). */
export async function playableGame(database: D1Database, slug: string, countryCode: string | null = null): Promise<RoomGame | null> {
  const game = await database.prepare("SELECT id, slug, review_status, live_version_id, multiplayer_mode, built_in_server, room_browsing, account_requirement, minimum_player_age_years, country_blocks FROM games WHERE slug = ?").bind(slug).first<RoomGame>();
  return game && game.review_status === "live" && game.live_version_id && !isBlockedInCountry(game, countryCode) ? game : null;
}

/**
 * Whether origin serves this game, and the zaisma.com page its room links go to: the game page, or
 * for the game's tester address (<slug>--tester, which may open a private game) the tester link the
 * SDK names, with its ID so rooms can let its players go when it's turned off. A request from the
 * tester address that doesn't name a link that's on gets no room list and no room.
 */
export async function gameOrigin(env: Env, slug: string, origin: string | null, testerId: string | null = null): Promise<{ page: string; tester?: string } | null> {
  if (!origin) return null;
  const page = { page: `/g/${slug}` };
  if (env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN) {
    if (origin === `https://${slug}.${env.GAME_DOMAIN}`) return page;
    if (origin === `https://${gameAddress(slug, "tester")}.${env.GAME_DOMAIN}`) return testerLinkFor(env, slug, testerId);
    const host = URL.canParse(origin) ? new URL(origin).hostname : "";
    const custom = await env.DB.prepare("SELECT 1 FROM domains JOIN games ON games.id = domains.game_id WHERE domains.hostname = ? AND games.slug = ?").bind(host, slug).first();
    return custom !== null && origin === `https://${host}` ? page : null;
  }
  // Path mode puts every game on one origin, so only the link the SDK names says it's a tester's.
  if (origin !== new URL(env.GAME_ORIGIN).origin) return null;
  return testerId ? testerLinkFor(env, slug, testerId) : page;
}

/** Whether origin serves this game, for calls that don't need to know which tester link it came through. */
export async function isGameOrigin(env: Env, slug: string, origin: string | null): Promise<boolean> {
  if (env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN && origin === `https://${gameAddress(slug, "tester")}.${env.GAME_DOMAIN}`) return true;
  return (await gameOrigin(env, slug, origin)) !== null;
}

async function testerLinkFor(env: Env, slug: string, testerId: string | null): Promise<{ page: string; tester: string } | null> {
  if (!testerId || !isIdOf("tester", testerId)) return null;
  const link = await env.DB.prepare(
    "SELECT tester_links.token FROM tester_links JOIN games ON games.id = tester_links.game_id WHERE tester_links.id = ? AND games.slug = ? AND tester_links.revoked_at_ms IS NULL AND (tester_links.ends_at_ms IS NULL OR tester_links.ends_at_ms > ?)",
  )
    .bind(testerId, slug, Date.now())
    .first<{ token: string }>();
  return link ? { page: `/t/${link.token}`, tester: testerId } : null;
}

export { signingKey } from "./signing.ts";

/**
 * The opaque chat group an open-and-social account carries in this game's passes: a keyed hash of the
 * game and the band group, so players in the same group match and nobody can tell which group is which
 * age, or link a group across games. Keyed with the pass signing secret, which never leaves Zaisma.
 */
export async function chatGroupId(env: Env, slug: string, bandGroup: string): Promise<string> {
  return `chat_group_${await keyedHash(env, `chat_group:${slug}:${bandGroup}`)}`;
}

/**
 * An account's player tag in this game's passes (player_tag_…): a keyed hash of the game and the player,
 * so a developer's own server can match two of its players' passes for a block or a friendship between
 * them, but can't tell who a tag is without that player's own pass, or link tags across games.
 */
export async function playerTag(env: Env, slug: string, playerId: string): Promise<string> {
  return `player_tag_${await keyedHash(env, `player_tag:${slug}:${playerId}`)}`;
}

let hashing: { secret: string; key: Promise<CryptoKey> } | null = null;
/** 20 hex characters of an HMAC keyed with the pass signing secret, which never leaves Zaisma. */
async function keyedHash(env: Env, text: string): Promise<string> {
  if (hashing?.secret !== env.PASS_SIGNING_KEY) hashing = { secret: env.PASS_SIGNING_KEY, key: crypto.subtle.importKey("raw", new TextEncoder().encode(env.PASS_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", await hashing.key, new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

/** The player's first language, for how prices are written ("$1.99", "1,99 €"); never what they cost. */
function shownLocale(acceptLanguage: string | null): string {
  const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();
  try {
    return first ? (Intl.NumberFormat.supportedLocalesOf([first])[0] ?? "en-US") : "en-US";
  } catch {
    return "en-US";
  }
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
type CallErrorCode = "bad_origin" | "game_unavailable" | "slow_down" | "unchecked" | "no_rooms" | "bad_report" | "hosting_paused" | "no_player" | "account_needed" | "game_not_open_to_player" | "busy" | "bad_pass" | "bad_room_code" | "bad_server_url" | "unlisted_server" | "bad_request";

function failure(code: CallErrorCode, message: string, httpStatus: number, origin?: string, field?: string): Response {
  return json({ error: { code, message, ...(field ? { field } : {}) } }, httpStatus, origin);
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
  const name = await accountUsernameOf(env.DB, playerId);
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
  const maximumBodySizeBytes = REQUEST_LIMITS.maximumRequestSizeBytes + REQUEST_LIMITS.maximumPassSizeBytes + 1024;
  if (Number(request.headers.get("content-length") ?? 0) > maximumBodySizeBytes) return requestFailure("too_big", cors);
  const text = await request.text();
  if (text.length > maximumBodySizeBytes) return requestFailure("too_big", cors);
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
    player = { id: claims.sub, name, kind: claims.kind, ...(claims.owned_item_names?.length ? { ownedItemNames: claims.owned_item_names } : {}) };
  } catch (error) {
    if (!(error instanceof PassError)) throw error;
    return requestFailure("bad_pass", cors);
  }
  // Passes aren't given to guests of games that need accounts; this catches one given before the game changed.
  if (player.kind === "guest" && game.account_requirement !== "none") return requestFailure("account_needed", cors);
  if (player.kind === "account" && (await isTooYoungFor(env.DB, game, { playerId: player.id }))) return requestFailure("game_not_open_to_player", cors);

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

/**
 * Zaisma.friends, from inside the game (docs/DECISIONS.md, "How friends in games works"). The player's
 * pass says who's asking, for which game:
 *   POST /v1/friends        { gameSlug, pass }: their friends playing this game, { friends }
 *   POST /v1/friends/room   { gameSlug, pass, serverUrl, roomCode, friendJoinsEnabled? }: the room on the
 *                           game's own servers they're in (both null when they left), so friends' Join
 *                           works there too; friendJoinsEnabled false grays it as "Private room"
 */
async function answerFriends(request: Request, env: Env, isSettingRoom: boolean): Promise<Response> {
  const origin = request.headers.get("origin");
  const { slug, body } = await readBody(request);
  if (!slug || !(await isGameOrigin(env, slug, origin))) return failure("bad_origin", "Not allowed from here.", 403);
  const cors = origin!;
  if (await limited(env.FRIENDS_LIMIT, request)) return failure("slow_down", SLOW_DOWN, 429, cors);
  // Any game with a page, out yet or not: a game asks about its own players.
  const game = await env.DB.prepare("SELECT id, own_server_urls FROM games WHERE slug = ? AND review_status != 'removed'").bind(slug).first<{ id: string; own_server_urls: string }>();
  if (!game) return failure("game_unavailable", ERROR_TEXT.game_unavailable, 404, cors);
  let claims: PassClaims;
  try {
    claims = await verifyPass(typeof body.pass === "string" ? body.pass : "", [(await signingKey(env)).publicKey], { game: slug, issuer: env.ISSUER });
  } catch (error) {
    if (!(error instanceof PassError)) throw error;
    return failure("bad_pass", "This player's pass didn't check out. Zaisma.player() gets a new one.", 401, cors);
  }
  if (claims.kind !== "account") return failure("account_needed", "Friends are for players signed in to Zaisma. Ask a guest to sign in first (Zaisma.player.signIn).", 403, cors);
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE player_id = ?").bind(claims.sub).first<{ id: string }>();
  if (!account) return failure("bad_pass", "This player's account is gone.", 401, cors);

  if (!isSettingRoom) {
    // Watch is zaisma.com's own (its Players plate); games get Join's answer, as Zaisma.friends.list says.
    const friends = (await friendsInGameOf(env.DB, account.id, game.id)).map((friend) => ({ player_id: friend.player_id, username: friend.username, room_code: friend.room_code, server_url: friend.server_url, join_refusal: friend.join_refusal }));
    return json({ friends }, 200, cors);
  }
  if (body.serverUrl === null && body.roomCode === null) {
    await setOwnServerRoom(env.DB, game.id, claims.sub, null);
    return json({ isSet: true }, 200, cors);
  }
  const roomCodeGiven = typeof body.roomCode === "string" ? body.roomCode.toUpperCase() : "";
  if (!isRoomCode(roomCodeGiven)) return failure("bad_room_code", 'roomCode takes a room code: six characters like "K7Q2MX", from 2 to 9 and A to Z without I or O.', 400, cors);
  const serverUrl = ownServerOf(typeof body.serverUrl === "string" ? body.serverUrl : "");
  if (!serverUrl) return failure("bad_server_url", 'serverUrl takes your server\'s address starting with wss:// or https://, like "wss://play.example.com".', 400, cors);
  if (!isOwnServerUrl(serverUrl.address, ownServerUrlsOf(game))) {
    return failure("unlisted_server", `${serverUrl.host} isn't one of this game's own servers, so friends can't be sent there. Add it to the game's own servers first (update_game with own_server_urls, or the dashboard).`, 403, cors);
  }
  // The room's Join switch: only false turns it off, as in a room's hello (the SDK always sends true or false).
  await setOwnServerRoom(env.DB, game.id, claims.sub, { server_url: serverUrl.address, room_code: roomCodeGiven, friend_joins_enabled: body.friendJoinsEnabled !== false });
  return json({ isSet: true }, 200, cors);
}

/** The most players one chat message can be checked for at once. */
const MAXIMUM_CHAT_RECEIVER_COUNT = 50;

/**
 * The chat filter for developers' own servers (checkChat in @zaisma/game-server): server to server, so no
 * CORS. Every pass is checked for this game, and the filter runs as it does in Zaisma's rooms, except that
 * a message kept for review pauses nobody (chat-filter.ts).
 *   POST /v1/chat/check  { gameSlug, senderPass, receiverPasses, text, recentTexts }: { isAllowed, reason, message, hasSwearing }
 */
async function answerChatCheck(request: Request, env: Env): Promise<Response> {
  const { slug, body } = await readBody(request);
  const game = slug ? await playableGame(env.DB, slug) : null;
  if (!slug || !game) return failure("game_unavailable", ERROR_TEXT.game_unavailable, 404, undefined, "gameSlug");
  const receiverPasses = body.receiverPasses;
  if (!Array.isArray(receiverPasses) || receiverPasses.length > MAXIMUM_CHAT_RECEIVER_COUNT || !receiverPasses.every((pass) => typeof pass === "string")) {
    return failure("bad_request", `receiverPasses takes a list of up to ${MAXIMUM_CHAT_RECEIVER_COUNT} player passes, as your server received them.`, 400, undefined, "receiverPasses");
  }
  if (typeof body.text !== "string") return failure("bad_request", "text takes the message as text.", 400, undefined, "text");
  const recentTexts = body.recentTexts ?? [];
  if (!Array.isArray(recentTexts) || !recentTexts.every((recentText) => typeof recentText === "string")) return failure("bad_request", "recentTexts takes a list of the sender's last messages, oldest first.", 400, undefined, "recentTexts");

  const keys = [(await signingKey(env)).publicKey];
  const check = async (pass: unknown) => verifyPass(typeof pass === "string" ? pass : "", keys, { game: slug, issuer: env.ISSUER });
  let sender: PassClaims;
  try {
    sender = await check(body.senderPass);
  } catch (error) {
    if (!(error instanceof PassError)) throw error;
    return failure("bad_pass", "The sender's pass didn't check out for this game. Send it as your server received it from the player.", 401, undefined, "senderPass");
  }
  let receivers: PassClaims[];
  try {
    receivers = await Promise.all(receiverPasses.map(check));
  } catch (error) {
    if (!(error instanceof PassError)) throw error;
    return failure("bad_pass", "A receiver's pass didn't check out for this game. Send each as your server received it from the player.", 401, undefined, "receiverPasses");
  }
  // Per game and sender: more than anyone types, not enough to use Zaisma's filter for something else.
  if (env.CHAT_CHECK_LIMIT && !(await env.CHAT_CHECK_LIMIT.limit({ key: `${game.id}:${sender.sub}` })).success) return failure("slow_down", SLOW_DOWN, 429);
  // The backstop for canChat: a server that skipped it still delivers nothing to players who may not chat.
  // One verdict for the message, never which receiver.
  if (receivers.some((receiver) => receiver.sub !== sender.sub && !canChat(sender, receiver))) {
    return json({ isAllowed: false, reason: "not_allowed_to_chat", message: CHAT_BLOCK_MESSAGES.not_allowed_to_chat, hasSwearing: false });
  }

  const answer = await filterChatMessage(env, {
    gameId: game.id,
    text: body.text,
    senderPlayerId: sender.sub,
    receiverPlayerIds: receivers.map((receiver) => receiver.sub),
    recentTexts: recentTexts.slice(-CHAT_FILTER_LIMITS.recentTextCount).map((recentText) => tidyText(recentText, CHAT_FILTER_LIMITS.maximumMessageCharacterCount)),
    source: "own_server",
  });
  return json(answer);
}

/**
 * A game's own server address as Zaisma keeps it (with no trailing slash), and the host its listed own
 * servers are matched by: wss:// and https:// reach the same server. Only secure addresses.
 */
function ownServerOf(given: string): { address: string; host: string } | null {
  const trimmed = given.replace(/\/+$/, "");
  if (trimmed.length > 200 || !URL.canParse(trimmed)) return null;
  const parsed = new URL(trimmed);
  if ((parsed.protocol !== "wss:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return { address: trimmed, host: parsed.host };
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
      const profile = await playerProfile(env.DB, profileMatch[1]!, env.SITE_ORIGIN);
      if (!profile) return Response.json({ error: { code: "no_player", message: "No account has that player ID. Guests have no profile, and a deleted account's is gone." } }, { status: 404, headers: open });
      return Response.json({ player: profile }, { headers: open });
    }

    if (request.method === "POST" && (url.pathname === "/v1/friends" || url.pathname === "/v1/friends/room")) return answerFriends(request, env, url.pathname === "/v1/friends/room");

    if (request.method === "POST" && url.pathname === "/v1/chat/check") return answerChatCheck(request, env);

    if (request.method === "POST" && (url.pathname === "/v1/pass" || url.pathname === "/v1/relay" || url.pathname === "/v1/rooms" || url.pathname === "/v1/report" || url.pathname === "/v1/filter")) {
      const { slug, body } = await readBody(request);
      if (!slug || !(await isGameOrigin(env, slug, origin))) return failure("bad_origin", "Not allowed from here.", 403);
      const cors = origin!;
      const game = await playableGame(env.DB, slug, requestCountryCode(request));
      if (!game) return failure("game_unavailable", ERROR_TEXT.game_unavailable, 404, cors);

      // Zaisma's text filter, for games that want to check what players type (Zaisma.filterText).
      // The chat filter's rules and AI, for the sender's instant answer: nothing is looked up, counted or kept.
      // Zaisma checks again on its side as each message is delivered (chat-filter.ts).
      if (url.pathname === "/v1/filter") {
        if (await limited(env.FILTER_LIMIT, request)) return failure("slow_down", SLOW_DOWN, 429, cors);
        if (String(body.text ?? "").length > CHAT_FILTER_LIMITS.maximumMessageCharacterCount) {
          return json({ isAllowed: false, reason: "too_long", message: CHAT_BLOCK_MESSAGES.too_long, hasSwearing: false, text: "" }, 200, cors);
        }
        const text = tidyText(body.text, CHAT_FILTER_LIMITS.maximumMessageCharacterCount);
        const rules = checkChatText(text);
        let reason = rules.reason as keyof typeof CHAT_BLOCK_MESSAGES | null;
        if (rules.verdict === "unclear") {
          const checked = env.CHAT_CHECK ? await env.CHAT_CHECK.checkUnclear({ text, recentTexts: [], isAdultToMinor: false }).catch(() => ({ verdict: "unchecked" as const })) : { verdict: "unchecked" as const };
          reason = checked.verdict === "blocked" ? checked.reason : checked.verdict === "unchecked" ? "unchecked" : null;
        }
        return json({ isAllowed: reason === null, reason, message: reason ? CHAT_BLOCK_MESSAGES[reason] : null, hasSwearing: rules.hasSwearing, text: tidyChatText(body.text, CHAT_FILTER_LIMITS.maximumMessageCharacterCount) }, 200, cors);
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
        // A game for older players gives younger accounts no passes, so its own servers never see them either.
        if (account && game.minimum_player_age_years > 13 && !isOldEnoughFor(account.age_band, game.minimum_player_age_years)) {
          return failure("game_not_open_to_player", ERROR_TEXT.game_not_open_to_player, 403, cors);
        }
        const player: Player = account ? { id: account.player_id, name: account.username, kind: "account" } : { id: newId("player"), name: guestName(), kind: "guest" };
        // The pass is proof only: an account's carries no name, which games look up (/v1/players/<id>).
        // It says who the account can chat with, never its age: its chat setting (within its band's limits) and an opaque chat group when that's anyone.
        // And its friends and blocks, as opaque tags (playerTag), never a list of players anyone can read: games see what the public sees.
        const bandGroup = account ? chatBandGroup(account) : null;
        const chat = account
          ? {
              // An account whose chat the filter stopped chats with nobody, so own servers stop it too with its next pass.
              who_can_chat: isChatStopped(account) ? "nobody" : socialSettingsOf(account).who_can_chat,
              ...(bandGroup ? { chat_group: await chatGroupId(env, slug, bandGroup) } : {}),
              player_tag: await playerTag(env, slug, account.player_id),
              friend_tag_ids: await Promise.all((await friendPlayerIdsOf(env.DB, account.id)).map((playerId) => playerTag(env, slug, playerId))),
              block_tag_ids: await Promise.all((await blockPlayerIdsOf(env.DB, account.id)).map((playerId) => playerTag(env, slug, playerId))),
            }
          : {};
        // The permanent items the account owns here, so any game server sees them on connect without calling Zaisma.
        const ownedNames = account ? await ownedItemNames(env.DB, game.id, account.player_id) : [];
        const owned = ownedNames.length ? { owned_item_names: ownedNames } : {};
        const claims = { sub: player.id, ...(player.kind === "guest" ? { name: player.name } : {}), aud: slug, iss: env.ISSUER, kind: player.kind, ...chat, ...owned, iat: nowSec, exp: nowSec + PASS_DURATION_SEC };
        const pass = await signPass(await signingKey(env), claims);
        return json({ pass, player, expiresAt: iso((nowSec + PASS_DURATION_SEC) * 1000) }, 200, cors);
      }

      // Relay servers for this player's connections to other players (the relay script, packages/sdk/relay.js):
      // only for a browser the check on Play said is real, like passes, and none while the game's hosting is paused.
      if (url.pathname === "/v1/relay") {
        if (await limited(env.RELAY_LIMIT, request)) return failure("slow_down", SLOW_DOWN, 429, cors);
        const key = await useRoomKey(env.DB, game.id, body.roomKey);
        if (!key) return failure("unchecked", "Zaisma couldn't check this browser, so it can't connect to other players. Reload the game to try again.", 403, cors);
        if (!key.accountId && game.account_requirement !== "none") return failure("account_needed", ERROR_TEXT.account_needed, 403, cors);
        if (key.accountId && (await isTooYoungFor(env.DB, game, { accountId: key.accountId }))) return failure("game_not_open_to_player", ERROR_TEXT.game_not_open_to_player, 403, cors);
        if ((await isHostingPaused(env.DB, game.id)).isPaused) return failure("hosting_paused", ERROR_TEXT.hosting_paused, 403, cors);
        const relay = await relayCredentials(env, env.DB, game.id);
        if (!relay) return failure("busy", "Zaisma's relay isn't available right now, so players can't connect to each other. Try again in a minute.", 503, cors);
        return json({ iceServers: relay.iceServers, expiresAt: iso(relay.expiresAtMs) }, 200, cors);
      }

      // A player reporting another player. Like every report, nothing about the reporter is kept.
      if (url.pathname === "/v1/report") {
        if (await limited(env.REPORT_LIMIT, request)) return failure("slow_down", "Too many reports. Try again in a minute.", 429, cors);
        const reason = plainText(body.reason, 40) as PlayerReportReason;
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
      if ((await isHostingPaused(env.DB, game.id)).isPaused) return failure("hosting_paused", ERROR_TEXT.hosting_paused, 403, cors);
      return json({ roomCode: roomCode() }, 200, cors);
    }

    const requestMatch = url.pathname.match(/^\/v1\/requests\/([a-z0-9-]{1,40})$/);
    if (requestMatch && request.method === "POST") return answerGameRequest(request, env, requestMatch[1]!);

    // The game's listed rooms, for games that show them themselves (Zaisma.rooms.list).
    const listMatch = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})$/);
    if (listMatch && request.method === "GET") {
      const slug = listMatch[1]!;
      const from = await gameOrigin(env, slug, origin, url.searchParams.get("tester"));
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

    // The game's items for sale, at the price this player pays (Zaisma.items.list): by their country, never their browser's language.
    const itemsMatch = url.pathname.match(/^\/v1\/items\/([a-z0-9-]{1,40})$/);
    if (itemsMatch && request.method === "GET") {
      const slug = itemsMatch[1]!;
      if (!(await gameOrigin(env, slug, origin, url.searchParams.get("tester")))) return failure("bad_origin", "Not allowed from here.", 403);
      const countryCode = requestCountryCode(request);
      const game = await playableGame(env.DB, slug, countryCode);
      if (!game) return failure("game_unavailable", ERROR_TEXT.game_unavailable, 404, origin!);
      const locale = shownLocale(request.headers.get("accept-language"));
      const items = (await itemsOf(env.DB, game.id)).flatMap((forSale) => {
        const price = priceFor(forSale, countryCode);
        if (!price) return [];
        return [{ itemName: forSale.item_name, title: forSale.title, description: forSale.description, itemKind: forSale.item_kind, itemCategory: forSale.item_category, priceMinorUnits: price.priceMinorUnits, currencyCode: price.currencyCode, priceText: priceText(price.currencyCode, price.priceMinorUnits, locale) }];
      });
      return json({ items }, 200, origin!);
    }

    const roomMatch = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/);
    if (roomMatch && request.method === "GET") {
      const [, slug, code] = roomMatch as unknown as [string, string, string];
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      // Checked first: a script claiming to be the game's page can't keep waking rooms.
      if (await limited(env.CONNECT_LIMIT, request)) return new Response("Too many connections. Try again in a minute.", { status: 429 });
      const from = isRoomCode(code) ? await gameOrigin(env, slug, origin, url.searchParams.get("tester")) : null;
      if (!from) return new Response("Not allowed from here", { status: 403 });
      const game = await playableGame(env.DB, slug, requestCountryCode(request));
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

  // Every minute: games' schedules after a publish (game-server.ts). Once an hour: the relay's use per game (relay.ts).
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(syncSchedules(env));
    if (new Date(event.scheduledTime).getUTCMinutes() === 17) ctx.waitUntil(syncRelayUse(env, env.DB));
  },
} satisfies ExportedHandler<Env>;
