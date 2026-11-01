import { html, type Raw } from "../markup.ts";
import { CUT_LINE, picture } from "./foundations.ts";

/*
 * The Game card's small variant (panes.ts holds the component, its styles and its gallery examples): here on its own, so what holds one in a
 * row of its own (a search's games) can use it without the card's other parts, and without a loop between components.
 */

/**
 * A game card's art alone, small: the same carved well and art, cut by the edge rule like every card, with no line under it, no corner
 * facts and no link of its own, for a row that is the link and says the rest (a search's games). Its art is the cover, or Zaisma's mark in
 * the well where there's none (null).
 */
/** The widest a small card is drawn (a search's games on a wide header); its picture is offered at up to three times that. */
export const SMALL_GAME_CARD_LARGEST_PX = 160;

export function smallGameCard(options: { imageUrl: string | null; placeholderDataUrl?: string | null }): Raw {
  const isPlaceholder = options.imageUrl === null;
  // A Picture (foundations.ts): its placeholder in its place until it arrives, offered at its kept sizes up to three times the card's widest.
  const art = isPlaceholder ? "" : html`<span class="cover-picture carving-art" data-cut-line="0">${picture({ imageUrl: options.imageUrl!, widthPx: 160, heightPx: 90, placeholderDataUrl: options.placeholderDataUrl ?? null }, { shownSizes: `${SMALL_GAME_CARD_LARGEST_PX}px`, largestPx: SMALL_GAME_CARD_LARGEST_PX * 3, isEager: true })}</span>`;
  return html`<span class="cover is-small${isPlaceholder ? " is-placeholder" : ""}"><span class="cover-art carving holds-art" data-cut-line="0">${CUT_LINE}${art}</span></span>`;
}
