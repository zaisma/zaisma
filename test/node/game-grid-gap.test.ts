import { describe, expect, it } from "vitest";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { GLASS_SCRIPT } from "../../apps/site/src/components/glass-script.ts";
import { gameCard, gameGrid } from "../../apps/site/src/components/panes.ts";
import { html } from "../../apps/site/src/html.ts";
import { stateNote } from "../../apps/site/src/components/data.ts";

const cards = Array.from({ length: 4 }, (_, cardIndex) => ({ kind: "block" as const, markup: html`<div class="cover">${cardIndex}</div>` }));
const whenEmpty = stateNote({ stateKind: "empty", text: "None" });

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

describe("Game card", () => {
  it("keeps one shape wherever it sits: one line on its plate whatever it says, and nothing stretches it", () => {
    const picture = null;
    const menu = { id: "card-more", label: "Kestrel", items: [{ label: "Details", href: "#kestrel" }] };
    const cards = [
      gameCard({ title: "Kestrel", picture, href: "#kestrel", facts: { playerCount: 12, tagWords: "Updated", priceText: "$4.99", friends: [{ username: "Mia" }] } }),
      gameCard({ title: "Kestrel", picture, href: "#kestrel", facts: { reasonText: "Because you played Ashen Crown" }, menu }),
      gameCard({ title: "Kestrel", picture, href: "#kestrel", facts: { playerCount: 12 }, isGone: true, menu }),
    ].map(String);
    const plateLinesOf = (markup: string) => {
      const plate = markup.slice(markup.indexOf('<div class="cover-plate'));
      const inside = plate.slice(plate.indexOf(">") + 1);
      return (inside.match(/^<div class="cover-meta[^"]*">/) ? 1 : 0) + (inside.includes("cover-reason") ? 1 : 0);
    };
    expect(cards.map(plateLinesOf)).toEqual([1, 1, 1]);
    const styles = COMPONENT_STYLES();
    expect(styles).not.toMatch(/\.grid-cell > \.cover \{[^}]*height: 100%/);
    expect(styles).toMatch(/\.layout-track > \.cover \{ align-self: flex-start; \}/);
  });
});
