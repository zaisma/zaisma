/**
 * Every error the developer API and MCP answer with (docs/NAMING.md, Errors), in one list: a stable,
 * lowercase snake_case code per problem, never reused for another, with its HTTP status and what it
 * means. docs/DEVELOPER-API.md lists every code, and test/site/errors.test.ts keeps the two in step.
 * Codes named bad_<field> mean that input's value isn't one the call takes; `field` says where.
 */
export const ERROR_CODES = {
  // Signing in and requests
  no_key: { httpStatus: 401, meaning: "The MCP was called without an API key or a connected app's token." },
  bad_key: { httpStatus: 401, meaning: "The API key isn't valid: removed, mistyped or never made." },
  key_turned_off: { httpStatus: 401, meaning: "The API key was found in public and turned off for good." },
  key_ended: { httpStatus: 401, meaning: "The API key reached the end date it was made with." },
  access_token_ended: { httpStatus: 401, meaning: "A connected app's access token is past its hour; the app refreshes it by itself." },
  token_not_for_api: { httpStatus: 401, meaning: "A connected app's token works only at the MCP, not the REST API." },
  signed_out: { httpStatus: 401, meaning: "No API key, and no signed-in session." },
  no_account: { httpStatus: 401, meaning: "The account isn't finished yet." },
  bad_origin: { httpStatus: 403, meaning: "A call with a session came from another site." },
  key_not_allowed: { httpStatus: 403, meaning: "The API key is limited to other games, or its access doesn't cover the call." },
  slow_down: { httpStatus: 429, meaning: "Too many calls in a minute." },
  not_found: { httpStatus: 404, meaning: "There's no API call at that path." },
  bad_method: { httpStatus: 405, meaning: "The path doesn't take that method." },
  gone: { httpStatus: 410, meaning: "The call was removed, like the first feedback calls." },
  bad_json: { httpStatus: 400, meaning: "The body isn't a JSON object." },
  json_too_big: { httpStatus: 413, meaning: "The JSON body is over the call's size limit." },
  unknown_field: { httpStatus: 400, meaning: "A field, argument or query parameter the call doesn't take." },
  missing_field: { httpStatus: 400, meaning: "A field the call needs wasn't sent." },
  wrong_id_kind: { httpStatus: 400, meaning: "An ID of another kind was sent, like an image ID as version_id." },
  internal_error: { httpStatus: 500, meaning: "Something broke on Zaisma's side." },

  // Games
  no_game: { httpStatus: 404, meaning: "You have no game with that slug." },
  bad_slug: { httpStatus: 400, meaning: "The link name isn't lowercase letters, numbers and single hyphens, or is reserved." },
  slug_taken: { httpStatus: 409, meaning: "Another game has that link name, or a deleted game had it." },
  too_many_games: { httpStatus: 403, meaning: "The account has as many games as it can have." },
  publishing_not_open: { httpStatus: 403, meaning: "Until the beta, only accounts Zaisma adds can make, upload and publish games." },
  bad_title: { httpStatus: 400, meaning: "A game's, topic's or precedent's title is empty or too long." },
  bad_description: { httpStatus: 400, meaning: "The description isn't text of up to 500 characters." },
  bad_visibility: { httpStatus: 400, meaning: "visibility isn't draft, listed, unlisted or private." },
  bad_devices: { httpStatus: 400, meaning: "devices isn't a list of phone, tablet and computer." },
  bad_controls: { httpStatus: 400, meaning: "controls isn't a list of touch, keyboard_mouse and gamepad." },
  bad_screen_orientation: { httpStatus: 400, meaning: "screen_orientation isn't portrait, landscape, either or null." },
  bad_play_modes: { httpStatus: 400, meaning: "play_modes isn't a list of play modes, or one of them is wrong." },
  bad_cloud_saves_enabled: { httpStatus: 400, meaning: "cloud_saves_enabled isn't true or false." },
  bad_account_offer_enabled: { httpStatus: 400, meaning: "account_offer_enabled isn't true or false." },
  bad_deleted_account_erase_enabled: { httpStatus: 400, meaning: "deleted_account_erase_enabled isn't true or false." },
  bad_friend_joins_enabled: { httpStatus: 400, meaning: "friend_joins_enabled isn't true or false." },
  bad_performance_measuring_enabled: { httpStatus: 400, meaning: "performance_measuring_enabled isn't true or false." },
  bad_room_browsing: { httpStatus: 400, meaning: "room_browsing isn't page, game or off." },
  bad_multiplayer_mode: { httpStatus: 400, meaning: "multiplayer_mode isn't none, relay or own." },
  bad_account_requirement: { httpStatus: 400, meaning: "account_requirement isn't none, multiplayer or whole_game." },
  bad_minimum_player_age: { httpStatus: 400, meaning: "minimum_player_age_years isn't 13, 16 or 18." },
  accounts_needed_for_minimum_age: { httpStatus: 400, meaning: "A game for 16 or 18 and up needs account_requirement whole_game, since only accounts have an age." },
  content_needs_minimum_age: { httpStatus: 409, meaning: "A version shows lifelike gore, which plays only in games for 16 and up." },
  screenshot_needed: { httpStatus: 409, meaning: "A listed game needs at least one screenshot." },
  bad_links: { httpStatus: 400, meaning: "links isn't a list of up to 20 { link_name, destination_url, is_on_game_page } with names of their own and https addresses that aren't link shorteners, IP addresses, addresses with a user name, or on Zaisma's own domains." },
  bad_own_server_urls: { httpStatus: 400, meaning: "own_server_urls isn't a list of up to 5 server addresses like wss://play.example.com, or one is an IP address, this computer or on Zaisma's own domains." },
  bad_game_server_allowed_hosts: { httpStatus: 400, meaning: "game_server_allowed_hosts isn't a list of up to 20 host names (like discord.com or *.example.com), or one is an IP address or on Zaisma's own domains." },
  built_in_server: { httpStatus: 403, meaning: "The game runs a game server built into Zaisma, which only Zaisma changes." },
  game_removed: { httpStatus: 403, meaning: "Zaisma took the game down, so this can't change." },
  needs_confirm: { httpStatus: 409, meaning: "Hiding a game players can play needs the developer's OK." },
  bad_period_duration_days: { httpStatus: 400, meaning: "period_duration_days isn't a whole number from 1 to 90." },
  bad_cursor: { httpStatus: 400, meaning: "cursor isn't a next_cursor from an earlier answer." },

  // Players
  no_player: { httpStatus: 404, meaning: "No account has that player ID: a guest's, or a deleted account's." },

  // Covers, screenshots, backgrounds and other images
  bad_kind: { httpStatus: 400, meaning: "kind isn't one of the choices the call takes." },
  not_an_image: { httpStatus: 415, meaning: "The file isn't an image of a type the call takes." },
  image_too_big: { httpStatus: 413, meaning: "The image is over 5 MB." },
  bad_image_dimensions: { httpStatus: 400, meaning: "The image is under 320 px or over 8,192 px on a side." },
  not_square: { httpStatus: 400, meaning: "A square cover isn't as wide as it is tall, or is under 512 px." },
  too_many_screenshots: { httpStatus: 400, meaning: "The game has 8 screenshots already." },
  image_refused: { httpStatus: 422, meaning: "The image can't be used." },
  no_image: { httpStatus: 404, meaning: "The game has no image with that ID." },
  no_file: { httpStatus: 400, meaning: "A form on Zaisma's pages was sent without its image." },
  bad_background_shape: { httpStatus: 400, meaning: "A wide background is landscape (1.3 to 2.4 times as wide as tall), a phone background portrait (1.6 to 2.4 times as tall as wide), and its long side at least 1600 px." },
  not_a_shader: { httpStatus: 400, meaning: "A shader's pass isn't GLSL text with a mainImage function, or has its own main(), a #version or #extension line, texture2D, iMouse or sound." },
  shader_too_big: { httpStatus: 413, meaning: "A shader's pass is over 64 KB." },
  bad_buffers: { httpStatus: 400, meaning: "buffers isn't a list of { buffer_name, source, channels } with buffer_name a, b, c or d, each once." },
  too_many_buffers: { httpStatus: 400, meaning: "A shader has more than 4 buffers." },
  bad_shader_channel: { httpStatus: 400, meaning: "A channel isn't { channel_index 0 to 3, input_kind, buffer_name or image_id, filter, wrap }, names a buffer the shader doesn't have, or a texture that isn't an approved shader_texture of the game." },
  shader_texture_too_big: { httpStatus: 413, meaning: "A shader texture is over 8 MB, or over 4,096 px on a side." },
  too_many_shader_textures: { httpStatus: 400, meaning: "The game has 16 shader textures already, or a shader's channels name more than 4." },
  shader_texture_in_use: { httpStatus: 409, meaning: "A shader the game keeps reads this texture." },
  daily_shader_checks_used: { httpStatus: 429, meaning: "The account has run 100 shader checks in the last day." },
  shader_check_unavailable: { httpStatus: 503, meaning: "Zaisma can't draw shaders here right now, so it can't check one." },
  no_shader: { httpStatus: 404, meaning: "The game has no shader with that ID." },
  bad_screen: { httpStatus: 400, meaning: "screen isn't wide or phone." },
  bad_background_source: { httpStatus: 400, meaning: "source isn't zaisma, image or shader, or wide (which only phone takes)." },
  background_not_ready: { httpStatus: 409, meaning: "The image or shader isn't this game's, isn't approved yet, or is for the other screen." },
  bad_color: { httpStatus: 400, meaning: "The color isn't #RRGGBB." },

  // Uploading versions
  bad_files: { httpStatus: 400, meaning: "files isn't a list of files in the shape the call takes." },
  bad_path: { httpStatus: 400, meaning: "A file's path is absolute, has . or .. in it, has control characters or is over 200 characters." },
  hidden_file: { httpStatus: 400, meaning: "A file or folder's name starts with a dot." },
  precompressed_file: { httpStatus: 400, meaning: "A file is pre-compressed (.gz or .br)." },
  file_type_not_allowed: { httpStatus: 400, meaning: "A file is of a type games can't have." },
  file_too_big: { httpStatus: 413, meaning: "A file is over 500 MB." },
  duplicate_path: { httpStatus: 400, meaning: "Two files share a path." },
  no_index_html: { httpStatus: 400, meaning: "There's no index.html at the top of the game." },
  too_many_files: { httpStatus: 400, meaning: "The game has more than 20,000 files." },
  game_too_big: { httpStatus: 413, meaning: "The game is over 2 GB." },
  too_big_for_mcp: { httpStatus: 413, meaning: "upload_files and check_game take up to 5 MB; bigger builds go through the upload command." },
  bad_base64: { httpStatus: 400, meaning: "Something sent as base64 isn't valid base64." },
  files_missing: { httpStatus: 409, meaning: "Some of the version's files haven't been sent yet." },
  bad_patch_notes: { httpStatus: 400, meaning: "patch_notes isn't text of up to 2,000 characters." },
  bad_publish_when_approved: { httpStatus: 400, meaning: "publish_when_approved isn't true or false." },
  bad_match_update_mode: { httpStatus: 400, meaning: "match_update_mode isn't next_match or now, or it came without publish_when_approved." },
  version_limit: { httpStatus: 429, meaning: "The game has had 20 versions in the last day." },
  no_content_length: { httpStatus: 411, meaning: "A file was sent without a Content-Length header." },
  file_needs_parts: { httpStatus: 413, meaning: "A file over 95 MB was sent in one go." },
  no_body: { httpStatus: 400, meaning: "A file was sent without a body." },
  hash_mismatch: { httpStatus: 400, meaning: "A file doesn't match the SHA-256 it was sent as." },
  forbidden_file: { httpStatus: 400, meaning: "A file is a program or an archive, whatever its name says." },
  bad_size_bytes: { httpStatus: 400, meaning: "size_bytes isn't a whole number above 0." },
  bad_part_number: { httpStatus: 400, meaning: "A part's number isn't from 1 to 10,000." },
  no_upload_id: { httpStatus: 400, meaning: "A part was sent without its upload_id." },
  bad_part_size: { httpStatus: 400, meaning: "A part is empty, over 50 MB or has no Content-Length header." },
  upload_closed: { httpStatus: 400, meaning: "The upload_id isn't an open upload any more." },
  bad_parts: { httpStatus: 400, meaning: "The finishing call isn't { upload_id, parts: [{ part_number, etag }] }." },
  parts_incomplete: { httpStatus: 400, meaning: "The parts sent don't make a whole file." },

  // Versions and publishing
  no_version: { httpStatus: 404, meaning: "The game has no version with that ID." },
  bad_time: { httpStatus: 400, meaning: "A time isn't an ISO time in the range it takes: scheduled_publish_at from a few minutes to 90 days ahead, a tester link's ends_at from now to a year ahead, a database restore's restore_to_at within the last 30 days and not before the game was made, an announcement's starts_at from an hour ago to 90 days ahead and its ends_at after now and starts_at and at most 60 days after it." },
  still_scanning: { httpStatus: 409, meaning: "The version is still being scanned." },
  not_approved: { httpStatus: 409, meaning: "The version didn't pass review, so it can't be published." },

  // Tester links
  bad_name: { httpStatus: 400, meaning: "A tester link's or sign-in app's name isn't 1 to 60 characters, or a sign-in app's says Zaisma." },
  too_many_tester_links: { httpStatus: 403, meaning: "The game has 50 tester links on already." },
  no_tester_link: { httpStatus: 404, meaning: "The game has no tester link on with that ID." },
  bad_version_choice: { httpStatus: 400, meaning: "version_choice isn't live, newest_passed or picked, or picked_version_id doesn't go with it." },

  // Sign in with Zaisma
  bad_redirect_urls: { httpStatus: 400, meaning: "redirect_urls isn't a list of 1 to 10 https URLs (http only for localhost) without #fragments." },
  bad_replace_client_secret: { httpStatus: 400, meaning: "replace_client_secret isn't true or false, or the app is public and has no client secret." },
  too_many_sign_in_apps: { httpStatus: 403, meaning: "The account has 20 sign-in apps already." },
  no_sign_in_app: { httpStatus: 404, meaning: "You have no sign-in app with that ID." },

  // Webhooks
  bad_destination_kind: { httpStatus: 400, meaning: "destination_kind isn't endpoint_url or game_server." },
  bad_endpoint_url: { httpStatus: 400, meaning: "endpoint_url isn't an https URL on a name (no IP address, user name or #fragment), or it's on Zaisma's own domains, or it's given for a webhook to a game server, which has none." },
  bad_event_kinds: { httpStatus: 400, meaning: "event_kinds isn't a list of 1 or more of the webhook event kinds." },
  bad_game_slugs: { httpStatus: 400, meaning: "game_slugs isn't null or a list of 1 to 50 of your games' slugs, or, for a webhook to a game server, a list of the one game whose server it is." },
  bad_replace_signing_secret: { httpStatus: 400, meaning: "replace_signing_secret isn't true or false." },
  too_many_webhooks: { httpStatus: 403, meaning: "The account has 10 webhooks already." },
  no_webhook: { httpStatus: 404, meaning: "You have no webhook with that ID." },

  // The game database (the same codes a game server's DatabaseError has, and answer_too_big)
  bad_sql: { httpStatus: 400, meaning: "The SQL isn't one statement SQLite takes, or statements isn't a list of { sql, values }." },
  bad_values: { httpStatus: 400, meaning: "values isn't a list of text, numbers, null and { blob_base64 } for the SQL's ?s." },
  bad_player_id: { httpStatus: 400, meaning: "player_id isn't a player ID (player_…)." },
  too_many_rows: { httpStatus: 400, meaning: "A statement answered more than 10,000 rows." },
  answer_too_big: { httpStatus: 400, meaning: "The rows answered come to more than 8 MB." },
  database_full: { httpStatus: 403, meaning: "The statement would grow the game's storage (its database and kept rooms) past the 10 GB a game can keep." },
  database_unavailable: { httpStatus: 503, meaning: "The game's database didn't answer." },
  database_restore_unavailable: { httpStatus: 501, meaning: "This Zaisma's game databases can't go back in time: its storage keeps no history, like a local preview." },
  no_database_restore: { httpStatus: 404, meaning: "The game has no database restore with that ID in the last 30 days." },
  bad_secret_name: { httpStatus: 400, meaning: "A secret's name isn't capitals, digits and underscores starting with a capital, up to 64 characters." },
  bad_secret_value: { httpStatus: 400, meaning: "secret_value isn't text of up to 8 KB." },
  no_secret: { httpStatus: 404, meaning: "The game has no secret by that name." },
  too_many_secrets: { httpStatus: 403, meaning: "The game has 50 secrets, the most it can have." },
  secrets_unavailable: { httpStatus: 503, meaning: "The game's secrets didn't answer." },
  no_kept_room: { httpStatus: 404, meaning: "The game has no kept room with that code." },
  dump_too_big: { httpStatus: 413, meaning: "dump_sql is over 5 MB: import a dump in parts, each ending on a whole statement." },

  // Hosting and credit
  hosting_paused: { httpStatus: 429, meaning: "The game's hosting is paused this month: its free allowance, its budget or its developer's credit is used. It starts again when the month resets, the budget is raised or credit is added." },
  confirmation_needed: { httpStatus: 403, meaning: "Turning spending on or up needs the developer's passkey on zaisma.com: confirm_url is where they do it." },
  bad_monthly_budget_cents: { httpStatus: 400, meaning: "monthly_budget_cents isn't a whole number of cents of at least 100 ($1), or null for no paid hosting." },
  bad_top_up_amount: { httpStatus: 400, meaning: "amount_cents isn't a whole number of cents from 1,000 ($10) to 100,000 ($1,000)." },
  no_top_up: { httpStatus: 404, meaning: "You have no top-up with that ID." },
  top_up_not_refundable: { httpStatus: 409, meaning: "The top-up has nothing left to refund: it's spent, refunded, or over 180 days old." },
  bad_automatic_top_up: { httpStatus: 400, meaning: "The automatic top-up's amounts aren't whole cents that fit: a top-up of at least $10, and a monthly limit of at least one top-up." },
  stripe_unavailable: { httpStatus: 503, meaning: "Stripe didn't answer, or this Zaisma has no Stripe account set up." },

  // A game server's logs
  bad_room_code: { httpStatus: 400, meaning: "room_code isn't a room's code: six characters like K7Q2MX." },
  bad_minimum_level: { httpStatus: 400, meaning: "minimum_level isn't debug, info, warn or error." },
  bad_source_kind: { httpStatus: 400, meaning: "source_kind isn't room, request, schedule or webhook." },
  bad_search_text: { httpStatus: 400, meaning: "search_text is empty or over 200 characters." },
  bad_maximum_line_count: { httpStatus: 400, meaning: "maximum_line_count isn't a whole number from 1 to 500." },
  two_log_cursors: { httpStatus: 400, meaning: "get_logs got both cursor and new_lines_cursor." },

  // Items and purchases
  no_item: { httpStatus: 404, meaning: "The game has no item by that name." },
  too_many_items: { httpStatus: 400, meaning: "The game has 1,000 items, the most it can have." },
  bad_item: { httpStatus: 400, meaning: "An item's name, title, description, kind, category, price or local prices isn't one set_item takes; field says which." },
  unsupported_currency: { httpStatus: 400, meaning: "Zaisma doesn't price in that currency." },
  price_too_low: { httpStatus: 400, meaning: "The price is under the least Stripe charges in its currency." },
  refund_policy_needed: { httpStatus: 409, meaning: "A game that sells anything states its refund policy first." },
  bad_refund_policy: { httpStatus: 400, meaning: "refund_policy isn't no_refunds, unused_within_14_days, within_14_days, own_words or null." },
  bad_refund_policy_text: { httpStatus: 400, meaning: "refund_policy_text isn't up to 600 characters of plain words, or doesn't go with refund_policy own_words." },
  bad_own_payment_categories: { httpStatus: 400, meaning: "own_payment_categories isn't a list of cosmetic, gameplay, content and currency." },
  item_has_owners: { httpStatus: 409, meaning: "Players bought or were granted the item, so it can't be removed; take its price off to stop selling it." },
  bad_item_count: { httpStatus: 400, meaning: "item_count isn't a whole number from 1 to 1,000, or isn't 1 for a permanent item." },
  bad_game_account_id: { httpStatus: 400, meaning: "game_account_id isn't text of up to 200 characters, or null." },
  bad_purchase_source: { httpStatus: 400, meaning: "purchase_source isn't sale or grant." },
  bad_purchase_status: { httpStatus: 400, meaning: "purchase_status isn't pending, completed, failed, refunded or charged_back." },
  no_purchase: { httpStatus: 404, meaning: "The game has no purchase with that ID." },
  already_refunded: { httpStatus: 409, meaning: "The purchase was refunded or charged back already." },
  stripe_not_connected: { httpStatus: 409, meaning: "Refunding a sale goes through Stripe, which the game's developer hasn't connected." },
  receipts_unavailable: { httpStatus: 503, meaning: "Zaisma couldn't sign the purchase's receipt just now. A grant answered with it wasn't made, so trying again grants it once." },

  // Cloud saves
  no_save: { httpStatus: 404, meaning: "The player has no save in the game." },
  no_save_copy: { httpStatus: 404, meaning: "The player's save has no earlier version with that ID." },
  bad_keys: { httpStatus: 400, meaning: "keys isn't a list of 1 to 100 localStorage keys of up to 1,000 characters." },
  bad_local_storage_items: { httpStatus: 400, meaning: "local_storage_items isn't an object of localStorage keys and their text (null removes a key in a change)." },
  bad_indexeddb_databases: { httpStatus: 400, meaning: "indexeddb_databases isn't a list of databases, each { name, version, stores } as get_save answers them." },
  save_too_big: { httpStatus: 413, meaning: "The save would be over 5 MB." },
  cloud_saves_off: { httpStatus: 409, meaning: "The game has cloud saves off, so it doesn't read saves from players' accounts." },
  save_busy: { httpStatus: 409, meaning: "The player's game kept saving at the same moment, so the change didn't go through." },

  // The developer forum
  no_topic: { httpStatus: 404, meaning: "There's no topic with that ID you can see." },
  no_post: { httpStatus: 404, meaning: "There's no post with that ID you can see in the topic." },
  no_known_issue: { httpStatus: 404, meaning: "There's no known issue with that ID." },
  no_media: { httpStatus: 404, meaning: "There's no image there you can see." },
  bad_tab: { httpStatus: 400, meaning: "tab isn't latest, top, unanswered, known, yours or messages." },
  bad_section: { httpStatus: 400, meaning: "section isn't one of the forum's sections." },
  bad_category: { httpStatus: 400, meaning: "category isn't one of the forum's categories." },
  no_category: { httpStatus: 400, meaning: "A public topic was sent without its category." },
  bad_tag: { httpStatus: 400, meaning: "tag isn't one of the forum's tags." },
  bad_tags: { httpStatus: 400, meaning: "tags isn't a list of up to 3 of the forum's tags." },
  bad_topic_status: { httpStatus: 400, meaning: "topic_status isn't one of the statuses." },
  bad_is_answered: { httpStatus: 400, meaning: "is_answered isn't true or false." },
  bad_maximum_topic_count: { httpStatus: 400, meaning: "maximum_topic_count isn't a whole number from 1 to 30." },
  bad_detail: { httpStatus: 400, meaning: "detail isn't brief." },
  bad_post_selection: { httpStatus: 400, meaning: "post_selection isn't all, answer, latest or none." },
  bad_is_public: { httpStatus: 400, meaning: "is_public isn't true or false." },
  bad_text_markdown: { httpStatus: 400, meaning: "text_markdown is empty or over 8,000 characters." },
  bad_author_kind: { httpStatus: 400, meaning: "author_kind isn't developer or ai." },
  bad_debug_context: { httpStatus: 400, meaning: "debug_context isn't an object of its five text fields, up to 8,000 characters in all." },
  bad_images_base64: { httpStatus: 400, meaning: "images_base64 isn't a list of base64 images." },
  too_many_images: { httpStatus: 400, meaning: "A post carries more than 10 images." },
  bad_reopen: { httpStatus: 400, meaning: "reopen isn't true or false." },
  bad_answer_post_id: { httpStatus: 400, meaning: "answer_post_id isn't a post ID or null." },
  bad_reason: { httpStatus: 400, meaning: "reason isn't one of the report reasons." },
  post_limit: { httpStatus: 429, meaning: "The account has posted 100 times in the last day." },
  image_limit: { httpStatus: 429, meaning: "The account has uploaded 200 forum images in the last day." },
  not_yours: { httpStatus: 403, meaning: "Only the developer who started the topic can do that." },
  not_a_question: { httpStatus: 400, meaning: "Only a question has an answer to mark." },
  not_closed: { httpStatus: 400, meaning: "The topic isn't closed, so there's nothing to reopen." },
  not_released: { httpStatus: 400, meaning: "The topic isn't a known issue whose fix is out." },
  cant_vote: { httpStatus: 400, meaning: "The topic doesn't take your vote: it's yours, private, or a discussion." },
  cant_flag: { httpStatus: 400, meaning: "Only public topics others can see can be flagged as misplaced." },
  retired_tool: { httpStatus: 410, meaning: "The tool is retired; the error names the one that replaces it." },
  bad_rating: { httpStatus: 400, meaning: "rating isn't like or dislike." },
  cant_rate_post: { httpStatus: 400, meaning: "Only posts in public topics take likes and dislikes." },
  cant_rate_own_post: { httpStatus: 400, meaning: "Your own posts take no likes or dislikes from you." },
  cant_report: { httpStatus: 400, meaning: "The post can't be reported: it's yours, or Zaisma's." },
} as const satisfies Record<string, { httpStatus: number; meaning: string }>;

