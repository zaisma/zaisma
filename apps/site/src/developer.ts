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
  KNOWN_IMAGE_RULE,
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
  FREE_PLAYER_HOURS,
  monthPlayerSeconds,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { feedbackRoute } from "./feedback.ts";
import { forumRoute } from "./forum.ts";
import { playStats } from "./plays.ts";
import { sendAlert } from "./email.ts";
import { KNOWN_IMAGE_ALERT, imageMatcher, pruneVersions } from "./scan.ts";

/**
 * The developer API: one API for the MCP, the upload command and the dashboard, so they always agree.
 * Callers sign in with an API key (Authorization: Bearer zsk_…) or, from our own pages, the session cookie.
 * Rows are stored with the names the API shows (docs/NAMING.md), so answers pass them through and only
 * change a value's form: times become ISO, 0 and 1 become false and true, stored JSON becomes objects.
 *
 *   GET    /api/dev/games                      your games
 *   POST   /api/dev/games                      make a game (starts as a draft)
 *   GET    /api/dev/games/:slug                one game, with its images, versions and tester links
 *   PATCH  /api/dev/games/:slug                title, description, visibility, devices, controls, screen_orientation, play_modes, cloud_saves_enabled, room_browsing, multiplayer_mode
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
 *   …/api/dev/forum                            the developer forum: topics, replies, Me too (see forum.ts)
 *   …/api/dev/feedback                         the first feedback calls, kept for older clients (see feedback.ts)
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
}

/** A refusal with its HTTP status, a stable code and a message for whoever called. */
export class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, httpStatus = 200, cookies: string[] = []) => {
  const response = Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
};

export async function handleDeveloper(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path.startsWith("/img/")) return serveImage(request, env, path.slice(5));
  if (path !== "/api/dev" && !path.startsWith("/api/dev/")) return null;
  try {
    const caller = await authenticate(request, env);
    return await route(request, env, path.slice("/api/dev".length) || "/", caller);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.httpStatus);
    throw error;
  }
}

