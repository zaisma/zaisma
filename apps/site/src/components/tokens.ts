

/** The cut corners of a kind of slab (the cut tokens), as a clip-path, for a frame that isn't glass the edge rule cuts (a demo's box). */
export const cutPolygon = (kind: "pane" | "header" | "menu"): string => {
  const [large, small] = [`var(--${kind}-cut-large)`, `var(--${kind}-cut-small)`];
  return `polygon(0 ${large}, ${large} 0, calc(100% - ${small}) 0, 100% ${small}, 100% calc(100% - ${large}), calc(100% - ${large}) 100%, ${small} 100%, 0 calc(100% - ${small}))`;
};

/** The glass's two kinds, as tokens: light glass with dark words, and smoked glass with light words. */
export const LIGHT_GLASS = `color-scheme: light;
  --ink: #14171C; --ink-2: #3D444E; --muted: #59606A; --line: rgba(20, 23, 28, 0.14);
  --glass: rgba(255, 255, 255, 0.4); --glass-edge: rgba(255, 255, 255, 0.92); --field: rgba(255, 255, 255, 0.62);
  /* The materials (materials.ts): glass comes in four thicknesses, and each material is one of them wherever it's used. */
  --glass-tray: rgba(250, 252, 255, 0.14); --glass-thin: rgba(250, 252, 255, 0.35); --glass-regular: rgba(250, 252, 255, 0.55); --glass-thick: rgba(250, 252, 255, 0.72);
  --glass-tint: var(--glass-regular); --glass-top: var(--glass-regular); --glass-dropdown: var(--glass-thin);
  /* A carving: the glass cut away, a touch darker than the glass round it, shaded under its top edge; pointed at, it catches the light.
     Deep (a groove, a toggle's slot), it's darker and lit along its lower lip. */
  --carving-face: rgba(70, 84, 108, 0.08); --carving-face-pointed: rgba(255, 255, 255, 0.34); --carving-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1);
  --carving-deep-face: rgba(60, 72, 94, 0.2); --carving-deep-shade: inset 0 3px 3px rgba(20, 30, 50, 0.3), inset 0 -1.5px 0 rgba(255, 255, 255, 0.95);
  /* A slab: a raised piece of the same glass, clearer than the pane it stands on and lit from above, casting its shadow onto it. Pointed at,
     it catches more light; pressed, it sinks into the glass. */
  --brand-mark-backing: transparent; --slab-face: rgba(255, 255, 255, 0.5); --slab-face-pointed: rgba(255, 255, 255, 0.76); --slab-face-pressed: rgba(255, 255, 255, 0.24);
  --slab-sheen: linear-gradient(180deg, rgba(255, 255, 255, 0.38), rgba(255, 255, 255, 0) 70%);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.05));
  /* A tray's light: the same sheen at a third of the strength, so the tray stays muted under its pane. */
  --glass-tray-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.02));
  --glass-saturate: 1.8; --edge-hair: rgba(40, 60, 100, 0.1);
  /* A well is carved into the glass: a touch darker than it, so it reads on a pale backdrop too. */
  --well: var(--carving-face); --well-shade: var(--carving-shade);
  --toggle-icon-on: var(--ink);
  /* Orange words (a pointed link): dark enough on light glass to read as easily as the ink. */
  --run-words: var(--run-lo);
  --run-cast: drop-shadow(0 2px 3px rgba(20, 23, 28, 0.18)) drop-shadow(0 8px 14px rgba(20, 23, 28, 0.18)); --run-cast-up: drop-shadow(0 3px 4px rgba(20, 23, 28, 0.16)) drop-shadow(0 12px 20px rgba(20, 23, 28, 0.16)); --run-cast-down: drop-shadow(0 1px 1.5px rgba(20, 23, 28, 0.22)) drop-shadow(0 2px 4px rgba(20, 23, 28, 0.12)); /* On light glass a lit slab casts a shadow, not light: let go, it keeps its landed shadow and eases back as it rises, rather than flaring. */ --run-flare: var(--run-cast-down); --toggle-ring: drop-shadow(1.5px 0 0 var(--run)) drop-shadow(-1.5px 0 0 var(--run)) drop-shadow(0 1.5px 0 var(--run)) drop-shadow(0 -1.5px 0 var(--run)); --toggle-cast: drop-shadow(0 1px 2px rgba(247, 147, 26, 0.4)) drop-shadow(0 6px 10px rgba(20, 23, 28, 0.1));
  /* A pane floating over the page (a list, the wheels): the shadow it casts, outside its edge, so it reads as on top; and the same as a filter. */
  --float-cast: drop-shadow(0 1px 3px rgba(20, 23, 28, 0.08)) drop-shadow(0 6px 16px rgba(20, 23, 28, 0.1));
  --slab: var(--slab-sheen), var(--slab-face); --slab-shade: 0 4px 10px rgba(20, 23, 28, 0.12); --slab-cast: drop-shadow(0 1px 1px rgba(20, 30, 50, 0.14)) drop-shadow(0 3px 6px rgba(20, 30, 50, 0.16)); --ghost: rgba(255, 255, 255, 0.45); --ghost-rest: rgba(255, 255, 255, 0); --wash-rest: rgba(20, 23, 28, 0); --wash: rgba(20, 23, 28, 0.08); --wash-press: rgba(20, 23, 28, 0.14);
  --btn: var(--slab-face); --btn-hover: var(--slab-face-pointed); --btn-press: var(--slab-face-pressed);
  --press-shade: inset 0 2px 5px rgba(20, 30, 50, 0.16); --run-flood: rgba(247, 147, 26, 0.14); --groove-shade: rgba(20, 30, 50, 0.3); --groove-lip: rgba(255, 255, 255, 0.95); --press-deep: inset 0 2px 12px rgba(20, 30, 50, 0.14), inset 0 0 0 100vmax rgba(20, 30, 50, 0.05);
  /* The edge of something you press, at rest (a check's box, a toggle's slot, a choice card): 3:1 or more against the glass. */
  --press-rim: rgba(20, 23, 28, 0.5);
  /* A color swatch's rim against its well, so a color near the well's own (black in dark, white in light) still shows: 3:1 or more. */
  --swatch-rim: rgba(20, 23, 28, 0.5);
  /* What can't be pressed now: carved flat into the glass, unlike a field's or a button's face in either theme. */
  --off-face: rgba(70, 84, 108, 0.08);
  --field-face: var(--carving-face); --field-hover: var(--carving-face-pointed); --field-focus: rgba(255, 255, 255, 0.94); --carving-face-focus: var(--field-focus);
  --field-shade: var(--carving-shade);
  --show: rgba(255, 255, 255, 0.55); --show-on: #fff;
  --pick: rgba(255, 255, 255, 0.42); --pick-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  --done: rgba(255, 255, 255, 0.7); --done-line: inset 0 0 0 1px rgba(20, 23, 28, 0.1);
  /* A way in's one-color mark (Discord's): unset on light glass, so it keeps its own color; white on smoked. */
  --clear-glass-mark: initial;
  /* What shows only on light glass, and only on smoked (the light-dark icon's sun and moon). */
  --on-light: inline; --on-smoked: none;
  /* Zaisma's mark in an empty picture's well: black glass on light glass, white on smoked. */
  --well-mark: url("/zaisma-mark-glass-black.svg");
  /* The line between two parts of one pane (its head and its list, a list and the facts under it). Set with each kind of glass, not on :root,
     so it takes that glass's --line: a var() in a custom property is read where it's set. */
  --divider: 1px solid var(--line);
  --toggle-off: rgba(60, 72, 94, 0.2); --check-press: rgba(60, 72, 94, 0.16); --row-hover: rgba(255, 255, 255, 0.24); --row-press: rgba(20, 23, 28, 0.05); --tag-new: rgba(34, 160, 90, 0.26); --tag-new-ink: #0A5A2C; --tag-warning: rgba(217, 165, 28, 0.3); --tag-warning-ink: var(--warning); --tag-plain: rgba(60, 72, 94, 0.1); --tag-carve: inset 0 1px 2px rgba(20, 30, 50, 0.22), inset 0 -1px 0 rgba(255, 255, 255, 0.75); --face-ring: rgba(255, 255, 255, 0.85); --presence-ring: #fff; --online: #3BB273; --picture-shadow: rgba(20, 23, 28, 0.3);
  /* Data: a table's header row over the rows scrolling under it, a chart's fill under its line, a meter's fill and its amber past 80%. */
  --table-head: rgba(250, 252, 255, 0.9); --table-row-head: rgba(244, 246, 250, 0.97); --chart-fill: rgba(20, 23, 28, 0.07); --chart-bar: rgba(60, 72, 94, 0.26); --chart-ring: rgba(250, 252, 255, 0.9); --chart-tip: rgba(250, 252, 255, 0.94); --meter-near-hi: #F0705F; --meter-near: #D93A2B; --meter-full: #A82718; --meter-full-ink: #A82718; --part-0: #3E6FD8; --part-1: #7B5BD6; --part-2: #1E9C87; --part-3: #5E8C2E; --part-4: #D2577F; --part-5: #2A8FB8;
  /* A file drop's dashed outline, waiting for a file. */
  --drop-dash: rgba(20, 23, 28, 0.3);
  --rail-line: rgba(20, 23, 28, 0.2); --rail-thumb: rgba(24, 28, 36, 0.55); --rail-edge: rgba(255, 255, 255, 0.55); --rail-mark: rgba(20, 23, 28, 0.45);
  --edge-inner: rgba(255, 255, 255, 0.9); --edge-bevel: 0.4; --edge-rim: 1; --edge-fringe: 0.25;
  --edge-lit: rgba(236, 240, 246, 1); --edge-shade: rgba(146, 154, 168, 0.6); --edge-corner: rgba(188, 196, 208, 0.75);
  --edge-spec: rgba(255, 255, 255, 1); --edge-dense: rgba(120, 130, 146, 0.03); --edge-caustic: rgba(255, 252, 244, 0.95);
  /* A step of thicker glass on a thinner sheet (a tray's head): its lip lit along the top, its shade on the thin glass below. */
  --step-lip: rgba(255, 255, 255, 0.95); --step-cast: 0 2px 0 rgba(255, 255, 255, 0.28), 0 9px 10px -7px rgba(20, 30, 50, 0.3);
  /* A warning and a field marked wrong: amber, a yellower hue than the runner's orange, so it never reads as something to press or as focus. */
  --warning: #7D5C00; --link-hover: var(--run-lo); --marked: var(--warning);
  --glass-base: 255, 255, 255; --glass-kind: "Light glass, dark words."; --glass-hue-strength: 14%; --track: rgba(186, 198, 216, 0.28);
  --edge-light: #FFFFFF; --edge-flood: rgba(255, 255, 255, 0.62); --edge-flood-far: rgba(255, 255, 255, 0.24); --edge-wake: rgba(255, 255, 255, 0.8);
  --raise-top: rgba(255, 255, 255, 0.95); --raise-left: rgba(255, 255, 255, 0.6); --raise-right: rgba(96, 108, 128, 0.22); --raise-bottom: rgba(70, 82, 104, 0.34);
  --carve-rim: transparent; --carve-top: rgba(60, 72, 94, 0.3); --carve-left: rgba(60, 72, 94, 0.2); --carve-right: rgba(255, 255, 255, 0.55); --carve-bottom: rgba(255, 255, 255, 0.9);
  --backdrop-base: #E3E0DB; --backdrop-a: #F6F4F0; --backdrop-b: #CCC8C1; --backdrop-c: #ECE9E4;`;

