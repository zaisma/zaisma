import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
// The materials register first: the Materials page starts with them.
import "./materials.ts";
import { CUT_LINE, EDGE, EDGE_LIGHT, backdrop, divider, floatingPane, glassPane, groove, icon, picture, sheetMarkup, tag, tray, well, type IconName, type ShownPicture } from "./foundations.ts";
import { STAND_IN_COVER_PICTURES } from "../generated/stand-in-placeholders.generated.ts";
import { doneState, emptyState, glanceFacts, problemState, listRows, pictureFrame, pictureRow } from "./data.ts";
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
  /** The page you're on, or the choice that's made: its words dark and a check at its end, a Select field's tick. */
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
export const DROPDOWN_CHOICE_CLASS = "dropdown-choice flush-row compact quiet";
/** The check at the end of a dropdown's chosen choice, the tick a Select field marks its pick with. */
export const DROPDOWN_TICK = html`<span class="dropdown-tick">${icon("check")}</span>`;

/**
 * One choice in a dropdown: words with an icon, flat on its glass, the menu's rim lit beside it when pointed at, a check at its end when chosen.
 * It's a menu item the arrow keys move between.
 */
function dropdownChoice(choice: DropdownChoice): Raw {
  const inside = html`${CUT_LINE}${choice.icon ? icon(choice.icon) : ""}<span class="one-line">${choice.label}</span>${choice.badgeCount ? tag(choice.badgeCount, "count") : ""}${choice.isNewTab ? html`<span class="dropdown-out" aria-hidden="true">${icon("out-of-page")}</span>` : ""}${choice.isCurrent ? DROPDOWN_TICK : ""}`;
  const dataMarkup = choice.dataAttributes ? html`${Object.entries(choice.dataAttributes).map(([name, text]) => html` data-${name}="${text}"`)}` : "";
  const shared = html` class="${DROPDOWN_CHOICE_CLASS}${choice.state ? ` ${choice.state}` : ""}"${raw(' role="menuitem" tabindex="-1" data-lights')} data-cut-line="8"${choice.id ? html` id="${choice.id}"` : ""}${choice.isHidden ? raw(" hidden") : ""}${choice.isCurrent ? raw(' aria-current="page"') : ""}`;
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
  return html`${floatingPane({ id: options.id, placement: "under", kind: "dropdown", role: "menu", label: options.label, isShownInPlace: options.isOpen, edgeLight: "left", head: head || undefined, body: choices })}`;
}

/** What a game card says about a game. Each kind of fact has its one place, the same on every card, so a list of them reads at a glance. */
export interface GameCardFacts {
  /** Players now: at the end of its line, after its title. Left out, the title has the line to itself. */
  playerCount?: number;
  /** A paid game's price to play, for a viewer who doesn't own it: the art's top right corner. A free game shows nothing. */
  priceText?: string;
  /** It changed since the viewer last played it: Updated, the art's top left corner. */
  isUpdated?: boolean;
  /** Friends playing it now: their faces, the art's bottom left corner (three, and how many more). */
  friends?: { username: string }[];
  /** Why it isn't for this device ("Needs a keyboard", "Made for computers"): the art's bottom right corner, the art dimmed. */
  deviceNote?: string;
}

export interface GameCardOptions {
  title: string;
  /** The studio's cover, or null for a game with none yet: Zaisma's mark in the well stands in. While it loads, its placeholder does. */
  picture: ShownPicture | null;
  href: string;
  facts: GameCardFacts;
  /** The game's own glass tint (#rrggbb), which its lit edge takes; left out, the edge lights white. */
  tintColor?: string | null;
  /** The game in the pane beside the list: its edge stays lit. */
  isCurrent?: boolean;
  /** Its art loads with the page, not once it nears the screen: for the cards a page opens with in view, like the home's first. */
  isEager?: boolean;
  /** Its art is fetched before the page's other pictures: for the one card likely the largest thing in the first view. */
  hasHighPriority?: boolean;
  /** Pointed at or pressed: the gallery's still copies. */
  state?: "is-pointed" | "is-pressed";
}

/** The device note's icon: a gamepad for one that needs it, a phone for one best held a way or made for phones and tablets, else a computer. */
const deviceIcon = (deviceNote: string): IconName => (/gamepad/i.test(deviceNote) ? "gamepad" : /phone|tablet|portrait|landscape/i.test(deviceNote) ? "phone" : "computer");

/**
 * What a screen reader hears for a card: its title, then each fact on it, in the order of its corners.
 */
const cardLabel = (options: GameCardOptions): string =>
  [
    options.title,
    options.facts.isUpdated ? "updated" : "",
    options.facts.priceText ?? "",
    options.facts.friends?.length ? `${options.facts.friends.map((friend) => friend.username).join(", ")} playing` : "",
    options.facts.deviceNote ?? "",
  ].filter(Boolean).join(", ");


/**
 * A game card: a game in a list, the studio's art in a carved well with its title and players now on one line under it. What else
 * concerns you about it lies in a corner of the art, each kind in its own corner on every card: news (Updated) top left, the price top
 * right, friends playing bottom left, this device (needs a keyboard, made for another) bottom right, the art dimmed. Pointed at, the
 * well's foot catches the light (Edge light, the card the part it lights), in the game's tint, and the art brightens; in focus beside the
 * list, it stays lit.
 */
