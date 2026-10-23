import { ACCESS_LEVELS, ACCOUNT_EVENT_KINDS, AREA_ACCESS_CHOICES, CONTENT_RULES, CURRENCY_MINIMUM_PRICES, ITEM_CATEGORIES, ITEM_KINDS, PURCHASE_SOURCES, PURCHASE_STATUSES, REFUND_POLICIES, CONTROLS, DEVICES, FORUM_REPORT_REASONS, MINIMUM_PLAYER_AGES, PLAY_STYLES, PLAYER_REPORT_REASONS, REPORT_REASONS, REVIEW_CODES, ROOM_BROWSING, SCREENS, SECURITY_EVENT_DESCRIPTIONS, SIGN_IN_KINDS, SPIKE_THRESHOLDS, SPIKE_WORDS, VISIBILITIES, WEBHOOK_EVENT_KINDS, type IdKind } from "@zaisma/core";
import { BROWSER_NAMES, DEVICE_KINDS, GRAPHICS_FAMILIES, OS_NAMES, PERFORMANCE_CHECK_LIMITS, PERFORMANCE_NOTE_CODES, PLAYER_PERFORMANCE_LIMITS } from "@zaisma/core";
import { CHECK_PROBLEM_CODES, MAXIMUM_PROBLEM_COUNT } from "../../../packages/cli/check.mjs";

/**
 * The developer API's answers as JSON Schema, and the admin MCP's at the end: the MCPs' output
 * schemas, and what the tests check every answer against. Names follow docs/NAMING.md, and
 * test/site/naming.test.ts checks them.
 */

export type Schema = Record<string, unknown>;

const describe = (schema: Schema, description?: string): Schema => (description ? { ...schema, description } : schema);
const orNull = (schema: Schema): Schema => {
  const type = schema.type as string | string[];
  return { ...schema, type: [...(Array.isArray(type) ? type : [type]), "null"], ...(schema.enum ? { enum: [...(schema.enum as unknown[]), null] } : {}) };
};

export const text = (description?: string) => describe({ type: "string" }, description);
export const url = (description?: string) => describe({ type: "string", format: "uri" }, description);
/** A calendar day: YYYY-MM-DD in UTC. */
export const date = (description?: string) => describe({ type: "string", format: "date" }, description);
/** A point in time: ISO 8601 in UTC, named <event>_at. */
export const isoTime = (description?: string) => describe({ type: "string", format: "date-time" }, description);
/** An ID of one kind: <kind>_<random> (docs/NAMING.md, IDs). */
export const idOf = (kind: IdKind, description?: string) => describe({ type: "string", pattern: `^${kind}_[a-z0-9]+$` }, description);
export const countOf = (description?: string) => describe({ type: "integer", minimum: 0 }, description);
export const number = (description?: string) => describe({ type: "number", minimum: 0 }, description);
export const yes = (description?: string) => describe({ type: "boolean" }, description);
export const list = (items: Schema, description?: string) => describe({ type: "array", items }, description);
export const nullable = orNull;
/** One of a fixed list; the description says what each value means. */
export function choice(values: Record<string, string> | readonly string[], lead?: string): Schema {
  const meanings = Array.isArray(values) ? null : (values as Record<string, string>);
  const keys = meanings ? Object.keys(meanings) : [...(values as readonly string[])];
  const said = meanings ? keys.map((key) => `${key}: ${meanings[key]}`).join(". ") : "";
  return describe({ type: "string", enum: keys }, [lead, said].filter(Boolean).join(" ") || undefined);
}
/** An object whose keys are always all there. */
export function object(properties: Record<string, Schema>, description?: string): Schema {
  return describe({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }, description);
}

export const VISIBILITY = choice(
  { draft: "only you and tester links", listed: "on Zaisma for everyone", unlisted: "only people with the link", private: "only you and tester links, after being public" },
  "Who can see the game.",
);
export const REVIEW_STATUS = choice(
  { pending: "no version has passed review yet", live: "players can play it", held: "paused while Zaisma checks it", removed: "taken down by Zaisma" },
  "Zaisma's review of the game, separate from visibility.",
);
export const MULTIPLAYER_MODE = choice(
  { none: "single-player, or the game's own servers", relay: "Zaisma passes each message to the others", own: "the game's own game server runs on Zaisma rooms", "built-in": "a game server built into Zaisma, set by Zaisma" },
  "Multiplayer on Zaisma rooms.",
);
export const ROOM_BROWSING_CHOICE = choice(
  { page: "open rooms listed on the game page and to the game", game: "only to the game", off: "nowhere; room codes and invite links still work" },
  "For games on Zaisma rooms: where open rooms are listed.",
);
export const ACCOUNT_REQUIREMENT_CHOICE = choice(
  { none: "guests play everything", multiplayer: "guests play alone; only signed-in players get player passes", whole_game: "players sign in before Play; only signed-in players get player passes" },
  "What the game needs a Zaisma account for.",
);
export const MINIMUM_PLAYER_AGE_CHOICE = describe(
  { type: "integer", enum: [...MINIMUM_PLAYER_AGES] },
  "The youngest age that can play: 13 (everyone), 16 or 18. Above 13 the whole game needs an account, since only accounts have an age; younger accounts can't find or open the game.",
);
export const PLAY_MODE = object({
  mode: choice({ single: "single-player", local: "together on one device or screen", online: "each on their own device" }),
  minimum_player_count: nullable(countOf("2 or more; null for single")),
  maximum_player_count: nullable(countOf("null for no limit, or for single")),
  play_style: nullable(choice(PLAY_STYLES, "null for single.")),
});

export const CONTENT_RULE = choice(CONTENT_RULES, "The content rule it's about, as zaisma.com/legal/content-rules#<rule> words it.");
const REVIEW_CODE = describe({ type: "string", enum: Object.keys(REVIEW_CODES) }, "Stable, from one list (docs/DEVELOPER-API.md, Holds and takedowns); search_forum finds others who had it.");
/** Why Zaisma held, rejected or took something down: the same parts as an error's, plus the content rule. */
export const reviewReason = (description: string) =>
  object(
    {
      code: REVIEW_CODE,
      message: text("What happened and why, in plain words."),
      content_rule: nullable(CONTENT_RULE),
      fix: text("What to do about it, naming the call when there is one."),
    },
    description,
  );

/** One of the game's registered links (docs/DEVELOPER-API.md, Registered links). */
export const LINK = object({
  link_name: text("What the game opens it by: Zaisma.links.open(link_name)."),
  destination_url: url("The https address it opens; the game can add a path and query under it."),
  is_on_game_page: yes("The game page shows it too."),
  who_can_open: choice(
    { everyone: "it's on a trusted store, payment or video site, so it opens for guests and under-18 accounts too", signed_in_adults: "it opens for signed-in adults; anyone else sees \"This link can't be opened here.\"", nobody: "its site is listed for malware or phishing (review_reason says so)" },
    "Who it opens for.",
  ),
  review_reason: nullable(reviewReason("Why it opens for nobody; null when it opens.")),
});

/** A country whose players can't open the game, on a notice under its law (country-blocks.ts). */
const COUNTRY_BLOCK = object({
  country_code: text("The country, ISO 3166-1 alpha-2, like GB."),
  country_name: text("Its name in English, like United Kingdom."),
  review_reason: reviewReason("Why: country_law_notice, with which law and what the notice names, and the fix."),
  blocked_at: isoTime(),
});

/** What each item category means, the words the game page's label uses. */
export const ITEM_CATEGORY_CHOICE = choice(
  { cosmetic: "changes only how things look", gameplay: "helps you play, like a revive or a boost", content: "more of the game, like levels or an expansion", currency: "in-game money" } satisfies Record<(typeof ITEM_CATEGORIES)[number], string>,
  "What kind of thing it is, which the game page's label shows.",
);
const CURRENCY_CODE = describe({ type: "string", enum: Object.keys(CURRENCY_MINIMUM_PRICES) }, "The currency, lowercase ISO 4217 as Stripe writes it: usd, eur, brl.");
const PRICE_MINOR_UNITS = describe({ type: "integer", minimum: 0 }, "The price in the currency's smallest unit (cents, pence; yen are whole): 199 for $1.99. The price a game shows is what the player pays, tax included.");
export const REFUND_POLICY_CHOICE = choice(
  { no_refunds: "no refunds", unused_within_14_days: "refunds for items not used yet, within 14 days", within_14_days: "refunds within 14 days", own_words: "the policy in refund_policy_text" } satisfies Record<(typeof REFUND_POLICIES)[number], string>,
  "The game's refund policy, which it states before anything goes on sale.",
);

/** What a game page says the game sells, from its items. */
export const PURCHASE_LABEL = object(
  {
    categories: list(ITEM_CATEGORY_CHOICE, "The categories of what it sells (items with a price, and what it sells through its own payments), in the order cosmetic, gameplay, content, currency; [] for no in-game purchases."),
    has_own_payments: yes("It sells some things through its own payments (own_payment_categories), outside Zaisma's buy sheet."),
  },
  "What the game page says the game sells. It comes from the items, so it can't drift.",
);

export const GAME = object({
  slug: text("The game's link name, as in zaisma.com/g/<slug>"),
  page_url: url(),
  title: text(),
  description: text(),
  visibility: VISIBILITY,
  review_status: REVIEW_STATUS,
  review_reason: nullable(reviewReason("Why it's held or removed; null while it's pending or live.")),
  country_blocks: list(COUNTRY_BLOCK, "Countries whose players can't open the game, on a notice from a court, regulator or police there under a law US law doesn't share; everyone else still can. [] for none."),
  devices: list(choice(DEVICES)),
  controls: list(choice(CONTROLS)),
  screen_orientation: nullable(choice(SCREENS, "null: not set.")),
  play_modes: nullable(list(PLAY_MODE, "How it's played; null: not set.")),
  cloud_saves_enabled: yes("Signed-in players' browser saves are copied to their account."),
  account_offer_enabled: yes("Guests with progress get the \"Keep your progress\" card offering an account after 5 minutes of play. Zaisma.player.offerAccount() shows it whenever the game likes, either way, at most once a visit and not for 3 days after Not now."),
  deleted_account_erase_enabled: yes("When a player who played the game deletes their Zaisma account, Zaisma erases their rows from the game database (every table with a player_id column) as well as sending account_deleted to your webhooks. false: you handle account_deleted events yourself."),
  multiplayer_mode: MULTIPLAYER_MODE,
  friend_joins_enabled: yes("Friends' Join on zaisma.com takes players into this game's rooms. On by default; off grays it as \"This game doesn't take joins\". One room turns it off with room.setFriendJoinsEnabled(false)."),
  performance_measuring_enabled: yes("Zaisma measures how the game runs for players (load time, frame rate, stutter, crashes), only as totals; off, get_stats has no performance."),
  room_browsing: ROOM_BROWSING_CHOICE,
  account_requirement: ACCOUNT_REQUIREMENT_CHOICE,
  minimum_player_age_years: MINIMUM_PLAYER_AGE_CHOICE,
  game_server_allowed_hosts: list(text(), "The hosts its game server can call with fetch(), like discord.com, or *.example.com for every name under example.com; [] for none."),
  own_server_urls: list(text(), "The game's own servers players' browsers connect to, like wss://play.example.com, named in the game's menu; [] for none."),
  links: list(LINK, "Its registered links, which the game opens with Zaisma.links.open; [] for none."),
  details_waiting_for_review: nullable(object({ title: nullable(text()), description: nullable(text()) }, "A new title or description waiting for the listing check (about a minute) or a person before players see it.")),
  title_listing_reason: nullable(reviewReason("Why the title keeps the game off Zaisma's lists (a famous name, a tag) or held it (a fake reward); null when nothing does. The game still plays by its link.")),
  glass_tint_color: nullable(describe({ type: "string", pattern: "^#[0-9a-f]{6}$" }, "The color Zaisma tints its glass with over the game's background, like #6b3fa0; Zaisma still decides how thick the glass is. null: no tint.")),
  monthly_budget_cents: nullable(countOf("What the game may draw from your credit each month past its free hosting, in cents (5000 is $50); null: no paid hosting, so it pauses at its free allowance.")),
  purchase_label: PURCHASE_LABEL,
  refund_policy: nullable(REFUND_POLICY_CHOICE),
  refund_policy_text: nullable(text("The refund policy in the developer's own words, with refund_policy own_words; null otherwise.")),
  updated_at: isoTime(),
});

