import {
  IMAGE_LIMITS,
  isSquare,
  MAXIMUM_GAME_COUNT_PER_OWNER,
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
  heldImageKey,
  iso,
  KNOWN_IMAGE_CODE,
  REVIEW_CODES,
  readReviewReason,
  reviewReason,
  reviewReasonAnswer,
  type Finding,
  type ReviewCodeName,
  imagesForGame,
  newId,
  personOwner,
  readPlayModes,
  slugify,
  sniffImage,
  versionsForGame,
  type Game,
  type GameImage,
  type ImageKind,
  FILE_LIMITS,
  UploadError,
  addBlob,
  blobKey,
  checkUploadList,
  createVersion,
  forbiddenContent,
  manifestKey,
  serverModules,
  type Manifest,
  missingBlobs,
  locateBlobs,
  addOwnedBlob,
  ownedBlobKey,
  publishVersion,
  toManifest,
  versionById,
  type ScanReport,
  type UploadFile,
  type Version,
  REPORT_REASONS,
  MAXIMUM_TESTER_LINK_COUNT,
  addTesterLink,
  revokeTesterLink,
  testerLinks,
  type TesterLink,
  type ReportReason,
  FREE_ROOM_PLAY_DURATION_HOURS,
  FREE_REQUEST_COUNT_PER_MONTH,
  roomPlayDurationSecThisMonth,
  requestCountThisMonth,
  ApiError,
  checkIdKind,
  isIdOf,
  playerProfile,
  secondsUntilDayPasses,
  type ErrorCode,
  MAXIMUM_REDIRECT_URL_COUNT,
  MAXIMUM_SIGN_IN_APP_COUNT,
  SIGN_IN_APP_KINDS,
  checkRedirectUrl,
  checkSignInAppName,
  createSignInApp,
  deleteSignInApp,
  redirectUrlsOf,
  signInAppById,
  signInAppsFor,
  updateSignInApp,
  type SignInApp,
  type SignInAppKind,
  MAXIMUM_WEBHOOK_COUNT,
  WEBHOOK_EVENT_KINDS,
  checkEndpointUrl,
  createWebhook,
  deleteWebhook,
  deliveriesFor,
  deliveryCountsFor,
  eventKindsOf,
  gameSlugsOf,
  updateWebhook,
  webhookById,
  webhooksFor,
  type Webhook,
  type WebhookDelivery,
  type WebhookEventKind,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { forumRoute } from "./forum.ts";
import { databaseRoute } from "./game-database.ts";
import { playStats } from "./plays.ts";
import { sendAlert } from "./email.ts";
import { KNOWN_IMAGE_ALERT, imageMatcher, pruneVersions } from "./scan.ts";
import { sendTestEvent, tellWebhooks, type WaitUntil } from "./webhooks.ts";

/**
 * The developer API: one API for the MCP, the upload command and the dashboard, so they always agree.
 * Callers sign in with an API key (Authorization: Bearer zsk_…) or, from our own pages, the session cookie.
 * Rows are stored with the names the API shows (docs/NAMING.md), so answers pass them through and only
 * change a value's form: times become ISO, 0 and 1 become false and true, stored JSON becomes objects.
 *
 *   GET    /api/dev/games                      your games
 *   POST   /api/dev/games                      make a game (starts as a draft)
 *   GET    /api/dev/games/:slug                one game, with its images, versions and tester links
 *   PATCH  /api/dev/games/:slug                title, description, visibility, devices, controls, screen_orientation, play_modes, cloud_saves_enabled, room_browsing, multiplayer_mode, account_requirement
 *   POST   /api/dev/games/:slug/images?kind=   add a cover or screenshot (the image bytes as the body)
 *   DELETE /api/dev/games/:slug/images/:id     remove one
 *   POST   /api/dev/games/:slug/uploads        which of these files still need sending
 *   PUT    /api/dev/files/:sha256              send one file
 *   POST   /api/dev/games/:slug/versions       make a version from stored files (scanned, then a draft)
 *   GET    /api/dev/games/:slug/versions/:id   scan result, findings and preview link
 *   POST   /api/dev/games/:slug/versions/:id/publish   publish a draft or roll back; { "scheduled_publish_at" } publishes later
 *   DELETE /api/dev/games/:slug/versions/:id/publish   cancel a publish-later
 *   POST   /api/dev/files/:sha256/parts        send a big file in parts (see bigFile)
 *   GET    /api/dev/games/:slug/reports        what players reported, by reason
 *   GET    /api/dev/games/:slug/stats          plays, play time, players coming back and multiplayer use
 *   GET    /api/dev/games/:slug/history        what happened to the game, and who did it
 *   GET    /api/dev/games/:slug/testers        tester links that are on
 *   POST   /api/dev/games/:slug/testers        make a tester link: { "name" }
 *   DELETE /api/dev/games/:slug/testers/:id    turn one off for good
 *   GET    /api/dev/games/:slug/database       the game database's tables, indexes and use this month (see game-database.ts)
 *   POST   /api/dev/games/:slug/database/query run one SQL statement: { "sql", "values" }
 *   POST   /api/dev/games/:slug/database/batch run several in one transaction: { "statements" }
 *   GET    /api/dev/sign-in-apps               your sign-in apps (Sign in with Zaisma, see sign-in.ts)
 *   POST   /api/dev/sign-in-apps               make one: { "name", "kind", "redirect_urls" }; a confidential app's client_secret is answered once
 *   PATCH  /api/dev/sign-in-apps/:id           name, redirect_urls, or replace_client_secret: true
 *   DELETE /api/dev/sign-in-apps/:id           delete one, with every player's yes to it
 *   GET    /api/dev/webhooks                   your webhooks (see webhooks.ts)
 *   POST   /api/dev/webhooks                   make one: { "endpoint_url", "event_kinds", "game_slugs" }; its signing_secret is answered once
 *   PATCH  /api/dev/webhooks/:id               endpoint_url, event_kinds, game_slugs, or replace_signing_secret: true
 *   DELETE /api/dev/webhooks/:id               delete one, with what was on its way to it
 *   POST   /api/dev/webhooks/:id/test          send it a test event now, and say how it went
 *   GET    /api/dev/webhooks/:id/deliveries    what was sent to it in the last 30 days, and how each went
 *   …/api/dev/forum                            the developer forum: topics, replies, Me too (see forum.ts)
 *
 * API_ROUTES, above route(), is the full list the router answers; keep this one in step with it.
 *
 * Every refusal answers { "error": { code, message, field, fix, retry_after_sec } }, its code from
 * ERROR_CODES (@zaisma/core), and every call that changes something answers with next_steps
 * (docs/NAMING.md), except the steps of sending files, whose next call is always the one that uses them.
 *
 * Images are served from /img/:id once approved; owners can see their own before that.
 */

export interface Caller {
  accountId: string;
  ownerId: string;
  actor: string;
  cookies: string[];
  /** How the call came in: an API key, the MCP (an AI, always) or our own pages (the developer). */
  via: "api" | "mcp" | "dashboard";
  /** What the caller says it is (X-Zaisma-Client), like "cli". Only for labels; never trusted for anything else. */
  client?: string;
  /** Keeps work going after the answer (the Worker's ctx.waitUntil), like sending webhook events; without it, that work is waited for. */
  waitUntil?: WaitUntil;
}

/** A call that usually follows a change, ready to make (docs/NAMING.md, Next steps). */
export interface NextStep {
  /** The MCP tool's name. */
  tool: string;
  /** What to send it, filled in as far as Zaisma knows. */
  arguments: Record<string, unknown>;
  after_sec: number | null;
  reason: string;
}

const json = (body: unknown, httpStatus = 200, cookies: string[] = []) => {
  const response = Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
};

/** An error as the API answers it, with Retry-After when waiting helps. */
export function errorResponse(error: ApiError): Response {
  const response = json(error.toAnswer(), error.httpStatus);
  if (error.retryAfterSec !== null) response.headers.set("Retry-After", String(error.retryAfterSec));
  return response;
}

/** Our own failure, as an error answer: the caller can tell it isn't their mistake, and what to do. */
export const INTERNAL_ERROR = () =>
  new ApiError("internal_error", {
    message: "Something went wrong on Zaisma's side.",
    fix: "Try once more. If it happens again, tell Zaisma with post_topic (kind bug, category api or mcp): the call, what you sent and this error.",
  });

export async function handleDeveloper(request: Request, env: Env, path: string, ctx?: ExecutionContext): Promise<Response | null> {
  if (path.startsWith("/img/")) return serveImage(request, env, path.slice(5));
  if (path !== "/api/dev" && !path.startsWith("/api/dev/")) return null;
  try {
    const caller = await authenticate(request, env);
    if (ctx) caller.waitUntil = (promise) => ctx.waitUntil(promise);
    return await route(request, env, path.slice("/api/dev".length) || "/", caller);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Developer API call failed", error);
    return errorResponse(INTERNAL_ERROR());
  }
}

export async function authenticate(request: Request, env: Env): Promise<Caller> {
  const header = request.headers.get("authorization");
  let accountId: string | null = null;
  let cookies: string[] = [];
  if (header) {
    const token = header.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
    accountId = await accountForApiKey(env.DB, token);
    if (!accountId) throw new ApiError("bad_key", { message: "That API key isn't valid: it was removed, mistyped or never made.", field: "Authorization", fix: "Make a new key on zaisma.com/account (under Game developers) and send it as: Authorization: Bearer zsk_…" });
  } else {
    // From our own pages only: other sites can't use a signed-in player's cookie.
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
      throw new ApiError("bad_origin", { message: "A call with a session came from another site.", fix: "Call from zaisma.com, or send an API key as: Authorization: Bearer zsk_…" });
    }
    const session = await currentSession(request, env);
    if (!session) throw new ApiError("signed_out", { message: "There's no API key and no signed-in session.", field: "Authorization", fix: "Send an API key from zaisma.com/account as: Authorization: Bearer zsk_…" });
    accountId = session.userId;
    cookies = session.cookies;
  }
  // Sending a game's files is many small requests, so it has its own, bigger allowance.
  const rateLimit = new URL(request.url).pathname.startsWith("/api/dev/files/") ? env.FILE_LIMIT : env.DEV_LIMIT;
  if (rateLimit && !(await rateLimit.limit({ key: accountId })).success) {
    throw new ApiError("slow_down", { message: "Too many calls in the last minute.", fix: "Wait a minute, then carry on; up to 120 calls a minute (1,000 for sending files).", retryAfterSec: 60 });
  }
  const caller = await callerFor(env, accountId, cookies);
  if (!caller) throw new ApiError("no_account", { message: "The account isn't finished yet.", fix: "Finish making it at zaisma.com/account, then call again." });
  if (header) caller.via = "api";
  const client = request.headers.get("x-zaisma-client");
  if (client) caller.client = client.slice(0, 20);
  return caller;
}

/** The caller for a signed-in account, or null when the account isn't finished. */
export async function callerFor(env: Env, accountId: string, cookies: string[] = []): Promise<Caller | null> {
  if (!(await accountById(env.DB, accountId))) return null;
  const owner = await personOwner(env.DB, accountId);
  return { accountId, ownerId: owner.id, actor: `account:${accountId}`, cookies, via: "dashboard" };
}

