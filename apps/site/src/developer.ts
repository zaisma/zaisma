import {
  IMAGE_LIMITS,
  MAX_GAMES_PER_OWNER,
  accountById,
  accountForApiKey,
  addImage,
  applyDetails,
  audit,
  checkDetails,
  checkSlug,
  createGame,
  deleteImageRow,
  gameBySlug,
  imageById,
  imageKey,
  imagesForGame,
  newId,
  personOwner,
  slugify,
  sniffImage,
  versionsForGame,
  type Game,
  type GameImage,
  type ImageKind,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * The developer API: one API for the MCP, the upload command and the dashboard, so they always agree.
 * Callers sign in with an API key (Authorization: Bearer zsk_…) or, from our own pages, the session cookie.
 *
 *   GET    /api/dev/games                      your games
 *   POST   /api/dev/games                      make a game (starts as a draft)
 *   GET    /api/dev/games/:slug                one game, with its images and versions
 *   PATCH  /api/dev/games/:slug                title, description, visibility, devices, controls, screen
 *   POST   /api/dev/games/:slug/images?kind=   add a cover or screenshot (the image bytes as the body)
 *   DELETE /api/dev/games/:slug/images/:id     remove one
 *
 * Images are served from /img/:id once approved; owners can see their own before that.
 */

interface Caller {
  accountId: string;
  ownerId: string;
  actor: string;
  cookies: string[];
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200, cookies: string[] = []) => {
  const res = Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
};

export async function handleDeveloper(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path.startsWith("/img/")) return serveImage(request, env, path.slice(5));
  if (path !== "/api/dev" && !path.startsWith("/api/dev/")) return null;
  try {
    const caller = await authenticate(request, env);
    return await route(request, env, path.slice("/api/dev".length) || "/", caller);
  } catch (err) {
    if (err instanceof ApiError) return json({ error: { code: err.code, message: err.message } }, err.status);
    throw err;
  }
}

async function authenticate(request: Request, env: Env): Promise<Caller> {
  const header = request.headers.get("authorization");
  let accountId: string | null = null;
  let cookies: string[] = [];
  if (header) {
    const token = header.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
    accountId = await accountForApiKey(env.DB, token);
    if (!accountId) throw new ApiError(401, "bad_key", "That API key isn't valid. Make a new one on your account page.");
  } else {
    // From our own pages only: other sites can't use a signed-in player's cookie.
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "bad_origin", "Requests with a session must come from zaisma.com.");
    const session = await currentSession(request, env);
    if (!session) throw new ApiError(401, "signed_out", "Sign in, or send an API key as: Authorization: Bearer zsk_…");
    accountId = session.userId;
    cookies = session.cookies;
  }
  if (!(await accountById(env.DB, accountId))) throw new ApiError(401, "no_account", "Finish making your account first.");
  if (env.DEV_LIMIT && !(await env.DEV_LIMIT.limit({ key: accountId })).success) throw new ApiError(429, "slow_down", "Too many requests. Wait a minute and try again.");
  const owner = await personOwner(env.DB, accountId);
  return { accountId, ownerId: owner.id, actor: `account:${accountId}`, cookies };
}

