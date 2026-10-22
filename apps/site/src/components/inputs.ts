import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, glassPane, icon } from "./foundations.ts";
import { cutButton } from "./actions.ts";
import { examplePane } from "./example-pane.ts";

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
  return html`<div class="slider${options.state ? ` ${options.state}` : ""}" style="--fill:${(Math.max(0, Math.min(100, filledPct)) / 100).toFixed(4)}"><div class="slider-head"><label for="${id}">${options.label}</label><output for="${id}" data-unit="${options.unit}">${numberWords(options.pickedNumber, options.unit)}</output></div><div class="slider-track"><span class="slider-line" aria-hidden="true"></span><span class="slider-fill" aria-hidden="true"></span><input class="slider-input" type="range" id="${id}" name="${options.name}" min="${options.minimumNumber}" max="${options.maximumNumber}" step="${options.stepNumber}" value="${options.pickedNumber}" data-slider><span class="slider-thumb cut-raised" data-cut-line="6" aria-hidden="true">${CUT_LINE}</span></div></div>`;
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
  summary: "A number on a scale: players in a room, a volume. Dragged, tapped or stepped with the arrow keys; the number shows with its unit as it moves. There are no knobs: this covers them.",
  styles: `
/* A slider: a hairline track, filled orange up to a raised white slab, the thumb. The system's range input lies over the track,
   unseen, so dragging, tapping and the arrow keys work as they always do; SLIDER_SCRIPT moves the fill and the number with it. */
.slider { --thumb: 30px; display: grid; gap: var(--gap-words-control); }
.slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap-words-words); }
.slider-head > label { padding-inline-start: var(--pad-words); font: var(--type-label); color: var(--ink-2); }
.slider-head > output { padding-inline-end: var(--pad-words); font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; }
.slider-track { position: relative; height: var(--thumb); }
.slider-line, .slider-fill { position: absolute; top: calc(50% - 2px); height: 4px; left: calc(var(--thumb) / 2); pointer-events: none; }
.slider-line { right: calc(var(--thumb) / 2); background: var(--line); }
.slider-fill { width: calc((100% - var(--thumb)) * var(--fill)); height: 6px; top: calc(50% - 3px); background: linear-gradient(90deg, #E9820C, var(--run)); }
.slider-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; -webkit-appearance: none; appearance: none; }
.slider-input::-webkit-slider-thumb { -webkit-appearance: none; width: var(--thumb); height: var(--thumb); }
.slider-input::-moz-range-thumb { width: var(--thumb); height: var(--thumb); border: 0; }
.slider-thumb { position: absolute; z-index: 2; top: 0; left: calc((100% - var(--thumb)) * var(--fill)); width: var(--thumb); height: var(--thumb); pointer-events: none;
  background: linear-gradient(180deg, #fff, #E9EDF3); box-shadow: 0 1px 3px rgba(20,23,28,0.25); clip-path: var(--cut-shape); transition: filter 0.2s; }
.slider:hover .slider-thumb { filter: brightness(1.06); }
.slider-input:active + .slider-thumb, .slider.is-pressed .slider-thumb { filter: brightness(0.94); box-shadow: var(--press-shade); }
.slider-input:focus-visible + .slider-thumb > .cut-line polygon, .slider.is-focused .slider-thumb > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
`,
  render: slider,
  examples: [
    { label: "Rest", markup: examplePane(slider({ id: "example-slider-rest", name: "room_player_count", label: "Players in a room", minimumNumber: 2, maximumNumber: 100, stepNumber: 1, pickedNumber: 16, unit: "players" })) },
    { label: "Pressed", markup: examplePane(slider({ id: "example-slider-pressed", name: "room_player_count", label: "Players in a room", minimumNumber: 2, maximumNumber: 100, stepNumber: 1, pickedNumber: 64, unit: "players", state: "is-pressed" })), isStill: true },
    { label: "Keyboard focus", markup: examplePane(slider({ id: "example-slider-focus", name: "music_volume", label: "Music", minimumNumber: 0, maximumNumber: 100, stepNumber: 5, pickedNumber: 40, unit: "%", state: "is-focused" })), isStill: true },
    { label: "At its ends", markup: examplePane(html`${slider({ id: "example-slider-least", name: "music_volume", label: "Music", minimumNumber: 0, maximumNumber: 100, stepNumber: 5, pickedNumber: 0, unit: "%" })}${slider({ id: "example-slider-most", name: "effects_volume", label: "Effects", minimumNumber: 0, maximumNumber: 100, stepNumber: 5, pickedNumber: 100, unit: "%" })}`) },
  ],
});