export async function authenticate(request: Request, env: Env): Promise<Caller> {
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
  // Sending a game's files is many small requests, so it has its own, bigger allowance.
  const rateLimit = new URL(request.url).pathname.startsWith("/api/dev/files/") ? env.FILE_LIMIT : env.DEV_LIMIT;
  if (rateLimit && !(await rateLimit.limit({ key: accountId })).success) throw new ApiError(429, "slow_down", "Too many requests. Wait a minute and try again.");
  const caller = await callerFor(env, accountId, cookies);
  if (!caller) throw new ApiError(401, "no_account", "Finish making your account first.");
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

export async function route(request: Request, env: Env, path: string, caller: Caller): Promise<Response> {
  const method = request.method;
  const answer = (body: unknown, httpStatus = 200) => json(body, httpStatus, caller.cookies);

  if (path === "/games" && method === "GET") {
    const [{ results: games }, unread] = await Promise.all([
      env.DB.prepare("SELECT * FROM games WHERE owner_id = ? ORDER BY updated_at_ms DESC").bind(caller.ownerId).all<Game>(),
      env.DB.prepare("SELECT COUNT(*) AS topic_count FROM feedback WHERE account_id = ? AND news_at > COALESCE(seen_at, 0)").bind(caller.accountId).first<{ topic_count: number }>(),
    ]);
    // Your forum topics with a reply or change from Zaisma you haven't opened yet.
    return answer({ games: games.map((game) => gameJson(env, game)), unread_topic_count: unread?.topic_count ?? 0 });
  }

  if (path === "/feedback" || path.startsWith("/feedback/")) {
    const routed = await feedbackRoute(request, env, path, caller);
    return routed instanceof Response ? routed : answer(...routed);
  }
  if (path === "/forum" || path.startsWith("/forum/")) {
    const routed = await forumRoute(request, env, path, caller);
    return routed instanceof Response ? routed : answer(...routed);
  }

  if (path === "/games" && method === "POST") {
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 80) throw new ApiError(400, "bad_title", "The title needs 1 to 80 characters.");
    const slug = typeof body.slug === "string" && body.slug ? body.slug.trim().toLowerCase() : slugify(title);
    const slugError = checkSlug(slug);
    if (slugError) throw new ApiError(400, "bad_slug", `Link name: ${slugError}`);
    if (await gameBySlug(env.DB, slug)) throw new ApiError(409, "slug_taken", `zaisma.com/g/${slug} is taken. Pick another link name.`);
    const owned = await env.DB.prepare("SELECT COUNT(*) AS game_count FROM games WHERE owner_id = ?").bind(caller.ownerId).first<{ game_count: number }>();
    if ((owned?.game_count ?? 0) >= MAXIMUM_GAME_COUNT_PER_OWNER) throw new ApiError(403, "too_many_games", `You can have up to ${MAXIMUM_GAME_COUNT_PER_OWNER} games. Ask us if you need more.`);
    const checked = checkDetails({ ...body, title });
    if ("error" in checked) throw new ApiError(400, "bad_details", checked.error);
    let game = await createGame(env.DB, { slug, title, description: checked.change.description ?? "", ownerId: caller.ownerId, visibility: "draft" });
    await applyDetails(env.DB, game, { ...checked.change, title: undefined, description: undefined });
    game = (await gameBySlug(env.DB, slug))!;
    await audit(env.DB, game.id, "created", "Made through the developer API", caller.actor);
    return answer({ game: gameJson(env, game) }, 201);
  }

  // One file of a game, by its SHA-256. Storage checks the hash, so a file can't claim to be another.
  const blobPath = path.match(/^\/files\/([0-9a-f]{64})$/);
  if (blobPath && method === "PUT") return answer(await putBlob(request, env, blobPath[1]!));
  const partsPath = path.match(/^\/files\/([0-9a-f]{64})\/parts(?:\/(\d{1,5}|done))?$/);
  if (partsPath) return answer(await bigFile(request, env, partsPath[1]!, partsPath[2], caller));

  const versionPath = path.match(/^\/games\/([a-z0-9-]+)\/(uploads|versions)(?:\/([a-z0-9]+)(\/publish)?)?$/);
  if (versionPath) return answer(...(await versionRoute(request, env, await ownGame(env, versionPath[1]!, caller), versionPath[2]!, versionPath[3], Boolean(versionPath[4]), caller)));

  const factsPath = path.match(/^\/games\/([a-z0-9-]+)\/(reports|stats|history)$/);
  if (factsPath && method === "GET") {
    const game = await ownGame(env, factsPath[1]!, caller);
    const query = new URL(request.url).searchParams;
    if (factsPath[2] === "reports") return answer(await reportsFor(env, game, query.get("cursor")));
    if (factsPath[2] === "stats") return answer(await statsFor(env, game, Number(query.get("period_duration_days") ?? 30)));
    return answer(await historyFor(env, game, caller));
  }

  const testerPath = path.match(/^\/games\/([a-z0-9-]+)\/testers(?:\/([a-z0-9]+))?$/);
  if (testerPath) return answer(...(await testerRoute(request, env, await ownGame(env, testerPath[1]!, caller), testerPath[2], caller)));

  const gamePath = path.match(/^\/games\/([a-z0-9-]+)(?:\/images(?:\/([a-z0-9]+))?)?$/);
  if (!gamePath) throw new ApiError(404, "not_found", "No such API path.");
  const game = await ownGame(env, gamePath[1]!, caller);
  const isImages = path.includes("/images");

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
    const checked = checkDetails(await readJson(request));
    if ("error" in checked) throw new ApiError(400, "bad_details", checked.error);
    if (game.review_status === "removed" && checked.change.visibility) throw new ApiError(403, "removed", "This game was taken down, so its visibility can't change.");
    const { multiplayer_mode: multiplayerMode, ...details } = checked.change;
    const changesMultiplayer = multiplayerMode !== undefined && multiplayerMode !== game.multiplayer_mode;
    if (changesMultiplayer && game.multiplayer_mode === "built-in") {
      throw new ApiError(403, "built_in_server", "This game runs a game server built into Zaisma; ask us to change its multiplayer.");
    }
    const { isWaitingForReview } = await applyDetails(env.DB, game, { ...details, ...(changesMultiplayer ? { multiplayer_mode: multiplayerMode } : {}) });
    if (Object.keys(details).length) await audit(env.DB, game.id, "details", Object.keys(details).join(", ") + (isWaitingForReview ? " (words waiting for review)" : ""), caller.actor);
    if (changesMultiplayer) await audit(env.DB, game.id, "multiplayer", `Multiplayer: ${multiplayerMode}`, caller.actor);
    const gameServerProblem = multiplayerMode === "own" ? await liveServerProblem(env, game) : null;
    return answer({
      game: gameJson(env, (await gameBySlug(env.DB, game.slug))!),
      review_message: isWaitingForReview ? "The new title or description shows once it's reviewed." : null,
      game_server_problem: gameServerProblem,
    });
  }

  if (isImages && !gamePath[2] && method === "POST") {
    const kind = new URL(request.url).searchParams.get("kind") as ImageKind;
    if (kind !== "cover" && kind !== "square" && kind !== "screenshot") throw new ApiError(400, "bad_kind", "Add ?kind=cover, ?kind=square or ?kind=screenshot.");
    const declaredSizeBytes = Number(request.headers.get("content-length") ?? 0);
    if (declaredSizeBytes > IMAGE_LIMITS.maximumSizeBytes) throw new ApiError(413, "image_too_big", "Images can be up to 5 MB.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > IMAGE_LIMITS.maximumSizeBytes) throw new ApiError(413, "image_too_big", "Images can be up to 5 MB.");
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new ApiError(415, "not_an_image", "Send a PNG, JPEG or WebP image as the request body.");
    const { widthPx, heightPx } = sniffed;
    if (Math.min(widthPx, heightPx) < IMAGE_LIMITS.minimumSidePx || Math.max(widthPx, heightPx) > IMAGE_LIMITS.maximumSidePx) {
      throw new ApiError(400, "bad_size", `Images need to be at least ${IMAGE_LIMITS.minimumSidePx} px on each side and at most ${IMAGE_LIMITS.maximumSidePx} px.`);
    }
    if (kind === "square" && (!isSquare(widthPx, heightPx) || widthPx < IMAGE_LIMITS.minimumSquareSidePx)) {
      throw new ApiError(400, "not_square", `A square cover needs to be as wide as it is tall, at least ${IMAGE_LIMITS.minimumSquareSidePx} px.`);
    }
    // Matched against known abuse material before anyone sees it. A match is kept for reporting, never shown.
    // If matching fails, the picture waits for a person as usual.
    const matched = await imageMatcher(env).check([{ path: `${kind} image`, type: sniffed.type, id: "upload", body: async () => bytes }]);
    if (matched.findings.some((finding) => finding.rule === KNOWN_IMAGE_RULE)) {
      const id = newId();
      await env.GAMES.put(heldImageKey(game.id, id), bytes, { httpMetadata: { contentType: sniffed.type } });
      await audit(env.DB, game.id, "image-held", `A ${kind} upload matched known abuse material. Kept at ${heldImageKey(game.id, id)}; never shown.`, caller.actor);
      await sendAlert(env, `URGENT: known abuse image uploaded to ${game.slug}`, `${KNOWN_IMAGE_ALERT}\n\nA ${kind} upload, kept at ${heldImageKey(game.id, id)} in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
      throw new ApiError(422, "image_refused", "This image can't be used.");
    }
    const existing = await imagesForGame(env.DB, game.id);
    const waitingImages = existing.filter((image) => image.kind === kind && image.review_status === "pending");
    if (kind === "screenshot" && existing.filter((image) => image.kind === "screenshot" && image.review_status !== "rejected").length >= IMAGE_LIMITS.maximumScreenshotCount) {
      throw new ApiError(400, "too_many_screenshots", `A game can have ${IMAGE_LIMITS.maximumScreenshotCount} screenshots. Remove one first.`);
    }
    if (kind !== "screenshot" && waitingImages.length) {
      // Only the newest cover of each kind waits for review.
      for (const old of waitingImages) {
        await env.GAMES.delete(imageKey(old));
        await deleteImageRow(env.DB, old.id);
      }
    }
    const id = newId();
    await env.GAMES.put(imageKey({ game_id: game.id, id }), bytes, { httpMetadata: { contentType: sniffed.type } });
    const image = await addImage(env.DB, { id, game_id: game.id, kind, content_type: sniffed.type, width_px: widthPx, height_px: heightPx, size_bytes: bytes.byteLength });
    await audit(env.DB, game.id, "image-added", `${kind} ${id}`, caller.actor);
    return answer({ image: imageJson(env, image), review_message: "It shows on the game page once it's reviewed." }, 201);
  }

  if (isImages && gamePath[2] && method === "DELETE") {
    const image = await imageById(env.DB, gamePath[2]);
    if (!image || image.game_id !== game.id) throw new ApiError(404, "no_image", "This game has no image with that ID.");
    await env.GAMES.delete(imageKey(image));
    await deleteImageRow(env.DB, image.id);
    await audit(env.DB, game.id, "image-removed", `${image.kind} ${image.id}`, caller.actor);
    return answer({ removed_image_id: image.id });
  }

  throw new ApiError(405, "bad_method", `${method} isn't used here.`);
}

async function putBlob(request: Request, env: Env, sha256: string): Promise<unknown> {
  const sizeBytes = Number(request.headers.get("content-length") ?? -1);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new ApiError(411, "no_length", "Send the file with a Content-Length header.");
  if (sizeBytes > FILE_LIMITS.maximumDirectSizeBytes) throw new ApiError(413, "file_too_big", `Send files over ${FILE_LIMITS.maximumDirectSizeBytes / 1048576} MB in parts: POST /api/dev/files/<sha256>/parts.`);
  if ((await missingBlobs(env.DB, [sha256])).length === 0) {
    await request.body?.cancel();
    return { sha256, storage_status: "already_stored" };
  }
  if (!request.body) throw new ApiError(400, "no_body", "Send the file as the request body.");
  try {
    await env.GAMES.put(blobKey(sha256), request.body, { sha256 });
  } catch {
    throw new ApiError(400, "hash_mismatch", "The file doesn't match its SHA-256. Hash the file again and resend it.");
  }
  // Programs and archives aren't allowed in games, whatever they're called.
  const start = await env.GAMES.get(blobKey(sha256), { range: { offset: 0, length: 16 } });
  const forbidden = start ? forbiddenContent(new Uint8Array(await start.arrayBuffer())) : null;
  if (forbidden) {
    await env.GAMES.delete(blobKey(sha256));
    throw new ApiError(400, "forbidden_file", `That file looks like ${forbidden}, which isn't allowed in games.`);
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
    const sizeBytes = (await readJson(request)).size_bytes;
    if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0) throw new ApiError(400, "bad_size", 'Send { "size_bytes": <the file\'s size> }.');
    if ((sizeBytes as number) > FILE_LIMITS.maximumFileSizeBytes) throw new ApiError(413, "file_too_big", `Files can be up to ${FILE_LIMITS.maximumFileSizeBytes / 1048576} MB.`);
    if ((await missingBlobs(env.DB, [sha256], caller.ownerId)).length === 0) return { sha256, storage_status: "already_stored", upload_id: null, part_size_bytes: null, part_count: null };
    const upload = await env.GAMES.createMultipartUpload(key);
    return { sha256, storage_status: "upload_started", upload_id: upload.uploadId, part_size_bytes: FILE_LIMITS.partSizeBytes, part_count: Math.ceil((sizeBytes as number) / FILE_LIMITS.partSizeBytes) };
  }
  if (step && step !== "done" && request.method === "PUT") {
    const partNumber = Number(step);
    const uploadId = new URL(request.url).searchParams.get("upload_id") ?? "";
    const sizeBytes = Number(request.headers.get("content-length") ?? -1);
    if (partNumber < 1 || partNumber > 10_000 || !uploadId) throw new ApiError(400, "bad_part", "Send parts numbered from 1, with ?upload_id=<the upload_id>.");
    if (!(sizeBytes > 0 && sizeBytes <= FILE_LIMITS.partSizeBytes) || !request.body) throw new ApiError(400, "bad_part", `Each part is up to ${FILE_LIMITS.partSizeBytes / 1048576} MB, with a Content-Length header.`);
    try {
      const part = await env.GAMES.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, request.body);
      return { part_number: part.partNumber, etag: part.etag };
    } catch {
      throw new ApiError(400, "bad_upload", "That upload isn't open any more. Start again.");
    }
  }
  if (step === "done" && request.method === "POST") {
    const body = await readJson(request, 1024 * 1024);
    const parts = Array.isArray(body.parts) ? (body.parts as { part_number?: unknown; etag?: unknown }[]) : [];
    if (typeof body.upload_id !== "string" || !parts.length || !parts.every((part) => Number.isInteger(part.part_number) && typeof part.etag === "string")) {
      throw new ApiError(400, "bad_parts", 'Send { "upload_id", "parts": [{ "part_number", "etag" }] }.');
    }
    let stored: R2Object;
    try {
      stored = await env.GAMES.resumeMultipartUpload(key, body.upload_id).complete(parts.map((part) => ({ partNumber: part.part_number as number, etag: part.etag as string })));
    } catch {
      throw new ApiError(400, "bad_parts", "Those parts don't make a whole file. Check every part was sent, then try again.");
    }
    if (stored.size > FILE_LIMITS.maximumFileSizeBytes) {
      await env.GAMES.delete(key);
      throw new ApiError(413, "file_too_big", `Files can be up to ${FILE_LIMITS.maximumFileSizeBytes / 1048576} MB.`);
    }
    const start = await env.GAMES.get(key, { range: { offset: 0, length: 16 } });
    const forbidden = start ? forbiddenContent(new Uint8Array(await start.arrayBuffer())) : null;
    if (forbidden) {
      await env.GAMES.delete(key);
      throw new ApiError(400, "forbidden_file", `That file looks like ${forbidden}, which isn't allowed in games.`);
    }
    await addOwnedBlob(env.DB, caller.ownerId, sha256, stored.size);
    return { sha256, storage_status: "stored_now", size_bytes: stored.size };
  }
  throw new ApiError(405, "bad_method", `${request.method} isn't used here.`);
}

async function versionRoute(request: Request, env: Env, game: Game, what: string, id: string | undefined, isPublish: boolean, caller: Caller): Promise<[unknown, number?]> {
  const method = request.method;
  if (game.review_status === "removed" && method !== "GET") throw new ApiError(403, "removed", "This game was taken down, so it can't get new versions.");

  // Step 1: which of these files do you still need to send?
  if (what === "uploads" && !id && method === "POST") {
    const files = listOrThrow((await readJson(request, 4 * 1024 * 1024)).files);
    const missing = await missingBlobs(env.DB, files.map((file) => file.sha256), caller.ownerId);
    return [{ file_count: files.length, size_bytes: files.reduce((totalSizeBytes, file) => totalSizeBytes + file.size_bytes, 0), missing_file_hashes: missing }];
  }

  // Step 2: make the version once every file is stored. It's scanned, then waits as a draft.
  if (what === "versions" && !id && method === "POST") {
    const body = await readJson(request, 4 * 1024 * 1024);
    const files = listOrThrow(body.files);
    if (body.publish_when_approved !== undefined && typeof body.publish_when_approved !== "boolean") throw new ApiError(400, "bad_publish", "publish_when_approved is true or false.");
    const patchNotes = typeof body.patch_notes === "string" ? body.patch_notes.trim() : "";
    if (patchNotes.length > FILE_LIMITS.maximumPatchNotesCharacterCount) throw new ApiError(400, "notes_too_long", `Patch notes can be up to ${FILE_LIMITS.maximumPatchNotesCharacterCount} characters.`);
    const found = await locateBlobs(env.DB, files.map((file) => file.sha256), caller.ownerId);
    const missingCount = files.filter((file) => !found.has(file.sha256)).length;
    if (missingCount) throw new ApiError(409, "files_missing", `${missingCount} file(s) haven't been sent yet. Send them to PUT /api/dev/files/<sha256> first.`);
    const today = await env.DB.prepare("SELECT COUNT(*) AS version_count FROM versions WHERE game_id = ? AND created_at_ms > ?").bind(game.id, Date.now() - DAY_MS).first<{ version_count: number }>();
    if ((today?.version_count ?? 0) >= FILE_LIMITS.maximumVersionsPerDay) throw new ApiError(429, "too_many_versions", `A game can get ${FILE_LIMITS.maximumVersionsPerDay} versions a day. Try again tomorrow.`);
    const versionId = newId();
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
    await audit(env.DB, game.id, "upload", `Version ${versionId}, ${files.length} files`, caller.actor);
    await env.SCAN_QUEUE.send({ versionId });
    return [{ version: versionJson(env, game, (await versionById(env.DB, versionId))!) }, 201];
  }

  const version = id ? await versionById(env.DB, id) : null;
  if (id && (!version || version.game_id !== game.id)) throw new ApiError(404, "no_version", "This game has no version with that ID.");

  if (version && !isPublish && method === "GET") return [{ version: versionJson(env, game, version) }];

  // Publish later: { "scheduled_publish_at": "2026-11-01T17:00:00Z" }. It goes live then if it has passed review.
  const body = version && isPublish && method === "POST" ? await readJson(request).catch(() => ({}) as Record<string, unknown>) : {};
  if (version && isPublish && method === "POST" && body.scheduled_publish_at !== undefined) {
    const scheduledAtMs = typeof body.scheduled_publish_at === "string" && ISO_TIME.test(body.scheduled_publish_at) ? Date.parse(body.scheduled_publish_at) : NaN;
    if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now() + 60_000 || scheduledAtMs > Date.now() + 90 * DAY_MS) {
      throw new ApiError(400, "bad_time", 'Give "scheduled_publish_at" as an ISO time from a few minutes to 90 days from now, like "2026-11-01T17:00:00Z".');
    }
    if (version.scan_status !== "approved" && version.scan_status !== "scanning") throw new ApiError(409, "not_approved", "Only versions that passed review can be published.");
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(scheduledAtMs, version.id).run();
    await audit(env.DB, game.id, "publish-scheduled", `Version ${version.id} at ${iso(scheduledAtMs)}`, caller.actor);
    return [{ game: gameJson(env, game), version: versionJson(env, game, (await versionById(env.DB, version.id))!) }];
  }
  if (version && isPublish && method === "DELETE") {
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL WHERE id = ?").bind(version.id).run();
    await audit(env.DB, game.id, "publish-unscheduled", `Version ${version.id}`, caller.actor);
    return [{ game: gameJson(env, game), version: versionJson(env, game, (await versionById(env.DB, version.id))!) }];
  }

  // Publish a draft now, or roll back to any version we've kept.
  if (version && isPublish && method === "POST") {
    if (version.scan_status !== "approved") throw new ApiError(409, "not_approved", version.scan_status === "scanning" ? "This version is still being scanned." : "Only versions that passed review can be published.");
    await publishVersion(env.DB, version);
    await audit(env.DB, game.id, version.published_at_ms ? "rolled-back" : "published", `Version ${version.id}`, caller.actor);
    await pruneVersions(env, game.id);
    const published = (await gameBySlug(env.DB, game.slug))!;
    return [{ game: gameJson(env, published), version: versionJson(env, published, (await versionById(env.DB, version.id))!) }];
  }

  throw new ApiError(405, "bad_method", `${method} isn't used here.`);
}

