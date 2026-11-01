import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { glassPane, tag } from "./foundations.ts";
import { secondaryButton, primaryButton, tertiaryButton, textLink } from "./actions.ts";
import { cutField, selectField } from "./inputs.ts";
import { shelf } from "./navigation.ts";
import { STAND_IN_COVERS, banner } from "./panes.ts";
import { table, stateNote } from "./data.ts";
import { GRID_STYLES, PAGE_SHAPE_STYLES, PAGE_SHAPES, PANE_PARTS_STYLES, ROW_STYLES, STACK_STYLES, TRACK_STYLES, COLUMNS_STYLES, columns, grid, pageShapeDrawing, paneParts, row, stack, track, type GridItem, type LayoutItem, stackOfOne } from "./layout.ts";

/*
 * The layout components in the gallery: layout.ts makes them, and this registers them with their examples, since the examples use
 * components from every group (which import layout.ts themselves). Each example is a real case from Zaisma's pages.
 */

const words = (markup: Raw): GridItem => ({ kind: "words", markup });
const block = (markup: Raw): GridItem => ({ kind: "block", markup });
const covers = (slugs: string[]): GridItem[] => slugs.map((slug) => block(STAND_IN_COVERS[slug]!));

/** A game's pane: its title, who made it, Play and Details (the lead fills), then Share and Report as words. */
export const gamePane = (): Raw =>
  glassPane({
    paneWidth: "fit",
    label: "Ashen Crown",
    body: stack({
      items: [
        words(html`<h1>Ashen Crown</h1>`),
        words(html`<p>by Ember Hollow · 1,204 playing</p>`),
        block(row({ widths: "lead-fills", items: [{ kind: "control", markup: primaryButton("Play", { type: "button", icon: "play", isBig: true }) }, { kind: "control", markup: secondaryButton("Details", { type: "button" }) }] })),
        words(row({ widths: "fit", items: [words(textLink("Share", "#stack")), words(textLink("Report", "#stack"))] })),
      ],
    }),
  });

/** A banner with Read more and Dismiss: one height, slanting toward each other at the banner's end. */
export const newsBanner = (): Raw =>
  glassPane({
    paneWidth: "full",
    body: stack({
      items: [
        block(banner({ text: "Kept rooms are here: worlds that sleep when everyone leaves and wake as they were.", icon: "megaphone", action: { label: "Read more", href: "#row" }, closeLabel: "Dismiss" })),
        block(row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: secondaryButton("Dismiss", { type: "button", isSmall: true }) }, { kind: "control", markup: secondaryButton("Read more", { type: "button" }) }] })),
      ],
    }),
  });

/** A pane whose head has a control in its corner: Rooms, with Refresh. */
export const roomsPane = (): Raw =>
  glassPane({
    paneWidth: "full",
    label: "Rooms",
    body: paneParts({
      head: { words: html`<h2>Rooms</h2><p>267 playing now in 78 rooms</p>`, end: secondaryButton("Refresh", { type: "button" }) },
      body: table({ whenEmpty: stateNote({ stateKind: "empty", title: "No open rooms right now", text: "Start one, and it shows here for others to join." }), caption: "Open rooms", columns: [{ label: "Room" }, { label: "Map" }, { label: "Players", isNumeric: true }], rows: [["North gate", "Glacier", "6"], ["Ember pit", "Caldera", "4"], ["Old harbour", "Coast", "8"]] }),
      foot: { start: words(html`<p>Updated a minute ago</p>`), end: secondaryButton("All rooms", { type: "button" }) },
    }),
  });

component({
  name: "Page shape",
  slug: "page-shape",
  group: "layout",
  summary: "What a page is, which sets how wide it runs: every rebuilt page says one (layout's pageShape). Words, forms and settings are reading, one column under the header (--size-page-reading); covers, cards, tables and charts are wide, the whole frame (--size-page-wide); a page whose world is the page (the home, a game's page, the city) is full, its world to the screen's edges and its panes in the frame. The header and footer sit in the frame on every page, so moving between pages never moves them. On a phone every shape is the screen less its margins.",
  styles: PAGE_SHAPE_STYLES,
  render: pageShapeDrawing,
  examples: PAGE_SHAPES.flatMap((pageShape) =>
    (["2560 desktop", "Laptop"] as const).map((screenName) => ({ label: `${pageShape[0]!.toUpperCase()}${pageShape.slice(1)}, on a ${screenName}`, markup: pageShapeDrawing({ pageShape, screenName }), isStill: true })),
  ),
});

