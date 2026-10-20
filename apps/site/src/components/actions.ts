import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";
import { CUT_LINE, icon, type IconName } from "./foundations.ts";

/*
 * Actions: the runner button (the one coloured thing you press), the cut button beside it, the glass
 * buttons for other ways in, and the quiet guest button. From the sign-in and home drafts.
 */

const ARROW = raw('<span class="arrow" aria-hidden="true"><svg viewBox="0 0 12 20" width="9" height="14"><path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.6"/></svg></span>');

/** What a button is: a link when it has an address, otherwise a button of a form. */
interface ButtonTarget {
  href?: string;
  type?: "submit" | "button";
  name?: string;
  buttonValue?: string;
}

/** cutSlantPx gives it the drawn outline GLASS_SCRIPT draws along its slanted ends. */
const opening = (className: string, target: ButtonTarget, isBusy: boolean | undefined, cutSlantPx?: number) => {
  const outline = cutSlantPx ? raw(` data-cut-line="${cutSlantPx}"`) : "";
  return target.href
    ? html`<a class="${className}" href="${target.href}"${outline}${isBusy ? raw(' aria-busy="true"') : ""}>`
    : html`<button class="${className}" type="${target.type ?? "submit"}"${outline}${target.name ? html` name="${target.name}"` : ""}${target.buttonValue !== undefined ? html` value="${target.buttonValue}"` : ""}${isBusy ? raw(' aria-busy="true" disabled') : ""}>`;
};
const closing = (target: ButtonTarget) => raw(target.href ? "</a>" : "</button>");

export interface RunButtonOptions extends ButtonTarget {
  /** The home's Play: 56px, for a pane's one main action. */
  isBig?: boolean;
  isFullWidth?: boolean;
  /** Pressed and waiting: the arrow drifts, and busyLabel (if any) takes the label's place. */
  isBusy?: boolean;
  busyLabel?: string;
  /** An icon before the label in place of the arrow after it, like Play's. */
  icon?: IconName;
  /** The gallery's fixed states, so they sit still side by side: "is-pointed", "is-pressed", "is-focused". */
  state?: "is-pointed" | "is-pressed" | "is-focused";
  /** Its name in a scene that may hold it (scene.ts), for a lead moment on Zaisma's own scenes. */
  sceneAnchor?: string;
}

/** A component a scene may hold: wrapped, so the scene can tilt it and cast its shadow without touching the component itself. */
const anchored = (sceneAnchor: string | undefined, markup: Raw): Raw => (sceneAnchor ? html`<span class="scene-anchor" data-scene-anchor="${sceneAnchor}">${markup}</span>` : markup);

/** The runner button: orange, for the one thing to do. It lifts, leans toward the pointer and catches the light. */
export function runButton(label: string, options: RunButtonOptions = {}): Raw {
  const words = options.busyLabel ? html`<span class="label-idle">${label}</span><span class="label-busy">${options.busyLabel}</span>` : html`<span>${label}</span>`;
  const wrap = ["run-wrap", options.isFullWidth ? "is-full" : "", options.state ?? ""].filter(Boolean).join(" ");
  return anchored(options.sceneAnchor, html`<span class="${wrap}">${opening(options.isBig ? "run big" : "run", options, options.isBusy)}${options.icon ? icon(options.icon) : ""}${words}${options.icon ? "" : ARROW}${closing(options)}</span>`);
}

export interface CutButtonOptions extends ButtonTarget {
  icon?: IconName;
  isFullWidth?: boolean;
  isBusy?: boolean;
  /** Fixed states for the gallery: "is-pointed", "is-pressed", "is-focused". */
  state?: "is-pointed" | "is-pressed" | "is-focused";
  isBig?: boolean;
  /** Its name in a scene that may hold it (scene.ts). */
  sceneAnchor?: string;
}

/** A secondary button: a cut slab of clearer glass with a drawn outline. A delete is one too, never orange. */
export function cutButton(label: string, options: CutButtonOptions = {}): Raw {
  const className = ["cut-btn", options.isBig ? "big" : "", options.isFullWidth ? "is-full" : "", options.state ?? ""].filter(Boolean).join(" ");
  return anchored(options.sceneAnchor, html`${opening(className, options, options.isBusy, 10)}${CUT_LINE}${options.icon ? icon(options.icon) : ""}<span>${label}</span>${closing(options)}`);
}

