import { ApiError, CONTROLS, DEVICES, FORUM_CATEGORIES, FORUM_LIMITS, FORUM_REPORT_REASONS, FORUM_SECTIONS, FORUM_TABS, FORUM_TAGS, ACCOUNT_REQUIREMENTS, LINK_LIMITS, LOG_LIMITS, LOG_SOURCE_KINDS, MINIMUM_LOG_LEVELS, MINIMUM_PLAYER_AGES, OWN_SERVER_LIMITS, LINK_NAME_PATTERN, PLAY_STYLES, POST_RATINGS, POST_SELECTIONS, ROOM_BROWSING, SCREENS, TOPIC_KINDS, TOPIC_STATUSES, VISIBILITIES, WEBHOOK_DESTINATION_KINDS, WEBHOOK_EVENT_KINDS, WEBHOOK_TIMEOUT_SEC, type IdKind } from "@zaisma/core";
import { INTERNAL_ERROR, apiCall, authenticate, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { CHECKED_TEXT_EXTENSIONS, extensionOf } from "../../../packages/cli/check.mjs";
import { ACCESS, ACTIVITY, GAME_CHECK_FIELDS, API_KEYS, DATABASE, DATABASE_EXPORT, DATABASE_IMPORT, DATABASE_RESTORED, ERASED_PLAYER, GAME, GAME_ALERTS, GAME_EXPORT, HISTORY, LISTED_GAME, QR_CODE, STATEMENT_RESULT, IMAGE, LOGS, SAVE, SAVE_CHANGED, SAVE_COPY, SAVE_COPY_LIST, SAVE_LIST, NEW_REPLY, NEW_TOPIC, NEXT, PLAYER_PROFILE, POST, POST_BOOKMARK, POST_RATING, REPORTS, SIGN_IN_APP, SECRET, STATS, TESTER, TOPIC_PAGE, TOPIC_WITH_POSTS, VERSION, WEBHOOK, WEBHOOK_DELIVERY, answerOrError, choice, countOf, idOf, list, nullable, object as answer, text, yes } from "./schemas.ts";

/**
 * The developer MCP at /mcp: every tool is a call to the developer API, so the MCP, the upload command
 * and the dashboard always agree. Streamable HTTP without sessions or streaming: each POST is one
 * JSON-RPC message (or a batch) and gets a JSON answer. Sign in with an API key as a Bearer token.
 */

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** Small games can be sent straight through the MCP; bigger builds go through the upload command. */
const MAXIMUM_MCP_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
const MAXIMUM_BODY_SIZE_BYTES = 8 * 1024 * 1024;

const INSTRUCTIONS = `Zaisma hosts browser games: a game is a folder with an index.html at the top. Players open zaisma.com/g/<slug> and play in any browser, no install.

How publishing works:
1. create_game makes a game. It starts as a draft only its developer can see. Until the beta, only accounts Zaisma adds can make, upload and publish games: others get publishing_not_open, and get_access says can_publish.
2. Check, then upload a version. Small games (under 5 MB, like single-file HTML games): check_game, then upload_files, with the file contents. Bigger builds: run \`npx @zaisma/cli upload <folder> --game <slug>\` in a terminal with ZAISMA_KEY set to the same API key; it runs the same check first (\`npx @zaisma/cli check <folder>\` runs it alone, with no key), downloads files the game loads from other sites and unpacks pre-compressed builds in what it sends, and only sends changed files.
3. Every version is scanned, usually in under a minute; get_version shows the result. A held version waits for a person, usually within a day, or, when its findings say daily_large_reviews_used or daily_small_reviews_used, for the next of the developer's daily reviews (5 large, 30 small). Passed versions get a private preview link.
4. publish_version makes a passed version live (or rolls back to an older one), now or at a set time. Then update_game with visibility "listed" shows the game to players (or "unlisted": only people with the link). To let testers play first, keep it private and make tester links with add_tester_link.

Ask the developer before making a game private or a draft again (players lose access), and show them the preview link before publishing.

Every hold, rejection and takedown says why, as review_reason (on a game, version or image, and in get_history) and as a version's findings: a code, a plain message, the content_rule it's about (null when it breaks none) and a fix. Tell the developer the message and the fix, and do what the fix says; never guess beyond them. search_forum with the code finds others who had it.

Zaisma's developer forum is where developers and their AI talk with the people who build Zaisma, and you're asked to use it. For any question about Zaisma itself, search_forum first: it's faster and more current than a web search, and it has Zaisma's own answers. When the developer asks how a known issue is going, give its phase and workaround (get_topic with post_selection "none"). Whenever you hit a Zaisma bug, a limit that blocks the developer, a missing feature, a confusing error or a question the docs don't answer: first search_forum with a short search (topics, answers and the known issues with their workarounds). If it's there, vote or like, reply, or send the developer's own case privately (message_zaisma with known_issue_topic_id); if their fixed topic is back, reopen it. Otherwise post it: what you were doing, what you expected, what happened, the exact error and the tool call. Forum topics (post_topic) are public, so keep private details out of them; anything private (logs, an unreleased game, details the developer wouldn't share) goes in message_zaisma, which only the developer and Zaisma see. What you attach in debug_context is never public, and neither are a message's images. Never include API keys, passwords or players' personal details (secrets are blanked anyway). Your posts carry the developer's name with an AI mark. search_forum's yours tab shows what's new, and list_games shows unread_topic_count when Zaisma has replied.

The developer may limit an API key to some games or to what it can do (like read only, or upload without publishing). A call it doesn't reach answers key_not_allowed, saying what it would need; get_access shows what the key can do. An app connected by signing in (like claude.ai) is limited the same way, by what the developer chose when connecting it, and get_access shows that too. Tell the developer, who can make another key on zaisma.com/account (or connect the app again); keys can't be made through the MCP.

Names say what they hold, its kind and its unit: file_count is a number of files, play_duration_min is minutes, size_bytes is bytes, *_at is an ISO time in UTC, an ID says its kind (version_…, topic_…, post_…), and a plural is always a list.

When a call fails, the answer is { "error": { code, message, field, fix, retry_after_sec } }: field is the input at fault, fix says what to do, and retry_after_sec how long to wait when waiting helps. Codes are stable: search_forum with one finds others who hit it. Calls that change something answer with next_steps: the calls that usually follow, with their arguments filled in and a reason; [] when nothing does.`;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** What the tool answers (schemas.ts); every answer is checked against it in the tests. */
  outputSchema?: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run: (toolArguments: Record<string, unknown>, call: ApiCall) => Promise<unknown>;
  /** A retired tool: it makes no API call and answers retired_tool, naming the tool that replaces it. */
  replacedBy?: string;
}

type ApiCall = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

const slug = { type: "string", description: "The game's link name, as in zaisma.com/g/<slug>, from list_games or create_game" };
/** An ID input: its kind is in its value, like version_8f3k2m9q1x7c4v6b0n5z (docs/NAMING.md, IDs). */
const idInput = (kind: IdKind, description: string) => ({ type: "string", pattern: `^${kind}_[a-z0-9]+$`, description, examples: [`${kind}_8f3k2m9q1x7c4v6b0n5z`] });
const versionId = idInput("version", "A version's id from get_game or upload_files");
/** What a tester link opens and until when, for add_tester_link and update_tester_link. */
const TESTER_CHOICES = {
  version_choice: { enum: ["live", "newest_passed", "picked"], description: "live: the version players get (the default). newest_passed: the newest version that passed the scan, published or not. picked: the version in picked_version_id" },
  picked_version_id: idInput("version", "With version_choice picked: the version it opens, which passed the scan (get_game)"),
  ends_at: { type: ["string", "null"], format: "date-time", description: "When it stops opening the game by itself, up to a year ahead; null for no end date", examples: ["2026-11-01T17:00:00Z"] },
};
const topicId = idInput("topic", "A topic's id from search_forum");
const postId = idInput("post", "A post's id from get_topic");
const playerId = idInput("player", "The player's ID, from list_saves or from your game: a room's players, or the sub of a player pass");
const saveCopyId = idInput("save_copy", "An earlier version's id from list_save_copies");
const saveKeys = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: { type: "string", minLength: 1, maxLength: 1000 },
  description: "Only these localStorage keys, to keep the answer small; leave out for the whole save. A key the save doesn't have is listed in missing_keys.",
};
/** Where a player's save is in the API, and its keys as query parameters (a key can hold a comma, so each is its own). */
const savePath = (toolArguments: Record<string, unknown>) => `/games/${pathPart(toolArguments.slug)}/saves/${pathPart(toolArguments.player_id)}`;
const keysQuery = (keys: unknown) => (Array.isArray(keys) && keys.length ? `?${keys.map((key) => `keys=${pathPart(key)}`).join("&")}` : "");
const SAVE_REACHES_GAMES =
  "A change reaches the player's devices on its own: an open game reloads with it the next time it saves or the player comes back to its tab, with no question to the player, and that device's progress is kept as an earlier version.";