export const GAME_ALERT = object({
  kind: choice({
    game_removed: "Zaisma took the game down",
    game_held: "players can't open the game while Zaisma checks it",
    game_blocked_in_country: "players in one country can't open the game, on a notice under that country's law (country_blocks says which and why); everyone else still can",
    version_rejected: "the newest version was rejected",
    version_held: "a version is waiting for a person at Zaisma",
    link_flagged: "a registered link opens for nobody: its site is listed for malware or phishing",
    game_off_lists: "the listing check found something on a cover or the title that keeps the listed game off Zaisma's lists (home, All games, browse, search engines) until it's fixed; it still plays by its link",
    hosting_paused: "the game's hosting is paused this month (its free allowance with no budget, its budget, or your credit is used): no new rooms, relayed connections or game server requests start, and running matches get an hour to finish",
    database_full: "the game's storage (its database and kept rooms) reached the 10 GB a game can keep, so the database can change and delete rows but not grow, and no more rooms can be kept",
    hosting_nearly_paused: "80% of the month's free hosting is used, and the game has no budget to go on past it",
    hosting_budget_nearly_used: "80% of the game's monthly budget is used",
    database_nearly_full: "the game's storage is 80% of the 10 GB a game can keep",
    player_erase_failed: "Zaisma couldn't erase players who deleted their accounts from the game database; the fix names their player IDs for erase_player",
    reports_open: "player reports are waiting for Zaisma",
  }),
  message: text("What needs attention, in plain words."),
  fix: text("What to do about it, naming the call when there is one."),
  version_id: nullable(idOf("version", "The version it's about; null when it's about the whole game.")),
});
/** One distinct error of a game's own game server, as get_stats lists it and a game_server_error_found event carries it. */
export const GAME_SERVER_ERROR = object({
  kind: choice({ crash: "a handler threw", stopped: "a call ran on too long" }),
  message: text("The error, with the file and line it came from."),
  occurrence_count: countOf(),
  version_id: idOf("version"),
  first_at: isoTime(),
  last_at: isoTime(),
});

export const GAME_ALERTS = list(GAME_ALERT, "What needs the developer's attention, most urgent first; [] when nothing does.");
/** A game in list_games: its details and what needs attention in it. */
export const LISTED_GAME = object({ ...(GAME.properties as Record<string, Schema>), alerts: GAME_ALERTS });

const FINDING_SEVERITY = choice({ reject: "the version can't go live", hold: "a person at Zaisma looks first", info: "a note: the version isn't held or rejected for it" });
export const FINDING = object({
  code: REVIEW_CODE,
  severity: FINDING_SEVERITY,
  message: text("What the scan found, in plain words."),
  content_rule: nullable(CONTENT_RULE),
  path: nullable(text("The file it's in, if any.")),
  fix: text("What to do about it."),
});

/** A note on how a version started in Chrome, or on files that could be much smaller. Notes never hold a version. */
export const PERFORMANCE_NOTE = object({
  code: choice(Object.fromEntries(Object.entries(PERFORMANCE_NOTE_CODES).map(([code, { meaning }]) => [code, meaning]))),
  message: text("What it found, with its numbers."),
  path: nullable(text("The file it's about, if one.")),
  saved_size_bytes: nullable(countOf("About how much smaller the download gets with the fix; null when it isn't about size or can't be told.")),
  fix: text("What to do about it."),
});

export const PERFORMANCE_CHECK = object(
  {
    check_status: choice({
      waiting: "the version passed and waits for Chrome, usually under a minute",
      checking: "running in Chrome now",
      checked: "done; see the numbers and notes",
      over_daily_limit: `not measured: the developer's ${PERFORMANCE_CHECK_LIMITS.maximumDailyCheckCount} checks today are used; versions are measured again from midnight UTC`,
      could_not_run: "Chrome couldn't run it on Zaisma's side; nothing for the developer to fix",
    }),
    checked_at: nullable(isoTime("When the run finished; null until it has.")),
    browser_description: text('Where it ran, like "Chrome 141 on a computer with no graphics card": loading, memory and errors are like a player\'s; frame rate isn\'t measured here.'),
    loading_duration_sec: nullable(number("Seconds from opening the game until it drew its first frame; null when nothing was drawn or it hasn't run.")),
    start_download_size_bytes: nullable(countOf("Bytes downloaded before the first frame, as sent (compressed).")),
    start_file_count: nullable(countOf("Files downloaded before the first frame.")),
    start_memory_size_bytes: nullable(countOf("JavaScript and WebAssembly memory 5 seconds after the first frame; graphics memory isn't counted.")),
    longest_start_task_duration_ms: nullable(countOf("The longest the page froze in one go while starting.")),
    notes: list(PERFORMANCE_NOTE, "Run notes first, then asset notes; [] when there's nothing to say. Notes never hold a version."),
  },
  "How the version started in headless Chrome once it passed the scan, and what would make it much smaller.",
);

const SCAN_STATUS = choice({ scanning: "being scanned, usually under a minute", held: "waiting for a person at Zaisma, or for the developer's next free review (see findings)", approved: "passed; it can be previewed and published", rejected: "can't be published; see findings" });

/** When running matches get a version as it goes live (match_update_mode). */
export const MATCH_UPDATE_MODE = choice({ next_match: "running matches finish on the version they started; new ones get it (the default)", now: "every live match switches to it within seconds, in the same room; the game server may hold it until a good moment, up to 5 minutes" });

export const VERSION = object({
  id: idOf("version"),
  file_count: countOf(),
  size_bytes: countOf(),
  scan_status: SCAN_STATUS,
  has_threads: yes("Whether the build needs threads (SharedArrayBuffer): it runs only in Chrome and Edge, and the game page tells other browsers' players."),
  is_live: yes("This is the version players get."),
  patch_notes: text(),
  preview_url: nullable(url("A private link to play this version, for the developer and their AI, once it's approved. A fresh one comes every time; each works for a day.")),
  preview_url_expires_at: nullable(isoTime("When this preview_url stops working: at least a day from now.")),
  published_at: nullable(isoTime("When it last went live.")),
  scheduled_publish_at: nullable(isoTime("When it goes live by itself, if it's scheduled.")),
  match_update_mode: MATCH_UPDATE_MODE,
  created_at: isoTime(),
  review_reason: nullable(reviewReason("A person's or a report's decision: why a person rejected it, or a report paused it. null otherwise.")),
  findings: list(FINDING, "What the scan found: what holds or rejects it, and notes that don't."),
  replaced_by_version_id: nullable(idOf("version", "The newer version that replaced this one while it waited; null when none did.")),
  performance_check: nullable(PERFORMANCE_CHECK),
});

/** What the game check finds (packages/cli/check.mjs): the same answer from check_game, POST /check and zaisma check --json. */
export const CHECK_PROBLEM = object({
  code: describe({ type: "string", enum: Object.keys(CHECK_PROBLEM_CODES) }, "Stable, from one list (docs/DEVELOPER-API.md, Checking a game). The file-list codes are the API's own error codes."),
  problem_kind: choice({ refused: "Zaisma refuses the upload as it is", broken: "it uploads, but this part won't work on Zaisma" }),
  is_fixed_by_upload_command: yes("zaisma upload (npx @zaisma/cli upload) fixes it itself, in what it uploads; upload_files and the API don't."),
  message: text("What it found, in plain words."),
  path: nullable(text("The file it's in, if any.")),
  quote: nullable(text("The text it's about, up to 120 characters, to search the file for; null when it's about a file as a whole.")),
  fix: text("What to do about it."),
});
export const GAME_CHECK_FIELDS = {
  file_count: countOf("Files checked."),
  size_bytes: countOf("Their size together."),
  problems: list(CHECK_PROBLEM, `In file order; [] when nothing would stop the game working on Zaisma. Up to ${MAXIMUM_PROBLEM_COUNT}.`),
  omitted_problem_count: countOf("Problems past the first 200, left out; 0 almost always."),
  performance_notes: list(PERFORMANCE_NOTE, "Files that could be much smaller (textures as KTX2, WAV audio, models without compression, development builds), each with about what it saves and the fix; [] when none. They never stop an upload."),
};
export const GAME_CHECK = object(GAME_CHECK_FIELDS);

export const IMAGE = object({
  id: idOf("image"),
  kind: choice({
    cover: "landscape cover",
    square: "square cover, shown on phones",
    screenshot: "a screenshot",
    share: "the picture shared links show instead of the cover",
    background: "a background for wide screens: the game's world behind Zaisma's glass, with no title on it",
    phone_background: "a background composed for a tall phone screen",
    shader_texture: "a picture a background shader reads through a channel; image matching approves it at once",
  }),
  review_status: choice({ pending: "only you see it until the listing check (about a minute) or a person approves it", approved: "shown to players", rejected: "not shown" }),
  review_reason: nullable(reviewReason("Why it wasn't approved; null otherwise.")),
  listing_reason: nullable(reviewReason("Why this cover keeps the game off Zaisma's lists, though it shows on the game page (text, an overlay, a famous name, a subject not in the game), or held the game (a fake reward); null when nothing does.")),
  width_px: countOf(),
  height_px: countOf(),
  size_bytes: countOf(),
  image_url: url(),
  created_at: isoTime(),
});

/** One of a shader pass's channels, as add_shader takes it with every default filled in. */
export const SHADER_CHANNEL = object({
  channel_index: describe({ type: "integer", minimum: 0, maximum: 3 }, "0 to 3: the pass reads it as iChannel0 to iChannel3."),
  input_kind: choice({ buffer: "one of the shader's buffers (buffer_name): its picture from this frame if it's drawn before this pass, else its last frame (its own last frame for itself)", texture: "one of the game's shader textures (image_id)" }),
  buffer_name: nullable(choice(["a", "b", "c", "d"], "With input_kind buffer; null otherwise.")),
  image_id: nullable(idOf("image", "With input_kind texture: an approved image of kind shader_texture; null otherwise.")),
  filter: choice({ linear: "smooth (a texture's with mipmaps)", nearest: "each texel as it is, as for data" }),
  wrap: choice({ clamp: "the edge texel goes on past the edge (a buffer's default)", repeat: "the picture tiles (a texture's default)" }),
});

/** What the check measured at one quality level. */
export const SHADER_QUALITY_CHECK = object({
  quality_level: describe({ type: "integer", enum: [0, 1, 2] }, "The iQuality it was drawn at: 0 for phones and slow devices, 1, 2 for desktops. A shader that never reads iQuality is timed once, at 0."),
  check_frame_ms: number("The check's median time to draw one 640 by 360 frame at this level, every pass, in milliseconds on a software renderer (far slower than any GPU), scaled to the renderer's speed."),
  maximum_check_frame_ms: number("The most check_frame_ms may be at this level: 75 at 0, 150 at 1, 300 at 2."),
});

export const SHADER = object({
  id: idOf("shader"),
  screen: choice({ wide: "for desktops and tablets", phone: "composed for a tall phone screen" }),
  review_status: choice({ pending: "waiting for its check (a minute or two), or for a person when the check asks for one", approved: "passed: set_background can show it", rejected: "didn't pass; review_reason says why" }),
  review_reason: nullable(reviewReason("Why it didn't pass: a pass didn't compile, a frame took too long at a quality level, it flashes, or it has words or a logo in it; null otherwise.")),
  quality_checks: list(SHADER_QUALITY_CHECK, "What the check measured at each quality level it timed: all three when has_quality_levels, else level 0; [] until the check ran."),
  has_quality_levels: yes("Whether its source reads iQuality, so the check times it at levels 0, 1 and 2, and players' devices pick a level."),
  flash_count: nullable(countOf("The most times it flashed in any one second of the check, at any level; over 3 is refused. null until the check ran.")),
  still_url: nullable(url("Its still frame at 2 seconds (1920 by 1080, or 960 by 540 with buffers; turned round for phone), drawn at quality 2 for wide and 0 for phone: shown under reduced motion and wherever it can't run. null until the check saved it.")),
  frame_urls: list(url(), "Frames the check drew over its first 30 seconds, for the developer to look at; [] until the check saved them."),
  image: object({ source_url: url("The image pass's source as sent, for a live preview: only the developer, signed in, opens it until it's approved."), channels: list(SHADER_CHANNEL, "What the image pass's channels read; [] for none.") }, "The image pass, which draws the background each frame after the buffers."),
  buffers: list(object({ buffer_name: choice(["a", "b", "c", "d"]), source_url: url("The buffer's source as sent, opened like image's."), channels: list(SHADER_CHANNEL) }), "Its buffers, a to d, each drawn to a picture kept between frames; [] for none."),
  buffer_count: countOf("How many buffers it has, up to 4."),
  texture_count: countOf("How many shader textures its channels read, up to 4."),
  texture_image_ids: list(idOf("image"), "The shader textures its channels read, each once."),
  size_bytes: countOf("Its passes' sources together."),
  created_at: isoTime(),
});

/** A note a check before sending answers with: worth fixing, never a reason a shader is refused. */
export const SHADER_CHECK_NOTE = object({
  code: choice({ shimmers_when_small: "fine detail that flickers from frame to frame when it's drawn small, as on phones", forces_thick_glass: "contrast that makes Zaisma's glass tint 70% or more to keep words over it readable, hiding most of it" }),
  message: text("What the check saw."),
  fix: text("What to change."),
});

/** What check_shader answers: what the shader check would measure, with notes and a picture of it under Zaisma's glass. */
export const SHADER_CHECK = object({
  compile_error: nullable(text("The compiler's first error, a buffer's starting with its name, with line numbers the pass's own; null when every pass compiled.")),
  quality_checks: list(SHADER_QUALITY_CHECK, "Each quality level timed, as add_shader's check would; a level after one far too slow isn't drawn. [] when it didn't compile."),
  flash_count: nullable(countOf("The most times it flashed in any one second; add_shader's check refuses over 3. null when it didn't compile.")),
  is_glass_smoked: nullable(yes("Whether Zaisma would put smoked glass over it (light words) rather than light glass (dark words), from its still; null when it wasn't drawn.")),
  glass_tint_pct: nullable(number("How strongly that glass is tinted to keep words readable, from 30 to 95; 70 or more is forces_thick_glass. null when it wasn't drawn.")),
  notes: list(SHADER_CHECK_NOTE, "Worth fixing, but never a reason it's refused; [] when there's nothing."),
  sheet_url: nullable(url("A picture of it: wide and phone under Zaisma's glass, small, what changes between two frames (speckle there is shimmer) and its pixels close up, with each level's time. Anyone with the link can open it until sheet_expires_at. null when it wasn't drawn or image matching couldn't clear it.")),
  sheet_expires_at: nullable(isoTime("When sheet_url stops working: a day after the check.")),
});

