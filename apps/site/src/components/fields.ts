import { PURCHASE_PIN_LIMITS } from "@zaisma/core";
import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, EDGE, floatingPane, glassPane, icon, type IconName } from "./foundations.ts";
import { tertiaryButton, toggleButton } from "./actions.ts";
import { examplePane } from "./example-pane.ts";
import { row } from "./layout.ts";

/*
 * Fields: the cut field, search, the PIN field and the wheel field. From the sign-in draft (fields, the
 * wheels) and the header draft (search). Split from inputs.ts; inputs.ts re-exports them.
 */

export interface CutFieldOptions {
  name: string;
  label: string;
  type: "text" | "email" | "search" | "password";
  /** What goes in, said by a line icon at its start. Left out, its words start where a field's icon would, at --pad-inside-words. */
  icon?: IconName;
  /** Its id, for the label; unique on the page. Defaults to field-<name>. */
  id?: string;
  /** What it holds already. */
  text?: string;
  placeholder?: string;
  autocomplete?: string;
  isRequired?: boolean;
  /** What's wrong, under the field: the marked state, as when Next won't go on. */
  error?: string;
  /** What to know about it, under the field, quieter (its id is <id>-hint, for a page script to update). An error takes its place. */
  hint?: string;
  /** "numeric": a phone shows its number pad (a code). */
  inputMode?: "numeric";
  /** What it must match to be sent, as a regular expression (a room code's six letters and numbers); a page script says what's wrong. */
  pattern?: string;
  /** The only characters it takes, as one regular expression character class ("[2-9A-HJ-NP-Z]"): any other is dropped as it's typed, pasted or filled in, so it never shows. */
  characterPattern?: string;
  /** At most this many characters: typing stops there, and a longer paste is cut to it. */
  maximumCharacterCount?: number;
  /** Letters turn to capitals as they go in (a room code), before characterPattern is checked. */
  isUppercase?: boolean;
  /** A password that starts shown (Show pressed). */
  isPasswordShown?: boolean;
  /** Can be read, selected and copied but not changed here: carved into the glass, with nothing to type. */
  isReadOnly?: boolean;
  /** Can't be changed now, and isn't sent with its form: carved into the glass, its words quieter. */
  isDisabled?: boolean;
  /** The gallery's fixed focus, so it sits still. */
  state?: "is-focused";
}

/** A cut field of clearer glass with a drawn outline and a line icon saying what goes in it. A password gets Show. */
export function cutField(options: CutFieldOptions): ControlMarkup {
  const id = options.id ?? `field-${options.name}`;
  const isPassword = options.type === "password";
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const className = ["field", "carving", "layered", "is-used", "sized", options.icon ? "" : "no-icon", isPassword ? "with-toggle" : "", options.error ? "is-marked" : "", options.state ?? ""].filter(Boolean).join(" ");
  const inputType = isPassword && options.isPasswordShown ? "text" : options.type;
  return controlMarkup(html`<div class="cut-field"><label class="words-margin" for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}${options.icon ? icon(options.icon) : ""}<input id="${id}" name="${options.name}" type="${inputType}"${options.text !== undefined ? html` value="${options.text}"` : ""}${options.placeholder ? html` placeholder="${options.placeholder}"` : ""}${options.autocomplete ? html` autocomplete="${options.autocomplete}"` : ""}${options.type === "email" || options.name === "username" ? raw(' autocapitalize="off" spellcheck="false"') : ""}${options.inputMode ? html` inputmode="${options.inputMode}"` : ""}${options.pattern ? html` pattern="${options.pattern}"` : ""}${options.characterPattern ? html` data-characters="${options.characterPattern}"` : ""}${options.maximumCharacterCount !== undefined ? html` maxlength="${options.maximumCharacterCount}"` : ""}${options.isUppercase ? raw(' data-uppercase autocapitalize="characters"') : ""}${options.isRequired ? raw(" required") : ""}${options.isReadOnly ? raw(" readonly") : ""}${options.isDisabled ? raw(" disabled") : ""}${options.error ? html` aria-invalid="true" aria-describedby="${errorId}"` : options.hint ? html` aria-describedby="${hintId}"` : ""}>${isPassword ? toggleButton(options.isPasswordShown ? "Hide" : "Show", { type: "button", isSmall: true, isPressed: Boolean(options.isPasswordShown), controls: id, isDisabled: options.isDisabled }) : ""}</span>
${options.error ? html`<p class="field-error words-margin" id="${errorId}">${options.error}</p>` : options.hint ? html`<p class="field-hint words-margin" id="${hintId}">${options.hint}</p>` : ""}</div>`, "field", { hasOwnWords: true });
}

export interface SearchFieldOptions {
  action: string;
  name: string;
  searchText: string;
  placeholder: string;
  label: string;
  /** Fields the search keeps, like the forum's category. */
  keep?: Record<string, string>;
  /** Unique on the page; its list of finishes and games is <id>-list. Defaults to find-<name>. */
  id?: string;
  /**
   * Finishes and games as you type: GET <suggestionsUrl>?search=<what's typed> answers SearchSuggestions, shown in a list under the field.
   * Left out, it's a plain search.
   */
  suggestionsUrl?: string;
  /** The gallery's fixed states: focused, or open with the list these suggestions make, its first row picked. */
  state?: "is-focused" | "is-open";
  shownSuggestions?: SearchSuggestions;
}

/** What a search's suggestionsUrl answers, as JSON: up to three ways to finish what's typed, most likely first, and up to three games it finds. */
export interface SearchSuggestions {
  finishes: string[];
  games: { title: string; page_url: string; cover_url: string; fact: string }[];
}

/** What's typed in words, the part that matches it in bold. */
const matchWords = (text: string, typed: string): Raw => {
  const matchIndex = typed ? text.toLowerCase().indexOf(typed.toLowerCase()) : -1;
  return matchIndex < 0 ? html`<span>${text}</span>` : html`<span>${text.slice(0, matchIndex)}<b>${text.slice(matchIndex, matchIndex + typed.length)}</b>${text.slice(matchIndex + typed.length)}</span>`;
};

/** A search's rows, as SEARCH_SCRIPT makes them: finishes, then the games under a Games heading. */
const suggestionRows = (id: string, typed: string, suggestions: SearchSuggestions, activeIndex: number): Raw => {
  const finishes = suggestions.finishes.slice(0, 3), games = suggestions.games.slice(0, 3);
  const active = (rowIndex: number) => (rowIndex === activeIndex ? " is-active" : "");
  return html`${finishes.map((finish, rowIndex) => html`<div class="select-option flush-row compact find-finish-row${active(rowIndex)}" role="option" id="${id}-row-${rowIndex}" data-finish="${finish}" data-cut-line="8">${CUT_LINE}<span class="find-row-icon">${icon("search")}</span>${matchWords(finish, typed)}</div>`)}${
    games.length ? html`<div class="find-head words-margin" role="presentation">Games</div>` : ""
  }${games.map((game, gameIndex) => html`<a class="select-option flush-row compact find-game${active(finishes.length + gameIndex)}" role="option" id="${id}-row-${finishes.length + gameIndex}" href="${game.page_url}" tabindex="-1" data-cut-line="8">${CUT_LINE}<img src="${game.cover_url}" alt="" width="64" height="36"><span class="find-game-words">${matchWords(game.title, typed)}<span class="find-game-fact">${game.fact}</span></span></a>`)}`;
};

/**
 * Search: the cut field's sibling, a control's height (it sits in the header's row): the same face, carving, icon, indent and words, and a
 * Clear button at its end once something's typed. "/" jumps to it in the header.
 */
export function searchField(options: SearchFieldOptions): ControlMarkup {
  const id = options.id ?? `find-${options.name}`;
  const isOpen = options.state === "is-open" && Boolean(options.shownSuggestions);
  const firstFinish = isOpen ? options.shownSuggestions?.finishes[0] : undefined;
  const typedFinish = firstFinish && options.searchText && firstFinish.toLowerCase().startsWith(options.searchText.toLowerCase()) ? firstFinish.slice(options.searchText.length) : "";
  const suggests = options.suggestionsUrl !== undefined || isOpen;
  const combobox = suggests ? html` role="combobox" aria-autocomplete="both" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-choices"${isOpen ? html` aria-activedescendant="${id}-row-0"` : ""}` : "";
  const list = suggests
    ? html`<span class="find-finish" aria-hidden="true"><span class="find-typed">${typedFinish ? options.searchText : ""}</span><span>${typedFinish}</span></span>${floatingPane({ id: `${id}-list`, placement: "under", kind: "select-list find-list", isShownInPlace: isOpen, body: html`<div class="select-options" id="${id}-choices" role="listbox" aria-label="${options.label}" data-own-fade>${isOpen && options.shownSuggestions ? suggestionRows(id, options.searchText, options.shownSuggestions, 0) : ""}</div>` })}<template class="find-icon"><span class="find-row-icon">${icon("search")}</span></template>`
    : "";
  const className = ["find", "carving", "layered", "is-used", "sized", options.state === "is-open" ? "is-focused is-open" : options.state ?? ""].filter(Boolean).join(" ");
  return controlMarkup(html`<form class="${className}" method="get" action="${options.action}" role="search" data-cut-line="10"${options.suggestionsUrl !== undefined ? html` data-suggest="${options.suggestionsUrl}"` : ""}>${CUT_LINE}${Object.entries(options.keep ?? {}).map(([name, keptValue]) => html`<input type="hidden" name="${name}" value="${keptValue}">`)}${icon("search")}<input type="search" name="${options.name}" value="${options.searchText}" maxlength="200" placeholder="${options.placeholder}" aria-label="${options.label}" autocomplete="off"${combobox}>${tertiaryButton("Clear the search", { type: "button", icon: "close", isLabelHidden: true, isSmall: true })}${list}</form>`, "regular");
}

export interface WheelColumn {
  /** The name its pick is sent under: "match_hours". */
  name: string;
  /** What it picks, for a screen reader: "Hours". */
  label: string;
  /** Its rows, top to bottom: what each says and what it sends. */
  rows: { label: string; rowValue: string }[];
  /** The row it starts on. Left out, the first. */
  pickedValue?: string;
}

