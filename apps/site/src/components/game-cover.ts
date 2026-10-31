import { SIZED_IMAGE_WIDTHS_PX } from "@zaisma/core";
import { html, raw, type Raw } from "../markup.ts";
import { CUT_LINE } from "./foundations.ts";

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

/** A picture Zaisma serves (/img/<id>) at its kept sizes up to a small card's, for the browser to pick from; any other address as it is. */
function smallCoverSizes(imageUrl: string): Raw {
  if (!/^\/img\/[A-Za-z0-9_-]+$/.test(imageUrl)) return raw("");
  const widths = SIZED_IMAGE_WIDTHS_PX.filter((widthPx) => widthPx <= SMALL_GAME_CARD_LARGEST_PX * 3);
  return html` srcset="${widths.map((widthPx) => `${imageUrl}/w${widthPx}.webp ${widthPx}w`).join(", ")}" sizes="${SMALL_GAME_CARD_LARGEST_PX}px"`;
}

export function smallGameCard(options: { imageUrl: string | null }): Raw {
  const isPlaceholder = options.imageUrl === null;
  return html`<span class="cover is-small${isPlaceholder ? " is-placeholder" : ""}"><span class="cover-art carving holds-art" data-cut-line="0">${CUT_LINE}${isPlaceholder ? "" : html`<span class="cover-picture carving-art" data-cut-line="0"><img src="${options.imageUrl}"${smallCoverSizes(options.imageUrl!)} alt="" decoding="async"></span>`}</span></span>`;
}
