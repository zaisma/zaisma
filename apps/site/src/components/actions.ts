import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { CUT_LINE, ICONS, colourPicker, glassPane, icon, loader, type ColourChoice, type IconName } from "./foundations.ts";

/*
 * Actions, loudest to quietest: the runner button (the one coloured thing you press), the cut button beside it,
 * the glass buttons for the other ways in, and the guest button below them. Each answers the pointer, the press
 * and the keyboard in its own way, so none of them feels dead.
 */

/** The runner's arrow: the icon set's chevron, in a span that moves. */
const ARROW = html`<span class="arrow" aria-hidden="true">${icon("chevron-right")}</span>`;

/** What a button is: a link when it has an address, otherwise a button of a form. */
interface ButtonTarget {
  href?: string;
  type?: "submit" | "button";
  name?: string;
  buttonValue?: string;
}

/** The gallery's fixed states, so they sit still side by side. */
type ButtonState = "is-pointed" | "is-pressed" | "is-focused";

/** The button itself: a still shell that takes the pointer (TOKEN_STYLES, "Still under the pointer"). What moves goes inside it, in its face. */
const opening = (className: string, target: ButtonTarget, isBusy: boolean | undefined, extra: Raw | "" = "") =>
  target.href
    ? html`<a class="shell ${className}" href="${target.href}"${extra}${isBusy ? raw(' aria-busy="true"') : ""}>`
    : html`<button class="shell ${className}" type="${target.type ?? "submit"}"${extra}${target.name ? html` name="${target.name}"` : ""}${target.buttonValue !== undefined ? html` value="${target.buttonValue}"` : ""}${isBusy ? raw(' aria-busy="true" disabled') : ""}>`;
const closing = (target: ButtonTarget) => raw(target.href ? "</a>" : "</button>");
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

export interface RunButtonOptions extends ButtonTarget {
  /** The home's Play: 56px, for a pane's one main action. */
  isBig?: boolean;
  isFullWidth?: boolean;
  /** Pressed and waiting: the loader takes the arrow's (or icon's) place, and busyLabel (if any) the label's. */
  isBusy?: boolean;
  busyLabel?: string;
  /** An icon before the label in place of the arrow after it, like Play's. */
  icon?: IconName;
  state?: ButtonState;
}

/** The runner button: a raised orange slab, the same height as the other buttons, lit along its edges. It lifts, leans toward the pointer and catches the light; pressing sinks it into the glass. */
export function runButton(label: string, options: RunButtonOptions = {}): Raw {
  const words = options.busyLabel ? html`<span class="label-idle">${label}</span><span class="label-busy">${options.busyLabel}</span>` : html`<span>${label}</span>`;
  const shell = classes("run-wrap", options.isFullWidth && "is-full", options.state);
  return html`${opening(shell, options, options.isBusy)}<span class="${options.isBig ? "face run big" : "face run"} cut-raised" data-cut-line="${options.isBig ? 14 : 12}">${CUT_LINE}${loader()}${options.icon ? icon(options.icon) : ""}${words}${options.icon ? "" : ARROW}</span>${closing(options)}`;
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
  /** 30px, inside a carved strip of its own (Row arrows' well), which it fills but for the strip's inset. */
  isInWell?: boolean;
  /** Can't be pressed now (a row's arrow at its end): it lies flat, faded. */
  isDisabled?: boolean;
  /** A toggle: on is sunk into the glass, its light turned round, as when it's pressed. Left out, it isn't a toggle. */
  isPressed?: boolean;
  /** The id of what it shows, hides or changes (aria-controls). */
  controls?: string;
  /** It opens what it controls (a dropdown, a search): whether that's open now (aria-expanded). Left out, it opens nothing. */
  isExpanded?: boolean;
}

/** A secondary button: a cut slab of clearer glass with a drawn outline. It brightens under the pointer and gives under a press. A delete is one too, never orange. */
export function cutButton(label: string, options: CutButtonOptions = {}): Raw {
  const className = classes("cut-btn", options.isBig && "big", options.isSmall && "small", options.isInWell && "in-well", options.isLabelHidden && "icon-only", options.isFullWidth && "is-full", options.state);
  const extra = html`${options.isDisabled && !options.href ? raw(" disabled") : ""}${options.isLabelHidden ? html` aria-label="${label}"` : ""}${options.isPressed !== undefined ? html` aria-pressed="${options.isPressed ? "true" : "false"}"` : ""}${options.controls ? html` aria-controls="${options.controls}"` : ""}${options.isExpanded !== undefined ? html` aria-expanded="${options.isExpanded ? "true" : "false"}"` : ""}`;
  return html`${opening(className, options, options.isBusy, extra)}<span class="face cut-raised" data-cut-line="${options.isBig ? 13 : 10}">${CUT_LINE}${loader()}${options.icon ? icon(options.icon) : ""}${options.isLabelHidden ? "" : html`<span>${label}</span>`}</span>${closing(options)}`;
}

