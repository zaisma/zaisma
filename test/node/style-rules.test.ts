import { describe, expect, it } from "vitest";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { ICONS } from "../../apps/site/src/components/foundations.ts";
import { SCREEN_QUERIES } from "../../apps/site/src/components/tokens.ts";
import {
  backgroundFadeProblems, bounceProblems, cutShadowProblems, iconCenterProblems, layoutTransitionProblems, roundedCornerProblems, screenQueryProblems,
  spacingProblems, statePopProblems, styleRulesOf,
} from "../site/style-rules.ts";

/*
 * The design rules a scan holds (docs/DESIGN.md, Rules; test/site/style-rules.ts), each run on the real components and on a fixture that
 * breaks it, so a rule that stops catching anything fails here too. What a rule leaves alone is named below, one by one, with its reason;
 * a name the code no longer has fails ("names nothing that's gone").
 */

const CSS = COMPONENT_STYLES();
const RULES = styleRulesOf(CSS);
const rulesOf = (css: string) => styleRulesOf(css);

/** What's round on purpose: a dot or a disc that's a picture, not a piece of glass ("selector"). */
const ROUND_ON_PURPOSE = new Map<string, string>([
  [".glass-strip > i", "the glass demo's shapes behind the glass: what the glass blurs, not a piece of Zaisma's"],
  [".glass-play .sun", "the glass demo's shapes behind the glass: what the glass blurs, not a piece of Zaisma's"],
  [".glass-play .sea", "the glass demo's shapes behind the glass: what the glass blurs, not a piece of Zaisma's"],
  [".glass-play .dot", "the glass demo's shapes behind the glass: what the glass blurs, not a piece of Zaisma's"],
  [".guild-seal", "the guild seal is a round seal, a brand mark (brand/README.md)"],
  [".bench-screen.is-phone > .bench-body", "the Screens bench draws a phone's own rounded corners: the device, not Zaisma"],
  [".bench-screen.is-phone .bench-view::before", "the Screens bench draws a phone's own rounded corners: the device, not Zaisma"],
  [".bench-screen.is-phone .bench-view::after", "the Screens bench draws a phone's island: the device, not Zaisma"],
  [".way-mark.way-google", "Google's own mark, drawn as Google draws it"],
  [".zaisma-button .zaisma-shard > .zaisma-mark", "an 8px dot saying the folded Zaisma button holds something new"],
]);

/** What clips and still casts a shadow on purpose ("selector"). */
const SHADOW_CUT_ON_PURPOSE = new Map<string, string>([
  [".tray-group > .glass.tray-head::after", "a tray's step: its lip's light and the shade it casts run along its foot only, cut before the sheet's bevel (HAND_CUT in design.test.ts)"],
]);

/** What a state changes at once on purpose ("selector | property"). */
const CHANGES_AT_ONCE = new Map<string, string>([
  ['.select-option[aria-selected="true"] > .select-tick | visibility', "the tick marks the pick as the list opens; a pick closes the list, so it never changes while the list shows"],
]);

/** What moves a size or a place on purpose ("selector | property"). */
const MOVES_LAYOUT = new Map<string, string>([
  [".logo > .logo-art | height", "the header slims as the page scrolls, the one size change Motion names, and the logo with it"],
  [".logo > .logo-art | margin", "the header slims as the page scrolls, the one size change Motion names, and the logo with it"],
  [".top | height", "the header slimming, the one size change Motion names"],
  [".top | top", "the header slimming, the one size change Motion names"],
  [".top .find | flex-basis", "the header's search widens into the room its tabs fold away from as the header slims"],
  ['.wheel [role="option"] | font-size', "a wheel's row grows as it turns to the middle, as a drum's row nears the eye"],
  [".tab-switch > .foldable | max-width", "a tab folding away gives its width back, and the tabs beside it close the gap as it goes"],
  [".tab-switch > .foldable | padding", "a tab folding away gives its width back, and the tabs beside it close the gap as it goes"],
  [".tab-switch > .foldable.folded | max-width", "a tab folding away gives its width back, and the tabs beside it close the gap as it goes"],
  [".tab-switch > .foldable.folded | padding", "a tab folding away gives its width back, and the tabs beside it close the gap as it goes"],
  [".groove-fill | width", "a meter's fill runs to its value inside its groove; scaling it would squash its cut ends"],
  [".usage-groove .groove-fill | width", "a meter's fill runs to its value inside its groove; scaling it would squash its cut ends"],
  [".video-level | width", "a meter's fill runs to its value inside its groove; scaling it would squash its cut ends"],
  [".notice | top", "a notice moves up into the place one above it left, in the stack's order"],
  [".list-row-fold::details-content | grid-template-rows", "a fold opens to its own height, which only the layout knows"],
]);

/** Icons drawn off their box's middle on purpose (by name). */
const DRAWN_WITH_A_SET = new Map<string, string>([
  ["speaker", "the speaker's volumes draw its body in one place, so turning the volume never moves it"],
  ["speaker-low", "the speaker's volumes draw its body in one place, so turning the volume never moves it"],
  ["speaker-off", "the speaker's volumes draw its body in one place, so turning the volume never moves it"],
  ["signal-weak", "its bars stand where Signal lost's do, which it turns into in place"],
]);

