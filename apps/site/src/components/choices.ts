import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, glassPane, icon, type IconName } from "./foundations.ts";
import { examplePane } from "./example-pane.ts";

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
  isRequired?: boolean;
  error?: string;
  state?: "is-focused";
}

/** The count's words: "1,620 of 2,000". */
const lengthWords = (characterCount: number, maximumCharacterCount: number) => `${characterCount.toLocaleString("en-US")} of ${maximumCharacterCount.toLocaleString("en-US")}`;

/** A long field: the cut field for more than a line (a description, patch notes, a reply), growing with its words, with a count near its limit. */
export function longField(options: LongFieldOptions): Raw {
  const id = options.id ?? `field-${options.name}`;
  const characterCount = options.text?.length ?? 0;
  const isCountShown = options.maximumCharacterCount !== undefined && characterCount >= options.maximumCharacterCount * 0.8;
  const describedBy = [options.maximumCharacterCount !== undefined ? `${id}-count` : "", options.error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const className = ["field", "long", "cut-carved", options.error ? "is-marked" : "", options.state ?? ""].filter(Boolean).join(" ");
  return html`<div class="cut-field"><label for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}<textarea id="${id}" name="${options.name}" rows="${options.rowCount}" data-long-field${options.maximumCharacterCount !== undefined ? html` maxlength="${options.maximumCharacterCount}"` : ""}${options.placeholder ? html` placeholder="${options.placeholder}"` : ""}${options.isRequired ? raw(" required") : ""}${options.error ? raw(' aria-invalid="true"') : ""}${describedBy ? html` aria-describedby="${describedBy}"` : ""}>${options.text ?? ""}</textarea></span>
${options.maximumCharacterCount !== undefined ? html`<p class="long-count" id="${id}-count"${isCountShown ? "" : raw(" hidden")}>${lengthWords(characterCount, options.maximumCharacterCount)}</p>` : ""}${options.error ? html`<p class="field-error" id="${id}-error">${options.error}</p>` : ""}</div>`;
}

/** A long field grows with its words, from its rows up to 12 lines, then scrolls; its count shows from 80% of its limit. */
export const LONG_FIELD_SCRIPT = `/* long fields */(function () {
  var MOST_LINES = 12;
  function fit(area) {
    var css = getComputedStyle(area), line = parseFloat(css.lineHeight) || 24, frame = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    area.style.height = "auto";
    var least = line * (Number(area.getAttribute("rows")) || 2) + frame, most = line * MOST_LINES + frame;
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
   Its words are the reading face at 16px, so phones don't zoom in; the count of characters shows under it near the limit. */
.field.long { height: auto; align-items: stretch; }
.field.long textarea { position: relative; z-index: 2; display: block; flex: 1; min-width: 0; width: 100%; padding: 14px 16px; resize: none; overflow-y: auto;
  font: 400 16px/1.5 var(--body); color: var(--ink); caret-color: var(--run-lo);
  --face-color: var(--field-face); background: var(--face-color); border: 0; border-radius: 0; box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.field.long:hover textarea { --face-color: var(--field-hover); }
.field.long textarea:focus, .field.long.is-focused textarea { outline: none; --face-color: var(--field-focus); }
.field.long textarea::placeholder { color: var(--muted); }
.field.long.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.long-count { margin: 0; align-self: flex-end; font: var(--type-facts); color: var(--muted); font-variant-numeric: tabular-nums; }
`;

const PATCH_NOTES = "Rebalanced the second boss: its slam now telegraphs half a second earlier, and the arena's pillars break after three hits instead of five.";

component({
  name: "Long field",
  slug: "long-field",
  group: "inputs",
  summary: "More than a line of words: a game's description, patch notes, a reply. It grows with what's written, and counts the characters only once the limit is near.",
  styles: LONG_STYLES,
  render: longField,
  examples: [
    { label: "Empty", markup: examplePane(longField({ id: "example-long-empty", name: "patch_notes", label: "What's new", placeholder: "What changed in this version", rowCount: 3, maximumCharacterCount: 2000 })) },
    { label: "Filled", markup: examplePane(longField({ id: "example-long-filled", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, maximumCharacterCount: 2000 })) },
    { label: "Focused", markup: examplePane(longField({ id: "example-long-focused", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, state: "is-focused" })), isStill: true },
    { label: "Near its limit: the count shows", markup: examplePane(longField({ id: "example-long-count", name: "patch_notes", label: "What's new", text: PATCH_NOTES, rowCount: 3, maximumCharacterCount: 160 })) },
    { label: "Error", markup: examplePane(longField({ id: "example-long-error", name: "description", label: "Description", rowCount: 3, error: "Say what the game is in a line or more." })) },
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
  /** The choice picked now; left out, the first. */
  pickedValue?: string;
  /** Unique on the page. Defaults to field-<name>. */
  id?: string;
  /** What kind of thing it picks, like a cut field's. Left out, the words start at the edge. */
  icon?: IconName;
  error?: string;
  /** The gallery's fixed states: focused, or open with its list under it. */
  state?: "is-focused" | "is-open";
}

/**
 * A select field: a cut field that opens a list of Zaisma's glass under it, on every device, so picking from a list looks and feels like
 * the rest of the page. For one of many (a region, a language); one of a few is Choice cards or a Switch. The pick is sent as a hidden field.
 */
export function selectField(options: SelectFieldOptions): Raw {
  const id = options.id ?? `field-${options.name}`;
  const picked = options.choices.find((choice) => choice.choiceValue === options.pickedValue) ?? options.choices[0];
  const isOpen = options.state === "is-open";
  const className = ["field", "select", "cut-carved", options.icon ? "" : "no-icon", options.error ? "is-marked" : "", options.state === "is-focused" ? "is-focused" : "", isOpen ? "is-open" : ""].filter(Boolean).join(" ");
  const list = html`<div class="select-list glass${isOpen ? " in-place" : ""}" id="${id}-list" role="listbox" aria-labelledby="${id}-label" tabindex="-1" data-glass data-glass-corners="18 14 18 14"${isOpen ? "" : raw(" popover")}>${EDGE}${options.choices.map(
    (choice, choiceIndex) =>
      html`<div class="select-option" role="option" id="${id}-option-${choiceIndex}" data-choice-value="${choice.choiceValue}" aria-selected="${choice === picked ? "true" : "false"}" data-cut-line="8">${CUT_LINE}<span>${choice.label}</span>${icon("check")}</div>`,
  )}</div>`;
  return html`<div class="cut-field" data-select><label id="${id}-label" for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}${options.icon ? icon(options.icon) : ""}<button type="button" class="select-button" id="${id}" aria-haspopup="listbox" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-list"${isOpen ? "" : html` popovertarget="${id}-list"`}${options.error ? html` aria-invalid="true" aria-describedby="${id}-error"` : ""}><span class="select-value">${picked?.label ?? ""}</span></button><span class="select-chev">${icon("chevron-down")}</span></span>
${list}<input type="hidden" name="${options.name}" value="${picked?.choiceValue ?? ""}">
${options.error ? html`<p class="field-error" id="${id}-error">${options.error}</p>` : ""}</div>`;
}

/**
 * Select fields: the list opens as a popover (over everything, never clipped by the pane it's in) just under its field, or above it when
 * there's no room below, as wide as the field. The arrow keys move through it, a letter jumps to a choice, Enter or a press picks one and
 * closes it, Esc or a press elsewhere closes it. A pick sets the hidden field and sends it a change event.
 */
export const SELECT_SCRIPT = `/* select fields */(function () {
  var GAP_PX = 6;
  window.zaismaWatch.each("[data-select]", function (root) {
    var button = root.querySelector(".select-button"), list = root.querySelector(".select-list"), hidden = root.querySelector('input[type="hidden"]'), field = button.closest(".field");
    if (!list.hasAttribute("popover")) return;
    var options = Array.prototype.slice.call(list.querySelectorAll('[role="option"]')), active = -1, typed = "", typedAt = 0;
    function picked() { return options.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; }); }
    function setActive(i) {
      active = Math.max(0, Math.min(options.length - 1, i));
      options.forEach(function (o, j) { o.classList.toggle("is-active", j === active); });
      list.setAttribute("aria-activedescendant", options[active].id);
      var o = options[active]; if (o.offsetTop < list.scrollTop) list.scrollTop = o.offsetTop; else if (o.offsetTop + o.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = o.offsetTop + o.offsetHeight - list.clientHeight;
    }
    function place() {
      var r = field.getBoundingClientRect(), height = list.offsetHeight, below = window.innerHeight - r.bottom - GAP_PX;
      list.style.width = r.width + "px"; list.style.left = r.left + "px";
      list.style.top = (below >= height || below >= r.top ? r.bottom + GAP_PX : r.top - GAP_PX - height) + "px";
    }
    function pick(i) {
      options.forEach(function (o, j) { o.setAttribute("aria-selected", String(j === i)); });
      root.querySelector(".select-value").textContent = options[i].textContent;
      if (hidden.value !== options[i].getAttribute("data-choice-value")) { hidden.value = options[i].getAttribute("data-choice-value"); hidden.dispatchEvent(new Event("change", { bubbles: true })); }
      list.hidePopover(); button.focus();
    }
    list.addEventListener("toggle", function (event) {
      var isOpen = event.newState === "open";
      button.setAttribute("aria-expanded", String(isOpen)); field.classList.toggle("is-open", isOpen);
      if (isOpen) { place(); setActive(Math.max(0, picked())); list.focus({ preventScroll: true }); }
    });
    window.zaismaWatch.resize(function () { if (list.matches(":popover-open")) place(); });
    window.zaismaWatch.scroll(function () { if (list.matches(":popover-open")) place(); });
    button.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); list.showPopover(); }
    });
    list.addEventListener("click", function (event) { var o = event.target.closest('[role="option"]'); if (o) pick(options.indexOf(o)); });
    list.addEventListener("pointermove", function (event) { var o = event.target.closest('[role="option"]'); if (o && options.indexOf(o) !== active) setActive(options.indexOf(o)); });
    list.addEventListener("keydown", function (event) {
      var key = event.key, step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[key];
      if (step) { setActive(active + step); event.preventDefault(); return; }
      if (key === "Home" || key === "End") { setActive(key === "Home" ? 0 : options.length - 1); event.preventDefault(); return; }
      if (key === "Enter" || key === " ") { pick(active); event.preventDefault(); return; }
      if (key === "Tab") { list.hidePopover(); return; }
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

component({
  name: "Select field",
  slug: "select-field",
  group: "inputs",
  summary: "One of many, from a list: a region, a language, a category. It opens a list of Zaisma's glass under the field, on every device. For one of a few, use Choice cards or a Switch.",
  styles: `
/* A select field: the cut field holding a button with the picked choice; the birthday field's chevron sits at its end and turns as it opens.
   Its list is a pane of the menus' glass hanging just under the field, as wide as it, its choices on the switch's slabs: a faint one under
   the pointer or the arrow keys, the white one with the orange line on the picked, which also carries a tick. */
.select-button { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%; height: 100%; padding: 0 48px 0 52px; border: 0; border-radius: 0; cursor: pointer; text-align: left;
  font: 500 18px var(--display); color: var(--ink);
  --face-color: var(--field-face); background: var(--face-color); box-shadow: var(--field-shade); clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.field.select.no-icon .select-button { padding-left: 18px; }
.select-value { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.field.select:hover .select-button { --face-color: var(--field-hover); }
.select-button:focus-visible, .field.select.is-focused .select-button, .field.select.is-open .select-button { outline: none; --face-color: var(--field-focus); }
.field.select:focus-within > .cut-line polygon, .field.select.is-focused > .cut-line polygon, .field.select.is-open > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.select-chev { position: absolute; z-index: 3; right: 18px; display: inline-flex; color: var(--ink); pointer-events: none; transition: transform 0.4s cubic-bezier(.2,.7,.2,1); }
.select-chev > .ico { position: static; width: 16px; height: 10px; stroke-width: 2.2; }
.field.select.is-open .select-chev { transform: rotate(180deg); }
/* The list: the popover's own place is the window, so it's set just under the field by SELECT_SCRIPT. */
.select-list { position: fixed; inset: auto; margin: 0; max-height: min(320px, 50vh); overflow-y: auto; padding: var(--pad-inner-pane); border: 0; color: var(--ink);
  display: flex; flex-direction: column; gap: 2px; outline: none; --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), opacity 0.2s, transform 0.3s cubic-bezier(.2,.8,.2,1), overlay 0.3s allow-discrete, display 0.3s allow-discrete; }
.select-list:not(:popover-open):not(.in-place) { opacity: 0; transform: translateY(-6px); }
@starting-style { .select-list:popover-open { opacity: 0; transform: translateY(-6px); } }
.select-list.in-place { position: relative; display: flex; width: 100%; }
.select-option { position: relative; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 8px 14px 11px; cursor: pointer; flex: none;
  font: var(--type-words); color: var(--ink-2); --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color 0.15s, color 0.15s; }
.select-option > :not(.cut-line) { position: relative; z-index: 2; }
.select-option > span { flex: 1; }
.select-option > .ico { width: 16px; height: 16px; color: var(--run); stroke-width: 2.4; opacity: 0; }
.select-option.is-active { --face-color: var(--ghost); color: var(--ink); }
.select-option[aria-selected="true"] { color: var(--ink); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
.select-option[aria-selected="true"] > .ico { opacity: 1; }
.select-list:focus-visible .select-option.is-active > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .select-list, .select-chev { transition: var(--glass-transition); } }
`,
  render: selectField,
  examples: [
    { label: "Picked: try it", markup: examplePane(selectField({ id: "example-select-region", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "nearest" })) },
    { label: "With an icon", markup: examplePane(selectField({ id: "example-select-icon", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", icon: "people" })) },
    { label: "Focused", markup: examplePane(selectField({ id: "example-select-focused", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", state: "is-focused" })), isStill: true },
    { label: "Open", markup: examplePane(selectField({ id: "example-select-open", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", state: "is-open" })), isStill: true },
    { label: "Error", markup: examplePane(selectField({ id: "example-select-error", name: "room_region", label: "Where rooms run", choices: REGIONS, error: "Pick where your rooms run to go on." })) },
  ],
});

/** The gallery's fixed states for what you press that holds a value (a box, a card, a switch). */
type PressState = "is-pointed" | "is-pressed" | "is-focused";

export interface CheckFieldOptions {
  name: string;
  label: string;
  isChecked?: boolean;
  /** A line under its label, saying what it changes. */
  hint?: string;
  /** What it sends when ticked. Defaults to "yes"; one of several boxes with the same name sends its own (a game's slug). */
  checkValue?: string;
  /** Unique on the page. Defaults to check-<name>. */
  id?: string;
  state?: PressState;
}

/** A check field: a box to tick, for a yes or no that's sent with its form (I agree, Email me replies). On a page that saves at once, use a Toggle. */
export function checkField(options: CheckFieldOptions): Raw {
  const id = options.id ?? `check-${options.name}`;
  return html`<label class="check${options.state ? ` ${options.state}` : ""}" for="${id}"><span class="check-box cut-carved" data-cut-line="6">${CUT_LINE}<input class="check-input" type="checkbox" id="${id}" name="${options.name}" value="${options.checkValue ?? "yes"}"${options.isChecked ? raw(" checked") : ""}${options.hint ? html` aria-describedby="${id}-hint"` : ""}>${icon("check")}</span><span class="check-words"><span class="check-label">${options.label}</span>${options.hint ? html`<span class="check-hint" id="${id}-hint">${options.hint}</span>` : ""}</span></label>`;
}

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
  summary: "A yes or no sent with its form: I agree, Email me replies. A small carved box that turns orange with a white tick. On a page that saves at once, use a Toggle.",
  styles: `
/* A check field: a small carved box of the fields' glass, cut by the edge rule, before its words. Ticked, the whole box turns orange
   and raised, with a white tick. The real checkbox lies over the box, unseen, so the keyboard, forms and screen readers get
   the system's own; the whole line is its label, so a press anywhere on it ticks it. */
.check { position: relative; display: inline-flex; align-items: flex-start; gap: var(--gap-words-control); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.check-box { position: relative; flex: none; display: grid; place-items: center; width: 24px; height: 24px; color: transparent;
  --face-color: var(--field-face); background: var(--face-color); box-shadow: var(--field-shade); clip-path: var(--cut-shape); transition: --face-color 0.2s, color 0.2s; }
.check-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.check-box > .ico { position: relative; z-index: 2; width: 16px; height: 16px; stroke-width: 2.4; transform: scale(0.6); transition: transform 0.3s var(--spring); }
.check:hover .check-box, .check.is-pointed .check-box { --face-color: var(--field-hover); }
/* Ticked: the whole box turns orange, lit like the runner, with a white tick. */
.check-box:has(.check-input:checked) { --face-color: var(--run); color: #fff; box-shadow: none; }
.check-box:has(.check-input:checked) > .ico { transform: scale(1); }
.check-box:has(.check-input:checked) > .cut-line { --band-top: rgba(255,240,214,0.85); --band-left: rgba(255,226,180,0.55); --band-right: rgba(150,72,0,0.32); --band-bottom: rgba(130,60,0,0.55); }
.check:hover .check-box:has(.check-input:checked), .check.is-pointed .check-box:has(.check-input:checked) { --face-color: var(--run-hi); }
/* Pressed: the box sinks, darker and shaded from above; a ticked one deepens to the runner's foot, its light turned round, its tick a touch smaller. */
.check:active .check-box, .check.is-pressed .check-box { --face-color: var(--check-press); box-shadow: var(--press-shade); transition-duration: 0.08s; }
.check:active .check-box:has(.check-input:checked), .check.is-pressed .check-box:has(.check-input:checked) { --face-color: #D9730A; box-shadow: inset 0 2px 4px rgba(110,50,0,0.45); }
.check:active .check-box:has(.check-input:checked) > .cut-line, .check.is-pressed .check-box:has(.check-input:checked) > .cut-line { --band-top: rgba(130,60,0,0.5); --band-left: rgba(150,72,0,0.35); --band-right: rgba(255,226,180,0.45); --band-bottom: rgba(255,240,214,0.7); }
.check:active .check-box > .ico, .check.is-pressed .check-box > .ico { transform: scale(0.85); transition-duration: 0.08s; }
.check-box:has(.check-input:focus-visible) > .cut-line polygon, .check.is-focused .check-box > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.check-box:has(.check-input:checked:focus-visible) > .cut-line polygon, .check.is-focused .check-box:has(.check-input:checked) > .cut-line polygon { stroke: var(--focus-on-run); }
.check-words { display: grid; gap: var(--gap-words-words); padding-top: 2px; }
.check-label { font: var(--type-words); color: var(--ink); }
.check-hint { font: var(--type-note); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .check-box > .ico { transition: none; } }
`,
  render: checkField,
  examples: [
    ...pressExamples((state, exampleKey) => checkField({ id: `example-check-${exampleKey}`, name: "reply_emails", label: "Email me replies", state }), "check"),
    { label: "Ticked", markup: checkField({ id: "example-check-ticked", name: "reply_emails", label: "Email me replies", isChecked: true }) },
    { label: "Ticked, pointed", markup: checkField({ id: "example-check-ticked-pointed", name: "reply_emails", label: "Email me replies", isChecked: true, state: "is-pointed" }), isStill: true },
    { label: "Ticked, pressed", markup: checkField({ id: "example-check-ticked-pressed", name: "reply_emails", label: "Email me replies", isChecked: true, state: "is-pressed" }), isStill: true },
    { label: "With a hint", markup: examplePane(checkField({ id: "example-check-hint", name: "rules_agreed", label: "I've read the content rules", hint: "Games break them only by what's in them, never by taste.", isChecked: true })) },
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
  choices: ChoiceCard[];
  pickedValue?: string;
  /** Unique on the page. Defaults to choice-<name>. */
  id?: string;
  /** Many choices (a report's reasons): one line each, down a carved well that scrolls once it's long, like a vertical switch. */
  isCompact?: boolean;
  /** The gallery's fixed states, on the first card. */
  state?: PressState;
}

/** Choice cards: one of a few, each needing a line to say what it means (who can see a game, how rooms run); compact, one of many (why you're reporting). Radios underneath. */
export function choiceCards(options: ChoiceCardsOptions): Raw {
  const id = options.id ?? `choice-${options.name}`;
  const card = (choice: ChoiceCard, choiceIndex: number) =>
    html`<label class="choice-card cut-carved${choiceIndex === 0 && options.state ? ` ${options.state}` : ""}" data-cut-line="10">${CUT_LINE}<input class="choice-input" type="radio" name="${options.name}" id="${id}-${choice.choiceValue}" value="${choice.choiceValue}"${choice.choiceValue === options.pickedValue ? raw(" checked") : ""}>${choice.icon ? icon(choice.icon) : ""}<span class="choice-words"><span class="choice-label">${choice.label}</span>${choice.text ? html`<span class="choice-text">${choice.text}</span>` : ""}</span></label>`;
  return options.isCompact
    ? html`<fieldset class="choices"><legend>${options.label}</legend><div class="choice-list cut-carved" data-cut-line="10">${CUT_LINE}<div class="choice-list-in">${options.choices.map(card)}</div></div></fieldset>`
    : html`<fieldset class="choices"><legend>${options.label}</legend><div class="choice-cards">${options.choices.map(card)}</div></fieldset>`;
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
  summary: "One of a few, when each needs a line to say what it means: who can see a game, how its rooms run. Compact for many (a report's reasons): close together down a carved well that scrolls. The picked one is the raised white slab with the orange line; the rest sit carved and quieter.",
  styles: `
/* Choice cards: radios as cut slabs. The ones not picked are carved into the glass, their words quieter; the picked one rises out of it as
   the switch's white slab, lit, with its orange line along its foot and its words in full ink. Pointing at one brightens its carving. The
   real radio lies over the card, unseen, so the arrow keys move between them as the system's do. */
.choices { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); }
.choices > legend { padding: 0; margin-bottom: var(--gap-words-control); font: var(--type-label); color: var(--ink-2); }
.choice-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--gap-control-stack); }
.choice-card { position: relative; display: flex; align-items: flex-start; gap: var(--gap-words-words); min-height: 76px; padding: 14px 16px; cursor: pointer; -webkit-tap-highlight-color: transparent;
  color: var(--muted); --face-color: var(--well); background: var(--face-color); box-shadow: var(--well-shade); clip-path: var(--cut-shape); transition: --face-color 0.2s, box-shadow 0.2s, color 0.2s; }
.choice-card > :not(.cut-line):not(.choice-input) { position: relative; z-index: 2; }
.choice-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.choice-card > .ico { flex: none; margin-top: 1px; color: var(--muted); }
.choice-words { display: grid; gap: var(--gap-words-words); }
.choice-label { font: var(--type-label); color: var(--ink-2); }
.choice-text { font: var(--type-note); color: var(--muted); }
.choice-card:hover, .choice-card.is-pointed { --face-color: var(--field-hover); color: var(--ink-2); }
.choice-card:active, .choice-card.is-pressed { --face-color: var(--check-press); box-shadow: var(--press-shade), var(--press-shade); color: var(--ink-2); transition-duration: 0.08s; }
/* Picked: raised out of the carving, the switch's white slab with its light turned the other way and the orange line along its foot. */
.choice-card:has(.choice-input:checked) { background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); color: var(--ink); }
.choice-card:has(.choice-input:checked) .choice-label, .choice-card:has(.choice-input:checked) > .ico { color: var(--ink); }
.choice-card:has(.choice-input:checked) .choice-text { color: var(--ink-2); }
.choice-card:has(.choice-input:checked) > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: transparent; }
/* Pressing the picked one sinks it too: shaded from above and a touch darker, its orange line staying. */
.choice-card:has(.choice-input:checked):active, .choice-card.is-pressed:has(.choice-input:checked) { filter: brightness(0.92); box-shadow: var(--press-shade), inset 0 -3px 0 var(--run); }
.choice-card:has(.choice-input:focus-visible) > .cut-line polygon, .choice-card.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Compact: a carved well, like a vertical switch's, scrolling once it's taller than about six choices. The cards inside are flat and close
   together, their line under their name, and only the picked one is a slab. */
.choice-list { position: relative; display: flex; max-height: 336px; padding: 4px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.choice-list-in { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--gap-control-row); }
/* With a mouse it scrolls on Zaisma's rail, inside its right edge: the cards keep clear of it. */
.choice-list-in.own-scroll:has(+ .rail:not([hidden])) { padding-right: 18px; }
.choice-list .choice-card { min-height: 44px; padding: 10px 14px; --face-color: transparent; box-shadow: none; flex: none; }
.choice-list .choice-words { gap: 2px; }
.choice-list .choice-card.cut-carved > .cut-line { --band-top: transparent; --band-left: transparent; --band-right: transparent; --band-bottom: transparent; }
.choice-list .choice-card:hover, .choice-list .choice-card.is-pointed { --face-color: var(--ghost); }
.choice-list .choice-card:has(.choice-input:checked) { box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
/* On a phone it doesn't scroll by itself: the sheet or page it's in does, so there's never a scroll inside a scroll. */
@media (max-width: 760px) { .choice-list { max-height: none; } }
`,
  render: choiceCards,
  examples: [
    ...pressExamples((state, exampleKey) => choiceCards({ id: `example-choice-${exampleKey}`, name: `visibility_${exampleKey}`, label: "Who can see it", choices: VISIBILITIES.slice(0, 2), pickedValue: "unlisted", state }), "choice"),
    { label: "Three, in a pane", markup: glassPane({ paneSize: "medium", body: choiceCards({ id: "example-choice-pane", name: "visibility_pane", label: "Who can see it", choices: VISIBILITIES, pickedValue: "listed" }) }), isWide: true },
    { label: "Compact: many choices, scrolling", markup: glassPane({ paneSize: "medium", body: choiceCards({ id: "example-choice-compact", name: "report_reason_compact", label: "What's wrong", choices: REPORT_REASONS, pickedValue: "malware", isCompact: true }) }), isWide: true },
  ],
});

export interface ToggleOptions {
  name: string;
  label: string;
  isOn: boolean;
  /** A line under its label, saying what it changes. */
  hint?: string;
  /** Unique on the page. Defaults to toggle-<name>. */
  id?: string;
  state?: PressState;
}

/** A toggle: on or off for a setting that takes effect as it's saved (Cloud saves, Show me online). A checkbox underneath, sent with its form, so it needs no script to post. */
export function toggle(options: ToggleOptions): Raw {
  const id = options.id ?? `toggle-${options.name}`;
  return html`<label class="toggle${options.state ? ` ${options.state}` : ""}" for="${id}"><span class="toggle-words"><span class="toggle-label">${options.label}</span>${options.hint ? html`<span class="toggle-hint" id="${id}-hint">${options.hint}</span>` : ""}</span><span class="toggle-slot cut-carved" data-cut-line="8">${CUT_LINE}<input class="toggle-input" type="checkbox" role="switch" id="${id}" name="${options.name}" value="on"${options.isOn ? raw(" checked") : ""}${options.hint ? html` aria-describedby="${id}-hint"` : ""}><span class="toggle-thumb" aria-hidden="true"><span class="toggle-slab cut-raised" data-cut-line="6" data-cut-ends="start end">${CUT_LINE}</span></span></span></label>`;
}

component({
  name: "Toggle",
  slug: "toggle",
  group: "inputs",
  summary: "On or off for a setting: Cloud saves, Show me online. A white slab that springs across a carved slot, which fills orange when it's on. It's a checkbox in its form, so it posts without a script.",
  styles: `
/* A toggle: a carved slot holding a white slab that springs to its far end when on, the slot filling orange behind it. The real
   checkbox (role switch) lies over the slot, unseen; the words before it are its label, so a press on them flips it too. */
.toggle { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--gap-words-control); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.toggle-words { display: grid; gap: var(--gap-words-words); min-width: 0; }
.toggle-label { font: var(--type-words); color: var(--ink); }
.toggle-hint { font: var(--type-note); color: var(--muted); }
.toggle-slot { position: relative; flex: none; width: 56px; height: 32px; --face-color: var(--toggle-off); background: var(--face-color); box-shadow: var(--well-shade), inset 0 2px 4px rgba(10,16,28,0.18); clip-path: var(--cut-shape); transition: --face-color 0.3s; }
.toggle-input { position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
/* The slab casts a shadow onto the slot it rests in: the shadow is the holder's, so it follows the slab's cut. */
.toggle-thumb { position: absolute; z-index: 2; left: 4px; top: 4px; width: 24px; height: 24px; filter: drop-shadow(0 1px 1px rgba(10,16,28,0.24)) drop-shadow(0 2px 3px rgba(10,16,28,0.12));
  transition: transform 0.4s var(--spring), scale 0.2s var(--spring), filter 0.2s; }
/* The slab is solid and lit from above, so the orange behind it never tints it. */
.toggle-slab { position: relative; display: block; width: 100%; height: 100%; background: radial-gradient(120% 90% at 50% 0%, #fff, #F1F4F8 55%, #D9DFE7); clip-path: var(--cut-shape); transition: box-shadow 0.12s; }
/* Its pressed face: a shade from above that fades in and out with the press, as the slab shrinks. */
.toggle-slab::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,16,28,0.16), rgba(10,16,28,0.04) 55%, rgba(255,255,255,0.1)); opacity: 0; transition: opacity 0.12s; }
.toggle-slot:has(.toggle-input:checked) { --face-color: var(--run); }
.toggle-slot:has(.toggle-input:checked) > .toggle-thumb { transform: translateX(24px); }
.toggle:hover .toggle-thumb, .toggle.is-pointed .toggle-thumb { filter: drop-shadow(0 1.5px 1.5px rgba(10,16,28,0.28)) drop-shadow(0 3px 4px rgba(10,16,28,0.14)); }
/* Pressed: the slab is pushed down into the slot, a touch smaller, its shadow drawn in close and its face shaded from above. */
.toggle:active .toggle-thumb, .toggle.is-pressed .toggle-thumb { scale: 0.92; filter: drop-shadow(0 0.5px 0.5px rgba(10,16,28,0.3)); transition-duration: 0.4s, 0.08s, 0.08s; }
.toggle:active .toggle-slab, .toggle.is-pressed .toggle-slab { box-shadow: inset 0 2px 3px rgba(10,16,28,0.18); }
.toggle:active .toggle-slab::after, .toggle.is-pressed .toggle-slab::after { opacity: 1; transition-duration: 0.08s; }
.toggle-slot:has(.toggle-input:focus-visible) > .cut-line polygon, .toggle.is-focused .toggle-slot > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.toggle-slot:has(.toggle-input:checked:focus-visible) > .cut-line polygon, .toggle.is-focused .toggle-slot:has(.toggle-input:checked) > .cut-line polygon { stroke: var(--focus-on-run); }
@media (prefers-reduced-motion: reduce) { .toggle-thumb { transition: none; } .toggle-slot { transition: none; } }
`,
  render: toggle,
  examples: [
    ...pressExamples((state, exampleKey) => html`<div style="width:min(340px,100%)">${toggle({ id: `example-toggle-${exampleKey}`, name: "cloud_saves", label: "Cloud saves", isOn: true, state })}</div>`, "toggle"),
    { label: "Off", markup: html`<div style="width:min(340px,100%)">${toggle({ id: "example-toggle-off", name: "shown_online", label: "Show me online", isOn: false })}</div>` },
    { label: "With a hint, in a pane", markup: examplePane(toggle({ id: "example-toggle-hint", name: "cloud_saves_pane", label: "Cloud saves", hint: "Players keep their progress on any device.", isOn: true })) },
  ],
});
