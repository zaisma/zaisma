import { html } from "../markup.ts";
import { component } from "./component.ts";
import { primaryButton, secondaryButton, tertiaryButton, wayButton } from "./actions.ts";
import { settingRow } from "./choices.ts";
import { pinField } from "./fields.ts";
import { slab } from "./materials.ts";
import { header, headerFrame } from "./navigation.ts";

/**
 * Waiting: how anything pressed shows it's waiting on its answer, owned here and nowhere else. A control waiting on this page (aria-busy,
 * set by window.zaismaWait) stays pressed and a glint runs across its pressed face, the Light's glint, one after another so one is always
 * in view; the glass script lays the glint in it only while it waits (glass-script.ts, drawWaiting). A press that opens another page
 * fills the header's bottom groove with orange light instead (HEADER_SCRIPT). Neither changes a control's size, so nothing moves.
 */
component({
  name: "Waiting",
  slug: "waiting",
  group: "panes",
  subgroup: "materials",
  after: "light",
  summary: "What anything pressed shows while it waits on its answer: it stays pressed and a glint runs across its face, one after another, until the answer comes; a press that opens another page fills the header's bottom edge with light instead. It lights at once and never changes the size of what waits, so nothing moves. Every control that can wait takes it from here; none draws its own.",
  styles: `
/* The glint: a stream of the Light's glint, softened (--glint, warm on an orange piece) crossing the pressed face over everything on it, its
   words and marks too, as light on the glass would, cut to the control's own shape. Its glints are spaced closer than the face is wide, so
   a new one comes in as the last leaves, narrow and at one steady pace, one pass in --waiting-glint-time. Under reduced motion one glint
   rests across the middle. */
.waiting-glint { --waiting-glint: color-mix(in srgb, var(--glint) 70%, transparent); position: absolute; inset: 0; z-index: 6; overflow: hidden; pointer-events: none; clip-path: var(--cut-shape, none); container-type: size; }
/* It slides in and out with the glints themselves: as the wait starts, an edge crosses the face from the left at the glints' own pace and
   lets them in behind it, so the first glint leads the others in; as it ends, an edge follows the last glints across, so none come in
   behind and those on the face slide out to the right (is-leaving; the glass script takes it out once they have). */
.waiting-glint { --waiting-glint-crossing: calc(var(--waiting-glint-time) * 100 / 84); -webkit-mask: linear-gradient(90deg, #000 0 47%, transparent 50% 100%) 0 0 / 200% 100% no-repeat; mask: linear-gradient(90deg, #000 0 47%, transparent 50% 100%) 0 0 / 200% 100% no-repeat; animation: waiting-glint-arrives var(--waiting-glint-crossing) linear; }
.waiting-glint.is-leaving { -webkit-mask-image: linear-gradient(90deg, transparent 0 50%, #000 53% 100%); mask-image: linear-gradient(90deg, transparent 0 50%, #000 53% 100%); animation: waiting-glint-leaves var(--waiting-glint-crossing) linear forwards; }
@keyframes waiting-glint-arrives { from { -webkit-mask-position: 100% 0; mask-position: 100% 0; } to { -webkit-mask-position: 0 0; mask-position: 0 0; } }
@keyframes waiting-glint-leaves { from { -webkit-mask-position: 100% 0; mask-position: 100% 0; } to { -webkit-mask-position: 0 0; mask-position: 0 0; } }
.lit > .waiting-glint, .lit .waiting-glint { --waiting-glint: color-mix(in srgb, var(--glint-warm) 55%, transparent); }
/* The stream reaches well past both ends of the face at every point of its loop, so no stretch of the face is ever without its glints, and
   it starts with a glint just behind the edge that lets it in. */
.waiting-glint::before { content: ""; position: absolute; top: -20%; bottom: -20%; left: calc(-138cqw - 40cqh); width: calc(340cqw + 80cqh);
  background: repeating-linear-gradient(90deg, transparent 0, transparent 30cqw, var(--waiting-glint) 42cqw, transparent 54cqw, transparent 84cqw);
  transform: skewX(-18deg); animation: waiting-glints var(--waiting-glint-time) linear infinite; }
@keyframes waiting-glints { from { translate: 0 0; } to { translate: 84cqw 0; } }
/* Glass waiting on a new page (the header, is-waiting from HEADER_SCRIPT): its bottom edge is a groove that fills with orange light, a line
   of light as the Light draws one (4px), starting an eighth full so it shows at once, quickly at first and slower as it goes, never quite
   full, until the page comes. */
@property --waiting-filled { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
.glass-bar::after { content: ""; position: absolute; z-index: 4; inset: auto 0 0 0; height: 4px; opacity: 0; pointer-events: none;
  background: linear-gradient(90deg, var(--run-deep), var(--run) 40%, var(--run-hi) 85%, var(--run-tip) 96%, var(--run-spark)) 0 0 / var(--waiting-filled) 100% no-repeat, var(--track);
  filter: drop-shadow(0 0 2px var(--waiting-glow)) drop-shadow(0 0 6px var(--waiting-glow)); }
.glass-bar.is-waiting::after { animation: waiting-arrives 1ms forwards, waiting-fills var(--waiting-fill-time) cubic-bezier(0.1, 0.7, 0.2, 1) forwards; }
@keyframes waiting-arrives { to { opacity: 1; } }
@keyframes waiting-fills { from { --waiting-filled: 12%; } to { --waiting-filled: 90%; } }
@media (prefers-reduced-motion: reduce) {
  .waiting-glint::before { animation: none; translate: 20cqw 0; }
  .waiting-glint, .waiting-glint.is-leaving { -webkit-mask: none; mask: none; animation: none; }
  .glass-bar.is-waiting::after { --waiting-filled: 100%; animation: waiting-arrives 1ms forwards; }
}
`,
  render: () => primaryButton("Save", { type: "button", isBusy: true }),
  examples: [
    { label: "Try it: press one, and it waits a second and a half on its answer", markup: html`<div data-waiting-example style="display:flex;flex-wrap:wrap;gap:12px">${secondaryButton("Save", { type: "button" })}${primaryButton("Sign in", { type: "button" })}${tertiaryButton("Undo", { type: "button" })}</div>` },
    { label: "The primary button, saying what's happening", markup: primaryButton("Sign in", { type: "button", isBusy: true, busyLabel: "Signing in" }), isStill: true },
    { label: "A secondary button", markup: secondaryButton("Save", { type: "button", isBusy: true }), isStill: true },
    { label: "A small button", markup: tertiaryButton("Undo", { type: "button", isBusy: true }), isStill: true },
    { label: "A way in", markup: html`<div style="width:min(320px,100%)">${wayButton("Sign in with a passkey", "passkey", { isBusy: true })}</div>`, isStill: true },
    { label: "An orange slab: the glint warm", markup: slab({ body: html`Save`, isLit: true, isWaiting: true }), isStill: true },
    { label: "A plain slab", markup: slab({ body: html`Details`, isWaiting: true }), isStill: true },
    { label: "A switch saving", markup: html`<div style="width:min(340px,100%)">${settingRow("Cloud saves", { id: "example-waiting-switch", name: "cloud_saves", isOn: true, isBusy: true })}</div>`, isStill: true },
    { label: "A PIN sent: every mark glints", markup: html`<div aria-busy="true">${pinField({ name: "purchase_pin", label: "Purchase PIN", id: "example-waiting-pin", digits: "246810" })}</div>`, isStill: true },
    { label: "The header on its way to another page: its bottom edge fills with light", isWide: true, markup: headerFrame(header({ id: "example-waiting-header", current: "home", account: null, isOnDeveloperPage: false, isWaiting: true })) },
  ],
});
