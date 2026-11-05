import { SIZED_IMAGE_WIDTHS_PX } from "@zaisma/core";
import { DEVICE_KIND_SOURCE } from "./device-kind.ts";
import { pageScript } from "./page-scripts.ts";

/** The news a device closed, by their ids, newest first (the home's script keeps it): the home shows them closed from its first paint. */
export const CLOSED_NEWS_COOKIE = "zaisma_closed_news";

/** The games this device played, by their slugs, newest first (the game page and the home's script keep it): a guest's Continue playing shows from the home's first paint. */
export const PLAYED_COOKIE = "zaisma_played";

/** The script that keeps PLAYED_COOKIE from a list of { slug } newest first, for the game page's and the home's scripts. */
export const KEEP_PLAYED_COOKIE_SOURCE = `function keepPlayedCookie(list) {
  document.cookie = (location.protocol === "https:" ? "__Host-" : "") + ${JSON.stringify(PLAYED_COOKIE)} + "=" + list.slice(0, 20).map((entry) => entry.slug).join(",") + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
}`;

/**
 * The home's script. The server puts the player's own part on the page from what it knows (an account's list, PLAYED_COOKIE, CLOSED_NEWS_COOKIE); this
 * keeps what's closed on this device, and catches the one case the server can't see: a device that played before the cookie kept it.
 */
export const HOME_SCRIPT = pageScript("home", String.raw`(() => {
const $ = (id) => document.getElementById(id);
const CLOSED_KEY = "zaisma:closed-news";
/* ---- Zaisma's event: shown as it is from the first paint; closing it keeps it closed on this device, in the cookie and here. ---- */
let closed = [];
try { closed = JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]"); } catch {}
const remember = (id) => {
  closed = [id, ...closed.filter((each) => each !== id)].slice(0, 20);
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(closed)); } catch {}
  document.cookie = (location.protocol === "https:" ? "__Host-" : "") + ${JSON.stringify(CLOSED_NEWS_COOKIE)} + "=" + closed.join(",") + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
};
const part = $("home-event");
if (part) {
  const id = part.querySelector("[data-announcement-id]").dataset.announcementId;
  // Closed on this device before the cookie kept it: closed again, and kept there from now on.
  if (!part.hidden && closed.includes(id)) { part.hidden = true; remember(id); }
  const close = part.querySelector('button[name="banner_close"]');
  if (close) close.addEventListener("click", () => { part.hidden = true; remember(id); });
}
${DEVICE_KIND_SOURCE}
zaismaDeviceKind();
/* ---- Played here before the cookie kept it: kept there from now on, and the page opened again once with it. ---- */
${KEEP_PLAYED_COOKIE_SOURCE}
const data = $("home-data");
if (!data || JSON.parse(data.textContent).is_signed_in || !$("home-first-visit") || document.cookie.includes(${JSON.stringify(PLAYED_COOKIE)})) return;
let played = [];
try { played = JSON.parse(localStorage.getItem("zaisma:played") || "[]"); } catch {}
if (!played.length) return;
keepPlayedCookie([...played].sort((first, second) => second.played_at_ms - first.played_at_ms));
if (document.cookie.includes(${JSON.stringify(PLAYED_COOKIE)})) location.reload();
})();`);
