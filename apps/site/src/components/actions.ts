import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { CUT_LINE, icon, type IconName } from "./foundations.ts";

/*
 * Actions, loudest to quietest: the runner button (the one coloured thing you press), the cut button beside it,
 * the glass buttons for the other ways in, and the guest button below them. Each answers the pointer, the press
 * and the keyboard in its own way, so none of them feels dead.
 */

const ARROW = raw('<span class="arrow" aria-hidden="true"><svg viewBox="0 0 12 20" width="9" height="14"><path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.6"/></svg></span>');

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
  /** Pressed and waiting: the arrow drifts, and busyLabel (if any) takes the label's place. */
  isBusy?: boolean;
  busyLabel?: string;
  /** An icon before the label in place of the arrow after it, like Play's. */
  icon?: IconName;
  state?: ButtonState;
}

/** The runner button: a raised orange slab, the same height as the other buttons, lit along its edges. It lifts, leans toward the pointer and catches the light; pressing sinks it into the glass. */
export function runButton(label: string, options: RunButtonOptions = {}): Raw {
  const words = options.busyLabel ? html`<span class="label-idle">${label}</span><span class="label-busy">${options.busyLabel}</span>` : html`<span>${label}</span>`;
  const shell = classes("run-wrap", options.isBig && "is-big", options.isFullWidth && "is-full", options.state);
  return html`${opening(shell, options, options.isBusy)}<span class="${options.isBig ? "face run big" : "face run"} cut-raised" data-cut-line="${options.isBig ? 14 : 12}">${CUT_LINE}${options.icon ? icon(options.icon) : ""}${words}${options.icon ? "" : ARROW}</span>${closing(options)}`;
}

export interface CutButtonOptions extends ButtonTarget {
  icon?: IconName;
  isFullWidth?: boolean;
  isBusy?: boolean;
  state?: ButtonState;
  isBig?: boolean;
}

/** A secondary button: a cut slab of clearer glass with a drawn outline. It brightens under the pointer and gives under a press. A delete is one too, never orange. */
export function cutButton(label: string, options: CutButtonOptions = {}): Raw {
  const className = classes("cut-btn", options.isBig && "big", options.isFullWidth && "is-full", options.state);
  return html`${opening(className, options, options.isBusy)}<span class="face cut-raised" data-cut-line="${options.isBig ? 13 : 10}">${CUT_LINE}${options.icon ? icon(options.icon) : ""}<span>${label}</span></span>${closing(options)}`;
}

const GOOGLE = raw(
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
);
const DISCORD = raw(
  '<svg class="one-colour" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25 19.74 19.74 0 0 0-4.88 1.52C.53 9.050-.32 13.58.1 18.06a19.9 19.9 0 0 0 5.99 3.03c.46-.63.87-1.3 1.23-1.99a13.1 13.1 0 0 1-1.870-.9l.37-.29c3.93 1.79 8.18 1.79 12.06 0l.37.29c-.6.35-1.22.65-1.87.9.36.7.77 1.36 1.22 1.99a19.84 19.84 0 0 0 6-3.03c.5-5.18-.84-9.68-3.55-13.66zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.420 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.420 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/></svg>',
);
const PASSKEY = raw(
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="9" r="4"/><path d="M2 20c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.5"/><circle cx="17.5" cy="13.5" r="2.5"/><path d="M17.5 16v5M17.5 19h2"/></svg>',
);
/** The other ways in, with the marks their owners ask for. A mark that may also be one colour (Discord's) is class one-colour. */
const WAY_ICONS = { google: GOOGLE, discord: DISCORD, passkey: PASSKEY } as const;

/** A glass button's tint: clear glass, or glass tinted the colour of the way in. Each way has its own unless the page picks one. */
export type GlassTint = "clear" | "white" | "blue" | "indigo" | "black";
const WAY_TINTS: Record<keyof typeof WAY_ICONS, GlassTint> = { google: "white", discord: "indigo", passkey: "clear" };

