import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, icon, type IconName } from "./foundations.ts";
import { cutButton } from "./actions.ts";
import { examplePane } from "./example-pane.ts";

/*
 * Fields: the cut field, search, the birthday wheels and the date and time picker. From the sign-in draft (fields, the
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
  const className = ["field", "cut-carved", options.icon ? "" : "no-icon", isPassword ? "with-toggle" : "", options.error ? "is-marked" : "", options.state ?? ""].filter(Boolean).join(" ");
  const inputType = isPassword && options.isPasswordShown ? "text" : options.type;
  return controlMarkup(html`<div class="cut-field"><label for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}${options.icon ? icon(options.icon) : ""}<input id="${id}" name="${options.name}" type="${inputType}"${options.text !== undefined ? html` value="${options.text}"` : ""}${options.placeholder ? html` placeholder="${options.placeholder}"` : ""}${options.autocomplete ? html` autocomplete="${options.autocomplete}"` : ""}${options.type === "email" || options.name === "username" ? raw(' autocapitalize="off" spellcheck="false"') : ""}${options.inputMode ? html` inputmode="${options.inputMode}"` : ""}${options.isRequired ? raw(" required") : ""}${options.isReadOnly ? raw(" readonly") : ""}${options.isDisabled ? raw(" disabled") : ""}${options.error ? html` aria-invalid="true" aria-describedby="${errorId}"` : options.hint ? html` aria-describedby="${hintId}"` : ""}>${isPassword ? cutButton(options.isPasswordShown ? "Hide" : "Show", { type: "button", isSmall: true, isPressed: Boolean(options.isPasswordShown), controls: id, isDisabled: options.isDisabled }) : ""}</span>
${options.error ? html`<p class="field-error" id="${errorId}">${options.error}</p>` : options.hint ? html`<p class="field-hint" id="${hintId}">${options.hint}</p>` : ""}</div>`, "field", { hasOwnWords: true });
}

export interface SearchFieldOptions {
  action: string;
  name: string;
  searchText: string;
  placeholder: string;
  label: string;
  /** Fields the search keeps, like the forum's category. */
  keep?: Record<string, string>;
  /** The gallery's fixed focus. */
  state?: "is-focused";
}

/**
 * Search: the cut field's sibling, a control's height (it sits in the header's row): the same face, carving, icon, indent and words, and a
 * Clear button at its end once something's typed. "/" jumps to it in the header.
 */
export function searchField(options: SearchFieldOptions): ControlMarkup {
  return controlMarkup(html`<form class="find cut-carved${options.state ? ` ${options.state}` : ""}" method="get" action="${options.action}" role="search" data-cut-line="10">${CUT_LINE}${Object.entries(options.keep ?? {}).map(([name, keptValue]) => html`<input type="hidden" name="${name}" value="${keptValue}">`)}${icon("search")}<input type="search" name="${options.name}" value="${options.searchText}" maxlength="200" placeholder="${options.placeholder}" aria-label="${options.label}" autocomplete="off">${cutButton("Clear the search", { type: "button", icon: "close", isLabelHidden: true, isInWell: true })}</form>`, "regular");
}

export interface BirthdayFieldOptions {
  name: string;
  label: string;
  /** Unique on the page. Defaults to bday-<name>. */
  id?: string;
  /** A picked date, YYYY-MM-DD. */
  birthday?: string;
  /** What to know about it, under the field, quieter, as under a cut field (its id is <id>-hint): "Your birthday is never shown to anyone." An error takes its place. */
  hint?: string;
  /** What's wrong, under the field, marked, as under a cut field: what the page says when it comes back from its form. Picking a whole date takes it away. */
  error?: string;
  /** "open" shows the wheels, "marked" says to pick one to go on, "is-focused" is it reached by keyboard: the gallery's fixed states. */
  state?: "open" | "marked" | "is-focused";
  isRequired?: boolean;
}

/** What a birthday field says when its form won't go on without one. */
const BIRTHDAY_MISSING = "Pick your birthday to go on.";

/** One field that opens three glass wheels, month, day and year, under a lit band. Each starts blank, so nothing suggests an age. */
export function birthdayField(options: BirthdayFieldOptions): ControlMarkup {
  const id = options.id ?? `bday-${options.name}`;
  const isOpen = options.state === "open";
  const isMarked = options.state === "marked" || Boolean(options.error);
  const fieldClass = ["bday-field", "cut-carved", isMarked ? "is-marked" : "", options.state === "is-focused" ? "is-focused" : ""].filter(Boolean).join(" ");
  return controlMarkup(html`<fieldset class="bday" data-birthday${options.isRequired ? raw(" data-required") : ""}>
<legend id="${id}-legend">${options.label}</legend>
<button type="button" class="${fieldClass}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${id}-error${options.hint ? ` ${id}-hint` : ""}">${CUT_LINE}${icon("calendar")}<span class="bday-value">Choose a date</span><span class="bday-chev">${icon("chevron-down")}</span></button>
<p class="field-error" id="${id}-error"${isMarked ? "" : raw(" hidden")}>${options.error ?? BIRTHDAY_MISSING}</p>${options.hint ? html`<p class="field-hint" id="${id}-hint"${isMarked ? raw(" hidden") : ""}>${options.hint}</p>` : ""}
<div class="bday-pick" data-cut-line="10" id="${id}-pick" role="group" aria-label="${options.label}"${isOpen ? "" : raw(" hidden")}>
<div class="wheels"><span class="wheel-band cut-raised" data-cut-line="8" aria-hidden="true"></span><div class="wheel" data-own-fade data-part="month" role="listbox" aria-label="Month" tabindex="0"></div><div class="wheel" data-own-fade data-part="day" role="listbox" aria-label="Day" tabindex="0"></div><div class="wheel" data-own-fade data-part="year" role="listbox" aria-label="Year" tabindex="0"></div></div>
<span class="bday-read sr" aria-live="polite"></span>
</div>
<input type="hidden" name="${options.name}" value="${options.birthday ?? ""}" data-id="${id}">
</fieldset>`, "field", { hasOwnWords: true });
}

