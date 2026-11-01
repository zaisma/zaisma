import { createHash } from "node:crypto";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { MINIFIED_COMPONENT_SCRIPT, MINIFIED_FIRST_PAINT_PIECES, MINIFIED_FIRST_PAINT_SCRIPT, MINIFIED_LOOK_SCRIPT } from "../generated/components-script.generated.ts";
import { ACCOUNT_LINK_SCRIPT, FOLLOWING_FILES_SCRIPT, HIDDEN_AMOUNTS_SCRIPT, MEASURED_GLASS_SCRIPT, THEME_SCRIPT } from "./first-paint-script.ts";
import { COMPONENTS } from "./component.ts";
import { BACKDROP_SCRIPT, EDGE_LIGHT_SCRIPT, GLASS_SCRIPT, PICTURE_SCRIPT, TOKEN_STYLES, WATCH_SCRIPT } from "./foundations.ts";
import { BUSY_SCRIPT, RUNNER_SCRIPT, TOGGLE_SCRIPT } from "./actions.ts";
import { CHECK_SCRIPT, CHOICE_CARDS_SCRIPT, COLOR_FIELD_SCRIPT, COPY_SCRIPT, FIELD_SCRIPT, FILE_DROP_SCRIPT, LONG_FIELD_SCRIPT, PIN_FIELD_SCRIPT, SEARCH_SCRIPT, SELECT_SCRIPT, SLIDER_SCRIPT, SWITCH_SCRIPT, WHEEL_SCRIPT } from "./inputs.ts";
import { COMPACT_SCRIPT, FILTER_MENU_SCRIPT, LOAD_MORE_SCRIPT, RAIL_SCRIPT, ROW_SCRIPT, SCROLL_FADE_SCRIPT, SIDEBAR_SCRIPT } from "./navigation.ts";
import { ROW_LAYOUT_SCRIPT } from "./layout.ts";
import { DROPDOWN_SCRIPT, PLACE_SCRIPT, STARTED_LOW_SCRIPT, STEP_FLOW_SCRIPT } from "./panes.ts";
import { LAYERS_SCRIPT } from "./layers.ts";
import { MATERIAL_SCRIPT, MATERIAL_STYLES } from "./materials.ts";
import { CHART_SCRIPT, LIST_ROW_FOLD_SCRIPT } from "./data.ts";
import { QR_CODE_SCRIPT } from "./qr-code.ts";
import { PLAYING_CARD_SCRIPT } from "./playing.ts";
import { CONFIRM_ITS_YOU_SCRIPT } from "./confirm-its-you.ts";
import "./stripe-frame.ts";
// The layout components register in layout-gallery.ts, whose examples use every other group.
import "./layout-gallery.ts";
// Components pages still to build need: words to read and the ways through them, and people and what they write.
import "./people.ts";
import "./screens.ts";
import "./waiting.ts";
// A game's page while it plays: the bar beside the game and the cards over it.
import "./playing.ts";
// The city defines its gallery entry as it loads; its script is its own (CITY_SCRIPT), loaded only by the pages on it, but for where its
// pane sits on a phone, which is part of the first paint (CITY_PANE_PLACE_SCRIPT).
import { CITY_PANE_PLACE_SCRIPT } from "./city.ts";

/*
 * The components, bundled for the pages: importing this module defines every one of them (each group file
 * registers its own as it loads), so COMPONENTS() is complete before the first request. Pages put
 * COMPONENT_STYLES() in their <style>, FIRST_PAINT_SCRIPT in their head and COMPONENT_SCRIPT (and HEADER_SCRIPT where the header is) after.
 */

export { COMPONENTS, COMPONENT_GROUPS, componentBySlug } from "./component.ts";
export { HEADER_SCRIPT } from "./navigation.ts";
export { columns, grid, paneParts, row, stack, track, type LayoutControl, type LayoutItem } from "./layout.ts";

/**
 * A pointed look is only for a pointer that can rest (a mouse, a trackpad): on a touch screen a tapped thing would keep it after the finger
 * lifts. So every rule's :hover selectors are moved under @media (hover: hover), however deep in other @media blocks; the rest of a selector
 * list (a gallery's fixed is-pointed state) stays where it was.
 */
