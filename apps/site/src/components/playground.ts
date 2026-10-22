import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { glassPane, sheetMarkup, tray } from "./foundations.ts";
import { cutButton, runButton, textButton, textLink } from "./actions.ts";
import { choiceCards, codeField, cutField, selectField, tabSwitch, toggle, type SwitchTab } from "./inputs.ts";
import { STAND_IN_COVERS, banner, dropdown } from "./panes.ts";
import { emptyState, glanceFacts, listRows, numbers, table } from "./data.ts";
import { grid, paneParts, row, split, stack, type LayoutItem } from "./layout.ts";
import type { ControlMarkup } from "./control-markup.ts";

/*
 * The layout playground (/design/layout/playground): real components mixed into rows, stacks, grids and a pane's places, in any pane,
 * at 320 x 667, a tablet's width or a desktop's, light or dark, over Zaisma's backdrop or a game's, with the measuring check's result
 * for what's built and the call that builds it to copy. What's built is drawn by the same functions a page calls, in a frame of the
 * page's own shell at that size, so what it shows is what a page gets. Its state is the address (?layout=, base64url JSON): every change
 * is a link, so a layout can be sent to anyone as one. A workbench, like Figma's auto layout panel or Storybook's controls.
 */

export type PlaygroundPieceName =
  | "title" | "heading" | "line" | "paragraph" | "link" | "note"
  | "play" | "runner" | "details" | "dismiss" | "read-more" | "close" | "see-all" | "username" | "region" | "sort" | "sign-in-or-join"
  | "banner" | "cover" | "table" | "toggle" | "choices" | "glance" | "numbers" | "list" | "empty";

interface PlaygroundPiece {
  label: string;
  kind: LayoutItem["kind"];
  markup: () => Raw;
  /** The TypeScript a page writes for it: the call, as the item's markup. */
  call: string;
}

const COVER_SLUGS = ["ashen-crown", "neon-drift", "hollow-tide", "verdant", "iron-vigil", "glasswing", "frostline", "kestrel"];
const SORT_TABS: SwitchTab[] = [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }];
const ENTRY_TABS: SwitchTab[] = [{ label: "Sign in", tabValue: "signin", isCurrent: true }, { label: "Make an account", tabValue: "join", isCurrent: false }];
const TABLE_OPTIONS = { caption: "Open rooms", columns: [{ label: "Room" }, { label: "Map" }, { label: "Players", isNumeric: true }], rows: [["North gate", "Glacier", "6"], ["Ember pit", "Caldera", "4"], ["Old harbour", "Coast", "8"]] };

