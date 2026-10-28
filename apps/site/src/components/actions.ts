import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, EDGE, ICONS, backdrop, colorPicker, glassPane, icon, loader, sheetMarkup, type ColorChoice, type IconName } from "./foundations.ts";
import { TOKEN_STYLES } from "./tokens.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { paneParts } from "./layout.ts";

/*
 * Actions, loudest to quietest: the runner button (the one colored thing you press), the cut button beside it,
 * the glass buttons for the other ways in, and the guest button below them. Each answers the pointer, the press
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

export interface RunButtonOptions extends ButtonTarget {
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
}

/** The runner button: a raised orange slab, the same height as the other buttons, lit along its edges. It lifts, leans toward the pointer and catches the light; pressing sinks it into the glass. */
export function runButton(label: string, options: RunButtonOptions = {}): ControlMarkup {
  // The label's span has no class of its own: html.ts's account link finds it as the header's runner's span without one.
  const words = options.busyLabel ? html`<span class="label-idle">${label}</span><span class="label-busy">${options.busyLabel}</span>` : html`<span>${label}</span>`;
  const shell = classes("run-wrap", options.isFullWidth && "is-full", options.state);
  const hasTrailing = options.trailingText !== undefined;
  const ending = hasTrailing ? html`<span class="run-trailing">${options.trailingText}</span>` : options.icon ? "" : ARROW;
  return controlMarkup(html`${opening(shell, options, options.isBusy, html`${disabledAttribute(options)}${options.isHidden ? raw(" hidden") : ""}`)}<span class="${options.isBig ? "face run big" : "face run"}${hasTrailing ? " has-trailing" : ""} cut-raised" data-cut-line="${options.isBig ? 14 : 12}">${CUT_LINE}${loader()}${options.icon ? icon(options.icon) : ""}${words}${ending}</span>${closing(options)}`, options.isBig ? "big" : "regular");
}

