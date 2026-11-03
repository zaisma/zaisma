// The screen's script: first in the head of every page on a bench screen (bench-server.mjs). It makes a phone screen answer as a phone,
// keeps the page's mark on its address so its own requests carry the profile, tells the bench what's done here, and does what the bench
// asks: the same press, a state, Slow. A real phone (On my phone's link) only keeps the mark and enters its state.
(() => {
  /*PHONE_MEDIA*/
  const asked = new URL(document.currentScript.src).searchParams;
  const markText = asked.get("mark");
  const [groupName, screenName, profile, backgrounds] = markText.split(".");
  const isSignedIn = asked.get("signed_in") === "1";
  const isPhoneScreen = screenName === "phone" || screenName === "turned";
  const bench = window.parent !== window && window.parent.zaismaBench ? window.parent.zaismaBench : null;
  const SCREEN_SIZE = { phone: [393, 852], turned: [852, 393] }[screenName];

  // The mark stays on the address, so the Referer of everything the page sends says whose it is.
  const marked = (address) => { const url = new URL(address, location.href); if (url.origin === location.origin) url.searchParams.set("bench_screen", markText); return url.href; };
  const { pushState, replaceState } = history;
  history.pushState = function (state, title, address) { pushState.call(history, state, title, address == null ? address : marked(address)); pageChanged(); };
  history.replaceState = function (state, title, address) { replaceState.call(history, state, title, address == null ? address : marked(address)); };
  replaceState.call(history, history.state, "", marked(location.href));

  // The profile's own: the browser's cookies aren't the screen's.
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get() {
      const others = cookie.get.call(document).split(/;\s*/).filter((pair) => pair && !/^(__Host-)?(zaisma_in|zaisma_device_kind)=/.test(pair));
      return [...others, ...(isSignedIn ? ["zaisma_in=1"] : []), ...(SCREEN_SIZE ? ["zaisma_device_kind=phone"] : screenName === "laptop" ? ["zaisma_device_kind=computer"] : [])].join("; ");
    },
    set(text) { if (!/^(__Host-)?zaisma_device_kind=/.test(text)) cookie.set.call(document, text); },
  });

  // Backgrounds rest on their still picture until they're turned on: three moving shaders would heat the laptop.
  if (backgrounds === "still") {
    const { getContext } = HTMLCanvasElement.prototype;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /^webgl/.test(kind) ? null : getContext.call(this, kind, ...rest); };
  }

  if (SCREEN_SIZE) {
    const { matchMedia } = window;
    window.matchMedia = (query) => matchMedia.call(window, phoneMediaText(String(query)));
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    window.ontouchstart = null;
    for (const [name, size] of [["width", SCREEN_SIZE[0]], ["height", SCREEN_SIZE[1]], ["availWidth", SCREEN_SIZE[0]], ["availHeight", SCREEN_SIZE[1]]]) Object.defineProperty(screen, name, { get: () => size });
    Object.defineProperty(screen, "orientation", { get: () => ({ type: SCREEN_SIZE[0] > SCREEN_SIZE[1] ? "landscape-primary" : "portrait-primary", angle: SCREEN_SIZE[0] > SCREEN_SIZE[1] ? 90 : 0, addEventListener() {}, removeEventListener() {} }) });
    Object.defineProperty(PointerEvent.prototype, "pointerType", { get: () => "touch" });

    // Every media rule, as each sheet arrives: the page's first-paint styles, and the site's sheet that follows them.
    const done = new WeakSet();
    let rewrittenCount = 0, safeAreaCount = 0;
    const rewrite = (rules) => {
      for (const rule of rules) {
        if (rule.media && rule.media.mediaText !== undefined) {
          const text = rule.media.mediaText, next = phoneMediaText(text);
          if (next !== text) { rule.media.mediaText = next; rewrittenCount += 1; }
        }
        if (rule.style && rule.style.cssText.includes("safe-area-inset")) { rule.style.cssText = phoneSafeAreaText(rule.style.cssText, SAFE_AREA_PX[screenName]); safeAreaCount += 1; }
        if (rule.cssRules) rewrite(rule.cssRules);
      }
    };
    const rewriteSheets = () => {
      for (const sheet of document.styleSheets) {
        if (done.has(sheet)) continue;
        try { rewrite(sheet.cssRules); done.add(sheet); } catch { /* still loading: its link's load comes back here */ }
      }
    };
    const follow = (node) => { if (node.nodeName === "LINK") node.addEventListener("load", rewriteSheets); };
    const watcher = new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) follow(node);
      rewriteSheets();
    });
    watcher.observe(document.documentElement, { childList: true, subtree: true });
    addEventListener("load", () => { rewriteSheets(); watcher.disconnect(); new MutationObserver(rewriteSheets).observe(document.head, { childList: true }); });
    window.zaismaBenchRewrittenCount = () => [rewrittenCount, safeAreaCount];

    // A mouse drag scrolls as a finger does, with its momentum after, and the click at its end does nothing.
    const DRAG_START_PX = 8, MOMENTUM_KEPT = 0.95, MOMENTUM_STOP_PX = 0.5;
    const noSelect = new CSSStyleSheet();
    noSelect.replaceSync("html { -webkit-user-select: none; user-select: none; } input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; } * { scrollbar-width: none; } *::-webkit-scrollbar { display: none; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, noSelect];
    let drag = null, isAfterDrag = false;
    addEventListener("click", (event) => { if (isAfterDrag) { isAfterDrag = false; event.stopImmediatePropagation(); event.preventDefault(); } }, true);
    // Whichever scroller under the finger still has room that way takes it, then the one round it, as on a phone.
    const scrollAlong = (start, axis, amountPx) => {
      for (let el = start; el; el = el === document.documentElement ? null : el.parentElement) {
        const style = getComputedStyle(el);
        const isPageScroller = el === document.scrollingElement;
        if (!isPageScroller && !/auto|scroll/.test(axis === "x" ? style.overflowX : style.overflowY)) continue;
        const before = axis === "x" ? el.scrollLeft : el.scrollTop;
        el.scrollBy({ left: axis === "x" ? amountPx : 0, top: axis === "y" ? amountPx : 0, behavior: "instant" });
        if ((axis === "x" ? el.scrollLeft : el.scrollTop) !== before) return el;
      }
      return null;
    };
    addEventListener("pointerdown", (event) => { if (event.button === 0 && !event.target.closest?.("input, textarea, select")) drag = { target: event.target, x: event.clientX, y: event.clientY, speed: 0, axis: "" }; }, true);
    addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      drag.x = event.clientX; drag.y = event.clientY;
      drag.speed = drag.axis === "x" ? -dx : -dy;
      noteHuman();
      scrollAlong(drag.target, drag.axis, drag.speed);
    }, true);
    addEventListener("pointerup", () => {
      if (!drag) return;
      const { axis, target } = drag;
      let { speed } = drag;
      drag = null;
      if (!axis) return;
      isAfterDrag = true;
      const coast = () => {
        if (Math.abs(speed) < MOMENTUM_STOP_PX) return;
        noteHuman();
        scrollAlong(target, axis, speed);
        speed *= MOMENTUM_KEPT;
        requestAnimationFrame(coast);
      };
      requestAnimationFrame(coast);
    }, true);
  }

  // What's done here, for the bench to copy.
  const HUMAN_WINDOW_MS = 300;
  let lastHumanAtMs = 0;
  function noteHuman() { lastHumanAtMs = performance.now(); }
  for (const kind of ["wheel", "pointerdown", "keydown", "touchmove"]) addEventListener(kind, noteHuman, { capture: true, passive: true });
  const say = (message) => { if (bench) bench.heard(screenName, groupName, message); };
  function pageChanged() { say({ kind: "page", address: pageAddress(), isSignedIn }); }
  const pageAddress = () => { const url = new URL(location.href); url.searchParams.delete("bench_screen"); url.searchParams.delete("bench_state"); return url.pathname + url.search.replace(/=(?=&|$)/g, "") + url.hash; };

  /** A path to the element that finds it again in the same page on another screen: its nearest id, then which of its kind at each step. */
  const pathOf = (element) => {
    const parts = [];
    for (let el = element; el && el !== document.documentElement; el = el.parentElement) {
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) { parts.unshift(`#${CSS.escape(el.id)}`); break; }
      let place = 1;
      for (let before = el.previousElementSibling; before; before = before.previousElementSibling) if (before.nodeName === el.nodeName) place += 1;
      parts.unshift(`${el.nodeName.toLowerCase()}:nth-of-type(${place})`);
    }
    return parts.join(" > ");
  };
  const isOurs = (event) => event.isTrusted && event.target instanceof Element;
  // A press on a control is the page's, on every screen; a press anywhere else opens this screen on the bench, unless a layer is open, which it may close.
  const PRESSABLE = "a[href], button, input, select, textarea, label, summary, video, [role=button], [role=tab], [role=menuitem], [role=option], [tabindex]:not([tabindex='-1']), [contenteditable], [aria-controls], dialog, [popover]";
  addEventListener("click", (event) => {
    if (!isOurs(event) || event.defaultPrevented) return;
    if (!event.target.closest(PRESSABLE) && !document.querySelector("dialog[open], [popover]:popover-open")) say({ kind: "open" });
    else say({ kind: "click", path: pathOf(event.target) });
  }, true);
  addEventListener("input", (event) => { if (isOurs(event)) say({ kind: "input", path: pathOf(event.target), text: event.target.value, isChecked: event.target.checked }); }, true);
  addEventListener("change", (event) => { if (isOurs(event) && /^(checkbox|radio)$|^select/.test(event.target.type)) say({ kind: "input", path: pathOf(event.target), text: event.target.value, isChecked: event.target.checked }); }, true);
  addEventListener("keydown", (event) => { if (event.isTrusted && event.key === "Escape") say({ kind: "escape" }); }, true);
  let scrollPending = null;
  addEventListener("scroll", (event) => {
    if (performance.now() - lastHumanAtMs > HUMAN_WINDOW_MS) return;
    const target = event.target === document ? document.scrollingElement : event.target;
    if (scrollPending) return;
    scrollPending = requestAnimationFrame(() => {
      scrollPending = null;
      const roomX = target.scrollWidth - target.clientWidth, roomY = target.scrollHeight - target.clientHeight;
      say({ kind: "scroll", path: target === document.scrollingElement ? null : pathOf(target), shareX: roomX > 0 ? target.scrollLeft / roomX : 0, shareY: roomY > 0 ? target.scrollTop / roomY : 0 });
    });
  }, { capture: true, passive: true });

  // What the bench asks. Each answers false when it can't be done on this screen.
  const isThere = (el) => el && el.getClientRects().length > 0;
  const allAnimations = () => document.getAnimations().filter((animation) => animation.effect);
  let playbackRate = 1;
  const slowNew = () => { if (playbackRate !== 1) for (const animation of allAnimations()) animation.playbackRate = playbackRate; };
  for (const kind of ["transitionrun", "animationstart"]) addEventListener(kind, slowNew, true);

  const setValue = (el, text, isChecked) => {
    if (el.type === "checkbox" || el.type === "radio") el.checked = isChecked;
    else Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const closeTopLayer = () => {
    const open = [...document.querySelectorAll("dialog[open], [popover]:popover-open")].pop();
    if (!open) return;
    if (open.matches("dialog")) open.close(); else open.hidePopover();
  };
  const SET_UP_TRIES = 20, SET_UP_RETRY_MS = 300;
  const enterState = async (state) => {
    await readyFor(state);
    for (const [id, words] of Object.entries(state.words ?? {})) { const el = document.getElementById(id); if (el) { if (!wordsAtRest.has(id)) wordsAtRest.set(id, el.textContent); el.textContent = words; } }
    if (state.opens) {
      const el = document.getElementById(state.opens);
      if (!el) return false;
      if (el.matches("dialog")) { if (!el.open) el.showModal(); }
      else if (el.popover !== null && el.popover !== undefined && el.hasAttribute("popover")) { if (!el.matches(":popover-open")) el.showPopover(); el.hidden = false; }
      else el.hidden = false;
      return true;
    }
    if (state.presses) { const el = document.querySelector(state.presses); if (!el) return false; el.click(); return true; }
    if (state.setUpName) {
      // The checks wait for the page to settle before their scripts run; here a page's own script may not be there yet, so it's tried again.
      for (let tryIndex = 0; ; tryIndex += 1) {
        try { await window.zaismaBenchSetUps[state.setUpName](); return true; } catch (problem) {
          if (tryIndex >= SET_UP_TRIES) throw problem;
          await new Promise((done) => setTimeout(done, SET_UP_RETRY_MS));
        }
      }
    }
    return true;
  };
  const wordsAtRest = new Map();
  const leaveState = (state) => {
    for (const id of Object.keys(state.words ?? {})) { const el = document.getElementById(id); if (el && wordsAtRest.has(id)) el.textContent = wordsAtRest.get(id); }
    if (state.opens) {
      const el = document.getElementById(state.opens);
      if (!el) return;
      if (el.matches("dialog")) el.close();
      else if (el.matches("[popover]:popover-open")) el.hidePopover();
      else el.hidden = true;
    } else if (state.presses) closeTopLayer();
  };
  // A state's setUp is the checks' own script, served as a function, so the site's script policy needn't allow eval.
  const readyFor = (state) => new Promise((done) => {
    if (!state.setUpName || window.zaismaBenchSetUps) return done();
    const script = document.createElement("script"); script.src = "/__preview/bench/states.js"; script.onload = done; script.onerror = done; document.head.append(script);
  });

  let pageSent = null;
  const pageAsSent = () => (pageSent ??= fetch(location.href).then((answered) => answered.text()).then((text) => new DOMParser().parseFromString(text, "text/html")));

  window.zaismaBenchScreen = {
    copy(message) {
      if (message.kind === "escape") { closeTopLayer(); return true; }
      if (message.kind === "scroll") {
        const target = message.path ? document.querySelector(message.path) : document.scrollingElement;
        if (!target) return false;
        target.scrollTo({ left: message.shareX * (target.scrollWidth - target.clientWidth), top: message.shareY * (target.scrollHeight - target.clientHeight), behavior: "instant" });
        return true;
      }
      const el = document.querySelector(message.path);
      if (!isThere(el)) return false;
      if (message.kind === "click") el.click();
      if (message.kind === "input") setValue(el, message.text, message.isChecked);
      return true;
    },
    enterState, leaveState,
    /**
     * The state's piece as a word, for its green mark, read while it rests: its markup, less what a press or a page's script changes, and the
     * style rules that name its classes. A state only a form reaches isn't on the page at rest, so it's the rules for the classes it had.
     */
    async lookOf(state, knownLook) {
      const known = /^rules-[a-z0-9]+-(.*)$/.exec(knownLook ?? "");
      const hashOf = (texts) => { let hash = 5381; for (const text of texts) for (let at = 0; at < text.length; at += 1) hash = ((hash * 33) ^ text.charCodeAt(at)) >>> 0; return hash.toString(36); };
      const rulesFor = (names) => {
        let rulesText = "";
        const walk = (rules) => { for (const rule of rules) { if (rule.selectorText && names.some((name) => rule.selectorText.includes(`.${name}`))) rulesText += rule.cssText; if (rule.cssRules) walk(rule.cssRules); } };
        for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* another site's */ } }
        return rulesText;
      };
      const namesIn = (el) => [...new Set([el, ...el.querySelectorAll("[class]")].flatMap((each) => (typeof each.className === "string" ? each.className.split(/\s+/) : [])).filter((name) => name && !/^is-/.test(name)))];
      const live = state.opens ? document.getElementById(state.opens) : state.presses ? document.querySelector(state.presses) : null;
      if (live) {
        // As the server sent it: a page's scripts change what's open and draw into it, and a look has to be the same each time.
        const sent = await pageAsSent();
        let el = state.opens ? sent.getElementById(state.opens) : sent.querySelector(state.presses);
        if (el && state.presses && el.getAttribute("aria-controls")) el = sent.getElementById(el.getAttribute("aria-controls")) ?? el;
        if (el) return `whole-${hashOf([el.outerHTML.replace(/\s(value|nonce)="[^"]*"/g, ""), rulesFor(namesIn(el))])}`;
      }
      if (known) return `rules-${hashOf([rulesFor(known[1].split(","))])}-${known[1]}`;
      const main = document.querySelector("main");
      if (!main) return null;
      const names = namesIn(main).slice(0, 200);
      return `rules-${hashOf([rulesFor(names)])}-${names.join(",")}`;
    },
    setTheme(theme) { document.documentElement.setAttribute("data-theme-choice", theme); document.documentElement.setAttribute("data-theme", theme); dispatchEvent(new Event("zaisma:theme")); },
    setPlaybackRate(rate) { playbackRate = rate; for (const animation of allAnimations()) animation.playbackRate = rate; },
    /** The slider: every animation held at this share of the way through; null lets them go. */
    scrub(share) {
      for (const animation of allAnimations()) {
        const { endTime } = animation.effect.getComputedTiming();
        if (share === null) { animation.play(); continue; }
        animation.pause();
        animation.currentTime = share * endTime;
      }
    },
  };

  addEventListener("DOMContentLoaded", () => { pageChanged(); });
  addEventListener("pageshow", () => { if (bench) bench.ready(screenName, groupName); });

  // On my phone's link: there's no bench to press it, so the page takes its state itself.
  const stateValue = asked.get("state");
  if (stateValue) addEventListener("load", async () => {
    const answered = await fetch(`/__preview/bench/state?value=${encodeURIComponent(stateValue)}`);
    if (answered.ok) enterState(await answered.json());
  });
})();
