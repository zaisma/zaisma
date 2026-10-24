import { accountById, audit, canOpenLink, checkLinkSites, gameBySlug, isTesterLinkOn, linkBrand, linksOf, openedLinkUrl, testerLinkByToken, type Game, type GameLink } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { playable } from "./home.ts";
import { html, metalButton, raw, shownAddress, type Raw } from "./html.ts";
import { LINK_BRAND_ICON_PATHS } from "./link-icons.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * Registered links on the game page (docs/DECISIONS.md, "Games open outside links only through
 * Zaisma"). The game asks to open one of its links (Zaisma.links.open, as a zaisma:link message), right
 * after the player tapped or pressed a key in it, and the page asks the server for the address. The
 * server hands it over only when this player may open it, so the rule never rests on the page: signed-in
 * adults open any link that isn't flagged, guests and under-18 accounts only links on trusted domains.
 * The card over the game's top corner says "You're leaving Zaisma" with the full address, Open <site>
 * and Stay; a link that can't open says only "This link can't be opened here.", and the game hears the
 * same "stayed" as for Stay, so it never learns anyone's age.
 *
 *   POST /api/links/:slug   { link_name, path, query_parameters, tester_token }: the address to open, as
 *        { destination_url }, or { destination_url: null } when it can't open for this player. Errors
 *        the game made (the same for every player) answer { error: { code, message } }: unknown_link,
 *        bad_link_path, bad_link_query.
 *
 * Every link's site is checked again each day (recheckLinks, on the five-minute cron, a few games at a
 * time), and a site Cloudflare lists for malware or phishing stops the link opening for anyone.
 */

const DAY_MS = 86_400_000;
/** Games whose links are checked again in one run of the cron, every 5 minutes: up to 20 sites each. */
const RECHECKED_GAME_COUNT = 10;

const refusal = (httpStatus: number, code: string, message: string) => Response.json({ error: { code, message } }, { status: httpStatus, headers: { "Cache-Control": "no-store" } });

export async function handleGameLinks(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/links\/([a-z0-9-]+)$/);
  if (!match) return null;
  if (request.method !== "POST") return new Response(null, { status: 405 });
  // Only the game page asks: another site can't learn which links open for its visitors.
  if (request.headers.get("origin") !== new URL(env.SITE_ORIGIN).origin) return new Response(null, { status: 403 });
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.PLAY_LIMIT && !(await env.PLAY_LIMIT.limit({ key: `links:${ip}` })).success) return refusal(429, "slow_down", "Too many links opened in the last minute. Try again in a minute.");
  const text = await request.text();
  if (text.length > 8192) return new Response(null, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }
  const game = await gameBySlug(env.DB, match[1]!);
  if (!game || !(await isOpenHere(env, game, body.tester_token))) return new Response(null, { status: 404 });
  const link = linksOf(game).find((candidate) => candidate.link_name === body.link_name);
  if (!link) return refusal(404, "unknown_link", `${game.title} has no link named ${JSON.stringify(body.link_name)}. Register it on the game's details (update_game links), then open it by its link_name.`);
  const opened = openedLinkUrl(link, body.path, body.query_parameters);
  if ("code" in opened) return refusal(400, opened.code, opened.message);
  const session = await currentSession(request, env).catch(() => null);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const response = Response.json({ destination_url: canOpenLink(link, account?.age_band === "18+") ? opened.url : null }, { headers: { "Cache-Control": "no-store" } });
  for (const cookie of session?.cookies ?? []) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** Whether the game is played on a page here: its public page, or a tester link's for a game that may be private. */
export async function isOpenHere(env: Env, game: Game, testerToken: unknown): Promise<boolean> {
  if (typeof testerToken !== "string") return playable(game);
  const tester = await testerLinkByToken(env.DB, testerToken);
  return Boolean(tester && isTesterLinkOn(tester) && tester.slug === game.slug && game.review_status === "live" && game.live_version_id);
}

/** Every link's site again, a day after its last check: the games waiting longest first, a few each run. */
export async function recheckLinks(env: Env, nowMs = Date.now()): Promise<void> {
  const { results: games } = await env.DB
    .prepare("SELECT id, links FROM games WHERE links != '[]' AND (links_checked_at_ms IS NULL OR links_checked_at_ms < ?) ORDER BY links_checked_at_ms LIMIT ?")
    .bind(nowMs - DAY_MS, RECHECKED_GAME_COUNT)
    .all<{ id: string; links: string }>();
  for (const game of games) {
    const before = linksOf(game);
    const after = await checkLinkSites(before, before, { dnsUrl: env.LINK_CHECK_DNS_URL, nowMs, isRecheck: true });
    // Unless the developer changed the links meanwhile: the new ones were checked as they were set.
    const changed = await env.DB.prepare("UPDATE games SET links = ?, links_checked_at_ms = ? WHERE id = ? AND links = ?").bind(JSON.stringify(after), nowMs, game.id, game.links).run();
    if (!changed.meta.changes) continue;
    for (const link of after) {
      const wasFlagged = Boolean(before.find((earlier) => earlier.link_name === link.link_name)?.review_reason);
      if (link.review_reason && !wasFlagged) await audit(env.DB, game.id, "link-flagged", `${link.link_name} ${link.destination_url}`, "system", link.review_reason);
      if (!link.review_reason && wasFlagged) await audit(env.DB, game.id, "link-cleared", `${link.link_name} ${link.destination_url}`);
    }
  }
}

