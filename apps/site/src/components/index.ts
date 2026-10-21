import { pageScript, type PageScript } from "../page-scripts.ts";
import { COMPONENTS } from "./component.ts";
import { BACKDROP_SCRIPT, COLOUR_PICKER_SCRIPT, GLASS_SCRIPT, TOKEN_STYLES } from "./foundations.ts";
import { BUSY_SCRIPT, RUNNER_SCRIPT } from "./actions.ts";
import { BIRTHDAY_SCRIPT, FIELD_SCRIPT, LONG_FIELD_SCRIPT, SLIDER_SCRIPT, SWITCH_SCRIPT } from "./inputs.ts";
import { COMPACT_SCRIPT, LOAD_MORE_SCRIPT, RAIL_SCRIPT, ROW_SCRIPT, SCROLL_FADE_SCRIPT } from "./navigation.ts";
import { DROPDOWN_SCRIPT, NOTICE_SCRIPT, SHEET_SCRIPT } from "./panes.ts";
import "./data.ts";

/*
 * The components, bundled for the pages: importing this module defines every one of them (each group file
 * registers its own as it loads), so COMPONENTS() is complete before the first request. Pages put
 * COMPONENT_STYLES() in their <style> and COMPONENT_SCRIPT (and HEADER_SCRIPT where the header is) in their scripts.
 */

export { COMPONENTS, componentBySlug } from "./component.ts";
export { HEADER_SCRIPT } from "./navigation.ts";

/** The tokens, then every component's CSS in gallery order. */
export const COMPONENT_STYLES = (): string => TOKEN_STYLES + COMPONENTS().map((each) => each.styles).join("");

export const COMPONENT_SCRIPT: PageScript = pageScript("components", GLASS_SCRIPT + BACKDROP_SCRIPT + COLOUR_PICKER_SCRIPT + FIELD_SCRIPT + SWITCH_SCRIPT + RUNNER_SCRIPT + BUSY_SCRIPT + BIRTHDAY_SCRIPT + LONG_FIELD_SCRIPT + SLIDER_SCRIPT + DROPDOWN_SCRIPT + SHEET_SCRIPT + NOTICE_SCRIPT + RAIL_SCRIPT + ROW_SCRIPT + SCROLL_FADE_SCRIPT + COMPACT_SCRIPT + LOAD_MORE_SCRIPT);
