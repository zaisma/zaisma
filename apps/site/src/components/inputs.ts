import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, glassPane, icon } from "./foundations.ts";
import { cutButton } from "./actions.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { examplePane } from "./example-pane.ts";
import { qrCodeSvg } from "@zaisma/core";

/*
 * Inputs: the fields (fields.ts), the switch (switch.ts) and the choices (choices.ts) are re-exported from here, so pages import every
 * input from one place. A number on a scale, a file drop and a code field are defined here.
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
  return html`<div class="${className}" style="--fill:${(Math.max(0, Math.min(100, filledPct)) / 100).toFixed(4)}"><div class="slider-head"><label for="${id}">${options.label}</label><output for="${id}" data-unit="${options.unit}">${numberWords(options.pickedNumber, options.unit)}</output></div><div class="slider-track"><span class="slider-line" aria-hidden="true"></span><span class="slider-fill" aria-hidden="true"></span><input class="slider-input" type="range" id="${id}" name="${options.name}" min="${options.minimumNumber}" max="${options.maximumNumber}" step="${options.stepNumber}" value="${options.pickedNumber}"${options.isDisabled ? raw(" disabled") : ""} data-slider><span class="slider-thumb cut-raised" data-cut-line="6" aria-hidden="true">${CUT_LINE}</span></div></div>`;
}

/** A slider's fill and number follow its thumb. */
export const SLIDER_SCRIPT = `/* sliders */(function () {
  function follow(input) {
    var box = input.closest(".slider"), min = Number(input.min), max = Number(input.max), output = box.querySelector("output"), unit = output.getAttribute("data-unit");
    box.style.setProperty("--fill", ((Number(input.value) - min) / Math.max(1e-9, max - min)).toFixed(4));
    // The thumb's shape follows the edge rule where it now sits: cut where it meets its pane's corner, square in the middle.
    var thumb = box.querySelector(".slider-thumb"); if (thumb && thumb.redrawCut) thumb.redrawCut();
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
.slider { --thumb: 30px; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--gap-words-control); }
.slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap-words-words); }
.slider-head > label { padding-inline-start: var(--pad-words); font: var(--type-label); color: var(--ink-2); }
.slider-head > output { padding-inline-end: var(--pad-words); font: var(--type-label); color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
/* It fills a pane's width; in a pane that fits what's in it, its track is a card's width (--size-card), or what room there is. */
.slider-track { position: relative; height: var(--thumb); width: var(--size-card); min-width: 100%; max-width: 100%; }
/* The line is drawn as an edge you can press (--press-rim), so the scale can be found at a glance on any glass. */
.slider-line, .slider-fill { position: absolute; top: calc(50% - 2px); height: 4px; left: calc(var(--thumb) / 2); pointer-events: none; }
.slider-line { right: calc(var(--thumb) / 2); background: var(--press-rim); }
.slider-fill { width: calc((100% - var(--thumb)) * var(--fill)); height: 6px; top: calc(50% - 3px); background: var(--run); }
.slider-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; -webkit-appearance: none; appearance: none; }
/* On a phone the track takes a whole control's height (--control-height-regular) to touch, centered on it. */
@media (pointer: coarse) { .slider-input { inset: min(0px, calc(50% - var(--touch-target) / 2)) 0; height: auto; } }
.slider-input::-webkit-slider-thumb { -webkit-appearance: none; width: var(--thumb); height: var(--thumb); }
.slider-input::-moz-range-thumb { width: var(--thumb); height: var(--thumb); border: 0; }
.slider-thumb { position: absolute; z-index: 2; top: 0; left: calc((100% - var(--thumb)) * var(--fill)); width: var(--thumb); height: var(--thumb); pointer-events: none;
  background: linear-gradient(180deg, #fff, #E9EDF3); box-shadow: 0 1px 3px rgba(20,23,28,0.25); clip-path: var(--cut-shape); transition: filter 0.2s; }
.slider:not(.is-disabled):hover .slider-thumb { filter: brightness(1.06); }
.slider-input:active + .slider-thumb, .slider.is-pressed .slider-thumb { filter: brightness(0.94); box-shadow: var(--press-shade); }
/* Can't be changed now: the thumb rests flat, the number goes quieter, and no orange, since there's nothing to do: the fill is grey. */
.slider.is-disabled .slider-input { cursor: default; }
.slider.is-disabled .slider-head > output { color: var(--muted); }
.slider.is-disabled .slider-fill { background: var(--muted); }
.slider.is-disabled .slider-line { background: var(--line); }
/* Its thumb is dimmed too, faded into the glass, so it plainly can't be dragged. */
.slider.is-disabled .slider-thumb { box-shadow: none; opacity: 0.45; }
.slider.is-disabled .slider-thumb > .cut-line polygon { stroke: var(--line); }
.slider-input:focus-visible + .slider-thumb > .cut-line polygon, .slider.is-focused .slider-thumb > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
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

export interface CodeFieldOptions {
  label: string;
  /** What it holds, shown whole and copied whole: an API key, an address, a command. */
  code: string;
  /** Unique on the page. Defaults to a slug of its label. */
  id?: string;
  /** The gallery's fixed states: focused, or just copied. */
  state?: "is-focused" | "is-copied";
  /**
   * A secret on a screen others may see (a streamer's room code): its code is blurred until a page script takes is-masked off the field,
   * and Copy still copies it.
   */
  isMasked?: boolean;
}

/**
 * A code field: code in a carved field, shown whole (it wraps rather than hiding any of it), with a Copy button at its end; for an API key
 * shown once, an address, a command. Code with spaces in it (a command) breaks only at its spaces, so no part of it is split; code with
 * none (a key, an address) is one long token and breaks anywhere, filling each line. Clicking the code selects all of it.
 */
export function codeField(options: CodeFieldOptions): Raw {
  const id = options.id ?? `code-${options.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const isCommand = / /.test(options.code.trim());
  const code = isCommand ? options.code.split(" ").map((word, wordIndex) => html`${wordIndex ? " " : ""}<span class="code-word">${word}</span>`) : options.code;
  const isCopied = options.state === "is-copied";
  return html`<div class="cut-field code-field${isCopied ? " is-copied" : ""}${options.isMasked ? " is-masked" : ""}"><span class="code-head"><span class="code-label" id="${id}-label">${options.label}</span><span class="code-copied" role="status">${isCopied ? "Copied" : ""}</span></span><div class="field code cut-carved${options.state === "is-focused" ? " is-focused" : ""}" data-cut-line="10">${CUT_LINE}<code class="code-text" id="${id}" tabindex="0" aria-labelledby="${id}-label">${code}</code>${cutButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true, controls: id })}</div></div>`;
}

