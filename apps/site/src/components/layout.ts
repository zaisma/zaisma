import { html, raw, type Raw } from "../markup.ts";
import { CONTROL_HEIGHTS, type ControlHeight, type ControlMarkup } from "./control-markup.ts";
import { BARE_GROUPS, WORDS_HOLDERS } from "./tokens.ts";

/*
 * Layout: how a page puts components together, as components like any other (docs/DECISIONS.md, "A page is only gallery components,
 * layout included"). A stack puts things one under another, a row side by side, a grid in cells of one size, a track in a row that
 * scrolls sideways, columns two halves of the width side by side, and pane parts a pane's head, body and foot. Each picks its own
 * spacing from what's on each side (the spacing table, docs/DESIGN.md), so nobody passes a gap; widths and sizes are named, never numbers;
 * and each goes by the room it's given (container queries), never the window's, so it holds the same wherever it's put. The gallery
 * shows them in layout-gallery.ts, and Screens (screens.ts) shows any page on a phone and a desktop, measured.
 */

export type { ControlMarkup } from "./control-markup.ts";

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

/** Where an item sits, for its margins: words (and a control that's words alone, a quiet button) keep the pane's; the rest the frame gap. */
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

/** Things one under another, each gap picked from what's on each side of it. In a pane, controls fill its width. */
export function stack(options: StackOptions): Raw {
  const dataMarkup = options.dataAttributes ? html`${Object.entries(options.dataAttributes).map(([name, text]) => html` data-${name}="${text}"`)}` : "";
  return html`<div class="layout-stack"${groupLabel(options.label)}${dataMarkup}>${options.items.map((layoutItem, itemIndex) => {
    const above = options.items[itemIndex - 1];
    return html`<div class="stack-cell is-${placedKind(layoutItem)}${above ? ` gap-top-${stackGap(above, layoutItem)}` : ""}"${placeAttributes(layoutItem)}>${layoutItem.markup}</div>`;
  })}</div>`;
}

export interface RowOptions {
  /** Start to end. */
  items: LayoutItem[];
  /**
   * How the row shares its width: "equal" in equal shares (Light and Dark), "lead-fills" the first takes the rest and the others fit
   * their words (Play and Details), "fit" each fits its words, placed by alignment. A row that can't fit on one line goes on to the next.
   */
  widths: "equal" | "lead-fills" | "fit";
  /** Where fitting things sit: at the start, the end, the middle, or spread to both ends. Only for "fit". */
  alignment?: "start" | "end" | "center" | "between";
  label?: string;
}

/**
 * Things side by side. Controls in a row are always one height: every one takes the tallest one's size class. Two controls side by
 * side slant toward each other; words beside controls sit on their center line, and on a field's box when a field shows its label.
 */
export function row(options: RowOptions): Raw {
  const controls = options.items.flatMap((layoutItem) => (layoutItem.kind === "control" ? [layoutItem.markup] : []));
  // A block that's a row of controls itself (a shelf's sort and arrows) counts its controls' height too, so words beside it sit on their
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
    // A control only a mouse shows (the row arrows) keeps the room before it on itself, so the row closes up when it's gone.
    const isAfterPointerOnly = after?.kind === "control" && after.markup.isPointerOnly;
    const before = options.items[itemIndex - 1];
    const isPointerOnly = layoutItem.kind === "control" && layoutItem.markup.isPointerOnly;
    // The last cell reaches past the row's end as far as a control reaches over the next, and the row stops that far short of its own end
    // (ROW_STYLES), so a control ends at the row's end whether its line wraps there or not.
    const endGap = after ? (isAfterPointerOnly ? "" : rowGap(layoutItem, after)) : "control-row-boxes";
    const gaps = [endGap ? `gap-end-${endGap}` : "", before && isPointerOnly ? `gap-start-${rowGap(before, layoutItem)}` : ""].filter(Boolean).join(" ");
    const isFilling = options.widths === "equal" || (options.widths === "lead-fills" && itemIndex === 0);
    return html`<div class="row-cell is-${placedKind(layoutItem)}${isFilling ? " fills" : ""}${isPointerOnly ? " is-pointer-only" : ""}${gaps ? ` ${gaps}` : ""}"${placeAttributes(layoutItem)}>${layoutItem.markup}</div>`;
  });
  // An equal row is marked for ROW_LAYOUT_SCRIPT, which gives its cells the widest one's width.
  return html`<div class="layout-row${options.widths === "equal" ? " widths-equal" : ""} alignment-${alignment}${isOnFieldBoxes ? " is-on-field-boxes" : ""}"${tallest ? html` data-control-height="${tallest}"` : ""}${groupLabel(options.label)}>${cells}</div>`;
}

