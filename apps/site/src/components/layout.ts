import { html, raw, type Raw } from "../markup.ts";
import { CONTROL_HEIGHTS, type ControlHeight, type ControlMarkup } from "./control-markup.ts";
import { PANE_SIZES } from "./foundations.ts";

/*
 * Layout: how a page puts components together, as components like any other (docs/DECISIONS.md, "A page is only gallery components,
 * layout included"). A stack puts things one under another, a row side by side, a grid in cells of one size, a track in a row that
 * scrolls sideways, a split a pane beside a scroll of sections, and pane parts a pane's head, body and foot. Each picks its own
 * spacing from what's on each side (the spacing table, docs/DESIGN.md), so nobody passes a gap; widths and sizes are named, never numbers;
 * and each goes by the room it's given (container queries), never the window's, so it holds the same wherever it's put. The gallery
 * shows them in layout-gallery.ts, with the playground (playground.ts).
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

/** Where an item sits, for its margins: words (and a control that's words alone, a text button) keep the pane's; the rest the frame gap. */
const placedKind = (item: LayoutItem): "words" | "control" | "block" => (item.kind === "control" && item.markup.isWordsAlone ? "words" : item.kind);

/** The spacing tokens a layout picks from (docs/DESIGN.md, Spacing), by what's on each side. */
type LayoutGap = "control-row-boxes" | "control-stack" | "words-control" | "words-words" | "block-block";

/** What an item is to the spacing table: a control with words of its own is a block. */
const spacedKind = (item: LayoutItem): "words" | "control" | "block" => (item.kind === "control" && item.markup.hasOwnWords ? "block" : item.kind);

