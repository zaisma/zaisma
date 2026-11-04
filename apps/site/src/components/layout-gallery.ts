import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { glassPane, tag } from "./foundations.ts";
import { action, secondaryButton, primaryButton, tertiaryButton, textLink } from "./actions.ts";
import { cutField, selectField } from "./inputs.ts";
import { shelf } from "./navigation.ts";
import { STAND_IN_COVERS, banner, gameCard } from "./panes.ts";
import { gamePaneExample, keyDetails, table, stateNote } from "./data.ts";
import { gameMedia } from "./game-media.ts";
import { STAND_IN_COVER_PICTURES } from "../generated/stand-in-placeholders.generated.ts";
import { GRID_STYLES, PAGE_SHAPE_STYLES, PAGE_SHAPES, PANE_PARTS_STYLES, ROW_STYLES, STACK_STYLES, TRACK_STYLES, COLUMNS_STYLES, columns, grid, pageShapeDrawing, paneParts, row, stack, track, type GridItem, type LayoutItem, stackOfOne } from "./layout.ts";

/*
 * The layout components in the gallery: layout.ts makes them, and this registers them with their examples, since the examples use
 * components from every group (which import layout.ts themselves). Each example is a real case from Zaisma's pages, and each piece shows every state
 * it has: long, empty and full.
 */

const words = (markup: Raw): GridItem => ({ kind: "words", markup });
const block = (markup: Raw): GridItem => ({ kind: "block", markup });
const covers = (slugs: string[]): GridItem[] => slugs.map((slug) => block(STAND_IN_COVERS[slug]!));

/** A pane whose head has a control in its corner: Rooms, with Refresh. */
export const roomsPane = (): Raw =>
  glassPane({
    paneWidth: "full",
    label: "Rooms",
    body: paneParts({
      head: { words: html`<h2>Rooms</h2><p>267 playing now in 78 rooms</p>`, end: secondaryButton(action("refresh"), { type: "button" }) },
      body: table({ whenEmpty: stateNote({ stateKind: "empty", title: "No open rooms right now", text: "Start one, and it shows here for others to join." }), caption: "Open rooms", columns: [{ label: "Room" }, { label: "Map" }, { label: "Players", isNumeric: true }], rows: [["North gate", "Glacier", "6"], ["Ember pit", "Caldera", "4"], ["Old harbour", "Coast", "8"]] }),
      foot: { start: words(html`<p>Updated a minute ago</p>`), end: secondaryButton("All rooms", { type: "button" }) },
    }),
  });

/** The About pane a game's sections show. */
const aboutPane = (): Raw => glassPane({ paneWidth: "full", label: "About", body: stack({ items: [words(html`<h2>About</h2>`), words(html`<p>A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself.</p>`)] }) });

/** What a grid of a developer's games shows with none: the State note's own case, with what starts it. */
const noGames = stateNote({ stateKind: "empty", title: "No games yet", text: "Make one from your AI, or upload a folder with an index.html from your terminal.", action: primaryButton("Make a game", { type: "button", isFullWidth: true }) });
/** What a track of friends' games shows with none: the State note's own case, words alone. */
const noFriendsPlaying = stateNote({ stateKind: "empty", title: "No friends playing", text: "When a friend plays something, it shows here." });

component({
  name: "Page shape",
  slug: "page-shape",
  group: "layout",
  subgroup: "page",
  summary: "What a page is, which sets how wide it runs: every rebuilt page says one (layout's pageShape). Words, forms and settings are reading, one column under the header (--size-page-reading); covers, cards, tables and charts are wide, the whole frame (--size-page-wide); a page whose world is the page (the home, a game's page) is full, its world to the screen's edges and its panes in the frame. The header and footer sit in the frame on every page, so moving between pages never moves them. On a phone every shape is the screen less its margins. Not for a piece inside a page: a pane is full or fit, and half the screen is Columns.",
  styles: PAGE_SHAPE_STYLES,
  render: pageShapeDrawing,
  examples: [
    ...PAGE_SHAPES.flatMap((pageShape) =>
      (["2560 desktop", "Laptop", "Phone"] as const).map((screenName) => ({ label: `${pageShape[0]!.toUpperCase()}${pageShape.slice(1)}, on a ${screenName}`, markup: pageShapeDrawing({ pageShape, screenName }), isStill: true })),
    ),
    ...(["2560 desktop", "Laptop"] as const).map((screenName) => ({ label: `Reading, beside its places (Sidebar layout), on a ${screenName}`, markup: pageShapeDrawing({ pageShape: "reading", screenName, hasSidebar: true }), isStill: true })),
  ],
});

