import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../../apps/site/src/components/index.ts";

/*
 * Everything in the gallery is built of the materials (docs/DESIGN.md, Materials; apps/site/src/components/materials.ts). Only the materials
 * themselves (the components on Panes › Materials) and the layout components give anything a look, room, a size, a scroll or a timing: a
 * component puts them together and says nothing of its own about them. So a component's styles never set a background, a shadow, a
 * backdrop, a border, padding, a height or a scroll; never space its parts with the spacing tokens (a layout or a material's margin does:
 * layout.ts's stack and row, words-margin); never write a color (a token says it, so it turns with light and dark and takes a
 * game's tint); and never time a change or a loop but with the motion tokens.
 */

/** What may give itself a look: the materials, and the layout components that place them. */
const isMaterialOrLayout = (component: { group: string; subgroup?: string }) => component.group === "layout" || (component.group === "panes" && component.subgroup === "materials");

const OWN_LOOK = /^(background(-[a-z]+)?|box-shadow|-webkit-backdrop-filter|backdrop-filter|border(-[a-z]+)*|padding(-[a-z]+)*|height|min-height|max-height|overflow(-[xy])?)$/;
/** Taking a look away is never a look of its own, and filling what holds it is never a size of its own. */
const RESET = /^(none|0|0px|auto|visible|transparent|inherit|unset|initial|100%)$/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const OWN_TIMING = /(?<![\w.-])(?!0s\b)\d*\.?\d+m?s\b|cubic-bezier\(|steps\(/;
/** Pictures and icons are sized, not built: a picture's or an icon's own height is its size. */
const PICTURE_OR_ICON = /(^|[\s>+~(])(img|svg|video|canvas|iframe|picture|\.ico)(\.[\w-]+|:[\w-]+(\([^)]*\))?)*\)?$/;

/**
 * The few that aren't made of the materials, each with its reason: "selector | property". A picture's own colors, a brand's marks, the
 * gallery's demos of what glass does, and things drawn rather than built.
 */
const NOT_MADE_OF_MATERIALS = new Map<string, string>([
  // A fold row's words keep the words margin at the pane's top and foot, where a flush row has no edge of its own to keep it.
  [".fold-row:first-child > .fold-row-head | padding-top", "the words margin at the pane's top"],
  [".fold-row:last-child:not([open]) > .fold-row-head | padding-bottom", "the words margin at the pane's foot"],
  // A sheet's tabs are cut from the sheet's own glass, their row drawn as one outline that runs on into the sheet.
  [".sheet-tab-row | --tab-shadow", "the shade under a tab that isn't chosen, drawn into the sheet's outline"],
  [".sheet-tab-scroll | overflow-y", "the tab row scrolls across only"],
  [".sheet-tab-track | height", "the tab row is a regular control's height, its outline drawn to it"],
  [".sheet-tab-outline | height", "the drawn outline fills the tab row"],
  [".sheet-tab-button | padding", "a tab's words clear its slanted sides"],
  [".sheet-tab-end | padding", "the sheet's Close sits in the tab row's end, centered on a regular control's height"],
  // A banner narrower than its button and Close side by side: its words take the whole width, Close beside their first line.
  [".banner-icon | height", "the icon sits on the words' first line"],
  [".banner-in:not(.has-close) > .banner-words | padding-block-start", "narrow, with no Close, its words keep the margin at its top"],
  [".banner-in.has-close .banner-text::before | height", "narrow, its words make room for Close beside their first line"],
  // A way in's own color, its brand's, mixed into its slab; and a mark that may be one color.
  [".cut-btn[data-tint=\"plain\"] > .face | --way", "Google's plain white or black"],
  [".cut-btn[data-tint=\"blue\"] > .face | --way", "a way in's own blue"],
  [".cut-btn[data-tint=\"indigo\"] > .face | --way", "Discord's indigo"],
  [".cut-btn[data-tint=\"black\"] > .face | --way", "a way in's own black"],
  [".way-mark .one-color path | fill", "Discord's mark in its own color"],
  [".way-mark.way-google | padding", "Google's G on smoked glass sits on a white disc a little larger than it, as Google asks"],
  [".way-mark.way-google | background", "the white disc, only on smoked glass (--brand-mark-backing)"],
  [".way-mark.way-google | border-radius", "the disc is round"],
  // A field's drawn and hidden parts.
  [".pin-box:has(> input:not(:placeholder-shown))::after | height", "a digit typed in a PIN shows as a dot, 14px across"],
  [".pin-box:has(> input:not(:placeholder-shown))::after | border-radius", "the dot is round"],
  [".pin-box:has(> input:not(:placeholder-shown))::after | background", "the dot is drawn in the words' color"],
  [".find-finish | overflow", "the finish a search offers ends where the field's end controls begin"],
  [".find-game > img | background", "a game's picture shows the carving's face while it loads"],
  [".select-sizes | overflow", "the hidden list of choices that holds a select as wide as its longest, at no height"],
  [".slider-input::-webkit-slider-thumb | height", "the system's own thumb, unseen, is the drawn thumb's size, so a press lands where it shows"],
  [".slider-input::-moz-range-thumb | height", "the system's own thumb, unseen, is the drawn thumb's size, so a press lands where it shows"],
  [".copy-field.is-masked:not(.is-code) .copy-field-text | padding", "a blurred secret's blur reaches past its words, inside its own clip"],
  [".tab-switch > .foldable | overflow", "a tab folding away narrows to nothing, its words cut as it goes"],
  // A wheel turns by scrolling inside its groove, three rows tall, the picked one snapped to the middle.
  [".wheel-channel | height", "three rows: the picked one in the middle, one above and one below"],
  [".wheel | overflow-y", "the wheel turns by scrolling inside its groove"],
  [".wheel | padding", "a row's room above the first and below the last, so either can come to the middle"],
  [".wheel [role=\"option\"]::after | overflow", "the label again in bold, unseen, holding the row as wide as when it's picked"],
  [".field input:-webkit-autofill | transition", "the browser's autofill color held off for good, so a filled field keeps the carving's face"],
  // A color field shows the color itself: the color picked, the square of hues and strengths, the brightness ramp.
  [".color-chip | background", "the color picked, in the field"],
  [".color-swatch | background", "the color picked, in the pane"],
  [".color-swatch | min-height", "the color picked shows at least a strip, however little room the column leaves"],
  [".color-square-light | background", "the square of hues across and strengths down"],
  [".color-square-light::after | background", "the square dimmed by the brightness"],
  [".color-side .groove | background", "the brightness slider's groove runs from black to the full color"],
  [".color-chip | margin-block", "the color sits a part's gap in from the field's top and foot, as in the picked color's carving"],
  // A file drop's picked files.
  [".file-drop-preview::before | background", "the picked file's own picture, on the carving's face"],
  [".file-drop-view | max-height", "the picture at its own size, made smaller only where the screen is"],
  [".file-drop-row.is-sending | padding-bottom", "room at its foot for the groove that shows how much has gone"],
  // A card's brand mark, a picture of its own size.
  [".card-row-mark > .card-brand | height", "a card brand's mark is 32 by 20"],
  [".card-row-mark > .card-brand | background", "the mark fits its box"],
  // Named caps (materials.ts, Caps and scrolls).
  [".sheet:not(.in-place) .store-picture | max-height", "a store panel's picture is shorter on a short screen, so Buy keeps its room"],
  [".stripe-frame | height", "as tall as what Stripe draws in it, which its script says"],
  [".stripe-frame.is-covering | height", "over the whole window while a bank asks the player to confirm"],
]);

/** Every declaration in every component's styles: its component, its selector (the last in a list of several), its property and value. */
function declarations() {
  const found: { slug: string; selector: string; property: string; value: string; isMaterial: boolean }[] = [];
  for (const component of COMPONENTS()) {
    const styles = component.styles.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selectors = "", block = ""] of styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = selectors.trim().split("\n").pop()!.trim();
      for (const declaration of block.split(";")) {
        const colonIndex = declaration.indexOf(":");
        if (colonIndex < 0) continue;
        found.push({ slug: component.slug, selector, property: declaration.slice(0, colonIndex).trim(), value: declaration.slice(colonIndex + 1).trim(), isMaterial: isMaterialOrLayout(component) });
      }
    }
  }
  return found;
}