/** Every piece the playground offers: a component with content from its gallery examples, what it is to a layout, and its call. */
export const PLAYGROUND_PIECES: Record<PlaygroundPieceName, PlaygroundPiece> = {
  title: { label: "Title", kind: "words", markup: () => html`<h1>Ashen Crown</h1>`, call: "html`<h1>Ashen Crown</h1>`" },
  heading: { label: "Heading", kind: "words", markup: () => html`<h2>Rooms</h2>`, call: "html`<h2>Rooms</h2>`" },
  line: { label: "A line under it", kind: "words", markup: () => html`<p>by Ember Hollow · 1,204 playing</p>`, call: "html`<p>by Ember Hollow · 1,204 playing</p>`" },
  paragraph: {
    label: "Paragraph",
    kind: "block",
    markup: () => html`<p>A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself.</p>`,
    call: "html`<p>A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself.</p>`",
  },
  link: { label: "Link", kind: "words", markup: () => textLink("Share", "#playground"), call: 'textLink("Share", "/g/ashen-crown#share")' },
  note: { label: "Note", kind: "words", markup: () => html`<p>Updated a minute ago</p>`, call: "html`<p>Updated a minute ago</p>`" },
  play: { label: "Play, big", kind: "control", markup: () => runButton("Play", { type: "button", icon: "play", isBig: true }), call: 'runButton("Play", { type: "button", icon: "play", isBig: true })' },
  runner: { label: "Runner", kind: "control", markup: () => runButton("Sign in", { type: "button" }), call: 'runButton("Sign in", { type: "button" })' },
  details: { label: "Cut button", kind: "control", markup: () => cutButton("Details", { type: "button" }), call: 'cutButton("Details", { type: "button" })' },
  dismiss: { label: "Cut button, small", kind: "control", markup: () => cutButton("Dismiss", { type: "button", isSmall: true }), call: 'cutButton("Dismiss", { type: "button", isSmall: true })' },
  "read-more": { label: "Cut button, Read more", kind: "control", markup: () => cutButton("Read more", { type: "button" }), call: 'cutButton("Read more", { type: "button" })' },
  close: { label: "Cut button, its icon", kind: "control", markup: () => cutButton("Close", { type: "button", icon: "close", isLabelHidden: true }), call: 'cutButton("Close", { type: "button", icon: "close", isLabelHidden: true })' },
  "see-all": { label: "Text button", kind: "control", markup: () => textButton("See all", { type: "button" }), call: 'textButton("See all", { type: "button" })' },
  username: {
    label: "Cut field",
    kind: "control",
    markup: () => cutField({ id: "playground-username", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r" }),
    call: 'cutField({ name: "username", label: "Username", type: "text", icon: "person" })',
  },
  region: {
    label: "Select field",
    kind: "control",
    markup: () => selectField({ id: "playground-region", name: "region", label: "Region", choices: [{ label: "All regions", choiceValue: "" }, { label: "Europe", choiceValue: "eu" }] }),
    call: 'selectField({ name: "region", label: "Region", choices: [{ label: "All regions", choiceValue: "" }, { label: "Europe", choiceValue: "eu" }] })',
  },
  sort: { label: "Switch, small", kind: "control", markup: () => tabSwitch({ label: "Sort", switchSize: "small", tabs: SORT_TABS }), call: `tabSwitch({ label: "Sort", switchSize: "small", tabs: ${JSON.stringify(SORT_TABS).replace(/"(\w+)":/g, "$1: ")} })` },
  "sign-in-or-join": { label: "Switch, big", kind: "control", markup: () => tabSwitch({ label: "Sign in or make an account", switchSize: "big", tabs: ENTRY_TABS }), call: `tabSwitch({ label: "Sign in or make an account", switchSize: "big", tabs: ${JSON.stringify(ENTRY_TABS).replace(/"(\w+)":/g, "$1: ")} })` },
  banner: {
    label: "Banner",
    kind: "block",
    markup: () => banner({ text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", icon: "megaphone", action: { label: "Read more", href: "#playground" }, closeLabel: "Close" }),
    call: 'banner({ text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", icon: "megaphone", action: { label: "Read more", href: "/forum" }, closeLabel: "Close" })',
  },
  cover: { label: "Game cover", kind: "block", markup: () => STAND_IN_COVERS["ashen-crown"]!, call: 'gameCover({ title: "Ashen Crown", imageUrl: "/img/…", href: "/g/ashen-crown", facts: { playerCount: 1204 } })' },
  table: { label: "Table", kind: "block", markup: () => table(TABLE_OPTIONS), call: 'table({ caption: "Open rooms", columns: [{ label: "Room" }, { label: "Map" }, { label: "Players", isNumeric: true }], rows })' },
  toggle: { label: "Toggle", kind: "block", markup: () => toggle({ id: "playground-toggle", name: "cloud_saves", label: "Cloud saves", hint: "Players keep their progress on any device.", isOn: true }), call: 'toggle({ name: "cloud_saves", label: "Cloud saves", hint: "Players keep their progress on any device.", isOn: true })' },
  choices: {
    label: "Choice cards",
    kind: "block",
    markup: () => choiceCards({ id: "playground-choices", name: "visibility", label: "Who can see it", pickedValue: "listed", choices: [{ label: "Everyone", choiceValue: "listed", text: "On the home and in Browse." }, { label: "People with the link", choiceValue: "unlisted", text: "Not in any list." }] }),
    call: 'choiceCards({ name: "visibility", label: "Who can see it", pickedValue: "listed", choices })',
  },
  glance: { label: "Glance facts", kind: "block", markup: () => glanceFacts({ playerCount: 1204, friends: [{ username: "Liam" }, { username: "Sofia" }] }), call: 'glanceFacts({ playerCount: 1204, friends: [{ username: "Liam" }, { username: "Sofia" }] })' },
  numbers: {
    label: "Numbers",
    kind: "block",
    markup: () => numbers({ items: [{ label: "Players", figure: "1,284", change: "+18% on last week", isChangeGood: true }, { label: "Hours played", figure: "3,906", unit: "hours" }] }),
    call: 'numbers({ items: [{ label: "Players", figure: "1,284", change: "+18% on last week", isChangeGood: true }, { label: "Hours played", figure: "3,906", unit: "hours" }] })',
  },
  list: { label: "List rows", kind: "block", markup: () => listRows({ rows: [{ title: "Version 14", detail: "Live · Oct 19", href: "#playground" }, { title: "Version 13", detail: "Replaced · Oct 16", href: "#playground" }] }), call: 'listRows({ rows: [{ title: "Version 14", detail: "Live · Oct 19", href: "/dashboard/ashen-crown/versions" }] })' },
  empty: { label: "Empty state", kind: "block", markup: () => emptyState({ title: "No friends playing", text: "When a friend plays something, it shows here." }), call: 'emptyState({ title: "No friends playing", text: "When a friend plays something, it shows here." })' },
};

const PIECE_NAMES = Object.keys(PLAYGROUND_PIECES) as PlaygroundPieceName[];
const CONTROL_PIECES = PIECE_NAMES.filter((name) => PLAYGROUND_PIECES[name].kind === "control");
const WORDS_PIECES = PIECE_NAMES.filter((name) => PLAYGROUND_PIECES[name].kind === "words");

/** A line of what's built: one piece, a row of them or a grid of them. */
export type PlaygroundLine =
  | { layout: "piece"; piece: PlaygroundPieceName }
  | { layout: "row"; widths: "equal" | "lead-fills" | "fit"; alignment: "start" | "end" | "center" | "between"; pieces: PlaygroundPieceName[] }
  | { layout: "grid"; itemSize: "cover" | "card" | "figure"; pieces: PlaygroundPieceName[] };

export interface PlaygroundState {
  paneKind: "glass-pane" | "tray" | "sheet" | "none";
  paneSize: "small" | "medium" | "large" | "full";
  screen: "phone" | "tablet" | "desktop";
  backdrop: "zaisma" | "dark-game" | "bright-game";
  /** The pane's head: words, and a control in its top corner (Pane parts). */
  head: { words: PlaygroundPieceName; end: PlaygroundPieceName | null } | null;
  lines: PlaygroundLine[];
  /** The pane's foot: something at its start, a control in its bottom corner. */
  foot: { start: PlaygroundPieceName | null; end: PlaygroundPieceName | null } | null;
}

/** The sizes it's shown at, as the measuring check opens pages. */
export const PLAYGROUND_SCREENS = { phone: { label: "320 × 667", widthPx: 320, heightPx: 667 }, tablet: { label: "768 × 1024", widthPx: 768, heightPx: 1024 }, desktop: { label: "1440 × 900", widthPx: 1440, heightPx: 900 } } as const;

/** The real cases it starts from: the Game page's pane, a banner and its buttons, a pane head with a corner button, a cover grid, a table pane. */
export const PLAYGROUND_PRESETS: { name: string; label: string; state: PlaygroundState }[] = [
  {
    name: "game-pane",
    label: "A game's pane",
    state: { paneKind: "glass-pane", paneSize: "small", screen: "desktop", backdrop: "dark-game", head: null, foot: null, lines: [{ layout: "piece", piece: "title" }, { layout: "piece", piece: "line" }, { layout: "row", widths: "lead-fills", alignment: "start", pieces: ["play", "details"] }, { layout: "row", widths: "fit", alignment: "start", pieces: ["link", "link"] }] },
  },
  {
    name: "banner",
    label: "A banner, Dismiss and Read more",
    state: { paneKind: "glass-pane", paneSize: "full", screen: "desktop", backdrop: "zaisma", head: null, foot: null, lines: [{ layout: "piece", piece: "banner" }, { layout: "row", widths: "fit", alignment: "end", pieces: ["dismiss", "read-more"] }] },
  },
  {
    name: "pane-head",
    label: "A pane head with a corner button",
    state: { paneKind: "glass-pane", paneSize: "medium", screen: "desktop", backdrop: "zaisma", head: { words: "heading", end: "details" }, foot: { start: "note", end: "see-all" }, lines: [{ layout: "piece", piece: "paragraph" }] },
  },
  {
    name: "covers",
    label: "A grid of covers",
    state: { paneKind: "glass-pane", paneSize: "full", screen: "desktop", backdrop: "bright-game", head: null, foot: null, lines: [{ layout: "piece", piece: "heading" }, { layout: "grid", itemSize: "cover", pieces: ["cover", "cover", "cover", "cover", "cover", "cover"] }] },
  },
  {
    name: "table",
    label: "A table in a pane",
    state: { paneKind: "glass-pane", paneSize: "large", screen: "desktop", backdrop: "zaisma", head: { words: "heading", end: "details" }, foot: null, lines: [{ layout: "piece", piece: "table" }, { layout: "row", widths: "fit", alignment: "end", pieces: ["dismiss", "runner"] }] },
  },
];

export const DEFAULT_PLAYGROUND_STATE: PlaygroundState = PLAYGROUND_PRESETS[0]!.state;

const oneOf = <Kind extends string>(given: unknown, allowed: readonly Kind[], fallback: Kind): Kind => (allowed.includes(given as Kind) ? (given as Kind) : fallback);
const pieceOf = (given: unknown): PlaygroundPieceName | null => (PIECE_NAMES.includes(given as PlaygroundPieceName) ? (given as PlaygroundPieceName) : null);
const MOST_LINE_COUNT = 12;
const MOST_PIECE_COUNT = 8;

/** The state a ?layout= says, closed: anything it doesn't know is left out, and a broken one is the first preset. */
export function readPlaygroundState(encoded: string | null): PlaygroundState {
  if (!encoded) return DEFAULT_PLAYGROUND_STATE;
  let given: Record<string, unknown>;
  try {
    given = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0))));
    if (!given || typeof given !== "object") return DEFAULT_PLAYGROUND_STATE;
  } catch {
    return DEFAULT_PLAYGROUND_STATE;
  }
  const lines = (Array.isArray(given.lines) ? given.lines : []).slice(0, MOST_LINE_COUNT).flatMap((line: Record<string, unknown>): PlaygroundLine[] => {
    if (!line || typeof line !== "object") return [];
    const pieces = (Array.isArray(line.pieces) ? line.pieces : []).slice(0, MOST_PIECE_COUNT).map(pieceOf).filter((piece): piece is PlaygroundPieceName => piece !== null);
    if (line.layout === "piece") return pieceOf(line.piece) ? [{ layout: "piece", piece: pieceOf(line.piece)! }] : [];
    if (line.layout === "row") return [{ layout: "row", widths: oneOf(line.widths, ["equal", "lead-fills", "fit"], "fit"), alignment: oneOf(line.alignment, ["start", "end", "center", "between"], "start"), pieces }];
    if (line.layout === "grid") return [{ layout: "grid", itemSize: oneOf(line.itemSize, ["cover", "card", "figure"], "cover"), pieces }];
    return [];
  });
  const head = given.head as Record<string, unknown> | null;
  const foot = given.foot as Record<string, unknown> | null;
  return {
    paneKind: oneOf(given.paneKind, ["glass-pane", "tray", "sheet", "none"], "glass-pane"),
    paneSize: oneOf(given.paneSize, ["small", "medium", "large", "full"], "medium"),
    screen: oneOf(given.screen, ["phone", "tablet", "desktop"], "desktop"),
    backdrop: oneOf(given.backdrop, ["zaisma", "dark-game", "bright-game"], "zaisma"),
    head: head && typeof head === "object" && pieceOf(head.words) ? { words: pieceOf(head.words)!, end: pieceOf(head.end) } : null,
    lines,
    foot: foot && typeof foot === "object" && (pieceOf(foot.start) || pieceOf(foot.end)) ? { start: pieceOf(foot.start), end: pieceOf(foot.end) } : null,
  };
}

