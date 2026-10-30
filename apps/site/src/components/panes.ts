import { SIZED_IMAGE_WIDTHS_PX } from "@zaisma/core";
import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
// The materials register first: the Materials page starts with them.
import "./materials.ts";
import { CUT_LINE, EDGE, ago, divider, floatingPane, glassPane, groove, icon, sheetMarkup, tag, tray, well, type IconName } from "./foundations.ts";
import { doneState, emptyState, glanceFacts, problemState, listRows, pictureFrame, pictureRow, type GlanceFacts } from "./data.ts";
import { cardRow, secondaryButton, tertiaryButton, primaryButton, textLink, toggleButton } from "./actions.ts";
import { REPORT_REASONS, choiceCards, copyField, cutField, longField, tabSwitch, wheelField } from "./inputs.ts";
import { STAND_IN_GAME_ICON, STAND_IN_QR_CODE, qrCode } from "./qr-code.ts";
import { examplePane } from "./example-pane.ts";
import { lightBox } from "./light-box.ts";
export { lightBox, type LightBoxOptions } from "./light-box.ts";
import { grid, paneParts, row, stack, type ControlMarkup, type LayoutItem, type LayoutMarkup, stackOfOne } from "./layout.ts";

/*
 * Panes: Zaisma's glass as a sheet that holds things (the sign-in's pane), a menu that hangs
 * from a button, and a game's cover. From the sign-in, header and home drafts.
 */

const control = (markup: ControlMarkup): LayoutItem => ({ kind: "control", markup });

/** A dropdown's choice: a link, a button that posts a form (like Sign out), or a button that asks first in a confirm sheet. */
export interface DropdownChoice {
  label: string;
  href?: string;
  /** Where a button posts, in place of a link. */
  action?: string;
  /**
   * The confirm sheet it opens (its id), in place of a link, for a choice that's hard to take back: Sign out everywhere, Remove friend.
   * It looks like any other choice, never red: only a delete's confirm step is.
   */
  confirmSheetId?: string;
  /** A button a page's script answers (a player's Block), in place of a link. */
  isButton?: boolean;
  /** The sheet or light box it opens (its id), as a button that names it (Show QR code). */
  controls?: string;
  /** Unique on the page, for the page's script to find it by (the game page's Keep your progress). */
  id?: string;
  /** Not shown for now: a page script shows it (Keep your progress, once there's progress to keep). Arrow keys skip it. */
  isHidden?: boolean;
  /** A link that opens in a new tab, so the page it's on keeps running (the rules from beside a running game): it ends in the out-of-the-page arrow. */
  isNewTab?: boolean;
  /** data-* attributes a page's script reads ({ report: "" } is data-report=""), names in lowercase words joined by dashes. */
  dataAttributes?: Record<string, string>;
  /** The page you're on, or the choice that's made: it sits on a slab with the orange line, like a switch's. */
  isCurrent?: boolean;
  icon?: IconName;
  /** A small number at its end, like unread replies: a Tag. */
  badgeCount?: number;
  /** Pointed at or focused: the gallery's still copies. */
  state?: "is-pointed" | "is-focused";
}

/** A dropdown's item: a choice, or a rule between groups of them. */
export type DropdownItem = DropdownChoice | { kind: "rule" };

/** A dropdown's row: a compact flush row (materials.ts), for any menu that makes its own rows (the Filter menu's groups) to share. */
export const DROPDOWN_CHOICE_CLASS = "dropdown-choice flush-row compact";

/**
 * One choice in a dropdown: words with an icon, a faint slab under the pointer, the slab with the orange line when it's the current one.
 * In a dropdown it's a menu item the arrow keys move between; in Menu choices it's an ordinary link or button Tab reaches.
 */
function dropdownChoice(choice: DropdownChoice, isInMenu = true): Raw {
  const inside = html`${CUT_LINE}${choice.icon ? icon(choice.icon) : ""}<span class="one-line">${choice.label}</span>${choice.badgeCount ? tag(choice.badgeCount, "count") : ""}${choice.isNewTab ? html`<span class="dropdown-out" aria-hidden="true">${icon("out-of-page")}</span>` : ""}`;
  const dataMarkup = choice.dataAttributes ? html`${Object.entries(choice.dataAttributes).map(([name, text]) => html` data-${name}="${text}"`)}` : "";
  const shared = html` class="${DROPDOWN_CHOICE_CLASS}${choice.state ? ` ${choice.state}` : ""}"${isInMenu ? raw(' role="menuitem" tabindex="-1"') : ""} data-cut-line="8"${choice.id ? html` id="${choice.id}"` : ""}${choice.isHidden ? raw(" hidden") : ""}${choice.isCurrent ? raw(' aria-current="page"') : ""}`;
  if (choice.action !== undefined) return html`<form class="dropdown-form" method="post" action="${choice.action}"><button type="submit"${shared}>${inside}</button></form>`;
  if (choice.confirmSheetId !== undefined) return html`<button type="button" aria-controls="${choice.confirmSheetId}"${shared}>${inside}</button>`;
  if (choice.controls !== undefined) return html`<button type="button" aria-controls="${choice.controls}"${dataMarkup}${shared}>${inside}</button>`;
  if (choice.isButton) return html`<button type="button"${dataMarkup}${shared}>${inside}</button>`;
  return html`<a href="${choice.href ?? "#"}"${choice.isNewTab ? raw(' target="_blank" rel="noopener"') : ""}${dataMarkup}${shared}>${inside}</a>`;
}

export interface DropdownOptions {
  /** Its button's aria-controls. */
  id: string;
  /** What it is, for a screen reader: "Your account". */
  label: string;
  /**
   * A head over its places, like the account's name and whether you're online. lineId: a quiet line under them that a page's script
   * writes and shows (the game page's "Saved 2 min ago"), hidden until it does.
   */
  head?: { title: string; note?: string; lineId?: string };
  items: DropdownItem[];
  isOpen?: boolean;
}

/** A dropdown: a Floating pane that hangs from any button (aria-controls its id), holding a short list of choices. */
export function dropdown(options: DropdownOptions): Raw {
  const head = options.head ? html`<div class="dropdown-head words-margin at-top"><strong>${options.head.title}</strong>${options.head.note ? html`<span>${options.head.note}</span>` : ""}${options.head.lineId ? html`<span id="${options.head.lineId}" role="status" hidden></span>` : ""}</div>${divider({ isDecorative: true })}` : "";
  const choices = html`<div class="dropdown-in">${options.items.map((menuItem) => ("kind" in menuItem ? divider() : dropdownChoice(menuItem)))}</div>`;
  return html`${floatingPane({ id: options.id, placement: "under", kind: "dropdown", role: "menu", label: options.label, isShownInPlace: options.isOpen, head: head || undefined, body: choices })}`;
}

/** The same facts as the glance list, short, under a cover: when you played, an update or friends on the left, players now on the right. */
function coverFacts(facts: GlanceFacts, title?: string): Raw {
  const nowMs = Date.now();
  const friends = facts.friends ?? [];
  const left = facts.deviceNote
    ? html`<span class="device-note">${facts.deviceNote}</span>`
    : facts.playedAtMs !== undefined
      ? html`<span class="when">${icon("clock")}<span><span class="sr">Played </span>${ago(nowMs - facts.playedAtMs)}</span></span>${facts.updatedAtMs !== undefined ? html`${tag("Updated", "new")}` : ""}`
      : friends.length
        ? html`<span class="friends">${pictureRow(friends.map((friend) => friend.username), "xs")}<span>${friends.map((friend) => friend.username).join(", ")}<span class="sr"> playing</span></span></span>`
        : "";
  // A paid game's price to play leads what's said under its cover.
  const priced = facts.priceText ? html`${tag(facts.priceText, "plain")}${left}` : left;
  // With its title shown, the title leads the row and anything else it has to say goes on a line of its own under it.
  if (title !== undefined) return html`<div class="cover-meta has-title"><span class="cover-name one-line">${title}</span>${facts.playerCount !== undefined ? html`<span class="count">${icon("people")}<span>${facts.playerCount.toLocaleString("en-US")}<span class="sr"> playing now</span></span></span>` : ""}${priced ? html`<span class="cover-more">${priced}</span>` : ""}</div>`;
  return html`<div class="cover-meta">${priced ? html`<span class="cover-meta-start">${priced}</span>` : ""}${facts.playerCount !== undefined ? html`<span class="count">${icon("people")}<span>${facts.playerCount.toLocaleString("en-US")}<span class="sr"> playing now</span></span></span>` : ""}</div>`;
}

export interface GameCoverOptions {
  title: string;
  /** The studio's cover, or null for a game with none yet: Zaisma's mark in the well stands in, as it does while a cover loads, with the game's title under it. */
  imageUrl: string | null;
  href: string;
  facts: GlanceFacts;
  /** The game in the pane beside the list: its orange line stays drawn. */
  isCurrent?: boolean;
  /** Its art loads with the page, not once it nears the screen: for the covers a page opens with in view, like the home's first. */
  isEager?: boolean;
  /** Its art is fetched before the page's other pictures: for the one cover likely the largest thing in the first view. */
  hasHighPriority?: boolean;
  /** Its title in words under it, at the start of the row with players now: for a grid people search through, like Browse. */
  isTitleShown?: boolean;
}

/**
 * A game's cover: the studio's art alone, bare. Until it has loaded, and where there's none, Zaisma's mark sits in the well in its place.
 * The orange line draws in under it on point and runs out to the right on leave.
 */
/**
 * A picture Zaisma serves (/img/<id>) at the sizes it keeps of it, for the browser to pick the one it shows (srcset): up to a cover's
 * width at three times its pixels. Any other address (a stand-in cover, a picture elsewhere) is shown as it is.
 */
function coverSizes(imageUrl: string, shownSizes = "(max-width: 760px) 200px, 260px", largestPx = COVER_LARGEST_PX): Raw {
  if (!/^\/img\/[A-Za-z0-9_-]+$/.test(imageUrl)) return raw("");
  const widths = SIZED_IMAGE_WIDTHS_PX.filter((widthPx) => widthPx <= largestPx);
  return html` srcset="${widths.map((widthPx) => `${imageUrl}/w${widthPx}.webp ${widthPx}w`).join(", ")}" sizes="${shownSizes}"`;
}
/** The largest width a cover's picture is offered at: a 260px cover at three times its pixels, rounded up to a kept size. */
const COVER_LARGEST_PX = 960;

export function gameCover(options: GameCoverOptions): Raw {
  const isUpdated = options.facts.updatedAtMs !== undefined && options.facts.playedAtMs !== undefined;
  const isPlaceholder = options.imageUrl === null;
  return html`<div class="cover${isPlaceholder ? " is-placeholder" : ""}"${options.isCurrent ? raw(' aria-current="true"') : ""}><a class="cover-art carving holds-art" data-cut-line="0" href="${options.href}" aria-label="${options.title}${isUpdated ? ", updated" : ""}">${CUT_LINE}${options.imageUrl === null ? (options.isTitleShown ? "" : html`<span class="cover-title carving-words compact one-line" aria-hidden="true">${options.title}</span>`) : html`<span class="cover-picture carving-art" data-cut-line="0"><img src="${options.imageUrl}"${coverSizes(options.imageUrl)} alt="" loading="${options.isEager ? "eager" : "lazy"}"${options.hasHighPriority ? raw(' fetchpriority="high"') : ""} decoding="async"></span>`}<span class="cover-bar light-fill across light-line light-glint" aria-hidden="true"></span></a>${coverFacts(options.facts, options.isTitleShown ? options.title : undefined)}</div>`;
}

/**
 * Where a pane that hangs from a button goes (window.zaismaPlace(buttonRect, paneSize, options)): one rule for a sheet, a select's list and a menu.
 * It opens toward the middle of the room it has, as dropdowns do: a button in the right half has the pane's right edge on its right edge, one in
 * the left half the left edges together; under the button, or above it (bottom edges together) when the button is in the lower half and the pane
 * fits there, or when it doesn't fit below and there's more room above. Kept inside the room, edgePx from its edges. Returns { leftPx, topPx,
 * isAtEnd, isAbove }, in the coordinates the rect and the room are given in. options: roomRect (the window by default), gapPx, edgePx and
 * isAlwaysBelow (a menu hanging from the header's slab never flips).
 */