/** What a declaration does that only a material may: undefined when it's the component's to say. */
function ownLookOf(property: string, value: string, selector: string): string | undefined {
  // A mask is how much of something shows, not a color: its black is only "all of it".
  if (/^(-webkit-)?mask(-image)?$/.test(property)) return undefined;
  // A picture drawn into a box (a card brand's mark) is the picture's own, colors and all.
  if (property === "background-image" && /^url\(/.test(value)) return undefined;
  if (RAW_COLOR.test(value)) return "a color of its own";
  if (property.startsWith("--")) return undefined;
  if (/^(transition|animation)(-[a-z]+)?$/.test(property) && OWN_TIMING.test(value)) return "a timing of its own";
  if (property === "filter" && /drop-shadow\(/.test(value)) return "a shadow of its own";
  if (/^margin/.test(property) && /var\(--(gap|pad)-/.test(value)) return "spacing of its own";
  if (!OWN_LOOK.test(property) || RESET.test(value)) return undefined;
  if (/height$/.test(property) && PICTURE_OR_ICON.test(selector.split(",").pop()!.trim())) return undefined;
  return /^(height|min-height|max-height)$/.test(property) ? "a size of its own" : /^overflow/.test(property) ? "a scroll of its own" : /^padding/.test(property) ? "room of its own" : "a look of its own";
}

describe("materials", () => {
  it("builds every component of the materials: none gives itself a look, room, spacing, a size, a scroll, a color or a timing", () => {
    const problems: string[] = [];
    for (const { slug, selector, property, value, isMaterial } of declarations()) {
      if (isMaterial) continue;
      const own = ownLookOf(property, value, selector);
      if (own && !NOT_MADE_OF_MATERIALS.has(`${selector} | ${property}`)) problems.push(`${slug}: ${selector} { ${property}: ${value} }: ${own}`);
    }
    expect(problems).toEqual([]);
  });

  it("names nothing in NOT_MADE_OF_MATERIALS that's gone", () => {
    const present = new Set(declarations().map(({ selector, property }) => `${selector} | ${property}`));
    expect([...NOT_MADE_OF_MATERIALS.keys()].filter((entry) => !present.has(entry))).toEqual([]);
  });
});