/** The ?layout= for a state. */
export function writePlaygroundState(state: PlaygroundState): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(state)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const PLAYGROUND_PATH = "/design/layout/playground";
export const playgroundHref = (state: PlaygroundState, theme: "light" | "dark" = "light") => `${PLAYGROUND_PATH}?layout=${writePlaygroundState(state)}${theme === "dark" ? "&theme=dark" : ""}`;

const itemOf = (name: PlaygroundPieceName): LayoutItem => {
  const piece = PLAYGROUND_PIECES[name];
  return piece.kind === "control" ? { kind: "control", markup: piece.markup() as ControlMarkup } : { kind: piece.kind, markup: piece.markup() };
};
const controlOf = (name: PlaygroundPieceName | null): ControlMarkup | undefined => (name && PLAYGROUND_PIECES[name].kind === "control" ? (PLAYGROUND_PIECES[name].markup() as ControlMarkup) : undefined);

/**
 * What's built, as a page would draw it. Each line's cell and each piece's in a row or grid carries an id (built-line-<line>,
 * built-piece-<line>-<piece>), for the playground's drag and drop; ids place nothing.
 */
export function playgroundBuilt(state: PlaygroundState): Raw {
  const pieceItem = (lineIndex: number) => (name: PlaygroundPieceName, pieceIndex: number): LayoutItem => ({ ...itemOf(name), id: `built-piece-${lineIndex}-${pieceIndex}` });
  const lineItem = (line: PlaygroundLine, lineIndex: number): LayoutItem => ({
    ...(line.layout === "piece"
      ? itemOf(line.piece)
      : line.layout === "row"
        ? { kind: "block" as const, markup: row({ widths: line.widths, alignment: line.alignment, items: line.pieces.map(pieceItem(lineIndex)) }) }
        : { kind: "block" as const, markup: grid({ itemSize: line.itemSize, items: line.pieces.map(pieceItem(lineIndex)) }) }),
    id: `built-line-${lineIndex}`,
  });
  const body = stack({ items: state.lines.map(lineItem) });
  const built = state.head || state.foot
    ? paneParts({
        head: state.head ? { words: PLAYGROUND_PIECES[state.head.words].markup(), end: controlOf(state.head.end) } : undefined,
        body,
        foot: state.foot ? { start: state.foot.start ? itemOf(state.foot.start) : undefined, end: controlOf(state.foot.end) } : undefined,
      })
    : body;
  if (state.paneKind === "none") return built;
  if (state.paneKind === "tray") return tray({ head: html`<h2>A tray's head</h2>`, body: built });
  if (state.paneKind === "sheet") return sheetMarkup({ id: "playground-sheet", title: "A sheet", body: built, closeButton: cutButton("Close", { type: "submit", icon: "close", isLabelHidden: true, isSmall: true }), isShown: true });
  return glassPane({ paneSize: state.paneSize, body: built });
}

