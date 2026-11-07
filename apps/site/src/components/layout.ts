import { Raw, html, raw, type EmptyNoteMarkup } from "../markup.ts";
import { CONTROL_HEIGHTS, ControlMarkup, type ControlHeight } from "./control-markup.ts";
import { BARE_GROUPS, HEADER_RAIL_MEDIA, SCREEN_QUERIES, WORDS_HOLDERS } from "./tokens.ts";

/*
 * Layout: how a page puts components together, as components like any other (docs/DECISIONS.md, "A page is only gallery components,
 * layout included"). A stack puts things one under another, a row side by side, a grid in cells of one size, a track in a row that
 * scrolls sideways, columns two halves of the width side by side, and pane parts a pane's head, body and foot. Each picks its own
 * spacing from what's on each side (the spacing table, docs/DESIGN.md), so nobody passes a gap; widths and sizes are named, never numbers;
 * and each goes by the room it's given (container queries), never the window's, so it holds the same wherever it's put. The gallery
 * shows them in layout-gallery.ts, and Screens (screens.ts) shows any page on a phone and a desktop, measured.
 */

export type { ControlMarkup } from "./control-markup.ts";

/**
 * A layout's markup: what a pane's body takes (a glass pane, a tray, a sheet, a store panel, a playing card), made only by the layouts
 * here, so everything in a pane is placed by a layout and every word in it keeps the pane's margin. design.test.ts checks no other file
 * makes one.
 */

export class LayoutMarkup extends Raw {
  /** Makes it a type of its own: plain markup isn't a layout. */
  private declare readonly isLayoutMarkup: true;
}
const asLayout = (markup: Raw): LayoutMarkup => new LayoutMarkup(markup.html);

/** One control, for a pane's corner: exactly one, by its type. */
export type LayoutControl = ControlMarkup;

interface LayoutItemPlace {
  /** Unique on the page, for a page script to find it. */
  id?: string;
  /** Not shown for now: a page script shows it (the home's Continue playing). It takes no room while it's hidden. */
  isHidden?: boolean;
}

/** Markup that isn't a control: a control has to be given as one (kind "control"), so it's spaced and sized as a control. */
type NotControlMarkup = Raw & { readonly controlHeight?: never };

/**
 * What a layout holds, each said for what it is, since the spacing and margins come from it:
 * - words: a heading, a line, a paragraph to read, a link in words. They keep the pane's margin.
 * - control: one control, from a control's own function (a button, a field, a switch). It sits at the frame gap; a control that shows
 *   words of its own (a field's label) is spaced as a block.
 * - block: anything with an edge of its own or a group (a banner, a table, a cover, a row, another stack). It sits at the frame gap.
 */
export type LayoutItem =
  | (LayoutItemPlace & { kind: "words"; markup: NotControlMarkup })
  | (LayoutItemPlace & { kind: "control"; markup: ControlMarkup })
  | (LayoutItemPlace & { kind: "block"; markup: NotControlMarkup });

/** Where an item sits, for its margins: words (and a control that's words alone, a tertiary button) keep the pane's; the rest the frame gap. */
const placedKind = (layoutItem: LayoutItem): "words" | "control" | "block" => (layoutItem.kind === "control" && layoutItem.markup.isWordsAlone ? "words" : layoutItem.kind);

/** The spacing tokens a layout picks from (docs/DESIGN.md, Spacing), by what's on each side. */
type LayoutGap = "control-row-boxes" | "control-stack" | "words-control" | "words-words" | "block-block";

/** What an item is to the spacing table: a control with words of its own is a block. */
const spacedKind = (layoutItem: LayoutItem): "words" | "control" | "block" => (layoutItem.kind === "control" && layoutItem.markup.hasOwnWords ? "block" : layoutItem.kind);

/** A block that's a row of controls and nothing else (row() marks its controls' height). */
const isControlRow = (layoutItem: LayoutItem): boolean => layoutItem.kind === "block" && /^<div class="layout-row[^"]*"[^>]*? data-control-height=/.test(layoutItem.markup.html);

/** The gap between two things one under the other. */
function stackGap(above: LayoutItem, below: LayoutItem): LayoutGap {
  const kinds = [spacedKind(above), spacedKind(below)];
  // A control over a row of controls (Play over Details, Share and Report), or under one: still controls stacked.
  if ((kinds[0] === "control" && isControlRow(below)) || (kinds[1] === "control" && isControlRow(above))) return "control-stack";
  if (kinds.includes("block")) return "block-block";
  // A heading starts a new group: a block's gap above it, so it sits nearer what it names than the words before it.
  if (below.kind === "words" && /^<h[1-6][\s>]/.test(below.markup.html)) return "block-block";
  if (kinds[0] === "words" && kinds[1] === "words") return "words-words";
  if (kinds[0] === "control" && kinds[1] === "control") return "control-stack";
  return "words-control";
}

/** The gap between two things side by side: two controls slant toward each other, their boxes overlapping (the edge rule's neighbor distance). */
function rowGap(before: LayoutItem, after: LayoutItem): LayoutGap {
  const kinds = [placedKind(before), placedKind(after)];
  if (kinds.includes("block")) return "block-block";
  if (kinds[0] === "control" && kinds[1] === "control") return "control-row-boxes";
  if (kinds[0] === "words" && kinds[1] === "words") return before.kind === after.kind ? "words-words" : "words-control";
  return "words-control";
}

const placeAttributes = (layoutItem: LayoutItemPlace): Raw => html`${layoutItem.id ? html` id="${layoutItem.id}"` : ""}${layoutItem.isHidden ? raw(" hidden") : ""}`;
const groupLabel = (label: string | undefined): Raw => (label ? html` role="group" aria-label="${label}"` : raw(""));

export interface StackOptions {
  /** Top to bottom. */
  items: LayoutItem[];
  /** What the group is, for a screen reader, when it's one thing to them. */
  label?: string;
  /** data-* attributes a page's script reads ({ count: "2" } is data-count="2"), names in lowercase words joined by dashes. */
  dataAttributes?: Record<string, string>;
}

/**
 * A stack of one thing, for a pane's body that holds only it: a block (a list, a table, a form) at the frame gap, words (reading text, a
 * person, a paragraph) at the pane's words margin, or a control as a control.
 */
export function stackOfOne(markup: Raw, itemKind: "words" | "block" = "block"): LayoutMarkup {
  return stack({ items: [markup instanceof ControlMarkup ? { kind: "control", markup } : { kind: itemKind, markup: markup as NotControlMarkup }] });
}

/**
 * Things one under another, each gap picked from what's on each side of it. In a pane, controls fill its width. Nothing empty takes a gap:
 * a part with no markup is left out (one with an id stays, for a page script to fill), and an empty cell takes no room (STACK_STYLES).
 */
export function stack(options: StackOptions): LayoutMarkup {
  const dataMarkup = options.dataAttributes ? html`${Object.entries(options.dataAttributes).map(([name, text]) => html` data-${name}="${text}"`)}` : "";
  const items = options.items.filter((layoutItem) => layoutItem.id || layoutItem.markup.html.trim());
  return asLayout(html`<div class="layout-stack"${groupLabel(options.label)}${dataMarkup}>${items.map((layoutItem, itemIndex) => {
    const above = items[itemIndex - 1];
    return html`<div class="stack-cell is-${placedKind(layoutItem)}${above ? ` gap-top-${stackGap(above, layoutItem)}` : ""}"${placeAttributes(layoutItem)}>${layoutItem.markup}</div>`;
  })}</div>`);
}

export type RowOptions = {
  /** Start to end. */
  items: LayoutItem[];
  label?: string;
} & (
  /**
   * How the row shares its width: "equal" in equal shares (Light and Dark), "lead-fills" the first takes the rest and the others fit
   * their words (Play and Details), "fit" each fits its words, placed by alignment. A row that can't fit on one line goes on to the next.
   */
  | { widths: "equal" | "lead-fills" }
  /** Where fitting things sit: at the start, the end, the middle, or spread to both ends. Only "fit" has room left to place them in. */
  | { widths: "fit"; alignment?: "start" | "end" | "center" | "between" }
);