/**
 * Copy: the field's whole code goes to the clipboard, and "Copied" shows over its end for a moment; clicking the code selects all of it.
 * A link field copies its whole address on a press anywhere on it, and says "Link copied" in its place for a moment.
 */
export const COPY_SCRIPT = `/* code fields */(function () {
  function selectAll(element) { var range = document.createRange(); range.selectNodeContents(element); var picked = window.getSelection(); picked.removeAllRanges(); picked.addRange(range); }
  document.addEventListener("click", function (event) {
    var box = event.target.closest && event.target.closest(".link-field-box");
    if (box) {
      var field = box.closest(".link-field"), shown = field.querySelector(".link-field-text"), done = field.querySelector(".link-field-said");
      var copied = function (words) { done.textContent = words; field.classList.add("is-copied"); clearTimeout(done.timer); done.timer = setTimeout(function () { done.textContent = ""; field.classList.remove("is-copied"); }, 1600); };
      // Where the clipboard isn't open to the page, the address is selected and copied the old way.
      var linkByHand = function () { selectAll(shown); var isCopied = false; try { isCopied = document.execCommand("copy"); } catch (error) {} if (isCopied) copied("Link copied"); };
      var address = shown.getAttribute("data-link") || shown.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) { copied("Link copied"); navigator.clipboard.writeText(address).catch(linkByHand); }
      else linkByHand();
      return;
    }
    var code = event.target.closest && event.target.closest(".field.code > .code-text");
    if (code) { selectAll(code); return; }
    var copy = event.target.closest && event.target.closest(".field.code > .cut-btn[aria-controls]");
    if (!copy) return;
    var text = document.getElementById(copy.getAttribute("aria-controls")), holder = copy.closest(".code-field"), said = holder && holder.querySelector(".code-copied");
    if (!text || !said) return;
    function saying(words) {
      said.textContent = words; holder.classList.add("is-copied");
      clearTimeout(said.timer); said.timer = setTimeout(function () { said.textContent = ""; holder.classList.remove("is-copied"); }, 1600);
    }
    // Where the clipboard isn't open to the page, the code is selected and copied the old way; selected is all it says when that fails too.
    function byHand() { selectAll(text); var isCopied = false; try { isCopied = document.execCommand("copy"); } catch (error) {} saying(isCopied ? "Copied" : "Selected"); }
    // The press answers at once: the clipboard can take its time, and only says otherwise when it refuses.
    if (navigator.clipboard && navigator.clipboard.writeText) { saying("Copied"); navigator.clipboard.writeText(text.getAttribute("data-code") || text.textContent).catch(byHand); }
    else byHand();
  });
})();
`;