/** The TypeScript that builds what's built: what a page writes. */
export function playgroundCall(state: PlaygroundState): string {
  const item = (name: PlaygroundPieceName) => `{ kind: "${PLAYGROUND_PIECES[name].kind}", markup: ${PLAYGROUND_PIECES[name].call} }`;
  const indent = (text: string, by: string) => text.split("\n").join(`\n${by}`);
  const line = (each: PlaygroundLine) =>
    each.layout === "piece"
      ? item(each.piece)
      : each.layout === "row"
        ? `{ kind: "block", markup: row({ widths: "${each.widths}",${each.widths === "fit" ? ` alignment: "${each.alignment}",` : ""} items: [\n  ${each.pieces.map(item).join(",\n  ")},\n] }) }`
        : `{ kind: "block", markup: grid({ itemSize: "${each.itemSize}", items: [\n  ${each.pieces.map(item).join(",\n  ")},\n] }) }`;
  const body = `stack({ items: [\n  ${state.lines.map((each) => indent(line(each), "  ")).join(",\n  ")},\n] })`;
  const corner = (name: PlaygroundPieceName | null) => (name && PLAYGROUND_PIECES[name].kind === "control" ? PLAYGROUND_PIECES[name].call : null);
  const parts = state.head || state.foot
    ? `paneParts({\n  ${[
        state.head ? `head: { words: ${PLAYGROUND_PIECES[state.head.words].call}${corner(state.head.end) ? `, end: ${corner(state.head.end)}` : ""} }` : "",
        `body: ${indent(body, "  ")}`,
        state.foot ? `foot: { ${[state.foot.start ? `start: ${item(state.foot.start)}` : "", corner(state.foot.end) ? `end: ${corner(state.foot.end)}` : ""].filter(Boolean).join(", ")} }` : "",
      ].filter(Boolean).join(",\n  ")},\n})`
    : body;
  if (state.paneKind === "none") return parts;
  if (state.paneKind === "tray") return `tray({ head: html\`<h2>A tray's head</h2>\`, body: ${indent(parts, "  ")} })`;
  if (state.paneKind === "sheet") return `sheet({ id: "…", title: "A sheet", closeLabel: "Close", body: ${indent(parts, "  ")} })`;
  return `glassPane({ paneSize: "${state.paneSize}", body: ${indent(parts, "  ")} })`;
}

/* ---- The workbench: the controls that change it, every one a link to the state with that change, which its script follows in place. ---- */

const changed = (state: PlaygroundState, change: Partial<PlaygroundState>): PlaygroundState => ({ ...state, ...change });
const withLine = (state: PlaygroundState, lineIndex: number, line: PlaygroundLine | null): PlaygroundState => ({
  ...state,
  lines: line ? state.lines.map((each, i) => (i === lineIndex ? line : each)) : state.lines.filter((_, i) => i !== lineIndex),
});

interface PickerOptions {
  id: string;
  label: string;
  picked: PlaygroundPieceName | null;
  names: PlaygroundPieceName[];
  hrefOf: (name: PlaygroundPieceName | null) => string;
  hasNone?: boolean;
}

/** A picker for one place: a cut button naming its piece, opening its menu (pieceMenu). */
const piecePicker = (options: PickerOptions): ControlMarkup => cutButton(options.picked ? PLAYGROUND_PIECES[options.picked].label : "None", { type: "button", controls: options.id, isExpanded: false, isSmall: true });

/** The menu a picker opens: the pieces its place takes, each a link to the state with it. The menus go outside the panes, so none is clipped. */
function pieceMenu(options: PickerOptions): Raw {
  return dropdown({
    id: options.id,
    label: options.label,
    items: [
      ...(options.hasNone ? [{ label: "None", href: options.hrefOf(null), isCurrent: options.picked === null }] : []),
      ...options.names.map((name) => ({ label: PLAYGROUND_PIECES[name].label, href: options.hrefOf(name), isCurrent: name === options.picked })),
    ],
  });
}

const switchOf = <Value extends string>(label: string, picked: Value, choices: [Value, string][], hrefOf: (value: Value) => string) =>
  tabSwitch({ label, switchSize: "small", tabs: choices.map(([value, words]) => ({ label: words, href: hrefOf(value), isCurrent: value === picked })) });

const PALETTE_GROUPS: [string, LayoutItem["kind"]][] = [["Words", "words"], ["Controls", "control"], ["Blocks", "block"]];

/**
 * The palette: every piece, by what it is. Drag one onto the preview to put it there (between lines, or into a row); press one to add it
 * at the end. Its link names the piece (&piece=), for the drag; drop something from the preview back here to take it out.
 */
function palette(state: PlaygroundState, href: (next: PlaygroundState) => string): Raw {
  return stack({
    label: "Pieces",
    items: [
      { kind: "words", markup: html`<p>Drag a piece onto the preview, or press it to add it at the end. Drag one back here to take it out.</p>` },
      // Each kind's pieces share their lines, so every line of them ends at the pane's frame gap however they wrap.
      ...PALETTE_GROUPS.flatMap(([words, kind]): LayoutItem[] => [
        { kind: "words", markup: html`<h3>${words}</h3>` },
        {
          kind: "block",
          markup: row({
            widths: "equal",
            label: words,
            items: PIECE_NAMES.filter((name) => PLAYGROUND_PIECES[name].kind === kind).map((name): LayoutItem => ({
              kind: "control",
              markup: cutButton(PLAYGROUND_PIECES[name].label, { href: `${href({ ...state, lines: [...state.lines, { layout: "piece" as const, piece: name }].slice(0, MOST_LINE_COUNT) })}&piece=${name}`, isSmall: true }),
            })),
          }),
        },
      ]),
    ],
  });
}