export const BACKGROUND = object({
  screen: choice({ wide: "desktops and tablets", phone: "phones" }),
  source: choice({ zaisma: "Zaisma's own background", image: "one of the game's background images (image_id)", shader: "one of the game's shaders (shader_id)", wide: "phone only: phones show the wide background" }),
  image_id: nullable(idOf("image")),
  shader_id: nullable(idOf("shader")),
  still_url: nullable(url("The picture it shows: the image, or the shader's still. null for Zaisma's own, and for phone following wide.")),
});

export const TESTER = object({
  id: idOf("tester"),
  name: text("Who it's for."),
  link_url: url("The secret link to share."),
  version_choice: choice({ live: "opens the live version", newest_passed: "opens the newest version that passed the scan, published or not", picked: "opens the version in picked_version_id" }),
  picked_version_id: nullable(idOf("version", "The version a picked link opens; null for the other choices.")),
  ends_at: nullable(isoTime("When it stops opening the game by itself; null until it's turned off.")),
  created_at: isoTime(),
  last_opened_at: nullable(isoTime("To the hour.")),
});

/** A developer's site or app that players sign in to with Zaisma (OpenID Connect). */
export const SIGN_IN_APP = object({
  id: idOf("sign_in_app", "The app's ID: give it to your OpenID Connect library as the client_id."),
  name: text("What players see when they sign in."),
  kind: choice({ confidential: "a site or server that keeps the client secret on its server", public: "a page or phone app with no server; it signs in with PKCE alone" }, "OAuth's client type."),
  redirect_urls: list(url(), "The exact URLs a sign-in can go back to: the redirect_uri your site sends must be one of them."),
  issuer_url: url("Zaisma's OpenID Connect issuer: libraries find everything else at <issuer_url>/.well-known/openid-configuration."),
  created_at: isoTime(),
  updated_at: isoTime(),
});

/** A game on a public profile. */
const PROFILE_GAME_PROPERTIES = { slug: text("The game's link name."), title: text(), page_url: url("The game's page on Zaisma.") };

/** An account's public profile: what anyone sees of it, games and servers included. */
export const PLAYER_PROFILE = object({
  id: idOf("player", "The account's player ID, the same in every game."),
  name: text("The name games show for them: their username, so nobody can pass as someone else."),
  username: text("Their username: unique ignoring case, 3 to 20 letters, numbers and underscores, as in @username. It can change; the player ID never does."),
  display_name: nullable(text("The name they chose to show beside @username on their profile, once Zaisma checked it; null when none.")),
  bio: nullable(text("What they wrote about themselves, once checked, up to 160 characters and 4 lines; null when none or when their profile is private.")),
  link_urls: list(url(), "Links they chose to show (their socials, channel or site), up to 3. Only adults can show links; [] otherwise or when their profile is private."),
  profile_url: url("Their profile page, zaisma.com/@username."),
  is_profile_private: yes("true when they show their profile to friends only: strangers then see only the name, username and published games."),
  published_games: list(object(PROFILE_GAME_PROPERTIES), "Games they made that anyone can find (live and listed), newest first."),
  played_games: list(
    object({ ...PROFILE_GAME_PROPERTIES, played_period: choice({ today: "in the last day", this_week: "in the last 7 days", this_month: "in the last 30 days", earlier: "longer ago" }, "Roughly when they last played it: never a time.") }),
    "Games they played lately, newest first, when they show those to anyone; [] otherwise. Only live, listed games.",
  ),
  playing_now: nullable(object(PROFILE_GAME_PROPERTIES, "The game they're playing right now, when they show that to anyone; null when they aren't playing, don't show it, appear offline, or the game isn't out yet.")),
});

/** What the caller's API key may do (docs/DECISIONS.md, "Developers hold the keys"). */
export const ACCESS = object({
  api_key_name: nullable(text("The key's name, as on zaisma.com/account; null when the call came from the developer's own signed-in pages.")),
  api_key_ends_at: nullable(isoTime("When the key stops working; null when it lasts until removed, and for a signed-in session.")),
  access_level: choice(
    Object.fromEntries(ACCESS_LEVELS.map((level) => [level, level === "custom" ? "a choice per area, in area_access" : "a fixed level; area_access shows what it gives"])),
    "read: read everything, post nothing. upload: also send files and make versions. publish: also publish versions, change games and tester links, and post on the forum. full: everything.",
  ),
  area_access: object(
    {
      game_access: choice(AREA_ACCESS_CHOICES.game_access, "read: list and get games, with images, versions, scans, tester links and secrets' names. write: also details, visibility, images, tester links, secrets, the hosts its game server calls, and new games."),
      version_access: choice(AREA_ACCESS_CHOICES.version_access, "read: see versions and scans. upload: also send files and make versions. publish: also publish, schedule and roll back."),
      stats_access: choice(AREA_ACCESS_CHOICES.stats_access, "Stats, player reports and history."),
      database_access: choice(AREA_ACCESS_CHOICES.database_access, "read: tables, indexes, use and export. write: run SQL and import."),
      save_access: choice(AREA_ACCESS_CHOICES.save_access, "Players' cloud saves. read: read them and their copies. write: change, reset and restore them."),
      purchase_access: choice(AREA_ACCESS_CHOICES.purchase_access, "Items and purchases. read: the items, purchase settings, purchases and receipts. write: set and remove items, change purchase settings, grant items and refund."),
      forum_access: choice(AREA_ACCESS_CHOICES.forum_access, "read: search and read. write: post, reply, vote, follow and message Zaisma, in the developer's name."),
      sign_in_app_access: choice(AREA_ACCESS_CHOICES.sign_in_app_access, "Sign-in apps; none for keys limited to some games."),
      webhook_access: choice(AREA_ACCESS_CHOICES.webhook_access, "Webhooks; none for keys limited to some games."),
      credit_access: choice(AREA_ACCESS_CHOICES.credit_access, "Hosting credit; none for keys limited to some games. read: balance, top-ups and spending. write: also start a top-up, refund one, and turn spending off or down (on or up needs the developer's passkey on zaisma.com)."),
    },
    "What the key may do in each area.",
  ),
  game_slugs: nullable(list(text(), "The only games the key works on; null for every game the developer has and will make.")),
});

/** The calls that usually follow a change, ready to make (docs/NAMING.md, Next steps). */
export const NEXT = list(
  object({
    tool: text("The MCP tool to call."),
    arguments: { type: "object", description: "What to send it, filled in as far as Zaisma knows; the reason says what to add." },
    after_sec: nullable(countOf("How long to wait first; null for straight away.")),
    reason: text(),
  }),
  "The calls that usually follow; empty when nothing does.",
);

const ERROR_FIELDS = object({
  code: text("Stable, one problem per code; docs/DEVELOPER-API.md lists every code."),
  message: text("What happened."),
  field: nullable(text("The input at fault, like play_modes[1].play_style; null when no one input is.")),
  fix: text("What to do about it."),
  retry_after_sec: nullable(countOf("How long to wait before trying again, when waiting helps; else null.")),
});
/** Every error, in the API and the MCP (docs/NAMING.md, Errors). confirm_url comes with confirmation_needed alone. */
export const ERROR = object({
  error: { ...ERROR_FIELDS, properties: { ...(ERROR_FIELDS.properties as Record<string, Schema>), confirm_url: url("confirmation_needed only: where the developer confirms with their passkey on zaisma.com.") } },
});

/**
 * A tool's output schema as the MCP lists it: its answer, or an error. MCP clients check a result's
 * structuredContent against the output schema even when isError is set, so the error has to fit too.
 */
export const answerOrError = (answerSchema: Schema): Schema => ({ type: "object", anyOf: [answerSchema, ERROR] });

const DAY_PLAYS = object({
  date: date(),
  play_count: countOf("Counted plays: the official number."),
  player_count: countOf("Browsers with a counted play that day."),
  new_player_count: countOf("Browsers with their first counted play."),
  play_duration_min: countOf("Time on screen in counted plays."),
  started_play_count: countOf("Every play started, counted or not."),
});
const CAME_BACK = object({
  returned_pct: nullable(countOf("null until enough days are over.")),
  returned_player_count: countOf(),
  new_player_count: countOf("New players in the 30 days before."),
});

export const PLAY_STATS = object(
  {
    days: list(DAY_PLAYS),
    play_count: countOf(),
    started_play_count: countOf(),
    new_player_count: countOf(),
    play_duration_min: countOf(),
    average_play_duration_min: nullable(number("Per counted play; null before any.")),
    came_back: object({ after_1_day: CAME_BACK, after_7_days: CAME_BACK, after_30_days: CAME_BACK }),
  },
  "Counted plays: the game on screen for a minute in a browser Cloudflare checked. Tester and preview links and the developer's own plays don't count; a player is a browser.",
);

const perPlayerSec = (what: string) => number(`${what} per player a second, one decimal: divided by the player time in Zaisma rooms; 0 with none.`);
const PER_PLAYER_TRAFFIC = {
  inbound_messages_per_player_sec: perPlayerSec("Messages and bytes frames players sent the rooms"),
  inbound_size_bytes_per_player_sec: perPlayerSec("Bytes players sent the rooms"),
  outbound_messages_per_player_sec: perPlayerSec("Messages and bytes frames the rooms sent players, each counted once per player it went to,"),
  outbound_size_bytes_per_player_sec: perPlayerSec("Bytes the rooms sent players"),
};

export const ROOM_TRAFFIC_HINT = choice({
  json_messages_large: "a JSON message type is big and frequent; sending it as bytes (room.sendBytes, room.broadcastBytes) in a compact form usually cuts it to a third",
  outbound_heavy: "each player gets 32 KB a second or more; send each player only what changed and what they can see (stateSyncEnabled and stateView)",
  message_near_limit: "players send a message of 12 KB or more, close to the 16 KB limit; split it or send it as bytes",
  latest_only_available: 'a message type goes to each player 10 or more times a second and 10% or more of it went to players whose connection was backed up; send it with delivery: "latest_only" so a slow player gets only the newest',
});

export const ROOM_TRAFFIC = object(
  {
    ...PER_PLAYER_TRAFFIC,
    message_types: list(
      object({
        message_type: text("The message's data.type, like \"move\"; (none) for messages without one, (bytes) for bytes, (zaisma) for Zaisma's own (welcome, player lists, probes), (state) for state sync's updates (stateSyncEnabled), (other) past a room's first 20 types."),
        direction: choice({ inbound: "players to the room", outbound: "the room to players" }),
        message_count: countOf("Each sent message once per player it went to."),
        size_bytes: countOf(),
        largest_size_bytes: countOf(),
        average_size_bytes: countOf(),
      }),
      "The month's 10 biggest message types by bytes, both ways together.",
    ),
    traffic_hints: list(object({ code: ROOM_TRAFFIC_HINT, message: text("What to change, with this game's numbers.") }), "Empty when nothing stands out."),
  },
  "This month's traffic in Zaisma rooms (UTC), counted by the rooms and written with their use about hourly. Rooms on your own server aren't counted.",
);

const PLAYER_PERFORMANCE_MEASURES = {
  play_count: countOf("Plays measured: counted and uncounted plays with a ticket from Cloudflare's check, once they drew, crashed or waited 2 minutes."),
  median_loading_duration_sec: nullable(number("Half the plays drew their first frame within this, from the game's page opening (the Chrome check's first draw); null with none drawn.")),
  slow_tenth_loading_duration_sec: nullable(number("The slowest tenth of plays took this long or longer to draw; null with none drawn.")),
  median_frames_per_sec: nullable(countOf("Half the seconds of play ran at this frame rate or better, counted from the game's own requestAnimationFrame frames, as the band it falls in (15, 25, 30, 45, 60, 90 or 120; below 15, the rate itself): 60 means 60 to 89. null when not is_measured.")),
  low_tenth_frames_per_sec: nullable(countOf("The worst tenth of seconds of play ran at this frame rate or lower, in the same bands; null when not is_measured.")),
  long_frames_per_min: nullable(number("Frames of 50 ms or longer (stutter) a minute of measured play; null when not is_measured.")),
  crashed_play_pct: nullable(number("Plays that crashed, of play_count, each counted once by what happened first (the three *_count below); null with no plays.")),
  error_stop_count: countOf("Crashed plays where an uncaught error came first, after which the game asked for no frame for 5 seconds while on screen."),
  context_lost_count: countOf("Crashed plays where a WebGL context on a canvas in the page was lost first, while on screen, and the game didn't lose it itself."),
  stopped_responding_count: countOf("Crashed plays where the game's frame stopped answering for 15 seconds while on screen first: frozen or crashed."),
  median_peak_memory_size_bytes: nullable(countOf("Half the plays used at most this much memory (JavaScript heap, where Chrome and Edge tell it, plus WebAssembly memory) by the time they were first reported, usually their first minute; null when no browser told it.")),
  is_measured: yes("Frame rates were measured: false for games that draw from a worker (OffscreenCanvas) or never ask for animation frames."),
};

