import { describe, expect, it } from "vitest";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { TYPING_BAR_SCRIPT } from "../../apps/site/src/components/fields.ts";
import { LAYERS_SCRIPT } from "../../apps/site/src/components/layers.ts";
import { FILTER_MENU_SCRIPT, SCROLL_FADE_SCRIPT } from "../../apps/site/src/components/navigation.ts";
import { SWITCH_SCRIPT } from "../../apps/site/src/components/switch.ts";

/*
 * Motion the motion sheet (scripts/motion-sheet.mjs) found in the gallery's strips, held at the rules it rests on: a browser shows it only
 * frame by frame, and the sheet runs on the preview. Each rule here failed before its fix.
 */
const styles = COMPONENT_STYLES();
/** Every rule whose selector names one of these, with what it declares. */
function rulesNaming(...names: string[]): { selector: string; body: string }[] {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" })).filter((rule) => names.some((name) => rule.selector.includes(name)));
}

describe("a scroll box's fades", () => {
  it("never take a transition of their own, which would take the place of its component's (a menu's body fading as it closes)", () => {
    const fadeRules = rulesNaming(".scroll-fades", "[data-fades-sideways]");
    expect(fadeRules.length).toBeGreaterThan(0);
    expect(fadeRules.filter((rule) => /(^|;)\s*transition\s*:/.test(rule.body)).map((rule) => rule.selector)).toEqual([]);
  });

  it("ease their edges as an animation of their own, from the frame after a box first fades", () => {
    expect(SCROLL_FADE_SCRIPT).toContain("runs[name] = box.animate(keyframes, { duration: GLIDE_MS");
    expect(SCROLL_FADE_SCRIPT).toContain('setFade(box, "--fade-top", Math.max(0, top)); setFade(box, "--fade-bottom", Math.max(0, bottom));');
    expect(SCROLL_FADE_SCRIPT).toContain('side("more-left", "--fade-left", span.before > 2)');
    expect(SCROLL_FADE_SCRIPT).toContain("row.isSideFadeEased = true;");
  });
});

describe("a Filter menu's step between its ways and a way's choices", () => {
  it("slides the choices it leaves out over the ones it shows, eases its height with the shadow it casts, and holds what's past it inside", () => {
    expect(FILTER_MENU_SCRIPT).toContain('runs.push(was.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(" + -side + "px)", opacity: 0 }]');
    expect(FILTER_MENU_SCRIPT).toContain('runs.push(menu.animate([{ height: fromHeightPx + "px", transform: "translateY(" + shiftPx + "px)" }, { height: toHeightPx + "px", transform: "none" }]');
    expect(FILTER_MENU_SCRIPT).toContain("window.zaismaCast(menu); step.castFrame = requestAnimationFrame(cast);");
    expect(styles).toContain(".floating-pane.filter-menu.is-stepping { overflow: clip; }");
  });
});

describe("a control's icon for each state, and a copy field's tick", () => {
  it("lie in one place and cross-fade as the state changes, never swapping in one frame", () => {
    const pairRules = rulesNaming("[data-shown-when=");
    expect(pairRules.length).toBeGreaterThan(0);
    expect(pairRules.filter((rule) => /display:\s*none|visibility:\s*hidden/.test(rule.body)).map((rule) => rule.selector)).toEqual([]);
    expect(styles).toContain(".ico-pair > .ico { grid-area: 1 / 1; transition: opacity var(--motion-state), color var(--motion-state); }");
    expect(rulesNaming(".well-end-note").filter((rule) => /display:\s*none/.test(rule.body))).toEqual([]);
    expect(styles).toContain(".copy-field.is-copied .carving-end > .tertiary-btn .ico { opacity: 0; }");
  });
});

describe("a rail", () => {
  it("fades in from nothing as it's shown and stays until it has faded as it's hidden, never in one frame", () => {
    expect(rulesNaming(".rail")).toContainEqual(expect.objectContaining({ selector: expect.stringMatching(/(^|\n)\.rail$/), body: expect.stringContaining("transition: opacity var(--motion-arrive), display var(--motion-arrive) allow-discrete;") }));
    expect(styles).toContain(".rail.rail:not(.is-on) { opacity: 0; }");
    expect(styles).toContain("@starting-style { .rail.rail.is-on { opacity: 0; } }");
  });
});

describe("a switch's slab", () => {
  it("eases its size with its place, so moving between tabs of different widths never takes the new width in one frame", () => {
    expect(SWITCH_SCRIPT).toContain("size: blend(from.size, to.size)");
    expect(SWITCH_SCRIPT).not.toMatch(/place\(el, \{ pos: [^}]*size: to\.size/);
  });

  it("slides on the frames' own clock from the first frame after the press, its shape keeping to the same clock", () => {
    expect(SWITCH_SCRIPT).toContain("requestAnimationFrame(function (nowMs) { if (startMs === null) startMs = nowMs; frame(nowMs); })");
    expect(SWITCH_SCRIPT).toContain("startMs = null, id = (el.slideId || 0) + 1");
    expect(SWITCH_SCRIPT).toContain("el.redrawCut({ isFrame: true, progress: t })");
  });

  it("says how long its slide runs while it runs, and stops saying so however the slide ends", () => {
    expect(SWITCH_SCRIPT).toContain('el.setAttribute("data-move-duration-ms", String(Math.round(ms)));');
    expect(SWITCH_SCRIPT.match(/el\.removeAttribute\("data-move-duration-ms"\)/g)).toHaveLength(2);
  });
});

describe("a field in the typing bar, in a sheet", () => {
  it("hides the page only once the veil is whole, at its fade's end, never at a timer that can end a frame sooner", () => {
    expect(TYPING_BAR_SCRIPT).toContain('shown.addEventListener("transitionend", whole);');
    expect(TYPING_BAR_SCRIPT).not.toContain("pendingTimer = setTimeout(under, veilMs());");
  });

  it("falls when the sheet round it closes, the sheet kept shown and its glass at full strength until it has", () => {
    expect(LAYERS_SCRIPT).toContain('sheet.dispatchEvent(new Event("zaisma:sheet-leaving"));');
    expect(TYPING_BAR_SCRIPT).toContain('document.addEventListener("zaisma:sheet-leaving", function (event) { if (held && event.target.contains(held)) drop(); }, true);');
    expect(rulesNaming(".is-typing :has(.is-typing-bar)")[0]?.body).toContain("opacity: 1 !important;");
    expect(rulesNaming(".is-typing dialog:has(.is-typing-bar)")[0]?.body).toContain("display var(--motion-arrive) allow-discrete, overlay var(--motion-arrive) allow-discrete !important");
  });
});
