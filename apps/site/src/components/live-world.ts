import { html, type Raw } from "../markup.ts";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { glassPane } from "./foundations.ts";
import { action, primaryButton } from "./actions.ts";
import { rail } from "./navigation.ts";
import { stack, type LayoutMarkup } from "./layout.ts";
import { HEADER_RAIL_MEDIA, cutPolygon } from "./tokens.ts";

/*
 * The live world: a kingdom in the mountains, one picture by day and one by night (brand/world/), where signing in and making an account
 * happen (docs/DECISIONS.md, "The sign-in shows who's playing, over a kingdom in the mountains"). A small copy of each is in the page itself,
 * so it's there at the first paint, under the sharp one as it loads. By day birds cross the sky, at most 25 times a second, resting after a minute with
 * no input; by night a shooting star falls now and then and nothing is drawn between them. Under reduced motion the birds hold still and no star falls. Over it, one line: how many people are playing right now.
 */

export interface LiveWorldStageOptions {
  /** Fills its own box instead of the window: the gallery's example. */
  isFramed?: boolean;
}

/** The kingdom's picture and the birds over it, under everything else on the page. */
export function liveWorldStage(options: LiveWorldStageOptions = {}): Raw {
  return html`<div class="world-stage${options.isFramed ? " is-framed" : ""}" aria-hidden="true"><span class="world-still"></span><canvas class="world-birds"></canvas></div>`;
}

/** The count, in words: a link to what people are playing. LIVE_WORLD_SCRIPT fills it in; under 10 players it stays hidden. */
const countLine = html`<a class="world-count" href="/browse" hidden></a>`;

export interface LiveWorldPaneOptions {
  /** The header over the world (Header, on sign-in: the logo alone). */
  header: Raw;
  /** What the pane is, for a screen reader: the step's title. */
  label: string;
  /** The step's pieces, laid out (a stack). */
  body: LayoutMarkup;
  /** What goes after the pane on the page, like its scripts. */
  after?: Raw;
}

/**
 * The sign-in's pane on a phone: it starts low, so the world has most of the screen and only the pane's top shows, down to its first
 * heading, 24px above the window's foot (or under the header, if that's lower). It's the pane's place whether or not the world runs, set
 * before the first paint as part of the first-paint script (components/index.ts), so it never moves as the page loads; measured again
 * when the width changes (not when the browser's bars come and go) and once Jost has arrived. window.zaismaPlaceWorldPane places it again.
 */
export const WORLD_PANE_PLACE_SCRIPT = `/* world pane */(function () {
  var placedWidth = 0;
  function place(isForced) {
    var pane = document.querySelector("[data-world-pane]"), stage = document.querySelector(".world-stage");
    if (!pane || !stage || stage.classList.contains("is-framed") || (window.innerWidth === placedWidth && !isForced)) return;
    placedWidth = window.innerWidth;
    if (window.innerWidth > 760 || window.matchMedia(${JSON.stringify(HEADER_RAIL_MEDIA)}).matches) { pane.style.marginTop = ""; return; }
    // The first heading showing (a pane can hold views that take turns, like Sign in and Make an account).
    var heading = Array.prototype.find.call(pane.querySelectorAll("h1, h2"), function (el) { return el.getClientRects().length > 0; });
    var header = pane.parentElement.querySelector("header.top");
    pane.style.marginTop = "0px";
    var peek = (heading ? heading.getBoundingClientRect().bottom : pane.getBoundingClientRect().top + 120) - pane.getBoundingClientRect().top + 24;
    var below = header ? header.offsetTop + header.offsetHeight + 12 : 12;
    pane.style.marginTop = Math.round(Math.max(below, window.innerHeight - peek)) + "px";
  }
  window.zaismaPlaceWorldPane = place;
  // Placed as it arrives, and again whenever what's in it settles to another height (a rail coming on), before the frame is painted.
  window.zaismaWatch.each("[data-world-pane]", function (pane) { place(true); window.zaismaWatch.size(pane, function () { place(true); }); });
  window.zaismaWatch.whenRead(function () { place(true); });
  window.addEventListener("resize", function () { place(); });
  window.zaismaWatch.fontsIn(function () { place(true); });
})();
`;