export function gameCard(options: GameCardOptions): Raw {
  const facts = options.facts, isPlaceholder = options.picture === null;
  const hasTint = Boolean(options.tintColor && /^#[0-9a-fA-F]{6}$/.test(options.tintColor));
  const tint = hasTint ? html` style="--card-tint: ${options.tintColor}"` : "";
  const className = ["cover", isPlaceholder ? "is-placeholder" : "", facts.deviceNote ? "is-other-device" : "", hasTint ? "has-tint" : "", options.state ?? ""].filter(Boolean).join(" ");
  const marks = html`${facts.isUpdated ? html`<span class="cover-mark at-news">${tag("Updated", "new-on-glass")}</span>` : ""}${facts.priceText ? html`<span class="cover-mark at-price">${tag(facts.priceText, "glass")}</span>` : ""}${facts.friends?.length ? html`<span class="cover-mark at-friends">${pictureRow(facts.friends.map((friend) => friend.username), "xs")}</span>` : ""}${facts.deviceNote ? html`<span class="cover-mark at-device">${tag(facts.deviceNote, "glass", { icon: deviceIcon(facts.deviceNote) })}</span>` : ""}`;
  const art = isPlaceholder ? "" : html`<span class="cover-picture carving-art" data-cut-line="0">${picture(options.picture!, { isEager: options.isEager, hasHighPriority: options.hasHighPriority })}</span>`;
  const playerCountMarkup = facts.playerCount !== undefined ? html`<span class="count">${icon("people")}<span>${facts.playerCount.toLocaleString("en-US")}<span class="sr"> playing now</span></span></span>` : "";
  return html`<div class="${className}"${tint}${options.isCurrent ? raw(' aria-current="true"') : ""}><a class="cover-art carving holds-art${options.state ? ` ${options.state}` : ""}" data-cut-line="0" data-edge-light="bottom" data-lights href="${options.href}" aria-label="${cardLabel(options)}">${CUT_LINE}${art}${EDGE_LIGHT}${marks}</a><div class="cover-meta"><span class="cover-name one-line">${options.title}</span>${playerCountMarkup}</div></div>`;
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
    // Where it stands once its arriving move is done: its box less the move, so the shadow doesn't jump when the move ends.
    var box = pane.getBoundingClientRect(), move = new DOMMatrix(getComputedStyle(pane).transform === "none" ? undefined : getComputedStyle(pane).transform);
    var r = { width: pane.offsetWidth, height: pane.offsetHeight }; r.left = box.left + box.width / 2 - r.width / 2 - move.e; r.top = box.top + box.height / 2 - r.height / 2 - move.f;
    var isOnPage = pane.classList.contains("is-on-page");
    // The cut is its glass's (--glass-clip, GLASS_SCRIPT): the pane itself isn't clipped, so what stands on it can cast past its edge.
    var paneStyle = getComputedStyle(pane), shape = paneStyle.getPropertyValue("--glass-clip").trim() || paneStyle.clipPath, points = /^polygon\\((.*)\\)$/.exec(shape);
    var far = "calc(100% + " + CAST_REACH_PX + "px)", near = -CAST_REACH_PX + "px";
    // Its glass's cut is measured a frame or more after it opens: until then it casts nothing, rather than a square.
    if (!points) { cast.hidden = true; pane.castTries = (pane.castTries || 0) + 1; if (pane.castTries < 60) requestAnimationFrame(function () { window.zaismaCast(pane); }); return; }
    pane.castTries = 0;
    var inner = points ? points[1].replace(/^(nonzero|evenodd),\\s*/, "") : "0px 0px, 100% 0px, 100% 100%, 0px 100%";
    cast.firstChild.firstChild.style.clipPath = points ? shape : "";
    cast.style.clipPath = "polygon(evenodd, " + near + " " + near + ", " + far + " " + near + ", " + far + " " + far + ", " + near + " " + far + ", " + near + " " + near + ", " + inner + ", " + inner.split(",")[0] + ", " + near + " " + near + ")";
    // Shown while it arrives (Safari), it starts from nothing and comes in with the pane.
    if (cast.hidden && cast.classList.contains("is-arriving")) requestAnimationFrame(function () { void cast.offsetWidth; cast.classList.remove("is-arriving"); });
    cast.hidden = false; cast.classList.toggle("is-on-page", isOnPage);
    // Its shadow is its pane's, light or dark as the pane is (the gallery's choice, or smoked over a game), not the page's own.
    var themeChoice = pane.getAttribute("data-theme-choice");
    if (themeChoice) cast.setAttribute("data-theme-choice", themeChoice); else cast.removeAttribute("data-theme-choice");
    cast.classList.toggle("smoke", pane.classList.contains("smoke"));
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
   *   onPlaced      each time it's placed, once it knows its side (a menu squaring the corner nearest its button)
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
      if (options.onPlaced) options.onPlaced();
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
      if (options.onPlaced) options.onPlaced();
      window.zaismaCast(pane);
    }
    function open() {
      if (isInPlace) return;
      if (!pane.matches(":popover-open")) {
        // The page's own light or dark, and the hue of the glass where it hangs, which it no longer inherits.
        var home = options.home || anchorNow() || document.body, themed = home.closest("[data-theme-choice]");
        if (themed && themed !== document.documentElement) pane.setAttribute("data-theme-choice", themed.getAttribute("data-theme-choice")); else pane.removeAttribute("data-theme-choice");
        // Smoked where it hangs (over a game's world that took smoked glass), as it is now, not as it was when the page loaded.
        pane.classList.toggle("smoke", Boolean(home.closest(".smoke")));
        pane.style.setProperty("--glass-hue", getComputedStyle(home).getPropertyValue("--glass-hue"));
        // A browser that can't fade it in by itself (Safari, no overlay) shows it from its closed look, then lets it arrive.
        if (isMovedByScript) { window.zaismaCast(pane); clearTimeout(pane.leaveTimer); [pane, pane.floatCast].forEach(function (one) { one.classList.remove("is-leaving"); one.classList.add("is-arriving"); }); }
        pane.showPopover();
        // Its glass is cut a frame or more after it opens, and Safari takes a long frame or two to first draw it: it arrives once it's cut and
        // frames come quickly again, so the fade isn't spent before anything shows.
        if (isMovedByScript) (function arrive(tries, last) { requestAnimationFrame(function (now) {
          var isReady = getComputedStyle(pane).getPropertyValue("--glass-clip").trim() && last && now - last < 25;
          if (!isReady && tries < 30) return arrive(tries + 1, now);
          pane.classList.remove("is-arriving");
        }); })(0, 0);
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
        pane.classList.add("is-leaving"); if (pane.floatCast) pane.floatCast.classList.add("is-leaving");
        pane.leaveTimer = setTimeout(function () { pane.classList.remove("is-leaving"); pane.hidePopover(); if (pane.floatCast) pane.floatCast.classList.remove("is-leaving"); }, LEAVE_MS);
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
      onToggle: function (isOpen) { var button = buttons.get(menu) || buttonOf(menu); if (button) button.setAttribute("aria-expanded", String(isOpen)); },
      // The corner nearest its button is square, the rest cut as a menu's: the one corner unlike the others is where it hangs from. Under
      // its button that's a top corner, over it a bottom one, at the button's end or (from-start) its start.
      onPlaced: function () {
        var cuts = ["menu-large", "menu-small", "menu-large", "menu-small"], isStart = menu.classList.contains("from-start");
        cuts[menu.classList.contains("is-above") ? (isStart ? 3 : 2) : (isStart ? 0 : 1)] = "0";
        if (menu.getAttribute("data-glass-corners") === cuts.join(" ")) return;
        menu.setAttribute("data-glass-corners", cuts.join(" "));
        if (menu.redrawGlass) menu.redrawGlass();
      }
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
    // A choice closes it, except one that opens more choices in it (aria-haspopup) or that its page applies in place, the menu kept open (data-keeps-open: a Filter menu's).
    menu.addEventListener("click", function (event) { if (event.target.closest('[role="menuitem"]:not([aria-haspopup], [data-keeps-open])')) float.close(false); });
  });
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("[aria-controls][aria-expanded]");
    var menu = button && document.getElementById(button.getAttribute("aria-controls"));
    if (!menu || !menu.matches('.dropdown[role="menu"]') || !menu.floating) return;
    if (menu.floating.isOpen() && buttons.get(menu) === button) { menu.floating.close(false); return; }
    buttons.set(menu, button);
    menu.floating.open();
    // Opened from the keyboard, the first choice takes the focus; opened by a press, the menu itself does, so the arrow keys work at once
    // and a key pressed later never lights the button it was opened from.
    var first = items(menu)[0];
    if (event.detail === 0 && first) first.focus({ preventScroll: true });
    else { menu.tabIndex = -1; menu.focus({ preventScroll: true }); }
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
/* Holding the focus as a whole (opened by a press) it draws no ring: a choice it moves to lights its rim. */
.floating-pane.dropdown:focus-visible { outline: none; }
/* Its choices are flat, words on its glass: pointed at or moved to with the keyboard, the words darken and its rim lights beside the choice
   (Edge light, as a switch's does, cut to its glass); the chosen one keeps its words dark and ends in a check (a Select field's tick), never a slab. */
/* Its rules sit close to its choices: a menu's groups are a few choices each, so a page's gap round them would part them more than they
   differ. Under its head's words a rule keeps the usual gap, so the words never crowd it. */
.floating-pane.dropdown .divider { margin-block: 3px; }
.floating-pane.dropdown .dropdown-head + .divider { margin-top: var(--gap-control-stack); }
.floating-pane.dropdown > .edge-light { position: absolute; inset: 0; clip-path: var(--glass-clip); }
/* On a menu's thin light glass, white light hardly shows: its flood there is the cool light smoked glass catches, a little stronger
   (--menu-edge-flood), so it shows by its color. On smoked glass it's the switch's light. */
.floating-pane.dropdown[data-edge-light="left"] > .edge-light::after { background: linear-gradient(to right, var(--edge-light) 0, var(--menu-edge-flood) 2px, var(--menu-edge-flood-far) 14px, transparent 44px); }
.floating-pane.dropdown .dropdown-choice[aria-current="page"] { background: none; box-shadow: none; }
.floating-pane.dropdown .dropdown-choice:is(:hover, :focus-visible, .is-pointed, .is-focused) { color: var(--ink); }
.floating-pane.dropdown .dropdown-choice[aria-current="page"] { color: var(--ink); }
.dropdown-tick { flex: none; display: inline-flex; margin-left: auto; color: var(--ink); }
.dropdown-tick > .ico { width: 18px; height: 18px; stroke-width: 2.2; }
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
/* A game card is a carved well cut into the glass, with the studio's art set inside it: no glass over the art, only the small marks in its
   corners. The well and the art are both cut by the edge rule like every control, so a card near a pane's corner takes the pane's cut and
   one in the middle of it is square. The well keeps the card's 16:9, and the art fills it up to its carved rim (2px). Under the art,
   Zaisma's mark sits in the well: it shows until the art has loaded, and stays where a game has none (is-placeholder). */
.cover { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); row-gap: var(--gap-words-words); min-width: 0; }
.cover-art { position: relative; display: block; aspect-ratio: 16 / 9; text-decoration: none; container-type: inline-size; }
.cover.is-placeholder .cover-art img { display: none; }
.cover-art:focus-visible { outline: none; }
.cover-art:focus-visible > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Its corners: each kind of fact has one, the same on every card, a part's frame gap in from the rim. News top left, the price top right,
   friends bottom left, this device bottom right. */
.cover-mark { position: absolute; z-index: 2; display: inline-flex; pointer-events: none; }
.cover-mark.at-news { top: var(--pad-frame-compact); left: var(--pad-frame-compact); }
.cover-mark.at-price { top: var(--pad-frame-compact); right: var(--pad-frame-compact); }
.cover-mark.at-friends { bottom: var(--pad-frame-compact); left: var(--pad-frame-compact); }
.cover-mark.at-device { bottom: var(--pad-frame-compact); right: var(--pad-frame-compact); }
/* Each is a sliver of glass over the art (Tag's glass tones), blurring the art under it and as thick as a pane's glass, so its words read
   on any picture; news in the green new things have. */
