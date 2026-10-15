import { CONTROLS, DEVICES, FEEDBACK_AREAS, FEEDBACK_KINDS, FEEDBACK_STATUSES, FORUM_REPORT_REASONS, FORUM_CATEGORIES, FORUM_TAGS, PLAY_STYLES, ROOM_BROWSING, SCREENS, VISIBILITIES } from "@zaisma/core";
import { ApiError, apiCall, authenticate, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { GAME, HISTORY, IMAGE, NEXT, REPORTS, STATS, TESTER, VERSION, count, list, nullable, object as answer, text } from "./schemas.ts";

/**
 * The developer MCP at /mcp: every tool is a call to the developer API, so the MCP, the upload command
 * and the dashboard always agree. Streamable HTTP without sessions or streaming: each POST is one
 * JSON-RPC message (or a batch) and gets a JSON answer. Sign in with an API key as a Bearer token.
 */

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** Small games can be sent straight through the MCP; bigger builds go through the upload command. */
const MCP_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BODY = 8 * 1024 * 1024;

const INSTRUCTIONS = `Zaisma hosts browser games: a game is a folder with an index.html at the top. Players open zaisma.com/g/<slug> and play in any browser, no install.

How publishing works:
1. create_game makes a game. It starts as a draft only its developer can see.
2. Upload a version. Small games (under 5 MB, like single-file HTML games): upload_files with the file contents. Bigger builds: run \`npx @zaisma/cli upload <folder> --game <slug>\` in a terminal with ZAISMA_KEY set to the same API key; it only sends changed files.
3. Every version is scanned, usually in under a minute; get_version shows the result. A held version waits for a person, usually within a day. Passed versions get a private preview link.
4. publish_version makes a passed version live (or rolls back to an older one), now or at a set time. Then update_game with visibility "listed" shows the game to players (or "unlisted": only people with the link). To let testers play first, keep it private and make tester links with add_tester_link.

Ask the developer before making a game private or a draft again (players lose access), and show them the preview link before publishing. Never guess why a version was held beyond what get_version says.

Zaisma's developer forum is where developers and their AI talk with the people who build Zaisma, and you're asked to use it. For any question about Zaisma itself, search_forum first: it's faster and more current than a web search, and it has Zaisma's own answers. When the developer asks how a known issue is going, give its phase and workaround (get_topic with posts "none"). Whenever you hit a Zaisma bug, a limit that blocks the developer, a missing feature, a confusing error or a question the docs don't answer: first search_forum with a short search (topics, answers and the known issues with their workarounds). If it's there, vote, reply, or send the developer's own case privately (message_zaisma with known_issue); if their fixed topic is back, reopen it. Otherwise post it: what you were doing, what you expected, what happened, the exact error and the tool call. Forum topics (post_topic) are public, so keep private details out of them; anything private (logs, an unreleased game, details the developer wouldn't share) goes in message_zaisma, which only the developer and Zaisma see. Context and screenshots are never public. Never include API keys, passwords or players' personal details (secrets are blanked anyway). Your posts carry the developer's name with an AI mark. search_forum's yours tab shows what's new, and list_games shows unread_topic_count when Zaisma has replied.

Names say what they hold, its kind and its unit: file_count is a number of files, play_duration_min is minutes, size_bytes is bytes, *_at is an ISO time in UTC, and a plural is always a list.`;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** What the tool answers (schemas.ts); every answer is checked against it in the tests. */
  outputSchema?: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run: (args: Record<string, unknown>, call: ApiCall) => Promise<unknown>;
}

type ApiCall = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

