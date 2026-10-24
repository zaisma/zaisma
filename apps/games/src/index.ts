import {
  accessPassByKey,
  brotliKeyOf,
  PERFORMANCE_CHECK_LIMITS,
  connectSources,
  contentTypeFor,
  FIRST_DRAW_WATCH,
  FRAME_RATE_BUCKETS,
  GRAPHICS_FAMILY_PATTERNS,
  PLAYER_PERFORMANCE_LIMITS,
  fileKey,
  gameHeaders,
  isCompressibleType,
  isEntryCookieValid,
  isIdOf,
  isServerPath,
  isBlockedInCountry,
  isTesterLinkOn,
  manifestKey,
  ownServerUrlsOf,
  playsOnline,
  readGameAddress,
  readVersionAddress,
  requestCountryCode,
  ROOM_STALE_MS,
  SAVE_LIMIT_BYTES,
  servableGame,
  testerLinkVersion,
  useAccessGrant,
  useEntryGrant,
  type AddressKind,
  type Game,
  type Manifest,
  type StartFile,
  type TesterLink,
  upgradeToHttps,
  withTransportSecurity,
} from "@zaisma/core";
import savesScript from "../../../packages/sdk/saves.js";
import pictureScript from "../../../packages/sdk/picture.js";
import relayScript from "../../../packages/sdk/relay.js";
import warmScript from "../../../packages/sdk/warm.js";
import performanceScript from "../../../packages/sdk/performance.js";
import sdk from "@zaisma/sdk/zaisma.js";
import sdkTypes from "@zaisma/sdk/zaisma.d.ts";
import { serveBackground } from "./background.ts";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  GAME_HOST_MODE: "path" | "subdomain";
  GAME_DOMAIN: string;
  SITE_ORIGIN: string;
  ROOMS_ORIGIN: string;
}

interface Target {
  by: { slug: string } | { hostname: string };
  /** File path inside the game, "" for the root. */
  path: string;
  /** Prefix the game lives under in the URL, for redirects. */
  base: string;
}

/** The part of a file R2 served for a range request, in R2's own words: from offset, length bytes, or the last suffix bytes. */
interface R2RangeFields {
  offset?: number;
  length?: number;
  suffix?: number;
}

/** Work out which game a request is for: path mode, subdomain mode, or a custom domain. */
export function resolveGame(url: URL, env: Pick<Env, "GAME_HOST_MODE" | "GAME_DOMAIN">): Target | null {
  const host = url.hostname.toLowerCase();
  const domain = env.GAME_DOMAIN.toLowerCase();
  const rest = decodePath(url.pathname.slice(1));
  if (rest === null) return null;

  // The bare game domain never serves games: path mode there would put every game on one origin.
  if (env.GAME_HOST_MODE === "subdomain" && host === domain) return null;
  if (env.GAME_HOST_MODE === "subdomain" && domain && host.endsWith(`.${domain}`)) {
    const slug = host.slice(0, -domain.length - 1);
    return slug.includes(".") ? null : { by: { slug }, path: rest, base: "/" };
  }
  if (env.GAME_HOST_MODE === "subdomain" && host !== domain) {
    return { by: { hostname: host }, path: rest, base: "/" };
  }
  // Path mode: /<slug>/<file>
  const slashIndex = rest.indexOf("/");
  const slug = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  if (!slug) return null;
  return { by: { slug }, path: slashIndex === -1 ? "" : rest.slice(slashIndex + 1), base: `/${slug}/` };
}

function decodePath(encodedPath: string): string | null {
  try {
    const path = decodeURIComponent(encodedPath);
    if (path.split("/").some((part) => part === ".." || part === ".") || path.includes("\\") || path.includes("\0")) return null;
    return path;
  } catch {
    return null;
  }
}

function page(httpStatus: number, title: string, text: string, env: Env): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#eee;font:16px system-ui,sans-serif;text-align:center"><div><h1 style="font-size:22px">${title}</h1><p>${text}</p></div>`;
  const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN);
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: httpStatus, headers });
}

/** Bump when our scripts or the injected tags change, so browsers fetch the new ones. */
const SCRIPTS_VERSION_NUMBER = 7;

/** The page that puts an account's save in place, loading the saves script for the version it serves. */
const restorePage = (versionId: string) =>
  `<!doctype html><meta charset="utf-8"><title>Loading</title><body style="margin:0;background:#000"><script src="saves.js?v=${SCRIPTS_VERSION_NUMBER}&version_id=${versionId}"></script>`;

/**
 * A script with its setup handed in as a parameter, so the setup never becomes a global the game's
 * own code can read or change. The scripts read the name with typeof, which a parameter satisfies.
 */
function withSetup(parameterName: string, setup: unknown, script: string): string {
  return `(function (${parameterName}) {\n${script}\n})(${JSON.stringify(setup)});\n`;
}

/**
 * Put our scripts first in <head>, before any game script runs: the relay script must be there before
 * the game makes its first connection to another player, the saves script before the game reads its
 * saves, and the picture script before the game starts drawing.
 */