component({
  name: "Stack",
  slug: "stack",
  group: "layout",
  summary: "Things one under another: a pane's heading, its lines, its fields and its button. Each gap is picked from what's on each side, so you never pass one; say what each thing is (words, a control, a block) and the stack spaces it.",
  styles: STACK_STYLES,
  render: stack,
  examples: [
    {
      label: "Words, fields and a button: words are 8px apart, a labeled field is a block (24px either side), words under a button 8px",
      markup: glassPane({
        paneWidth: "fit",
        body: stack({
          items: [
            words(html`<h2>Welcome back</h2>`),
            words(html`<p>Sign in to keep your progress everywhere.</p>`),
            { kind: "control", markup: cutField({ id: "stack-username", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r" }) },
            { kind: "control", markup: cutField({ id: "stack-password", name: "password", label: "Password", type: "password", icon: "lock" }) },
            { kind: "control", markup: primaryButton("Sign in", { type: "button", isFullWidth: true, isBig: true }) },
            words(html`<p>${textLink("Forgot your password?", "#stack")}</p>`),
          ],
        }),
      }),
    },
    { label: "A game's pane: words, then Play and Details, then Share and Report", markup: gamePane() },
    {
      label: "Controls stacked: 8px, square between, cut only at the stack's ends",
      markup: glassPane({ paneWidth: "fit", body: stack({ items: ["Settings", "Account", "Sign out"].map((label) => ({ kind: "control" as const, markup: secondaryButton(label, { type: "button", isFullWidth: true }) })) }) }),
    },
  ],
});

component({
  name: "Row",
  slug: "row",
  group: "layout",
  summary: "Things side by side. Say how they share the width: equal, the lead fills (the others fit their words), or each fits at the start, the end, the middle or both ends. Controls in a row are always one height, the tallest one's, and slant toward each other.",
  styles: ROW_STYLES,
  render: row,
  examples: [
    {
      label: "Lead fills: Play takes the rest, Details fits its words",
      markup: glassPane({ paneWidth: "full", body: row({ widths: "lead-fills", items: [{ kind: "control", markup: primaryButton("Play", { type: "button", icon: "play", isBig: true }) }, { kind: "control", markup: secondaryButton("Details", { type: "button", isBig: true }) }] }) }),
    },
    {
      label: "Equal: Continue and Cancel share the width",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Continue", { type: "button" }) }, { kind: "control", markup: secondaryButton("Cancel", { type: "button" }) }] }) }),
    },
    {
      label: "One height: a small Dismiss beside Read more takes its height",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: secondaryButton("Dismiss", { type: "button", isSmall: true }) }, { kind: "control", markup: secondaryButton("Read more", { type: "button" }) }] }) }),
    },
    {
      label: "Fit, between: a heading at the start, its control at the end, on the control's center line",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "fit", alignment: "between", items: [words(html`<h2>Versions</h2>`), { kind: "control", markup: secondaryButton("New version", { type: "button", icon: "upload" }) }] }) }),
    },
    {
      label: "A field and its button: the field fills, Join fits, on the field's box",
      markup: glassPane({ paneWidth: "full", body: row({ widths: "lead-fills", items: [{ kind: "control", markup: cutField({ id: "row-code", name: "room_code", label: "Room code", type: "text", icon: "people", placeholder: "ABCD" }) }, { kind: "control", markup: secondaryButton("Join", { type: "button" }) }] }) }),
    },
    {
      label: "Equal: two pickers share the width, on their fields' boxes",
      isWide: true,
      markup: glassPane({
        paneWidth: "full",
        body: row({
          widths: "equal",
          items: [
            { kind: "control", markup: selectField({ id: "row-region", name: "region", label: "Region", choices: [{ label: "All regions", choiceValue: "" }, { label: "Europe", choiceValue: "eu" }] }) },
            { kind: "control", markup: selectField({ id: "row-mode", name: "mode", label: "Mode", choices: [{ label: "Any mode", choiceValue: "" }, { label: "Survival", choiceValue: "survival" }] }) },
          ],
        }),
      }),
    },
    {
      label: "Words in a row: links, a word's gap apart",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "fit", items: [words(textLink("Share", "#row")), words(textLink("Report", "#row")), words(html`<span>${tag("Updated", "new")}</span>`)] }) }),
    },
  ],
});