/**
 * The page over the world's stage (liveWorldStage goes in the page's stage): the header, the one pane in front of the world, placed on
 * the right under the header on a wide screen and low and full width on a phone, the page's rail first, and after the pane in the page's
 * order, so the form comes first, the count and the villages.
 */
export function liveWorldPane(options: LiveWorldPaneOptions): Raw {
  // The page's rail first, so the browser's own scrollbar never shows while the page arrives (RAIL_SCRIPT).
  return html`<div class="world-page">${rail("page")}${options.header}<div class="world-pane" data-world-pane>${glassPane({ paneWidth: "full", label: options.label, body: options.body })}</div>
${countLine}
${options.after ?? ""}</div>`;
}

export const LIVE_WORLD_SCRIPT: PageScript = pageScript("live-world", String.raw`(function () {
  var NUMBER_FROM = 10, REFRESH_MS = 60000, FRAME_MS = 40, SKY_SHARE = 0.62, REST_AFTER_MS = 60000;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Flocks, far to near: how many, how big (at a 900px tall stage), how high up the stage, how fast (screens a second) and which way.
  var FLOCKS = [{ count: 7, size: 3.2, high: 0.3, speed: 0.008, way: 1, start: 0.1, tone: "rgba(82,108,134,.72)" }, { count: 5, size: 4.4, high: 0.24, speed: 0.011, way: -1, start: 0.62, tone: "rgba(62,88,114,.8)" }, { count: 2, size: 6.2, high: 0.19, speed: 0.014, way: 1, start: 0.4, tone: "rgba(44,68,92,.86)" }, { count: 1, size: 9, high: 0.12, speed: 0.02, way: -1, start: 0.85, tone: "rgba(30,50,72,.92)" }];
  function bird(c, x, y, size, way, time, id, tone) {
    // Gliding for a while, then beating: the wings bend at the elbow, the tips a beat behind.
    var glide = Math.max(0, Math.sin(time * 0.33 + id * 2.3)), power = 1 - glide * 0.8, beat = time * (7 - size * 0.25) + id * 1.3, inner = Math.sin(beat) * power * 0.5 + 0.1 * glide, outer = Math.sin(beat - 0.85) * power * 0.55 + 0.14 * glide;
    c.save(); c.translate(x, y); c.scale(size * way, size); c.fillStyle = tone; c.strokeStyle = tone; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(-0.95, -0.02); c.quadraticCurveTo(-0.3, -0.13, 0.45, -0.04); c.quadraticCurveTo(0.74, 0.02, 0.8, 0.05); c.quadraticCurveTo(0.42, 0.13, -0.3, 0.07); c.closePath(); c.fill();
    c.lineWidth = 0.13; c.beginPath(); c.moveTo(0.14, -0.03); c.lineTo(-0.02, -inner); c.lineTo(-0.5, -inner - outer); c.stroke();
    c.lineWidth = 0.09; c.globalAlpha = 0.6; c.beginPath(); c.moveTo(0.24, -0.03); c.lineTo(0.16, -inner * 0.9 - 0.05); c.lineTo(-0.2, -inner * 0.9 - outer * 0.86 - 0.05); c.stroke();
    c.restore();
  }
  // A shooting star: a thin pale streak that grows from nothing, its tail catching up as it fades. Each kind of star comes round on its own time.
  var STREAKS = [{ everyS: 80, seed: 0 }, { everyS: 117, seed: 0.31 }];
  function hashOf(a, b) { var value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return value - Math.floor(value); }
  function isStreakFalling(time, item) { var cycle = time / item.everyS + item.seed, id = Math.floor(cycle) + item.seed * 100; return ((cycle - Math.floor(cycle)) * item.everyS) / (1 + 0.6 * hashOf(id, 1)) < 1; }
  function streak(c, width, height, time, item) {
    var cycle = time / item.everyS + item.seed, id = Math.floor(cycle) + item.seed * 100, life = 1 + 0.6 * hashOf(id, 1), done = ((cycle - Math.floor(cycle)) * item.everyS) / life; if (done >= 1) return false;
    var fromX = (0.12 + 0.76 * hashOf(id, 2)) * width, fromY = (0.04 + 0.2 * hashOf(id, 3)) * height, angle = 0.3 + 0.5 * hashOf(id, 4), way = hashOf(id, 5) > 0.5 ? 1 : -1, far = (0.16 + 0.2 * hashOf(id, 6)) * height, dx = way * Math.cos(angle), dy = Math.sin(angle);
    function ease(from, to, t) { var u = Math.max(0, Math.min(1, (t - from) / (to - from))); return u * u * (3 - 2 * u); }
    var head = far * ease(0, 0.86, done), tail = far * ease(0.24, 1, done), strength = Math.pow(Math.sin(Math.PI * done), 1.4) * 0.8; if (head <= tail) return true;
    var line = c.createLinearGradient(fromX + dx * tail, fromY + dy * tail, fromX + dx * head, fromY + dy * head); line.addColorStop(0, "rgba(219,230,255,0)"); line.addColorStop(1, "rgba(219,230,255," + strength + ")");
    c.strokeStyle = line; c.lineWidth = 1.2; c.lineCap = "round"; c.beginPath(); c.moveTo(fromX + dx * tail, fromY + dy * tail); c.lineTo(fromX + dx * head, fromY + dy * head); c.stroke(); return true;
  }
  function birds(stage) {
    // Only the sky's part of the stage has a layer, so little is redrawn. It rests like the backdrop: after a minute with no input the birds hold
    // where they are, and at night nothing is drawn unless a star is falling.
    var canvas = stage.querySelector(".world-birds"), c = canvas.getContext("2d"), width = 0, height = 0, pixelRatio = 1, last = -FRAME_MS, shownMs = 0, lastInput = 0, isInView = true, hadStar = false;
    function isNight() { return /dark/.test(getComputedStyle(stage).colorScheme || ""); }
    function drawDay() {
      c.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); c.clearRect(0, 0, width, height * SKY_SHARE);
      var time = shownMs / 1000, grow = height / 900, id = 0;
      FLOCKS.forEach(function (flock) {
        var run = ((flock.start + time * flock.speed) % 1.3), lead = flock.way > 0 ? (run - 0.15) * width : (1.15 - run) * width;
        for (var i = 0; i < flock.count; i++) { id++; var row = Math.ceil(i / 2), side = i % 2 ? 1 : -1; bird(c, lead - flock.way * row * flock.size * 3.4 * grow, height * flock.high + side * row * flock.size * 1.7 * grow + Math.sin(time * 0.17 + id) * 3 * grow, flock.size * grow, flock.way, time, id, flock.tone); }
      });
    }
    function drawNight(ms) {
      var isFalling = !reduced.matches && STREAKS.some(function (item) { return isStreakFalling(ms / 1000, item); }); if (!isFalling && !hadStar) return;
      c.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); c.clearRect(0, 0, width, height * SKY_SHARE); hadStar = isFalling;
      if (isFalling) STREAKS.forEach(function (item) { streak(c, width, height, ms / 1000, item); });
    }
    function draw(ms) { if (isNight()) drawNight(ms); else { hadStar = true; drawDay(); } }
    function size() { var box = stage.getBoundingClientRect(); if (!box.width) return; width = box.width; height = box.height; pixelRatio = Math.min(window.devicePixelRatio || 1, 2); canvas.width = width * pixelRatio; canvas.height = height * SKY_SHARE * pixelRatio; hadStar = true; draw(last); }
    function tick(ms) {
      requestAnimationFrame(tick); if (document.hidden || !isInView || reduced.matches || ms - last < FRAME_MS) return;
      var gap = Math.min(ms - last, 200); last = ms; if (isNight()) { drawNight(ms); return; }
      if (ms - lastInput > REST_AFTER_MS) return; shownMs += gap; drawDay();
    }
    size();
    ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "input"].forEach(function (name) { window.addEventListener(name, function (event) { lastInput = event.timeStamp; }, { passive: true, capture: true }); });
    if (window.ResizeObserver) new ResizeObserver(size).observe(stage);
    new MutationObserver(function () { hadStar = true; draw(last); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-choice"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { hadStar = true; draw(last); });
    if (window.IntersectionObserver) new IntersectionObserver(function (entries) { isInView = entries[entries.length - 1].isIntersecting; }).observe(stage);
    requestAnimationFrame(tick);
  }
  function showCount(line, count) { if (!line) return; var isShown = count >= NUMBER_FROM; line.hidden = !isShown; if (isShown) line.textContent = count.toLocaleString("en-US") + " people playing right now."; }
  function start() {
    Array.prototype.forEach.call(document.querySelectorAll(".world-stage"), birds);
    var line = document.querySelector(".world-page .world-count"); if (!line) return;
    function read() {
      if (document.hidden) return;
      fetch("/api/playing-now" + (/[?&]preview_players=/.test(location.search) ? "?" + new URLSearchParams(location.search).toString() : "")).then(function (response) { return response.ok ? response.json() : null; }).then(function (answer) { if (answer) showCount(line, answer.playing_now_player_count); }).catch(function () {});
    }
    read(); setInterval(read, REFRESH_MS);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
`);