export function hoverOnlyWherePointing(css: string): string {
  let out = "", readIndex = 0;
  // The end of a block opened at "{" (index of its "}"), past comments and quoted strings.
  const blockEnd = (openIndex: number): number => {
    let nestingLevel = 0;
    for (let i = openIndex; i < css.length; i++) {
      const character = css[i];
      if (character === "/" && css[i + 1] === "*") { i = css.indexOf("*/", i + 2) + 1; continue; }
      if (character === '"' || character === "'") { i = css.indexOf(character, i + 1); continue; }
      if (character === "{") nestingLevel++;
      else if (character === "}" && --nestingLevel === 0) return i;
    }
    return css.length - 1;
  };
  while (readIndex < css.length) {
    if (css.startsWith("/*", readIndex)) { const endIndex = css.indexOf("*/", readIndex + 2) + 2; out += css.slice(readIndex, endIndex); readIndex = endIndex; continue; }
    const openIndex = css.indexOf("{", readIndex);
    if (openIndex < 0) { out += css.slice(readIndex); break; }
    // A comment before the selector stays as it is.
    const commentIndex = css.slice(readIndex, openIndex).lastIndexOf("*/");
    if (commentIndex >= 0) { out += css.slice(readIndex, readIndex + commentIndex + 2); readIndex += commentIndex + 2; continue; }
    const head = css.slice(readIndex, openIndex), closeIndex = blockEnd(openIndex), body = css.slice(openIndex + 1, closeIndex);
    const selector = head.trim();
    if (/^@(media|supports|container|layer)\b/.test(selector)) out += `${head}{${hoverOnlyWherePointing(body)}}`;
    else if (selector.startsWith("@") || !selector.includes(":hover")) out += `${head}{${body}}`;
    else {
      const parts = selector.split(/,(?![^(]*\))/).map((part) => part.trim());
      const pointing = parts.filter((part) => part.includes(":hover")), resting = parts.filter((part) => !part.includes(":hover"));
      out += `${head.slice(0, head.length - head.trimStart().length)}${resting.length ? `${resting.join(", ")} {${body}}\n` : ""}@media (hover: hover) { ${pointing.join(", ")} {${body}} }`;
    }
    readIndex = closeIndex + 1;
  }
  return out;
}

let shownStyles = "";
/** The tokens, the materials (so a component's own rules come after them), then every component's CSS in gallery order, worked out once. */
export const COMPONENT_STYLES = (): string => (shownStyles ||= hoverOnlyWherePointing(TOKEN_STYLES + MATERIAL_STYLES + COMPONENTS().map((each) => each.styles).join("")));

/**
 * The components' scripts, readable, in three (what scripts/minify-components.mjs minifies). The first-paint script comes inside every page,
 * at the end of its <body> (html.ts), in the pieces the page needs, so nothing the page downloads holds its first paint ("A page shows
 * whole while it loads", docs/DESIGN.md): the theme, the files that follow it, the page watcher, pictures arriving, the glass and its edge
 * rule (and glass over a measured background), the materials, and every script that sizes or places the layout or sets words (a switch's
 * slab, rows, the sidebar, compacting, rails and scroll fades, a pane started low, the sign-in's pane, a long field's height, a chart's
 * scroll, a slider's and a colour's thumb, a date's words in the viewer's time), and Zaisma's own shader behind the glass. It runs once the
 * page is read, before its first paint. The look script follows with what only adds light and motion: a game's world behind the glass, edge
 * lights, and panes hung from a button (menus, select lists). The loading check (layout-check.mjs) holds back everything but the page and
 * fails one that changes when the rest arrives, which is how a script is found to belong in the first. The rest runs after, holding nothing.
 */
export interface FirstPaintPiece {
  /** Lowercase words joined by dashes. */
  readonly name: string;
  readonly source: string;
  /** What in a page's markup needs it; null for every page. */
  readonly marker: RegExp | null;
  /**
   * Whether it runs first in the page's body: a piece that follows the page as it arrives (through window.zaismaWatch, handed only whole
   * elements), so the glass has its cuts and rims in the first frame each pane shows in. The rest run at the body's end, once what they
   * look for is all there, as they were written to.
   */
  readonly isFirstInBody: boolean;
}

/**
 * Each piece runs once in a page, whether the page carried it or a file brought it for something added later (a sheet fetched in with a
 * wheel in it): the look script carries every piece that only some pages carry.
 */
const firstPaintPiece = (name: string, source: string, marker: RegExp | null, isFirstInBody = false): FirstPaintPiece => ({
  name, marker, isFirstInBody,
  source: `(function () { var pieces = window.zaismaPieces = window.zaismaPieces || {}; if (pieces[${JSON.stringify(name)}]) return; pieces[${JSON.stringify(name)}] = true;\n${source}})();\n`,
});