export const PLACE_SCRIPT = `/* place */(function () {
  // Whether a pane opened from this button can ride the page as it scrolls: neither the button nor the pane sits in something fixed or
  // sticky (the header, the bar beside a game). Then the pane is placed in the page's coordinates, and the browser scrolls it with the page in
  // the same frame, no script between; placed in the window's, it would trail the scroll by a frame or more and settle after.
  window.zaismaIsOnPage = function (button, pane) {
    var isPinned = function (el) {
      for (var p = el; p && p !== document.documentElement; p = p.parentElement) { var position = getComputedStyle(p).position; if (position === "fixed" || position === "sticky") return true; }
      return false;
    };
    return !isPinned(button) && !(pane.parentElement && isPinned(pane.parentElement));
  };
  // The page's own room in the window: a header or sidebar pinned at its edge (fixed or sticky) bounds it, so what floats over the page stops
  // short of them rather than lying over them; one that holds the anchor itself (the header's account menu) doesn't.
  window.zaismaPageRoom = function (anchor) {
    var room = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight };
    document.querySelectorAll("header, nav.sidebar").forEach(function (edge) {
      if (anchor && edge.contains(anchor)) return;
      var position = getComputedStyle(edge).position, r = edge.getBoundingClientRect();
      if ((position !== "fixed" && position !== "sticky") || r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= room.bottom) return;
      // Fixed only inside a frame of its own (a gallery's header example, an offsetParent round it), it isn't pinned to the window.
      if (position === "fixed" && edge.offsetParent) return;
      if (r.width >= room.right / 2) room.top = Math.max(room.top, r.bottom);
      else if ((r.left + r.right) / 2 < room.right / 2) room.left = Math.max(room.left, r.right);
      else room.right = Math.min(room.right, r.left);
    });
    return room;
  };
  window.zaismaPlace = function (buttonRect, paneSize, options) {
    var room = options.roomRect || { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight };
    var gapPx = options.gapPx, edgePx = options.edgePx;
    var isAtEnd = (buttonRect.left + buttonRect.right) / 2 > (room.left + room.right) / 2;
    var leftPx = Math.max(room.left + edgePx, Math.min(isAtEnd ? buttonRect.right - paneSize.width : buttonRect.left, room.right - edgePx - paneSize.width));
    var roomBelowPx = room.bottom - edgePx - buttonRect.bottom - gapPx, roomAbovePx = buttonRect.top - gapPx - edgePx - room.top;
    var fitsBelow = paneSize.height <= roomBelowPx, fitsAbove = paneSize.height <= roomAbovePx;
    var isLower = (buttonRect.top + buttonRect.bottom) / 2 > (room.top + room.bottom) / 2;
    var isAbove = !options.isAlwaysBelow && (fitsBelow && fitsAbove ? isLower : !fitsBelow && roomAbovePx > roomBelowPx);
    var topPx = isAbove ? buttonRect.top - gapPx - paneSize.height : buttonRect.bottom + gapPx;
    return { leftPx: leftPx, topPx: Math.max(room.top + edgePx, Math.min(topPx, room.bottom - edgePx - paneSize.height)), isAtEnd: isAtEnd, isAbove: isAbove };
  };
  // A floating pane (floatingPane) casts a shadow onto the page, so it reads as on top. Its glass's cut shape would clip a shadow of its own,
  // and a filter round it would stop its glass blurring, so the shadow is a box of its own laid under it, riding the page as the pane does.
  // Inside it, a shape in the pane's cut casts --float-cast; the box then has that shape cut out of it, so only the shadow outside the glass
  // shows: the cut corners too, and nothing under the glass to blur. The cast and the cut are on two boxes, one inside the other: on one
  // box, Chrome cuts the whole box out, and the shadow stops square at the cut corners.
  var CAST_REACH_PX = 64;
  window.zaismaCast = function (pane) {
    var cast = pane.floatCast;
    if (!cast) { cast = pane.floatCast = document.createElement("div"); cast.className = "floating-cast"; cast.setAttribute("aria-hidden", "true"); cast.appendChild(document.createElement("div")).appendChild(document.createElement("span")); document.body.appendChild(cast); }
    if (!pane.isConnected || !pane.matches(":popover-open")) { cast.hidden = true; return; }
    var r = pane.getBoundingClientRect(), isOnPage = pane.classList.contains("is-on-page");
    // The cut is its glass's (--glass-clip, GLASS_SCRIPT): the pane itself isn't clipped, so what stands on it can cast past its edge.
    var paneStyle = getComputedStyle(pane), shape = paneStyle.getPropertyValue("--glass-clip").trim() || paneStyle.clipPath, points = /^polygon\\((.*)\\)$/.exec(shape);
    var far = "calc(100% + " + CAST_REACH_PX + "px)", near = -CAST_REACH_PX + "px";
    // Its glass's cut is measured a frame or more after it opens: until then it casts nothing, rather than a square.
    if (!points) { cast.hidden = true; pane.castTries = (pane.castTries || 0) + 1; if (pane.castTries < 60) requestAnimationFrame(function () { window.zaismaCast(pane); }); return; }
    pane.castTries = 0;
    var inner = points ? points[1].replace(/^(nonzero|evenodd),\\s*/, "") : "0px 0px, 100% 0px, 100% 100%, 0px 100%";
    cast.firstChild.firstChild.style.clipPath = points ? shape : "";
    cast.style.clipPath = "polygon(evenodd, " + near + " " + near + ", " + far + " " + near + ", " + far + " " + far + ", " + near + " " + far + ", " + near + " " + near + ", " + inner + ", " + inner.split(",")[0] + ", " + near + " " + near + ")";
    cast.hidden = false; cast.classList.toggle("is-on-page", isOnPage);
    cast.style.left = r.left + (isOnPage ? window.scrollX : 0) + "px"; cast.style.top = r.top + (isOnPage ? window.scrollY : 0) + "px"; cast.style.width = r.width + "px"; cast.style.height = r.height + "px";
  };
  // Opening, closing and settling after its opening move: the toggle and transition events don't bubble, so they're caught on the way down.
  ["toggle", "transitionend"].forEach(function (type) {
    document.addEventListener(type, function (event) { if (event.target.classList && event.target.classList.contains("floating-pane") && !event.target.classList.contains("in-place")) window.zaismaCast(event.target); }, true);
  });
  /*
   * window.zaismaFloat(pane, options): everything a floating pane does to float, once, for every owner (a select, a search, the wheels, a
   * menu). It answers { open, close(returnFocus), isOpen, place }, kept on the pane too (pane.floating). Its owner says what's particular:
   *   anchor        what it hangs from: an element, or a function that answers the one now (a menu several buttons open)
   *   anchorRect    where to hang it, when that isn't the anchor's box (a menu under the header's slab)
   *   home          where its light or dark and its glass's hue come from (the anchor by default)
   *   isInside      a press here doesn't close it (the field a search's list hangs from)
   *   focusOnClose  what takes the focus back when Esc closes it (the anchor by default)
   *   lineOf        over: how far down it the line that sits on the anchor's own line is, by offsets (it opens from a touch smaller)
   *   isAnchorWidth as wide as its anchor, at least (a search's list, whose rows change as you type); otherwise it's as wide as what's in it,
   *                 whatever its anchor's size
   *   isAlwaysBelow, gapPx, edgePx  under: as zaismaPlace takes them (isAlwaysBelow can be a function of the anchor)
   *   fitsRoom, scrollBox   under: past the room on the side it opened to it scrolls inside itself (--floating-room), and choices that would
   *                 scroll by a sliver (scrollBox) show them all instead
   *   onShown       once it's shown, before it's placed (a list centering its pick)
   *   onToggle(isOpen)  after it opens or closes (aria-expanded, focus)
   * It's lifted out of what holds it to the page itself, so no pane's glass, clip or filter is round it: it paints and blurs over everything
   * in every browser (Safari draws glass inside glass unblurred). One left by an anchor gone from the page goes, even when the anchor's
   * replacement (a panel the page refreshed) has the same id, so nothing ever opens a left one. Riding the page (its anchor in nothing fixed
   * or sticky, zaismaIsOnPage) it's placed in the page's coordinates, so the page's own scroll carries it frame for frame; otherwise in the
   * window's, placed again as things scroll. It closes on Esc, a press elsewhere, or a scroll that moves its anchor (scrolled away from, it
   * fades out rather than hanging on over the page); a scroll inside it (a list, a wheel) leaves it open.
   */
  var FLOAT_GAP_PX = 6, FLOAT_EDGE_PX = 8, SCROLLED_AWAY_PX = 4;
  window.zaismaFloat = function (pane, options) {
    var isInPlace = pane.classList.contains("in-place"), isOver = pane.classList.contains("placed-over");
    var openedAt = null;
    function anchorNow() { return typeof options.anchor === "function" ? options.anchor() : options.anchor; }
    if (!isInPlace) {
      document.querySelectorAll("body > .floating-pane").forEach(function (left) { if (left.floatingHome && !left.floatingHome.isConnected) { if (left.floatCast) left.floatCast.remove(); left.remove(); } });
      pane.floatingHome = options.home || anchorNow();
      if (pane.floatingHome && pane.floatingHome.closest(".smoke")) pane.classList.add("smoke");
      document.body.appendChild(pane);
    }
    function isOpen() { return isInPlace || pane.matches(":popover-open"); }
    // Shown open in place and as wide as what's in it (a gallery's open menu), it hangs under its anchor inside what holds it, never over
    // the rest of the page: where zaismaPlace puts it in that room, below.
    function hang() {
      var anchor = anchorNow(), holder = pane.offsetParent;
      if (!anchor || !holder) return;
      var r = options.anchorRect ? options.anchorRect(anchor) : anchor.getBoundingClientRect(), h = holder.getBoundingClientRect();
      var spot = window.zaismaPlace(r, { width: pane.offsetWidth, height: pane.offsetHeight }, { roomRect: { left: h.left, top: h.top, right: h.right, bottom: h.bottom }, gapPx: options.gapPx || FLOAT_GAP_PX, edgePx: options.edgePx || FLOAT_EDGE_PX, isAlwaysBelow: true });
      pane.style.left = Math.round(spot.leftPx - h.left - holder.clientLeft) + "px"; pane.style.top = Math.round(spot.topPx - h.top - holder.clientTop) + "px";
      pane.classList.toggle("from-start", !spot.isAtEnd);
    }
    if (isInPlace && !isOver && !options.isAnchorWidth) {
      pane.classList.add("is-hanging"); hang();
      window.zaismaWatch.resize(hang); if (document.fonts && document.fonts.ready) document.fonts.ready.then(hang);
    }
    function place() {
      var anchor = anchorNow();
      if (isInPlace || !pane.matches(":popover-open") || !anchor) return;
      var r = options.anchorRect ? options.anchorRect(anchor) : anchor.getBoundingClientRect(), viewWidth = document.documentElement.clientWidth, viewHeight = window.innerHeight;
      // An anchor riding the page out of the window (a gallery's menu shown open as the page loads) is placed as it would be with the anchor
      // in the window's middle; one in view, in the window as it is.
      // Either way, inside the page's own room: short of a pinned header and sidebar.
      var page = window.zaismaPageRoom(anchor), isOutOfView = r.bottom < 0 || r.top > viewHeight;
      var roomTop = isOutOfView ? r.top + r.height / 2 - viewHeight / 2 + page.top : page.top, roomBottom = isOutOfView ? roomTop + page.bottom - page.top : page.bottom;
      // Riding the page it scrolls away with its anchor; placed in the window, it closes once its anchor has left it.
      var isOnPage = window.zaismaIsOnPage(anchor, pane);
      if (!anchor.isConnected || (!isOnPage && (r.bottom < 0 || r.top > viewHeight || r.right < 0 || r.left > viewWidth))) { close(false); return; }
      if (options.isAnchorWidth) { pane.style.width = r.width + "px"; if (pane.scrollWidth > pane.clientWidth) pane.style.width = pane.scrollWidth + "px"; }
      var gapPx = options.gapPx || FLOAT_GAP_PX, edgePx = options.edgePx || FLOAT_EDGE_PX, leftPx, topPx;
      // No taller than the room, past which its body scrolls.
      pane.style.setProperty("--floating-room", Math.max(0, roomBottom - roomTop - 2 * edgePx) + "px");
      if (isOver) { topPx = r.top + r.height / 2 - options.lineOf(); leftPx = r.left; }
      else {
        var at = function () { return window.zaismaPlace(r, { width: pane.offsetWidth, height: pane.offsetHeight }, { roomRect: { left: page.left, top: roomTop, right: page.right, bottom: roomBottom }, gapPx: gapPx, edgePx: edgePx, isAlwaysBelow: typeof options.isAlwaysBelow === "function" ? options.isAlwaysBelow(anchor) : options.isAlwaysBelow }); };
        var spot = at();
        if (options.fitsRoom) {
          var roomPx = Math.max(0, spot.isAbove ? r.top - roomTop - gapPx - edgePx : roomBottom - r.bottom - gapPx - edgePx);
          pane.style.setProperty("--floating-room", roomPx + "px");
          var box = options.scrollBox && options.scrollBox(), extraPx = box ? box.scrollHeight - box.clientHeight : 0;
          if (extraPx > 0 && extraPx < 12) pane.style.setProperty("--floating-room", Math.ceil(roomPx + extraPx) + "px");
          spot = at();
        }
        topPx = spot.topPx; leftPx = spot.leftPx;
        pane.classList.toggle("is-above", spot.isAbove); pane.classList.toggle("from-start", !spot.isAtEnd);
      }
      var widthPx = pane.offsetWidth, heightPx = pane.offsetHeight;
      topPx = Math.max(roomTop + edgePx, Math.min(roomBottom - heightPx - edgePx, topPx));
      leftPx = Math.max(page.left + edgePx, Math.min(page.right - widthPx - edgePx, leftPx));
      pane.classList.toggle("is-on-page", isOnPage);
      pane.style.top = Math.round(topPx + (isOnPage ? window.scrollY : 0)) + "px";
      pane.style.left = Math.round(leftPx + (isOnPage ? window.scrollX : 0)) + "px";
      // Capped by the room it opened into, what scrolls in it scrolls from now, not a frame later.
      if (window.zaismaFit) pane.querySelectorAll(".scrolls").forEach(window.zaismaFit);
      window.zaismaCast(pane);
    }
    function open() {
      if (isInPlace) return;
      if (!pane.matches(":popover-open")) {
        // The page's own light or dark, and the hue of the glass where it hangs, which it no longer inherits.
        var home = options.home || anchorNow() || document.body, themed = home.closest("[data-theme-choice]");
        if (themed && themed !== document.documentElement) pane.setAttribute("data-theme-choice", themed.getAttribute("data-theme-choice")); else pane.removeAttribute("data-theme-choice");
        pane.style.setProperty("--glass-hue", getComputedStyle(home).getPropertyValue("--glass-hue"));
        // A browser that can't fade it in by itself (Safari, no overlay) shows it from its closed look, then lets it arrive.
        if (isMovedByScript) { clearTimeout(pane.leaveTimer); pane.classList.remove("is-leaving"); pane.classList.add("is-arriving"); }
        pane.showPopover();
        if (isMovedByScript) { void pane.offsetWidth; requestAnimationFrame(function () { pane.classList.remove("is-arriving"); }); }
      }
      var at = anchorNow(); openedAt = at ? at.getBoundingClientRect() : null;
      if (options.onShown) options.onShown();
      place();
      if (options.onToggle) options.onToggle(true);
    }
    // Safari keeps no closing popover in the top layer while it fades (no overlay), nor plays its entrance: the script moves it there.
    var isMovedByScript = !(window.CSS && CSS.supports("overlay", "auto")) && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    var LEAVE_MS = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-arrive")) || 0.3) * 1000;
    function close(returnFocus) {
      if (isInPlace || !pane.matches(":popover-open") || pane.classList.contains("is-leaving")) return;
      // There, it stays in the top layer while it fades toward its anchor (is-leaving), then goes.
      if (isMovedByScript) {
        pane.classList.add("is-leaving");
        pane.leaveTimer = setTimeout(function () { pane.classList.remove("is-leaving"); pane.hidePopover(); }, LEAVE_MS);
      } else pane.hidePopover();
      if (options.onToggle) options.onToggle(false);
      var back = options.focusOnClose || anchorNow();
      if (returnFocus && back) back.focus();
    }
    if (!isInPlace) {
      document.addEventListener("pointerdown", function (event) {
        var anchor = anchorNow();
        if (pane.matches(":popover-open") && !pane.contains(event.target) && !(anchor && anchor.contains(event.target)) && !(options.isInside && options.isInside(event.target))) close(false);
      });
      pane.addEventListener("keydown", function (event) { if (event.key === "Escape" && pane.matches(":popover-open")) { event.preventDefault(); close(true); } });
      window.zaismaWatch.resize(place);
      // Scrolled away from: a scroll anywhere but inside it that moves its anchor closes it.
      document.addEventListener("scroll", function (event) {
        var anchor = anchorNow();
        if (!pane.matches(":popover-open") || !openedAt || !anchor || (event.target.nodeType === 1 && pane.contains(event.target))) return;
        var r = anchor.getBoundingClientRect();
        if (Math.abs(r.top - openedAt.top) > SCROLLED_AWAY_PX || Math.abs(r.left - openedAt.left) > SCROLLED_AWAY_PX) close(false);
      }, { capture: true, passive: true });
      // Placed again as anything scrolls: riding the page, the page's own scroll leaves it where it was; a box scrolling inside the page moves it.
      window.zaismaWatch.scroll(place);
      // Measured again once the fonts are in, when what's in it has its real size.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    }
    return pane.floating = { open: open, close: close, isOpen: isOpen, place: place };
  };
})();
`;

/**
 * Menus: a button with aria-controls and aria-expanded opens the menu it names. It hangs just under the header slab when the button is in
 * the header, otherwise just under the button: from the button's end, or from its start where that would run off the screen's start, and
 * kept on the screen either way. Escape, a press elsewhere or choosing an item closes it; the arrow keys move through it.
 */
export const DROPDOWN_SCRIPT = `/* menus */(function () {
  var root = getComputedStyle(document.documentElement);
  // The gap under the button, and the least room kept from the screen's edges: two controls stacked, and the frame gap.
  function token(name, fallback) { return parseFloat(root.getPropertyValue(name)) || fallback; }
  function buttonOf(menu) { return document.querySelector('[aria-controls="' + menu.id + '"][aria-expanded]'); }
  function items(menu) { return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]')).filter(function (item) { return !item.closest("[hidden]"); }); }
  // Each menu is a Floating pane (zaismaFloat), hanging from the button that opens it, or just under the header's slab when that button is in the
  // header (it never flips above it there); past the room on the side it opened to, its choices scroll inside it.
  var buttons = new WeakMap();
  window.zaismaWatch.each('.dropdown[role="menu"]', function (menu) {
    var float = window.zaismaFloat(menu, {
      anchor: function () { return buttons.get(menu) || buttonOf(menu); },
      anchorRect: function (button) { var r = button.getBoundingClientRect(), slab = button.closest(".top"); if (!slab) return r; var below = slab.getBoundingClientRect().bottom; return { left: r.left, right: r.right, top: below - 1, bottom: below, width: r.width, height: 1 }; },
      // Under a header pinned to the window it never flips above; a header fixed only in a frame of its own (a gallery example) lets it.
      isAlwaysBelow: function (button) { var top = button.closest(".top"); return Boolean(top) && !(getComputedStyle(top).position === "fixed" && top.offsetParent); }, fitsRoom: true, gapPx: token("--gap-control-stack", 8), edgePx: token("--pad-frame", 10),
      scrollBox: function () { return menu.querySelector(".floating-body"); },
      onToggle: function (isOpen) { var button = buttons.get(menu) || buttonOf(menu); if (button) button.setAttribute("aria-expanded", String(isOpen)); }
    });
    // A menu whose height changes while it's open (a Filter menu turning to a group's choices) is placed again by its own script.
    menu.zaismaPlace = float.place;
    menu.addEventListener("keydown", function (event) {
      var list = items(menu), at = list.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); list[(at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length].focus(); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); list[event.key === "Home" ? 0 : list.length - 1].focus(); }
      if (event.key === "Tab") float.close(false);
    });
    // A choice that opens more choices in the same menu (aria-haspopup) keeps it open.
    menu.addEventListener("click", function (event) { if (event.target.closest('[role="menuitem"]:not([aria-haspopup])')) float.close(false); });
    // Open as the page loads (the gallery's open menus, a header shown with its menu open).
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[aria-controls][aria-expanded]");
    var menu = button && document.getElementById(button.getAttribute("aria-controls"));
    if (!menu || !menu.matches('.dropdown[role="menu"]') || !menu.floating) return;
    if (menu.floating.isOpen() && buttons.get(menu) === button) { menu.floating.close(false); return; }
    buttons.set(menu, button);
    menu.floating.open();
    var first = items(menu)[0];
    if (event.detail === 0 && first) first.focus({ preventScroll: true });
  });
})();
`;

const DROPDOWN_STYLES = `
/* A dropdown: a Floating pane hanging just under its button (above it, is-above, where there's no room below), as wide as what's in it,
   holding a short list of choices. It's never wider than a menu (--size-menu) or the screen, nor taller than a menu (--size-menu-height) or the
   room beside its button (--floating-room): past that its choices scroll inside it, never the page. It grows from the button's end, or from
   its start when it hangs from there (from-start). */
.floating-pane.dropdown { width: max-content; max-width: min(var(--size-menu), calc(100vw - 2 * var(--pad-frame)));
  gap: 2px; transform-origin: top right; }
.floating-pane.dropdown.from-start { transform-origin: top left; }
.floating-pane.dropdown.is-above { transform-origin: bottom right; }
.floating-pane.dropdown.is-above.from-start { transform-origin: bottom left; }
/* Its choices, under its head, in the Floating pane's body, which scrolls them past its height. A choice keeps its height while they scroll. */
.dropdown-in { display: flex; flex-direction: column; gap: 2px; }
.dropdown-in > * { flex: none; }
/* Its own words (its head's) keep its margin, --pad-words in from its padding: as far in as the choices' words, which sit that far into
   each choice. The head's rule is as long as the rules between the choices. */
.dropdown-head { display: flex; flex-direction: column; }
.dropdown-head strong { font: var(--type-name); color: var(--ink); overflow-wrap: anywhere; text-wrap: balance; }
.dropdown-head span { color: var(--muted); font: var(--type-facts); }
/* A choice: words on the glass, a small control's height (a regular one's on a touch screen); under the pointer a faint slab, cut by the
   edge rule; the current one on the switch's slab. Its words sit as far in as a field's. */
.dropdown-form { margin: 0; }
.dropdown-choice { width: 100%; white-space: nowrap; }
.dropdown-choice > .tag { margin-left: auto; }
.dropdown-choice > span.dropdown-out { display: flex; margin-left: auto; overflow: visible; }

`;

const PANE_STYLES = `
/* The pane: Zaisma's glass, the same as the home's and the header's. No sheen. Full is the whole width; fit is as wide as what's in it,
   with its paragraphs running to a reading width at most, so words set it the way a line of text would. */
.glass-pane { display: flex; flex-direction: column; max-width: 100%; }
.glass-pane.full { width: 100%; }
.glass-pane.fit { width: fit-content; }
/* Phones: a fit pane lines up with the header like every other pane, however little is in it. */
@media (max-width: 760px) { .glass-pane.fit { width: 100%; } }
/* Started low (a game's page): on a phone the art behind shows above the pane. The screen's room less what the pane's first part uses from the top of the page
   (--started-low-used, STARTED_LOW_SCRIPT: down to the end of its runner's block) and a block's gap above the screen's foot (and a phone's home bar), at most a third of the screen. The screen
   is the small one (svh), so the pane never moves when a browser's bars do; without the script it starts where it would. */
@media (max-width: 760px) { .glass-pane.is-started-low { margin-top: clamp(0px, calc(100svh - var(--started-low-used, 100svh) - var(--gap-block-block) - env(safe-area-inset-bottom, 0px)), 34svh); } }
.glass-pane.fit > .pane-in :where(p) { max-width: var(--size-reading); }
.glass-pane { position: relative; }
/* Long content scrolls inside it, on Zaisma's own rail (RAIL_SCRIPT gives any box that scrolls one). It pads at the frame gap: what has an
   edge of its own sits there, and its words keep the pane's margin, --pad-words further in (tokens.ts sets both, once). */
.glass-pane > .pane-in { flex: 1; display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* With its rail showing, the pane keeps room for it along its right edge, so the rail never sits against what's in it; while nothing
   scrolls the rail is hidden and the pane keeps the frame gap, so what sits in its corner still takes the corner's cut. */
/* Nothing in the pane shrinks when its content is long: it scrolls instead. */
.glass-pane > .pane-in > * { flex-shrink: 0; }
/* A form in a pane stacks what it holds as the pane does, and so does any group of blocks in it (pane-stack: a step that shows or hides). */
.glass-pane > .pane-in form, .glass-pane .pane-stack { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* Something empty in it (a bot check before its widget arrives) takes no room and no gap round it. A bot check's widget is 0px tall until
   it needs you (Turnstile's interaction-only), so it gives back half a gap on each side: unseen, it takes no gap; shown, half a gap round it. */
:where(.glass-pane > .pane-in, .glass-pane form, .pane-stack, .sheet-in, .sheet-body) > :empty:not(input, textarea, select, img, canvas, iframe, video, svg, hr) { display: none; }
:where(.glass-pane > .pane-in, .glass-pane form, .pane-stack, .sheet-in, .sheet-body) > [data-bot-check] { margin-block: calc(-1 * var(--gap-block-block) / 2); }
/* A page's own heading (h1) when the pane is the page, or one of a few on it (h2). */
.glass-pane :is(h1, h2) { margin: 0; font: var(--type-heading); text-wrap: balance; }
/* Its own words only: zero specificity, so any component's words (a field's error and hint) keep their own color. */
:where(.glass-pane, .sheet-in) p { margin: 0; color: var(--ink-2); }
`;

