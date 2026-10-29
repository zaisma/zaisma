import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, EDGE, EDGE_LIGHT, floatingPane, glassPane, icon, loader, well, type IconName } from "./foundations.ts";
import { examplePane } from "./example-pane.ts";
import { LEAST_SCROLL_PX } from "./tokens.ts";

/*
 * Choices: longer words, a pick from a list, yes or no, and one of a few. Split from inputs.ts; inputs.ts re-exports them.
 */

/* ---- Longer words, picks from a list, yes or no, one of a few, and a number on a scale. ---- */

export interface LongFieldOptions {
  name: string;
  label: string;
  /** Unique on the page. Defaults to field-<name>. */
  id?: string;
  /** What it holds already. */
  text?: string;
  placeholder?: string;
  /** How many lines tall it starts; it grows with its words up to 12, then scrolls. */
  rowCount: number;
  /** At most this many characters; the count shows once 80% of them are used. */
  maximumCharacterCount?: number;
  /** A line under it, saying what goes in it; an error takes its place. */
  hint?: string;
  isRequired?: boolean;
  /** It can't be changed now: its words show, and its form sends nothing for it. */
  isDisabled?: boolean;
  error?: string;
  state?: "is-focused";
}

/** The count's words: "1,620 of 2,000". */
const lengthWords = (characterCount: number, maximumCharacterCount: number) => `${characterCount.toLocaleString("en-US")} of ${maximumCharacterCount.toLocaleString("en-US")}`;

/**
 * A long field: the cut field for more than a line (a description, patch notes, a reply), growing with its words, with a count near its
 * limit. The count comes before the hint or error, so whichever words are last keep the pane's margin at its foot.
 */
export function longField(options: LongFieldOptions): Raw {
  const id = options.id ?? `field-${options.name}`;
  const characterCount = options.text?.length ?? 0;
  const isCountShown = options.maximumCharacterCount !== undefined && characterCount >= options.maximumCharacterCount * 0.8;
  const describedBy = [options.maximumCharacterCount !== undefined ? `${id}-count` : "", options.error ? `${id}-error` : options.hint ? `${id}-hint` : ""].filter(Boolean).join(" ");
  const className = ["field", "long", "carving", "layered", "is-used", options.error ? "is-marked" : "", options.isDisabled ? "is-disabled" : "", options.state ?? ""].filter(Boolean).join(" ");
  return html`<div class="cut-field"><label class="words-margin" for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}<textarea id="${id}" name="${options.name}" rows="${options.rowCount}" data-long-field${options.maximumCharacterCount !== undefined ? html` maxlength="${options.maximumCharacterCount}"` : ""}${options.placeholder ? html` placeholder="${options.placeholder}"` : ""}${options.isRequired ? raw(" required") : ""}${options.isDisabled ? raw(" disabled") : ""}${options.error ? raw(' aria-invalid="true"') : ""}${describedBy ? html` aria-describedby="${describedBy}"` : ""}>${options.text ?? ""}</textarea></span>
${options.maximumCharacterCount !== undefined ? html`<p class="long-count words-margin" id="${id}-count"${isCountShown ? "" : raw(" hidden")}>${lengthWords(characterCount, options.maximumCharacterCount)}</p>` : ""}${options.error ? html`<p class="field-error words-margin" id="${id}-error">${options.error}</p>` : options.hint ? html`<p class="field-hint" id="${id}-hint">${options.hint}</p>` : ""}</div>`;
}

/**
 * A long field grows with its words, from its rows up to 12 lines, then scrolls (is-scrolling), its words keeping clear of its rail; its
 * count shows from 80% of its limit. It's measured as it would be without the rail's room, so the room never changes how tall it grows.
 */
export const LONG_FIELD_SCRIPT = `/* long fields */(function () {
  var MOST_LINES = 12;
  function fit(area) {
    var css = getComputedStyle(area), line = parseFloat(css.lineHeight) || 24, frame = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    area.style.height = "auto"; area.classList.remove("is-scrolling");
    var least = line * (Number(area.getAttribute("rows")) || 2) + frame, most = line * MOST_LINES + frame;
    area.classList.toggle("is-scrolling", area.scrollHeight > most + 1);
    area.style.height = Math.max(least, Math.min(area.scrollHeight, most)) + "px";
    var limit = Number(area.getAttribute("maxlength")), count = document.getElementById(area.id + "-count");
    if (!limit || !count) return;
    count.hidden = area.value.length < limit * 0.8;
    count.textContent = area.value.length.toLocaleString("en-US") + " of " + limit.toLocaleString("en-US");
  }
  document.querySelectorAll("textarea[data-long-field]").forEach(fit);
  document.addEventListener("input", function (event) { if (event.target.matches && event.target.matches("textarea[data-long-field]")) fit(event.target); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { document.querySelectorAll("textarea[data-long-field]").forEach(fit); });
})();
`;

const LONG_STYLES = `
/* A long field: the cut field, as tall as its words, from its rows up to 12 lines (LONG_FIELD_SCRIPT), then it scrolls on its rail.
   Its words are the reading face at 16px, so phones don't zoom in; the count of characters shows under it near the limit, at its end. */
.field.long { height: auto; align-items: stretch; }
/* It fills a pane's width; in a pane that fits what's in it, its words run a reading width (--size-reading), or what room there is. */
.field.long textarea { position: relative; z-index: 2; display: block; flex: 1; min-width: 0; width: var(--size-reading); max-width: 100%; resize: none; overflow-y: auto;
  font: 400 1rem/1.5 var(--body); color: var(--ink); caret-color: var(--run-lo); clip-path: var(--cut-shape); }
.field.long textarea:focus-visible { outline: none; }
.field.long textarea::placeholder { color: var(--muted); }
/* Past 12 lines it scrolls, and its words keep clear of its rail, laid over its end (materials.ts). */
.field.long.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Can't be changed now: flat in the glass, its words quieter, and nothing changes as you point at it. */
.field.long.is-disabled::before { --face-color: var(--off-face); }
.field.long.is-disabled textarea { color: var(--muted); cursor: default; }
.long-count { margin: 0; align-self: flex-end; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; }
`;

const PATCH_NOTES = "Rebalanced the second boss: its slam now telegraphs half a second earlier, and the arena's pillars break after three hits instead of five.";

/** Patch notes long enough to pass the field's 12 lines, so it scrolls. */
const LONG_PATCH_NOTES = [
  "Ashen Crown 1.4: The Long Night",
  "",
  "New: the Iron Vigil, a night-long siege for up to 64 players, with its own map, three new bosses and a leaderboard that resets every Sunday.",
  "Rebalanced the second boss: its slam now telegraphs half a second earlier, and the arena's pillars break after three hits instead of five.",
  "Ranked matches find a room nearest to most of their players, so a party split across Europe and North America no longer lands in Asia Pacific.",
  "Cloud saves keep your last five saves, and any of them can be restored from the pause menu.",
  "Fixed: controllers disconnecting after a long pause, the minimap drifting at ultrawide sizes, and a crash when two players revived the same ally at once.",
].join("\n");

