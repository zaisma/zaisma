#!/usr/bin/env node
// The motion sheet: how a page moves, measured, where the layout check only sees where things rest. On this checkout's preview it loads the
// page, switches to each of its own pages, and opens and closes every state the Screens bench lists for it (scripts/preview/bench/places.ts),
// on a phone (320 x 667), the phone turned and a laptop, in light and dark, in a headless Chrome without the GPU. A page with no state on the
// bench (a gallery group) has its own controls pressed instead: whatever opens, switches or toggles something. In each run a script in the
// page reads every moving piece once a frame (requestAnimationFrame): its opacity, blur, transform and box, and what animates it. It fails on:
//   - a pop: a property that steps further in one frame than its transition allows, or appears, vanishes or jumps with none;
//   - jitter: a box that moves after the run's last transition has ended;
//   - siblings that differ: two uses of one component that enter or leave with different durations or curves;
//   - a flash: a page's background, a label or a piece that holds a value for under FLASH_DURATION_LIMIT_MS before changing again.
// Each failure says the piece, the state, the screen and theme, the run and the frame. With --pictures, each run's frames are saved as one
// strip, for the art-director reviewer.
//
//   npm run motion:sheet -- --only /design/actions        the pages whose path has that in it, every state, screen and theme
//   npm run motion:sheet -- --only /g/cave-crew --state share   one state only (its stateValue on the bench)
//   npm run motion:sheet -- --only /signin --pictures <folder>  and a strip of frames per run, <folder>/<state>-<screen>-<theme>-<run>.png
//   npm run motion:sheet -- --only /signin --json
//
// It runs under the local budget (scripts/check-budget.mjs): one local run at a time, at low priority, watched for time, cores, memory and
// heat, stopping over a hard limit and never saying PASS then. One Chrome, closed on exit. The whole site runs nowhere locally: --only is
// needed. npm run check runs it on the pages a change names, with the layout check.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openChrome } from "./chrome.mjs";
import { chromeToRun, MEASURE_ONLY, previewSites } from "./layout-check.mjs";
import { DURATION_HARD_SEC, budgetLine, readMachineState, releaseRunTurn, startBudgetWatch, waitForRunTurn } from "./check-budget.mjs";
import { runAtLowPriority } from "./preview/memory.mjs";
import { BENCH_PLACES, readyStates } from "./preview/bench/places.ts";
import { INSPECTED_COMPONENTS } from "../apps/site/src/components/inspected-components.ts";

/** The screens it moves on: the smallest phone the site takes, that phone turned, and a laptop. Each is a bench screen (its mark's name). */
export const MOTION_SCREENS = [
  { name: "Phone", screenName: "phone", widthPx: 320, heightPx: 667, isPhone: true },
  { name: "Turned phone", screenName: "turned", widthPx: 667, heightPx: 320, isPhone: true },
  { name: "Laptop", screenName: "laptop", widthPx: 1440, heightPx: 900, isPhone: false },
];
export const MOTION_THEMES = ["light", "dark"];
/** The least step in one frame a person sees, by property: below it nothing pops. Opacity is the piece's own times its holders'. */
export const NOTICEABLE_STEP = { opacity: 0.25, blur_px: 3, backdrop_blur_px: 3, translate_px: 12, scale: 0.08, place_px: 16, size_px: 16 };
/** How much steeper than straight a curve may run: an ease-out's first frames cover up to about four times their share of the move. */
export const STEEPEST_CURVE_SLOPE = 4;
/** A box that moves this far after the run's last transition has jittered. */
export const JITTER_STEP_PX = 1;
/** A value held for less than this before it changes again has flashed. */
export const FLASH_DURATION_LIMIT_MS = 100;
/** Two durations this close are one. */
export const DURATION_MATCH_MS = 16;
/** How long a run waits with nothing moving before it ends, and the longest a run takes: a load, and anything else. */
const QUIET_MS = 600;
const LONGEST_LOAD_MS = 6000;
const LONGEST_RUN_MS = 2500;
const SHORTEST_RUN_MS = 400;
/** The most of a page's own controls pressed when the bench lists no state for it. */
export const MOST_PRESSES_PER_PAGE = 12;
/** How long a local run goes before it stops and says what's left: under the budget's hard limit, and within npm run check half of it, with room for the rest. */
const LOCAL_RUN_LIMIT_SEC = DURATION_HARD_SEC - 30;
const IN_CHECK_RUN_LIMIT_SEC = Math.round(DURATION_HARD_SEC / 2);
/** How many frames a strip shows. */
const STRIP_FRAME_COUNT = 8;
const STRIP_FRAME_HEIGHT_PX = 300;

/** Piece names beyond the inspector's: what moves in and out. */
const MOVING_COMPONENTS = { "floating-pane": "Floating pane", "playing-card": "Card", notice: "Notice", loader: "Loader", "loading-line": "Loader", glint: "Glint", rail: "Rail", sidebar: "Sidebar", backdrop: "Backdrop" };

/**
 * The sampler, in the page from its start: window.__zaismaMotion.start(kind) begins a run, finish() ends it and answers its recording, and
 * quiet() says whether anything still moves. A load run starts by itself (start("load") at the document's start).
 *
 * A run's first frame is read as it starts, before what it does, so its first change is a step from the page as it was; a load's first
 * frame is its first paint.
 * A recording is { kind, frames_ms, parsed_frame, pieces: [{ piece_id, component, label }], changes, animations }. changes[piece_id] lists
 * [frame, values, text, background] each time a piece's values change, values being VALUE_NAMES; animations lists each animation seen:
 * { piece_id, property_group, duration_ms, easing, is_looping, first_frame, last_frame }.
 */
