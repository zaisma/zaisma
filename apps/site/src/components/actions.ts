import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, ICONS, backdrop, colorPicker, glassPane, icon, loader, type ColorChoice, type IconName } from "./foundations.ts";
import { TOKEN_STYLES } from "./tokens.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { paneParts } from "./layout.ts";

/*
 * Actions, loudest to quietest: the primary button (the one colored thing you press), the secondary button beside it
 * (tinted for the other ways in), and the tertiary button below them. Each answers the pointer, the press
 * and the keyboard in its own way, so none of them feels dead.
 */

/** The runner's arrow: the icon set's chevron, in a span that moves. */
const ARROW = html`<span class="arrow" aria-hidden="true">${icon("chevron-right")}</span>`;

/** What a button is: a link when it has an address, otherwise a button of a form. */
interface ButtonTarget {
  /** Unique on the page, for the page's script to find it by (Play, a bar's Share). */
  id?: string;
  /** data-* attributes a page's script reads ({ keep: "/join" } is data-keep="/join"), names in lowercase words joined by dashes. */
  dataAttributes?: Record<string, string>;
  href?: string;
  type?: "submit" | "button";
  name?: string;
  buttonValue?: string;
  /** "dialog": it closes the sheet it's in instead of sending its form (a Cancel). */
  formMethod?: "dialog";
  /** Focused as its sheet opens: a confirm step's Cancel, so a stray Enter never confirms. */
  isAutofocused?: boolean;
}

/** The gallery's fixed states, so they sit still side by side. */
type ButtonState = "is-pointed" | "is-pressed" | "is-focused";

/** The button itself: a still shell that takes the pointer (TOKEN_STYLES, "Still under the pointer"). What moves goes inside it, in its face. */
const opening = (className: string, target: ButtonTarget, isBusy: boolean | undefined, extra: Raw | "" = "") =>
  target.href
    ? html`<a class="shell ${className}"${target.id ? html` id="${target.id}"` : ""}${dataMarkup(target)} href="${target.href}"${extra}${isBusy ? raw(' aria-busy="true"') : ""}>`
    : html`<button class="shell ${className}"${target.id ? html` id="${target.id}"` : ""}${dataMarkup(target)} type="${target.type ?? "submit"}"${extra}${target.name ? html` name="${target.name}"` : ""}${target.buttonValue !== undefined ? html` value="${target.buttonValue}"` : ""}${target.formMethod ? raw(' formmethod="dialog" formnovalidate') : ""}${target.isAutofocused ? raw(" autofocus") : ""}${isBusy ? raw(' aria-busy="true" disabled') : ""}>`;
const dataMarkup = (target: ButtonTarget): Raw | "" =>
  target.dataAttributes ? html`${Object.entries(target.dataAttributes).map(([name, text]) => html` data-${name}="${text}"`)}` : "";
const closing = (target: ButtonTarget) => raw(target.href ? "</a>" : "</button>");
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");
/** Can't be pressed now: a button is disabled (a busy one is already); a link can't be, so it's left as it is. */
const disabledAttribute = (target: ButtonTarget & { isDisabled?: boolean; isBusy?: boolean }) => (target.isDisabled && !target.isBusy && !target.href ? raw(" disabled") : "");

export interface PrimaryButtonOptions extends ButtonTarget {
  /** 56px (48 on a phone), for a pane's one main action: the home's Play, the sign-in page's Sign in. */
  isBig?: boolean;
  isFullWidth?: boolean;
  /** Pressed and waiting: the loader takes the arrow's (or icon's) place, and busyLabel (if any) the label's. */
  isBusy?: boolean;
  busyLabel?: string;
  /** An icon before the label in place of the arrow after it, like Play's. */
  icon?: IconName;
  /** Can't be pressed yet (a step's Next before what it needs is filled in): it's no longer orange, since orange is only what you can act on, but carved flat into the glass with quieter words. */
  isDisabled?: boolean;
  state?: ButtonState;
  /** Not shown for now: a page script shows it (the buy sheet's Make an account, for a guest). */
  isHidden?: boolean;
  /**
   * Words at the button's other end, the label staying at its start, in place of the arrow: a buy button's price ("Buy" … "$19.99").
   * Left out, the label leads and the arrow follows. An empty string keeps the place for a script to fill (it takes no room until it has words).
   */
  trailingText?: string;
  /**
   * Red, the one red in Zaisma, for a delete's confirm step and nowhere else (a Confirm sheet's isDelete): the runner's shape and edge
   * light with no glint and no lean, since it's the moment to stop and read. It takes only its label, type, busy and state.
   */
  isDelete?: boolean;
}

/** The primary button: a raised orange slab, the same height as the other buttons, lit along its edges. It lifts, leans toward the pointer and catches the light; pressing sinks it into the glass. */
export function primaryButton(label: string, options: PrimaryButtonOptions = {}): ControlMarkup {
  if (options.isDelete) return controlMarkup(dangerButton(label, options), "regular");
  // The label's span has no class of its own: html.ts's account link finds it as the header's runner's span without one.
  const words = options.busyLabel ? html`<span class="label-idle">${label}</span><span class="label-busy">${options.busyLabel}</span>` : html`<span>${label}</span>`;
  const shell = classes("run-wrap", options.isFullWidth && "is-full", options.state);
  const hasTrailing = options.trailingText !== undefined;
  const ending = hasTrailing ? html`<span class="run-trailing">${options.trailingText}</span>` : options.icon ? "" : ARROW;
  return controlMarkup(html`${opening(shell, options, options.isBusy, html`${disabledAttribute(options)}${options.isHidden ? raw(" hidden") : ""}`)}<span class="${options.isBig ? "face run big" : "face run"}${hasTrailing ? " has-trailing" : ""} cut-raised" data-cut-line="${options.isBig ? 14 : 12}">${CUT_LINE}${loader()}${options.icon ? icon(options.icon) : ""}${words}${ending}</span>${closing(options)}`, options.isBig ? "big" : "regular");
}

export interface SecondaryButtonOptions extends ButtonTarget {
  icon?: IconName;
  /** Another way in (a passkey, Google, Discord): its mark in the icon's place, and its slab tinted the way's color unless tint says otherwise. */
  wayIn?: WayIn;
  /** The way's color mixed into its slab: Discord's indigo, Google's plain. Left out, a way in's own, or none. */
  tint?: ButtonTint;
  /** Only the icon shows; the label is what a screen reader says (aria-label). */
  isLabelHidden?: boolean;
  isFullWidth?: boolean;
  isBusy?: boolean;
  state?: ButtonState;
  /** 56px, beside a big Play. */
  isBig?: boolean;
  /** 36px, inside a field (Show). */
  isSmall?: boolean;
  /** 30px, inside a carved strip of its own (Row arrows' well, the end of a search), which it fills but for the strip's inset. */
  isInWell?: boolean;
  /** Can't be pressed now: it's carved flat into the glass, its cut and edge kept, its words quieter. In a well of its own (a row's arrow at its end) it lies flat, faded. */
  isDisabled?: boolean;
  /** How many have reacted with it (a post's likes, a game's hearts), after its icon or words in figures that keep their width: a screen reader hears it after the label ("Like, 12"). */
  reactionCount?: number;
  /** The id of what it shows, hides or changes (aria-controls). */
  controls?: string;
  /** It opens what it controls (a dropdown, a search): whether that's open now (aria-expanded). Left out, it opens nothing. */
  isExpanded?: boolean;
  /** Not shown for now: a page script shows it (a step flow's Back on its first step). */
  isHidden?: boolean;
}

/**
 * A secondary button: a solid cut slab. It brightens under the pointer and carves in under a press. A delete is one too, never orange.
 * Another way in (a passkey, Google, Discord) is one with the way's mark, its slab tinted the way's color, as wide as the column.
 */
export function secondaryButton(label: string, options: SecondaryButtonOptions = {}): ControlMarkup {
  return secondaryButtonMarkup(label, options);
}

export interface ToggleButtonOptions extends Omit<SecondaryButtonOptions, "isBig" | "isInWell" | "isFullWidth" | "isExpanded" | "wayIn" | "tint"> {
  /** On or off (aria-pressed): the page's script flips it, and what it changes. */
  isPressed: boolean;
}

/**
 * A toggle button: something that stays on until it's pressed again (Follow, a like, Mute, a password's Show). Off, it rests level in the
 * glass, a slab like any secondary button, and carves in as it's pressed; on, its top surface rises from the same footprint and its orange front surface shows, so it never moves and a row of them stays in line.
 */
export function toggleButton(label: string, options: ToggleButtonOptions): ControlMarkup {
  return secondaryButtonMarkup(label, options, options.isPressed);
}

/**
 * The front surface is the top surface swept down to where it rests, as a solid's sides are: the face's own cut (the edge rule draws it),
 * its lower edges raised with the face and joined to where they rest, so it meets the face at every corner and slant.
 * Its upper edges follow the face's height as it animates, so the two can't part, however the toggle is pressed or turned midway.
 */
export const TOGGLE_SCRIPT = `/* toggle buttons */(function () {
  function pointsOf(shape) {
    var found = /polygon\\(([^)]*)\\)/.exec(shape || "");
    return found ? found[1].split(",").map(function (pair) { var xy = pair.trim().split(/\\s+/); return [parseFloat(xy[0]), parseFloat(xy[1])]; }) : null;
  }
  // What shows of the front surface: between the face's lower edges (from its rightmost point to its leftmost one, the way that runs under it),
  // raised as high as the face is now (--toggle-rise, which the CSS animates, never below where it rests), and the same edges where it rests.
  // In the front surface's box, which reaches up by the whole lift. Resting, it has no area at all: nothing of it can show.
  function swept(points, liftPx) {
    var n = points.length, xs = points.map(function (p) { return p[0]; }), minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    function extreme(x, isTop) { var best = -1; points.forEach(function (p, i) { if (Math.abs(p[0] - x) < 0.01 && (best < 0 || (isTop ? p[1] < points[best][1] : p[1] > points[best][1]))) best = i; }); return best; }
    var leftTop = extreme(minX, true), leftBottom = extreme(minX, false), rightTop = extreme(maxX, true), rightBottom = extreme(maxX, false);
    // Which way round from the top left reaches the top right before the bottom right.
    var step = 1;
    for (var i = leftTop, guard = 0; guard < n; guard++, i = (i + 1) % n) { if (i === rightTop) break; if (i === rightBottom && rightBottom !== rightTop) { step = -1; break; } }
    function walk(from, to) { var chain = [], i = from; for (var guard = 0; guard <= n; guard++) { chain.push(points[i]); if (i === to) break; i = (i + step + n) % n; } return chain; }
    var lower = walk(rightTop, leftTop);
    var raised = lower.map(function (p) { return p[0].toFixed(2) + "px calc(" + (p[1] + liftPx).toFixed(2) + "px - max(var(--toggle-rise), 0px))"; });
    var resting = lower.slice().reverse().map(function (p) { return p[0].toFixed(2) + "px " + (p[1] + liftPx).toFixed(2) + "px"; });
    return "polygon(" + raised.concat(resting).join(", ") + ")";
  }
  window.zaismaWatch.each(".toggle-btn", function (button) {
    var face = button.querySelector(":scope > .face"), front = button.querySelector(":scope > .toggle-front");
    if (!face || !front) return;
    function draw() {
      var points = pointsOf(face.style.getPropertyValue("--cut-shape")), liftPx = parseFloat(getComputedStyle(button).getPropertyValue("--toggle-lift")) || 0;
      if (points && points.length >= 3) front.style.setProperty("--front-shape", swept(points, liftPx));
    }
    draw();
    new MutationObserver(draw).observe(face, { attributes: true, attributeFilter: ["style"] });
  });
})();
`;