/**
 * Call the API from inside the site (the MCP and the dashboard), as this caller. Answers the JSON;
 * refusals throw ApiError with the same codes and messages API callers get.
 */
export async function apiCall(env: Env, caller: Caller, method: string, path: string, payload?: unknown): Promise<Record<string, unknown>> {
  const isRaw = payload instanceof Uint8Array;
  const body = isRaw ? payload : payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload));
  const request = new Request(`${env.SITE_ORIGIN}/api/dev${path}`, {
    method,
    headers: { ...(body ? { "content-length": String(body.byteLength) } : {}), ...(body && !isRaw ? { "content-type": "application/json" } : {}) },
    body,
  });
  const response = await route(request, env, path.split("?")[0]!, caller);
  return (await response.json()) as Record<string, unknown>;
}

/** One developer API call: its method and its path under /api/dev, where :name stands for one path part. */
export interface ApiRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
}

/**
 * Every developer API call. The router answers only these (anything else is not_found or bad_method),
 * so this is the API as it is; test/site/api-mcp-parity.test.ts holds it to the MCP's tools.
 */
export const API_ROUTES: readonly ApiRoute[] = [
  { method: "GET", path: "/games" },
  { method: "POST", path: "/games" },
  { method: "GET", path: "/games/:slug" },
  { method: "PATCH", path: "/games/:slug" },
  { method: "POST", path: "/games/:slug/images" },
  { method: "DELETE", path: "/games/:slug/images/:image_id" },
  { method: "POST", path: "/games/:slug/uploads" },
  { method: "PUT", path: "/files/:sha256" },
  { method: "POST", path: "/files/:sha256/parts" },
  { method: "PUT", path: "/files/:sha256/parts/:part_number" },
  { method: "POST", path: "/files/:sha256/parts/done" },
  { method: "POST", path: "/games/:slug/versions" },
  { method: "GET", path: "/games/:slug/versions/:version_id" },
  { method: "POST", path: "/games/:slug/versions/:version_id/publish" },
  { method: "DELETE", path: "/games/:slug/versions/:version_id/publish" },
  { method: "GET", path: "/games/:slug/reports" },
  { method: "GET", path: "/games/:slug/stats" },
  { method: "GET", path: "/games/:slug/history" },
  { method: "GET", path: "/games/:slug/testers" },
  { method: "POST", path: "/games/:slug/testers" },
  { method: "DELETE", path: "/games/:slug/testers/:tester_id" },
  { method: "GET", path: "/games/:slug/database" },
  { method: "POST", path: "/games/:slug/database/query" },
  { method: "POST", path: "/games/:slug/database/batch" },
  { method: "GET", path: "/forum" },
  { method: "POST", path: "/forum" },
  { method: "GET", path: "/forum/similar" },
  { method: "GET", path: "/forum/people" },
  { method: "POST", path: "/forum/media" },
  { method: "GET", path: "/forum/:topic_id" },
  { method: "POST", path: "/forum/:topic_id/posts" },
  { method: "POST", path: "/forum/:topic_id/vote" },
  { method: "DELETE", path: "/forum/:topic_id/vote" },
  { method: "POST", path: "/forum/:topic_id/follow" },
  { method: "DELETE", path: "/forum/:topic_id/follow" },
  { method: "POST", path: "/forum/:topic_id/answer" },
  { method: "POST", path: "/forum/:topic_id/misplaced" },
  { method: "POST", path: "/forum/:topic_id/still-happening" },
  { method: "POST", path: "/forum/:topic_id/posts/:post_id/helpful" },
  { method: "DELETE", path: "/forum/:topic_id/posts/:post_id/helpful" },
  { method: "POST", path: "/forum/:topic_id/posts/:post_id/report" },
  { method: "GET", path: "/forum/:topic_id/media/:media_id" },
  { method: "GET", path: "/players/:player_id" },
  { method: "GET", path: "/sign-in-apps" },
  { method: "POST", path: "/sign-in-apps" },
  { method: "PATCH", path: "/sign-in-apps/:sign_in_app_id" },
  { method: "DELETE", path: "/sign-in-apps/:sign_in_app_id" },
  { method: "GET", path: "/webhooks" },
  { method: "POST", path: "/webhooks" },
  { method: "PATCH", path: "/webhooks/:webhook_id" },
  { method: "DELETE", path: "/webhooks/:webhook_id" },
  { method: "POST", path: "/webhooks/:webhook_id/test" },
  { method: "GET", path: "/webhooks/:webhook_id/deliveries" },
];

const routePatterns = new Map(
  API_ROUTES.map((apiRoute) => [apiRoute, new RegExp(`^${apiRoute.path.replace(/:[a-z0-9_]+/g, (name) => (name === ":sha256" ? "[0-9a-f]{64}" : "[^/]+"))}$`)]),
);

/** The calls at a path (without its query), the most specific first: /forum/people before /forum/:topic_id. */
export function apiRoutesAt(path: string): ApiRoute[] {
  const placeholderCount = (apiRoute: ApiRoute) => apiRoute.path.split(":").length;
  return API_ROUTES.filter((apiRoute) => routePatterns.get(apiRoute)!.test(path)).sort((first, second) => placeholderCount(first) - placeholderCount(second));
}

