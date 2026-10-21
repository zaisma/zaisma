import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { CUT_LINE, ICONS, colourPicker, icon, tag, type ColourChoice, type IconName } from "./foundations.ts";
import { TINT_CHOICES, cutButton } from "./actions.ts";

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
<button type="button" class="bday-field cut-carved${isMarked ? " is-marked" : ""}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${id}-error">${CUT_LINE}${icon("calendar")}<span class="bday-value">Choose a date</span><svg class="chev" viewBox="0 0 20 12" width="16" height="10" aria-hidden="true"><path d="M2 2l8 8 8-8" fill="none" stroke="currentColor" stroke-width="2.2"/></svg></button>
<p class="field-error" id="${id}-error"${isMarked ? "" : raw(" hidden")}>Pick your birthday to go on.</p>
<div class="bday-pick" data-cut-line="10" id="${id}-pick" role="group" aria-label="${options.label}"${isOpen ? "" : raw(" hidden")}>
<div class="wheels"><span class="wheel-band cut-raised" data-cut-line="8" aria-hidden="true"></span><div class="wheel" data-own-fade data-part="month" role="listbox" aria-label="Month" tabindex="0"></div><div class="wheel" data-own-fade data-part="day" role="listbox" aria-label="Day" tabindex="0"></div><div class="wheel" data-own-fade data-part="year" role="listbox" aria-label="Year" tabindex="0"></div></div>
<span class="bday-read sr" aria-live="polite"></span>
</div>
<input type="hidden" name="${options.name}" value="${options.birthday ?? ""}" data-id="${id}">
</fieldset>`;
}

const VERTICAL_PLACES: SwitchTab[] = [
  { label: "Home", icon: "play", isCurrent: true },
  { label: "Your games", icon: "person", badgeCount: 3, isCurrent: false },
  { label: "Friends", icon: "friends", isCurrent: false },
  { label: "Forum", icon: "mail", badgeCount: 12, isCurrent: false },
  { label: "Settings", icon: "gear", isCurrent: false },
];

export interface SwitchTab {
  label: string;
  /** A link to another page; without one it's a button with aria-pressed. */
  href?: string;
  /** A button's value, for a page script to read. */
  tabValue?: string;
  isCurrent: boolean;
  /** Before its label (a vertical switch's places). */
  icon?: IconName;
  /** A small number at its end, like unread topics: a Tag. */
  badgeCount?: number;
  /** Attributes of its own, like a data attribute a script reads. */
  extra?: Raw;
}

/** The switch: a clear well, a white slab with the orange line under the one you're on, and a faint one under the one you point at. */
export function tabSwitch(options: { label: string; tabs: SwitchTab[]; switchSize: "big" | "small"; isFramed?: boolean; isVertical?: boolean }): Raw {
  const isSmall = options.switchSize === "small";
  const inside = (tab: SwitchTab) =>
    tab.icon || tab.badgeCount ? html`${tab.icon ? icon(tab.icon) : ""}<span>${tab.label}</span>${tab.badgeCount ? tag(tab.badgeCount, "count") : ""}` : html`${tab.label}`;
  const kind = `${options.switchSize}${options.isVertical ? " vertical" : ""}`;
  // Framed: inside a carved frame of its own (a [data-cut-line] box) that it scrolls in, so it has no well or cut of its own,
  // and its slab's ends on the first and last tabs follow the frame's ends.
  const own = options.isFramed ? html`<div class="tab-switch framed ${kind}" role="group" aria-label="${options.label}">` : html`<div class="tab-switch cut-carved ${kind}" role="group" aria-label="${options.label}" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}`;
  return html`${own}<span class="ghost" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}"></span><span class="slab cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span>${options.tabs.map((tab) =>
    tab.href
      ? html`<a href="${tab.href}"${tab.extra ?? ""}${tab.isCurrent ? raw(' aria-current="page"') : ""}>${inside(tab)}</a>`
      : html`<button type="button"${tab.extra ?? ""}${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}">${inside(tab)}</button>`,
  )}</div>`;
}

/** Show/Hide: shows the password it controls, and hides it again. */
export const FIELD_SCRIPT = `/* fields */(function () {
  document.addEventListener("click", function (event) {
    var show = event.target.closest && event.target.closest(".field > .cut-btn[aria-controls]");
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

/** The switch's slab sits under the one you're on, the ghost follows the pointer across the others, both with the spring. */
export const SWITCH_SCRIPT = `/* switches */(function () {
  document.querySelectorAll(".tab-switch").forEach(function (sw) {
    var slab = sw.querySelector(".slab"), ghost = sw.querySelector(".ghost"), tabs = sw.querySelectorAll(":scope > a, :scope > button"), isVertical = sw.classList.contains("vertical");
    function current() { return sw.querySelector('[aria-current="page"], [aria-pressed="true"]'); }
    // isGliding: the slab is moving there, so its shape blends from the old place's to the new one's over the move.
    function put(el, tab, isGliding) {
      if (!tab) { el.style.width = "0px"; return; }
      var from = { beside: el.getAttribute("data-cut-beside"), ends: el.getAttribute("data-cut-ends") || "", stack: el.getAttribute("data-cut-stack") };
      var isFirst = tab === tabs[0], isLast = tab === tabs[tabs.length - 1];
      // Vertical: the slab spans the well's width and moves down it; it never slants, and only on the first or last tab does it follow the well's top or bottom.
      if (isVertical) {
        el.style.height = tab.offsetHeight + "px"; el.style.transform = "translateY(" + tab.offsetTop + "px)";
        el.setAttribute("data-cut-beside", "");
        el.setAttribute("data-cut-stack", ((isFirst ? "first " : "") + (isLast ? "last" : "")).trim());
        if (el.redrawCut) el.redrawCut(isGliding && from.stack !== null ? { from: from, ms: parseFloat(getComputedStyle(el).transitionDuration) * 1000 } : undefined);
        return;
      }
      el.style.width = tab.offsetWidth + "px"; el.style.transform = "translateX(" + tab.offsetLeft + "px)";
      // The edge rule: the slab slants only where another tab is beside it, and its end on the first or last tab follows the switch's end.
      el.setAttribute("data-cut-beside", ((isFirst ? "" : "start ") + (isLast ? "" : "end")).trim());
      var ends = ((isFirst ? "start " : "") + (isLast ? "end" : "")).trim();
      if (ends) el.setAttribute("data-cut-ends", ends); else el.removeAttribute("data-cut-ends");
      if (el.redrawCut) el.redrawCut(isGliding && from.beside !== null ? { from: from, ms: parseFloat(getComputedStyle(el).transitionDuration) * 1000 } : undefined);
    }
    // While a slide from the last page waits for the fonts, nothing moves the slab off the tab it starts on.
    var isWaitingToSlide = false;
    function settle() { if (isWaitingToSlide) return; var on = current(); slab.style.transition = "none"; put(slab, on); put(ghost, on); slab.offsetWidth; slab.style.transition = ""; sw.classList.add("is-ready"); }
    settle();
    // A switch of links that was on the last page too (the gallery's groups): once this page shows, its slab slides from the last page's tab
    // to this one's. Only its position moves (and, sideways, its width as a stretch), as a compositor animation, like the old sidebar's glide:
    // nothing is laid out or redrawn while the new page is still starting, and the settles that follow (fonts, the first resize) can't cut it short.
    var came = window.navigation && navigation.activation && navigation.activation.from;
    if (came && came.url && slab.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      var lastPath = new URL(came.url).pathname, last = Array.prototype.find.call(tabs, function (tab) { return tab.href && new URL(tab.href).pathname === lastPath; });
      var on = current();
      if (last && on && last !== on) {
        // Measured once the fonts are in (from the cache, on a page of the same site), when the tabs have their widths, so it lands where the slab is.
        var slide = function () {
          var from = isVertical ? "translateY(" + last.offsetTop + "px)" : "translateX(" + last.offsetLeft + "px) scaleX(" + (last.offsetWidth / Math.max(1, on.offsetWidth)).toFixed(4) + ")";
          var to = isVertical ? "translateY(" + on.offsetTop + "px)" : "translateX(" + on.offsetLeft + "px) scaleX(1)";
          slab.animate([{ transform: from, transformOrigin: "0 0" }, { transform: to, transformOrigin: "0 0" }], { duration: parseFloat(getComputedStyle(slab).transitionDuration) * 1000 || 550, easing: "cubic-bezier(.3, 1.2, .4, 1)" });
        };
        // Until then it waits on the last page's tab; it starts with the page, as the view transition fades it in.
        slab.style.transition = "none"; put(slab, last); slab.offsetWidth; slab.style.transition = "";
        isWaitingToSlide = true;
        var start = function () { isWaitingToSlide = false; settle(); slide(); };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
      }
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
    if (window.ResizeObserver) new ResizeObserver(settle).observe(sw); else window.addEventListener("resize", settle);
    // A page script can pick a tab too (the gallery's Light or Dark, when the theme changes elsewhere).
    sw.pickTab = function (tab) {
      sw.classList.remove("pointing");
      if (tab.tagName === "BUTTON") tabs.forEach(function (each) { each.setAttribute("aria-pressed", String(each === tab)); });
      put(slab, tab, true); put(ghost, tab, true);
    };
    tabs.forEach(function (tab) {
      tab.addEventListener("pointerenter", function () { if (tab !== current()) { put(ghost, tab); sw.classList.add("pointing"); } else sw.classList.remove("pointing"); });
      // A link to another page doesn't slide here: the page changes at once, and the next page slides it in from this tab.
      tab.addEventListener("click", function () {
        if (tab.href && new URL(tab.href, location.href).pathname !== location.pathname) return;
        sw.pickTab(tab);
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
.field:focus-within > .cut-line polygon, .field.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.field.is-marked > .cut-line polygon { stroke: var(--marked); stroke-width: 2; }
.field-error { margin: 0; font: var(--type-words); color: var(--marked); }
.field.with-toggle input { padding-right: 90px; }
/* Show/Hide: a small cut button, a toggle, at the field's end. */
.field > .cut-btn { position: absolute; z-index: 5; right: 8px; top: 8px; }
`;

const examplePane = (body: Raw) => html`<div class="glass example-pane" data-glass data-glass-corners="24 20 24 20">${body}</div>`;

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
  --face-colour: var(--field-face); background: var(--face-colour); border: 0; border-radius: 0;
  box-shadow: var(--well-shade);
  clip-path: var(--cut-shape);
  transition: --face-colour 0.3s;
}
.find input::placeholder { color: var(--muted); }
.find input:focus, .find.is-focused input { outline: none; --face-colour: var(--field-focus); }
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
  name: "Switch",
  slug: "switch",
  group: "inputs",
  summary: "Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small). Stacked, it's a page's own places down its side.",
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
.tab-switch > :focus-visible { outline: 2px solid var(--focus); outline-offset: -4px; }
/* The sort switch: the header's switch, smaller. */
.tab-switch.small { height: 36px; padding: 3px; clip-path: var(--cut-shape); }
.tab-switch.small .slab, .tab-switch.small .ghost { top: 3px; bottom: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
.tab-switch.small > a, .tab-switch.small > button { padding: 0 14px; font-size: 14px; }
/* Vertical: the same switch stacked, its places down a carved well (a page's own places, the gallery's groups). Each place is a row of
   its icon, its words and a count at its end; the slab spans the well and moves down it, and the ghost follows the pointer between them. */
.tab-switch.vertical { flex-direction: column; height: auto; }
.tab-switch.vertical .slab, .tab-switch.vertical .ghost { top: 0; bottom: auto; left: 4px; right: 4px; width: auto; height: 0; transition: transform 0.55s var(--spring), height 0.55s var(--spring), opacity 0.3s; }
.tab-switch.vertical.small .slab, .tab-switch.vertical.small .ghost { left: 3px; right: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
.tab-switch.vertical > a, .tab-switch.vertical > button { flex: none; display: flex; align-items: center; justify-content: flex-start; gap: 10px; height: 40px; padding: 0 14px; text-align: left; }
.tab-switch.vertical > a > .tag, .tab-switch.vertical > button > .tag { margin-left: auto; }
.tab-switch.vertical .ico { width: 18px; height: 18px; }
.tab-switch.vertical > :focus-visible { outline-offset: -2px; }
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
      label: "Vertical: a page's places, with icons and counts",
      markup: html`<div style="width:min(260px,100%)">${tabSwitch({ label: "Places", switchSize: "big", isVertical: true, tabs: VERTICAL_PLACES })}</div>`,
    },
    {
      label: "Vertical, plain",
      markup: html`<div style="width:min(220px,100%)">${tabSwitch({ label: "Groups", switchSize: "big", isVertical: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation"].map((label, tabIndex) => ({ label, isCurrent: tabIndex === 1 })) })}</div>`,
    },
    {
      label: "Links to pages",
      markup: tabSwitch({ label: "Your games", switchSize: "small", tabs: [{ label: "Played", href: "#switch", isCurrent: false }, { label: "Saved", href: "#switch", isCurrent: true }, { label: "Bought", href: "#switch", isCurrent: false }] }),
    },
  ],
});


component({
  name: "Colour picker",
  slug: "colour-picker",
  group: "inputs",
  summary: "Pick one colour from a few: a glass button's tint, the glass's hue. Swatches in a row slant toward each other like any controls; the picked one is outlined in ink and named beside them.",
  styles: `
/* A colour picker: a .control-row of swatches. A swatch is a control like any other, cut by the edge rule; its outline is its cut line. */
.colour-picker { display: flex; align-items: center; gap: 0; font: var(--type-facts); color: var(--ink-2); --clear-swatch: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
.colour-picker .colour-pick:not(:last-of-type) { margin-inline-end: var(--gap-control-row-boxes); }
.colour-picker-name { margin-left: var(--gap-words-control); }
.colour-pick { position: relative; width: 32px; height: 32px; padding: 0; border: 0; cursor: pointer; background: var(--swatch); clip-path: var(--cut-shape); }
.colour-pick .cut-line polygon { stroke: var(--line); stroke-width: 1; transition: stroke 0.2s; }
.colour-pick:hover .cut-line polygon { stroke: var(--muted); stroke-width: 2; }
.colour-pick:focus-visible { outline: none; }
.colour-pick:focus-visible .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.colour-pick[aria-pressed="true"] .cut-line polygon { stroke: var(--ink); stroke-width: 3; }
`,
  render: colourPicker,
  examples: [
    { label: "Picked", markup: colourPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo" }) },
    { label: "Clear picked: a checker, the usual sign for see-through", markup: colourPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "clear" }) },
  ],
});