export const VALUE_NAMES = ["opacity", "blur_px", "backdrop_blur_px", "translate_x_px", "translate_y_px", "scale", "x_px", "y_px", "width_px", "height_px", "opacity_duration_ms", "move_duration_ms", "blur_duration_ms", "is_looping", "is_in_view", "is_painted"];
export const SAMPLER_SOURCE = `(() => {
  if (window.__zaismaMotion) return;
  const COMPONENTS = ${JSON.stringify({ ...INSPECTED_COMPONENTS, ...MOVING_COMPONENTS })};
  const LAYERS = "dialog, [popover], .playing-card, .notice, .floating-pane, .sheet, .tray, .glass-pane, [class*='loader'], [class*='loading'], [class*='glint']";
  const PIECES = ".run-wrap, .cut-btn, .tertiary-btn, .toggle, .switch-well, .tab-switch, .cover, .banner, .tag, .check, .cut-field, .field, .top, .foot, .rail, .sidebar, header, nav, main > *, button, a, svg, img, h1, h2, h3, [role='status'], [role='progressbar']";
  const LABELS = "button, a, h1, h2, h3, label, .tag, [role='status'], [role='tab']";
  const MOST_PIECES = 500;
  const GROUP_OF = (name) => /^opacity$/.test(name) ? 0 : /filter/.test(name) ? 2 : /^(transform|translate|scale|rotate|left|top|right|bottom|inset.*|width|height|max-height|max-width|min-height|min-width|margin.*|padding.*|grid-template.*|flex.*)$/.test(name) ? 1 : -1;
  let pieces = [], byElement = new Map(), changes = [], lastValues = [], frames = [], scrolls = [], animations = new Map(), kind = null, frame = -1, parsedFrame = null, lastMoveMs = 0, startMs = 0;
  const nameOf = (el) => { if (el === document.documentElement) return "Page"; for (const name of el.classList || []) if (COMPONENTS[name]) return COMPONENTS[name]; const first = el.classList && el.classList[0]; return el.tagName.toLowerCase() + (first ? "." + first : ""); };
  const labelOf = (el) => { if (el === document.documentElement) return "the page"; const words = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 32); return (el.id ? "#" + el.id : "") + (words ? (el.id ? " " : "") + JSON.stringify(words) : el.id ? "" : "<" + el.tagName.toLowerCase() + (el.classList && el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "") + ">"); };
  const add = (el, isInserted = false) => { if (!el || byElement.has(el) || pieces.length >= MOST_PIECES || el.closest("[data-motion-ignore]")) return; byElement.set(el, pieces.length); pieces.push({ el, piece_id: pieces.length, component: nameOf(el), label: labelOf(el), isLabel: el.matches(LABELS), isLayer: el.matches(LAYERS) || el === document.documentElement, isInserted }); changes.push([]); lastValues.push(null); };
  // What's put in the page while a run records is read from that frame on, and known to have come in then.
  new MutationObserver((records) => { if (!kind) return; for (const record of records) for (const node of record.addedNodes) { if (node.nodeType !== 1) continue; for (const el of [node, ...node.querySelectorAll(LAYERS + ", " + PIECES)]) if (el.matches(LAYERS + ", " + PIECES)) add(el, frame > (parsedFrame ?? Infinity)); } }).observe(document, { childList: true, subtree: true });
  const scan = () => { add(document.documentElement); for (const selector of [LAYERS, PIECES]) for (const el of document.querySelectorAll(selector)) { if (pieces.length >= MOST_PIECES) return; add(el); } };
  const blurOf = (text) => { const found = /blur\\(([\\d.]+)px\\)/.exec(text || ""); return found ? Number(found[1]) : 0; };
  const moveOf = (style) => {
    let tx = 0, ty = 0, scale = 1;
    const matrix = /matrix(3d)?\\(([^)]+)\\)/.exec(style.transform);
    if (matrix) { const n = matrix[2].split(",").map(Number); if (matrix[1]) { tx = n[12]; ty = n[13]; scale = Math.hypot(n[0], n[1], n[2]); } else { tx = n[4]; ty = n[5]; scale = Math.hypot(n[0], n[1]); } }
    if (style.translate && style.translate !== "none") { const [x, y] = style.translate.split(" ").map(parseFloat); tx += x || 0; ty += y || 0; }
    if (style.scale && style.scale !== "none") scale *= parseFloat(style.scale) || 1;
    return [tx, ty, scale];
  };
  const painted = (style) => { const bg = style.backgroundColor; if (!/rgba\\(.*,\\s*0\\)$/.test(bg) && bg !== "transparent") return bg; const body = document.body ? getComputedStyle(document.body).backgroundColor : "transparent"; if (!/rgba\\(.*,\\s*0\\)$/.test(body) && body !== "transparent") return body; return /dark/.test(style.colorScheme) && matchMedia("(prefers-color-scheme: dark)").matches ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)"; };
  const round = (value, places) => { const scale = 10 ** places; return Math.round(value * scale) / scale; };
  // Places and sizes to the half pixel: a tenth of a pixel's drift is a rounding, not a move anyone sees.
  const half = (value) => Math.round(value * 2) / 2;
  const sample = (nowMs) => {
    frame += 1; frames.push(round(nowMs - startMs, 1)); scrolls.push([Math.round(scrollX), Math.round(scrollY)]);
    if (parsedFrame === null && document.readyState !== "loading") parsedFrame = frame;
    if (frame % 5 === 0) scan();
    const running = [];
    for (const animation of document.getAnimations()) {
      if (animation.playState !== "running" && animation.playState !== "pending") continue;
      const effect = animation.effect; const target = effect && effect.target; if (!target) continue;
      const timing = effect.getTiming(); const keyframes = effect.getKeyframes ? effect.getKeyframes() : [];
      const names = animation.transitionProperty ? [animation.transitionProperty] : [...new Set(keyframes.flatMap((keyframe) => Object.keys(keyframe).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key)).map((key) => key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()))))];
      const groups = [...new Set(names.map(GROUP_OF).filter((group) => group >= 0))];
      if (!groups.length) continue;
      const isLooping = timing.iterations === Infinity;
      const durationMs = typeof timing.duration === "number" ? timing.duration : 0;
      const easing = timing.easing && timing.easing !== "linear" ? timing.easing : (keyframes[0] && keyframes[0].easing) || "linear";
      add(target);
      running.push({ target, groups, durationMs, isLooping, pseudo: effect.pseudoElement || null });
      for (const group of groups) {
        const key = animation; let seen = animations.get(key); if (!seen) { seen = new Map(); animations.set(key, seen); }
        const record = seen.get(group); if (record) record.last_frame = frame;
        // One that began before this run (an entrance still ending as a close starts) is the run before's, for comparing siblings.
        else seen.set(group, { piece_id: byElement.get(target), pseudo_element: effect.pseudoElement || null, property_group: ["opacity", "move", "blur"][group], property_names: names, duration_ms: round(durationMs, 0), easing, is_looping: isLooping, is_started_in_run: animation.startTime === null || animation.startTime >= startMs - 20, first_frame: frame, last_frame: frame });
      }
    }
    const opacityOf = new Map();
    const effective = (el) => { if (!el || el.nodeType !== 1) return 1; if (opacityOf.has(el)) return opacityOf.get(el); const own = Number(getComputedStyle(el).opacity); const value = own * effective(el.parentElement); opacityOf.set(el, value); return value; };
    let isMoving = false;
    for (const piece of pieces) {
      const el = piece.el;
      if (!el.isConnected) { if (lastValues[piece.piece_id] && lastValues[piece.piece_id][0] !== 0) { const gone = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; changes[piece.piece_id].push([frame, gone, null, null]); lastValues[piece.piece_id] = gone; } continue; }
      const style = getComputedStyle(el); const box = el.getBoundingClientRect();
      const isShown = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      const [tx, ty, scale] = moveOf(style);
      const durations = [0, 0, 0]; let isLooping = 0;
      // A ::before or ::after's animation is its element's own look; a ::backdrop's is the dim behind it, no part of the element.
      for (const run of running) if (run.pseudo !== "::backdrop" && (run.target === el || (!run.pseudo && run.target.contains(el)))) { if (run.isLooping) isLooping = 1; else for (const group of run.groups) durations[group] = Math.max(durations[group], run.durationMs); }
      // What the piece paints itself, or its ::before or ::after does for a layer (a floating pane's glass is its ::before): a holder that
      // paints nothing can't pop, whatever its opacity does; what's in it is judged.
      const paints = (look) => !/rgba\(.*,\s*0\)$|^transparent$/.test(look.backgroundColor) || (look.backdropFilter && look.backdropFilter !== "none") || look.boxShadow !== "none" || (parseFloat(look.borderTopWidth) > 0 && !/rgba\(.*,\s*0\)$/.test(look.borderTopColor)) || look.backgroundImage !== "none";
      const pseudoLook = piece.isLayer ? ["::before", "::after"].map((pseudo) => getComputedStyle(el, pseudo)).find((look) => look.content !== "none" && paints(look)) : null;
      const isPainted = /^(svg|img|canvas|video|input|textarea|select|html)$/i.test(el.tagName) || paints(style) || Boolean(pseudoLook) || [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      const ownOpacity = isShown ? effective(el) * (pseudoLook && !paints(style) ? Number(pseudoLook.opacity) : 1) : 0;
      const values = [round(ownOpacity, 2), round(blurOf(style.filter), 1), round(blurOf(style.backdropFilter || style.webkitBackdropFilter), 1), half(tx), half(ty), round(scale, 3), half(box.x), half(box.y), half(box.width), half(box.height), round(durations[0], 0), round(durations[1], 0), round(durations[2], 0), isLooping, isShown && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth ? 1 : 0, isPainted ? 1 : 0];
      const text = piece.isLabel ? (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60) : null;
      const background = piece.isLayer ? (el === document.documentElement ? painted(style) : style.backgroundColor) : null;
      const last = lastValues[piece.piece_id];
      const key = JSON.stringify([values, text, background]);
      if (!last || last.key !== key) {
        if (last && !isLooping) isMoving = true;
        changes[piece.piece_id].push([frame, values, text, background]);
        lastValues[piece.piece_id] = { key, 0: values[0] };
      }
    }
    if (isMoving || running.some((run) => !run.isLooping)) lastMoveMs = nowMs;
  };
  const loop = (nowMs) => { if (!kind) return; sample(nowMs); requestAnimationFrame(loop); };
  window.__zaismaMotion = {
    start(runKind) { pieces = []; byElement = new Map(); changes = []; lastValues = []; frames = []; scrolls = []; animations = new Map(); frame = -1; parsedFrame = runKind === "load" ? null : 0; kind = runKind; startMs = performance.now(); lastMoveMs = startMs; scan(); if (runKind !== "load") sample(startMs); requestAnimationFrame(loop); return true; },
    quiet() { return { frame_count: frame + 1, still_ms: Math.round(performance.now() - lastMoveMs), run_ms: Math.round(performance.now() - startMs) }; },
    finish() {
      const recording = { kind, frames_ms: frames, scrolls_px: scrolls, parsed_frame: parsedFrame ?? 0, pieces: pieces.map(({ el, piece_id, component, label, isInserted }) => { let walk = el.parentElement; while (walk && !byElement.has(walk)) walk = walk.parentElement; return { piece_id, component, label, is_inserted: isInserted, parent_piece_id: walk ? byElement.get(walk) : null }; }), changes, animations: [...animations.values()].flatMap((seen) => [...seen.values()]).filter((record) => record.piece_id !== undefined) };
      kind = null;
      return recording;
    },
  };
  if (document.readyState === "loading" || document.documentElement) window.__zaismaMotion.start("load");
})();`;