/**
 * Things side by side. Controls in a row are always one height: every one takes the tallest one's size class. Two controls side by
 * side slant toward each other; words beside controls sit on their center line, and on a field's box when a field shows its label.
 */
export function row(options: RowOptions): LayoutMarkup {
  const controls = options.items.flatMap((layoutItem) => (layoutItem.kind === "control" ? [layoutItem.markup] : []));
  // A block that's a row of controls itself (a shelf's sort) counts its controls' height too, so words beside it sit on their
  // center line.
  const nestedHeights = options.items.flatMap((layoutItem) => {
    const found = layoutItem.kind === "block" ? /^<div class="layout-row[^"]*"[^>]*? data-control-height="([a-z]+)"/.exec(layoutItem.markup.html) : null;
    return found ? [found[1] as ControlHeight] : [];
  });
  const tallest = [...controls.map((control) => control.controlHeight), ...nestedHeights].reduce<ControlHeight | null>((found, height) => (found === null || CONTROL_HEIGHTS.indexOf(height) > CONTROL_HEIGHTS.indexOf(found) ? height : found), null);
  const isOnFieldBoxes = controls.some((control) => control.hasOwnWords);
  const alignment = options.widths === "fit" ? (options.alignment ?? "start") : "start";
  const cells = options.items.map((layoutItem, itemIndex) => {
    const after = options.items[itemIndex + 1];
    // The last cell reaches past the row's end as far as a control reaches over the next, and the row stops that far short of its own end
    // (ROW_STYLES), so a control ends at the row's end whether its line wraps there or not.
    const endGap = after ? rowGap(layoutItem, after) : "control-row-boxes";
    const isFilling = options.widths === "equal" || (options.widths === "lead-fills" && itemIndex === 0);
    return html`<div class="row-cell is-${placedKind(layoutItem)}${isFilling ? " fills" : ""} gap-end-${endGap}"${placeAttributes(layoutItem)}>${layoutItem.markup}</div>`;
  });
  // An equal row is marked for ROW_LAYOUT_SCRIPT, which gives its cells the widest one's width.
  return asLayout(html`<div class="layout-row${options.widths === "equal" ? " widths-equal" : ""} alignment-${alignment}${isOnFieldBoxes ? " is-on-field-boxes" : ""}"${tallest ? html` data-control-height="${tallest}"` : ""}${groupLabel(options.label)}>${cells}</div>`);
}

/**
 * Rows, as they're laid out (window.zaismaWatch, glass-script.ts): an equal row's cells each take its widest one's width, wherever it is (a
 * row in a pane that fits what's in it shares no spare room, so its widest cell would otherwise keep more than the rest); and a row that
 * can't fit on one line becomes a stack of its controls, each filling its own line as controls do in a pane (is-wrapped), so none is left
 * short at a line's start. Each row is laid out as it would be first (is-measuring), then set.
 */
export const ROW_LAYOUT_SCRIPT = `/* row layout */(function () {
  if (!window.zaismaWatch) return;
  var laidSizes = new WeakMap();
  function sizeOf(row) { return row.offsetWidth + "x" + row.offsetHeight; }
  function lay(row) {
    var cells = Array.prototype.slice.call(row.children);
    // From the same start every time: measured as the last pass left it, a row could wrap on one pass and unwrap on the next, and every
    // flip resizes what's round it and sets the next one off.
    row.classList.remove("is-wrapped");
    row.classList.add("is-measuring");
    var widestPx = 0;
    // Measured as it's laid out, not as it's drawn: in a sheet still growing in as it opens, it's drawn smaller than it lays out.
    var drawnScale = row.offsetWidth ? row.getBoundingClientRect().width / row.offsetWidth : 1;
    if (row.classList.contains("widths-equal")) cells.forEach(function (cell) { if (cell.classList.contains("fills")) widestPx = Math.max(widestPx, cell.getBoundingClientRect().width / (drawnScale || 1)); });
    row.classList.remove("is-measuring");
    var equalWidth = widestPx ? Math.ceil(widestPx) + "px" : "";
    if (row.style.getPropertyValue("--equal-cell-width") !== equalWidth) row.style.setProperty("--equal-cell-width", equalWidth);
    var isRtl = getComputedStyle(row).direction === "rtl", previousStart = null, isWrapped = false;
    cells.forEach(function (cell) {
      var box = cell.getBoundingClientRect();
      if (box.width < 1) return;
      var start = isRtl ? -box.right : box.left;
      if (previousStart !== null && start <= previousStart + 0.5) isWrapped = true;
      previousStart = start;
    });
    if (isWrapped) row.classList.add("is-wrapped");
    laidSizes.set(row, sizeOf(row));
  }
  window.zaismaWatch.each(".layout-row", function (row) {
    lay(row);
    // Only for a size this row wasn't laid out at: the height its own wrapping gave it is no reason to lay it out again.
    window.zaismaWatch.size(row, function () { if (laidSizes.get(row) !== sizeOf(row)) lay(row); });
  });
  window.zaismaWatch.fontArrived(function () { document.querySelectorAll(".layout-row").forEach(lay); });
  // A cell whose only thing is hidden is marked so (holds-only-hidden), for SHOWN to pass it over by its class: a :has() inside
  // :nth-child(1 of …) makes WebKit check the whole page again on every hidden that changes anywhere, 75 ms each on a page of fields.
  var CELLS = ".stack-cell, .row-cell";
  function mark(cell) {
    var isOnlyHidden = cell.children.length === 1 && cell.firstElementChild.hidden;
    if (cell.classList.contains("holds-only-hidden") !== isOnlyHidden) cell.classList.toggle("holds-only-hidden", isOnlyHidden);
  }
  window.zaismaWatch.each(CELLS, mark);
  window.zaismaWatch.page(function (changes) {
    changes.forEach(function (change) {
      var cell = change.type === "attributes" ? change.target.parentElement : change.target;
      if (cell && cell.matches && cell.matches(CELLS) && (change.type !== "attributes" || change.attributeName === "hidden")) mark(cell);
    });
  });
})();
`;

/** A grid's cell: a block or words, never a bare control, since controls side by side are a row (row()). */
export type GridItem = Exclude<LayoutItem, { kind: "control" }>;

export type GridOptions = {
  items: GridItem[];
  label?: string;
  /** Unique on the page, for Load more to add the next page's cells to it (navigation.ts, loadMore's listIds). */
  id?: string;
} & (
  /**
   * What a cell holds, which names its least width: a cover or a card. Cells share the width equally, as many as fit, never under
   * that width. isAllOnOneLine puts up to six covers on one line, as one thing to take in at a glance (the home's first screen), going to
   * three, two and then one across as they run out of a cover's least width. isAtLeastTwoAcross stops at two, however small the covers get (the
   * home's What's on on a phone). isLeadWideAtTwoAcross gives the first cell the whole line wherever it's two across, so three cells never leave one alone.
   */
  | { itemSize: "cover"; whenEmpty: EmptyNoteMarkup; isAllOnOneLine?: boolean; isAtLeastTwoAcross?: boolean; isLeadWideAtTwoAcross?: boolean }
  | { itemSize: "card"; whenEmpty: EmptyNoteMarkup }
);

/** The most covers one line takes before each is too small to read as a cover on a laptop. */
export const MAXIMUM_ONE_LINE_COVER_COUNT = 6;
/**
 * --size-cover, for the container queries, which can't read a token: below six of these on one line it's three across, below three, two, below
 * two, one. In rem, as the token is, so a cover's least width grows with its words when the browser's text is set larger, and a line folds to
 * fewer across instead of cutting its titles.
 */
