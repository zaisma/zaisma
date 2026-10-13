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
  FILE_LIMITS,
  UploadError,
  addBlob,
  blobKey,
  checkUploadList,
  createVersion,
  forbiddenContent,
  manifestKey,
  multiplayerOf,
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
  SANDBOX_GAME_SERVER,
  MAX_TESTER_LINKS,
  addTesterLink,
  revokeTesterLink,
  testerLinks,
  type TesterLink,
  readPlayers,
  type ReportReason,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { pruneVersions } from "./scan.ts";

/**
 * The developer API: one API for the MCP, the upload command and the dashboard, so they always agree.
 * Callers sign in with an API key (Authorization: Bearer zsk_…) or, from our own pages, the session cookie.
 *
 *   GET    /api/dev/games                      your games
 *   POST   /api/dev/games                      make a game (starts as a draft)
 *   GET    /api/dev/games/:slug                one game, with its images and versions
 *   PATCH  /api/dev/games/:slug                title, description, visibility, devices, controls, screen, players, cloud_saves, room_browsing, multiplayer
 *   POST   /api/dev/games/:slug/images?kind=   add a cover or screenshot (the image bytes as the body)
 *   DELETE /api/dev/games/:slug/images/:id     remove one
 *   POST   /api/dev/games/:slug/uploads        which of these files still need sending
 *   PUT    /api/dev/files/:sha256              send one file
 *   POST   /api/dev/games/:slug/versions       make a version from stored files (scanned, then a draft)
 *   GET    /api/dev/games/:slug/versions/:id   scan result, findings and preview link
 *   POST   /api/dev/games/:slug/versions/:id/publish   publish a draft or roll back; { "at" } publishes later
 *   DELETE /api/dev/games/:slug/versions/:id/publish   cancel a publish-later
 *   POST   /api/dev/files/:sha256/parts        send a big file in parts (see bigFile)
 *   GET    /api/dev/games/:slug/reports        what players reported, by reason
 *   GET    /api/dev/games/:slug/stats          multiplayer room use per day
 *   GET    /api/dev/games/:slug/history        what happened to the game, and who did it
 *   GET    /api/dev/games/:slug/testers        tester links that are on
 *   POST   /api/dev/games/:slug/testers        make a tester link: { "name" }
 *   DELETE /api/dev/games/:slug/testers/:id    turn one off for good
 *
 * Images are served from /img/:id once approved; owners can see their own before that.
 */

export interface Caller {
  accountId: string;
  ownerId: string;
  actor: string;
  cookies: string[];
}

export class ApiError extends Error {
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
  const limit = new URL(request.url).pathname.startsWith("/api/dev/files/") ? env.FILE_LIMIT : env.DEV_LIMIT;
  if (limit && !(await limit.limit({ key: accountId })).success) throw new ApiError(429, "slow_down", "Too many requests. Wait a minute and try again.");
  const caller = await callerFor(env, accountId, cookies);
  if (!caller) throw new ApiError(401, "no_account", "Finish making your account first.");
  return caller;
}

/** The caller for a signed-in account, or null when the account isn't finished. */
export async function callerFor(env: Env, accountId: string, cookies: string[] = []): Promise<Caller | null> {
  if (!(await accountById(env.DB, accountId))) return null;
  const owner = await personOwner(env.DB, accountId);
  return { accountId, ownerId: owner.id, actor: `account:${accountId}`, cookies };
}

/**
 * Call the API from inside the site (the MCP and the dashboard), as this caller. Answers the JSON;
 * refusals throw ApiError with the same codes and messages API callers get.
 */
export async function apiCall(env: Env, caller: Caller, method: string, path: string, payload?: unknown): Promise<Record<string, unknown>> {
  const raw = payload instanceof Uint8Array;
  const data = raw ? payload : payload === undefined ? undefined : new TextEncoder().encode(JSON.stringify(payload));
  const req = new Request(`${env.SITE_ORIGIN}/api/dev${path}`, {
    method,
    headers: { ...(data ? { "content-length": String(data.byteLength) } : {}), ...(data && !raw ? { "content-type": "application/json" } : {}) },
    body: data,
  });
  const res = await route(req, env, path.split("?")[0]!, caller);
  return (await res.json()) as Record<string, unknown>;
}