component({
  name: "Grid",
  slug: "grid",
  group: "layout",
  summary: "Cells of one size, as many to a line as fit: covers, cards, figures. Say what a cell holds and the grid sizes it; it folds to fewer columns as it narrows, to one on a phone, by its own width.",
  styles: GRID_STYLES,
  render: grid,
  examples: [
    { label: "Covers", isWide: true, markup: glassPane({ paneWidth: "full", body: grid({ whenEmpty: stateNote({ stateKind: "empty", title: "No games here yet", text: "Games show here as they come." }), itemSize: "cover", items: covers(["ashen-crown", "neon-drift", "hollow-tide", "verdant", "iron-vigil", "glasswing"]) }) }) },
    { label: "Cards", isWide: true, markup: glassPane({ paneWidth: "full", body: grid({ whenEmpty: stateNote({ stateKind: "empty", title: "No games here yet", text: "Games show here as they come." }), itemSize: "card", items: ["Ashen Crown", "Neon Drift", "Hollow Tide"].map((title) => block(glassPane({ paneWidth: "full", body: stack({ items: [words(html`<h2>${title}</h2>`), words(html`<p>Live · version 14</p>`), { kind: "control", markup: secondaryButton("Open", { type: "button" }) }] }) }))) }) }) },
  ],
});

component({
  name: "Track",
  slug: "track",
  group: "layout",
  summary: "A row of covers that scrolls sideways, fading at an edge with more past it, a few showing with the next peeking in, its sideways Rail under it while it runs past its room. Under a heading row with its Row arrows (shown only with a mouse), it's a shelf.",
  styles: TRACK_STYLES,
  render: track,
  examples: [
    { label: "Covers in a pane", isWide: true, markup: glassPane({ paneWidth: "full", body: track({ whenEmpty: stateNote({ stateKind: "empty", title: "No games here yet", text: "Games show here as they come." }), id: "example-track", itemSize: "cover", items: covers(["ashen-crown", "neon-drift", "hollow-tide", "verdant", "iron-vigil", "glasswing", "frostline", "kestrel"]) }) }) },
    { label: "Under a heading with its arrows: a Shelf (Navigation)", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(shelf({ id: "example-track-shelf", trackId: "example-track-shelf-track", title: "New", items: covers(["kestrel", "frostline", "glasswing", "iron-vigil", "verdant"]) })) }) },
  ],
});

component({
  name: "Columns",
  slug: "columns",
  group: "layout",
  summary: "Two halves of the width side by side, like a game's details beside its rooms and updates. A pane takes the whole width or fits what's in it, so one that should take half the screen goes in a column. One column can stay in view while the other scrolls; they go one over the other where both can't have room.",
  styles: COLUMNS_STYLES,
  render: columns,
  examples: [
    {
      label: "A game's pane beside its sections, staying in view",
      isWide: true,
      markup: columns({
        stickyColumn: "first",
        columns: [gamePane(), html`${roomsPane()}${glassPane({ paneWidth: "full", label: "About", body: stack({ items: [words(html`<h2>About</h2>`), words(html`<p>A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself.</p>`)] }) })}`],
      }),
    },
  ],
});

component({
  name: "Pane parts",
  slug: "pane-parts",
  group: "layout",
  summary: "A pane's places: its head (words, and one control in its top corner), its body and its foot (something at the start, one control in its bottom corner). A corner control sits in the corner and takes its cut.",
  styles: PANE_PARTS_STYLES,
  render: paneParts,
  examples: [
    { label: "A head with Refresh in its corner, a table, a foot with a control in its corner", isWide: true, markup: roomsPane() },
    {
      label: "In a pane that fits what's in it",
      markup: glassPane({ paneWidth: "fit", body: paneParts({ head: { words: html`<h2>Friends</h2>`, end: secondaryButton("Add a friend", { type: "button", icon: "friends", isSmall: true }) }, body: stack({ items: [words(html`<p>Liam, Sofia and Noah are online.</p>`)] }), foot: { end: tertiaryButton("See all", { type: "button" }) } }) }),
    },
    {
      label: "A long heading beside its corner control: it wraps, its first line on the control's center line",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: paneParts({ head: { words: html`<h2>Rooms where your friends are playing right now</h2><p>Liam, Sofia and Noah, in 3 rooms</p>`, end: secondaryButton("Refresh", { type: "button", icon: "refresh", isLabelHidden: true }) }, body: stack({ items: [words(html`<p>Join one to play with them.</p>`)] }) }) }),
    },
  ],
});