export interface WheelFieldOptions {
  /** The name a birthday or a date and time is sent under. Custom wheels send each column under its own name. */
  name: string;
  label: string;
  /**
   * What it picks: "birthday" (month, day and year, each starting blank so nothing suggests an age, sent as YYYY-MM-DD), "date-time" (the
   * day, hour, minute and AM or PM in the viewer's own time zone, which it says, sent as ISO 8601 with its offset), or "custom" (its columns).
   */
  wheelKind: "birthday" | "date-time" | "custom";
  /** A custom field's wheels, in the order they're read: it shows their picked rows' labels in that order ("1 h 30 min"). */
  columns?: WheelColumn[];
  /** Unique on the page. Defaults to wheel-<name>. */
  id?: string;
  /** What says what it picks, at its start. Defaults to a calendar for a birthday and a clock for a date and time; a custom one has none unless given. */
  icon?: IconName;
  /** A birthday's (YYYY-MM-DD) or a date and time's (ISO 8601 with its offset: 2026-10-23T15:30+02:00) picked value. */
  pickedValue?: string;
  /** A date and time's earliest, ISO 8601 with its offset; earlier picks move up to it. Defaults to now. */
  minimumAt?: string;
  /** What to know about it, under the field, quieter (its id is <id>-hint). An error takes its place. */
  hint?: string;
  /**
   * What's wrong, under the field, marked: what the page says when it comes back from its form. Picking takes it away; a date and time sent
   * back with one keeps saying the time it was sent with until another is picked.
   */
  error?: string;
  /** Its form won't go on until it's picked: it says so and opens. */
  isRequired?: boolean;
  /** "open" shows the wheels, "marked" says to pick to go on, "is-focused" is it reached by keyboard: the gallery's fixed states. */
  state?: "open" | "marked" | "is-focused";
}

/** What a wheel field says when its form won't go on without a pick. */
const WHEEL_MISSING = { birthday: "Pick your birthday to go on.", "date-time": "Pick a time to go on.", custom: "Pick one to go on." } as const;

const DATE_WHEELS = {
  birthday: [["month", "Month"], ["day", "Day"], ["year", "Year"]],
  "date-time": [["day", "Day"], ["hour", "Hour"], ["minute", "Minute"], ["half", "AM or PM"]],
} as const;

/**
 * One wheel: a groove carved into the picker's glass, three rows tall, its picked row in the middle catching the light. The groove and its
 * lit row stay still while the wheel scrolls inside it. A custom wheel carries its rows (data-rows) and where it starts (data-picked).
 */
const wheelChannel = (part: string, label: string, column?: WheelColumn) =>
  html`<div class="wheel-channel carving" data-cut-line="8"><span class="wheel-lit carving-pointed" data-cut-line="6" aria-hidden="true">${CUT_LINE}</span><div class="wheel" data-own-fade data-part="${part}" role="listbox" aria-label="${label}" tabindex="0"${
    column ? html` data-rows="${JSON.stringify(column.rows.map((row) => [row.label, row.rowValue]))}" data-picked="${Math.max(0, column.rows.findIndex((row) => row.rowValue === column.pickedValue))}"` : ""
  }></div></div>`;

/**
 * A wheel field: a field that opens wheels to pick a value made of parts read together, each wheel a groove of three rows with the pick in
 * the middle: a birthday, a date and time, or wheels of a page's own (a match's length). One of many from a list is a Select field; a
 * number on a scale is a Slider.
 */
export function wheelField(options: WheelFieldOptions): ControlMarkup {
  const id = options.id ?? `wheel-${options.name}`;
  const isOpen = options.state === "open";
  const isMarked = options.state === "marked" || Boolean(options.error);
  const columns = options.wheelKind === "custom" ? (options.columns ?? []) : [];
  const fieldIcon = options.icon ?? (options.wheelKind === "birthday" ? "calendar" : options.wheelKind === "date-time" ? "clock" : undefined);
  const shown = options.wheelKind === "custom"
    ? columns.map((column) => (column.rows.find((row) => row.rowValue === column.pickedValue) ?? column.rows[0])?.label ?? "").join(" ")
    : options.wheelKind === "birthday" ? "Choose a date" : "Choose a time";
  const isZone = options.wheelKind === "date-time";
  const buttonClass = ["wheel-button", "carving", "is-used", "sized", "is-button", fieldIcon ? "" : "no-icon", options.wheelKind === "custom" ? "set" : "", isMarked ? "is-marked" : "", options.state === "is-focused" ? "is-focused" : ""].filter(Boolean).join(" ");
  const describedBy = [`${id}-legend`, `${id}-error`, options.hint ? `${id}-hint` : "", isZone ? `${id}-zone` : ""].filter(Boolean).join(" ");
  const channels = options.wheelKind === "custom"
    ? columns.map((column) => wheelChannel(column.name, column.label, column))
    : DATE_WHEELS[options.wheelKind].map(([part, label]) => wheelChannel(part, label));
  const sent = options.wheelKind === "custom"
    ? columns.map((column) => html`<input type="hidden" name="${column.name}" value="${(column.rows.find((row) => row.rowValue === column.pickedValue) ?? column.rows[0])?.rowValue ?? ""}" data-part="${column.name}">`)
    : html`<input type="hidden" name="${options.name}" value="${options.pickedValue ?? ""}">`;
  return controlMarkup(html`<fieldset class="wheel-field" id="${id}" data-wheels="${options.wheelKind}"${options.minimumAt ? html` data-minimum-at="${options.minimumAt}"` : ""}${options.isRequired ? raw(" data-required") : ""}>
<legend class="words-margin" id="${id}-legend">${options.label}</legend>
<button type="button" class="${buttonClass}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${describedBy}">${CUT_LINE}${fieldIcon ? icon(fieldIcon) : ""}<span class="wheel-value one-line">${shown}</span><span class="wheel-chev">${icon("chevron-down")}</span></button>
${floatingPane({
    id: `${id}-pick`,
    placement: "over",
    kind: "wheel-pick", holdsParts: true,
    role: "group",
    label: options.label,
    isShownInPlace: isOpen,
    // The wheels' middle row: under the pane's room at its top, a row and a half down.
    lineFromTop: "calc(var(--pad-inner-pane) + 54px)",
    body: html`<div class="wheels ${options.wheelKind}-wheels"${options.wheelKind === "custom" ? html` style="--wheel-count: ${columns.length}"` : ""}>${channels}</div>${isZone ? html`<p class="wheel-zone words-margin" id="${id}-zone"></p>` : ""}<span class="wheel-read sr" aria-live="polite"></span>`,
  })}
<p class="field-error words-margin" id="${id}-error"${isMarked ? "" : raw(" hidden")}>${options.error ?? WHEEL_MISSING[options.wheelKind]}</p>${options.hint ? html`<p class="field-hint words-margin" id="${id}-hint"${isMarked ? raw(" hidden") : ""}>${options.hint}</p>` : ""}
${sent}
</fieldset>`, "field", { hasOwnWords: true });
}

/** How many boxes a PIN field has: a purchase PIN's digits (packages/core/src/purchase-pin.ts), so the field and the rule never differ. */
const PIN_DIGIT_COUNT = PURCHASE_PIN_LIMITS.pinDigitCount;

export interface PinFieldOptions {
  /** The name the digits are sent under when its form is sent (a hidden field holds them): "purchase_pin". */
  name: string;
  /** What the PIN is, above the boxes: "Purchase PIN". */
  label: string;
  /** Its id, unique on the page; a page script finds it by this (window.zaismaPinField). Defaults to pin-<name>. */
  id?: string;
  /** The digits in it already, from the first box: fewer than all of them is a PIN part way in (the gallery's still copies). */
  digits?: string;
  /** What's wrong, under the boxes, and the boxes marked: "That PIN isn't right. 4 tries left." Typing the next digit takes it away. */
  error?: string;
  /** Can't be changed now (its PIN is on its way): the boxes carved in, their digits quieter. */
  isDisabled?: boolean;
  /** The gallery's fixed focus: on the first empty box (the last, when all are in), so it sits still. */
  state?: "is-focused";
}

/**
 * A PIN field: one box for each digit of a PIN in one equal row that fills its pane, a label above and what's wrong under. Digits only,
 * masked like a password; typing moves on to the next box, Backspace on an empty box goes back, the arrows move, and pasting a PIN fills
 * every box. The sixth digit fires `zaisma:pin-complete` on the field (it bubbles; `detail.digits` is the PIN as text), so a page needs no
 * button to send it (PIN_FIELD_SCRIPT). The boxes are cut fields, in a Row, so the edge rule shapes the row's ends.
 */
export function pinField(options: PinFieldOptions): ControlMarkup {
  const id = options.id ?? `pin-${options.name}`;
  const digits = options.digits ?? "";
  const errorId = `${id}-error`;
  const focusedIndex = options.state === "is-focused" ? Math.min(digits.length, PIN_DIGIT_COUNT - 1) : -1;
  const boxes = Array.from({ length: PIN_DIGIT_COUNT }, (_, boxIndex) => {
    const className = ["field", "carving", "layered", "is-used", "sized", "no-icon", "pin-box", options.error ? "is-marked" : "", boxIndex === focusedIndex ? "is-focused" : ""].filter(Boolean).join(" ");
    const input = html`<input type="password" inputmode="numeric" pattern="[0-9]*" size="1" placeholder=" " autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Digit ${boxIndex + 1} of ${PIN_DIGIT_COUNT}" aria-describedby="${errorId}"${digits[boxIndex] ? html` value="${digits[boxIndex]}"` : ""}${options.error ? raw(' aria-invalid="true"') : ""}${options.isDisabled ? raw(" disabled") : ""}>`;
    return { kind: "control" as const, markup: controlMarkup(html`<span class="${className}" data-cut-line="10">${CUT_LINE}${input}</span>`, "field") };
  });
  return controlMarkup(html`<fieldset class="pin-field" id="${id}" data-pin>
<legend class="words-margin">${options.label}</legend>
${row({ widths: "equal", items: boxes })}
<input type="hidden" name="${options.name}" value="${digits}">
<p class="field-error words-margin" id="${errorId}"${options.error ? "" : raw(" hidden")}>${options.error ?? ""}</p>
</fieldset>`, "field", { hasOwnWords: true });
}