component({
  name: "Long field",
  slug: "long-field",
  group: "inputs",
  subgroup: "fields",
  summary: "More than a line of words: a game's description, patch notes, a reply. It grows with what's written, and counts the characters only once the limit is near.",
  styles: LONG_STYLES,
  render: longField,
  examples: [
    { label: "Empty", markup: examplePane(longField({ id: "example-long-empty", name: "patch_notes", label: "What's new", placeholder: "What changed in this version", rowCount: 3, maximumCharacterCount: 2000 })) },
    { label: "Filled", markup: examplePane(longField({ id: "example-long-filled", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, maximumCharacterCount: 2000 })) },
    { label: "With a hint", markup: examplePane(longField({ id: "example-long-hint", name: "description", label: "Description", rowCount: 3, hint: "Players see it under the game's title, before they press Play." })) },
    { label: "Focused", markup: examplePane(longField({ id: "example-long-focused", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, state: "is-focused" })), isStill: true },
    { label: "Near its limit: the count shows", markup: examplePane(longField({ id: "example-long-count", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, maximumCharacterCount: 160 })) },
    { label: "Past 12 lines: it scrolls", markup: examplePane(longField({ id: "example-long-scroll", name: "patch_notes", label: "What's new", text: LONG_PATCH_NOTES, rowCount: 3, maximumCharacterCount: 2000 })) },
    { label: "Error", markup: examplePane(longField({ id: "example-long-error", name: "description", label: "Description", rowCount: 3, error: "Say what the game is in a line or more." })) },
    { label: "Can't be changed", markup: examplePane(longField({ id: "example-long-disabled", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, isDisabled: true })) },
  ],
});

export interface SelectChoice {
  label: string;
  /** What the form sends when it's picked. */
  choiceValue: string;
}

export interface SelectFieldOptions {
  name: string;
  label: string;
  choices: SelectChoice[];
  /** The choice picked now. Left out, the first, unless there's a placeholder. */
  pickedValue?: string;
  /** What it says while nothing is picked ("Pick a region"), in quieter words; the form sends nothing for it until a choice is picked. */
  placeholder?: string;
  /** Unique on the page. Defaults to field-<name>. */
  id?: string;
  /** What kind of thing it picks, like a cut field's. Left out, the words start at the edge. */
  icon?: IconName;
  /** It can't be changed now: its pick shows, and its form sends nothing for it. */
  isDisabled?: boolean;
  error?: string;
  /** data-* attributes on the hidden field it sends, as on a button: what a page's script reads when a pick changes it ({ label: "Mode" } is data-label="Mode"). */
  dataAttributes?: Record<string, string>;
  /** The gallery's fixed states: focused, or open, its list over the field. */
  state?: "is-focused" | "is-open";
}

/**
 * A select field: a cut field that opens a list of Zaisma's glass over it, on every device, so picking from a list looks and feels like
 * the rest of the page. For one of many (a region, a language); one of a few is Choice cards or a Switch. The pick is sent as a hidden field.
 * It's as wide as its longest choice wherever it fits what's in it, so it never changes width as you pick.
 */
export function selectField(options: SelectFieldOptions): ControlMarkup {
  const id = options.id ?? `field-${options.name}`;
  const picked = options.choices.find((choice) => choice.choiceValue === options.pickedValue) ?? (options.placeholder ? undefined : options.choices[0]);
  const isOpen = options.state === "is-open";
  const pickedIndex = Math.max(0, picked ? options.choices.indexOf(picked) : 0);
  const className = ["field", "select", "carving", "is-used", "sized", options.icon ? "" : "no-icon", options.error ? "is-marked" : "", options.isDisabled ? "is-disabled" : "", options.state === "is-focused" ? "is-focused" : "", isOpen ? "is-open" : ""].filter(Boolean).join(" ");
  // The list is a Floating pane over the field holding the listbox, which scrolls inside it, so its rail and its cut edge stay inside the
  // glass. Shown open in place, its picked row (36px rows, 2px apart, under its 4px edge) lies on the field's line.
  const list = floatingPane({
    id: `${id}-list`,
    placement: "over",
    kind: `select-list${options.icon ? " after-icon" : ""}`,
    isShownInPlace: isOpen,
    lineFromTop: `${4 + pickedIndex * 38 + 18}px`,
    body: html`<div class="select-options" id="${id}-choices" role="listbox" aria-labelledby="${id}-label" tabindex="-1">${options.choices.map(
      (choice, choiceIndex) =>
        html`<div class="select-option flush-row compact${isOpen && choice === picked ? " is-active" : ""}" role="option" id="${id}-option-${choiceIndex}" data-choice-value="${choice.choiceValue}" aria-selected="${choice === picked ? "true" : "false"}" data-cut-line="8">${CUT_LINE}<span>${choice.label}</span><span class="select-tick">${icon("check")}</span></div>`,
    )}</div>`,
  });
  const sizes = html`<span class="select-sizes" aria-hidden="true">${options.placeholder ? html`<span>${options.placeholder}</span>` : ""}${options.choices.map((choice) => html`<span>${choice.label}</span>`)}</span>`;
  return controlMarkup(html`<div class="cut-field" data-select><label class="words-margin" id="${id}-label" for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}${options.icon ? icon(options.icon) : ""}<button type="button" class="select-button carving-control" id="${id}" aria-haspopup="listbox" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-choices"${options.isDisabled ? raw(" disabled") : ""}${options.error ? html` aria-invalid="true" aria-describedby="${id}-error"` : ""}><span class="select-value${picked ? "" : " is-placeholder"}">${picked?.label ?? options.placeholder ?? ""}</span>${sizes}</button><span class="select-chev">${icon("chevron-down")}</span></span>
${list}<input type="hidden" name="${options.name}" value="${picked?.choiceValue ?? ""}"${options.isDisabled ? raw(" disabled") : ""}${Object.entries(options.dataAttributes ?? {}).map(([attributeName, attributeValue]) => html` data-${attributeName}="${attributeValue}"`)}>
${options.error ? html`<p class="field-error words-margin" id="${id}-error">${options.error}</p>` : ""}</div>`, "field", { hasOwnWords: true });
}

/**
 * Select fields: the list is a Floating pane over its field (zaismaFloat), as wide as it, the picked choice (the first, with none) on the
 * field's own line, so its words sit on the field's; a list that scrolls brings the pick to its middle first. The arrow keys move through it,
 * a letter jumps to a choice, Enter or a press picks one and closes it, Esc or a press elsewhere closes it. A pick sets the hidden field and
 * sends it a change event.
 */