export async function route(request: Request, env: Env, path: string, caller: Caller): Promise<Response> {
  const method = request.method;
  const answer = (body: unknown, httpStatus = 200) => json(body, httpStatus, caller.cookies);

  if (path === "/games" && method === "GET") {
    const [{ results: games }, unread] = await Promise.all([
      env.DB.prepare("SELECT * FROM games WHERE owner_id = ? ORDER BY updated_at_ms DESC").bind(caller.ownerId).all<Game>(),
      env.DB.prepare("SELECT COUNT(*) AS topic_count FROM forum_topics WHERE account_id = ? AND news_at_ms > COALESCE(seen_at_ms, 0)").bind(caller.accountId).first<{ topic_count: number }>(),
    ]);
    // Your forum topics with a reply or change from Zaisma you haven't opened yet.
    return answer({ games: games.map((game) => gameJson(env, game)), unread_topic_count: unread?.topic_count ?? 0 });
  }

  // The first feedback calls are gone: everything they did is in the forum.
  if (path === "/feedback" || path.startsWith("/feedback/")) {
    throw new ApiError("gone", { message: "The feedback calls are gone; everything they did is in the developer forum.", fix: "Use search_forum (GET /forum?tab=yours or ?tab=messages) for your topics and messages, and post_topic or message_zaisma (POST /forum) to post." });
  }
  const routes = apiRoutesAt(path);
  if (routes.length === 0) throw new ApiError("not_found", { message: `There's no API call at ${path}.`, fix: "docs/DEVELOPER-API.md lists every call; paths start with /api/dev, like GET /api/dev/games." });
  if (!routes.some((apiRoute) => apiRoute.method === method)) throw badMethod(method, path);
  if (path === "/forum" || path.startsWith("/forum/")) {
    const routed = await forumRoute(request, env, path, caller);
    return routed instanceof Response ? routed : answer(...routed);
  }

  // An account's public profile, the same as any game or server gets at <rooms>/v1/players/<id>.
  const playerPath = path.match(/^\/players\/([^/]+)$/);
  if (playerPath && method === "GET") {
    const playerId = decodeURIComponent(playerPath[1]!);
    const playerFix = "Take player IDs from your game: a room's players, or the sub of a player pass your server checked.";
    checkIdKind("player", playerId, "player_id", playerFix);
    const profile = await playerProfile(env.DB, playerId);
    if (!profile) throw new ApiError("no_player", { message: `No account has the player ID ${playerId}. Guests have no profile, and a deleted account's is gone.`, field: "player_id", fix: playerFix });
    return answer({ player: profile });
  }

  if (path === "/games" && method === "POST") {
    const body = await readJson(request);
    closedBody(body, ["title", "slug", "description", "devices", "controls", "screen_orientation", "play_modes", "cloud_saves_enabled", "multiplayer_mode", "room_browsing", "account_requirement"]);
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 80) throw new ApiError("bad_title", { message: "title is empty or over 80 characters.", field: "title", fix: "Give the game a title of 1 to 80 characters." });
    const slug = typeof body.slug === "string" && body.slug ? body.slug.trim().toLowerCase() : slugify(title);
    const slugError = checkSlug(slug);
    if (slugError) throw new ApiError("bad_slug", { message: `The link name ${JSON.stringify(slug)} can't be used: ${slugError}`, field: "slug", fix: 'Give a slug of lowercase letters, numbers and single hyphens, like "sky-hopper", or leave it out to make one from the title.' });
    if (await gameBySlug(env.DB, slug)) {
      const isFromTitle = !(typeof body.slug === "string" && body.slug);
      throw new ApiError("slug_taken", {
        message: `zaisma.com/g/${slug} is taken.`,
        field: isFromTitle ? "title" : "slug",
        fix: isFromTitle ? `The link name comes from the title: give another title, or a slug of your own, like "${slug}-game".` : `Pick another slug, like "${slug}-game".`,
      });
    }
    const owned = await env.DB.prepare("SELECT COUNT(*) AS game_count FROM games WHERE owner_id = ?").bind(caller.ownerId).first<{ game_count: number }>();
    if ((owned?.game_count ?? 0) >= MAXIMUM_GAME_COUNT_PER_OWNER) {
      throw new ApiError("too_many_games", { message: `You have ${MAXIMUM_GAME_COUNT_PER_OWNER} games, the most an account can have.`, fix: "Ask Zaisma (message_zaisma, kind gap) if you need more." });
    }
    const checked = checkDetailsOrThrow({ ...body, title });
    let game = await createGame(env.DB, { slug, title, description: checked.description ?? "", ownerId: caller.ownerId, visibility: "draft" });
    await applyDetails(env.DB, game, { ...checked, title: undefined, description: undefined });
    game = (await gameBySlug(env.DB, slug))!;
    await audit(env.DB, game.id, "created", "Made through the developer API", caller.actor);
    return answer(
      {
        game: gameJson(env, game),
        next_steps: [
          {
            tool: "upload_files",
            arguments: { slug: game.slug },
            after_sec: null,
            reason: `Upload the game next: upload_files with its files for a small game (under 5 MB), or npx @zaisma/cli upload <folder> --game ${game.slug} in a terminal.`,
          },
        ] satisfies NextStep[],
      },
      201,
    );
  }

  // One file of a game, by its SHA-256. Storage checks the hash, so a file can't claim to be another.
  const blobPath = path.match(/^\/files\/([0-9a-f]{64})$/);
  if (blobPath && method === "PUT") return answer(await putBlob(request, env, blobPath[1]!));
  const partsPath = path.match(/^\/files\/([0-9a-f]{64})\/parts(?:\/([^/]+))?$/);
  if (partsPath) return answer(await bigFile(request, env, partsPath[1]!, partsPath[2], caller));

  // Slugs and IDs match anything here, so a wrong one says which game or version it didn't find.
  const versionPath = path.match(/^\/games\/([^/]+)\/(uploads|versions)(?:\/([^/]+)(\/publish)?)?$/);
  if (versionPath) return answer(...(await versionRoute(request, env, await ownGame(env, versionPath[1]!, caller), versionPath[2]!, versionPath[3], Boolean(versionPath[4]), caller)));

  const factsPath = path.match(/^\/games\/([^/]+)\/(reports|stats|history)$/);
  if (factsPath && method === "GET") {
    const game = await ownGame(env, factsPath[1]!, caller);
    const query = new URL(request.url).searchParams;
    if (factsPath[2] === "reports") {
      closedQuery(query, ["cursor"]);
      return answer(await reportsFor(env, game, query.get("cursor")));
    }
    if (factsPath[2] === "stats") {
      closedQuery(query, ["period_duration_days"]);
      return answer(await statsFor(env, game, readPeriodDurationDays(query.get("period_duration_days"))));
    }
    return answer(await historyFor(env, game, caller));
  }

  const signInAppPath = path.match(/^\/sign-in-apps(?:\/([^/]+))?$/);
  if (signInAppPath) return answer(...(await signInAppRoute(request, env, signInAppPath[1] ? decodeURIComponent(signInAppPath[1]) : undefined, caller)));

  const webhookPath = path.match(/^\/webhooks(?:\/([^/]+)(?:\/(test|deliveries))?)?$/);
  if (webhookPath) return answer(...(await webhookRoute(request, env, webhookPath[1] ? decodeURIComponent(webhookPath[1]) : undefined, webhookPath[2] as "test" | "deliveries" | undefined, caller)));

  const testerPath = path.match(/^\/games\/([^/]+)\/testers(?:\/([^/]+))?$/);
  if (testerPath) return answer(...(await testerRoute(request, env, await ownGame(env, testerPath[1]!, caller), testerPath[2], caller)));

  const databasePath = path.match(/^\/games\/([^/]+)\/database(?:\/(query|batch))?$/);
  if (databasePath) return answer(...(await databaseRoute(request, env, await ownGame(env, databasePath[1]!, caller), databasePath[2])));

  const gamePath = path.match(/^\/games\/([^/]+)(\/images(?:\/([^/]+))?)?$/);
  if (!gamePath) throw new ApiError("not_found", { message: `There's no API call at ${path}.`, fix: "docs/DEVELOPER-API.md lists every call; paths start with /api/dev, like GET /api/dev/games." });
  const game = await ownGame(env, gamePath[1]!, caller);
  const isImages = Boolean(gamePath[2]);

  if (!isImages && method === "GET") {
    const [images, versions, testers] = await Promise.all([imagesForGame(env.DB, game.id), versionsForGame(env.DB, game.id), testerLinks(env.DB, game.id)]);
    return answer({
      game: gameJson(env, game),
      images: images.map((image) => imageJson(env, image)),
      versions: versions.map((version) => versionJson(env, game, version)),
      testers: testers.map((link) => testerJson(env, link)),
    });
  }

  if (!isImages && method === "PATCH") {
    const body = await readJson(request);
    closedBody(body, ["title", "description", "visibility", "devices", "controls", "screen_orientation", "play_modes", "cloud_saves_enabled", "room_browsing", "multiplayer_mode", "account_requirement"]);
    const change = checkDetailsOrThrow(body);
    if (game.review_status === "removed" && change.visibility) {
      throw gameRemoved(game, "its visibility can't change", "visibility");
    }
    const { multiplayer_mode: multiplayerMode, ...details } = change;
    const changesMultiplayer = multiplayerMode !== undefined && multiplayerMode !== game.multiplayer_mode;
    if (changesMultiplayer && game.multiplayer_mode === "built-in") {
      throw new ApiError("built_in_server", { message: "This game runs a game server built into Zaisma, which only Zaisma changes.", field: "multiplayer_mode", fix: "Leave multiplayer_mode out, or ask Zaisma with message_zaisma to change it." });
    }
    const { isWaitingForReview } = await applyDetails(env.DB, game, { ...details, ...(changesMultiplayer ? { multiplayer_mode: multiplayerMode } : {}) });
    if (Object.keys(details).length) await audit(env.DB, game.id, "details", Object.keys(details).join(", ") + (isWaitingForReview ? " (words waiting for review)" : ""), caller.actor);
    if (changesMultiplayer) await audit(env.DB, game.id, "multiplayer", `Multiplayer: ${multiplayerMode}`, caller.actor);
    const gameServerProblem = multiplayerMode === "own" ? await liveServerProblem(env, game) : null;
    const changed = (await gameBySlug(env.DB, game.slug))!;
    return answer({
      game: gameJson(env, changed),
      review_message: isWaitingForReview ? "The new title or description shows once it's reviewed." : null,
      game_server_problem: gameServerProblem,
      next_steps: await nextStepsAfterDetails(env, changed, gameServerProblem),
    });
  }

  if (isImages && !gamePath[3] && method === "POST") {
    const query = new URL(request.url).searchParams;
    closedQuery(query, ["kind"]);
    const kind = query.get("kind") as ImageKind;
    if (kind !== "cover" && kind !== "square" && kind !== "screenshot") {
      throw new ApiError("bad_kind", { message: `kind ${JSON.stringify(kind)} isn't cover, square or screenshot.`, field: "kind", fix: "Give kind cover (landscape, 16:9 shows best), square (as wide as tall, shown on phones) or screenshot (?kind= in the API)." });
    }
    const tooBig = () => new ApiError("image_too_big", { message: "The image is over 5 MB.", field: "image_base64", fix: "Save it smaller (a JPEG or WebP, or fewer pixels) and send it again." });
    const declaredSizeBytes = Number(request.headers.get("content-length") ?? 0);
    if (declaredSizeBytes > IMAGE_LIMITS.maximumSizeBytes) throw tooBig();
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > IMAGE_LIMITS.maximumSizeBytes) throw tooBig();
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new ApiError("not_an_image", { message: "That isn't a PNG, JPEG or WebP image.", field: "image_base64", fix: "Send a PNG, JPEG or WebP file (the image itself as the body in the API); SVG and other types aren't taken." });
    const { widthPx, heightPx } = sniffed;
    if (Math.min(widthPx, heightPx) < IMAGE_LIMITS.minimumSidePx || Math.max(widthPx, heightPx) > IMAGE_LIMITS.maximumSidePx) {
      throw new ApiError("bad_image_dimensions", {
        message: `The image is ${widthPx} by ${heightPx} px.`,
        field: "image_base64",
        fix: `Make it at least ${IMAGE_LIMITS.minimumSidePx} px on each side and at most ${IMAGE_LIMITS.maximumSidePx.toLocaleString("en-US")} px, like 1920 by 1080 for a cover.`,
      });
    }
    if (kind === "square" && (!isSquare(widthPx, heightPx) || widthPx < IMAGE_LIMITS.minimumSquareSidePx)) {
      throw new ApiError("not_square", { message: `The square cover is ${widthPx} by ${heightPx} px.`, field: "image_base64", fix: `Make it as wide as it is tall, at least ${IMAGE_LIMITS.minimumSquareSidePx} px, like 1024 by 1024; or send it as kind cover.` });
    }
    // Matched against known abuse material before anyone sees it. A match is kept for reporting, never shown.
    // If matching fails, the picture waits for a person as usual.
    const matched = await imageMatcher(env).check([{ path: `${kind} image`, type: sniffed.type, id: "upload", body: async () => bytes }]);
    if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) {
      const id = newId("image");
      await env.GAMES.put(heldImageKey(game.id, id), bytes, { httpMetadata: { contentType: sniffed.type } });
      await audit(env.DB, game.id, "image-held", `A ${kind} upload matched known abuse material. Kept at ${heldImageKey(game.id, id)}; never shown.`, caller.actor);
      await sendAlert(env, `URGENT: known abuse image uploaded to ${game.slug}`, `${KNOWN_IMAGE_ALERT}\n\nA ${kind} upload, kept at ${heldImageKey(game.id, id)} in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
      throw new ApiError("image_refused", { message: "This image can't be used.", field: "image_base64", fix: "Use a different image." });
    }
    const existing = await imagesForGame(env.DB, game.id);
    const waitingImages = existing.filter((image) => image.kind === kind && image.review_status === "pending");
    if (kind === "screenshot" && existing.filter((image) => image.kind === "screenshot" && image.review_status !== "rejected").length >= IMAGE_LIMITS.maximumScreenshotCount) {
      throw new ApiError("too_many_screenshots", { message: `The game has ${IMAGE_LIMITS.maximumScreenshotCount} screenshots, the most it can have.`, fix: "Remove one with remove_image (its image_id from get_game) first." });
    }
    if (kind !== "screenshot" && waitingImages.length) {
      // Only the newest cover of each kind waits for review.
      for (const old of waitingImages) {
        await env.GAMES.delete(imageKey(old));
        await deleteImageRow(env.DB, old.id);
      }
    }
    const id = newId("image");
    await env.GAMES.put(imageKey({ game_id: game.id, id }), bytes, { httpMetadata: { contentType: sniffed.type } });
    const image = await addImage(env.DB, { id, game_id: game.id, kind, content_type: sniffed.type, width_px: widthPx, height_px: heightPx, size_bytes: bytes.byteLength });
    await audit(env.DB, game.id, "image-added", `${kind} ${id}`, caller.actor);
    return answer({ image: imageJson(env, image), review_message: "It shows on the game page once it's reviewed.", next_steps: [] satisfies NextStep[] }, 201);
  }

  if (isImages && gamePath[3] && method === "DELETE") {
    const imageFix = "get_game lists the game's images with their IDs.";
    checkIdKind("image", gamePath[3], "image_id", imageFix);
    const image = await imageById(env.DB, gamePath[3]);
    if (!image || image.game_id !== game.id) throw new ApiError("no_image", { message: `${game.slug} has no image with the ID ${gamePath[3]}.`, field: "image_id", fix: imageFix });
    await env.GAMES.delete(imageKey(image));
    await deleteImageRow(env.DB, image.id);
    await audit(env.DB, game.id, "image-removed", `${image.kind} ${image.id}`, caller.actor);
    return answer({ removed_image_id: image.id, next_steps: [] satisfies NextStep[] });
  }

  throw badMethod(method, path);
}

/** A method the path doesn't take. */
function badMethod(method: string, path: string): ApiError {
  return new ApiError("bad_method", { message: `${method} isn't a call at ${path}.`, fix: "docs/DEVELOPER-API.md lists the methods each path takes." });
}

/** A game's new details, checked, or the error answer for the first input that's wrong. */
function checkDetailsOrThrow(body: Record<string, unknown>) {
  const checked = checkDetails(body);
  if ("problem" in checked) {
    const { field, message, fix } = checked.problem;
    // bad_<field>, for the field's own name: play_modes[1].play_style is a bad_play_modes.
    const code = `bad_${field.split(/[.[]/)[0]}` as ErrorCode;
    throw new ApiError(code, { message, field, fix });
  }
  return checked.change;
}

/** What usually follows a change of details: publishing, when the game is now meant for players but nothing is live, or a game server. */
async function nextStepsAfterDetails(env: Env, game: Game, gameServerProblem: string | null): Promise<NextStep[]> {
  if (gameServerProblem) {
    return [{ tool: "upload_files", arguments: { slug: game.slug }, after_sec: null, reason: "Upload a version with its game server (a zaisma-server/ folder with index.js, or zaisma-server.js), then publish it: rooms open once it's live." }];
  }
  if ((game.visibility !== "listed" && game.visibility !== "unlisted") || game.live_version_id) return [];
  const versions = await versionsForGame(env.DB, game.id);
  const approved = versions.find((version) => version.scan_status === "approved");
  if (approved) return [{ tool: "publish_version", arguments: { slug: game.slug, version_id: approved.id }, after_sec: null, reason: "Players see the game once a version is live; this one passed review. Show the developer its preview_url first." }];
  const scanning = versions.find((version) => version.scan_status === "scanning");
  if (scanning) return [{ tool: "get_version", arguments: { slug: game.slug, version_id: scanning.id }, after_sec: 30, reason: "Players see the game once a version is live; this one is still being scanned." }];
  return [{ tool: "upload_files", arguments: { slug: game.slug }, after_sec: null, reason: "Players see the game once a version is live, and it has none yet." }];
}

async function putBlob(request: Request, env: Env, sha256: string): Promise<unknown> {
  const sizeBytes = Number(request.headers.get("content-length") ?? -1);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new ApiError("no_content_length", { message: "The file came without a Content-Length header.", field: "Content-Length", fix: "Send its size in bytes as Content-Length." });
  if (sizeBytes > FILE_LIMITS.maximumDirectSizeBytes) {
    throw new ApiError("file_needs_parts", { message: `The file is over ${FILE_LIMITS.maximumDirectSizeBytes / 1048576} MB, too big to send in one go.`, fix: `Send it in parts: POST /api/dev/files/${sha256}/parts with { "size_bytes" }.` });
  }
  if ((await missingBlobs(env.DB, [sha256])).length === 0) {
    await request.body?.cancel();
    return { sha256, storage_status: "already_stored" };
  }
  if (!request.body) throw new ApiError("no_body", { message: "The file came without a body.", fix: "Send the file's bytes as the request body." });
  try {
    await env.GAMES.put(blobKey(sha256), request.body, { sha256 });
  } catch {
    throw new ApiError("hash_mismatch", { message: `The file doesn't match the SHA-256 ${sha256}.`, fix: "Hash the file again (SHA-256, lowercase hex) and send it to that hash; check it didn't change since you listed it." });
  }
  // Programs and archives aren't allowed in games, whatever they're called.
  const start = await env.GAMES.get(blobKey(sha256), { range: { offset: 0, length: 16 } });
  const forbidden = start ? forbiddenContent(new Uint8Array(await start.arrayBuffer())) : null;
  if (forbidden) {
    await env.GAMES.delete(blobKey(sha256));
    throw new ApiError("forbidden_file", { message: `The file ${sha256} looks like ${forbidden}, which games can't have whatever it's called.`, fix: "Leave it out of the game." });
  }
  await addBlob(env.DB, sha256, sizeBytes);
  return { sha256, storage_status: "stored_now" };
}

/**
 * Big files, sent in parts: start, send each part, then finish. Storage can't check the hash
 * of a file sent in parts, so the file is kept for this owner's own versions only.
 *
 *   POST /files/:sha256/parts                  { "size_bytes" }  -> { upload_id, part_size_bytes, part_count }
 *   PUT  /files/:sha256/parts/:n?upload_id=…   one part (all but the last are part_size_bytes long)
 *   POST /files/:sha256/parts/done             { "upload_id", "parts": [{ "part_number", "etag" }] }
 */
async function bigFile(request: Request, env: Env, sha256: string, step: string | undefined, caller: Caller): Promise<unknown> {
  const key = ownedBlobKey(caller.ownerId, sha256);
  if (!step && request.method === "POST") {
    const body = await readJson(request);
    closedBody(body, ["size_bytes"]);
    const sizeBytes = body.size_bytes;
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0) throw new ApiError("bad_size_bytes", { message: "size_bytes isn't a whole number above 0.", field: "size_bytes", fix: 'Send { "size_bytes": <the file\'s size in bytes> }.' });
    if ((sizeBytes as number) > FILE_LIMITS.maximumFileSizeBytes) {
      throw new ApiError("file_too_big", { message: `The file is over ${FILE_LIMITS.maximumFileSizeBytes / 1048576} MB.`, field: "size_bytes", fix: "Split it into smaller files, or ask Zaisma (message_zaisma, kind gap) if the game needs bigger ones." });
    }
    if ((await missingBlobs(env.DB, [sha256], caller.ownerId)).length === 0) return { sha256, storage_status: "already_stored", upload_id: null, part_size_bytes: null, part_count: null };
    const upload = await env.GAMES.createMultipartUpload(key);
    return { sha256, storage_status: "upload_started", upload_id: upload.uploadId, part_size_bytes: FILE_LIMITS.partSizeBytes, part_count: Math.ceil((sizeBytes as number) / FILE_LIMITS.partSizeBytes) };
  }
  if (step && step !== "done" && request.method === "PUT") {
    const partNumber = Number(step);
    const uploadId = new URL(request.url).searchParams.get("upload_id") ?? "";
    const sizeBytes = Number(request.headers.get("content-length") ?? -1);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new ApiError("bad_part_number", { message: `${JSON.stringify(step)} isn't a part number from 1 to 10,000.`, field: "part_number", fix: `Number the parts from 1: PUT /api/dev/files/${sha256}/parts/1?upload_id=…` });
    }
    if (!uploadId) throw new ApiError("no_upload_id", { message: "The part came without its upload_id.", field: "upload_id", fix: `Add ?upload_id= with the upload_id from POST /api/dev/files/${sha256}/parts.` });
    if (!(sizeBytes > 0 && sizeBytes <= FILE_LIMITS.partSizeBytes) || !request.body) {
      throw new ApiError("bad_part_size", { message: `Part ${partNumber} is empty, over ${FILE_LIMITS.partSizeBytes / 1048576} MB or has no Content-Length header.`, field: "Content-Length", fix: `Send each part but the last as exactly part_size_bytes (${FILE_LIMITS.partSizeBytes} bytes), with its Content-Length.` });
    }
    try {
      const part = await env.GAMES.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
      return { part_number: part.partNumber, etag: part.etag };
    } catch {
      throw new ApiError("upload_closed", { message: "That upload_id isn't an open upload any more.", field: "upload_id", fix: `Start again with POST /api/dev/files/${sha256}/parts.` });
    }
  }
  if (step === "done" && request.method === "POST") {
    const body = await readJson(request, 1024 * 1024);
    closedBody(body, ["upload_id", "parts"]);
    const parts = Array.isArray(body.parts) ? (body.parts as { part_number?: unknown; etag?: unknown }[]) : [];
    if (typeof body.upload_id !== "string" || !parts.length || !parts.every((part) => Number.isInteger(part.part_number) && typeof part.etag === "string")) {
      throw new ApiError("bad_parts", { message: 'The body isn\'t { "upload_id", "parts": [{ "part_number", "etag" }] }.', field: typeof body.upload_id === "string" ? "parts" : "upload_id", fix: "Send the upload_id and every part's part_number and etag, as each part's answer gave them." });
    }
    let stored: R2Object;
    try {
      stored = await env.GAMES.resumeMultipartUpload(key, body.upload_id).complete(parts.map((part) => ({ partNumber: part.part_number as number, etag: part.etag as string })));
    } catch {
      throw new ApiError("parts_incomplete", { message: "Those parts don't make a whole file.", field: "parts", fix: "Check every part was sent and each etag is the one its answer gave, then finish again; or start again if the upload_id is old." });
    }
    if (stored.size > FILE_LIMITS.maximumFileSizeBytes) {
      await env.GAMES.delete(key);
      throw new ApiError("file_too_big", { message: `The file is over ${FILE_LIMITS.maximumFileSizeBytes / 1048576} MB.`, fix: "Split it into smaller files, or ask Zaisma (message_zaisma, kind gap) if the game needs bigger ones." });
    }
    const start = await env.GAMES.get(key, { range: { offset: 0, length: 16 } });
    const forbidden = start ? forbiddenContent(new Uint8Array(await start.arrayBuffer())) : null;
    if (forbidden) {
      await env.GAMES.delete(key);
      throw new ApiError("forbidden_file", { message: `The file ${sha256} looks like ${forbidden}, which games can't have whatever it's called.`, fix: "Leave it out of the game." });
    }
    await addOwnedBlob(env.DB, caller.ownerId, sha256, stored.size);
    return { sha256, storage_status: "stored_now", size_bytes: stored.size };
  }
  throw badMethod(request.method, new URL(request.url).pathname);
}

