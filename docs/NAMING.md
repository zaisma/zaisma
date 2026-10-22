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
7. **Same words in each surface's style.** snake_case in the API and MCP (`play_duration_min`), camelCase in the SDK and game server (`playDurationMin`). Choice values and error codes are lowercase snake_case everywhere (`when_approved`, `keyboard_mouse`, `month_limit`); a word that's hyphenated in plain English keeps its hyphen (`co-op`).
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
- **Yes/no columns are named like booleans** (`cloud_saves_enabled`, `is_listed`), even though D1 stores them as 0 or 1. Every other number column ends in `_count`, a unit, `_ms` or `_per_<unit>`.
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
Not: { "at": 1792012345678 } (publish_at takes an ISO time like "2026-11-01T17:00:00Z")
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
{ "error": { "code": "bad_time", "message": "publish_at is in the past.", "field": "publish_at", "fix": "Give an ISO time from 5 minutes to 90 days ahead, like \"2026-11-01T17:00:00Z\".", "retry_after_sec": null } }
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
- **API keys** keep `zsk_`, and webhook signing secrets Standard Webhooks' `whsec_`; the headers webhooks are sent with (`webhook-id`, `webhook-timestamp`, `webhook-signature`) are Standard Webhooks' own.

## Glossary

One name per concept. The API and MCP column is snake_case; the SDK and game server column is camelCase. ID rows give the name for pointing at one; on the object itself it's `id`.