export async function route(request: Request, env: Env, path: string, caller: Caller): Promise<Response> {
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

  // One file of a game, by its SHA-256. Storage checks the hash, so a file can't claim to be another.
  const blob = path.match(/^\/files\/([0-9a-f]{64})$/);
  if (blob && method === "PUT") return ok(await putBlob(request, env, blob[1]!));
  const parts = path.match(/^\/files\/([0-9a-f]{64})\/parts(?:\/(\d{1,5}|done))?$/);
  if (parts) return ok(await bigFile(request, env, parts[1]!, parts[2], caller));

  const v = path.match(/^\/games\/([a-z0-9-]+)\/(uploads|versions)(?:\/([a-z0-9]+)(\/publish)?)?$/);
  if (v) return ok(...(await versionRoute(request, env, await ownGame(env, v[1]!, caller), v[2]!, v[3], Boolean(v[4]), caller)));

  const facts = path.match(/^\/games\/([a-z0-9-]+)\/(reports|stats|history)$/);
  if (facts && method === "GET") {
    const game = await ownGame(env, facts[1]!, caller);
    if (facts[2] === "reports") return ok(await reportsFor(env, game, Number(new URL(request.url).searchParams.get("since") ?? 0)));
    if (facts[2] === "stats") return ok(await statsFor(env, game, Number(new URL(request.url).searchParams.get("days") ?? 30)));
    return ok(await historyFor(env, game, caller));
  }

  const t = path.match(/^\/games\/([a-z0-9-]+)\/testers(?:\/([a-z0-9]+))?$/);
  if (t) return ok(...(await testerRoute(request, env, await ownGame(env, t[1]!, caller), t[2], caller)));

  const m = path.match(/^\/games\/([a-z0-9-]+)(?:\/images(?:\/([a-z0-9]+))?)?$/);
  if (!m) throw new ApiError(404, "not_found", "No such API path.");
  const game = await ownGame(env, m[1]!, caller);
  const images = path.includes("/images");

  if (!images && method === "GET") {
    const [imgs, versions, testers] = await Promise.all([imagesForGame(env.DB, game.id), versionsForGame(env.DB, game.id), testerLinks(env.DB, game.id)]);
    return ok({
      game: gameJson(env, game),
      images: imgs.map((i) => imageJson(env, i)),
      versions: versions.map((v) => versionJson(env, game, v)),
      testers: testers.map((l) => testerJson(env, l)),
    });
  }

  if (!images && method === "PATCH") {
    const checked = checkDetails(await readJson(request));
    if ("error" in checked) throw new ApiError(400, "bad_details", checked.error);
    if (game.status === "removed" && checked.change.visibility) throw new ApiError(403, "removed", "This game was taken down, so its visibility can't change.");
    const { multiplayer, ...details } = checked.change;
    const changesMultiplayer = multiplayer !== undefined && multiplayer !== multiplayerOf(game.game_server);
    if (changesMultiplayer && multiplayerOf(game.game_server) === "built-in") {
      throw new ApiError(403, "built_in_server", "This game runs a game server built into Zaisma; ask us to change its multiplayer.");
    }
    const { waiting } = await applyDetails(env.DB, game, { ...details, ...(changesMultiplayer ? { multiplayer } : {}) });
    if (Object.keys(details).length) await audit(env.DB, game.id, "details", Object.keys(details).join(", ") + (waiting ? " (words waiting for review)" : ""), caller.actor);
    if (changesMultiplayer) await audit(env.DB, game.id, "multiplayer", `Multiplayer: ${multiplayer}`, caller.actor);
    const problem = multiplayer === "own" ? await liveServerProblem(env, game) : null;
    return ok({
      game: gameJson(env, (await gameBySlug(env.DB, game.slug))!),
      review: waiting ? "The new title or description shows once it's reviewed." : null,
      ...(problem ? { note: problem } : {}),
    });
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

async function putBlob(request: Request, env: Env, sha256: string): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? -1);
  if (!Number.isSafeInteger(length) || length < 0) throw new ApiError(411, "no_length", "Send the file with a Content-Length header.");
  if (length > FILE_LIMITS.directBytes) throw new ApiError(413, "file_too_big", `Send files over ${FILE_LIMITS.directBytes / 1048576} MB in parts: POST /api/dev/files/<sha256>/parts.`);
  if ((await missingBlobs(env.DB, [sha256])).length === 0) {
    await request.body?.cancel();
    return { sha256, stored: "already" };
  }
  if (!request.body) throw new ApiError(400, "no_body", "Send the file as the request body.");
  try {
    await env.GAMES.put(blobKey(sha256), request.body, { sha256 });
  } catch {
    throw new ApiError(400, "hash_mismatch", "The file doesn't match its SHA-256. Hash the file again and resend it.");
  }
  // Programs and archives aren't allowed in games, whatever they're called.
  const head = await env.GAMES.get(blobKey(sha256), { range: { offset: 0, length: 16 } });
  const bad = head ? forbiddenContent(new Uint8Array(await head.arrayBuffer())) : null;
  if (bad) {
    await env.GAMES.delete(blobKey(sha256));
    throw new ApiError(400, "forbidden_file", `That file looks like ${bad}, which isn't allowed in games.`);
  }
  await addBlob(env.DB, sha256, length);
  return { sha256, stored: "now" };
}