/** The first-paint script's pieces, in the order they run: a page carries the ones its markup needs (html.ts, firstPaintScriptTags). */
export const FIRST_PAINT_PIECES: readonly FirstPaintPiece[] = [
  firstPaintPiece("theme", THEME_SCRIPT, null, true),
  firstPaintPiece("following-files", FOLLOWING_FILES_SCRIPT, null, true),
  firstPaintPiece("watch", WATCH_SCRIPT, null, true),
  firstPaintPiece("pictures", PICTURE_SCRIPT, null, true),
  firstPaintPiece("glass", GLASS_SCRIPT, null, true),
  firstPaintPiece("materials", MATERIAL_SCRIPT, null, true),
  firstPaintPiece("rows", ROW_LAYOUT_SCRIPT, null),
  firstPaintPiece("compacting", COMPACT_SCRIPT, null),
  // A rail takes its room beside what scrolls (a table, a track), and every page has the page's own.
  firstPaintPiece("rails", RAIL_SCRIPT, null),
  // A row that scrolls sideways starts where the one you're on shows whole.
  firstPaintPiece("scroll-fades", SCROLL_FADE_SCRIPT, null),
  // Zaisma's own shader is drawn in the first frame, so its stand-in never flashes; a game's world starts as its blurred placeholder and
  // follows with the look script.
  firstPaintPiece("backdrop", BACKDROP_SCRIPT, /data-backdrop="shader"/),
  firstPaintPiece("measured-glass", MEASURED_GLASS_SCRIPT, /data-glass-kind=/, true),
  firstPaintPiece("switches", SWITCH_SCRIPT, /\btab-switch\b/),
  firstPaintPiece("row-arrows", ROW_SCRIPT, /data-row-arrows/),
  firstPaintPiece("sidebar", SIDEBAR_SCRIPT, /\bsidebar-main\b|data-sidebar-remember/),
  firstPaintPiece("started-low", STARTED_LOW_SCRIPT, /\bis-started-low\b/),
  // Where a pane hangs from its button: a wheel or a colour field makes its floating pane as it's wired.
  firstPaintPiece("placing", PLACE_SCRIPT, /data-wheels|data-color-field/),
  firstPaintPiece("wheels", WHEEL_SCRIPT, /data-wheels/),
  firstPaintPiece("charts", CHART_SCRIPT, /data-chart-scroll/),
  firstPaintPiece("long-fields", LONG_FIELD_SCRIPT, /data-long-field/),
  firstPaintPiece("sliders", SLIDER_SCRIPT, /data-slider/),
  firstPaintPiece("color-fields", COLOR_FIELD_SCRIPT, /data-color-field/),
  firstPaintPiece("city-pane", CITY_PANE_PLACE_SCRIPT, /data-city-pane|\bcity-stage\b/),
  firstPaintPiece("account-link", ACCOUNT_LINK_SCRIPT, /data-account-from-cookie/),
  firstPaintPiece("hidden-amounts", HIDDEN_AMOUNTS_SCRIPT, /data-amount/),
];
/** Every piece, as the gallery's first-paint file carries it. */
export const FIRST_PAINT_SCRIPT_SOURCE = FIRST_PAINT_PIECES.map((piece) => piece.source).join("");
const SOME_PAGES_PIECES_SOURCE = FIRST_PAINT_PIECES.filter((piece) => piece.marker).map((piece) => piece.source).join("");
export const LOOK_SCRIPT_SOURCE = SOME_PAGES_PIECES_SOURCE + EDGE_LIGHT_SCRIPT + DROPDOWN_SCRIPT + SELECT_SCRIPT;
export const COMPONENT_SCRIPT_SOURCE = FIELD_SCRIPT + PIN_FIELD_SCRIPT + RUNNER_SCRIPT + BUSY_SCRIPT + TOGGLE_SCRIPT + CHECK_SCRIPT + CHOICE_CARDS_SCRIPT + FILE_DROP_SCRIPT + COPY_SCRIPT + QR_CODE_SCRIPT + SEARCH_SCRIPT + FILTER_MENU_SCRIPT + LAYERS_SCRIPT + STEP_FLOW_SCRIPT + CONFIRM_ITS_YOU_SCRIPT + LOAD_MORE_SCRIPT + PLAYING_CARD_SCRIPT + LIST_ROW_FOLD_SCRIPT;

/**
 * The scripts pages load: the minified ones, unless one was made from an older source (a script changed and npm run components:minify wasn't
 * run), when the readable one is served instead, so a page never gets a stale script.
 */
const minifiedOr = (minified: { sourceSha256: string; minifiedText: string }, source: string) =>
  minified.sourceSha256 === createHash("sha256").update(source).digest("hex") ? minified.minifiedText : source;
/** The first-paint script, inside every page (html.ts), and a file of its own for the gallery, which holds its first paint for its files. */
export const FIRST_PAINT_SCRIPT: PageScript = pageScript("first-paint", minifiedOr(MINIFIED_FIRST_PAINT_SCRIPT, FIRST_PAINT_SCRIPT_SOURCE));
export const LOOK_SCRIPT: PageScript = pageScript("look", minifiedOr(MINIFIED_LOOK_SCRIPT, LOOK_SCRIPT_SOURCE));
/** Each piece's text as a page carries it, minified. */
export const firstPaintPieceText = (piece: FirstPaintPiece): string => {
  const minified = (MINIFIED_FIRST_PAINT_PIECES as Record<string, { sourceSha256: string; minifiedText: string } | undefined>)[piece.name];
  return minified ? minifiedOr(minified, piece.source) : piece.source;
};
export const COMPONENT_SCRIPT: PageScript = pageScript("components", minifiedOr(MINIFIED_COMPONENT_SCRIPT, COMPONENT_SCRIPT_SOURCE));