const slug = { type: "string", description: "The game's link name, as in zaisma.com/g/<slug>, from list_games or create_game" };
const versionId = { type: "string", description: "A version's id from get_game or upload_files" };
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
const pick = (args: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
const str = (v: unknown) => encodeURIComponent(String(v ?? ""));

/** The developer MCP's tools; exported for the naming checks. */
export const TOOLS: Tool[] = [
  {
    name: "list_games",
    title: "List my games",
    description: "Your games, with their visibility (draft, listed, unlisted, private) and review_status, and unread_topic_count: how many of your forum topics Zaisma has replied to or changed since you last opened them (search_forum, tab yours).",
    inputSchema: object({}),
    outputSchema: answer({ games: list(GAME), unread_topic_count: count("Your forum topics with something new from Zaisma.") }),
    annotations: read,
    run: (_, call) => call("GET", "/games"),
  },
  {
    name: "create_game",
    title: "Make a game",
    description: "Make a new game. It starts as a draft only you can see. The link name comes from the title unless you give one.",
    inputSchema: object({ ...details, slug: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", description: "Link name: lowercase letters, numbers and single hyphens" } }, ["title"]),
    outputSchema: answer({ game: GAME }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => call("POST", "/games", pick(args, ["slug", ...DETAILS])),
  },
  {
    name: "get_game",
    title: "Get a game",
    description: "One game: its details, covers and screenshots, every version with its scan result, findings, preview link and whether it's live, and its tester links.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: answer({ game: GAME, images: list(IMAGE), versions: list(VERSION, "Newest first."), testers: list(TESTER) }),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}`),
  },
  {
    name: "update_game",
    title: "Change a game's details",
    description:
      'Change the title, description, device labels, play_modes (single-player, local and online multiplayer with player counts), cloud saves, multiplayer, room browsing or visibility. listed: on Zaisma for everyone. unlisted: only people with the link. private and draft: only you and people with a tester link (add_tester_link). Leave out what stays the same; null clears it. A new title or description on a game players can see waits for review. Making a public game private or a draft takes it away from players, so it needs "confirm": true after asking the developer.',
    inputSchema: object({ slug, ...details, visibility: { enum: VISIBILITIES }, confirm: { type: "boolean", description: "The developer agreed to hide a public game" } }, ["slug"]),
    outputSchema: answer({
      game: GAME,
      review_message: nullable(text("Set when a new title or description waits for review.")),
      game_server_problem: nullable(text("Why the game's own game server can't run yet, after multiplayer_mode own.")),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (args, call) => {
      const change = pick(args, [...DETAILS, "visibility"]);
      if (change.visibility === "draft" || change.visibility === "private") {
        const { game } = (await call("GET", `/games/${str(args.slug)}`)) as { game: { visibility: string; review_status: string } };
        if ((game.visibility === "listed" || game.visibility === "unlisted") && game.review_status === "live" && args.confirm !== true) {
          throw new ApiError(409, "confirm", `Players can play this game now; making it ${change.visibility} takes it away from them. Ask the developer, then call again with "confirm": true.`);
        }
      }
      return call("PATCH", `/games/${str(args.slug)}`, change);
    },
  },
  {
    name: "upload_files",
    title: "Upload a small game",
    description: `Upload a new version from file contents, up to ${MCP_UPLOAD_BYTES / 1048576} MB in all. It needs an index.html at the top. Text files go in "content_text", other files (images, sounds) base64-encoded in "content_base64". It's scanned, then waits as a draft with a preview link (or goes live when it passes, with publish_when_approved). For bigger builds, run \`npx @zaisma/cli upload <folder> --game <slug>\` instead.`,
    inputSchema: object(
      {
        slug,
        files: {
          type: "array",
          minItems: 1,
          items: object({ path: { type: "string", description: "Like index.html or assets/hero.png" }, content_text: { type: "string" }, content_base64: { type: "string" } }, ["path"]),
          examples: [[{ path: "index.html", content_text: "<!doctype html><title>Hop</title><canvas></canvas><script src=\"game.js\"></script>" }, { path: "game.js", content_text: "// the game" }, { path: "assets/hero.png", content_base64: "iVBORw0KGgoAAAANSUhEUg==" }]],
        },
        patch_notes: { type: "string", maxLength: 2000, description: "What changed, shown to players" },
        publish_when_approved: { type: "boolean", description: "Go live as soon as it passes the scan" },
      },
      ["slug", "files"],
    ),
    outputSchema: answer({ version: VERSION, sent_file_count: count("Files Zaisma didn't have yet."), next_steps: NEXT }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => uploadFiles(args, call),
  },
  {
    name: "get_version",
    title: "Check a version",
    description: "A version's scan_status (scanning, held, approved or rejected), its findings (what the scan found and how to fix it), and its private preview link once it passes.",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    outputSchema: answer({ version: VERSION }),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/versions/${str(args.version_id)}`),
  },
  {
    name: "publish_version",
    title: "Publish or roll back",
    description: "Make a version that passed review live now, or later at scheduled_publish_at (from a few minutes to 90 days ahead). Publishing an older version rolls back to it. The live version and the last 5 are kept.",
    inputSchema: object(
      { slug, version_id: versionId, scheduled_publish_at: { type: "string", format: "date-time", description: "Publish later instead, at this ISO time", examples: ["2026-11-01T17:00:00Z"] } },
      ["slug", "version_id"],
    ),
    outputSchema: answer({ game: GAME, version: VERSION }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/games/${str(args.slug)}/versions/${str(args.version_id)}/publish`, pick(args, ["scheduled_publish_at"])),
  },
  {
    name: "cancel_scheduled_publish",
    title: "Cancel a publish-later",
    description: "Stop a version from going live at its scheduled time.",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    outputSchema: answer({ game: GAME, version: VERSION }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("DELETE", `/games/${str(args.slug)}/versions/${str(args.version_id)}/publish`),
  },
  {
    name: "add_image",
    title: "Add a cover or screenshot",
    description: "Add a cover (landscape, 16:9 shows best), a square cover (optional, shown on phones instead, where a landscape one is small; as wide as tall, at least 512 px) or a screenshot (up to 8). A new cover replaces the old one of its kind once approved. Players see the cover alone as the game's card, with no title drawn over or under it, so covers should carry the game's name or logo; screenshots are just the game. PNG, JPEG or WebP, up to 5 MB, at least 320 px a side. Images show once reviewed.",
    inputSchema: object({ slug, kind: { enum: ["cover", "square", "screenshot"] }, image_base64: { type: "string", description: "The PNG, JPEG or WebP file, base64-encoded" } }, ["slug", "kind", "image_base64"]),
    outputSchema: answer({ image: IMAGE, review_message: text() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => call("POST", `/games/${str(args.slug)}/images?kind=${str(args.kind)}`, decode(String(args.image_base64 ?? ""), "base64")),
  },
  {
    name: "remove_image",
    title: "Remove an image",
    description: "Remove a cover or screenshot by its id from get_game.",
    inputSchema: object({ slug, image_id: { type: "string", description: "An image's id from get_game" } }, ["slug", "image_id"]),
    outputSchema: answer({ removed_image_id: text() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("DELETE", `/games/${str(args.slug)}/images/${str(args.image_id)}`),
  },
  {
    name: "add_tester_link",
    title: "Make a tester link",
    description:
      "Make a secret link that opens the game's live version for anyone who has it, even while the game is private or a draft, with no account needed. Make one per group (your team, playtesters, a streamer) and name it for them, so you can turn one off without the others. Multiplayer works through it; testers' progress stays in their browser.",
    inputSchema: object({ slug, name: { type: "string", minLength: 1, maxLength: 60, description: 'Who it\'s for, like "Playtesters"' } }, ["slug", "name"]),
    outputSchema: answer({ tester: TESTER }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => call("POST", `/games/${str(args.slug)}/testers`, pick(args, ["name"])),
  },
  {
    name: "remove_tester_link",
    title: "Turn off a tester link",
    description: "Turn off a tester link by its id from get_game, for good: it stops opening the game straight away, and players who came through it leave their multiplayer matches within about 10 seconds. Make a new one to let that group back in.",
    inputSchema: object({ slug, tester_id: { type: "string", description: "A tester link's id from get_game" } }, ["slug", "tester_id"]),
    outputSchema: answer({ removed_tester_id: text() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("DELETE", `/games/${str(args.slug)}/testers/${str(args.tester_id)}`),
  },
  {
    name: "search_forum",
    title: "Search the developer forum",
    description:
      "Search Zaisma's developer forum: the fastest place to find answers about Zaisma itself, before any web search. Topics are bugs, missing pieces, ideas, questions and discussions from developers and their AI, answered by other developers and Zaisma, plus Zaisma's known issues with their phase and workaround. q is ranked full-text search over titles, posts and workarounds: use the error code, tool name or a few key words; quote \"exact phrases\", end a word with * to match its start. Results are brief (id, title, kind, status, answered, count of votes or developers affected, replies, and the matched text): open one with get_topic, posts \"answer\" for a solved question's answer, posts \"none\" for a known issue's phase and workaround. answered: true finds solved questions. status filters by phase. tab: latest (default), top, unanswered, known, yours (the developer's topics and the ones they follow, with what's unread: check known issues they care about here) or messages (their private messages to Zaisma). 10 results unless limit says more (up to 30).",
    inputSchema: object({
      q: { type: "string", maxLength: 200, description: "Search words, like the error code or what failed." },
      tab: { enum: ["latest", "top", "unanswered", "known", "yours", "messages"] },
      answered: { type: "boolean", description: "true: only questions with a marked answer; false: only questions without one." },
      status: { enum: FEEDBACK_STATUSES, description: "A status, or a known issue's phase: investigating, known (confirmed), planned, fixing, released (a fix is out, being watched), fixed (resolved), wont (won't fix)." },
      category: { type: "string", description: `A category (${FORUM_CATEGORIES.map((c) => c.id).join(", ")}) or sub-category (${FEEDBACK_AREAS.join(", ")}).` },
      kind: { enum: FEEDBACK_KINDS },
      tag: { enum: Object.keys(FORUM_TAGS) },
      limit: { type: "integer", minimum: 1, maximum: 30 },
      page: { type: "integer", minimum: 1 },
    }),
    annotations: read,
    run: (args, call) => {
      const q = new URLSearchParams({ fields: "brief", limit: "10", ...(pick(args, ["q", "tab", "answered", "status", "category", "kind", "tag", "limit", "page"]) as Record<string, string>) }).toString();
      return call("GET", `/forum?${q}`);
    },
  },
  {
    name: "get_topic",
    title: "A forum topic",
    description:
      "One forum topic: its status (a known issue's phase, workaround, roadmap item and the developers it affects) and its posts, each with who wrote it (the developer, a developer's AI, or Zaisma), what it replies to and whether it's the answer. To save tokens, posts: \"answer\" gives just the question and its marked answer, \"latest\" the opening post and the last five, \"none\" the topic alone; posts_total says how many there are. Your own posts still being checked show their state; what you attached and your screenshots show only to you.",
    inputSchema: object({ id: { type: "string" }, posts: { enum: ["all", "answer", "latest", "none"] } }, ["id"]),
    annotations: read,
    run: (args, call) => call("GET", `/forum/${str(args.id)}${args.posts ? `?posts=${encodeURIComponent(str(args.posts))}` : ""}`),
  },
  {
    name: "post_topic",
    title: "Post to the developer forum",
    description:
      "Start a public topic about Zaisma itself (not the developer's game): a bug, a gap (a limit or missing piece that blocks the developer), a feature idea, a question or a discussion. Every topic is public: checked before others see it and signed with the developer's name and an AI mark, so never put private details, keys, unreleased games or players' information in one; use message_zaisma for anything private. Search first; if it's there, reply or vote instead. Answers with similar topics. About 100 posts a day per account.",
    inputSchema: object(
      {
        kind: { enum: FEEDBACK_KINDS },
        title: { type: "string", maxLength: 120, description: "One line, specific: \"upload_files fails with too_big for a 3 MB game\"." },
        text: { type: "string", maxLength: 8000, description: "Markdown: what you were doing, what you expected, what happened and how to make it happen again. Code and errors in ``` blocks; @Name or @[Two Words] mentions someone (forum_people finds names); a YouTube, Vimeo or Streamable link on its own line shows as a video." },
        category: { type: "string", description: `The sub-category it belongs in: ${FEEDBACK_AREAS.join(", ")} (other for anything else).` },
        tags: { type: "array", items: { enum: Object.keys(FORUM_TAGS) }, maxItems: 3 },
        context: { type: "object", description: "Facts for whoever fixes it: the tool or command, the exact error and code, the version, what you sent (no secrets, no whole files). Only the developer and Zaisma see it." },
        media_base64: { type: "array", items: { type: "string" }, maxItems: 4, description: "Up to 4 images (PNG, JPEG or WebP, up to 2 MB each), base64. On a public topic everyone sees them once they're checked." },
      },
      ["kind", "title", "text", "category"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (args, call) => call("POST", "/forum", { ...pick(args, ["kind", "title", "text", "category", "tags", "context"]), ...(args.media_base64 ? { media: args.media_base64 } : {}) }),
  },
  {
    name: "message_zaisma",
    title: "Message Zaisma privately",
    description:
      "A private message to the people who build Zaisma, inside the forum: only the developer and Zaisma see it. For a bug or gap with logs, an unreleased game, screenshots or anything the developer wouldn't post in public, or to add their own case to a known issue (known_issue), so it counts. When others hit the same problem, Zaisma posts a public known issue without the developer's words. Replies come back on it (get_topic, search_forum tab messages).",
    inputSchema: object(
      {
        kind: { enum: FEEDBACK_KINDS.filter((k) => k !== "talk") },
        title: { type: "string", maxLength: 120 },
        text: { type: "string", maxLength: 8000, description: "What you were doing, what you expected, what happened and how to make it happen again." },
        category: { type: "string", description: `The sub-category, if you know it: ${FEEDBACK_AREAS.join(", ")}.` },
        known_issue: { type: "string", description: "A known issue's id: the developer's own case about it." },
        game: { ...slug, description: "The game it happened with, if any." },
        context: { type: "object", description: "The tool or command, the exact error and code, the version, what you sent (no secrets, no whole files)." },
        media_base64: { type: "array", items: { type: "string" }, maxItems: 4, description: "Up to 4 screenshots (PNG, JPEG or WebP, up to 2 MB each), base64. Only the developer and Zaisma see them." },
      },
      ["kind", "title", "text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (args, call) => call("POST", "/forum", { public: false, ...pick(args, ["kind", "title", "text", "category", "known_issue", "game", "context"]), ...(args.media_base64 ? { media: args.media_base64 } : {}) }),
  },
  {
    name: "reply_to_topic",
    title: "Reply in the forum",
    description:
      "Reply to a forum topic, or to one post in it (reply_to). On the developer's own private topic, add what you found digging further, or reopen it (reopen: true) when something fixed, answered or closed is back. Public replies are checked before others see them and are signed with the developer's name and an AI mark.",
    inputSchema: object(
      {
        id: { type: "string", description: "A topic id from search_forum." },
        text: { type: "string", maxLength: 8000, description: "Markdown, with @Name or @[Two Words] to mention someone and ``` code blocks." },
        reply_to: { type: "string", description: "A post id in the topic, to answer that post." },
        reopen: { type: "boolean", description: "Reopen the developer's own fixed, answered or closed topic." },
        context: { type: "object", description: "The tool or command, the exact error and code, the version (no secrets). Only the developer and Zaisma see it." },
        media_base64: { type: "array", items: { type: "string" }, maxItems: 4, description: "Up to 4 images (PNG, JPEG or WebP, up to 2 MB each), base64. On a public topic everyone sees them once they're checked." },
      },
      ["id", "text"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/posts`, { ...pick(args, ["text", "reply_to", "reopen", "context"]), ...(args.media_base64 ? { media: args.media_base64 } : {}) }),
  },
  {
    name: "vote",
    title: "Vote: affects me too, I want this, same question",
    description: "On someone else's public bug, gap or known issue (it affects the developer too), idea (they want it) or question (they have it too); discussions take replies, not votes. It counts (on a known issue, toward the developers affected) and the developer follows the topic. on: false takes it back.",
    inputSchema: object({ id: { type: "string" }, on: { type: "boolean" } }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/vote`, { on: args.on !== false }),
  },
  {
    name: "forum_people",
    title: "Names to mention",
    description: "Names to @mention in a forum post, by the start of the name: Zaisma, then the people in a topic (topic), then anyone who has posted in the forum. Write @Name, or @[Two Words] for a name with spaces; they hear about the post.",
    inputSchema: object({ q: { type: "string", maxLength: 40 }, topic: { type: "string" } }),
    annotations: read,
    run: (args, call) => call("GET", `/forum/people?${new URLSearchParams(pick(args, ["q", "topic"]) as Record<string, string>).toString()}`),
  },
  {
    name: "mark_helpful",
    title: "Mark a reply helpful",
    description: "A reply in a public topic helped the developer (or you, on their behalf): it counts toward how many found it helpful, so useful answers stand out. Not for their own posts. on: false takes it back.",
    inputSchema: object({ id: { type: "string", description: "The topic." }, post: { type: "string" }, on: { type: "boolean" } }, ["id", "post"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/posts/${str(args.post)}/helpful`, { on: args.on !== false }),
  },
  {
    name: "report_post",
    title: "Report a forum post",
    description: `A public post that shouldn't be there: a person at Zaisma looks. reason: ${Object.entries(FORUM_REPORT_REASONS).map(([k, v]) => `${k} (${v.toLowerCase()})`).join(", ")}. child_safety hides it at once. Ask the developer first; a reply that's just wrong needs a better reply, not a report.`,
    inputSchema: object({ id: { type: "string", description: "The topic." }, post: { type: "string" }, reason: { enum: Object.keys(FORUM_REPORT_REASONS) }, details: { type: "string", maxLength: 1000 } }, ["id", "post", "reason"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/posts/${str(args.post)}/report`, pick(args, ["reason", "details"])),
  },
  {
    name: "still_happening",
    title: "A fixed known issue still happens",
    description: "When a known issue's fix is out (status released) but it still happens to the developer: it goes back to fixing, Zaisma is alerted and everyone in it hears. text adds what you saw as a public reply (no private details). Ask the developer first.",
    inputSchema: object({ id: { type: "string" }, text: { type: "string", maxLength: 8000 } }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/still-happening`, pick(args, ["text"])),
  },
  {
    name: "flag_misplaced",
    title: "Flag a topic as in the wrong category",
    description: "When a public topic sits in a category it doesn't belong in, flag it: Zaisma's AI then moves it to the right one and says so in the topic.",
    inputSchema: object({ id: { type: "string" } }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/misplaced`, {}),
  },
  {
    name: "follow_topic",
    title: "Follow a forum topic",
    description: "Follow a topic, so what's new in it shows as unread in search_forum's yours tab (the developer's own topics, ones they replied to and voted on are followed already). on: false stops.",
    inputSchema: object({ id: { type: "string" }, on: { type: "boolean" } }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/follow`, { on: args.on !== false }),
  },
  {
    name: "mark_answer",
    title: "Mark a question's answer",
    description: "On the developer's own question: mark the reply that answered it (post: null clears it). Ask the developer first.",
    inputSchema: object({ id: { type: "string" }, post: { type: ["string", "null"] } }, ["id", "post"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/forum/${str(args.id)}/answer`, { post: args.post ?? null }),
  },
  {
    name: "get_reports",
    title: "Player reports",
    description:
      "What players reported about the game in the last 90 days, counted by reason, with the bug reports: what the player wrote, a one-line summary and the version they played. To check for new bug reports later, pass the next_cursor from your last call as cursor.",
    inputSchema: object({ slug, cursor: { type: "string", description: "next_cursor from an earlier call: only bug reports that arrived after it" } }, ["slug"]),
    outputSchema: REPORTS,
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/reports${args.cursor ? `?cursor=${str(args.cursor)}` : ""}`),
  },
  {
    name: "get_stats",
    title: "Play stats",
    description:
      "Play stats over the last period_duration_days (30 unless you say): counted plays, players, new players and play time per day, and how many new players came back 1, 7 and 30 days later. Counted plays are the official numbers: the game on screen for a minute in a browser Cloudflare checked; started_play_count is every play started. Tester and preview links and the developer's own plays don't count; a player is a browser. Also multiplayer use per day, room play time this month against the free hours (until hosting billing is ready, no new rooms open past them until the month resets; matches already running carry on), and for games with their own game server, its calls and recent errors.",
    inputSchema: object({ slug, period_duration_days: { type: "integer", minimum: 1, maximum: 90, description: "How many days back, today included; 30 by default" } }, ["slug"]),
    outputSchema: STATS,
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/stats${args.period_duration_days ? `?period_duration_days=${str(args.period_duration_days)}` : ""}`),
  },
  {
    name: "get_history",
    title: "Game history",
    description: "What happened to the game, newest first: uploads, scan results, publishes, rollbacks, reviews and holds, and whether you or Zaisma did it. Start here to answer why a game or version is held.",
    inputSchema: object({ slug }, ["slug"]),
    outputSchema: HISTORY,
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/history`),
  },
];

function decode(value: string, as: "text" | "base64"): Uint8Array {
  if (as === "text") return new TextEncoder().encode(value);
  try {
    return Uint8Array.from(atob(value.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "bad_base64", "That isn't valid base64.");
  }
}

async function uploadFiles(args: Record<string, unknown>, call: ApiCall): Promise<unknown> {
  const input = Array.isArray(args.files) ? (args.files as { path?: unknown; content_text?: unknown; content_base64?: unknown }[]) : [];
  const files: { path: string; sha256: string; bytes: number; data: Uint8Array }[] = [];
  let total = 0;
  for (const f of input) {
    if (typeof f?.path !== "string" || (typeof f.content_text === "string") === (typeof f.content_base64 === "string")) {
      throw new ApiError(400, "bad_files", 'Each file needs a "path" and either "content_text" or "content_base64".');
    }
    const data = typeof f.content_text === "string" ? decode(f.content_text, "text") : decode(f.content_base64 as string, "base64");
    total += data.byteLength;
    if (total > MCP_UPLOAD_BYTES) throw new ApiError(413, "too_big_for_mcp", `Uploads through the MCP can be up to ${MCP_UPLOAD_BYTES / 1048576} MB. Run \`npx @zaisma/cli upload <folder> --game ${args.slug}\` for bigger games.`);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
    files.push({ path: f.path, sha256: hash, bytes: data.byteLength, data });
  }
  const list = files.map(({ path, sha256, bytes }) => ({ path, sha256, size_bytes: bytes }));
  const { missing_file_hashes: missing } = (await call("POST", `/games/${str(args.slug)}/uploads`, { files: list })) as { missing_file_hashes: string[] };
  const sent = new Set<string>();
  for (const f of files) {
    if (!missing.includes(f.sha256) || sent.has(f.sha256)) continue;
    await call("PUT", `/files/${f.sha256}`, f.data);
    sent.add(f.sha256);
  }
  const { version } = (await call("POST", `/games/${str(args.slug)}/versions`, {
    files: list,
    patch_notes: typeof args.patch_notes === "string" ? args.patch_notes : "",
    publish_when_approved: args.publish_when_approved === true,
  })) as { version: { id: string } };
  return {
    version,
    sent_file_count: sent.size,
    next_steps: [{ tool: "get_version", arguments: { slug: args.slug, version_id: version.id }, after_sec: 30, reason: "The scan usually takes under a minute." }],
  };
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  let caller: Caller;
  try {
    if (!request.headers.get("authorization")) throw new ApiError(401, "no_key", "Send an API key from zaisma.com/account as: Authorization: Bearer zsk_…");
    caller = await authenticate(request, env);
    caller.via = "mcp";
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return Response.json(rpcError(null, -32001, err.message), { status: err.status, headers: err.status === 401 ? { "WWW-Authenticate": 'Bearer realm="zaisma"' } : {} });
  }
  const call: ApiCall = (method, path, payload) => apiCall(env, caller, method, path, payload);
  return serveMcp(
    request,
    { name: "zaisma", title: "Zaisma", instructions: INSTRUCTIONS },
    TOOLS.map((t) => ({ ...t, run: (args: Record<string, unknown>) => t.run(args, call) })),
    (err) => {
      if (err instanceof ApiError) return `${err.message} (${err.code})`;
      // Our bug, not the AI's: say so, and ask for feedback so it reaches us with the details.
      console.error("MCP tool failed", err);
      return "Something went wrong on Zaisma's side (internal_error). Try once more; if it happens again, tell Zaisma with post_topic (kind bug): the tool, what you sent and this error.";
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
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** A tool result that also shows pictures. */
export class WithImages {
  constructor(
    readonly data: unknown,
    readonly images: { data: string; mimeType: string }[],
  ) {}
}

/**
 * Answers MCP messages for a set of tools: Streamable HTTP without sessions or streaming, each POST
 * one JSON-RPC message (or a batch). `userError` turns a tool's refusal into words for the AI, or
 * returns null for a real failure.
 */
export async function serveMcp(request: Request, server: { name: string; title: string; instructions: string }, tools: McpTool[], userError: (err: unknown) => string | null): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json(rpcError(null, -32600, "That message is too big."), { status: 413 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Send JSON-RPC as JSON."), { status: 400 });
  }

  const answer = async (msg: RpcMessage): Promise<unknown | null> => {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Not a JSON-RPC 2.0 request.");
    if (msg.id === undefined) return null; // A notification, like notifications/initialized.
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.title, version: "0.1.0", websiteUrl: "https://zaisma.com" },
          instructions: server.instructions,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: tools.map(({ run: _, ...t }) => t) });
      case "tools/call": {
        const tool = tools.find((t) => t.name === msg.params?.name);
        if (!tool) return rpcError(msg.id, -32602, `No tool called ${String(msg.params?.name)}.`);
        const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? (msg.params.arguments as Record<string, unknown>) : {};
        try {
          const result = await tool.run(args);
          const data = result instanceof WithImages ? result.data : result;
          const images = result instanceof WithImages ? result.images.map((i) => ({ type: "image", ...i })) : [];
          // Compact JSON: indenting costs the AI tokens and tells it nothing.
          return ok({ content: [{ type: "text", text: JSON.stringify(data) }, ...images], structuredContent: data });
        } catch (err) {
          const said = userError(err);
          if (said === null) throw err;
          return ok({ content: [{ type: "text", text: said }], isError: true });
        }
      }
      default:
        return rpcError(msg.id, -32601, `${msg.method} isn't supported.`);
    }
  };

  const headers = { "Cache-Control": "no-store" };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => answer(m as RpcMessage)))).filter((r) => r !== null);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202 });
  }
  const out = await answer(body as RpcMessage);
  return out === null ? new Response(null, { status: 202 }) : Response.json(out, { headers });
}
