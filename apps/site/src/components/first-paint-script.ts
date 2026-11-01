/*
 * The first-paint script's own parts (components/index.ts puts it together). The script comes inside the page, at the end of its <body>
 * (html.ts), and runs as soon as the page is read, before its first paint, since nothing the page downloads holds that paint.
 */

/**
 * Light or dark: the page carries the player's choice (data-theme-choice on <html>, "system" for guests), and CSS follows it with no script.
 * This tells page scripts what's showing: zaismaTheme.now() is "light" or "dark", choice() the saved choice, and onChange(fn) hears the
 * device change. It also sets data-theme on <html> to what's showing, before the first paint.
 */
export const THEME_SCRIPT = `/* theme */(function () {
  var root = document.documentElement, query = window.matchMedia("(prefers-color-scheme: dark)"), listeners = [];
  function choice() { var saved = root.getAttribute("data-theme-choice"); return saved === "light" || saved === "dark" ? saved : "system"; }
  function now() { return choice() === "system" ? (query.matches ? "dark" : "light") : choice(); }
  function apply() { var theme = now(); if (root.getAttribute("data-theme") === theme) return; root.setAttribute("data-theme", theme); listeners.forEach(function (listener) { listener(theme); }); }
  if (query.addEventListener) query.addEventListener("change", apply);
  // A choice changed on the page itself (Screens sets each frame's) shows at once.
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme-choice"] });
  window.zaismaTheme = { now: now, choice: choice, onChange: function (listener) { listeners.push(listener); } };
  apply();
})();
`;

/** How long the page's script files wait for the site's stylesheet before running without it. */
export const STYLES_WAIT_LIMIT_MS = 10_000;

/**
 * The site's stylesheet and the page's script files follow the first paint. The page carries the rules its own markup needs
 * (first-paint-styles.ts); the whole sheet, for what scripts add later (a sheet, a notice, a list fetched in), is named with
 * link rel=preload data-site-style at its body's end, and each script file with link rel=preload data-page-script (html.ts's
 * scriptTags), so they download while nothing waits on them. This runs first in the body, so it puts the sheet on once the page is read,
 * which never holds a paint in any browser; once it has loaded (or failed, or after STYLES_WAIT_LIMIT_MS), the script files run in the page's order,
 * as the classic scripts they are (async false), so what one names at its top level another still finds. A page with its stylesheets
 * linked already (the gallery) only runs its files.
 */
export const FOLLOWING_FILES_SCRIPT = `/* following files */(function () {
  var isStyled = false, isRead = document.readyState !== "loading", isRun = false;
  function runFiles() {
    if (isRun || !isStyled || !isRead) return;
    isRun = true;
    document.querySelectorAll("link[rel=preload][data-page-script]").forEach(function (named) {
      var script = document.createElement("script");
      script.src = named.href; script.async = false;
      document.body.appendChild(script);
    });
  }
  function styled() { isStyled = true; runFiles(); }
  function putSheets() {
    var named = Array.prototype.slice.call(document.querySelectorAll("link[rel=preload][data-site-style]"));
    if (!named.length) { styled(); return; }
    var left = named.length;
    var arrived = function () { if (--left === 0) styled(); };
    named.forEach(function (preload) {
      // For print until it has loaded: Chrome holds a page's first paint for a stylesheet put on it while it's read, but never for one
      // that doesn't apply to the screen.
      var sheet = document.createElement("link");
      sheet.rel = "stylesheet"; sheet.href = preload.href; sheet.media = "print";
      sheet.addEventListener("load", function () { sheet.media = "all"; arrived(); }); sheet.addEventListener("error", arrived);
      preload.after(sheet);
    });
    setTimeout(styled, ${STYLES_WAIT_LIMIT_MS});
  }
  if (isRead) putSheets();
  else document.addEventListener("readystatechange", function read() { if (document.readyState === "loading") return; document.removeEventListener("readystatechange", read); isRead = true; putSheets(); runFiles(); });
})();
`;

/**
 * Glass over a game background whose tone was measured when it was added (data-glass-kind, background-tone.ts): every piece of glass over
 * it takes that glass, light or smoked, from the first paint, so it never fades from the page's own as the page shows. The backdrop's
 * script, which follows, sets the same again and measures the rest.
 */