export interface DateTimeFieldOptions {
  name: string;
  label: string;
  /** Unique on the page. Defaults to when-<name>. */
  id?: string;
  /** A picked time, ISO 8601 with its offset: 2026-10-23T15:30+02:00. */
  pickedAt?: string;
  /** The earliest time it takes, ISO 8601 with its offset; earlier picks move up to it. Defaults to now. */
  minimumAt?: string;
  /** What's wrong, under the field, marked, as under a cut field: "That time has passed. Pick a later one." The field shows the time it was sent with until you pick another, which takes the error away. */
  error?: string;
  /** "open" shows the wheels: the gallery's fixed state. */
  state?: "open";
}

/**
 * A date and time field, for scheduling (a version going live later): the birthday field's look, opening three wheels under the lit band, the
 * day ("Today", "Tomorrow", "Fri, Oct 23"), the hour with its AM or PM ("3 PM": every hour of the day on one wheel, so none hides), and
 * the minute in fives, all in the viewer's own time zone, said under it.
 * It submits ISO 8601 with the viewer's offset (DATE_TIME_SCRIPT fills it in).
 */
export function dateTimeField(options: DateTimeFieldOptions): ControlMarkup {
  const id = options.id ?? `when-${options.name}`;
  const isOpen = options.state === "open";
  const wheel = (part: string, label: string) => html`<div class="wheel" data-own-fade data-part="${part}" role="listbox" aria-label="${label}" tabindex="0"></div>`;
  return controlMarkup(html`<fieldset class="bday" data-date-time${options.minimumAt ? html` data-minimum-at="${options.minimumAt}"` : ""}>
<legend id="${id}-legend">${options.label}</legend>
<button type="button" class="bday-field cut-carved${options.error ? " is-marked" : ""}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${options.error ? `${id}-error ` : ""}${id}-zone">${CUT_LINE}${icon("clock")}<span class="bday-value">Choose a time</span><span class="bday-chev">${icon("chevron-down")}</span></button>
${options.error ? html`<p class="field-error" id="${id}-error">${options.error}</p>` : ""}<p class="date-time-zone" id="${id}-zone"></p>
<div class="bday-pick" data-cut-line="10" id="${id}-pick" role="group" aria-label="${options.label}"${isOpen ? "" : raw(" hidden")}>
<div class="wheels date-time-wheels"><span class="wheel-band cut-raised" data-cut-line="8" aria-hidden="true"></span>${wheel("day", "Day")}${wheel("hour", "Hour")}${wheel("minute", "Minute")}</div>
<span class="bday-read sr" aria-live="polite"></span>
</div>
<input type="hidden" name="${options.name}" value="${options.pickedAt ?? ""}" data-id="${id}">
</fieldset>`, "field", { hasOwnWords: true });
}

