# Zaisma brand

The Z is the brand: Julius's own drawing, based on Futura, made of glass. `npm run brand` (`scripts/brand.mjs`) makes every glass file here from the drawing, the ones the site's logo shows included; never edit one by hand.

## Which file to use

| Use | File |
|---|---|
| The mark, on light surfaces | `zaisma-mark-glass-black.svg` (`-2048.png`) |
| The mark, on dark surfaces | `zaisma-mark-glass-white.svg` (`-2048.png`) |
| The wordmark, on light surfaces | `zaisma-wordmark-glass-black.svg` (`-2400.png`) |
| The wordmark, on dark surfaces | `zaisma-wordmark-glass-white.svg` (`-2400.png`) |
| One color (a stamp, a mask, a single-ink print) | `zaisma-mark-black.svg` / `zaisma-mark-white.svg`, `zaisma-wordmark-black.svg` / `zaisma-wordmark-white.svg` (`.png` copies at 2048 and 2400 px) |
| Icons 32 px and smaller | `zaisma-mark-small-black.svg` / `zaisma-mark-small-white.svg` |
| App icon | `zaisma-icon-light.svg` (the default) and `zaisma-icon-dark.svg`; `app-icon-1024.png`, `app-icon-512.png`, `app-icon-192.png`, `app-icon-dark-512.png` |
| Home screens | `apple-touch-icon.png` (square: the phone rounds it), `app-icon-maskable-512.png` (the Z inside the middle 80%), `manifest.webmanifest` |
| Stripe's icon | `stripe-icon.png` (the Z inside the middle 80%, like the maskable icon: Stripe cuts it to a circle) |
| Browser tab | `favicon.svg` (light and dark in one file), `favicon.ico` (16, 32 and 48 px), `favicon-32.png` |
| A shared link with no picture of its own | `share-card-light.png` (1200 × 630, from `share-card-light.svg`); `share-card-dark.png` for places that take a dark card |
| Loading | `loader/` (see below) |

## Rules

1. The mark is Julius's Z drawing, its three shards unchanged, made of glass: each shard bevelled and lit from the top left, with shaded walls. Never flat paint, metal or an outline. Black glass on light surfaces, white glass on dark ones.
2. The wordmark is the glass Z plus the shard letters "aisma" in the same glass, the letters shallower so the Z leads. Never retype it in a font.
3. The icon is the mark in front of the orange grid: a plane leaning back, rolled 35° along the Z's diagonal, strong near the viewer and gone by two-thirds up. Black Z on white and orange by default; white Z on black and the deeper orange for dark.
4. The share card is the full wordmark centered over the grid, the Relay far off to the right with its beam and lens flare, and players streaking toward it in orange.
5. At 32 px and under, use the small cut. The loader stays flat in the words' color. The flat black and white files are for one-color uses.
6. On pages, orange is only for what you press: the logo's orange lives in its icon and share card, never on the Z.
7. Leave clear space of at least the z's top-bar height. Don't rotate, stretch, recolor or add effects beyond these files.

The bevel is 125 units in the Z's 4500-unit drawing (30 px in the Affinity file).

## Loader

`loader/` holds the loading indicator: the Z building itself, one loop per second.

- `zaisma-loader.svg` draws in `currentColor`; the site uses it as a CSS mask so it takes the text color. `-black` and `-white` are fixed-color copies.
- `png/`, `webp/` and `gif/` are 128 px and 512 px exports, black and white, for places that can't run an animated SVG.
- Use it only while something is actually loading, never as decoration.

## Typeface

Headings use **Jost** (`fonts/jost.7726a5cd.woff2`, variable weight), a free geometric typeface close to Futura. It's under the SIL Open Font License (`fonts/OFL.txt`). Body text uses the system font. The file is named for its contents (the first 8 hex digits of its SHA-256), so browsers keep it for good (`_headers`): a changed font gets a new name, and `test/node/brand-files.test.ts` checks that every page asks for one that's there.

## Flags

`flags/` holds a 60×45 PNG of each country's flag, shown beside rooms on game pages (where the room runs). They're rendered from [flag-icons](https://github.com/lipis/flag-icons) 7.5.0, under the MIT License (`flags/LICENSE`). They aren't part of the brand; they live here because this folder is what zaisma.com serves as files.

## License

The code in this repo is MIT. The Zaisma name and logo are the project's identity: use them to refer to Zaisma, not to brand other products.

## Cover guide pictures

`cover-guide/` holds the pictures zaisma.com/developers/covers shows (`apps/site/src/cover-guide.ts`, `docs/COVERS.md`): good covers made from real captures of the demo games Arena and Four in a Row, and stand-ins for made-up games. They are examples for developers, not Zaisma's brand.
