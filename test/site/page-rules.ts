import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";

/**
 * "A page is only gallery components, layout included. It has no styles of its own" (docs/DECISIONS.md): what a page served by the site
 * may carry, checked on its markup. test/site/design.test.ts holds every page to it, and the tests that render a signed-in page (the
 * connect page, the consent page) check theirs too.
 */

/** Classes a script or a screen reader uses, with no look of their own. */
export const UNSTYLED_HOOKS = new Set<string>([
  "bday-read", // The birthday's spoken summary (and .sr hides it).
  // What a layout's cell holds (layout.ts), which the measuring check reads (scripts/layout-check.mjs); words' cells are styled.
  "is-control", "is-block",
]);

/** A component's own insides, styled for it but never for a page to place things with: a page lays out with layout.ts instead. */
export const NOT_FOR_PAGES = new Set<string>([
  "control-row", // Row's own: a page's things side by side are row().
]);

/** The only style attributes a page carries, each a value a component offers and sets itself, with why. */
export const STYLE_ATTRIBUTE: { pattern: RegExp; why: string }[] = [
  { pattern: /^--h:\d+$/, why: "an account picture's own color, from its name (accountPicture)" },
  { pattern: /^--glass-hue:#[0-9a-f]{6}$/, why: "the page's glass hue (PageSettings, on <html>)" },
  { pattern: /^--swatch:(#[0-9a-fA-F]{3,8}|var\(--clear-swatch\))$/, why: "a color picker's swatch, its color" },
  { pattern: /^--fill:[0-9.]+$/, why: "a slider's fill, the share picked" },
  { pattern: /^width:\d+%$/, why: "a usage meter's fill, the share used" },
  { pattern: /^z-index:1$/, why: "a picture row's +N, over the pictures before it" },
  { pattern: /^width:\d+px$/, why: "a table column's width (TableColumn.widthPx), on its <col>" },
  { pattern: /^--table-min-width:\d+px$/, why: "an even table's least width, its columns' widths together" },
];

/** The page sheets pages may link: the site's and the gallery's, each every component's styles with the shell's or the gallery's. */
export const PAGE_SHEETS = ["site", "design"];

const styledBy = (css: string, name: string) => new RegExp(`\\.${name.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css);

/** What breaks the rule on a page, by its markup: a sheet or style of its own, a style attribute no component sets, a class no component styles. */
export function pageProblems(markup: string): string[] {
  const problems: string[] = [];
  const componentCss = COMPONENT_STYLES();
  if (/<style[\s>]/.test(markup)) problems.push("writes a <style> of its own");
  for (const [, name = ""] of markup.matchAll(/<link rel="stylesheet" href="\/css\/([a-z-]+)\.[0-9a-f]{16}\.css">/g)) if (!PAGE_SHEETS.includes(name)) problems.push(`links a stylesheet of its own: ${name}`);
  const body = markup.replace(/<script[\s\S]*?<\/script>|<template[\s\S]*?<\/template>/g, "");
  for (const [, style = ""] of body.matchAll(/\sstyle="([^"]*)"/g)) {
    for (const declaration of style.split(";").map((each) => each.trim()).filter(Boolean)) {
      if (!STYLE_ATTRIBUTE.some(({ pattern }) => pattern.test(declaration.replace(/\s+/g, "")))) problems.push(`style="${style}" sets ${declaration}, which no component offers`);
    }
  }
  for (const [, list = ""] of body.matchAll(/\sclass="([^"]*)"/g)) {
    for (const name of list.split(/\s+/).filter(Boolean)) {
      if (NOT_FOR_PAGES.has(name)) problems.push(`.${name} is a component's inside, not for a page`);
      else if (!styledBy(componentCss, name) && !UNSTYLED_HOOKS.has(name)) problems.push(`.${name} comes from no component`);
    }
  }
  return [...new Set(problems)];
}
