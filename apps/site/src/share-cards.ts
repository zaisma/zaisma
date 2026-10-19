/**
 * Share cards, search and QR codes for game pages (docs/DECISIONS.md, "Share cards" and "QR codes"):
 * every game link and room invite unfolds into the game's art, its title and one line wherever it's
 * shared; search engines get the same title, the developer's description, structured data and a
 * sitemap of listed games; and a game's link, or a room's, comes as a QR code.
 */

import { qrCodeSvg, type Game } from "@zaisma/core";
import type { Env } from "./env.ts";
import { playable } from "./home.ts";
import { html, raw, type Raw } from "./html.ts";
import { profilePath } from "./profiles.ts";

const ROOM_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
/** Search engines show about this much of a description. */
const SEARCH_DESCRIPTION_CHARACTER_COUNT = 160;

/** The words on a shared link's card. */
export function shareWords(gameTitle: string, roomCode: string | null): { title: string; line: string } {
  return roomCode ? { title: `Join my match in ${gameTitle}`, line: "Tap to join in your browser." } : { title: gameTitle, line: "Play now in your browser." };
}

/** A description cut to what search engines show, on a word. */
export function searchDescription(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat.length <= SEARCH_DESCRIPTION_CHARACTER_COUNT) return flat;
  const cut = flat.slice(0, SEARCH_DESCRIPTION_CHARACTER_COUNT - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** The picture a shared link unfolds into: the share picture, else the cover, else the first screenshot. */
export async function shareImage(env: Env, gameId: string): Promise<{ id: string; width_px: number; height_px: number } | null> {
  return env.DB.prepare(
    `SELECT id, width_px, height_px FROM game_images WHERE game_id = ? AND review_status = 'approved' AND kind IN ('share', 'cover', 'screenshot')
     ORDER BY CASE kind WHEN 'share' THEN 0 WHEN 'cover' THEN 1 ELSE 2 END, created_at_ms LIMIT 1`,
  )
    .bind(gameId)
    .first<{ id: string; width_px: number; height_px: number }>();
}

/** The card image's size: the picture fitted inside 1200 by 630, as /img/:id/card.jpg makes it. */
export function cardImageSize(widthPx: number, heightPx: number): { width_px: number; height_px: number } {
  const scaleNumber = Math.min(1, CARD_IMAGE_WIDTH_PX / widthPx, CARD_IMAGE_HEIGHT_PX / heightPx);
  return { width_px: Math.round(widthPx * scaleNumber), height_px: Math.round(heightPx * scaleNumber) };
}

export const CARD_IMAGE_WIDTH_PX = 1200;
export const CARD_IMAGE_HEIGHT_PX = 630;

/**
 * The head tags of a game page: what chat apps, social sites and search engines read. A room link's
 * card invites into the match; every address points search engines at the game's own page.
 */
export async function gamePageHead(env: Env, game: Game, options: { roomCode: string | null; developerName: string | null }): Promise<Raw> {
  const pageUrl = `${env.SITE_ORIGIN}/g/${game.slug}`;
  const sharedUrl = options.roomCode ? `${pageUrl}?room=${options.roomCode}` : pageUrl;
  const words = shareWords(game.title, options.roomCode);
  const image = await shareImage(env, game.id);
  const cardSize = image ? cardImageSize(image.width_px, image.height_px) : null;
  const imageUrl = image ? `${env.SITE_ORIGIN}/img/${image.id}/card.jpg` : `${env.SITE_ORIGIN}/app-icon-512.png`;
  const description = game.description ? searchDescription(game.description) : words.line;
  const structured = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: game.title,
    url: pageUrl,
    ...(game.description ? { description } : {}),
    ...(image ? { image: imageUrl } : {}),
    gamePlatform: "Web browser",
    applicationCategory: "Game",
    operatingSystem: "Any",
    ...(options.developerName ? { author: { "@type": "Person", name: options.developerName, url: `${env.SITE_ORIGIN}${profilePath(options.developerName)}` } } : {}),
  };
  // JSON in a script tag: "<" escaped so no text in it can close the tag.
  const json = JSON.stringify(structured).replace(/</g, "\\u003c");
  return html`<meta name="description" content="${description}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Zaisma">
<meta property="og:url" content="${sharedUrl}">
<meta property="og:title" content="${words.title}">
<meta property="og:description" content="${words.line}">
<meta property="og:image" content="${imageUrl}">
${cardSize ? html`<meta property="og:image:width" content="${cardSize.width_px}">
<meta property="og:image:height" content="${cardSize.height_px}">
<meta property="og:image:alt" content="${game.title}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<script type="application/ld+json">${raw(json)}</script>`;
}