const COVER_STYLES = `
/* A cover is a carved well cut into the glass, with the studio's art set inside it: no glass and nothing drawn on the art itself. The
   well and the art are both cut by the edge rule like every control, so a cover near a pane's corner takes the pane's cut and one in the
   middle of it is square: never a rectangle against a cut corner. The well keeps the cover's 16:9, and the art fills it up to its carved rim (2px), so the rim frames the art without lying on it.
   Under the art, Zaisma's mark sits in the well: it shows until the art has loaded, and stays where a game has none (is-placeholder). */
/* Its art and what's under it, a part's gap apart. */
.cover { position: relative; display: grid; row-gap: var(--gap-words-words); min-width: 0; }
.cover-art { display: block; aspect-ratio: 16 / 9; text-decoration: none; }
.cover.is-placeholder .cover-art img { display: none; }
/* A game with no cover has its title under the mark, so it's never a blank in a list. */
.cover.is-placeholder .cover-art { display: flex; align-items: flex-end; justify-content: center; --mark-at: center 38%; }
.cover-title { max-width: 100%; font: var(--type-name); color: var(--ink-2); }
.cover-art:focus-visible { outline: none; }
.cover-art:focus-visible > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* The orange line along a cover's foot, inside its frame and cut with it, taking no room: it draws in from the left the moment you point at
   a cover, with a light running ahead along it, and stays under the game in the pane. Leaving, it runs on out to the right, quicker than it
   came, as if it moved on to the next cover. */
.cover-bar { position: absolute; inset-inline: 2px; bottom: 2px; z-index: 1;
  transform: scaleX(0); transform-origin: right; transition: transform var(--motion-state) var(--ease-leave); }
.cover-bar::after { width: 38%; }
.cover:hover .cover-bar, .cover.is-pointed .cover-bar, .cover[aria-current="true"] .cover-bar, .cover-art:focus-visible > .cover-bar { transform: scaleX(1); transform-origin: left; transition: transform var(--motion-arrive) var(--ease-glide); }
.cover:hover .cover-bar::after, .cover.is-pointed .cover-bar::after, .cover[aria-current="true"] .cover-bar::after, .cover-art:focus-visible > .cover-bar::after { animation: cover-glint var(--motion-settle) var(--ease-glide) both; }
@keyframes cover-glint { 0% { transform: translateX(-100%); opacity: 1; } 75% { opacity: 1; } 100% { transform: translateX(270%); opacity: 0; } }
/* Under a cover: what concerns you on the left (when you played, an update, friends), players now on the right. */
/* Where they can't share a line, players now goes on to the next, never cut short. */
/* Each fact sits on a line as tall as a small picture, so covers side by side line their facts up whether they show friends or not. What's
   on the left wraps inside its own room, and players now stay on the first line at the right. */
.cover-meta { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--gap-words-words); font: var(--type-facts); color: var(--muted); }
.cover-meta.has-title { align-items: center; }
.cover-meta:not(.has-title) > *, .cover-meta-start > * { display: inline-flex; align-items: center; min-height: 24px; }
.cover-meta > .cover-meta-start { flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--gap-words-words); }
.cover-meta .ico { width: 15px; height: 15px; stroke-width: 1.5; }
.cover-meta .when, .cover-meta .count, .cover-meta .friends { display: inline-flex; align-items: center; gap: var(--gap-words-words); min-width: 0; }
.cover-meta .when, .cover-meta .count, .cover-meta .device-note { white-space: nowrap; }
.cover-meta .friends { color: var(--ink); font-weight: 600; }
.cover-meta .count { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--ink-2); flex: none; }
/* What's under a cover is words, so a cover with them is a bare group (tokens.ts's BARE_GROUPS): the cover, its title and players now are one
   unit, flush with each other (the title at the art's left edge, the count at its right), and the whole unit keeps the pane's words margin
   (--pad-words past the frame gap) from the surface's edge, at its start, end and foot, with nothing placed apart. With a title it belongs
   to the cover above it: just under the orange line, with more room after it before the next row. */
.cover-meta .cover-name { flex: 1 1 0; font: var(--type-name); color: var(--ink); }
.cover-meta .cover-more { flex: 1 0 100%; display: flex; align-items: center; gap: var(--gap-words-words); min-width: 0; }
@media (prefers-reduced-motion: reduce) { .cover-art, .cover-bar { transition: none !important; } .cover-bar::after { animation: none !important; } }
`;

const HOUR_MS = 3_600_000;
/** The home draft's stand-in games, painted once as covers (brand/design/covers/). Times are how long ago, worked out when the page is made. */
interface StandInGame {
  slug: string;
  title: string;
  playerCount: number;
  playedAgoDurationMs?: number;
  updatedAgoDurationMs?: number;
  friends?: { username: string }[];
}
export const STAND_IN_GAMES: StandInGame[] = [
  { slug: "ashen-crown", title: "Ashen Crown", playerCount: 1204, playedAgoDurationMs: 2 * HOUR_MS, updatedAgoDurationMs: HOUR_MS },
  { slug: "neon-drift", title: "Neon Drift", playerCount: 3870, friends: [{ username: "Liam" }, { username: "Sofia" }] },
  { slug: "hollow-tide", title: "Hollow Tide", playerCount: 412 },
  { slug: "verdant", title: "Verdant", playerCount: 96, playedAgoDurationMs: 50 * HOUR_MS },
  { slug: "iron-vigil", title: "Iron Vigil", playerCount: 8214, friends: [{ username: "Noah" }] },
  { slug: "glasswing", title: "Glasswing", playerCount: 655 },
  { slug: "frostline", title: "Frostline", playerCount: 2290 },
  { slug: "kestrel", title: "Kestrel", playerCount: 1730, friends: [{ username: "Mia" }] },
];

/** The stand-in covers, made once as the module loads. */
export const STAND_IN_COVERS: Record<string, Raw> = Object.fromEntries(
  STAND_IN_GAMES.map((game) => {
    const nowMs = Date.now();
    const facts: GlanceFacts = {
      playerCount: game.playerCount,
      friends: game.friends,
      playedAtMs: game.playedAgoDurationMs === undefined ? undefined : nowMs - game.playedAgoDurationMs,
      updatedAtMs: game.updatedAgoDurationMs === undefined ? undefined : nowMs - game.updatedAgoDurationMs,
    };
    return [game.slug, gameCover({ title: game.title, imageUrl: `/design/covers/${game.slug}.webp`, href: `#${game.slug}`, facts })];
  }),
);
const standInCovers = (slugs: string[]) => html`${slugs.map((slug) => STAND_IN_COVERS[slug])}`;

const signInBody = (idPrefix: string) =>
  stack({ items: [
    { kind: "words", markup: html`<h2>Welcome back</h2>` },
    { kind: "control", markup: cutField({ id: `${idPrefix}-username`, name: "username", label: "Username", type: "text", icon: "person", text: "emma_r", autocomplete: "username" }) },
    { kind: "control", markup: cutField({ id: `${idPrefix}-password`, name: "password", label: "Password", type: "password", icon: "lock", text: "correct-horse", autocomplete: "current-password" }) },
    { kind: "control", markup: primaryButton("Sign in", { type: "button", isFullWidth: true, isBig: true }) },
  ] });

component({
  name: "Glass pane",
  slug: "glass-pane",
  group: "panes",
  subgroup: "materials",
  after: "thickness",
  summary: "A sheet of glass that holds a task: signing in, a game at a glance, a form. It's as wide as what holds it, or as wide as what's in it, its paragraphs running to a reading width at most; never a width of its own. Its content scrolls inside it rather than shrinking. A game's page starts its pane lower on a phone (isStartedLow), so the game's art shows above it. Not for a task that comes and goes over the page (a Sheet) or choices that hang from a button (a Floating pane).",
  styles: PANE_STYLES,
  render: glassPane,
  examples: [
    { label: "Fit: as wide as what's in it", markup: glassPane({ paneWidth: "fit", body: signInBody("example-pane-fit") }), isWide: true },
    {
      label: "Fit, long words: they run to a reading width, no wider",
      isWide: true,
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: html`<h2>About Ashen Crown</h2>` }, { kind: "words", markup: html`<p>A siege across one long night for up to 64 players. Hold the walls of Ember Keep while the dead climb from the marsh, trade what you scavenge between waves, and keep the last fire burning until dawn. Every Sunday the map turns and the leaderboard starts again.</p>` }] }) }),
    },
    { label: "Full: as wide as what holds it (one that should take half the screen goes in Columns)", markup: glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: html`<h2>Rooms</h2>` }, { kind: "words", markup: html`<p>267 playing now in 78 rooms.</p>` }] }) }), isWide: true },
  ],
});

const ACCOUNT_ITEMS: DropdownItem[] = [
  { label: "Your profile", icon: "person", href: "#dropdown" },
  { label: "Friends", icon: "friends", href: "#dropdown" },
  { label: "Developer", icon: "code", href: "#dropdown" },
  { label: "Settings", icon: "gear", href: "#dropdown" },
  { kind: "rule" },
  { label: "Sign out", icon: "sign-out", action: "#dropdown" },
];
/** An example menu hanging from its button, open: the button at the frame's end, or at its start. */
const dropdownFrame = (buttonLabel: string, options: DropdownOptions, buttonPlace: "end" | "start" = "end") => {
  const button = secondaryButton(buttonLabel, { type: "button", controls: options.id, isExpanded: true });
  return html`<div class="dropdown-frame">${buttonPlace === "end" ? button : html`<span style="position: absolute; left: var(--pad-pane); top: 0">${button}</span>`}${dropdown({ ...options, isOpen: true })}</div>`;
};

component({
  name: "Tray",
  slug: "tray",
  group: "panes",
  subgroup: "materials",
  after: "glass-pane",
  summary: "One sheet of the thinnest glass holding everything that belongs to its head: the words on a step of thicker glass across its top, what they're about on the clear glass beneath, read as one. Every gallery section is one. Never on its own: a tray runs on from the pane whose words it belongs to; a second task is a Glass pane of its own.",
  styles: `
/* A tray: one sheet, its head on a step of thicker glass across its top and what the head is about on the thin glass under it (the
   glass, its step and the step's lip are the Tray material's, materials.ts). Like a pane, it's as wide as what holds it (full) or as wide
   as what's in it (fit). */
.tray-group { display: flex; flex-direction: column; }
.tray-group.full { width: 100%; }
.tray-group.fit { width: fit-content; max-width: 100%; }
.tray-head { padding: var(--pad-pane); }
/* Thinner glass, closer words: what has an edge sits at the frame gap, like a pane's, and its words keep the tray's margin, --pad-tray, closer than a pane's. */
.tray { padding: var(--pad-frame); --pad-words: calc(var(--pad-tray) - var(--pad-frame)); }
.tray-sample-title { margin: 0; font: var(--type-section); }
`,
  render: tray,
  examples: [
    {
      label: "Fit: a head, and what it's about on the tray",
      isWide: true,
      markup: tray({ paneWidth: "fit", head: html`<h3 class="tray-sample-title">Your games</h3>`, body: row({ widths: "lead-fills", items: [control(primaryButton("Play", { type: "button", icon: "play" })), control(secondaryButton("Details", { type: "button" }))] }) }),
    },
    {
      label: "Full: holding a row of covers",
      isWide: true,
      markup: tray({ paneWidth: "full", head: html`<h3 class="tray-sample-title">Continue playing</h3>`, body: grid({ whenEmpty: html`<p>No games here yet.</p>`, itemSize: "cover", items: ["ashen-crown", "neon-drift", "hollow-tide"].map((slug) => ({ kind: "block", markup: STAND_IN_COVERS[slug]! })) }) }),
    },
    {
      label: "Full, holding nothing yet: what it says in its place",
      isWide: true,
      markup: tray({ paneWidth: "full", head: html`<h3 class="tray-sample-title">Continue playing</h3>`, body: grid({ whenEmpty: emptyState({ title: "Nothing played yet", text: "Games you play show here, so you can pick up where you left off." }), itemSize: "cover", items: [] }) }),
    },
  ],
});

const grooveSample = (markup: Raw) => html`<div style="width:var(--size-card);max-width:100%">${markup}</div>`;

component({
  name: "Groove",
  slug: "groove",
  group: "panes",
  subgroup: "glass",
  summary: "A channel carved into the glass that fills with orange light from its start: how far along something is. A Slider's line and a Progress's track are one; with no end known yet, a light runs along it. It shows and is never pressed: to set a value, a Slider; for the steps of a task, a Step flow.",
  styles: `
/* A groove: a deep carving that's a line (materials.ts), filled from its start with orange light (Light): the light lies inside the carving,
   2px in from every edge, so it never covers its lit lip or reads fuller than it is. Still going, a glint runs along the light; with no
   end known yet, a short light runs along the groove. */
.groove-fill { position: absolute; z-index: 2; top: 2px; bottom: 2px; left: 2px; width: max(0px, calc(var(--groove-filled-length, calc(var(--groove-filled, 0) * 100%)) - 2px)); max-width: calc(100% - 4px); transition: width var(--motion-arrive) ease; }
.groove-light { position: absolute; inset: 0; clip-path: var(--cut-shape); }
.groove.is-running .groove-fill { width: 30%; animation: groove-run var(--motion-loop) ease-in-out infinite; }
@keyframes groove-run { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { .groove-fill { transition: none; } .groove.is-running .groove-fill { animation: none; width: 100%; opacity: 0.5; } }
`,
  render: groove,
  // On its own, a card's width, the way a slider's or a Progress's sits: in a pane of its own it would squeeze the pane to a sliver.
  examples: [
    { label: "Empty", markup: grooveSample(groove({ filledPct: 0 })) },
    { label: "Part filled", markup: grooveSample(groove({ filledPct: 44 })) },
    { label: "Full", markup: grooveSample(groove({ filledPct: 100 })) },
    { label: "Still going: a glint runs along it", markup: grooveSample(groove({ filledPct: 44, isWorking: true })) },
    { label: "No end known yet: a light runs along it", markup: grooveSample(groove()) },
  ],
});

component({
  name: "Light",
  slug: "light",
  group: "panes",
  subgroup: "materials",
  summary: "The light in the glass, owned here and nowhere else. The light a well or pane catches on its edge as you point at what's in it: the whole edge wakes, and beside the part you point at the edge brightens and floods up into the glass, gliding along as you move. A switch's tabs and places use it; it's never a slab or a line laid in the glass. What's picked is carved or raised, never lit.",
  styles: `
/* Light: the only things lit in the glass, each defined here once. Orange light lies inside a carving (light-fill: a groove's fill, a step's
   line), deeper at its start across a line (across), glowing softly (light-glow), with a bright tip at its leading end (light-tip, shown by
   its owner). A glint is white light running along it (light-glint; loops while something's still going). A line of light is 4px (light-line). */
.light-fill { background: linear-gradient(180deg, var(--light-hi, var(--run-hi)), var(--light, var(--run))); }
.light-fill.across { background: linear-gradient(90deg, var(--run-deep), var(--run) 40%, var(--run-hi)); }
.light-glow { filter: drop-shadow(0 0 1.5px var(--run)); }
.light-line { display: block; height: 4px; }
.light-tip::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 55%, var(--run-tip) 82%, var(--run-spark)); opacity: 0; transition: opacity var(--motion-arrive) ease; }
.light-glint { overflow: hidden; }
.light-glint::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 48px; background: linear-gradient(90deg, transparent, var(--glint) 50%, transparent); opacity: 0; }
.light-glint.loops::after { left: -48px; opacity: 1; animation: light-glint var(--motion-loop) var(--ease-standard) infinite; }
@keyframes light-glint { from { left: -48px; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .light-glint.loops::after { animation: none; display: none; } }
/* An edge light (EDGE_LIGHT, EDGE_LIGHT_SCRIPT): laid in its holder before what it holds, cut to the holder's own shape (--cut-shape), so
   it stops at a cut corner instead of spilling past it. Pointed at, the whole edge wakes (--edge-wake); beside the part you point at, the
   edge itself brightens (--edge-light) and the light floods up from it into the glass (--edge-flood, --edge-flood-far), spilling past the
   part into its neighbors and fading to nothing before its own box ends, so it never stops at a hard side, with no line of its own. It eases in and out, and glides along the edge (--light-at) to the next part. */
@property --light-at { syntax: "<length>"; inherits: true; initial-value: 0px; }
@property --light-span { syntax: "<length>"; inherits: true; initial-value: 0px; }
/* It follows the pointer closely as it glides (0.2s, easing out), and comes and goes more slowly (0.45s). Its flood reaches past the
   part it lights, so it's cut off at its holder's edge: a clip only hides it, and the pane round it would still get more to scroll. */
.edge-light { position: absolute; inset: 0; overflow: hidden; pointer-events: none; clip-path: var(--cut-shape); transition: --light-at var(--motion-state) var(--ease-glide), --light-span var(--motion-state) var(--ease-glide); }
.edge-light::before, .edge-light::after { content: ""; position: absolute; opacity: 0; transition: opacity var(--motion-glide) var(--ease-standard); }
.edge-light::before { inset: 0; }
[data-edge-light="bottom"] > .edge-light::before { box-shadow: inset 0 -1.5px 0 var(--edge-wake); }
[data-edge-light="left"] > .edge-light::before { box-shadow: inset 1.5px 0 0 var(--edge-wake); }
[data-edge-light="bottom"] > .edge-light::after { left: calc(var(--light-at) - var(--light-span)); width: calc(var(--light-span) * 2); bottom: 0; height: 32px;
  background: linear-gradient(to top, var(--edge-light) 0, var(--edge-flood) 1.5px, var(--edge-flood-far) 10px, transparent 32px);
  -webkit-mask-image: radial-gradient(50% 140% at 50% 100%, #000 30%, transparent 100%); mask-image: radial-gradient(50% 140% at 50% 100%, #000 30%, transparent 100%); }
[data-edge-light="left"] > .edge-light::after { top: calc(var(--light-at) - var(--light-span)); height: calc(var(--light-span) * 2); left: 0; width: 44px;
  background: linear-gradient(to right, var(--edge-light) 0, var(--edge-flood) 1.5px, var(--edge-flood-far) 12px, transparent 44px);
  -webkit-mask-image: radial-gradient(140% 50% at 0% 50%, #000 30%, transparent 100%); mask-image: radial-gradient(140% 50% at 0% 50%, #000 30%, transparent 100%); }
[data-edge-light].is-awake > .edge-light::before, [data-edge-light].is-lit > .edge-light::after { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .edge-light { transition: none; } }
`,
  examples: [
    { label: "A switch's tab pointed at", markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false, state: "is-pointed" }, { label: "Newest", tabValue: "newest", isCurrent: false }] }), isStill: true },
    { label: "A switch's place pointed at, stacked", markup: html`<div style="width:min(220px,100%)">${tabSwitch({ label: "Groups", switchSize: "big", isVertical: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation"].map((label, tabIndex) => ({ label, isCurrent: tabIndex === 2, state: tabIndex === 0 ? ("is-pointed" as const) : undefined })) })}</div>`, isStill: true },
    { label: "Try it: point at the tabs and places", markup: html`${tabSwitch({ label: "Sort", switchSize: "small", tabs: ["Recently played", "Recently updated", "Newest"].map((label, tabIndex) => ({ label, tabValue: String(tabIndex), isCurrent: tabIndex === 0 })) })}` },
  ],
});

