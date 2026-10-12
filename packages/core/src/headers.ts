/**
 * Headers for every file served from the game domain. Games are untrusted:
 * they run on their own site, can't load or call anything outside it, and
 * can only be framed by Zaisma.
 */
export function gameHeaders(contentType: string, siteOrigin: string): Headers {
  const h = new Headers();
  h.set("Content-Type", contentType);
  h.set(
    "Content-Security-Policy",
    [
      "default-src 'self' data: blob:",
      // Game engines (Unity, Godot, Emscripten) need eval and inline scripts.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' data: blob:",
      "worker-src 'self' blob:",
      "form-action 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      `frame-ancestors ${siteOrigin}`,
    ].join("; "),
  );
  h.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), fullscreen=(self), gamepad=(self), autoplay=(self)",
  );
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  return h;
}