/**
 * The PIN field's behavior, for every `[data-pin]` on a page. The last digit entered fires `zaisma:pin-complete` on the field
 * ({ bubbles: true, detail: { digits } }). A page that sends the PIN itself drives the field with window.zaismaPinField, given the field
 * or its id:
 *   digits(field)              the digits in it, as text
 *   clear(field)               empties every box
 *   focus(field)               puts the cursor in the first box
 *   setError(field, words)     marks the boxes and says words under them; "" takes both away (typing the next digit does too)
 *   setDisabled(field, isOff)  carves the boxes in while a PIN is on its way, and back out
 */
export const PIN_FIELD_SCRIPT = String.raw`/* pin fields */(function () {
  var COUNT = ${PIN_DIGIT_COUNT};
  function find(target) { return typeof target === "string" ? document.getElementById(target) : target; }
  function boxesOf(root) { return Array.prototype.slice.call(root.querySelectorAll(".pin-box > input")); }
  function digitsOf(root) { return boxesOf(root).map(function (box) { return box.value; }).join(""); }
  function setError(root, words) {
    var line = root.querySelector(".field-error");
    line.textContent = words || ""; line.hidden = !words;
    Array.prototype.forEach.call(root.querySelectorAll(".pin-box"), function (box) { box.classList.toggle("is-marked", !!words); });
    boxesOf(root).forEach(function (box) { if (words) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid"); });
  }
  function keep(root) { root.querySelector('input[type="hidden"]').value = digitsOf(root); }
  window.zaismaPinField = {
    digits: function (target) { return digitsOf(find(target)); },
    clear: function (target) { var root = find(target); boxesOf(root).forEach(function (box) { box.value = ""; }); keep(root); },
    focus: function (target) { var first = boxesOf(find(target))[0]; first.focus({ preventScroll: true }); first.select(); },
    setError: function (target, words) { setError(find(target), words); },
    setDisabled: function (target, isOff) { var root = find(target); boxesOf(root).forEach(function (box) { box.disabled = !!isOff; }); if (isOff) root.setAttribute("aria-busy", "true"); else root.removeAttribute("aria-busy"); }
  };
  window.zaismaWatch.each("[data-pin]", function (root) {
    var boxes = boxesOf(root);
    function focusBox(index) { var box = boxes[Math.max(0, Math.min(COUNT - 1, index))]; box.focus({ preventScroll: true }); box.select(); }
    // Something was entered or taken out: what's wrong no longer describes what's in it, and a full PIN goes out.
    function changed() {
      if (root.querySelector(".pin-box.is-marked")) setError(root, "");
      keep(root);
      var digits = digitsOf(root);
      if (digits.length === COUNT) root.dispatchEvent(new CustomEvent("zaisma:pin-complete", { bubbles: true, detail: { digits: digits } }));
    }
    // Digits go into the boxes from one on, and the cursor moves to the box after the last one filled.
    function fill(from, text) {
      var digits = text.replace(/\D/g, "").slice(0, COUNT - from);
      if (!digits) return;
      digits.split("").forEach(function (digit, offset) { boxes[from + offset].value = digit; });
      focusBox(from + digits.length);
      changed();
    }
    boxes.forEach(function (box, index) {
      box.addEventListener("focus", function () { box.select(); });
      box.addEventListener("keydown", function (event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        var key = event.key;
        if (/^[0-9]$/.test(key)) { event.preventDefault(); fill(index, key); return; }
        if (key === "Backspace" || key === "Delete") {
          event.preventDefault();
          if (box.value) { box.value = ""; changed(); return; }
          if (key === "Backspace" && index > 0) { boxes[index - 1].value = ""; focusBox(index - 1); changed(); }
          return;
        }
        if (key === "ArrowLeft" || key === "ArrowRight") { event.preventDefault(); focusBox(index + (key === "ArrowLeft" ? -1 : 1)); return; }
        if (key === "Home" || key === "End") { event.preventDefault(); focusBox(key === "Home" ? 0 : COUNT - 1); return; }
        // Digits only: any other letter or mark is dropped before it shows.
        if (key.length === 1) event.preventDefault();
      });
      // What keyboards that don't say their keys (a phone's) and autofill put in: the last digit typed, or a whole PIN.
      box.addEventListener("input", function () {
        var digits = box.value.replace(/\D/g, "");
        box.value = "";
        if (!digits) return changed();
        if (digits.length === COUNT) { boxes.forEach(function (each) { each.value = ""; }); return fill(0, digits); }
        fill(index, digits.slice(-1));
      });
      box.addEventListener("paste", function (event) {
        event.preventDefault();
        var digits = ((event.clipboardData || window.clipboardData).getData("text") || "").replace(/\D/g, "");
        if (!digits) return;
        boxes.forEach(function (each) { each.value = ""; });
        fill(0, digits);
      });
    });
  });
})();
`;

/** Show/Hide: shows the password it controls, and hides it again. Clear: empties a search and puts you back in it. */
export const FIELD_SCRIPT = `/* fields */(function () {
  document.addEventListener("click", function (event) {
    var clear = event.target.closest && event.target.closest(".find > .tertiary-btn");
    if (clear) {
      var search = clear.parentElement.querySelector('input[type="search"]');
      if (search) { search.value = ""; search.dispatchEvent(new Event("input", { bubbles: true })); search.focus(); }
      return;
    }
    var show = event.target.closest && event.target.closest(".field:not(.code) > .cut-btn[aria-controls]");
    if (!show) return;
    var input = document.getElementById(show.getAttribute("aria-controls")); if (!input) return;
    var on = input.type === "password";
    input.type = on ? "text" : "password";
    // Only its words change: the slab and its drawn edge stay. The label, not the loader's span before it.
    show.querySelector(".face > span:not(.loader)").textContent = on ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(on));
  });
  // A field that takes only some characters (data-characters) drops every other before it shows, letters first turned to capitals where
  // it's made of them (data-uppercase); its maxlength holds what's left to its length, a paste cut to the room it has.
  var TAKES = "input[data-characters]";
  function kept(input, text) {
    var one = new RegExp("^" + input.getAttribute("data-characters") + "$");
    if (input.hasAttribute("data-uppercase")) text = text.toUpperCase();
    return Array.from(text).filter(function (character) { return one.test(character); }).join("");
  }
  // Text going in where the cursor is, in place of the browser's own insert: only what it takes, as much as there's room for.
  function put(input, text, event) {
    var keep = kept(input, text);
    if (keep === text && event.type !== "paste") return;
    event.preventDefault();
    var start = input.selectionStart, end = input.selectionEnd, room = input.maxLength >= 0 ? input.maxLength - input.value.length + end - start : keep.length;
    keep = keep.slice(0, Math.max(0, room));
    if (!keep) return;
    input.setRangeText(keep, start, end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // A paste is taken whole before maxlength would cut it, so "K7Q-2MX" keeps all six of its characters.
  document.addEventListener("paste", function (event) {
    var input = event.target;
    if (input.matches && input.matches(TAKES) && event.clipboardData) put(input, event.clipboardData.getData("text/plain"), event);
  });
  document.addEventListener("beforeinput", function (event) {
    var input = event.target;
    if (!input.matches || !input.matches(TAKES) || event.inputType !== "insertText" || event.isComposing || typeof event.data !== "string") return;
    put(input, event.data, event);
  });
  // What goes in with no change a page can stop first (autofill, a word a phone's keyboard was composing): cleaned once it's in, the
  // cursor kept after the same characters.
  function clean(input) {
    var keep = kept(input, input.value);
    if (input.maxLength >= 0) keep = keep.slice(0, input.maxLength);
    if (keep === input.value) return;
    var caretIndex = kept(input, input.value.slice(0, input.selectionStart || 0)).length;
    input.value = keep; input.setSelectionRange(Math.min(caretIndex, keep.length), Math.min(caretIndex, keep.length));
  }
  document.addEventListener("input", function (event) { if (event.target.matches && event.target.matches(TAKES) && !event.isComposing) clean(event.target); }, true);
  document.addEventListener("compositionend", function (event) { if (event.target.matches && event.target.matches(TAKES)) clean(event.target); }, true);
  // Words in a field fade out at an end with more of them past it, never cut off hard there: as they're typed, the caret moves or the
  // field scrolls, and when it's resized.
  var TEXT = ".field > input:not([type='hidden']), .find > input[type='search']";
  function fadeText(input) {
    var holder = input.parentElement, morePx = input.scrollWidth - input.clientWidth;
    holder.classList.toggle("more-left", morePx > 1 && input.scrollLeft > 1);
    holder.classList.toggle("more-right", morePx > 1 && input.scrollLeft < morePx - 1);
  }
  function later(input) { requestAnimationFrame(function () { fadeText(input); }); }
  ["input", "focusin", "focusout", "keyup", "click", "scroll"].forEach(function (type) {
    document.addEventListener(type, function (event) { if (event.target.matches && event.target.matches(TEXT)) later(event.target); }, true);
  });
  document.addEventListener("selectionchange", function () { var input = document.activeElement; if (input && input.matches && input.matches(TEXT)) later(input); });
  window.zaismaWatch.each(TEXT, function (input) { fadeText(input); window.zaismaWatch.size(input, function () { fadeText(input); }); });
})();
`;

/**
 * A search's finishes and games as you type (form.find[data-suggest]): it asks its suggestionsUrl a moment after typing stops and lists up
 * to three finishes, then up to three games, in a select field's list under it. Up and down move the white slab through them, as does the
 * pointer; on a finish, the rest of it shows quietly after what's typed. Tab takes the finish and waits; Enter takes it and searches, or on
 * a game opens it; Esc closes the list. Each finish taken is typed in as far as the page is concerned (an input event).
 */