/** Show/Hide: shows the password it controls, and hides it again. Clear: empties a search and puts you back in it. */
export const FIELD_SCRIPT = `/* fields */(function () {
  document.addEventListener("click", function (event) {
    var clear = event.target.closest && event.target.closest(".find > .cut-btn");
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
 * The date and time picker: three wheels in the viewer's time zone, the day a year ahead from the earliest it takes. It starts on the time
 * given, or, when nothing is, the next whole hour once it opens. A pick earlier than the earliest moves up to it. Scroll, tap, or use the
 * keys (arrows, Page Up and Down, Home and End). It writes ISO 8601 with the viewer's offset into the hidden input.
 */
export const DATE_TIME_SCRIPT = `/* date and time */(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ROW = 40, DAY_MS = 86400000, FIVE_MS = 300000;
  var HOURS = [], MINUTES = [];
  for (var h = 0; h < 24; h++) HOURS.push((h % 12 || 12) + (h < 12 ? " AM" : " PM"));
  for (var m = 0; m < 60; m += 5) MINUTES.push(String(m).padStart(2, "0"));
  function two(n) { return String(n).padStart(2, "0"); }
  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function iso(date) {
    var offset = -date.getTimezoneOffset(), sign = offset < 0 ? "-" : "+", whole = Math.abs(offset);
    return date.getFullYear() + "-" + two(date.getMonth() + 1) + "-" + two(date.getDate()) + "T" + two(date.getHours()) + ":" + two(date.getMinutes()) + sign + two(Math.floor(whole / 60)) + ":" + two(whole % 60);
  }
  function zoneName(date) {
    try { var part = new Intl.DateTimeFormat("en-US", { timeZoneName: "long" }).formatToParts(date).find(function (each) { return each.type === "timeZoneName"; }); return part ? part.value : ""; } catch (error) { return ""; }
  }
  window.zaismaWatch.each("[data-date-time]", function (root) {
    var field = root.querySelector(".bday-field"), pick = root.querySelector(".bday-pick"), shown = root.querySelector(".bday-value"), zone = root.querySelector(".date-time-zone");
    var read = root.querySelector(".bday-read"), hidden = root.querySelector('input[type="hidden"]'), id = hidden.getAttribute("data-id");
    // The earliest it takes, at a five-minute step; the day wheel starts on its day.
    var minimum = root.hasAttribute("data-minimum-at") ? new Date(root.getAttribute("data-minimum-at")) : new Date();
    if (isNaN(minimum)) minimum = new Date();
    minimum = new Date(Math.ceil(minimum.getTime() / FIVE_MS) * FIVE_MS);
    var firstDay = startOfDay(minimum), days = [];
    for (var d = 0; d < 366; d++) days.push(new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + d));
    var today = startOfDay(new Date()).getTime(), thisYear = new Date().getFullYear();
    function dayWords(day) {
      var gap = Math.round((day.getTime() - today) / DAY_MS);
      if (gap === 0) return "Today";
      if (gap === 1) return "Tomorrow";
      // Next year's days say their year instead of their weekday, so they fit the wheel.
      return day.toLocaleDateString("en-US", day.getFullYear() === thisYear ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
    }
    var picked = { day: 0, hour: 0, minute: 0 }, isSet = false;
    function timeOf(at) { var day = days[at.day]; return new Date(day.getFullYear(), day.getMonth(), day.getDate(), at.hour, at.minute * 5); }
    function pickedOf(date) {
      var dayIndex = Math.max(0, Math.min(days.length - 1, Math.round((startOfDay(date).getTime() - firstDay.getTime()) / DAY_MS)));
      return { day: dayIndex, hour: date.getHours(), minute: Math.floor(date.getMinutes() / 5) };
    }
    var given = hidden.value ? new Date(hidden.value) : null, error = root.querySelector(".field-error");
    // Sent back with an error (a time that's passed): the field keeps saying the time it was sent with, marked, until another is picked.
    var sentAt = given && !isNaN(given) && field.classList.contains("is-marked") ? given : null;
    if (given && !isNaN(given)) { picked = pickedOf(given < minimum ? minimum : given); isSet = true; }
    var wheels = {
      day: { el: root.querySelector('[data-part="day"]'), items: days.map(dayWords) },
      hour: { el: root.querySelector('[data-part="hour"]'), items: HOURS },
      minute: { el: root.querySelector('[data-part="minute"]'), items: MINUTES }
    };
    function mark(part) {
      var w = wheels[part], at = picked[part];
      Array.prototype.forEach.call(w.el.children, function (option, i) { option.setAttribute("aria-selected", String(i === at)); });
      w.el.setAttribute("aria-activedescendant", id + "-" + part + "-" + at);
    }
    Object.keys(wheels).forEach(function (part) {
      var w = wheels[part];
      w.items.forEach(function (text, i) {
        var option = document.createElement("div");
        option.setAttribute("role", "option"); option.id = id + "-" + part + "-" + i; option.textContent = text;
        option.addEventListener("click", function () { pickRow(part, i, true); });
        w.el.appendChild(option);
      });
      mark(part);
    });
    function place(isGliding) { Object.keys(wheels).forEach(function (part) { wheels[part].el.scrollTo({ top: picked[part] * ROW, behavior: isGliding && !reduce ? "smooth" : "auto" }); }); }
    function pickRow(part, i, isGliding) {
      i = Math.max(0, Math.min(wheels[part].items.length - 1, i));
      wheels[part].el.scrollTo({ top: i * ROW, behavior: isGliding && !reduce ? "smooth" : "auto" });
      setRow(part, i);
    }
    function setRow(part, i) {
      if (picked[part] === i && isSet) return;
      picked[part] = i; isSet = true;
      if (sentAt) { sentAt = null; field.classList.remove("is-marked"); if (error) error.hidden = true; }
      // Earlier than it takes: every wheel moves up to the earliest.
      if (timeOf(picked) < minimum) { picked = pickedOf(minimum); Object.keys(wheels).forEach(mark); place(true); }
      else mark(part);
      show();
    }
    function show() {
      var at = timeOf(picked);
      zone.textContent = "Your time" + (zoneName(at) ? ": " + zoneName(at) : "");
      if (!isSet) { shown.textContent = "Choose a time"; field.classList.remove("set"); hidden.value = ""; read.textContent = ""; return; }
      if (sentAt) at = sentAt;
      var timeWords = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      // The field says it short (Today, Oct 23, or Jan 15, 2027 in another year), its month in words so no player reads it the other way
      // round, and it fits a phone; the wheels and the screen reader say it whole.
      var day = sentAt ? startOfDay(sentAt) : days[picked.day], gap = Math.round((day.getTime() - today) / DAY_MS);
      var shortDay = gap === 0 ? "Today" : gap === 1 ? "Tomorrow" : day.toLocaleDateString("en-US", day.getFullYear() === thisYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
      shown.textContent = shortDay + ", " + timeWords; field.classList.add("set");
      read.textContent = at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " at " + timeWords;
      hidden.value = iso(at);
    }
    Object.keys(wheels).forEach(function (part) {
      var w = wheels[part], timer = null;
      // When a scroll comes to rest, the row under the band is the one picked.
      w.el.addEventListener("scroll", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { if (!pick.hidden) setRow(part, Math.round(w.el.scrollTop / ROW)); }, 110);
      }, { passive: true });
      w.el.addEventListener("keydown", function (event) {
        var at = picked[part], step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[event.key];
        if (step) { pickRow(part, at + step, true); event.preventDefault(); return; }
        if (event.key === "Home") { pickRow(part, 0, true); event.preventDefault(); return; }
        if (event.key === "End") { pickRow(part, w.items.length - 1, true); event.preventDefault(); return; }
        if (event.key === "Enter") { close(true); event.preventDefault(); }
      });
    });
    function open() {
      // Nothing picked yet: it starts on the next whole hour, or the earliest it takes.
      if (!isSet) { var next = new Date(); next.setMinutes(60, 0, 0); picked = pickedOf(next < minimum ? minimum : next); isSet = true; Object.keys(wheels).forEach(mark); show(); }
      pick.hidden = false; field.setAttribute("aria-expanded", "true"); place(false);
      wheels.day.el.focus({ preventScroll: true });
      pick.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
    function close(returnFocus) { pick.hidden = true; field.setAttribute("aria-expanded", "false"); if (returnFocus) field.focus(); }
    field.addEventListener("click", function () { if (pick.hidden) open(); else close(false); });
    pick.addEventListener("keydown", function (event) { if (event.key === "Escape") { close(true); event.preventDefault(); } });
    if (!pick.hidden) { if (!isSet) open(); else requestAnimationFrame(function () { place(false); }); }
    show();
  });
})();
`;

/**
 * The birthday picker. Each wheel starts on its blank row; scroll, tap, or use the keys (arrows, Page Up and Down,
 * Home and End, or type the month's name, the day or the year). 29 February only in a leap year. A form with a
 * required birthday won't go on without one: the field says so and the wheels open.
 */
export const BIRTHDAY_SCRIPT = `/* birthday */(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var ROW = 40, THIS_YEAR = new Date().getFullYear();
  var HINT = window.matchMedia("(pointer: coarse)").matches ? "Swipe each wheel to pick." : "Scroll or type to pick each one.";
  var years = []; for (var yr = THIS_YEAR; yr > THIS_YEAR - 100; yr--) years.push(String(yr));
  function daysIn(month, year) { return month ? new Date(year || 2000, month, 0).getDate() : 31; }
  window.zaismaWatch.each("[data-birthday]", function (root) {
    var field = root.querySelector(".bday-field"), pick = root.querySelector(".bday-pick"), value = root.querySelector(".bday-value"), error = root.querySelector(".field-error"), hint = root.querySelector(".field-hint");
    var read = root.querySelector(".bday-read"), hidden = root.querySelector('input[type="hidden"]'), id = hidden.getAttribute("data-id");
    var birthday = { month: 0, day: 0, year: 0 }; // 0 is the blank row
    var given = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(hidden.value);
    if (given) { birthday.month = Number(given[2]); birthday.day = Number(given[3]); birthday.year = Math.max(0, years.indexOf(given[1]) + 1); }
    read.textContent = HINT;
    var wheels = {
      month: { el: root.querySelector('[data-part="month"]'), blank: "Month", items: function () { return MONTHS; } },
      day: { el: root.querySelector('[data-part="day"]'), blank: "Day", items: function () { var n = daysIn(birthday.month, birthday.year ? Number(years[birthday.year - 1]) : 0), list = []; for (var i = 1; i <= n; i++) list.push(String(i)); return list; } },
      year: { el: root.querySelector('[data-part="year"]'), blank: "Year", items: function () { return years; } }
    };
    function fill(part) {
      var w = wheels[part], list = [w.blank].concat(w.items());
      w.count = list.length;
      w.el.textContent = "";
      list.forEach(function (text, i) {
        var option = document.createElement("div");
        option.setAttribute("role", "option"); option.id = id + "-" + part + "-" + i; option.textContent = text;
        if (i === 0) option.className = "blank";
        option.addEventListener("click", function () { pickRow(part, i, true); });
        w.el.appendChild(option);
      });
      mark(part);
    }
    function mark(part) {
      var w = wheels[part], at = birthday[part];
      Array.prototype.forEach.call(w.el.children, function (option, i) { option.setAttribute("aria-selected", String(i === at)); });
      w.el.setAttribute("aria-activedescendant", id + "-" + part + "-" + at);
    }
    function pickRow(part, i, glide) {
      var w = wheels[part];
      i = Math.max(0, Math.min(w.count - 1, i));
      w.el.scrollTo({ top: i * ROW, behavior: glide && !reduce ? "smooth" : "auto" });
      setValue(part, i);
    }
    function setValue(part, i) {
      if (birthday[part] === i) return;
      birthday[part] = i;
      mark(part);
      if (part !== "day") { // the day wheel follows the month and year: 29 February only in a leap year
        fill("day");
        if (birthday.day > wheels.day.count - 1) { birthday.day = wheels.day.count - 1; mark("day"); }
        wheels.day.el.scrollTop = birthday.day * ROW;
      }
      show();
    }
    function text() { return MONTHS[birthday.month - 1] + " " + birthday.day + ", " + years[birthday.year - 1]; }
    // The field shows it short (Feb 3, 2022), its month in words so no player reads it the other way round; the picker's foot says it in full.
    function shortText() { return MONTHS[birthday.month - 1].slice(0, 3) + " " + birthday.day + ", " + years[birthday.year - 1]; }
    function complete() { return birthday.month && birthday.day && birthday.year; }
    function show() {
      var done = complete();
      read.textContent = done ? text() : HINT;
      if (done) {
        value.textContent = shortText(); field.classList.add("set"); field.classList.remove("is-marked"); error.hidden = true; if (hint) hint.hidden = false;
        hidden.value = years[birthday.year - 1] + "-" + String(birthday.month).padStart(2, "0") + "-" + String(birthday.day).padStart(2, "0");
      } else if (!field.classList.contains("is-marked")) { value.textContent = "Choose a date"; field.classList.remove("set"); hidden.value = ""; }
      else { field.classList.remove("set"); hidden.value = ""; }
    }
    Object.keys(wheels).forEach(function (part) {
      var w = wheels[part], timer = null, typed = "", typedAt = 0;
      fill(part);
      // When a scroll comes to rest, the row under the band is the one picked.
      w.el.addEventListener("scroll", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { setValue(part, Math.round(w.el.scrollTop / ROW)); }, 110);
      }, { passive: true });
      w.el.addEventListener("keydown", function (event) {
        var at = birthday[part], key = event.key, step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[key];
        if (step) { pickRow(part, at + step, true); event.preventDefault(); return; }
        if (key === "Home") { pickRow(part, 1, true); event.preventDefault(); return; }
        if (key === "End") { pickRow(part, w.count - 1, true); event.preventDefault(); return; }
        if (key === "Enter" && complete()) { close(true); event.preventDefault(); return; }
        if (key.length !== 1 || event.metaKey || event.ctrlKey) return;
        var now = Date.now(); typed = now - typedAt > 900 ? key.toLowerCase() : typed + key.toLowerCase(); typedAt = now;
        var list = [w.blank].concat(w.items()), hit = -1;
        for (var i = 1; i < list.length && hit < 0; i++) if (list[i].toLowerCase().indexOf(typed) === 0) hit = i;
        if (part === "year" && hit < 0 && /^\\d{2}$/.test(typed)) { // two digits: the nearest year ending in them
          for (var j = 1; j < list.length && hit < 0; j++) if (list[j].slice(2) === typed) hit = j;
        }
        if (hit > 0) { pickRow(part, hit, true); event.preventDefault(); }
      });
    });
    function place() { Object.keys(wheels).forEach(function (part) { wheels[part].el.scrollTop = birthday[part] * ROW; }); }
    function open() {
      pick.hidden = false; field.setAttribute("aria-expanded", "true"); place();
      wheels[complete() ? "month" : !birthday.month ? "month" : !birthday.day ? "day" : "year"].el.focus({ preventScroll: true });
      pick.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
    function close(returnFocus) { pick.hidden = true; field.setAttribute("aria-expanded", "false"); if (returnFocus) field.focus(); }
    field.addEventListener("click", function () { if (pick.hidden) open(); else close(false); });
    pick.addEventListener("keydown", function (event) { if (event.key === "Escape") { close(true); event.preventDefault(); } });
    if (!pick.hidden) requestAnimationFrame(place);
    show();
    // The account can't go on without a birthday: say so on the field and open the wheels.
    var form = root.closest("form");
    if (form && root.hasAttribute("data-required")) form.addEventListener("submit", function (event) {
      if (complete()) return;
      event.preventDefault(); field.classList.add("is-marked"); error.textContent = ${JSON.stringify(BIRTHDAY_MISSING)}; error.hidden = false; if (hint) hint.hidden = true; open();
    });
  });
})();
`;

const FIELD_STYLES = `
/* Fields: the header's search field, bigger. A cut field of clearer glass with a drawn outline and a line icon saying what goes in it;
   pointing clears it a little, and typing in it whitens it and draws the outline in orange. Words are 16px, so phones don't zoom in. */
