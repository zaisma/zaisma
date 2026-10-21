import { pageScript } from "./page-scripts.ts";

/**
 * A game's own background behind Zaisma's glass, for the pages that show one: the home while a game is in focus, and the game's page.
 * Zaisma's own is the page's backdrop canvas (components/backdrop-script.ts); a game's picture or shader (backgrounds.ts, ShownBackground)
 * is a layer added over it (zaismaBackdrop.add) that fades in once it's ready and then takes the old one's place. The glass is measured
 * from the new layer's still by the backdrop script, so it follows the background; going back to Zaisma's own lets the glass go back to
 * the theme's. The game's glass tint (--glass-hue) goes on the page with it.
 *
 * window.zaismaWorld:
 *   pick({ wide, phone })              the background this screen shows of a game's two, or Zaisma's own for none
 *   show(background, { glassTintColor, isInstant })  shows it, fading over 0.5 s unless isInstant; false when it's showing already
 *   clear()                            takes every game layer away at once and pauses Zaisma's own (the game page, once a game is playing)
 */
export const GAME_BACKGROUND_SCRIPT = pageScript("game-background", String.raw`(() => {
const root = document.documentElement;
const defaultBackdrop = document.querySelector("canvas.backdrop[data-backdrop]");
const isReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => matchMedia("(max-width: 760px)").matches;
let shownKey = "", layers = [];
root.classList.add("eases-settings");
function make(tag) { const node = document.createElement(tag); node.className = "backdrop game-world"; return node; }
function layerFor(background) {
  const layer = make(background.source === "image" ? "img" : "iframe");
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
function forget(layer) {
  if (window.zaismaBackdrop) window.zaismaBackdrop.remove(layer);
  layer.remove();
}
function dropLayers(keep) {
  layers = layers.filter((layer) => {
    if (layer === keep) return true;
    forget(layer);
    return false;
  });
}
function show(background, options) {
  const key = background.source + "|" + (background.imageUrl || background.frameUrl || "");
  if (options.glassTintColor) root.style.setProperty("--glass-hue", options.glassTintColor); else root.style.removeProperty("--glass-hue");
  if (key === shownKey) return false;
  shownKey = key;
  const fadeMs = options.isInstant || isReduced ? 0 : 500;
  if (background.source === "zaisma") {
    // Back to Zaisma's own: the game's layer fades out over its canvas, which draws again, and the glass goes back to the theme's.
    if (defaultBackdrop) { defaultBackdrop.removeAttribute("data-backdrop-paused"); defaultBackdrop.classList.add("is-shown"); }
    if (window.zaismaBackdrop) window.zaismaBackdrop.forgetGlass();
    layers.forEach((layer) => { layer.style.transitionDuration = fadeMs + "ms"; layer.classList.remove("is-shown"); });
    const leaving = layers.slice();
    setTimeout(() => { if (shownKey !== key) return; leaving.forEach(forget); layers = layers.filter((layer) => !leaving.includes(layer)); }, fadeMs + 80);
    return true;
  }
  const layer = layerFor(background);
  layer.style.transitionDuration = fadeMs + "ms";
  document.body.append(layer);
  layers.push(layer);
  if (window.zaismaBackdrop) window.zaismaBackdrop.add(layer);
  let isShown = false;
  const reveal = () => {
    if (isShown || shownKey !== key) return;
    isShown = true;
    void layer.offsetWidth;
    layer.classList.add("is-shown");
    // The old layers stay whole underneath until this one has fully faded in, so nothing shows through halfway.
    setTimeout(() => {
      if (shownKey !== key) return;
      dropLayers(layer);
      // Zaisma's own waits shown underneath (a page may start it unseen, as the home does), so going back to it is only the game's fading out.
      if (defaultBackdrop) { defaultBackdrop.setAttribute("data-backdrop-paused", ""); defaultBackdrop.classList.add("is-shown"); }
    }, fadeMs + 80);
  };
  if (background.source === "image") {
    if (layer.complete && layer.naturalWidth) reveal();
    else { layer.addEventListener("load", reveal); layer.addEventListener("error", () => { shownKey = ""; layers = layers.filter((each) => each !== layer); forget(layer); }); }
  } else {
    // A shader's frame says when it's drawing; if it never does (no WebGL, an error) its still carries the glass and the frame shows the still.
    const onMessage = (event) => { if (event.source === layer.contentWindow && event.data && event.data.zaismaBackground && (event.data.isRunning || event.data.error)) { removeEventListener("message", onMessage); reveal(); } };
    addEventListener("message", onMessage);
    setTimeout(() => { removeEventListener("message", onMessage); reveal(); }, 3000);
  }
  return true;
}
window.zaismaWorld = {
  pick: (pair) => (pair ? (isPhone() ? pair.phone : pair.wide) : { source: "zaisma" }),
  show,
  clear: () => {
    shownKey = "";
    dropLayers(null);
    if (defaultBackdrop) defaultBackdrop.setAttribute("data-backdrop-paused", "");
  },
};
})();`);