/** The gap between two things one under the other. */
function stackGap(above: LayoutItem, below: LayoutItem): LayoutGap {
  const kinds = [spacedKind(above), spacedKind(below)];
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

const placeAttributes = (item: LayoutItemPlace): Raw => html`${item.id ? html` id="${item.id}"` : ""}${item.isHidden ? raw(" hidden") : ""}`;
const groupLabel = (label: string | undefined): Raw => (label ? html` role="group" aria-label="${label}"` : raw(""));

export interface StackOptions {
  /** Top to bottom. */
  items: LayoutItem[];
  /** What the group is, for a screen reader, when it's one thing to them. */
  label?: string;
}

/** Things one under another, each gap picked from what's on each side of it. In a pane, controls fill its width. */
export function stack(options: StackOptions): Raw {
  return html`<div class="layout-stack"${groupLabel(options.label)}>${options.items.map((item, itemIndex) => {
    const above = options.items[itemIndex - 1];
    return html`<div class="stack-cell is-${placedKind(item)}${above ? ` gap-top-${stackGap(above, item)}` : ""}"${placeAttributes(item)}>${item.markup}</div>`;
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
  const controls = options.items.flatMap((item) => (item.kind === "control" ? [item.markup] : []));
  const tallest = controls.reduce<ControlHeight | null>((found, control) => (found === null || CONTROL_HEIGHTS.indexOf(control.controlHeight) > CONTROL_HEIGHTS.indexOf(found) ? control.controlHeight : found), null);
  const isOnFieldBoxes = controls.some((control) => control.hasOwnWords);
  const alignment = options.widths === "fit" ? (options.alignment ?? "start") : "start";
  const cells = options.items.map((item, itemIndex) => {
    const after = options.items[itemIndex + 1];
    // A control only a mouse shows (the row arrows) keeps the room before it on itself, so the row closes up when it's gone.
    const isAfterPointerOnly = after?.kind === "control" && after.markup.isPointerOnly;
    const before = options.items[itemIndex - 1];
    const isPointerOnly = item.kind === "control" && item.markup.isPointerOnly;
    // The last cell reaches past the row's end as far as a control reaches over the next, and the row stops that far short of its own end
    // (ROW_STYLES), so a control ends at the row's end whether its line wraps there or not.
    const endGap = after ? (isAfterPointerOnly ? "" : rowGap(item, after)) : "control-row-boxes";
    const gaps = [endGap ? `gap-end-${endGap}` : "", before && isPointerOnly ? `gap-start-${rowGap(before, item)}` : ""].filter(Boolean).join(" ");
    const isFilling = options.widths === "equal" || (options.widths === "lead-fills" && itemIndex === 0);
    return html`<div class="row-cell is-${placedKind(item)}${isFilling ? " fills" : ""}${gaps ? ` ${gaps}` : ""}"${placeAttributes(item)}>${item.markup}</div>`;
  });
  return html`<div class="layout-row alignment-${alignment}${isOnFieldBoxes ? " is-on-field-boxes" : ""}"${tallest ? html` data-control-height="${tallest}"` : ""}${groupLabel(options.label)}>${cells}</div>`;
}

export interface GridOptions {
  items: LayoutItem[];
  /** What a cell holds, which names its least width: a cover, a card, a figure. Cells share the width equally, as many as fit. */
  itemSize: "cover" | "card" | "figure";
  label?: string;
}

/** Cells of one size, as many to a line as fit their least width, folding to one column where two can't fit. */
export function grid(options: GridOptions): Raw {
  return html`<div class="layout-grid item-${options.itemSize}"${groupLabel(options.label)}>${options.items.map((item) => html`<div class="grid-cell is-${item.kind}"${placeAttributes(item)}>${item.markup}</div>`)}</div>`;
}

export interface TrackOptions {
  /** Unique on the page: its row arrows name it (rowArrows' trackId), and a page script fills it in. */
  id: string;
  /** Start to end: blocks, each one cell. A page script may add more of the same. */
  items: LayoutItem[];
  /** What a cell holds, which names its width: a cover. */
  itemSize: "cover";
  label?: string;
}

/** A row of cells of one size that scrolls sideways, fading at an edge with more past it: a row of covers, with Row arrows for a mouse. */
export function track(options: TrackOptions): Raw {
  return html`<div class="layout-track item-${options.itemSize}" id="${options.id}" data-fades-sideways${groupLabel(options.label)}>${options.items.map((item) => item.markup)}</div>`;
}

export interface SplitOptions {
  /** The pane at the side (a game's details): it stays in view while the sections scroll, when isSideSticky. */
  side: Raw;
  /** The sections beside it. */
  main: Raw;
  /** The side's width: a small pane's or a medium pane's (Glass pane's sizes). */
  sideSize: "pane-small" | "pane-medium";
  isSideSticky?: boolean;
}

/** The narrowest a split's main column gets before the side goes over it: a medium pane's width. */
const SPLIT_MAIN_LEAST_PX = PANE_SIZES.medium;
/** --gap-block-block, for the container queries, which can't read a token. */
const BLOCK_GAP_PX = 24;

/** A pane beside a scroll of sections; one over the other where there isn't room for both. */
export function split(options: SplitOptions): Raw {
  return html`<div class="layout-split side-${options.sideSize}${options.isSideSticky ? " is-side-sticky" : ""}"><div class="split-in"><div class="split-side">${options.side}</div><div class="split-main">${options.main}</div></div></div>`;
}

export interface PanePartsOptions {
  /** The pane's head: its words (a heading, a line under it), and at most one control in its top end corner. */
  head?: { words: Raw; end?: LayoutControl };
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
    ? html`<div class="pane-head"><div class="pane-head-words">${options.head.words}</div>${options.head.end ? html`<div class="pane-head-end${options.head.end.isWordsAlone ? " is-words" : ""}">${options.head.end}</div>` : ""}</div>`
    : "";
  const foot = options.foot
    ? html`<div class="pane-foot">${options.foot.start ? html`<div class="pane-foot-start is-${options.foot.start.kind}">${options.foot.start.markup}</div>` : ""}${options.foot.end ? html`<div class="pane-foot-end${options.foot.end.isWordsAlone ? " is-words" : ""}">${options.foot.end}</div>` : ""}</div>`
    : "";
  return html`<div class="pane-parts">${head}<div class="pane-body">${options.body}</div>${foot}</div>`;
}

/* ---- Styles: each layout component's own, in gallery order. ---- */

const GAP_TOKENS: LayoutGap[] = ["control-row-boxes", "control-stack", "words-control", "words-words", "block-block"];

/** What takes a control's height in each control (its --control-height), as it sits directly in a row's cell. */
const HEIGHT_HOLDERS = [".cut-btn", ".guest-btn", ".run-wrap > .run", ".cut-field > .field", ".find", ".tab-switch", ".steps"];

/** What shows of a holder's children: not hidden, not a cell whose only thing is hidden, and not a script, a template or a form's hidden field. */
const SHOWN = ':not([hidden], :has(> [hidden]:only-child), script, template, input[type="hidden"])';

/**
 * Components whose own words sit at their top (a field's label, a table's caption) or their foot (a field's hint), as [the component,
 * its words, or nothing when its words are all of it]: at a pane's edge, those words keep its margin.
 */
const WORDS_AT_TOP: [string, string][] = [[":is(.cut-field, .bday, .choices, .slider, .table, .usage, .chart, .glance)", ":first-child"], [".toggle", ".toggle-words"], [".check", ".check-words"], [".numbers", ""]];
const WORDS_AT_FOOT: [string, string][] = [[".cut-field", "p:last-child"], [":is(.chart, .glance)", ":last-child"], [".toggle", ".toggle-words"], [".check", ".check-words"], [".numbers", ""]];

/**
 * The words at a pane's or a tray's top and bottom edge keep its margin there too: the first and last words it holds, however deep in
 * the first and last of what it holds (a form, a stack, a shelf), a row's words there, and a component's own words there.
 */
function edgeWords(edge: "top" | "bottom"): string {
  const end = edge === "top" ? `:nth-child(1 of ${SHOWN})` : `:nth-last-child(1 of ${SHOWN})`;
  const own = edge === "top" ? WORDS_AT_TOP : WORDS_AT_FOOT;
  const selectors = [0, 1, 2, 3].flatMap((depth) => {
    const into = ` > *${end}`.repeat(depth) + " > ";
    return [
      `${into}.is-words${end}`,
      `${into}:is(h1, h2, h3, p)${end}`,
      // A row at the edge: every cell of it is at the edge.
      `${into}.layout-row${end} > .row-cell.is-words`,
      // A component whose words are its whole (Numbers) takes the margin itself.
      ...own.flatMap(([component, words]) => (words ? [`${into}${component}${end} > ${words}`, `${into}.layout-row${end} > .row-cell > ${component} > ${words}`] : [`${into}${component}${end}`])),
    ];
  });
  return PANE_CONTENT.flatMap((pane) => selectors.map((selector) => `${pane}${selector}`)).join(",\n");
}

/** What holds a pane's content, a tray's and a sheet's: the edges its words and rows measure from. */
const PANE_CONTENT = [".glass-pane > .pane-in", ".tray", ".sheet-in"];

/** The rows at a pane's top or bottom edge, however deep in the first or last of what it holds. */
function edgeRows(edge: "top" | "bottom"): string {
  const end = edge === "top" ? `:nth-child(1 of ${SHOWN})` : `:nth-last-child(1 of ${SHOWN})`;
  // A row on a field's boxes keeps to them.
  return PANE_CONTENT.flatMap((pane) => [0, 1, 2, 3].map((depth) => `${pane}${` > *${end}`.repeat(depth)} > .layout-row:not(.is-on-field-boxes)${end}`)).join(",\n");
}

export const STACK_STYLES = `
/* A stack: one under another, each cell's gap above it picked by what's on each side (stack(), from the spacing table). A hidden cell takes no
   room, and the first shown has nothing above it. In a pane, controls fill its width, as they always have. */
.layout-stack { display: flex; flex-direction: column; min-width: 0; }
.stack-cell { display: flex; flex-direction: column; min-width: 0; }
${GAP_TOKENS.filter((gap) => gap !== "control-row-boxes").map((gap) => `.layout-stack > .stack-cell.gap-top-${gap} { margin-top: var(--gap-${gap}); }`).join("\n")}
.layout-stack > .stack-cell:nth-child(1 of :not([hidden], :has(> [hidden]:only-child))) { margin-top: 0; }
/* A cell whose only thing is hidden (a page script shows it: a step, an error) takes no room. */
.stack-cell:has(> [hidden]:only-child) { display: none; }
/* Words keep the pane's margin: in from the frame gap by --pad-words (a pane sets it), at its sides, and at its top and bottom edges. */
.stack-cell.is-words { padding-inline: var(--pad-words); }
/* Inside words that already keep the margin, nothing takes it again. */
:is(.stack-cell, .row-cell, .grid-cell).is-words > * { --pad-words: 0px; }
${edgeWords("top")} { padding-top: var(--pad-words); }
${edgeWords("bottom")} { padding-bottom: var(--pad-words); }
`;

export const ROW_STYLES = `
/* A row: side by side, each cell's gap after it picked by what's on each side (row()); a control only a mouse shows carries the gap before it.
   Two controls overlap their boxes so the edge rule slants them toward each other. A row that can't fit goes on to the next line, each line
   starting flush, and nothing in it shrinks below its words. Each control reaches over what's after it by that overlap, the last one past
   the row's end, so the row stops as far short: wherever a line ends on a control, the control ends at the row's end. */
.layout-row { display: flex; flex-wrap: wrap; align-items: center; row-gap: var(--gap-control-stack); min-width: 0; margin-inline-end: calc(-1 * var(--gap-control-row-boxes)); }
.layout-row.is-on-field-boxes { align-items: flex-end; }
.row-cell { display: flex; align-items: center; }
${GAP_TOKENS.map((gap) => `.layout-row > .row-cell.gap-end-${gap} { margin-inline-end: var(--gap-${gap}); }\n.layout-row > .row-cell.gap-start-${gap} { margin-inline-start: var(--gap-${gap}); }`).join("\n")}
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
/* Words at the row's ends keep the pane's margin at that side. */
.row-cell.is-words:first-child { padding-inline-start: var(--pad-words); }
.row-cell.is-words:last-child { padding-inline-end: var(--pad-words); }
/* One height: every control in the row takes the tallest one's (data-control-height, from their size classes). */
${CONTROL_HEIGHTS.map((height) => `${HEIGHT_HOLDERS.map((holder) => `.layout-row[data-control-height="${height}"] > .row-cell > ${holder}`).join(", ")} { --control-height: var(--control-height-${height}); }`).join("\n")}
/* A row at a pane's top edge holds its controls up at the frame gap, to take the corner's cut, while its words keep the margin below it;
   at the bottom edge, down. */
${edgeRows("bottom")} { align-items: flex-end; }
${edgeRows("top")} { align-items: flex-start; }
/* A cell whose only thing is hidden takes no room. */
.row-cell:has(> [hidden]:only-child) { display: none; }
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
   track's own width, from 200px to 260px, so a few show with the next peeking in; room round them for their lifted shadow, given back. */
.layout-track { --fade-sideways-px: 48px; container-type: inline-size; display: flex; gap: var(--gap-block-block); scroll-snap-type: x proximity; scroll-padding-inline: var(--gap-words-words);
  padding: var(--gap-words-control) var(--gap-words-words); margin: calc(-1 * var(--gap-words-control)) calc(-1 * var(--gap-words-words)); }
.layout-track.item-cover > * { flex: 0 0 clamp(200px, 20cqi, 260px); scroll-snap-align: start; }
`;

export const SPLIT_STYLES = `
/* A split: the side pane beside the main column, by the split's own width (a container); one over the other below the side and a medium
   pane's width together. The side stays in view under the header while the main column scrolls, when it's sticky. */
/* Its own width is what it's given, never its content's, so it can be measured: as wide as what holds it. */
.layout-split { container-type: inline-size; width: 100%; min-width: 0; }
.split-in { display: grid; gap: var(--gap-block-block); align-items: start; }
.layout-split.side-pane-small > .split-in { grid-template-columns: ${PANE_SIZES.small}px minmax(0, 1fr); }
.layout-split.side-pane-medium > .split-in { grid-template-columns: ${PANE_SIZES.medium}px minmax(0, 1fr); }
.split-side, .split-main { min-width: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.layout-split .split-side > .glass-pane, .layout-split .split-main > .glass-pane { width: 100%; }
.layout-split.is-side-sticky > .split-in > .split-side { position: sticky; top: var(--header-room, var(--pad-pane)); }
@container (max-width: ${PANE_SIZES.small + SPLIT_MAIN_LEAST_PX + BLOCK_GAP_PX}px) { .layout-split.side-pane-small > .split-in { grid-template-columns: minmax(0, 1fr); } .layout-split.side-pane-small > .split-in > .split-side { position: static; } }
@container (max-width: ${PANE_SIZES.medium + SPLIT_MAIN_LEAST_PX + BLOCK_GAP_PX}px) { .layout-split.side-pane-medium > .split-in { grid-template-columns: minmax(0, 1fr); } .layout-split.side-pane-medium > .split-in > .split-side { position: static; } }
`;

export const PANE_PARTS_STYLES = `
/* A pane's places: its head, body and foot, a block's gap apart. The head's words keep the pane's margin (in from its top and its start by
   --pad-words); its end control sits in the pane's top end corner at the frame gap, so the edge rule gives it the corner's cut, however
   narrow the pane: the words wrap beside it. The foot is the same at the bottom. */
.pane-parts { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
.pane-head, .pane-foot { display: flex; gap: var(--gap-words-control); min-width: 0; }
.pane-head { align-items: flex-start; }
.pane-foot { align-items: flex-end; }
.pane-head-words { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-words-words); padding: var(--pad-words) 0 0 var(--pad-words); }
.pane-head-end, .pane-foot-end { display: flex; margin-inline-start: auto; }
.pane-foot-start { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.pane-foot-start.is-words { padding: 0 0 var(--pad-words) var(--pad-words); }
/* A corner's text button is words alone: it keeps the pane's margin. */
.pane-head-end.is-words { padding: var(--pad-words) var(--pad-words) 0 0; }
.pane-foot-end.is-words { padding: 0 var(--pad-words) var(--pad-words) 0; }
.pane-body { display: flex; flex-direction: column; gap: var(--gap-block-block); min-width: 0; }
`;
