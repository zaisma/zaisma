import { createHash } from "node:crypto";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { MINIFIED_COMPONENT_SCRIPT } from "../generated/components-script.generated.ts";
import { COMPONENTS } from "./component.ts";
import { BACKDROP_SCRIPT, COLOR_PICKER_SCRIPT, GLASS_SCRIPT, TOKEN_STYLES, WATCH_SCRIPT } from "./foundations.ts";
import { BUSY_SCRIPT, RUNNER_SCRIPT } from "./actions.ts";
import { BIRTHDAY_SCRIPT, COPY_SCRIPT, DATE_TIME_SCRIPT, FIELD_SCRIPT, FILE_DROP_SCRIPT, LONG_FIELD_SCRIPT, PIN_FIELD_SCRIPT, SELECT_SCRIPT, SLIDER_SCRIPT, SWITCH_SCRIPT } from "./inputs.ts";
import { COMPACT_SCRIPT, FILTER_MENU_SCRIPT, LOAD_MORE_SCRIPT, RAIL_SCRIPT, ROW_SCRIPT, SCROLL_FADE_SCRIPT } from "./navigation.ts";
import { ROW_LAYOUT_SCRIPT } from "./layout.ts";
import { DROPDOWN_SCRIPT, NOTICE_SCRIPT, PLACE_SCRIPT, SHEET_SCRIPT, STARTED_LOW_SCRIPT, STEP_FLOW_SCRIPT } from "./panes.ts";
import { CHART_SCRIPT } from "./data.ts";
import { PLAYING_CARD_SCRIPT } from "./playing.ts";
import { CONFIRM_ITS_YOU_SCRIPT } from "./confirm-its-you.ts";
import { FOLD_ROWS_SCRIPT } from "./reading.ts";
import "./stripe-frame.ts";
// The layout components register in layout-gallery.ts, whose examples use every other group.
import "./layout-gallery.ts";
// Components pages still to build need: words to read and the ways through them, and people and what they write.
import "./reading.ts";
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

/** The tokens, then every component's CSS in gallery order. */
export const COMPONENT_STYLES = (): string => TOKEN_STYLES + COMPONENTS().map((each) => each.styles).join("");

/** The components' script, readable: what scripts/minify-components.mjs minifies. */
export const COMPONENT_SCRIPT_SOURCE = WATCH_SCRIPT + GLASS_SCRIPT + BACKDROP_SCRIPT + COLOR_PICKER_SCRIPT + FIELD_SCRIPT + PIN_FIELD_SCRIPT + SWITCH_SCRIPT + RUNNER_SCRIPT + BUSY_SCRIPT + BIRTHDAY_SCRIPT + DATE_TIME_SCRIPT + FILE_DROP_SCRIPT + COPY_SCRIPT + CHART_SCRIPT + LONG_FIELD_SCRIPT + SLIDER_SCRIPT + PLACE_SCRIPT + SELECT_SCRIPT + DROPDOWN_SCRIPT + FILTER_MENU_SCRIPT + SHEET_SCRIPT + STARTED_LOW_SCRIPT + NOTICE_SCRIPT + STEP_FLOW_SCRIPT + CONFIRM_ITS_YOU_SCRIPT + RAIL_SCRIPT + ROW_SCRIPT + ROW_LAYOUT_SCRIPT + SCROLL_FADE_SCRIPT + COMPACT_SCRIPT + LOAD_MORE_SCRIPT + PLAYING_CARD_SCRIPT + FOLD_ROWS_SCRIPT;

/**
 * The script pages load: the minified one, unless it was made from an older source (a script changed and npm run components:minify wasn't
 * run), when the readable one is served instead, so a page never gets a stale script.
 */
export const COMPONENT_SCRIPT: PageScript = pageScript(
  "components",
  MINIFIED_COMPONENT_SCRIPT.sourceSha256 === createHash("sha256").update(COMPONENT_SCRIPT_SOURCE).digest("hex") ? MINIFIED_COMPONENT_SCRIPT.minifiedText : COMPONENT_SCRIPT_SOURCE,
);