// A toggle is a secondary button with a front surface below its top surface (its face), showing when the face rises.
function secondaryButtonMarkup(label: string, options: SecondaryButtonOptions, isPressed?: boolean): ControlMarkup {
  const isToggle = isPressed !== undefined;
  const hasCount = options.reactionCount !== undefined;
  const countWords = hasCount ? Number(options.reactionCount).toLocaleString("en-US") : "";
  const isIconOnly = options.isLabelHidden && !hasCount;
  const tint = options.tint ?? (options.wayIn ? WAY_TINTS[options.wayIn] : undefined);
  const className = classes("cut-btn", isToggle && "toggle-btn", options.isBig && "big", options.isSmall && "small", options.isInWell && "in-well", isIconOnly && "icon-only", options.isFullWidth && "is-full", options.state);
  const extra = html`${disabledAttribute(options)}${isIconOnly ? html` aria-label="${label}"` : ""}${isToggle ? html` aria-pressed="${isPressed ? "true" : "false"}"` : ""}${options.controls ? html` aria-controls="${options.controls}"` : ""}${options.isExpanded !== undefined ? html` aria-expanded="${options.isExpanded ? "true" : "false"}"` : ""}${options.isHidden ? raw(" hidden") : ""}${tint ? html` data-tint="${tint}"` : ""}`;
  // Its icon and count with the label hidden: the label is still said, before the count ("Like, 12"), so a page that changes the count changes what's said.
  // The label's span has no class of its own, as on the runner (html.ts's account link finds it that way).
  const words = !options.isLabelHidden ? html`<span>${label}</span>` : hasCount ? html`<span class="sr">${label}, </span>` : "";
  const reactionMarkup = hasCount ? html`<span class="cut-count">${countWords}</span>` : "";
  const cutLine = options.isBig ? 13 : 10;
  const front = isToggle ? html`<span class="toggle-front" aria-hidden="true"></span>` : "";
  return controlMarkup(html`${opening(className, options, options.isBusy, extra)}${front}<span class="face cut-raised" data-cut-line="${cutLine}">${CUT_LINE}${loader()}${options.wayIn ? html`<span class="way-mark">${WAY_MARKS[options.wayIn]}</span>` : options.icon ? icon(options.icon) : ""}${words}${reactionMarkup}</span>${closing(options)}`, options.isBig ? "big" : options.isSmall || options.isInWell ? "small" : "regular");
}

const GOOGLE = raw(
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
);
const DISCORD = raw(
  '<svg class="one-color" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25 19.74 19.74 0 0 0-4.88 1.52C.53 9.050-.32 13.58.1 18.06a19.9 19.9 0 0 0 5.99 3.03c.46-.63.87-1.3 1.23-1.99a13.1 13.1 0 0 1-1.870-.9l.37-.29c3.93 1.79 8.18 1.79 12.06 0l.37.29c-.6.35-1.22.65-1.87.9.36.7.77 1.36 1.22 1.99a19.84 19.84 0 0 0 6-3.03c.5-5.18-.84-9.68-3.55-13.66zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.420 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.420 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/></svg>',
);
/** The other ways in, with the marks their owners ask for. A mark that may also be one color (Discord's) is class one-color. */
const WAY_MARKS = { google: GOOGLE, discord: DISCORD, passkey: raw(ICONS.passkey) } as const;
export type WayIn = keyof typeof WAY_MARKS;

/**
 * A secondary button's tint: none ("clear"), or a way in's color mixed into its slab. Each way has its own unless the page picks one. "plain" is
 * the glass's own tone, as Google's buttons are: whiter on light glass, nearer Google's black on smoked.
 */
export type ButtonTint = "clear" | "plain" | "blue" | "indigo" | "black";
const WAY_TINTS: Record<WayIn, ButtonTint> = { google: "plain", discord: "indigo", passkey: "clear" };

/**
 * The primary button: it lifts and leans toward the pointer, a reflection slides the other way, and one glint sweeps as
 * the pointer arrives and always finishes. The pointer is followed on the still shell; the lift and lean are set there
 * for its face and its side, which move inside it.
 */
/**
 * Busy: a button that sends a form, or a link-button that opens another page, shows the loader once it's pressed (aria-busy) and
 * can't be pressed twice. Coming back to the page from the browser's history puts it back as it was.
 */
export const BUSY_SCRIPT = `/* busy */(function () {
  function busy(button) {
    if (!button || button.getAttribute("aria-busy") === "true") return;
    button.setAttribute("aria-busy", "true");
    if (button.tagName === "BUTTON") setTimeout(function () { button.disabled = true; }, 0);
  }
  // Checked once every handler has run, so a page script that handles the press itself (and prevents it) keeps it idle.
  function afterHandlers(event, then) { setTimeout(function () { if (!event.defaultPrevented) then(); }, 0); }
  document.addEventListener("submit", function (event) {
    // Closing a sheet (a Cancel, its close button) sends nothing, so nothing waits.
    if (event.target.getAttribute("method") === "dialog" || (event.submitter && event.submitter.getAttribute("formmethod") === "dialog")) return;
    var button = (event.submitter && event.submitter.closest(".shell")) || event.target.querySelector('.shell[type="submit"]');
    afterHandlers(event, function () { busy(button); });
  });
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a.shell[href]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
    var to = new URL(link.href, location.href);
    if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return;
    afterHandlers(event, function () { busy(link); });
  });
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    document.querySelectorAll('.shell[aria-busy="true"]').forEach(function (button) { button.removeAttribute("aria-busy"); button.disabled = false; });
  });
})();
`;

export const RUNNER_SCRIPT = `/* runner */(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Clicked, its light flares and settles (is-flaring), with a finger too; the click itself goes on at once.
  document.addEventListener("click", function (event) {
    var shell = event.target.closest && event.target.closest(".run-wrap");
    if (!shell || shell.disabled || shell.getAttribute("aria-busy") === "true") return;
    shell.classList.remove("is-flaring"); void shell.offsetWidth; shell.classList.add("is-flaring");
  });
  document.addEventListener("animationend", function (event) { if (event.animationName === "run-flare" && event.target.classList) event.target.classList.remove("is-flaring"); });
  if (!window.matchMedia("(hover: hover)").matches) return;
  function lean(shell) {
    if (shell.dataset.lean) return; shell.dataset.lean = "1";
    var face = shell.querySelector(".run"); if (!face) return;
    shell.addEventListener("pointerenter", function () {
      shell.classList.add("over"); shell.style.setProperty("--lift", "-1.5px");
      if (!face.classList.contains("glint")) face.classList.add("glint");
    });
    face.addEventListener("animationend", function (event) { if (event.animationName === "run-glint") face.classList.remove("glint"); });
    shell.addEventListener("pointerleave", function () { shell.classList.remove("over"); ["--lift", "--rx", "--ry"].forEach(function (p) { shell.style.removeProperty(p); }); face.style.removeProperty("--refl"); });
    shell.addEventListener("pointermove", function (event) {
      var r = shell.getBoundingClientRect(), px = (event.clientX - r.left) / r.width - 0.5, py = (event.clientY - r.top) / r.height - 0.5;
      shell.style.setProperty("--ry", (px * 6).toFixed(2) + "deg"); shell.style.setProperty("--rx", (-py * 9).toFixed(2) + "deg"); face.style.setProperty("--refl", (50 - px * 70).toFixed(1) + "%");
    });
  }
  document.querySelectorAll(".run-wrap").forEach(lean);
  window.zaismaWatch.page(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(function (node) { if (node.querySelectorAll) node.querySelectorAll(".run-wrap").forEach(lean); }); }); });
})();
`;

const SPRING = "cubic-bezier(.25,.9,.3,1.25)";

