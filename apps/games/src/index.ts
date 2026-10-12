import { connectSources, contentTypeFor, gameHeaders, servableGame } from "@zaisma/core";
import sdk from "@zaisma/sdk/zaisma.js";

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
  const slash = rest.indexOf("/");
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  if (!slug) return null;
  return { by: { slug }, path: slash === -1 ? "" : rest.slice(slash + 1), base: `/${slug}/` };
}

function decodePath(p: string): string | null {
  try {
    const path = decodeURIComponent(p);
    if (path.split("/").some((part) => part === ".." || part === ".") || path.includes("\\") || path.includes("\0")) return null;
    return path;
  } catch {
    return null;
  }
}

function page(status: number, title: string, text: string, env: Env): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#eee;font:16px system-ui,sans-serif;text-align:center"><div><h1 style="font-size:22px">${title}</h1><p>${text}</p></div>`;
  const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN);
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    // Read status on every request so a takedown applies straight away.
    const game = await servableGame(env.DB, target.by);
    if (game?.status === "removed") return page(410, "This game was removed", "It broke Zaisma's rules or was taken down on request.", env);
    if (game?.status === "held") return page(404, "This game is being reviewed", "Try again later.", env);
    if (!game || game.status !== "live" || !game.r2_prefix) return page(404, "Game not found", "Check the link and try again.", env);

    // /<slug> -> /<slug>/ so the game's relative links work.
    if (env.GAME_HOST_MODE === "path" && !url.pathname.endsWith("/") && target.path === "") {
      return Response.redirect(`${url.origin}${target.base}${url.search}`, 301);
    }

    let connect: string[];
    try {
      connect = connectSources(env.ROOMS_ORIGIN, game.connect_hosts);
    } catch {
      connect = connectSources(env.ROOMS_ORIGIN, "");
    }

    // The SDK, served from the game's own site so its sandbox allows it, set up for this game.
    if (target.path === "_zaisma/v1.js") {
      const config = { rooms: env.ROOMS_ORIGIN, game: game.slug, site: env.SITE_ORIGIN };
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connect);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : `var __ZAISMA__ = ${JSON.stringify(config)};\n${sdk}`, { headers });
    }

    const path = target.path === "" || target.path.endsWith("/") ? `${target.path}index.html` : target.path;
    const object = await env.GAMES.get(`${game.r2_prefix}/${path}`, { range: request.headers, onlyIf: request.headers });
    if (!object) return page(404, "File not found", "This game is missing a file.", env);

    const headers = gameHeaders(contentTypeFor(path), env.SITE_ORIGIN, connect);
    headers.set("ETag", object.httpEtag);
    // HTML is re-checked so takedowns and updates show up. Other files keep the same address
    // across versions, so they're only cached briefly: an update reaches players within a minute.
    headers.set("Cache-Control", path.endsWith(".html") ? "no-cache" : "public, max-age=60");
    headers.set("Accept-Ranges", "bytes");

    if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
    let status = 200;
    if (object.range && request.headers.has("range")) {
      const r = object.range as { offset?: number; length?: number; suffix?: number };
      const offset = r.suffix !== undefined ? object.size - r.suffix : (r.offset ?? 0);
      const length = r.suffix !== undefined ? r.suffix : (r.length ?? object.size - offset);
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      status = 206;
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  },
} satisfies ExportedHandler<Env>;