component({
  name: "Stack",
  slug: "stack",
  group: "layout",
  subgroup: "inside",
  summary: "Things one under another: a pane's heading, its lines, its fields and its button. Each gap is picked from what's on each side, so you never pass one; say what each thing is (words, a control, a block) and the stack spaces it. A pane's body that holds one thing is stackOfOne. Not for things side by side (Row), or a long list of the same thing (Grid, or a list from Data).",
  styles: STACK_STYLES,
  render: stack,
  examples: [
    {
      label: "Words, fields and a button",
      markup: glassPane({
        paneWidth: "fit",
        body: stack({
          items: [
            words(html`<h2>Welcome back</h2>`),
            words(html`<p>Sign in to keep your progress everywhere.</p>`),
            { kind: "control", markup: cutField({ id: "stack-username", name: "username", label: "Username", type: "text", icon: "person", text: "emma_r" }) },
            { kind: "control", markup: cutField({ id: "stack-password", name: "password", label: "Password", type: "password", icon: "lock" }) },
            { kind: "control", markup: primaryButton(action("signIn"), { type: "button", isFullWidth: true, isBig: true }) },
            words(html`<p>${textLink("Forgot your password?", "#stack")}</p>`),
          ],
        }),
      }),
    },
    { label: "A game's pane: its name, its Key details, Play and its Details", markup: gamePaneExample() },
    {
      label: "A heading, then Key details, then what they sum up",
      isWide: true,
      markup: glassPane({ paneWidth: "full", label: "This week", body: stack({ items: [words(html`<h2>This week</h2>`), block(keyDetails({ label: "This week", details: [{ label: "Players", detailValue: "1,284", under: "+18% on last week", isUnderGood: true }, { label: "Hours played", detailValue: "3,906", unit: "hours", under: "+6% on last week", isUnderGood: true }, { label: "Stored", detailValue: "48.1", unit: "MB" }] })), words(html`<p>Most of them came back on the weekend.</p>`)] }) }),
    },
    {
      label: "Controls stacked: square between, cut only at the stack's ends",
      markup: glassPane({ paneWidth: "fit", body: stack({ items: ["Settings", "Account", "Sign out"].map((label) => ({ kind: "control" as const, markup: secondaryButton(label, { type: "button", isFullWidth: true }) })) }) }),
    },
    { label: "One thing alone: stackOfOne", markup: glassPane({ paneWidth: "fit", body: stackOfOne(html`<p>Nothing here is waiting for you.</p>`, "words") }) },
    {
      label: "A part that's hidden, or empty, takes no room and no gap",
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [words(html`<h2>Join a room</h2>`), { kind: "block", id: "stack-hidden-error", isHidden: true, markup: banner({ text: "That room is full.", icon: "warning" }) }, { kind: "words", id: "stack-empty-part", markup: raw("") }, { kind: "control", markup: secondaryButton(action("join"), { type: "button", isFullWidth: true }) }] }) }),
    },
    {
      label: "Long words wrap, and a word with no spaces breaks",
      markup: glassPane({ paneWidth: "fit", body: stack({ items: [words(html`<h2>The Long and Winding Chronicles of the Ashen Crown, Part Two</h2>`), words(html`<p>Made by SomeoneWithAVeryLongNameThatHasNoSpacesInItAtAllAndKeepsGoing, who answers within a day.</p>`), { kind: "control", markup: secondaryButton("Details", { type: "button", isFullWidth: true }) }] }) }),
    },
  ],
});

