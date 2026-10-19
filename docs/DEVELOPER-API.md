# Developer API

One API behind the developer MCP, the upload command (`packages/cli`) and the dashboard (zaisma.com/dashboard, `apps/site/src/dashboard.ts`), so they always agree. Base: `https://zaisma.com/api/dev`. Every answer is JSON. Errors say what happened, which input, and what to do (see Errors below), and every call that changes something answers with `next_steps` (see Next steps).

Names follow [`docs/NAMING.md`](NAMING.md): each one says what it holds, what kind of value and in what unit (`file_count`, `size_bytes`, `play_duration_min`, `width_px`), times are ISO 8601 in UTC (`created_at: "2026-10-14T09:30:00.000Z"`) and come in the same way, every ID says its kind (`version_8f3k…`, `topic_9x2m…`, `post_4kq7…`; an ID of another kind is refused with `wrong_id_kind`, saying what it is and where the right one comes from), a plural is always a list, and every answer has the same keys every time (`null` when not set). Inputs are closed: a field or query parameter a call doesn't take is refused (`unknown_field`), never quietly ignored, and so is a value that isn't one of its choices. The JSON Schema of each answer is in `apps/site/src/schemas.ts`.

## The MCP

Any AI tool that supports remote MCP servers can manage your games at `https://zaisma.com/mcp`, signed in with the same API key. In Claude Code:

```bash
claude mcp add --transport http zaisma https://zaisma.com/mcp --header "Authorization: Bearer $ZAISMA_KEY"
```

Apps that can't send a key connect by signing in instead. In claude.ai: Settings → Connectors → Add custom connector, with `https://zaisma.com/mcp`; ChatGPT and other apps the same way, wherever they add a remote MCP server. The app opens a Zaisma page where you choose what it may do and tap your passkey, then you're back in the app with every tool working. The key command above stays the way for Claude Code and the upload command.

Every tool is a call to this API (`apps/site/src/mcp.ts`): `list_games`, `create_game`, `get_game`, `update_game`, `check_game` (what Zaisma would refuse in a game and what won't work on Zaisma, before uploading; see Checking a game below), `upload_files` (small games up to 5 MB, sent as file contents), `get_version`, `publish_version` (also rolls back and publishes later), `cancel_scheduled_publish`, `end_preview_links`, `add_image`, `remove_image`, `add_tester_link`, `update_tester_link`, `remove_tester_link`, `get_reports`, `get_stats`, `get_history`, `get_logs` (what the game server printed, see A game server's logs below), `get_player`, `get_access` (what the key can do), `get_activity` (your account's activity, needs a full key), `list_api_keys` (your keys and connected apps with their end dates, last use and whether Zaisma turned one off; needs a full key), the sign-in apps' `list_sign_in_apps`, `create_sign_in_app`, `update_sign_in_app` and `delete_sign_in_app`, the webhooks' `list_webhooks`, `create_webhook`, `update_webhook`, `delete_webhook`, `test_webhook` and `list_webhook_deliveries` (see Webhooks below), a game's secrets' `list_secrets`, `set_secret` and `delete_secret` (see Secrets below), the game database's `get_database`, `query_database`, `batch_database`, `export_database`, `import_database`, `erase_player`, `restore_database` and `undo_database_restore` (see The game database below), cloud saves' `list_saves`, `get_save`, `change_save`, `replace_save`, `reset_save`, `list_save_copies`, `get_save_copy` and `restore_save_copy` (see Cloud saves below), and the developer forum's `search_forum`, `get_topic`, `post_topic`, `message_zaisma`, `reply_to_topic`, `vote`, `mark_helpful`, `report_post`, `forum_people`, `still_happening`, `flag_misplaced`, `follow_topic` and `mark_answer` (see The developer forum below). Bigger builds go through the upload command. Making a game players can play private or a draft again needs `"confirm": true`, so the AI asks you first.

Every tool has an output schema, and answers are compact JSON. Arguments are closed: one a tool doesn't take is refused (`unknown_field`, with the arguments it does take), never quietly dropped, and a missing required one is `missing_field`. A refused call is a tool result with `isError: true`, the error object below as its `structuredContent` and its message, fix and code as its text; each tool's listed output schema is its answer or that error, because MCP clients check both against it. The tools that are easy to get wrong (`update_game`, `check_game`, `upload_files`, `publish_version`, `search_forum`, `post_topic`, `change_save`, `replace_save`, `set_secret`) carry good examples in their input schema and bad ones at the end of their description.

## Errors

Every error, in the API and the MCP, has the same shape:

```json
{"error": {"code": "bad_play_modes", "message": "The online mode's play_style is missing or isn't co-op, versus or both.", "field": "play_modes[1].play_style", "fix": "Give play_style: co-op (together), versus (against each other) or both, like { \"mode\": \"online\", \"minimum_player_count\": 2, \"maximum_player_count\": 4, \"play_style\": \"co-op\" }.", "retry_after_sec": null}}
```

- `code`: stable, one problem per code, from the list below; search the forum with it (`search_forum`) to find others who hit it. Codes named `bad_<field>` mean that input's value isn't one the call takes.
- `message`: what happened, in one sentence.
- `field`: the input at fault, with its place in a list when it's in one (`files[3].path`, `debug_context.call`), or `null`.
- `fix`: what to do about it, naming the call or the value when there is one.
- `retry_after_sec`: how long to wait when waiting helps (`slow_down`, `post_limit`, `still_scanning`), also sent as the `Retry-After` header; otherwise `null`.

The HTTP status goes with the code, as listed. The list lives in `ERROR_CODES` (`packages/core/src/errors.ts`), and a test keeps this page in step with it.

**Signing in and requests**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_key` | 401 | The MCP was called without an API key or a connected app's token. |
| `bad_key` | 401 | The API key isn't valid: removed, mistyped or never made. |
| `key_turned_off` | 401 | The API key was found in public and turned off for good. |
| `key_ended` | 401 | The API key reached the end date it was made with. |
| `access_token_ended` | 401 | A connected app's access token is past its hour; the app refreshes it by itself. |
| `token_not_for_api` | 401 | A connected app's token works only at the MCP, not the REST API. |
| `signed_out` | 401 | No API key, and no signed-in session. |
| `no_account` | 401 | The account isn't finished yet. |
| `bad_origin` | 403 | A call with a session came from another site. |
| `key_not_allowed` | 403 | The API key is limited to other games, or its access doesn't cover the call. |
| `slow_down` | 429 | Too many calls in a minute. |
| `not_found` | 404 | There's no API call at that path. |
| `bad_method` | 405 | The path doesn't take that method. |
| `gone` | 410 | The call was removed, like the first feedback calls. |
| `bad_json` | 400 | The body isn't a JSON object. |
| `json_too_big` | 413 | The JSON body is over the call's size limit. |
| `unknown_field` | 400 | A field, argument or query parameter the call doesn't take. |
| `missing_field` | 400 | A field the call needs wasn't sent. |
| `wrong_id_kind` | 400 | An ID of another kind was sent, like an image ID as version_id. |
| `internal_error` | 500 | Something broke on Zaisma's side. |

**Games**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_game` | 404 | You have no game with that slug. |
| `bad_slug` | 400 | The link name isn't lowercase letters, numbers and single hyphens, or is reserved. |
| `slug_taken` | 409 | Another game has that link name, or a deleted game had it. |
| `too_many_games` | 403 | The account has as many games as it can have. |
| `publishing_not_open` | 403 | Until the beta, only accounts Zaisma adds can make, upload and publish games. |
| `bad_title` | 400 | A game's, topic's or precedent's title is empty or too long. |
| `bad_description` | 400 | The description isn't text of up to 500 characters. |
| `bad_visibility` | 400 | visibility isn't draft, listed, unlisted or private. |
| `bad_devices` | 400 | devices isn't a list of phone, tablet and computer. |
| `bad_controls` | 400 | controls isn't a list of touch, keyboard_mouse and gamepad. |
| `bad_screen_orientation` | 400 | screen_orientation isn't portrait, landscape, either or null. |
| `bad_play_modes` | 400 | play_modes isn't a list of play modes, or one of them is wrong. |
| `bad_cloud_saves_enabled` | 400 | cloud_saves_enabled isn't true or false. |
| `bad_account_offer_enabled` | 400 | account_offer_enabled isn't true or false. |
| `bad_deleted_account_erase_enabled` | 400 | deleted_account_erase_enabled isn't true or false. |
| `bad_friend_joins_enabled` | 400 | friend_joins_enabled isn't true or false. |
| `bad_room_browsing` | 400 | room_browsing isn't page, game or off. |
| `bad_multiplayer_mode` | 400 | multiplayer_mode isn't none, relay or own. |
| `bad_account_requirement` | 400 | account_requirement isn't none, multiplayer or whole_game. |
| `bad_minimum_player_age` | 400 | minimum_player_age_years isn't 13, 16 or 18. |
| `accounts_needed_for_minimum_age` | 400 | A game for 16 or 18 and up needs account_requirement whole_game, since only accounts have an age. |
| `content_needs_minimum_age` | 409 | A version shows lifelike gore, which plays only in games for 16 and up. |
| `bad_links` | 400 | links isn't a list of up to 20 { link_name, destination_url, is_on_game_page } with names of their own and https addresses that aren't link shorteners, IP addresses, addresses with a user name, or on Zaisma's own domains. |
| `bad_own_server_urls` | 400 | own_server_urls isn't a list of up to 5 server addresses like wss://play.example.com, or one is an IP address, this computer or on Zaisma's own domains. |
| `bad_game_server_allowed_hosts` | 400 | game_server_allowed_hosts isn't a list of up to 20 host names (like discord.com or *.example.com), or one is an IP address or on Zaisma's own domains. |
| `built_in_server` | 403 | The game runs a game server built into Zaisma, which only Zaisma changes. |
| `game_removed` | 403 | Zaisma took the game down, so this can't change. |
| `needs_confirm` | 409 | Hiding a game players can play needs the developer's OK. |
| `bad_period_duration_days` | 400 | period_duration_days isn't a whole number from 1 to 90. |
| `bad_cursor` | 400 | cursor isn't a next_cursor from an earlier answer. |

**Players**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_player` | 404 | No account has that player ID: a guest's, or a deleted account's. |

**Covers, screenshots and other images**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_kind` | 400 | kind isn't one of the choices the call takes. |
| `not_an_image` | 415 | The file isn't an image of a type the call takes. |
| `image_too_big` | 413 | The image is over 5 MB. |
| `bad_image_dimensions` | 400 | The image is under 320 px or over 8,192 px on a side. |
| `not_square` | 400 | A square cover isn't as wide as it is tall, or is under 512 px. |
| `too_many_screenshots` | 400 | The game has 8 screenshots already. |
| `image_refused` | 422 | The image can't be used. |
| `no_image` | 404 | The game has no image with that ID. |
| `no_file` | 400 | A form on Zaisma's pages was sent without its image. |

**Uploading versions**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_files` | 400 | files isn't a list of files in the shape the call takes. |
| `bad_path` | 400 | A file's path is absolute, has . or .. in it, has control characters or is over 200 characters. |
| `hidden_file` | 400 | A file or folder's name starts with a dot. |
| `precompressed_file` | 400 | A file is pre-compressed (.gz or .br). |
| `file_type_not_allowed` | 400 | A file is of a type games can't have. |
| `file_too_big` | 413 | A file is over 500 MB. |
| `duplicate_path` | 400 | Two files share a path. |
| `no_index_html` | 400 | There's no index.html at the top of the game. |
| `too_many_files` | 400 | The game has more than 20,000 files. |
| `game_too_big` | 413 | The game is over 2 GB. |
| `too_big_for_mcp` | 413 | upload_files and check_game take up to 5 MB; bigger builds go through the upload command. |
| `bad_base64` | 400 | Something sent as base64 isn't valid base64. |
| `files_missing` | 409 | Some of the version's files haven't been sent yet. |
| `bad_patch_notes` | 400 | patch_notes isn't text of up to 2,000 characters. |
| `bad_publish_when_approved` | 400 | publish_when_approved isn't true or false. |
| `version_limit` | 429 | The game has had 20 versions in the last day. |
| `no_content_length` | 411 | A file was sent without a Content-Length header. |
| `file_needs_parts` | 413 | A file over 95 MB was sent in one go. |
| `no_body` | 400 | A file was sent without a body. |
| `hash_mismatch` | 400 | A file doesn't match the SHA-256 it was sent as. |
| `forbidden_file` | 400 | A file is a program or an archive, whatever its name says. |
| `bad_size_bytes` | 400 | size_bytes isn't a whole number above 0. |
| `bad_part_number` | 400 | A part's number isn't from 1 to 10,000. |
| `no_upload_id` | 400 | A part was sent without its upload_id. |
| `bad_part_size` | 400 | A part is empty, over 50 MB or has no Content-Length header. |
| `upload_closed` | 400 | The upload_id isn't an open upload any more. |
| `bad_parts` | 400 | The finishing call isn't { upload_id, parts: [{ part_number, etag }] }. |
| `parts_incomplete` | 400 | The parts sent don't make a whole file. |

**Versions and publishing**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_version` | 404 | The game has no version with that ID. |
| `bad_time` | 400 | A time isn't an ISO time in the range it takes: scheduled_publish_at from a few minutes to 90 days ahead, a tester link's ends_at from now to a year ahead, a database restore's restore_to_at within the last 30 days and not before the game was made. |
| `still_scanning` | 409 | The version is still being scanned. |
| `not_approved` | 409 | The version didn't pass review, so it can't be published. |

**Tester links**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_name` | 400 | A tester link's or sign-in app's name isn't 1 to 60 characters, or a sign-in app's says Zaisma. |
| `too_many_tester_links` | 403 | The game has 50 tester links on already. |
| `no_tester_link` | 404 | The game has no tester link on with that ID. |
| `bad_version_choice` | 400 | version_choice isn't live, newest_passed or picked, or picked_version_id doesn't go with it. |

**Sign in with Zaisma**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_redirect_urls` | 400 | redirect_urls isn't a list of 1 to 10 https URLs (http only for localhost) without #fragments. |
| `bad_replace_client_secret` | 400 | replace_client_secret isn't true or false, or the app is public and has no client secret. |
| `too_many_sign_in_apps` | 403 | The account has 20 sign-in apps already. |
| `no_sign_in_app` | 404 | You have no sign-in app with that ID. |
| `bad_destination_kind` | 400 | destination_kind isn't endpoint_url or game_server. |
| `bad_endpoint_url` | 400 | endpoint_url isn't an https URL on a name (no IP address, user name or #fragment), or it's on Zaisma's own domains, or it's given for a webhook to a game server, which has none. |
| `bad_event_kinds` | 400 | event_kinds isn't a list of 1 or more of the webhook event kinds. |
| `bad_game_slugs` | 400 | game_slugs isn't null or a list of 1 to 50 of your games' slugs, or, for a webhook to a game server, a list of the one game whose server it is. |
| `bad_replace_signing_secret` | 400 | replace_signing_secret isn't true or false. |
| `too_many_webhooks` | 403 | The account has 10 webhooks already. |
| `no_webhook` | 404 | You have no webhook with that ID. |

**The game database**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_sql` | 400 | The SQL isn't one statement SQLite takes, or statements isn't a list of { sql, values }. |
| `bad_values` | 400 | values isn't a list of text, numbers, null and { blob_base64 } for the SQL's ?s. |
| `bad_player_id` | 400 | player_id isn't a player ID (player_…). |
| `too_many_rows` | 400 | A statement answered more than 10,000 rows. |
| `answer_too_big` | 400 | The rows answered come to more than 8 MB. |
| `database_write_limit` | 429 | The game's database has written its free rows this month, so writes wait for the next. |
| `database_read_limit` | 429 | The game's database has read its free rows this month, so queries wait for the next. |
| `database_storage_limit` | 403 | The statement would grow the game's database past its free storage. |
| `database_unavailable` | 503 | The game's database didn't answer. |
| `database_restore_unavailable` | 501 | This Zaisma's game databases can't go back in time: its storage keeps no history, like a local preview. |
| `no_database_restore` | 404 | The game has no database restore with that ID in the last 30 days. |
| `bad_secret_name` | 400 | A secret's name isn't capitals, digits and underscores starting with a capital, up to 64 characters. |
| `bad_secret_value` | 400 | secret_value isn't text of up to 8 KB. |
| `no_secret` | 404 | The game has no secret by that name. |
| `too_many_secrets` | 403 | The game has 50 secrets, the most it can have. |
| `secrets_unavailable` | 503 | The game's secrets didn't answer. |
| `dump_too_big` | 413 | dump_sql is over 5 MB: import a dump in parts, each ending on a whole statement. |

**A game server's logs**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_room_code` | 400 | room_code isn't a room's code: six characters like K7Q2MX. |
| `bad_minimum_level` | 400 | minimum_level isn't debug, info, warn or error. |
| `bad_source_kind` | 400 | source_kind isn't room, request, schedule or webhook. |
| `bad_search_text` | 400 | search_text is empty or over 200 characters. |
| `bad_maximum_line_count` | 400 | maximum_line_count isn't a whole number from 1 to 500. |
| `two_log_cursors` | 400 | get_logs got both cursor and new_lines_cursor. |

**Cloud saves**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_save` | 404 | The player has no save in the game. |
| `no_save_copy` | 404 | The player's save has no earlier version with that ID. |
| `bad_keys` | 400 | keys isn't a list of 1 to 100 localStorage keys of up to 1,000 characters. |
| `bad_local_storage_items` | 400 | local_storage_items isn't an object of localStorage keys and their text (null removes a key in a change). |
| `bad_indexeddb_databases` | 400 | indexeddb_databases isn't a list of databases, each { name, version, stores } as get_save answers them. |
| `save_too_big` | 413 | The save would be over 5 MB. |
| `cloud_saves_off` | 409 | The game has cloud saves off, so it doesn't read saves from players' accounts. |
| `save_busy` | 409 | The player's game kept saving at the same moment, so the change didn't go through. |

**The developer forum**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_topic` | 404 | There's no topic with that ID you can see. |
| `no_post` | 404 | There's no post with that ID you can see in the topic. |
| `no_known_issue` | 404 | There's no known issue with that ID. |
| `no_media` | 404 | There's no image there you can see. |
| `bad_tab` | 400 | tab isn't latest, top, unanswered, known, yours or messages. |
| `bad_section` | 400 | section isn't one of the forum's sections. |
| `bad_category` | 400 | category isn't one of the forum's categories. |
| `no_category` | 400 | A public topic was sent without its category. |
| `bad_tag` | 400 | tag isn't one of the forum's tags. |
| `bad_tags` | 400 | tags isn't a list of up to 3 of the forum's tags. |
| `bad_topic_status` | 400 | topic_status isn't one of the statuses. |
| `bad_is_answered` | 400 | is_answered isn't true or false. |
| `bad_maximum_topic_count` | 400 | maximum_topic_count isn't a whole number from 1 to 30. |
| `bad_detail` | 400 | detail isn't brief. |
| `bad_post_selection` | 400 | post_selection isn't all, answer, latest or none. |
| `bad_is_public` | 400 | is_public isn't true or false. |
| `bad_text_markdown` | 400 | text_markdown is empty or over 8,000 characters. |
| `bad_author_kind` | 400 | author_kind isn't developer or ai. |
| `bad_debug_context` | 400 | debug_context isn't an object of its five text fields, up to 8,000 characters in all. |
| `bad_images_base64` | 400 | images_base64 isn't a list of base64 images. |
| `too_many_images` | 400 | A post carries more than 10 images. |
| `bad_reopen` | 400 | reopen isn't true or false. |
| `bad_answer_post_id` | 400 | answer_post_id isn't a post ID or null. |
| `bad_reason` | 400 | reason isn't one of the report reasons. |
| `post_limit` | 429 | The account has posted 100 times in the last day. |
| `image_limit` | 429 | The account has uploaded 200 forum images in the last day. |
| `not_yours` | 403 | Only the developer who started the topic can do that. |
| `not_a_question` | 400 | Only a question has an answer to mark. |
| `not_closed` | 400 | The topic isn't closed, so there's nothing to reopen. |
| `not_released` | 400 | The topic isn't a known issue whose fix is out. |
| `cant_vote` | 400 | The topic doesn't take your vote: it's yours, private, or a discussion. |
| `cant_flag` | 400 | Only public topics others can see can be flagged as misplaced. |
| `cant_mark_helpful` | 400 | Your own posts can't be marked helpful. |
| `cant_report` | 400 | The post can't be reported: it's yours, or Zaisma's. |

## Next steps

Every call that changes something answers with `next_steps`: the calls that usually follow, ready to make, or `[]` when nothing does. The steps of sending files (`PUT /files/:sha256`, the parts calls and `POST /forum/media`) are the exception: their next call is always the one that uses them.

```json
"next_steps": [{"tool": "get_version", "arguments": {"slug": "sky-hopper", "version_id": "version_8f3k2m9q1x7c4v6b0n5z"}, "after_sec": 30, "reason": "The scan usually takes under a minute; once it passes, show the developer its preview_url."}]
```

- `tool` is the MCP tool's name (each maps to a call on this page); `arguments` are filled in as far as Zaisma knows, and `reason` says what to add (like a new game's files).
- `after_sec`: how long to wait first, or `null` for straight away.
- What follows today: a new game, its upload (`upload_files`); a new version, checking its scan (`get_version`); publishing while the game is a draft or private, making it `listed` when the developer wants players in (`update_game`); making a game `listed` or `unlisted` with nothing live, publishing the version that passed (`publish_version`), checking the one being scanned, or uploading one; `multiplayer_mode: "own"` without a game server, uploading one; scheduling a version still being scanned, checking its scan; a new webhook, or a new `endpoint_url` or signing secret, sending it a test event (`test_webhook`); a database restore, seeing the tables it went back to (`get_database`) and undoing it (`undo_database_restore`); an undo, `get_database`. Everything else answers `[]`.

