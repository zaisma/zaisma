# Design: Glass

Every component, in every state, is on [zaisma.com/design](https://zaisma.com/design), rendered from the site's own code (`apps/site/src/components/`). Change a component there and it changes on every page at once.

Zaisma is the glass, and the game is not. Zaisma's interface is a layer of glass over the page: the header, panes, menus and controls are glass, and behind them is the game's own background or Zaisma's. The game's art, its covers and its screen are never glass and never ours to restyle.

## Rules

Each rule says what holds it. A rule a check can measure has one, so it holds on every page without anyone looking; the rest are judged in the preview, on [Screens](#screens).

- **Pages are only gallery components, layout included.** No page has styles, classes or a sheet of its own; it calls components and lays them out with the layout components. *Held by* `test/site/design.test.ts` ("pages").
- **Nothing is out of line, on any screen.** Two margins in a pane, rows of one height on one line, corner controls in their corners, no bevel under 4px, nothing spilling or overlapping, no sideways scroll. *Held by* `npm run layout:check` at 320 × 667 and 1440 × 900, light and dark, on every page.
- **Words line up.** Words inside a field, a list's rows, a table or a card start where the pane's words do (`--pad-inside-words`), so a heading over a field lines up with the field's words; and words are never a little further in than the margin (inset twice). *Held by* `npm run layout:check` ("words inside it off the pane's words", "words off the pane's margin").
- **Words beside a control sit on its center line.** Their first line does (their last on a field's boxes and at a pane's foot), at a pane's top edge too, where the control takes the corner's cut at the frame gap. *Held by* `npm run layout:check` ("words beside a control off its center line").
- **Controls come in four heights, and a row is one.** Every control is its size class's height (small 36, regular 44, field 52, big 56, 48 on a phone), never a number of its own; two controls side by side are a Row, an equal row's cells are one width, and a row that can't fit on one line becomes a stack, each control filling its own line. *Held by* `npm run layout:check` ("a control off its size class's height", "two controls side by side outside a row", "an equal row's cells of different widths", "a control alone on a row's line").
- **Everything you press is big enough to press.** On a touch screen, at least 44px tall, its hit area grown past what shows where it's smaller. *Held by* `npm run layout:check` at 320 × 667 ("a touch target under 44px"); links inside a line of words are the one exception.
- **No words cut off, none left alone.** Words wrap rather than being clipped (an ellipsis only where a page says so), and no paragraph or heading leaves one word alone on its last line (`text-wrap`, set once in `tokens.ts`). *Held by* `npm run layout:check` ("words cut off").
- **Nothing empty takes a place.** A thing with nothing in it (a bot check before it's needed) takes no room and no gap. *Held by* `npm run layout:check` ("an empty thing taking a gap").
- **The page's panes, the header and the footer share one edge.** *Held by* `npm run layout:check` ("out of line with the header").
- **Nothing square in a cut corner.** Anything with an edge in a pane's corner takes the corner's cut, with no component asking for it; only words, bare icons and thin lines are left alone. *Held by* `npm run layout:check` ("square in a cut corner").
- **One runner in view.** The header's Sign in is a cut button on a page with a runner of its own. *Held by* `npm run layout:check` ("two runners in view").
- **A pane is as wide as what holds it, or as wide as what's in it.** Never a width of its own: one that should take half the screen is a column of Columns. *Held by* the compiler (`paneWidth: "full" | "fit"`) and `test/site/design.test.ts` ("layout").
- **Zaisma is the glass over the game.** Everything of Zaisma's is glass, cut and rimmed the same way; what's behind it is a backdrop, never a flat color. *Held by* `test/site/design.test.ts` (one glass, the edge rule).
- **Orange only on what you act on.** The runner button (the one main action), the line under the tab, the step or the pick you're on, keyboard focus. Never on words, headings, charts or decoration; a warning, and a field marked wrong, is amber (`--warning`), a yellower hue. *Held by* `npm run layout:check` ("orange words on what you don't act on"); the rest is judged in the preview.
- **Nothing waits on an animation.** A click does its thing at once; motion only shows what already happened. *Judged in the preview.*
- **No decoration.** No "Live now" lights, sale banners, badges for their own sake or glows that mean nothing. *Judged in the preview.*
- **Buttons move only when pointed at or pressed.** They lift and lean toward the pointer and sink when pressed; at rest they're still. A scene behind the glass may move on its own. *Held by* `test/site/design.test.ts` (what you point at never moves).
- **No hotkey hints.** "/" jumps to search, and nothing on the page says so. *Judged in the preview.*
- **The main action shows without scrolling.** *Held by* `npm run layout:check` (the runner above the fold, where the page has one).
- **Players first.** Show what helps a player decide or act. Say game developers, never creators. *Judged in the preview.*
- **Game pictures are only the developer's image.** Nothing drawn over covers or screenshots: titles and buttons sit beside a picture, never on it. *Held by* `npm run layout:check` (nothing overlaps a cover).
- **No eyebrows and no ALL CAPS.** Headings are sentences. *Held by* `npm run layout:check` ("words in capitals"); eyebrows are judged in the preview.
- **The home shows a whole game without scrolling.** Its first cover is whole above the fold on every screen. *Held by* `npm run layout:check` (`isCoverAboveFold` in `CHECKED_PAGES`).
- **A token's name is code.** Jost draws two hyphens as one dash, so `--spring` in words is set in code. *Held by* `npm run layout:check` ("a token's name outside code").

A remark in a preview becomes one of three things: a token's value, a component's option, or a check. It's written here with what holds it, so it holds on every page from then on, built or not.

## Voice

Plain, open and clear. Say what happens, in whole sentences, as one person would to another. Verbose enough to leave no question, and no more. Never claim more than is true.

- Write what the player gets and what it costs them: what's saved, who sees it, what happens next.
- Don't write marketing words (unlock, seamless, exclusive, powerful, next-level), corporate or startup talk (leverage, ecosystem, empower), or exclamation marks.
- Don't promise what isn't built, and don't hedge what is.

| Not this | This |
| --- | --- |
| Unlock cloud saves and sync seamlessly across all your devices! | Your progress stays on this device. Make an account to keep it everywhere. |
| Join the community to unlock exclusive features. | Keep your progress, play with friends and get your own username. |
| We take your privacy seriously. | Your birthday is never shown to anyone. |

## Tokens

Defined once in `apps/site/src/components/foundations.ts` (`TOKEN_STYLES`). Light glass has dark words; smoked glass has light words.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#E7E4DF` | `#121110` | Under the backdrop, before it draws |
| `--ink` | `#14171C` | `#F7F9FC` | Words |
| `--ink-2` | `#3D444E` | 86% white | Second words, tabs at rest |
| `--muted` | `#59606A` | 70% white | Notes, the footer |
| `--line` | 14% ink | 20% white | Dividers (`--divider`) |
| `--glass-tint` | 50% white | 55% `#0E1118` | A pane's glass |
| `--glass-top` | 56% white | 50% `#12151B` | The header's glass |
| `--field` | 62% white | 8% white | A field's face |
| `--warning` | `#7D5C00` | `#F2C94C` | A warning, a field marked wrong (`--marked`), Held: amber, never the runner's orange |
| `--press-rim` | 50% ink | 45% white | The edge of something you press, at rest (a check's box, a toggle's slot): 3:1 or more |
| `--backdrop-*` | warm grays | warm graphites | Zaisma's own backdrop: its still, and the colors a page's own scene is drawn in |

The same in both:

| Token | Value | Use |
| --- | --- | --- |
| `--run` / `--run-hi` / `--run-lo` | `#F7931A` / `#FFB24A` / `#A85A06` | The runner, the current tab's line, focus |
| `--on-run` | `#14171C` | Words and marks on an orange face (the runner, a ticked box), in both themes: 7.8:1 against it |
| `--focus-on-run` | `#7A4100` | Focus on an orange face (the runner, a toggle that's on): 3.5:1 against it |
| `--danger` | `#D93A2B` | Only a delete's confirm step |
| `--display` | Jost (self-hosted) | Headings and everything you press or read at a glance |
| `--body` | the system font | Paragraphs |
| `--spring` | `cubic-bezier(.3, 1.2, .4, 1)` | Slabs that slide |

Fields are 16px on phones, so a phone never zooms in on them.

## Theme

Light or dark, and nothing else to set. It follows the device unless a signed-in player fixes it on their account page (Settings, Theme: System, Light or Dark). The server writes the choice on the page as `data-theme-choice` on `<html>` (`system`, `light` or `dark`; guests always get `system`), and CSS follows it with media queries, so there's no flash. `THEME_SCRIPT` (`html.ts`) sets `data-theme` to what's showing and tells scripts through `window.zaismaTheme` (`now()`, `choice()`, `onChange(fn)`).

The theme changes only Zaisma's own backgrounds, and so the glass over them. A game's own background keeps its own glass whatever the theme: a dark game smokes the glass over it (`.smoke`) in light mode too.

## Glass

One glass, defined once in `foundations.ts`, at any size from a button's face to the header.

- **A slab** (`class="glass"`): a tint, the page's hue, a sheen brightest at the top left, a blur and saturation of what's behind.
- **The drawn rim** (`data-glass`, with `data-glass-corners`): `GLASS_SCRIPT` draws an `svg.edge` sized to the slab: a dark hairline, a polished edge, a bevel band and bright cut facets. Smoked glass keeps to that edge, drawn fainter than light glass's, with no caustics (`--edge-caustic` is clear): on dark glass the light gathered inside the bevel reads as a glow fanning in from the rim, blurring the edge against what sits near it.
- **Adaptive:** light glass over light things, smoked glass over dark ones, and the words switch with it. The faintest words keep 4.5:1 and the main words 6:1 against the harshest quarter of what's behind. The backdrop is measured as a whole, once, and every piece of glass over it takes the same glass, so a game's glass never changes with a frame of its shader and no pane picks its own. A game's background is measured when it's added (a picture) or checked (a shader's still) and keeps its tone, its average color and its glass (`apps/site/src/background-tone.ts`), so the home opens on the game's color with its glass already right.
- **The hue** (`--glass-hue`): a studio's color can tint every piece of glass under where it's set; glass tinted for a brand keeps its own color.
- **A component only sets the glass's variables** (its tint, a layer); it never paints glass of its own. `test/site/design.test.ts` checks it.

## Shapes

- **Cut corners, never rounded.** Panes are cut 18 and 14 (`--pane-cut-large`, `--pane-cut-small`), the header 16 and 12, menus 14 and 12, the same on a phone. Fields and buttons slant 10px where they meet another (`--control-slant`).
- **The edge rule: bevels come from where a thing sits, never from the thing.** In the components (`apps/site/src/components/`), only a pane has corners of its own (`data-glass-corners="pane"`, `"header"` or `"menu"`, or four corners such as `"pane-large pane-small 0 0"`). Everything inside, whether a control or a color swatch, carries `data-cut-line`, and the edge rule (`GLASS_SCRIPT` in `foundations.ts`) gives it its shape as `--cut-shape`, the only thing its CSS clips to:
  - **In a pane's middle, it's square.** A swatch in the middle of the color pane.
  - **Near a pane's corner, it follows that corner at a fixed gap:** its cut sits as far from the pane's cut as its sides sit from the pane's sides (a cut of the pane's, less (2 − √2) times the gap). A full-width button alone in a pane is cut at all four corners. The swatch in the color pane's top left is cut only there.
  - **Beside another in a row, it slants toward it** (Row, `--control-slant`): Play and Details.
  - **Stacked, it's square between.** The sign-in buttons are cut only at the stack's top and bottom. In a pane that scrolls inside itself, gaps are measured against the whole scrolled content, so how far it's scrolled never changes a cut.
  - **On no pane, it's cut as if it were in one:** 16 and 8.
  - **The gap holds however small the box,** up to half its short side, where two cuts on one side would meet. On no pane, a cut is never more than a quarter of its short side.

  Its outline (a swatch's line, focus) is the cut line's stroke, so it follows the same shape. **Anything with an edge follows it, with nothing to mark:** a picture, a cover, a profile picture, any filled, bordered or shadowed box, and a slab of glass with no corners of its own (a picture's frame) take a pane corner's cut where they sit in one, and are square in the middle (`cutEdged` and `fitCuts` in `glass-script.ts`). Only what has no edge is left alone: words, a bare icon, a line or a mark thinner than 6px (a divider, an underline, a chart's line, a loader), a glow or shadow on its own. In a picture row each picture lies over the next with a small shadow (`--picture-shadow`). The few shapes that aren't the rule's (the scroll rail, tags, a cover's line, the glass demo's backdrop shapes) are named, with their reason, in `HAND_CUT` in `test/site/design.test.ts`. The gallery's Cut shapes shows each case.

## Spacing

Applies to the components (`apps/site/src/components/`) and the gallery (`apps/site/src/design-page.ts`). Every gap, padding and margin is one of the spacing tokens below, defined once in `tokens.ts`; a page never sets one, since the layout components pick them (see Layout). Pick one by looking at what sits on each side of the space, never by judging how close two things feel.

- A **control** is anything from Actions & Inputs (a button, a field, a switch, the birthday picker).
- **Words** are a heading, a label, a legend, a hint, an error or a line of text.
- A **block** is a group of controls with their words (a labeled field, the sign-in buttons), a paragraph, a picture, or a pane.

| Token | What's on each side | Value |
| --- | --- | --- |
| `--gap-control-row` | Two controls side by side (Play and Details, Light and Dark), measured between their slants: their boxes sit `--gap-control-row-boxes` apart, overlapping by `--control-slant` (10px) less this | 4px |
| `--gap-control-stack` | Two controls stacked (the passkey, Google and Discord buttons) | 8px |
| `--gap-words-control` | A control and the words that belong to it (a field's label above it, its error under it) | 8px |
| `--gap-words-words` | Words beside or under other words in one block (a title and the line under it, links in a row, an icon and its word) | 8px |
| `--gap-block-block` | Two blocks: inside a pane, two panes side by side or stacked, the gallery's examples, a row of covers | 24px |
| `--pad-pane` | A pane's edge and its words (its margin); also the page's edge | 24px, 20px on a phone |
| `--pad-frame` | A pane's edge and anything with an edge of its own in it (a control, a field, a table, a cover, an inner pane): the frame gap, also the gap kept from a cut corner | 8px |
| `--pad-words` | How much further in than the frame gap words sit, so they keep the pane's margin: `--pad-pane` less `--pad-frame` (0 inside a slab) | 16px, 12px on a phone |
| `--pad-inside-words` | What has an edge and words inside it (a field, a list's rows, a table's cells, a choice card) and those words, so at the frame gap they line up with the pane's words: `--pad-pane` less `--pad-frame` | 16px, 12px on a phone |
| `--pad-inner-pane` | An inner pane's edge and what's inside it (the birthday picker, a dropdown), and a bar's: a pane one row of controls tall (the header, the gallery's bar) | 12px |
| `--pad-tray` | A tray's edge and what's on it: closer than a pane's, still clear of its cut foot | 16px |

- **If either side is a block, it's `--gap-block-block`,** even when the other side is a single control.
- **In a pane, controls fill its width.** A row of them is a Row (`layout.ts`), which shares the pane's width between them, so its ends fit the pane's edges by the edge rule instead of stopping short with square corners.
- **The row's gap is the edge rule's neighbor distance.** Two controls side by side with their boxes `--gap-control-row-boxes` apart slant toward each other by `--control-slant`; any other distance and they don't. A row of controls uses `--gap-control-row-boxes`, a stack `--gap-control-stack`.
- **More room is a multiple of a token**, in `calc` (the gallery's sections are two `--gap-block-block` apart). Never a new number.
- **What isn't spacing keeps its own number:** a control's inside (its words and icon to its own edge, set by each control size), a control's own parts (a switch's tabs and the inset round its slab, the birthday's wheels, a list of places), room to scroll or for a scrollbar, and where a small mark sits on what it marks. Each one is named, with its reason, in `NOT_SPACING` in `test/site/design.test.ts`.

`test/site/design.test.ts` checks both: no other number in any gap, padding or margin, and every row of controls `--gap-control-row-boxes` apart and every stack `--gap-control-stack` apart.

## Layout

A page is components put together by the layout components (`apps/site/src/components/layout.ts`, the gallery's Layout group), like any other component. They pick every gap from the spacing table by what's on each side, so nobody passes one, and they go by the room they're given (container queries), never the window's, so a component built once holds wherever it's put.

**One rule, two margins.** In a pane, what has an edge of its own sits at the frame gap (`--pad-frame`), and words keep the pane's margin (`--pad-pane`), `--pad-words` further in. That holds at the pane's edges, its corners and inside rows, and inside what has an edge too: a field, a list's rows, a table's cells and a choice card keep their words `--pad-inside-words` in, so a heading over a field lines up with the field's words, not its box.

**Words beside a control sit on its center line.** In a row, and beside a pane's corner control, the words' first line is centered on the control (their last line, where the row is held down: on a field's boxes, at a pane's foot), so a heading beside a button lines up with it however many lines it runs to. At a pane's top edge that puts the heading a little higher than the margin, level with the control that takes the corner's cut. A pane's head sets its heading beside its corner control and its other words under both, at the pane's whole width.

Say what each thing is, since the spacing and margins come from it (`LayoutItem`):

- **words:** a heading, a line, a paragraph, a link in words. They keep the pane's margin.
- **control:** one control, from a control's own function (a button, a field, a switch), which returns a `ControlMarkup` with its size class. A paragraph can't be passed as one: the compiler refuses it.
- **block:** anything with an edge of its own or a group (a banner, a table, a cover, a row, another stack).

| Component | For |
| --- | --- |
| `stack` | Things one under another: a pane's heading, its lines, its fields and its button |
| `row` | Things side by side, sharing the width `equal` (each as wide as the widest, wherever it is), `lead-fills` (the first takes the rest) or `fit` (placed at the `start`, `end`, `center` or `between`). Its controls take the tallest one's height: `small` 36, `regular` 44, `field` 52, `big` 56 (48 on a phone), and words beside them sit on their center line. A row that can't fit on one line becomes a stack of its controls, each filling its line (`ROW_LAYOUT_SCRIPT`) |
| `grid` | Cells of one size, as many to a line as fit their least width (`itemSize`: `cover`, `card`, `figure`) |
| `track` | A row of covers that scrolls sideways; under a heading with its Row arrows it's a Shelf |
| `columns` | Two halves of the width side by side, one over the other below two columns of 360px; one may stay in view while the other scrolls (`stickyColumn`) |
| `paneParts` | A pane's head, body and foot, with one control in its top or bottom end corner; the head's heading beside its control, its other words under both |

- **A pane is `full` or `fit`.** Full is as wide as what holds it; fit is as wide as what's in it, its paragraphs running to a reading width at most (`--size-reading`, 60ch). A pane that should take half the screen is a column of `columns`. A sheet fits what's in it too.
- **Widths are named, never numbers:** a grid's `--size-cover`, `--size-card` and `--size-figure`, a track's covers, the reading width, and shares.
- **`npm run layout:check`** opens every page in `CHECKED_PAGES` (`apps/site/src/components/checked-pages.ts`) in headless Chrome at 320 × 667 and 1440 × 900, light and dark, and measures it as a person would look at it: the two margins, rows of one height on one line, corner controls in their corners, bevels of at least 4px, nothing spilling or overlapping, the runner above the fold, no sideways scroll. Each failure names the page, the screen, the thing and what was measured. It opens a few pages at once (`--tabs`, one fewer than the cores, at most 4). It must pass for any page change, and GitHub's check runs it in full on every pull request; while you work, `--only <part of a path>` checks just the pages you changed, and the full run is once before you push.

### Screens

`/design/screens?page=/signin` on a local preview shows a page on Julius's phone (320 × 667) and a desktop (1440 × 900), light and dark, side by side, each with what the measuring check finds (`screens.ts`). `page` can be given more than once, to put variants side by side. Pointing at anything in a screen outlines it and says what it is and what placed it: its size class, its layout's gap and why, its pane's width and margins. It's where a page is reviewed, never made: pages are written in code, held by the checks, and judged here, and a remark names the rule to change.

## Type

Applies where Spacing does. Every word outside a control's own inside is set in one of these whole fonts (`font: var(--type-…)`), defined once in `foundations.ts` and shown in the gallery's Type. Pick one by what the words are, never by the size that looks right.

| Token | What the words are | Font |
| --- | --- | --- |
| `--type-title` | A game's title | Jost 600, 40px (32px on a phone) |
| `--type-heading` | A pane's heading | Jost 600, 30px (26px on a phone) |
| `--type-section` | A row's or a section's heading | Jost 600, 22px (20px on a phone) |
| `--type-name` | A name in a pane, a dropdown's head | Jost 600, 17px |
| `--type-label` | A field's label, the question a field answers | Jost 600, 15px |
| `--type-words` | A line of words, an error | Jost 500, 15px |
| `--type-reading` | A paragraph to read | System, 15px |
| `--type-note` | A note under something, the footer | Jost 500, 14px |
| `--type-facts` | Facts under a cover, a caption, a small heading | Jost 500, 13px |
| `--type-tag` | A Tag | Jost 600, 12px |
| `--type-code` | A token or a value | Monospace 600, 13px |

- **Inside words, only the weight changes** (a name in bold in a glance line). Never the size.
- **A control's inside keeps its own font**, set by each control's size (a button's label, a field's text, a tab), like its padding. A picture's initials are sized to the picture. Each one is named, with its reason, in `NOT_TYPE` in `test/site/design.test.ts`.
- **Lines between two parts of one pane are `--divider`**, never a border of their own.

## Small pieces

**Everything derives from the gallery.** Every piece of UI on a page, and on the gallery itself, comes from a gallery component, or is a named exception with its reason in `test/site/design.test.ts`, which fails on anything else:

- **Classes:** every class on a gallery page is styled by a component. The only others are the gallery's own scaffolding (`GALLERY_ONLY`) and hooks with no look (`UNSTYLED_HOOKS`).
- **Placing, not restyling:** the gallery, or a component holding another, may only place it (where it sits, how big its box is) or set the variables it offers (`--logo-height`, `--switch-height`, `--loader-width`). It never restyles it.
- **No hand-drawn pieces:** no source draws its own icon (`OWN_SVG` names the brand marks and the icon set itself), builds a button outside `actions.ts`, or makes a sheet of glass other than a Glass pane or a Tray (`OWN_GLASS` names the pieces made of glass, like a glass button's face).
- **No stale lists:** an exception that's no longer in the code fails the test too, so every list stays exactly the real exceptions.

Anything with a look of its own is a component in the gallery, or part of one, and every page uses that component. Never style one in place.

- **A link in words is a Link** (`textLink`, `actions.ts`): ink, with an orange underline. In a list of links where nothing else is (the footer), it's quiet: plain until pointed at. Anything else you can follow is a control (a button, a tab, a place) or the logo. Only `.link` underlines, and only a control styles a bare link (`LINK_IN_CONTROL` in the test).
- **A tag is a Tag** (`tag`, `foundations.ts`, shown in Data): `new` (Updated, Live), `count` (a number: unread topics on a place), `plain` (words: Replaced, Developer), `warning` (Held, amber) or `glass` (the rail's labels), with an icon before its words where it helps. A version's state is always the same tag, from `VERSION_STATE_TAGS` (`data.ts`).
- **Someone named on a page is a Person** (`person`, `people.ts`): their picture, their name a quiet Link, a line about them and at most one control. What they wrote is a Post; words to read are Reading text (`reading.ts`).
- **A button with only an icon, a small button or a toggle is a Cut button** (`isLabelHidden`, `isSmall`, `isPressed`): the gallery's light and dark button, a password's Show.
- **One of a few colors is a Color picker; one of a few options is a Switch.** The glass button's tint and the glass's hue are Color pickers; light or dark is a Switch.
- **A page's own places down its side are a vertical Switch** (`tabSwitch` with `isVertical`): the same carved well, slab and ghost as the horizontal one, stacked, with an icon and a count per place. There's no sidebar of its own.
- **A short list hanging from a button is a Dropdown** (`dropdown`, `panes.ts`), with its own choices: the account menu is one.
- **Zaisma's logo is the Logo** (`logo`, `foundations.ts`): the wordmark at the top of a page, the mark in the footer, always a link home.
- **Waiting is the Loader** (`loader`): the Z building itself (`brand/loader/`). Every button shows it in place of its icon or arrow once it's pressed and waiting (`isBusy`, and `BUSY_SCRIPT` for a form sent or a page opening), and can't be pressed twice.
- **What belongs to a pane sits on its Tray** (`tray`): the same glass as the pane, only thinner and muted (a clearer tint, a fainter sheen, less blur, a fainter rim with the same bevel, smaller cuts at its foot, and `--pad-tray` instead of `--pad-pane`), so the pane stands out and the tray stays in the background. It runs on from the pane with no rim along its top (`data-glass-open="top"`). Every gallery section is one. What's on a tray fits it like anything on a pane: square under its square top, cut at an even gap into its cut foot. A gallery example's stage (`data-on-no-pane`) shows what's in it on no pane, though the stage sits on a tray.
- **A switch that scrolls is a framed Switch** (`isFramed`), which draws its own carved frame: the header's tabs, the gallery's groups on a phone. Its tabs can fold away (`isFoldable`), as the header's Developer and Forum do off a developer page.
- **Online is the Picture frame's** (`isOnline`); **you, signed in, are the Account button.**

## Components

Every component, with the call that makes it and its options, is in the catalog below. It is written from the gallery's registry (`apps/site/src/components`, shown at `/design`) by `npm run design:catalog`, and `test/node/design-catalog.test.ts` fails when it is out of step, so a page's builder, human or AI, can rely on it. A page is built from these and nothing else: find the component here, call its function, and set the options it names. `/design/example` is a small page built that way (`example-page.ts`), held to the same checks as the gallery.

<!-- catalog:start (written by npm run design:catalog from the component registry; don't edit) -->

### Foundations

- **Color**: Every color comes from these tokens, so light, dark and smoked glass follow by themselves. Orange is only for what you act on, and it is always shown in full: never faded or at half opacity.
- **Type**: Every word outside a control's own inside is set in one of these, picked by what the words are. Jost for display, the system's own face for reading; fields are 16px or more, so phones don't zoom in.
- **Glass**: Zaisma's interface is glass over the game or the page's backdrop, never over a plain color. It's as thin as the words allow: light with dark words, or smoked with light words.
- **Backdrop** (`backdrop(options?: BackdropOptions)`, `foundations.ts`): Glass is never on a plain or solid color: there's always something behind it, still or moving. A game is its own backdrop; Zaisma's pages have Zaisma's own, a sheet of satin whose folds sway slowly in a soft light, or their own shader or 3D scene.
  - `options`: `fragmentShader?: string`, `isGlassAdaptive?: boolean`, `isScene?: boolean`, `isFramed?: boolean`, `standInSlug?: string`
- **Shader background**: A background written as a shader: one small function that paints each pixel from the time and the screen's size, in the form AI writes well. From a few lines for a sky to a whole city in the rain. Zaisma's runner draws it small, at most 30 frames a second, holds a still frame on a device that can't keep up, and bends the light under the glass for any shader: what's behind each pane magnified and bent as through thick glass, with light gathered along its cut edge.
- **Game background** (`gameBackgroundFrame(options: GameBackgroundFrameOptions)`, `foundations.ts`): A game's own world behind the glass, on its page and behind it on the home: a picture or a shader its developer sends, for wide screens and phones. It's the game's art, never restyled to Zaisma's look, and the glass over it turns light or smoked to keep the words clear. Until real games bring theirs, the stand-in games have these.
  - `options`: `standInSlug: string`, `title: string`, `note: string`
- **Icons** (`icon(name: IconName)`, `icons.ts`): Thin line icons in the words' color, so a kind of fact can be found without reading. Never decoration.
- **Logo** (`logo(kind: "wordmark" | "mark")`, `foundations.ts`): Zaisma's logo, always a link home: the wordmark at the top of a page, the mark alone in the footer. Drawn in the words' color, never restyled.
- **Loader** (`loader()`, `foundations.ts`): The Z building itself: what a button shows once it's pressed and waiting, a form sent or a page opening. Only ever after you press something.
- **Cut shapes**: Corners are cut, never rounded: 18 and 14 on panes, 16 and 12 on the header, 14 and 12 on menus. Controls follow the edge rule: a slant only beside another control in a row, and every other corner fits what holds it.
- **Page settings**: Every page has one set of settings that all its components follow: light or dark, and each component's own, like the glass's hue. One change covers every instance at once, and a page only carries the ones its components use.
- **Motion**: Things move only when pointed at, pressed or chosen: a slab springs across on the spring curve (--spring) in 0.55s, 0.4s for a small one, and a change of size takes 0.45s. Reduced motion stops all of it.
- **Spacing**: Every gap, padding and margin is one of these tokens, picked by what sits on each side of it, never by how close two things feel. A control is anything from Actions & Inputs; words are a heading, label or line; a block is a group of controls with their words, a paragraph, a picture or a pane. If either side is a block, it's --gap-block-block. More room is a multiple of one, never a new number.
- **City** (`cityStage(options?: CityStageOptions)`, `city.ts`): Zaisma's own live 3D scene, where signing in and making an account happen: one city in an endless sea on a slow cinematic loop, its orange shapes and sea there to tap. Under reduced motion, without WebGL or on a device that can't keep it smooth, a still of the same city stands in, with everything in place.
  - `options`: `isFramed?: boolean`

### Layout

- **Stack** (`stack(options: StackOptions)`, `layout.ts`): Things one under another: a pane's heading, its lines, its fields and its button. Each gap is picked from what's on each side, so you never pass one; say what each thing is (words, a control, a block) and the stack spaces it.
  - `options`: `items: LayoutItem[]`, `label?: string`
- **Row** (`row(options: RowOptions)`, `layout.ts`): Things side by side. Say how they share the width: equal, the lead fills (the others fit their words), or each fits at the start, the end, the middle or both ends. Controls in a row are always one height, the tallest one's, and slant toward each other.
  - `options`: `items: LayoutItem[]`, `widths: "equal" | "lead-fills" | "fit"`, `alignment?: "start" | "end" | "center" | "between"`, `label?: string`
- **Grid** (`grid(options: GridOptions)`, `layout.ts`): Cells of one size, as many to a line as fit: covers, cards, figures. Say what a cell holds and the grid sizes it; it folds to fewer columns as it narrows, to one on a phone, by its own width.
  - `options`: `items: LayoutItem[]`, `itemSize: "cover" | "card" | "figure"`, `label?: string`
- **Track** (`track(options: TrackOptions)`, `layout.ts`): A row of covers that scrolls sideways, fading at an edge with more past it, a few showing with the next peeking in. Under a heading row with its Row arrows, it's a shelf.
  - `options`: `id: string`, `items: LayoutItem[]`, `itemSize: "cover"`, `label?: string`
- **Columns** (`columns(options: ColumnsOptions)`, `layout.ts`): Two halves of the width side by side, like a game's details beside its rooms and updates. A pane takes the whole width or fits what's in it, so one that should take half the screen goes in a column. One column can stay in view while the other scrolls; they go one over the other where both can't have room.
  - `options`: `columns: [Raw, Raw]`, `stickyColumn?: "first" | "second"`
- **Pane parts** (`paneParts(options: PanePartsOptions)`, `layout.ts`): A pane's places: its head (words, and one control in its top corner), its body and its foot (something at the start, one control in its bottom corner). A corner control sits in the corner and takes its cut.
  - `options`: `head?: { words: Raw; end?: LayoutControl }`, `body: Raw`, `foot?: { start?: LayoutItem; end?: LayoutControl }`
- **Screens** (`screens(options: ScreensOptions)`, `screens.ts`): One page on a phone at 320 × 667 and a desktop at 1440 × 900, light and dark, side by side, each with what the measuring check finds. Point at or tap anything in a screen to see what it is and which rule placed it. It's where a page is reviewed, never made: the Screens page shows any page this way on a local preview.
  - `options`: `path: string`, `title: string`

### Actions

- **Runner button** (`runButton(label: string, options?: RunButtonOptions)`, `actions.ts`): The one thing to do on a screen: Play, Sign in, Next. Never more than one in view, and visible without scrolling.
  - `options`: `href?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `isAutofocused?: boolean`, `isBig?: boolean`, `isFullWidth?: boolean`, `isBusy?: boolean`, `busyLabel?: string`, `icon?: IconName`, `isDisabled?: boolean`, `state?: ButtonState`
- **Cut button** (`cutButton(label: string, options?: CutButtonOptions)`, `actions.ts`): Everything else you can press: Details, Make an account, Cancel. A delete is a cut button too, never orange; only its confirm step turns red.
  - `options`: `href?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `isAutofocused?: boolean`, `icon?: IconName`, `isLabelHidden?: boolean`, `isFullWidth?: boolean`, `isBusy?: boolean`, `state?: ButtonState`, `isBig?: boolean`, `isSmall?: boolean`, `isInWell?: boolean`, `isDisabled?: boolean`, `isPressed?: boolean`, `reactionCount?: number`, `controls?: string`, `isExpanded?: boolean`, `isHidden?: boolean`
- **Glass button** (`glassButton(label: string, options: GlassButtonOptions)`, `actions.ts`): Another way in, like a passkey, Google or Discord: below the runner, never instead of it. Or an action floating on a world with no pane under it.
  - `options`: `href?: string`, `type?: "submit" | "button"`, `icon: keyof typeof WAY_ICONS | IconName`, `tint?: GlassTint`, `isDisabled?: boolean`, `isBusy?: boolean`, `state?: ButtonState`
- **Guest button** (`guestButton(label: string, options?: { … })`, `actions.ts`): The quietest way on, like Continue as guest: words and an arrow below the glass buttons, a slab only once you point at it.
  - `options`: `href?: string`, `type?: "submit" | "button"`, `state?: ButtonState`, `isBusy?: boolean`
- **Text button** (`textButton(label: string, options?: TextButtonOptions)`, `actions.ts`): The quietest thing to press, words alone: Skip for now, Show all, Undo. Beside a cut button it's the way out; never the one thing to do.
  - `options`: `href?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `icon?: IconName`, `isDisabled?: boolean`, `isBusy?: boolean`, `state?: ButtonState`
- **Delete button** (`deleteButton(label: string, options: DeleteButtonOptions)`, `actions.ts`): Deleting a game, a key, an account: a cut button, never orange. Only its confirm step turns red, the one red in Zaisma, after one sentence on what goes.
  - `options`: `action: string`, `confirmLabel: string`, `confirmText: string`, `id?: string`, `isFullWidth?: boolean`, `state?: ButtonState`, `isConfirmShown?: boolean`, `isConfirmBusy?: boolean`
- **Link** (`textLink(words: string, href: string, options?: TextLinkOptions)`, `actions.ts`): Words that go somewhere: underlined in orange inside a sentence, plain in a list of links until you point at them. Anything you press that isn't words is a button.
  - `options`: `isQuiet?: boolean`, `state?: "is-pointed" | "is-focused"`

### Inputs

- **Cut field** (`cutField(options: CutFieldOptions)`, `fields.ts`): Anything you type: a username, an email, a password. Its icon says what goes in; what's wrong is said under it, in words.
  - `options`: `name: string`, `label: string`, `type: "text" | "email" | "search" | "password"`, `icon?: IconName`, `id?: string`, `text?: string`, `placeholder?: string`, `autocomplete?: string`, `isRequired?: boolean`, `error?: string`, `hint?: string`, `inputMode?: "numeric"`, `isPasswordShown?: boolean`, `isReadOnly?: boolean`, `isDisabled?: boolean`, `state?: "is-focused"`
- **Search field** (`searchField(options: SearchFieldOptions)`, `fields.ts`): Search on a page, and in the header. "/" jumps to it there, and nothing says so.
  - `options`: `action: string`, `name: string`, `searchText: string`, `placeholder: string`, `label: string`, `keep?: Record<string, string>`, `state?: "is-focused"`
- **Birthday field** (`birthdayField(options: BirthdayFieldOptions)`, `fields.ts`): Asking for a birthday: three wheels that start blank, so nothing suggests an age.
  - `options`: `name: string`, `label: string`, `id?: string`, `birthday?: string`, `hint?: string`, `error?: string`, `state?: "open" | "marked" | "is-focused"`, `isRequired?: boolean`
- **Date and time field** (`dateTimeField(options: DateTimeFieldOptions)`, `fields.ts`): Picking when something happens, like a version going live: the birthday field's wheels for the day, the hour (with its AM or PM) and the minute, in your own time zone, which it says.
  - `options`: `name: string`, `label: string`, `id?: string`, `pickedAt?: string`, `minimumAt?: string`, `error?: string`, `state?: "open"`
- **Switch** (`tabSwitch(options: { … })`, `switch.ts`): Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small). Stacked, it's a page's own places down its side.
  - `options`: `label: string`, `tabs: SwitchTab[]`, `switchSize: "big" | "small"`, `isFramed?: boolean`, `isVertical?: boolean`
- **Color picker** (`colorPicker(options: { … })`, `foundations.ts`): Pick one color from a few: a glass button's tint, the glass's hue. Plain swatches in a carved well, like the switch's tabs; the picked one keeps its whole color, with an orange bar under it, and is named beside them.
  - `options`: `label: string`, `choices: ColorChoice[]`, `pickedValue: string`, `focusedValue?: string`, `extra?: Raw`
- **Long field** (`longField(options: LongFieldOptions)`, `choices.ts`): More than a line of words: a game's description, patch notes, a reply. It grows with what's written, and counts the characters only once the limit is near.
  - `options`: `name: string`, `label: string`, `id?: string`, `text?: string`, `placeholder?: string`, `rowCount: number`, `maximumCharacterCount?: number`, `hint?: string`, `isRequired?: boolean`, `isDisabled?: boolean`, `error?: string`, `state?: "is-focused"`
- **Select field** (`selectField(options: SelectFieldOptions)`, `choices.ts`): One of many, from a list: a region, a language, a category. It opens a list of Zaisma's glass under the field, on every device. For one of a few, use Choice cards or a Switch.
  - `options`: `name: string`, `label: string`, `choices: SelectChoice[]`, `pickedValue?: string`, `placeholder?: string`, `id?: string`, `icon?: IconName`, `isDisabled?: boolean`, `error?: string`, `state?: "is-focused" | "is-open" | "is-open-above"`
- **Check field** (`checkField(options: CheckFieldOptions)`, `choices.ts`): A yes or no sent with its form: I agree, Email me replies. A small carved box that turns orange with a dark tick. On a page that saves at once, use a Toggle.
  - `options`: `name: string`, `label: string`, `isChecked?: boolean`, `hint?: string`, `checkValue?: string`, `isRequired?: boolean`, `error?: string`, `isDisabled?: boolean`, `id?: string`, `state?: PressState`
- **Choice cards** (`choiceCards(options: ChoiceCardsOptions)`, `choices.ts`): One of a few, when each needs a line to say what it means: who can see a game, how its rooms run. Compact for many (a report's reasons): close together down a carved well that scrolls. The picked one is the raised white slab with the orange line; the rest sit carved and quieter.
  - `options`: `name: string`, `label: string`, `choices: ChoiceCard[]`, `pickedValue?: string`, `id?: string`, `isCompact?: boolean`, `error?: string`, `isDisabled?: boolean`, `state?: PressState`
- **Toggle** (`toggle(options: ToggleOptions)`, `choices.ts`): On or off for a setting: Cloud saves, Show me online. A white slab that springs across a carved slot, which fills orange when it's on. It's a checkbox in its form, so it posts without a script.
  - `options`: `name: string`, `label: string`, `isOn: boolean`, `hint?: string`, `isBusy?: boolean`, `isDisabled?: boolean`, `id?: string`, `state?: PressState`
- **Slider** (`slider(options: SliderOptions)`, `inputs.ts`): A number on a scale: players in a room, a volume. Dragged, tapped or stepped with the arrow keys; the number shows with its unit as it moves. There are no knobs: this covers them.
  - `options`: `name: string`, `label: string`, `minimumNumber: number`, `maximumNumber: number`, `stepNumber: number`, `pickedNumber: number`, `unit: string`, `isDisabled?: boolean`, `id?: string`, `state?: "is-focused" | "is-pressed"`
- **File drop** (`fileDrop(options: FileDropOptions)`, `inputs.ts`): Handing over files: a game's build, a cover, a screenshot for a report. Drop them on it, tap it, or reach it by keyboard; what's picked is listed with its size.
  - `options`: `name: string`, `label: string`, `accept: string`, `isMultiple?: boolean`, `hint: string`, `maximumByteCount?: number`, `error?: string`, `pickedFiles?: FileDropFile[]`, `isDisabled?: boolean`, `id?: string`, `state?: "over"`
- **Code field** (`codeField(options: CodeFieldOptions)`, `inputs.ts`): Code to copy and keep: an API key shown once, a game's address, an upload command. It's read-only, in code's own letters, with a Copy button at its end.
  - `options`: `label: string`, `code: string`, `id?: string`, `state?: "is-focused" | "is-copied"`

### Navigation

- **Header** (`header(options: HeaderOptions)`, `navigation.ts`): The top of every page: Zaisma, where you are, search when the page has one, and you. It floats as glass and slims once the page scrolls.
  - `options`: `current: HeaderTab | null`, `search?: Omit<SearchFieldOptions, "state">`, `account?: { username: string; pictureMarkup: Raw } | null`, `isOnDeveloperPage: boolean`, `isOnSignInPage?: boolean`, `ownTabs?: SwitchTab[]`, `yourGamesHref?: string`, `hasPageRunner?: boolean`, `isCompact?: boolean`, `isMenuOpen?: boolean`, `isSearchOpen?: boolean`, `id?: string`
- **Account button** (`accountButton(options: AccountButtonOptions)`, `navigation.ts`): You, at the header's end once you're signed in: your picture alone is the button, online, as tall as the controls beside it. It opens the account menu, which names you.
  - `options`: `username: string`, `pictureMarkup: Raw`, `menuId: string`, `isMenuOpen?: boolean`, `state?: "is-pointed" | "is-pressed" | "is-focused"`
- **Footer** (`footer()`, `navigation.ts`): The end of every page: for game developers, the forum, the source and the rules.
- **Rail** (`rail(scrollKind: "box" | "page" | "side")`, `navigation.ts`): Zaisma's own scrollbar, on every device: it rests faintly and wakes while things move. On a touch screen its thumb is a little wider and drags with a finger.
- **Row arrows** (`rowArrows(options: RowArrowsOptions)`, `navigation.ts`): Scrolling a row of games with a mouse or trackpad: two raised slabs in a carved well. At a row's end that arrow lies flat; touch screens swipe instead.
  - `options`: `rowName: string`, `trackId: string`, `scrolledTo?: "middle" | "end"`
- **Shelf** (`shelf(options: ShelfOptions)`, `navigation.ts`): A row of games under its heading: the home's Popular, Trending and Continue playing. Its sort and its arrows sit at the heading's end; its covers scroll sideways, a few showing with the next peeking in.
  - `options`: `id: string`, `trackId: string`, `title: string`, `titleHref?: string`, `sortTabs?: SwitchTab[]`, `items: LayoutItem[]`, `emptyText?: string`, `scrolledTo?: "middle" | "end"`
- **Section tabs** (`sectionTabs(options: SectionTabsOptions)`, `navigation.ts`): A page's own sections, under its title: a game dashboard's Overview, Versions and Players, a profile's Games and Friends. On a phone they scroll sideways, fading at the edge with more.
  - `options`: `label: string`, `tabs: SectionTab[]`
- **Load more** (`loadMore(options: LoadMoreOptions)`, `navigation.ts`): Under a long list (versions, players, topics): the next page added in place, busy while it comes. Without scripts it's a link to that page.
  - `options`: `href?: string`, `label: string`, `listId: string`, `endText?: string`, `isFailed?: boolean`
- **Breadcrumbs** (`breadcrumbs(options: BreadcrumbsOptions)`, `reading.ts`): Where a page sits: the pages above it as quiet links, a chevron between, this one last. For pages a few levels deep, like a forum topic or a game's version. On a phone it scrolls sideways rather than wrapping.
  - `options`: `trail: { label: string; href: string }[]`, `current: string`
- **Pager** (`pager(options: PagerOptions)`, `reading.ts`): Newer and Older under a list read a page at a time, like a topic's replies. The end you're at can't be pressed. A list you add to in place has Load more instead.
  - `options`: `label: string`, `newerHref?: string`, `olderHref?: string`

### Panes

- **Glass pane** (`glassPane(options: GlassPaneOptions)`, `foundations.ts`): A sheet of glass that holds a task: signing in, a game at a glance, a form. It's as wide as what holds it, or as wide as what's in it, its paragraphs running to a reading width at most; never a width of its own. Its content scrolls inside it rather than shrinking.
  - `options`: `paneWidth: "full" | "fit"`, `body: Raw`, `label?: string`
- **Tray** (`tray(options: { … })`, `foundations.ts`): A thinner, clearer sheet a pane extends into, holding everything that belongs to it: the pane's words on top, what they're about on the tray beneath, read as one. Every gallery section is one.
  - `options`: `head: Raw`, `body: Raw`, `label?: string`, `paneWidth?: "full" | "fit"`
- **Dropdown** (`dropdown(options: DropdownOptions)`, `panes.ts`): A short list of choices that hangs from a button, like the account button's in the header: with a head, rules, icons, counts and the current one, as each needs. A choice that's hard to take back asks first, in a confirm sheet.
  - `options`: `id: string`, `label: string`, `head?: { title: string; note?: string }`, `items: DropdownItem[]`, `isOpen?: boolean`
- **Game cover** (`gameCover(options: GameCoverOptions)`, `panes.ts`): A game in a list: the studio's art, bare, with only what concerns you under it. Zaisma's mark stands in while the art loads, and for a game with none yet.
  - `options`: `title: string`, `imageUrl: string | null`, `href: string`, `facts: GlanceFacts`, `isCurrent?: boolean`, `isEager?: boolean`, `hasHighPriority?: boolean`
- **Sheet** (`sheet(options: SheetOptions)`, `panes.ts`): A task that comes and goes over the page: report a game, block someone, add a key. Opened by a button that names it; Esc, its close button or a press beside it close it, and it drops away as it goes in every browser (it stays open while it leaves, so no browser drops it early or draws it out of place). Its title, Close and its buttons stay in view while the rest scrolls.
  - `options`: `id: string`, `title: string`, `body: Raw`, `closeLabel: string`, `buttons?: ControlMarkup[]`, `action?: string`, `placement?: "center" | "foot"`, `isShown?: boolean`
- **Confirm sheet** (`confirmSheet(options: ConfirmSheetOptions)`, `panes.ts`): One sentence, the action and Cancel, before something that's hard to take back: signing out everywhere, ending a room. A delete's confirm is Delete button's own, the only red one.
  - `options`: `id: string`, `title: string`, `text: string`, `action: string`, `confirmLabel: string`, `isBusy?: boolean`, `isShown?: boolean`
- **Notice** (`notice(options: NoticeOptions)`, `panes.ts`): A moment that just happened, just under the header: Saved, Copied, or what went wrong. A done one leaves by itself after 4 seconds (8 with Undo); a problem stays until it's closed. Two at once stack.
  - `options`: `text: string`, `tone: "done" | "problem"`, `undoAction?: string`, `isInPlace?: boolean`
- **Banner** (`banner(options: BannerOptions)`, `panes.ts`): Something that holds while you're on a page, across the top of its content: you're playing as a guest, a version is held, Zaisma's news on the home. A line of words, at most one button, and a Close for what a player can put away.
  - `options`: `text: string`, `icon?: IconName`, `action?: { label: string; href?: string; formAction?: string }`, `closeLabel?: string`, `tone?: "plain" | "warning"`
- **Step flow** (`stepFlow(options: StepFlowOptions)`, `panes.ts`): A task in a few steps, like protecting your account: a pane with a thin step line across its top that fills in orange as you go, the step you're on ending in light, and Back and Next.
  - `options`: `steps: StepFlowStep[]`, `currentIndex: number`, `body?: Raw`, `action: string`, `finishLabel?: string`, `backHref?: string`, `paneWidth?: "full" | "fit"`
- **Folded part** (`foldedPart(options: FoldedPartOptions)`, `reading.ts`): Something that belongs on the page but out of the way, behind its title and how many are in it: earlier versions, blocked people, preview links. Pressing the title opens it in place.
  - `options`: `title: string`, `entryCount?: number`, `body: Raw`, `isOpen?: boolean`, `id?: string`
- **Divider with words** (`dividerWords(words: string)`, `reading.ts`): A hairline across a pane with a word or two in its middle, between two ways to do one thing: or, between signing in with a password and with a passkey.

### Data

- **Picture frame** (`pictureFrame(username: string, pictureSize: PictureSize, options?: { … })`, `data.ts`): An account's picture, always in its frame of glass: in the account button, beside a friend's name, at the head of a profile.
  - `options`: `presence?: "online" | "playing"`, `isCut?: boolean`
- **Picture row** (`pictureRow(usernames: string[], pictureSize: PictureSize)`, `data.ts`): Friends' pictures together: front to back, each lying over the next with a small shadow, all square. Past three, the rest are a +N.
- **Tag** (`tag(words: string | number, tone: TagTone, options?: { … })`, `foundations.ts`): A few words or a number carved into what they label, slanted at both ends: Updated on a game, the count of unread topics on a place, a version's state. On glass, a mark's name on the rail.
  - `options`: `icon?: IconName`
- **Glance facts** (`glanceFacts(facts: GlanceFacts)`, `data.ts`): What concerns you about a game at a glance: players now, friends playing, when you played, an update. Only what's true, one line each.
  - `facts`: `playerCount?: number`, `playedAtMs?: number`, `updatedAtMs?: number`, `updatesHref?: string`, `friends?: { username: string }[]`
- **List rows** (`listRows(options: { … })`, `data.ts`): A list of things on glass, one a row with hairlines between: versions, keys, topics, players. A row that goes somewhere is a link as a whole, ending in a chevron that steps on as you point; a row to read may end in a button.
  - `options`: `rows: ListRow[]`, `id?: string`, `label?: string`
- **Empty state** (`emptyState(options: StateNoteOptions)`, `data.ts`): Where a list has nothing yet: what will be here, how it gets here, and the button that starts it. In the voice, never a picture.
  - `options`: `title: string`, `text: string`, `action?: ControlMarkup`
- **Problem state** (`problemState(options: StateNoteOptions)`, `data.ts`): Where content couldn't come: what went wrong in plain words, and what to do about it, like Try again.
  - `options`: `title: string`, `text: string`, `action?: ControlMarkup`
- **Done state** (`doneState(options: StateNoteOptions)`, `data.ts`): Where a task just ended, in place of it: what was done and what happens next, like a report sent. A moment that passes is a Notice instead.
  - `options`: `title: string`, `text: string`, `action?: ControlMarkup`
- **Loading state** (`loadingState(options: { … })`, `data.ts`): Where content is on its way: a hairline with a light running along it, and what's coming. Never a spinner over content; a button that's waiting shows the loader instead.
  - `options`: `label: string`
- **Table** (`table(options: TableOptions)`, `data.ts`): Rows to compare: versions, requests, players, logs. Its header stays as the rows scroll under it, numbers line up on the right, and on a phone it scrolls sideways rather than folding rows into cards.
  - `options`: `caption: string`, `columns: TableColumn[]`, `rows: (Raw | string)[][]`, `hasRowHeads?: boolean`, `isCompact?: boolean`, `shownRowCount?: number`, `rowsPlaceholder?: Raw`, `id?: string`
- **Numbers** (`numbers(options: { … })`, `data.ts`): A row of figures to take in at a glance: players, hours, plays. Each figure is big, its label sits under it, and how it moved is green when it's good news.
  - `options`: `items: NumberItem[]`
- **Chart** (`chart(options: ChartOptions)`, `data.ts`): How something moved over time, drawn on the page with nothing to wait for: a line or bars on a hairline grid, the last point marked with its number, and any point's number where you point or step with the arrow keys. Or how a whole splits, as a ring with its key. Screen readers get the same numbers.
  - `options`: `label: string`, `points: ChartPoint[]`, `unit: string`, `chartKind?: "line" | "bars" | "ring"`, `pointedIndex?: number`
- **Usage meter** (`usageMeter(options: UsageMeterOptions)`, `data.ts`): How much of an allowance is used: player-hours, requests, storage. A carved track fills in ink, turns amber from 80%, and says so when it's all used, or over.
  - `options`: `label: string`, `usedNumber: number`, `limitNumber: number`, `unit: string`, `resetDate?: string`
- **Reading text** (`readingText(options: ReadingTextOptions)`, `reading.ts`): Words to read: a forum post, the rules, a game's description, its patch notes. Paragraphs in the system's own face, each line at most a reading width long, with headings, lists, quotes, code and tables spaced by what's on each side.
  - `options`: `markup: Raw`, `label?: string`
- **Facts** (`facts(options: FactsOptions)`, `reading.ts`): What something is, in a few short facts, each a quiet label with its words: who a game is for and what it runs on (side by side), or a version's or a key's details (one a line).
  - `options`: `facts: Fact[]`, `arrangement: "across" | "down"`, `label?: string`
- **Progress** (`progress(options: ProgressOptions)`, `reading.ts`): A task on its way that takes a while, like an upload or a scan: a carved track filling in ink as it goes, and how much is done in words. With no end known yet, a light runs along it.
  - `options`: `label: string`, `doneNumber?: number`, `totalNumber?: number`, `unit?: string`
- **Person** (`person(options: PersonOptions)`, `people.ts`): Someone on Zaisma named on a page: a game's developer, a post's author, a friend in a room. Their picture in its frame, their name a quiet link to their profile, a line about them, and at most one thing to do at the end. A list of people is List rows, each led by their picture.
  - `options`: `username: string`, `href: string`, `note?: string`, `pictureSize?: "sm" | "md"`, `presence?: "online" | "playing"`, `marks?: Raw`, `end?: ControlMarkup`
- **Post** (`post(options: PostOptions)`, `people.ts`): What someone wrote: a forum reply, a game's update. Its author and when, the words as Reading text, and what you can do with it at its foot. A list of posts has a hairline between each.
  - `options`: `author: { username: string; href: string }`, `postedAtMs: number`, `body: Raw`, `marks?: Raw`, `actions?: ControlMarkup[]`

<!-- catalog:end -->

How the larger ones behave:

- **Header** (`header`): a floating slab of glass, inset from every edge, that slims as the page scrolls. The logo, the tabs (a framed Switch: Home, and Your games once its page is built), the page's own search when it has one, and you: Sign in (the runner), or your picture and name opening the account menu (Your profile, Friends, Developer, Settings, Sign out). On a developer page (the dashboard, the forum, `/developers`) the Developer and Forum tabs open out of the end of the tabs; leaving folds them away. Pages are separate loads, so the header remembers whether they were open (`sessionStorage` `zaisma-nav`) and opens or folds them from there. On sign-in's pages it holds the logo alone: no tabs and no end. On a phone it's two rows, the logo, search and you on top and the tabs below, but only when two or more tabs show: a row of one tab isn't a choice (the logo already goes home), so a guest's phone header is one row. On a page with a runner of its own (Play, Save), its Sign in is a cut button, so only one runner is ever in view (`hasPageRunner`, set by `layout()`). Its height is `--header-height`, worked out from its rows, and the page starts a block's gap under it. Once the page scrolls it rises and slims to the frame gap round its controls, which keep their size, so only the slab moves.
- **Runner button** (`runButton`): the one orange slab, for the page's main action. Every other button is a Cut button, clear glass with cut ends.
- **Switch** (`tabSwitch`): a carved well with a white slab and the orange line under the one you're on. It's never wider than the room it has: where its tabs don't fit, they keep less room round their words, and a framed one scrolls, snapping to whole tabs, starting where the current one shows whole. On a touch screen it's at least a regular control tall.
- **Rail** (`rail`): Zaisma's own scrollbar, a slim glass thumb on a hairline, for a scrolling box, the page, or a row that scrolls sideways. On a phone the page's rail clears the screen's edge.
- **Footer** (`footer`): the mark, the links (for game developers, the forum, the source code and the rules) and "Zaisma is open source, under the MIT license." Its quiet links are a block's gap apart, whole on centred rows on a phone, so they never read as one phrase.
- **The shell** (`layout`, `html.ts`): the backdrop, the header, the page and the footer. A page body built before this look sits in `main.steel`, which keeps its old styles inside it and the components' out of it; a component placed in one goes in an element of class `not-steel`. Each page's own rebuild sets `isRebuilt` and drops it.
- **Styles and scripts are files, not page text.** A page links one cached stylesheet (`/css/<name>.<hash>.css`, `page-styles.ts`) and loads the components' script from `/js/` (`page-scripts.ts`), both named for their contents and cached for good, so a page's own markup is all a visit downloads that's new. The components' script is served minified: after changing any component's script, run `npm run components:minify` (a stale one is served readable and a test fails).
- **The page watcher** (`window.zaismaWatch`, `glass-script.ts`): one observer for the whole page that every component asks for size changes, new elements, resizes and scrolls, instead of watching by itself. The edge rule measures every control once per pass before it draws any.

## Motion

- Slabs slide on the spring, `cubic-bezier(.3, 1.2, .4, 1)`, in 0.55s; a size change (the header slimming) takes 0.45s; anything leaving goes faster than it came.
- Moving between pages crossfades, and the header's slab slides from the last page's tab to this one's.
- Under reduced motion nothing moves; the glass still changes color.

## Backgrounds

Glass is always over something. Zaisma's own pages have its backdrop (`backdrop`, `foundations.ts`): satin in warm gray or graphite whose folds sway slowly, or a still gradient in the same colors where it can't draw. A game's page and its place on the home show the game's own background instead, set by its developer: a picture, a shader or Zaisma's own, for wide screens and phones (the game backgrounds building block).

**Scenes.** A live 3D scene is the page only where its job is a first impression. The city (`cityStage()` and `CITY_SCRIPT`, `components/city.ts`) is the sign-in's scene: signing in, making an account and every step between are one glass pane in front of it (on the right on a wide screen, full width at the bottom on a phone). Moving between those steps never loads a new page: `CITY_PANE_SCRIPT` swaps the next step into the pane in place, so the scene runs on unbroken; only leaving sign-in loads a page. It runs on phones too, at a lower resolution, draws at most about 3.2 million pixels on any screen, and steps down further on a slow device. It shows at once as a placeholder, its first frame tiny and blurred inside the page itself, and nothing half-made shows over it: the live city starts as soon as the page has painted, and once it runs smoothly it sharpens in out of the placeholder from that same frame before the camera sets off. Its still, a full render of the same city by day and by night (`brand/sign-in/`), stands in for reduced motion, no WebGL and a device that can't keep the city smooth even at its lowest step; it's loaded only then, and takes the placeholder's place once it has wholly loaded.