.cut-field { display: flex; flex-direction: column; gap: var(--gap-words-control); }
/* Its words (label, error, hint) keep a pane's margin, --pad-words in from its box, which sits at the frame gap. */
.cut-field > label { padding-inline: var(--pad-words); font: var(--type-label); color: var(--ink-2); }
.field { --control-height: var(--control-height-field); position: relative; display: flex; align-items: center; height: var(--control-height); color: var(--muted); }
/* Its face is a layer of its own under its words (the field's ::before), so the words can fade out at an end with more of them past it
   (more-left and more-right, FIELD_SCRIPT) instead of being cut off hard there, while the face stays whole. */
.field > input { --text-start: calc(var(--pad-inside-words) + 34px); --text-end: 16px; }
.field input { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%; height: 100%; padding: 0 var(--text-end) 0 var(--text-start);
  font: 500 18px var(--display); color: var(--ink); caret-color: var(--run-lo);
  background: transparent; border: 0; border-radius: 0; clip-path: var(--cut-shape); }
.field:has(> input)::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; --face-color: var(--field-face); background: var(--face-color);
  box-shadow: var(--field-shade); clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.field:has(> input):hover::before { --face-color: var(--field-hover); }
.field:has(> input:focus)::before, .field.is-focused::before { --face-color: var(--field-focus); }
.field input:focus, .field.is-focused input { outline: none; border: 0; }
:is(.field, .find) > input { --fade-start: 0px; --fade-end: 0px; }
:is(.field, .find).more-left > input { --fade-start: 24px; }
:is(.field, .find).more-right > input { --fade-end: 24px; }
:is(.field, .find):is(.more-left, .more-right) > input {
  -webkit-mask-image: linear-gradient(90deg, transparent var(--text-start), #000 calc(var(--text-start) + var(--fade-start)), #000 calc(100% - var(--text-end) - var(--fade-end)), transparent calc(100% - var(--text-end)));
  mask-image: linear-gradient(90deg, transparent var(--text-start), #000 calc(var(--text-start) + var(--fade-start)), #000 calc(100% - var(--text-end) - var(--fade-end)), transparent calc(100% - var(--text-end))); }
.field input::placeholder { color: var(--muted); }
.field input:-webkit-autofill { -webkit-text-fill-color: var(--ink); transition: background-color 600000s 0s; }
.field > .ico { position: absolute; z-index: 3; left: var(--pad-inside-words); width: 20px; height: 20px; pointer-events: none; transition: color 0.25s; }
.field:focus-within, .field.is-focused { color: var(--ink); }
.field > .cut-line { z-index: 4; }
.field > .cut-line polygon { stroke: var(--field-outline); }
.field:focus-within > .cut-line polygon, .field.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.field.is-marked > .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
.field-error { margin: 0; padding-inline: var(--pad-words); font: var(--type-words); color: var(--marked); }
.field-hint { margin: 0; padding-inline: var(--pad-words); font: var(--type-note); color: var(--muted); }
/* No icon: its words start where an icon would, so they still line up with the pane's words. */
.field.no-icon > input { --text-start: var(--pad-inside-words); }
/* Show/Hide: a small cut button, a toggle, at the field's end, as far in from its end as from its top and bottom. Its words change and its
   width doesn't, so what's typed keeps exactly the room it leaves: the toggle's width and its inset on each side. */
.field { --toggle-inset: calc((var(--control-height-field) - var(--control-height-small)) / 2); }
.field.with-toggle { --toggle-width: 62px; }
.field.with-toggle > .cut-btn > .face { width: var(--toggle-width); padding: 0; }
.field.with-toggle > input { --text-end: calc(var(--toggle-width) + 2 * var(--toggle-inset)); }
.field > .cut-btn { position: absolute; z-index: 5; right: var(--toggle-inset); top: var(--toggle-inset); }
/* Read-only: nothing to type, so it's carved into the glass like a code field instead of a field's lighter face; it can still be selected,
   copied and focused. */
.field:has(> input[readonly])::before { --face-color: var(--well); box-shadow: var(--well-shade); }
/* Can't be changed now: carved the same, its words and icon quieter, and it answers no pointer. */
.field:has(input:disabled) { color: var(--muted); pointer-events: none; }
.field input:disabled { color: var(--muted); -webkit-text-fill-color: var(--muted); opacity: 1; }
.field:has(> input:disabled)::before { --face-color: var(--off-face); box-shadow: var(--well-shade); }
`;

component({
  name: "Cut field",
  slug: "cut-field",
  group: "inputs",
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
    { label: "No icon", markup: examplePane(cutField({ id: "example-title", name: "title", label: "Title", type: "text", text: "Ashen Crown" })) },
    { label: "Read-only", markup: examplePane(cutField({ id: "example-username-read-only", name: "username", label: "Username", type: "text", icon: "person", text: "liam_hart", isReadOnly: true })) },
    { label: "Can't change now", markup: examplePane(cutField({ id: "example-email-disabled", name: "email", label: "Email", type: "email", icon: "mail", text: "emma@example.com", isDisabled: true })), isStill: true },
  ],
});

component({
  name: "Search field",
  slug: "search-field",
  group: "inputs",
  summary: "Search on a page, and in the header. \"/\" jumps to it there, and nothing says so.",
  styles: `
/* Search: the cut field's sibling, at a control's height (it sits in the header's row). The same face, carving and shade, the same
   brightening under the pointer and whitening with the orange outline as you type, the same icon (20px, quiet until you're in it), indent
   and words (18px, 16 on a phone). Clear sits at its end once something's typed: an icon in a well of its own, filling the field's height
   for a finger, so the browser's own clear button is hidden. "/" jumps to it. */
.find { --control-height: var(--control-height-regular); --search-end-room: 16px; position: relative; display: flex; align-items: center; flex: 1; max-width: 460px; height: var(--control-height); margin: 0; color: var(--muted); }
.find input[type="search"] {
  --text-start: calc(var(--pad-inside-words) + 34px); --text-end: var(--search-end-room);
  position: relative; z-index: 2; width: 100%; height: 100%; padding: 0 var(--text-end) 0 var(--text-start);
  font: 500 18px var(--display); color: var(--ink); caret-color: var(--run-lo);
  background: transparent; border: 0; border-radius: 0; clip-path: var(--cut-shape);
}
/* Its face is a layer under its words, as a cut field's is, so its words fade at an end with more past it. */
.find::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; --face-color: var(--field-face); background: var(--face-color);
  box-shadow: var(--field-shade); clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.find:hover::before { --face-color: var(--field-hover); }
.find input::placeholder { color: var(--muted); }
.find input:focus, .find.is-focused input { outline: none; }
.find:has(> input:focus)::before, .find.is-focused::before { --face-color: var(--field-focus); }
.find:focus-within, .find.is-focused { color: var(--ink); }
.find > .cut-line { z-index: 4; }
.find > .cut-line polygon { stroke: var(--field-outline); }
.find:focus-within > .cut-line polygon, .find.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.find input::-webkit-search-cancel-button { display: none; }
.find > .ico { position: absolute; z-index: 3; left: var(--pad-inside-words); width: 20px; height: 20px; pointer-events: none; transition: color 0.25s; }
/* Clear: only once something's typed, and then what's typed stops short of it: its width (46px) and its inset on each side. */
.find > .cut-btn { position: absolute; z-index: 5; top: 0; bottom: 0; right: calc((var(--control-height) - 30px) / 2); align-items: center; }
.find:has(input:placeholder-shown) > .cut-btn { display: none; }
.find:not(:has(input:placeholder-shown)) { --search-end-room: calc(46px + var(--control-height) - 30px); }
`,
  render: searchField,
  examples: [
    { label: "Rest", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games" })}</div>` },
    { label: "Focused, typed: Clear at its end", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "rally", placeholder: "Search games", label: "Search games", state: "is-focused" })}</div>`, isStill: true },
    { label: "Typed, a long search", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "open world survival with co-op, base building and a long story", placeholder: "Search games", label: "Search games" })}</div>` },
  ],
});

