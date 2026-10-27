import { html } from "../markup.ts";
import { notice } from "./panes.ts";
import { playingCard, urgentCard } from "./playing.ts";

/*
 * Everything that appears over a page or a running game, run one way (docs/DECISIONS.md, "One system for what appears over a page or a
 * game"): one queue for notices and the cards over a game, and one stack for sheets. The order between them (urgent over sheets,
 * information waiting for sheets to close) can't be kept by scripts that don't know about each other, so this one owns all of it, and pages
 * only ask: window.zaismaLayers.say, show, leave and step.
 */

/** How long information that went through stays before it leaves by itself, and with Undo. */
export const NOTICE_STAY_MS = 4000;
export const NOTICE_UNDO_STAY_MS = 8000;
/** Information waiting longer than this for a sheet or full screen to go is wrong by the time it would show ("Saved" a minute ago): it's dropped. */
export const STALE_INFORMATION_MS = 10000;
/** How many notices a page shows at once, stacked under the header; the rest wait. Over a game, one card at a time. */
export const MAXIMUM_PAGE_NOTICE_COUNT = 3;
/** Over a game, the next card comes this long after one leaves, so two never read as one. */
const NEXT_CARD_DELAY_MS = 300;
/** Sheets over sheets: a confirm on top of a sheet, never deeper. */
const MAXIMUM_OPEN_SHEET_COUNT = 2;

/** What a said notice or card is made from: the components' own markup, so a said one looks exactly like one a page puts there. */
const TEMPLATES = {
  done: notice({ text: "", tone: "done" }).html,
  undo: notice({ text: "", tone: "done", undoAction: "#" }).html,
  problem: notice({ text: "", tone: "problem" }).html,
  card: playingCard({ id: "layer-card", body: html`<p></p>` }).html,
  urgent: urgentCard({ id: "layer-urgent", title: "", text: "" }).html,
};

/**
 * window.zaismaLayers: the one owner of everything over a page or a game.
 *
 * The queue. say({ text, noticeUrgency, tone, undoAction, cardId, sheetsToClose }) answers a handle with leave(); show(card) and leave(card)
 * do the same for a playing card already on the page. Urgent goes first, then asks, then information, each oldest first. Over a game
 * (html.is-playing) one card shows at a time, the next 300 ms after one leaves; nothing but urgent shows while a sheet is open or the game is
 * in full screen, and information older than 10 s by its turn is dropped. On a page up to three notices stack under the header. Information
 * that went through leaves after 4 s (8 s with Undo), waiting while it's pointed at or touched; asks and problems stay until they're answered
 * or closed. Urgent is a popover shown after any sheet or full screen, so the top layer puts it over both, and shown again when a sheet opens.
 *
 * The stack. Sheets open and close through the dialog's own methods, wrapped here: two deep at most (a third replaces the top one, with a
 * warning, so a page bug still leaves a working sheet), and tapping beside, X or Esc close only the top one. A sheet's steps move forward
 * inside it (step) with Back; its tabs swap what's in it; closing resets both.
 *
 * The game hears it: zaisma:covered on the window with { coveredBy } ("sheet", "card" or null) whenever that changes, which the game page
 * passes to the game (Zaisma.page.coveredBy).
 *
 * A closed dialog leaves the top layer, and unless the browser keeps it there through the exit (CSS `overlay`, which iOS can claim without
 * doing), it's drawn inside whatever holds it, far from where it was, or not at all. So every close (Esc, a dialog-method button, a press
 * beside it, a script's close()) keeps it open while it leaves, in every browser, and only then closes it.
 */