/** The workbench's side: the pane, the pieces, the head and foot, and each line, its layout and its pieces. Its menus come back too, for the page's end. */
function controlsPane(state: PlaygroundState, theme: "light" | "dark"): { pane: Raw; menus: Raw[] } {
  const href = (next: PlaygroundState) => playgroundHref(next, theme);
  const menus: Raw[] = [];
  const picker = (options: PickerOptions) => {
    menus.push(pieceMenu(options));
    return piecePicker(options);
  };
  const words = (text: string): LayoutItem => ({ kind: "words", markup: html`<p>${text}</p>` });
  const lineControls = state.lines.map((line, lineIndex): LayoutItem => {
    const pieces = line.layout === "piece" ? [line.piece] : line.pieces;
    const pickers = pieces.map((piece, pieceIndex): LayoutItem => ({
      kind: "control",
      markup: picker({
        id: `playground-line-${lineIndex}-${pieceIndex}`,
        label: `Line ${lineIndex + 1}, piece ${pieceIndex + 1}`,
        picked: piece,
        names: PIECE_NAMES,
        hasNone: line.layout !== "piece",
        hrefOf: (name) => href(line.layout === "piece" ? withLine(state, lineIndex, name ? { layout: "piece", piece: name } : null) : withLine(state, lineIndex, { ...line, pieces: name ? line.pieces.map((each, i) => (i === pieceIndex ? name : each)) : line.pieces.filter((_, i) => i !== pieceIndex) })),
      }),
    }));
    const layoutSwitch = switchOf(`Line ${lineIndex + 1}'s layout`, line.layout, [["piece", "One"], ["row", "Row"], ["grid", "Grid"]], (layout) =>
      href(withLine(state, lineIndex, layout === "piece" ? { layout: "piece", piece: pieces[0] ?? "heading" } : layout === "row" ? { layout: "row", widths: "fit", alignment: "start", pieces } : { layout: "grid", itemSize: "cover", pieces })),
    );
    const settings: LayoutItem[] =
      line.layout === "row"
        ? [
            { kind: "control", markup: switchOf("Widths", line.widths, [["lead-fills", "Lead fills"], ["equal", "Equal"], ["fit", "Fit"]], (widths) => href(withLine(state, lineIndex, { ...line, widths }))) },
            ...(line.widths === "fit" ? [{ kind: "control" as const, markup: switchOf("Alignment", line.alignment, [["start", "Start"], ["center", "Middle"], ["end", "End"], ["between", "Both ends"]], (alignment) => href(withLine(state, lineIndex, { ...line, alignment }))) }] : []),
          ]
        : line.layout === "grid"
          ? [{ kind: "control", markup: switchOf("Cell size", line.itemSize, [["cover", "Cover"], ["card", "Card"], ["figure", "Figure"]], (itemSize) => href(withLine(state, lineIndex, { ...line, itemSize }))) }]
          : [];
    const moves: LayoutItem[] = [
      ...(lineIndex > 0 ? [{ kind: "control" as const, markup: cutButton("Up", { href: href({ ...state, lines: state.lines.map((each, i) => (i === lineIndex - 1 ? line : i === lineIndex ? state.lines[lineIndex - 1]! : each)) }), isSmall: true }) }] : []),
      { kind: "control", markup: cutButton("Remove", { href: href(withLine(state, lineIndex, null)), isSmall: true }) },
    ];
    return {
      kind: "block",
      markup: stack({
        label: `Line ${lineIndex + 1}`,
        items: [
          { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "words", markup: html`<h3>Line ${lineIndex + 1}</h3>` }, { kind: "control", markup: layoutSwitch }] }) },
          ...settings,
          { kind: "block", markup: row({ widths: "fit", items: [...pickers, ...moves] }) },
        ],
      }),
    };
  });
  const headControls: LayoutItem = state.head
    ? {
        kind: "block",
        markup: row({
          widths: "fit",
          items: [
            words("Head"),
            { kind: "control", markup: picker({ id: "playground-head-words", label: "The head's words", picked: state.head.words, names: WORDS_PIECES, hrefOf: (name) => href(changed(state, { head: name ? { words: name, end: state.head!.end } : null })), hasNone: true }) },
            { kind: "control", markup: picker({ id: "playground-head-end", label: "The head's corner", picked: state.head.end, names: CONTROL_PIECES, hrefOf: (name) => href(changed(state, { head: { words: state.head!.words, end: name } })), hasNone: true }) },
          ],
        }),
      }
    : { kind: "block", markup: row({ widths: "fit", items: [{ kind: "control", markup: cutButton("Add a head", { href: href(changed(state, { head: { words: "heading", end: "details" } })), isSmall: true }) }] }) };
  const footControls: LayoutItem = state.foot
    ? {
        kind: "block",
        markup: row({
          widths: "fit",
          items: [
            words("Foot"),
            { kind: "control", markup: picker({ id: "playground-foot-start", label: "The foot's start", picked: state.foot.start, names: PIECE_NAMES, hrefOf: (name) => href(changed(state, { foot: name || state.foot!.end ? { start: name, end: state.foot!.end } : null })), hasNone: true }) },
            { kind: "control", markup: picker({ id: "playground-foot-end", label: "The foot's corner", picked: state.foot.end, names: CONTROL_PIECES, hrefOf: (name) => href(changed(state, { foot: name || state.foot!.start ? { start: state.foot!.start, end: name } : null })), hasNone: true }) },
          ],
        }),
      }
    : { kind: "block", markup: row({ widths: "fit", items: [{ kind: "control", markup: cutButton("Add a foot", { href: href(changed(state, { foot: { start: "note", end: "see-all" } })), isSmall: true }) }] }) };
  menus.push(dropdown({ id: "playground-presets", label: "Start from", items: PLAYGROUND_PRESETS.map((preset) => ({ label: preset.label, href: href(preset.state) })) }));
  const pane = glassPane({
    paneSize: "full",
    label: "What's built",
    body: paneParts({
      head: { words: html`<h2>Layout playground</h2><p>Real components, laid out the way a page lays them out.</p>`, end: cutButton("Start from", { type: "button", controls: "playground-presets", isExpanded: false }) },
      body: stack({
        items: [
          { kind: "control", markup: switchOf("Pane", state.paneKind, [["glass-pane", "Glass pane"], ["tray", "Tray"], ["sheet", "Sheet"], ["none", "No pane"]], (paneKind) => href(changed(state, { paneKind }))) },
          ...(state.paneKind === "glass-pane" ? [{ kind: "control" as const, markup: switchOf("Pane size", state.paneSize, [["small", "Small"], ["medium", "Medium"], ["large", "Large"], ["full", "Full"]], (paneSize) => href(changed(state, { paneSize }))) }] : []),
          { kind: "block", id: "playground-palette", markup: palette(state, href) },
          headControls,
          ...lineControls,
          { kind: "block", markup: row({ widths: "fit", items: [["row", "Add a row"], ["grid", "Add a grid"]].map(([layout, label]) => ({ kind: "control" as const, markup: cutButton(label!, { href: href({ ...state, lines: [...state.lines, layout === "row" ? { layout: "row", widths: "fit", alignment: "start", pieces: ["details", "details"] } : { layout: "grid", itemSize: "cover", pieces: ["cover", "cover", "cover"] }].slice(0, MOST_LINE_COUNT) as PlaygroundLine[] }), isSmall: true }) })) }) },
          footControls,
        ],
      }),
    }),
  });
  return { pane, menus };
}