export const MEASURED_GLASS_SCRIPT = `/* measured glass */(function () {
  if (!window.zaismaWatch) return;
  function hostOf(el) { return el.closest(":has(> .backdrop)"); }
  function pickOf(host) {
    var measured = host && host.querySelector(":scope > .backdrop[data-adapts-glass][data-glass-kind], :scope > .backdrop .backdrop[data-adapts-glass][data-glass-kind]");
    return measured ? { isSmoked: measured.getAttribute("data-glass-kind") === "smoked", tint: measured.getAttribute("data-glass-tint") || "" } : null;
  }
  function setGlass(el, pick) {
    el.classList.toggle("smoke", pick.isSmoked);
    if (pick.isSmoked) el.removeAttribute("data-theme-choice"); else if (!el.hasAttribute("data-theme-choice")) el.setAttribute("data-theme-choice", "light");
    if (pick.tint) el.style.setProperty("--glass-tint", pick.tint);
  }
  window.zaismaWatch.eachArriving("[data-adapts-glass][data-glass-kind]", function () {
    document.querySelectorAll("[data-glass]:not([data-cut-line])").forEach(function (el) { var host = hostOf(el), pick = pickOf(host); if (pick) setGlass(el, pick); });
  });
  window.zaismaWatch.eachArriving("[data-glass]:not([data-cut-line])", function (el) { var host = hostOf(el), pick = pickOf(host); if (pick) setGlass(el, pick); });
})();
`;

/** How long a game's shader frame that never says it has drawn waits, once loaded, before it shows anyway. */
export const FRAME_SAYS_LIMIT_MS = 4000;

/**
 * A game's shader on its page (data-shows-once-drawn, backgrounds.ts) fades in over its placeholder once its runner first says something:
 * it has drawn, or it failed and shows its still instead. Part of the first-paint script, so it hears a runner that's quicker than the
 * page's files; one that never says shows once it has loaded and had FRAME_SAYS_LIMIT_MS to.
 */
export const SHOWN_ONCE_DRAWN_SCRIPT = `/* shown once drawn */(function () {
  var FRAMES = "iframe[data-shows-once-drawn]";
  function show(frame) { frame.classList.add("is-shown"); }
  window.addEventListener("message", function (event) {
    if (!event.data || !event.data.zaismaBackground) return;
    document.querySelectorAll(FRAMES).forEach(function (frame) { if (event.source === frame.contentWindow) { frame.hasSaid = true; show(frame); } });
  });
  window.zaismaWatch.eachArriving(FRAMES, function (frame) {
    frame.addEventListener("load", function () { setTimeout(function () { if (!frame.hasSaid) show(frame); }, ${FRAME_SAYS_LIMIT_MS}); });
  });
})();
`;

/**
 * Amounts hidden on this device (Developer settings' Payments, its eye: data-amounts-toggle): every [data-amount] shows •••, kept in
 * this browser. Part of the first-paint script, so a device that hid them never paints the figures first.
 */
export const HIDDEN_AMOUNTS_SCRIPT = String.raw`/* hidden amounts */(function () {
  var KEY = "zaisma.payments_amounts_hidden";
  var hidden = false;
  try { hidden = localStorage.getItem(KEY) === "yes"; } catch (e) {}
  var AMOUNTS = "#payments .number-amount, [data-amount]", TOGGLES = "[data-amounts-toggle]";
  function drawAmount(each) {
    if (!each.hasAttribute("data-amount")) each.setAttribute("data-amount", each.textContent);
    each.textContent = hidden ? "•••" : each.getAttribute("data-amount");
  }
  function drawToggle(button) {
    button.setAttribute("aria-pressed", String(hidden));
    var label = button.querySelector("span:not([class])");
    if (label) label.textContent = hidden ? "Show amounts" : "Hide amounts";
  }
  function draw() { document.querySelectorAll(AMOUNTS).forEach(drawAmount); document.querySelectorAll(TOGGLES).forEach(drawToggle); }
  window.zaismaWatch.each(AMOUNTS, drawAmount);
  window.zaismaWatch.each(TOGGLES, drawToggle);
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[data-amounts-toggle]");
    if (!button) return;
    hidden = !hidden;
    try { localStorage.setItem(KEY, hidden ? "yes" : "no"); } catch (e) {}
    draw();
  });
})();
`;

/**
 * A page that doesn't read who's looking (a message, the legal pages) shows Sign in in its header (data-account-from-cookie): once the
 * page sees the signed-in cookie, the Sign in runner becomes a way to the account, before the first paint, so Sign in never flashes.
 */
export const ACCOUNT_LINK_SCRIPT = `/* account link */(function () {
  if (!/(^|; )(__Host-)?zaisma_in=1/.test(document.cookie)) return;
  window.zaismaWatch.each("header.top[data-account-from-cookie] .end > a:is(.run-wrap,.cut-btn)", function (link) {
    link.href = "/account"; var words = link.querySelector(".face > span:not([class])"); if (words) words.textContent = "Account";
  });
})();
`;