component({
  name: "Code field",
  slug: "code-field",
  group: "inputs",
  subgroup: "fields",
  summary: "Code to copy and keep: an API key shown once, a game's address, an upload command. It's read-only, in code's own letters, with a Copy button at its end.",
  styles: `
/* A code field: code set into the glass, a carved well like a switch's (nothing to type, so it isn't a field's lighter face), all of it in
   code's letters, wrapping onto more lines rather than hiding any. Copy is the small raised cut button at its end, standing out from the
   well; once it's copied, "Copied" shows at the end of its label for a moment, over Copy. */
.code-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap-words-words); padding-inline: var(--pad-words); }
.code-label { font: var(--type-label); color: var(--ink-2); }
.code-copied { font: var(--type-facts); color: var(--ink-2); opacity: 0; transition: opacity 0.2s; }
.code-field.is-copied .code-copied { opacity: 1; }
.field.code { height: auto; min-height: var(--control-height-field); align-items: stretch; }
/* Each line is as tall as Copy's half and the gap round it, so the first line sits on Copy's center line and the second clears it. */
/* One long token (a key, an address) breaks at a line's end, or at a slash or hyphen where one is near it. */
.code-text { position: relative; z-index: 2; flex: 1; min-width: 0; padding: 14px var(--pad-inside-words); font: 500 0.9375rem/1.5rem ui-monospace, Menlo, monospace; color: var(--ink);
  overflow-wrap: anywhere; cursor: text; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
/* Only the first line keeps clear of Copy (and its gap); the lines under it run the field's whole width. */
.code-text::before { content: ""; float: right; width: 48px; height: 24px; }
/* A command's parts each stay whole, so it breaks only at its spaces; a part longer than a line breaks within itself. */
.code-word { display: inline-block; max-width: 100%; }
.code-text:focus-visible { outline: none; }
/* Masked: the code's letters blur into their own glow, unreadable, until the page shows them; Copy still copies them. */
.code-field.is-masked .code-text { color: transparent; text-shadow: 0 0 10px var(--ink); cursor: pointer; }
.field.code:has(:focus-visible) > .cut-line polygon, .field.code.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* On a phone, Copy takes a whole control's height (--control-height-regular, 44px) to touch. */
@media (pointer: coarse) { .field.code > .cut-btn::before { content: ""; position: absolute; inset: calc((var(--control-height-small) - var(--touch-target)) / 2); } }
`,
  render: codeField,
  examples: [
    { label: "An API key, shown once", markup: examplePane(codeField({ id: "example-code-key", label: "Your new API key", code: "zk_live_8f3a91c2e74b5d06a1f9c3e8b27d4a60" })) },
    { label: "A command: it breaks only at its spaces", markup: examplePane(codeField({ id: "example-code-command", label: "Upload from your terminal", code: "npx @zaisma/cli upload ./build --game ashen-crown" })) },
    { label: "A game's address", markup: examplePane(codeField({ id: "example-code-address", label: "Your game's address", code: "https://zaisma.com/g/ashen-crown-the-long-night" })) },
    { label: "One long token", markup: examplePane(codeField({ id: "example-code-secret", label: "Webhook signing secret", code: "whsec_4b9f02d7e1c86a35f0d2b7194ce6a8d3f51b0e9c27a4d6f8b13e5c0a9d7f2e64" })) },
    { label: "Copied", markup: examplePane(codeField({ id: "example-code-copied", label: "Your new API key", code: "zk_live_8f3a91c2e74b5d06a1f9c3e8b27d4a60", state: "is-copied" })), isStill: true },
    { label: "Keyboard focus", markup: examplePane(codeField({ id: "example-code-focused", label: "Your new API key", code: "zk_live_8f3a91c2e74b5d06a1f9c3e8b27d4a60", state: "is-focused" })), isStill: true },
    { label: "Masked, for a streamer: blurred until shown", markup: examplePane(codeField({ id: "example-code-masked", label: "Link", code: "https://zaisma.com/g/ashen-crown?room=K7PQ2M", isMasked: true })), isStill: true },
  ],
});

export interface LinkFieldOptions {
  /** Unique on the page: the link's words carry it, for a page script to fill in (data-link, and the words shown). */
  id: string;
  /** What it is: "Link". */
  label: string;
  /** The whole address that's copied; it shows without its https://. */
  url: string;
  /** A secret on a screen others may see (a streamer's room link): blurred until a page script takes is-masked off it; a press still copies it. */
  isMasked?: boolean;
  /** The gallery's fixed states. */
  state?: "is-copied" | "is-pointed" | "is-focused";
}

/**
 * A link field: a link to copy, in a carved well, its address on one line without https:// and cut short at its end when it's long. A press
 * anywhere on it copies the whole address ("Copy" at its end says so), and for a moment it says "Link copied" in its place.
 */