describe("the style rules", () => {
  it("space everything with the spacing tokens: a gap, padding or margin of its own number fails", () => {
    expect(spacingProblems(".pane-in", "padding: var(--pad-frame); gap: calc(2 * var(--gap-block-block)); margin: 0 auto", new Set())).toEqual([]);
    expect(spacingProblems(".pane-in", "padding: 13px; gap: var(--gap-words-words)", new Set())).toEqual([".pane-in | padding: 13px"]);
    expect(spacingProblems(".pane-in", "padding: 13px", new Set([".pane-in | padding"]))).toEqual([]);
  });

  it("fade no background by itself: a background color with a transition of its own fails, so nothing flashes as the fade ends", () => {
    expect(backgroundFadeProblems(RULES)).toEqual([]);
    expect(backgroundFadeProblems(rulesOf(".chip { transition: background-color var(--motion-state); }"))).toEqual([".chip: transition: background-color var(--motion-state)"]);
    expect(backgroundFadeProblems(rulesOf(".chip { transition: --face-color var(--motion-state); }"))).toEqual([]);
  });

  it("cut corners, never rounded: a border-radius fails but on a dot or a picture named with its reason", () => {
    expect(roundedCornerProblems(RULES, ROUND_ON_PURPOSE)).toEqual([]);
    expect(roundedCornerProblems(rulesOf(".tag { border-radius: 6px; } .row { border-radius: 0; }"), ROUND_ON_PURPOSE)).toEqual([".tag: border-radius: 6px"]);
  });

  it("cast no shadow from a box that's clipped to its cut, which cuts the shadow off square: its holder casts it in the cut's shape", () => {
    expect(cutShadowProblems(RULES, SHADOW_CUT_ON_PURPOSE)).toEqual([]);
    const fixture = `.card { clip-path: var(--cut-shape); } .card { box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3); }
      .well { clip-path: var(--cut-shape); box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1); } .slab { box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); }`;
    expect(cutShadowProblems(rulesOf(fixture), new Map())).toEqual([".card: box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3)"]);
  });

  it("animate what a state shows, hides or moves: one that changes its opacity, transform or filter with no transition on the piece pops", () => {
    expect(statePopProblems(RULES, CHANGES_AT_ONCE)).toEqual([]);
    expect(statePopProblems(rulesOf(".menu { opacity: 0; } .menu.is-open { opacity: 1; }"), new Map())).toEqual([".menu.is-open | opacity: 1"]);
    expect(statePopProblems(rulesOf(".menu { opacity: 0; transition: opacity var(--motion-arrive); } .menu.is-open { opacity: 1; }"), new Map())).toEqual([]);
    expect(statePopProblems(rulesOf(".thumb:hover { filter: var(--cast); }"), new Map())).toEqual([".thumb:hover | filter: var(--cast)"]);
    expect(statePopProblems(rulesOf(".face, .btn:hover > .face { transform: translateY(-2px); }"), new Map())).toEqual([]);
  });

  it("move no size or place in a transition: only a transform, opacity, a filter, a color or the glass's own, so nothing beside it shifts", () => {
    expect(layoutTransitionProblems(RULES, MOVES_LAYOUT)).toEqual([]);
    expect(layoutTransitionProblems(rulesOf(".switch-slab { transition: width var(--motion-glide), transform var(--motion-glide); }"), new Map())).toEqual([
      ".switch-slab | width: transition: width var(--motion-glide), transform var(--motion-glide)",
    ]);
  });

  it("bounce nowhere: the page, what scrolls sideways and what scrolls in a sheet or a floating pane stop at their ends", () => {
    expect(bounceProblems(RULES)).toEqual([]);
    expect(bounceProblems(rulesOf("html, body { overscroll-behavior: none; }"))).toEqual([
      "a box that scrolls sideways bounces: no * { overscroll-behavior-x: none }",
      "a box that scrolls in a sheet or a floating pane bounces: no :is(dialog, [popover]) .scrolls { overscroll-behavior-y: none }",
    ]);
  });

  it("ask only the named screens: a media query about the screen's size or shape that isn't in SCREEN_QUERIES fails, a container query never", () => {
    expect(screenQueryProblems(RULES, CSS, SCREEN_QUERIES)).toEqual([]);
    const fixture = `@media (max-width: 500px) { .rail { width: 6px; } } @media ${SCREEN_QUERIES.phone} { .rail { width: 4px; } }
      @media (hover: hover) { .rail:hover { opacity: 1; } } @container (max-width: 300px) { .rail { width: 2px; } }`;
    expect(screenQueryProblems(rulesOf(fixture), fixture, SCREEN_QUERIES)).toEqual(["@media (max-width: 500px)"]);
  });

  it("draw every icon in its box's middle, so a control that centers its box centers what shows: one drawn off it fails", () => {
    expect(iconCenterProblems(ICONS as Record<string, string>, DRAWN_WITH_A_SET)).toEqual([]);
    const icons = {
      centered: '<svg viewBox="0 0 20 20"><path d="M4 4h12v12H4z"/></svg>',
      ring: '<svg viewBox="0 0 20 20"><path d="M10 4a6 6 0 1 1 0 12a6 6 0 1 1 0-12z"/></svg>',
      leaning: '<svg viewBox="0 0 20 20"><path d="M6 4h12v12H6z"/></svg>',
      moved: '<svg viewBox="2 0 20 20"><path d="M6 4h12v12H6z"/></svg>',
    };
    expect(iconCenterProblems(icons, new Map())).toEqual(["leaning: drawn 2.00 across and 0.00 down from its box's middle"]);
  });

  it("names nothing that's gone: every piece left alone above is still in the components", () => {
    const selectors = new Set(RULES.map((rule) => rule.selector));
    const gone = [...ROUND_ON_PURPOSE.keys(), ...SHADOW_CUT_ON_PURPOSE.keys(), ...[...CHANGES_AT_ONCE.keys(), ...MOVES_LAYOUT.keys()].map((key) => key.split(" | ")[0]!)]
      .filter((selector) => !selectors.has(selector));
    expect(gone).toEqual([]);
    expect([...DRAWN_WITH_A_SET.keys()].filter((name) => !(name in ICONS))).toEqual([]);
  });
});
