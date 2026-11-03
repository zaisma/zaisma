import { raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";

/** A moment the real sheet goes through: what the page's script shows and says in it, on the sheet's own markup. */
export interface SheetState<Options> {
  /** Lowercase words joined by dashes: what Over a game asks for it by. */
  stateValue: string;
  /** What the moment is, under it in the gallery: "As a guest". */
  label: string;
  options: Options;
  /** Parts its script shows. */
  shownIds?: string[];
  /** Parts its script hides. */
  hiddenIds?: string[];
  /** What its script says, by the id of the part that holds the words. */
  words?: Record<string, string>;
}

export interface GallerySheetOptions<Options> {
  /** The gallery's heading: "Block sheet". */
  name: string;
  /** Lowercase words joined by dashes, unique among the gallery's components. */
  slug: string;
  /** One plain line on what it's for. */
  summary: string;
  /** Every moment it goes through, its usual one first: test/site/one-sheet-states.test.ts refuses a hidden part no state shows. */
  states: SheetState<Options>[];
  /** Parts only a live page can show, each with why. */
  partsOnlyLive?: Record<string, string>;
  /** Its markup. Shown is the gallery's open copy; a page opens it with its own script. */
  make: (options: Options, isShown?: boolean) => Raw;
}

export type GallerySheet<Options> = ((options: Options) => Raw) & {
  /** Its markup in a moment, or its usual one: what Over a game shows. */
  inState: (stateValue?: string) => Raw;
};

export interface DeclaredSheet {
  name: string;
  /** Its parts hidden until a script shows them, as a page gets it. */
  hiddenIds: () => string[];
  /** What each state's markup leaves hidden. */
  hiddenIdsIn: () => string[][];
  partsOnlyLive: string[];
}

export const GALLERY_SHEETS: DeclaredSheet[] = [];

const tagOf = (id: string) => new RegExp(`<[a-z][^<>]*\\bid="${id}"[^<>]*>`);
const hiddenIdsOf = (markup: string) => [...markup.matchAll(/<[a-z][^<>]*\bhidden\b[^<>]*>/g)].flatMap((tag) => /\bid="([^"]+)"/.exec(tag[0])?.[1] ?? []);

/** A state on the sheet's markup, as its script would leave it. */
function applied<Options>(markup: Raw, state: SheetState<Options>): Raw {
  let made = markup.html;
  for (const id of state.shownIds ?? []) made = made.replace(tagOf(id), (tag) => tag.replace(/ hidden\b/, ""));
  for (const id of state.hiddenIds ?? []) made = made.replace(tagOf(id), (tag) => (/\bhidden\b/.test(tag) ? tag : tag.replace(/>$/, " hidden>")));
  for (const [id, words] of Object.entries(state.words ?? {})) {
    made = made.replace(new RegExp(`(<[a-z][^<>]*\\bid="${id}"[^<>]*>(?:<[a-z][^<>]*>)*)[^<]*`), (matchedText, opening: string) => opening + words.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  }
  return raw(made);
}

/** A second copy on one gallery page: its ids its own, as nothing runs on them there. */
const withOwnIds = (markup: Raw, suffix: string): Raw => raw(markup.html.replace(/\b(id|for|aria-labelledby|aria-controls|aria-describedby)="([^"]+)"/g, (matchedText, name: string, idText: string) => `${name}="${idText}${suffix}"`));

/**
 * A sheet Zaisma really shows: its one version. Declaring it here is what gives pages the function they call and the gallery its entry on
 * Panes › Sheets, each moment it goes through shown on its own markup, so a new sheet is on that page by being made, and Over a game shows the
 * same one. test/node/one-sheet.test.ts refuses a product sheet made any other way.
 */
export function gallerySheet<Options>(declared: GallerySheetOptions<Options>): GallerySheet<Options> {
  const made = (options: Options) => declared.make(options);
  const stateOf = (stateValue?: string) => declared.states.find((state) => state.stateValue === stateValue) ?? declared.states[0]!;
  component({
    name: declared.name,
    slug: declared.slug,
    group: "panes",
    subgroup: "sheets",
    summary: declared.summary,
    styles: "",
    render: made as never,
    examples: declared.states.map((state, index) => {
      const shown = applied(declared.make(state.options, true), state);
      return { label: state.label, markup: index ? withOwnIds(shown, `-state-${index}`) : shown, isWide: true, isStill: true };
    }),
  });
  GALLERY_SHEETS.push({
    name: declared.name,
    hiddenIds: () => hiddenIdsOf(declared.make(declared.states[0]!.options).html),
    hiddenIdsIn: () => declared.states.map((state) => hiddenIdsOf(applied(declared.make(state.options), state).html)),
    partsOnlyLive: Object.keys(declared.partsOnlyLive ?? {}),
  });
  return Object.assign(made, {
    inState: (stateValue?: string) => {
      const state = stateOf(stateValue);
      return applied(declared.make(state.options), state);
    },
  });
}