async function versionRoute(request: Request, env: Env, game: Game, what: string, id: string | undefined, isPublish: boolean, caller: Caller): Promise<[unknown, number?]> {
  const method = request.method;
  if (game.review_status === "removed" && method !== "GET") {
    throw gameRemoved(game, "it can't get new versions or publish");
  }

  // Step 1: which of these files do you still need to send?
  if (what === "uploads" && !id && method === "POST") {
    const body = await readJson(request, 4 * 1024 * 1024);
    closedBody(body, ["files"]);
    const files = listOrThrow(body.files);
    const missing = await missingBlobs(env.DB, files.map((file) => file.sha256), caller.ownerId);
    return [{ file_count: files.length, size_bytes: files.reduce((totalSizeBytes, file) => totalSizeBytes + file.size_bytes, 0), missing_file_hashes: missing }];
  }

  // Step 2: make the version once every file is stored. It's scanned, then waits as a draft.
  if (what === "versions" && !id && method === "POST") {
    const body = await readJson(request, 4 * 1024 * 1024);
    closedBody(body, ["files", "patch_notes", "publish_when_approved"]);
    const files = listOrThrow(body.files);
    if (body.publish_when_approved !== undefined && typeof body.publish_when_approved !== "boolean") {
      throw new ApiError("bad_publish_when_approved", { message: "publish_when_approved isn't true or false.", field: "publish_when_approved", fix: "Send true to go live as soon as it passes the scan, or leave it out to publish yourself." });
    }
    if (body.patch_notes !== undefined && typeof body.patch_notes !== "string") throw new ApiError("bad_patch_notes", { message: "patch_notes isn't text.", field: "patch_notes", fix: "Send what changed as text, or leave it out." });
    const patchNotes = typeof body.patch_notes === "string" ? body.patch_notes.trim() : "";
    if (patchNotes.length > FILE_LIMITS.maximumPatchNotesCharacterCount) {
      throw new ApiError("bad_patch_notes", { message: `patch_notes is ${patchNotes.length} characters, over ${FILE_LIMITS.maximumPatchNotesCharacterCount}.`, field: "patch_notes", fix: `Shorten them to ${FILE_LIMITS.maximumPatchNotesCharacterCount} characters; players see them.` });
    }
    const found = await locateBlobs(env.DB, files.map((file) => file.sha256), caller.ownerId);
    const missingCount = files.filter((file) => !found.has(file.sha256)).length;
    if (missingCount) {
      throw new ApiError("files_missing", { message: `${missingCount} of the files haven't been sent yet.`, field: "files", fix: "POST /api/dev/games/<slug>/uploads lists the missing_file_hashes; send each to PUT /api/dev/files/<sha256>, then call again." });
    }
    const today = await env.DB.prepare("SELECT COUNT(*) AS version_count, MIN(created_at_ms) AS oldest_at_ms FROM versions WHERE game_id = ? AND created_at_ms > ?")
      .bind(game.id, Date.now() - DAY_MS)
      .first<{ version_count: number; oldest_at_ms: number | null }>();
    if ((today?.version_count ?? 0) >= FILE_LIMITS.maximumVersionsPerDay) {
      throw new ApiError("version_limit", {
        message: `${game.slug} has had ${FILE_LIMITS.maximumVersionsPerDay} versions in the last day, the most a game can.`,
        fix: "Wait until the oldest is a day old, then upload again; meanwhile test with the latest version's preview_url.",
        retryAfterSec: secondsUntilDayPasses(today?.oldest_at_ms),
      });
    }
    const versionId = newId("version");
    await env.GAMES.put(manifestKey(versionId), JSON.stringify(toManifest(files, found, caller.ownerId)), { httpMetadata: { contentType: "application/json" } });
    await createVersion(env.DB, {
      id: versionId,
      gameId: game.id,
      r2Prefix: `manifests/${versionId}`,
      fileCount: files.length,
      sizeBytes: files.reduce((totalSizeBytes, file) => totalSizeBytes + file.size_bytes, 0),
      kind: "files",
      patchNotes,
      publishWhenApprovedEnabled: body.publish_when_approved === true,
    });
    await audit(env.DB, game.id, "upload", `${versionId}, ${files.length} files`, caller.actor);
    await env.SCAN_QUEUE.send({ versionId });
    const reason = body.publish_when_approved === true ? "It goes live by itself once it passes; the scan usually takes under a minute." : "The scan usually takes under a minute; once it passes, show the developer its preview_url.";
    return [{ version: versionJson(env, game, (await versionById(env.DB, versionId))!), next_steps: [{ tool: "get_version", arguments: { slug: game.slug, version_id: versionId }, after_sec: 30, reason }] satisfies NextStep[] }, 201];
  }

  const versionFix = "get_game lists the game's versions with their IDs, newest first.";
  checkIdKind("version", id, "version_id", versionFix);
  const version = id ? await versionById(env.DB, id) : null;
  if (id && (!version || version.game_id !== game.id)) throw new ApiError("no_version", { message: `${game.slug} has no version with the ID ${id}.`, field: "version_id", fix: versionFix });

  if (version && !isPublish && method === "GET") return [{ version: versionJson(env, game, version) }];

  // Publish later: { "scheduled_publish_at": "2026-11-01T17:00:00Z" }. It goes live then if it has passed review.
  const body = version && isPublish && method === "POST" ? await readJson(request).catch(() => ({}) as Record<string, unknown>) : {};
  if (version && isPublish && method === "POST") closedBody(body, ["scheduled_publish_at"]);
  if (version && isPublish && method === "POST" && body.scheduled_publish_at !== undefined) {
    const scheduledAtMs = typeof body.scheduled_publish_at === "string" && ISO_TIME.test(body.scheduled_publish_at) ? Date.parse(body.scheduled_publish_at) : NaN;
    if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now() + 60_000 || scheduledAtMs > Date.now() + 90 * DAY_MS) {
      const said = typeof body.scheduled_publish_at === "string" ? `"${body.scheduled_publish_at.slice(0, 40)}"` : `a ${typeof body.scheduled_publish_at}`;
      throw new ApiError("bad_time", {
        message: Number.isFinite(scheduledAtMs) ? `scheduled_publish_at ${said} isn't from a few minutes to 90 days ahead.` : `scheduled_publish_at is ${said}, not an ISO time.`,
        field: "scheduled_publish_at",
        fix: `Give an ISO time with Z or an offset, from 2 minutes to 90 days ahead, like "${new Date(Date.now() + DAY_MS).toISOString().slice(0, 14)}00:00Z". Leave it out to publish now.`,
      });
    }
    if (version.scan_status !== "approved" && version.scan_status !== "scanning") throw notApproved(game, version);
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(scheduledAtMs, version.id).run();
    await audit(env.DB, game.id, "publish-scheduled", `${version.id} at ${iso(scheduledAtMs)}`, caller.actor);
    const nextSteps: NextStep[] =
      version.scan_status === "scanning" ? [{ tool: "get_version", arguments: { slug: game.slug, version_id: version.id }, after_sec: 30, reason: "It goes live at scheduled_publish_at only if it has passed the scan by then." }] : [];
    return [{ game: gameJson(env, game), version: versionJson(env, game, (await versionById(env.DB, version.id))!), next_steps: nextSteps }];
  }
  if (version && isPublish && method === "DELETE") {
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL WHERE id = ?").bind(version.id).run();
    await audit(env.DB, game.id, "publish-unscheduled", version.id, caller.actor);
    return [{ game: gameJson(env, game), version: versionJson(env, game, (await versionById(env.DB, version.id))!), next_steps: [] satisfies NextStep[] }];
  }

  // Publish a draft now, or roll back to any version we've kept.
  if (version && isPublish && method === "POST") {
    if (version.scan_status === "scanning") {
      throw new ApiError("still_scanning", {
        message: "This version is still being scanned.",
        field: "version_id",
        fix: "Wait for scan_status approved (get_version), then publish; or give scheduled_publish_at to publish it later once it passes.",
        retryAfterSec: 30,
      });
    }
    if (version.scan_status !== "approved") throw notApproved(game, version);
    await publishVersion(env.DB, version);
    await audit(env.DB, game.id, version.published_at_ms ? "rolled-back" : "published", version.id, caller.actor);
    await pruneVersions(env, game.id);
    await tellWebhooks(env, "live_version_changed", game.id, { versionId: version.id }, caller.waitUntil);
    const published = (await gameBySlug(env.DB, game.slug))!;
    const isHidden = published.visibility === "draft" || published.visibility === "private";
    const nextSteps: NextStep[] = isHidden
      ? [{ tool: "update_game", arguments: { slug: game.slug, visibility: "listed" }, after_sec: null, reason: `It's live, but the game is ${published.visibility}, so only the developer and tester links see it. When the developer wants players in: listed for everyone, or unlisted for people with the link.` }]
      : [];
    return [{ game: gameJson(env, published), version: versionJson(env, published, (await versionById(env.DB, version.id))!), next_steps: nextSteps }];
  }

  throw badMethod(method, new URL(request.url).pathname);
}

