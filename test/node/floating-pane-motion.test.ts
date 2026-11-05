import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../../apps/site/src/components/index.ts";
import { EDGE_LIGHT_SCRIPT } from "../../apps/site/src/components/foundations.ts";
import { PLACE_SCRIPT } from "../../apps/site/src/components/panes.ts";

/*
 * A floating pane comes and goes whole: its glass, what's on it, its edge light and the shadow it casts all fade together and take one move.
 * A browser can only show this frame by frame, so these hold the rules it rests on: the frame-by-frame look is the bench's light box slider.
 */
const paneStyles = COMPONENTS().find((component) => component.slug === "floating-pane")?.styles ?? "";

describe("a floating pane's motion", () => {
  it("fades its edge light with it, which the light's own transition would otherwise replace", () => {
    expect(paneStyles).toMatch(/\.floating-pane > \.edge-light \{ transition: opacity var\(--motion-float\), var\(--edge-light-glide\); \}/);
  });

  it("casts a shadow that fades at its glass's pace, takes its move and stays until they're done", () => {
    expect(paneStyles).toMatch(/\.floating-cast \{ transition: opacity var\(--motion-float\), transform var\(--motion-float\) var\(--ease-glide\), display var\(--motion-float\) allow-discrete; \}/);
    expect(paneStyles).toMatch(/\.floating-cast:is\(\[hidden\], \.is-arriving, \.is-leaving\) \{ opacity: 0; transform: var\(--away-move\); \}/);
    expect(paneStyles).toMatch(/@starting-style \{ \.floating-cast \{ opacity: 0; transform: var\(--away-move\); \} \}/);
  });

  it("gives its shadow the classes that set its move, and starts its shadow going as it goes", () => {
    expect(PLACE_SCRIPT).toContain('["smoke", "is-above", "placed-over", "opens-at-once"]');
    expect(PLACE_SCRIPT).toContain("pane.hidePopover(); window.zaismaCast(pane); }");
  });

  it("stops only an edge light's glide when it first places it, never a fade it's in the middle of", () => {
    expect(EDGE_LIGHT_SCRIPT).not.toContain('light.style.transition = "none"');
  });
});
