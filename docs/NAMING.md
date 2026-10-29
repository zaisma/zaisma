# Naming

How names, values, inputs, examples, errors and next steps work everywhere an AI or a developer reads or writes Zaisma: the developer API, the developer and admin MCPs, the SDK, the game server API, the docs and examples that show them, and Zaisma's own code (database columns, types, functions and variables). It's the working half of "Nothing for an AI to guess" in `docs/DECISIONS.md`. The inside uses the same names as the outside, so nothing needs translating between them.

Why: an AI reading `files: 12`, `dt` or `created_at: 1792012345678` has to stop and work out what it means, and sometimes gets it wrong. Every guess costs tokens and some cost a wrong call. A name that says what it holds, what kind of value and in what unit lets the AI predict the right value and the right next call straight away.

The API, MCPs, SDK, game server and Zaisma's own code all use these names, inside and out, and a test keeps it that way: everything new follows this guide. The messages between the SDK and rooms do too: `type` and `data`, not `t` and `d` (rooms are billed per message, never by its size). Examples in this guide show the pattern; the glossary at the end lists the names that exist.

## The shape of a name

A name has up to three parts: **what it's about**, **what kind of value**, **in what unit**. `play` + `duration` + `min` is `play_duration_min`; `file` + `count` is `file_count`. The middle part tells the AI the kind of value before it reads the value.

| Kind of value | Name | Value | Example |
| --- | --- | --- | --- |
| Point in time | `<event>_at` | ISO 8601 string in UTC | `published_at: "2026-10-14T17:00:00Z"` |
| Calendar day | `<what>_date`, or `date` | `"YYYY-MM-DD"`, UTC | `date: "2026-10-14"` |
| Length of time | `<what>_duration_<unit>`, or a duration word below in place of `duration` | number | `play_duration_min`, `idle_timeout_sec` |
| Count | `<thing>_count` | integer | `file_count`, `player_count` |
| Place in a list | `<what>_index` | integer from 0 | `channel_index: 2` |
| Step on a fixed scale | `<what>_level`, its values listed in the schema | integer | `quality_level: 2` |
| Rate | `<things>_per_<unit>` | number | `ticks_per_sec`, `posts_per_day` |
| Size | `size_bytes`, `<what>_size_bytes` | integer | `size_bytes: 52000` |
| On-screen length | `width_px`, `height_px`, `<what>_px` | number | `width_px: 1920` |
| Angle | `<what>_deg` | number | `rotation_deg: 35` |
| Share | `<what>_pct` | number, 0 to 100 | `returned_pct: 42` |
| Yes or no | `is_`, `has_` or `can_` first; `<setting>_enabled` for a setting someone switches; a verb for an input that asks for an action | boolean | `is_live`, `cloud_saves_enabled`, `reopen: true` |
| Choice | `<what>_status`, `_kind` or `_mode`, or the setting's own name | one of a fixed list | `scan_status: "held"`, `visibility: "listed"` |
| ID | `id` for the object's own; `<kind>_id` for one that points at another | `<kind>_<random>` | `id: "version_8f3k2m…"`, `version_id: "version_8f3k2m…"` |
| List | plural noun; a list of IDs is `<kind>_ids` | array | `files`, `image_ids` |
| Text in a format | `<what>_url`, `_base64`, `_markdown` | string | `preview_url`, `text_markdown`, `images_base64` |
| Plain text | the thing's name, no suffix | string | `title`, `description` |

### Units

The only unit suffixes:

| Suffix | Unit |
| --- | --- |
| `_ms` | milliseconds, only where under a second matters |
| `_sec` | seconds |
| `_min` | minutes |
| `_hours` | hours |
| `_days` | days |
| `_years` | years, for ages (`minimum_player_age_years`) |
| `_bytes` | bytes |
| `_px` | CSS pixels |
| `_deg` | degrees |
| `_pct` | percent, 0 to 100 (never 0 to 1) |
| `_cents` | US cents, a number that may have a fraction (`review_cost_cents`); Stripe works in cents too |
| `_minor_units` | the smallest unit of the currency in the `currency_code` beside it (cents, pence; yen are whole), as Stripe counts amounts (`price_minor_units`) |

Rates reuse them with `per` and the singular: `_per_sec`, `_per_min`, `_per_hour`, `_per_day`. Pick the unit people think in for that quantity (minutes played, player hours a month), then use that same unit for it everywhere.

The list stays short on purpose: each new suffix makes every suffix worth less. Add one only when a real field can't be said with these, and add it here in the same change.

### Duration words

A length of time says so in its name. `duration` is the default; four words say more when they fit:

| Word | Means | Example |
| --- | --- | --- |
| `duration` | how long something lasts | `play_duration_min`, `seat_hold_duration_sec` |
| `timeout` | how long before something gives up or steps in | `idle_timeout_sec` |
| `interval` | time between repeats | `ping_interval_sec` |
| `delay` | wait before something starts | `publish_delay_min` |
| `cooldown` | wait before it can happen again | `vote_cooldown_sec` |

## Rules

1. **Whole words.** The only short forms are the units above, `id`/`ids`, `url` and `sha256`, plus `i` for a loop index in code. Not `dt`, `dx`, `msg`, `opts`, `pos`, `t`, `num`, `max`, `min`, `cfg`, `res`, `err`, `e`.
2. **Minimum and maximum are spelled out**, as the first word: `minimum_player_count`, `maximum_player_count`. `_min` at the end always means minutes.
3. **Vague nouns get a subject.** `data`, `info`, `value`, `result` and `context` never stand alone: `join_data`, `failure_context`.
4. **One type and one unit per field.** No "a number or false", no "a string or a number". A setting with modes is a choice plus a separate number: `idle_check: "server" | "client" | "off"` and `idle_timeout_sec: 600`, not `idleAfter: 600 | false | "client"`.
5. **A field reads right on its own.** If its short name means something else elsewhere in the glossary, use the full name. `code` is an error's code, so a room's is `room_code`; `players` is a list of players, so a number of them is `player_count`. On an object, `id` and `kind` are that object's own; anything else about it says what it is (`scan_status`, `review_status`, `page_url`, `image_url`).
6. **One name per concept, everywhere.** The glossary below is the list. Check it before naming anything; a new concept goes into it in the same change.
7. **Same words in each surface's style.** snake_case in the API and MCP (`play_duration_min`), camelCase in the SDK and game server (`playDurationMin`). The one exception: a webhook event reaches the game server as the API's own JSON, snake_case, so one event reads the same everywhere. Choice values and error codes are lowercase snake_case everywhere (`when_approved`, `keyboard_mouse`, `hosting_paused`); a word that's hyphenated in plain English keeps its hyphen (`co-op`).
8. **Keys are always there.** An answer has the same keys every time. `null` means "not set" or "none" and nothing else. In an update, leaving a key out keeps it and `null` clears it.
9. **A plural is always a list.** A number of things is never a bare plural, and a list names what's in it when that isn't obvious: `image_ids` holds IDs, `images` holds image objects, `images_base64` holds encoded images.
10. **Times go in and out as ISO 8601.** Out: UTC with `Z`. In: ISO 8601 with `Z` or an offset, nothing else (no epoch numbers).
11. **Lists that page** take `cursor` and answer `next_cursor`: an opaque string, `null` on the last page. Never a timestamp standing in for a cursor.

Good and not:

| Good | Not | Why |
| --- | --- | --- |
| `file_count: 12` | `files: 12` | `files` is a list elsewhere |
| `created_at: "2026-10-14T09:30:00Z"` | `created_at: 1792012345678` | An AI can't read a date from a number without working it out |
| `idle_timeout_sec: 300` | `idle: 300` | Seconds? Minutes? And what about idle? |
| `tickDurationSec` | `dt` | Short forms hide both the meaning and the unit |
| `maximum_player_count: 8` | `max: 8` | `max` of what, and `min` clashes with minutes |
| `returned_pct: 42` | `percent: 42` | Percent of what |
| `vote_count` and `affected_developer_count` | `count`, meaning one or the other by kind | One name, one meaning |

## Zaisma's own code

The same rules hold inside, with these on top. `test/node/naming.test.ts` checks identifiers, type fields and the database columns the migrations make, in the TypeScript, the JavaScript the packages ship (the SDK, the CLI, the Node runner) and the SDK's types.

- **Same words, two styles.** Database rows and API data are snake_case (`review_status`, `size_bytes`); variables, functions and types are camelCase or PascalCase (`reviewStatus`, `sizeBytes`). Never mix them in one shape: a stored JSON object is snake_case all the way down.
- **Columns take the API's names**, so the API passes data through instead of renaming it: `games.review_status`, `versions.patch_notes`, `game_images.width_px`. When the API shows something differently (an ISO time, a list made from text), only the value's form changes, never its name.
- **Stored times are `<event>_at_ms`**: epoch milliseconds, in columns and in variables (`createdAtMs`). `_at` always means an ISO string. `iso()` (`packages/core/src/time.ts`) is the only conversion between them.
- **Yes/no columns are named like booleans** (`cloud_saves_enabled`, `is_listed`), even though D1 stores them as 0 or 1. Every other number column ends in `_count`, a unit, `_ms`, `_per_<unit>`, `_index` or `_level`.
- **Whole words everywhere**, callback parameters included: `games.map((game) => …)`, `catch (error)`, `(first, second) => …` in a sort. `i` is the one short name, for a loop index.
- **Names the platform sets keep its spelling**: Worker bindings and secrets in `Env` (`DB`, `GAMES`), `env` and `ctx` in Worker handlers, and Web and Cloudflare API fields (`httpMetadata`, `etag`). Our own variables holding them still get whole words (`response`, not `res`).
- **No old names are left.** `test/naming-baseline.json` is empty, and the check fails on any name that breaks these rules. Should a name ever have to wait, it goes in that list (`npm run naming:baseline` writes it), and the check then fails on any new one and on any listed one that's gone, so the list only shrinks.
- **A standard's shapes keep its names** (Exceptions below): declare the shape with a name, like `TurnstileAnswer` or `PassClaims`, and list its standard fields in `STANDARD_FIELDS_BY_SHAPE` in `test/naming-source.ts`. Only those fields of that shape are let through; anything of ours in it still follows the rules.