const RUN_STYLES = `
/* The primary button: the one colored thing you can press. A raised orange slab, the same height as every other button,
   lit along its edges like the other raised controls (the edge rule's bands, in orange). It lifts, leans toward you and
   a glint crosses it as you arrive; a press brings it down toward the glass, never carving it, and it springs back.
   The shell (.run-wrap, the link or button) stays still; its face (.run) moves inside it.
   .over is the pointer on it (RUNNER_SCRIPT); is-pointed, is-pressed and is-focused fix those states for the gallery. */
.run-wrap { isolation: isolate; vertical-align: middle; max-width: 100%; perspective: 600px; }
.run-wrap:focus-visible { outline: none; }
/* Words longer than the room it has end in an ellipsis on one line, never spilling out of it or growing it past its height. */
.run { min-width: 0; }
.run > span:not([class]), .run > .label-idle, .run > .label-busy { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.run-wrap.is-full { display: flex; width: 100%; perspective: 700px; }
/* Its warm glow on what's under it: it spreads as the slab lifts and gathers in as it's pressed. */
/* It floats over the glass, and what it casts on it comes from its own shape (--run-cast): an orange glow round all its edges on smoked
   glass, strongest below; a shadow under it and a little round it on light glass. Pointed, it rises and its light or shadow spreads; pressed,
   it comes down toward the glass and they pull in tight. */
.run-wrap { filter: var(--run-cast); transition: filter 0.35s cubic-bezier(.2,.7,.2,1); }
.run-wrap.over, .run-wrap.is-pointed { filter: var(--run-cast-up); }
.run-wrap:active, .run-wrap.is-pressed { filter: var(--run-cast-down); transition-duration: 0.1s; }
/* Clicked, its light flares, brighter and wider (--run-flare), and settles back to what it was over half a second (RUNNER_SCRIPT). */
.run-wrap.is-flaring { animation: run-flare 0.6s ease-out; }
.run-wrap.is-flaring > .run { animation: run-flare-face 0.45s ease-out; }
@keyframes run-flare { from { filter: var(--run-flare); } }
@keyframes run-flare-face { from { filter: brightness(1.16); } }
.run {
  --refl: 50%;
  --control-height: var(--control-height-regular);
  position: relative; z-index: 1; overflow: hidden; height: var(--control-height); padding: 0 24px 0 22px;
  display: flex; align-items: center; gap: 10px; white-space: nowrap;
  color: var(--on-run); text-shadow: 0 1px 0 rgba(255,226,180,0.45);
  font: 600 1rem var(--display); letter-spacing: 0.01em;
  /* The face: lit from above, deepening toward its foot. */
  background: radial-gradient(130% 110% at 50% -35%, rgba(255,255,255,0.3), rgba(255,255,255,0) 62%), linear-gradient(180deg, var(--run-hi), var(--run) 52%, #E57F0C);
  clip-path: var(--cut-shape);
  transform: translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.45s ${SPRING}, --refl 0.6s cubic-bezier(.2,.7,.2,1), filter 0.2s;
}
/* Its edge light: bright where the light lands on its top and leading edges, its own orange's shade along its foot. */
.run.cut-raised > .cut-line { --band-top: rgba(255,240,214,0.85); --band-left: rgba(255,226,180,0.55); --band-right: rgba(150,72,0,0.32); --band-bottom: rgba(130,60,0,0.55); }
.is-full > .run { width: 100%; justify-content: center; }
/* With words at its far end (a price): the label leads from the start and the words close it at the end, nothing between but the room. */
.is-full > .run.has-trailing { justify-content: flex-start; }
.run.has-trailing > :is(span:not([class]), .label-idle, .label-busy) { flex: 1 1 auto; text-align: start; }
.run-trailing { flex: none; font-variant-numeric: tabular-nums; }
.run-trailing:empty { display: none; }
.run.big { --control-height: var(--control-height-big); justify-content: center; padding: 0 30px 0 26px; font-size: 1.1875rem; gap: 12px; }
/* The reflection of a fixed light: a soft band that slides the opposite way to the pointer. */
.run::before { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, rgba(255,255,255,0) calc(var(--refl) - 22%), rgba(255,255,255,0.2) var(--refl), rgba(255,255,255,0) calc(var(--refl) + 22%)); opacity: 0; transition: opacity 0.6s; }
.run-wrap.over .run::before, .run-wrap.is-pointed .run::before { opacity: 1; }
/* The glint: one sweep as the pointer arrives, always finished. */
.run::after { content: ""; position: absolute; top: -20%; bottom: -20%; width: 36%; left: -50%; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0)); transform: skewX(-20deg); pointer-events: none; }
.run.glint::after { animation: run-glint 0.45s cubic-bezier(.3,.1,.3,1) both; }
@keyframes run-glint { from { left: -50%; } to { left: 120%; } }
.run > :not(.cut-line) { position: relative; z-index: 2; }
.run .arrow, .run .play { display: inline-flex; flex: none; transition: transform 0.6s cubic-bezier(.2,.7,.2,1); }
.run .arrow > .ico { width: 9px; height: 14px; stroke-width: 2.6; }
.run-wrap.over .run .arrow, .run-wrap.is-pointed .run .arrow { transform: translateX(4px); }
.run-wrap.over .run .play, .run-wrap.is-pointed .run .play { transform: translateX(3px) scale(1.08); }
.run-wrap.is-pointed { --lift: -1.5px; }
/* Pressed: it sinks into the glass, a touch darker, its light turned round as on a carved control; it springs back when let go. */
/* Pressed, it lands: down toward the glass, its light kept as it is. It floats, so it never carves. */
.run-wrap:active > .run, .run-wrap.is-pressed > .run { --lift: 1px; transition-duration: 0.08s; }
/* Keyboard focus: the focus line inside its cut, in the deeper orange, since it's orange itself. */
.run-wrap:focus-visible > .run > .cut-line polygon, .run-wrap.is-focused > .run > .cut-line polygon { stroke: var(--focus-on-run); stroke-width: var(--focus-stroke); }
/* Busy: pressed and waiting. The arrow drifts on; the label says what's happening when the page gave one. */
.run-wrap[aria-busy="true"] { cursor: progress; }
.run-wrap[aria-busy="true"] .label-idle, .run-wrap:not([aria-busy="true"]) .label-busy { display: none; }
/* Waiting: the loader takes the arrow's or the icon's place. */
.run-wrap:not([aria-busy="true"]) .loader, .run-wrap[aria-busy="true"] .arrow, .run-wrap[aria-busy="true"] .face > .ico, .run-wrap[aria-busy="true"] .face > .play { display: none; }
.run .loader { position: relative; z-index: 2; }
@keyframes run-drift { 0%, 100% { transform: translateX(0); opacity: 0.55; } 50% { transform: translateX(7px); opacity: 1; } }
/* Can't press yet: orange is only what you can act on, so it isn't orange. It's carved flat into the glass, as a disabled secondary button is,
   its cut and edge kept, its words quieter, and it answers no pointer: no glow, no lift, no glint. */
.run-wrap:disabled:not([aria-busy="true"]) { cursor: default; pointer-events: none; }
.run-wrap:disabled:not([aria-busy="true"]) { filter: none; }
.run-wrap:disabled:not([aria-busy="true"]) > .run { background: var(--off-face); box-shadow: var(--well-shade); color: var(--muted); text-shadow: none; transform: none; }
.run-wrap:disabled:not([aria-busy="true"]) > .run::before, .run-wrap:disabled:not([aria-busy="true"]) > .run::after { content: none; }
.run-wrap:disabled:not([aria-busy="true"]) > .run > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.run-wrap:disabled:not([aria-busy="true"]) > .run > .cut-line polygon { stroke: var(--carve-rim); stroke-width: 2; }
/* On a phone it keeps the other buttons' heights: 44px, and big 48px (--control-height-big). */
@media (max-width: 760px) { .run { padding: 0 20px 0 16px; font-size: 0.9375rem; } .run.big { font-size: 1.0625rem; } }
@media (prefers-reduced-motion: reduce) { .run, .run .arrow, .run .play, .run-wrap::before { transition: none; } .run.glint::after { animation: none; } }
`;

/** A full-width button's examples sit in a column this wide. */
const COLUMN = "width:min(340px,100%)";

/**
 * A button's states, still, side by side; then one to try, and one that points, presses and lets go on a loop
 * (the gallery's design-loops script plays it: data-state-loop names what it plays). Full-width buttons get a column.
 */
const stateExamples = (render: (state?: ButtonState) => Raw, loopKind: "runner" | "cut" | "tertiary", isFullWidth = false) => {
  const sized = (markup: Raw) => (isFullWidth ? html`<div style="${COLUMN}">${markup}</div>` : markup);
  return [
    { label: "Rest", markup: sized(render()), isStill: true },
    { label: "Pointed", markup: sized(render("is-pointed")), isStill: true },
    { label: "Pressed", markup: sized(render("is-pressed")), isStill: true },
    { label: "Keyboard focus", markup: sized(render("is-focused")), isStill: true },
    { label: "Try it", markup: sized(render()) },
    { label: "On a loop", markup: html`<span data-state-loop="${loopKind}"${isFullWidth ? html` style="${COLUMN}"` : ""}>${render()}</span>`, isStill: true },
  ];
};

/** The red one: the runner's shape and edge light, in red, with no glint and no lean. Only a delete's confirm step has it (primaryButton's isDelete). */
function dangerButton(label: string, options: PrimaryButtonOptions): Raw {
  return html`${opening(classes("danger-wrap", options.state), { type: options.type ?? "submit" }, options.isBusy)}<span class="face danger cut-raised" data-cut-line="12">${CUT_LINE}${loader()}<span class="danger-words">${label}</span></span>${closing({})}`;
}

const DANGER_STYLES = `
/* A delete's confirm: the runner's shape, height and edge light, in red; no glint and no lean, since it's the moment to stop and read.
   A press carves it in where it is, its light turned round, never moving it. The shell stays still. */
.danger-wrap { vertical-align: middle; max-width: 100%; }
.danger-wrap:focus-visible { outline: none; }
.danger { --control-height: var(--control-height-regular); position: relative; overflow: hidden; display: flex; flex: auto; align-items: center; justify-content: center; gap: 10px; min-width: 0; height: var(--control-height); padding: 0 24px;
  color: #fff; text-shadow: 0 1px 1px rgba(90,10,0,0.35); font: 600 1rem var(--display); white-space: nowrap;
  --face-color: var(--danger); background: radial-gradient(130% 110% at 50% -35%, rgba(255,255,255,0.24), rgba(255,255,255,0) 62%), linear-gradient(180deg, rgba(255,255,255,0.06), rgba(80,0,0,0.14)), var(--face-color);
  clip-path: var(--cut-shape); transition: --face-color 0.2s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
.danger.cut-raised > .cut-line { --band-top: rgba(255,214,206,0.8); --band-left: rgba(255,196,186,0.5); --band-right: rgba(110,20,10,0.35); --band-bottom: rgba(96,14,4,0.55); }
.danger > :not(.cut-line) { position: relative; z-index: 2; }
/* A long name ("Delete Ashen Crown: The Long Night") ends in an ellipsis on one line; the sheet's sentence above says what goes in full. */
.danger-words { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.danger-wrap:hover > .danger, .danger-wrap.is-pointed > .danger { --face-color: #E44A3B; }
.danger-wrap:active > .danger, .danger-wrap.is-pressed > .danger { --face-color: var(--danger-lo); box-shadow: inset 0 2px 5px rgba(60,0,0,0.35); transition-duration: 0.08s; }
.danger-wrap:active > .danger > .cut-line, .danger-wrap.is-pressed > .danger > .cut-line { --band-top: rgba(96,14,4,0.5); --band-left: rgba(110,20,10,0.35); --band-right: rgba(255,196,186,0.4); --band-bottom: rgba(255,214,206,0.6); }
.danger-wrap:focus-visible > .danger > .cut-line polygon, .danger-wrap.is-focused > .danger > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.danger-wrap[aria-busy="true"] { cursor: progress; }
.danger-wrap:not([aria-busy="true"]) .loader { display: none; }
[data-glass] .control-row > .danger-wrap > .danger { width: 100%; }
@media (max-width: 760px) { .danger { padding: 0 20px; font-size: 0.9375rem; } }
@media (prefers-reduced-motion: reduce) { .danger { transition: --face-color 0.2s; } }
`;

