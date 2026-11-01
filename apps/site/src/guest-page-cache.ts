import { requestCountryCode } from "@zaisma/core";
import { readCookie } from "./auth.ts";
import { viewerDeviceKind } from "./device-kind.ts";
import type { Env } from "./env.ts";
import { isLocalSite } from "./html.ts";

/**
 * Guest pages from the cache near the player: a page a guest opens on GUEST_CACHED_PAGES is answered from Cloudflare's cache in the data
 * center that serves them (caches.default), kept GUEST_PAGE_CACHE_DURATION_SEC, so a first visit skips the server's part. A signed-in
 * viewer (the zaisma_in cookie) is never answered from it or put in it, and only an answer that's the same for every guest is kept: a 200
 * page with no cookie set and no no-store. A takedown or a game turned private reaches every guest within the minute, with nothing to
 * purge. These pages vary for a guest only by the kind of device (device-kind.ts) and the country (a game blocked in it), which are in the
 * key; a page that comes to vary on
 * anything else adds it to the key here (test/site/first-paint.test.ts renders each twice for a guest and fails when they differ).
 */

export const GUEST_PAGE_CACHE_DURATION_SEC = 60;

/** The pages kept: the home, Browse and its searches, a game's page, a profile, the legal pages and the developers' guides. */
const GUEST_CACHED_PAGES: readonly RegExp[] = [
  /^\/$/,
  /^\/games$/,
  /^\/g\/[a-z0-9-]+$/,
  /^\/@[A-Za-z0-9_]{1,40}$/,
  /^\/legal\/[a-z-]+$/,
  /^\/developers\/(covers|backgrounds)$/,
];

/** The longest address kept, query included: a longer one is answered without the cache. */
const MAXIMUM_ADDRESS_CHARACTER_COUNT = 512;

/** Whether the answer came from the cache, for the tests and the ship check. */
export const PAGE_CACHE_HEADER = "Zaisma-Page-Cache";

function cacheKey(request: Request, url: URL): Request | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!GUEST_CACHED_PAGES.some((page) => page.test(path))) return null;
  if (url.pathname.length + url.search.length > MAXIMUM_ADDRESS_CHARACTER_COUNT) return null;
  // The key is an address of its own on the site: the page, its query, the device kind it was laid out for and the country it was made
  // for (a game a developer blocked there answers 451).
  const key = new URL(`/__guest-page${path}`, url.origin);
  key.search = url.search;
  key.searchParams.set("__device_kind", viewerDeviceKind(request));
  key.searchParams.set("__country", requestCountryCode(request) ?? "");
  return new Request(key.toString(), { method: "GET" });
}

const isKeepable = (response: Response): boolean =>
  response.status === 200 &&
  !response.headers.has("Set-Cookie") &&
  (response.headers.get("Content-Type") ?? "").startsWith("text/html") &&
  !/no-store|private/.test(response.headers.get("Cache-Control") ?? "");

/** The page for a guest from the cache, or made by render and kept there when every guest would get the same. */
export async function withGuestPageCache(request: Request, env: Env, ctx: ExecutionContext, render: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  // The local preview keeps nothing: a page there shows the change just made, and the layout check's steps see what they did.
  const durationSec = Number(env.GUEST_PAGE_CACHE_SECONDS ?? GUEST_PAGE_CACHE_DURATION_SEC);
  const key = isLocalSite(env) || !(durationSec > 0) || readCookie(request, env, "zaisma_in") ? null : cacheKey(request, url);
  if (!key) return render();
  const cache = caches.default;
  const kept = await cache.match(key);
  if (kept) {
    const headers = new Headers(kept.headers);
    headers.delete("Cache-Control");
    headers.set(PAGE_CACHE_HEADER, "hit");
    return new Response(request.method === "HEAD" ? null : kept.body, { status: kept.status, headers });
  }
  const response = await render();
  if (!isKeepable(response)) return response;
  const body = await response.arrayBuffer();
  const keptHeaders = new Headers(response.headers);
  keptHeaders.set("Cache-Control", `public, max-age=${durationSec}`);
  ctx.waitUntil(cache.put(key, new Response(body, { status: response.status, headers: keptHeaders })).catch((error: unknown) => console.error("guest page cache put failed", error)));
  const headers = new Headers(response.headers);
  headers.set(PAGE_CACHE_HEADER, "miss");
  return new Response(request.method === "HEAD" ? null : body, { status: response.status, headers });
}