## Holds and takedowns

When Zaisma holds, rejects or takes something down, it says why, the same way in the dashboard, these answers and the MCP: a `review_reason`, with the same parts as an error plus the content rule it's about.

```json
"review_reason": {"code": "taken_down", "message": "The game's login screen asks players for their Steam password.", "content_rule": "malware", "fix": "If it's a mistake, or to say what you'll change, message_zaisma with the game_slug. Until Zaisma restores it, the game can't get new versions or change who can play it."}
```

- `code`: stable, one problem per code, from the list below, never the same as an error code; search the forum with it (`search_forum`).
- `message`: what happened and why, in plain words: the code's meaning, or for the AI review and a person at Zaisma, their own words.
- `content_rule`: the content rule it's about ([zaisma.com/legal/content-rules](https://zaisma.com/legal/content-rules), each rule at `#<rule>`), or `null` when it breaks none, like a check that couldn't finish. A hold names the rule a person checks it against; a rejection or takedown, the rule it broke.
- `fix`: what to do about it, naming the call when there is one.

Where it shows:

- **A game's `review_reason`**: why it's `held` or `removed`; `null` while it's `pending` or `live`.
- **A version's `review_reason`**: a person rejected it, or a report paused the update; `null` otherwise. Its `findings` are what the scan found that holds or rejects it, each `{"code", "severity", "message", "content_rule", "path", "fix"}`, where `severity` is `reject` (it can't go live) or `hold` (a person at Zaisma looks first, usually within a day).
- **An image's `review_reason`**: why it wasn't approved.
- **`get_history`**: each hold, rejection and takedown with its `review_reason`, kept after it's over.
- **Errors:** `game_removed` and `not_approved` put the reason's code and message in theirs, and its fix as theirs.

The list lives in `REVIEW_CODES` and the rules in `CONTENT_RULES` (`packages/core/src/review.ts`), and a test keeps this page in step with them. Rule says which content rule a code is about: one rule always, `none` when it breaks none, or `picked` when the person deciding picks it each time.

**The scan's checks**

