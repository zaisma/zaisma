/**
 * Every error the developer API and MCP answer with (docs/NAMING.md, Errors), in one list: a stable,
 * lowercase snake_case code per problem, never reused for another, with its HTTP status and what it
 * means, and what a page tells a person (messageForPeople: what happened and what to do, in a page's words,
 * naming no call or field). docs/DEVELOPER-API.md lists every code, and test/site/errors.test.ts keeps the
 * two in step. Codes named bad_<field> mean that input's value isn't one the call takes; `field` says where.
 */
interface ErrorCodeEntry {
  httpStatus: number;
  /** What it means, for the caller: listed in docs/DEVELOPER-API.md. */
  meaning: string;
  /** What happened and what to do, for a page to show: never a call or field name (docs/DESIGN.md, Voice). */
  messageForPeople: string;
}

export const ERROR_CODES = {
  // Signing in and requests
  no_key: { httpStatus: 401, meaning: "The MCP was called without an API key or a connected app's token.", messageForPeople: "This needs an API key or a connected app. Make an API key in Settings." },
  bad_key: { httpStatus: 401, meaning: "The API key isn't valid: removed, mistyped or never made.", messageForPeople: "That API key doesn't work: it was removed, mistyped or never made. Make a new one in Settings." },
  key_turned_off: { httpStatus: 401, meaning: "The API key was found in public and turned off for good.", messageForPeople: "That API key was found in public, so Zaisma turned it off for good. Make a new one in Settings." },
  key_ended: { httpStatus: 401, meaning: "The API key reached the end date it was made with.", messageForPeople: "That API key reached its end date. Make a new one in Settings." },
  access_token_ended: { httpStatus: 401, meaning: "A connected app's access token is past its hour; the app refreshes it by itself.", messageForPeople: "The connected app's sign-in ran out. The app signs in again by itself; if it doesn't, connect it again." },
  token_not_for_api: { httpStatus: 401, meaning: "A connected app's token works only at the MCP, not the REST API.", messageForPeople: "A connected app's sign-in works only with Zaisma's MCP. Use an API key for anything else." },
  signed_out: { httpStatus: 401, meaning: "No API key, and no signed-in session.", messageForPeople: "You're signed out. Sign in and try again." },
  no_account: { httpStatus: 401, meaning: "The account isn't finished yet.", messageForPeople: "Your account isn't finished yet. Finish making it, then try again." },
  bad_origin: { httpStatus: 403, meaning: "A call with a session came from another site.", messageForPeople: "This came from another site, so Zaisma refused it. Open the page on zaisma.com and try again." },
  key_not_allowed: { httpStatus: 403, meaning: "The API key is limited to other games, or its access doesn't cover the call.", messageForPeople: "That API key can't do this: it's limited to other games or to less access. Make a key that covers it in Settings." },
  slow_down: { httpStatus: 429, meaning: "Too many calls in a minute.", messageForPeople: "Too many requests in a minute. Wait a moment and try again." },
  not_found: { httpStatus: 404, meaning: "There's no API call at that path.", messageForPeople: "That address doesn't exist on Zaisma." },
  bad_method: { httpStatus: 405, meaning: "The path doesn't take that method.", messageForPeople: "That address doesn't take this kind of request." },
  gone: { httpStatus: 410, meaning: "The call was removed, like the first feedback calls.", messageForPeople: "That was removed from Zaisma." },
  bad_json: { httpStatus: 400, meaning: "The body isn't a JSON object.", messageForPeople: "Zaisma couldn't read what was sent. Try again." },
  json_too_big: { httpStatus: 413, meaning: "The JSON body is over the call's size limit.", messageForPeople: "What was sent is too large. Send less at once." },
  unknown_field: { httpStatus: 400, meaning: "A field, argument or query parameter the call doesn't take.", messageForPeople: "Something was sent that this doesn't take. Reload the page and try again." },
  missing_field: { httpStatus: 400, meaning: "A field the call needs wasn't sent.", messageForPeople: "Something this needs is missing. Fill in every field and try again." },
  wrong_id_kind: { httpStatus: 400, meaning: "An ID of another kind was sent, like an image ID as version_id.", messageForPeople: "An ID of the wrong kind was sent. Reload the page and try again." },
  internal_error: { httpStatus: 500, meaning: "Something broke on Zaisma's side.", messageForPeople: "Something broke on Zaisma's side. Try again in a minute; if it keeps happening, message Zaisma." },

  // Games
  no_game: { httpStatus: 404, meaning: "You have no game with that slug.", messageForPeople: "You have no game with that link name." },
  bad_slug: { httpStatus: 400, meaning: "The link name isn't lowercase letters, numbers and single hyphens, or is reserved.", messageForPeople: "A link name is lowercase letters, numbers and single hyphens, and some names are kept for Zaisma. Pick another." },
  slug_taken: { httpStatus: 409, meaning: "Another game has that link name, or a deleted game had it.", messageForPeople: "Another game has that link name, or had it. Pick another." },
  too_many_games: { httpStatus: 403, meaning: "The account has as many games as it can have.", messageForPeople: "Your account has as many games as an account can. Delete one to make another." },
  publishing_not_open: { httpStatus: 403, meaning: "Until the beta, only accounts Zaisma adds can make, upload and publish games.", messageForPeople: "Until the beta, only accounts Zaisma adds can make, upload and publish games." },
  bad_title: { httpStatus: 400, meaning: "A game's, topic's or precedent's title is empty or too long.", messageForPeople: "A title can't be empty or longer than the field allows. Write a shorter one." },
  bad_description: { httpStatus: 400, meaning: "The description isn't text of up to 500 characters.", messageForPeople: "A description is up to 500 characters. Shorten it." },
  bad_visibility: { httpStatus: 400, meaning: "visibility isn't draft, listed, unlisted or private.", messageForPeople: "Pick who can find the game: listed, unlisted, private or draft." },
  bad_devices: { httpStatus: 400, meaning: "devices isn't a list of phone, tablet and computer.", messageForPeople: "Pick the devices from phone, tablet and computer." },
  bad_genres: { httpStatus: 400, meaning: "genres isn't a list of up to 3 of Zaisma's genres.", messageForPeople: "Pick up to 3 of Zaisma's genres." },
  bad_controls: { httpStatus: 400, meaning: "controls isn't a list of touch, keyboard_mouse and gamepad.", messageForPeople: "Pick the controls from touch, keyboard and mouse, and gamepad." },
  bad_screen_orientation: { httpStatus: 400, meaning: "screen_orientation isn't portrait, landscape, either or null.", messageForPeople: "Pick portrait, landscape or either for the screen." },
  bad_play_modes: { httpStatus: 400, meaning: "play_modes isn't a list of play modes, or one of them is wrong.", messageForPeople: "One of the ways to play isn't one Zaisma knows. Check Players and save again." },
  bad_cloud_saves_enabled: { httpStatus: 400, meaning: "cloud_saves_enabled isn't true or false.", messageForPeople: "A setting is on or off, nothing else. Reload the page and save again." },
  bad_account_offer_enabled: { httpStatus: 400, meaning: "account_offer_enabled isn't true or false.", messageForPeople: "A setting is on or off, nothing else. Reload the page and save again." },
  bad_deleted_account_erase_enabled: { httpStatus: 400, meaning: "deleted_account_erase_enabled isn't true or false.", messageForPeople: "A setting is on or off, nothing else. Reload the page and save again." },
  bad_friend_joins_enabled: { httpStatus: 400, meaning: "friend_joins_enabled isn't true or false.", messageForPeople: "A setting is on or off, nothing else. Reload the page and save again." },
  bad_performance_measuring_enabled: { httpStatus: 400, meaning: "performance_measuring_enabled isn't true or false.", messageForPeople: "A setting is on or off, nothing else. Reload the page and save again." },
  bad_room_browsing: { httpStatus: 400, meaning: "room_browsing isn't page, game or off.", messageForPeople: "Pick where players browse rooms: on the game page, in the game, or nowhere." },
  bad_multiplayer_mode: { httpStatus: 400, meaning: "multiplayer_mode isn't none, relay or own.", messageForPeople: "Pick how online play runs: none, Zaisma's relay, or your own server." },
  bad_account_requirement: { httpStatus: 400, meaning: "account_requirement isn't none, multiplayer or whole_game.", messageForPeople: "Pick when players need an account: never, for online play, or for the whole game." },
  bad_minimum_player_age: { httpStatus: 400, meaning: "minimum_player_age_years isn't 13, 16 or 18.", messageForPeople: "The minimum age is 13, 16 or 18." },
  accounts_needed_for_minimum_age: { httpStatus: 400, meaning: "A game for 16 or 18 and up needs account_requirement whole_game, since only accounts have an age.", messageForPeople: "A game for 16 or 18 and up needs an account for the whole game, since only accounts have an age." },
  content_needs_minimum_age: { httpStatus: 409, meaning: "A version shows lifelike gore, which plays only in games for 16 and up.", messageForPeople: "A version shows lifelike gore, which plays only in games for 16 and up. Set the game for 16 and up, or upload a version without it." },
  screenshot_needed: { httpStatus: 409, meaning: "A listed game needs at least one screenshot.", messageForPeople: "A listed game needs at least one screenshot. Add one first." },
  bad_links: { httpStatus: 400, meaning: "links isn't a list of up to 20 { link_name, destination_url, is_on_game_page } with names of their own and https addresses that aren't link shorteners, IP addresses, addresses with a user name, or on Zaisma's own domains.", messageForPeople: "A link needs a name of its own and an https address, and can't be a link shortener, an IP address or a Zaisma address. A game has up to 20." },
  bad_own_server_urls: { httpStatus: 400, meaning: "own_server_urls isn't a list of up to 5 server addresses like wss://play.example.com, or one is an IP address, this computer or on Zaisma's own domains.", messageForPeople: "A server address looks like wss://play.example.com, a game has up to 5, and none can be an IP address, localhost or a Zaisma address." },
  bad_game_server_allowed_hosts: { httpStatus: 400, meaning: "game_server_allowed_hosts isn't a list of up to 20 host names (like discord.com or *.example.com), or one is an IP address or on Zaisma's own domains.", messageForPeople: "The game server reaches up to 20 host names, like discord.com or *.example.com, and none can be an IP address or a Zaisma address." },
  built_in_server: { httpStatus: 403, meaning: "The game runs a game server built into Zaisma, which only Zaisma changes.", messageForPeople: "This game runs a game server built into Zaisma, which only Zaisma changes." },
  game_removed: { httpStatus: 403, meaning: "Zaisma took the game down, so this can't change.", messageForPeople: "Zaisma took this game down, so this can't change. Message Zaisma to ask why." },
  needs_confirm: { httpStatus: 409, meaning: "Hiding a game players can play, or ending a live room, needs the developer's OK.", messageForPeople: "Players are playing in this now. Confirm to take it away from them." },
  bad_period_duration_days: { httpStatus: 400, meaning: "period_duration_days isn't a whole number from 1 to 90.", messageForPeople: "Pick a period from 1 to 90 days." },
  bad_cursor: { httpStatus: 400, meaning: "cursor isn't a next_cursor from an earlier answer.", messageForPeople: "That list is out of date. Reload the page." },

  // Players
  no_player: { httpStatus: 404, meaning: "No account has that player ID: a guest's, or a deleted account's.", messageForPeople: "No account has that player ID. It belongs to a guest or a deleted account." },

  // Covers, screenshots, backgrounds and other images
  bad_kind: { httpStatus: 400, meaning: "kind isn't one of the choices the call takes.", messageForPeople: "That isn't a kind of picture this takes." },
  not_an_image: { httpStatus: 415, meaning: "The file isn't an image of a type the call takes.", messageForPeople: "That file isn't a picture of a type Zaisma takes. Send a different file." },
  image_too_big: { httpStatus: 413, meaning: "The image is over 5 MB.", messageForPeople: "The picture is over 5 MB. Send a smaller one." },
  bad_image_dimensions: { httpStatus: 400, meaning: "The image is under 320 px or over 8,192 px on a side.", messageForPeople: "A picture is 320 to 8,192 pixels on each side." },
  not_square: { httpStatus: 400, meaning: "A square cover isn't as wide as it is tall, or is under 512 px.", messageForPeople: "A square cover is as wide as it is tall, and at least 512 pixels." },
  too_many_screenshots: { httpStatus: 400, meaning: "The game has 8 screenshots already.", messageForPeople: "The game has 8 screenshots, the most it can have. Remove one to add another." },
  image_refused: { httpStatus: 422, meaning: "The image can't be used.", messageForPeople: "Zaisma can't use this picture. Send a different one." },
  no_image: { httpStatus: 404, meaning: "The game has no image with that ID.", messageForPeople: "The game has no such picture. Reload the page." },
  no_file: { httpStatus: 400, meaning: "A form on Zaisma's pages was sent without its image.", messageForPeople: "No picture was chosen. Choose one and send it again." },
  bad_background_shape: { httpStatus: 400, meaning: "A wide background is landscape (1.3 to 2.4 times as wide as tall), a phone background portrait (1.6 to 2.4 times as tall as wide), and its long side at least 1600 px.", messageForPeople: "A wide background is 1.3 to 2.4 times as wide as tall, a phone background 1.6 to 2.4 times as tall as wide, and the long side is at least 1,600 pixels." },
  not_a_shader: { httpStatus: 400, meaning: "A shader's pass isn't GLSL text with a mainImage function, or has its own main(), a #version or #extension line, texture2D, iMouse or sound.", messageForPeople: "That isn't a shader Zaisma can draw. Each pass is GLSL with a mainImage function and no main of its own." },
  shader_too_big: { httpStatus: 413, meaning: "A shader's pass is over 64 KB.", messageForPeople: "A shader pass is over 64 KB. Make it shorter." },
  bad_buffers: { httpStatus: 400, meaning: "buffers isn't a list of { buffer_name, source, channels } with buffer_name a, b, c or d, each once.", messageForPeople: "A shader has buffers a, b, c and d, each at most once." },
  too_many_buffers: { httpStatus: 400, meaning: "A shader has more than 4 buffers.", messageForPeople: "A shader has at most 4 buffers." },
  bad_shader_channel: { httpStatus: 400, meaning: "A channel isn't { channel_index 0 to 3, input_kind, buffer_name or image_id, filter, wrap }, names a buffer the shader doesn't have, or a texture that isn't an approved shader_texture of the game.", messageForPeople: "One of the shader's channels points at a buffer it doesn't have, or at a texture that isn't approved for this game." },
  shader_texture_too_big: { httpStatus: 413, meaning: "A shader texture is over 8 MB, or over 4,096 px on a side.", messageForPeople: "A shader texture is up to 8 MB and 4,096 pixels on a side." },
  too_many_shader_textures: { httpStatus: 400, meaning: "The game has 16 shader textures already, or a shader's channels name more than 4.", messageForPeople: "A game has up to 16 shader textures, and a shader reads up to 4." },
  shader_texture_in_use: { httpStatus: 409, meaning: "A shader the game keeps reads this texture.", messageForPeople: "A shader this game keeps reads this texture. Remove that shader first." },
  daily_shader_checks_used: { httpStatus: 429, meaning: "The account has run 100 shader checks in the last day.", messageForPeople: "Your account ran 100 shader checks in the last day. More free up through the day." },
  shader_check_unavailable: { httpStatus: 503, meaning: "Zaisma can't draw shaders here right now, so it can't check one.", messageForPeople: "Zaisma can't draw shaders right now, so it can't check this one. Try again later." },
  no_shader: { httpStatus: 404, meaning: "The game has no shader with that ID.", messageForPeople: "The game has no such shader. Reload the page." },
  bad_screen: { httpStatus: 400, meaning: "screen isn't wide or phone.", messageForPeople: "Pick the wide screen or the phone screen." },
  bad_background_source: { httpStatus: 400, meaning: "source isn't zaisma, image or shader, or wide (which only phone takes).", messageForPeople: "Pick Zaisma's background, a picture or a shader." },
  background_not_ready: { httpStatus: 409, meaning: "The image or shader isn't this game's, isn't approved yet, or is for the other screen.", messageForPeople: "That picture or shader isn't approved for this game yet, or is for the other screen." },
  bad_color: { httpStatus: 400, meaning: "The color isn't #RRGGBB.", messageForPeople: "A color is written like #1A2B3C." },

  // Uploading versions
  bad_files: { httpStatus: 400, meaning: "files isn't a list of files in the shape the call takes.", messageForPeople: "The files weren't sent in a shape Zaisma takes. Upload them again." },
  bad_path: { httpStatus: 400, meaning: "A file's path is absolute, has . or .. in it, has control characters or is over 200 characters.", messageForPeople: "A file's path can't start at the top of the disk, use . or .., hold control characters or run past 200 characters." },
  hidden_file: { httpStatus: 400, meaning: "A file or folder's name starts with a dot.", messageForPeople: "A file or folder's name starts with a dot. Leave hidden files out." },
  precompressed_file: { httpStatus: 400, meaning: "A file is pre-compressed (.gz or .br).", messageForPeople: "A file is pre-compressed (.gz or .br). Send the files unpacked; the upload command unpacks them for you." },
  file_type_not_allowed: { httpStatus: 400, meaning: "A file is of a type games can't have.", messageForPeople: "A file is of a type games can't have. Leave it out." },
  file_too_big: { httpStatus: 413, meaning: "A file is over 500 MB.", messageForPeople: "A file is over 500 MB. Split it or make it smaller." },
  duplicate_path: { httpStatus: 400, meaning: "Two files share a path.", messageForPeople: "Two files share a path. Keep one." },
  no_index_html: { httpStatus: 400, meaning: "There's no index.html at the top of the game.", messageForPeople: "A game needs an index.html at the top of its folder." },
  too_many_files: { httpStatus: 400, meaning: "The game has more than 20,000 files.", messageForPeople: "A game has at most 20,000 files." },
  game_too_big: { httpStatus: 413, meaning: "The game is over 2 GB (10 GB with Zaisma Pro).", messageForPeople: "The game is over 2 GB, or 10 GB with Zaisma Pro." },
  too_big_for_mcp: { httpStatus: 413, meaning: "upload_files and check_game take up to 5 MB; bigger builds go through the upload command.", messageForPeople: "Builds over 5 MB go up through the upload command, not the MCP." },
  bad_base64: { httpStatus: 400, meaning: "Something sent as base64 isn't valid base64.", messageForPeople: "Something sent as base64 isn't valid. Send it again." },
  files_missing: { httpStatus: 409, meaning: "Some of the version's files haven't been sent yet.", messageForPeople: "Some of the version's files haven't arrived yet. Finish the upload." },
  bad_patch_notes: { httpStatus: 400, meaning: "patch_notes isn't text of up to 2,000 characters.", messageForPeople: "Patch notes are up to 2,000 characters." },
  bad_publish_when_approved: { httpStatus: 400, meaning: "publish_when_approved isn't true or false.", messageForPeople: "Publishing when it passes is on or off." },
  bad_match_update_mode: { httpStatus: 400, meaning: "match_update_mode isn't next_match or now, or it came without publish_when_approved.", messageForPeople: "Running matches update at the next match or now, and only when the version publishes as it passes." },
  version_limit: { httpStatus: 429, meaning: "The game has had 20 versions in the last day (100 with Zaisma Pro).", messageForPeople: "The game had 20 versions in the last day, or 100 with Zaisma Pro. More free up through the day." },
  no_content_length: { httpStatus: 411, meaning: "A file was sent without a Content-Length header.", messageForPeople: "A file came without its size. Upload it again." },
  file_needs_parts: { httpStatus: 413, meaning: "A file over 95 MB was sent in one go.", messageForPeople: "Files over 95 MB go up in parts. The upload command does that." },
  no_body: { httpStatus: 400, meaning: "A file was sent without a body.", messageForPeople: "A file came empty. Upload it again." },
  hash_mismatch: { httpStatus: 400, meaning: "A file doesn't match the SHA-256 it was sent as.", messageForPeople: "A file changed on the way. Upload it again." },
  forbidden_file: { httpStatus: 400, meaning: "A file is a program or an archive, whatever its name says.", messageForPeople: "A file is a program or an archive, whatever its name says. Leave it out." },
  bad_size_bytes: { httpStatus: 400, meaning: "size_bytes isn't a whole number above 0.", messageForPeople: "A file's size has to be above 0." },
  bad_part_number: { httpStatus: 400, meaning: "A part's number isn't from 1 to 10,000.", messageForPeople: "A part is numbered from 1 to 10,000." },
  no_upload_id: { httpStatus: 400, meaning: "A part was sent without its upload_id.", messageForPeople: "A part came without its upload. Start the upload again." },
  bad_part_size: { httpStatus: 400, meaning: "A part is empty, over 50 MB or has no Content-Length header.", messageForPeople: "A part is empty or over 50 MB. Upload it again." },
  upload_closed: { httpStatus: 400, meaning: "The upload_id isn't an open upload any more.", messageForPeople: "That upload is closed. Start it again." },
  bad_parts: { httpStatus: 400, meaning: "The finishing call isn't { upload_id, parts: [{ part_number, etag }] }.", messageForPeople: "The upload's parts weren't listed in the shape Zaisma takes. Start the upload again." },
  parts_incomplete: { httpStatus: 400, meaning: "The parts sent don't make a whole file.", messageForPeople: "The parts sent don't make a whole file. Upload the missing ones." },

  // Versions and publishing
  no_version: { httpStatus: 404, meaning: "The game has no version with that ID.", messageForPeople: "The game has no such version. Reload the page." },
  bad_time: { httpStatus: 400, meaning: "A time isn't an ISO time in the range it takes: scheduled_publish_at from a few minutes to 90 days ahead, a tester link's ends_at from now to a year ahead, a database restore's restore_to_at within the last 30 days and not before the game was made, a room message's send_at from 10 seconds to 90 days ahead, an announcement's starts_at from an hour ago to 90 days ahead and its ends_at after now and starts_at and at most 60 days after it.", messageForPeople: "That time is outside the range this takes. Pick another." },
  still_scanning: { httpStatus: 409, meaning: "The version is still being scanned.", messageForPeople: "This version is still being scanned. It usually takes under a minute." },
  not_approved: { httpStatus: 409, meaning: "The version didn't pass review, so it can't be published.", messageForPeople: "This version didn't pass review, so it can't be published." },

  // Tester links
  bad_name: { httpStatus: 400, meaning: "A tester link's or sign-in app's name isn't 1 to 60 characters, or a sign-in app's says Zaisma.", messageForPeople: "A name is 1 to 60 characters, and a sign-in app's name can't say Zaisma." },
  too_many_tester_links: { httpStatus: 403, meaning: "The game has 50 tester links on already.", messageForPeople: "The game has 50 tester links, the most it can have. Turn one off to add another." },
  no_tester_link: { httpStatus: 404, meaning: "The game has no tester link on with that ID.", messageForPeople: "The game has no such tester link. Reload the page." },
  bad_version_choice: { httpStatus: 400, meaning: "version_choice isn't live, newest_passed or picked, or picked_version_id doesn't go with it.", messageForPeople: "Pick which version the link opens: the live one, the newest that passed, or one you pick." },

  // Sign in with Zaisma
  bad_redirect_urls: { httpStatus: 400, meaning: "redirect_urls isn't a list of 1 to 10 https URLs (http only for localhost) without #fragments.", messageForPeople: "A sign-in app has 1 to 10 return addresses, each https (http only for localhost) and without a # part." },
  bad_replace_client_secret: { httpStatus: 400, meaning: "replace_client_secret isn't true or false, or the app is public and has no client secret.", messageForPeople: "Only a private app has a secret to replace." },
  too_many_sign_in_apps: { httpStatus: 403, meaning: "The account has 20 sign-in apps already.", messageForPeople: "Your account has 20 sign-in apps, the most it can have. Delete one to add another." },
  no_sign_in_app: { httpStatus: 404, meaning: "You have no sign-in app with that ID.", messageForPeople: "You have no such sign-in app. Reload the page." },

  // Webhooks
  bad_destination_kind: { httpStatus: 400, meaning: "destination_kind isn't endpoint_url or game_server.", messageForPeople: "A webhook goes to an address or to the game server." },
  bad_endpoint_url: { httpStatus: 400, meaning: "endpoint_url isn't an https URL on a name (no IP address, user name or #fragment), or it's on Zaisma's own domains, or it's given for a webhook to a game server, which has none.", messageForPeople: "A webhook's address is https, on a name rather than an IP address, without a user name or # part, and not on Zaisma. A webhook to a game server has no address." },
  bad_event_kinds: { httpStatus: 400, meaning: "event_kinds isn't a list of 1 or more of the webhook event kinds.", messageForPeople: "Pick at least one event." },
  bad_game_slugs: { httpStatus: 400, meaning: "game_slugs isn't null or a list of 1 to 50 of your games' slugs, or, for a webhook to a game server, a list of the one game whose server it is.", messageForPeople: "Pick up to 50 of your games, or all of them. A webhook to a game server is for its own game alone." },
  bad_replace_signing_secret: { httpStatus: 400, meaning: "replace_signing_secret isn't true or false.", messageForPeople: "Replacing the signing secret is yes or no." },
  too_many_webhooks: { httpStatus: 403, meaning: "The account has 10 webhooks already.", messageForPeople: "You have as many webhooks as an account can. Remove one, or add these events to one you have." },
  no_webhook: { httpStatus: 404, meaning: "You have no webhook with that ID.", messageForPeople: "You have no such webhook. Reload the page." },

  // The game database (the same codes a game server's DatabaseError has, and answer_too_big)
  bad_sql: { httpStatus: 400, meaning: "The SQL isn't one statement SQLite takes, or statements isn't a list of { sql, values }.", messageForPeople: "That isn't one statement SQLite can run." },
  bad_values: { httpStatus: 400, meaning: "values isn't a list of text, numbers, null and { blob_base64 } for the SQL's ?s.", messageForPeople: "A value for the SQL isn't text, a number, empty or a blob." },
  bad_player_id: { httpStatus: 400, meaning: "player_id isn't a player ID (player_…).", messageForPeople: "That isn't a player ID." },
  too_many_rows: { httpStatus: 400, meaning: "A statement answered more than 10,000 rows.", messageForPeople: "That answers more than 10,000 rows. Ask for fewer." },
  integer_too_large: { httpStatus: 400, meaning: "A statement answered a whole number past 2^53, which JavaScript can't hold exactly.", messageForPeople: "A number in the answer is too large for JavaScript to hold exactly. Read it as text." },
  answer_too_big: { httpStatus: 400, meaning: "The rows answered come to more than 8 MB.", messageForPeople: "The rows come to more than 8 MB. Ask for fewer." },
  database_full: { httpStatus: 403, meaning: "The statement would grow the game's storage (its database and kept rooms) past the 10 GB a game can keep.", messageForPeople: "The game's storage is full at 10 GB, the most a game can keep. Delete rows or kept rooms the game no longer needs." },
  database_unavailable: { httpStatus: 503, meaning: "The game's database didn't answer.", messageForPeople: "The game's database didn't answer. Try again in a minute." },
  database_restore_unavailable: { httpStatus: 501, meaning: "This Zaisma's game databases can't go back in time: its storage keeps no history, like a local preview.", messageForPeople: "This copy of Zaisma keeps no history of game databases, so it can't go back in time." },
  no_database_restore: { httpStatus: 404, meaning: "The game has no database restore with that ID in the last 30 days.", messageForPeople: "The game has no such database restore in the last 30 days." },
  bad_secret_name: { httpStatus: 400, meaning: "A secret's name isn't capitals, digits and underscores starting with a capital, up to 64 characters.", messageForPeople: "A secret's name is capitals, digits and underscores, starts with a capital, and is up to 64 characters." },
  bad_secret_value: { httpStatus: 400, meaning: "secret_value isn't text of up to 8 KB.", messageForPeople: "A secret is up to 8 KB of text." },
  no_secret: { httpStatus: 404, meaning: "The game has no secret by that name.", messageForPeople: "The game has no secret by that name." },
  too_many_secrets: { httpStatus: 403, meaning: "The game has 50 secrets, the most it can have.", messageForPeople: "The game has 50 secrets, the most it can have. Delete one to add another." },
  secrets_unavailable: { httpStatus: 503, meaning: "The game's secrets didn't answer.", messageForPeople: "The game's secrets didn't answer. Try again in a minute." },
  no_kept_room: { httpStatus: 404, meaning: "The game has no kept room with that code.", messageForPeople: "The game has no kept room with that code." },

  // Reaching live rooms
  no_room: { httpStatus: 404, meaning: "The game has no live room with that code on Zaisma.", messageForPeople: "No room with that code is running now." },
  no_player_in_room: { httpStatus: 404, meaning: "That player isn't in the room now.", messageForPeople: "That player isn't in the room now." },
  bad_room_message: { httpStatus: 400, meaning: "message isn't plain JSON of up to 16 KB.", messageForPeople: "That message can't be sent: keep it to plain data, up to 16 KB." },
  bad_labels: { httpStatus: 400, meaning: "labels isn't a list of up to 4 labels, each { label_name, label_value } of text.", messageForPeople: "Pick rooms by up to 4 labels, each a name and its text." },
  bad_kick_message: { httpStatus: 400, meaning: "A kick's message isn't text of up to 200 characters.", messageForPeople: "What the player is told can be up to 200 characters." },
  bad_end_message: { httpStatus: 400, meaning: "An end's message isn't text of up to 200 characters.", messageForPeople: "What players are told can be up to 200 characters." },
  room_busy: { httpStatus: 429, meaning: "The room took 100 room messages in the last second.", messageForPeople: "The room is busy. Send it again in a second." },
  every_room_send_limit: { httpStatus: 429, meaning: "The game sent to every room 10 times in the last minute, from its game server, the API and the MCP together.", messageForPeople: "The game sent to every room 10 times in the last minute. Wait a minute and send again." },
  too_many_scheduled_room_messages: { httpStatus: 409, meaning: "The game has 100 scheduled room messages waiting, the most it can have.", messageForPeople: "The game has 100 messages waiting to go out, the most it can have. Cancel one first." },
  no_scheduled_room_message: { httpStatus: 404, meaning: "The game has no scheduled room message with that ID waiting.", messageForPeople: "That message isn't waiting to go out: it went out already, or was cancelled." },
  dump_too_big: { httpStatus: 413, meaning: "dump_sql is over 5 MB: import a dump in parts, each ending on a whole statement.", messageForPeople: "The dump is over 5 MB. Import it in parts, each ending on a whole statement." },

  // Hosting and credit
  hosting_paused: { httpStatus: 429, meaning: "The game's hosting is paused this month: its free allowance, its budget or its developer's credit is used. It starts again when the month resets, the budget is raised or credit is added.", messageForPeople: "The game's hosting is paused this month: its free hosting, its budget or your credit is used. Raise its budget or add credit to start it again now." },
  confirmation_needed: { httpStatus: 403, meaning: "This needs the developer's passkey on zaisma.com (turning spending on or up, or connecting a Stripe account): confirm_url is where they do it.", messageForPeople: "This needs your passkey on zaisma.com. Open the link to confirm it." },
  bad_monthly_budget_cents: { httpStatus: 400, meaning: "monthly_budget_cents isn't a whole number of cents of at least 100 ($1), or null for no paid hosting.", messageForPeople: "A budget is at least $1 a month, or none for free hosting only." },
  bad_top_up_amount: { httpStatus: 400, meaning: "amount_cents isn't a whole number of cents from 1,000 ($10) to 100,000 ($1,000).", messageForPeople: "A top-up is from $10 to $1,000." },
  account_not_protected: { httpStatus: 403, meaning: "The account has no passkey and no email yet, and a top-up keeps a card, so it needs one of them first: add a passkey or an email on zaisma.com/account.", messageForPeople: "A top-up keeps your card, so your account needs a passkey or an email first. Add one in your account." },
  no_top_up: { httpStatus: 404, meaning: "You have no top-up with that ID.", messageForPeople: "You have no such top-up." },
  no_spending_request: { httpStatus: 404, meaning: "You have no spending request with that ID.", messageForPeople: "You have no such spending request." },
  top_up_not_refundable: { httpStatus: 409, meaning: "The top-up has nothing left to refund: it's spent, refunded, or over 30 days old.", messageForPeople: "This top-up has nothing left to refund: it's spent, refunded or over 30 days old." },
  already_pro: { httpStatus: 409, meaning: "The developer already has a Zaisma Pro subscription (running, cancelled until the month ends, or a renewal Stripe is retrying), so there's nothing to start.", messageForPeople: "You already have Zaisma Pro." },
  pro_not_refundable: { httpStatus: 409, meaning: "Zaisma Pro's payment can't be refunded: only the first payment, within 14 days of it, and only while it's the only one.", messageForPeople: "Only the first Zaisma Pro payment is refunded, within 14 days of it, while it's the only one." },
  not_pro: { httpStatus: 409, meaning: "There's nothing to cancel or resume: the developer has no Zaisma Pro, or it's already cancelled (or isn't cancelled).", messageForPeople: "There's no Zaisma Pro here to cancel or resume." },
  stripe_unavailable: { httpStatus: 503, meaning: "Stripe didn't answer, or this Zaisma has no Stripe account set up.", messageForPeople: "Stripe didn't answer. Try again in a minute." },

  // A game server's logs
  bad_room_code: { httpStatus: 400, meaning: "room_code isn't a room's code: six characters like K7Q2MX.", messageForPeople: "A room code is six characters, like K7Q2MX." },
  bad_minimum_level: { httpStatus: 400, meaning: "minimum_level isn't debug, info, warn or error.", messageForPeople: "Pick a level: debug, info, warn or error." },
  bad_source_kind: { httpStatus: 400, meaning: "source_kind isn't room, request, schedule or webhook.", messageForPeople: "Pick a source: room, request, schedule or webhook." },
  bad_search_text: { httpStatus: 400, meaning: "search_text is empty or over 200 characters.", messageForPeople: "A search is 1 to 200 characters." },
  bad_maximum_line_count: { httpStatus: 400, meaning: "maximum_line_count isn't a whole number from 1 to 500.", messageForPeople: "Ask for 1 to 500 lines." },
  two_log_cursors: { httpStatus: 400, meaning: "get_logs got both cursor and new_lines_cursor.", messageForPeople: "Read older lines or newer lines, not both at once." },

  // Items and purchases
  no_item: { httpStatus: 404, meaning: "The game has no item by that name.", messageForPeople: "The game has no item by that name." },
  too_many_items: { httpStatus: 400, meaning: "The game has 1,000 items, the most it can have.", messageForPeople: "The game has 1,000 items, the most it can have." },
  bad_item: { httpStatus: 400, meaning: "An item's name, title, description, kind, category, price or local prices isn't one set_item takes; field says which.", messageForPeople: "One of the item's details isn't one Zaisma takes. Check its name, title, price and kind." },
  unsupported_currency: { httpStatus: 400, meaning: "Zaisma doesn't price in that currency.", messageForPeople: "Zaisma doesn't price in that currency." },
  price_too_low: { httpStatus: 400, meaning: "The price is under the least Stripe charges in its currency.", messageForPeople: "That price is under the least Stripe charges in its currency." },
  refund_policy_needed: { httpStatus: 409, meaning: "A game that sells anything states its refund policy first.", messageForPeople: "A game that sells anything states its refund policy first." },
  bad_refund_policy: { httpStatus: 400, meaning: "refund_policy isn't no_refunds, unused_within_14_days, within_14_days, own_words or null.", messageForPeople: "Pick a refund policy: no refunds, unused items within 14 days, anything within 14 days, or your own words." },
  bad_refund_policy_text: { httpStatus: 400, meaning: "refund_policy_text isn't up to 600 characters of plain words, or doesn't go with refund_policy own_words.", messageForPeople: "A refund policy in your own words is up to 600 characters of plain text." },
  bad_own_payment_categories: { httpStatus: 400, meaning: "own_payment_categories isn't a list of cosmetic, gameplay, content and currency.", messageForPeople: "Pick what the game sells through its own payments: cosmetics, gameplay, content or currency." },
  item_has_owners: { httpStatus: 409, meaning: "Players bought or were granted the item, so it can't be removed; take its price off to stop selling it.", messageForPeople: "Players own this item, so it stays. Take its price off to stop selling it." },
  bad_item_count: { httpStatus: 400, meaning: "item_count isn't a whole number from 1 to 1,000, isn't 1 for a permanent item, or makes a buy's total more than 99,999,999 minor units.", messageForPeople: "The count is from 1 to 1,000, and 1 for a permanent item." },
  bad_game_account_id: { httpStatus: 400, meaning: "game_account_id isn't text of up to 200 characters, or null.", messageForPeople: "A game account ID is up to 200 characters." },
  bad_purchase_source: { httpStatus: 400, meaning: "purchase_source isn't sale or grant.", messageForPeople: "Pick sales or grants." },
  bad_purchase_status: { httpStatus: 400, meaning: "purchase_status isn't pending, completed, failed, refunded or charged_back.", messageForPeople: "Pick a status: pending, completed, failed, refunded or charged back." },
  no_purchase: { httpStatus: 404, meaning: "The game has no purchase with that ID.", messageForPeople: "The game has no such purchase." },
  already_refunded: { httpStatus: 409, meaning: "The purchase was refunded or charged back already.", messageForPeople: "This purchase was refunded or charged back already." },
  stripe_not_connected: { httpStatus: 409, meaning: "Selling with the buy sheet, and refunding a sale, go through the developer's own Stripe account, which isn't connected: connect_stripe_account.", messageForPeople: "Selling and refunding go through your own Stripe account, which isn't connected. Connect Stripe first." },
  stripe_cannot_take_payments: { httpStatus: 409, meaning: "The developer's Stripe account is connected, but Stripe hasn't turned on payments for it yet: finish setting it up on Stripe's dashboard.", messageForPeople: "Your Stripe account is connected, but Stripe hasn't turned on payments yet. Finish setting it up on Stripe." },
  bad_is_stripe_tax_used: { httpStatus: 400, meaning: "is_stripe_tax_used isn't true or false.", messageForPeople: "Stripe Tax is on or off." },
  bad_amount_minor_units: { httpStatus: 400, meaning: "amount_minor_units isn't a whole number from 1 to what's left of the sale to refund.", messageForPeople: "A refund is from the smallest unit of the currency up to what's left of the sale." },
  purchase_not_paid: { httpStatus: 409, meaning: "The sale wasn't paid (pending or failed), so there's nothing to refund.", messageForPeople: "This sale wasn't paid, so there's nothing to refund." },
  not_for_sale: { httpStatus: 409, meaning: "The item has no price, so players can't buy it; it's only granted.", messageForPeople: "This item has no price, so players can't buy it. It's only granted." },
  receipts_unavailable: { httpStatus: 503, meaning: "Zaisma couldn't sign the purchase's receipt just now. A grant answered with it wasn't made, so trying again grants it once.", messageForPeople: "Zaisma couldn't sign the receipt, so nothing was granted. Try again." },
  bad_purchase_delivery: { httpStatus: 400, meaning: "purchase_delivery isn't game, game_server or own_server.", messageForPeople: "Pick where purchases go: the game, its game server, or your own server." },
  no_game_server: { httpStatus: 409, meaning: "purchase_delivery game_server needs a game server, on Zaisma or the developer's own, and the game has none.", messageForPeople: "The game has no game server to send purchases to." },
  already_handled: { httpStatus: 409, meaning: "The purchase was handed over already, or its refund was told already.", messageForPeople: "This purchase was handed over already." },
  handled_by_server: { httpStatus: 409, meaning: "The game's purchases go to its game server or the developer's own server (purchase_delivery), so the game can't mark them handled.", messageForPeople: "This game's purchases go to its server, so the game can't mark them handed over." },
  bad_full_game_item: { httpStatus: 400, meaning: "full_game_item_name doesn't name one of the game's items that's permanent and content, or the game is another game's demo.", messageForPeople: "The full game is one of the game's permanent content items, and a demo can't sell one." },
  full_game_item_in_use: { httpStatus: 409, meaning: "The item is the game's full game (full_game_item_name), so it can't be removed or stop being permanent and content.", messageForPeople: "This item is the full game, so it stays permanent content and can't be removed." },
  bad_demo_game: { httpStatus: 400, meaning: "demo_game_slug isn't another of the developer's games that's free to play, or the game itself is free to play.", messageForPeople: "A demo is another of your games that's free to play, for a game that isn't." },
  account_requirement_locked: { httpStatus: 400, meaning: "A game that sells itself (full_game_item_name) needs account_requirement whole_game, since only accounts own it.", messageForPeople: "A game that sells itself needs an account for the whole game, since only accounts own it." },
  full_game_not_owned: { httpStatus: 403, meaning: "The game sells itself, and the player's account doesn't own it: buy it on its game page.", messageForPeople: "This game is sold, and your account doesn't own it. Buy it on its game page." },

  // Cloud saves
  no_save: { httpStatus: 404, meaning: "The player has no save in the game.", messageForPeople: "The player has no save in this game." },
  no_save_copy: { httpStatus: 404, meaning: "The player's save has no earlier version with that ID.", messageForPeople: "The save has no such earlier version." },
  bad_keys: { httpStatus: 400, meaning: "keys isn't a list of 1 to 100 localStorage keys of up to 1,000 characters.", messageForPeople: "Ask for 1 to 100 save keys of up to 1,000 characters." },
  bad_local_storage_items: { httpStatus: 400, meaning: "local_storage_items isn't an object of localStorage keys and their text (null removes a key in a change).", messageForPeople: "The save's items aren't keys with text." },
  bad_indexeddb_databases: { httpStatus: 400, meaning: "indexeddb_databases isn't a list of databases, each { name, version, stores } as get_save answers them.", messageForPeople: "The save's databases aren't in the shape a save has." },
  save_too_big: { httpStatus: 413, meaning: "The save would be over 5 MB.", messageForPeople: "The save would be over 5 MB." },
  cloud_saves_off: { httpStatus: 409, meaning: "The game has cloud saves off, so it doesn't read saves from players' accounts.", messageForPeople: "This game has cloud saves off." },
  cloud_saves_not_here: { httpStatus: 409, meaning: "Cloud saves don't work here: this is a tester link, or this Zaisma has no accounts. The game page answers it to `Zaisma.saves` and `Zaisma.player.offerAccount()`; no API or MCP call returns it.", messageForPeople: "Cloud saves don't work here: this is a tester link, or this copy of Zaisma has no accounts." },
  save_busy: { httpStatus: 409, meaning: "The player's game kept saving at the same moment, so the change didn't go through.", messageForPeople: "The game was saving at the same moment. Try again." },

  // The developer forum
  no_topic: { httpStatus: 404, meaning: "There's no topic with that ID you can see.", messageForPeople: "There's no such topic, or you can't see it." },
  no_post: { httpStatus: 404, meaning: "There's no post with that ID you can see in the topic.", messageForPeople: "There's no such post, or you can't see it." },
  no_known_issue: { httpStatus: 404, meaning: "There's no known issue with that ID.", messageForPeople: "There's no such known issue." },
  no_media: { httpStatus: 404, meaning: "There's no image there you can see.", messageForPeople: "There's no such picture, or you can't see it." },
  bad_tab: { httpStatus: 400, meaning: "tab isn't latest, top, unanswered, known, yours, messages or bookmarks.", messageForPeople: "That isn't one of the forum's tabs." },
  bad_section: { httpStatus: 400, meaning: "section isn't one of the forum's sections.", messageForPeople: "That isn't one of the forum's sections." },
  bad_category: { httpStatus: 400, meaning: "category isn't one of the forum's categories.", messageForPeople: "Pick one of the forum's categories." },
  no_category: { httpStatus: 400, meaning: "A public topic was sent without its category.", messageForPeople: "Pick a category for a public topic." },
  bad_tag: { httpStatus: 400, meaning: "tag isn't one of the forum's tags.", messageForPeople: "That isn't one of the forum's tags." },
  bad_tags: { httpStatus: 400, meaning: "tags isn't a list of up to 3 of the forum's tags.", messageForPeople: "Pick up to 3 of the forum's tags." },
  bad_topic_status: { httpStatus: 400, meaning: "topic_status isn't one of the statuses.", messageForPeople: "That isn't one of the topic statuses." },
  bad_is_answered: { httpStatus: 400, meaning: "is_answered isn't true or false.", messageForPeople: "Answered is yes or no." },
  bad_maximum_topic_count: { httpStatus: 400, meaning: "maximum_topic_count isn't a whole number from 1 to 30.", messageForPeople: "Ask for 1 to 30 topics." },
  bad_detail: { httpStatus: 400, meaning: "detail isn't brief.", messageForPeople: "That isn't a level of detail the forum shows." },
  bad_post_selection: { httpStatus: 400, meaning: "post_selection isn't all, answer, latest or none.", messageForPeople: "Pick which posts to show: all, the answer, the latest or none." },
  bad_is_public: { httpStatus: 400, meaning: "is_public isn't true or false.", messageForPeople: "Public is yes or no." },
  bad_text_markdown: { httpStatus: 400, meaning: "text_markdown is empty or over 8,000 characters.", messageForPeople: "A post is 1 to 8,000 characters." },
  bad_author_kind: { httpStatus: 400, meaning: "author_kind isn't developer or ai.", messageForPeople: "A post is written by a developer or an AI." },
  bad_debug_context: { httpStatus: 400, meaning: "debug_context isn't an object of its five text fields, up to 8,000 characters in all.", messageForPeople: "The debug details are up to 8,000 characters in all." },
  bad_images_base64: { httpStatus: 400, meaning: "images_base64 isn't a list of base64 images.", messageForPeople: "One of the pictures couldn't be read. Add it again." },
  too_many_images: { httpStatus: 400, meaning: "A post carries more than 10 images.", messageForPeople: "A post carries up to 10 pictures." },
  bad_reopen: { httpStatus: 400, meaning: "reopen isn't true or false.", messageForPeople: "Reopen is yes or no." },
  bad_answer_post_id: { httpStatus: 400, meaning: "answer_post_id isn't a post ID or null.", messageForPeople: "That isn't a post in this topic." },
  bad_reason: { httpStatus: 400, meaning: "reason isn't one of the report reasons.", messageForPeople: "Pick one of the reasons." },
  post_limit: { httpStatus: 429, meaning: "The account has posted 100 times in the last day.", messageForPeople: "Your account posted 100 times in the last day. More free up through the day." },
  image_limit: { httpStatus: 429, meaning: "The account has uploaded 200 forum images in the last day.", messageForPeople: "Your account added 200 forum pictures in the last day. More free up through the day." },
  not_yours: { httpStatus: 403, meaning: "Only the developer who started the topic can do that.", messageForPeople: "Only the developer who started the topic can do that." },
  not_a_question: { httpStatus: 400, meaning: "Only a question has an answer to mark.", messageForPeople: "Only a question has an answer to mark." },
  not_closed: { httpStatus: 400, meaning: "The topic isn't closed, so there's nothing to reopen.", messageForPeople: "The topic isn't closed, so there's nothing to reopen." },
  not_released: { httpStatus: 400, meaning: "The topic isn't a known issue whose fix is out.", messageForPeople: "The topic isn't a known issue whose fix is out." },
  cant_vote: { httpStatus: 400, meaning: "The topic doesn't take your vote: it's yours, private, or a discussion.", messageForPeople: "This topic doesn't take your vote: it's yours, private, or a discussion." },
  cant_flag: { httpStatus: 400, meaning: "Only public topics others can see can be flagged as misplaced.", messageForPeople: "Only public topics others can see can be flagged as misplaced." },
  retired_tool: { httpStatus: 410, meaning: "The tool is retired; the error names the one that replaces it.", messageForPeople: "That was retired and replaced." },
  bad_rating: { httpStatus: 400, meaning: "rating isn't like or dislike.", messageForPeople: "A rating is like or dislike." },
  cant_rate_post: { httpStatus: 400, meaning: "Only posts in public topics take likes and dislikes.", messageForPeople: "Only posts in public topics take likes and dislikes." },
  cant_rate_own_post: { httpStatus: 400, meaning: "Your own posts take no likes or dislikes from you.", messageForPeople: "Your own posts take no likes or dislikes from you." },
  cant_report: { httpStatus: 400, meaning: "The post can't be reported: it's yours, or Zaisma's.", messageForPeople: "This post can't be reported: it's yours, or Zaisma's." },
} as const satisfies Record<string, ErrorCodeEntry>;