const COVER_LEAST_REM = 11.25;
/** --gap-control-stack, the gap between covers on one line, for the same queries: in px, as gaps don't grow with the text. */
const CONTROL_STACK_GAP_PX = 8;
/** The widest a line of covers is while it can't hold this many of their least width and the gaps between them. */
const coversShortOf = (coverCount: number): string => `calc(${coverCount * COVER_LEAST_REM}rem + ${(coverCount - 1) * CONTROL_STACK_GAP_PX - 1}px)`;

/**
 * Cells of one size, as many to a line as fit their least width, folding to one column where two can't fit. A grid of
 * covers or cards says what shows in its place while it has none (whenEmpty, an Empty state), a page script's cells included.
 */
export function grid(options: GridOptions): LayoutMarkup {
  if (options.itemSize === "cover" && options.isAllOnOneLine) {
    if (options.items.length > MAXIMUM_ONE_LINE_COVER_COUNT) throw new Error(`One line holds ${MAXIMUM_ONE_LINE_COVER_COUNT} covers at most, not ${options.items.length}: a longer list is a grid or a track.`);
    return asLayout(html`<div class="grid-one-line">${gridMarkup(options, ` is-one-line${options.isAtLeastTwoAcross ? " is-at-least-two-across" : ""}${options.isLeadWideAtTwoAcross ? " is-lead-wide" : ""}`)}</div>`);
  }
  return asLayout(gridMarkup(options, ""));
}

function gridMarkup(options: GridOptions, variantClass: string): Raw {
  return html`<div class="layout-grid item-${options.itemSize}${variantClass}"${options.id ? html` id="${options.id}"` : ""}${groupLabel(options.label)}>${options.items.map((layoutItem) => html`<div class="grid-cell is-${layoutItem.kind}"${placeAttributes(layoutItem)}>${layoutItem.markup}</div>`)}</div>${options.whenEmpty ? html`<div class="when-empty"${options.items.some((layoutItem) => !layoutItem.isHidden) ? raw(" hidden") : ""}>${options.whenEmpty}</div>` : ""}`;
}

export interface LeadAndSideOptions {
  lead: LayoutItem;
  side: LayoutItem;
}

/**
 * The thing a page is about and what goes beside it: the lead two thirds of the width and the side a third; half and half with less room; one under
 * the other with less still. A one-line grid in the side stacks while the side is a third, so its covers stay whole and line up with the lead.
 */
export function leadAndSide(options: LeadAndSideOptions): LayoutMarkup {
  return asLayout(html`<div class="lead-and-side"><div class="lead-and-side-in"><div class="lead-and-side-lead">${options.lead.markup}</div><div class="lead-and-side-side">${options.side.markup}</div></div></div>`);
}

export interface TrackOptions {
  /** Unique on the page: a page script fills it in. */
  id: string;
  /** Start to end: blocks, each one cell. A page script may add more of the same. */
  items: LayoutItem[];
  /**
   * What a cell holds, which names its width: a cover, with words under it; a picture with an edge of its own and none (a game's
   * screenshots); or a thumbnail, a small picture under a large one (the rest of a game's screenshots, under its first).
   */
  itemSize: "cover" | "picture" | "thumbnail";
  label?: string;
  /** What shows in its place while it has no covers (an Empty state), a page script's included. */
  whenEmpty: EmptyNoteMarkup;
}

/** A row of cells of one size that scrolls sideways, fading at an edge with more past it: a row of covers, on its rail. */
export function track(options: TrackOptions): LayoutMarkup {
  return asLayout(html`<div class="track-holder"><div class="layout-track item-${options.itemSize}" id="${options.id}" data-fades-sideways data-side-rail${groupLabel(options.label)}>${options.items.map((layoutItem) => layoutItem.markup)}</div><div class="when-empty"${options.items.length ? raw(" hidden") : ""}>${options.whenEmpty}</div></div>`);
}

export interface ColumnsOptions {
  /** Start to end: what each half holds (a pane, or a stack of them), never a bare control: controls side by side are a row (row()). */
  columns: [NotControlMarkup, NotControlMarkup];
  /** The column that stays in view under the header while the other scrolls: a game's details. */
  stickyColumn?: "first" | "second";
  /** Even: half each. Wide first: the first gets three fifths (a game's pictures beside its name and Play). */
  split?: "even" | "wide-first";
  /**
   * On a screen that's wide but short (a phone turned sideways), the two stay side by side down to a narrower least, so what the
   * second holds (Play) isn't pushed below the screen by the first.
   */
  isSideBySideWhenShort?: boolean;
  /** One over the other, the second comes first (a game's Rooms tab: the room code before the order and the options, on an upright phone). */
  isSecondFirstWhenStacked?: boolean;
}

/** The least a column gets before the two go one over the other: a little more than a phone's width, so what's made for one fits. */
export const COLUMN_LEAST_PX = 360;
/** On a phone on its side (SCREEN_QUERIES.phoneSideways), side-by-side columns each get at least this much. */
export const SHORT_COLUMN_LEAST_PX = 240;
/** --gap-block-block, for the container query, which can't read a token. */
const BLOCK_GAP_PX = 24;

/**
 * Two halves of the width side by side, one over the other where both can't have a column's least width. A pane takes the whole width or
 * fits what's in it; one that should take half the screen goes in a column here.
 */
export function columns(options: ColumnsOptions): LayoutMarkup {
  const kinds = [options.stickyColumn ? `sticky-${options.stickyColumn}` : "", options.split === "wide-first" ? "wide-first" : "", options.isSideBySideWhenShort ? "side-by-side-when-short" : "", options.isSecondFirstWhenStacked ? "second-first-when-stacked" : ""].filter(Boolean).join(" ");
  return asLayout(html`<div class="layout-columns${kinds ? ` ${kinds}` : ""}"><div class="columns-in">${options.columns.map((column) => html`<div class="column">${column}</div>`)}</div></div>`);
}

export interface PanePartsOptions {
  /**
   * The pane's head: its words (a heading, a line under it), at most one control in its top end corner (Close), and at most one in its top
   * start corner (a sheet's Back), its twin.
   */
  head?: { start?: LayoutControl; words: Raw; end?: LayoutControl };
  body: Raw;
  /** The pane's foot: something at its start, and at most one control in its bottom end corner. */
  foot?: { start?: LayoutItem; end?: LayoutControl };
}

/**
 * A pane's places: its head, its body and its foot. The head's words keep the pane's margin; a control in a corner sits in it, at the
 * frame gap, and takes the corner's cut by the edge rule.
 */
export function paneParts(options: PanePartsOptions): LayoutMarkup {
  const head = options.head
    ? html`<div class="pane-head"${options.head.end && !options.head.end.isWordsAlone ? html` data-control-height="${options.head.end.controlHeight}"` : ""}>${options.head.start ? html`<div class="pane-head-start">${options.head.start}</div>` : ""}<div class="pane-head-words">${options.head.words}</div>${options.head.end ? html`<div class="pane-head-end${options.head.end.isWordsAlone ? " is-words" : ""}">${options.head.end}</div>` : ""}</div>`
    : "";
  const foot = options.foot
    ? html`<div class="pane-foot"${options.foot.end && !options.foot.end.isWordsAlone ? html` data-control-height="${options.foot.end.controlHeight}"` : ""}>${options.foot.start ? html`<div class="pane-foot-start is-${options.foot.start.kind}">${options.foot.start.markup}</div>` : ""}${options.foot.end ? html`<div class="pane-foot-end${options.foot.end.isWordsAlone ? " is-words" : ""}">${options.foot.end}</div>` : ""}</div>`
    : "";
  return asLayout(html`<div class="pane-parts">${head}<div class="pane-body">${options.body}</div>${foot}</div>`);
}

/**
 * The one place for a control in a carving (a field, a search, a well): at its end, the carving's frame gap from its edges, so the edge rule
 * cuts its corner along the carving's. Exactly one control, by its type; note is what shows over it for a moment (Copied).
 */
export function carvingEnd(control: LayoutControl, note?: Raw): Raw {
  return html`<span class="carving-end">${control}${note ?? ""}</span>`;
}