/** A piece's values at every frame, held between its changes: null before it was first read. */
export function valuesByFrame(recording, pieceId) {
  const out = new Array(recording.frames_ms.length).fill(null);
  const changes = recording.changes[pieceId] ?? [];
  for (let index = 0; index < changes.length; index += 1) {
    const [from, values, text, background] = changes[index];
    const until = index + 1 < changes.length ? changes[index + 1][0] : out.length;
    for (let frame = from; frame < until; frame += 1) out[frame] = { values, text, background };
  }
  return out;
}

const valueOf = (values, name) => values[VALUE_NAMES.indexOf(name)];
const pieceName = (recording, pieceId) => { const piece = recording.pieces[pieceId]; return `${piece.component} ${piece.label}`; };
const DURATION_OF = { opacity: "opacity_duration_ms", blur_px: "blur_duration_ms", backdrop_blur_px: "blur_duration_ms", translate_px: "move_duration_ms", scale: "move_duration_ms", place_px: "move_duration_ms", size_px: "move_duration_ms" };
const stepOf = (property, before, after) => {
  if (property === "translate_px") return Math.max(Math.abs(valueOf(after, "translate_x_px") - valueOf(before, "translate_x_px")), Math.abs(valueOf(after, "translate_y_px") - valueOf(before, "translate_y_px")));
  if (property === "place_px") return Math.max(Math.abs(valueOf(after, "x_px") - valueOf(before, "x_px")), Math.abs(valueOf(after, "y_px") - valueOf(before, "y_px")));
  if (property === "size_px") return Math.max(Math.abs(valueOf(after, "width_px") - valueOf(before, "width_px")), Math.abs(valueOf(after, "height_px") - valueOf(before, "height_px")));
  return Math.abs(valueOf(after, property) - valueOf(before, property));
};
const PROPERTY_WORDS = { opacity: "opacity", blur_px: "blur", backdrop_blur_px: "the blur behind it", translate_px: "its translate", scale: "its scale", place_px: "its place", size_px: "its size" };
const unit = (property) => (property === "opacity" || property === "scale" ? "" : "px");