const textMarkdown = {
  type: "string",
  minLength: 1,
  maxLength: FORUM_LIMITS.textCharacterCount,
  description: "Markdown: what you were doing, what you expected, what happened and how to make it happen again. Code and errors in ``` blocks; @Name or @[Two Words] mentions someone (forum_people finds names); a YouTube, Vimeo or Streamable link on its own line shows as a video.",
};
const debugContext = {
  type: "object",
  description: "Facts for whoever fixes it, without secrets or whole files. Only the developer and Zaisma see it.",
  properties: {
    call: { type: "string", maxLength: 500, description: "The tool, command or API call, like upload_files or POST /api/dev/games/sky-hopper/versions." },
    error_code: { type: "string", maxLength: 100, description: "The error's code, like too_big." },
    error_message: { type: "string", maxLength: 2000, description: "The error's message, word for word." },
    request_json: { type: "string", maxLength: 4000, description: "What was sent, as JSON." },
    notes: { type: "string", maxLength: 2000, description: "Anything else whoever fixes it should know: versions, the browser, what you tried." },
  },
  additionalProperties: false,
};
const images = (whoSees: string) => ({
  type: "array",
  items: { type: "string" },
  maxItems: FORUM_LIMITS.mcpImageCountPerPost,
  description: `Up to ${FORUM_LIMITS.mcpImageCountPerPost} images (PNG, JPEG, WebP or GIF, up to ${FORUM_LIMITS.mcpImageSizeBytes / 1048576} MB each), each base64. ${whoSees}`,
});
const details = {
  title: { type: "string", minLength: 1, maxLength: 80 },
  description: { type: "string", maxLength: 500, description: "Shown on the game page" },
  devices: { type: "array", items: { enum: DEVICES }, description: "Devices the game works on" },
  controls: { type: "array", items: { enum: CONTROLS }, description: "Controls the game supports" },
  screen_orientation: { type: ["string", "null"], enum: [...SCREENS, null], description: "null: not set" },
  play_modes: {
    type: ["array", "null"],
    minItems: 1,
    maxItems: 3,
    description: "How it's played: one entry per way to play. single takes no counts. local is together on one device or screen; online is each on their own device. maximum_player_count null means no limit. null clears it.",
    items: {
      type: "object",
      properties: {
        mode: { enum: ["single", "local", "online"] },
        minimum_player_count: { type: ["integer", "null"], minimum: 2 },
        maximum_player_count: { type: ["integer", "null"], minimum: 2 },
        play_style: { type: ["string", "null"], enum: [...PLAY_STYLES, null] },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    examples: [
      [{ mode: "single" }],
      [{ mode: "single" }, { mode: "online", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }],
      [{ mode: "local", minimum_player_count: 2, maximum_player_count: null, play_style: "versus" }],
    ],
  },
  cloud_saves_enabled: {
    type: "boolean",
    description: "Copy signed-in players' browser saves (localStorage and IndexedDB) to their account, so progress follows them to any device. On by default; turn off for games that keep their own saves on a server.",
  },
  account_offer_enabled: {
    type: "boolean",
    description: "Show guests the \"Keep your progress\" card by itself once they have progress and have played 5 minutes: it offers a free account so their progress is kept, beside the game. On by default; turn off for games that pick the moment themselves: Zaisma.player.offerAccount() shows the same card whenever the game likes, whatever this setting, at most once a visit and not for 3 days after the player chose Not now (Zaisma.player.signIn() asks with the game's own reason).",
  },
  deleted_account_erase_enabled: {
    type: "boolean",
    description: "true (the default): when a player deletes their Zaisma account, Zaisma erases their rows from this game's database (tables with a player_id column). false: you handle account_deleted events yourself.",
  },
  multiplayer_mode: {
    enum: ["none", "relay", "own"],
    description:
      "Multiplayer on Zaisma rooms. none: single-player or only the game's own servers (own_server_urls). relay: Zaisma passes each message to the others, no server code. own: your game server runs on Zaisma: put it in a zaisma-server/ folder at the top of the upload, where index.js default-exports { setup, onJoin, onLeave, onMessage, onTick, maximumPlayerCount, ticksPerSec } (plus, if it likes, canJoin, answering true, false or { refusalMessage }, onMoved, hostControlsEnabled, and idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, reconnectTimeoutSec, onAway and onBack for players who walk away: a player whose connection drops stays in the match as away (room.awayReason(playerId) \"lost\") for 30 seconds while they reconnect, and idle, hidden or still-disconnected players leave the match with their seat held for 5 minutes unless it decides otherwise; and onEnding(state, room), run once when the game has used the month's free player-hours and Zaisma will end the match at room.endsAt, an hour ahead, to save and tell players; any other option stops it starting, and get_stats says why) and can import the folder's other .js, .json (data) and .wasm (WebAssembly, like a physics engine) files by relative path (plain JavaScript ES modules; npm packages or TypeScript: bundle into one zaisma-server.js instead). Up to 500 files and 5 MB. It runs sealed off: it talks to its players, calls other servers only on the hosts listed in game_server_allowed_hosts (plain fetch(), https only; anything else throws an OutsideCallError), reads the game's secrets (set_secret) as room.secrets and server.secrets, and has the game's own SQLite database as room.database, shared by its rooms and kept between matches (await room.database.query(sql, values) answers rows; room.database.batch([{ sql, values }]) is one transaction; free up to 500,000 rows written and 500 million read a month and 500 MB per game). Players never get the file. get_stats shows its errors. Any game's server (whatever this setting, even with no setup and no rooms) can also answer requests from the game outside rooms, like a leaderboard or a shop: onRequest(player, request, server) answers Zaisma.server.request(request) with plain JSON, with server.database the same database; free up to 1 million requests a month per game. And it can run on schedules: schedules: [{ name: \"daily-reset\", cron: \"0 0 * * *\" }] (up to 10, cron in UTC, at most once a minute, free) with onSchedule(run, server), where run.name says which is due; get_stats shows them with their next and last runs.",
  },
  friend_joins_enabled: {
    type: "boolean",
    description:
      "Whether Join on zaisma.com (a friend's face on /friends, \"Alex is playing\" on the game page, a profile's Playing now) and Zaisma.friends.list() take players into the room a friend is in. On by default, for every game with rooms (Zaisma rooms, or its own servers through Zaisma.friends.setRoom). false grays Join as \"This game doesn't take joins\". One room turns it off instead with joinRoom({ friendJoinsEnabled: false }) or room.setFriendJoinsEnabled(false) (\"Private room\"). It isn't a lock: a room link or code still reaches the room; close the room (setOpen(false)) or answer false from canJoin to keep players out.",
  },
  room_browsing: {
    enum: ROOM_BROWSING,
    description:
      "For games on Zaisma rooms: where open rooms are listed so players can join them. page (the default): on the game page and to the game through Zaisma.rooms.list(). game: only to the game, for games with their own lobby or server browser. off: nowhere; room codes and invite links still work. Single rooms can be hidden with joinRoom({ isListed: false }) or room.setListed(false).",
  },
  account_requirement: {
    enum: ACCOUNT_REQUIREMENTS,
    description:
      'What the game needs a Zaisma account for. none (the default): guests play everything, and signed-in players play as their account. multiplayer: guests play alone; only signed-in players get player passes, so a guest\'s Zaisma.joinRoom() and Zaisma.player() fail with error.code "account_needed" (show your own message). whole_game: the game page says "Needs a Zaisma account" and Play asks guests to sign in first; only signed-in players get player passes. Players under 13 can\'t make accounts, so they can\'t play games that need one.',
  },
  minimum_player_age_years: {
    type: "integer",
    enum: MINIMUM_PLAYER_AGES,
    description:
      "The youngest age that can play: 13 (everyone, the default), 16 or 18. Above 13 the whole game needs an account, since only accounts have an age; younger accounts can't find or open the game. Setting 16 or 18 alone sets account_requirement to whole_game too. The game never learns a player's age. Lifelike gore (photo-real injury up close) needs 16 or 18; setting it passes versions held only for ai_lifelike_gore.",
  },
  game_server_allowed_hosts: {
    type: "array",
    maxItems: 20,
    items: { type: "string", maxLength: 255 },
    description:
      "The hosts the game's server can call with plain fetch(): your own server, a payment provider, Discord, GitHub. Host names only, every call is https; \"*.example.com\" covers every name under example.com (not example.com itself). Never IP addresses or Zaisma's own domains. Up to 20; the whole list each time, [] for none. Live within a minute, with no approval; players don't see it. A call to anything else throws an OutsideCallError (code host_not_allowed) in the game server, which get_stats shows. Its secrets (tokens, keys) go in set_secret.",
    examples: [["discord.com"], ["api.github.com", "api.stripe.com"], ["play.skyhopper.io", "*.cdn.skyhopper.io"]],
  },
  own_server_urls: {
    type: "array",
    maxItems: OWN_SERVER_LIMITS.maximumServerCount,
    items: { type: "string", maxLength: OWN_SERVER_LIMITS.maximumUrlCharacterCount },
    description:
      'Your own servers the game connects to from players\' browsers: a game server you run with @zaisma/game-server (Zaisma.joinRoom({ serverUrl })), your own relay or API. wss:// or https:// and the name, with a port if it needs one, nothing after it; never an IP address, this computer or Zaisma\'s own domains. Up to 5; the whole list each time, [] for none. Live at once with no approval, kept in the game\'s history, and the game\'s ⋯ menu names them: "Online play runs on the developer\'s own server: play.example.com". Not for servers your game server on Zaisma calls (that\'s game_server_allowed_hosts).',
    examples: [["wss://play.skyhopper.io"], ["wss://eu.skyhopper.io", "wss://us.skyhopper.io:8443"]],
  },
  links: {
    type: "array",
    maxItems: LINK_LIMITS.maximumLinkCount,
    items: {
      type: "object",
      properties: {
        link_name: { type: "string", pattern: LINK_NAME_PATTERN.source, description: 'What the game opens it by, Zaisma.links.open("store"): up to 32 lowercase letters, digits and underscores, starting with a letter.' },
        destination_url: { type: "string", maxLength: LINK_LIMITS.maximumDestinationUrlCharacterCount, description: "The whole https address, like https://kit.itch.io/sky-hopper. The game can add a path and query under it when it opens the link." },
        is_on_game_page: { type: "boolean", description: "The game page shows it too, not only the game." },
      },
      required: ["link_name", "destination_url", "is_on_game_page"],
      additionalProperties: false,
    },
    description:
      'The game\'s registered links: the sites it opens with Zaisma.links.open(link_name), like its store, Patreon, Steam page or Discord, behind Zaisma\'s "You\'re leaving Zaisma" card over the game; the game can open no other sites. The whole list each time, up to 20; [] for none. The game can add a path and query under a link\'s address: Zaisma.links.open("store", { path: "/buy", queryParameters: { item: "sword" } }). Signed-in adults open any link; guests and under-18 accounts only links on trusted store, payment and video sites (itch.io, Steam, Patreon, Ko-fi, Gumroad, PayPal, Stripe payment links, hosted Bitcoin pages, YouTube and others), never chat apps or social networks like Discord or Instagram: get_game\'s who_can_open says which, and anyone a link doesn\'t open for sees "This link can\'t be opened here." (the game hears "stayed"). No link shorteners, IP addresses or user names in addresses. Every site is checked against Cloudflare\'s malware and phishing list when added and every day; a listed one opens for nobody, with a review_reason. Live at once, with no approval.',
    examples: [[{ link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true }], [{ link_name: "patreon", destination_url: "https://www.patreon.com/kit", is_on_game_page: true }, { link_name: "discord", destination_url: "https://discord.gg/skyhopper", is_on_game_page: false }]],
  },
};
const DETAILS = Object.keys(details);
const read = { readOnlyHint: true, openWorldHint: false } as const;
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const pick = (toolArguments: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((key) => toolArguments[key] !== undefined).map((key) => [key, toolArguments[key]]));
/** A value as one part of an API path. */
const pathPart = (given: unknown) => encodeURIComponent(String(given ?? ""));

/** The developer MCP's tools; exported for the naming checks. */
export const TOOLS: Tool[] = [
  {
    name: "list_games",
    title: "List my games",
    description: "Your games, with their visibility (draft, listed, unlisted, private), review_status and alerts: what needs your attention in each, most urgent first (a takedown or hold, a rejected or held version, rooms, requests or the game database paused for the month or the database full, open player reports). Also unread_topic_count: how many of your forum topics Zaisma has replied to or changed since you last opened them (search_forum, tab yours).",
    inputSchema: object({}),
    outputSchema: answer({ games: list(LISTED_GAME), unread_topic_count: countOf("Your forum topics with something new from Zaisma.") }),
    annotations: read,
    run: (_, call) => call("GET", "/games"),
  },
  {
    name: "create_game",
    title: "Make a game",
    description: "Make a new game. It starts as a draft only you can see. The link name comes from the title unless you give one. Until the beta, only accounts Zaisma adds can make games: others get publishing_not_open (get_access says can_publish).",
    inputSchema: object({ ...details, slug: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", description: "Link name: lowercase letters, numbers and single hyphens" } }, ["title"]),
    outputSchema: answer({ game: GAME, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", "/games", pick(toolArguments, ["slug", ...DETAILS])),
  },
  {
    name: "get_game",
    title: "Get a game",
    description: "One game: its details (and review_reason when Zaisma holds it or took it down; its registered links, each with who_can_open), its alerts (what needs your attention, as in list_games), covers and screenshots, every version with its scan result, findings, preview link and whether it's live, and its tester links.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: answer({ game: GAME, alerts: GAME_ALERTS, playing_now_player_count: countOf("People playing now: browsers that pressed Play and still have the game on screen, plus players in your Zaisma rooms. Counted from the last 6 minutes."), images: list(IMAGE), versions: list(VERSION, "Newest first."), testers: list(TESTER) }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}`),
  },
  {
    name: "update_game",
    title: "Change a game's details",
    description:
      'Change the title, description, device labels, play_modes (single-player, local and online multiplayer with player counts), cloud saves, multiplayer, room browsing, what it needs an account for, the youngest age that can play (minimum_player_age_years), the hosts its game server can call (game_server_allowed_hosts), its own servers players connect to (own_server_urls), its registered links (links, which the game opens with Zaisma.links.open) or visibility. listed: on Zaisma for everyone. unlisted: only people with the link. private and draft: only you and people with a tester link (add_tester_link). Leave out what stays the same; null clears it. A new title or description on a game players can see waits for review. Making a public game private or a draft takes it away from players, so it needs "confirm": true after asking the developer.\n\n' +
      'Not: { "play_modes": [{ "mode": "single", "maximum_player_count": 1 }] } (single takes no player counts: { "mode": "single" })\n' +
      'Not: { "play_modes": [{ "mode": "online", "maximum_player_count": 4 }] } (local and online need minimum_player_count, 2 or more, and play_style)\n' +
      'Not: { "play_modes": ["single", "online"] } (each mode is an object, like { "mode": "single" })\n' +
      'Not: { "players": "2-4" } (player counts go in play_modes)\n' +
      'Not: { "play_modes": [] } (null clears it)\n' +
      'Not: { "visibility": "public" } (listed: everyone; unlisted: only people with the link)\n' +
      'Not: { "minimum_player_age_years": 16, "account_requirement": "none" } (accounts_needed_for_minimum_age: a game for 16 or 18 and up is accounts only, so leave account_requirement out or give whole_game)\n' +
      'Not: { "minimum_player_age_years": 13 } on a game whose live version shows lifelike gore (content_needs_minimum_age: publish a version with stylized gore first, then lower the age)\n' +
      'Not: { "game_server_allowed_hosts": ["https://discord.com/api/webhooks/123"] } (host names only: ["discord.com"])\n' +
      'Not: { "game_server_allowed_hosts": ["*"] } (list each host, or "*.example.com" for the names under one)\n' +
      'Not: { "own_server_urls": ["play.example.com"] } (the whole address: ["wss://play.example.com"])\n' +
      'Not: { "own_server_urls": ["wss://play.example.com/rooms"] } (nothing after the name: ["wss://play.example.com"])\n' +
      'Not: { "links": { "store": "https://kit.itch.io/sky-hopper" } } (a list: [{ "link_name": "store", "destination_url": "https://kit.itch.io/sky-hopper", "is_on_game_page": true }])\n' +
      'Not: { "links": [{ "link_name": "patreon", "destination_url": "patreon.com/kit", "is_on_game_page": true }] } (the whole address: "https://www.patreon.com/kit")\n' +
      'Not: { "links": [{ "link_name": "Store Page", "destination_url": "https://kit.itch.io/sky-hopper", "is_on_game_page": true }] } (lowercase letters, digits and underscores: "store_page")',
    inputSchema: {
      ...object({ slug, ...details, visibility: { enum: VISIBILITIES }, confirm: { type: "boolean", description: "The developer agreed to hide a public game" } }, ["slug"]),
      examples: [
        { slug: "sky-hopper", play_modes: [{ mode: "single" }, { mode: "online", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }] },
        { slug: "party-hop", play_modes: [{ mode: "local", minimum_player_count: 2, maximum_player_count: null, play_style: "versus" }], devices: ["phone", "tablet"], controls: ["touch"], screen_orientation: "landscape" },
        { slug: "sky-hopper", visibility: "listed" },
        { slug: "sky-hopper", multiplayer_mode: "relay", room_browsing: "page" },
        { slug: "sky-hopper", friend_joins_enabled: false },
        { slug: "sky-hopper", play_modes: null },
        { slug: "sky-hopper", account_requirement: "multiplayer" },
        { slug: "sky-hopper", minimum_player_age_years: 16 },
        { slug: "sky-hopper", game_server_allowed_hosts: ["discord.com", "api.github.com"] },
        { slug: "sky-hopper", own_server_urls: ["wss://play.skyhopper.io"] },
        { slug: "sky-hopper", links: [{ link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true }, { link_name: "patreon", destination_url: "https://www.patreon.com/kit", is_on_game_page: true }] },
      ],
    },
    outputSchema: answer({
      game: GAME,
      review_message: nullable(text("Set when a new title or description waits for review.")),
      game_server_problem: nullable(text("Why the game's own game server can't run yet, after multiplayer_mode own.")),
      next_steps: NEXT,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (toolArguments, call) => {
      const change = pick(toolArguments, [...DETAILS, "visibility"]);
      if (change.visibility === "draft" || change.visibility === "private") {
        const { game } = (await call("GET", `/games/${pathPart(toolArguments.slug)}`)) as { game: { visibility: string; review_status: string } };
        if ((game.visibility === "listed" || game.visibility === "unlisted") && game.review_status === "live" && toolArguments.confirm !== true) {
          throw new ApiError("needs_confirm", {
            message: `Players can play this game now, and making it ${change.visibility} takes it away from them.`,
            field: "confirm",
            fix: 'Ask the developer; if they agree, call again with "confirm": true.',
          });
        }
      }
      return call("PATCH", `/games/${pathPart(toolArguments.slug)}`, change);
    },
  },
  {
    name: "upload_files",
    title: "Upload a small game",
    description:
      `Upload a new version from file contents, up to ${MAXIMUM_MCP_UPLOAD_SIZE_BYTES / 1048576} MB in all. It needs an index.html at the top; paths are relative to the game's folder. Text files (HTML, JavaScript, CSS, JSON) go in "content_text", every other file (images, sounds, fonts, .wasm) base64-encoded in "content_base64". It's scanned, then waits as a draft with a preview link (or goes live when it passes, with publish_when_approved). Check the files with check_game first: upload_files sends them as they are. For bigger builds, run \`npx @zaisma/cli upload <folder> --game <slug>\` instead.\n\n` +
      'Not: { "files": [{ "path": "index.html", "content": "<!doctype html>…" }] } (text goes in content_text, other files base64 in content_base64)\n' +
      'Not: { "files": [{ "path": "assets/hero.png", "content_text": "iVBORw0KGgo…" }] } (an image or sound is base64 in content_base64)\n' +
      'Not: { "files": [{ "path": "my-game/index.html", … }] } (paths are relative to the game\'s folder: index.html at the top)\n' +
      'Not: { "files": [{ "path": "/index.html", … }] } (no leading /)\n' +
      'Not: { "files": { "index.html": "<!doctype html>…" } } (files is a list of { path, content_text or content_base64 })\n' +
      `Not: a build over ${MAXIMUM_MCP_UPLOAD_SIZE_BYTES / 1048576} MB (run npx @zaisma/cli upload <folder> --game <slug>)`,
    inputSchema: {
      ...object(
        {
          slug,
          files: {
            type: "array",
            minItems: 1,
            items: object(
              {
                path: { type: "string", minLength: 1, maxLength: 200, description: "Relative to the game's folder, like index.html or assets/hero.png" },
                content_text: { type: "string", description: "The file as text, for HTML, JavaScript, CSS, JSON and other text files" },
                content_base64: { type: "string", description: "The file base64-encoded, for images, sounds, fonts, .wasm and every other file" },
              },
              ["path"],
            ),
          },
          patch_notes: { type: "string", maxLength: 2000, description: "What changed, shown to players" },
          publish_when_approved: { type: "boolean", description: "Go live as soon as it passes the scan; that's publishing, so it needs a key with version_access publish" },
        },
        ["slug", "files"],
      ),
      examples: [
        { slug: "sky-hopper", files: [{ path: "index.html", content_text: '<!doctype html><title>Sky Hopper</title><canvas id="game"></canvas><script>/* the game */</script>' }] },
        {
          slug: "sky-hopper",
          files: [
            { path: "index.html", content_text: '<!doctype html><title>Sky Hopper</title><canvas id="game"></canvas><script src="game.js"></script>' },
            { path: "game.js", content_text: "// the game" },
            { path: "assets/hero.png", content_base64: "iVBORw0KGgoAAAANSUhEUg==" },
          ],
          patch_notes: "Faster jumps and a new level.",
          publish_when_approved: true,
        },
      ],
    },
    outputSchema: answer({ version: VERSION, sent_file_count: countOf("Files Zaisma didn't have yet."), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => uploadFiles(toolArguments, call),
  },
  {
    name: "check_game",
    title: "Check a game before uploading",
    description:
      `Check a game's files before uploading them: what Zaisma would refuse (no index.html at the top, file types games can't have, pre-compressed files, hidden files, sizes) and what won't work inside Zaisma's game frame (files or scripts loaded from other sites, connections to servers that aren't the game's own, threaded engine builds, alert/confirm/prompt, forms, downloads, links that open other sites, frames of other sites, camera, location and the like), each with the fix. Send the same files as upload_files, up to ${MAXIMUM_MCP_UPLOAD_SIZE_BYTES / 1048576} MB; with slug, the game's own servers count and the fixes name it. It changes nothing and needs any key. upload_files fixes nothing itself, so fix what it lists first; is_fixed_by_upload_command says what the upload command (\`npx @zaisma/cli upload <folder> --game <slug>\`) would fix by itself. In a terminal, \`npx @zaisma/cli check <folder>\` runs the same check on a folder, with no key.\n\n` +
      'Not: { "folder": "./build" } (send the files: { "files": [{ "path": "index.html", "content_text": "…" }] }, or run npx @zaisma/cli check ./build in a terminal)\n' +
      'Not: { "files": [{ "path": "index.html", "content": "<!doctype html>…" }] } (text goes in content_text, other files base64 in content_base64)',
    inputSchema: {
      ...object(
        {
          files: {
            type: "array",
            minItems: 1,
            items: object(
              {
                path: { type: "string", minLength: 1, maxLength: 200, description: "Relative to the game's folder, like index.html or assets/hero.png" },
                content_text: { type: "string", description: "The file as text, for HTML, JavaScript, CSS, JSON and other text files" },
                content_base64: { type: "string", description: "The file base64-encoded, for images, sounds, fonts, .wasm and every other file" },
              },
              ["path"],
            ),
          },
          slug: { ...slug, description: "The game the files are for, if it has been made: its own servers count, and the fixes name it" },
        },
        ["files"],
      ),
      examples: [
        {
          slug: "sky-hopper",
          files: [
            { path: "index.html", content_text: '<!doctype html><title>Sky Hopper</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P"><link rel="modulepreload" href="game.js"><canvas id="game"></canvas>' },
            { path: "game.js", content_text: 'import Phaser from "https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.esm.js"; // the game' },
            { path: "assets/hero.png", content_base64: "iVBORw0KGgoAAAANSUhEUg==" },
          ],
        },
      ],
    },
    outputSchema: answer(GAME_CHECK_FIELDS),
    annotations: read,
    run: (toolArguments, call) => checkFiles(toolArguments, call),
  },
  {
    name: "get_version",
    title: "Check a version",
    description: "A version's scan_status (scanning, held, approved or rejected), why it's held or rejected (review_reason when a person or a report decided, and findings: what the scan found, each with the rule and the fix), and its private preview link once it passes.",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    outputSchema: answer({ version: VERSION }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/versions/${pathPart(toolArguments.version_id)}`),
  },
  {
    name: "publish_version",
    title: "Publish or roll back",
    description:
      "Make a version that passed review live now, or later at scheduled_publish_at (from a few minutes to 90 days ahead). Publishing an older version rolls back to it. The live version and the last 5 are kept.\n\n" +
      'Not: { "scheduled_publish_at": 1792012345678 } (an ISO time like "2026-11-01T17:00:00Z", not a number)\n' +
      'Not: { "scheduled_publish_at": "2026-11-01 17:00" } (ISO with T and Z or an offset: "2026-11-01T17:00:00Z")',
    inputSchema: object(
      { slug, version_id: versionId, scheduled_publish_at: { type: "string", format: "date-time", description: "Publish later instead, at this ISO time", examples: ["2026-11-01T17:00:00Z"] } },
      ["slug", "version_id"],
    ),
    outputSchema: answer({ game: GAME, version: VERSION, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/versions/${pathPart(toolArguments.version_id)}/publish`, pick(toolArguments, ["scheduled_publish_at"])),
  },
  {
    name: "cancel_scheduled_publish",
    title: "Cancel a publish-later",
    description: "Stop a version from going live at its scheduled time.",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    outputSchema: answer({ game: GAME, version: VERSION, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/games/${pathPart(toolArguments.slug)}/versions/${pathPart(toolArguments.version_id)}/publish`),
  },
  {
    name: "end_preview_links",
    title: "Turn off a version's preview links",
    description:
      "End every preview link handed out so far for this version, and every browser that opened one, straight away: for a link that was shared too widely. preview_url (get_version) hands out a fresh one that works again for a day. To show a version to testers, make a tester link instead (add_tester_link).",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    outputSchema: answer({ version: VERSION, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/games/${pathPart(toolArguments.slug)}/versions/${pathPart(toolArguments.version_id)}/preview-links`),
  },
  {
    name: "add_image",
    title: "Add a cover or screenshot",
    description: "Add a cover (landscape, 16:9 shows best), a square cover (optional, shown on phones instead, where a landscape one is small; as wide as tall, at least 512 px) or a screenshot (up to 8), or a share picture (optional: what shared game and room links show instead of the cover in chats, social sites and search; landscape, 1200 by 630 shows best). A new cover or share picture replaces the old one of its kind once approved. Players see the cover alone as the game's card, with no title drawn over or under it, so covers should carry the game's name or logo; screenshots are just the game. PNG, JPEG or WebP, up to 5 MB, at least 320 px a side. An AI check approves images in about a minute (get_game shows the result). Zaisma's lists only show games whose covers keep five lines: no text but the game's name, a subtitle and the studio's logo; nothing laid over the picture (buttons, menus, shop panels, badges, stickers, arrows); no fake rewards like free Robux (that holds the game); no famous characters, logos or names you don't own (Mario, Naruto, a club's crest); and the cover's main subject appears in a screenshot. Screenshots are real captures: the game's own interface is fine, but nothing added afterwards (captions, arrows, stickers). Style is free, but the best covers show one subject from the game, the name big enough to read on a phone, in the game's own art and colors on a simple background: zaisma.com/developers/covers has examples. No lifelike gore on covers, share pictures or screenshots, whatever the game's age setting: signed-out visitors see every listed game's cover.",
    inputSchema: object({ slug, kind: { enum: ["cover", "square", "screenshot", "share"] }, image_base64: { type: "string", description: "The PNG, JPEG or WebP file, base64-encoded (a data: URL prefix is fine)" } }, ["slug", "kind", "image_base64"]),
    outputSchema: answer({ image: IMAGE, review_message: text(), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/images?kind=${pathPart(toolArguments.kind)}`, decode(String(toolArguments.image_base64 ?? ""), "base64", "image_base64")),
  },
  {
    name: "remove_image",
    title: "Remove an image",
    description: "Remove a cover or screenshot by its id from get_game.",
    inputSchema: object({ slug, image_id: idInput("image", "An image's id from get_game") }, ["slug", "image_id"]),
    outputSchema: answer({ removed_image_id: idOf("image"), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/games/${pathPart(toolArguments.slug)}/images/${pathPart(toolArguments.image_id)}`),
  },
  {
    name: "add_tester_link",
    title: "Make a tester link",
    description:
      "Make a secret link that opens the game for anyone who has it, even while the game is private or a draft, with no account needed. It opens the live version unless version_choice says the newest version that passed the scan (newest_passed, to try an update before players get it) or one version (picked, with picked_version_id). It stays on until it's turned off, or until ends_at. Make one per group (your team, playtesters, a streamer) and name it for them, so you can turn one off without the others. Testers' progress stays in their browser, and survives a new link. Online play works through it only while it opens the live version, so a test build never reaches live rooms, game servers or data.\n\n" +
      'Not: { "version_choice": "version_8f3k2m9q1x7c4v6b" } (version_choice "picked" with picked_version_id "version_8f3k2m9q1x7c4v6b")\n' +
      'Not: { "ends_at": "next friday" } (an ISO time like "2026-11-01T17:00:00Z")',
    inputSchema: object({ slug, name: { type: "string", minLength: 1, maxLength: 60, description: 'Who it\'s for, like "Playtesters"' }, ...TESTER_CHOICES }, ["slug", "name"]),
    outputSchema: answer({ tester: TESTER, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/testers`, pick(toolArguments, ["name", "version_choice", "picked_version_id", "ends_at"])),
  },
  {
    name: "update_tester_link",
    title: "Change a tester link",
    description:
      "Change a tester link's name, the version it opens or its end date, by its id from get_game. Its testers keep the same link and their progress. Leave out what stays the same; ends_at null takes the end date away.\n\n" +
      'Not: { "picked_version_id": "version_8f3k2m9q1x7c4v6b" } on a live or newest_passed link (send version_choice "picked" with it)',
    inputSchema: object({ slug, tester_id: idInput("tester", "A tester link's id from get_game"), name: { type: "string", minLength: 1, maxLength: 60, description: "Who it's for" }, ...TESTER_CHOICES }, ["slug", "tester_id"]),
    outputSchema: answer({ tester: TESTER, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("PATCH", `/games/${pathPart(toolArguments.slug)}/testers/${pathPart(toolArguments.tester_id)}`, pick(toolArguments, ["name", "version_choice", "picked_version_id", "ends_at"])),
  },
  {
    name: "remove_tester_link",
    title: "Turn off a tester link",
    description: "Turn off a tester link by its id from get_game, for good: it stops opening the game straight away, and players who came through it leave their multiplayer matches within about 10 seconds. Make a new one to let that group back in.",
    inputSchema: object({ slug, tester_id: idInput("tester", "A tester link's id from get_game") }, ["slug", "tester_id"]),
    outputSchema: answer({ removed_tester_id: idOf("tester"), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/games/${pathPart(toolArguments.slug)}/testers/${pathPart(toolArguments.tester_id)}`),
  },
  {
    name: "list_sign_in_apps",
    title: "List my sign-in apps",
    description: "Your sign-in apps: your own sites, servers and apps that players sign in to with their Zaisma account (Sign in with Zaisma, standard OpenID Connect). Client secrets are never shown again; replace one with update_sign_in_app.",
    inputSchema: object({}),
    outputSchema: answer({ sign_in_apps: list(SIGN_IN_APP) }),
    annotations: read,
    run: (_, call) => call("GET", "/sign-in-apps"),
  },
  {
    name: "create_sign_in_app",
    title: "Make a sign-in app",
    description:
      'Let players sign in to your own site, server or game with its own accounts using their Zaisma account: Sign in with Zaisma, standard OpenID Connect (authorization code flow), so any OpenID Connect library works with issuer_url, the app\'s id as client_id and, for a confidential app, client_secret. Your site gets the player\'s ID (sub, a player_… ID, the same as in your games\' player passes) and, with the profile scope, their name; never an email, so ask for scope "openid profile". Public apps must send PKCE (S256). The client_secret is answered once, here: store it on your server and never in a page or game. Players see the name when they first sign in, and can remove the app from their account.\n\n' +
      'Not: { "redirect_urls": ["https://skyhopper.io/*"] } (exact URLs, no wildcards)\n' +
      'Not: { "kind": "public" } for a site with its own server (confidential: the server keeps the secret)\n' +
      'Not: { "name": "Zaisma Login" } (name the app the way players know your site)',
    inputSchema: {
      ...object(
        {
          name: { type: "string", minLength: 1, maxLength: 60, description: "What players see when they sign in: the name players know your site by. Can't say Zaisma." },
          kind: {
            enum: ["confidential", "public"],
            description: "confidential: a site or server that keeps the client secret on its server. public: a page, phone or desktop app with no server, which signs in with PKCE alone.",
          },
          redirect_urls: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string", maxLength: 500 },
            description: "The exact URLs a sign-in can go back to (your library's callback URL): https, or http://localhost for development, no #fragment and no wildcards.",
          },
        },
        ["name", "kind", "redirect_urls"],
      ),
      examples: [
        { name: "Sky Hopper Online", kind: "confidential", redirect_urls: ["https://skyhopper.io/auth/callback/zaisma", "http://localhost:3000/auth/callback/zaisma"] },
        { name: "Sky Hopper Map Editor", kind: "public", redirect_urls: ["https://editor.skyhopper.io/signed-in"] },
      ],
    },
    outputSchema: answer({ sign_in_app: SIGN_IN_APP, client_secret: nullable(text("A confidential app's client secret, shown only this once; null for a public app.")), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", "/sign-in-apps", pick(toolArguments, ["name", "kind", "redirect_urls"])),
  },
  {
    name: "update_sign_in_app",
    title: "Change a sign-in app",
    description:
      "Change a sign-in app's name or redirect URLs (redirect_urls replaces the whole list), or make a new client secret for a confidential app with replace_client_secret: true: the old secret stops working at once, so put the new one on your server straight away. Leave out what stays the same.",
    inputSchema: {
      ...object(
        {
          sign_in_app_id: idInput("sign_in_app", "A sign-in app's id from list_sign_in_apps or create_sign_in_app"),
          name: { type: "string", minLength: 1, maxLength: 60, description: "What players see when they sign in. Can't say Zaisma." },
          redirect_urls: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", maxLength: 500 }, description: "The whole new list of exact redirect URLs." },
          replace_client_secret: { type: "boolean", description: "true: make a new client secret, answered once; the old one stops working. Confidential apps only." },
        },
        ["sign_in_app_id"],
      ),
      examples: [{ sign_in_app_id: "sign_in_app_8f3k2m9q1x7c4v6b0n5z", redirect_urls: ["https://skyhopper.io/auth/callback/zaisma", "https://beta.skyhopper.io/auth/callback/zaisma"] }],
    },
    outputSchema: answer({ sign_in_app: SIGN_IN_APP, client_secret: nullable(text("The new client secret when replace_client_secret was true, shown only this once; null otherwise.")), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("PATCH", `/sign-in-apps/${pathPart(toolArguments.sign_in_app_id)}`, pick(toolArguments, ["name", "redirect_urls", "replace_client_secret"])),
  },
  {
    name: "delete_sign_in_app",
    title: "Delete a sign-in app",
    description: "Delete a sign-in app for good: players can't sign in to it with Zaisma any more, and every player's yes to it goes. Ask the developer first. Player IDs stay the same, so a new app recognizes the same players.",
    inputSchema: object({ sign_in_app_id: idInput("sign_in_app", "A sign-in app's id from list_sign_in_apps") }, ["sign_in_app_id"]),
    outputSchema: answer({ removed_sign_in_app_id: idOf("sign_in_app"), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/sign-in-apps/${pathPart(toolArguments.sign_in_app_id)}`),
  },
  {
    name: "list_webhooks",
    title: "List my webhooks",
    description: "Your webhooks: the addresses your servers take Zaisma's events at (or the game servers on Zaisma that take them), which events each takes, and how many deliveries are still being tried or failed in the last 30 days. Signing secrets are never shown again; replace one with update_webhook.",
    inputSchema: object({}),
    outputSchema: answer({ webhooks: list(WEBHOOK) }),
    annotations: read,
    run: (_, call) => call("GET", "/webhooks"),
  },
  {
    name: "create_webhook",
    title: "Make a webhook",
    description:
      `Have Zaisma POST an event to your server whenever something happens to your games, instead of checking: ${WEBHOOK_EVENT_KINDS.join(", ")}. A bug report can become a GitHub issue, a scan or publish can move your CI on, a takedown can page you. A game server error can page you, and a heads-up at 80% of a month's free use lets you act before rooms, requests or the database pause. Each event is JSON: { id, kind, happened_at, game, version, bug_report, player_report, game_server_error, alert, player_id, sign_in_app, security_event }, with game, version, bug_report, player_report, game_server_error, alert, sign_in_app and security_event as get_game, get_version, get_reports, get_stats, the game's alerts, list_sign_in_apps and get_activity answer them (null when the event isn't about one); player_id is the player of an account_deleted event. account_deleted reaches a webhook for every game (game_slugs null) for your sign-in apps too, and security_alert (your own account's security alerts) reaches only a webhook for every game at an endpoint_url. Events are signed the Standard Webhooks way (standardwebhooks.com), so its libraries for every language check them in one call: headers webhook-id, webhook-timestamp (Unix seconds) and webhook-signature ("v1," and the base64 HMAC-SHA256 of "<webhook-id>.<webhook-timestamp>.<body>", keyed by the base64 bytes after whsec_ in signing_secret). Your server answers 2xx within ${WEBHOOK_TIMEOUT_SEC} seconds to take one; anything else is tried again after 5 minutes, 30 minutes, 2, 8 and 24 hours. Redirects aren't followed. An event can come twice or out of order: skip an id you've had, and read the state from the event's objects. The signing_secret is answered once, here: keep it on your server, never in a game or page. Then call test_webhook.\n\n` +
      'No server of your own? Send destination_kind "game_server" and game_slugs with one game, and the events go to that game\'s own game server on Zaisma instead: its live version\'s onWebhook(event, server) gets the same JSON, unsigned (nothing to check), and turns it into a Discord post or a GitHub issue with fetch() and the tokens you keep with set_secret, calling only the hosts in game_server_allowed_hosts (update_game). Finishing without an error counts as delivered; throwing is tried again like a failed answer. Each event counts as one of the game\'s requests, and none run while the game is held or taken down. The same onWebhook runs on your own server later: the Node runner takes signed events at /v1/webhooks with ZAISMA_WEBHOOK_SIGNING_SECRET set to signing_secret, so switch with update_webhook (destination_kind "endpoint_url" and its address).\n\n' +
      'Not: { "endpoint_url": "http://hooks.skyhopper.io/zaisma" } (https only)\n' +
      'Not: { "event_kinds": ["all"] } (list the kinds you want)\n' +
      'Not: { "game_slugs": [] } (leave it out, or null, for every game)\n' +
      'Not: { "destination_kind": "game_server", "endpoint_url": "https://sky-hopper.zaismausercontent.com/webhook" } (a game server has no address: leave endpoint_url out)\n' +
      'Not: { "destination_kind": "game_server", "event_kinds": ["bug_reported"] } (name its game: "game_slugs": ["sky-hopper"])',
    inputSchema: {
      ...object(
        {
          destination_kind: {
            enum: WEBHOOK_DESTINATION_KINDS,
            description: "Where events go. endpoint_url (the default): your server's https address, as signed POSTs. game_server: the game in game_slugs' own game server on Zaisma, whose onWebhook(event, server) gets them; leave endpoint_url out.",
          },
          endpoint_url: { type: "string", maxLength: 500, description: "The https address your server takes events at: a name, not an IP address, and not on Zaisma's own domains. Needed for destination_kind endpoint_url; left out for game_server." },
          event_kinds: {
            type: "array",
            minItems: 1,
            items: { enum: WEBHOOK_EVENT_KINDS },
            description:
              "The events to send. bug_reported: report triage sorted a player's report as a bug. player_reported: Zaisma passed you a report about one of your game's players (bullying, cheating or other behavior that's your game's call), as get_reports lists it. scan_status_changed: a version's scan finished, or Zaisma changed its scan_status later. live_version_changed: players get another version (published, rolled back, published at its set time, or put back while a report is checked). review_status_changed: Zaisma held or took down a game, or put it back. account_deleted: a player who played the game, or signed in to your sign-in app, deleted their Zaisma account: erase what you keep about player_id (Zaisma already erased their rows from the game's database unless its deleted_account_erase_enabled is false). security_alert: one of your own account's security alerts (a sign-in on a new device from a new network, a password or email change, a passkey removed, a key made, used from a new place or turned off, an AI connected), as security_event; only for a webhook for every game at an endpoint_url.",
          },
          game_slugs: {
            type: ["array", "null"],
            minItems: 1,
            maxItems: 50,
            items: { type: "string" },
            description: "Only events about these games, from list_games; leave it out (or null) for every game you have and will make. For destination_kind game_server: the one game whose game server gets them, like [\"sky-hopper\"].",
          },
        },
        ["event_kinds"],
      ),
      examples: [
        { endpoint_url: "https://hooks.skyhopper.io/zaisma", event_kinds: ["bug_reported"] },
        { endpoint_url: "https://ci.skyhopper.io/zaisma-events", event_kinds: ["scan_status_changed", "live_version_changed", "review_status_changed"], game_slugs: ["sky-hopper"] },
        { destination_kind: "game_server", event_kinds: ["bug_reported", "review_status_changed"], game_slugs: ["sky-hopper"] },
      ],
    },
    outputSchema: answer({ webhook: WEBHOOK, signing_secret: text("The secret your server checks signatures with, shown only this once."), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", "/webhooks", pick(toolArguments, ["destination_kind", "endpoint_url", "event_kinds", "game_slugs"])),
  },
  {
    name: "update_webhook",
    title: "Change a webhook",
    description:
      "Change a webhook's destination_kind, endpoint_url, event_kinds (the whole list, from: bug_reported, player_reported, scan_status_changed, live_version_changed, review_status_changed, game_server_error_found, alert_raised, account_deleted, security_alert, as create_webhook says) or game_slugs (the whole list, or null for every game; account_deleted about your sign-in apps only reaches a webhook for every game), or make a new signing secret with replace_signing_secret: true: the old one stops at once, so put the new one on your server straight away. Leave out what stays the same. Events already on their way go to the new address, signed with the new secret. To move a game server's webhook to your own server, send destination_kind \"endpoint_url\" with the address the Node runner takes them at (https://<your server>/v1/webhooks); to move one to a game's game server on Zaisma, send destination_kind \"game_server\" and game_slugs with that one game (endpoint_url goes).\n\n" +
      'Not: { "destination_kind": "endpoint_url" } (moving to an address needs endpoint_url too)',
    inputSchema: {
      ...object(
        {
          webhook_id: idInput("webhook", "A webhook's id from list_webhooks or create_webhook"),
          destination_kind: { enum: WEBHOOK_DESTINATION_KINDS, description: "endpoint_url: your server's https address (send endpoint_url with it). game_server: the one game in game_slugs' own game server on Zaisma." },
          endpoint_url: { type: "string", maxLength: 500, description: "The new https address, for destination_kind endpoint_url." },
          event_kinds: { type: "array", minItems: 1, items: { enum: WEBHOOK_EVENT_KINDS }, description: "The whole new list of events to send." },
          game_slugs: { type: ["array", "null"], minItems: 1, maxItems: 50, items: { type: "string" }, description: "The whole new list of games, or null for every game." },
          replace_signing_secret: { type: "boolean", description: "true: make a new signing secret, answered once; the old one stops working." },
        },
        ["webhook_id"],
      ),
      examples: [
        { webhook_id: "webhook_8f3k2m9q1x7c4v6b0n5z", event_kinds: ["bug_reported", "review_status_changed"] },
        { webhook_id: "webhook_8f3k2m9q1x7c4v6b0n5z", destination_kind: "endpoint_url", endpoint_url: "https://play.skyhopper.io/v1/webhooks" },
      ],
    },
    outputSchema: answer({ webhook: WEBHOOK, signing_secret: nullable(text("The new signing secret when replace_signing_secret was true, shown only this once; null otherwise.")), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("PATCH", `/webhooks/${pathPart(toolArguments.webhook_id)}`, pick(toolArguments, ["destination_kind", "endpoint_url", "event_kinds", "game_slugs", "replace_signing_secret"])),
  },
  {
    name: "delete_webhook",
    title: "Delete a webhook",
    description: "Delete a webhook for good: nothing more is sent to it, including events still being tried, and its delivery list goes. Ask the developer first.",
    inputSchema: object({ webhook_id: idInput("webhook", "A webhook's id from list_webhooks") }, ["webhook_id"]),
    outputSchema: answer({ removed_webhook_id: idOf("webhook"), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/webhooks/${pathPart(toolArguments.webhook_id)}`),
  },
  {
    name: "test_webhook",
    title: "Send a test event",
    description: 'Send a webhook a test event now (kind "test", with game, version and bug_report null), signed like every other, and answer how it went: delivery_status delivered when your server answered 2xx (or, for a game server, its onWebhook finished without an error), else failed with failure_message saying what it answered or why it could not be reached. A test is tried once, never again.',
    inputSchema: object({ webhook_id: idInput("webhook", "A webhook's id from list_webhooks or create_webhook") }, ["webhook_id"]),
    outputSchema: answer({ delivery: WEBHOOK_DELIVERY, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/webhooks/${pathPart(toolArguments.webhook_id)}/test`),
  },
  {
    name: "list_webhook_deliveries",
    title: "List what a webhook was sent",
    description: "What was sent to a webhook in the last 30 days, newest first, 20 at a time (next_cursor continues): each event as it was sent, and whether it was delivered, is still being tried (and when next) or failed, with your server's last answer and why. The place to look when your server didn't get something.",
    inputSchema: object({ webhook_id: idInput("webhook", "A webhook's id from list_webhooks"), cursor: { type: "string", description: "next_cursor from the last answer, for the 20 before it." } }, ["webhook_id"]),
    outputSchema: answer({ deliveries: list(WEBHOOK_DELIVERY), next_cursor: nullable(text("Pass as cursor for older deliveries; null on the last page.")) }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/webhooks/${pathPart(toolArguments.webhook_id)}/deliveries${toolArguments.cursor ? `?cursor=${encodeURIComponent(String(toolArguments.cursor))}` : ""}`),
  },
  {
    name: "search_forum",
    title: "Search the developer forum",
    description:
      "Search Zaisma's developer forum: the fastest place to find answers about Zaisma itself, before any web search. Topics are bugs, missing pieces, ideas, questions and discussions from developers and their AI, answered by other developers and Zaisma, plus Zaisma's known issues with their phase and workaround. search_text is ranked full-text search over titles, posts and workarounds: use the error code, tool name or a few key words; quote \"exact phrases\", end a word with * to match its start. Results are brief: open one with get_topic, post_selection \"answer\" for a solved question's answer, \"none\" for a known issue's phase and workaround. tab yours shows the developer's topics and the ones they follow, with what's unread; messages shows their private messages to Zaisma; bookmarks shows the topics with a post they saved (bookmarked_post_ids says which). 10 topics unless maximum_topic_count says more (up to 30); next_cursor continues.\n\nNot: { \"q\": \"too_big\" } (the words go in search_text)\nNot: { \"category\": \"multiplayer\" } (multiplayer is a section; category takes one category, like rooms)\nNot: { \"tab\": \"known_issues\" } (tab known)\nNot: { \"search_text\": \"I tried to upload my game and it failed with an error saying it was too big\" } (a few key words or the error code: \"upload_files too_big\")\nNot: { \"maximum_topic_count\": 100 } (up to 30; next_cursor continues)",
    inputSchema: {
      ...object({
        search_text: { type: "string", maxLength: 200, description: "Search words, like the error code or what failed." },
        tab: { enum: FORUM_TABS, description: "latest (the default), top (most votes), unanswered (questions), known (known issues), yours, messages or bookmarks (posts the developer saved)." },
        is_answered: { type: "boolean", description: "true: only questions with a marked answer; false: only questions without one." },
        topic_status: { enum: TOPIC_STATUSES, description: "A status, or a known issue's phase: investigating, known (confirmed), planned, fixing, released (a fix is out, being watched), fixed (resolved), wont (won't fix)." },
        section: { enum: FORUM_SECTIONS.map((section) => section.id), description: "A section of the forum: every category in it." },
        category: { enum: FORUM_CATEGORIES, description: "One category." },
        kind: { enum: TOPIC_KINDS },
        tag: { enum: Object.keys(FORUM_TAGS) },
        maximum_topic_count: { type: "integer", minimum: 1, maximum: 30 },
        cursor: { type: "string", description: "next_cursor from your last call, for the topics after it" },
      }),
      examples: [{ search_text: "upload_files too_big" }, { tab: "known", category: "rooms" }, { search_text: "save not restored", is_answered: true }, { tab: "yours" }],
    },
    outputSchema: TOPIC_PAGE,
    annotations: read,
    run: (toolArguments, call) => {
      const query = new URLSearchParams({
        detail: "brief",
        maximum_topic_count: "10",
        ...(pick(toolArguments, ["search_text", "tab", "is_answered", "topic_status", "section", "category", "kind", "tag", "maximum_topic_count", "cursor"]) as Record<string, string>),
      }).toString();
      return call("GET", `/forum?${query}`);
    },
  },
  {
    name: "get_topic",
    title: "A forum topic",
    description:
      "One forum topic: where it stands (a known issue's phase, workaround, roadmap item and the developers it affects) and its posts, each with who wrote it (the developer, a developer's AI, or Zaisma), the post it replies to and whether it's the answer. To save tokens, post_selection \"answer\" gives just the question and its marked answer, \"latest\" the opening post and the last five, \"none\" the topic alone; post_count says how many there are. Your own posts still being checked show their check_status; what you attached (debug_context) shows only to you.",
    inputSchema: object({ topic_id: topicId, post_selection: { enum: POST_SELECTIONS, description: "all (the default), answer, latest or none." } }, ["topic_id"]),
    outputSchema: TOPIC_WITH_POSTS,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/forum/${pathPart(toolArguments.topic_id)}${toolArguments.post_selection ? `?post_selection=${pathPart(toolArguments.post_selection)}` : ""}`),
  },
  {
    name: "post_topic",
    title: "Post to the developer forum",
    description:
      "Start a public topic about Zaisma itself (not the developer's game): a bug, a gap (a limit or missing piece that blocks the developer), a feature idea, a question or a discussion. Every topic is public: checked before others see it and signed with the developer's name and an AI mark, so never put private details, keys, unreleased games or players' information in one; use message_zaisma for anything private. Search first; if it's there, reply or vote instead. Answers with similar_topics. About 100 posts a day per account.\n\nNot: { \"text\": \"…\" } (the post goes in text_markdown)\nNot: { \"category\": \"Rooms\" } (category is an id, like rooms)\nNot: { \"debug_context\": \"upload_files said too_big\" } (debug_context is an object: { \"call\": \"upload_files\", \"error_code\": \"too_big\" })\nNot: { \"kind\": \"bug report\" } (kind is bug, gap, feature, question or talk)\nNot: { \"tags\": \"godot\" } (tags is a list: [\"godot\"])",
    inputSchema: {
      ...object(
        {
          kind: { enum: TOPIC_KINDS, description: "bug, gap (a limit or missing piece), feature (an idea), question or talk (a discussion)." },
          title: { type: "string", minLength: 1, maxLength: FORUM_LIMITS.titleCharacterCount, description: "One line, specific: \"upload_files fails with too_big for a 3 MB game\"." },
          text_markdown: textMarkdown,
          category: { enum: FORUM_CATEGORIES, description: `Where it belongs: ${FORUM_SECTIONS.map((section) => `${section.name} (${Object.keys(section.categories).join(", ")})`).join("; ")}. other for anything else.` },
          tags: { type: "array", items: { enum: Object.keys(FORUM_TAGS) }, maxItems: FORUM_LIMITS.tagCountPerTopic },
          debug_context: debugContext,
          images_base64: images("On a public topic everyone sees them once they're checked."),
        },
        ["kind", "title", "text_markdown", "category"],
      ),
      examples: [
        {
          kind: "bug",
          title: "upload_files fails with too_big for a 3 MB game",
          text_markdown: "I sent a 3 MB game with `upload_files` and got `too_big`, though the limit says 5 MB.\n\nExpected: the version uploads.",
          category: "mcp",
          debug_context: { call: "upload_files", error_code: "too_big", error_message: "Uploads through the MCP can be up to 5 MB." },
        },
        { kind: "question", title: "Can a game server keep state between matches?", text_markdown: "Is there a way for my game server to remember a high score between matches?", category: "servers", tags: ["godot"] },
      ],
    },
    outputSchema: NEW_TOPIC,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", "/forum", pick(toolArguments, ["kind", "title", "text_markdown", "category", "tags", "debug_context", "images_base64"])),
  },
  {
    name: "message_zaisma",
    title: "Message Zaisma privately",
    description:
      "A private message to the people who build Zaisma, inside the forum: only the developer and Zaisma see it. For a bug or gap with logs, an unreleased game, screenshots or anything the developer wouldn't post in public, or to add their own case to a known issue (known_issue_topic_id), so it counts. When others hit the same problem, Zaisma posts a public known issue without the developer's words. Replies come back on it (get_topic, search_forum tab messages).",
    inputSchema: object(
      {
        kind: { enum: TOPIC_KINDS.filter((kind) => kind !== "talk") },
        title: { type: "string", minLength: 1, maxLength: FORUM_LIMITS.titleCharacterCount },
        text_markdown: { type: "string", minLength: 1, maxLength: FORUM_LIMITS.textCharacterCount, description: "What you were doing, what you expected, what happened and how to make it happen again." },
        category: { enum: FORUM_CATEGORIES, description: "Where it belongs, if you know." },
        known_issue_topic_id: idInput("topic", "A known issue's id from search_forum (tab known): the developer's own case about it."),
        game_slug: { ...slug, description: "The game it happened with, if any: one of the developer's, from list_games." },
        debug_context: debugContext,
        images_base64: images("Only the developer and Zaisma see them."),
      },
      ["kind", "title", "text_markdown"],
    ),
    outputSchema: NEW_TOPIC,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", "/forum", { is_public: false, ...pick(toolArguments, ["kind", "title", "text_markdown", "category", "known_issue_topic_id", "game_slug", "debug_context", "images_base64"]) }),
  },
  {
    name: "reply_to_topic",
    title: "Reply in the forum",
    description:
      "Reply to a forum topic, or to one post in it (reply_to_post_id). On the developer's own topic or message, add what you found digging further, or reopen it (reopen: true) when something fixed, answered or closed is back. Public replies are checked before others see them and are signed with the developer's name and an AI mark.",
    inputSchema: object(
      {
        topic_id: topicId,
        text_markdown: textMarkdown,
        reply_to_post_id: idInput("post", "A post's id in the topic, from get_topic, to answer that post."),
        reopen: { type: "boolean", description: "Reopen the developer's own fixed, answered or closed topic." },
        debug_context: debugContext,
        images_base64: images("On a public topic everyone sees them once they're checked."),
      },
      ["topic_id", "text_markdown"],
    ),
    outputSchema: NEW_REPLY,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/forum/${pathPart(toolArguments.topic_id)}/posts`, pick(toolArguments, ["text_markdown", "reply_to_post_id", "reopen", "debug_context", "images_base64"])),
  },
  {
    name: "vote",
    title: "Vote: affects me too, I want this, same question",
    description:
      "On someone else's public bug, gap or known issue (it affects the developer too), idea (they want it) or question (they have it too); discussions take replies, not votes. It counts (on a known issue, toward the developers affected) and the developer follows the topic. undo: true takes the vote back.",
    inputSchema: object({ topic_id: topicId, undo: { type: "boolean", description: "Take the vote back." } }, ["topic_id"]),
    outputSchema: answer({ vote_count: countOf(), has_voted: yes(), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call(toolArguments.undo === true ? "DELETE" : "POST", `/forum/${pathPart(toolArguments.topic_id)}/vote`),
  },
  {
    name: "forum_people",
    title: "Names to mention",
    description: "Names to @mention in a forum post, by the start of the name: Zaisma, then the people in a topic (topic_id), then anyone who has posted in the forum. Write @Name, or @[Two Words] for a name with spaces; they hear about the post.",
    inputSchema: object({ name_prefix: { type: "string", maxLength: 40, description: "The start of the name." }, topic_id: { ...topicId, description: "A topic's id, to put the people in it first." } }),
    outputSchema: answer({ people: list(answer({ name: text(), is_zaisma: yes("The people who build Zaisma."), is_in_topic: yes() })) }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/forum/people?${new URLSearchParams(pick(toolArguments, ["name_prefix", "topic_id"]) as Record<string, string>).toString()}`),
  },
  {
    name: "rate_post",
    title: "Like or dislike a forum post",
    description:
      "Say what the developer (or you, on their behalf) thinks of someone else's post in a public topic: rating like or dislike. It is anonymous: nobody sees who, and both counts show, never a score. A dislike only counts, it never hides a post (a harmful post gets report_post). One rating per post: a new one replaces the old; undo: true takes it back. Not for their own posts. Ask the developer before rating on their behalf.\n\nNot: { \"rating\": \"helpful\" } (like)",
    inputSchema: object({ topic_id: topicId, post_id: postId, rating: { enum: POST_RATINGS, description: "like or dislike; leave it out with undo: true." }, undo: { type: "boolean", description: "Take the rating back." } }, ["topic_id", "post_id"]),
    outputSchema: POST_RATING,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => {
      const path = `/forum/${pathPart(toolArguments.topic_id)}/posts/${pathPart(toolArguments.post_id)}/rating`;
      return toolArguments.undo === true ? call("DELETE", path) : call("PUT", path, pick(toolArguments, ["rating"]));
    },
  },
  {
    name: "bookmark_post",
    title: "Bookmark a forum post",
    description: "Save any post the developer can see, their own and messages to Zaisma included, to read again: it is private to them and their AI and sends nothing. search_forum with tab bookmarks lists the topics holding them. undo: true removes the bookmark.",
    inputSchema: object({ topic_id: topicId, post_id: postId, undo: { type: "boolean", description: "Remove the bookmark." } }, ["topic_id", "post_id"]),
    outputSchema: POST_BOOKMARK,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call(toolArguments.undo === true ? "DELETE" : "POST", `/forum/${pathPart(toolArguments.topic_id)}/posts/${pathPart(toolArguments.post_id)}/bookmark`),
  },
  {
    name: "mark_helpful",
    title: "Retired: use rate_post",
    description: "Retired: rate_post replaces it. Calling it answers retired_tool.",
    inputSchema: object({ topic_id: topicId, post_id: postId, undo: { type: "boolean" } }, ["topic_id", "post_id"]),
    outputSchema: answer({ next_steps: NEXT }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    replacedBy: "rate_post",
    run: async () => {
      throw new ApiError("retired_tool", { message: "mark_helpful is retired: likes replace helpful marks.", field: "tool", fix: 'Call rate_post with rating "like" (undo: true takes it back); it also takes "dislike".' });
    },
  },
  {
    name: "report_post",
    title: "Report a forum post",
    description: `A public post that shouldn't be there: a person at Zaisma looks. reason: ${Object.entries(FORUM_REPORT_REASONS).map(([reason, label]) => `${reason} (${label.toLowerCase()})`).join(", ")}. child_safety hides it at once. Ask the developer first; a reply that's just wrong needs a better reply, not a report.`,
    inputSchema: object({ topic_id: topicId, post_id: postId, reason: { enum: Object.keys(FORUM_REPORT_REASONS) }, details: { type: "string", maxLength: 1000 } }, ["topic_id", "post_id", "reason"]),
    outputSchema: answer({ has_reported: yes(), is_hidden: yes("Hidden until a person at Zaisma looks."), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/forum/${pathPart(toolArguments.topic_id)}/posts/${pathPart(toolArguments.post_id)}/report`, pick(toolArguments, ["reason", "details"])),
  },
  {
    name: "still_happening",
    title: "A fixed known issue still happens",
    description: "When a known issue's fix is out (topic_status released) but it still happens to the developer: it goes back to fixing, Zaisma is alerted and everyone in it hears. text_markdown adds what you saw as a public reply (no private details). Ask the developer first.",
    inputSchema: object({ topic_id: topicId, text_markdown: { type: "string", maxLength: FORUM_LIMITS.textCharacterCount } }, ["topic_id"]),
    outputSchema: answer({ topic_status: choice({ fixing: "back to being worked on" }), post: nullable(POST), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/forum/${pathPart(toolArguments.topic_id)}/still-happening`, pick(toolArguments, ["text_markdown"])),
  },
  {
    name: "flag_misplaced",
    title: "Flag a topic as in the wrong category",
    description: "When a public topic sits in a category it doesn't belong in, flag it: Zaisma's AI then moves it to the right one and says so in the topic.",
    inputSchema: object({ topic_id: topicId }, ["topic_id"]),
    outputSchema: answer({ has_flagged_misplaced: yes(), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/forum/${pathPart(toolArguments.topic_id)}/misplaced`, {}),
  },
  {
    name: "follow_topic",
    title: "Follow a forum topic",
    description: "Follow a topic, so what's new in it shows as unread in search_forum's yours tab (the developer's own topics, ones they replied to and voted on are followed already). undo: true stops following.",
    inputSchema: object({ topic_id: topicId, undo: { type: "boolean", description: "Stop following it." } }, ["topic_id"]),
    outputSchema: answer({ is_following: yes(), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call(toolArguments.undo === true ? "DELETE" : "POST", `/forum/${pathPart(toolArguments.topic_id)}/follow`),
  },
  {
    name: "mark_answer",
    title: "Mark a question's answer",
    description: "On the developer's own question: mark the reply that answered it (answer_post_id: null clears it). Ask the developer first.",
    inputSchema: object({ topic_id: topicId, answer_post_id: { ...idInput("post", "A reply's id from get_topic, or null to clear the answer."), type: ["string", "null"] } }, ["topic_id", "answer_post_id"]),
    outputSchema: answer({ answer_post_id: nullable(idOf("post")), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/forum/${pathPart(toolArguments.topic_id)}/answer`, { answer_post_id: toolArguments.answer_post_id ?? null }),
  },
  {
    name: "get_access",
    title: "What this key can do",
    description:
      "What the API key you're signed in with may do: its access_level (read, upload, publish, full or custom), what that gives in each area, the games it works on (game_slugs, null for all) and when it ends (api_key_ends_at, null for never). A call the key doesn't reach answers key_not_allowed. Keys are made only by the developer on zaisma.com/account, never through the MCP. can_publish says whether the account can make, upload and publish games, which until the beta only accounts Zaisma adds can.",
    inputSchema: object({}),
    outputSchema: answer({
      access: ACCESS,
      can_publish: yes("Whether this account can make, upload and publish games. Until the beta only accounts Zaisma adds can; false means create_game, upload_files and publish_version answer publishing_not_open."),
    }),
    annotations: read,
    run: (_, call) => call("GET", "/access"),
  },
  {
    name: "list_api_keys",
    title: "Your API keys",
    description:
      "Your keys and connected apps (AI apps connected by signing in, like claude.ai), each with its kind: what it can do, when it ends, when it was last used and from where, and whether Zaisma turned it off because it was found in public (with where). Needs a full key for all your games. Keys are made and removed only on zaisma.com/account.",
    inputSchema: object({}),
    outputSchema: API_KEYS,
    annotations: read,
    run: (_, call) => call("GET", "/api-keys"),
  },
  {
    name: "get_activity",
    title: "Your account's activity",
    description:
      "Your account's security activity from the last 90 days, newest first: sign-ins on new devices, password, email and passkey changes, API keys made, removed or used from a new place, and AIs connected, each with who did it (you, a key by its name, your AI or Zaisma) and from where (device, network, rough place, and the connection address for keys made and used). Needs a full key for all your games. Changes to games are in get_history. Keep where my account is used from (where_used_from_enabled) changes only on zaisma.com/account. The risky ones are security alerts (security_alert_status): emailed to the developer, or with no email on the account, shown on zaisma.com/account and the dashboard until they press That was me there; unseen_security_alerts lists those still waiting, so tell the developer about them. A security_alert webhook sends each one as it happens.",
    inputSchema: object({ cursor: { type: "string", description: "next_cursor from an earlier call: older events" } }),
    outputSchema: ACTIVITY,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/activity${toolArguments.cursor ? `?cursor=${encodeURIComponent(String(toolArguments.cursor))}` : ""}`),
  },
  {
    name: "get_player",
    title: "Look up a player",
    description:
      "An account's public profile by player ID: exactly what a stranger sees on zaisma.com/@username (name and username, the name and bio they chose, links, the games they made and, when they show it to anyone, what they played lately with a rough time), never its email, age or other games' data. Show name in your game: it's the username, so nobody passes as someone else. A signed-in player has the same player ID in every game, in room.players and as the sub of their player pass; games and servers get the same at https://rooms.zaisma.com/v1/players/<id> with no key. Guests have no profile (no_player).",
    inputSchema: object({ player_id: idInput("player", "A player ID from the game: a room's players, or the sub of a player pass") }, ["player_id"]),
    outputSchema: answer({ player: PLAYER_PROFILE }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/players/${pathPart(toolArguments.player_id)}`),
  },
  {
    name: "get_reports",
    title: "Player reports",
    description:
      "What players reported about the game in the last 90 days, counted by reason, with the bug reports (what the player wrote, a one-line summary and the version they played) and the player reports Zaisma passed to you: bullying, cheating and other behavior that's your game's call, each with its reason, what the player wrote, the reported player's ID and name and the room. Zaisma itself looks at real-life threats, sharing personal details, following after a block and sexual behavior. Never who sent a report. To check for new ones later, pass the next_cursor from your last call as cursor; a player_reported webhook can tell your server (or your game server) instead.",
    inputSchema: object({ slug, cursor: { type: "string", description: "next_cursor from an earlier call: only bug and player reports that arrived after it" } }, ["slug"]),
    outputSchema: REPORTS,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/reports${toolArguments.cursor ? `?cursor=${pathPart(toolArguments.cursor)}` : ""}`),
  },
  {
    name: "get_stats",
    title: "Play stats",
    description:
      "Play stats over the last period_duration_days (30 unless you say): counted plays, players, new players and play time per day, and how many new players came back 1, 7 and 30 days later. Counted plays are the official numbers: the game on screen for a minute in a browser Cloudflare checked; started_play_count is every play started. Tester and preview links and the developer's own plays don't count; a player is a browser. Also multiplayer use per day, room play time this month against the free hours (counted hours include relayed data and game server CPU past 25 CPU-seconds a player-hour; until hosting billing is ready, no new rooms open past them until the month resets; matches already running carry on), room_traffic: how much each player sends and gets a second, the biggest message types, and traffic_hints with what to change, requests to the game's own game server this month against the free 1 million (past them, requests answer request_limit until the month resets), the live version's schedules with their next and last runs, and for games with their own game server, its calls, requests, scheduled runs and recent errors.",
    inputSchema: object({ slug, period_duration_days: { type: "integer", minimum: 1, maximum: 90, description: "How many days back, today included; 30 by default" } }, ["slug"]),
    outputSchema: STATS,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/stats${toolArguments.period_duration_days ? `?period_duration_days=${pathPart(toolArguments.period_duration_days)}` : ""}`),
  },
  {
    name: "get_history",
    title: "Game history",
    description: "What happened to the game, newest first: uploads, scans, publishes, rollbacks, reviews, holds and takedowns (each with its review_reason), database writes, imports, exports and restores, save reads and changes, secrets, tester links, and your webhooks and sign-in apps; who did each (you, a key by its name, your AI or Zaisma) and from where, with is_new_place when a key was used from a network and country it hadn't been used from.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: HISTORY,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/history`),
  },
  {
    name: "get_qr_code",
    title: "QR code for the game's link",
    description: "The game's link, or one of its rooms' (room_code), as a QR code for posters, booths, trailers and slides: an SVG document, black on white, that scans to the game page. Players get the same code from Share on the game page.",
    inputSchema: object(
      {
        slug,
        room_code: { type: "string", pattern: "^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$", description: "A room's code, like K7Q2MX, for a code that drops players into that match; leave it out for the game's own link." },
      },
      ["slug"],
    ),
    outputSchema: QR_CODE,
    annotations: read,
    run: (toolArguments, call) => {
      const query = new URLSearchParams(pick(toolArguments, ["room_code"]) as Record<string, string>).toString();
      return call("GET", `/games/${pathPart(toolArguments.slug)}/qr-code${query ? `?${query}` : ""}`);
    },
  },
  {
    name: "get_logs",
    title: "Game server logs",
    description:
      "What the game's own game server printed on Zaisma in the last 30 days: every console.log, info, warn, error and debug, in rooms and in onRequest, onSchedule and onWebhook, with each crash in full (level error), its room and version. Oldest first; the newest lines unless cursor says otherwise. Lines reach the logs within 30 seconds, and within 2 seconds for the next 10 minutes once someone has read them, so while testing, call it once, then follow with new_lines_cursor every few seconds. A game on the developer's own server prints to its own terminal instead. Players' browser errors aren't here: they're in the browser's console.\n\nNot: { \"since\": \"2026-10-18T14:00:00Z\" } (follow with new_lines_cursor from your last answer)\nNot: { \"level\": \"error\" } (minimum_level \"error\")\nNot: { \"cursor\": \"…\", \"new_lines_cursor\": \"…\" } (one or the other: cursor goes back, new_lines_cursor forward)",
    inputSchema: {
      ...object(
        {
          slug,
          room_code: { type: "string", pattern: "^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$", description: "Only lines printed in this room, like K7Q2MX." },
          minimum_level: { enum: MINIMUM_LOG_LEVELS, description: "debug (everything, the default), info (all but debug), warn (warnings and errors) or error." },
          source_kind: { enum: LOG_SOURCE_KINDS, description: "Only lines printed in a room, onRequest (request), onSchedule (schedule) or onWebhook (webhook)." },
          search_text: { type: "string", minLength: 1, maxLength: 200, description: "Only lines containing this, ignoring case, like an error's words." },
          maximum_line_count: { type: "integer", minimum: 1, maximum: LOG_LIMITS.maximumLineCount, description: `How many lines at most; ${LOG_LIMITS.defaultLineCount} by default.` },
          cursor: { type: "string", description: "next_cursor from an earlier call: the lines before that answer's." },
          new_lines_cursor: { type: "string", description: "new_lines_cursor from your last call: only lines written since it." },
        },
        ["slug"],
      ),
      examples: [{ slug: "boss-fight" }, { slug: "boss-fight", room_code: "K7Q2MX", minimum_level: "warn" }, { slug: "boss-fight", new_lines_cursor: "logs_new_…" }, { slug: "boss-fight", search_text: "hp of undefined" }],
    },
    outputSchema: LOGS,
    annotations: read,
    run: (toolArguments, call) => {
      const query = new URLSearchParams(pick(toolArguments, ["room_code", "minimum_level", "source_kind", "search_text", "maximum_line_count", "cursor", "new_lines_cursor"]) as Record<string, string>).toString();
      return call("GET", `/games/${pathPart(toolArguments.slug)}/logs${query ? `?${query}` : ""}`);
    },
  },
  {
    name: "list_secrets",
    title: "List a game's secrets",
    description: "A game's secrets: the name of each and when it was set, never the values, which nobody can read back once set (only the game's server can, as server.secrets.<name> and room.secrets.<name>).",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: answer({ secrets: list(SECRET, "By name.") }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/secrets`),
  },
  {
    name: "set_secret",
    title: "Set a game's secret",
    description:
      "Keep a token or key for the game's server, like a Discord webhook URL, a GitHub token or a payment provider's secret key: it reads it as server.secrets.<secret_name> (in onRequest and onSchedule) and room.secrets.<secret_name> (in rooms), and calls other servers with plain fetch() on the hosts in game_server_allowed_hosts (update_game). Replaces a secret of the same name; running rooms get it within a minute, requests and schedules from their next call. It's never shown again, to anyone. The game's server code can read it, so anyone who can publish the game's code can use it. On the developer's own server, server.secrets is the environment variables, so set the same names there. Never put a secret in the game's files or a page: players can read those.\n\n" +
      'Not: { "secret_name": "discord-token" } (capitals, digits and underscores: DISCORD_TOKEN)\n' +
      'Not: { "secret_name": "DISCORD", "secret_value": { "token": "…" } } (secret_value is text; JSON goes in as text and the game server parses it)',
    inputSchema: {
      ...object(
        {
          slug,
          secret_name: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$", description: "Its name, like an environment variable's: capitals, digits and underscores, starting with a capital." },
          secret_value: { type: "string", minLength: 1, maxLength: 8192, description: "The secret itself, as text, up to 8 KB." },
        },
        ["slug", "secret_name", "secret_value"],
      ),
      examples: [{ slug: "sky-hopper", secret_name: "DISCORD_WEBHOOK_URL", secret_value: "https://discord.com/api/webhooks/123456789/abcdefg" }],
    },
    outputSchema: answer({ secret: SECRET, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("PUT", `/games/${pathPart(toolArguments.slug)}/secrets/${pathPart(toolArguments.secret_name)}`, { secret_value: toolArguments.secret_value }),
  },
  {
    name: "delete_secret",
    title: "Delete a game's secret",
    description: "Delete one of a game's secrets for good: its server no longer gets it (running rooms within a minute). Ask the developer first; a game server still using it will find it missing.",
    inputSchema: object({ slug, secret_name: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,63}$", description: "A secret's name from list_secrets." } }, ["slug", "secret_name"]),
    outputSchema: answer({ deleted_secret_name: text("The secret deleted."), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", `/games/${pathPart(toolArguments.slug)}/secrets/${pathPart(toolArguments.secret_name)}`),
  },
  {
    name: "get_database",
    title: "Game database overview",
    description:
      "The game's own SQLite database, the one its game servers use as room.database: its tables and indexes (their CREATE statements), and this month's rows read and written and its size against the free use every game has. Every game has one, empty until something writes to it. Read and change what's in it with query_database and batch_database. Also its restores and undos of the last 30 days (restore_database), each with the id undo_database_restore takes. No row counts here, because counting reads every row: query SELECT count(*) when you need one.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: DATABASE,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/database`),
  },
  {
    name: "query_database",
    title: "Run SQL on a game's database",
    description:
      "Run one SQL statement (SQLite) on the game's own database, the same one its game servers use as room.database, live: changes reach the game at once, so ask the developer before you change or delete data a live game uses. Answers the rows (a SELECT's, or a change's with RETURNING) and the rows it read and wrote, which count towards the month's free use like the game's own. Put values in values for the ?s, never into the SQL. Up to 10,000 rows and 8 MB an answer: page with LIMIT. A blob goes in and out as { \"blob_base64\": \"…\" }. To list tables use get_database; for several changes that must all happen or none, batch_database.\n\n" +
      'Not: { "sql": "SELECT * FROM scores WHERE player_id = \'player_8f3k2m\'" } (put the player ID in values: "… WHERE player_id = ?", values ["player_8f3k2m"])\n' +
      'Not: { "sql": "BEGIN; UPDATE …; COMMIT" } (one statement per query; batch_database is the transaction)\n' +
      'Not: { "values": [true] } (SQLite has no true or false: give 1 or 0)\n' +
      'Not: { "values": [{ "level": 3 }] } (give an object as JSON text, and read it with json_extract)',
    inputSchema: {
      ...object(
        {
          slug,
          sql: { type: "string", minLength: 1, maxLength: 100000, description: "One SQLite statement, with ? where each value goes. A trailing ; is fine; BEGIN, COMMIT, ATTACH and the like aren't allowed." },
          values: {
            type: "array",
            maxItems: 100,
            items: { anyOf: [{ type: ["string", "number", "null"] }, object({ blob_base64: { type: "string", description: "Bytes, base64-encoded" } }, ["blob_base64"])] },
            description: "The values for the ?s, in order: text, numbers, null, or { blob_base64 } for bytes. Leave out when there are none.",
          },
        },
        ["slug", "sql"],
      ),
      examples: [
        { slug: "sky-hopper", sql: "SELECT player_id, best_score FROM scores ORDER BY best_score DESC LIMIT 10" },
        { slug: "sky-hopper", sql: "UPDATE scores SET best_score = ? WHERE player_id = ? RETURNING *", values: [0, "player_8f3k2m9q1x7c4v6b0n5z"] },
        { slug: "sky-hopper", sql: "CREATE INDEX IF NOT EXISTS scores_by_best_score ON scores (best_score)" },
      ],
    },
    outputSchema: answer({ ...(STATEMENT_RESULT.properties as Record<string, Record<string, unknown>>), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/database/query`, pick(toolArguments, ["sql", "values"])),
  },
  {
    name: "batch_database",
    title: "Run SQL statements in one transaction",
    description:
      "Run up to 100 SQL statements on the game's own database in one transaction: all of them happen, or, if one fails, none do. Like a game server's room.database.batch. For moving an item between two players, fixing data across tables, or adding a column and filling it. Answers each statement's rows and rows read and written, in order. Everything else is as in query_database: values for the ?s, ask the developer before changing a live game's data.\n\n" +
      'Not: { "statements": ["UPDATE …", "INSERT …"] } (each statement is { "sql": "…", "values": [...] })\n' +
      'Not: { "statements": [{ "sql": "BEGIN" }, …] } (the batch is the transaction already)',
    inputSchema: {
      ...object(
        {
          slug,
          statements: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: object(
              {
                sql: { type: "string", minLength: 1, maxLength: 100000, description: "One SQLite statement, with ? where each value goes" },
                values: { type: "array", maxItems: 100, items: { anyOf: [{ type: ["string", "number", "null"] }, object({ blob_base64: { type: "string" } }, ["blob_base64"])] }, description: "The values for its ?s, in order" },
              },
              ["sql"],
            ),
            description: "The statements, run in order.",
          },
        },
        ["slug", "statements"],
      ),
      examples: [
        {
          slug: "sky-hopper",
          statements: [
            { sql: "UPDATE inventories SET item_count = item_count - 1 WHERE player_id = ? AND item = ? AND item_count > 0", values: ["player_8f3k2m9q1x7c4v6b0n5z", "golden_wing"] },
            { sql: "INSERT INTO inventories (player_id, item, item_count) VALUES (?, ?, 1) ON CONFLICT (player_id, item) DO UPDATE SET item_count = item_count + 1", values: ["player_2b7x0q4n1m8k5c3v9z6d", "golden_wing"] },
          ],
        },
        {
          slug: "sky-hopper",
          statements: [{ sql: "ALTER TABLE scores ADD COLUMN level_count INTEGER NOT NULL DEFAULT 0" }, { sql: "UPDATE scores SET level_count = 1 WHERE best_score > 0" }],
        },
      ],
    },
    outputSchema: answer({ statement_results: list(STATEMENT_RESULT, "One per statement, in order."), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/database/batch`, pick(toolArguments, ["statements"])),
  },
  {
    name: "erase_player",
    title: "Erase a player from a game's database",
    description:
      "Erase one player from the game's own database: every row of every table with a column named player_id that holds this player's ID, in one transaction (other columns, like winner_player_id, are left alone, and a table without player_id isn't touched). Answers each table it looked in with the rows erased (0 included). The game's rooms see it at once. It counts towards the month's use but works past the free limits. A foreign key without ON DELETE CASCADE that refuses the delete undoes the whole erase. Zaisma already does this when a player deletes their account, unless the game's deleted_account_erase_enabled is false; use it for a player who asks you directly, or for an account_deleted event when you turned that off. It works on any player ID. Ask the developer first unless they asked for it or it's for an account_deleted event.\n\n" +
      'Not: { "player_id": "mia_plays" } (a username: use the player ID)',
    inputSchema: {
      ...object({ slug, player_id: idInput("player", "The player whose rows to erase: from an account_deleted event, a player pass's sub, or room.players.") }, ["slug", "player_id"]),
      examples: [{ slug: "tower-climb", player_id: "player_8f3k2m9q1x7c4v6b0n5z" }],
    },
    outputSchema: answer({ ...(ERASED_PLAYER.properties as Record<string, Record<string, unknown>>), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/database/erase-player`, pick(toolArguments, ["player_id"])),
  },
  {
    name: "export_game",
    title: "Export everything about a game",
    description:
      "Everything about the game as one .zip, for the developer to keep, move or run on their own server: every kept version that passed review with its patch notes (versions/<version_id>/), the approved cover and screenshots, the details, tester links and the names of its secrets (never their values), the game database as SQL (database.sql), every player's cloud save (saves.jsonl), stats, player reports and history. The .zip is made as it downloads, so there's nothing to wait for. Hand the developer download_url: it opens in their browser when they're signed in to Zaisma, and for no one else. In a terminal, the upload command saves the same export as a folder, with the database as a ready .sqlite file: npx @zaisma/cli export <slug>. The key needs read access to the game, versions, stats, database and saves (a read key has it all). Each export is a line in the game's history.\n\n" +
      "Not: export_database, list_saves and get_save one by one to back up a whole game (export_game takes it all at once)",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: GAME_EXPORT,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/export`),
  },
  {
    name: "export_database",
    title: "Export a game's database",
    description:
      "The game's whole database as SQLite's own SQL dump (its CREATE TABLEs and INSERTs, as sqlite3's .dump writes them), up to 4 MB a part: call again with next_cursor as cursor until next_cursor is null, and put the parts together in order. The dump loads into any SQLite (sqlite3 game.sqlite < dump.sql, or the Node runner's zaisma-database.sqlite) and back into Zaisma with import_database. Its reads count towards the month's use, but export works past the free reads. It reads table by table, so writes the game makes meanwhile can land between parts: it isn't a snapshot. For a big database, the upload command saves it in one go, even as a ready .sqlite file: npx @zaisma/cli database export <slug> game.sqlite.",
    inputSchema: object({ slug, cursor: { type: "string", description: "next_cursor from the last part, for the next; leave out to start" } }, ["slug"]),
    outputSchema: DATABASE_EXPORT,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/database/export${toolArguments.cursor ? `?cursor=${encodeURIComponent(String(toolArguments.cursor))}` : ""}`),
  },
  {
    name: "import_database",
    title: "Import a SQL dump into a game's database",
    description:
      "Load a part of SQLite's SQL dump (what export_database answers, or what sqlite3 game.sqlite .dump writes) into the game's own database, live, in one transaction: the part goes in whole or not at all, while parts already sent stay in. Up to 5 MB a part, each ending on a whole statement (every export part fits). Import only adds: it runs the dump's CREATE and INSERT statements and leaves out the transaction and PRAGMAs around them; a table that already exists stops it, so to replace data, ask the developer, then drop it first with query_database. Writes count like any write and stop at the month's free writes. For a big dump or a .sqlite file, the upload command splits it: npx @zaisma/cli database import <slug> game.sqlite.\n\n" +
      'Not: { "dump_sql": "UPDATE scores SET best_score = 0" } (import takes CREATE and INSERT; changes go through query_database)\n' +
      "Not: a part that stops mid-statement (cut parts after a ; that ends a statement, like the export's own parts)",
    inputSchema: {
      ...object({ slug, dump_sql: { type: "string", minLength: 1, description: "A part of the dump, up to 5 MB, ending on a whole statement" } }, ["slug", "dump_sql"]),
      examples: [
        {
          slug: "sky-hopper",
          dump_sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL);\nINSERT INTO scores VALUES('player_8f3k2m9q1x7c4v6b0n5z',1200);\nINSERT INTO scores VALUES('player_2b7x0q4n1m8k5c3v9z6d',900);\nCREATE INDEX scores_by_best_score ON scores (best_score);",
        },
      ],
    },
    outputSchema: DATABASE_IMPORT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/database/import`, pick(toolArguments, ["dump_sql"])),
  },
  {
    name: "restore_database",
    title: "Restore a game's database to a time",
    description:
      "Put the game's own database back as it was at a moment in the last 30 days, tables and rows both, live: the undo for a bad import, a game server bug or a wrong DELETE. Everything written since is gone until you undo the restore with undo_database_restore, which works for 30 days. get_history shows when the change you want to undo happened; go back to a minute before it. The database restarts, so a game server's query in that second can answer database_unavailable (try again). Players erased since that moment (deleted accounts, erase_player) are erased again, and the month's use isn't rolled back. Not before the game was made, and up to 5 restores and undos a minute. Ask the developer first: it changes what a live game sees.\n\n" +
      'Not: { "restore_to_at": "2026-10-18 14:05" } (an ISO time with Z or an offset, like "2026-10-18T14:05:00Z")\n' +
      'Not: { "restore_to_at": "1 hour ago" } (work out the ISO time)',
    inputSchema: {
      ...object({ slug, restore_to_at: { type: "string", format: "date-time", description: "The moment to go back to: an ISO time with Z or an offset, in the last 30 days" } }, ["slug", "restore_to_at"]),
      examples: [{ slug: "sky-hopper", restore_to_at: "2026-10-18T14:05:00Z" }],
    },
    outputSchema: DATABASE_RESTORED,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/database/restores`, pick(toolArguments, ["restore_to_at"])),
  },
  {
    name: "undo_database_restore",
    title: "Undo a game database restore",
    description:
      "Undo a restore_database: the game's database goes back to just before that restore, live, and what was written after it is gone (this is a restore too, so it can be undone the same way). Within 30 days of the restore; get_database lists the restores with their ids. Players erased since are erased again. Ask the developer first.",
    inputSchema: object({ slug, database_restore_id: idInput("database_restore", "The restore to undo, from get_database's restores or restore_database's answer.") }, ["slug", "database_restore_id"]),
    outputSchema: DATABASE_RESTORED,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/database/restores/${pathPart(toolArguments.database_restore_id)}/undo`),
  },
  {
    name: "list_saves",
    title: "List a game's saves",
    description:
      "The players with a cloud save in the game, by player ID, 100 a page: each save's size, when it last changed and who changed it (the player's game, or you), and how many earlier versions it has. Cloud saves are signed-in players' progress, mirrored from the game's own browser saves (localStorage and IndexedDB); guests' stays in their browser. Saves are apart from the game database. For more than 100, pass next_cursor as cursor.",
    inputSchema: object({ slug, cursor: { type: "string", pattern: "^cursor_[a-z0-9]+$", description: "next_cursor from an earlier call: the page after it" } }, ["slug"]),
    outputSchema: SAVE_LIST,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/saves${toolArguments.cursor ? `?cursor=${pathPart(toolArguments.cursor)}` : ""}`),
  },
  {
    name: "get_save",
    title: "Read a player's save",
    description:
      "One player's cloud save in the game: its localStorage items (each key and its text, as the game reads them) and its IndexedDB databases, or only some localStorage keys with keys. A save is up to 5 MB, so ask for keys when you only need a few. change_save changes some keys; replace_save the whole save.",
    inputSchema: { ...object({ slug, player_id: playerId, keys: saveKeys }, ["slug", "player_id"]), examples: [{ slug: "sky-hopper", player_id: "player_8f3k2m9q1x7c4v6b0n5z", keys: ["coins", "level"] }] },
    outputSchema: SAVE,
    annotations: read,
    run: (toolArguments, call) => call("GET", `${savePath(toolArguments)}${keysQuery(toolArguments.keys)}`),
  },
  {
    name: "change_save",
    title: "Change some keys of a save",
    description:
      `Set or remove some localStorage keys in a player's cloud save; the rest of the save (other keys, IndexedDB) stays as it is. Values are text, as localStorage holds them; null removes a key. Makes a save when the player has none. A copy of the save it replaces is kept first (kept_save_copy_id; restore_save_copy undoes the change), except when that save was your own last change. ${SAVE_REACHES_GAMES} The save is the player's progress: ask the developer before changing a live player's save.\n\n` +
      'Not: { "local_storage_items": { "coins": 500 } } (localStorage holds text: "500")\n' +
      'Not: { "local_storage_items": { "inventory": ["sword"] } } (give a list or object as the JSON text the game stores: "[\\"sword\\"]")\n' +
      "Not: change_save to clear the whole save (reset_save does that)",
    inputSchema: {
      ...object(
        {
          slug,
          player_id: playerId,
          local_storage_items: {
            type: "object",
            minProperties: 1,
            additionalProperties: { type: ["string", "null"] },
            description: "The keys to change: each key's new text, or null to remove it. Keys left out stay as they are.",
          },
        },
        ["slug", "player_id", "local_storage_items"],
      ),
      examples: [
        { slug: "sky-hopper", player_id: "player_8f3k2m9q1x7c4v6b0n5z", local_storage_items: { coins: "500", level: "3" } },
        { slug: "sky-hopper", player_id: "player_8f3k2m9q1x7c4v6b0n5z", local_storage_items: { inventory: '["sword","shield"]', tutorial_seen: null } },
      ],
    },
    outputSchema: SAVE_CHANGED,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("PATCH", savePath(toolArguments), pick(toolArguments, ["local_storage_items"])),
  },
  {
    name: "replace_save",
    title: "Replace a whole save",
    description:
      `Replace a player's whole cloud save: its localStorage items and its IndexedDB databases, both given in full (what get_save answers, changed). Keys and databases left out are gone. Makes a save when the player has none. A copy of the save it replaces is kept first (kept_save_copy_id), except when that save was your own last change. ${SAVE_REACHES_GAMES} Ask the developer before replacing a live player's save. To change a few keys, change_save is simpler.\n\n` +
      'Not: { "local_storage_items": { "coins": "500" } } alone (indexeddb_databases is needed too: [] for a game that keeps nothing in IndexedDB)\n' +
      'Not: { "indexeddb_databases": [] } for a Unity or Godot game whose save get_save showed in IndexedDB (that empties its databases)',
    inputSchema: {
      ...object(
        {
          slug,
          player_id: playerId,
          local_storage_items: { type: "object", additionalProperties: { type: "string" }, description: "Every localStorage key the save should have, and its text." },
          indexeddb_databases: {
            type: "array",
            items: { type: "object", description: "One database as get_save answers it: { name, version, stores }." },
            description: "Every IndexedDB database the save should have, as get_save answered them; [] for none.",
          },
        },
        ["slug", "player_id", "local_storage_items", "indexeddb_databases"],
      ),
      examples: [{ slug: "sky-hopper", player_id: "player_8f3k2m9q1x7c4v6b0n5z", local_storage_items: { coins: "0", level: "1", settings: '{"music":true}' }, indexeddb_databases: [] }],
    },
    outputSchema: SAVE_CHANGED,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("PUT", savePath(toolArguments), pick(toolArguments, ["local_storage_items", "indexeddb_databases"])),
  },
  {
    name: "reset_save",
    title: "Reset a player's save",
    description: `Reset a player's cloud save: it becomes empty, so the game starts fresh on every device the player signs in on. A copy of the save it replaces is kept first (kept_save_copy_id; restore_save_copy brings it back), except when that save was your own last change. ${SAVE_REACHES_GAMES} Ask the developer first.`,
    inputSchema: object({ slug, player_id: playerId }, ["slug", "player_id"]),
    outputSchema: SAVE_CHANGED,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("DELETE", savePath(toolArguments)),
  },
  {
    name: "list_save_copies",
    title: "A save's earlier versions",
    description:
      "A player's earlier versions of their cloud save, newest first: up to 5, kept about once an hour while playing and whenever progress was about to be replaced (by another device, a restart, the player going back, or a change of yours), each with why. Read one with get_save_copy; make one the save again with restore_save_copy.",
    inputSchema: object({ slug, player_id: playerId }, ["slug", "player_id"]),
    outputSchema: SAVE_COPY_LIST,
    annotations: read,
    run: (toolArguments, call) => call("GET", `${savePath(toolArguments)}/copies`),
  },
  {
    name: "get_save_copy",
    title: "Read an earlier version",
    description: "One earlier version of a player's cloud save: what it holds, like get_save, whole or only some localStorage keys.",
    inputSchema: object({ slug, player_id: playerId, save_copy_id: saveCopyId, keys: saveKeys }, ["slug", "player_id", "save_copy_id"]),
    outputSchema: SAVE_COPY,
    annotations: read,
    run: (toolArguments, call) => call("GET", `${savePath(toolArguments)}/copies/${pathPart(toolArguments.save_copy_id)}${keysQuery(toolArguments.keys)}`),
  },
  {
    name: "restore_save_copy",
    title: "Go back to an earlier version",
    description: `Make an earlier version a player's cloud save again, like after a bad change or a player's lost progress. A copy of the save it replaces is kept first (kept_save_copy_id), except when that save was your own last change. ${SAVE_REACHES_GAMES} Ask the developer first. Whether players themselves can go back is the game's own rule.`,
    inputSchema: object({ slug, player_id: playerId, save_copy_id: saveCopyId }, ["slug", "player_id", "save_copy_id"]),
    outputSchema: SAVE_CHANGED,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `${savePath(toolArguments)}/copies/${pathPart(toolArguments.save_copy_id)}/restore`),
  },
];

/** Text as UTF-8, or base64 (a data: URL prefix is fine) as the bytes it holds. */
function decode(given: string, encoding: "text" | "base64", field: string): Uint8Array {
  if (encoding === "text") return new TextEncoder().encode(given);
  try {
    return Uint8Array.from(atob(given.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")), (character) => character.charCodeAt(0));
  } catch {
    throw new ApiError("bad_base64", { message: `${field} isn't valid base64.`, field, fix: "Send the file's bytes base64-encoded, with nothing around them." });
  }
}

/** Files that are never text, so content_text for one is a mistake that would store a broken file. */
const BINARY_FILE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|mp3|ogg|oga|opus|wav|m4a|aac|flac|mp4|webm|woff2?|ttf|otf|glb|ktx2|basis|hdr|wasm|bin|pck|data|dat)$/i;
const FILE_SHAPE_FIX = 'Give each file as { "path": "index.html", "content_text": "…" } for a text file, or { "path": "assets/hero.png", "content_base64": "…" } for any other.';

/** upload_files' and check_game's files, decoded: each one's path and bytes, up to 5 MB in all. */
function decodeFiles(toolArguments: Record<string, unknown>, tooBigFix: string): { path: string; bytes: Uint8Array }[] {
  if (!Array.isArray(toolArguments.files) || toolArguments.files.length === 0) {
    throw new ApiError("bad_files", { message: "files isn't a list with at least one file.", field: "files", fix: `${FILE_SHAPE_FIX} One of them is index.html.` });
  }
  const given = toolArguments.files as { path?: unknown; content_text?: unknown; content_base64?: unknown }[];
  const files: { path: string; bytes: Uint8Array }[] = [];
  let totalSizeBytes = 0;
  for (const [i, file] of given.entries()) {
    const extraKey = file && typeof file === "object" ? Object.keys(file).find((key) => key !== "path" && key !== "content_text" && key !== "content_base64") : undefined;
    if (extraKey) throw new ApiError("unknown_field", { message: `files[${i}].${extraKey} isn't a field of a file.`, field: `files[${i}].${extraKey}`, fix: FILE_SHAPE_FIX });
    if (typeof file?.path !== "string" || (typeof file.content_text === "string") === (typeof file.content_base64 === "string")) {
      throw new ApiError("bad_files", { message: `files[${i}] needs a path and one of content_text or content_base64.`, field: `files[${i}]`, fix: FILE_SHAPE_FIX });
    }
    if (typeof file.content_text === "string" && BINARY_FILE.test(file.path)) {
      throw new ApiError("bad_files", { message: `${file.path} isn't a text file, so content_text would store it broken.`, field: `files[${i}].content_text`, fix: "Send it base64-encoded in content_base64 instead." });
    }
    const bytes = typeof file.content_text === "string" ? decode(file.content_text, "text", `files[${i}].content_text`) : decode(file.content_base64 as string, "base64", `files[${i}].content_base64`);
    totalSizeBytes += bytes.byteLength;
    if (totalSizeBytes > MAXIMUM_MCP_UPLOAD_SIZE_BYTES) {
      throw new ApiError("too_big_for_mcp", { message: `The files are over ${MAXIMUM_MCP_UPLOAD_SIZE_BYTES / 1048576} MB, the most upload_files and check_game take.`, field: "files", fix: tooBigFix });
    }
    files.push({ path: file.path, bytes });
  }
  return files;
}

/** check_game: the files as the API's check takes them, the HTML, JavaScript and CSS as text and the rest as a size. */
async function checkFiles(toolArguments: Record<string, unknown>, call: ApiCall): Promise<unknown> {
  const files = decodeFiles(toolArguments, "Run `npx @zaisma/cli check <folder>` in a terminal: it checks a folder of any size, with no key.").map(({ path, bytes }) => ({
    path,
    size_bytes: bytes.byteLength,
    ...(CHECKED_TEXT_EXTENSIONS.includes(extensionOf(path)) ? { content_text: new TextDecoder().decode(bytes) } : {}),
  }));
  return call("POST", "/check", { files, ...(typeof toolArguments.slug === "string" ? { slug: toolArguments.slug } : {}) });
}

async function uploadFiles(toolArguments: Record<string, unknown>, call: ApiCall): Promise<unknown> {
  const files: { path: string; sha256: string; sizeBytes: number; bytes: Uint8Array }[] = [];
  const fix = `Run \`npx @zaisma/cli upload <folder> --game ${toolArguments.slug}\` in a terminal with ZAISMA_KEY set to the same API key; it only sends changed files.`;
  for (const { path, bytes } of decodeFiles(toolArguments, fix)) {
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    files.push({ path, sha256, sizeBytes: bytes.byteLength, bytes });
  }
  const list = files.map(({ path, sha256, sizeBytes }) => ({ path, sha256, size_bytes: sizeBytes }));
  const { missing_file_hashes: missing } = (await call("POST", `/games/${pathPart(toolArguments.slug)}/uploads`, { files: list })) as { missing_file_hashes: string[] };
  const sent = new Set<string>();
  for (const file of files) {
    if (!missing.includes(file.sha256) || sent.has(file.sha256)) continue;
    await call("PUT", `/files/${file.sha256}`, file.bytes);
    sent.add(file.sha256);
  }
  const { version, next_steps: nextSteps } = await call("POST", `/games/${pathPart(toolArguments.slug)}/versions`, {
    files: list,
    patch_notes: typeof toolArguments.patch_notes === "string" ? toolArguments.patch_notes : "",
    publish_when_approved: toolArguments.publish_when_approved === true,
  });
  return { version, sent_file_count: sent.size, next_steps: nextSteps };
}

/** Words an AI often sends for an argument a tool names otherwise. */
const MEANT: Record<string, string> = {
  q: "search_text",
  query: "search_text",
  search: "search_text",
  text: "text_markdown",
  body: "text_markdown",
  content: "text_markdown",
  players: "play_modes",
  publish_at: "scheduled_publish_at",
  at: "scheduled_publish_at",
  images: "images_base64",
  image: "image_base64",
  game: "slug",
  // The admin MCP's names before docs/NAMING.md.
  group: "report_group_id",
  reason: "why",
  reply: "reply_text_markdown",
  area: "category",
  merge_into: "merge_into_topic_id",
  ai_alone: "can_ai_apply_alone",
  replaces: "replaces_precedent_id",
  answer: "answer_post_id",
};

/**
 * Arguments are closed and the required ones must be there: a misnamed argument is an error, never
 * quietly dropped (docs/NAMING.md, Inputs). Values are checked by the API (and by the admin MCP itself).
 */
export function checkArguments(tool: Pick<Tool, "name" | "inputSchema">, toolArguments: Record<string, unknown>): void {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
  const names = Object.keys(properties);
  for (const key of Object.keys(toolArguments)) {
    if (key in properties) continue;
    const meant = MEANT[key] && MEANT[key] in properties ? `Did you mean ${MEANT[key]}? ` : "";
    throw new ApiError("unknown_field", { message: `${key} isn't an argument of ${tool.name}.`, field: key, fix: `${meant}${tool.name} takes: ${names.join(", ") || "no arguments"}.` });
  }
  for (const key of (tool.inputSchema.required ?? []) as string[]) {
    if (toolArguments[key] !== undefined) continue;
    throw new ApiError("missing_field", { message: `${tool.name} needs ${key}.`, field: key, fix: `Add ${key}${properties[key]?.description ? `: ${properties[key]!.description}` : ""}.` });
  }
}

/** A JSON-RPC 2.0 message, in the standard's own names. */
interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** A JSON-RPC error; `data` carries Zaisma's own error object when there is one. */
const rpcError = (id: RpcMessage["id"], errorCode: number, message: string, zaismaError?: unknown) => ({ jsonrpc: "2.0", id: id ?? null, error: { code: errorCode, message, ...(zaismaError === undefined ? {} : { data: zaismaError }) } });

export async function handleMcp(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  let caller: Caller;
  try {
    if (!request.headers.get("authorization")) {
      throw new ApiError("no_key", {
        message: "The MCP was called without an API key or a sign-in.",
        field: "Authorization",
        fix: "Add zaisma.com/mcp as a connector in your AI app and sign in, or send a key from zaisma.com/account as: Authorization: Bearer zsk_…",
      });
    }
    caller = await authenticate(request, env, "mcp");
    if (ctx) caller.waitUntil = (promise) => ctx.waitUntil(promise);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // Where an AI app finds how to sign in (the MCP authorization spec, RFC 9728), and that a token it sent didn't work.
    const challenge = `Bearer resource_metadata="${env.SITE_ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"${request.headers.get("authorization") ? ', error="invalid_token"' : ""}`;
    const headers: Record<string, string> = error.httpStatus === 401 ? { "WWW-Authenticate": challenge } : {};
    if (error.retryAfterSec !== null) headers["Retry-After"] = String(error.retryAfterSec);
    return Response.json(rpcError(null, -32001, `${error.message} ${error.fix}`, error.toAnswer()), { status: error.httpStatus, headers });
  }
  const call: ApiCall = (method, path, payload) => apiCall(env, caller, method, path, payload);
  return serveMcp(
    request,
    { name: "zaisma", title: "Zaisma", instructions: INSTRUCTIONS },
    TOOLS.map((tool) => ({
      ...tool,
      ...(tool.outputSchema ? { outputSchema: answerOrError(tool.outputSchema) } : {}),
      run: (toolArguments: Record<string, unknown>) => {
        checkArguments(tool, toolArguments);
        return tool.run(toolArguments, call);
      },
    })),
    (error) => {
      // Anything else is our bug, not the AI's: it says so, with what to do.
      if (!(error instanceof ApiError)) console.error("MCP tool failed", error);
      const refusal = error instanceof ApiError ? error : INTERNAL_ERROR();
      return { text: `${refusal.message} ${refusal.fix} (${refusal.code})`, structuredContent: refusal.toAnswer() };
    },
  );
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: Tool["annotations"];
  run: (toolArguments: Record<string, unknown>) => Promise<unknown>;
}

/** An image in a tool's answer, in MCP's own names. */
export interface McpImage {
  data: string;
  mimeType: string;
}

/** A tool's answer that also shows pictures. */
export class WithImages {
  constructor(
    readonly answer: unknown,
    readonly images: McpImage[],
  ) {}
}

/**
 * Answers MCP messages for a set of tools: Streamable HTTP without sessions or streaming, each POST
 * one JSON-RPC message (or a batch). `userError` turns a tool's refusal into words for the AI (with
 * its error object as structuredContent, when it has one), or returns null for a real failure.
 */
export async function serveMcp(
  request: Request,
  server: { name: string; title: string; instructions: string },
  tools: McpTool[],
  userError: (error: unknown) => string | { text: string; structuredContent: unknown } | null,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAXIMUM_BODY_SIZE_BYTES) return Response.json(rpcError(null, -32600, "That message is too big."), { status: 413 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Send JSON-RPC as JSON."), { status: 400 });
  }

  const answer = async (message: RpcMessage): Promise<unknown | null> => {
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(message?.id, -32600, "Not a JSON-RPC 2.0 request.");
    if (message.id === undefined) return null; // A notification, like notifications/initialized.
    const succeed = (rpcResult: unknown) => ({ jsonrpc: "2.0", id: message.id, result: rpcResult });
    switch (message.method) {
      case "initialize": {
        const asked = String(message.params?.protocolVersion ?? "");
        return succeed({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.title, version: "0.1.0", websiteUrl: "https://zaisma.com" },
          instructions: server.instructions,
        });
      }
      case "ping":
        return succeed({});
      case "tools/list":
        return succeed({ tools: tools.map(({ run: _, ...listed }) => listed) });
      case "tools/call": {
        const tool = tools.find((candidate) => candidate.name === message.params?.name);
        if (!tool) return rpcError(message.id, -32602, `No tool called ${String(message.params?.name)}.`);
        const toolArguments = message.params?.arguments && typeof message.params.arguments === "object" ? (message.params.arguments as Record<string, unknown>) : {};
        try {
          const ran = await tool.run(toolArguments);
          const structured = ran instanceof WithImages ? ran.answer : ran;
          const images = ran instanceof WithImages ? ran.images.map((image) => ({ type: "image", ...image })) : [];
          // Compact JSON: indenting costs the AI tokens and tells it nothing.
          return succeed({ content: [{ type: "text", text: JSON.stringify(structured) }, ...images], structuredContent: structured });
        } catch (error) {
          const said = userError(error);
          if (said === null) throw error;
          if (typeof said === "string") return succeed({ content: [{ type: "text", text: said }], isError: true });
          return succeed({ content: [{ type: "text", text: said.text }], structuredContent: said.structuredContent, isError: true });
        }
      }
      default:
        return rpcError(message.id, -32601, `${message.method} isn't supported.`);
    }
  };

  const headers = { "Cache-Control": "no-store" };
  if (Array.isArray(body)) {
    const answers = (await Promise.all(body.map((message) => answer(message as RpcMessage)))).filter((reply) => reply !== null);
    return answers.length ? Response.json(answers, { headers }) : new Response(null, { status: 202 });
  }
  const reply = await answer(body as RpcMessage);
  return reply === null ? new Response(null, { status: 202 }) : Response.json(reply, { headers });
}