.cover-mark .tag.glass { --glass-tint: var(--glass-regular); }
/* On a small card a device's words would crowd it: its icon alone says it (the screen reader still hears the words, in the card's label). */
@container (max-width: 220px) { .cover-mark.at-device .tag > span { display: none; } .cover-mark.at-device .tag { padding-inline: 7px 6px; } }
/* Made for another device: the art dimmed, its words quieter, still there to open and read about. */
.cover.is-other-device .cover-picture { filter: grayscale(0.8) brightness(0.85); }
.cover.is-other-device .cover-name { color: var(--ink-2); }
/* Pointed at, its well's foot catches the light (Edge light, along its bottom: the card is the part it lights, so the whole foot lights),
   in the game's own tint (--card-tint, its glass tint) or white, and the art brightens a little. The game in focus beside the list keeps
   it lit. Pressed, the art sinks in place. */
.cover-art > .edge-light { z-index: 1; }
.cover.has-tint .cover-art { --edge-light: var(--card-tint); --edge-flood: color-mix(in srgb, var(--card-tint) 62%, transparent);
  --edge-flood-far: color-mix(in srgb, var(--card-tint) 24%, transparent); --edge-wake: color-mix(in srgb, var(--card-tint) 80%, transparent); }
/* Lit without a pointer's own events (in focus beside the list, the gallery's pointed and pressed copies and loops): the whole foot. */
.cover:is([aria-current="true"], .is-pointed, .is-pressed) .cover-art > .edge-light, .cover-art:is(.is-pointed, .is-pressed) > .edge-light { --light-at: 50cqw; --light-span: 100cqw; }
.cover:is([aria-current="true"], .is-pointed, .is-pressed) .cover-art > .edge-light::before, .cover:is([aria-current="true"], .is-pointed, .is-pressed) .cover-art > .edge-light::after,
.cover-art:is(.is-pointed, .is-pressed) > .edge-light::before, .cover-art:is(.is-pointed, .is-pressed) > .edge-light::after { opacity: 1; }
.cover-picture img { transition: filter var(--motion-state) var(--ease-standard); }
.cover:is(:hover, .is-pointed) .cover-picture img, .cover-art.is-pointed .cover-picture img { filter: brightness(1.06); }
/* Pressed, the art sinks into its well, its size kept: it drops a little toward the light and the well's rim casts its shade over it, deep
   along the top and lighter down the sides, so the walls show as it goes down; it darkens a touch, quickly. Let go, it springs back up.
   Its corners' marks go down with it, and its foot stays lit. */
.cover-art > :where(.cover-picture, .cover-mark) { transition: transform var(--motion-glide) var(--ease-spring); }
.cover-picture::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; box-shadow: inset 0 7px 9px -5px rgba(0, 0, 0, 0.55), inset 4px 0 6px -4px rgba(0, 0, 0, 0.3), inset -4px 0 6px -4px rgba(0, 0, 0, 0.3); transition: opacity var(--motion-glide) var(--ease-standard); }
.cover-art:is(:active, .is-pressed) > :where(.cover-picture, .cover-mark), .cover.is-pressed .cover-art > :where(.cover-picture, .cover-mark) { transform: translateY(1.5px); transition-duration: var(--motion-press); transition-timing-function: var(--ease-standard); }
.cover-art:is(:active, .is-pressed) .cover-picture::after, .cover.is-pressed .cover-picture::after { opacity: 1; transition-duration: var(--motion-press); }
.cover-art:is(:active, .is-pressed) .cover-picture img, .cover.is-pressed .cover-picture img { filter: brightness(0.93); transition-duration: var(--motion-press); }
/* Its line under the art: the title, cut to one line, and players now at its end. Nothing else is ever said there. */
.cover-meta { display: flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--muted); }
.cover-meta .cover-name { flex: 1 1 0; min-width: 0; font: var(--type-name); color: var(--ink); }
.cover-meta .ico { width: 15px; height: 15px; stroke-width: 1.5; }
.cover-meta .count { display: inline-flex; align-items: center; gap: var(--gap-words-words); flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--ink-2); }
@media (prefers-reduced-motion: reduce) { .cover-picture img, .cover-picture::after, .cover-art > :where(.cover-picture, .cover-mark) { transition: none; } }
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
    // Updated since it was played: it changed more recently than the viewer last played it.
    const isUpdated = game.updatedAgoDurationMs !== undefined && game.playedAgoDurationMs !== undefined && game.updatedAgoDurationMs < game.playedAgoDurationMs;
    const facts: GameCardFacts = { playerCount: game.playerCount, friends: game.friends, isUpdated };
    return [game.slug, gameCard({ title: game.title, picture: STAND_IN_COVER_PICTURES[game.slug] ?? null, href: `#${game.slug}`, facts })];
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
/* Opened again at once where it just was (a Filter menu drawn again with the list it filters), it shows without arriving. */
.floating-pane.opens-at-once, .floating-pane.opens-at-once::before, .floating-pane.opens-at-once > * { transition: none; }
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
/* Where the script moves the pane (Safari), its shadow fades in and out with it, where it stands. */
.floating-cast { transition: opacity var(--motion-arrive) var(--ease-glide); }
.floating-cast:is(.is-arriving, .is-leaving) { opacity: 0; }
/* Shown open in place (the gallery's open states), it's in the page's flow, no taller than a menu, scrolling past it as it does open. Over, as wide as what's in it, it lies on
   the field just before it, its line (--line-from-top) on the field's own line; glass inside a pane's glass isn't blurred, so what it
   covers is hidden rather than showing through, and it casts its shadow as a filter on what holds it, where only it is drawn. */
.floating-pane.in-place { position: relative; display: flex; width: 100%; }
/* Shown open in place (a gallery's open menu), it casts the shadow it casts floating, so the two read the same. It lies on glass there and
   only tints, so the filter costs it no blur; over a game's world it blurs, which a filter round it would stop, so it casts none. */