/** The workbench's main column: the size and backdrop, the frame showing what's built, what the measuring check says, and the call. */
function previewPane(state: PlaygroundState, theme: "light" | "dark", frameHref: string): Raw {
  const href = (next: PlaygroundState) => playgroundHref(next, theme);
  const screen = PLAYGROUND_SCREENS[state.screen];
  return glassPane({
    paneSize: "full",
    label: "How it looks",
    body: stack({
      items: [
        { kind: "block", id: "playground-view", markup: row({ widths: "fit", items: [
          { kind: "control", markup: switchOf("Size", state.screen, (Object.keys(PLAYGROUND_SCREENS) as PlaygroundState["screen"][]).map((each) => [each, PLAYGROUND_SCREENS[each].label]), (each) => href(changed(state, { screen: each }))) },
          { kind: "control", markup: switchOf("Backdrop", state.backdrop, [["zaisma", "Zaisma's"], ["dark-game", "A dark game"], ["bright-game", "A bright game"]], (backdrop) => href(changed(state, { backdrop }))) },
        ] }) },
        { kind: "block", markup: html`<div class="playground-screen" data-cut-line="0" data-playground-screen data-width-px="${screen.widthPx}" data-height-px="${screen.heightPx}"><iframe class="playground-frame" src="${frameHref}" title="What's built, at ${screen.label}" width="${screen.widthPx}" height="${screen.heightPx}"></iframe></div>` },
        { kind: "block", id: "playground-check", markup: emptyState({ title: "Measuring", text: "The measuring check reads what's built once it has drawn." }) },
        { kind: "block", id: "playground-call-cell", markup: codeField({ id: "playground-call", label: "The call that builds it", code: playgroundCall(state) }) },
      ],
    }),
  });
}

/** The workbench: the controls beside the preview, the menus the controls open, and its state for its script. */
export function playground(options: { state: PlaygroundState; theme: "light" | "dark"; frameHref: string }): Raw {
  const { pane, menus } = controlsPane(options.state, options.theme);
  return html`<div class="playground" data-playground>${split({ sideSize: "pane-medium", side: html`<div id="playground-controls">${pane}<script type="application/json" id="playground-state">${raw(JSON.stringify(options.state).replace(/</g, "\\u003c"))}</script></div>`, main: previewPane(options.state, options.theme, options.frameHref) })}<div id="playground-menus">${menus}</div></div>`;
}

/**
 * The workbench's script. A change is a link: it's followed in place, the controls, the menus and the call swapped for the new state's,
 * and what's built swapped inside the frame (the frame loaded again only for a new size, backdrop or theme), the address following, so
 * Back undoes. Drag and drop: a piece from the palette, or one already built, dropped on the preview goes between the lines or into a
 * row, beside a piece, or after the last line; one dropped back on the palette comes out. The frame is scaled to fit its column at the
 * size it's shown at (its own window keeps that size, so its media queries and the measuring check see that size), and once what's built
 * has drawn, the measuring check's result shows under it.
 */
