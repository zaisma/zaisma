# Backgrounds behind the glass

The background guide, also at [zaisma.com/developers/backgrounds](https://zaisma.com/developers/backgrounds) with its worlds drawn live. Keep the two in step (`apps/site/src/background-guide.ts`; `test/node/background-guide.test.ts` checks they say the same).

Your background is your game's world behind Zaisma's glass, on the home and on your game page: a picture, or a shader that paints it live. Style is yours. These lines keep the glass over it thin and the words on the glass clear, and anyone can check a background against them. The worlds further down are drawn live, and their sources are open to start from.

What goes on your cover is in the cover guide ([`docs/COVERS.md`](COVERS.md)). How to send a background and choose where it shows is in [`docs/DEVELOPER-API.md`](DEVELOPER-API.md#backgrounds) (`add_image`, `add_shader` and `set_background` in the MCP).

## The lines

What keeps a background clear under the glass, each with why. The first three are for pictures and shaders alike; the rest are for shaders.

1. **Keep most of it light, or most of it dark.** Zaisma reads your whole background once and makes its glass as thin as the words on it allow. A busy mix of bright and dark forces thick glass, which hides your world.
2. **Keep your subject clear of the glass.** On a wide screen Zaisma's glass sits on the left, so put the subject on the right. On a phone the glass takes the bottom half, so put it in the top half.
3. **No words, titles or logos.** Those go on your cover, and a background with them doesn't show (`text_on_background`). Words that are part of the scene, like a sign on a building, are fine.
4. **Compose by the screen's shape.** Phones show your wide shader until you send one for them, drawn at the phone's shape. Place things by `iResolution`'s width over its height, never by fixed pixels, and one shader serves both.
5. **Nothing flashes more than 3 times a second.** Flashing can cause seizures, so the check refuses a shader that does (`shader_flashes`).
6. **No detail finer than about 2 pixels, and soft edges.** Players' browsers draw a shader at half the screen's resolution and scale it up, so finer or hard-edged detail shimmers as it moves.
7. **Make every moment a finished picture.** The check keeps a still at 2 seconds and frames through the first 30, Zaisma picks the glass from that still, and the still is what shows under reduced motion. Nothing should fade in from black or build up first.
8. **Stay within the check's time.** The check draws 90 frames at 640 by 360 on a software renderer and takes their median, scaled so Zaisma's own background takes 25 ms. Yours can take up to 75 ms (`shader_too_slow` past it), and `check_frame_ms` says what it took. Layers of noise and long loops cost the most.

## Worlds to start from

The stand-in games' backgrounds, drawn live as a game's own would be. Each source is the whole shader, with the helpers it calls written in, as a game sends it. They're under the MIT license: copy one, hand it to your AI and make it yours.

Each link is the source as plain text.

- [Ashen Crown](https://zaisma.com/developers/backgrounds/ashen-crown.glsl), Dark fantasy: A ruined citadel on a crag against a swollen dying sun, the dusk burning behind it, embers rising and ash falling.
- [Neon Drift](https://zaisma.com/developers/backgrounds/neon-drift.glsl), Street racing: A rain-slick skyway over a black bay into a towering neon city, light trails streaming both ways.
- [Hollow Tide](https://zaisma.com/developers/backgrounds/hollow-tide.glsl), Horror: At the waterline: a lighthouse sweeps the sea fog under the moon, and below, the drowned drift past something vast.
- [Verdant](https://zaisma.com/developers/backgrounds/verdant.glsl), Exploration: A colossal tree on its hill, the sun behind its crown pouring light over forests fading into golden haze.
- [Iron Vigil](https://zaisma.com/developers/backgrounds/iron-vigil.glsl), Mech war: A colossal walker stands guard against a hazy sun under a planet's ring, dust blowing over the dunes.
- [Glasswing](https://zaisma.com/developers/backgrounds/glasswing.glsl), Dreamlike adventure: A glass dragonfly the size of a mountain glides over a rose twilight lake, its wings bending the moon into prisms.
- [Frostline](https://zaisma.com/developers/backgrounds/frostline.glsl), Survival: Polar dusk over jagged peaks, the last light burning pink on the summits, spindrift streaming off the crests and snow gusting in.
- [Kestrel](https://zaisma.com/developers/backgrounds/kestrel.glsl), Flight: Chasing a fighter high over a sea of cloud rushing in from a curved horizon, thunderheads towering in the sun's glare.
- [Starward](https://zaisma.com/developers/backgrounds/starward.glsl), Space: A ringed gas giant in crescent, its sun blazing past the edge, rays fanning over a vivid nebula.
- [Emberfall](https://zaisma.com/developers/backgrounds/emberfall.glsl), Survival: A field of black crust cracked over molten rock, a lava river running from an erupting volcano, sparks rising.

The same shaders are in Zaisma's source: `STAND_IN_BACKGROUNDS` in `apps/site/src/components/shaders.ts`, with the helpers they call in `SHADER_HELPERS`.

## What happens

A picture is checked like a cover, in about a minute. A shader is drawn and timed before anyone sees it, usually within a minute: it must compile, keep within the time and not flash, and its still and frames go through the same checks as pictures. Your dashboard, and your AI through `get_game`, say what passed and how to fix what didn't. Choosing what each screen shows is a step of its own, so you see a shader's still and frames before it shows anywhere.
