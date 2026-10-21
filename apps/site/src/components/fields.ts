import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, ICONS, icon, type IconName } from "./foundations.ts";
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
  icon: IconName;
  /** Its id, for the label; unique on the page. Defaults to field-<name>. */
  id?: string;
  /** What it holds already. */
  text?: string;
  placeholder?: string;
  autocomplete?: string;
  isRequired?: boolean;
  /** What's wrong, under the field: the marked state, as when Next won't go on. */
  error?: string;
  /** A password that starts shown (Show pressed). */
  isPasswordShown?: boolean;
  /** The gallery's fixed focus, so it sits still. */
  state?: "is-focused";
}

/** A cut field of clearer glass with a drawn outline and a line icon saying what goes in it. A password gets Show. */
export function cutField(options: CutFieldOptions): Raw {
  const id = options.id ?? `field-${options.name}`;
  const isPassword = options.type === "password";
  const errorId = `${id}-error`;
  const className = ["field", "cut-carved", isPassword ? "with-toggle" : "", options.error ? "is-marked" : "", options.state ?? ""].filter(Boolean).join(" ");
  const inputType = isPassword && options.isPasswordShown ? "text" : options.type;
  return html`<div class="cut-field"><label for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}${icon(options.icon)}<input id="${id}" name="${options.name}" type="${inputType}"${options.text !== undefined ? html` value="${options.text}"` : ""}${options.placeholder ? html` placeholder="${options.placeholder}"` : ""}${options.autocomplete ? html` autocomplete="${options.autocomplete}"` : ""}${options.type === "email" || options.name === "username" ? raw(' autocapitalize="off" spellcheck="false"') : ""}${options.isRequired ? raw(" required") : ""}${options.error ? html` aria-invalid="true" aria-describedby="${errorId}"` : ""}>${isPassword ? cutButton(options.isPasswordShown ? "Hide" : "Show", { type: "button", isSmall: true, isPressed: Boolean(options.isPasswordShown), controls: id }) : ""}</span>
${options.error ? html`<p class="field-error" id="${errorId}">${options.error}</p>` : ""}</div>`;
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

/** Search: a cut field of clearer glass. "/" jumps to it in the header. */
export function searchField(options: SearchFieldOptions): Raw {
  return html`<form class="find cut-carved${options.state ? ` ${options.state}` : ""}" method="get" action="${options.action}" role="search" data-cut-line="10">${Object.entries(options.keep ?? {}).map(([name, keptValue]) => html`<input type="hidden" name="${name}" value="${keptValue}">`)}<input type="search" name="${options.name}" value="${options.searchText}" maxlength="200" placeholder="${options.placeholder}" aria-label="${options.label}" autocomplete="off">${raw(ICONS.search.replace('class="ico"', 'class="ico glass-icon"'))}${CUT_LINE}</form>`;
}

export interface BirthdayFieldOptions {
  name: string;
  label: string;
  /** Unique on the page. Defaults to bday-<name>. */
  id?: string;
  /** A picked date, YYYY-MM-DD. */
  birthday?: string;
  /** "open" shows the wheels, "marked" says to pick one to go on: the gallery's fixed states. */
  state?: "open" | "marked";
  isRequired?: boolean;
}

/** One field that opens three glass wheels, month, day and year, under a lit band. Each starts blank, so nothing suggests an age. */
export function birthdayField(options: BirthdayFieldOptions): Raw {
  const id = options.id ?? `bday-${options.name}`;
  const isOpen = options.state === "open";
  const isMarked = options.state === "marked";
  return html`<fieldset class="bday" data-birthday${options.isRequired ? raw(" data-required") : ""}>
<legend id="${id}-legend">${options.label}</legend>
<button type="button" class="bday-field cut-carved${isMarked ? " is-marked" : ""}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${id}-error">${CUT_LINE}${icon("calendar")}<span class="bday-value">Choose a date</span><span class="bday-chev">${icon("chevron-down")}</span></button>
<p class="field-error" id="${id}-error"${isMarked ? "" : raw(" hidden")}>Pick your birthday to go on.</p>
<div class="bday-pick" data-cut-line="10" id="${id}-pick" role="group" aria-label="${options.label}"${isOpen ? "" : raw(" hidden")}>
<div class="wheels"><span class="wheel-band cut-raised" data-cut-line="8" aria-hidden="true"></span><div class="wheel" data-own-fade data-part="month" role="listbox" aria-label="Month" tabindex="0"></div><div class="wheel" data-own-fade data-part="day" role="listbox" aria-label="Day" tabindex="0"></div><div class="wheel" data-own-fade data-part="year" role="listbox" aria-label="Year" tabindex="0"></div></div>
<span class="bday-read sr" aria-live="polite"></span>
</div>
<input type="hidden" name="${options.name}" value="${options.birthday ?? ""}" data-id="${id}">
</fieldset>`;
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
  /** "open" shows the wheels: the gallery's fixed state. */
  state?: "open";
}

/**
 * A date and time field, for scheduling (a version going live later): the birthday field's look, opening three wheels under the lit band, the
 * day ("Today", "Tomorrow", "Fri, Oct 23"), the hour with its AM or PM ("3 PM": every hour of the day on one wheel, so none hides), and
 * the minute in fives, all in the viewer's own time zone, said under it.
 * It submits ISO 8601 with the viewer's offset (DATE_TIME_SCRIPT fills it in).
 */
export function dateTimeField(options: DateTimeFieldOptions): Raw {
  const id = options.id ?? `when-${options.name}`;
  const isOpen = options.state === "open";
  const wheel = (part: string, label: string) => html`<div class="wheel" data-own-fade data-part="${part}" role="listbox" aria-label="${label}" tabindex="0"></div>`;
  return html`<fieldset class="bday" data-date-time${options.minimumAt ? html` data-minimum-at="${options.minimumAt}"` : ""}>
<legend id="${id}-legend">${options.label}</legend>
<button type="button" class="bday-field cut-carved" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${id}-zone">${CUT_LINE}${icon("clock")}<span class="bday-value">Choose a time</span><span class="bday-chev">${icon("chevron-down")}</span></button>
<p class="date-time-zone" id="${id}-zone"></p>
<div class="bday-pick" data-cut-line="10" id="${id}-pick" role="group" aria-label="${options.label}"${isOpen ? "" : raw(" hidden")}>
<div class="wheels date-time-wheels"><span class="wheel-band cut-raised" data-cut-line="8" aria-hidden="true"></span>${wheel("day", "Day")}${wheel("hour", "Hour")}${wheel("minute", "Minute")}</div>
<span class="bday-read sr" aria-live="polite"></span>
</div>
<input type="hidden" name="${options.name}" value="${options.pickedAt ?? ""}" data-id="${id}">
</fieldset>`;
}

/** Show/Hide: shows the password it controls, and hides it again. */
export const FIELD_SCRIPT = `/* fields */(function () {
  document.addEventListener("click", function (event) {
    var show = event.target.closest && event.target.closest(".field:not(.code) > .cut-btn[aria-controls]");
    if (!show) return;
    var input = document.getElementById(show.getAttribute("aria-controls")); if (!input) return;
    var on = input.type === "password";
    input.type = on ? "text" : "password";
    // Only its words change: the slab and its drawn edge stay.
    show.querySelector(".face > span").textContent = on ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(on));
  });
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
  document.querySelectorAll("[data-date-time]").forEach(function (root) {
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
    var given = hidden.value ? new Date(hidden.value) : null;
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
      // Earlier than it takes: every wheel moves up to the earliest.
      if (timeOf(picked) < minimum) { picked = pickedOf(minimum); Object.keys(wheels).forEach(mark); place(true); }
      else mark(part);
      show();
    }
    function show() {
      var at = timeOf(picked);
      zone.textContent = "Your time" + (zoneName(at) ? ": " + zoneName(at) : "");
      if (!isSet) { shown.textContent = "Choose a time"; field.classList.remove("set"); hidden.value = ""; read.textContent = ""; return; }
      var timeWords = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      // The field says it short (Today, 10/23, or 1/15/2027 in another year), so it fits a phone; the wheels and the screen reader say it whole.
      var day = days[picked.day], gap = Math.round((day.getTime() - today) / DAY_MS);
      var shortDay = gap === 0 ? "Today" : gap === 1 ? "Tomorrow" : (day.getMonth() + 1) + "/" + day.getDate() + (day.getFullYear() === thisYear ? "" : "/" + day.getFullYear());
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
  document.querySelectorAll("[data-birthday]").forEach(function (root) {
    var field = root.querySelector(".bday-field"), pick = root.querySelector(".bday-pick"), value = root.querySelector(".bday-value"), error = root.querySelector(".field-error");
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
    // The field shows it short (2/3/2022); the picker's foot says it in full.
    function shortText() { return birthday.month + "/" + birthday.day + "/" + years[birthday.year - 1]; }
    function complete() { return birthday.month && birthday.day && birthday.year; }
    function show() {
      var done = complete();
      read.textContent = done ? text() : HINT;
      if (done) {
        value.textContent = shortText(); field.classList.add("set"); field.classList.remove("is-marked"); error.hidden = true;
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
      event.preventDefault(); field.classList.add("is-marked"); error.hidden = false; open();
    });
  });
})();
`;

const FIELD_STYLES = `
/* Fields: the header's search field, bigger. A cut field of clearer glass with a drawn outline and a line icon saying what goes in it;
   pointing clears it a little, and typing in it whitens it and draws the outline in orange. Words are 16px, so phones don't zoom in. */
.cut-field { display: flex; flex-direction: column; gap: var(--gap-words-control); }
.cut-field > label { font: var(--type-label); color: var(--ink-2); }
.field { position: relative; display: flex; align-items: center; height: 52px; color: var(--muted); }
.field input { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%; height: 100%; padding: 0 16px 0 52px;
  font: 500 18px var(--display); color: var(--ink); caret-color: var(--run-lo); text-overflow: ellipsis;
  --face-color: var(--field-face); background: var(--face-color); border: 0; border-radius: 0; box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.field:hover input { --face-color: var(--field-hover); }
.field input:focus, .field.is-focused input { outline: none; --face-color: var(--field-focus); border: 0; }
.field input::placeholder { color: var(--muted); }
.field input:-webkit-autofill { -webkit-text-fill-color: var(--ink); transition: background-color 600000s 0s; }
.field > .ico { position: absolute; z-index: 3; left: 18px; width: 20px; height: 20px; pointer-events: none; transition: color 0.25s; }
.field:focus-within, .field.is-focused { color: var(--ink); }
.field > .cut-line { z-index: 4; }
.field > .cut-line polygon { stroke: var(--field-outline); }
.field:focus-within > .cut-line polygon, .field.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.field.is-marked > .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
.field-error { margin: 0; font: var(--type-words); color: var(--marked); }
.field.with-toggle input { padding-right: 90px; }
/* Show/Hide: a small cut button, a toggle, at the field's end. */
.field > .cut-btn { position: absolute; z-index: 5; right: 8px; top: 8px; }
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
    { label: "Error", markup: examplePane(cutField({ id: "example-username-error", name: "username", label: "Username", type: "text", icon: "person", text: "emma r", error: "Use letters, numbers and _ only, with no spaces." })) },
  ],
});

component({
  name: "Search field",
  slug: "search-field",
  group: "inputs",
  summary: "Search on a page, and in the header. \"/\" jumps to it there, and nothing says so.",
  styles: `
/* Search: a cut field of clearer glass. "/" jumps to it. */
.find { position: relative; flex: 1; max-width: 460px; height: 44px; margin: 0; }
.find input[type="search"] {
  width: 100%; height: 100%; padding: 0 16px 0 44px;
  font: 500 16px var(--display); color: var(--ink); text-overflow: ellipsis;
  --face-color: var(--field-face); background: var(--face-color); border: 0; border-radius: 0;
  box-shadow: var(--well-shade);
  clip-path: var(--cut-shape);
  transition: --face-color 0.3s;
}
.find input::placeholder { color: var(--muted); }
.find input:focus, .find.is-focused input { outline: none; --face-color: var(--field-focus); }
.find:focus-within .cut-line polygon, .find.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.find input::-webkit-search-cancel-button { display: none; }
.find .glass-icon { position: absolute; z-index: 2; left: 16px; top: 50%; transform: translateY(-50%); width: 17px; height: 17px; color: var(--ink-2); pointer-events: none; }
`,
  render: searchField,
  examples: [
    { label: "Rest", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "", placeholder: "Search games", label: "Search games" })}</div>` },
    { label: "Focused, typed", markup: html`<div style="width:min(460px,100%)">${searchField({ action: "#search-field", name: "search_text", searchText: "rally", placeholder: "Search games", label: "Search games", state: "is-focused" })}</div>`, isStill: true },
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
.bday legend { padding: 0; margin-bottom: var(--gap-words-control); font: var(--type-label); color: var(--ink-2); }
.bday-field { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; height: 52px; padding: 0 18px 0 52px; border: 0; cursor: pointer; text-align: left;
  font: 500 18px var(--display); color: var(--muted); --face-color: var(--field-face); background: var(--face-color); box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-color 0.25s; }
