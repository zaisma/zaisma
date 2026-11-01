# Design: Glass

Every component, in every state, is on [zaisma.com/design](https://zaisma.com/design), rendered from the site's own code (`apps/site/src/components/`). Change a component there and it changes on every page at once. Each group's subgroups are a page each (`/design/<group>/<subgroup>`, `COMPONENT_SUBGROUPS` in `component.ts`), nested under their group in the gallery's Sidebar.

Zaisma is the glass, and the game is not. Zaisma's interface is a layer of glass over the page: the header, panes, menus and controls are glass, and behind them is the game's own background or Zaisma's. The game's art, its covers and its screen are never glass and never ours to restyle.

## Rules

Each rule says what holds it. A rule a check can measure has one, so it holds on every page without anyone looking; the rest are judged in the preview, on [Screens](#screens).

- **A rule is made impossible in code first, held by its component's tests where it can't be, and measured only for what a player would notice; the measuring check lists each rule's tier.** A type the compiler holds, or a scan of every rendered page (`pageStructureProblems` in `test/site/page-rules.ts`), comes before a measurement; style (margins, the frame gap, corners and bevels, a row's line, page shapes, pane sizes) is held by the components and `test/site/design.test.ts` and `test/node/materials.test.ts`, never measured. What's left is what a player would see, read, reach and press, measured with its tier in `LAYOUT_RULE_TIERS` (`layout-measure.ts`): `page` (on every page, on each pull request) or `sweep` (nightly, and the merge queue's changed pages). *Held by* `test/layout/layout-check.test.ts` (no rule without its tier).

