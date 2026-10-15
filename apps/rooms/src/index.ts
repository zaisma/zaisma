import { PLAYER_REPORT_REASONS, gameServerOf, type MultiplayerMode, checkText, createReport, iso, leaveOut, listRooms, newId, pastFreeTier, readLabelParam, readLeftParam, tidyText, useRoomKey, type PlayerReportReason } from "@zaisma/core";
import { ERROR_TEXT, guestName, isRoomCode, jwks, loadSigningKey, roomCode, signPass, type SigningKey } from "@zaisma/game-server";
import { usesRooms } from "./registry.ts";

export { Room } from "./room.ts";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  LOADER: WorkerLoader;
  ROOMS: DurableObjectNamespace;
  PASS_LIMIT?: RateLimit;
  ROOM_LIMIT?: RateLimit;
  REPORT_LIMIT?: RateLimit;
  FILTER_LIMIT?: RateLimit;
  CONNECT_LIMIT?: RateLimit;
  ISSUER: string;
  SITE_ORIGIN: string;
  GAME_HOST_MODE: "path" | "subdomain";
  GAME_ORIGIN: string;
  GAME_DOMAIN: string;
  PASS_SIGNING_KEY: string;
  /** How long each place keeps a copy of a game's room list. 10 unless set (tests set 0). */
  ROOM_LIST_CACHE_SECONDS?: string;
}

/** Guest passes last a day; the SDK keeps them only for the browser tab. */
const PASS_DURATION_SEC = 24 * 3600;

/** A game's room list when it lists its rooms nowhere (room_browsing off). */
function emptyRoomList() {
  return { rooms: [], playingNow: { playerCount: 0, roomCount: 0, closedRoomCount: 0 }, joinableRoomCount: 0, openRoomCount: 0, regions: [], regionCode: null, moreRoomCount: 0, labelFilters: [] };
}

/** What rooms need of a game: its columns of the same names, and the game server its rooms run (gameServerOf). */
export interface RoomGame {
  id: string;
  slug: string;
  review_status: string;
  live_version_id: string | null;
  multiplayer_mode: MultiplayerMode;
  built_in_server: string | null;
  room_browsing: string;
}

export async function playableGame(db: D1Database, slug: string): Promise<RoomGame | null> {
  const game = await db.prepare("SELECT id, slug, review_status, live_version_id, multiplayer_mode, built_in_server, room_browsing FROM games WHERE slug = ?").bind(slug).first<RoomGame>();
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
 * What this API answers when it refuses: { error: { code, message } }, code lowercase snake_case
 * (bad_origin, game_unavailable, slow_down, unchecked, unknown_field, missing_field, bad_reason,
 * bad_room_code, no_rooms, month_limit), as the SDK's errors carry it (err.code).
 */
function refusal(code: string, message: string, httpStatus: number, origin?: string): Response {
  return json({ error: { code, message } }, httpStatus, origin);
}

/** The fields each call takes; anything else is refused (unknown_field), never quietly ignored. */
const FIELDS: Record<string, readonly string[]> = {
  "/v1/pass": ["gameSlug", "roomKey"],
  "/v1/rooms": ["gameSlug"],
  "/v1/report": ["gameSlug", "roomCode", "playerId", "playerName", "reason", "details"],
  "/v1/filter": ["gameSlug", "text"],
};

function json(body: unknown, status = 200, origin?: string): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return Response.json(body, { status, headers });
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

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max).replace(/[\u0000-\u001f]/g, " ").trim() : "");