export const PLAYER_PERFORMANCE = object(
  {
    version_totals: list(object({ version_id: idOf("version"), ...PLAYER_PERFORMANCE_MEASURES }), "Each version played in the period, every device together, newest first."),
    device_totals: list(
      object({
        version_id: idOf("version"),
        browser_name: choice([...BROWSER_NAMES]),
        os_name: choice([...OS_NAMES]),
        device_kind: choice([...DEVICE_KINDS, "other"], "other: only in the row for groups under 20 plays."),
        graphics_family: choice([...GRAPHICS_FAMILIES], "The graphics chip's maker; unknown when the browser hides it."),
        ...PLAYER_PERFORMANCE_MEASURES,
      }),
      `The newest version played in the period, by browser, system, device and graphics chip family, most plays first. Groups under ${PLAYER_PERFORMANCE_LIMITS.minimumGroupPlayCount} plays fold into one last row whose four are all other, so a rare device can't single out a player.`,
    ),
  },
  "How the game runs on players' devices, measured in their browsers at its public address and added up per day: no player IDs. Tester and preview links and the developer's own plays aren't measured. Never shown on the game page, the shelves or the ranking.",
);

/** A game's month on the one hosting meter (docs/DEVELOPER-API.md, Hosting and credit). */
export const HOSTING_USE = object(
  {
    free_used_pct: countOf("How much of this month's free hosting is used, 0 to 100. Never shown in dollars."),
    shares: list(
      object({ kind: choice({ room_play: "player time in Zaisma rooms", game_server_cpu: "the game server's CPU past what's included", relayed_data: "data Zaisma's relay sent players", database: "the game database's rows and storage", requests: "requests, schedule runs and webhook events to the game server" }), share_pct: countOf("Its share of the use, adding to 100.") }),
      "What used it, biggest first; [] before any use.",
    ),
    is_paused: yes("Whether the game's hosting is paused: no new rooms, relayed connections or requests start, and running matches get an hour to finish."),
    paused_reason: nullable(choice({ free_used: "its free hosting is used and it has no budget", budget_used: "its monthly budget is used", credit_used: "your credit ran out" }, "null when it isn't paused.")),
    paused_at: nullable(isoTime("When it paused; running matches end an hour after. null when it isn't paused.")),
    resets_on_date: date("When the month resets (UTC): the free allowance starts again and a pause ends."),
    monthly_budget_cents: nullable(countOf("What it may draw from credit this month; null: no paid hosting.")),
    spent_from_credit_cents: countOf("What credit paid for it this month, past its free allowance."),
    room_play_duration_hours: number("Player time in Zaisma rooms this month: a fact for tuning, never a price."),
    relayed_size_bytes: countOf("Data Zaisma's relay sent its players this month, read from Cloudflare about once an hour."),
    game_server_cpu_duration_sec: countOf("The game's own game server's CPU this month: in its rooms, and in requests, schedule runs and webhooks past their first 10 ms."),
    request_count: countOf("Requests, webhook events and schedule runs to its game server this month."),
    written_row_count: countOf("Rows its database wrote this month."),
    read_row_count: countOf("Rows its database read this month."),
    database_size_bytes: countOf("Its storage (database and kept rooms) as last recorded."),
  },
  "This month (UTC) on the game's one hosting meter: the free allowance as a percentage, what used it, and what credit paid past it.",
);

const CREDIT_ENTRY_KIND = choice({ top_up: "credit bought", hosting_charge: "a game's hosting past its free allowance, one entry per game per day", refund: "credit refunded to its card", written_off: "what a game used past its budget or your credit, which Zaisma took on: never charged" });
/** A developer's hosting credit (get_credit). */
export const CREDIT = object({
  credit: object({
    balance_cents: countOf("What's left to spend, in cents. Never below 0."),
    automatic_top_up: object({
      is_enabled: yes("Whether Zaisma tops up from the card of the last top-up when the balance is under top_up_below_cents."),
      top_up_below_cents: nullable(countOf()),
      top_up_amount_cents: nullable(countOf()),
      monthly_top_up_limit_cents: nullable(countOf("The most automatic top-ups add in a month (UTC).")),
      topped_up_this_month_cents: countOf(),
    }),
    top_ups: list(
      object({
        id: idOf("top_up"),
        amount_cents: countOf(),
        refundable_cents: countOf("What refund_top_up gives back now: the unspent part (credit is spent oldest first), until refund_ends_at."),
        refund_ends_at: nullable(isoTime("180 days after the top-up.")),
        created_at: isoTime(),
      }),
      "The last 180 days' top-ups, newest first.",
    ),
    games: list(object({ slug: text(), title: text(), monthly_budget_cents: nullable(countOf()), spent_from_credit_this_month_cents: countOf() }), "Games with a budget or spending this month."),
    entries: list(
      object({ id: { type: "string", pattern: "^top_up_[a-z0-9]+$|^credit_entry_[a-z0-9]+$", description: "A top-up's top_up_…, anything else's credit_entry_…." }, entry_kind: CREDIT_ENTRY_KIND, amount_cents: { type: "integer", description: "Positive adds, negative spends; a written_off entry's is what Zaisma took on, and never touched the balance." }, game_slug: nullable(text()), created_at: isoTime() }),
      "The last 90 days, newest first.",
    ),
  }),
});
/** Stripe's page for a top-up (top_up_credit). */
export const TOP_UP_CHECKOUT = object({
  checkout_url: url("Stripe's page where the developer pays. Only a person can pay there."),
  expires_at: isoTime("When the page stops taking payment."),
  next_steps: NEXT,
});
/** A refund of a top-up (refund_top_up). */
export const TOP_UP_REFUNDED = object({
  refunded_cents: countOf("What goes back to the card it came from."),
  next_steps: NEXT,
});
/** The credit after a change to automatic top-up (update_automatic_top_up). */
export const CREDIT_CHANGED = object({ ...(CREDIT.properties as Record<string, Schema>), next_steps: NEXT });

export const STATS = object({
  period_duration_days: countOf(),
  play_stats: PLAY_STATS,
  performance: nullable(PLAYER_PERFORMANCE),
  multiplayer_days: list(
    object({
      date: date(),
      room_count: countOf(),
      room_play_duration_min: countOf("Player time in rooms."),
      message_count: countOf("Messages and bytes frames players sent the rooms."),
      ...PER_PLAYER_TRAFFIC,
      game_server_cpu_duration_sec: countOf("The game's own game server running in its rooms (each call's time less its waits on the database and other servers); 0 for built-in ones."),
      game_server: nullable(
        object(
          {
            call_count: countOf("Calls into the game server from its rooms."),
            request_count: countOf("Requests to its onRequest (Zaisma.server.request), outside rooms."),
            scheduled_run_count: countOf("Runs of its onSchedule, one per schedule due."),
            crash_count: countOf("A handler threw; that call, request or run is lost."),
            stopped_count: countOf("A call ran on too long, about 2 seconds of CPU; the match froze meanwhile, or the request or run failed."),
            ended_match_count: countOf("Matches ended because their game server was stopped twice."),
          },
          "Only for games whose own game server runs on Zaisma, for rooms, requests or schedules; otherwise null.",
        ),
      ),
    }),
  ),
  hosting_use_this_month: HOSTING_USE,
  room_traffic: ROOM_TRAFFIC,
  schedules: list(
    object({
      schedule_name: text("Its name in the game server's schedules."),
      cron: text("When it runs: minute hour day-of-month month day-of-week, in UTC."),
      version_id: idOf("version"),
      next_run_at: isoTime(),
      last_run_at: nullable(isoTime("null until it first runs.")),
    }),
    "The live version's schedules (its game server's schedules option), read within a minute of publishing; empty when it has none or the game isn't playable.",
  ),
  game_server_errors: list(
    GAME_SERVER_ERROR,
    "The 20 most recent distinct errors of the game's own game server; empty for other games.",
  ),
});

/** A game database's answer to one statement. */
export const STATEMENT_RESULT = object({
  rows: list(
    {
      type: "object",
      additionalProperties: { anyOf: [{ type: ["string", "number", "null"] }, object({ blob_base64: text("The bytes, base64-encoded.") })] },
      description: "One row, by column name: text, a number, null, or { blob_base64 } for a blob.",
    },
    "What the statement answered: a SELECT's rows, or a change's with RETURNING; [] for none.",
  ),
  read_row_count: countOf("Rows the statement read, as Cloudflare counts them, on the game's hosting meter."),
  written_row_count: countOf("Rows it wrote, counting each index changed, on the game's hosting meter."),
});

/** A restore of a game's database to a time, or the undo of one. */
export const DATABASE_RESTORE = object({
  id: idOf("database_restore"),
  restore_to_at: isoTime("The moment the database went back to; for an undo, just before the restore it undid."),
  restored_at: isoTime("When it went back."),
  undoes_database_restore_id: nullable(idOf("database_restore", "The restore this one undid; null for a restore to a time.")),
  undo_expires_at: isoTime("Until when undo_database_restore can undo it."),
});

export const DATABASE = object({
  tables: list(object({ name: text(), sql: text("Its CREATE TABLE, as SQLite keeps it.") }), "The game's tables, by name."),
  indexes: list(object({ name: text(), table_name: text(), sql: text("Its CREATE INDEX, as SQLite keeps it.") }), "Indexes made with CREATE INDEX, by name."),
  database_use_this_month: object(
    {
      read_row_count: countOf(),
      written_row_count: countOf(),
      storage_size_bytes: countOf("The database's size now."),
      maximum_storage_size_bytes: countOf("The most a game can keep, its database and kept rooms together: 10 GB. At it the database can change and delete rows but not grow."),
    },
    "This calendar month (UTC). The rows and storage count on the game's hosting meter (hosting_use_this_month).",
  ),
  hosting_use_this_month: HOSTING_USE,
  restores: list(DATABASE_RESTORE, "The last 30 days' restores and undos, newest first, up to 50."),
});

/** What restore_database and undo_database_restore did. */
export const DATABASE_RESTORED = object({
  database_restore: DATABASE_RESTORE,
  erased_again_player_count: countOf("Players erased since that moment (deleted accounts, erase_player, game servers' erases) who were erased again, so a restore never brings them back."),
  next_steps: NEXT,
});

/** One part of a game database's SQL dump. */
export const DATABASE_EXPORT = object({
  dump_sql: text("This part of SQLite's SQL dump: CREATE TABLEs and INSERTs, as sqlite3's .dump writes them. The first part starts with PRAGMA foreign_keys=OFF and BEGIN TRANSACTION, the last ends with the views, indexes and triggers and COMMIT; the parts put together in order are one dump."),
  next_cursor: nullable(text("Pass as cursor for the next part; null on the last one.")),
  read_row_count: countOf("Rows this part read, towards the month's reads (export works past the free reads)."),
});

/** What export_game answers: what the .zip of everything holds, and how to get it (game-export.ts). */
export const GAME_EXPORT = object({
  export: object({
    download_url: url("The .zip of everything about the game, made as it downloads: hand it to the developer, who opens it in a browser signed in to their Zaisma account. It doesn't expire, and it opens for no one else."),
    command: text("The upload command that saves the same export as a folder, with the database as a ready .sqlite file, in a terminal with ZAISMA_KEY set."),
    version_count: countOf("Versions whose files are in it: every kept version that passed review, the live one included."),
    withheld_version_count: countOf("Versions listed in versions.json with no files: still being scanned, held or rejected."),
    image_count: countOf("Covers and screenshots in it: the ones that passed review."),
    withheld_image_count: countOf("Images listed in game.json with no file: waiting for review or not approved."),
    shader_count: countOf("Background shaders in it, as .glsl files: the ones that passed their check."),
    save_count: countOf("Players whose cloud save is in saves.jsonl."),
    files_size_bytes: countOf("The versions' and images' files together; the database, saves and JSON come on top."),
  }),
});

/** What one part of a dump did to a game's database. */
export const DATABASE_IMPORT = object({
  statement_count: countOf("Statements in the part."),
  skipped_statement_count: countOf("Of them, the ones left out: the transaction, PRAGMAs, ANALYZE and sqlite_stat1 rows sqlite3 writes around a dump."),
  read_row_count: countOf(),
  written_row_count: countOf("Rows written, counting each index changed, towards the month's free writes."),
  next_steps: NEXT,
});

/** What erase_player erased from a game's database. */
export const ERASED_PLAYER = object({
  erased_tables: list(
    object({ table_name: text(), erased_row_count: countOf("The player's rows erased from it; 0 when it had none.") }),
    "Every table with a player_id column, by name: each was looked in, in one transaction.",
  ),
  written_row_count: countOf("Rows written, counting each index changed, towards the month's use (erasing works past the free writes)."),
});