/**
 * The card over the game's top corner, like the sign-in ask: where a link goes, or that it can't open
 * here. Open is a real link to the address, so the browser opens the tab however long the player looked.
 */
export function leavingCard(gameTitle: string): Raw {
  return html`<style>
.leave .out-url{margin:0;padding:10px 12px;font-size:13px;color:var(--text-2);word-break:break-all;background:#0d0f12;box-shadow:inset 0 2px 5px rgba(0,0,0,.65)}
.leave label.check{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--text-2)}
.leave label.check input{width:16px;height:16px;min-height:0;margin:2px 0 0;flex:none;accent-color:#c9cace}
.leave .link-part{display:grid;gap:10px}
.leave .link-part[hidden]{display:none}
</style>
<aside class="keep plate bevel leave" id="link-ask" role="dialog" aria-labelledby="link-title" hidden>
  <div class="link-part" id="link-open">
    <strong id="link-title">You're leaving Zaisma</strong>
    <p>${gameTitle} wants to open:</p>
    <p class="out-url" id="link-url"></p>
    <label class="check"><input type="checkbox" id="link-trust"> <span>Open links to <span id="link-host"></span> straight away from now on, in this browser</span></label>
    <div class="row">${metalButton("Open", { href: "#", dataAttributes: { "link-go": "" } })}<button class="btn ghost" type="button" id="link-stay">Stay</button></div>
  </div>
  <div class="link-part" id="link-closed" hidden>
    <strong id="link-closed-title">This link can't be opened here.</strong>
    <div class="row"><button class="btn ghost" type="button" id="link-back">Back to the game</button></div>
  </div>
</aside>`;
}

/**
 * The game page's script for links: it needs the page's gamePage, frame and gameOrigin (pages.ts), whose
 * script comes first. A site the player ticked (in the forum too) opens straight away, while their tap in
 * the game still counts; if the browser holds that tab back, the card asks instead.
 */
export const GAME_LINKS_SCRIPT = pageScript("game-links", `const linkAsk = document.getElementById("link-ask");
const linkGo = linkAsk.querySelector("[data-link-go]");
const linkTrust = document.getElementById("link-trust");
const TRUSTED_SITES = "zaisma-trusted-sites";
const trustedSites = () => { try { return JSON.parse(localStorage.getItem(TRUSTED_SITES) || "[]"); } catch { return []; } };
// Right after the player tapped or pressed a key in the game (the browser counts it for this page too).
const hasPlayerTap = () => !navigator.userActivation || navigator.userActivation.isActive;
let linkAsking = null;
let latestLinkRequestNumber = null;
const tellLink = (requestNumber, status, error) => frame && frame.contentWindow.postMessage({ type: "zaisma:link", requestNumber, status, ...(error || {}) }, gameOrigin);
function closeLink(status) {
  if (!linkAsking) return;
  const asked = linkAsking;
  linkAsking = null;
  linkAsk.hidden = true;
  tellLink(asked.requestNumber, status);
  if (frame) frame.focus();
}
window.askLink = async (asked) => {
  const requestNumber = asked.requestNumber;
  if (!hasPlayerTap()) return tellLink(requestNumber, "error", { code: "needs_player_tap", message: "Links open only right after the player taps or presses a key in the game: call Zaisma.links.open from that tap's handler." });
  // Another link while the card is up: the player stays for the first.
  closeLink("stayed");
  latestLinkRequestNumber = requestNumber;
  tellLink(requestNumber, "asking");
  const answer = await fetch("/api/links/" + gamePage.slug, { method: "POST", body: JSON.stringify({ link_name: asked.linkName, path: asked.path ?? null, query_parameters: asked.queryParameters ?? null, ...(gamePage.tester_token ? { tester_token: gamePage.tester_token } : {}) }) })
    .then((response) => response.json()).catch(() => null);
  if (requestNumber !== latestLinkRequestNumber) return tellLink(requestNumber, "stayed");
  if (!answer || answer.error) return tellLink(requestNumber, "error", answer && answer.error ? { code: answer.error.code, message: answer.error.message } : { code: "request_failed", message: "Zaisma didn't answer, so check the connection and try again." });
  linkAsking = { requestNumber, url: answer.destination_url };
  const isOpen = Boolean(answer.destination_url);
  if (isOpen) {
    const host = new URL(answer.destination_url).hostname;
    if (trustedSites().includes(host) && hasPlayerTap()) {
      const opened = window.open(answer.destination_url, "_blank");
      if (opened) {
        opened.opener = null;
        return closeLink("opened");
      }
    }
    document.getElementById("link-url").textContent = answer.destination_url;
    document.getElementById("link-host").textContent = host;
    linkGo.href = answer.destination_url;
    linkGo.target = "_blank";
    linkGo.rel = "noopener noreferrer";
    linkGo.querySelector("span").textContent = "Open " + host.replace(/^www\\./, "");
    linkTrust.checked = false;
    linkTrust.dataset.host = host;
  }
  document.getElementById("link-open").hidden = !isOpen;
  document.getElementById("link-closed").hidden = isOpen;
  linkAsk.setAttribute("aria-labelledby", isOpen ? "link-title" : "link-closed-title");
  const keep = document.getElementById("keep");
  if (keep) keep.hidden = true;
  linkAsk.hidden = false;
  (isOpen ? linkGo : document.getElementById("link-back")).focus();
};
// Open: the link itself opens the tab; the tick remembers the site in this browser, as the forum does.
linkGo.addEventListener("click", () => {
  if (linkTrust.checked) {
    const sites = trustedSites();
    if (!sites.includes(linkTrust.dataset.host)) sites.push(linkTrust.dataset.host);
    try { localStorage.setItem(TRUSTED_SITES, JSON.stringify(sites)); } catch {}
  }
  setTimeout(() => closeLink("opened"));
});
document.getElementById("link-stay").onclick = () => closeLink("stayed");
document.getElementById("link-back").onclick = () => closeLink("stayed");
linkAsk.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLink("stayed"); });`);