component({
  name: "Primary button",
  slug: "primary-button",
  group: "actions",
  subgroup: "buttons",
  summary: "The one thing to do on a screen: Play, Sign in, Next. Never more than one in view, and visible without scrolling.",
  styles: RUN_STYLES + DANGER_STYLES,
  render: primaryButton,
  examples: [
    ...stateExamples((state) => primaryButton("Sign in", { type: "button", state }), "runner"),
    { label: "Busy, saying what's happening", markup: primaryButton("Sign in", { type: "button", isBusy: true, busyLabel: "Signing in" }), isStill: true },
    { label: "Busy, keeping its words", markup: primaryButton("Next", { type: "button", isBusy: true }), isStill: true },
    { label: "Can't press yet", markup: primaryButton("Next", { type: "button", isDisabled: true }), isStill: true },
    { label: "Big, with Play", markup: primaryButton("Play", { type: "button", isBig: true, icon: "play" }) },
    { label: "Big and full width, as on Sign in", markup: html`<div style="${COLUMN}">${primaryButton("Sign in", { type: "button", isFullWidth: true, isBig: true })}</div>` },
    { label: "With its price at the other end (a buy button)", markup: html`<div style="${COLUMN}">${primaryButton("Buy", { type: "button", isFullWidth: true, trailingText: "$19.99" })}</div>` },
    { label: "With its price, busy", markup: html`<div style="${COLUMN}">${primaryButton("Buy", { type: "button", isFullWidth: true, trailingText: "$19.99", isBusy: true, busyLabel: "Buying" })}</div>`, isStill: true },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${primaryButton("Play Ashen Crown: The Long Night of the Iron Vigil", { type: "button", isFullWidth: true, isBig: true, icon: "play" })}</div>` },
    { label: "Red: a delete's confirm, only in a Confirm sheet", markup: primaryButton("Delete Ashen Crown", { isDelete: true }) },
    { label: "Red, pointed", markup: primaryButton("Delete Ashen Crown", { isDelete: true, state: "is-pointed" }), isStill: true },
    { label: "Red, pressed: it carves in", markup: primaryButton("Delete Ashen Crown", { isDelete: true, state: "is-pressed" }), isStill: true },
    { label: "Red, deleting", markup: primaryButton("Delete Ashen Crown", { isDelete: true, isBusy: true }), isStill: true },
  ],
});

/**
 * A game's world for buttons to sit on: a shader background with no words in it (never a cover, whose art has its title), and the glass
 * fixed to what it is, light over a bright world and smoked over a dark one, as the world's measured glass would be.
 */
const world = (standInSlug: string, glassKind: "light" | "smoked", body: Raw) =>
  html`<div ${glassKind === "light" ? raw('data-theme-choice="light"') : raw('class="smoke"')} style="position:relative;overflow:hidden;display:grid;gap:var(--gap-control-stack);width:min(380px,100%);padding:var(--pad-pane)">${backdrop({ isFramed: true, standInSlug })}${body}</div>`;
/** A secondary button's tints, for a color picker (inputs.ts's Color picker, the gallery's tint palette). */
export const TINT_CHOICES: (ColorChoice & { colorValue: ButtonTint })[] = [
  { name: "Clear", colorValue: "clear", swatch: "clear" },
  // Plain follows the glass: white on light, Google's near-black on smoked, so its swatch shows both, half and half.
  { name: "Plain", colorValue: "plain", swatch: "linear-gradient(135deg, #fff 50%, #131314 50%)" },
  { name: "Blue", colorValue: "blue", swatch: "#2A75E8" },
  { name: "Indigo", colorValue: "indigo", swatch: "#5865F2" },
  { name: "Black", colorValue: "black", swatch: "#14171C" },
];
const tintPalette = () => html`<div class="tint-try" data-tint-try>${wayButton("Continue with Discord", "discord")}${colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo" })}</div>`;
const wayButton = (label: string, wayIn: WayIn, more: Omit<SecondaryButtonOptions, "wayIn"> = {}) => secondaryButton(label, { type: "button", wayIn, isFullWidth: true, ...more });
const waysIn = () => html`${wayButton("Sign in with a passkey", "passkey")}${wayButton("Continue with Google", "google")}${wayButton("Continue with Discord", "discord")}`;

component({
  name: "Secondary button",
  slug: "secondary-button",
  group: "actions",
  subgroup: "buttons",
  summary: "Everything else you can press: Details, Make an account, Cancel. Another way in (a passkey, Google, Discord) is one with the way's mark and color. A delete is a secondary button too, never orange; only its confirm step turns red.",
  styles: `
/* A secondary button: a solid cut slab with a drawn outline, the same slab a Toggle button is. Under the pointer it brightens and stays
   where it is; a press carves it in where it is (shaded from above, its light turned round), never moving or shrinking it, quickly, and it
   comes back when let go. The shell (the button) stays still; the slab is its face. */
.cut-btn { --control-height: var(--control-height-regular); flex: none; vertical-align: middle; max-width: 100%; transition: filter 0.2s; }
.cut-btn.big { --control-height: var(--control-height-big); }
.cut-btn.small { --control-height: var(--control-height-small); }
.cut-btn.is-full { display: flex; width: 100%; }
.cut-btn > .face { display: flex; flex: auto; align-items: center; justify-content: center; gap: 8px; min-width: 0; height: var(--control-height);
  --face-padding: 24px; --face-shift: 0px; padding: 0 calc(var(--face-padding) - var(--face-shift)) 0 calc(var(--face-padding) + var(--face-shift));
  font: 600 0.9375rem var(--display); color: var(--ink); white-space: nowrap;
  --face-color: var(--btn); background: var(--face-color); clip-path: var(--cut-shape);
  transition: --face-color 0.2s, color 0.2s, box-shadow 0.2s, opacity 0.15s, transform 0.4s ${SPRING}; }
/* Words longer than the room it has end in an ellipsis on one line. */
.cut-btn .face > span:not([class]) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* A count (a post's likes): figures of one width, so it never shifts as it changes, a weight lighter than the words. */
.cut-count { font-weight: 500; font-variant-numeric: tabular-nums; }
/* Big keeps the same slant angle as the rest, so it is the same button, larger. */
.cut-btn.big > .face { --face-padding: 28px; font-size: 1.0625rem; }
.cut-btn.small > .face { --face-padding: 14px; }
/* Its words center in what shows of the button, as an icon alone does: one slanted end (beside another control in a row) loses half its
   slant at mid-height, so the words move a quarter slant away from it; the button keeps its width. Slanted at both ends, they stay put. */
.cut-btn > .face[data-slanted="start"] { --face-shift: calc(var(--control-slant) / 4); }
.cut-btn > .face[data-slanted="end"] { --face-shift: calc(var(--control-slant) / -4); }
/* Only its icon: as wide as a little more than it's tall, and never narrower, even sharing a row's width. */
.cut-btn.icon-only > .face { width: 52px; min-width: 52px; padding: 0; }
.cut-btn.small.icon-only > .face { width: 42px; min-width: 42px; }
/* An icon alone centers in what shows of the button: a slanted end gives up half its slant. */
.cut-btn.icon-only > .face[data-slanted~="start"] { padding-left: calc(var(--control-slant) / 2); }
.cut-btn.icon-only > .face[data-slanted~="end"] { padding-right: calc(var(--control-slant) / 2); }
.cut-btn.in-well > .face { height: 30px; --face-padding: 14px; color: var(--ink-2); }
.cut-btn.in-well.icon-only > .face { width: 46px; padding: 0; }
.cut-btn:hover > .face, .cut-btn.is-pointed > .face { --face-color: var(--btn-hover); }
.cut-btn:active > .face, .cut-btn.is-pressed > .face { --face-color: var(--btn-press); box-shadow: var(--press-shade); transition-duration: 0.08s; }
/* A press sinks it into the glass: its light turns round, as on a carved field, and its shade goes. */
.cut-btn:active, .cut-btn.is-pressed { filter: none; }
.cut-btn:active > .face > .cut-line, .cut-btn.is-pressed > .face > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.cut-btn:focus-visible { outline: none; }
.cut-btn:focus-visible > .face, .cut-btn.is-focused > .face { --face-color: var(--btn-hover); }
.cut-btn:focus-visible .cut-line polygon, .cut-btn.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.cut-btn .face > span:not(.sr), .cut-btn .face > .ico { position: relative; z-index: 2; }
/* Can't press: carved flat into the glass like a field, its cut and edge kept (on smoked glass, with a carving's light rim), its words
   quieter, and it answers no pointer. */
.cut-btn:disabled:not([aria-busy="true"]) { cursor: default; pointer-events: none; }
.cut-btn:disabled:not([aria-busy="true"]) > .face { --face-color: var(--off-face); box-shadow: var(--well-shade); color: var(--muted); transform: none; }
.cut-btn:disabled:not([aria-busy="true"]) > .face > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.cut-btn:disabled:not([aria-busy="true"]) > .face > .cut-line polygon { stroke: var(--carve-rim); stroke-width: 2; }
/* In a well of its own (a row's arrow at its end) it lies flat in the well, faded. */
.cut-btn.in-well:disabled:not([aria-busy="true"]) > .face { --face-color: transparent; box-shadow: none; color: var(--ink-2); opacity: 0.35; }
.cut-btn.in-well:disabled:not([aria-busy="true"]) > .face > .cut-line { --band-top: transparent; --band-left: transparent; --band-right: transparent; --band-bottom: transparent; }
.cut-btn.in-well:disabled:not([aria-busy="true"]) > .face > .cut-line polygon { stroke: transparent; }
.cut-btn[aria-busy="true"] { cursor: progress; }
/* Waiting: the loader before its words, in the icon's place. */
.cut-btn:not([aria-busy="true"]) .loader, .cut-btn[aria-busy="true"] .face > .ico { display: none; }
.cut-btn .face > .loader { position: relative; z-index: 2; }
/* On a touch screen a small one (36px) still takes a finger: its hit area reaches out to a regular control's 44px, its look unchanged. */
@media (pointer: coarse) { .cut-btn.small::after { content: ""; position: absolute; inset: calc((var(--control-height) - var(--touch-target)) / 2); } }
@media (max-width: 760px) { .cut-btn.big > .face { --face-padding: 20px; } }
@media (prefers-reduced-motion: reduce) { .cut-btn > .face { transition: --face-color 0.2s, color 0.2s; } }
/* Another way in: its mark before its words, and the way's color mixed into its slab (a brand's color is how you recognize it, so it
   doesn't follow light or dark; mixed in, the words keep the ink's color in either theme). Plain is the glass's own tone, as Google's
   buttons are; clear is the slab as it is. It points and carves like any secondary button. */
.cut-btn[data-tint] > .face { --way: var(--btn); --way-mix: 0%; --face-color: color-mix(in srgb, var(--way) var(--way-mix), var(--btn)); }
.cut-btn[data-tint]:hover > .face, .cut-btn[data-tint].is-pointed > .face, .cut-btn[data-tint]:focus-visible > .face, .cut-btn[data-tint].is-focused > .face { --face-color: color-mix(in srgb, var(--way) var(--way-mix), var(--btn-hover)); }
.cut-btn[data-tint]:active > .face, .cut-btn[data-tint].is-pressed > .face { --face-color: color-mix(in srgb, var(--way) var(--way-mix), var(--btn-press)); }
.cut-btn[data-tint]:not([data-tint="clear"]) > .face { --way-mix: 22%; }
.cut-btn[data-tint="plain"] > .face { --way: light-dark(#fff, #131314); --way-mix: 60%; }
.cut-btn[data-tint="blue"] > .face { --way: #2A75E8; }
.cut-btn[data-tint="indigo"] > .face { --way: #5865F2; }
.cut-btn[data-tint="black"] > .face { --way: #14171C; }
.way-mark { display: inline-flex; flex: none; }
.way-mark > svg { width: 20px; height: 20px; }
/* A mark that may be one color (Discord's) is white over smoked glass and its own blue over light (the fallback, since light glass leaves
   --clear-glass-mark unset). Google's G stays in its colors. Waiting, the loader takes the mark's place; can't press, the mark fades. */
.way-mark .one-color path { fill: var(--clear-glass-mark, #5865F2); transition: fill 0.3s; }
.cut-btn[aria-busy="true"] .way-mark { display: none; }
.cut-btn:disabled:not([aria-busy="true"]) .way-mark { opacity: 0.45; }
.cut-btn:disabled:not([aria-busy="true"]) .way-mark .one-color path { fill: currentColor; }
/* The gallery's tint palette: a Color picker; pick one and the button above takes it (GALLERY_SCRIPT). */
.tint-try { display: grid; gap: var(--gap-block-block); width: min(340px, 100%); }
`,
  render: secondaryButton,
  examples: [
    ...stateExamples((state) => secondaryButton("Details", { type: "button", state }), "cut"),
    { label: "Busy", markup: secondaryButton("Saving", { type: "button", isBusy: true }), isStill: true },
    { label: "With an icon", markup: secondaryButton("Settings", { type: "button", icon: "gear" }) },
    { label: "Only its icon", markup: secondaryButton("Light. Switch to dark", { type: "button", icon: "light-dark", isLabelHidden: true }) },
    { label: "Small", markup: secondaryButton("Show", { type: "button", isSmall: true }) },
    { label: "Small, only its icon: a sheet's Close, a Copy", markup: html`<div class="control-row">${secondaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true })}${secondaryButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true })}</div>` },
    { label: "Can't press", markup: html`<div class="control-row">${secondaryButton("Details", { type: "button", isDisabled: true })}${secondaryButton("Settings", { type: "button", icon: "gear", isDisabled: true })}</div>`, isStill: true },
    { label: "With a count: the players in a room", markup: secondaryButton("Players", { type: "button", icon: "people", isLabelHidden: true, reactionCount: 3 }) },
    { label: "Big, beside Play", markup: html`<div class="control-row">${primaryButton("Play", { type: "button", isBig: true, icon: "play" })}${secondaryButton("Details", { type: "button", isBig: true })}</div>` },
    { label: "Full width", markup: html`<div style="width:min(380px,100%)">${secondaryButton("Make an account", { type: "button", isFullWidth: true })}</div>` },
    { label: "A delete", markup: secondaryButton("Delete this game", { type: "button" }) },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${secondaryButton("Make an account and keep your progress in Ashen Crown", { type: "button", isFullWidth: true })}</div>` },
    { label: "The ways in, each in its own tint", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${waysIn()}</div>` },
    { label: "A way in, pointed", markup: html`<div style="${COLUMN}">${wayButton("Continue with Discord", "discord", { state: "is-pointed" })}</div>`, isStill: true },
    { label: "A way in, pressed: it carves in", markup: html`<div style="${COLUMN}">${wayButton("Continue with Discord", "discord", { state: "is-pressed" })}</div>`, isStill: true },
    { label: "A way in, busy", markup: html`<div style="${COLUMN}">${wayButton("Sign in with a passkey", "passkey", { isBusy: true })}</div>`, isStill: true },
    { label: "A way in, can't press", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${wayButton("Sign in with a passkey", "passkey", { isDisabled: true })}${wayButton("Continue with Discord", "discord", { isDisabled: true })}</div>`, isStill: true },
    { label: "Every tint: pick one", markup: tintPalette() },
    // Over a game's world the glass follows the world, not the theme: light glass on a bright one, smoked on a dark one.
    { label: "Over a bright game world", markup: world("kestrel", "light", waysIn()) },
    { label: "Over a dark game world", markup: world("starward", "smoked", waysIn()) },
    { label: "An action floating on a world", markup: world("emberfall", "smoked", html`<div style="display:flex;justify-content:center">${secondaryButton("More games", { icon: "chevron-down", type: "button" })}</div>`) },
  ],
});

export interface TertiaryButtonOptions extends ButtonTarget {
  /** An icon before its words, like Show all's chevron. */
  icon?: IconName;
  /**
   * Only its icon shows, its words said to a screen reader, and pointing brings up its slab with no orange line under it: a pane's Close and
   * a sheet's Back, which sit quietly in its corners until they're wanted.
   */
  isLabelHidden?: boolean;
  /** A small control's height, as a pane's corner buttons are. */
  isSmall?: boolean;
  /** An arrow after its words that steps on as you point at it: a way on, like Continue as guest under the ways in. */
  hasArrow?: boolean;
  /** As wide as the column, its words in the middle: under the ways in, as wide as they are. */
  isFullWidth?: boolean;
  /** Can't be pressed now: its words fade further and it answers no pointer. */
  isDisabled?: boolean;
  isBusy?: boolean;
  state?: ButtonState;
}

const TERTIARY_ARROW = html`<span class="tertiary-arrow" aria-hidden="true">${icon("chevron-right")}</span>`;

/**
 * A tertiary button: words, an icon or both alone at rest, the quietest thing you press (Skip for now, Show all, Undo; a sheet's Back and Close). It's a control's size with a slab that
 * shows only when you point at it, so it sits and is cut like any control, its words as far in as a field's (--pad-inside-words: on a
 * pane's edge, at the pane's margin). Pointing brings up the slab and draws the orange line in along its foot; keyboard focus is the cut
 * stroke round the slab, as on every button. With an arrow, it's a way on: Continue as guest under the ways in.
 */
export function tertiaryButton(label: string, options: TertiaryButtonOptions = {}): ControlMarkup {
  const isIconOnly = Boolean(options.isLabelHidden && options.icon);
  const extra = html`${disabledAttribute(options)}${isIconOnly ? html` aria-label="${label}"` : ""}`;
  return controlMarkup(html`${opening(classes("tertiary-btn", isIconOnly && "icon-only", options.isSmall && "small", options.isFullWidth && "is-full", options.state), options, options.isBusy, extra)}<span class="face" data-cut-line="${options.isSmall ? 9 : 10}">${CUT_LINE}<span class="tertiary-words">${loader()}${options.icon ? icon(options.icon) : ""}${isIconOnly ? "" : html`<span class="tertiary-label">${label}</span>`}${options.hasArrow ? TERTIARY_ARROW : ""}</span>${isIconOnly || options.hasArrow ? "" : raw('<span class="tertiary-line" aria-hidden="true"></span>')}</span>${closing(options)}`, options.isSmall ? "small" : "regular");
}

component({
  name: "Tertiary button",
  slug: "tertiary-button",
  group: "actions",
  subgroup: "buttons",
  summary: "The quietest thing to press: words, an icon, or both, with no slab until it's pointed at. Skip for now, Show all, Undo; only its icon, a sheet's Back and Close. Beside a secondary button it's the way out; never the one thing to do.",
  styles: `
/* A tertiary button: words only, at rest, in a control's box: its words keep a field's inset (--pad-inside-words), so on a pane's edge they're
   at the pane's margin while its box is at the frame gap, cut by the edge rule like any control's (slanting toward a control beside it).
   Pointing at it brings up its slab, faint (--wash), and draws the orange line in along its foot from the left, a light running ahead
   along it, the way a cover's line does; leaving, the line runs on out to the right, quicker than it came. A press darkens its slab where
   it is, never moving it. Keyboard focus is the cut stroke round its slab, as on every other button. */
.tertiary-btn { --control-height: var(--control-height-regular); vertical-align: middle; max-width: 100%; }
/* Small, and only its icon (a pane's Close, a sheet's Back): a square of a small control's size, its slab and no line under it when pointed at. */
.tertiary-btn.small { --control-height: var(--control-height-small); }
/* On a touch screen a small one still takes a finger, as a small secondary button does: its hit area reaches out to 44px, its look unchanged. */
@media (pointer: coarse) { .tertiary-btn.small { position: relative; } .tertiary-btn.small::after { content: ""; position: absolute; inset: calc((var(--control-height) - var(--touch-target)) / 2); } }
.tertiary-btn.icon-only > .face { width: var(--control-height); padding: 0; align-items: center; }
.tertiary-btn.icon-only .ico { width: 18px; height: 18px; }
.tertiary-btn:focus-visible { outline: none; }
.tertiary-btn > .face { position: relative; display: flex; flex: auto; flex-direction: column; justify-content: center; min-width: 0; height: var(--control-height); padding: 0 var(--pad-inside-words);
  font: var(--type-label); color: var(--ink-2); white-space: nowrap; --face-color: transparent; background-color: var(--face-color); clip-path: var(--cut-shape);
  transition: --face-color 0.2s, color 0.2s, opacity 0.2s, transform 0.4s ${SPRING}; }
.tertiary-words { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; gap: var(--gap-words-words); min-width: 0; font: var(--type-label); }
/* Words longer than the room it has end in an ellipsis on one line. */
.tertiary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* The line lies along the slab's foot, corner to corner, and the slab's own cut trims its ends, so it follows whatever shape the edge rule gives it. */
.tertiary-line { position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; display: block; height: 3px; overflow: hidden;
  background: linear-gradient(90deg, #E9820C, var(--run) 40%, #FFB54D); transform: scaleX(0); transform-origin: right; transition: transform 0.22s cubic-bezier(.4,0,1,1); }
.tertiary-line::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 38%; opacity: 0; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,246,228,0.95) 70%, rgba(255,255,255,0)); }
.tertiary-btn:hover > .face, .tertiary-btn.is-pointed > .face { color: var(--ink); --face-color: var(--wash); }
.tertiary-btn:focus-visible > .face, .tertiary-btn.is-focused > .face { color: var(--ink); }
.tertiary-btn:hover .tertiary-line, .tertiary-btn.is-pointed .tertiary-line { transform: scaleX(1); transform-origin: left; transition: transform 0.42s cubic-bezier(.2,.8,.2,1); }
.tertiary-btn:hover .tertiary-line::after, .tertiary-btn.is-pointed .tertiary-line::after { animation: tertiary-glint 0.7s cubic-bezier(.3,.6,.3,1) both; }
@keyframes tertiary-glint { 0% { transform: translateX(-100%); opacity: 1; } 75% { opacity: 1; } 100% { transform: translateX(270%); opacity: 0; } }
.tertiary-btn:active > .face, .tertiary-btn.is-pressed > .face { color: var(--ink); --face-color: var(--wash-press); transition-duration: 0.08s; }
/* With an arrow: it follows the words and steps on as you point at it, further under a press, in the line's place. As wide as the column, the words in the middle. */
.tertiary-btn.is-full { display: flex; width: 100%; }
.tertiary-arrow { display: inline-flex; transition: transform 0.45s cubic-bezier(.2,.7,.2,1); }
.tertiary-arrow > .ico { width: 8px; height: 12px; stroke-width: 2.4; }
.tertiary-btn:hover .tertiary-arrow, .tertiary-btn.is-pointed .tertiary-arrow { transform: translateX(4px); }
.tertiary-btn:active .tertiary-arrow, .tertiary-btn.is-pressed .tertiary-arrow { transform: translateX(7px); transition-duration: 0.12s; }
.tertiary-btn[aria-busy="true"] .tertiary-arrow { visibility: hidden; }
/* Keyboard focus: the cut stroke round its slab, as on every other button. */
.tertiary-btn:focus-visible .cut-line polygon, .tertiary-btn.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Can't press: its words fade further than at rest, and it answers no pointer. */
.tertiary-btn:disabled:not([aria-busy="true"]) { cursor: default; pointer-events: none; }
.tertiary-btn:disabled:not([aria-busy="true"]) > .face { color: var(--muted); opacity: 0.6; }
/* Waiting: the loader before its words, in the icon's place. */
.tertiary-btn:not([aria-busy="true"]) .loader, .tertiary-btn[aria-busy="true"] .tertiary-words > .ico { display: none; }
.tertiary-btn[aria-busy="true"] { cursor: progress; }
@media (prefers-reduced-motion: reduce) { .tertiary-btn > .face, .tertiary-line, .tertiary-arrow { transition: --face-color 0.2s, color 0.2s; } .tertiary-line::after { animation: none !important; } }
`,
  render: tertiaryButton,
  examples: [
    ...stateExamples((state) => tertiaryButton("Skip for now", { type: "button", state }), "tertiary"),
    { label: "Busy", markup: tertiaryButton("Undo", { type: "button", isBusy: true }), isStill: true },
    { label: "Can't press", markup: tertiaryButton("Undo", { type: "button", isDisabled: true }), isStill: true },
    { label: "With an arrow: a way on, under the ways in", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${waysIn()}${tertiaryButton("Continue as guest", { href: "#", hasArrow: true, isFullWidth: true })}</div>` },
    { label: "With an arrow, busy: the loader before its words", markup: html`<div style="${COLUMN}">${tertiaryButton("Continue as guest", { type: "button", hasArrow: true, isFullWidth: true, isBusy: true })}</div>`, isStill: true },
    { label: "With an icon", markup: tertiaryButton("Show all 1,284 replies", { type: "button", icon: "chevron-down" }) },
    { label: "Beside a secondary button: the way out", markup: html`<div class="control-row">${secondaryButton("Save", { type: "button" })}${tertiaryButton("Cancel", { type: "button" })}</div>` },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${tertiaryButton("Skip the tutorial and go straight to the first match", { type: "button" })}</div>` },
    {
      label: "Only its icon, small: a sheet's Back and Close in its top corners, nothing behind them until pointed at",
      markup: html`<div style="width:300px">${glassPane({ paneWidth: "full", body: paneParts({ head: { start: tertiaryButton("Back", { type: "button", icon: "chevron-back", isLabelHidden: true, isSmall: true }), words: html`<h2 class="sheet-title">Liam</h2>`, end: tertiaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true }) }, body: html`<p>Profile, Block and Report go here.</p>` }) })}</div>`,
    },
    { label: "Only its icon, pointed: its slab, with no orange line under it", markup: tertiaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true, state: "is-pointed" }), isStill: true },
  ],
});

component({
  name: "Toggle button",
  slug: "toggle-button",
  group: "actions",
  subgroup: "buttons",
  summary: "Something that stays on until it's pressed again: Follow, a like with its count, Mute, a password's Show. Off, it rests level in the glass and carves in as it's pressed; on, its top surface rises from the same place and its orange front surface shows, lit round it on dark glass and shadowed on light. A setting that's on or off on a settings page is a Toggle, the switch.",
  styles: `
/* A toggle button: a secondary button level in the glass when off, carving in as it's pressed; on, its top surface (its words and icon) rises from the same footprint and
   its front surface shows below it, orange, so it never moves and a row of toggles stays in line. Below it the glass is lit on dark glass
   and shadowed on light (--toggle-cast, which follows the button's own cut and reaches furthest below it). */
@property --toggle-rise { syntax: "<length>"; inherits: true; initial-value: 0px; }
/* How high the face stands (--toggle-rise), animated once on the button, moves the face and the front surface's upper edges together. */
.toggle-btn { position: relative; --toggle-lift: 5px; --toggle-rise: 0px; transition: filter 0.2s, --toggle-rise 0.35s cubic-bezier(.2,.8,.2,1); }
.toggle-btn.small { --toggle-lift: 4px; }
.toggle-btn[aria-pressed="true"] { --toggle-rise: var(--toggle-lift); }
/* Pressed: off, it carves in where it is (the carving is its sinking: it never moves); on, it goes down a little, as a key would; both quickly. */
/* Pressed while off, even mid-landing, its glow or shadow goes at once too: cast by its own shape, it would show through the carved face. */
.toggle-btn[aria-pressed="false"]:active, .toggle-btn[aria-pressed="false"].is-pressed { --toggle-rise: 0px; transition-duration: 0s, 0.08s; }
.toggle-btn[aria-pressed="true"]:active, .toggle-btn[aria-pressed="true"].is-pressed { --toggle-rise: calc(var(--toggle-lift) - 2px); transition-duration: 0.2s, 0.08s; }
/* Its height is the face's only movement. */
.toggle-btn > .face, .toggle-btn:hover > .face, .toggle-btn.is-pointed > .face, .toggle-btn:active > .face, .toggle-btn.is-pressed > .face { transform: translateY(calc(-1 * var(--toggle-rise))); }
.toggle-btn > .face { position: relative; z-index: 1; transition: color 0.2s, box-shadow 0.2s, --face-color 0.2s; }
/* The front surface: what the top surface leaves showing as it rises, swept down to its footprint (TOGGLE_SCRIPT), in a box reaching up by
   the whole lift, joined to the face at every corner and along a slanted end, as a solid's sides are. It follows the face's height frame by
   frame and has no area while the face rests or sinks, so nothing of it ever shows through or past the face. */
.toggle-front { position: absolute; top: calc(-1 * var(--toggle-lift)); right: 0; bottom: 0; left: 0; z-index: 0; clip-path: var(--front-shape);
  background: linear-gradient(180deg, var(--run-hi), var(--run) 40%, var(--run-lo)); }
/* Off: the same slab as on, its bevels and all, resting level in the glass. It answers the pointer by brightening, never lifting; pressed,
   it carves in, and let go it rises (on). */
.toggle-btn[aria-pressed="false"] > .face { color: var(--ink-2); }
.toggle-btn[aria-pressed="false"]:hover > .face, .toggle-btn[aria-pressed="false"].is-pointed > .face { color: var(--ink); }
.toggle-btn[aria-pressed="false"]:active, .toggle-btn[aria-pressed="false"].is-pressed { filter: none; }
.toggle-btn[aria-pressed="false"]:active > .face, .toggle-btn[aria-pressed="false"].is-pressed > .face { box-shadow: var(--press-shade); --face-color: var(--btn-press); }
.toggle-btn[aria-pressed="false"]:active > .face > .cut-line, .toggle-btn[aria-pressed="false"].is-pressed > .face > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* On: risen over its front surface, the glass lit or shadowed below it. Turning on, the face is solid at once. */
.toggle-btn[aria-pressed="true"] > .face { transition: color 0.2s, box-shadow 0.2s, --face-color 0s; }
.toggle-btn[aria-pressed="true"], .toggle-btn[aria-pressed="true"]:not(.in-well):hover, .toggle-btn[aria-pressed="true"].is-pointed, .toggle-btn[aria-pressed="true"]:active, .toggle-btn[aria-pressed="true"].is-pressed { filter: var(--toggle-cast); }
.toggle-btn[aria-pressed="true"] > .face > .ico { color: var(--toggle-icon-on); }
.toggle-btn[aria-pressed="true"]:active > .face, .toggle-btn[aria-pressed="true"].is-pressed > .face { box-shadow: none; --face-color: var(--btn); }
.toggle-btn[aria-pressed="true"]:active > .face > .cut-line, .toggle-btn[aria-pressed="true"].is-pressed > .face > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
/* Keyboard focus: one ring round the whole button as you see it, top and front surfaces together, not one round each. */
.toggle-btn:focus-visible > .face, .toggle-btn.is-focused > .face { --face-color: var(--btn-hover); }
.toggle-btn:focus-visible .cut-line polygon, .toggle-btn.is-focused .cut-line polygon { stroke: transparent; }
.toggle-btn:focus-visible, .toggle-btn.is-focused { filter: var(--toggle-ring); }
.toggle-btn[aria-pressed="true"]:focus-visible, .toggle-btn[aria-pressed="true"].is-focused { filter: var(--toggle-ring) var(--toggle-cast); }
@media (prefers-reduced-motion: reduce) { .toggle-btn, .toggle-btn:active, .toggle-btn.is-pressed { transition: filter 0.2s; } }
`,
  render: toggleButton,
  examples: [
    { label: "Off", markup: toggleButton("Follow", { type: "button", icon: "bell", isPressed: false }), isStill: true },
    { label: "On", markup: toggleButton("Following", { type: "button", icon: "bell", isPressed: true }), isStill: true },
    { label: "Off, pointed", markup: toggleButton("Follow", { type: "button", icon: "bell", isPressed: false, state: "is-pointed" }), isStill: true },
    { label: "On, pointed", markup: toggleButton("Following", { type: "button", icon: "bell", isPressed: true, state: "is-pointed" }), isStill: true },
    { label: "Off, pressed: it carves in", markup: toggleButton("Follow", { type: "button", icon: "bell", isPressed: false, state: "is-pressed" }), isStill: true },
    { label: "On, pressed: it goes down a little", markup: toggleButton("Following", { type: "button", icon: "bell", isPressed: true, state: "is-pressed" }), isStill: true },
    { label: "Keyboard focus", markup: toggleButton("Following", { type: "button", icon: "bell", isPressed: true, state: "is-focused" }), isStill: true },
    { label: "Try it: press each", isWide: true, markup: html`<div class="control-row" data-toggle-example>${toggleButton("Favorite", { type: "button", icon: "heart", isLabelHidden: true, isPressed: false })}${toggleButton("Follow", { type: "button", icon: "bell", isPressed: true })}${toggleButton("Like", { type: "button", icon: "heart", isLabelHidden: true, reactionCount: 1284, isPressed: false })}${toggleButton("Mute", { type: "button", icon: "speaker", isLabelHidden: true, isPressed: false })}</div>` },
    { label: "Only its icon, off and on", markup: html`<div class="control-row">${toggleButton("Favorite", { type: "button", icon: "heart", isLabelHidden: true, isPressed: false })}${toggleButton("Favorite", { type: "button", icon: "heart", isLabelHidden: true, isPressed: true })}</div>`, isStill: true },
    { label: "With a count, off and on", markup: html`<div class="control-row">${toggleButton("Like", { type: "button", icon: "heart", isLabelHidden: true, reactionCount: 1284, isPressed: false })}${toggleButton("Like", { type: "button", icon: "heart", isLabelHidden: true, reactionCount: 1285, isPressed: true })}</div>`, isStill: true },
    { label: "Small, off and on: a password's Show", markup: html`<div class="control-row">${toggleButton("Show", { type: "button", isSmall: true, isPressed: false })}${toggleButton("Hide", { type: "button", isSmall: true, isPressed: true })}</div>`, isStill: true },
    { label: "Can't press", markup: toggleButton("Follow", { type: "button", icon: "bell", isPressed: false, isDisabled: true }), isStill: true },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${toggleButton("Following Ashen Crown and every update from its studio", { type: "button", icon: "bell", isPressed: true })}</div>` },
  ],
});