/** A player's report that report triage sorted as a bug: what they wrote, never who they are. */
/** A player's cloud save in a game, without what it holds. */
const SAVE_SUMMARY_FIELDS = {
  player_id: idOf("player", "The player whose save it is: the same ID in every game, in room.players and a player pass's sub."),
  sha256: text("The SHA-256 of the save as stored (its keys sorted), to compare with save_copies."),
  size_bytes: countOf("Up to 5 MB."),
  updated_at: isoTime(),
  changed_by_kind: choice(
    { player: "the player's game saved it (or the player went back to an earlier version)", developer: "you changed, reset or restored it through the API or MCP" },
    "Who made the save as it is now.",
  ),
  save_copy_count: countOf("Earlier versions kept, up to 5: list_save_copies lists them."),
};
const SAVE_CONTENTS_FIELDS = {
  local_storage_items: {
    type: "object",
    additionalProperties: { type: "string" },
    description: "The game's localStorage as it starts the game: each key and its text. With keys, only the keys asked for that it has.",
  },
  missing_keys: list(text(), "With keys: the ones asked for that the save doesn't have. [] without keys."),
  indexeddb_databases: nullable(
    list(
      { type: "object", description: "One IndexedDB database as the game domain script stores it: { name, version, stores: [{ name, keyPath, autoIncrement, indexes, records: [[key, value]] }] }. Bytes, dates and the like are tagged as { $z: [kind, …] }." },
      "The game's IndexedDB databases (Unity, Godot and localForage keep saves there); [] when it keeps none. null when you asked for some keys.",
    ),
  ),
};
export const SAVE_COPY_REASON = choice(
  {
    hourly: "a routine copy, about once an hour while playing",
    replaced: "another device's progress, played more recently, replaced this",
    smaller: "the save shrank to under half, usually a restart",
    restore: "the player went back to an earlier version in the game (Zaisma.saves.restoreCopy)",
    device: "a device's progress, older than the account's when the device opened the game or saved",
    developer: "right before you changed, reset or restored the save",
  },
  "Why the copy was kept. Copies kept because progress was about to be lost (all but hourly) outlast hourly ones for 30 days.",
);
const SAVE_COPY_FIELDS = {
  id: idOf("save_copy"),
  saved_at: isoTime("When this progress was saved."),
  copy_reason: SAVE_COPY_REASON,
  sha256: text(),
  size_bytes: countOf(),
  is_current_save: yes("The save holds exactly this progress now."),
};
export const SAVE_SUMMARY = object(SAVE_SUMMARY_FIELDS);
export const SAVE_LIST = object({
  saves: list(SAVE_SUMMARY, "Up to 100 a page, by player ID."),
  next_cursor: nullable(text("Pass as cursor for the next page; null on the last.")),
});
export const SAVE = object({ save: object({ ...SAVE_SUMMARY_FIELDS, ...SAVE_CONTENTS_FIELDS }) });
export const SAVE_CHANGED = object({
  save: SAVE_SUMMARY,
  kept_save_copy_id: nullable(idOf("save_copy", "The earlier version holding the save this replaced: restore_save_copy undoes the change. null when nothing changed, or the save it replaced was your own last change (the copy from before that one is still there).")),
  next_steps: NEXT,
});
export const SAVE_COPY_LIST = object({ save_copies: list(object(SAVE_COPY_FIELDS), "Newest first, up to 5.") });
export const SAVE_COPY = object({ save_copy: object({ ...SAVE_COPY_FIELDS, ...SAVE_CONTENTS_FIELDS }) });

export const BUG_REPORT = object({
  id: idOf("report"),
  player_text: text("What the player wrote."),
  summary: nullable(text()),
  version_id: nullable(idOf("version", "The version they played.")),
  reported_at: isoTime(),
});

export const PLAYER_REPORT = object({
  id: idOf("report"),
  reason: choice(PLAYER_REPORT_REASONS, "What the player says happened."),
  player_text: text("What the player wrote; \"\" when they wrote nothing."),
  reported_player_id: idOf("player", "The player reported, as your game knows them."),
  reported_player_name: text("Their name as the game showed it when they were reported."),
  room_code: nullable(text("The room it happened in; null when the report didn't say.")),
  version_id: nullable(idOf("version", "The version being played.")),
  reported_at: isoTime(),
});

export const REPORTS = object({
  period_duration_days: countOf(),
  reasons: list(
    object({
      reason: text(),
      label: text(),
      open_count: countOf("Waiting for Zaisma."),
      closed_count: countOf("Zaisma looked and dismissed it or acted on it."),
    }),
  ),
  bug_reports: list(BUG_REPORT),
  player_reports: list(PLAYER_REPORT, "Reports about a player that Zaisma passed to you, newest first, up to 50: bullying, cheating and other behavior that's your game's call. Zaisma itself looks at real-life threats, personal details, following after a block and sexual behavior. Never who sent them."),
  next_cursor: text("Pass as cursor next time to get only bug and player reports that arrived after this call."),
});

/** An address your server takes Zaisma's events at, or a game's own game server, and the events it takes. */
export const WEBHOOK = object({
  id: idOf("webhook"),
  destination_kind: choice(
    { endpoint_url: "events are signed POSTs to endpoint_url", game_server: "events go to the game in game_slugs' own game server on Zaisma, whose onWebhook(event, server) gets them" },
    "Where events go.",
  ),
  endpoint_url: nullable(url("Where events are sent, as signed POSTs; null for a game server.")),
  event_kinds: list(choice(WEBHOOK_EVENT_KINDS), "The events sent to it."),
  game_slugs: nullable(list(text(), "Only events about these games; null for every game you have and will make. A game server's webhook: its one game.")),
  pending_delivery_count: countOf("Events still being tried."),
  failed_delivery_count: countOf("Events that failed every try in the last 30 days: list_webhook_deliveries says why."),
  created_at: isoTime(),
  updated_at: isoTime(),
});

/** Something a game sells or grants. */
export const GAME_ITEM = object({
  item_name: text("The name the game knows it by, like revive: Zaisma.items.owns(item_name)."),
  title: text("What players see it called."),
  description: text("What players see about it; \"\" for none."),
  item_kind: choice({ permanent: "owned for good, on every device", consumable: "delivered once, then the game keeps count" } satisfies Record<(typeof ITEM_KINDS)[number], string>),
  item_category: ITEM_CATEGORY_CHOICE,
  price_minor_units: nullable(PRICE_MINOR_UNITS),
  currency_code: nullable(CURRENCY_CODE),
  local_prices: list(object({ currency_code: CURRENCY_CODE, price_minor_units: PRICE_MINOR_UNITS }), "Prices in other currencies, which players in those countries see and pay; [] for none."),
  card_fee_note: nullable(text("Under 2 units of a currency, about what reaches the developer after card fees; null otherwise.")),
  created_at: isoTime(),
  updated_at: isoTime(),
});

/** What a game says about what it sells, and the label it makes with the items. */
export const PURCHASE_SETTINGS = object({
  refund_policy: nullable(REFUND_POLICY_CHOICE),
  refund_policy_text: nullable(text("The refund policy in the developer's own words, with own_words.")),
  own_payment_categories: list(ITEM_CATEGORY_CHOICE, "What the game sells through its own payments, outside the buy sheet; [] for nothing."),
  purchase_label: PURCHASE_LABEL,
});

/** A game's items, its purchase settings and the label they make. */
export const ITEMS = object({ items: list(GAME_ITEM, "By item_name."), ...(PURCHASE_SETTINGS.properties as Record<string, Schema>) });

/** A player's purchase or grant of an item, with its receipt. */
export const PURCHASE = object({
  id: idOf("purchase"),
  item_name: text(),
  item_kind: choice([...ITEM_KINDS]),
  item_count: countOf("How many of the item: 1 for a permanent one."),
  purchase_source: choice({ sale: "bought through Zaisma's buy sheet", grant: "given by the developer, with no money" } satisfies Record<(typeof PURCHASE_SOURCES)[number], string>),
  purchase_status: choice(
    { pending: "paying", completed: "bought or granted", failed: "the payment didn't go through", refunded: "refunded or taken back", charged_back: "the card's bank took the money back" } satisfies Record<(typeof PURCHASE_STATUSES)[number], string>,
  ),
  player_id: idOf("player"),
  game_account_id: nullable(text("The game's own ID for the player's account in its own system, as the game gave it.")),
  price_minor_units: nullable(describe({ type: "integer", minimum: 0 }, "What was paid, in the currency's smallest unit; null for a grant.")),
  currency_code: nullable(text("The currency paid in; null for a grant.")),
  refunded_minor_units: countOf("How much was given back, in the same currency's smallest unit; 0 for a grant."),
  purchased_at: nullable(isoTime("When it was bought or granted; null while paying, or when it failed.")),
  refunded_at: nullable(isoTime()),
  receipt: nullable(text("The signed receipt (a JWT like a player pass): any server checks it with verifyReceipt from @zaisma/game-server. null while paying, or when it failed.")),
});

/** A game's secret as the API shows it: never its value. */
export const SECRET = object({
  name: text("Its name, as the game server reads it: server.secrets.<name> and room.secrets.<name>."),
  set_at: isoTime("When it was last set."),
});

/** A game's kept rooms (room.setKept) and its storage, which they share with the game database. */
export const KEPT_ROOMS = object({
  kept_rooms: list(
    object({
      room_code: text("The room's code, as players see it, like K7Q2MX."),
      name: nullable(text("The room's name, as its game server set it.")),
      saved_size_bytes: countOf("How much its saved world takes, towards the game's storage: written as it empties, and hourly while players are in it."),
      saved_at: nullable(isoTime("When its world was last saved; null before its first save.")),
      last_played_at: nullable(isoTime("When players were last in it.")),
      created_at: isoTime("When its game server first kept it."),
    }),
    "Most recently played first.",
  ),
  kept_rooms_size_bytes: countOf("All the kept rooms' saved worlds together."),
  storage_size_bytes: countOf("The game's storage: its database and its kept rooms."),
  maximum_storage_size_bytes: countOf("The most a game can keep: 10 GB. At it the database can't grow and no more rooms can be kept, though kept rooms keep saving. Below it, storage counts on the game's hosting meter."),
});

/** A kept room deleted. */
export const KEPT_ROOM_DELETED = object({
  is_deleted: yes("Always true: the room's world is gone, and players who were in it were sent out."),
  next_steps: NEXT,
});

/** Who did something to the account or a game. */
const DONE_BY = choice({ you: "you, on zaisma.com", api_key: "an API key, named in api_key_name", ai: "your AI, through the MCP; api_key_name is the key it used", zaisma: "Zaisma" });

/** Who and where, on every event of the account's activity and a game's history. */
const WHO_AND_WHERE_FIELDS = {
  api_key_name: nullable(text("The key's name when one was used, by a script or your AI; kept after the key is removed.")),
  device: nullable(text('The browser and system, like "Chrome on a Windows PC", or the upload command and its version; null for your AI and Zaisma, and with Keep where my account is used from off.')),
  network_name: nullable(text("The network, as Cloudflare names it, like Vodafone; null after 90 days and with the setting off.")),
  city_name: nullable(text("The nearest city, as Cloudflare names it; null after 90 days and with the setting off.")),
  region_name: nullable(text("The region, as Cloudflare names it; null after 90 days and with the setting off.")),
  country_code: nullable(text("The country, ISO 3166-1 alpha-2, like GB; null after 90 days and with the setting off.")),
  connection_address: nullable(text("The internet address it came from: kept 90 days for keys made and used and for changes to games; null otherwise.")),
};

/** One of the account's events, as get_activity lists it and a security_alert webhook event carries it. */
export const ACTIVITY_EVENT = object({
  kind: choice(Object.fromEntries(ACCOUNT_EVENT_KINDS.map((kind) => [kind, SECURITY_EVENT_DESCRIPTIONS[kind]]))),
  description: text(),
  sign_in_kind: nullable(choice([...SIGN_IN_KINDS], "How a sign-in on a new device was made; null for everything else.")),
  subject_name: nullable(text("The passkey's device or the API key's name; null otherwise.")),
  done_by: DONE_BY,
  ...WHO_AND_WHERE_FIELDS,
  happened_at: isoTime(),
  security_alert_status: nullable(
    choice(
      {
        emailed: "a security alert, emailed to the account (and its old address when the email changed or went)",
        unseen: "a security alert no email told the account about (it has none, or 10 went this hour): the account page and dashboard show it until That was me",
        seen: "a security alert that waited on the pages, and the owner pressed That was me",
      },
      "Whether the owner was alerted to it: a sign-in on a new device from a network the account hadn't used, a password or email change, a passkey removed, a key made, used from a new place or turned off, an AI or app connected, or an app Zaisma disconnected; null for everything else.",
    ),
  ),
});