/* ---- Styles: each layout component's own, in gallery order. ---- */

const GAP_TOKENS: LayoutGap[] = ["control-row-boxes", "control-stack", "words-control", "words-words", "block-block"];

/** What takes a control's height in each control (its --control-height), as it sits directly in a row's cell. */
const HEIGHT_HOLDERS = [".cut-btn", ".tertiary-btn", ".run-wrap > .run", ".cut-field > .field", ".pin-marks", ".find", ".switch-well", ".tab-switch"];

/** What shows of a holder's children: not hidden, not a cell whose only thing is hidden (holds-only-hidden, ROW_LAYOUT_SCRIPT), not a slab's drawn edge (a tray's first child), and not a script, a template or a form's hidden field. */
const SHOWN = ':not([hidden], .holds-only-hidden, .edge, script, template, input[type="hidden"])';

/**
 * Components whose own words sit at their top (a field's label, a table's caption) or their foot (a field's hint), as [the component,
 * its words, or nothing when its words are all of it]: at a pane's edge, those words keep its margin.
 */
/**
 * Bare groups (tokens.ts's BARE_GROUPS) take the margin as a whole unit at a surface's top and foot edge: the unit itself, or the grid or
 * track holding units (which tokens.ts insets at its sides). The unit is padded, never its words.
 */
const BARE_UNITS: [string, string][] = [...BARE_GROUPS.map((group): [string, string] => [group, ""]), [`:is(.layout-grid, .layout-track):has(> :is(${BARE_GROUPS.join(", ")}), > .grid-cell > :is(${BARE_GROUPS.join(", ")}))`, ""]];
const WORDS_AT_TOP: [string, string][] = [[":is(.cut-field, .link-field, .pin-field, .wheel-field, .choices, .slider, .table, .usage, .chart)", ":first-child"], [".toggle", ".toggle-words"], [".check", ""], [".progress", ".progress-words"], [".folded", ".folded-head"], [".key-details", ""], [".reading", ":is(ul, ol):first-child"], ...BARE_UNITS];
const WORDS_AT_FOOT: [string, string][] = [[":is(.cut-field, .pin-field)", "p:last-child"], [".qr-code", ".qr-caption"], [".file-drop-wrap", ".field-error"], [".toggle", ".toggle-words"], [".check", ""], [".folded:not([open])", ".folded-head"], [".key-details", ""], [".reading", ":is(ul, ol):last-child"], ...BARE_UNITS];

/**
 * The words at a pane's or a tray's top and bottom edge keep its margin there too: the first and last words it holds, however deep in
 * the first and last of what it holds (a form, a stack, a shelf), a row's words there, and a component's own words there.
 */
function edgeWords(edge: "top" | "bottom"): string[] {
  const end = edge === "top" ? `:nth-child(1 of ${SHOWN})` : `:nth-last-child(1 of ${SHOWN})`;
  const endHere = end;
  const own = edge === "top" ? WORDS_AT_TOP : WORDS_AT_FOOT;
  const selectorsOf = (depthCount: number) => {
    // Never into words beside a control: they sit on its center line instead. Never into a grid's or a track's first cell alone: the
    // others on its first line are at the edge too, so the grid or track takes the margin as a whole (BARE_UNITS).
    // Never into a game card either: it's one piece with its own line, not words or rows at the pane's edge.
    const into = ` > *${endHere}${BESIDE_CONTROLS}:not(.layout-grid, .layout-track, .cover)`.repeat(depthCount) + " > ";
    return [
      // A row's words are its own case, below.
      `${into}.is-words${end}:not(.row-cell)`,
      `${into}:is(h1, h2, h3, p)${end}`,
      // A row at the edge: every cell of it is at the edge. Words beside a control sit on its center line instead (ROW_STYLES), unless the
      // row went onto more lines, when its words are on a line of their own at the top.
      `${into}.layout-row:is(${edge === "top" ? ":not([data-control-height]), .is-wrapped" : ":not([data-control-height])"})${end} > .row-cell.is-words`,
      // A component whose words are its whole (Numbers) takes the margin itself.
      ...own.flatMap(([component, words]) => (words ? [`${into}${component}${end} > ${words}`, `${into}.layout-row${end} > .row-cell > ${component} > ${words}`] : [`${into}${component}${end}`])),
    ];
  };
  return PANE_CONTENT.filter((pane) => pane.edges.includes(edge))
    .flatMap((pane) => Array.from({ length: pane.depthCount }, (_, depthCount) => selectorsOf(depthCount).map((selector) => `${pane.holder}${selector}`).join(",\n")));
}

/**
 * One rule per list of selectors: Chrome reads at most 8,192 simple selectors in one rule and silently drops the rest (Blink's RuleData
 * keeps a selector's place in 13 bits), so a long generated list is split into rules of its own (test/site/design.test.ts holds the limit).
 */
const rulesOf = (selectorLists: string[], declarations: string) => selectorLists.map((selectors) => `${selectors} { ${declarations} }`).join("\n");

/** What places its own words: a row with controls on one line and a pane's foot with a corner control (on the control's center line), and a pane's head. */
const BESIDE_CONTROLS = ":not(.layout-row[data-control-height]:not(.is-wrapped), .pane-head, .pane-foot[data-control-height])";

/**
 * What holds a surface's content (tokens.ts's WORDS_HOLDERS), the edges its words and rows measure from, and how deep in the first and last of
 * what it holds the edge rules look. A sheet's body, with no buttons under it, is where its words end.
 */
const PANE_CONTENT: { holder: string; depthCount: number; edges: ("top" | "bottom")[]; isForRows: boolean }[] = [
  // A pane's body is always a layout (LayoutMarkup), so what it holds starts two levels in: its stack and the stack's cell.
  ...WORDS_HOLDERS.map((holder) => ({ holder, depthCount: holder === ".playing-card-in" ? 4 : 7, edges: ["top", "bottom"] as ("top" | "bottom")[], isForRows: true })),
  { holder: ".pane-parts:not(:has(> .pane-foot)) > .pane-body > .sheet-scroll > .sheet-body", depthCount: 3, edges: ["bottom"], isForRows: false },
];

/** The rows at a pane's top or bottom edge, however deep in the first or last of what it holds. */
function edgeRows(edge: "top" | "bottom"): string[] {
  const end = edge === "top" ? `:nth-child(1 of ${SHOWN})` : `:nth-last-child(1 of ${SHOWN})`;
  // A row on a field's boxes keeps to them.
  return PANE_CONTENT.filter((pane) => pane.isForRows && pane.edges.includes(edge))
    .map((pane) => Array.from({ length: pane.depthCount }, (_, depthCount) => `${pane.holder}${` > *${end}:not(.cover)`.repeat(depthCount)} > .layout-row:not(.is-on-field-boxes)${end}`).join(",\n"));
}

/** Wider than this, lead and side stand side by side (equal halves, then two thirds and one third from 800px). */
const LEAD_AND_SIDE_SIDE_BY_SIDE_PX = 440;