export interface CardRowOptions extends ButtonTarget {
  /** What a screen reader says after the card's words, for what pressing it does: "Use another card". */
  hiddenText?: string;
  /** A word at its far end, before the chevron, for what pressing it does: "Change". */
  changeText?: string;
  /** Stripe's lowercase brand ("visa", "mastercard"): its mark shows in place of the plain card. A page script sets data-card-brand to change it. */
  cardBrand?: string;
  state?: ButtonState;
  /** Not shown for now: a page script shows it (the buy sheet, once a saved card is known). */
  isHidden?: boolean;
}

/**
 * A card row: the card a buy is paid with as one full-width row (a card mark, its words, a chevron). Pressing it changes the card. It is a
 * secondary button in a row's clothes, a field's height, with its words lined up with a pane's words as a field's are.
 */
/**
 * The common card brands' marks, as their owners draw them, small enough for a row: shown so a card is known at a glance. Keyed by
 * Stripe's lowercase brand; any other brand shows the plain card.
 */
const CARD_BRAND_MARKS: Record<string, string> = {
  visa: '<rect x=".5" y=".5" width="31" height="19" rx="2.5" fill="#fff" stroke="#d0d3d8"/><text x="16" y="13.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="700" font-style="italic" fill="#1A1F71">VISA</text>',
  mastercard: '<rect x=".5" y=".5" width="31" height="19" rx="2.5" fill="#fff" stroke="#d0d3d8"/><circle cx="12.6" cy="10" r="6" fill="#EB001B"/><circle cx="19.4" cy="10" r="6" fill="#F79E1B" fill-opacity=".9"/>',
  amex: '<rect width="32" height="20" rx="2.5" fill="#1F72CD"/><text x="16" y="13.2" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8" font-weight="700" fill="#fff">AMEX</text>',
  discover: '<rect x=".5" y=".5" width="31" height="19" rx="2.5" fill="#fff" stroke="#d0d3d8"/><text x="4" y="12.6" font-family="Arial, Helvetica, sans-serif" font-size="6.4" font-weight="700" fill="#231F20">DISC</text><circle cx="24" cy="10.4" r="3.6" fill="#F47216"/>',
  jcb: '<rect x=".5" y=".5" width="31" height="19" rx="2.5" fill="#fff" stroke="#d0d3d8"/><rect x="5" y="4" width="7" height="12" rx="2" fill="#0E4C96"/><rect x="12.5" y="4" width="7" height="12" rx="2" fill="#E21836"/><rect x="20" y="4" width="7" height="12" rx="2" fill="#007B40"/>',
  diners: '<rect x=".5" y=".5" width="31" height="19" rx="2.5" fill="#fff" stroke="#d0d3d8"/><circle cx="16" cy="10" r="6" fill="none" stroke="#0079BE" stroke-width="2"/><path d="M14.2 6.6v6.8M17.8 6.6v6.8" stroke="#0079BE" stroke-width="1.4"/>',
  unionpay: '<rect x=".5" y=".5" width="31" height="19" rx="2.5" fill="#fff" stroke="#d0d3d8"/><path d="M7 4h6l-2.4 12h-6z" fill="#E21836"/><path d="M13.4 4h6l-2.4 12h-6z" fill="#00447C"/><path d="M19.8 4h6l-2.4 12h-6z" fill="#007B84"/>',
  cartes_bancaires: '<rect width="32" height="20" rx="2.5" fill="#0A6BB0"/><text x="16" y="13.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="9" font-weight="700" fill="#fff">CB</text>',
};
const CARD_BRANDS = Object.keys(CARD_BRAND_MARKS);
// Drawn from the cached stylesheet, so a page with many card rows carries none of them and a script changes one by its data-card-brand.
const cardBrandImage = (brand: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20">${CARD_BRAND_MARKS[brand]}</svg>`)}")`;

export function cardRow(label: string, options: CardRowOptions = {}): ControlMarkup {
  const extra = html`${options.isHidden ? raw(" hidden") : ""}${options.cardBrand ? html` data-card-brand="${options.cardBrand}"` : ""}`;
  return controlMarkup(
    html`${opening(classes("cut-btn", "card-row", "is-full", options.state), options, undefined, extra)}<span class="face cut-raised" data-cut-line="10">${CUT_LINE}<span class="card-row-mark">${icon("card")}<span class="card-brand" aria-hidden="true"></span></span><span>${label}</span>${options.hiddenText ? html`<span class="sr">. ${options.hiddenText}</span>` : ""}<span class="card-row-go" aria-hidden="true">${options.changeText ? html`<span class="card-row-change">${options.changeText}</span>` : ""}${icon("chevron-right")}</span></span>${closing(options)}`,
    "field",
  );
}

component({
  name: "Card row",
  slug: "card-row",
  group: "actions",
  subgroup: "buttons",
  summary: "The card a buy is paid with, as one row you can press to change it: a card mark, its words (\"Visa ending 4242\") and a chevron. It sits above the buy button in a store panel's foot.",
  styles: `