component({
  name: "Birthday field",
  slug: "birthday-field",
  group: "inputs",
  summary: "Asking for a birthday: three wheels that start blank, so nothing suggests an age.",
  styles: `
/* The birthday field: the same cut field, with a calendar icon; open, it's whitened with the orange outline, like a field you're typing in. */
.bday { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); min-width: 0; }
/* A legend sits outside its fieldset's flex, so it takes the gap as a margin. */
.bday legend { padding: 0 var(--pad-words); margin-bottom: var(--gap-words-control); font: var(--type-label); color: var(--ink-2); }
.bday-field { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--gap-words-words); width: 100%; height: var(--control-height-field); padding: 0 var(--pad-inside-words) 0 calc(var(--pad-inside-words) + 34px); border: 0; cursor: pointer; text-align: left;
  font: 500 18px var(--display); color: var(--muted); --face-color: var(--field-face); background: var(--face-color); box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.bday-field:hover { --face-color: var(--field-hover); }
.bday-field[aria-expanded="true"], .bday-field:focus-visible, .bday-field.is-focused { outline: none; --face-color: var(--field-focus); }
.bday-field.set { color: var(--ink); font-weight: 500; }
.bday-field > .ico { position: absolute; left: var(--pad-inside-words); top: 50%; width: 20px; height: 20px; transform: translateY(-50%); color: var(--muted); }
.bday-field[aria-expanded="true"] > .ico, .bday-field.set > .ico { color: var(--ink); }
.bday-chev { display: inline-flex; flex: none; margin-right: 4px; color: var(--ink); transition: transform 0.4s cubic-bezier(.2,.7,.2,1); }
.bday-chev > .ico { width: 16px; height: 10px; stroke-width: 2.2; }
/* Only the chevron turns when the picker opens; the outline and the icon stay still. */
.bday-field[aria-expanded="true"] .bday-chev { transform: rotate(180deg); }
.bday-field .cut-line { z-index: 4; }
.bday-field .cut-line polygon { stroke: var(--field-outline); }
.bday-field[aria-expanded="true"] .cut-line polygon, .bday-field:focus-visible .cut-line polygon, .bday-field.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.bday-field.is-marked .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
/* Its words stay on one line, never crowding its edges; its chevron keeps the same inset from its end as its icon from its start, so a long
   date ("Jan 15, 2027, 1:30 PM") fits a phone. What's wrong is said under it, as under a cut field. */
.bday-value { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bday-field > span { position: relative; z-index: 2; }
/* The picker: a well of clearer glass holding three wheels under a white band with the orange line. The picked value is larger; the others fade
   toward the edges. The wheel you're on by keyboard draws the focus line round its part of the band, closing on the band's own line, so
   there's one line under the value, never two. */
.bday-pick { position: relative; margin-top: 0; padding: var(--pad-inner-pane); border: 0; background: var(--pick); box-shadow: var(--pick-shade);
  clip-path: var(--cut-shape); }
/* The month gets the room its longest name needs (September), the day the least. */
.wheels { position: relative; display: grid; grid-template-columns: 1.9fr 0.7fr 1fr; gap: 4px; padding: 0 6px; }
/* The band sits on the wheels' top row, so nothing blank sits above it: the value you've picked is at the top, the rest follow below it, fading. */
.wheel-band { position: absolute; left: 0; right: 0; top: 0; height: 40px; pointer-events: none;
  background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run);
  clip-path: var(--cut-shape); }
.wheel { position: relative; height: 160px; overflow-y: auto; overscroll-behavior: contain;
  scroll-snap-type: y mandatory; scrollbar-width: none; padding: 0 0 120px; box-sizing: border-box; outline: none;
  -webkit-mask-image: linear-gradient(180deg, #000 0, #000 30%, rgba(0,0,0,0.45) 70%, transparent);
  mask-image: linear-gradient(180deg, #000 0, #000 30%, rgba(0,0,0,0.45) 70%, transparent); }
.wheel::-webkit-scrollbar { display: none; }
.wheel [role="option"] { height: 40px; display: flex; align-items: center; justify-content: center; scroll-snap-align: start;
  font: 500 16px var(--display); color: var(--ink-2); cursor: pointer; user-select: none; -webkit-user-select: none; transition: color 0.2s, font-size 0.2s; }
.wheel [role="option"].blank { color: var(--muted); font-weight: 400; }
.wheel [role="option"][aria-selected="true"] { font-size: 18px; color: var(--ink); font-weight: 600; }
.wheel [role="option"][aria-selected="true"].blank { color: var(--muted); font-weight: 500; }
.wheel:focus-visible [role="option"][aria-selected="true"] { outline: 2px solid var(--focus); outline-offset: -2px; }
/* Done: a cut slab of clearer glass; it whitens with the orange line when you point at it, once there's a whole date. */
`,
  render: birthdayField,
  examples: [
    { label: "Closed", markup: examplePane(birthdayField({ id: "example-bday-closed", name: "birthday", label: "When's your birthday?" })) },
    { label: "Keyboard focus", markup: examplePane(birthdayField({ id: "example-bday-focused", name: "birthday", label: "When's your birthday?", state: "is-focused" })), isStill: true },
    { label: "Open", markup: examplePane(birthdayField({ id: "example-bday-open", name: "birthday", label: "When's your birthday?", state: "open" })) },
    { label: "Picked", markup: examplePane(birthdayField({ id: "example-bday-picked", name: "birthday", label: "When's your birthday?", birthday: "2004-03-14" })) },
    { label: "With a hint", markup: examplePane(birthdayField({ id: "example-bday-hint", name: "birthday", label: "When's your birthday?", hint: "Your birthday is never shown to anyone." })) },
    { label: "Error: none picked", markup: examplePane(birthdayField({ id: "example-bday-marked", name: "birthday", label: "When's your birthday?", hint: "Your birthday is never shown to anyone.", state: "marked" })), isStill: true },
  ],
});