export const WORLD_PANE_SCRIPT: PageScript = pageScript("live-world-pane", `(function () {
  var pane = document.querySelector("[data-world-pane]");
  if (!pane || !window.fetch || !window.DOMParser || !window.AbortController || !window.URLSearchParams) return;
  // The steps of signing in, a pane on the live world each: Sign in and Make an account and every step after them, and You're in.
  var STEPS = /^\\/(signin|join)(\\/|$)|^\\/account\\/kept$/, AWAY = /^\\/signin\\/with\\//, OWN_SCRIPTS = /\\/js\\/live-world(-pane)?\\./;
  var waiting = null, shownPath = location.pathname + location.search;
  function isStep(url) { return url.origin === location.origin && STEPS.test(url.pathname) && !AWAY.test(url.pathname); }
  // Sign in and Make an account swap between themselves (ENTRY_SWITCH_SCRIPT) while the pane holds both.
  function isSwitchOwn(url) { return /^\\/(signin|join)$/.test(url.pathname) && Boolean(pane.querySelector("[data-entry-view]")); }

  function go(url, request, history, fallback) {
    if (waiting) waiting.abort();
    var controller = (waiting = new AbortController());
    fetch(url, Object.assign({ credentials: "same-origin", signal: controller.signal }, request))
      .then(function (response) {
        return response.text().then(function (text) {
          if (waiting !== controller) return;
          waiting = null;
          var page = (response.headers.get("content-type") || "").indexOf("text/html") === 0 ? new DOMParser().parseFromString(text, "text/html") : null;
          var next = page && page.querySelector("[data-world-pane] .pane-in");
          if (!next) return away(response, text, request.method);
          // A form answered in place (a problem to fix, or the next step of the same address) keeps the address it was sent from.
          swap(page, next, response.url, request.method === "POST" && !response.redirected ? "none" : history);
        });
      })
      .catch(function (error) { if (waiting === controller) waiting = null; if (!error || error.name !== "AbortError") fallback(); });
  }
  // Not a step: a page reached by a redirect, or by a link, opens as a page; one a form's send answered with directly takes this one's place.
  function away(response, text, method) {
    if (response.redirected || method === "GET") { location.assign(response.url); return; }
    document.open(); document.write(text); document.close();
  }
  function swap(page, next, url, history) {
    var holder = pane.querySelector(".pane-in"), glass = pane.querySelector(".glass-pane"), label = page.querySelector("[data-world-pane] .glass-pane");
    var scripts = Array.prototype.filter.call(page.querySelectorAll(".world-page script[src]"), function (script) { return !OWN_SCRIPTS.test(script.getAttribute("src")); });
    scripts.forEach(function (script) { script.remove(); });
    if (label && glass) glass.setAttribute("aria-label", label.getAttribute("aria-label") || "");
    holder.replaceChildren.apply(holder, Array.prototype.slice.call(next.childNodes));
    holder.scrollTop = 0;
    document.title = page.title;
    var path = new URL(url).pathname + new URL(url).search;
    if (history === "push" && path !== shownPath) window.history.pushState({ worldPane: true }, "", url);
    else if (history === "push") window.history.replaceState({ worldPane: true }, "", url);
    shownPath = location.pathname + location.search;
    runAll(scripts.map(function (script) { return script.getAttribute("src"); }));
    // Where the step begins: its first field with a problem, or its heading, read out as a new page's would be.
    var problem = holder.querySelector('[aria-invalid="true"]'), heading = holder.querySelector("h1, h2");
    if (problem) problem.focus({ preventScroll: true });
    else if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
    // On a phone the page scrolls: a step that starts above the screen comes back into view, under the header.
    var top = pane.getBoundingClientRect().top, header = document.querySelector("header.top"), clear = header ? header.getBoundingClientRect().bottom + 12 : 12;
    if (top < clear) window.scrollBy({ top: top - clear, behavior: "smooth" });
  }
  // In order, one after another, as they would on a page.
  function runAll(sources) {
    if (!sources.length) return;
    var script = document.createElement("script");
    script.src = sources[0];
    script.onload = script.onerror = function () { script.remove(); runAll(sources.slice(1)); };
    document.body.appendChild(script);
  }

  window.zaismaPaneGo = function (href) {
    var url = new URL(href, location.href);
    if (!isStep(url)) { location.assign(url.href); return; }
    go(url.href, { method: "GET" }, "push", function () { location.assign(url.href); });
  };
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!pane.contains(link) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    var url = new URL(link.href);
    if (!isStep(url) || (url.hash && url.pathname === location.pathname && url.search === location.search)) return;
    event.preventDefault();
    go(url.href, { method: "GET" }, "push", function () { location.assign(url.href); });
  });
  // After every other submit listener (the bot check holds a form until it's answered, a field may stop one).
  window.addEventListener("submit", function (event) {
    var form = event.target, submitter = event.submitter;
    if (event.defaultPrevented || !pane.contains(form)) return;
    var url = new URL((submitter && submitter.getAttribute("formaction")) || form.action, location.href);
    var method = ((submitter && submitter.getAttribute("formmethod")) || form.method || "get").toUpperCase();
    if (!isStep(url) || (form.target && form.target !== "_self")) return;
    var data = new FormData(form);
    if (submitter && submitter.name && !data.has(submitter.name)) data.append(submitter.name, submitter.value);
    var fields = new URLSearchParams();
    data.forEach(function (value, name) { if (typeof value === "string") fields.append(name, value); });
    event.preventDefault();
    var send = function () { HTMLFormElement.prototype.submit.call(form); };
    if (method === "GET") { url.search = fields.toString(); go(url.href, { method: "GET" }, "push", send); }
    else go(url.href, { method: "POST", body: fields, headers: { "content-type": "application/x-www-form-urlencoded" } }, "push", send);
  });
  window.addEventListener("popstate", function () {
    var url = new URL(location.href), path = url.pathname + url.search;
    if (path === shownPath) return;
    if (isSwitchOwn(url)) { shownPath = path; return; }
    if (!isStep(url)) { location.reload(); return; }
    go(url.href, { method: "GET" }, "none", function () { location.reload(); });
  });
})();
`);