export const STACK_STYLES = `
/* A stack: one under another, each cell's gap above it picked by what's on each side (stack(), from the spacing table). A hidden cell takes no
   room, and the first shown has nothing above it. Everything in a stack is one width, the stack's, as everything in a row is one height. */
.layout-stack { display: flex; flex-direction: column; min-width: 0; }
.stack-cell { display: flex; flex-direction: column; min-width: 0; }
/* In a compact sheet (or a confirm over a sheet) everything is a control's stack gap apart, whatever the spacing table says. */
.sheet:is(.is-compact, [data-sheet-confirm].is-over-sheet) .layout-stack > .stack-cell[class*="gap-top-"] { margin-top: var(--gap-control-stack); }
${GAP_TOKENS.filter((gap) => gap !== "control-row-boxes").map((gap) => `.layout-stack > .stack-cell.gap-top-${gap} { margin-top: var(--gap-${gap}); }`).join("\n")}
/* What's first to show has nothing above it to keep a gap from, whatever is hidden before it. */
.layout-stack.layout-stack.layout-stack > .stack-cell:not([hidden]):not(:not([hidden]) ~ *) { margin-top: 0; }
.layout-stack > .stack-cell:nth-child(1 of :not([hidden], .holds-only-hidden, :empty)) { margin-top: 0; }
/* A cell with nothing in it yet, or whose only thing is hidden (a page script shows it: a step, an error), takes no room. */
.stack-cell:is(:empty, :has(> [hidden]:only-child)) { display: none; }
/* Words keep the pane's margin: in from the frame gap by --pad-words (a pane sets it), at its sides, and at its top and bottom edges. */
.stack-cell.is-words { padding-inline: var(--pad-words); }
/* Inside words that already keep the margin, nothing takes it again. */
:is(.stack-cell, .row-cell, .grid-cell, .pane-foot-start).is-words > *, .pane-head-words > * { --pad-words: 0px; }
/* A word longer than its cell (a link, a name with no spaces) breaks rather than spill past its holder, at 320px or 200% text. */
:is(.stack-cell, .row-cell, .grid-cell, .columns-in > .column, .pane-foot-start, .pane-body) { overflow-wrap: break-word; }
/* A fieldset's legend is laid out as its first part, so the fieldset's own gap spaces it from what follows, as a label is from its field. */
fieldset > legend { float: left; width: 100%; padding-block: 0; }
/* Room a sideways track keeps for what lifts in it (.layout-track sets it); none elsewhere. */
:root { --edge-room: 0px; }
${rulesOf(edgeWords("top"), "padding-top: calc(var(--pad-words) + var(--edge-room));")}
${rulesOf(edgeWords("bottom"), "padding-bottom: calc(var(--pad-words) + var(--edge-room));")}
`;

export const ROW_STYLES = `
/* A row: side by side, each cell's gap after it picked by what's on each side (row()); a control only a mouse shows carries the gap before it.
   Two controls overlap their boxes so the edge rule slants them toward each other. A row that can't fit goes on to the next line, each line
   starting flush, and nothing in it shrinks below its words. Each control reaches over what's after it by that overlap, the last one past
   the row's end, so the row stops as far short: wherever a line ends on a control, the control ends at the row's end. */
.layout-row { display: flex; flex-wrap: wrap; align-items: center; row-gap: var(--gap-control-stack); min-width: 0; margin-inline-end: calc(-1 * var(--gap-control-row-boxes)); }
/* Fields that show their labels, wrapped onto lines of their own, are blocks one under another. */
.layout-row.is-on-field-boxes { align-items: flex-end; row-gap: var(--gap-block-block); }
.row-cell { display: flex; align-items: center; }
/* A box in a cell that scrolls sideways has its rail laid under it (navigation.ts), hanging in the gap below the row: beside it, the rail
   would have no width, its thumb past the row's end, and past a phone's screen, widening the page. Out of the cell's flow, so it never
   changes what the row measures to decide whether it stacks. */
.row-cell:has(> .rail.sideways) { position: relative; }
.row-cell > .rail.sideways { position: absolute; left: 0; right: 0; top: 100%; }
/* Words beside controls sit on the controls' center line: half the tallest control's height less a line's is above their first line and below
   their last, so held up with the controls (a row, and one at a pane's top edge, where the controls take the corner's cut) their first line
   lines up, and held down (on a field's boxes, at a pane's bottom edge) their last. A heading beside a button lines up with it however many
   lines it runs to. A row on lines of its own has nothing beside its words. */
${CONTROL_HEIGHTS.map((height) => `[data-control-height="${height}"] { --row-control-height: var(--control-height-${height}); }`).join("\n")}
.layout-row[data-control-height]:not(.is-on-field-boxes) { align-items: flex-start; }
.layout-row[data-control-height]:not(.is-wrapped) > .row-cell.is-words > :first-child { padding-top: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.layout-row[data-control-height]:not(.is-wrapped) > .row-cell.is-words > :last-child { padding-bottom: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
/* A block beside a field's box (a check beside Sort by) sits on the box's center line too, not at its foot. */
.layout-row.is-on-field-boxes:not(.is-wrapped) > .row-cell.is-block { min-height: var(--row-control-height); }
/* Side by side, words keep the words margin from a control beside them (--gap-words-beside-control), as from the pane's edge. */
${GAP_TOKENS.map((gap) => [gap, gap === "words-control" ? "words-beside-control" : gap]).map(([gap, token]) => `.layout-row > .row-cell.gap-end-${gap} { margin-inline-end: var(--gap-${token}); }`).join("\n")}
.layout-row.alignment-start { justify-content: flex-start; }
.layout-row.alignment-end { justify-content: flex-end; }
.layout-row.alignment-center { justify-content: center; }
.layout-row.alignment-between { justify-content: space-between; }
/* A cell that takes more than its words (equal shares, or the lead) shares out what's left, and its control fills it. */
.row-cell.fills { flex: 1 1 0; }
/* What's in it never runs past its cell, whatever its own words want (a font still arriving, a picker sized to its longest choice): a row too narrow for them is a stack instead, once it's measured (ROW_LAYOUT_SCRIPT). */
.row-cell.fills > * { flex: 1 1 auto; min-width: 0; }
.row-cell.fills > .shell { display: flex; }
.row-cell.fills > .shell > .face { width: 100%; justify-content: center; }
.row-cell:not(.fills) { flex: none; }
/* Words that don't fit the line beside what's before them wrap inside their cell rather than run past the row's end. */
.row-cell.is-words:not(.fills) { flex: 0 1 auto; min-width: 0; }
/* An equal row's cells each take its widest one's width at least (ROW_LAYOUT_SCRIPT), so they're equal in a pane that fits what's in it
   too; while the script measures, each is its own width. */
.layout-row.widths-equal > .row-cell.fills { min-width: var(--equal-cell-width, auto); }
.layout-row.is-measuring > .row-cell { flex: none !important; min-width: 0 !important; }
/* A row that can't fit on one line is a stack of its controls (is-wrapped, ROW_LAYOUT_SCRIPT): each fills its own line, as controls fill a
   pane's width, and none is left short at a line's start (and reaches past the line's end as the last control of a row does, whatever follows it). Words stay as wide as they are. */
.layout-row.is-wrapped > .row-cell.is-control, .layout-row.is-wrapped > .row-cell.is-control.fills { flex: 1 1 100%; min-width: 0; }
.layout-row.is-wrapped > .row-cell.is-control { margin-inline-end: var(--gap-control-row-boxes); }
.layout-row.is-wrapped > .row-cell.is-control > * { flex: 1 1 auto; }
.layout-row.is-wrapped > .row-cell.is-control > .shell { display: flex; }
.layout-row.is-wrapped > .row-cell.is-control > .shell > .face { width: 100%; justify-content: center; }
/* Words at the row's ends keep the pane's margin at that side. */
.row-cell.is-words:first-child { padding-inline-start: var(--pad-words); }
.row-cell.is-words:last-child { padding-inline-end: var(--pad-words); }
/* A row of words alone keeps the margin itself, so words that wrap onto a second line (at a large text size) start at it too. */
.layout-row:not(:has(> .row-cell:not(.is-words))) { padding-inline: var(--pad-words); }
.layout-row:not(:has(> .row-cell:not(.is-words))) > .row-cell.is-words:is(:first-child, :last-child) { padding-inline: 0; }
/* One height: every control in the row takes the tallest one's (data-control-height, from their size classes). */
${CONTROL_HEIGHTS.map((height) => `${HEIGHT_HOLDERS.map((holder) => `.layout-row[data-control-height="${height}"] > .row-cell > ${holder}`).join(", ")} { --control-height: var(--control-height-${height}); }`).join("\n")}
/* A row at a pane's top edge holds its controls up at the frame gap, to take the corner's cut; at the bottom edge, down. */
${rulesOf(edgeRows("top"), "align-items: flex-start;")}
${rulesOf(edgeRows("bottom"), "align-items: flex-end;")}
/* A cell whose only thing is hidden takes no room. */
.row-cell:has(> [hidden]:only-child) { display: none; }

/* A bar's row (the header): Zaisma's logo, where you are, search and you, side by side, spaced by what's beside what, as a row of controls
   is. The logo is words: the bar's words margin from its edge, and a block's gap before the tabs (none before it after a sidebar's button,
   only a control's gap after that). Controls beside each other overlap by the slant, so they slant toward each other; beside your picture,
   which never slants, words' gap. Search sits after the tabs, pushed to the end; with neither, the end goes to the end by itself. */
.bar-layout > .logo { margin-right: var(--gap-block-block); margin-left: var(--pad-words); }
.bar-layout:has(> :is([data-sidebar-button], [data-header-back])) > .logo { margin-left: 0; }
.bar-layout > :is([data-sidebar-button], [data-header-back]) { margin-right: var(--gap-words-control); }
.bar-layout .find:has(~ .end > .shell) { margin-inline-end: var(--gap-control-row-boxes); }
.bar-layout .find:has(~ .end > .me) { margin-inline-end: var(--gap-words-control); }
.bar-layout .nav:has(~ .find) { margin-inline-end: var(--gap-control-row-boxes); }
.bar-layout .nav:not(:has(~ .find)):has(~ .end > .shell) { margin-inline-end: var(--gap-control-row-boxes); }
.bar-layout .nav:not(:has(~ .find)):has(~ .end > .me) { margin-inline-end: var(--gap-words-control); }
.bar-layout .find { margin-left: auto; }
.bar-layout > .end { margin-left: auto; }
.bar-layout .find ~ .end { margin-left: 0; }
/* Search as a button (too little room for the field): Zaisma, where you are or the open search, the search button and you, in one row. The search
   button and Sign in slant toward each other; beside your picture, a control's gap. */
.bar-layout.has-search-button .find { margin-left: 0; }
.bar-layout.has-search-button > .find + .cut-btn { margin-left: auto; margin-right: var(--gap-words-control); }
/* Beside a control (Sign in), its slant runs under that control's (a row's negative gap), so it reaches past its own column: a
   control's max-width of 100% would hold it to the column, narrowing its face until its icon met the slant. */
.bar-layout.has-search-button > .find + .cut-btn:has(~ .end > .shell) { margin-right: var(--gap-control-row-boxes); max-width: none; }
.bar-layout.has-search-button > .find + .cut-btn:has(~ .end > .me) { margin-right: var(--gap-control-stack); }
/* A bar stood up (the header on a phone on its side): a stack down the page's side, so its pieces are all one width, the bar's own less its inset,
   a control's gap apart. What comes last sits at its foot. As tall as the screen with the browser's bars showing, so it never resizes as they
   come and go. The page keeps the bar's room beside it, each clear of the notch. */
@media ${HEADER_RAIL_MEDIA} {
  html:not(.is-playing):has(> body > .bar-layout.has-tab-row) { --header-room: var(--pad-frame); --header-gap: var(--pad-frame); }
  /* The page's own panes are the bar's gap apart too, so every gap between glass on the page is one. */
  html:not(.is-playing):has(> body > .bar-layout.has-tab-row) main .layout-stack:not(.glass *) > .stack-cell.gap-top-block-block { margin-top: var(--pad-frame); }
  html:not(.is-playing):has(> body > .bar-layout.has-tab-row) main .lead-and-side-in:not(.glass *) { gap: var(--pad-frame); }
  html:not(.is-playing):has(> body > .bar-layout.has-tab-row) body { padding-left: calc(max(var(--pad-frame), var(--safe-left), var(--corner-room)) + var(--header-height) + var(--pad-frame) - var(--pad-pane)); padding-right: var(--safe-right); }
  body > .bar-layout.has-tab-row:not(.searching) { top: var(--pad-frame); bottom: auto; left: max(var(--pad-frame), var(--safe-left), var(--corner-room)); width: var(--header-height); height: calc(100svh - 2 * var(--pad-frame)); transform: none; flex-direction: column; align-items: stretch; gap: var(--gap-control-stack); }
  body > .bar-layout.has-tab-row.has-tab-row:not(.searching) > * { margin: 0; max-width: none; }
  body > .bar-layout.has-tab-row.has-tab-row:not(.searching) > .nav.nav.nav { flex: 0 1 auto; width: auto; min-height: 0; margin: 0; }
  body > .bar-layout.has-tab-row.has-tab-row:not(.searching) > .end > * { flex: 1; }
  body > .bar-layout.has-tab-row.has-tab-row:not(.searching) > .find + .cut-btn { margin: auto 0 0; }
  body > .bar-layout.has-tab-row.has-tab-row:not(.searching):not(:has(> .find + .cut-btn)) > .end, body > .bar-layout.search-on-computer.has-tab-row:not(.searching) > .end { margin-top: auto; }
}

/* A row of cards (choice cards): side by side while all fit, their boxes overlapping so the edge rule slants them toward each other, each
   with a card's width (--size-card); stacked, --gap-control-stack apart, once they can't. One or the other, never some of each: each card's
   basis is very large while the cards don't fit side by side, so each takes a line, and nothing while they do, so they share the row. */
.cards-row { --cards-row-least: calc(var(--card-count) * var(--size-card)); display: flex; flex-wrap: wrap; align-items: stretch; gap: var(--gap-control-stack) 0; }
.cards-row > * { flex: 1 1 calc((var(--cards-row-least) - 100%) * 999); }
.cards-row > :not(:last-child) { margin-inline-end: max(var(--gap-control-row-boxes), min(0px, (var(--cards-row-least) - 100%) * 999)); }

`;

