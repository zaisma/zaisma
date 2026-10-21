import { accountById, audit, canOpenLink, checkLinkSites, gameBySlug, isTesterLinkOn, linkBrand, linksOf, openedLinkUrl, testerLinkByToken, type Game, type GameLink } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { playable } from "./home.ts";
import { cutButton, runButton } from "./components/actions.ts";
import { checkField } from "./components/choices.ts";
import { glassPane } from "./components/foundations.ts";
import { codeField } from "./components/inputs.ts";
import { html, raw, type Raw } from "./html.ts";
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
async function isOpenHere(env: Env, game: Game, testerToken: unknown): Promise<boolean> {
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
  return html`<aside class="game-card" id="link-ask" role="dialog" aria-labelledby="link-title" hidden>${glassPane({
    paneSize: "small",
    body: html`<div class="link-part" id="link-open">
<h2 id="link-title">You're leaving Zaisma</h2>
<p>${gameTitle} wants to open:</p>
${codeField({ id: "link-url", label: "The link", code: "" })}
${checkField({ id: "link-trust", name: "is_site_trusted", label: "Open links to this site straight away from now on, in this browser" })}
<div class="control-row">${cutButton("Stay", { id: "link-stay", type: "button" })}${runButton("Open", { href: "#", dataAttributes: { "link-go": "" } })}</div>
</div>
<div class="link-part" id="link-closed" hidden>
<h2 id="link-closed-title">This link can't be opened here.</h2>
${cutButton("Back to the game", { id: "link-back", type: "button", isFullWidth: true })}
</div>`,
  })}</aside>`;
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
    linkTrust.closest(".check").querySelector(".check-label").textContent = "Open links to " + host + " straight away from now on, in this browser";
    linkGo.href = answer.destination_url;
    linkGo.target = "_blank";
    linkGo.rel = "noopener noreferrer";
    linkGo.querySelector(".face > span:not([class])").textContent = "Open " + host.replace(/^www\\./, "");
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


/**
 * The developer's links on the game page (Developer links on game pages), in About: the registered links marked for the page that this
 * player may open (the server picked them), each a cut button with its site's mark, in one row. They go straight to the site in a new
 * tab: the "You're leaving Zaisma" card is for links a game opens, not for our own page's.
 */
export function developerLinks(links: GameLink[]): Raw | string {
  if (!links.length) return "";
  return html`<nav class="control-row" aria-label="The developer's links">${links.map((link) => {
    const { brand, label } = linkBrand(link.destination_url);
    return cutButton(label, { href: link.destination_url, icon: brand === "website" ? "globe" : `site-${brand}`, isNewTab: true, dataAttributes: { site: brand } });
  })}</nav>`;
}