component({
  name: "Row",
  slug: "row",
  group: "layout",
  subgroup: "inside",
  summary: "Things side by side. Say how they share the width: equal, the lead fills (the others fit their words), or each fits at the start, the end, the middle or both ends. Controls in a row are always one height, the tallest one's, and slant toward each other; a row that can't fit on one line becomes a stack of them. Not for covers or cards (Grid or Track), two panes (Columns), or a pane's heading with a control in its corner (Pane parts).",
  styles: ROW_STYLES,
  render: row,
  examples: [
    {
      label: "Lead fills: Play takes the rest, Details fits its words",
      markup: glassPane({ paneWidth: "full", body: row({ widths: "lead-fills", items: [{ kind: "control", markup: primaryButton(action("play"), { type: "button", isBig: true }) }, { kind: "control", markup: secondaryButton("Details", { type: "button", isBig: true }) }] }) }),
    },
    {
      label: "Equal: Continue and Cancel share the width",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Continue", { type: "button" }) }, { kind: "control", markup: secondaryButton("Cancel", { type: "button" }) }] }) }),
    },
    {
      label: "One height: a small Share beside Read more takes its height",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: secondaryButton("Share", { type: "button", isSmall: true }) }, { kind: "control", markup: secondaryButton("Read more", { type: "button" }) }] }) }),
    },
    {
      label: "Fit, between: a heading at the start, its control at the end, on the control's center line",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "fit", alignment: "between", items: [words(html`<h2>Versions</h2>`), { kind: "control", markup: secondaryButton(action("newVersion"), { type: "button" }) }] }) }),
    },
    {
      label: "A field and its button: the field fills, Join fits, on the field's box",
      markup: glassPane({ paneWidth: "full", body: row({ widths: "lead-fills", items: [{ kind: "control", markup: cutField({ id: "row-code", name: "room_code", label: "Room code", type: "text", icon: "people", placeholder: "ABCD" }) }, { kind: "control", markup: secondaryButton(action("join"), { type: "button" }) }] }) }),
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
      label: "Too long for one line: a stack, each control filling its line",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "equal", items: ["Keep this version live for everyone", "Go back to the version before it", "Take this game down for now"].map((label) => ({ kind: "control" as const, markup: secondaryButton(label, { type: "button" }) })) }) }),
    },
    {
      label: "Words in a row: links",
      markup: glassPane({ paneWidth: "fit", body: row({ widths: "fit", items: [words(textLink("Share", "#row")), words(textLink("Report", "#row")), words(html`<span>${tag("Updated", "new")}</span>`)] }) }),
    },
  ],
});

component({
  name: "Grid",
  slug: "grid",
  group: "layout",
  subgroup: "inside",
  summary: "Cells of one size in lines down the page, as many to a line as fit: a full list of covers (Browse, a library) or cards. Say what a cell holds and the grid sizes it, by its own width, folding to one across on a phone so a wide cover and its title show whole. On one line, it's up to six covers to take in at a glance. Not for a row to browse sideways under a heading (Track, or a Shelf), or headline figures (Key details).",
  styles: GRID_STYLES,
  render: grid,
  examples: [
    { label: "Covers", isWide: true, markup: glassPane({ paneWidth: "full", body: grid({ whenEmpty: noGames, itemSize: "cover", items: covers(["ashen-crown", "neon-drift", "hollow-tide", "verdant", "iron-vigil", "glasswing"]) }) }) },
    { label: "Where there's little room: one across, the cover and its long title whole", markup: glassPane({ paneWidth: "fit", body: grid({ whenEmpty: noGames, itemSize: "cover", items: [...covers(["ashen-crown", "neon-drift"]), block(gameCard({ title: "The Long and Winding Chronicles of the Ashen Crown", picture: STAND_IN_COVER_PICTURES["hollow-tide"] ?? null, href: "#grid", facts: { playerCount: 1204 } })), ...covers(["verdant"])] }) }) },
    { label: "Six covers on one line, then three, two and one across, as the room runs out", isWide: true, markup: glassPane({ paneWidth: "full", body: grid({ whenEmpty: noGames, itemSize: "cover", isAllOnOneLine: true, items: covers(["ashen-crown", "neon-drift", "hollow-tide", "verdant", "iron-vigil", "glasswing"]) }) }) },
    { label: "One cover alone stays a cover's size", isWide: true, markup: glassPane({ paneWidth: "full", body: grid({ whenEmpty: noGames, itemSize: "cover", items: covers(["ashen-crown"]) }) }) },
    { label: "With none: a State note in their place, with what starts it", markup: glassPane({ paneWidth: "fit", body: grid({ whenEmpty: noGames, itemSize: "cover", items: [] }) }) },
    { label: "Cards", isWide: true, markup: glassPane({ paneWidth: "full", body: grid({ whenEmpty: noGames, itemSize: "card", items: ["Ashen Crown", "Neon Drift", "Hollow Tide"].map((title) => block(glassPane({ paneWidth: "full", body: stack({ items: [words(html`<h2>${title}</h2>`), words(html`<p>Live · version 14</p>`), { kind: "control", markup: secondaryButton("Open", { type: "button", isFullWidth: true }) }] }) }))) }) }) },
  ],
});