/**
 * Pops in one recording: a step in one frame past what the piece's running transition allows (a share of its whole move as big as the
 * frame's share of the transition, times STEEPEST_CURVE_SLOPE), or any noticeable step with no transition. A piece that comes in or goes
 * while the page is still being read (a load before parsed_frame) is the page arriving. Place and size count only while the piece shows.
 */
export function findPops(recording) {
  return outermostOnly(recording, popsOf(recording));
}

/** A piece's values count as in view unless the sampler said otherwise (a recording from before it said). */
const isInView = (values) => values[VALUE_NAMES.indexOf("is_in_view")] !== 0;
const isPainted = (values) => values[VALUE_NAMES.indexOf("is_painted")] !== 0;
/** Whether the page scrolled into this frame: every box moved with it. */
const isScrolled = (recording, frame) => { const scrolls = recording.scrolls_px; return Boolean(scrolls && scrolls[frame] && scrolls[frame - 1] && (scrolls[frame][0] !== scrolls[frame - 1][0] || scrolls[frame][1] !== scrolls[frame - 1][1])); };

/**
 * Failures less those whose holder failed the same way, on the same property, in the same frame: a pane that pops is one pop, not one for
 * each thing in it, and a pane that moves is one jitter. A holder that only grew because what's in it moved doesn't hide what moved.
 */
export function outermostOnly(recording, failures) {
  const failed = new Set(failures.map((failure) => `${failure.piece_id} ${failure.frame} ${failure.kind} ${failure.property}`));
  return failures.filter((failure) => {
    for (let holder = recording.pieces[failure.piece_id]?.parent_piece_id; holder !== null && holder !== undefined; holder = recording.pieces[holder]?.parent_piece_id) {
      if (failed.has(`${holder} ${failure.frame} ${failure.kind} ${failure.property}`)) return false;
    }
    return true;
  }).map(({ piece_id: _pieceId, ...failure }) => failure);
}

function popsOf(recording) {
  const found = [];
  const frames = recording.frames_ms;
  for (const { piece_id: pieceId } of recording.pieces) {
    const series = valuesByFrame(recording, pieceId);
    const firstFrame = series.findIndex(Boolean);
    for (const property of Object.keys(NOTICEABLE_STEP)) {
      for (let frame = Math.max(1, firstFrame); frame < frames.length; frame += 1) {
        const after = series[frame]?.values;
        // A piece first read mid-run came in then: it was nowhere the frame before.
        const before = series[frame - 1]?.values ?? (frame === firstFrame && recording.pieces[pieceId].is_inserted ? [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] : null);
        if (!before || !after || frame <= recording.parsed_frame) continue;
        if (valueOf(before, "is_looping") || valueOf(after, "is_looping")) continue;
        // Only what's on the screen can be seen to pop: a piece out of view, or one laid out only as it scrolls near, can't.
        if (!isInView(before) && !isInView(after)) continue;
        // A holder that paints nothing of its own can't be seen to come or go: what's in it is judged instead.
        if (property === "opacity" && !(valueOf(after, "opacity") > 0 ? isPainted(after) : isPainted(before))) continue;
        // A place or size that steps while the page loads is the layout check's (nothing moves after the first paint), and one while the
        // page scrolls is the scroll.
        if ((property === "place_px" || property === "size_px") && (recording.kind === "load" || recording.kind === "switch" || isScrolled(recording, frame))) continue;
        const isShownBoth = valueOf(before, "opacity") > 0 && valueOf(after, "opacity") > 0;
        if ((property === "place_px" || property === "size_px" || property === "translate_px" || property === "scale") && !isShownBoth) continue;
        if (property !== "opacity" && !isShownBoth) continue;
        const step = stepOf(property, before, after);
        if (step < NOTICEABLE_STEP[property]) continue;
        const durationName = DURATION_OF[property];
        const durationMs = Math.max(valueOf(before, durationName), valueOf(after, durationName));
        const frameMs = frames[frame] - frames[frame - 1];
        let allowed = 0;
        if (durationMs > 0) {
          // The whole move: what the property covers while that transition runs, a frame either side.
          let from = frame, to = frame;
          while (from > 0 && series[from - 1] && valueOf(series[from - 1].values, durationName) > 0) from -= 1;
          while (to + 1 < frames.length && series[to + 1] && valueOf(series[to + 1].values, durationName) > 0) to += 1;
          const reached = [];
          for (let each = Math.max(0, from - 1); each <= Math.min(frames.length - 1, to + 1); each += 1) if (series[each]) reached.push(series[each].values);
          const span = Math.max(...reached.map((values) => stepOf(property, reached[0], values)), step);
          allowed = span * Math.min(1, (STEEPEST_CURVE_SLOPE * frameMs) / durationMs);
        }
        if (step <= allowed + NOTICEABLE_STEP[property] / 2) continue;
        const words = durationMs > 0 ? `its ${Math.round(durationMs)} ms transition allows ${round(allowed, 2)}${unit(property)} in a ${Math.round(frameMs)} ms frame` : "nothing animates it";
        const what = property === "opacity" && valueOf(before, "opacity") === 0 ? "appears" : property === "opacity" && valueOf(after, "opacity") === 0 ? "vanishes" : `${PROPERTY_WORDS[property]} steps`;
        found.push({ kind: "pop", piece_id: pieceId, piece: pieceName(recording, pieceId), component: recording.pieces[pieceId].component, property, frame, at_ms: frames[frame], said: `${what} ${round(step, 2)}${unit(property)} in one frame (${property === "opacity" ? `opacity ${valueOf(before, "opacity")} to ${valueOf(after, "opacity")}` : "one frame"}): ${words}` });
        break;
      }
    }
  }
  return found;
}

/** The last frame anything in the recording was still being animated (looping animations aside), or -1. */
export function lastMovingFrame(recording) {
  return Math.max(-1, ...recording.animations.filter((record) => !record.is_looping).map((record) => record.last_frame));
}

