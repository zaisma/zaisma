import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";

export interface StripeFrameOptions {
  id: string;
  /** What it holds, for screen readers: "Card details", "Apple Pay or Google Pay". */
  title: string;
}

/**
 * A zaisma.com frame that holds Stripe's own parts (its card form, Apple Pay and Google Pay, a bank's 3-D Secure check), so Stripe.js
 * loads only in that frame and never on the page around it: a game's page keeps a script-src of its own and nothing else. Hidden until
 * the page's script gives it its source; it tells its height, and covers the window while a bank's check needs the room.
 */
export function stripeFrame(options: StripeFrameOptions): Raw {
  return html`<iframe class="stripe-frame" id="${options.id}" title="${options.title}" allow="payment" hidden></iframe>`;
}

component({
  name: "Stripe frame",
  slug: "stripe-frame",
  group: "panes",
  subgroup: "buying",
  summary: "An empty window Stripe draws in: its card form, Apple Pay and Google Pay, and a bank's check that the player is who they say. Stripe.js loads only inside it, never on the page around it. It has nothing of its own to show, so there's no example here: it sits in the Store panel, where the card form and the wallet buttons go, as tall as what Stripe draws, and covers the whole window while a bank asks the player to confirm.",
  styles: `
/* A Stripe frame: as wide as what holds it and as tall as what Stripe draws, told by the frame (--stripe-frame-height); see-through, so Stripe's parts sit on the glass. */
.stripe-frame { display: block; width: 100%; height: var(--stripe-frame-height, 0px); border: 0; background: transparent; color-scheme: normal; }
/* A bank's check needs the whole window: the frame covers it while the check is open. */
.stripe-frame.is-covering { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 2147483000; }
`,
  render: stripeFrame,
  examples: [],
});