- **Pages are only gallery components, layout included.** No page has styles, classes or a sheet of its own; it calls components and lays them out with the layout components. *Held by* `test/site/design.test.ts` ("pages").
- **Nothing is lost to a player, on any screen.** Nothing past the screen, spilling or overlapping, no words cut off or over something with an edge, nothing lost at 200% text, no sideways scroll, 44px touch targets, every control reached by Tab with its focus showing, and every press answering within 400 ms. *Held by* `npm run layout:check` on the screens players bring ([Screens](#screens)): every page on each pull request, and every page on every screen each night (the [measuring check](#layout)). Two margins in a pane, rows of one height on one line, corner controls in their corners and no bevel under 4px are the components' own, held by their tests.
- **Every page says its shape.** Reading, wide or full, each with a named width, so nothing stretches across a big screen ([Page shapes](#page-shapes)). *Held by* the compiler (a rebuilt page's `layout()` call needs `pageShape`) and `npm run layout:check` ("wider than its page's shape", "a reading column off the middle").
- **A pane over the page stops at its kind's size and scrolls inside.** A menu, a select's list and a sheet each have a ceiling ([Pane sizes](#pane-sizes)); what's past it scrolls inside the pane, never the page. *Held by* `npm run layout:check`, which opens every pane in the gallery from its button ("a pane wider than its kind allows", "a pane taller than its kind allows", "a pane past the screen", "a pane that overflows without scrolling").
- **Dark changes only colours.** A rule for dark sets colour, background, border colour, shadow, filter, opacity or a glass variable, never a size or a place, so a page is laid out once and measured in light on each pull request. *Held by* `test/site/design.test.ts` ("layout").
- **Words and controls grow with the browser's text size.** Type and control heights are in `rem`, spacing in `px`: a reader who sets their text larger gets larger words and controls, not larger margins. *Held by* `npm run layout:check -- --text 200` (on a laptop and an iPad, every rule as at 100%) and `test/site/design.test.ts` (no font in `px` outside a named list).
- **Every list says what it shows when it's empty.** `listRows`, `table`, and `grid` and `track` of covers or cards take a required `whenEmpty` (an Empty state), shown in the list's place while it has nothing, a page script's list included. A page whose lists depend on who's looking is checked as the stress accounts too: every name at its longest, nothing, and a great many things. *Held by* the compiler and `test/site/design.test.ts` ("pages": a signed-in page with a list has its long, empty and full states in `CHECKED_PAGES`).
- **Lines of words stay readable.** No line runs past 75 characters of its font. *Held by* `npm run layout:check` ("a line of words longer than the reading width").
- **A page shows whole while it loads.** It shows as soon as it arrives, in its final place, with every picture's placeholder in the picture's place; nothing moves or changes its words after the first paint, and no script holds it: the first-paint script (`FIRST_PAINT_SCRIPT`: what draws the glass's cuts and places the layout) runs before it, everything else after. A picture is a `ShownPicture` with its size and placeholder, shown with `picture()`; Jost's fallback takes Jost's room, so its arrival moves nothing. *Held by* the compiler (`ShownPicture`) and `npm run layout:check` ("moved after the first paint", "words changed after the first paint", "a picture without its placeholder").
- **Words line up.** Words inside a field, a list's rows, a table or a card start where the pane's words do (`--pad-inside-words`), so a heading over a field lines up with the field's words; and words are never a little further in than the margin (inset twice). *Held by* `npm run layout:check` ("words inside it off the pane's words", "words off the pane's margin").
- **Words beside a control sit on its center line.** Their first line does (their last on a field's boxes and at a pane's foot), at a pane's top edge too, where the control takes the corner's cut at the frame gap. *Held by* `npm run layout:check` ("words beside a control off its center line").
- **Controls come in four heights, and a row is one.** Every control is its size class's height (small 36, regular 44, field 52, big 56, 48 on a phone), never a number of its own; two controls side by side are a Row, an equal row's cells are one width, and a row that can't fit on one line becomes a stack, each control filling its own line. *Held by* the materials test, which refuses any other height in a component's styles or markup and a `--control-height` that isn't a size class; by `row()`, which sets every control in a row to its tallest's size class; and by `npm run layout:check` ("two controls side by side outside a row", "an equal row's cells of different widths", "a control alone on a row's line").
- **Everything you press is big enough to press.** On a touch screen, at least 44px tall, its hit area grown past what shows where it's smaller. *Held by* `npm run layout:check` on every touch screen ("a touch target under 44px"); links inside a line of words are the one exception.
- **No words cut off, none left alone.** Words wrap rather than being clipped (an ellipsis only where a page says so), and no paragraph or heading leaves one word alone on its last line (`text-wrap`, set once in `tokens.ts`). *Held by* `npm run layout:check` ("words cut off").
- **Nothing empty takes a place.** A thing with nothing in it (a bot check before it's needed) takes no room and no gap. *Held by* `npm run layout:check` ("an empty thing taking a gap").
- **The page's panes, the header and the footer share one edge.** *Held by* `npm run layout:check` ("out of line with the header").
- **Panes keep a block's gap between them.** Two panes side by side or one over the other are placed by a layout component, `--gap-block-block` apart: never touching, never overlapping. *Held by* `npm run layout:check` ("two panes closer than a block's gap", "two panes overlapping").
- **Nothing square in a cut corner.** Anything with an edge in a pane's corner takes the corner's cut, with no component asking for it; only words, bare icons and thin lines are left alone. *Held by* `npm run layout:check` ("square in a cut corner").
- **One runner in view.** One runner in each state of a page, outside what a sheet holds; the header's Sign in is a secondary button on a page with a runner of its own. *Held by* `test/site/design.test.ts` ("page structure", "two runners in view").
- **A pane is as wide as what holds it, or as wide as what's in it.** Never a width of its own: one that should take half the screen is a column of Columns. *Held by* the compiler (`paneWidth: "full" | "fit"`) and `test/site/design.test.ts` ("layout").
- **Zaisma is the glass over the game.** Everything of Zaisma's is glass, cut and rimmed the same way; what's behind it is a backdrop, never a flat color. *Held by* `test/site/design.test.ts` (one glass, the edge rule).
- **Orange only on what you act on.** The primary button (the one main action), the line under the tab, the step or the pick you're on, keyboard focus. Never on words, headings, charts, decoration or the logo (its orange lives only in its app icon and share card, `brand/README.md`); a warning, and a field marked wrong, is amber (`--warning`), a yellower hue. *Held by* `test/site/design.test.ts` ("page structure": only a link's or a control's rule sets words in an orange token); the rest is judged in the preview.
- **A focus ring is only for the keyboard.** Every focus style in the components is `:focus-visible` (or `:has(:focus-visible)`), never plain `:focus` or `:focus-within`. Focus still moves into a sheet as it opens, for screen readers and keyboards, but a sheet opened by a press (a mouse, a touch) takes the focus itself, with no ring, and only one opened from the keyboard focuses its first control (`zaismaInput` in `glass-script.ts`, `focusSheet` in `LAYERS_SCRIPT`). *Held by* `test/node/components-script.test.ts`; the rest is judged in the preview.
- **A pane that hangs from a button opens toward the middle of the screen.** A sheet, a select's list or a menu lines its right edge with a button in the screen's right half and its left edge with one in the left half; it sits under the button, or above it (bottom edges together) when the button is in the lower half and there's room, or when there's no room below. Always kept inside the screen, and it follows the button as the page scrolls (`zaismaPlace`, `PLACE_SCRIPT` in `panes.ts`). *Judged in the preview.*
- **One queue and one stack own what appears over a page or a game.** No page shows, hides or times a notice, a card or a sheet by hand: it asks `window.zaismaLayers` (`LAYERS_SCRIPT`, `layers.ts`). Each notice and card has an urgency (`noticeUrgency`): **information** (Saved, Copied) leaves by itself after 4 s (8 s with Undo), waiting while it's pointed at or touched; an **ask** (Still there?, Keep your progress, the sign-in ask) stays until it's answered and goes ahead of information; **urgent** (signed out, the connection lost while paying) is an Urgent card over anything, sheets and full screen included, and closes the sheets it makes useless (`sheetsToClose`). A problem is information that stays until it's closed. Over a running game one card at a time, the next 300 ms after one leaves, nothing but urgent while a sheet is open or in full screen, and information more than 10 s old by its turn is dropped; on a page at most three notices stack under the header. The save line speaks only when something changes: saving that works says nothing over the game, and the ⋯ menu says when it last saved. *Held by* `test/node/layers.test.ts`.
- **Sheets go two deep at most.** Steps of one task move forward inside one sheet with Back (Players, then a player, then Report: `sheet({ steps })`, `zaismaLayers.step`); tabs in a sheet's head swap what's in it (`sheet({ tabs })`), keeping its tallest height; a short yes or no that guards something (a Confirm sheet, Confirm it's you, a block) opens a size smaller on top, and closing it lands on the sheet beneath. A third sheet replaces the top one and warns in the console, so it shows in the preview. Tapping beside, X and Esc close only the top one. Whenever a sheet or card covers a game, the game hears it (`Zaisma.page.coveredBy`). *Held by* `test/node/layers.test.ts`.
- **Nothing waits on an animation.** A click does its thing at once; motion only shows what already happened. *Judged in the preview.*
- **The glass is real.** Every look is something real glass could do: a part is carved in, flush, raised or floating, lit from one light above and to the left, and a state only moves it between heights or changes the light on it; nothing is painted on ([The glass is real](#the-glass-is-real)). *Judged in the preview*, against the test there.
- **A component is named for the piece, not its use.** One piece with variants, never a component per page's use ([Adding, changing or removing a component](#adding-changing-or-removing-a-component)). *Judged in the preview* of the gallery.
- **No decoration.** No "Live now" lights, sale banners, badges for their own sake or glows that mean nothing. *Judged in the preview.*
- **Buttons move only when pointed at or pressed.** They lift toward the pointer, never tilting, and sink when pressed; at rest they're still. A scene behind the glass may move on its own. *Held by* `test/site/design.test.ts` (what you point at never moves).
- **No hotkey hints.** "/" jumps to search, and nothing on the page says so. *Judged in the preview.*
- **The main action shows without scrolling.** *Held by* `npm run layout:check` (the runner above the fold, where the page has one).
- **Players first.** Show what helps a player decide or act. Say game developers, never creators. *Judged in the preview.*
- **Game pictures are only the developer's image.** Nothing drawn over covers or screenshots: titles and buttons sit beside a picture, never on it. *Held by* `npm run layout:check` (nothing overlaps a cover).
- **No eyebrows and no ALL CAPS.** Headings are sentences. *Held by* `test/site/design.test.ts` ("page structure": no `text-transform: uppercase` or small caps in the styles, and no words in capitals on any page, "words in capitals"); eyebrows are judged in the preview.
- **The home shows a whole game without scrolling.** Its first cover is whole above the fold on every screen. *Held by* `npm run layout:check` (`isCoverAboveFold` in `CHECKED_PAGES`).
- **A token's name is code.** Jost draws two hyphens as one dash, so `--spring` in words is set in code. *Held by* `test/site/design.test.ts` ("page structure", "a token's name outside code").

A remark in a preview about every use of a piece becomes one of three things: a token's value, a component's option, or a check. It's written here with what holds it, so it holds on every page from then on, built or not. A remark about one page changes that page.

### Laws of UX

The [Laws of UX](https://lawsofux.com) the components hold or a check can measure fail a page; the rest are principles, looked at before every preview (the `preview` skill's look) and judged there. Each number is a named constant in `layout-measure.ts` or `test/site/page-rules.ts`, with the law beside it. The ones a page's markup shows are scanned on every rendered page (`test/site/design.test.ts`, "page structure"); the rest are measured.

| Law | Held by |
| --- | --- |
| Law of proximity | `stack()` picks every gap from what's on each side, so a heading sits nearer what it names than what's before it |
| Law of common region | A heading and what it names are one stack, on one pane |
| Law of similarity | A grid's or a track's cells are one size (its `itemSize`), as an equal row's are |
| Law of uniform connectedness | A switch's tabs and a step flow's steps are one line: neither wraps (scanned in the styles) |
| Hierarchy (aesthetic-usability) | "more than one title", "headings out of order" (scanned), and no heading's type bigger than the one it's under (scanned in the styles) |
| Hick's law, choice overload | "too many equal choices" (scanned): at most 5 controls of one size side by side, at most 9 choices in a menu with no groups |
| Miller's law, chunking | "a long form in one piece" (scanned): at most 7 fields with no heading between them |
| Doherty threshold | "no answer within 400 ms": every press that answers in the page (opening a sheet, a menu, a tab) shows it within 400 ms, on a laptop, in the nightly sweep |
| Von Restorff effect | One runner, orange only on actions ("two runners in view", scanned; orange words, scanned in the styles) |
| Fitts's law | "a touch target under 44px", "the runner below the fold" |

Judged in the preview: it works like the products players know (Jakob's law); nothing on the page could go (Occam's razor, Tesler's law); progress and what's unfinished show (goal-gradient, Zeigarnik); the moment after Play or Buy feels like an arrival (peak-end); fields take what people type (Postel's law); no more on screen than the task needs (cognitive load).

## Voice

Every word is written for one reader, says only what that reader needs there, and says it bold and exact.

### The readers

| Reader | Where | How it reads |
| --- | --- | --- |
| A person on a page | the site, dashboard, settings, notices, emails | plain words, "you", contractions fine, the button's own words |
| A person reading the legal pages | everything under `/legal/` | formal and exact: "Zaisma" and "you", no contractions, one word for one thing every time, numbers rather than adjectives, plain words rather than legalese |
| A developer reading the docs | the README, `docs/DEVELOPER-API.md`, guides | a reference: exact names, an example a call, nothing that sells |
| An AI | an error's `fix`, MCP tool descriptions, the MCP's instructions | names the calls, fields and values, and the next call |

Two readers means two texts. An error, a finding and an alert carry the AI's `fix` and the person's `message_for_people`; a page shows only `message_for_people` (`docs/NAMING.md`, Errors).

Zaisma never says "we", "us" or "our" in its own words. The legal pages say "Zaisma"; a page needs no subject ("That list stays on this device.").

### Bold and exact

- **Sure of itself.** It says what is, with no cushioning, hedging or apology.
- **Complete.** A sentence carries the whole fact: what happens, to what, and what's next. It's as long as the fact needs and no longer. A fragment only in a headline, and only when nothing is lost.
- **Hard nouns.** Games, players, developers, servers, rooms, dollars, days.
- **Claims as facts, said once.** "Zaisma takes no cut", never a belief about what developers deserve.
- **No "!".** A bold line doesn't need one.

The attitude is loudest in headlines (the home, the developer pages, the README), plain in buttons, notices and errors, and absent on the legal pages, where bold would mean vague.

### Six rules for every word

1. **Only what this reader needs here.** How something works only where the reader asked.
2. **Facts, not feelings.** No reassurance and no warm adjectives: what's kept, who sees it, for how long.
3. **Zaisma, never "we".**
4. **Say it once.**
5. **The names this reader sees.** On a page, the button's own words and a link to it; for an AI, the call.
6. **No filler, no marketing words, no "!".**

The word lists (marketing words, filler) and the checker are [`packages/core/src/words.ts`](../packages/core/src/words.ts). The design test fails a page whose words say "we", "!", a word from either list or a name from the code (a word with an underscore), and a legal page with a contraction. A developer's or player's own words on a page (a game's title, a forum post) are marked `data-words="theirs"` and left out.

| Not this | This |
| --- | --- |
| Unlock cloud saves and sync seamlessly across all your devices! | Your progress stays on this device. Make an account to keep it everywhere. |
| We take your privacy seriously. | Your birthday is never shown to anyone. |
| Your browser also remembers which games you played recently. That list stays on your device; we never see it. | The browser stores the games played recently. This list stays on the device and is never sent to Zaisma. |
| They're kept in your browser tab and forgotten when it closes. We don't keep a profile, and we don't know who you are. | They're discarded when the browser tab closes. Zaisma keeps no profile of guests. |
| Delete one you don't use with delete_webhook, or add these event_kinds to one you have with update_webhook. | You have as many webhooks as an account can. Remove one, or add these events to one you have. |
| Hang tight! Our team is taking a quick look to keep everyone safe. | A person at Zaisma looks at this first, usually within a day. |
| No friends yet. Send your link. | You have no friends here yet. Send someone your link, and they show up here once they open it. |
| We don't judge whether it's true. | Zaisma does not judge whether it is true. |

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

### The glass is real

The glass is a real material, not a picture of one: things are carved into it, rise out of it and float over it, and the light shows which. Every look, state and pane is something real glass could do.

- **Every part sits at one of five heights,** each with its own look, and a component names its height, never a shadow of its own:
  - **Carved** into its pane (a field, a wheel's groove, a well): shaded inside, its top edge in shadow and its bottom edge lit.
  - **Flush** with it (a pane, a list's row at rest): no shadow.
  - **Raised** out of it (a button, a toggle's slab): lit on its top edge, shaded on its bottom, with a small shadow.
  - **Floating** over the page (a menu, a select's list, the wheels: the Floating pane): a soft shadow onto what's under it, in its own cut shape, never a box's.
  - **Over everything** (a sheet): a dimmed page behind it.
- **One light, above and a little to the left,** for everything: sheens and caustics brightest on the top-left facets, shadows falling down and a little to the right. No light follows the pointer.
- **One blur everywhere.** Higher glass doesn't blur more; only its shadow and its edge's light say how high it is.
- **A hover is light; a press is depth.** Pointing at something lets it catch the light (its glass clears, its edge shines; in a well of parts, the well's own edge light, Edge light in Panes › Glass, wakes and floods up beside the part), and a raised button may lift toward the pointer, never tilting, as a piece waiting under a carving (a check field's) may rise a little into view; a hover never carves or sinks anything. A press sinks a part in, and letting go brings it back up. A press carves in place: nothing moves out of its place or pushes what's beside it.
- **Nothing is painted on.** No flat color washes, no ink slabs (a dark fill with light words), no underline or side line standing for a state, and nothing that looks like the browser's own selection or highlighting. A state that only works by filling a box with color is flat UI.
- **Orange is light inside the glass,** never tinted glass: a glow along an edge (focus, the field you're in) or a part lit from within (the main action, the pick you're on).
- **Disabled is frosted and still:** it catches no light, sinks on no press and its words go quieter, its shape where it was.
- **A carving never moves or fades.** When what's in a well scrolls, only what's in it moves and fades at the well's ends; the well stays put, whole.
- **Glass sits on glass, not in it.** A pane over another is its own piece of glass with its own edge and shadow, never a soft patch of the pane under it; what it covers is hidden, not seen through it.
- **Motion has weight.** What rises or sinks moves on the spring, as a material settling.
- **The glass stays calm over the game.** It bends the backdrop's light as thick glass does, but nothing in it moves or shimmers on its own: the game is what's lively.

**The test** for any look, sketch or state: what is the glass physically doing here, and where is the light? An answer of "it's colored" fails.

## Materials

Everything in the gallery is built of five materials, each defined once in `materials.ts` (and `foundations.ts` for the panes) with its look, its edge, its thickness, the room it keeps inside it and its sizes. A component only puts materials together and lays them out with the layout components (Layout); changing a material changes it everywhere it's used. Panes › Materials shows each one.

- **Glass pane** (`glassPane`, the header, bars, banners): flush glass of the regular thickness.
- **Tray** (`tray`): one sheet of the thinnest glass, its head on a step of regular glass across its top.
- **Floating** (a floating pane, a sheet, a notice, a playing card): thin glass over what's under it, which it blurs.
- **Carving** (`carving`): the glass cut away, for what's held in it (a well, a field, a slot); a deep carving is a groove or a PIN's marks.
- **Slab** (`slab`): a raised piece of the same glass, for what's pressed or moved (a button, a switch's tab, a thumb); lit, it's the orange one.

Each comes regular or compact (a menu, a small button, a compact sheet): compact keeps less room inside it and looks the same. Waiting is a state of the glass, not of a component: whatever was pressed and waits on the same page (`aria-busy="true"`) keeps its pressed look, and at once the Waiting component's glint runs across its pressed face (one glint resting, under reduced motion). A game's hue (`--glass-hue`) reaches every material at its own strength, a carving half as much as a pane or a slab.

**Nothing builds itself.** A component never gives itself a background, a shadow, a border, padding, a margin from the spacing tokens, a height, a scroll, a color or a timing: its look is its materials', its room theirs, its spacing its layout's, its height its size class's. `test/node/materials.test.ts` refuses any of it in a component's styles or markup. The few things only one component draws (a loader's dots, a PIN's diamonds, a cover's inner shadow, a brand's own color) are named one by one, each with its reason, in that test's exceptions; a name there that's gone fails it too.

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
| `--gap-words-beside-control` | Words beside a control (a heading and its button in a row or a pane's head, a toggle's words): they keep the words margin from its edge, as from the pane's | 16px, 12px on a phone |
| `--gap-words-words` | Words beside or under other words in one block (a title and the line under it, links in a row, an icon and its word) | 8px |
| `--gap-block-block` | Two blocks: inside a pane, two panes side by side or stacked, the gallery's examples, a row or grid of game cards | 24px |
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

**The words margin is one rule, set once on the surface.** Every surface of glass that holds words (a pane, a sheet, a banner, a tray, a playing card) takes the margin from the same place, `tokens.ts`: it pads its inside to the frame gap and sets `--pad-words`, and every heading and paragraph in it takes `--pad-words` at its sides. A component never pads its own words; a new surface is added to the list there and its top and bottom edges to `layout.ts`. `npm run layout:check` enforces it: a text box closer to its glass surface's edge than the margin (`--pad-pane`, a tray's `--pad-tray`) fails with the element named. A notice is one centered line and is held to the margin at its sides. The check opens what starts hidden (the Players sheet, the sign-in ask and the signed-out card over a game) so they are measured too (`setUp` in `checked-pages.ts`).

**Bare groups keep the margin as one unit.** A component whose words sit bare, with no edge of their own, is a bare group: a game card (its cover, its title and players now under it) and a person (their picture, name and line). The whole unit keeps the words margin from the surface's edge on every side where it meets it, top and bottom included, and its parts line up with each other inside it: a card's title flush with its cover's left edge and its count with the right, a person's picture, name and line one row. Nothing is placed apart, so a title is never inset on its own: at a pane's corner the whole card moves in, image, title and count together. A row, a grid or a track of cards is inset at its start, end and foot by the margin as one (`BARE_GROUPS` in `tokens.ts`; the gap between cards stays `--gap-block-block`), a track still scrolling out to the frame gap at its box's edges, and a lone group pads itself; the foot and top come from the same edge rules as words (`layout.ts`). A picture with no words beneath (a screenshot) has an edge all round and keeps the frame gap, and screenshots lie `--gap-control-stack` apart. Any new component whose words are bare is added to `BARE_GROUPS`, never given a rule of its own. `npm run layout:check` measures each group's box against the margin and fails with the element named (a bare group closer to the pane's edge than the words margin, a bare group's parts off each other).

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
| `sidebarLayout` | A Sidebar beside the page in its own column (`--size-sidebar`), staying in view; on a reading page beside its column (`--size-page-reading`), the pair centered in the wide frame. Folded, the page takes the whole width; on a phone the sidebar is a sheet over the page |
| `paneParts` | A pane's head, body and foot, with one control in its top or bottom end corner; the head's heading beside its control, its other words under both |

- **A pane is `full` or `fit`.** Full is as wide as what holds it; fit is as wide as what's in it, its paragraphs running to a reading width at most (`--size-reading`, 60ch). A pane that should take half the screen is a column of `columns`. A sheet fits what's in it too.
- **Widths are named, never numbers:** a grid's `--size-cover`, `--size-card` and `--size-figure`, a track's covers, the reading width, the page shapes (`--size-page-reading`, `--size-page-wide`), the pane sizes, and shares.
- **`npm run layout:check`** opens pages in `CHECKED_PAGES` (`apps/site/src/components/checked-pages.ts`) in headless Chrome and measures them as a player would meet them, failing only on what they'd notice: **see** (nothing past the screen, overlapping or spilling out of its pane, the runner and Home's first cover above the fold), **read** (no words cut off or over something with an edge, nothing lost at 200% text, no sideways scroll), **reach** (44px touch targets on a touch screen; on one without touch, every control reached by Tab, "a control the keyboard doesn't reach", with its focus showing, "a focused control with no visible focus") and **press** (every press answering within 400 ms). Each failure names the page, the screen, the thing and what was measured. Each rule has a tier (`LAYOUT_RULE_TIERS` in `layout-measure.ts`), and each run measures its own (`LAYOUT_CHECK_RUNS` in `scripts/layout-check.mjs`):
  - **with no flag**, as each pull request's Layout check runs it on one runner: every page and state but the stress accounts', on a phone (320 × 667) and a laptop (1440 × 900), in light (`page`), the gallery's pages too. It skips each page that passed before as it is: its fingerprint (`pageFingerprint`) is in `.wrangler/layout-check-passed.json`, which GitHub keeps between a pull request's pushes. Only passes are kept, so a failed page is measured again, and the merge queue's and main's runs measure every page (`LAYOUT_CHECK_FRESH=1`);
  - **`--sweep`**, as the nightly layout sweep runs it at 02:00 UTC in four shares (`.github/workflows/nightly.yml`): every page and state, the stress accounts too, on the measured screens, in light, at 200% text, every tier, pressing every button that answers in the page. The merge queue runs it too ("Every screen"), on the pages its change reaches, so a layout break can't land on main: `--measured <file> --changed-only` skips each page whose fingerprint main measured already (its HTML as the server sends it, whose CSS and script addresses carry their change, with the run and the check's own code; `pageFingerprint`), and a page that sends forms or opens a hidden state is always measured. When main's latest sweep failed, `npm run ship` measures the pages it named again on the commit it ships (`--pages`, a JSON list of names) and deploys once they pass.

  The measured screens (`MEASURED_SCREEN_NAMES`) are each band's narrowest, where words wrap most: the phone, the phone on its side (the one short screen), the iPad, the Steam Deck, and the 2560 desktop, the one where a page's frame caps its width. The big phone is a wider phone, and every pull request measures the laptop. No run measures dark: a dark rule sets only colours (`test/site/design.test.ts`, "changes only colours in dark"). Pictures aren't loaded and Chrome draws on the CPU, since the check measures boxes, not pixels: every picture's box is sized before it loads, by its `width` and `height` or by a holder that holds art (`design.test.ts` and `test/node/materials.test.ts`).

  Style isn't measured: what a component builds (its margins, frame gap, corners and bevels, sizes) and what a layout component arranges (gaps, the page's column, a row's line) are held by their tests (`test/site/design.test.ts`, `test/node/materials.test.ts`), and `stack()`, `grid()` and `columns()` can't be given an empty part or two bare controls side by side. Tab's keyboard check runs on every screen without touch, in every run: frames are inert while it runs, a control taken out of Tab's order on purpose (a negative `tabindex`) is left out, and a focus look counts wherever the control's component shows it (its face, its cut line, the field round it).

  An entry's `stepsToTake` reaches a state only forms or an earlier page lead to (a wrong password, a code that didn't work, a join step): the check takes them once, then measures the answer at every screen; it also fails when the page doesn't name the entry's state. It opens a few pages at once (`--tabs`, one fewer than the cores, at most 4). It must pass for any page change; while you work, `--only <part of a path>` checks just the pages you changed, and the full run is once before you push. `--screens all` (the measured screens; `--screens every`, all seven; or `--screens Phone,Tablet`, by name) runs other screens in place of the run's, `--text 200` adds the browser's text at 200% on a laptop and an iPad, `--shard 2/4` runs one of four shares as the sweep does, and `--pictures <folder>` saves one contact sheet per page and state, pictures and drawing included: its screens side by side, light over dark, for the look before a preview.

### Page shapes

Every rebuilt page says what it is (`layout()`'s `pageShape`, `data-page-shape` on the page), and the shape sets how wide it runs. The header and footer sit in the wide frame on every page, so moving between pages never moves them. On a phone every shape is the screen less its margins. The gallery draws each on a 2560 desktop and a laptop (Layout, Page shape).

| Shape | For | Width |
| --- | --- | --- |
| `reading` | Words, forms and settings: Developer settings, Connect an app, a message, a report | One column, `--size-page-reading` (820px), centered under the header; a page with places down its side has them beside the column, the pair centered in the frame |
| `wide` | Covers, cards, tables and charts: Browse, the gallery | The wide frame, `--size-page-wide` (1680px), less the margins |
| `full` | A page whose world is the page: the home, a game's page, the city | Its world to the screen's edges; its panes in the wide frame |

A pane that fits what's in it, placed straight in the page's column (or in a stack of the page's), sits in the column's middle, under the header's, never at its start: the page layout centers it, so no page can set one off to a side.

A page that doesn't fit the rule gets the shape closest to it, and its pull request says why.

### Pane sizes

A pane over the page has a ceiling by its kind, in `rem` so it grows with its words; each also stops at the screen less its margins, and what's past it scrolls inside the pane.

| Pane | Widest | Tallest |
| --- | --- | --- |
| A menu (dropdown) | `--size-menu` (20rem) | `--size-menu-height` (30rem), or the room beside its button |
| A select's list | Its field | `--size-menu-height` |
| A compact sheet | `--size-sheet-compact` (20rem) | The screen less its margins |
| A sheet | `--size-sheet` (36rem) | The screen less its margins (78% of a phone's) |
| A picture's sheet (a screenshot, or a screen on Screens, large) | `--size-sheet-picture` (80rem) | The screen less its margins (78% of a phone's) |
| A store panel | `--size-store-panel` (23.75rem) | The screen less its margins |

### Screens

The seven screens players bring, the ones the check picks from (`SCREEN_SIZES` in `checked-pages.ts`; Layout says which each run measures): a phone (320 × 667), a big phone (390 × 844), a phone on its side (844 × 390), an iPad (820 × 1180), a Steam Deck (1280 × 800), a laptop (1440 × 900) and a 2560 desktop (2560 × 1440). Phones and the landscape phone take a phone's sizes (below 760px wide or 500px tall); every touch screen is held to 44px targets; the runner is held above the fold everywhere but on a phone on its side, which scrolls.

`/design/screens?page=/signin` on a local preview shows a page on Julius's phone and a laptop, light and dark, side by side, each with what the measuring check finds (`screens.ts`); `screen=<name>`, once per screen, picks others (the picker's checks do it). `page` can be given more than once, to put variants side by side. Pointing at anything in a screen outlines it and says what it is and what placed it: its size class, its layout's gap and why, its pane's width and margins. It's where a page is reviewed, never made: pages are written in code, held by the checks, and judged here, and a remark names the rule to change.

## Type

Applies where Spacing does. Every word outside a control's own inside is set in one of these whole fonts (`font: var(--type-…)`), defined once in `foundations.ts` and shown in the gallery's Type. Pick one by what the words are, never by the size that looks right.

| Token | What the words are | Font |
| --- | --- | --- |
| `--type-title` | A game's title, once on a page | Jost 600, 40px (32px on a phone) |
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

- **In `rem`, sized here at the browser's own 16px**, so words grow with the browser's text size; a control's height does too.
- **Inside words, only the weight changes** (a name in bold in a glance line). Never the size.
- **A control's inside keeps its own font**, set by each control's size (a button's label, a field's text, a tab), like its padding. A picture's initials are sized to the picture. Each one is named, with its reason, in `NOT_TYPE` in `test/site/design.test.ts`.
- **Lines between two parts of one pane are `--divider`**, never a border of their own.

## Small pieces

**Everything derives from the gallery.** Every piece of UI on a page, and on the gallery itself, comes from a gallery component, or is a named exception with its reason in `test/site/design.test.ts`, which fails on anything else:

- **Classes:** every class on a gallery page is styled by a component. The only others are the gallery's own scaffolding (`GALLERY_ONLY`) and hooks with no look (`UNSTYLED_HOOKS`).
- **Placing, not restyling:** the gallery, or a component holding another, may only place it (where it sits, how big its box is) or set the variables it offers (`--logo-height`, `--switch-height`, `--loader-width`). It never restyles it.
- **No hand-drawn pieces:** no source draws its own icon (`OWN_SVG` names the brand marks and the icon set itself), builds a button outside `actions.ts`, or makes a sheet of glass other than a Glass pane or a Tray (`OWN_GLASS` names the pieces made of glass, like a dropdown).
- **No stale lists:** an exception that's no longer in the code fails the test too, so every list stays exactly the real exceptions.

Anything with a look of its own is a component in the gallery, or part of one, and every page uses that component. Never style one in place.

- **A link in words is a Link** (`textLink`, `actions.ts`): ink, with an orange underline. In a list of links where nothing else is (the footer), it's quiet: plain until pointed at. Anything else you can follow is a control (a button, a tab, a place) or the logo. Only `.link` underlines, and only a control styles a bare link (`LINK_IN_CONTROL` in the test).
- **A tag is a Tag** (`tag`, `foundations.ts`, shown in Data): `new` (Updated, Live), `count` (a number: unread topics on a place), `plain` (words: Replaced, Developer), `warning` (Held, amber) or `glass` (the rail's labels), with an icon before its words where it helps. A version's state is always the same tag, from `VERSION_STATE_TAGS` (`data.ts`).
- **Someone named on a page is a Person** (`person`, `people.ts`): their picture, their name a quiet Link, a line about them and at most one control. What they wrote is a Post; words to read are Reading text (`reading.ts`).
- **A button with only an icon, a small button or a toggle is a Secondary button** (`isLabelHidden`, `isSmall`, `isPressed`): the gallery's light and dark button, a password's Show.
- **One of a few colors is a Color picker; one of a few options is a Switch.** A way in's tint and the glass's hue are Color pickers; light or dark is a Switch.
- **A page's own places down its side are a Sidebar** (`sidebar`, `sidebarButton` and `sidebarLayout`, `navigation.ts`): one inset pane of glass under the header, from it to the screen's foot, its places words on the glass with an icon and a count where they have them. One place is selected, the page you're on, on the switch's raised slab with its orange line; a group with its own places opens like a folder, its name strong and its arrow turned down, never selected itself. Its button sits at the header's start, over it (`siteHeader`'s `sidebarButton`), and folds it away entirely, the page gliding into the width, each browser remembering which; where the page can't have a column beside it (a phone, a tablet with large text) the same button slides it over the page from the start edge as a sheet on the layer stack (`placement: "start"`), gone once a place is picked, on a press beside it or Esc. Never a sidebar built in place.
- **A short list hanging from a button is a Dropdown** (`dropdown`, `panes.ts`), with its own choices: the account menu is one.
- **Zaisma's logo is the Logo** (`logo`, `foundations.ts`): the wordmark at the top of a page, the mark in the footer, always a link home. It's Julius's Z in glass from `brand/` (`npm run brand` makes it): black glass on light glass, white on smoked, never orange.
- **Waiting is one look, the Waiting component's.** A press that waits on the same page keeps what was pressed sunk and runs the Light's glint across its pressed face, one glint after another so one is always in view (`aria-busy="true"`, set by `window.zaismaWait(element, promise)`, `isBusy` from the server); a press that opens another page keeps what was pressed sunk, and when the page hasn't come within half a second (it wasn't prepared ahead) fills the header's bottom edge with orange light, quickly at first and slower as it goes, until the page comes (`HEADER_SCRIPT`). The press shows at once, so a short pause never looks like nothing happened, and neither changes the size of what waits. No component draws its own; the words on what was pressed stay as they were (`busyLabel` is for screen readers). Nothing waiting can be pressed twice.
- **What belongs to a head sits on its Tray** (`tray`): one sheet of the thinnest glass (a clearer tint, a fainter sheen, less blur, smaller cuts at its foot, and `--pad-tray` instead of `--pad-pane`) with one rim round all of it. Its head is a step of regular glass across its top, under the same rim with none of its own: the step's lip catches the light (`--step-lip`) and shades the thin glass below (`--step-cast`), so the head stands out and what's under it stays in the background, one piece. Every gallery section is one. What's on a tray fits it like anything on a pane: square under the head, cut at an even gap into its cut foot. A gallery example's stage (`data-on-no-pane`) shows what's in it on no pane, though the stage sits on a tray.
- **Every switch scrolls past its room.** Its well stays put and its tabs scroll inside it, fading at its ends, with the rail under it (stacked, beside its places): the header's tabs, a page's sections (a big switch of links), the rooms' regions. A switch fills its place with `isFull` (the header's tabs, the sign-in pane's head). Its tabs can fold away (`isFoldable`), as the header's Developer and Forum do off a developer page.
- **Online is the Picture frame's** (`isOnline`); **you, signed in, are the Account button.**

## Components

Every component, with the call that makes it and its options, is in the catalog below. It is written from the gallery's registry (`apps/site/src/components`, shown at `/design`) by `npm run design:catalog`, and `test/node/design-catalog.test.ts` fails when it is out of step, so a page's builder, human or AI, can rely on it. A page is built from these and nothing else: find the component here, call its function, and set the options it names. `/design/example` is a small page built that way (`example-page.ts`), held to the same checks as the gallery.

### Adding, changing or removing a component

1. **Name the piece, not the use.** A component is named for what it is on screen (Wheel field, Copy field, Primary button), never for what one page uses it for (a birthday field, a guest button, a code field). The use is an example.
2. **One piece, many variants.** Two components with the same shape and behavior are one, with an option: a kind, a size, a form. A new use adds an example or an option, not a component.
3. **A new component only for a new shape or behavior,** one no component can show with an option. Before adding one, name the nearest component and why an option won't do.
4. **Split when variants stop sharing.** A component that needs a switch for everything has become two; two pieces that pick or behave differently stay two even when they look alike (the Select field and the Wheel field), side by side on one page. A name so general it says nothing ("Input", with a dozen switches) is the opposite mistake.
5. **A page holds what a builder compares.** Related components share a subpage, a page left with one component folds into its neighbor, and each component's summary says when to use it and which neighbor to use instead.
6. **What's shared becomes its own piece.** A control inside a component is the gallery's own (a Tertiary button, never a look-alike), and a mechanism several components repeat becomes a component they all use (Well, Floating pane), so a fix lands once. When components merge, the old names go everywhere at once, with nothing kept under them.

<!-- catalog:start (written by npm run design:catalog from the component registry; don't edit) -->

### Foundations

- **Color**: Every color comes from these tokens, so light, dark and smoked glass follow by themselves. Orange is only for what you act on, and it is always shown in full: never faded or at half opacity.
- **Type**: Every word outside a control's own inside is set in one of these, picked by what the words are. Jost for display, the system's own face for reading; fields are 16px or more, so phones don't zoom in.
- **Glass**: Zaisma's interface is glass over the game or the page's backdrop, never over a plain color. It's as thin as the words allow: light with dark words, or smoked with light words.
- **Cut shapes**: Corners are cut, never rounded: 18 and 14 on panes, 16 and 12 on the header, 14 and 12 on menus. Controls follow the edge rule: a slant only beside another control in a row, and every other corner fits what holds it.
- **Motion**: Things move only when pointed at, pressed or chosen: a slab springs across on the spring curve (--spring) in 0.55s, 0.4s for a small one, and a change of size takes 0.45s. Reduced motion stops all of it.
- **Page settings**: Every page has one set of settings that all its components follow: light or dark, and each component's own, like the glass's hue. One change covers every instance at once, and a page only carries the ones its components use.
- **Spacing**: Every gap, padding and margin is one of these tokens, picked by what sits on each side of it, never by how close two things feel. A control is anything from Actions & Inputs; words are a heading, label or line; a block is a group of controls with their words, a paragraph, a picture or a pane. If either side is a block, it's --gap-block-block. More room is a multiple of one, never a new number.
- **Picture** (`picture(shown: ShownPicture, options?: PictureOptions)`, `foundations.ts`): Every picture a page shows, a cover, a screenshot or a game's background: in its place from the first moment as a tiny blurred copy of itself, sharpening in as it arrives. Nothing on a page is ever an empty box waiting for a picture.
  - `shown`: `imageUrl: string`, `widthPx: number`, `heightPx: number`, `placeholderDataUrl: string | null`
  - `options`: `label?: string`, `shownSizes?: string`, `largestPx?: number`, `isEager?: boolean`, `hasHighPriority?: boolean`, `hasOwnShape?: boolean`, `className?: string`
- **Icons** (`icon(name: IconName)`, `icons.ts`): Thin line icons in the words' color, so a kind of fact can be found without reading. Never decoration.
- **Logo** (`logo(kind: "wordmark" | "mark")`, `foundations.ts`): Zaisma's logo, always a link home: the wordmark at the top of a page, the mark alone in the footer. Julius's Z in glass, black on light glass and white on smoked, never orange and never restyled.
- **Backdrop** (`backdrop(options?: BackdropOptions)`, `foundations.ts`): Glass is never on a plain or solid color: there's always something behind it, still or moving. A game is its own backdrop; Zaisma's pages have Zaisma's own, a sheet of satin whose folds sway slowly in a soft light, or their own shader or 3D scene.
  - `options`: `fragmentShader?: string`, `isGlassAdaptive?: boolean`, `isScene?: boolean`, `isFramed?: boolean`, `standInSlug?: string`
- **Shader background**: A background written as a shader: one small function that paints each pixel from the time and the screen's size, in the form AI writes well. From a few lines for a sky to a whole city in the rain. Zaisma's runner draws it small, at most 30 frames a second, holds a still frame on a device that can't keep up. A shader drawn in the page bends the light under the glass: what's behind each pane magnified and bent as through thick glass, with light gathered along its cut edge. A game's own shader runs in a frame on the game's site, which can't redraw a bend in the frame the page scrolls in, so behind Zaisma's glass it shows as drawn, never bent.
- **Game background** (`gameBackgroundFrame(options: GameBackgroundFrameOptions)`, `foundations.ts`): A game's own world behind the glass, on its page and behind it on the home: a picture or a shader its developer sends, for wide screens and phones. It's the game's art, never restyled to Zaisma's look, and the glass over it turns light or smoked to keep the words clear. Until real games bring theirs, the stand-in games have these.
  - `options`: `standInSlug: string`, `title: string`, `note: string`
- **City** (`cityStage(options?: CityStageOptions)`, `city.ts`): Zaisma's own live 3D scene, where signing in and making an account happen: one city in an endless sea on a slow cinematic loop, its orange shapes and sea there to tap. Under reduced motion, without WebGL or on a device that can't keep it smooth, a still of the same city stands in, with everything in place.
  - `options`: `isFramed?: boolean`

### Layout

- **Sidebar layout** (`sidebarLayout(options: { … })`, `navigation.ts`): A Sidebar beside the page: the sidebar in its own column, staying in view while the page scrolls, the page in the rest. Folded, the page takes the whole width; on a reading page the page is its reading column and the pair sits in the middle; on a phone the sidebar is a sheet over the page.
  - `options`: `sidebar: Raw`, `main: Raw`, `isCollapsed?: boolean`
- **Page shape** (`pageShapeDrawing(options: { … })`, `layout.ts`): What a page is, which sets how wide it runs: every rebuilt page says one (layout's pageShape). Words, forms and settings are reading, one column under the header (--size-page-reading); covers, cards, tables and charts are wide, the whole frame (--size-page-wide); a page whose world is the page (the home, a game's page, the city) is full, its world to the screen's edges and its panes in the frame. The header and footer sit in the frame on every page, so moving between pages never moves them. On a phone every shape is the screen less its margins.
  - `options`: `pageShape: (typeof PAGE_SHAPES)[number]`, `screenName: (typeof DRAWN_SCREENS)[number]["screenName"]`
- **Stack** (`stack(options: StackOptions)`, `layout.ts`): Things one under another: a pane's heading, its lines, its fields and its button. Each gap is picked from what's on each side, so you never pass one; say what each thing is (words, a control, a block) and the stack spaces it.
  - `options`: `items: LayoutItem[]`, `label?: string`, `dataAttributes?: Record<string, string>`
- **Row** (`row(options: RowOptions)`, `layout.ts`): Things side by side. Say how they share the width: equal, the lead fills (the others fit their words), or each fits at the start, the end, the middle or both ends. Controls in a row are always one height, the tallest one's, and slant toward each other.
  - `options`: `items: LayoutItem[]`, `widths: "equal" | "lead-fills" | "fit"`, `alignment?: "start" | "end" | "center" | "between"`, `label?: string`
- **Grid** (`grid(options: GridOptions)`, `layout.ts`): Cells of one size, as many to a line as fit: covers, cards, figures. Say what a cell holds and the grid sizes it; it folds to fewer columns as it narrows, to one on a phone, by its own width.
- **Track** (`track(options: TrackOptions)`, `layout.ts`): A row of covers that scrolls sideways, fading at an edge with more past it, a few showing with the next peeking in, its sideways Rail under it while it runs past its room. Under a heading row with its Row arrows (shown only with a mouse), it's a shelf.
  - `options`: `id: string`, `items: LayoutItem[]`, `itemSize: "cover"`, `label?: string`, `whenEmpty: Raw`
- **Columns** (`columns(options: ColumnsOptions)`, `layout.ts`): Two halves of the width side by side, like a game's details beside its rooms and updates. A pane takes the whole width or fits what's in it, so one that should take half the screen goes in a column. One column can stay in view while the other scrolls; they go one over the other where both can't have room.
  - `options`: `columns: [NotControlMarkup, NotControlMarkup]`, `stickyColumn?: "first" | "second"`
- **Pane parts** (`paneParts(options: PanePartsOptions)`, `layout.ts`): A pane's places: its head (words, and one control in its top corner), its body and its foot (something at the start, one control in its bottom corner). A corner control sits in the corner and takes its cut.
  - `options`: `head?: { start?: LayoutControl; words: Raw; end?: LayoutControl }`, `body: Raw`, `foot?: { start?: LayoutItem; end?: LayoutControl }`
- **Screens** (`screens(options: ScreensOptions)`, `screens.ts`): One page on the screens players bring (a phone and a laptop to start; a big phone, a phone on its side, an iPad, a Steam Deck and a 2560 desktop as asked), light and dark, side by side, each with what the measuring check finds. Point at or tap anything in a screen to see what it is and which rule placed it. It's where a page is reviewed, never made: the Screens page shows any page this way on a local preview.
  - `options`: `path: string`, `title: string`, `stepsToTake?: readonly StepToTake[]`, `screenNames?: readonly ScreenName[]`, `screensPath?: string`, `account?: string`

### Actions

- **Primary button** (`primaryButton(label: string, options?: PrimaryButtonOptions)`, `actions.ts`): The one thing to do on a screen: Play, Sign in, Next. Never more than one in view, and visible without scrolling.
  - `options`: `id?: string`, `dataAttributes?: Record<string, string>`, `href?: string`, `downloadName?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `formAction?: string`, `isAutofocused?: boolean`, `isBig?: boolean`, `isFullWidth?: boolean`, `isBusy?: boolean`, `busyLabel?: string`, `icon?: IconName`, `isDisabled?: boolean`, `state?: ButtonState`, `isHidden?: boolean`, `trailingText?: string`
- **Secondary button** (`secondaryButton(label: string, options?: SecondaryButtonOptions)`, `actions.ts`): Everything else you can press: Details, Make an account, Cancel. Another way in (a passkey, Google, Discord) is one with the way's mark and color. A delete is a secondary button too, never orange; only its confirm step turns red.
  - `options`: `id?: string`, `dataAttributes?: Record<string, string>`, `href?: string`, `downloadName?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `formAction?: string`, `isAutofocused?: boolean`, `icon?: IconName`, `wayIn?: WayIn`, `tint?: ButtonTint`, `isLabelHidden?: boolean`, `isFullWidth?: boolean`, `isBusy?: boolean`, `state?: ButtonState`, `isBig?: boolean`, `isSmall?: boolean`, `isInWell?: boolean`, `isDisabled?: boolean`, `reactionCount?: number`, `controls?: string`, `isExpanded?: boolean`, `isHidden?: boolean`
- **Tertiary button** (`tertiaryButton(label: string, options?: TertiaryButtonOptions)`, `actions.ts`): The quietest thing to press: words, an icon, or both, with no slab until it's pointed at. Skip for now, Show all, Undo; only its icon, a sheet's Back and Close. Beside a secondary button it's the way out; never the one thing to do.
  - `options`: `id?: string`, `dataAttributes?: Record<string, string>`, `href?: string`, `downloadName?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `formAction?: string`, `isAutofocused?: boolean`, `icon?: IconName`, `isLabelHidden?: boolean`, `isSmall?: boolean`, `controls?: string`, `hasArrow?: boolean`, `isFullWidth?: boolean`, `isDisabled?: boolean`, `isBusy?: boolean`, `state?: ButtonState`
- **Toggle button** (`toggleButton(label: string, options: ToggleButtonOptions)`, `actions.ts`): Something that stays on until it's pressed again: Follow, a like with its count, Mute, a password's Show. Off, it rests level in the glass and carves in as it's pressed; on, its top surface rises from the same place and its orange front surface shows, lit round it on dark glass and shadowed on light. A setting that's on or off on a settings page is a Toggle, the switch.
  - `options`: `isPressed: boolean`, `pressedIcon?: IconName`
- **Card row** (`cardRow(label: string, options?: CardRowOptions)`, `actions.ts`): The card a buy is paid with, as one row you can press to change it: a card mark, its words ("Visa ending 4242") and a chevron. It sits above the buy button in a store panel's foot.
  - `options`: `id?: string`, `dataAttributes?: Record<string, string>`, `href?: string`, `downloadName?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `formAction?: string`, `isAutofocused?: boolean`, `hiddenText?: string`, `changeText?: string`, `cardBrand?: string`, `state?: ButtonState`, `isHidden?: boolean`
- **Link** (`textLink(words: string, href: string, options?: TextLinkOptions)`, `actions.ts`): Words that go somewhere: underlined in orange inside a sentence, plain in a list of links until you point at them. Anything you press that isn't words is a button.
  - `options`: `isQuiet?: boolean`, `isNewTab?: boolean`, `dataAttributes?: Record<string, string>`, `state?: "is-pointed" | "is-focused"`

### Inputs

- **Cut field** (`cutField(options: CutFieldOptions)`, `fields.ts`): Anything you type: a username, an email, a password. Its icon says what goes in; what's wrong is said under it, in words.
  - `options`: `name: string`, `label: string`, `type: "text" | "email" | "search" | "password"`, `icon?: IconName`, `id?: string`, `text?: string`, `placeholder?: string`, `autocomplete?: string`, `isRequired?: boolean`, `error?: string`, `hint?: string`, `inputMode?: "numeric"`, `pattern?: string`, `characterPattern?: string`, `maximumCharacterCount?: number`, `isUppercase?: boolean`, `isPasswordShown?: boolean`, `isReadOnly?: boolean`, `isDisabled?: boolean`, `state?: "is-focused"`
- **PIN field** (`pinField(options: PinFieldOptions)`, `fields.ts`): A PIN, one mark for each digit, filling with light as it's typed. Digits only, never shown; when the last digit goes in the PIN is sent, so there's no button to press. A wrong PIN is said under the marks.
  - `options`: `name: string`, `label: string`, `id?: string`, `digits?: string`, `error?: string`, `isDisabled?: boolean`, `state?: "is-focused"`
- **Search field** (`searchField(options: SearchFieldOptions)`, `fields.ts`): Search on a page, and in the header. "/" jumps to it there, and nothing says so.
  - `options`: `action: string`, `name: string`, `searchText: string`, `placeholder: string`, `label: string`, `keep?: Record<string, string>`, `id?: string`, `suggestionsUrl?: string`, `state?: "is-focused" | "is-open"`, `shownSuggestions?: SearchSuggestions`
- **Long field** (`longField(options: LongFieldOptions)`, `choices.ts`): More than a line of words: a game's description, patch notes, a reply. It grows with what's written, and counts the characters only once the limit is near.
  - `options`: `name: string`, `label: string`, `id?: string`, `text?: string`, `placeholder?: string`, `rowCount: number`, `maximumCharacterCount?: number`, `hint?: string`, `isRequired?: boolean`, `isDisabled?: boolean`, `error?: string`, `state?: "is-focused"`
- **Select field** (`selectField(options: SelectFieldOptions)`, `choices.ts`): One of many, from a list: a region, a language, a category. It opens a list of Zaisma's glass over the field, the pick where the field was, on every device. For one of a few, use Choice cards or a Switch.
  - `options`: `name: string`, `label: string`, `choices: SelectChoice[]`, `pickedValue?: string`, `placeholder?: string`, `id?: string`, `icon?: IconName`, `isDisabled?: boolean`, `error?: string`, `dataAttributes?: Record<string, string>`, `state?: "is-focused" | "is-open"`
- **Wheel field** (`wheelField(options: WheelFieldOptions)`, `fields.ts`): A value made of parts read together, picked on wheels: a birthday (starting blank, so nothing suggests an age), when something happens (in your own time zone, which its time ends with), or wheels of a page's own, like a match's length. One of many from a list is a Select field; a number on a scale, a Slider.
  - `options`: `name: string`, `label: string`, `wheelKind: "birthday" | "date-time" | "custom"`, `columns?: WheelColumn[]`, `id?: string`, `icon?: IconName`, `pickedValue?: string`, `minimumAt?: string`, `hint?: string`, `error?: string`, `isRequired?: boolean`, `state?: "open" | "marked" | "is-focused"`
- **Copy field** (`copyField(options: CopyFieldOptions)`, `inputs.ts`): Something to copy and keep: a game's link, a room's, an API key shown once, an upload command. Words on one line by default, which a press anywhere copies; code shows all of it in code's letters. For something to type, use a Cut field.
  - `options`: `label: string`, `copiedText: string`, `isCode?: boolean`, `id?: string`, `isMasked?: boolean`, `state?: "is-copied" | "is-pointed" | "is-focused"`
- **Switch** (`tabSwitch(options: { … })`, `switch.ts`): Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small). Of links, a page's own sections under its title (a game's dashboard, a profile); stacked, a page's own places down its side.
  - `options`: `label: string`, `tabs: SwitchTab[]`, `switchSize: "big" | "regular" | "small"`, `isVertical?: boolean`, `isFull?: boolean`
- **Check field** (`checkField(options: CheckFieldOptions)`, `choices.ts`): A yes or no sent with its form: I agree, Email me replies. A small carved socket; ticked, an orange piece with a dark tick slides up into it and seats flush. On a page that saves at once, use a Toggle.
  - `options`: `name: string`, `label: string`, `isChecked?: boolean`, `hint?: string`, `checkValue?: string`, `isRequired?: boolean`, `error?: string`, `isDisabled?: boolean`, `id?: string`, `state?: PressState`
- **Choice cards** (`choiceCards(options: ChoiceCardsOptions)`, `choices.ts`): One of a few, when each needs a line to say what it means: who can see a game, how its rooms run. Compact for many (a report's reasons): close together down a carved well that scrolls. The picked one rises as the white slab, orange light along its leading edge (its foot side by side, its start stacked); the rest sit carved and quieter.
  - `options`: `name: string`, `label: string`, `isLabelHidden?: boolean`, `choices: ChoiceCard[]`, `pickedValue?: string`, `id?: string`, `isCompact?: boolean`, `error?: string`, `isDisabled?: boolean`, `state?: PressState`
- **Toggle**: On or off for a setting: Cloud saves, Show me online. A white slab that springs across a carved slot, which fills orange when it's on. It ends a row of List rows (a row's switch), and the whole row is its label: a press anywhere on it flips it. A row may hold the settings that only matter while it's on, in a well under it. It's a checkbox in its form, so it posts without a script.
- **Slider** (`slider(options: SliderOptions)`, `inputs.ts`): A number on a scale: players in a room, a volume. Dragged, tapped or stepped with the arrow keys; the number shows with its unit as it moves. There are no knobs: this covers them.
  - `options`: `name: string`, `label: string`, `minimumNumber: number`, `maximumNumber: number`, `stepNumber: number`, `pickedNumber: number`, `unit: string`, `isDisabled?: boolean`, `id?: string`, `state?: "is-focused" | "is-pressed"`
- **File drop** (`fileDrop(options: FileDropOptions)`, `inputs.ts`): Handing over files: a game's build, a cover, a screenshot for a report. Drop them on it, tap it, or reach it by keyboard; what's picked is listed with its size.
  - `options`: `name: string`, `label: string`, `accept: string`, `isMultiple?: boolean`, `hint: string`, `maximumByteCount?: number`, `error?: string`, `pickedFiles?: FileDropFile[]`, `isDisabled?: boolean`, `id?: string`, `state?: "over"`
- **Color field** (`colorField(options: ColorFieldOptions)`, `inputs.ts`): Any color: a game's accent, the glass's hue. A field with its color and hex code that opens a color square carved into glass, beside a field for the hex code and the brightness, and None when it can be left empty. Typing a code moves the square's slab to it.
  - `options`: `name: string`, `label: string`, `id?: string`, `pickedValue: string`, `isNoneAllowed?: boolean`, `state?: "open" | "is-focused"`

### Navigation

- **Header** (`header(options: HeaderOptions)`, `navigation.ts`): The top of every page: Zaisma, where you are, search when the page has one, and you. It floats as glass and slims once the page scrolls.
  - `options`: `current: HeaderTab | null`, `search?: SearchFieldOptions`, `account?: { username: string } | null`, `isOnDeveloperPage: boolean`, `isOnSignInPage?: boolean`, `ownTabs?: SwitchTab[]`, `yourGamesHref?: string`, `hasPageRunner?: boolean`, `isCompact?: boolean`, `isWaiting?: boolean`, `isMenuOpen?: boolean`, `isSearchOpen?: boolean`, `id?: string`, `sidebarButton?: ControlMarkup`
- **Account button** (`accountButton(options: AccountButtonOptions)`, `navigation.ts`): You, at the header's end once you're signed in: your picture alone is the button, a slab as tall as the controls beside it. It opens the account menu, which names you.
  - `options`: `username: string`, `menuId: string`, `isMenuOpen?: boolean`, `state?: "is-pointed" | "is-pressed" | "is-focused"`
- **Footer** (`footer()`, `navigation.ts`): The end of every page: for game developers, the forum, the source and the rules.
- **Playing bar** (`playingBar(options: PlayingBarOptions)`, `playing.ts`): The one slim bar beside a running game: Zaisma's mark back to every game, the game's name, and its small buttons. Everything else on the page steps aside while a game plays; on a landscape phone the bar runs down the left edge.
  - `options`: `title: string`, `controls: ControlMarkup[]`, `isShown?: boolean`, `shownAs?: "phone" | "phone-sideways"`
- **Row arrows** (`rowArrows(options: RowArrowsOptions)`, `actions.ts`): Scrolling a row of games with a mouse or trackpad: two raised slabs in a carved well. At a row's end that arrow lies flat; touch screens swipe instead.
  - `options`: `rowName: string`, `trackId: string`, `scrolledTo?: "middle" | "end"`
- **Shelf** (`shelf(options: ShelfOptions)`, `navigation.ts`): A row of games under its heading: the home's Popular, Trending and Continue playing. Its sort and its arrows sit at the heading's end; its covers scroll sideways, a few showing with the next peeking in.
  - `options`: `id: string`, `trackId: string`, `title: string`, `titleHref?: string`, `sortTabs?: SwitchTab[]`, `items: LayoutItem[]`, `emptyText?: string`, `scrolledTo?: "middle" | "end"`
- **Load more** (`loadMore(options: LoadMoreOptions)`, `navigation.ts`): Under a long list (versions, players, topics): the next page added in place, busy while it comes; under a grid of covers it loads by itself as you scroll. Without scripts it's a link to that page.
  - `options`: `href?: string`, `label: string`, `listId: string`, `moreListIds?: string[]`, `isLoadedOnScroll?: boolean`, `endText?: string`, `isFailed?: boolean`
- **Pager** (`pager(options: PagerOptions)`, `reading.ts`): Newer and Older under a list read a page at a time, like a topic's replies. The end you're at can't be pressed. A list you add to in place has Load more instead.
  - `options`: `label: string`, `newerHref?: string`, `olderHref?: string`
- **Sidebar** (`sidebar(options: SidebarOptions)`, `navigation.ts`): A page's own places down its side: the gallery's groups, Developer settings' Hosting, Pro and Keys. One pane of glass under the header, to the screen's foot; only the page you're on is on a slab, and a group opens like a folder. Its button, at the header's start, folds it away and the page glides into the width; on a phone the same button slides it over the page. Never a sidebar built in place.
  - `options`: `id: string`, `label: string`, `places: SidebarPlace[]`, `rememberKey: string`
- **Breadcrumbs** (`breadcrumbs(options: BreadcrumbsOptions)`, `reading.ts`): Where a page sits: the pages above it as quiet links, a chevron between, this one last. For pages a few levels deep, like a forum topic or a game's version. On a phone it scrolls sideways rather than wrapping.
  - `options`: `trail: { label: string; href: string }[]`, `current: string`

### Panes

- **Thickness**: Glass comes in four thicknesses, and each material is one of them wherever it's used: a tray the thinnest, a floating pane, a sheet, a notice and a playing card thin (what's under them is blurred), every glass pane regular. Thick is there to try. A component never picks its own.
- **Glass pane** (`glassPane(options: GlassPaneOptions)`, `foundations.ts`): A sheet of glass that holds a task: signing in, a game at a glance, a form. It's as wide as what holds it, or as wide as what's in it, its paragraphs running to a reading width at most; never a width of its own. Its content scrolls inside it rather than shrinking. A game's page starts its pane lower on a phone (isStartedLow), so the game's art shows above it. Not for a task that comes and goes over the page (a Sheet) or choices that hang from a button (a Floating pane).
  - `options`: `paneWidth: "full" | "fit"`, `body: LayoutMarkup`, `label?: string`, `isStartedLow?: boolean`, `isAtStart?: boolean`
- **Tray** (`tray(options: { … })`, `foundations.ts`): One sheet of the thinnest glass holding everything that belongs to its head: the words on a step of thicker glass across its top, what they're about on the clear glass beneath, read as one. Every gallery section is one. Never on its own: a tray runs on from the pane whose words it belongs to; a second task is a Glass pane of its own.
  - `options`: `head: Raw`, `body: LayoutMarkup`, `label?: string`, `paneWidth?: "full" | "fit"`
- **Floating pane** (`floatingPane(options: FloatingPaneOptions)`, `foundations.ts`): A pane of the menus' glass that hangs from what opens it, over everything on the page: under it (a menu, a search's list) or over it, its pick on the anchor's own line (a select's list, the wheels). Every dropdown, list and picker that floats is one; it does all the floating once, so none of them redo it. Not for a task with fields and buttons: that's a Sheet.
  - `options`: `id: string`, `head?: Raw`, `body: Raw`, `placement: "under" | "over"`, `kind?: string`, `hasParts?: boolean`, `role?: "menu" | "group"`, `edgeLight?: "left"`, `label?: string`, `isShownInPlace?: boolean`, `lineFromTop?: string`
- **Carving** (`carving(options: CarvingOptions)`, `materials.ts`): The glass cut away: what holds things (a well, a switch's tabs) and what you put things in (a field), shaded under its top edge and lit along its foot. Deep, it's a groove or a toggle's slot. Every field, well, slot and groove is one; nothing else is carved.
  - `options`: `body: Raw`, `isDeep?: boolean`, `isCompact?: boolean`, `isUsed?: boolean`, `state?: "is-pointed" | "is-focused"`, `cornerCutPx?: number`, `kind?: string`
- **Slab** (`slab(options: SlabOptions)`, `materials.ts`): A raised piece of the same glass, clearer than the pane under it and casting its shadow on it: what you press or move (a button, a switch's tab, a thumb). Lit, it's the orange one, the one thing to do. Pointed at it catches the light; pressed, it sinks into the glass. Nothing else is raised.
  - `options`: `body: Raw`, `isLit?: boolean`, `slabSize?: "compact" | "regular" | "big"`, `state?: "is-pointed" | "is-pressed" | "is-focused" | "is-disabled"`, `isWaiting?: boolean`
- **Light**: The light in the glass, owned here and nowhere else. The light a well or pane catches on its edge as you point at what's in it: the whole edge wakes, and beside the part you point at the edge brightens and floods up into the glass, gliding along as you move. A switch's tabs and places use it; it's never a slab or a line laid in the glass. What's picked is carved or raised, never lit.
- **Waiting** (`primaryButton(label: string, options?: PrimaryButtonOptions)`, `actions.ts`): What anything pressed shows while it waits on its answer: it stays pressed and a glint runs across its face, one after another, until the answer comes; a press that opens another page stays pressed and, if the page takes more than half a second, fills the header's bottom edge with light instead. A control lights at once and never changes the size of what waits, so nothing moves. Every control that can wait takes it from here; none draws its own.
  - `options`: `id?: string`, `dataAttributes?: Record<string, string>`, `href?: string`, `downloadName?: string`, `type?: "submit" | "button"`, `name?: string`, `buttonValue?: string`, `formMethod?: "dialog"`, `formAction?: string`, `isAutofocused?: boolean`, `isBig?: boolean`, `isFullWidth?: boolean`, `isBusy?: boolean`, `busyLabel?: string`, `icon?: IconName`, `isDisabled?: boolean`, `state?: ButtonState`, `isHidden?: boolean`, `trailingText?: string`
- **Rail** (`rail(scrollKind: "box" | "page" | "side")`, `navigation.ts`): Zaisma's own scrollbar, on every device: a channel carved in the glass with a slab sliding in it, at the frame gap from the glass's edges, its ends slanted so the thumb slides flush into them, or square where they meet a square corner. It rests faintly, wakes while things move, and drags with a finger or the mouse.
- **Groove** (`groove(options?: GrooveOptions)`, `foundations.ts`): A channel carved into the glass that fills with orange light from its start: how far along something is. A Slider's line and a Progress's track are one; with no end known yet, a light runs along it. It shows and is never pressed: to set a value, a Slider; for the steps of a task, a Step flow.
  - `options`: `filledPct?: number`, `kind?: string`, `isWorking?: boolean`, `lightMarkup?: Raw`
- **Well** (`well(options: WellOptions)`, `foundations.ts`): A box carved into a pane's glass that holds things and is never a control itself: code to copy, a link, a line of words, a list of choices. One gallery control can sit at its end, as Copy does; what's longer than it can show scrolls inside it. A field or a carved button is carved too, but it's what you use, so it isn't a well. For glass that holds a task, use a Glass pane; for something to type in, a Cut field.
  - `options`: `body: Raw`, `end?: ControlMarkup`, `endNote?: Raw`, `kind?: string`, `state?: "is-focused"`, `isUsed?: boolean`, `scrollDirection?: "down" | "across"`, `cornerCutPx?: number`, `edgeLight?: "left" | "bottom"`
- **Divider** (`divider(options?: { … })`, `foundations.ts`): A hairline across a pane between two parts of it: a menu's head and its choices, a group of choices and Clear filters. With a word or two in its middle, between two ways to do one thing: or, between signing in with a password and with a passkey. Not between parts that aren't alternatives or one whole: the gap between them does that.
  - `options`: `words?: string`, `isDecorative?: boolean`
- **Dropdown** (`dropdown(options: DropdownOptions)`, `panes.ts`): A short list of choices that hangs from a button, like the account button's in the header: with a head, rules, icons, counts and the current one, as each needs. A choice that's hard to take back asks first, in a confirm sheet. Not for a task with fields (a Sheet) or a value in a form (a Select field).
  - `options`: `id: string`, `label: string`, `head?: { title: string; note?: string; lineId?: string }`, `items: DropdownItem[]`, `isOpen?: boolean`
- **Filter menu** (`filterMenu(options: FilterMenuOptions)`, `navigation.ts`): The ways to narrow a list, in one menu from a Filter button that counts the ones in use: each way says what's picked, and opens its choices in the same pane, with a way back. Not for one order to sort by: a Dropdown.
  - `options`: `id: string`, `groups: FilterGroup[]`, `clearHref: string`, `filterCount: number`, `isOpen?: boolean`, `openGroupName?: string`
- **Game card** (`gameCard(options: GameCardOptions)`, `panes.ts`): A game in a list of games (the home's shelves, Browse, More from a developer): the studio's art in a carved well, its title and players now on one line under it. Everything else lies in a corner of the art, each kind always in its own: Updated top left, a price top right, friends playing bottom left, this device bottom right. Pointed at, its foot lights in the game's tint.
  - `options`: `title: string`, `picture: ShownPicture | null`, `href: string`, `facts: GameCardFacts`, `tintColor?: string | null`, `isCurrent?: boolean`, `isEager?: boolean`, `hasHighPriority?: boolean`, `state?: "is-pointed" | "is-pressed"`
- **Light box** (`lightBox(options: LightBoxOptions)`, `light-box.ts`): One thing large in the middle of a dimmed screen, like a QR code to hold up to a friend across a room: nothing else round it, and a press anywhere, Close or Esc takes it away, back to the sheet that opened it. Not for something to read or act on: that's a Sheet.
  - `options`: `id: string`, `label: string`, `body: Raw`, `closeLabel: string`
- **Sheet** (`sheet(options: SheetOptions)`, `panes.ts`): A task that comes and goes over the page: report a game, block someone, add a key. Opened by a button that names it: on a phone it rises from the foot, on a wide screen it hangs from that button like a dropdown, under it or above it; Esc, its close button or a press beside it close it, and it drops away as it goes in every browser (it stays open while it leaves, so no browser drops it early or draws it out of place). Its title, Close and its buttons stay in view while the rest scrolls. A task of steps moves forward inside it with Back, and tabs in its head swap what's in it; a confirm opens a size smaller on top, never more than two deep. Not for one yes or no (a Confirm sheet) or a moment that just happened (a Notice).
- **Confirm sheet** (`confirmSheet(options: ConfirmSheetOptions)`, `panes.ts`): One sentence, the action and Cancel, before something that's hard to take back: signing out everywhere, ending a room. Over another sheet it opens a size smaller, and closing it lands on the sheet beneath. A delete's is a secondary button tinted red, the only red in Zaisma, and the button that opens it is a secondary button with a trash icon, never orange. Not for what's easy to take back: do it, and offer Undo in a Notice.
  - `options`: `id: string`, `title: string`, `text: string`, `action: string`, `confirmLabel: string`, `isBusy?: boolean`, `isShown?: boolean`, `isDelete?: boolean`
- **Notice** (`notice(options: NoticeOptions)`, `panes.ts`): A moment that needs the player or just happened, in a small pane of glass that waits its turn: under the header on a page (Saved, Copied, or what went wrong), over a running game's top corner with the game running on (keep your progress, a game asking them to sign in), or urgent news over everything, sheets included (signed out while buying). One that's done leaves by itself; a problem or a question stays until it's answered; urgent ones go over anything
- **Banner** (`banner(options: BannerOptions)`, `panes.ts`): Something that holds while you're on a page, across the top of its content: you're playing as a guest, a version is held, Zaisma's news on the home. A line of words, at most one button, and a Close for what a player can put away. Not for a moment that just happened: that's a Notice.
  - `options`: `text: string`, `icon?: IconName`, `action?: { label: string; href?: string; formAction?: string }`, `closeLabel?: string`, `tone?: "plain" | "warning"`
- **Step flow** (`stepFlow(options: StepFlowOptions)`, `panes.ts`): A task in a few steps, like protecting your account: a pane with a thin step line across its top that fills in orange as you go, the step you're on ending in light, and Back and Next. Not for a task of one screen (a Glass pane), or steps inside a sheet (a Sheet's steps, with Back).
  - `options`: `steps: StepFlowStep[]`, `currentIndex: number`, `body?: Raw`, `action: string`, `finishLabel?: string`, `backHref?: string`, `paneWidth?: "full" | "fit"`
- **Confirm it's you** (`confirmItsYouSheet(options: ConfirmItsYouOptions)`, `confirm-its-you.ts`): A small dialog that opens over anything and asks the player to prove it's them, the way that suits what they're doing: a passkey, their purchase PIN (for a purchase only) or their password. The page says why in one sentence and gives it the function that sends the proof; a right proof closes it and the page goes on by itself, so the button that asked is pressed once. In the middle of a wide screen, risen from the foot on a phone.
  - `options`: `id: string`, `method?: ConfirmMethod`, `otherMethods?: ConfirmMethod[]`, `reasonText?: string`, `errorText?: string`, `isBusy?: boolean`, `isShown?: boolean`
- **Store panel** (`storePanel(options: StorePanelOptions)`, `panes.ts`): Where a player buys. Over a running game it's short, at the screen's bottom right, and the game keeps going: the game's cover small beside the item's name and what it is, the saved card, and Buy carrying the price, one press, then who sells it; the refund terms go in the receipt's email. On a page (buying a whole game on its page, or in Zaisma's window for a game on its own site) it's centered over the dimmed page, with the cover large, what it is and the full terms. Apple Pay and Google Pay sit over the card when offered. Pressing Buy is the confirmation: only when Zaisma needs to know it's them does Confirm it's you ask first. Bought closes by itself a moment later.
  - `options`: `id: string`, `closeLabel: string`, `soldItem: StorePanelItem`, `isOverGame?: boolean`, `momentItems?: LayoutItem[]`, `footItems: LayoutItem[]`, `action?: string`, `isShown?: boolean`
- **Stripe frame** (`stripeFrame(options: StripeFrameOptions)`, `stripe-frame.ts`): An empty window Stripe draws in: its card form, Apple Pay and Google Pay, and a bank's check that the player is who they say. Stripe.js loads only inside it, never on the page around it. It has nothing of its own to show, so there's no example here: it sits in the Store panel, where the card form and the wallet buttons go, as tall as what Stripe draws, and covers the whole window while a bank asks the player to confirm.
  - `options`: `id: string`, `title: string`

### Data

- **Picture frame** (`pictureFrame(username: string, pictureSize: PictureSize, options?: { … })`, `data.ts`): An account's picture, always in its frame of glass: in the account button, beside a friend's name, at the head of a profile.
  - `options`: `presence?: "online" | "playing"`
- **Picture row** (`pictureRow(usernames: string[], pictureSize: PictureSize)`, `data.ts`): Friends' pictures together: front to back, each lying over the next with a small shadow, all square. Past three, the rest are a +N.
- **QR code** (`qrCode(options: QrCodeOptions)`, `qr-code.ts`): A link as a picture a phone's camera reads: a game's address, or a room's, for someone in the same room. Black on a raised white tile whatever the glass, the game's icon at its middle, with a line saying what it opens.
  - `options`: `id: string`, `label: string`, `caption: string`, `imageUrl?: string`, `iconUrl?: string`, `isMasked?: boolean`, `isLarge?: boolean`, `download?: { svgUrl: string; fileName: string }`
- **Screenshot** (`screenshot(options: ScreenshotOptions)`, `playing.ts`): A game's screenshot in its row of them, in a carved well cut like a game card's; it opens large in a sheet, whole, as big as the screen allows.
  - `options`: `picture: ShownPicture`, `label: string`, `sheetId: string`
- **Person** (`person(options: PersonOptions)`, `people.ts`): Someone on Zaisma named on a page: a game's developer, a post's author, a friend in a room. Their picture in its frame, their name a quiet link to their profile, a line about them, and at most one thing to do at the end. A list of people is List rows, each led by their picture.
  - `options`: `username: string`, `href: string`, `note?: string`, `pictureSize?: "sm" | "md"`, `presence?: "online" | "playing"`, `marks?: Raw`, `end?: ControlMarkup`
- **Tag** (`tag(words: string | number, tone: TagTone, options?: { … })`, `foundations.ts`): A few words or a number carved into what they label, slanted at both ends: Updated on a game, the count of unread topics on a place, a version's state. On glass, a mark's name on the rail. Removable, a filter in use under a list's Filter button, which a press takes away.
  - `options`: `icon?: IconName`, `removeHref?: string`
- **Glance facts** (`glanceFacts(facts: GlanceFacts)`, `data.ts`): What concerns you about a game at a glance: players now, friends playing, when you played, an update. Only what's true, one line each.
  - `facts`: `playerCount?: number`, `playedAtMs?: number`, `updatedAtMs?: number`, `updatesHref?: string`, `friends?: { username: string }[]`, `friendsRefusalNotes?: string[]`, `deviceNote?: string`, `priceText?: string`
- **List rows** (`listRows(options: { … })`, `data.ts`): A list of things on glass, one a row with hairlines between: versions, keys, topics, players, settings. A row that goes somewhere is a link as a whole, ending in a chevron that steps on as you point; a row that does something (Block, Show QR code) is a button as a whole; a row to read may end in any control, a button or a select; a row for a setting ends in its switch (Toggle) and is pressed as a whole, holding the settings it turns on in a well under it. Words and the control at a row's end keep one margin, so a row reads as one thing. A row may open instead, pressed as a whole, what's folded under it showing in a well under it: something out of the way (blocked people, earlier entries) or things to scan by a title and a line (the content rules).
  - `options`: `rows: ListRow[]`, `whenEmpty: Raw`, `id?: string`, `label?: string`, `shownRowCount?: number`, `isCompact?: boolean`
- **Table** (`table(options: TableOptions)`, `data.ts`): Rows to compare: versions, requests, players, logs. Its header stays as the rows scroll under it, numbers line up on the right, and on a phone it scrolls sideways rather than folding rows into cards.
  - `options`: `caption: string`, `columns: TableColumn[]`, `rows: (Raw | string | TableCell)[][]`, `hasRowHeads?: boolean`, `isCompact?: boolean`, `shownRowCount?: number`, `rowsPlaceholder?: Raw`, `whenEmpty: Raw`, `id?: string`
- **Facts** (`facts(options: FactsOptions)`, `reading.ts`): What something is, in a few short facts, each a quiet label with its words: who a game is for and what it runs on (side by side), or a version's or a key's details (one a line).
  - `options`: `facts: Fact[]`, `arrangement: "across" | "down"`, `label?: string`
- **Numbers** (`numbers(options: { … })`, `data.ts`): A row of figures to take in at a glance: players, hours, plays. Each figure is big, its label sits under it, and how it moved is green when it's good news.
  - `options`: `items: NumberItem[]`
- **Chart** (`chart(options: ChartOptions)`, `data.ts`): How something moved over time, drawn on the page with nothing to wait for: a line or bars on a hairline grid, the last point marked with its number, and any point's number where you point or step with the arrow keys. Or how a whole splits, as a ring with its key. Screen readers get the same numbers.
  - `options`: `label: string`, `points: ChartPoint[]`, `unit: string`, `chartKind?: "line" | "bars" | "ring"`, `pointedIndex?: number`
- **Usage meter** (`usageMeter(options: UsageMeterOptions)`, `data.ts`): How much of an allowance is used: player-hours, requests, storage. A Groove fills in its orange light, turns red from 80%, and says so when it's all used, or over.
  - `options`: `label: string`, `usedNumber: number`, `limitNumber: number`, `unit: string`, `resetDate?: string`, `shownWords?: string`, `warnFromNumber?: number`, `isFullFine?: boolean`, `parts?: UsagePart[]`
- **Usage track** (`usageTrack(options: UsageMeterOptions)`, `data.ts`): A usage meter's track and its parts' key alone, for a list row or a plate whose own lines say the numbers: a game's hosting in developer settings and on its dashboard.
  - `options`: `label: string`, `usedNumber: number`, `limitNumber: number`, `unit: string`, `resetDate?: string`, `shownWords?: string`, `warnFromNumber?: number`, `isFullFine?: boolean`, `parts?: UsagePart[]`
- **Progress** (`progress(options: ProgressOptions)`, `reading.ts`): A task on its way that takes a while, like an upload or a scan: a Groove filling with orange light as it goes, and how much is done in words. With no end known yet, a light runs along it.
  - `options`: `label: string`, `doneNumber?: number`, `totalNumber?: number`, `unit?: string`
- **Empty state** (`emptyState(options: StateNoteOptions)`, `data.ts`): Where a list has nothing yet: what will be here, how it gets here, and the button that starts it. In the voice, never a picture.
  - `options`: `title: string`, `text: string`, `action?: ControlMarkup`
- **Problem state** (`problemState(options: StateNoteOptions)`, `data.ts`): Where content couldn't come: what went wrong in plain words, and what to do about it, like Try again.
  - `options`: `title: string`, `text: string`, `action?: ControlMarkup`
- **Done state** (`doneState(options: StateNoteOptions)`, `data.ts`): Where a task just ended, in place of it: what was done and what happens next, like a report sent. A moment that passes is a Notice instead.
  - `options`: `title: string`, `text: string`, `action?: ControlMarkup`
- **Loading state** (`loadingState(options: { … })`, `data.ts`): Where content is on its way: a hairline with a light running along it, and what's coming. Never a spinner over content; something pressed that's waiting lights its own edge instead.
  - `options`: `label: string`
- **Reading text** (`readingText(options: ReadingTextOptions)`, `reading.ts`): Words to read: a forum post, the rules, a game's description, its patch notes. Paragraphs in the system's own face, each line at most a reading width long, with headings, lists, quotes, code and tables spaced by what's on each side.
  - `options`: `markup: Raw`, `label?: string`
- **Post** (`post(options: PostOptions)`, `people.ts`): What someone wrote: a forum reply, a game's update. Its author and when, the words as Reading text, and what you can do with it at its foot. A list of posts has a hairline between each.
  - `options`: `author: { username: string; href: string }`, `postedAtMs: number`, `body: Raw`, `marks?: Raw`, `actions?: ControlMarkup[]`

<!-- catalog:end -->

How the larger ones behave:

- **Header** (`header`): a floating slab of glass, inset from every edge, that slims as the page scrolls. The logo, the tabs (a full Switch: Home, and Your games once its page is built), the page's own search when it has one, and you: Sign in (the runner), or your picture and name opening the account menu (Your profile, Friends, Developer, Settings, Sign out). On a developer page (the dashboard, the forum, `/developers`) the Developer and Forum tabs open out of the end of the tabs; leaving folds them away. Pages are separate loads, so the header remembers whether they were open (`sessionStorage` `zaisma-nav`) and opens or folds them from there. On sign-in's pages it holds the logo alone: no tabs and no end. On a phone it's two rows, the logo, search and you on top and the tabs below, but only when two or more tabs show: a row of one tab isn't a choice (the logo already goes home), so a guest's phone header is one row. On a page with a runner of its own (Play, Save), its Sign in is a secondary button, so only one runner is ever in view (`hasPageRunner`, set by `layout()`). Its height is `--header-height`, worked out from its rows, and the page starts a block's gap under it. Once the page scrolls it rises and slims to the frame gap round its controls, which keep their size, so only the slab moves.
- **Primary button** (`primaryButton`): the one orange slab, for the page's main action. Every other button is a Secondary button, clear glass with cut ends.
- **Switch** (`tabSwitch`): a carved well with a white slab and the orange line under the one you're on. It's never wider than the room it has: where its tabs don't fit, they keep less room round their words, and a framed one scrolls, snapping to whole tabs, starting where the current one shows whole. On a touch screen it's at least a regular control tall.
- **Rail** (`rail`): Zaisma's own scrollbar, a channel carved in the glass (a deep carving) with the thumb, a white slab, sliding in its groove, for a scrolling box, the page, or a row that scrolls sideways. The channel's ends and the thumb's are always slanted, longest on the side toward what scrolls, so at either end the thumb slides flush into the channel's end, as a switch's slab into its well. Down a box it runs the box's height at `--rail-inset` (the frame gap; the compact one in a carving or compact glass) from the edges of the glass round it, and never past the box; where an end reaches a cut corner, it stops where its slant keeps that gap from the corner's cut. The page's sits in the middle of the page's right gutter, clear of both the screen's edge and the glass. What scrolls keeps `--rail-room` (the channel and a frame gap) beside it. Its marks are hairlines etched across the groove; one name shows at a time, the nearest mark's, and while the thumb is dragged the name of the part it's in rides beside it.
- **Footer** (`footer`): the mark, the links (for game developers, the forum, the source code and the rules) and "Zaisma is open source, under the MIT license." Its quiet links are a block's gap apart, whole on centred rows on a phone, so they never read as one phrase.
- **The shell** (`layout`, `html.ts`): the backdrop, the header, the page and the footer. A page body built before this look sits in `main.steel`, which keeps its old styles inside it and the components' out of it; a component placed in one goes in an element of class `not-steel`. Each page's own rebuild sets `checkedPage`, the name of the state it renders on `CHECKED_PAGES`, and drops `main.steel`: typecheck refuses a name that isn't on the list, so every state a rebuild adds (an error, an empty list, a step) gets its entry, and the layout check fails when an entry's address shows a page that names another.
- **Styles and scripts are files, not page text.** A page links one cached stylesheet (`/css/<name>.<hash>.css`, `page-styles.ts`) and loads the components' script from `/js/` (`page-scripts.ts`), both named for their contents and cached for good, so a page's own markup is all a visit downloads that's new. The components' script is served minified: after changing any component's script, run `npm run components:minify` (a stale one is served readable and a test fails).
- **The page watcher** (`window.zaismaWatch`, `glass-script.ts`): one observer for the whole page that every component asks for size changes, new elements, resizes and scrolls, instead of watching by itself. The edge rule measures every control once per pass before it draws any.

## Motion

- Slabs slide on the spring, `cubic-bezier(.3, 1.2, .4, 1)`, in 0.55s, except a switch's slab: a fixed piece of glass that never changes size, it glides to its tab easing in and out with no overshoot (`cubic-bezier(.4, 0, .2, 1)`, 0.45s, 0.38s small), so it never jumps as it starts or swings past its place and back; a size change (the header slimming) takes 0.45s; anything leaving goes faster than it came.
- Moving between pages never waits and never takes longer than `--motion-page-switch` (0.25s). A link the pointer rests on or presses is prepared ahead (prerendered where the browser can), and on a phone so is every link on screen once scrolling stops (only what's pointed at or pressed with Data Saver on); a prepared page runs none of its scripts and marks nothing until it's opened (`prepared-pages.ts`). The new page's panes fade in while the header and the backdrop stand still, and the header's slab slides from the last page's tab to this one's (Backdrop): each pane's body and what's on it fade, never the pane, so its glass blurs from the start. Opening a game from its cover settles the game's world in from a touch larger, then fades the page's panes in over it (Game background, `PAGE_SWITCH_SCRIPT`). Never a cross-document view transition: in Brave the first press on a page that arrived by one is lost. Reduced motion, a reload and arriving from another site show the page at once.
- A playing card comes in and goes out with a short fade and an 8px slide down from the top (0.25s opacity, 0.3s slide, on `display` too so it can leave), a notice the same; under reduced motion it is a fade only. A card with nothing to press in it (a notification: Saved, a save that didn't go through) also goes on a tap or a click, or a swipe sideways (56px) or up (32px): it follows the finger, fading, and leaves with the same exit, carrying on the way it was going; under reduced motion it doesn't follow. A press on a button or link in a card is never a dismissal, and it leaves through the queue, which then shows the next (`PLAYING_CARD_SCRIPT`, `playing.ts`). A sheet's next step comes in from its end and Back's from its start, a 16px slide and fade in 0.2s.
- Under reduced motion nothing moves; the glass still changes color.

## Backgrounds

Glass is always over something. Zaisma's own pages have its backdrop (`backdrop`, `foundations.ts`): satin in warm gray or graphite whose folds sway slowly, or a still gradient in the same colors where it can't draw. A game's page and its place on the home show the game's own background instead, set by its developer: a picture, a shader or Zaisma's own, for wide screens and phones (the game backgrounds building block). A game's world on its page starts as its placeholder, blurred (`backdropPlaceholder`), until its picture arrives or its shader draws its first frame.

**Scenes.** A live 3D scene is the page only where its job is a first impression. The city (`cityStage()` and `CITY_SCRIPT`, `components/city.ts`) is the sign-in's scene: signing in, making an account and every step between are one glass pane in front of it (on the right on a wide screen, full width at the bottom on a phone). Moving between those steps never loads a new page: `CITY_PANE_SCRIPT` swaps the next step into the pane in place, so the scene runs on unbroken; only leaving sign-in loads a page. It runs on phones too, at a lower resolution, draws at most about 3.2 million pixels on any screen, and steps down further on a slow device. It shows at once as a placeholder, its first frame tiny and blurred inside the page itself, and nothing half-made shows over it: the live city starts as soon as the page has painted, and once it runs smoothly it sharpens in out of the placeholder from that same frame before the camera sets off. Its still, a full render of the same city by day and by night (`brand/sign-in/`), stands in for reduced motion, no WebGL and a device that can't keep the city smooth even at its lowest step; it's loaded only then, and takes the placeholder's place once it has wholly loaded.