// Page settings sits with the switch and the colour picker, which it uses (foundations.ts can't import this file).
/** Game-like colours for the gallery's hue example. */
const HUE_CHOICES: ColourChoice[] = [
  { name: "None", colourValue: "", swatch: "clear" },
  { name: "Crimson", colourValue: "#C8384A", swatch: "#C8384A" },
  { name: "Emerald", colourValue: "#2E9E6B", swatch: "#2E9E6B" },
  { name: "Violet", colourValue: "#7A4FD8", swatch: "#7A4FD8" },
  { name: "Gold", colourValue: "#D9A520", swatch: "#D9A520" },
];


component({
  name: "Page settings",
  slug: "page-settings",
  group: "foundations",
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
      markup: html`<div data-setting-hue>${colourPicker({ label: "The glass's hue", choices: HUE_CHOICES, pickedValue: "" })}</div>`,
    },
  ],
});

// Motion sits with the switch, whose slab shows it, so it can use the real one (foundations.ts can't import this file).
component({
  name: "Motion",
  slug: "motion",
  group: "foundations",
  summary: "Things move only when pointed at, pressed or chosen: a slab springs across on the spring curve (--spring) in 0.55s, 0.4s for a small one, and a change of size takes 0.45s. Reduced motion stops all of it.",
  styles: "",
  examples: [
    {
      label: "Choose a tab: the slab springs across",
      markup: html`<div style="width:min(380px,100%)">${tabSwitch({ label: "Motion", switchSize: "big", tabs: [{ label: "Spring 0.55s", isCurrent: true }, { label: "Choose me", isCurrent: false }] })}</div>`,
    },
  ],
});
