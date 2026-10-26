# Developer API

One API behind the developer MCP, the upload command (`packages/cli`) and the dashboard (zaisma.com/dashboard, `apps/site/src/dashboard.ts`), so they always agree. Base: `https://zaisma.com/api/dev`. Every answer is JSON. Errors say what happened, which input, and what to do (see Errors below), and every call that changes something answers with `next_steps` (see Next steps).

Names follow [`docs/NAMING.md`](NAMING.md): each one says what it holds, what kind of value and in what unit (`file_count`, `size_bytes`, `play_duration_min`, `width_px`), times are ISO 8601 in UTC (`created_at: "2026-10-14T09:30:00.000Z"`) and come in the same way, every ID says its kind (`version_8f3k…`, `topic_9x2m…`, `post_4kq7…`; an ID of another kind is refused with `wrong_id_kind`, saying what it is and where the right one comes from), a plural is always a list, and every answer has the same keys every time (`null` when not set). Inputs are closed: a field or query parameter a call doesn't take is refused (`unknown_field`), never quietly ignored, and so is a value that isn't one of its choices. The JSON Schema of each answer is in `apps/site/src/schemas.ts`.

## The MCP

Any AI tool that supports remote MCP servers can manage your games at `https://zaisma.com/mcp`, signed in with the same API key. In Claude Code:

```bash
claude mcp add --transport http zaisma https://zaisma.com/mcp --header "Authorization: Bearer $ZAISMA_KEY"
```

Apps that can't send a key connect by signing in instead. In claude.ai: Settings → Connectors → Add custom connector, with `https://zaisma.com/mcp`; ChatGPT and other apps the same way, wherever they add a remote MCP server. The app opens a Zaisma page where you choose what it may do and tap your passkey, then you're back in the app with every tool working. The key command above stays the way for Claude Code and the upload command.

Every tool is a call to this API (`apps/site/src/mcp.ts`): `list_games`, `create_game`, `get_game`, `update_game`, `check_game` (what Zaisma would refuse in a game and what won't work on Zaisma, before uploading; see Checking a game below), `upload_files` (small games up to 5 MB, sent as file contents), `get_version`, `publish_version` (also rolls back and publishes later), `cancel_scheduled_publish`, `end_preview_links`, `add_image`, `remove_image`, `add_shader`, `check_shader` (a shader drawn as the check would, before it's sent; see Backgrounds below), `remove_shader`, `set_background`, `add_tester_link`, `update_tester_link`, `remove_tester_link`, `get_reports`, `get_stats`, `get_history`, `get_qr_code` (the game's link, or a room's, as a QR code), `export_game` (everything about a game as one .zip; see Export everything below), `get_logs` (what the game server printed, see A game server's logs below), `get_player`, `get_access` (what the key can do), `get_activity` (your account's activity, needs a full key), `list_api_keys` (your keys and connected apps with their end dates, last use and whether Zaisma turned one off; needs a full key), the sign-in apps' `list_sign_in_apps`, `create_sign_in_app`, `update_sign_in_app` and `delete_sign_in_app`, hosting credit's `get_credit`, `top_up_credit`, `refund_top_up` and `update_automatic_top_up` (see Hosting and credit below), Zaisma Pro's `get_pro`, `start_pro`, `cancel_pro` and `resume_pro` (see Zaisma Pro below), the Stripe account's `get_stripe_account`, `connect_stripe_account`, `update_stripe_account` and `disconnect_stripe_account` (see Selling with the buy sheet below), the webhooks' `list_webhooks`, `create_webhook`, `update_webhook`, `delete_webhook`, `test_webhook` and `list_webhook_deliveries` (see Webhooks below), a game's secrets' `list_secrets`, `set_secret` and `delete_secret` (see Secrets below), a game's kept rooms' `list_kept_rooms` and `delete_kept_room` (see Kept rooms below), the game database's `get_database`, `query_database`, `batch_database`, `export_database`, `import_database`, `erase_player`, `restore_database` and `undo_database_restore` (see The game database below), cloud saves' `list_saves`, `get_save`, `change_save`, `replace_save`, `reset_save`, `list_save_copies`, `get_save_copy` and `restore_save_copy` (see Cloud saves below), and the developer forum's `search_forum`, `get_topic`, `post_topic`, `message_zaisma`, `reply_to_topic`, `vote`, `rate_post`, `bookmark_post`, `report_post`, `forum_people`, `still_happening`, `flag_misplaced`, `follow_topic` and `mark_answer` (see The developer forum below). Bigger builds go through the upload command. Making a game players can play private or a draft again needs `"confirm": true`, so the AI asks you first.

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
- `confirm_url`: only with `confirmation_needed`, where the developer does it themselves on zaisma.com with their passkey (see Hosting and credit).

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
| `bad_genres` | 400 | genres isn't a list of up to 3 of Zaisma's genres. |
| `bad_controls` | 400 | controls isn't a list of touch, keyboard_mouse and gamepad. |
| `bad_screen_orientation` | 400 | screen_orientation isn't portrait, landscape, either or null. |
| `bad_play_modes` | 400 | play_modes isn't a list of play modes, or one of them is wrong. |
| `bad_cloud_saves_enabled` | 400 | cloud_saves_enabled isn't true or false. |
| `bad_account_offer_enabled` | 400 | account_offer_enabled isn't true or false. |
| `bad_deleted_account_erase_enabled` | 400 | deleted_account_erase_enabled isn't true or false. |
| `bad_friend_joins_enabled` | 400 | friend_joins_enabled isn't true or false. |
| `bad_performance_measuring_enabled` | 400 | performance_measuring_enabled isn't true or false. |
| `bad_room_browsing` | 400 | room_browsing isn't page, game or off. |
| `bad_multiplayer_mode` | 400 | multiplayer_mode isn't none, relay or own. |
| `bad_account_requirement` | 400 | account_requirement isn't none, multiplayer or whole_game. |
| `bad_minimum_player_age` | 400 | minimum_player_age_years isn't 13, 16 or 18. |
| `accounts_needed_for_minimum_age` | 400 | A game for 16 or 18 and up needs account_requirement whole_game, since only accounts have an age. |
| `content_needs_minimum_age` | 409 | A version shows lifelike gore, which plays only in games for 16 and up. |
| `screenshot_needed` | 409 | A listed game needs at least one screenshot. |
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

**Covers, screenshots, backgrounds and other images**

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
| `bad_background_shape` | 400 | A wide background is landscape (1.3 to 2.4 times as wide as tall), a phone background portrait (1.6 to 2.4 times as tall as wide), and its long side at least 1600 px. |
| `not_a_shader` | 400 | A shader's pass isn't GLSL text with a mainImage function, or has its own main(), a #version or #extension line, texture2D, iMouse or sound. |
| `shader_too_big` | 413 | A shader's pass is over 64 KB. |
| `bad_buffers` | 400 | buffers isn't a list of { buffer_name, source, channels } with buffer_name a, b, c or d, each once. |
| `too_many_buffers` | 400 | A shader has more than 4 buffers. |
| `bad_shader_channel` | 400 | A channel isn't { channel_index 0 to 3, input_kind, buffer_name or image_id, filter, wrap }, names a buffer the shader doesn't have, or a texture that isn't an approved shader_texture of the game. |
| `shader_texture_too_big` | 413 | A shader texture is over 8 MB, or over 4,096 px on a side. |
| `too_many_shader_textures` | 400 | The game has 16 shader textures already, or a shader's channels name more than 4. |
| `shader_texture_in_use` | 409 | A shader the game keeps reads this texture. |
| `daily_shader_checks_used` | 429 | The account has run 100 shader checks in the last day. |
| `shader_check_unavailable` | 503 | Zaisma can't draw shaders here right now, so it can't check one. |
| `no_shader` | 404 | The game has no shader with that ID. |
| `bad_screen` | 400 | screen isn't wide or phone. |
| `bad_background_source` | 400 | source isn't zaisma, image or shader, or wide (which only phone takes). |
| `background_not_ready` | 409 | The image or shader isn't this game's, isn't approved yet, or is for the other screen. |
| `bad_color` | 400 | The color isn't #RRGGBB. |

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
| `game_too_big` | 413 | The game is over 2 GB (10 GB with Zaisma Pro). |
| `too_big_for_mcp` | 413 | upload_files and check_game take up to 5 MB; bigger builds go through the upload command. |
| `bad_base64` | 400 | Something sent as base64 isn't valid base64. |
| `files_missing` | 409 | Some of the version's files haven't been sent yet. |
| `bad_patch_notes` | 400 | patch_notes isn't text of up to 2,000 characters. |
| `bad_publish_when_approved` | 400 | publish_when_approved isn't true or false. |
| `bad_match_update_mode` | 400 | match_update_mode isn't next_match or now, or it came without publish_when_approved. |
| `version_limit` | 429 | The game has had 20 versions in the last day (100 with Zaisma Pro). |
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
| `bad_time` | 400 | A time isn't an ISO time in the range it takes: scheduled_publish_at from a few minutes to 90 days ahead, a tester link's ends_at from now to a year ahead, a database restore's restore_to_at within the last 30 days and not before the game was made, an announcement's starts_at from an hour ago to 90 days ahead and its ends_at after now and starts_at and at most 60 days after it. |
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
| `database_full` | 403 | The statement would grow the game's storage (its database and kept rooms) past the 10 GB a game can keep. |
| `database_unavailable` | 503 | The game's database didn't answer. |
| `database_restore_unavailable` | 501 | This Zaisma's game databases can't go back in time: its storage keeps no history, like a local preview. |
| `no_database_restore` | 404 | The game has no database restore with that ID in the last 30 days. |
| `bad_secret_name` | 400 | A secret's name isn't capitals, digits and underscores starting with a capital, up to 64 characters. |
| `bad_secret_value` | 400 | secret_value isn't text of up to 8 KB. |
| `no_secret` | 404 | The game has no secret by that name. |
| `too_many_secrets` | 403 | The game has 50 secrets, the most it can have. |
| `secrets_unavailable` | 503 | The game's secrets didn't answer. |
| `no_kept_room` | 404 | The game has no kept room with that code. |
| `dump_too_big` | 413 | dump_sql is over 5 MB: import a dump in parts, each ending on a whole statement. |

**Hosting and credit**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `hosting_paused` | 429 | The game's hosting is paused this month: its free allowance, its budget or its developer's credit is used. It starts again when the month resets, the budget is raised or credit is added. |
| `confirmation_needed` | 403 | This needs the developer's passkey on zaisma.com (turning spending on or up, or connecting a Stripe account): confirm_url is where they do it. |
| `bad_monthly_budget_cents` | 400 | monthly_budget_cents isn't a whole number of cents of at least 100 ($1), or null for no paid hosting. |
| `bad_top_up_amount` | 400 | amount_cents isn't a whole number of cents from 1,000 ($10) to 100,000 ($1,000). |
| `no_top_up` | 404 | You have no top-up with that ID. |
| `top_up_not_refundable` | 409 | The top-up has nothing left to refund: it's spent, refunded, or over 180 days old. |
| `bad_automatic_top_up` | 400 | The automatic top-up's amounts aren't whole cents that fit: a top-up of at least $10, and a monthly limit of at least one top-up. |
| `already_pro` | 409 | The developer already has a Zaisma Pro subscription (running, cancelled until the month ends, or a renewal Stripe is retrying), so there's nothing to start. |
| `not_pro` | 409 | There's nothing to cancel or resume: the developer has no Zaisma Pro, or it's already cancelled (or isn't cancelled). |
| `stripe_unavailable` | 503 | Stripe didn't answer, or this Zaisma has no Stripe account set up. |

**A game server's logs**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `bad_room_code` | 400 | room_code isn't a room's code: six characters like K7Q2MX. |
| `bad_minimum_level` | 400 | minimum_level isn't debug, info, warn or error. |
| `bad_source_kind` | 400 | source_kind isn't room, request, schedule or webhook. |
| `bad_search_text` | 400 | search_text is empty or over 200 characters. |
| `bad_maximum_line_count` | 400 | maximum_line_count isn't a whole number from 1 to 500. |
| `two_log_cursors` | 400 | get_logs got both cursor and new_lines_cursor. |

**Items and purchases**

| Code | HTTP | Meaning |
| --- | --- | --- |
| `no_item` | 404 | The game has no item by that name. |
| `too_many_items` | 400 | The game has 1,000 items, the most it can have. |
| `bad_item` | 400 | An item's name, title, description, kind, category, price or local prices isn't one set_item takes; field says which. |
| `unsupported_currency` | 400 | Zaisma doesn't price in that currency. |
| `price_too_low` | 400 | The price is under the least Stripe charges in its currency. |
| `refund_policy_needed` | 409 | A game that sells anything states its refund policy first. |
| `bad_refund_policy` | 400 | refund_policy isn't no_refunds, unused_within_14_days, within_14_days, own_words or null. |
| `bad_refund_policy_text` | 400 | refund_policy_text isn't up to 600 characters of plain words, or doesn't go with refund_policy own_words. |
| `bad_own_payment_categories` | 400 | own_payment_categories isn't a list of cosmetic, gameplay, content and currency. |
| `item_has_owners` | 409 | Players bought or were granted the item, so it can't be removed; take its price off to stop selling it. |
| `bad_item_count` | 400 | item_count isn't a whole number from 1 to 1,000, isn't 1 for a permanent item, or makes a buy's total more than 99,999,999 minor units. |
| `bad_game_account_id` | 400 | game_account_id isn't text of up to 200 characters, or null. |
| `bad_purchase_source` | 400 | purchase_source isn't sale or grant. |
| `bad_purchase_status` | 400 | purchase_status isn't pending, completed, failed, refunded or charged_back. |
| `no_purchase` | 404 | The game has no purchase with that ID. |
| `already_refunded` | 409 | The purchase was refunded or charged back already. |
| `stripe_not_connected` | 409 | Selling with the buy sheet, and refunding a sale, go through the developer's own Stripe account, which isn't connected: connect_stripe_account. |
| `stripe_cannot_take_payments` | 409 | The developer's Stripe account is connected, but Stripe hasn't turned on payments for it yet: finish setting it up on Stripe's dashboard. |
| `bad_is_stripe_tax_used` | 400 | is_stripe_tax_used isn't true or false. |
| `bad_amount_minor_units` | 400 | amount_minor_units isn't a whole number from 1 to what's left of the sale to refund. |
| `purchase_not_paid` | 409 | The sale wasn't paid (pending or failed), so there's nothing to refund. |
| `not_for_sale` | 409 | The item has no price, so players can't buy it; it's only granted. |
| `receipts_unavailable` | 503 | Zaisma couldn't sign the purchase's receipt just now. A grant answered with it wasn't made, so trying again grants it once. |
| `bad_purchase_delivery` | 400 | purchase_delivery isn't game, game_server or own_server. |
| `no_game_server` | 409 | purchase_delivery game_server needs a game server, on Zaisma or the developer's own, and the game has none. |
| `already_handled` | 409 | The purchase was handed over already, or its refund was told already. |
| `handled_by_server` | 409 | The game's purchases go to its game server or the developer's own server (purchase_delivery), so the game can't mark them handled. |

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
| `cloud_saves_not_here` | 409 | Cloud saves don't work here: this is a tester link, or this Zaisma has no accounts. The game page answers it to `Zaisma.saves` and `Zaisma.player.offerAccount()`; no API or MCP call returns it. |
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
| `retired_tool` | 410 | The tool is retired; the error names the one that replaces it. |
| `bad_rating` | 400 | rating isn't like or dislike. |
| `cant_rate_post` | 400 | Only posts in public topics take likes and dislikes. |
| `cant_rate_own_post` | 400 | Your own posts take no likes or dislikes from you. |
| `cant_report` | 400 | The post can't be reported: it's yours, or Zaisma's. |

## Next steps

Every call that changes something answers with `next_steps`: the calls that usually follow, ready to make, or `[]` when nothing does. The steps of sending files (`PUT /files/:sha256`, the parts calls and `POST /forum/media`) are the exception: their next call is always the one that uses them.

```json
"next_steps": [{"tool": "get_version", "arguments": {"slug": "sky-hopper", "version_id": "version_8f3k2m9q1x7c4v6b0n5z"}, "after_sec": 30, "reason": "The scan usually takes under a minute; once it passes, show the developer its preview_url."}]
```

- `tool` is the MCP tool's name (each maps to a call on this page); `arguments` are filled in as far as Zaisma knows, and `reason` says what to add (like a new game's files).
- `after_sec`: how long to wait first, or `null` for straight away.
- What follows today: a new game, its upload (`upload_files`); a new version, checking its scan (`get_version`); publishing while the game is a draft or private, making it `listed` when the developer wants players in (`update_game`); making a game `listed` or `unlisted` with nothing live, publishing the version that passed (`publish_version`), checking the one being scanned, or uploading one; `multiplayer_mode: "own"` without a game server, uploading one; scheduling a version still being scanned, checking its scan; a new webhook, or a new `endpoint_url` or signing secret, sending it a test event (`test_webhook`); a database restore, seeing the tables it went back to (`get_database`) and undoing it (`undo_database_restore`); an undo, `get_database`; a new image or shader, checking it (`get_game`); a shader check that passed, sending the same shader (`add_shader`, with its `image` and `buffers` to add). Everything else answers `[]`.

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