export const SEARCH_SCRIPT = `/* search finishes */(function () {
  var WAIT_MS = 120;
  window.zaismaWatch.each("form.find[data-suggest]", function (form) {
    var input = form.querySelector('input[type="search"]'), list = form.querySelector(".find-list"), box = list.querySelector('[role="listbox"]'), scroller = list.querySelector(".floating-body");
    var ghost = form.querySelector(".find-finish"), typedPart = ghost.firstElementChild, restPart = ghost.lastElementChild, iconTemplate = form.querySelector("template.find-icon");
    var id = list.id.replace(/-list$/, ""), url = form.getAttribute("data-suggest"), rows = [], active = -1, timer = 0, asking = null, answers = new Map();
    // A Floating pane under the field, as wide as it; the cursor stays in the field, so Esc there closes it (below).
    var float = window.zaismaFloat(list, {
      anchor: form, focusOnClose: input, isAnchorWidth: true,
      onToggle: function (isShown) { input.setAttribute("aria-expanded", String(isShown)); form.classList.toggle("is-open", isShown); showFinish(); }
    });
    function isOpen() { return float.isOpen(); }
    // The rest of the finish you're on, after what's typed, while what's typed is all in view.
    function showFinish() {
      var row = isOpen() && rows[active], typed = input.value, finish = row && row.getAttribute("data-finish");
      var fits = finish && typed && finish.length > typed.length && finish.toLowerCase().indexOf(typed.toLowerCase()) === 0 && input.scrollLeft < 1;
      typedPart.textContent = fits ? typed : ""; restPart.textContent = fits ? finish.slice(typed.length) : "";
    }
    function setActive(index) {
      active = index;
      rows.forEach(function (row, rowIndex) { row.classList.toggle("is-active", rowIndex === index); });
      if (index >= 0) { input.setAttribute("aria-activedescendant", rows[index].id); var row = rows[index]; if (row.offsetTop < scroller.scrollTop) scroller.scrollTop = row.offsetTop; else if (row.offsetTop + row.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = row.offsetTop + row.offsetHeight - scroller.clientHeight; }
      else input.removeAttribute("aria-activedescendant");
      showFinish();
    }
    function show() { if (isOpen()) float.place(); else float.open(); showFinish(); }
    function hide() { float.close(false); showFinish(); }
    // What's typed, the part of the words that matches it in bold.
    function words(text, typed) {
      var span = document.createElement("span"), matchIndex = typed ? text.toLowerCase().indexOf(typed.toLowerCase()) : -1;
      if (matchIndex < 0) { span.textContent = text; return span; }
      var bold = document.createElement("b"); bold.textContent = text.slice(matchIndex, matchIndex + typed.length);
      span.append(text.slice(0, matchIndex), bold, text.slice(matchIndex + typed.length));
      return span;
    }
    function newRow(tag, kind) {
      var row = document.createElement(tag); row.className = "select-option flush-row compact find-" + kind; row.setAttribute("role", "option"); row.id = id + "-row-" + rows.length; row.setAttribute("data-cut-line", "8");
      return row;
    }
    function fill(answer, typed) {
      box.textContent = ""; rows = [];
      (answer.finishes || []).slice(0, 3).forEach(function (finish) {
        var row = newRow("div", "finish-row"); row.setAttribute("data-finish", finish);
        row.append(iconTemplate.content.cloneNode(true), words(finish, typed)); box.appendChild(row); rows.push(row);
      });
      var games = (answer.games || []).slice(0, 3);
      if (games.length) { var head = document.createElement("div"); head.className = "find-head words-margin"; head.setAttribute("role", "presentation"); head.textContent = "Games"; box.appendChild(head); }
      games.forEach(function (game) {
        var row = newRow("a", "game"); row.href = game.page_url; row.tabIndex = -1;
        var cover = document.createElement("img"); cover.src = game.cover_url; cover.alt = ""; cover.width = 64; cover.height = 36;
        var gameWords = document.createElement("span"), fact = document.createElement("span");
        gameWords.className = "find-game-words"; fact.className = "find-game-fact"; fact.textContent = game.fact;
        gameWords.append(words(game.title, typed), fact); row.append(cover, gameWords); box.appendChild(row); rows.push(row);
      });
      if (rows.length && document.activeElement === input) { show(); setActive(0); } else { setActive(-1); hide(); }
    }
    function ask() {
      var typed = input.value.trim();
      if (asking) { asking.abort(); asking = null; }
      if (!typed) { rows = []; box.textContent = ""; setActive(-1); hide(); return; }
      if (answers.has(typed)) { fill(answers.get(typed), typed); return; }
      asking = new AbortController();
      fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "search=" + encodeURIComponent(typed), { signal: asking.signal, headers: { Accept: "application/json" } })
        .then(function (answer) { return answer.ok ? answer.json() : { finishes: [], games: [] }; })
        .then(function (answer) { answers.set(typed, answer); if (input.value.trim() === typed) fill(answer, typed); })
        .catch(function () {});
    }
    // A finish taken goes in as if typed, so the page's own search as you type follows it too.
    function take() { var row = rows[active]; if (!row || !row.hasAttribute("data-finish")) return; input.value = row.getAttribute("data-finish"); input.dispatchEvent(new Event("input", { bubbles: true })); }
    function go() {
      var row = rows[active];
      if (row && row.tagName === "A") { location.href = row.href; return; }
      if (row) { input.value = row.getAttribute("data-finish"); input.dispatchEvent(new Event("input", { bubbles: true })); }
      clearTimeout(timer); if (asking) asking.abort(); hide();
      form.requestSubmit();
    }
    input.addEventListener("input", function () { clearTimeout(timer); showFinish(); timer = setTimeout(ask, WAIT_MS); });
    input.addEventListener("scroll", showFinish);
    // Back in a search that has words in it (clicked, tapped or tabbed to), its predictions show again, as if just typed.
    function reopen() { if (!isOpen() && input.value.trim()) { clearTimeout(timer); ask(); } }
    input.addEventListener("focus", reopen);
    input.addEventListener("click", reopen);
    input.addEventListener("keydown", function (event) {
      var key = event.key;
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen()) { if (rows.length) { show(); setActive(0); } else ask(); return; }
        setActive((active + (key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
      } else if (key === "Tab" && !event.shiftKey && isOpen() && restPart.textContent) { event.preventDefault(); take(); }
      else if (key === "Enter" && isOpen() && active >= 0) { event.preventDefault(); go(); }
      else if (key === "Escape" && isOpen()) { event.preventDefault(); hide(); }
    });
    input.addEventListener("focusout", function () { setTimeout(function () { if (document.activeElement !== input) hide(); }, 0); });
    // The list never takes the focus: a press on it leaves the cursor in the field.
    list.addEventListener("pointerdown", function (event) { event.preventDefault(); });
    list.addEventListener("pointermove", function (event) { var row = event.target.closest(".select-option"); var index = rows.indexOf(row); if (index >= 0 && index !== active) setActive(index); });
    list.addEventListener("click", function (event) { var row = event.target.closest(".select-option"); var index = rows.indexOf(row); if (index < 0) return; event.preventDefault(); setActive(index); go(); });
  });
})();
`;

/**
 * Wheel fields ([data-wheels]): one script for the wheels, with a form for what they pick. Scroll a wheel, tap a row, or use the keys (arrows,
 * Page Up and Down, Home and End, or type a row's start); the row in the middle is the pick. Enter closes it once it's picked, Esc closes it.
 * A form that needs it (data-required) won't go on without a pick: the field says so and the wheels open.
 *   birthday   month, day and year, each starting blank; 29 February only in a leap year. Sends YYYY-MM-DD.
 *   date-time  the day (a year from the earliest it takes), hour, minute in fives and AM or PM, in the viewer's time zone, which it says. It
 *              starts on the time given, or the next whole hour once it opens; a pick earlier than the earliest moves up to it. Sends ISO
 *              8601 with the viewer's offset.
 *   custom     the page's own wheels (data-rows), each sending its pick under its own name.
 */