/** A held or rejected version, which can't be published: why, and what to do, from its review reason or first finding. */
function notApproved(game: Game, version: Version): ApiError {
  const why = versionReviewReason(version) ?? findingsFor(version)[0] ?? null;
  return new ApiError("not_approved", {
    message: `This version is ${version.scan_status}, so it can't be published${why ? ` (${why.code}): ${why.message}` : "."}`,
    field: "version_id",
    fix: `${why?.fix ?? (version.scan_status === "held" ? "A person at Zaisma looks at held versions, usually within a day." : `Upload a fixed version (upload_files with slug ${game.slug}).`)} get_version shows every finding.`,
  });
}

/** A game Zaisma took down can't change: why, and what to do, from its review reason. */
function gameRemoved(game: Game, what: string, field: string | null = null): ApiError {
  const reason = readReviewReason(game.review_reason);
  const why = reason ? reviewReasonAnswer(reason) : null;
  return new ApiError("game_removed", {
    message: `Zaisma took this game down, so ${what}${why ? ` (${why.code}): ${why.message}` : "."}`,
    field,
    fix: why?.fix ?? "message_zaisma with the game_slug to ask about it.",
  });
}

const DAY_MS = 86400_000;
/** An ISO 8601 time with Z or an offset: the only form times come in (docs/NAMING.md). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Opaque cursors for lists that continue: they say where the last answer ended. */
const cursorFor = (atMs: number) => `cursor_${atMs.toString(36)}`;
function readCursor(cursor: string | null): number {
  if (!cursor) return 0;
  if (!/^cursor_[0-9a-z]{1,12}$/.test(cursor)) throw new ApiError("bad_cursor", { message: `cursor ${JSON.stringify(cursor.slice(0, 40))} isn't a next_cursor Zaisma gave.`, field: "cursor", fix: "Pass the next_cursor from your last answer as it came, or leave cursor out to start from the beginning." });
  return parseInt(cursor.slice(7), 36);
}

/** How many days back stats go: a whole number from 1 to 90, 30 when it's left out. */
function readPeriodDurationDays(given: string | null): number {
  if (given === null) return 30;
  const dayCount = Number(given);
  if (!/^\d+$/.test(given) || dayCount < 1 || dayCount > 90) {
    throw new ApiError("bad_period_duration_days", { message: `period_duration_days ${JSON.stringify(given.slice(0, 20))} isn't a whole number from 1 to 90.`, field: "period_duration_days", fix: "Give how many days back, today included, from 1 to 90; leave it out for 30." });
  }
  return dayCount;
}

/**
 * Player reports, counted by reason over the last 90 days. Bug reports (as report triage sorted
 * them) come with what the player wrote and the version they played; `cursor` (from next_cursor)
 * gives only the ones that arrived after it, so a developer's AI can check for new ones.
 * Child-safety reports, including ones triage found under another reason, are never shown or
 * counted here: telling the developer could warn someone abusing a child.
 */
async function reportsFor(env: Env, game: Game, cursor: string | null) {
  const sinceMs = readCursor(cursor);
  const fromMs = Date.now() - 90 * DAY_MS;
  const { results: counts } = await env.DB
    .prepare("SELECT reason, report_status, COUNT(*) AS report_count FROM reports WHERE game_id = ? AND reported_at_ms > ? AND reason != 'child_safety' AND severity_index > 0 GROUP BY reason, report_status")
    .bind(game.id, fromMs)
    .all<{ reason: string; report_status: string; report_count: number }>();
  const byReason = new Map<string, { reason: string; label: string; open_count: number; closed_count: number }>();
  for (const row of counts) {
    const reason = byReason.get(row.reason) ?? { reason: row.reason, label: REPORT_REASONS[row.reason as ReportReason] ?? row.reason, open_count: 0, closed_count: 0 };
    byReason.set(row.reason, reason);
    if (row.report_status === "open") reason.open_count += row.report_count;
    else reason.closed_count += row.report_count;
  }
  const { results: bugs } = await env.DB
    .prepare("SELECT id, player_text, triage, version_id, reported_at_ms, bug_report_at_ms FROM reports WHERE game_id = ? AND is_bug_report = 1 AND severity_index > 0 AND bug_report_at_ms > ? AND player_text != '' ORDER BY bug_report_at_ms DESC LIMIT 50")
    .bind(game.id, Math.max(sinceMs, fromMs))
    .all<{ id: string; player_text: string; triage: string | null; version_id: string | null; reported_at_ms: number; bug_report_at_ms: number }>();
  return {
    period_duration_days: 90,
    // Open: waiting for us. Closed: we looked and either dismissed it or acted on it.
    reasons: [...byReason.values()],
    bug_reports: bugs.map(bugReportJson),
    // Pass this as `cursor` next time to get only bug reports that arrived after this call.
    next_cursor: cursorFor(Math.max(sinceMs, ...bugs.map((bug) => bug.bug_report_at_ms))),
  };
}