Zaisma acts on `copyright` and `defamation` only when someone sends a notice ([zaisma.com/legal/dmca](https://zaisma.com/legal/dmca), [zaisma.com/legal/defamation](https://zaisma.com/legal/defamation)), and doesn't judge the notice itself: the game is `held` with `copyright_notice` or `defamation_notice`, and the message says what the notice names. The game can still get new versions: publish one without it, and a person at Zaisma checks it and shows the game again, usually within a day (publishing tells Zaisma; there's nothing more to send). If the notice is wrong, the developer sends a counter-notice instead, which goes to the person who sent the notice; the game is back after 10 working days unless they say they've gone to court. The scan and the AI review never look for either rule.

When a country's law forbids what US law allows (the UK's hatred offences, say), a notice from a court, regulator or police there blocks the game for players in that country only, and everyone else still plays it: it's in the game's `country_blocks` with `country_law_notice`, whose message says which law and what it names, and the `game_blocked_in_country` alert. Players there get a page saying it isn't available in their country (HTTP 451), and Zaisma's lists, its files and Zaisma rooms leave it out there; its preview links still open, so you can check a fix from there. The game keeps its versions and can publish more: publish one without what the notice names, and a person at Zaisma checks it and lifts the block, usually within a day. If the notice is wrong, write to safety@zaisma.com with the game's slug and why. A `country_blocks_changed` webhook says when a block starts or ends.

- **A version's `review_reason`**: a person rejected it, or a report paused the update; `null` otherwise. Its `findings` are what the scan found that holds or rejects it, each `{"code", "severity", "message", "content_rule", "path", "fix"}`, where `severity` is `reject` (it can't go live) or `hold` (a person at Zaisma looks first, usually within a day). A finding with severity `info` is a note and holds nothing: `unregistered_link`, `unlisted_address` and `api_key_in_files`. A game that bumps into a protection the sandbox already enforces (a plain `window.open`, a call to an address that isn't Zaisma rooms or its own servers) passes with a note; a game that tries to get around one (a site opened with no tap, a link or address built from pieces, the page outside the frame, a peer connection from a frame of its own) is held as `ai_protection_dodged`. The version that only removes what held a game passes by itself, with no daily review used.
- **An image's `review_reason`**: why it wasn't approved.
- **`get_history`**: each hold, rejection and takedown with its `review_reason`, kept after it's over.
- **A hold released because the review was wrong:** when a person at Zaisma releases a hold the AI review made, `get_history` says "A person looked and released this hold. It didn't count against your daily reviews." with the version's ID, and that review is given back: it doesn't count toward your 5 judged reviews a day.
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
| `unregistered_link` | none | The game opens a site with window.open or a link that opens a new tab. The sandbox blocks that, so players tapping it get nothing. |
| `unlisted_address` | none | The game connects to an address that isn't Zaisma rooms or one of its own servers. The game's security policy blocks it, so the call fails for players. |
| `matches_another_developers_game` | `copyright` | Most of this version's files are already in another developer's game, so a person at Zaisma looks first. |
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
| `daily_large_reviews_used` | none | This developer's 5 large reviews for today (a new game or a real change, judged) are used, so this version waits for the next one to free up. Zaisma Pro has 20 large reviews a day. |
| `daily_small_reviews_used` | none | This developer's 30 small reviews for today (versions read by the AI) are used, so this version waits unread for the next one to free up. Zaisma Pro has 100 small reviews a day. |
| `version_replaced` | none | A newer version of this game came in while this one waited, so this one isn't reviewed. |
| `scan_failed` | none | The scan didn't finish after three tries, so a person at Zaisma looks. |

**The AI review**

Every version gets the same review, as a process rather than one look. Zaisma's own checks list what each file connects to, the links it opens and the code it can't follow. Reader models then read all of the code and pictures, in pieces, and pull out the exact lines and pictures that matter. Last, one stronger model judges from that list alone and picks its findings from the codes below, so the same game gets the same verdict every run. A finding's `path` and `quote` point at the exact line it's about.

Each developer gets two kinds of review a day, across all their games. A large review is a new game or a real change: read by the reader models and judged, 5 a day (20 with Zaisma Pro). A small review is a version the reader models read, 30 a day (100 with Zaisma Pro): a tweak of a game that already passed (levels, sprites, balance: nothing new it connects to, opens, asks for or shows) keeps that version's verdict on a small review alone, and a real change uses one of each. Files a version shares unchanged with an earlier one aren't read again, so a version that changes nothing to read uses neither. Past 30 (100 with Pro), a new version is held unread with `daily_small_reviews_used`; past 5 (20 with Pro), a real change is held with `daily_large_reviews_used`, and tweaks still pass at once. Either way it's checked by itself as soon as one frees up, within a day. A version after a held one is checked for what the hold named and for anything new; what already passed stays passed. A version that's still waiting when a newer one of the same game comes in steps aside (`version_replaced`, with `replaced_by_version_id` on the version): only the newest is reviewed, and the older one never goes live by itself.

| Code | Rule | Meaning |
| --- | --- | --- |
| `ai_malware` | `malware` | The AI review found what looks like malware. |
| `ai_phishing_or_scam` | `malware` | The AI review found what looks like phishing or a scam. |
| `ai_data_collection` | `personal_details` | The AI review found the game asking players for personal details, like emails, real names, birthdays or location. |
| `ai_sexual_content` | `sexual` | The AI review found sexual content or nudity. |
| `ai_private_details_or_threats` | `real_people` | The AI review found private details about a real person, like a home address, phone number or school, or a real threat against one. |
| `ai_protection_dodged` | `malware` | The AI review found code that tries to get around one of Zaisma's protections: the page outside the game's frame, the relay between players, registered links or the list of servers. |
| `ai_lifelike_gore` | none | The AI review found lifelike gore (photo-real or lifelike injury shown up close), which plays only in games for 16 and up. |
| `ai_real_money_gambling` | `illegal` | The AI review found real-money gambling. |
| `ai_paid_random_rewards` | `purchases` | The AI review found paid random rewards (loot boxes): something bought with money, or with coins bought with money, that gives a random item. |
| `ai_coin_price_without_real_price` | `purchases` | The AI review found prices in coins or gems with no real price beside them, for coins or gems bought with money. |
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
| `copyright_notice` | `copyright` | The owner of a work sent a copyright (DMCA) notice, so players can't open the game; the message says what it names. |
| `defamation_notice` | `defamation` | A private person sent a defamation notice saying the game falsely accuses them of a crime, so players can't open the game; the message says what it names. |
| `country_law_notice` | none | A notice says the game breaks a law of one country that US law allows, so players in that country can't open it, and everyone else still can; the message says which law and what it names. |
| `developer_account_deleted` | none | The game's developer deleted their Zaisma account, which takes their games down with it. |
| `image_rejected` | picked | A person at Zaisma didn't approve the image; the message says why. |
| `link_flagged` | `malware` | Cloudflare lists the link's site for malware or phishing, so the link opens for nobody. |
| `details_rejected` | picked | A person at Zaisma didn't approve the new title or description; the message says why. |

**The listing check** (covers, screenshots, backgrounds and titles; see Covers, screenshots and share pictures, and Backgrounds), **and the shader check** (see Backgrounds)

| Code | Rule | Meaning |
| --- | --- | --- |
| `extra_text_on_cover` | none | The cover, square cover or share picture has words besides the game's title, a subtitle and the studio's logo; the message quotes them. |
| `overlay_on_cover` | none | Something is laid over the cover, square cover or share picture: a button, menu, shop panel, badge, sticker, or an arrow or circle pointing at something; the message says what. |
| `famous_name` | none | The cover, square cover, share picture or title shows a famous character, logo or name, from a film, show, game, brand or club, that the developer doesn't own; the message names it. |
| `cover_not_from_game` | none | The cover, square cover or share picture is built around a character, creature or thing that doesn't appear in any of the game's screenshots; the message says what. |
| `tag_in_title` | none | The title carries a tag instead of only naming the game: a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag. "+1" and "2x" are fine. |
| `fake_reward` | `malware` | A cover, screenshot, title or description promises a fake reward or real-money bait, like free Robux, V-Bucks, gift cards or cash; the message quotes it. Players can't open the game until a person looks. |
| `screenshot_not_from_game` | none | The screenshot has something added after it was captured, like a caption, an arrow or circle, a sticker, a pasted logo or a device frame, so it doesn't show. The game's own interface is fine. |
| `text_on_background` | none | A background has no title, logo or text on it; those go on the cover. The message quotes what it found. |
| `shader_does_not_compile` | none | The shader didn't compile; the message gives the first compiler error. |
| `shader_too_slow` | none | The shader took too long to draw a frame in the check, at one of its quality levels; the message says which, how long, and the most it can take. |
| `shader_flashes` | none | The shader flashes more than 3 times a second, which can cause seizures. |

| Rule | What it says |
| --- | --- |
| `child_safety` | Sexual content involving minors, in any form. We report it to the National Center for Missing & Exploited Children. |
| `sexual` | Sexually explicit content. |
| `malware` | Malware, crypto mining, phishing, scams or anything that tries to break out of the game. |
| `illegal` | Content that's illegal in the United States, including real-money gambling. |
| `real_people` | Private details about real people, or real threats. |
| `copyright` | Other people's games, art, music or characters used without permission. |
| `defamation` | False claims that a real private person committed a crime. |
| `personal_details` | Asking players for personal details like emails, real names, birthdays or location inside the game. Every player has a Zaisma ID and name; games with their own accounts link them through Sign in with Zaisma, and anything more happens on the developer's own site. |
| `chat` | Free-text chat between players. In the beta, players talk through each game's preset phrases and emotes. |
| `crypto` | Cryptocurrency other than Bitcoin: using or promoting other coins, tokens, NFTs or airdrops. A story that mentions one is fine. Bitcoin games are welcome, but not investment advice, mining on the player's device, paying players sats, or asking for seed phrases or permission to spend from a wallet. |
| `purchases` | Selling paid random rewards (loot boxes), including through coins bought with money, or showing prices in coins or gems without the real price beside them. |
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
| `publish` | Upload and publish versions, change games, their secrets and tester links, and post on the forum. Reads everything else; can't run SQL, change saves, sign-in apps, webhooks or credit. |
| `upload` | Send files and make versions (drafts), and read everything. Can't publish, change games or post on the forum. |
| `read` | Read games, versions, stats, the database, saves, items and purchases, the forum and hosting credit. Changes nothing. |
| `custom` | A choice per area, below. |

| Area, in `area_access` | Choices | What it covers |
| --- | --- | --- |
| `game_access` | `read`, `write` | read: list and get games, with images, versions, scans, tester links and secrets' names. write: also details, visibility, images, tester links, secrets, the hosts its game server calls, and new games. |
| `version_access` | `read`, `upload`, `publish` | upload: send files and make versions, which wait as drafts. publish: also publish, schedule and roll back, and make versions with `publish_when_approved`. |
| `stats_access` | `none`, `read` | Stats, player reports and history. |
| `database_access` | `none`, `read`, `write` | read: tables, indexes, use and `export`. write: run SQL (`query`, `batch`), `import` and restore to a time. |
| `save_access` | `none`, `read`, `write` | Players' cloud saves. read: read them and their copies. write: change, reset and restore them. |
| `purchase_access` | `none`, `read`, `write` | Items and purchases. read: the items, purchase settings, purchases and receipts. write: set and remove items, change purchase settings, grant items and refund. `read`, `upload` and `publish` keys read them; only `full` writes. |
| `forum_access` | `none`, `read`, `write` | write: post, reply, vote, follow and message Zaisma, in your name. |
| `sign_in_app_access` | `none`, `read`, `write` | Sign-in apps. |
| `webhook_access` | `none`, `read`, `write` | Webhooks. |
| `credit_access` | `none`, `read`, `write` | Hosting credit (see Hosting and credit) and Zaisma Pro (see Zaisma Pro). read: the balance, top-ups and spending, and the plan. write: also start a top-up, refund one, start, cancel or resume Pro, turn automatic top-up off or down, and change a game's `monthly_budget_cents`. Turning spending on or up always needs your passkey on zaisma.com (`confirmation_needed`). |
| `stripe_account_access` | `none`, `read`, `write` | The Stripe account sales go to (see Selling with the buy sheet). read: whether it's connected and can take payments. write: also ask for a connection link, turn Stripe Tax on or off, and disconnect. Connecting itself needs your passkey on zaisma.com (`confirmation_needed`). `read`, `upload` and `publish` keys read it; only `full` writes. |

Every key sees its games and their versions, so `game_access` and `version_access` start at `read`. A key limited to some games lists only those, can't make games, and can't reach sign-in apps, webhooks, hosting credit or the Stripe account, which belong to your whole account. Public profiles (`GET /players/:player_id`) and `GET /access` work with any key. `GET /activity` and `GET /api-keys` need a full key for all your games: they show where your account and its keys are used from. A call a key doesn't reach answers `key_not_allowed` (403), saying what it would need.

Every call is checked before any of it runs, in this order: the key's access, whether your account can publish yet (for the calls above), what the path names (your game, webhook or sign-in app, or a forum topic you can see), the inputs (closed), each input that needs more than the call (`publish_when_approved`), and what the inputs name (a forum post's `game_slug`, a webhook's `game_slugs`, a version's `files`, a `known_issue_topic_id` or `topic_id`), with a key limited to some games held to those. Someone else's game, webhook, sign-in app or private topic is answered exactly as one that isn't there (`no_game`, `no_webhook`, `no_sign_in_app`, `no_topic`), and so is a file only someone else sent (`files_missing`).

| Call | What it does |
| --- | --- |
| `GET /access` | What the key you called with can do: `{ "access": { api_key_name, access_level, area_access, game_slugs }, "can_publish", "credit_balance_cents", "plan" }`. `can_publish` is whether your account can make, upload and publish games, which until the beta only accounts Zaisma adds can. `credit_balance_cents` is your hosting credit, or `null` when the key can't read it (`credit_access` `none`, or a key limited to some games). `plan` is `free` or `pro` (see Zaisma Pro). `area_access` has every area's choice, whatever the level; `game_slugs` is `null` for every game you have and will make. From the dashboard's session, `api_key_name` is `null` and access is full. |

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
| `POST /games` | Make a game: `{"title", "slug"?, "description"?, "devices"?, "controls"?, "genres"?, "screen_orientation"?, "play_modes"?, "cloud_saves_enabled"?, "account_offer_enabled"?, "deleted_account_erase_enabled"?, "friend_joins_enabled"?, "performance_measuring_enabled"?, "multiplayer_mode"?, "room_browsing"?, "account_requirement"?, "minimum_player_age_years"?, "game_server_allowed_hosts"?, "own_server_urls"?, "links"?}`. It starts as a draft that only you can see. Up to 50 games. |
| `GET /games/:slug` | One game with its `alerts` (see Alerts below), `playing_now_player_count` (the exact number of people playing it now: browsers that pressed Play and still have it on screen, and players in your Zaisma rooms, each counted once however many rooms they sit in, from the last 6 minutes; players see it from 3 up), `images`, `versions` (newest first, each with its `review_reason` and scan `findings`) and `testers`. |
| `PATCH /games/:slug` | Change any of `title`, `description`, `visibility`, `devices`, `controls`, `genres`, `screen_orientation`, `play_modes`, `cloud_saves_enabled`, `account_offer_enabled`, `deleted_account_erase_enabled`, `friend_joins_enabled`, `performance_measuring_enabled`, `room_browsing`, `multiplayer_mode`, `account_requirement`, `minimum_player_age_years`, `game_server_allowed_hosts`, `own_server_urls`, `links`, `glass_tint_color`, `monthly_budget_cents` (the game's monthly budget from your hosting credit, see Hosting and credit; it needs `credit_access` `write`, and a first or higher budget answers `confirmation_needed`). Leave out what stays the same; `null` clears it. Answers with the `game`, `review_message` (set when new words wait for review), `game_server_problem` (why the game's own game server can't run yet, or `null`) and `next_steps`. |

A game looks like: `slug`, `page_url`, `title`, `description`, `visibility`, `review_status`, `review_reason`, `country_blocks`, `devices`, `controls`, `genres`, `screen_orientation`, `play_modes`, `cloud_saves_enabled`, `account_offer_enabled`, `deleted_account_erase_enabled`, `friend_joins_enabled`, `performance_measuring_enabled`, `multiplayer_mode`, `room_browsing`, `account_requirement`, `minimum_player_age_years`, `game_server_allowed_hosts`, `own_server_urls`, `links`, `details_waiting_for_review`, `title_listing_reason`, `glass_tint_color`, `monthly_budget_cents` (`null`: no paid hosting) and `updated_at`.

- **visibility:** `draft`, `listed` (home page, search and search engines), `unlisted` (anyone with the link, never in lists or search engines) or `private`. Draft and private games open only through preview links and tester links (below). A game is listed only with at least one screenshot, sent or approved: `listed` without one answers `screenshot_needed`.
- **review_status** is ours and separate: `pending` (no version has passed review yet), `live`, `held` or `removed`, and `review_reason` says why it's held or removed (see Holds and takedowns). Changing visibility never undoes a takedown.
- **country_blocks** lists the countries whose players can't open the game, each `{ country_code, country_name, review_reason, blocked_at }`, `[]` for none (see Holds and takedowns).
- **play_modes:** how it's played, shown on the game page with icons: a list with one entry per way to play, like `[{"mode": "single"}, {"mode": "online", "minimum_player_count": 2, "maximum_player_count": 4, "play_style": "co-op"}]`. `mode` is `single`, `local` (together on one device or screen) or `online` (each on their own device). `single` takes no counts; the others need `minimum_player_count` (2 or more) and `play_style` (`co-op`, `versus` or `both`), and `maximum_player_count: null` means no limit ("2+ players"). Answers give every key, `null` where it doesn't apply. `null` clears it.
- **devices:** any of `phone`, `tablet`, `computer`. **controls:** any of `touch`, `keyboard_mouse`, `gamepad`. **screen_orientation:** `portrait`, `landscape`, `either` or `null` (not set).
- **genres:** up to 3, different, from one list: `action`, `adventure`, `role_playing`, `shooter`, `strategy`, `simulation`, `racing`, `sports`, `fighting`, `platformer`, `puzzle`, `horror`, `survival`, `sandbox`, `card_and_board`, `party`, `rhythm`, `visual_novel`. Players filter Browse by them: a genre's own list is `zaisma.com/games?filter=<genre>` (`?filter=horror`; `?genre=` isn't read and shows every game). They come back in that order; `[]` clears them, and a game with none shows under All. Multiplayer isn't a genre: Browse's Multiplayer filter reads `multiplayer_mode` and `play_modes`. `["role_playing", "strategy"]` is right; `["rpg"]` or 4 genres answer `bad_genres`.
- **cloud_saves_enabled:** `true` (the default) copies signed-in players' browser saves to their account, so their progress follows them to any device with no code in the game. It covers localStorage and IndexedDB (Unity, Godot and localForage saves included; databases with "cache" in the name, like Unity's download cache, are skipped), up to 5 MB per player. Set `false` for games that keep their own saves on a server. When a player has played on two devices, the progress played most recently wins and the other is kept as an earlier version; Zaisma never asks the player which to keep.
- **account_offer_enabled:** `true` (the default) shows guests the "Keep your progress" card once they have progress and have played 5 minutes: beside the game, it offers a free account to keep their progress. Set `false` for games that offer accounts their own way, with `Zaisma.player.signIn()`.
- **deleted_account_erase_enabled:** `true` (the default): when a player who played the game deletes their Zaisma account, Zaisma erases their rows from the game database, as `POST /games/:slug/database/erase-player` does, as well as sending `account_deleted` to your webhooks. Set `false` if the game must keep some of their rows (records the law says to keep, say), and handle the `account_deleted` event yourself.
- **multiplayer_mode:** `none`, `relay` (Zaisma passes each message to the others, no server code) or `own`: your game server, from the live version's `zaisma-server/` folder (`index.js` first, importing the folder's other `.js`, `.json` and `.wasm` files) or one `zaisma-server.js`, runs on Zaisma rooms in a sandbox that calls only the hosts in `game_server_allowed_hosts`, with the game's secrets as `room.secrets` and its own SQLite database as `room.database` (see "Your game server on Zaisma" and "The game database" in the README, and The game database below to read and change it yourself). If the live version has no game server, or one over 500 files or 5 MB, the change is saved and `game_server_problem` says why; rooms open once a version that works is published. Games already on a game server built into Zaisma show `built-in` and can't change it themselves. Rooms on the old setting end within a minute.
- **room_browsing:** for games on Zaisma rooms (`multiplayer_mode` other than `none`), where open rooms are listed so players can join them: `page` (the default) on the game page and to the game through `Zaisma.rooms.list()`, `game` only to the game (for games with their own lobby or server browser), or `off`. Room codes and invite links work either way, and the game can hide single rooms itself (see Multiplayer in the README). Whatever the setting, every game's page and the home say how many are playing now once it's 3 or more, for every game and not only multiplayer ones (no names); `GET /games/:slug` gives you the exact number. Rooms on your own servers aren't listed or counted.
- **friend_joins_enabled:** `true` (the default) lets Join on zaisma.com (a friend's face on /friends, "Alex is playing" on the game page, a profile's Playing now) and `Zaisma.friends.list()` take a player into the room their friend is in, for any game with rooms (Zaisma rooms, or its own servers through `Zaisma.friends.setRoom`). `false` grays Join as "This game doesn't take joins". One room turns it off instead, shown as "Private room": `Zaisma.joinRoom({ friendJoinsEnabled: false })` from the player who makes it, or `room.setFriendJoinsEnabled(false)` (the game server's, or the host's with the relay). It isn't a lock: a room's code or link still reaches it, so close the room (`setOpen(false)`) or answer `false` from `canJoin` to keep players out.
- **performance_measuring_enabled:** `true` (the default) has Zaisma measure how the game runs on players' devices, for `performance` in the stats (Play stats, below). `false` stops Zaisma adding its measuring script to the game's pages at all, and the stats answer `performance: null`.
- **account_requirement:** what the game needs a Zaisma account for. `none` (the default): guests play everything, and signed-in players play as their account. `multiplayer`: guests play alone; only signed-in players get player passes, so a guest's `Zaisma.player.getPass()` and `Zaisma.joinRoom()` fail with `error.code` `"account_needed"` (show your own message, or ask them to sign in without leaving the game with `Zaisma.player.signIn()`), and room links ask guests to sign in first. That's part of v1: a guest never gets a pass in such a game. `whole_game`: the game page says "Needs a Zaisma account" and Play asks guests to sign in first; only signed-in players get player passes. Passes are the backstop: Zaisma rooms also turn away guest passes given before the change, and your own servers can check a pass's `kind` claim for the same. Players under 13 can't make accounts, so they can't play games that need one.
- **minimum_player_age_years:** the youngest age that can play, even when the game's content suits everyone. `13` (the default): everyone, guests included as `account_requirement` allows. `16` or `18`: only accounts that old; younger accounts don't find the game on Zaisma (home, More games, friends' Playing now, profiles), and a link to it says "This game isn't open to your account." Only accounts have an age, so above 13 the game needs an account for the whole game: giving `16` or `18` alone sets `account_requirement` to `whole_game` too, and any other `account_requirement` while it's above 13 is refused with `accounts_needed_for_minimum_age` (set it back to `13` first; that leaves `account_requirement` as it is). Zaisma enforces it: Play, player passes, the relay and requests to your game server turn away younger accounts with `game_not_open_to_player`, and Zaisma rooms remove ones already playing when you raise it. Tester links follow it (testers then need an account); your own previews don't. Neither your game nor your own servers ever learn a player's age: a pass never carries it, and a younger account never gets one. Lifelike gore needs `16` or `18`: see "Allowed, even where other platforms ban it" under the content rules.
- **game_server_allowed_hosts:** the hosts the game's own game server can call with plain `fetch()` (game server reach): your own server, a payment provider, Discord, GitHub. Up to 20 host names, like `["discord.com", "api.github.com"]`, or `"*.example.com"` for every name under example.com (not example.com itself); `[]` (the default) for none, and the whole list each time. No `https://`, paths or ports: every call is https, never to an IP address, this computer or Zaisma's own domains. Live within a minute, with no approval by Zaisma, and kept in the game's history; players don't see it (the game page names only servers their browser connects to). Calls send up to 5 MB, get 10 seconds, aren't redirected (a redirect comes back to your code), and a game makes up to about 600 a minute in each place. A call to anything else throws an `OutsideCallError` in the game server, with a `code` (`not_https`, `unreachable_host`, `host_not_allowed`, `outside_call_limit`, `too_big`, `outside_call_timeout` or `outside_call_failed`) and a `fix`; the stats' `game_server_errors` show it. The tokens it needs go in its secrets (below).
- **own_server_urls:** your own servers the game connects to from players' browsers: a game server you run with `@zaisma/game-server` (`Zaisma.joinRoom({ serverUrl })`), your own relay or your own API. Up to 5 addresses, each `wss://` or `https://` and the name, with a port if it needs one and nothing after it, like `["wss://play.example.com", "wss://eu.example.com:8443"]`; `[]` (the default) for none, and the whole list each time. Never an IP address, this computer (`localhost`) or Zaisma's own domains. `wss://` and `https://` of one server count once, and the game may use either. Live at once with no approval by Zaisma: players' next page load connects (a relay of your own within 5 minutes), and friends' Join can send them to rooms there. Kept in the game's history, and the game's ⋯ menu names them in neutral words: "Online play runs on the developer's own server: play.example.com" (nothing on the details players see before Play); games that only use Zaisma rooms show nothing. Everything a game shows players is under the content rules wherever it comes from. Not for the servers your game server on Zaisma calls: that's `game_server_allowed_hosts`. From a terminal: `zaisma own-servers <slug> wss://play.example.com`.
- **links:** the game's registered links, which it opens with `Zaisma.links.open` (Registered links, below); `[]` (the default) for none, and the whole list each time.
- Titles, descriptions, patch notes, tester link and sign-in app names, and forum titles and posts take any language and emoji, but no invisible characters or characters that flip text direction (zero-width spaces, direction overrides, byte order marks and the like): the call answers `bad_<field>` naming the character as `U+XXXX`.
- Once players can see a game, a new title or description waits for the listing check, usually a minute, or a person when the check can't clear it (`details_waiting_for_review`, with `title` and `description`, `null` for the one that didn't change) before it shows. A title that keeps the game off Zaisma's lists says why in `title_listing_reason` (see The listing check, under Covers, screenshots and share pictures).

