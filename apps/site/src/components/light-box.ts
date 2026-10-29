import { html, type Raw } from "../markup.ts";
import { tertiaryButton } from "./actions.ts";

/*
 * The light box's markup, in a file of its own so inputs.ts (a file drop's pictures) can use it without importing panes.ts, which imports
 * inputs.ts. Its styles and gallery entry are panes.ts's Light box.
 */

export interface LightBoxOptions {
  /** Unique on the page: the button that opens it names it (aria-controls). */
  id: string;
  /** What it shows, for a screen reader: "QR code for Ashen Crown". */
  label: string;
  /** The one thing it shows large (a QR code), and its words under it. */
  body: Raw;
  /** What its close button says to a screen reader: "Close". */
  closeLabel: string;
}

/**
 * A light box: one thing shown large in the middle of a dimmed screen (a QR code to hold up to a friend), with nothing round it. It opens on
 * top of what opened it, as that sheet's second layer, and a press anywhere, Close or Esc lands back on it.
 */
export function lightBox(options: LightBoxOptions): Raw {
  return html`<dialog class="sheet light-box" id="${options.id}" aria-label="${options.label}"><form class="light-box-in" method="dialog"><span class="light-box-close">${tertiaryButton(options.closeLabel, { type: "submit", formMethod: "dialog", icon: "close", isLabelHidden: true })}</span>${options.body}</form></dialog>`;
}
