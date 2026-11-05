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
 * The home's script. The page is the same for everyone (so it caches); this puts the player's own part on it (Continue playing and which
 * opening shows, whether Zaisma's news was closed here) and moves the one cover lifted: its foot lit, its Play and Details showing.
 *
 * A pointer, the keys and a controller all move it, and a cover the pointer leaves keeps it. Covers that slide under a still pointer (a row or
 * the page scrolling) don't count. A touch screen, with nothing to point, lifts nothing by a tap: a tap on a cover is its link.
 * Popular, Trending and New put the games made for this device first (each part keeping its order), and the device is kept for Browse.
 * The data it reads comes in the page's home-data block.
 */
export const HOME_SCRIPT = pageScript("home", String.raw`(() => {
const $ = (id) => document.getElementById(id);
const NEWS_KEY = "zaisma:closed-news";
/* ---- Zaisma's news: the page shows it as it is from its first paint (home.ts, by CLOSED_NEWS_COOKIE); closing it keeps it closed on this device, in the cookie and here ---- */
const news = $("home-news");
if (news) {
  const id = news.querySelector("[data-announcement-id]").dataset.announcementId;
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem(NEWS_KEY) || "[]"); } catch {}
  const remember = () => {
    closed = [id, ...closed.filter((each) => each !== id)].slice(0, 20);
    try { localStorage.setItem(NEWS_KEY, JSON.stringify(closed)); } catch {}
    document.cookie = (location.protocol === "https:" ? "__Host-" : "") + ${JSON.stringify(CLOSED_NEWS_COOKIE)} + "=" + closed.join(",") + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  };
  // Closed on this device before the cookie kept it: closed again, and kept there from now on.
  if (!news.hidden && closed.includes(id)) { news.hidden = true; remember(); }
  const close = news.querySelector('button[name="banner_close"]');
  if (close) close.addEventListener("click", () => { news.hidden = true; remember(); });
}
const shelf = $("home-games");
if (!shelf) return;
${DEVICE_KIND_SOURCE}
const DEVICE_KIND = zaismaDeviceKind();
const DATA = JSON.parse($("home-data").textContent);
const GAMES = DATA.games;
// A picture Zaisma serves (/img/<id>) at the sizes it keeps (SIZED_IMAGE_WIDTHS_PX), up to largestPx, for the browser to pick the one it shows.
const SIZES = ${JSON.stringify([...SIZED_IMAGE_WIDTHS_PX])};
function sizedSet(url, largestPx) { return /^\/img\/[A-Za-z0-9_-]+$/.test(url || "") ? SIZES.filter((widthPx) => widthPx <= largestPx).map((widthPx) => url + "/w" + widthPx + ".webp " + widthPx + "w").join(", ") : ""; }
const bySlug = Object.fromEntries(GAMES.map((game) => [game.slug, game]));
const PLAYED_KEY = "zaisma:played";
const isReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isSignedIn = /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
function make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function iconNode(markup) { const holder = make("span"); holder.innerHTML = markup; return holder.firstElementChild; }

/* ---- What this device and account have played ---- */
let played = [];
try { played = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]").map((entry) => ({ slug: entry.slug, played_at_ms: entry.played_at_ms ?? entry.at })); } catch {}
const playedList = () => played.filter((entry) => bySlug[entry.slug]).sort((a, b) => b.played_at_ms - a.played_at_ms);

/* ---- The one cover lifted ---- */
let liftedCover = shelf.querySelector('.cover[aria-current="true"]');
function liftCover(cover) {
  if (cover === liftedCover) return;
  if (liftedCover) liftedCover.removeAttribute("aria-current");
  liftedCover = cover;
  if (cover) cover.setAttribute("aria-current", "true");
}

/* ---- Covers ---- */
// The same markup as components/panes.ts's gameCard: the art in its well, its foot's edge light in the game's tint, Updated in its top left
// corner (a game played before its last big update, in Continue playing), its line (its title and players now), and Play and Details under it.
function coverFor(game, list, at) {
  const cover = make("div", "cover"), art = make("a", "cover-art carving holds-art");
  const isUpdated = list === "continue" && game.big_update_at_ms && game.big_update_at_ms > at;
  cover.dataset.slug = game.slug;
  if (/^#[0-9a-fA-F]{6}$/.test(game.glass_tint_color || "")) { cover.classList.add("has-tint"); cover.style.setProperty("--card-tint", game.glass_tint_color); }
  art.href = "/g/" + game.slug; art.setAttribute("data-cut-line", "0"); art.setAttribute("data-edge-light", "bottom"); art.setAttribute("data-lights", ""); art.setAttribute("aria-label", game.title + (isUpdated ? ", updated" : "")); art.append(iconNode(DATA.parts.cut_line));
  // The picture, or for a game with none, Zaisma's mark in the well.
  if (game.cover) {
    const image = make("img");
    const set = sizedSet(game.cover, 960); if (set) { image.srcset = set; image.sizes = "(max-width: 760px) 200px, 260px"; }
    image.src = game.cover; image.alt = ""; image.loading = "lazy"; image.decoding = "async";
    const picture = make("span", "cover-picture carving-art"); picture.setAttribute("data-cut-line", "0");
    picture.append(image); art.append(picture);
  } else cover.classList.add("is-placeholder");
  const light = make("span", "edge-light"); light.setAttribute("aria-hidden", "true"); art.append(light);
  if (isUpdated) { const mark = make("span", "cover-mark at-news"); mark.append(iconNode(DATA.parts.updated_tag)); art.append(mark); }
  const meta = make("div", "cover-meta");
  meta.append(make("span", "cover-name one-line", game.title));
  if (game.playing_now_player_count >= DATA.minimum_playing_now_player_count) {
    const count = make("span", "count"), words = make("span", "", game.playing_now_player_count.toLocaleString("en-US")); words.append(make("span", "sr", " playing now"));
    count.append(iconNode(DATA.icons.people), words); meta.append(count);
  }
  const actions = iconNode(DATA.parts.cover_actions), [play, details] = actions.querySelectorAll("a");
  play.href = "/g/" + game.slug + "?play"; details.href = "/g/" + game.slug;
  cover.append(art, meta, actions);
  return cover;
}
const continueTrack = $("track-continue");
let sort = "played";
function fillContinue() {
  const list = playedList();
  if (sort === "updated") list.sort((a, b) => (bySlug[b.slug].big_update_at_ms || 0) - (bySlug[a.slug].big_update_at_ms || 0));
  // What the page already shows (an account's, from the server) stays as it is.
  const shown = Array.from(continueTrack.querySelectorAll(".cover")).map((cover) => cover.dataset.slug);
  if (list.length && shown.join(" ") !== list.map((entry) => entry.slug).join(" ")) {
    const liftedSlug = liftedCover && continueTrack.contains(liftedCover) ? liftedCover.dataset.slug : "";
    const covers = list.map((entry) => coverFor(bySlug[entry.slug], "continue", entry.played_at_ms));
    continueTrack.replaceChildren(...covers);
    if (liftedSlug) { liftedCover = null; liftCover(covers.find((cover) => cover.dataset.slug === liftedSlug) || covers[0]); }
  }
  showOpening();
}
// Anything to continue: Continue playing, the game played last lifted, in place of the first visit's row.
function showOpening() {
  const first = continueTrack.querySelector(".cover");
  $("home-returning").hidden = !first;
  $("home-first-visit").hidden = Boolean(first);
  if (first && (!liftedCover || !liftedCover.offsetParent)) liftCover(first);
}
document.querySelectorAll("#home-returning .tab-switch button").forEach((button) => button.addEventListener("click", () => { sort = button.value; fillContinue(); }));
// Server-rendered covers carry their game in the address.
shelf.querySelectorAll(".cover").forEach((cover) => { const art = cover.querySelector(".cover-art"); if (art) cover.dataset.slug = art.getAttribute("href").slice(3); });
// Games made for this device first on every shelf; a game that names no devices fits them all.
["track-popular", "track-trending", "track-new"].forEach((id) => {
  const track = $(id);
  if (!track) return;
  const fits = (item) => { const cover = item.matches("[data-slug]") ? item : item.querySelector("[data-slug]"); const game = cover && bySlug[cover.dataset.slug]; return !game || !game.devices.length || game.devices.includes(DEVICE_KIND); };
  const items = Array.from(track.children), ordered = [...items.filter(fits), ...items.filter((item) => !fits(item))];
  // The server puts them in this device's order already; moving a cover anyway would play its picture's arrival again.
  if (ordered.some((item, index) => item !== items[index])) track.replaceChildren(...ordered);
});

/* ---- Moving the lift ---- */
let lastScrollMs = 0;
document.addEventListener("scroll", () => { lastScrollMs = performance.now(); }, { passive: true, capture: true });
shelf.addEventListener("pointermove", (event) => {
  const cover = event.target.closest && event.target.closest(".cover");
  if (!cover || event.pointerType === "touch" || cover === liftedCover) return;
  if (!event.movementX && !event.movementY && performance.now() - lastScrollMs < 300) return;
  liftCover(cover);
});
shelf.addEventListener("focusin", (event) => { const cover = event.target.closest && event.target.closest(".cover"); if (cover) liftCover(cover); });
// Keys and a controller move between covers like a console: along a row, or to the nearest cover in the row above or below.
function moveFromCover(fromCover, direction) {
  const covers = Array.prototype.filter.call(shelf.querySelectorAll(".cover-art"), (each) => each.offsetParent);
  const fromArt = fromCover.querySelector(".cover-art"), origin = fromArt.getBoundingClientRect(), originX = origin.left + origin.width / 2;
  let best = null, bestScore = Infinity;
  covers.forEach((each) => {
    if (each === fromArt) return;
    const box = each.getBoundingClientRect(), dy = box.top - origin.top, dx = box.left + box.width / 2 - originX;
    let score;
    if (direction === "right") { if (Math.abs(dy) > 8 || dx <= 0) return; score = dx; }
    else if (direction === "left") { if (Math.abs(dy) > 8 || dx >= 0) return; score = -dx; }
    else if (direction === "down") { if (dy <= 8) return; score = dy * 4 + Math.abs(dx); }
    else { if (dy >= -8) return; score = -dy * 4 + Math.abs(dx); }
    if (score < bestScore) { bestScore = score; best = each; }
  });
  if (best) { liftCover(best.closest(".cover")); best.focus({ preventScroll: true }); best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: isReduced ? "auto" : "smooth" }); }
  return Boolean(best);
}
const KEY_DIRECTIONS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
document.addEventListener("keydown", (event) => {
  const direction = KEY_DIRECTIONS[event.key], from = document.activeElement, cover = from && from.closest && from.closest("#home-games .cover");
  if (direction && cover && moveFromCover(cover, direction)) event.preventDefault();
});

/* ---- A controller: read only while one is connected ---- */
const STICK_LEAN = 0.5, FIRST_REPEAT_MS = 360, NEXT_REPEAT_MS = 160;
const A_BUTTON = 0, START_BUTTON = 9, PAD_DIRECTIONS = { 12: "up", 13: "down", 14: "left", 15: "right" };
let connectedPadCount = 0, padFrame = 0, heldDirection = "", nextMoveMs = 0, isAHeld = false, isStartHeld = false;
function padDirection(pad) {
  for (const [button, direction] of Object.entries(PAD_DIRECTIONS)) if (pad.buttons[button] && pad.buttons[button].pressed) return direction;
  const [acrossAxis = 0, downAxis = 0] = pad.axes;
  if (Math.abs(acrossAxis) < STICK_LEAN && Math.abs(downAxis) < STICK_LEAN) return "";
  return Math.abs(acrossAxis) > Math.abs(downAxis) ? (acrossAxis > 0 ? "right" : "left") : (downAxis > 0 ? "down" : "up");
}
const shownLift = () => (liftedCover && liftedCover.offsetParent ? liftedCover : null);
function readPad(nowMs) {
  padFrame = requestAnimationFrame(readPad);
  const pad = Array.from(navigator.getGamepads()).find(Boolean);
  // A sheet over the page, or the tab out of sight: it isn't the page's to answer.
  if (!pad || document.hidden || document.querySelector("dialog[open]")) { heldDirection = ""; return; }
  const direction = padDirection(pad);
  if (direction !== heldDirection) { heldDirection = direction; nextMoveMs = 0; }
  if (direction && nowMs >= nextMoveMs) {
    const isFirstMove = !nextMoveMs;
    nextMoveMs = nowMs + (isFirstMove ? FIRST_REPEAT_MS : NEXT_REPEAT_MS);
    if (shownLift()) moveFromCover(liftedCover, direction);
    else { const first = Array.prototype.find.call(shelf.querySelectorAll(".cover"), (cover) => cover.offsetParent); if (first) { liftCover(first); first.querySelector(".cover-art").focus(); } }
  }
  const isAPressed = Boolean(pad.buttons[A_BUTTON] && pad.buttons[A_BUTTON].pressed), isStartPressed = Boolean(pad.buttons[START_BUTTON] && pad.buttons[START_BUTTON].pressed);
  // A opens the game's page; only Play starts a game.
  if (isAPressed && !isAHeld && shownLift()) liftedCover.querySelector(".cover-art").click();
  if (isStartPressed && !isStartHeld && shownLift()) liftedCover.querySelector(".cover-actions a").click();
  isAHeld = isAPressed; isStartHeld = isStartPressed;
}
addEventListener("gamepadconnected", () => { connectedPadCount++; if (!padFrame) padFrame = requestAnimationFrame(readPad); });
addEventListener("gamepaddisconnected", () => { connectedPadCount = Math.max(0, connectedPadCount - 1); if (!connectedPadCount) { cancelAnimationFrame(padFrame); padFrame = 0; } });

/* ---- Starting up ---- */
fillContinue();
// Played on this device before the cookie kept it: kept there from now on, so the next visit's first paint shows it.
${KEEP_PLAYED_COOKIE_SOURCE}
keepPlayedCookie([...played].sort((a, b) => b.played_at_ms - a.played_at_ms));
if (isSignedIn) {
  fetch("/api/me/played").then((response) => (response.ok ? response.json() : null)).then((answer) => {
    if (!answer) return;
    const merged = new Map(played.map((entry) => [entry.slug, entry.played_at_ms]));
    for (const entry of answer.played) merged.set(entry.slug, Math.max(merged.get(entry.slug) || 0, entry.played_at_ms));
    played = [...merged].map(([slug, played_at_ms]) => ({ slug, played_at_ms }));
    fillContinue();
  }).catch(() => {});
}
})();`);