/**
 * Rows, as they're laid out (window.zaismaWatch, glass-script.ts): an equal row's cells each take its widest one's width, wherever it is (a
 * row in a pane that fits what's in it shares no spare room, so its widest cell would otherwise keep more than the rest); and a row that
 * can't fit on one line becomes a stack of its controls, each filling its own line as controls do in a pane (is-wrapped), so none is left
 * short at a line's start. Each row is laid out as it would be first (is-measuring), then set.
 */
export const ROW_LAYOUT_SCRIPT = `/* row layout */(function () {
  if (!window.zaismaWatch) return;
  function lay(row) {
    var cells = Array.prototype.slice.call(row.children);
    row.classList.add("is-measuring");
    var widestPx = 0;
    if (row.classList.contains("widths-equal")) cells.forEach(function (cell) { if (cell.classList.contains("fills")) widestPx = Math.max(widestPx, cell.getBoundingClientRect().width); });
    row.classList.remove("is-measuring");
    var equalWidth = widestPx ? Math.ceil(widestPx) + "px" : "";
    if (row.style.getPropertyValue("--equal-cell-width") !== equalWidth) row.style.setProperty("--equal-cell-width", equalWidth);
    var wasWrapped = row.classList.contains("is-wrapped");
    if (wasWrapped) row.classList.remove("is-wrapped");
    var isRtl = getComputedStyle(row).direction === "rtl", previousStart = null, isWrapped = false;
    cells.forEach(function (cell) {
      var box = cell.getBoundingClientRect();
      if (box.width < 1) return;
      var start = isRtl ? -box.right : box.left;
      if (previousStart !== null && start <= previousStart + 0.5) isWrapped = true;
      previousStart = start;
    });
    if (isWrapped) row.classList.add("is-wrapped");
  }
  window.zaismaWatch.each(".layout-row", function (row) {
    lay(row);
    window.zaismaWatch.size(row, function () { lay(row); });
  });
  if (document.fonts) document.fonts.ready.then(function () { document.querySelectorAll(".layout-row").forEach(lay); });
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

export type GridOptions = {
  items: LayoutItem[];
  label?: string;
  /** Unique on the page, for Load more to add the next page's cells to it (navigation.ts, loadMore's listIds). */
  id?: string;
} & (
  /** What a cell holds, which names its least width: a cover, a card, a figure. Cells share the width equally, as many as fit. */
  | { itemSize: "cover" | "card"; whenEmpty: Raw }
  /** Pictures or fields that are always there: no empty state. */
  | { itemSize: "figure"; whenEmpty?: never }
);

/**
 * Cells of one size, as many to a line as fit their least width, folding to one column where two can't fit. A grid of covers or cards says what
 * shows in its place while it has none (whenEmpty, an Empty state), a page script's cells included.
 */
export function grid(options: GridOptions): Raw {
  return html`<div class="layout-grid item-${options.itemSize}"${options.id ? html` id="${options.id}"` : ""}${groupLabel(options.label)}>${options.items.map((layoutItem) => html`<div class="grid-cell is-${layoutItem.kind}"${placeAttributes(layoutItem)}>${layoutItem.markup}</div>`)}</div>${options.whenEmpty ? html`<div class="when-empty"${options.items.some((layoutItem) => !layoutItem.isHidden) ? raw(" hidden") : ""}>${options.whenEmpty}</div>` : ""}`;
}

export interface TrackOptions {
  /** Unique on the page: its row arrows name it (rowArrows' trackId), and a page script fills it in. */
  id: string;
  /** Start to end: blocks, each one cell. A page script may add more of the same. */
  items: LayoutItem[];
  /** What a cell holds, which names its width: a cover. */
  itemSize: "cover";
  label?: string;
  /** What shows in its place while it has no covers (an Empty state), a page script's included. */
  whenEmpty: Raw;
}

/** A row of cells of one size that scrolls sideways, fading at an edge with more past it: a row of covers, with Row arrows for a mouse. */
export function track(options: TrackOptions): Raw {
  return html`<div class="layout-track item-${options.itemSize}" id="${options.id}" data-fades-sideways${groupLabel(options.label)}>${options.items.map((layoutItem) => layoutItem.markup)}</div><div class="when-empty"${options.items.length ? raw(" hidden") : ""}>${options.whenEmpty}</div>`;
}

export interface ColumnsOptions {
  /** Start to end: what each half holds (a pane, or a stack of them). */
  columns: [Raw, Raw];
  /** The column that stays in view under the header while the other scrolls: a game's details. */
  stickyColumn?: "first" | "second";
}

/** The least a column gets before the two go one over the other: a little more than a phone's width, so what's made for one fits. */
export const COLUMN_LEAST_PX = 360;
/** --gap-block-block, for the container query, which can't read a token. */
const BLOCK_GAP_PX = 24;

/**
 * Two halves of the width side by side, one over the other where both can't have a column's least width. A pane takes the whole width or
 * fits what's in it; one that should take half the screen goes in a column here.
 */
export function columns(options: ColumnsOptions): Raw {
  return html`<div class="layout-columns${options.stickyColumn ? ` sticky-${options.stickyColumn}` : ""}"><div class="columns-in">${options.columns.map((column) => html`<div class="column">${column}</div>`)}</div></div>`;
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
export function paneParts(options: PanePartsOptions): Raw {
  const head = options.head
    ? html`<div class="pane-head"${options.head.end && !options.head.end.isWordsAlone ? html` data-control-height="${options.head.end.controlHeight}"` : ""}>${options.head.start ? html`<div class="pane-head-start">${options.head.start}</div>` : ""}<div class="pane-head-words">${options.head.words}</div>${options.head.end ? html`<div class="pane-head-end${options.head.end.isWordsAlone ? " is-words" : ""}">${options.head.end}</div>` : ""}</div>`
    : "";
  const foot = options.foot
    ? html`<div class="pane-foot"${options.foot.end && !options.foot.end.isWordsAlone ? html` data-control-height="${options.foot.end.controlHeight}"` : ""}>${options.foot.start ? html`<div class="pane-foot-start is-${options.foot.start.kind}">${options.foot.start.markup}</div>` : ""}${options.foot.end ? html`<div class="pane-foot-end${options.foot.end.isWordsAlone ? " is-words" : ""}">${options.foot.end}</div>` : ""}</div>`
    : "";
  return html`<div class="pane-parts">${head}<div class="pane-body">${options.body}</div>${foot}</div>`;
}

/* ---- Styles: each layout component's own, in gallery order. ---- */

const GAP_TOKENS: LayoutGap[] = ["control-row-boxes", "control-stack", "words-control", "words-words", "block-block"];

/** What takes a control's height in each control (its --control-height), as it sits directly in a row's cell. */
const HEIGHT_HOLDERS = [".cut-btn", ".guest-btn", ".glass-btn", ".quiet-btn", ".run-wrap > .run", ".cut-field > .field", ".pin-box", ".find", ".tab-switch", ".steps"];

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
const WORDS_AT_TOP: [string, string][] = [[":is(.cut-field, .link-field, .pin-field, .bday, .choices, .slider, .table, .usage, .chart, .glance)", ":first-child"], [".toggle", ".toggle-words"], [".check", ""], [".progress", ".progress-words"], [".folded", ".folded-head"], [".numbers", ""], ...BARE_UNITS];
const WORDS_AT_FOOT: [string, string][] = [[":is(.cut-field, .pin-field)", "p:last-child"], [".qr-code", ".qr-caption"], [":is(.chart, .glance)", ":last-child"], [".toggle", ".toggle-words"], [".check", ""], [".folded:not([open])", ".folded-head"], [".numbers", ""], ...BARE_UNITS];

/**
 * The words at a pane's or a tray's top and bottom edge keep its margin there too: the first and last words it holds, however deep in
 * the first and last of what it holds (a form, a stack, a shelf), a row's words there, and a component's own words there.
 */
function edgeWords(edge: "top" | "bottom"): string {
  const end = edge === "top" ? `:nth-child(1 of ${SHOWN})` : `:nth-last-child(1 of ${SHOWN})`;
  const own = edge === "top" ? WORDS_AT_TOP : WORDS_AT_FOOT;
  const selectorsOf = (depthCount: number) => {
    // Never into words beside a control: they sit on its center line instead.
    const into = ` > *${end}${BESIDE_CONTROLS}`.repeat(depthCount) + " > ";
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
    .flatMap((pane) => Array.from({ length: pane.depthCount }, (_, depthCount) => selectorsOf(depthCount).map((selector) => `${pane.holder}${selector}`)).flat()).join(",\n");
}

/** What places its own words: a row with controls on one line and a pane's foot with a corner control (on the control's center line), and a pane's head. */
const BESIDE_CONTROLS = ":not(.layout-row[data-control-height]:not(.is-wrapped), .pane-head, .pane-foot[data-control-height])";

/**
 * What holds a surface's content (tokens.ts's WORDS_HOLDERS), the edges its words and rows measure from, and how deep in the first and last of
 * what it holds the edge rules look. A sheet's body, with no buttons under it, is where its words end.
 */
const PANE_CONTENT: { holder: string; depthCount: number; edges: ("top" | "bottom")[]; isForRows: boolean }[] = [
  ...WORDS_HOLDERS.map((holder) => ({ holder, depthCount: holder === ".playing-card-in" ? 2 : 5, edges: ["top", "bottom"] as ("top" | "bottom")[], isForRows: true })),
  { holder: ".pane-parts:not(:has(> .pane-foot)) > .pane-body > .sheet-scroll > .sheet-body", depthCount: 3, edges: ["bottom"], isForRows: false },
];

/** The rows at a pane's top or bottom edge, however deep in the first or last of what it holds. */
function edgeRows(edge: "top" | "bottom"): string {
  const end = edge === "top" ? `:nth-child(1 of ${SHOWN})` : `:nth-last-child(1 of ${SHOWN})`;
  // A row on a field's boxes keeps to them.
  return PANE_CONTENT.filter((pane) => pane.isForRows && pane.edges.includes(edge))
    .flatMap((pane) => Array.from({ length: pane.depthCount }, (_, depthCount) => `${pane.holder}${` > *${end}`.repeat(depthCount)} > .layout-row:not(.is-on-field-boxes)${end}`)).join(",\n");
}

export const STACK_STYLES = `
/* A stack: one under another, each cell's gap above it picked by what's on each side (stack(), from the spacing table). A hidden cell takes no
   room, and the first shown has nothing above it. In a pane, controls fill its width, as they always have. */