export interface CutButtonOptions extends ButtonTarget {
  icon?: IconName;
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

/** A secondary button: a cut slab of clearer glass with a drawn outline. It brightens under the pointer and gives under a press. A delete is one too, never orange. */
export function cutButton(label: string, options: CutButtonOptions = {}): ControlMarkup {
  return cutButtonMarkup(label, options);
}

export interface ToggleButtonOptions extends Omit<CutButtonOptions, "isBig" | "isInWell" | "isFullWidth" | "isExpanded"> {
  /** On or off (aria-pressed): the page's script flips it, and what it changes. */
  isPressed: boolean;
}

/**
 * A toggle button: something that stays on until it's pressed again (Follow, a like, Mute, a password's Show). Off, it rests level in the
 * glass, a slab like any cut button, and carves in as it's pressed; on, its top surface rises from the same footprint and its orange front surface shows, so it never moves and a row of them stays in line.
 */
export function toggleButton(label: string, options: ToggleButtonOptions): ControlMarkup {
  return cutButtonMarkup(label, options, options.isPressed);
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

// A toggle is a cut button with a front surface below its top surface (its face), showing when the face rises.
function cutButtonMarkup(label: string, options: CutButtonOptions, isPressed?: boolean): ControlMarkup {
  const isToggle = isPressed !== undefined;
  const hasCount = options.reactionCount !== undefined;
  const countWords = hasCount ? Number(options.reactionCount).toLocaleString("en-US") : "";
  const isIconOnly = options.isLabelHidden && !hasCount;
  const className = classes("cut-btn", isToggle && "toggle-btn", options.isBig && "big", options.isSmall && "small", options.isInWell && "in-well", isIconOnly && "icon-only", options.isFullWidth && "is-full", options.state);
  const extra = html`${disabledAttribute(options)}${isIconOnly ? html` aria-label="${label}"` : ""}${isToggle ? html` aria-pressed="${isPressed ? "true" : "false"}"` : ""}${options.controls ? html` aria-controls="${options.controls}"` : ""}${options.isExpanded !== undefined ? html` aria-expanded="${options.isExpanded ? "true" : "false"}"` : ""}${options.isHidden ? raw(" hidden") : ""}`;
  // Its icon and count with the label hidden: the label is still said, before the count ("Like, 12"), so a page that changes the count changes what's said.
  // The label's span has no class of its own, as on the runner (html.ts's account link finds it that way).
  const words = !options.isLabelHidden ? html`<span>${label}</span>` : hasCount ? html`<span class="sr">${label}, </span>` : "";
  const reactionMarkup = hasCount ? html`<span class="cut-count">${countWords}</span>` : "";
  const cutLine = options.isBig ? 13 : 10;
  const front = isToggle ? html`<span class="toggle-front" aria-hidden="true"></span>` : "";
  return controlMarkup(html`${opening(className, options, options.isBusy, extra)}${front}<span class="face cut-raised" data-cut-line="${cutLine}">${CUT_LINE}${loader()}${options.icon ? icon(options.icon) : ""}${words}${reactionMarkup}</span>${closing(options)}`, options.isBig ? "big" : options.isSmall || options.isInWell ? "small" : "regular");
}

const GOOGLE = raw(
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
);
const DISCORD = raw(
  '<svg class="one-color" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25 19.74 19.74 0 0 0-4.88 1.52C.53 9.050-.32 13.58.1 18.06a19.9 19.9 0 0 0 5.99 3.03c.46-.63.87-1.3 1.23-1.99a13.1 13.1 0 0 1-1.870-.9l.37-.29c3.93 1.79 8.18 1.79 12.06 0l.37.29c-.6.35-1.22.65-1.87.9.36.7.77 1.36 1.22 1.99a19.84 19.84 0 0 0 6-3.03c.5-5.18-.84-9.68-3.55-13.66zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.420 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.420 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/></svg>',
);
/** The other ways in, with the marks their owners ask for. A mark that may also be one color (Discord's) is class one-color. */
const WAY_ICONS = { google: GOOGLE, discord: DISCORD, passkey: raw(ICONS.passkey) } as const;

/**
 * A glass button's tint: clear glass, or glass tinted the color of the way in. Each way has its own unless the page picks one. "plain" is
 * nearly solid glass in the glass's own tone, as Google's buttons are: white on light glass with dark words, Google's near-black on smoked
 * glass with light words, so it never outshines the runner in the dark.
 */
export type GlassTint = "clear" | "plain" | "blue" | "indigo" | "black";
const WAY_TINTS: Record<keyof typeof WAY_ICONS, GlassTint> = { google: "plain", discord: "indigo", passkey: "clear" };

export interface GlassButtonOptions {
  href?: string;
  type?: "submit" | "button";
  /** A way in's mark (google, discord, passkey), or one of Zaisma's icons for an action on a world. */
  icon: keyof typeof WAY_ICONS | IconName;
  tint?: GlassTint;
  /** Can't be pressed now: clear glass whatever its tint, its words quieter and its mark faded. */
  isDisabled?: boolean;
  isBusy?: boolean;
  state?: ButtonState;
}

/**
 * A glass button: a small slab of the panes' glass, with their rim. Quieter than the runner, louder than the guest way. Another way in
 * (a passkey, Google, Discord: their marks), or an action that floats on a world with no pane under it (the home's More games: one of
 * Zaisma's icons), where a cut button's clear face would be lost.
 */
export function glassButton(label: string, options: GlassButtonOptions): ControlMarkup {
  const isWayIn = options.icon in WAY_ICONS;
  const tint = options.tint ?? (isWayIn ? WAY_TINTS[options.icon as keyof typeof WAY_ICONS] : "clear");
  const mark = isWayIn ? WAY_ICONS[options.icon as keyof typeof WAY_ICONS] : icon(options.icon as IconName);
  const target = { href: options.href, type: options.type ?? "button", isDisabled: options.isDisabled, isBusy: options.isBusy } as const;
  return controlMarkup(html`${opening(classes("glass-btn", options.state), target, options.isBusy, html` data-tint="${tint}"${disabledAttribute(target)}`)}<span class="face glass" data-glass data-cut-line="10" data-glass-band="3">${loader()}${mark}<span class="glass-words">${label}</span></span>${closing(target)}`, "regular");
}

const GUEST_ARROW = html`<span class="arrow" aria-hidden="true">${icon("chevron-right")}</span>`;

/** The guest way: words and an arrow under the glass buttons, the quietest way on. Its cut slab shows only when you point at it, press it or tab to it. */
export function guestButton(label: string, options: { href?: string; type?: "submit" | "button"; state?: ButtonState; isBusy?: boolean } = {}): ControlMarkup {
  return controlMarkup(html`${opening(classes("guest-btn", options.state), { href: options.href, type: options.type ?? "button" }, options.isBusy)}<span class="face" data-cut-line="10">${CUT_LINE}<span class="guest-words">${loader()}${label}</span>${GUEST_ARROW}</span>${closing({ href: options.href })}`, "regular");
}

/**
 * The runner button: it lifts and leans toward the pointer, a reflection slides the other way, and one glint sweeps as
 * the pointer arrives and always finishes. The pointer is followed on the still shell; the lift and lean are set there
 * for its face and its side, which move inside it.
 * The glass buttons: their light follows the pointer across the glass.
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
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover)").matches) return;
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
  document.addEventListener("pointermove", function (event) {
    var shell = event.target.closest && event.target.closest(".glass-btn"); if (!shell) return;
    var r = shell.getBoundingClientRect();
    shell.style.setProperty("--mx", (event.clientX - r.left).toFixed(0) + "px"); shell.style.setProperty("--my", (event.clientY - r.top).toFixed(0) + "px");
  }, { passive: true });
})();
`;

const SPRING = "cubic-bezier(.25,.9,.3,1.25)";

const RUN_STYLES = `
/* The runner button: the one colored thing you can press. A raised orange slab, the same height as every other button,
   lit along its edges like the other raised controls (the edge rule's bands, in orange). It lifts, leans toward you and
   a glint crosses it as you arrive; a press sinks it into the glass, its light turning round, and it springs back.
   The shell (.run-wrap, the link or button) stays still; its face (.run) moves inside it.
   .over is the pointer on it (RUNNER_SCRIPT); is-pointed, is-pressed and is-focused fix those states for the gallery. */
.run-wrap { isolation: isolate; vertical-align: middle; max-width: 100%; perspective: 600px; }
.run-wrap:focus-visible { outline: none; }
/* Words longer than the room it has end in an ellipsis on one line, never spilling out of it or growing it past its height. */
.run { min-width: 0; }
.run > span:not([class]), .run > .label-idle, .run > .label-busy { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.run-wrap.is-full { display: flex; width: 100%; perspective: 700px; }
/* Its warm glow on what's under it: it spreads as the slab lifts and gathers in as it's pressed. */
.run-wrap::before { content: ""; position: absolute; z-index: -1; left: 8%; right: 8%; top: 40%; bottom: -8px; border-radius: 50%; pointer-events: none;
  background: rgba(247,147,26,0.32); filter: blur(11px); opacity: 0.7; transition: opacity 0.5s, transform 0.5s cubic-bezier(.2,.7,.2,1); }
.run-wrap.over::before, .run-wrap.is-pointed::before { opacity: 1; transform: translateY(3px) scaleX(1.05); }
.run-wrap:active::before, .run-wrap.is-pressed::before { opacity: 0.45; transform: translateY(-2px) scaleX(0.94); transition-duration: 0.1s; }
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
.run-wrap:active > .run, .run-wrap.is-pressed > .run { --lift: 1px; filter: brightness(0.94) saturate(1.05); transition-duration: 0.08s; }
.run-wrap:active > .run > .cut-line, .run-wrap.is-pressed > .run > .cut-line { --band-top: rgba(130,60,0,0.5); --band-left: rgba(150,72,0,0.35); --band-right: rgba(255,226,180,0.45); --band-bottom: rgba(255,240,214,0.7); }
/* Keyboard focus: the focus line inside its cut, in the deeper orange, since it's orange itself. */
.run-wrap:focus-visible > .run > .cut-line polygon, .run-wrap.is-focused > .run > .cut-line polygon { stroke: var(--focus-on-run); stroke-width: var(--focus-stroke); }
/* Busy: pressed and waiting. The arrow drifts on; the label says what's happening when the page gave one. */
.run-wrap[aria-busy="true"] { cursor: progress; }
.run-wrap[aria-busy="true"] .label-idle, .run-wrap:not([aria-busy="true"]) .label-busy { display: none; }
/* Waiting: the loader takes the arrow's or the icon's place. */
.run-wrap:not([aria-busy="true"]) .loader, .run-wrap[aria-busy="true"] .arrow, .run-wrap[aria-busy="true"] .face > .ico, .run-wrap[aria-busy="true"] .face > .play { display: none; }
.run .loader { position: relative; z-index: 2; }
@keyframes run-drift { 0%, 100% { transform: translateX(0); opacity: 0.55; } 50% { transform: translateX(7px); opacity: 1; } }
/* Can't press yet: orange is only what you can act on, so it isn't orange. It's carved flat into the glass, as a disabled cut button is,
   its cut and edge kept, its words quieter, and it answers no pointer: no glow, no lift, no glint. */
.run-wrap:disabled:not([aria-busy="true"]) { cursor: default; pointer-events: none; }
.run-wrap:disabled:not([aria-busy="true"])::before { opacity: 0; }
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
const stateExamples = (render: (state?: ButtonState) => Raw, loopKind: "runner" | "cut" | "glass" | "guest" | "text", isFullWidth = false) => {
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

component({
  name: "Runner button",
  slug: "runner-button",
  group: "actions",
  subgroup: "buttons",
  summary: "The one thing to do on a screen: Play, Sign in, Next. Never more than one in view, and visible without scrolling.",
  styles: RUN_STYLES,
  render: runButton,
  examples: [
    ...stateExamples((state) => runButton("Sign in", { type: "button", state }), "runner"),
    { label: "Busy, saying what's happening", markup: runButton("Sign in", { type: "button", isBusy: true, busyLabel: "Signing in" }), isStill: true },
    { label: "Busy, keeping its words", markup: runButton("Next", { type: "button", isBusy: true }), isStill: true },
    { label: "Can't press yet", markup: runButton("Next", { type: "button", isDisabled: true }), isStill: true },
    { label: "Big, with Play", markup: runButton("Play", { type: "button", isBig: true, icon: "play" }) },
    { label: "Big and full width, as on Sign in", markup: html`<div style="${COLUMN}">${runButton("Sign in", { type: "button", isFullWidth: true, isBig: true })}</div>` },
    { label: "With its price at the other end (a buy button)", markup: html`<div style="${COLUMN}">${runButton("Buy", { type: "button", isFullWidth: true, trailingText: "$19.99" })}</div>` },
    { label: "With its price, busy", markup: html`<div style="${COLUMN}">${runButton("Buy", { type: "button", isFullWidth: true, trailingText: "$19.99", isBusy: true, busyLabel: "Buying" })}</div>`, isStill: true },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${runButton("Play Ashen Crown: The Long Night of the Iron Vigil", { type: "button", isFullWidth: true, isBig: true, icon: "play" })}</div>` },
  ],
});

component({
  name: "Cut button",
  slug: "cut-button",
  group: "actions",
  subgroup: "buttons",
  summary: "Everything else you can press: Details, Make an account, Cancel. A delete is a cut button too, never orange; only its confirm step turns red.",
  styles: `
/* A secondary button: a solid cut slab with a drawn outline, the same slab a Toggle button is. Under the pointer it brightens and stays
   where it is; a press sinks it (down a pixel, shaded from above, its light turned round), never shrinking it, quickly, and it springs back
   when let go. The shell (the button) stays still; the slab is its face. */
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
.cut-btn:active > .face, .cut-btn.is-pressed > .face { --face-color: var(--btn-press); box-shadow: var(--press-shade); transform: translateY(1px); transition-duration: 0.08s; }
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
`,
  render: cutButton,
  examples: [
    ...stateExamples((state) => cutButton("Details", { type: "button", state }), "cut"),
    { label: "Busy", markup: cutButton("Saving", { type: "button", isBusy: true }), isStill: true },
    { label: "With an icon", markup: cutButton("Settings", { type: "button", icon: "gear" }) },
    { label: "Only its icon", markup: cutButton("Light. Switch to dark", { type: "button", icon: "light-dark", isLabelHidden: true }) },
    { label: "Small", markup: cutButton("Show", { type: "button", isSmall: true }) },
    { label: "Small, only its icon: a sheet's Close, a Copy", markup: html`<div class="control-row">${cutButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true })}${cutButton("Copy", { type: "button", icon: "copy", isLabelHidden: true, isSmall: true })}</div>` },
    { label: "Can't press", markup: html`<div class="control-row">${cutButton("Details", { type: "button", isDisabled: true })}${cutButton("Settings", { type: "button", icon: "gear", isDisabled: true })}</div>`, isStill: true },
    { label: "With a count: the players in a room", markup: cutButton("Players", { type: "button", icon: "people", isLabelHidden: true, reactionCount: 3 }) },
    { label: "Big, beside Play", markup: html`<div class="control-row">${runButton("Play", { type: "button", isBig: true, icon: "play" })}${cutButton("Details", { type: "button", isBig: true })}</div>` },
    { label: "Full width", markup: html`<div style="width:min(380px,100%)">${cutButton("Make an account", { type: "button", isFullWidth: true })}</div>` },
    { label: "A delete", markup: cutButton("Delete this game", { type: "button" }) },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${cutButton("Make an account and keep your progress in Ashen Crown", { type: "button", isFullWidth: true })}</div>` },
  ],
});

component({
  name: "Toggle button",
  slug: "toggle-button",
  group: "actions",
  subgroup: "buttons",
  summary: "Something that stays on until it's pressed again: Follow, a like with its count, Mute, a password's Show. Off, it rests level in the glass and carves in as it's pressed; on, its top surface rises from the same place and its orange front surface shows, lit round it on dark glass and shadowed on light. A setting that's on or off on a settings page is a Toggle, the switch.",
  styles: `
/* A toggle button: a cut button level in the glass when off, carving in as it's pressed; on, its top surface (its words and icon) rises from the same footprint and
   its front surface shows below it, orange, so it never moves and a row of toggles stays in line. Below it the glass is lit on dark glass
   and shadowed on light (--toggle-cast, which follows the button's own cut and reaches furthest below it). */
@property --toggle-rise { syntax: "<length>"; inherits: true; initial-value: 0px; }
/* How high the face stands (--toggle-rise), animated once on the button, moves the face and the front surface's upper edges together. */
.toggle-btn { position: relative; --toggle-lift: 5px; --toggle-rise: 0px; transition: filter 0.2s, --toggle-rise 0.35s cubic-bezier(.2,.8,.2,1); }
.toggle-btn.small { --toggle-lift: 4px; }
.toggle-btn[aria-pressed="true"] { --toggle-rise: var(--toggle-lift); }
/* Pressed: off, it sinks a pixel into the glass; on, it goes down a little, as a key would; both quickly. */
/* Pressed while off, even mid-landing, its glow or shadow goes at once too: cast by its own shape, it would show through the carved face. */
.toggle-btn[aria-pressed="false"]:active, .toggle-btn[aria-pressed="false"].is-pressed { --toggle-rise: -1px; transition-duration: 0s, 0.08s; }
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
 * cut button in a row's clothes, a field's height, with its words lined up with a pane's words as a field's are.
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
/* A card row: a cut button at a field's height, its words starting where a pane's words do (as a field's do), the chevron at its far end. */
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

/**
 * A game's world for glass buttons to sit on: a shader background with no words in it (never a cover, whose art has its title), and the glass
 * fixed to what it is, light over a bright world and smoked over a dark one, as the world's measured glass would be.
 */
const world = (standInSlug: string, glassKind: "light" | "smoked", body: Raw) =>
  html`<div ${glassKind === "light" ? raw('data-theme-choice="light"') : raw('class="smoke"')} style="position:relative;overflow:hidden;display:grid;gap:var(--gap-control-stack);width:min(380px,100%);padding:var(--pad-pane)">${backdrop({ isFramed: true, standInSlug })}${body}</div>`;
const wayIn = (state?: ButtonState) => glassButton("Sign in with a passkey", { icon: "passkey", state });
/** A glass button's tints, for a color picker (inputs.ts's Color picker, the gallery's tint palette). */
export const TINT_CHOICES: (ColorChoice & { colorValue: GlassTint })[] = [
  { name: "Clear", colorValue: "clear", swatch: "clear" },
  // Plain follows the glass: white on light, Google's near-black on smoked, so its swatch shows both, half and half.
  { name: "Plain", colorValue: "plain", swatch: "linear-gradient(135deg, #fff 50%, #131314 50%)" },
  { name: "Blue", colorValue: "blue", swatch: "#2A75E8" },
  { name: "Indigo", colorValue: "indigo", swatch: "#5865F2" },
  { name: "Black", colorValue: "black", swatch: "#14171C" },
];
const tintPalette = () => html`<div class="tint-try" data-tint-try>${glassButton("Continue with Discord", { icon: "discord" })}${colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo" })}</div>`;
const waysIn = () => html`${glassButton("Sign in with a passkey", { icon: "passkey" })}${glassButton("Continue with Google", { icon: "google" })}${glassButton("Continue with Discord", { icon: "discord" })}`;

component({
  name: "Glass button",
  slug: "glass-button",
  group: "actions",
  subgroup: "buttons",
  summary: "Another way in, like a passkey, Google or Discord: below the runner, never instead of it. Or an action floating on a world with no pane under it.",
  styles: `
/* Glass buttons for the other ways in: a small slab of the panes' glass, cut and rimmed like them (GLASS_SCRIPT draws the rim).
   The pointer brings a light that follows it across the glass and brightens the rim; a press sinks the slab into its shade.
   The shell (the button) stays still and holds the tint; the slab is its face. */
.glass-btn { --control-height: var(--control-height-regular); --mx: 38%; --my: 18%; display: flex; width: 100%; }
.glass-btn:focus-visible { outline: none; }
.glass-btn > .face {
  position: relative; display: flex; flex: auto; align-items: center; justify-content: center; gap: 10px; height: var(--control-height); padding: 0 18px;
  font: 500 0.9375rem var(--display); color: var(--ink); white-space: nowrap;
  --glass-tint: var(--glass-btn-face);
  transition: var(--glass-transition), box-shadow 0.2s, transform 0.4s ${SPRING}; }
.glass-btn .face > :not(.edge) { position: relative; z-index: 3; }
.glass-btn .face > svg:not(.edge) { width: 20px; height: 20px; flex: none; transition: transform 0.4s ${SPRING}, opacity 0.2s; }
/* Words longer than the room it has end in an ellipsis on one line. */
.glass-btn { max-width: 100%; }
.glass-btn > .face { min-width: 0; }
.glass-words { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Waiting: the loader takes the way's mark's place. */
.glass-btn:not([aria-busy="true"]) .loader, .glass-btn[aria-busy="true"] .face > svg:not(.edge) { display: none; }
.glass-btn[aria-busy="true"] { cursor: progress; }
.glass-btn .edge { opacity: 0.7; transition: opacity 0.3s; }
/* A small slab's rim, kept as quiet in light glass as it is in smoked: a faint hairline and a soft inner line. */
.glass-btn .edge .hair { stroke: var(--glass-btn-hair-rest); transition: stroke 0.3s; }
.glass-btn .edge .inner { opacity: 0.5; }
/* The light the pointer brings. */
.glass-btn > .face::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0; transition: opacity 0.3s;
  background: radial-gradient(150px 110px at var(--mx) var(--my), var(--pointer-glow), rgba(255,255,255,0) 70%); }
.glass-btn:hover > .face, .glass-btn.is-pointed > .face { --glass-tint: var(--glass-btn-hover); box-shadow: var(--glass-btn-lift); transform: translateY(-1px); }
.glass-btn:hover .edge .hair, .glass-btn.is-pointed .edge .hair { stroke: var(--glass-btn-hair); }
/* Pointed: the edge gets brighter, not darker: the dark hairline softens into the glass and the light line inside the rim comes up. */
.glass-btn:hover .edge .inner, .glass-btn.is-pointed .edge .inner { opacity: 1; }
.glass-btn:hover > .face::before, .glass-btn.is-pointed > .face::before { opacity: 0.85; }
.glass-btn:hover .edge, .glass-btn.is-pointed .edge { opacity: 1; }
.glass-btn:hover .face > svg:not(.edge), .glass-btn.is-pointed .face > svg:not(.edge) { transform: scale(1.1); }
.glass-btn:active > .face, .glass-btn.is-pressed > .face { --glass-tint: var(--glass-btn-press); box-shadow: var(--press-shade); transform: translateY(1px); transition-duration: 0.08s; }
.glass-btn:active > .face::before, .glass-btn.is-pressed > .face::before { opacity: 0.45; }
.glass-btn:active .face > svg:not(.edge), .glass-btn.is-pressed .face > svg:not(.edge) { transform: scale(0.94); transition-duration: 0.08s; }
/* Keyboard focus: the rim turns orange, following the cut, and its bright facets step aside. */
.glass-btn:focus-visible > .face, .glass-btn.is-focused > .face { --glass-tint: var(--glass-btn-hover); }
.glass-btn:focus-visible .edge, .glass-btn.is-focused .edge { opacity: 1; }
.glass-btn:focus-visible .edge .hair, .glass-btn.is-focused .edge .hair { stroke: var(--focus); stroke-width: 2; }
.glass-btn:focus-visible .edge .rim, .glass-btn.is-focused .edge .rim { stroke: var(--focus); stroke-width: 2; opacity: 1; }
.glass-btn:focus-visible .edge .facet, .glass-btn:focus-visible .edge .fringe, .glass-btn.is-focused .edge .facet, .glass-btn.is-focused .edge .fringe { opacity: 0; }
/* A tinted slab is colored glass, not a plate: it keeps the same glass edge as every glass button, drawn in its own color. Its bevel
   steps from a light shade of the tint along the lit top to a deep shade along the foot, the rim and the glint at the lit corner are the
   tint's light, and a sheen lies over the color, brightest at the top. The more color it carries, the more its edge would stand out
   against it, so a tinted slab's edge is fainter than clear glass's: the same edge, just as quiet. No dark hairline or rainbow fringe,
   which read as a frame round a colored slab. */
.glass-btn[data-tint]:not([data-tint="clear"]) > .face {
  --edge-lit: color-mix(in srgb, var(--tint-color) 30%, white); --edge-shade: color-mix(in srgb, var(--tint-color) 70%, black); --edge-corner: color-mix(in srgb, var(--tint-color) 40%, white);
  --edge-spec: rgba(255,255,255,0.7); --edge-inner: color-mix(in srgb, var(--tint-color) 35%, white); --edge-dense: rgba(0,0,0,0.03);
  --edge-bevel: 0.22; --edge-rim: 0.4; --edge-fringe: 0;
  --glass-layer: linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0.06) 40%, rgba(255,255,255,0) 58%, rgba(0,0,0,0.08)), linear-gradient(color-mix(in srgb, var(--tint-color) var(--tint-pct), transparent), color-mix(in srgb, var(--tint-color) var(--tint-pct), transparent)); }
/* Plain, on light glass: white, its edge the lightest of all, so the frame inside it never draws a line round the words. On smoked glass:
   Google's near-black, its edge a dim grey and its sheen faint, with the grey hairline Google draws round its dark button, so it sits as
   quietly in a dark pane as the white one does in a light one. light-dark() follows the glass's color-scheme (light or smoked glass). */
.glass-btn[data-tint="plain"] > .face { --edge-lit: light-dark(#fff, #5C5F63); --edge-shade: light-dark(#C9CFD8, #000); --edge-corner: light-dark(#EEF1F5, #6E7175); --edge-inner: light-dark(#fff, #8E918F);
  --edge-dense: light-dark(rgba(40,60,100,0.03), rgba(255,255,255,0.02)); --edge-bevel: 0.3; --edge-rim: 0.45;
  --glass-layer: linear-gradient(180deg, light-dark(rgba(255,255,255,0.4), rgba(255,255,255,0.07)), rgba(255,255,255,0) 50%, light-dark(rgba(30,50,90,0.05), rgba(0,0,0,0.1))), linear-gradient(color-mix(in srgb, var(--tint-color) var(--tint-pct), transparent), color-mix(in srgb, var(--tint-color) var(--tint-pct), transparent)); }
.glass-btn[data-tint="black"] > .face { --edge-lit: #5A606B; --edge-shade: #000; --edge-corner: #6B717C; --edge-inner: #8A919C; }
.glass-btn[data-tint]:not([data-tint="clear"]) .edge :is(.hair, .fringe) { opacity: 0; }
/* Plain on smoked glass keeps a hairline, the grey Google draws round its dark button (none on light glass, where the white is enough). */
.glass-btn[data-tint="plain"] > .face > .edge .hair { opacity: 1; stroke: light-dark(transparent, rgba(142,145,143,0.55)); }
.glass-btn[data-tint]:not([data-tint="clear"]) .edge .inner { opacity: 0.25; }
.glass-btn[data-tint]:not([data-tint="clear"]):hover .edge .inner, .glass-btn[data-tint]:not([data-tint="clear"]).is-pointed .edge .inner { opacity: 0.45; }
.glass-btn[data-tint="blue"]:hover > .face, .glass-btn[data-tint="indigo"]:hover > .face, .glass-btn[data-tint="black"]:hover > .face,
.glass-btn[data-tint="blue"].is-pointed > .face, .glass-btn[data-tint="indigo"].is-pointed > .face, .glass-btn[data-tint="black"].is-pointed > .face { box-shadow: inset 0 -12px 18px -12px rgba(0,0,0,0.3); }
.glass-btn[data-tint]:not([data-tint="clear"]):focus-visible .edge .rim, .glass-btn[data-tint]:not([data-tint="clear"]).is-focused .edge .rim { stroke: var(--focus); stroke-width: 2; opacity: 1; }
/* Tinted: the way's own color, mostly solid, the backdrop just showing through, in either theme (a brand's color is how you recognize it, so it doesn't
   follow light or dark), but for plain, which is the glass's own tone: white with dark words on light glass, near-black with light words on
   smoked. The colored and black ones have white words. It's a touch stronger as you point at it and a touch clearer under a press. Changing
   the tint fades from one to the next. */
.glass-btn > .face { --tint-pct: 0%; --glass-layer: linear-gradient(color-mix(in srgb, var(--tint-color) var(--tint-pct), transparent), color-mix(in srgb, var(--tint-color) var(--tint-pct), transparent)); }
/* A brand's glass keeps its own color: the page's hue never reaches it. */
.glass-btn[data-tint]:not([data-tint="clear"]) > .face { --glass-wash: linear-gradient(transparent, transparent); }
.glass-btn[data-tint] > .face { --tint-pct: var(--glass-btn-tint-rest); transition: var(--glass-transition), box-shadow 0.2s, transform 0.4s ${SPRING}, --tint-color 0.3s, --tint-pct 0.3s; }
.glass-btn[data-tint]:hover > .face, .glass-btn[data-tint].is-pointed > .face, .glass-btn[data-tint]:focus-visible > .face, .glass-btn[data-tint].is-focused > .face { --tint-pct: var(--glass-btn-tint-hover); }
.glass-btn[data-tint]:active > .face, .glass-btn[data-tint].is-pressed > .face { --tint-pct: var(--glass-btn-tint-press); }
.glass-btn[data-tint="clear"] { --glass-btn-tint-rest: 0%; --glass-btn-tint-hover: 0%; --glass-btn-tint-press: 0%; }
.glass-btn[data-tint="plain"] > .face { --tint-color: light-dark(#fff, #131314); color: var(--ink); }
.glass-btn[data-tint="plain"] { --glass-btn-tint-rest: 76%; --glass-btn-tint-hover: 86%; --glass-btn-tint-press: 68%; }
.glass-btn[data-tint="blue"], .glass-btn[data-tint="indigo"], .glass-btn[data-tint="black"] { --glass-btn-tint-rest: 74%; --glass-btn-tint-hover: 82%; --glass-btn-tint-press: 68%; --pointer-glow: rgba(255,255,255,0.35); }
.glass-btn[data-tint="blue"] > .face, .glass-btn[data-tint="indigo"] > .face, .glass-btn[data-tint="black"] > .face { color: #fff; }
.glass-btn[data-tint="blue"] > .face { --tint-color: #2A75E8; }
.glass-btn[data-tint="indigo"] > .face { --tint-color: #5865F2; }
.glass-btn[data-tint="black"] > .face { --tint-color: #14171C; }
/* On a colored or black tint a colored mark would sink into it, so a mark that may be one color turns white with the words.
   Google's G stays in its colors, which only ever sit on plain or clear glass. */
.glass-btn[data-tint="blue"] .one-color path, .glass-btn[data-tint="indigo"] .one-color path, .glass-btn[data-tint="black"] .one-color path { fill: currentColor; transition: fill 0.3s; }
/* On clear glass it's white over smoked glass, and its own blue over light (the fallback, since light glass leaves --clear-glass-mark unset). */
.glass-btn[data-tint="clear"] .one-color path { fill: var(--clear-glass-mark, #5865F2); transition: fill 0.3s; }
/* Can't press: clear glass whatever its tint (its brand color is for a way you can take), its words quieter, its mark faded, and it
   answers no pointer. */
.glass-btn:disabled:not([aria-busy="true"]) { cursor: default; pointer-events: none; }
.glass-btn:disabled:not([aria-busy="true"]) > .face { --tint-pct: 0%; color: var(--muted);
  --edge-lit: inherit; --edge-shade: inherit; --edge-corner: inherit; --edge-inner: inherit; --edge-spec: inherit; --edge-dense: inherit; --edge-bevel: inherit; --edge-rim: inherit; }
.glass-btn:disabled:not([aria-busy="true"]) > .face > svg:not(.edge) { opacity: 0.45; }
.glass-btn:disabled:not([aria-busy="true"]) .one-color path { fill: currentColor; }
/* The gallery's tint palette: a Color picker; pick one and the button above takes it (GALLERY_SCRIPT). */
.tint-try { display: grid; gap: var(--gap-block-block); width: min(340px, 100%); }
@media (prefers-reduced-motion: reduce) { .glass-btn > .face, .glass-btn .face > svg:not(.edge) { transition: var(--glass-transition); } }
`,
  render: glassButton,
  examples: [
    ...stateExamples(wayIn, "glass", true),
    { label: "Busy", markup: html`<div style="${COLUMN}">${glassButton("Sign in with a passkey", { icon: "passkey", isBusy: true })}</div>`, isStill: true },
    { label: "Can't press", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${glassButton("Sign in with a passkey", { icon: "passkey", isDisabled: true })}${glassButton("Continue with Discord", { icon: "discord", isDisabled: true })}</div>`, isStill: true },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${glassButton("Continue with the Discord account you play Iron Vigil with", { icon: "discord" })}</div>` },
    { label: "Every tint: pick one", markup: tintPalette() },
    { label: "The ways in, each in its own tint", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${waysIn()}</div>` },
    // Over a game's world the glass follows the world, not the theme: light glass on a bright one, smoked on a dark one.
    { label: "Over a bright game world", markup: world("kestrel", "light", waysIn()) },
    { label: "Over a dark game world", markup: world("starward", "smoked", waysIn()) },
    // On a world with no pane under it (the home's More games, under the game in focus), with one of Zaisma's icons.
    { label: "An action floating on a world", markup: world("emberfall", "smoked", html`<div style="display:flex;justify-content:center">${glassButton("More games", { icon: "chevron-down", type: "button" })}</div>`) },
  ],
});

component({
  name: "Guest button",
  slug: "guest-button",
  group: "actions",
  subgroup: "buttons",
  summary: "The quietest way on, like Continue as guest: words and an arrow below the glass buttons, a slab only once you point at it.",
  styles: `
/* The guest way: below the glass buttons, so only words and an arrow at rest. Pointing at it brings up its cut slab and
   outline and sends the arrow on; a press sinks it; the keyboard's focus draws the outline in ink.
   The shell (the button) stays still; the slab is its face. */
.guest-btn { --control-height: var(--control-height-regular); display: flex; width: 100%; }
.guest-btn:focus-visible { outline: none; }
.guest-btn > .face { display: flex; flex: auto; align-items: center; justify-content: center; gap: 8px; height: var(--control-height); padding: 0 16px;
  font: 500 0.9375rem var(--display); color: var(--ink-2); white-space: nowrap; --face-color: transparent; background-color: var(--face-color);
  clip-path: var(--cut-shape);
  transition: --face-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
.guest-btn .face > :not(.cut-line) { position: relative; z-index: 2; }
.guest-btn .cut-line polygon { stroke: transparent; }
.guest-btn .arrow { display: inline-flex; transition: transform 0.45s cubic-bezier(.2,.7,.2,1); }
.guest-btn .arrow > .ico { width: 8px; height: 12px; stroke-width: 2.4; }
/* Waiting: the loader shows before its words, as on every button, and the arrow goes; the loader hangs outside the words and the arrow keeps
   its room, so the words stay exactly where they were. */
.guest-words { position: relative; }
.guest-btn .guest-words > .loader { position: absolute; right: calc(100% + var(--gap-words-words)); top: 50%; transform: translateY(-50%); }
.guest-btn:not([aria-busy="true"]) .loader { display: none; }
.guest-btn[aria-busy="true"] .arrow { visibility: hidden; }
.guest-btn[aria-busy="true"] { cursor: progress; }
.guest-btn:hover > .face, .guest-btn.is-pointed > .face { color: var(--ink); --face-color: var(--clear-hover); }
.guest-btn:hover .cut-line polygon, .guest-btn.is-pointed .cut-line polygon { stroke: var(--line); }
.guest-btn:hover .arrow, .guest-btn.is-pointed .arrow { transform: translateX(4px); }
.guest-btn:active > .face, .guest-btn.is-pressed > .face { color: var(--ink); --face-color: var(--clear-press); box-shadow: var(--press-shade); transform: translateY(1px); transition-duration: 0.08s; }
.guest-btn:active .cut-line polygon, .guest-btn.is-pressed .cut-line polygon { stroke: var(--line); }
.guest-btn:active .arrow, .guest-btn.is-pressed .arrow { transform: translateX(7px); transition-duration: 0.12s; }
.guest-btn:focus-visible > .face, .guest-btn.is-focused > .face { color: var(--ink); }
.guest-btn:focus-visible .cut-line polygon, .guest-btn.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .guest-btn > .face, .guest-btn .arrow { transition: --face-color 0.2s, color 0.2s; } }
`,
  render: guestButton,
  examples: [
    ...stateExamples((state) => guestButton("Continue as guest", { state }), "guest", true),
    { label: "Under the ways in", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${waysIn()}${guestButton("Continue as guest")}</div>` },
    { label: "Busy: the loader before its words, which stay where they were", markup: html`<div style="${COLUMN}">${guestButton("Continue as guest", { isBusy: true })}</div>`, isStill: true },
  ],
});

export interface QuietButtonOptions extends ButtonTarget {
  /** An icon before its words, like Show all's chevron. */
  icon?: IconName;
  /**
   * Only its icon shows, its words said to a screen reader, and pointing brings up its slab with no orange line under it: a pane's Close and
   * a sheet's Back, which sit quietly in its corners until they're wanted.
   */
  isLabelHidden?: boolean;
  /** A small control's height, as a pane's corner buttons are. */
  isSmall?: boolean;
  /** Can't be pressed now: its words fade further and it answers no pointer. */
  isDisabled?: boolean;
  isBusy?: boolean;
  state?: ButtonState;
}

/**
 * A quiet button: words, an icon or both alone at rest, the quietest thing you press (Skip for now, Show all, Undo; a sheet's Back and Close). It's a control's size with a slab that
 * shows only when you point at it, so it sits and is cut like any control, its words as far in as a field's (--pad-inside-words: on a
 * pane's edge, at the pane's margin). Pointing brings up the slab and draws the orange line in under its words; keyboard focus is the cut
 * stroke round the slab, as on every button.
 */
export function quietButton(label: string, options: QuietButtonOptions = {}): ControlMarkup {
  const isIconOnly = Boolean(options.isLabelHidden && options.icon);
  const extra = html`${disabledAttribute(options)}${isIconOnly ? html` aria-label="${label}"` : ""}`;
  return controlMarkup(html`${opening(classes("quiet-btn", isIconOnly && "icon-only", options.isSmall && "small", options.state), options, options.isBusy, extra)}<span class="face" data-cut-line="${options.isSmall ? 9 : 10}">${CUT_LINE}<span class="quiet-words">${loader()}${options.icon ? icon(options.icon) : ""}${isIconOnly ? "" : html`<span class="quiet-label">${label}</span>`}</span>${isIconOnly ? "" : raw('<span class="quiet-line" aria-hidden="true"></span>')}</span>${closing(options)}`, options.isSmall ? "small" : "regular");
}

component({
  name: "Quiet button",
  slug: "quiet-button",
  group: "actions",
  subgroup: "words",
  summary: "The quietest thing to press: words, an icon, or both, with no slab until it's pointed at. Skip for now, Show all, Undo; only its icon, a sheet's Back and Close. Beside a cut button it's the way out; never the one thing to do.",
  styles: `
/* A quiet button: words only, at rest, in a control's box: its words keep a field's inset (--pad-inside-words), so on a pane's edge they're
   at the pane's margin while its box is at the frame gap, cut by the edge rule like any control's (slanting toward a control beside it).
   Pointing at it brings up its slab, faint (--wash), and draws the orange line in under its words from the left, a light running ahead
   along it, the way a cover's line does; leaving, the line runs on out to the right, quicker than it came. A press sinks it a pixel.
   Keyboard focus is the cut stroke round its slab, as on every other button. The shell (the button) stays still; its face moves. */
.quiet-btn { --control-height: var(--control-height-regular); vertical-align: middle; max-width: 100%; }
/* Small, and only its icon (a pane's Close, a sheet's Back): a square of a small control's size, its slab and no line under it when pointed at. */
.quiet-btn.small { --control-height: var(--control-height-small); }
/* On a touch screen a small one still takes a finger, as a small cut button does: its hit area reaches out to 44px, its look unchanged. */
@media (pointer: coarse) { .quiet-btn.small { position: relative; } .quiet-btn.small::after { content: ""; position: absolute; inset: calc((var(--control-height) - var(--touch-target)) / 2); } }
.quiet-btn.icon-only > .face { width: var(--control-height); padding: 0; align-items: center; }
.quiet-btn.icon-only .ico { width: 18px; height: 18px; }
.quiet-btn:focus-visible { outline: none; }
.quiet-btn > .face { position: relative; display: flex; flex: auto; flex-direction: column; justify-content: center; min-width: 0; height: var(--control-height); padding: 0 var(--pad-inside-words);
  font: var(--type-label); color: var(--ink-2); white-space: nowrap; --face-color: transparent; background-color: var(--face-color); clip-path: var(--cut-shape);
  transition: --face-color 0.2s, color 0.2s, opacity 0.2s, transform 0.4s ${SPRING}; }
.quiet-words { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; gap: var(--gap-words-words); min-width: 0; font: var(--type-label); }
/* Words longer than the room it has end in an ellipsis on one line. */
.quiet-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* The line sits just under the words, which stay on the control's center line, level with a cut button's beside it. */
.quiet-line { position: absolute; z-index: 2; left: var(--pad-inside-words); right: var(--pad-inside-words); top: calc(50% + 0.5lh); display: block; height: 3px; margin-top: 5px; overflow: hidden; clip-path: polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%);
  background: linear-gradient(90deg, #E9820C, var(--run) 40%, #FFB54D); transform: scaleX(0); transform-origin: right; transition: transform 0.22s cubic-bezier(.4,0,1,1); }
.quiet-line::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 38%; opacity: 0; background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,246,228,0.95) 70%, rgba(255,255,255,0)); }
.quiet-btn:hover > .face, .quiet-btn.is-pointed > .face { color: var(--ink); --face-color: var(--wash); }
.quiet-btn:focus-visible > .face, .quiet-btn.is-focused > .face { color: var(--ink); }
.quiet-btn:hover .quiet-line, .quiet-btn.is-pointed .quiet-line { transform: scaleX(1); transform-origin: left; transition: transform 0.42s cubic-bezier(.2,.8,.2,1); }
.quiet-btn:hover .quiet-line::after, .quiet-btn.is-pointed .quiet-line::after { animation: quiet-glint 0.7s cubic-bezier(.3,.6,.3,1) both; }
@keyframes quiet-glint { 0% { transform: translateX(-100%); opacity: 1; } 75% { opacity: 1; } 100% { transform: translateX(270%); opacity: 0; } }
.quiet-btn:active > .face, .quiet-btn.is-pressed > .face { color: var(--ink); --face-color: var(--wash-press); transform: translateY(1px); transition-duration: 0.08s; }
/* Keyboard focus: the cut stroke round its slab, as on every other button. */
.quiet-btn:focus-visible .cut-line polygon, .quiet-btn.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Can't press: its words fade further than at rest, and it answers no pointer. */
.quiet-btn:disabled:not([aria-busy="true"]) { cursor: default; pointer-events: none; }
.quiet-btn:disabled:not([aria-busy="true"]) > .face { color: var(--muted); opacity: 0.6; }
/* Waiting: the loader before its words, in the icon's place. */
.quiet-btn:not([aria-busy="true"]) .loader, .quiet-btn[aria-busy="true"] .quiet-words > .ico { display: none; }
.quiet-btn[aria-busy="true"] { cursor: progress; }
@media (prefers-reduced-motion: reduce) { .quiet-btn > .face, .quiet-line { transition: --face-color 0.2s, color 0.2s; } .quiet-line::after { animation: none !important; } }
`,
  render: quietButton,
  examples: [
    ...stateExamples((state) => quietButton("Skip for now", { type: "button", state }), "text"),
    { label: "Busy", markup: quietButton("Undo", { type: "button", isBusy: true }), isStill: true },
    { label: "Can't press", markup: quietButton("Undo", { type: "button", isDisabled: true }), isStill: true },
    { label: "With an icon", markup: quietButton("Show all 1,284 replies", { type: "button", icon: "chevron-down" }) },
    { label: "Beside a cut button: the way out", markup: html`<div class="control-row">${cutButton("Save", { type: "button" })}${quietButton("Cancel", { type: "button" })}</div>` },
    { label: "Long words: one line, ending in an ellipsis", markup: html`<div style="${COLUMN}">${quietButton("Skip the tutorial and go straight to the first match", { type: "button" })}</div>` },
    {
      label: "Only its icon, small: a sheet's Back and Close in its top corners, nothing behind them until pointed at",
      markup: html`<div style="width:300px">${glassPane({ paneWidth: "full", body: paneParts({ head: { start: quietButton("Back", { type: "button", icon: "chevron-back", isLabelHidden: true, isSmall: true }), words: html`<h2 class="sheet-title">Liam</h2>`, end: quietButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true }) }, body: html`<p>Profile, Block and Report go here.</p>` }) })}</div>`,
    },
    { label: "Only its icon, pointed: its slab, with no orange line under it", markup: quietButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true, state: "is-pointed" }), isStill: true },
  ],
});

export interface DeleteButtonOptions {
  /** Where its confirm step posts. */
  action: string;
  /** The confirm's words: "Delete Ashen Crown". */
  confirmLabel: string;
  /** One sentence on what goes, said on the confirm step: "Its page, saves and stats are gone for good." */
  confirmText: string;
  /** Its confirm step's id, unique on the page. Made from action when left out. */
  id?: string;
  isFullWidth?: boolean;
  state?: ButtonState;
  /** Only its confirm step, open in place: the gallery's still copy. */
  isConfirmShown?: boolean;
  /** Its confirm pressed and waiting, the loader before its words: the gallery's still copy (BUSY_SCRIPT does it on a page). */
  isConfirmBusy?: boolean;
}

/** The red confirm: the runner's shape and edge light, in red, with no glint and no lean. Only a delete's confirm step has it. */
const dangerButton = (label: string, isBusy?: boolean) =>
  html`${opening("danger-wrap", { type: "submit" }, isBusy)}<span class="face danger cut-raised" data-cut-line="12">${CUT_LINE}${loader()}<span class="danger-words">${label}</span></span>${closing({})}`;

/** A delete: a cut button with a trash icon, never orange, that opens its confirm step, a sheet with one sentence, Cancel, and the only red in Zaisma. */
export function deleteButton(label: string, options: DeleteButtonOptions): ControlMarkup {
  const id = options.id ?? `delete-${options.action.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  const sheet = sheetMarkup({
    id,
    title: `${label}?`,
    body: html`<p class="sheet-text">${options.confirmText}</p>`,
    closeButton: quietButton("Close", { type: "submit", formMethod: "dialog", icon: "close", isLabelHidden: true, isSmall: true }),
    buttons: [cutButton("Cancel", { type: "submit", formMethod: "dialog", isAutofocused: true }), controlMarkup(dangerButton(options.confirmLabel, options.isConfirmBusy), "regular")],
    action: options.action,
    isShown: options.isConfirmShown,
    isConfirm: true,
  });
  return controlMarkup(options.isConfirmShown ? sheet : html`${sheet}${cutButton(label, { type: "button", icon: "trash", controls: id, isFullWidth: options.isFullWidth, state: options.state })}`, "regular");
}

const GAME_DELETE = { action: "#delete-button", confirmLabel: "Delete Ashen Crown", confirmText: "Its page, versions, saves and stats are gone for good. Players who have it open are sent home." } as const;

component({
  name: "Delete button",
  slug: "delete-button",
  group: "actions",
  subgroup: "buttons",
  summary: "Deleting a game, a key, an account: a cut button, never orange. Only its confirm step turns red, the one red in Zaisma, after one sentence on what goes.",
  styles: `
/* A delete's confirm: the runner's shape, height and edge light, in red; no glint and no lean, since it's the moment to stop and read.
   A press sinks it into the glass, its light turned round, like any raised control. The shell stays still; its face moves. */
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
.danger-wrap:active > .danger, .danger-wrap.is-pressed > .danger { --face-color: var(--danger-lo); box-shadow: inset 0 2px 5px rgba(60,0,0,0.35); transform: translateY(1px); transition-duration: 0.08s; }
.danger-wrap:active > .danger > .cut-line, .danger-wrap.is-pressed > .danger > .cut-line { --band-top: rgba(96,14,4,0.5); --band-left: rgba(110,20,10,0.35); --band-right: rgba(255,196,186,0.4); --band-bottom: rgba(255,214,206,0.6); }
.danger-wrap:focus-visible > .danger > .cut-line polygon, .danger-wrap.is-focused > .danger > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.danger-wrap[aria-busy="true"] { cursor: progress; }
.danger-wrap:not([aria-busy="true"]) .loader { display: none; }
[data-glass] .control-row > .danger-wrap > .danger { width: 100%; }
@media (max-width: 760px) { .danger { padding: 0 20px; font-size: 0.9375rem; } }
@media (prefers-reduced-motion: reduce) { .danger { transition: --face-color 0.2s; } }
`,
  render: deleteButton,
  examples: [
    ...stateExamples((state) => deleteButton("Delete this game", { ...GAME_DELETE, id: `example-delete-${state ?? "rest"}`, state }), "cut").filter((example) => example.label !== "Try it" && example.label !== "On a loop"),
    { label: "Try it: it opens its confirm step", markup: deleteButton("Delete this game", { ...GAME_DELETE, id: "example-delete-try" }) },
    { label: "Its confirm step", markup: deleteButton("Delete this game", { ...GAME_DELETE, id: "example-delete-shown", isConfirmShown: true }), isWide: true, isStill: true },
    { label: "Its confirm step, deleting", markup: deleteButton("Delete this game", { ...GAME_DELETE, id: "example-delete-busy", isConfirmShown: true, isConfirmBusy: true }), isWide: true, isStill: true },
    {
      label: "A long game title",
      markup: deleteButton("Delete this game", { ...GAME_DELETE, id: "example-delete-long", confirmLabel: "Delete Ashen Crown: The Long Night of the Iron Vigil", confirmText: "Ashen Crown: The Long Night of the Iron Vigil goes for good: its page, 214 versions, 1,240,318 saves and its stats. Players who have it open are sent home.", isConfirmShown: true }),
      isWide: true,
      isStill: true,
    },
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
/* A link: the words' own font, ink, with an orange underline. Under the pointer a faint wash comes up behind its words (--wash, reaching a
   little round them on every line it wraps onto) and the line thickens; a press deepens the wash. Quiet: plain until pointed at, when the line
   and the wash come up. Keyboard focus is the focus outline: a link can wrap across lines, so it can't take a control's cut. */
.link { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-color: var(--run); text-decoration-thickness: 2px; text-underline-offset: 3px;
  --face-color: transparent; background-color: var(--face-color); box-shadow: 0 0 0 3px var(--face-color); -webkit-box-decoration-break: clone; box-decoration-break: clone;
  transition: --face-color 0.15s, text-decoration-color 0.15s, color 0.15s; }
.link:hover, .link.is-pointed { --face-color: var(--wash); text-decoration-thickness: 3px; }
.link:active { --face-color: var(--wash-press); }
.link.quiet { color: inherit; font-weight: inherit; text-decoration-color: transparent; }
.link.quiet:hover, .link.quiet.is-pointed { color: var(--ink); text-decoration-color: var(--run); text-decoration-thickness: 2px; }
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
    { label: "Alone in a pane: fits its top and its bottom", markup: edgePane(cutButton("Make an account", { type: "button", isFullWidth: true })) },
    { label: "Side by side: slants between, fits the outside", markup: edgePane(html`<div class="control-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>`) },
    {
      label: "Stacked: fits the top and the bottom, square between",
      markup: edgePane(html`<div class="edge-stack">${cutButton("Settings", { type: "button", isFullWidth: true })}${cutButton("Account", { type: "button", isFullWidth: true })}${cutButton("Sign out", { type: "button", isFullWidth: true })}</div>`),
    },
    { label: "On no pane: cut as if it were in one", markup: html`<div class="control-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>` },
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
    cutButton(`Scroll ${options.rowName} ${way}`, { type: "button", icon: way === "back" ? "arrow-back" : "arrow-on", isLabelHidden: true, isInWell: true, controls: options.trackId });
  return controlMarkup(html`<div class="steps cut-carved" data-row-arrows${options.scrolledTo ? html` data-scrolled-to="${options.scrolledTo}"` : ""} data-cut-line="9">${CUT_LINE}${arrow("back")}${arrow("on")}</div>`, "small", { isPointerOnly: true });
}
