// The motion sheet (scripts/motion-sheet.mjs): its four faults found in recordings made by hand, and in a real Chrome on fixture pages,
// one that breaks each rule and one that moves well, which must pass.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { temporaryFolder } from "../temporary-folder.ts";
// @ts-expect-error: a Node script with no types of its own.
import { findFlashes, findJitter, findPops, findSiblingsThatDiffer, lightnessGap, markedUrl, motionRuns, moveThroughPages, MOTION_SCREENS, siblingEntries } from "../../scripts/motion-sheet.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { findChrome } from "../../scripts/chrome.mjs";

type Values = number[];
/** A piece's values: opacity, blur, backdrop blur, translate x and y, scale, x, y, width, height, the three durations and looping. */
const at = ({ opacity = 1, translateY = 0, y = 100, height = 50, opacityMs = 0, moveMs = 0, isLooping = 0, isInView = 1 } = {}): Values => [opacity, 0, 0, 0, translateY, 1, 10, y, 200, height, opacityMs, moveMs, 0, isLooping, isInView, 1];
const recording = (series: [number, Values, string | null, string | null][], options: { frameCount?: number; component?: string; isInserted?: boolean; animations?: unknown[]; parsedFrame?: number } = {}) => ({
  kind: "enter",
  frames_ms: Array.from({ length: options.frameCount ?? 30 }, (_, index) => index * 16),
  parsed_frame: options.parsedFrame ?? 0,
  pieces: [{ piece_id: 0, component: options.component ?? "Sheet", label: "#share", is_inserted: options.isInserted ?? false, parent_piece_id: null }],
  changes: [series],
  animations: options.animations ?? [],
});