/**
 * The errors only the admin MCP answers with, on top of ERROR_CODES (which it uses too, like no_topic).
 * docs/ADMIN-MCP.md lists them, and the same test keeps the two in step.
 */
export const ADMIN_ERROR_CODES = {
  // Reports
  no_report_group: { httpStatus: 404, meaning: "There's no report group with that ID.", messageForPeople: "There's no such report group." },
  report_group_closed: { httpStatus: 409, meaning: "Every report in the group is closed already.", messageForPeople: "Every report in the group is closed already." },
  bad_maximum_group_count: { httpStatus: 400, meaning: "maximum_group_count isn't a whole number from 1 to 100.", messageForPeople: "Ask for 1 to 100 groups." },
  bad_decision: { httpStatus: 400, meaning: "decision isn't one of the choices the call takes.", messageForPeople: "That isn't one of the decisions this takes." },
  cant_decide: { httpStatus: 409, meaning: "It can't be decided that way now: get_report_group lists what a report group can, and decide_notice shows again only a held game and holds none that's taken down; decide_country_block lifts only a country the game is blocked in.", messageForPeople: "That decision can't be made on this now." },
  decision_refused: { httpStatus: 409, meaning: "The decision didn't go through, like putting back an update that matched known abuse material.", messageForPeople: "The decision didn't go through." },
  bad_why: { httpStatus: 400, meaning: "why is blank or over 500 characters.", messageForPeople: "The reason is 1 to 500 characters." },

  // Notices
  bad_notice_kind: { httpStatus: 400, meaning: "notice_kind isn't copyright or defamation.", messageForPeople: "A notice is about copyright or defamation." },
  bad_country_code: { httpStatus: 400, meaning: "country_code isn't a country's two-letter code (ISO 3166-1 alpha-2), like GB.", messageForPeople: "A country is its two-letter code, like GB." },

  // Precedents
  no_precedent: { httpStatus: 404, meaning: "There's no precedent with that ID.", messageForPeople: "There's no such precedent." },
  not_proposed: { httpStatus: 409, meaning: "Only a proposed precedent can be approved; one in force changes with set_precedent.", messageForPeople: "Only a proposed precedent can be approved." },
  bad_precedent: { httpStatus: 400, meaning: "precedent isn't { title, applies_when, why } and its optional fields within their lengths, or the decision sets none (hide_name).", messageForPeople: "The precedent needs a title, when it applies and why, each within its length." },
  bad_applies_when: { httpStatus: 400, meaning: "applies_when is blank or over 500 characters.", messageForPeople: "When it applies is 1 to 500 characters." },
  bad_can_ai_apply_alone: { httpStatus: 400, meaning: "can_ai_apply_alone isn't true or false, or is true for a precedent that isn't a dismissal.", messageForPeople: "Only a dismissal can be applied by the AI alone." },
  bad_precedent_status: { httpStatus: 400, meaning: "precedent_status isn't active, proposed, retired or all.", messageForPeople: "Pick active, proposed, retired or all." },

  // Review precedents
  no_review_precedent: { httpStatus: 404, meaning: "There's no review precedent with that ID.", messageForPeople: "There's no such review precedent." },
  not_approvable: { httpStatus: 409, meaning: "Only a drafted or failed review precedent can be approved; one in force is retired and set again with a new decision.", messageForPeople: "Only a drafted or failed review precedent can be approved." },
  incomplete_review_precedent: { httpStatus: 409, meaning: "The review precedent has no name, no 'applies when', no test game, or (for a hold) no content rule, so it can't be tested yet.", messageForPeople: "The review precedent needs a name, when it applies, a test game and, for a hold, a content rule before it's tested." },
  bad_review_precedent_status: { httpStatus: 400, meaning: "review_precedent_status isn't proposed, testing, active, failed, retired or all.", messageForPeople: "Pick proposed, testing, active, failed, retired or all." },

  // The forum queue
  bad_reply_text_markdown: { httpStatus: 400, meaning: "reply_text_markdown is blank or over 8,000 characters.", messageForPeople: "A reply is 1 to 8,000 characters." },
  bad_known_issue: { httpStatus: 400, meaning: "known_issue isn't { title, workaround, roadmap_item } with a title, or null.", messageForPeople: "A known issue needs a title." },
  bad_severity: { httpStatus: 400, meaning: "severity isn't urgent, high, normal or low.", messageForPeople: "Pick urgent, high, normal or low." },
  cant_merge: { httpStatus: 409, meaning: "A topic can't be merged into itself.", messageForPeople: "A topic can't be merged into itself." },
  already_merged: { httpStatus: 409, meaning: "The topic is merged, or being merged, into another, so that one is the one to make a known issue.", messageForPeople: "This topic is merged into another. Make that one the known issue." },

  // Chat reviews
  no_chat_review: { httpStatus: 404, meaning: "There's no kept chat message with that ID: it was a false alarm and deleted, or its year is up.", messageForPeople: "There's no such kept chat message: it was a false alarm and deleted, or its year is up." },
  bad_chat_review_status: { httpStatus: 400, meaning: "chat_review_status isn't pending, needs_person, confirmed, waiting or all.", messageForPeople: "Pick pending, needs a person, confirmed, waiting or all." },

  // Publishing before the beta
  unknown_username: { httpStatus: 404, meaning: "No account has that username.", messageForPeople: "No account has that username." },

  // Announcements
  no_announcement: { httpStatus: 404, meaning: "There's no announcement with that ID.", messageForPeople: "There's no such announcement." },
  announcement_ended: { httpStatus: 409, meaning: "The announcement has ended already.", messageForPeople: "The announcement has ended already." },
  bad_text: { httpStatus: 400, meaning: "text isn't 1 to 200 characters of one or two plain sentences: no markup, links or line breaks.", messageForPeople: "An announcement is 1 to 200 characters of one or two plain sentences, with no links or line breaks." },
  bad_link_url: { httpStatus: 400, meaning: "link_url isn't an https address or a path on zaisma.com starting with /.", messageForPeople: "A link is an https address or a zaisma.com path starting with /." },
  bad_link_label: { httpStatus: 400, meaning: "link_label isn't 1 to 30 characters, or was given without link_url.", messageForPeople: "A link's words are 1 to 30 characters, and come with a link." },
} as const satisfies Record<string, ErrorCodeEntry>;