| Concept | API and MCP | SDK and game server |
| --- | --- | --- |
| A game's link name, as in zaisma.com/g/<slug> | `slug` | `slug` |
| A version of a game | `version_id` | |
| A cover or screenshot | `image_id` | |
| A game's world behind Zaisma's glass, for one screen, and what it shows | `background`: `screen`, `source` (`zaisma`, `image`, `shader`, and on phone `wide`), `image_id`, `shader_id`, `still_url`; pictures are images of `kind` `background` and `phone_background` | |
| Which screen a background is for | `screen`: `wide` (desktops and tablets), `phone` (composed for a tall screen); errors `bad_screen`, `bad_background_source`, `background_not_ready` | |
| A small program that paints a background live | `shader_id`; a shader's `check_frame_ms`, `flash_count`, `still_url`, `frame_urls`, `source_url`. Its source keeps Shadertoy's names on purpose (`mainImage`, `fragColor`, `fragCoord`, `iResolution`, `iTime`), the form AI already writes, so nothing is left to guess | |
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
| Who an account can chat with, and the opaque group accounts that chat with anyone chat in (never an age) | | player pass claims `who_can_chat`: `nobody`, `friends`, `anyone`; `chat_group` (a `chat_group_…` ID, different in every game); checked with `canChat(first, second)` |
| An account's Zaisma friends, and the invite that makes two accounts friends | | player pass claim `friend_tag_ids` (their `player_tag`s, never their player IDs), checked with `areFriends(first, second)`; `room.areFriends(firstPlayerId, secondPlayerId)`; a friend invite's `invite_code` is 8 letters and digits, shown as `K7Q2-MX9P` |
| A player's friends playing this game, the room to join each in, and why not | `server_url` (in Zaisma's own code: a room on the game's own servers) | `Zaisma.friends.list()` answers `{ friends }`, each `{ id, name, username, roomCode, serverUrl, joinRefusal }`; `joinRefusal`: `game_not_taking_joins`, `friend_not_taking_joins`, `private_room`, `match_in_progress`, `room_full`, `no_room`; `Zaisma.friends.setRoom({ serverUrl, roomCode, friendJoinsEnabled })` (null when the player left), refused with `unlisted_server`; a friend's Join link's `?server=`, read as `Zaisma.rooms.linkedServerUrl` |
| A block between two players, either way (never who made it, never anyone's list of blocks) | | `room.hasBlockBetween(firstPlayerId, secondPlayerId)`; player pass claims `player_tag` (the account's own `player_tag_…` ID, different in every game) and `block_tag_ids` (the player tags of the accounts it has a block with), checked with `hasBlockBetween(first, second)`; the room's `{ type: "blocks", playerIds }` to each player; a game's `{ type: "block", playerId }` and `{ type: "unblock", playerId }`; `room.block(playerId)`; quickJoin's hello `avoidBlockedPlayers: true`, turned away with `blocked_player_here` |
| Whether Zaisma's Join (friends on zaisma.com, `Zaisma.friends`) takes players into a game's rooms, or into one room, and whether a game joins players by itself | `friend_joins_enabled`, error `bad_friend_joins_enabled`; `quick_joined_at_ms` (Zaisma's own code) | `friendJoinsEnabled` in `joinRoom`, `quickJoin`, `room.reserve` and the room's settings; `room.setFriendJoinsEnabled(isEnabled)`; every hello from quickJoin says `isQuickJoin: true` |
| What Zaisma's chat filter stopped, and why (one set of reasons everywhere) | `reason`: `contact_details`, `personal_details`, `slur`, `sexual`, `chat_paused`, `unchecked`; a message kept for review is a `chat_review_…` ID, `chat_review_id` in the admin MCP | `Zaisma.filterText` and `checkChat` answer `isAllowed`, `reason` (the same values), `message` (the words the sender sees) and `hasSwearing` |
| What a game needs a Zaisma account for | `account_requirement`: `none`, `multiplayer`, `whole_game`; a guest turned away gets `account_needed` | error `code` `account_needed` |
| A game asking a guest to sign in while it runs, and the guest saying Not now | | `Zaisma.player.signIn()`; error `code` `sign_in_declined` |
| A developer's own site or app that players sign in to with Zaisma, and OAuth's client type for it | `sign_in_app_id` (the OAuth `client_id`); `kind`: `confidential`, `public` | |
| Where a sign-in can go back to, and asking for a new client secret | `redirect_urls`; `replace_client_secret: true`, answered once as `client_secret` | |
| What an API key may do, and on which games | `access`: `api_key_name`, `access_level` (`read`, `upload`, `publish`, `full`, `custom`), `area_access` (each area's choice: `game_access`, `version_access`, `stats_access`, `database_access`, `save_access`, `forum_access`, `sign_in_app_access`, `webhook_access`; choices `none`, `read`, `write`, and for versions `upload`, `publish`), `game_slugs` (`null` for every game); refused with `key_not_allowed` | |
| An AI app that connects to the MCP by signing in (OAuth's client), and the connection it makes | `mcp_client_id` (the OAuth `client_id`: an `mcp_client_…` ID, or its metadata document's URL); on `list_api_keys` items, `kind` (`api_key`, `connected_app`) and `connected_app_host` | |
| An address a developer's server takes Zaisma's events at (or the game's own game server), the events it takes and the games they're about | `webhook_id`; `destination_kind` (`endpoint_url`, `game_server`), `endpoint_url` (`null` for a game server), `event_kinds`, `game_slugs` (`null` for every game; a game server's one game) | `onWebhook(event, server)` (`WebhookEvent`, the same JSON), `WEBHOOK_LIMITS`; on your own server, POSTs at `/v1/webhooks` checked with `ZAISMA_WEBHOOK_SIGNING_SECRET` |
| What a webhook is sent, and what happened | `webhook_event`, its `id` a `webhook_event_…` ID; its `kind`: `bug_reported`, `player_reported`, `scan_status_changed`, `live_version_changed`, `review_status_changed`, `game_server_error_found`, `alert_raised`, `account_deleted` (with `player_id`, and `game` or `sign_in_app`), `security_alert` (with `security_event`), `test`; what it carries: `game`, `version`, `bug_report`, `player_report`, `game_server_error`, `alert`, `player_id`, `sign_in_app`, `security_event` | |
| Asking for a new signing secret for a webhook | `replace_signing_secret: true`, answered once as `signing_secret` (`whsec_…`, Standard Webhooks' form) | |
| An event on its way to one webhook, and how it went | `delivery_status`: `pending`, `delivered`, `failed`; `attempt_count`, `last_attempt_at`, `next_attempt_at`, `failure_message`; `pending_delivery_count`, `failed_delivery_count` | |
| The youngest age that can play a game, in years: 13, 16 or 18; never a band name. A younger account turned away gets `game_not_open_to_player` | `minimum_player_age_years`; errors `bad_minimum_player_age`, `accounts_needed_for_minimum_age` | error `code` `game_not_open_to_player` |
| How many players, and the most and fewest allowed | `player_count`, `maximum_player_count`, `minimum_player_count` | `playerCount`, `maximumPlayerCount`, `minimumPlayerCount` |
| Players who watch a room without playing: how many, the most a room takes, joining to watch, and their handlers | `spectator_count`, `maximum_spectator_count` | `maximumSpectatorCount`, `room.spectators`, `isSpectator` (joinRoom's option, `room.isSpectator`, `joinInfo.isSpectator`, a hello's), `spectatorCount`, `onSpectatorJoin(state, spectator, room)`, `onSpectatorLeave(state, spectator, room)`, `Zaisma.rooms.isLinkedAsSpectator` (a link's `watch=1`); errors `watching_full` (no room for another spectator) and `spectator_cannot_send` |
| Who a broadcast reaches | | `audience`: `everyone` (the default), `players`, `spectators`, in `room.broadcast` and `room.broadcastBytes` |
| How many files, and their total size | `file_count`, `size_bytes` | |
| An image's size on screen | `width_px`, `height_px` | |
| Counted plays, and time on screen in them | `play_count`, `play_duration_min` | |
| Player time in rooms, data through the relay, and both as the free tier counts them | `room_play_duration_min`, `room_play_duration_hours`; `relayed_size_bytes`; `counted_play_duration_hours` | |
| The time a game's own game server ran in its rooms, counted on the player-hour meter past what player-hours include | `game_server_cpu_duration_sec`; in Zaisma's own code `game_server_cpu_duration_ms` | `PLAYER_HOUR_INCLUDED_CPU_DURATION_SEC`, `PLAYER_HOUR_CPU_DURATION_SEC` (Zaisma's own code) |
| Bytes a game and its room send each other, and whose they are | | `room.sendBytes(bytes)` and the `"bytes"` event `(bytes, fromPlayerId)` in the SDK, error `code` `bad_bytes`; `onBytes(state, player, bytes, room)`, `room.broadcastBytes(bytes, { exceptPlayerId, fromPlayerId })`, `room.sendBytes(playerId, bytes)` on the game server |
| A game's room traffic: messages and bytes each way per player a second, its message types, and what to change | `inbound_messages_per_player_sec`, `inbound_size_bytes_per_player_sec`, `outbound_messages_per_player_sec`, `outbound_size_bytes_per_player_sec`; `room_traffic` with `message_types` (`message_type`, `direction`: `inbound`, `outbound`, `average_size_bytes`, `largest_size_bytes`) and `traffic_hints` (`code`: `json_messages_large`, `outbound_heavy`, `message_near_limit`, `latest_only_available`); `message_type` `(state)` for state sync's updates. Inside: `room_message_types.backed_up_message_count` | `STATE_MESSAGE_TYPE`, `backedUpMessageCount` (Zaisma's own code) |
| How many days a report or stats answer covers | `period_duration_days` | |
| What the game check finds before an upload | `problems`, each `{ code, problem_kind, is_fixed_by_upload_command, message, path, quote, fix }`, `problem_kind` `refused` or `broken`; `omitted_problem_count` | |
| A version's scan result, and what it found that holds or rejects it | `scan_status`: `scanning`, `held`, `approved`, `rejected`; `findings`, each `{ code, severity, message, content_rule, path, fix }` | |
| How a version started in headless Chrome, and what would make it much smaller (notes, never holds) | `performance_check`: `{ check_status, checked_at, browser_description, loading_duration_sec, start_download_size_bytes, start_file_count, start_memory_size_bytes, longest_start_task_duration_ms, notes }`, `check_status` `waiting`, `checking`, `checked`, `over_daily_limit`, `could_not_run`; a performance note `{ code, message, path, saved_size_bytes, fix }`; the game check's `performance_notes`. Inside: `performance_checks.start_files`, each `{ path, destination, is_cors_request, downloaded_size_bytes }` | `PERFORMANCE_CHECK_LIMITS` |
| How a game runs on players' devices, as totals (never per player), and the switch for it | `performance` in `get_stats`: `version_totals` and `device_totals`, each row `{ version_id, play_count, median_loading_duration_sec, slow_tenth_loading_duration_sec, median_frames_per_sec, low_tenth_frames_per_sec, long_frames_per_min, crashed_play_pct, error_stop_count, context_lost_count, stopped_responding_count, median_peak_memory_size_bytes, is_measured }`, a device row also `browser_name` (`chrome`, `edge`, `firefox`, `safari`, `samsung_internet`, `other`), `os_name` (`windows`, `macos`, `linux`, `chromeos`, `android`, `ios`, `other`), `device_kind` (`computer`, `phone`, `tablet`; `other` only in the folded row) and `graphics_family` (`nvidia`, `amd`, `intel`, `apple`, `qualcomm`, `arm`, `imagination`, `other`, `unknown`); the game's `performance_measuring_enabled`, error `bad_performance_measuring_enabled`. Inside: `performance_days` (`loading_counts`, `frame_rate_seconds`, `memory_counts`: JSON arrays of counts by bucket), `play_tickets.has_performance_loading`, `has_performance_crash`, `measured_duration_sec`; page messages `zaisma:performance`, `zaisma:alive` | `LOADING_BUCKETS_SEC`, `FRAME_RATE_BUCKETS`, `MEMORY_BUCKETS_BYTES`, `BROWSER_NAMES`, `OS_NAMES`, `DEVICE_KINDS`, `GRAPHICS_FAMILIES`, `CRASH_KINDS`, `PLAYER_PERFORMANCE_LIMITS`, `browserOf`, `osOf`, `percentileOf`, `frameRateAt` |
| The AI review's two daily limits, and a version that steps aside for a newer one | a large review (read and judged: `daily_large_reviews_used`) and a small review (read alone: `daily_small_reviews_used`), never "judged review"; `replaced_by_version_id` (`version_replaced`). Inside: `read_at_ms` (when a version's small review ran), `is_small_review` in a scan report, and in the admin MCP `changes_since` with `added_paths`, `changed_paths`, `removed_paths` and their `*_path_count` | `REVIEW_LIMITS.maximumLargeReviewsPerDay`, `maximumSmallReviewsPerDay` |
| A sample game in the review test set, and what a run found | `is_honest`, `content_rule`, `protection`, `why` (in `case.json`); `outcome`: `held_bad`, `missed_bad`, `passed_honest`, `held_honest`, `inconsistent` (Zaisma's own code) | |
| Zaisma's review of a game | `review_status`: `pending`, `live`, `held`, `removed` | |
| Why Zaisma held, rejected or took down a game, version or image | `review_reason`: `{ code, message, content_rule, fix }`, its `code` from `REVIEW_CODES` | |
| Why a cover or a title keeps a game off Zaisma's lists, or held it for a fake reward ("No slop") | `listing_reason` on an image, `title_listing_reason` on a game, shaped like `review_reason`; the `game_off_lists` alert. Inside: `cleared_at_ms` on an image and `cleared_title` on a game (a person cleared it), `listing_check_requested_at_ms`, `listing_checked_at_ms` | |
| What needs a developer's attention in a game | `alerts`, each `{ kind, message, fix, version_id }`, `kind` one of `game_removed`, `game_held`, `version_rejected`, `version_held`, `link_flagged`, `game_off_lists`, `rooms_paused`, `requests_paused`, `database_paused`, `database_writes_paused`, `database_full`, `rooms_nearly_paused`, `requests_nearly_paused`, `database_nearly_paused`, `database_writes_nearly_paused`, `database_nearly_full`, `player_erase_failed`, `reports_open`; a heads-up is its paused kind with `nearly` | |
| A content rule, as a hold or takedown names it | `content_rule`: `child_safety`, `sexual`, `malware`, `illegal`, `real_people`, `copyright`, `defamation`, `personal_details`, `chat`, `crypto`, `faked_plays` (the same words as a report's `reason` where they mean the same) | |
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
| Time without input before "Still there?", and who checks | | `idleTimeoutSec`, `idleCheck`: `server`, `client`, `off`; a player's game turns its own off with `idleCheckEnabled: false` |
| How long a seat is held for a player who walked away | | `seatHoldDurationSec` |
| How long a player whose connection dropped stays in the match, and why a player in the room isn't playing | | `reconnectTimeoutSec`; `awayReason`: `idle`, `hidden`, `lost` or `null` (`room.awayReason(playerId)` on the game server, each `ListedPlayer` in `room.players` in the game) |
| When Zaisma will end a match past the month's free tier, and hearing it | | `endsAt` (an ISO time); the game server's `onEnding`, the SDK's `ending` event, the room's `{ type: "ending", endsAt }` |
| When running matches get a newly published version | `match_update_mode`: `next_match`, `now` (on a publish, and on a version that goes live by itself) | the game server's `onVersionUpdate(state, versionUpdate, room)` with `VersionUpdate` `versionId` and `forcedAt` (an ISO time), `room.applyVersionUpdate()`; the room's `versionUpdate` event with `versionId`, `appliesAt` (an ISO time) and `isReloading`; `Zaisma.versions.on("update")` and `update.apply()` for games not in a match; a hello's `versionId` (the version the player's game runs), turned away with `other_version` and the room's `versionId` when its game server runs another; `live_rooms.version_id` |
| How often a real-time room saves its state, and a room coming back from a restart with it | | `stateSaveIntervalSec`; the game server's `onRestored(state, restoreInfo, room)`, with `RestoreInfo` `savedAt` (an ISO time), `lostDurationSec` and `savedVersionId`; the Node runner's `--room-state` file (`startServer({ roomStateFile })`, table `room_states`) |
| A room that keeps its world when everyone leaves, sleeping until someone joins, and the game's storage it counts toward with the database | `kept_rooms` (each `room_code`, `name`, `saved_size_bytes`, `saved_at`, `last_played_at`, `created_at`), `kept_rooms_size_bytes`, `storage_size_bytes`, `free_storage_size_bytes`, `is_deleted`; `live_rooms.is_kept`; tools `list_kept_rooms`, `delete_kept_room`; error `no_kept_room`; `zaisma kept-rooms` | `room.isKept`, `room.setKept(isKept)`; `isKept` in `room.reserve` and `ListedRoom`; Zaisma's own `Saved.isSavedEmpty` and the Node runner's `room_states.is_saved_empty` (saved as the room emptied: nothing lost) |
| What happens to a player who walks away | | `awayMode`: `hold`, `lobby` |
| Sending each player the game server's state, then only what changed, and what each player sees of it | | `stateSyncEnabled`; `stateView(state, viewer, room)`; the room's `{ type: "state", serverTimeMs, full }` and `{ type: "state", serverTimeMs, changes }`; a `StateChange` `[path, value]` or `[path]`; `room.state`, the `"state"` event `(state, changes)` and `room.smoothedState(delayMs)` in the SDK, error `code` `bad_delay`; `ROOM_LIMITS.maximumStateViewSizeBytes`; in Zaisma's own code `diffState`, `applyStateChanges`, `newStateTracker` |
| A send that may be dropped for a newer one while a player's connection is backed up | | `delivery`: `reliable`, `latest_only`; `latestKey`; `SendOptions` in the SDK and on the game server, error `code` `bad_send_option`; a player's connection is backed up (`isBackedUp`, `ROOM_LIMITS.backedUpSizeBytes`, `backedUpDelayMs`); `ROOM_LIMITS.maximumLatestOnlySlotCount`, `maximumLatestKeyCharacterCount` |
| A message between a game and its room, and the game's own message in it | | `type`, `data` |
| What a player's game brings into a room, and what a room another room made starts with | | `joinData`, `setupData` |
| How a player came into a room, and why they left or walked away | | `joinInfo: { fromRoomCode, isReturning, isSpectator }`; `leaveInfo: { reason }`, `reason` one of `left`, `lost`, `idle`, `hidden`, `kicked` |
| Words a person reads about what happened: an error's, a kick's, a refusal's, a match's end | `message` | `message`; `refusalMessage` in what `canJoin` answers (`true`, `false` or `{ refusalMessage }`) |
| The room's host, who can run it from the game, and whether a game server has one | | `hostPlayerId`, `hostControlsEnabled` |
| Whether a room shows in room lists, and takes new players | | `isListed`, `isOpen` |
| Rooms in a room list: all of a game's, ones with space, ones taking players, the ones past the list, and seats held | | `roomCount`, `joinableRoomCount`, `openRoomCount`, `moreOpenRoomCount`, `heldSeatCount` |
| A part of the world rooms run in: a continent code, like `EU` | | `region` |
| Where a room's connection stands | | `connectionStatus`: `connecting`, `open`, `reconnecting`, `away`, `closed` |
| Keeping a kicked player out, as asked and as told | | `keepOut` (asked), `isKeptOut` (told) |
| A player's cloud save, what it holds, and who made it as it is | `local_storage_items` (each localStorage key and its text), `indexeddb_databases`, `keys` (some localStorage keys asked for) and `missing_keys`; `changed_by_kind`: `player`, `developer` | |
| An earlier version of a save, why it was kept, and the one a change kept | `save_copy_id`; `saved_at`, `copy_reason`: `hourly`, `replaced`, `smaller`, `restore`, `device`, `developer`; `is_current_save`; `save_copy_count`; `kept_save_copy_id` | |
| A game's own SQLite database, a statement for it and the values for its `?`s | `sql`, `values` (a blob as `{ blob_base64 }`), `statements`; answered as `rows`, `statement_results` (one per statement) and `read_row_count`, `written_row_count`; its `tables` and `indexes` (`table_name`) | `room.database`: `query(sql, values)` answers rows, `batch(statements)` runs `{ sql, values }` statements in one transaction; a `DatabaseError` has a `code` and a `fix` |
| Erasing a player from a game's database, and whether Zaisma does it when they delete their account | `erase_player`, `erased_tables` (`table_name`, `erased_row_count`); `deleted_account_erase_enabled` | `database.erasePlayer(playerId)` answers `[{ tableName, erasedRowCount }]` |
| A game database's whole contents as SQLite's SQL dump, in parts | `dump_sql` (one part, in and out), `next_cursor` and `cursor` between parts; an import answers `statement_count` and `skipped_statement_count` | `dumpPart(read, cursor)` answers `{ dumpSql, nextCursor, readRowCount }`; `importStatements(dumpSql)` (`DUMP_LIMITS`: `exportPartSizeBytes`, `maximumImportPartSizeBytes`) |
| Going back to an earlier moment of a game's database, and undoing that | `restore_database`, `restore_to_at`; a restore is `{ id, restore_to_at, restored_at, undoes_database_restore_id, undo_expires_at }` (`database_restore_id`), listed as `restores`; `undo_database_restore`; `erased_again_player_count`; errors `no_database_restore`, `database_restore_unavailable` | |
| A game database's free use a month, and its use this month | `database_use_this_month`: `read_row_count`, `written_row_count`, `storage_size_bytes` beside `free_read_row_count`, `free_written_row_count`, `free_storage_size_bytes`; `has_reached_free_reads`, `has_reached_free_writes`, `has_reached_free_storage`; `reset_date` | `writtenRowCountPerMonth`, `readRowCountPerMonth`, `storageSizeBytes` (`GAME_DATABASE_FREE_LIMITS`); past them, `database_write_limit`, `database_read_limit`, `database_storage_limit` |
| A request from a game to its own game server outside any room, and what that answers | `request_count` (in a day's `game_server`) | `Zaisma.server.request(request, { serverUrl })` answers the `answer`; the game server's `onRequest(player, request, server)`, with `server.database`; sent to `POST /v1/requests/<slug>` as `{ pass, request }`, answered `{ answer }` |
| A game's requests a month, free and used | `request_use_this_month`: `request_count`, `free_request_count`, `has_reached_free_requests` | `FREE_REQUEST_COUNT_PER_MONTH`; past it, `request_limit` |
| A game server's schedules, and one run of one | `schedules` (in stats): `schedule_name`, `cron`, `version_id`, `next_run_at`, `last_run_at`; `scheduled_run_count` (in a day's `game_server`) | `schedules: [{ name, cron }]` (`Schedule`, up to `SCHEDULE_LIMITS.maximumScheduleCount`, cron in UTC); `onSchedule(run, server)` with `run.name`, `run.cron`, `run.scheduledAt` (`ScheduledRun`), and `server.database` |
| A game's own servers that players' browsers connect to, named in the game's menu | `own_server_urls` (each `wss://` or `https://` and a host, like `wss://play.example.com`) | `serverUrl` in `Zaisma.joinRoom` and `Zaisma.friends.setRoom` |
| The hosts a game's own game server can call (game server reach), and how a call it can't make fails | `game_server_allowed_hosts` (host names, or `*.example.com` for the names under one) | plain `fetch()`; a refused call throws an `OutsideCallError` with a `code` (`OutsideCallErrorCode`: `not_https`, `unreachable_host`, `host_not_allowed`, `outside_call_limit`, `too_big`, `outside_call_timeout`, `outside_call_failed`) and a `fix` (`OUTSIDE_CALL_LIMITS`: `maximumBodySizeBytes`, `timeoutSec`, `callsPerMin`) |
| A game's registered links: the name the game opens one by, its address, whether its game page shows it, and who it opens for | `links`, each `{ link_name, destination_url, is_on_game_page, who_can_open, review_reason }`; `who_can_open`: `everyone`, `signed_in_adults`, `nobody` | `Zaisma.links.open(linkName, { path, queryParameters, ownSiteUrl })` answers a `LinkStatus`: `opened`, `stayed`; errors `unknown_link`, `bad_link_path`, `bad_link_query`, `bad_own_site_url`, `needs_player_tap` |
| A game's secrets: a name like an environment variable's, its text, and when it was set | `secret_name`, `secret_value` in; a secret is `{ name, set_at }` out, never its value; `deleted_secret_name` | `server.secrets` and `room.secrets` (by name, read-only); on your own server, the environment variables |
| What a request to a game server can fail with | | `RequestErrorCode`: `bad_request`, `too_big`, `bad_pass`, `account_needed`, `game_unavailable`, `no_request_handler`, `game_server_error`, `request_limit`, `slow_down`, `bad_origin`, `busy` |
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