/**
 * A list with nothing in it shows what it says in its place (whenEmpty, right after it), and the list itself takes no room; with something in
 * it, the other way round. By what's in it, so a list a page script fills or empties shows the right one with no script of its own.
 */
export const WHEN_EMPTY_STYLES = `
/* A list and its empty state: one shows. The empty state comes hidden when the list has things; a page script's list that empties shows it again. */
:is(.list-rows:not(:has(> li:not([hidden]))), .layout-grid:not(:has(> .grid-cell:not([hidden]))), .layout-track:not(:has(> :not([hidden])))) { display: none; }
:is(.list-rows:has(> li:not([hidden])), .layout-grid:has(> .grid-cell:not([hidden])), .layout-track:has(> :not([hidden]))) + .when-empty { display: none; }
:is(.list-rows:not(:has(> li:not([hidden]))), .layout-grid:not(:has(> .grid-cell:not([hidden]))), .layout-track:not(:has(> :not([hidden])))) + .when-empty[hidden] { display: flex !important; }
/* A list in its well (List rows) goes with its well: the well leaves while the list is empty, and the empty state follows the well. */
.list-well:not(:has(.list-rows > li:not([hidden]))) { display: none; }
.list-well:has(.list-rows > li:not([hidden])) + .when-empty { display: none; }
.list-well:not(:has(.list-rows > li:not([hidden]))) + .when-empty[hidden] { display: flex !important; }
.when-empty { display: flex; flex-direction: column; min-width: 0; }
`;

export const GRID_STYLES = `
/* A grid: cells of one size, as many to a line as their least width allows (a named size, by what they hold), sharing the width; one
   column where two can't fit, by the grid's own width. */
.layout-grid { display: grid; gap: var(--gap-block-block); min-width: 0; }
.layout-grid.item-cover { grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--size-cover)), 1fr)); }
.layout-grid.item-card { grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--size-card)), 1fr)); }
.grid-cell { display: flex; flex-direction: column; min-width: 0; }
.grid-cell.is-words { padding-inline: var(--pad-words); }
/* Covers on one line, sharing it equally however many there are: goes by the width of what holds it (a container), to three, two and one across. */
.grid-one-line { container-type: inline-size; width: 100%; min-width: 0; }
.layout-grid.item-cover.is-one-line { gap: var(--gap-control-stack); grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
@container (max-width: ${coversShortOf(MAXIMUM_ONE_LINE_COVER_COUNT)}) { .layout-grid.item-cover.is-one-line { grid-auto-flow: row; grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: ${coversShortOf(3)}) { .layout-grid.item-cover.is-one-line { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: ${coversShortOf(3)}) { .layout-grid.item-cover.is-one-line.is-lead-wide > :first-child { grid-column: 1 / -1; } }
@container (max-width: ${coversShortOf(2)}) { .layout-grid.item-cover.is-one-line:not(.is-at-least-two-across) { grid-template-columns: minmax(0, 1fr); } }
`;