/** Jitter in one recording: a piece that shows, isn't looping and moves or resizes by JITTER_STEP_PX or more after the last transition. */
export function findJitter(recording) {
  const found = [];
  const frames = recording.frames_ms;
  const settledFrame = Math.max(lastMovingFrame(recording) + 1, recording.parsed_frame);
  for (const { piece_id: pieceId } of recording.pieces) {
    const series = valuesByFrame(recording, pieceId);
    for (let frame = settledFrame + 1; frame < frames.length; frame += 1) {
      const before = series[frame - 1]?.values, after = series[frame]?.values;
      if (!before || !after || valueOf(before, "is_looping") || valueOf(after, "is_looping")) continue;
      if (!(valueOf(before, "opacity") > 0 && valueOf(after, "opacity") > 0) || !isInView(after) || isScrolled(recording, frame)) continue;
      const moveStep = Math.max(stepOf("place_px", before, after), stepOf("translate_px", before, after)), sizeStep = stepOf("size_px", before, after);
      const step = Math.max(moveStep, sizeStep);
      if (step < JITTER_STEP_PX) continue;
      found.push({ kind: "jitter", piece_id: pieceId, piece: pieceName(recording, pieceId), component: recording.pieces[pieceId].component, property: moveStep >= JITTER_STEP_PX ? "place" : "size", frame, at_ms: frames[frame], said: `moves ${round(step, 1)}px at ${Math.round(frames[frame])} ms, ${Math.round(frames[frame] - (frames[settledFrame] ?? 0))} ms after the last transition ended` });
      break;
    }
  }
  return outermostOnly(recording, found);
}

const colorOf = (text) => { const found = /rgba?\(([^)]+)\)/.exec(text ?? ""); if (!found) return null; const [red, green, blue, alpha = 1] = found[1].split(",").map(Number); return { red, green, blue, alpha }; };
/** How far two colours are apart in lightness, from 0 to 1. */
export function lightnessGap(first, second) {
  const a = colorOf(first), b = colorOf(second);
  if (!a || !b) return first === second ? 0 : 1;
  const lightness = ({ red, green, blue, alpha }) => ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) * alpha;
  return Math.abs(lightness(a) - lightness(b));
}

/**
 * Flashes in one recording: the page's background held for under FLASH_DURATION_LIMIT_MS before it changes a lot (a white or black frame at
 * load), a label's words held that briefly between two others, and a piece that shows or hides that briefly and comes back, unanimated.
 */
export function findFlashes(recording) {
  const found = [];
  const frames = recording.frames_ms;
  const endMs = frames[frames.length - 1] ?? 0;
  for (const { piece_id: pieceId } of recording.pieces) {
    const changes = recording.changes[pieceId] ?? [];
    const segments = (pick) => {
      const out = [];
      for (const [frame, values, text, background] of changes) {
        const value = pick(values, text, background);
        if (!out.length || out[out.length - 1].value !== value) out.push({ value, frame, values });
      }
      return out.map((segment, index) => ({ ...segment, duration_ms: (index + 1 < out.length ? frames[out[index + 1].frame] : endMs) - frames[segment.frame] }));
    };
    const name = pieceName(recording, pieceId), component = recording.pieces[pieceId].component;
    const background = segments((values, text, color) => color).filter((segment) => segment.value !== null);
    for (let index = 0; index + 1 < background.length; index += 1) {
      const segment = background[index], next = background[index + 1];
      if (segment.duration_ms < FLASH_DURATION_LIMIT_MS && lightnessGap(segment.value, next.value) > 0.3) {
        found.push({ kind: "flash", piece: name, component, property: "background", frame: segment.frame, at_ms: frames[segment.frame], said: `shows ${segment.value} for ${Math.round(segment.duration_ms)} ms, then ${next.value}` });
        break;
      }
    }
    const words = segments((values, text) => text).filter((segment) => segment.value !== null);
    for (let index = 1; index + 1 < words.length; index += 1) {
      const segment = words[index];
      if (segment.duration_ms < FLASH_DURATION_LIMIT_MS && isInView(segment.values) && segment.value !== words[index - 1].value && segment.value !== words[index + 1].value) {
        found.push({ kind: "flash", piece: name, component, property: "words", frame: segment.frame, at_ms: frames[segment.frame], said: `says ${JSON.stringify(segment.value)} for ${Math.round(segment.duration_ms)} ms between ${JSON.stringify(words[index - 1].value)} and ${JSON.stringify(words[index + 1].value)}` });
        break;
      }
    }
    const shown = segments((values) => (values[0] >= 0.5 ? "shown" : "hidden"));
    for (let index = 1; index + 1 < shown.length; index += 1) {
      const segment = shown[index];
      const isAnimated = valueOf(segment.values, "opacity_duration_ms") > 0 || valueOf(segment.values, "is_looping");
      if (segment.duration_ms < FLASH_DURATION_LIMIT_MS && !isAnimated && segment.frame > recording.parsed_frame && (isInView(segment.values) || isInView(shown[index - 1].values)) && (isPainted(segment.values) || isPainted(shown[index - 1].values))) {
        found.push({ kind: "flash", piece: name, component, property: "shown", frame: segment.frame, at_ms: frames[segment.frame], said: `is ${segment.value} for ${Math.round(segment.duration_ms)} ms, then ${shown[index + 1].value} again` });
        break;
      }
    }
  }
  return found;
}

/**
 * Siblings that differ across a page's runs: { component, run, property_group } seen entering (an open, a switch or a load) or leaving
 * (a close) with two durations or two curves. Each entry is { component, piece, run, property_group, duration_ms, easing, where }.
 */
export function findSiblingsThatDiffer(entries) {
  const found = [];
  const byKey = new Map();
  for (const entry of entries) {
    // A page arriving (a load or a switch) fades its whole page in: it's compared with other arrivals, never with a sheet that opens.
    const direction = entry.run === "leave" ? "leaving" : entry.run === "enter" ? "entering" : "arriving with the page";
    const key = `${entry.component} ${direction} ${entry.property_group}`;
    const first = byKey.get(key);
    if (!first) { byKey.set(key, entry); continue; }
    if (first.reported) continue;
    const isOtherDuration = Math.abs(first.duration_ms - entry.duration_ms) > DURATION_MATCH_MS;
    if (!isOtherDuration && first.easing === entry.easing) continue;
    first.reported = true;
    found.push({ kind: "siblings_differ", piece: entry.piece, component: entry.component, property: entry.property_group, frame: entry.frame, at_ms: entry.at_ms, where: entry.where,
      said: `${direction} with ${entry.property_group} over ${entry.duration_ms} ms, ${entry.easing} (${entry.where}), where ${first.piece} does ${first.duration_ms} ms, ${first.easing} (${first.where})` });
  }
  return found;
}