export const WHEEL_SCRIPT = String.raw`/* wheel fields */(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ROW = 36, DAY_MS = 86400000, FIVE_MS = 300000;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var HINT = window.matchMedia("(pointer: coarse)").matches ? "Swipe each wheel to pick." : "Scroll or type to pick each one.";
  function two(n) { return String(n).padStart(2, "0"); }
  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

  // A birthday: each wheel's row 0 is its blank. The day wheel follows the month and year.
  function birthdayForm(root, hidden) {
    var thisYear = new Date().getFullYear(), years = [];
    for (var y = thisYear; y > thisYear - 100; y--) years.push(String(y));
    function daysIn(month, year) { return month ? new Date(year || 2000, month, 0).getDate() : 31; }
    var at = { month: 0, day: 0, year: 0 };
    var given = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hidden.value);
    if (given) { at.month = Number(given[2]); at.day = Number(given[3]); at.year = Math.max(0, years.indexOf(given[1]) + 1); }
    function complete() { return Boolean(at.month && at.day && at.year); }
    return {
      parts: ["month", "day", "year"], at: at, hasBlank: true,
      rows: function (part) {
        if (part === "month") return ["Month"].concat(MONTHS);
        if (part === "year") return ["Year"].concat(years);
        var list = ["Day"]; for (var d = 1; d <= daysIn(at.month, at.year ? Number(years[at.year - 1]) : 0); d++) list.push(String(d)); return list;
      },
      // A new month or year refills the day wheel, keeping the day where it still fits.
      set: function (part, i) { at[part] = i; return part === "day" ? [] : ["day"]; },
      isComplete: complete,
      // Two digits typed on the year: the nearest year ending in them.
      typed: function (part, typed, list) { if (part !== "year" || !/^\d{2}$/.test(typed)) return -1; for (var j = 1; j < list.length; j++) if (list[j].slice(2) === typed) return j; return -1; },
      firstPart: function () { return complete() || !at.month ? "month" : !at.day ? "day" : "year"; },
      // The field says it short (Feb 3, 2022), its month in words so no player reads it the other way round; the picker's foot says it in full.
      words: function () {
        if (!complete()) return { shown: null, read: HINT, sent: "" };
        var month = MONTHS[at.month - 1], year = years[at.year - 1];
        return { shown: month.slice(0, 3) + " " + at.day + ", " + year, read: month + " " + at.day + ", " + year, sent: year + "-" + two(at.month) + "-" + two(at.day) };
      }
    };
  }

  // A date and time: the hour wheel's rows are 1 to 12 (row 11 is 12), and with AM or PM they make the hour of the day.
  function dateTimeForm(root, hidden, field) {
    var HOURS = [], MINUTES = [], HALVES = ["AM", "PM"];
    for (var h = 1; h <= 12; h++) HOURS.push(String(h));
    for (var m = 0; m < 60; m += 5) MINUTES.push(two(m));
    var zone = root.querySelector(".wheel-zone");
    var minimum = root.hasAttribute("data-minimum-at") ? new Date(root.getAttribute("data-minimum-at")) : new Date();
    if (isNaN(minimum)) minimum = new Date();
    minimum = new Date(Math.ceil(minimum.getTime() / FIVE_MS) * FIVE_MS);
    var firstDay = startOfDay(minimum), days = [];
    for (var d = 0; d < 366; d++) days.push(new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + d));
    var today = startOfDay(new Date()).getTime(), thisYear = new Date().getFullYear();
    // Two formats made once for the wheel's 366 days, not one for each day.
    var thisYearWords = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }), laterYearWords = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
    function dayWords(day) {
      var gap = Math.round((day.getTime() - today) / DAY_MS);
      if (gap === 0) return "Today";
      if (gap === 1) return "Tomorrow";
      // Next year's days say their year instead of their weekday, so they fit the wheel.
      return (day.getFullYear() === thisYear ? thisYearWords : laterYearWords).format(day);
    }
    var dayRows = days.map(dayWords);
    function zoneName(date) { try { var part = new Intl.DateTimeFormat("en-US", { timeZoneName: "long" }).formatToParts(date).find(function (each) { return each.type === "timeZoneName"; }); return part ? part.value : ""; } catch (error) { return ""; } }
    function iso(date) {
      var offset = -date.getTimezoneOffset(), sign = offset < 0 ? "-" : "+", whole = Math.abs(offset);
      return date.getFullYear() + "-" + two(date.getMonth() + 1) + "-" + two(date.getDate()) + "T" + two(date.getHours()) + ":" + two(date.getMinutes()) + sign + two(Math.floor(whole / 60)) + ":" + two(whole % 60);
    }
    var at = { day: 0, hour: 0, minute: 0, half: 0 }, isSet = false;
    function timeOf(pick) { var day = days[pick.day]; return new Date(day.getFullYear(), day.getMonth(), day.getDate(), (pick.hour + 1) % 12 + pick.half * 12, pick.minute * 5); }
    function pickOf(date) {
      var dayIndex = Math.max(0, Math.min(days.length - 1, Math.round((startOfDay(date).getTime() - firstDay.getTime()) / DAY_MS)));
      return { day: dayIndex, hour: (date.getHours() % 12 || 12) - 1, minute: Math.floor(date.getMinutes() / 5), half: date.getHours() < 12 ? 0 : 1 };
    }
    function setAll(pick) { Object.keys(pick).forEach(function (part) { at[part] = pick[part]; }); }
    var given = hidden.value ? new Date(hidden.value) : null;
    // Sent back with an error (a time that's passed): the field keeps saying the time it was sent with, marked, until another is picked.
    var sentAt = given && !isNaN(given) && field.classList.contains("is-marked") ? given : null;
    if (given && !isNaN(given)) { setAll(pickOf(given < minimum ? minimum : given)); isSet = true; }
    return {
      parts: ["day", "hour", "minute", "half"], at: at, hasBlank: false,
      rows: function (part) { return part === "day" ? dayRows : part === "hour" ? HOURS : part === "minute" ? MINUTES : HALVES; },
      // Earlier than it takes: every wheel moves up to the earliest.
      set: function (part, i) { at[part] = i; isSet = true; sentAt = null; if (timeOf(at) < minimum) { setAll(pickOf(minimum)); return "all"; } return []; },
      isComplete: function () { return isSet; },
      // Nothing picked yet: it starts on the next whole hour, or the earliest it takes.
      opening: function () { if (isSet) return false; var next = new Date(); next.setMinutes(60, 0, 0); setAll(pickOf(next < minimum ? minimum : next)); isSet = true; return true; },
      firstPart: function () { return "day"; },
      words: function () {
        var shownAt = sentAt || timeOf(at);
        zone.textContent = "Your time" + (zoneName(shownAt) ? ": " + zoneName(shownAt) : "");
        if (!isSet) return { shown: null, read: "", sent: "" };
        var timeWords = shownAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        // The field says it short (Today, Oct 23, or Jan 15, 2027 in another year), its month in words so no player reads it the other way
        // round, and it fits a phone; the wheels and the screen reader say it whole.
        var day = startOfDay(shownAt), gap = Math.round((day.getTime() - today) / DAY_MS);
        var shortDay = gap === 0 ? "Today" : gap === 1 ? "Tomorrow" : day.toLocaleDateString("en-US", day.getFullYear() === thisYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
        return { shown: shortDay + ", " + timeWords, read: shownAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " at " + timeWords, sent: iso(shownAt) };
      }
    };
  }

  // The page's own wheels: each carries its rows ([label, value]) and where it starts, and sends its pick under its own name.
  function customForm(root) {
    var parts = [], lists = {}, at = {};
    Array.prototype.forEach.call(root.querySelectorAll(".wheel[data-part]"), function (wheel) {
      var part = wheel.getAttribute("data-part"); parts.push(part);
      try { lists[part] = JSON.parse(wheel.getAttribute("data-rows")) || []; } catch (error) { lists[part] = []; }
      at[part] = Math.max(0, Number(wheel.getAttribute("data-picked")) || 0);
    });
    return {
      parts: parts, at: at, hasBlank: false,
      rows: function (part) { return lists[part].map(function (row) { return row[0]; }); },
      set: function (part, i) { at[part] = i; return []; },
      isComplete: function () { return true; },
      firstPart: function () { return parts[0]; },
      words: function () {
        var shown = parts.map(function (part) { return (lists[part][at[part]] || [""])[0]; }).join(" ");
        var sent = {}; parts.forEach(function (part) { sent[part] = (lists[part][at[part]] || ["", ""])[1]; });
        return { shown: shown, read: shown, sent: sent };
      }
    };
  }

  window.zaismaWatch.each("[data-wheels]", function (root) {
    var kind = root.getAttribute("data-wheels"), id = root.id;
    var field = root.querySelector(".wheel-button"), pick = root.querySelector(".wheel-pick"), value = root.querySelector(".wheel-value"), isInPlace = pick.classList.contains("in-place");
    var error = root.querySelector(".field-error"), hint = root.querySelector(".field-hint"), read = root.querySelector(".wheel-read");
    var hidden = root.querySelector('input[type="hidden"]:not([data-part])');
    var form = kind === "birthday" ? birthdayForm(root, hidden) : kind === "date-time" ? dateTimeForm(root, hidden, field) : customForm(root);
    var placeholder = value.textContent, wheels = {};
    form.parts.forEach(function (part) { wheels[part] = { el: root.querySelector('.wheel[data-part="' + part + '"]'), count: 0 }; });
    var wheelRow = pick.querySelector(".wheels");
    // A Floating pane over the field, as wide as its wheels whatever the field shows, their middle row on the field's own line.
    var float = window.zaismaFloat(pick, {
      anchor: field, home: root,
      lineOf: function () { return wheelRow.offsetTop + 1.5 * ROW; },
      onToggle: function (isShown) { field.setAttribute("aria-expanded", String(isShown)); }
    });
    function isOpen() { return float.isOpen(); }
    function mark(part) {
      var w = wheels[part], i = form.at[part];
      Array.prototype.forEach.call(w.el.children, function (option, j) { option.setAttribute("aria-selected", String(j === i)); });
      w.el.setAttribute("aria-activedescendant", id + "-" + part + "-" + i);
    }
    // A wheel's rows go in together; one listener on the wheel (wired once) takes a press on any of them.
    function fill(part) {
      var w = wheels[part], list = form.rows(part), rows = document.createDocumentFragment();
      w.count = list.length; w.el.textContent = "";
      list.forEach(function (text, i) {
        var option = document.createElement("div"); option.className = "flush-row compact quiet";
        option.setAttribute("role", "option"); option.id = id + "-" + part + "-" + i; option.textContent = text; option.setAttribute("data-label", text);
        if (form.hasBlank && i === 0) option.classList.add("blank");
        rows.appendChild(option);
      });
      w.el.appendChild(rows);
      if (!w.isWired) { w.isWired = true; w.el.addEventListener("click", function (event) { var option = event.target.closest('[role="option"]'); if (option && option.parentElement === w.el) pickRow(part, Array.prototype.indexOf.call(w.el.children, option), true); }); }
      if (form.at[part] > w.count - 1) form.at[part] = w.count - 1;
      mark(part);
    }
    function place(isGliding) { form.parts.forEach(function (part) { wheels[part].el.scrollTo({ top: form.at[part] * ROW, behavior: isGliding && !reduce ? "smooth" : "auto" }); }); }
    function pickRow(part, i, isGliding) {
      i = Math.max(0, Math.min(wheels[part].count - 1, i));
      wheels[part].el.scrollTo({ top: i * ROW, behavior: isGliding && !reduce ? "smooth" : "auto" });
      setRow(part, i);
    }
    var isPicked = form.isComplete();
    function setRow(part, i) {
      if (form.at[part] === i && isPicked) return;
      var changed = form.set(part, i);
      isPicked = true;
      // A pick takes away what was wrong.
      if (field.classList.contains("is-marked") && form.isComplete()) { field.classList.remove("is-marked"); error.hidden = true; if (hint) hint.hidden = false; }
      if (changed === "all") { form.parts.forEach(mark); place(true); }
      else { mark(part); changed.forEach(function (other) { fill(other); wheels[other].el.scrollTop = form.at[other] * ROW; }); }
      show();
    }
    function show() {
      var said = form.words();
      read.textContent = said.read;
      value.textContent = said.shown === null ? placeholder : said.shown;
      field.classList.toggle("set", said.shown !== null);
      if (hidden) hidden.value = typeof said.sent === "string" ? said.sent : "";
      if (typeof said.sent === "object") Object.keys(said.sent).forEach(function (part) { var input = root.querySelector('input[type="hidden"][data-part="' + part + '"]'); if (input) input.value = said.sent[part]; });
    }
    form.parts.forEach(function (part) {
      var w = wheels[part], timer = null, typed = "", typedAt = 0;
      fill(part);
      // When a scroll comes to rest, the row in the middle is the one picked.
      w.el.addEventListener("scroll", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { if (isOpen()) setRow(part, Math.round(w.el.scrollTop / ROW)); }, 110);
      }, { passive: true });
      w.el.addEventListener("keydown", function (event) {
        var i = form.at[part], key = event.key, stepCount = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[key];
        if (stepCount) { pickRow(part, i + stepCount, true); event.preventDefault(); return; }
        if (key === "Home") { pickRow(part, form.hasBlank ? 1 : 0, true); event.preventDefault(); return; }
        if (key === "End") { pickRow(part, w.count - 1, true); event.preventDefault(); return; }
        if (key === "Enter" && form.isComplete()) { close(true); event.preventDefault(); return; }
        if (key.length !== 1 || event.metaKey || event.ctrlKey) return;
        var now = Date.now(); typed = now - typedAt > 900 ? key.toLowerCase() : typed + key.toLowerCase(); typedAt = now;
        var list = form.rows(part), hit = -1;
        for (var j = form.hasBlank ? 1 : 0; j < list.length && hit < 0; j++) if (list[j].toLowerCase().indexOf(typed) === 0) hit = j;
        if (hit < 0 && form.typed) hit = form.typed(part, typed, list);
        if (hit >= 0) { pickRow(part, hit, true); event.preventDefault(); }
      });
    });
    // Shown open as the page loads (a gallery's state), it neither takes the focus nor scrolls the page to itself.
    function open(isOnLoad) {
      if (form.opening && form.opening()) { isPicked = true; form.parts.forEach(mark); show(); }
      float.open(); place(false);
      if (isOnLoad) return;
      wheels[form.firstPart()].el.focus({ preventScroll: true });
    }
    function close(returnFocus) { float.close(returnFocus); }
    field.addEventListener("click", function () { if (!isOpen()) open(); else close(false); });
    if (isInPlace) { if (form.opening && !form.isComplete()) open(true); else requestAnimationFrame(function () { place(false); }); }
    show();
    // A form that needs it won't go on without a pick: the field says so and the wheels open.
    var owner = root.closest("form");
    if (owner && root.hasAttribute("data-required")) owner.addEventListener("submit", function (event) {
      if (form.isComplete()) return;
      event.preventDefault(); field.classList.add("is-marked"); error.hidden = false; if (hint) hint.hidden = true; open();
    });
  });
})();
`;

