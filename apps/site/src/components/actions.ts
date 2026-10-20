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

/** cutSlantPx gives it the drawn outline GLASS_SCRIPT draws along its slanted ends; extra adds attributes of its own. */
const opening = (className: string, target: ButtonTarget, isBusy: boolean | undefined, cutSlantPx?: number, extra: Raw | "" = "") => {
  const outline = cutSlantPx ? raw(` data-cut-line="${cutSlantPx}"`) : "";
  return target.href
    ? html`<a class="${className}" href="${target.href}"${outline}${extra}${isBusy ? raw(' aria-busy="true"') : ""}>`
    : html`<button class="${className}" type="${target.type ?? "submit"}"${outline}${extra}${target.name ? html` name="${target.name}"` : ""}${target.buttonValue !== undefined ? html` value="${target.buttonValue}"` : ""}${isBusy ? raw(' aria-busy="true" disabled') : ""}>`;
};
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
  /** Its name in a scene that may hold it (scene.ts), for a lead moment on Zaisma's own scenes. */
  sceneAnchor?: string;
}

/** A component a scene may hold: wrapped, so the scene can tilt it and cast its shadow without touching the component itself. */
const anchored = (sceneAnchor: string | undefined, markup: Raw): Raw => (sceneAnchor ? html`<span class="scene-anchor" data-scene-anchor="${sceneAnchor}">${markup}</span>` : markup);

/** The runner button: an orange slab with a side you can see. It lifts, leans toward the pointer and catches the light; pressing pushes its face down onto its side. */
export function runButton(label: string, options: RunButtonOptions = {}): Raw {
  const words = options.busyLabel ? html`<span class="label-idle">${label}</span><span class="label-busy">${options.busyLabel}</span>` : html`<span>${label}</span>`;
  const wrap = classes("run-wrap", options.isBig && "is-big", options.isFullWidth && "is-full", options.state);
  return anchored(options.sceneAnchor, html`<span class="${wrap}"><span class="run-side" aria-hidden="true"></span>${opening(options.isBig ? "run big" : "run", options, options.isBusy)}${options.icon ? icon(options.icon) : ""}${words}${options.icon ? "" : ARROW}${closing(options)}</span>`);
}

export interface CutButtonOptions extends ButtonTarget {
  icon?: IconName;
  isFullWidth?: boolean;
  isBusy?: boolean;
  state?: ButtonState;
  isBig?: boolean;
  /** Its name in a scene that may hold it (scene.ts). */
  sceneAnchor?: string;
}

