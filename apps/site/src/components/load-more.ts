import { html, raw, type Raw } from "../markup.ts";
import { secondaryButton } from "./actions.ts";

/*
 * Load more's markup (Navigation › Load more, whose styles and script are in navigation.ts), on its own so a list or a table in any group
 * can end in one without importing Navigation, which imports them.
 */

export interface LoadMoreOptions {
  /** The next page's address: the same page with the next cursor. Left out, the list has ended, and its end words (endText) show instead. */
  href?: string;
  label: string;
  /** The id of the list it adds to; the next page has a list of the same id, and its own Load more for the page after, or its end words. */
  listId: string;
  /**
   * Lists further down it adds to as well, from the next page's lists of the same ids (Browse's games for other devices, after the games
   * for yours). One that is hidden, with what leads it, shows once something is added to it.
   */
  moreListIds?: string[];
  /** It loads the next page by itself as it nears the screen, so a long grid of covers just keeps going as you scroll; it stays a button to press. */
  isLoadedOnScroll?: boolean;
  /** What it says once the list has ended: "That's every version." */
  endText?: string;
  /** The last press didn't load, so it says so under the button: the gallery's fixed state (LOAD_MORE_SCRIPT says it as it happens). */
  isFailed?: boolean;
}

/** What Load more says under itself when the next page didn't come. */
export const LOAD_FAILED_TEXT = "That didn't load. Check your connection, then try again.";

/**
 * Load more: a secondary button under a long list that adds the next page to it in place. Without scripts it's a link to that page. Once the list
 * has ended, a line saying so takes its place.
 */
export function loadMore(options: LoadMoreOptions): Raw {
  const listIds = [options.listId, ...(options.moreListIds ?? [])].join(" ");
  if (!options.href) return html`<div class="load-more" data-load-more="${listIds}"><p class="load-more-words">${options.endText ?? ""}</p></div>`;
  return html`<div class="load-more${options.isFailed ? " is-failed" : ""}" data-load-more="${listIds}"${options.isLoadedOnScroll ? raw(" data-loads-on-scroll") : ""}>${secondaryButton(options.label, { href: options.href, isFullWidth: true })}<p class="load-more-words" role="status"${options.isFailed ? "" : raw(" hidden")}>${options.isFailed ? LOAD_FAILED_TEXT : ""}</p></div>`;
}
