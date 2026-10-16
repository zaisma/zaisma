/**
 * The servers a game may connect to besides its own site: Zaisma rooms and the
 * game's own servers (set by an admin), each over both https and wss.
 */
export function connectSources(roomsOrigin: string | null, connectHosts: string): string[] {
  const out = new Set<string>();
  for (const origin of [roomsOrigin ?? "", ...parseConnectHosts(connectHosts)]) {
    if (!origin) continue;
    // Local dev runs rooms over plain http/ws; everything real is https/wss.
    const secure = !/^(http|ws):/.test(origin);
    const host = origin.replace(/^[a-z]+:\/\//, "");
    out.add(`${secure ? "https" : "http"}://${host}`);
    out.add(`${secure ? "wss" : "ws"}://${host}`);
  }
  return [...out];
}

/** A game's own servers: one https:// or wss:// origin per line, at most 5. Throws on anything else. */
export function parseConnectHosts(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 5) throw new Error("At most 5 servers.");
  return lines.map((line) => {
    const url = URL.canParse(line) ? new URL(line) : null;
    if (!url || (url.protocol !== "https:" && url.protocol !== "wss:") || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
      throw new Error(`"${line}" isn't a server address like wss://play.example.com`);
    }
    return `${url.protocol}//${url.host}`;
  });
}

/**
 * Headers for every file served from the game domain. Games are untrusted:
 * they run on their own site, can't load anything from outside it, can only
 * connect to Zaisma rooms and their own listed servers, and can only be framed by Zaisma.
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
  return headers;
}