.layout-stack { display: flex; flex-direction: column; min-width: 0; }
.stack-cell { display: flex; flex-direction: column; min-width: 0; }
${GAP_TOKENS.filter((gap) => gap !== "control-row-boxes").map((gap) => `.layout-stack > .stack-cell.gap-top-${gap} { margin-top: var(--gap-${gap}); }`).join("\n")}
.layout-stack > .stack-cell:nth-child(1 of :not([hidden], .holds-only-hidden)) { margin-top: 0; }
/* A cell whose only thing is hidden (a page script shows it: a step, an error) takes no room. */
.stack-cell:has(> [hidden]:only-child) { display: none; }
/* Words keep the pane's margin: in from the frame gap by --pad-words (a pane sets it), at its sides, and at its top and bottom edges. */
.stack-cell.is-words { padding-inline: var(--pad-words); }
/* Inside words that already keep the margin, nothing takes it again. */
:is(.stack-cell, .row-cell, .grid-cell, .pane-foot-start).is-words > *, .pane-head-words > * { --pad-words: 0px; }
/* Room a sideways track keeps for what lifts in it (.layout-track sets it); none elsewhere. */
:root { --edge-room: 0px; }
${edgeWords("top")} { padding-top: calc(var(--pad-words) + var(--edge-room)); }
${edgeWords("bottom")} { padding-bottom: calc(var(--pad-words) + var(--edge-room)); }
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
${GAP_TOKENS.map((gap) => `.layout-row > .row-cell.gap-end-${gap} { margin-inline-end: var(--gap-${gap}); }\n.layout-row > .row-cell.gap-start-${gap} { margin-inline-start: var(--gap-${gap}); }`).join("\n")}
/* A control only a mouse shows isn't there without one, nor while it has nothing to do (hidden): the cell before it is then the row's last,
   and reaches past the row's end like any last cell. */
