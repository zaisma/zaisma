import { createHash } from "node:crypto";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { MINIFIED_COMPONENT_SCRIPT } from "../generated/components-script.generated.ts";
import { COMPONENTS } from "./component.ts";
import { BACKDROP_SCRIPT, COLOR_PICKER_SCRIPT, GLASS_SCRIPT, TOKEN_STYLES, WATCH_SCRIPT } from "./foundations.ts";
import { BUSY_SCRIPT, RUNNER_SCRIPT } from "./actions.ts";
import { BIRTHDAY_SCRIPT, COPY_SCRIPT, DATE_TIME_SCRIPT, FIELD_SCRIPT, FILE_DROP_SCRIPT, LONG_FIELD_SCRIPT, SELECT_SCRIPT, SLIDER_SCRIPT, SWITCH_SCRIPT } from "./inputs.ts";
import { COMPACT_SCRIPT, LOAD_MORE_SCRIPT, RAIL_SCRIPT, ROW_SCRIPT, SCROLL_FADE_SCRIPT } from "./navigation.ts";
import { DROPDOWN_SCRIPT, NOTICE_SCRIPT, SHEET_SCRIPT, STEP_FLOW_SCRIPT } from "./panes.ts";
import { CHART_SCRIPT } from "./data.ts";
// The layout components register in layout-gallery.ts, whose examples use every other group.
import "./layout-gallery.ts";
// The city defines its gallery entry as it loads; its script is its own (CITY_SCRIPT), loaded only by the pages on it.
import "./city.ts";

/*
 * The components, bundled for the pages: importing this module defines every one of them (each group file
 * registers its own as it loads), so COMPONENTS() is complete before the first request. Pages put
 * COMPONENT_STYLES() in their <style> and COMPONENT_SCRIPT (and HEADER_SCRIPT where the header is) in their scripts.
 */

export { COMPONENTS, COMPONENT_GROUPS, componentBySlug } from "./component.ts";
export { HEADER_SCRIPT } from "./navigation.ts";
export { grid, paneParts, row, split, stack, track, type LayoutControl, type LayoutItem } from "./layout.ts";

/** The tokens, then every component's CSS in gallery order. */
export const COMPONENT_STYLES = (): string => TOKEN_STYLES + COMPONENTS().map((each) => each.styles).join("");

/** The components' script, readable: what scripts/minify-components.mjs minifies. */
export const COMPONENT_SCRIPT_SOURCE = WATCH_SCRIPT + GLASS_SCRIPT + BACKDROP_SCRIPT + COLOR_PICKER_SCRIPT + FIELD_SCRIPT + SWITCH_SCRIPT + RUNNER_SCRIPT + BUSY_SCRIPT + BIRTHDAY_SCRIPT + DATE_TIME_SCRIPT + FILE_DROP_SCRIPT + COPY_SCRIPT + CHART_SCRIPT + LONG_FIELD_SCRIPT + SLIDER_SCRIPT + SELECT_SCRIPT + DROPDOWN_SCRIPT + SHEET_SCRIPT + NOTICE_SCRIPT + STEP_FLOW_SCRIPT + RAIL_SCRIPT + ROW_SCRIPT + SCROLL_FADE_SCRIPT + COMPACT_SCRIPT + LOAD_MORE_SCRIPT;

/**
 * The script pages load: the minified one, unless it was made from an older source (a script changed and npm run components:minify wasn't
 * run), when the readable one is served instead, so a page never gets a stale script.
 */
export const COMPONENT_SCRIPT: PageScript = pageScript(
  "components",
  MINIFIED_COMPONENT_SCRIPT.sourceSha256 === createHash("sha256").update(COMPONENT_SCRIPT_SOURCE).digest("hex") ? MINIFIED_COMPONENT_SCRIPT.minifiedText : COMPONENT_SCRIPT_SOURCE,
);