async function route(request: Request, env: Env, path: string, caller: Caller): Promise<Response> {
  const method = request.method;
  const ok = (data: unknown, status = 200) => json(data, status, caller.cookies);

  if (path === "/games" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM games WHERE owner_id = ? ORDER BY updated_at DESC").bind(caller.ownerId).all<Game>();
    return ok({ games: results.map((g) => gameJson(env, g)) });
  }

  if (path === "/games" && method === "POST") {
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 80) throw new ApiError(400, "bad_title", "The title needs 1 to 80 characters.");
    const slug = typeof body.slug === "string" && body.slug ? body.slug.trim().toLowerCase() : slugify(title);
    const slugError = checkSlug(slug);
    if (slugError) throw new ApiError(400, "bad_slug", `Link name: ${slugError}`);
    if (await gameBySlug(env.DB, slug)) throw new ApiError(409, "slug_taken", `zaisma.com/g/${slug} is taken. Pick another link name.`);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE owner_id = ?").bind(caller.ownerId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_GAMES_PER_OWNER) throw new ApiError(403, "too_many_games", `You can have up to ${MAX_GAMES_PER_OWNER} games. Ask us if you need more.`);
    const checked = checkDetails({ ...body, title });
    if ("error" in checked) throw new ApiError(400, "bad_details", checked.error);
    let game = await createGame(env.DB, { slug, title, description: checked.change.description ?? "", ownerId: caller.ownerId, visibility: "draft" });
    await applyDetails(env.DB, game, { ...checked.change, title: undefined, description: undefined });
    game = (await gameBySlug(env.DB, slug))!;
    await audit(env.DB, game.id, "created", "Made through the developer API", caller.actor);
    return ok({ game: gameJson(env, game) }, 201);
  }

  const m = path.match(/^\/games\/([a-z0-9-]+)(?:\/images(?:\/([a-z0-9]+))?)?$/);
  if (!m) throw new ApiError(404, "not_found", "No such API path.");
  const game = await ownGame(env, m[1]!, caller);
  const images = path.includes("/images");

  if (!images && method === "GET") {
    const [imgs, versions] = await Promise.all([imagesForGame(env.DB, game.id), versionsForGame(env.DB, game.id)]);
    return ok({
      game: gameJson(env, game),
      images: imgs.map((i) => imageJson(env, i)),
      versions: versions.map((v) => ({ id: v.id, files: v.file_count, bytes: v.bytes, scan: v.scan_status, live: v.id === game.current_version_id, created_at: v.created_at })),
    });
  }

  if (!images && method === "PATCH") {
    const checked = checkDetails(await readJson(request));
    if ("error" in checked) throw new ApiError(400, "bad_details", checked.error);
    if (game.status === "removed" && checked.change.visibility) throw new ApiError(403, "removed", "This game was taken down, so its visibility can't change.");
    const { waiting } = await applyDetails(env.DB, game, checked.change);
    await audit(env.DB, game.id, "details", Object.keys(checked.change).join(", ") + (waiting ? " (words waiting for review)" : ""), caller.actor);
    return ok({ game: gameJson(env, (await gameBySlug(env.DB, game.slug))!), review: waiting ? "The new title or description shows once it's reviewed." : null });
  }

  if (images && !m[2] && method === "POST") {
    const kind = new URL(request.url).searchParams.get("kind") as ImageKind;
    if (kind !== "cover" && kind !== "screenshot") throw new ApiError(400, "bad_kind", "Add ?kind=cover or ?kind=screenshot.");
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > IMAGE_LIMITS.bytes) throw new ApiError(413, "image_too_big", "Images can be up to 5 MB.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > IMAGE_LIMITS.bytes) throw new ApiError(413, "image_too_big", "Images can be up to 5 MB.");
    const kindOf = sniffImage(bytes);
    if (!kindOf) throw new ApiError(415, "not_an_image", "Send a PNG, JPEG or WebP image as the request body.");
    const { width, height } = kindOf;
    if (Math.min(width, height) < IMAGE_LIMITS.minSide || Math.max(width, height) > IMAGE_LIMITS.maxSide) {
      throw new ApiError(400, "bad_size", `Images need to be at least ${IMAGE_LIMITS.minSide} px on each side and at most ${IMAGE_LIMITS.maxSide} px.`);
    }
    const existing = await imagesForGame(env.DB, game.id);
    const waiting = existing.filter((i) => i.kind === kind && i.status === "pending");
    if (kind === "screenshot" && existing.filter((i) => i.kind === "screenshot" && i.status !== "rejected").length >= IMAGE_LIMITS.screenshots) {
      throw new ApiError(400, "too_many_screenshots", `A game can have ${IMAGE_LIMITS.screenshots} screenshots. Remove one first.`);
    }
    if (kind === "cover" && waiting.length) {
      // Only the newest cover waits for review.
      for (const old of waiting) {
        await env.GAMES.delete(imageKey(old));
        await deleteImageRow(env.DB, old.id);
      }
    }
    const id = newId();
    await env.GAMES.put(imageKey({ game_id: game.id, id }), bytes, { httpMetadata: { contentType: kindOf.type } });
    const img = await addImage(env.DB, { id, game_id: game.id, kind, content_type: kindOf.type, width, height, bytes: bytes.byteLength });
    await audit(env.DB, game.id, "image-added", `${kind} ${id}`, caller.actor);
    return ok({ image: imageJson(env, img), review: "It shows on the game page once it's reviewed." }, 201);
  }

  if (images && m[2] && method === "DELETE") {
    const img = await imageById(env.DB, m[2]);
    if (!img || img.game_id !== game.id) throw new ApiError(404, "no_image", "This game has no image with that ID.");
    await env.GAMES.delete(imageKey(img));
    await deleteImageRow(env.DB, img.id);
    await audit(env.DB, game.id, "image-removed", `${img.kind} ${img.id}`, caller.actor);
    return ok({ removed: img.id });
  }

  throw new ApiError(405, "bad_method", `${method} isn't used here.`);
}

