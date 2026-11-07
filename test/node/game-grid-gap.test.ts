import { describe, expect, it } from "vitest";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { GLASS_SCRIPT } from "../../apps/site/src/components/glass-script.ts";
import { gameGrid } from "../../apps/site/src/components/panes.ts";
import { html } from "../../apps/site/src/html.ts";

const cards = Array.from({ length: 4 }, (_, cardIndex) => ({ kind: "block" as const, markup: html`<div class="cover">${cardIndex}</div>` }));
const whenEmpty = html`<p>None</p>`;

/** The wrapper a Game grid puts round its grid for each way it lays its cards: none, one line, a lead cell. */
const wrapperClassesOf = (markup: string): string | null => {
  const wrapper = /<div class="carving game-grid[^"]*"[^>]*>(?:\s*<svg[\s\S]*?<\/svg>)?\s*<div class="([a-z-]+)"/.exec(markup)?.[1];
  return wrapper && wrapper !== "layout-grid" && !wrapper.startsWith("layout-grid ") ? wrapper : null;
};

describe("Game grid", () => {
  it("keeps the frame gap between its cards and cuts their corners whatever wraps its grid", () => {
    const layouts = [
      gameGrid({ items: cards, whenEmpty }),
      gameGrid({ items: cards, whenEmpty, isAllOnOneLine: true }),
      gameGrid({ items: cards, whenEmpty, hasLeadCell: true, isAtLeastTwoAcross: true }),
    ].map((markup) => wrapperClassesOf(String(markup)));
    const wrappers = layouts.filter((wrapper): wrapper is string => wrapper !== null);
    expect(wrappers).toEqual(expect.arrayContaining(["grid-one-line", "grid-lead-cell"]));
    const gapRule = /\.carving\.game-grid > \.layout-grid,[^{]*\{ gap: var\(--pad-frame\)/.exec(COMPONENT_STYLES())?.[0] ?? "";
    const missingGap = wrappers.filter((wrapper) => !gapRule.includes(`.${wrapper}`));
    const missingCut = wrappers.filter((wrapper) => !GLASS_SCRIPT.includes(`[data-cut-line] > .${wrapper} > .layout-grid`));
    expect({ missingGap, missingCut }).toEqual({ missingGap: [], missingCut: [] });
  });
});