/** Every listed live game, for search engines, with the home page. */
export async function sitemap(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT slug, updated_at_ms FROM games WHERE review_status = 'live' AND visibility = 'listed' AND live_version_id IS NOT NULL ORDER BY updated_at_ms DESC LIMIT 50000").all<{ slug: string; updated_at_ms: number }>();
  const entry = (path: string, changedAtMs?: number) => `<url><loc>${env.SITE_ORIGIN}${path}</loc>${changedAtMs ? `<lastmod>${new Date(changedAtMs).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entry("/")}${results.map((game) => entry(`/g/${game.slug}`, game.updated_at_ms)).join("")}</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

/** The address a QR code carries: the game's page, or a room in it. */
export function gameLinkUrl(env: Env, slug: string, roomCode: string | null): string {
  return `${env.SITE_ORIGIN}/g/${slug}${roomCode ? `?room=${roomCode}` : ""}`;
}

/** A room code from the address, when it's a real code. */
export function roomCodeOf(given: string | null): string | null {
  const code = (given ?? "").toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

/**
 * zaisma.com/g/<slug>/qr-code.svg (?room=CODE): the game's link, or a room's, as a QR code, for the
 * Share dialog. Only for games anyone with the link can open, and only ever their own address.
 */
export async function qrCodeImage(env: Env, game: Game | null, request: Request): Promise<Response> {
  if (!game || !playable(game)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const roomCode = roomCodeOf(new URL(request.url).searchParams.get("room"));
  return new Response(qrCodeSvg(gameLinkUrl(env, game.slug, roomCode)), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/**
 * The game page's Share dialog: the QR code (the room's during a match), the link with Copy, and the
 * system's share sheet where there is one. Tester links get no QR code: their address is a secret
 * the code would only spread further. The game page's script fills it in (shareFrom).
 */
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

export function shareDialog(gameTitle: string, hasQrCode: boolean): Raw {
  return html`<dialog id="share-dialog" class="share-dialog plate bevel" aria-labelledby="share-title">
  <div class="head"><strong id="share-title">Share ${gameTitle}</strong><button class="btn ghost close" type="button" id="share-close" aria-label="Close">×</button></div>
  <div class="body">
    <div class="share-secret">
      ${hasQrCode ? html`<figure class="share-qr"><img id="share-qr" alt="QR code for this link" width="220" height="220"><figcaption id="share-scan">Scan to play</figcaption></figure>` : ""}
      <p class="share-room" id="share-room" hidden>Room code <b></b></p>
      <button class="btn reveal" type="button" id="share-reveal" hidden>${raw(EYE_ICON)}Show</button>
    </div>
    <div class="share-row"><input readonly aria-label="Link"><button class="btn" type="button" id="share-copy">Copy</button></div>
    <button class="btn ghost" type="button" id="share-more" hidden>More ways to share</button>
  </div>
</dialog>`;
}

export const SHARE_DIALOG_STYLES = `
/* Share: the QR code on white, so any phone's camera reads it, then the link. */
dialog.share-dialog{width:min(360px,calc(100vw - 32px));padding:0}
.share-dialog .close{min-height:36px;width:36px;padding:0;font-size:22px;line-height:1}
.share-dialog .body{justify-items:stretch}
.share-qr{margin:4px auto 0;display:grid;justify-items:center;gap:10px}
.share-qr img{display:block;width:220px;height:220px;background:#fff;box-shadow:0 0 0 1px #000,0 10px 26px rgba(0,0,0,.5)}
.share-qr figcaption{font-family:var(--display);font-size:16px;font-weight:500;color:var(--text)}
.share-row{display:flex;gap:8px}
.share-row input{flex:1;min-width:0}
.share-row .btn{flex:none}
#share-more[hidden]{display:none}
.share-room{margin:0;text-align:center;font-size:14px;color:var(--text-2)}
.share-room b{font-family:var(--display);font-size:18px;letter-spacing:.14em;color:var(--text);margin-left:6px}
.share-room[hidden],#share-reveal[hidden]{display:none}
.share-secret{position:relative;display:grid;gap:12px}
/* Show sits on the blurred code itself: one tap reveals the code, link and QR code. */
.share-secret .reveal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;display:inline-flex;align-items:center;gap:8px;box-shadow:0 8px 22px rgba(0,0,0,.6)}
.share-secret .reveal svg{width:18px;height:18px}
/* The room code is hidden (for streamers): the code, link and QR code blur until Show; Copy still works. */
.share-dialog.masked .share-qr img,.share-dialog.masked .share-row input,.share-dialog.masked .share-room b{filter:blur(7px)}
.share-dialog.masked .share-row input{cursor:pointer}
`;