const DAY_MS = 86400_000;
/** An ISO 8601 time with Z or an offset: the only form times come in (docs/NAMING.md). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Opaque cursors for lists that continue: they say where the last answer ended. */
const cursorFor = (atMs: number) => `cursor_${atMs.toString(36)}`;
function readCursor(cursor: string | null): number {
  if (!cursor) return 0;
  if (!/^cursor_[0-9a-z]{1,12}$/.test(cursor)) throw new ApiError(400, "bad_cursor", "Pass the next_cursor from your last call as cursor, as it came.");
  return parseInt(cursor.slice(7), 36);
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
    .prepare("SELECT reason, status, COUNT(*) AS report_count FROM reports WHERE game_id = ? AND created_at > ? AND reason != 'child_safety' AND severity > 0 GROUP BY reason, status")
    .bind(game.id, fromMs)
    .all<{ reason: string; status: string; report_count: number }>();
  const byReason = new Map<string, { reason: string; label: string; open_count: number; closed_count: number }>();
  for (const row of counts) {
    const reason = byReason.get(row.reason) ?? { reason: row.reason, label: REPORT_REASONS[row.reason as ReportReason] ?? row.reason, open_count: 0, closed_count: 0 };
    byReason.set(row.reason, reason);
    if (row.status === "open") reason.open_count += row.report_count;
    else reason.closed_count += row.report_count;
  }
  const { results: bugs } = await env.DB
    .prepare("SELECT id, details, triage, version_id, created_at, bug_at FROM reports WHERE game_id = ? AND bug = 1 AND severity > 0 AND bug_at > ? AND details != '' ORDER BY bug_at DESC LIMIT 50")
    .bind(game.id, Math.max(sinceMs, fromMs))
    .all<{ id: string; details: string; triage: string | null; version_id: string | null; created_at: number; bug_at: number }>();
  return {
    period_duration_days: 90,
    // Open: waiting for us. Closed: we looked and either dismissed it or acted on it.
    reasons: [...byReason.values()],
    bug_reports: bugs.map((bug) => ({
      id: bug.id,
      player_text: bug.details,
      summary: bug.triage ? (JSON.parse(bug.triage) as { summary: string }).summary : null,
      version_id: bug.version_id,
      reported_at: iso(bug.created_at),
    })),
    // Pass this as `cursor` next time to get only bug reports that arrived after this call.
    next_cursor: cursorFor(Math.max(sinceMs, ...bugs.map((bug) => bug.bug_at))),
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
  const [plays, { results: roomDays }, { results: errors }, monthSeconds] = await Promise.all([
    playStats(env.DB, game.id, dayCount),
    env.DB
      .prepare("SELECT day, rooms, player_seconds, messages, server_calls, server_crashes, server_stops, server_broken_rooms FROM room_usage WHERE game_id = ? AND day >= ? ORDER BY day")
      .bind(game.id, fromDate)
      .all<{ day: string; rooms: number; player_seconds: number; messages: number; server_calls: number; server_crashes: number; server_stops: number; server_broken_rooms: number }>(),
    env.DB
      .prepare("SELECT version_id, kind, message, count, first_at, last_at FROM game_server_errors WHERE game_id = ? ORDER BY last_at DESC LIMIT 20")
      .bind(game.id)
      .all<{ version_id: string; kind: "crash" | "stopped"; message: string; count: number; first_at: number; last_at: number }>(),
    monthPlayerSeconds(env.DB, game.id),
  ]);
  const hasOwnServer = game.multiplayer_mode === "own";
  return {
    period_duration_days: dayCount,
    play_stats: {
      days: plays.days.map((day) => ({ date: day.day, play_count: day.plays, player_count: day.players, new_player_count: day.new_players, play_duration_min: day.minutes_played, started_play_count: day.all_plays })),
      play_count: plays.plays,
      started_play_count: plays.all_plays,
      new_player_count: plays.new_players,
      play_duration_min: plays.minutes_played,
      average_play_duration_min: plays.minutes_per_play,
      came_back: Object.fromEntries(
        Object.entries(plays.came_back).map(([after, cameBack]) => [after, { returned_pct: cameBack.percent, returned_player_count: cameBack.players, new_player_count: cameBack.of }]),
      ),
    },
    multiplayer_days: roomDays.map((day) => ({
      date: day.day,
      room_count: day.rooms,
      room_play_duration_min: Math.round(day.player_seconds / 60),
      message_count: day.messages,
      game_server: hasOwnServer ? { call_count: day.server_calls, crash_count: day.server_crashes, stopped_count: day.server_stops, ended_match_count: day.server_broken_rooms } : null,
    })),
    // Until Hosting billing exists, new rooms stop opening at the free tier until the month resets (UTC).
    room_use_this_month: { room_play_duration_hours: Math.round(monthSeconds / 360) / 10, free_room_play_duration_hours: FREE_PLAYER_HOURS, has_reached_free_hours: monthSeconds >= FREE_PLAYER_HOURS * 3600 },
    // Crashes lose one call each and the match carries on. "stopped" is a call that ran on too long
    // (about 2 seconds of CPU, like a loop that never ends): it freezes the match while it runs,
    // and a match whose game server is stopped twice ends.
    game_server_errors: hasOwnServer
      ? errors.map((error) => ({ kind: error.kind, message: error.message, occurrence_count: error.count, version_id: error.version_id, first_at: iso(error.first_at), last_at: iso(error.last_at) }))
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
    .prepare("SELECT action, reason, actor, happened_at_ms FROM audit_log WHERE game_id = ? ORDER BY happened_at_ms DESC, id DESC LIMIT 100")
    .bind(game.id)
    .all<{ action: string; reason: string; actor: string; happened_at_ms: number }>();
  const events: { description: string; version_id: string | null; done_by: "you" | "zaisma"; happened_at: string | null }[] = [];
  for (const entry of results) {
    const description = HISTORY[entry.action];
    if (!description) continue;
    events.push({ description, version_id: entry.reason.match(/[Vv]ersion ([a-z0-9]+)/)?.[1] ?? null, done_by: entry.actor === caller.actor ? "you" : "zaisma", happened_at: iso(entry.happened_at_ms) });
  }
  return { events };
}

function listOrThrow(files: unknown): UploadFile[] {
  try {
    return checkUploadList(files);
  } catch (error) {
    if (error instanceof UploadError) throw new ApiError(400, "bad_files", error.message);
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
    if (game.review_status === "removed") throw new ApiError(403, "removed", "This game was taken down, so it can't get tester links.");
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 60) throw new ApiError(400, "bad_name", "Name the link for who it's for, in 1 to 60 characters, like \"Playtesters\" or \"My team\".");
    const links = await testerLinks(env.DB, game.id);
    if (links.length >= MAXIMUM_TESTER_LINK_COUNT) throw new ApiError(403, "too_many_testers", `A game can have up to ${MAXIMUM_TESTER_LINK_COUNT} tester links. Turn one off first.`);
    const link = await addTesterLink(env.DB, game.id, name);
    await audit(env.DB, game.id, "tester-link-added", name, caller.actor);
    return [{ tester: testerJson(env, link) }, 201];
  }
  if (id && request.method === "DELETE") {
    const link = (await testerLinks(env.DB, game.id)).find((candidate) => candidate.id === id);
    if (!link || !(await revokeTesterLink(env.DB, game.id, id))) throw new ApiError(404, "no_tester_link", "That tester link isn't on.");
    await audit(env.DB, game.id, "tester-link-removed", link.name, caller.actor);
    return [{ removed_tester_id: link.id }];
  }
  throw new ApiError(405, "bad_method", "Tester links take GET, POST and DELETE.");
}

// The JSON for each kind of thing, as schemas.ts describes it: the row's own names, with values in
// the API's form (ISO times, true and false, lists and objects instead of stored text).

function testerJson(env: Env, link: TesterLink) {
  return { id: link.id, name: link.name, link_url: `${env.SITE_ORIGIN}/t/${link.token}`, created_at: iso(link.created_at_ms), last_opened_at: iso(link.last_opened_at_ms) };
}

function previewUrl(env: Env, slug: string, token: string): string {
  return gameUrl(env, `${slug}--${token}`);
}

function versionJson(env: Env, game: Game, version: Version) {
  const report: ScanReport | null = version.scan_report ? JSON.parse(version.scan_report) : null;
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
    // Why a version was held or rejected. Child-safety findings are never described.
    findings: !report
      ? []
      : report.childSafety
        ? [{ severity: "hold", rule: "review", explanation: "A person needs to look at this version.", path: null }]
        : report.findings.filter((finding) => finding.severity !== "info").map((finding) => ({ severity: finding.severity, rule: finding.rule, explanation: finding.detail, path: finding.path ?? null })),
  };
}