export type ErrorCode = keyof typeof ERROR_CODES | keyof typeof ADMIN_ERROR_CODES;
/** Every code, the developer API's and the admin MCP's, with its HTTP status. */
export const EVERY_ERROR_CODE: Record<ErrorCode, ErrorCodeEntry> = { ...ERROR_CODES, ...ADMIN_ERROR_CODES };

/** What went wrong besides its code, as an error answer gives it. */
export interface ErrorDetails {
  /** What happened, in one sentence. */
  message: string;
  /** The input at fault, like play_modes[1].play_style; leave out when no one input is. */
  field?: string | null;
  /** What to do about it, naming the call or value when there is one. */
  fix: string;
  /** What happened and what to do, for a page, when this case needs its own specifics (a count, a name); else the code's. */
  messageForPeople?: string;
  /** How long to wait first, when waiting helps. */
  retryAfterSec?: number | null;
  /** Where the developer confirms it themselves on zaisma.com, for confirmation_needed alone. */
  confirmUrl?: string;
  /** The request the developer approves at confirmUrl, for confirmation_needed when a spending request was made. */
  spendingRequestId?: string;
}

/** An error answer: { "error": { code, message, field, fix, message_for_people, retry_after_sec } }, the same in the API and the MCP; confirmation_needed adds confirm_url. */
export interface ErrorAnswer {
  error: { code: ErrorCode; message: string; field: string | null; fix: string; message_for_people: string; retry_after_sec: number | null; confirm_url?: string; spending_request_id?: string };
}