const GLOBE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.7 5.7 3.7 9s-1.2 6.3-3.7 9c-2.5-2.7-3.7-5.7-3.7-9S9.5 5.7 12 3z"/></svg>';

/**
 * The developer's links on the game page (Developer links on game pages), under the details: the
 * registered links marked for the page that this player may open (the server picked them), each a
 * button in its site's own look. They go straight to the site in a new tab: the "You're leaving
 * Zaisma" card is for links a game opens, not for our own page's.
 */
export function developerLinks(links: GameLink[]): Raw | string {
  if (!links.length) return "";
  return html`<nav class="dev-links" aria-label="The developer's links">${links.map((link) => {
    const destinationUrl = shownAddress(link.destination_url);
    if (!destinationUrl) return "";
    const { brand, label } = linkBrand(destinationUrl);
    const icon = brand === "website" ? GLOBE_ICON : `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${LINK_BRAND_ICON_PATHS[brand]}"/></svg>`;
    return html`<a class="dev-link brand-${brand}" href="${destinationUrl}" target="_blank" rel="noopener noreferrer">${raw(icon)}<span>${label}</span></a>`;
  })}</nav>`;
}

/** Each site's button, after its own: Steam's raised gradient, Discord's flat blurple, itch.io's red. */
export const DEVELOPER_LINK_STYLES = `
.dev-links{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 0}
.dev-link{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 14px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:600;line-height:1;text-decoration:none;white-space:nowrap;transition:filter 120ms,background 120ms}
.dev-link svg{width:16px;height:16px;flex:none}
.dev-link:hover{filter:brightness(1.12)}
.dev-link:focus-visible{outline:2px solid #fff;outline-offset:2px}
.brand-steam{color:#fff;border-radius:2px;background:linear-gradient(to right,#47bfff 5%,#1a44c2 60%);box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 2px 3px rgba(0,0,0,.55);text-shadow:0 1px 1px rgba(0,0,0,.35)}
.brand-steam:hover{background:linear-gradient(to right,#67cfff 5%,#2a5bd8 60%);filter:none}
.brand-itch{color:#fff;background:#fa5c5c;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 1px 0 #c34c4c;text-shadow:0 1px 0 rgba(0,0,0,.18)}
.brand-discord{color:#fff;background:#5865f2;border-radius:4px}
.brand-discord:hover{background:#4752c4;filter:none}
.brand-youtube{color:#fff;background:#ff0000;border-radius:18px}
.brand-x{color:#fff;background:#000;border-radius:18px;box-shadow:inset 0 0 0 1px #333}
.brand-bluesky{color:#fff;background:#0085ff;border-radius:18px}
.brand-reddit{color:#fff;background:#ff4500;border-radius:18px}
.brand-tiktok{color:#fff;background:#fe2c55;border-radius:4px}
.brand-instagram{color:#fff;border-radius:8px;background:linear-gradient(45deg,#f58529,#dd2a7b 50%,#8134af)}
.brand-patreon{color:#fff;background:#ff424d;border-radius:18px}
.brand-kofi{color:#fff;background:#29abe0;border-radius:10px;box-shadow:0 2px 0 #1b8bb8}
.brand-github{color:#fff;background:#24292f;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(240,246,252,.1)}
.brand-kickstarter{color:#0f2105;background:#05ce78;border-radius:0}
.brand-app_store,.brand-google_play{color:#fff;background:#000;border-radius:8px;box-shadow:inset 0 0 0 1px #a6a6a6}
.brand-twitch{color:#fff;background:#9146ff;border-radius:4px}
.brand-gumroad{color:#000;background:#ff90e8;border-radius:4px;box-shadow:inset 0 0 0 1px #000,3px 3px 0 #000}
.brand-website{color:var(--text);background:var(--face-hi);box-shadow:inset 1px 1px 0 rgba(255,255,255,.12),inset -1px -1px 0 #000;font-family:var(--display);font-weight:500}
`;
