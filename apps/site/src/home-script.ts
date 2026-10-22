import { pageScript } from "./page-scripts.ts";

/**
 * The home's script. The page is the same for everyone (so it caches); this puts the player's own part on it and makes the game in
 * focus the page's centre: its words in the pane, its background behind the glass.
 *
 * Focus: pointing at or focusing a cover makes that game the one in focus. The pane's words change at once; the background changes
 * at most every 0.6 s, as a fade, to the latest game, so a quick sweep across a row never flashes. Covers that slide under a still
 * pointer (a row or the page scrolling) don't take focus. Signed in or not, a device that has played something opens on the game
 * played last; otherwise a guest's visit opens on one of Popular's top 8, drawn here so the page stays one cached copy.
 *
 * Backgrounds: Zaisma's own is the page's backdrop canvas (components/backdrop-script.ts); a game's picture or shader is a layer
 * added over it (zaismaBackdrop.add) that fades in and then takes the old one's place. The glass is measured from the new layer's
 * still by the backdrop script, so it follows the background; going back to Zaisma's own lets the glass go back to the theme's.
 *
 * Play: the game starts in place. The page's own game page (/g/<slug>?play) opens in a frame over the home, so counting, Turnstile,
 * saves, rooms, sign-in and the game bar are exactly the game page's, never a copy that could drift; the address becomes
 * /g/<slug>, and Back (the browser's, or the bar's Zaisma button, which the game page says through postMessage) takes the frame
 * away and leaves the home as it was. The data it reads comes in the page's home-data block.
 */
/**
 * Before the first paint, in the page's <head>: which game the home opens on (the one this device played last, then the one it was on
 * before a Play, then one of Popular's top 8 drawn at random), and, when that game's background has a measured tone, the page's color
 * and glass from it (html[data-home-glass], --home-tone, --home-glass-tint), so the page never opens light and then turns dark. The
 * home's script reads the choice from data-home-start. Its data is the home-opening block just before it.
 */
export const HOME_OPENING_SCRIPT = pageScript("home-opening", String.raw`(() => {
const DATA = JSON.parse(document.getElementById("home-opening").textContent), root = document.documentElement;
const known = new Set(DATA.slugs);
let slug = "";
try {
  const played = JSON.parse(localStorage.getItem("zaisma:played") || "[]").filter((entry) => known.has(entry.slug));
  played.sort((a, b) => (b.played_at_ms ?? b.at) - (a.played_at_ms ?? a.at));
  if (played.length) slug = played[0].slug;
} catch {}
if (!slug) { try { const remembered = sessionStorage.getItem("zaisma:home-focus") || ""; if (known.has(remembered)) slug = remembered; } catch {} }
if (!slug) {
  const picks = DATA.guest_picks.filter((each) => known.has(each)), pool = picks.length ? picks : DATA.slugs.slice(0, 8);
  slug = pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length] || "";
}
root.dataset.homeStart = slug;
// Staged: the game in focus centered over its world, until the page scrolls (the home's script takes it from here).
root.dataset.homeStaged = "";
const tones = DATA.tones[slug], tone = tones && (matchMedia("(max-width: 760px)").matches ? tones.phone : tones.wide);
if (tone) {
  root.dataset.homeGlass = tone.isGlassSmoked ? "smoked" : "light";
  root.style.setProperty("--home-tone", tone.averageColor);
  root.style.setProperty("--home-glass-tint", tone.glassTint);
}
})();`);