/**
 * Big files, sent in parts: start, send each part, then finish. Storage can't check the hash
 * of a file sent in parts, so the file is kept for this owner's own versions only.
 *
 *   POST /files/:sha256/parts                { "bytes" }                    -> { upload, part_bytes, parts }
 *   PUT  /files/:sha256/parts/:n?upload=…    one part (all but the last are part_bytes long)
 *   POST /files/:sha256/parts/done           { "upload", "parts": [{ "part", "etag" }] }
 */
async function bigFile(request: Request, env: Env, sha256: string, step: string | undefined, caller: Caller): Promise<unknown> {
  const key = ownedBlobKey(caller.ownerId, sha256);
  if (!step && request.method === "POST") {
    const bytes = (await readJson(request)).bytes;
    if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) throw new ApiError(400, "bad_size", 'Send { "bytes": <file size> }.');
    if ((bytes as number) > FILE_LIMITS.fileBytes) throw new ApiError(413, "file_too_big", `Files can be up to ${FILE_LIMITS.fileBytes / 1048576} MB.`);
    if ((await missingBlobs(env.DB, [sha256], caller.ownerId)).length === 0) return { sha256, stored: "already" };
    const upload = await env.GAMES.createMultipartUpload(key);
    return { sha256, upload: upload.uploadId, part_bytes: FILE_LIMITS.partBytes, parts: Math.ceil((bytes as number) / FILE_LIMITS.partBytes) };
  }
  if (step && step !== "done" && request.method === "PUT") {
    const n = Number(step);
    const uploadId = new URL(request.url).searchParams.get("upload") ?? "";
    const length = Number(request.headers.get("content-length") ?? -1);
    if (n < 1 || n > 10_000 || !uploadId) throw new ApiError(400, "bad_part", "Send parts numbered from 1, with ?upload=<the upload ID>.");
    if (!(length > 0 && length <= FILE_LIMITS.partBytes) || !request.body) throw new ApiError(400, "bad_part", `Each part is up to ${FILE_LIMITS.partBytes / 1048576} MB, with a Content-Length header.`);
    try {
      const part = await env.GAMES.resumeMultipartUpload(key, uploadId).uploadPart(n, request.body);
      return { part: part.partNumber, etag: part.etag };
    } catch {
      throw new ApiError(400, "bad_upload", "That upload isn't open any more. Start again.");
    }
  }
  if (step === "done" && request.method === "POST") {
    const body = await readJson(request, 1024 * 1024);
    const list = Array.isArray(body.parts) ? (body.parts as { part?: unknown; etag?: unknown }[]) : [];
    if (typeof body.upload !== "string" || !list.length || !list.every((p) => Number.isInteger(p.part) && typeof p.etag === "string")) {
      throw new ApiError(400, "bad_parts", 'Send { "upload", "parts": [{ "part", "etag" }] }.');
    }
    let object: R2Object;
    try {
      object = await env.GAMES.resumeMultipartUpload(key, body.upload).complete(list.map((p) => ({ partNumber: p.part as number, etag: p.etag as string })));
    } catch {
      throw new ApiError(400, "bad_parts", "Those parts don't make a whole file. Check every part was sent, then try again.");
    }
    if (object.size > FILE_LIMITS.fileBytes) {
      await env.GAMES.delete(key);
      throw new ApiError(413, "file_too_big", `Files can be up to ${FILE_LIMITS.fileBytes / 1048576} MB.`);
    }
    const head = await env.GAMES.get(key, { range: { offset: 0, length: 16 } });
    const bad = head ? forbiddenContent(new Uint8Array(await head.arrayBuffer())) : null;
    if (bad) {
      await env.GAMES.delete(key);
      throw new ApiError(400, "forbidden_file", `That file looks like ${bad}, which isn't allowed in games.`);
    }
    await addOwnedBlob(env.DB, caller.ownerId, sha256, object.size);
    return { sha256, stored: "now", bytes: object.size };
  }
  throw new ApiError(405, "bad_method", `${request.method} isn't used here.`);
}