component({
  name: "Well",
  slug: "well",
  group: "panes",
  subgroup: "glass",
  summary: "A box carved into a pane's glass that holds things and is never a control itself: code to copy, a link, a line of words, a list of choices. One gallery control can sit at its end, as Copy does; what's longer than it can show scrolls inside it. A field or a carved button is carved too, but it's what you use, so it isn't a well. For glass that holds a task, use a Glass pane; for something to type in, a Cut field.",
  styles: `
/* A well: carved into the glass, a field's height at least, lit and shaded at its edges like every carving and cut by the edge rule. What's
   in it keeps a field's inset (--pad-inside-words); an end control sits as far in from its end as from its top (--well-inset), over the
   well, and what's in it stops short of it. Keyboard focus on what's in it is the cut stroke round the well. */
/* It's a carving (materials.ts): its look, its words' inset, its focus ring and its scrolling are the carving's. */
.well { --well-inset: calc((var(--control-height-field) - var(--control-height-small)) / 2); display: flex; align-items: center; min-width: 0; color: var(--ink); }
.well > .well-body { flex: 1; min-width: 0; }
.well > .well-end { position: absolute; z-index: 3; top: var(--well-inset); right: var(--well-inset); display: flex; }
.well-end-note { position: absolute; inset: 0; display: none; place-items: center; pointer-events: none; color: var(--ink); }
.well > .cut-line { z-index: 4; pointer-events: none; }
`,
  render: well,
  examples: [
    { label: "Words", markup: examplePane(well({ body: html`Ashen Crown runs its rooms nearest to most of their players.` })) },
    { label: "A control at its end", markup: examplePane(well({ body: html`zaisma.com/g/ashen-crown`, end: tertiaryButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true }) })) },
    {
      label: "Long words: they stop short of its end control",
      markup: examplePane(well({ body: html`The Iron Vigil is a night-long siege for up to 64 players, with its own map, three new bosses and a leaderboard that resets every Sunday.`, end: tertiaryButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true }) })),
    },
    {
      label: "Longer than it shows: what's in it scrolls, the well staying still",
      // A well no taller than five lines here, as its owner would set (--well-height), so it scrolls.
      markup: html`<div style="--well-height:9rem">${examplePane(well({ scrollDirection: "down", body: html`<p style="margin:0">${["Version 14 · the Sunday map turns", "Version 13 · three new bosses", "Version 12 · trading between waves", "Version 11 · Ember Keep's walls", "Version 10 · the marsh at night", "Version 9 · 64 players a room", "Version 8 · the leaderboard", "Version 7 · the first siege"].map((line) => html`${line}<br>`)}</p>` }))}</div>`,
    },
    { label: "Keyboard focus on what's in it", markup: examplePane(well({ body: html`zaisma.com/g/ashen-crown`, state: "is-focused" })), isStill: true },
  ],
});

const REMOVE_FRIEND = { id: "example-menu-remove-friend", title: "Remove Liam as a friend?", text: "You leave each other's friends, and neither of you sees when the other is online. Either of you can ask again later.", action: "#dropdown", confirmLabel: "Remove friend" } as const;

component({
  name: "Floating pane",
  slug: "floating-pane",
  group: "panes",
  subgroup: "materials",
  after: "tray",
  summary: "A pane of the menus' glass that hangs from what opens it, over everything on the page: under it (a menu, a search's list) or over it, its pick on the anchor's own line (a select's list, the wheels). Every dropdown, list and picker that floats is one; it does all the floating once, so none of them redo it. Not for a task with fields and buttons: that's a Sheet.",
  styles: `
/* A floating pane: the menus' glass, out of the page's flow in the top layer (a popover), placed by zaismaFloat over everything, at its
   anchor. Closed, it takes no room and no presses: it fades toward its anchor, then goes. Under, it slides from its anchor (from above it,
   is-above); over, it opens out of it, from a touch smaller. Riding the page (is-on-page), it's placed in the page's coordinates. */
.floating-pane { position: fixed; inset: auto; margin: 0; border: 0; color: var(--ink); display: flex; flex-direction: column; max-width: calc(100vw - 2 * var(--pad-frame)); --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), transform var(--motion-arrive) var(--ease-glide), overlay var(--motion-arrive) allow-discrete, display var(--motion-arrive) allow-discrete; }
/* It fades its glass and what's on it, never itself: a pane faded as a whole blurs nothing behind it until it's whole. Each fades by its own
   opacity, which the browser draws on the GPU, never a custom property, which would restyle all of it every frame. */
.floating-pane::before, .floating-pane > * { transition: opacity var(--motion-state); }
.floating-pane:not(:popover-open):not(.in-place)::before, .floating-pane:not(:popover-open):not(.in-place) > * { opacity: 0; }
@starting-style { .floating-pane:popover-open::before, .floating-pane:popover-open > * { opacity: 0; } }
.floating-pane.is-on-page { position: absolute; }
/* No taller than a menu, or the room in the window (--floating-room, zaismaFloat's place): past that its body scrolls inside it, where the
   rail and scroll fades find it, its head and its glass's edge staying put. What's in its body keeps its height as it scrolls. */
.floating-head { flex: none; }
.floating-body { flex: 0 1 auto; display: flex; flex-direction: column; }
.floating-body > * { flex: none; }
/* A browser that can't keep it in the top layer while it fades (Safari) would let it fall under what follows it on the page: it goes at once. */
@supports not (overlay: auto) { .floating-pane { transition: var(--glass-transition), transform var(--motion-arrive) var(--ease-glide); } }
/* There the script moves it (zaismaFloat): open, it starts from its closed look (is-arriving); closing, it keeps the top layer while it takes
   that look again (is-leaving), then goes. */
.floating-pane:is(.is-arriving, .is-leaving)::before, .floating-pane:is(.is-arriving, .is-leaving) > * { opacity: 0; }
.floating-pane:is(.is-arriving, .is-leaving) { transform: translateY(-6px); pointer-events: none; }
.floating-pane.is-above:is(.is-arriving, .is-leaving) { transform: translateY(6px); }
.floating-pane.placed-over:is(.is-arriving, .is-leaving) { transform: scale(0.97); }
.floating-pane:not(:popover-open):not(.in-place) { display: none; transform: translateY(-6px); pointer-events: none; }
.floating-pane.is-above:not(:popover-open):not(.in-place) { transform: translateY(6px); }
.floating-pane.placed-over:not(:popover-open):not(.in-place) { transform: scale(0.97); }
@starting-style { .floating-pane:popover-open { transform: translateY(-6px); } .floating-pane.is-above:popover-open { transform: translateY(6px); } .floating-pane.placed-over:popover-open { transform: scale(0.97); } }
/* The shadow it casts onto the page (zaismaCast): a box laid under it in its cut shape, with that shape cut out after it casts. */
.floating-cast { position: fixed; z-index: 2147483646; pointer-events: none; }
.floating-cast > div { position: absolute; inset: 0; filter: var(--float-cast); }
.floating-cast > div > span { position: absolute; inset: 0; background: #000; }
.floating-cast.is-on-page { position: absolute; }
/* Shown open in place (the gallery's open states), it's in the page's flow, no taller than a menu, scrolling past it as it does open. Over, as wide as what's in it, it lies on
   the field just before it, its line (--line-from-top) on the field's own line; glass inside a pane's glass isn't blurred, so what it
   covers is hidden rather than showing through, and it casts its shadow as a filter on what holds it, where only it is drawn. */
.floating-pane.in-place { position: relative; display: flex; width: 100%; }
/* One as wide as what's in it (a menu) hangs under its anchor inside what holds it (zaismaFloat's hang). */
.floating-pane.placed-under.in-place.is-hanging { position: absolute; z-index: 6; width: max-content; }
.floating-pane.placed-over.in-place { z-index: 6; width: max-content; max-width: 100%; margin-top: calc(-1 * (var(--gap-words-control) + var(--control-height-field) / 2 + var(--line-from-top, 0px))); }
:has(> .floating-pane.placed-over.in-place) { filter: var(--float-cast); }
:has(> .floating-pane.placed-over.in-place) > :not(.floating-pane, input) { visibility: hidden; }
@media (prefers-reduced-motion: reduce) { .floating-pane { transition: var(--glass-transition); } }
`,
  render: floatingPane,
  examples: [
    { label: "Holding words, shown in place", markup: html`<div style="width:min(320px,100%)">${floatingPane({ id: "example-floating-words", placement: "under", isShownInPlace: true, body: html`<p class="words-margin round" style="margin:0">Rooms run nearest to most of their players.</p>` })}</div>` },
    {
      label: "Over what's behind it: thin glass, the shapes showing through blurred (shown in place, on a tray, it can only show the tray)",
      isWide: true,
      markup: html`<div class="glass-strip"><i></i><i></i><i></i><div style="width:min(320px,100%)">${floatingPane({ id: "example-floating-over", placement: "under", isShownInPlace: true, body: html`<p class="words-margin round" style="margin:0">Rooms run nearest to most of their players.</p>` })}</div></div>`,
    },
    { label: "Try it: it floats over the page, which shows through it", markup: html`${secondaryButton("Your account", { type: "button", controls: "example-floating-try", isExpanded: false })}${dropdown({ id: "example-floating-try", label: "Your account", head: { title: "emma_r", note: "Online" }, items: ACCOUNT_ITEMS })}` },
    {
      label: "Longer than a menu: its body scrolls, its head staying put",
      markup: html`<div style="width:min(320px,100%)">${floatingPane({ id: "example-floating-long", placement: "under", isShownInPlace: true, head: html`<p class="words-margin round" style="margin:0;font:var(--type-label)">Regions</p>`, body: html`<p class="words-margin round" style="margin:0">${["Frankfurt", "London", "Amsterdam", "Paris", "Madrid", "Stockholm", "Warsaw", "Virginia", "Ohio", "Oregon", "São Paulo", "Tokyo", "Singapore", "Sydney", "Mumbai", "Seoul", "Hong Kong", "Jakarta", "Johannesburg", "Cape Town", "Lagos", "Dubai", "Istanbul", "Milan", "Dublin", "Toronto", "Montreal", "Chicago", "Dallas", "Mexico City", "Bogotá", "Santiago", "Auckland"].map((place) => html`${place}<br>`)}</p>` })}</div>`,
    },
  ],
});

