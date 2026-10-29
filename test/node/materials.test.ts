import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../../apps/site/src/components/index.ts";

/*
 * Everything in the gallery is built of the materials (docs/DESIGN.md, Materials; apps/site/src/components/materials.ts). Only the materials
 * themselves (the components on Panes › Materials) and the layout components give anything a look, room, a size, a scroll or a timing: a
 * component puts them together and says nothing of its own about them. So a component's styles never set a background, a shadow, a
 * backdrop, a border, padding, a height or a scroll; never write a color (a token says it, so it turns with light and dark and takes a
 * game's tint); and never time a change or a loop but with the motion tokens.
 */

/** What may give itself a look: the materials, and the layout components that place them. */
const isMaterialOrLayout = (component: { group: string; subgroup?: string }) => component.group === "layout" || (component.group === "panes" && component.subgroup === "materials");

const OWN_LOOK = /^(background(-[a-z]+)?|box-shadow|-webkit-backdrop-filter|backdrop-filter|border(-[a-z]+)*|padding(-[a-z]+)*|height|min-height|max-height|overflow(-[xy])?)$/;
/** Taking a look away is never a look of its own. */
const RESET = /^(none|0|0px|auto|visible|transparent|inherit|unset|initial)$/;
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
  if (RAW_COLOR.test(value)) return "a color of its own";
  if (property.startsWith("--")) return undefined;
  if (/^(transition|animation)(-[a-z]+)?$/.test(property) && OWN_TIMING.test(value)) return "a timing of its own";
  if (property === "filter" && /drop-shadow\(/.test(value)) return "a shadow of its own";
  if (!OWN_LOOK.test(property) || RESET.test(value)) return undefined;
  if (/height$/.test(property) && PICTURE_OR_ICON.test(selector.split(",").pop()!.trim())) return undefined;
  return /^(height|min-height|max-height)$/.test(property) ? "a size of its own" : /^overflow/.test(property) ? "a scroll of its own" : /^padding/.test(property) ? "room of its own" : "a look of its own";
}

describe("materials", () => {
  it("builds every component of the materials: none gives itself a look, room, a size, a scroll, a color or a timing", () => {
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