const FIELD_STYLES = `
/* Fields: the header's search field, bigger. A cut field of clearer glass with a drawn outline and a line icon saying what goes in it;
   pointing clears it a little, and typing in it whitens it and draws the outline in orange. Words are 16px, so phones don't zoom in. */
.cut-field { display: flex; flex-direction: column; gap: var(--gap-words-control); }
/* Its words (label, error, hint) keep a pane's margin, --pad-words in from its box, which sits at the frame gap. */
.cut-field > label { font: var(--type-label); color: var(--ink-2); }
/* It's a carving you type in (materials.ts): its face, its height, its words' room and its states are the carving's. */
.field { --control-height: var(--control-height-field); display: flex; align-items: center; color: var(--muted); }
/* Its width never follows what's in it or the font it's shown in (a hidden password's dots are larger): a card's width where its pane fits
   what's in it, the pane's width where that's wider, never past it. */
.cut-field > .field:not(.select, .long) { width: var(--size-card); min-width: 100%; max-width: 100%; }
/* Its face is a layer of its own under its words (the field's ::before), so the words can fade out at an end with more of them past it
   (more-left and more-right, FIELD_SCRIPT) instead of being cut off hard there, while the face stays whole. */
.field > input { --text-start: calc(var(--pad-inside-words) + 34px); --text-end: 16px; }
.field input { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%;
  font: 500 1.125rem var(--display); color: var(--ink); caret-color: var(--run-lo); clip-path: var(--cut-shape); }
.field input:focus-visible, .field.is-focused input { outline: none; border: 0; }
:is(.field, .find) > input { --fade-start: 0px; --fade-end: 0px; }
:is(.field, .find).more-left > input { --fade-start: 24px; }
:is(.field, .find).more-right > input { --fade-end: 24px; }
:is(.field, .find):is(.more-left, .more-right) > input {
  -webkit-mask-image: linear-gradient(90deg, transparent var(--text-start), #000 calc(var(--text-start) + var(--fade-start)), #000 calc(100% - var(--text-end) - var(--fade-end)), transparent calc(100% - var(--text-end)));
  mask-image: linear-gradient(90deg, transparent var(--text-start), #000 calc(var(--text-start) + var(--fade-start)), #000 calc(100% - var(--text-end) - var(--fade-end)), transparent calc(100% - var(--text-end))); }
.field input::placeholder { color: var(--muted); }
/* A hidden password's dots: the display face's are too small to count, so they're Verdana's, larger and a little apart. */
.field input[type="password"]:not(:placeholder-shown) { font-family: Verdana, var(--body); font-size: 1.375rem; letter-spacing: 0.12em; }
.field input:-webkit-autofill { -webkit-text-fill-color: var(--ink); transition: background-color 600000s 0s; }
.field > .ico { position: absolute; z-index: 3; left: var(--pad-inside-words); width: 20px; height: 20px; pointer-events: none; transition: color var(--motion-state); }
.field:has(:focus-visible), .field.is-focused { color: var(--ink); }
.field > .cut-line { z-index: 4; }
.field > .cut-line polygon { stroke: var(--field-outline); }
.field:has(:focus-visible) > .cut-line polygon, .field.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.field.is-marked > .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
.field-error { margin: 0; font: var(--type-words); color: var(--marked); }
.field-hint { margin: 0; font: var(--type-note); color: var(--muted); }
/* No icon: its words start where an icon would, so they still line up with the pane's words. */
.field.no-icon > input { --text-start: var(--pad-inside-words); }
/* Show/Hide: a small secondary button, a toggle, at the field's end, as far in from its end as from its top and bottom. Its words change and its
   width doesn't, so what's typed keeps exactly the room it leaves: the toggle's width and its inset on each side. */
.field { --toggle-inset: calc((var(--control-height-field) - var(--control-height-small)) / 2); }
.field.with-toggle { --toggle-width: 62px; }
.field.with-toggle > .cut-btn > .face { width: var(--toggle-width); padding: 0; }
.field.with-toggle > input { --text-end: calc(var(--toggle-width) + 2 * var(--toggle-inset)); }
.field > .cut-btn { position: absolute; z-index: 5; right: var(--toggle-inset); top: var(--toggle-inset); }
/* Read-only: nothing to type, so it doesn't light as you point at it; it can still be selected, copied and focused. */
.field:has(> input[readonly])::before { --face-color: var(--carving-face); }
/* Can't be changed now: carved the same, its words and icon quieter, and it answers no pointer. */
.field:has(input:disabled) { color: var(--muted); pointer-events: none; }
.field input:disabled { color: var(--muted); -webkit-text-fill-color: var(--muted); opacity: 1; }
.field:has(> input:disabled)::before { --face-color: var(--off-face); }
`;