export interface FileDropOptions {
  name: string;
  label: string;
  /** The kinds it takes, as a file input's accept: ".zip", "image/png,image/webp". */
  accept: string;
  isMultiple?: boolean;
  /** What to drop, in a few words: "A .zip of your game's folder, up to 500 MB." */
  hint: string;
  /** Unique on the page. Defaults to drop-<name>. */
  id?: string;
  /** "over" shows a file held over it: the gallery's fixed state. */
  state?: "over";
}

/**
 * A file drop: a carved field the size of a pane, its outline drawn dashed, turning orange while a file is held over it. It's a real file
 * input across the whole field, so a drop, a tap and the keyboard all reach it; the files picked are listed under it with their sizes.
 */
export function fileDrop(options: FileDropOptions): Raw {
  const id = options.id ?? `drop-${options.name}`;
  return html`<div class="file-drop-wrap" data-file-drop><div class="file-drop cut-carved${options.state === "over" ? " is-over" : ""}" data-cut-line="10">${CUT_LINE}<input class="file-drop-input" type="file" id="${id}" name="${options.name}" accept="${options.accept}"${options.isMultiple ? raw(" multiple") : ""} aria-describedby="${id}-hint">${icon("upload")}<span class="file-drop-words"><label for="${id}">${options.label}</label><span id="${id}-hint">${options.hint}</span></span></div><ul class="file-drop-list" aria-live="polite" hidden></ul></div>`;
}

/** A file drop lights while a file is held over it, and lists what's picked, each with its size. */
export const FILE_DROP_SCRIPT = `/* file drops */(function () {
  function sizeWords(byteCount) {
    if (byteCount < 1000) return byteCount + " bytes";
    if (byteCount < 1e6) return (byteCount / 1e3).toFixed(0) + " KB";
    if (byteCount < 1e9) return (byteCount / 1e6).toFixed(1) + " MB";
    return (byteCount / 1e9).toFixed(2) + " GB";
  }
  document.querySelectorAll("[data-file-drop]").forEach(function (root) {
    var drop = root.querySelector(".file-drop"), input = root.querySelector(".file-drop-input"), list = root.querySelector(".file-drop-list");
    var depth = 0;
    input.addEventListener("dragenter", function () { depth++; drop.classList.add("is-over"); });
    input.addEventListener("dragleave", function () { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("is-over"); });
    input.addEventListener("drop", function () { depth = 0; drop.classList.remove("is-over"); });
    input.addEventListener("change", function () {
      list.textContent = "";
      Array.prototype.forEach.call(input.files, function (file) {
        var row = document.createElement("li"), name = document.createElement("span"), size = document.createElement("span");
        name.className = "file-drop-name"; name.textContent = file.name; size.className = "file-drop-size"; size.textContent = sizeWords(file.size);
        row.appendChild(name); row.appendChild(size); list.appendChild(row);
      });
      list.hidden = !input.files.length;
      drop.classList.toggle("has-files", input.files.length > 0);
    });
  });
})();
`;