/** A game this caller owns. Someone else's game looks the same as no game. */
export async function ownGame(env: Env, slug: string, caller: Caller): Promise<Game> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.owner_id !== caller.ownerId) throw new ApiError(404, "no_game", `You don't have a game at zaisma.com/g/${slug}.`);
  return game;
}

export async function readJson(request: Request, maximumSizeBytes = 64 * 1024): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > maximumSizeBytes) throw new ApiError(413, "too_big", `Send less than ${maximumSizeBytes / 1024} KB of JSON.`);
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new ApiError(400, "bad_json", "Send a JSON object.");
}

const splitLabels = (labels: string) => (labels ? labels.split(",") : []);

function gameJson(env: Env, game: Game) {
  const waitingWords = game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as { title?: string; description?: string }) : null;
  return {
    slug: game.slug,
    page_url: `${env.SITE_ORIGIN}/g/${game.slug}`,
    title: game.title,
    description: game.description,
    visibility: game.visibility,
    // Ours, separate from visibility: pending (no version has passed review yet), live, held or removed.
    review_status: game.review_status,
    devices: splitLabels(game.devices),
    controls: splitLabels(game.controls),
    screen_orientation: game.screen_orientation || null,
    play_modes: readPlayModes(game.play_modes),
    cloud_saves_enabled: Boolean(game.cloud_saves_enabled),
    multiplayer_mode: game.multiplayer_mode,
    room_browsing: game.room_browsing,
    details_waiting_for_review: waitingWords ? { title: waitingWords.title ?? null, description: waitingWords.description ?? null } : null,
    updated_at: iso(game.updated_at_ms),
  };
}

function imageJson(env: Env, image: GameImage) {
  return {
    id: image.id,
    kind: image.kind,
    review_status: image.review_status,
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
  if (!/^[a-z0-9]{1,40}$/.test(id) || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
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