component({
  name: "Cut field",
  slug: "cut-field",
  group: "inputs",
  subgroup: "fields",
  summary: "Anything you type: a username, an email, a password. Its icon says what goes in; what's wrong is said under it, in words.",
  styles: FIELD_STYLES,
  render: cutField,
  examples: [
    { label: "Empty", markup: examplePane(cutField({ id: "example-username-empty", name: "username", label: "Username", type: "text", icon: "person", autocomplete: "username" })) },
    { label: "Typed", markup: examplePane(cutField({ id: "example-username-typed", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r" })) },
    { label: "Focused", markup: examplePane(cutField({ id: "example-email-focused", name: "email", label: "Email", type: "email", icon: "mail", placeholder: "you@example.com", state: "is-focused" })), isStill: true },
    { label: "Password hidden", markup: examplePane(cutField({ id: "example-password-hidden", name: "password", label: "Password", type: "password", icon: "lock", text: "correct-horse" })) },
    { label: "Password shown", markup: examplePane(cutField({ id: "example-password-shown", name: "password", label: "Password", type: "password", icon: "lock", text: "correct-horse", isPasswordShown: true })) },
    { label: "With a hint", markup: examplePane(cutField({ id: "example-password-hint", name: "password", label: "Password", type: "password", icon: "lock", hint: "At least 8 characters. A few words you'll remember work well." })) },
    { label: "Error", markup: examplePane(cutField({ id: "example-username-error", name: "username", label: "Username", type: "text", icon: "person", text: "emma r", error: "Use letters, numbers and _ only, with no spaces." })) },
    {
      label: "Error, in its hint's place",
      markup: examplePane(cutField({ id: "example-password-error", name: "password", label: "Password", type: "password", icon: "lock", text: "sofia", hint: "At least 8 characters. A few words you'll remember work well.", error: "That's 5 characters. Use at least 8." })),
    },
    { label: "A long value", markup: examplePane(cutField({ id: "example-email-long", name: "email", label: "Email", type: "email", icon: "mail", text: "sofia.lindqvist-montgomery@northern-lights-studio.example" })) },
    {
      label: "Only a room code's characters, 6 at most: try typing or pasting",
      markup: examplePane(cutField({ id: "example-room-code", name: "room", label: "Have a room code?", type: "text", placeholder: "ABC234", autocomplete: "off", pattern: "[2-9A-HJ-NP-Z]{6}", characterPattern: "[2-9A-HJ-NP-Z]", maximumCharacterCount: 6, isUppercase: true, isRequired: true })),
    },
    { label: "No icon", markup: examplePane(cutField({ id: "example-title", name: "title", label: "Title", type: "text", text: "Ashen Crown" })) },
    { label: "Read-only", markup: examplePane(cutField({ id: "example-username-read-only", name: "username", label: "Username", type: "text", icon: "person", text: "liam_hart", isReadOnly: true })) },
    { label: "Can't change now", markup: examplePane(cutField({ id: "example-email-disabled", name: "email", label: "Email", type: "email", icon: "mail", text: "emma@example.com", isDisabled: true })), isStill: true },
  ],
});

component({
  name: "PIN field",
  slug: "pin-field",
  group: "inputs",
  subgroup: "fields",
  summary: "A PIN, one box for each digit, in one row that fills its pane. Digits only, hidden as they're typed; the cursor moves on by itself, and when the last digit goes in the PIN is sent, so there's no button to press. A wrong PIN is said under the boxes.",
  styles: `
/* A PIN field: a label over a row of cut fields, one digit each. The boxes are fields (their face, outline, focus and marked amber are the
   cut field's), at a field's height in an equal Row; each is at least a small control wide, so the row has a width in a pane that fits what's
   in it and shares the pane's in one that doesn't. What's typed sits in the middle. */
.pin-field { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); min-width: 0; }
.pin-field > legend { margin-bottom: var(--gap-words-control); font: var(--type-label); color: var(--ink-2); }
.pin-box { flex: 1 1 0; width: auto; min-width: var(--control-height-small); }
/* One digit, centered in its box with no start or end room and no fade at the edges. The browser's own dot is too small to count at a
   glance, so the typed digit is clear and the box draws its own dot in the middle once it's filled. */
.pin-field .pin-box.field > input { --text-start: 0px; --text-end: 0px; padding: 0; text-align: center; color: transparent; caret-color: var(--ink); -webkit-mask-image: none; mask-image: none; }
.pin-box:has(> input:not(:placeholder-shown))::after { content: ""; position: absolute; z-index: 3; left: 50%; top: 50%; width: 14px; height: 14px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--ink); pointer-events: none; }
.pin-box:has(> input:not(:placeholder-shown)) > input { caret-color: transparent; }
`,
  render: pinField,
  examples: [
    { label: "Empty", markup: examplePane(pinField({ id: "example-pin-empty", name: "purchase_pin", label: "Purchase PIN" })) },
    { label: "Part way in", markup: examplePane(pinField({ id: "example-pin-partly", name: "purchase_pin", label: "Purchase PIN", digits: "482" })) },
    { label: "Keyboard focus", markup: examplePane(pinField({ id: "example-pin-focused", name: "purchase_pin", label: "Purchase PIN", digits: "482", state: "is-focused" })), isStill: true },
    { label: "Marked wrong, with its error under it", markup: examplePane(pinField({ id: "example-pin-wrong", name: "purchase_pin", label: "Purchase PIN", error: "That PIN isn't right. 4 tries left." })), isStill: true },
    { label: "Sent, waiting", markup: examplePane(pinField({ id: "example-pin-busy", name: "purchase_pin", label: "Purchase PIN", digits: "482913", isDisabled: true })), isStill: true },
  ],
});

/** Finishes the gallery's search offers: genres, and the stand-in games' names. */
const STAND_IN_FINISHES = ["action", "adventure", "ashen crown", "ashen crown co-op", "ashen crown the long night", "frostline", "glasswing", "hollow tide", "horror", "iron vigil", "iron vigil siege", "kestrel", "neon drift", "neon drift ranked", "racing", "role-playing", "roguelike", "shooter", "simulation", "sports", "strategy", "survival", "verdant"];

/** Games the gallery's search finds, from the stand-in covers (panes.ts's STAND_IN_GAMES; that file imports this one, so they're named here). */
const SEARCH_STAND_IN_GAMES = [
  { slug: "ashen-crown", title: "Ashen Crown", playerCount: 1204 },
  { slug: "neon-drift", title: "Neon Drift", playerCount: 3870 },
  { slug: "hollow-tide", title: "Hollow Tide", playerCount: 412 },
  { slug: "iron-vigil", title: "Iron Vigil", playerCount: 8214 },
  { slug: "frostline", title: "Frostline", playerCount: 2290 },
  { slug: "kestrel", title: "Kestrel", playerCount: 1730 },
];

/** The gallery's answer to a search's suggestionsUrl (/design/examples/search-suggestions): finishes and the stand-in games for what's typed. Data, not markup, so it's no component's render. */
const suggestionsFor = (typed: string): SearchSuggestions => {
  const search = typed.trim().toLowerCase();
  if (!search) return { finishes: [], games: [] };
  return {
    finishes: STAND_IN_FINISHES.filter((finish) => finish.startsWith(search) && finish !== search).slice(0, 3),
    games: SEARCH_STAND_IN_GAMES.filter((game) => game.title.toLowerCase().includes(search))
      .slice(0, 3)
      .map((game) => ({ title: game.title, page_url: "#search-field", cover_url: `/design/covers/${game.slug}.webp`, fact: `${game.playerCount.toLocaleString("en-US")} playing` })),
  };
};
export const SEARCH_STAND_IN = { suggestionsFor };

component({
  name: "Search field",
  slug: "search-field",
  group: "inputs",
  subgroup: "fields",
  summary: "Search on a page, and in the header. \"/\" jumps to it there, and nothing says so.",
  styles: `
/* Search: the cut field's sibling, at a control's height (it sits in the header's row). The same face, carving and shade, the same
   brightening under the pointer and whitening with the orange outline as you type, the same icon (20px, quiet until you're in it), indent
   and words (18px, 16 on a phone). Clear, a small tertiary button, sits at its end once something's typed, so the browser's own clear button is hidden. "/" jumps to it. */
.find { --control-height: var(--control-height-regular); --search-end-room: 16px; --clear-inset: calc((var(--control-height) - var(--control-height-small)) / 2); display: flex; align-items: center; flex: 1; max-width: 460px; margin: 0; color: var(--muted); }
.find input[type="search"] {
  --text-start: calc(var(--pad-inside-words) + 34px); --text-end: var(--search-end-room);
  position: relative; z-index: 2; width: 100%;
  font: 500 1.125rem var(--display); color: var(--ink); caret-color: var(--run-lo); clip-path: var(--cut-shape);
}
/* It's a layered carving you type in, as a cut field is (materials.ts). */
.find input::placeholder { color: var(--muted); }
.find input:focus-visible, .find.is-focused input { outline: none; }
.find:has(:focus-visible), .find.is-focused { color: var(--ink); }
.find > .cut-line { z-index: 4; }
.find > .cut-line polygon { stroke: var(--field-outline); }
.find:has(:focus-visible) > .cut-line polygon, .find.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.find input::-webkit-search-cancel-button { display: none; }
.find > .ico { position: absolute; z-index: 3; left: var(--pad-inside-words); width: 20px; height: 20px; pointer-events: none; transition: color var(--motion-state); }
/* Clear: a small tertiary button, square, only once something's typed. It sits as far in from the end as from the top and foot, measured on
   the search, whose height it is (Clear has a height of its own); what's typed stops short of it, so its room is the search's height. */
.find > .tertiary-btn { position: absolute; z-index: 5; top: var(--clear-inset); right: var(--clear-inset); }
.find:has(input:placeholder-shown) > .tertiary-btn { display: none; }
.find:not(:has(input:placeholder-shown)) { --search-end-room: var(--control-height); }
/* Finishes and games as you type (suggestionsUrl, SEARCH_SCRIPT): a select field's list hangs under it. The row you're on catches the
   light, and when it's a finish, the rest of it shows after what's typed, quieter, in the field itself: Tab takes it, Enter takes it and
   searches. On a game, Enter opens the game. */
.find-finish { position: absolute; z-index: 2; inset: 0 var(--search-end-room) 0 calc(var(--pad-inside-words) + 34px); display: flex; align-items: center; overflow: hidden; white-space: pre; pointer-events: none;
  font: 500 1.125rem var(--display); color: var(--muted); }
.find-finish > .find-typed { visibility: hidden; }
.find-list .select-option { text-decoration: none; }
.find-list .select-option b { font-weight: 600; color: var(--ink); }
.find-list .select-option > .find-row-icon { flex: none; display: inline-flex; color: var(--muted); }
.find-row-icon > .ico { width: 18px; height: 18px; }
.find-list .select-option.is-active .find-row-icon { color: var(--ink); }
.find-head { margin: 8px 0 2px; font: var(--type-note); color: var(--muted); }
.find-game > img { flex: none; width: 64px; height: 36px; object-fit: cover; background: var(--well); }
.find-game-words { display: grid; gap: 2px; min-width: 0; }
.find-game-fact { font: var(--type-note); color: var(--muted); }
/* Shown open in place (the gallery's open state): hanging under the field, over what follows it. */
.find > .find-list.in-place { position: absolute; z-index: 6; top: calc(100% + 6px); left: 0; right: 0; }
`,
  render: searchField,
  examples: [
    { label: "Rest", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games" })}</div>` },
    { label: "Focused, typed: Clear at its end", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "rally", placeholder: "Search games", label: "Search games", state: "is-focused" })}</div>`, isStill: true },
    { label: "Typed, a long search", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "open world survival with co-op, base building and a long story", placeholder: "Search games", label: "Search games" })}</div>` },
    {
      label: "Finishes and games as you type: try ash, neon or iron, then the arrows, Tab and Enter",
      markup: html`<div style="width:min(460px,100%)">${searchField({ id: "example-find-try", action: "#search-field", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games", suggestionsUrl: "/design/examples/search-suggestions" })}</div>`,
    },
    {
      label: "Open: the first finish in the field",
      markup: html`<div style="width:min(460px,100%);min-height:22rem">${searchField({ id: "example-find-open", action: "#search-field", name: "search_text", searchText: "ash", placeholder: "Search games", label: "Search games", state: "is-open", shownSuggestions: SEARCH_STAND_IN.suggestionsFor("ash") })}</div>`,
      isStill: true,
    },
  ],
});

const HOURS_ROWS = [0, 1, 2, 3].map((hourCount) => ({ label: `${hourCount} h`, rowValue: String(hourCount) }));
const MINUTE_ROWS = Array.from({ length: 12 }, (_, rowIndex) => ({ label: `${String(rowIndex * 5).padStart(2, "0")} min`, rowValue: String(rowIndex * 5) }));
const MATCH_LENGTH: WheelColumn[] = [{ name: "match_hours", label: "Hours", rows: HOURS_ROWS, pickedValue: "1" }, { name: "match_minutes", label: "Minutes", rows: MINUTE_ROWS, pickedValue: "30" }];

component({
  name: "Wheel field",
  slug: "wheel-field",
  group: "inputs",
  subgroup: "fields",
  // Beside the Select field: both open their own pane over the field.
  after: "select-field",
  summary: "A value made of parts read together, picked on wheels: a birthday (starting blank, so nothing suggests an age), when something happens (in your own time zone, which it says), or wheels of a page's own, like a match's length. One of many from a list is a Select field; a number on a scale, a Slider.",
  styles: `
/* A wheel field: the same cut field, with what it picks said by its icon; open, it's whitened with the orange outline, like a field you're
   typing in. With no icon its words start where an icon would. */
.wheel-field { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); min-width: 0; }
/* A legend sits outside its fieldset's flex, so it takes the gap as a margin. */
.wheel-field legend { margin-bottom: var(--gap-words-control); font: var(--type-label); color: var(--ink-2); }
.wheel-button { display: flex; align-items: center; justify-content: space-between; gap: var(--gap-words-words); width: 100%; --text-start: calc(var(--pad-inside-words) + 34px); --text-end: var(--pad-inside-words); cursor: pointer; text-align: left;
  font: 500 1.125rem var(--display); color: var(--muted); }
.wheel-button[aria-expanded="true"], .wheel-button:focus-visible { outline: none; --face-color: var(--carving-face-focus); }
.wheel-button.set { color: var(--ink); font-weight: 500; }
.wheel-button > .ico { position: absolute; left: var(--pad-inside-words); top: 50%; width: 20px; height: 20px; transform: translateY(-50%); color: var(--muted); }
.wheel-button[aria-expanded="true"] > .ico, .wheel-button.set > .ico { color: var(--ink); }
.wheel-chev { display: inline-flex; flex: none; margin-right: 4px; color: var(--ink); transition: transform var(--motion-arrive) var(--ease-glide); }
.wheel-chev > .ico { width: 16px; height: 10px; stroke-width: 2.2; }
/* Only the chevron turns when the picker opens; the outline and the icon stay still. */
.wheel-button[aria-expanded="true"] .wheel-chev { transform: rotate(180deg); }
.wheel-button > .cut-line { z-index: 4; }
.wheel-button > .cut-line polygon { stroke: var(--field-outline); }
.wheel-button[aria-expanded="true"] > .cut-line polygon, .wheel-button:focus-visible > .cut-line polygon, .wheel-button.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.wheel-button.is-marked > .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
/* Its words stay on one line, never crowding its edges; its chevron keeps the same inset from its end as its icon from its start, so a long
   date ("Jan 15, 2027, 1:30 PM") fits a phone. What's wrong is said under it, as under a cut field. */
.wheel-value { flex: 1; }
.wheel-button > span { position: relative; z-index: 2; }
.wheel-button.no-icon { --text-start: var(--pad-inside-words); }
/* The picker: a pane of the menus' glass, as a select field's list is, opening over the field with the wheels' middle row on the field's own
   line, so the picks sit where its words were (WHEEL_SCRIPT places it, moved only to stay in the window). Each wheel is a groove carved
   into it three rows tall; the picked row in the middle catches the light, as a pointed list row does (its glass clears, its edge lit above
   and shaded below), with a row above and below it, quieter. The wheel you're on by keyboard draws the focus line round its groove. */
.floating-pane.wheel-pick { gap: var(--gap-words-words); }
/* What a screen reader hears takes no room, so the wheels keep the same room to the pane's edge all round. */
.wheel-pick > .wheel-read { position: absolute; }
/* Each wheel is at least as wide as its longest row (a month's name, a year, "Tomorrow", "25 min") with its room each side, so a pane that
   fits what's in it grows to them. */
.wheels { --wheel-row: 36px; position: relative; display: grid; grid-template-columns: repeat(3, auto); gap: var(--gap-control-row); }
.wheel-channel { min-width: 0; height: calc(3 * var(--wheel-row)); }
.wheel-lit { position: absolute; z-index: 1; left: 3px; right: 3px; top: var(--wheel-row); bottom: var(--wheel-row); pointer-events: none; }
.wheel-channel > .cut-line { z-index: 3; pointer-events: none; }
.wheel-channel:has(> .wheel:focus-visible) > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* The wheel scrolls inside its groove, the picked row snapped to the middle; the rows above and below fade toward the groove's ends. */
.wheel { position: relative; z-index: 2; height: 100%; overflow-y: auto; overscroll-behavior: contain; scroll-snap-type: y mandatory; scroll-padding-top: var(--wheel-row);
  scrollbar-width: none; padding: var(--wheel-row) 0; box-sizing: border-box; outline: none;
  -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0.4), #000 33%, #000 67%, rgba(0,0,0,0.4));
  mask-image: linear-gradient(180deg, rgba(0,0,0,0.4), #000 33%, #000 67%, rgba(0,0,0,0.4)); }
.wheel::-webkit-scrollbar { display: none; }
/* A row is as wide as it is picked, in bold (its label again, unseen and unheard, holds that width), with the room words get inside a
   control each side, so the lit slab never touches its words and the pane doesn't change size as the pick moves. */
.wheel [role="option"] { --row-height: var(--wheel-row); --row-start: var(--pad-inside-words); --row-end: var(--pad-inside-words); flex-direction: column; align-items: center; justify-content: center; scroll-snap-align: start;
  clip-path: none; white-space: nowrap; font: 500 1rem var(--display); color: var(--ink-2); cursor: pointer; user-select: none; -webkit-user-select: none; transition: color var(--motion-state), font-size var(--motion-state); }
.wheel [role="option"].blank { color: var(--muted); font-weight: 400; }
.wheel [role="option"][aria-selected="true"] { color: var(--ink); font-weight: 600; }
.wheel [role="option"][aria-selected="true"].blank { color: var(--muted); font-weight: 500; }
.wheel [role="option"]::after { content: attr(data-label) / ""; height: 0; overflow: hidden; visibility: hidden; font-weight: 600; }
/* A date and time says its time zone under it. Custom wheels share the width evenly, each as wide as the widest. */
.wheel-zone { margin: var(--gap-words-control) 0 var(--pad-words); font: var(--type-facts); color: var(--muted); }
.wheel-zone:empty { display: none; }
.date-time-wheels { grid-template-columns: repeat(4, auto); }
.custom-wheels { grid-template-columns: repeat(var(--wheel-count), 1fr); }
/* On a phone what's typed or picked is 16px, the least that keeps a phone from zooming in, so more of it fits: in a cut field, a search, a
   wheel field's. Set here, after each of those fields' own font, so it holds on every one. */
@media (max-width: 760px) { .field input, .find input[type="search"], .find-finish, .wheel-button { font-size: 1rem; } }
`,
  render: wheelField,
  examples: [
    { label: "Birthday: closed", markup: examplePane(wheelField({ id: "example-bday-closed", name: "birthday", label: "When's your birthday?", wheelKind: "birthday" })) },
    { label: "Birthday: open", markup: examplePane(wheelField({ id: "example-bday-open", name: "birthday", label: "When's your birthday?", wheelKind: "birthday", state: "open" })) },
    { label: "Birthday: picked", markup: examplePane(wheelField({ id: "example-bday-picked", name: "birthday", label: "When's your birthday?", wheelKind: "birthday", pickedValue: "2004-03-14" })) },
    { label: "Birthday: with a hint", markup: examplePane(wheelField({ id: "example-bday-hint", name: "birthday", label: "When's your birthday?", wheelKind: "birthday", hint: "Your birthday is never shown to anyone." })) },
    { label: "Birthday: none picked", markup: examplePane(wheelField({ id: "example-bday-marked", name: "birthday", label: "When's your birthday?", wheelKind: "birthday", hint: "Your birthday is never shown to anyone.", state: "marked" })), isStill: true },
    { label: "Keyboard focus", markup: examplePane(wheelField({ id: "example-bday-focused", name: "birthday", label: "When's your birthday?", wheelKind: "birthday", state: "is-focused" })), isStill: true },
    { label: "Date and time: closed", markup: examplePane(wheelField({ id: "example-when-closed", name: "publish_at", label: "Go live", wheelKind: "date-time" })) },
    { label: "Date and time: open", markup: examplePane(wheelField({ id: "example-when-open", name: "publish_at", label: "Go live", wheelKind: "date-time", state: "open" })) },
    { label: "Date and time: picked", markup: examplePane(wheelField({ id: "example-when-picked", name: "publish_at", label: "Go live", wheelKind: "date-time", pickedValue: "2027-01-15T18:30+00:00" })) },
    {
      label: "Not before a set time: an earlier pick moves up to it",
      markup: examplePane(wheelField({ id: "example-when-minimum", name: "publish_at", label: "Go live", wheelKind: "date-time", pickedValue: "2027-01-04T14:00+00:00", minimumAt: "2027-01-11T14:00+00:00", state: "open" })),
    },
    { label: "Date and time: a time that's passed", markup: examplePane(wheelField({ id: "example-when-error", name: "publish_at", label: "Go live", wheelKind: "date-time", pickedValue: "2026-10-01T15:00+00:00", error: "That time has passed. Pick a later one." })), isStill: true },
    { label: "Custom wheels: a match's length", markup: examplePane(wheelField({ id: "example-match-length", name: "match_length", label: "How long a match runs", wheelKind: "custom", icon: "clock", columns: MATCH_LENGTH })) },
    { label: "Custom wheels: open", markup: examplePane(wheelField({ id: "example-match-length-open", name: "match_length", label: "How long a match runs", wheelKind: "custom", icon: "clock", columns: MATCH_LENGTH, state: "open" })) },
  ],
});
