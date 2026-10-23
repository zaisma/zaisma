/**
 * The servers a game may connect to besides its own site: Zaisma rooms and the game's own servers (set by
 * its developer, own_server_urls), each over both https and wss.
 */
export function connectSources(roomsOrigin: string | null, ownServerUrls: readonly string[]): string[] {
  const out = new Set<string>();
  for (const origin of [roomsOrigin ?? "", ...ownServerUrls]) {
    if (!origin) continue;
    // Local dev runs rooms over plain http/ws; everything real is https/wss.
    const secure = !/^(http|ws):/.test(origin);
    const host = origin.replace(/^[a-z]+:\/\//, "");
    out.add(`${secure ? "https" : "http"}://${host}`);
    out.add(`${secure ? "wss" : "ws"}://${host}`);
  }
  return [...out];
}

/**
 * Headers for every file served from the game domain. Games are untrusted:
 * they run on their own site, can't load anything from outside it, can only
 * connect to Zaisma rooms and their own servers, and can only be framed by Zaisma.
 * Document-Isolation-Policy makes each game's document cross-origin isolated in its own frame and process in
 * Chrome and Edge 137+, so builds that need threads (SharedArrayBuffer) run there; other browsers ignore it.
 */
export function gameHeaders(contentType: string, siteOrigin: string, connectOrigins: string[] = []): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self' data: blob:",
      // Game engines (Unity, Godot, Emscripten) need eval and inline scripts.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      ["connect-src 'self' data: blob:", ...connectOrigins].join(" "),
      "worker-src 'self' blob:",
      // Frames only of the game's own pages, which carry the relay script: never a data: or blob: page without it.
      "frame-src 'self'",
      "form-action 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      `frame-ancestors ${siteOrigin}`,
    ].join("; "),
  );
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), fullscreen=(self), gamepad=(self), autoplay=(self)",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // Browsers read it only on documents; credentialless, so nothing a game loads needs a CORP header.
  headers.set("Document-Isolation-Policy", "isolate-and-credentialless");
  return headers;
}

/**
 * How long browsers remember that zaisma.com and the game domain only speak https, and that they may be on the browsers' own list of
 * https-only sites (preload, hstspreload.org), so even a first visit through an http:// link never goes out unencrypted.
 */
export const TRANSPORT_SECURITY_MAX_AGE_SEC = 31_536_000;
export const TRANSPORT_SECURITY = `max-age=${TRANSPORT_SECURITY_MAX_AGE_SEC}; includeSubDomains; preload`;

/** Plain http goes to the same address over https (308 keeps the method). */
export function upgradeToHttps(url: URL): Response {
  const secureUrl = new URL(url.toString());
  secureUrl.protocol = "https:";
  return new Response(null, { status: 308, headers: { Location: secureUrl.toString(), "Cache-Control": "no-store" } });
}

/** The answer with Strict-Transport-Security on it; left alone over http and for WebSocket upgrades. */
export function withTransportSecurity(url: URL, response: Response): Response {
  if (url.protocol !== "https:" || response.status === 101) return response;
  // Some responses (a fetched one, a redirect) have immutable headers, so copy.
  const copy = new Response(response.body, response);
  copy.headers.set("Strict-Transport-Security", TRANSPORT_SECURITY);
  return copy;
}