.bday-field:hover { --face-color: var(--field-hover); }
.bday-field[aria-expanded="true"], .bday-field:focus-visible { outline: none; --face-color: var(--field-focus); }
.bday-field.set { color: var(--ink); font-weight: 500; }
.bday-field > .ico { position: absolute; left: 18px; top: 50%; width: 20px; height: 20px; transform: translateY(-50%); color: var(--muted); }
.bday-field[aria-expanded="true"] > .ico, .bday-field.set > .ico { color: var(--ink); }
.bday-chev { display: inline-flex; flex: none; margin-right: 4px; color: var(--ink); transition: transform 0.4s cubic-bezier(.2,.7,.2,1); }
.bday-chev > .ico { width: 16px; height: 10px; stroke-width: 2.2; }
/* Only the chevron turns when the picker opens; the outline and the icon stay still. */
.bday-field[aria-expanded="true"] .bday-chev { transform: rotate(180deg); }
.bday-field .cut-line { z-index: 4; }
.bday-field .cut-line polygon { stroke: var(--field-outline); }
.bday-field[aria-expanded="true"] .cut-line polygon, .bday-field:focus-visible .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.bday-field.is-marked .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
/* Its words stay on one line, never crowding its edges; what's wrong is said under it, as under a cut field. */
.bday-value { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bday-field > span { position: relative; z-index: 2; }
/* The picker: a well of clearer glass holding three wheels under a white band with the orange line. The picked value is larger; the others fade
   toward the edges. The wheel you're on by keyboard has its value underlined in ink. */
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
.wheel:focus-visible [role="option"][aria-selected="true"] { text-decoration: underline 2px var(--focus); text-underline-offset: 7px; }
/* Done: a cut slab of clearer glass; it whitens with the orange line when you point at it, once there's a whole date. */
`,
  render: birthdayField,
  examples: [
    { label: "Closed", markup: examplePane(birthdayField({ id: "example-bday-closed", name: "birthday", label: "When's your birthday?" })) },
    { label: "Open", markup: examplePane(birthdayField({ id: "example-bday-open", name: "birthday", label: "When's your birthday?", state: "open" })) },
    { label: "Picked", markup: examplePane(birthdayField({ id: "example-bday-picked", name: "birthday", label: "When's your birthday?", birthday: "2004-03-14" })) },
    { label: "Error", markup: examplePane(birthdayField({ id: "example-bday-marked", name: "birthday", label: "When's your birthday?", state: "marked" })) },
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
.date-time-zone { margin: 0; font: var(--type-facts); color: var(--muted); }
.date-time-zone:empty { display: none; }
.date-time-wheels { grid-template-columns: 2.5fr 1.1fr 0.7fr; }
/* The picked day stays at the wheel's own size, so a long one ("Jan 15, 2027") still fits a phone. */
.date-time-wheels [role="option"] { white-space: nowrap; }
.date-time-wheels [role="option"][aria-selected="true"] { font-size: 16px; }
`,
  render: dateTimeField,
  examples: [
    { label: "Closed", markup: examplePane(dateTimeField({ id: "example-when-closed", name: "publish_at", label: "Go live" })) },
    { label: "Open", markup: examplePane(dateTimeField({ id: "example-when-open", name: "publish_at", label: "Go live", state: "open" })) },
    { label: "Picked", markup: examplePane(dateTimeField({ id: "example-when-picked", name: "publish_at", label: "Go live", pickedAt: "2027-01-15T18:30+00:00" })) },
  ],
});