component({
  name: "Track",
  slug: "track",
  group: "layout",
  subgroup: "inside",
  summary: "A row of covers or pictures that scrolls sideways, fading at an edge with more past it, a few showing with the next peeking in, its sideways Rail under it while it runs past its room. Under a heading, covers make a Shelf. Pictures with no words under them (a game's screenshots) lie closer than covers. Not for a full list someone reads through (Grid).",
  styles: TRACK_STYLES,
  render: track,
  examples: [
    { label: "Covers in a pane", isWide: true, markup: glassPane({ paneWidth: "full", body: track({ whenEmpty: noGames, id: "example-track", itemSize: "cover", items: covers(["ashen-crown", "neon-drift", "hollow-tide", "verdant", "iron-vigil", "glasswing", "frostline", "kestrel"]) }) }) },
    { label: "Under a heading: a Shelf (Navigation)", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(shelf({ id: "example-track-shelf", trackId: "example-track-shelf-track", title: "New", items: covers(["kestrel", "frostline", "glasswing", "iron-vigil", "verdant"]) })) }) },
    { label: "All in view: no rail, and nothing moves if one comes", isWide: true, markup: glassPane({ paneWidth: "full", body: track({ whenEmpty: noGames, id: "example-track-fits", itemSize: "cover", items: covers(["ashen-crown", "neon-drift"]) }) }) },
    { label: "With none: a State note in their place, words alone", markup: glassPane({ paneWidth: "fit", body: track({ whenEmpty: noFriendsPlaying, id: "example-track-empty", itemSize: "cover", items: [] }) }) },
    { label: "Pictures: a game's screenshots", isWide: true, markup: glassPane({ paneWidth: "full", body: stackOfOne(gameMedia({ id: "example-track-pictures", gameTitle: "Ashen Crown", whenEmpty: stateNote({ stateKind: "empty", title: "No screenshots yet", text: "The developer hasn't added any screenshots." }), items: ["hollow-tide", "verdant", "neon-drift", "ashen-crown", "iron-vigil"].map((slug) => ({ mediaKind: "picture" as const, picture: STAND_IN_COVER_PICTURES[slug]! })) })) }) },
  ],
});

component({
  name: "Columns",
  slug: "columns",
  group: "layout",
  subgroup: "page",
  summary: "Two halves of the width side by side, like a game's details beside its rooms and updates. A pane takes the whole width or fits what's in it, so one that should take half the screen goes in a column. One column can stay in view while the other scrolls; they go one over the other where both can't have room. Not for controls (Row), or more than two of the same thing (Grid).",
  styles: COLUMNS_STYLES,
  render: columns,
  examples: [
    {
      label: "A game's pane beside its sections, staying in view",
      isWide: true,
      markup: columns({
        stickyColumn: "first",
        columns: [gamePaneExample(), html`${roomsPane()}${aboutPane()}`],
      }),
    },
    { label: "Plain: two panes, each as tall as what's in it", isWide: true, markup: columns({ columns: [aboutPane(), roomsPane()] }) },
    { label: "Where both can't have room: one over the other", markup: columns({ columns: [aboutPane(), gamePaneExample()] }) },
  ],
});

