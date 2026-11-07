import { KEPT_PLAYED_GAME_COUNT } from "@zaisma/core";
import { DEVICE_KIND_SOURCE } from "./device-kind.ts";
import { pageScript } from "./page-scripts.ts";

/** The games this device played, by their slugs, newest first (the game page and the home's script keep it): a guest's Continue playing shows from the home's first paint. */
export const PLAYED_COOKIE = "zaisma_played";

/** The script that keeps PLAYED_COOKIE from a list of { slug } newest first, for the game page's and the home's scripts. */
export const KEEP_PLAYED_COOKIE_SOURCE = `function keepPlayedCookie(list) {
  document.cookie = (location.protocol === "https:" ? "__Host-" : "") + ${JSON.stringify(PLAYED_COOKIE)} + "=" + list.slice(0, 20).map((entry) => entry.slug).join(",") + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
}`;

/**
 * The home's script. The server puts the player's own part on the page from what it knows (an account's list, PLAYED_COOKIE); this catches the two
 * cases the server can't see: a guest's device that played before the cookie kept it, and an account's plays made on this device that the account
 * doesn't have yet.
 */
export const HOME_SCRIPT = pageScript("home", String.raw`(() => {
const $ = (id) => document.getElementById(id);
${DEVICE_KIND_SOURCE}
zaismaDeviceKind();
${KEEP_PLAYED_COOKIE_SOURCE}
const data = $("home-data");
if (!data) return;
// Drawn for an account by the server's own word (account_played, null for a guest), not the sign-in cookie, which can outlive its session.
const accountPlayed = JSON.parse(data.textContent).account_played;
const PLAYED_KEY = "zaisma:played";
let played = [];
try { played = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]").map((entry) => ({ slug: entry.slug, played_at_ms: entry.played_at_ms ?? entry.at, is_on_account: entry.is_on_account === true })).filter((entry) => typeof entry.slug === "string" && Number.isFinite(entry.played_at_ms)); } catch {}
if (accountPlayed) {
  /* ---- What this device played that the account doesn't have, or played later, goes to the account once (is_on_account, once it's
     taken), so the next visit shows it from its first paint. The account keeps its whole history, so an older game goes too. ---- */
  const accountPlayedAtMs = new Map(accountPlayed.map((entry) => [entry.slug, entry.played_at_ms]));
  const sent = played.filter((entry) => !entry.is_on_account && entry.played_at_ms > (accountPlayedAtMs.get(entry.slug) || 0)).sort((first, second) => second.played_at_ms - first.played_at_ms).slice(0, ${KEPT_PLAYED_GAME_COUNT});
  if (!sent.length) return;
  fetch("/api/me/played", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ played: sent.map((entry) => ({ slug: entry.slug, played_at_ms: entry.played_at_ms })) }) }).then((response) => {
    if (!response.ok) return;
    // Marked on the list as it is now: the game page may have changed it since.
    const isSent = (entry) => sent.some((each) => each.slug === entry.slug && each.played_at_ms === (entry.played_at_ms ?? entry.at));
    try { localStorage.setItem(PLAYED_KEY, JSON.stringify(JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]").map((entry) => (isSent(entry) ? { ...entry, is_on_account: true } : entry)))); } catch {}
  }).catch(() => {});
  return;
}
/* ---- A guest who played here before the cookie kept it: kept there from now on, and the page opened again once with it. ---- */
if (!$("home-first-visit") || document.cookie.includes(${JSON.stringify(PLAYED_COOKIE)}) || !played.length) return;
keepPlayedCookie([...played].sort((first, second) => second.played_at_ms - first.played_at_ms));
if (document.cookie.includes(${JSON.stringify(PLAYED_COOKIE)})) location.reload();
})();`);