.floating-pane.in-place:not(:is(.backdrop-frame, .header-frame) *) { filter: var(--float-cast); }
/* One as wide as what's in it (a menu) hangs under its anchor inside what holds it (zaismaFloat's hang). */
.floating-pane.placed-under.in-place.is-hanging { position: absolute; z-index: 6; width: max-content; max-width: 100%; }
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
    {
      label: "Try it: press it, move with the arrow keys, close it with Esc or a press outside",
      markup: html`<div class="dropdown-try">${secondaryButton("Your account", { type: "button", controls: "example-menu-try", isExpanded: false })}${dropdown({ id: "example-menu-try", label: "Your account", head: { title: "emma_r", note: "Online" }, items: ACCOUNT_ITEMS })}</div>`,
    },
    {
      label: "Over a game's world, on a pane: Your account open, Sort to try",
      isWide: true,
      markup: html`<div class="backdrop-frame holds-menus">${backdrop({ isFramed: true, standInSlug: "neon-drift", isGlassAdaptive: true })}<div class="dropdown-frame">${glassPane({
        paneWidth: "full",
        body: row({ widths: "fit", alignment: "between", items: [control(secondaryButton("Sort", { type: "button", controls: "example-menu-world-try", isExpanded: false })), control(secondaryButton("Your account", { type: "button", controls: "example-menu-world", isExpanded: true }))] }),
      })}${dropdown({ id: "example-menu-world-try", label: "Sort games", items: [{ label: "Most played", href: "#dropdown", isCurrent: true }, { label: "Newest", href: "#dropdown" }, { label: "Recently updated", href: "#dropdown" }] })}${dropdown({ id: "example-menu-world", label: "Your account", head: { title: "emma_r", note: "Online" }, items: ACCOUNT_ITEMS, isOpen: true })}</div></div>`,
    },
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
.sheet.light-box:is(:not([open]), .is-leaving, .is-arriving) { transform: scale(0.96); }
@starting-style { .sheet.light-box[open] { transform: scale(0.96); } }
.light-box-in { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gap-words-control); margin: 0; }
.light-box-close { position: absolute; top: var(--pad-frame); right: var(--pad-frame); }
.light-box-close .tertiary-btn { color: var(--ink); }
@media (prefers-reduced-motion: reduce) { .sheet.light-box:is(:not([open]), .is-leaving, .is-arriving) { transform: none; } @starting-style { .sheet.light-box[open] { transform: none; } } }
`,
  render: lightBox,
  examples: [
    {
      label: "Try it: a game's QR code, large",
      markup: html`${secondaryButton("Show QR code", { type: "button", controls: "example-light-box" })}${lightBox({ id: "example-light-box", label: "QR code for Ashen Crown", closeLabel: "Close", body: qrCode({ id: "example-light-box-qr", label: "QR code for Ashen Crown", caption: "Scan with a phone's camera to play Ashen Crown", imageUrl: STAND_IN_QR_CODE, iconUrl: STAND_IN_GAME_ICON, isLarge: true }) })}`,
    },
  ],
});

const cardSample = (options: GameCardOptions) => html`<div class="cover-sample">${gameCard(options)}</div>`;

component({
  name: "Game card",
  slug: "game-card",
  group: "panes",
  subgroup: "cards",
  summary: "A game in a list of games (the home's shelves, Browse, More from a developer): the studio's art in a carved well, its title and players now on one line under it. Everything else lies in a corner of the art, each kind always in its own: Updated top left, a price top right, friends playing bottom left, this device bottom right. Pointed at, its foot lights in the game's tint.",
  styles: COVER_STYLES,
  render: gameCard,
  examples: [
    {
      label: "In a list: every card the same shape, its facts in their corners",
      isWide: true,
      markup: grid({ whenEmpty: html`<p>No games here yet.</p>`, itemSize: "cover", items: [
        { kind: "block", markup: gameCard({ title: "Kestrel", picture: STAND_IN_COVER_PICTURES["kestrel"]!, href: "#kestrel", facts: { playerCount: 12480, isUpdated: true } }) },
        { kind: "block", markup: gameCard({ title: "Hollow Tide", picture: STAND_IN_COVER_PICTURES["hollow-tide"]!, href: "#hollow-tide", facts: { playerCount: 412, priceText: "$24.99" } }) },
        { kind: "block", markup: gameCard({ title: "Neon Drift", picture: STAND_IN_COVER_PICTURES["neon-drift"]!, href: "#neon-drift", facts: { playerCount: 3870, friends: [{ username: "Liam" }, { username: "Sofia" }] } }) },
        { kind: "block", markup: gameCard({ title: "Verdant", picture: STAND_IN_COVER_PICTURES["verdant"]!, href: "#verdant", facts: {} }) },
      ] }),
    },
    { label: "Plain: its title and players now", markup: cardSample({ title: "Hollow Tide", picture: STAND_IN_COVER_PICTURES["hollow-tide"]!, href: "#hollow-tide", facts: { playerCount: 412 } }) },
    { label: "Free: nothing more, since most games are", markup: cardSample({ title: "Verdant", picture: STAND_IN_COVER_PICTURES["verdant"]!, href: "#verdant", facts: { playerCount: 96 } }) },
    { label: "Paid, not owned: its price, top right", markup: cardSample({ title: "Hollow Tide", picture: STAND_IN_COVER_PICTURES["hollow-tide"]!, href: "#hollow-tide", facts: { playerCount: 412, priceText: "$24.99" } }) },
    { label: "Updated since you played: top left", markup: html`<div class="cover-sample">${standInCovers(["ashen-crown"])}</div>` },
    { label: "Friends playing: bottom left", markup: html`<div class="cover-sample">${standInCovers(["neon-drift"])}</div>` },
    { label: "Five friends playing: three, and how many more", markup: cardSample({ title: "Kestrel", picture: STAND_IN_COVER_PICTURES["kestrel"]!, href: "#kestrel", facts: { playerCount: 12480, friends: [{ username: "Sofia" }, { username: "Liam" }, { username: "Emma" }, { username: "Noah" }, { username: "Charlotte" }] } }) },
    { label: "Needs a keyboard, on a phone: bottom right, the art dimmed", markup: cardSample({ title: "Verdant", picture: STAND_IN_COVER_PICTURES["verdant"]!, href: "#verdant", facts: { playerCount: 96, deviceNote: "Needs a keyboard" } }) },
    { label: "Made for another device", markup: cardSample({ title: "Iron Vigil", picture: STAND_IN_COVER_PICTURES["iron-vigil"]!, href: "#iron-vigil", facts: { playerCount: 8214, deviceNote: "Made for computers" } }) },
    { label: "No cover yet: Zaisma's mark", markup: cardSample({ title: "The Last Lighthouse Keeper", picture: null, href: "#game-card", facts: { playerCount: 38 } }) },
    { label: "Nobody playing now: its title alone", markup: cardSample({ title: "Kestrel", picture: STAND_IN_COVER_PICTURES["kestrel"]!, href: "#kestrel", facts: {} }) },
    { label: "A long title: cut to one line", markup: cardSample({ title: "Ashen Crown: The Long Night of the Iron Vigil", picture: STAND_IN_COVER_PICTURES["ashen-crown"]!, href: "#ashen-crown", facts: { playerCount: 7 } }) },
    { label: "Everything at once: one in each corner", markup: cardSample({ title: "Hollow Tide", picture: STAND_IN_COVER_PICTURES["hollow-tide"]!, href: "#hollow-tide", facts: { playerCount: 412, isUpdated: true, priceText: "$24.99", friends: [{ username: "Liam" }, { username: "Sofia" }], deviceNote: "Needs a keyboard" } }) },
    { label: "Pointed at: its foot lit in the game's tint", markup: cardSample({ title: "Neon Drift", picture: STAND_IN_COVER_PICTURES["neon-drift"]!, href: "#neon-drift", facts: { playerCount: 3870 }, tintColor: "#C454E8", state: "is-pointed" }), isStill: true },
    { label: "Pressed: the art sinks into its well", markup: cardSample({ title: "Neon Drift", picture: STAND_IN_COVER_PICTURES["neon-drift"]!, href: "#neon-drift", facts: { playerCount: 3870 }, tintColor: "#C454E8", state: "is-pressed" }), isStill: true },
    { label: "In focus beside the list: its foot stays lit", markup: cardSample({ title: "Verdant", picture: STAND_IN_COVER_PICTURES["verdant"]!, href: "#verdant", facts: { playerCount: 96 }, isCurrent: true }), isStill: true },
    { label: "On a loop", markup: html`<div class="cover-sample" data-state-loop="cover">${standInCovers(["iron-vigil"])}</div>`, isStill: true },
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
  /**
   * A small step (a list of players, one player's choices): the sheet is a compact one while it shows, hung from its button. Left out, it's a
   * task (Report): the sheet takes a task sheet's size and lets go of its button, centered on a wide screen, and hangs from it again back on a small step.
   */
  isCompact?: boolean;
}

/** A sheet whose task moves forward inside it: the first step shows as it opens; every step after it has Back before its title. Each step has its own size. */
interface SheetOfStepsOptions extends Omit<SheetBaseOptions, "isCompact"> {
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
      return html`<section class="sheet-step" data-sheet-step="${step.stepName}"${step.isCompact ? raw(" data-sheet-step-compact") : ""}${index ? raw(" hidden") : ""}>${paneParts({ head: { start: index ? back : undefined, words, end: closeButton }, body: sheetScroll(step.body), foot: sheetFoot(step.buttons) })}</section>`;
    })}`;
    return sheetMarkup({ ...options, isCompact: options.steps[0]!.isCompact, title: options.steps[0]!.title, titleId: `${options.id}-${options.steps[0]!.stepName}-title`, body: html``, parts, closeButton });
  }
  if ("tabs" in options) {
    // Its head: the title, and under it a Switch of its tabs (each with its count), Close beside the title. Choosing a tab swaps what's in
    // the body under them (LAYERS_SCRIPT), and the head stays put while the body scrolls.
    const tabRow = tabSwitch({ label: options.title, switchSize: "small", isFull: true, tabs: options.tabs.map((tab, index) => ({ label: tab.label, tabValue: tab.tabValue, isCurrent: index === 0, badgeCount: tab.itemCount, extra: raw(` data-sheet-tab-to="${tab.tabValue}"`) })) });
    const words = html`<h2 class="sheet-title" id="${options.id}-title">${options.title}</h2>${tabRow}`;
    const body = html`${options.tabs.map((tab, index) => html`<section class="sheet-tab" data-sheet-tab="${tab.tabValue}"${index ? raw(" hidden") : ""}>${tab.body}</section>`)}`;
    return sheetMarkup({ ...options, body: html``, parts: paneParts({ head: { words, end: closeButton }, body: sheetScroll(body), foot: sheetFoot(options.buttons) }), closeButton });
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
.sheet:is(:not([open]), .is-leaving, .is-arriving)::before, .sheet:is(:not([open]), .is-leaving, .is-arriving) > * { opacity: 0; }
@starting-style { .sheet[open]::before, .sheet[open] > * { opacity: 0; } }
/* A picture's sheet: as wide as the screen allows, up to its own size, so a screenshot or a screen shows large. */
.sheet.is-picture { max-width: min(var(--size-sheet-picture), calc(100% - 2 * var(--pad-pane))); }
/* Over the page, fixed to the window whether it's opening, open or closing (it stops being :modal the moment it starts to close). */
.sheet:not(.in-place) { position: fixed; inset: 0; z-index: 40; }
/* The sheet itself takes the focus when a press opened it (LAYERS_SCRIPT): no ring, a ring is for the keyboard. */
.sheet:focus-visible { outline: none; }
.sheet:is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(16px) scale(0.98); pointer-events: none; transition-timing-function: ease, ease, var(--ease-leave); }
@starting-style { .sheet[open] { transform: translateY(12px) scale(0.985); } }
.sheet::backdrop { opacity: 1; transition: opacity var(--motion-arrive), overlay var(--motion-arrive) allow-discrete, display var(--motion-arrive) allow-discrete; }
.sheet:is(:not([open]), .is-leaving, .is-arriving)::backdrop { opacity: 0; }
@starting-style { .sheet[open]::backdrop { opacity: 0; } }
/* At the foot: risen from the bottom of the screen over a running game, which stays in view, never dimmed (a buy sheet). */
.sheet.placement-foot:not(.in-place) { margin: auto auto var(--pad-pane); }
.sheet.placement-foot:is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(40px); }
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
  .sheet:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(40px); }
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
.sheet.is-anchored:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(-8px) scale(0.98); }
.sheet.is-anchored.is-above:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(8px) scale(0.98); }
@starting-style { .sheet.is-anchored:not(.in-place)[open] { transform: translateY(-8px) scale(0.98); } .sheet.is-anchored.is-above:not(.in-place)[open] { transform: translateY(8px) scale(0.98); } }
/* A small sheet's gaps closed up and its title at a name's size, as a dropdown's are, on every screen (it hangs from its button on a phone too). */
.sheet:is(.is-compact, [data-sheet-confirm].is-over-sheet) :is(.sheet-in, .sheet-body) { gap: var(--gap-control-stack); }
/* A task sheet's head sits further in than a small sheet's: its title's line at a glass pane's margin from the top, as its words are from the
   side, and Close (and Back), lined up with the title, as far from the sheet's side as from its top. The head takes the title's type, so 1lh
   is the title's line. A small sheet keeps its head tight in the corner, as a dropdown does. */