const LIVE_WORLD_STYLES = `
/* The stage: the picture covers it, the castle kept clear of the pane on a wide screen and in the middle on a tall one. Its height is the
   largest the window gets (lvh), so a phone's address bar crops its foot rather than resizing it. */
:has(> .world-stage) { isolation: isolate; }
.world-stage { position: fixed; inset: 0 0 auto 0; height: 100vh; height: 100lvh; z-index: -1; overflow: hidden; pointer-events: none; }
.world-stage.is-framed { position: absolute; inset: 0; height: 100%; z-index: 0; }
.world-birds { position: absolute; inset: 0 0 auto 0; width: 100%; height: 62%; display: block; }
/* The sharp picture over the small one in the page, which shows until it has loaded. Only the theme's own is loaded. */
.world-stage { --still-day: url(/world/day.webp); --still-night: url(/world/night.webp); --still-small-day: url(data:image/webp;base64,UklGRm4DAABXRUJQVlA4WAoAAAAgAAAAPwAAIwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDgggAEAAPAKAJ0BKkAAJAA+0WCmTqgloyIquAkBABoJYwDDpF3T9lM45Qg4J7aVSuRE1UBSjM2or/w4WXFL4Bq7FYGnhYj0N7M/d+Zanq8u4r0c6YV5qdQ4bxz0mzvInTez3gfNwAD+sj5qoUCYmyFIZBQxVf8q4VH3uZv5Lbm/tAhw8UhwP1IeAdBvYPCrVMiC88R2NfzU6semtSQfzsI9UGbze79HnZbXVHvxucdnyFKrMFRMZS2JUO+FUNCFBx1hPtJ/ltMrIfcIe0Up0m5wIoOpaeFuw2xn+2KwnjhR9xmPJwX8dcp+/lCMOR2Dd6TsmGnzMjkyo2GMg+eSOhuTJgyMZl7xZcrWQWt3hchfeTFK4EfMs5BYad40rEIQEgVLiBkuw/eV3HfPLW+KHrnCvXmw2rj3kLrgAiHb03Cz1Ypel5ggIr/ymiymEsI0IN8ECK+cq3nb5wpLcG36dEAN0HuOADF/AO1NeLKwpFwWLMPuyUbNaeoEIyUx4iDNFNnZv5sAAA==); --still-small-night: url(data:image/webp;base64,UklGRrACAABXRUJQVlA4WAoAAAAgAAAAPwAAIwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggwgAAAJAHAJ0BKkAAJAA+0VqiTKglIyItVmyRABoJZQDFDD6BbAKLHB/+Z2Xmap9dlo9nJbBTp3YWAzrGgOrigc37HJP4j5HF9AD+8Ry/etqTaY5QTYYH4aEtF1+SJGKpAK2IPbG1XGuv6Hum3vM3bspYL1+p+qwbVkeFVvqa9jfwXuQXfy3Qe6wvXSWkeF1NWOUK+C3BNBbCCoKYDxkiTqdYd2UrSZm/48wPy42Qh9v7czUJGb8KXPx96BElozauT5AIWAAA); }
.world-still { position: absolute; inset: 0; display: block; background-repeat: no-repeat; background-size: cover; background-position: 38% 40%; background-image: var(--still-day), var(--still-small-day); }
@media (max-aspect-ratio: 3/4) {
  .world-stage { --still-day: url(/world/day-phone.webp); --still-night: url(/world/night-phone.webp); }
  .world-still { background-position: 45% 40%; }
}
@media (prefers-color-scheme: dark) { :root:not([data-theme-choice="light"]) .world-still { background-image: var(--still-night), var(--still-small-night); } }
[data-theme-choice="dark"] .world-still { background-image: var(--still-night), var(--still-small-night); }
/* The count: the page's one line, on the sky, a link to what people are playing. */
.world-count { position: absolute; z-index: 0; top: var(--header-room); left: max(var(--pad-pane), calc((100% - 1240px) / 2)); max-width: calc(100% - 2 * var(--pad-pane)); min-height: var(--control-height-regular); display: flex; align-items: center; font: var(--type-heading); color: var(--ink); text-decoration: none; }
.world-page .world-count { position: fixed; }
@media (max-width: 760px) { .world-page .world-count { top: calc(var(--header-room) - var(--gap-words-control)); font: var(--type-section); } }
.world-frame .world-count { top: var(--pad-inner-pane); left: var(--pad-inner-pane); }

/* A pane on the world: glass in front, never resting in the scene. On a wide screen it's a form's width (460px) on the right,
   standing a block's gap under the header (--header-room), its edge in line with the header's, as tall as what's in it and at most down
   to the same inset from the bottom, where what's in it scrolls; the world has the rest. On a phone it's full width at the
   bottom, its edges in line with the header's, starting low (WORLD_PANE_PLACE_SCRIPT places it) and scrolling up with the page. */
.world-page { min-height: 100vh; }
/* A press anywhere but on the pane, the header, the rail or a village goes through the page (and the body it lies behind). */
body:has(> .world-page), .world-page { pointer-events: none; }
.world-page > * { pointer-events: auto; }
/* The pane places itself under the header, so the page keeps no room for it. */
body:has(> .world-page) { padding-top: 0; }
html:has(.world-page) { height: 100%; }
.world-page .world-pane { position: fixed; z-index: 1; top: var(--header-room); max-height: calc(100vh - var(--header-room) - var(--pad-pane)); right: max(var(--pad-pane), calc((100% - 1240px) / 2)); width: min(460px, calc(100% - 2 * var(--pad-pane))); display: flex; }
.world-page .world-pane > .glass-pane { flex: 1; min-height: 0; }
/* The other ways in: stacked, cut only at the stack's ends. */
.world-pane .ways { display: grid; gap: var(--gap-control-stack); }
/* Or, between the ways in: a word on a hairline. */
.world-pane .or { display: flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--muted); }
.world-pane .or::before, .world-pane .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.world-pane .note { font: var(--type-note); color: var(--muted); }
/* Its cards sit two to a row where the pane has room: an odd one out on the last row is centred under the two above it, one column wide. */
.world-pane .is-play-step .choice-cards { container-type: inline-size; }
@container (min-width: 368px) {
  .world-pane .is-play-step .choice-card:last-child:nth-child(odd) { grid-column: 1 / -1; justify-self: center; width: calc(50% - var(--gap-control-stack) / 2); }
}
@media (max-width: 760px) {
  html:has(.world-page) { height: auto; }
  .world-page { display: flow-root; min-height: 0; padding-bottom: calc(var(--pad-inner-pane) + env(safe-area-inset-bottom)); }
  .world-page .world-pane { position: relative; top: auto; bottom: auto; right: auto; width: auto; max-height: none; margin: 60vh var(--pad-pane) 0; }
  .world-page .world-pane > .glass-pane > .pane-in { overflow: visible; }
  /* The page's rail runs down the gutter beside the pane. */
  .world-page .rail[data-rail="page"] { right: 1px; }
}
/* A phone on its side: the logo keeps to its corner and the pane stands the whole height on the right, its form in view, the world between them. */
@media ${HEADER_RAIL_MEDIA} {
  html:has(.world-page), body:has(> .world-page) { height: 100dvh; min-height: 0; overflow: hidden; }
  .world-page { display: block; min-height: 100dvh; padding-bottom: 0; }
  .world-page header.top { top: var(--pad-frame); left: max(var(--pad-frame), var(--safe-left)); width: max-content; transform: none; }
  .world-page .world-count { top: calc(var(--pad-frame) + var(--header-height) + var(--gap-control-row)); left: var(--pad-pane); font: var(--type-section); }
  .world-page .world-pane { position: fixed; top: var(--pad-frame); bottom: auto; right: max(var(--pad-frame), var(--safe-right)); width: min(var(--size-pane-beside), 100%); max-height: calc(100svh - 2 * var(--pad-frame)); margin: 0; }
  .world-page .world-pane > .glass-pane > .pane-in { overflow: hidden auto; }
}
/* The gallery's example: the stage in its own box, cut like a pane, with a pane on its right as tall as what's in it; where the box is a
   phone's width, the pane is full width at its foot, as on a phone. */
.world-frame { position: relative; width: 100%; height: 480px; overflow: hidden; display: flex; align-items: flex-start; justify-content: flex-end; padding: var(--pad-inner-pane);
  container-type: inline-size; clip-path: ${cutPolygon("pane")}; }
.world-frame > .glass-pane { position: relative; z-index: 1; }
@container (max-width: 560px) { .world-frame > .glass-pane:is(.fit, .full) { width: 100%; align-self: flex-end; } }
`;

component({
  name: "Live world",
  slug: "live-world",
  group: "foundations",
  subgroup: "backgrounds",
  summary: "Zaisma's own scene, where signing in and making an account happen: a kingdom in the mountains, one picture by day and one by night, with birds crossing the day sky and a line saying how many people are playing right now. For those pages only: every other page keeps the calm backdrop. Under reduced motion the birds hold still.",
  styles: LIVE_WORLD_STYLES,
  render: liveWorldStage,
  examples: [
    {
      label: "A pane on the world",
      isWide: true,
      markup: html`<div class="world-frame">${liveWorldStage({ isFramed: true })}<span class="world-count">47 people playing right now.</span>${glassPane({ paneWidth: "fit", label: "Sign in", body: stack({ items: [{ kind: "words", markup: html`<h2>Welcome back</h2>` }, { kind: "control", markup: primaryButton(action("signIn")) }] }) })}</div>`,
    },
  ],
});
