# Design: Steel

How Zaisma looks and behaves. The styles live in `apps/site/src/html.ts` (`STYLES`, `METAL_SCRIPT`, `metalButton`). The approved mockups (home for returning players, first visit, phone, the queue, the game page and an update page) are on the design canvas: https://claude.ai/artifact/CWDh8huHJ5A3CaMBBrtTYV

## Rules

- **Players first.** Show what helps a player decide or act. No feature flexes ("progress saved to your account!") and no jargon ("Connects to", "Purchases").
- **No eyebrows and no ALL CAPS.** Headings are sentences; small print is plain text under the title.
- **Game pictures are only the developer's image.** No text, badges or gradients on covers, screenshots or update images. Titles and buttons sit on the card below.
- **Say game developers**, never creators.
- **Nothing animates on its own.** Motion only answers the player (hover, press, a state change).
- **Layouts only Zaisma would have.** No hero + call-to-action + feature grid + banner. The home page is the player's own: friends, the game they played last, Continue playing, then games for everyone.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#111214` | Page |
| `--panel` | `#1b1c1f` | Cards, tiles, inputs |
| `--panel-2` | `#16171a` | Quiet panels (notes, lists) |
| `--raised` | `#2c2e33` | Secondary buttons, avatars |
| `--pic` | `#2a2b30` | Where a picture loads |
| `--line` / `--line-2` | `#2c2e33` / `#3a3c42` | Dividers / outlines |
| `--text` / `--text-2` / `--muted` | `#ececec` / `#c9cace` / `#9b9da3` | Text, body copy, secondary |
| `--ok` / `--ok-text` / `--ok-bg` | `#5fd38d` / `#b9e7a6` / `#24301f` | Live, playing now, Updated |
| `--danger` / `--warn` | `#ff6b6b` / `#f2c14e` | Errors / held |

Type: **Jost** (headings, `--display`; self-hosted from `brand/fonts/`, close to the Futura the Z is drawn from) and the system font for everything else. Touch targets are at least 44 px.

## Shapes

- **The bevel.** The Z's cut corner, top right: `.bevel-s` (8 px, avatars and small buttons), `.bevel` (14 px, buttons), `.bevel-l` (36 px, the big game picture). No rounded corners.
- **The metal edge.** `.edge`: a black line outside and a white one top-left, like the Z's edges. Marks the selected thing (the game on the stage, an invite).

## Metal

The primary action on a page is a metal plate: `metalButton(label, { href | id, big, block, play })`. Only one or two per screen.

- On hover it tilts toward the cursor, less the bigger it is (up to about 13° for a small button).
- The glint is the reflection of a fixed light above and to the left. It slides across the tilted plate, the opposite way to the cursor and faster, and dims as the plate turns away; at steep angles it slides off the edge.
- The label and icon are stamped in: they take no light and get a bright lip below.
- Game cards (`.tile`) tilt a little; their picture (`.pic`) reflects like glass, a sharp line plus a soft haze, and the card body is matte.
- The hover area is a wrapper that never tilts (`.hit`), so tilting can't push the cursor out and back in.
- Phones (no hover) get the still plate. Reduced motion keeps the glint and drops the tilt.

## Components

- **Buttons:** `.btn` (secondary), `.btn.light`, `.btn.ghost` (outline), `.btn.danger`, `.btn.big`; metal for the main action.
- **Game card:** `.tile` with `.pic` (the developer's image), `.body` with `.name` (title, optional `small` line or `.badge`) and `.go` (the Play or Continue button).
- **Updated badge:** `.badge`, a green square and the word "Updated". Updates never get their own cards on the home page.
- **Segmented toggle:** `.seg` with `aria-pressed` or `aria-current` (Recently played / Recently updated; Popular / Trending / New).
- **Notes:** `.note` for plain information, like the guest note on a first visit.
- **Brand links** on game pages carry their own logo and colors (Discord, Steam, itch.io, YouTube); a plain website link is an outline with a globe.
- **Scrollbars:** thin and dark, no track.