/* A card row: a secondary button at a field's height, its words starting where a pane's words do (as a field's do), the chevron at its far end. */
.cut-btn.card-row { --control-height: var(--control-height-field); }
.cut-btn.card-row > .face { justify-content: flex-start; --face-padding: var(--pad-inside-words); }
.cut-btn.card-row > .face > span:not([class]) { flex: 1 1 auto; text-align: start; }
/* The card's brand mark in place of the plain card, when the brand is one it knows. */
.card-row-mark { flex: none; display: inline-flex; align-items: center; }
.card-row-change { white-space: nowrap; }
.card-row-mark > .card-brand { display: none; width: 32px; height: 20px; background: no-repeat center / contain; }
${CARD_BRANDS.map((brand) => `.cut-btn.card-row[data-card-brand="${brand}"] .card-brand { display: block; background-image: ${cardBrandImage(brand)}; }`).join("\n")}
.cut-btn.card-row:is(${CARD_BRANDS.map((brand) => `[data-card-brand="${brand}"]`).join(", ")}) .card-row-mark > .ico { display: none; }
.card-row-go { flex: none; display: inline-flex; align-items: center; gap: var(--gap-words-words); color: var(--muted); transition: transform 0.45s cubic-bezier(.2,.7,.2,1), color 0.2s; }
.card-row-go > .ico { width: 8px; height: 13px; stroke-width: 2.2; }
.cut-btn.card-row:hover .card-row-go, .cut-btn.card-row.is-pointed .card-row-go { transform: translateX(2px); color: var(--ink); }
@media (prefers-reduced-motion: reduce) { .card-row-go { transition: none; } }
`,
  render: cardRow,
  examples: [
    ...stateExamples((state) => cardRow("Visa ending 4242", { type: "button", hiddenText: "Use another card", changeText: "Change", cardBrand: "visa", state }), "cut", true),
    ...(
      [["mastercard", "Mastercard"], ["amex", "American Express"], ["discover", "Discover"], ["jcb", "JCB"], ["diners", "Diners Club"], ["unionpay", "UnionPay"], ["cartes_bancaires", "Cartes Bancaires"], ["eftpos_au", "A brand without a mark: the plain card"]] as const
    ).map(([brand, name]) => ({ label: name, markup: html`<div style="${COLUMN}">${cardRow(`${brand === "eftpos_au" ? "eftpos" : name} ending 4444`, { type: "button", hiddenText: "Use another card", changeText: "Change", cardBrand: brand })}</div>` })),
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${cardRow("American Express ending 1005 for the household budget", { type: "button", hiddenText: "Use another card" })}</div>` },
  ],
});


