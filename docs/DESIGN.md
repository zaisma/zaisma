# Design: Steel

How Zaisma looks and behaves. The styles live in `apps/site/src/html.ts` (`STYLES`, `METAL_SCRIPT`, `AMBIENT_SCRIPT`, `metalButton`, `ambient`).

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
- **The metal edge.** `.edge`: a black line outside and a white one top-left, like the Z's edges. Marks the selected thing (the game on the stage, an invite).

## Metal

The primary action on a page is a metal plate: `metalButton(label, { href | id, big, block, play })`. Only one or two per screen.

- On hover it tilts toward the cursor, less the bigger it is (up to about 13° for a small button).
- The glint is the reflection of a fixed light above and to the left. It slides across the tilted plate, the opposite way to the cursor and faster, and dims as the plate turns away; at steep angles it slides off the edge.
- The label and icon take no light: they look exactly the same on hover, so only the plate moves.
- Game cards (`.tile`) tilt a little; their picture (`.pic`) reflects like glass, a sharp line plus a soft haze.
- The hover area is a wrapper that never tilts (`.hit`), so tilting can't push the cursor out and back in.
- Phones (no hover) get the still plate. Reduced motion keeps the glint and drops the tilt.

## Components

- **Buttons:** `.btn` (gunmetal plate with the cut corner), `.btn.light` (chrome), `.btn.ghost` (outline), `.btn.danger`, `.btn.big`; the tilting metal plate for the main action. Any button that sends a form or opens a page shows the loader, the Z building itself (`.spin`, `brand/loader/zaisma-loader.svg`), and can't be pressed twice.
- **Game card:** `a.tile` around `.pic`, the developer's cover alone: no nameplate, title or Play button, since a studio's art carries its own name and logo. It opens the game's page; only a Play button starts a game. The title is the link's `aria-label`. A game without a cover gets `.named`, its title engraved over a faint Z. `.flag` is the one note allowed on the art (Updated, on Continue playing). Wrapped in `.hit.block` with `data-art` (the cover): pointing at it or tabbing to it lifts the card into a chrome frame and fades the screen to its art. On phones players' cards are square: the square cover when the game has one (`<picture>`), otherwise the landscape cover whole over a blurred copy of itself (`.wide`, `.fill`), never cropped. The dashboard's own cards add a nameplate (`.body`) for status.
- **Stage:** the home page's game in a machined bezel, its details on a plate beside it (never on top of the art).
- **Spec plate:** on the game page, `dl.spec` rows (Players, Works on, Controls) with icons and words, divided by engraved lines.
- **Section heading:** `.sec-head h2` or `h2.rule-h`, engraved, with a metal rule running to the edge.
- **Tabs and nav:** text on an engraved line; the current one gets the chrome rail.
- **Updated badge:** `.badge`, a green square and the word "Updated". Updates never get their own cards on the home page.
- **Segmented toggle:** `.seg`, a track cut into the metal; the chosen option is a raised plate on a chrome rail (`aria-pressed` or `aria-current`).
- **Fields:** cut into the metal (recessed, dark), with a light ring on focus.
- **Notes:** `.note` for plain information, like the guest note on a first visit.
- **Brand links** on game pages carry their own logo and colors (Discord, Steam, itch.io, YouTube); a plain website link is an outline with a globe.
- **Scrollbars:** thin and dark, no track.
- **Header search and action:** a page with its own search and main action puts them in the site header (`layout`'s `search` and `action`), never in a second bar under it. The forum does.
- **Account pictures:** `.av` (`xs`, `sm`, `md`), the account's initials on a plate in its own color with the cut corner, until uploaded pictures come with profiles. An AI's post shows its developer's picture with the AI mark (`.ai-mark`, a small spark) and `.mark.ai` beside the name; Zaisma's posts show the Z on chrome and `.mark.team`. Never "Your AI" in place of a name.
- **Forum** (`apps/site/src/forum-pages.ts`): the topic list is one plate of dense rows (`.trow`: type icon, title and flags, category, tags and author, the people in it, replies, Me too, last activity), with open known issues pinned above it. A rail on the left holds the places and the categories (the current one opens its sub-categories, marked by the chrome rail) and tags; on phones it folds into one row. A topic is posts on plates with a side panel of facts; Zaisma's posts carry a light edge, the answer a green one, and bare status changes are lines in the thread.