## IDs

Every ID Zaisma makes says its kind in its value: `<kind>_<random>`, the kind in whole words (`play_ticket_…` for a kind of two words; the random part never has an underscore). An object's own ID is `id`, because the value already says what it is; an ID that points at another object is `<kind>_id` (`{ "id": "post_4k…", "topic_id": "topic_9x…" }`). An AI always knows what it's holding, and passing one where another kind belongs gets a clear error: `wrong_id_kind`, "That's an image ID; version_id takes a version ID.", with a fix naming the call that lists the right ones. Schemas give every ID its kind as a pattern (`^version_[a-z0-9]+$`), and `test/site/naming.test.ts` checks that they do.

| Kind | Example |
| --- | --- |
| `game` | `game_…` |
| `version` | `version_…` |
| `image` | `image_…` |
| `shader` | `shader_…` |
| `tester` | `tester_…` |
| `topic` (known issues too) | `topic_…` |
| `post` | `post_…` |
| `report` | `report_…` |
| `media` | `media_…` |
| `precedent` | `precedent_…` |
| `review_precedent` (a ruling the AI review follows) | `review_precedent_…` |
| `player` | `player_…` |
| `owner` | `owner_…` |
| `save_copy` | `save_copy_…` |
| `play_ticket` | `play_ticket_…` |
| `room_key` | `room_key_…` |
| `sign_in_app` | `sign_in_app_…` |
| `chat_group` | `chat_group_…` |
| `player_tag` | `player_tag_…` |
| `webhook` | `webhook_…` |
| `webhook_event` | `webhook_event_…` |
| `chat_review` | `chat_review_…` |
| `mcp_client` (an AI app that connects to the MCP by signing in; one that uses a metadata document is named by its URL instead) | `mcp_client_…` |
| `database_restore` (a restore of a game's database to a time, or the undo of one) | `database_restore_…` |
| `announcement` (short news Zaisma posts for players, shown on zaisma.com's home) | `announcement_…` |
| `top_up` (credit a developer bought, on Stripe's page or by automatic top-up) | `top_up_…` |
| `credit_entry` (any other change to a developer's credit: a game's hosting charge for a day, a refund, what Zaisma wrote off) | `credit_entry_…` |
| `purchase` (a player's purchase or grant of an item in a game) | `purchase_…` |
| `spending_request` (a raise in spending an AI asked for, which only the developer approves on zaisma.com) | `spending_request_…` |
| `pending_refund` (a deleted account's refund Stripe hasn't taken yet; never shown outside Zaisma) | `pending_refund_…` |

`ID_KINDS` (`packages/core/src/ids.ts`) is this list, and a test keeps the two in step; a new kind is added to both in the same change. Accounts' and guests' player IDs are both `player_…`, in their passes and everywhere the SDK and game server show them; an account's never changes, and Zaisma's own account ID (the sign-in's) never leaves Zaisma. The developer API and MCP still name a game by its `slug`, the link name developers know. Not IDs, and kept as they are: a `slug`, a `room_code` (six letters players type), API keys (`zsk_…`, a format secret scanners know), connected apps' access and refresh tokens (`zat_…`, `zrt_…`), webhook signing secrets (`whsec_…`, Standard Webhooks' form) and file hashes (`sha256`).

## Inputs

- **Fixed lists, not free text.** A field with known values is an enum in the schema, and its description says what each value means.
- **Templates, not free-form objects.** Every object has its properties, which are required and `additionalProperties: false`. No bare `{ "type": "object" }`.
- **Every ID says where it comes from**: "A version_id from get_game or upload_files".
- **Limits live in the schema** (`maxLength`, `minimum`, `maximum`, `maxItems`, `pattern`), not only in prose.

### Examples

The bar: a model that has never seen Zaisma gets the call right the first time from the schema alone. Where we aren't confident it would, add examples until it would, as many as the call needs:

- **None** for simple lookups like `get_game({ slug })`.
- **One good example** for a typical write.
- **Several good and bad** for big or flexible tools, like `update_game`'s players, `upload_files`, `post_topic` and `search_forum`.

Good examples go in the input schema's `examples`, with realistic values (real-looking slugs, prefixed IDs, ISO times). Bad examples go at the end of the tool's description, one line each, with the reason:

```
Not: { "at": 1792012345678 } (scheduled_publish_at takes an ISO time like "2026-11-01T17:00:00Z")
```

A mistake that keeps showing up in MCP errors becomes a bad example.

## Outputs

- **Every MCP tool has an output schema** (`apps/site/src/schemas.ts`), with each field described once there where its name can't say it all. Not every AI app shows output schemas to the model, so the names carry the meaning, and the tool's description adds only what a reader of the answer must know that names can't carry (like what counts as a play).
- **Compact JSON.** Answers aren't indented: indenting costs tokens and tells the AI nothing.
- **The same shape every time** (rule 8).
- **Brief by default** for anything that can be long, with a way to ask for more.

## Errors

Every error, in the API and the MCP, has the same shape:

```json
{ "error": { "code": "bad_time", "message": "scheduled_publish_at is in the past.", "field": "scheduled_publish_at", "fix": "Give an ISO time from 5 minutes to 90 days ahead, like \"2026-11-01T17:00:00Z\".", "retry_after_sec": null } }
```

- `code`: stable, lowercase snake_case, one problem per code, never reused for another.
- `message`: what happened, in one sentence.
- `field`: the input at fault, or `null`.
- `fix`: what to do about it, naming the call or value when there is one.
- `retry_after_sec`: how long to wait when waiting helps (like `slow_down`), else `null`.

In the MCP the same object is the tool result's `structuredContent`, with `isError: true` and its message, fix and code as its text (`<message> <fix> (<code>)`), and each tool's listed output schema is its answer or the error (`anyOf`), because MCP clients check an error's `structuredContent` against it too. Every code is in `ERROR_CODES` (`packages/core/src/errors.ts`) and listed in `docs/DEVELOPER-API.md`, which a test keeps in step.

## Next steps

Every call that changes something answers with `next_steps`: the calls that usually follow, ready to make.

```json
"next_steps": [
  { "tool": "get_version", "arguments": { "slug": "sky-hopper", "version_id": "version_8f3k2m" }, "after_sec": 30, "reason": "The scan usually takes under a minute." }
]
```

- `tool` is the MCP tool's name; `arguments` are what to send, filled in.
- `after_sec`: how long to wait first, or `null` for straight away.
- `reason`: why this is the next step, in one short sentence.
- `next_steps` is `[]` when nothing usually follows.

## Exceptions

Deliberate, and only these:

- **Standard formats keep their own names**: HTTP headers, JSON-RPC and MCP fields (`inputSchema`, `isError`, `structuredContent`) and JSON Schema keywords (`maxLength`). So do the shapes of standards and outside services Zaisma reads: JWT claims (`exp`, `nbf`, `iat`), OAuth and OpenID Connect at `/oauth/` and `/.well-known/` (`client_id`, `redirect_uri`, `id_token`, `expires_in`, `auth_time`, `invalid_grant`), WebAuthn's client and authenticator data (`crossOrigin`, `flags`), R2's ranges (`offset`, `length`, `suffix`), and what Cloudflare Turnstile (`success`) and VirusTotal answer.
- **A save's IndexedDB databases** keep IndexedDB's own names (`keyPath`, `autoIncrement`, `unique`, `multiEntry`, `version`), and their records keep the `$z` tags (`{"$z": [kind, …]}`) inside `indexeddb_databases`: they're the browser's and the game domain script's (`packages/sdk/saves.js`), not ours.
- **API keys** keep `zsk_`, and webhook signing secrets Standard Webhooks' `whsec_`; the headers webhooks are sent with (`webhook-id`, `webhook-timestamp`, `webhook-signature`) are Standard Webhooks' own.

## Glossary

One name per concept. The API and MCP column is snake_case; the SDK and game server column is camelCase. ID rows give the name for pointing at one; on the object itself it's `id`.

| Concept | API and MCP | SDK and game server |
| --- | --- | --- |
| A game's link name, as in zaisma.com/g/<slug> | `slug` | `slug` |
| A game's genres: up to 3 from one fixed list, which players filter Browse by | `genres` (a list of `action`, `adventure`, `role_playing`, `shooter`, `strategy`, `simulation`, `racing`, `sports`, `fighting`, `platformer`, `puzzle`, `horror`, `survival`, `sandbox`, `card_and_board`, `party`, `rhythm`, `visual_novel`); refused with `bad_genres`. Inside: `games.genres` (comma-separated), `GENRES`, `GENRE_LABELS`, `MAXIMUM_GENRE_COUNT` | |
| A version of a game | `version_id` | |
| A cover or screenshot | `image_id` | |
| A game's world behind Zaisma's glass, for one screen, and what it shows | `background`: `screen`, `source` (`zaisma`, `image`, `shader`, and on phone `wide`), `image_id`, `shader_id`, `still_url`; pictures are images of `kind` `background` and `phone_background` | |
| Which screen a background is for | `screen`: `wide` (desktops and tablets), `phone` (composed for a tall screen); errors `bad_screen`, `bad_background_source`, `background_not_ready` | |
| A small program that paints a background live | `shader_id`; a shader's `image` pass and `buffers`, `quality_checks`, `has_quality_levels`, `flash_count`, `still_url`, `frame_urls`, each pass's `source_url`, `buffer_count`, `texture_count`, `texture_image_ids`. Its source keeps Shadertoy's names on purpose (`mainImage`, `fragColor`, `fragCoord`, `iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iChannel0` to `iChannel3`, `iChannelResolution`), the form AI already writes, so nothing is left to guess; Zaisma's own inputs follow them (`iQuality`, `iGlassPanes`, `iGlassPaneCount`) | `SHADER_LIMITS`, `ShaderManifest` |
| A buffer of a shader: a pass drawn to a picture kept between frames | `buffer_name` (`a` to `d`), `source`, `channels`; errors `bad_buffers`, `too_many_buffers` | |
| What a shader pass's iChannel reads | `channels`, each `{ channel_index, input_kind, buffer_name, image_id, filter, wrap }`: `input_kind` `buffer` or `texture`, `filter` `linear` or `nearest`, `wrap` `clamp` or `repeat`; error `bad_shader_channel` | `ShaderChannel` |
| A picture a shader reads | an image of `kind` `shader_texture`; errors `shader_texture_too_big`, `too_many_shader_textures`, `shader_texture_in_use` | |
| How much a shader draws on a device, and what the check measured at each | `quality_level` (`0` phones and slow devices, `1`, `2` desktops; `iQuality` in the shader), `quality_checks`, each `{ quality_level, check_frame_ms, maximum_check_frame_ms }` | `qualityLevel` |
| A shader drawn before it's sent | `shader_check`: `compile_error`, `quality_checks`, `flash_count`, `is_glass_smoked`, `glass_tint_pct`, `notes` (each `{ code, message, fix }`, codes `shimmers_when_small`, `forces_thick_glass`), `sheet_url`, `sheet_expires_at`; `remaining_shader_check_count`; errors `daily_shader_checks_used`, `shader_check_unavailable`. The upload command's `check` on a shader's folder answers it with `renderer_kind` (`local_chrome`, `zaisma`), `sheet_file` and `texture_images` | `ShaderCheckAnswer` |
| A shader as a folder, as the upload command reads and sends it | `image.glsl`, `buffer-a.glsl` to `buffer-d.glsl`, `channels.json` (passes `image`, `buffer-a` to `buffer-d`, each a list of channels with `texture_file`, a texture's file in the folder, in place of `image_id`); `shader --json` answers `texture_images` (each `{ texture_file, image_id, added_image }`) and `added_shader`; `help --json`'s `shader_folder`; errors `no_image_pass`, `unknown_shader_file`, `bad_channels_file`, `shader_texture_not_approved`, `no_chrome`, `local_chrome_failed` | `shaderCheckPageExpressions`, `shaderDraftAnswer` (`packages/cli/shader-check.mjs`) |
| The color Zaisma tints its glass with over a game's background | `glass_tint_color` (`#RRGGBB`), error `bad_color` | |
| A tester link | `tester_id` | |
| A forum topic, a post in it | `topic_id`, `post_id` | |
| A game named on something else, like a forum topic | `game_slug` | |
| The known issue a message to Zaisma is about | `known_issue_topic_id` | |
| Where a forum topic stands | `topic_status`: `new`, `investigating`, `known`, `planned`, `fixing`, `released`, `fixed`, `wont`, `answered` | |
| Where a topic belongs | `category` (like `rooms`), in a `section` (like `multiplayer`) | |
| Words to search for | `search_text` | |
| A post's words, and the images sent with it | `text_markdown`, `images_base64`; a post's images are `media`, each with an `image_url` | |
| Who wrote a post | `author`: `{ name, kind, is_you }`, `kind` one of `developer`, `ai`, `zaisma`; `author_kind` when sending | |
| What an AI attaches for whoever fixes a problem | `debug_context`: `{ call, error_code, error_message, request_json, notes }` | |
| The check a public post passes before others see it | `check_status`: `pending`, `passed`, `held` | |
| Votes on a topic, and the developers a known issue affects | `vote_count`, `affected_developer_count` | |
| What a developer thinks of a post, anonymously | `rating`: `like` or `dislike`; `like_count`, `dislike_count`, `your_rating` | |
| A post saved to read again, private to the account | `bookmark`; `is_bookmarked`, `bookmarked_post_ids` | |
| Taking back a vote, a rating, a bookmark or a follow | `undo: true` in the MCP; `DELETE` in the API | |
| Posts an account can still make today | `remaining_post_count` | |
| A room players join by typing it | `room_code` | `roomCode`; the game server's own room's, `room.roomCode` |
| A player, and the players a call is for or leaves out | `player_id` | `playerId`; `playerIds`, `exceptPlayerId` |
| Whether a player is signed in | a player's `kind`: `account`, `guest` (also the player pass's `kind` claim) | `kind`; `playerKind` where it isn't on a player |
| What anyone sees of an account | `player`: `{ id, name, username, display_name, bio, link_urls, profile_url, is_profile_private, published_games, played_games, playing_now }`, its public profile | `PlayerProfile`, `Zaisma.player.getProfile(playerId)` (`displayName`, `linkUrls`, `profileUrl`, `isProfilePrivate`, `publishedGames`, `playedGames`, `playingNow`) |
| What a player writes on their profile, the check it passes, and who gets past its header | `display_name`, `bio`, `link_urls`; `profile_check_status`: `pending`, `passed`, `held` (in Zaisma's own code); the social setting `who_sees_profile`: `friends`, `anyone` | |
| Roughly when a player last played a game (a profile never shows a time) | `played_period`: `today`, `this_week`, `this_month`, `earlier` | `playedPeriod` |
| An account's unique name, as in @username (3 to 20 letters, numbers and underscores, unique ignoring case; it can change, the player ID can't), and the name games show for a player (an account's username; a guest's made-up one) | `username`; `name` | `username`; `name` |
| Whether an account can make, upload and publish games before the beta (only accounts Zaisma adds can) | `can_publish` (`GET /access`, the admin MCP's `set_can_publish`); error `publishing_not_open` | |
| Who an account can chat with, and the opaque group every account that chats at all chats in, friends included (never an age) | | player pass claims `who_can_chat`: `nobody`, `friends`, `anyone`; `chat_group_id` (a `chat_group_…` ID, different in every game); checked with `canChat(first, second)`; `room.canChat` (whether this player can chat at all); `PlayerChatSettings` (`whoCanChat`, `chatGroupId`, the room's host's copy, never the game's) |
| A chat message: a line a player typed, sent with room.chat through the room to the players who may read it, after the game server's onChat and Zaisma's chat filter | `chat_messages` on a player report (`from_player_id`, the reported player's or `null`, `text`, `sent_at`); Zaisma's own code: `reports.reported_chat_json`, `ReportedChatMessage`, `REPORTED_CHAT_LIMITS` | `room.chat(text, { toPlayerIds })` answers `{ sentAt }` (`ChatSent`); the `chat` event's `ChatMessage`: `fromPlayerId`, `text`, `hasSwearing`, `hasSlur`, `sentAt`; game server `onChat(state, player, room, chatInfo)` with `ChatInfo` `{ text, toPlayerIds }`, answering a `ChatAnswer` (`true`, `false`, `{ toPlayerIds }`); option `adultChatFilterEnabled`; `CHAT_ROOM_LIMITS` (`maximumChatMessageCount`, `chatWindowDurationMs`); wire messages `chat`, `chat_sent`, `chat_stopped` with a `chatNumber`; error codes `chat_stopped` (with `reason`, `stopped_by_game` for onChat), `chat_not_allowed`, `chat_empty`, `chat_too_long`, `chat_too_fast`, `chat_not_here` |
| Chat between adults checked by Zaisma's filter, on the game's hosting meter | `adult_chat_check_count` (`room_usage` and `hosting_use_this_month`); share kind `adult_chat_checks`; `HOSTING_PRICES.adultChatCheckCentsPerCheck` | game server option `adultChatFilterEnabled`; `checkChat`'s `isAdultFilterEnabled` |
| An account's Zaisma friends, and the invite that makes two accounts friends | | player pass claim `friend_player_tag_ids` (their `player_tag_id`s, never their player IDs), checked with `passesAreFriends(first, second)`; `room.areFriends(firstPlayerId, secondPlayerId)`; a friend invite's `invite_code` is 8 letters and digits, shown as `K7Q2-MX9P` |
| A player's friends playing this game, the room to join each in, and why not | `server_url` (in Zaisma's own code: a room on the game's own servers) | `Zaisma.friends.list()` answers `{ friends }`, each `{ id, name, username, roomCode, serverUrl, joinRefusal }`; `joinRefusal`: `game_not_taking_joins`, `friend_not_taking_joins`, `private_room`, `room_closed`, `room_full`, `spectators_full`, `friend_not_in_room`; `Zaisma.friends.setRoom({ serverUrl, roomCode, friendJoinsEnabled })` (null when the player left), refused with `unlisted_server`; a friend's Join link's `?server=`, read as `Zaisma.rooms.linkedServerUrl` |
| A block between two players, either way (never who made it, never anyone's list of blocks) | | `room.hasBlockBetween(firstPlayerId, secondPlayerId)`; player pass claims `player_tag_id` (the account's own `player_tag_…` ID, different in every game) and `block_player_tag_ids` (the player tags of the accounts it has a block with), checked with `passesHaveBlockBetween(first, second)`; the room's `{ type: "blocks", playerIds }` to each player; a game's `{ type: "block", playerId }` and `{ type: "unblock", playerId }`; `room.block(playerId)`; quickJoin's hello `avoidBlockedPlayers: true`, turned away with `blocked_player_here` |
| Whether Zaisma's Join (friends on zaisma.com, `Zaisma.friends`) takes players into a game's rooms, or into one room, and whether a game joins players by itself | `friend_joins_enabled`, error `bad_friend_joins_enabled`; `quick_joined_at_ms` (Zaisma's own code) | `friendJoinsEnabled` in `joinRoom`, `quickJoin`, `room.reserve` and the room's settings; `room.setFriendJoinsEnabled(isEnabled)`; every hello from quickJoin says `isQuickJoin: true` |
| What Zaisma's chat filter stopped, and why (one set of reasons everywhere), and what it only flags | `reason`: `contact_details`, `personal_details`, `sexual`, `chat_paused`, `too_long`, `not_allowed_to_chat` (own servers' `checkChat` only), and `unchecked` from the game server's `checkChat` when Zaisma can't be reached; a message kept for review is a `chat_review_…` ID, `chat_review_id` in the admin MCP | `Zaisma.checkChat` and the game server's `checkChat` answer `isAllowed`, `reason` (`ChatCheckReason`, the same values; the SDK's are the ones a game's own check can give), `message` (the words the sender sees), `hasSwearing` and `hasSlur` (allowed, flagged for the game), as a `ChatCheck` |
| What a game needs a Zaisma account for | `account_requirement`: `none`, `multiplayer`, `whole_game`; a guest turned away gets `account_needed` | error `code` `account_needed` |
| A game asking a guest to sign in while it runs, and the guest saying Not now | | `Zaisma.player.signIn()`; error `code` `sign_in_declined` |
| A developer's own site or app that players sign in to with Zaisma, and OAuth's client type for it | `sign_in_app_id` (the OAuth `client_id`); `kind`: `confidential`, `public` | |
| Where a sign-in can go back to, and asking for a new client secret | `redirect_urls`; `replace_client_secret: true`, answered once as `client_secret` | |
| What an API key may do, and on which games | `access`: `api_key_name`, `access_level` (`read`, `upload`, `publish`, `full`, `custom`), `area_access` (each area's choice: `game_access`, `version_access`, `stats_access`, `database_access`, `save_access`, `purchase_access`, `forum_access`, `sign_in_app_access`, `webhook_access`, `credit_access`, `stripe_account_access`; choices `none`, `read`, `write`, and for versions `upload`, `publish`), `game_slugs` (`null` for every game); refused with `key_not_allowed` | |
| An AI app that connects to the MCP by signing in (OAuth's client), and the connection it makes | `mcp_client_id` (the OAuth `client_id`: an `mcp_client_…` ID, or its metadata document's URL); on `list_api_keys` items, `kind` (`api_key`, `connected_app`) and `connected_app_host` | |
| An address a developer's server takes Zaisma's events at (or the game's own game server), the events it takes and the games they're about | `webhook_id`; `destination_kind` (`endpoint_url`, `game_server`), `endpoint_url` (`null` for a game server), `event_kinds`, `game_slugs` (`null` for every game; a game server's one game) | `onWebhook(event, server)` (`WebhookEvent`, the same JSON), `WEBHOOK_LIMITS`; on your own server, POSTs at `/v1/webhooks` checked with `ZAISMA_WEBHOOK_SIGNING_SECRET` |
| What a webhook is sent, and what happened | `webhook_event`, its `id` a `webhook_event_…` ID; its `kind`: `bug_reported`, `player_reported`, `scan_status_changed`, `live_version_changed`, `review_status_changed`, `country_blocks_changed`, `game_server_error_found`, `alert_raised`, `account_deleted` (with `account_deletion` `{ player_id, deleted_account_erase_enabled }`, and `game` or `sign_in_app`), `security_alert` (with `security_event`), `purchase_completed` and `purchase_refunded` (with `purchase`), `test`; when Zaisma made it: `created_at`; what it carries: `game`, `version`, `bug_report`, `player_report`, `game_server_error`, `alert`, `account_deletion`, `sign_in_app`, `security_event`, `purchase`. The game server gets it as the API's JSON, snake_case: the one exception to camelCase there | `WebhookEvent`, `WebhookEventKind`, `AccountDeletion`; `verifyWebhook` and `runWebhook` errors `{ error: { code, message, fix } }` |
| Asking for a new signing secret for a webhook | `replace_signing_secret: true`, answered once as `signing_secret` (`whsec_…`, Standard Webhooks' form) | |
| An event on its way to one webhook, and how it went | `delivery_status`: `pending`, `delivered`, `failed`; `attempt_count`, `last_attempt_at`, `next_attempt_at`, `failure_message`; `pending_delivery_count`, `failed_delivery_count` | |
| The youngest age that can play a game, in years: 13, 16 or 18; never a band name. A younger account turned away gets `game_not_open_to_player` | `minimum_player_age_years`; errors `bad_minimum_player_age`, `accounts_needed_for_minimum_age` | error `code` `game_not_open_to_player` |
| How many players, and the most and fewest allowed | `player_count`, `maximum_player_count`, `minimum_player_count` | `playerCount`, `maximumPlayerCount`, `minimumPlayerCount` |
| Players who watch a room without playing: how many, the most a room takes, joining to watch, and their handlers | `spectator_count`, `maximum_spectator_count` | `maximumSpectatorCount`, `room.spectators`, `isSpectator` (joinRoom's option, `room.isSpectator`, `joinInfo.isSpectator`, a hello's), `spectatorCount`, `onSpectatorJoin(state, spectator, room)`, `onSpectatorLeave(state, spectator, room)`, `Zaisma.rooms.isLinkedAsSpectator` (a link's `watch=1`); errors `spectators_full` (no room for another spectator), `already_playing` (a player in the room asked to watch it) and `spectator_cannot_send` |
| Who a broadcast reaches | | `audience`: `everyone` (the default), `players`, `spectators`, in `room.broadcast` and `room.broadcastBytes` |
| How many files, and their total size | `file_count`, `size_bytes` | |
| An image's size on screen | `width_px`, `height_px` | |
| Counted plays, and time on screen in them | `play_count`, `play_duration_min` | |
| Player time in rooms and data through the relay | `room_play_duration_min`, `room_play_duration_hours`; `relayed_size_bytes` | |
| The time a game's own game server ran, in its rooms and outside them (requests, schedule runs, webhooks), its startup included, all of it priced | `game_server_cpu_duration_sec`; in Zaisma's own code `game_server_cpu_duration_ms`, `outside_room_cpu_duration_ms`, `game_server_startup_cpu_duration_ms` | `HOSTING_PRICES.gameServerCpuCentsPerSec` (Zaisma's own code) |
| A game's free hosting this month and what used it: one meter, a percentage, never dollars | `hosting_use_this_month`: `free_used_pct`, `shares` (each `{ kind, share_pct }`, `kind` one of `rooms`, `game_server`, `relayed_data`, `database`, `requests`), `is_paused`, `paused_reason` (`free_used`, `budget_used`, `credit_used`, `null`), `paused_at`, `resets_on_date`, `monthly_budget_cents`, `spent_from_credit_cents`, and the counts `room_play_duration_hours`, `room_awake_duration_hours`, `room_connection_count`, `inbound_message_count`, `relayed_size_bytes`, `game_server_cpu_duration_sec`, `startup_cpu_duration_sec`, `game_server_session_count`, `loaded_version_count`, `outside_call_count`, `log_file_count`, `request_count`, `awake_duration_hours`, `database_call_count`, `written_row_count`, `read_row_count`, `bookkeeping_written_row_count`, `database_size_bytes`; refused with `hosting_paused`. Inside: `game_hosting_months` (`used_cents`, `charged_cents`, `written_off_cents`, `paused_at_ms`, `paused_reason`), `room_usage`'s counts (`room_awake_duration_sec`, `room_connection_count`, `object_request_count`, `game_server_session_count`, `game_server_startup_cpu_duration_ms`, `outside_call_count`, `object_awake_duration_sec`, `bookkeeping_written_row_count`, `log_file_count`, `database_call_count`, `database_awake_duration_sec`), `loaded_versions`, `HOSTING_PRICES`, `OUTSIDE_CALL_CPU_DURATION_MS`, `FREE_HOSTING_CENTS_PER_MONTH`, `hostingCostCents`, `hostingUseThisMonth`, `isHostingPaused`, `AwakeTime` | `hosting_paused` (a room's refusal, a request's error, a database error) |
| What a game may draw from its developer's credit each month | `monthly_budget_cents` on a game (`null`: no paid hosting); error `bad_monthly_budget_cents`; alerts `hosting_budget_nearly_used`, `hosting_paused` with `budget_used` | |
| A developer's credit | `credit`: `balance_cents`, `is_credit_low` (and the `credit_low` alert), `automatic_top_up` (`is_enabled`, `top_up_below_cents`, `top_up_amount_cents`, `monthly_top_up_limit_cents`, `topped_up_this_month_cents`), `top_ups` (each `{ id, amount_cents, refundable_cents, refund_ends_at, created_at }`), `games` (each `{ slug, title, monthly_budget_cents, spent_from_credit_this_month_cents, last_month_beyond_free_cents }`), `entries` (each `{ id, entry_kind, amount_cents, game_slug, created_at }`, `entry_kind` one of `top_up`, `hosting_charge`, `refund`, `written_off`); a top-up's `amount_cents`, Stripe's `checkout_url`; `refunded_cents`; key area `credit_access`; `credit_balance_cents` in `get_access`; tools `get_credit`, `top_up_credit`, `refund_top_up`, `update_automatic_top_up`, `get_spending_request` (answers `spending_request`: `{ id, request_kind, game_slug, game_title, requested_change, current_setting, request_status, created_at, expires_at, answered_at }`; `confirmation_needed` adds `spending_request_id`); errors `no_spending_request` (`request_kind` is `game_budget` or `automatic_top_up`; `request_status` is `waiting`, `approved`, `declined` or `expired`, which is never stored, only answered a day after the ask); errors `confirmation_needed` (with `confirm_url`), `account_not_protected`, `bad_top_up_amount`, `no_top_up`, `top_up_not_refundable`, `bad_automatic_top_up`, `stripe_unavailable`. Inside: `credit_entries`, `owners.credit_balance_cents`, `owners.credit_low_line_cents`, `owners.automatic_top_up_attempt_count`, `owners.automatic_top_up_enabled_at_ms`, `pending_refunds` (a deleted account's refund Stripe hasn't taken yet; `pending_refund_…` IDs), `CREDIT_LIMITS`, `creditOf`, `isCreditLow`, `addCreditEntry`, `refundableTopUps` | |
| A developer's plan and its daily limits | `plan`: `free` or `pro` (never "subscription" or "tier"); `pro`: `{ plan, pro_ends_at, is_pro_cancelled, monthly_price_cents, limits: { free, pro }, used_today }`, each plan's limits `{ maximum_large_review_count, maximum_small_review_count, maximum_performance_check_count, maximum_version_count, maximum_game_size_bytes }`, `used_today` `{ large_review_count, small_review_count, performance_check_count }`; Stripe's `checkout_url`; `plan` in `get_access`; key area `credit_access`; tools `get_pro`, `start_pro`, `cancel_pro`, `resume_pro`; errors `already_pro`, `not_pro`. Inside: `owners.pro_until_ms`, `is_pro_cancelled`, `stripe_subscription_id`, `PLAN_KINDS`, `PLAN_LIMITS`, `PRO_PRICE_CENTS_PER_MONTH`, `planOf`, `limitsFor`, `proCheckout`, `setProCancelled`, `STRIPE_PRO_PRICE_ID` | |
| A developer's own Stripe account, where the buy sheet's sales go (Connect Standard: the developer is the seller, no fee) | `stripe_account`: `is_connected`, `stripe_account_id` (Stripe's `acct_…`, not a Zaisma ID, so it says no kind), `can_take_payments`, `country_code`, `default_currency_code`, `business_name`, `support_email`, `is_stripe_tax_used`, `connected_at`, `balance` (Stripe's own figures, read live: `currency_code`, `available_minor_units`, `pending_minor_units`, `other_currency_balances` (each `{ currency_code, available_minor_units, pending_minor_units }`), `next_payout` (`{ amount_minor_units, currency_code, arrives_at }`); `null` when Stripe doesn't answer in 3 seconds); key area `stripe_account_access`; tools `get_stripe_account`, `connect_stripe_account`, `update_stripe_account`, `disconnect_stripe_account`; errors `stripe_not_connected`, `stripe_cannot_take_payments`, `bad_is_stripe_tax_used`. Inside: columns `stripe_account_id`, `can_take_stripe_payments`, `stripe_country_code`, `stripe_default_currency_code`, `stripe_business_name`, `stripe_support_email`, `is_stripe_tax_used`, `stripe_connected_at_ms` | |
| The link a developer connects their Stripe account on | `connect_url`, `expires_at` (10 minutes), answered by `connect_stripe_account` (`POST /stripe-account/connection-links`); through a key, `confirmation_needed` with `confirm_url` | |
| Whether Stripe Tax works out and records the tax inside each price (prices never change with it) | `is_stripe_tax_used`, `true` or `false`, in `update_stripe_account` and the `stripe_account`; error `bad_is_stripe_tax_used` | |
| Zaisma's sheet a player buys an item on, over the game or in a window, and how a buy ends | the buy sheet; errors `not_for_sale`, `stripe_not_connected`, `stripe_cannot_take_payments` | `Zaisma.items.buy(itemName, { itemCount, gameAccountId })` answers `BuyResult` `{ status, purchase }`, `status` `bought`, `cancelled`, `failed`; `Zaisma.items.on("sheetOpen" or "sheetClose", listener)` with `SheetEvent` `{ itemName }`; error `code` `needs_player_tap` |
| A player's saved card and the purchase PIN that confirms it's them (the player side of the buy sheet; the sheet's own `/api/buy`, `/api/payment-methods` and `/api/account/purchase-pin` calls) | `saved_card` `{ card_brand, card_last_digits }` (`card_brand` Stripe's lowercase brand, like `visa`; `card_last_digits` the card's last four digits as text, never a number, so `0042` keeps its zeros), `purchase_pin` as the input (exactly 6 digits, as text, so `048213` keeps its zero) and only ever stored hashed as `purchase_pin_hash`, `has_purchase_pin`, `purchase_pin_failed_count`; how a buy confirms it's the player: `confirmation_method` one of `passkey`, `purchase_pin`, `password`, in the body as `passkey_tap`, `purchase_pin` or `password`, and a device's confirm kept in `purchase_confirmations` (15 minutes; a purchase PIN account's covers one buy); on the sheet `is_confirmation_needed`, `confirmation_reason` (why: `purchase_pin`, `old_sign_in`, `big_spend`, or `null` when pressing Buy is enough; `is_confirmation_needed` is `confirmation_reason !== null`), `confirmation_methods` `{ has_passkey, has_purchase_pin, has_password, is_purchase_pin_locked }`, `is_eu_withdrawal_line_shown`, `refund_policy_words`, `has_account_email` (a saved card's receipts go to the account's email); player-side error codes `account_needed` (a guest), `account_protection_needed` (saving a card or setting a PIN needs a passkey or an email on the account), `already_owned` (a permanent item the player has), `purchase_confirmation_needed` (confirm it's you, then buy again), `purchase_pin_locked` (5 wrong PINs: a password confirm unlocks it), `wrong_purchase_pin`, `wrong_passkey`, `no_purchase_pin`, `bad_purchase_pin`, `card_not_saved`, `payment_declined` | `PURCHASE_PIN_LIMITS` `{ pinDigitCount, maximumFailedTryCount, confirmationDurationMin, signInMaximumAgeDays, dailySpendLimitUsdMinorUnits }`, `APPROXIMATE_USD_PER_CURRENCY_UNIT`, `approximateUsdMinorUnits`, `hashPurchasePin`, `isPurchasePin`, `purchasePinProblem`, `PURCHASE_LIMIT` (the 20-a-minute rate limit binding) (Zaisma's own code) |
| How much of a sale to refund, and what is left | `amount_minor_units` in `refund_purchase` (left out: all that's left; a full refund takes the item back, a partial one leaves it), `refunded_minor_units` on the purchase; errors `bad_amount_minor_units`, `purchase_not_paid`, `already_refunded` | |
| Bytes a game and its room send each other, and whose they are | | `room.sendBytes(bytes)` and the `"bytes"` event `(bytes, fromPlayerId)` in the SDK, error `code` `bad_bytes`; `onBytes(state, player, room, bytes)`, `room.broadcastBytes(bytes, { exceptPlayerId, fromPlayerId })`, `room.sendBytes(playerId, bytes)` on the game server |
| A game's room traffic: messages and bytes each way per player a second, its message types, and what to change | `inbound_messages_per_player_sec`, `inbound_size_bytes_per_player_sec`, `outbound_messages_per_player_sec`, `outbound_size_bytes_per_player_sec`; `room_traffic` with `message_types` (`message_type`, `direction`: `inbound`, `outbound`, `average_size_bytes`, `largest_size_bytes`) and `traffic_hints` (`code`: `json_messages_large`, `outbound_heavy`, `message_near_limit`, `latest_only_available`); `message_type` `(state)` for state sync's updates. Inside: `room_message_types.backed_up_message_count` | `STATE_MESSAGE_TYPE`, `backedUpMessageCount` (Zaisma's own code) |
| How many days a report or stats answer covers | `period_duration_days` | |
| What the game check finds before an upload | `problems`, each `{ code, problem_kind, is_fixed_by_upload_command, message, path, quote, fix }`, `problem_kind` `refused` or `broken`; `omitted_problem_count` | |
| A version's scan result, and what it found that holds or rejects it | `scan_status`: `scanning`, `held`, `approved`, `rejected`; `findings`, each `{ code, severity, message, content_rule, path, fix }` | |
| How a version started in headless Chrome, and what would make it much smaller (notes, never holds) | `performance_check`: `{ check_status, checked_at, browser_description, loading_duration_sec, start_download_size_bytes, start_file_count, start_memory_size_bytes, longest_start_task_duration_ms, notes }`, `check_status` `waiting`, `checking`, `checked`, `over_daily_limit`, `could_not_run`; a performance note `{ code, message, path, saved_size_bytes, fix }`; the game check's `performance_notes`. Inside: `performance_checks.start_files`, each `{ path, destination, is_cors_request, downloaded_size_bytes }` | `PERFORMANCE_CHECK_LIMITS` |
| How a game runs on players' devices, as totals (never per player), and the switch for it | `performance` in `get_stats`: `version_totals` and `device_totals`, each row `{ version_id, play_count, median_loading_duration_sec, slow_tenth_loading_duration_sec, median_frames_per_sec, low_tenth_frames_per_sec, long_frames_per_min, crashed_play_pct, error_stop_count, context_lost_count, stopped_responding_count, median_peak_memory_size_bytes, is_measured }`, a device row also `browser_name` (`chrome`, `edge`, `firefox`, `safari`, `samsung_internet`, `other`), `os_name` (`windows`, `macos`, `linux`, `chromeos`, `android`, `ios`, `other`), `device_kind` (`computer`, `phone`, `tablet`; `other` only in the folded row) and `graphics_family` (`nvidia`, `amd`, `intel`, `apple`, `qualcomm`, `arm`, `imagination`, `other`, `unknown`); the game's `performance_measuring_enabled`, error `bad_performance_measuring_enabled`. Inside: `performance_days` (`loading_counts`, `frame_rate_seconds`, `memory_counts`: JSON arrays of counts by bucket), `play_tickets.has_performance_loading`, `has_performance_crash`, `measured_duration_sec`; page messages `zaisma:performance`, `zaisma:alive` | `LOADING_BUCKETS_SEC`, `FRAME_RATE_BUCKETS`, `MEMORY_BUCKETS_BYTES`, `BROWSER_NAMES`, `OS_NAMES`, `DEVICE_KINDS`, `GRAPHICS_FAMILIES`, `CRASH_KINDS`, `PLAYER_PERFORMANCE_LIMITS`, `browserOf`, `osOf`, `percentileOf`, `frameRateAt` |
| The AI review's two daily limits, and a version that steps aside for a newer one | a large review (read and judged: `daily_large_reviews_used`) and a small review (read alone: `daily_small_reviews_used`), never "judged review"; `replaced_by_version_id` (`version_replaced`). Inside: `read_at_ms` (when a version's small review ran), `is_small_review` in a scan report, and in the admin MCP `changes_since` with `added_paths`, `changed_paths`, `removed_paths` and their `*_path_count` | `PLAN_LIMITS.free.maximumLargeReviewsPerDay`, `maximumSmallReviewsPerDay` |
| A sample game in the review test set, and what a run found | `is_honest`, `content_rule`, `protection`, `why` (in `case.json`); `outcome`: `held_bad`, `missed_bad`, `passed_honest`, `held_honest`, `inconsistent` (Zaisma's own code) | |
| Zaisma's review of a game | `review_status`: `pending`, `live`, `held`, `removed` | |
| Why Zaisma held, rejected or took down a game, version or image | `review_reason`: `{ code, message, content_rule, fix }`, its `code` from `REVIEW_CODES` | |
| The countries a game is blocked in on a notice under their law | `country_blocks`, each `{ country_code, country_name, review_reason, blocked_at }`; the `game_blocked_in_country` alert, the `country_blocks_changed` webhook. Inside: `games.country_blocks`, each `blocked_at_ms` | |
| Why a cover or a title keeps a game off Zaisma's lists, or held it for a fake reward ("No slop") | `listing_reason` on an image, `title_listing_reason` on a game, shaped like `review_reason`; the `game_off_lists` alert. Inside: `cleared_at_ms` on an image and `cleared_title` on a game (a person cleared it), `listing_check_requested_at_ms`, `listing_checked_at_ms` | |
| What needs a developer's attention in a game | `alerts`, each `{ kind, message, fix, version_id }`, `kind` one of `game_removed`, `game_held`, `game_blocked_in_country`, `version_rejected`, `version_held`, `link_flagged`, `game_off_lists`, `hosting_paused`, `database_full`, `hosting_nearly_paused`, `hosting_budget_nearly_used`, `credit_low`, `database_nearly_full`, `player_erase_failed`, `reports_open`; a heads-up is its paused or full kind with `nearly` (`nearly_used` for a budget) | |
| A content rule, as a hold or takedown names it | `content_rule`: `child_safety`, `sexual`, `malware`, `illegal`, `real_people`, `copyright`, `defamation`, `personal_details`, `chat`, `crypto`, `purchases`, `faked_plays` (the same words as a report's `reason` where they mean the same) | |
| Who can see a game | `visibility`: `draft`, `listed`, `unlisted`, `private` | |
| Where to continue a list | `cursor` in, `next_cursor` out | |
| A game server's logs, and where to read on from | `log_lines`, each `{ logged_at, level, text, source_kind, room_code, version_id }`; `level` a console method (`debug`, `log`, `info`, `warn`, `error`), `source_kind` `room`, `request`, `schedule` or `webhook`; filters `minimum_level`, `search_text`, `maximum_line_count`; `cursor` in and `next_cursor` out go back, `new_lines_cursor` in and out goes forward | `LOG_LIMITS`, `StoredLogLine`, `LogWriter` |
| How a game is played | `play_modes`: a list of `{ mode, minimum_player_count, maximum_player_count, play_style }` | |
| A version's notes for players, and when it goes live by itself | `patch_notes`, `scheduled_publish_at` | |
| Links, by what they open | `page_url` (a game's page), `preview_url` (a version), `image_url`, `link_url` (a tester link) | `inviteUrl` (a room's invite link), `serverUrl` (a game server of the developer's own) |
| What a tester link opens and until when, and when a preview link stops working | `version_choice`: `live`, `newest_passed`, `picked`; `picked_version_id`, `ends_at`; `preview_url_expires_at` | |
| Forum topics with something new from Zaisma | `unread_topic_count` | |
| What a player wrote in a report | `player_text` | |
| A report about one of a game's players, passed to its developer | `player_report`, in `player_reports`; who it's about: `reported_player_id`, `reported_player_name`; why: `reason`, one of `real_life_threat`, `personal_details`, `following_after_block`, `sexual`, `harassment`, `cheating`, `other` | |
| Reports about the same problem, named by the first one (admin MCP) | `report_group_id` (a `report_…` ID) | |
| Where a report stands | `report_status`: `open`, `dismissed`, `actioned` | |
| How serious a report or topic is (admin MCP) | `severity`: `child_safety` (reports only), `urgent`, `high`, `normal`, `low` | |
| What a person decides about reports, a precedent or a post, and why (admin MCP) | `decision`, `why` | |
| A ruling report triage follows, and where it stands (admin MCP) | `precedent_id`; `precedent_status`: `proposed`, `active`, `retired`; `can_ai_apply_alone`, `replaces_precedent_id`, `followed_count` | |
| A ruling the AI review follows when it was wrong, and where it stands (admin MCP) | `review_precedent_id`; `decision`: `pass`, `hold`; `review_precedent_status`: `proposed`, `testing`, `active`, `failed`, `retired`; `replaces_review_precedent_id`, `followed_count` | |
| What report triage and forum sorting found (admin MCP) | `triage`, `sorting`, `is_waiting_for_sorting`; what triage did by itself is `ai_actions` | |
| Public forum posts waiting for a person (admin MCP) | `waiting_posts` | |
| What happened to a game, and who did it | `events`, each with `happened_at` and `last_happened_at`, `occurrence_count`, `subject_name`; `done_by`: `you`, `api_key`, `ai`, `zaisma`; `actor` in the admin MCP | |
| Where something came from | `device`, `network_name`, `city_name`, `region_name`, `country_code`, `connection_address`, `is_new_place` | |
| An account's activity | `get_activity`'s `events`, each with `kind` (the account kinds), `sign_in_kind` (`password`, `passkey`, `email_code`, `google`, `discord`) and `security_alert_status`; `unseen_security_alerts`; `where_used_from_enabled` | |
| A risky moment the owner hears about | a security alert, never just "alert" (a game's `alerts` are about its free use and reviews): `security_alert_status` `emailed`, `unseen` or `seen`; the `security_alert` webhook kind | |
| The calls that usually follow a change | `next_steps` | |
| Ticks a second, and the time since the last tick | | `ticksPerSec`, `tickDurationSec` |
| Time without input before "Still there?", and who checks | | `idleTimeoutSec` (30 to 86400, else error `code` `bad_idle_timeout` in the SDK), `idleCheck`: `server`, `client`, `off`; a player's game turns its own off with `idleCheckEnabled: false` |
| How long a seat is held for a player who walked away | | `seatHoldDurationSec` |
| How many of the game's rooms one player sits in at once | | `maximumRoomCountPerPlayer` (1 to 10, 1 by default; a newer seat past it closes the oldest with close code 4001, "Joined from somewhere else") |
| How long a player whose connection dropped stays in the match, and why a player in the room isn't playing | | `reconnectTimeoutSec`; `awayReason`: `idle`, `hidden`, `lost` or `null` (`room.awayReason(playerId)` on the game server, each `ListedPlayer` in `room.players` in the game) |
| When Zaisma will end a match after its game's hosting paused, and hearing it | | `endsAt` (an ISO time); the game server's `onEnding`, the SDK's `ending` event, the room's `{ type: "ending", endsAt }` |
| Zaisma calling that end off once the game's hosting starts again, and hearing it | | `endsAt` back to null; the game server's `onEndingCancelled`, the SDK's `endingCancelled` event, the room's `{ type: "ending_cancelled" }` |
| When running matches get a newly published version | `match_update_mode`: `next_match`, `now` (on a publish, and on a version that goes live by itself) | the game server's `onVersionUpdate(state, versionUpdate, room)` with `VersionUpdate` `versionId`, `appliesAt` (an ISO time) and `isReloading`, `room.applyVersionUpdate()`; the room's `versionUpdate` event with `versionId`, `appliesAt` (an ISO time) and `isReloading`; `Zaisma.versions.on("update")` and `update.apply()` for games not in a match; a hello's `versionId` (the version the player's game runs), turned away with `other_version` and the room's `versionId` when its game server runs another; `live_rooms.version_id` |
| How often a real-time room saves its state, and a room coming back from a restart with it | | `stateSaveIntervalSec`; the game server's `onRestored(state, restoreInfo, room)`, with `RestoreInfo` `savedAt` (an ISO time), `lostDurationSec` and `savedVersionId`; the Node runner's `--room-state-file` (`startServer({ roomStateFile })`, table `room_states`: `room_code`, `format_version`, `state_json`, `saved_room_json`, `saved_at_ms`, `is_saved_empty`, `is_kept`; the keys inside `saved_room_json` are snake_case, like `known_player_ids`, `kept_out`, `ends_at_ms` and `match_players`); a real-time room (`ticksPerSec`) hears `onRestored`, a turn-based room doesn't |
| A room that keeps its world when everyone leaves, sleeping until someone joins, and the game's storage it counts toward with the database | `kept_rooms` (each `room_code`, `name`, `saved_size_bytes`, `saved_at`, `last_played_at`, `created_at`), `kept_rooms_size_bytes`, `storage_size_bytes`, `maximum_storage_size_bytes`, `is_deleted`; `live_rooms.is_kept`; tools `list_kept_rooms`, `delete_kept_room`; error `no_kept_room`; `zaisma kept-rooms` | `room.isKept`, `room.setKept(isKept)`; `isKept` in `room.reserve` and `ListedRoom`; Zaisma's own `Saved.isSavedEmpty` and the Node runner's `room_states.is_saved_empty` (saved as the room emptied: nothing lost) |
| What happens to a player who walks away | | `awayMode`: `hold`, `lobby` |
| A mistake in a game server's code, and how it fails | | a `GameServerError` with a `code` (`GameServerErrorCode`: `unknown_option`, `bad_option`, `bad_room_call`, `room_call_limit`, `room_call_unavailable`, `bad_handler_answer`), the `field` it is about (an option, a handler like `canJoin` or a room call like `room.kick`), and a `fix`; shown in the game's logs and `get_stats` errors |
| Starting a game server on your own machine, and what it answers | | `import { startServer } from "@zaisma/game-server/node"`: `startServer({ gameServer, gameSlug, port, origins, issuerUrl, loadPassKeys, loadReceiptKeys, loadProfile, database, secrets, webhookSigningSecret, roomStateFile, webtransportPort, certificatePath, certificateKeyPath })` answers `{ close, httpServer, fastLaneReady }`; the command `npx @zaisma/game-server <server.ts> --game <slug>` with `--port`, `--origin`, `--issuer-url`, `--database-file`, `--room-state-file`, and the fast lane's `--webtransport-port`, `--certificate-path` and `--certificate-key-path` (bin `zaisma-game-server`) |
| The fast lane to a game's own server (WebTransport), and what a room's connection uses | | `transport`: `websocket`, `webtransport` (`Zaisma.joinRoom`'s option, refused with `bad_transport`, and `room.transport`; `TRANSPORTS` in the SDK); `FAST_LANE_CONNECT_TIMEOUT_MS` (3000); `FastLane` (the SDK's adapter); `delivery` reaches the room's `send` and `sendBytes` (`Transport`) |
| Sending each player the game server's state, then only what changed, and what each player sees of it | | `stateSyncEnabled`; `stateView(state, viewer, room)`; the room's `{ type: "state", serverTimeMs, full }` and `{ type: "state", serverTimeMs, changes }`; a `StateChange` `[path, value]` or `[path]`; `room.state`, the `"state"` event `(state, changes)` and `room.smoothedState({ delayMs })` (`SmoothingOptions`) in the SDK, error `code` `bad_delay`; `ROOM_LIMITS.maximumStateViewSizeBytes`; in Zaisma's own code `diffState`, `applyStateChanges`, `newStateTracker` |
| A send that may be dropped for a newer one while a player's connection is backed up | | `delivery`: `reliable`, `latest_only`; `latestKey` (needed with `latest_only`); `SendOptions` in the SDK and on the game server, error `code` `bad_send_option`; a player's connection is backed up (`isBackedUp`, `ROOM_TUNING.backedUpSizeBytes`, `backedUpDelayMs`); `ROOM_LIMITS.maximumLatestOnlySlotCount`, `maximumLatestKeyCharacterCount` |
| A message between a game and its room, the game's own message in it, and the player it came from | | `type`, `data`, `fromPlayerId` (a send option on the game server, `null` for the game server's own); the `"message"` event `(message, fromPlayerId)`; `ClientMessage`, `ServerMessage` |
| Which room messages a game and its room speak | | `protocolVersionNumber` (a hello's and a welcome's), `PROTOCOL_VERSION_NUMBER` (1) |
| A quick join's hello asking for a room without anyone the player blocked (an action, so a verb) | | `avoidBlockedPlayers` |
| Why a match ended | | `endReason`: `game`, `no_players`, `hosting_paused`, `kept_room_deleted`, `game_unavailable`, `game_server_stopped` (`EndReason`); the `"ended"` event `{ message, endReason }` |
| Where the "Still there?" question stands | | `idleStatus`: `asking`, `answered`, `timed_out`, with `answerTimeoutSec`; the `"idle"` event (`Idle`) |
| A player back after walking away, and whether their seat was still held | | the `"back"` event `{ roomCode, isSeatHeld, rejoin() }` |
| Reliable sends waiting while a room isn't reachable | | `MAXIMUM_QUEUED_SEND_COUNT` (60, the SDK's); error `code` `send_queue_full` |
| How a room checks and paces its connections (not limits a game sets) | | `ROOM_TUNING`: `probeIntervalSec`, `probeAnswerTimeoutSec`, `probeSentSizeBytes`, `maximumUnansweredSentSizeBytes`, `maximumUnansweredProbeCount`, `backedUpSizeBytes`, `backedUpDelayMs` |
| Why a room closed a connection | | `ENDED_CLOSE_CODE` (4000: the match ended), `REMOVED_CLOSE_CODE` (4001: refused, removed or replaced), `SEAT_GONE_CLOSE_CODE` (4002: the seat is no longer held), `NO_ANSWER_CLOSE_CODE` (4003: no answer or too far behind), `VERSION_UPDATE_CLOSE_CODE` (4004: the match switches to a version published now), `BUSY_CLOSE_CODE` (1013) |
| What a player's game brings into a room, and what a room another room made starts with | | `joinData`, `setupData` |
| How a player came into a room, and why they left or walked away | | `joinInfo: { fromRoomCode, isReturning, isSpectator }`; `leaveInfo: { reason }`, `reason` one of `left`, `lost`, `idle`, `hidden`, `kicked`; `onAway(state, player, room, awayInfo)` with `awayInfo: { reason }` (`AwayInfo`), `reason` one of `idle`, `hidden`, `lost` |
| Words a person reads about what happened: an error's, a kick's, a refusal's, a match's end | `message` | `message`; `refusalMessage` in what `canJoin` answers (`true`, `false` or `{ refusalMessage }`; answering nothing or anything else turns the player away and is logged as `bad_handler_answer`) |
| The room's host, who can run it from the game, and whether a game server has one | | `hostPlayerId`, `hostControlsEnabled` |
| Whether a room shows in room lists, and takes new players | | `isListed`, `isOpen` |
| Rooms in a room list: everyone playing and their rooms, listed ones closed and with space, ones taking players that match, the ones past the list, and seats held | | in the SDK's `RoomList` `playingPlayerCount`, `playingRoomCount`, `listedClosedRoomCount`, `listedJoinableRoomCount`, `matchingOpenRoomCount`, `moreOpenRoomCount`; `heldSeatCount`; a region's `regionName`. Zaisma's own code keeps `playing`, `joinableRoomCount`, `openRoomCount` |
| The game page's room list, a page at a time (zaisma.com's own, not a developer call): where a page starts and how many rooms it holds, the order it's in, whether full rooms are left out, and how many rows a refresh keeps | `GET /g/<slug>/rooms?cursor=` (the page's `nextCursor`, as an opaque string; a Load more link carries it), `room_order` (`best_to_join`, `most_players`, `fewest_players`), `is_hiding_full_rooms` (`true`) and `shown_row_count` | `listRoomPage(database, gameId, { cursor, pageRoomCount })` answers a `RoomPage` (a `RoomList` and `nextCursor`, `null` on the last page); `roomOrder` (`RoomOrder`, from `ROOM_ORDERS`) and `isHidingFullRooms` on the `RoomPage`; `MAXIMUM_PAGE_ROOM_COUNT` |
| A part of the world rooms run in: a continent code, like `EU` | | `region` (`Region`: `AF`, `AN`, `AS`, `EU`, `NA`, `OC`, `SA`), error `code` `bad_region` |
| What of Zaisma's covers the game on its page: one of its sheets, one of its cards, or nothing | | `Zaisma.page.coveredBy` (`CoveredBy`: `sheet`, `card`, `null`) and its `coveredBy` event; the page's message `zaisma:covered` with `coveredBy`. Inside: `zaismaLayers.coveredBy` |
| How a notice or card waits its turn over a page or a game | | `noticeUrgency`: `information`, `ask`, `urgent` (component option and `data-notice-urgency`); `sheetsToClose` (sheet IDs an urgent card closes); `zaismaLayers` `say`, `show`, `leave`, `step`, `openSheets`; `STALE_INFORMATION_MS`, `MAXIMUM_PAGE_NOTICE_COUNT`, `NOTICE_STAY_MS`, `NOTICE_UNDO_STAY_MS`; a sheet's `SheetStep` (`stepName`) and `SheetTab` (`tabValue`) |
| Where a room's socket stands | | `connectionStatus`: `connecting`, `open`, `reconnecting`, `closed`; whether the player is in the match is `room.awayReason` (`idle`, `hidden` or `null`) |
| Errors a room's player gets, renamed for v1 | | `room_full`, `room_closed`, `room_not_running`, `spectators_full`, `bad_origin`, `already_playing`; for a call, `zaisma_rooms_not_used` (the game doesn't use Zaisma rooms) |
| Keeping a kicked player out, as asked and as told | | `keepOut` (asked), `isKeptOut` (told) |
| A player's cloud save, what it holds, and who made it as it is | `local_storage_items` (each localStorage key and its text), `indexeddb_databases`, `keys` (some localStorage keys asked for) and `missing_keys`; `changed_by_kind`: `player`, `developer` | |
| An earlier version of a save, why it was kept, and the one a change kept | `save_copy_id`; `saved_at`, `copy_reason`: `hourly`, `account_lost`, `smaller`, `restore`, `device_lost`, `developer`; `is_current_save`; `save_copy_count`; `kept_save_copy_id` | `Zaisma.saves.listCopies()` answers `{ saveCopies }`, each `SaveCopy` with `copyReason` (`SaveCopyReason`, the same values) |
| Which format a stored save is in | `save_format_version_number` (`1`), the first key of the save's stored text | |
| When a save or an earlier version was last saved or changed (never `updated_at`) | `saved_at` | `savedAt` on a `SaveCopy` and on `developerChange`'s `DeveloperChange` |
| The game version that saved a save or an earlier version (a label, `null` when the developer wrote it) | `version_id` on a save and a save copy | `versionId` on a `SaveCopy` |
| Whose progress won when two devices' progress differed | | `winnerKind` on `conflict`'s `SaveConflict`: `this_device`, `account` |
| A game's own SQLite database, a statement for it and the values for its `?`s | `sql`, `values` (a blob as `{ blob_base64 }`), `statements`; answered as `rows`, `statement_results` (one per statement) and `read_row_count`, `written_row_count`; its `tables` and `indexes` (`table_name`) | `room.database`: `query(sql, values)` answers rows, `batch(statements)` runs `{ sql, values }` statements in one transaction; a `DatabaseError` has a `code` and a `fix` |
| Erasing a player from a game's database, and whether Zaisma does it when they delete their account | `erase_player`, `erased_tables` (`table_name`, `erased_row_count`); `deleted_account_erase_enabled` | `database.erasePlayer(playerId)` answers `[{ tableName, erasedRowCount }]` |
| A game database's whole contents as SQLite's SQL dump, in parts | `dump_sql` (one part, in and out), `next_cursor` and `cursor` between parts; an import answers `statement_count` and `skipped_statement_count` | `dumpPart(read, cursor)` answers `{ dumpSql, nextCursor, readRowCount }`; `importStatements(dumpSql)` (`DUMP_LIMITS`: `exportPartSizeBytes`, `maximumImportPartSizeBytes`) |
| Going back to an earlier moment of a game's database, and undoing that | `restore_database`, `restore_to_at`; a restore is `{ id, restore_to_at, restored_at, undoes_database_restore_id, undo_expires_at }` (`database_restore_id`), listed as `restores`; `undo_database_restore`; `erased_again_player_count`; errors `no_database_restore`, `database_restore_unavailable` | |
| A game database's use this month, and the most a game can keep | `database_use_this_month`: `read_row_count`, `written_row_count`, `storage_size_bytes`, `maximum_storage_size_bytes`; at it, `database_full` | `MAXIMUM_DATABASE_SIZE_BYTES`, `MAXIMUM_GAME_STORAGE_SIZE_BYTES` (Zaisma's own code); `database_full`, and `hosting_paused` an hour after the game's hosting paused |
| A request from a game to its own game server outside any room, and what that answers | `request_count` (in a day's `game_server`) | `Zaisma.server.request(request, { serverUrl })` answers the `answer`; the game server's `onRequest(player, request, server)`, with `server.database`; sent to `POST /v1/requests/<slug>` as `{ pass, request }`, answered `{ answer }` |
| A game server's schedules, and one run of one | `schedules` (in stats): `schedule_name`, `cron`, `version_id`, `next_run_at`, `last_run_at`; `scheduled_run_count` (in a day's `game_server`) | `schedules: [{ name, cron }]` (`Schedule`, up to `SCHEDULE_LIMITS.maximumScheduleCount`, cron in UTC); `onSchedule(run, server)` with `run.name`, `run.cron`, `run.scheduledAt` (`ScheduledRun`), and `server.database` |
| A friend request a game offers, sent only once the player says yes on Zaisma's page, and who takes them | the social setting `who_can_send_friend_requests`: `nobody` (Invites only), `played_with` (People I play with: the same room now or within the last hour), `anyone`; in Zaisma's own code `friend_requests` (`sender_account_id`, `recipient_account_id`, `answer`: `accepted`, `turned_down`) and `room_visits` | `Zaisma.friends.sendRequest(playerId)` answers `{ status }`: `sent`, `cancelled`, `already_friends`, `not_taking_requests`; the room's `{ type: "friend_request", playerId }` from a game and `{ type: "friend_request" }` to the other player (look now, never who) |
| A game's own servers that players' browsers connect to, named in the game's menu | `own_server_urls` (each `wss://` or `https://` and a host, like `wss://play.example.com`) | `serverUrl` in `Zaisma.joinRoom` and `Zaisma.friends.setRoom` |
| The hosts a game's own game server can call (game server reach), and how a call it can't make fails | `game_server_allowed_hosts` (host names, or `*.example.com` for the names under one) | plain `fetch()`; a refused call throws an `OutsideCallError` with a `code` (`OutsideCallErrorCode`: `not_https`, `unreachable_host`, `host_not_allowed`, `outside_call_limit`, `too_big`, `outside_call_timeout`, `outside_call_failed`) and a `fix` (`OUTSIDE_CALL_LIMITS`: `maximumBodySizeBytes`, `timeoutSec`, `maximumCallsPerMin`) |
| A game's registered links: the name the game opens one by, its address, whether its game page shows it, and who it opens for | `links`, each `{ link_name, destination_url, is_on_game_page, who_can_open, review_reason }`; `who_can_open`: `everyone`, `signed_in_adults`, `nobody` | `Zaisma.links.open(linkName, { path, queryParameters, ownSiteUrl })` answers a `LinkStatus`: `opened`, `stayed`; errors `unknown_link`, `bad_link_path`, `bad_link_query`, `bad_own_site_url`, `needs_player_tap` |
| A game's secrets: a name like an environment variable's, its text, and when it was set | `secret_name`, `secret_value` in; a secret is `{ name, set_at }` out, never its value; `deleted_secret_name` | `server.secrets` and `room.secrets` (by name, read-only); on your own server, the environment variables |
| Something a game sells or grants | `items`, each `{ item_name, title, description, item_kind, item_category, price_minor_units, currency_code, local_prices, card_fee_note, created_at, updated_at }`; `item_kind` `permanent`, `consumable`; `item_category` `cosmetic`, `gameplay`, `content`, `currency`; `price_minor_units` `null` for an item only granted or no longer sold (then `currency_code` `null` too); `local_prices`, each `{ currency_code, price_minor_units }`, never the main currency again; `currency_code` lowercase ISO 4217 as Stripe writes it (`usd`, `brl`); `removed_item_name`; `is_on_game_page` (the game page sells it under Add-ons too); errors `no_item`, `too_many_items`, `bad_item`, `unsupported_currency`, `price_too_low`, `item_has_owners` | `ITEM_LIMITS`, `ITEM_KINDS`, `ITEM_CATEGORIES`, `CURRENCY_MINIMUM_PRICES`, `COUNTRY_CURRENCIES`, `priceFor`, `priceText`, `cardFeeNote`, `checkItem`; `Zaisma.items.list()` answers `ItemForSale` `{ itemName, title, description, itemKind, itemCategory, priceMinorUnits, currencyCode, priceText, isOwned }` |
| A player's purchase or grant of an item, and its proof | `purchase` `{ id, item_name, item_kind, item_count, purchase_source, purchase_status, player_id, game_account_id, paid_minor_units, currency_code, refunded_minor_units, purchased_at, refunded_at, receipt }`; `paid_minor_units` what the whole purchase paid, never the item's `price_minor_units`; `purchase_source` `sale`, `grant`; `purchase_status` `pending`, `completed`, `failed`, `refunded`, `charged_back`; `item_count` how many of the item (1 for a permanent one); `receipt` the signed token; `game_account_id` the game's own ID for the player's account in its own system, given back as sent (not a Zaisma ID, so it says no kind); `is_already_owned`; `owned_item_names`, in the pass too; key area `purchase_access`; errors `no_purchase`, `bad_item_count`, `bad_game_account_id`, `bad_purchase_source`, `bad_purchase_status`, `already_refunded`, `stripe_not_connected`, `receipts_unavailable` | `ReceiptClaims` with `receipt_version_number`, `purchase_id` (and `jti`, the same), `purchased_at`, `purchase_status`, `paid_minor_units`; header `typ` `receipt+jwt`; `ReceiptError`, `ReceiptErrorCode` (`wrong_version` beside the pass codes); `verifyReceipt`, `room.verifyReceipt(receipt)`, `server.verifyReceipt(receipt)`, `RECEIPT_TOKEN_TYPE`, `RECEIPT_VERSION_NUMBER`, `ReceiptCheckBinding`, `RECEIPT_SIGNING_KEY`, `RETIRED_RECEIPT_PUBLIC_KEYS`; columns `deleted_game_slug`, `deleted_game_title` on purchases; `ReceiptSigningService`, `receiptClaimsFor`, `ownedItemNames`, `owningPurchaseOf`, `newGrant`, `recordGrant`, `takeBack`; `player.ownedItemNames` on the game server; `Zaisma.items.owns(itemName)`, `Zaisma.items.owned()` |
| A game that sells itself once, and its demo | `full_game_item_name` (the permanent content item a player owns to play; `null`: free to play), `demo_game_slug` (another of the developer's games, free to play; `demo_game_id` in the games table); Browse's `?price=` one of `free`, `under_5`, `5_to_15`, `15_to_30`, `30_and_up`; errors `bad_full_game_item`, `full_game_item_in_use`, `bad_demo_game`, `account_requirement_locked`, `full_game_not_owned` | `PRICE_RANGES`, `PriceRange`, `priceRangeOf`, `fullGameOwner`, `settlePaidGame` |
| What a game page says the game sells | `purchase_label` `{ categories, has_own_payments }`; `own_payment_categories` (what the developer sells through their own payments, the same four categories); `refund_policy` `no_refunds`, `unused_within_14_days`, `within_14_days`, `own_words`, with `refund_policy_text`; errors `refund_policy_needed`, `bad_refund_policy`, `bad_refund_policy_text`, `bad_own_payment_categories`; content rule `purchases`, findings `ai_paid_random_rewards`, `ai_coin_price_without_real_price` | `REFUND_POLICIES`, `purchaseLabelOf`, `checkPurchaseSettings` |
| Where a game's purchases are delivered, each exactly once | `purchase_delivery` (`game`, `game_server`, `own_server`; `game` by default), in the purchase settings beside `refund_policy`; errors `bad_purchase_delivery`, `no_game_server` | `config.purchaseDelivery` (`"game"`, `"game_server"`, `"own_server"`, given to the SDK by the page); `startServer({ zaismaKey })`, and `ZAISMA_KEY` on your own server for `onPurchase` and `onRefund` |
| Whether a purchase, and its refund, reached the game, its game server or your own server | `handled_at` and `refund_handled_at` on a `purchase` (ISO time, `null` until then); `unhandled_purchases` (completed purchases not handled, and refunded or charged-back ones handled but not yet told, oldest first, at most 50 purchases and 50 refunds) in `get_player_items`; `mark_purchase_handled` (`POST …/purchases/:purchase_id/handled`); webhook events `purchase_completed` and `purchase_refunded` with `purchase` (`null` in every other event); errors `already_handled`, `handled_by_server` | `Zaisma.items.unhandled()` answers `Purchase[]` `{ id, itemName, itemKind, itemCount, purchaseSource, purchaseStatus, gameAccountId, paidMinorUnits, currencyCode, purchasedAt, refundedAt, receipt }`; `Zaisma.items.markHandled(purchaseId)`, errors `bad_purchase_id`, `no_purchase`, `already_handled`, `handled_by_server`, `slow_down` |
| A purchase, or its refund, arriving at the game or its game server | | `Zaisma.items.on("purchase", listener)` and `Zaisma.items.on("refund", listener)` (`ItemsEvents`, `off` to stop), each listener gets a `Purchase`; `onPurchase(state, player, room, purchase)` and `onRefund(state, player, room, purchase)` on the game server (`Purchase`, `PurchaseHandling`, `purchaseHandling` on a `Transport`); the room message `{ type: "zaisma:purchase", purchaseId, receipt? }` the SDK sends to a game server's rooms after a purchase |
| What a request to a game server can fail with | | `RequestErrorCode`: `bad_request`, `too_big`, `bad_pass`, `account_needed`, `game_not_open_to_player`, `game_unavailable`, `no_request_handler`, `game_server_error`, `hosting_paused`, `slow_down`, `bad_origin`, `busy` |
| What an error or a review reason is, and its other parts | `code`; `message`, `field`, `fix`, `retry_after_sec` (inside `error` only); `content_rule` (inside `review_reason` and `findings` only) | `code` (on the error only) |

## Adding a field, option or tool

1. Look in the glossary. If the concept is there, use its name.
2. Name it by its shape: what it's about, the kind of value, the unit.
3. One type, one unit, and the same keys every time.
4. Describe it in the schema, with limits.
5. Add examples if a call could go wrong, good and bad, as many as it needs.
6. Errors get a code, a field and a fix; changes answer with `next_steps`.
7. Update the glossary, `docs/DEVELOPER-API.md` and the SDK's types (`packages/sdk/zaisma.d.ts`, its reference) in the same change.
8. After the beta, renaming or removing a field, option or tool follows "What's live keeps working" in `docs/DECISIONS.md`.
