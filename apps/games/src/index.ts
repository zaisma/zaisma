import { isServerPath, connectSources, contentTypeFor, fileKey, gameHeaders, manifestKey, servableGame, testerLinkByToken, versionByPreview, type Manifest } from "@zaisma/core";
import savesScript from "@zaisma/sdk/saves.js";
import pictureScript from "@zaisma/sdk/picture.js";
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

/** Bump when our scripts or the injected tags change, so browsers fetch the new ones. */
const SCRIPTS_VERSION = 4;

const RESTORE_PAGE = `<!doctype html><meta charset="utf-8"><title>Loading</title><body style="margin:0;background:#000"><script src="saves.js?v=${SCRIPTS_VERSION}"></script>`;

/**
 * Put our scripts first in <head>, before any game script runs: the saves script must be there
 * before the game reads its saves, and the picture script before the game starts drawing.
 */
export function withScripts(page: string, srcs: string[]): string {
  const tag = srcs.map((src) => `<script src="${src}"></script>`).join("");
  const head = page.match(/<head(\s[^>]*)?>/i);
  if (head) return page.slice(0, head.index! + head[0].length) + tag + page.slice(head.index! + head[0].length);
  const html = page.match(/<html(\s[^>]*)?>/i);
  if (html) return page.slice(0, html.index! + html[0].length) + tag + page.slice(html.index! + html[0].length);
  const doctype = page.match(/^\s*<!doctype[^>]*>/i);
  return doctype ? doctype[0] + tag + page.slice(doctype[0].length) : tag + page;
}

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
    // A secret link, <slug>--<token>: a version's private preview or a tester link. Slugs never contain "--".
    const secret = "slug" in target.by ? target.by.slug.match(/^([a-z0-9-]+?)--([a-z0-9]{20})$/) : null;
    const by = secret ? { slug: secret[1]! } : target.by;

    // Read status on every request so a takedown applies straight away.
    const game = await servableGame(env.DB, by);
    if (game?.review_status === "removed") return page(410, "This game was removed", "It broke Zaisma's rules or was taken down on request.", env);
    if (game?.review_status === "held") return page(404, "This game is being reviewed", "Try again later.", env);
    if (!game) return page(404, "Game not found", "Check the link and try again.", env);

    let version: { id: string; kind: "zip" | "files"; r2_prefix: string };
    const draft = secret ? await versionByPreview(env.DB, game.id, secret[2]!) : null;
    const tester = secret && !draft ? await testerLinkByToken(env.DB, secret[2]!) : null;
    if (secret && !draft && tester?.game_id !== game.id) {
      return page(404, "This link doesn't work", "The developer may have turned it off, or it was for a version that was deleted. Ask them for a fresh link.", env);
    }
    if (draft) version = draft;
    else {
      // Drafts and private games open only through preview and tester links; a tester link opens the live version.
      if (game.review_status !== "live" || !game.r2_prefix || !game.live_version_id) {
        return tester ? page(404, "Nothing to play yet", "The developer hasn't published a version of this game yet.", env) : page(404, "Game not found", "Check the link and try again.", env);
      }
      if (!tester && (game.visibility === "draft" || game.visibility === "private")) return page(404, "Game not found", "Check the link and try again.", env);
      version = { id: game.live_version_id, kind: game.version_kind ?? "zip", r2_prefix: game.r2_prefix };
    }
    // Previews and tester links keep their saves in their own browser storage, never the player's account.
    const cloudSaves = Boolean(game.cloud_saves_enabled) && !secret;

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
      // Room links from a tester link go back through it, since a private game has no public page.
      const config = { rooms: env.ROOMS_ORIGIN, game: game.slug, site: env.SITE_ORIGIN, ...(tester ? { page: `/t/${tester.token}` } : {}) };
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connect);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : `var __ZAISMA__ = ${JSON.stringify(config)};\n${sdk}`, { headers });
    }

    // Report pictures: every game page can hand the Zaisma page a picture of the game when a player reports it.
    if (target.path === "_zaisma/picture.js") {
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connect);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : `var __ZAISMA_PICTURE__ = ${JSON.stringify({ site: env.SITE_ORIGIN })};\n${pictureScript}`, { headers });
    }

    // Cloud saves: the script that hands the game's browser save to the Zaisma game page,
    // and the page that puts an account's save in place before the game starts.
    if (cloudSaves && target.path === "_zaisma/saves.js") {
      const headers = gameHeaders("text/javascript; charset=utf-8", env.SITE_ORIGIN, connect);
      headers.set("Cache-Control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : `var __ZAISMA_SAVES__ = ${JSON.stringify({ site: env.SITE_ORIGIN })};\n${savesScript}`, { headers });
    }
    if (cloudSaves && target.path === "_zaisma/restore") {
      const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN, connect);
      headers.set("Cache-Control", "no-cache");
      return new Response(request.method === "HEAD" ? null : RESTORE_PAGE, { headers });
    }

    const path = target.path === "" || target.path.endsWith("/") ? `${target.path}index.html` : target.path;
    // A game's own game server runs in our rooms' sandbox; players never get its code.
    if (isServerPath(path)) return page(404, "File not found", "This game is missing a file.", env);
    const html = path.endsWith(".html");
    const inject = html;
    // Pages get our scripts on the way out, so they skip ranges and R2's own ETag checks.
    const key = fileKey(version, version.kind === "files" ? await manifestFor(env, version.id) : null, path);
    const object = key ? await env.GAMES.get(key, inject ? {} : { range: request.headers, onlyIf: request.headers }) : null;
    if (!object) return page(404, "File not found", "This game is missing a file.", env);

    const headers = gameHeaders(contentTypeFor(path), env.SITE_ORIGIN, connect);
    if (secret) headers.set("X-Robots-Tag", "noindex");
    headers.set("ETag", object.httpEtag);
    // HTML is re-checked so takedowns and updates show up. Other files keep the same address
    // across versions, so they're only cached briefly: an update reaches players within a minute.
    headers.set("Cache-Control", html ? "no-cache" : "public, max-age=60");
    headers.set("Accept-Ranges", "bytes");

    if (inject && "body" in object && object.body) {
      headers.delete("Accept-Ranges");
      headers.set("ETag", `W/"${object.etag}-z${SCRIPTS_VERSION}${cloudSaves ? "s" : ""}"`);
      if (request.headers.get("if-none-match") === headers.get("ETag")) return new Response(null, { status: 304, headers });
      const scripts = [...(cloudSaves ? [`${target.base}_zaisma/saves.js?v=${SCRIPTS_VERSION}`] : []), `${target.base}_zaisma/picture.js?v=${SCRIPTS_VERSION}`];
      const page = withScripts(await object.text(), scripts);
      return new Response(request.method === "HEAD" ? null : page, { headers });
    }

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