/** A bug report as the developer sees it, in get_reports and the bug_reported webhook event: never who sent it. */
export function bugReportJson(bug: { id: string; player_text: string; triage: string | null; version_id: string | null; reported_at_ms: number }) {
  return {
    id: bug.id,
    player_text: bug.player_text,
    summary: bug.triage ? (JSON.parse(bug.triage) as { summary: string }).summary : null,
    version_id: bug.version_id,
    reported_at: iso(bug.reported_at_ms),
  };
}

/** Why the live version's game server can't run yet (none, or too big), or null when it can or nothing is live. */
async function liveServerProblem(env: Env, game: Game): Promise<string | null> {
  const version = game.live_version_id ? await versionById(env.DB, game.live_version_id) : null;
  if (!version) return null;
  const manifest = version.kind === "files" ? ((await (await env.GAMES.get(manifestKey(version.id)))?.json()) as Manifest | null) : null;
  const found = await serverModules(env.GAMES, version, manifest);
  if (!found) return "The live version has no game server (a zaisma-server/ folder with index.js, or zaisma-server.js), so its rooms can't open until a version with one is published.";
  if ("error" in found) return `The live version's game server can't run: ${found.error}`;
  return null;
}

/**
 * Plays, play time and players coming back (counted by the game page, see plays.ts), multiplayer
 * room use per day, and for games running their own game server on our rooms, how it's doing:
 * calls, errors, loops we stopped and matches that ended for it, plus its recent errors. Only
 * counts: nothing about who played.
 */
async function statsFor(env: Env, game: Game, periodDurationDays: number) {
  const dayCount = Number.isInteger(periodDurationDays) && periodDurationDays > 0 ? Math.min(periodDurationDays, 90) : 30;
  const fromDate = new Date(Date.now() - (dayCount - 1) * DAY_MS).toISOString().slice(0, 10);
  const [gamePlayStats, { results: roomDays }, { results: errors }, monthRoomPlayDurationSec, monthRequestCount] = await Promise.all([
    playStats(env.DB, game.id, dayCount),
    env.DB
      .prepare("SELECT date, room_count, room_play_duration_sec, message_count, game_server_call_count, game_server_request_count, game_server_crash_count, game_server_stopped_count, game_server_ended_match_count FROM room_usage WHERE game_id = ? AND date >= ? ORDER BY date")
      .bind(game.id, fromDate)
      .all<{ date: string; room_count: number; room_play_duration_sec: number; message_count: number; game_server_call_count: number; game_server_request_count: number; game_server_crash_count: number; game_server_stopped_count: number; game_server_ended_match_count: number }>(),
    env.DB
      .prepare("SELECT version_id, kind, message, occurrence_count, first_at_ms, last_at_ms FROM game_server_errors WHERE game_id = ? ORDER BY last_at_ms DESC LIMIT 20")
      .bind(game.id)
      .all<{ version_id: string; kind: "crash" | "stopped"; message: string; occurrence_count: number; first_at_ms: number; last_at_ms: number }>(),
    roomPlayDurationSecThisMonth(env.DB, game.id),
    requestCountThisMonth(env.DB, game.id),
  ]);
  // The game's own game server runs on Zaisma for its rooms, or for requests, which any game's can answer.
  const hasOwnServer = game.multiplayer_mode === "own" || monthRequestCount > 0 || roomDays.some((day) => day.game_server_request_count > 0);
  return {
    period_duration_days: dayCount,
    play_stats: gamePlayStats,
    multiplayer_days: roomDays.map((day) => ({
      date: day.date,
      room_count: day.room_count,
      room_play_duration_min: Math.round(day.room_play_duration_sec / 60),
      message_count: day.message_count,
      game_server: hasOwnServer ? { call_count: day.game_server_call_count, request_count: day.game_server_request_count, crash_count: day.game_server_crash_count, stopped_count: day.game_server_stopped_count, ended_match_count: day.game_server_ended_match_count } : null,
    })),
    // Until Hosting billing exists, new rooms stop opening at the free tier until the month resets (UTC).
    room_use_this_month: { room_play_duration_hours: Math.round(monthRoomPlayDurationSec / 360) / 10, free_room_play_duration_hours: FREE_ROOM_PLAY_DURATION_HOURS, has_reached_free_hours: monthRoomPlayDurationSec >= FREE_ROOM_PLAY_DURATION_HOURS * 3600 },
    // Requests to the game's own game server (Zaisma.server.request): likewise, past the free ones they stop until the month resets.
    request_use_this_month: { request_count: monthRequestCount, free_request_count: FREE_REQUEST_COUNT_PER_MONTH, has_reached_free_requests: monthRequestCount >= FREE_REQUEST_COUNT_PER_MONTH },
    // Crashes lose one call each and the match carries on. "stopped" is a call that ran on too long
    // (about 2 seconds of CPU, like a loop that never ends): it freezes the match while it runs,
    // and a match whose game server is stopped twice ends.
    game_server_errors: hasOwnServer
      ? errors.map((error) => ({ kind: error.kind, message: error.message, occurrence_count: error.occurrence_count, version_id: error.version_id, first_at: iso(error.first_at_ms), last_at: iso(error.last_at_ms) }))
      : [],
  };
}

/** What happened to a game, newest first, in words safe to show its developer. */
const HISTORY: Record<string, string | null> = {
  created: "Made the game",
  details: "Changed the details",
  "details-approved": "New title or description approved",
  "details-rejected": "New title or description not approved",
  "image-added": "Added an image",
  "image-removed": "Removed an image",
  "image-approved": "Image approved",
  "image-rejected": "Image not approved",
  upload: "Uploaded a version",
  "scan-held": "A version was held for a person to look at; see the version's findings",
  "scan-rejected": "A version was rejected; see the version's findings",
  rejected: "A version was rejected after review",
  "draft-ready": "A version passed review and is ready to preview and publish",
  published: "Published a version",
  "rolled-back": "Rolled back to an earlier version",
  "publish-scheduled": "Scheduled a version to publish later",
  "publish-unscheduled": "Cancelled a scheduled publish",
  "publish-dropped": "A scheduled version didn't pass review, so it wasn't published",
  "draft-deleted": "An unpublished version was deleted after 30 days",
  // Neutral on purpose: the developer is never told which kind of report it was.
  "auto-hold": "A report paused your game while we check it",
  "report-paused-update": "A report paused your latest update while we check it; players get the version before it",
  "report-cleared": "We checked a report and put your game back",
  takedown: "Zaisma took the game down",
  restored: "Zaisma restored the game",
  "reports-dismissed": null,
  "reports-to-developer": null,
  "room-name-hidden": "Zaisma hid a room's name from room lists after a report",
  multiplayer: "Multiplayer settings changed",
  "cloud-saves": "Cloud saves switched",
  "tester-link-added": "Made a tester link",
  "tester-link-removed": "Turned off a tester link",
  "plays-cleared": "Zaisma removed a day's counted plays that looked faked",
  "off-shelves": "Zaisma took the game off Popular, Trending and New",
  "on-shelves": "Zaisma put the game back on Popular, Trending and New",
  owner: null,
};

async function historyFor(env: Env, game: Game, caller: Caller) {
  const { results } = await env.DB
    .prepare("SELECT action, reason, actor, happened_at_ms, review_reason FROM audit_log WHERE game_id = ? ORDER BY happened_at_ms DESC, id DESC LIMIT 100")
    .bind(game.id)
    .all<{ action: string; reason: string; actor: string; happened_at_ms: number; review_reason: string | null }>();
  const events: { description: string; version_id: string | null; done_by: "you" | "zaisma"; happened_at: string | null; review_reason: ReturnType<typeof reasonAnswer> }[] = [];
  for (const entry of results) {
    const description = HISTORY[entry.action];
    if (!description) continue;
    events.push({
      description,
      version_id: entry.reason.match(/\bversion_[a-z0-9]+/)?.[0] ?? null,
      done_by: entry.actor === caller.actor ? "you" : "zaisma",
      happened_at: iso(entry.happened_at_ms),
      review_reason: reasonAnswer(entry.review_reason),
    });
  }
  return { events };
}

/** A stored review reason (JSON) as the API answers it, with its fix; null when there's none. */
function reasonAnswer(stored: string | null) {
  const reason = readReviewReason(stored);
  return reason ? reviewReasonAnswer(reason) : null;
}

function listOrThrow(files: unknown): UploadFile[] {
  try {
    return checkUploadList(files);
  } catch (error) {
    if (error instanceof UploadError) throw new ApiError(error.problem?.code ?? "bad_files", { message: error.message, field: error.problem?.field ?? "files", fix: error.problem?.fix ?? "Check the file list against docs/DEVELOPER-API.md, Uploading versions." });
    throw error;
  }
}

/**
 * Tester links: secret links that open the game's live version whatever its visibility, for guests
 * too. One per group (team, playtesters, a streamer), so one can be turned off without the others.
 */
async function testerRoute(request: Request, env: Env, game: Game, id: string | undefined, caller: Caller): Promise<[unknown, number?]> {
  if (!id && request.method === "GET") return [{ testers: (await testerLinks(env.DB, game.id)).map((link) => testerJson(env, link)) }];
  if (!id && request.method === "POST") {
    if (game.review_status === "removed") {
      throw gameRemoved(game, "it can't get tester links");
    }
    const body = await readJson(request);
    closedBody(body, ["name"]);
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 60) throw new ApiError("bad_name", { message: "name is empty or over 60 characters.", field: "name", fix: 'Name the link for who it\'s for, in 1 to 60 characters, like "Playtesters" or "My team".' });
    const links = await testerLinks(env.DB, game.id);
    if (links.length >= MAXIMUM_TESTER_LINK_COUNT) {
      throw new ApiError("too_many_tester_links", { message: `${game.slug} has ${MAXIMUM_TESTER_LINK_COUNT} tester links on, the most a game can.`, fix: "Turn one off with remove_tester_link (its tester_id from get_game) first." });
    }
    const link = await addTesterLink(env.DB, game.id, name);
    await audit(env.DB, game.id, "tester-link-added", name, caller.actor);
    return [{ tester: testerJson(env, link), next_steps: [] satisfies NextStep[] }, 201];
  }
  if (id && request.method === "DELETE") {
    const testerFix = "get_game lists the tester links that are on, with their IDs.";
    checkIdKind("tester", id, "tester_id", testerFix);
    const link = (await testerLinks(env.DB, game.id)).find((candidate) => candidate.id === id);
    if (!link || !(await revokeTesterLink(env.DB, game.id, id))) {
      throw new ApiError("no_tester_link", { message: `${game.slug} has no tester link on with the ID ${id}.`, field: "tester_id", fix: testerFix });
    }
    await audit(env.DB, game.id, "tester-link-removed", link.name, caller.actor);
    return [{ removed_tester_id: link.id, next_steps: [] satisfies NextStep[] }];
  }
  throw badMethod(request.method, new URL(request.url).pathname);
}