/**
 * The errors only the admin MCP answers with, on top of ERROR_CODES (which it uses too, like no_topic).
 * docs/ADMIN-MCP.md lists them, and the same test keeps the two in step.
 */
export const ADMIN_ERROR_CODES = {
  // Reports
  no_report_group: { httpStatus: 404, meaning: "There's no report group with that ID." },
  report_group_closed: { httpStatus: 409, meaning: "Every report in the group is closed already." },
  bad_maximum_group_count: { httpStatus: 400, meaning: "maximum_group_count isn't a whole number from 1 to 100." },
  bad_decision: { httpStatus: 400, meaning: "decision isn't one of the choices the call takes." },
  cant_decide: { httpStatus: 409, meaning: "It can't be decided that way now: get_report_group lists what a report group can, and decide_notice shows again only a held game and holds none that's taken down; decide_country_block lifts only a country the game is blocked in." },
  decision_refused: { httpStatus: 409, meaning: "The decision didn't go through, like putting back an update that matched known abuse material." },
  bad_why: { httpStatus: 400, meaning: "why is blank or over 500 characters." },

  // Notices
  bad_notice_kind: { httpStatus: 400, meaning: "notice_kind isn't copyright or defamation." },
  bad_country_code: { httpStatus: 400, meaning: "country_code isn't a country's two-letter code (ISO 3166-1 alpha-2), like GB." },

  // Precedents
  no_precedent: { httpStatus: 404, meaning: "There's no precedent with that ID." },
  not_proposed: { httpStatus: 409, meaning: "Only a proposed precedent can be approved; one in force changes with set_precedent." },
  bad_precedent: { httpStatus: 400, meaning: "precedent isn't { title, applies_when, why } and its optional fields within their lengths, or the decision sets none (hide_name)." },
  bad_applies_when: { httpStatus: 400, meaning: "applies_when is blank or over 500 characters." },
  bad_can_ai_apply_alone: { httpStatus: 400, meaning: "can_ai_apply_alone isn't true or false, or is true for a precedent that isn't a dismissal." },
  bad_precedent_status: { httpStatus: 400, meaning: "precedent_status isn't active, proposed, retired or all." },

  // Review precedents
  no_review_precedent: { httpStatus: 404, meaning: "There's no review precedent with that ID." },
  not_approvable: { httpStatus: 409, meaning: "Only a drafted or failed review precedent can be approved; one in force is retired and set again with a new decision." },
  incomplete_review_precedent: { httpStatus: 409, meaning: "The review precedent has no name, no 'applies when', no test game, or (for a hold) no content rule, so it can't be tested yet." },
  bad_review_precedent_status: { httpStatus: 400, meaning: "review_precedent_status isn't proposed, testing, active, failed, retired or all." },

  // The forum queue
  bad_reply_text_markdown: { httpStatus: 400, meaning: "reply_text_markdown is blank or over 8,000 characters." },
  bad_known_issue: { httpStatus: 400, meaning: "known_issue isn't { title, workaround, roadmap_item } with a title, or null." },
  bad_severity: { httpStatus: 400, meaning: "severity isn't urgent, high, normal or low." },
  cant_merge: { httpStatus: 409, meaning: "A topic can't be merged into itself." },
  already_merged: { httpStatus: 409, meaning: "The topic is merged, or being merged, into another, so that one is the one to make a known issue." },

  // Chat reviews
  no_chat_review: { httpStatus: 404, meaning: "There's no kept chat message with that ID: it was a false alarm and deleted, or its year is up." },
  bad_chat_review_status: { httpStatus: 400, meaning: "chat_review_status isn't pending, needs_person, confirmed, waiting or all." },

  // Publishing before the beta
  unknown_username: { httpStatus: 404, meaning: "No account has that username." },

  // Announcements
  no_announcement: { httpStatus: 404, meaning: "There's no announcement with that ID." },
  announcement_ended: { httpStatus: 409, meaning: "The announcement has ended already." },
  bad_text: { httpStatus: 400, meaning: "text isn't 1 to 200 characters of one or two plain sentences: no markup, links or line breaks." },
  bad_link_url: { httpStatus: 400, meaning: "link_url isn't an https address or a path on zaisma.com starting with /." },
  bad_link_label: { httpStatus: 400, meaning: "link_label isn't 1 to 30 characters, or was given without link_url." },
} as const satisfies Record<string, { httpStatus: number; meaning: string }>;

