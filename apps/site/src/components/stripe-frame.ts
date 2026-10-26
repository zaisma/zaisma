import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";

export interface StripeFrameOptions {
  id: string;
  /** What it holds, for screen readers: "Card details", "Apple Pay or Google Pay". */
  title: string;
  /** Shown now: the gallery's example. On a page the script shows it once it has a source. */
  isShown?: boolean;
}

/**
 * A zaisma.com frame that holds Stripe's own parts (its card form, Apple Pay and Google Pay, a bank's 3-D Secure check), so Stripe.js
 * loads only in that frame and never on the page around it: a game's page keeps a script-src of its own and nothing else. Hidden until
 * the page's script gives it its source; it tells its height, and covers the window while a bank's check needs the room.
 */
export function stripeFrame(options: StripeFrameOptions): Raw {
  return html`<iframe class="stripe-frame" id="${options.id}" title="${options.title}" allow="payment"${options.isShown ? "" : " hidden"}></iframe>`;
}

component({
  name: "Stripe frame",
  slug: "stripe-frame",
  group: "panes",
  summary: "A zaisma.com frame for Stripe's own parts, its card form, Apple Pay and Google Pay, and a bank's 3-D Secure check, so Stripe.js loads only inside it and never on the page around it. As tall as what Stripe draws in it, and over the whole window while a bank asks the player to confirm.",
  styles: `
/* A Stripe frame: as wide as what holds it and as tall as what Stripe draws, told by the frame (--stripe-frame-height); see-through, so Stripe's parts sit on the glass. */
.stripe-frame { display: block; width: 100%; height: var(--stripe-frame-height, 0px); border: 0; background: transparent; color-scheme: normal; }
/* A bank's check needs the whole window: the frame covers it while the check is open. */
.stripe-frame.is-covering { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 2147483000; }
`,
  render: stripeFrame,
  examples: [{ label: "Before the page gives it its source: nothing to show, and no height", markup: stripeFrame({ id: "example-stripe-frame", title: "Card details", isShown: true }), isStill: true }],
});