/**
 * Sign-in apps: developers' own sites, servers and apps that players sign in to with Zaisma
 * (sign-in.ts). The app's ID is its OAuth client_id; a confidential app's client secret is answered
 * once, when it's made or replaced, and only its SHA-256 is kept.
 */
async function signInAppRoute(request: Request, env: Env, id: string | undefined, caller: Caller): Promise<[unknown, number?]> {
  const method = request.method;
  if (!id && method === "GET") return [{ sign_in_apps: (await signInAppsFor(env.DB, caller.ownerId)).map((app) => signInAppJson(env, app)) }];
  if (!id && method === "POST") {
    const body = await readJson(request);
    closedBody(body, ["name", "kind", "redirect_urls"]);
    for (const field of ["name", "kind", "redirect_urls"]) {
      if (body[field] === undefined) throw new ApiError("missing_field", { message: `${field} wasn't sent.`, field, fix: SIGN_IN_APP_FIX[field]! });
    }
    const name = signInAppNameOrThrow(body.name);
    if (!(SIGN_IN_APP_KINDS as readonly unknown[]).includes(body.kind)) throw new ApiError("bad_kind", { message: "kind isn't confidential or public.", field: "kind", fix: SIGN_IN_APP_FIX.kind! });
    const redirectUrls = redirectUrlsOrThrow(body.redirect_urls);
    if ((await signInAppsFor(env.DB, caller.ownerId)).length >= MAXIMUM_SIGN_IN_APP_COUNT) {
      throw new ApiError("too_many_sign_in_apps", { message: `You have ${MAXIMUM_SIGN_IN_APP_COUNT} sign-in apps, the most an account can.`, fix: "Delete one you don't use with delete_sign_in_app, or add this site's redirect URLs to an app you have with update_sign_in_app." });
    }
    const { app, clientSecret } = await createSignInApp(env.DB, { ownerId: caller.ownerId, name, kind: body.kind as SignInAppKind, redirectUrls });
    return [{ sign_in_app: signInAppJson(env, app), client_secret: clientSecret, next_steps: [] satisfies NextStep[] }, 201];
  }
  if (!id) throw badMethod(method, new URL(request.url).pathname);
  const appFix = "list_sign_in_apps lists your sign-in apps with their IDs.";
  checkIdKind("sign_in_app", id, "sign_in_app_id", appFix);
  const app = await signInAppById(env.DB, id);
  if (!app || app.owner_id !== caller.ownerId) throw new ApiError("no_sign_in_app", { message: `You have no sign-in app with the ID ${id}.`, field: "sign_in_app_id", fix: appFix });
  if (method === "PATCH") {
    const body = await readJson(request);
    closedBody(body, ["name", "redirect_urls", "replace_client_secret"]);
    const replaceClientSecret = body.replace_client_secret;
    if (replaceClientSecret !== undefined && typeof replaceClientSecret !== "boolean") throw new ApiError("bad_replace_client_secret", { message: "replace_client_secret isn't true or false.", field: "replace_client_secret", fix: "Send true to make a new client secret (the old one stops working at once), or leave it out." });
    if (replaceClientSecret && app.kind === "public") throw new ApiError("bad_replace_client_secret", { message: `${app.name} is a public app, which has no client secret.`, field: "replace_client_secret", fix: "Leave replace_client_secret out. A public app signs in with PKCE alone; for a client secret, make a confidential app with create_sign_in_app." });
    const { app: updated, clientSecret } = await updateSignInApp(env.DB, app, {
      name: body.name === undefined ? undefined : signInAppNameOrThrow(body.name),
      redirectUrls: body.redirect_urls === undefined ? undefined : redirectUrlsOrThrow(body.redirect_urls),
      replaceClientSecret: replaceClientSecret === true,
    });
    return [{ sign_in_app: signInAppJson(env, updated), client_secret: clientSecret, next_steps: [] satisfies NextStep[] }];
  }
  if (method === "DELETE") {
    await deleteSignInApp(env.DB, app.id);
    return [{ removed_sign_in_app_id: app.id, next_steps: [] satisfies NextStep[] }];
  }
  throw badMethod(method, new URL(request.url).pathname);
}

const SIGN_IN_APP_FIX: Record<string, string> = {
  name: 'Name the app the way players know your site, in 1 to 60 characters, like "Sky Hopper Online". Players see it when they sign in.',
  kind: 'Send "confidential" for a site or server that keeps the client secret on its server, or "public" for a page or phone app with no server, which signs in with PKCE alone.',
  redirect_urls: 'Send a list of 1 to 10 exact URLs your site gets players back on, like ["https://skyhopper.io/auth/callback"]: https, or http://localhost for development, without a #fragment.',
};

function signInAppNameOrThrow(given: unknown): string {
  const checked = checkSignInAppName(given);
  if ("error" in checked) throw new ApiError("bad_name", { message: checked.error, field: "name", fix: SIGN_IN_APP_FIX.name! });
  return checked.name;
}

function redirectUrlsOrThrow(given: unknown): string[] {
  if (!Array.isArray(given) || given.length < 1 || given.length > MAXIMUM_REDIRECT_URL_COUNT) {
    throw new ApiError("bad_redirect_urls", { message: `redirect_urls isn't a list of 1 to ${MAXIMUM_REDIRECT_URL_COUNT} URLs.`, field: "redirect_urls", fix: SIGN_IN_APP_FIX.redirect_urls! });
  }
  const redirectUrls: string[] = [];
  for (const [i, url] of given.entries()) {
    const checked = checkRedirectUrl(url);
    if ("error" in checked) throw new ApiError("bad_redirect_urls", { message: checked.error, field: `redirect_urls[${i}]`, fix: SIGN_IN_APP_FIX.redirect_urls! });
    if (!redirectUrls.includes(checked.redirectUrl)) redirectUrls.push(checked.redirectUrl);
  }
  return redirectUrls;
}

function signInAppJson(env: Env, app: SignInApp) {
  return { id: app.id, name: app.name, kind: app.kind, redirect_urls: redirectUrlsOf(app), issuer_url: env.SITE_ORIGIN, created_at: iso(app.created_at_ms), updated_at: iso(app.updated_at_ms) };
}

/**
 * Webhooks: addresses the developer's servers listen at, sent signed events about their games
 * (webhooks.ts). The signing secret is answered once, when it's made or replaced.
 */
async function webhookRoute(request: Request, env: Env, id: string | undefined, sub: "test" | "deliveries" | undefined, caller: Caller): Promise<[unknown, number?]> {
  const method = request.method;
  if (!id && method === "GET") {
    const [webhooks, counts] = await Promise.all([webhooksFor(env.DB, caller.ownerId), deliveryCountsFor(env.DB, caller.ownerId)]);
    return [{ webhooks: webhooks.map((webhook) => webhookJson(webhook, counts.get(webhook.id))) }];
  }
  if (!id && method === "POST") {
    const body = await readJson(request);
    closedBody(body, ["endpoint_url", "event_kinds", "game_slugs"]);
    for (const field of ["endpoint_url", "event_kinds"]) {
      if (body[field] === undefined) throw new ApiError("missing_field", { message: `${field} wasn't sent.`, field, fix: WEBHOOK_FIX[field]! });
    }
    const endpointUrl = endpointUrlOrThrow(env, body.endpoint_url);
    const eventKinds = eventKindsOrThrow(body.event_kinds);
    const gameSlugs = body.game_slugs === undefined ? null : await gameSlugsOrThrow(env, body.game_slugs, caller);
    if ((await webhooksFor(env.DB, caller.ownerId)).length >= MAXIMUM_WEBHOOK_COUNT) {
      throw new ApiError("too_many_webhooks", { message: `You have ${MAXIMUM_WEBHOOK_COUNT} webhooks, the most an account can.`, fix: "Delete one you don't use with delete_webhook, or add these event_kinds to one you have with update_webhook." });
    }
    const webhook = await createWebhook(env.DB, { ownerId: caller.ownerId, endpointUrl, eventKinds, gameSlugs });
    return [{ webhook: webhookJson(webhook), signing_secret: webhook.signing_secret, next_steps: [testStep(webhook)] satisfies NextStep[] }, 201];
  }
  if (!id) throw badMethod(method, new URL(request.url).pathname);
  const webhookFix = "list_webhooks lists your webhooks with their IDs.";
  checkIdKind("webhook", id, "webhook_id", webhookFix);
  const webhook = await webhookById(env.DB, id);
  if (!webhook || webhook.owner_id !== caller.ownerId) throw new ApiError("no_webhook", { message: `You have no webhook with the ID ${id}.`, field: "webhook_id", fix: webhookFix });

  if (sub === "test" && method === "POST") {
    const delivery = await sendTestEvent(env, webhook);
    return [{ delivery: deliveryJson(delivery), next_steps: [] satisfies NextStep[] }];
  }
  if (sub === "deliveries" && method === "GET") {
    const query = new URL(request.url).searchParams;
    closedQuery(query, ["cursor"]);
    const cursor = query.get("cursor");
    const deliveries = await deliveriesFor(env.DB, webhook.id, 20, cursor ? readCursor(cursor) : null);
    return [{ deliveries: deliveries.map(deliveryJson), next_cursor: deliveries.length === 20 ? cursorFor(deliveries.at(-1)!.created_at_ms) : null }];
  }
  if (sub) throw badMethod(method, new URL(request.url).pathname);
  if (method === "PATCH") {
    const body = await readJson(request);
    closedBody(body, ["endpoint_url", "event_kinds", "game_slugs", "replace_signing_secret"]);
    const replaceSigningSecret = body.replace_signing_secret;
    if (replaceSigningSecret !== undefined && typeof replaceSigningSecret !== "boolean") {
      throw new ApiError("bad_replace_signing_secret", { message: "replace_signing_secret isn't true or false.", field: "replace_signing_secret", fix: "Send true to make a new signing secret (the old one stops at once), or leave it out." });
    }
    const updated = await updateWebhook(env.DB, webhook, {
      endpointUrl: body.endpoint_url === undefined ? undefined : endpointUrlOrThrow(env, body.endpoint_url),
      eventKinds: body.event_kinds === undefined ? undefined : eventKindsOrThrow(body.event_kinds),
      gameSlugs: body.game_slugs === undefined ? undefined : await gameSlugsOrThrow(env, body.game_slugs, caller),
      replaceSigningSecret: replaceSigningSecret === true,
    });
    const counts = (await deliveryCountsFor(env.DB, caller.ownerId)).get(webhook.id);
    const nextSteps: NextStep[] = body.endpoint_url !== undefined || replaceSigningSecret === true ? [testStep(updated)] : [];
    return [{ webhook: webhookJson(updated, counts), signing_secret: replaceSigningSecret === true ? updated.signing_secret : null, next_steps: nextSteps }];
  }
  if (method === "DELETE") {
    await deleteWebhook(env.DB, webhook.id);
    return [{ removed_webhook_id: webhook.id, next_steps: [] satisfies NextStep[] }];
  }
  throw badMethod(method, new URL(request.url).pathname);
}