const GOOGLE = raw(
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
);
const DISCORD = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25 19.74 19.74 0 0 0-4.88 1.52C.53 9.050-.32 13.58.1 18.06a19.9 19.9 0 0 0 5.99 3.03c.46-.63.87-1.3 1.23-1.99a13.1 13.1 0 0 1-1.870-.9l.37-.29c3.93 1.79 8.18 1.79 12.06 0l.37.29c-.6.35-1.22.65-1.87.9.36.7.77 1.36 1.22 1.99a19.84 19.84 0 0 0 6-3.03c.5-5.18-.84-9.68-3.55-13.66zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42 0-1.33.96-2.420 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.420 1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/></svg>',
);
const PASSKEY = raw(
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="9" r="4"/><path d="M2 20c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.5"/><circle cx="17.5" cy="13.5" r="2.5"/><path d="M17.5 16v5M17.5 19h2"/></svg>',
);
/** The other ways in, with the marks their owners ask for. */
const WAY_ICONS = { google: GOOGLE, discord: DISCORD, passkey: PASSKEY } as const;

/** A glass button for another way in (a passkey, Google, Discord): quieter than the runner, louder than the guest way. */
export function glassButton(label: string, options: { href?: string; type?: "submit" | "button"; icon: keyof typeof WAY_ICONS }): Raw {
  return html`${opening("glass-btn", { href: options.href, type: options.type ?? "button" }, false)}${WAY_ICONS[options.icon]}<span>${label}</span>${closing({ href: options.href })}`;
}

/** The guest way: a clear cut button with a drawn outline, the quietest way on. */
export function guestButton(label: string, options: { href?: string; type?: "submit" | "button" } = {}): Raw {
  return html`${opening("guest-btn", { href: options.href, type: options.type ?? "button" }, false, 10)}${CUT_LINE}<span>${label}</span><svg viewBox="0 0 12 20" width="9" height="14" aria-hidden="true"><path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>${closing({ href: options.href })}`;
}

/** The runner button: it lifts and leans toward the pointer, a reflection slides the other way, and one glint sweeps as the pointer arrives and always finishes. */
export const RUNNER_SCRIPT = `/* runner */(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover)").matches) return;
  function lean(button) {
    if (button.dataset.lean) return; button.dataset.lean = "1";
    var wrap = button.parentElement;
    button.addEventListener("pointerenter", function () {
      wrap.classList.add("over"); button.style.setProperty("--lift", "-2px");
      if (!button.classList.contains("glint")) button.classList.add("glint");
    });
    button.addEventListener("animationend", function (event) { if (event.animationName === "run-glint") button.classList.remove("glint"); });
    button.addEventListener("pointerleave", function () { wrap.classList.remove("over"); ["--lift", "--rx", "--ry", "--refl"].forEach(function (p) { button.style.removeProperty(p); }); });
    button.addEventListener("pointermove", function (event) {
      var r = button.getBoundingClientRect(), px = (event.clientX - r.left) / r.width - 0.5, py = (event.clientY - r.top) / r.height - 0.5;
      button.style.setProperty("--ry", (px * 6).toFixed(2) + "deg"); button.style.setProperty("--rx", (-py * 9).toFixed(2) + "deg"); button.style.setProperty("--refl", (50 - px * 70).toFixed(1) + "%");
    });
  }
  document.querySelectorAll(".run").forEach(lean);
  new MutationObserver(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(function (node) { if (node.querySelectorAll) node.querySelectorAll(".run").forEach(lean); }); }); }).observe(document.body, { subtree: true, childList: true });
})();
`;