:is(.sheet:not(.is-compact, .is-over-sheet), .urgent-card) .pane-head { --head-drop: calc(var(--pad-pane) - var(--pad-frame) - (var(--control-height-small) - 1lh) / 2); margin-top: var(--head-drop); }
.sheet:not(.is-compact, .is-over-sheet) .pane-head { font: var(--type-section); }
/* An urgent notice's head the same way, its title a heading's size. */
.urgent-card .pane-head { font: var(--type-heading); }
:is(.sheet:not(.is-compact, .is-over-sheet), .urgent-card) .pane-head > .pane-head-end { margin-inline-end: var(--head-drop); }
:is(.sheet:not(.is-compact, .is-over-sheet), .urgent-card) .pane-head > .pane-head-start { margin-inline-start: var(--head-drop); }
.sheet.is-compact .sheet-title { font: var(--type-name); }
.sheet.is-anchored.placement-foot::backdrop { background: transparent; }
@media (min-width: 761px) {
  /* A compact sheet is a dropdown's size: narrow, its head, body and the blocks in it closed up to the controls' gap. A confirm opened over
     another sheet is drawn the same size, in the middle of the screen. */
  .sheet:is(.is-compact, [data-sheet-confirm].is-over-sheet) { width: var(--size-sheet-compact); }
  /* A task step of a sheet at the foot (Report, from Players) is centered, as a task sheet is. */
  .sheet.placement-foot.is-task-step:not(.in-place) { margin: auto; }

}
@media (prefers-reduced-motion: reduce) { .sheet-step { animation: none; } }
@media (prefers-reduced-motion: reduce) { .sheet { transition: var(--glass-transition), opacity var(--motion-state), overlay var(--motion-state) allow-discrete, display var(--motion-state) allow-discrete; } .sheet:not(.in-place):is(:not([open]), .is-leaving, .is-arriving), .sheet.is-anchored:not(.in-place):is(:not([open]), .is-leaving, .is-arriving), .sheet.is-anchored.is-above:not(.in-place):is(:not([open]), .is-leaving, .is-arriving) { transform: none; } @starting-style { .sheet.is-anchored:not(.in-place)[open], .sheet.is-anchored.is-above:not(.in-place)[open] { transform: none; } } }
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
      markup: sheet({ id: "example-sheet-compact", title: "Share Ashen Crown", body: stack({ items: [{ kind: "control", markup: copyField({ id: "example-sheet-compact-link", label: "Link", copiedText: "https://zaisma.com/g/ashen-crown" }) }, { kind: "block", markup: listRows({ whenEmpty: html``, isCompact: true, label: "More ways to share", rows: [{ title: "Show QR code", lead: icon("qr-code"), press: {} }, { title: "More ways to share", lead: icon("share"), press: {} }] }) }] }), closeLabel: "Close", isShown: true, isCompact: true }),
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
        steps: [
          {
            stepName: "players",
            title: "Players · 3",
            isCompact: true,
            body: stackOfOne(listRows({
              whenEmpty: emptyState({ title: "Nobody here yet", text: "Players show here as they join your room." }),
              label: "In this room",
              isCompact: true,
              rows: [
                { lead: pictureFrame("Emma", "sm"), title: "Emma", detail: "You" },
                { lead: pictureFrame("Liam", "sm"), title: "Liam", titleIcon: { icon: "friends", label: "Friend" }, action: [toggleButton("Mute Liam", { type: "button", icon: "speaker", pressedIcon: "speaker-off", isLabelHidden: true, isSmall: true, isPressed: false, dataAttributes: { "toggle-example": "" } }), secondaryButton("More for Liam", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, dataAttributes: { "sheet-step-to": "player" } })] },
                { lead: pictureFrame("Sofia", "sm"), title: "Sofia", action: [toggleButton("Mute Sofia", { type: "button", icon: "speaker", pressedIcon: "speaker-off", isLabelHidden: true, isSmall: true, isPressed: true, dataAttributes: { "toggle-example": "" } }), secondaryButton("More for Sofia", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, dataAttributes: { "sheet-step-to": "player" } })] },
              ],
            })),
          },
          {
            stepName: "player",
            title: "Liam",
            isCompact: true,
            body: stackOfOne(listRows({ whenEmpty: html``, isCompact: true, label: "Liam", rows: [{ title: "Profile", lead: icon("person"), href: "#sheet" }, { title: "Block", lead: icon("ban"), press: {} }, { title: "Report", lead: icon("flag"), press: { dataAttributes: { "sheet-step-to": "report" } } }] })),
          },
          { stepName: "report", title: "Report Liam", body: reportBody("example-sheet-steps"), buttons: [primaryButton("Send report", { type: "submit" })] },
        ],
      })}`,
    },
    {
      label: "Try it: a Switch under its title that swaps what's in it (the room's players and your friends playing), at its tallest height",
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

/** What a store panel sells. A page's script fills the parts by their ids ("{panel id}-title", "-item-blurb", "-item-price", "-item-description", "-item-seller", "-item-refunds"). */
export interface StorePanelItem {
  /** The game's own cover, the developer's image with nothing drawn on it (items have no pictures of their own); null shows Zaisma's mark in its place. */
  picture: ShownPicture | null;
  /** The item's name: "Revive". It's the panel's title. */
  name: string;
  /** Its price as the player pays it: "$1.99". */
  priceText: string;
  description?: string;
  /** Who sells it: "Preview Studio". */
  sellerName?: string;
  /** The developer's refund terms, shown on a page; over a game they go in the receipt's email. */
  refundsText?: string;
}

export interface StorePanelOptions {
  /** Unique on the page: the button that opens it names it (secondaryButton's controls). */
  id: string;
  /** What Close says to a screen reader: "Close". */
  closeLabel: string;
  soldItem: StorePanelItem;
  /**
   * Over a running game: short, at the screen's bottom right, the game undimmed and still going, the item at a glance. Left out, it's
   * on a page (a game's own page, or Zaisma's window for a game on its own site): centered over the dimmed page, with the cover large,
   * what it is and the full terms. A page's script swaps it with the placement-corner class.
   */
  isOverGame?: boolean;
  /** What the moment adds under the item: a card form, what went wrong, Bought. */
  momentItems?: LayoutItem[];
  /** Pinned at its foot while what's above it scrolls: Apple Pay or Google Pay, the card row, the line the EU's law asks for, Buy. Who sells it follows them. */
  footItems: LayoutItem[];
  /** Where its form posts when a button sends it. Without one, a button that sends it only closes it. */
  action?: string;
  /** Open in place rather than over the page: the gallery's still copy. */
  isShown?: boolean;
}

const storeCover = (cover: ShownPicture | null, coverSize: "small" | "large") =>
  cover === null
    ? html`<div class="store-cover is-${coverSize} carving holds-art" data-cut-line="0">${CUT_LINE}</div>`
    : html`<div class="store-cover is-${coverSize} carving holds-art" data-cut-line="0">${CUT_LINE}<span class="carving-art" data-cut-line="0">${picture(cover, { shownSizes: coverSize === "small" ? "4rem" : "(max-width: 760px) 100vw, 400px", largestPx: 1440 })}</span></div>`;

/**
 * A store panel: where a player buys. Over a running game (isOverGame) it's short, at the screen's bottom right: the game's cover small
 * beside the item's name and what it is, then the card row and Buy carrying the price, one press; the game keeps going and keeps its
 * middle. On a page it's centered over the dimmed page, the cover large, what it is and the full terms over Buy. Its head, the item and
 * Close, stays put; the moment scrolls under it; the foot stays in view.
 */
export function storePanel(options: StorePanelOptions): Raw {
  const { id, soldItem } = options;
  const words = html`<div class="store-head">${storeCover(soldItem.picture, "small")}<div class="store-head-words"><h2 class="sheet-title" id="${id}-title">${soldItem.name}</h2><p class="store-subline is-blurb" id="${id}-item-blurb">${soldItem.description ?? ""}</p><p class="store-subline is-price" id="${id}-item-price">${soldItem.priceText}</p></div></div>`;
  const itemWords: LayoutItem = { kind: "block", id: `${id}-item-words`, isHidden: options.isOverGame, markup: html`<div class="store-item-words">${storeCover(soldItem.picture, "large")}<p class="store-description" id="${id}-item-description">${soldItem.description ?? ""}</p></div>` };
  const terms = html`<p class="store-terms"><span id="${id}-item-seller">${soldItem.sellerName ? `Sold by ${soldItem.sellerName}.` : ""}</span><span class="store-refunds" id="${id}-item-refunds">${soldItem.refundsText ? ` ${soldItem.refundsText}` : ""}</span></p>`;
  const closeButton = sheetClose(options.closeLabel);
  const parts = paneParts({
    head: { words, end: closeButton },
    body: sheetScroll(stack({ items: [itemWords, ...(options.momentItems ?? [])] })),
    foot: { start: { kind: "block", markup: stack({ items: [...options.footItems, { kind: "words", markup: terms }] }) } },
  });
  return sheetMarkup({ id, title: soldItem.name, body: html``, parts, closeButton, action: options.action, placement: options.isOverGame ? "corner" : "center", isStorePanel: true, isShown: options.isShown });
}

const STORE_ITEM: StorePanelItem = { picture: STAND_IN_COVER_PICTURES["hollow-tide"]!, name: "Revive", priceText: "$1.99", description: "Back with half your health.", sellerName: "Preview Studio", refundsText: "Refunds for items you haven't used yet, within 14 days." };
const STORE_GAME: StorePanelItem = { picture: STAND_IN_COVER_PICTURES["hollow-tide"]!, name: "Hollow Tide", priceText: "$24.99", description: "A drowned city, a lighthouse that won't stay lit, and twelve hours of tide to read.", sellerName: "Preview Studio", refundsText: "Refunds within 14 days if you've played under 2 hours." };
const storeExampleBuy = (id: string, priceText: string, label = "Buy", isBusy = false): LayoutItem => ({ kind: "control", markup: primaryButton(label, { id, type: "button", busyLabel: "Buying", isFullWidth: true, trailingText: priceText, isBusy }) });
const storeExampleCard: LayoutItem = { kind: "control", markup: cardRow("Visa ending 4242", { type: "button", hiddenText: "Use another card", changeText: "Change" }) };

component({
  name: "Store panel",
  slug: "store-panel",
  group: "panes",
  subgroup: "buying",
  summary: "Where a player buys. Over a running game it's short, at the screen's bottom right, and the game keeps going: the game's cover small beside the item's name and what it is, the saved card, and Buy carrying the price, one press, then who sells it; the refund terms go in the receipt's email. On a page (buying a whole game on its page, or in Zaisma's window for a game on its own site) it's centered over the dimmed page, with the cover large, what it is and the full terms. Apple Pay and Google Pay sit over the card when offered. Pressing Buy is the confirmation: only when Zaisma needs to know it's them does Confirm it's you ask first. Bought closes by itself a moment later.",
  styles: `