/** A gray box naming a place in a pane, for the drawings of Pane parts. */
const partBox = (name: string, isBody = false): Raw => html`<span class="part-box${isBody ? " is-body" : ""}">${name}</span>`;
const headParts = { start: secondaryButton("Start corner", { type: "button" }), words: html`<h3>${partBox("Heading")}</h3><p>${partBox("Other words, under the corners")}</p>`, end: secondaryButton("End corner", { type: "button" }) };
const footParts = { start: words(partBox("Foot's start")), end: secondaryButton("End corner", { type: "button" }) };
const bodyPart = stackOfOne(partBox("Body: whatever the pane holds", true));

component({
  name: "Pane parts",
  slug: "pane-parts",
  group: "layout",
  subgroup: "inside",
  summary: "A pane's three places, top to bottom, each as wide as the pane and each optional but the body. The head holds its heading between up to two corner controls, and its other words under them. The body holds whatever the pane is for. The foot holds something at its start and one control in its end corner. A corner control sits in the corner and takes its cut; the places run the whole width between them. Not for a pane with no control in a corner: its body is a Stack.",
  styles: `${PANE_PARTS_STYLES}
/* The drawings: a gray box in each place of a real Pane parts, so what they show is where things really go. */
.part-box { display: block; background: var(--slab); box-shadow: var(--slab-shade); font: var(--type-note); color: var(--ink-2); text-align: center; }
.part-box.is-body { display: grid; place-items: center; aspect-ratio: 4 / 1; }
`,
  render: paneParts,
  examples: [
    { label: "Every place: a head, a body and a foot", isWide: true, isStill: true, markup: glassPane({ paneWidth: "full", body: paneParts({ head: headParts, body: bodyPart, foot: footParts }) }) },
    { label: "Only what's used: a head with one corner, and a body", isStill: true, markup: glassPane({ paneWidth: "full", body: paneParts({ head: { words: html`<h3>${partBox("Heading")}</h3>`, end: headParts.end }, body: bodyPart }) }) },
    { label: "A body and a foot, with no head", isStill: true, markup: glassPane({ paneWidth: "full", body: paneParts({ body: bodyPart, foot: footParts }) }) },
    { label: "A head with Refresh in its corner, a table, a foot with a control in its corner", isWide: true, markup: roomsPane() },
    {
      label: "In a pane that fits what's in it",
      markup: glassPane({ paneWidth: "fit", body: paneParts({ head: { words: html`<h2>Friends</h2>`, end: secondaryButton(action("addFriend"), { type: "button", isSmall: true }) }, body: stack({ items: [words(html`<p>Liam, Sofia and Noah are online.</p>`)] }), foot: { end: tertiaryButton("See all", { type: "button" }) } }) }),
    },
    {
      label: "Both top corners: Back and Close, as on a sheet's second step",
      markup: glassPane({ paneWidth: "fit", body: paneParts({ head: { start: tertiaryButton(action("back"), { type: "button", isLabelHidden: true, isSmall: true }), words: html`<h2>Report this game</h2>`, end: tertiaryButton(action("close"), { type: "button", isLabelHidden: true, isSmall: true }) }, body: stack({ items: [words(html`<p>Say what's wrong, and a person reads it within a day.</p>`)] }) }) }),
    },
    {
      label: "A foot alone",
      markup: glassPane({ paneWidth: "fit", body: paneParts({ body: stack({ items: [words(html`<p>Your save is kept on this device until you sign in.</p>`)] }), foot: { start: words(html`<p>Saved a minute ago</p>`), end: secondaryButton(action("signIn"), { type: "button" }) } }) }),
    },
    {
      label: "A long heading beside its corner control: it wraps, its first line on the control's center line",
      isWide: true,
      markup: glassPane({ paneWidth: "full", body: paneParts({ head: { words: html`<h2>Rooms where your friends are playing right now</h2><p>Liam, Sofia and Noah, in 3 rooms</p>`, end: secondaryButton(action("refresh"), { type: "button", isLabelHidden: true }) }, body: stack({ items: [words(html`<p>Join one to play with them.</p>`)] }) }) }),
    },
  ],
});