export const SELECT_SCRIPT = `/* select fields */(function () {
  var LEAST_SCROLL_PX = ${LEAST_SCROLL_PX};
  window.zaismaWatch.each("[data-select]", function (root) {
    var button = root.querySelector(".select-button"), list = root.querySelector(".select-list"), box = list.querySelector('[role="listbox"]'), scroller = list.querySelector(".floating-body"), hidden = root.querySelector('input[type="hidden"]'), field = button.closest(".field"), value = root.querySelector(".select-value");
    // A list a little taller than its ceiling would scroll by a sliver (and its rail, showing, narrow it): it stops shorter instead, so it
    // scrolls by at least LEAST_SCROLL_PX. Its rail only ever adds to what it scrolls by, so this holds once it's set.
    function keepOffSliver() {
      list.style.maxHeight = "";
      var extraPx = scroller.scrollHeight - scroller.clientHeight;
      if (extraPx > 0 && extraPx < LEAST_SCROLL_PX) list.style.maxHeight = Math.floor(list.getBoundingClientRect().height - (LEAST_SCROLL_PX - extraPx)) + "px";
    }
    if (document.fonts) document.fonts.ready.then(keepOffSliver); else keepOffSliver();
    window.zaismaWatch.resize(keepOffSliver);
    // Shown open in place, a list that scrolls brings its pick to its middle, and its line follows the pick.
    if (list.classList.contains("in-place")) {
      var still = list.querySelector('[aria-selected="true"]') || list.querySelector('[role="option"]');
      if (still && scroller.scrollHeight > scroller.clientHeight) {
        scroller.scrollTop = still.offsetTop - (scroller.clientHeight - still.offsetHeight) / 2;
        list.style.setProperty("--line-from-top", scroller.offsetTop + still.offsetTop - scroller.scrollTop + still.offsetHeight / 2 + "px");
      }
      return;
    }
    var options = Array.prototype.slice.call(box.querySelectorAll('[role="option"]')), active = -1, typed = "", typedAt = 0;
    function picked() { return options.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; }); }
    function setActive(i) {
      active = Math.max(0, Math.min(options.length - 1, i));
      options.forEach(function (o, j) { o.classList.toggle("is-active", j === active); });
      box.setAttribute("aria-activedescendant", options[active].id);
      var o = options[active], top = o.offsetTop; if (top < scroller.scrollTop) scroller.scrollTop = top; else if (top + o.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + o.offsetHeight - scroller.clientHeight;
    }
    var float = window.zaismaFloat(list, {
      anchor: field, home: root, focusOnClose: button,
      // The pick's middle, by offsets: while it opens out of the field its scale isn't whole yet.
      lineOf: function () { var row = options[Math.max(0, picked())]; return scroller.offsetTop + row.offsetTop - scroller.scrollTop + row.offsetHeight / 2; },
      onShown: function () {
        keepOffSliver();
        var row = options[Math.max(0, picked())];
        if (scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = row.offsetTop - (scroller.clientHeight - row.offsetHeight) / 2;
      },
      onToggle: function (isOpen) {
        button.setAttribute("aria-expanded", String(isOpen)); field.classList.toggle("is-open", isOpen);
        if (isOpen) { setActive(Math.max(0, picked())); box.focus({ preventScroll: true }); }
      }
    });
    function pick(i) {
      options.forEach(function (o, j) { o.setAttribute("aria-selected", String(j === i)); });
      value.textContent = options[i].textContent; value.classList.remove("is-placeholder");
      // A first pick from nothing always changes it, even to a choice whose value is empty.
      if (hidden.value !== options[i].getAttribute("data-choice-value") || !isPicked) { hidden.value = options[i].getAttribute("data-choice-value"); hidden.dispatchEvent(new Event("change", { bubbles: true })); }
      isPicked = true; float.close(true);
    }
    var isPicked = picked() >= 0;
    button.addEventListener("click", function () { if (button.disabled) return; if (float.isOpen()) float.close(false); else float.open(); });
    button.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!button.disabled) float.open(); }
    });
    box.addEventListener("click", function (event) { var o = event.target.closest('[role="option"]'); if (o) pick(options.indexOf(o)); });
    box.addEventListener("pointermove", function (event) { var o = event.target.closest('[role="option"]'); if (o && options.indexOf(o) !== active) setActive(options.indexOf(o)); });
    box.addEventListener("keydown", function (event) {
      var key = event.key, step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[key];
      if (step) { setActive(active + step); event.preventDefault(); return; }
      if (key === "Home" || key === "End") { setActive(key === "Home" ? 0 : options.length - 1); event.preventDefault(); return; }
      if (key === "Enter" || key === " ") { pick(active); event.preventDefault(); return; }
      if (key === "Tab") { float.close(false); return; }
      if (key.length !== 1 || event.metaKey || event.ctrlKey) return;
      var now = Date.now(); typed = now - typedAt > 900 ? key.toLowerCase() : typed + key.toLowerCase(); typedAt = now;
      var hit = options.findIndex(function (o) { return o.textContent.toLowerCase().indexOf(typed) === 0; });
      if (hit >= 0) setActive(hit);
    });
  });
})();
`;

const REGIONS: SelectChoice[] = [
  { label: "Nearest to each player", choiceValue: "nearest" },
  { label: "Europe", choiceValue: "europe" },
  { label: "North America", choiceValue: "north-america" },
  { label: "South America", choiceValue: "south-america" },
  { label: "Asia Pacific", choiceValue: "asia-pacific" },
  { label: "Middle East and Africa", choiceValue: "middle-east-africa" },
];

/** Many choices, so the list scrolls: a game's languages. */
const LANGUAGES: SelectChoice[] = ["English", "Deutsch", "Español", "Français", "Italiano", "Nederlands", "Polski", "Português (Brasil)", "Svenska", "Türkçe", "Čeština", "Українська", "日本語", "한국어", "简体中文"].map((label) => ({ label, choiceValue: label.toLowerCase() }));

/** A choice too long for the field on a phone: it ends in an ellipsis there, and shows whole in the list. */
const GENRES: SelectChoice[] = [
  { label: "Action", choiceValue: "action" },
  { label: "Strategy", choiceValue: "strategy" },
  { label: "Massively multiplayer online role-playing", choiceValue: "mmorpg" },
  { label: "Simulation", choiceValue: "simulation" },
];