describe("what the motion sheet finds in a recording", () => {
  it("finds a pane that appears in one frame with nothing animating it", () => {
    const found = findPops(recording([[0, at({ opacity: 0 }), null, null], [5, at({ opacity: 1 }), null, null]]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "pop", property: "opacity", frame: 5 });
    expect(found[0].said).toContain("appears");
    expect(found[0].said).toContain("nothing animates it");
  });

  it("passes a fade over its transition, and finds one that steps past what its transition allows", () => {
    const fade = Array.from({ length: 13 }, (_, index) => [index, at({ opacity: Math.min(1, index / 12), opacityMs: index < 12 ? 200 : 0 }), null, null] as [number, Values, null, null]);
    expect(findPops(recording(fade))).toEqual([]);
    const stepped = [[0, at({ opacity: 0, opacityMs: 600 }), null, null], [1, at({ opacity: 0.9, opacityMs: 600 }), null, null], [2, at({ opacity: 1 }), null, null]] as [number, Values, null, null][];
    expect(findPops(recording(stepped))[0].said).toContain("600 ms transition allows");
  });

  it("counts a piece put in the page mid-run, already shown, as appearing", () => {
    expect(findPops(recording([[4, at(), null, null]], { isInserted: true }))[0].said).toContain("appears");
    expect(findPops(recording([[4, at(), null, null]], { isInserted: false }))).toEqual([]);
  });

  it("leaves alone a piece out of view, and reports a pane that pops once, not once for each thing in it", () => {
    expect(findPops(recording([[0, at({ opacity: 0, isInView: 0 }), null, null], [5, at({ isInView: 0 }), null, null]]))).toEqual([]);
    const pane = { kind: "enter", frames_ms: [0, 16, 32], parsed_frame: 0, animations: [],
      pieces: [{ piece_id: 0, component: "Sheet", label: "#share", is_inserted: false, parent_piece_id: null }, { piece_id: 1, component: "Secondary button", label: '"Copy"', is_inserted: false, parent_piece_id: 0 }],
      changes: [[[0, at({ opacity: 0 }), null, null], [1, at(), null, null]], [[0, at({ opacity: 0 }), null, null], [1, at(), null, null]]] };
    expect(findPops(pane).map((failure: { piece: string }) => failure.piece)).toEqual(["Sheet #share"]);
  });

  it("leaves the page arriving alone: what comes in while it's still read", () => {
    expect(findPops(recording([[0, at({ opacity: 0 }), null, null], [3, at(), null, null]], { parsedFrame: 5 }))).toEqual([]);
  });

  it("finds a box that moves after the last transition ended, but not one that loops", () => {
    const animations = [{ piece_id: 0, property_group: "move", duration_ms: 150, easing: "ease-out", is_looping: false, first_frame: 1, last_frame: 9 }];
    const series: [number, Values, null, null][] = [[0, at({ translateY: 20, moveMs: 150 }), null, null], [9, at({ moveMs: 150 }), null, null], [10, at(), null, null], [20, at({ y: 103 }), null, null]];
    const found = findJitter(recording(series, { animations }));
    expect(findJitter({ ...recording(series, { animations }), kind: "load" })).toEqual([]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "jitter", frame: 20 });
    expect(findJitter(recording([[0, at({ isLooping: 1 }), null, null], [20, at({ y: 103, isLooping: 1 }), null, null]]))).toEqual([]);
  });

  it("finds a white frame at load, a label that blinks and a piece that hides for a moment", () => {
    const white = recording([[0, at(), null, "rgb(255, 255, 255)"], [2, at(), null, "rgb(18, 18, 18)"]], { component: "Page" });
    expect(findFlashes(white)[0]).toMatchObject({ kind: "flash", property: "background" });
    const words = recording([[0, at(), "Play", null], [10, at(), "Loading", null], [12, at(), "Play now", null]]);
    expect(findFlashes(words)[0]).toMatchObject({ property: "words" });
    const blink = recording([[0, at(), null, null], [10, at({ opacity: 0 }), null, null], [12, at(), null, null]]);
    expect(findFlashes(blink)[0]).toMatchObject({ property: "shown" });
    const slowSwitch = recording([[0, at(), "Play", null], [10, at(), "Loading", null], [25, at(), "Play now", null]]);
    expect(findFlashes(slowSwitch)).toEqual([]);
  });

  it("finds two uses of one component that enter on different curves", () => {
    const entries = [
      { component: "Sheet", piece: "Sheet #a", run: "enter", property_group: "opacity", duration_ms: 200, easing: "ease-out", frame: 1, at_ms: 16, where: "A, Phone, light" },
      { component: "Sheet", piece: "Sheet #b", run: "enter", property_group: "opacity", duration_ms: 200, easing: "ease-out", frame: 1, at_ms: 16, where: "B, Phone, light" },
      { component: "Sheet", piece: "Sheet #c", run: "enter", property_group: "opacity", duration_ms: 320, easing: "linear", frame: 1, at_ms: 16, where: "C, Phone, light" },
      { component: "Sheet", piece: "Sheet #a", run: "leave", property_group: "opacity", duration_ms: 120, easing: "ease-in", frame: 1, at_ms: 16, where: "A, Phone, light" },
    ];
    const found = findSiblingsThatDiffer(entries);
    expect(found).toHaveLength(1);
    expect(found[0].said).toContain("320 ms, linear");
    expect(found[0].said).toContain("200 ms, ease-out");
    expect(siblingEntries(recording([], { animations: [{ piece_id: 0, property_group: "opacity", duration_ms: 0, easing: "linear", is_looping: false, first_frame: 0, last_frame: 1 }] }), "A")).toEqual([]);
  });

  it("measures lightness between colours", () => {
    expect(lightnessGap("rgb(255, 255, 255)", "rgb(0, 0, 0)")).toBeCloseTo(1);
    expect(lightnessGap("rgb(240, 240, 240)", "rgb(250, 250, 250)")).toBeLessThan(0.1);
  });

  it("runs the bench's states for a page, and marks each address as a bench screen", () => {
    const { places, states } = motionRuns("/signin");
    expect(places.map((place: { name: string }) => place.name)).toContain("Sign in");
    expect(states.length).toBeGreaterThan(0);
    expect(motionRuns("/signin", "wrong-password").states).toHaveLength(1);
    expect(markedUrl("http://localhost:8800", "/g/cave-crew?play", "turned", "Moss_Runner")).toBe("http://localhost:8800/g/cave-crew?play&bench_screen=motion.turned.Moss_Runner.still");
  });
});