export type ErrorCode = keyof typeof ERROR_CODES | keyof typeof ADMIN_ERROR_CODES;
/** Every code, the developer API's and the admin MCP's, with its HTTP status. */
export const EVERY_ERROR_CODE: Record<ErrorCode, { httpStatus: number; meaning: string }> = { ...ERROR_CODES, ...ADMIN_ERROR_CODES };

/** What went wrong besides its code, as an error answer gives it. */
export interface ErrorDetails {
  /** What happened, in one sentence. */
  message: string;
  /** The input at fault, like play_modes[1].play_style; leave out when no one input is. */
  field?: string | null;
  /** What to do about it, naming the call or value when there is one. */
  fix: string;
  /** How long to wait first, when waiting helps. */
  retryAfterSec?: number | null;
  /** Where the developer confirms it themselves on zaisma.com, for confirmation_needed alone. */
  confirmUrl?: string;
}

/** An error answer: { "error": { code, message, field, fix, retry_after_sec } }, the same in the API and the MCP; confirmation_needed adds confirm_url. */
export interface ErrorAnswer {
  error: { code: ErrorCode; message: string; field: string | null; fix: string; retry_after_sec: number | null; confirm_url?: string };
}

/** A refusal the developer API and MCP answer with, as docs/NAMING.md describes. */
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly field: string | null;
  readonly fix: string;
  readonly retryAfterSec: number | null;
  readonly confirmUrl: string | null;

  constructor(
    readonly code: ErrorCode,
    details: ErrorDetails,
  ) {
    super(details.message);
    this.httpStatus = EVERY_ERROR_CODE[code].httpStatus;
    this.field = details.field ?? null;
    this.fix = details.fix;
    this.retryAfterSec = details.retryAfterSec ?? null;
    this.confirmUrl = details.confirmUrl ?? null;
  }

  /** What happened and what to do, for a page to show. */
  get messageWithFix(): string {
    return `${this.message} ${this.fix}`;
  }

  toAnswer(): ErrorAnswer {
    return { error: { code: this.code, message: this.message, field: this.field, fix: this.fix, retry_after_sec: this.retryAfterSec, ...(this.confirmUrl ? { confirm_url: this.confirmUrl } : {}) } };
  }
}

/** Seconds until a limit over the last day frees up, from the oldest thing it counted. */
export function secondsUntilDayPasses(oldestAtMs: number | null | undefined, nowMs = Date.now()): number {
  return Math.max(1, Math.ceil(((oldestAtMs ?? nowMs) + 86400_000 - nowMs) / 1000));
}