const GOOGLE = raw(
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
);
const DISCORD = raw(
  '<svg class="one-colour" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25 19.74 19.74 0 0 0-4.88 1.52C.53 9.050-.32 13.58.1 18.06a19.9 19.9 0 0 0 5.99 3.03c.46-.63.87-1.3 1.23-1.99a13.1 13.1 0 0 1-1.870-.9l.37-.29c3.93 1.79 8.18 1.79 12.06 0l.37.29c-.6.35-1.22.65-1.87.9.36.7.77 1.36 1.22 1.99a19.84 19.84 0 0 0 6-3.03c.5-5.18-.84-9.68-3.55-13.66zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.420 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.420 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/></svg>',
);
/** The other ways in, with the marks their owners ask for. A mark that may also be one colour (Discord's) is class one-colour. */
const WAY_ICONS = { google: GOOGLE, discord: DISCORD, passkey: raw(ICONS.passkey) } as const;

/** A glass button's tint: clear glass, or glass tinted the colour of the way in. Each way has its own unless the page picks one. */
export type GlassTint = "clear" | "white" | "blue" | "indigo" | "black";
const WAY_TINTS: Record<keyof typeof WAY_ICONS, GlassTint> = { google: "white", discord: "indigo", passkey: "clear" };

/** A glass button for another way in (a passkey, Google, Discord): a small slab of the panes' glass, with their rim. Quieter than the runner, louder than the guest way. */
export function glassButton(label: string, options: { href?: string; type?: "submit" | "button"; icon: keyof typeof WAY_ICONS; tint?: GlassTint; state?: ButtonState; isBusy?: boolean }): Raw {
  const tint = options.tint ?? WAY_TINTS[options.icon];
  const target = { href: options.href, type: options.type ?? "button" } as const;
  return html`${opening(classes("glass-btn", options.state), target, options.isBusy, html` data-tint="${tint}"`)}<span class="face glass" data-glass data-cut-line="10" data-glass-band="3">${loader()}${WAY_ICONS[options.icon]}<span>${label}</span></span>${closing(target)}`;
}

const GUEST_ARROW = html`<span class="arrow" aria-hidden="true">${icon("chevron-right")}</span>`;

/** The guest way: words and an arrow under the glass buttons, the quietest way on. Its cut slab shows only when you point at it, press it or tab to it. */
export function guestButton(label: string, options: { href?: string; type?: "submit" | "button"; state?: ButtonState; isBusy?: boolean } = {}): Raw {
  return html`${opening(classes("guest-btn", options.state), { href: options.href, type: options.type ?? "button" }, options.isBusy)}<span class="face" data-cut-line="10">${CUT_LINE}<span>${label}</span>${loader()}${GUEST_ARROW}</span>${closing({ href: options.href })}`;
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
  new MutationObserver(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(function (node) { if (node.querySelectorAll) node.querySelectorAll(".run-wrap").forEach(lean); }); }); }).observe(document.body, { subtree: true, childList: true });
  document.addEventListener("pointermove", function (event) {
    var shell = event.target.closest && event.target.closest(".glass-btn"); if (!shell) return;
    var r = shell.getBoundingClientRect();
    shell.style.setProperty("--mx", (event.clientX - r.left).toFixed(0) + "px"); shell.style.setProperty("--my", (event.clientY - r.top).toFixed(0) + "px");
  }, { passive: true });
})();
`;

const SPRING = "cubic-bezier(.25,.9,.3,1.25)";

const RUN_STYLES = `
/* The runner button: the one coloured thing you can press. A raised orange slab, the same height as every other button,
   lit along its edges like the other raised controls (the edge rule's bands, in orange). It lifts, leans toward you and
   a glint crosses it as you arrive; a press sinks it into the glass, its light turning round, and it springs back.
   The shell (.run-wrap, the link or button) stays still; its face (.run) moves inside it.
   .over is the pointer on it (RUNNER_SCRIPT); is-pointed, is-pressed and is-focused fix those states for the gallery. */
