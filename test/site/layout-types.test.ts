import { describe, expect, it } from "vitest";
import { cutButton, runButton } from "../../apps/site/src/components/actions.ts";
import { grid, paneParts, row, stack, type LayoutItem } from "../../apps/site/src/components/layout.ts";
import { html } from "../../apps/site/src/markup.ts";

/**
 * Wrong layouts don't build (docs/DECISIONS.md, "A page is only gallery components, layout included."): each @ts-expect-error below is a
 * layout the compiler refuses, and npm run typecheck fails if one ever builds. The test only runs the right ones.
 */
describe("layouts that don't build", () => {
  it("refuses a paragraph as a control, two controls in a corner, a free width and a control given as words", () => {
    const paragraph = html`<p>Read this</p>`;
    // @ts-expect-error A paragraph isn't a control: only a control's own function makes one.
    const paragraphAsControl: LayoutItem = { kind: "control", markup: paragraph };
    // @ts-expect-error A corner takes exactly one control, not two put together.
    paneParts({ head: { words: html`<h2>Rooms</h2>`, end: html`${cutButton("Refresh")}${cutButton("Join")}` }, body: paragraph });
    // @ts-expect-error A row's widths are named, never a number.
    row({ widths: "200px", items: [] });
    // @ts-expect-error A grid's cells are a named size.
    grid({ itemSize: 180, items: [] });
    // @ts-expect-error A control is given as a control, so it's spaced and sized as one.
    const controlAsWords: LayoutItem = { kind: "words", markup: runButton("Play") };
    // @ts-expect-error Nobody passes a gap: the layout picks it.
    stack({ items: [], gap: "8px" });
    expect([paragraphAsControl, controlAsWords].length).toBe(2);
    // The right ones build.
    expect(paneParts({ head: { words: html`<h2>Rooms</h2>`, end: cutButton("Refresh") }, body: stack({ items: [{ kind: "words", markup: paragraph }, { kind: "control", markup: runButton("Play") }] }) }).html).toContain("pane-head-end");
  });
});