/** A glass button for another way in (a passkey, Google, Discord): a small slab of the panes' glass, with their rim. Quieter than the runner, louder than the guest way. */
export function glassButton(label: string, options: { href?: string; type?: "submit" | "button"; icon: keyof typeof WAY_ICONS; tint?: GlassTint; state?: ButtonState }): Raw {
  const tint = options.tint ?? WAY_TINTS[options.icon];
  const target = { href: options.href, type: options.type ?? "button" } as const;
  return html`${opening(classes("glass-btn", options.state), target, false, html` data-tint="${tint}"`)}<span class="face glass" data-glass data-cut-line="10" data-glass-band="3">${WAY_ICONS[options.icon]}<span>${label}</span></span>${closing(target)}`;
}

const GUEST_ARROW = raw('<span class="arrow" aria-hidden="true"><svg viewBox="0 0 12 20" width="8" height="12"><path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span>');

/** The guest way: words and an arrow under the glass buttons, the quietest way on. Its cut slab shows only when you point at it, press it or tab to it. */
export function guestButton(label: string, options: { href?: string; type?: "submit" | "button"; state?: ButtonState } = {}): Raw {
  return html`${opening(classes("guest-btn", options.state), { href: options.href, type: options.type ?? "button" }, false)}<span class="face" data-cut-line="10">${CUT_LINE}<span>${label}</span>${GUEST_ARROW}</span>${closing({ href: options.href })}`;
}