const RUN_STYLES = `
/* The runner button: the one colored thing you can press. Calm: it lifts, leans toward you and catches the light.
   .over is the pointer on it (RUNNER_SCRIPT); is-pointed, is-pressed and is-focused fix those states for the gallery. */
.run-wrap { display: inline-block; vertical-align: middle; perspective: 600px; filter: drop-shadow(0 3px 0 var(--run-lo)) drop-shadow(0 8px 12px rgba(247,147,26,0.26)); transition: filter 0.6s cubic-bezier(.2,.7,.2,1); }
.run-wrap.is-full { display: block; perspective: 700px; }
.run-wrap.over, .run-wrap.is-pointed { filter: drop-shadow(0 4px 0 var(--run-lo)) drop-shadow(0 14px 18px rgba(247,147,26,0.36)); }
.run-wrap:has(.run:active), .run-wrap.is-pressed { filter: drop-shadow(0 1px 0 var(--run-lo)) drop-shadow(0 4px 8px rgba(247,147,26,0.3)); transition-duration: 0.12s; }
.run {
  --refl: 50%;
  position: relative; overflow: hidden; height: 44px; padding: 0 30px 0 22px;
  display: flex; align-items: center; gap: 10px; text-decoration: none; white-space: nowrap;
  border: 0; cursor: pointer; color: #fff; text-shadow: 0 1px 1px rgba(120,58,0,0.45);
  font: 600 16px var(--display); letter-spacing: 0.01em;
  background: linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.08) 47%, rgba(255,255,255,0) 48%), linear-gradient(180deg, var(--run-hi), var(--run) 60%, #DE7A0C);
  clip-path: polygon(12px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%);
  transform: translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.6s cubic-bezier(.2,.7,.2,1), --refl 0.6s cubic-bezier(.2,.7,.2,1);
}
.is-full > .run { width: 100%; justify-content: center; }
.run.big { height: 56px; justify-content: center; padding: 0 34px 0 24px; font-size: 19px; gap: 12px; clip-path: polygon(14px 0, calc(100% - 20px) 0, 100% 50%, calc(100% - 20px) 100%, 0 100%); }
/* The reflection of a fixed light: a soft band that slides the opposite way to the pointer. */
.run::before { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, rgba(255,255,255,0) calc(var(--refl) - 22%), rgba(255,255,255,0.2) var(--refl), rgba(255,255,255,0) calc(var(--refl) + 22%)); opacity: 0; transition: opacity 0.6s; }
.run-wrap.over .run::before, .run-wrap.is-pointed .run::before { opacity: 1; }
/* The glint: one sweep as the pointer arrives, always finished. */
.run::after { content: ""; position: absolute; top: -20%; bottom: -20%; width: 36%; left: -50%; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0)); transform: skewX(-20deg); pointer-events: none; }
.run.glint::after { animation: run-glint 0.45s cubic-bezier(.3,.1,.3,1) both; }
@keyframes run-glint { from { left: -50%; } to { left: 120%; } }
.run > * { position: relative; }
.run .arrow, .run .play { display: inline-flex; transition: transform 0.6s cubic-bezier(.2,.7,.2,1); }
.run-wrap.over .run .arrow, .run-wrap.is-pointed .run .arrow { transform: translateX(4px); }
.run-wrap.over .run .play, .run-wrap.is-pointed .run .play { transform: translateX(3px) scale(1.08); }
.is-pointed > .run { --lift: -2px; }
.run:active, .is-pressed > .run { --lift: 2px; transition-duration: 0.12s; }
.run:focus-visible { outline: none; }
.run-wrap:focus-within, .run-wrap.is-focused { filter: drop-shadow(0 3px 0 var(--run-lo)) drop-shadow(0 0 1px #fff) drop-shadow(0 0 6px rgba(20,23,28,0.6)); }
/* Busy: pressed and waiting. The arrow drifts on; the label says what's happening when the page gave one. */
.run[aria-busy="true"] { cursor: progress; }
.run[aria-busy="true"] .label-idle, .run:not([aria-busy="true"]) .label-busy { display: none; }
.run[aria-busy="true"] .arrow { animation: run-drift 1.6s ease-in-out infinite; }
@keyframes run-drift { 0%, 100% { transform: translateX(0); opacity: 0.55; } 50% { transform: translateX(7px); opacity: 1; } }
@media (max-width: 760px) { .run { height: 40px; padding: 0 24px 0 16px; font-size: 15px; } .run.big { height: 48px; font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .run, .run .arrow, .run .play { transition: none; } .run.glint::after, .run[aria-busy="true"] .arrow { animation: none; } }
`;

/**
 * A button's states, still, side by side; then one to try, and one that points, presses and lets go on a loop
 * (the gallery's design-loops script plays it: data-state-loop names what it plays).
 */
const stateExamples = (render: (state?: "is-pointed" | "is-pressed" | "is-focused") => Raw, loopKind: "runner" | "cut") => [
  { label: "Rest", markup: render(), isStill: true },
  { label: "Pointed", markup: render("is-pointed"), isStill: true },
  { label: "Pressed", markup: render("is-pressed"), isStill: true },
  { label: "Keyboard focus", markup: render("is-focused"), isStill: true },
  { label: "Try it", markup: render() },
  { label: "On a loop", markup: html`<span data-state-loop="${loopKind}">${render()}</span>`, isStill: true },
];

component({
  name: "Runner button",
  slug: "runner-button",
  group: "actions",
  summary: "The one thing to do on a screen: Play, Sign in, Next. Never more than one in view, and visible without scrolling.",
  styles: RUN_STYLES,
  render: runButton,
  hasSceneMode: true,
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
/* A secondary button: a cut slab of clearer glass with a drawn outline. */
.cut-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; height: 44px; padding: 0 24px;
  font: 600 15px var(--display); color: var(--ink); text-decoration: none; white-space: nowrap; border: 0; cursor: pointer;
  background: var(--btn); clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); transition: background 0.2s; }