async function versionRoute(request: Request, env: Env, game: Game, what: string, id: string | undefined, publish: boolean, caller: Caller): Promise<[unknown, number?]> {
  const method = request.method;
  if (game.status === "removed" && method !== "GET") throw new ApiError(403, "removed", "This game was taken down, so it can't get new versions.");

  // Step 1: which of these files do you still need to send?
  if (what === "uploads" && !id && method === "POST") {
    const files = listOrThrow((await readJson(request, 4 * 1024 * 1024)).files);
    const missing = await missingBlobs(env.DB, files.map((f) => f.sha256), caller.ownerId);
    return [{ files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0), missing }];
  }

  // Step 2: make the version once every file is stored. It's scanned, then waits as a draft.
  if (what === "versions" && !id && method === "POST") {
    const body = await readJson(request, 4 * 1024 * 1024);
    const files = listOrThrow(body.files);
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > FILE_LIMITS.notes) throw new ApiError(400, "notes_too_long", `Patch notes can be up to ${FILE_LIMITS.notes} characters.`);
    const found = await locateBlobs(env.DB, files.map((f) => f.sha256), caller.ownerId);
    const missing = files.filter((f) => !found.has(f.sha256)).length;
    if (missing) throw new ApiError(409, "files_missing", `${missing} file(s) haven't been sent yet. Send them to PUT /api/dev/files/<sha256> first.`);
    const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM versions WHERE game_id = ? AND created_at > ?").bind(game.id, Date.now() - 86400_000).first<{ n: number }>();
    if ((today?.n ?? 0) >= FILE_LIMITS.versionsPerDay) throw new ApiError(429, "too_many_versions", `A game can get ${FILE_LIMITS.versionsPerDay} versions a day. Try again tomorrow.`);
    const versionId = newId();
    await env.GAMES.put(manifestKey(versionId), JSON.stringify(toManifest(files, found, caller.ownerId)), { httpMetadata: { contentType: "application/json" } });
    await createVersion(env.DB, {
      id: versionId,
      gameId: game.id,
      prefix: `manifests/${versionId}`,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
      kind: "files",
      notes,
      publishWhenApproved: body.publish === "when-approved",
    });
    await audit(env.DB, game.id, "upload", `Version ${versionId}, ${files.length} files`, caller.actor);
    await env.SCAN_QUEUE.send({ versionId });
    return [{ version: versionJson(env, game, (await versionById(env.DB, versionId))!) }, 201];
  }

  const version = id ? await versionById(env.DB, id) : null;
  if (id && (!version || version.game_id !== game.id)) throw new ApiError(404, "no_version", "This game has no version with that ID.");

  if (version && !publish && method === "GET") return [{ version: versionJson(env, game, version, true) }];

  // Publish later: { "at": "2026-11-01T17:00:00Z" }. It goes live then if it has passed review.
  const body = version && publish && method === "POST" ? await readJson(request).catch(() => ({}) as Record<string, unknown>) : {};
  if (version && publish && method === "POST" && body.at !== undefined) {
    const at = typeof body.at === "number" ? body.at : Date.parse(String(body.at));
    if (!Number.isFinite(at) || at <= Date.now() + 60_000 || at > Date.now() + 90 * 86400_000) {
      throw new ApiError(400, "bad_time", 'Give "at" as a date and time from a few minutes to 90 days from now, like "2026-11-01T17:00:00Z".');
    }
    if (version.scan_status !== "approved" && version.scan_status !== "scanning") throw new ApiError(409, "not_approved", "Only versions that passed review can be published.");
    await env.DB.prepare("UPDATE versions SET publish_at = ? WHERE id = ?").bind(at, version.id).run();
    await audit(env.DB, game.id, "publish-scheduled", `Version ${version.id} at ${new Date(at).toISOString()}`, caller.actor);
    return [{ version: versionJson(env, game, (await versionById(env.DB, version.id))!) }];
  }
  if (version && publish && method === "DELETE") {
    await env.DB.prepare("UPDATE versions SET publish_at = NULL WHERE id = ?").bind(version.id).run();
    await audit(env.DB, game.id, "publish-unscheduled", `Version ${version.id}`, caller.actor);
    return [{ version: versionJson(env, game, (await versionById(env.DB, version.id))!) }];
  }

  // Publish a draft now, or roll back to any version we've kept.
  if (version && publish && method === "POST") {
    if (version.scan_status !== "approved") throw new ApiError(409, "not_approved", version.scan_status === "scanning" ? "This version is still being scanned." : "Only versions that passed review can be published.");
    await publishVersion(env.DB, version);
    await audit(env.DB, game.id, version.published_at ? "rolled-back" : "published", `Version ${version.id}`, caller.actor);
    await pruneVersions(env, game.id);
    const fresh = (await gameBySlug(env.DB, game.slug))!;
    return [{ game: gameJson(env, fresh), version: versionJson(env, fresh, (await versionById(env.DB, version.id))!) }];
  }

  throw new ApiError(405, "bad_method", `${method} isn't used here.`);
}