/** A recording's animations as sibling entries: every finite one of a named piece. */
export function siblingEntries(recording, where) {
  return recording.animations.filter((record) => !record.is_looping && record.duration_ms > 0 && record.is_started_in_run !== false).map((record) => ({
    component: `${recording.pieces[record.piece_id].component}${record.pseudo_element ? ` ${record.pseudo_element}` : ""}`, piece: `${pieceName(recording, record.piece_id)}${record.pseudo_element ? ` ${record.pseudo_element}` : ""}`, run: recording.kind, property_group: record.property_group,
    duration_ms: record.duration_ms, easing: record.easing, frame: record.first_frame, at_ms: recording.frames_ms[record.first_frame] ?? 0, where,
  }));
}

/** Everything wrong in one recording, but siblings, which compare runs. */
export function recordingFailures(recording) {
  return [...findPops(recording), ...findJitter(recording), ...findFlashes(recording)];
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** The runs of a page: its load, a switch to each of its own pages, and an open and a close of each state it holds. */
export function motionRuns(only, stateAsked = null) {
  const places = BENCH_PLACES.filter((place) => place.path.includes(only) || new RegExp(place.pathPattern).test(only));
  const states = readyStates().filter((state) => places.some((place) => place.placeValue === state.placeValue) || state.path.includes(only)).filter((state) => !stateAsked || state.stateValue === stateAsked);
  return { places, states };
}

/** The bench screen's mark on an address: the bench's server signs it in as the profile and puts the screen's script in the page. */
export function markedUrl(site, path, screenName, profile) {
  // Added by hand, so a bare word (?play) stays one: URLSearchParams would write it ?play=.
  const url = new URL(path, site);
  return `${url.origin}${url.pathname}${url.search ? `${url.search}&` : "?"}bench_screen=motion.${screenName}.${profile ?? "guest"}.still${url.hash}`;
}

/** What the page's own controls are, when the bench lists no state for it: what opens, switches or toggles, in view, up to MOST_PRESSES_PER_PAGE. */
const MARK_PRESSES = `(() => {
  const toggles = "main [aria-controls], main [popovertarget], main [role='switch'], main [aria-pressed], main [role='tab'], main [aria-expanded]";
  const isFree = (el) => !el.closest("[data-motion-ignore], dialog, [popover], form[method='post']") && el.getBoundingClientRect().width > 0;
  // What toggles or opens something first, then the page's other plain buttons (never a form's send), which may open a layer by script.
  const found = [...new Set([...document.querySelectorAll(toggles), ...document.querySelectorAll("main button[type='button']")])].filter(isFree).slice(0, ${MOST_PRESSES_PER_PAGE});
  return found.map((el, index) => { el.setAttribute("data-motion-press", String(index)); return { stateValue: "press-" + index, label: ((el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40)) || el.tagName.toLowerCase(), presses: "[data-motion-press='" + index + "']" }; });
})()`;

/**
 * Enters or leaves a state in the page: through the bench's own script where it's a bench screen, else a press of the control. Leaving a
 * press closes the layer it opened, or presses a toggle back; a plain button that opened nothing is left as it is.
 */
const stateScript = (state, isEntering) => `(async () => {
  const state = ${JSON.stringify(state)};
  // A bench state is entered the bench's way; it's left as a player leaves it: Escape for a layer, else the bench's own way.
  if (window.zaismaBenchScreen && !state.presses?.startsWith("[data-motion-press")) return ${isEntering ? "await window.zaismaBenchScreen.enterState(state)" : `(document.querySelector("dialog[open], [popover]:popover-open") ? "escape" : window.zaismaBenchScreen.leaveState(state))`};
  const control = document.querySelector(state.presses);
  if (!control) return false;
  const LAYERS = "dialog[open], [popover]:popover-open";
  ${isEntering ? `window.__zaismaMotionLayers = new Set(document.querySelectorAll(LAYERS));
  control.click();
  return true;` : `// A layer it opened is left by Escape, pressed by the sheet itself (escapeScript): the page's own way out, with its own exit.
  const opened = [...document.querySelectorAll(LAYERS)].filter((el) => !(window.__zaismaMotionLayers || new Set()).has(el)).pop();
  if (opened) return "escape";
  if (control.matches("[aria-pressed], [role='switch'], [aria-expanded], [aria-checked], [role='tab']")) control.click();
  return true;`}
})()`;

/**
 * Moves through a page's runs on every look in one Chrome: { failures, run_count, unfinished_run_count, strip_paths }. pages is
 * [{ name, path, profile, states }], each state a bench state (readyStates) or a press of the page's own control. With no states, a page's
 * controls are found and pressed. site null means each path is a whole address (a fixture). onRun is told each run as it ends.
 */
export async function moveThroughPages({ chromePath, site, pages, looks, picturesFolder = null, deadlineMs = Infinity, onRun = () => {} }) {
  const chrome = await openChrome(chromePath, "zaisma-motion-", { isDrawingOnCpu: !picturesFolder });
  const failures = [], stripPaths = [];
  let runCount = 0, unfinishedRunCount = 0;
  try {
    for (const page of pages) {
      const siblings = [];
      for (const { screen, theme } of looks) {
        const { browserContextId } = await chrome.send("Target.createBrowserContext");
        const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
        const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
        const send = (method, params = {}) => chrome.send(method, params, sessionId);
        const evaluate = async (expression) => { const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text); return result.value; };
        const frames = [];
        let isFilming = false;
        chrome.listen(sessionId, (method, params) => {
          if (method !== "Page.screencastFrame") return;
          send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
          if (isFilming) frames.push({ at_ms: params.metadata.timestamp * 1000, jpegBase64: params.data });
        });
        try {
          await send("Page.enable");
          await send("Runtime.enable");
          await send("Emulation.setDeviceMetricsOverride", { width: screen.widthPx, height: screen.heightPx, deviceScaleFactor: 1, mobile: screen.isPhone });
          await send("Emulation.setTouchEmulationEnabled", screen.isPhone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
          await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
          if (!picturesFolder) await send("Page.addScriptToEvaluateOnNewDocument", { source: MEASURE_ONLY });
          await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER_SOURCE });
          await send("Emulation.setFocusEmulationEnabled", { enabled: true });
          const where = (stateName) => `${stateName}, ${screen.name}, ${theme}`;
          const film = async (startedMs) => { if (!picturesFolder) return; await send("Page.startScreencast", { format: "jpeg", quality: 60, maxHeight: STRIP_FRAME_HEIGHT_PX * 2, everyNthFrame: 1 }); isFilming = true; frames.length = 0; return startedMs; };
          const waitQuiet = async (longestMs) => {
            for (;;) {
              await wait(100);
              const quiet = await evaluate("window.__zaismaMotion ? window.__zaismaMotion.quiet() : null").catch(() => null);
              if (!quiet) continue;
              if (quiet.run_ms >= longestMs || (quiet.run_ms >= SHORTEST_RUN_MS && quiet.still_ms >= QUIET_MS)) return;
            }
          };
          const finish = async (page, stateName, runKind, fileName) => {
            const recording = { ...(await evaluate("window.__zaismaMotion.finish()")), kind: runKind };
            runCount += 1;
            const found = recordingFailures(recording).map((failure) => ({ page: page.name, state: stateName, run: runKind, screen: screen.name, theme, ...failure }));
            failures.push(...found);
            siblings.push(...siblingEntries(recording, where(stateName)));
            if (picturesFolder) {
              isFilming = false;
              await send("Page.stopScreencast").catch(() => {});
              const path = join(picturesFolder, `${fileName}-${screen.screenName}-${theme}-${runKind}.png`);
              if (frames.length) { await strip(chrome, path, `${page.name}, ${stateName}: ${runKind}, ${screen.name}, ${theme}`, frames.slice(), found); stripPaths.push(path); }
            }
            onRun({ page: page.name, state: stateName, run: runKind, screen: screen.name, theme, failure_count: found.length });
          };
          const load = async (path, profile, stateName, fileName, runKind = "load") => {
            const loaded = new Promise((done) => { const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done())); });
            const url = site ? markedUrl(site, path, screen.screenName, profile) : path;
            await film();
            if (runKind === "switch") await evaluate(`(location.assign(${JSON.stringify(url)}), true)`);
            else await send("Page.navigate", { url });
            await Promise.race([loaded, wait(30_000)]);
            await waitQuiet(LONGEST_LOAD_MS);
            await finish(page, stateName, runKind, fileName);
          };
          let atPath = null;
          await load(page.path, page.profile, "the page loading", "load");
          atPath = `${page.path} ${page.profile ?? "guest"}`;
          const states = page.states?.length ? page.states : (await evaluate(MARK_PRESSES)).filter((state) => !page.stateAsked || state.stateValue === page.stateAsked);
          for (const state of states) {
            if (Date.now() > deadlineMs) { unfinishedRunCount += 1; continue; }
            const profile = state.profile ?? state.signedInProfile ?? page.profile;
            const fileName = (state.stateValue ?? "state").replace(/[^a-z0-9-]+/gi, "-");
            if (state.isOwnPage) {
              if (atPath !== `${page.path} ${page.profile ?? "guest"}`) await load(page.path, page.profile, "the page loading", "load");
              await load(state.path, profile, state.label, fileName, "switch");
              atPath = `${state.path} ${profile ?? "guest"}`;
              continue;
            }
            if (state.path && atPath !== `${state.path} ${profile ?? "guest"}`) {
              await load(state.path, profile, `${state.label}, its page loading`, `${fileName}-page`);
              atPath = `${state.path} ${profile ?? "guest"}`;
            }
            for (const isEntering of [true, false]) {
              await film();
              await evaluate(`window.__zaismaMotion.start(${JSON.stringify(isEntering ? "enter" : "leave")})`);
              const done = await evaluate(stateScript(state, isEntering)).catch(() => false);
              if (done === "escape") for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
              const isDone = Boolean(done);
              await waitQuiet(LONGEST_RUN_MS);
              if (!isDone && isEntering) { await evaluate("window.__zaismaMotion.finish()"); failures.push({ page: page.name, state: state.label, run: "enter", screen: screen.name, theme, kind: "not_reached", piece: "", component: "", property: "", frame: 0, at_ms: 0, said: "the state didn't open here: its control or layer isn't on this screen" }); break; }
              await finish(page, state.label, isEntering ? "enter" : "leave", fileName);
            }
            // What a close leaves behind (a scroll, a press's focus) shouldn't carry into the next state: it starts from a fresh load.
            atPath = null;
          }
        } finally {
          await chrome.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
        }
      }
      failures.push(...findSiblingsThatDiffer(siblings).map((failure) => ({ page: page.name, state: failure.where.split(", ").slice(0, -2).join(", "), run: "compare", screen: failure.where.split(", ").slice(-2, -1)[0], theme: failure.where.split(", ").slice(-1)[0], ...failure })));
    }
  } finally {
    await chrome.close();
  }
  return { failures, run_count: runCount, unfinished_run_count: unfinishedRunCount, strip_paths: stripPaths };
}

