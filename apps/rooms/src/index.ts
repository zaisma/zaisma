import { PLAYER_REPORT_REASONS, createReport, listRooms, type PlayerReportReason } from "@zaisma/core";
import { guestName, isRoomCode, jwks, loadSigningKey, roomCode, signPass, type SigningKey } from "@zaisma/game-server";
import { gameServer } from "./registry.ts";

export { Room } from "./room.ts";

export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  PASS_LIMIT?: RateLimit;
  ROOM_LIMIT?: RateLimit;
  REPORT_LIMIT?: RateLimit;
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
const PASS_SECONDS = 24 * 3600;

export interface RoomGame {
  id: string;
  slug: string;
  status: string;
  current_version_id: string | null;
  game_server: string | null;
  room_browsing: string;
}

export async function playableGame(db: D1Database, slug: string): Promise<RoomGame | null> {
  const game = await db.prepare("SELECT id, slug, status, current_version_id, game_server, room_browsing FROM games WHERE slug = ?").bind(slug).first<RoomGame>();
  return game && game.status === "live" && game.current_version_id ? game : null;
}

/** The origin a game is served from. Only that origin may get passes or join its rooms. */
export async function isGameOrigin(env: Env, slug: string, origin: string | null): Promise<boolean> {
  if (!origin) return false;
  if (env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN) {
    if (origin === `https://${slug}.${env.GAME_DOMAIN}`) return true;
    const host = URL.canParse(origin) ? new URL(origin).hostname : "";
    const custom = await env.DB.prepare("SELECT 1 FROM domains JOIN games ON games.id = domains.game_id WHERE domains.hostname = ? AND games.slug = ?").bind(host, slug).first();
    return custom !== null && origin === `https://${host}`;
  }
  return origin === new URL(env.GAME_ORIGIN).origin;
}

let signing: { secret: string; key: Promise<SigningKey> } | null = null;
export function signingKey(env: Env): Promise<SigningKey> {
  if (signing?.secret !== env.PASS_SIGNING_KEY) signing = { secret: env.PASS_SIGNING_KEY, key: loadSigningKey(env.PASS_SIGNING_KEY) };
  return signing.key;
}

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
    return { slug: typeof body.game === "string" && /^[a-z0-9-]{1,40}$/.test(body.game) ? body.game : null, body };
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

    if (request.method === "POST" && (url.pathname === "/v1/pass" || url.pathname === "/v1/rooms" || url.pathname === "/v1/report")) {
      const { slug, body } = await readBody(request);
      if (!slug || !(await isGameOrigin(env, slug, origin))) return json({ error: "Not allowed from here." }, 403);
      const cors = origin!;
      const game = await playableGame(env.DB, slug);
      if (!game) return json({ error: "This game isn't available right now." }, 404, cors);

      if (url.pathname === "/v1/pass") {
        if (await limited(env.PASS_LIMIT, request)) return json({ error: "Too many requests. Try again in a minute." }, 429, cors);
        const now = Math.floor(Date.now() / 1000);
        const player = { id: `g_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, name: guestName() };
        const pass = await signPass(await signingKey(env), { sub: player.id, name: player.name, aud: slug, iss: env.ISSUER, kind: "guest", iat: now, exp: now + PASS_SECONDS });
        return json({ pass, player, expiresAt: (now + PASS_SECONDS) * 1000 }, 200, cors);
      }

      // A player reporting another player. Like every report, nothing about the reporter is kept.
      if (url.pathname === "/v1/report") {
        if (await limited(env.REPORT_LIMIT, request)) return json({ error: "Too many reports. Try again in a minute." }, 429, cors);
        const reason = str(body.reason, 20) as PlayerReportReason;
        const code = str(body.code, 6);
        const player = str(body.player, 40);
        if (!(reason in PLAYER_REPORT_REASONS) || !isRoomCode(code) || !player) return json({ error: "Choose what happened." }, 400, cors);
        await createReport(env.DB, {
          gameId: game.id,
          reason: "player",
          details: str(body.details, 500),
          versionId: game.current_version_id,
          roomCode: code,
          player: { id: player, name: str(body.name, 40), reason },
        });
        return json({ ok: true }, 200, cors);
      }

      if (!gameServer(game.game_server)) return json({ error: "This game doesn't use Zaisma rooms." }, 404, cors);
      if (await limited(env.ROOM_LIMIT, request)) return json({ error: "Too many requests. Try again in a minute." }, 429, cors);
      return json({ code: roomCode() }, 200, cors);
    }

    // The game's listed rooms, for games that show them themselves (Zaisma.rooms.list).
    const list = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})$/);
    if (list && request.method === "GET") {
      const slug = list[1]!;
      if (!(await isGameOrigin(env, slug, origin))) return json({ error: "Not allowed from here." }, 403);
      const game = await playableGame(env.DB, slug);
      if (!game || !gameServer(game.game_server)) return json({ error: "This game doesn't use Zaisma rooms." }, 404, origin!);
      if (game.room_browsing === "off") return json({ rooms: [], playing: { players: 0, rooms: 0, closed: 0 } }, 200, origin!);
      const found = await listRooms(env.DB, game.id, { near: request.cf?.continent as string | undefined, cacheSeconds: Number(env.ROOM_LIST_CACHE_SECONDS ?? 10) });
      const link = (code: string) => `${env.SITE_ORIGIN}/g/${slug}?room=${code}`;
      return json({ ...found, rooms: found.rooms.map((r) => ({ ...r, link: link(r.code) })) }, 200, origin!);
    }

    const m = url.pathname.match(/^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/);
    if (m && request.method === "GET") {
      const [, slug, code] = m as unknown as [string, string, string];
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      if (!isRoomCode(code) || !(await isGameOrigin(env, slug, origin))) return new Response("Not allowed from here", { status: 403 });
      const game = await playableGame(env.DB, slug);
      if (!game || !gameServer(game.game_server)) return new Response("This game isn't available right now", { status: 404 });

      const headers = new Headers(request.headers);
      headers.set("x-game-id", game.id);
      headers.set("x-game-slug", game.slug);
      headers.set("x-game-server", game.game_server!);
      headers.set("x-room-code", code);
      // Where the room's first player is, by continent, so room lists can say where it runs.
      headers.set("x-room-location", String(request.cf?.continent ?? ""));
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