const DAY = 86400_000;

/**
 * Player reports, counted by reason over the last 90 days. Bug reports (as report triage sorted
 * them) come with what the player wrote and the version they played; `since` (from next_since)
 * gives only the ones that arrived after it, so a developer's AI can check for new ones.
 * Child-safety reports, including ones triage found under another reason, are never shown or
 * counted here: telling the developer could warn someone abusing a child.
 */
async function reportsFor(env: Env, game: Game, since = 0) {
  const from = Date.now() - 90 * DAY;
  const { results: counts } = await env.DB
    .prepare("SELECT reason, status, COUNT(*) AS n FROM reports WHERE game_id = ? AND created_at > ? AND reason != 'child_safety' AND severity > 0 GROUP BY reason, status")
    .bind(game.id, from)
    .all<{ reason: string; status: string; n: number }>();
  const byReason: Record<string, { label: string; open: number; closed: number }> = {};
  for (const c of counts) {
    const r = (byReason[c.reason] ??= { label: REPORT_REASONS[c.reason as ReportReason] ?? c.reason, open: 0, closed: 0 });
    if (c.status === "open") r.open += c.n;
    else r.closed += c.n;
  }
  const { results: bugs } = await env.DB
    .prepare("SELECT id, details, triage, version_id, created_at, bug_at FROM reports WHERE game_id = ? AND bug = 1 AND severity > 0 AND bug_at > ? AND details != '' ORDER BY bug_at DESC LIMIT 50")
    .bind(game.id, Math.max(Number.isFinite(since) ? since : 0, from))
    .all<{ id: string; details: string; triage: string | null; version_id: string | null; created_at: number; bug_at: number }>();
  return {
    days: 90,
    // Open: waiting for us. Closed: we looked and either dismissed it or acted on it.
    reasons: byReason,
    bug_reports: bugs.map((b) => ({
      id: b.id,
      said: b.details,
      summary: b.triage ? (JSON.parse(b.triage) as { summary: string }).summary : null,
      version: b.version_id,
      at: b.created_at,
    })),
    // Pass this as `since` next time to get only bug reports that arrived after this call.
    next_since: Math.max(Number.isFinite(since) ? since : 0, ...bugs.map((b) => b.bug_at)),
  };
}