component({
  name: "Select field",
  slug: "select-field",
  group: "inputs",
  subgroup: "fields",
  summary: "One of many, from a list: a region, a language, a category. It opens a list of Zaisma's glass over the field, the pick where the field was, on every device. For one of a few, use Choice cards or a Switch.",
  styles: `
/* A select field: the cut field holding a button with the picked choice, at 16px on every screen (a pick needs no typing room); the birthday field's chevron sits at its end and turns as it opens.
   Its list is a pane of the menus' glass opening over the field, as wide as it, the picked choice where the field was: the choice under the pointer or the arrow keys
   catches the light, with no line (one under it would read as one over the next), and the picked one has a tick at its end. */
.select-button { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%; --text-end: calc(var(--pad-inside-words) + 24px); --text-start: calc(var(--pad-inside-words) + 34px); cursor: pointer; text-align: left;
  font: 500 1rem var(--display); color: var(--ink); clip-path: var(--cut-shape); }
.field.select.no-icon .select-button { --text-start: var(--pad-inside-words); }
.select-value { display: block; }
.select-value.is-placeholder { color: var(--muted); }
/* Every choice, unseen and taking no height: the field is as wide as its longest choice wherever it fits what's in it, so it never
   changes width as you pick. */
.select-sizes { display: block; height: 0; overflow: hidden; visibility: hidden; }
.select-sizes > span { display: block; white-space: nowrap; }
.select-button:focus-visible { outline: none; }
.field.select.is-open { --face-color: var(--carving-face-focus); }
.field.select:has(:focus-visible) > .cut-line polygon, .field.select.is-focused > .cut-line polygon, .field.select.is-open > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.select-chev { position: absolute; z-index: 3; right: var(--pad-inside-words); display: inline-flex; color: var(--ink); pointer-events: none; transition: transform var(--motion-arrive) var(--ease-glide); }
.select-chev > .ico { position: static; width: 16px; height: 10px; stroke-width: 2.2; }
.field.select.is-open .select-chev { transform: rotate(180deg); }
/* Can't be changed now: flat in the glass, its pick and chevron quieter, and nothing changes as you point at it. */
.field.select.is-disabled { --face-color: var(--off-face); }
.field.select.is-disabled .select-button { color: var(--muted); cursor: default; }
.field.select.is-disabled .select-chev { color: var(--muted); }
/* The list: a Floating pane over the field, scrolling in its body past a menu's height. Its choices sit close to its edge, inset like a
   well's slabs, so their words start where the field's do. */
.select-options { display: flex; flex-direction: column; gap: 2px; outline: none; }
/* A choice is a compact flush row (materials.ts). */
.select-option { gap: 10px; flex: none; text-wrap: pretty; }
/* Beside an icon, the field's words start after it, and so do its choices'. */
.select-list.after-icon .select-option > span:first-of-type { margin-inline-start: 30px; }
.select-option > :not(.cut-line) { position: relative; z-index: 2; }
.select-option > span { flex: 1; }
/* The row under the pointer or the arrow keys catches the light: its glass clears, as a pointed field's does, and its cut edge is lit
   above and shaded below. Nothing moves until it's pressed: then it carves into the list's glass, like every press. */
.select-option.is-active { color: var(--ink); --face-color: var(--field-hover); }
.select-option.is-active > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.select-option:active > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* The pick: its words in full ink and a tick at its end, so it shows wherever the slab is. */
.select-option[aria-selected="true"] { color: var(--ink); }
.select-option > .select-tick { flex: none; display: inline-flex; visibility: hidden; color: var(--ink); }
.select-tick > .ico { width: 18px; height: 18px; stroke-width: 2.2; }
.select-option[aria-selected="true"] > .select-tick { visibility: visible; }
.select-options:focus-visible .select-option.is-active > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .select-chev { transition: none; } }
`,
  render: selectField,
  examples: [
    { label: "Picked: try it", markup: examplePane(selectField({ id: "example-select-region", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "nearest" })) },
    { label: "Nothing picked yet", markup: examplePane(selectField({ id: "example-select-placeholder", name: "room_region", label: "Where rooms run", choices: REGIONS, placeholder: "Pick a region" })) },
    { label: "With an icon", markup: examplePane(selectField({ id: "example-select-icon", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "nearest", icon: "globe" })) },
    { label: "With a data attribute a script reads: a room list's filter", markup: examplePane(selectField({ id: "example-select-filter", name: "room_mode", label: "Mode", choices: [{ label: "Any", choiceValue: "" }, { label: "Classic", choiceValue: "Classic" }, { label: "Hardcore", choiceValue: "Hardcore" }], dataAttributes: { label: "Mode" } })) },
    { label: "Focused", markup: examplePane(selectField({ id: "example-select-focused", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", state: "is-focused" })), isStill: true },
    { label: "Open", markup: examplePane(selectField({ id: "example-select-open", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", state: "is-open" })), isStill: true },
    { label: "Many choices: the list scrolls", markup: examplePane(selectField({ id: "example-select-many", name: "language", label: "Language", choices: LANGUAGES, pickedValue: "deutsch", state: "is-open" })), isStill: true },
    { label: "A long choice: cut in the field, whole in the list", markup: examplePane(selectField({ id: "example-select-long", name: "genre", label: "Genre", choices: GENRES, pickedValue: "mmorpg", state: "is-open" })), isStill: true },
    { label: "Error: nothing picked", markup: examplePane(selectField({ id: "example-select-error", name: "room_region", label: "Where rooms run", choices: REGIONS, placeholder: "Pick a region", error: "Pick where your rooms run to go on." })) },
    { label: "Can't be changed", markup: examplePane(selectField({ id: "example-select-disabled", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", isDisabled: true })) },
  ],
});

/** The gallery's fixed states for what you press that holds a value (a box, a card, a switch). */
type PressState = "is-pointed" | "is-pressed" | "is-focused";

/**
 * On a phone, what you press here takes a whole control's height (--control-height-regular, 44px) to touch, however thin it looks: an
 * unseen strip across the line, centered on it, or the line itself when it's taller.
 */
const TOUCH_ROOM = (selector: string) =>
  `@media (pointer: coarse) { ${selector}::before { content: ""; position: absolute; inset: min(0px, calc(50% - var(--touch-target) / 2)) 0; } }`;

export interface CheckFieldOptions {
  name: string;
  label: string;
  isChecked?: boolean;
  /** A line under its label, saying what it changes. */
  hint?: string;
  /** What it sends when ticked. Defaults to "yes"; one of several boxes with the same name sends its own (a game's slug). */
  checkValue?: string;
  /** It has to be ticked to send its form (I agree to the rules). */
  isRequired?: boolean;
  /** What's wrong, said under its words in place of its hint: it wasn't ticked. */
  error?: string;
  /** It can't be changed now: it shows ticked or not, and its form sends nothing for it. */
  isDisabled?: boolean;
  /** Unique on the page. Defaults to check-<name>. */
  id?: string;
  state?: PressState;
}

/**
 * A check field: a box to tick, for a yes or no that's sent with its form (I agree, Email me replies). On a page that saves at once, use a
 * Toggle. The whole line is its label; the box is named by its label's words alone, and its hint or error describes it.
 */
export function checkField(options: CheckFieldOptions): Raw {
  const id = options.id ?? `check-${options.name}`;
  const className = ["check", options.state ?? "", options.error ? "is-marked" : "", options.isDisabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  const describedBy = options.error ? `${id}-error` : options.hint ? `${id}-hint` : "";
  return html`<label class="${className}" for="${id}"><span class="check-box carving socket" data-cut-line="6" data-cut-ring="3">${CUT_LINE}<input class="check-input" type="checkbox" id="${id}" name="${options.name}" value="${options.checkValue ?? "yes"}"${options.isChecked ? raw(" checked") : ""}${options.isRequired ? raw(" required") : ""}${options.isDisabled ? raw(" disabled") : ""}${options.error ? raw(' aria-invalid="true"') : ""} aria-labelledby="${id}-label"${describedBy ? html` aria-describedby="${describedBy}"` : ""}><span class="check-well socket-face" aria-hidden="true"><span class="check-piece socket-piece">${icon("check")}</span></span></span><span class="check-words words-margin at-end"><span class="check-label" id="${id}-label">${options.label}</span>${options.error ? html`<span class="check-error" id="${id}-error">${options.error}</span>` : options.hint ? html`<span class="check-hint" id="${id}-hint">${options.hint}</span>` : ""}</span></label>`;
}

/** A check field just ticked under the pointer doesn't glint: its glint is for pointing at one already ticked, so it waits until the pointer leaves. */
export const CHECK_SCRIPT = `/* check fields */(function () {
  document.addEventListener("change", function (event) {
    var input = event.target; if (!input.classList || !input.classList.contains("check-input")) return;
    var check = input.closest(".check"); if (!check || !input.checked) return;
    check.classList.add("is-just-ticked");
    check.addEventListener("pointerleave", function () { check.classList.remove("is-just-ticked"); }, { once: true });
  });
})();
`;

/**
 * Choice cards say which way they lie: side by side, or each on its own line once they don't fit (is-stacked), so the pick's light and the
 * pointer's edge light run along the edge that leads, their foot side by side and their start stacked, never a line over the card below.
 */
export const CHOICE_CARDS_SCRIPT = `/* choice cards */(function () {
  window.zaismaWatch.each(".choice-cards", function (row) {
    function lie() {
      var cards = row.children, isStacked = cards.length > 1 && cards[1].offsetTop > cards[0].offsetTop + 1;
      row.classList.toggle("is-stacked", isStacked);
      Array.prototype.forEach.call(cards, function (card) { card.setAttribute("data-edge-light", isStacked ? "left" : "bottom"); });
    }
    lie();
    window.zaismaWatch.size(row, lie);
  });
})();
`;

/** What you press that holds a value: its states, still, then one to try and one on a loop. */
/** Each copy gets its own key (for its ids and names), so copies of radios never share a group. */
const pressExamples = (render: (state: PressState | undefined, exampleKey: string) => Raw, loopKind: "check" | "choice" | "toggle") => [
  { label: "Rest", markup: render(undefined, "rest"), isStill: true },
  { label: "Pointed", markup: render("is-pointed", "pointed"), isStill: true },
  { label: "Pressed", markup: render("is-pressed", "pressed"), isStill: true },
  { label: "Keyboard focus", markup: render("is-focused", "focused"), isStill: true },
  { label: "Try it", markup: render(undefined, "try") },
  { label: "On a loop", markup: html`<span data-state-loop="${loopKind}">${render(undefined, "loop")}</span>`, isStill: true },
];

component({
  name: "Check field",
  slug: "check-field",
  group: "inputs",
  subgroup: "choices",
  summary: "A yes or no sent with its form: I agree, Email me replies. A small carved socket; ticked, an orange piece with a dark tick slides up into it and seats flush. On a page that saves at once, use a Toggle.",
  styles: `
/* A check field: a small socket carved into the fields' glass, cut by the edge rule, before its words. Ticking slides an orange piece
   up from under the pane: while it moves it's below the carving, the socket's shade and edges over it; once it sits flush it rises out
   of the carving, lit and shaded as its own piece, with a dark tick cut in it. The real checkbox lies over the socket, unseen, so the
   keyboard, forms and screen readers get the system's own; the whole line is its label, so a press anywhere on it ticks it. */
.check { position: relative; display: inline-flex; align-items: flex-start; gap: var(--gap-words-control); cursor: pointer; -webkit-tap-highlight-color: transparent; }
${TOUCH_ROOM(".check")}
/* The box is a socket (materials.ts): its face cut to its shape, its shade over the piece in it, its ring outside it. */
.check-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.check-piece { transform: translateY(105%); transition: transform var(--motion-arrive) var(--ease-standard); }
.check-piece > .ico { width: 16px; height: 16px; stroke-width: 2.4; }
/* Pointed: an empty socket's piece rises a little into view, still under the carving, ready; a ticked piece's face catches a glint
   of light that runs across it once. */
.check-piece::before { opacity: 0; transform: translateX(-110%); }
.check:not(.is-disabled):hover .check-box:not(:has(.check-input:checked)) .check-piece, .check.is-pointed .check-box:not(:has(.check-input:checked)) .check-piece { transform: translateY(80%); }
.check:not(.is-disabled):not(.is-just-ticked):hover .check-box:has(.check-input:checked) .check-piece::before, .check.is-pointed .check-box:has(.check-input:checked) .check-piece::before { opacity: 1; transform: translateX(110%); transition: transform var(--motion-settle) var(--ease-standard); }
/* Ticked: the piece seats flush, then rises out of the carving: the shade lifts off it and its own edges take the light. */
.check-box:has(.check-input:checked) .check-piece { transform: translateY(0); }
.check-box:has(.check-input:checked) .check-well::after { opacity: 0; transition-delay: var(--motion-arrive); }
.check-box:has(.check-input:checked) > .cut-line .cut-band { transition-delay: var(--motion-arrive); }
.check-box:has(.check-input:checked) > .cut-line polygon { stroke: transparent; }
/* Pressed: an empty socket deepens; a ticked piece is pushed back down under the carving, in its shade again. */
.check:not(.is-disabled):active .check-box:has(.check-input:checked) .check-piece, .check.is-pressed .check-box:has(.check-input:checked) .check-piece { transform: translateY(2px); transition-duration: var(--motion-press); }
.check:not(.is-disabled):active .check-box:has(.check-input:checked) .check-well::after, .check.is-pressed .check-box:has(.check-input:checked) .check-well::after { opacity: 1; transition-delay: 0s; }
.check:not(.is-disabled):active .check-box:has(.check-input:checked) > .cut-line, .check.is-pressed .check-box:has(.check-input:checked) > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.check:not(.is-disabled):active .check-box:has(.check-input:checked) > .cut-line .cut-band, .check.is-pressed .check-box:has(.check-input:checked) > .cut-line .cut-band { transition-delay: 0s; }
/* Can't be changed: frosted and still; a ticked piece is grey. */
.check.is-disabled { cursor: default; }
.check.is-disabled .check-input { cursor: default; }
.check.is-disabled .check-well { --face-color: var(--off-face); }
.check.is-disabled .check-box > .cut-line polygon:not(.cut-ring) { stroke: var(--line); }
.check.is-disabled .check-piece { --piece-color: var(--muted); color: var(--page); transition: none; }
.check.is-disabled .check-box:has(.check-input:checked) > .cut-line { --band-top: transparent; --band-left: transparent; --band-right: transparent; --band-bottom: transparent; }
.check.is-disabled .check-label { color: var(--muted); }
/* Keyboard focus: one orange ring in the socket's own shape, set out around it with a 2px gap of glass between (data-cut-ring), so it
   never touches the orange piece and reads the same ticked or not. A required box left unticked is ringed the same way, in the marked colour. */
.check.is-marked .check-box > .cut-line .cut-ring { stroke: var(--marked); }
.check-box:has(.check-input:focus-visible) > .cut-line .cut-ring, .check.is-focused .check-box > .cut-line .cut-ring { stroke: var(--focus); }
.check-words { display: grid; gap: var(--gap-words-words); margin-top: 2px; }
.check-label { font: var(--type-words); color: var(--ink); }
.check-hint { font: var(--type-note); color: var(--muted); }
.check-error { font: var(--type-words); color: var(--marked); }
@media (prefers-reduced-motion: reduce) { .check-piece, .check-piece::before, .check-box .check-well::after, .check-box > .cut-line .cut-band { transition: none; } }
`,
  render: checkField,
  examples: [
    ...pressExamples((state, exampleKey) => checkField({ id: `example-check-${exampleKey}`, name: "reply_emails", label: "Email me replies", state }), "check"),
    { label: "Ticked", markup: checkField({ id: "example-check-ticked", name: "reply_emails", label: "Email me replies", isChecked: true }) },
    { label: "Ticked, pointed", markup: checkField({ id: "example-check-ticked-pointed", name: "reply_emails", label: "Email me replies", isChecked: true, state: "is-pointed" }), isStill: true },
    { label: "Ticked, pressed", markup: checkField({ id: "example-check-ticked-pressed", name: "reply_emails", label: "Email me replies", isChecked: true, state: "is-pressed" }), isStill: true },
    { label: "Ticked, keyboard focus", markup: checkField({ id: "example-check-ticked-focused", name: "reply_emails", label: "Email me replies", isChecked: true, state: "is-focused" }), isStill: true },
    { label: "With a hint", markup: examplePane(checkField({ id: "example-check-hint", name: "rules_agreed", label: "I've read the content rules", hint: "Games break them only by what's in them, never by taste.", isChecked: true })) },
    { label: "Long words", markup: examplePane(checkField({ id: "example-check-long", name: "crossplay", label: "Let players on other devices join my matches, including ranked matches and the Iron Vigil's night-long sieges", hint: "They see your username and your rank, never your friends." })) },
    { label: "Required, not ticked", markup: examplePane(checkField({ id: "example-check-error", name: "rules_agreed_error", label: "I've read the content rules", isRequired: true, error: "Tick this to publish Ashen Crown." })) },
    { label: "Can't be changed", markup: checkField({ id: "example-check-disabled", name: "beta_updates", label: "Get beta updates", isDisabled: true }) },
    { label: "Can't be changed: ticked", markup: checkField({ id: "example-check-disabled-ticked", name: "account_emails", label: "Email me about my account", isChecked: true, isDisabled: true }) },
  ],
});

export interface ChoiceCard {
  label: string;
  choiceValue: string;
  /** A line on what it means. */
  text?: string;
  icon?: IconName;
}

export interface ChoiceCardsOptions {
  name: string;
  /** The question, as the group's legend. */
  label: string;
  /** The legend is for screen readers only: a heading above already asks the question (How do you play?). */
  isLabelHidden?: boolean;
  choices: ChoiceCard[];
  pickedValue?: string;
  /** Unique on the page. Defaults to choice-<name>. */
  id?: string;
  /** Many choices (a report's reasons): one line each, down a carved well that scrolls once it's long, like a vertical switch. */
  isCompact?: boolean;
  /** What's wrong, said under the cards: none was picked. */
  error?: string;
  /** None can be picked now: the pick shows, and its form sends nothing for it. */
  isDisabled?: boolean;
  /** The gallery's fixed states, on the first card. */
  state?: PressState;
}

/**
 * Choice cards: one of a few, each needing a line to say what it means (who can see a game, how rooms run); compact, one of many (why
 * you're reporting). Radios underneath. Side by side while each has a card's width, slanting toward each other like a row of controls;
 * stacked once they don't, never some of each.
 */
export function choiceCards(options: ChoiceCardsOptions): Raw {
  const id = options.id ?? `choice-${options.name}`;
  const card = (choice: ChoiceCard, choiceIndex: number) =>
    html`<label class="choice-card carving pick${options.isCompact ? " compact" : ""}${choiceIndex === 0 && options.state ? ` ${options.state}` : ""}" data-cut-line="10" data-lights${options.isCompact ? "" : raw(' data-edge-light="bottom"')}>${CUT_LINE}${options.isCompact ? "" : EDGE_LIGHT}<input class="choice-input" type="radio" name="${options.name}" id="${id}-${choice.choiceValue}" value="${choice.choiceValue}"${choice.choiceValue === options.pickedValue ? raw(" checked") : ""}>${choice.icon ? icon(choice.icon) : ""}<span class="choice-words"><span class="choice-label">${choice.label}</span>${choice.text ? html`<span class="choice-text">${choice.text}</span>` : ""}</span></label>`;
  const className = ["choices", options.error ? "is-marked" : "", options.isDisabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  const cards = options.isCompact
    ? well({ kind: "choice-well holds-parts", scrollDirection: "down", edgeLight: "left", body: html`${options.choices.map(card)}` })
    : html`<div class="choice-cards" style="--choice-count: ${options.choices.length}">${options.choices.map(card)}</div>`;
  return html`<fieldset class="${className}"${options.isDisabled ? raw(" disabled") : ""}${options.error ? html` aria-describedby="${id}-error"` : ""}><legend class="${options.isLabelHidden ? "sr" : "words-margin"}">${options.label}</legend>${cards}${options.error ? html`<p class="field-error words-margin" id="${id}-error">${options.error}</p>` : ""}</fieldset>`;
}

const VISIBILITIES: ChoiceCard[] = [
  { label: "Listed", choiceValue: "listed", text: "On Zaisma's shelves and in search, for anyone.", icon: "people" },
  { label: "Unlisted", choiceValue: "unlisted", text: "Only people with its link can find it.", icon: "eye" },
  { label: "Private", choiceValue: "private", text: "Only you and your testers.", icon: "lock" },
];

/** Why someone reports a game (report.ts's reasons): the many-choices case. */
export const REPORT_REASONS: ChoiceCard[] = [
  { label: "It's broken", choiceValue: "broken", text: "Won't load, crashes, or isn't really a game" },
  { label: "A player", choiceValue: "player", text: "Someone in a match is causing trouble" },
  { label: "Sexual content", choiceValue: "sexual", text: "Nudity or sexual material" },
  { label: "Private details or threats", choiceValue: "real_people", text: "Shows where a real person lives or goes to school, or threatens them" },
  { label: "Scam or malware", choiceValue: "malware", text: "Asks for passwords or payment, or tries to install something" },
  { label: "Child safety", choiceValue: "child_safety", text: "Sexualizes children or puts a child in danger" },
  { label: "Illegal content", choiceValue: "illegal", text: "Something against the law" },
  { label: "Something else", choiceValue: "other" },
];

component({
  name: "Choice cards",
  slug: "choice-cards",
  group: "inputs",
  subgroup: "choices",
  summary: "One of a few, when each needs a line to say what it means: who can see a game, how its rooms run. Compact for many (a report's reasons): close together down a carved well that scrolls. The picked one rises as the white slab, orange light along its leading edge (its foot side by side, its start stacked); the rest sit carved and quieter.",
  styles: `
/* Choice cards: radios as cut slabs. The ones not picked are carved into the glass, their words quieter; the picked one rises out of it as
   the switch's white slab, its words in full ink, with orange light inside the glass along the edge that leads: its foot when the cards sit
   side by side, its start when they're stacked (is-stacked, from their script) or down a compact list, so it never reads as a line over the
   card below. Pointing wakes the edge light along that same edge; a press sinks the card, easing in and back out. The real radio lies over
   the card, unseen, so the arrow keys move between them as the system's do. */
.choices { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); }
.choices > legend { font: var(--type-label); color: var(--ink-2); }
/* Side by side, a row of controls: their boxes overlap so the edge rule slants them toward each other, while each can have a
   card's width (--size-card); stacked, --gap-control-stack apart, once they can't. One or the other, never some of each: each card's basis
   is very large while the cards don't fit side by side, so each takes a line, and nothing while they do, so they share the row. */
.choice-cards { --choice-row-least: calc(var(--choice-count) * var(--size-card)); display: flex; flex-wrap: wrap; align-items: stretch; gap: var(--gap-control-stack) 0; }
.choice-cards > .choice-card { flex: 1 1 calc((var(--choice-row-least) - 100%) * 999); }
.choice-cards > .choice-card:not(:last-child) { margin-inline-end: max(var(--gap-control-row-boxes), min(0px, (var(--choice-row-least) - 100%) * 999)); }
.choice-card { cursor: pointer; -webkit-tap-highlight-color: transparent; color: var(--muted); }
.choice-card > :not(.cut-line):not(.choice-input):not(.edge-light) { position: relative; z-index: 2; }
.choice-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.choice-card > .ico { flex: none; margin-top: 1px; color: var(--muted); }
.choice-card > .ico, .choice-card > .choice-words { transition: transform var(--motion-arrive) var(--ease-standard); }
/* What's on a card goes up and down with it, as a page can show depth: down a pixel in its carving, up a pixel when it rises as the
   picked slab, and down further while a press sinks it. */
.choice-card > :is(.ico, .choice-words) { transform: translateY(1px); }
.choice-card:has(.choice-input:checked) > :is(.ico, .choice-words) { transform: translateY(-1px); }
.choice-words { display: grid; gap: var(--gap-words-words); }
.choice-label { font: var(--type-label); color: var(--ink-2); }
.choice-text { font: var(--type-note); color: var(--muted); }
.choices:not(.is-disabled) .choice-card:hover, .choice-card.is-pointed { color: var(--ink-2); }
/* Pressed: it sinks, quickly, its carving deep and shaded from above and its words a pixel down; let go, it eases back. */
.choices:not(.is-disabled) .choice-card:active, .choice-card.is-pressed { color: var(--ink-2); }
.choices:not(.is-disabled) .choice-card:active > :is(.ico, .choice-words), .choice-card.is-pressed > :is(.ico, .choice-words), .choice-card.is-pressed:has(.choice-input:checked) > :is(.ico, .choice-words) { transform: translateY(2px); transition-duration: var(--motion-press); }
/* Picked: the slab rises out of the carving (a pick, materials.ts), its words in full ink. Its light runs down its start once the cards
   are stacked or down a compact list, so it never reads as a line over the card below. */
.choice-card:has(.choice-input:checked) { color: var(--ink); }
.choice-cards.is-stacked > .choice-card::after, .choice-well .choice-card::after { top: 0; right: auto; width: 18px; height: auto; --pick-light-run: to right; }
.choice-card:has(.choice-input:checked) .choice-label, .choice-card:has(.choice-input:checked) > .ico { color: var(--ink); }
.choice-card:has(.choice-input:checked) .choice-text { color: var(--ink-2); }
/* Marked wrong: every card's outline in amber, and what's wrong said under them. */
.choices.is-marked .choice-card > .cut-line polygon, .choices.is-marked .choice-well > .cut-line polygon { stroke: var(--marked); stroke-width: var(--focus-stroke); }
/* None can be picked now: flat and quieter, and no orange, since there's nothing to do: the pick's light is grey. */
.choices.is-disabled .choice-card, .choices.is-disabled .choice-input { cursor: default; }
.choices.is-disabled .choice-card:not(:has(.choice-input:checked)) { --face-color: transparent; box-shadow: none; }
.choices.is-disabled .choice-card > .cut-line polygon, .choices.is-disabled .choice-well > .cut-line polygon { stroke: var(--line); }
.choices.is-disabled .choice-card { --pick-light: var(--muted); --pick-flood: transparent; }
.choices.is-disabled .choice-card .choice-label, .choices.is-disabled .choice-card > .ico { color: var(--muted); }
.choice-card:has(.choice-input:focus-visible) > .cut-line polygon, .choice-card.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Compact: the cards down a scrolling Well, like a vertical switch's places, fading at its ends and on the rail once it's taller than about
   six choices. The cards inside are flat and close together, their line under their name, with no outline of their own: the well is
   carved, and only the picked one is a slab. Pointing wakes the well's edge light down its side, beside the card, as a vertical switch's does. */
.well.choice-well { --well-height: 336px; }
.well.choice-well > .well-body { display: flex; flex-direction: column; gap: var(--gap-control-row); font: inherit; }
.choice-well .choice-card { flex: none; }
.choice-well .choice-words { gap: 2px; }
.choice-well .choice-card > .cut-line { --band-top: transparent; --band-left: transparent; --band-right: transparent; --band-bottom: transparent; }
.choice-well .choice-card > .cut-line polygon { stroke: transparent; }
/* In a compact list the picked slab is bevelled as a raised piece too, though the cards round it have no edges. */
.choice-well .choice-card:has(.choice-input:checked) > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.choice-well .choice-card:has(.choice-input:focus-visible) > .cut-line polygon, .choice-well .choice-card.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* On a phone it doesn't scroll by itself: the sheet or page it's in does, so there's never a scroll inside a scroll. */
@media (max-width: 760px) { .well.choice-well { --well-height: none; } }
`,
  render: choiceCards,
  examples: [
    ...pressExamples((state, exampleKey) => choiceCards({ id: `example-choice-${exampleKey}`, name: `visibility_${exampleKey}`, label: "Who can see it", choices: VISIBILITIES.slice(0, 2), pickedValue: "unlisted", state }), "choice"),
    { label: "Three, in a pane: side by side where they fit", markup: glassPane({ paneWidth: "full", body: choiceCards({ id: "example-choice-pane", name: "visibility_pane", label: "Who can see it", choices: VISIBILITIES, pickedValue: "listed" }) }), isWide: true },
    { label: "Error: none picked", markup: glassPane({ paneWidth: "full", body: choiceCards({ id: "example-choice-error", name: "visibility_error", label: "Who can see it", choices: VISIBILITIES, error: "Pick who can see Ashen Crown to publish it." }) }), isWide: true },
    { label: "Can't be changed", markup: glassPane({ paneWidth: "full", body: choiceCards({ id: "example-choice-disabled", name: "visibility_disabled", label: "Who can see it", choices: VISIBILITIES, pickedValue: "unlisted", isDisabled: true }) }), isWide: true },
    { label: "Compact: many choices, scrolling", markup: glassPane({ paneWidth: "full", body: choiceCards({ id: "example-choice-compact", name: "report_reason_compact", label: "What's wrong", choices: REPORT_REASONS, pickedValue: "malware", isCompact: true }) }), isWide: true },
  ],
});

export interface ToggleOptions {
  name: string;
  label: string;
  isOn: boolean;
  /** A line under its label, saying what it changes. */
  hint?: string;
  /** Its change is being saved: its slab shows the loader, and it can't be flipped again until it's saved. A page script sets it. */
  isBusy?: boolean;
  /** It can't be changed now: it shows on or off, and its form sends nothing for it. */
  isDisabled?: boolean;
  /** Unique on the page. Defaults to toggle-<name>. */
  id?: string;
  state?: PressState;
}

/** A toggle: on or off for a setting that takes effect as it's saved (Cloud saves, Show me online). A checkbox underneath, sent with its form, so it needs no script to post. */
export function toggle(options: ToggleOptions): Raw {
  const id = options.id ?? `toggle-${options.name}`;
  const className = ["toggle", options.state ?? "", options.isDisabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  return html`<label class="${className}" for="${id}"><span class="toggle-words words-margin at-start"><span class="toggle-label">${options.label}</span>${options.hint ? html`<span class="toggle-hint" id="${id}-hint">${options.hint}</span>` : ""}</span><span class="toggle-slot carving slot" data-cut-line="8">${CUT_LINE}<input class="toggle-input" type="checkbox" role="switch" id="${id}" name="${options.name}" value="on"${options.isOn ? raw(" checked") : ""}${options.hint ? html` aria-describedby="${id}-hint"` : ""}${options.isBusy ? raw(' aria-busy="true"') : ""}${options.isBusy || options.isDisabled ? raw(" disabled") : ""}><span class="toggle-thumb thumb" aria-hidden="true"><span class="toggle-slab thumb-slab cut-raised" data-cut-line="6" data-cut-ends="start end">${CUT_LINE}${loader()}</span></span></span></label>`;
}

/** The gallery's toggles sit in a column a phone's width at most, as in a settings list. */
const TOGGLE_COLUMN = "width:min(340px,100%)";

component({
  name: "Toggle",
  slug: "toggle",
  group: "inputs",
  subgroup: "choices",
  summary: "On or off for a setting: Cloud saves, Show me online. A white slab that springs across a carved slot, which fills orange when it's on. It's a checkbox in its form, so it posts without a script.",
  styles: `
/* A toggle: a carved slot holding a white slab that springs to its far end when on, the slot filling orange behind it. The real
   checkbox (role switch) lies over the slot, unseen; the words before it are its label, so a press on them flips it too. */
.toggle { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--gap-words-control); cursor: pointer; -webkit-tap-highlight-color: transparent; }
${TOUCH_ROOM(".toggle")}
.toggle-words { display: grid; gap: var(--gap-words-words); min-width: 0; }
.toggle-label { font: var(--type-words); color: var(--ink); }
.toggle-hint { font: var(--type-note); color: var(--muted); }
/* The slot is a carving's (materials.ts), the slab a thumb. */
/* Off, it's carved into the glass, its edges lit and shaded like every carving; on, its orange is its edge. */
.toggle-slot:has(.toggle-input:checked) > .cut-line polygon { stroke: transparent; }
.toggle-input { position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.toggle-thumb { position: absolute; z-index: 2; left: 4px; top: 4px; transition: transform var(--motion-arrive) var(--spring), filter var(--motion-state); }
/* Saving: the loader on the slab, in the slab's own dark words (it's white on either glass), until the change is saved. */
.toggle-slab > .loader { --loader-width: 14px; position: relative; z-index: 2; color: var(--thumb-ink); }
.toggle:not(:has(.toggle-input[aria-busy="true"])) .toggle-slab > .loader { display: none; }
.toggle:has(.toggle-input[aria-busy="true"]), .toggle:has(.toggle-input[aria-busy="true"]) .toggle-input { cursor: progress; }
.toggle-slot:has(.toggle-input:checked) { --face-color: var(--run); }
.toggle-slot:has(.toggle-input:checked) > .toggle-thumb { transform: translateX(24px); }
.toggle:not(.is-disabled):hover .toggle-thumb, .toggle.is-pointed .toggle-thumb { filter: var(--thumb-cast-pointed); }
/* Pressed: the slab is pushed down into the slot (a thumb's press), its slide keeping its own pace. */
.toggle:not(.is-disabled):active .toggle-thumb, .toggle.is-pressed .toggle-thumb { transition-duration: var(--motion-arrive), var(--motion-press); }
/* Can't be changed now: the slot flat, the words quieter, and no orange, since there's nothing to do: on, the slot is filled in the grey of
   an edge (--press-rim), which the white slab stands out from in either glass. */
.toggle.is-disabled, .toggle.is-disabled .toggle-input { cursor: default; }
.toggle.is-disabled .toggle-label { color: var(--muted); }
.toggle.is-disabled .toggle-slot { --face-color: var(--off-face); box-shadow: none; }
.toggle.is-disabled .toggle-slot > .cut-line polygon { stroke: var(--line); }
.toggle.is-disabled .toggle-slot:has(.toggle-input:checked) { --face-color: var(--press-rim); }
.toggle-slot:has(.toggle-input:focus-visible) > .cut-line polygon, .toggle.is-focused .toggle-slot > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* On the orange slot, focus is the runner's deeper ring, drawn wider so it reads against the orange. */
.toggle-slot:has(.toggle-input:checked:focus-visible) > .cut-line polygon, .toggle.is-focused .toggle-slot:has(.toggle-input:checked) > .cut-line polygon { stroke: var(--focus-on-run); stroke-width: calc(var(--focus-stroke) * 1.5); }
@media (prefers-reduced-motion: reduce) { .toggle-thumb { transition: none; } .toggle-slot { transition: none; } }
`,
  render: toggle,
  examples: [
    ...pressExamples((state, exampleKey) => html`<div style="${TOGGLE_COLUMN}">${toggle({ id: `example-toggle-${exampleKey}`, name: "cloud_saves", label: "Cloud saves", isOn: true, state })}</div>`, "toggle"),
    { label: "Off", markup: html`<div style="${TOGGLE_COLUMN}">${toggle({ id: "example-toggle-off", name: "shown_online", label: "Show me online", isOn: false })}</div>` },
    { label: "Off, keyboard focus", markup: html`<div style="${TOGGLE_COLUMN}">${toggle({ id: "example-toggle-off-focused", name: "shown_online", label: "Show me online", isOn: false, state: "is-focused" })}</div>`, isStill: true },
    { label: "Saving", markup: html`<div style="${TOGGLE_COLUMN}">${toggle({ id: "example-toggle-busy", name: "cloud_saves", label: "Cloud saves", isOn: true, isBusy: true })}</div>`, isStill: true },
    { label: "With a hint, in a pane", markup: examplePane(toggle({ id: "example-toggle-hint", name: "cloud_saves_pane", label: "Cloud saves", hint: "Players keep their progress on any device.", isOn: true })) },
    { label: "Long words, in a pane", markup: examplePane(toggle({ id: "example-toggle-long", name: "party_invites", label: "Let friends join my matches without an invite, even in a ranked queue", hint: "They join your party's next match; a full match keeps them waiting.", isOn: false })) },
    { label: "Can't be changed: off", markup: html`<div style="${TOGGLE_COLUMN}">${toggle({ id: "example-toggle-disabled", name: "shown_online_locked", label: "Show me online", isOn: false, isDisabled: true })}</div>` },
    { label: "Can't be changed: on", markup: html`<div style="${TOGGLE_COLUMN}">${toggle({ id: "example-toggle-disabled-on", name: "cloud_saves_locked", label: "Cloud saves", isOn: true, isDisabled: true })}</div>` },
  ],
});