/** What a webhook is sent: the body the signature covers. */
export const WEBHOOK_EVENT = object({
  id: idOf("webhook_event", "The same on every try (Standard Webhooks' webhook-id header), so a server can skip one it already has."),
  kind: choice(
    {
      bug_reported: "report triage sorted a player's report as a bug (bug_report)",
      player_reported: "Zaisma passed you a report about one of your game's players: bullying, cheating or other behavior that's the game's call (player_report)",
      scan_status_changed: "a version's scan finished, or Zaisma changed its scan_status later (version)",
      live_version_changed: "players get another version: published, rolled back, published at its set time, or put back while a report is checked (version: the one players get now)",
      review_status_changed: "Zaisma held or took down the game, or put it back (game.review_status and game.review_reason)",
      country_blocks_changed: "Zaisma blocked the game for players in one country on a notice under that country's law, or lifted it (game.country_blocks)",
      game_server_error_found: "a new distinct error in the game's own game server, once per error per version (game_server_error, version: the version it happened in)",
      alert_raised: "one of the game's free-use alerts appeared, at most once a month per kind (alert)",
      account_deleted:
        "a player who played the game, or signed in to your sign-in app, deleted their Zaisma account: erase what you keep about player_id (Zaisma already erased their rows in the game's database unless the game's deleted_account_erase_enabled is false)",
      security_alert:
        "one of your own security alerts, as get_activity lists them (security_event): a sign-in on a new device from a network you hadn't used, a password or email change, a passkey removed, a key made, used from a new place or turned off, an AI or app connected. It reaches only a webhook for every game (game_slugs null) at an endpoint_url",
      test: "sent by test_webhook; game, version, bug_report, player_report, game_server_error, alert, player_id, sign_in_app and security_event are null",
    },
    "What happened.",
  ),
  happened_at: isoTime(),
  game: nullable({ ...GAME, description: "The game as get_game answers it, now; null for a test event, a security_alert or an account_deleted event about a sign-in app." }),
  version: nullable({ ...VERSION, description: "The version as get_version answers it, now; null when the event isn't about one." }),
  bug_report: nullable({ ...BUG_REPORT, description: "The bug report as get_reports lists it; null unless kind is bug_reported." }),
  player_report: nullable({ ...PLAYER_REPORT, description: "The player report as get_reports lists it; null unless kind is player_reported." }),
  game_server_error: nullable({ ...GAME_SERVER_ERROR, description: "The error as get_stats lists it; null unless kind is game_server_error_found." }),
  alert: nullable({ ...GAME_ALERT, description: "The alert as the game's alerts list it; null unless kind is alert_raised." }),
  player_id: nullable(idOf("player", "The player who deleted their account; null unless kind is account_deleted.")),
  sign_in_app: nullable({ ...SIGN_IN_APP, description: "The sign-in app as list_sign_in_apps answers it; null unless an account_deleted event is about a site, not a game." }),
  security_event: nullable({ ...ACTIVITY_EVENT, description: "The account's event as get_activity lists it; null unless kind is security_alert." }),
});

/** One event on its way to one webhook, and how it went. */
export const WEBHOOK_DELIVERY = object({
  webhook_id: idOf("webhook"),
  webhook_event: WEBHOOK_EVENT,
  delivery_status: choice({ pending: "being tried; next_attempt_at says when next", delivered: "your server answered 2xx, or the game server's onWebhook finished without an error", failed: "every try failed, so it won't be sent again" }),
  attempt_count: countOf("Tries so far: up to 6 over about a day and a half (a test event: 1)."),
  last_attempt_at: nullable(isoTime()),
  next_attempt_at: nullable(isoTime("When it's tried next; null unless pending.")),
  failure_message: nullable(text("Why the last try failed, with the HTTP status your server answered, like \"Answered 500; only a 2xx answer counts as delivered.\", or what the game server's onWebhook threw; null once delivered.")),
  created_at: isoTime(),
});

export const QR_CODE = object({
  link_url: url("The address the code opens: the game's page, or a room in it."),
  qr_code_svg: text("The QR code as an SVG document, black on white with its margin: save it as a .svg file, or turn it into a PNG at any size."),
});

export const HISTORY = object({
  events: list(
    object({
      description: text(),
      version_id: nullable(idOf("version")),
      subject_name: nullable(text("What it was done to, by name: the secret, tester link, image kind, sign-in app or webhook ID; null when there's nothing to name.")),
      done_by: DONE_BY,
      ...WHO_AND_WHERE_FIELDS,
      is_new_place: yes("An API key's first change from a network and country it hadn't been used from."),
      occurrence_count: countOf("Calls of the same kind by the same key or session within the hour fold into one event."),
      happened_at: isoTime(),
      last_happened_at: isoTime("When the last call folded into this event happened; the same as happened_at for one call."),
      review_reason: nullable(reviewReason("For a hold, rejection or takedown: why, the rule and the fix. null for everything else.")),
    }),
    "Newest first.",
  ),
});

/** get_logs: what the game's server printed on Zaisma, oldest first. */
export const LOGS = object({
  log_lines: list(
    object({
      logged_at: isoTime("When the game server printed it."),
      level: choice({ debug: "console.debug or console.trace", log: "console.log, console.dir or console.table", info: "console.info", warn: "console.warn", error: "console.error, or a crash Zaisma wrote down in full" }),
      text: text("What it printed: strings as they are, everything else as JSON, an Error with its stack; up to 4,000 characters. Lines Zaisma adds start with \"Zaisma:\"."),
      source_kind: choice({ room: "in a room", request: "in onRequest", schedule: "in onSchedule", webhook: "in onWebhook" }),
      room_code: nullable(text("The room it was printed in; null outside rooms.")),
      version_id: idOf("version"),
    }),
    "Oldest first.",
  ),
  next_cursor: nullable(text("Pass as cursor for the lines before these; null when there are none.")),
  new_lines_cursor: nullable(text("Pass as new_lines_cursor for only lines written since this call; null on an older page (cursor given).")),
});

/** The account's own security activity, from the last 90 days. */
export const API_KEYS = object({
  api_keys: list(
    object({
      api_key_name: text("The key's name, as on zaisma.com/account; a connected app's is the app's own name."),
      kind: choice({ api_key: "an API key made on zaisma.com/account", connected_app: "an AI app connected by signing in, like claude.ai" }),
      connected_app_host: nullable(text("Where a connected app sends the developer back after signing in, like claude.ai; null for an API key.")),
      access_level: choice(ACCESS_LEVELS, "What the key can do: read, upload, publish, full, or custom (a choice per area, in area_access)."),
      area_access: (ACCESS.properties as Record<string, Schema>).area_access!,
      game_slugs: nullable(list(text(), "The only games the key works on; null for every game the developer has and will make.")),
      created_at: isoTime(),
      last_used_at: nullable(isoTime("null while the key hasn't been used.")),
      last_used_where: nullable(text("What it was last used with and from where, like \"Zaisma CLI 1.4 · Vodafone, near Manchester, UK\"; null when unknown, or when the account doesn't keep where it's used from.")),
      ends_at: nullable(isoTime("When the key stops working; null when it lasts until removed.")),
      turned_off_at: nullable(isoTime("When Zaisma turned the key off because it was found in public; null while it's on. A turned-off key never works again.")),
      found_in: nullable(choice({ github: "in a public GitHub repository, gist, issue or pull request", game_files: "in a game's files uploaded to Zaisma", forum_post: "in a forum post" }, "Where the key was found; null while it's on.")),
      found_at_url: nullable(text("The public address it was found at, when there is one.")),
      is_this_key: yes("Whether this is the key making the call."),
    }),
    "Newest first.",
  ),
});

export const ACTIVITY = object({
  events: list(ACTIVITY_EVENT, "Newest first, from the last 90 days."),
  unseen_security_alerts: list(ACTIVITY_EVENT, "Security alerts no email told the account about that it hasn't seen yet, newest first, up to 10; [] when there are none. They wait on the account page and dashboard until That was me there."),
  where_used_from_enabled: yes("Keep where my account is used from, on the account page; off, events have no device, network, place or address. It changes only on the account page."),
  next_cursor: nullable(text("Pass as cursor for older events; null on the last page.")),
});

// --- The developer forum ---

const TOPIC_KIND = choice({ bug: "something in Zaisma doesn't work", gap: "a limit or missing piece blocks the developer", feature: "an idea", question: "a question", talk: "a discussion" });
export const TOPIC_STATUS = choice(
  {
    new: "open, or waiting for Zaisma on a message",
    investigating: "Zaisma is looking",
    known: "confirmed",
    planned: "on the roadmap",
    fixing: "being worked on",
    released: "a fix is out and Zaisma is watching that it holds",
    fixed: "resolved",
    wont: "won't fix, with why",
    answered: "a question with an answer",
  },
  "Where it stands: a known issue's phase, or answered.",
);
const AUTHOR_KIND = choice({ developer: "the developer wrote it", ai: "the developer's AI assistant wrote it", zaisma: "the people who build Zaisma" });
const PERSON = object({
  name: text("The account's name; an AI's posts carry its developer's name."),
  kind: AUTHOR_KIND,
  is_you: yes(),
});
const TOPIC_FIELDS = {
  id: idOf("topic"),
  kind: TOPIC_KIND,
  title: text(),
  category: nullable(text("Where in Zaisma it belongs, like rooms or mcp.")),
  tags: list(text()),
  topic_status: TOPIC_STATUS,
  is_public: yes("false: a private message to Zaisma, only the developer and Zaisma see it."),
  is_shown: yes("Others can see it: public, and its first post passed the check."),
  is_known_issue: yes("Zaisma's own topic about a problem many developers hit."),
  author: PERSON,
  recent_participants: list(PERSON, "The latest few people in it, newest first, without the author."),
  participant_count: countOf("Everyone in it besides the author."),
  reply_count: countOf(),
  vote_count: countOf("Affects me too, I want this or same question."),
  has_voted: yes(),
  affected_developer_count: nullable(countOf("For a known issue: the developers it affects, with their messages and votes; null otherwise.")),
  is_answered: yes(),
  merged_into_topic_id: nullable(idOf("topic", "Your message's known issue, when Zaisma merged it into one.")),
  is_unread: yes("Something new since you last opened it."),
  created_at: isoTime(),
  last_activity_at: isoTime(),
  search_match: nullable(text("With search_text: the words that matched, marked «like this».")),
  bookmarked_post_ids: list(idOf("post"), "On the bookmarks tab: the posts in it you bookmarked, newest first. Empty elsewhere."),
};
export const TOPIC_ROW = object(TOPIC_FIELDS);
export const BRIEF_TOPIC = object(
  {
    id: idOf("topic"),
    title: text(),
    kind: TOPIC_KIND,
    topic_status: TOPIC_STATUS,
    is_known_issue: yes(),
    is_answered: yes(),
    vote_count: countOf(),
    affected_developer_count: nullable(countOf("For a known issue: the developers it affects; null otherwise.")),
    reply_count: countOf(),
    category: nullable(text()),
    search_match: nullable(text("The words that matched, marked «like this»; null without search_text.")),
    bookmarked_post_ids: list(idOf("post"), "On the bookmarks tab: the posts in it you bookmarked, newest first. Empty elsewhere."),
    is_unread: yes(),
    last_activity_at: isoTime(),
  },
  "A topic in a few fields: open it with get_topic.",
);
export const TOPIC = object({
  ...TOPIC_FIELDS,
  workaround: nullable(text("A known issue's: what to do until it's fixed.")),
  roadmap_item: nullable(text("A known issue's roadmap item, as in docs/ROADMAP.md.")),
  game_slug: nullable(text("The game a message is about, for its developer only.")),
  merged_into_topic: nullable(object({ id: idOf("topic"), title: text(), topic_status: TOPIC_STATUS, workaround: nullable(text()) }, "The known issue your message is part of.")),
  your_message_topic_id: nullable(idOf("topic", "On a known issue: your own private message about it.")),
  is_following: yes("What's new in it shows as unread in search_forum's yours tab."),
  has_flagged_misplaced: yes("You flagged it as in the wrong category, and Zaisma hasn't looked yet."),
  can_reply: yes(),
  can_vote: yes(),
  can_flag_misplaced: yes(),
  can_mark_answer: yes(),
  can_reopen: yes(),
});
const DEBUG_CONTEXT = object(
  { call: nullable(text()), error_code: nullable(text()), error_message: nullable(text()), request_json: nullable(text()), notes: nullable(text()) },
  "What was attached for whoever fixes it; only its poster and Zaisma see it.",
);
const POST_KIND = choice({ post: "a post", reopen: "its developer reopened the topic", status: "Zaisma changed where it stands" });
const POSTED_VIA = choice(["mcp", "api", "cli", "dashboard", "admin"]);
export const POST = object({
  id: idOf("post"),
  author: PERSON,
  kind: POST_KIND,
  text_markdown: text(),
  reply_to_post: nullable(object({ id: idOf("post"), author_name: text(), excerpt: text() }, "The post it answers, if it answers one.")),
  is_answer: yes("The question's marked answer."),
  check_status: nullable(choice({ pending: "being checked: only you see it yet", passed: "others see it", held: "waiting for a person at Zaisma: only you see it yet" }, "null in a message to Zaisma.")),
  posted_via: POSTED_VIA,
  like_count: countOf("How many liked it; nobody sees who."),
  dislike_count: countOf("How many disliked it; nobody sees who."),
  your_rating: nullable(choice({ like: "you liked it", dislike: "you disliked it" }, "What you said about it; null if nothing.")),
  is_bookmarked: yes("You bookmarked it."),
  helpful_count: countOf("Deprecated: like_count replaces it; removed 90 days after this shipped."),
  has_marked_helpful: yes("Deprecated: your_rating replaces it; removed 90 days after this shipped."),
  has_reported: yes("You reported it, and Zaisma hasn't looked yet."),
  debug_context: nullable(DEBUG_CONTEXT),
  media: list(object({ id: idOf("media"), image_url: url() }), "Its images."),
  mentioned_names: list(text(), "The people it @mentions."),
  created_at: isoTime(),
});
const CHECK_NOTE = nullable(text("While others can't see it yet: how long the check takes. null once they can."));
const REMOVED_SECRET_COUNT = countOf("Keys and passwords blanked before it was stored.");
export const TOPIC_PAGE = object({
  topics: list(BRIEF_TOPIC),
  pinned_topics: list(BRIEF_TOPIC, "Open known issues, above the latest topics on the first page."),
  tab: choice(["latest", "top", "unanswered", "known", "yours", "messages", "bookmarks"]),
  next_cursor: nullable(text("Pass as cursor for the next topics; null on the last page.")),
  remaining_post_count: countOf("Posts the developer can still make today."),
});
export const TOPIC_WITH_POSTS = object({
  topic: TOPIC,
  posts: list(POST),
  post_count: countOf("Posts you can see in all, whichever were sent."),
  remaining_post_count: countOf("Posts the developer can still make today."),
});
export const NEW_TOPIC = object({
  topic: TOPIC,
  posts: list(POST),
  post_count: countOf(),
  remaining_post_count: countOf(),
  similar_topics: list(TOPIC_ROW, "Topics and known issues that look like the same thing: if one is, vote or reply there."),
  check_note: CHECK_NOTE,
  removed_secret_count: REMOVED_SECRET_COUNT,
  next_steps: NEXT,
});
export const POST_RATING = object({
  like_count: countOf(),
  dislike_count: countOf(),
  your_rating: nullable(choice({ like: "you liked it", dislike: "you disliked it" }, "null after you took it back.")),
  next_steps: NEXT,
});
export const POST_BOOKMARK = object({ is_bookmarked: yes(), next_steps: NEXT });
export const NEW_REPLY = object({ post: POST, check_note: CHECK_NOTE, removed_secret_count: REMOVED_SECRET_COUNT, next_steps: NEXT });