/** Why the live version's game server can't run yet (none, or too big), or null when it can or nothing is live. */
async function liveServerProblem(env: Env, game: Game): Promise<string | null> {
  const version = game.current_version_id ? await versionById(env.DB, game.current_version_id) : null;
  if (!version) return null;
  const manifest = version.kind === "files" ? ((await (await env.GAMES.get(manifestKey(version.id)))?.json()) as Manifest | null) : null;
  const found = await serverModules(env.GAMES, version, manifest);
  if (!found) return "The live version has no game server (a zaisma-server/ folder with index.js, or zaisma-server.js), so its rooms can't open until a version with one is published.";
  if ("error" in found) return `The live version's game server can't run: ${found.error}`;
  return null;
}

/**
 * Multiplayer room use per day, and for games running their own game server on our rooms, how it's
 * doing: calls, errors, loops we stopped and matches that ended for it, plus its recent errors.
 * Nothing about players. Plays, session length and players coming back arrive with the client SDK.
 */
async function statsFor(env: Env, game: Game, days: number) {
  const n = Number.isInteger(days) && days > 0 ? Math.min(days, 90) : 30;
  const from = new Date(Date.now() - (n - 1) * DAY).toISOString().slice(0, 10);
  const [{ results }, { results: errors }] = await Promise.all([
    env.DB
      .prepare("SELECT day, rooms, player_seconds, messages, server_calls, server_crashes, server_stops, server_broken_rooms FROM room_usage WHERE game_id = ? AND day >= ? ORDER BY day")
      .bind(game.id, from)
      .all<{ day: string; rooms: number; player_seconds: number; messages: number; server_calls: number; server_crashes: number; server_stops: number; server_broken_rooms: number }>(),
    env.DB
      .prepare("SELECT version_id, kind, message, count, first_at, last_at FROM game_server_errors WHERE game_id = ? ORDER BY last_at DESC LIMIT 20")
      .bind(game.id)
      .all<{ version_id: string; kind: "crash" | "stopped"; message: string; count: number; first_at: number; last_at: number }>(),
  ]);
  const ownServer = game.game_server === SANDBOX_GAME_SERVER;
  return {
    days: n,
    multiplayer: results.map((r) => ({
      day: r.day,
      rooms: r.rooms,
      player_minutes: Math.round(r.player_seconds / 60),
      messages: r.messages,
      ...(ownServer ? { game_server: { calls: r.server_calls, crashes: r.server_crashes, stopped: r.server_stops, matches_ended: r.server_broken_rooms } } : {}),
    })),
    ...(ownServer
      ? {
          // Crashes lose one call each and the match carries on. "stopped" is a call that ran on too long
          // (about 2 seconds of CPU, like a loop that never ends): it freezes the match while it runs,
          // and a match whose game server is stopped twice ends.
          game_server_errors: errors.map((e) => ({ kind: e.kind, error: e.message, times: e.count, version: e.version_id, first: e.first_at, last: e.last_at })),
        }
      : {}),
    plays: null,
    note: "Plays, session length and players coming back aren't counted yet; they arrive with the Zaisma SDK.",
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
  owner: null,
};

async function historyFor(env: Env, game: Game, caller: Caller) {
  const { results } = await env.DB
    .prepare("SELECT action, reason, actor, at FROM audit_log WHERE game_id = ? ORDER BY at DESC, id DESC LIMIT 100")
    .bind(game.id)
    .all<{ action: string; reason: string; actor: string; at: number }>();
  const out: { what: string; version: string | null; by: string; at: number }[] = [];
  for (const r of results) {
    const what = HISTORY[r.action];
    if (!what) continue;
    out.push({ what, version: r.reason.match(/[Vv]ersion ([a-z0-9]+)/)?.[1] ?? null, by: r.actor === caller.actor ? "you" : "Zaisma", at: r.at });
  }
  return { history: out };
}

function listOrThrow(files: unknown): UploadFile[] {
  try {
    return checkUploadList(files);
  } catch (err) {
    if (err instanceof UploadError) throw new ApiError(400, "bad_files", err.message);
    throw err;
  }
}

/**
 * Tester links: secret links that open the game's live version whatever its visibility, for guests
 * too. One per group (team, playtesters, a streamer), so one can be turned off without the others.
 */
async function testerRoute(request: Request, env: Env, game: Game, id: string | undefined, caller: Caller): Promise<[unknown, number?]> {
  if (!id && request.method === "GET") return [{ testers: (await testerLinks(env.DB, game.id)).map((l) => testerJson(env, l)) }];
  if (!id && request.method === "POST") {
    if (game.status === "removed") throw new ApiError(403, "removed", "This game was taken down, so it can't get tester links.");
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 60) throw new ApiError(400, "bad_name", "Name the link for who it's for, in 1 to 60 characters, like \"Playtesters\" or \"My team\".");
    const on = await testerLinks(env.DB, game.id);
    if (on.length >= MAX_TESTER_LINKS) throw new ApiError(403, "too_many_testers", `A game can have up to ${MAX_TESTER_LINKS} tester links. Turn one off first.`);
    const link = await addTesterLink(env.DB, game.id, name);
    await audit(env.DB, game.id, "tester-link-added", name, caller.actor);
    return [{ tester: testerJson(env, link) }, 201];
  }
  if (id && request.method === "DELETE") {
    const link = (await testerLinks(env.DB, game.id)).find((l) => l.id === id);
    if (!link || !(await revokeTesterLink(env.DB, game.id, id))) throw new ApiError(404, "no_tester_link", "That tester link isn't on.");
    await audit(env.DB, game.id, "tester-link-removed", link.name, caller.actor);
    return [{ ok: true }];
  }
  throw new ApiError(405, "bad_method", "Tester links take GET, POST and DELETE.");
}