| Code | Rule | Meaning |
| --- | --- | --- |
| `crypto_miner` | `malware` | The code mines cryptocurrency. |
| `packed_code` | `malware` | Code is packed or decoded at runtime (eval of encoded text), which hides what it does. |
| `top_navigation` | `malware` | The code tries to change the page outside the game (the top or parent window's location). |
| `relay_bypass` | `malware` | The code makes a WebRTC connection from a frame of its own, which skips Zaisma's relay and would show players each other's internet address. |
| `password_field` | `malware` | The game has a password field. Games don't need one, and phishing pages do. |
| `external_form` | `personal_details` | The game has a form that sends what players type to another site. |
| `antivirus_flag` | `malware` | Antivirus engines flag a file: three or more reject the version, fewer hold it for a person. |
| `api_key_in_files` | none | A Zaisma API key was in the game's files, so Zaisma turned it off: anyone who plays the game could have read it. |

**Checks that couldn't finish (no rule broken)**

| Code | Rule | Meaning |
| --- | --- | --- |
| `too_much_code` | none | The game has more code than the review reads (about 19 MB of text), so a person at Zaisma looks first. |
| `too_many_files_to_check` | none | The game has more files than the scan checks for hidden pictures (5,000), so a person at Zaisma looks at the rest. |
| `too_many_images_to_check` | none | The game has more pictures and videos than image matching checks (5,000), so a person at Zaisma looks at the rest. |
| `image_matching_off` | none | Image matching isn't connected, so a person at Zaisma approves each version. |
| `image_matching_failed` | none | Image matching couldn't check every picture and video, so a person at Zaisma looks first. |
| `ai_review_off` | none | AI review isn't set up, so a person at Zaisma approves each version. |
| `ai_review_budget_used` | none | This month's AI reviews are used up, so a person at Zaisma approves each version. |
| `ai_review_declined` | none | The AI reviewer wouldn't review the game, so a person at Zaisma looks. |
| `ai_review_failed` | none | The AI review didn't finish, so a person at Zaisma looks. |
| `daily_reviews_used` | none | This developer's 5 judged reviews for today are used, so this version waits for the next one to free up. |
| `scan_failed` | none | The scan didn't finish after three tries, so a person at Zaisma looks. |

**The AI review**

Every version gets the same review, as a process rather than one look. Zaisma's own checks list what each file connects to, the links it opens and the code it can't follow. Reader models then read all of the code and pictures, in pieces, and pull out the exact lines and pictures that matter. Last, one stronger model judges from that list alone and picks its findings from the codes below, so the same game gets the same verdict every run. A finding's `path` and `quote` point at the exact line it's about.

Each developer gets 5 judged reviews a day, across all their games. A change that only tweaks a game that already passed (levels, sprites, balance: nothing new it connects to, opens, asks for or shows) keeps that version's verdict without using one. Past 5, a new version is held with `daily_reviews_used` and checked by itself as soon as one frees up, within a day.

| Code | Rule | Meaning |
| --- | --- | --- |
| `ai_malware` | `malware` | The AI review found what looks like malware. |
| `ai_phishing_or_scam` | `malware` | The AI review found what looks like phishing or a scam. |
| `ai_data_collection` | `personal_details` | The AI review found the game asking players for personal details, like emails, real names, birthdays or location. |
| `ai_sexual_content` | `sexual` | The AI review found sexual content or nudity. |
| `ai_private_details_or_threats` | `real_people` | The AI review found private details about a real person, like a home address, phone number or school, or a real threat against one. |
| `ai_lifelike_gore` | none | The AI review found lifelike gore (photo-real or lifelike injury shown up close), which plays only in games for 16 and up. |
| `ai_real_money_gambling` | `illegal` | The AI review found real-money gambling. |
| `ai_free_text_chat` | `chat` | The AI review found free-text chat between players. |
| `ai_disallowed_crypto` | `crypto` | The AI review found cryptocurrency the rules don't allow: coins other than Bitcoin, tokens, NFTs or airdrops, or Bitcoin used for investment advice, paying players or asking for wallet access. |
| `ai_other` | none | The AI review found something else for a person at Zaisma to look at. |
| `ai_concern` | none | The AI review held or rejected the version without naming one concern; the message is its summary. |

**People and reports**

| Code | Rule | Meaning |
| --- | --- | --- |
| `needs_review` | none | A person at Zaisma needs to look at it first. |
| `report_paused_game` | none | A player report paused the game while Zaisma checks it. |
| `report_paused_update` | none | A player report paused this update while Zaisma checks it; players get the version before it. |
| `rejected_by_zaisma` | picked | A person at Zaisma rejected the version; the message says why. |
| `taken_down` | picked | A person at Zaisma took the game down; the message says why. |
| `copyright_notice` | `copyright` | The game was taken down on a copyright (DMCA) notice. |
| `developer_account_deleted` | none | The game's developer deleted their Zaisma account, which takes their games down with it. |
| `image_rejected` | picked | A person at Zaisma didn't approve the image; the message says why. |
| `link_flagged` | `malware` | Cloudflare lists the link's site for malware or phishing, so the link opens for nobody. |
| `details_rejected` | picked | A person at Zaisma didn't approve the new title or description; the message says why. |

| Rule | What it says |
| --- | --- |
| `child_safety` | Sexual content involving minors, in any form. We report it to the National Center for Missing & Exploited Children. |
| `sexual` | Sexually explicit content. |
| `malware` | Malware, crypto mining, phishing, scams or anything that tries to break out of the game. |
| `illegal` | Content that's illegal in the United States, including real-money gambling. |
| `real_people` | Private details about real people, or real threats. |
| `copyright` | Other people's games, art, music or characters used without permission. |
| `personal_details` | Asking players for personal details like emails, real names, birthdays or location inside the game. Every player has a Zaisma ID and name; games with their own accounts link them through Sign in with Zaisma, and anything more happens on the developer's own site. |
| `chat` | Free-text chat between players. In the beta, players talk through each game's preset phrases and emotes. |
| `crypto` | Cryptocurrency other than Bitcoin: using or promoting other coins, tokens, NFTs or airdrops. A story that mentions one is fine. Bitcoin games are welcome, but not investment advice, mining on the player's device, paying players sats, or asking for seed phrases or permission to spend from a wallet. |
| `faked_plays` | Faking plays or players, with bots, scripts or click farms. |

Allowed, even where other platforms ban it (`ALLOWED_CONTENT`): the AI review passes it and report triage dismisses reports about it.

- Offensive, edgy and dark humor, insults and swearing.
- Jokes and opinions about any group, religion, country or political side. There's no hate-speech rule.
- Mocking, memes and satire of real people, from politicians to celebrities, with their name, face and photo.
- Violence that's gameplay: shooting, fighting, war and horror, including against real people.
- Real wars and history, with their uniforms, flags and symbols.
- Drinking, smoking and drugs as part of a story or setting.
- Casino and card games played for points or coins that can't be bought or cashed out.
- Trash talk and fiery lobbies: how players talk to each other is up to each game.
- Bitcoin games: teaching it, Bitcoin themes, selling items for sats, and tips.

One kind of content plays only in games for 16 and up: lifelike gore, meaning photo-real or lifelike injury shown up close (dismemberment, torture, exposed organs). Cartoon, pixel and stylized blood are fine for everyone. The AI review holds a version with lifelike gore on a game for everyone 13 and up (`ai_lifelike_gore`): set `minimum_player_age_years` to `16` and it passes by itself, or make the gore stylized and upload again. Publishing or giving a tester link such a version while the game is for everyone 13 and up, or lowering the age to `13` while players can reach one, answers `content_needs_minimum_age`. Covers and screenshots never show lifelike gore, whatever the age. Players never see the age.

For examples of games that pass and games that are held, by content rule, see `review-set/cases/` in Zaisma's repo: each case's `why` says where the line is.

## Signing in

Make an API key on your account page (zaisma.com/account, under Game developers) and send it as `Authorization: Bearer zsk_…`. The key is shown once; we keep only a hash. Any account can make up to 10 keys and remove them at any time. Making one needs a passkey: the account page adds one the first time, then each key is a tap. Keys are made only there, never through the API or MCP, so an AI can't give itself a new key. Pages on zaisma.com can use the signed-in session instead. Up to 120 requests a minute per account, plus up to 1,000 a minute for sending files. A key lasts until you remove it, or until the end date you gave it (7 days, 30 days, 90 days or a year; `get_access` shows it as `api_key_ends_at`); after that it answers `key_ended`. A key found in public (GitHub's secret scanning, a game's uploaded files or a forum post) is turned off for good within minutes: it answers `key_turned_off`, saying where it was found, and the games keep running, since games never use keys. `list_api_keys` shows each key's end date, last use and whether it was turned off.

An AI app that connects by signing in (claude.ai, ChatGPT, any MCP client that can't send a header) gets a connection, made on one Zaisma page: "Connect Claude to your games" says where you go back to, offers Full on all your games with no end date, and Change opens the same choices as a key (a level or a choice per area, which games, an end date). Continue needs a tap on your passkey, as making a key does; every sign-in asks, with no remembered yes. A connection is listed with your keys on the account page and in `list_api_keys` (`kind: "connected_app"`, with `connected_app_host`), is held to what you chose exactly as a key is, lasts until you remove it or its end date, works only at `/mcp`, and can never make keys. Connecting the same app again replaces its old connection. Any account can have up to 10 connected apps, counted apart from its 10 keys.

Until the beta, only accounts Zaisma adds can make, upload and publish games. For everyone else, making a game (`POST /games`), sending files (`POST /games/:slug/uploads`, `PUT /files/:sha256` and the parts calls), making a version and publishing one answer `publishing_not_open` (403), from the dashboard, the MCP and the upload command alike; everything else works. `GET /access` says whether your account can, as `can_publish`. Publishing opens to every account when the beta opens.

### Connected apps (OAuth)

For people writing an MCP client: Zaisma follows the MCP authorization spec. `POST /mcp` without a token answers 401 with `WWW-Authenticate: Bearer resource_metadata="https://zaisma.com/.well-known/oauth-protected-resource/mcp", scope="mcp"`. That document (RFC 9728) names `https://zaisma.com` as the authorization server, whose metadata is at `/.well-known/oauth-authorization-server` (RFC 8414). An app names itself by a client ID metadata document (an https URL whose JSON has the same `client_id`, a `client_name` and up to 10 `redirect_uris`; read again after a day), or registers at `POST /oauth/register` (RFC 7591; up to 10 a minute from one address, with `token_endpoint_auth_method` `none`, `client_secret_basic` or `client_secret_post`). Redirect URLs are https, or http on `localhost` and `127.0.0.1`. Then the authorization code flow at `/oauth/authorize` and `/oauth/token`, with PKCE S256 always and `resource` `https://zaisma.com/mcp` when sent (RFC 8707); the one scope is `mcp`, and `openid`, `profile` and `offline_access` are accepted and dropped. The access token (`zat_…`) lasts an hour and works only at `/mcp`, where an ended one answers `access_token_ended` and the REST API answers `token_not_for_api`. The refresh token (`zrt_…`) lasts as long as the connection and works once: each refresh answers new tokens. One used again within a minute is refused with `invalid_grant`; one used again later removes the connection, since only a stolen copy does that.

### What a key can do

A key can be limited, for CI and collaborators, to some of your games and to what it may do: one of four levels, or a choice per area.

| Level | What it can do |
| --- | --- |
| `full` | Everything. Keys made before levels existed are full keys for every game. |
| `publish` | Upload and publish versions, change games, their secrets and tester links, and post on the forum. Reads everything else; can't run SQL, change saves, or change sign-in apps and webhooks. |
| `upload` | Send files and make versions (drafts), and read everything. Can't publish, change games or post on the forum. |
| `read` | Read games, versions, stats, the database, saves and the forum. Changes nothing. |
| `custom` | A choice per area, below. |

| Area, in `area_access` | Choices | What it covers |
| --- | --- | --- |
| `game_access` | `read`, `write` | read: list and get games, with images, versions, scans, tester links and secrets' names. write: also details, visibility, images, tester links, secrets, the hosts its game server calls, and new games. |
| `version_access` | `read`, `upload`, `publish` | upload: send files and make versions, which wait as drafts. publish: also publish, schedule and roll back, and make versions with `publish_when_approved`. |
| `stats_access` | `none`, `read` | Stats, player reports and history. |
| `database_access` | `none`, `read`, `write` | read: tables, indexes, use and `export`. write: run SQL (`query`, `batch`), `import` and restore to a time. |
| `save_access` | `none`, `read`, `write` | Players' cloud saves. read: read them and their copies. write: change, reset and restore them. |
| `forum_access` | `none`, `read`, `write` | write: post, reply, vote, follow and message Zaisma, in your name. |
| `sign_in_app_access` | `none`, `read`, `write` | Sign-in apps. |
| `webhook_access` | `none`, `read`, `write` | Webhooks. |

Every key sees its games and their versions, so `game_access` and `version_access` start at `read`. A key limited to some games lists only those, can't make games, and can't reach sign-in apps or webhooks, which belong to your whole account. Public profiles (`GET /players/:player_id`) and `GET /access` work with any key. `GET /activity` and `GET /api-keys` need a full key for all your games: they show where your account and its keys are used from. A call a key doesn't reach answers `key_not_allowed` (403), saying what it would need.

Every call is checked before any of it runs, in this order: the key's access, whether your account can publish yet (for the calls above), what the path names (your game, webhook or sign-in app, or a forum topic you can see), the inputs (closed), each input that needs more than the call (`publish_when_approved`), and what the inputs name (a forum post's `game_slug`, a webhook's `game_slugs`, a version's `files`, a `known_issue_topic_id` or `topic_id`), with a key limited to some games held to those. Someone else's game, webhook, sign-in app or private topic is answered exactly as one that isn't there (`no_game`, `no_webhook`, `no_sign_in_app`, `no_topic`), and so is a file only someone else sent (`files_missing`).

| Call | What it does |
| --- | --- |
| `GET /access` | What the key you called with can do: `{ "access": { api_key_name, access_level, area_access, game_slugs }, "can_publish" }`. `can_publish` is whether your account can make, upload and publish games, which until the beta only accounts Zaisma adds can. `area_access` has every area's choice, whatever the level; `game_slugs` is `null` for every game you have and will make. From the dashboard's session, `api_key_name` is `null` and access is full. |

### Your account's activity

| Call | What it does |
| --- | --- |
| `GET /api-keys` | Your API keys and connected apps, newest first: `api_keys`, each with `api_key_name` (a connected app's own name), `kind` (`api_key`, or `connected_app` for an AI app connected by signing in), `connected_app_host` (where a connected app sends you back, like `claude.ai`; `null` for a key), `access_level`, `area_access`, `game_slugs`, `created_at`, `last_used_at`, `last_used_where` (what it was last used with and from where; `null` when unknown or the account doesn't keep where it's used from), `ends_at` (`null` when it lasts until removed), `turned_off_at` and `found_in` (`github`, `game_files` or `forum_post`) with `found_at_url` when Zaisma turned it off because it was found in public, and `is_this_key`. It needs a full key for all your games. Keys are made and removed only on the account page. |
| `GET /activity` | Your account's security activity from the last 90 days, newest first, 50 a page: `events`, each with `kind`, `description`, `sign_in_kind` (`password`, `passkey`, `email_code`, `google` or `discord` for a sign-in on a new device), `subject_name` (the passkey's device or the key's name), `done_by` (`you`, `api_key`, `ai` or `zaisma`), `api_key_name`, `device`, `network_name`, `city_name`, `region_name`, `country_code`, `connection_address`, `happened_at` and `security_alert_status` (below); `unseen_security_alerts`, the security alerts still waiting on the pages, newest first, up to 10, each like an event; `next_cursor` (pass it as `cursor` for older events, `null` on the last page); and `where_used_from_enabled`. It needs a full key for all your games, since it shows where your account is used from. Keep where my account is used from changes only on the account page, so an AI can't turn it off and erase where it was used from. A game's changes are in its history. |

**Security alerts.** The risky moments are security alerts: a sign-in on a new device from a network the account hasn't signed in from in 90 days, a password or email added, changed or removed, a passkey removed, an API key made, used from a new place or turned off because it was found in public, an AI or app connected, and an app Zaisma disconnected because its refresh token was used twice. Each is emailed to the account (an email change or removal to the old address too), at most 10 an hour; an account without an email (or past the 10) sees it on zaisma.com/account and the dashboard until it presses That was me there. Each event's `security_alert_status` says which: `emailed`, `unseen` (waiting on the pages), `seen`, or `null` when it isn't an alert. Marking alerts seen is only on those pages, so a key can't hide them. A `security_alert` webhook (see Webhooks) sends each one as it happens.

## Games

| Call | What it does |
| --- | --- |
| `GET /games` | Your games, each with its `alerts` (see Alerts below), and `unread_topic_count`: how many of your forum topics Zaisma has replied to or changed since you last opened them. |
| `POST /games` | Make a game: `{"title", "slug"?, "description"?, "devices"?, "controls"?, "screen_orientation"?, "play_modes"?, "cloud_saves_enabled"?, "account_offer_enabled"?, "deleted_account_erase_enabled"?, "friend_joins_enabled"?, "multiplayer_mode"?, "room_browsing"?, "account_requirement"?, "minimum_player_age_years"?, "game_server_allowed_hosts"?, "own_server_urls"?, "links"?}`. It starts as a draft that only you can see. Up to 50 games. |
| `GET /games/:slug` | One game with its `alerts` (see Alerts below), `images`, `versions` (newest first, each with its `review_reason` and scan `findings`) and `testers`. |
| `PATCH /games/:slug` | Change any of `title`, `description`, `visibility`, `devices`, `controls`, `screen_orientation`, `play_modes`, `cloud_saves_enabled`, `account_offer_enabled`, `deleted_account_erase_enabled`, `friend_joins_enabled`, `room_browsing`, `multiplayer_mode`, `account_requirement`, `minimum_player_age_years`, `game_server_allowed_hosts`, `own_server_urls`, `links`. Leave out what stays the same; `null` clears it. Answers with the `game`, `review_message` (set when new words wait for review), `game_server_problem` (why the game's own game server can't run yet, or `null`) and `next_steps`. |

A game looks like: `slug`, `page_url`, `title`, `description`, `visibility`, `review_status`, `review_reason`, `devices`, `controls`, `screen_orientation`, `play_modes`, `cloud_saves_enabled`, `account_offer_enabled`, `deleted_account_erase_enabled`, `friend_joins_enabled`, `multiplayer_mode`, `room_browsing`, `account_requirement`, `minimum_player_age_years`, `game_server_allowed_hosts`, `own_server_urls`, `links`, `details_waiting_for_review` and `updated_at`.

- **visibility:** `draft`, `listed` (home page and search), `unlisted` (anyone with the link, never in lists or search engines) or `private`. Draft and private games open only through preview links and tester links (below).
- **review_status** is ours and separate: `pending` (no version has passed review yet), `live`, `held` or `removed`, and `review_reason` says why it's held or removed (see Holds and takedowns). Changing visibility never undoes a takedown.
- **play_modes:** how it's played, shown on the game page with icons: a list with one entry per way to play, like `[{"mode": "single"}, {"mode": "online", "minimum_player_count": 2, "maximum_player_count": 4, "play_style": "co-op"}]`. `mode` is `single`, `local` (together on one device or screen) or `online` (each on their own device). `single` takes no counts; the others need `minimum_player_count` (2 or more) and `play_style` (`co-op`, `versus` or `both`), and `maximum_player_count: null` means no limit ("2+ players"). Answers give every key, `null` where it doesn't apply. `null` clears it.
- **devices:** any of `phone`, `tablet`, `computer`. **controls:** any of `touch`, `keyboard_mouse`, `gamepad`. **screen_orientation:** `portrait`, `landscape`, `either` or `null` (not set).
- **cloud_saves_enabled:** `true` (the default) copies signed-in players' browser saves to their account, so their progress follows them to any device with no code in the game. It covers localStorage and IndexedDB (Unity, Godot and localForage saves included; databases with "cache" in the name, like Unity's download cache, are skipped), up to 5 MB per player. Set `false` for games that keep their own saves on a server. When a player has played on two devices, the progress played most recently wins and the other is kept as an earlier version; Zaisma never asks the player which to keep.
- **account_offer_enabled:** `true` (the default) shows guests the "Keep your progress" card once they have progress and have played 5 minutes: beside the game, it offers a free account to keep their progress. Set `false` for games that offer accounts their own way, with `Zaisma.player.signIn()`.
- **deleted_account_erase_enabled:** `true` (the default): when a player who played the game deletes their Zaisma account, Zaisma erases their rows from the game database, as `POST /games/:slug/database/erase-player` does, as well as sending `account_deleted` to your webhooks. Set `false` if the game must keep some of their rows (records the law says to keep, say), and handle the `account_deleted` event yourself.
- **multiplayer_mode:** `none`, `relay` (Zaisma passes each message to the others, no server code) or `own`: your game server, from the live version's `zaisma-server/` folder (`index.js` first, importing the folder's other `.js`, `.json` and `.wasm` files) or one `zaisma-server.js`, runs on Zaisma rooms in a sandbox that calls only the hosts in `game_server_allowed_hosts`, with the game's secrets as `room.secrets` and its own SQLite database as `room.database` (see "Your game server on Zaisma" and "The game database" in the README, and The game database below to read and change it yourself). If the live version has no game server, or one over 500 files or 5 MB, the change is saved and `game_server_problem` says why; rooms open once a version that works is published. Games already on a game server built into Zaisma show `built-in` and can't change it themselves. Rooms on the old setting end within a minute.
- **room_browsing:** for games on Zaisma rooms (`multiplayer_mode` other than `none`), where open rooms are listed so players can join them: `page` (the default) on the game page and to the game through `Zaisma.rooms.list()`, `game` only to the game (for games with their own lobby or server browser), or `off`. Room codes and invite links work either way, and the game can hide single rooms itself (see Multiplayer in the README). Whatever the setting, the game page says how many are playing now once it's 3 or more (no names). Rooms on your own servers aren't listed or counted.
- **friend_joins_enabled:** `true` (the default) lets Join on zaisma.com (a friend's face on /friends, "Alex is playing" on the game page, a profile's Playing now) and `Zaisma.friends.list()` take a player into the room their friend is in, for any game with rooms (Zaisma rooms, or its own servers through `Zaisma.friends.setRoom`). `false` greys Join as "This game doesn't take joins". One room turns it off instead, shown as "Private room": `Zaisma.joinRoom({ friendJoinsEnabled: false })` from the player who makes it, or `room.setFriendJoinsEnabled(false)` (the game server's, or the host's with the relay). It isn't a lock: a room's code or link still reaches it, so close the room (`setOpen(false)`) or answer `false` from `canJoin` to keep players out.
- **account_requirement:** what the game needs a Zaisma account for. `none` (the default): guests play everything, and signed-in players play as their account. `multiplayer`: guests play alone; only signed-in players get player passes, so a guest's `Zaisma.player()` and `Zaisma.joinRoom()` fail with `error.code` `"account_needed"` (show your own message, or ask them to sign in without leaving the game with `Zaisma.player.signIn()`), and room links ask guests to sign in first. `whole_game`: the game page says "Needs a Zaisma account" and Play asks guests to sign in first; only signed-in players get player passes. Passes are the backstop: Zaisma rooms also turn away guest passes given before the change, and your own servers can check a pass's `kind` claim for the same. Players under 13 can't make accounts, so they can't play games that need one.
- **minimum_player_age_years:** the youngest age that can play, even when the game's content suits everyone. `13` (the default): everyone, guests included as `account_requirement` allows. `16` or `18`: only accounts that old; younger accounts don't find the game on Zaisma (home, More games, friends' Playing now, profiles), and a link to it says "This game isn't open to your account." Only accounts have an age, so above 13 the game needs an account for the whole game: giving `16` or `18` alone sets `account_requirement` to `whole_game` too, and any other `account_requirement` while it's above 13 is refused with `accounts_needed_for_minimum_age` (set it back to `13` first; that leaves `account_requirement` as it is). Zaisma enforces it: Play, player passes, the relay and requests to your game server turn away younger accounts with `game_not_open_to_player`, and Zaisma rooms remove ones already playing when you raise it. Tester links follow it (testers then need an account); your own previews don't. Neither your game nor your own servers ever learn a player's age: a pass never carries it, and a younger account never gets one. Lifelike gore needs `16` or `18`: see "Allowed, even where other platforms ban it" under the content rules.
- **game_server_allowed_hosts:** the hosts the game's own game server can call with plain `fetch()` (game server reach): your own server, a payment provider, Discord, GitHub. Up to 20 host names, like `["discord.com", "api.github.com"]`, or `"*.example.com"` for every name under example.com (not example.com itself); `[]` (the default) for none, and the whole list each time. No `https://`, paths or ports: every call is https, never to an IP address, this computer or Zaisma's own domains. Live within a minute, with no approval by Zaisma, and kept in the game's history; players don't see it (the game page names only servers their browser connects to). Calls send up to 5 MB, get 10 seconds, aren't redirected (a redirect comes back to your code), and a game makes up to about 600 a minute in each place. A call to anything else throws an `OutsideCallError` in the game server, with a `code` (`not_https`, `unreachable_host`, `host_not_allowed`, `outside_call_limit`, `too_big`, `outside_call_timeout` or `outside_call_failed`) and a `fix`; the stats' `game_server_errors` show it. The tokens it needs go in its secrets (below).
- **own_server_urls:** your own servers the game connects to from players' browsers: a game server you run with `@zaisma/game-server` (`Zaisma.joinRoom({ serverUrl })`), your own relay or your own API. Up to 5 addresses, each `wss://` or `https://` and the name, with a port if it needs one and nothing after it, like `["wss://play.example.com", "wss://eu.example.com:8443"]`; `[]` (the default) for none, and the whole list each time. Never an IP address, this computer (`localhost`) or Zaisma's own domains. `wss://` and `https://` of one server count once, and the game may use either. Live at once with no approval by Zaisma: players' next page load connects (a relay of your own within 5 minutes), and friends' Join can send them to rooms there. Kept in the game's history, and the game's ⋯ menu names them in neutral words: "Online play runs on the developer's own server: play.example.com" (nothing on the details players see before Play); games that only use Zaisma rooms show nothing. Everything a game shows players is under the content rules wherever it comes from. Not for the servers your game server on Zaisma calls: that's `game_server_allowed_hosts`. From a terminal: `zaisma own-servers <slug> wss://play.example.com`.
- **links:** the game's registered links, which it opens with `Zaisma.links.open` (Registered links, below); `[]` (the default) for none, and the whole list each time.
- Once players can see a game, a new title or description waits for review (`details_waiting_for_review`, with `title` and `description`, `null` for the one that didn't change) before it shows.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/reports?cursor=` | Player reports from the last 90 days (`period_duration_days`), counted by reason in `reasons` (`reason`, `label`, `open_count`, `closed_count`), and `bug_reports`: reports that report triage sorted as bugs, each with `player_text`, a one-line `summary`, the `version_id` they played and `reported_at`, and `player_reports`: reports about one of your game's players that Zaisma passed to you, newest first, up to 50, each with its `reason` (`harassment`, `cheating`, `other`, or one of the four Zaisma looks at itself when a person passed it on: `real_life_threat`, `personal_details`, `following_after_block`, `sexual`), `player_text`, `reported_player_id`, `reported_player_name`, `room_code`, `version_id` and `reported_at`. How players treat each other is your game's call, with mute and block always there; Zaisma itself acts only on threats that reach into real life, sharing someone's personal details, following someone after they blocked them, and anything sexual toward a teen. Pass the `next_cursor` from your last call as `cursor` to get only the bug and player reports that arrived after it. Child-safety reports are never counted or shown, and no report says who sent it. |
| `GET /games/:slug/stats?period_duration_days=30` | How the game is played, up to 90 days (`play_stats`, see Play stats below), and multiplayer use per day in `multiplayer_days`: `date`, `room_count`, `room_play_duration_min` and `message_count`. `room_use_this_month`: `room_play_duration_hours` on Zaisma rooms this month (UTC), `relayed_size_bytes`, the data Zaisma's relay sent the game's players for their connections to each other (read from Cloudflare about once an hour), `counted_play_duration_hours`, both together as the free tier counts them (every 20 MB through the relay is an hour), the `free_room_play_duration_hours` (1,000) and `has_reached_free_hours`: until hosting billing is ready, a game that reaches the free hours opens no new rooms and starts no new relayed connections until the month resets, while matches and connections already running carry on (joining then fails with the code `month_limit`). `request_use_this_month`: `request_count` to the game's own game server's `onRequest` this month (UTC, recorded about once a minute), the `free_request_count` (1,000,000) and `has_reached_free_requests`: until hosting billing is ready, past them requests answer `request_limit` until the month resets. `schedules`: the live version's schedules (see "Schedules" in the README), read within a minute of it going live, each with `schedule_name`, `cron` (UTC), `version_id`, `next_run_at` and `last_run_at` (`null` until it first runs); `[]` when it has none or players can't play the game. For games whose own game server runs on Zaisma (rooms on `own`, or any requests or schedules), each day's `game_server` has `call_count` (calls from its rooms), `request_count` (requests to `onRequest`, see "Requests to your game server" in the README), `scheduled_run_count` (runs of `onSchedule`), `crash_count` (a handler threw; that call, request or run is lost), `stopped_count` (ran on too long, like an endless loop; the match froze about 2 seconds, or the request or run failed) and `ended_match_count` (stopped twice), and `game_server_errors` lists the 20 most recent distinct errors: `kind`, `message` with the file and line it came from (a game server that didn't start says why, like an option it doesn't take, with the ones it does, or a cron that doesn't read; a run's error starts with its schedule's name), `occurrence_count`, `version_id`, `first_at` and `last_at`. Other games get `game_server: null` and `game_server_errors: []`. |
| `GET /games/:slug/history` | What happened to the game in `events`, newest first, up to 100: `description`, `version_id`, `subject_name` (what it was done to, like a secret's name), `done_by` (`you`, `api_key`, `ai` or `zaisma`), `api_key_name`, where it came from (`device`, `network_name`, `city_name`, `region_name`, `country_code`, `connection_address`: kept 90 days, and `null` with Keep where my account is used from off, except that uploads keep their address 90 days either way), `is_new_place` (a key's first change from a network and country it hadn't been used from), `occurrence_count` (SQL writes, imports, exports and save reads and changes from one key within the hour fold into one event), `happened_at`, `last_happened_at` and, for a hold, rejection or takedown, its `review_reason` (otherwise `null`). Besides uploads, scans and publishes it holds database writes, imports, exports and restores (a restore's `subject_name` is the time it went back to; an undo's, the restore it undid), save reads and changes, secrets and tester links; a key that isn't limited to some games also sees your webhooks and sign-in apps. |

### Alerts

`alerts` on each game in `GET /games`, and beside the game in `GET /games/:slug`: what needs your attention in it, most urgent first, `[]` when nothing does. The developer home on zaisma.com/dashboard shows the same list on each game's card, and each game's Overview above everything else. Each is `{"kind", "message", "fix", "version_id"}`, `version_id` naming the version it's about (`null` when it's about the whole game):

- `game_removed`: Zaisma took the game down; `message` and `fix` are its `review_reason`'s.
- `game_held`: players can't open the game while Zaisma checks it; likewise.
- `version_rejected`: the newest version was rejected. `GET /games/:slug/versions/:id` has its `findings`.
- `version_held`: a version is waiting for a person at Zaisma (or a player report paused it), usually decided within a day. One alert per held version.
- `link_flagged`: one of the game's registered links opens for nobody, since Cloudflare lists its site for malware or phishing. One alert per link; its `fix` is the link's `review_reason`'s.
- `rooms_paused`: the month's free player-hours on Zaisma rooms and the relay are used, so new rooms and connections between players don't open until the month resets (UTC). Matches already running get an hour to finish, and take no new players meanwhile: the game server's `onEnding` and each player's `ending` event say when (`room.endsAt`).
- `rooms_nearly_paused`, `requests_nearly_paused`, `database_nearly_paused`, `database_writes_nearly_paused`, `database_nearly_full`: a heads-up when 80% of that free allowance is used this month (the database's storage: 80% full), so you can act before it pauses. Never given alongside its own paused or full kind.
- `requests_paused`: the month's free requests to the game server are used.
- `database_paused`: the month's free rows read from the game database are used, so it stops answering (game servers' queries and the API's) until the month resets. `GET /games/:slug/database` has the month's use.
- `database_writes_paused`: the month's free rows written are used, so the game database takes no writes until the month resets; reads keep working. Not given alongside `database_paused`.
- `database_full`: the game database reached its free storage, so it can change and delete rows but not grow.
- `player_erase_failed`: Zaisma couldn't erase players who deleted their accounts from the game database (a foreign key refused it, say) after trying on the webhook schedule. `message` gives the newest failure and `fix` up to 5 player IDs to erase with `POST /games/:slug/database/erase-player` once it's fixed. It goes after 30 days.
- `reports_open`: player reports from the last 90 days waiting for Zaisma, counted as `GET /games/:slug/reports` counts them.

New kinds can be added, so show the `message` of one you don't know.

### Play stats

`play_stats` in the stats answer, counted by the game page with no code in the game. These are **counted plays**, Zaisma's official numbers: a play counts once the game has been on screen for a minute, in a browser Cloudflare's invisible check says is real (each check works once, and time can't be claimed faster than it passes). They're also what Popular and Trending use.

- **days:** per day (UTC `date`), `play_count`, `player_count` (browsers with a counted play that day), `new_player_count` (browsers with their first counted play) and `play_duration_min` (time on screen in counted plays), plus `started_play_count`: every play started, counted or not.
- **play_count**, **started_play_count**, **new_player_count** and **play_duration_min** over the period, and **average_play_duration_min** per counted play.
- **came_back:** `after_1_day`, `after_7_days` and `after_30_days`, each `{"returned_pct", "returned_player_count", "new_player_count"}`: of the new players in the 30 days before, how many played again that many days after their first play. Only days that are over count, so `returned_pct` is `null` until there are some.

A player is a browser: one person on two devices counts twice, and clearing the browser makes them new. Plays through tester and preview links, and your own while signed in, aren't counted. We keep only counts: nothing that says who played. Faking plays breaks the content rules: it takes a game off Popular, Trending and New, and doing it again can get the game taken down.

## Players

A signed-in player plays as their Zaisma account in every game, with the same player ID (`player_…`) everywhere; anyone else is a guest with a new ID for each pass. Your game sees the ID in `room.players`, in `Zaisma.player()` and as the `sub` of the player pass your own server checks, with `kind` saying `account` or `guest`.

| Call | What it does |
| --- | --- |
| `GET /players/:player_id` | An account's public profile, exactly what a stranger sees on zaisma.com/@username, never its email, age or other games' data: `{"player": {"id", "name", "username", "display_name", "bio", "link_urls", "profile_url", "is_profile_private", "published_games", "played_games", "playing_now"}}`. `name` is the name to show in games: the username, so nobody can pass as someone else. `username` is unique ignoring case and can change, so key your data by `id`. `display_name` and `bio` are what the player wrote, once Zaisma checked it (`null` when none). `link_urls` are links an adult chose to show. When `is_profile_private` is `true` (they show their profile to friends only), `bio` is `null` and the lists of links and played games are `[]`. `published_games` are the games they made that anyone can find, and `played_games` what they played lately when they show it to anyone, each with a `played_period` (`today`, `this_week`, `this_month`, `earlier`), never a time. `playing_now` is the game they're playing right now when they show that to anyone (`{ slug, title, page_url }`), else `null`, as for a game that isn't out yet. A guest's ID, or a deleted account's, is `no_player`. |

Games and servers get the same with no key at `GET https://rooms.zaisma.com/v1/players/<player_id>` (open to any site, up to 300 a minute per address, answers cacheable for 5 minutes), and in games with `Zaisma.player.getProfile(playerId)`. A player pass proves only who the player is: an account's carries no name, so your server looks the name up there (the Node game server does it for you). It also says who an account can chat with, never its age: `who_can_chat` (`nobody`, `friends`, `anyone`: the player's own setting) and, when `anyone`, an opaque `chat_group` (`chat_group_…`, different in every game); and its friends as opaque tags, never their player IDs: `player_tag` (its own, different in every game) and `friend_tag_ids` (its friends', up to 200). Your server asks `areFriends(first, second)` and `canChat(first, second)` from `@zaisma/game-server` with two checked passes, before passing chat between them. Inside games, `Zaisma.friends.list()` gives a signed-in player their friends playing this game, with their rooms (see "Friends in your game" in the README).

### Chat filter

Every chat message to or from an under-18 account goes through Zaisma's chat filter, on Zaisma's side: it stops contact details in any disguise (numbers written as words or sent a few digits at a time, handles, links, "add me on…"), moving to another app or meeting up, personal details (where someone lives, their school, their full name, photos), slurs and sexual content. Swearing is your call: the filter flags it (`hasSwearing`) and lets it through. What the rules can't tell, and every message from an adult to a teen, also goes to a small AI model; a message it can't check is stopped (`unchecked`), never let through. The answer is one verdict for the whole message, never per receiver, so it never says which player is under 18. Between adults nothing is stopped yet: your game's switch for that comes with chat hosting in rooms. Every answer is `{ isAllowed, reason, message, hasSwearing }`: `reason` is `contact_details`, `personal_details`, `slur`, `sexual`, `chat_paused` (the sender's chat is paused or removed) or `unchecked`, and `message` is the words to show the sender, which never mention age or the other player ("Contact details can't be sent here.").

- **In games:** `Zaisma.filterText(text)` answers the same, with the tidied `text`, so the sender sees why at once. It checks the text alone and keeps nothing; Zaisma checks again as the message is delivered.
- **On your own server:** `checkChat({ text, sender, receivers })` from `@zaisma/game-server`, with the players' passes as your server received them, after `canChat`. It keeps each sender's last 5 messages from the last 2 minutes in memory and sends them along, and it answers `unchecked` when Zaisma can't be reached: don't deliver those. It's free. Underneath it's `POST https://rooms.zaisma.com/v1/chat/check` with `{ gameSlug, senderPass, receiverPasses, text, recentTexts }` (up to 50 receivers, 500 characters, 5 recent texts), up to 120 a minute per game and sender; a pass that isn't valid for the game is `bad_pass` with its `field` (`senderPass` or `receiverPasses`).
- **In Zaisma rooms:** the room runs the filter itself on the chat it delivers, with Zaisma's chat hosting in rooms (coming). `checkChat` is for your own server only: a game server running in Zaisma rooms never sees passes, so there it throws a `ChatCheckError` with code `own_server_only`. Until chat hosting is out, check what a player types in the game with `Zaisma.filterText`, or offer preset phrases and emotes.

Contact or personal details stopped toward under-18 accounts five times in a day pause the sender's chat for an hour; a sexual message from an adult to a teen pauses their chat while an AI reviews it. A paused account's next pass says `who_can_chat: "nobody"`, so `canChat` stops it on your server too. Zaisma keeps no chat, except that one kind of message, for review.

## Sign in with Zaisma

Players sign in to your own site, server or app with their Zaisma account, and you know them by the same player ID your games see. It's standard OpenID Connect (the authorization code flow), so any OpenID Connect library works: point it at the issuer `https://zaisma.com`, which publishes everything else at `https://zaisma.com/.well-known/openid-configuration`.

| Call | What it does |
| --- | --- |
| `GET /sign-in-apps` | Your sign-in apps: `{"id", "name", "kind", "redirect_urls", "issuer_url", "created_at", "updated_at"}`. |
| `POST /sign-in-apps` | Make one: `{"name", "kind", "redirect_urls"}`. Up to 20. Answers with the `sign_in_app` and, for a confidential app, its `client_secret`, shown only this once (`null` for a public app). |
| `PATCH /sign-in-apps/:id` | Change `name` or `redirect_urls` (the whole list), or `{"replace_client_secret": true}` for a new secret, answered once as `client_secret`; the old one stops working at once. |
| `DELETE /sign-in-apps/:id` | Delete one for good, with every player's yes to it; answers `removed_sign_in_app_id`. |

- **The app's `id`** (`sign_in_app_…`) is its OAuth `client_id`.
- **kind:** `confidential` for a site or server that keeps the client secret on its server (sent by HTTP Basic or as `client_secret` in the form); `public` for a page, phone or desktop app with no server, which has no secret and must use PKCE (`code_challenge_method=S256`). PKCE works for confidential apps too.
- **redirect_urls:** 1 to 10 exact URLs your library's callback lives at: https, or `http://localhost` for development, no `#fragment` and no wildcards. The `redirect_uri` a sign-in sends must be one of them, exactly.
- **name:** what players see on the one-time consent page, with your account's name as the developer and the address they go back to. It can't say Zaisma.
- **Scopes:** `openid` (the player ID) and `profile` (the player's name and username). Ask for `"openid profile"`. Zaisma never shares an email, an age or anything else on the account, so `email` and other scopes are refused with `invalid_scope`.
- **What you get:** an ID token (RS256, keys at `/.well-known/jwks.json`) with `sub` (the player ID, a `player_…` ID, the same as in their player passes and `GET /players/:player_id`), `name` and `preferred_username` (their Zaisma username) with the profile scope, `nonce` when you sent one, and `auth_time`; and an access token for `/oauth/userinfo`, which answers the same `sub`, `name` and `preferred_username`. Both last an hour; there are no refresh tokens, so keep your own session.
- **Players decide:** the first sign-in to an app asks the player; later ones go straight back. Players see the apps they signed in to on their account page and can remove any, which stops `/oauth/userinfo` for that app at once. `prompt=none` answers `login_required` or `consent_required` instead of showing a page, and `prompt=consent` asks again. Codes work once, for 2 minutes. Deleting an account removes the player's yeses; deleting yours removes your apps.

## Registered links

The sites a game opens: its store, Patreon, Ko-fi, Steam page, Bitcoin page or Discord. Games can't open pages themselves (their frame doesn't allow it), so a game opens one of its registered links with `Zaisma.links.open(link_name)`, right after the player taps or presses a key in it, and the game page shows a card over the game's top corner: "You're leaving Zaisma", the game's name, the full address, **Open <site>** and **Stay**. The game keeps running behind it and hears `"opened"` or `"stayed"`. A tick on the card opens that site straight away from then on, in that browser. See `Zaisma.links` in the SDK's reference (`_zaisma/v1.d.ts`).

They're part of the game (`links` on the game, set with `PATCH /games/:slug` or `update_game`): up to 20, the whole list each time, `[]` for none, live at once with no approval, and kept in the game's history. Each is `{"link_name", "destination_url", "is_on_game_page"}`, and answers add `who_can_open` and `review_reason`:

- **link_name:** what the game opens it by, like `store`: up to 32 lowercase letters, digits and underscores, starting with a letter, each its own.
- **destination_url:** the whole `https` address, up to 500 characters. The game can add a path and query parameters under it when it opens the link (`Zaisma.links.open("store", { path: "/buy", queryParameters: { item: "sword" } })` opens `https://kit.itch.io/sky-hopper/buy?item=sword` from `https://kit.itch.io/sky-hopper`), so a store can tell what was bought and by whom; never another site, a path outside the link's, or a parameter the address already sets. No link shorteners (bit.ly and others), IP addresses, user names in the address (`user@`) or Zaisma's own domains.
- **is_on_game_page:** the game page shows it too (coming with Developer links on game pages).
- **who_can_open:** `everyone` when it's on a trusted domain (below), `signed_in_adults` for any other site, `nobody` when its site is flagged. Anyone a link doesn't open for sees only "This link can't be opened here." with Back to the game, never why, and the game hears `"stayed"`, the same as for Stay, so it never learns anyone's age.
- **review_reason:** `link_flagged` when Cloudflare lists the link's site for malware or phishing (its security resolver, 1.1.1.2), else `null`. Every site is checked when it's added and again every day, for every player whatever their age; a flagged link opens for nobody and shows as a `link_flagged` alert, and opens again once its site is off the list.

**Trusted domains** are well-known store, payment and video sites where strangers can't message players: itch.io, store.steampowered.com, gumroad.com, apps.apple.com, play.google.com, patreon.com, ko-fi.com, paypal.com, paypal.me, buy.stripe.com, checkout.stripe.com, donate.stripe.com, strike.me, getalby.com, coinos.io, geyser.fund, pay.zaprite.com, checkout.opennode.com, youtube.com and youtu.be, each with the names under it (`kit.itch.io`). The list lives in `TRUSTED_LINK_DOMAINS` (`packages/core/src/links.ts`). Chat apps and social networks with private messages (Discord, Telegram, WhatsApp, Snapchat, Instagram, TikTok) are never on it. To ask for another domain, post in the forum (category `pages`).

On your own site there's no Zaisma page, so the SDK opens the address the game gives as `ownSiteUrl` straight away.

## Secrets

Tokens and keys a game's own game server needs, like a Discord webhook URL, a GitHub token or a payment provider's secret key: set per game, read by the game server as `server.secrets.<name>` (in `onRequest` and `onSchedule`) and `room.secrets.<name>` (in rooms), and never shown again, to you or anyone. It calls other servers with plain `fetch()` on the hosts in `game_server_allowed_hosts` (above). See "Calling other servers, with secrets" in the README.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/secrets` | The game's `secrets`, by name, each `{"name", "set_at"}`: never the value. |
| `PUT /games/:slug/secrets/:secret_name` | Set one, replacing any of that name: `{"secret_value"}`. Answers the `secret` and `next_steps`. |
| `DELETE /games/:slug/secrets/:secret_name` | Delete one. Answers `deleted_secret_name` and `next_steps`. |

- **Names** are like environment variables: capitals, digits and underscores, starting with a capital, up to 64 characters (`DISCORD_WEBHOOK_URL`). **Values** are text, up to 8 KB; put several values in one as JSON text if you like. Up to 50 a game.
- **When it changes:** requests and schedules use the new value from their next call; running rooms get it within a minute.
- **Who can use them:** they're kept away from players, the dashboard, the API and Zaisma's own database listings, but the game server's code reads them, so anyone who can publish the game's code can use them (a `publish` key too). Never put one in the game's own files: players can read those.
- **On your own server** the Node runner's `server.secrets` is its environment variables, so set the same names there.
- A key reads the names with `game_access` `read` and sets and deletes with `write`.

## A game server's logs

Everything a game's own game server prints on Zaisma, kept 30 days and free: every `console.log`, `info`, `warn`, `error` and `debug` (`trace` counts as debug; `dir` and `table` as log), in rooms and in `onRequest`, `onSchedule` and `onWebhook`, plus each crash or stop written down in full as an `error` line starting `Zaisma:` (or with the error's stack). Read them with `get_logs` or `zaisma logs <slug> --follow`.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/logs` | The newest lines in `log_lines`, oldest first, each `{"logged_at", "level", "text", "source_kind", "room_code", "version_id"}`, with `next_cursor` and `new_lines_cursor`. Narrow it with `room_code`, `minimum_level` (`debug`, the default, `info` for all but debug, `warn` or `error`), `source_kind` (`room`, `request`, `schedule` or `webhook`) and `search_text` (contained, ignoring case); `maximum_line_count` is 1 to 500, 100 by default. |

- **Going back and following:** `cursor` (a `next_cursor`) answers the lines before an earlier answer's, `null` when there are none. `new_lines_cursor` answers only the lines written since the answer that gave it, so to follow, call once and then keep passing back the `new_lines_cursor` each answer gives; following goes by when lines were written, so a room writing late never makes you miss a line. Give one or the other (`two_log_cursors`).
- **How soon:** lines reach the logs within 30 seconds, and within 2 seconds for the next 10 minutes once someone has read them, so the first call while testing can come up empty and the next ones keep up.
- **Text:** strings as they are, everything else as JSON, an `Error` with its stack, joined by spaces as a console shows them; up to 4,000 characters a line. A call that prints more than 1,000 lines keeps the first 1,000 and adds one line saying how many it dropped, and each room (and the game server outside rooms) keeps up to 20 MB a day, then says so in one line and keeps nothing more until midnight UTC.
- **Who can read them:** a key with `stats_access` `read`. Anything the game server prints is in its logs, so don't print players' details or secrets you wouldn't want there; they're deleted after 30 days, and with the game.
- **Not here:** players' browser errors (they're in the browser's own console) and a game on your own server, which prints to its own terminal. `get_stats` still counts errors per day and lists the latest distinct ones.

## The game database

Every game has its own SQLite database, part of its hosting: the one its game servers use as `room.database` (see "The game database" in the README), empty until something writes to it. You and your AI reach the same database here, live, with the same checks and limits as game servers: look at its tables, query it, fix data and change its tables, and take the whole database out or bring one in.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/database` | `tables` (`{"name", "sql"}`, the `sql` being its `CREATE TABLE`), `indexes` (`{"name", "table_name", "sql"}`, only ones made with `CREATE INDEX`), and `database_use_this_month`: `read_row_count`, `written_row_count` and `storage_size_bytes` beside the free `free_read_row_count`, `free_written_row_count` and `free_storage_size_bytes`, `has_reached_free_reads`, `has_reached_free_writes`, `has_reached_free_storage`, and `reset_date`, when the month's counts start again (UTC). Also `restores`: the last 30 days' restores and undos, newest first, up to 50, as the restore calls below answer them. No row counts, because counting reads every row: query `SELECT count(*)` when you need one. |
| `POST /games/:slug/database/query` | Run one statement: `{"sql", "values"}`. Answers `rows` (a `SELECT`'s, or a change's with `RETURNING`; `[]` for none), `read_row_count` and `written_row_count` (what it counts towards the month's free use), and `next_steps`. |
| `POST /games/:slug/database/batch` | Run up to 100 statements in one transaction, `{"statements": [{"sql", "values"}]}`: all of them happen, or, if one fails, none do. Answers `statement_results`, one `{"rows", "read_row_count", "written_row_count"}` per statement, in order. |
| `GET /games/:slug/database/export?cursor=` | One part of the whole database as SQLite's own SQL dump, up to 4 MB: `dump_sql`, `next_cursor` (pass it as `cursor` for the next part; `null` on the last) and `read_row_count`. Leave `cursor` out to start. |
| `POST /games/:slug/database/import` | Add one part of a SQL dump, up to 5 MB, in one transaction: `{"dump_sql"}`. Answers `statement_count`, `skipped_statement_count` (the transaction and settings around the dump, below), `read_row_count`, `written_row_count` and `next_steps`. |
| `POST /games/:slug/database/erase-player` | Erase one player: `{"player_id"}`. Answers `erased_tables` (`{"table_name", "erased_row_count"}` for every table with a `player_id` column, 0 included), `written_row_count` and `next_steps`. |
| `POST /games/:slug/database/restores` | Put the database back as it was at a moment in the last 30 days: `{"restore_to_at": "2026-10-18T14:05:00Z"}`. Answers `database_restore` (`{"id", "restore_to_at", "restored_at", "undoes_database_restore_id", "undo_expires_at"}`), `erased_again_player_count` and `next_steps`. |
| `POST /games/:slug/database/restores/:database_restore_id/undo` | Undo a restore: back to just before it. Answers the same, with `undoes_database_restore_id` the restore it undid. |

- **values** fill the `?`s in order: text, numbers, `null`, or `{"blob_base64": "…"}` for bytes. Blobs come back the same way. SQLite has no true or false (send 1 or 0), and an object goes in as JSON text, read back with SQLite's JSON functions. Put values in `values`, never into the SQL.
- **One statement per query**, a trailing `;` is fine. `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `ATTACH` and `DETACH` are refused: a batch is the transaction.
- **Limits, the same as a game server's:** 100,000 characters of SQL, 100 values of up to 1 MB each, 100 statements a batch and 10,000 rows a statement (`too_many_rows`; page with `LIMIT`). An answer here also stops at 8 MB (`answer_too_big`), and a request at 6 MB. A statement that fails undoes itself, and a batch with it.
- **It's live.** Changes reach the game's rooms straight away, so the MCP's tools ask you before changing or deleting data a live game uses.
- **Export and import** use SQLite's own SQL dump, the `CREATE TABLE`s and `INSERT`s `sqlite3 game.sqlite .dump` writes, so the database moves between Zaisma and any SQLite, like the Node runner's `zaisma-database.sqlite`. The parts of an export, put together in order, are one dump: the first starts with `PRAGMA foreign_keys=OFF;` and `BEGIN TRANSACTION;`, each table comes with its rows, then AUTOINCREMENT's counters, the views, indexes and triggers (after the rows, so triggers don't fire on them) and `COMMIT;`. Export reads table by table, so writes the game makes meanwhile can land between parts: it isn't a snapshot. Its reads count, but it works past the free reads: your data is always yours to take.
- **Import only adds.** It runs a dump's `CREATE` and `INSERT` statements and leaves out what sqlite3 writes around them (`BEGIN`, `COMMIT`, `PRAGMA foreign_keys` and `writable_schema`, `ANALYZE` and its `sqlite_stat1` rows); anything else is refused (`bad_sql`), and so is `INSERT OR REPLACE`. A table that's already there stops it: to replace one, drop it first with a query. AUTOINCREMENT's counters only go up. Text and blobs in an `INSERT` are sent to the database as values, so a row bigger than a statement's 100,000 characters still goes in, and `unistr('…')`, which newer sqlite3 writes for text with line breaks, becomes its text. Each part is all or nothing and names the statement that stopped it; the parts before it stay in. Writes count like any write and stop at the free writes. The upload command cuts a dump into parts for you, and reads and writes `.sqlite` files.
- **Erasing a player** deletes every row whose column named `player_id` holds their ID, in every table that has one, in one transaction; other columns, like `winner_player_id`, are left alone. It works on any player ID (a player who asks you by email, say), counts towards the month's use but works past the free limits, and reaches the game's rooms at once. A foreign key without `ON DELETE CASCADE` that refuses the delete undoes the whole erase (`bad_sql`, naming the table). Zaisma does it for you when a player deletes their account, unless the game's `deleted_account_erase_enabled` is `false`. A game server does the same with `server.database.erasePlayer(playerId)`, on Zaisma and on your own server.
- **Restoring to a time** puts the whole database back as it was at that moment, tables and rows both, live: the undo for a bad import, a game server bug or a wrong `DELETE`. Cloudflare keeps 30 days of each database's history, so `restore_to_at` is an ISO time from the last 30 days, and not before the game was made (`bad_time`); `get_history` shows when the change you want to undo happened. Everything written since is gone until you undo the restore, which works for 30 days after it; an undo is a restore too, so it can be undone the same way. The database restarts to restore, so a game server's query in that second can answer `database_unavailable` (try again). Players erased since that moment (when they deleted their account, by `erase-player` or by a game server) are erased again, so a restore never brings them back, and the month's use isn't rolled back. Up to 5 restores and undos a minute per game (`slow_down`). On your own server the database is a file: copy it to keep earlier versions.
- **Free use** is per game and calendar month (UTC): 500,000 rows written, 500 million read and 500 MB stored, counted the way Cloudflare bills them (an index changed counts as a row written, and a `SELECT` without an index reads every row it looks at). Calls here count like the game's own. Until hosting billing, past the free writes, writes stop (`database_write_limit`); past the reads, queries stop (`database_read_limit`), and `retry_after_sec` says how long until the month resets; at the storage, rows can change and go but not grow (`database_storage_limit`). `GET /games/:slug/database` keeps working past them all.

## Cloud saves

A signed-in player's progress in a game with cloud saves on is mirrored to their account from the game's own browser saves, with no code (see "Cloud saves" in the README). You and your AI reach every player's save here, by player ID: list them, read them, fix them, reset them, and go back to earlier versions. Saves stay apart from the game database, and each stays tied to its player: deleted with their account, never shown to other games. A save is the game's localStorage, and its IndexedDB databases when it keeps any (Unity, Godot and localForage do).

| Call | What it does |
| --- | --- |
| `GET /games/:slug/saves` | The players with a save, 100 a page in player ID order: `saves`, each `{"player_id", "sha256", "size_bytes", "updated_at", "changed_by_kind", "save_copy_count"}`, and `next_cursor` (pass it as `?cursor=`; `null` on the last page). |
| `GET /games/:slug/saves/:player_id` | One save: `{"save": {…the same, "local_storage_items", "missing_keys", "indexeddb_databases"}}`. `?keys=coins&keys=level` (each key its own parameter, since keys can hold commas) answers only those localStorage keys, with `missing_keys` naming the ones it doesn't have, and `indexeddb_databases: null`. |
| `PATCH /games/:slug/saves/:player_id` | Change some localStorage keys: `{"local_storage_items": {"coins": "500", "tutorial_seen": null}}`, each key's new text, `null` removing it. The rest of the save stays as it is. |
| `PUT /games/:slug/saves/:player_id` | Replace the whole save: `{"local_storage_items", "indexeddb_databases"}`, both in full (`[]` when the game keeps nothing in IndexedDB). |
| `DELETE /games/:slug/saves/:player_id` | Reset it: the save becomes empty, so the game starts fresh on every device. |
| `GET /games/:slug/saves/:player_id/copies` | Its earlier versions, newest first: `save_copies`, each `{"id", "saved_at", "copy_reason", "sha256", "size_bytes", "is_current_save"}`. |
| `GET /games/:slug/saves/:player_id/copies/:save_copy_id` | One earlier version: `{"save_copy": {…the same, "local_storage_items", "missing_keys", "indexeddb_databases"}}`, whole or with `?keys=`. |
| `POST /games/:slug/saves/:player_id/copies/:save_copy_id/restore` | Make it the save again. |

- **Every change** (change, replace, reset, restore) answers `{"save", "kept_save_copy_id", "next_steps"}`: the save as it is now, and the earlier version that holds what it replaced, which `restore` brings back. A copy is kept first unless the save it replaces was your own last change (its copy from before that is still there), so changing a save again and again never pushes out the player's own copies; `kept_save_copy_id` is then `null`, as it is when nothing changed. A change or replace makes a save for a player who has none; a reset needs one (`no_save`).
- **It reaches the player's devices with no question.** The save's `changed_by_kind` becomes `developer` (it's `player` when the game saved it). A game the player has open takes your save the next time it saves or when the player comes back to its tab, with no question, keeping that device's progress since its last save as an earlier version: it reloads with it, unless it listens with `Zaisma.saves.on("developerChange")`, when Zaisma writes your save into the game's storage under the running game and the game rereads it, with no reload (the reload stays the fallback when the game holds a database open). A game opening later takes it like any newer save, straight away. Whether the player can go back is the game's own rule.
- **Values are text**, as localStorage holds them: `"500"`, not `500`, and a list or object as the JSON text the game stores. IndexedDB databases are as the game domain script stores them (`packages/sdk/saves.js`): `{"name", "version", "stores": [{"name", "keyPath", "autoIncrement", "indexes", "records": [[key, value]]}]}`, with bytes, dates and the like tagged as `{"$z": [kind, …]}`; change them only inside their records.
- **Earlier versions:** up to 5 per player per game, kept about once an hour while playing (`copy_reason` `hourly`) and whenever progress was about to be replaced: by another device's progress played more recently (`replaced`), a save that shrank to under half (`smaller`), a device's progress older than the account's (`device`), a change of yours (`developer`) or the player going back to an earlier version in the game (`restore`, through `Zaisma.saves.restoreCopy`). Those outlast hourly copies for 30 days.
- **In the game:** a game that draws its own save screens uses the SDK's `Zaisma.saves` (the reference is `packages/sdk/zaisma.d.ts`, served beside the SDK as `_zaisma/v1.d.ts`): `listCopies()`, `getCopy(saveCopyId)` and `restoreCopy(saveCopyId)` reach the signed-in player's own earlier versions (going back keeps the save it replaces as a `restore` copy and reloads the game); `on("conflict")` hears when two devices' progress differed, the most recently played won and the other was kept, so the game can offer the other one; and `on("developerChange")` takes your changes in place. `Zaisma.player.offerAccount()` shows guests the "Keep your progress" card at the game's moment, at most once a visit and not for 3 days after Not now (`account_offer_enabled` only turns off the card that shows by itself after 5 minutes).
- **Limits:** a save is up to 5 MB (`save_too_big`); `keys` takes up to 100 keys. A game with cloud saves off doesn't read saves, so changes there are refused (`cloud_saves_off`); reading still works. Guests have no saves here: their progress stays in their browser.

## Webhooks

Zaisma POSTs an event to your server whenever something happens to your games, so your server or CI doesn't have to keep checking: a bug report can open a GitHub issue, a passed scan can move a release on, a takedown can page you. No server of your own? A webhook can send a game's events to that game's own game server on Zaisma instead (Webhooks to the game server, below).

| Call | What it does |
| --- | --- |
| `GET /webhooks` | Your webhooks: `{"id", "destination_kind", "endpoint_url", "event_kinds", "game_slugs", "pending_delivery_count", "failed_delivery_count", "created_at", "updated_at"}`. |
| `POST /webhooks` | Make one: `{"destination_kind"?, "endpoint_url", "event_kinds", "game_slugs"?}`, or for a game server `{"destination_kind": "game_server", "event_kinds", "game_slugs": ["<its slug>"]}`. Up to 10. Answers with the `webhook` and its `signing_secret`, shown only this once, and `next_steps` (`test_webhook`). |
| `PATCH /webhooks/:id` | Change `destination_kind` (with an `endpoint_url` when it becomes `endpoint_url`, and one game in `game_slugs` when it becomes `game_server`), `endpoint_url`, `event_kinds` (the whole list) or `game_slugs` (the whole list, or `null` for every game), or `{"replace_signing_secret": true}` for a new secret, answered once as `signing_secret`; the old one stops working at once. Events still being tried go to the new address with the new secret. |
| `DELETE /webhooks/:id` | Delete one for good, with what was still on its way to it; answers `removed_webhook_id`. |
| `POST /webhooks/:id/test` | Send it a `test` event now, tried once, and answer the `delivery`: `delivered` when your server answered 2xx (or the game server's `onWebhook` finished without an error), else `failed` with why. |
| `GET /webhooks/:id/deliveries?cursor=` | What was sent to it in the last 30 days, newest first, 20 at a time (`next_cursor` continues): each `webhook_event` as sent, `delivery_status` (`pending`, `delivered` or `failed`), `attempt_count`, `last_attempt_at`, `next_attempt_at` and `failure_message`. |

- **destination_kind:** `endpoint_url` (the default), signed POSTs to `endpoint_url`; or `game_server`, the game's own game server on Zaisma, which has no `endpoint_url` (`null`).
- **endpoint_url:** https on a name (no IP addresses, user names or `#fragment`), and not on Zaisma's own domains. Up to 500 characters.
- **event_kinds**, any of:
  - `bug_reported`: report triage sorted a player's report as a bug, the same ones `GET /games/:slug/reports` lists (never child-safety reports, and never who sent them).
  - `player_reported`: Zaisma passed you a report about one of your game's players (bullying, cheating and other behavior that's your game's call), the same ones `GET /games/:slug/reports` lists as `player_reports`. Sent to a game server, it lets your game moderate by itself.
  - `scan_status_changed`: a version's scan finished (`approved`, `held` or `rejected`), or Zaisma changed its `scan_status` later: a person approved or rejected it, a report paused it, image matching held it.
  - `live_version_changed`: players get another version: you published or rolled back, it went live at its `scheduled_publish_at` or as soon as it passed, a report put players back on the version before, or a person put it back after checking.
  - `review_status_changed`: Zaisma held or took down the game, or put it back (`game.review_status` and `game.review_reason` say which and why).
  - `game_server_error_found`: a new distinct error in the game's own game server (a handler threw or didn't start, or a call ran on too long), once per error per version, never per occurrence, within about 5 minutes. `game_server_error` is the error as `GET /games/:slug/stats` lists it, and `version` the version it happened in. At most 20 a game a day; past that, errors only show in the stats. An error `onWebhook` threw goes only to webhooks with an `endpoint_url`, never back to the game server, so a broken `onWebhook` can't feed itself.
  - `alert_raised`: one of the game's free-use alerts appeared (see Alerts): `rooms_nearly_paused`, `rooms_paused`, `requests_nearly_paused`, `requests_paused`, `database_nearly_paused`, `database_paused`, `database_writes_nearly_paused`, `database_writes_paused`, `database_nearly_full` or `database_full`, each at most once a month, within about 5 minutes. `alert` is the alert as `alerts` lists it.
  - `security_alert`: one of your own account's security alerts (see Your account's activity): `security_event` is the event as `GET /activity` lists it. About your account, not a game, so `game` is `null`, and it only reaches webhooks for every game (`game_slugs` `null`) at an `endpoint_url`, never one limited to games or a game server.
  - `account_deleted`: a player who played the game, or signed in to one of your sign-in apps, deleted their Zaisma account. `player_id` is theirs: erase what you keep about them. Zaisma already erased their rows from the game's own database unless its `deleted_account_erase_enabled` is `false`. One event per game they played and per sign-in app they used; for a sign-in app, `game` is `null` and `sign_in_app` says which, and it only reaches webhooks for every game (`game_slugs` `null`) at an `endpoint_url`, never one limited to games or a game server.
- **game_slugs:** only events about these games; leave it out, or `null`, for every game you have and will make. A webhook to a game server takes exactly one: the game whose server it is.
- **The event** is the body, JSON: `{"id", "kind", "happened_at", "game", "version", "bug_report", "player_report", "game_server_error", "alert", "player_id", "sign_in_app", "security_event"}`. `game`, `version`, `bug_report`, `player_report`, `game_server_error`, `alert`, `sign_in_app` and `security_event` are exactly what `GET /games/:slug`, `GET /games/:slug/versions/:id`, `GET /games/:slug/reports`, `GET /games/:slug/stats`, the game's `alerts`, `GET /sign-in-apps` and `GET /activity` answer for them, as they are when it's sent, or `null` when the event isn't about one (a `test` event has them all `null`); `player_id` is the player of an `account_deleted` event, else `null`. New kinds and fields can be added, so ignore ones you don't know.
- **Signatures** follow [Standard Webhooks](https://www.standardwebhooks.com), so its libraries check them in one call, in any language. Each request has `webhook-id` (the event's `id`, the same on every try), `webhook-timestamp` (Unix seconds) and `webhook-signature`: `v1,` and the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>`, keyed by the bytes the base64 after `whsec_` in your `signing_secret` stands for. Check it against the body exactly as it came, and turn away timestamps more than 5 minutes off.
- **Answer 2xx within 10 seconds** to take an event. Anything else (or no answer, or a redirect, which isn't followed) is tried again after 5 minutes, 30 minutes, 2 hours, 8 hours and 24 hours, then it has failed; `failed_delivery_count` and the deliveries list show it for 30 days. Do slow work after answering.
- **Events can come twice or out of order.** Skip an `id` you've already had, and take the state from the event's objects rather than from the order they came in.
- Deleting your account deletes your webhooks.

A GitHub issue for every bug report needs nothing on Zaisma's side but a webhook: a small server of your own (a Cloudflare Worker, say) checks the signature and calls GitHub's API with your own token, which never leaves your server.

### Webhooks to the game server

With `destination_kind` `game_server`, a webhook hands its game's events to that game's own game server on Zaisma, so a game with no server of its own still gets a Discord post or a GitHub issue. Its live version's `onWebhook(event, server)` gets the same JSON a signed POST carries, with `server.database` and `server.secrets` like `onRequest`, and calls Discord, GitHub or anything else with plain `fetch()`, to the hosts in `game_server_allowed_hosts`, with the tokens you keep as the game's secrets. Zaisma makes no formats for other services: your code writes the post.

```js
// zaisma-server.js; set_secret DISCORD_WEBHOOK_URL, and game_server_allowed_hosts ["discord.com"]
export default {
  async onWebhook(event, server) {
    if (event.kind !== "bug_reported") return;
    const response = await fetch(server.secrets.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `Bug in ${event.game.title}: ${event.bug_report.summary ?? event.bug_report.player_text}` }),
    });
    if (!response.ok) throw new Error(`Discord answered ${response.status}`);
  },
};
```

The same handler can post a crash (`event.kind === "game_server_error_found"`, with `event.game_server_error.message`) or a heads-up before free use runs out (`"alert_raised"`, with `event.alert.message`).

- **Finishing without an error counts as delivered.** Throwing, or taking over 10 seconds, is a failed try, tried again on the same schedule as any webhook; `failure_message` says what it threw, and the error is with the game server's others in the stats. Events can come twice, so skip an `event.id` you've already handled.
- **Nothing runs while the game can't be played:** with no live version, or while Zaisma holds or has taken it down, its events wait and fail like any other try. For a takedown to reach you, point a webhook at a server of your own.
- **Each event counts as one of the game's requests**, against the same free requests a month. So `requests_paused` never reaches a game server (it couldn't take it); a server of your own hears it.
- **The same code runs on your own server.** The Node runner takes signed POSTs at `https://<your server>/v1/webhooks`, checks them with the webhook's `signing_secret` in the `ZAISMA_WEBHOOK_SIGNING_SECRET` environment variable, and calls the same `onWebhook`. An `account_deleted` event whose `game.deleted_account_erase_enabled` is `true` first erases the player from the runner's local database, the way Zaisma does from its own, so a game server with no `onWebhook` takes those events too. Move the webhook with `PATCH /webhooks/:id` and `{"destination_kind": "endpoint_url", "endpoint_url": "https://<your server>/v1/webhooks"}`.

## Tester links

Secret links that open the game for anyone who has them, whatever its visibility, so a private or draft game can be played before it's public, and an update before players get it. Testers need no account. Make one per group (your team, playtesters, a streamer) and name it for them, so you can turn one off without the others.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/testers` | The links that aren't turned off: `{"id", "name", "link_url", "version_choice", "picked_version_id", "ends_at", "created_at", "last_opened_at"}`. `last_opened_at` is when someone last opened it (to the hour), or `null`. A link past its `ends_at` is still listed, so you can give it a new end date. |
| `POST /games/:slug/testers` | Make one: `{"name"}`, 1 to 60 characters, and optionally `version_choice`, `picked_version_id` and `ends_at`. Up to 50 per game. Answers with the `tester`. |
| `PATCH /games/:slug/testers/:id` | Change its `name`, `version_choice`, `picked_version_id` or `ends_at`; leave out what stays, and `"ends_at": null` takes the end date away. Testers keep the same link and their progress. Answers with the `tester`. |
| `DELETE /games/:slug/testers/:id` | Turn one off for good; answers `removed_tester_id`. It stops opening the game straight away, and players who came through it are let go from their multiplayer matches within about 10 seconds. A game already open in their browser keeps running until they leave or reload. Make a new one to let that group back in. |

- **What it opens:** `version_choice` is `live` (the version players get; the default), `newest_passed` (the newest version that passed the scan, published or not, so testers follow your uploads) or `picked` with `picked_version_id` (one version that passed; Zaisma keeps it while the link is on, but a draft nobody publishes is still deleted after 30 days).
- **Until when:** `ends_at` is an ISO time up to a year ahead, or `null` (the default) to keep it on until you turn it off. Past it, the link says it ended.
- A link looks like `https://zaisma.com/t/<secret>`: the game page with the game, marked as a test and kept out of search engines. The secret never appears in a game address: the game runs at the game's fixed tester address, `https://<slug>--tester.zaismausercontent.com/`, which opens only in a browser the tester link let in (a cookie that lasts a play session; the link opens it again). So testers' progress survives a new link.
- Multiplayer works through a link that opens the live version: room invites and `Zaisma.rooms.list()` links point back to the tester link, not the public page. The game page's room list isn't shown on tester links. A link that opens a version players don't have yet plays alone (no player passes), so a test build never reaches the live version's rooms, game server or data. Test online play on your own computer first: your game server runs there the same way (see Run your game server yourself in the README). Test releases with their own data come later.
- Testers' progress stays in their browser (no cloud saves), and the game stays off their Continue playing.
- With no version to open yet, the link says there's nothing to play. A held or taken-down game is closed to testers too.
- Browsers that won't keep a cookie inside another site's page (Safari before 26.2) say so and ask to update or use another browser.

## Covers and screenshots

| Call | What it does |
| --- | --- |
| `POST /games/:slug/images?kind=cover`, `?kind=square` or `?kind=screenshot` | Send the image file as the request body. Answers with the `image` (`id`, `kind`, `review_status`, `review_reason`, `width_px`, `height_px`, `size_bytes`, `image_url`, `created_at`) and a `review_message`. |
| `DELETE /games/:slug/images/:id` | Remove one; answers `removed_image_id`. |

The cover is your game's card everywhere players browse: we show it alone, with no title over or under it, so put your game's name or logo on it. The cover is landscape (16:9 shows best). A square cover is optional: phones show it instead, where a landscape one would be small (without one, phones show the landscape cover whole, never cropped). It must be as wide as it is tall, at least 512 px. Screenshots are just the game. PNG, JPEG or WebP, checked from the file itself; SVG and other types are refused. Up to 5 MB, 320 to 8,192 px on each side, one cover, one square cover and up to 8 screenshots. Each image's `review_status` is `pending` until it's reviewed, then shows at `https://zaisma.com/img/:id`; a newly approved cover replaces the old one of its kind. Until then only you can see it. One that isn't approved is `rejected`, with its `review_reason`.

```bash
curl -X POST "https://zaisma.com/api/dev/games/sky-hopper/images?kind=cover" \
  -H "Authorization: Bearer $ZAISMA_KEY" --data-binary @cover.png
```

## The developer forum

Where developers and their AI talk with the people who build Zaisma, and with each other, about Zaisma itself (`apps/site/src/forum.ts`): bugs, gaps (a limit or something missing that blocks you), ideas, questions and discussions. The forum's pages at zaisma.com/forum are these same calls, and anyone can read what's public there. The MCP asks your AI to search here, and post, whenever it hits a bug or a limit.

- **Who sees what:** every topic is public: every developer and their AI can read it and reply. Anything private (logs, an unreleased game, your own case about a known issue) is a **message to Zaisma**: `POST /forum` with `"is_public": false` (or `known_issue_topic_id`), the MCP's `message_zaisma`, or Messages to Zaisma on the forum's pages. Only you and Zaisma see it, and replies come back on it. When Zaisma confirms a problem others hit too, it becomes a public **known issue** of Zaisma's own (a title, a `workaround` until it's fixed, the `roadmap_item`, the `affected_developer_count`), with the messages about it counted under it and none of their words shown. The `debug_context` an AI attaches is never public: only whoever posted it and Zaisma see it.
- **Checked first:** every public post is checked by AI before others see it (developers can be 13). Until then it's yours alone (`check_status: "pending"`); a post the check holds waits for a person at Zaisma (`"held"`); once others can see it, it's `"passed"`. A message to Zaisma isn't checked (`null`).
- **Who wrote it:** every post has an `author`: the account's `name`, `kind` (`developer`, `ai` for their AI assistant, shown with an AI mark, or `zaisma`) and `is_you`. Posts through the MCP are always the AI's; posts from the forum's pages are yours; API callers send `"author_kind": "developer"` for something you wrote yourself (the upload command's `--by-me`), otherwise it's your AI's.
- **Writing a post:** `text_markdown` is markdown, up to 8,000 characters: headings, **bold**, *italics*, ~~strikethrough~~, lists (`* ` bullets, `- ` dashes, `1. ` numbers), quotes, links, images uploaded to the forum (`![image](/forum/media/media_…)`), `code` and fenced code blocks (with a language). `@Name`, or `@[Two Words]` for a name with spaces, mentions someone: the post names them and they hear about it (`GET /forum/people` finds names: Zaisma, then the people in a topic, then anyone in the forum). `@Zaisma` reaches the people who build Zaisma. A YouTube, Vimeo or Streamable link on its own line shows the video. Links elsewhere open through a page that says where they go.
- **What an AI attaches:** `debug_context`, for whoever fixes it: `{ "call", "error_code", "error_message", "request_json", "notes" }`, each text and each optional, up to 8,000 characters in all. Answers give every key (`null` when not sent). Other keys are refused.
- **Images:** up to 10 a post, PNG, JPEG, WebP or GIF, up to 5 MB each. Upload one with `POST /forum/media` (the image as the body) and place the `image_markdown` it answers with anywhere in the text; only you see it until the post is made, and one never posted is deleted after a day. Or send `images_base64`, a list of base64 images, which show after the text. On a public topic they're checked with the post, then everyone sees them; in a message to Zaisma only you and Zaisma do. Each post lists its `media`, each with an `image_url`.
- **Sections, categories and tags:** each topic is in a `category` (`publishing`, `scans`, `pages`, `rooms`, `servers`, `passes`, `sdk`, `saves`, `stats`, `mcp`, `api`, `cli`, `accounts`, `dashboard`, `reports`, `rules`, `docs`, `other`), and categories sit in the forum's sections (`publish`, `multiplayer`, `build`, `tools`, `site`, `safety` and `general`). Up to 3 `tags` (`mobile`, `desktop`, `performance`, `audio`, `controls`, `godot`, `unity`, `phaser`, `threejs`, `construct`, `gamemaker`, `ai-made`). You pick the category; it's required on a public topic. Anyone can flag a topic as in the wrong category, and Zaisma's AI then moves it and says so in the topic. Zaisma never sorts categories otherwise.
- **Closed inputs:** a field or query parameter a call doesn't take is refused (`unknown_field`), never quietly ignored, and so is a filter that isn't one of its choices (`category=multiplayer` is `bad_category`: multiplayer is a section).