component({
  name: "Date and time field",
  slug: "date-time-field",
  group: "inputs",
  summary: "Picking when something happens, like a version going live: the birthday field's wheels for the day, the hour (with its AM or PM) and the minute, in your own time zone, which it says.",
  styles: `
/* The date and time field: the birthday field with a clock, and the time zone said under it. The day wheel gets the room "Jan 15, 2027" needs,
   the hour "12 PM". */
.date-time-zone { margin: 0; padding-inline: var(--pad-words); font: var(--type-facts); color: var(--muted); }
.date-time-zone:empty { display: none; }
.date-time-wheels { grid-template-columns: 2.5fr 1.1fr 0.7fr; }
/* The picked day stays at the wheel's own size, so a long one ("Jan 15, 2027") still fits a phone. */
.date-time-wheels [role="option"] { white-space: nowrap; }
.date-time-wheels [role="option"][aria-selected="true"] { font-size: 16px; }
/* On a phone what's typed or picked is 16px, the least that keeps a phone from zooming in, so more of it fits: in a cut field, a search, a
   birthday's and a date's. Set here, after each of those fields' own font, so it holds on every one. */
@media (max-width: 760px) { .field input, .find input[type="search"], .bday-field { font-size: 16px; } }
`,
  render: dateTimeField,
  examples: [
    { label: "Closed", markup: examplePane(dateTimeField({ id: "example-when-closed", name: "publish_at", label: "Go live" })) },
    { label: "Open", markup: examplePane(dateTimeField({ id: "example-when-open", name: "publish_at", label: "Go live", state: "open" })) },
    { label: "Picked", markup: examplePane(dateTimeField({ id: "example-when-picked", name: "publish_at", label: "Go live", pickedAt: "2027-01-15T18:30+00:00" })) },
    {
      label: "Not before a set time: an earlier pick moves up to it",
      markup: examplePane(dateTimeField({ id: "example-when-minimum", name: "publish_at", label: "Go live", pickedAt: "2027-01-04T14:00+00:00", minimumAt: "2027-01-11T14:00+00:00", state: "open" })),
    },
    { label: "Error: a time that's passed", markup: examplePane(dateTimeField({ id: "example-when-error", name: "publish_at", label: "Go live", pickedAt: "2026-10-01T15:00+00:00", error: "That time has passed. Pick a later one." })), isStill: true },
  ],
});