export const PLAYGROUND_SCRIPT_SOURCE = String.raw`(function () {
  var box = document.querySelector("[data-playground-screen]"); if (!box) return;
  var frame = box.querySelector("iframe"), stage = document.getElementById("stage");
  var state = readState(document), frameHref = frame.getAttribute("src"), dragged = null;
  function readState(doc) { var holder = doc.getElementById("playground-state"); return holder ? JSON.parse(holder.textContent) : null; }
  function encode(next) { return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(JSON.stringify(next)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function theme() { return stage && stage.dataset.themeChoice === "dark" ? "dark" : "light"; }
  function hrefOf(next) { return "/design/layout/playground?layout=" + encode(next) + (theme() === "dark" ? "&theme=dark" : ""); }
  function frameHrefOf(next) { return "/design/layout/playground/frame?layout=" + encode(next) + (theme() === "dark" ? "&theme=dark" : ""); }
  function fit() {
    var widthPx = Number(box.dataset.widthPx), heightPx = Number(box.dataset.heightPx), scale = Math.min(1, box.clientWidth / widthPx);
    frame.style.transform = "scale(" + scale + ")";
    box.style.height = Math.round(heightPx * scale) + "px";
  }
  fit(); window.zaismaWatch.size(box, fit);

  /* Following a change in place. */
  var going = 0;
  function swap(id, from) { var here = document.getElementById(id), there = from.getElementById(id); if (here && there) here.innerHTML = there.innerHTML; }
  async function go(href, isPushed) {
    var ticket = ++going;
    var page = new DOMParser().parseFromString(await (await fetch(href)).text(), "text/html");
    if (ticket !== going) return;
    ["playground-controls", "playground-menus", "playground-view", "playground-call-cell"].forEach(function (id) { swap(id, page); });
    state = readState(document);
    var nextBox = page.querySelector("[data-playground-screen]"), nextFrame = nextBox.querySelector("iframe"), nextHref = nextFrame.getAttribute("src");
    var isNewWindow = nextBox.dataset.widthPx !== box.dataset.widthPx || new URL(nextHref, location.href).searchParams.get("theme") !== new URL(frameHref, location.href).searchParams.get("theme") || stateOf(nextHref).backdrop !== stateOf(frameHref).backdrop;
    // The address is the state alone (a palette piece's link names its piece for a drag, which the address needn't keep).
    if (isPushed) { var clean = new URL(href, location.href); clean.searchParams.delete("piece"); history.pushState(null, "", clean.pathname + clean.search); }
    frameHref = nextHref;
    if (isNewWindow) {
      box.dataset.widthPx = nextBox.dataset.widthPx; box.dataset.heightPx = nextBox.dataset.heightPx;
      frame.width = nextFrame.width; frame.height = nextFrame.height; frame.title = nextFrame.title; frame.src = nextHref; fit();
      return;
    }
    var built = new DOMParser().parseFromString(await (await fetch(nextHref)).text(), "text/html");
    if (ticket !== going) return;
    var main = frame.contentDocument && frame.contentDocument.querySelector("main"), nextMain = built.querySelector("main");
    if (!main || !nextMain) { frame.src = nextHref; return; }
    main.innerHTML = nextMain.innerHTML;
    wire(frame.contentDocument); measureSoon();
  }
  function stateOf(href) { try { var given = new URL(href, location.href).searchParams.get("layout"); return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(given.replace(/-/g, "+").replace(/_/g, "/")), function (c) { return c.charCodeAt(0); }))); } catch (error) { return {}; } }
  function isPlaygroundLink(link) { return link && link.origin === location.origin && link.pathname === "/design/layout/playground" && link.closest("[data-playground]"); }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!isPlaygroundLink(link) || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); go(link.href, true);
  });
  addEventListener("popstate", function () { go(location.href, false); });
  // The gallery's light or dark: the frame follows it.
  if (stage) new MutationObserver(function () { go(hrefOf(state), false); }).observe(stage, { attributes: true, attributeFilter: ["data-theme-choice"] });

  /* What the measuring check finds. */
  function said(failures) {
    var holder = document.getElementById("playground-check"); if (!holder) return;
    if (!failures.length) { holder.innerHTML = '<div class="state-note"><div class="state-words"><p class="state-title">Nothing out of line</p><p class="state-text">The measuring check found every margin, gap, height and corner where it belongs.</p></div></div>'; return; }
    var list = document.createElement("ul"); list.className = "list-rows"; list.setAttribute("aria-label", "What the measuring check found");
    failures.forEach(function (failure) {
      var item = document.createElement("li"), rowBox = document.createElement("div"), words = document.createElement("span"), title = document.createElement("span"), detail = document.createElement("span");
      rowBox.className = "list-row"; words.className = "list-row-words"; title.className = "list-row-title"; detail.className = "list-row-detail";
      title.textContent = failure.check; detail.textContent = failure.element + ": " + failure.said;
      words.append(title, detail); rowBox.append(words); item.append(rowBox); list.append(item);
    });
    holder.replaceChildren(list);
  }
  var measureTimer = 0;
  function measureSoon() {
    clearTimeout(measureTimer);
    var inside = frame.contentWindow; if (!inside) return;
    (inside.document.fonts ? inside.document.fonts.ready : Promise.resolve()).then(function () {
      measureTimer = setTimeout(function () { if (inside.zaismaMeasureLayout) said(inside.zaismaMeasureLayout({ isMainActionChecked: false })); }, 400);
    });
  }

  /* Drag and drop. */
  function cellOf(el) { return el && el.closest && el.closest('[id^="built-piece-"], [id^="built-line-"]'); }
  function placeOf(cell) { var parts = cell.id.split("-"); return parts[1] === "piece" ? { line: Number(parts[2]), piece: Number(parts[3]) } : { line: Number(parts[2]) }; }
  // Where a drop at x, y goes: between lines (before a line, or after it), into a row or grid beside a piece, or beside a line's one piece.
  function targetAt(doc, x, y) {
    var el = doc.elementFromPoint(x, y), cell = cellOf(el);
    if (cell && cell.id.indexOf("built-piece-") === 0) {
      var at = placeOf(cell), r = cell.getBoundingClientRect(), isBefore = x < r.left + r.width / 2;
      return { kind: "into", line: at.line, piece: at.piece + (isBefore ? 0 : 1), rect: r, side: isBefore ? "start" : "end" };
    }
    if (cell) {
      var index = placeOf(cell).line, box = cell.getBoundingClientRect(), band = Math.min(16, box.height * 0.3);
      if (y < box.top + band) return { kind: "line", line: index, rect: box, side: "top" };
      if (y > box.bottom - band || !state.lines[index] || state.lines[index].layout !== "piece") return { kind: "line", line: index + 1, rect: box, side: "bottom" };
      var isStart = x < box.left + box.width / 2;
      return { kind: "beside", line: index, piece: isStart ? 0 : 1, rect: box, side: isStart ? "start" : "end" };
    }
    var cells = doc.querySelectorAll('[id^="built-line-"]'), last = cells[cells.length - 1];
    return { kind: "line", line: state.lines.length, rect: last ? last.getBoundingClientRect() : null, side: "bottom" };
  }
  function mark(doc, target) {
    var line = doc.querySelector(".playground-drop-mark");
    if (!line) { line = doc.createElement("span"); line.className = "playground-drop-mark"; line.setAttribute("aria-hidden", "true"); doc.body.append(line); }
    if (!target || !target.rect) { line.hidden = true; return; }
    var r = target.rect, isAcross = target.side === "top" || target.side === "bottom";
    line.hidden = false; line.classList.toggle("is-across", isAcross);
    line.style.left = (isAcross ? r.left : target.side === "start" ? r.left - 3 : r.right - 1) + "px";
    line.style.top = (isAcross ? (target.side === "top" ? r.top - 3 : r.bottom - 1) : r.top) + "px";
    line.style[isAcross ? "width" : "height"] = (isAcross ? r.width : r.height) + "px";
    line.style[isAcross ? "height" : "width"] = "";
  }
  // The state with the piece dragged taken out where it was (from the preview), and put in where it was dropped.
  function dropped(target) {
    var next = JSON.parse(JSON.stringify(state)), piece = dragged.piece, from = dragged.from, moving = null;
    if (from) {
      var source = next.lines[from.line]; if (!source) return null;
      if (from.piece === undefined) {
        moving = next.lines.splice(from.line, 1)[0];
        if (target.kind !== "line") target = { kind: "line", line: target.line + (target.side === "end" ? 1 : 0) };
        if (from.line < target.line) target.line--;
        next.lines.splice(target.line, 0, moving);
        return next;
      }
      piece = source.pieces[from.piece];
      source.pieces.splice(from.piece, 1);
      if ((target.kind === "into" || target.kind === "beside") && target.line === from.line && from.piece < target.piece) target.piece--;
      if (!source.pieces.length) { next.lines.splice(from.line, 1); if (from.line < target.line) target.line--; else if (from.line === target.line && target.kind !== "line") target = { kind: "line", line: from.line }; }
    }
    if (target.kind === "line") next.lines.splice(target.line, 0, { layout: "piece", piece: piece });
    else if (target.kind === "into") next.lines[target.line].pieces.splice(target.piece, 0, piece);
    else { var one = next.lines[target.line].piece; next.lines[target.line] = { layout: "row", widths: "fit", alignment: "start", pieces: target.piece ? [one, piece] : [piece, one] }; }
    next.lines = next.lines.slice(0, 12);
    return next;
  }
  function takenOut() {
    var next = JSON.parse(JSON.stringify(state)), from = dragged.from, source = next.lines[from.line]; if (!source) return null;
    if (from.piece === undefined || source.layout === "piece") next.lines.splice(from.line, 1);
    else { source.pieces.splice(from.piece, 1); if (!source.pieces.length) next.lines.splice(from.line, 1); }
    return next;
  }
  document.addEventListener("dragstart", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!isPlaygroundLink(link)) return;
    var piece = new URL(link.href).searchParams.get("piece"); if (!piece) return;
    dragged = { piece: piece }; event.dataTransfer.setData("text/plain", piece); event.dataTransfer.effectAllowed = "copyMove";
  });
  document.addEventListener("dragend", function () { dragged = null; if (frame.contentDocument) mark(frame.contentDocument, null); });
  var shelf = function () { return document.getElementById("playground-palette"); };
  document.addEventListener("dragover", function (event) { if (dragged && dragged.from && shelf() && shelf().contains(event.target)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } });
  document.addEventListener("drop", function (event) {
    if (!dragged || !dragged.from || !shelf() || !shelf().contains(event.target)) return;
    event.preventDefault(); var next = takenOut(); dragged = null; if (next) go(hrefOf(next), true);
  });
  // The frame's cells: draggable, and the frame a place to drop.
  function wire(doc) {
    if (!doc) return;
    doc.querySelectorAll('[id^="built-piece-"], [id^="built-line-"]').forEach(function (cell) { cell.setAttribute("draggable", "true"); });
    if (doc.isPlaygroundWired) return; doc.isPlaygroundWired = true;
    doc.addEventListener("dragstart", function (event) {
      var cell = cellOf(event.target); if (!cell) return;
      var at = placeOf(cell), line = state.lines[at.line];
      // A line of one piece moves as that piece; a row or grid by its own cell moves whole.
      dragged = { from: line && line.layout === "piece" ? { line: at.line, piece: undefined } : at };
      if (line && line.layout === "piece") dragged.piece = line.piece;
      event.dataTransfer.setData("text/plain", cell.id); event.dataTransfer.effectAllowed = "move";
    });
    doc.addEventListener("dragover", function (event) { if (!dragged) return; event.preventDefault(); mark(doc, targetAt(doc, event.clientX, event.clientY)); });
    doc.addEventListener("dragleave", function (event) { if (!event.relatedTarget) mark(doc, null); });
    doc.addEventListener("drop", function (event) {
      if (!dragged) return; event.preventDefault();
      var target = targetAt(doc, event.clientX, event.clientY); mark(doc, null);
      var next = dropped(target); dragged = null; if (next) go(hrefOf(next), true);
    });
    doc.addEventListener("dragend", function () { dragged = null; mark(doc, null); });
  }
  frame.addEventListener("load", function () { wire(frame.contentDocument); measureSoon(); });
  if (frame.contentDocument && frame.contentDocument.readyState === "complete") { wire(frame.contentDocument); measureSoon(); }
})();
`;