async function limited(limit: RateLimit | undefined, request: Request): Promise<boolean> {
  // Keyed by connection address, checked by Cloudflare and never stored.
  return limit ? !(await limit.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success : false;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (url.pathname === "/.well-known/jwks.json") {
      const key = await signingKey(env);
      return Response.json(jwks([key.publicKey]), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
    }

    if (request.method === "POST" && (url.pathname === "/v1/pass" || url.pathname === "/v1/rooms" || url.pathname === "/v1/report" || url.pathname === "/v1/filter")) {
      const { slug, body } = await readBody(request);
      if (!slug || !(await isGameOrigin(env, slug, origin))) return refusal("bad_origin", "Not allowed from here: only the game's own pages can call this.", 403);
      const cors = origin!;
      const unknown = Object.keys(body).filter((name) => !FIELDS[url.pathname]!.includes(name));
      if (unknown.length) return refusal("unknown_field", `${url.pathname} doesn't take ${unknown.join(", ")}. It takes ${FIELDS[url.pathname]!.join(", ")}.`, 400, cors);
      const game = await playableGame(env.DB, slug);
      if (!game) return refusal("game_unavailable", ERROR_TEXT.game_unavailable, 404, cors);
      const slowDown = () => refusal("slow_down", "Too many requests. Try again in a minute.", 429, cors);

      // Zaisma's text filter, for games that want to check what players type (Zaisma.filterText).
      if (url.pathname === "/v1/filter") {
        if (await limited(env.FILTER_LIMIT, request)) return slowDown();
        const text = tidyText(body.text, 500);
        const checked = checkText(text);
        return json({ text, isAllowed: checked.ok, reason: checked.reason ?? null }, 200, cors);
      }

      if (url.pathname === "/v1/pass") {
        if (await limited(env.PASS_LIMIT, request)) return slowDown();
        // Only for a browser Cloudflare's check on Play said is real: the game page's key, a few passes each.
        if (!(await useRoomKey(env.DB, game.id, body.roomKey))) return refusal("unchecked", "Zaisma couldn't check this browser, so it can't play online. Reload the game to try again.", 403, cors);
        const now = Math.floor(Date.now() / 1000);
        const player = { id: newId("player"), name: guestName() };
        const pass = await signPass(await signingKey(env), { sub: player.id, name: player.name, aud: slug, iss: env.ISSUER, kind: "guest", iat: now, exp: now + PASS_DURATION_SEC });
        return json({ pass, player, passExpiresAt: iso((now + PASS_DURATION_SEC) * 1000) }, 200, cors);
      }

      // A player reporting another player. Like every report, nothing about the reporter is kept.
      if (url.pathname === "/v1/report") {
        if (await limited(env.REPORT_LIMIT, request)) return refusal("slow_down", "Too many reports. Try again in a minute.", 429, cors);
        const reason = str(body.reason, 20) as PlayerReportReason;
        const reportedRoomCode = str(body.roomCode, 6);
        const playerId = str(body.playerId, 40);
        if (!(reason in PLAYER_REPORT_REASONS)) return refusal("bad_reason", `Choose what happened: reason is one of ${Object.keys(PLAYER_REPORT_REASONS).join(", ")}.`, 400, cors);
        if (!isRoomCode(reportedRoomCode)) return refusal("bad_room_code", "roomCode isn't a room code, like the one room.roomCode holds.", 400, cors);
        if (!playerId) return refusal("missing_field", "playerId is missing: the ID of the player being reported.", 400, cors);
        await createReport(env.DB, {
          gameId: game.id,
          reason: "player",
          details: str(body.details, 500),
          versionId: game.live_version_id,
          roomCode: reportedRoomCode,
          player: { id: playerId, name: str(body.playerName, 40), reason },
        });
        return json({ isSent: true }, 200, cors);
      }

      if (!usesRooms(gameServerOf(game))) return refusal("no_rooms", "This game doesn't use Zaisma rooms.", 404, cors);
      if (await limited(env.ROOM_LIMIT, request)) return slowDown();
      if (await pastFreeTier(env.DB, game.id)) return refusal("month_limit", ERROR_TEXT.month_limit, 403, cors);
      return json({ roomCode: roomCode() }, 200, cors);
    }

    // The game's listed rooms, for games that show them themselves (Zaisma.rooms.list).
    const list = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})$/);
    if (list && request.method === "GET") {
      const slug = list[1]!;
      const from = await gameOrigin(env, slug, origin);
      if (!from) return refusal("bad_origin", "Not allowed from here: only the game's own pages can call this.", 403);
      const game = await playableGame(env.DB, slug);
      if (!game || !usesRooms(gameServerOf(game))) return refusal("no_rooms", "This game doesn't use Zaisma rooms.", 404, origin!);
      const unknown = [...url.searchParams.keys()].filter((name) => !["regionCode", "labels", "left"].includes(name));
      if (unknown.length) return refusal("unknown_field", `The room list doesn't take ${unknown.join(", ")}. It takes regionCode and labels.`, 400, origin!);
      if (game.room_browsing === "off") return json(emptyRoomList(), 200, origin!);
      // The SDK says which room this player just left, so they don't see themselves in it while lists catch up.
      const left = readLeftParam(url.searchParams.get("left"));
      const listed = await listRooms(env.DB, game.id, {
        country: request.cf?.country as string | undefined,
        continent: request.cf?.continent as string | undefined,
        region: url.searchParams.get("regionCode"),
        labels: readLabelParam(url.searchParams.get("labels")),
        cacheSeconds: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10),
      });
      const { rowChangedAtMs: _, ...found } = left ? leaveOut(listed, left) : listed;
      const inviteUrl = (code: string) => `${env.SITE_ORIGIN}${from.page}?room=${code}`;
      return json({ ...found, rooms: found.rooms.map((room) => ({ ...room, inviteUrl: inviteUrl(room.roomCode) })) }, 200, origin!);
    }

    const m = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/);
    if (m && request.method === "GET") {
      const [, slug, code] = m as unknown as [string, string, string];
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
      } catch (err) {
        // Past the free plan's daily Durable Object limit, say so instead of failing silently.
        console.error("Room unavailable:", err);
        return new Response("Rooms are busy. Try again soon.", { status: 503 });
      }
    }

    if (url.pathname === "/") return Response.redirect(env.SITE_ORIGIN, 302);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