export const SMOKED_GLASS = `color-scheme: dark;
  --ink: #F7F9FC; --ink-2: rgba(247, 249, 252, 0.86); --muted: rgba(247, 249, 252, 0.7); --line: rgba(255, 255, 255, 0.2);
  --glass-edge: rgba(255, 255, 255, 0.16); --field: rgba(255, 255, 255, 0.08);
  --glass-tray: rgba(14, 17, 24, 0.18); --glass-thin: rgba(14, 17, 24, 0.35); --glass-regular: rgba(14, 17, 24, 0.55); --glass-thick: rgba(14, 17, 24, 0.72);
  --glass-tint: var(--glass-regular); --glass-top: var(--glass-regular); --glass-dropdown: var(--glass-thin);
  --carving-face: rgba(255, 255, 255, 0.08); --carving-face-pointed: rgba(255, 255, 255, 0.13); --carving-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3);
  --carving-deep-face: rgba(0, 0, 0, 0.24); --carving-deep-shade: inset 0 3px 3px rgba(0, 0, 0, 0.75), inset 0 -1.5px 0 rgba(214, 228, 255, 0.45);
  --brand-mark-backing: #FFFFFF; --slab-face: rgba(255, 255, 255, 0.13); --slab-face-pointed: rgba(255, 255, 255, 0.2); --slab-face-pressed: rgba(255, 255, 255, 0.05);
  --slab-sheen: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 70%);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(190, 215, 255, 0.12), rgba(190, 215, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 38%, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, 0.03));
  --glass-tray-sheen: radial-gradient(140% 90% at 0% 0%, rgba(190, 215, 255, 0.04), rgba(190, 215, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0) 38%, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, 0.04));
  --glass-saturate: 1.9; --edge-hair: rgba(0, 0, 0, 0.09);
  --well: var(--carving-face); --well-shade: var(--carving-shade);
  --toggle-icon-on: var(--run);
  --run-words: var(--run-hi);
  --run-cast: drop-shadow(0 3px 10px rgba(247, 147, 26, 0.3)) drop-shadow(0 0 2px rgba(247, 147, 26, 0.25)); --run-cast-up: drop-shadow(0 5px 16px rgba(247, 147, 26, 0.34)) drop-shadow(0 0 3px rgba(247, 147, 26, 0.28)); --run-cast-down: drop-shadow(0 1px 4px rgba(247, 147, 26, 0.42)) drop-shadow(0 0 1.5px rgba(247, 147, 26, 0.34)); --run-flare: drop-shadow(0 2px 18px rgba(247, 147, 26, 0.7)) drop-shadow(0 0 4px rgba(255, 190, 110, 0.65)); --toggle-ring: drop-shadow(1.5px 0 0 var(--run)) drop-shadow(-1.5px 0 0 var(--run)) drop-shadow(0 1.5px 0 var(--run)) drop-shadow(0 -1.5px 0 var(--run)); --toggle-cast: drop-shadow(0 3px 8px rgba(247, 147, 26, 0.45)) drop-shadow(0 1px 1.5px rgba(247, 147, 26, 0.35));
  --float-cast: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.25)) drop-shadow(0 8px 20px rgba(0, 0, 0, 0.3));
  --slab: var(--slab-sheen), var(--slab-face); --slab-shade: 0 0 0 transparent; --slab-cast: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4)) drop-shadow(0 3px 8px rgba(0, 0, 0, 0.45)); --ghost: rgba(255, 255, 255, 0.1); --ghost-rest: rgba(255, 255, 255, 0); --wash-rest: rgba(255, 255, 255, 0); --wash: rgba(255, 255, 255, 0.14); --wash-press: rgba(255, 255, 255, 0.22);
  --btn: var(--slab-face); --btn-hover: var(--slab-face-pointed); --btn-press: var(--slab-face-pressed);
  --press-shade: inset 0 2px 5px rgba(0, 0, 0, 0.4); --run-flood: rgba(247, 147, 26, 0.28); --groove-shade: rgba(0, 0, 0, 0.75); --groove-lip: rgba(214, 228, 255, 0.45); --press-deep: inset 0 2px 14px rgba(0, 0, 0, 0.4), inset 0 0 0 100vmax rgba(0, 0, 0, 0.12);
  --press-rim: rgba(255, 255, 255, 0.45);
  --swatch-rim: rgba(255, 255, 255, 0.45);
  --off-face: rgba(0, 0, 0, 0.22);
  --field-face: var(--carving-face); --field-hover: var(--carving-face-pointed); --field-focus: rgba(255, 255, 255, 0.16); --carving-face-focus: var(--field-focus);
  --field-shade: var(--carving-shade);
  --show: rgba(255, 255, 255, 0.1); --show-on: rgba(255, 255, 255, 0.22);
  --pick: rgba(255, 255, 255, 0.06); --pick-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  --done: rgba(255, 255, 255, 0.12); --done-line: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  --clear-glass-mark: #fff; --on-light: none; --on-smoked: inline; --well-mark: url("/zaisma-mark-glass-white.svg"); --divider: 1px solid var(--line);
  --toggle-off: rgba(0, 0, 0, 0.34); --check-press: rgba(0, 0, 0, 0.3); --row-hover: rgba(255, 255, 255, 0.1); --row-press: rgba(255, 255, 255, 0.22); --tag-new: rgba(30, 150, 80, 0.32); --tag-new-ink: #A6F0C6; --tag-warning: rgba(230, 181, 58, 0.24); --tag-warning-ink: var(--warning); --tag-plain: rgba(0, 0, 0, 0.34); --tag-carve: inset 0 1.5px 3px rgba(0, 0, 0, 0.8), inset 0 -1px 0 rgba(255, 255, 255, 0.24); --face-ring: rgba(6, 8, 12, 0.55); --presence-ring: #1A1D24; --online: #3BB273; --picture-shadow: rgba(0, 0, 0, 0.55);
  --table-head: rgba(14, 17, 24, 0.9); --table-row-head: rgba(24, 28, 36, 0.97); --chart-fill: rgba(255, 255, 255, 0.08); --chart-bar: rgba(255, 255, 255, 0.3); --chart-ring: rgba(20, 23, 30, 0.9); --chart-tip: rgba(28, 32, 40, 0.94); --meter-near-hi: #FF8A78; --meter-near: #E5483A; --meter-full: #A82718; --meter-full-ink: #FF8A78; --part-0: #6E97F0; --part-1: #A08AF0; --part-2: #3CC4AC; --part-3: #8DBA55; --part-4: #EC7FA3; --part-5: #5BC0E3; --drop-dash: rgba(255, 255, 255, 0.34);
  --rail-line: rgba(255, 255, 255, 0.2); --rail-thumb: rgba(255, 255, 255, 0.55); --rail-edge: rgba(255, 255, 255, 0.35); --rail-mark: rgba(255, 255, 255, 0.5);
  /* A light rim on dark glass stands out far more than on light glass, so smoked glass draws it fainter than light glass's. It has no caustics:
     on light glass they're light on light and only round the edge off, but on dark glass they read as a glow fanning in from the rim, which
     blurs the pane's edge against what sits near it. Smoked glass keeps to the edge, as narrow and clean as light glass's. */
  --edge-inner: rgba(255, 255, 255, 0.22); --edge-bevel: 0.18; --edge-rim: 0.5; --edge-fringe: 0.15;
  --edge-lit: rgba(220, 228, 242, 0.68); --edge-shade: rgba(140, 152, 176, 0.12); --edge-corner: rgba(196, 206, 224, 0.34);
  --edge-spec: rgba(255, 255, 255, 0.52); --edge-dense: rgba(255, 255, 255, 0.015); --edge-caustic: transparent;
  --step-lip: rgba(220, 228, 242, 0.42); --step-cast: 0 2px 0 rgba(220, 228, 242, 0.08), 0 9px 10px -7px rgba(0, 0, 0, 0.55);
  --warning: #F2C94C; --link-hover: var(--run-hi); --marked: var(--warning);
  --glass-base: 14, 17, 24; --glass-kind: "Smoked glass, light words."; --glass-hue-strength: 22%; --track: rgba(255, 255, 255, 0.08);
  --edge-light: rgba(214, 228, 255, 0.9); --edge-flood: rgba(206, 222, 255, 0.4); --edge-flood-far: rgba(206, 222, 255, 0.14); --edge-wake: rgba(206, 222, 255, 0.35);
  --raise-top: rgba(255, 255, 255, 0.42); --raise-left: rgba(255, 255, 255, 0.22); --raise-right: rgba(0, 0, 0, 0.3); --raise-bottom: rgba(0, 0, 0, 0.5);
  --carve-rim: rgba(255, 255, 255, 0.16); --carve-top: rgba(0, 0, 0, 0.5); --carve-left: rgba(0, 0, 0, 0.32); --carve-right: rgba(255, 255, 255, 0.1); --carve-bottom: rgba(255, 255, 255, 0.2);
  --backdrop-base: #121110; --backdrop-a: #2A2724; --backdrop-b: #0A0909; --backdrop-c: #1D1B19;`;