/** A secondary button: a cut slab of clearer glass with a drawn outline. It brightens under the pointer and gives under a press. A delete is one too, never orange. */
export function cutButton(label: string, options: CutButtonOptions = {}): Raw {
  const className = classes("cut-btn", options.isBig && "big", options.isFullWidth && "is-full", options.state);
  return anchored(options.sceneAnchor, html`${opening(className, options, options.isBusy, 10)}${CUT_LINE}${options.icon ? icon(options.icon) : ""}<span>${label}</span>${closing(options)}`);
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
export type GlassTint = "clear" | "white" | "blue" | "indigo";
const WAY_TINTS: Record<keyof typeof WAY_ICONS, GlassTint> = { google: "white", discord: "indigo", passkey: "clear" };

/** A glass button for another way in (a passkey, Google, Discord): a small slab of the panes' glass, with their rim. Quieter than the runner, louder than the guest way. */
export function glassButton(label: string, options: { href?: string; type?: "submit" | "button"; icon: keyof typeof WAY_ICONS; tint?: GlassTint; state?: ButtonState }): Raw {
  const tint = options.tint ?? WAY_TINTS[options.icon];
  const extra = raw(` data-glass data-glass-corners="12 4 12 4"${tint === "clear" ? "" : ` data-tint="${tint}"`}`);
  return html`${opening(classes("glass-btn", options.state), { href: options.href, type: options.type ?? "button" }, false, undefined, extra)}${WAY_ICONS[options.icon]}<span>${label}</span>${closing({ href: options.href })}`;
}

const GUEST_ARROW = raw('<span class="arrow" aria-hidden="true"><svg viewBox="0 0 12 20" width="8" height="12"><path d="M2 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span>');

/** The guest way: words and an arrow under the glass buttons, the quietest way on. Its cut slab shows only when you point at it, press it or tab to it. */
export function guestButton(label: string, options: { href?: string; type?: "submit" | "button"; state?: ButtonState } = {}): Raw {
  return html`${opening(classes("guest-btn", options.state), { href: options.href, type: options.type ?? "button" }, false, 10)}${CUT_LINE}<span>${label}</span>${GUEST_ARROW}${closing({ href: options.href })}`;
}

/**
 * The runner button: it lifts and leans toward the pointer, a reflection slides the other way, and one glint sweeps as
 * the pointer arrives and always finishes. The lift and lean are set on its wrap, so its face and its side move together.
 * The glass buttons: their light follows the pointer across the glass.
 */
export const RUNNER_SCRIPT = `/* runner */(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover)").matches) return;
  function lean(button) {
    if (button.dataset.lean) return; button.dataset.lean = "1";
    var wrap = button.parentElement;
    button.addEventListener("pointerenter", function () {
      wrap.classList.add("over"); wrap.style.setProperty("--lift", "-1.5px");
      if (!button.classList.contains("glint")) button.classList.add("glint");
    });
    button.addEventListener("animationend", function (event) { if (event.animationName === "run-glint") button.classList.remove("glint"); });
    button.addEventListener("pointerleave", function () { wrap.classList.remove("over"); ["--lift", "--rx", "--ry"].forEach(function (p) { wrap.style.removeProperty(p); }); button.style.removeProperty("--refl"); });
    button.addEventListener("pointermove", function (event) {
      var r = button.getBoundingClientRect(), px = (event.clientX - r.left) / r.width - 0.5, py = (event.clientY - r.top) / r.height - 0.5;
      wrap.style.setProperty("--ry", (px * 6).toFixed(2) + "deg"); wrap.style.setProperty("--rx", (-py * 9).toFixed(2) + "deg"); button.style.setProperty("--refl", (50 - px * 70).toFixed(1) + "%");
    });
  }
  document.querySelectorAll(".run").forEach(lean);
  new MutationObserver(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(function (node) { if (node.querySelectorAll) node.querySelectorAll(".run").forEach(lean); }); }); }).observe(document.body, { subtree: true, childList: true });
  document.addEventListener("pointermove", function (event) {
    var button = event.target.closest && event.target.closest(".glass-btn"); if (!button) return;
    var r = button.getBoundingClientRect();
    button.style.setProperty("--mx", (event.clientX - r.left).toFixed(0) + "px"); button.style.setProperty("--my", (event.clientY - r.top).toFixed(0) + "px");
  }, { passive: true });
})();
`;

const SPRING = "cubic-bezier(.25,.9,.3,1.25)";

const RUN_STYLES = `
/* The runner button: the one colored thing you can press. A slab: its face, and below it its side, the slab's thickness.
   It lifts, leans toward you and catches the light; a press pushes the face down onto its side, and it springs back.
   .over is the pointer on it (RUNNER_SCRIPT); is-pointed, is-pressed and is-focused fix those states for the gallery. */
.run-wrap {
  --run-shape: polygon(12px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 0 100%);
  /* The keyboard's ring: 2px of ink, 2px off the slab, following its slant and its point (evenodd cuts the middle out). */
  --run-ring: polygon(evenodd, 14.9px 2px, calc(100% - 20px) 2px, calc(100% - 1px) 50%, calc(100% - 20px) calc(100% - 2px), 0.8px calc(100% - 2px), 14.9px 2px,
    16.5px 4px, 3.4px calc(100% - 4px), calc(100% - 21px) calc(100% - 4px), calc(100% - 3.5px) 50%, calc(100% - 21px) 4px, 16.5px 4px);
  --depth: 4px;
  position: relative; isolation: isolate; display: inline-block; vertical-align: middle; perspective: 600px; margin-bottom: var(--depth);
}
.run-wrap.is-full { display: block; perspective: 700px; }
.run-wrap.is-big {
  --run-shape: polygon(14px 0, calc(100% - 20px) 0, 100% 50%, calc(100% - 20px) 100%, 0 100%);
  --run-ring: polygon(evenodd, 16.9px 2px, calc(100% - 23.9px) 2px, calc(100% - 1.1px) 50%, calc(100% - 23.9px) calc(100% - 2px), 0.9px calc(100% - 2px), 16.9px 2px,
    18.4px 4px, 3.4px calc(100% - 4px), calc(100% - 25px) calc(100% - 4px), calc(100% - 3.5px) 50%, calc(100% - 25px) 4px, 18.4px 4px);
  --depth: 5px;
}
/* Its warm glow on what's under it: it spreads as the slab lifts and gathers in as it's pressed. */
.run-wrap::before { content: ""; position: absolute; z-index: -1; left: 8%; right: 8%; top: 35%; bottom: -10px; border-radius: 50%; pointer-events: none;
  background: rgba(247,147,26,0.34); filter: blur(11px); opacity: 0.75; transition: opacity 0.5s, transform 0.5s cubic-bezier(.2,.7,.2,1); }
.run-wrap.over::before, .run-wrap.is-pointed::before { opacity: 1; transform: translateY(3px) scaleX(1.05); }
.run-wrap:has(.run:active)::before, .run-wrap.is-pressed::before { opacity: 0.5; transform: translateY(-2px) scaleX(0.94); transition-duration: 0.1s; }
/* Its side: the slab's thickness, a darker band of the same shape just below the face, lit from above. */
.run-side { position: absolute; inset: 0; pointer-events: none; clip-path: var(--run-shape);
  background: linear-gradient(180deg, #D27412, var(--run-lo) 85%);
  transform: translateY(var(--depth)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform 0.6s cubic-bezier(.2,.7,.2,1); }
.run {
  --refl: 50%;
  position: relative; z-index: 1; overflow: hidden; height: 44px; padding: 0 30px 0 22px;
  display: flex; align-items: center; gap: 10px; text-decoration: none; white-space: nowrap;
  border: 0; cursor: pointer; color: #fff; text-shadow: 0 1px 1px rgba(120,58,0,0.4);
  font: 600 16px var(--display); letter-spacing: 0.01em;
  /* The face: lit from above, rounding off toward its lower edge, with a bright top edge where the light lands. */
  background: radial-gradient(130% 110% at 50% -35%, rgba(255,255,255,0.36), rgba(255,255,255,0) 62%), linear-gradient(180deg, var(--run-hi), var(--run) 55%, #EA830E);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(150,72,0,0.3);
  clip-path: var(--run-shape);
  transform: translateY(var(--lift, 0px)) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.45s ${SPRING}, --refl 0.6s cubic-bezier(.2,.7,.2,1), filter 0.2s;
}
.is-full > .run { width: 100%; justify-content: center; }
.run.big { height: 56px; justify-content: center; padding: 0 34px 0 24px; font-size: 19px; gap: 12px; }
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
.run-wrap.is-pointed { --lift: -1.5px; }
/* Pressed: the face goes down onto its side, a touch darker, quickly; it springs back when let go. */
.run:active, .run-wrap.is-pressed > .run { --lift: calc(var(--depth) - 1px); filter: brightness(0.95) saturate(1.05); transition-duration: 0.08s; }
/* Keyboard focus: the ring, around the face and its side. */
.run:focus-visible { outline: none; }
.run-wrap::after { content: ""; position: absolute; z-index: 2; inset: -6px -6px calc(-6px - var(--depth)); pointer-events: none; background: var(--ink); clip-path: var(--run-ring); opacity: 0; transition: opacity 0.15s; }
.run-wrap:has(.run:focus-visible)::after, .run-wrap.is-focused::after { opacity: 1; }
/* Busy: pressed and waiting. The arrow drifts on; the label says what's happening when the page gave one. */
.run[aria-busy="true"] { cursor: progress; }
.run[aria-busy="true"] .label-idle, .run:not([aria-busy="true"]) .label-busy { display: none; }
.run[aria-busy="true"] .arrow { animation: run-drift 1.6s ease-in-out infinite; }
@keyframes run-drift { 0%, 100% { transform: translateX(0); opacity: 0.55; } 50% { transform: translateX(7px); opacity: 1; } }
@media (max-width: 760px) { .run { height: 40px; padding: 0 24px 0 16px; font-size: 15px; } .run.big { height: 48px; font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .run, .run-side, .run .arrow, .run .play, .run-wrap::before { transition: none; } .run.glint::after, .run[aria-busy="true"] .arrow { animation: none; } }
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
/* A secondary button: a cut slab of clearer glass with a drawn outline. It brightens under the pointer;
   a press sinks it, shrinks it a little and shades it from above, quickly, and it springs back when let go. */
.cut-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; height: 44px; padding: 0 24px;
  font: 600 15px var(--display); color: var(--ink); text-decoration: none; white-space: nowrap; border: 0; cursor: pointer;
  background: var(--btn); clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  transition: background-color 0.2s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
.cut-btn.is-full { display: flex; width: 100%; }
.cut-btn.big { height: 56px; padding: 0 28px; font-size: 17px; }
.cut-btn:hover, .cut-btn.is-pointed { background: var(--btn-hover); }
.cut-btn:hover .cut-line polygon, .cut-btn.is-pointed .cut-line polygon { stroke: var(--muted); }
.cut-btn:active, .cut-btn.is-pressed { background: var(--btn-press); box-shadow: var(--press-shade); transform: translateY(1px) scale(0.965); transition-duration: 0.08s; }
.cut-btn:active .cut-line polygon, .cut-btn.is-pressed .cut-line polygon { stroke: var(--ink-2); transition-duration: 0.08s; }
.cut-btn:focus-visible, .cut-btn.is-focused { outline: none; background: var(--btn-hover); }
.cut-btn:focus-visible .cut-line polygon, .cut-btn.is-focused .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
.cut-btn > span, .cut-btn > .ico { position: relative; z-index: 2; }
.cut-btn[aria-busy="true"] { cursor: progress; opacity: 0.7; }
@media (max-width: 760px) { .cut-btn.big { height: 48px; padding: 0 20px; } }
@media (prefers-reduced-motion: reduce) { .cut-btn { transition: background-color 0.2s; } }
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

const PICTURE = "display:grid;gap:10px;width:min(380px,100%);padding:20px;background-position:center;background-size:cover;";
const wayIn = (state?: ButtonState) => glassButton("Sign in with a passkey", { icon: "passkey", state });
const TINT_NAMES: Record<GlassTint, string> = { clear: "Clear", white: "White, like Google's", blue: "Blue", indigo: "Indigo, like Discord's" };
const waysIn = () => html`${glassButton("Sign in with a passkey", { icon: "passkey" })}${glassButton("Continue with Google", { icon: "google" })}${glassButton("Continue with Discord", { icon: "discord" })}`;

component({
  name: "Glass button",
  slug: "glass-button",
  group: "actions",
  summary: "Another way in, like a passkey, Google or Discord: below the runner, never instead of it.",
  styles: `
/* Glass buttons for the other ways in: a small slab of the panes' glass, cut and rimmed like them (GLASS_SCRIPT draws the rim).
   The pointer brings a light that follows it across the glass and brightens the rim; a press sinks the slab into its shade. */
.glass-btn { --mx: 38%; --my: 18%;
  position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 48px; padding: 0 18px;
  border: 0; cursor: pointer; font: 500 15px var(--display); color: var(--ink); text-decoration: none; white-space: nowrap;
  background-color: var(--glass-btn-face); background-image: var(--glass-sheen);
  -webkit-backdrop-filter: blur(18px) saturate(1.8); backdrop-filter: blur(18px) saturate(1.8);
  clip-path: polygon(0 12px, 12px 0, calc(100% - 4px) 0, 100% 4px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 4px 100%, 0 calc(100% - 4px));
  transition: background-color 0.25s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
.glass-btn > :not(.edge) { position: relative; z-index: 3; }
.glass-btn > svg:not(.edge) { width: 20px; height: 20px; flex: none; transition: transform 0.4s ${SPRING}; }
.glass-btn .edge { opacity: 0.7; transition: opacity 0.3s; }
/* The light the pointer brings. */
.glass-btn::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0; transition: opacity 0.3s;
  background: radial-gradient(150px 110px at var(--mx) var(--my), var(--glass-btn-glow), rgba(255,255,255,0) 70%); }
.glass-btn:hover, .glass-btn.is-pointed { background-color: var(--glass-btn-hover); box-shadow: var(--glass-btn-lift); transform: translateY(-1px); }
.glass-btn:hover .edge .hair, .glass-btn.is-pointed .edge .hair { stroke: var(--glass-btn-hair); }
.glass-btn:hover::before, .glass-btn.is-pointed::before { opacity: 0.85; }
.glass-btn:hover .edge, .glass-btn.is-pointed .edge { opacity: 1; }
.glass-btn:hover > svg:not(.edge), .glass-btn.is-pointed > svg:not(.edge) { transform: scale(1.1); }
.glass-btn:active, .glass-btn.is-pressed { background-color: var(--glass-btn-press); box-shadow: var(--press-shade); transform: translateY(1px) scale(0.985); transition-duration: 0.08s; }
.glass-btn:active::before, .glass-btn.is-pressed::before { opacity: 0.45; }
.glass-btn:active > svg:not(.edge), .glass-btn.is-pressed > svg:not(.edge) { transform: scale(0.94); transition-duration: 0.08s; }
/* Keyboard focus: the rim turns to ink, following the cut, and its bright facets step aside. */
.glass-btn:focus-visible, .glass-btn.is-focused { outline: none; background-color: var(--glass-btn-hover); }
.glass-btn:focus-visible .edge, .glass-btn.is-focused .edge { opacity: 1; }
.glass-btn:focus-visible .edge .hair, .glass-btn.is-focused .edge .hair { stroke: var(--ink); stroke-width: 2; }
.glass-btn:focus-visible .edge .rim, .glass-btn.is-focused .edge .rim { stroke: var(--ink); stroke-width: 2; }
.glass-btn:focus-visible .edge .facet, .glass-btn:focus-visible .edge .fringe, .glass-btn.is-focused .edge .facet, .glass-btn.is-focused .edge .fringe { opacity: 0; }
/* Tinted: the way's colour laid into the glass, stronger as you point at it. White glass keeps dark words in either theme. */
.glass-btn[data-tint] { --tint-alpha: var(--glass-btn-tint-rest); background-image: linear-gradient(rgba(var(--tint), var(--tint-alpha)), rgba(var(--tint), var(--tint-alpha))), var(--glass-sheen);
  transition: background-color 0.25s, box-shadow 0.2s, transform 0.4s ${SPRING}, --tint-alpha 0.25s; }
.glass-btn[data-tint]:hover, .glass-btn[data-tint].is-pointed, .glass-btn[data-tint]:focus-visible, .glass-btn[data-tint].is-focused { --tint-alpha: var(--glass-btn-tint-hover); }
.glass-btn[data-tint]:active, .glass-btn[data-tint].is-pressed { --tint-alpha: var(--glass-btn-tint-press); }
.glass-btn[data-tint="blue"] { --tint: 42, 117, 232; }
.glass-btn[data-tint="indigo"] { --tint: 88, 101, 242; }
.glass-btn[data-tint="white"] { --tint: 255, 255, 255; --glass-btn-tint-rest: 0.86; --glass-btn-tint-hover: 0.97; --glass-btn-tint-press: 0.74; color: #14171C; }
/* On a blue or indigo tint a coloured mark would sink into it, so a mark that may be one colour takes the words' colour:
   dark on light glass, white on smoked. Google's G stays in its colours, which only ever sit on white or clear glass. */
.glass-btn[data-tint="blue"] .one-colour path, .glass-btn[data-tint="indigo"] .one-colour path { fill: currentColor; }
@media (prefers-reduced-motion: reduce) { .glass-btn, .glass-btn > svg:not(.edge) { transition: background-color 0.25s; } }
`,
  render: glassButton,
  examples: [
    ...stateExamples(wayIn, "glass", true),
    ...(Object.keys(TINT_NAMES) as GlassTint[]).map((tint) => ({ label: TINT_NAMES[tint], markup: html`<div style="${COLUMN}">${glassButton("Sign in with a passkey", { icon: "passkey", tint })}</div>` })),
    { label: "The ways in, each in its own tint", markup: html`<div style="display:grid;gap:10px;${COLUMN}">${waysIn()}</div>` },
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
   outline and sends the arrow on; a press sinks it; the keyboard's focus draws the outline in ink. */
.guest-btn { position: relative; display: flex; align-items: center; justify-content: center; gap: 8px; height: 44px; width: 100%; padding: 0 16px; border: 0; cursor: pointer;
  font: 500 15px var(--display); color: var(--ink-2); text-decoration: none; white-space: nowrap; background-color: transparent;
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  transition: background-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.4s ${SPRING}; }
.guest-btn > :not(.cut-line) { position: relative; z-index: 2; }
.guest-btn .cut-line polygon { stroke: transparent; }
.guest-btn .arrow { display: inline-flex; transition: transform 0.45s cubic-bezier(.2,.7,.2,1); }
.guest-btn:hover, .guest-btn.is-pointed { color: var(--ink); background-color: var(--clear-hover); }
.guest-btn:hover .cut-line polygon, .guest-btn.is-pointed .cut-line polygon { stroke: var(--line); }
.guest-btn:hover .arrow, .guest-btn.is-pointed .arrow { transform: translateX(4px); }
.guest-btn:active, .guest-btn.is-pressed { color: var(--ink); background-color: var(--clear-press); box-shadow: var(--press-shade); transform: translateY(1px) scale(0.98); transition-duration: 0.08s; }
.guest-btn:active .cut-line polygon, .guest-btn.is-pressed .cut-line polygon { stroke: var(--line); }
.guest-btn:active .arrow, .guest-btn.is-pressed .arrow { transform: translateX(7px); transition-duration: 0.12s; }
.guest-btn:focus-visible, .guest-btn.is-focused { outline: none; color: var(--ink); }
.guest-btn:focus-visible .cut-line polygon, .guest-btn.is-focused .cut-line polygon { stroke: var(--ink); stroke-width: 2; }
@media (prefers-reduced-motion: reduce) { .guest-btn, .guest-btn .arrow { transition: background-color 0.2s, color 0.2s; } }
`,
  render: guestButton,
  examples: [
    ...stateExamples((state) => guestButton("Continue as guest", { state }), "guest", true),
    { label: "Under the ways in", markup: html`<div style="display:grid;gap:10px;${COLUMN}">${waysIn()}${guestButton("Continue as guest")}</div>` },
  ],
});