export function withScripts(page: string, scriptUrls: string[]): string {
  const tag = scriptUrls.map((scriptUrl) => `<script src="${scriptUrl}"></script>`).join("");
  const head = page.match(/<head(\s[^>]*)?>/i);
  if (head) return page.slice(0, head.index! + head[0].length) + tag + page.slice(head.index! + head[0].length);
  const html = page.match(/<html(\s[^>]*)?>/i);
  if (html) return page.slice(0, html.index! + html[0].length) + tag + page.slice(html.index! + html[0].length);
  const doctype = page.match(/^\s*<!doctype[^>]*>/i);
  return doctype ? doctype[0] + tag + page.slice(doctype[0].length) : tag + page;
}

/** The access cookie for one of a game's fixed addresses, named for it, since path mode puts every game on one origin. */
const accessCookieName = (slug: string, addressKind: AddressKind) => `__Host-zaisma_access_${slug}--${addressKind}`;
/** The entry cookie for an accounts-only game's public address. Slugs never contain "--", so it's never a tester or preview cookie. */
const entryCookieName = (slug: string) => `__Host-zaisma_access_${slug}`;

/** The cookie a browser that didn't keep it once won't keep the next time either: older Safari, inside a page. */
const cookieNotKept = (env: Env) =>
  page(403, "This browser can't open this game", "It doesn't keep the pass Zaisma gives inside a page. Update the browser (Safari 26.2 or newer), or use another browser.", env);

/** Where to go inside the game once in: a path and query under the game, never another site. */
function readThen(then: string | null): string {
  return then && then.length <= 2000 && /^[A-Za-z0-9_?.~-]/.test(then) && !/[\s\\]/.test(then) ? then : "";
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [cookieName, ...rest] = part.trim().split("=");
    if (cookieName === name) return rest.join("=");
  }
  return null;
}

/**
 * A tester or preview address: swap the zaisma.com page's one-use grant for the access cookie, or check
 * the cookie this browser holds. Answers what it opens, or the page to show instead.
 */