export function linkField(options: LinkFieldOptions): ControlMarkup {
  const shown = options.url.replace(/^https?:\/\//, "");
  const isCopied = options.state === "is-copied";
  const state = options.state && options.state !== "is-copied" ? ` ${options.state}` : "";
  return controlMarkup(html`<div class="link-field${isCopied ? " is-copied" : ""}${options.isMasked ? " is-masked" : ""}"><span class="link-field-label" id="${options.id}-label">${options.label}</span><button class="link-field-box cut-carved${state}" type="button" data-cut-line="10" aria-labelledby="${options.id}-label ${options.id}" aria-describedby="${options.id}-copy">${CUT_LINE}<span class="link-field-icon is-link">${icon("link")}</span><span class="link-field-icon is-done">${icon("check")}</span><span class="link-field-text" id="${options.id}" data-link="${options.url}">${shown}</span><span class="link-field-said" role="status">${isCopied ? "Link copied" : ""}</span><span class="link-field-copy" id="${options.id}-copy">Copy</span></button></div>`, "field", { hasOwnWords: true });
}

component({
  name: "Link field",
  slug: "link-field",
  group: "inputs",
  subgroup: "fields",
  summary: "A link to copy: its address on one line, in the words' own letters, without https://. A press anywhere on it copies it, and it says \"Link copied\" in its place for a moment. Code to copy (a key, a command) is a Code field.",
  styles: `
/* A link field: a carved well, like a code field's, one line tall: a link mark, the address in the words' letters (cut short at its end
   when it's long), and "Copy" quietly at its end. The whole well is the button: pointed at, its words darken; pressed, it sinks a pixel.
   Copied, the mark turns to a tick and "Link copied" takes the address's place, both in the ink, for a moment (COPY_SCRIPT): green on the well is too faint to read. */
.link-field { display: flex; flex-direction: column; gap: var(--gap-words-control); min-width: 0; }
.link-field-label { padding-inline: var(--pad-words); font: var(--type-label); color: var(--ink-2); }
.link-field-box { position: relative; display: flex; align-items: center; gap: var(--gap-words-words); width: 100%; min-width: 0; height: var(--control-height-field); padding: 0 var(--pad-inside-words); margin: 0; border: 0;
  font: var(--type-words); color: var(--ink); text-align: left; cursor: pointer; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); transition: transform 0.15s; }
.link-field-box > :not(.cut-line) { position: relative; z-index: 2; }
.link-field-icon { flex: none; display: inline-flex; color: var(--ink-2); }
.link-field-icon > .ico { width: 18px; height: 18px; }
.link-field-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-field-copy { flex: none; font: var(--type-facts); color: var(--ink-2); transition: color 0.15s; }
.link-field-box:hover .link-field-copy, .link-field-box.is-pointed .link-field-copy { color: var(--ink); }
.link-field-box:active, .link-field-box.is-pressed { box-shadow: var(--press-shade); }
.link-field-box:focus-visible { outline: none; }
.link-field-box:focus-visible > .cut-line polygon, .link-field-box.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.link-field-icon.is-done, .link-field-said { display: none; }
.link-field.is-copied :is(.link-field-icon.is-link, .link-field-text, .link-field-copy) { display: none; }
.link-field.is-copied .link-field-icon.is-done { display: inline-flex; color: var(--ink); }
.link-field.is-copied .link-field-said { display: block; flex: 1; color: var(--ink); }
/* Masked: the address blurs into its own glow, unreadable, until the page shows it; a press still copies it. */
.link-field.is-masked .link-field-text { color: transparent; text-shadow: 0 0 10px var(--ink); }
@media (prefers-reduced-motion: reduce) { .link-field-box { transition: none; } }
`,
  render: linkField,
  examples: [
    { label: "A game's link", markup: examplePane(linkField({ id: "example-link", label: "Link", url: "https://zaisma.com/g/ashen-crown" })) },
    { label: "Pointed", markup: examplePane(linkField({ id: "example-link-pointed", label: "Link", url: "https://zaisma.com/g/ashen-crown", state: "is-pointed" })), isStill: true },
    { label: "Copied", markup: examplePane(linkField({ id: "example-link-copied", label: "Link", url: "https://zaisma.com/g/ashen-crown", state: "is-copied" })), isStill: true },
    { label: "A long one: cut short at its end", markup: examplePane(linkField({ id: "example-link-long", label: "Link to this match", url: "https://zaisma.com/g/the-last-lighthouse-keeper-tides-of-the-northern-reach?room=K7Q2MX" })) },
    { label: "Masked, for a streamer: blurred until shown", markup: examplePane(linkField({ id: "example-link-masked", label: "Link to this match", url: "https://zaisma.com/g/ashen-crown?room=K7Q2MX", isMasked: true })), isStill: true },
    { label: "Keyboard focus", markup: examplePane(linkField({ id: "example-link-focused", label: "Link", url: "https://zaisma.com/g/ashen-crown", state: "is-focused" })), isStill: true },
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