/**
 * The words margin (docs/DESIGN.md, Spacing), defined once. Words are never closer to the edge of a surface of glass than its margin, --pad-pane
 * (a tray's, --pad-tray): only what has an edge of its own (a control, a field, a list's rows, a cover, a table) may sit closer, at the frame
 * gap. A surface that holds words pads at the frame gap and sets --pad-words, the extra the margin needs; every one is listed here, and
 * nothing else sets a surface's padding for words. A surface that isn't listed has no words margin, and the layout check
 * (layout-measure.ts) fails any words it finds closer to a surface's edge than the margin.
 *   - WORDS_SURFACES: what holds a pane's, a sheet's and a playing card's content, and a banner (which sets its words' own padding).
 *   - WORDS_HOLDERS: where a heading or paragraph, or the first and last words (layout.ts's edgeWords), take the margin from --pad-words.
 */
export const WORDS_HOLDERS = [".glass-pane > .pane-in", ".floating-pane > .floating-body", ".sheet-in", ".playing-card-in", ".tray"];
export const WORDS_SURFACES = [".glass-pane > .pane-in", ".sheet-in", ".playing-card-in", ".banner"];

/**
 * Bare groups (docs/DESIGN.md, Spacing): a component whose words sit bare, with no edge of their own, is one unit, and the unit as a whole
 * keeps the words margin from a surface's edge on every side where it meets that edge, top and bottom included. Its parts line up with each
 * other inside it (a game card's cover, title and players now flush; a person's picture, name and line) and move together, so no part
 * is treated apart and a component never pads its own words. A row, a grid or a track of them is inset at its start, end and foot as one
 * (the gaps between the units stay); one alone pads itself (BARE_GROUPS_STYLES). A cover always has its words under it (its title or players
 * now); a picture with none (a screenshot) has an edge all round and keeps the frame gap. A new bare group is added here and nowhere else;
 * the layout check (layout-measure.ts) measures each one's box.
 */
