# Naming

How names, values, inputs, examples, errors and next steps work everywhere an AI or a developer reads or writes Zaisma: the developer API, the developer and admin MCPs, the SDK, the game server API, the docs and examples that show them, and Zaisma's own code (database columns, types, functions and variables). It's the working half of "Nothing for an AI to guess" in `docs/DECISIONS.md`. The inside uses the same names as the outside, so nothing needs translating between them.

Why: an AI reading `files: 12`, `dt` or `created_at: 1792012345678` has to stop and work out what it means, and sometimes gets it wrong. Every guess costs tokens and some cost a wrong call. A name that says what it holds, what kind of value and in what unit lets the AI predict the right value and the right next call straight away.

The existing API, MCPs, SDK, game server and Zaisma's own code are moving to these names area by area, each a clean change (old names stop working). Until each lands, everything new follows this guide. The messages between the SDK and rooms move too: `type` and `data`, not `t` and `d` (rooms are billed per message, never by its size). Examples in this guide show the pattern; the glossary at the end lists the names that exist.

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
| `_bytes` | bytes |
| `_px` | CSS pixels |
| `_deg` | degrees |
| `_pct` | percent, 0 to 100 (never 0 to 1) |

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

The same rules hold inside, with these on top. `test/node/naming.test.ts` checks identifiers, type fields and the database columns the migrations make.

- **Same words, two styles.** Database rows and API data are snake_case (`review_status`, `size_bytes`); variables, functions and types are camelCase or PascalCase (`reviewStatus`, `sizeBytes`). Never mix them in one shape: a stored JSON object is snake_case all the way down.
- **Columns take the API's names**, so the API passes data through instead of renaming it: `games.review_status`, `versions.patch_notes`, `game_images.width_px`. When the API shows something differently (an ISO time, a list made from text), only the value's form changes, never its name.
- **Stored times are `<event>_at_ms`**: epoch milliseconds, in columns and in variables (`createdAtMs`). `_at` always means an ISO string. `iso()` (`packages/core/src/time.ts`) is the only conversion between them.
- **Yes/no columns are named like booleans** (`cloud_saves_enabled`, `is_listed`), even though D1 stores them as 0 or 1. Every other number column ends in `_count`, a unit, `_ms` or `_per_<unit>`.
- **Whole words everywhere**, callback parameters included: `games.map((game) => …)`, `catch (error)`, `(first, second) => …` in a sort. `i` is the one short name, for a loop index.
- **Names the platform sets keep its spelling**: Worker bindings and secrets in `Env` (`DB`, `GAMES`), `env` and `ctx` in Worker handlers, and Web and Cloudflare API fields (`httpMetadata`, `etag`). Our own variables holding them still get whole words (`response`, not `res`).
- **Old names are paid down area by area.** `test/naming-baseline.json` lists the names not yet moved over, per file and per table. The check fails on any new one, and on any listed one that's gone, so the list only ever shrinks: fix a name, then run `npm run naming:baseline` to update it.

## IDs

Every ID Zaisma makes says its kind in its value: `<kind>_<random>`, the kind in whole words (`play_ticket_…` for a kind of two words; the random part never has an underscore). An object's own ID is `id`, because the value already says what it is; an ID that points at another object is `<kind>_id` (`{ "id": "post_4k…", "topic_id": "topic_9x…" }`). An AI always knows what it's holding, and passing one where another kind belongs gets a clear error ("That's an image ID; version_id takes a version ID from get_game").

| Kind | Example |
| --- | --- |
| `game` | `game_…` |
| `version` | `version_…` |
| `image` | `image_…` |
| `tester` | `tester_…` |
| `topic` (known issues too) | `topic_…` |
| `post` | `post_…` |
| `report` | `report_…` |
| `media` | `media_…` |
| `precedent` | `precedent_…` |
| `player` | `player_…` |
| `owner` | `owner_…` |
| `save_copy` | `save_copy_…` |
| `play_ticket` | `play_ticket_…` |
| `room_key` | `room_key_…` |

A new kind is added here in the same change. The developer API and MCP still name a game by its `slug`, the link name developers know. Not IDs, and kept as they are: a `slug`, a `room_code` (six letters players type), API keys (`zsk_…`, a format secret scanners know) and file hashes (`sha256`).

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

- **Standard formats keep their own names**: HTTP headers, JSON-RPC and MCP fields (`inputSchema`, `isError`, `structuredContent`) and JSON Schema keywords (`maxLength`).
- **API keys** keep `zsk_`.

## Glossary

One name per concept. The API and MCP column is snake_case; the SDK and game server column is camelCase. ID rows give the name for pointing at one; on the object itself it's `id`.

| Concept | API and MCP | SDK and game server |
| --- | --- | --- |
| A game's link name, as in zaisma.com/g/<slug> | `slug` | `slug` |
| A version of a game | `version_id` | |
| A cover or screenshot | `image_id` | |
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
| Taking back a vote, a helpful mark or a follow | `undo: true` in the MCP; `DELETE` in the API | |
| Posts an account can still make today | `remaining_post_count` | |
| A room players join by typing it | `room_code` | `roomCode` |
| A player | `player_id` | `playerId` |
| How many players, and the most and fewest allowed | `player_count`, `maximum_player_count`, `minimum_player_count` | `playerCount`, `maximumPlayerCount`, `minimumPlayerCount` |
| How many files, and their total size | `file_count`, `size_bytes` | |
| An image's size on screen | `width_px`, `height_px` | |
| Counted plays, and time on screen in them | `play_count`, `play_duration_min` | |
| Player time in rooms | `room_play_duration_min`, `room_play_duration_hours` | |
| How many days a report or stats answer covers | `period_duration_days` | |
| A version's scan result | `scan_status`: `scanning`, `held`, `approved`, `rejected` | |
| Zaisma's review of a game | `review_status`: `pending`, `live`, `held`, `removed` | |
| Who can see a game | `visibility`: `draft`, `listed`, `unlisted`, `private` | |
| Where to continue a list | `cursor` in, `next_cursor` out | |
| How a game is played | `play_modes`: a list of `{ mode, minimum_player_count, maximum_player_count, play_style }` | |
| A version's notes for players, and when it goes live by itself | `patch_notes`, `scheduled_publish_at` | |
| Links, by what they open | `page_url` (a game's page), `preview_url` (a version), `image_url`, `link_url` (a tester link) | |
| Forum topics with something new from Zaisma | `unread_topic_count` | |
| The calls that usually follow a change | `next_steps` | |
| Ticks a second, and the time since the last tick | | `ticksPerSec`, `tickDurationSec` |
| Time without input before "Still there?", and who checks | | `idleTimeoutSec`, `idleCheck` |
| How long a seat is held for a player who walked away | | `seatHoldDurationSec` |
| What an error is, and its other parts | `code`; `message`, `field`, `fix`, `retry_after_sec` (inside `error` only) | `code` (on the error only) |

## Adding a field, option or tool

1. Look in the glossary. If the concept is there, use its name.
2. Name it by its shape: what it's about, the kind of value, the unit.
3. One type, one unit, and the same keys every time.
4. Describe it in the schema, with limits.
5. Add examples if a call could go wrong, good and bad, as many as it needs.
6. Errors get a code, a field and a fix; changes answer with `next_steps`.
7. Update the glossary, `docs/DEVELOPER-API.md` and the SDK docs in the same change.