async function openThroughLink(request: Request, url: URL, env: Env, target: Target, gameId: string, addressKind: AddressKind): Promise<Response | { tester_id: string | null; version_id: string | null }> {
  const slug = (target.by as { slug: string }).slug.replace(/--(tester|preview)$/, "");
  const cookieName = accessCookieName(slug, addressKind);
  const then = readThen(url.searchParams.get("then"));
  if (target.path === "_zaisma/enter") {
    const granted = await useAccessGrant(env.DB, { grantKey: url.searchParams.get("grant") ?? "", gameId, addressKind });
    if (!granted) return page(404, "This link doesn't work here", "It was already opened, or opened too long ago. Open the link you were given again.", env);
    const maximumAgeSec = Math.max(1, Math.floor((granted.expiresAtMs - Date.now()) / 1000));
    const headers = new Headers({ Location: `${target.base}_zaisma/entered${then ? `?then=${encodeURIComponent(then)}` : ""}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.set("Set-Cookie", `${cookieName}=${granted.accessKey}; Path=/; Max-Age=${maximumAgeSec}; Secure; HttpOnly; SameSite=None; Partitioned`);
    return new Response(null, { status: 302, headers });
  }
  const accessKey = cookieValue(request, cookieName);
  const pass = accessKey ? await accessPassByKey(env.DB, { accessKey, gameId, addressKind }) : null;
  if (target.path === "_zaisma/entered") {
    // The cookie was just set: a browser that didn't keep it won't keep it on the next try either.
    if (!pass) return cookieNotKept(env);
    return new Response(null, { status: 302, headers: { Location: `${target.base}${then}`, "Cache-Control": "no-store" } });
  }
  if (!pass) return page(404, "Open this game through its link", "Tester links and previews open from zaisma.com. Open the link you were given again.", env);
  return pass;
}

/** Where a version's files are, as the request handler serves them. */
type ServedVersion = { id: string; kind: "zip" | "files"; r2_prefix: string };

/** The cookie that carries a room's version to the rest of its page's files, named for the game, since path mode puts every game on one origin. */
const roomVersionCookieName = (slug: string) => `__Host-zaisma_room_version_${slug}`;
const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/**
 * A player always plays the version their room runs: on a game's public address, a page opened into a room
 * (?room=CODE) whose sandboxed game server runs another version than the live one gets that version, and the
 * cookie carries it to the page's other files. The version comes only from the room's row, never from what the
 * browser names, and only while it's one the game could roll back to (approved, published, not held, still
 * kept), so a takedown or hold applies at once; the cookie is checked against the room on every request.
 * Answers the version to serve (null: the live one) and the Set-Cookie to send, if any.
 */
async function roomVersionFor(request: Request, url: URL, env: Env, target: Target, game: Game): Promise<{ version: ServedVersion | null; setCookie: string | null }> {
  const cookieName = roomVersionCookieName(game.slug);
  const cookie = cookieValue(request, cookieName);
  const clear = cookie === null ? null : `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None; Partitioned`;
  const pinned = readVersionAddress(target.path);
  const requestedPath = pinned ? pinned.path : target.path;
  const isPage = requestedPath === "" || requestedPath.endsWith("/") || requestedPath.endsWith(".html");
  const linkedCode = url.searchParams.get("room")?.toUpperCase() ?? "";
  let roomCode: string;
  let cookieVersionId: string | null = null;
  if (isPage && ROOM_CODE.test(linkedCode)) roomCode = linkedCode;
  // A page opened at the game's own address outside a room plays the live version.
  else if ((isPage && !pinned) || cookie === null) return { version: null, setCookie: clear };
  else {
    const dotIndex = cookie.lastIndexOf(".");
    cookieVersionId = cookie.slice(0, dotIndex);
    roomCode = cookie.slice(dotIndex + 1);
    if (dotIndex < 1 || !ROOM_CODE.test(roomCode)) return { version: null, setCookie: clear };
  }
  const roomVersion = await env.DB.prepare(
    `SELECT versions.id, versions.kind, versions.r2_prefix FROM live_rooms JOIN versions ON versions.id = live_rooms.version_id AND versions.game_id = live_rooms.game_id
     WHERE live_rooms.game_id = ? AND live_rooms.room_code = ? AND live_rooms.updated_at_ms > ? AND versions.id != ?
       AND versions.scan_status = 'approved' AND versions.published_at_ms IS NOT NULL AND versions.report_held_at_ms IS NULL`,
  )
    .bind(game.id, roomCode, Date.now() - ROOM_STALE_MS, game.live_version_id)
    .first<ServedVersion>();
  if (!roomVersion || (cookieVersionId !== null && cookieVersionId !== roomVersion.id)) return { version: null, setCookie: clear };
  const roomVersionCookie = `${roomVersion.id}.${roomCode}`;
  return { version: roomVersion, setCookie: cookie === roomVersionCookie ? null : `${cookieName}=${roomVersionCookie}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned` };
}

/**
 * An accounts-only game's public address (account_requirement whole_game) serves only a browser that came
 * through its zaisma.com page, which checked the account and its age and handed the frame a grant
 * (game-access.ts, "The game entry"): swap the grant for the entry cookie, or check the cookie this browser
 * holds. Null when it may go on to the game's files; otherwise the page to show.
 */
async function enterAccountsOnly(request: Request, url: URL, env: Env, target: Target, game: Game): Promise<Response | null> {
  const cookieName = entryCookieName(game.slug);
  const then = readThen(url.searchParams.get("then"));
  if (target.path === "_zaisma/enter") {
    const entered = await useEntryGrant(game, url.searchParams.get("grant") ?? "");
    if (!entered) return page(404, "Open this game on zaisma.com", "This game needs a Zaisma account. Open it from its page on zaisma.com.", env);
    const maximumAgeSec = Math.max(1, Math.floor((entered.expiresAtMs - Date.now()) / 1000));
    const headers = new Headers({ Location: `${target.base}_zaisma/entered${then ? `?then=${encodeURIComponent(then)}` : ""}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.set("Set-Cookie", `${cookieName}=${entered.cookieValue}; Path=/; Max-Age=${maximumAgeSec}; Secure; HttpOnly; SameSite=None; Partitioned`);
    return new Response(null, { status: 302, headers });
  }
  const cookie = cookieValue(request, cookieName);
  const isEntered = cookie ? await isEntryCookieValid(game, cookie) : false;
  if (target.path === "_zaisma/entered") {
    if (!isEntered) return cookieNotKept(env);
    return new Response(null, { status: 302, headers: { Location: `${target.base}${then}`, "Cache-Control": "no-store" } });
  }
  if (!isEntered) return page(404, "Open this game on zaisma.com", "This game needs a Zaisma account. Open it from its page on zaisma.com.", env);
  return null;
}

/** The game files a version's run in Chrome downloaded before its first frame, in request order; [] before it ran. */
async function startFilesOf(env: Env, versionId: string): Promise<StartFile[]> {
  const row = await env.DB.prepare("SELECT start_files FROM performance_checks WHERE version_id = ?").bind(versionId).first<{ start_files: string | null }>();
  return row?.start_files ? (JSON.parse(row.start_files) as StartFile[]) : [];
}

/** A start file's address under the game, as its page asks for it. */
const startFileUrl = (base: string, file: StartFile) => `${base}${encodeURI(file.path)}`;

/**
 * First files preloaded: the Link header for a version's page, naming the files its run in Chrome needed before
 * the first frame that the page doesn't name itself (the browser finds those on its own), up to 20, so an
 * engine's loader doesn't fetch them one after another. crossorigin exactly where the request was CORS, or the
 * preload wouldn't match it and the file would download twice.
 */
export function preloadLinkHeader(page: string, base: string, startFiles: StartFile[]): string | null {
  const named = new Set<string>();
  for (const match of page.matchAll(/\b(?:src|href)\s*=\s*["']?([^"'\s>]+)/gi)) {
    const reference = match[1]!.replace(/^\.\//, "").split(/[?#]/)[0]!;
    try {
      named.add(decodeURIComponent(reference));
    } catch {
      named.add(reference);
    }
  }
  const links = startFiles
    .filter((file) => !named.has(file.path.split("?")[0]!))
    .slice(0, PERFORMANCE_CHECK_LIMITS.maximumPreloadFileCount)
    .map((file) => `<${startFileUrl(base, file)}>; rel=preload; as=${file.destination}${file.is_cors_request ? "; crossorigin" : ""}`);
  return links.length ? links.join(", ") : null;
}

/** The warm-up page: nothing to show, just its script, on the game's own address so it fills this game's cache. */
const WARM_PAGE = `<!doctype html><meta charset="utf-8"><title>Loading</title><script src="warm.js?v=1"></script>`;

/** The host names of a game's own servers, where its own relay may be. */
const ownHostnames = (ownServerUrls: string[]): string[] => ownServerUrls.map((origin) => new URL(origin).hostname);

// Manifests never change once written, so each Worker keeps the latest few in memory.
const manifests = new Map<string, Manifest>();

async function manifestFor(env: Env, versionId: string): Promise<Manifest | null> {
  const cached = manifests.get(versionId);
  if (cached) return cached;
  const object = await env.GAMES.get(manifestKey(versionId));
  if (!object) return null;
  const manifest = (await object.json()) as Manifest;
  if (manifests.size >= 20) manifests.delete(manifests.keys().next().value!);
  manifests.set(versionId, manifest);
  return manifest;
}

/** Whether the browser takes Brotli (Accept-Encoding has br, not turned off with q=0). */
function acceptsBrotli(request: Request): boolean {
  return (request.headers.get("accept-encoding") ?? "").split(",").some((part) => {
    const [coding, ...parameters] = part.trim().toLowerCase().split(";");
    return coding!.trim() === "br" && !parameters.some((parameter) => /^\s*q=0(\.0*)?\s*$/.test(parameter));
  });
}

/** The ETags in If-None-Match, without quotes' W/ marks. */
function ifNoneMatchTags(request: Request): string[] {
  return (request.headers.get("if-none-match") ?? "").split(",").map((tag) => tag.trim().replace(/^W\//, "")).filter(Boolean);
}

/** How long a player's browser keeps a file at its version's own address (readVersionAddress): for good. */
const VERSION_FILE_CACHE_DURATION_SEC = 365 * 24 * 3600;

/** How long the cache near players keeps a file: for good under its own key, an hour when it stands in for a copy not made yet. */
const CACHED_FILE_DURATION_SEC = 30 * 24 * 3600;
const CACHED_STAND_IN_DURATION_SEC = 3600;
/** The Cache API keeps responses up to 512 MB. */
const MAXIMUM_CACHED_SIZE_BYTES = 512 * 1024 * 1024;
/** Marks a cached copy's encoding. The cache keeps the copy's bytes as they are, under no Content-Encoding, so nothing decodes them on the way. */
const CACHED_ENCODING_HEADER = "X-Zaisma-Encoding";

/**
 * A stored file of a file-by-file version (docs/DECISIONS.md, "Game files reach players small and from nearby,
 * exactly as uploaded"): its Brotli copy when the browser takes it and there is one, from the cache near the
 * player when it's there. The ETag is the file's fingerprint, so a returning player's browser checks it and
 * downloads only what changed, without a storage read. Called only once every access check has passed: the
 * cache holds no access.
 */
async function serveStoredFile(request: Request, env: Env, ctx: ExecutionContext, url: URL, path: string, storageKey: string, sha256: string, headers: Headers, cacheControl: string): Promise<Response> {
  const isHead = request.method === "HEAD";
  const etagOf = (isCopy: boolean) => `"${sha256}${isCopy ? "-br" : ""}"`;
  headers.set("Cache-Control", cacheControl);
  if (isCompressibleType(path)) headers.set("Vary", "Accept-Encoding");
  const matched = ifNoneMatchTags(request).find((tag) => tag === etagOf(false) || tag === etagOf(true));
  if (matched) {
    headers.set("ETag", matched);
    return new Response(null, { status: 304, headers });
  }

  // Part of a file is read from the original, as it's stored.
  if (request.headers.has("range")) {
    const object = await env.GAMES.get(storageKey, { range: request.headers });
    if (!object) return page(404, "File not found", "This game is missing a file.", env);
    headers.set("ETag", etagOf(false));
    headers.set("Accept-Ranges", "bytes");
    let httpStatus = 200;
    if (object.range) {
      const range = object.range as R2RangeFields;
      const startByte = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
      const lengthBytes = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - startByte);
      headers.set("Content-Range", `bytes ${startByte}-${startByte + lengthBytes - 1}/${object.size}`);
      httpStatus = 206;
    }
    return new Response(isHead ? null : object.body, { status: httpStatus, headers });
  }

  const wantsBrotli = acceptsBrotli(request) && isCompressibleType(path);
  const answer = (body: ReadableStream | null, isCopy: boolean, sizeBytes: number) => {
    headers.set("ETag", etagOf(isCopy));
    headers.set("Content-Length", String(sizeBytes));
    if (!isCopy) {
      headers.set("Accept-Ranges", "bytes");
      return new Response(isHead ? null : body, { headers });
    }
    headers.set("Content-Encoding", "br");
    // Sent as it is: the runtime and Cloudflare don't compress it again.
    return new Response(isHead ? null : body, { headers, encodeBody: "manual" });
  };

  // The game domain's own host, so the cache is the zone's; in path mode (the local preview), this address's.
  const cacheOrigin = env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN ? `https://${env.GAME_DOMAIN}` : url.origin;
  const cacheKey = `${cacheOrigin}/_zaisma/files/${storageKey}${wantsBrotli ? ".br" : ""}`;
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return answer(hit.body, hit.headers.get(CACHED_ENCODING_HEADER) === "br", Number(hit.headers.get("content-length") ?? 0));

  const read = (key: string) => (isHead ? env.GAMES.head(key) : env.GAMES.get(key));
  const copy = wantsBrotli ? await read(brotliKeyOf(storageKey)) : null;
  const object = copy ?? (await read(storageKey));
  if (!object) return page(404, "File not found", "This game is missing a file.", env);
  const isCopy = copy !== null;
  // Kept for the next player near here from a read of its own, so a slow player's download never holds the file in memory.
  if (!isHead && object.size <= MAXIMUM_CACHED_SIZE_BYTES) {
    ctx.waitUntil(
      (async () => {
        const stored = await env.GAMES.get(object.key);
        if (!stored) return;
        const storedHeaders = new Headers({ "Content-Type": "application/octet-stream", "Content-Length": String(stored.size), "Cache-Control": `public, max-age=${isCopy || !wantsBrotli ? CACHED_FILE_DURATION_SEC : CACHED_STAND_IN_DURATION_SEC}` });
        if (isCopy) storedHeaders.set(CACHED_ENCODING_HEADER, "br");
        await cache.put(cacheKey, new Response(stored.body, { headers: storedHeaders }));
      })().catch((error) => console.error("caching a game file failed", storageKey, error)),
    );
  }
  return answer(isHead ? null : (object as R2ObjectBody).body, isCopy, object.size);
}

/** Plain http on a game's own address (production only: path mode, tests and the local preview stay as they are). */
export function isPlainHttpGameAddress(url: URL, env: Pick<Env, "GAME_HOST_MODE" | "GAME_DOMAIN" | "SITE_ORIGIN">): boolean {
  if (url.protocol !== "http:" || !env.SITE_ORIGIN.startsWith("https://") || env.GAME_HOST_MODE !== "subdomain" || !env.GAME_DOMAIN) return false;
  const hostname = url.hostname.toLowerCase();
  const gameDomain = env.GAME_DOMAIN.toLowerCase();
  return hostname === gameDomain || hostname.endsWith(`.${gameDomain}`);
}

async function serve(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  if (url.pathname === "/" && env.GAME_HOST_MODE === "path") return Response.redirect(env.SITE_ORIGIN, 302);
  if (env.GAME_HOST_MODE === "subdomain" && url.hostname.toLowerCase() === env.GAME_DOMAIN.toLowerCase()) {
    return Response.redirect(env.SITE_ORIGIN, 302);
  }
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });

  const target = resolveGame(url, env);
  if (!target) return page(404, "Game not found", "Check the link and try again.", env);
  // A game's tester links and previews open at its fixed addresses, <slug>--tester and <slug>--preview.
  const address = "slug" in target.by ? readGameAddress(target.by.slug) : null;
  const by = address ? { slug: address.slug } : target.by;

  // Read status on every request so a takedown applies straight away.
  const game = await servableGame(env.DB, by);
  if (game?.review_status === "removed") return page(410, "This game was removed", "It broke Zaisma's rules or was taken down on request.", env);
  if (game?.review_status === "held") return page(404, "This game is being reviewed", "Try again later.", env);
  if (!game) return page(404, "Game not found", "Check the link and try again.", env);
  // Blocked in the player's country on a notice under its law; a preview link stays open, so a developer there can check a fix.
  if (address?.addressKind !== "preview" && isBlockedInCountry(game, requestCountryCode(request))) {
    return page(451, "This game isn't available in your country", "A legal notice under your country's law blocks it here. It's still available everywhere else.", env);
  }
  // Its background, which Zaisma's pages frame behind their glass: on the game's own address, never a tester or preview one.
  if (!address && (target.path.startsWith("_zaisma/background") || target.path === "_zaisma/shader-preview")) {
    const background = await serveBackground(request, env, game, target.path, target.base);
    if (background) return background;
  }

  let version: ServedVersion;
  let tester: TesterLink | null = null;
  // The version of the room the player's page opened into, when it isn't the live one (roomVersionFor).
  let isRoomVersion = false;
  let roomVersionCookie: string | null = null;
  // An accounts-only game's public address serves only browsers that came in through its page.
  const isAccountsOnly = !address && game.account_requirement === "whole_game";
  if (address) {
    const opened = await openThroughLink(request, url, env, target, game.id, address.addressKind);
    if (opened instanceof Response) return gated(opened);
    if (address.addressKind === "tester") {
      tester = await env.DB.prepare("SELECT * FROM tester_links WHERE id = ? AND game_id = ?").bind(opened.tester_id, game.id).first<TesterLink>();
      if (!tester || !isTesterLinkOn(tester)) return gated(page(404, "This link doesn't work", "The developer may have turned it off, or it ended. Ask them for a fresh link.", env));
    }
    const opens = tester
      ? await testerLinkVersion(env.DB, game, tester)
      : await env.DB.prepare("SELECT * FROM versions WHERE id = ? AND game_id = ? AND scan_status = 'approved' AND preview_link_key IS NOT NULL").bind(opened.version_id, game.id).first<{ id: string; kind: "zip" | "files"; r2_prefix: string }>();
    if (!opens) {
      return gated(tester ? page(404, "Nothing to play yet", "The version this link opens isn't there: the developer hasn't published one yet, or it was deleted.", env) : page(404, "This preview ended", "Its version was deleted, or the developer turned its preview links off.", env));
    }
    version = opens;
  } else {
    // Drafts and private games open only through preview and tester links.
    if (game.review_status !== "live" || !game.r2_prefix || !game.live_version_id) return page(404, "Game not found", "Check the link and try again.", env);
    if (game.visibility === "draft" || game.visibility === "private") return page(404, "Game not found", "Check the link and try again.", env);
    if (isAccountsOnly) {
      const refused = await enterAccountsOnly(request, url, env, target, game);
      if (refused) return gated(refused);
    }
    version = { id: game.live_version_id, kind: game.version_kind ?? "zip", r2_prefix: game.r2_prefix };
    if (!isAccountsOnly) {
      const room = await roomVersionFor(request, url, env, target, game);
      roomVersionCookie = room.setCookie;
      if (room.version) {
        version = room.version;
        isRoomVersion = true;
      }
    }
  }
  // Previews and tester links keep their saves in their own browser storage, never the player's account.
  const cloudSavesEnabled = Boolean(game.cloud_saves_enabled) && !address;
  // How the game runs for players is measured only at its public address, where plays count, unless the developer turned it off.
  const performanceMeasuringEnabled = Boolean(game.performance_measuring_enabled) && !address;
  /** What only this browser's access or entry cookie opens: no other game loads it as its own, and no shared cache keeps it. */
  function gated(response: Response): Response {
    if (!address && !isAccountsOnly && !isRoomVersion) return response;
    const out = new Response(response.body, response);
    out.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    out.headers.set("X-Robots-Tag", "noindex");
    const cacheControl = out.headers.get("Cache-Control");
    out.headers.set("Cache-Control", !cacheControl || cacheControl === "no-store" ? "no-store" : `private, ${cacheControl.replace(/^public,\s*/, "")}`);
    return out;
  }

  const serveFile = async (): Promise<Response> => {
    // /<slug> -> /<slug>/ so the game's relative links work.
    if (env.GAME_HOST_MODE === "path" && !url.pathname.endsWith("/") && target.path === "") {
      return Response.redirect(`${url.origin}${target.base}${url.search}`, 301);
    }

    // Under a version's own address: the path inside it, and that version's files. A version this address doesn't
    // serve now goes back to the game's own address: pages always, and files when the address may not open it
    // (tester and preview links open only their version; the public address also the game's earlier releases).
    const pinned = readVersionAddress(target.path);
    const filePath = pinned ? pinned.path : target.path;
    // The path as the browser sent it (still encoded), for redirects.
    const sentPath = url.pathname.slice(target.base.length + (pinned ? target.path.length - pinned.path.length : 0));
    const backToGameAddress = () => new Response(null, { status: 302, headers: { Location: `${target.base}${sentPath}${url.search}`, "Cache-Control": "no-store" } });
    let servedVersion = version;
    if (pinned && pinned.versionId !== version.id) {
      if (address || filePath === "" || filePath.endsWith("/") || filePath.endsWith(".html")) return backToGameAddress();
      const earlier = await env.DB.prepare("SELECT id, kind, r2_prefix FROM versions WHERE id = ? AND game_id = ? AND scan_status = 'approved' AND published_at_ms IS NOT NULL AND report_held_at_ms IS NULL")
        .bind(pinned.versionId, game.id)
        .first<ServedVersion>();
      if (!earlier) return backToGameAddress();
      servedVersion = earlier;
    }

    const ownServerUrls = ownServerUrlsOf(game);
    const connectOrigins = connectSources(env.ROOMS_ORIGIN, ownServerUrls);
    // Where this address's version lives: what its start files are preloaded and warmed up from, so they match the page's own requests.
    const versionBase = `${target.base}_zaisma/versions/${version.id}/`;

    // The SDK, served from the game's own site so its sandbox allows it, set up for this game.
    if (filePath === "_zaisma/v1.js") {
      // Room links from a tester link go back through it, since a private game has no public page, and rooms
      // let its players go when it's turned off.
      // version: the one this tab runs, so the game page can offer a newer one published "now".
      const config = { rooms: env.ROOMS_ORIGIN, game: game.slug, site: env.SITE_ORIGIN, version: version.id, purchaseDelivery: game.purchase_delivery, ...(tester ? { page: `/t/${tester.token}`, tester: tester.id } : {}) };
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      // Checked on every load, like the game's own HTML, so the version it names is the one the tab gets.
      headers.set("Cache-Control", "no-cache");
      return new Response(request.method === "HEAD" ? null : withSetup("__ZAISMA__", config, sdk), { headers });
    }
    // The SDK's types beside it: its reference, for the developer's editor and AI.
    if (filePath === "_zaisma/v1.d.ts") {
      const headers = gameHeaders("text/plain; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : sdkTypes, { headers });
    }

    // Players never connect straight to each other: every game page sends its WebRTC connections through
    // Zaisma's relay, keeping a relay among the game's own servers. Games that play online fetch its servers while they load.
    if (filePath === "_zaisma/relay.js") {
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "public, max-age=300");
      const relay = { rooms: env.ROOMS_ORIGIN, game: game.slug, site: env.SITE_ORIGIN, ownRelayHosts: ownHostnames(ownServerUrls), fetchEarly: playsOnline(game) };
      return new Response(request.method === "HEAD" ? null : withSetup("__ZAISMA_RELAY__", relay, relayScript), { headers });
    }

    // Report pictures: every game page can hand the Zaisma page a picture of the game when a player reports it.
    if (filePath === "_zaisma/picture.js") {
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : withSetup("__ZAISMA_PICTURE__", { site: env.SITE_ORIGIN }, pictureScript), { headers });
    }

    // How the game runs for its players: load time, frame rate, stutter and crashes, sent to the Zaisma game page as totals.
    if (performanceMeasuringEnabled && filePath === "_zaisma/performance.js") {
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "public, max-age=300");
      const setup = { site: env.SITE_ORIGIN, limits: PLAYER_PERFORMANCE_LIMITS, frameRateBuckets: FRAME_RATE_BUCKETS, graphicsFamilyPatterns: GRAPHICS_FAMILY_PATTERNS };
      return new Response(request.method === "HEAD" ? null : withSetup("__ZAISMA_PERFORMANCE__", setup, `${FIRST_DRAW_WATCH}\n${performanceScript}`), { headers });
    }

    // Cloud saves: the script that hands the game's browser save to the Zaisma game page,
    // and the page that puts an account's save in place before the game starts.
    if (cloudSavesEnabled && filePath === "_zaisma/saves.js") {
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "public, max-age=300");
      // version_id: the version the page was served from, a label each save carries. The script's worker starts from this same URL.
      const versionIdGiven = url.searchParams.get("version_id");
      const setup = { site: env.SITE_ORIGIN, saveLimitBytes: SAVE_LIMIT_BYTES, versionId: isIdOf("version", versionIdGiven) ? versionIdGiven : null };
      return new Response(request.method === "HEAD" ? null : withSetup("__ZAISMA_SAVES__", setup, savesScript), { headers });
    }
    if (cloudSavesEnabled && filePath === "_zaisma/restore") {
      const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "no-cache");
      return new Response(request.method === "HEAD" ? null : restorePage(version.id), { headers });
    }

    // Game files start before Play: the warm-up page, its script and the live version's start files, only on the
    // game's public address. Tester, preview and accounts-only games need a cookie before Play, so they don't warm up.
    if (filePath === "_zaisma/warm" || filePath === "_zaisma/warm.json" || filePath === "_zaisma/warm.js") {
      if (address || isAccountsOnly) return page(404, "File not found", "This game is missing a file.", env);
      if (filePath === "_zaisma/warm.js") {
        const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
        headers.set("Cache-Control", "public, max-age=300");
        return new Response(request.method === "HEAD" ? null : warmScript, { headers });
      }
      if (filePath === "_zaisma/warm") {
        const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN, connectOrigins);
        headers.set("Cache-Control", "no-cache");
        return new Response(request.method === "HEAD" ? null : WARM_PAGE, { headers });
      }
      const urls: string[] = [];
      let warmSizeBytes = 0;
      for (const file of await startFilesOf(env, version.id)) {
        warmSizeBytes += file.downloaded_size_bytes;
        if (warmSizeBytes > PERFORMANCE_CHECK_LIMITS.maximumWarmUpSizeBytes) break;
        urls.push(startFileUrl(versionBase, file));
      }
      const headers = gameHeaders("application/json", env.SITE_ORIGIN, connectOrigins);
      headers.set("Cache-Control", "no-cache");
      return new Response(request.method === "HEAD" ? null : JSON.stringify(urls), { headers });
    }

    const path = filePath === "" || filePath.endsWith("/") ? `${filePath}index.html` : filePath;
    // A game's own game server runs in our rooms' sandbox; players never get its code.
    if (isServerPath(path)) return page(404, "File not found", "This game is missing a file.", env);
    const isHtml = path.endsWith(".html");
    // A page at the game's own address opens at its version's address, so what it loads is kept for good.
    if (isHtml && !pinned) return new Response(null, { status: 302, headers: { Location: `${versionBase}${sentPath}${url.search}`, "Cache-Control": "no-store" } });
    const isInjected = isHtml;
    const fileCacheControl = pinned ? `public, max-age=${VERSION_FILE_CACHE_DURATION_SEC}, immutable` : "no-cache";
    const manifest = servedVersion.kind === "files" ? await manifestFor(env, servedVersion.id) : null;
    const key = fileKey(servedVersion, manifest, path);
    // Every other stored file: by its fingerprint, compressed and from the cache near the player.
    if (manifest && !isHtml) {
      const file = manifest.files[path];
      if (!key || !file) return servedVersion === version ? page(404, "File not found", "This game is missing a file.", env) : backToGameAddress();
      return serveStoredFile(request, env, ctx, url, path, key, file.sha256, gameHeaders(contentTypeFor(path), env.SITE_ORIGIN, connectOrigins), fileCacheControl);
    }
    // Pages get our scripts on the way out, so they skip ranges and R2's own ETag checks.
    const object = key ? await env.GAMES.get(key, isInjected ? {} : { range: request.headers, onlyIf: request.headers }) : null;
    if (!object) return servedVersion === version ? page(404, "File not found", "This game is missing a file.", env) : backToGameAddress();

    const headers = gameHeaders(contentTypeFor(path), env.SITE_ORIGIN, connectOrigins);
    headers.set("ETag", object.httpEtag);
    // HTML is re-checked so takedowns and updates show up. Other files of a zip version are kept for good at
    // their version's address; at the game's own address they're the same across versions, so they're only
    // cached briefly there: an update reaches players within a minute.
    headers.set("Cache-Control", isHtml ? "no-cache" : pinned ? fileCacheControl : "public, max-age=60");
    headers.set("Accept-Ranges", "bytes");

    if (isInjected && "body" in object && object.body) {
      headers.delete("Accept-Ranges");
      // The version's own page preloads what its run in Chrome needed first; one cached before the run finished is fetched again.
      const startFiles = path === "index.html" ? await startFilesOf(env, servedVersion.id) : [];
      // The version too: two versions can share an identical page, but their saves script is told a different one.
      headers.set("ETag", `W/"${object.etag}-${servedVersion.id}-z${SCRIPTS_VERSION_NUMBER}${cloudSavesEnabled ? "s" : ""}${performanceMeasuringEnabled ? "m" : ""}${startFiles.length ? "p" : ""}"`);
      if (request.headers.get("if-none-match") === headers.get("ETag")) return new Response(null, { status: 304, headers });
      const scripts = [`${target.base}_zaisma/relay.js?v=${SCRIPTS_VERSION_NUMBER}`, ...(cloudSavesEnabled ? [`${target.base}_zaisma/saves.js?v=${SCRIPTS_VERSION_NUMBER}&version_id=${servedVersion.id}`] : []), `${target.base}_zaisma/picture.js?v=${SCRIPTS_VERSION_NUMBER}`, ...(performanceMeasuringEnabled ? [`${target.base}_zaisma/performance.js?v=${SCRIPTS_VERSION_NUMBER}`] : [])];
      const text = await object.text();
      const preloads = preloadLinkHeader(text, `${target.base}_zaisma/versions/${servedVersion.id}/`, startFiles);
      if (preloads) headers.set("Link", preloads);
      const page = withScripts(text, scripts);
      return new Response(request.method === "HEAD" ? null : page, { headers });
    }

    if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
    let httpStatus = 200;
    if (object.range && request.headers.has("range")) {
      const range = object.range as R2RangeFields;
      const startByte = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
      const lengthBytes = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - startByte);
      headers.set("Content-Range", `bytes ${startByte}-${startByte + lengthBytes - 1}/${object.size}`);
      httpStatus = 206;
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status: httpStatus, headers });
  };
  const response = gated(await serveFile());
  if (!roomVersionCookie) return response;
  const out = new Response(response.body, response);
  out.headers.append("Set-Cookie", roomVersionCookie);
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (isPlainHttpGameAddress(url, env)) return upgradeToHttps(url);
    return withTransportSecurity(url, await serve(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