const testStep = (webhook: Webhook): NextStep => ({
  tool: "test_webhook",
  arguments: { webhook_id: webhook.id },
  after_sec: null,
  reason: "Once your server checks the signature with signing_secret, send a test event to see it answer 2xx.",
});

const WEBHOOK_FIX: Record<string, string> = {
  endpoint_url: 'Give the https address your server takes events at, like "https://hooks.skyhopper.io/zaisma": a name, not an IP address, and not on Zaisma\'s own domains.',
  event_kinds: `Send a list of the events to send, from: ${WEBHOOK_EVENT_KINDS.join(", ")}.`,
  game_slugs: "Send null (or leave it out) for every game you have and will make, or a list of up to 50 of your games' slugs from list_games.",
};

function endpointUrlOrThrow(env: Env, given: unknown): string {
  const ownDomains = [new URL(env.SITE_ORIGIN).hostname, new URL(env.GAME_ORIGIN).hostname, env.GAME_DOMAIN, "zaisma.com", "zaismausercontent.com"].filter(Boolean);
  const checked = checkEndpointUrl(given, ownDomains, env.SITE_ORIGIN.startsWith("http://localhost"));
  if ("error" in checked) throw new ApiError("bad_endpoint_url", { message: checked.error, field: "endpoint_url", fix: WEBHOOK_FIX.endpoint_url! });
  return checked.endpointUrl;
}

function eventKindsOrThrow(given: unknown): WebhookEventKind[] {
  if (!Array.isArray(given) || given.length < 1 || given.some((kind) => !(WEBHOOK_EVENT_KINDS as readonly unknown[]).includes(kind))) {
    const wrong = Array.isArray(given) ? given.find((kind) => !(WEBHOOK_EVENT_KINDS as readonly unknown[]).includes(kind)) : undefined;
    throw new ApiError("bad_event_kinds", { message: wrong === undefined ? "event_kinds isn't a list of 1 or more event kinds." : `${JSON.stringify(wrong)} isn't an event kind.`, field: "event_kinds", fix: WEBHOOK_FIX.event_kinds! });
  }
  return [...new Set(given as WebhookEventKind[])];
}

async function gameSlugsOrThrow(env: Env, given: unknown, caller: Caller): Promise<string[] | null> {
  if (given === null) return null;
  if (!Array.isArray(given) || given.length < 1 || given.length > MAXIMUM_GAME_COUNT_PER_OWNER || given.some((slug) => typeof slug !== "string")) {
    throw new ApiError("bad_game_slugs", { message: `game_slugs isn't null or a list of 1 to ${MAXIMUM_GAME_COUNT_PER_OWNER} slugs.`, field: "game_slugs", fix: WEBHOOK_FIX.game_slugs! });
  }
  const slugs = [...new Set(given as string[])];
  for (const [i, slug] of slugs.entries()) await ownGame(env, slug, caller, `game_slugs[${i}]`);
  return slugs;
}

function webhookJson(webhook: Webhook, counts?: { pendingCount: number; failedCount: number }) {
  return {
    id: webhook.id,
    endpoint_url: webhook.endpoint_url,
    event_kinds: eventKindsOf(webhook),
    game_slugs: gameSlugsOf(webhook),
    pending_delivery_count: counts?.pendingCount ?? 0,
    failed_delivery_count: counts?.failedCount ?? 0,
    created_at: iso(webhook.created_at_ms),
    updated_at: iso(webhook.updated_at_ms),
  };
}

function deliveryJson(delivery: WebhookDelivery) {
  return {
    webhook_id: delivery.webhook_id,
    webhook_event: JSON.parse(delivery.event_json) as Record<string, unknown>,
    delivery_status: delivery.delivery_status,
    attempt_count: delivery.attempt_count,
    last_attempt_at: iso(delivery.last_attempt_at_ms),
    next_attempt_at: delivery.delivery_status === "pending" ? iso(delivery.next_attempt_at_ms) : null,
    failure_message: delivery.failure_message,
    created_at: iso(delivery.created_at_ms),
  };
}

// The JSON for each kind of thing, as schemas.ts describes it: the row's own names, with values in
// the API's form (ISO times, true and false, lists and objects instead of stored text).

function testerJson(env: Env, link: TesterLink) {
  return { id: link.id, name: link.name, link_url: `${env.SITE_ORIGIN}/t/${link.token}`, created_at: iso(link.created_at_ms), last_opened_at: iso(link.last_opened_at_ms) };
}

function previewUrl(env: Env, slug: string, token: string): string {
  return gameUrl(env, `${slug}--${token}`);
}

export function versionJson(env: Env, game: Game, version: Version) {
  return {
    id: version.id,
    file_count: version.file_count,
    size_bytes: version.size_bytes,
    // scanning, held (a person will look), approved or rejected.
    scan_status: version.scan_status,
    is_live: version.id === game.live_version_id,
    patch_notes: version.patch_notes,
    preview_url: version.preview_token && version.scan_status === "approved" ? previewUrl(env, game.slug, version.preview_token) : null,
    published_at: iso(version.published_at_ms),
    scheduled_publish_at: iso(version.scheduled_publish_at_ms),
    created_at: iso(version.created_at_ms),
    review_reason: versionReviewReason(version),
    findings: findingsFor(version),
  };
}

/** A person's or a report's decision about a version: a report paused this update, or a person rejected it. */
function versionReviewReason(version: Version) {
  if (version.report_held_at_ms && version.scan_status === "held") return reviewReasonAnswer(reviewReason("report_paused_update"));
  const reason = readReviewReason(version.review_reason);
  return reason ? reviewReasonAnswer(reason) : null;
}

/** Why the scan held or rejected a version, with the rule and the fix. Child-safety signals are never described: a person needs to look. */
function findingsFor(version: Version) {
  const report: ScanReport | null = version.scan_report ? JSON.parse(version.scan_report) : null;
  if (!report) return [];
  const shown: Finding[] = report.is_child_safety
    ? [{ stage: "static", severity: "hold", code: "needs_review", message: "" }]
    : report.findings.filter((finding) => finding.severity !== "info" && Object.hasOwn(REVIEW_CODES, finding.code));
  return shown.map((finding) => {
    const code = finding.code as ReviewCodeName;
    const reason = reviewReasonAnswer({ code, message: finding.message, content_rule: REVIEW_CODES[code].contentRule });
    return { code, severity: finding.severity, message: reason.message, content_rule: reason.content_rule, path: finding.path ?? null, fix: reason.fix };
  });
}

/** A game this caller owns, by its slug (or the input named by `field`). Someone else's game looks the same as no game. */
export async function ownGame(env: Env, slug: string, caller: Caller, field = "slug"): Promise<Game> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.owner_id !== caller.ownerId) {
    throw new ApiError("no_game", { message: `You don't have a game at zaisma.com/g/${slug}.`, field, fix: "list_games (GET /games) lists your games with their slugs; create_game makes a new one." });
  }
  return game;
}

export async function readJson(request: Request, maximumSizeBytes = 64 * 1024): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > maximumSizeBytes) {
    throw new ApiError("json_too_big", { message: `The JSON body is over ${maximumSizeBytes / 1024} KB, the most this call takes.`, fix: "Send less: big games go through the upload command (npx @zaisma/cli upload), and long text can be shortened." });
  }
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new ApiError("bad_json", { message: "The body isn't a JSON object.", fix: 'Send a JSON object, like { "title": "Sky Hopper" }, with Content-Type: application/json.' });
}

/** Inputs are closed: a field we don't take is an error, never quietly ignored (docs/NAMING.md). */
export function closedBody(body: Record<string, unknown>, fields: string[]): void {
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) throw new ApiError("unknown_field", { message: `${key} isn't a field of this call.`, field: key, fix: `Leave it out. The fields are: ${fields.join(", ")}.` });
  }
}

export function closedQuery(queryParameters: URLSearchParams, fields: string[]): void {
  for (const key of queryParameters.keys()) {
    if (!fields.includes(key)) throw new ApiError("unknown_field", { message: `${key} isn't a query parameter of this call.`, field: key, fix: `Leave it out. The parameters are: ${fields.join(", ")}.` });
  }
}

const splitLabels = (labels: string) => (labels ? labels.split(",") : []);

export function gameJson(env: Env, game: Game) {
  const waitingWords = game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as { title?: string; description?: string }) : null;
  return {
    slug: game.slug,
    page_url: `${env.SITE_ORIGIN}/g/${game.slug}`,
    title: game.title,
    description: game.description,
    visibility: game.visibility,
    // Ours, separate from visibility: pending (no version has passed review yet), live, held or removed, and why.
    review_status: game.review_status,
    review_reason: reasonAnswer(game.review_reason),
    devices: splitLabels(game.devices),
    controls: splitLabels(game.controls),
    screen_orientation: game.screen_orientation || null,
    play_modes: readPlayModes(game.play_modes),
    cloud_saves_enabled: Boolean(game.cloud_saves_enabled),
    multiplayer_mode: game.multiplayer_mode,
    room_browsing: game.room_browsing,
    account_requirement: game.account_requirement,
    details_waiting_for_review: waitingWords ? { title: waitingWords.title ?? null, description: waitingWords.description ?? null } : null,
    updated_at: iso(game.updated_at_ms),
  };
}

function imageJson(env: Env, image: GameImage) {
  return {
    id: image.id,
    kind: image.kind,
    review_status: image.review_status,
    review_reason: reasonAnswer(image.review_reason),
    width_px: image.width_px,
    height_px: image.height_px,
    size_bytes: image.size_bytes,
    image_url: `${env.SITE_ORIGIN}/img/${image.id}`,
    created_at: iso(image.created_at_ms),
  };
}

/**
 * Covers and screenshots. Only real PNG, JPEG or WebP files are stored (checked by their bytes),
 * and they're sent with headers that stop a browser treating them as anything else.
 */
async function serveImage(request: Request, env: Env, id: string): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!isIdOf("image", id) || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const image = await imageById(env.DB, id);
  if (!image || image.review_status === "rejected") return notFound();
  const game = await env.DB.prepare("SELECT review_status, owner_id FROM games WHERE id = ?").bind(image.game_id).first<{ review_status: string; owner_id: string | null }>();
  if (!game) return notFound();
  let cacheControl = "public, max-age=3600";
  if (image.review_status !== "approved" || game.review_status === "removed") {
    // Before review only the owner sees it.
    const session = await currentSession(request, env);
    const owner = session ? await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(session.userId).first<{ id: string }>() : null;
    if (!owner || owner.id !== game.owner_id) return notFound();
    cacheControl = "private, no-store";
  }
  const stored = await env.GAMES.get(imageKey(image));
  if (!stored) return notFound();
  return new Response(request.method === "HEAD" ? null : stored.body, {
    headers: {
      "Content-Type": image.content_type,
      "Content-Length": String(stored.size),
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
