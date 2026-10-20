import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { CUT_LINE, ICONS, icon, type IconName } from "./foundations.ts";

/*
 * Inputs: the cut field, search, the birthday wheels and the switch. From the sign-in draft (fields, the
 * wheels, the Sign in / Make an account switch), the header draft (search) and the home draft (the sort switch).
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
<span class="${className}" data-cut-line="10">${CUT_LINE}${icon(options.icon)}<input id="${id}" name="${options.name}" type="${inputType}"${options.text !== undefined ? html` value="${options.text}"` : ""}${options.placeholder ? html` placeholder="${options.placeholder}"` : ""}${options.autocomplete ? html` autocomplete="${options.autocomplete}"` : ""}${options.type === "email" || options.name === "username" ? raw(' autocapitalize="off" spellcheck="false"') : ""}${options.isRequired ? raw(" required") : ""}${options.error ? html` aria-invalid="true" aria-describedby="${errorId}"` : ""}>${isPassword ? html`<button type="button" class="show cut-raised" data-cut-line="7" aria-controls="${id}" aria-pressed="${options.isPasswordShown ? "true" : "false"}">${CUT_LINE}<span class="show-words">${options.isPasswordShown ? "Hide" : "Show"}</span></button>` : ""}</span>
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
<button type="button" class="bday-field cut-carved${isMarked ? " is-marked" : ""}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${id}-error">${CUT_LINE}${icon("calendar")}<span class="bday-value">Pick your birthday</span><svg class="chev" viewBox="0 0 20 12" width="16" height="10" aria-hidden="true"><path d="M2 2l8 8 8-8" fill="none" stroke="currentColor" stroke-width="2.2"/></svg></button>
<p class="field-error" id="${id}-error"${isMarked ? "" : raw(" hidden")}>Pick your birthday to go on.</p>
<div class="bday-pick" data-cut-line="10" id="${id}-pick" role="group" aria-label="${options.label}"${isOpen ? "" : raw(" hidden")}>
<div class="wheels"><span class="wheel-band cut-raised" data-cut-line="8" aria-hidden="true"></span><div class="wheel" data-own-fade data-part="month" role="listbox" aria-label="Month" tabindex="0"></div><div class="wheel" data-own-fade data-part="day" role="listbox" aria-label="Day" tabindex="0"></div><div class="wheel" data-own-fade data-part="year" role="listbox" aria-label="Year" tabindex="0"></div></div>
<span class="bday-read sr" aria-live="polite"></span>
</div>
<input type="hidden" name="${options.name}" value="${options.birthday ?? ""}" data-id="${id}">
</fieldset>`;
}

export interface SwitchTab {
  label: string;
  /** A link to another page; without one it's a button with aria-pressed. */
  href?: string;
  /** A button's value, for a page script to read. */
  tabValue?: string;
  isCurrent: boolean;
}