export const BARE_GROUPS = [".cover", ".person"];

/** The least a box that scrolls up and down scrolls by: one that scrolls by less (a sliver) only bounces under a finger. The layout check holds it. */
export const LEAST_SCROLL_PX = 12;

/** The bare groups' rule, once: the unit takes --pad-words at its sides, or the row, grid or track holding units does and its cells don't. */
export const BARE_GROUPS_STYLES = `
:where(${BARE_GROUPS.join(", ")}) { padding-inline: var(--pad-words); }
:is(.layout-grid, .layout-track):has(> :is(${BARE_GROUPS.join(", ")}), > .grid-cell > :is(${BARE_GROUPS.join(", ")})) { padding-inline: var(--pad-words); }
:is(.layout-grid, .layout-track) > :is(${BARE_GROUPS.join(", ")}), .grid-cell > :is(${BARE_GROUPS.join(", ")}) { padding-inline: 0; }
`;

/**
 * The tokens. Light or dark follows the system unless a choice is fixed with data-theme-choice, on <html>
 * or on any element (the gallery's stage fixes it for what's inside). Dark is smoked glass over a night-dark
 * page. Smoked glass on its own is the class smoke on any ancestor: a dark game's background smokes the
 * glass over it whatever the theme, since the theme changes only Zaisma's own backgrounds.
 */