@media not ((hover: hover) and (pointer: fine)) {
  .row-cell.is-pointer-only { display: none; }
  .layout-row > .row-cell:has(+ .row-cell.is-pointer-only:last-child) { margin-inline-end: var(--gap-control-row-boxes); }
}
.layout-row > .row-cell:has(+ .row-cell.is-pointer-only:last-child > [hidden]:only-child) { margin-inline-end: var(--gap-control-row-boxes); }
.layout-row.alignment-start { justify-content: flex-start; }
.layout-row.alignment-end { justify-content: flex-end; }
.layout-row.alignment-center { justify-content: center; }
.layout-row.alignment-between { justify-content: space-between; }
/* A cell that takes more than its words (equal shares, or the lead) shares out what's left, and its control fills it. */
.row-cell.fills { flex: 1 1 0; }
.row-cell.fills > * { flex: 1 1 auto; }
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
${edgeRows("top")} { align-items: flex-start; }
${edgeRows("bottom")} { align-items: flex-end; }
/* A cell whose only thing is hidden takes no room. */
.row-cell:has(> [hidden]:only-child) { display: none; }
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
.when-empty { display: flex; flex-direction: column; min-width: 0; }
`;

export const GRID_STYLES = `
/* A grid: cells of one size, as many to a line as their least width allows (a named size, by what they hold), sharing the width; one
   column where two can't fit, by the grid's own width. */