.run-wrap { isolation: isolate; vertical-align: middle; perspective: 600px; }
.run-wrap:focus-visible { outline: none; }
.run-wrap.is-full { display: flex; width: 100%; perspective: 700px; }
/* Its warm glow on what's under it: it spreads as the slab lifts and gathers in as it's pressed. */
.run-wrap::before { content: ""; position: absolute; z-index: -1; left: 8%; right: 8%; top: 40%; bottom: -8px; border-radius: 50%; pointer-events: none;
  background: rgba(247,147,26,0.32); filter: blur(11px); opacity: 0.7; transition: opacity 0.5s, transform 0.5s cubic-bezier(.2,.7,.2,1); }
.run-wrap.over::before, .run-wrap.is-pointed::before { opacity: 1; transform: translateY(3px) scaleX(1.05); }
.run-wrap:active::before, .run-wrap.is-pressed::before { opacity: 0.45; transform: translateY(-2px) scaleX(0.94); transition-duration: 0.1s; }
.run {
  --refl: 50%;
  position: relative; z-index: 1; overflow: hidden; height: 44px; padding: 0 24px 0 22px;
  display: flex; align-items: center; gap: 10px; white-space: nowrap;
  color: #fff; text-shadow: 0 1px 1px rgba(120,58,0,0.4);
  font: 600 16px var(--display); letter-spacing: 0.01em;
  /* The face: lit from above, deepening toward its foot. */
  background: radial-gradient(130% 110% at 50% -35%, rgba(255,255,255,0.3), rgba(255,255,255,0) 62%), linear-gradient(180deg, var(--run-hi), var(--run) 52%, #E57F0C);
  clip-path: var(--cut-shape);
  transform: translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.45s ${SPRING}, --refl 0.6s cubic-bezier(.2,.7,.2,1), filter 0.2s;
}
/* Its edge light: bright where the light lands on its top and leading edges, its own orange's shade along its foot. */
.run.cut-raised > .cut-line { --band-top: rgba(255,240,214,0.85); --band-left: rgba(255,226,180,0.55); --band-right: rgba(150,72,0,0.32); --band-bottom: rgba(130,60,0,0.55); }
.is-full > .run { width: 100%; justify-content: center; }
.run.big { height: 56px; justify-content: center; padding: 0 30px 0 26px; font-size: 19px; gap: 12px; }
/* The reflection of a fixed light: a soft band that slides the opposite way to the pointer. */
.run::before { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, rgba(255,255,255,0) calc(var(--refl) - 22%), rgba(255,255,255,0.2) var(--refl), rgba(255,255,255,0) calc(var(--refl) + 22%)); opacity: 0; transition: opacity 0.6s; }
.run-wrap.over .run::before, .run-wrap.is-pointed .run::before { opacity: 1; }
/* The glint: one sweep as the pointer arrives, always finished. */
.run::after { content: ""; position: absolute; top: -20%; bottom: -20%; width: 36%; left: -50%; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0)); transform: skewX(-20deg); pointer-events: none; }
.run.glint::after { animation: run-glint 0.45s cubic-bezier(.3,.1,.3,1) both; }
@keyframes run-glint { from { left: -50%; } to { left: 120%; } }
.run > :not(.cut-line) { position: relative; z-index: 2; }
.run .arrow, .run .play { display: inline-flex; transition: transform 0.6s cubic-bezier(.2,.7,.2,1); }
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
/* On a phone it keeps the other buttons' heights: 44px, and 48px big. */
@media (max-width: 760px) { .run { padding: 0 20px 0 16px; font-size: 15px; } .run.big { height: 48px; font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .run, .run .arrow, .run .play, .run-wrap::before { transition: none; } .run.glint::after { animation: none; } }
`;

/** A full-width button's examples sit in a column this wide. */
const COLUMN = "width:min(340px,100%)";

/**
 * A button's states, still, side by side; then one to try, and one that points, presses and lets go on a loop
 * (the gallery's design-loops script plays it: data-state-loop names what it plays). Full-width buttons get a column.
 */
const stateExamples = (render: (state?: ButtonState) => Raw, loopKind: "runner" | "cut" | "glass" | "guest", isFullWidth = false) => {
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
  summary: "The one thing to do on a screen: Play, Sign in, Next. Never more than one in view, and visible without scrolling.",
  styles: RUN_STYLES,
  render: runButton,
  examples: [
    ...stateExamples((state) => runButton("Sign in", { type: "button", state }), "runner"),
    { label: "Busy", markup: runButton("Sign in", { type: "button", isBusy: true, busyLabel: "Signing in" }), isStill: true },
    { label: "Small", markup: runButton("Next", { type: "button" }) },
    { label: "Big, with Play", markup: runButton("Play", { type: "button", isBig: true, icon: "play" }) },
    { label: "Full width", markup: html`<div style="width:min(380px,100%)">${runButton("Sign in", { type: "button", isFullWidth: true, isBig: true })}</div>` },
  ],
});

component({
  name: "Cut button",
  slug: "cut-button",
  group: "actions",
  summary: "Everything else you can press: Details, Make an account, Cancel. A delete is a cut button too, never orange; only its confirm step turns red.",
  styles: `
/* A secondary button: a cut slab of clearer glass with a drawn outline. It brightens under the pointer;
   a press sinks it (down a pixel, shaded from above, its light turned round), never shrinking it, quickly, and it springs back when let go.
   The shell (the button) stays still; the slab is its face. */
.cut-btn { flex: none; vertical-align: middle; }
.cut-btn.is-full { display: flex; width: 100%; }
.cut-btn > .face { display: flex; flex: auto; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 24px;
  font: 600 15px var(--display); color: var(--ink); white-space: nowrap;
  --face-colour: var(--btn); background: var(--face-colour); clip-path: var(--cut-shape);
  transition: --face-colour 0.2s, box-shadow 0.2s, opacity 0.15s, transform 0.4s ${SPRING}; }
/* Big keeps the same slant angle as the rest, so it is the same button, larger. */
.cut-btn.big > .face { height: 56px; padding: 0 28px; font-size: 17px; }
.cut-btn.small > .face { height: 36px; padding: 0 14px; }
/* Only its icon: as wide as a little more than it's tall. */
.cut-btn.icon-only > .face { width: 52px; padding: 0; }
.cut-btn.small.icon-only > .face { width: 42px; }
.cut-btn.in-well > .face { height: 30px; padding: 0 14px; color: var(--ink-2); }
.cut-btn.in-well.icon-only > .face { width: 46px; padding: 0; }
.cut-btn:hover > .face, .cut-btn.is-pointed > .face { --face-colour: var(--btn-hover); }
.cut-btn:active > .face, .cut-btn.is-pressed > .face { --face-colour: var(--btn-press); box-shadow: var(--press-shade); transform: translateY(1px); transition-duration: 0.08s; }
/* A press sinks it into the glass: its light turns round, as on a carved field. */
/* A toggle that's on stays sunk, the same as a press. */
.cut-btn[aria-pressed="true"] > .face { --face-colour: var(--btn-press); }
.cut-btn:active > .face > .cut-line, .cut-btn.is-pressed > .face > .cut-line, .cut-btn[aria-pressed="true"] > .face > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.cut-btn:focus-visible { outline: none; }
.cut-btn:focus-visible > .face, .cut-btn.is-focused > .face { --face-colour: var(--btn-hover); }
.cut-btn:focus-visible .cut-line polygon, .cut-btn.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.cut-btn .face > span, .cut-btn .face > .ico { position: relative; z-index: 2; }
/* Can't press: it lies flat, faded, and answers nothing. */
.cut-btn:disabled:not([aria-busy="true"]) { cursor: default; }
.cut-btn:disabled:not([aria-busy="true"]) > .face, .cut-btn:disabled:not([aria-busy="true"]):hover > .face { --face-colour: transparent; opacity: 0.35; box-shadow: none; transform: none; }
.cut-btn:disabled:not([aria-busy="true"]) > .face > .cut-line { --band-top: transparent; --band-left: transparent; --band-right: transparent; --band-bottom: transparent; }
.cut-btn[aria-busy="true"] { cursor: progress; }
/* Waiting: the loader before its words, in the icon's place. */
.cut-btn:not([aria-busy="true"]) .loader, .cut-btn[aria-busy="true"] .face > .ico { display: none; }
.cut-btn .face > .loader { position: relative; z-index: 2; }
@media (max-width: 760px) { .cut-btn.big > .face { height: 48px; padding: 0 20px; } }
@media (prefers-reduced-motion: reduce) { .cut-btn > .face { transition: --face-colour 0.2s; } }
`,
  render: cutButton,
  examples: [
    ...stateExamples((state) => cutButton("Details", { type: "button", state }), "cut"),
    { label: "Busy", markup: cutButton("Saving", { type: "button", isBusy: true }), isStill: true },
    { label: "With an icon", markup: cutButton("Settings", { type: "button", icon: "gear" }) },
    { label: "Only its icon", markup: cutButton("Light. Switch to dark", { type: "button", icon: "light-dark", isLabelHidden: true }) },
    { label: "Small", markup: cutButton("Show", { type: "button", isSmall: true }) },
    { label: "Can't press", markup: cutButton("Details", { type: "button", isDisabled: true }), isStill: true },
    { label: "A toggle, off and on", markup: html`<div class="control-row">${cutButton("Show", { type: "button", isSmall: true, isPressed: false })}${cutButton("Hide", { type: "button", isSmall: true, isPressed: true })}</div>` },
    { label: "Big, beside Play", markup: html`<div class="control-row">${runButton("Play", { type: "button", isBig: true, icon: "play" })}${cutButton("Details", { type: "button", isBig: true })}</div>` },
    { label: "Full width", markup: html`<div style="width:min(380px,100%)">${cutButton("Make an account", { type: "button", isFullWidth: true })}</div>` },
    { label: "A delete", markup: cutButton("Delete this game", { type: "button" }) },
  ],
});

const PICTURE = "display:grid;gap:var(--gap-control-stack);width:min(380px,100%);padding:var(--pad-pane);background-position:center;background-size:cover;";
const wayIn = (state?: ButtonState) => glassButton("Sign in with a passkey", { icon: "passkey", state });
/** A glass button's tints, for a colour picker (inputs.ts's Colour picker, the gallery's tint palette). */
export const TINT_CHOICES: (ColourChoice & { colourValue: GlassTint })[] = [
  { name: "Clear", colourValue: "clear", swatch: "clear" },
  { name: "White", colourValue: "white", swatch: "#fff" },
  { name: "Blue", colourValue: "blue", swatch: "#2A75E8" },
  { name: "Indigo", colourValue: "indigo", swatch: "#5865F2" },
  { name: "Black", colourValue: "black", swatch: "#14171C" },
];
const tintPalette = () => html`<div class="tint-try" data-tint-try>${glassButton("Continue with Discord", { icon: "discord" })}${colourPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo" })}</div>`;
const waysIn = () => html`${glassButton("Sign in with a passkey", { icon: "passkey" })}${glassButton("Continue with Google", { icon: "google" })}${glassButton("Continue with Discord", { icon: "discord" })}`;

component({
  name: "Glass button",
  slug: "glass-button",
  group: "actions",
  summary: "Another way in, like a passkey, Google or Discord: below the runner, never instead of it.",
  styles: `
/* Glass buttons for the other ways in: a small slab of the panes' glass, cut and rimmed like them (GLASS_SCRIPT draws the rim).
   The pointer brings a light that follows it across the glass and brightens the rim; a press sinks the slab into its shade.
   The shell (the button) stays still and holds the tint; the slab is its face. */
.glass-btn { --mx: 38%; --my: 18%; display: flex; width: 100%; }
.glass-btn:focus-visible { outline: none; }
.glass-btn > .face {
  position: relative; display: flex; flex: auto; align-items: center; justify-content: center; gap: 10px; height: 48px; padding: 0 18px;
  font: 500 15px var(--display); color: var(--ink); white-space: nowrap;
  --glass-tint: var(--glass-btn-face);
  transition: var(--glass-transition), box-shadow 0.2s, transform 0.4s ${SPRING}; }
.glass-btn .face > :not(.edge) { position: relative; z-index: 3; }
.glass-btn .face > svg:not(.edge) { width: 20px; height: 20px; flex: none; transition: transform 0.4s ${SPRING}; }
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
/* A dark tint is a solid slab: no dark hairline, white facets or white top highlight (those read as a glitchy frame), only a
   rim in a lighter shade of its own colour, and a lift shadow that stays in its colour. */
.glass-btn[data-tint="blue"] .edge :is(.hair, .fringe, .facet, .inner, .spec-line, .dense, .rim-band), .glass-btn[data-tint="indigo"] .edge :is(.hair, .fringe, .facet, .inner, .spec-line, .dense, .rim-band), .glass-btn[data-tint="black"] .edge :is(.hair, .fringe, .facet, .inner, .spec-line, .dense, .rim-band) { opacity: 0; }
.glass-btn[data-tint="blue"] .edge .rim, .glass-btn[data-tint="indigo"] .edge .rim, .glass-btn[data-tint="black"] .edge .rim { stroke: color-mix(in srgb, var(--tint-colour) 58%, white); stroke-width: 1.6; opacity: 1; }
.glass-btn[data-tint="black"] .edge .rim { stroke: color-mix(in srgb, var(--tint-colour) 70%, white); }
.glass-btn[data-tint="blue"]:hover > .face, .glass-btn[data-tint="indigo"]:hover > .face, .glass-btn[data-tint="black"]:hover > .face,
.glass-btn[data-tint="blue"].is-pointed > .face, .glass-btn[data-tint="indigo"].is-pointed > .face, .glass-btn[data-tint="black"].is-pointed > .face { box-shadow: inset 0 -12px 18px -12px rgba(0,0,0,0.3); }
.glass-btn[data-tint="blue"]:focus-visible .edge .rim, .glass-btn[data-tint="indigo"]:focus-visible .edge .rim, .glass-btn[data-tint="black"]:focus-visible .edge .rim,
.glass-btn[data-tint="blue"].is-focused .edge .rim, .glass-btn[data-tint="indigo"].is-focused .edge .rim, .glass-btn[data-tint="black"].is-focused .edge .rim { stroke: var(--focus); stroke-width: 2; }
/* Tinted: the way's own colour, nearly solid, in either theme (a brand's colour is how you recognise it, so it doesn't
   follow light or dark): white glass with dark words, the coloured and black ones with white words. It's a touch stronger
   as you point at it and a touch clearer under a press. Changing the tint fades from one to the next. */
.glass-btn > .face { --tint-pct: 0%; --glass-layer: linear-gradient(color-mix(in srgb, var(--tint-colour) var(--tint-pct), transparent), color-mix(in srgb, var(--tint-colour) var(--tint-pct), transparent)); }
/* A brand's glass keeps its own colour: the page's hue never reaches it. */
.glass-btn[data-tint]:not([data-tint="clear"]) > .face { --glass-wash: linear-gradient(transparent, transparent); }
.glass-btn[data-tint] > .face { --tint-pct: var(--glass-btn-tint-rest); transition: var(--glass-transition), box-shadow 0.2s, transform 0.4s ${SPRING}, --tint-colour 0.3s, --tint-pct 0.3s; }
.glass-btn[data-tint]:hover > .face, .glass-btn[data-tint].is-pointed > .face, .glass-btn[data-tint]:focus-visible > .face, .glass-btn[data-tint].is-focused > .face { --tint-pct: var(--glass-btn-tint-hover); }
.glass-btn[data-tint]:active > .face, .glass-btn[data-tint].is-pressed > .face { --tint-pct: var(--glass-btn-tint-press); }
.glass-btn[data-tint="clear"] { --glass-btn-tint-rest: 0%; --glass-btn-tint-hover: 0%; --glass-btn-tint-press: 0%; }
.glass-btn[data-tint="white"] > .face { --tint-colour: #fff; color: #14171C; }
.glass-btn[data-tint="white"] { --glass-btn-tint-rest: 86%; --glass-btn-tint-hover: 97%; --glass-btn-tint-press: 74%; }
.glass-btn[data-tint="blue"], .glass-btn[data-tint="indigo"], .glass-btn[data-tint="black"] { --glass-btn-tint-rest: 95%; --glass-btn-tint-hover: 100%; --glass-btn-tint-press: 86%; --pointer-glow: rgba(255,255,255,0.35); }
.glass-btn[data-tint="blue"] > .face, .glass-btn[data-tint="indigo"] > .face, .glass-btn[data-tint="black"] > .face { color: #fff; }
.glass-btn[data-tint="blue"] > .face { --tint-colour: #2A75E8; }
.glass-btn[data-tint="indigo"] > .face { --tint-colour: #5865F2; }
.glass-btn[data-tint="black"] > .face { --tint-colour: #14171C; }
/* On a coloured or black tint a coloured mark would sink into it, so a mark that may be one colour turns white with the words.
   Google's G stays in its colours, which only ever sit on white or clear glass. */
.glass-btn[data-tint="blue"] .one-colour path, .glass-btn[data-tint="indigo"] .one-colour path, .glass-btn[data-tint="black"] .one-colour path { fill: currentColor; transition: fill 0.3s; }
/* On clear glass it's white over smoked glass, and its own blue over light (the fallback, since light glass leaves --clear-glass-mark unset). */
.glass-btn[data-tint="clear"] .one-colour path { fill: var(--clear-glass-mark, #5865F2); transition: fill 0.3s; }
/* The gallery's tint palette: a Colour picker; pick one and the button above takes it (GALLERY_SCRIPT). */
.tint-try { display: grid; gap: var(--gap-block-block); width: min(340px, 100%); }
@media (prefers-reduced-motion: reduce) { .glass-btn > .face, .glass-btn .face > svg:not(.edge) { transition: var(--glass-transition); } }
`,
  render: glassButton,
  examples: [
    ...stateExamples(wayIn, "glass", true),
    { label: "Busy", markup: html`<div style="${COLUMN}">${glassButton("Sign in with a passkey", { icon: "passkey", isBusy: true })}</div>`, isStill: true },
    { label: "Every tint: pick one", markup: tintPalette() },
    { label: "The ways in, each in its own tint", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${waysIn()}</div>` },
    // Over a game's picture the glass follows the picture, not the theme: light glass on a bright one, smoked on a dark one.
    { label: "Over a bright picture", markup: html`<div data-theme-choice="light" style="${PICTURE}background-image:url(/design/covers/frostline.webp)">${waysIn()}</div>` },
    { label: "Over a dark picture", markup: html`<div class="smoke" style="${PICTURE}background-image:url(/design/covers/neon-drift.webp)">${waysIn()}</div>` },
  ],
});

component({
  name: "Guest button",
  slug: "guest-button",
  group: "actions",
  summary: "The quietest way on, like Continue as guest: words and an arrow below the glass buttons, a slab only once you point at it.",
  styles: `
/* The guest way: below the glass buttons, so only words and an arrow at rest. Pointing at it brings up its cut slab and
   outline and sends the arrow on; a press sinks it; the keyboard's focus draws the outline in ink.
   The shell (the button) stays still; the slab is its face. */
.guest-btn { display: flex; width: 100%; }
.guest-btn:focus-visible { outline: none; }
.guest-btn > .face { display: flex; flex: auto; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 16px;
  font: 500 15px var(--display); color: var(--ink-2); white-space: nowrap; --face-colour: transparent; background-color: var(--face-colour);
  clip-path: var(--cut-shape);
  transition: --face-colour 0.2s, color 0.2s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
.guest-btn .face > :not(.cut-line) { position: relative; z-index: 2; }
.guest-btn .cut-line polygon { stroke: transparent; }
.guest-btn .arrow { display: inline-flex; transition: transform 0.45s cubic-bezier(.2,.7,.2,1); }
.guest-btn .arrow > .ico { width: 8px; height: 12px; stroke-width: 2.4; }
/* Waiting: the loader takes the arrow's place. */
.guest-btn:not([aria-busy="true"]) .loader, .guest-btn[aria-busy="true"] .arrow { display: none; }
.guest-btn[aria-busy="true"] { cursor: progress; }
.guest-btn:hover > .face, .guest-btn.is-pointed > .face { color: var(--ink); --face-colour: var(--clear-hover); }
.guest-btn:hover .cut-line polygon, .guest-btn.is-pointed .cut-line polygon { stroke: var(--line); }
.guest-btn:hover .arrow, .guest-btn.is-pointed .arrow { transform: translateX(4px); }
.guest-btn:active > .face, .guest-btn.is-pressed > .face { color: var(--ink); --face-colour: var(--clear-press); box-shadow: var(--press-shade); transform: translateY(1px); transition-duration: 0.08s; }
.guest-btn:active .cut-line polygon, .guest-btn.is-pressed .cut-line polygon { stroke: var(--line); }
.guest-btn:active .arrow, .guest-btn.is-pressed .arrow { transform: translateX(7px); transition-duration: 0.12s; }
.guest-btn:focus-visible > .face, .guest-btn.is-focused > .face { color: var(--ink); }
.guest-btn:focus-visible .cut-line polygon, .guest-btn.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
@media (prefers-reduced-motion: reduce) { .guest-btn > .face, .guest-btn .arrow { transition: --face-colour 0.2s, color 0.2s; } }
`,
  render: guestButton,
  examples: [
    ...stateExamples((state) => guestButton("Continue as guest", { state }), "guest", true),
    { label: "Under the ways in", markup: html`<div style="display:grid;gap:var(--gap-control-stack);${COLUMN}">${waysIn()}${guestButton("Continue as guest")}</div>` },
    { label: "Busy", markup: guestButton("Continue as guest", { isBusy: true }), isStill: true },
  ],
});

// Cut shapes sits with the buttons, so it can show the edge rule on real ones (foundations.ts can't import this file).
const edgePane = (body: Raw) => glassPane({ paneSize: "small", body });
export interface TextLinkOptions {
  /** In a list of links where nothing else is (a footer, a heading that links to itself): underlined only under the pointer. */
  isQuiet?: boolean;
  state?: "is-pointed" | "is-focused";
}

/** A link in words: ink with an orange underline, so it reads as a link without shouting. Quiet in a list of links, where it's plain until pointed at. */
export function textLink(words: string, href: string, options: TextLinkOptions = {}): Raw {
  return html`<a class="${classes("link", options.isQuiet && "quiet", options.state)}" href="${href}">${words}</a>`;
}

component({
  name: "Link",
  slug: "link",
  group: "actions",
  summary: "Words that go somewhere: underlined in orange inside a sentence, plain in a list of links until you point at them. Anything you press that isn't words is a button.",
  styles: `
/* A link: the words' own font, ink, with an orange underline (thicker under the pointer). Quiet: no line until pointed at. */
.link { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-color: var(--run); text-decoration-thickness: 2px; text-underline-offset: 3px; transition: text-decoration-color 0.15s, color 0.15s; }
.link:hover, .link.is-pointed { text-decoration-thickness: 3px; }
.link.quiet { color: inherit; font-weight: inherit; text-decoration-color: transparent; }
.link.quiet:hover, .link.quiet.is-pointed { color: var(--ink); text-decoration-color: var(--run); text-decoration-thickness: 2px; }
.link:focus-visible, .link.is-focused { outline: 2px solid var(--focus); outline-offset: 2px; }
`,
  render: textLink,
  examples: [
    { label: "In words", markup: html`<p style="margin:0;font:var(--type-words)">Updated a day ago · ${textLink("What's new", "#link")}</p>` },
    { label: "Pointed", markup: html`<p style="margin:0;font:var(--type-words)">${textLink("What's new", "#link", { state: "is-pointed" })}</p>`, isStill: true },
    { label: "Keyboard focus", markup: html`<p style="margin:0;font:var(--type-words)">${textLink("What's new", "#link", { state: "is-focused" })}</p>`, isStill: true },
    { label: "Quiet, in a list of links", markup: html`<p style="margin:0;display:flex;gap:var(--gap-words-words);font:var(--type-note);color:var(--ink-2)">${textLink("Forum", "#link", { isQuiet: true })}${textLink("Privacy", "#link", { isQuiet: true })}${textLink("Source code", "#link", { isQuiet: true })}</p>` },
    { label: "Quiet, pointed", markup: html`<p style="margin:0;font:var(--type-note);color:var(--ink-2)">${textLink("Forum", "#link", { isQuiet: true, state: "is-pointed" })}</p>`, isStill: true },
  ],
});

component({
  name: "Cut shapes",
  slug: "cut-shapes",
  group: "foundations",
  summary: "Corners are cut, never rounded: 20 and 14 on the header, 24 and 20 on panes. Controls follow the edge rule: a slant only beside another control in a row, and every other corner fits what holds it.",
  styles: `
/* Cut shapes: the glass's two cuts, then the edge rule on real buttons. */
.cuts { display: flex; flex-wrap: wrap; gap: var(--gap-block-block); align-items: flex-end; }
.cuts figure { margin: 0; display: grid; gap: var(--gap-words-control); font: var(--type-facts); color: var(--muted); }
.cuts .shape { background: var(--ink); opacity: 0.85; }
.cuts .header-cut { width: 260px; height: 68px; clip-path: polygon(0 20px, 20px 0, calc(100% - 14px) 0, 100% 14px, 100% calc(100% - 20px), calc(100% - 20px) 100%, 14px 100%, 0 calc(100% - 14px)); }
.cuts .pane-cut { width: 200px; height: 140px; clip-path: polygon(0 24px, 24px 0, calc(100% - 20px) 0, 100% 20px, 100% calc(100% - 24px), calc(100% - 24px) 100%, 20px 100%, 0 calc(100% - 20px)); }
.edge-stack { display: grid; gap: var(--gap-control-stack); }
`,
  examples: [
    {
      label: "The glass: header and pane",
      isWide: true,
      markup: html`<div class="cuts"><figure><span class="shape header-cut"></span><figcaption>Header: 20 and 14</figcaption></figure><figure><span class="shape pane-cut"></span><figcaption>Pane: 24 and 20</figcaption></figure></div>`,
    },
    { label: "Alone in a pane: fits its top and its bottom", markup: edgePane(cutButton("Make an account", { type: "button", isFullWidth: true })) },
    { label: "Side by side: slants between, fits the outside", markup: edgePane(html`<div class="control-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>`) },
    {
      label: "Stacked: fits the top and the bottom, square between",
      markup: edgePane(html`<div class="edge-stack">${cutButton("Settings", { type: "button", isFullWidth: true })}${cutButton("Account", { type: "button", isFullWidth: true })}${cutButton("Sign out", { type: "button", isFullWidth: true })}</div>`),
    },
    { label: "On no pane: cut as if it were in one", markup: html`<div class="control-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>` },
  ],
});

