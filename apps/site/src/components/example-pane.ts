import type { Raw } from "../markup.ts";
import { glassPane } from "./foundations.ts";

/** A small glass pane around an input, for the gallery's examples: an input is always shown on one. */
export const examplePane = (body: Raw) => glassPane({ paneSize: "small", body });
