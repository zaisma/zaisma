import { pageScript } from "./page-scripts.ts";

/**
 * The home's script. The page is the same for everyone (so it caches); this puts the player's own part on it (the guest note, Continue
 * playing, whether Zaisma's news was closed here) and puts the background of the cover pointed at behind the glass.
 *
 * Backgrounds: the page opens on Zaisma's own, the page's backdrop canvas (components/backdrop-script.ts). Pointing at or focusing a
 * cover fades that game's picture or shader in as a layer over it (zaismaBackdrop.add), at most every 0.6 s, to the latest game, so a
 * quick sweep across a row never flashes; it stays until another cover is pointed at. Covers that slide under a still pointer (a row or
 * the page scrolling) don't count. The glass is measured from the new layer's still by the backdrop script, so it follows the background.
 * The data it reads comes in the page's home-data block.
 */
export const HOME_SCRIPT = pageScript("home", String.raw`(() => {
const DATA = JSON.parse(document.getElementById("home-data").textContent);
const GAMES = DATA.games;
if (!GAMES.length) return;
const bySlug = Object.fromEntries(GAMES.map((game) => [game.slug, game]));
const PLAYED_KEY = "zaisma:played", NEWS_KEY = "zaisma:closed-news";
const isReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => matchMedia("(max-width: 760px)").matches;
const isSignedIn = /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
const $ = (id) => document.getElementById(id);
function make(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function iconNode(markup) { const holder = make("span"); holder.innerHTML = markup; return holder.firstElementChild; }
function ago(ms) {
  const minutes = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (minutes < 60) return minutes + " min ago";
  if (minutes < 1440) return Math.round(minutes / 60) + " h ago";
  const days = Math.round(minutes / 1440);
  return days === 1 ? "yesterday" : days + " days ago";
}

/* ---- What this device and account have played ---- */
let played = [];
try { played = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]").map((entry) => ({ slug: entry.slug, played_at_ms: entry.played_at_ms ?? entry.at })); } catch {}
const playedList = () => played.filter((entry) => bySlug[entry.slug]).sort((a, b) => b.played_at_ms - a.played_at_ms);

/* ---- The world behind the glass ---- */
const root = document.documentElement;
let focusSlug = "";
const defaultBackdrop = document.querySelector("canvas.backdrop[data-backdrop]");
let worldSlug = "", worldKey = "", layers = [], swapTimer = 0, lastSwapMs = -1e9, lastFadeMs = 0;
root.classList.add("eases-settings");
function backgroundOf(game) {
  const own = game.background;
  return own ? (isPhone() ? own.phone : own.wide) : { source: "zaisma" };
}
function layerFor(background) {
  const layer = background.source === "image" ? make("img", "backdrop home-world") : make("iframe", "backdrop home-world");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-adapts-glass", "");
  // Its measured tone says its glass, so the backdrop script needn't measure it (backgrounds.ts's backgroundMarkup does the same).
  if (background.tone) { layer.setAttribute("data-glass-kind", background.tone.isGlassSmoked ? "smoked" : "light"); layer.setAttribute("data-glass-tint", background.tone.glassTint); }
  if (background.source === "image") {
    layer.setAttribute("data-backdrop", "picture"); layer.alt = ""; layer.decoding = "async"; layer.src = background.imageUrl;
  } else {
    layer.setAttribute("data-backdrop", "frame"); layer.setAttribute("data-backdrop-still", background.stillUrl);
    layer.setAttribute("sandbox", "allow-scripts allow-same-origin"); layer.setAttribute("loading", "eager"); layer.tabIndex = -1; layer.title = "Background"; layer.src = background.frameUrl;
  }
  return layer;
}
function dropLayers(keep) {
  layers = layers.filter((layer) => {
    if (layer === keep) return true;
    if (window.zaismaBackdrop) window.zaismaBackdrop.remove(layer);
    layer.remove();
    return false;
  });
}
function showWorld(slug, isInstant) {
  const game = bySlug[slug], background = backgroundOf(game);
  const key = background.source + "|" + (background.imageUrl || background.frameUrl || "");
  worldSlug = slug;
  if (/^#[0-9a-fA-F]{6}$/.test(game.glass_tint_color || "")) root.style.setProperty("--glass-hue", game.glass_tint_color); else root.style.removeProperty("--glass-hue");
  if (key === worldKey) return;
  worldKey = key;
  const fadeMs = isReduced || isInstant ? 0 : 500;
  lastFadeMs = fadeMs;
  if (background.source === "zaisma") {
    // Back to Zaisma's own: the game's layer fades out over its canvas, which draws again, and the glass goes back to the theme's.
    if (defaultBackdrop) { defaultBackdrop.removeAttribute("data-backdrop-paused"); defaultBackdrop.classList.add("is-shown"); }
    if (window.zaismaBackdrop) window.zaismaBackdrop.forgetGlass();
    layers.forEach((layer) => { layer.style.transitionDuration = fadeMs + "ms"; layer.classList.remove("is-shown"); });
    const leaving = layers.slice();
    setTimeout(() => { if (worldKey !== key) return; leaving.forEach((layer) => { if (window.zaismaBackdrop) window.zaismaBackdrop.remove(layer); layer.remove(); }); layers = layers.filter((layer) => !leaving.includes(layer)); }, fadeMs + 80);
    return;
  }
  const layer = layerFor(background);
  layer.style.transitionDuration = fadeMs + "ms";
  document.body.append(layer);
  layers.push(layer);
  if (window.zaismaBackdrop) window.zaismaBackdrop.add(layer);
  let isShown = false;
  const reveal = () => {
    if (isShown || worldKey !== key) return;
    isShown = true;
    void layer.offsetWidth;
    layer.classList.add("is-shown");
    // The old layers stay whole underneath until this one has fully faded in, so nothing shows through halfway.
    setTimeout(() => {
      if (worldKey !== key) return;
      dropLayers(layer);
      // Zaisma's own waits shown underneath, so going back to it is only the game's fading out.
      if (defaultBackdrop) { defaultBackdrop.setAttribute("data-backdrop-paused", ""); defaultBackdrop.classList.add("is-shown"); }
    }, fadeMs + 80);
  };
  if (background.source === "image") {
    if (layer.complete && layer.naturalWidth) reveal(); else { layer.addEventListener("load", reveal); layer.addEventListener("error", () => { worldKey = ""; layer.remove(); layers = layers.filter((each) => each !== layer); if (window.zaismaBackdrop) window.zaismaBackdrop.remove(layer); }); }
  } else {
    // A shader's frame says when it's drawing; if it never does (no WebGL, an error) its still carries the glass and the frame shows the still.
    const onMessage = (event) => { if (event.source === layer.contentWindow && event.data && event.data.zaismaBackground && (event.data.isRunning || event.data.error)) { removeEventListener("message", onMessage); reveal(); } };
    addEventListener("message", onMessage);
    setTimeout(() => { removeEventListener("message", onMessage); reveal(); }, 3000);
  }
}
function queueWorld(slug) {
  clearTimeout(swapTimer);
  const wait = Math.max(0, Math.max(600, lastFadeMs + 100) - (performance.now() - lastSwapMs));
  swapTimer = setTimeout(() => {
    if (focusSlug !== slug || (worldSlug === slug && worldKey)) return;
    lastSwapMs = performance.now();
    showWorld(slug, false);
  }, wait);
}
// The phone background and the wide one differ: crossing the width between them shows the other.
matchMedia("(max-width: 760px)").addEventListener("change", () => { if (focusSlug) { worldSlug = ""; queueWorld(focusSlug); } });

function setFocus(slug) {
  if (!bySlug[slug] || slug === focusSlug) return;
  focusSlug = slug;
  document.querySelectorAll(".home .cover").forEach((cover) => { if (cover.dataset.slug === slug) cover.setAttribute("aria-current", "true"); else cover.removeAttribute("aria-current"); });
  queueWorld(slug);
}

/* ---- Covers ---- */
function coverFacts(game, list, at) {
  const meta = make("div", "cover-meta");
  if (list === "continue") {
    const when = make("span", "when"), words = make("span"), played = make("span", "sr", "Played ");
    words.append(played, ago(at)); when.append(iconNode(DATA.icons.clock), words); meta.append(when);
    if (game.published_at_ms && game.published_at_ms > at) meta.append(iconNode(DATA.parts.updated_tag));
  }
  if (game.playing_now_player_count >= DATA.minimum_playing_now_player_count) {
    const count = make("span", "count"), words = make("span", "", game.playing_now_player_count.toLocaleString("en-US")); words.append(make("span", "sr", " playing now"));
    count.append(iconNode(DATA.icons.people), words); meta.append(count);
  }
  return meta;
}
// The same markup as components/panes.ts's gameCover.
function coverFor(game, list, at) {
  const cover = make("div", "cover"), art = make("a", "cover-art"), image = make("img");
  const isUpdated = list === "continue" && game.published_at_ms && game.published_at_ms > at;
  cover.dataset.slug = game.slug;
  art.href = "/g/" + game.slug; art.setAttribute("data-cut-line", "0"); art.setAttribute("aria-label", game.title + (isUpdated ? ", updated" : ""));
  image.src = game.cover || DATA.placeholder_cover; image.alt = ""; image.loading = "lazy"; image.decoding = "async";
  if (!game.cover) cover.classList.add("is-placeholder");
  art.append(image);
  const bar = make("span", "cover-bar"); bar.setAttribute("aria-hidden", "true");
  cover.append(art, bar, coverFacts(game, list, at));
  if (game.slug === focusSlug) cover.setAttribute("aria-current", "true");
  return cover;
}
let sort = "played";
function fillContinue() {
  const row = $("home-continue"), list = playedList();
  row.hidden = !list.length;
  if (!list.length) return;
  if (sort === "updated") list.sort((a, b) => (bySlug[b.slug].published_at_ms || 0) - (bySlug[a.slug].published_at_ms || 0));
  $("track-continue").replaceChildren(...list.map((entry) => coverFor(bySlug[entry.slug], "continue", entry.played_at_ms)));
  document.querySelectorAll("#home-continue [data-slug]").forEach((cover) => cover.dataset.slug === focusSlug && cover.setAttribute("aria-current", "true"));
}
document.querySelectorAll("#home-continue .tab-switch button").forEach((button) => button.addEventListener("click", () => { sort = button.value; fillContinue(); }));
// Server-rendered covers carry their game in the address; the focus follows the pointer and the keys from here.
document.querySelectorAll(".home .cover").forEach((cover) => { const art = cover.querySelector(".cover-art"); if (art) cover.dataset.slug = art.getAttribute("href").slice(3); });

/* Pointing rests for a moment before the background follows, so sweeping across a row doesn't flash through games. */
let restTimer = 0, lastScrollMs = 0, isPending = false;
document.addEventListener("scroll", () => { lastScrollMs = performance.now(); }, { passive: true, capture: true });
const shelf = document.querySelector(".home");
shelf.addEventListener("pointermove", (event) => {
  const cover = event.target.closest && event.target.closest(".cover");
  if (!cover || event.pointerType === "touch" || cover.dataset.slug === focusSlug || isPending) return;
  if (!event.movementX && !event.movementY && performance.now() - lastScrollMs < 300) return;
  isPending = true; clearTimeout(restTimer);
  restTimer = setTimeout(() => { isPending = false; setFocus(cover.dataset.slug); }, 110);
});
shelf.addEventListener("pointerout", (event) => { if (event.target.closest && event.target.closest(".cover") && !(event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest(".cover") === event.target.closest(".cover"))) { isPending = false; clearTimeout(restTimer); } });
shelf.addEventListener("focusin", (event) => { const cover = event.target.closest && event.target.closest(".cover"); if (cover) setFocus(cover.dataset.slug); });
// A click or tap on a cover is its link: it opens the game's page (middle-click and new tabs work too). Pointing and keys only move the
// background; a touch screen, with nothing to point, keeps Zaisma's own.
// Arrow keys move between covers like a console: along a row, or to the nearest cover in the row above or below.
document.addEventListener("keydown", (event) => {
  const from = document.activeElement;
  if (!from || !from.classList.contains("cover-art") || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const covers = Array.prototype.filter.call(document.querySelectorAll(".home .cover-art"), (each) => each.offsetParent);
  const origin = from.getBoundingClientRect(), originX = origin.left + origin.width / 2;
  let best = null, bestScore = Infinity;
  covers.forEach((each) => {
    if (each === from) return;
    const box = each.getBoundingClientRect(), dy = box.top - origin.top, dx = box.left + box.width / 2 - originX;
    let score;
    if (event.key === "ArrowRight") { if (Math.abs(dy) > 8 || dx <= 0) return; score = dx; }
    else if (event.key === "ArrowLeft") { if (Math.abs(dy) > 8 || dx >= 0) return; score = -dx; }
    else if (event.key === "ArrowDown") { if (dy <= 8) return; score = dy * 4 + Math.abs(dx); }
    else { if (dy >= -8) return; score = -dy * 4 + Math.abs(dx); }
    if (score < bestScore) { bestScore = score; best = each; }
  });
  if (best) { event.preventDefault(); best.focus({ preventScroll: true }); best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: isReduced ? "auto" : "smooth" }); }
});

/* ---- Starting up ---- */
const guest = $("home-guest");
if (guest && !isSignedIn) guest.hidden = false;
fillContinue();
// Zaisma's news shows until this device closes it; closing remembers it, so it never comes back here.
const news = $("home-news");
if (news) {
  const id = news.dataset.announcementId;
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem(NEWS_KEY) || "[]"); } catch {}
  if (!closed.includes(id)) news.hidden = false;
  const close = news.querySelector(".banner-close button");
  if (close) close.addEventListener("click", () => {
    news.hidden = true;
    try { localStorage.setItem(NEWS_KEY, JSON.stringify([id, ...closed.filter((each) => each !== id)].slice(0, 20))); } catch {}
  });
}
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
