import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, floatingPane, glassPane, icon, well, type ColorChoice } from "./foundations.ts";
import { cutField } from "./fields.ts";
import { tabSwitch } from "./switch.ts";
import { tertiaryButton } from "./actions.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { examplePane } from "./example-pane.ts";
import { qrCodeSvg } from "@zaisma/core";

/*
 * Inputs: the fields (fields.ts), the switch (switch.ts) and the choices (choices.ts) are re-exported from here, so pages import every
 * input from one place. A number on a scale, a file drop and a copy field are defined here.
 */
export * from "./fields.ts";
export * from "./switch.ts";
export * from "./choices.ts";

export interface SliderOptions {
  name: string;
  label: string;
  minimumNumber: number;
  maximumNumber: number;
  stepNumber: number;
  pickedNumber: number;
  /** What the number counts, shown after it: "players", "%", "s". */
  unit: string;
  /** It can't be changed now: it shows its number, and its form sends nothing for it. */
  isDisabled?: boolean;
  /** Unique on the page. Defaults to slider-<name>. */
  id?: string;
  state?: "is-focused" | "is-pressed";
}

/** The number with its unit: "40%", "16 players". */
const numberWords = (pickedNumber: number, unit: string) => `${pickedNumber.toLocaleString("en-US")}${unit === "%" ? "%" : ` ${unit}`}`;

