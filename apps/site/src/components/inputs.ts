import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, ICONS, colorPicker, glassPane, icon, tag, type ColorChoice, type IconName } from "./foundations.ts";
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
  return html`${own}<span class="ghost" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}"></span><span class="slab cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span><span class="focus-ring" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span>${options.tabs.map((tab) =>
    tab.href
      ? html`<a href="${tab.href}"${folding(tab)}${tab.extra ?? ""}${tab.isCurrent ? raw(' aria-current="page"') : ""}>${inside(tab)}</a>`
      : html`<button type="button"${tab.extra ?? ""}${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}">${inside(tab)}</button>`,
  )}</div>${options.isFramed ? raw("</div></div>") : ""}`;
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

/** The switch's slab sits under the one you're on, the ghost follows the pointer across the others, both with the spring. */
export const SWITCH_SCRIPT = `/* switches */(function () {
  document.querySelectorAll(".tab-switch").forEach(function (sw) {
    var slab = sw.querySelector(".slab"), ghost = sw.querySelector(".ghost"), tabs = sw.querySelectorAll(":scope > a, :scope > button"), isVertical = sw.classList.contains("vertical");
    function current() { return sw.querySelector('[aria-current="page"], [aria-pressed="true"]'); }
    // How far a part reaches past a tab's box on a side where another tab is beside it: its slant, less the gap a row of controls keeps.
    var rowGapPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap-control-row")) || 4;
    function besideReach(el) { return Math.max(0, ((Number(el.getAttribute("data-cut-line")) || 0) - rowGapPx) / 2); }
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
      // Beside another tab, it reaches into the slant between them, so only the row's gap is left between its place and the next one's.
      var reach = besideReach(el), start = isFirst ? 0 : reach, end = isLast ? 0 : reach;
      el.style.width = tab.offsetWidth + start + end + "px"; el.style.transform = "translateX(" + (tab.offsetLeft - start) + "px)";
      // The edge rule: the slab slants only where another tab is beside it, and its end on the first or last tab follows the switch's end.
      el.setAttribute("data-cut-beside", ((isFirst ? "" : "start ") + (isLast ? "" : "end")).trim());
      var ends = ((isFirst ? "start " : "") + (isLast ? "end" : "")).trim();
      if (ends) el.setAttribute("data-cut-ends", ends); else el.removeAttribute("data-cut-ends");
      if (el.redrawCut) el.redrawCut(isGliding && from.beside !== null ? { from: from, ms: parseFloat(getComputedStyle(el).transitionDuration) * 1000 } : undefined);
    }
    // A switch on its own (not framed, so it can't scroll) whose tabs don't fit keeps them closer to their words.
    function fit() {
      if (isVertical || sw.classList.contains("framed")) return;
      sw.classList.remove("is-tight");
      if (sw.scrollWidth > sw.clientWidth + 0.5) sw.classList.add("is-tight");
    }
    // While a slide from the last page waits for the fonts, nothing moves the slab off the tab it starts on.
    var isWaitingToSlide = false;
    function settle() { if (isWaitingToSlide) return; fit(); var on = current(), focused = sw.querySelector(":scope > :focus-visible"), ring = sw.querySelector(".focus-ring"); slab.style.transition = "none"; put(slab, on); put(ghost, on); if (ring && focused) put(ring, focused); slab.offsetWidth; slab.style.transition = ""; sw.classList.add("is-ready"); }
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
      // In a row that scrolls, the picked tab comes into the middle of it.
      // A smooth scroll can be cut short (a touch still settling, the page scrolling too), so it lands there once the glide is over.
      var row = sw.closest("[data-fades-sideways]");
      if (row && row.scrollWidth > row.clientWidth) {
        var goal = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2));
        row.scrollTo({ left: goal, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        clearTimeout(row.settleTimer); row.settleTimer = setTimeout(function () { if (Math.abs(row.scrollLeft - goal) > 1) row.scrollTo({ left: goal, behavior: "smooth" }); }, 450);
      }
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
    // Keyboard focus: the ring takes the focused tab's place and shape, so the focus line follows its cut.
    var ring = sw.querySelector(".focus-ring");
    sw.addEventListener("focusin", function (event) {
      var tab = event.target;
      if (!ring || tab.parentElement !== sw || !tab.matches(":focus-visible")) return;
      put(ring, tab); sw.classList.add("is-focus-shown");
    });
    sw.addEventListener("focusout", function () { sw.classList.remove("is-focus-shown"); });
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
.tab-switch > a, .tab-switch > button { position: relative; z-index: 2; display: grid; place-content: center; padding: 0 var(--tab-room, 18px); border: 0; background: none; cursor: pointer;
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
/* Keyboard focus: a line round the focused tab that follows its cut, like the slab's (the focus ring, set by SWITCH_SCRIPT). */
.tab-switch > :focus-visible { outline: none; }
.tab-switch .focus-ring { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; z-index: 3; pointer-events: none; clip-path: var(--cut-shape); opacity: 0; }
.tab-switch.small .focus-ring { top: 3px; bottom: 3px; }
.tab-switch.vertical .focus-ring { top: 0; bottom: auto; left: 4px; right: 4px; width: auto; height: 0; }
.tab-switch.vertical.small .focus-ring { left: 3px; right: 3px; }
.tab-switch.is-focus-shown .focus-ring { opacity: 1; }
.tab-switch .focus-ring .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* The sort switch: the header's switch, smaller. */
.tab-switch.small { height: 36px; padding: 3px; clip-path: var(--cut-shape); }
.tab-switch.small .slab, .tab-switch.small .ghost { top: 3px; bottom: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
.tab-switch.small > a, .tab-switch.small > button { --tab-room: 14px; font-size: 14px; }
/* Tight: a switch whose tabs don't fit their room (two long ones, on a 320px phone) keeps them closer to their words (SWITCH_SCRIPT says so). */
.tab-switch.is-tight > a, .tab-switch.is-tight > button { --tab-room: 12px; }
.tab-switch.small.is-tight > a, .tab-switch.small.is-tight > button { --tab-room: 8px; }
/* The first and last tabs shown sit against the switch's cut corners, which eat into them at its ends: they take a slant's more room there.
   A folded tab isn't shown, so the ends are the first and last tabs that aren't folded (the cut line, slab, ghost and ring are hidden from readers, so they never count). */
.tab-switch:not(.vertical) > :nth-child(1 of :not(.folded):not([aria-hidden])) { padding-inline-start: calc(var(--tab-room, 18px) + var(--control-slant) / 2); }
.tab-switch:not(.vertical) > :nth-last-child(1 of :not(.folded):not([aria-hidden])) { padding-inline-end: calc(var(--tab-room, 18px) + var(--control-slant) / 2); }
/* Vertical: the same switch stacked, its places down a carved well (a page's own places, the gallery's groups). Each place is a row of
   its icon, its words and a count at its end; the slab spans the well and moves down it, and the ghost follows the pointer between them. */
.tab-switch.vertical { flex-direction: column; height: auto; }
.tab-switch.vertical .slab, .tab-switch.vertical .ghost { top: 0; bottom: auto; left: 4px; right: 4px; width: auto; height: 0; transition: transform 0.55s var(--spring), height 0.55s var(--spring), opacity 0.3s; }
.tab-switch.vertical.small .slab, .tab-switch.vertical.small .ghost { left: 3px; right: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
.tab-switch.vertical > a, .tab-switch.vertical > button { flex: none; display: flex; align-items: center; justify-content: flex-start; gap: 10px; height: 40px; padding: 0 14px; text-align: left; }
.tab-switch.vertical > a > .tag, .tab-switch.vertical > button > .tag { margin-left: auto; }
.tab-switch.vertical .ico { width: 18px; height: 18px; }
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
  name: "Color picker",
  slug: "color-picker",
  group: "inputs",
  summary: "Pick one color from a few: a glass button's tint, the glass's hue. Plain swatches in a carved well, like the switch's tabs; the picked one keeps its whole color, with an orange bar under it, and is named beside them.",
  styles: `
/* A color picker: plain swatches in a carved well, like the switch's tabs. A swatch is a control like any other, cut by the edge rule,
   so swatches side by side slant toward each other and the end ones follow the well's corners. */
.color-picker { display: flex; align-items: center; gap: 0; font: var(--type-facts); color: var(--ink-2); --clear-swatch: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
.color-well { position: relative; display: flex; flex: none; padding: 4px 4px 13px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape);
  --swatch-size: 32px; }
.color-well .color-pick:not(:last-of-type) { margin-inline-end: var(--gap-control-row-boxes); }
.color-picker-name { margin-left: var(--gap-words-control); }
.color-pick { position: relative; width: var(--swatch-size); height: var(--swatch-size); padding: 0; border: 0; cursor: pointer; background: var(--swatch); clip-path: var(--cut-shape); }
.color-pick .cut-line polygon { stroke: var(--line); stroke-width: 1; }
/* Pointed at: a light rim inside its cut. */
.color-pick:hover .cut-line polygon { stroke: var(--raise-top); stroke-width: 4; }
/* Picked: the swatch keeps its whole color, and an orange bar floats under it in the well's bottom: slanting with the swatches between
   colors, carved like the well's corner under the first or last. COLOR_PICKER_SCRIPT places it and gives it its shape; it glides to the next pick. */
.color-mark { position: absolute; left: 0; bottom: 4px; width: 0; height: 4px; background: var(--run); pointer-events: none; clip-path: var(--cut-shape);
  transition: transform 0.45s var(--spring), width 0.45s var(--spring), clip-path 0.45s var(--spring); }
/* Keyboard focus: the orange line round its cut, like every control's. */
.color-pick:focus-visible { outline: none; }
.color-pick:focus-visible .cut-line polygon, .color-pick.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .color-mark { transition: none; } }
`,
  render: colorPicker,
  examples: [
    { label: "Picked", markup: colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo" }) },
    { label: "Clear picked: a checker, the usual sign for see-through", markup: colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "clear" }) },
    { label: "Keyboard focus", markup: colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo", focusedValue: "blue" }) },
  ],
});

// Page settings sits with the switch and the color picker, which it uses (foundations.ts can't import this file).
/** Game-like colors for the gallery's hue example. */
const HUE_CHOICES: ColorChoice[] = [
  { name: "None", colorValue: "", swatch: "clear" },
  { name: "Crimson", colorValue: "#C8384A", swatch: "#C8384A" },
  { name: "Emerald", colorValue: "#2E9E6B", swatch: "#2E9E6B" },
  { name: "Violet", colorValue: "#7A4FD8", swatch: "#7A4FD8" },
  { name: "Gold", colorValue: "#D9A520", swatch: "#D9A520" },
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
      markup: html`<div data-setting-hue>${colorPicker({ label: "The glass's hue", choices: HUE_CHOICES, pickedValue: "" })}</div>`,
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
  document.querySelectorAll("[data-select]").forEach(function (root) {
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
    window.addEventListener("resize", function () { if (list.matches(":popover-open")) place(); });
    window.addEventListener("scroll", function () { if (list.matches(":popover-open")) place(); }, { passive: true, capture: true });
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
.slider-head > label { font: var(--type-label); color: var(--ink-2); }
.slider-head > output { font: var(--type-label); color: var(--ink); font-variant-numeric: tabular-nums; }
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
    { label: "Waiting for a file", isWide: true, markup: glassPane({ paneSize: "medium", body: fileDrop({ id: "example-drop-rest", name: "build", label: "Drop your game's folder as a .zip", accept: ".zip", hint: "Or tap to pick it. Up to 500 MB; the upload command takes bigger builds." }) }) },
    { label: "A file held over it", isWide: true, markup: glassPane({ paneSize: "medium", body: fileDrop({ id: "example-drop-over", name: "build", label: "Drop your game's folder as a .zip", accept: ".zip", hint: "Or tap to pick it. Up to 500 MB; the upload command takes bigger builds.", state: "over" }) }) },
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
.code-label { font: var(--type-label); color: var(--ink-2); }
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