/** A game this caller owns. Someone else's game looks the same as no game. */
async function ownGame(env: Env, slug: string, caller: Caller): Promise<Game> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.owner_id !== caller.ownerId) throw new ApiError(404, "no_game", `You don't have a game at zaisma.com/g/${slug}.`);
  return game;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 64 * 1024) throw new ApiError(413, "too_big", "Send less than 64 KB of JSON.");
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new ApiError(400, "bad_json", "Send a JSON object.");
}

const list = (s: string) => (s ? s.split(",") : []);

function gameJson(env: Env, g: Game) {
  const draft = g.details_draft ? (JSON.parse(g.details_draft) as { title?: string; description?: string }) : null;
  return {
    slug: g.slug,
    url: `${env.SITE_ORIGIN}/g/${g.slug}`,
    title: g.title,
    description: g.description,
    visibility: g.visibility,
    // Ours, separate from visibility: pending (no version has passed review yet), live, held or removed.
    review: g.status,
    devices: list(g.devices),
    controls: list(g.controls),
    screen: g.screen,
    waiting_for_review: draft,
    updated_at: g.updated_at,
  };
}

function imageJson(env: Env, i: GameImage) {
  return { id: i.id, kind: i.kind, status: i.status, width: i.width, height: i.height, bytes: i.bytes, url: `${env.SITE_ORIGIN}/img/${i.id}`, created_at: i.created_at };
}

/**
 * Covers and screenshots. Only real PNG, JPEG or WebP files are stored (checked by their bytes),
 * and they're sent with headers that stop a browser treating them as anything else.
 */
async function serveImage(request: Request, env: Env, id: string): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!/^[a-z0-9]{1,40}$/.test(id) || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const img = await imageById(env.DB, id);
  if (!img || img.status === "rejected") return notFound();
  const game = await env.DB.prepare("SELECT status, owner_id FROM games WHERE id = ?").bind(img.game_id).first<{ status: string; owner_id: string | null }>();
  if (!game) return notFound();
  let cache = "public, max-age=3600";
  if (img.status !== "approved" || game.status === "removed") {
    // Before review only the owner sees it.
    const session = await currentSession(request, env);
    const owner = session ? await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(session.userId).first<{ id: string }>() : null;
    if (!owner || owner.id !== game.owner_id) return notFound();
    cache = "private, no-store";
  }
  const object = await env.GAMES.get(imageKey(img));
  if (!object) return notFound();
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "Content-Type": img.content_type,
      "Content-Length": String(object.size),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
