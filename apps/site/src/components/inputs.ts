import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { CUT_LINE, ICONS, colourPicker, glassPane, icon, tag, type ColourChoice, type IconName } from "./foundations.ts";
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
<button type="button" class="bday-field cut-carved${isMarked ? " is-marked" : ""}" data-cut-line="10" aria-expanded="${isOpen ? "true" : "false"}" aria-controls="${id}-pick" aria-describedby="${id}-legend ${id}-error">${CUT_LINE}${icon("calendar")}<span class="bday-value">Choose a date</span><span class="bday-chev">${icon("chevron-down")}</span></button>
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
  /** It can fold away into the end of the tabs (the header's Developer and Forum, off a developer page): folded, it takes no room and can't be reached. */
  isFoldable?: boolean;
  isFolded?: boolean;
}

/** The switch: a clear well, a white slab with the orange line under the one you're on, and a faint one under the one you point at. */
export function tabSwitch(options: { label: string; tabs: SwitchTab[]; switchSize: "big" | "small"; isFramed?: boolean; isVertical?: boolean }): Raw {
  const isSmall = options.switchSize === "small";
  const inside = (tab: SwitchTab) =>
    tab.icon || tab.badgeCount ? html`${tab.icon ? icon(tab.icon) : ""}<span>${tab.label}</span>${tab.badgeCount ? tag(tab.badgeCount, "count") : ""}` : html`${tab.label}`;
  const kind = `${options.switchSize}${options.isVertical ? " vertical" : ""}`;
  const folding = (tab: SwitchTab) =>
    tab.isFoldable ? (tab.isFolded ? raw(' class="foldable folded" tabindex="-1" aria-hidden="true"') : raw(' class="foldable"')) : "";
  // Framed: in a carved frame of its own that it scrolls inside, fading at its ends (the header's tabs, the gallery's groups on a phone), so
  // the switch has no well or cut of its own, and its slab's ends on the first and last tabs follow the frame's ends.
  const own = options.isFramed
    ? html`<div class="switch-frame cut-carved ${options.switchSize}" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}<div class="switch-frame-row" data-fades-sideways><div class="tab-switch framed ${kind}" role="group" aria-label="${options.label}">`
    : html`<div class="tab-switch cut-carved ${kind}" role="group" aria-label="${options.label}" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}`;
  return html`${own}<span class="ghost" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}"></span><span class="slab cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span>${options.tabs.map((tab) =>
    tab.href
      ? html`<a href="${tab.href}"${folding(tab)}${tab.extra ?? ""}${tab.isCurrent ? raw(' aria-current="page"') : ""}>${inside(tab)}</a>`
      : html`<button type="button"${tab.extra ?? ""}${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}">${inside(tab)}</button>`,
  )}</div>${options.isFramed ? raw("</div></div>") : ""}`;
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
      // A folded tab takes no room, so the ends are the first and last tabs shown.
      var shown = Array.prototype.filter.call(tabs, function (each) { return !each.classList.contains("folded"); });
      var isFirst = tab === shown[0], isLast = tab === shown[shown.length - 1];
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

const examplePane = (body: Raw) => glassPane({ paneSize: "small", body });

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
/* Framed: the carved frame is its own (.switch-frame), --switch-height tall, and the tabs scroll inside it. */
.switch-frame { position: relative; display: flex; flex: none; min-width: 0; height: var(--switch-height, 44px); background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape);
  transition: height 0.45s cubic-bezier(.2,.8,.2,1); }
.switch-frame.small { height: var(--switch-height, 36px); }
.switch-frame-row { position: relative; display: flex; flex: 1; min-width: 0; height: 100%; }
.tab-switch.framed, .tab-switch.framed.small { height: 100%; width: max-content; min-width: 100%; background: none; box-shadow: none; clip-path: none; }
/* When they fit, the tabs share out the frame's width; when they don't, they keep their own and scroll. */
.tab-switch.framed > a, .tab-switch.framed > button { flex: 1 0 auto; }
/* A tab that folds away into the end of the tabs and opens out of it again. */
.tab-switch > .foldable { max-width: 160px; overflow: hidden; transition: max-width 0.45s cubic-bezier(.2,.8,.2,1), padding 0.45s cubic-bezier(.2,.8,.2,1), opacity 0.3s 0.08s; }
.tab-switch > .foldable.folded { max-width: 0; padding-left: 0; padding-right: 0; opacity: 0; pointer-events: none; transition: max-width 0.4s cubic-bezier(.4,0,.2,1), padding 0.4s cubic-bezier(.4,0,.2,1), opacity 0.16s; }
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
@media (prefers-reduced-motion: reduce) { .tab-switch .slab, .tab-switch .ghost, .tab-switch > .foldable { transition: none; } }
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
      label: "Framed: more tabs than fit scroll inside the frame, fading at its ends",
      markup: html`<div style="width:min(300px,100%)">${tabSwitch({ label: "Groups", switchSize: "small", isFramed: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation", "Panes", "Data"].map((label, tabIndex) => ({ label, href: "#switch", isCurrent: tabIndex === 2 })) })}</div>`,
    },
    {
      label: "Framed, with tabs folded away (the header off a developer page)",
      markup: tabSwitch({ label: "Main", switchSize: "big", isFramed: true, tabs: [{ label: "Home", href: "#switch", isCurrent: true }, { label: "Your games", href: "#switch", isCurrent: false }, { label: "Developer", href: "#switch", isCurrent: false, isFoldable: true, isFolded: true }, { label: "Forum", href: "#switch", isCurrent: false, isFoldable: true, isFolded: true }] }),
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
  --face-colour: var(--field-face); background: var(--face-colour); border: 0; border-radius: 0; box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-colour 0.25s; }
.field.long:hover textarea { --face-colour: var(--field-hover); }
.field.long textarea:focus, .field.long.is-focused textarea { outline: none; --face-colour: var(--field-focus); }
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
  state?: "is-focused";
}

/** A select field: a cut field holding the system's own list, so a phone opens its own picker. For one of many (a region, a language); one of a few is Choice cards or a Switch. */
export function selectField(options: SelectFieldOptions): Raw {
  const id = options.id ?? `field-${options.name}`;
  const className = ["field", "select", "cut-carved", options.icon ? "" : "no-icon", options.error ? "is-marked" : "", options.state ?? ""].filter(Boolean).join(" ");
  return html`<div class="cut-field"><label for="${id}">${options.label}</label>
<span class="${className}" data-cut-line="10">${CUT_LINE}${options.icon ? icon(options.icon) : ""}<select id="${id}" name="${options.name}"${options.error ? html` aria-invalid="true" aria-describedby="${id}-error"` : ""}>${options.choices.map((choice) => html`<option value="${choice.choiceValue}"${choice.choiceValue === options.pickedValue ? raw(" selected") : ""}>${choice.label}</option>`)}</select><span class="select-chev">${icon("chevron-down")}</span></span>
${options.error ? html`<p class="field-error" id="${id}-error">${options.error}</p>` : ""}</div>`;
}

const REGIONS: SelectChoice[] = [
  { label: "Nearest to each player", choiceValue: "nearest" },
  { label: "Europe", choiceValue: "europe" },
  { label: "North America", choiceValue: "north-america" },
  { label: "Asia Pacific", choiceValue: "asia-pacific" },
];

component({
  name: "Select field",
  slug: "select-field",
  group: "inputs",
  summary: "One of many, from a list: a region, a language, a category. The list is the system's own, so a phone opens its own picker; for one of a few, use Choice cards or a Switch.",
  styles: `
/* A select field: the cut field, holding the system's own select with its arrow hidden; the birthday field's chevron sits at its end. */
.field.select select { position: relative; z-index: 2; flex: 1; min-width: 0; width: 100%; height: 100%; padding: 0 48px 0 52px; appearance: none; -webkit-appearance: none; cursor: pointer;
  font: 500 18px var(--display); color: var(--ink); text-overflow: ellipsis;
  --face-colour: var(--field-face); background: var(--face-colour); border: 0; border-radius: 0; box-shadow: var(--field-shade);
  clip-path: var(--cut-shape); transition: --face-colour 0.25s; }
.field.select.no-icon select { padding-left: 18px; }
.field.select:hover select { --face-colour: var(--field-hover); }
.field.select select:focus, .field.select.is-focused select { outline: none; --face-colour: var(--field-focus); }
.field.select option { color: #14171C; background: #fff; }
.select-chev { position: absolute; z-index: 3; right: 18px; display: inline-flex; color: var(--ink); pointer-events: none; }
.select-chev > .ico { position: static; width: 16px; height: 10px; stroke-width: 2.2; }
`,
  render: selectField,
  examples: [
    { label: "Picked", markup: examplePane(selectField({ id: "example-select-region", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "nearest" })) },
    { label: "With an icon", markup: examplePane(selectField({ id: "example-select-icon", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", icon: "people" })) },
    { label: "Focused", markup: examplePane(selectField({ id: "example-select-focused", name: "room_region", label: "Where rooms run", choices: REGIONS, pickedValue: "europe", state: "is-focused" })), isStill: true },
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
  /** Unique on the page. Defaults to check-<name>. */
  id?: string;
  state?: PressState;
}

/** A check field: a box to tick, for a yes or no that's sent with its form (I agree, Email me replies). On a page that saves at once, use a Toggle. */
export function checkField(options: CheckFieldOptions): Raw {
  const id = options.id ?? `check-${options.name}`;
  return html`<label class="check${options.state ? ` ${options.state}` : ""}" for="${id}"><span class="check-box cut-carved" data-cut-line="6">${CUT_LINE}<input class="check-input" type="checkbox" id="${id}" name="${options.name}" value="yes"${options.isChecked ? raw(" checked") : ""}${options.hint ? html` aria-describedby="${id}-hint"` : ""}>${icon("check")}</span><span class="check-words"><span class="check-label">${options.label}</span>${options.hint ? html`<span class="check-hint" id="${id}-hint">${options.hint}</span>` : ""}</span></label>`;
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
  summary: "A yes or no sent with its form: I agree, Email me replies. A small carved box that turns white with an orange tick. On a page that saves at once, use a Toggle.",
  styles: `
/* A check field: a small carved box of the fields' glass, cut by the edge rule, before its words. Ticked, the box turns white like a
   switch's slab and holds an orange tick. The real checkbox lies over the box, unseen, so the keyboard, forms and screen readers get
   the system's own; the whole line is its label, so a press anywhere on it ticks it. */
.check { position: relative; display: inline-flex; align-items: flex-start; gap: var(--gap-words-control); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.check-box { position: relative; flex: none; display: grid; place-items: center; width: 24px; height: 24px; color: transparent;
  --face-colour: var(--field-face); background: var(--face-colour); box-shadow: var(--field-shade); clip-path: var(--cut-shape); transition: --face-colour 0.2s, color 0.2s; }
.check-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.check-box > .ico { position: relative; z-index: 2; width: 16px; height: 16px; stroke-width: 2.4; transform: scale(0.6); transition: transform 0.3s var(--spring); }
.check:hover .check-box, .check.is-pointed .check-box { --face-colour: var(--field-hover); }
.check-box:has(.check-input:checked) { --face-colour: #fff; color: var(--run); }
.check-box:has(.check-input:checked) > .ico { transform: scale(1); }
.check-box:has(.check-input:checked) > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.check:active .check-box > .ico, .check.is-pressed .check-box > .ico { transform: scale(0.85); transition-duration: 0.08s; }
.check:active .check-box, .check.is-pressed .check-box { box-shadow: var(--press-shade); }
.check-box:has(.check-input:focus-visible) > .cut-line polygon, .check.is-focused .check-box > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.check-words { display: grid; gap: var(--gap-words-words); padding-top: 2px; }
.check-label { font: var(--type-words); color: var(--ink); }
.check-hint { font: var(--type-note); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .check-box > .ico { transition: none; } }
`,
  render: checkField,
  examples: [
    ...pressExamples((state, exampleKey) => checkField({ id: `example-check-${exampleKey}`, name: "reply_emails", label: "Email me replies", state }), "check"),
    { label: "Ticked", markup: checkField({ id: "example-check-ticked", name: "reply_emails", label: "Email me replies", isChecked: true }) },
    { label: "With a hint", markup: examplePane(checkField({ id: "example-check-hint", name: "rules_agreed", label: "I've read the content rules", hint: "Games break them only by what's in them, never by taste.", isChecked: true })) },
  ],
});

export interface ChoiceCard {
  label: string;
  choiceValue: string;
  /** A line on what it means. */
  text: string;
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
  /** The gallery's fixed states, on the first card. */
  state?: PressState;
}

/** Choice cards: one of a few, each needing a line to say what it means (who can see a game, how rooms run). Radios as cut glass cards. */
export function choiceCards(options: ChoiceCardsOptions): Raw {
  const id = options.id ?? `choice-${options.name}`;
  return html`<fieldset class="choices"><legend>${options.label}</legend><div class="choice-cards">${options.choices.map(
    (choice, choiceIndex) =>
      html`<label class="choice-card cut-raised${choiceIndex === 0 && options.state ? ` ${options.state}` : ""}" data-cut-line="10">${CUT_LINE}<input class="choice-input" type="radio" name="${options.name}" id="${id}-${choice.choiceValue}" value="${choice.choiceValue}"${choice.choiceValue === options.pickedValue ? raw(" checked") : ""}>${choice.icon ? icon(choice.icon) : ""}<span class="choice-words"><span class="choice-label">${choice.label}</span><span class="choice-text">${choice.text}</span></span></label>`,
  )}</div></fieldset>`;
}

const VISIBILITIES: ChoiceCard[] = [
  { label: "Listed", choiceValue: "listed", text: "On Zaisma's shelves and in search, for anyone.", icon: "people" },
  { label: "Unlisted", choiceValue: "unlisted", text: "Only people with its link can find it.", icon: "eye" },
  { label: "Private", choiceValue: "private", text: "Only you and your testers.", icon: "lock" },
];

component({
  name: "Choice cards",
  slug: "choice-cards",
  group: "inputs",
  summary: "One of a few, when each needs a line to say what it means: who can see a game, how its rooms run. The picked card turns white with the orange line, like a switch's slab.",
  styles: `
/* Choice cards: radios as raised slabs of clearer glass, the cut buttons' face, cut by the edge rule. Pointing brightens one; the
   picked one is the switch's white slab with its orange line along the foot. The real radio lies over the card, unseen, so the arrow
   keys move between them as the system's do. */
.choices { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-words-control); }
.choices > legend { padding: 0; margin-bottom: var(--gap-words-control); font: var(--type-label); color: var(--ink-2); }
.choice-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--gap-control-stack); }
.choice-card { position: relative; display: flex; align-items: flex-start; gap: var(--gap-words-words); min-height: 76px; padding: 14px 16px; cursor: pointer; -webkit-tap-highlight-color: transparent;
  color: var(--ink-2); --face-colour: var(--btn); background: var(--face-colour); clip-path: var(--cut-shape); transition: --face-colour 0.2s, box-shadow 0.2s; }
.choice-card > :not(.cut-line):not(.choice-input) { position: relative; z-index: 2; }
.choice-input { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.choice-card > .ico { flex: none; margin-top: 1px; color: var(--muted); }
.choice-words { display: grid; gap: var(--gap-words-words); }
.choice-label { font: var(--type-label); color: var(--ink); }
.choice-text { font: var(--type-note); color: var(--muted); }
.choice-card:hover, .choice-card.is-pointed { --face-colour: var(--btn-hover); }
.choice-card:active, .choice-card.is-pressed { --face-colour: var(--btn-press); box-shadow: var(--press-shade); transition-duration: 0.08s; }
.choice-card:active > .cut-line, .choice-card.is-pressed > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* Picked: the switch's slab, white with the orange line along its foot, its words and icon in full ink. */
.choice-card:has(.choice-input:checked) { background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); color: var(--ink); }
.choice-card:has(.choice-input:checked) > .ico { color: var(--ink); }
.choice-card:has(.choice-input:checked) > .cut-line { --band-bottom: transparent; }
.choice-card:has(.choice-input:focus-visible) > .cut-line polygon, .choice-card.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
`,
  render: choiceCards,
  examples: [
    ...pressExamples((state, exampleKey) => choiceCards({ id: `example-choice-${exampleKey}`, name: `visibility_${exampleKey}`, label: "Who can see it", choices: VISIBILITIES.slice(0, 2), pickedValue: "unlisted", state }), "choice"),
    { label: "Three, in a pane", markup: glassPane({ paneSize: "medium", body: choiceCards({ id: "example-choice-pane", name: "visibility_pane", label: "Who can see it", choices: VISIBILITIES, pickedValue: "listed" }) }), isWide: true },
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
  return html`<label class="toggle${options.state ? ` ${options.state}` : ""}" for="${id}"><span class="toggle-words"><span class="toggle-label">${options.label}</span>${options.hint ? html`<span class="toggle-hint" id="${id}-hint">${options.hint}</span>` : ""}</span><span class="toggle-slot cut-carved" data-cut-line="8">${CUT_LINE}<input class="toggle-input" type="checkbox" role="switch" id="${id}" name="${options.name}" value="on"${options.isOn ? raw(" checked") : ""}${options.hint ? html` aria-describedby="${id}-hint"` : ""}><span class="toggle-slab cut-raised" data-cut-line="6" data-cut-ends="start end" aria-hidden="true">${CUT_LINE}</span></span></label>`;
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
.toggle-slot { position: relative; flex: none; width: 56px; height: 32px; --face-colour: var(--well); background: var(--face-colour); box-shadow: var(--well-shade); clip-path: var(--cut-shape); transition: --face-colour 0.3s; }
.toggle-input { position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
/* The slab is solid, so the orange behind it never tints it. */
.toggle-slab { position: absolute; z-index: 2; left: 4px; top: 4px; width: 24px; height: 24px; background: linear-gradient(180deg, #fff, #E9EDF3); box-shadow: 0 1px 3px rgba(20,23,28,0.25); clip-path: var(--cut-shape);
  transition: transform 0.4s var(--spring), filter 0.2s; }
.toggle-slot:has(.toggle-input:checked) { --face-colour: var(--run); }
.toggle-slot:has(.toggle-input:checked) > .toggle-slab { transform: translateX(24px); }
.toggle:hover .toggle-slab, .toggle.is-pointed .toggle-slab { filter: brightness(1.06); }
.toggle:active .toggle-slab, .toggle.is-pressed .toggle-slab { filter: brightness(0.94); box-shadow: var(--press-shade); }
.toggle-slot:has(.toggle-input:focus-visible) > .cut-line polygon, .toggle.is-focused .toggle-slot > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.toggle-slot:has(.toggle-input:checked:focus-visible) > .cut-line polygon, .toggle.is-focused .toggle-slot:has(.toggle-input:checked) > .cut-line polygon { stroke: var(--focus-on-run); }
@media (prefers-reduced-motion: reduce) { .toggle-slab { transition: none; } .toggle-slot { transition: none; } }
`,
  render: toggle,
  examples: [
    ...pressExamples((state, exampleKey) => html`<div style="width:min(340px,100%)">${toggle({ id: `example-toggle-${exampleKey}`, name: "cloud_saves", label: "Cloud saves", isOn: true, state })}</div>`, "toggle"),
    { label: "Off", markup: html`<div style="width:min(340px,100%)">${toggle({ id: "example-toggle-off", name: "shown_online", label: "Show me online", isOn: false })}</div>` },
    { label: "With a hint, in a pane", markup: examplePane(toggle({ id: "example-toggle-hint", name: "cloud_saves_pane", label: "Cloud saves", hint: "Players keep their progress on any device.", isOn: true })) },
  ],
});

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
.slider { --thumb: 26px; display: grid; gap: var(--gap-words-control); }
.slider-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--gap-words-words); }
.slider-head > label { font: var(--type-label); color: var(--ink-2); }
.slider-head > output { font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; }
.slider-track { position: relative; height: var(--thumb); }
.slider-line, .slider-fill { position: absolute; top: calc(50% - 1px); height: 2px; left: calc(var(--thumb) / 2); pointer-events: none; }
.slider-line { right: calc(var(--thumb) / 2); background: var(--line); }
.slider-fill { width: calc((100% - var(--thumb)) * var(--fill)); height: 4px; top: calc(50% - 2px); background: linear-gradient(90deg, #E9820C, var(--run)); }
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