const STYLE = `body { margin: 0; font: 16px sans-serif; background: #eee; } main { padding: 20px; }
.glass-pane { position: absolute; left: 20px; top: 80px; width: 200px; height: 150px; background: #fff; }
.icon-holder { position: absolute; left: 20px; top: 260px; } svg.icon { display: block; transition: transform 150ms ease-out; } svg.icon.is-turned { transform: translateY(30px); }
.sheet { position: absolute; top: 320px; left: 20px; width: 200px; height: 120px; background: #ccd; opacity: 0; visibility: hidden; transition: opacity 200ms ease-out, visibility 0s 200ms; }
.sheet.is-open { opacity: 1; visibility: visible; transition: opacity 200ms ease-out; } #sheet-b { left: 240px; }`;
const SCRIPT = `for (const button of document.querySelectorAll("[aria-pressed]")) button.addEventListener("click", () => {
  const isOn = button.getAttribute("aria-pressed") !== "true"; button.setAttribute("aria-pressed", String(isOn));
  const el = document.getElementById(button.dataset.target); el.classList.toggle(button.dataset.class, isOn);
});`;
const page = (extraStyle: string, extraScript: string) => `<!doctype html><html><head><style>${STYLE}${extraStyle}</style></head><body><main>
<button aria-pressed="false" data-target="pane" data-class="is-open">Pane</button><button aria-pressed="false" data-target="icon" data-class="is-turned">Icon</button>
<button aria-pressed="false" data-target="sheet-a" data-class="is-open">Sheet A</button><button aria-pressed="false" data-target="sheet-b" data-class="is-open">Sheet B</button>
<div class="glass-pane" id="pane">A pane</div><div class="icon-holder"><svg class="icon" id="icon" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg></div>
<div class="sheet" id="sheet-a">A</div><div class="sheet" id="sheet-b">B</div></main><script>${SCRIPT}${extraScript}</script></body></html>`;
/** Breaks each rule: the pane pops, the icon nudges 3px after its move ends, and sheet B enters on another curve. A flash is timed in milliseconds, which a busy runner's frames can stretch, so it's proven on recordings above. */
const FAULTY = page(`.glass-pane { display: none; } .glass-pane.is-open { display: block; } #sheet-b, #sheet-b.is-open { transition: opacity 320ms linear, visibility 0s 320ms; } #sheet-b.is-open { transition: opacity 320ms linear; }`,
  `document.getElementById("icon").addEventListener("transitionend", (event) => setTimeout(() => { event.target.style.marginTop = event.target.classList.contains("is-turned") ? "3px" : "0px"; }, 200));`);
/** Moves well: the pane fades, the icon rests where its move ends, both sheets enter alike, and the page has one background. */
const CLEAN = page(`.glass-pane { opacity: 0; visibility: hidden; transition: opacity 200ms ease-out, visibility 0s 200ms; } .glass-pane.is-open { opacity: 1; visibility: visible; transition: opacity 200ms ease-out; }`, "");

const chromePath = findChrome() as Promise<string | null>;
const folder = temporaryFolder("zaisma-motion-test-");

describe("the motion sheet in Chrome, on fixture pages", async () => {
  const path = await chromePath;
  const looks = [{ screen: MOTION_SCREENS[2], theme: "light" }];
  const run = async (name: string, markup: string) => {
    writeFileSync(join(folder, `${name}.html`), markup);
    return moveThroughPages({ chromePath: path, site: null, pages: [{ name, path: pathToFileURL(join(folder, `${name}.html`)).href, profile: null, states: [] }], looks });
  };

  it.skipIf(!path || typeof WebSocket !== "function")("fails the popping pane, the jittering icon and the sibling sheets on different curves", async () => {
    const { failures, run_count: runCount } = await run("faulty", FAULTY);
    expect(runCount).toBe(9);
    const kinds = (kind: string) => failures.filter((failure: { kind: string }) => failure.kind === kind);
    expect(kinds("pop").map((failure: { piece: string }) => failure.piece)).toContain('Glass pane #pane "A pane"');
    expect(kinds("jitter").map((failure: { piece: string }) => failure.piece)).toContain("svg.icon #icon");
    // Sheet B enters and leaves on its own curve: both differ from Sheet A.
    expect(kinds("siblings_differ").map((failure: { component: string; said: string }) => `${failure.component} ${failure.said.split(" with ")[0]}`)).toEqual(["Sheet entering", "Sheet leaving"]);
    expect(kinds("siblings_differ")[0].said).toContain("320 ms, linear");
  }, 90_000);

  it.skipIf(!path || typeof WebSocket !== "function")("passes the page that moves well", async () => {
    const { failures, run_count: runCount } = await run("clean", CLEAN);
    expect(runCount).toBe(9);
    expect(failures).toEqual([]);
  }, 90_000);
});