/* Over a game: at the screen's bottom right, as tall as what's in it, the game undimmed and still going. It slides in from its side; on a
   phone it rises from the foot like the other sheets. */
.sheet.placement-corner:not(.in-place) { inset: auto var(--pad-pane) var(--pad-pane) auto; margin: 0; }
.sheet.placement-corner:is(:not([open]), .is-leaving, .is-arriving) { transform: translateX(40px); }
@starting-style { .sheet.placement-corner[open] { transform: translateX(40px); } }
.sheet.placement-corner::backdrop { background: transparent; }
@media (max-width: 760px) {
  .sheet.placement-corner:not(.in-place) { inset: auto 0 0; margin: 0 var(--gap-control-stack) var(--gap-control-stack); }
  .sheet.placement-corner:is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(40px); }
  @starting-style { .sheet.placement-corner[open] { transform: translateY(40px); } }
}
@media (prefers-reduced-motion: reduce) { .sheet.placement-corner:is(:not([open]), .is-leaving, .is-arriving) { transform: none; } @starting-style { .sheet.placement-corner[open] { transform: none; } } }
/* Either way, a store panel's own width, whatever its words. */
.sheet.store-panel { width: min(var(--size-store-panel), calc(100% - 2 * var(--gap-control-stack))); max-width: none; }
.sheet.store-panel.in-place { width: min(var(--size-store-panel), 100%); }
/* Its head: over a game, the cover small beside the item's name and what it is; on a page, the name and its price, the cover large under them. */
.store-head { display: flex; align-items: flex-start; gap: var(--gap-words-beside-control); min-width: 0; }
.store-head-words { display: flex; flex-direction: column; gap: var(--gap-words-words); min-width: 0; }
.store-head .sheet-title { overflow-wrap: anywhere; text-wrap: balance; }
.store-subline { margin: 0; font: var(--type-note); color: var(--ink-2); }
.store-subline:empty { display: none; }
.store-cover.is-small { flex: none; width: var(--control-height-big); aspect-ratio: 1; }
.store-cover.is-large { display: block; aspect-ratio: 16 / 9; }
.store-item-words { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
.store-description { margin: 0; font: var(--type-reading); color: var(--ink-2); }
.store-description:empty { display: none; }
.store-terms { margin: 0; font: var(--type-note); color: var(--muted); }
/* With nothing of the moment's under its head (over a game, ready), the head sits right on the foot. */
.sheet.store-panel .pane-body:not(:has(> .sheet-scroll > .sheet-body > .layout-stack > .stack-cell:not([hidden]))) { display: none; }
.sheet:not(.placement-corner) :is(.store-cover.is-small, .store-subline.is-blurb),
.sheet.placement-corner :is(.store-subline.is-price, .store-refunds) { display: none; }
/* Over a game, what went wrong is two short lines under the item, read at a glance: no mark, no room around it. */
.sheet.placement-corner .state-note.problem { justify-items: stretch; padding: 0; text-align: start; }
.sheet.placement-corner .state-note.problem > .ico { display: none; }
/* Its words keep the words margin once, from the note's own words box: its lines take none of their own. */
.sheet.placement-corner .state-note.problem > .state-words > p { padding-inline: 0; }
/* On a short screen the large cover is shorter, its art still covering it, so the item's words and Buy have room. */
@media (max-height: 52em) { .sheet:not(.in-place) .store-cover.is-large { max-height: min(9rem, 30dvh); } }
`,
  render: storePanel,
  examples: [
    {
      label: "Try it, over a game: from its button, at the screen's bottom right",
      markup: html`${secondaryButton("Buy Revive", { type: "button", controls: "example-store-panel-try" })}${storePanel({ id: "example-store-panel-try", closeLabel: "Close", isOverGame: true, soldItem: STORE_ITEM, footItems: [storeExampleCard, storeExampleBuy("example-store-panel-try-buy", "$1.99")] })}`,
    },
    {
      label: "Try it, on a page: centered over the dimmed page",
      markup: html`${secondaryButton("Buy Hollow Tide", { type: "button", controls: "example-store-panel-try-page" })}${storePanel({ id: "example-store-panel-try-page", closeLabel: "Close", soldItem: STORE_GAME, footItems: [storeExampleCard, storeExampleBuy("example-store-panel-try-page-buy", "$24.99")] })}`,
    },
    {
      label: "Over a game, ready: the saved card and Buy, one press",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-ready", closeLabel: "Close", isOverGame: true, isShown: true, soldItem: STORE_ITEM, footItems: [storeExampleCard, storeExampleBuy("example-store-panel-ready-buy", "$1.99")] }),
    },
    {
      label: "Over a game, with Apple Pay offered and the line the EU's law asks for above Buy",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-wallet", closeLabel: "Close", isOverGame: true, isShown: true, soldItem: STORE_ITEM, footItems: [{ kind: "control", markup: secondaryButton("Apple Pay", { type: "button", wayIn: "apple_pay", isFullWidth: true }) }, storeExampleCard, { kind: "words", markup: html`<p>You get it now, so you can't cancel it in the next 14 days.</p>` }, storeExampleBuy("example-store-panel-wallet-buy", "$1.99")] }),
    },
    {
      label: "Over a game, buying: Buy pressed, waiting",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-busy", closeLabel: "Close", isOverGame: true, isShown: true, soldItem: STORE_ITEM, footItems: [storeExampleCard, storeExampleBuy("example-store-panel-busy-buy", "$1.99", "Buy", true)] }),
    },
    {
      label: "Over a game, it didn't go through: two short lines on what went wrong, and Try again",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-declined", closeLabel: "Close", isOverGame: true, isShown: true, soldItem: STORE_ITEM, momentItems: [{ kind: "block", markup: problemState({ title: "The payment didn't go through", text: "Your card was declined. Nothing was charged." }) }], footItems: [storeExampleCard, storeExampleBuy("example-store-panel-declined-buy", "$1.99", "Try again")] }),
    },
    {
      label: "Over a game, bought: it's theirs, and it closes by itself a moment later",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-bought", closeLabel: "Close", isOverGame: true, isShown: true, soldItem: { ...STORE_ITEM, sellerName: undefined }, momentItems: [{ kind: "block", markup: doneState({ title: "Bought", text: "Revive is yours. The receipt is on its way to your account's email." }) }], footItems: [{ kind: "control", markup: secondaryButton("Back to the game", { type: "submit", formMethod: "dialog", isFullWidth: true }) }] }),
    },
    {
      label: "On a page, ready: the cover large, what it is and the full terms",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-page", closeLabel: "Close", isShown: true, soldItem: STORE_GAME, footItems: [storeExampleCard, storeExampleBuy("example-store-panel-page-buy", "$24.99")] }),
    },
    {
      label: "On a page, a guest: a way to an account, the price still showing",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-guest", closeLabel: "Close", isShown: true, soldItem: { ...STORE_GAME, sellerName: undefined, refundsText: undefined }, momentItems: [{ kind: "words", markup: html`<p>Make a free account to buy. You come back to this after.</p>` }], footItems: [{ kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: secondaryButton("Sign in", { type: "button" }) }, { kind: "control", markup: primaryButton("Make an account", { type: "button" }) }] }) }] }),
    },
    {
      label: "On a page, no cover yet and a long name",
      isStill: true,
      markup: storePanel({ id: "example-store-panel-none", closeLabel: "Close", isShown: true, soldItem: { ...STORE_GAME, picture: null, name: "The Complete Collector's Edition of the Northern Reach", priceText: "$149.99", description: "Every expansion and the soundtrack." }, footItems: [storeExampleCard, storeExampleBuy("example-store-panel-none-buy", "$149.99")] }),
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

interface UnderHeaderNoticeOptions {
  /** Just under the header, on a page (the default). */
  placement?: "under-header";
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

interface OverGameNoticeOptions {
  /** Over a running game, in its top corner under the bar. */
  placement: "over-game";
  /** Unique on the page: the script shows and hides it by its id. */
  id: string;
  /** What it's about: its heading, and its name for a screen reader. Left out, it's one line of news (role status), like Saved. */
  title?: string;
  /** Its words and buttons, laid out with the layout components. */
  body: LayoutMarkup;
  /**
   * How it waits its turn over the game (zaismaLayers): "information" leaves by itself and waits behind asks, "ask" stays until it's
   * answered. Left out, a card with nothing to press is information and any other an ask.
   */
  noticeUrgency?: "information" | "ask";
  /** Open in place, as the gallery's still copies are; over a game the page's script shows it through zaismaLayers.show, never by itself. */
  isShown?: boolean;
  /** Where it is in the gallery, rather than over the game's corner. */
  isInPlace?: boolean;
}

/** A card of glass over a running game's top corner, for what needs the player now (keep your progress, a game asking them to sign in) or what just happened (Saved). */
function overGameNotice(options: OverGameNoticeOptions): Raw {
  const named = options.title ? html` aria-labelledby="${options.id}-title"` : raw(' role="status"');
  const urgency = options.noticeUrgency ? html` data-notice-urgency="${options.noticeUrgency}"` : "";
  return html`<aside class="playing-card glass${options.isInPlace ? " in-place" : ""}" id="${options.id}"${named}${urgency} data-glass data-glass-corners="pane"${options.isShown ? "" : raw(" hidden")}>${EDGE}<div class="playing-card-in">${options.title ? html`<h2 class="playing-card-title" id="${options.id}-title">${options.title}</h2>` : ""}${options.body}</div></aside>`;
}

interface OverEverythingNoticeOptions {
  /** Over anything, sheets and full screen included: in the corner on a wide screen, across the top on a phone. */
  placement: "over-everything";
  /** Unique on the page: a page's script says it by its id (zaismaLayers.say({ cardId })). */
  id: string;
  /** What happened: "You've been signed out". */
  title: string;
  /** What it means now, in one or two sentences: "Nothing was charged. Sign in again to buy." */
  text: string;
  /** What the player can do about it (Sign in); Close is always there. */
  buttons?: ControlMarkup[];
  /** The sheets that can't go on under it (the buy sheet and its Confirm it's you after a sign-out): they close as it shows. */
  sheetsToClose?: string[];
  /** Where it is in the gallery: shown in place rather than over everything. */
  isInPlace?: boolean;
}

/**
 * An urgent card: news that goes over anything, sheets and full screen included (signed out, the connection lost while paying), as a playing
 * card with an edge in the marked color. It's a popover the queue shows after everything else, so the top layer puts it on top. In the
 * corner on a wide screen, across the top on a phone; it stays until the player closes it or presses what's in it.
 */
function overEverythingNotice(options: OverEverythingNoticeOptions): Raw {
  const close = tertiaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true, dataAttributes: { "layer-close": "" } });
  const buttons = options.buttons?.length ? row({ widths: "equal", items: options.buttons.map((button) => ({ kind: "control" as const, markup: button })) }) : "";
  const sheetsToClose = options.sheetsToClose?.length ? html` data-sheets-to-close="${options.sheetsToClose.join(" ")}"` : "";
  return html`<aside class="playing-card glass urgent-card${options.isInPlace ? " in-place" : ""}" id="${options.id}" role="alert" data-notice-urgency="urgent"${sheetsToClose}${options.isInPlace ? "" : raw(' popover="manual"')} data-glass data-glass-corners="pane">${EDGE}<div class="playing-card-in">${paneParts({ head: { words: html`<h2 class="playing-card-title">${options.title}</h2>`, end: close }, body: html`<p class="urgent-card-text words-margin">${options.text}</p>`, foot: buttons ? { start: { kind: "block", markup: buttons } } : undefined })}</div></aside>`;
}