.layout-grid { display: grid; gap: var(--gap-block-block); min-width: 0; }
.layout-grid.item-cover { grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--size-cover)), 1fr)); }
.layout-grid.item-card { grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--size-card)), 1fr)); }
.layout-grid.item-figure { grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--size-figure)), 1fr)); }
.grid-cell { display: flex; flex-direction: column; min-width: 0; }
.grid-cell.is-words { padding-inline: var(--pad-words); }
`;

export const TRACK_STYLES = `
/* A track: a row of cells that scrolls sideways, fading at an edge with more past it (data-fades-sideways). A cover's cell is a fifth of the
   track's own width, from 200px to 260px, so a few show with the next peeking in; room above and below them for their lifted shadow, given
   back. Its sides are its box's, so what scrolls by stops at the frame gap, where the first cover sits. */
.layout-track { --fade-sideways-px: 48px; --edge-room: var(--gap-words-control); container-type: inline-size; display: flex; gap: var(--gap-block-block); scroll-snap-type: x proximity;
  padding: var(--edge-room) 0; margin: calc(-1 * var(--edge-room)) 0; }
/* Screenshots lie closer than game cards do: pictures with an edge of their own, side by side. */
.layout-track:has(> .screenshot) { gap: var(--gap-control-stack); }
.layout-track.item-cover > * { flex: 0 0 clamp(200px, 20cqi, 260px); scroll-snap-align: start; }
`;

export const COLUMNS_STYLES = `
/* Columns: two halves of the width, by the layout's own width (a container); one over the other below two columns' least width. A column's
   pane takes its whole width. The sticky one stays in view under the header while the other scrolls, only while they're side by side. */