/** A slider: a number on a scale (players in a room, a volume), dragged or stepped with the arrow keys. The system's own range input, drawn as Zaisma's. */
export function slider(options: SliderOptions): Raw {
  const id = options.id ?? `slider-${options.name}`;
  const filledPct = (100 * (options.pickedNumber - options.minimumNumber)) / Math.max(1e-9, options.maximumNumber - options.minimumNumber);
  const className = ["slider", options.state ?? "", options.isDisabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  return html`<div class="${className}" style="--fill:${(Math.max(0, Math.min(100, filledPct)) / 100).toFixed(4)}"><div class="slider-head"><label for="${id}">${options.label}</label><output for="${id}" data-unit="${options.unit}">${numberWords(options.pickedNumber, options.unit)}</output></div><div class="slider-track"><span class="slider-line" aria-hidden="true" data-cut-line="3">${CUT_LINE}</span><span class="slider-fill" aria-hidden="true"><span class="slider-light" data-cut-line="3">${CUT_LINE}</span></span><input class="slider-input" type="range" id="${id}" name="${options.name}" min="${options.minimumNumber}" max="${options.maximumNumber}" step="${options.stepNumber}" value="${options.pickedNumber}"${options.isDisabled ? raw(" disabled") : ""} data-slider><span class="slider-thumb" aria-hidden="true"><span class="slider-slab cut-raised" data-cut-line="6">${CUT_LINE}</span></span></div></div>`;
}

/** A slider's fill and number follow its thumb. */
export const SLIDER_SCRIPT = `/* sliders */(function () {
  function follow(input) {
    var box = input.closest(".slider"), min = Number(input.min), max = Number(input.max), output = box.querySelector("output"), unit = output.getAttribute("data-unit");
    box.style.setProperty("--fill", ((Number(input.value) - min) / Math.max(1e-9, max - min)).toFixed(4));
    // The thumb's shape follows the edge rule where it now sits: cut where it meets its pane's corner, square in the middle.
    var slab = box.querySelector(".slider-slab"); if (slab && slab.redrawCut) slab.redrawCut();
    output.textContent = Number(input.value).toLocaleString("en-US") + (unit === "%" ? "%" : " " + unit);
  }
  document.addEventListener("input", function (event) { if (event.target.matches && event.target.matches("input[data-slider]")) follow(event.target); });
  window.addEventListener("pageshow", function () { document.querySelectorAll("input[data-slider]").forEach(follow); });
})();
`;

component({
  name: "Slider",
  slug: "slider",
  group: "inputs",
  subgroup: "choices",
  summary: "A number on a scale: players in a room, a volume. Dragged, tapped or stepped with the arrow keys; the number shows with its unit as it moves. There are no knobs: this covers them.",
  styles: `
/* A slider: a line for a track, filled orange up to a raised white slab, the thumb. The system's range input lies over the track,
   unseen, so dragging, tapping and the arrow keys work as they always do; SLIDER_SCRIPT moves the fill and the number with it. Its question
   sits at the start and its number at the end, apart, so they never read as one phrase. */
.slider { --thumb: 22px; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--gap-words-control); }
.slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap-words-words); }
.slider-head > label { padding-inline-start: var(--pad-words); font: var(--type-label); color: var(--ink-2); }
.slider-head > output { padding-inline-end: var(--pad-words); font: var(--type-label); color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
/* It fills a pane's width; in a pane that fits what's in it, its track is a card's width (--size-card), or what room there is. */
.slider-track { position: relative; height: var(--thumb); width: var(--size-card); min-width: 100%; max-width: 100%; }
/* The line is a groove carved into the glass, 8px wide so its two edges read apart: deep shade under its near, upper edge and a crisp line of
   light along its far, lower lip, where the light from above lands (--groove-shade, --groove-lip). Its face stays the toggle slot's when
   off: a carving reads by its edges, never by a brighter face. What's filled is orange light running inside it, glowing faintly past its lips. */
.slider-line, .slider-fill { position: absolute; pointer-events: none; left: calc(var(--thumb) / 2 - 4px); }
.slider-line { top: calc(50% - 4px); height: 8px; right: calc(var(--thumb) / 2 - 4px); background: var(--toggle-off);
  box-shadow: inset 0 3px 3px var(--groove-shade), inset 0 -1.5px 0 var(--groove-lip); clip-path: var(--cut-shape); }
/* The light lies in the groove a pixel in from its lips, from its very start to under the thumb's middle; the groove and the light are both
   cut by the edge rule, so where the groove's end meets the pane's cut corner, both are cut there. Its holder casts its glow, which follows
   the light's cut and spills past the lips. */
.slider-fill { top: calc(50% - 3px); height: 6px; width: calc(4px + (100% - var(--thumb)) * var(--fill)); filter: drop-shadow(0 0 3px var(--run)); }
.slider-light { position: absolute; inset: 0; background: linear-gradient(180deg, var(--run-hi), var(--run)); clip-path: var(--cut-shape); }
.slider-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; -webkit-appearance: none; appearance: none; }
/* On a phone the track takes a whole control's height (--control-height-regular) to touch, centered on it. */
@media (pointer: coarse) { .slider-input { inset: min(0px, calc(50% - var(--touch-target) / 2)) 0; height: auto; } }
.slider-input::-webkit-slider-thumb { -webkit-appearance: none; width: var(--thumb); height: var(--thumb); }
.slider-input::-moz-range-thumb { width: var(--thumb); height: var(--thumb); border: 0; }
/* Its thumb is the toggle's slab (the --thumb tokens): white and lit from above on either glass, its shadow cast onto the glass under it by
   its holder, so the shadow follows the slab's cut. Pointed, it lifts a touch; pressed, it's pushed down in place, never smaller, its shadow
   drawn in close and its face shaded from above. */
.slider-thumb { position: absolute; z-index: 2; top: 0; left: calc((100% - var(--thumb)) * var(--fill)); width: var(--thumb); height: var(--thumb); pointer-events: none;
  filter: var(--thumb-cast); transition: filter 0.2s; }
.slider-slab { position: relative; display: block; width: 100%; height: 100%; background: var(--thumb-face); clip-path: var(--cut-shape); transition: box-shadow 0.12s; }
.slider-slab::after { content: ""; position: absolute; inset: 0; background: var(--thumb-press-face); opacity: 0; transition: opacity 0.12s; }
.slider:not(.is-disabled):hover .slider-thumb, .slider.is-pointed .slider-thumb { filter: var(--thumb-cast-pointed); }
.slider-input:active + .slider-thumb, .slider.is-pressed .slider-thumb { filter: var(--thumb-cast-pressed); transition-duration: 0.08s; }
.slider-input:active + .slider-thumb > .slider-slab, .slider.is-pressed .slider-slab { box-shadow: var(--thumb-press-shade); }
.slider-input:active + .slider-thumb > .slider-slab::after, .slider.is-pressed .slider-slab::after { opacity: 1; transition-duration: 0.08s; }
/* Can't be changed now: the thumb rests flat, the number goes quieter, and no orange, since there's nothing to do: the fill is grey. */
.slider.is-disabled .slider-input { cursor: default; }
.slider.is-disabled .slider-head > output { color: var(--muted); }
.slider.is-disabled .slider-fill { filter: none; }
.slider.is-disabled .slider-light { background: var(--muted); }
.slider.is-disabled .slider-line { background: var(--off-face); box-shadow: none; }
/* Its thumb stays the slab it always is, as a toggle's does: the grey line and quiet number say it can't be moved. */
.slider.is-disabled .slider-slab > .cut-line polygon { stroke: var(--line); }
.slider-input:focus-visible + .slider-thumb > .slider-slab > .cut-line polygon, .slider.is-focused .slider-slab > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
`,
  render: slider,
  examples: [
    { label: "Rest", markup: examplePane(slider({ id: "example-slider-rest", name: "room_player_count", label: "Players in a room", minimumNumber: 2, maximumNumber: 100, stepNumber: 1, pickedNumber: 16, unit: "players" })) },
    { label: "Pressed", markup: examplePane(slider({ id: "example-slider-pressed", name: "room_player_count", label: "Players in a room", minimumNumber: 2, maximumNumber: 100, stepNumber: 1, pickedNumber: 64, unit: "players", state: "is-pressed" })), isStill: true },
    { label: "Keyboard focus", markup: examplePane(slider({ id: "example-slider-focus", name: "music_volume", label: "Music", minimumNumber: 0, maximumNumber: 100, stepNumber: 5, pickedNumber: 40, unit: "%", state: "is-focused" })), isStill: true },
    { label: "At its ends", markup: examplePane(html`${slider({ id: "example-slider-least", name: "music_volume", label: "Music", minimumNumber: 0, maximumNumber: 100, stepNumber: 5, pickedNumber: 0, unit: "%" })}${slider({ id: "example-slider-most", name: "effects_volume", label: "Effects", minimumNumber: 0, maximumNumber: 100, stepNumber: 5, pickedNumber: 100, unit: "%" })}`) },
    { label: "Big numbers", markup: examplePane(slider({ id: "example-slider-big", name: "world_player_count", label: "Players in a world", minimumNumber: 100, maximumNumber: 10000, stepNumber: 100, pickedNumber: 2400, unit: "players" })) },
    { label: "Can't be changed", markup: examplePane(slider({ id: "example-slider-disabled", name: "room_player_count_locked", label: "Players in a room", minimumNumber: 2, maximumNumber: 100, stepNumber: 1, pickedNumber: 32, unit: "players", isDisabled: true })) },
  ],
});

export interface FileDropFile {
  fileName: string;
  byteCount: number;
  /** While it uploads: how much of it has gone so far. */
  uploadedByteCount?: number;
}

export interface FileDropOptions {
  name: string;
  label: string;
  /** The kinds it takes, as a file input's accept: ".zip", "image/png,image/webp". A file of another kind is refused, in words. */
  accept: string;
  isMultiple?: boolean;
  /** What to drop, in a few words: "A .zip of your game's folder, up to 500 MB." */
  hint: string;
  /** The most one file may be, in bytes: a bigger one is refused, in words, before it's sent. */
  maximumByteCount?: number;
  /** What's wrong with what was picked, said under it: the wrong kind of file, or too big. */
  error?: string;
  /** Files picked already, listed under it with their sizes and, while they upload, how much has gone: for a page that sends them itself. */
  pickedFiles?: FileDropFile[];
  /** It can't take files now: it shows why in its hint, and its form sends nothing for it. */
  isDisabled?: boolean;
  /** Unique on the page. Defaults to drop-<name>. */
  id?: string;
  /** "over" shows a file held over it: the gallery's fixed state. */
  state?: "over";
}

/** A size in words: "640 KB", "482.3 MB", "1.25 GB", its number and unit kept on one line. */
const byteWords = (byteCount: number): string =>
  byteCount < 1e3 ? `${byteCount}\u00a0bytes` : byteCount < 1e6 ? `${Math.round(byteCount / 1e3)}\u00a0KB` : byteCount < 1e9 ? `${Number((byteCount / 1e6).toFixed(1))}\u00a0MB` : `${Number((byteCount / 1e9).toFixed(2))}\u00a0GB`;

/** One picked file's row: its name, its size, and while it uploads, how much has gone, with a line that fills as it goes. */
const fileRow = (file: FileDropFile): Raw => {
  const isUploading = file.uploadedByteCount !== undefined && file.uploadedByteCount < file.byteCount;
  const sentNumber = isUploading ? Math.max(0, Math.min(1, (file.uploadedByteCount ?? 0) / Math.max(1, file.byteCount))) : 0;
  return html`<li${isUploading ? html` class="is-uploading" style="--sent:${sentNumber.toFixed(4)}"` : ""}><span class="file-drop-name">${file.fileName}</span><span class="file-drop-size">${isUploading ? `${byteWords(file.uploadedByteCount ?? 0)} of ${byteWords(file.byteCount)}` : byteWords(file.byteCount)}</span></li>`;
};

/**
 * A file drop: a carved field the size of a pane, its outline drawn dashed, turning orange while a file is held over it. It's a real file
 * input across the whole field, so a drop, a tap and the keyboard all reach it; the files picked are listed under it with their sizes,
 * and a file of the wrong kind or too big is refused, in words, before it's sent.
 */
export function fileDrop(options: FileDropOptions): Raw {
  const id = options.id ?? `drop-${options.name}`;
  const files = options.pickedFiles ?? [];
  const className = ["file-drop", "cut-carved", options.state === "over" ? "is-over" : "", options.error ? "is-marked" : "", options.isDisabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  return html`<div class="file-drop-wrap" data-file-drop${options.maximumByteCount ? html` data-most-bytes="${options.maximumByteCount}"` : ""}><div class="${className}" data-cut-line="10">${CUT_LINE}<input class="file-drop-input" type="file" id="${id}" name="${options.name}" accept="${options.accept}"${options.isMultiple ? raw(" multiple") : ""} aria-describedby="${id}-hint${options.error ? ` ${id}-error` : ""}"${options.error ? raw(' aria-invalid="true"') : ""}${options.isDisabled ? raw(" disabled") : ""}>${icon("upload")}<span class="file-drop-words"><label for="${id}">${options.label}</label><span id="${id}-hint">${options.hint}</span></span></div><p class="field-error" id="${id}-error"${options.error ? "" : raw(" hidden")}>${options.error ?? ""}</p><ul class="file-drop-list" aria-live="polite"${files.length ? "" : raw(" hidden")}>${files.map(fileRow)}</ul></div>`;
}

/**
 * A file drop lights while a file is held over it, and lists what's picked, each with its size. A file of a kind it doesn't take, or bigger
 * than its most, is refused: the pick is cleared and what's wrong is said under it, in words.
 */
export const FILE_DROP_SCRIPT = `/* file drops */(function () {
  // A size in words, its number and unit kept on one line.
  function sizeWords(byteCount) {
    if (byteCount < 1e3) return byteCount + "\\u00a0bytes";
    if (byteCount < 1e6) return Math.round(byteCount / 1e3) + "\\u00a0KB";
    if (byteCount < 1e9) return Number((byteCount / 1e6).toFixed(1)) + "\\u00a0MB";
    return Number((byteCount / 1e9).toFixed(2)) + "\\u00a0GB";
  }
  document.querySelectorAll("[data-file-drop]").forEach(function (root) {
    var drop = root.querySelector(".file-drop"), input = root.querySelector(".file-drop-input"), list = root.querySelector(".file-drop-list"), error = root.querySelector(".field-error");
    var most = Number(root.getAttribute("data-most-bytes")) || 0, kinds = (input.getAttribute("accept") || "").split(",").map(function (kind) { return kind.trim().toLowerCase(); }).filter(Boolean);
    var depth = 0;
    // The kinds it takes, in words: ".zip", or ".png, .jpeg or .webp".
    function kindsWords() {
      var words = kinds.map(function (kind) { var parts = kind.split("/"); return kind.charAt(0) === "." ? kind : parts[1] === "*" ? parts[0] + " file" : "." + parts[1]; });
      return words.length > 1 ? words.slice(0, -1).join(", ") + " or " + words[words.length - 1] : words[0];
    }
    function takes(file) {
      if (!kinds.length) return true;
      var name = file.name.toLowerCase(), type = (file.type || "").toLowerCase();
      return kinds.some(function (kind) { return kind.charAt(0) === "." ? name.slice(-kind.length) === kind : /\\/\\*$/.test(kind) ? type.indexOf(kind.slice(0, -1)) === 0 : type === kind; });
    }
    function say(words) {
      error.textContent = words; error.hidden = !words; drop.classList.toggle("is-marked", Boolean(words));
      var described = (input.getAttribute("aria-describedby") || "").split(" ").filter(function (each) { return each && each !== error.id; });
      if (words) { described.push(error.id); input.setAttribute("aria-invalid", "true"); } else input.removeAttribute("aria-invalid");
      input.setAttribute("aria-describedby", described.join(" "));
    }
    input.addEventListener("dragenter", function () { depth++; drop.classList.add("is-over"); });
    input.addEventListener("dragleave", function () { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("is-over"); });
    input.addEventListener("drop", function () { depth = 0; drop.classList.remove("is-over"); });
    input.addEventListener("change", function () {
      var picked = Array.prototype.slice.call(input.files), wrong = picked.find(function (file) { return !takes(file); }), big = most ? picked.find(function (file) { return file.size > most; }) : null;
      var words = wrong ? wrong.name + " isn't a " + kindsWords() + "." : big ? big.name + " is " + sizeWords(big.size) + "; the most is " + sizeWords(most) + "." : "";
      if (words) { input.value = ""; picked = []; }
      say(words);
      list.textContent = "";
      picked.forEach(function (file) {
        var row = document.createElement("li"), name = document.createElement("span"), size = document.createElement("span");
        name.className = "file-drop-name"; name.textContent = file.name; size.className = "file-drop-size"; size.textContent = sizeWords(file.size);
        row.appendChild(name); row.appendChild(size); list.appendChild(row);
      });
      list.hidden = !picked.length;
    });
  });
})();
`;

const BUILD_HINT = "Or tap to pick it. Up to 500\u00a0MB; the upload command takes bigger builds.";

component({
  name: "File drop",
  slug: "file-drop",
  group: "inputs",
  subgroup: "pickers",
  summary: "Handing over files: a game's build, a cover, a screenshot for a report. Drop them on it, tap it, or reach it by keyboard; what's picked is listed with its size.",
  styles: `
/* A file drop: a carved field the size of a pane, its outline dashed. Pointing at it clears it a little; a file held over it whitens it and
   turns the dashes orange, and keyboard focus draws the outline whole, in orange. The file input lies across all of it, unseen. */
/* One column that never grows past what holds it, so a long file name wraps instead of widening the drop. */
.file-drop-wrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--gap-words-control); }
.file-drop { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gap-words-control); min-height: 168px;
  padding: var(--pad-pane); text-align: center; color: var(--muted); --face-color: var(--field-face); background: var(--face-color); box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.file-drop:not(.is-disabled):hover { --face-color: var(--field-hover); }
.file-drop.is-over { --face-color: var(--field-focus); color: var(--ink); }
.file-drop > .ico { width: 28px; height: 28px; transition: transform 0.3s var(--spring); }
.file-drop.is-over > .ico { transform: translateY(-3px); }
.file-drop-input { position: absolute; inset: 0; z-index: 5; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.file-drop-words { display: grid; gap: var(--gap-words-words); text-wrap: pretty; }
.file-drop-words label { font: var(--type-label); color: var(--ink); }
.file-drop-words span { font: var(--type-facts); color: var(--ink-2); }
.file-drop > .cut-line { z-index: 4; }
.file-drop > .cut-line polygon { stroke: var(--drop-dash); stroke-width: 2; stroke-dasharray: 7 5; }
.file-drop.is-over > .cut-line polygon { stroke: var(--focus); stroke-width: 3; }
/* Marked wrong: the dashes in amber, and what's wrong said under it. */
.file-drop.is-marked > .cut-line polygon { stroke: var(--marked); }
/* Can't take files now: flat in the glass, its words and dashes quieter, and nothing changes as you point at it. */
.file-drop.is-disabled { --face-color: var(--off-face); box-shadow: none; }
.file-drop.is-disabled .file-drop-input { cursor: default; }
.file-drop.is-disabled .file-drop-words label { color: var(--muted); }
.file-drop.is-disabled > .cut-line polygon { stroke: var(--line); }
.file-drop:has(:focus-visible) > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); stroke-dasharray: none; }
/* What's picked: a row for each file, its words keeping the pane's margin all round (so the last row's keep it at a pane's foot), its name
   whole, on more lines where it's long; while one uploads, a line along its foot fills as it goes. */
.file-drop-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.file-drop-list li { position: relative; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 var(--gap-words-control); padding: max(var(--gap-words-words), var(--pad-words)) var(--pad-words); border-top: var(--divider); font: var(--type-words); color: var(--ink); }
.file-drop-list li:first-child { border-top: 0; }
.file-drop-list li.is-uploading::after { content: ""; position: absolute; left: var(--pad-words); right: var(--pad-words); bottom: 0; height: 2px; background: linear-gradient(90deg, var(--meter-fill) calc(var(--sent) * 100%), var(--line) 0); }
.file-drop-name { min-width: 0; overflow-wrap: anywhere; }
.file-drop-size { flex: none; font: var(--type-facts); color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .file-drop > .ico { transition: none; } }
`,
  render: fileDrop,
  examples: [
    { label: "Waiting for a file", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-rest", name: "build", label: "Drop your game's folder as a .zip", accept: ".zip", hint: BUILD_HINT, maximumByteCount: 500_000_000 }) }) },
    { label: "A file held over it", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-over", name: "build", label: "Drop your game's folder as a .zip", accept: ".zip", hint: BUILD_HINT, state: "over" }) }) },
    { label: "Several images", markup: examplePane(fileDrop({ id: "example-drop-images", name: "screenshots", label: "Add screenshots", accept: "image/png,image/jpeg,image/webp", isMultiple: true, hint: "PNG, JPEG or WebP, 16:9." })) },
    {
      label: "Picked: listed with their sizes",
      markup: examplePane(fileDrop({ id: "example-drop-picked", name: "screenshots_picked", label: "Add screenshots", accept: "image/png,image/jpeg,image/webp", isMultiple: true, hint: "PNG, JPEG or WebP, 16:9.", pickedFiles: [{ fileName: "ashen-crown-iron-vigil-siege-at-dawn.png", byteCount: 4_812_000 }, { fileName: "boss-arena.webp", byteCount: 912_000 }] })),
    },
    { label: "Uploading", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-uploading", name: "build_uploading", label: "Drop your game's folder as a .zip", accept: ".zip", hint: BUILD_HINT, pickedFiles: [{ fileName: "ashen-crown-1.4.2-the-long-night.zip", byteCount: 482_300_000, uploadedByteCount: 211_000_000 }] }) }) },
    { label: "Too big: refused, in words", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-error", name: "build_error", label: "Drop your game's folder as a .zip", accept: ".zip", hint: BUILD_HINT, maximumByteCount: 500_000_000, error: "ashen-crown-1.4.2-with-cinematics.zip is 1.12\u00a0GB; the most is 500\u00a0MB. The upload command takes bigger builds." }) }) },
    { label: "Can't take files now", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-disabled", name: "build_disabled", label: "Drop your game's folder as a .zip", accept: ".zip", hint: "You can send another once version 1.4.2 is checked, usually within a minute.", isDisabled: true }) }) },
  ],
});

export interface CopyFieldOptions {
  /** What it is, above it: "Link", "Your new API key". */
  label: string;
  /** What's copied, whole: a link, a key, a command. A page script can set it later (data-copy on its text, found by its id). */
  copiedText: string;
  /**
   * Code's own letters, shown whole on as many lines as it takes, a command breaking only at its spaces; a click on it selects it (a key, a
   * command). Left out, it's words on one line, cut short at its end, a link shown without its https://, and a press anywhere copies it.
   */
  isCode?: boolean;
  /** Unique on the page: its text carries it, for a page script to fill in. Defaults to a slug of its label. */
  id?: string;
  /** A secret on a screen others may see (a streamer's room link or code): blurred until a page script takes is-masked off it; Copy still copies it. */
  isMasked?: boolean;
  /** The gallery's fixed states. */
  state?: "is-copied" | "is-pointed" | "is-focused";
}

/**
 * A copy field: something to copy in a Well, with a Copy (a small tertiary icon button) at its end. Words by default (a link: one line,
 * cut short, a press anywhere copies it); code shows all of it in code's letters. Copied, Copy's icon is a tick and "Copied" shows at the
 * end of its label's line for a moment, and what's in it stays.
 */
export function copyField(options: CopyFieldOptions & { isCode: true }): Raw;
export function copyField(options: CopyFieldOptions & { isCode?: false }): ControlMarkup;
export function copyField(options: CopyFieldOptions): Raw;
export function copyField(options: CopyFieldOptions): Raw {
  const id = options.id ?? `copy-${options.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const isCopied = options.state === "is-copied";
  const isCommand = / /.test(options.copiedText.trim());
  const shown = options.isCode
    ? isCommand ? options.copiedText.split(" ").map((word, wordIndex) => html`${wordIndex ? " " : ""}<span class="code-word">${word}</span>`) : options.copiedText
    : options.copiedText.replace(/^https?:\/\//, "");
  const body = options.isCode
    ? html`<code class="copy-field-text" id="${id}" tabindex="0" aria-labelledby="${id}-label" data-copy="${options.copiedText}">${shown}</code>`
    : html`<span class="copy-field-text" id="${id}" data-copy="${options.copiedText}">${shown}</span>`;
  const buttonState = options.state === "is-pointed" || (options.state === "is-focused" && !options.isCode) ? options.state : undefined;
  const className = ["cut-field", "copy-field", options.isCode ? "is-code" : "", isCopied ? "is-copied" : "", options.isMasked ? "is-masked" : ""].filter(Boolean).join(" ");
  // Words are a field's height, a control in a row or stack; code runs as many lines as it takes, a block.
  const markup = html`<div class="${className}"><span class="copy-head"><span class="copy-label" id="${id}-label">${options.label}</span><span class="copy-said" role="status">${isCopied ? "Copied" : ""}</span></span>${well({
    body,
    end: tertiaryButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true, controls: id, state: buttonState }),
    endNote: icon("check"),
    state: options.isCode && options.state === "is-focused" ? "is-focused" : undefined,
  })}</div>`;
  return options.isCode ? markup : controlMarkup(markup, "field", { hasOwnWords: true });
}

/**
 * Copy: a copy field's whole text (data-copy) goes to the clipboard, and for a moment Copy's icon is a tick and "Copied" shows at the end of
 * its label's line. A press anywhere on a field of words copies it too; a click on code selects all of it, to copy by hand.
 */
export const COPY_SCRIPT = `/* copy fields */(function () {
  function selectAll(element) { var range = document.createRange(); range.selectNodeContents(element); var picked = window.getSelection(); picked.removeAllRanges(); picked.addRange(range); }
  document.addEventListener("click", function (event) {
    var field = event.target.closest && event.target.closest(".copy-field");
    if (!field || !event.target.closest(".well")) return;
    var text = field.querySelector(".copy-field-text"), said = field.querySelector(".copy-said");
    if (!event.target.closest(".well-end > .tertiary-btn") && field.classList.contains("is-code")) { selectAll(text); return; }
    function saying(words) {
      said.textContent = words; field.classList.add("is-copied");
      clearTimeout(said.timer); said.timer = setTimeout(function () { said.textContent = ""; field.classList.remove("is-copied"); }, 1600);
    }
    // Where the clipboard isn't open to the page, the text is selected and copied the old way; when that fails too, it's left selected to copy.
    function byHand() { selectAll(text); var isCopied = false; try { isCopied = document.execCommand("copy"); } catch (error) {} if (isCopied) saying("Copied"); }
    // The press answers at once: the clipboard can take its time, and only says otherwise when it refuses.
    if (navigator.clipboard && navigator.clipboard.writeText) { saying("Copied"); navigator.clipboard.writeText(text.getAttribute("data-copy") || text.textContent).catch(byHand); }
    else byHand();
  });
})();
`;

const API_KEY = "zk_live_8f3a91c2e74b5d06a1f9c3e8b27d4a60";

component({
  name: "Copy field",
  slug: "copy-field",
  group: "inputs",
  subgroup: "fields",
  summary: "Something to copy and keep: a game's link, a room's, an API key shown once, an upload command. Words on one line by default, which a press anywhere copies; code shows all of it in code's letters. For something to type, use a Cut field.",
  styles: `
/* A copy field: its label, then a Well holding what's copied, with Copy (a small tertiary icon button) at its end. Copied, Copy's icon is a
   tick (the well's end note) and "Copied" shows at the end of the label's line, both in the ink, for a moment (COPY_SCRIPT); what's in it
   stays where it is. */
.copy-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap-words-words); padding-inline: var(--pad-words); }
.copy-label { font: var(--type-label); color: var(--ink-2); }
.copy-said { font: var(--type-facts); color: var(--ink); opacity: 0; transition: opacity 0.2s; }
.copy-field.is-copied .copy-said { opacity: 1; }
.copy-field.is-copied .well-end-note { display: grid; }
.copy-field.is-copied .well-end > .tertiary-btn .ico { visibility: hidden; }
.copy-field-text:focus-visible { outline: none; }
/* Words: one line tall, the address cut short at its end; a press anywhere on the well copies, so pointing at it brings up Copy's slab. */
.copy-field:not(.is-code) .well { cursor: pointer; }
.copy-field:not(.is-code) .well-body { display: flex; align-items: center; padding-block: 0; }
.copy-field:not(.is-code) .copy-field-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.copy-field:not(.is-code) .well:hover .well-end > .tertiary-btn > .face { color: var(--ink); --face-color: var(--wash); }
.copy-field:not(.is-code) .well:active { box-shadow: var(--press-shade); }
.copy-field:not(.is-code) .well:active .well-end > .tertiary-btn > .face { --face-color: var(--wash-press); }
/* Code: all of it in code's letters, wrapping onto more lines rather than hiding any; one long token (a key) breaks at a line's end. Only
   its first line keeps clear of Copy; the lines under it run the well's whole width, each as tall as Copy's half and the gap round it. */
.copy-field.is-code .well { align-items: stretch; }
.copy-field.is-code .well-body { padding-inline-end: var(--pad-inside-words); }
.copy-field.is-code .copy-field-text { display: block; font: 500 0.9375rem/1.5rem ui-monospace, Menlo, monospace; overflow-wrap: anywhere; cursor: text; }
.copy-field.is-code .copy-field-text::before { content: ""; float: right; width: max(0px, var(--control-height-small) + var(--well-inset) - var(--pad-inside-words) + var(--gap-words-words)); height: 24px; }
/* A command's parts each stay whole, so it breaks only at its spaces; a part longer than a line breaks within itself. */
.code-word { display: inline-block; max-width: 100%; }
/* Masked: its letters blur into their own glow, unreadable, until the page shows them, the glow with room round the words so it isn't
   clipped; Copy still copies them. */
.copy-field.is-masked .copy-field-text { color: transparent; text-shadow: 0 0 10px var(--ink); }
.copy-field.is-masked:not(.is-code) .copy-field-text { padding: 12px; margin: -12px; }
.copy-field.is-masked.is-code .copy-field-text { cursor: pointer; }
`,
  render: copyField,
  examples: [
    { label: "A game's link", markup: examplePane(copyField({ id: "example-copy-link", label: "Link", copiedText: "https://zaisma.com/g/ashen-crown" })) },
    { label: "Pointed", markup: examplePane(copyField({ id: "example-copy-pointed", label: "Link", copiedText: "https://zaisma.com/g/ashen-crown", state: "is-pointed" })), isStill: true },
    { label: "Copied", markup: examplePane(copyField({ id: "example-copy-copied", label: "Link", copiedText: "https://zaisma.com/g/ashen-crown", state: "is-copied" })), isStill: true },
    { label: "Keyboard focus", markup: examplePane(copyField({ id: "example-copy-focused", label: "Link", copiedText: "https://zaisma.com/g/ashen-crown", state: "is-focused" })), isStill: true },
    { label: "A long one: cut short at its end", markup: examplePane(copyField({ id: "example-copy-long", label: "Link to this match", copiedText: "https://zaisma.com/g/the-last-lighthouse-keeper-tides-of-the-northern-reach?room=K7Q2MX" })) },
    { label: "Masked, for a streamer: blurred until shown", markup: examplePane(copyField({ id: "example-copy-masked", label: "Link to this match", copiedText: "https://zaisma.com/g/ashen-crown?room=K7Q2MX", isMasked: true })), isStill: true },
    { label: "Code: an API key, shown once", markup: examplePane(copyField({ id: "example-copy-key", label: "Your new API key", copiedText: API_KEY, isCode: true })) },
    { label: "Code: a command breaks only at its spaces", markup: examplePane(copyField({ id: "example-copy-command", label: "Upload from your terminal", copiedText: "npx @zaisma/cli upload ./build --game ashen-crown", isCode: true })) },
    { label: "Code: one long token", markup: examplePane(copyField({ id: "example-copy-secret", label: "Webhook signing secret", copiedText: "whsec_4b9f02d7e1c86a35f0d2b7194ce6a8d3f51b0e9c27a4d6f8b13e5c0a9d7f2e64", isCode: true })) },
    { label: "Code: copied", markup: examplePane(copyField({ id: "example-copy-key-copied", label: "Your new API key", copiedText: API_KEY, isCode: true, state: "is-copied" })), isStill: true },
    { label: "Code: keyboard focus", markup: examplePane(copyField({ id: "example-copy-key-focused", label: "Your new API key", copiedText: API_KEY, isCode: true, state: "is-focused" })), isStill: true },
    { label: "Code: masked", markup: examplePane(copyField({ id: "example-copy-room-masked", label: "Room code", copiedText: "K7PQ2M", isCode: true, isMasked: true })), isStill: true },
  ],
});

export interface QrCodeOptions {
  /** Unique on the page: the picture's, for a page script to point it at a link (its caption is <id>-caption). */
  id: string;
  /** What a screen reader says for it: "QR code for this link". */
  label: string;
  /** The line under it: "Scan to play". */
  caption: string;
  /** The QR code's picture (an SVG Zaisma serves). Left out, a page script sets it. */
  imageUrl?: string;
  /** A secret on a screen others may see (a streamer's room): blurred until a page script takes is-masked off it. */
  isMasked?: boolean;
  /** On a wide screen, smaller, with its line beside it (a compact sheet's): a phone camera still reads it at that size. On a phone it's as wide as the room allows. */
  isCompact?: boolean;
  /** As large as the screen allows, to hold up to someone across a room: the Light box's. */
  isLarge?: boolean;
}

/** A QR code: a link as a picture any phone's camera reads, on white whatever the glass, with a line under it saying what it opens. */
export function qrCode(options: QrCodeOptions): Raw {
  return html`<figure class="qr-code${options.isMasked ? " is-masked" : ""}${options.isCompact ? " is-compact" : ""}${options.isLarge ? " is-large" : ""}"><img class="qr-picture" id="${options.id}"${options.imageUrl ? html` src="${options.imageUrl}"` : ""} alt="${options.label}" width="220" height="220"><figcaption class="qr-caption" id="${options.id}-caption">${options.caption}</figcaption></figure>`;
}

/** The gallery's QR code: a stand-in game's address, made as Zaisma makes every game's. */
export const STAND_IN_QR_CODE = `data:image/svg+xml,${encodeURIComponent(qrCodeSvg("https://zaisma.com/g/ashen-crown"))}`;

component({
  name: "QR code",
  slug: "qr-code",
  group: "inputs",
  subgroup: "pickers",
  summary: "A link as a picture a phone's camera reads: a game's address, or a room's, for someone in the same room. Black on white whatever the glass, with a line saying what it opens.",
  styles: `
/* A QR code: the picture on white with a quiet margin of white round it, so any phone's camera reads it on light glass or smoked, as wide as
   the room allows up to 220px; its line under it in the label's words. Masked, it blurs until the page shows it. */
.qr-code { display: grid; justify-items: center; gap: var(--gap-words-control); margin: 0; min-width: 0; }
.qr-picture { display: block; width: min(220px, 100%); height: auto; aspect-ratio: 1; background: #fff; transition: filter 0.25s; }
/* Its words keep the margin inside it, as a field's do, however wide they run (a masked code's caption, at a large text size). */
.qr-caption { font: var(--type-label); color: var(--ink); text-align: center; padding-inline: var(--pad-inside-words); }
.qr-code.is-masked > .qr-picture { filter: blur(8px); }
/* Large (a light box's): as big as the screen allows, its white margin wider to match, its line under it. */
.qr-code.is-large > .qr-picture { width: min(360px, 76vw, 58dvh); padding: var(--pad-tray); box-sizing: border-box; }
/* Compact, on a wide screen: smaller, with its line beside it, the width of what a compact sheet holds. */
@media (min-width: 761px) {
  .qr-code.is-compact { grid-template-columns: auto 1fr; justify-items: start; align-items: center; column-gap: var(--gap-block-block); }
  .qr-code.is-compact > .qr-picture { width: 104px; }
  .qr-code.is-compact > .qr-caption { text-align: start; padding-inline: 0 var(--pad-words); }
}
`,
  render: qrCode,
  examples: [
    { label: "A game's link", markup: examplePane(qrCode({ id: "example-qr-game", label: "QR code for this link", caption: "Scan to play", imageUrl: STAND_IN_QR_CODE })) },
    { label: "Compact, on a wide screen: smaller, its line beside it", markup: examplePane(qrCode({ id: "example-qr-compact", label: "QR code for this link", caption: "Scan to play", imageUrl: STAND_IN_QR_CODE, isCompact: true })) },
    { label: "Masked, for a streamer: blurred until shown", markup: examplePane(qrCode({ id: "example-qr-masked", label: "QR code for this link", caption: "Scan to join this match", imageUrl: STAND_IN_QR_CODE, isMasked: true })), isStill: true },
  ],
});

export interface ColorFieldOptions {
  /** The name its color is sent under: a hex code ("#6D73E8"), or a named color's colorValue. */
  name: string;
  label: string;
  /** Unique on the page. Defaults to color-<name>. */
  id?: string;
  /** The color it starts on: a hex code, or one of namedChoices' colorValue. */
  pickedValue: string;
  /** Colors a press away under the wheel, each with its name (a glass's hue presets, None); picking one sends its colorValue. */
  namedChoices?: ColorChoice[];
  /** The gallery's fixed states: "open" shows its pane where it is; "is-focused" is its wheel reached by keyboard. */
  state?: "open" | "is-focused";
}

const HEX_CODE = /^#[0-9A-Fa-f]{6}$/;

/**
 * A color field: a field showing its color and hex code that opens a Floating pane with a wheel carved into its glass (hue round it, strength
 * from its soft middle to its rim), the toggle's slab marking the pick, beside the picked color, a Cut field for its hex code and a Slider
 * for its brightness; named colors, when it has them, a press away under them. Dragging the wheel, typing a code or picking a name moves
 * every part to that color. The pick goes with its form, and each change fires `zaisma:color` on the field (`detail.colorValue`).
 */
export function colorField(options: ColorFieldOptions): Raw {
  const id = options.id ?? `color-${options.name}`;
  const isOpen = options.state === "open" || options.state === "is-focused";
  const named = options.namedChoices?.find((choice) => choice.colorValue === options.pickedValue);
  const firstHex = options.namedChoices?.map((choice) => choice.swatch).find((swatch) => HEX_CODE.test(swatch));
  const hex = (HEX_CODE.test(options.pickedValue) ? options.pickedValue : named && HEX_CODE.test(named.swatch) ? named.swatch : firstHex ?? "#5865F2").toUpperCase();
  const swatchOf = (swatch: string) => (swatch === "clear" ? "var(--clear-swatch)" : swatch);
  return html`<fieldset class="wheel-field color-field" id="${id}" data-color-field data-color-hex="${hex}">
<legend id="${id}-legend">${options.label}</legend>
<button type="button" class="wheel-button color-button cut-carved no-icon" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend">${CUT_LINE}<span class="color-chip cut-raised" aria-hidden="true" data-cut-line="6" style="--swatch:${named ? swatchOf(named.swatch) : hex}">${CUT_LINE}</span><span class="wheel-value color-value">${named?.name ?? hex}</span><span class="wheel-chev">${icon("chevron-down")}</span></button>
${floatingPane({
    id: `${id}-pick`,
    placement: "under",
    kind: "color-pick",
    role: "group",
    label: options.label,
    isShownInPlace: isOpen,
    body: html`<div class="color-pane"><div class="color-wheel cut-carved${options.state === "is-focused" ? " is-focused" : ""}" data-cut-line="10" tabindex="0" role="slider" aria-label="Hue and strength" aria-valuetext="${hex}">${CUT_LINE}<span class="color-wheel-light" aria-hidden="true"></span><span class="color-knob" aria-hidden="true" data-on-no-pane><span class="color-knob-slab cut-raised" data-cut-line="6">${CUT_LINE}</span></span></div><div class="color-side"><span class="color-swatch cut-carved" aria-hidden="true" data-cut-line="10">${CUT_LINE}</span>${cutField({ name: `${options.name}_hex`, id: `${id}-hex`, label: "Hex code", type: "text", text: hex, autocomplete: "off", characterPattern: "[#0-9A-Fa-f]", maximumCharacterCount: 7, isUppercase: true })}${slider({ name: `${options.name}_brightness`, id: `${id}-brightness`, label: "Brightness", minimumNumber: 0, maximumNumber: 100, stepNumber: 1, pickedNumber: 100, unit: "%" })}</div>${
      options.namedChoices
        ? html`<div class="color-named" role="group" aria-label="Named colors">${options.namedChoices.map(
            (choice) =>
              html`<button type="button" class="color-named-pick" data-cut-line="6" data-cut-ring="3" data-color-value="${choice.colorValue}" aria-label="${choice.name}" aria-pressed="${choice === named ? "true" : "false"}" style="--swatch:${swatchOf(choice.swatch)}">${CUT_LINE}</button>`,
          )}</div>`
        : ""
    }</div>`,
  })}
<input type="hidden" name="${options.name}" value="${named ? named.colorValue : hex}">
</fieldset>`;
}

/** A color field's pane: the wheel, the hex code, the brightness and the names move together, and the field shows and sends the pick. */
export const COLOR_FIELD_SCRIPT = `/* color fields */(function () {
  function hexOf(rgb) { return "#" + rgb.map(function (x) { return x.toString(16).padStart(2, "0"); }).join("").toUpperCase(); }
  function rgbOf(h, s, v) { function f(n) { var k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255); } return [f(5), f(3), f(1)]; }
  function hsvOf(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, most = Math.max(r, g, b), d = most - Math.min(r, g, b), h = 0;
    if (d) { h = most === r ? ((g - b) / d) % 6 : most === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, most ? d / most : 0, most];
  }
  // What's typed: six digits, or three for short, with or without its #.
  function typedHex(text) { var t = String(text || "").replace(/[^0-9a-f]/gi, ""); if (t.length === 3) t = t.replace(/./g, "$&$&"); return t.length === 6 ? "#" + t.toUpperCase() : null; }
  function swatchHex(text) { var found = /^\\s*(#[0-9a-f]{6})\\s*$/i.exec(text || ""); return found ? found[1].toUpperCase() : null; }
  window.zaismaWatch.each("[data-color-field]", function (root) {
    var button = root.querySelector(".color-button"), pick = root.querySelector(".color-pick"), wheel = root.querySelector(".color-wheel"), knob = root.querySelector(".color-knob");
    var hexField = root.querySelector(".color-side .cut-field input"), bright = root.querySelector(".color-side .slider-input"), sent = root.querySelector(':scope > input[type="hidden"]');
    var shown = button.querySelector(".color-value"), chip = button.querySelector(".color-chip"), named = Array.prototype.slice.call(root.querySelectorAll(".color-named-pick"));
    var hsv = hsvOf(swatchHex(sent.value) || root.getAttribute("data-color-hex")), namedPick = null, isSetting = false;
    // It starts on a named color when what it sends is one's value (Emerald's "#2E9E6B" as much as None's "").
    named.forEach(function (each) { if (each.getAttribute("data-color-value") === sent.value) namedPick = sent.value; });
    // Floating, it's as wide as what's in it; shown open in place (the gallery's), it lies in the page's flow under the field.
    var float = window.zaismaFloat(pick, { anchor: button, home: root, isAnchorWidth: pick.classList.contains("in-place"), onToggle: function (isShown) { button.setAttribute("aria-expanded", String(isShown)); if (isShown) draw(); } });
    function draw(isTyping) {
      var hex = hexOf(rgbOf(hsv[0], hsv[1], hsv[2])), choice = null;
      named.forEach(function (each) { if (each.getAttribute("data-color-value") === namedPick) choice = each; });
      var swatch = choice ? choice.style.getPropertyValue("--swatch").trim() : hex;
      // On the field and on its pane, which floats out of the field to the page itself.
      [root, pick].forEach(function (holder) {
        holder.style.setProperty("--color-picked", swatch);
        holder.style.setProperty("--color-full", hexOf(rgbOf(hsv[0], hsv[1], 1)));
        holder.style.setProperty("--color-brightness", String(hsv[2]));
      });
      // The slab sits at the pick's hue round the middle, its strength out toward the rim (the round one's, inside the square well).
      var r = wheel.clientWidth / 2, a = hsv[0] * Math.PI / 180;
      knob.style.left = (r + hsv[1] * r * Math.cos(a)) + "px"; knob.style.top = (r + hsv[1] * r * Math.sin(a)) + "px";
      wheel.setAttribute("aria-valuetext", hex);
      chip.style.setProperty("--swatch", swatch);
      shown.textContent = choice ? choice.getAttribute("aria-label") : hex;
      sent.value = choice ? namedPick : hex;
      named.forEach(function (each) { each.setAttribute("aria-pressed", String(each === choice)); });
      if (!isTyping) hexField.value = hex;
      var percent = Math.round(hsv[2] * 100);
      if (Number(bright.value) !== percent) { bright.value = String(percent); isSetting = true; bright.dispatchEvent(new Event("input", { bubbles: true })); isSetting = false; }
    }
    function changed() { root.dispatchEvent(new CustomEvent("zaisma:color", { bubbles: true, detail: { colorValue: sent.value } })); }
    function fromWheel(event) {
      var box = wheel.getBoundingClientRect(), r = box.width / 2, dx = event.clientX - box.left - r, dy = event.clientY - box.top - r;
      hsv[0] = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; hsv[1] = Math.min(1, Math.hypot(dx, dy) / r); namedPick = null; draw(); changed();
    }
    wheel.addEventListener("pointerdown", function (event) { wheel.setPointerCapture(event.pointerId); wheel.classList.add("is-held"); fromWheel(event); wheel.focus({ preventScroll: true }); event.preventDefault(); });
    wheel.addEventListener("pointermove", function (event) { if (wheel.hasPointerCapture(event.pointerId)) fromWheel(event); });
    wheel.addEventListener("pointerup", function () { wheel.classList.remove("is-held"); });
    wheel.addEventListener("pointercancel", function () { wheel.classList.remove("is-held"); });
    // The arrows turn the hue (left and right) and change its strength (up and down); with Shift, further.
    wheel.addEventListener("keydown", function (event) {
      var turn = event.shiftKey ? 30 : 5, more = event.shiftKey ? 0.2 : 0.05;
      if (event.key === "ArrowLeft") hsv[0] = (hsv[0] + 360 - turn) % 360;
      else if (event.key === "ArrowRight") hsv[0] = (hsv[0] + turn) % 360;
      else if (event.key === "ArrowUp") hsv[1] = Math.min(1, hsv[1] + more);
      else if (event.key === "ArrowDown") hsv[1] = Math.max(0, hsv[1] - more);
      else return;
      event.preventDefault(); namedPick = null; draw(); changed();
    });
    bright.addEventListener("input", function () { if (isSetting) return; hsv[2] = Number(bright.value) / 100; namedPick = null; draw(); changed(); });
    hexField.addEventListener("input", function () { var hex = typedHex(hexField.value); if (!hex) return; hsv = hsvOf(hex); namedPick = null; draw(true); changed(); });
    hexField.addEventListener("blur", function () { draw(); });
    named.forEach(function (each) {
      each.addEventListener("click", function () { namedPick = each.getAttribute("data-color-value"); var hex = swatchHex(each.style.getPropertyValue("--swatch")); if (hex) hsv = hsvOf(hex); draw(); changed(); });
    });
    button.addEventListener("click", function () { if (float.isOpen()) float.close(false); else float.open(); });
    if (pick.classList.contains("in-place")) float.open();
    draw();
  });
})();
`;

/** Game-like colors for the gallery's hue examples, None first. */
const HUE_CHOICES: ColorChoice[] = [
  { name: "None", colorValue: "", swatch: "clear" },
  { name: "Crimson", colorValue: "#C8384A", swatch: "#C8384A" },
  { name: "Emerald", colorValue: "#2E9E6B", swatch: "#2E9E6B" },
  { name: "Violet", colorValue: "#7A4FD8", swatch: "#7A4FD8" },
  { name: "Gold", colorValue: "#D9A520", swatch: "#D9A520" },
];

component({
  name: "Color field",
  slug: "color-field",
  group: "inputs",
  subgroup: "pickers",
  summary: "Any color: a game's accent, the glass's hue. A field with its color and hex code that opens a wheel carved into glass, beside a field for the hex code and the brightness; named colors, when there are some, a press away. Typing a code moves the wheel to it.",
  styles: `
/* A color field: the wheel field's button, its color's chip before its hex code, opening a Floating pane under it. In the pane, a wheel carved into
   the glass and cut by the edge rule like any carving there: hue round its middle, strength from its soft middle out to its rim, dimmed by the
   brightness; the toggle's slab (the --thumb tokens) marks the pick. Beside it, the picked color, a Cut field for its hex code and a Slider
   whose groove runs from black to the full color. Named colors sit under them as chips of colored glass, the picked one ringed in ink. */
/* Its pane follows the panes' one rule, two margins: what has an edge (the wheel, the picked color, the field, the chips) sits at the frame gap,
   --pad-frame, and words (the field's and the slider's) keep the pane's margin, --pad-words further in. */
.floating-pane.color-pick { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); }
/* Shown open in place, it's as wide as what's in it, as it is floating. */
.floating-pane.color-pick.in-place { width: max-content; max-width: 100%; }
.color-field, .color-pick { --clear-swatch: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
/* The chip is colored glass raised a little; it and the picked color are cut by the edge rule like every piece on a pane: a corner is cut
   where it meets its holder's cut corner, square elsewhere. */
.color-chip { position: relative; flex: none; width: 20px; height: 20px; background: var(--swatch); clip-path: var(--cut-shape); }
.color-value { font-variant-numeric: tabular-nums; }
/* The wheel and what's beside it are one height, the wheel's: the picked color takes what room is left, so no gap opens under the wheel. */
.color-pane { display: grid; grid-template-columns: 184px minmax(0, 220px); gap: var(--gap-control-stack) var(--gap-words-control); align-items: stretch; }
@media (max-width: 480px) { .color-pane { grid-template-columns: minmax(0, 1fr); justify-items: center; } .color-side { width: 100%; } }
.color-wheel { position: relative; width: 184px; height: 184px; cursor: crosshair; touch-action: none; outline: none; clip-path: var(--cut-shape); }
.color-wheel-light { position: absolute; inset: 0; background: radial-gradient(circle closest-side, #fff, rgba(255,255,255,0) 100%), conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
/* Brightness dims the whole wheel, as less light comes through it; the well's own shade lies over it. */
.color-wheel-light::after { content: ""; position: absolute; inset: 0; background: #000; opacity: calc(1 - var(--color-brightness, 1)); }
.color-wheel::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 4px 6px var(--groove-shade), inset 0 -2px 0 var(--groove-lip); pointer-events: none; }
.color-wheel > .cut-line { z-index: 2; }
.color-knob { position: absolute; z-index: 3; width: 20px; height: 20px; margin: -10px 0 0 -10px; pointer-events: none; filter: var(--thumb-cast); transition: filter 0.2s; }
.color-knob-slab { position: relative; display: block; width: 100%; height: 100%; background: var(--thumb-face); clip-path: var(--cut-shape); }
.color-knob-slab::after { content: ""; position: absolute; inset: 0; background: var(--thumb-press-face); opacity: 0; transition: opacity 0.12s; }
.color-wheel.is-held .color-knob { filter: var(--thumb-cast-pressed); transition-duration: 0.08s; }
.color-wheel.is-held .color-knob-slab::after { opacity: 1; transition-duration: 0.08s; }
.color-wheel:focus-visible > .cut-line polygon, .color-wheel.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.color-side { display: flex; flex-direction: column; gap: var(--gap-control-stack); min-width: 0; }
/* The picked color is carved into the pane, the color lying in it as light inside the glass, shaded along its top and lit along its lip. */
.color-swatch { position: relative; display: block; flex: 1; min-height: 32px; background: var(--color-picked); clip-path: var(--cut-shape); box-shadow: inset 0 3px 5px var(--groove-shade), inset 0 -1.5px 0 var(--groove-lip); }
/* Its brightness: the slider's groove runs from black to the full color, with no orange in it. */
.color-side .slider-line { background: linear-gradient(90deg, #000, var(--color-full, #fff)); }
.color-side .slider-fill { display: none; }
/* The chips keep room round them for the picked one's ring (3px out), inside the pane's scrolling body. */
.color-named { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--gap-control-stack); padding: 4px; }
/* A named color: a chip of colored glass, its edges lit and shaded; the picked one is ringed in ink a gap out from it (data-cut-ring). */
.color-named-pick { position: relative; width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
.color-named-pick::before { content: ""; position: absolute; inset: 0; background: var(--swatch); clip-path: var(--cut-shape); box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -1.5px 0 rgba(0,0,0,0.22); }
.color-named-pick[aria-pressed="true"] > .cut-line .cut-ring { stroke: var(--ink); }
.color-named-pick:focus-visible { outline: none; }
.color-named-pick:focus-visible > .cut-line .cut-ring { stroke: var(--focus); }
@media (prefers-reduced-motion: reduce) { .color-knob, .color-knob-slab::after { transition: none; } }
`,
  render: colorField,
  examples: [
    { label: "A color", markup: examplePane(colorField({ name: "accent", id: "example-color-accent", label: "Accent", pickedValue: "#6D73E8" })) },
    { label: "Open", markup: examplePane(colorField({ name: "accent_open", id: "example-color-open", label: "Accent", pickedValue: "#6D73E8", state: "open" })), isWide: true },
    { label: "With named colors, one picked", markup: examplePane(colorField({ name: "hue_named", id: "example-color-named", label: "The glass's hue", pickedValue: "#2E9E6B", namedChoices: HUE_CHOICES, state: "open" })), isWide: true },
    { label: "Keyboard focus on its wheel", markup: examplePane(colorField({ name: "accent_focus", id: "example-color-focus", label: "Accent", pickedValue: "#C8384A", state: "is-focused" })), isWide: true, isStill: true },
  ],
});

// Page settings sits with the color field and the switch, which it uses (foundations.ts can't import this file).
component({
  name: "Page settings",
  slug: "page-settings",
  group: "foundations",
  subgroup: "look",
  summary: "Every page has one set of settings that all its components follow: light or dark, and each component's own, like the glass's hue. One change covers every instance at once, and a page only carries the ones its components use.",
  styles: "",
  examples: [
    {
      label: "Light or dark: the whole gallery follows",
      isWide: true,
      markup: html`<div data-setting-theme>${tabSwitch({ label: "Light or dark", switchSize: "small", tabs: [{ label: "Light", tabValue: "light", isCurrent: true }, { label: "Dark", tabValue: "dark", isCurrent: false }] })}</div>`,
    },
    {
      label: "Glass: its hue, on every piece of glass in the gallery at once",
      isWide: true,
      markup: html`<div data-setting-hue>${colorField({ name: "glass_hue", id: "setting-glass-hue", label: "The glass's hue", pickedValue: "", namedChoices: HUE_CHOICES })}</div>`,
    },
  ],
});