// --- Announcements, for anyone (GET /api/announcements, announcements.ts) ---

const ANNOUNCEMENT_FIELDS = {
  id: idOf("announcement"),
  text: text("One or two plain sentences, up to 200 characters, from Zaisma."),
  link_url: nullable(text("Where its link goes: an https address, or a path on zaisma.com starting with /; null when it has none.")),
  link_label: nullable(text('The link\'s words, up to 30 characters ("Read more" when none were given); null when it has no link.')),
  starts_at: isoTime("When it starts showing."),
  ends_at: isoTime("When it stops showing."),
};
export const PUBLIC_ANNOUNCEMENT_LIST = object({ announcements: list(object(ANNOUNCEMENT_FIELDS), "The ones showing now, the newest start first; the home shows the first. [] when none are.") });

// --- The admin MCP (docs/ADMIN-MCP.md) ---

/** A precedent's ID. The first ones were named by hand, with hyphens: precedent_hard-or-boring. */
export const PRECEDENT_ID_PATTERN = "^precedent_[a-z0-9-]+$";
const precedentIdOf = (description?: string) => describe({ type: "string", pattern: PRECEDENT_ID_PATTERN }, description);
/** A report group is named by its first report: its ID is that report's. */
const reportGroupIdOf = (description?: string) => idOf("report", description ?? "The group's ID: its first report's.");

export const REPORT_SEVERITY = choice(
  { child_safety: "a person decides, nothing is deleted, and a confirmed case goes to NCMEC", urgent: "illegal content, or harm happening now", high: "malware, sexual content, or a real person's private details or a threat", normal: "most reports", low: "taste, or copyright from players" },
  "How serious, most serious first.",
);
export const TOPIC_SEVERITY = choice(
  {
    urgent: "a security hole, data exposed or lost, money handled wrong, or broken for everyone",
    high: "blocks a developer from publishing or running their game, with no way around it",
    normal: "a bug with a way around it, a gap, most feature requests",
    low: "a question, a nice-to-have, a docs wording",
  },
  "How serious, most serious first.",
);
const PRECEDENT_DECISION = choice({ dismiss: "nothing against the rules", bug: "the developer's to fix: passed to them as a bug report", recheck: "check the game's files again", take_down: "take the game down", pass_to_developer: "a report about a player that's the game's call: passed to its developer", stop_social: "turn off the reported account's social side" });
export const REPORT_GROUP_DECISION = choice({
  dismiss: "nothing against the rules; the reports close",
  hide_name: "hide a reported room's name and labels from room lists",
  bug: "pass to the developer as a bug report",
  take_down: "take the game down",
  restore: "put a paused game back",
  put_update_back: "put a paused update back for players",
  keep_update_off: "keep a paused update off",
  pass_to_developer: "a report about a player: pass it to the game's developer (get_reports and the player_reported event)",
  stop_social: "a report about an account: turn off its chat, friends, invites and joins for good (needs social_stopped_reason)",
  clear_profile: "a report about an account: empty its display name, bio and links",
});
const TRIAGE_RECOMMENDATION = choice({ dismiss: "nothing against the rules", bug: "the developer's to fix", recheck: "check the game's files again", person: "a person should look", take_down: "take the game down", restore: "put the game back", pass_to_developer: "a report about a player that's the game's call: pass it to the developer", stop_social: "turn off the reported account's social side" });
const REPORT_REASON = choice(Object.keys(REPORT_REASONS));
const PRECEDENT_FIT = object(
  { id: precedentIdOf(), title: text(), fit: choice({ fits: "the case fits it, so it's decided the same way", challenges: "the case looks like it, but the precedent doesn't seem right for it" }) },
  "The precedent the case fits or challenges.",
);

const ADMIN_GAME = object({
  id: idOf("game"),
  slug: text(),
  title: text(),
  description: text(),
  review_status: REVIEW_STATUS,
  visibility: VISIBILITY,
  multiplayer_mode: MULTIPLAYER_MODE,
  game_server_name: nullable(text("What runs its multiplayer on Zaisma rooms: relay, sandbox (the game's own game server) or a built-in one's name; null without rooms.")),
  has_own_servers: yes("The game talks to servers of its own."),
  review_reason: nullable(reviewReason("What the developer reads about why it's held or removed.")),
  country_blocks: list(COUNTRY_BLOCK, "Countries whose players can't open it, on a notice under that country's law; [] for none."),
  created_at: isoTime(),
});
const ADMIN_VERSION = object({
  id: idOf("version"),
  scan_status: SCAN_STATUS,
  has_threads: yes("Whether the build needs threads (SharedArrayBuffer): it runs only in Chrome and Edge, and the game page tells other browsers' players."),
  is_live: yes("This is the version players get."),
  patch_notes: text(),
  published_at: nullable(isoTime("When it last went live.")),
  created_at: isoTime(),
  scan_summary: nullable(text("What the AI review said; null before it ran.")),
  review_reason: nullable(reviewReason("What the developer reads about a person's or report's decision on it.")),
  findings: list(
    object({ code: text("Which check found it: a code from REVIEW_CODES, or one only Zaisma sees, like known_illegal_image."), severity: FINDING_SEVERITY, message: text("For Zaisma's eyes."), path: nullable(text()) }),
    "Everything the scan found but notes, as Zaisma sees it.",
  ),
  replaced_by_version_id: nullable(idOf("version", "The newer version that replaced this one while it waited; null when none did.")),
  changes_since: nullable(
    describe(object({
      version_id: idOf("version", "The version it's compared with: the held one it answers, or else the game's newest earlier scanned version."),
      added_paths: list(text(), "Files added since, sorted, at most 50."),
      changed_paths: list(text(), "Files changed since, sorted, at most 50."),
      removed_paths: list(text(), "Files removed since, sorted, at most 50."),
      added_path_count: countOf(),
      changed_path_count: countOf(),
      removed_path_count: countOf(),
    }),
    "For a held version: what changed since the version it's compared with. The lists are empty for zip uploads, whose files can't be compared. null for versions that aren't held."),
  ),
});
const HISTORY_EVENT = object({
  action: text("What happened, like report-paused-update or version-published."),
  description: text(),
  actor: text("Who did it: an admin's email, the developer's account, or Zaisma's own checks (scan, triage)."),
  happened_at: isoTime(),
  review_reason: nullable(reviewReason("For a hold, rejection or takedown: what the developer reads about it.")),
});
const GAME_IN_BRIEF = object({ slug: text(), title: text(), review_status: REVIEW_STATUS });

export const REPORT_GROUP_ROW = object({
  id: reportGroupIdOf(),
  severity: REPORT_SEVERITY,
  game: GAME_IN_BRIEF,
  report_count: countOf(),
  first_reported_at: isoTime(),
  summary: nullable(text("What report triage made of it; null until it's sorted.")),
  recommendation: nullable(TRIAGE_RECOMMENDATION),
  why: nullable(text()),
  precedent: nullable(PRECEDENT_FIT),
  is_spot_check: yes("Triage would have dismissed it under a precedent alone; kept for a person to look at."),
  ai_actions: list(text(), "What triage did by itself, in plain words."),
});
const AI_USE = object(
  {
    input_token_count: countOf(),
    output_token_count: countOf(),
    scan_call_count: countOf("AI reviews of versions."),
    report_triage_call_count: countOf(),
    forum_call_count: countOf("Forum sorting and post checks."),
  },
  "The month's AI use, shared by scans, report triage and the forum, UTC.",
);
export const REPORT_GROUP_LIST = object({
  report_groups: list(REPORT_GROUP_ROW, "Open ones, most serious first, then the longest waiting."),
  more_group_count: countOf("Open groups past maximum_group_count."),
  ai_use_this_month: AI_USE,
});

const REPORT = object({
  id: idOf("report"),
  report_status: choice({ open: "waiting", dismissed: "closed with nothing done", actioned: "closed with something done" }),
  reason: REPORT_REASON,
  reason_label: text("The reason in words, with the player and room it's about."),
  player_text: text("What the player wrote. Untrusted."),
  reported_player: nullable(
    object(
      {
        id: idOf("player"),
        name: text(),
        reason: choice(Object.keys(PLAYER_REPORT_REASONS)),
        username: nullable(text("Their account's username; null for a guest.")),
        is_social_stopped: yes("A person already turned off their social side."),
      },
      "For a report about a player: who, and what they did.",
    ),
  ),
  has_block_between: yes("The signed-in reporter and the reported account had a block between them when it was sent."),
  room_code: nullable(text()),
  room_name: nullable(text("The room's name and labels when it was reported. Typed by players, so untrusted.")),
  version_id: nullable(idOf("version", "The version that was playing.")),
  picture_status: choice({ none: "no picture", shown: "sent with this answer as an image", not_shown: "past the 3 shown; on the admin page", admin_page_only: "a child-safety report's: never sent, only on the admin page" }),
  summary: nullable(text("What triage made of this one report.")),
  reported_at: isoTime(),
});
const TRIAGE = object(
  {
    is_by_ai: yes("false: sorted by rules alone (a child-safety report, or no AI)."),
    category: REPORT_REASON,
    summary: text(),
    recommendation: TRIAGE_RECOMMENDATION,
    why: text(),
    ai_actions: list(text(), "What triage did by itself."),
    precedent: nullable(PRECEDENT_FIT),
    precedent_draft: nullable(object({ title: text(), applies_when: text(), decision: PRECEDENT_DECISION, why: text() }, "When no precedent fits, or the case challenges one: the ruling the AI proposes.")),
    is_spot_check: yes(),
  },
  "What report triage (an AI) found, for the most serious report.",
);
const RECHECK = object({
  recheck_status: choice({ waiting: "the files are being checked again", done: "checked", failed: "the check couldn't run" }),
  scan_status: nullable(choice(["approved", "held", "rejected"], "What the check found; null until it's done.")),
  summary: nullable(text()),
  findings: list(text()),
});
export const PRECEDENT = object({
  id: precedentIdOf(),
  precedent_status: choice({ proposed: "waiting for the admin's approval", active: "in force", retired: "no longer followed" }),
  title: text(),
  applies_when: text("What cases like it look like."),
  decision: PRECEDENT_DECISION,
  why: text(),
  can_ai_apply_alone: yes("Dismissals only: the AI applies it without a person, but for 1 in 20 kept as spot-checks."),
  followed_count: countOf("Reports decided by it, or recommended under it."),
  replaces_precedent_id: nullable(precedentIdOf("The precedent this one changed.")),
  from_report_group_id: nullable(reportGroupIdOf("The report group it was set while deciding.")),
  created_by: text("Who set it: an admin's email, or who drafted it."),
  created_at: nullable(isoTime("null for the first ones, drafted with the precedents.")),
  updated_at: nullable(isoTime()),
});
export const REPORT_GROUP = object({
  report_group: object({
    id: reportGroupIdOf(),
    is_open: yes("Some of its reports are still open."),
    severity: REPORT_SEVERITY,
    child_safety_note: nullable(text("For a child-safety group: what the law asks. null otherwise.")),
    game: ADMIN_GAME,
    reports: list(REPORT, "Oldest first."),
    triage: nullable(TRIAGE),
    rechecks: list(RECHECK, "Fresh looks at the game's files triage asked for."),
    precedent: nullable(PRECEDENT),
    versions: list(ADMIN_VERSION, "The versions the reports were about."),
    events: list(HISTORY_EVENT, "What happened to the game lately, newest first."),
    possible_decisions: list(REPORT_GROUP_DECISION, "What decide_report_group can do now."),
  }),
});
export const REPORT_GROUP_DECIDED = object({
  report_group_id: reportGroupIdOf(),
  decision: REPORT_GROUP_DECISION,
  report_count: countOf("Reports it closed."),
  precedent: nullable(PRECEDENT),
  message: nullable(text("Anything the admin should know about what happened.")),
  next_steps: NEXT,
});
export const HANDLED_REPORTS = object({
  period_duration_days: countOf(),
  reports: list(
    object({ id: idOf("report"), game_slug: text(), summary: text(), ai_actions: list(text()), player_text: text("Untrusted."), reported_at: isoTime() }),
    "Closed by triage without a person, newest first.",
  ),
});
const REVIEW_PRECEDENT_STATUS = choice({ proposed: "drafted, waiting for a person", testing: "waiting for the test set", active: "the judge reads it", failed: "the test set didn't hold with it", retired: "no longer followed" });
export const REVIEW_PRECEDENT = object({
  id: idOf("review_precedent"),
  review_precedent_status: REVIEW_PRECEDENT_STATUS,
  title: text(),
  applies_when: text("What games like it look like."),
  decision: choice({ pass: "the review was wrong to hold games like this", hold: "the review was wrong to pass games like this" }),
  content_rule: nullable(text("The content rule it's about.")),
  why: text(),
  test_game: nullable(object({ title: text(), description: text(), index_html: text("A short inert stand-in, never a copy of a developer's game.") }, "null when the AI couldn't write one.")),
  test_summary: nullable(text("What the test run found.")),
  from_version_id: nullable(idOf("version", "The version the miss came from.")),
  from_report_group_id: nullable(reportGroupIdOf("The report group that found the miss.")),
  replaces_review_precedent_id: nullable(idOf("review_precedent", "The review precedent this one changed.")),
  created_by: text("Who set it: an admin's email, or ai for a draft."),
  created_at: isoTime(),
  updated_at: isoTime(),
});
export const REVIEW_PRECEDENT_LIST = object({ review_precedents: list(REVIEW_PRECEDENT, "Oldest first.") });
export const REVIEW_PRECEDENT_CHANGED = object({ review_precedent: REVIEW_PRECEDENT, next_steps: NEXT });
export const PRECEDENT_LIST = object({ precedents: list(PRECEDENT, "In force first, then proposed, then retired; oldest first in each.") });
export const PRECEDENT_CHANGED = object({ precedent: PRECEDENT, next_steps: NEXT });