component({
  name: "Dropdown",
  slug: "dropdown",
  group: "panes",
  subgroup: "menus",
  summary: "A short list of choices that hangs from a button, like the account button's in the header: with a head, rules, icons, counts and the current one, as each needs. A choice that's hard to take back asks first, in a confirm sheet. Not for a task with fields (a Sheet) or a value in a form (a Select field).",
  styles: DROPDOWN_STYLES,
  render: dropdown,
  examples: [
    { label: "Your account, from its button", markup: dropdownFrame("Your account", { id: "example-menu-account", label: "Your account", head: { title: "emma_r", note: "Online" }, items: ACCOUNT_ITEMS }) },
    {
      label: "Choosing one, the current marked",
      markup: dropdownFrame("Sort", { id: "example-menu-sort", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown" }, { label: "Recently updated", href: "#dropdown" }] }),
    },
    {
      label: "With counts",
      markup: dropdownFrame("Inbox", { id: "example-menu-inbox", label: "Inbox", head: { title: "Inbox" }, items: [{ label: "Replies", icon: "mail", href: "#dropdown", badgeCount: 3 }, { label: "Mentions", icon: "person", href: "#dropdown", badgeCount: 12 }, { kind: "rule" }, { label: "Settings", icon: "gear", href: "#dropdown" }] }),
    },
    {
      label: "Pointed at, and focused",
      isStill: true,
      markup: dropdownFrame("Sort", { id: "example-menu-states", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown", state: "is-pointed" }, { label: "Recently updated", href: "#dropdown", state: "is-focused" }] }),
    },
    {
      label: "A long username",
      markup: dropdownFrame("Your account", { id: "example-menu-long", label: "Your account", head: { title: "alexandra_whitmore_7", note: "Playing Ashen Crown" }, items: ACCOUNT_ITEMS }),
    },
    {
      label: "A choice that asks first",
      markup: html`${dropdownFrame("Liam", { id: "example-menu-friend", label: "Liam", head: { title: "Liam", note: "Friends since March" }, items: [{ label: "Profile", icon: "person", href: "#dropdown" }, { label: "Invite to a game", icon: "gamepad", href: "#dropdown" }, { kind: "rule" }, { label: "Remove friend", icon: "ban", confirmSheetId: REMOVE_FRIEND.id }] })}${confirmSheet(REMOVE_FRIEND)}`,
    },
    {
      label: "From a button at the screen's start",
      markup: dropdownFrame("Sort", { id: "example-menu-start", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown" }, { label: "Recently updated", href: "#dropdown" }] }, "start"),
    },
  ],
});

export interface MenuChoicesOptions {
  /** What they're about, for a screen reader: "Liam". */
  label: string;
  choices: DropdownChoice[];
}

/**
 * Menu choices: a dropdown's choices on their own, in a sheet or a pane: words with an icon, no slab of their own, a faint one under the
 * pointer, so a short list of things to do reads as the ⋯ menu does rather than a stack of buttons (a player's Profile, Block, Report).
 */
export function menuChoices(options: MenuChoicesOptions): Raw {
  return html`<div class="menu-choices" role="group" aria-label="${options.label}">${options.choices.map((choice) => dropdownChoice(choice, false))}</div>`;
}

component({
  name: "Menu choices",
  slug: "menu-choices",
  group: "panes",
  subgroup: "menus",
  summary: "A dropdown's choices on their own, in a sheet or a pane: an icon and words, no slab until pointed at, so a short list of things to do (a player's Profile, Block and Report) reads like the ⋯ menu, not a stack of buttons.",
  styles: `
/* Menu choices: the dropdown's choices one under another, at the controls' gap, the way they sit in a dropdown. */
.menu-choices { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
`,
  render: menuChoices,
  examples: [
    {
      label: "A player's choices",
      markup: html`<div style="width:320px">${glassPane({ paneWidth: "full", body: stackOfOne(menuChoices({ label: "Liam", choices: [{ label: "Profile", icon: "person", href: "#menu-choices" }, { label: "Block", icon: "ban", isButton: true }, { label: "Report", icon: "flag", isButton: true, state: "is-pointed" }] })) })}</div>`,
    },
    {
      label: "Keyboard focus",
      isStill: true,
      markup: html`<div style="width:320px">${glassPane({ paneWidth: "full", body: stackOfOne(menuChoices({ label: "Sofia", choices: [{ label: "Profile", icon: "person", href: "#menu-choices", state: "is-focused" }, { label: "Block", icon: "ban", isButton: true }, { label: "Report", icon: "flag", isButton: true }] })) })}</div>`,
    },
  ],
});

component({
  name: "Light box",
  slug: "light-box",
  group: "panes",
  subgroup: "layers",
  summary: "One thing large in the middle of a dimmed screen, like a QR code to hold up to a friend across a room: nothing else round it, and a press anywhere, Close or Esc takes it away, back to the sheet that opened it. Not for something to read or act on: that's a Sheet.",
  styles: `
/* A light box: no glass of its own, the screen dimmed deep behind what it shows, which sits in the middle in light words (a QR code keeps
   its white). It fades in and grows a little; it's a sheet to the stack (LAYERS_SCRIPT), so it's the top layer and closes like one. */
.sheet.light-box:not(.in-place) { inset: 0; width: 100%; max-width: none; max-height: none; margin: 0; background: transparent; box-shadow: none; cursor: zoom-out; }
.sheet.light-box:is(:not([open]), .is-leaving) { transform: scale(0.96); }
@starting-style { .sheet.light-box[open] { transform: scale(0.96); } }
.light-box-in { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gap-words-control); margin: 0; }
.light-box-close { position: absolute; top: var(--pad-frame); right: var(--pad-frame); }
.light-box-close .tertiary-btn { color: var(--ink); }
@media (prefers-reduced-motion: reduce) { .sheet.light-box:is(:not([open]), .is-leaving) { transform: none; } @starting-style { .sheet.light-box[open] { transform: none; } } }
`,
  render: lightBox,
  examples: [
    {
      label: "Try it: a game's QR code, large",
      markup: html`${secondaryButton("Show QR code", { type: "button", controls: "example-light-box" })}${lightBox({ id: "example-light-box", label: "QR code for Ashen Crown", closeLabel: "Close", body: qrCode({ id: "example-light-box-qr", label: "QR code for Ashen Crown", caption: "Scan with a phone's camera to play Ashen Crown", imageUrl: STAND_IN_QR_CODE, iconUrl: STAND_IN_GAME_ICON, isLarge: true }) })}`,
    },
  ],
});

/** A filter in use, said as a tag that removes it: its link is the list without it. */
export interface FilterTag {
  label: string;
  removeHref: string;
}

/** The filters in use, under a list's Filter button: each a small secondary button with a close mark, which takes that one away. */
export function filterTags(options: { tags: FilterTag[] }): Raw {
  return row({ widths: "fit", label: "Filters in use: each removes itself", items: options.tags.map((filter) => control(secondaryButton(filter.label, { href: filter.removeHref, icon: "close", isSmall: true }))) });
}

component({
  name: "Filter tags",
  slug: "filter-tags",
  group: "panes",
  subgroup: "menus",
  summary: "The filters in use on a list, under its Filter button: one small button each, with a close mark, that takes it away. Choosing filters is the Filter menu's.",
  // A Row of its buttons (layout.ts): they wrap onto more lines where they don't fit across.
  styles: "",
  render: filterTags,
  examples: [
    { label: "Two in use", markup: filterTags({ tags: [{ label: "Adventure", removeHref: "#filter-tags" }, { label: "$15 to $30", removeHref: "#filter-tags" }] }) },
    { label: "Many, wrapping", markup: html`<div style="width:min(260px,100%)">${filterTags({ tags: [{ label: "Role-playing", removeHref: "#filter-tags" }, { label: "Multiplayer", removeHref: "#filter-tags" }, { label: "$30 and up", removeHref: "#filter-tags" }] })}</div>` },
  ],
});

component({
  name: "Game cover",
  slug: "game-cover",
  group: "panes",
  subgroup: "cards",
  summary: "A game in a list: the studio's art, bare, set in a carved well, with only what concerns you under it. Zaisma's mark stands in while the art loads, and for a game with none yet. Bare, for a shelf of games the player knows (Continue playing); where they're finding games, a Game card, with its title.",
  styles: COVER_STYLES,
  render: gameCover,
  examples: [
    { label: "Played, updated since", markup: html`<div class="cover-sample">${standInCovers(["ashen-crown"])}</div>` },
    { label: "Friends playing", markup: html`<div class="cover-sample">${standInCovers(["neon-drift"])}</div>` },
    { label: "Players now", markup: html`<div class="cover-sample">${standInCovers(["hollow-tide"])}</div>` },
    { label: "In focus", markup: html`<div class="cover-sample">${gameCover({ title: "Verdant", imageUrl: "/design/covers/verdant.webp", href: "#verdant", facts: { playerCount: 96 }, isCurrent: true })}</div>`, isStill: true },
    { label: "On a loop", markup: html`<div class="cover-sample" data-state-loop="cover">${standInCovers(["iron-vigil"])}</div>`, isStill: true },
    { label: "Made for another device", markup: html`<div class="cover-sample">${gameCover({ title: "Verdant", imageUrl: "/design/covers/verdant.webp", href: "#verdant", facts: { deviceNote: "Needs a keyboard" } })}</div>` },
    { label: "A paid game", markup: html`<div class="cover-sample">${gameCover({ title: "Hollow Tide", imageUrl: "/design/covers/hollow-tide.webp", href: "#hollow-tide", facts: { priceText: "$24.99", playerCount: 412 } })}</div>` },
    { label: "No cover yet", markup: html`<div class="cover-sample">${gameCover({ title: "The Last Lighthouse Keeper", imageUrl: null, href: "#game-cover", facts: { playerCount: 38 } })}</div>` },
    { label: "With its title, for another device", markup: html`<div class="cover-sample">${gameCover({ title: "The Last Lighthouse Keeper", imageUrl: null, href: "#game-cover", facts: { playerCount: 38, deviceNote: "Needs a keyboard" }, isTitleShown: true })}</div>` },
    {
      label: "Five friends playing",
      markup: html`<div class="cover-sample">${gameCover({ title: "Kestrel", imageUrl: "/design/covers/kestrel.webp", href: "#kestrel", facts: { playerCount: 12480, friends: [{ username: "Sofia" }, { username: "Liam" }, { username: "Emma" }, { username: "Noah" }, { username: "Charlotte" }] } })}</div>`,
    },
  ],
});

interface SheetBaseOptions {
  /** Unique on the page: the button that opens it names it (secondaryButton's controls). */
  id: string;
  /** What its close button says to a screen reader: "Close". */
  closeLabel: string;
  /** Where its form posts when a button sends it. Without one, a button that sends it only closes it. */
  action?: string;
  /**
   * Where it sits: "center" over the dimmed page (report a game, add a key); "foot" risen from the screen's foot over a running game, which
   * stays in view and isn't dimmed (a buy sheet); "middle" stays in the middle of a wide screen whatever opened it (Confirm it's you). On a phone both rise from the foot; on a wide screen, opened by a button, both hang from it.
   */
  placement?: "center" | "foot" | "middle";
  /** Open in place rather than over the page: the gallery's still copy. */
  isShown?: boolean;
  /**
   * A small sheet: a few choices or a glance, not a task (the share sheet, Players). It hangs from the button that opened it on every screen,
   * as a dropdown does, narrow with its gaps closed up; on a phone, where it wouldn't fit beside its button, it rises from the foot. Left out,
   * it's a task sheet: centered on a wide screen, risen from the foot on a phone, whatever opened it.
   */
  isCompact?: boolean;
  /** A picture large (a screenshot, a screen on Screens): as wide as the screen allows, up to --size-sheet-picture, rather than --size-sheet. */
  isPicture?: boolean;
  /** A short yes or no that guards something (Confirm it's you): opened over another sheet it's drawn a size smaller, in the middle of it. */
  isConfirm?: boolean;
}

/** A sheet with one task in it: its title, its body and its buttons. */
interface SheetOfOneOptions extends SheetBaseOptions {
  title: string;
  /** Its words and fields, which scroll between its head and its buttons when they're long. The sheet is one form: it holds none of its own. */
  body: LayoutMarkup;
  /** Its buttons, at its foot and in view while the body scrolls: the way out first, the one thing to do last (Cancel, Send report). */
  buttons?: ControlMarkup[];
}

/** One step of a task that moves forward inside one sheet (Players, then a player, then Report). */
export interface SheetStep {
  /** What zaismaLayers.step(sheet, stepName) moves to: "players", "player", "report". Its title's id is "{sheet id}-{stepName}-title". */
  stepName: string;
  title: string;
  body: LayoutMarkup;
  buttons?: ControlMarkup[];
}

/** A sheet whose task moves forward inside it: the first step shows as it opens; every step after it has Back before its title. */
interface SheetOfStepsOptions extends SheetBaseOptions {
  steps: SheetStep[];
}

/** One tab of a sheet with tabs: its switch's words, the value it's known by, and what shows while it's chosen. */
export interface SheetTab {
  label: string;
  /** How many things it holds, beside its words in quieter ones ("This room 3"): a list's tab. */
  itemCount?: number;
  tabValue: string;
  body: LayoutMarkup;
}

/** A sheet with tabs in its head that swap what's in it (a game's link and its QR code): the first is chosen as it opens. */
interface SheetOfTabsOptions extends SheetBaseOptions {
  title: string;
  tabs: SheetTab[];
  buttons?: ControlMarkup[];
}

export type SheetOptions = SheetOfOneOptions | SheetOfStepsOptions | SheetOfTabsOptions;

// Declared, not assigned, since gallery examples above them make sheets as the file loads.
function sheetClose(closeLabel: string) {
  return tertiaryButton(closeLabel, { type: "submit", formMethod: "dialog", icon: "close", isLabelHidden: true, isSmall: true });
}
function sheetScroll(body: Raw) {
  return html`<div class="sheet-scroll"><div class="sheet-body scrolls to-edge">${body}</div></div>`;
}
function sheetFoot(buttons: ControlMarkup[] | undefined) {
  return buttons?.length ? { start: { kind: "block" as const, markup: row({ widths: "equal", items: buttons.map((button) => ({ kind: "control" as const, markup: button })) }) } } : undefined;
}

/**
 * A sheet: a pane of glass over the page for a task that comes and goes (report a game, block someone), opened by a button that names it.
 * Its head (the title, and Close in the corner) and its buttons stay where they are while what's between them scrolls. It's one form, so
 * Close and Cancel close it without sending it (formmethod="dialog"). A task of steps moves forward inside it with Back (zaismaLayers.step),
 * and tabs in its head swap what's in it; either way it stays one sheet, one layer, and closing it closes all of it.
 */
export function sheet(options: SheetOptions): Raw {
  const closeButton = sheetClose(options.closeLabel);
  if ("steps" in options) {
    // Back is Close's twin, in the other top corner: quiet as Close is, its chevron drawn as thin as Close's cross.
    const back = tertiaryButton("Back", { type: "button", icon: "chevron-back", isLabelHidden: true, isSmall: true, dataAttributes: { "sheet-back": "" } });
    const parts = html`${options.steps.map((step, index) => {
      const titleId = `${options.id}-${step.stepName}-title`;
      const words = html`<h2 class="sheet-title" id="${titleId}">${step.title}</h2>`;
      return html`<section class="sheet-step" data-sheet-step="${step.stepName}"${index ? raw(" hidden") : ""}>${paneParts({ head: { start: index ? back : undefined, words, end: closeButton }, body: sheetScroll(step.body), foot: sheetFoot(step.buttons) })}</section>`;
    })}`;
    return sheetMarkup({ ...options, title: options.steps[0]!.title, titleId: `${options.id}-${options.steps[0]!.stepName}-title`, body: html``, parts, closeButton });
  }
  if ("tabs" in options) {
    // The sheet's top row: its tabs, scrolling sideways when there are more than fit, and Close fixed at its end. The chosen tab and the sheet
    // under it are one piece of glass in front, its outline (drawn by LAYERS_SCRIPT inside the scrolling row, so it moves with the tabs) up
    // the tab's outward slants, across its top, and along the sheet's top beside it; the other tabs and Close sit behind, in its shadow.
    // No title shows: the tabs say where you are. The tab row carries the sheet's title as its name, which names the sheet for screen readers.
    const tabButtons = options.tabs.map((tab, index) => html`<button class="sheet-tab-button" type="button" data-sheet-tab-to="${tab.tabValue}" aria-pressed="${index ? "false" : "true"}"><span class="sheet-tab-words"><span class="sheet-tab-label">${tab.label}</span>${tab.itemCount === undefined ? "" : html`<span class="sheet-tab-count">${tab.itemCount.toLocaleString("en-US")}</span>`}</span></button>`);
    const strip = html`<div class="sheet-tab-row" data-cut-line="0"><svg class="sheet-tab-outline" aria-hidden="true"><path class="behind-glass"/><path class="behind-well"/><clipPath id="${options.id}-behind"><path/></clipPath><polygon class="front-shadow" clip-path="url(#${options.id}-behind)"/></svg><div class="sheet-tab-scroll"><div class="sheet-tab-track" id="${options.id}-title" role="group" aria-label="${options.title}">${tabButtons}<span class="sheet-tab-fill"></span></div></div><span class="sheet-tab-end">${closeButton}</span></div>`;
    const body = html`${options.tabs.map((tab, index) => html`<section class="sheet-tab" data-sheet-tab="${tab.tabValue}"${index ? raw(" hidden") : ""}>${tab.body}</section>`)}`;
    return sheetMarkup({ ...options, body: html``, parts: html`${strip}${paneParts({ body: sheetScroll(body), foot: sheetFoot(options.buttons) })}`, closeButton });
  }
  return sheetMarkup({ ...options, closeButton });
}

export interface ConfirmSheetOptions {
  id: string;
  /** The question: "Sign out everywhere?" */
  title: string;
  /** One sentence on what happens. */
  text: string;
  /** Where its action posts. */
  action: string;
  /** The action's words: "Sign out everywhere". */
  confirmLabel: string;
  /** Its action sent and waiting, the loader in its arrow's place: the gallery's still copy (BUSY_SCRIPT does it on a page). */
  isBusy?: boolean;
  isShown?: boolean;
  /** Its action deletes something for good (a game, a webhook, a key): its button is red, the one red in Zaisma, in place of the runner. */
  isDelete?: boolean;
}

/**
 * A confirm sheet: one sentence, the action and Cancel, before something that's hard to take back. A delete's (isDelete) has the only red
 * button in Zaisma. Opened over another sheet, it's drawn a size smaller, in the middle of it, and closing it lands on the sheet beneath.
 */
export function confirmSheet(options: ConfirmSheetOptions): Raw {
  return sheetMarkup({
    closeButton: sheetClose("Close"),
    id: options.id,
    title: options.title,
    body: html`<p class="sheet-text words-margin">${options.text}</p>`,
    action: options.action,
    buttons: [secondaryButton("Cancel", { type: "submit", formMethod: "dialog", isAutofocused: !options.isBusy }), (options.isDelete ? secondaryButton(options.confirmLabel, { type: "submit", isBusy: options.isBusy, tint: "red" }) : primaryButton(options.confirmLabel, { type: "submit", isBusy: options.isBusy }))],
    isShown: options.isShown,
    isConfirm: true,
  });
}

/** On a touch screen, a button shorter than a regular control reaches past its own box to a regular control's height, unseen: for `scope`'s buttons. */
const touchReach = (scope: string) => `@media (pointer: coarse) {
  ${scope} .shell::after { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--touch-target)) / 2)); bottom: min(0px, calc((100% - var(--touch-target)) / 2)); }
}`;

const SHEET_STYLES = `
/* A sheet: a dialog of the panes' glass over the page, which dims behind it (dimmed, not blurred, so it stays cheap). It comes up a
   little as it opens and drops away as it closes, the dimming fading with it; nothing in it waits for that. Centered on a wide screen; on
   a phone it rises from the foot of the screen, a gap from its edges. Like a pane that fits, it's as wide as what's in it, its words running
   to a reading width at most, and never wider than a sheet (--size-sheet) or the screen less its margins: past its height, its body scrolls. */
.sheet { width: fit-content; max-width: min(var(--size-sheet), calc(100% - 2 * var(--pad-pane))); margin: auto; padding: 0; border: 0; overflow: visible; color: var(--ink);
  --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), transform var(--motion-arrive) var(--ease-glide), overlay var(--motion-arrive) allow-discrete, display var(--motion-arrive) allow-discrete; }
/* It fades its glass and what's on it, never itself, as a floating pane does, so it blurs what's behind it all the way in. */
.sheet::before, .sheet > * { transition: opacity var(--motion-state); }
.sheet:is(:not([open]), .is-leaving)::before, .sheet:is(:not([open]), .is-leaving) > * { opacity: 0; }
@starting-style { .sheet[open]::before, .sheet[open] > * { opacity: 0; } }
/* A picture's sheet: as wide as the screen allows, up to its own size, so a screenshot or a screen shows large. */
.sheet.is-picture { max-width: min(var(--size-sheet-picture), calc(100% - 2 * var(--pad-pane))); }
/* Over the page, fixed to the window whether it's opening, open or closing (it stops being :modal the moment it starts to close). */
.sheet:not(.in-place) { position: fixed; inset: 0; z-index: 40; }
/* The sheet itself takes the focus when a press opened it (LAYERS_SCRIPT): no ring, a ring is for the keyboard. */
.sheet:focus-visible { outline: none; }
.sheet:is(:not([open]), .is-leaving) { transform: translateY(16px) scale(0.98); pointer-events: none; transition-timing-function: ease, ease, var(--ease-leave); }
@starting-style { .sheet[open] { transform: translateY(12px) scale(0.985); } }
.sheet::backdrop { opacity: 1; transition: opacity var(--motion-arrive), overlay var(--motion-arrive) allow-discrete, display var(--motion-arrive) allow-discrete; }
.sheet:is(:not([open]), .is-leaving)::backdrop { opacity: 0; }
@starting-style { .sheet[open]::backdrop { opacity: 0; } }
/* At the foot: risen from the bottom of the screen over a running game, which stays in view, never dimmed (a buy sheet). */
.sheet.placement-foot:not(.in-place) { margin: auto auto var(--pad-pane); }
.sheet.placement-foot:is(:not([open]), .is-leaving) { transform: translateY(40px); }
@starting-style { .sheet.placement-foot[open] { transform: translateY(40px); } }
.sheet.placement-foot::backdrop { background: transparent; }
/* In place (the gallery's still copy): a pane where it sits, in the page's flow, so it shows whole: there's no window to fit. */
.sheet.in-place { position: relative; z-index: auto; margin: 0; max-height: none; }
/* A sheet is a pane: it pads at the frame gap and its words keep the pane's margin (--pad-words). It's one form, its head (the title, and
   Close in the top end corner, taking the corner's cut, Pane parts' head), its body and its buttons at its foot. Only the body scrolls, so
   the head and the buttons stay in view, and Close keeps its corner. */
.sheet-in { display: flex; flex-direction: column; gap: var(--gap-block-block); margin: 0; }
.sheet-in :where(p, .sheet-text) { max-width: var(--size-reading); }
.sheet-in > .pane-parts, .sheet-in > .pane-parts > .pane-body, .sheet-step > .pane-parts, .sheet-step > .pane-parts > .pane-body { flex: 1 1 auto; min-height: 0; }
/* Steps: one task moving forward inside the same sheet, one step shown at a time (zaismaLayers.step). The one shown comes in from its side
   (forward from the end, Back from the start) in 0.2s; the sheet keeps its tallest height on a wide screen, so it doesn't jump. */
.sheet-in > .sheet-step:not([hidden]) { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.sheet-step.is-from-end { animation: sheet-step-from-end var(--motion-state) var(--ease-glide); }
.sheet-step.is-from-start { animation: sheet-step-from-start var(--motion-state) var(--ease-glide); }
@keyframes sheet-step-from-end { from { opacity: 0; transform: translateX(16px); } }
@keyframes sheet-step-from-start { from { opacity: 0; transform: translateX(-16px); } }
/* Tabs in its head, under the title, swap what's in it: one tab's part shown at a time. */
/* Tabs: the sheet's top row, reaching its sides (the edge rule cuts it at the sheet's top corners). Its tabs are as wide as their words and
   scroll sideways between its ends when there are more than fit, fading out under Close where there's more; Close stays at the end.
   In front: the chosen tab and the sheet under it, one piece of glass, its rim (GLASS_SCRIPT) up the tab's outward slants, across its top and
   along the sheet's top beside it. Behind: the other tabs, the rest of the row and Close's end, in deeper glass, their words quieter, the
   front piece's shadow falling on them; an svg under the row that LAYERS_SCRIPT draws where the tabs are scrolled to. Pointed at, a tab's
   words darken. */
.sheet-tab-row { --tab-shadow: rgba(6, 9, 14, 0.12); position: relative; z-index: 0; display: flex; align-items: stretch; min-width: 0; margin: calc(-1 * var(--pad-frame)) calc(-1 * var(--pad-frame)) 0; clip-path: var(--cut-shape); }
.sheet-tab-scroll { position: relative; flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain; }
.sheet-tab-scroll::-webkit-scrollbar { display: none; }
.sheet-tab-scroll.is-more-end { mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); }
.sheet-tab-scroll.is-more-start { mask-image: linear-gradient(90deg, transparent, #000 28px); }
.sheet-tab-scroll.is-more-start.is-more-end { mask-image: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent); }
.sheet-tab-track { position: relative; display: flex; align-items: stretch; width: max-content; min-width: 100%; height: var(--control-height-regular); }
.sheet-tab-outline { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.sheet-tab-outline .behind-glass { fill: var(--glass-tint); }
.sheet-tab-outline .behind-well { fill: var(--well); }
/* The front piece's shadow: its shape blurred, falling on what's behind only (LAYERS_SCRIPT clips it to the behind shape), so it runs on
   round the chosen tab's slants and along the foot with no seam; under Close's end the same fall-off is a gradient, to the sheet's edge. */
.sheet-tab-outline .front-shadow { fill: var(--tab-shadow); filter: blur(4px); }
.sheet-tab-button { --tab-slant: 8px; position: relative; flex: none; display: flex; align-items: center; gap: var(--gap-words-words); padding: 0 calc(var(--pad-inside-words) + var(--tab-slant)); margin: 0; border: 0;
  font: var(--type-label); color: var(--ink-2); white-space: nowrap; background: transparent; cursor: pointer; transition: color var(--motion-state); }
.sheet-tab-words { position: relative; z-index: 1; display: flex; align-items: baseline; gap: var(--gap-words-words); }
.sheet-tab-count { font: var(--type-facts); color: var(--muted); }
.sheet-tab-button[aria-pressed="true"] { color: var(--ink); cursor: default; }
.sheet-tab-button:hover:not([aria-pressed="true"]) { color: var(--ink); }
.sheet-tab-button:focus-visible { outline: none; }
.sheet-tab-button:focus-visible .sheet-tab-label { text-decoration: underline 2px var(--focus); text-underline-offset: 4px; }
.sheet-tab-fill { flex: 1; }
.sheet-tab-end { position: relative; flex: none; display: flex; align-items: center; padding: 0 calc((var(--control-height-regular) - var(--control-height-small)) / 2); }
@media (prefers-reduced-motion: reduce) { .sheet-tab-button { transition: none; } }
.sheet-tab:not([hidden]) { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* A heading inside a sheet is a size under its title, so the title leads. */
.sheet-body :where(h3) { font: var(--type-name); }
.sheet-title { margin: 0; font: var(--type-section); color: var(--ink); text-wrap: balance; }
/* The body scrolls across the sheet's whole width, so its rail sits where a pane's does, and what's in it keeps the frame gap. */
.sheet-scroll { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.sheet-body { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* With its rail showing, the body keeps room for it along its right edge. */
.sheet-text { margin: 0; font: var(--type-words); color: var(--ink-2); }
/* A sheet made by sheetMarkup (foundations.ts: a delete's confirm step): its head and words in one box that scrolls. */
${touchReach(".sheet")}
@media (max-width: 760px) {
  /* On a phone it rises from the foot of the screen and stops well short of the top, so the page stays in view above it. */
  .sheet:not(.in-place) { width: calc(100% - 2 * var(--gap-control-stack)); max-width: none; margin: auto var(--gap-control-stack) var(--gap-control-stack); }
  .sheet:not(.in-place):is(:not([open]), .is-leaving) { transform: translateY(40px); }
  @starting-style { .sheet:not(.in-place)[open] { transform: translateY(40px); } }
}
/* A small sheet (compact) hangs from the button that opened it, like a dropdown, on every screen (LAYERS_SCRIPT sets where and decides it
   fits): under it or above it where there's no room, coming in from the button's side. The page behind is dimmed only a little, and not at all
   over a running game (at the foot). A task sheet never hangs: centered on a wide screen, risen from the foot on a phone. */
.sheet.is-anchored:not(.in-place) { inset: auto; left: var(--sheet-left); top: var(--sheet-top); width: min(var(--size-sheet-compact), calc(100% - 2 * var(--pad-frame))); margin: 0; transform-origin: 0 0; }
/* Riding the page (LAYERS_SCRIPT, zaismaIsOnPage): in the top layer an absolute sheet is placed in the page's coordinates, so it scrolls with the page frame for frame. */
.sheet.is-anchored.is-on-page:not(.in-place) { position: absolute; }
.sheet.is-anchored.is-at-end:not(.in-place) { transform-origin: 100% 0; }
.sheet.is-anchored.is-above:not(.in-place) { transform-origin: 0 100%; }
.sheet.is-anchored.is-above.is-at-end:not(.in-place) { transform-origin: 100% 100%; }
.sheet.is-anchored:not(.in-place):is(:not([open]), .is-leaving) { transform: translateY(-8px) scale(0.98); }
.sheet.is-anchored.is-above:not(.in-place):is(:not([open]), .is-leaving) { transform: translateY(8px) scale(0.98); }
@starting-style { .sheet.is-anchored:not(.in-place)[open] { transform: translateY(-8px) scale(0.98); } .sheet.is-anchored.is-above:not(.in-place)[open] { transform: translateY(8px) scale(0.98); } }
/* A small sheet's gaps closed up and its title at a name's size, as a dropdown's are, on every screen (it hangs from its button on a phone too). */
.sheet:is(.is-compact, [data-sheet-confirm].is-over-sheet) :is(.sheet-in, .sheet-body) { gap: var(--gap-control-stack); }
.sheet.is-compact .sheet-title { font: var(--type-name); }
.sheet.is-anchored.placement-foot::backdrop { background: transparent; }
@media (min-width: 761px) {
  /* A compact sheet is a dropdown's size: narrow, its head, body and the blocks in it closed up to the controls' gap. A confirm opened over
     another sheet is drawn the same size, in the middle of the screen. */
  .sheet:is(.is-compact, [data-sheet-confirm].is-over-sheet) { width: var(--size-sheet-compact); }

}
@media (prefers-reduced-motion: reduce) { .sheet-step { animation: none; } }
@media (prefers-reduced-motion: reduce) { .sheet { transition: var(--glass-transition), opacity var(--motion-state), overlay var(--motion-state) allow-discrete, display var(--motion-state) allow-discrete; } .sheet:not(.in-place):is(:not([open]), .is-leaving), .sheet.is-anchored:not(.in-place):is(:not([open]), .is-leaving), .sheet.is-anchored.is-above:not(.in-place):is(:not([open]), .is-leaving) { transform: none; } @starting-style { .sheet.is-anchored:not(.in-place)[open], .sheet.is-anchored.is-above:not(.in-place)[open] { transform: none; } } }
`;

const reportBody = (idPrefix: string) =>
  stack({ items: [
    { kind: "block", markup: choiceCards({ id: `${idPrefix}-reason`, name: `report_reason_${idPrefix}`, label: "What's wrong", choices: REPORT_REASONS, pickedValue: "broken", isCompact: true }) },
    { kind: "block", markup: longField({ id: `${idPrefix}-details`, name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000 }) },
  ] });
const reportSheet = (id: string, options: { title?: string; isShown?: boolean } = {}) =>
  sheet({ id, title: options.title ?? "Report Ashen Crown", body: reportBody(id), closeLabel: "Close", action: "#sheet", buttons: [primaryButton("Send report", { type: "submit" })], isShown: options.isShown });

component({
  name: "Sheet",
  slug: "sheet",
  group: "panes",
  subgroup: "layers",
  summary: "A task that comes and goes over the page: report a game, block someone, add a key. Opened by a button that names it: on a phone it rises from the foot, on a wide screen it hangs from that button like a dropdown, under it or above it; Esc, its close button or a press beside it close it, and it drops away as it goes in every browser (it stays open while it leaves, so no browser drops it early or draws it out of place). Its title, Close and its buttons stay in view while the rest scrolls. A task of steps moves forward inside it with Back, and tabs in its head swap what's in it; a confirm opens a size smaller on top, never more than two deep. Not for one yes or no (a Confirm sheet) or a moment that just happened (a Notice).",
  styles: SHEET_STYLES,
  render: sheet,
  examples: [
    { label: "Try it: from its button (on a short screen its title and Send report stay while the reasons scroll)", markup: html`${secondaryButton("Report this game", { type: "button", controls: "example-sheet-try" })}${reportSheet("example-sheet-try")}` },
    { label: "Open", markup: reportSheet("example-sheet-shown", { isShown: true }), isWide: true, isStill: true },
    {
      label: "Compact, on a wide screen: narrow, its gaps closed up like a dropdown's (the share sheet)",
      isStill: true,
      markup: sheet({ id: "example-sheet-compact", title: "Share Ashen Crown", body: stack({ items: [{ kind: "control", markup: copyField({ id: "example-sheet-compact-link", label: "Link", copiedText: "https://zaisma.com/g/ashen-crown" }) }, { kind: "block", markup: menuChoices({ label: "More ways to share", choices: [{ label: "Show QR code", icon: "qr-code", isButton: true }, { label: "More ways to share", icon: "share", isButton: true }] }) }] }), closeLabel: "Close", isShown: true, isCompact: true }),
    },
    {
      label: "Sending: its button busy",
      isStill: true,
      markup: sheet({ id: "example-sheet-busy", title: "Report Ashen Crown", body: stackOfOne(longField({ id: "example-sheet-busy-details", name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000, text: "The game asks for my password on its own page, styled like Zaisma's." })), closeLabel: "Close", action: "#sheet", buttons: [primaryButton("Send report", { type: "submit", isBusy: true })], isShown: true }),
    },
    {
      label: "A problem: what's wrong, on its field",
      isStill: true,
      markup: sheet({ id: "example-sheet-problem", title: "Report Ashen Crown", body: stackOfOne(longField({ id: "example-sheet-problem-details", name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000, error: "Say what you saw, so a person can find it." })), closeLabel: "Close", action: "#sheet", buttons: [primaryButton("Send report", { type: "submit" })], isShown: true }),
    },
    {
      label: "A long title",
      isStill: true,
      markup: sheet({ id: "example-sheet-long", title: "Report The Last Lighthouse Keeper: Tides of the Northern Reach", body: stackOfOne(longField({ id: "example-sheet-long-details", name: "report_text", label: "What you saw", rowCount: 3, maximumCharacterCount: 2000 })), closeLabel: "Close", action: "#sheet", buttons: [primaryButton("Send report", { type: "submit" })], isShown: true }),
    },
    {
      label: "Try it: at the foot, over a running game, which stays in view (a buy sheet)",
      markup: html`${secondaryButton("Buy the Founder's Pack", { type: "button", controls: "example-sheet-foot" })}${sheet({ id: "example-sheet-foot", title: "Founder's Pack", body: stackOfOne(html`<p>The soundtrack, the Ember Keep castle and 1,200 crowns in Ashen Crown, on every device you sign in on.</p>`, "words"), closeLabel: "Close", action: "#sheet", placement: "foot", buttons: [secondaryButton("Not now", { type: "submit", formMethod: "dialog" }), primaryButton("Buy for $14.99", { type: "submit" })] })}`,
    },
    {
      label: "Three ways: Keep closes it, and the other two each send the form to their own place (formAction)",
      isStill: true,
      markup: sheet({
        id: "example-sheet-two-ways",
        title: "Cancel Zaisma Pro?",
        body: stackOfOne(html`<p>Keep it until Nov 22, or end it now and get your $10 back (until Nov 5).</p>`, "words"),
        closeLabel: "Close",
        action: "#sheet-cancel",
        buttons: [secondaryButton("Keep Pro", { type: "submit", formMethod: "dialog" }), secondaryButton("End now and refund $10", { type: "submit", formAction: "#sheet-refund" }), primaryButton("Cancel at Nov 22", { type: "submit" })],
        isShown: true,
      }),
    },
    {
      label: "Try it: a confirm over a sheet, a size smaller; a press beside it, Esc or Cancel close only the confirm",
      markup: html`${secondaryButton("Your games", { type: "button", controls: "example-sheet-under" })}${sheet({
        id: "example-sheet-under",
        title: "Ashen Crown",
        body: stack({ items: [{ kind: "words", markup: html`<p>In your games since March. Played 2 days ago.</p>` }, { kind: "control", markup: secondaryButton("Remove from your games", { type: "button", controls: "example-sheet-over", isFullWidth: true }) }] }),
        closeLabel: "Close",
      })}${confirmSheet({ id: "example-sheet-over", title: "Remove Ashen Crown?", text: "It leaves your games. Your saves stay on your account.", action: "#sheet", confirmLabel: "Remove" })}`,
    },
    {
      label: "Try it: steps of one task in one sheet (Players, a player, Report), Back before a later step's title; a press beside it closes all of it",
      markup: html`${secondaryButton("Players", { type: "button", icon: "people", controls: "example-sheet-steps" })}${sheet({
        id: "example-sheet-steps",
        closeLabel: "Close",
        placement: "foot",
        isCompact: true,
        steps: [
          {
            stepName: "players",
            title: "Players · 3",
            body: stackOfOne(listRows({
              whenEmpty: emptyState({ title: "Nobody here yet", text: "Players show here as they join your room." }),
              label: "In this room",
              isCompact: true,
              rows: [
                { lead: pictureFrame("Liam", "sm"), title: "Liam", titleIcon: { icon: "friends", label: "Friend" }, action: [toggleButton("Mute Liam", { type: "button", icon: "speaker", isLabelHidden: true, isSmall: true, isPressed: false }), secondaryButton("More for Liam", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, dataAttributes: { "sheet-step-to": "player" } })] },
                { lead: pictureFrame("Sofia", "sm"), title: "Sofia", action: [toggleButton("Mute Sofia", { type: "button", icon: "speaker-off", isLabelHidden: true, isSmall: true, isPressed: true }), secondaryButton("More for Sofia", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, dataAttributes: { "sheet-step-to": "player" } })] },
              ],
            })),
          },
          {
            stepName: "player",
            title: "Liam",
            body: stackOfOne(menuChoices({ label: "Liam", choices: [{ label: "Profile", icon: "person", href: "#sheet" }, { label: "Block", icon: "ban", isButton: true }, { label: "Report", icon: "flag", isButton: true, dataAttributes: { "sheet-step-to": "report" } }] })),
          },
          { stepName: "report", title: "Report Liam", body: reportBody("example-sheet-steps"), buttons: [primaryButton("Send report", { type: "submit" })] },
        ],
      })}`,
    },
    {
      label: "Try it: tabs in its head that swap what's in it (the room's players and your friends playing), at its tallest height",
      markup: html`${secondaryButton("Who's playing", { type: "button", icon: "people", controls: "example-sheet-tabs" })}${sheet({
        id: "example-sheet-tabs",
        title: "Who's playing",
        closeLabel: "Close",
        isCompact: true,
        tabs: [
          { label: "This room", itemCount: 3, tabValue: "room", body: stackOfOne(listRows({ isCompact: true, whenEmpty: html`<p>Nobody here yet.</p>`, rows: ["Liam", "Sofia", "Noah"].map((name) => ({ lead: pictureFrame(name, "sm"), title: name })) })) },
          { label: "Friends", itemCount: 1, tabValue: "friends", body: stackOfOne(listRows({ isCompact: true, whenEmpty: html`<p>None of your friends are playing.</p>`, rows: ["Emma"].map((name) => ({ lead: pictureFrame(name, "sm"), title: name, detail: "In Ashen Crown" })) })) },
        ],
      })}`,
    },
  ],
});

export interface StoreItemOptions {
  /** Unique on the page: a page's script finds the parts by it ("{id}-words", "{id}-name", "{id}-price", "{id}-description", "{id}-note"). */
  id: string;
  /** The game's own cover, the developer's image with nothing drawn on it; null shows Zaisma's mark in its place. */
  imageUrl: string | null;
  /** The item's name: "Revive". */
  name: string;
  /** Its price as the player pays it: "$19.99". */
  priceText: string;
  description?: string;
  /** One quiet line under them: who sells it and what refunds there are. */
  noteText?: string;
}

/**
 * An item in a store panel: the game's cover across the top (items have no pictures of their own), then the item's name, its price large under
 * it, what it is, and one quiet line on who sells it. The picture is the developer's image alone: no title or button lies on it.
 */
export function storeItem(options: StoreItemOptions): Raw {
  const picture = options.imageUrl === null
    ? html`<div class="store-picture carving holds-art is-placeholder" data-cut-line="0">${CUT_LINE}</div>`
    : html`<div class="store-picture carving holds-art" data-cut-line="0">${CUT_LINE}<span class="store-picture-art carving-art" data-cut-line="0"><img src="${options.imageUrl}"${coverSizes(options.imageUrl, "(max-width: 760px) 100vw, 400px", 1440)} alt="" loading="lazy" decoding="async"></span></div>`;
  return html`<div class="store-item" id="${options.id}">${picture}<div class="store-item-words" id="${options.id}-words"><h3 class="store-item-name" id="${options.id}-name">${options.name}</h3><p class="store-item-price" id="${options.id}-price">${options.priceText}</p><p class="store-item-description" id="${options.id}-description">${options.description ?? ""}</p><p class="store-item-note" id="${options.id}-note">${options.noteText ?? ""}</p></div></div>`;
}

component({
  name: "Store item",
  slug: "store-item",
  group: "panes",
  subgroup: "buying",
  summary: "What a store panel sells: the game's own cover across the top, then the item's name, its price large under it, what it is, and one quiet line on who sells it and what refunds there are. Items have no pictures of their own, so the cover is the developer's image, bare; with none, Zaisma's mark stands in. Only ever in a Store panel.",
  styles: `
/* A store item: the picture is a carved well cut like a game cover's, the art filling it up to its rim (2px); both are cut by the edge rule, so
   it takes a pane's corner's cut where it sits in one and is square in the middle. Under it the words, a words' gap apart, keep the pane's margin. */
.store-item { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
.store-picture { display: block; aspect-ratio: 16 / 9; }
/* On a short screen (a Steam Deck, a phone on its side, a laptop at a large text size) the picture over the game is shorter, its art still covering
   it, so the item's words and Buy have room rather than the panel scrolling by a sliver. */
@media (max-height: 52em) { .sheet:not(.in-place) .store-picture { max-height: min(9rem, 30dvh); } }
.store-item-words { display: flex; flex-direction: column; gap: var(--gap-words-words); min-width: 0; }
.store-item-words > :empty { display: none; }
.store-item-name { margin: 0; font: var(--type-heading); color: var(--ink); text-wrap: balance; overflow-wrap: anywhere; }
.store-item-price { margin: 0; font: var(--type-section); color: var(--ink); font-variant-numeric: tabular-nums; }
.store-item-description { margin: 0; font: var(--type-reading); color: var(--ink-2); }
.store-item-note { margin: 0; font: var(--type-note); color: var(--muted); }
`,
  render: storeItem,
  examples: [
    { label: "With its description and who sells it", markup: html`<div class="cover-sample">${storeItem({ id: "example-store-item", imageUrl: "/design/covers/hollow-tide.webp", name: "Revive", priceText: "$1.99", description: "Bring your character back with half its health.", noteText: "Sold by Preview Studio. Refunds for items you haven't used yet, within 14 days." })}</div>` },
    { label: "Name and price only", markup: html`<div class="cover-sample">${storeItem({ id: "example-store-item-bare", imageUrl: "/design/covers/kestrel.webp", name: "Spring Valley", priceText: "$19.99" })}</div>` },
    { label: "No cover yet, and a long name", markup: html`<div class="cover-sample">${storeItem({ id: "example-store-item-none", imageUrl: null, name: "The Complete Collector's Edition of the Northern Reach", priceText: "$149.99", description: "Every expansion and the soundtrack." })}</div>` },
  ],
});

export interface StorePanelOptions {
  /** Unique on the page: the button that opens it names it (secondaryButton's controls). */
  id: string;
  /** The slim row above the picture, with Close at its right: "Buy". */
  title: string;
  /** What Close says to a screen reader: "Close". */
  closeLabel: string;
  /** Its item (a Store item) and what the moment adds: the confirm step, the card form, a note. Scrolls between the head and the foot when it's long. */
  body: LayoutMarkup;
  /** Pinned at its foot while the body scrolls: a stack of controls (the card row, then the buy button). */
  foot: Raw;
  /** Where its form posts when a button sends it. Without one, a button that sends it only closes it. */
  action?: string;
  /** Open in place rather than over the page: the gallery's still copy. */
  isShown?: boolean;
}

/**
 * A store panel: a sheet for buying, standing at the screen's right edge over the running game, as tall as the screen less the page's edge, so
 * the game keeps its middle. On a phone it rises from the foot, nearly the screen's height. Its slim head holds Close; the item and the moment
 * scroll under it; the card row and the buy button stay at its foot.
 */
export function storePanel(options: StorePanelOptions): Raw {
  return sheetMarkup({ id: options.id, title: options.title, body: options.body, closeButton: sheetClose(options.closeLabel), foot: options.foot, action: options.action, placement: "side", isShown: options.isShown });
}

const STORE_NOTE = "Sold by Preview Studio. Refunds for items you haven't used yet, within 14 days.";
/** The panel's item, as the examples show it. */
const storeExampleItem = (id: string, noteText = STORE_NOTE) => ({ kind: "block" as const, markup: storeItem({ id, imageUrl: "/design/covers/hollow-tide.webp", name: "Revive", priceText: "$1.99", description: "Bring your character back with half its health.", noteText }) });
const storeExampleBuy = (id: string, label = "Buy", isBusy = false) => ({ kind: "control" as const, markup: primaryButton(label, { id, type: "button", busyLabel: "Buying", isFullWidth: true, trailingText: "$1.99", isBusy }) });
const storeExampleCard = { kind: "control" as const, markup: cardRow("Visa ending 4242", { type: "button", hiddenText: "Use another card" }) };

component({
  name: "Store panel",
  slug: "store-panel",
  group: "panes",
  subgroup: "buying",
  summary: "Where a player buys: a tall panel at the screen's right edge over the running game, which keeps its middle (on a phone, a sheet risen from the foot, nearly the screen's height). A slim head with Close, the item with the game's cover across its top, and pinned at its foot the card row and the buy button carrying the price; Apple Pay and Google Pay sit with them when offered. Pressing Buy is the confirmation: only when Zaisma needs to know it's them does the panel ask first, in the same place.",
  styles: `
/* A store panel is a sheet standing at the right edge of the screen, as tall as the screen less the page's edge, so the game keeps its middle.
   Nothing dims it. It slides in from its side; on a phone it rises from the foot like the other sheets, nearly the screen's height. */
.sheet.placement-side:not(.in-place) { inset: var(--pad-pane) var(--pad-pane) var(--pad-pane) auto; width: min(var(--size-sheet-side), calc(100% - 2 * var(--pad-pane))); max-width: none; max-height: none; margin: 0; }
.sheet.placement-side:is(:not([open]), .is-leaving) { transform: translateX(40px); }
@starting-style { .sheet.placement-side[open] { transform: translateX(40px); } }
.sheet.placement-side::backdrop { background: transparent; }
.sheet.placement-side.in-place { width: min(var(--size-sheet-side), 100%); max-width: none; }
@media (max-width: 760px) {
  .sheet.placement-side:not(.in-place) { inset: 0; width: calc(100% - 2 * var(--gap-control-stack)); margin: auto var(--gap-control-stack) var(--gap-control-stack); }
  .sheet.placement-side:is(:not([open]), .is-leaving) { transform: translateY(40px); }
  @starting-style { .sheet.placement-side[open] { transform: translateY(40px); } }
}
@media (prefers-reduced-motion: reduce) { .sheet.placement-side:is(:not([open]), .is-leaving) { transform: none; } @starting-style { .sheet.placement-side[open] { transform: none; } } }
`,
  render: storePanel,
  examples: [
    {
      label: "Try it: from its button, at the screen's right edge",
      markup: html`${secondaryButton("Buy Revive", { type: "button", controls: "example-store-panel-try" })}${storePanel({ id: "example-store-panel-try", title: "Buy", closeLabel: "Close", body: stack({ items: [storeExampleItem("example-store-panel-try-item")] }), foot: stack({ items: [{ kind: "control", markup: cardRow("Visa ending 4242", { type: "button", hiddenText: "Use another card" }) }, storeExampleBuy("example-store-panel-try-buy")] }) })}`,
    },
    {
      label: "Ready: the saved card and Buy, one press",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-ready", title: "Buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-ready-item")] }), foot: stack({ items: [{ kind: "control", markup: cardRow("Visa ending 4242", { type: "button", hiddenText: "Use another card" }) }, storeExampleBuy("example-store-panel-ready-buy")] }) }),
    },
    {
      label: "With Apple Pay offered and the line the EU's law asks for above Buy",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-wallet", title: "Buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-wallet-item")] }), foot: stack({ items: [{ kind: "control", markup: secondaryButton("Apple Pay", { type: "button", isFullWidth: true }) }, { kind: "control", markup: cardRow("Visa ending 4242", { type: "button", hiddenText: "Use another card" }) }, { kind: "words", markup: html`<p>You get it now, so you can't cancel it in the next 14 days.</p>` }, storeExampleBuy("example-store-panel-wallet-buy")] }) }),
    },
    {
      label: "A first card: the email for receipts and the card form",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-card", title: "Buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-card-item")] }), foot: stack({ items: [storeExampleBuy("example-store-panel-card-buy")] }) }),
    },
    {
      label: "Buying: Buy pressed, waiting",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-busy", title: "Buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-busy-item")] }), foot: stack({ items: [storeExampleCard, storeExampleBuy("example-store-panel-busy-buy", "Buy", true)] }) }),
    },
    {
      label: "It didn't go through: what went wrong, nothing charged, and Try again",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-declined", title: "Buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-declined-item"), { kind: "block", markup: problemState({ title: "The payment didn't go through", text: "Your card was declined. Nothing was charged." }) }] }), foot: stack({ items: [storeExampleCard, storeExampleBuy("example-store-panel-declined-buy", "Try again")] }) }),
    },
    {
      label: "Bought: it's theirs, and back to the game",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-bought", title: "Buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-bought-item"), { kind: "block", markup: doneState({ title: "Bought", text: "Revive is yours. The receipt is on its way to your account's email." }) }] }), foot: stack({ items: [{ kind: "control", markup: secondaryButton("Back to the game", { type: "submit", formMethod: "dialog", isFullWidth: true }) }] }) }),
    },
    {
      label: "A guest: a way to an account, the game running on",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-guest", title: "Make a free account to buy", closeLabel: "Close", isShown: true, body: stack({ items: [storeExampleItem("example-store-panel-guest-item"), { kind: "words", markup: html`<p>Your game keeps running while you make one or sign in, and you come back to this.</p>` }] }), foot: row({ widths: "equal", items: [{ kind: "control", markup: secondaryButton("Sign in", { type: "button" }) }, { kind: "control", markup: primaryButton("Make an account", { type: "button" }) }] }) }),
    },
  ],
});

const GAME_DELETE = { title: "Delete Ashen Crown?", text: "Its page, versions, saves and stats are gone for good. Players who have it open are sent home.", action: "#confirm-sheet", confirmLabel: "Delete Ashen Crown", isDelete: true } as const;
const SIGN_OUT_EVERYWHERE = { title: "Sign out everywhere?", text: "Every device signed in as you is signed out, this one too. Games keep your saves.", action: "#confirm-sheet", confirmLabel: "Sign out everywhere" } as const;

component({
  name: "Confirm sheet",
  slug: "confirm-sheet",
  group: "panes",
  subgroup: "layers",
  summary: "One sentence, the action and Cancel, before something that's hard to take back: signing out everywhere, ending a room. Over another sheet it opens a size smaller, and closing it lands on the sheet beneath. A delete's is a secondary button tinted red, the only red in Zaisma, and the button that opens it is a secondary button with a trash icon, never orange. Not for what's easy to take back: do it, and offer Undo in a Notice.",
  styles: "",
  render: confirmSheet,
  examples: [
    { label: "Try it: from its button", markup: html`${secondaryButton("Sign out everywhere", { type: "button", controls: "example-confirm-try" })}${confirmSheet({ id: "example-confirm-try", ...SIGN_OUT_EVERYWHERE })}` },
    { label: "Open", markup: confirmSheet({ id: "example-confirm-shown", ...SIGN_OUT_EVERYWHERE, isShown: true }), isWide: true, isStill: true },
    { label: "A delete: from a secondary button with a trash icon", markup: html`${secondaryButton("Delete this game", { type: "button", icon: "trash", controls: "example-confirm-delete-try" })}${confirmSheet({ id: "example-confirm-delete-try", ...GAME_DELETE })}` },
    { label: "A delete, open: its confirm tinted red", markup: confirmSheet({ id: "example-confirm-delete-shown", ...GAME_DELETE, isShown: true }), isWide: true, isStill: true },
    { label: "A delete, deleting", markup: confirmSheet({ id: "example-confirm-delete-busy", ...GAME_DELETE, isShown: true, isBusy: true }), isWide: true, isStill: true },
    {
      label: "A delete, a long game title",
      markup: confirmSheet({ id: "example-confirm-delete-long", ...GAME_DELETE, title: "Delete Ashen Crown: The Long Night of the Iron Vigil?", confirmLabel: "Delete Ashen Crown: The Long Night of the Iron Vigil", text: "Its page, 214 versions, 1,240,318 saves and its stats are gone for good. Players who have it open are sent home.", isShown: true }),
      isWide: true,
      isStill: true,
    },
    { label: "Sent, waiting", markup: confirmSheet({ id: "example-confirm-busy", title: "End this room?", text: "The 6 players in North gate go back to the menu, and the room's world is kept for 30 days.", action: "#confirm-sheet", confirmLabel: "End the room", isBusy: true, isShown: true }), isStill: true, isWide: true },
  ],
});

export interface NoticeOptions {
  text: string;
  /**
   * How it waits its turn (zaismaLayers): "information" (the default) leaves by itself when it's done and waits behind asks; "urgent" goes
   * over anything, sheets included, and is read out at once (role alert), like a problem.
   */
  noticeUrgency?: "information" | "urgent";
  /** "done": something just went through (Saved), and it leaves by itself after 4 s. "problem": something didn't, and it stays until it's closed. */
  tone: "done" | "problem";
  /** Where its Undo posts, for something done that can be taken back (Removed from your games): it shows Undo, and stays 8 s rather than 4. */
  undoAction?: string;
  /** A link after its words, for where to go next (Open your account): the words say where it goes, never the address. */
  link?: { words: string; href: string };
  /** Where it sits rather than floating under the header: the gallery's still copies. */
  isInPlace?: boolean;
}

/** A notice: a moment that just happened ("Saved", "Couldn't save: you're offline"), in the header's glass just under the header. */
export function notice(options: NoticeOptions): Raw {
  const isProblem = options.tone === "problem";
  const noticeUrgency = options.noticeUrgency ?? "information";
  const undo = options.undoAction === undefined ? "" : html`<form class="notice-undo" method="post" action="${options.undoAction}">${tertiaryButton("Undo", { type: "submit" })}</form>`;
  return html`<div class="notice glass glass-bar ${options.tone}${options.isInPlace ? " in-place" : ""}" role="${isProblem || noticeUrgency === "urgent" ? "alert" : "status"}" data-notice="${options.tone}" data-notice-urgency="${noticeUrgency}"${undo ? raw(" data-notice-undo") : ""} data-glass data-glass-corners="menu">${EDGE}${icon(isProblem ? "warning" : "check")}<span class="notice-text words-margin beside-controls${undo ? "" : " compact"}">${options.text}${options.link ? html` ${textLink(options.link.words, options.link.href)}` : ""}</span>${undo}${isProblem ? tertiaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true, dataAttributes: { "layer-close": "" } }) : ""}</div>`;
}

/**
 * A pane started low (isStartedLow) says how much of the page its first part uses: from the top of the page down to the end of the block that
 * holds its runner (Play and Details). The CSS makes the rest of the screen, less a block's gap, the pane's top margin, so Play never starts
 * below the fold. It's set as soon as the pane is on the page and again whenever the pane changes size (a note above Play appears, the fonts
 * arrive), each time before the browser paints: the size watcher runs between layout and paint, and any change it makes is laid out again first.
 */
export const STARTED_LOW_SCRIPT = `/* panes started low */(function () {
  function place(pane) {
    // The pane's own stack, and the one of its cells that holds the runner (Play, with Details under it).
    var runner = pane.querySelector(".run-wrap"), inside = pane.querySelector(":scope > .pane-in > .layout-stack") || pane.querySelector(":scope > .pane-in");
    var part = runner && inside && Array.prototype.find.call(inside.children, function (cell) { return cell.contains(runner); });
    if (!part) return;
    var marginPx = parseFloat(getComputedStyle(pane).marginTop) || 0;
    pane.style.setProperty("--started-low-used", Math.round(part.getBoundingClientRect().bottom + window.scrollY - marginPx) + "px");
  }
  window.zaismaWatch.each(".glass-pane.is-started-low", function (pane) { place(pane); window.zaismaWatch.size(pane, function () { place(pane); }); });
})();
`;

component({
  name: "Notice",
  slug: "notice",
  group: "panes",
  subgroup: "layers",
  summary: "A moment that just happened, just under the header: Saved, Copied, or what went wrong. A done one leaves by itself after 4 seconds (8 with Undo), waiting while it's pointed at or touched; a problem stays until it's closed. Up to three stack, and the rest wait their turn (zaismaLayers.say makes one from a page's script). Not for what holds while you're on the page: that's a Banner.",
  styles: `
/* A notice: a small slab of the header's glass floating just under the header, in the middle, under any notices before it. It comes down a
   little as it arrives and fades up as it leaves. A done one carries a green tick, a problem the warning in the marked color and a close
   button. Its height is a small control's and the room round it, so a notice with Close or Undo is as tall as one without. */
.notice { position: fixed; z-index: 30; top: calc(var(--under-header, 96px) + var(--notice-shift, 0px)); left: 0; right: 0; width: max-content; max-width: calc(100% - 2 * var(--pad-pane)); margin: 0 auto;
  display: flex; align-items: center; align-items: flex-start; gap: 0; --glass-tint: var(--glass-thin); --pad-words: var(--pad-inside-words); --notice-line: var(--control-height-small);
  font: var(--type-words); color: var(--ink);
  transition: var(--glass-transition), opacity var(--motion-arrive), transform var(--motion-arrive) var(--ease-glide), top var(--motion-arrive) var(--ease-glide); }
@starting-style { .notice { opacity: 0; transform: translateY(-8px); } }
.notice.is-leaving { opacity: 0; transform: translateY(-8px); }
.notice.in-place { position: relative; top: auto; left: auto; right: auto; z-index: auto; margin: 0; }
.notice:has(> .notice-undo) { --notice-line: var(--control-height-regular); }
/* Its icon sits on its words' first line, which sits on its controls' center line. */
.notice > .ico { width: 20px; height: 20px; margin-block: calc((var(--notice-line) - 20px) / 2); }
.notice.done > .ico { color: var(--online); stroke-width: 2.4; }
.notice.problem > .ico { color: var(--marked); }
/* A control at its end (Close, Undo) sits at the inner pane's gap from its end, as at its top and foot, and takes its corners' cut. */
.notice-text { min-width: 0; }
.notice-undo { display: flex; }
/* Two or more in place, one under another, as floating ones stack. */
.notice-stack { display: flex; flex-direction: column; align-items: flex-start; gap: var(--gap-control-stack); }
${touchReach(".notice")}
@media (prefers-reduced-motion: reduce) { .notice { transition: var(--glass-transition), opacity var(--motion-arrive); } }
`,
  render: notice,
  examples: [
    { label: "Done", markup: notice({ text: "Saved", tone: "done", isInPlace: true }) },
    { label: "Done, longer", markup: notice({ text: "Version 14 is live", tone: "done", isInPlace: true }) },
    { label: "A problem", markup: notice({ text: "Couldn't save: you're offline. Your changes are kept here.", tone: "problem", link: { words: "Try again", href: "#notice" }, isInPlace: true }) },
    { label: "Done, with Undo", markup: notice({ text: "Removed Ashen Crown from your games", tone: "done", undoAction: "#notice", isInPlace: true }) },
    { label: "Two at once", markup: html`<div class="notice-stack">${notice({ text: "Copied", tone: "done", isInPlace: true })}${notice({ text: "Couldn't reach Zaisma. Check your connection.", tone: "problem", isInPlace: true })}</div>` },
    {
      label: "Three at once, the most a page shows: a fourth waits until one leaves",
      markup: html`<div class="notice-stack">${notice({ text: "Saved", tone: "done", isInPlace: true })}${notice({ text: "Copied", tone: "done", isInPlace: true })}${notice({ text: "Couldn't reach Zaisma. Check your connection.", tone: "problem", isInPlace: true })}</div>`,
    },
  ],
});

export interface BannerOptions {
  text: string;
  icon?: IconName;
  /**
   * At most one thing to do about it: a link to follow (href, See why), or a button that posts (formAction, Turn back on), the banner
   * being its form. One of the two.
   */
  action?: { label: string; href?: string; formAction?: string };
  /** A Close at its end, for news the player can put away; what it does (hiding it, remembering) is the page script's, on its button[name="banner_close"]. */
  closeLabel?: string;
  /** "warning" for what needs the player's eye, like a held version: its icon in amber, never orange. "plain" (the default) for the rest. */
  tone?: "plain" | "warning";
}

/** The least width a banner keeps its words and its buttons side by side at; narrower, its words take the whole width and its button goes under them. */
const BANNER_SIDE_BY_SIDE_LEAST_PX = 560;

/**
 * A banner: a strip of glass across the top of a page's content for something that holds while you're there (playing as a guest, a held
 * version, Zaisma's news). Its words, and at most one button and a Close in a row at its end.
 */
export function banner(options: BannerOptions): Raw {
  const formAction = options.action?.formAction;
  const action = options.action ? (formAction === undefined ? secondaryButton(options.action.label, { href: options.action.href ?? "#" }) : secondaryButton(options.action.label, { type: "submit" })) : undefined;
  const close = options.closeLabel ? tertiaryButton(options.closeLabel, { type: "button", name: "banner_close", icon: "close", isLabelHidden: true }) : undefined;
  const controls = [action, close].filter((each): each is ControlMarkup => each !== undefined);
  const inside = html`<div class="banner-words words-margin${action || close ? " beside-controls" : " round"}">${options.icon ? html`<span class="banner-icon">${icon(options.icon)}</span>` : ""}<p class="banner-text">${options.text}</p></div>${controls.length ? row({ widths: "fit", alignment: "end", items: controls.map(control) }) : ""}`;
  const holder = `banner-in${options.tone === "warning" ? " tone-warning" : ""}${action ? " has-action" : ""}${close ? " has-close" : ""}`;
  return html`<div class="banner glass" data-glass data-glass-corners="header">${EDGE}${formAction === undefined ? html`<div class="${holder}">${inside}</div>` : html`<form class="${holder}" method="post" action="${formAction}">${inside}</form>`}</div>`;
}

component({
  name: "Banner",
  slug: "banner",
  group: "panes",
  subgroup: "layers",
  summary: "Something that holds while you're on a page, across the top of its content: you're playing as a guest, a version is held, Zaisma's news on the home. A line of words, at most one button, and a Close for what a player can put away. Not for a moment that just happened: that's a Notice.",
  styles: `
/* A banner: a strip of the panes' glass, the width of the page's content, with a pane's two margins: what has an edge sits at the frame
   gap, so its buttons take the strip's corners, and its words keep the pane's margin. Its icon and words start at the start; its button
   and Close are a row at its end, slanting toward each other, one height, its words' first line on their center line. Narrower than
   ${BANNER_SIDE_BY_SIDE_LEAST_PX}px (by its own width), its words take the whole width, Close sits in the top end corner beside their first
   line, and the button goes under them, as wide as the strip. */
.banner { width: 100%; container-type: inline-size; color: var(--ink); }
.banner-in { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: var(--gap-words-beside-control); margin: 0; }
.banner-words { display: flex; align-items: flex-start; gap: var(--gap-words-words); min-width: 0; font: var(--type-words); }
/* The icon sits on the words' first line. */
.banner-icon { flex: none; display: flex; align-items: center; height: 1lh; color: var(--ink-2); }
.banner-in.tone-warning .banner-icon { color: var(--warning); }
.banner-text { flex: 1 1 0; min-width: 0; margin: 0; padding: 0; color: var(--ink); }
@container (max-width: ${BANNER_SIDE_BY_SIDE_LEAST_PX - 1}px) {
  .banner-in { grid-template-columns: minmax(0, 1fr); }
  .banner-in > .banner-words { grid-area: 1 / 1; }
  .banner-in:not(.has-close) > .banner-words { padding-block-start: var(--pad-words); }
  .banner-in.has-action > .banner-words { padding-block-end: 0; }
  /* The row gives its cells to the banner: Close to the top end corner, the button to a line of its own under the words. */
  .banner-in > .layout-row { display: contents; }
  .banner .banner-in.has-close > .layout-row > .row-cell:last-child { grid-area: 1 / 1; justify-self: end; margin: 0; }
  .banner .banner-in.has-action { row-gap: var(--gap-words-control); }
  .banner .banner-in.has-action > .layout-row > .row-cell:first-child { grid-area: 2 / 1; margin: 0; }
  .banner .banner-in.has-action > .layout-row > .row-cell:first-child > .shell { display: flex; flex: 1 1 auto; }
  .banner .banner-in.has-action > .layout-row > .row-cell:first-child > .shell > .face { width: 100%; justify-content: center; }
  /* The words make room for Close beside their first line: an empty float as wide as Close (an icon-only tertiary button, as wide as it is
     tall) and the gap less their margin, down to its foot. */
  .banner-in.has-close .banner-text::before { content: ""; float: inline-end; width: calc(var(--control-height-regular) + var(--gap-words-beside-control) - var(--pad-words)); height: calc((var(--control-height-regular) + 1lh) / 2); }
}
`,
  render: banner,
  examples: [
    { label: "Playing as a guest", isWide: true, markup: banner({ text: "You're playing as a guest. Your progress stays on this device until you make an account.", icon: "person", action: { label: "Make an account", href: "#banner" } }) },
    { label: "A held version: the warning tone", isWide: true, markup: banner({ text: "Version 14 is held: a person looks at it, usually within a day.", icon: "clock", tone: "warning", action: { label: "See why", href: "#banner" } }) },
    { label: "A button that posts", isWide: true, markup: banner({ text: "Cloud saves are off for Ashen Crown. What you save now stays on this device.", icon: "save", action: { label: "Turn them back on", formAction: "#banner" } }) },
    { label: "News you can close", isWide: true, markup: banner({ text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", icon: "megaphone", action: { label: "Read more", href: "#banner" }, closeLabel: "Close" }) },
    { label: "News you can close, with nothing to follow", isWide: true, markup: banner({ text: "Zaisma is down for upkeep on Sunday from 2:00 to 2:30 UTC. Games in progress pause and carry on after.", icon: "megaphone", closeLabel: "Close" }) },
    { label: "Words alone", isWide: true, markup: banner({ text: "This game is unlisted: only people with its link can find it.", icon: "eye" }) },
    {
      label: "Over a game's own background, its glass smoked",
      isWide: true,
      markup: html`<div class="smoke" style="width: 100%; background: center / cover no-repeat url('/design/covers/neon-drift.webp'); padding: var(--gap-block-block)">${banner({ text: "Season 3 of Neon Drift starts Friday: new districts, and the leaderboards start over.", icon: "megaphone", action: { label: "See what's new", href: "#banner" }, closeLabel: "Close" })}</div>`,
    },
  ],
});

export interface StepFlowStep {
  label: string;
  /** The step's own words and fields. Given for every step, the flow moves between them on the page and sends its form once, at the end. */
  body?: Raw;
}

export interface StepFlowOptions {
  steps: StepFlowStep[];
  /** The step shown now, from 0. */
  currentIndex: number;
  /** When each step is a page of its own (no step has a body): this step's words and fields. */
  body?: Raw;
  /** Where the form posts: each step, or once at the end when the steps carry their bodies. */
  action: string;
  /** Next's words on the last step, saying what it does ("Turn it on"). */
  finishLabel?: string;
  /** When each step is a page of its own: the step before's address, left out on the first step. */
  backHref?: string;
  /** "fit" (the default): as wide as what's in it, its paragraphs running to a reading width at most. "full": as wide as what holds it. */
  paneWidth?: "full" | "fit";
}

/**
 * A step flow: a task in a few steps (protect your account, set up a game's sign-in), a pane with a step line across its top and Back and
 * Next. Its steps are pages of their own (a body, a backHref), or all on this page (each step's body), where STEP_FLOW_SCRIPT moves between them.
 */
export function stepFlow(options: StepFlowOptions): Raw {
  const isOnPage = options.steps.every((step) => step.body !== undefined);
  const lastIndex = options.steps.length - 1;
  const stepLine = html`<ol class="step-line" aria-label="Steps">${options.steps.map((step, stepIndex) => {
    const kind = stepIndex < options.currentIndex ? "is-done" : stepIndex === options.currentIndex ? "is-current" : "";
    return html`<li${kind ? html` class="${kind}"` : ""}${stepIndex === options.currentIndex ? raw(' aria-current="step"') : ""}><span class="step-mark carving deep line" data-cut-line="3" aria-hidden="true">${CUT_LINE}<span class="step-fill light-fill across light-tip" data-cut-line="3" data-cut-bar></span></span><span class="step-label words-margin">${step.label}</span></li>`;
  })}</ol>`;
  const finishLabel = options.finishLabel ?? "Done";
  const nextLabel = options.currentIndex === lastIndex ? finishLabel : "Next";
  const paneWidth = options.paneWidth ?? "fit";
  if (!isOnPage) {
    const buttons = row({ widths: "equal", items: [...(options.backHref ? [control(secondaryButton("Back", { href: options.backHref }))] : []), control(primaryButton(nextLabel, { type: "submit" }))] });
    return glassPane({ paneWidth, body: stack({ items: [{ kind: "block", markup: stepLine }, { kind: "block", markup: html`<form class="step-form" method="post" action="${options.action}">${options.body ?? ""}${buttons}</form>` }] }) });
  }
  const bodies = options.steps.map((step, stepIndex) => html`<div class="step-body"${stepIndex === options.currentIndex ? "" : raw(" hidden")}>${step.body ?? ""}</div>`);
  const buttons = row({ widths: "equal", items: [control(secondaryButton("Back", { type: "button", isHidden: options.currentIndex === 0 })), control(primaryButton(nextLabel, { type: "submit" }))] });
  return glassPane({ paneWidth, body: stack({ items: [{ kind: "block", markup: stepLine }, { kind: "block", markup: html`<form class="step-form" method="post" action="${options.action}" data-steps="${options.currentIndex}" data-finish-label="${finishLabel}">${bodies}${buttons}</form>` }] }) });
}

/**
 * Step flows with every step on the page: Next checks the step's fields, then moves on, the step line filling to the next step; Back goes
 * back; on the last step Next sends the form. form.goToStep(index) moves to any step (the gallery starts its example over with it).
 */
export const STEP_FLOW_SCRIPT = `/* step flows */(function () {
  var LEAVE_MS = 450;
  window.zaismaWatch.each("form[data-steps]", function (form) {
    var bodies = Array.prototype.slice.call(form.querySelectorAll(":scope > .step-body")), marks = Array.prototype.slice.call(form.closest(".pane-in").querySelectorAll(".step-line > li"));
    var buttons = form.querySelector(":scope > .layout-row"), back = buttons.querySelector(".cut-btn"), next = buttons.querySelector(".run-wrap"), words = next.querySelector(".run-words:not(.label-busy)");
    var at = Number(form.getAttribute("data-steps")) || 0, last = bodies.length - 1, nextWords = "Next", finishWords = form.getAttribute("data-finish-label");
    var settling = 0;
    function mark(index) {
      marks.forEach(function (each, i) {
        each.classList.remove("is-leaving", "is-waiting"); each.classList.toggle("is-done", i < index); each.classList.toggle("is-current", i === index);
        if (i === index) each.setAttribute("aria-current", "step"); else each.removeAttribute("aria-current");
      });
    }
    function goToStep(index) {
      var from = at;
      at = Math.max(0, Math.min(last, index));
      bodies.forEach(function (body, i) { body.hidden = i !== at; });
      clearTimeout(settling);
      // Going back, the lines past the new step shrink away with the light at their tip; once they're gone the step goes back to being
      // the current one, its light at its end. Going on, the next line fills at once.
      if (at < from && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        marks.forEach(function (each, i) {
          if (i > at && (each.classList.contains("is-current") || each.classList.contains("is-done"))) { each.classList.remove("is-current", "is-done"); each.classList.add("is-leaving"); }
          each.removeAttribute("aria-current");
        });
        marks[at].classList.remove("is-done"); marks[at].classList.add("is-current", "is-waiting"); marks[at].setAttribute("aria-current", "step");
        settling = setTimeout(function () { mark(at); }, LEAVE_MS);
      } else mark(at);
      back.hidden = at === 0; if (words) words.textContent = at === last ? finishWords : nextWords;
      var first = bodies[at].querySelector("input, select, textarea, button");
      if (first && document.activeElement && form.contains(document.activeElement)) first.focus({ preventScroll: true });
    }
    form.goToStep = goToStep;
    back.addEventListener("click", function () { goToStep(at - 1); });
    form.addEventListener("submit", function (event) {
      if (at === last) return;
      event.preventDefault();
      var fields = bodies[at].querySelectorAll("input, select, textarea");
      for (var i = 0; i < fields.length; i++) if (!fields[i].checkValidity()) { fields[i].reportValidity(); return; }
      goToStep(at + 1);
    });
  });
})();
`;

const PROTECT_STEPS: StepFlowStep[] = [
  { label: "Your email", body: html`<h2>Protect your account</h2><p>An email lets you back in if you lose your password, and nothing else: we never send news.</p>${cutField({ id: "example-steps-email", name: "email", label: "Email", type: "email", icon: "mail", placeholder: "you@example.com", text: "emma@example.com" })}` },
  { label: "Check it", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-steps-code", name: "email_code", label: "Code", type: "text", icon: "mail", text: "482 913", autocomplete: "one-time-code" })}` },
  { label: "A passkey", body: html`<h2>Add a passkey</h2><p>Your device signs you in with your face, finger or screen lock. Nobody can phish it.</p>` },
];

component({
  name: "Step flow",
  slug: "step-flow",
  group: "panes",
  subgroup: "layers",
  summary: "A task in a few steps, like protecting your account: a pane with a thin step line across its top that fills in orange as you go, the step you're on ending in light, and Back and Next. Not for a task of one screen (a Glass pane), or steps inside a sheet (a Sheet's steps, with Back).",
  styles: `
/* A step flow: a pane whose top is a row of thin cut lines, one per step, each with its name under it. Done steps are filled orange; the one
   you're on fills in orange as you reach it, brightening to a light at its leading end, so it reads as moving on; the ones ahead are faint.
   The line runs from frame gap to frame gap, each step slanting toward the next, and its two outer ends are cut by the pane's corners as
   anything in a corner is (the corner's cut at the frame gap, from the cut tokens). Each name keeps the margin from its line's start. The
   step's words and fields come next, then Back and Next. */
.step-line { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); column-gap: var(--gap-control-row); row-gap: max(var(--gap-words-control), calc(var(--pad-words) - 4px));
  container-type: inline-size; }
/* Each name sits under its line at the words' gap, or further down where the pane's margin above it is more. */
.step-line > li { display: grid; align-content: start; gap: max(var(--gap-words-control), calc(var(--pad-words) - 4px)); font: var(--type-facts); color: var(--muted); transition: color var(--motion-arrive); }
.step-mark { position: relative; }
/* A step's name keeps the margin at both ends, the last one's at the pane's edge too, and breaks a word that's longer than its room (at a large text size). */
.step-label { overflow-wrap: break-word; }
/* Its light lies inside the line's carving, 2px in, as a groove's does; it fills from its start, deeper there, its tip lit while it's the step you're on. */
.step-fill { position: absolute; z-index: 2; inset: 2px; clip-path: var(--cut-shape); transform: scaleX(0); transform-origin: left; transition: transform var(--motion-settle) var(--ease-glide); }
.step-line > li:is(.is-current, .is-leaving) .step-fill::after { opacity: 1; }
.step-line > li.is-done { color: var(--ink-2); }
.step-line > li.is-done .step-fill { transform: scaleX(1); }
.step-line > li.is-current { color: var(--ink); }
.step-line > li.is-current .step-fill { transform: scaleX(1); transition-delay: var(--motion-press); }
@starting-style { .step-line > li.is-current .step-fill { transform: scaleX(0); } }
/* Going back, a line shrinks away with its light still at its tip, and halfway through the step it goes back to takes the light, fading in. */
.step-line > li.is-leaving .step-fill { transform: scaleX(0); transition-duration: var(--motion-glide); transition-timing-function: var(--ease-standard); }
.step-form { margin: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.step-body { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* Narrow (by the line's own width, as on a phone), only the step you're on is named, under the whole line. */
@container (max-width: 400px) {
  .step-line > li { display: contents; }
  .step-mark { grid-row: 1; }
  .step-line > li > .step-label { display: none; }
  .step-line > li.is-current > .step-label { display: block; grid-row: 2; grid-column: 1; width: 100cqi; }
}
/* Going back, the step you return to shows as current at once, its line full while the line past it shrinks away, its light fading in. */
.step-line > li.is-waiting .step-fill { transform: scaleX(1); transition: none; }
.step-line > li.is-waiting .step-fill::after { transition-delay: var(--motion-state); }
@media (prefers-reduced-motion: reduce) { .step-fill { transition: none; } }
`,
  render: stepFlow,
  examples: [
    { label: "Try it: Next and Back, and Turn it on starts it over", isWide: true, markup: stepFlow({ steps: PROTECT_STEPS, currentIndex: 0, action: "#step-flow", finishLabel: "Turn it on" }) },
    {
      label: "The second step, as a page of its own",
      markup: stepFlow({ steps: PROTECT_STEPS.map(({ label }) => ({ label })), currentIndex: 1, action: "#step-flow", backHref: "#step-flow", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-step-code", name: "email_code", label: "Code", type: "text", icon: "mail", autocomplete: "one-time-code" })}` }),
    },
    {
      label: "A problem on a step",
      markup: stepFlow({ steps: PROTECT_STEPS.map(({ label }) => ({ label })), currentIndex: 1, action: "#step-flow", backHref: "#step-flow", body: html`<h2>Check your email</h2><p>We sent a code to emma@example.com. It works for 10 minutes.</p>${cutField({ id: "example-step-code-wrong", name: "email_code", label: "Code", type: "text", icon: "mail", text: "482 931", autocomplete: "one-time-code", error: "That code doesn't match. Check the newest email from Zaisma, or go back to send another." })}` }),
    },
    {
      label: "Long step names",
      markup: stepFlow({ steps: [{ label: "Your email address" }, { label: "The code we sent you" }, { label: "A passkey on this device" }], currentIndex: 2, action: "#step-flow", backHref: "#step-flow", finishLabel: "Add a passkey", body: html`<h2>Add a passkey</h2><p>Your device signs you in with your face, finger or screen lock. Nobody can phish it.</p>` }),
    },
    {
      label: "Five steps",
      markup: stepFlow({
        steps: [{ label: "Make it" }, { label: "Upload" }, { label: "Check" }, { label: "Cover" }, { label: "Publish" }],
        currentIndex: 3,
        action: "#step-flow",
        backHref: "#step-flow",
        body: html`<h2>Give it a cover</h2><p>It's what players see in every list: your art alone, 16 by 9, with nothing drawn over it.</p>${cutField({ id: "example-steps-title", name: "title", label: "Title", type: "text", icon: "games", text: "The Last Lighthouse Keeper" })}`,
      }),
    },
  ],
});

// Spacing sits here, where every component it shows can be imported (foundations.ts can't import them).
// data-spacing-show marks the space it's about (GALLERY_SCRIPT draws it): "gap" between the children of what data-spacing-of
// picks (or of itself), "pad" inside it.
const spacingExample = (token: string, body: Raw) => html`<div class="spacing-example"><code>${token}</code>${body}</div>`;
const spacingPane = (body: Raw) => glassPane({ paneWidth: "fit", body: stackOfOne(body) });
component({
  name: "Spacing",
  slug: "spacing",
  group: "foundations",
  subgroup: "look",
  summary: "Every gap, padding and margin is one of these tokens, picked by what sits on each side of it, never by how close two things feel. A control is anything from Actions & Inputs; words are a heading, label or line; a block is a group of controls with their words, a paragraph, a picture or a pane. If either side is a block, it's --gap-block-block. More room is a multiple of one, never a new number.",
  styles: `
/* Spacing: the space each example is about, hatched over it. */
.spacing-example { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--gap-words-control); justify-items: start; width: 100%; }
.spacing-example > code { font: var(--type-code); color: var(--ink); }
.spacing-mark { position: absolute; z-index: 6; pointer-events: none;
  background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 34%, transparent) 0 1.5px, transparent 1.5px 5px);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 40%, transparent); }
`,
  examples: [
    {
      label: "Between the slants of two controls side by side (their boxes overlap by --control-slant less this), and the edge rule's neighbor distance: 4px",
      markup: spacingExample("--gap-control-row", html`<div data-spacing-show="gap" data-spacing-of=".layout-row">${row({ widths: "fit", items: [{ kind: "control", markup: primaryButton("Play", { type: "button", icon: "play" }) }, { kind: "control", markup: secondaryButton("Details", { type: "button" }) }] })}</div>`),
    },
    {
      label: "Two controls stacked: 8px",
      markup: spacingExample("--gap-control-stack", spacingPane(html`<div class="edge-stack" data-spacing-show="gap">${secondaryButton("Settings", { type: "button", isFullWidth: true })}${secondaryButton("Account", { type: "button", isFullWidth: true })}${secondaryButton("Sign out", { type: "button", isFullWidth: true })}</div>`)),
    },
    {
      label: "A control and the words that belong to it: 8px",
      markup: spacingExample("--gap-words-control", spacingPane(html`<div data-spacing-show="gap" data-spacing-of=".cut-field">${cutField({ id: "spacing-username", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r", autocomplete: "off" })}</div>`)),
    },
    {
      label: "Words beside or under words in one block, an icon and its word: 8px",
      markup: spacingExample("--gap-words-words", spacingPane(html`<div data-spacing-show="gap" data-spacing-of=".glance">${glanceFacts({ playerCount: 1204, playedAtMs: Date.now() - 2 * 60 * 60_000 })}</div>`)),
    },
    {
      label: "Two blocks, here two labeled fields in a pane: 24px",
      markup: spacingExample("--gap-block-block", html`<div data-spacing-show="gap" data-spacing-of=".layout-stack">${spacingPane(stack({ items: [{ kind: "control", markup: cutField({ id: "spacing-name", name: "username", label: "Username", type: "text", icon: "person", autocomplete: "off" }) }, { kind: "control", markup: cutField({ id: "spacing-email", name: "email", label: "Email", type: "email", icon: "mail", autocomplete: "off" }) }] }))}</div>`),
    },
    {
      label: "A pane's edge and anything with an edge of its own (a button, a field, a cover, a table): the frame gap, 12px (10px on a phone)",
      markup: spacingExample("--pad-frame", html`<div data-spacing-show="pad" data-spacing-of=".pane-in">${spacingPane(primaryButton("Sign in", { type: "button", isFullWidth: true }))}</div>`),
    },
    {
      label: "A pane's edge and its words: 24px (18px on a phone), --pad-words further in than the frame gap",
      markup: spacingExample("--pad-pane", html`<div data-spacing-show="pad" data-spacing-of=".stack-cell.is-words">${spacingPane(stack({ items: [{ kind: "words", markup: html`<h2>Welcome back</h2>` }, { kind: "control", markup: primaryButton("Sign in", { type: "button", isFullWidth: true }) }] }))}</div>`),
    },
    {
      label: "An inner pane's edge (the birthday picker, a menu) and a bar's (the header): 12px",
      markup: spacingExample("--pad-inner-pane", spacingPane(html`<div data-spacing-show="pad" data-spacing-of=".wheel-pick">${wheelField({ id: "spacing-bday", wheelKind: "birthday", name: "birthday", label: "When's your birthday?", state: "open" })}</div>`)),
    },
  ],
});