/** One run's frames as a strip: STRIP_FRAME_COUNT of them, evenly through the run, each with its time, and the run's failures under them. */
async function strip(chrome, path, title, frames, found) {
  const startMs = frames[0].at_ms;
  const picked = frames.length <= STRIP_FRAME_COUNT ? frames : Array.from({ length: STRIP_FRAME_COUNT }, (_, index) => frames[Math.round((index * (frames.length - 1)) / (STRIP_FRAME_COUNT - 1))]);
  const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const markup = `<!doctype html><style>body{margin:0;padding:12px;background:#222;color:#eee;font:13px system-ui;width:max-content}h1{font-size:15px;margin:0 0 8px}.row{display:flex;gap:8px}figure{margin:0}img{height:${STRIP_FRAME_HEIGHT_PX}px;display:block;background:#000}figcaption{margin-top:4px}ul{margin:8px 0 0;padding-left:18px;max-width:1800px}</style><h1>${escape(title)}</h1><div class="row">${picked.map((frame) => `<figure><img src="data:image/jpeg;base64,${frame.jpegBase64}"><figcaption>${Math.round(frame.at_ms - startMs)} ms</figcaption></figure>`).join("")}</div>${found.length ? `<ul>${found.map((failure) => `<li>${escape(`${failure.kind}: ${failure.piece}: ${failure.said}`)}</li>`).join("")}</ul>` : ""}`;
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  try {
    await send("Page.enable");
    const { frameTree } = await send("Page.getFrameTree");
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: markup });
    await wait(300);
    const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify([document.body.scrollWidth, document.body.scrollHeight])", returnByValue: true });
    const [widthPx, heightPx] = JSON.parse(result.value);
    await send("Emulation.setDeviceMetricsOverride", { width: widthPx, height: heightPx, deviceScaleFactor: 1, mobile: false });
    writeFileSync(path, Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  } finally {
    await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/** A failure as one line. */
export function failureLine(failure) {
  return `${failure.page}, ${failure.state} (${failure.run}), ${failure.screen} ${failure.theme}: ${failure.kind.replace("_", " ")}: ${failure.piece}: ${failure.said}${failure.frame ? ` [frame ${failure.frame}, ${Math.round(failure.at_ms)} ms]` : ""}`;
}

/** This process's group, for the budget's watch when it runs on its own. */
function ownProcessGroup() {
  const found = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" });
  return Number(found.stdout.trim()) || process.pid;
}

const VALUED = ["--only", "--state", "--pictures"];
const FLAGS = ["--json"];
const OPTIONS_WORDS = "The options are --only <part of a page's path>, --state <a state's value on the bench>, --pictures <folder> and --json.";

function stop(message, isJson, code = "stopped", exitCode = 2) {
  console.log(isJson ? JSON.stringify({ error: code, message }) : `MOTION FAIL: ${message}`);
  process.exit(exitCode);
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const isJson = args.includes("--json");
  const unknown = args.filter((arg, index) => !VALUED.includes(args[index - 1]) && !VALUED.includes(arg) && !FLAGS.includes(arg));
  if (unknown.length) stop(`Unknown option ${unknown.join(" ")}. ${OPTIONS_WORDS}`, isJson);
  for (const flag of VALUED) if (args.includes(flag) && (!valueOf(flag) || valueOf(flag).startsWith("--"))) stop(`${flag} takes a value. ${OPTIONS_WORDS}`, isJson);
  const only = valueOf("--only");
  if (!only || !only.startsWith("/")) stop(`Give --only <part of a page's path>, like --only /design/actions: the whole site runs nowhere on a person's machine. ${OPTIONS_WORDS}`, isJson, "whole_site_on_github");
  const { places, states } = motionRuns(only, valueOf("--state"));
  if (valueOf("--state") && !states.length && places.length) stop(`No state ${valueOf("--state")} on the bench for ${only}. Its states are ${motionRuns(only).states.map((state) => state.stateValue).join(", ") || "none: its own controls are pressed instead"}.`, isJson);
  const sites = previewSites({ isStarting: false });
  if (!sites) stop("This checkout's preview isn't running: npm run preview:start starts it.", isJson, "no_preview");
  const chromePath = await chromeToRun();
  if (!chromePath) stop("No Chrome here, and Chrome for Testing couldn't be fetched: set CHROME_PATH to a Chrome.", isJson, "no_chrome");
  // A page is a bench place (its states its own) or the path itself (a gallery group: its controls pressed).
  const pages = places.length
    ? places.map((place) => ({ name: place.name, path: place.path, profile: place.profile ?? (place.seenBy === "signed_in" ? "Moss_Runner" : "guest"), states: states.filter((state) => state.placeValue === place.placeValue) }))
    : [{ name: only, path: only, profile: "guest", states: [], stateAsked: valueOf("--state") }];
  const picturesFolder = valueOf("--pictures") ? resolve(valueOf("--pictures")) : null;
  if (picturesFolder) mkdirSync(picturesFolder, { recursive: true });

  // The budget: npm run check holds the machine's one run and watches its children, so a sheet it starts only runs.
  const isInCheck = Boolean(process.env.ZAISMA_CHECK_RUN_PID);
  runAtLowPriority();
  let watch = null;
  let hardLimits = [];
  if (!isInCheck && !process.env.CI) {
    // Fair heat is a warning line, not a stop: npm run check hands a run to GitHub there, but nothing on GitHub runs this sheet, so it starts
    // at fair and its watch stops it at serious, as the budget's hard limit says.
    const readState = () => { const state = readMachineState(); return state.heat_status === "fair" ? { ...state, heat_status: "nominal" } : state; };
    const turn = await waitForRunTurn({ say: (line) => process.stderr.write(`${line}\n`), readState });
    if (!turn.is_turn_taken) stop(`The Mac is busy (${turn.busy_reason}): run it again when it's free.`, isJson, "machine_busy", 5);
    process.on("exit", () => releaseRunTurn());
    watch = startBudgetWatch({ onHardLimit: (limits) => { hardLimits = limits; console.log(isJson ? JSON.stringify({ error: "over_budget", message: limits.map((limit) => limit.line).join("; ") }) : `MOTION OVER BUDGET: ${limits.map((limit) => limit.line).join("; ")}. It stopped there. Not a pass.`); process.exit(4); } });
    watch.addProcessGroup(ownProcessGroup());
  }
  const startedMs = Date.now();
  const looks = MOTION_SCREENS.flatMap((screen) => MOTION_THEMES.map((theme) => ({ screen, theme })));
  const answer = await moveThroughPages({
    chromePath, site: sites.site, pages, looks, picturesFolder, deadlineMs: process.env.CI ? Infinity : startedMs + (isInCheck ? IN_CHECK_RUN_LIMIT_SEC : LOCAL_RUN_LIMIT_SEC) * 1000,
    onRun: (run) => !isJson && console.log(`${run.failure_count ? "FAIL" : "  ok"} ${run.page}, ${run.state} (${run.run}), ${run.screen} ${run.theme}${run.failure_count ? `: ${run.failure_count}` : ""}`),
  });
  const numbers = watch?.stop();
  if (hardLimits.length) return;
  const durationSec = Math.round((Date.now() - startedMs) / 1000);
  if (isJson) console.log(JSON.stringify({ ...answer, duration_sec: durationSec, budget: numbers ?? null }, null, 2));
  else {
    for (const failure of answer.failures) console.log(`  ${failureLine(failure)}`);
    if (answer.strip_paths.length) console.log(`Strips: ${picturesFolder}`);
    if (numbers) console.log(budgetLine(numbers));
    const lookWords = `${MOTION_SCREENS.map((screen) => screen.name).join(", ")}, light and dark`;
    if (answer.failures.length) console.log(`MOTION FAIL: ${answer.failures.length} problem(s) in ${answer.run_count} runs on ${lookWords}.`);
    else if (answer.unfinished_run_count) console.log(`MOTION UNFINISHED: ${answer.run_count} runs passed in ${durationSec}s, and ${answer.unfinished_run_count} state(s) were left past the ${isInCheck ? IN_CHECK_RUN_LIMIT_SEC : LOCAL_RUN_LIMIT_SEC}s a local run takes: narrow with --state. Not a pass.`);
    else console.log(`MOTION PASS: ${answer.run_count} runs on ${lookWords}, in ${durationSec}s.`);
  }
  process.exit(answer.failures.length ? 1 : answer.unfinished_run_count ? 3 : 0);
}

function wait(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