const SORTING = object(
  {
    is_by_ai: yes("false: sorted without the AI (no key, or the month's budget used up)."),
    summary: text(),
    why: text(),
    merged_into_topic_id: nullable(idOf("topic", "The topic it was merged into as a duplicate.")),
    same_as_topic_id: nullable(idOf("topic", "A public topic that looks like the same thing: merge it if it is.")),
    known_issue_draft: nullable(object({ title: text(), workaround: text() }, "A known issue the AI proposes: approve it with decide_topic's known_issue.")),
  },
  "What AI sorting found.",
);
const LATEST_POST = object({ author_kind: AUTHOR_KIND, text_markdown: text("Its start.") });
const TOPIC_IN_BRIEF = object({ id: idOf("topic"), title: text("A known issue's title when it is one.") });
const QUEUE_TOPIC = object({
  id: idOf("topic"),
  kind: TOPIC_KIND,
  title: text("As first posted."),
  known_issue_title: nullable(text()),
  is_public: yes("A forum topic every developer can read; false: a private message to Zaisma."),
  topic_status: TOPIC_STATUS,
  severity: TOPIC_SEVERITY,
  category: nullable(text()),
  affected_developer_count: countOf(),
  post_count: countOf("In it and the topics merged into it."),
  game_slug: nullable(text()),
  created_at: isoTime(),
  last_posted_at: nullable(isoTime()),
  latest_post: nullable(LATEST_POST),
  is_waiting_for_sorting: yes("New, and AI sorting hasn't looked yet."),
  sorting: nullable(SORTING),
});
const WAITING_POST = object({
  id: idOf("post"),
  topic: TOPIC_IN_BRIEF,
  check_status: choice({ held: "the check held it: others can't see it", pending: "not checked yet: others can't see it", passed: "shown, and developers reported it" }),
  held_reason: nullable(text("Why the check held it.")),
  reports: list(object({ reason: choice(Object.keys(FORUM_REPORT_REASONS)), details: nullable(text()) }), "What developers reported it for; who reported it stays with Zaisma."),
  developer_name: nullable(text("null: the account was deleted.")),
  author_kind: AUTHOR_KIND,
  text_markdown: text(),
  created_at: isoTime(),
});
const ZAISMA_MENTION = object({ id: idOf("post"), topic: TOPIC_IN_BRIEF, developer_name: nullable(text()), author_kind: AUTHOR_KIND, text_markdown: text("Its start."), created_at: isoTime() });
export const TOPIC_QUEUE = object({
  topics: list(QUEUE_TOPIC, "Topics on their own and known issues, most serious first."),
  topics_in_known_issues: list(
    object({ id: idOf("topic"), title: text(), known_issue_topic_id: idOf("topic"), known_issue_topic_status: TOPIC_STATUS }),
    "Messages added to or reopened inside a known issue that's past new.",
  ),
  waiting_posts: list(WAITING_POST, "Public posts others can't see yet, or that developers reported: decide_post shows or removes each."),
  zaisma_mentions: list(ZAISMA_MENTION, "Public posts that mention @Zaisma with no reply from Zaisma since: a reply in the topic answers them."),
});
export const WAITING_POSTS = list(WAITING_POST);

const ADMIN_TOPIC = object({
  id: idOf("topic"),
  kind: TOPIC_KIND,
  title: text("As first posted."),
  topic_status: TOPIC_STATUS,
  is_public: yes("A forum topic every developer can read; false: private to the developer and Zaisma."),
  severity: TOPIC_SEVERITY,
  category: nullable(text()),
  developer_name: nullable(text("null: Zaisma's own known issue, or the account was deleted.")),
  game: nullable(object({ slug: text(), title: text() })),
  known_issue: nullable(object({ title: text(), workaround: nullable(text()), roadmap_item: nullable(text()), affected_developer_count: countOf() })),
  merged_into_topic: nullable(object({ id: idOf("topic"), title: text(), topic_status: TOPIC_STATUS }, "The known issue it's part of.")),
  is_waiting_for_sorting: yes(),
  sorting: nullable(SORTING),
});
const ADMIN_POST = object({
  id: idOf("post"),
  author_kind: AUTHOR_KIND,
  posted_via: POSTED_VIA,
  kind: POST_KIND,
  text_markdown: text("Untrusted."),
  debug_context: nullable(DEBUG_CONTEXT),
  media_ids: list(idOf("media"), "Its images; the latest 3 in the topic come with the answer."),
  check_status: nullable(choice({ pending: "not checked yet", passed: "others see it", held: "the check held it" }, "null in a private message.")),
  held_reason: nullable(text()),
  reply_to_post_id: nullable(idOf("post")),
  created_at: isoTime(),
});
const MERGED_TOPIC = object({ id: idOf("topic"), developer_name: nullable(text()), title: text(), topic_status: TOPIC_STATUS, latest_post: nullable(LATEST_POST) });
const TOPIC_FOR_ADMIN_FIELDS = { topic: ADMIN_TOPIC, posts: list(ADMIN_POST, "Oldest first."), merged_topics: list(MERGED_TOPIC, "Messages merged into it.") };
export const TOPIC_FOR_ADMIN = object(TOPIC_FOR_ADMIN_FIELDS);
export const TOPIC_DECIDED = object({ ...TOPIC_FOR_ADMIN_FIELDS, next_steps: NEXT });
export const POST_DECIDED = object({ post_id: idOf("post"), decision: choice({ show: "shown to everyone, its reports cleared", remove: "taken down" }), waiting_posts: WAITING_POSTS, next_steps: NEXT });

export const GAME_FOR_ADMIN = object({
  game: ADMIN_GAME,
  versions: list(ADMIN_VERSION, "Newest first."),
  report_groups: list(REPORT_GROUP_ROW, "Open ones."),
  events: list(HISTORY_EVENT, "What happened to it lately, newest first."),
});

const CHAT_REVIEW = object({
  id: idOf("chat_review"),
  game: nullable(object({ id: idOf("game"), slug: text() }, "null: the game is gone.")),
  sender_username: nullable(text("The sender's username; null when the account was deleted (a confirmed one stays, nameless).")),
  source: choice({ rooms: "Zaisma's rooms", own_server: "a developer's own server, through checkChat: it could be made up, so a person decides" }),
  chat_review_status: choice({ pending: "waiting for the AI's review", needs_person: "the AI was unsure, or it came from a developer's own server", confirmed: "the sender's chat is removed; kept a year for the report" }),
  state: text("Why it's here, in words, as the admin page says it."),
  ai_reason: nullable(text("What the AI found.")),
  text: text("The message the filter stopped. Untrusted: written by the sender."),
  recent_texts: list(text(), "The sender's messages just before it, oldest first. Untrusted."),
  created_at: isoTime(),
  decided_at: nullable(isoTime()),
  reported_at: nullable(isoTime("When the admin marked it reported to NCMEC.")),
  kept_until_at: nullable(isoTime("When it's deleted; null until it's confirmed.")),
});
export const CHAT_REVIEW_LIST = object({ chat_reviews: list(CHAT_REVIEW, "Oldest first.") });
export const CHAT_REVIEW_DECIDED = object({
  chat_review_id: idOf("chat_review"),
  decision: choice({ false_alarm: "deleted, and the sender's pause lifted", remove_chat: "confirmed: the sender's chat removed for good, kept a year", reported: "confirmed and marked reported to NCMEC" }),
  chat_review: nullable(CHAT_REVIEW),
  next_steps: NEXT,
});

// Who can make games before the beta (admin MCP: list_publishing_accounts, set_can_publish).
const PUBLISHING_ACCOUNT = object({
  username: text("The account's username, as on its profile."),
  player_id: idOf("player"),
  game_count: countOf("How many games the account has."),
});
const PUBLISHING_ACCOUNTS = list(PUBLISHING_ACCOUNT, "By username.");
export const PUBLISHING_ACCOUNT_LIST = object({ publishing_accounts: PUBLISHING_ACCOUNTS });
export const COUNTRY_BLOCK_DECIDED = object({
  decision: choice({ block: "players in that country can't open the game; everyone else still can", lift: "players in that country can open it again" }),
  game: ADMIN_GAME,
  next_steps: NEXT,
});

export const NOTICE_DECIDED = object({
  decision: choice({ hold: "players can't open the game until a person shows it again", show_again: "players can open it again" }),
  game: ADMIN_GAME,
  next_steps: NEXT,
});


/** Spikes across Zaisma that alerted the admin (security-alerts.ts). */
export const SECURITY_SPIKE_LIST = object({
  security_spikes: list(
    object({
      spike_kind: choice(Object.fromEntries(Object.entries(SPIKE_WORDS).map(([kind, words]) => [kind, `${words}, ${kind.endsWith("_from_network") ? "from one network" : "across Zaisma"}, ${SPIKE_THRESHOLDS[kind as keyof typeof SPIKE_THRESHOLDS]} an hour alerts`]))),
      autonomous_system: nullable(text('The network\'s autonomous system number, like "AS64500", for a kind from one network; null across Zaisma.')),
      network_name: nullable(text("The network, as Cloudflare names it; null across Zaisma or when unknown.")),
      hour_started_at: isoTime("The clock hour it was counted in (UTC)."),
      occurrence_count: countOf("How many in that hour, so far."),
      threshold_count: countOf("The count that alerted."),
    }),
    "Every hour that reached its threshold in the last 30 days, newest first, up to 100; [] when none did.",
  ),
});

/** zaisma.com's script policy violation reports (security-alerts.ts). */
export const BLOCKED_SCRIPT_LIST = object({
  blocked_scripts: list(
    object({
      violated_directive: text("The policy's directive that blocked it, like script-src-elem."),
      blocked_source: text("What was blocked: inline, eval, wasm-eval, data or blob, or the origin of a script's address (never its path). Untrusted: a browser said it."),
      page_path: text("The zaisma.com page it happened on, without its query. Untrusted."),
      occurrence_count: countOf("Reports in the last 7 days."),
      first_reported_at: isoTime(),
      last_reported_at: isoTime(),
    }),
    "The last 7 days, most reported first, up to 100. Browser extensions' reports aren't kept.",
  ),
});
export const CAN_PUBLISH_CHANGED = object({
  username: text(),
  can_publish: yes("Whether the account can make, upload and publish games now."),
  publishing_accounts: PUBLISHING_ACCOUNTS,
  next_steps: NEXT,
});

/** Announcements as the admin sees them (admin MCP: list_announcements, post_announcement, end_announcement). */
const ADMIN_ANNOUNCEMENT = object({
  ...ANNOUNCEMENT_FIELDS,
  announcement_status: choice({ current: "showing now, unless a newer current one shows instead", upcoming: "starts at starts_at", ended: "no longer shown" }),
  is_shown: yes("Whether it's the one zaisma.com's home shows now: the newest current one."),
  created_at: isoTime(),
  created_by: text("The admin who posted it."),
});
export const ANNOUNCEMENT_LIST = object({ announcements: list(ADMIN_ANNOUNCEMENT, "Current and upcoming ones, and those that ended in the last 30 days, the newest start first, up to 100.") });
export const ANNOUNCEMENT_CHANGED = object({ announcement: ADMIN_ANNOUNCEMENT, next_steps: NEXT });