component({
  name: "Layout playground",
  slug: "layout-playground",
  group: "layout",
  summary: "A workbench for trying a layout before writing it: drag real components onto a pane, into rows, stacks and grids and a pane's places, at a phone's size or a desktop's, light or dark, over Zaisma's backdrop or a game's. It says what the measuring check finds and gives the call that builds it.",
  styles: `
/* The playground: the controls beside the preview (a Split), which stays in view as the controls scroll; a line's name in a label's words. */
.playground h3 { margin: 0; font: var(--type-label); color: var(--ink-2); }
.playground .split-main { position: sticky; top: var(--under-gallery-bar, var(--pad-pane)); }
/* The preview: a window of the page at the size picked, carved into the pane and cut by the edge rule, scaled down to fit its column, so
   what's built keeps that size inside it. */
.playground-screen { position: relative; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape); }
.playground-frame { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: var(--page); }
/* Inside the frame: what's built can be picked up, and where it'll go shows as an orange line. */
[id^="built-"][draggable="true"] { cursor: grab; }
.playground-drop-mark { position: fixed; z-index: 60; width: 4px; height: 4px; background: var(--run); pointer-events: none; }
.playground-drop-mark.is-across { height: 4px; }
`,
  render: playground,
  examples: [
    { label: "Open it, from a real case", markup: html`<p>${PLAYGROUND_PRESETS.map((preset, i) => html`${i ? " · " : ""}${textLink(preset.label, playgroundHref(preset.state))}`)}</p>`, isWide: true },
    { label: "What a preset builds: a game's pane", markup: playgroundBuilt(DEFAULT_PLAYGROUND_STATE) },
    { label: "Its call", markup: glassPane({ paneSize: "medium", body: codeField({ id: "example-playground-call", label: "The call that builds it", code: playgroundCall(DEFAULT_PLAYGROUND_STATE) }) }) },
  ],
});