export const LEAD_AND_SIDE_STYLES = `
.lead-and-side { container: lead-and-side / inline-size; width: 100%; min-width: 0; }
.lead-and-side-lead, .lead-and-side-side { min-width: 0; }
.lead-and-side-in { display: grid; gap: var(--gap-block-block); grid-template-columns: minmax(0, 1fr); align-items: start; }
@container lead-and-side (min-width: ${LEAD_AND_SIDE_SIDE_BY_SIDE_PX}px) { .lead-and-side-in { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container lead-and-side (min-width: 800px) {
  .lead-and-side-in { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  .lead-and-side-side .layout-grid.item-cover.is-one-line { grid-auto-flow: row; grid-template-columns: minmax(0, 1fr); }
}
`;

export const TRACK_STYLES = `
/* A track and its rail are one thing to what holds them: whatever gap it puts between its parts never falls between them. */
.track-holder { display: flex; flex-direction: column; min-width: 0; }
/* A track: a row of cells that scrolls sideways, fading at an edge with more past it (data-fades-sideways). A cover's or picture's cell is
   a fifth of the track's own width, from 200px to 260px (a cover's in rem, growing with its words), so a few show with the next peeking in;
   room above and below them for their lifted shadow, given back. Its sides are its box's, so what scrolls by stops at the frame gap, where the first cover sits. */
.layout-track { --fade-sideways-px: 48px; --edge-room: var(--gap-words-control); container-type: inline-size; display: flex; gap: var(--gap-block-block); scroll-snap-type: x proximity;
  padding: var(--edge-room) 0; margin: calc(-1 * var(--edge-room)) 0; }
/* Its rail (data-side-rail, Rail in Navigation) runs under it, past the room kept for what lifts in it, never into it. A track that fits
   keeps the rail's reach there all the same, so its covers keep the words margin at a pane's end and nothing moves as the rail comes and goes. */
.layout-track.shows-side-rail { margin-bottom: 0; }
.layout-track:not(.shows-side-rail) { margin-bottom: var(--rail-reach); }
/* A cover snaps where the track's start inset ends, so the first one is a snapping point at the track's very start, not past it. */
.layout-track { scroll-padding-inline: var(--pad-words); }
@media (max-width: 760px), (max-height: 500px) { .layout-track { --fade-sideways-px: 28px; } }
/* Pictures lie closer than game cards do: each has an edge of its own, side by side. */
.layout-track:is(.item-picture, .item-thumbnail) { gap: var(--gap-control-stack); }
.layout-track.item-thumbnail > * { flex: 0 0 clamp(96px, 18cqi, 160px); scroll-snap-align: start; }
/* With no words under them, they keep no rail's room while they fit: nothing under them needs the words margin, so they sit at the frame gap
   from the pane's foot as any block does, and the rail takes its room only once there's something to scroll. */
.layout-track:is(.item-picture, .item-thumbnail):not(.shows-side-rail) { margin-bottom: calc(-1 * var(--edge-room)); }
.layout-track.item-cover > * { flex: 0 0 clamp(12.5rem, 20cqi, 16.25rem); scroll-snap-align: start; }
/* A picture has no words to grow with the text: its cell stays in px. */
.layout-track.item-picture > * { flex: 0 0 clamp(200px, 20cqi, 260px); scroll-snap-align: start; }
`;

export const COLUMNS_STYLES = `
/* Columns: two halves of the width, by the layout's own width (a container); one over the other below two columns' least width. A column's
   pane takes its whole width. The sticky one stays in view under the header while the other scrolls, only while they're side by side. */
/* Its own width is what it's given, never its content's, so it can be measured: as wide as what holds it. */
.layout-columns { container-type: inline-size; width: 100%; min-width: 0; }
.columns-in { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap-block-block); align-items: start; }
.columns-in > .column { min-width: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.columns-in > .column > .glass-pane { width: 100%; }
/* Words that start a column (a game's name beside its pictures) keep the words' margin above them, as words at a pane's top do, while a
   block beside them (the pictures) sits at the frame gap. */
.columns-in > .column > .layout-stack > .stack-cell.is-words:first-child { padding-block-start: var(--pad-words); }
.layout-columns.sticky-first > .columns-in > .column:first-child, .layout-columns.sticky-second > .columns-in > .column:last-child { position: sticky; top: var(--header-room, var(--pad-pane)); }
@container (max-width: ${2 * COLUMN_LEAST_PX + BLOCK_GAP_PX - 1}px) { .columns-in { grid-template-columns: minmax(0, 1fr); } .columns-in > .column { position: static !important; } }
.layout-columns.wide-first > .columns-in { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
@container (max-width: ${2 * COLUMN_LEAST_PX + BLOCK_GAP_PX - 1}px) { .layout-columns.wide-first > .columns-in { grid-template-columns: minmax(0, 1fr); } .layout-columns.second-first-when-stacked > .columns-in > .column:last-child { order: -1; } }
@media ${SCREEN_QUERIES.phoneSideways} { @container (min-width: ${2 * SHORT_COLUMN_LEAST_PX + BLOCK_GAP_PX}px) { .layout-columns.side-by-side-when-short.second-first-when-stacked > .columns-in > .column:last-child { order: 0; } } }
/* Wide but short (a phone on its side): side by side again from a narrower least, ${SHORT_COLUMN_LEAST_PX}px each. */
@media ${SCREEN_QUERIES.phoneSideways} {
  @container (min-width: ${2 * SHORT_COLUMN_LEAST_PX + BLOCK_GAP_PX}px) { .layout-columns.side-by-side-when-short > .columns-in { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .layout-columns.side-by-side-when-short.wide-first > .columns-in { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
}
`;

export const CARVING_END_STYLES = `
/* It's the size class that fills the carving less the frame gap each side: regular in a field or a well, small in a search. */
.carving-end { position: absolute; z-index: 5; top: var(--pad-frame-compact); right: calc(var(--pad-frame-compact) + var(--slant-end, 0px)); display: flex; }
`;

