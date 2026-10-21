# Design: Steel

Every component, in every state, is on [zaisma.com/design](https://zaisma.com/design), rendered from the site's own code (`apps/site/src/components/`).

How Zaisma looks and behaves until the redesign at the end of Phase 1, when Julius and Claude settle a new look, voice, logo and wordmark from what Zaisma stands for (`docs/PLAN.md`) and every page is rebuilt in it (Look and voice in `docs/ROADMAP.md`). The styles live in `apps/site/src/html.ts` (`STYLES`, `METAL_SCRIPT`, `AMBIENT_SCRIPT`, `metalButton`, `ambient`).

Steel is a theme, not a flat UI: like a console's big-screen mode, every page is made of materials and lit by the game on it. Three materials, and nothing else:

- **The ground:** deep steel with a fine grain, lit from the top left. The current game's art, heavily blurred, fills the screen behind everything (`ambient`), and pointing at any game card fades the screen to that game's colors.
- **Gunmetal plates:** every surface (cards, panels, notes, the header, buttons). A brushed face (`--brush`), a lit top-left rim and a dark bottom-right rim (`--rim`), a drop shadow, and the Z's cut corner with its edge catching the light (`.bevel`, `.bevel-l`, `.bevel-s`).
- **Chrome:** only what matters most: the main action (`metalButton`, `.btn.light`), the focus frame on a game card, and the rail under the current page or tab. The approved mockups (home for returning players, first visit, phone, the queue, the game page and an update page) are on the design canvas: https://claude.ai/artifact/CWDh8huHJ5A3CaMBBrtTYV

## Rules

- **Players first.** Show what helps a player decide or act. No feature flexes ("progress saved to your account!") and no jargon ("Connects to", "Purchases").
- **No eyebrows and no ALL CAPS.** Headings are sentences; small print is plain text under the title.
- **Game pictures are only the developer's image.** We draw no text, badges or gradients over covers, screenshots or update images (the one exception: the small Updated flag on Continue playing cards). The cover is the whole card, so developers put their game's name or logo on it themselves; titles and buttons we draw sit beside a picture, never on it.
- **Say game developers**, never creators.
- **Nothing animates on its own.** Motion only answers the player (hover, press, a state change).
- **Not flat.** Every surface is one of the three materials; no plain grey boxes, no hairline-only cards.
- **Cover-less games get the engraved Z**, never an empty box.
- **Layouts only Zaisma would have.** No hero + call-to-action + feature grid + banner. The home page is the player's own: friends, the game they played last, Continue playing, then games for everyone.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0b0d10` | The ground under everything |
| `--face` / `--face-hi` | gunmetal gradients | Plates / buttons and raised plates |
| `--chrome` | light-to-dark steel gradient | Main action, focus frame, current rail |
| `--brush` / `--grain` | generated textures | Brushed plates / the ground and empty pictures |
| `--rim` / `--drop` | inset light and dark edges / shadow | Every plate |
| `--text` / `--text-2` / `--muted` | `#eceef0` / `#c6c9ce` / `#969ba4` | Text, body copy, secondary |
| `--ok` / `--ok-text` / `--ok-bg` | `#5fd38d` / `#b9e7a6` / `#1f2b1c` | Live, playing now, Updated (with a soft glow) |
| `--danger` / `--warn` | `#ff6b6b` / `#f2c14e` | Errors / held and warnings |

Type: **Jost** (`--display`; self-hosted, close to the Futura the Z is drawn from) for headings and every label you press or read at a glance: buttons, tabs, nav, chips, game titles. Headings are engraved (a dark shadow below, a faint light above). The system font is for body copy. Touch targets are at least 44 px.

## Shapes

- **The bevel.** The Z's cut corner, top right: `.bevel-s` (8 px, avatars and small buttons), `.bevel` (14 px, buttons), `.bevel-l` (36 px, the big game picture). No rounded corners.
- **The edge rule: bevels come from where a thing sits, never from the thing.** In the components (`apps/site/src/components/`), only a pane has corners of its own: 24 and 20, the header and the gallery's bar 20 and 14, menus 18 and 14. Everything inside, whether a control, a picture frame or a colour swatch, carries `data-cut-line`, and the edge rule (`GLASS_SCRIPT` in `foundations.ts`) gives it its shape as `--cut-shape`, the only thing its CSS clips to:
  - **In a pane's middle, it's square.** A swatch in the middle of the colour pane, a face in the middle of a glance line.
  - **Near a pane's corner, it follows that corner at a fixed gap.** A full-width button alone in a pane is cut at all four corners. The swatch in the colour pane's top left is cut only there.
  - **Beside another in a row, it slants toward it** (`.control-row`, `--control-slant`): Play and Details, a row of friends' faces.
  - **Stacked, it's square between.** The sign-in buttons are cut only at the stack's top and bottom.
  - **On no pane, it's cut as if it were in one:** 16 and 8, at most a quarter of its short side.

  Its outline (the ring round a picture, a swatch's line, focus) is the cut line's stroke, so it follows the same shape. The few shapes that aren't the rule's (the scroll rail, tags, a cover's line, the glass demo's backdrop shapes) are named, with their reason, in `HAND_CUT` in `test/site/design.test.ts`. The gallery's Cut shapes shows each case.
- **The metal edge.** `.edge`: a black line outside and a white one top-left, like the Z's edges. Marks the selected thing (the game on the stage, an invite).

## Metal

The primary action on a page is a metal plate: `metalButton(label, { href | id, big, block, play })`. Only one or two per screen.

- On hover it tilts toward the cursor, less the bigger it is (up to about 13° for a small button).
- The glint is the reflection of a fixed light above and to the left. It slides across the tilted plate, the opposite way to the cursor and faster, and dims as the plate turns away; at steep angles it slides off the edge.
- The label and icon take no light: they look exactly the same on hover, so only the plate moves.
- Game cards (`.tile`) tilt a little; their picture (`.pic`) reflects like glass, a sharp line plus a soft haze.
- The hover area is a wrapper that never tilts (`.hit`), so tilting can't push the cursor out and back in.
- Phones (no hover) get the still plate. Reduced motion keeps the glint and drops the tilt.

## Spacing

Applies to the components (`apps/site/src/components/`) and the gallery (`apps/site/src/design-page.ts`). Every gap, padding and margin is one of seven tokens, defined once in `foundations.ts`. Pick one by looking at what sits on each side of the space, never by judging how close two things feel.

- A **control** is anything from Actions & Inputs (a button, a field, a switch, the birthday picker).
- **Words** are a heading, a label, a legend, a hint, an error or a line of text.
- A **block** is a group of controls with their words (a labelled field, the sign-in buttons), a paragraph, a picture, or a pane.

| Token | What's on each side | Value |
| --- | --- | --- |
| `--gap-control-row` | Two controls side by side (Play and Details, Light and Dark), measured between their slants: their boxes sit `--gap-control-row-boxes` apart, overlapping by `--control-slant` (10px) less this | 4px |
| `--gap-control-stack` | Two controls stacked (the passkey, Google and Discord buttons) | 8px |
| `--gap-words-control` | A control and the words that belong to it (a field's label above it, its error under it) | 8px |
| `--gap-words-words` | Words beside or under other words in one block (a title and the line under it, links in a row, an icon and its word) | 8px |
| `--gap-block-block` | Two blocks: inside a pane, two panes side by side or stacked, the gallery's examples, a row of covers | 24px |
| `--pad-pane` | A pane's edge and what's inside it; also the page's edge | 24px, 18px on a phone |
| `--pad-inner-pane` | An inner pane's edge and what's inside it (the birthday picker, a menu), and a bar's: a pane one row of controls tall (the header, the gallery's bar) | 12px |

- **If either side is a block, it's `--gap-block-block`,** even when the other side is a single control.
- **In a pane, controls fill its width.** A row of them is a `.control-row` (`foundations.ts`), which shares the pane's width between them, so its ends fit the pane's edges by the edge rule instead of stopping short with square corners.
- **The row's gap is the edge rule's neighbour distance.** Two controls side by side with their boxes `--gap-control-row-boxes` apart slant toward each other by `--control-slant`; any other distance and they don't. A row of controls uses `--gap-control-row-boxes`, a stack `--gap-control-stack`.
- **More room is a multiple of a token**, in `calc` (the gallery's sections are two `--gap-block-block` apart). Never a new number.
- **What isn't spacing keeps its own number:** a control's inside (its words and icon to its own edge, set by each control size), a control's own parts (a switch's tabs and the inset round its slab, the birthday's wheels, a list of places), room to scroll or for a scrollbar, and where a small mark sits on what it marks. Each one is named, with its reason, in `NOT_SPACING` in `test/site/design.test.ts`.

`test/site/design.test.ts` checks both: no other number in any gap, padding or margin, and every row of controls `--gap-control-row-boxes` apart and every stack `--gap-control-stack` apart.

## Components

- **Buttons:** `.btn` (gunmetal plate with the cut corner), `.btn.light` (chrome), `.btn.ghost` (outline), `.btn.danger`, `.btn.big`; the tilting metal plate for the main action. Any button that sends a form or opens a page shows the loader, the Z building itself (`.spin`, `brand/loader/zaisma-loader.svg`), and can't be pressed twice.
- **Game card:** `a.tile` around `.pic`, the developer's cover alone: no nameplate, title or Play button, since a studio's art carries its own name and logo. It opens the game's page; only a Play button starts a game. The title is the link's `aria-label`. A game without a cover gets `.named`, its title engraved over a faint Z. `.flag` is the one note allowed on the art (Updated, on Continue playing). Wrapped in `.hit.block` with `data-art` (the cover): pointing at it or tabbing to it lifts the card into a chrome frame and fades the screen to its art. On phones players' cards are square: the square cover when the game has one (`<picture>`), otherwise the landscape cover whole over a blurred copy of itself (`.wide`, `.fill`), never cropped. The dashboard's own cards add a nameplate (`.body`) for status.
- **Stage:** the home page's game in a machined bezel, its details on a plate beside it (never on top of the art).
- **Spec plate:** on the game page, `dl.spec` rows (Players, Works on, Controls) with icons and words, divided by engraved lines.
- **Section heading:** `.sec-head h2` or `h2.rule-h`, engraved, with a metal rule running to the edge.
- **Tabs and nav:** text on an engraved line; the current one gets the chrome rail.
- **Updated badge:** `.badge`, a green square and the word "Updated". Updates never get their own cards on the home page.
- **Segmented toggle:** `.seg`, a track cut into the metal; the chosen option is a raised plate on a chrome rail (`aria-pressed` or `aria-current`). In a form, `.seg.picks` holds radio buttons the same way, so a few choices show side by side instead of in a dropdown (an API key's access per area).
- **Wizard:** `dialog.wizard`, one plate in the middle of the screen for a task with steps (making an API key): a title and a line saying what this step is for, a body that scrolls on its own, and Back, Next and the final action at the bottom. It keeps one height from step to step.
- **Fields:** cut into the metal (recessed, dark), with a light ring on focus.
- **Notes:** `.note` for plain information, like the guest note on a first visit.
- **Brand links** on game pages carry their own logo and colors (Discord, Steam, itch.io, YouTube); a plain website link is an outline with a globe.
- **Scrollbars:** thin and dark, no track.
- **Header search and action:** a page with its own search and main action puts them in the site header (`layout`'s `search` and `action`), never in a second bar under it. The forum does.
- **Account pictures:** `.av` (`xs`, `sm`, `md`), the account's initials on a plate in its own color with the cut corner, until uploaded pictures come with profiles. An AI's post shows its developer's picture with the AI mark (`.ai-mark`, a small spark) and `.mark.ai` beside the name; Zaisma's posts show the Z on chrome and `.mark.team`. Never "Your AI" in place of a name.
- **A game's dashboard** (`apps/site/src/dashboard.ts`): every section shares the head (cover, title, status and the Who can play toggle), then the sections sit in a rail on the left like the forum's (`.sections`, the current one on the chrome rail), and on phones in one row of tabs along an engraved line. Each section has its own page and layout: Overview (alerts on a warning edge, upload, the latest upload, the live version, plays and recent history beside them), Versions, Details (the form, with cover and screenshots beside it), Players and stats (plays, then Free hosting: the month's player-hours, and requests to its game server, as meters against the free tier, then reports and multiplayer use), Database (the month's use as meters, the tables down the left, and the main column for running SQL).
- **Forum** (`apps/site/src/forum-pages.ts`): the topic list is one plate of dense rows (`.trow`: type icon, title and flags, category, tags and author, the people in it, replies, votes, last activity), with open known issues pinned above it. A rail on the left holds the places and the categories (the current one opens its sub-categories, marked by the chrome rail) and tags; on phones it folds into one row. A topic is posts on plates with a side panel of facts; Zaisma's posts carry a light edge, the answer a green one, and bare status changes are lines in the thread. A known issue shows its phases as a track (`.phases`), the current one lit in chrome. A busy topic's row shows three pictures and how many more. Post text is markdown (`forum-markdown.ts`): code sits in a recessed `figure.code` with its language, Wrap and Copy; mentions are a soft blue chip; links out of Zaisma carry a small ↗ and open through Leaving Zaisma; videos play inline at up to 640 px. Images sit in the text where they were placed; ones an AI sends as media sit in a grid after it. Writing a post has a slim bar over the box: Write and Preview (the post as it will look, from the same renderer), Insert (images, uploaded as you go and placed at the cursor; a link; a video; a code block) and formatting (bold, italic, strikethrough, code, link, heading, bulleted, dashed and numbered lists, quote; ⌘B, ⌘I, ⌘K). The same formatting floats over any text selected in the box, links are added and edited in a small panel, and images can be dropped or pasted straight into the text. Selecting words in any post brings up a chrome Quote button by the selection, and each post has Quote in its footer; quotes go in where the cursor was, as "Name wrote:" linked back to the post, as many as you like.