/* Its own width is what it's given, never its content's, so it can be measured: as wide as what holds it. */
.layout-columns { container-type: inline-size; width: 100%; min-width: 0; }
.columns-in { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gap-block-block); align-items: start; }
.columns-in > .column { min-width: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.columns-in > .column > .glass-pane { width: 100%; }
.layout-columns.sticky-first > .columns-in > .column:first-child, .layout-columns.sticky-second > .columns-in > .column:last-child { position: sticky; top: var(--header-room, var(--pad-pane)); }
@container (max-width: ${2 * COLUMN_LEAST_PX + BLOCK_GAP_PX - 1}px) { .columns-in { grid-template-columns: minmax(0, 1fr); } .columns-in > .column { position: static !important; } }
`;

export const PANE_PARTS_STYLES = `
/* A pane's places: its head, body and foot, a block's gap apart. The head's words keep the pane's margin (in from its top and its start by
   --pad-words); its end control sits in the pane's top end corner at the frame gap, so the edge rule gives it the corner's cut, however
   narrow the pane: the words wrap beside it. The foot is the same at the bottom. */
.pane-parts { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
/* The head: its heading beside its corner control, and its other words under them both, at the pane's whole width. Its words keep the pane's
   margin (--head-inset, the pane's --pad-words, read before its words reset it). */
.pane-head { --head-inset: var(--pad-words); display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--gap-words-control); align-items: start; min-width: 0; }
.pane-head-words { display: contents; }
.pane-head-words > * { grid-column: 1 / -1; min-width: 0; padding-inline-start: var(--head-inset); }
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
.pane-foot { display: flex; gap: var(--gap-words-control); min-width: 0; align-items: flex-end; }
/* Beside a corner control the head's first line sits on its center line, like words beside controls in a row; the foot's last line likewise. */
.pane-head[data-control-height] > .pane-head-words > :first-child { padding-top: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.pane-foot[data-control-height] > .pane-foot-start.is-words { padding-bottom: 0; }
.pane-foot[data-control-height] > .pane-foot-start.is-words > :first-child { padding-top: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.pane-foot[data-control-height] > .pane-foot-start.is-words > :last-child { padding-bottom: max(0px, calc((var(--row-control-height) - 1lh) / 2)); }
.pane-head-end, .pane-foot-end { display: flex; margin-inline-start: auto; }
.pane-foot-start { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.pane-foot-start.is-words { padding: 0 0 var(--pad-words) var(--pad-words); }
/* A corner's quiet button is words alone: it keeps the pane's margin. */
.pane-head-end.is-words { padding: var(--pad-words) var(--pad-words) 0 0; }
.pane-foot-end.is-words { padding: 0 var(--pad-words) var(--pad-words) 0; }
.pane-body { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
`;

/** The page shapes (html.ts's PageShape), in the order the gallery draws them. */
export const PAGE_SHAPES = ["reading", "wide", "full"] as const;

/** The screens the gallery draws the shapes on (checked-pages.ts's Desktop and Laptop), and the widths the shapes' tokens give: tokens.ts. */
const DRAWN_SCREENS = [
  { screenName: "2560 desktop", widthPx: 2560, heightPx: 1440 },
  { screenName: "Laptop", widthPx: 1440, heightPx: 900 },
] as const;
const PAGE_WIDE_PX = 1680;
const PAGE_READING_PX = 820;
const PAGE_MARGIN_PX = 24;

/** One page shape drawn small on a screen: the world behind, the header and footer in the wide frame, and what the page holds at its width. */
export function pageShapeDrawing(options: { pageShape: (typeof PAGE_SHAPES)[number]; screenName: (typeof DRAWN_SCREENS)[number]["screenName"] }): Raw {
  const screenSlug = options.screenName === "Laptop" ? "laptop" : "desktop";
  return html`<div class="shape-drawing on-${screenSlug} shape-${options.pageShape}" data-cut-line="0" role="img" aria-label="A ${options.pageShape} page on a ${options.screenName}"><span class="shape-world"></span><span class="shape-bar"></span><span class="shape-page"><span class="shape-pane"></span><span class="shape-pane"></span></span><span class="shape-bar is-foot"></span></div>`;
}

/** A screen's frame and reading column, as shares of its width, for the drawings. */
const shareOf = (widthPx: number, screenWidthPx: number) => `${Math.round((Math.min(widthPx, screenWidthPx - 2 * PAGE_MARGIN_PX) / screenWidthPx) * 1000) / 10}%`;

export const PAGE_SHAPE_STYLES = `
/* Page shapes: a rebuilt page says what it is (html.ts's pageShape, data-page-shape on the page), and that sets how wide it runs, so nothing
   stretches across a big screen. The header, the footer and a wide or full page's panes sit in the wide frame (--size-page-wide); a reading
   page is one column (--size-page-reading) centered under the header, or its places down the side beside that column, the pair centered in
   the frame. A full page's world (its backdrop or stage) runs to the screen's edges behind. On a phone every shape is the screen less its margins. */
html[data-page-shape] body > main { width: min(var(--size-page-wide), calc(100% - 2 * var(--pad-pane))); margin: 0 auto; }
html[data-page-shape="reading"] body > main:not(:has(> .side-places)) { width: min(var(--size-page-reading), calc(100% - 2 * var(--pad-pane))); }
/* The drawings in the gallery: a screen in its proportions, its world, the header and footer in the frame, and the page's panes at its width. */
.shape-drawing { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: space-evenly; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.shape-drawing.on-laptop { aspect-ratio: 16 / 10; }
.shape-world { position: absolute; inset: 0; background: linear-gradient(135deg, color-mix(in srgb, var(--run) 18%, transparent), transparent 60%); }
/* A full page's world runs to the screen's edges, bright; behind a reading or wide page it's quieter, the frame being what counts. */
.shape-drawing:is(.shape-reading, .shape-wide) .shape-world { opacity: 0.35; }
.shape-drawing.shape-full .shape-world { opacity: 1; }
.shape-bar, .shape-page { position: relative; display: flex; }
.shape-bar { height: 7%; background: var(--slab); box-shadow: var(--slab-shade); }
.shape-bar.is-foot { height: 5%; }
.shape-page { height: 62%; flex-direction: column; justify-content: space-between; }
.shape-pane { height: 46%; background: var(--slab); box-shadow: var(--slab-shade); }
${DRAWN_SCREENS.map((screen) => {
  const slug = screen.screenName === "Laptop" ? "laptop" : "desktop";
  return `.shape-drawing.on-${slug} > .shape-bar, .shape-drawing.on-${slug} > .shape-page { width: ${shareOf(PAGE_WIDE_PX, screen.widthPx)}; }
.shape-drawing.on-${slug}.shape-reading > .shape-page { width: ${shareOf(PAGE_READING_PX, screen.widthPx)}; }`;
}).join("\n")}
`;
