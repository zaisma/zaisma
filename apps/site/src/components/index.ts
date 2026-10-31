import { createHash } from "node:crypto";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { MINIFIED_COMPONENT_SCRIPT } from "../generated/components-script.generated.ts";
import { COMPONENTS } from "./component.ts";
import { BACKDROP_SCRIPT, EDGE_LIGHT_SCRIPT, GLASS_SCRIPT, TOKEN_STYLES, WATCH_SCRIPT } from "./foundations.ts";
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
// A game's page while it plays: the bar beside the game and the cards over it.
import "./playing.ts";
// The city defines its gallery entry as it loads; its script is its own (CITY_SCRIPT), loaded only by the pages on it.
import "./city.ts";

/*
 * The components, bundled for the pages: importing this module defines every one of them (each group file
 * registers its own as it loads), so COMPONENTS() is complete before the first request. Pages put
 * COMPONENT_STYLES() in their <style> and COMPONENT_SCRIPT (and HEADER_SCRIPT where the header is) in their scripts.
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

/** The components' script, readable: what scripts/minify-components.mjs minifies. */
export const COMPONENT_SCRIPT_SOURCE = WATCH_SCRIPT + GLASS_SCRIPT + MATERIAL_SCRIPT + PLACE_SCRIPT + EDGE_LIGHT_SCRIPT + BACKDROP_SCRIPT + FIELD_SCRIPT + PIN_FIELD_SCRIPT + SWITCH_SCRIPT + RUNNER_SCRIPT + BUSY_SCRIPT + TOGGLE_SCRIPT + CHECK_SCRIPT + CHOICE_CARDS_SCRIPT + WHEEL_SCRIPT + FILE_DROP_SCRIPT + COPY_SCRIPT + CHART_SCRIPT + QR_CODE_SCRIPT + LONG_FIELD_SCRIPT + SLIDER_SCRIPT + COLOR_FIELD_SCRIPT + SELECT_SCRIPT + SEARCH_SCRIPT + DROPDOWN_SCRIPT + FILTER_MENU_SCRIPT + LAYERS_SCRIPT + STARTED_LOW_SCRIPT + STEP_FLOW_SCRIPT + CONFIRM_ITS_YOU_SCRIPT + RAIL_SCRIPT + ROW_SCRIPT + ROW_LAYOUT_SCRIPT + SCROLL_FADE_SCRIPT + SIDEBAR_SCRIPT + COMPACT_SCRIPT + LOAD_MORE_SCRIPT + PLAYING_CARD_SCRIPT + LIST_ROW_FOLD_SCRIPT;

/**
 * The script pages load: the minified one, unless it was made from an older source (a script changed and npm run components:minify wasn't
 * run), when the readable one is served instead, so a page never gets a stale script.
 */
export const COMPONENT_SCRIPT: PageScript = pageScript(
  "components",
  MINIFIED_COMPONENT_SCRIPT.sourceSha256 === createHash("sha256").update(COMPONENT_SCRIPT_SOURCE).digest("hex") ? MINIFIED_COMPONENT_SCRIPT.minifiedText : COMPONENT_SCRIPT_SOURCE,
);
