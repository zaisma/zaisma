# Covers that show your game

The cover guide, also at [zaisma.com/developers/covers](https://zaisma.com/developers/covers) with its pictures (`brand/cover-guide/`). Keep the two in step (`apps/site/src/cover-guide.ts`).

Your cover is your game's card everywhere players browse, shown alone with no title over or under it. Zaisma's lists (home, All games, browse and search engines) show games whose covers and titles keep five lines anyone can check against the picture. Style is yours: this says what passes, what doesn't, and what the best covers do.

## What great covers do

1. One subject from the game, big.
2. The game's name, big enough to read on a phone.
3. The game's own art and colors.
4. A simple background, with room around the subject.
5. Still clear as a small card.

Zaisma's demo games show it with real captures and their names: `good-four-in-a-row.webp` (a real board from the game) and `good-arena.webp` (the game's own arena). Browsers run games as big as PC games now, so aim for their art: a cover that would sit well on a PC store, not one made for a quick mobile game. Study these on their store pages: [Hades](https://store.steampowered.com/app/1145360/Hades/), [Hollow Knight](https://store.steampowered.com/app/367520/Hollow_Knight/), [Celeste](https://store.steampowered.com/app/504230/Celeste/), [Octopath Traveler](https://store.steampowered.com/app/921570/OCTOPATH_TRAVELER/), [Dead Cells](https://store.steampowered.com/app/588650/Dead_Cells/) and [Balatro](https://store.steampowered.com/app/2379780/Balatro/).

## The five lines

An AI checks every cover, square cover and share picture in about a minute (`add_image`, then `get_game`). These are the lines it holds them to, the same for every game. Each code is the image's `listing_reason`.

1. **No text but the title** (`extra_text_on_cover`). The game's name, a subtitle and your studio's logo. No callouts ("NEW LEVELS!"), update banners, feature lists, counts ("100 STAGES"), prices or stats ("+1 JUMP / SEC"). Words that are part of the scene, like a sign on a building, are fine.
2. **Nothing laid over the picture** (`overlay_on_cover`). No buttons, menus, shop panels, reward rows, badges, stickers, or arrows and circles pointing at things.
3. **No fake rewards** (`fake_reward`). Nothing promising free Robux, V-Bucks, gift cards or cash, on a cover, a screenshot or in the title or description. This one holds the game until a person looks.
4. **No famous characters, logos or names you don't own** (`famous_name`). Only obvious ones count: a character, logo or name a teen would name at a glance, like Mario, Naruto, Lightning McQueen, a football club's crest or the Roblox logo. Generic blocky or pixel characters are fine. If you own it or have permission, `message_zaisma`. What's inside your game is different: Zaisma acts on borrowed characters there only when the owner sends a notice.
5. **Built around something from the game** (`cover_not_from_game`). The character, creature or thing your cover is built around appears in at least one of your screenshots, in any art style. A giant robot on the cover of a gem puzzle with no robot in it doesn't pass.

## Busy and bright is fine

Bright colors, busy art, shocked faces, piles of coins and an AI-made look are never against the lines (`coin-cascade-busy-fine.webp`: loud, and only the title, so it passes). The covers at the top show what tends to work better.

## Screenshots

A screenshot is a real capture of the game. Its score, menus, buttons and shop screens are welcome. Anything added afterwards isn't: a caption, an arrow or circle, a sticker, a pasted logo, a device frame (`screenshot_not_from_game`, and the screenshot doesn't show). The test: would it be on the player's screen while playing?

## Titles

A title names the game. No tags (`tag_in_title`): a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag. "+1 Speed Run", "Wrangler 2x" and "Free Fall" are names, so they're fine. No famous names you don't own (`famous_name`), and no fake rewards (`fake_reward`). Patch notes are where you say what's new.

## What happens

Pictures and new words are checked in about a minute. A cover or title that breaks a line still shows on the game's page, and the game plays by its link, but Zaisma's lists leave it out until it's fixed (the `game_off_lists` alert, each image's `listing_reason` and the game's `title_listing_reason` say what and how); it's back about a minute after. A fake reward holds the game until a person looks. If the check got something wrong, `message_zaisma` with the `game_slug`, and a person looks; a person's decision stands.