component({
  name: "File drop",
  slug: "file-drop",
  group: "inputs",
  summary: "Handing over files: a game's build, a cover, a screenshot for a report. Drop them on it, tap it, or reach it by keyboard; what's picked is listed with its size.",
  styles: `
/* A file drop: a carved field the size of a pane, its outline dashed. Pointing at it clears it a little; a file held over it whitens it and
   turns the dashes orange, and keyboard focus draws the outline whole, in orange. The file input lies across all of it, unseen. */
.file-drop-wrap { display: grid; gap: var(--gap-words-control); }
.file-drop { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gap-words-control); min-height: 168px;
  padding: var(--pad-pane); text-align: center; color: var(--muted); --face-color: var(--field-face); background: var(--face-color); box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.file-drop:hover { --face-color: var(--field-hover); }
.file-drop.is-over { --face-color: var(--field-focus); color: var(--ink); }
.file-drop > .ico { width: 28px; height: 28px; transition: transform 0.3s var(--spring); }
.file-drop.is-over > .ico { transform: translateY(-3px); }
.file-drop-input { position: absolute; inset: 0; z-index: 5; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.file-drop-words { display: grid; gap: var(--gap-words-words); }
.file-drop-words label { font: var(--type-label); color: var(--ink); }
.file-drop-words span { font: var(--type-facts); color: var(--ink-2); }
.file-drop > .cut-line { z-index: 4; }
.file-drop > .cut-line polygon { stroke: var(--drop-dash); stroke-width: 2; stroke-dasharray: 7 5; }
.file-drop.is-over > .cut-line polygon { stroke: var(--focus); stroke-width: 3; }
.file-drop:focus-within > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); stroke-dasharray: none; }
.file-drop-list { list-style: none; margin: 0; padding: 0; display: grid; }
.file-drop-list li { display: flex; justify-content: space-between; gap: var(--gap-words-control); padding: var(--gap-words-words) 0; border-top: var(--divider); font: var(--type-words); color: var(--ink); }
.file-drop-list li:first-child { border-top: 0; }
.file-drop-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-drop-size { flex: none; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .file-drop > .ico { transition: none; } }
`,
  render: fileDrop,
  examples: [
    { label: "Waiting for a file", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-rest", name: "build", label: "Drop your game's folder as a .zip", accept: ".zip", hint: "Or tap to pick it. Up to 500 MB; the upload command takes bigger builds." }) }) },
    { label: "A file held over it", isWide: true, markup: glassPane({ paneWidth: "full", body: fileDrop({ id: "example-drop-over", name: "build", label: "Drop your game's folder as a .zip", accept: ".zip", hint: "Or tap to pick it. Up to 500 MB; the upload command takes bigger builds.", state: "over" }) }) },
    { label: "Several images", markup: examplePane(fileDrop({ id: "example-drop-images", name: "screenshots", label: "Add screenshots", accept: "image/png,image/jpeg,image/webp", isMultiple: true, hint: "PNG, JPEG or WebP, 16:9." })) },
  ],
});

export interface CodeFieldOptions {
  label: string;
  /** What it holds, shown whole and copied whole: an API key, an address, a command. */
  code: string;
  /** Unique on the page. Defaults to a slug of its label. */
  id?: string;
}

/**
 * A code field: code in a carved field, shown whole (it wraps rather than hiding any of it), with a Copy button at its end; for an API key
 * shown once, an address, a command. Clicking the code selects all of it.
 */
export function codeField(options: CodeFieldOptions): Raw {
  const id = options.id ?? `code-${options.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return html`<div class="cut-field"><span class="code-label" id="${id}-label">${options.label}</span><div class="field code cut-carved" data-cut-line="10">${CUT_LINE}<code class="code-text" id="${id}" tabindex="0" aria-labelledby="${id}-label">${options.code}</code>${cutButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true, controls: id })}<span class="code-copied" role="status"></span></div></div>`;
}

/** Copy: the field's whole code goes to the clipboard, and "Copied" shows for a moment; clicking the code selects all of it. */
export const COPY_SCRIPT = `/* code fields */(function () {
  function selectAll(element) { var range = document.createRange(); range.selectNodeContents(element); var picked = window.getSelection(); picked.removeAllRanges(); picked.addRange(range); }
  document.addEventListener("click", function (event) {
    var code = event.target.closest && event.target.closest(".field.code > .code-text");
    if (code) { selectAll(code); return; }
    var copy = event.target.closest && event.target.closest(".field.code > .cut-btn[aria-controls]");
    if (!copy) return;
    var text = document.getElementById(copy.getAttribute("aria-controls")), field = copy.parentElement, said = field.querySelector(".code-copied");
    if (!text) return;
    function done() {
      said.textContent = "Copied"; field.classList.add("is-copied");
      clearTimeout(said.timer); said.timer = setTimeout(function () { said.textContent = ""; field.classList.remove("is-copied"); }, 1600);
    }
    // Where the clipboard isn't open to the page, the code is selected and copied the old way.
    function byHand() { selectAll(text); try { if (document.execCommand("copy")) done(); } catch (error) {} }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text.textContent).then(done, byHand);
    else byHand();
  });
})();
`;

component({
  name: "Code field",
  slug: "code-field",
  group: "inputs",
  summary: "Code to copy and keep: an API key shown once, a game's address, an upload command. It's read-only, in code's own letters, with a Copy button at its end.",
  styles: `
/* A code field: code set into the glass, a carved well like a switch's (nothing to type, so it isn't a field's lighter face), all of it in
   code's letters, wrapping onto more lines rather than hiding any. Copy is the small raised cut button at its end, standing out from the well; once it's copied, "Copied" shows beside it for a moment. */
.code-label { padding-inline: var(--pad-words); font: var(--type-label); color: var(--ink-2); }
.field.code { height: auto; min-height: 52px; align-items: stretch; }
.code-text { position: relative; z-index: 2; flex: 1; min-width: 0; padding: 15px 104px 15px 16px; font: 500 15px/1.45 ui-monospace, Menlo, monospace; color: var(--ink);
  overflow-wrap: anywhere; cursor: text; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.code-text:focus-visible { outline: none; }
.field.code:focus-within > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.code-copied { position: absolute; z-index: 5; right: 56px; top: 17px; font: var(--type-facts); color: var(--ink-2); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.field.code.is-copied .code-copied { opacity: 1; }
`,
  render: codeField,
  examples: [
    { label: "An API key, shown once", markup: examplePane(codeField({ id: "example-code-key", label: "Your new API key", code: "zk_live_8f3a91c2e74b5d06a1f9c3e8b27d4a60" })) },
    { label: "A command", markup: examplePane(codeField({ id: "example-code-command", label: "Upload from your terminal", code: "npx @zaisma/cli upload ./build --game ashen-crown" })) },
  ],
});