export const PANE_PARTS_STYLES = `
/* A pane's places: its head, body and foot, a block's gap apart. The head's words keep the pane's margin (in from its top and its start by
   --pad-words); its end control sits in the pane's top end corner at the frame gap, so the edge rule gives it the corner's cut, however
   narrow the pane: the words wrap beside it. The foot is the same at the bottom. */
.pane-parts { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
/* The head: its heading beside its corner control, and its other words under them both, at the pane's whole width. Its words keep the pane's
   margin (--head-inset, the pane's --pad-words, read before its words reset it). */
.pane-head { --head-inset: var(--pad-words); display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--gap-words-beside-control); align-items: start; min-width: 0; }
.pane-head-words { display: contents; }
.pane-head-words > * { grid-column: 1 / -1; min-width: 0; }
/* Its words start at the head's inset; a carving under them (a sheet's Switch of tabs) keeps its own room and runs the head's width. */
.pane-head-words > :not(.carving) { padding-inline-start: var(--head-inset); }
.pane-head-words > * + * { margin-top: var(--gap-words-words); }
.pane-head:has(> .pane-head-end) > .pane-head-words > :first-child { grid-column: 1; grid-row: 1; }
/* A heading beside its corner control never runs under it: a word longer than the room left (at a large text size) breaks, hyphenated where it can. */
.pane-head:has(> .pane-head-end) > .pane-head-words > :first-child { overflow-wrap: break-word; hyphens: auto; }
.pane-head:not([data-control-height]) > .pane-head-words > :first-child { padding-top: var(--head-inset); }
.pane-head > .pane-head-end { grid-column: 2; grid-row: 1; }
/* A start control (a sheet's Back) is the end control's twin in the top start corner, the edge rule giving it that corner's cut; the heading
   sits between the two, a words-to-control gap from each. Hidden (the first step has no Back), it takes no room. */
.pane-head > .pane-head-start { display: flex; grid-column: 1; grid-row: 1; }
.pane-head > .pane-head-start:not(:has(> :not([hidden]))) { display: none; }
.pane-head:has(> .pane-head-start > :not([hidden])) { grid-template-columns: auto minmax(0, 1fr) auto; }
.pane-head:has(> .pane-head-start > :not([hidden])) > .pane-head-words > :first-child { grid-column: 2; padding-inline-start: 0; }
.pane-head:has(> .pane-head-start > :not([hidden])) > .pane-head-end { grid-column: 3; }
.pane-foot { display: flex; gap: var(--gap-words-beside-control); min-width: 0; align-items: flex-end; }
/* Beside a corner control the head's first line sits on its center line, like words beside controls in a row; the foot's last line likewise. */
.pane-head[data-control-height] > .pane-head-words > :first-child { padding-top: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.pane-foot[data-control-height] > .pane-foot-start.is-words { padding-bottom: 0; }
.pane-foot[data-control-height] > .pane-foot-start.is-words > :first-child { padding-top: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.pane-foot[data-control-height] > .pane-foot-start.is-words > :last-child { padding-bottom: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.pane-head-end, .pane-foot-end { display: flex; margin-inline-start: auto; }
.pane-foot-start { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.pane-foot-start.is-words { padding: 0 0 var(--pad-words) var(--pad-words); }
/* A corner's tertiary button is words alone: it keeps the pane's margin. */
.pane-head-end.is-words { padding: var(--pad-words) var(--pad-words) 0 0; }
.pane-foot-end.is-words { padding: 0 var(--pad-words) var(--pad-words) 0; }
.pane-body { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
`;

/** The page shapes (html.ts's PageShape), in the order the gallery draws them. */
export const PAGE_SHAPES = ["reading", "wide", "full"] as const;

/** The screens the gallery draws the shapes on (checked-pages.ts's Desktop and Laptop), and the widths the shapes' tokens give: tokens.ts. */
const DRAWN_SCREENS = [
  { screenName: "2560 desktop", screenSlug: "desktop", widthPx: 2560, heightPx: 1440 },
  { screenName: "Laptop", screenSlug: "laptop", widthPx: 1440, heightPx: 900 },
  { screenName: "Phone", screenSlug: "phone", widthPx: 320, heightPx: 667 },
] as const;
const PAGE_WIDE_PX = 1680;
const PAGE_READING_PX = 820;
const PAGE_SIDEBAR_PX = 240;
const PAGE_MARGIN_PX = 24;
const PAGE_BLOCK_GAP_PX = 24;

/** One page shape drawn small on a screen: the world behind, the header and footer in the wide frame, and what the page holds at its width. */
export function pageShapeDrawing(options: { pageShape: (typeof PAGE_SHAPES)[number]; screenName: (typeof DRAWN_SCREENS)[number]["screenName"]; hasSidebar?: boolean }): Raw {
  const screenSlug = DRAWN_SCREENS.find((screen) => screen.screenName === options.screenName)!.screenSlug;
  return html`<div class="shape-drawing on-${screenSlug} shape-${options.pageShape}${options.hasSidebar ? " has-sidebar" : ""}" data-cut-line="0" role="img" aria-label="A ${options.pageShape} page on a ${options.screenName}"><span class="shape-world"></span><span class="shape-bar"></span><span class="shape-page">${options.hasSidebar ? html`<span class="shape-pane is-side"></span><span class="shape-main"><span class="shape-pane"></span><span class="shape-pane"></span></span>` : html`<span class="shape-pane"></span><span class="shape-pane"></span>`}</span><span class="shape-bar is-foot"></span></div>`;
}

/** A screen's frame and reading column, as shares of its width, for the drawings. */
const shareOf = (widthPx: number, screenWidthPx: number) => `${Math.round((Math.min(widthPx, screenWidthPx - 2 * PAGE_MARGIN_PX) / screenWidthPx) * 1000) / 10}%`;

export const PAGE_SHAPE_STYLES = `
/* Page shapes: a rebuilt page says what it is (html.ts's pageShape, data-page-shape on the page), and that sets how wide it runs, so nothing
   stretches across a big screen. The header, the footer and a wide or full page's panes sit in the wide frame (--size-page-wide); a reading
   page is one column (--size-page-reading) centered under the header, or its places down the side beside that column, the pair centered in
   the frame. A full page's world (its backdrop or stage) runs to the screen's edges behind. On a phone every shape is the screen less its margins. */
html[data-page-shape] body > main { width: min(var(--size-page-wide), calc(100% - 2 * var(--pad-pane))); margin: 0 auto; }
html[data-page-shape="reading"] body > main:not(:has(> .sidebar-layout)) { width: min(var(--size-page-reading), calc(100% - 2 * var(--pad-pane))); }
/* A pane that fits what's in it, placed straight in the page's column (or a stack of the page's), sits in its middle, under the header's,
   unless it's placed at the column's start (is-at-start: the game's page). */
html[data-page-shape] body > main > .glass-pane.fit:not(.is-at-start), html[data-page-shape] body > main > .layout-stack > .stack-cell > .glass-pane.fit:not(.is-at-start) { margin-inline: auto; }
/* The drawings in the gallery: a screen in its proportions, its world, the header and footer in the frame, and the page's panes at its width. */
.shape-drawing { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: space-evenly; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.shape-drawing.on-laptop { aspect-ratio: 16 / 10; }
/* A phone stands tall: drawn narrower, so it stays near the others' height. */
.shape-drawing.on-phone { aspect-ratio: 320 / 667; width: 40%; margin-inline: auto; }
.shape-world { position: absolute; inset: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--run) 18%, transparent), transparent 60%); }
/* A full page's world runs to the screen's edges, bright; behind a reading or wide page it's quieter, the frame being what counts. */
.shape-drawing:is(.shape-reading, .shape-wide) .shape-world { opacity: 0.35; }
.shape-drawing.shape-full .shape-world { opacity: 1; }
.shape-bar, .shape-page { position: relative; display: flex; }
.shape-bar { height: 7%; background: var(--slab); box-shadow: var(--slab-shade); }
.shape-bar.is-foot { height: 5%; }
.shape-page { height: 62%; flex-direction: column; justify-content: space-between; }
.shape-pane { height: 46%; background: var(--slab); box-shadow: var(--slab-shade); }
/* A reading page beside its places: the sidebar's own column and the reading column, the pair centered. */
.shape-drawing.has-sidebar > .shape-page { flex-direction: row; gap: var(--gap-control-stack); }
.shape-pane.is-side { flex: ${PAGE_SIDEBAR_PX} 0 0; height: 70%; }
.shape-main { flex: ${PAGE_READING_PX} 0 0; display: flex; flex-direction: column; justify-content: space-between; }
${DRAWN_SCREENS.map((screen) => {
  return `.shape-drawing.on-${screen.screenSlug} > .shape-bar, .shape-drawing.on-${screen.screenSlug} > .shape-page { width: ${shareOf(PAGE_WIDE_PX, screen.widthPx)}; }
.shape-drawing.on-${screen.screenSlug}.shape-reading > .shape-page { width: ${shareOf(PAGE_READING_PX, screen.widthPx)}; }
.shape-drawing.on-${screen.screenSlug}.shape-reading.has-sidebar > .shape-page { width: ${shareOf(PAGE_SIDEBAR_PX + PAGE_BLOCK_GAP_PX + PAGE_READING_PX, screen.widthPx)}; }`;
}).join("\n")}
`;