| Call | What it does |
| --- | --- |
| `GET /games/:slug/reports?cursor=` | Player reports from the last 90 days (`period_duration_days`), counted by reason in `reasons` (`reason`, `label`, `open_count`, `closed_count`), and `bug_reports`: reports that report triage sorted as bugs, each with `player_text`, a one-line `summary`, the `version_id` they played and `reported_at`, and `player_reports`: reports about one of your game's players that Zaisma passed to you, newest first, up to 50, each with its `reason` (`harassment`, `cheating`, `other`, or one of the four Zaisma looks at itself when a person passed it on: `real_life_threat`, `personal_details`, `following_after_block`, `sexual`), `player_text`, `reported_player_id`, `reported_player_name`, `room_code`, `version_id` and `reported_at`. How players treat each other is your game's call, with mute and block always there; Zaisma itself acts only on threats that reach into real life, sharing someone's personal details, following someone after they blocked them, and anything sexual toward a teen. Pass the `next_cursor` from your last call as `cursor` to get only the bug and player reports that arrived after it. Child-safety reports are never counted or shown, and no report says who sent it. |
| `GET /games/:slug/stats?period_duration_days=30` | How the game is played, up to 90 days (`play_stats`, see Play stats below), how it runs on players' devices (`performance`, the same section), and multiplayer use per day in `multiplayer_days`: `date`, `room_count`, `room_play_duration_min`, `message_count` (messages and bytes players sent), the day's room traffic per player a second (`inbound_messages_per_player_sec`, `inbound_size_bytes_per_player_sec`, `outbound_messages_per_player_sec`, `outbound_size_bytes_per_player_sec`, divided by its player time, each message out counted once per player it reached) and `game_server_cpu_duration_sec`, the time the game's own game server ran in its rooms (each call's time less its waits on the database, other servers and its own timers). `hosting_use_this_month`: the game's month on its one hosting meter (see Hosting and credit): `free_used_pct`, `shares`, `is_paused`, `paused_reason`, `paused_at`, `resets_on_date`, `monthly_budget_cents`, `spent_from_credit_cents`, and the raw counts behind it, facts for tuning that are never priced on their own: `room_play_duration_hours` on Zaisma rooms, `relayed_size_bytes` (the data Zaisma's relay sent the game's players for their connections to each other, read from Cloudflare about once an hour), `game_server_cpu_duration_sec` (its rooms, and requests, schedule runs and webhooks past their first 10 ms), `request_count` (requests, webhook events and schedule runs), `written_row_count`, `read_row_count` and `database_size_bytes`. Rooms on your own server aren't counted. `room_traffic`: this month's traffic per player a second (the same four numbers), `message_types`, its 10 biggest message types by bytes (`message_type`: a message's `data.type`, or `(none)`, `(bytes)`, `(zaisma)` for Zaisma's own, `(state)` for state sync's updates (`stateSyncEnabled`) and `(other)` past a room's first 20; `direction` `inbound` or `outbound`; `message_count`, `size_bytes`, `largest_size_bytes`, `average_size_bytes`), and `traffic_hints`, each a `code` and a `message` with the game's numbers: `json_messages_large` (a JSON type averages 512 bytes or more at 5 or more a player-second: send it as bytes), `outbound_heavy` (each player gets 32 KB a second or more: send only what changed and what they can see, with `stateSyncEnabled` and `stateView`), `message_near_limit` (a message of 12 KB or more, near the 16 KB limit) and `latest_only_available` (a type goes to each player 10 or more times a second, and 10% or more of it went to players whose connection was backed up: send it with `delivery: "latest_only"`). Rooms on your own server aren't counted. `schedules`: the live version's schedules (see "Schedules" in the README), read within a minute of it going live, each with `schedule_name`, `cron` (UTC), `version_id`, `next_run_at` and `last_run_at` (`null` until it first runs); `[]` when it has none or players can't play the game. For games whose own game server runs on Zaisma (rooms on `own`, or any requests or schedules), each day's `game_server` has `call_count` (calls from its rooms), `request_count` (requests to `onRequest`, see "Requests to your game server" in the README), `scheduled_run_count` (runs of `onSchedule`), `crash_count` (a handler threw; that call, request or run is lost), `stopped_count` (ran on too long, like an endless loop; the match froze about 2 seconds, or the request or run failed) and `ended_match_count` (stopped twice), and `game_server_errors` lists the 20 most recent distinct errors: `kind`, `message` with the file and line it came from (a game server that didn't start says why, like an option it doesn't take, with the ones it does, or a cron that doesn't read; a run's error starts with its schedule's name), `occurrence_count`, `version_id`, `first_at` and `last_at`. Other games get `game_server: null` and `game_server_errors: []`. |
| `GET /games/:slug/history` | What happened to the game in `events`, newest first, up to 100: `description`, `version_id`, `subject_name` (what it was done to, like a secret's name), `done_by` (`you`, `api_key`, `ai` or `zaisma`), `api_key_name`, where it came from (`device`, `network_name`, `city_name`, `region_name`, `country_code`, `connection_address`: kept 90 days, and `null` with Keep where my account is used from off, except that uploads keep their address 90 days either way), `is_new_place` (a key's first change from a network and country it hadn't been used from), `occurrence_count` (SQL writes, imports, exports and save reads and changes from one key within the hour fold into one event), `happened_at`, `last_happened_at` and, for a hold, rejection or takedown, its `review_reason` (otherwise `null`). Besides uploads, scans and publishes it holds database writes, imports, exports and restores (a restore's `subject_name` is the time it went back to; an undo's, the restore it undid), a re-upload of the game by another developer that Zaisma stopped (its `subject_name` is their username; you also get an email), save reads and changes, secrets and tester links; a key that isn't limited to some games also sees your webhooks and sign-in apps. |
| `GET /games/:slug/qr-code?room_code=` | The game's link as a QR code: `link_url` (the game page, or with `room_code` a room in it) and `qr_code_svg`, an SVG document, black on white with its margin, to save as a `.svg` file or turn into a PNG at any size for posters, booths and trailers. The dashboard has it under Details with SVG and PNG downloads, and players get the same code from Share on the game page. `room_code` that isn't a room's code answers `bad_room_code`. |

### Alerts

`alerts` on each game in `GET /games`, and beside the game in `GET /games/:slug`: what needs your attention in it, most urgent first, `[]` when nothing does. The developer home on zaisma.com/dashboard shows the same list on each game's card, and each game's Overview above everything else. Each is `{"kind", "message", "fix", "version_id"}`, `version_id` naming the version it's about (`null` when it's about the whole game):

- `game_removed`: Zaisma took the game down; `message` and `fix` are its `review_reason`'s.
- `game_held`: players can't open the game while Zaisma checks it; likewise.
- `game_blocked_in_country`: players in one country can't open the game, on a notice under that country's law, and everyone else still can; one alert for each country in `country_blocks`, with its message and fix.
- `version_rejected`: the newest version was rejected. `GET /games/:slug/versions/:id` has its `findings`.
- `version_held`: a version is waiting for a person at Zaisma (or a player report paused it), usually decided within a day. One alert per held version.
- `link_flagged`: one of the game's registered links opens for nobody, since Cloudflare lists its site for malware or phishing. One alert per link; its `fix` is the link's `review_reason`'s.
- `game_off_lists`: the game is listed, but a cover's or the title's `listing_reason` keeps it off Zaisma's lists until it's fixed; the message gives each reason, the fix the first one's. It still plays by its link.
- `hosting_paused`: the game's hosting is paused this month (see Hosting and credit), with why: its free hosting is used and it has no budget (back on the 1st, UTC), its budget is used, or your credit ran out. No new rooms, connections between players or game server requests start; matches already running get an hour from the pause to finish, and take no new players meanwhile: the game server's `onEnding` and each player's `ending` event say when (`room.endsAt`). The `fix` says what starts it again.
- `database_full`: the game's storage (its database and kept rooms) reached the 10 GB a game can keep, so the database can change and delete rows but not grow, and no more rooms can be kept.
- `hosting_nearly_paused`: 80% of the month's free hosting is used, and the game has no budget to go on past it.
- `hosting_budget_nearly_used`: 80% of the game's monthly budget is used.
- `database_nearly_full`: the game's storage is 80% of the 10 GB a game can keep.

A heads-up is never given alongside its own paused or full kind.
- `player_erase_failed`: Zaisma couldn't erase players who deleted their accounts from the game database (a foreign key refused it, say) after trying on the webhook schedule. `message` gives the newest failure and `fix` up to 5 player IDs to erase with `POST /games/:slug/database/erase-player` once it's fixed. It goes after 30 days.
- `reports_open`: player reports from the last 90 days waiting for Zaisma, counted as `GET /games/:slug/reports` counts them.

New kinds can be added, so show the `message` of one you don't know.

### Play stats

`play_stats` in the stats answer, counted by the game page with no code in the game. These are **counted plays**, Zaisma's official numbers: a play counts once the game has been on screen for a minute, in a browser Cloudflare's invisible check says is real (each check works once, and time can't be claimed faster than it passes). They're also what Popular and Trending use.

- **days:** per day (UTC `date`), `play_count`, `player_count` (browsers with a counted play that day), `new_player_count` (browsers with their first counted play) and `play_duration_min` (time on screen in counted plays), plus `started_play_count`: every play started, counted or not.
- **play_count**, **started_play_count**, **new_player_count** and **play_duration_min** over the period, and **average_play_duration_min** per counted play.
- **came_back:** `after_1_day`, `after_7_days` and `after_30_days`, each `{"returned_pct", "returned_player_count", "new_player_count"}`: of the new players in the 30 days before, how many played again that many days after their first play. Only days that are over count, so `returned_pct` is `null` until there are some.

A player is a browser: one person on two devices counts twice, and clearing the browser makes them new. Plays through tester and preview links, and your own while signed in, aren't counted. We keep only counts: nothing that says who played. Faking plays breaks the content rules: it takes a game off Popular, Trending and New, and doing it again can get the game taken down.

`performance` in the stats answer says how the game runs on players' devices, measured in their browsers by a small script Zaisma adds to the game's pages at its public address, with no code in the game. Only you and your AI see it: never the game page, the shelves or the ranking. It's `null` when `performance_measuring_enabled` is off.

- **version_totals:** each version played in the period, every device together, newest first.
- **device_totals:** the newest version played in the period, by `browser_name`, `os_name` (read from the browser's user agent, which isn't kept), `device_kind` (`computer`, `phone` or `tablet`, as the game page tells them apart) and `graphics_family` (the graphics chip's maker, read in the game's frame so the chip's own name never leaves it; `unknown` when the browser hides it), most plays first. Groups under 20 plays fold into one last row whose four are all `other`, so a rare device can't single out a player.

Each row has `version_id`, `play_count` and:

- **median_loading_duration_sec**, **slow_tenth_loading_duration_sec:** from the game's page opening to its first draw on a canvas in the page, the same first draw the Chrome check measures (`performance_check.loading_duration_sec` on a version): half the plays drew within the median, and the slowest tenth took the slow tenth or longer. `null` when none drew.
- **median_frames_per_sec**, **low_tenth_frames_per_sec:** frame rates of the seconds the game was on screen, counted from its own `requestAnimationFrame` frames, so a game that draws from a worker (OffscreenCanvas) or never asks for frames isn't measured (`is_measured: false`, and these are `null`). They're given as the band they fall in (15, 25, 30, 45, 60, 90 or 120; below 15, the rate itself): 60 means 60 to 89, since frame rates gather at screens' refresh rates.
- **long_frames_per_min:** frames of 50 ms or longer, stutter a player feels, a minute of measured play.
- **crashed_play_pct**, and crashed plays by what happened first, each play counted once: **error_stop_count** (an uncaught error after which the game asked for no frame for 5 seconds while on screen), **context_lost_count** (a WebGL context on a canvas in the page was lost while on screen, and the game didn't lose it itself with `WEBGL_lose_context`) and **stopped_responding_count** (the game's frame stopped answering for 15 seconds while on screen: frozen or crashed).
- **median_peak_memory_size_bytes:** the most memory a play used by the time it was first reported, usually its first minute: the JavaScript heap where the browser tells it (Chrome and Edge) plus WebAssembly memory. `null` when no browser told it.

Plays are measured with the same Cloudflare check as counted plays, so faked ones can't skew them: a play's numbers come only with its check's ticket, its load time and crash count once, and it can't report more play than it has been open. Plays through tester and preview links and your own aren't measured. Numbers are kept as totals a day per version and device group, never per play or player.

### Export everything

| Call | What it does |
| --- | --- |
| `GET /games/:slug/export` | What an export of the whole game holds, in `export`: `download_url`, `command`, `version_count`, `withheld_version_count`, `image_count`, `withheld_image_count`, `save_count` and `files_size_bytes`. |
| `GET /games/:slug/export/download` | The export itself: a .zip (`application/zip`), made as it downloads. |

Everything about a game as one .zip, to keep, to move, or to run on your own server. Three ways in, one file: `export_game` answers `download_url`, a link your AI hands you that opens in your browser when you're signed in to Zaisma and for no one else (it doesn't expire); the game's dashboard has an Export everything button on its Details tab; and `npx @zaisma/cli export <slug>` saves it as a folder (The upload command, below). The key needs read access to the game, versions, stats, database and saves (`key_not_allowed` otherwise; a read key has it all). An account starts up to 2 exports a minute (`slow_down`). Each export is a line in the game's history ("Exported everything about the game"), with who made it and from where.

In the .zip:

- `README.txt`: what's where.
- `game.json`: the game (as `GET /games/:slug` answers it), its `images` (each with `file_path`, or `null` when it hasn't passed review), `testers`, and `secrets`: their names and when each was set, never their values.
- `versions.json`: every version Zaisma keeps, with its patch notes, review status and findings, as `GET /games/:slug` answers them without the preview links; `folder_path` is where its files are, or `null` for a version that's still being scanned, held or rejected. Those carry no files, so nothing unscanned or held leaves through an export.
- `versions/<version_id>/…`: each version's files, as they were uploaded.
- `images/<kind>-<image_id>.png` (or `.jpg`, `.webp`): the cover, square cover and screenshots that passed review.
- `database.sql`: the game database as SQLite's SQL dump, the same text `export_database` answers part by part. `zaisma export` also makes it `database.sqlite`, the file the Node runner takes as `--database-file`.
- `saves.jsonl`: every player's cloud save, one JSON object a line, as `get_save` answers it (`player_id`, `sha256`, `size_bytes`, `saved_at`, `changed_by_kind`, `save_copy_count`, `version_id`, `local_storage_items`, `indexeddb_databases`). Earlier copies of saves stay out.
- `stats.json`, `reports.json`, `history.json`: as `get_stats` (90 days), `get_reports` and `get_history` answer them.

Account-wide things (webhooks, sign-in apps, API keys) aren't in it: they belong to the account, not the game. The files are stored as they are, not compressed, and zip64 records go in where a game needs them, so every unzip tool opens it.

## Hosting and credit

Everything a game runs on Zaisma's servers is on one meter per game, shown as a percentage of its free hosting for the month, never in dollars: room time, its game server's CPU, data Zaisma's relay sends its players, its database's rows and storage, and requests, webhook events and schedule runs to its game server. Every game gets the same free hosting each calendar month (UTC), with no card: about 2,500 player-hours of a game that only uses rooms, like 8 friends playing every night all month, or a small game with a few hundred players. A demo or a test never uses up another game's month. Free on purpose, for every game and off the meter: game files (downloads and storage, so a game never stops loading), cloud saves, accounts and sign-in, publishing and its reviews, spectators, and anything on your own servers (rooms, a relay, an API).

`hosting_use_this_month`, in `GET /games/:slug/stats` and `GET /games/:slug/database`:

- `free_used_pct`: how much of the month's free hosting is used, 0 to 100. `resets_on_date` is when it starts again.
- `shares`: what used it, each `{"kind", "share_pct"}` adding to 100, biggest first: `room_play`, `game_server_cpu`, `relayed_data`, `database`, `requests`. `[]` before any use.
- `is_paused`, `paused_reason` (`free_used`, `budget_used`, `credit_used` or `null`) and `paused_at`.
- `monthly_budget_cents` and `spent_from_credit_cents`: the game's budget and what credit paid for it this month.
- The raw counts behind it, facts for tuning that are never priced on their own: `room_play_duration_hours`, `relayed_size_bytes`, `game_server_cpu_duration_sec`, `request_count`, `written_row_count`, `read_row_count`, `database_size_bytes`.

**Past the free hosting.** A game without a budget pauses at 100%. A game with one (`monthly_budget_cents` on `PATCH /games/:slug`, in cents: 5000 is $50) draws from your credit past it, never more than its budget in a month, at twice what each thing costs Zaisma: room time $2 per 1,000 player-hours, with 25 CPU-seconds of game server a player-hour included; game server CPU past that $0.04 per 1,000 CPU-seconds, wherever it runs (in rooms, and in requests, schedule runs and webhooks past the first 10 ms of each), counting only the time your code runs: its waits on the database, other servers (including reading their answers) and its own timers don't count, and calls made at the same moment count only their own time; relayed data $0.10 per GB; the database $2 per million rows written, $0.002 per million read and $0.40 per GB-month stored; game server requests $1.60 per million, a schedule's run counting as one. Only this part shows in dollars. You hear at 80% of a game's budget (`hosting_budget_nearly_used`) and when it's used, by email and in its alerts and webhooks; at 80% of the free hosting for a game without a budget (`hosting_nearly_paused`).

**The pause** (`hosting_paused`, with why): no new rooms, connections between players through the relay, or game server requests and schedule runs start until the month resets, the budget is raised or credit comes in. Matches already running get an hour from the pause to finish, every room of the game ending together; the game server's `onEnding` and each player's `ending` event say when (`room.endsAt`). The game database keeps reading and writing for that hour, so a match's last save lands, then answers `hosting_paused`; exports and erasing a player always work. A pause can come up to 5 minutes after the line is crossed, and what a game uses past its budget or your balance, its finishing hour included, is written off: never charged later.

**Credit** is one balance for all your games, in cents, never below zero. You buy it on Stripe's page ($10 buys $10, from $10 to $1,000 a top-up), and Stripe sells it as the merchant of record, handling sales tax and VAT. It never expires and is never paid out; it pays only for Zaisma's services. What's unspent of a top-up refunds to its card for 180 days, on request; credit is spent oldest first, so the newest top-ups hold the balance. Automatic top-up charges the card of your last top-up when the balance falls under your line, never more than your monthly limit, and emails you each time; a declined card turns it off and tells you. Deleting your account refunds what still refunds.

**Spending needs you.** Your AI can read all of it, start a top-up (you pay on Stripe's page), refund one, and turn automatic top-up or a game's budget off or down. Turning either on or up needs your passkey on zaisma.com: through a key it answers `confirmation_needed` (403) with `confirm_url`, the page where you do it. These calls need `credit_access` (see What a key can do).

| Call | What it does |
| --- | --- |
| `GET /credit` | Your credit: `{"credit": {"balance_cents", "automatic_top_up": {"is_enabled", "top_up_below_cents", "top_up_amount_cents", "monthly_top_up_limit_cents", "topped_up_this_month_cents"}, "top_ups", "games", "entries"}}`. `top_ups`: the last 180 days', newest first, each `{"id", "amount_cents", "refundable_cents", "refund_ends_at", "created_at"}` (IDs `top_up_…`). `games`: games with a budget or spending this month, each `{"slug", "title", "monthly_budget_cents", "spent_from_credit_this_month_cents"}`. `entries`: the last 90 days, newest first, each `{"id", "entry_kind", "amount_cents", "game_slug", "created_at"}`: `top_up` (adds), `hosting_charge` (one per game per day, negative), `refund` (negative) or `written_off` (what Zaisma took on; it never touched the balance). Needs `credit_access` `read`. |
| `POST /credit/top-ups` | Start a top-up: `{"amount_cents"}`, 1000 ($10) to 100000 ($1,000); anything else answers `bad_top_up_amount`. Answers `checkout_url`, Stripe's page where only you can pay, `expires_at` and `next_steps` (`get_credit` once you've paid). Paying adds the credit within seconds, and games paused for credit start again. Up to 10 top-ups and refunds a minute. |
| `POST /credit/refunds` | Refund what's unspent of one top-up to its card: `{"top_up_id"}`. Answers `refunded_cents` and `next_steps`. `top_up_not_refundable` when it's spent, refunded or over 180 days old; `no_top_up` when it isn't yours. |
| `PATCH /credit/automatic-top-up` | Change automatic top-up: any of `is_enabled`, `top_up_below_cents`, `top_up_amount_cents` (1000 to 100000) and `monthly_top_up_limit_cents` (at least one top-up); leave out what stays the same. Turning it on needs a card from an earlier top-up. Off or lower works with a key; on or higher answers `confirmation_needed`. Answers the `credit` as `GET /credit` does, and `next_steps`. |
| `PATCH /games/:slug` with `monthly_budget_cents` | A game's monthly budget: whole cents of at least 100, or `null` for no paid hosting (it pauses at its free hosting). `null` or lower works with a key that has `credit_access` `write`; a first or higher budget answers `confirmation_needed`. A budget under what credit already paid this month pauses the game at once; a higher one starts a game paused on its budget again. |

## Zaisma Pro

Zaisma Pro is $10 a month on your card, apart from hosting credit, for developers who ship a lot. It raises these limits (hosting stays on the meter and credit; Pro changes nothing inside games):

| | Free | Pro |
| --- | --- | --- |
| Large reviews a day | 5 | 20 |
| Small reviews a day | 30 | 100 |
| Performance checks a day | 20 | 60 |
| Versions a game a day | 20 | 100 |
| Biggest game | 2 GB | 10 GB |

Stats and scheduled releases are free for everyone. Seats come with Teams and custom domains with Custom game domains, so neither is part of Pro. You can cancel any time and keep Pro to the end of the paid month; then the free limits come back. A live version over 2 GB stays live, and only new uploads must fit. Versions waiting past a lowered daily review limit wait for the next free one. Pro ends at the end of the period Stripe says is paid, so a renewal Stripe retries keeps it until Stripe says it's over. Stripe sells it as the merchant of record, as it does credit. Teen developers buy Pro like anyone; whoever owns the card pays. These calls need `credit_access` (`read` for `GET /pro`, `write` for the rest); `GET /access` answers `plan` (`free` or `pro`).

| Call | What it does |
| --- | --- |
| `GET /pro` | Your plan: `{"pro": {"plan", "pro_ends_at", "is_pro_cancelled", "monthly_price_cents", "limits": {"free": {...}, "pro": {...}}, "used_today": {"large_review_count", "small_review_count", "performance_check_count"}}}`. `plan` is `free` or `pro`; `pro_ends_at` is when Pro ends or renews (`null` on free); `is_pro_cancelled` says it ends there instead of renewing. Each plan's limits are `{"maximum_large_review_count", "maximum_small_review_count", "maximum_performance_check_count", "maximum_version_count", "maximum_game_size_bytes"}`. |
| `POST /pro/checkout` | Start Pro. Answers `checkout_url`, Stripe's page where only you can pay, `expires_at` and `next_steps` (`get_pro` once you've paid). `already_pro` (409) while Stripe holds your Pro subscription, cancelled or not (`resume_pro` takes cancelling back). Up to 10 starts, cancels and resumes a minute. |
| `POST /pro/cancel` | Cancel at the end of the paid month. Answers the `pro` as `GET /pro` does, and `next_steps`. `not_pro` (409) when you have no Pro or it's already cancelled. |
| `POST /pro/resume` | Take cancelling back before it ends. Answers the `pro` as `GET /pro` does. `not_pro` (409) when you have no Pro or it isn't cancelled. |

## Players

A signed-in player plays as their Zaisma account in every game, with the same player ID (`player_…`) everywhere; anyone else is a guest with a new ID for each pass. Your game sees the ID in `room.players`, in `Zaisma.player.getPass()` and as the `sub` of the player pass your own server checks, with `kind` saying `account` or `guest`. Your server checks a pass with `verifyPass(pass, keys, { gameSlug })` from `@zaisma/game-server` (the keys at `https://rooms.zaisma.com/.well-known/jwks.json`; `issuerUrl` defaults to `https://rooms.zaisma.com`): a JWT with header `typ` `pass+jwt` and claim `pass_version_number` `1`, refused with a `PassError` whose `code` is `malformed`, `unknown_key` (fetch the keys again), `bad_signature`, `expired`, `wrong_game`, `wrong_issuer`, `wrong_kind` (a receipt, or another JWT) or `wrong_version`. `kind` and `who_can_chat` may gain values, so treat one you don't know as a guest and as `nobody`. An account's pass says who it can chat with (`who_can_chat`, and when `anyone` an opaque `chat_group_id`), its own opaque `player_tag_id` and its friends' and blocks' tags (`friend_player_tag_ids`, `block_player_tag_ids`), all different in every game. Zaisma never tells a game anyone's age; a game could guess which chat group is the younger one from its size.

| Call | What it does |
| --- | --- |
| `GET /players/:player_id` | An account's public profile, exactly what a stranger sees on zaisma.com/@username, never its email, age or other games' data: `{"player": {"id", "name", "username", "display_name", "bio", "link_urls", "profile_url", "is_profile_private", "published_games", "played_games", "playing_now"}}`. `name` is the name to show in games: the username, so nobody can pass as someone else. `username` is unique ignoring case and can change, so key your data by `id`. `display_name` and `bio` are what the player wrote, once Zaisma checked it (`null` when none). `link_urls` are links an adult chose to show. When `is_profile_private` is `true` (they show their profile to friends only), `bio` is `null` and the lists of links and played games are `[]`. `published_games` are the games they made that anyone can find, and `played_games` what they played lately when they show it to anyone, each with a `played_period` (`today`, `this_week`, `this_month`, `earlier`), never a time. `playing_now` is the game they're playing right now when they show that to anyone (`{ slug, title, page_url }`), else `null`, as for a game that isn't out yet. A guest's ID, or a deleted account's, is `no_player`. |

A player sits in one of your game's rooms at a time, as on Steam: joining another room closes their seat in the first (the room's players are told "Joined from somewhere else" with close code `4001`, and `onLeave` runs with reason `"left"`). Moves between your rooms (`room.moveTo`, `room.reserve`) and watching never close a seat. A game that keeps players in several rooms at once, like a hangout hub beside its matches, sets `maximumRoomCountPerPlayer` (an integer from 1 to 10, 1 by default; a join past it closes the oldest seat). `playing_now_player_count` (on `GET /games/:slug`) and the game page's playing count count each player once, however many rooms they sit in.

Games and servers get the same with no key at `GET https://rooms.zaisma.com/v1/players/<player_id>` (open to any site, up to 300 a minute per address, answers cacheable for 5 minutes), and in games with `Zaisma.player.getProfile(playerId)`. A player pass proves only who the player is: an account's carries no name, so your server looks the name up there (the Node game server does it for you). It also says who an account can chat with, never its age: `who_can_chat` (`nobody`, `friends`, `anyone`: the player's own setting) and, when `anyone`, an opaque `chat_group` (`chat_group_…`, different in every game); and its friends as opaque tags, never their player IDs: `player_tag` (its own, different in every game) and `friend_tag_ids` (its friends', up to 200). Your server asks `areFriends(first, second)` and `canChat(first, second)` from `@zaisma/game-server` with two checked passes, before passing chat between them. Inside games, `Zaisma.friends.list()` gives a signed-in player their friends playing this game, with their rooms (see "Friends in your game" in the README).

In games, `Zaisma.player.getPass()` gives this tab's player and their pass (`{ id, name, kind, pass, expiresAt }`) to send to your own server. `Zaisma.invite(room)` opens the game page's Share (the room's QR code, link and code), or on your own site the share sheet or a copied link; it works only right after the player taps or presses a key in the game, so call it from that tap's handler, and it fails with `error.code` `"needs_player_tap"` otherwise. It answers `"opened"`, or `"failed"` when the page couldn't open it. `Zaisma.openPlayersPanel(room)` opens the game bar's Players panel, where a player mutes, blocks and reports the others, so a Players button in your game does what the bar's does. The reference is `packages/sdk/zaisma.d.ts`, served beside the SDK as `_zaisma/v1.d.ts`.

### Chat filter

Every chat message to or from an under-18 account goes through Zaisma's chat filter, on Zaisma's side: it stops contact details in any disguise (numbers written as words or sent a few digits at a time, handles, links, "add me on…"), moving to another app or meeting up, personal details (where someone lives, their school, their full name, photos), slurs and sexual content. Swearing is your call: the filter flags it (`hasSwearing`) and lets it through. What the rules can't tell, and every message from an adult to a teen, also goes to a small AI model; a message it can't check is stopped (`unchecked`), never let through. The answer is one verdict for the whole message, never per receiver, so it never says which player is under 18. Between adults nothing is stopped yet: your game's switch for that comes with chat hosting in rooms. Every answer is `{ isAllowed, reason, message, hasSwearing }`: `reason` is `contact_details`, `personal_details`, `slur`, `sexual`, `chat_paused` (the sender's chat is paused or removed), `too_long` (over 2000 characters: checked whole, never cut), `not_allowed_to_chat` (own servers' `checkChat` only: `canChat` says no for a receiver) or `unchecked`, and `message` is the words to show the sender, which never mention age or the other player ("Contact details can't be sent here.").

- **In games:** `Zaisma.checkChat(text)` answers the same for up to 2000 characters (`too_long` past that), with the tidied `text`, so the sender sees why at once. It checks the text alone and keeps nothing; Zaisma checks again as the message is delivered.
- **On your own server:** `checkChat({ text, senderPass, receiverPasses })` from `@zaisma/game-server`, with the players' passes as your server received them, after `canChat`. It keeps each sender's last 5 messages from the last 2 minutes in memory and sends them along, and it answers `unchecked` when Zaisma can't be reached: don't deliver those. The whole message is checked, up to 2000 characters; a longer one answers `too_long`, never cut. Zaisma applies `canChat`'s rule itself too: if the sender may not chat with any receiver, it answers `not_allowed_to_chat`, one verdict for the message that never says which receiver. It's free. Underneath it's `POST https://rooms.zaisma.com/v1/chat/check` with `{ gameSlug, senderPass, receiverPasses, text, recentTexts }` (up to 50 receivers, 2000 characters, 5 recent texts), up to 120 a minute per game and sender; a pass that isn't valid for the game is `bad_pass` with its `field` (`senderPass` or `receiverPasses`).
- **In Zaisma rooms:** the room runs the filter itself on the chat it delivers, with Zaisma's chat hosting in rooms (coming). `checkChat` is for your own server only: a game server running in Zaisma rooms never sees passes, so there it throws a `ChatCheckError` with code `own_server_only`. Until chat hosting is out, check what a player types in the game with `Zaisma.checkChat`, or offer preset phrases and emotes.

Contact or personal details stopped toward under-18 accounts five times in a day pause the sender's chat for an hour; a sexual message from an adult to a teen pauses their chat while an AI reviews it. A paused account's next pass says `who_can_chat: "nobody"`, so `canChat` stops it on your server too. Zaisma keeps no chat, except that one kind of message, for review.

## Room connections

How a room and each player's game stay in touch, the same in Zaisma rooms and on your own server (the Node runner): how a dead connection is noticed, what happens to a player whose connection drops or who walks away, the limits on what players send, and why a connection closes.

### Staying connected

- **The SDK pings** the room every 25 seconds (the room answers without waking up), and reconnects by itself when a ping goes unanswered for 15 seconds, or in a real-time room (one with `ticksPerSec`) after 8 seconds without a word from the room, which probes every 2 seconds (not while the player is away or the game is hidden).
- **Reconnecting** waits half a second, then doubles each try up to 8 seconds, with no limit, and `room.connectionStatus` is `"reconnecting"` meanwhile. Your game keeps the same room object: the `players` event and your game server's messages carry on once it's back.
- **The room drops** a connection with no ping or message for 75 seconds (a closed laptop, lost signal): Zaisma rooms check every 30 seconds, the Node runner every 5. The SDK says goodbye as the page closes, so most players who leave do so at once.
- **`room.connectionStatus` is the socket only:** `"connecting"`, `"open"`, `"reconnecting"` or `"closed"`. Whether the player is in the match is `room.awayReason` (below), so a player who walked away with the socket still open stays `"open"`.
- **Sends wait while it's down:** reliable `room.send` and `room.sendBytes` calls made while `connectionStatus` isn't `"open"`, or while the player is away, are kept in order and go once the room lets them back in, before any latest-only sends that waited. Up to 60 wait (the room's burst, so the flush never trips `too_fast`); past that the oldest is dropped and the `error` event says `send_queue_full` once per outage. Both calls return `false` only once the room is gone (ended, kicked or left).

### Dropped players

A blip is the most common thing that goes wrong online, so a player whose connection drops stays in the match for a while instead of leaving it:

- **Away, reason `lost`:** the player stays in `room.players` for `reconnectTimeoutSec` (30 by default, 0 to 300). The game server's `onAway(state, player, room, { reason: "lost" })` runs if it has one, `room.awayReason(playerId)` answers `"lost"`, and every player's game sees `awayReason: "lost"` for them in `room.players` and the `players` event. They don't count as playing, nothing is sent to them, and their seat counts toward `maximumPlayerCount`. If they were the host, the next player is host until they're back.
- **Freeze them:** a game that does nothing shows them standing still. A real-time game can freeze their character, skip their turn or pause the match: in `onTick`, skip players whose `room.awayReason(playerId)` is `"lost"`, and in the game, draw them dimmed or "reconnecting" from `awayReason`.
- **Back in time:** the SDK reconnects by itself, `onBack(state, player, room)` runs (not `onJoin`, and `canJoin` isn't asked), and `awayReason` goes back to `null` for everyone. Send them the full state in `onBack`, since they missed what was sent meanwhile.
- **Not back in time:** they leave the match as before: `onLeave` with reason `lost`, and the room holds their seat for `seatHoldDurationSec`, so a later return gets `onJoin` with `joinInfo.isReturning`.
- **`reconnectTimeoutSec: 0`** takes a dropped player out of the match at once (`onLeave`, reason `lost`), as before this option.
- **`onAway` takes over idle and hidden too:** with `onAway`, a player who goes idle or hidden stays in the room until your game decides (below). To freeze dropped players while leaving idle and hidden ones to the room, read `room.awayReason` in `onTick` instead of adding `onAway`; `onBack` alone changes nothing else.

Real-time rooms notice a silent drop within seconds (their probes); turn-based rooms keep the slower 75-second check, so they can sleep between moves.

### Updates

A version you publish (or roll back to) reaches running matches at their next match, or now: `match_update_mode` `"next_match"` (the default) or `"now"` on `publish_version`, on `upload_files` and `POST /games/:slug/versions` with `publish_when_approved`, `zaisma publish --match-update-mode now`, or Update running games now on the dashboard.

- **Now, in a match:** every live room of the game hears it within seconds (a room that slept through it finds it within a minute of waking). Players' games get the room's `versionUpdate` event, `{ versionId, appliesAt, isReloading }`, to show a countdown or save. Without `onVersionUpdate`, the match switches 10 seconds later. With `onVersionUpdate(state, versionUpdate, room)`, the room waits for your game server: call `room.applyVersionUpdate()` at a good moment, like the end of a round, or it switches at `versionUpdate.appliesAt`, 5 minutes on.
- **The switch:** the room saves, its connections close with code `4004`, and the new version's game server starts from the saved state: `onRestored(state, restoreInfo, room)` runs with `restoreInfo.savedVersionId`, the version that saved it, so you can bring an older state up to date (or `room.end()` the match if you can't). When only the game server changed, players' games reconnect by themselves in a second or two. When the game's own files changed (`isReloading`), the game page reloads the game in place at the new version, with its save, and `Zaisma.joinRoom()` with no code brings the player back into the same room. Players come back as dropped players do (away, reason `lost`, for `reconnectTimeoutSec`, then a held seat), so a slow reload still finds its place. The game page's bar says Updating meanwhile; nothing covers the game.
- **Now, not in a match** (a single-player game, or a menu): never forced. The game page notices within 2 minutes. A game listening to `Zaisma.versions.on("update", (update) => …)` switches when it says, with `update.apply()` (at a checkpoint, back at its menu), and the page reloads it with its save; otherwise the bar beside the game shows Update, and the player taps it when they're ready, or gets the new version the next time they open the game.
- **Next match:** nothing changes for running matches: a room keeps the version it started on until its match ends.
- **A room on another version:** a player always plays the version their room runs. A Zaisma room whose game server runs another version than the player's game (an open tab from before a publish, or a friend's match still finishing on the version before) turns a newcomer away with `other_version`, and on the game's Zaisma page the game reloads at the room's version, with its save, and joins it; your game never sees it. While the room runs it, the game's address serves that version's files to the room's players, as long as it's one you could roll back to (the live version and the last 5 that passed), and not held or taken down. Players already in the room are never turned away this way, and rooms with a built-in game server have no version of their own. Outside Zaisma, through a tester link, or when that version is no longer kept, the join fails with `other_version`.
- **On your own server** `onVersionUpdate` never runs and `room.applyVersionUpdate()` does nothing: the game page still reloads players' games after a `now` publish when they're not in a match, and you restart your server to switch it (the Node runner brings its matches back, below).

### Restarts

Zaisma restarts its rooms whenever Zaisma itself is updated, and a match carries on:

- **Saved every few seconds:** a real-time room saves its game server's state every `stateSaveIntervalSec` (5 by default, 1 to 60), only when it changed, and once more when everyone walks away or leaves; a turn-based room saves after every change, as always. A state over 32 MB as JSON isn't saved: the game's logs say so once, and a restart starts that room fresh.
- **Back a few seconds behind:** the restarted room starts from the last save instead of `setup`; a real-time room (one with `ticksPerSec`) also runs `onRestored(state, restoreInfo, room)` once, and so does a turn-based room that had players in its match (it loses no moves, only the connections): `restoreInfo.savedAt` (an ISO time) and `restoreInfo.lostDurationSec`, the seconds of play since then that are lost. Use it to resync clocks or tell players.
- **Players come back as dropped players:** everyone who was in the match is away with reason `lost` (`room.awayReason` answers it in `onRestored`), `onAway` runs for each, and they have the whole `reconnectTimeoutSec` from the restart. Their connections drop (the Node runner closes them with code `1012` as it stops), the SDK reconnects to the same room by itself, and `onBack` runs for each one back; anyone who isn't leaves as `lost` (above).
- **A room that empties** keeps its saved state for a day, so players rejoining it find the match as it was (a real-time room's `onRestored` runs then too, with `lostDurationSec` 0: it saved as the last player left). A kept room keeps it until it ends (see Kept rooms below). A match that ends keeps nothing.
- **On your own server** the Node runner saves to its `--room-state-file` (`zaisma-room-states.sqlite`) the same way, and saves every room when it's stopped, so a clean restart loses nothing.

### Walking away

Players who walk away stop holding seats and running matches, with no code:

- **Idle:** after `idleTimeoutSec` without input (600 by default, 30 to 86400), the SDK asks "Still there?" for 30 seconds; no answer, and they walk away (`idleCheck`: `"server"`, the default, `"client"` or `"off"`).
- **Hidden:** in a real-time room, a game hidden for 2 minutes counts as away.
- **What happens:** with `awayMode: "hold"` (the default), they leave the match (`onLeave`, reason `idle` or `hidden`) and the room holds their seat for `seatHoldDurationSec` (300 by default, up to 1800, 0 for none); any input brings them back, and `onJoin` gets `joinInfo.isReturning`. `awayMode: "lobby"` sends them to the room that made this one (`room.reserve`). With `onAway`, they stay in the room and your game decides: kick them, move them or keep them.
- **In the game:** the `idle` event hands `{ idleStatus, answerTimeoutSec }`: `"asking"` when it's time to ask (listening replaces Zaisma's "Still there?" plate), then `"answered"` on input or `"timed_out"` as the room hears they walked away. The `away` event hands `{ awayReason, seatHoldDurationSec }` and `room.awayReason` says `"idle"` or `"hidden"` until they're back. The `back` event hands `{ roomCode, isSeatHeld, rejoin() }`: `isSeatHeld: true` once the room let them back into their held seat; `false` on their first input after the seat ran out, when listening for `back` leaves rejoining to your game (`back.rejoin()`), and without a listener the SDK rejoins by itself.

### Message limits

- **From each player:** up to 16 KB a message (or bytes), and 30 a second with a burst of 60. The SDK throws `too_big` before sending one over 16 KB; past the rate, that message is refused with an `error` event (`too_fast`) and the connection stays open.
- **Who sent it:** a message or bytes the game server passes on from one player carries `fromPlayerId` (its send options' `fromPlayerId`; the relay always sets it), and the game's `message` event hands `(message, fromPlayerId)`, `bytes` hands `(bytes, fromPlayerId)`, with `null` for the game server's own.
- **Join and setup data:** up to 4 KB of JSON (`joinData`, `setupData`).
- **From the room:** what your game server sends isn't capped, but a player who can't keep up is dropped (below).

### Ping and the room's clock

- **Ping:** the game server reads a player's round trip with `room.pingDurationMs(playerId)`, and the player's game reads its own with `room.pingDurationMs`: the same number, in milliseconds, smoothed so one slow packet doesn't make it jump. It's `null` until the first measurement, right after the player joins.
- **Measured by the room:** the room sends each player a small probe right after they join, every 2 seconds while a real-time room ticks (turn-based rooms keep sleeping between moves), and whenever 256 KB has gone out to them; the SDK answers it at once. Answers aren't game messages: they don't count toward a player's 30 a second, your message stats or the idle check. Since the room measures it, a player can only make their ping look worse by answering late, never better, so cap any lag compensation that uses it.
- **One clock:** `room.serverTimeMs()` is the room's clock now, in epoch milliseconds, on the game server (like `Date.now()`) and in every player's game, where the SDK estimates it from the probes. A time the game server sends means the same moment for everyone, like `{ startsAtMs: room.serverTimeMs() + 3000 }` for a countdown.

### Slow connections

A player whose connection can't keep up is dropped before the room has to hold a growing backlog for them: when a probe has gone unanswered for 8 seconds, or 2 MB has gone out to them since the last probe they answered. Their connection closes with code `4003` and they become a dropped player (above): away with reason `lost` for `reconnectTimeoutSec`, while the SDK reconnects by itself, so they come back caught up. Send a returning player the full state in `onBack`, and in `onJoin` when `joinInfo.isReturning`, not just what changed (state sync does it by itself). A room's memory for its players stays bounded, and one bad connection can't stall a match for everyone else.

Before that, a connection can be **backed up**: 64 KB or more sent to it and not through yet. On your own server, that's the socket's `bufferedAmount`; in Zaisma rooms, 64 KB or more sent since the last probe the player answered, while a probe of theirs is 250 ms later than their ping. State sync skips a backed-up player and latest-only messages wait for them (below), so a slow player never builds a queue of stale updates.

### State sync

An optional building block for real-time worlds, the same in Zaisma rooms and on your own server: your game server keeps its state as a plain object, and with `stateSyncEnabled: true` each player's game gets it without your code sending anything.

- **A full copy, then what changed:** a player gets their whole view as they join (and after reconnecting), then, after each tick (or each handler, in a turn-based game), only what changed since their last: `{ type: "state", serverTimeMs, full }`, then `{ type: "state", serverTimeMs, changes }`. Each change is `[path, value]` (set) or `[path]` (remove), with `path` the keys and indexes from the top: objects by key, arrays by index while their length stays the same and whole when it changes. `serverTimeMs` is the room's clock as it was sent. Nothing goes out when nothing a player sees changed.
- **Each player's view:** `stateView(state, viewer, room)` answers what `viewer` sees, like only what's near them in a big world or without the other team's hand; without it, everyone sees the whole state. It runs for every player on every tick, so keep it cheap, and it only answers: a call in it that changes the room or sends (`room.broadcast`, `room.kick`, `room.end`, ...) throws `room_call_unavailable`, which the game's logs show; reading (`room.players`, `room.roomCode`) works. A view over 1 MB as JSON isn't sent, and the game's logs say so once.
- **In the game:** `room.state` is this player's view (null until the first update), the `"state"` event hands `(state, changes)` (`changes` null after a full copy), and `room.smoothedState({ delayMs })` answers the state `delayMs` (100 by default, up to 1000) behind the room's clock, between the two updates around then: numbers blended in a straight line (integers in between come back as fractions, and an angle that wraps blends the long way), anything else as the older one had it. Predicting the player's own moves stays your game's.
- **Backed up:** a player whose connection is backed up gets nothing until they've caught up, then a full copy, so a slow spell costs one copy instead of a growing queue. There are no acknowledgements: over the room's connection a change can't be lost.
- **Where it runs:** where the state is, in your game server's sandbox on Zaisma (its time counts as the game server's CPU) and in the room on your own server. The state goes as JSON, so keep it plain; its updates count as `(state)` in `get_stats`.

### Latest-only messages

`room.broadcast`, `room.send`, `room.broadcastBytes` and `room.sendBytes` on the game server, and `room.send` and `room.sendBytes` in the game, take `{ delivery, latestKey }`:

- **`delivery: "reliable"`** (the default) reaches every player, in order.
- **`delivery: "latest_only"`** may be dropped: while a player's connection is backed up, a newer latest-only message with the same `latestKey` replaces the one waiting, and the newest goes once they catch up (oldest key first, before anything newer). For positions sent every tick, or where a player aims. A player keeps up to 64 waiting, one per key; past it, the least recently replaced is dropped.
- **`latestKey`**, up to 40 characters, says which messages replace each other, like `"position"`, and `latest_only` needs one: without it the send throws: in the game (the SDK) the error's code is `bad_send_option`, and on the game server it is a `GameServerError` with the code `bad_room_call` and the room call (like `room.broadcast`) as its field. Bytes have their own keys.
- **Zaisma rooms carry them over the WebSocket today**, since Cloudflare doesn't yet let Workers take WebTransport or WebRTC data channels; the same `delivery: "latest_only"` moves to real datagrams once it does, with no change to your game. Anything else for `delivery` or `latestKey` throws in your code, naming what to give: the SDK's error has the code `bad_send_option`; the game server's is a `GameServerError` (`bad_room_call`) saying the same.

### Room error codes

A room answers a refusal with `{ type: "error", code, message }`, then closes the connection (`4001`, or `1013` for `busy`); a message it can't take gets the same `error` and the connection stays open. In the SDK they are `error.code` and the `error` event.

| Code | Meaning |
| --- | --- |
| `room_full` | The room has no space for another player. |
| `room_closed` | The room isn't taking new players (`room.setOpen(false)`). |
| `ended` | The match is over. |
| `too_big` | A message over 16 KB, or `joinData` over 4 KB. |
| `too_fast` | More messages than the room takes (30 a second, burst of 60). |
| `bad_message` | A message the room couldn't read or use. |
| `bad_pass` | The player pass wasn't accepted; the SDK gets a new one and tries once more. |
| `no_hello` | The first message wasn't a hello with a player pass. |
| `not_allowed` | Only the game server or the room's host can do that. |
| `game_unavailable` | The game can't be played right now. |
| `busy` | The room couldn't take the player right now; the SDK tries again soon. |
| `kept_out` | The player was removed for the rest of the match. |
| `refused` | The game server's `canJoin` turned the player away. |
| `room_not_running` | The room isn't running, like one with nobody playing to watch. |
| `hosting_paused` | The game's hosting is paused this month; new rooms open again when it resets or its developer adds credit. |
| `account_needed` | The game needs a Zaisma account for multiplayer, and the player is a guest. |
| `game_not_open_to_player` | The account is younger than the game's minimum age. |
| `blocked_player_here` | Someone the player blocked is in the room; `quickJoin` tries other rooms first. |
| `other_version` | The room runs another version of the game (see Updates above). |
| `spectators_full` | The room takes no more spectators. |
| `spectator_cannot_send` | A spectator tried to send to the room. |
| `already_playing` | A player in the room tried to watch it too. |
| `bad_origin` | The connection didn't come from the game's own page. |
| `send_queue_full` | The SDK's own: more than 60 sends waited while it reconnected, so the oldest were dropped. |
| `bad_region` | The SDK's own: a `region` that isn't a continent code (`"AF"`, `"AN"`, `"AS"`, `"EU"`, `"NA"`, `"OC"` or `"SA"`). |
| `bad_idle_timeout` | The SDK's own: an `idleTimeoutSec` that isn't from 30 to 86400. |
| `zaisma_rooms_not_used` | The SDK's own: the game doesn't use Zaisma rooms, so there are none to join or list. |

### Close codes

| Code | Why | What the SDK does |
| --- | --- | --- |
| `4000` | The match ended (`room.end`, or Zaisma ending it) | Stops: `connectionStatus` `"closed"`, after the `ended` event with its `endReason` |
| `4001` | The room refused the player (an `error` with the code comes first, like `room_full`, `bad_origin` or `game_unavailable`), removed them (`room.kick`), or they joined from another tab | Stops: `connectionStatus` `"closed"` |
| `4002` | The seat held for a player who walked away ran out | `connectionStatus` `"closed"`; waits for the player to come back, then the `back` event with `isSeatHeld: false` |
| `4003` | The connection stopped answering probes or fell too far behind | Reconnects by itself, as a dropped player |
| `4004` | The match switched to a version published `"now"` | Reconnects by itself, or the page reloads the game at the new version (`isReloading`) |
| `1012` | The Node runner is restarting | Reconnects by itself, as a dropped player |
| `1013` | Zaisma rooms are busy (an `error` with `busy` comes first) | Reconnects by itself, waiting longer each try |

Any other close (a network drop) reconnects by itself too.

### Room events

Every event the game's room object has, and what its listener gets. Within v1, events and error codes only grow, so keep a `default` for ones you don't know.

| Event | Listener gets |
| --- | --- |
| `message` | `(message, fromPlayerId)` |
| `bytes` | `(bytes, fromPlayerId)` |
| `state` | `(state, changes)` |
| `players` | `(players)`, each `{ id, name, kind, awayReason }` |
| `connectionStatus` | `(connectionStatus)` |
| `settings` | `{ isListed, isOpen, friendJoinsEnabled, name, labels, spectatorCount }` |
| `ended` | `{ message, endReason }`: `game`, `no_players`, `hosting_paused`, `kept_room_deleted`, `game_unavailable` or `game_server_stopped` |
| `ending` | `{ endsAt }` |
| `kicked` | `{ message, isKeptOut }` |
| `move` | `{ roomCode, follow(), join(joinOptions) }` |
| `moved` | `{ roomCode, fromRoomCode }` |
| `idle` | `{ idleStatus, answerTimeoutSec }` |
| `away` | `{ awayReason, seatHoldDurationSec }` |
| `back` | `{ roomCode, isSeatHeld, rejoin() }` |
| `muted` | `(playerIds)` |
| `error` | `{ code, message }` |
| `versionUpdate` | `{ versionId, appliesAt, isReloading }` |

The SDK and rooms say which messages they speak with `protocolVersionNumber` (1 today): the SDK sends it in its hello, and the welcome answers the room's. A room skips a message type it doesn't know, so a newer SDK still plays in an older room.

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
- **is_on_game_page:** the game page shows it too, as a button under the game's details in its site's own look (Steam, itch.io, Discord, YouTube, X, Bluesky, Reddit, TikTok, Instagram, Patreon, Ko-fi, GitHub, Kickstarter, the App Store, Google Play, Twitch and Gumroad; any other site shows its address). A Steam store page says "Wishlist on Steam". It shows only to players it opens for (`who_can_open`), and goes straight to the site.
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

## Items and purchases

What a game sells or grants, kept by Zaisma under names the game picks, and every purchase and grant of them with a signed receipt. Zaisma takes no cut: the price a game shows is what the player pays, tax included, and players buy through Zaisma's buy sheet, paying the developer's own Stripe account (see Selling with the buy sheet). Grants need no Stripe account, so a game can try owned items, receipts and passes before one is connected.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/items` | The game's `items` by `item_name`, its `refund_policy`, `refund_policy_text`, `own_payment_categories` and `purchase_delivery`, and the `purchase_label` they make. |
| `PUT /games/:slug/items/:item_name` | Make or replace one item, whole: `{"title", "description", "item_kind", "item_category", "price_minor_units", "currency_code", "local_prices"}`, every key every time. Answers the `item` (201 when it's new) and `next_steps`. |
| `DELETE /games/:slug/items/:item_name` | Remove one nobody bought or was granted. Answers `removed_item_name` and `next_steps`. |
| `PATCH /games/:slug/purchase-settings` | `refund_policy`, `refund_policy_text`, `own_payment_categories` and `purchase_delivery` (`game`, `game_server` or `own_server`: where the game's purchases are delivered, see Getting purchases to your game); leave out what stays. Answers them with the `purchase_label` and `next_steps`. `no_game_server` for `game_server` on a game with no game server. |
| `POST /games/:slug/purchases` | Grant an item: `{"player_id", "item_name", "item_count", "game_account_id"}`. Answers the `purchase` with its `receipt`, `is_already_owned` and `next_steps`. |
| `GET /games/:slug/purchases` | Purchases and grants, newest first, 100 at a time (`next_cursor`), each with its `receipt`; filter with `player_id`, `item_name`, `purchase_source` and `purchase_status`. |
| `GET /games/:slug/purchases/:purchase_id` | One `purchase`, with its `receipt`. |
| `POST /games/:slug/purchases/:purchase_id/refund` | Take a grant back, or refund a sale (`purchase_status` `refunded`). A sale refunds through the developer's Stripe account: the rest of it by default, or `{"amount_minor_units"}` of it (see Selling with the buy sheet). |
| `POST /games/:slug/purchases/:purchase_id/handled` | Say your own server took a purchase (`purchase_delivery` `own_server`): a `completed` one gets `handled_at`, a `refunded` or `charged_back` one `refund_handled_at`. Answers the `purchase`. `already_handled` when it was; `no_purchase` for one that is `pending` or `failed`. |
| `GET /games/:slug/players/:player_id/items` | The permanent items a player owns in the game, and their purchases still to hand over: `{"player_id", "owned_item_names", "unhandled_purchases"}`. `owned_item_names` is what their next pass lists; `unhandled_purchases` are their `completed` purchases not yet handled, and ones refunded or charged back after being handled whose refund isn't told yet, each with its `receipt`, oldest first, at most 50 purchases and 50 refunds. |

- **An item** is `permanent` (owned for good, on every device: a skin, an expansion) or `consumable` (delivered once, then the game keeps count: a revive, coins), and says what it is with `item_category`: `cosmetic` (only how things look), `gameplay` (helps you play), `content` (more of the game) or `currency` (in-game money). Its `item_name` is 1 to 40 lowercase letters, digits, underscores and hyphens; `title` up to 60 characters and `description` up to 300. Up to 1,000 a game.
- **Prices** are in the currency's smallest unit (`price_minor_units`: 199 for $1.99, 300 for ¥300), in a `currency_code` written lowercase as Stripe writes it (`usd`, `eur`, `brl`), at least Stripe's minimum for that currency (50 cents; `price_too_low` under it). `local_prices` sets the price in up to 40 other currencies, as `[{"currency_code", "price_minor_units"}]`: a player pays in their country's currency when the game set one, else the main price. Prices pick by country, never by browser language. Under 2 dollars, euros, pounds or Canadian or Australian dollars, `card_fee_note` says about how much reaches you after card fees. `price_minor_units` and `currency_code` `null`: an item that's only granted, or no longer sold.
- **The refund policy** comes first: a game states one before anything goes on sale (`refund_policy_needed`). `no_refunds`, `unused_within_14_days`, `within_14_days`, or `own_words` with the policy in `refund_policy_text` (up to 600 characters, no links or contact details).
- **The label** (`purchase_label`, on the game too) is what the game page says the game sells: the categories of its items with a price, plus what it sells through its own payments (`own_payment_categories`, with `has_own_payments`). It comes from the items, so it can't drift; a grant-only item isn't in it.
- **A purchase** is `{"id", "item_name", "item_kind", "item_count", "purchase_source", "purchase_status", "player_id", "game_account_id", "paid_minor_units", "currency_code", "refunded_minor_units", "purchased_at", "refunded_at", "handled_at", "refund_handled_at", "receipt"}`. `purchase_source` is `sale` or `grant`; `purchase_status` `pending`, `completed`, `failed`, `refunded` or `charged_back`. `paid_minor_units` is what the whole purchase paid, in `currency_code` (`null` for a grant), apart from the item's price. A deleted game's purchases stay in its players' history, and their Download your data, under the game's name. `game_account_id` is your game's own ID for the player's account in your system, given back as you sent it. `refunded_at` is when the item was taken back, a full refund or a chargeback, and `null` otherwise: a partial refund shows only in `refunded_minor_units` and leaves the item owned, so test `purchase_status` for what the player owns. `handled_at` is when the game, its game server or your own server took the purchase (`purchase_delivery`), and `refund_handled_at` when it was told the purchase was refunded or charged back; `null` until then, and `refund_handled_at` for a purchase never refunded.
- **Grants** go to accounts (guests' player IDs last only for their pass: `no_player`). A permanent item a player already owns answers the purchase that owns it with `is_already_owned: true`, also when two grants of it arrive at once; a consumable is granted as many times as asked, `item_count` up to 1,000 each.
- **Receipts** are JWTs with their own signing key, published at their own address (`https://rooms.zaisma.com/.well-known/receipt-jwks.json`), apart from the pass key at `/.well-known/jwks.json`, and kept there for good, so a receipt never expires and a receipt key can never sign a pass. A game server checks one in one call, with no keys to fetch: `await room.verifyReceipt(receipt)` in a room, or `await server.verifyReceipt(receipt)` in `onRequest`, `onSchedule` and `onWebhook`, the same in Zaisma rooms and on your own server. It answers the claims or throws an error whose `name` is `"ReceiptError"` and whose `code` says why (check `error.name`, not `instanceof`: in Zaisma rooms it isn't your copy's class): `malformed`, `unknown_key`, `bad_signature`, `expired`, `wrong_game`, `wrong_issuer`, `wrong_kind` (a pass) or `wrong_version`. Any other error means the check couldn't run just now (keys that didn't load, a time-out): try again later rather than refusing the purchase. Elsewhere, `verifyReceipt(receipt, keys, { gameSlug })` from `@zaisma/game-server` does the same with the receipt JWKS's keys (`issuerUrl` defaults to `RECEIPT_ISSUER_URL`, `https://rooms.zaisma.com/receipts`). The Node runner fetches them by itself (`--receipt-jwks` points it elsewhere). A receipt can't pass for a pass: its header says `typ` `receipt+jwt` and its issuer is `https://rooms.zaisma.com/receipts`, so `verifyPass` and any JWT library checking the pass issuer refuse it. Its claims: `receipt_version_number` (1), `purchase_id` (`jti` too), `purchased_at`, `purchase_status`, `sub` (the player), `aud` (the game), `item_name`, `item_kind`, `item_count`, `purchase_source`, `paid_minor_units`, `currency_code`, `game_account_id` and `iat` (when it was signed). Each read signs it again with the purchase's current `purchase_status`, so one fetched after a refund says `refunded` or `charged_back`: deliver only on `completed`, once per `purchase_id`, and never compare receipt strings. New `item_kind`, `purchase_source` and `purchase_status` values and new claims may come within version 1; skip what you don't handle.
- **Owned items in the pass:** an account's pass lists the permanent items it owns in the game as `owned_item_names` (`[]` for guests and when it owns none), so a game server sees them on connect without calling Zaisma: `player.ownedItemNames`, the same in Zaisma rooms and on your own server, left out when the player owns none (read it as `player.ownedItemNames ?? []`). Players' games never see what other players own. In the game, `Zaisma.items.owns(item_name)`, `Zaisma.items.owned()` and `Zaisma.items.list()` (the items for sale at the price this player pays, with `priceText`).
- **Nothing sold is random,** and real prices show beside coin prices: the review holds a version that sells paid random rewards (`ai_paid_random_rewards`) or prices bought coins with no real price beside them (`ai_coin_price_without_real_price`), under the content rule `purchases`.
- A key reads items and purchases with `purchase_access` `read` (read, upload and publish keys) and changes them with `write` (full keys).

### Getting purchases to your game

Every purchase and grant reaches the game exactly once, wherever the player buys: the buy sheet, `grant_item`, or a refund. `purchase_delivery` in the purchase settings (`PATCH /games/:slug/purchase-settings`, MCP `set_purchase_settings`) says where, and each purchase carries `handled_at` once it was taken (and `refund_handled_at` once a refund was told). A refund is delivered only for a purchase that was handled first. Whatever the delivery, every purchase and refund also goes to your webhooks as `purchase_completed` and `purchase_refunded` (see Webhooks), with the `purchase`, its `receipt` and its `game_account_id`.

| `purchase_delivery` | Who takes the purchase | Who marks it handled |
| --- | --- | --- |
| `game` (the default) | The game itself, in the player's browser: `Zaisma.items.on("purchase")` and `on("refund")`. For a game with no server. | The game, with `Zaisma.items.markHandled(purchase.id)`. |
| `game_server` | The game server's `onPurchase` and `onRefund`, in the room the player is in. For a game whose rooms keep the inventory. | The room, when the hook returns. |
| `own_server` | Your own backend, from the receipt the game sends it. For a game whose own accounts hold what players own. | Your backend, with `POST /games/:slug/purchases/:purchase_id/handled` (MCP `mark_purchase_handled`). |

**`game`.** Once the game listens, the SDK fires `purchase` for each completed purchase not yet handled and `refund` for each one taken back after it was handled, and fires again after each new purchase. The game marks it handled first, then hands it over: a second tab or device that has the game open gets `already_handled` and skips it, so it's handed over once. `Zaisma.items.unhandled()` lists the waiting ones, oldest first, at most 50 purchases and 50 refunds at a time (`[]` for guests, who buy nothing).

```js
Zaisma.items.on("purchase", async (purchase) => {
  await Zaisma.items.markHandled(purchase.id); // already_handled: another tab took it, so this one skips it
  if (purchase.itemName === "revive") addRevives(purchase.itemCount);
});
Zaisma.items.on("refund", async (purchase) => {
  await Zaisma.items.markHandled(purchase.id);
  if (purchase.itemName === "revive") removeRevives(purchase.itemCount);
});
```

`markHandled` fails with `bad_purchase_id`, `no_purchase` (not this player's, or not paid), `already_handled` (another tab or device took it first: don't hand it over twice), `handled_by_server` (the delivery isn't `game`) and `slow_down`.

**`game_server`.** The game server's `onPurchase(state, player, room, purchase)` and `onRefund(state, player, room, purchase)` run in the room the player is in: on every join, and right after a purchase (the game's SDK tells the player's rooms to look). `purchase` is the purchase in camelCase (`id`, `itemName`, `itemKind`, `itemCount`, `purchaseSource`, `purchaseStatus`, `gameAccountId`, `paidMinorUnits`, `currencyCode`, `purchasedAt`, `refundedAt`, `receipt`). The purchase is marked handled when the hook returns, and when it throws it isn't: the error shows with the game server's others in the stats, and it comes again at the player's next join. A room that has neither hook takes no purchases. Guests own nothing, so they get none. `game_server` on a game with no game server answers `no_game_server`.

```js
// zaisma-server.js: revives are kept in the player's state
export default {
  onPurchase(state, player, room, purchase) {
    if (purchase.itemName !== "revive") return;
    state.players[player.id].reviveCount += purchase.itemCount;
  },
  onRefund(state, player, room, purchase) {
    if (purchase.itemName !== "revive") return;
    const kept = state.players[player.id];
    kept.reviveCount = Math.max(0, kept.reviveCount - purchase.itemCount);
  },
};
```

On your own server, the Node runner runs the same hooks. It needs `ZAISMA_KEY` set to an API key with `purchase_access` `write` for the game (or `zaismaKey` in `startServer`), and doesn't start without it when the game server has `onPurchase` or `onRefund`: it reads each player's `unhandled_purchases` and marks them handled through the developer API, so a purchase comes once across restarts and Zaisma's own rooms. It only takes purchases while the game's `purchase_delivery` is `game_server`. A message from a game telling it to look (`zaisma:purchase`) must carry the purchase's `receipt`, which the runner checks first.

**`own_server`.** The game sends your backend the `receipt` of a purchase (from `Zaisma.items.unhandled()`; your backend also gets it from the `purchase_completed` webhook), and your backend checks it with `verifyReceipt` (see Receipts above), credits the account named in `game_account_id` once per `purchase_id`, and calls `mark_purchase_handled`. A refunded or charged-back purchase is told the same way once your backend has taken back what it should (`refund_handled_at`). The webhook events carry `game_account_id` for games with their own accounts, so your backend can credit them even when no game is open. `GET /games/:slug/players/:player_id/items` lists what's still waiting.

## Selling with the buy sheet

Players buy a game's priced items through Zaisma's buy sheet. The developer connects their own Stripe account (Stripe Connect Standard): they are the seller, every sale is a direct charge on their account, the money goes to them, and Zaisma takes no fee. Stripe's own fees apply. The sheet and the receipt show the account's `business_name` and `support_email`. Until an account is connected and can take payments, the sheet answers `stripe_not_connected` or `stripe_cannot_take_payments`, and setting a price answers `next_steps` pointing at `get_stripe_account`.

**Connecting needs the developer.** It decides where players' money goes, so it needs their passkey on zaisma.com. Through a key or a connected app, `POST /stripe-account/connection-links` answers `confirmation_needed` (403) with `confirm_url`, the payments settings, where they connect with their passkey. From the dashboard's own signed-in session, with the passkey tapped in the last 10 minutes, it answers a `connect_url`. These calls need `stripe_account_access` (see What a key can do). Disconnecting and Stripe Tax need no passkey, since they only stop sales or change tax.

| Call | What it does |
| --- | --- |
| `GET /stripe-account` | The connection: `{"stripe_account": {"is_connected", "stripe_account_id", "can_take_payments", "country_code", "default_currency_code", "business_name", "support_email", "is_stripe_tax_used", "connected_at"}}`. With nothing connected, `is_connected`, `can_take_payments` and `is_stripe_tax_used` are `false` and the rest `null`. `can_take_payments` is whether Stripe lets the account take payments now; a new account may need details on Stripe first. Needs `stripe_account_access` `read`. |
| `POST /stripe-account/connection-links` | Ask for the link to connect or make a Stripe account on: answers `connect_url`, `expires_at` (10 minutes) and `next_steps` (`get_stripe_account` once they have), with 201. The link works only for this developer signed in on zaisma.com. A key or connected app answers `confirmation_needed`, as above. |
| `PATCH /stripe-account` | `{"is_stripe_tax_used"}`, true or false (`bad_is_stripe_tax_used`). Answers the `stripe_account` and `next_steps`. `stripe_not_connected` with no account. |
| `DELETE /stripe-account` | Disconnect: players can't buy priced items until an account is connected again. Answers the empty `stripe_account` (`is_connected` false) and `next_steps`. Sales so far stay, and refunding them goes through the Stripe dashboard. `stripe_not_connected` with no account. |

- **Where Stripe comes back to.** `GET /stripe/connect-return` is a page route, not part of the API: after Stripe, it goes back to the payments settings on zaisma.com with `?stripe=` `connected`, `cancelled`, `link_expired`, `signed_out` or `account_taken` (the Stripe account is already connected to another Zaisma account). A new connection starts with Stripe Tax off.
- **Stripe Tax.** `is_stripe_tax_used: true` has Stripe Tax work out the tax inside each price for the player's country and record it on the developer's Stripe account (Stripe Tax must be set up there). Prices never change with it: the price a game shows stays what the player pays.
- **Stripe's events.** Stripe tells Zaisma what happens on connected accounts at `POST /stripe/connect-events`, checked by Stripe's signature before anything is read. A payment that succeeded completes the purchase and one that failed fails it. A refund on Stripe's side (the dashboard or this API) records `refunded_minor_units`, and a refund of all of it takes the item back. A lost dispute takes the item back too (`purchase_status` `charged_back`); an open or won one changes nothing. `account.updated` refreshes the connection, and Zaisma being disconnected on Stripe's side forgets it, as `DELETE /stripe-account` does. Each is handled once, however often Stripe sends it.

**In the game**, `Zaisma.items.buy(itemName, { itemCount, gameAccountId })`: on the game's zaisma.com page the sheet slides up over the game, which keeps running; on the developer's own site a zaisma.com window opens. `itemCount` is how many of a consumable (1 unless said; always 1 for a permanent item) and `gameAccountId` is the game's own ID for the player, kept on the purchase and its receipt. It resolves with `{ status, purchase }`, `purchase` in the SDK's camelCase `Purchase` (`id`, `itemName`, `itemCount`, `purchaseStatus`, `paidMinorUnits`, `receipt` and the rest, as the `purchase` event hands it over), or `null`:

- `bought`: the player paid. `purchase` has its `receipt` (pass it to your game server to check, see Receipts above). The player's next pass lists the item at once, so `Zaisma.items.owns` says so right away.
- `cancelled`: nothing was charged. The player closed the sheet or the window before paying, or already owned the item (a permanent one), so there was nothing to buy. `purchase` is `null`. `Zaisma.items.owns` tells the two apart.
- `failed`: the payment didn't go through, or it was still settling when the sheet closed (a bank's confirmation, Apple Pay, Google Pay). `purchase` is the purchase when there is one (`purchaseStatus` `pending` or `failed`, `receipt` empty), else `null`. A payment still settling can complete later: then the item arrives as any purchase does, and the `purchase` event fires, so don't treat a `pending` one as final.

Every player outcome resolves; only the developer's mistakes reject, with an error whose `code` is `needs_player_tap`, `bad_item_name` (itemName isn't an item name), `no_item` (the game has no item by that name), `no_game` (the game isn't open to play here), `not_for_sale`, `stripe_not_connected`, `stripe_cannot_take_payments`, `bad_item_count`, `bad_game_account_id`, `unknown_option`, `not_on_zaisma` or `request_failed`.

- **The tap rule.** The sheet opens only right after the player taps or presses a key in the game, so call `buy` from that handler. Otherwise it fails with `needs_player_tap`, and nothing opens by itself.
- **On your own site.** The window is `zaisma.com/buy/<slug>/<item_name>`. It answers your page only if the page's address is one Zaisma knows is yours: the host of one of the game's `own_server_urls` on https (a `wss://` address counts as https), or a redirect address of one of your sign-in apps. Any other opener hears nothing, so `buy` waits until the player closes the window and then resolves `cancelled`, even if the purchase went through. The purchase still completes either way, and the game sees it in its next pass and in the `purchase` event.
- **The EU line.** Players in the EU, the EEA and the UK see "You get it now, so you can't cancel it in the next 14 days." above Buy, because digital content delivered at once loses the 14-day withdrawal right only if the buyer is told before they buy. The receipt email repeats it.
- **Buy waits a moment.** Buy can't be pressed for a fraction of a second after the sheet draws it, so a tap meant for the game can't land on it.
- **Events.** `Zaisma.items.on("sheetOpen", listener)` runs when the sheet opens and `"sheetClose"` when it closes, bought or not, each with `{ itemName }`; `off` stops listening. A game can pause on `sheetOpen`, since it keeps running behind the sheet. A bought item reaches the game as Getting purchases to your game says: `Zaisma.items.on("purchase")`, the game server's `onPurchase`, or your own server.
- **Local prices.** The sheet shows the price the player's country pays: the item's `local_prices` entry for its currency when the game set one, else the main price (see Items and purchases above). Prices pick by country, never by browser language.
- **Refunds.** `refund_purchase` (`POST /games/:slug/purchases/:purchase_id/refund`) refunds a sale through the developer's Stripe account. By default it refunds all of what's left; with `amount_minor_units`, in the sale's `currency_code` (499 is 4.99), only that much goes back. A full refund takes the item back (`purchase_status` `refunded`), so the player no longer owns it from their next pass. A partial refund leaves it with the player and adds to `refunded_minor_units`. `bad_amount_minor_units` when the amount isn't a whole number from 1 to what's left; `purchase_not_paid` for a sale that is pending or failed; `already_refunded` for one refunded or charged back; a grant takes no amount. After the Stripe account is disconnected (or replaced), `stripe_not_connected`: refund the sale in the Stripe dashboard, and the item goes back once Stripe tells Zaisma, if an account is connected then.

## Kept rooms

Rooms a game server keeps with `room.setKept(true)`, for worlds that last, like a survival server: when everyone leaves, a kept room sleeps with its world saved instead of ending, costs nothing while it sleeps, and wakes as it was when someone joins. A listed one stays on the game page's Rooms tab with nobody in it. See "Lobbies and matches" in the README.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/kept-rooms` | The game's `kept_rooms`, most recently played first, each `{"room_code", "name", "saved_size_bytes", "saved_at", "last_played_at", "created_at"}`; and `kept_rooms_size_bytes`, `storage_size_bytes` (the database and kept rooms together) and `maximum_storage_size_bytes` (10 GB, the most a game can keep). |
| `DELETE /games/:slug/kept-rooms/:room_code` | Delete one's world for good: players in it are sent out ("This world was deleted."). Answers `is_deleted` and `next_steps`. An unknown code is `no_kept_room`. Not for ending a match: the game server does that with `room.end()`. |

- **Storage:** saved worlds count toward the game's storage with its database, on the game's hosting meter (see Hosting and credit), up to 10 GB. A kept room writes its size as it empties and at most hourly while players are in it, so the total is close, not exact. At 10 GB, `room.setKept(true)` leaves the room unkept and the game server's log says why, and the database can't grow (`database_full`), but rooms already kept keep saving: no world is lost to the limit.
- **Waking:** a world waking runs `onRestored` with `restoreInfo.lostDurationSec` 0, since it saved as the last player left, and `restoreInfo.savedAt`, for the time that passed. It wakes on the game's live version; `restoreInfo.savedVersionId` says which version saved it, so you can bring an older world up to date.
- **When the game is unavailable** (taken down, made private): players in a kept room are sent out and it sleeps, kept. Deleting the game deletes its kept rooms.
- **One shared world:** `room.roomCode` tells the game server which room it's in, so it can keep only its world's room and refuse players elsewhere in `canJoin`.
- **On your own server** the Node runner keeps kept rooms' states in its `--room-state-file` until they end.
- A key lists with `game_access` `read` and deletes with `write`.

## A game server's logs

Everything a game's own game server prints on Zaisma, kept 30 days and free: every `console.log`, `info`, `warn`, `error` and `debug` (`trace` counts as debug; `dir` and `table` as log), in rooms and in `onRequest`, `onSchedule` and `onWebhook`, plus each crash or stop written down in full as an `error` line starting `Zaisma:` (or with the error's stack). Read them with `get_logs` or `zaisma logs <slug> --follow`.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/logs` | The newest lines in `log_lines`, oldest first, each `{"logged_at", "level", "text", "source_kind", "room_code", "version_id"}`, with `next_cursor` and `new_lines_cursor`. Narrow it with `room_code`, `minimum_level` (`debug`, the default, `info` for all but debug, `warn` or `error`), `source_kind` (`room`, `request`, `schedule` or `webhook`) and `search_text` (contained, ignoring case); `maximum_line_count` is 1 to 500, 100 by default. |

- **Going back and following:** `cursor` (a `next_cursor`) answers the lines before an earlier answer's, `null` when there are none. `new_lines_cursor` answers only the lines written since the answer that gave it, so to follow, call once and then keep passing back the `new_lines_cursor` each answer gives; following goes by when lines were written, so a room writing late never makes you miss a line. Give one or the other (`two_log_cursors`).
- **How soon:** lines reach the logs within 30 seconds, and within 2 seconds for the next 10 minutes once someone has read them, so the first call while testing can come up empty and the next ones keep up.
- **Text:** strings as they are, everything else as JSON, an `Error` with its stack, joined by spaces as a console shows them; up to 4,000 characters a line. A call that prints more than 1,000 lines keeps the first 1,000 and adds one line saying how many it dropped, and each room (and the game server outside rooms) keeps up to 20 MB a day, then says so in one line and keeps nothing more until midnight UTC.
- **Who can read them:** a key with `stats_access` `read`. Anything the game server prints is in its logs, so don't print players' details or secrets you wouldn't want there; they're deleted after 30 days, and with the game.
- **Mistakes in a game server's code** are lines here too, each with a code: a room call with wrong arguments (`bad_room_call`, the call as its field, like `room.kick`), too many reserves a minute or room calls in one go (`room_call_limit`), a call that can't run here, like `room.reserve` where the host makes no rooms, or any change from `canJoin` or `stateView` (`room_call_unavailable`), and a handler that answers something that isn't a state, or a `canJoin` that answers nothing (`bad_handler_answer`). The state stays as it was and the player is turned away, never let in by accident. The Node runner prints the same errors to its terminal.
- **Not here:** players' browser errors (they're in the browser's own console) and a game on your own server, which prints to its own terminal. `get_stats` still counts errors per day and lists the latest distinct ones.

## The game database

Every game has its own SQLite database, part of its hosting: the one its game servers use as `room.database` (see "The game database" in the README), empty until something writes to it. You and your AI reach the same database here, live, with the same checks and limits as game servers: look at its tables, query it, fix data and change its tables, and take the whole database out or bring one in. Whole numbers past 2^53 (9,007,199,254,740,991) are refused going in (`bad_values`) and can't be read back as numbers (`bad_sql`), since JavaScript can't hold them exactly: store them as text, and read one with `CAST(column AS TEXT)`.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/database` | `tables` (`{"name", "sql"}`, the `sql` being its `CREATE TABLE`), `indexes` (`{"name", "table_name", "sql"}`, only ones made with `CREATE INDEX`), and `database_use_this_month`: `read_row_count`, `written_row_count`, `storage_size_bytes` and `maximum_storage_size_bytes` (10 GB, the most a game can keep), and `hosting_use_this_month`, the game's hosting meter as the stats answer it (see Hosting and credit), which the rows and storage count on. Also `restores`: the last 30 days' restores and undos, newest first, up to 50, as the restore calls below answer them. No row counts, because counting reads every row: query `SELECT count(*)` when you need one. |
| `POST /games/:slug/database/query` | Run one statement: `{"sql", "values"}`. Answers `rows` (a `SELECT`'s, or a change's with `RETURNING`; `[]` for none), `read_row_count` and `written_row_count` (what it counts on the game's hosting meter), and `next_steps`. |
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
- **Use** counts on the game's one hosting meter (see Hosting and credit): rows written and read, counted the way Cloudflare bills them (an index changed counts as a row written, and a `SELECT` without an index reads every row it looks at), and the storage kept each day. Calls here count like the game's own. When the game's hosting pauses, reads and writes keep working for the hour running matches get, so a match's last save lands; then they answer `hosting_paused`. Exports, `GET /games/:slug/database` and erasing a player keep working whatever: the data is always yours. A game keeps up to 10 GB; at it, rows can change and go but not grow (`database_full`).

## Cloud saves

A signed-in player's progress in a game with cloud saves on is mirrored to their account from the game's own browser saves, with no code (see "Cloud saves" in the README). You and your AI reach every player's save here, by player ID: list them, read them, fix them, reset them, and go back to earlier versions. Saves stay apart from the game database, and each stays tied to its player: deleted with their account, never shown to other games. A save is the game's localStorage, and its IndexedDB databases when it keeps any (Unity, Godot and localForage do). Copying it never slows the game: only what the game changed is read again, in a worker off the thread that draws the game, and a save past 5 MB stays on the device and is read no further. Keep downloaded files in a database with "cache" in its name (like Unity's UnityCache), which saves skip, so they never count toward the save.

| Call | What it does |
| --- | --- |
| `GET /games/:slug/saves` | The players with a save, 100 a page in player ID order: `saves`, each `{"player_id", "sha256", "size_bytes", "saved_at", "changed_by_kind", "save_copy_count", "version_id"}`, and `next_cursor` (pass it as `?cursor=` as it came; `null` on the last page). |
| `GET /games/:slug/saves/:player_id` | One save: `{"save": {…the same, "local_storage_items", "missing_keys", "indexeddb_databases"}}`. `?keys=coins&keys=level` (each key its own parameter, since keys can hold commas) answers only those localStorage keys, with `missing_keys` naming the ones it doesn't have, and `indexeddb_databases: null`. |
| `PATCH /games/:slug/saves/:player_id` | Change some localStorage keys: `{"local_storage_items": {"coins": "500", "tutorial_seen": null}}`, each key's new text, `null` removing it. The rest of the save stays as it is. |
| `PUT /games/:slug/saves/:player_id` | Replace the whole save: `{"local_storage_items", "indexeddb_databases"}`, both in full (`[]` when the game keeps nothing in IndexedDB). |
| `DELETE /games/:slug/saves/:player_id` | Reset it: the save becomes empty, so the game starts fresh on every device. |
| `GET /games/:slug/saves/:player_id/copies` | Its earlier versions, newest first: `save_copies`, each `{"id", "saved_at", "copy_reason", "size_bytes", "is_current_save", "version_id", "sha256"}`. |
| `GET /games/:slug/saves/:player_id/copies/:save_copy_id` | One earlier version: `{"save_copy": {…the same, "local_storage_items", "missing_keys", "indexeddb_databases"}}`, whole or with `?keys=`. |
| `POST /games/:slug/saves/:player_id/copies/:save_copy_id/restore` | Make it the save again. |

- **Every change** (change, replace, reset, restore) answers `{"save", "kept_save_copy_id", "next_steps"}`: the save as it is now, and the earlier version that holds what it replaced, which `restore` brings back. A copy is kept first unless the save it replaces was your own last change (its copy from before that is still there), so changing a save again and again never pushes out the player's own copies; `kept_save_copy_id` is then `null`, as it is when nothing changed. A change or replace makes a save for a player who has none; a reset needs one (`no_save`).
- **It reaches the player's devices with no question.** The save's `changed_by_kind` becomes `developer` (it's `player` when the game saved it). A game the player has open takes your save the next time it saves or when the player comes back to its tab, with no question, keeping that device's progress since its last save as an earlier version: it reloads with it, unless it listens with `Zaisma.saves.on("developerChange")`, when Zaisma writes your save into the game's storage under the running game and the game rereads it, with no reload (the reload stays the fallback when the game holds a database open). A game opening later takes it like any newer save, straight away. Whether the player can go back is the game's own rule.
- **How a save is stored:** one text, `{"save_format_version_number": 1, "local_storage_items": {…}, "indexeddb_databases": […]}`, always those three keys in that order and localStorage keys sorted, so the same save always has the same `sha256` (of that text). Answers give `local_storage_items` and `indexeddb_databases`; the number tells later formats apart. A save or copy from before this format is rewritten into it the first time it's read (by the player's game, `get_save`, `get_save_copy`, a restore or an export), with nothing in it changed, so its `sha256` changes once. A save landing at that moment always wins over the rewrite.
- **saved_at and version_id:** `saved_at` is when the save was last saved or changed. `version_id` is the game version that saved it, as the player's game page reported it: `null` for a save you changed, replaced or reset, and for one from before Zaisma kept it; a restored save has the restored copy's. A copy has its own. It's a label, never a check: a save is never refused over it.
- **Values are text**, as localStorage holds them: `"500"`, not `500`, and a list or object as the JSON text the game stores.
- **IndexedDB databases** are as the game domain script stores them (`packages/sdk/saves.js`), with IndexedDB's own names: `{"name", "version", "stores": [{"name", "keyPath", "autoIncrement", "indexes": [{"name", "keyPath", "unique", "multiEntry"}], "records": [[key, value]]}]}`. `keyPath` is `null` when keys are kept beside the values, so each record's `key` is its key; otherwise it's where the key is in the value, and the record's `key` is only a copy of it. Values beyond JSON are tagged `{"$z": [kind, …]}`, and what's inside a tag (a map's entries, a set's items, an object's values) is written the same way. Change databases only inside their records' values.

  | Tag | Stands for | Written as |
  | --- | --- | --- |
  | `num` | A number JSON can't hold: `-0`, `NaN`, `Infinity`, `-Infinity` | `["num", "-0"]` |
  | `undef` | `undefined` | `["undef"]` |
  | `bigint` | A BigInt | `["bigint", "12345678901234567890"]` |
  | `date` | A Date | `["date", time in ms]`, the time a `num` tag for an invalid date |
  | `regexp` | A RegExp | `["regexp", source, flags]` |
  | `bytes` | An ArrayBuffer | `["bytes", base64]` |
  | `view` | A typed array or a DataView | `["view", kind, base64]`, kind one of `Int8Array`, `Uint8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`, `BigInt64Array`, `BigUint64Array`, `DataView` |
  | `blob` | A Blob | `["blob", type, base64]` |
  | `file` | A File | `["file", type, base64, name, lastModified in ms]` |
  | `map` | A Map | `["map", [[key, value], …]]` |
  | `set` | A Set | `["set", [item, …]]` |
  | `obj` | An object with its own `$z` key | `["obj", the object]` |

- **Replacing a save** (`PUT`, `replace_save`) takes only databases a browser can restore, and answers `bad_indexeddb_databases` with the exact place in `field` (like `indexeddb_databases[0].stores[1].keyPath`) otherwise:
  - **A database** has exactly `name`, `version` and `stores`. Its `name` isn't empty, is there once, and has no "cache" in it (in any case), since saves leave those out. Its `version` is a whole number from 1 to 9007199254740991.
  - **A store** has exactly `name`, `keyPath`, `autoIncrement`, `indexes` and `records`, with a `name` once in its database. `keyPath` is `null`, a key path (`""` for the whole value, or names joined by dots, like `"player.id"`), or a non-empty list of key paths. `autoIncrement` is `true` or `false`, and can't be `true` with a list or `""`.
  - **An index** has exactly `name`, `keyPath`, `unique` and `multiEntry`, with a `name` once in its store. Its `keyPath` is a key path or a list of them, never `null`. `unique` and `multiEntry` are `true` or `false`, and `multiEntry` can't be `true` with a list.
  - **A record** is `[key, value]`, and both read back by the tag table: a known tag, with that tag's fields (a `view`'s bytes fill whole items). With a `null` `keyPath`, the key must be one IndexedDB takes: text, a number (not `NaN`), a valid date, binary data (`bytes` or `view`), or a list of those. Otherwise the value must hold such a key at its `keyPath`, unless `autoIncrement` is `true` and nothing is there.
- **The cursor** is opaque: pass `next_cursor` back as it came. Anything else is `bad_cursor`.
- **Earlier versions:** up to 5 per player per game, kept about once an hour while playing (`copy_reason` `hourly`) and whenever progress was about to be lost: the account's, replaced by another device's progress played more recently (`account_lost`); a save that shrank to under half (`smaller`); a device's progress older than the account's (`device_lost`, its `saved_at` when that device last played); a change of yours (`developer`); or the player going back to an earlier version in the game (`restore`, through `Zaisma.saves.restoreCopy`). Those outlast hourly copies for 30 days. More reasons may come: show nothing for one you don't know.
- **In the game:** a game that draws its own save screens uses the SDK's `Zaisma.saves` (the reference is `packages/sdk/zaisma.d.ts`, served beside the SDK as `_zaisma/v1.d.ts`): `listCopies()` (`{ saveCopies }`, each with `savedAt`, `copyReason` and `versionId`), `getCopy(saveCopyId)` and `restoreCopy(saveCopyId)` reach the signed-in player's own earlier versions (going back keeps the save it replaces as a `restore` copy and reloads the game); `on("conflict")` hears when two devices' progress differed, the most recently played won and the other was kept, so the game can offer the other one (`{ winnerKind, keptSaveCopy }`, `winnerKind` `this_device` or `account`); and `on("developerChange")` takes your changes in place (`{ savedAt, keptSaveCopy }`). `Zaisma.player.offerAccount()` shows guests the "Keep your progress" card at the game's moment, at most once a visit and not for 3 days after Not now (`account_offer_enabled` only turns off the card that shows by itself after 5 minutes).
- **Limits:** a save is up to 5 MB (`save_too_big`); `keys` takes up to 100 keys. A game with cloud saves off doesn't read saves, so changes there are refused (`cloud_saves_off`); reading still works. Guests have no saves here: their progress stays in their browser.
- **Where they don't work:** on a tester link, or a Zaisma with no accounts, both the `Zaisma.saves` calls and `Zaisma.player.offerAccount()` fail with `error.code` `cloud_saves_not_here`. Nothing to fix: the game saves in the browser as usual, and cloud saves work on its own page on Zaisma.

## Webhooks

Zaisma POSTs an event to your server whenever something happens to your games, so your server or CI doesn't have to keep checking: a bug report can open a GitHub issue, a passed scan can move a release on, a takedown can page you. No server of your own? A webhook can send a game's events to that game's own game server on Zaisma instead (Webhooks to the game server, below).

| Call | What it does |
| --- | --- |
| `GET /webhooks` | Your webhooks: `{"id", "destination_kind", "endpoint_url", "event_kinds", "game_slugs", "pending_delivery_count", "failed_delivery_count", "created_at", "updated_at"}`. |
| `POST /webhooks` | Make one: `{"destination_kind"?, "endpoint_url", "event_kinds", "game_slugs"?}`, or for a game server `{"destination_kind": "game_server", "event_kinds", "game_slugs": ["<its slug>"]}`. Up to 10. Answers with the `webhook` and its `signing_secret`, shown only this once, and `next_steps` (`test_webhook`). |
| `PATCH /webhooks/:id` | Change `destination_kind` (with an `endpoint_url` when it becomes `endpoint_url`, and one game in `game_slugs` when it becomes `game_server`), `endpoint_url`, `event_kinds` (the whole list) or `game_slugs` (the whole list, or `null` for every game), or `{"replace_signing_secret": true}` for a new secret, answered once as `signing_secret`; by default the old one stops working at once. Events still being tried go to the new address with the new secret. |
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
  - `country_blocks_changed`: Zaisma blocked the game for players in one country on a notice under that country's law, or lifted it (`game.country_blocks` says which countries and why).
  - `game_server_error_found`: a new distinct error in the game's own game server (a handler threw or didn't start, or a call ran on too long), once per error per version, never per occurrence, within about 5 minutes. `game_server_error` is the error as `GET /games/:slug/stats` lists it, and `version` the version it happened in. At most 20 a game a day; past that, errors only show in the stats. An error `onWebhook` threw goes only to webhooks with an `endpoint_url`, never back to the game server, so a broken `onWebhook` can't feed itself.
  - `alert_raised`: one of the game's hosting alerts appeared (see Alerts): `hosting_nearly_paused`, `hosting_budget_nearly_used`, `hosting_paused`, `database_nearly_full` or `database_full`, each at most once a month, within about 5 minutes. `alert` is the alert as `alerts` lists it. It covers every alert kind, including ones added later, so switch on `alert.kind`.
  - `security_alert`: one of your own account's security alerts (see Your account's activity): `security_event` is the event as `GET /activity` lists it. About your account, not a game, so `game` is `null`, and it only reaches webhooks for every game (`game_slugs` `null`) at an `endpoint_url`, never one limited to games or a game server.
  - `account_deleted`: a player who played the game, or signed in to one of your sign-in apps, deleted their Zaisma account. `account_deletion` says who (`player_id`): erase what you keep about them. Zaisma erases their rows from the game's own database itself unless `account_deletion.deleted_account_erase_enabled` is `false` (the game's setting; always `false` about a sign-in app). One event per game they played and per sign-in app they used; for a sign-in app, `game` is `null` and `sign_in_app` says which, and it only reaches webhooks for every game (`game_slugs` `null`) at an `endpoint_url`, never one limited to games or a game server.
  - `purchase_completed`: a player bought an item, or you granted one (see Getting purchases to your game). `purchase` is the purchase as `GET /games/:slug/purchases/:purchase_id` answers it, with its `receipt` and `game_account_id`: the record to credit a game's own account from, sent even when no game is open. Sent whatever the game's `purchase_delivery`.
  - `purchase_refunded`: a purchase or grant was refunded or charged back. `purchase` is the purchase, whose `purchase_status` says which; take back what your refund policy says.