.cut-btn.is-full { display: flex; width: 100%; }
.cut-btn.big { height: 56px; padding: 0 28px; font-size: 17px; }
.cut-btn:hover, .cut-btn.is-pointed { background: var(--btn-hover); }
.cut-btn:hover .cut-line polygon, .cut-btn.is-pointed .cut-line polygon { stroke: var(--muted); }
.cut-btn:active, .cut-btn.is-pressed { background: var(--btn); }
.cut-btn:focus-visible, .cut-btn.is-focused { outline: none; background: var(--btn-hover); }
.cut-btn:focus-visible .cut-line polygon, .cut-btn.is-focused .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
.cut-btn > span, .cut-btn > .ico { position: relative; z-index: 2; }
.cut-btn[aria-busy="true"] { cursor: progress; opacity: 0.7; }
@media (max-width: 760px) { .cut-btn.big { height: 48px; padding: 0 20px; } }
`,
  render: cutButton,
  hasSceneMode: true,
  examples: [
    ...stateExamples((state) => cutButton("Details", { type: "button", state }), "cut"),
    { label: "Busy", markup: cutButton("Saving", { type: "button", isBusy: true }), isStill: true },
    { label: "With an icon", markup: cutButton("Settings", { type: "button", icon: "gear" }) },
    { label: "Big, beside Play", markup: html`<div style="display:flex;gap:12px">${runButton("Play", { type: "button", isBig: true, icon: "play" })}${cutButton("Details", { type: "button", isBig: true })}</div>` },
    { label: "Full width", markup: html`<div style="width:min(380px,100%)">${cutButton("Make an account", { type: "button", isFullWidth: true })}</div>` },
    { label: "A delete", markup: cutButton("Delete this game", { type: "button" }) },
  ],
});

component({
  name: "Glass button",
  slug: "glass-button",
  group: "actions",
  summary: "Another way in, like a passkey, Google or Discord: below the runner, never instead of it.",
  styles: `
/* Glass buttons for the other ways in */
.glass-btn {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
  height: 48px; padding: 0 16px;
  border: 1px solid var(--glass-btn-edge);
  background: var(--glass-btn);
  box-shadow: var(--glass-btn-shade);
  font: 500 15px var(--display); color: var(--ink);
  text-decoration: none; cursor: pointer;
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  transition: transform 0.3s, box-shadow 0.3s;
}
.glass-btn > * { position: relative; }
.glass-btn svg { width: 20px; height: 20px; flex: none; }
.glass-btn:hover, .glass-btn.is-pointed { transform: translateY(-1px); box-shadow: var(--glass-btn-lift); color: var(--ink); }
.glass-btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .glass-btn { transition: none; } }
`,
  render: glassButton,
  examples: [
    {
      label: "Try it",
      markup: html`<div style="display:grid;gap:10px;width:min(380px,100%)">${glassButton("Sign in with a passkey", { icon: "passkey" })}${glassButton("Continue with Google", { icon: "google" })}${glassButton("Continue with Discord", { icon: "discord" })}</div>`,
    },
    { label: "On a loop", markup: html`<div style="width:min(380px,100%)" data-state-loop="glass">${glassButton("Continue with Google", { icon: "google" })}</div>`, isStill: true },
  ],
});

component({
  name: "Guest button",
  slug: "guest-button",
  group: "actions",
  summary: "The quietest way on, like Continue as guest: an outline and nothing else.",
  styles: `
/* The guest way: a clear cut button with a drawn outline, quieter than the ways to sign in. */
.guest-btn { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; height: 48px; width: 100%; border: 0; cursor: pointer;
  font: 600 15px var(--display); color: var(--ink); text-decoration: none; background: transparent;
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); transition: background 0.2s; }
.guest-btn > :not(.cut-line) { position: relative; z-index: 2; }
.guest-btn svg:not(.cut-line) { transition: transform 0.3s cubic-bezier(.2,.7,.2,1); }
.guest-btn .cut-line { z-index: 4; }
.guest-btn .cut-line polygon { stroke: var(--outline); }
.guest-btn:hover, .guest-btn.is-pointed { color: var(--ink); background: var(--clear-hover); }
.guest-btn:hover svg:not(.cut-line), .guest-btn.is-pointed svg:not(.cut-line) { transform: translateX(3px); }
.guest-btn:focus-visible { outline: none; background: var(--clear-hover); }
.guest-btn:focus-visible .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
`,
  render: guestButton,
  examples: [
    { label: "Try it", markup: html`<div style="width:min(380px,100%)">${guestButton("Continue as guest")}</div>` },
    { label: "On a loop", markup: html`<div style="width:min(380px,100%)" data-state-loop="guest">${guestButton("Continue as guest")}</div>`, isStill: true },
  ],
});
