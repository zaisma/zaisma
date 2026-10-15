import { ApiError, CONTROLS, DEVICES, FORUM_CATEGORIES, FORUM_LIMITS, FORUM_REPORT_REASONS, FORUM_SECTIONS, FORUM_TABS, FORUM_TAGS, PLAY_STYLES, POST_SELECTIONS, ROOM_BROWSING, SCREENS, TOPIC_KINDS, TOPIC_STATUSES, VISIBILITIES, type IdKind } from "@zaisma/core";
import { INTERNAL_ERROR, apiCall, authenticate, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { GAME, HISTORY, IMAGE, NEW_REPLY, NEW_TOPIC, NEXT, POST, REPORTS, STATS, TESTER, TOPIC_PAGE, TOPIC_WITH_POSTS, VERSION, answerOrError, choice, countOf, idOf, list, nullable, object as answer, text, yes } from "./schemas.ts";

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
1. create_game makes a game. It starts as a draft only its developer can see.
2. Upload a version. Small games (under 5 MB, like single-file HTML games): upload_files with the file contents. Bigger builds: run \`npx @zaisma/cli upload <folder> --game <slug>\` in a terminal with ZAISMA_KEY set to the same API key; it only sends changed files.
3. Every version is scanned, usually in under a minute; get_version shows the result. A held version waits for a person, usually within a day. Passed versions get a private preview link.
4. publish_version makes a passed version live (or rolls back to an older one), now or at a set time. Then update_game with visibility "listed" shows the game to players (or "unlisted": only people with the link). To let testers play first, keep it private and make tester links with add_tester_link.

Ask the developer before making a game private or a draft again (players lose access), and show them the preview link before publishing. Never guess why a version was held beyond what get_version says.

Zaisma's developer forum is where developers and their AI talk with the people who build Zaisma, and you're asked to use it. For any question about Zaisma itself, search_forum first: it's faster and more current than a web search, and it has Zaisma's own answers. When the developer asks how a known issue is going, give its phase and workaround (get_topic with post_selection "none"). Whenever you hit a Zaisma bug, a limit that blocks the developer, a missing feature, a confusing error or a question the docs don't answer: first search_forum with a short search (topics, answers and the known issues with their workarounds). If it's there, vote, reply, or send the developer's own case privately (message_zaisma with known_issue_topic_id); if their fixed topic is back, reopen it. Otherwise post it: what you were doing, what you expected, what happened, the exact error and the tool call. Forum topics (post_topic) are public, so keep private details out of them; anything private (logs, an unreleased game, details the developer wouldn't share) goes in message_zaisma, which only the developer and Zaisma see. What you attach in debug_context is never public, and neither are a message's images. Never include API keys, passwords or players' personal details (secrets are blanked anyway). Your posts carry the developer's name with an AI mark. search_forum's yours tab shows what's new, and list_games shows unread_topic_count when Zaisma has replied.

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
}

type ApiCall = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

const slug = { type: "string", description: "The game's link name, as in zaisma.com/g/<slug>, from list_games or create_game" };
/** An ID input: its kind is in its value, like version_8f3k2m9q1x7c4v6b0n5z (docs/NAMING.md, IDs). */
const idInput = (kind: IdKind, description: string) => ({ type: "string", pattern: `^${kind}_[a-z0-9]+$`, description, examples: [`${kind}_8f3k2m9q1x7c4v6b0n5z`] });
const versionId = idInput("version", "A version's id from get_game or upload_files");
const topicId = idInput("topic", "A topic's id from search_forum");
const postId = idInput("post", "A post's id from get_topic");
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
  multiplayer_mode: {
    enum: ["none", "relay", "own"],
    description:
      "Multiplayer on Zaisma rooms. none: single-player or the game's own servers. relay: Zaisma passes each message to the others, no server code. own: your game server runs on Zaisma: put it in a zaisma-server/ folder at the top of the upload, where index.js default-exports { setup, onJoin, onLeave, onMessage, onTick, maxPlayers, tickRate } (plus, if it likes, idleAfter, holdFor, away, onAway and onBack for players who walk away: idle, hidden or disconnected players leave the match with their seat held for 5 minutes unless it decides otherwise) and can import the folder's other .js, .json (data) and .wasm (WebAssembly, like a physics engine) files by relative path (plain JavaScript ES modules; npm packages or TypeScript: bundle into one zaisma-server.js instead). Up to 500 files and 5 MB. It runs sealed off: no internet, so it only talks to its players. Players never get the file. get_stats shows its errors.",
  },
  room_browsing: {
    enum: ROOM_BROWSING,
    description:
      "For games on Zaisma rooms: where open rooms are listed so players can join them. page (the default): on the game page and to the game through Zaisma.rooms.list(). game: only to the game, for games with their own lobby or server browser. off: nowhere; room codes and invite links still work. Single rooms can be hidden with joinRoom({ listed: false }) or room.setListed(false).",
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
    description: "Your games, with their visibility (draft, listed, unlisted, private) and review_status, and unread_topic_count: how many of your forum topics Zaisma has replied to or changed since you last opened them (search_forum, tab yours).",
    inputSchema: object({}),
    outputSchema: answer({ games: list(GAME), unread_topic_count: countOf("Your forum topics with something new from Zaisma.") }),
    annotations: read,
    run: (_, call) => call("GET", "/games"),
  },
  {
    name: "create_game",
    title: "Make a game",
    description: "Make a new game. It starts as a draft only you can see. The link name comes from the title unless you give one.",
    inputSchema: object({ ...details, slug: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", description: "Link name: lowercase letters, numbers and single hyphens" } }, ["title"]),
    outputSchema: answer({ game: GAME, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", "/games", pick(toolArguments, ["slug", ...DETAILS])),
  },
  {
    name: "get_game",
    title: "Get a game",
    description: "One game: its details, covers and screenshots, every version with its scan result, findings, preview link and whether it's live, and its tester links.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: answer({ game: GAME, images: list(IMAGE), versions: list(VERSION, "Newest first."), testers: list(TESTER) }),
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}`),
  },
  {
    name: "update_game",
    title: "Change a game's details",
    description:
      'Change the title, description, device labels, play_modes (single-player, local and online multiplayer with player counts), cloud saves, multiplayer, room browsing or visibility. listed: on Zaisma for everyone. unlisted: only people with the link. private and draft: only you and people with a tester link (add_tester_link). Leave out what stays the same; null clears it. A new title or description on a game players can see waits for review. Making a public game private or a draft takes it away from players, so it needs "confirm": true after asking the developer.\n\n' +
      'Not: { "play_modes": [{ "mode": "single", "maximum_player_count": 1 }] } (single takes no player counts: { "mode": "single" })\n' +
      'Not: { "play_modes": [{ "mode": "online", "maximum_player_count": 4 }] } (local and online need minimum_player_count, 2 or more, and play_style)\n' +
      'Not: { "play_modes": ["single", "online"] } (each mode is an object, like { "mode": "single" })\n' +
      'Not: { "players": "2-4" } (player counts go in play_modes)\n' +
      'Not: { "play_modes": [] } (null clears it)\n' +
      'Not: { "visibility": "public" } (listed: everyone; unlisted: only people with the link)',
    inputSchema: {
      ...object({ slug, ...details, visibility: { enum: VISIBILITIES }, confirm: { type: "boolean", description: "The developer agreed to hide a public game" } }, ["slug"]),
      examples: [
        { slug: "sky-hopper", play_modes: [{ mode: "single" }, { mode: "online", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }] },
        { slug: "party-hop", play_modes: [{ mode: "local", minimum_player_count: 2, maximum_player_count: null, play_style: "versus" }], devices: ["phone", "tablet"], controls: ["touch"], screen_orientation: "landscape" },
        { slug: "sky-hopper", visibility: "listed" },
        { slug: "sky-hopper", multiplayer_mode: "relay", room_browsing: "page" },
        { slug: "sky-hopper", play_modes: null },
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
      `Upload a new version from file contents, up to ${MAXIMUM_MCP_UPLOAD_SIZE_BYTES / 1048576} MB in all. It needs an index.html at the top; paths are relative to the game's folder. Text files (HTML, JavaScript, CSS, JSON) go in "content_text", every other file (images, sounds, fonts, .wasm) base64-encoded in "content_base64". It's scanned, then waits as a draft with a preview link (or goes live when it passes, with publish_when_approved). For bigger builds, run \`npx @zaisma/cli upload <folder> --game <slug>\` instead.\n\n` +
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
          publish_when_approved: { type: "boolean", description: "Go live as soon as it passes the scan" },
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
    name: "get_version",
    title: "Check a version",
    description: "A version's scan_status (scanning, held, approved or rejected), its findings (what the scan found and how to fix it), and its private preview link once it passes.",
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
    name: "add_image",
    title: "Add a cover or screenshot",
    description: "Add a cover (landscape, 16:9 shows best), a square cover (optional, shown on phones instead, where a landscape one is small; as wide as tall, at least 512 px) or a screenshot (up to 8). A new cover replaces the old one of its kind once approved. Players see the cover alone as the game's card, with no title drawn over or under it, so covers should carry the game's name or logo; screenshots are just the game. PNG, JPEG or WebP, up to 5 MB, at least 320 px a side. Images show once reviewed.",
    inputSchema: object({ slug, kind: { enum: ["cover", "square", "screenshot"] }, image_base64: { type: "string", description: "The PNG, JPEG or WebP file, base64-encoded (a data: URL prefix is fine)" } }, ["slug", "kind", "image_base64"]),
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
      "Make a secret link that opens the game's live version for anyone who has it, even while the game is private or a draft, with no account needed. Make one per group (your team, playtesters, a streamer) and name it for them, so you can turn one off without the others. Multiplayer works through it; testers' progress stays in their browser.",
    inputSchema: object({ slug, name: { type: "string", minLength: 1, maxLength: 60, description: 'Who it\'s for, like "Playtesters"' } }, ["slug", "name"]),
    outputSchema: answer({ tester: TESTER, next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (toolArguments, call) => call("POST", `/games/${pathPart(toolArguments.slug)}/testers`, pick(toolArguments, ["name"])),
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
    name: "search_forum",
    title: "Search the developer forum",
    description:
      "Search Zaisma's developer forum: the fastest place to find answers about Zaisma itself, before any web search. Topics are bugs, missing pieces, ideas, questions and discussions from developers and their AI, answered by other developers and Zaisma, plus Zaisma's known issues with their phase and workaround. search_text is ranked full-text search over titles, posts and workarounds: use the error code, tool name or a few key words; quote \"exact phrases\", end a word with * to match its start. Results are brief: open one with get_topic, post_selection \"answer\" for a solved question's answer, \"none\" for a known issue's phase and workaround. tab yours shows the developer's topics and the ones they follow, with what's unread; messages shows their private messages to Zaisma. 10 topics unless maximum_topic_count says more (up to 30); next_cursor continues.\n\nNot: { \"q\": \"too_big\" } (the words go in search_text)\nNot: { \"category\": \"multiplayer\" } (multiplayer is a section; category takes one category, like rooms)\nNot: { \"tab\": \"known_issues\" } (tab known)\nNot: { \"search_text\": \"I tried to upload my game and it failed with an error saying it was too big\" } (a few key words or the error code: \"upload_files too_big\")\nNot: { \"maximum_topic_count\": 100 } (up to 30; next_cursor continues)",
    inputSchema: {
      ...object({
        search_text: { type: "string", maxLength: 200, description: "Search words, like the error code or what failed." },
        tab: { enum: FORUM_TABS, description: "latest (the default), top (most votes), unanswered (questions), known (known issues), yours or messages." },
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
    name: "mark_helpful",
    title: "Mark a reply helpful",
    description: "A reply in a public topic helped the developer (or you, on their behalf): it counts toward how many found it helpful, so useful answers stand out. Not for their own posts. undo: true takes it back.",
    inputSchema: object({ topic_id: topicId, post_id: postId, undo: { type: "boolean", description: "Take the mark back." } }, ["topic_id", "post_id"]),
    outputSchema: answer({ helpful_count: countOf(), has_marked_helpful: yes(), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (toolArguments, call) => call(toolArguments.undo === true ? "DELETE" : "POST", `/forum/${pathPart(toolArguments.topic_id)}/posts/${pathPart(toolArguments.post_id)}/helpful`),
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
    name: "get_reports",
    title: "Player reports",
    description:
      "What players reported about the game in the last 90 days, counted by reason, with the bug reports: what the player wrote, a one-line summary and the version they played. To check for new bug reports later, pass the next_cursor from your last call as cursor.",
    inputSchema: object({ slug, cursor: { type: "string", description: "next_cursor from an earlier call: only bug reports that arrived after it" } }, ["slug"]),
    outputSchema: REPORTS,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/reports${toolArguments.cursor ? `?cursor=${pathPart(toolArguments.cursor)}` : ""}`),
  },
  {
    name: "get_stats",
    title: "Play stats",
    description:
      "Play stats over the last period_duration_days (30 unless you say): counted plays, players, new players and play time per day, and how many new players came back 1, 7 and 30 days later. Counted plays are the official numbers: the game on screen for a minute in a browser Cloudflare checked; started_play_count is every play started. Tester and preview links and the developer's own plays don't count; a player is a browser. Also multiplayer use per day, room play time this month against the free hours (until hosting billing is ready, no new rooms open past them until the month resets; matches already running carry on), and for games with their own game server, its calls and recent errors.",
    inputSchema: object({ slug, period_duration_days: { type: "integer", minimum: 1, maximum: 90, description: "How many days back, today included; 30 by default" } }, ["slug"]),
    outputSchema: STATS,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/stats${toolArguments.period_duration_days ? `?period_duration_days=${pathPart(toolArguments.period_duration_days)}` : ""}`),
  },
  {
    name: "get_history",
    title: "Game history",
    description: "What happened to the game, newest first: uploads, scan results, publishes, rollbacks, reviews and holds, and whether you or Zaisma did it. Start here to answer why a game or version is held.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: HISTORY,
    annotations: read,
    run: (toolArguments, call) => call("GET", `/games/${pathPart(toolArguments.slug)}/history`),
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

async function uploadFiles(toolArguments: Record<string, unknown>, call: ApiCall): Promise<unknown> {
  if (!Array.isArray(toolArguments.files) || toolArguments.files.length === 0) {
    throw new ApiError("bad_files", { message: "files isn't a list with at least one file.", field: "files", fix: `${FILE_SHAPE_FIX} One of them is index.html.` });
  }
  const given = toolArguments.files as { path?: unknown; content_text?: unknown; content_base64?: unknown }[];
  const files: { path: string; sha256: string; sizeBytes: number; bytes: Uint8Array }[] = [];
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
      throw new ApiError("too_big_for_mcp", {
        message: `The files are over ${MAXIMUM_MCP_UPLOAD_SIZE_BYTES / 1048576} MB, the most upload_files takes.`,
        field: "files",
        fix: `Run \`npx @zaisma/cli upload <folder> --game ${toolArguments.slug}\` in a terminal with ZAISMA_KEY set to the same API key; it only sends changed files.`,
      });
    }
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    files.push({ path: file.path, sha256, sizeBytes: bytes.byteLength, bytes });
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
const MEANT: Record<string, string> = { q: "search_text", query: "search_text", search: "search_text", text: "text_markdown", body: "text_markdown", content: "text_markdown", players: "play_modes", publish_at: "scheduled_publish_at", at: "scheduled_publish_at", images: "images_base64", image: "image_base64", game: "slug" };

/**
 * Arguments are closed and the required ones must be there: a misnamed argument is an error, never
 * quietly dropped (docs/NAMING.md, Inputs). Values are checked by the API.
 */
function checkArguments(tool: Tool, toolArguments: Record<string, unknown>): void {
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

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  let caller: Caller;
  try {
    if (!request.headers.get("authorization")) {
      throw new ApiError("no_key", { message: "The MCP was called without an API key.", field: "Authorization", fix: "Make a key on zaisma.com/account (under Game developers) and send it as: Authorization: Bearer zsk_…" });
    }
    caller = await authenticate(request, env);
    caller.via = "mcp";
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const headers: Record<string, string> = error.httpStatus === 401 ? { "WWW-Authenticate": 'Bearer realm="zaisma"' } : {};
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