export const TOKEN_STYLES = `
@font-face { font-family: Jost; src: url(/fonts/jost.7726a5cd.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
@property --refl { syntax: "<percentage>"; inherits: false; initial-value: 50%; }
@property --tint-color { syntax: "<color>"; inherits: false; initial-value: transparent; }
@property --tint-pct { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
/* Registered, so a change of hue eases over half a second, like a change of theme, instead of cutting. */
@property --glass-hue { syntax: "<color>"; inherits: true; initial-value: transparent; }
/* The tint a piece of glass shows right now, faded towards its --glass-tint. A registered color fades in the page itself, so the browser
   never lifts the glass onto a layer of its own for the fade and drops it at the end, which flashed blurred glass as a fade finished. */
@property --glass-shown-tint { syntax: "<color>"; inherits: true; initial-value: transparent; }
/* A control's face color, the same way: every control that changes color (a hover, a press, light to dark) sets --face-color and
   fades it, never its background, so no control flashes as a fade ends. design.test.ts checks that nothing fades a background. */
@property --face-color { syntax: "<color>"; inherits: false; initial-value: transparent; }
/* Scroll fades (navigation.ts's SCROLL_FADE_SCRIPT): a box that scrolls fades its words over an edge while there's more that way, easing in and out.
   The fade curves: what's in its outer third is faint, and only its inner end is whole, so words never run into the edge. It comes and
   goes over 0.45s, easing in and out, so it never snaps on or off as you reach an end. */
@property --fade-top { syntax: "<length>"; inherits: false; initial-value: 0px; }
/* The words' inset in a pane (layout.ts), registered so it's worked out to a length where it's set, and reads as one. */
@property --pad-words { syntax: "<length>"; inherits: true; initial-value: 0px; }
@property --fade-bottom { syntax: "<length>"; inherits: false; initial-value: 0px; }
.scroll-fades.is-fading { -webkit-mask-image: linear-gradient(to bottom, transparent, rgba(0,0,0,0.22) calc(var(--fade-top) * 0.35), rgba(0,0,0,0.66) calc(var(--fade-top) * 0.7), #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), rgba(0,0,0,0.66) calc(100% - var(--fade-bottom) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-bottom) * 0.35), transparent);
  mask-image: linear-gradient(to bottom, transparent, rgba(0,0,0,0.22) calc(var(--fade-top) * 0.35), rgba(0,0,0,0.66) calc(var(--fade-top) * 0.7), #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), rgba(0,0,0,0.66) calc(100% - var(--fade-bottom) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-bottom) * 0.35), transparent); transition: --fade-top var(--motion-glide) var(--ease-standard), --fade-bottom var(--motion-glide) var(--ease-standard); }
/* A row that scrolls sideways (data-fades-sideways: a header's tabs, the gallery's groups on a phone) fades out over a side with more past it,
   easing in and out, with no scrollbar; it starts scrolled to the one you're on, and never scrolls up and down. */
@property --fade-left { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-right { syntax: "<length>"; inherits: false; initial-value: 0px; }
/* A box that scrolls keeps a swipe to itself on a touch screen: reaching its end never carries on into the page, so the page never nudges under it.
   Only while it has something to scroll (is-scrollable, SCROLL_FADE_SCRIPT): a box that can't scroll never catches a swipe or a wheel. With a mouse
   or trackpad the wheel is never held: at a box's end the next scroll carries on into the page, so a pointer resting over a list never gets stuck. */
@media (pointer: coarse) { .is-scrollable { overscroll-behavior-y: contain; } }
/* The page never rubber-bands, sideways or past its top or bottom: its backdrop stays put behind the glass, so a page pulled past its end
   would leave the glass's light on the backdrop behind. A tap shows itself on what was tapped, never as the browser's grey box. */
html, body { overscroll-behavior: none; }
html { -webkit-tap-highlight-color: transparent; }
.is-scrollable-sideways { overscroll-behavior-x: contain; }
[data-fades-sideways] { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; transition: --fade-left var(--motion-glide) var(--ease-standard), --fade-right var(--motion-glide) var(--ease-standard); }
[data-fades-sideways]::-webkit-scrollbar { display: none; }
[data-fades-sideways].more-left, [data-fades-sideways].more-right {
  -webkit-mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,0.22) calc(var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--fade-left) * 0.7), #000 var(--fade-left), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,0.22) calc(var(--fade-left) * 0.35), rgba(0,0,0,0.66) calc(var(--fade-left) * 0.7), #000 var(--fade-left), #000 calc(100% - var(--fade-right)), rgba(0,0,0,0.66) calc(100% - var(--fade-right) * 0.7), rgba(0,0,0,0.22) calc(100% - var(--fade-right) * 0.35), transparent 100%); }
/* How far in it fades: 34px, or a row's own --fade-sideways-px (a row of covers fades further). */
[data-fades-sideways].more-left { --fade-left: var(--fade-sideways-px, 34px); }
[data-fades-sideways].more-right { --fade-right: var(--fade-sideways-px, 34px); }
.eases-settings { transition: --glass-hue var(--motion-glide) ease; }
@media (prefers-reduced-motion: reduce) { .eases-settings { transition: none; } }
/* Moving between Zaisma's pages crossfades, so a page change never flashes. It's quick: a switch's slab slides over from the last page's
   tab only once the crossfade is over (SWITCH_SCRIPT), so a long one would hold the slab still. */
@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } ::view-transition-group(root) { animation-duration: var(--motion-state); } }
:root {
  color-scheme: light dark;
  /* A thumb: the white slab you flip or drag (a toggle's, a slider's), solid and lit from above on either glass, casting its shadow onto
     what it rests on (--thumb-cast; pointed, a touch higher). Pressed, it's pushed down in place, never smaller: its shadow drawn in close
     and its face shaded from above (--thumb-press-shade, --thumb-press-face). */
  --thumb-face: radial-gradient(120% 90% at 50% 0%, #fff, #F1F4F8 55%, #D9DFE7);
  --thumb-cast: drop-shadow(0 1px 1px rgba(10, 16, 28, 0.24)) drop-shadow(0 2px 3px rgba(10, 16, 28, 0.12));
  --thumb-cast-pointed: drop-shadow(0 1.5px 1.5px rgba(10, 16, 28, 0.28)) drop-shadow(0 3px 4px rgba(10, 16, 28, 0.14));
  --thumb-cast-pressed: drop-shadow(0 0.5px 0.5px rgba(10, 16, 28, 0.3)) drop-shadow(0 0 0 transparent);
  --thumb-press-shade: inset 0 2px 3px rgba(10, 16, 28, 0.18);
  --thumb-ink: #3D444E;
  --thumb-press-face: linear-gradient(180deg, rgba(10, 16, 28, 0.16), rgba(10, 16, 28, 0.04) 55%, rgba(255, 255, 255, 0.1));
  --run: #F7931A; --run-hi: #FFB24A; --run-lo: #A85A06;
  /* Orange light's other tones (Light, panes.ts): deeper at its start, and the bright tip and white-hot spark at its leading end; a glint is white light running along it. */
  /* What's behind something over everything: dimmed for a task (a sheet), a little for one hanging from its button, deep for one thing large (a light box), whose words are light. */
  --dim: rgba(6, 9, 14, 0.42); --dim-light: rgba(6, 9, 14, 0.16); --dim-deep: rgba(6, 9, 14, 0.78); --ink-on-dim: #F7F9FC; --on-picture: #FFFFFF; --on-picture-shade: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)); --ink-2-on-dim: rgba(247, 249, 252, 0.8);
  --run-deep: #E9820C; --run-tip: #FFC277; --run-spark: #FFF4E2; --glint: rgba(255, 255, 255, 0.7); --glint-warm: rgba(255, 246, 228, 0.95);
  /* Words and marks on an orange face (the runner, a ticked box): dark ink in both themes, 7.8:1 against it (white is 2.3:1). */
  --on-run: #14171C;
  /* The only red: a delete's confirm step, never anything else. */
  --danger: #D93A2B; --danger-lo: #A82718; --on-danger: #FFFFFF;
  --page: #E7E4DF;
  --glass-blur: 24px;
  /* How every piece of glass changes (light to dark, a hover's tint): a component that adds its own transitions starts its list with this. */
  --glass-transition: --glass-shown-tint var(--motion-glide) ease, color var(--motion-arrive) ease;
  /* The glass's hue (PageSettings' glass.hueColor): tints every piece of glass under where it's set. Glass tinted for a brand keeps its own color. */
  --glass-hue: transparent;
  --display: "Jost", Futura, "Century Gothic", "Avenir Next", sans-serif;
  --body: -apple-system, "Segoe UI", system-ui, sans-serif;
  /* Motion (materials.ts), one set for everything: how long a press takes to sink, a state to fade, a layer to arrive or leave, a slab to
     glide, a flare to settle and a light to loop; and the curves they take. Nothing else times itself. */
  --motion-press: 0.08s; --motion-state: 0.2s; --motion-arrive: 0.3s; --motion-glide: 0.45s; --motion-settle: 0.6s; --motion-loop: 1.6s; --motion-loop-slow: 2.4s;
  --ease-glide: cubic-bezier(.2, .8, .2, 1); --ease-standard: cubic-bezier(.4, 0, .2, 1); --ease-leave: cubic-bezier(.4, 0, 1, 1); --ease-spring: cubic-bezier(.25, .9, .3, 1.25);
  --spring: var(--ease-spring);
  /* Keyboard focus, the same on everything: orange. A control's cut line is stroked --focus-stroke wide (half of it shows inside
     its cut, 2px), anything else gets a 2px outline. On an orange face (the runner) it's the deeper --focus-on-run. */
  --focus: var(--run); --focus-on-run: #7A4100; --focus-stroke: 4;
  /* Spacing (docs/DESIGN.md, Spacing): every gap, padding and margin is one of these, picked by what sits on each side.
     Side by side, controls slant toward each other by --control-slant, and --gap-control-row is the space between the slants: their
     boxes sit --gap-control-row-boxes apart, overlapping by the slant less that. That's also the edge rule's neighbor distance. */
  --control-slant: 10px;
  --gap-control-row: 4px;
  --gap-control-row-boxes: calc(var(--gap-control-row) - var(--control-slant));
  --gap-control-stack: 8px;
  --gap-words-control: 8px;
  /* Words beside a control keep the words margin from its edge, as they do from the pane's: --pad-pane less --pad-frame. */
  --gap-words-beside-control: calc(var(--pad-pane) - var(--pad-frame));
  --gap-words-words: 8px;
  --gap-block-block: 24px;
  /* Two margins in a pane (docs/DESIGN.md, Layout): words keep the pane's margin, --pad-pane, and anything with an edge of its own (a control,
     a field, a table, a cover, an inner pane) sits closer, at the frame gap, --pad-frame, the gap it keeps from a cut corner too. A pane pads
     at the frame gap and sets --pad-words, the words' extra inset, for its words; outside a pane it's nothing. */
  --pad-pane: 24px;
  --pad-frame: 8px;
  --pad-words: 0px;
  /* What has an edge and words inside it (a field, a list's rows, a table's cells, a choice card) keeps its words this far in from its edge,
     so where it sits at the frame gap its words line up with the pane's words: --pad-pane less --pad-frame. */
  --pad-inside-words: calc(var(--pad-pane) - var(--pad-frame));
  --pad-inner-pane: 12px;
  --pad-tray: 16px;
  /* A compact material (a menu, a compact sheet, a small bar): edged things this close to its edge, words at --pad-tray. */
  --pad-frame-compact: 4px;
  /* Cut corners (docs/DESIGN.md, Shapes): a pane's, the header's and a bar's, a menu's, large and small, read by the edge rule (GLASS_SCRIPT)
     from data-glass-corners, so everything inside fits them. A framed thing in a corner keeps a bevel of at least 4px at the frame gap. */
  --pane-cut-large: 18px; --pane-cut-small: 14px;
  --header-cut-large: 16px; --header-cut-small: 12px;
  --menu-cut-large: 14px; --menu-cut-small: 12px;
  /* A control's height by its size class: each control sets --control-height from one of these, and a row sets every control in it to its
     tallest's (layout.ts). In rem, as type is, so a control grows with its words when the browser's text is set larger (36, 44, 52 and 56px at
     the browser's own 16px). */
  /* The least a finger needs to land on, which a small control's hit area reaches to on a touch screen: in px, as fingers don't grow with the text. */
  --touch-target: 44px;
  --control-height-small: 2.25rem; --control-height-regular: 2.75rem; --control-height-field: 3.25rem; --control-height-big: 3.5rem;
  /* The named sizes, the only widths a layout takes (layout.ts): a cell's least width in a grid, by what it holds; and the widest a
     paragraph runs in a pane that fits what's in it, for reading. */
  --size-cover: 180px; --size-card: 280px; --size-figure: 150px; --size-reading: 60ch;
  /* Page shapes (layout.ts, html.ts's pageShape): a reading page's one column, and the wide frame every page's header, footer and panes sit in,
     so nothing stretches across a big screen. A 2560 screen shows the world either side of the frame; a laptop's frame is its width less the margins. */
  --size-page-reading: 820px; --size-page-wide: 1680px;
  /* Pane sizes: the most a pane over the page takes, by its kind, before what's in it scrolls inside it (docs/DESIGN.md, Pane sizes). In rem,
     so a pane grows with its words as controls do; each also stops at the screen less its margins. A menu (a dropdown) and a select's list
     (as wide as its field) at most --size-menu-height tall; a compact sheet a dropdown's width; any other sheet --size-sheet; a picture's
     sheet (a screenshot, or a screen, large) --size-sheet-picture; the store panel its own column at the screen's edge. */
  --size-menu: 20rem; --size-menu-height: 30rem;
  --size-sheet-compact: 20rem; --size-sheet: 36rem; --size-sheet-picture: 80rem; --size-sheet-side: 23.75rem; --size-sidebar: 15rem;
  /* A figure's least width in Numbers: two side by side on a phone. */
  --size-number: 96px;
  /* Type (docs/DESIGN.md, Type): every word outside a control's own inside takes one of these whole fonts, picked by what the words are. */
  --type-title: 600 2.5rem/1.04 var(--display);
  --type-heading: 600 1.875rem/1.1 var(--display);
  --type-section: 600 1.375rem/1.2 var(--display);
  --type-name: 600 1.0625rem/1.3 var(--display);
  --type-label: 600 0.9375rem/1.3 var(--display);
  --type-words: 500 0.9375rem/1.35 var(--display);
  --type-reading: 400 0.9375rem/1.5 var(--body);
  --type-note: 500 0.875rem/1.4 var(--display);
  --type-facts: 500 0.8125rem/1.3 var(--display);
  --type-tag: 600 0.75rem/1 var(--display);
  --type-code: 600 0.8125rem/1.3 ui-monospace, Menlo, monospace;
}
/* A phone's sizes, upright or on its side (a landscape phone is a phone's height, not a laptop's). */
@media (max-width: 760px), (max-height: 500px) { :root { --pad-pane: 20px; --pad-frame: 8px; --control-height-big: 3rem; --type-title: 600 2rem/1.04 var(--display); --type-heading: 600 1.625rem/1.1 var(--display); --type-section: 600 1.25rem/1.2 var(--display); } }
:root, [data-theme-choice="light"] { ${LIGHT_GLASS} --page: #E7E4DF; }
@media (prefers-color-scheme: dark) { :root:not([data-theme-choice="light"]) { ${SMOKED_GLASS} --page: #121110; } }
[data-theme-choice="dark"] { ${SMOKED_GLASS} --page: #121110; }
.smoke { ${SMOKED_GLASS} }
*, *::before, *::after { box-sizing: border-box; }
/* Still under the pointer: what you point at or press never moves; only what's inside it does. A button is a still
   shell (the link or button itself, which takes the pointer) around its face (.face), which lifts, sinks, leans or
   shrinks. If the shell moved, a pointer near its edge would slip off as it moved, the button would move back under
   it, and it would flicker. The face takes no pointer of its own, so the shell's box alone decides what you're over.
   design.test.ts checks every component's CSS for this. */
.shell { position: relative; display: inline-flex; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-decoration: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.shell > .face { pointer-events: none; }
[hidden] { display: none !important; }
/* Words never leave one word alone on their last line: paragraphs and lines wrap evenly at their end, headings evenly throughout. */
:where(p, li, dd, dt, figcaption, legend, label, blockquote, td, th) { text-wrap: pretty; }
:where(h1, h2, h3, h4) { text-wrap: balance; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* The glass: one look for every piece of it, at any size, defined here once. Anything made of glass has the class glass and
   nothing else paints it: it's a tint (--glass-tint, which a component may set to its own, like the header's --glass-top),
   a layer over the tint a component may set (--glass-layer, a table row's hover), the page's hue (--glass-wash),
   the light on it (--glass-sheen: brightest at its top left, a little shade along its foot), the blur and color of what's
   behind (--glass-blur, --glass-saturate), the way it changes (--glass-transition), and on a slab, cut corners with a drawn
   rim (data-glass: the svg.edge GLASS_SCRIPT draws, sizing its corners and bevel to the slab). design.test.ts checks that
   no other rule paints glass. */
/* Each piece of glass works the hue out from the --glass-hue it inherits, so setting it anywhere tints all the glass inside. */
.glass { --glass-wash: linear-gradient(color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent), color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent)); }
/* A slab's words keep no inset of their own unless it's a pane that sets one (layout.ts): none comes in from the pane round it. */
.glass { --pad-words: 0px; }
/* The words margin, once: what holds a surface's content pads at the frame gap and sets --pad-words, the rest of the margin (--pad-pane less
   --pad-frame), for its words to take (layout.ts places them). A tray sets its own, smaller (panes.ts). */
${WORDS_SURFACES.join(", ")} { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); }
/* Headings and paragraphs keep the margin at their sides wherever they sit in it (layout.ts's edge rules give their top and bottom); inside
   anything with an edge of its own there's none (a slab of glass sets --pad-words to nothing), and any component's own padding wins. */
:where(${WORDS_HOLDERS.join(", ")}) :where(h1, h2, h3, h4, p) { padding-inline: var(--pad-words); }
/* A line of words runs at most 75 characters of its own font, however wide its surface (the layout check's "a line of words longer than the
   reading width"); a pane that fits what's in it stops its paragraphs sooner, at --size-reading. A word longer than the line (an email address
   at a large text size) breaks rather than run past the margin. */
:where(${WORDS_HOLDERS.join(", ")}, .tray-head) :where(p, li) { max-width: 75ch; overflow-wrap: break-word; }
/* Bare groups (BARE_GROUPS above): a game card, a person. The unit takes the margin as a whole, at its sides here and its top and bottom in layout.ts. */${BARE_GROUPS_STYLES}
/* The glass's body is a layer of its own under what's on it, cut to its shape (--glass-clip, GLASS_SCRIPT): the glass is cut, not what
   stands on it, so a slab's shadow or a lit one's glow falls past its edge as light would. */
.glass { position: relative; isolation: isolate; color: var(--ink); --glass-shown-tint: var(--glass-tint); transition: var(--glass-transition); }
.glass::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; clip-path: var(--glass-clip, none);
  background-color: var(--glass-shown-tint); background-image: var(--glass-layer, linear-gradient(transparent, transparent)), var(--glass-wash), var(--glass-sheen);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); }
.glass > .edge { clip-path: var(--glass-clip, none); }
/* Under everything in its own layer, so bare words on it (a table's head) show over it. Glass with no outline of its own (a table's pinned
   cells) is cut to nothing: it never takes the shape of the pane it's in. */
.glass:not([data-glass]) { --glass-clip: none; }
.glass > :not(.edge) { position: relative; z-index: 3; }
.edge { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; overflow: visible; }
/* Light and smoked glass share one frame: a straight-cut glass edge whose every side is one flat tone between --edge-lit and --edge-shade
   (lit along the top, shaded along the bottom), so each turn of the cut steps in brightness; brightest at the outer rim, with no separate outline. Like real glass it's denser at
   the edge (--edge-dense), glints where the rim meets the lit corner (--edge-spec), and its inner facet line catches light from the far side (--edge-inner). */
.edge .gleam { stop-color: var(--edge-inner); } .edge .spec { stop-color: var(--edge-spec); }
.edge .dense { fill: var(--edge-dense); }
.edge .facet { stroke: var(--edge-corner); } .edge .facet.lit { stroke: var(--edge-lit); }
.edge .hair { stroke: var(--edge-hair); }
.edge .bevel { opacity: var(--edge-bevel); }
.edge .rim-band { opacity: var(--edge-rim); }
.edge .bevel polygon, .edge .rim-band polygon { fill: color-mix(in srgb, var(--edge-lit) var(--side-light), var(--edge-shade)); }
.edge .rim { stroke: none; }
.edge .fringe { opacity: var(--edge-fringe); }
/* Caustics: soft steps of gathered light just inside a pane's bevel, each side as bright as it's lit, fading inward. */
.edge .caustic polygon { fill: var(--edge-caustic); opacity: calc(var(--side-light) * var(--caustic-step)); }
.edge .caustic.step-1 { --caustic-step: 0.32; } .edge .caustic.step-2 { --caustic-step: 0.18; } .edge .caustic.step-3 { --caustic-step: 0.09; } .edge .caustic.step-4 { --caustic-step: 0.035; }
/* A slanted outline drawn just inside a cut field or button, so its slanted ends are outlined like its top and bottom. */
.cut-line { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: visible; }
.cut-line polygon { fill: none; stroke: transparent; stroke-width: 1; transition: stroke var(--motion-arrive); }
/* Raised and carved: the light that falls on the panes falls on what's on them. A raised control (a button, the slab under the tab you're on)
   is lit along its top and shaded along its bottom; a carved one (a field, a switch's track) the other way round. Each side is one flat tone,
   so every turn of the cut steps in brightness, like the panes' edges. The outline polygon is left for focus and marks. */
.cut-line .cut-band { fill: transparent; transition: fill var(--motion-state); }
/* While its shape glides (a switch's slab), a side's light changes at once: sides come and go as its corners turn, and a band taking
   another side's place would fade from that side's light, blinking. */
.cut-line.is-gliding .cut-band { transition: none; }
.cut-raised > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.cut-carved > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* A ring set out around a control (data-cut-ring) is unseen until its control's focus or mark colours it; no outline rule above reaches it. */
svg.cut-line polygon.cut-ring { stroke: transparent; stroke-width: 2; }
/* On smoked glass a carving's shaded top and left are dark on dark, so a faint light line traces its outer edge all round: the cut reads at
   its edge on every side, not at what's inside it. Light glass needs none (--carve-rim is transparent there). Half the stroke is clipped away. */
.cut-carved > .cut-line polygon { stroke: var(--carve-rim); stroke-width: 2; }
.cut-line .cut-band.on-top { fill: var(--band-top, transparent); } .cut-line .cut-band.on-left { fill: var(--band-left, transparent); }
.cut-line .cut-band.on-right { fill: var(--band-right, transparent); } .cut-line .cut-band.on-bottom { fill: var(--band-bottom, transparent); }
/* A nested corner's cut faces two ways, so it takes half of each side's light. */
.cut-line .cut-band.on-top-right { fill: color-mix(in srgb, var(--band-top, transparent), var(--band-right, transparent)); }
.cut-line .cut-band.on-bottom-right { fill: color-mix(in srgb, var(--band-bottom, transparent), var(--band-right, transparent)); }
.cut-line .cut-band.on-bottom-left { fill: color-mix(in srgb, var(--band-bottom, transparent), var(--band-left, transparent)); }
.cut-line .cut-band.on-top-left { fill: color-mix(in srgb, var(--band-top, transparent), var(--band-left, transparent)); }
/* Line icons: drawn with the words' color. */
.ico { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.ico.solid { fill: currentColor; stroke: none; }
.ico .on-light { display: var(--on-light); }
.ico .on-smoked { display: var(--on-smoked); }
`;