function testerJson(env: Env, l: TesterLink) {
  return { id: l.id, name: l.name, url: `${env.SITE_ORIGIN}/t/${l.token}`, created_at: l.created_at, opened_at: l.opened_at };
}

function previewUrl(env: Env, slug: string, token: string): string {
  return gameUrl(env, `${slug}--${token}`);
}

function versionJson(env: Env, game: Game, v: Version, detail = false) {
  const report: ScanReport | null = v.scan_report ? JSON.parse(v.scan_report) : null;
  return {
    id: v.id,
    files: v.file_count,
    bytes: v.bytes,
    // scanning, held (a person will look), approved or rejected.
    scan: v.scan_status,
    live: v.id === game.current_version_id,
    notes: v.notes,
    preview_url: v.preview_token && v.scan_status === "approved" ? previewUrl(env, game.slug, v.preview_token) : null,
    published_at: v.published_at,
    publish_at: v.publish_at,
    created_at: v.created_at,
    // Why a version was held or rejected. Child-safety findings are never described.
    ...(detail && report
      ? {
          findings: report.childSafety
            ? [{ rule: "review", detail: "A person needs to look at this version." }]
            : report.findings.filter((f) => f.severity !== "info").map((f) => ({ severity: f.severity, rule: f.rule, detail: f.detail, path: f.path ?? null })),
        }
      : {}),
  };
}

/** A game this caller owns. Someone else's game looks the same as no game. */
async function ownGame(env: Env, slug: string, caller: Caller): Promise<Game> {
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.owner_id !== caller.ownerId) throw new ApiError(404, "no_game", `You don't have a game at zaisma.com/g/${slug}.`);
  return game;
}

async function readJson(request: Request, max = 64 * 1024): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new ApiError(413, "too_big", `Send less than ${max / 1024} KB of JSON.`);
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
    // How it's played, or null when not set: { single, local: { min, max, style } | null, online: … }.
    players: readPlayers(g.players),
    // Signed-in players' browser saves are copied to their account.
    cloud_saves: Boolean(g.cloud_saves),
    // Multiplayer on Zaisma rooms: none, relay, own (its zaisma-server.js in a sandbox) or built-in
    // (one of ours, set by Zaisma), and where its open rooms are listed: page, game or off.
    multiplayer: multiplayerOf(g.game_server),
    zaisma_rooms: Boolean(g.game_server),
    room_browsing: g.room_browsing,
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