/**
 * The runner button: it lifts and leans toward the pointer, a reflection slides the other way, and one glint sweeps as
 * the pointer arrives and always finishes. The pointer is followed on the still shell; the lift and lean are set there
 * for its face and its side, which move inside it.
 * The glass buttons: their light follows the pointer across the glass.
 */
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
.run-wrap.over .run .arrow, .run-wrap.is-pointed .run .arrow { transform: translateX(4px); }
.run-wrap.over .run .play, .run-wrap.is-pointed .run .play { transform: translateX(3px) scale(1.08); }
.run-wrap.is-pointed { --lift: -1.5px; }
/* Pressed: it sinks into the glass, a touch darker, its light turned round as on a carved control; it springs back when let go. */
.run-wrap:active > .run, .run-wrap.is-pressed > .run { --lift: 1px; filter: brightness(0.94) saturate(1.05); transition-duration: 0.08s; }
.run-wrap:active > .run > .cut-line, .run-wrap.is-pressed > .run > .cut-line { --band-top: rgba(130,60,0,0.5); --band-left: rgba(150,72,0,0.35); --band-right: rgba(255,226,180,0.45); --band-bottom: rgba(255,240,214,0.7); }
/* Keyboard focus: a clean 2px ink outline hugging the slab, drawn from its own shape. Its glow goes at once, so the outline never draws round a fading blur. */
.run-wrap:focus-visible, .run-wrap.is-focused { filter: drop-shadow(2px 0 0 var(--ink)) drop-shadow(-2px 0 0 var(--ink)) drop-shadow(0 2px 0 var(--ink)) drop-shadow(0 -2px 0 var(--ink)); }
.run-wrap:focus-visible::before, .run-wrap.is-focused::before { opacity: 0; transition: none; }
/* Busy: pressed and waiting. The arrow drifts on; the label says what's happening when the page gave one. */
.run-wrap[aria-busy="true"] { cursor: progress; }
.run-wrap[aria-busy="true"] .label-idle, .run-wrap:not([aria-busy="true"]) .label-busy { display: none; }
.run-wrap[aria-busy="true"] .arrow { animation: run-drift 1.6s ease-in-out infinite; }
@keyframes run-drift { 0%, 100% { transform: translateX(0); opacity: 0.55; } 50% { transform: translateX(7px); opacity: 1; } }
/* On a phone it keeps the other buttons' heights: 44px, and 48px big. */
@media (max-width: 760px) { .run { padding: 0 20px 0 16px; font-size: 15px; } .run.big { height: 48px; font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .run, .run .arrow, .run .play, .run-wrap::before { transition: none; } .run.glint::after, .run-wrap[aria-busy="true"] .arrow { animation: none; } }
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
   a press sinks it, shrinks it a little and shades it from above, quickly, and it springs back when let go.
   The shell (the button) stays still; the slab is its face. */
.cut-btn { flex: none; vertical-align: middle; }
.cut-btn.is-full { display: flex; width: 100%; }
.cut-btn > .face { display: flex; flex: auto; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 24px;
  font: 600 15px var(--display); color: var(--ink); white-space: nowrap;
  --face-colour: var(--btn); background: var(--face-colour); clip-path: var(--cut-shape);
  transition: --face-colour 0.2s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
/* Big keeps the same slant angle as the rest, so it is the same button, larger. */
.cut-btn.big > .face { height: 56px; padding: 0 28px; font-size: 17px; }
.cut-btn:hover > .face, .cut-btn.is-pointed > .face { --face-colour: var(--btn-hover); }
.cut-btn:active > .face, .cut-btn.is-pressed > .face { --face-colour: var(--btn-press); box-shadow: var(--press-shade); transform: translateY(1px) scale(0.965); transition-duration: 0.08s; }
/* A press sinks it into the glass: its light turns round, as on a carved field. */
.cut-btn:active > .face > .cut-line, .cut-btn.is-pressed > .face > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.cut-btn:focus-visible { outline: none; }
.cut-btn:focus-visible > .face, .cut-btn.is-focused > .face { --face-colour: var(--btn-hover); }
.cut-btn:focus-visible .cut-line polygon, .cut-btn.is-focused .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
.cut-btn .face > span, .cut-btn .face > .ico { position: relative; z-index: 2; }
.cut-btn[aria-busy="true"] { cursor: progress; }
.cut-btn[aria-busy="true"] > .face { opacity: 0.7; }
@media (max-width: 760px) { .cut-btn.big > .face { height: 48px; padding: 0 20px; } }
@media (prefers-reduced-motion: reduce) { .cut-btn > .face { transition: --face-colour 0.2s; } }
`,
  render: cutButton,
  examples: [
    ...stateExamples((state) => cutButton("Details", { type: "button", state }), "cut"),
    { label: "Busy", markup: cutButton("Saving", { type: "button", isBusy: true }), isStill: true },
    { label: "With an icon", markup: cutButton("Settings", { type: "button", icon: "gear" }) },
    { label: "Big, beside Play", markup: html`<div style="display:flex;align-items:flex-start;gap:var(--gap-control-control)">${runButton("Play", { type: "button", isBig: true, icon: "play" })}${cutButton("Details", { type: "button", isBig: true })}</div>` },
    { label: "Full width", markup: html`<div style="width:min(380px,100%)">${cutButton("Make an account", { type: "button", isFullWidth: true })}</div>` },
    { label: "A delete", markup: cutButton("Delete this game", { type: "button" }) },
  ],
});

const PICTURE = "display:grid;gap:var(--gap-control-control);width:min(380px,100%);padding:var(--pad-pane);background-position:center;background-size:cover;";
const wayIn = (state?: ButtonState) => glassButton("Sign in with a passkey", { icon: "passkey", state });
const TINT_NAMES: Record<GlassTint, string> = { clear: "Clear", white: "White", blue: "Blue", indigo: "Indigo", black: "Black" };
const tintPalette = () =>
  html`<div class="tint-try" data-tint-try>${glassButton("Continue with Discord", { icon: "discord" })}<div class="tint-palette" role="group" aria-label="Tint">${(Object.keys(TINT_NAMES) as GlassTint[]).map(
    (tint) => html`<button type="button" class="tint-swatch" data-cut-line="6" data-tint-choice="${tint}" aria-label="${TINT_NAMES[tint]}" aria-pressed="${tint === "indigo" ? "true" : "false"}">${CUT_LINE}</button>`,
  )}<span class="tint-name" aria-live="polite">Indigo</span></div></div>`;
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
.glass-btn:active > .face, .glass-btn.is-pressed > .face { --glass-tint: var(--glass-btn-press); box-shadow: var(--press-shade); transform: translateY(1px) scale(0.985); transition-duration: 0.08s; }
.glass-btn:active > .face::before, .glass-btn.is-pressed > .face::before { opacity: 0.45; }
.glass-btn:active .face > svg:not(.edge), .glass-btn.is-pressed .face > svg:not(.edge) { transform: scale(0.94); transition-duration: 0.08s; }
/* Keyboard focus: the rim turns orange, following the cut, and its bright facets step aside. */
.glass-btn:focus-visible > .face, .glass-btn.is-focused > .face { --glass-tint: var(--glass-btn-hover); }
.glass-btn:focus-visible .edge, .glass-btn.is-focused .edge { opacity: 1; }
.glass-btn:focus-visible .edge .hair, .glass-btn.is-focused .edge .hair { stroke: var(--run); stroke-width: 2; }
.glass-btn:focus-visible .edge .rim, .glass-btn.is-focused .edge .rim { stroke: var(--run); stroke-width: 2; opacity: 1; }
.glass-btn:focus-visible .edge .facet, .glass-btn:focus-visible .edge .fringe, .glass-btn.is-focused .edge .facet, .glass-btn.is-focused .edge .fringe { opacity: 0; }
/* A dark tint is a solid slab: no dark hairline, white facets or white top highlight (those read as a glitchy frame), only a
   rim in a lighter shade of its own colour, and a lift shadow that stays in its colour. */
.glass-btn[data-tint="blue"] .edge :is(.hair, .fringe, .facet, .inner, .spec-line, .dense, .rim-band), .glass-btn[data-tint="indigo"] .edge :is(.hair, .fringe, .facet, .inner, .spec-line, .dense, .rim-band), .glass-btn[data-tint="black"] .edge :is(.hair, .fringe, .facet, .inner, .spec-line, .dense, .rim-band) { opacity: 0; }
.glass-btn[data-tint="blue"] .edge .rim, .glass-btn[data-tint="indigo"] .edge .rim, .glass-btn[data-tint="black"] .edge .rim { stroke: color-mix(in srgb, var(--tint-colour) 58%, white); stroke-width: 1.6; opacity: 1; }
.glass-btn[data-tint="black"] .edge .rim { stroke: color-mix(in srgb, var(--tint-colour) 70%, white); }
.glass-btn[data-tint="blue"]:hover > .face, .glass-btn[data-tint="indigo"]:hover > .face, .glass-btn[data-tint="black"]:hover > .face,
.glass-btn[data-tint="blue"].is-pointed > .face, .glass-btn[data-tint="indigo"].is-pointed > .face, .glass-btn[data-tint="black"].is-pointed > .face { box-shadow: inset 0 -12px 18px -12px rgba(0,0,0,0.3); }
.glass-btn[data-tint="blue"]:focus-visible .edge .rim, .glass-btn[data-tint="indigo"]:focus-visible .edge .rim, .glass-btn[data-tint="black"]:focus-visible .edge .rim,
.glass-btn[data-tint="blue"].is-focused .edge .rim, .glass-btn[data-tint="indigo"].is-focused .edge .rim, .glass-btn[data-tint="black"].is-focused .edge .rim { stroke: var(--run); stroke-width: 2; }
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
/* The gallery's tint palette: pick one and the button above takes it (GALLERY_SCRIPT). */
.tint-try { display: grid; gap: var(--gap-block-block); width: min(340px, 100%); }
.tint-palette { display: flex; align-items: center; gap: var(--gap-control-control); font: 500 13px var(--display); color: var(--muted); }
.tint-palette .tint-name { margin-left: var(--gap-words-control); color: var(--ink-2); }
/* A swatch is a control like any other: its shape is the edge rule's, so a row of them slants between each other. Its outline is the cut's own line. */
.tint-swatch { position: relative; width: 32px; height: 32px; padding: 0; border: 0; cursor: pointer; background: var(--swatch); clip-path: var(--cut-shape); }
.tint-swatch .cut-line polygon { stroke: var(--line); stroke-width: 1; transition: stroke 0.2s; }
.tint-swatch:hover .cut-line polygon { stroke: var(--muted); stroke-width: 2; }
.tint-swatch:focus-visible { outline: none; }
.tint-swatch:focus-visible .cut-line polygon { stroke: var(--muted); stroke-width: 3; }
.tint-swatch[aria-pressed="true"] .cut-line polygon { stroke: var(--ink); stroke-width: 3; }
/* Clear: a checker, the usual sign for see-through. */
.tint-swatch[data-tint-choice="clear"] { --swatch: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
.tint-swatch[data-tint-choice="white"] { --swatch: #fff; }
.tint-swatch[data-tint-choice="blue"] { --swatch: #2A75E8; }
.tint-swatch[data-tint-choice="indigo"] { --swatch: #5865F2; }
.tint-swatch[data-tint-choice="black"] { --swatch: #14171C; }
@media (prefers-reduced-motion: reduce) { .glass-btn > .face, .glass-btn .face > svg:not(.edge) { transition: var(--glass-transition); } }
`,
  render: glassButton,
  examples: [
    ...stateExamples(wayIn, "glass", true),
    { label: "Every tint: pick one", markup: tintPalette() },
    { label: "The ways in, each in its own tint", markup: html`<div style="display:grid;gap:var(--gap-control-control);${COLUMN}">${waysIn()}</div>` },
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
.guest-btn:hover > .face, .guest-btn.is-pointed > .face { color: var(--ink); --face-colour: var(--clear-hover); }
.guest-btn:hover .cut-line polygon, .guest-btn.is-pointed .cut-line polygon { stroke: var(--line); }
.guest-btn:hover .arrow, .guest-btn.is-pointed .arrow { transform: translateX(4px); }
.guest-btn:active > .face, .guest-btn.is-pressed > .face { color: var(--ink); --face-colour: var(--clear-press); box-shadow: var(--press-shade); transform: translateY(1px) scale(0.98); transition-duration: 0.08s; }
.guest-btn:active .cut-line polygon, .guest-btn.is-pressed .cut-line polygon { stroke: var(--line); }
.guest-btn:active .arrow, .guest-btn.is-pressed .arrow { transform: translateX(7px); transition-duration: 0.12s; }
.guest-btn:focus-visible > .face, .guest-btn.is-focused > .face { color: var(--ink); }
.guest-btn:focus-visible .cut-line polygon, .guest-btn.is-focused .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
@media (prefers-reduced-motion: reduce) { .guest-btn > .face, .guest-btn .arrow { transition: --face-colour 0.2s, color 0.2s; } }
`,
  render: guestButton,
  examples: [
    ...stateExamples((state) => guestButton("Continue as guest", { state }), "guest", true),
    { label: "Under the ways in", markup: html`<div style="display:grid;gap:var(--gap-control-control);${COLUMN}">${waysIn()}${guestButton("Continue as guest")}</div>` },
  ],
});

// Cut shapes sits with the buttons, so it can show the edge rule on real ones (foundations.ts can't import this file).
const edgePane = (body: Raw) => html`<div class="glass example-pane" data-glass data-glass-corners="18 9 18 9">${body}</div>`;
component({
  name: "Cut shapes",
  slug: "cut-shapes",
  group: "foundations",
  summary: "Corners are cut, never rounded: 16 and 6 on the header, 18 and 9 on panes. Controls follow the edge rule: a slant only beside another control in a row, and every other corner fits what holds it.",
  styles: `
/* Cut shapes: the glass's two cuts, then the edge rule on real buttons. */
.cuts { display: flex; flex-wrap: wrap; gap: var(--gap-block-block); align-items: flex-end; }
.cuts figure { margin: 0; display: grid; gap: var(--gap-words-control); font: 500 13px var(--display); color: var(--muted); }
.cuts .shape { background: var(--ink); opacity: 0.85; }
.cuts .header-cut { width: 260px; height: 68px; clip-path: polygon(0 16px, 16px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 6px 100%, 0 calc(100% - 6px)); }
.cuts .pane-cut { width: 200px; height: 140px; clip-path: polygon(0 18px, 18px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 9px 100%, 0 calc(100% - 9px)); }
.edge-row { display: flex; align-items: flex-start; gap: var(--gap-control-control); }
.edge-stack { display: grid; gap: var(--gap-control-control); }
`,
  examples: [
    {
      label: "The glass: header and pane",
      isWide: true,
      markup: html`<div class="cuts"><figure><span class="shape header-cut"></span><figcaption>Header: 16 and 6</figcaption></figure><figure><span class="shape pane-cut"></span><figcaption>Pane: 18 and 9</figcaption></figure></div>`,
    },
    { label: "Alone in a pane: fits its top and its bottom", markup: edgePane(cutButton("Make an account", { type: "button", isFullWidth: true })) },
    { label: "Side by side: slants between, fits the outside", markup: edgePane(html`<div class="edge-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>`) },
    {
      label: "Stacked: fits the top and the bottom, square between",
      markup: edgePane(html`<div class="edge-stack">${cutButton("Settings", { type: "button", isFullWidth: true })}${cutButton("Account", { type: "button", isFullWidth: true })}${cutButton("Sign out", { type: "button", isFullWidth: true })}</div>`),
    },
    { label: "On no pane: cut as if it were in one", markup: html`<div class="edge-row">${runButton("Play", { type: "button", icon: "play" })}${cutButton("Details", { type: "button" })}</div>` },
  ],
});