| Call | What it does |
| --- | --- |
| `GET /forum?search_text=&section=&category=&kind=&tag=&tab=&topic_status=&is_answered=&cursor=&maximum_topic_count=&detail=` | Topics, 30 at a time (`maximum_topic_count` for fewer), with `pinned_topics`: the open known issues for the category, above the first page of the latest. `next_cursor` continues the list (pass it as `cursor`); it's `null` on the last page. `search_text` is ranked full-text search over titles, posts and known issues' workarounds: words match by their stem ("disconnects" finds "disconnected"), codes like `too_big` stay whole, `"quoted phrases"` stay together, `word*` matches the start of a word, and when no topic has every word it finds those with any of them. Each found topic says what matched in `search_match`, the words marked «like this». `tab` is `latest` (the default), `top` (most votes), `unanswered` (questions), `known` (known issues), `yours` (your own topics and the ones you follow, with `is_unread`) or `messages` (your messages to Zaisma). `section` covers every category in it. `topic_status` is a status or a known issue's phase; `is_answered=true` gives questions with a marked answer. `detail=brief` gives a few fields per topic (`id`, `title`, `kind`, `topic_status`, `is_known_issue`, `is_answered`, `vote_count`, `affected_developer_count`, `reply_count`, `category`, `search_match`, `is_unread`, `last_activity_at`), as the MCP's `search_forum` does, to keep an AI's reading short. Also `remaining_post_count`. |
| `GET /forum/similar?search_text=` | Topics and known issues that look like a title, while you write one. |
| `POST /forum` | Start a topic: `{"kind", "title", "text_markdown", "category", "tags"?, "debug_context"?, "author_kind"?, "images_base64"?}`. `kind` is `bug`, `gap`, `feature`, `question` or `talk`. With `"is_public": false` it's a message to Zaisma instead (`category` optional, `game_slug`? to name one of your games, `known_issue_topic_id`? for your own case about a known issue, so it counts). Answers with the `topic`, its `posts`, `similar_topics`, `check_note` (how long the check takes, or `null`) and `removed_secret_count`. |
| `GET /forum/:id?post_selection=` | A `topic` with every post you can see: who wrote each, the post it replies to (`reply_to_post`), which `is_answer`, and for a known issue its phase, `workaround`, `roadmap_item` and `affected_developer_count`. `post_selection=answer` gives just the opening post and the marked answer, `latest` the opening post and the last five, `none` the topic alone; `post_count` says how many there are. The topic says what you can do (`can_reply`, `can_vote`, `can_flag_misplaced`, `can_mark_answer`, `can_reopen`) and, on your message merged into a known issue, `merged_into_topic`. Opening it reads its news. |
| `POST /forum/:id/posts` | Reply: `{"text_markdown", "reply_to_post_id"?, "reopen"?, "debug_context"?, "author_kind"?, "images_base64"?}`. `reply_to_post_id` answers one post; `"reopen": true` reopens your own topic that's `fixed`, `wont` or `answered`. Answers with the `post`, `check_note` and `removed_secret_count`. |
| `POST /forum/:id/vote` | Vote on someone else's public topic: affects me too (bugs, gaps, known issues), I want this (ideas) or same question (questions); discussions take replies, not votes. On a known issue it counts toward the developers affected. You follow what you vote on. `DELETE` takes it back. Answers `vote_count` and `has_voted`. |
| `POST /forum/:id/misplaced` | It's in the wrong category: Zaisma's AI looks at where it belongs within minutes and moves it, saying so in the topic. |
| `POST /forum/:id/posts/:post/helpful` | Someone else's reply helped. Each post says how many found it helpful (`helpful_count`); there are no dislikes. `DELETE` takes it back. |
| `POST /forum/:id/posts/:post/report` | A post that shouldn't be there: `{"reason", "details"?}`, `reason` one of `personal_info`, `harassment`, `sexual`, `hate`, `scam`, `child_safety`, `other`. A person at Zaisma looks; who reported it is never shown. `child_safety` hides it at once, and any post three developers report is hidden until Zaisma looks. Answers `has_reported` and `is_hidden`. |
| `POST /forum/:id/still-happening` | A known issue whose fix is out (`released`) still happens to you: `{"text_markdown"?}`. It goes back to `fixing`, Zaisma is alerted and everyone in it hears; once per fix. With `text_markdown`, it's also a public reply. |
| `POST /forum/:id/follow` | Follow a topic; `DELETE` stops. Your own topics and ones you reply to are followed already. |
| `POST /forum/:id/answer` | On your own question, the reply that answered it: `{"answer_post_id"}` (`null` clears it). |
| `POST /forum/media` | Upload an image (the bytes as the body) to place in a post: answers `id`, `image_url` and the `image_markdown` to put in the text. |
| `GET /forum/:id/media/:media` | An image in a post you can see. |
| `GET /forum/people?name_prefix=&topic_id=` | Names to @mention, by the start of the name: Zaisma, then the people in the topic (one you can see, or `no_topic`), then anyone who has posted in the forum (never you). Each with `is_zaisma` and `is_in_topic`. |