- **game_slugs:** only events about these games; leave it out, or `null`, for every game you have and will make. A webhook to a game server takes exactly one: the game whose server it is.
- **The event** is the body, JSON: `{"id", "kind", "created_at", "game", "version", "bug_report", "player_report", "game_server_error", "alert", "account_deletion", "sign_in_app", "security_event", "purchase"}`. `created_at` is when Zaisma made it. `game`, `version`, `bug_report`, `player_report`, `game_server_error`, `alert`, `sign_in_app`, `security_event` and `purchase` are exactly what `GET /games/:slug`, `GET /games/:slug/versions/:id`, `GET /games/:slug/reports`, `GET /games/:slug/stats`, the game's `alerts`, `GET /sign-in-apps`, `GET /activity` and `GET /games/:slug/purchases/:purchase_id` answer for them, as they are when it's sent, or `null` when the event isn't about one (a `test` event has them all `null`); `account_deletion` is `{"player_id", "deleted_account_erase_enabled"}` on an `account_deleted` event, else `null`. The embedded objects follow the API's own rule: fields are added, and one is only ever retired with notice. These v1 webhooks keep for good, so a consumer can rely on them: the game's `slug`, `title`, `visibility`, `review_status`, `review_reason`, `country_blocks` and `deleted_account_erase_enabled`, and the version's `id`, `scan_status`, `is_live`, `review_reason` and `findings`. New kinds and fields can be added, so ignore ones you don't know.
- **Signatures** follow [Standard Webhooks](https://www.standardwebhooks.com), so its libraries check them in one call, in any language. Each request has `webhook-id` (the event's `id`, the same on every try), `webhook-timestamp` (Unix seconds) and `webhook-signature`: `v1,` and the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<body>`, keyed by the bytes the base64 after `whsec_` in your `signing_secret` stands for. Check it against the body exactly as it came, and turn away timestamps more than 5 minutes off.
- **Answer 2xx within 10 seconds** to take an event. Anything else (or no answer, or a redirect, which isn't followed) is tried again after 5 minutes, 30 minutes, 2 hours, 8 hours and 24 hours, then it has failed; `failed_delivery_count` and the deliveries list show it for 30 days. Do slow work after answering.
- **Events can come twice or out of order.** Skip an `id` you've already had, and take the state from the event's objects rather than from the order they came in: compare `created_at` before overwriting newer state.
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

The same handler can post a crash (`event.kind === "game_server_error_found"`, with `event.game_server_error.message`) or a heads-up before the game's hosting pauses (`"alert_raised"`, with `event.alert.message`).

- **Finishing without an error counts as delivered.** Throwing, or taking over 10 seconds, is a failed try, tried again on the same schedule as any webhook; `failure_message` says what it threw, and the error is with the game server's others in the stats. Events can come twice, so skip an `event.id` you've already handled.
- **Nothing runs while the game can't be played:** with no live version, or while Zaisma holds or has taken it down, its events wait and fail like any other try. For a takedown to reach you, point a webhook at a server of your own.
- **Each event counts as one of the game's requests**, on the game's hosting meter. So `hosting_paused` never reaches a game server (a paused game takes no requests); a server of your own hears it.
- **The same code runs on your own server.** The Node runner takes signed POSTs at `https://<your server>/v1/webhooks`, checks them with the webhook's `signing_secret` in the `ZAISMA_WEBHOOK_SIGNING_SECRET` environment variable, and calls the same `onWebhook`. An event about another game is skipped (answered 204 untouched). An `account_deleted` event about its game whose `account_deletion.deleted_account_erase_enabled` is `true` first erases the player from the runner's local database, the way Zaisma does from its own, so a game server with no `onWebhook` takes those events too; on Zaisma, an `account_deleted` event counts as delivered to a game server with no `onWebhook`, since Zaisma erases the rows itself. `verifyWebhook` and `runWebhook` answer `{ error: { code, message, fix } }` when they don't take an event: `missing_headers`, `too_large` (a body over 16 MiB, `WEBHOOK_LIMITS.maximumEventSizeBytes`), `old_timestamp`, `bad_signing_secret`, `bad_signature`, `not_an_event`, `no_webhook_handler` or `game_server_error`. Move the webhook with `PATCH /webhooks/:id` and `{"destination_kind": "endpoint_url", "endpoint_url": "https://<your server>/v1/webhooks"}`.

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

## Covers, screenshots and share pictures

| Call | What it does |
| --- | --- |
| `POST /games/:slug/images?kind=cover`, `?kind=square`, `?kind=screenshot` or `?kind=share` | Send the image file as the request body. Answers with the `image` (`id`, `kind`, `review_status`, `review_reason`, `width_px`, `height_px`, `size_bytes`, `image_url`, `listing_reason`, `created_at`), a `review_message` and `next_steps`. |
| `DELETE /games/:slug/images/:id` | Remove one; answers `removed_image_id`. |

The cover is your game's card everywhere players browse: we show it alone, with no title over or under it, so put your game's name or logo on it. The cover is landscape (16:9 shows best). A square cover is optional: phones show it instead, where a landscape one would be small (without one, phones show the landscape cover whole, never cropped). It must be as wide as it is tall, at least 512 px. Screenshots are just the game; a listed game has at least one. A share picture is optional: wherever a link to your game or one of its rooms is shared (chats, social sites, search results), it unfolds into a card with your share picture, or your cover when there isn't one, the game's title and "Play now in your browser." (a room link says "Join my match in" the title and "Tap to join in your browser."). It's landscape: 1200 by 630 shows best, and the card fits it inside that size. PNG, JPEG or WebP, checked from the file itself; SVG and other types are refused. Up to 5 MB, 320 to 8,192 px on each side, one cover, one square cover, one share picture and up to 8 screenshots. Each image's `review_status` is `pending` until it's checked, usually within a minute, then shows at `https://zaisma.com/img/:id`; a newly approved cover replaces the old one of its kind. Until then only you can see it. One that isn't approved is `rejected`, with its `review_reason`.

**The listing check.** An AI checks a game's covers, screenshots, title and description together about a minute after any of them change, and approves images and new words in place of a person. Anything about safety waits for a person, as do new words on a game players can see when the AI can't clear them. Zaisma's lists (home, All games, browse and search engines) only show games that keep these lines, checked against what's visibly there, never taste:

- **A cover, square cover or share picture** shows no text but the game's name, a subtitle and the studio's logo (`extra_text_on_cover`; words in the scene, like a sign, are fine); nothing laid over the picture: buttons, menus, shop panels, badges, stickers, arrows or circles (`overlay_on_cover`); no famous character, logo or name a teen would name at a glance (`famous_name`: obvious ones only; the game itself may borrow, and Zaisma acts on that only on the owner's notice); and its main subject appears in a screenshot (`cover_not_from_game`).
- **A screenshot** is a real capture: the game's own score, menus, buttons and shop screens are welcome, but anything added afterwards (a caption, an arrow, a sticker, a pasted logo, a device frame) means it doesn't show (`screenshot_not_from_game`).
- **A title** has no tags: a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag (`tag_in_title`; "+1" and "2x" are names), and no famous name (`famous_name`).
- **Nothing anywhere** promises a fake reward or real-money bait, like free Robux, V-Bucks or gift cards (`fake_reward`): that holds the game until a person looks.

A cover or title that breaks a line still shows on the game page and plays by its link; its `listing_reason` (the image's, or the game's `title_listing_reason`) says what and how to fix it, and a `game_off_lists` alert sums them up. The game is back in lists about a minute after the fix. If the check got it wrong, `message_zaisma` with the `game_slug`, and a person looks; a person's decision stands. Style is free: [`docs/COVERS.md`](COVERS.md), also at zaisma.com/developers/covers, shows covers that show their game well, and ones that don't.

```bash
curl -X POST "https://zaisma.com/api/dev/games/sky-hopper/images?kind=cover" \
  -H "Authorization: Bearer $ZAISMA_KEY" --data-binary @cover.png
```

## Backgrounds

A game's background is its world behind Zaisma's glass: on the home while the game is in focus, and on its game page. Each screen has its own: **wide** (desktops and tablets) and **phone** (composed for a tall screen). Each shows a picture, a shader, or Zaisma's own background; phones show the wide one until they have their own. A background is separate from the cover and carries no title, logo or words: those go on the cover.

What reads well under the glass, each line with why, and live worlds whose sources are open to start from: [`docs/BACKGROUNDS.md`](BACKGROUNDS.md), also at zaisma.com/developers/backgrounds.

| Call | What it does |
| --- | --- |
| `POST /games/:slug/images?kind=background` or `?kind=phone_background` | Send a background picture, as for covers. It's checked the same way, and a newly approved one replaces the old one of its kind, on the screen showing it too. |
| `POST /games/:slug/images?kind=shader_texture` | Send a texture a shader reads through a channel: PNG, JPEG or WebP, up to 8 MB and 4,096 px a side, any size below that (`shader_texture_too_big`), up to 16 a game (`too_many_shader_textures`). Image matching is its whole check, so it's approved at once (when matching can't answer, a person looks); what a shader draws with it is checked in the shader's frames. A texture a kept shader reads can't be removed (`shader_texture_in_use`). |
| `POST /games/:slug/shaders` | Send a shader as JSON: `{ "screen", "image": { "source", "channels" }, "buffers": [{ "buffer_name", "source", "channels" }] }` (below). Answers 201 with the `shader` (`id`, `screen`, `review_status`, `review_reason`, `quality_checks`, `has_quality_levels`, `flash_count`, `still_url`, `frame_urls`, `image` with its `source_url` and `channels`, `buffers` with each one's `source_url` and `channels`, `buffer_count`, `texture_count`, `texture_image_ids`, `size_bytes`, `created_at`), a `review_message` and `next_steps`. Zaisma keeps a screen's newest 4 shaders besides the one it shows. |
| `POST /games/:slug/shader-checks` | Check a shader before sending it: the same body. It's drawn as the check draws it and answers the `shader_check` (below) and `remaining_shader_check_count`, keeping nothing but its sheet picture for a day. Needs write access, like sending one. |
| `DELETE /games/:slug/shaders/:shader_id` | Remove one; answers `removed_shader_id` and both `backgrounds`. A screen showing it goes back to its default. |
| `PUT /games/:slug/backgrounds/:screen` | Choose what `wide` or `phone` shows: `{ "source": "image", "image_id" }`, `{ "source": "shader", "shader_id" }`, `{ "source": "zaisma" }`, or on phone `{ "source": "wide" }`. Only an approved picture of the screen's kind, or an approved shader sent for that screen (`background_not_ready` otherwise). Answers the `background` (`screen`, `source`, `image_id`, `shader_id`, `still_url`). |
| `PATCH /games/:slug` with `glass_tint_color` | A color Zaisma tints its glass with over the background, as `#RRGGBB` (`bad_color` otherwise); `null` clears it. Zaisma still decides how thick the glass is, so words stay readable. |

`get_game` answers `backgrounds` (both screens, wide first, with the defaults when nothing is chosen) and `shaders` (newest first), and the background pictures and textures are in its `images`. Choosing is its own step, so look at a shader's still and frames, its check before sending, or preview it live in the dashboard's Background section, before it shows anywhere.

**Pictures.** A wide background is landscape, 1.3 to 2.4 times as wide as tall, at least 1600 px wide, like 2560 by 1440; a phone background is portrait, 1.6 to 2.4 times as tall as wide, at least 1600 px tall, like 1440 by 3120 (`bad_background_shape` otherwise). Leave room for the glass on the left of a wide one and on the bottom half of a phone one.

**Shaders** are Shadertoy's form in WebGL2's GLSL (GLSL ES 3.00, with integers, bit operations and loops of any length), so most Shadertoy shaders paste in and run. Each pass is one function, `void mainImage(out vec4 fragColor, in vec2 fragCoord)`, that gives each pixel its color, with any helpers above it; no `main()`, `#version` or `#extension` lines (Zaisma adds them), and `texture()`, not WebGL1's `texture2D()`. Up to 64 KB a pass (`not_a_shader`, `shader_too_big`). The names stay Shadertoy's on purpose (see `shader` in [`docs/NAMING.md`](NAMING.md)):

- `image` is the image pass (Shadertoy's Image tab): it draws the background, each frame, after the buffers.
- `buffers` are up to 4 more passes (Buffers A to D, `buffer_name` `a` to `d`, each once; `too_many_buffers`, `bad_buffers`), each drawn to a picture the size of the canvas that's kept between frames: trails, simulations, anything built up over time. They're drawn in order, a to d, then the image pass; a buffer starts empty, and again when the canvas changes size.
- `channels` say what each pass's `iChannel0` to `iChannel3` read: `{ "channel_index": 0, "input_kind": "buffer", "buffer_name": "a" }` or `{ "channel_index": 1, "input_kind": "texture", "image_id": "image_…" }` (an approved `shader_texture` of the game), with `filter` (`linear`, the default, smooth and a texture's with mipmaps; or `nearest`) and `wrap` (`clamp`, a buffer's default; or `repeat`, a texture's). A buffer read by a pass drawn after it gives this frame's picture; read by itself, or by an earlier pass, its last frame. Textures are upright with `fragCoord`'s bottom left, as on Shadertoy, and a shader reads up to 4 (`bad_shader_channel`, `too_many_shader_textures`).

Every pass reads `iResolution` (the canvas in pixels, a `vec3`), `iTime` and `iTimeDelta` (seconds), `iFrame` (frames since it started, an `int`), `iChannel0` to `iChannel3` with `iChannelResolution` (each one's size), and two of Zaisma's own:

- `iQuality`: `0` for phones and slow devices, `1`, and `2` for desktops. One shader serves every device: do less where it's lower (fewer steps, octaves or lights). A device that can't keep up steps down a level by itself, then draws fewer pixels, then holds a still.
- `iGlassPanes` and `iGlassPaneCount`: where Zaisma's glass sits, up to 16 rectangles (left, bottom, right, top in the shader's own pixels from its bottom left), to soften or light the world around them. None in the check.

No mouse, sound or video. Players' browsers draw every background at fewer pixels and sharpen it as it scales up, at most 30 frames a second.

```glsl
// Fewer clouds and no stars on phones: iQuality picks how much to draw.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 sky = mix(vec3(0.05, 0.07, 0.2), vec3(0.4, 0.2, 0.5), uv.y);
  int octaves = 3 + int(iQuality) * 2;
  float clouds = 0.0, weight = 0.5;
  vec2 p = uv * 3.0 + vec2(iTime * 0.02, 0.0);
  for (int i = 0; i < octaves; i++) { clouds += weight * (0.5 + 0.5 * sin(p.x * 2.1 + sin(p.y * 1.7))); p *= 2.0; weight *= 0.5; }
  fragColor = vec4(mix(sky, vec3(0.9), smoothstep(0.55, 0.9, clouds)), 1.0);
}
```

**The check.** Before anyone sees a shader, Zaisma draws it on a software renderer (headless Chromium on Cloudflare, WebGL2 through SwiftShader), in a page that loads nothing, usually within a minute or two:

- Every pass must compile (`shader_does_not_compile`, with the compiler's first error, a buffer's starting with its name; line numbers are the pass's own).
- 90 frames at 640 by 360 (360 by 640 for phone) are drawn in order from `iTime` 0, every pass each frame, and timed: at quality levels 0, 1 and 2 when the shader reads `iQuality` (`has_quality_levels`), each from the start, or once otherwise. Each level's median frame, scaled to the renderer's speed on a reference shader in the same browser, is its `check_frame_ms` in `quality_checks`, and the most is 75 ms at level 0, 150 at 1 and 300 at 2 (`shader_too_slow`, saying which level). A shader that doesn't read `iQuality` keeps to 75. Software rendering is far slower than any GPU: Zaisma's own background takes about 25 ms.
- Their brightness is read for flashes: a change of at least 10% that turns back within 3 frames, as WCAG 2.3.1 counts them. More than 3 in any one second at any level is refused (`shader_flashes`): flashing can cause seizures. `flash_count` is the most it counted.
- A still frame at 2 seconds and 6 frames over its first 30 seconds are saved (`still_url`, `frame_urls`), drawn at quality 2 for wide and 0 for phone, and go through the same safety checks as pictures: image matching, and the listing check, where words or a logo in them is `text_on_background`. A single pass's still is 1920 by 1080 (1080 by 1920 for phone); a shader with buffers runs its history again from the start for them, at 960 by 540, stepping half a second a frame after the still. The check has 240 seconds for it all.

**Checking before sending.** `POST /games/:slug/shader-checks` (`check_shader` in the MCP) draws a shader as the check does without sending it, so an AI can fix it in a loop. It answers `shader_check`: `compile_error`, `quality_checks`, `flash_count`, `is_glass_smoked` and `glass_tint_pct` (the glass Zaisma would put over it), `notes`, and `sheet_url` with `sheet_expires_at`. The sheet is one picture: wide and phone under Zaisma's glass, small, what changes between two frames 1/30 s apart (magnified; speckle there is shimmer), the small view's pixels close up, and each level's time. Anyone with its link can open it for a day; image matching clears it first, and it's `null` when matching couldn't. `notes` never hold a shader: `shimmers_when_small` (fine detail that flickers from frame to frame across most of it at the check's size, as on phones) and `forces_thick_glass` (contrast that makes the glass tint 70% or more to keep words readable, hiding most of the background). The listing check runs only when it's sent. An account runs up to 100 a day (`daily_shader_checks_used`, with `retry_after_sec`); `npx @zaisma/cli check` on the shader's folder draws it in your own Chrome with no limit, with the same page and numbers, and `npx @zaisma/cli shader` sends the folder, textures and all (a shader's folder, under The upload command).

**Running.** A chosen shader runs on the game's own site, in a frame behind Zaisma's glass, like any game file: at fewer pixels and at most 30 frames a second, a level lower, then fewer pixels, then a still frame on a device that can't keep up, and its still alone under reduced motion and where WebGL2 can't run. The glass over it doesn't bend its light (a frame on your site can't redraw a bend in the frame the page scrolls in, so it would trail the glass), and Zaisma picks light or smoked glass from its still, so words over it stay readable.

```bash
curl -X POST "https://zaisma.com/api/dev/games/sky-hopper/images?kind=shader_texture" \
  -H "Authorization: Bearer $ZAISMA_KEY" --data-binary @nebula.png
curl -X POST "https://zaisma.com/api/dev/games/sky-hopper/shader-checks" \
  -H "Authorization: Bearer $ZAISMA_KEY" -H "Content-Type: application/json" \
  -d '{"screen":"wide","image":{"source":"void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = texture(iChannel0, fragCoord / iResolution.xy) + texture(iChannel1, fragCoord / iResolution.xy) * 0.5; }","channels":[{"channel_index":0,"input_kind":"buffer","buffer_name":"a"},{"channel_index":1,"input_kind":"texture","image_id":"image_8f3k2m9q1x7c4v6b0n5z"}]},"buffers":[{"buffer_name":"a","source":"void mainImage(out vec4 fragColor, in vec2 fragCoord) { vec2 uv = fragCoord / iResolution.xy; fragColor = texture(iChannel0, uv) * pow(0.5, iTimeDelta) + vec4(step(distance(uv, vec2(0.5 + 0.3 * sin(iTime), 0.5)), 0.02)); }","channels":[{"channel_index":0,"input_kind":"buffer","buffer_name":"a"}]}]}'
curl -X PUT "https://zaisma.com/api/dev/games/sky-hopper/backgrounds/wide" \
  -H "Authorization: Bearer $ZAISMA_KEY" -H "Content-Type: application/json" -d '{"source":"shader","shader_id":"shader_8f3k2m9q1x7c4v6b0n5z"}'
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
| `GET /forum?search_text=&section=&category=&kind=&tag=&tab=&topic_status=&is_answered=&cursor=&maximum_topic_count=&detail=` | Topics, 30 at a time (`maximum_topic_count` for fewer), with `pinned_topics`: the open known issues for the category, above the first page of the latest. `next_cursor` continues the list (pass it as `cursor`); it's `null` on the last page. `search_text` is ranked full-text search over titles, posts and known issues' workarounds: words match by their stem ("disconnects" finds "disconnected"), codes like `too_big` stay whole, `"quoted phrases"` stay together, `word*` matches the start of a word, and when no topic has every word it finds those with any of them. Each found topic says what matched in `search_match`, the words marked «like this». `tab` is `latest` (the default), `top` (most votes), `unanswered` (questions), `known` (known issues), `yours` (your own topics and the ones you follow, with `is_unread`), `messages` (your messages to Zaisma) or `bookmarks` (topics with a post you bookmarked, newest bookmark first, each with `bookmarked_post_ids`; needs you signed in). `section` covers every category in it. `topic_status` is a status or a known issue's phase; `is_answered=true` gives questions with a marked answer. `detail=brief` gives a few fields per topic (`id`, `title`, `kind`, `topic_status`, `is_known_issue`, `is_answered`, `vote_count`, `affected_developer_count`, `reply_count`, `category`, `search_match`, `bookmarked_post_ids`, `is_unread`, `last_activity_at`), as the MCP's `search_forum` does, to keep an AI's reading short. Also `remaining_post_count`. |
| `GET /forum/similar?search_text=` | Topics and known issues that look like a title, while you write one. |
| `POST /forum` | Start a topic: `{"kind", "title", "text_markdown", "category", "tags"?, "debug_context"?, "author_kind"?, "images_base64"?}`. `kind` is `bug`, `gap`, `feature`, `question` or `talk`. With `"is_public": false` it's a message to Zaisma instead (`category` optional, `game_slug`? to name one of your games, `known_issue_topic_id`? for your own case about a known issue, so it counts). Answers with the `topic`, its `posts`, `similar_topics`, `check_note` (how long the check takes, or `null`) and `removed_secret_count`. |
| `GET /forum/:id?post_selection=` | A `topic` with every post you can see: who wrote each, the post it replies to (`reply_to_post`), which `is_answer`, and for a known issue its phase, `workaround`, `roadmap_item` and `affected_developer_count`. `post_selection=answer` gives just the opening post and the marked answer, `latest` the opening post and the last five, `none` the topic alone; `post_count` says how many there are. The topic says what you can do (`can_reply`, `can_vote`, `can_flag_misplaced`, `can_mark_answer`, `can_reopen`) and, on your message merged into a known issue, `merged_into_topic`. Opening it reads its news. |
| `POST /forum/:id/posts` | Reply: `{"text_markdown", "reply_to_post_id"?, "reopen"?, "debug_context"?, "author_kind"?, "images_base64"?}`. `reply_to_post_id` answers one post; `"reopen": true` reopens your own topic that's `fixed`, `wont` or `answered`. Answers with the `post`, `check_note` and `removed_secret_count`. |
| `POST /forum/:id/vote` | Vote on someone else's public topic: affects me too (bugs, gaps, known issues), I want this (ideas) or same question (questions); discussions take replies, not votes. On a known issue it counts toward the developers affected. You follow what you vote on. `DELETE` takes it back. Answers `vote_count` and `has_voted`. |
| `POST /forum/:id/misplaced` | It's in the wrong category: Zaisma's AI looks at where it belongs within minutes and moves it, saying so in the topic. |
| `PUT /forum/:id/posts/:post/rating` | Like or dislike someone else's post in a public topic: `{"rating"}`, `like` or `dislike`. Anonymous: each post says how many liked it (`like_count`) and disliked it (`dislike_count`), never who, and `your_rating` is yours alone. A dislike only counts: it never hides or moves a post (a harmful post gets reported). One rating per account and post: a new one replaces the old. `DELETE` takes it back. Answers `like_count`, `dislike_count` and `your_rating`. Messages to Zaisma and your own posts answer `cant_rate_post` and `cant_rate_own_post`. |
| `POST /forum/:id/posts/:post/bookmark` | Save a post to read again: any post you can see, your own and messages to Zaisma included. Private to you and your AI, and it sends nothing; `is_bookmarked` on each post, and `tab=bookmarks` lists the topics. `DELETE` removes it. |
| `POST /forum/:id/posts/:post/helpful` | Deprecated: works as a like (`PUT …/rating` with `"rating": "like"`), and its answer's `next_steps` say so. `DELETE` takes back a like only. `helpful_count` and `has_marked_helpful` on each post equal `like_count` and `your_rating === "like"` until they go. Both go 90 days after this shipped (Oct 20, 2026). |
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
- Deleting your account deletes your topics, posts, votes, likes and dislikes, bookmarks, flags and images; a known issue you started stays, without your name.
- The first feedback calls (`/feedback`) are gone: they answer `410` with `gone`, pointing here.

## Announcements

Short news Zaisma posts for players, shown as a banner at the top of zaisma.com's home until it ends or the player closes it (`apps/site/src/announcements.ts`). One shows at a time: the newest current one.

| Call | What it does |
| --- | --- |
| `GET https://zaisma.com/api/announcements` | The announcements showing now, for anyone, with no key: `{ "announcements": [{ "id", "text", "link_url", "link_label", "starts_at", "ends_at" }] }`, the newest start first (the home shows the first), `[]` when none are. `id` is an `announcement_…` ID; `text` is one or two plain sentences, up to 200 characters; `link_url` is an https address or a path on zaisma.com starting with `/` (`null` when it has no link), and `link_label` its words (`"Read more"` when none were given; `null` without a link). Answers can be cached for 60 seconds. Zaisma posts them through its admin MCP. |

## Uploading versions

The `zaisma` command ([`@zaisma/cli` on npm](https://www.npmjs.com/package/@zaisma/cli), source in `packages/cli`) does all of this for you: `npx @zaisma/cli upload ./build --game sky-hopper` (see The upload command, below).

Files are stored once, by their SHA-256, and shared by every version that has them, so an update only sends what changed.

| Call | What it does |
| --- | --- |
| `POST /games/:slug/uploads` | Send the file list, `{"files": [{"path", "sha256", "size_bytes"}]}`. Answers `file_count`, `size_bytes` and the hashes you haven't sent yet (`missing_file_hashes`). |
| `PUT /files/:sha256` | Send one missing file as the request body. Storage checks the hash; programs and archives are refused. Answers `storage_status`: `stored_now`, or `already_stored` when you sent it before. |
| `POST /games/:slug/versions` | Make the version from the same list, plus `patch_notes` (up to 2,000 characters) and optionally `"publish_when_approved": true`, which needs `version_access` `publish` (an upload key gets `key_not_allowed`), with `match_update_mode` for when it goes live (below; only with `publish_when_approved`, else `bad_match_update_mode`). |
| `GET /games/:slug/versions/:id` | The `version`: `id`, `file_count`, `size_bytes`, `scan_status` (`scanning`, `held`, `approved` or `rejected`), `has_threads` (the build needs threads, so it runs only in Chrome and Edge, and the game page tells other browsers' players), `is_live`, `patch_notes`, `preview_url` and `preview_url_expires_at` once it passes, `published_at`, `scheduled_publish_at`, `match_update_mode` (how running matches get it when it goes live by itself), `created_at`, `review_reason` (a person rejected it, or a report paused it), `findings`: what the scan found that holds or rejects it (`code`, `severity`, `message`, `content_rule`, `path`, `fix`; see Holds and takedowns), and `replaced_by_version_id`: the newer version that replaced it while it waited, or `null`, and `performance_check`: how it started in Chrome (see How it started in Chrome, below). |
| `POST /games/:slug/versions/:id/publish` | Publish a draft that passed, or roll back to an older version. With `{"scheduled_publish_at": "2026-11-01T17:00:00Z"}` (an ISO time; numbers are refused) it publishes later instead (a few minutes to 90 days ahead; checked every 5 minutes). A version still being scanned goes live at that time if it has passed by then. `match_update_mode` says when running matches get it: `"next_match"` (the default: they finish on the version they started, and new matches get it) or `"now"` (every live match switches within seconds, in the same room; see [Updates](#updates)); a scheduled publish keeps the choice, and the version's `match_update_mode` shows it. Answers with the `game` and the `version`. |
| `DELETE /games/:slug/versions/:id/publish` | Cancel a publish-later. Answers with the `game` and the `version`. |
| `DELETE /games/:slug/versions/:id/preview-links` | Turn off every preview link handed out so far for this version, and every browser that opened one. The next `preview_url` works again. Answers with the `version`. |

- Same rules as zips: `index.html` at the top, no hidden files, no pre-compressed `.gz` or `.br` files, only the file types games use. Up to 20,000 files, 2 GB per game (10 GB with Zaisma Pro) and 500 MB per file. Up to 20 versions per game a day (100 with Zaisma Pro).
- Each version is scanned. An update sends only new pictures and videos through image matching (one checked in the last 30 days isn't sent again), so it's checked in seconds however big the game is.
- A version most of whose files another developer sent first (leaving out engines, libraries and asset packs many developers share) is held with `matches_another_developers_game` until a person looks, usually within a day; your own games never count. If it's your game on another account, or you have permission, say so with `message_zaisma`. When a person finds it's a re-upload, the original developer hears, with your username.
- One that passes waits as a draft with a private preview link for you and your AI, `https://zaisma.com/p/<secret>`, that works even while the game is a draft or private. Every call answers a fresh one, each working for a day (`preview_url_expires_at`); to show a version to anyone else, make a tester link. It opens the version full page at the game's fixed preview address, `https://<slug>--preview.zaismausercontent.com/`, so a game address never holds a key, and preview saves stay in that address's own browser storage, from one build to the next.
- A version can use only files you sent yourself: a file another developer sent counts as missing for you until you send it once too (storage still keeps one copy), so a file's hash neither gets someone else's file nor says whether Zaisma has it.
- Publishing makes it the version players get. We keep the live version plus the last 5 that passed, for rolling back.
- Drafts nobody publishes are deleted after 30 days, and files no version uses after a day. Held and rejected versions are kept.
- Publishing doesn't change visibility: a draft game stays hidden until you set it to `listed` or `unlisted`.

### How it started in Chrome

A minute after a version passes the scan, Zaisma has opened it in headless Chrome through its own preview link and says how it started, and what would make it much smaller, as the version's `performance_check` (in `get_version`, `get_game`, the upload command and the dashboard). They're notes: they never hold a version, and there's no score. Chrome there runs on a computer with no graphics card, so loading, memory and errors are like a player's, and frame rate isn't measured.

| Field | What it holds |
| --- | --- |
| `check_status` | `waiting` (it passed and waits for Chrome, usually under a minute), `checking`, `checked`, `over_daily_limit` (not measured: your 20 runs today (60 with Zaisma Pro) are used; versions are measured again from midnight UTC) or `could_not_run` (Chrome couldn't run it on Zaisma's side; nothing for you to fix). |
| `checked_at` | When the run finished, or `null`. |
| `browser_description` | Where it ran, like `Chrome 141 on a computer with no graphics card`. |
| `loading_duration_sec` | Seconds from opening the game until it drew its first frame (the first draw on a canvas the page shows: WebGL, WebGL 2, 2D or WebGPU); `null` when nothing was drawn. A game that hasn't drawn after 10 seconds, with nothing downloading, gets one click, since many wait for one. |
| `start_download_size_bytes`, `start_file_count` | What was downloaded before the first frame, as sent (compressed), and how many files. |
| `start_memory_size_bytes` | JavaScript and WebAssembly memory 5 seconds after the first frame; graphics memory isn't counted. |
| `longest_start_task_duration_ms` | The longest the page froze in one go while starting. |
| `notes` | Each `{ code, message, path, saved_size_bytes, fix }`: `saved_size_bytes` is about how much smaller the download gets with the fix, `null` when it isn't about size or can't be told. Run notes first, then asset notes; `[]` when there's nothing to say. |

`performance_check` is `null` for versions from before it ran. Every version is measured, free, up to 20 runs a day per developer (60 with Zaisma Pro); past that a version just isn't, and nothing waits. There's no call to run it again: the next upload is measured.

| Code | Meaning |
| --- | --- |
| `error_at_start` | The game threw an error while starting (up to 5, with the file and line). |
| `missing_file_at_start` | The game asked for a file that isn't in the version while starting. |
| `blocked_at_start` | An address the game loaded or connected to was blocked while starting. |
| `no_frame_drawn` | Nothing was drawn in 120 seconds, even after a click. A game that waits for something only a player does is fine. |
| `big_download_at_start` | Players download 200 MB or more before the first frame. |
| `long_freeze_at_start` | The page froze for 2 seconds or more in one go while starting. |
| `images_could_be_ktx2` | A WebGL or WebGPU game's PNG, JPEG and WebP textures of 1 MB or more, 16 MB or more in all, would be about 8 MB or more smaller as KTX2 (Basis Universal ETC1S, about 2 bits a pixel with mipmaps), and take about a quarter of the graphics memory. |
| `audio_could_be_opus` | 8 MB or more of WAV and AIFF audio, which would be much smaller compressed (estimated as Ogg Opus at 96 kbps). |
| `models_could_be_smaller` | 8 MB or more of glTF models with no mesh compression (meshopt or Draco). |
| `development_build` | An engine's development or debug build, bigger and slower for players: Godot exported with Export With Debug. |

### Checking a game

Before uploading, the check says everything in a game that Zaisma would refuse, or that won't work inside Zaisma's game frame, each with how to fix it. It's the same check everywhere (`packages/cli/check.mjs`): `zaisma check <folder>` on a folder, with no key and nothing sent; the MCP's `check_game` with the same files as `upload_files`; and this call. `zaisma upload` runs it first.

| Call | What it does |
| --- | --- |
| `POST /check` | Send `{"files": [{"path", "size_bytes", "content_text"}], "slug"}`: every file's path and size, with `content_text` for each `.html`, `.htm`, `.js`, `.mjs` and `.css` file and only for those (up to 8 MB in all). `slug` is optional: with a game you have, its own servers count as addresses the code may connect to, and the fixes name it. Answers `file_count`, `size_bytes`, `problems` (in file order, up to 200), `omitted_problem_count` and `performance_notes`. Any key, read included; it changes nothing. |

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
| `game_too_big` | refused | no | The game is over 2 GB (10 GB with Zaisma Pro). |
| `too_many_files` | refused | no | The game has more than 20,000 files. |
| `outside_file` | broken | yes | The page, a stylesheet or a module loads a file from another site; the upload command downloads it into the game. |
| `outside_address` | broken | no | The code connects to or loads from another site while it runs. |
| `address_not_allowed` | broken | no | The code connects to an address no game can use: plain ws:// or http://, localhost, or an IP address. |
| `needs_threads` | broken | no | The build needs threads (SharedArrayBuffer), which games on Zaisma have only in Chrome and Edge. |
| `browser_dialog` | broken | no | alert, confirm or prompt, which never show in the game's frame. |
| `form_submission` | broken | no | A form, which never submits in the game's frame. |
| `file_download` | broken | no | A file download, which the game's frame doesn't allow. |
| `outside_link` | broken | no | A link that opens another site or a new window, which the game's frame doesn't allow. |
| `outside_frame` | broken | no | A frame of another site, which games can't show. |
| `blocked_feature` | broken | no | Camera, microphone, screen capture, location, payments, USB, serial, Bluetooth or HID, which games on Zaisma can't use. |

`performance_notes` are the asset notes of How it started in Chrome (`images_could_be_ktx2`, `audio_could_be_opus`, `models_could_be_smaller`, `development_build`), each `{ code, message, path, saved_size_bytes, fix }`. They never stop an upload, and `zaisma check` prints them under "Could be smaller" without changing its exit code. Image sizes, sound lengths and models are read from the files' first bytes, so the API, which gets only sizes for them, gives only `development_build`; `zaisma check` gives them all.

- **Threaded engine builds** (Godot with Thread Support, Unity with Native C/C++ Multithreading, Rust built with `atomics`) need cross-origin isolation, which every game gets in its own frame in Chrome and Edge on computers and Android, so they run there. Firefox, Safari and every browser on iPhone and iPad can't start them, and the game page tells their players "This game needs Chrome or Edge on a computer or Android." with Play anyway. To reach every browser, export without threads, the default in Godot 4.3 and newer and in Unity. A version's `has_threads` says whether its build needs them.
- **Outside addresses** found while the code runs can be a file or the game's own server, so the check doesn't guess: a server goes in `own_server_urls` (`zaisma own-servers`, or `update_game`), a file in the game. The check never adds a server by itself.
- What a game's code is checked for skips engine and library output (Unity's `.framework.js` and `.loader.js`, a `.js` beside a `.wasm` of the same name or its `_bg.wasm` (wasm-bindgen and Trunk), macroquad's `mq_js_bundle.js`, `*.min.js`), which mentions dialogs or cameras without the game using them, and comments, which say what code could do rather than what it does. A dialog shown only when the game fails to load, like the one in Unity's page template, isn't a problem: the game itself works.
- **Engine exports run unchanged:** a web export from Godot, Unity, Phaser, Three.js, Bevy and macroquad goes through the check, the upload command, the scan and its game page on every change to Zaisma, so engine builds keep working.

### Big files

Files over 95 MB are sent in parts, 50 MB each (the last can be smaller):

1. `POST /files/:sha256/parts` with `{"size_bytes"}` answers `{"sha256", "storage_status", "upload_id", "part_size_bytes", "part_count"}` (`storage_status` is `upload_started`, or `already_stored` with the rest `null`).
2. `PUT /files/:sha256/parts/:n?upload_id=…` for each part, numbered from 1. Each answers `{"part_number", "etag"}`.
3. `POST /files/:sha256/parts/done` with `{"upload_id", "parts": [{"part_number", "etag"}]}`.

Storage can't check the hash of a file sent in parts, so it's kept for your own games only: another developer with the same file sends their own copy. The scan reads it like any other file.

Zaisma sends every file that shrinks compressed with Brotli, Unity's and Godot's data files included, from a cache near players, and each file's ETag is its SHA-256, so a returning player downloads only what changed. Your game's pages open at their version's own address, `/_zaisma/versions/<version_id>/`, so the files they load by a relative path are kept by the player's browser for good and a returning player's game starts without asking about them; a file named by its full path (`/Build/game.data`) still works and is checked on each visit. Read the room code and other settings from the query (`location.search`), which is kept, not from the path. Upload files uncompressed (the upload command unpacks compressed exports itself); what you uploaded is what players' browsers end up with, what the scan reads and what export gives back.

The files a version needed before its first frame in its run in Chrome are preloaded with its page (up to 20, besides the ones the page names itself), so an engine's loader doesn't fetch them one after another. And on its zaisma.com page they start downloading before Play, up to 100 MB, on computers and on Android phones and tablets on Wi-Fi; never on other phones and tablets, with Data Saver, or for tester links and accounts-only games.

## The upload command

`zaisma` ([`@zaisma/cli`](https://www.npmjs.com/package/@zaisma/cli), source `packages/cli/zaisma.mjs`) runs these calls from a terminal or CI: `npx @zaisma/cli <command>`, with `ZAISMA_KEY` set to an API key. `zaisma help` lists every command; `zaisma help --json` gives the same as JSON: each command's arguments and flags (with `has_value`, `is_required` and `choices`), a shader's folder (`shader_folder`), the exit codes and the error codes below. Each release is published from GitHub's main by `.github/workflows/publish-cli.yml` with npm provenance, so npm shows the commit that built it.

| Command | What it does | Call |
| --- | --- | --- |
| `zaisma games` | Your games | `GET /games` |
| `zaisma new <title> [--slug <slug>]` | Make a game (a draft) | `POST /games` |
| `zaisma check <folder> [--game <slug>] [--screen wide\|phone] [--draw-on-zaisma]` | Check a game's folder before uploading, with no key and nothing sent (with `--game` and a key, its own servers count); or draw a shader's folder as the shader check does, in Chrome on this computer, or on Zaisma when there's none | Checking a game, above; `POST /games/:slug/shader-checks` |
| `zaisma upload <folder> --game <slug> [--patch-notes "…"] [--publish-when-approved]` | Check, fix what it can, upload a version, sending only new files, and wait for its scan | Uploading versions, above |
| `zaisma shader <folder> --game <slug> --screen wide\|phone` | Send a shader's folder: each texture as an image of kind `shader_texture` (one the game has already, byte for byte, is used again), waited for until approved, then the shader | `POST /games/:slug/images?kind=shader_texture`, `POST /games/:slug/shaders` |
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
| `zaisma items <slug>` | The game's items, each one's kind, category and price, and its refund policy | `GET /games/:slug/items` |
| `zaisma items set <slug> [file]` | Make the game's items match a JSON file of the whole list (or piped in), kept beside the game: one set per added or changed item, one remove per item gone, refused for an item players own | `PUT` and `DELETE /games/:slug/items/:item_name` |
| `zaisma items remove <slug> <item_name>` | Remove an item nobody owns | `DELETE /games/:slug/items/:item_name` |
| `zaisma kept-rooms <slug>` | The game's kept rooms, each one's size and when it was last played, and the game's storage | `GET /games/:slug/kept-rooms` |
| `zaisma kept-rooms delete <slug> <room_code>` | Delete a kept room's world for good | `DELETE /games/:slug/kept-rooms/:room_code` |
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
| `zaisma export <slug> [--folder <folder>]` | Save everything about the game in a folder (`./<slug>-export` unless `--folder` says), with the database also as a ready `database.sqlite` | `GET /games/:slug/export/download` |

- **Closed, like the API.** A command takes only its own flags and arguments: anything else is refused before anything is sent, with the flags it does take. Choices (`visibility`, `--kind`, `--category`) are checked first too, with the valid list. A flag that takes a value takes it as `--flag value` or `--flag=value`. Renamed commands and flags say their new name (`zaisma show` is now `zaisma visibility`; `--notes`, `--publish` and `--at` are `--patch-notes`, `--publish-when-approved` and `--scheduled-publish-at`).
- **`--json` on every command** prints the API's answer as-is, compact, and nothing else on stdout: the same data the MCP gets. On failure it prints the API's `{ "error": { code, message, field, fix, retry_after_sec } }`, or the same shape for the command's own errors (below), where `field` is the flag (`--game`) or argument (`slug`) at fault. `upload --json` prints the version's last answer (`GET /games/:slug/versions/:id`) and sends its progress to stderr; `forum --json` with no topic or search prints both tabs' answers, as `{ "yours": …, "messages": … }`. Without `--json`, the command prints lines for people, and errors go to stderr as `zaisma: <message> <fix> (<code>)`.
- **`upload` fixes two things itself, in what it sends, never in your folder:** files the page, its stylesheets and its modules load from other sites (scripts, styles, fonts, images, import maps and what they import) are downloaded into `zaisma-outside/<site>/<path>` and the game is pointed at them, so they're scanned and served like the rest; pre-compressed files (`.gz`, `.br`, `.unityweb`) are unpacked and the game is pointed at the unpacked names. It works in a temporary folder and prints what it changed (on stderr with `--json`). Before sending, it runs the check: a problem Zaisma would refuse that it doesn't fix stops it with that problem's code, and ones that won't work on Zaisma are printed and it goes on. A download that fails stops it with `outside_file_unreachable`, before anything is sent. Addresses the code connects to while it runs are never downloaded.
- **`check` ends with exit code 6** when something won't work and `upload` doesn't fix it, and 0 otherwise; `--json` prints the check's answer.
- **A shader's folder** is what `shader` sends and `check` draws (a folder with `image.glsl` is a shader's; any other is a game's). It holds `image.glsl` (the image pass, Shadertoy's `mainImage`), `buffer-a.glsl` to `buffer-d.glsl` if it has buffers, `channels.json` if a pass reads a channel, and the PNG, JPEG or WebP textures `channels.json` names (up to 4, each up to 8 MB). `channels.json` is an object of passes (`image`, `buffer-a` to `buffer-d`), each a list of up to 4 channels shaped as the API's (Backgrounds, above), with a texture named by its file in the folder, `texture_file`, instead of an `image_id`: `{ "image": [{ "channel_index": 0, "input_kind": "buffer", "buffer_name": "a" }, { "channel_index": 1, "input_kind": "texture", "texture_file": "noise.png", "filter": "linear", "wrap": "repeat" }], "buffer-a": [{ "channel_index": 0, "input_kind": "buffer", "buffer_name": "a" }] }`. `filter` and `wrap` take the API's values and defaults. The folder is closed like the command line: a missing `image.glsl` (`no_image_pass`), any other file or a texture no channel names (`unknown_shader_file`), `channels.json` that isn't an object of the folder's passes (`bad_channels_file`), a field it doesn't take (`unknown_field`, saying `texture_file` when it's an `image_id`) or a channel that reads what the folder hasn't got (`bad_shader_channel`) is refused before anything is sent or drawn, with the file and place as `field` (like `channels.json: image[1].texture_file`); hidden files are left out. `zaisma help` shows the folder, and `help --json` gives it as `shader_folder`.
- **`shader`** sends each texture first, using an approved `shader_texture` the game has with the same bytes instead of sending it again, and waits about a minute for one image matching couldn't check (then `shader_texture_not_approved`; run it again once it's approved), then sends the shader, which is checked in a minute or two. `--json` prints `{ "texture_images": [{ "texture_file", "image_id", "added_image" }], "added_shader" }`: each `added_image` is the image's answer as-is (`null` for a texture used again), and `added_shader` the shader's.
- **`check` on a shader's folder** draws it with the shader check's own page and numbers (`packages/cli/shader-check.mjs`, shared with Zaisma's check), in headless Chrome on this computer in software, as the check draws it: `CHROME_PATH`, the system's Chrome, or one Playwright or `@puppeteer/browsers` downloaded (it never downloads one; Node 22 or newer, `needs_newer_node`). `--screen` picks wide (the default) or phone. With no Chrome, it's a check before sending on Zaisma, which needs `--game` and `ZAISMA_KEY` (`no_chrome` otherwise) and sends the textures as `shader` does; a Chrome that can't draw it (`local_chrome_failed`) hands it to Zaisma the same way when `--game` and a key are there, and `--draw-on-zaisma` draws it on Zaisma even with a Chrome here. It prints the compiler's first error, each quality level's time against its most, flashes, the glass Zaisma would put over it and the notes, and saves the sheet beside the folder as `<folder>-<screen>-check.png`. It ends with exit code 6 when the shader doesn't compile, is too slow at a level or flashes; notes never change it. `--json` prints `{ "renderer_kind", "shader_check", "remaining_shader_check_count", "sheet_file", "texture_images" }`: `renderer_kind` `local_chrome` or `zaisma`, `shader_check` the API's shape (its `sheet_url` `null` when drawn here), `remaining_shader_check_count` `null` when drawn here, and `sheet_file` the saved sheet's path.
- **`--scheduled-publish-at`** takes the API's times: ISO 8601 with `Z` or an offset (`2026-11-01T17:00:00Z`, `2026-11-01T17:00+01:00`), nothing else. A time without a zone, like `2026-11-01 17:00`, is refused with the same time and this computer's offset written out, so a script on a server in another time zone never publishes at the wrong hour.
- `--text` can be piped in instead; `--by-me` marks a post as yours, otherwise it says your AI wrote it.
- `database query` prints the rows as a table (blobs as their size), then the rows read and written; `--values` and a batch's file are checked to be JSON lists before anything is sent (`bad_values`, `bad_sql`).
- `database export` won't write over a file that's there (`file_exists`), and writes the file only once every part has come. A `.sqlite` file is the same database, ready for the Node runner (`--database-file game.sqlite`); `--json` prints `{ "dump_sql", "file", "part_count", "read_row_count" }`, with `dump_sql` `null` when it went to a file. `database import` reads a `.sqlite` file into the same SQL export writes; when a part fails, the error says which parts went in, and `--json` prints the parts' answers added up (`part_count`, `statement_count`, `skipped_statement_count`, `read_row_count`, `written_row_count`). `.sqlite` files need Node 22.13 or newer (`needs_newer_node`); `.sql` works on any.
- `export` downloads the whole .zip first, then unpacks it, so a cut connection leaves nothing half-saved; it saves only into a new or empty folder (`folder_not_empty`). `database.sqlite` needs Node 22.13 or newer and a dump under 400 MB; otherwise it prints the `sqlite3` line that makes it. `--json` prints `{ "folder", "file_count", "size_bytes", "database_file" }`, with `database_file` `null` when there's no `database.sqlite`.
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
| 6 | `problems_found` | check: something in the game won't work on Zaisma as it is, and the upload command doesn't fix it; or the shader doesn't compile, is too slow or flashes. The problems say what and how to fix it. |

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
| `folder_not_empty` | export saves only into a new or empty folder. |
| `needs_newer_node` | Reading or writing a .sqlite file needs Node 22.13 or newer, and drawing a shader in a local Chrome Node 22. |
| `not_a_database` | The .sqlite file to import isn't a SQLite database. |
| `unknown_link` | links remove: the game has no link by that name. |
| `outside_file_unreachable` | upload: a file the game loads from an outside site couldn't be downloaded, so nothing was sent. |
| `too_many_outside_files` | upload: the game loads more than 500 files from outside sites, so nothing was sent. |
| `unpack_failed` | upload: a pre-compressed file couldn't be unpacked, so nothing was sent. |
| `no_image_pass` | shader: the folder has no image.glsl, the shader's image pass. |
| `unknown_shader_file` | A file in a shader's folder isn't one the command reads, or no channel in channels.json names it. |
| `bad_channels_file` | A shader's channels.json isn't JSON, or isn't an object of the folder's passes, each a list of channels. |
| `shader_texture_not_approved` | shader, check: a texture sent for the shader was rejected, or still waits for a person, so the shader wasn't sent. |
| `no_chrome` | check: there's no Chrome on this computer to draw the shader in, and no --game with ZAISMA_KEY to draw it on Zaisma. |
| `local_chrome_failed` | check: the Chrome on this computer couldn't draw the shader. |
| `server_unreachable` | Zaisma couldn't be reached: no connection, or a wrong ZAISMA_API. |
| `unexpected_answer` | Zaisma answered without JSON, like a page from a network in between. |