/** The switch: a clear well, a white slab with the orange line under the one you're on, and a faint one under the one you point at. */
export function tabSwitch(options: { label: string; tabs: SwitchTab[]; switchSize: "big" | "small"; isFramed?: boolean }): Raw {
  const isSmall = options.switchSize === "small";
  // Framed: inside a carved frame of its own (a [data-cut-line] box) that it scrolls in, so it has no well or cut of its own,
  // and its slab's ends on the first and last tabs follow the frame's ends.
  const own = options.isFramed ? html`<div class="tab-switch framed ${options.switchSize}" role="group" aria-label="${options.label}">` : html`<div class="tab-switch cut-carved ${options.switchSize}" role="group" aria-label="${options.label}" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}`;
  return html`${own}<span class="ghost" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}"></span><span class="slab cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span>${options.tabs.map((tab) =>
    tab.href
      ? html`<a href="${tab.href}"${tab.isCurrent ? raw(' aria-current="page"') : ""}>${tab.label}</a>`
      : html`<button type="button"${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}">${tab.label}</button>`,
  )}</div>`;
}

/** Show/Hide: shows the password it controls, and hides it again. */
export const FIELD_SCRIPT = `/* fields */(function () {
  document.addEventListener("click", function (event) {
    var show = event.target.closest && event.target.closest(".field .show");
    if (!show) return;
    var input = document.getElementById(show.getAttribute("aria-controls")); if (!input) return;
    var on = input.type === "password";
    input.type = on ? "text" : "password";
    // Only its words change: the slab and its drawn edge stay.
    show.querySelector(".show-words").textContent = on ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(on));
  });
})();
`;

/** The switch's slab sits under the one you're on, the ghost follows the pointer across the others, both with the spring. */
export const SWITCH_SCRIPT = `/* switches */(function () {
  document.querySelectorAll(".tab-switch").forEach(function (sw) {
    var slab = sw.querySelector(".slab"), ghost = sw.querySelector(".ghost"), tabs = sw.querySelectorAll("a, button");
    function current() { return sw.querySelector('[aria-current="page"], [aria-pressed="true"]'); }
    function put(el, tab) {
      if (!tab) { el.style.width = "0px"; return; }
      el.style.width = tab.offsetWidth + "px"; el.style.transform = "translateX(" + tab.offsetLeft + "px)";
      // The edge rule: the slab slants only where another tab is beside it, and its end on the first or last tab follows the switch's end.
      var isFirst = tab === tabs[0], isLast = tab === tabs[tabs.length - 1];
      el.setAttribute("data-cut-beside", ((isFirst ? "" : "start ") + (isLast ? "" : "end")).trim());
      var ends = ((isFirst ? "start " : "") + (isLast ? "end" : "")).trim();
      if (ends) el.setAttribute("data-cut-ends", ends); else el.removeAttribute("data-cut-ends");
      if (el.redrawCut) el.redrawCut();
    }
    function settle() { var on = current(); slab.style.transition = "none"; put(slab, on); put(ghost, on); slab.offsetWidth; slab.style.transition = ""; sw.classList.add("is-ready"); }
    settle();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
    if (window.ResizeObserver) new ResizeObserver(settle).observe(sw); else window.addEventListener("resize", settle);
    tabs.forEach(function (tab) {
      tab.addEventListener("pointerenter", function () { if (tab !== current()) { put(ghost, tab); sw.classList.add("pointing"); } else sw.classList.remove("pointing"); });
      tab.addEventListener("click", function () {
        sw.classList.remove("pointing");
        if (tab.tagName === "BUTTON") tabs.forEach(function (each) { each.setAttribute("aria-pressed", String(each === tab)); });
        put(slab, tab); put(ghost, tab);
      });
    });
    sw.addEventListener("pointerleave", function () { sw.classList.remove("pointing"); });
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
      } else if (!field.classList.contains("is-marked")) { value.textContent = "Pick your birthday"; field.classList.remove("set"); hidden.value = ""; }
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
.cut-field { display: flex; flex-direction: column; gap: 8px; }
.cut-field > label { font: 600 15px var(--display); color: var(--ink-2); }
.field { position: relative; display: flex; align-items: center; height: 52px; color: var(--muted); }
.field input { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%; height: 100%; padding: 0 16px 0 52px;
  font: 500 18px var(--display); color: var(--ink); caret-color: var(--run-lo);
  --face-colour: var(--field-face); background: var(--face-colour); border: 0; border-radius: 0; box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-colour 0.25s; }
.field:hover input { --face-colour: var(--field-hover); }
.field input:focus, .field.is-focused input { outline: none; --face-colour: var(--field-focus); border: 0; }
.field input::placeholder { color: var(--muted); }
.field input:-webkit-autofill { -webkit-text-fill-color: var(--ink); transition: background-color 600000s 0s; }
.field .ico { position: absolute; z-index: 3; left: 18px; width: 20px; height: 20px; pointer-events: none; transition: color 0.25s; }
.field:focus-within, .field.is-focused { color: var(--ink); }
.field > .cut-line { z-index: 4; }
.field > .cut-line polygon { stroke: var(--field-outline); }
.field:focus-within > .cut-line polygon, .field.is-focused > .cut-line polygon { stroke: var(--run); stroke-width: 2; }
.field.is-marked > .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
.field-error { margin: 0; font: 500 15px var(--display); color: var(--marked); }
.field.with-toggle input { padding-right: 90px; }
/* Show/Hide: a small cut slab inside the field; it turns white with the orange line while the password shows. */
/* Show/Hide: a small raised slab inside the field, like a cut button. While the password shows, it's sunk into the field, its light turned round. */
.field .show > .show-words { position: relative; z-index: 2; }
.field .show { position: absolute; z-index: 5; right: 8px; top: 8px; bottom: 8px; padding: 0 14px; border: 0; cursor: pointer;
  font: 600 15px var(--display); color: var(--ink-2); --face-colour: var(--btn); background: var(--face-colour);
  clip-path: var(--cut-shape); transition: --face-colour 0.2s, color 0.2s; }
.field .show:hover { --face-colour: var(--btn-hover); color: var(--ink); }
.field .show[aria-pressed="true"] { --face-colour: var(--btn-press); color: var(--ink); }
.field .show[aria-pressed="true"] > .cut-line, .field .show:active > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.field .show:focus-visible { outline: none; color: var(--ink); }
.field .show:focus-visible > .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
`;

const examplePane = (body: Raw) => html`<div class="glass example-pane" data-glass data-glass-corners="18 9 18 9">${body}</div>`;

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
  font: 500 16px var(--display); color: var(--ink);
  --face-colour: var(--field-face); background: var(--face-colour); border: 0; border-radius: 0;
  box-shadow: var(--well-shade);
  clip-path: var(--cut-shape);
  transition: --face-colour 0.3s;
}
.find input::placeholder { color: var(--muted); }
.find input:focus, .find.is-focused input { outline: none; --face-colour: var(--field-focus); }
.find:focus-within .cut-line polygon, .find.is-focused .cut-line polygon { stroke: var(--run); stroke-width: 2; }
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
.bday { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.bday legend { padding: 0; margin-bottom: 10px; font: 600 18px var(--display); color: var(--ink); }
.bday-field { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; height: 52px; padding: 0 18px 0 52px; border: 0; cursor: pointer; text-align: left;
  font: 500 18px var(--display); color: var(--muted); --face-colour: var(--field-face); background: var(--face-colour); box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-colour 0.25s; }
.bday-field:hover { --face-colour: var(--field-hover); }
.bday-field[aria-expanded="true"], .bday-field:focus-visible { outline: none; --face-colour: var(--field-focus); }
.bday-field.set { color: var(--ink); font-weight: 500; }
.bday-field .ico { position: absolute; left: 18px; top: 50%; width: 20px; height: 20px; transform: translateY(-50%); color: var(--muted); }
.bday-field[aria-expanded="true"] .ico, .bday-field.set .ico { color: var(--ink); }
.bday-field .chev { flex: none; margin-right: 4px; color: var(--ink); transition: transform 0.4s cubic-bezier(.2,.7,.2,1); }
/* Only the chevron turns when the picker opens; the outline and the icon stay still. */
.bday-field[aria-expanded="true"] .chev { transform: rotate(180deg); }
.bday-field .cut-line { z-index: 4; }
.bday-field .cut-line polygon { stroke: var(--field-outline); }
.bday-field[aria-expanded="true"] .cut-line polygon, .bday-field:focus-visible .cut-line polygon { stroke: var(--run); stroke-width: 2; }
.bday-field.is-marked .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
/* Its words stay on one line, never crowding its edges; what's wrong is said under it, as under a cut field. */
.bday-value { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.bday .field-error { margin-top: 8px; }
.bday-field > span { position: relative; z-index: 2; }
/* The picker: a well of clearer glass holding three wheels under a white band with the orange line. The picked value is larger; the others fade
   toward the edges. The wheel you're on by keyboard has its value underlined in ink. */
.bday-pick { position: relative; margin-top: 0; padding: 10px 12px 14px; border: 0; background: var(--pick); box-shadow: var(--pick-shade);
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
.wheel:focus-visible [role="option"][aria-selected="true"] { text-decoration: underline 2px var(--ink); text-underline-offset: 7px; }
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
  name: "Switch",
  slug: "switch",
  group: "inputs",
  summary: "Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small).",
  styles: `
/* The switch: the header's and the home's. A clear well, a white slab with the orange line under the one you're on, and a faint one under the one you point at. */
.tab-switch { position: relative; display: flex; height: 44px; padding: 4px; background: var(--well); box-shadow: var(--well-shade);
  clip-path: var(--cut-shape); }
.tab-switch .slab, .tab-switch .ghost { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; pointer-events: none; clip-path: var(--cut-shape);
  transition: transform 0.55s var(--spring), width 0.55s var(--spring), opacity 0.3s; }
.tab-switch .slab { clip-path: var(--cut-shape); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
.tab-switch .ghost { background: var(--ghost); opacity: 0; }
.tab-switch.pointing .ghost { opacity: 1; }
.tab-switch > a, .tab-switch > button { position: relative; z-index: 2; display: grid; place-content: center; padding: 0 18px; border: 0; background: none; cursor: pointer;
  font: 500 15px var(--display); color: var(--ink-2); text-decoration: none; white-space: nowrap; }
.tab-switch.big > a, .tab-switch.big > button { flex: 1 1 0; }
/* The one you're on is marked by its slab and full ink, at the same weight as the others, so its words never move as it's chosen. */
.tab-switch [aria-current="page"], .tab-switch [aria-pressed="true"] { color: var(--ink); }
/* Before the script has measured, the one you're on carries its own slab. */
.tab-switch:not(.is-ready) [aria-current="page"], .tab-switch:not(.is-ready) [aria-pressed="true"] { background: var(--slab); box-shadow: inset 0 -3px 0 var(--run); }
.tab-switch.framed, .tab-switch.framed.small { background: none; box-shadow: none; clip-path: none; }
.tab-switch > :focus-visible { outline: 2px solid var(--ink); outline-offset: -4px; }
/* The sort switch: the header's switch, smaller. */
.tab-switch.small { height: 36px; padding: 3px; clip-path: var(--cut-shape); }
.tab-switch.small .slab, .tab-switch.small .ghost { top: 3px; bottom: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
.tab-switch.small > a, .tab-switch.small > button { padding: 0 14px; font-size: 14px; }
@media (prefers-reduced-motion: reduce) { .tab-switch .slab, .tab-switch .ghost { transition: none; } }
`,
  render: tabSwitch,
  examples: [
    {
      label: "Big",
      markup: html`<div style="width:min(380px,100%)">${tabSwitch({ label: "Sign in or make an account", switchSize: "big", tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] })}</div>`,
    },
    {
      label: "Small",
      markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] }),
    },
    {
      label: "On a loop",
      markup: html`<div data-state-loop="switch">${tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] })}</div>`,
      isStill: true,
    },
    {
      label: "Links to pages",
      markup: tabSwitch({ label: "Your games", switchSize: "small", tabs: [{ label: "Played", href: "#switch", isCurrent: false }, { label: "Saved", href: "#switch", isCurrent: true }, { label: "Bought", href: "#switch", isCurrent: false }] }),
    },
  ],
});

