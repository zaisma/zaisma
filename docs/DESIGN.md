# Design: Glass

Every component, in every state, is on [zaisma.com/design](https://zaisma.com/design), rendered from the site's own code (`apps/site/src/components/`). Change a component there and it changes on every page at once.

Zaisma is the glass, and the game is not. Zaisma's interface is a layer of glass over the page: the header, panes, menus and controls are glass, and behind them is the game's own background or Zaisma's. The game's art, its covers and its screen are never glass and never ours to restyle.

## Rules

- **Zaisma is the glass over the game.** Everything of Zaisma's is glass, cut and rimmed the same way; what's behind it is a backdrop, never a flat color.
- **Orange only on what you act on.** The runner button (the one main action), the line under the tab you're on, keyboard focus. Never on words, headings or decoration.
- **Nothing waits on an animation.** A click does its thing at once; motion only shows what already happened.
- **No decoration.** No "Live now" lights, sale banners, badges for their own sake or glows that mean nothing.
- **Buttons move only when pointed at or pressed.** They lift and lean toward the pointer and sink when pressed; at rest they're still. A scene behind the glass may move on its own.
- **No hotkey hints.** "/" jumps to search, and nothing on the page says so.
- **The main action shows without scrolling.**
- **Players first.** Show what helps a player decide or act. Say game developers, never creators.
- **Game pictures are only the developer's image.** Nothing drawn over covers or screenshots: titles and buttons sit beside a picture, never on it.
- **No eyebrows and no ALL CAPS.** Headings are sentences.

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
| `--page` | `#EEF2F7` | `#0D1015` | Under the backdrop, before it draws |
| `--ink` | `#14171C` | `#F7F9FC` | Words |
| `--ink-2` | `#3D444E` | 86% white | Second words, tabs at rest |
| `--muted` | `#59606A` | 70% white | Notes, the footer |
| `--line` | 14% ink | 20% white | Dividers (`--divider`) |
| `--glass-tint` | 50% white | 55% `#0E1118` | A pane's glass |
| `--glass-top` | 56% white | 50% `#12151B` | The header's glass |
| `--field` | 62% white | 8% white | A field's face |
| `--backdrop-*` | pale blue, teal, violet | night blue, teal, violet | Zaisma's own backdrop |

The same in both:

| Token | Value | Use |
| --- | --- | --- |
| `--run` / `--run-hi` / `--run-lo` | `#F7931A` / `#FFB24A` / `#A85A06` | The runner, the current tab's line, focus |
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
- **The drawn rim** (`data-glass`, with `data-glass-corners`): `GLASS_SCRIPT` draws an `svg.edge` sized to the slab: a dark hairline, a polished edge, a bevel band and bright cut facets.
- **Adaptive:** light glass over light things, smoked glass over dark ones, and the words switch with it. The faintest words keep 4.5:1 and the main words 6:1 against the harshest quarter of what's behind.
- **The hue** (`--glass-hue`): a studio's color can tint every piece of glass under where it's set; glass tinted for a brand keeps its own color.
- **A component only sets the glass's variables** (its tint, a layer); it never paints glass of its own. `test/site/design.test.ts` checks it.

## Shapes

- **Cut corners, never rounded.** Panes are cut 24 and 20, the header 20 and 14, menus 18 and 14. Fields and buttons slant 10px where they meet another (`--control-slant`).
- **The edge rule: bevels come from where a thing sits, never from the thing.** In the components (`apps/site/src/components/`), only a pane has corners of its own: 24 and 20, the header and the gallery's bar 20 and 14, menus 18 and 14. Everything inside, whether a control or a color swatch, carries `data-cut-line`, and the edge rule (`GLASS_SCRIPT` in `foundations.ts`) gives it its shape as `--cut-shape`, the only thing its CSS clips to:
  - **In a pane's middle, it's square.** A swatch in the middle of the color pane.
  - **Near a pane's corner, it follows that corner at a fixed gap.** A full-width button alone in a pane is cut at all four corners. The swatch in the color pane's top left is cut only there.
  - **Beside another in a row, it slants toward it** (`.control-row`, `--control-slant`): Play and Details.
  - **Stacked, it's square between.** The sign-in buttons are cut only at the stack's top and bottom.
  - **On no pane, it's cut as if it were in one:** 16 and 8, at most a quarter of its short side.

  Its outline (a swatch's line, focus) is the cut line's stroke, so it follows the same shape. **Profile pictures are the one exception: always square, never bevelled or slanted, alone or in a row** (Picture frame and Picture row, `data.ts`); in a row each lies over the next with a small shadow (`--picture-shadow`). The few shapes that aren't the rule's (the scroll rail, tags, a cover's line, the glass demo's backdrop shapes) are named, with their reason, in `HAND_CUT` in `test/site/design.test.ts`. The gallery's Cut shapes shows each case.

## Spacing

Applies to the components (`apps/site/src/components/`) and the gallery (`apps/site/src/design-page.ts`). Every gap, padding and margin is one of seven tokens, defined once in `foundations.ts`. Pick one by looking at what sits on each side of the space, never by judging how close two things feel.

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
| `--pad-pane` | A pane's edge and what's inside it; also the page's edge | 24px, 18px on a phone |
| `--pad-inner-pane` | An inner pane's edge and what's inside it (the birthday picker, a dropdown), and a bar's: a pane one row of controls tall (the header, the gallery's bar) | 12px |
| `--pad-tray` | A tray's edge and what's on it: closer than a pane's, still clear of its cut foot | 16px |

- **If either side is a block, it's `--gap-block-block`,** even when the other side is a single control.
- **In a pane, controls fill its width.** A row of them is a `.control-row` (`foundations.ts`), which shares the pane's width between them, so its ends fit the pane's edges by the edge rule instead of stopping short with square corners.
- **The row's gap is the edge rule's neighbor distance.** Two controls side by side with their boxes `--gap-control-row-boxes` apart slant toward each other by `--control-slant`; any other distance and they don't. A row of controls uses `--gap-control-row-boxes`, a stack `--gap-control-stack`.
- **More room is a multiple of a token**, in `calc` (the gallery's sections are two `--gap-block-block` apart). Never a new number.
- **What isn't spacing keeps its own number:** a control's inside (its words and icon to its own edge, set by each control size), a control's own parts (a switch's tabs and the inset round its slab, the birthday's wheels, a list of places), room to scroll or for a scrollbar, and where a small mark sits on what it marks. Each one is named, with its reason, in `NOT_SPACING` in `test/site/design.test.ts`.

`test/site/design.test.ts` checks both: no other number in any gap, padding or margin, and every row of controls `--gap-control-row-boxes` apart and every stack `--gap-control-stack` apart.

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
- **A tag is a Tag** (`tag`, `foundations.ts`, shown in Data): `new` (Updated), `count` (unread topics on a place) or `glass` (the rail's labels).
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

- **Header** (`header`, `navigation.ts`): a floating slab of glass, inset from every edge, that slims as the page scrolls. The logo, the tabs (a framed Switch: Home, and Your games once its page is built), the page's own search when it has one, and you: Sign in (the runner), or your picture and name opening the account menu (Your profile, Friends, Developer, Settings, Sign out). On a developer page (the dashboard, the forum, `/developers`) the Developer and Forum tabs open out of the end of the tabs; leaving folds them away. Pages are separate loads, so the header remembers whether they were open (`sessionStorage` `zaisma-nav`) and opens or folds them from there. On a phone it's two rows: the logo, search and you on top, the tabs below.
- **Runner button** (`runButton`, `actions.ts`): the one orange slab, for the page's main action.
- **Cut button** (`cutButton`): every other button, clear glass with cut ends.
- **Switch** (`tabSwitch`, `inputs.ts`): a carved well with a white slab and the orange line under the one you're on.
- **Cut field** (`cutField`): a field carved into the glass, its label above and its error under it.
- **Birthday wheels**: month, day and year on wheels you scroll, swipe or type.
- **Rail** (`rail`): Zaisma's own scrollbar for a mouse or trackpad, a slim glass thumb on a hairline. Phones keep their own.
- **Footer** (`footer`): the mark, the links (for game developers, the forum, the source code and the rules) and "Zaisma is open source, under the MIT license."
- **The shell** (`layout`, `html.ts`): the backdrop, the header, the page and the footer. A page body built before this look sits in `main.steel`, which keeps its old styles inside it and the components' out of it; a component placed in one goes in an element of class `not-steel`. Each page's own rebuild sets `isRebuilt` and drops it.

## Motion

- Slabs slide on the spring, `cubic-bezier(.3, 1.2, .4, 1)`, in 0.55s; a size change (the header slimming) takes 0.45s; anything leaving goes faster than it came.
- Moving between pages crossfades, and the header's slab slides from the last page's tab to this one's.
- Under reduced motion nothing moves; the glass still changes color.

## Backgrounds

Glass is always over something. Zaisma's own pages have its backdrop (`backdrop`, `foundations.ts`): slow soft light in the theme's colors, or a still gradient where it can't draw. A game's page and its place on the home show the game's own background instead, set by its developer: a picture, a shader or Zaisma's own, for wide screens and phones (the game backgrounds building block).