// Cut shapes sits with the buttons, so it can show the edge rule on real ones (foundations.ts can't import this file).
const edgePane = (body: Raw) => glassPane({ paneWidth: "fit", body });
export interface TextLinkOptions {
  /** In a list of links where nothing else is (a footer, a heading that links to itself): underlined only under the pointer. */
  isQuiet?: boolean;
  /** It opens in a new tab, so the page it's on keeps running (a notice's page from beside a running game). */
  isNewTab?: boolean;
  /** data-* attributes a page's script reads ({ keep: "/signin" } is data-keep="/signin"), names in lowercase words joined by dashes. */
  dataAttributes?: Record<string, string>;
  state?: "is-pointed" | "is-focused";
}

/** A link in words: ink with an orange underline, so it reads as a link without shouting. Quiet in a list of links, where it's plain until pointed at. */
export function textLink(words: string, href: string, options: TextLinkOptions = {}): Raw {
  return html`<a class="${classes("link", options.isQuiet && "quiet", options.state)}" href="${href}"${options.isNewTab ? raw(' target="_blank" rel="noopener"') : ""}${options.dataAttributes ? html`${Object.entries(options.dataAttributes).map(([name, text]) => html` data-${name}="${text}"`)}` : ""}>${words}</a>`;
}

component({
  name: "Link",
  slug: "link",
  group: "actions",
  subgroup: "words",
  summary: "Words that go somewhere: underlined in orange inside a sentence, plain in a list of links until you point at them. Anything you press that isn't words is a button.",
  styles: `
/* A link: the words' own font, ink, with an orange underline. Under the pointer its words take the line's orange (--run-words, dark enough
   on light glass to read); nothing moves and nothing fills in behind them, which would read as the browser's own selection. Quiet: plain
   until pointed at, when the line comes up and the words turn orange. Keyboard focus is the focus outline: a link can wrap across lines,
   so it can't take a control's cut. */
.link { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-color: var(--run); text-decoration-thickness: 2px; text-underline-offset: 3px;
  transition: text-decoration-color 0.15s, color 0.15s; }
.link:hover, .link.is-pointed, .link:active { color: var(--run-words); }
.link.quiet { color: inherit; font-weight: inherit; text-decoration-color: transparent; }
.link.quiet:hover, .link.quiet.is-pointed { color: var(--run-words); text-decoration-color: var(--run); }
.link:focus-visible, .link.is-focused { outline: 2px solid var(--focus); outline-offset: 3px; }
/* On a touch screen a link in a list of links (a footer's) still takes a finger: its hit area reaches a regular control's height, its look
   unchanged. A link inside a sentence keeps its line's, so it never reaches over the lines above and below it. */
/* On a touch screen a link that stands on its own (a quiet one, or one a layout places: Share in a row) is a control's height to press; one
   inside a line of words keeps its line's. */
@media (pointer: coarse) {
  :is(.link.quiet, :is(.row-cell, .stack-cell, .grid-cell, .pane-foot-start) > .link) { position: relative; }
  :is(.link.quiet, :is(.row-cell, .stack-cell, .grid-cell, .pane-foot-start) > .link)::after { content: ""; position: absolute; inset: calc((1lh - var(--touch-target)) / 2) 0; }
}
`,
  render: textLink,
  examples: [
    { label: "In words", markup: html`<p style="margin:0;font:var(--type-words)">Updated a day ago · ${textLink("What's new", "#link")}</p>` },
    { label: "Pointed", markup: html`<p style="margin:0;font:var(--type-words)">${textLink("What's new", "#link", { state: "is-pointed" })}</p>`, isStill: true },
    { label: "Keyboard focus", markup: html`<p style="margin:0;font:var(--type-words)">${textLink("What's new", "#link", { state: "is-focused" })}</p>`, isStill: true },
    {
      label: "In a paragraph to read, across two lines",
      markup: html`<p style="margin:0;max-width:300px;font:var(--type-reading);color:var(--ink-2)">Saves stay on this device until you sign in. ${textLink("Read how cloud saves keep your progress on every device you play on", "#link")}, or keep playing as a guest.</p>`,
    },
    {
      label: "Pointed, across two lines",
      markup: html`<p style="margin:0;max-width:300px;font:var(--type-reading);color:var(--ink-2)">Saves stay on this device until you sign in. ${textLink("Read how cloud saves keep your progress on every device you play on", "#link", { state: "is-pointed" })}, or keep playing as a guest.</p>`,
      isStill: true,
    },
    { label: "In a new tab, beside a running game", markup: html`<p style="margin:0;font:var(--type-words)">Someone copied your work? ${textLink("Send a copyright notice", "#link", { isNewTab: true })}</p>` },
    // The list spaces its links, not the link: a footer's are a block's gap apart, so each reads as its own.
    { label: "Quiet, in a list of links", markup: html`<p style="margin:0;display:flex;flex-wrap:wrap;column-gap:var(--gap-block-block);row-gap:var(--gap-words-words);font:var(--type-note);color:var(--ink-2)">${textLink("Forum", "#link", { isQuiet: true })}${textLink("Privacy", "#link", { isQuiet: true })}${textLink("Source code", "#link", { isQuiet: true })}</p>` },
    { label: "Quiet, pointed", markup: html`<p style="margin:0;display:flex;flex-wrap:wrap;column-gap:var(--gap-block-block);row-gap:var(--gap-words-words);font:var(--type-note);color:var(--ink-2)">${textLink("Forum", "#link", { isQuiet: true })}${textLink("Privacy", "#link", { isQuiet: true, state: "is-pointed" })}${textLink("Source code", "#link", { isQuiet: true })}</p>`, isStill: true },
  ],
});