/** A notice's options: where it shows (under the header, over a running game, or over everything) and what it says. */
export type NoticeOptions = UnderHeaderNoticeOptions | OverGameNoticeOptions | OverEverythingNoticeOptions;

/**
 * A notice: a moment that needs the player or just happened, in a small pane of glass that waits its turn (zaismaLayers). On a page, just
 * under the header ("Saved", "Couldn't save: you're offline"); over a running game, in its top corner, the game running on (keep your
 * progress, a game asking them to sign in); and urgent news over everything, sheets included (signed out while buying).
 */
export function notice(options: NoticeOptions): Raw {
  if (options.placement === "over-game") return overGameNotice(options);
  if (options.placement === "over-everything") return overEverythingNotice(options);
  return underHeaderNotice(options);
}

/** A notice under the header: a moment that just happened, in the header's glass just under the header. */
function underHeaderNotice(options: UnderHeaderNoticeOptions): Raw {
  const isProblem = options.tone === "problem";
  const noticeUrgency = options.noticeUrgency ?? "information";
  const undo = options.undoAction === undefined ? "" : html`<form class="notice-undo" method="post" action="${options.undoAction}">${tertiaryButton("Undo", { type: "submit" })}</form>`;
  return html`<div class="notice glass glass-bar ${options.tone}${options.isInPlace ? " in-place" : ""}" role="${isProblem || noticeUrgency === "urgent" ? "alert" : "status"}" data-notice="${options.tone}" data-notice-urgency="${noticeUrgency}"${undo ? raw(" data-notice-undo") : ""} data-glass data-glass-corners="strip">${EDGE}${icon(isProblem ? "warning" : "check")}<span class="notice-text words-margin beside-controls${undo ? "" : " compact"}">${options.text}${options.link ? html` ${textLink(options.link.words, options.link.href)}` : ""}</span>${undo}${isProblem ? tertiaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true, dataAttributes: { "layer-close": "" } }) : ""}</div>`;
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
  summary: "A moment that needs the player or just happened, in a small pane of glass that waits its turn: under the header on a page (Saved, Copied, or what went wrong), over a running game's top corner with the game running on (keep your progress, a game asking them to sign in), or urgent news over everything, sheets included (signed out while buying). One that's done leaves by itself; a problem or a question stays until it's answered; urgent ones go over anything",
  styles: `
/* A card over the game's top corner, under the bar: glass the game shows through, as wide as a phone allows. What's in it is a pane's content
   (tokens.ts sets its padding and its words' margin, once), so its words keep the pane's margin from the card's edge like any pane's.
   It comes in with a short fade and a rise and leaves with the same, shown or hidden by the page (hidden): display changes at the ends of
   the fade, so it's still there while it leaves. Under reduced motion it only fades. */
.playing-card { position: fixed; z-index: 20; top: calc(var(--control-height-small) + 3 * var(--pad-frame)); right: var(--pad-frame); width: min(360px, calc(100vw - 2 * var(--pad-frame))); margin: 0; color: var(--ink); --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), opacity var(--motion-state) ease, transform var(--motion-arrive) var(--ease-glide), display var(--motion-arrive) allow-discrete; }
.playing-card { transform: translate(var(--swipe-x, 0px), var(--swipe-y, 0px)); opacity: var(--swipe-opacity, 1); }
.playing-card[hidden] { display: none; opacity: 0; transform: translate(var(--swipe-x, 0px), calc(var(--swipe-y, 0px) - 8px)); pointer-events: none; }
@starting-style { .playing-card { opacity: 0; transform: translateY(-8px); } }
/* A card with nothing to press in it (a notification: Saved, a save that didn't go through) goes on a tap or a click, or a swipe sideways
   or up (PLAYING_CARD_SCRIPT): it follows the finger (is-swiping, no transition then) and leaves with the exit above. A card with a button or
   a link in it stays until its own button answers, and the gallery's copy stays where it is. */
.playing-card:not(.in-place):not(:has(a, button, input, select, textarea)) { cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.playing-card.is-swiping { transition: var(--glass-transition); }
.playing-card > :not(.edge) { position: relative; z-index: 1; }
.playing-card.in-place { position: relative; top: auto; right: auto; }
.playing-card-in { display: flex; flex-direction: column; gap: var(--gap-words-control); font: var(--type-words); }
.playing-card-in p { margin: 0; }
.playing-card-title { margin: 0; font: var(--type-heading); }
@media (orientation: landscape) and (max-height: 500px) { .playing-card { top: var(--pad-frame); } }
/* An urgent card: a playing card with its edge in the marked color, a popover over everything (zaismaLayers shows it last). The browser's own
   popover look is put back to the card's; it comes and goes as a card does, kept in the top layer while it leaves. Across the top on a phone. */
.playing-card.urgent-card { inset: auto; top: calc(var(--control-height-small) + 3 * var(--pad-frame)); right: var(--pad-frame); height: auto; padding: 0; border: 0; overflow: visible;
  transition: var(--glass-transition), opacity var(--motion-state) ease, transform var(--motion-arrive) var(--ease-glide), display var(--motion-arrive) allow-discrete, overlay var(--motion-arrive) allow-discrete; }
.playing-card.urgent-card:not(.in-place):not(:popover-open) { opacity: 0; transform: translateY(-8px); }
.urgent-card > .edge :is(.rim, .hair) { stroke: var(--marked); }
.playing-card.urgent-card.in-place { position: relative; inset: auto; }
.urgent-card-text { color: var(--ink); }
@media (max-width: 640px) { .playing-card.urgent-card:not(.in-place) { left: var(--pad-frame); right: var(--pad-frame); width: auto; margin: 0 auto; max-width: 360px; } }
@media (prefers-reduced-motion: reduce) {
  .playing-card { transition: var(--glass-transition), opacity var(--motion-state) ease, display var(--motion-state) allow-discrete; }
  .playing-card, .playing-card[hidden] { transform: none; }
  @starting-style { .playing-card { transform: none; } }
}
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
/* As far from its start as from its top, so it never crowds the edge. */
.notice > .ico { width: 20px; height: 20px; margin-block: calc((var(--notice-line) - 20px) / 2); margin-inline-start: calc((var(--notice-line) - 20px) / 2); }
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
    {
      label: "Keep your progress",
      markup: notice({ placement: "over-game",
        id: "example-keep",
        title: "Keep your progress",
        isShown: true,
        isInPlace: true,
        body: stack({
          items: [
            { kind: "words", markup: html`<p>Your Verdant progress is only saved in this browser. Make a free account to keep it safe and play on any device.</p>` },
            { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Make an account", { href: "#join" }) }, { kind: "control", markup: secondaryButton("Not now", { type: "button" }) }] }) },
            { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", "#signin")}</p>` },
          ],
        }),
      }),
    },
    { label: "Saved", markup: notice({ placement: "over-game", id: "example-saved", isShown: true, isInPlace: true, body: stackOfOne(html`<p>Saved to your account.</p>`, "words") }) },
    { label: "Signed out while buying: urgent, over anything, the sheets it makes useless closed under it", markup: notice({ placement: "over-everything", id: "example-urgent", title: "You've been signed out", text: "Nothing was charged. Sign in again to buy.", buttons: [primaryButton("Sign in", { href: "#signin" })], isInPlace: true }) },
    {
      label: "Try it: Buy finds you signed out (in another tab), so the urgent notice comes over the sheet and closes it",
      markup: html`${secondaryButton("Buy Revive", { type: "button", controls: "example-urgent-sheet" })}${sheet({
        id: "example-urgent-sheet",
        title: "Revive",
        body: stackOfOne(html`<p>Bring your character back with half its health.</p>`, "words"),
        buttons: [primaryButton("Buy", { type: "button", trailingText: "$1.99", dataAttributes: { "layer-show": "example-urgent-over" } })],
        closeLabel: "Close",
        placement: "foot",
      })}${notice({ placement: "over-everything", id: "example-urgent-over", title: "You've been signed out", text: "Nothing was charged. Sign in again to buy.", buttons: [primaryButton("Sign in", { href: "#signin" })], sheetsToClose: ["example-urgent-sheet"] })}`,
    },
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
  return html`<div class="banner glass" data-glass data-glass-corners="strip">${EDGE}${formAction === undefined ? html`<div class="${holder}">${inside}</div>` : html`<form class="${holder}" method="post" action="${formAction}">${inside}</form>`}</div>`;
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
.banner-words { display: flex; align-items: flex-start; gap: var(--pad-inside-words); min-width: 0; font: var(--type-words); }
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
      markup: html`<div class="backdrop-frame holds-menus">${backdrop({ isFramed: true, standInSlug: "neon-drift", isGlassAdaptive: true })}<div class="banner-frame">${banner({ text: "Season 3 of Neon Drift starts Friday: new districts, and the leaderboards start over.", icon: "megaphone", action: { label: "See what's new", href: "#banner" }, closeLabel: "Close" })}</div></div>`,
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
  const bodies = options.steps.map((step, stepIndex) => html`<div class="step-body${stepIndex === options.currentIndex ? "" : " is-away"}">${step.body ?? ""}</div>`);
  const buttons = row({ widths: "equal", items: [control(secondaryButton("Back", { type: "button", isHidden: options.currentIndex === 0 })), control(primaryButton(nextLabel, { type: "submit" }))] });
  return glassPane({ paneWidth, body: stack({ items: [{ kind: "block", markup: stepLine }, { kind: "block", markup: html`<form class="step-form" method="post" action="${options.action}" data-steps="${options.currentIndex}" data-finish-label="${finishLabel}"><div class="step-bodies">${bodies}</div>${buttons}</form>` }] }) });
}

/**
 * Step flows with every step on the page: Next checks the step's fields, then moves on, the step line filling to the next step; Back goes
 * back; on the last step Next sends the form. form.goToStep(index) moves to any step (the gallery starts its example over with it).
 */
export const STEP_FLOW_SCRIPT = `/* step flows */(function () {
  var LEAVE_MS = 450;
  window.zaismaWatch.each("form[data-steps]", function (form) {
    var bodies = Array.prototype.slice.call(form.querySelectorAll(":scope > .step-bodies > .step-body")), marks = Array.prototype.slice.call(form.closest(".pane-in").querySelectorAll(".step-line > li"));
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
      bodies.forEach(function (body, i) { body.classList.toggle("is-away", i !== at); });
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
/* Every step is laid out in the same place, only the one you're on shown, so the tallest and widest sets the pane's size from the start and
   Back and Next stay put from step to step; a shorter step keeps to the top. */
.step-bodies { display: grid; }
.step-body { grid-area: 1 / 1; display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* A step you're not on keeps its place, unseen, and nothing in it can be reached. */
.step-body.is-away { visibility: hidden; }
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
