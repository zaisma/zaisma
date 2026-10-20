import { pageScript, type PageScript } from "../page-scripts.ts";
import { COMPONENTS } from "./component.ts";
import { GLASS_SCRIPT, TOKEN_STYLES } from "./foundations.ts";
import { RUNNER_SCRIPT } from "./actions.ts";
import { BIRTHDAY_SCRIPT, FIELD_SCRIPT, SWITCH_SCRIPT } from "./inputs.ts";
import { RAIL_SCRIPT, ROW_SCRIPT } from "./navigation.ts";
import { MENU_SCRIPT } from "./panes.ts";
import "./data.ts";
import { SCENE_ANCHOR_SCRIPT, SCENE_STYLES } from "./scene.ts";

/*
 * The components, bundled for the pages: importing this module defines every one of them (each group file
 * registers its own as it loads), so COMPONENTS() is complete before the first request. Pages put
 * COMPONENT_STYLES() in their <style> and COMPONENT_SCRIPT (and HEADER_SCRIPT where the header is) in their scripts.
 */

export { COMPONENTS, componentBySlug } from "./component.ts";
export { HEADER_SCRIPT } from "./navigation.ts";

/** The tokens, then every component's CSS in gallery order, then the scene mode. */
export const COMPONENT_STYLES = (): string => TOKEN_STYLES + COMPONENTS().map((each) => each.styles).join("") + SCENE_STYLES;

export const COMPONENT_SCRIPT: PageScript = pageScript("components", GLASS_SCRIPT + FIELD_SCRIPT + SWITCH_SCRIPT + RUNNER_SCRIPT + BIRTHDAY_SCRIPT + MENU_SCRIPT + RAIL_SCRIPT + ROW_SCRIPT + SCENE_ANCHOR_SCRIPT);