export const HOME_SCRIPT = pageScript("home", String.raw`(() => {
const DATA = JSON.parse(document.getElementById("home-data").textContent);
const GAMES = DATA.games;
if (!GAMES.length) return;
const bySlug = Object.fromEntries(GAMES.map((game) => [game.slug, game]));
const PLAYED_KEY = "zaisma:played", RETURN_KEY = "zaisma:home-focus";
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
const playedAt = (slug) => { const entry = played.find((each) => each.slug === slug); return entry ? entry.played_at_ms : 0; };

/* ---- The pane: the game in focus, at a glance ---- */
const pane = { head: $("home-head"), art: $("home-art"), title: $("home-title"), facts: $("home-facts"), glance: $("home-glance"), description: $("home-description"), box: $("home-pane"), more: $("home-more"), moreIn: $("home-more-in") };
const playLink = pane.box.querySelector("a.run-wrap"), detailsLink = pane.box.querySelector("a.cut-btn");
const playLabel = playLink.querySelector(".face > span:not([class])");
let focusSlug = "", hasChosen = false;

function glanceItem(kind, ...parts) { const item = make("li", kind); item.append(...parts); return item; }
function fillPane(game) {
  const at = playedAt(game.slug);
  pane.title.textContent = game.title;
  // Its cover is its face; without one, its title in words.
  pane.head.classList.toggle("has-cover", Boolean(game.cover));
  if (game.cover) pane.art.src = game.cover;
  pane.facts.textContent = [game.developer ? "by " + game.developer : "", game.modes].filter(Boolean).join(" · ");
  const items = [];
  if (game.playing_now_player_count >= DATA.minimum_playing_now_player_count) {
    const count = make("span"); const strong = make("b", "", game.playing_now_player_count.toLocaleString("en-US")); count.append(strong, " playing now");
    items.push(glanceItem("", iconNode(DATA.icons.people), count));
  }
  if (at) {
    items.push(glanceItem("", iconNode(DATA.icons.clock), make("span", "", "You played " + ago(at))));
    if (game.published_at_ms && game.published_at_ms > at) {
      const when = make("span"); when.append(ago(game.published_at_ms) + " · ");
      const link = make("a", "link", "What's new"); link.href = "/g/" + game.slug + "#updates"; when.append(link);
      items.push(glanceItem("", iconNode(DATA.parts.updated_tag), when));
    }
  }
  // The glance list is the component's own markup (ul.glance), rebuilt here for the game now in focus.
  const list = make("ul", "glance");
  list.append(...items);
  pane.glance.replaceChildren(...(items.length ? [list] : []));
  pane.description.textContent = game.description;
  pane.description.hidden = !game.description;
  playLabel.textContent = at ? "Continue" : "Play";
  playLink.href = "/g/" + game.slug + "?play";
  detailsLink.href = "/g/" + game.slug;
  measureMore();
}
function measureMore() { pane.box.style.setProperty("--more-h", pane.moreIn.offsetHeight + "px"); }
if (window.ResizeObserver) new ResizeObserver(measureMore).observe(pane.moreIn); else addEventListener("resize", measureMore);
// The window above the pane leaves the staged pane whole on screen (a phone's, or a wide screen's at the stage's width), with room for a
// cover (taller than any title in words), so Play is in view as the page opens on any screen; measured as it opens and when the window
// changes size, never as focus moves, so nothing shifts.
const home = pane.box.parentElement;
// The staged pane's width as the page's CSS has it (--stage-w), measured on a stand-in, since a docked pane isn't at it.
function stageWidthPx() {
  const probe = make("div"); probe.style.cssText = "position:absolute;visibility:hidden;width:var(--stage-w)";
  home.append(probe); const widthPx = probe.offsetWidth; probe.remove(); return widthPx;
}
function measureStage() {
  const openPx = pane.box.classList.contains("is-pane-open") ? pane.more.offsetHeight : 0;
  const stagedPx = isPhone() ? pane.box.offsetWidth : stageWidthPx();
  const coverPx = Math.max((stagedPx - (pane.box.offsetWidth - pane.head.clientWidth)) * 9 / 16, pane.head.offsetHeight);
  // On a wide screen the tray with "More games" sits under the staged pane, so it's kept on screen too (measured from what's on it,
  // since a docked pane's tray is tucked away).
  const trayPx = isPhone() ? 0 : cue.offsetHeight + 2 * (parseFloat(getComputedStyle(home).getPropertyValue("--gap-words-words")) || 8);
  home.style.setProperty("--home-pane-h", Math.ceil(pane.box.offsetHeight - stageTray.offsetHeight - openPx - pane.head.offsetHeight + coverPx + trayPx) + "px");
}
// Staged on a wide screen, the pane is a tray's head: square at its foot, the tray running on under it. Docked, or on a phone, the tray
// tucks away and the head is a whole pane again, cut at its foot.
const stageHead = pane.box.querySelector(".tray-head"), stageTray = pane.box.querySelector(".tray"), cue = pane.box.querySelector(".home-cue");
function showTray() {
  const isOn = "homeStaged" in root.dataset && !isPhone();
  home.classList.toggle("is-staged-wide", isOn);
  stageHead.setAttribute("data-glass-corners", isOn ? "24 20 0 0" : "24 20 24 20");
}
// "More games" takes the page to where the shelf docks beside the pane: the top of the shelf just under the header.
const cueLink = cue.querySelector("a");
if (cueLink) cueLink.addEventListener("click", (event) => {
  event.preventDefault();
  const headerRoomPx = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  scrollTo({ top: home.querySelector(".home-window").getBoundingClientRect().bottom + scrollY - headerRoomPx, behavior: isReduced ? "auto" : "smooth" });
});
addEventListener("resize", () => { showTray(); measureStage(); });

/* The pane opens when the page scrolls (wanting more) and shuts again back at the top, where Play and Details sit on the art. */
function openPane(shouldReveal) {
  const wasOpen = pane.box.classList.contains("is-pane-open");
  pane.box.classList.add("is-pane-open");
  delete root.dataset.homeStaged; showTray();
  if (!shouldReveal || isPhone()) return;
  const box = pane.box.getBoundingClientRect(), extra = wasOpen ? 0 : pane.moreIn.offsetHeight, over = box.bottom + extra + 16 - innerHeight;
  if (over > 0) scrollBy({ top: over, behavior: isReduced ? "auto" : "smooth" });
}
addEventListener("scroll", () => {
  if (scrollY > 24) openPane(false);
  else if (scrollY <= 0 && !pane.box.contains(document.activeElement)) { pane.box.classList.remove("is-pane-open"); root.dataset.homeStaged = ""; showTray(); }
}, { passive: true });
pane.box.addEventListener("focusin", (event) => { if (pane.moreIn.contains(event.target)) openPane(false); });

/* ---- The world behind the glass ---- */
const root = document.documentElement;
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
  const isFirst = !worldKey;
  worldSlug = slug;
  if (/^#[0-9a-fA-F]{6}$/.test(game.glass_tint_color || "")) root.style.setProperty("--glass-hue", game.glass_tint_color); else root.style.removeProperty("--glass-hue");
  if (key === worldKey) return;
  worldKey = key;
  // The page opens on the opening game's color (or its own plain one) and the first background fades in over it, Zaisma's or the game's,
  // so neither shows for a frame and is swapped. After that the glass follows each background the backdrop script shows.
  if (!isFirst) { delete root.dataset.homeGlass; root.style.removeProperty("--home-tone"); root.style.removeProperty("--home-glass-tint"); }
  const fadeMs = isReduced || (isInstant && !isFirst) ? 0 : 500;
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
    showWorld(slug, worldSlug === "");
  }, worldSlug === "" ? 0 : wait);
}
// The phone background and the wide one differ: crossing the width between them shows the other.
matchMedia("(max-width: 760px)").addEventListener("change", () => { if (focusSlug) { worldSlug = ""; queueWorld(focusSlug); } });

function setFocus(slug) {
  if (!bySlug[slug] || slug === focusSlug) return;
  focusSlug = slug;
  // Words first, this frame; then the background, once they are on screen.
  fillPane(bySlug[slug]);
  document.querySelectorAll(".home-shelf .cover").forEach((cover) => { if (cover.dataset.slug === slug) cover.setAttribute("aria-current", "true"); else cover.removeAttribute("aria-current"); });
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
document.querySelectorAll(".home-shelf .cover").forEach((cover) => { const art = cover.querySelector(".cover-art"); if (art) cover.dataset.slug = art.getAttribute("href").slice(3); });

/* Pointing rests for a moment before the pane and background follow, so sweeping across a row doesn't flash through games. */
let restTimer = 0, lastScrollMs = 0, isPending = false;
document.addEventListener("scroll", () => { lastScrollMs = performance.now(); }, { passive: true, capture: true });
const shelf = document.querySelector(".home-shelf");
shelf.addEventListener("pointermove", (event) => {
  const cover = event.target.closest && event.target.closest(".cover");
  if (!cover || event.pointerType === "touch" || cover.dataset.slug === focusSlug || isPending) return;
  if (!event.movementX && !event.movementY && performance.now() - lastScrollMs < 300) return;
  isPending = true; clearTimeout(restTimer);
  restTimer = setTimeout(() => { isPending = false; hasChosen = true; setFocus(cover.dataset.slug); }, 110);
});
shelf.addEventListener("pointerout", (event) => { if (event.target.closest && event.target.closest(".cover") && !(event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest(".cover") === event.target.closest(".cover"))) { isPending = false; clearTimeout(restTimer); } });
shelf.addEventListener("focusin", (event) => { const cover = event.target.closest && event.target.closest(".cover"); if (cover) { hasChosen = true; setFocus(cover.dataset.slug); } });
// A click or tap on a cover is its link: it opens the game's page (middle-click and new tabs work too). Hover and keys only move the focus.
// On a touch screen the row that comes to rest puts its first cover in focus.
if (matchMedia("(hover: none)").matches) {
  document.querySelectorAll(".home-track").forEach((track) => {
    let settle = 0;
    track.addEventListener("scroll", () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const left = track.getBoundingClientRect().left, first = Array.prototype.find.call(track.children, (cover) => cover.getBoundingClientRect().left >= left - 4);
        if (first) { hasChosen = true; setFocus(first.dataset.slug); }
      }, 150);
    }, { passive: true });
  });
}
// Arrow keys move between covers like a console: along a row, or to the nearest cover in the row above or below.
document.addEventListener("keydown", (event) => {
  const from = document.activeElement;
  if (!from || !from.classList.contains("cover-art") || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const covers = Array.prototype.filter.call(document.querySelectorAll(".home-shelf .cover-art"), (each) => each.offsetParent);
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

/* ---- Play: Zaisma steps aside and the game starts in place ---- */
let gameFrame = null;
function needsPage(game) { return !isSignedIn && game.account_requirement !== "none"; }
function openGame(game, shouldPush) {
  if (gameFrame) return;
  try { sessionStorage.setItem(RETURN_KEY, game.slug); } catch {}
  if (shouldPush) history.pushState({ zaismaPlaying: game.slug }, "", "/g/" + game.slug);
  const frame = make("iframe", "home-game");
  frame.title = game.title;
  frame.allow = "fullscreen; gamepad; autoplay; clipboard-write";
  frame.src = "/g/" + game.slug + "?play";
  frame.addEventListener("load", () => { document.body.classList.add("is-game-shown"); try { frame.contentWindow.focus(); } catch {} });
  document.body.append(frame);
  gameFrame = frame;
  document.body.classList.add("is-playing");
  // Friends see what the player is playing; the game page in the frame says it too.
  document.body.dataset.presenceGame = game.slug;
}
function closeGame() {
  if (!gameFrame) return;
  gameFrame.remove(); gameFrame = null;
  document.body.classList.remove("is-playing", "is-game-shown");
  delete document.body.dataset.presenceGame;
  playLink.focus({ preventScroll: true });
}
playLink.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const game = bySlug[focusSlug];
  if (!game || needsPage(game)) return;
  event.preventDefault();
  openGame(game, true);
});
addEventListener("popstate", (event) => {
  if (event.state && event.state.zaismaPlaying && bySlug[event.state.zaismaPlaying]) { if (!gameFrame) openGame(bySlug[event.state.zaismaPlaying], false); }
  else closeGame();
});
// The game page in the frame says when its Zaisma button is pressed, and when the game moves its address (a room's code).
addEventListener("message", (event) => {
  if (!gameFrame || event.origin !== location.origin || event.source !== gameFrame.contentWindow || !event.data) return;
  if (event.data.type === "zaisma:home-back") history.back();
  if (event.data.type === "zaisma:home-address" && typeof event.data.path === "string" && /^\/g\/[a-z0-9-]+(\?[A-Za-z0-9=&_.%-]*)?$/.test(event.data.path)) history.replaceState(history.state, "", event.data.path);
});
// Coming back to the home from a game after a reload of the home, the game played is the one in focus.
if (history.state && history.state.zaismaPlaying) history.replaceState(null, "", "/");

/* ---- Starting up ---- */
const guest = $("home-guest");
if (guest && !isSignedIn) guest.hidden = false;
fillContinue();
// The opening script chose it in the page's head, before the first paint.
setFocus(bySlug[root.dataset.homeStart] ? root.dataset.homeStart : GAMES[0].slug);
showTray();
measureStage();
// The opening script staged it; a page that opens scrolled down (a reload) starts docked instead.
if (scrollY > 24) openPane(false);
// Everything placed for the page as it opens is laid out before anything may glide, so nothing moves into place on the first frames.
void home.offsetHeight;
document.body.classList.add("is-home-ready");
if (isSignedIn) {
  fetch("/api/me/played").then((response) => (response.ok ? response.json() : null)).then((answer) => {
    if (!answer) return;
    const merged = new Map(played.map((entry) => [entry.slug, entry.played_at_ms]));
    for (const entry of answer.played) merged.set(entry.slug, Math.max(merged.get(entry.slug) || 0, entry.played_at_ms));
    played = [...merged].map(([slug, played_at_ms]) => ({ slug, played_at_ms }));
    fillContinue();
    // The account's newest game opens in focus, unless the player has already chosen one themselves.
    const newest = playedList()[0];
    if (newest && !hasChosen && newest.slug !== focusSlug) { focusSlug = ""; setFocus(newest.slug); } else fillPane(bySlug[focusSlug]);
  }).catch(() => {});
}
})();`);