export const LAYERS_SCRIPT = `/* layers */(function () {
  var NOTICE_STAY_MS = ${NOTICE_STAY_MS}, NOTICE_UNDO_STAY_MS = ${NOTICE_UNDO_STAY_MS}, STALE_INFORMATION_MS = ${STALE_INFORMATION_MS}, MAXIMUM_PAGE_NOTICE_COUNT = ${MAXIMUM_PAGE_NOTICE_COUNT}, NEXT_CARD_DELAY_MS = ${NEXT_CARD_DELAY_MS}, MAXIMUM_OPEN_SHEET_COUNT = ${MAXIMUM_OPEN_SHEET_COUNT}, LEAVE_MS = 300;
  var TEMPLATES = ${JSON.stringify(TEMPLATES)};
  var TURN = { urgent: 0, ask: 1, information: 2 };
  var root = document.documentElement;
  var isPlaying = function () { return root.classList.contains("is-playing"); };
  var isReduced = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var GAP_PX = parseFloat(getComputedStyle(root).getPropertyValue("--gap-control-stack")) || 8;
  // Everything queued or showing, in the order it came: { el, noticeUrgency, tone, text, undoAction, sheetsToClose, isMade, isShown, isOverGame, order, queuedAtMs, timer }.
  var entries = [], counter = 0, lastCardLeftAtMs = -Infinity, pumpTimer = null, coveredBy = null;
  // The sheets open, bottom first.
  var openSheets = [];

  /* ---- The queue ---- */

  // A card a page put there says its urgency (data-notice-urgency); one that doesn't is an ask when it has something to press.
  function urgencyOf(el) {
    var given = el.getAttribute("data-notice-urgency");
    if (given === "information" || given === "ask" || given === "urgent") return given;
    return el.querySelector("a, button, input, select, textarea") ? "ask" : "information";
  }
  function entryOf(el) { for (var i = 0; i < entries.length; i++) if (entries[i].el === el) return entries[i]; return null; }
  function handleOf(entry) { return { element: entry.el, leave: function () { leave(entry); } }; }
  function queue(entry) {
    entry.order = counter++;
    entry.queuedAtMs = Date.now();
    entry.isShown = false;
    entries.push(entry);
    pump();
    return handleOf(entry);
  }
  var byTurn = function (one, other) { return TURN[one.noticeUrgency] - TURN[other.noticeUrgency] || one.order - other.order; };
  // Information that went through: it leaves by itself, and is dropped when it waited too long. A problem is information that stays.
  var isPassing = function (entry) { return entry.noticeUrgency === "information" && entry.tone !== "problem"; };
  // Whose turn it is: urgent at once, whatever's open; the rest as the place allows.
  function pump() {
    clearTimeout(pumpTimer);
    pumpTimer = null;
    var nowMs = Date.now(), isOverGame = isPlaying(), isCovered = openSheets.length > 0 || Boolean(document.fullscreenElement);
    var waiting = entries.filter(function (entry) { return !entry.isShown; }).sort(byTurn);
    waiting.forEach(function (entry) { if (entry.noticeUrgency === "urgent") showUrgent(entry); });
    waiting = waiting.filter(function (entry) { return entry.noticeUrgency !== "urgent"; });
    var shownCount = entries.filter(function (entry) { return entry.isShown && entry.noticeUrgency !== "urgent" && entry.isOverGame === isOverGame; }).length;
    var room = isOverGame ? (isCovered ? 0 : 1) : MAXIMUM_PAGE_NOTICE_COUNT;
    var sinceLeftMs = nowMs - lastCardLeftAtMs;
    if (isOverGame && room && !shownCount && waiting.length && sinceLeftMs < NEXT_CARD_DELAY_MS) {
      pumpTimer = setTimeout(pump, NEXT_CARD_DELAY_MS - sinceLeftMs);
      return tellCovered();
    }
    for (var i = 0; i < waiting.length && shownCount < room; i++) {
      var entry = waiting[i];
      if (isOverGame && isPassing(entry) && nowMs - entry.queuedAtMs > STALE_INFORMATION_MS) { drop(entry); continue; }
      show(entry);
      shownCount++;
    }
    tellCovered();
  }
  function drop(entry) {
    var index = entries.indexOf(entry);
    if (index !== -1) entries.splice(index, 1);
    if (entry.el && !entry.isMade && entry.el.matches(".notice")) entry.el.remove();
  }
  // A said one is made from the components' markup: a notice on a page, a playing card over a game, an urgent card anywhere.
  function make(entry) {
    var holder = document.createElement("template");
    var kind = entry.noticeUrgency === "urgent" ? "urgent" : isPlaying() ? "card" : entry.undoAction ? "undo" : entry.tone === "problem" ? "problem" : "done";
    holder.innerHTML = TEMPLATES[kind];
    var el = holder.content.firstElementChild;
    el.id = "layer-" + entry.order;
    el.setAttribute("data-notice-urgency", entry.noticeUrgency);
    if (kind === "urgent") {
      var title = el.querySelector(".playing-card-title");
      if (title) title.remove();
      el.querySelector(".urgent-card-text").textContent = entry.text;
    } else if (kind === "card") el.querySelector("p").textContent = entry.text;
    else {
      el.querySelector(".notice-text").textContent = entry.text;
      if (kind === "undo") el.querySelector("form").setAttribute("action", entry.undoAction);
    }
    el.zaismaLayer = entry;
    (document.querySelector("main") || document.body).appendChild(el);
    return el;
  }
  function show(entry) {
    if (!entry.el) entry.el = make(entry);
    entry.isShown = true;
    entry.isOverGame = isPlaying();
    var el = entry.el;
    el.classList.remove("is-leaving");
    el.hidden = false;
    hold(entry);
    if (isPassing(entry)) wait(entry);
    if (el.matches(".notice")) stack();
  }
  function showUrgent(entry) {
    (entry.sheetsToClose || []).forEach(function (id) { var sheet = document.getElementById(id); if (sheet && sheet.open) sheet.close(); });
    if (!entry.el) entry.el = make(entry);
    entry.isShown = true;
    entry.isOverGame = isPlaying();
    entry.el.hidden = false;
    raise(entry.el);
  }
  // Shown last, so it's over every sheet and full screen in the top layer.
  function raise(el) {
    if (!el.showPopover) return;
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
  }
  function raiseUrgent() { entries.forEach(function (entry) { if (entry.isShown && entry.noticeUrgency === "urgent") raise(entry.el); }); }
  function wait(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(function () { leave(entry); }, entry.undoAction || entry.el.hasAttribute("data-notice-undo") ? NOTICE_UNDO_STAY_MS : NOTICE_STAY_MS);
  }
  // Pointed at or touched, it waits; let go, it starts its whole time again.
  function hold(entry) {
    var el = entry.el;
    if (el.zaismaHeld) return;
    el.zaismaHeld = true;
    var stop = function () { var now = entryOf(el); if (now) clearTimeout(now.timer); };
    el.addEventListener("pointerenter", stop);
    el.addEventListener("pointerdown", stop);
    el.addEventListener("pointerleave", function () { var now = entryOf(el); if (now && now.isShown && isPassing(now)) wait(now); });
  }
  function leave(entry) {
    var index = entries.indexOf(entry);
    if (index === -1) return;
    entries.splice(index, 1);
    clearTimeout(entry.timer);
    if (entry.isShown) {
      var el = entry.el;
      entry.isShown = false;
      if (el.hidePopover && el.matches(":popover-open")) el.hidePopover();
      if (el.matches(".notice")) {
        el.classList.add("is-leaving");
        setTimeout(function () { el.remove(); stack(); }, LEAVE_MS);
      } else {
        el.hidden = true;
        if (entry.isMade) setTimeout(function () { el.remove(); }, LEAVE_MS);
      }
      if (entry.isOverGame && entry.noticeUrgency !== "urgent") lastCardLeftAtMs = Date.now();
    }
    pump();
  }
  // Each notice on a page sits under the ones before it.
  function stack() {
    var shiftPx = 0;
    entries.filter(function (entry) { return entry.isShown && entry.el.matches(".notice"); }).sort(function (one, other) { return one.order - other.order; }).forEach(function (entry) {
      entry.el.style.setProperty("--notice-shift", shiftPx + "px");
      shiftPx += entry.el.offsetHeight + GAP_PX;
    });
  }
  function tellCovered() {
    var now = openSheets.length ? "sheet" : entries.some(function (entry) { return entry.isShown && entry.el.matches(".playing-card"); }) ? "card" : null;
    if (now === coveredBy) return;
    coveredBy = now;
    layers.coveredBy = now;
    window.dispatchEvent(new CustomEvent("zaisma:covered", { detail: { coveredBy: now } }));
  }
  // A notice a page puts there (after a form posts, or added later) waits its turn like a said one; the gallery's still copies stay put.
  function arrive(el) {
    if (el.zaismaLayer || el.classList.contains("in-place")) return;
    var entry = { el: el, noticeUrgency: urgencyOf(el), tone: el.getAttribute("data-notice") === "problem" ? "problem" : "done" };
    el.zaismaLayer = entry;
    el.hidden = true;
    queue(entry);
  }
  function find(node) {
    if (!node.querySelectorAll) return;
    if (node.matches("[data-notice]")) arrive(node);
    node.querySelectorAll("[data-notice]").forEach(arrive);
  }
  find(document.body);
  if (window.zaismaWatch) window.zaismaWatch.page(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(find); }); });
  // A card the page hides itself (a swipe, its own answer) has left.
  var hiddenWatch = window.MutationObserver ? new MutationObserver(function (changes) {
    changes.forEach(function (change) { var entry = entryOf(change.target); if (entry && entry.isShown && change.target.hidden) leave(entry); });
  }) : null;
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target.closest) return;
    // A notice's Close, and anything pressed in an urgent card (its Close, Sign in), let it go.
    var closer = target.closest("[data-layer-close]");
    var card = closer && closer.closest("[data-notice], .urgent-card");
    if (!card) { var pressed = target.closest("a, button"); card = pressed && pressed.closest(".urgent-card"); }
    var entry = card && entryOf(card);
    if (entry) leave(entry);
  });
  document.addEventListener("fullscreenchange", function () { raiseUrgent(); pump(); });

  /* ---- The stack ---- */

  var close = HTMLDialogElement.prototype.close, showModal = HTMLDialogElement.prototype.showModal;
  function isLeaving(sheet) { return sheet.open && sheet.matches(".sheet") && !sheet.classList.contains("in-place"); }
  function forget(sheet) {
    var index = openSheets.indexOf(sheet);
    if (index === -1) return;
    openSheets.splice(index, 1);
    pump();
  }
  function leaveSheet(sheet, closeArguments) {
    if (sheet.classList.contains("is-leaving")) return;
    sheet.classList.add("is-leaving");
    forget(sheet);
    var timer = setTimeout(done, 400);
    function end(event) { if (event.target === sheet && event.propertyName === "opacity") done(); }
    function done() { clearTimeout(timer); sheet.removeEventListener("transitionend", end); if (!sheet.classList.contains("is-leaving")) return; sheet.classList.remove("is-leaving"); close.apply(sheet, closeArguments); }
    sheet.addEventListener("transitionend", end);
  }
  // On a wide screen a sheet opened by a button hangs from it like a dropdown (zaismaPlace): toward the middle of the window, under it or above it,
  // kept inside the window, and following it as the page scrolls or the window changes; a phone keeps its sheet at the foot (the CSS).
  var wide = window.matchMedia ? window.matchMedia("(min-width: 761px)") : { matches: false }, anchors = new Map(), GAP_PX_SHEET = 8, EDGE_PX = 16;
  // The button it opens from is the one pressed a moment before (a page may open its sheet itself, after fetching what's in it); a sheet opened
  // with no press behind it, or from a button inside a dropdown, which closes, stays centered.
  var pressed = null;
  document.addEventListener("click", function (event) { var button = event.target.closest && event.target.closest("button, a, [role='button']"); pressed = button ? { button: button, at: performance.now() } : null; }, true);
  HTMLDialogElement.prototype.showModal = function () {
    var wasOpen = this.open, isSheet = this.matches(".sheet") && !this.classList.contains("in-place");
    if (!wasOpen && isSheet) {
      // Two deep at most: a third replaces the top one, and says so, so a page that nests too deep shows in the preview.
      if (openSheets.length >= MAXIMUM_OPEN_SHEET_COUNT) {
        var top = openSheets[openSheets.length - 1];
        console.warn("Sheets go two deep at most: #" + this.id + " replaces #" + top.id + ".");
        forget(top);
        top.classList.remove("is-leaving");
        close.apply(top);
      }
      this.zaismaOpener = document.activeElement;
    }
    // A confirm opened over another sheet is drawn a size smaller, in the middle of it (the CSS).
    if (!wasOpen && isSheet) this.classList.toggle("is-over-sheet", openSheets.length > 0);
    showModal.apply(this, arguments);
    if (wasOpen || !isSheet) return;
    openSheets.push(this);
    anchor(this);
    place(this);
    // Its tab row is drawn once it has its place and its width.
    drawTabRows(this, true);
    focusSheet(this);
    raiseUrgent();
    pump();
  };
  // Focus moves into a sheet as it opens (a screen reader and the keyboard need it there), but a ring only ever shows for the keyboard: opened by a
  // press (a mouse, a touch), the sheet takes the focus itself, no ring, and Tab goes on to its first control; opened from the keyboard, the browser's
  // choice (its first control, or the one marked autofocus) stands. Closing returns the focus to what opened it, in the sheet beneath when there's one.
  function focusSheet(sheet) {
    if (window.zaismaInput && window.zaismaInput.isKeyboard()) return;
    sheet.setAttribute("tabindex", "-1");
    sheet.focus({ preventScroll: true });
  }
  // Where a sheet opens is its kind's, never how it was opened (docs/DESIGN.md, "Every pane opens where its kind says"): a small sheet (compact)
  // hangs from the button that opened it, on every screen; every other sheet keeps its own place (centered, at the foot, at the side, in the
  // middle). A small one opened with no button to hang from (a game asked for it) takes a task sheet's place.
  function anchor(sheet) {
    var opener = pressed && performance.now() - pressed.at < 2000 && pressed.button.isConnected ? pressed.button : null;
    if (!opener || !sheet.classList.contains("is-compact") || sheet.matches(".in-place, .placement-side, .placement-middle, .is-picture") || opener.closest("[popover]") || sheet.contains(opener) || opener.closest("dialog[open]")) return;
    anchors.set(sheet, { opener: opener, rect: opener.getBoundingClientRect() });
    sheet.classList.add("is-anchored");
    sheet.classList.toggle("is-on-page", Boolean(window.zaismaIsOnPage && window.zaismaIsOnPage(opener, sheet)));
    // What loads in it after it opens (a screenshot) changes its size: it's placed again, so it stays inside the window.
    if (resized) resized.observe(sheet);
  }
  function place(sheet) {
    var held = anchors.get(sheet);
    if (!held || !sheet.open) return;
    var rect = held.opener.isConnected ? held.opener.getBoundingClientRect() : held.rect;
    if (rect.width || rect.height) held.rect = rect; else rect = held.rect;
    var windowWidth = document.documentElement.clientWidth, windowHeight = window.innerHeight;
    if (rect.bottom < 0 || rect.top > windowHeight || rect.right < 0 || rect.left > windowWidth) { sheet.close(); return; }
    sheet.style.setProperty("--sheet-max-height", (windowHeight - 2 * EDGE_PX) + "px");
    // On a phone it hangs only where it fits whole above or below its button; otherwise it rises from the foot like any sheet there.
    var roomPx = Math.max(rect.top, windowHeight - rect.bottom) - GAP_PX_SHEET - EDGE_PX;
    sheet.classList.toggle("is-anchored", wide.matches || sheet.offsetHeight <= roomPx);
    if (!sheet.classList.contains("is-anchored")) return;
    var spot = window.zaismaPlace(rect, { width: sheet.offsetWidth, height: sheet.offsetHeight }, { roomRect: { left: 0, top: 0, right: windowWidth, bottom: windowHeight }, gapPx: GAP_PX_SHEET, edgePx: EDGE_PX });
    // Riding the page, it's placed in the page's coordinates, so the page's own scroll carries it with no script between; this runs again on
    // a scroll only to keep it inside the window or flip it, which leaves the numbers as they were while neither is needed.
    var isOnPage = sheet.classList.contains("is-on-page");
    sheet.style.setProperty("--sheet-left", Math.round(spot.leftPx + (isOnPage ? window.scrollX : 0)) + "px");
    sheet.style.setProperty("--sheet-top", Math.round(spot.topPx + (isOnPage ? window.scrollY : 0)) + "px");
    sheet.classList.toggle("is-above", spot.isAbove); sheet.classList.toggle("is-at-end", spot.isAtEnd);
  }
  function placeAll() { anchors.forEach(function (held, sheet) { place(sheet); }); }
  var resized = window.ResizeObserver ? new ResizeObserver(function (changed) { changed.forEach(function (change) { if (anchors.has(change.target)) place(change.target); }); }) : null;
  window.addEventListener("resize", placeAll);
  window.addEventListener("scroll", placeAll, { passive: true, capture: true });
  document.addEventListener("close", function (event) {
    var sheet = event.target;
    if (!sheet.matches || !sheet.matches(".sheet")) return;
    forget(sheet);
    // Closing resets its steps and tabs to the first, out of sight, and lets go of the height it kept.
    reset(sheet);
    var opener = sheet.zaismaOpener, beneath = openSheets[openSheets.length - 1];
    sheet.zaismaOpener = null;
    if (beneath) (opener && opener.isConnected && beneath.contains(opener) ? opener : beneath).focus({ preventScroll: true });
    if (!anchors.has(sheet)) return;
    anchors.delete(sheet);
    if (resized) resized.unobserve(sheet);
    sheet.classList.remove("is-anchored", "is-above", "is-at-end", "is-on-page");
    sheet.style.removeProperty("--sheet-left"); sheet.style.removeProperty("--sheet-top"); sheet.style.removeProperty("--sheet-max-height");
  }, true);
  HTMLDialogElement.prototype.close = function () { if (isLeaving(this)) leaveSheet(this, arguments); else close.apply(this, arguments); };
  // Esc closes the top sheet only: the browser sends it there, the one modal that isn't inert.
  document.addEventListener("cancel", function (event) { if (event.target.matches && isLeaving(event.target)) { event.preventDefault(); leaveSheet(event.target, []); } }, true);
  document.addEventListener("submit", function (event) {
    // A page that handles its form itself (Send report) keeps its sheet open.
    if (event.defaultPrevented) return;
    var method = (event.submitter && event.submitter.getAttribute("formmethod")) || event.target.getAttribute("method");
    var sheet = event.target.closest("dialog");
    if (!method || method.toLowerCase() !== "dialog" || !sheet || !isLeaving(sheet)) return;
    event.preventDefault();
    leaveSheet(sheet, event.submitter && event.submitter.hasAttribute("value") ? [event.submitter.value] : []);
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest) return;
    var opener = event.target.closest("[aria-controls]:not([aria-expanded])");
    var named = opener && document.getElementById(opener.getAttribute("aria-controls"));
    if (named && named.matches("dialog.sheet")) {
      event.preventDefault();
      // Pressed again while it leaves: it stays.
      if (named.classList.contains("is-leaving")) { named.classList.remove("is-leaving"); if (openSheets.indexOf(named) === -1) openSheets.push(named); pump(); }
      if (!named.open) named.showModal();
      return;
    }
    // A button that names a step moves its sheet there, as one that names a sheet opens it; one that names a card puts it in the queue.
    var forward = event.target.closest("[data-sheet-step-to]");
    var forwarded = forward && forward.closest("dialog");
    if (forwarded) { event.preventDefault(); step(forwarded, forward.getAttribute("data-sheet-step-to")); return; }
    var shower = event.target.closest("[data-layer-show]");
    if (shower) { event.preventDefault(); layers.say({ cardId: shower.getAttribute("data-layer-show") }); return; }
    var back = event.target.closest("[data-sheet-back]");
    if (back) { var stepped = back.closest("dialog"); if (stepped && stepped.zaismaSteps && stepped.zaismaSteps.length > 1) step(stepped, stepped.zaismaSteps[stepped.zaismaSteps.length - 2]); return; }
    var tab = event.target.closest("[data-sheet-tab-to]");
    var tabbed = tab && tab.closest("dialog");
    if (tabbed) { chooseTab(tabbed, tab.getAttribute("data-sheet-tab-to")); return; }
    // A light box goes on a press anywhere in it but its own controls, when it's the top layer.
    var box = event.target.closest("dialog.light-box[open]");
    if (box && openSheets[openSheets.length - 1] === box && !event.target.closest("a, button, input")) { box.close(); return; }
    // A press beside the top sheet closes it, and only it.
    var open = event.target.matches("dialog.sheet[open]") ? event.target : null;
    if (!open || !event.detail || openSheets[openSheets.length - 1] !== open) return;
    var r = open.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) open.close();
  });

  /* ---- Steps and tabs: what's in one sheet changes, the sheet stays ---- */

  // The sheet keeps the tallest it's been while it's open on a wide screen, so moving between its steps or tabs never makes it jump.
  function keepHeight(sheet) {
    if (!wide.matches || !sheet.open || sheet.classList.contains("in-place")) return;
    var heightPx = sheet.offsetHeight;
    if (heightPx > (parseFloat(sheet.style.minHeight) || 0)) sheet.style.minHeight = heightPx + "px";
  }
  // direction: 1 forward, -1 back, 0 no slide.
  function showPart(sheet, attribute, name, direction) {
    keepHeight(sheet);
    var shown = null;
    sheet.querySelectorAll("[" + attribute + "]").forEach(function (part) { var isIt = part.getAttribute(attribute) === name; part.hidden = !isIt; if (isIt) shown = part; });
    if (shown) {
      shown.classList.remove("is-from-end", "is-from-start");
      if (direction && !isReduced()) { void shown.offsetWidth; shown.classList.add(direction > 0 ? "is-from-end" : "is-from-start"); }
      // The edge rule cuts a piece by where it sits, and mid-slide it sits off to the side: once the slide is over (or at once, with none),
      // everything cut in it is drawn again where it is, so a choice at the sheet's foot takes both corners' cuts.
      var redraw = function () { shown.querySelectorAll("[data-cut-line]").forEach(function (el) { if (el.redrawCut) el.redrawCut(); }); };
      if (shown.classList.contains("is-from-end") || shown.classList.contains("is-from-start")) shown.addEventListener("animationend", redraw, { once: true }); else if (window.requestAnimationFrame) requestAnimationFrame(redraw);
    }
    return shown;
  }
  function firstOf(sheet, attribute) { var first = sheet.querySelector("[" + attribute + "]"); return first ? first.getAttribute(attribute) : null; }
  // Forward to a step (Back goes to the one before), or to one already passed, back; isBackShown false starts there, with no Back.
  function step(sheet, stepName, options) {
    var steps = options && options.isBackShown === false ? [] : sheet.zaismaSteps || [firstOf(sheet, "data-sheet-step")];
    var at = steps.indexOf(stepName);
    if (at === -1) steps.push(stepName); else steps.length = at + 1;
    sheet.zaismaSteps = steps;
    var shown = showPart(sheet, "data-sheet-step", stepName, sheet.open ? (at === -1 ? 1 : -1) : 0);
    if (!shown) return;
    var back = shown.querySelector("[data-sheet-back]");
    if (back) back.hidden = steps.length < 2;
    var title = shown.querySelector(".sheet-title");
    if (title && title.id) sheet.setAttribute("aria-labelledby", title.id);
  }
  function reset(sheet) {
    sheet.style.minHeight = "";
    if (sheet.zaismaSteps) { sheet.zaismaSteps = null; var first = firstOf(sheet, "data-sheet-step"); step(sheet, first); sheet.zaismaSteps = null; }
    var firstTab = sheet.querySelector("[data-sheet-tab-to]");
    if (firstTab) chooseTab(sheet, firstTab.getAttribute("data-sheet-tab-to"));
  }
  // A tab chosen: its part shows, it's the pressed one in the row, the front piece's outline moves to it, and it scrolls into view.
  function chooseTab(sheet, tabValue) {
    showPart(sheet, "data-sheet-tab", tabValue, 0);
    sheet.querySelectorAll("[data-sheet-tab-to]").forEach(function (button) { button.setAttribute("aria-pressed", String(button.getAttribute("data-sheet-tab-to") === tabValue)); });
    drawTabRows(sheet, true);
  }
  // The tab row: behind (the deeper glass) everywhere in it but the chosen tab, drawn inside its scrolling track so it moves with the tabs, its
  // shadow along the front piece's outline; and the sheet's own glass edge (GLASS_SCRIPT, zaismaEdgeShape) drawn along that outline: up the
  // chosen tab's outward slants, across its top, along the row's foot beside it, and round the rest of the sheet. isRevealing scrolls the
  // chosen tab into view.
  var TAB_SLANT_PX = 8;
  function drawTabRows(holder, isRevealing) {
    (holder.classList && holder.classList.contains("sheet-tab-scroll") ? [holder.querySelector(".sheet-tab-track")] : holder.querySelectorAll(".sheet-tab-track")).forEach(function (track) {
      var chosen = track.querySelector('[data-sheet-tab-to][aria-pressed="true"]'), svg = track.querySelector(".sheet-tab-outline");
      if (!chosen || !svg) return;
      // Drawn again whenever the row changes size (the sheet settling into its place, the fonts arriving).
      if (!track.zaismaWatched && window.zaismaWatch) { track.zaismaWatched = true; window.zaismaWatch.size(track, function () { drawTabRows(track.parentNode, false); }); }
      var w = track.offsetWidth, h = track.offsetHeight, s = TAB_SLANT_PX;
      var left = chosen.offsetLeft, right = left + chosen.offsetWidth;
      var behind = "M0,0H" + w + "V" + h + "H" + right + "L" + (right - s) + ",0H" + (left + s) + "L" + left + "," + h + "H0Z";
      svg.querySelector(".behind-glass").setAttribute("d", behind);
      svg.querySelector(".behind-well").setAttribute("d", behind);
      // The front piece's shadow falls only on what's behind it: the line along its outline, kept to the behind shape.
      var shadow = svg.querySelector(".front-shadow");
      shadow.setAttribute("points", [[0, h], [left, h], [left + s, 0], [right - s, 0], [right, h], [w, h]].map(function (p) { return p.join(","); }).join(" "));
      shadow.style.clipPath = 'path("' + behind + '")';
      var scroller = track.parentNode;
      if (isRevealing && scroller && scroller.scrollTo) {
        var shownLeft = scroller.scrollLeft, shownRight = shownLeft + scroller.clientWidth;
        if (left < shownLeft || right > shownRight) scroller.scrollTo({ left: left < shownLeft ? left - 24 : right - scroller.clientWidth + 24, behavior: isReduced() ? "auto" : "smooth" });
      }
      markMore(scroller);
      outlineSheet(track);
    });
  }
  // The sheet's glass edge along its front piece: where the chosen tab is in the sheet now (the row scrolls), kept to what shows of the row.
  function outlineSheet(track) {
    var sheet = track.closest && track.closest(".sheet"), row = track.closest && track.closest(".sheet-tab-row");
    if (!sheet || !row || !sheet.getBoundingClientRect) return;
    sheet.zaismaEdgeShape = function (w, h, cuts) {
      var chosen = track.querySelector('[data-sheet-tab-to][aria-pressed="true"]'), scroller = track.parentNode;
      if (!chosen || !scroller) return null;
      var box = sheet.getBoundingClientRect(), tab = chosen.getBoundingClientRect(), shown = scroller.getBoundingClientRect(), foot = row.getBoundingClientRect().bottom - box.top, s = TAB_SLANT_PX;
      var left = Math.max(tab.left, shown.left) - box.left, right = Math.min(tab.right, shown.right) - box.left;
      var points = [];
      // Its top: the sheet's corner cut where the chosen tab is at the sheet's start or end, a slant up and down where it isn't.
      if (left <= 1) points.push([0, cuts[0]], [cuts[0], 0]); else points.push([0, foot], [left, foot], [left + s, 0]);
      if (right >= w - 1) points.push([w - cuts[1], 0], [w, cuts[1]]); else points.push([right - s, 0], [right, foot], [w, foot]);
      points.push([w, h - cuts[2]], [w - cuts[2], h], [cuts[3], h], [0, h - cuts[3]]);
      return right - left > 2 * s ? points : null;
    };
    if (sheet.redrawGlass) sheet.redrawGlass();
  }
  // Where there's more to scroll, the row fades out at that end.
  function markMore(scroller) {
    if (!scroller || !scroller.classList) return;
    scroller.classList.toggle("is-more-start", scroller.scrollLeft > 1);
    scroller.classList.toggle("is-more-end", scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1);
  }
  document.addEventListener("scroll", function (event) {
    if (!event.target.classList || !event.target.classList.contains("sheet-tab-scroll")) return;
    markMore(event.target);
    // The chosen tab moved in the sheet: its glass edge follows.
    var track = event.target.querySelector(".sheet-tab-track");
    if (track) outlineSheet(track);
  }, true);
  // Rows on the page as it opens (a gallery's still copy), and again when the window or the fonts change their size.
  var drawAllTabRows = function () { if (document.body) drawTabRows(document.body, false); };
  drawAllTabRows();
  window.addEventListener("resize", drawAllTabRows);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAllTabRows);

  var layers = window.zaismaLayers = {
    coveredBy: null,
    openSheets: openSheets,
    say: function (options) {
      var el = options.cardId ? document.getElementById(options.cardId) : null;
      if (options.cardId && !el) return null;
      // A card already queued or showing, or the same words said again while they're up, is one notice.
      var known = el ? entryOf(el) : entries.filter(function (entry) { return entry.isMade && entry.text === options.text; })[0];
      if (known) return handleOf(known);
      var noticeUrgency = options.noticeUrgency || (el ? urgencyOf(el) : "information");
      // An urgent card may say itself which sheets can't go on under it (urgentCard's sheetsToClose).
      var sheetsToClose = options.sheetsToClose || (el && el.getAttribute("data-sheets-to-close") ? el.getAttribute("data-sheets-to-close").split(" ") : []);
      var entry = { el: el, text: options.text || "", noticeUrgency: noticeUrgency, tone: options.tone === "problem" ? "problem" : "done", undoAction: options.undoAction || null, sheetsToClose: sheetsToClose, isMade: !el };
      if (el) { el.zaismaLayer = entry; if (hiddenWatch) hiddenWatch.observe(el, { attributes: true, attributeFilter: ["hidden"] }); }
      return queue(entry);
    },
    show: function (card) { return card ? layers.say({ cardId: card.id }) : null; },
    leave: function (card) { var entry = card && entryOf(card.element || card); if (entry) leave(entry); },
    step: step,
  };
  pump();
})();
`;
