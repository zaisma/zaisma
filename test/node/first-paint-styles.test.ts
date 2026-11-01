import { describe, expect, it } from "vitest";
import { FIRST_PAINT_CLASSES, FIRST_PAINT_CLASS_PREFIXES, classesOf, firstPaintStyles, shownMarkup } from "../../apps/site/src/first-paint-styles.ts";
import { pageStyle } from "../../apps/site/src/page-styles.ts";

/** A page's own styles (first-paint-styles.ts): the rules its markup could match, from a sheet made for the test. */
let sheetNumber = 0;
const stylesFor = (css: string, markup: string): string => firstPaintStyles([pageStyle(`first-paint-test-${"abcdefghij"[sheetNumber++]}`, () => css)], markup);

describe("a page's own styles", () => {
  it("keeps the rules its classes match, and only the selectors of a list that could", () => {
    const shown = stylesFor(".pane { color: red; } .menu { color: blue; } .pane, .menu > a { margin: 0; }", '<div class="pane"></div>');
    expect(shown).toContain(".pane{color: red}");
    expect(shown).not.toContain(".menu");
    expect(shown).toContain(".pane{margin: 0}");
  });

  it("asks nothing for a class inside :not(), :is() or :has(), and keeps @media, @supports and @font-face", () => {
    const shown = stylesFor(
      ".pane:not(.is-open) { opacity: 1; } .row:has(.missing) { gap: 1px; } @media (max-width: 600px) { .pane { padding: 0; } .menu { padding: 0; } } @supports (display: grid) { .gone { display: grid; } } @font-face { font-family: X; src: local(Arial); }",
      '<div class="pane"></div><div class="row"></div>',
    );
    expect(shown).toContain(".pane:not(.is-open){opacity: 1}");
    expect(shown).toContain(".row:has(.missing){gap: 1px}");
    expect(shown).toContain("@media (max-width: 600px){.pane{padding: 0}}");
    expect(shown).not.toContain("@supports");
    expect(shown).toContain("@font-face{");
  });

  it("drops custom properties nothing reads, following what a read one reads", () => {
    const shown = stylesFor(":root { --gap: 4px; --used: var(--gap); --unused: 9px; --chained: 1px; } .pane { padding: var(--used); }", '<div class="pane"></div>');
    expect(shown).toContain("--gap: 4px");
    expect(shown).toContain("--used: var(--gap)");
    expect(shown).not.toContain("--unused");
    expect(shown).not.toContain("--chained");
    // Read in the markup's own style, it's kept.
    expect(stylesFor(":root { --chained: 1px; }", '<div style="margin: var(--chained)"></div>')).toContain("--chained: 1px");
  });

  it("keeps @keyframes and @property only when what's kept names them", () => {
    const css = "@keyframes arrive { from { opacity: 0; } } @keyframes leave { to { opacity: 0; } } @property --tint { syntax: '<color>'; inherits: false; initial-value: red; } .pane { animation: arrive 1s; color: var(--tint); }";
    const shown = stylesFor(css, '<div class="pane"></div>');
    expect(shown).toContain("@keyframes arrive");
    expect(shown).not.toContain("@keyframes leave");
    expect(shown).toContain("@property --tint");
  });

  it("drops a selector that runs further down from a holder than the page's own reach", () => {
    const css = ".pane > * > * { margin: 1px; } .pane > * > * > * > * { margin: 2px; }";
    const shown = stylesFor(css, '<div class="pane"><div><p>Words</p></div></div>');
    expect(shown).toContain("margin: 1px");
    expect(shown).not.toContain("margin: 2px");
  });

  it("leaves out what starts closed: a sheet's dialog, a popover, a template", () => {
    const { classes } = classesOf('<div class="shown"></div><dialog class="sheet"><p class="inside"></p></dialog><dialog open class="open-sheet"></dialog><div popover class="menu"></div><template><b class="later"></b></template>');
    expect([...classes].sort()).toEqual(["open-sheet", "shown"]);
    expect(shownMarkup('<p>a</p><dialog id="x"><dialog><i>b</i></dialog></dialog><p>c</p><template><i>d</i></template>')).toBe("<p>a</p><p>c</p>");
  });

  it("counts the classes the first-paint script adds, as its calls and its markup name them", () => {
    for (const name of ["is-wrapped", "fits", "dense", "bevel", "cut-band", "waiting-glint", "is-compact"]) expect(FIRST_PAINT_CLASSES.has(name), name).toBe(true);
    // A class it only looks for is the page's own.
    expect(FIRST_PAINT_CLASSES.has("layout-row")).toBe(false);
    expect(FIRST_PAINT_CLASS_PREFIXES).toContain("step-");
    expect(stylesFor(".edge .caustic.step-2 { opacity: 1; }", '<div class="pane"></div>')).toContain(".caustic.step-2");
  });

  it("works a page kind out once", () => {
    const style = pageStyle("first-paint-test-memo", () => ".pane { color: red; }");
    const first = firstPaintStyles([style], '<div class="pane"></div>');
    expect(firstPaintStyles([style], '<div class="pane">other words</div>')).toBe(first);
  });
});