/** A refusal the developer API and MCP answer with, as docs/NAMING.md describes. */
export class ApiError extends Error {
  readonly httpStatus: number;
  readonly field: string | null;
  readonly fix: string;
  /** What a page shows a person: never `message` and `fix`, which are for the caller. */
  readonly messageForPeople: string;
  readonly retryAfterSec: number | null;
  readonly confirmUrl: string | null;
  readonly spendingRequestId: string | null;

  constructor(
    readonly code: ErrorCode,
    details: ErrorDetails,
  ) {
    super(details.message);
    this.httpStatus = EVERY_ERROR_CODE[code].httpStatus;
    this.field = details.field ?? null;
    this.fix = details.fix;
    this.messageForPeople = details.messageForPeople ?? EVERY_ERROR_CODE[code].messageForPeople;
    this.retryAfterSec = details.retryAfterSec ?? null;
    this.confirmUrl = details.confirmUrl ?? null;
    this.spendingRequestId = details.spendingRequestId ?? null;
  }

  toAnswer(): ErrorAnswer {
    return { error: { code: this.code, message: this.message, field: this.field, fix: this.fix, message_for_people: this.messageForPeople, retry_after_sec: this.retryAfterSec, ...(this.confirmUrl ? { confirm_url: this.confirmUrl } : {}), ...(this.spendingRequestId ? { spending_request_id: this.spendingRequestId } : {}) } };
  }
}

/** Seconds until a limit over the last day frees up, from the oldest thing it counted. */
export function secondsUntilDayPasses(oldestAtMs: number | null | undefined, nowMs = Date.now()): number {
  return Math.max(1, Math.ceil(((oldestAtMs ?? nowMs) + 86400_000 - nowMs) / 1000));
}