/** A cut token's value in px, read from the tokens themselves, so what Cut shapes says is always what the glass is cut to. */
const cutPx = (tokenName: string) => new RegExp(`--${tokenName}:\\s*(\\d+)px`).exec(TOKEN_STYLES)?.[1] ?? "";
const cutWords = (kind: "pane" | "header" | "menu") => `${cutPx(`${kind}-cut-large`)} and ${cutPx(`${kind}-cut-small`)}`;
/** A slab of glass cut as a pane, the header or a menu is, empty, to show the cut alone. */
const cutSample = (kind: "pane" | "header" | "menu") => html`<div class="glass cut-sample is-${kind}" data-glass data-glass-corners="${kind}">${EDGE}</div>`;

component({
  name: "Cut shapes",
  slug: "cut-shapes",
  group: "foundations",
  subgroup: "look",
  summary: `Corners are cut, never rounded: ${cutWords("pane")} on panes, ${cutWords("header")} on the header, ${cutWords("menu")} on menus. Controls follow the edge rule: a slant only beside another control in a row, and every other corner fits what holds it.`,
  styles: `
/* Cut shapes: the glass's cuts, each on a slab of glass, then the edge rule on real buttons. */
.cut-sample { max-width: 100%; }
.cut-sample.is-pane { width: 200px; height: 140px; }
.cut-sample.is-header { width: 260px; height: 68px; }
.cut-sample.is-menu { width: 180px; height: 120px; }
.edge-stack { display: grid; gap: var(--gap-control-stack); }
`,
  examples: [
    { label: `A pane: ${cutWords("pane")}`, markup: cutSample("pane") },
    { label: `The header: ${cutWords("header")}`, markup: cutSample("header") },
    { label: `A menu: ${cutWords("menu")}`, markup: cutSample("menu") },
    { label: "Alone in a pane: fits its top and its bottom", markup: edgePane(secondaryButton("Make an account", { type: "button", isFullWidth: true })) },
    { label: "Side by side: slants between, fits the outside", markup: edgePane(html`<div class="control-row">${primaryButton("Play", { type: "button", icon: "play" })}${secondaryButton("Details", { type: "button" })}</div>`) },
    {
      label: "Stacked: fits the top and the bottom, square between",
      markup: edgePane(html`<div class="edge-stack">${secondaryButton("Settings", { type: "button", isFullWidth: true })}${secondaryButton("Account", { type: "button", isFullWidth: true })}${secondaryButton("Sign out", { type: "button", isFullWidth: true })}</div>`),
    },
    { label: "On no pane: cut as if it were in one", markup: html`<div class="control-row">${primaryButton("Play", { type: "button", icon: "play" })}${secondaryButton("Details", { type: "button" })}</div>` },
  ],
});

export interface RowArrowsOptions {
  /** The row's name, for a screen reader: "Scroll Popular on". */
  rowName: string;
  /** The id of the track it scrolls (Track, layout.ts). */
  trackId: string;
  /** Where the row starts scrolled to, so both arrows or only the back one can be pressed: the gallery's fixed states. */
  scrolledTo?: "middle" | "end";
}

/** Arrows to scroll a row, for a mouse or trackpad: a cut well of two halves at the right of the row's heading. Touch screens swipe instead. */
export function rowArrows(options: RowArrowsOptions): ControlMarkup {
  const arrow = (way: "back" | "on") =>
    secondaryButton(`Scroll ${options.rowName} ${way}`, { type: "button", icon: way === "back" ? "arrow-back" : "arrow-on", isLabelHidden: true, isInWell: true, controls: options.trackId });
  return controlMarkup(html`<div class="steps cut-carved" data-row-arrows${options.scrolledTo ? html` data-scrolled-to="${options.scrolledTo}"` : ""} data-cut-line="9">${CUT_LINE}${arrow("back")}${arrow("on")}</div>`, "small", { isPointerOnly: true });
}