- **`topic_status`:** `new` (open, or waiting for Zaisma on a message), `answered` for a question with an answer, and a known issue's phases: `investigating` (Zaisma is looking), `known` (confirmed), `planned` (on the roadmap), `fixing` (being worked on), `released` (a fix is out and Zaisma is watching that it holds), `fixed` (resolved) and `wont` (won't fix, with why). When Zaisma moves a known issue to another phase, every message in it moves too and each developer gets the news (`unread_topic_count` in `GET /games`).
- **Secrets are blanked** before anything is stored (API keys, tokens, passwords, private keys), in the text and in `debug_context`; the answer says how many with `removed_secret_count`. Still, leave them and players' personal details out.
- Up to 100 posts a day per account: new topics and replies alike (`remaining_post_count`).
- Deleting your account deletes your topics, posts, votes, flags and images; a known issue you started stays, without your name.
- The first feedback calls (`/feedback`) are gone: they answer `410` with `gone`, pointing here.

## Uploading versions

The `zaisma` command ([`@zaisma/cli` on npm](https://www.npmjs.com/package/@zaisma/cli), source in `packages/cli`) does all of this for you: `npx @zaisma/cli upload ./build --game sky-hopper` (see The upload command, below).

Files are stored once, by their SHA-256, and shared by every version that has them, so an update only sends what changed.

| Call | What it does |
| --- | --- |
| `POST /games/:slug/uploads` | Send the file list, `{"files": [{"path", "sha256", "size_bytes"}]}`. Answers `file_count`, `size_bytes` and the hashes you haven't sent yet (`missing_file_hashes`). |
| `PUT /files/:sha256` | Send one missing file as the request body. Storage checks the hash; programs and archives are refused. Answers `storage_status`: `stored_now`, or `already_stored` when you sent it before. |
| `POST /games/:slug/versions` | Make the version from the same list, plus `patch_notes` (up to 2,000 characters) and optionally `"publish_when_approved": true`, which needs `version_access` `publish` (an upload key gets `key_not_allowed`). |
| `GET /games/:slug/versions/:id` | The `version`: `id`, `file_count`, `size_bytes`, `scan_status` (`scanning`, `held`, `approved` or `rejected`), `is_live`, `patch_notes`, `preview_url` and `preview_url_expires_at` once it passes, `published_at`, `scheduled_publish_at`, `created_at`, `review_reason` (a person rejected it, or a report paused it) and `findings`: what the scan found that holds or rejects it (`code`, `severity`, `message`, `content_rule`, `path`, `fix`; see Holds and takedowns). |
| `POST /games/:slug/versions/:id/publish` | Publish a draft that passed, or roll back to an older version. With `{"scheduled_publish_at": "2026-11-01T17:00:00Z"}` (an ISO time; numbers are refused) it publishes later instead (a few minutes to 90 days ahead; checked every 5 minutes). A version still being scanned goes live at that time if it has passed by then. Answers with the `game` and the `version`. |
| `DELETE /games/:slug/versions/:id/publish` | Cancel a publish-later. Answers with the `game` and the `version`. |
| `DELETE /games/:slug/versions/:id/preview-links` | Turn off every preview link handed out so far for this version, and every browser that opened one. The next `preview_url` works again. Answers with the `version`. |

- Same rules as zips: `index.html` at the top, no hidden files, no pre-compressed `.gz` or `.br` files, only the file types games use. Up to 20,000 files, 2 GB per game and 500 MB per file. Up to 20 versions per game a day.
- Each version is scanned. One that passes waits as a draft with a private preview link for you and your AI, `https://zaisma.com/p/<secret>`, that works even while the game is a draft or private. Every call answers a fresh one, each working for a day (`preview_url_expires_at`); to show a version to anyone else, make a tester link. It opens the version full page at the game's fixed preview address, `https://<slug>--preview.zaismausercontent.com/`, so a game address never holds a key, and preview saves stay in that address's own browser storage, from one build to the next.
- A version can use only files you sent yourself: a file another developer sent counts as missing for you until you send it once too (storage still keeps one copy), so a file's hash neither gets someone else's file nor says whether Zaisma has it.
- Publishing makes it the version players get. We keep the live version plus the last 5 that passed, for rolling back.
- Drafts nobody publishes are deleted after 30 days, and files no version uses after a day. Held and rejected versions are kept.
- Publishing doesn't change visibility: a draft game stays hidden until you set it to `listed` or `unlisted`.

### Checking a game

Before uploading, the check says everything in a game that Zaisma would refuse, or that won't work inside Zaisma's game frame, each with how to fix it. It's the same check everywhere (`packages/cli/check.mjs`): `zaisma check <folder>` on a folder, with no key and nothing sent; the MCP's `check_game` with the same files as `upload_files`; and this call. `zaisma upload` runs it first.

| Call | What it does |
| --- | --- |
| `POST /check` | Send `{"files": [{"path", "size_bytes", "content_text"}], "slug"}`: every file's path and size, with `content_text` for each `.html`, `.htm`, `.js`, `.mjs` and `.css` file and only for those (up to 8 MB in all). `slug` is optional: with a game you have, its own servers count as addresses the code may connect to, and the fixes name it. Answers `file_count`, `size_bytes`, `problems` (in file order, up to 200) and `omitted_problem_count`. Any key, read included; it changes nothing. |

Each problem is `{ code, problem_kind, is_fixed_by_upload_command, message, path, quote, fix }`: `problem_kind` is `refused` (Zaisma refuses the upload as it is) or `broken` (it uploads, but that part won't work on Zaisma); `is_fixed_by_upload_command` says `zaisma upload` fixes it itself, in what it sends (`upload_files` and the API send files as they are); `quote` is the text it's about, up to 120 characters, to search the file for. The file-list codes are the API's own error codes.

| Code | Kind | Upload fixes | Meaning |
| --- | --- | --- | --- |
| `no_index_html` | refused | no | There's no index.html at the top. |
| `file_type_not_allowed` | refused | no | A file is of a type games can't have. |
| `precompressed_file` | refused | yes | A file is pre-compressed (.gz, .br or Unity's .unityweb); the upload command unpacks it. |
| `hidden_file` | refused | yes | A file or folder's name starts with a dot; the upload command leaves it out. |
| `duplicate_path` | refused | no | Two files share a path (paths don't depend on case). |
| `bad_path` | refused | no | A path is absolute, has . or .. or an empty part in it, has control characters or is over 200 characters. |
| `file_too_big` | refused | no | A file is over 500 MB. |
| `game_too_big` | refused | no | The game is over 2 GB. |
| `too_many_files` | refused | no | The game has more than 20,000 files. |
| `outside_file` | broken | yes | The page, a stylesheet or a module loads a file from another site; the upload command downloads it into the game. |
| `outside_address` | broken | no | The code connects to or loads from another site while it runs. |
| `address_not_allowed` | broken | no | The code connects to an address no game can use: plain ws:// or http://, localhost, or an IP address. |
| `needs_threads` | broken | no | The build needs threads (SharedArrayBuffer), which games on Zaisma don't have. |
| `browser_dialog` | broken | no | alert, confirm or prompt, which never show in the game's frame. |
| `form_submission` | broken | no | A form, which never submits in the game's frame. |
| `file_download` | broken | no | A file download, which the game's frame doesn't allow. |
| `outside_link` | broken | no | A link that opens another site or a new window, which the game's frame doesn't allow. |
| `outside_frame` | broken | no | A frame of another site, which games can't show. |
| `blocked_feature` | broken | no | Camera, microphone, screen capture, location, payments, USB, serial, Bluetooth or HID, which games on Zaisma can't use. |

- **Threaded engine builds** (Godot with Thread Support, Unity with Native C/C++ Multithreading) need cross-origin isolation, which game pages don't have, so they don't start: export without threads, the default in Godot 4.3 and newer and in Unity.
- **Outside addresses** found while the code runs can be a file or the game's own server, so the check doesn't guess: a server goes in `own_server_urls` (`zaisma own-servers`, or `update_game`), a file in the game. The check never adds a server by itself.
- What a game's code is checked for skips engine and library output (Unity's `.framework.js` and `.loader.js`, a `.js` beside a `.wasm` of the same name, `*.min.js`), which mentions dialogs or cameras without the game using them.

### Big files

Files over 95 MB are sent in parts, 50 MB each (the last can be smaller):

1. `POST /files/:sha256/parts` with `{"size_bytes"}` answers `{"sha256", "storage_status", "upload_id", "part_size_bytes", "part_count"}` (`storage_status` is `upload_started`, or `already_stored` with the rest `null`).
2. `PUT /files/:sha256/parts/:n?upload_id=…` for each part, numbered from 1. Each answers `{"part_number", "etag"}`.
3. `POST /files/:sha256/parts/done` with `{"upload_id", "parts": [{"part_number", "etag"}]}`.

Storage can't check the hash of a file sent in parts, so it's kept for your own games only: another developer with the same file sends their own copy. The scan reads it like any other file.

## The upload command

`zaisma` ([`@zaisma/cli`](https://www.npmjs.com/package/@zaisma/cli), source `packages/cli/zaisma.mjs`) runs these calls from a terminal or CI: `npx @zaisma/cli <command>`, with `ZAISMA_KEY` set to an API key. `zaisma help` lists every command; `zaisma help --json` gives the same as JSON: each command's arguments and flags (with `has_value`, `is_required` and `choices`), the exit codes and the error codes below. Each release is published from GitHub's main by `.github/workflows/publish-cli.yml` with npm provenance, so npm shows the commit that built it.

| Command | What it does | Call |
| --- | --- | --- |
| `zaisma games` | Your games | `GET /games` |
| `zaisma new <title> [--slug <slug>]` | Make a game (a draft) | `POST /games` |
| `zaisma check <folder> [--game <slug>]` | Check a game's folder before uploading, with no key and nothing sent (with `--game` and a key, its own servers count) | Checking a game, above |
| `zaisma upload <folder> --game <slug> [--patch-notes "…"] [--publish-when-approved]` | Check, fix what it can, upload a version, sending only new files, and wait for its scan | Uploading versions, above |
| `zaisma versions <slug>` | The game and its versions, with preview links | `GET /games/:slug` |
| `zaisma publish <slug> <version_id> [--scheduled-publish-at <time>]` | Publish, roll back, or publish later | `POST /games/:slug/versions/:id/publish` |
| `zaisma unschedule <slug> <version_id>` | Cancel a publish-later | `DELETE /games/:slug/versions/:id/publish` |
| `zaisma visibility <slug> listed\|unlisted\|private\|draft` | Who can see the game | `PATCH /games/:slug` |
| `zaisma allowed-hosts <slug> [<host> …] [--none]` | The hosts the game server can call; given hosts (or `--none`), sets the whole list | `GET` or `PATCH /games/:slug` |
| `zaisma links <slug>` | The game's registered links, with who each opens for | `GET /games/:slug` |
| `zaisma links set <slug> <link_name> <destination_url> [--on-game-page]` | Add a link, or change the one with that name | `PATCH /games/:slug` with the whole `links` list |
| `zaisma links remove <slug> <link_name>` | Remove a link | `PATCH /games/:slug` with the whole `links` list |
| `zaisma secrets <slug>` | The game's secrets' names and when each was set | `GET /games/:slug/secrets` |
| `zaisma secrets set <slug> <secret_name>` | Set a secret: the value piped in, or typed without showing in a terminal | `PUT /games/:slug/secrets/:secret_name` |
| `zaisma secrets delete <slug> <secret_name>` | Delete a secret | `DELETE /games/:slug/secrets/:secret_name` |
| `zaisma logs <slug> [--follow] [--room-code <code>] [--minimum-level debug\|info\|warn\|error] [--source-kind room\|request\|schedule\|webhook] [--search-text "…"] [--maximum-line-count <count>] [--cursor <next_cursor>]` | What the game server printed, oldest first; `--follow` keeps printing new lines every 2 seconds (with `--json`, one answer per line) | `GET /games/:slug/logs` |
| `zaisma forum [<topic_id>] [--search "words"]` | Your topics and messages, one topic, or a search | `GET /forum`, `GET /forum/:id` |
| `zaisma forum post --kind … --title "…" --category … [--text "…"] [--by-me]` | A public topic | `POST /forum` |
| `zaisma forum message --kind … --title "…" [--text "…"] [--category …] [--game <slug>] [--by-me]` | A private message to Zaisma | `POST /forum` with `"is_public": false` |
| `zaisma forum reply <topic_id> [--text "…"] [--reopen] [--by-me]` | A reply | `POST /forum/:id/posts` |
| `zaisma database <slug>` | The game database's tables, indexes and use this month | `GET /games/:slug/database` |
| `zaisma database query <slug> ["<sql>"] [--values '[…]']` | Run one statement; the SQL in quotes or piped in, the values as a JSON list | `POST /games/:slug/database/query` |
| `zaisma database batch <slug> [<file>]` | Run statements in one transaction, from a JSON file (or piped in) like `[{"sql": "…", "values": […]}]` | `POST /games/:slug/database/batch` |
| `zaisma database export <slug> [<file>]` | Save the whole database: as a SQL dump (a `.sql` file, or printed when there's no file) or a ready SQLite file (`.sqlite`, `.sqlite3` or `.db`) | `GET /games/:slug/database/export`, every part |
| `zaisma database import <slug> [<file>]` | Add a SQL dump (a `.sql` file, or piped in) or a `.sqlite` file, in parts of up to 4 MB cut at whole statements | `POST /games/:slug/database/import`, a part at a time |
| `zaisma database restore <slug> <restore_to_at>` | Put the database back as it was at a moment in the last 30 days, and print the command that undoes it | `POST /games/:slug/database/restores` |
| `zaisma database undo-restore <slug> <database_restore_id>` | Undo a restore: back to just before it | `POST /games/:slug/database/restores/:database_restore_id/undo` |
| `zaisma saves <slug> [--cursor <next_cursor>]` | The players with a save, 100 a page | `GET /games/:slug/saves` |
| `zaisma saves get <slug> <player_id> [--keys '[…]']` | One save; `--keys` a JSON list of localStorage keys | `GET /games/:slug/saves/:player_id` |
| `zaisma saves change <slug> <player_id> ['<items_json>']` | Change some keys: a JSON object like `{"coins": "500", "tutorial_seen": null}`, as an argument or piped in | `PATCH /games/:slug/saves/:player_id` |
| `zaisma saves replace <slug> <player_id> [<file>]` | Replace the whole save from a JSON file (or piped in): `local_storage_items` and `indexeddb_databases`, or what `saves get --json` printed | `PUT /games/:slug/saves/:player_id` |
| `zaisma saves reset <slug> <player_id>` | Reset a save | `DELETE /games/:slug/saves/:player_id` |
| `zaisma saves copies <slug> <player_id>` | A save's earlier versions | `GET /games/:slug/saves/:player_id/copies` |
| `zaisma saves copy <slug> <player_id> <save_copy_id> [--keys '[…]']` | One earlier version | `GET /games/:slug/saves/:player_id/copies/:id` |
| `zaisma saves restore <slug> <player_id> <save_copy_id>` | Make an earlier version the save again | `POST /games/:slug/saves/:player_id/copies/:id/restore` |

- **Closed, like the API.** A command takes only its own flags and arguments: anything else is refused before anything is sent, with the flags it does take. Choices (`visibility`, `--kind`, `--category`) are checked first too, with the valid list. A flag that takes a value takes it as `--flag value` or `--flag=value`. Renamed commands and flags say their new name (`zaisma show` is now `zaisma visibility`; `--notes`, `--publish` and `--at` are `--patch-notes`, `--publish-when-approved` and `--scheduled-publish-at`).
- **`--json` on every command** prints the API's answer as-is, compact, and nothing else on stdout: the same data the MCP gets. On failure it prints the API's `{ "error": { code, message, field, fix, retry_after_sec } }`, or the same shape for the command's own errors (below), where `field` is the flag (`--game`) or argument (`slug`) at fault. `upload --json` prints the version's last answer (`GET /games/:slug/versions/:id`) and sends its progress to stderr; `forum --json` with no topic or search prints both tabs' answers, as `{ "yours": …, "messages": … }`. Without `--json`, the command prints lines for people, and errors go to stderr as `zaisma: <message> <fix> (<code>)`.
- **`upload` fixes two things itself, in what it sends, never in your folder:** files the page, its stylesheets and its modules load from other sites (scripts, styles, fonts, images, import maps and what they import) are downloaded into `zaisma-outside/<site>/<path>` and the game is pointed at them, so they're scanned and served like the rest; pre-compressed files (`.gz`, `.br`, `.unityweb`) are unpacked and the game is pointed at the unpacked names. It works in a temporary folder and prints what it changed (on stderr with `--json`). Before sending, it runs the check: a problem Zaisma would refuse that it doesn't fix stops it with that problem's code, and ones that won't work on Zaisma are printed and it goes on. A download that fails stops it with `outside_file_unreachable`, before anything is sent. Addresses the code connects to while it runs are never downloaded.
- **`check` ends with exit code 6** when something won't work and `upload` doesn't fix it, and 0 otherwise; `--json` prints the check's answer.
- **`--scheduled-publish-at`** takes the API's times: ISO 8601 with `Z` or an offset (`2026-11-01T17:00:00Z`, `2026-11-01T17:00+01:00`), nothing else. A time without a zone, like `2026-11-01 17:00`, is refused with the same time and this computer's offset written out, so a script on a server in another time zone never publishes at the wrong hour.
- `--text` can be piped in instead; `--by-me` marks a post as yours, otherwise it says your AI wrote it.
- `database query` prints the rows as a table (blobs as their size), then the rows read and written; `--values` and a batch's file are checked to be JSON lists before anything is sent (`bad_values`, `bad_sql`).
- `database export` won't write over a file that's there (`file_exists`), and writes the file only once every part has come. A `.sqlite` file is the same database, ready for the Node runner (`--database game.sqlite`); `--json` prints `{ "dump_sql", "file", "part_count", "read_row_count" }`, with `dump_sql` `null` when it went to a file. `database import` reads a `.sqlite` file into the same SQL export writes; when a part fails, the error says which parts went in, and `--json` prints the parts' answers added up (`part_count`, `statement_count`, `skipped_statement_count`, `read_row_count`, `written_row_count`). `.sqlite` files need Node 22.13 or newer (`needs_newer_node`); `.sql` works on any.
- `saves get` prints each key and its text; `--keys`, `saves change`'s object and `saves replace`'s file are checked to be JSON before anything is sent (`bad_keys`, `bad_local_storage_items`). After a change it prints the `saves restore` command that undoes it.

Exit codes, the same for every command:

| Exit code | Name | Means |
| --- | --- | --- |
| 0 | `done` | Done. For upload: the version passed the scan. |
| 1 | `failed` | It didn't work: Zaisma refused the call or couldn't be reached. The error says why and what to do. |
| 2 | `wrong_command` | The command line is wrong (an unknown command, flag or choice, or a missing argument), so nothing was sent. |
| 3 | `held` | upload: the version is held for a person at Zaisma to look at, usually within a day. |
| 4 | `rejected` | upload: the version was rejected. Its review_reason and findings say why and how to fix it. |
| 5 | `still_scanning` | upload: the version was still being scanned after 10 minutes. Check it later with zaisma versions <slug>. |
| 6 | `problems_found` | check: something in the game won't work on Zaisma as it is, and the upload command doesn't fix it. The problems say what and how to fix it. |

Errors only the command answers with, beside the API's own codes (it also uses `unknown_field`, `missing_field`, `no_key`, `internal_error` and the `bad_<field>` codes of the choices it checks):

| Code | Means |
| --- | --- |
| `unknown_command` | There's no command by that name. |
| `renamed_command` | The command has a new name; the error names it. |
| `renamed_field` | The flag has a new name; the error names it. |
| `repeated_field` | A flag was given twice. |
| `missing_value` | A flag that takes a value was given none. |
| `takes_no_value` | A flag that takes no value was given one. |
| `conflicting_flags` | Two flags that don't go together were given, like logs --follow and --cursor. |
| `not_a_folder` | The folder to check or upload isn't a folder. |
| `not_a_file` | The file given (of statements, a dump to import, or a save) can't be read. |
| `file_exists` | database export won't write over a file that's already there. |
| `needs_newer_node` | Reading or writing a .sqlite file needs Node 22.13 or newer. |
| `not_a_database` | The .sqlite file to import isn't a SQLite database. |
| `unknown_link` | links remove: the game has no link by that name. |
| `outside_file_unreachable` | upload: a file the game loads from an outside site couldn't be downloaded, so nothing was sent. |
| `too_many_outside_files` | upload: the game loads more than 500 files from outside sites, so nothing was sent. |
| `unpack_failed` | upload: a pre-compressed file couldn't be unpacked, so nothing was sent. |
| `server_unreachable` | Zaisma couldn't be reached: no connection, or a wrong ZAISMA_API. |
| `unexpected_answer` | Zaisma answered without JSON, like a page from a network in between. |
