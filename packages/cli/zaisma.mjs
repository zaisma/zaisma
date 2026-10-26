#!/usr/bin/env node
// The Zaisma upload command. No dependencies; Node 18 or newer (22.13 or newer for .sqlite files).
// Docs: https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#the-upload-command

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip } from "node:zlib";
import { CHECKED_TEXT_EXTENSIONS, GAME_FILE_EXTENSIONS, PRECOMPRESSED_EXTENSIONS, checkGameFiles, extensionOf, findOutsideReferences } from "./check.mjs";
import { assetHeadSizes } from "./performance.mjs";
import { findChrome, openChrome } from "./chrome.mjs";
import { SHADER_CHECK_PAGE, SHADER_LIMITS, isShaderCheckPassing, shaderCheckPageExpressions, shaderDraftAnswer, shaderRenderFromPage, shaderRenderInputOf } from "./shader-check.mjs";

const API = (process.env.ZAISMA_API || "https://zaisma.com").replace(/\/+$/, "");
const KEY = process.env.ZAISMA_KEY || "";
/** This command's version, sent as its user agent so a game's history can say "the upload command 0.10.0". */
const CLI_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
/** Files bigger than this go in parts; the server says how big each part is. */
const DIRECT_BYTES = 95 * 1024 * 1024;
// .zaisma-local holds what play-locally keeps (its keys, saves and database): never sent.
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX", ".git", "node_modules", ".zaisma-local"]);
/** How long upload waits for the scan (200 checks, 3 seconds apart) before it says it's still scanning. ZAISMA_SCAN_CHECK_INTERVAL_MS is for tests. */
const SCAN_CHECK_INTERVAL_MS = Number(process.env.ZAISMA_SCAN_CHECK_INTERVAL_MS) || 3000;
const SCAN_CHECK_COUNT = 200;
/** How long upload then waits for the version's run in Chrome (30 checks, 5 seconds apart); the same variable speeds it up in tests. */
const PERFORMANCE_CHECK_INTERVAL_MS = Number(process.env.ZAISMA_SCAN_CHECK_INTERVAL_MS) || 5000;
const PERFORMANCE_CHECK_COUNT = 30;
/** The most SQL database import sends at once (a single bigger statement goes on its own; the API takes up to 5 MB). ZAISMA_DUMP_PART_SIZE_BYTES is for tests. */
const DUMP_PART_SIZE_BYTES = Number(process.env.ZAISMA_DUMP_PART_SIZE_BYTES) || 4 * 1024 * 1024;
/** What upload downloads into a game from outside sites: at most this many files, each up to this size, each within this time. */
const MAXIMUM_OUTSIDE_FILE_COUNT = 500;
const MAXIMUM_OUTSIDE_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_SEC = 30;
/** Sent with those downloads, so font services answer with the woff2 fonts every browser games run in takes. */
const DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
/** Where upload puts the files it downloads, by site and path. */
const OUTSIDE_FOLDER = "zaisma-outside";
/** Files database export and import read and write as SQLite databases; any other name is SQL text. */
const SQLITE_EXTENSIONS = [".sqlite", ".sqlite3", ".db"];

/**
 * A shader's folder (zaisma shader, and zaisma check on a folder with image.glsl): its passes, by file name (null is the image pass,
 * otherwise the buffer's name), channels.json wiring each pass's iChannel0 to iChannel3, and the textures channels.json names. Nothing else.
 */
const SHADER_PASS_FILES = { "image.glsl": null, "buffer-a.glsl": "a", "buffer-b.glsl": "b", "buffer-c.glsl": "c", "buffer-d.glsl": "d" };
const CHANNELS_FILE = "channels.json";
const TEXTURE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
/** A channel in channels.json: the API's channel, with the texture named by its file in the folder (texture_file) instead of an image_id. */
const CHANNEL_FIELDS = ["channel_index", "input_kind", "buffer_name", "texture_file", "filter", "wrap"];
const CHANNELS_FILE_EXAMPLE = {
  image: [
    { channel_index: 0, input_kind: "buffer", buffer_name: "a" },
    { channel_index: 1, input_kind: "texture", texture_file: "noise.png", filter: "linear", wrap: "repeat" },
  ],
  "buffer-a": [{ channel_index: 0, input_kind: "buffer", buffer_name: "a" }],
};
const CHANNELS_FIX = `Give channels.json as an object of passes ("image", "buffer-a" to "buffer-d"), each a list of up to 4 channels, like ${JSON.stringify(CHANNELS_FILE_EXAMPLE)}; filter linear or nearest, wrap clamp or repeat. zaisma help shows it.`;
/** How long shader and check wait for a texture image a person has to approve (image matching couldn't answer): 20 checks, 3 seconds apart; ZAISMA_SCAN_CHECK_INTERVAL_MS speeds it up in tests. */
const TEXTURE_CHECK_INTERVAL_MS = Number(process.env.ZAISMA_SCAN_CHECK_INTERVAL_MS) || 3000;
const TEXTURE_CHECK_COUNT = 20;

/** The choices the API takes, checked before anything is sent (test/node/cli.test.ts holds them to the API's lists). */
const VISIBILITIES = ["listed", "unlisted", "private", "draft"];
const SCREENS = ["wide", "phone"];
const TOPIC_KINDS = ["bug", "gap", "feature", "question", "talk"];
const MESSAGE_KINDS = ["bug", "gap", "feature", "question"];
const FORUM_CATEGORIES = ["publishing", "scans", "pages", "rooms", "servers", "passes", "sdk", "saves", "stats", "mcp", "api", "cli", "accounts", "dashboard", "reports", "rules", "docs", "other"];

/** What the command ends with, the same for every command, so scripts and CI can tell the outcomes apart. */
const EXIT_CODES = {
  done: { exitCode: 0, meaning: "Done. For upload: the version passed the scan." },
  failed: { exitCode: 1, meaning: "It didn't work: Zaisma refused the call or couldn't be reached. The error says why and what to do." },
  wrong_command: { exitCode: 2, meaning: "The command line is wrong (an unknown command, flag or choice, or a missing argument), so nothing was sent." },
  held: { exitCode: 3, meaning: "upload: the version is held for a person at Zaisma to look at, usually within a day." },
  rejected: { exitCode: 4, meaning: "upload: the version was rejected. Its review_reason and findings say why and how to fix it." },
  still_scanning: { exitCode: 5, meaning: "upload: the version was still being scanned after 10 minutes. Check it later with zaisma versions <slug>." },
  problems_found: { exitCode: 6, meaning: "check: something in the game won't work on Zaisma as it is, and the upload command doesn't fix it; or the shader doesn't compile, is too slow or flashes. The problems say what and how to fix it." },
};

/** The errors only the command itself answers with; every other code is the API's (ERROR_CODES in packages/core/src/errors.ts). */
const COMMAND_ERROR_CODES = {
  unknown_command: "There's no command by that name.",
  renamed_command: "The command has a new name; the error names it.",
  renamed_field: "The flag has a new name; the error names it.",
  repeated_field: "A flag was given twice.",
  missing_value: "A flag that takes a value was given none.",
  takes_no_value: "A flag that takes no value was given one.",
  conflicting_flags: "Two flags that don't go together were given, like logs --follow and --cursor.",
  not_a_folder: "The folder to check or upload isn't a folder.",
  not_a_file: "The file given (of statements, a dump to import, or a save) can't be read.",
  file_exists: "database export won't write over a file that's already there.",
  folder_not_empty: "export saves only into a new or empty folder.",
  needs_newer_node: "Reading or writing a .sqlite file needs Node 22.13 or newer, and drawing a shader in a local Chrome Node 22.",
  not_a_database: "The .sqlite file to import isn't a SQLite database.",
  unknown_link: "links remove: the game has no link by that name.",
  outside_file_unreachable: "upload: a file the game loads from an outside site couldn't be downloaded, so nothing was sent.",
  too_many_outside_files: "upload: the game loads more than 500 files from outside sites, so nothing was sent.",
  unpack_failed: "upload: a pre-compressed file couldn't be unpacked, so nothing was sent.",
  no_image_pass: "shader: the folder has no image.glsl, the shader's image pass.",
  unknown_shader_file: "A file in a shader's folder isn't one the command reads, or no channel in channels.json names it.",
  bad_channels_file: "A shader's channels.json isn't JSON, or isn't an object of the folder's passes, each a list of channels.",
  shader_texture_not_approved: "shader, check: a texture sent for the shader was rejected, or still waits for a person, so the shader wasn't sent.",
  no_chrome: "check: there's no Chrome on this computer to draw the shader in, and no --game with ZAISMA_KEY to draw it on Zaisma.",
  local_chrome_failed: "check: the Chrome on this computer couldn't draw the shader.",
  game_server_not_run: "play-locally: npx couldn't run @zaisma/game-server, which runs the game on this computer.",
  server_unreachable: "Zaisma couldn't be reached: no connection, or a wrong ZAISMA_API.",
  unexpected_answer: "Zaisma answered without JSON, like a page from a network in between.",
};

const BY_ME = { hasValue: false, about: "Mark it as written by you; otherwise it says your AI wrote it" };
const TEXT = { hasValue: true, placeholder: '"…"', about: "The text, in markdown; or pipe it in" };
const KEYS = { hasValue: true, placeholder: "'[…]'", about: 'Only these localStorage keys, as a JSON list, like \'["coins", "level"]\'' };
const KIND_ABOUT = "bug (something doesn't work), gap (a limit or missing piece blocks you), feature (an idea), question";

/**
 * Every command, with the arguments and flags it takes. Nothing else is taken: an unknown flag, a
 * choice that isn't one, or an argument too many is refused before anything is sent.
 */
const COMMANDS = {
  games: { about: "List your games", arguments: [], flags: {} },
  new: { about: "Make a game (it starts as a draft)", arguments: [{ name: "title", isRest: true }], flags: { slug: { hasValue: true, placeholder: "<slug>", about: "Its link name, as in zaisma.com/g/<slug>; made from the title if left out" } } },
  check: {
    about:
      "Check a game's folder for anything Zaisma refuses or that won't work on Zaisma, with how to fix each, before anything is sent; needs no key. " +
      "On a shader's folder (one with image.glsl, below), draw it as Zaisma's check does, in the Chrome on this computer (CHROME_PATH, the system's, or one Playwright or @puppeteer/browsers downloaded), " +
      "saving its sheet picture beside the folder; with no Chrome, on Zaisma with --game and ZAISMA_KEY (up to 100 a day)",
    arguments: [{ name: "folder" }],
    flags: {
      game: { hasValue: true, placeholder: "<slug>", about: "The game it's for, so the fixes name it (and, with ZAISMA_KEY set, so its own servers count); for a shader's folder with no Chrome here, the game to draw it on Zaisma for" },
      screen: { hasValue: true, choices: SCREENS, about: "A shader's folder only: the screen to draw it for, wide (desktops and tablets; the default) or phone" },
      "draw-on-zaisma": { hasValue: false, about: "A shader's folder only: draw it on Zaisma's own renderer, with --game and ZAISMA_KEY, even when there's a Chrome here" },
    },
  },
  "play-locally": {
    about:
      "Play your game on this computer, with its game server and a test bench: Add a player opens another tab as someone else, so you play together, with made-up accounts, friends, blocks and items between them, and a test sheet that grants items at no cost; " +
      "needs no key and no internet. A file change reloads the game; a change to the game server starts it again with its rooms kept. It runs @zaisma/game-server's play-locally",
    arguments: [{ name: "folder", isOptional: true }],
    flags: {
      port: { hasValue: true, placeholder: "<port>", about: "The first of four ports, 4800 unless given: the bench, the game's site, the stand-in rooms and your game server take it and the next three" },
      game: { hasValue: true, placeholder: "<slug>", about: "The game's slug; with ZAISMA_KEY set, the first start copies its real items in once" },
      "on-network": { hasValue: false, about: "Let a phone on the same Wi-Fi open the bench too; it prints the address and a QR code" },
      "no-open": { hasValue: false, about: "Don't open the bench in the browser" },
    },
  },
  upload: {
    about: "Upload a version; only changed files are sent. It runs the check first, and downloads files the game loads from outside sites and unpacks pre-compressed builds in what it sends, never in the folder",
    arguments: [{ name: "folder" }],
    flags: {
      game: { hasValue: true, isRequired: true, placeholder: "<slug>", about: "The game to upload to" },
      "patch-notes": { hasValue: true, placeholder: '"…"', about: "What changed, shown with the update" },
      "publish-when-approved": { hasValue: false, about: "Go live as soon as it passes review" },
      "match-update-mode": { hasValue: true, placeholder: "<next_match|now>", about: "With --publish-when-approved: when running matches get it: next_match (they finish on the version they started; the default) or now (every live match switches within seconds, in the same room)" },
    },
  },
  shader: {
    about:
      "Send a shader for a game's background from its folder (below): each texture goes as an image of kind shader_texture (one the game has already, byte for byte, is used again) and is waited for, " +
      "then the shader; Zaisma checks it in a minute or two, then set_background or the dashboard shows it",
    arguments: [{ name: "folder" }],
    flags: {
      game: { hasValue: true, isRequired: true, placeholder: "<slug>", about: "The game it's for" },
      screen: { hasValue: true, isRequired: true, choices: SCREENS, about: "wide (desktops and tablets) or phone (composed for a tall screen)" },
    },
  },
  versions: { about: "List a game's versions and preview links", arguments: [{ name: "slug" }], flags: {} },
  publish: {
    about: "Publish a version that passed, or roll back to an older one",
    arguments: [{ name: "slug" }, { name: "version_id" }],
    flags: {
      "scheduled-publish-at": { hasValue: true, placeholder: "<time>", about: 'Publish later instead: an ISO 8601 time with Z or an offset, like "2026-11-01T17:00:00Z" or "2026-11-01T17:00+01:00"' },
      "match-update-mode": { hasValue: true, placeholder: "<next_match|now>", about: "When running matches get it: next_match (they finish on the version they started; the default) or now (every live match switches within seconds, in the same room)" },
    },
  },
  unschedule: { about: "Cancel a publish-later", arguments: [{ name: "slug" }, { name: "version_id" }], flags: {} },
  visibility: { about: "Set who can see a game: everyone (listed), people with the link (unlisted), or only you and tester links (private, draft)", arguments: [{ name: "slug" }, { name: "visibility", choices: VISIBILITIES }], flags: {} },
  "allowed-hosts": {
    about: "The hosts a game's server can call with fetch(), like discord.com or *.example.com; given hosts, set the whole list",
    arguments: [{ name: "slug" }, { name: "hosts", isRest: true, isOptional: true }],
    flags: { none: { hasValue: false, about: "Set the list to none: the game server calls no other servers" } },
  },
  "own-servers": {
    about: "Your own servers the game connects to from players' browsers, like wss://play.example.com, named in the game's menu; given addresses, set the whole list",
    arguments: [{ name: "slug" }, { name: "urls", isRest: true, isOptional: true }],
    flags: { none: { hasValue: false, about: "Set the list to none: the game uses no servers of its own" } },
  },
  links: { about: "A game's registered links, which it opens with Zaisma.links.open: each name, address and who it opens for", arguments: [{ name: "slug" }], flags: {} },
  "links set": {
    about: "Add a link, or change the one with the same name",
    arguments: [{ name: "slug" }, { name: "link_name" }, { name: "destination_url" }],
    flags: { "on-game-page": { hasValue: false, about: "Show it on the game page too" } },
  },
  "links remove": { about: "Remove a link: the game can't open it any more", arguments: [{ name: "slug" }, { name: "link_name" }], flags: {} },
  secrets: { about: "A game's secrets, which its game server reads as server.secrets and room.secrets: their names and when each was set, never the values", arguments: [{ name: "slug" }], flags: {} },
  "secrets set": { about: "Set a secret for a game's server, replacing one of the same name: the value piped in, or typed without showing; it's never shown again", arguments: [{ name: "slug" }, { name: "secret_name" }], flags: {} },
  "secrets delete": { about: "Delete one of a game's secrets", arguments: [{ name: "slug" }, { name: "secret_name" }], flags: {} },
  items: { about: "What a game sells or grants: each item's name, kind, category and price, and the game's refund policy", arguments: [{ name: "slug" }], flags: {} },
  "items set": {
    about: "Make a game's items match a JSON file (or piped in) of the whole list, as list_items answers its items: each changed item is set, and each one missing from the file removed, unless players own it",
    arguments: [{ name: "slug" }, { name: "file", isOptional: true }],
    flags: {},
  },
  "items remove": { about: "Remove an item nobody bought or was granted", arguments: [{ name: "slug" }, { name: "item_name" }], flags: {} },
  "kept-rooms": { about: "A game's kept rooms (room.setKept), worlds that sleep with nobody in them: each one's code, name, size and when it was last played, and the game's storage", arguments: [{ name: "slug" }], flags: {} },
  "kept-rooms delete": { about: "Delete a kept room's world for good; players in it are sent out", arguments: [{ name: "slug" }, { name: "room_code" }], flags: {} },
  logs: {
    about: "What a game's server printed on Zaisma in the last 30 days, oldest first: the newest lines, older ones with --cursor, or new ones as they come with --follow",
    arguments: [{ name: "slug" }],
    flags: {
      follow: { hasValue: false, about: "Keep printing new lines as the game server prints them, every 2 seconds, until Ctrl-C" },
      "room-code": { hasValue: true, placeholder: "<code>", about: "Only lines printed in this room, like K7Q2MX" },
      "minimum-level": { hasValue: true, choices: ["debug", "info", "warn", "error"], about: "debug (everything), info (all but debug), warn (warnings and errors) or error" },
      "source-kind": { hasValue: true, choices: ["room", "request", "schedule", "webhook"], about: "Only lines printed in a room, onRequest, onSchedule or onWebhook" },
      "search-text": { hasValue: true, placeholder: '"words"', about: "Only lines containing this, ignoring case" },
      "maximum-line-count": { hasValue: true, placeholder: "<count>", about: "How many lines at most, up to 500; 100 by default" },
      cursor: { hasValue: true, placeholder: "<next_cursor>", about: "The lines before an earlier answer's: the next_cursor it printed" },
    },
  },
  forum: {
    about: "Your forum topics and messages to Zaisma; one topic with every post you can see; or a search",
    arguments: [{ name: "topic_id", isOptional: true }],
    flags: { search: { hasValue: true, placeholder: '"words"', about: "Search the forum's topics, answers and known issues" } },
  },
  "forum post": {
    about: "Start a public topic in the developer forum",
    arguments: [],
    flags: {
      kind: { hasValue: true, isRequired: true, choices: TOPIC_KINDS, about: `${KIND_ABOUT} or talk (a discussion)` },
      title: { hasValue: true, isRequired: true, placeholder: '"…"', about: "The topic's title" },
      category: { hasValue: true, isRequired: true, choices: FORUM_CATEGORIES, placeholder: "<category>", about: "Where in Zaisma it belongs (the categories are below)" },
      text: TEXT,
      "by-me": BY_ME,
    },
  },
  "forum message": {
    about: "A private message to Zaisma: only you and Zaisma see it",
    arguments: [],
    flags: {
      kind: { hasValue: true, isRequired: true, choices: MESSAGE_KINDS, about: KIND_ABOUT },
      title: { hasValue: true, isRequired: true, placeholder: '"…"', about: "The message's title" },
      text: TEXT,
      category: { hasValue: true, choices: FORUM_CATEGORIES, placeholder: "<category>", about: "Where in Zaisma it belongs (the categories are below)" },
      game: { hasValue: true, placeholder: "<slug>", about: "The game it's about" },
      "by-me": BY_ME,
    },
  },
  "forum reply": {
    about: "Reply to a topic, or reopen yours when something fixed is back",
    arguments: [{ name: "topic_id" }],
    flags: { text: TEXT, reopen: { hasValue: false, about: "Reopen your topic: something fixed is back" }, "by-me": BY_ME },
  },
  database: { about: "A game's own database: its tables and indexes, and this month's use against the free limits", arguments: [{ name: "slug" }], flags: {} },
  "database query": {
    about: "Run one SQL statement on a game's database, live; the SQL as an argument or piped in",
    arguments: [{ name: "slug" }, { name: "sql", isOptional: true }],
    flags: { values: { hasValue: true, placeholder: "'[…]'", about: 'The values for the ?s, as a JSON list: text, numbers, null or { "blob_base64": "…" }, like \'["player_8f3k2m", 1200]\'' } },
  },
  "database batch": {
    about: "Run SQL statements on a game's database in one transaction: all of them happen, or none",
    arguments: [{ name: "slug" }, { name: "file", isOptional: true }],
    flags: {},
  },
  "database export": {
    about: "Save a game's whole database: as SQLite's SQL dump (a .sql file, or printed), or as a ready .sqlite file, like the one the Node runner uses",
    arguments: [{ name: "slug" }, { name: "file", isOptional: true }],
    flags: {},
  },
  "database import": {
    about: "Add a SQL dump (a .sql file, or piped in) or a .sqlite file to a game's database, live, in parts of up to 4 MB: each part all or nothing",
    arguments: [{ name: "slug" }, { name: "file", isOptional: true }],
    flags: {},
  },
  "database restore": {
    about: "Put a game's database back as it was at a moment in the last 30 days (an ISO time, like 2026-10-18T14:05:00Z), live; undo it with database undo-restore",
    arguments: [{ name: "slug" }, { name: "restore_to_at" }],
    flags: {},
  },
  "database undo-restore": { about: "Undo a restore of a game's database: back to just before it, live", arguments: [{ name: "slug" }, { name: "database_restore_id" }], flags: {} },
  saves: {
    about: "The players with a cloud save in a game, by player ID, 100 a page",
    arguments: [{ name: "slug" }],
    flags: { cursor: { hasValue: true, placeholder: "<next_cursor>", about: "The page after an earlier one: the next_cursor it printed" } },
  },
  "saves get": { about: "One player's cloud save: its localStorage keys and IndexedDB databases", arguments: [{ name: "slug" }, { name: "player_id" }], flags: { keys: KEYS } },
  "saves change": {
    about: "Set or remove some localStorage keys in a player's save; a JSON object of keys and their text (null removes one), as an argument or piped in",
    arguments: [{ name: "slug" }, { name: "player_id" }, { name: "items_json", isOptional: true }],
    flags: {},
  },
  "saves replace": {
    about: "Replace a player's whole save with a JSON file (or piped in) of local_storage_items and indexeddb_databases, like zaisma saves get --json printed",
    arguments: [{ name: "slug" }, { name: "player_id" }, { name: "file", isOptional: true }],
    flags: {},
  },
  "saves reset": { about: "Reset a player's save: it becomes empty, and the game starts fresh on every device", arguments: [{ name: "slug" }, { name: "player_id" }], flags: {} },
  "saves copies": { about: "A player's earlier versions of their save, newest first, with why each was kept", arguments: [{ name: "slug" }, { name: "player_id" }], flags: {} },
  "saves copy": { about: "One earlier version of a player's save", arguments: [{ name: "slug" }, { name: "player_id" }, { name: "save_copy_id" }], flags: { keys: KEYS } },
  "saves restore": { about: "Make an earlier version a player's save again", arguments: [{ name: "slug" }, { name: "player_id" }, { name: "save_copy_id" }], flags: {} },
  export: {
    about: "Save everything about a game in a folder: every version that passed review, the cover and screenshots, the database (as SQL and a ready .sqlite file), every player's save, stats, reports and history",
    arguments: [{ name: "slug" }],
    flags: { folder: { hasValue: true, placeholder: "<folder>", about: "Where to save it: a new or empty folder; ./<slug>-export if left out" } },
  },
  help: { about: "This help; with --json, every command, flag, exit code and error code", arguments: [], flags: {} },
};
/** Commands with a second word, like zaisma forum post. */
const SUBCOMMANDS = { links: ["set", "remove"], forum: ["post", "message", "reply"], database: ["query", "batch", "export", "import", "restore", "undo-restore"], saves: ["get", "change", "replace", "reset", "copies", "copy", "restore"], secrets: ["set", "delete"], items: ["set", "remove"], "kept-rooms": ["delete"] };
/** Flags every command takes. */
const GLOBAL_FLAGS = {
  json: { hasValue: false, about: "Print the API's answer as JSON, as-is (on failure its { error }), and nothing else" },
  help: { hasValue: false, about: "This help" },
};
/** Commands and flags renamed (docs/NAMING.md): said out loud, so an old one isn't quietly taken for something else. */
const RENAMED_COMMANDS = {
  show: { command: "visibility", fix: (words) => `Run: zaisma visibility ${words[0] ?? "<slug>"} ${words.find((word, i) => words[i - 1] === "--visibility") ?? VISIBILITIES.join("|")}` },
  feedback: { command: "forum", fix: () => "zaisma forum lists your topics; zaisma forum message sends Zaisma a private message." },
};
const RENAMED_FLAGS = { notes: "patch-notes", publish: "publish-when-approved", at: "scheduled-publish-at" };

/** A failure in the API's error shape (docs/NAMING.md, Errors), with the exit code it ends with. */
class CommandError extends Error {
  constructor(error, exitCode) {
    super(error.message);
    this.error = error;
    this.exitCode = exitCode;
  }
}

function refuse(code, { message, field = null, fix, retryAfterSec = null }, exit = EXIT_CODES.wrong_command) {
  throw new CommandError({ code, message, field, fix, retry_after_sec: retryAfterSec }, exit.exitCode);
}

let isJson = false;
/** A line for people. With --json, stdout holds only the JSON, so progress goes to stderr. */
const say = (line) => (isJson ? console.error(line) : console.log(line));
const printJson = (answer) => console.log(JSON.stringify(answer));
/** --json: the API's answer as-is, compact (docs/NAMING.md, Outputs). */
const printAnswer = (answer) => {
  printJson(answer);
  return EXIT_CODES.done;
};

const flagList = (names) => names.map((name) => `--${name}`).join(", ");
const usage = (command) => {
  const { arguments: commandArguments, flags } = COMMANDS[command];
  const argumentWords = commandArguments.map((argument) => (argument.choices ? argument.choices.join("|") : argument.isOptional ? `[<${argument.name}>]` : `<${argument.name}>`));
  const flagWords = Object.entries(flags).map(([name, flag]) => {
    const word = `--${name}${flag.hasValue ? ` ${flag.placeholder ?? flag.choices.join("|")}` : ""}`;
    return flag.isRequired ? word : `[${word}]`;
  });
  return ["zaisma", command, ...argumentWords, ...flagWords].join(" ");
};

/** How far apart two words are, in letters, to suggest the flag that was meant. */
function editDistance(first, second) {
  let previous = Array.from({ length: second.length + 1 }, (_, i) => i);
  for (let i = 1; i <= first.length; i++) {
    const current = [i];
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex++) {
      current[secondIndex] = Math.min(previous[secondIndex] + 1, current[secondIndex - 1] + 1, previous[secondIndex - 1] + (first[i - 1] === second[secondIndex - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[second.length];
}

/** The command, its arguments by name and its flags, or a refusal saying exactly what's wrong. */
function parseCommandLine(argv) {
  const words = [];
  const globalFlags = { json: false, help: false };
  for (const word of argv) {
    if (word === "--json") globalFlags.json = true;
    else if (word === "--help" || word === "-h") globalFlags.help = true;
    else words.push(word);
  }
  isJson = globalFlags.json;
  if (!words.length || words[0] === "help") return { command: "help", values: {}, flags: {}, globalFlags, rest: words.slice(1) };
  const isSubcommand = Boolean(SUBCOMMANDS[words[0]]?.includes(words[1]));
  const command = isSubcommand ? `${words[0]} ${words[1]}` : words[0];
  const rest = words.slice(isSubcommand ? 2 : 1);
  if (RENAMED_COMMANDS[command]) {
    const renamed = RENAMED_COMMANDS[command];
    refuse("renamed_command", { message: `zaisma ${command} is now zaisma ${renamed.command}.`, fix: renamed.fix(rest) });
  }
  const spec = COMMANDS[command];
  if (!spec) refuse("unknown_command", { message: `There's no command "${command}".`, fix: `Run zaisma help. The commands: ${Object.keys(COMMANDS).join(", ")}.` });
  if (globalFlags.help) return { command, values: {}, flags: {}, globalFlags, rest };

  const takenFlags = { ...spec.flags, ...GLOBAL_FLAGS };
  const takesText = `zaisma ${command} takes ${Object.keys(spec.flags).length ? `${flagList(Object.keys(spec.flags))} and ` : "only "}--json.`;
  const positionals = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith("-") || word === "-") {
      positionals.push(word);
      continue;
    }
    const equalsAt = word.startsWith("--") ? word.indexOf("=") : -1;
    const written = equalsAt === -1 ? word : word.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : word.slice(equalsAt + 1);
    const name = written.replace(/^--?/, "");
    if (RENAMED_FLAGS[name]) refuse("renamed_field", { message: `--${name} is now --${RENAMED_FLAGS[name]}.`, field: written, fix: `Write --${RENAMED_FLAGS[name]} instead.` });
    const flag = written.startsWith("--") ? spec.flags[name] : undefined;
    if (!flag) {
      const meant = Object.keys(takenFlags).find((candidate) => editDistance(candidate, name) <= 2);
      refuse("unknown_field", { message: `zaisma ${command} doesn't take ${written}.`, field: written, fix: `${meant ? `Did you mean --${meant}? ` : ""}${takesText}` });
    }
    if (name in flags) refuse("repeated_field", { message: `${written} is given twice.`, field: written, fix: `Give ${written} once.` });
    if (!flag.hasValue) {
      if (inlineValue !== undefined) refuse("takes_no_value", { message: `${written} takes no value.`, field: written, fix: `Write ${written} on its own to switch it on, or leave it out.` });
      flags[name] = true;
      continue;
    }
    const flagValue = inlineValue ?? (rest[i + 1] !== undefined && !rest[i + 1].startsWith("--") ? rest[++i] : undefined);
    if (flagValue === undefined || flagValue === "") refuse("missing_value", { message: `${written} needs a value.`, field: written, fix: `Give it one: ${usage(command)}` });
    if (flag.choices && !flag.choices.includes(flagValue)) refuse(`bad_${name.replaceAll("-", "_")}`, { message: `${written} ${JSON.stringify(flagValue)} isn't one of the choices.`, field: written, fix: `Give one of: ${flag.choices.join(", ")}.` });
    flags[name] = flagValue;
  }

  const values = {};
  spec.arguments.forEach((argument, i) => {
    const argumentValue = argument.isRest ? positionals.slice(i).join(" ") : positionals[i];
    if (!argumentValue) {
      if (!argument.isOptional) refuse("missing_field", { message: `zaisma ${command} needs the ${argument.choices ? argument.name : `<${argument.name}>`}.`, field: argument.name, fix: `Run it as: ${usage(command)}` });
      return;
    }
    if (argument.choices && !argument.choices.includes(argumentValue)) refuse(`bad_${argument.name}`, { message: `${argument.name} ${JSON.stringify(argumentValue)} isn't one of the choices.`, field: argument.name, fix: `Give one of: ${argument.choices.join(", ")}.` });
    values[argument.name] = argumentValue;
  });
  const takenArgumentCount = spec.arguments.some((argument) => argument.isRest) ? positionals.length : spec.arguments.length;
  if (positionals.length > takenArgumentCount) {
    refuse("unknown_field", { message: `zaisma ${command} takes ${takenArgumentCount || "no"} argument${takenArgumentCount === 1 ? "" : "s"}; "${positionals[takenArgumentCount]}" is one too many.`, fix: `Run it as: ${usage(command)} (put a value with spaces in quotes).` });
  }
  for (const [name, flag] of Object.entries(spec.flags)) {
    if (flag.isRequired && !(name in flags)) refuse("missing_field", { message: `zaisma ${command} needs --${name}.`, field: `--${name}`, fix: `Run it as: ${usage(command)}` });
  }
  return { command, values, flags, globalFlags, rest };
}

/** A shader's folder, as zaisma shader and zaisma check read it. */
const SHADER_FOLDER_HELP = [
  "A shader's folder (zaisma shader, zaisma check):",
  "  image.glsl                 The image pass, Shadertoy's form in WebGL2's GLSL: void mainImage(out vec4 fragColor, in vec2 fragCoord) { … }.",
  "  buffer-a.glsl … buffer-d.glsl  Buffers, if any: each drawn to a picture kept between frames, a to d, before the image pass.",
  "  channels.json              If any pass reads a channel: what each pass's iChannel0 to iChannel3 read, by pass (image, buffer-a … buffer-d).",
  "                             Each channel is the API's, with the texture named by its file in the folder (texture_file) instead of an image_id:",
  `                             ${JSON.stringify(CHANNELS_FILE_EXAMPLE)}`,
  "                             channel_index 0 to 3, each once in a pass; input_kind buffer (with buffer_name a to d, a buffer file in the folder) or texture (with texture_file);",
  "                             filter linear (the default; a texture's with mipmaps) or nearest; wrap clamp (a buffer's default) or repeat (a texture's).",
  `  *.png, *.jpg, *.webp       The textures channels.json names: up to ${SHADER_LIMITS.maximumShaderTextureCount}, each up to ${SHADER_LIMITS.maximumTextureSizeBytes / 1048576} MB and ${SHADER_LIMITS.maximumTextureSidePx} px a side.`,
  "  Any other file, a texture no channel names, or a field channels.json doesn't take is refused before anything is sent; hidden files are left out.",
];

function helpText() {
  const lines = ["Usage:"];
  for (const command of Object.keys(COMMANDS)) {
    const { about, flags } = COMMANDS[command];
    lines.push(`  ${usage(command)}`, `      ${about}.`);
    for (const [name, flag] of Object.entries(flags)) lines.push(`      --${name}: ${flag.about}.`);
  }
  lines.push(
    "",
    "Every command takes --json: it prints the API's answer as-is (on failure, its { error }) and nothing else.",
    "Categories: " + FORUM_CATEGORIES.join(", ") + ".",
    "",
    ...SHADER_FOLDER_HELP,
    "",
    "Exit codes:",
    ...Object.values(EXIT_CODES).map((exit) => `  ${exit.exitCode}  ${exit.meaning}`),
    "",
    "Set ZAISMA_KEY to an API key from https://zaisma.com/account (under Game developers).",
    "Without installing: npx @zaisma/cli <command>. Installed (npm i -g @zaisma/cli): zaisma <command>.",
  );
  return lines.join("\n");
}

/** help --json: the commands, flags, exit codes and the command's own error codes, for an AI to read instead of the help. */
function helpAnswer() {
  const flagAnswer = ([name, flag]) => ({ flag: `--${name}`, has_value: flag.hasValue, is_required: Boolean(flag.isRequired), choices: flag.choices ?? null, about: flag.about });
  return {
    commands: Object.entries(COMMANDS).map(([command, spec]) => ({
      command,
      usage: usage(command),
      about: spec.about,
      arguments: spec.arguments.map((argument) => ({ name: argument.name, is_required: !argument.isOptional, is_rest: Boolean(argument.isRest), choices: argument.choices ?? null })),
      flags: Object.entries(spec.flags).map(flagAnswer),
    })),
    global_flags: Object.entries(GLOBAL_FLAGS).map(flagAnswer),
    shader_folder: {
      pass_files: Object.keys(SHADER_PASS_FILES),
      channels_file: CHANNELS_FILE,
      channel_fields: CHANNEL_FIELDS,
      channels_file_example: CHANNELS_FILE_EXAMPLE,
      texture_extensions: TEXTURE_EXTENSIONS,
    },
    exit_codes: Object.entries(EXIT_CODES).map(([name, exit]) => ({ exit_code: exit.exitCode, name, meaning: exit.meaning })),
    error_codes: Object.entries(COMMAND_ERROR_CODES).map(([code, meaning]) => ({ code, meaning })),
  };
}

async function api(method, path, body) {
  if (!KEY) refuse("no_key", { message: "ZAISMA_KEY isn't set.", field: "ZAISMA_KEY", fix: "Make an API key at https://zaisma.com/account (under Game developers) and set it: export ZAISMA_KEY=zsk_…" }, EXIT_CODES.failed);
  let response;
  try {
    response = await fetch(`${API}/api/dev${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "x-zaisma-client": "cli", "user-agent": `zaisma-cli/${CLI_VERSION}`, ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}) },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    refuse("server_unreachable", { message: `Couldn't reach ${API}: ${error.cause?.message ?? error.message}.`, field: process.env.ZAISMA_API ? "ZAISMA_API" : null, fix: "Check the internet connection (and ZAISMA_API, if it's set), then run it again." }, EXIT_CODES.failed);
  }
  const answer = await response.json().catch(() => null);
  if (answer?.error) throw new CommandError(answer.error, EXIT_CODES.failed.exitCode);
  if (!response.ok || !answer) refuse("unexpected_answer", { message: `Zaisma answered ${response.status} without JSON.`, fix: "Run it again in a minute. If it keeps happening, tell Zaisma: zaisma forum message --kind bug --category cli.", retryAfterSec: 60 }, EXIT_CODES.failed);
  return answer;
}

/** The game's files, without junk; hidden ones (a name starting with a dot) are listed apart, since they're never uploaded. */
async function walk(root) {
  const files = [];
  const hiddenPaths = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (JUNK.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.name.startsWith(".")) {
        hiddenPaths.push(relative(root, full).split(sep).join("/"));
        continue;
      }
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await visit(root);
  return { files, hiddenPaths };
}

/**
 * A game's folder for the check and the upload: each file's path, where it is, its size and, for the checked text
 * files, its text; and for the notes on files that could be smaller, the first bytes of images, sounds and models.
 */
async function readGameFolder(folder) {
  if (!(await stat(folder).catch(() => null))?.isDirectory()) refuse("not_a_folder", { message: `${folder} isn't a folder.`, field: "folder", fix: "Give the folder with the game's index.html at the top, like ./build." });
  const { files: fullPaths, hiddenPaths } = await walk(folder);
  const files = [];
  for (const full of fullPaths) {
    const path = relative(folder, full).split(sep).join("/");
    files.push({ path, full, sizeBytes: (await stat(full)).size, contentText: CHECKED_TEXT_EXTENSIONS.includes(extensionOf(path)) ? await readFile(full, "utf8") : null });
  }
  const headSizes = assetHeadSizes(files);
  for (const file of files) {
    if (file.contentText !== null || !headSizes.has(file.path)) continue;
    const handle = await open(file.full, "r");
    try {
      const headBytes = new Uint8Array(headSizes.get(file.path));
      const { bytesRead: readByteCount } = await handle.read(headBytes, 0, headBytes.length, 0);
      file.headBytes = headBytes.subarray(0, readByteCount);
    } finally {
      await handle.close();
    }
  }
  return { files, hiddenPaths };
}

/**
 * The check on a folder's files (hidden ones included, so it can say they're left out). With the game named
 * and a key set, a game that connects to outside addresses is checked against its own servers too; with no
 * key, nothing is sent.
 */
async function checkGame({ files, hiddenPaths }, slug) {
  const checked = [...files, ...hiddenPaths.map((path) => ({ path, sizeBytes: 0, contentText: null }))];
  const answer = checkGameFiles(checked, { slug });
  if (!slug || !KEY || !answer.problems.some((problem) => problem.code === "outside_address")) return answer;
  const { game } = await api("GET", `/games/${slug}`);
  return checkGameFiles(checked, { slug, ownServerUrls: game.own_server_urls });
}

const PROBLEM_GROUPS = [
  { heading: "Zaisma refuses the upload until these are fixed:", isIn: (problem) => problem.problem_kind === "refused" && !problem.is_fixed_by_upload_command },
  { heading: "These won't work on Zaisma:", isIn: (problem) => problem.problem_kind === "broken" && !problem.is_fixed_by_upload_command },
  { heading: "zaisma upload fixes these itself:", isIn: (problem) => problem.is_fixed_by_upload_command },
];

/** The check's problems for people, in groups, each with its code and fix. */
function printProblems(problems, groups = PROBLEM_GROUPS) {
  for (const group of groups) {
    const inGroup = problems.filter(group.isIn);
    if (!inGroup.length) continue;
    say(group.heading);
    for (const problem of inGroup) {
      // What the upload fixes needs only saying; the rest needs where it is and what to do.
      if (problem.is_fixed_by_upload_command) say(`  - ${problem.message} [${problem.code}]`);
      else say(`  - ${problem.message} [${problem.code}]${problem.quote ? `\n    Where: ${problem.quote}` : ""}\n    Fix: ${problem.fix}`);
    }
  }
}

/** Notes on files that could be much smaller: never a problem, so they never change the exit code. */
function printSmallerNotes(notes) {
  if (!notes.length) return;
  say("Could be smaller:");
  for (const note of notes) say(`  · ${note.message} Fix: ${note.fix}`);
}

/** zaisma check: the problems, or the answer with --json. Ends with problems_found when one isn't fixed by the upload command. */
async function checkFolder({ folder }, flags) {
  if ((await stat(join(folder, "image.glsl")).catch(() => null))?.isFile()) return checkShaderFolder(folder, flags);
  for (const name of ["screen", "draw-on-zaisma"]) {
    if (flags[name]) refuse("unknown_field", { message: `--${name} is only for a shader's folder, and ${folder} has no image.glsl.`, field: `--${name}`, fix: `Leave --${name} out to check a game's folder, or give a shader's folder (zaisma help shows one).` });
  }
  const answer = await checkGame(await readGameFolder(folder), flags.game ?? null);
  const hasProblems = answer.problems.some((problem) => !problem.is_fixed_by_upload_command);
  if (isJson) printJson(answer);
  else {
    printProblems(answer.problems);
    if (answer.omitted_problem_count) console.log(`…and ${answer.omitted_problem_count} more.`);
    printSmallerNotes(answer.performance_notes);
    console.log(
      hasProblems
        ? "Fix what's above, then check again."
        : `Ready to upload: ${answer.file_count} files, ${readableSize(answer.size_bytes)}. Upload with: zaisma upload ${folder} --game ${flags.game ?? "<slug>"}`,
    );
  }
  return hasProblems ? EXIT_CODES.problems_found : EXIT_CODES.done;
}

// --- Shaders ------------------------------------------------------------------------------------------------------------------

const isPlainObject = (given) => typeof given === "object" && given !== null && !Array.isArray(given);
/** A texture's kind by its first bytes: PNG, JPEG or WebP, or null. */
const textureTypeOf = (bytes) =>
  bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    ? "png"
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "jpeg"
      : String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
        ? "webp"
        : null;

/**
 * A shader's folder, read and checked closed before anything is sent or drawn: { manifest, textures }. The manifest is the API's shape
 * with each texture channel naming its file (texture_file); textures are the files channels.json names, each { textureFile, bytes }.
 */
async function readShaderFolder(folder) {
  if (!(await stat(folder).catch(() => null))?.isDirectory()) refuse("not_a_folder", { message: `${folder} isn't a folder.`, field: "folder", fix: "Give the shader's folder, with its image.glsl at the top." });
  const fileFix = (name) => `A shader's folder holds ${Object.keys(SHADER_PASS_FILES).join(", ")}, ${CHANNELS_FILE} and the textures it names (${TEXTURE_EXTENSIONS.map((extension) => `.${extension}`).join(", ")}); move ${name} out of it. zaisma help shows the folder.`;
  const passSources = new Map();
  const textureFiles = new Map();
  let channelsText = null;
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((first, second) => first.name.localeCompare(second.name))) {
    if (JUNK.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(folder, entry.name);
    if (!entry.isFile()) refuse("unknown_shader_file", { message: `${entry.name} is a folder; a shader's folder holds only its files.`, field: entry.name, fix: fileFix(entry.name) });
    if (entry.name in SHADER_PASS_FILES) passSources.set(entry.name, await readFile(full, "utf8"));
    else if (entry.name === CHANNELS_FILE) channelsText = await readFile(full, "utf8");
    else if (TEXTURE_EXTENSIONS.includes(extensionOf(entry.name))) textureFiles.set(entry.name, full);
    else refuse("unknown_shader_file", { message: `${entry.name} isn't a file a shader's folder holds.`, field: entry.name, fix: fileFix(entry.name) });
  }
  if (!passSources.has("image.glsl")) refuse("no_image_pass", { message: `${folder} has no image.glsl, the shader's image pass.`, field: "folder", fix: "Put the image pass in image.glsl: void mainImage(out vec4 fragColor, in vec2 fragCoord) { … }, Shadertoy's form in WebGL2's GLSL." });
  for (const [fileName, source] of passSources) {
    if (Buffer.byteLength(source) > SHADER_LIMITS.maximumPassSizeBytes) refuse("shader_too_big", { message: `${fileName} is over ${SHADER_LIMITS.maximumPassSizeBytes / 1024} KB.`, field: fileName, fix: "Take out unused functions and long comments, or move work into a buffer of its own (each pass gets 64 KB)." });
  }

  const bufferNames = Object.entries(SHADER_PASS_FILES).filter(([fileName, bufferName]) => bufferName && passSources.has(fileName)).map(([, bufferName]) => bufferName);
  const passNames = ["image", ...bufferNames.map((bufferName) => `buffer-${bufferName}`)];
  const channelsByPass = Object.fromEntries(passNames.map((passName) => [passName, []]));
  if (channelsText !== null) {
    let given;
    try {
      given = JSON.parse(channelsText);
    } catch (error) {
      refuse("bad_channels_file", { message: `${CHANNELS_FILE} isn't JSON: ${error.message}.`, field: CHANNELS_FILE, fix: CHANNELS_FIX });
    }
    if (!isPlainObject(given)) refuse("bad_channels_file", { message: `${CHANNELS_FILE} isn't a JSON object of passes.`, field: CHANNELS_FILE, fix: CHANNELS_FIX });
    for (const [passName, givenChannels] of Object.entries(given)) {
      const place = `${CHANNELS_FILE}: ${passName}`;
      if (!passNames.includes(passName)) {
        const isBufferName = /^buffer-[a-d]$/.test(passName);
        refuse(isBufferName ? "bad_channels_file" : "unknown_field", {
          message: isBufferName ? `${CHANNELS_FILE} wires ${passName}, and ${folder} has no ${passName}.glsl.` : `${JSON.stringify(passName)} in ${CHANNELS_FILE} isn't a pass.`,
          field: place,
          fix: `${CHANNELS_FILE} takes the folder's passes: ${passNames.join(", ")}.${isBufferName ? ` Add ${passName}.glsl, or take ${passName} out of ${CHANNELS_FILE}.` : ""}`,
        });
      }
      if (!Array.isArray(givenChannels) || givenChannels.length > SHADER_LIMITS.maximumChannelCount) refuse("bad_channels_file", { message: `${place} isn't a list of up to ${SHADER_LIMITS.maximumChannelCount} channels.`, field: place, fix: CHANNELS_FIX });
      for (const [channelIndex, givenChannel] of givenChannels.entries()) channelsByPass[passName].push(readChannel(givenChannel, `${place}[${channelIndex}]`, channelsByPass[passName], bufferNames, textureFiles));
    }
  }

  const namedFiles = [...new Set(Object.values(channelsByPass).flatMap((channels) => channels.map((channel) => channel.texture_file).filter(Boolean)))];
  const unnamedFile = [...textureFiles.keys()].find((name) => !namedFiles.includes(name));
  if (unnamedFile) refuse("unknown_shader_file", { message: `No channel in ${CHANNELS_FILE} reads ${unnamedFile}.`, field: unnamedFile, fix: `Name it as a channel's texture_file in ${CHANNELS_FILE}, or move it out of the folder.` });
  if (namedFiles.length > SHADER_LIMITS.maximumShaderTextureCount) {
    refuse("too_many_shader_textures", { message: `${CHANNELS_FILE} names ${namedFiles.length} textures; a shader reads up to ${SHADER_LIMITS.maximumShaderTextureCount}.`, field: CHANNELS_FILE, fix: "Name at most 4 different textures across the image pass and its buffers; several channels can read the same one." });
  }
  const textures = [];
  for (const textureFile of namedFiles) {
    const bytes = new Uint8Array(await readFile(textureFiles.get(textureFile)));
    if (bytes.length > SHADER_LIMITS.maximumTextureSizeBytes) refuse("shader_texture_too_big", { message: `${textureFile} is over ${SHADER_LIMITS.maximumTextureSizeBytes / 1048576} MB.`, field: textureFile, fix: "Save it smaller (a JPEG or WebP, or fewer pixels; a shader samples it with mipmaps)." });
    if (!textureTypeOf(bytes)) refuse("not_an_image", { message: `${textureFile} isn't a PNG, JPEG or WebP image.`, field: textureFile, fix: "Save it as a PNG, JPEG or WebP file." });
    textures.push({ textureFile, bytes });
  }
  const passOf = (passName, fileName) => ({ source: passSources.get(fileName), channels: channelsByPass[passName] });
  return {
    manifest: { image: passOf("image", "image.glsl"), buffers: bufferNames.map((bufferName) => ({ buffer_name: bufferName, ...passOf(`buffer-${bufferName}`, `buffer-${bufferName}.glsl`) })) },
    textures,
  };
}

/** One channel of channels.json, checked closed, with the API's defaults filled in: filter linear, wrap repeat for a texture and clamp for a buffer. */
function readChannel(given, place, earlier, bufferNames, textureFiles) {
  const bad = (field, message) => refuse("bad_shader_channel", { message, field, fix: CHANNELS_FIX });
  if (!isPlainObject(given)) bad(place, `${place} isn't an object.`);
  const unknown = Object.keys(given).find((key) => !CHANNEL_FIELDS.includes(key));
  if (unknown !== undefined) {
    refuse("unknown_field", { message: `${unknown} isn't a field of a channel in ${CHANNELS_FILE}.`, field: `${place}.${unknown}`, fix: `${unknown === "image_id" ? "In a folder, a texture channel names its file: texture_file. " : ""}Leave it out. A channel takes: ${CHANNEL_FIELDS.join(", ")}.` });
  }
  const { channel_index: channelIndex, input_kind: inputKind } = given;
  if (!Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex >= SHADER_LIMITS.maximumChannelCount) bad(`${place}.channel_index`, `${place}.channel_index isn't 0, 1, 2 or 3.`);
  if (earlier.some((channel) => channel.channel_index === channelIndex)) bad(`${place}.channel_index`, `${place.replace(/\[\d+\]$/, "")} has channel_index ${channelIndex} twice.`);
  if (inputKind !== "buffer" && inputKind !== "texture") bad(`${place}.input_kind`, `${place}.input_kind ${JSON.stringify(inputKind ?? null)} isn't buffer or texture.`);
  const bufferName = given.buffer_name ?? null;
  const textureFile = given.texture_file ?? null;
  if (inputKind === "buffer") {
    if (!bufferNames.includes(bufferName)) {
      bad(`${place}.buffer_name`, bufferName === null ? `${place} reads a buffer but names none.` : `${place} reads buffer ${JSON.stringify(bufferName)}, and the folder has no buffer-${bufferName}.glsl${bufferNames.length ? ` (it has ${bufferNames.map((name) => `buffer-${name}.glsl`).join(", ")})` : ""}.`);
    }
    if (textureFile !== null) bad(`${place}.texture_file`, `${place} reads a buffer, so it takes no texture_file.`);
  } else {
    if (typeof textureFile !== "string" || !textureFiles.has(textureFile)) bad(`${place}.texture_file`, textureFile === null ? `${place} reads a texture but names no texture_file.` : `${place} reads ${JSON.stringify(textureFile)}, which isn't a texture in the folder.`);
    if (bufferName !== null) bad(`${place}.buffer_name`, `${place} reads a texture, so it takes no buffer_name.`);
  }
  const filter = given.filter ?? "linear";
  if (filter !== "linear" && filter !== "nearest") bad(`${place}.filter`, `${place}.filter ${JSON.stringify(filter)} isn't linear or nearest.`);
  const wrap = given.wrap ?? (inputKind === "texture" ? "repeat" : "clamp");
  if (wrap !== "clamp" && wrap !== "repeat") bad(`${place}.wrap`, `${place}.wrap ${JSON.stringify(wrap)} isn't clamp or repeat.`);
  return { channel_index: channelIndex, input_kind: inputKind, buffer_name: inputKind === "buffer" ? bufferName : null, texture_file: inputKind === "texture" ? textureFile : null, filter, wrap };
}

/** The folder's manifest as the API takes it: each texture channel naming its image (imageIdOf its file) instead of its file. */
function manifestWithImageIds(manifest, imageIdOf) {
  const passWith = (pass) => ({ ...pass, channels: pass.channels.map(({ texture_file: textureFile, ...channel }) => ({ ...channel, image_id: textureFile === null ? null : imageIdOf(textureFile) })) });
  return { image: passWith(manifest.image), buffers: manifest.buffers.map(passWith) };
}

/**
 * Sends each texture as an image of kind shader_texture, or uses an approved one the game has with the same bytes, and waits until each
 * is approved (at once, unless image matching couldn't check it and a person looks). Answers each { texture_file, image_id, added_image },
 * added_image being the API's answer as-is, or null for one used again.
 */
async function sendTextures(slug, textures) {
  if (!textures.length) return [];
  const { images } = await api("GET", `/games/${slug}`);
  const textureImages = [];
  for (const texture of textures) {
    const textureHash = sha256Of(texture.bytes);
    let imageId = null;
    for (const image of images.filter((candidate) => candidate.kind === "shader_texture" && candidate.review_status === "approved" && candidate.size_bytes === texture.bytes.length)) {
      const stored = await fetch(image.image_url).then((response) => (response.ok ? response.arrayBuffer() : null)).catch(() => null);
      if (stored && sha256Of(new Uint8Array(stored)) === textureHash) {
        imageId = image.id;
        break;
      }
    }
    if (imageId) {
      say(`Using ${texture.textureFile}: the game has it already (${imageId}).`);
      textureImages.push({ texture_file: texture.textureFile, image_id: imageId, added_image: null });
      continue;
    }
    say(`Sending ${texture.textureFile} (${readableSize(texture.bytes.length)})…`);
    const added = await api("POST", `/games/${slug}/images?kind=shader_texture`, texture.bytes);
    textureImages.push({ texture_file: texture.textureFile, image_id: added.image.id, added_image: added });
  }
  let waiting = textureImages.filter((textureImage) => textureImage.added_image && textureImage.added_image.image.review_status !== "approved");
  if (waiting.length) say("Image matching couldn't check a texture just now, so a person at Zaisma looks; waiting a minute…");
  for (let i = 0; i < TEXTURE_CHECK_COUNT && waiting.length; i++) {
    await sleep(TEXTURE_CHECK_INTERVAL_MS);
    const { images: checked } = await api("GET", `/games/${slug}`);
    const statusOf = (textureImage) => checked.find((image) => image.id === textureImage.image_id)?.review_status ?? "rejected";
    const rejected = waiting.find((textureImage) => statusOf(textureImage) === "rejected");
    if (rejected) refuse("shader_texture_not_approved", { message: `${rejected.texture_file} (${rejected.image_id}) was rejected, so the shader wasn't sent.`, field: rejected.texture_file, fix: "The game's images (get_game) give its review_reason; use another texture." }, EXIT_CODES.failed);
    waiting = waiting.filter((textureImage) => statusOf(textureImage) !== "approved");
  }
  if (waiting.length) {
    refuse(
      "shader_texture_not_approved",
      { message: `${waiting[0].texture_file} (${waiting[0].image_id}) waits for a person at Zaisma, usually within a day, so the shader wasn't sent.`, field: waiting[0].texture_file, fix: "Run the same command again once the game's images (get_game) show it approved: it's used then, not sent again." },
      EXIT_CODES.failed,
    );
  }
  return textureImages;
}

/** zaisma shader: sends the folder's textures, then the shader. With --json, { texture_images, added_shader }: the API's answers as-is. */
async function sendShader({ folder }, flags) {
  const { manifest, textures } = await readShaderFolder(folder);
  const textureImages = await sendTextures(flags.game, textures);
  const imageIds = new Map(textureImages.map((textureImage) => [textureImage.texture_file, textureImage.image_id]));
  const answer = await api("POST", `/games/${flags.game}/shaders`, { screen: flags.screen, ...manifestWithImageIds(manifest, (textureFile) => imageIds.get(textureFile)) });
  if (isJson) return printAnswer({ texture_images: textureImages, added_shader: answer });
  console.log(`Sent ${answer.shader.id} for ${answer.shader.screen}: ${answer.shader.review_status}.`);
  if (answer.review_message) console.log(answer.review_message);
  return EXIT_CODES.done;
}

/** Draws the shader as Zaisma's check does, in a headless Chrome on this computer, from the check's own page (shader-check.mjs). */
async function drawInChrome(chromePath, manifest, textures, screen) {
  const input = shaderRenderInputOf(manifestWithImageIds(manifest, (textureFile) => textureFile), screen, textures.map((texture) => ({ imageId: texture.textureFile, bytes: texture.bytes })), true);
  const { textureExpressions, checkExpression } = shaderCheckPageExpressions(input);
  const failed = (error) => refuse("local_chrome_failed", { message: `Chrome on this computer couldn't draw the shader: ${error.message}`, field: process.env.CHROME_PATH ? "CHROME_PATH" : null, fix: "Set CHROME_PATH to another Chrome or Chromium; or give --game <slug> with ZAISMA_KEY set, and it's drawn on Zaisma instead." }, EXIT_CODES.failed);
  say(`Drawing it for ${screen} as Zaisma's check does, in Chrome on this computer; this takes a minute or two…`);
  let chrome;
  try {
    chrome = await openChrome(chromePath, "zaisma-shader-check-");
  } catch (error) {
    failed(error);
  }
  let timer;
  try {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, parameters) => chrome.send(method, parameters, sessionId);
    // Nothing the check page asks for leaves it.
    chrome.listen(sessionId, (method, parameters) => method === "Fetch.requestPaused" && send("Fetch.failRequest", { requestId: parameters.requestId, errorReason: "BlockedByClient" }).catch(() => {}));
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const { frameTree } = await send("Page.getFrameTree");
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: SHADER_CHECK_PAGE });
    const evaluate = async (expression) => {
      const { result: evaluated, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split("\n")[0] ?? exceptionDetails.text);
      return evaluated.value;
    };
    for (const expression of textureExpressions) await evaluate(expression);
    const outOfTime = new Promise((resolve) => (timer = setTimeout(() => resolve(null), SHADER_LIMITS.checkTimeoutSec * 1000)));
    const render = shaderRenderFromPage(await Promise.race([evaluate(checkExpression), outOfTime]), input);
    return { rendererKind: "local_chrome", shaderCheck: await shaderDraftAnswer(render, screen), remainingShaderCheckCount: null, sheetPng: render.sheetPng, textureImages: [] };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    failed(error);
  } finally {
    clearTimeout(timer);
    await chrome.close();
  }
}

/** Draws the shader on Zaisma, as a check before sending (POST /games/:slug/shader-checks), after sending its textures; downloads its sheet. */
async function drawOnZaisma(slug, manifest, textures, screen) {
  const textureImages = await sendTextures(slug, textures);
  const imageIds = new Map(textureImages.map((textureImage) => [textureImage.texture_file, textureImage.image_id]));
  say(`Drawing it for ${screen} on Zaisma; this takes a minute or two…`);
  const answer = await api("POST", `/games/${slug}/shader-checks`, { screen, ...manifestWithImageIds(manifest, (textureFile) => imageIds.get(textureFile)) });
  let sheetPng = null;
  if (answer.shader_check.sheet_url) {
    const response = await fetch(answer.shader_check.sheet_url).catch(() => null);
    if (response?.ok) sheetPng = new Uint8Array(await response.arrayBuffer());
  }
  return { rendererKind: "zaisma", shaderCheck: answer.shader_check, remainingShaderCheckCount: answer.remaining_shader_check_count, sheetPng, textureImages };
}

/**
 * zaisma check on a shader's folder: drawn in Chrome on this computer when there is one, otherwise on Zaisma (--game and ZAISMA_KEY),
 * with its sheet saved beside the folder. Ends with problems_found when it doesn't compile, is too slow at a level or flashes; its notes
 * never change the exit code. --json prints { renderer_kind, shader_check, remaining_shader_check_count, sheet_file, texture_images }.
 */
async function checkShaderFolder(folder, flags) {
  if (flags["draw-on-zaisma"] && !flags.game) refuse("missing_field", { message: "--draw-on-zaisma needs --game: the game to draw it for.", field: "--game", fix: `Run it as: zaisma check ${folder} --game <slug> --draw-on-zaisma, with ZAISMA_KEY set.` });
  const { manifest, textures } = await readShaderFolder(folder);
  const screen = flags.screen ?? "wide";
  const canDrawOnZaisma = Boolean(flags.game && KEY);
  const hasWebSocket = typeof globalThis.WebSocket === "function";
  const chromePath = flags["draw-on-zaisma"] ? null : findChrome([join(process.cwd(), ".wrangler/chrome"), join(process.cwd(), "chrome")]);
  let drawn = null;
  if (chromePath && hasWebSocket) {
    try {
      drawn = await drawInChrome(chromePath, manifest, textures, screen);
    } catch (error) {
      if (!(error instanceof CommandError && error.error.code === "local_chrome_failed" && canDrawOnZaisma)) throw error;
      say(`${error.error.message} Drawing it on Zaisma instead.`);
    }
  } else if (!canDrawOnZaisma && !flags["draw-on-zaisma"]) {
    if (chromePath) refuse("needs_newer_node", { message: `Drawing a shader in Chrome on this computer needs Node 22 or newer; this is ${process.version}.`, field: null, fix: "Run it with Node 22 or newer; or give --game <slug> with ZAISMA_KEY set to draw it on Zaisma." }, EXIT_CODES.failed);
    refuse("no_chrome", { message: "There's no Chrome on this computer to draw the shader in.", field: "--game", fix: "Install Chrome, or set CHROME_PATH to a Chrome or Chromium; or give --game <slug> with ZAISMA_KEY set to draw it on Zaisma (up to 100 checks a day)." }, EXIT_CODES.failed);
  }
  drawn ??= await drawOnZaisma(flags.game, manifest, textures, screen);
  const sheetPath = drawn.sheetPng ? `${resolve(folder)}-${screen}-check.png` : null;
  if (sheetPath) await writeFile(sheetPath, drawn.sheetPng);
  const sheetFile = sheetPath ? relative(process.cwd(), sheetPath) || sheetPath : null;
  const isPassing = isShaderCheckPassing(drawn.shaderCheck);
  if (isJson) printJson({ renderer_kind: drawn.rendererKind, shader_check: drawn.shaderCheck, remaining_shader_check_count: drawn.remainingShaderCheckCount, sheet_file: sheetFile, texture_images: drawn.textureImages });
  else printShaderCheck(drawn, { folder, screen, sheetFile, slug: flags.game ?? null, isPassing });
  return isPassing ? EXIT_CODES.done : EXIT_CODES.problems_found;
}

/** A shader check for people: what it measured against each limit, the glass, the notes and where its sheet is. */
function printShaderCheck({ rendererKind, shaderCheck, remainingShaderCheckCount }, { folder, screen, sheetFile, slug, isPassing }) {
  console.log(rendererKind === "local_chrome" ? `Drawn for ${screen} in Chrome on this computer, in software, as Zaisma's check draws it.` : `Drawn for ${screen} on Zaisma (${remainingShaderCheckCount} checks left today).`);
  if (shaderCheck.compile_error) {
    console.log(`  ${shaderCheck.compile_error} [shader_does_not_compile]\n  Line numbers are the pass's own.`);
  } else {
    const levelCount = shaderCheck.quality_checks.length;
    for (const qualityCheck of shaderCheck.quality_checks) {
      const isTooSlow = qualityCheck.check_frame_ms > qualityCheck.maximum_check_frame_ms;
      console.log(`  ${levelCount > 1 ? `Quality ${qualityCheck.quality_level}` : "A frame"}: ${qualityCheck.check_frame_ms} ms in the check; the most is ${qualityCheck.maximum_check_frame_ms}${isTooSlow ? ". Too slow [shader_too_slow]" : "."}`);
    }
    if (shaderCheck.quality_checks.some((qualityCheck) => qualityCheck.check_frame_ms > qualityCheck.maximum_check_frame_ms)) console.log("  Fix: draw less (fewer steps, octaves or lights), or less where iQuality is lower.");
    if (shaderCheck.flash_count !== null) {
      const isFlashing = shaderCheck.flash_count > SHADER_LIMITS.maximumFlashCountPerSec;
      console.log(`  Flashes: at most ${shaderCheck.flash_count} in a second; the most is ${SHADER_LIMITS.maximumFlashCountPerSec}${isFlashing ? ". Too many [shader_flashes]: flashing can cause seizures; change brightness slowly." : "."}`);
    }
    if (shaderCheck.is_glass_smoked !== null) console.log(`  The glass over it: ${shaderCheck.is_glass_smoked ? "smoked" : "light"}, tinted ${shaderCheck.glass_tint_pct}%.`);
  }
  for (const note of shaderCheck.notes) console.log(`  · ${note.message} Fix: ${note.fix} [${note.code}]`);
  if (sheetFile) console.log(`The sheet (wide and phone under Zaisma's glass, small, what changes between frames, and its pixels close up): ${sheetFile}`);
  else if (shaderCheck.sheet_url) console.log(`The sheet, for a day: ${shaderCheck.sheet_url}`);
  console.log(isPassing ? `Ready to send: zaisma shader ${folder} --game ${slug ?? "<slug>"} --screen ${screen}` : "Fix what's above, then check again.");
}

const sha256Of = (text) => createHash("sha256").update(text).digest("hex");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A path's file kind for findOutsideReferences, or null when its text isn't read. */
const fileKindOf = (path) => ({ html: "html", htm: "html", css: "css", js: "module", mjs: "module" })[extensionOf(path)] ?? null;
/** One file's place to another's, as a page or a module writes it: ./ or ../ first. */
const relativePath = (fromPath, toPath) => {
  const path = posix.relative(posix.dirname(fromPath), toPath);
  return path.startsWith("../") ? path : `./${path}`;
};
const TYPE_EXTENSIONS = { "text/css": "css", "text/javascript": "js", "application/javascript": "js", "application/json": "json", "application/wasm": "wasm", "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "font/otf": "otf", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav" };

/** Unpacks a gzip (it starts 1f 8b) or brotli file. */
async function unpack(source, target) {
  const handle = await open(source);
  const start = new Uint8Array(2);
  await handle.read(start, 0, 2, 0);
  await handle.close();
  await pipeline(createReadStream(source), start[0] === 0x1f && start[1] === 0x8b ? createGunzip() : createBrotliDecompress(), createWriteStream(target));
}

/**
 * Fixes two blockers in what's uploaded, never in the folder: unpacks pre-compressed files, and downloads
 * what the page, its stylesheets and its modules load from outside sites into zaisma-outside/<site>/<path>,
 * pointing the game at them. Works in a temporary folder (temporaryFolder, for the caller to remove) and
 * answers the files to upload and what changed, for people.
 */
async function fixUpload(givenFiles) {
  const temporaryFolder = await mkdtemp(join(tmpdir(), "zaisma-upload-"));
  const filesByPath = new Map(givenFiles.map((file) => [file.path, { ...file }]));
  const changes = [];
  const writeTemporary = async (path, bytes) => {
    const full = join(temporaryFolder, ...path.split("/"));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return full;
  };

  // Unpack, then put the unpacked names wherever the game names the packed ones.
  const renames = [];
  for (const file of [...filesByPath.values()]) {
    const extension = extensionOf(file.path);
    if (!PRECOMPRESSED_EXTENSIONS.includes(extension)) continue;
    const unpackedPath = file.path.slice(0, -extension.length - 1);
    filesByPath.delete(file.path);
    renames.push([posix.basename(file.path), posix.basename(unpackedPath)]);
    if (filesByPath.has(unpackedPath)) {
      changes.push(`Left out ${file.path}: ${unpackedPath} is there already`);
      continue;
    }
    const full = join(temporaryFolder, ...unpackedPath.split("/"));
    await mkdir(dirname(full), { recursive: true });
    try {
      await unpack(file.full, full);
    } catch {
      refuse("unpack_failed", { message: `${file.path} couldn't be unpacked as gzip or brotli.`, field: "folder", fix: "Turn off compression in the engine's build settings (Unity: Publishing Settings, Compression Format: Disabled) and build again." }, EXIT_CODES.failed);
    }
    filesByPath.set(unpackedPath, { path: unpackedPath, full, sizeBytes: (await stat(full)).size, contentText: fileKindOf(unpackedPath) ? await readFile(full, "utf8") : null });
    changes.push(`Unpacked ${file.path} into ${unpackedPath}`);
  }
  const texts = new Map([...filesByPath.values()].filter((file) => file.contentText !== null).map((file) => [file.path, file.contentText]));
  const editedPaths = new Set();
  if (renames.length) {
    for (const file of filesByPath.values()) if (extensionOf(file.path) === "json") texts.set(file.path, await readFile(file.full, "utf8"));
    for (const [path, text] of texts) {
      let changed = text;
      for (const [packedName, unpackedName] of renames) changed = changed.replace(new RegExp(`(?<![\\w.-])${escapeRegExp(packedName)}(?![\\w.-])`, "g"), unpackedName);
      if (changed !== text) {
        texts.set(path, changed);
        editedPaths.add(path);
      }
    }
  }

  // Download what the game loads from outside sites, and what those files load, each once.
  const takenPaths = new Set([...filesByPath.keys()].map((path) => path.toLowerCase()));
  const pathsByUrl = new Map();
  const downloads = [];
  let freeSlotCount = 4;
  const waiting = [];
  const takeSlot = () => (freeSlotCount > 0 ? (freeSlotCount--, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
  const freeSlot = () => (waiting.length ? waiting.shift()() : freeSlotCount++);
  const unreachable = (url, why) => refuse("outside_file_unreachable", { message: `${url} couldn't be downloaded: ${why}.`, field: url, fix: "Check the address, or download it into the game's folder yourself and point the game at it by its path." }, EXIT_CODES.failed);

  /** Where a downloaded file goes; null when its extension has to come from what the site answers. */
  const outsidePath = (url, extension) => {
    const parsed = new URL(url);
    const site = parsed.host.replace(/[^A-Za-z0-9.-]/g, "_");
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => {
      let name = part;
      try {
        name = decodeURIComponent(part);
      } catch {}
      return name.replace(/[^A-Za-z0-9._@+~-]/g, "_").replace(/^\./, "_");
    });
    if (!parts.length) parts.push("index");
    const last = parts[parts.length - 1];
    const urlExtension = extensionOf(last);
    const isAllowed = GAME_FILE_EXTENSIONS.includes(urlExtension);
    // A module may keep .mjs where a script would be .js.
    const finalExtension = isAllowed && (extension === null || urlExtension === extension || (extension === "js" && urlExtension === "mjs")) ? urlExtension : extension;
    if (!finalExtension) return null;
    if (parsed.search || !isAllowed || urlExtension !== finalExtension) parts[parts.length - 1] = `${isAllowed ? last.slice(0, -urlExtension.length - 1) : last}-${sha256Of(url).slice(0, 8)}.${finalExtension}`;
    let path = [OUTSIDE_FOLDER, site, ...parts].join("/");
    if (path.length > 200 || takenPaths.has(path.toLowerCase())) path = `${OUTSIDE_FOLDER}/${site}/${sha256Of(url).slice(0, 16)}.${finalExtension}`;
    takenPaths.add(path.toLowerCase());
    return path;
  };
  const codeExtension = { script: "js", module: "js", import_map: "js", style: "css", file: null };

  /** The downloaded file's path for a URL, downloading it (and what it loads) once. */
  const pull = (url, referenceKind) => {
    if (pathsByUrl.has(url)) return pathsByUrl.get(url);
    if (pathsByUrl.size >= MAXIMUM_OUTSIDE_FILE_COUNT) refuse("too_many_outside_files", { message: `The game loads more than ${MAXIMUM_OUTSIDE_FILE_COUNT} files from outside sites.`, field: "folder", fix: "Put its libraries in the game's folder (npm install and a bundler, or download them) and load them by their paths." }, EXIT_CODES.failed);
    const knownPath = outsidePath(url, codeExtension[referenceKind] ?? null);
    const download = (async () => {
      await takeSlot();
      let response;
      let bytes;
      try {
        response = await fetch(url, { headers: { "user-agent": DOWNLOAD_USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_SEC * 1000) });
        if (!response.ok) unreachable(url, `the site answered ${response.status}`);
        if (Number(response.headers.get("content-length") ?? 0) > MAXIMUM_OUTSIDE_FILE_SIZE_BYTES) unreachable(url, "it's over 100 MB");
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (error instanceof CommandError) throw error;
        unreachable(url, error.cause?.message ?? error.message);
      } finally {
        freeSlot();
      }
      if (bytes.length > MAXIMUM_OUTSIDE_FILE_SIZE_BYTES) unreachable(url, "it's over 100 MB");
      const path = knownPath ?? outsidePath(url, TYPE_EXTENSIONS[(response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()] ?? "bin");
      if (referenceKind === "module" || referenceKind === "import_map" || referenceKind === "style") {
        const text = new TextDecoder().decode(bytes);
        const rewritten = await rewriteReferences(path, text, findOutsideReferences(text, referenceKind === "style" ? "css" : "module", { baseUrl: response.url || url }));
        if (rewritten !== text) bytes = new TextEncoder().encode(rewritten);
      }
      filesByPath.set(path, { path, full: await writeTemporary(path, bytes), sizeBytes: bytes.length, contentText: null });
      changes.push(`Downloaded ${url} into ${path}`);
      return path;
    })();
    download.catch(() => {});
    downloads.push(download);
    const path = knownPath ? Promise.resolve(knownPath) : download;
    pathsByUrl.set(url, path);
    return path;
  };

  /** A text with each reference pointing at its downloaded file instead (an import map's prefix at its folder). */
  async function rewriteReferences(fromPath, text, references) {
    let rewritten = text;
    for (const reference of [...references].reverse()) {
      let toPath;
      if (reference.referenceKind === "import_map" && reference.importMapKey?.endsWith("/")) {
        const prefixUrl = reference.url.endsWith("/") ? reference.url : `${reference.url}/`;
        // Each import under the prefix in the game's own code, like "three/addons/controls/OrbitControls.js" (not the import map's own key).
        const pattern = new RegExp(`(["'])${escapeRegExp(reference.importMapKey)}([^"'\\n]+)\\1`, "g");
        for (const ownText of texts.values()) for (const match of ownText.matchAll(pattern)) await pull(prefixUrl + match[2], "module");
        const parsed = new URL(prefixUrl);
        toPath = [OUTSIDE_FOLDER, parsed.host.replace(/[^A-Za-z0-9.-]/g, "_"), ...parsed.pathname.split("/").filter(Boolean)].join("/") + "/";
      } else toPath = await pull(reference.url, reference.referenceKind);
      rewritten = rewritten.slice(0, reference.start) + relativePath(fromPath, toPath) + (toPath.endsWith("/") ? "/" : "") + rewritten.slice(reference.end);
    }
    return rewritten;
  }

  for (const [path, text] of texts) {
    const fileKind = fileKindOf(path);
    const references = fileKind ? findOutsideReferences(text, fileKind) : [];
    if (!references.length) continue;
    texts.set(path, await rewriteReferences(path, text, references));
    editedPaths.add(path);
  }
  for (let i = 0; i < downloads.length; i++) await downloads[i];
  for (const path of editedPaths) {
    const bytes = new TextEncoder().encode(texts.get(path));
    filesByPath.set(path, { ...filesByPath.get(path), full: await writeTemporary(path, bytes), sizeBytes: bytes.length });
    changes.push(`Pointed ${path} at them`);
  }
  return { files: [...filesByPath.values()], changes, temporaryFolder };
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

async function sendInParts(file, progress) {
  const start = await api("POST", `/files/${file.sha256}/parts`, { size_bytes: file.size_bytes });
  if (start.storage_status === "already_stored") return;
  const handle = await open(file.full);
  const parts = [];
  try {
    for (let partNumber = 1, offsetBytes = 0; offsetBytes < file.size_bytes; partNumber++, offsetBytes += start.part_size_bytes) {
      const chunk = new Uint8Array(Math.min(start.part_size_bytes, file.size_bytes - offsetBytes));
      await handle.read(chunk, 0, chunk.length, offsetBytes);
      const part = await api("PUT", `/files/${file.sha256}/parts/${partNumber}?upload_id=${encodeURIComponent(start.upload_id)}`, chunk);
      parts.push({ part_number: part.part_number, etag: part.etag });
      progress(offsetBytes + chunk.length);
    }
  } finally {
    await handle.close();
  }
  await api("POST", `/files/${file.sha256}/parts/done`, { upload_id: start.upload_id, parts });
}

const readableSize = (sizeBytes) => (sizeBytes >= 1024 ** 3 ? `${(sizeBytes / 1024 ** 3).toFixed(1)} GB` : sizeBytes >= 1048576 ? `${(sizeBytes / 1048576).toFixed(1)} MB` : `${Math.ceil(sizeBytes / 1024)} KB`);
const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
/** A running count of what's sent, for people watching; left out with --json, where stdout is only the answer. */
const showProgress = (text) => isJson || process.stdout.write(`\r  ${text}   `);

/** Uploads a version and waits for its scan. With --json, prints the last version answer as-is; the exit code says how the scan went. */
async function upload({ folder }, flags) {
  const slug = flags.game;
  const gameFolder = await readGameFolder(folder);
  const { problems } = await checkGame(gameFolder, slug);
  // The size limit depends on the developer's plan (Zaisma Pro allows more), which only the server knows: it answers game_too_big itself.
  const refused = problems.find((problem) => problem.problem_kind === "refused" && !problem.is_fixed_by_upload_command && problem.code !== "game_too_big");
  if (refused) {
    printProblems(problems, PROBLEM_GROUPS.slice(0, 2));
    throw new CommandError({ code: refused.code, message: refused.message, field: "folder", fix: refused.fix, retry_after_sec: null }, EXIT_CODES.failed.exitCode);
  }
  printProblems(problems, PROBLEM_GROUPS.slice(1, 2));
  const tooBig = problems.find((problem) => problem.code === "game_too_big");
  if (tooBig) say(`${tooBig.message} Uploading anyway: Zaisma checks it against your plan.`);
  if (gameFolder.hiddenPaths.length) say(`Leaving out hidden files: ${gameFolder.hiddenPaths.slice(0, 5).join(", ")}${gameFolder.hiddenPaths.length > 5 ? "…" : ""}`);

  const fixed = await fixUpload(gameFolder.files);
  try {
    if (fixed.changes.length) {
      say("Changed in this upload only (your folder stays as it is):");
      for (const change of fixed.changes) say(`  ${change}`);
    }
    return await sendVersion(slug, fixed.files, flags);
  } finally {
    await rm(fixed.temporaryFolder, { recursive: true, force: true });
  }
}

/** Sends the files Zaisma doesn't have yet, makes the version and waits for its scan. */
async function sendVersion(slug, fixedFiles, flags) {
  say(`Checking ${fixedFiles.length} files…`);
  const files = [];
  for (const file of fixedFiles) files.push({ path: file.path, sha256: await sha256(file.full), size_bytes: file.sizeBytes, full: file.full });
  const list = files.map(({ full: _, ...file }) => file);
  const plan = await api("POST", `/games/${slug}/uploads`, { files: list });
  const todo = files.filter((file, i) => plan.missing_file_hashes.includes(file.sha256) && files.findIndex((other) => other.sha256 === file.sha256) === i);
  const totalBytes = todo.reduce((sumBytes, file) => sumBytes + file.size_bytes, 0);
  say(todo.length ? `Sending ${todo.length} new or changed files (${readableSize(totalBytes)})…` : "Nothing changed since your last upload; making a version from the stored files.");

  let sentBytes = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        if (file.size_bytes > DIRECT_BYTES) await sendInParts(file, (partSentBytes) => showProgress(`${readableSize(sentBytes + partSentBytes)} of ${readableSize(totalBytes)}`));
        else await api("PUT", `/files/${file.sha256}`, new Uint8Array(await readFile(file.full)));
        sentBytes += file.size_bytes;
        showProgress(`${readableSize(sentBytes)} of ${readableSize(totalBytes)}`);
      }
    }),
  );
  if (todo.length && !isJson) process.stdout.write("\n");

  let answer = await api("POST", `/games/${slug}/versions`, { files: list, patch_notes: flags["patch-notes"] ?? "", publish_when_approved: flags["publish-when-approved"] === true, ...(flags["match-update-mode"] !== undefined ? { match_update_mode: flags["match-update-mode"] } : {}) });
  const versionId = answer.version.id;
  say(`Version ${versionId} is being scanned. This usually takes under a minute…`);

  for (let i = 0; i < SCAN_CHECK_COUNT && answer.version.scan_status === "scanning"; i++) {
    await sleep(SCAN_CHECK_INTERVAL_MS);
    answer = await api("GET", `/games/${slug}/versions/${versionId}`);
  }
  // A passed version is opened in Chrome next, usually within a minute: its numbers and notes come before the preview.
  const isRunning = (checked) => ["waiting", "checking"].includes(checked.version.performance_check?.check_status);
  for (let i = 0; i < PERFORMANCE_CHECK_COUNT && answer.version.scan_status === "approved" && isRunning(answer); i++) {
    await sleep(PERFORMANCE_CHECK_INTERVAL_MS);
    answer = await api("GET", `/games/${slug}/versions/${versionId}`);
  }
  const { version } = answer;
  if (isJson) printJson(answer);
  if (version.scan_status === "scanning") {
    say(`Still scanning. Check later with: zaisma versions ${slug}`);
    return EXIT_CODES.still_scanning;
  }
  if (version.scan_status === "approved") {
    if (isJson) return EXIT_CODES.done;
    if (isRunning(answer)) console.log(`Still checking how it starts in Chrome; zaisma versions ${slug} --json shows it.`);
    else printPerformance(version);
    if (version.is_live) console.log(`Passed and live: ${API}/g/${slug}`);
    else {
      console.log(`Passed. Your private preview: ${version.preview_url}`);
      console.log(`Publish it with: zaisma publish ${slug} ${version.id}`);
    }
    return EXIT_CODES.done;
  }
  if (!isJson) {
    console.log(version.scan_status === "held" ? "Held for a person at Zaisma to look at. Why:" : "Rejected. Why:");
    printReasons(version);
  }
  return version.scan_status === "held" ? EXIT_CODES.held : EXIT_CODES.rejected;
}

/** How a version started in Chrome, and what would make it smaller: nothing when it wasn't measured (a zip, or over the day's runs). */
function printPerformance(version) {
  const check = version.performance_check;
  if (!check) return;
  if (check.check_status === "over_daily_limit") return console.log("Not started in Chrome: today's 20 runs are used. Versions are measured again from midnight UTC.");
  if (check.check_status === "could_not_run") return console.log("Chrome couldn't run it on Zaisma's side; nothing for you to fix.");
  console.log(`Started in ${check.browser_description.replace(/^Chrome \d+ on a computer with no graphics card$/, "Chrome (a standard computer, no graphics card)")}`);
  const numbers = [
    check.loading_duration_sec === null ? "Nothing drawn" : `First frame after ${check.loading_duration_sec} s`,
    check.start_download_size_bytes === null ? null : `${readableSize(check.start_download_size_bytes)} downloaded before it`,
    check.start_memory_size_bytes === null ? null : `${readableSize(check.start_memory_size_bytes)} memory at start`,
  ];
  console.log(`  ${numbers.filter(Boolean).join(" · ")}`);
  const smaller = new Set(["images_could_be_ktx2", "audio_could_be_opus", "models_could_be_smaller", "development_build"]);
  for (const note of check.notes.filter((note) => !smaller.has(note.code))) console.log(`  ${note.message} Fix: ${note.fix}`);
  const notes = check.notes.filter((note) => smaller.has(note.code));
  if (notes.length) console.log("  Could be smaller:");
  for (const note of notes) console.log(`  · ${note.message} Fix: ${note.fix}`);
}

/** Why a version is held or rejected: a person's or a report's decision, then what the scan found, each with its code and rule, then what to do. */
function printReasons(version) {
  const reasons = [...(version.review_reason ? [version.review_reason] : []), ...version.findings];
  for (const reason of reasons) console.log(`  - ${reason.message}${reason.path ? ` (${reason.path})` : ""} [${reason.code}${reason.content_rule ? `, rule: ${reason.content_rule}` : ""}]`);
  for (const fix of new Set(reasons.map((reason) => reason.fix))) console.log(`  ${fix}`);
}

/** The code a held or removed game, or a held or rejected version, is held back by, to look up in the forum. */
const reasonCode = (gameOrVersion) => (gameOrVersion.review_reason ?? gameOrVersion.findings?.[0])?.code ?? "";

const day = (isoTime) => isoTime.slice(0, 10);
/** An ISO time from the API, with the same time on this computer's clock for people. */
const when = (isoTime) => `${isoTime} (${new Date(isoTime).toLocaleString()} here)`;

/** docs/NAMING.md rule 10: the same ISO 8601 times the API takes, with Z or an offset, nothing else. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function checkPublishTime(written) {
  if (ISO_TIME.test(written) && !Number.isNaN(Date.parse(written))) return written;
  const fix = ['Give an ISO 8601 time with Z or an offset, like "2026-11-01T17:00:00Z" or "2026-11-01T17:00+01:00".'];
  const localMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)$/.exec(written);
  if (localMatch) {
    // Said, never assumed: the same time on this computer's clock, with its offset on that day written out.
    const local = new Date(`${localMatch[1]}T${localMatch[2]}`);
    if (!Number.isNaN(local.getTime())) {
      const offsetMin = -local.getTimezoneOffset();
      const offset = `${offsetMin < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0")}:${String(Math.abs(offsetMin) % 60).padStart(2, "0")}`;
      fix.push(`For ${localMatch[2]} on this computer's clock, that's "${localMatch[1]}T${localMatch[2]}${offset}".`);
    }
  }
  refuse("bad_time", { message: `--scheduled-publish-at ${JSON.stringify(written)} has no time zone, or isn't an ISO time.`, field: "--scheduled-publish-at", fix: fix.join(" ") });
}

function printTopic(topic) {
  const countText = topic.is_known_issue ? `, ${topic.affected_developer_count} developer${topic.affected_developer_count === 1 ? "" : "s"} affected` : topic.vote_count ? `, ${topic.vote_count} vote${topic.vote_count === 1 ? "" : "s"}` : "";
  console.log(`${topic.id}  ${topic.topic_status.padEnd(13)} ${topic.is_unread ? "* " : "  "}${topic.title}  (${topic.is_known_issue ? "known issue" : topic.kind}${countText})`);
}

/** Text from --text, or piped in. */
async function readText(command, flags) {
  const text = flags.text ?? (await readInput());
  if (!text) refuse("missing_field", { message: `zaisma ${command} needs its text.`, field: "--text", fix: `Give --text "…", or pipe the text in. Run it as: ${usage(command)}` });
  return text;
}

/** What a forum post or message sent: anything the check said, and secrets it blanked. */
function sayWhatWasSent(answer) {
  if (answer.check_note) console.log(answer.check_note);
  if (answer.removed_secret_count) console.log(`${answer.removed_secret_count} secret${answer.removed_secret_count === 1 ? " was" : "s were"} blanked before it was stored.`);
}

/** The developer forum. Posts say an AI wrote them unless --by-me says the developer did. */
async function forum(command, values, flags) {
  const by = flags["by-me"] ? { author_kind: "developer" } : {};
  if (command === "forum post" || command === "forum message") {
    const isMessage = command === "forum message";
    const text = await readText(command, flags);
    const answer = await api("POST", "/forum", {
      kind: flags.kind,
      title: flags.title,
      text_markdown: text,
      ...(flags.category ? { category: flags.category } : {}),
      ...(isMessage ? { is_public: false, ...(flags.game ? { game_slug: flags.game } : {}) } : {}),
      ...by,
    });
    if (isJson) return printJson(answer);
    console.log(`${isMessage ? "Sent to Zaisma" : "Posted"} (${answer.topic.id}). Replies show here: zaisma forum ${answer.topic.id}`);
    sayWhatWasSent(answer);
    if (answer.similar_topics.length) {
      console.log("\nTopics that look like the same thing (vote or reply there if one is):");
      for (const topic of answer.similar_topics) printTopic(topic);
    }
    return;
  }
  if (command === "forum reply") {
    const text = await readText(command, flags);
    const answer = await api("POST", `/forum/${values.topic_id}/posts`, { text_markdown: text, ...(flags.reopen ? { reopen: true } : {}), ...by });
    if (isJson) return printJson(answer);
    console.log(`Replied in ${values.topic_id}.`);
    sayWhatWasSent(answer);
    return;
  }
  if (values.topic_id) {
    if (flags.search) refuse("unknown_field", { message: "zaisma forum takes a topic ID or --search, not both.", field: "--search", fix: 'Run zaisma forum <topic_id> for one topic, or zaisma forum --search "words".' });
    const answer = await api("GET", `/forum/${values.topic_id}`);
    if (isJson) return printJson(answer);
    const { topic, posts } = answer;
    console.log(`${topic.title}\n${topic.is_known_issue ? "known issue" : topic.kind}, ${topic.topic_status}${topic.is_public ? "" : ", a message to Zaisma"}${topic.game_slug ? `, ${topic.game_slug}` : ""}`);
    if (topic.workaround) console.log(`Until it's fixed: ${topic.workaround}`);
    if (topic.merged_into_topic) console.log(`Part of the known issue ${topic.merged_into_topic.id}: ${topic.merged_into_topic.title}`);
    const names = { developer: "", ai: "'s AI", zaisma: "" };
    for (const post of posts) {
      const waiting = post.check_status === "pending" ? " (being checked)" : post.check_status === "held" ? " (waiting for a person at Zaisma)" : "";
      console.log(`\n${day(post.created_at)}  ${post.author.name}${names[post.author.kind]}${post.kind === "reopen" ? " (reopened)" : ""}${post.is_answer ? " (the answer)" : ""}${waiting}:\n${post.text_markdown}`);
      for (const image of post.media) console.log(`[image] ${image.image_url}`);
    }
    return;
  }
  if (flags.search) {
    const answer = await api("GET", `/forum?detail=brief&search_text=${encodeURIComponent(flags.search)}`);
    if (isJson) return printJson(answer);
    if (!answer.topics.length) console.log("Nothing matches that. Post it with: zaisma forum post");
    for (const topic of answer.topics) printTopic(topic);
    return;
  }
  // Two calls, one per tab; --json prints both answers as-is, by the API's tab names.
  const [yours, messages] = await Promise.all([api("GET", "/forum?detail=brief&tab=yours"), api("GET", "/forum?detail=brief&tab=messages")]);
  if (isJson) return printJson({ yours, messages });
  console.log(yours.topics.length ? "Your topics (* has something new):" : "You haven't posted in the forum yet.");
  for (const topic of yours.topics) printTopic(topic);
  if (messages.topics.length) {
    console.log("\nYour messages to Zaisma:");
    for (const topic of messages.topics) printTopic(topic);
  }
}

/** Everything piped in, as text; "" when nothing is. */
async function readInput() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** A game's own database (GET and POST /games/<slug>/database…), as the MCP's get_database, query_database, batch_database, export_database, import_database, restore_database and undo_database_restore. */
async function database(command, values, flags) {
  if (command === "database export") return exportDatabase(values);
  if (command === "database import") return importDatabase(values);
  if (command === "database restore" || command === "database undo-restore") {
    const isUndo = command === "database undo-restore";
    const answer = isUndo
      ? await api("POST", `/games/${values.slug}/database/restores/${encodeURIComponent(values.database_restore_id)}/undo`)
      : await api("POST", `/games/${values.slug}/database/restores`, { restore_to_at: values.restore_to_at });
    if (isJson) return printJson(answer);
    const restore = answer.database_restore;
    console.log(isUndo ? `Undid restore ${values.database_restore_id}: ${values.slug}'s database is back to ${restore.restore_to_at}.` : `Restored ${values.slug}'s database to ${restore.restore_to_at}.`);
    if (answer.erased_again_player_count) console.log(`Erased ${answer.erased_again_player_count} player${answer.erased_again_player_count === 1 ? "" : "s"} again who had been erased since.`);
    console.log(`Undo it until ${restore.undo_expires_at}: zaisma database undo-restore ${values.slug} ${restore.id}`);
    return;
  }
  if (command === "database") {
    const answer = await api("GET", `/games/${values.slug}/database`);
    if (isJson) return printJson(answer);
    const use = answer.database_use_this_month;
    if (!answer.tables.length) console.log("No tables yet. Make one from your game server, or with: zaisma database query <slug> \"CREATE TABLE …\"");
    for (const table of answer.tables) console.log(`${table.sql};`);
    for (const index of answer.indexes) console.log(`${index.sql};`);
    const hosting = answer.hosting_use_this_month;
    console.log(
      `\nThis month: ${use.read_row_count.toLocaleString("en-US")} rows read, ${use.written_row_count.toLocaleString("en-US")} written, ${sizeText(use.storage_size_bytes)} stored (a game keeps up to ${sizeText(use.maximum_storage_size_bytes)}). ` +
        `Free hosting this month: ${hosting.free_used_pct}% used${hosting.is_paused ? ", paused" : ""}. Resets ${hosting.resets_on_date}.`,
    );
    if (answer.restores.length) {
      console.log("\nRestores (newest first; undo with zaisma database undo-restore <slug> <id>):");
      for (const restore of answer.restores.slice(0, 5)) console.log(`${restore.id}  ${restore.restored_at}  ${restore.undoes_database_restore_id ? `undid ${restore.undoes_database_restore_id}` : `back to ${restore.restore_to_at}`}`);
    }
    return;
  }
  if (command === "database query") {
    const sql = values.sql ?? (await readInput());
    if (!sql) refuse("missing_field", { message: "zaisma database query needs the SQL.", field: "sql", fix: `Give it in quotes, or pipe it in. Run it as: ${usage(command)}` });
    let statementValues;
    if (flags.values !== undefined) {
      try {
        statementValues = JSON.parse(flags.values);
      } catch {}
      if (!Array.isArray(statementValues)) refuse("bad_values", { message: "--values isn't a JSON list.", field: "--values", fix: `Give the values as a JSON list in single quotes, like --values '["player_8f3k2m", 1200]'.` });
    }
    const answer = await api("POST", `/games/${values.slug}/database/query`, { sql, ...(statementValues ? { values: statementValues } : {}) });
    if (isJson) return printJson(answer);
    printRows(answer);
    return;
  }
  const text = values.file ? await readFile(values.file, "utf8").catch(() => refuse("not_a_file", { message: `Couldn't read ${values.file}.`, field: "file", fix: "Give the path of a JSON file of statements, or pipe them in." })) : await readInput();
  let statements;
  try {
    statements = JSON.parse(text);
  } catch {}
  if (!Array.isArray(statements)) refuse("bad_sql", { message: `${values.file ?? "What was piped in"} isn't a JSON list of statements.`, field: "file", fix: 'Give a JSON list like [{ "sql": "UPDATE scores SET best_score = 0 WHERE player_id = ?", "values": ["player_8f3k2m"] }, { "sql": "DELETE FROM matches" }].' });
  const answer = await api("POST", `/games/${values.slug}/database/batch`, { statements });
  if (isJson) return printJson(answer);
  answer.statement_results.forEach((statementResult, i) => {
    if (i) console.log("");
    console.log(`Statement ${i + 1}:`);
    printRows(statementResult);
  });
}

const isSqliteFile = (file) => SQLITE_EXTENSIONS.includes(extname(file).toLowerCase());

/** Node's own SQLite (node:sqlite), loaded only for .sqlite files. */
async function nodeSqlite(file) {
  try {
    return await import("node:sqlite");
  } catch {
    refuse("needs_newer_node", { message: `Reading or writing ${file} needs Node's SQLite, which this Node (${process.version}) doesn't have.`, field: "file", fix: "Use Node 22.13 or newer, or give a .sql file to save or load SQL text instead." }, EXIT_CODES.failed);
  }
}

/** database export: every part of the dump (GET …/database/export), into a .sqlite file, a .sql file or stdout. */
async function exportDatabase({ slug, file }) {
  if (file && (await stat(file).catch(() => null))) refuse("file_exists", { message: `${file} is already there.`, field: "file", fix: "Give a new file name, or delete that file first." });
  const temporaryFile = file ? `${file}.${process.pid}.partial` : null;
  let sqlite = null;
  if (file && isSqliteFile(file)) {
    const { DatabaseSync } = await nodeSqlite(file);
    sqlite = new DatabaseSync(temporaryFile);
  }
  const dumpParts = [];
  let partCount = 0;
  let readRowCount = 0;
  try {
    let cursor = null;
    do {
      const part = await api("GET", `/games/${slug}/database/export${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      partCount++;
      readRowCount += part.read_row_count;
      // A .sqlite file loads each part as it comes: the dump's own BEGIN and COMMIT make it one transaction.
      if (sqlite) sqlite.exec(part.dump_sql);
      else dumpParts.push(part.dump_sql);
      cursor = part.next_cursor;
      if (cursor && file) showProgress(`${partCount} parts saved`);
    } while (cursor);
    if (sqlite) sqlite.close();
    else if (file) await writeFile(temporaryFile, dumpParts.join(""));
    if (file) await rename(temporaryFile, file);
  } catch (error) {
    try {
      sqlite?.close();
    } catch {}
    if (temporaryFile) await rm(temporaryFile, { force: true });
    throw error;
  }
  if (partCount > 1 && file && !isJson) process.stdout.write("\n");
  if (isJson) return printJson({ dump_sql: file ? null : dumpParts.join(""), file: file ?? null, part_count: partCount, read_row_count: readRowCount });
  if (!file) return process.stdout.write(dumpParts.join(""));
  console.log(`Saved ${slug}'s database to ${file} (${partCount} part${partCount === 1 ? "" : "s"}, ${readRowCount.toLocaleString("en-US")} rows read).${sqlite ? ` Run your game server on it with: npx @zaisma/game-server <server.ts> --game ${slug} --database-file ${file}` : ""}`);
}

/** The biggest database.sql export turns into a .sqlite file itself; past it, sqlite3 does it (Node's text tops out near this). */
const MAXIMUM_SQLITE_DUMP_SIZE_BYTES = 400 * 1024 * 1024;

/**
 * export: the .zip of everything about a game (GET …/export/download), downloaded and saved as a folder,
 * with database.sql also made into database.sqlite, ready for the Node runner's --database-file.
 */
async function exportGame({ slug }, flags) {
  const folder = flags.folder ?? `${slug}-export`;
  const there = await readdir(folder).catch(() => null);
  if (there?.length) refuse("folder_not_empty", { message: `${folder} isn't empty.`, field: "folder", fix: "Give a new or empty folder with --folder, or move what's in it." });
  if (!KEY) refuse("no_key", { message: "ZAISMA_KEY isn't set.", field: "ZAISMA_KEY", fix: "Make an API key at https://zaisma.com/account (under Game developers) and set it: export ZAISMA_KEY=zsk_…" }, EXIT_CODES.failed);
  let response;
  try {
    response = await fetch(`${API}/api/dev/games/${encodeURIComponent(slug)}/export/download`, { headers: { authorization: `Bearer ${KEY}`, "x-zaisma-client": "cli", "user-agent": `zaisma-cli/${CLI_VERSION}` } });
  } catch (error) {
    refuse("server_unreachable", { message: `Couldn't reach ${API}: ${error.cause?.message ?? error.message}.`, field: process.env.ZAISMA_API ? "ZAISMA_API" : null, fix: "Check the internet connection (and ZAISMA_API, if it's set), then run it again." }, EXIT_CODES.failed);
  }
  if (!response.ok || response.headers.get("content-type") !== "application/zip") {
    const answer = await response.json().catch(() => null);
    if (answer?.error) throw new CommandError(answer.error, EXIT_CODES.failed.exitCode);
    refuse("unexpected_answer", { message: `Zaisma answered ${response.status} without the export.`, fix: "Run it again in a minute. If it keeps happening, tell Zaisma: zaisma forum message --kind bug --category cli.", retryAfterSec: 60 }, EXIT_CODES.failed);
  }

  await mkdir(folder, { recursive: true });
  const zipFile = join(folder, `.${slug}-export.${process.pid}.zip`);
  try {
    let sizeBytes = 0;
    const counted = async function* () {
      for await (const chunk of response.body) {
        sizeBytes += chunk.length;
        showProgress(`${(sizeBytes / 1024 / 1024).toFixed(1)} MB downloaded`);
        yield chunk;
      }
    };
    await pipeline(counted, createWriteStream(zipFile));
    if (!isJson) process.stdout.write("\n");
    const entries = await unpackZip(zipFile, folder);
    let databaseFile = null;
    const dumpFile = join(folder, "database.sql");
    const dumpSizeBytes = (await stat(dumpFile).catch(() => null))?.size ?? 0;
    if (dumpSizeBytes && dumpSizeBytes <= MAXIMUM_SQLITE_DUMP_SIZE_BYTES) {
      const sqliteModule = await import("node:sqlite").catch(() => null);
      if (sqliteModule) {
        databaseFile = join(folder, "database.sqlite");
        const sqlite = new sqliteModule.DatabaseSync(databaseFile);
        try {
          sqlite.exec(await readFile(dumpFile, "utf8"));
        } finally {
          sqlite.close();
        }
      }
    }
    const answer = { folder, file_count: entries.length, size_bytes: sizeBytes, database_file: databaseFile };
    if (isJson) {
      printJson(answer);
      return EXIT_CODES.done;
    }
    console.log(`Saved everything about ${slug} in ${folder}: ${entries.length.toLocaleString("en-US")} files, ${(sizeBytes / 1024 / 1024).toFixed(1)} MB. README.txt says what's where.`);
    if (databaseFile) console.log(`Run your game server on its database with: npx @zaisma/game-server <server.ts> --game ${slug} --database-file ${databaseFile}`);
    else if (dumpSizeBytes) console.log(`Make its database a .sqlite file with: sqlite3 ${join(folder, "database.sqlite")} < ${dumpFile}`);
    return EXIT_CODES.done;
  } finally {
    await rm(zipFile, { force: true });
  }
}

/**
 * The files of a .zip Zaisma wrote (stored, not compressed, zip64 where it needs it), into a folder, by
 * its central directory. Answers the paths. A path that would land outside the folder stops it.
 */
async function unpackZip(zipFile, folder) {
  const handle = await open(zipFile, "r");
  try {
    const { size: zipSizeBytes } = await handle.stat();
    const read = async (atByte, sizeBytes) => {
      const buffer = Buffer.alloc(sizeBytes);
      await handle.read(buffer, 0, sizeBytes, atByte);
      return buffer;
    };
    const tailSizeBytes = Math.min(zipSizeBytes, 22 + 0xffff + 20 + 56);
    const tail = await read(zipSizeBytes - tailSizeBytes, tailSizeBytes);
    const endIndex = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const broken = () => refuse("unexpected_answer", { message: "The export that came isn't a whole .zip: the download was cut short.", fix: "Run it again." }, EXIT_CODES.failed);
    if (endIndex < 0) broken();
    let entryCount = tail.readUInt16LE(endIndex + 10);
    let directorySizeBytes = tail.readUInt32LE(endIndex + 12);
    let directoryAtByte = tail.readUInt32LE(endIndex + 16);
    if (entryCount === 0xffff || directorySizeBytes === 0xffffffff || directoryAtByte === 0xffffffff) {
      if (endIndex < 20 || tail.readUInt32LE(endIndex - 20) !== 0x07064b50) broken();
      const zip64End = await read(Number(tail.readBigUInt64LE(endIndex - 12)), 56);
      entryCount = Number(zip64End.readBigUInt64LE(32));
      directorySizeBytes = Number(zip64End.readBigUInt64LE(40));
      directoryAtByte = Number(zip64End.readBigUInt64LE(48));
    }
    const directory = await read(directoryAtByte, directorySizeBytes);
    const paths = [];
    let atByte = 0;
    for (let i = 0; i < entryCount; i++) {
      if (directory.readUInt32LE(atByte) !== 0x02014b50) broken();
      let sizeBytes = directory.readUInt32LE(atByte + 24);
      const nameSizeBytes = directory.readUInt16LE(atByte + 28);
      const extraSizeBytes = directory.readUInt16LE(atByte + 30);
      const commentSizeBytes = directory.readUInt16LE(atByte + 32);
      let headerAtByte = directory.readUInt32LE(atByte + 42);
      const path = directory.toString("utf8", atByte + 46, atByte + 46 + nameSizeBytes);
      // Zip64: the full size and offset, each only where its 32-bit field is full.
      for (let extraAtByte = atByte + 46 + nameSizeBytes; extraAtByte < atByte + 46 + nameSizeBytes + extraSizeBytes; ) {
        const id = directory.readUInt16LE(extraAtByte);
        const fieldSizeBytes = directory.readUInt16LE(extraAtByte + 2);
        if (id === 0x0001) {
          let fieldAtByte = extraAtByte + 4;
          if (sizeBytes === 0xffffffff) {
            sizeBytes = Number(directory.readBigUInt64LE(fieldAtByte));
            fieldAtByte += 16;
          }
          if (headerAtByte === 0xffffffff) headerAtByte = Number(directory.readBigUInt64LE(fieldAtByte));
        }
        extraAtByte += 4 + fieldSizeBytes;
      }
      atByte += 46 + nameSizeBytes + extraSizeBytes + commentSizeBytes;
      const target = join(folder, ...path.split("/"));
      if (path.startsWith("/") || path.split("/").includes("..") || relative(folder, target).startsWith("..")) broken();
      const header = await read(headerAtByte, 30);
      const dataAtByte = headerAtByte + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      await mkdir(dirname(target), { recursive: true });
      if (sizeBytes) await pipeline(createReadStream(zipFile, { start: dataAtByte, end: dataAtByte + sizeBytes - 1 }), createWriteStream(target));
      else await writeFile(target, "");
      paths.push(path);
    }
    return paths;
  } finally {
    await handle.close();
  }
}

/** database import: a dump, from a .sql file, stdin or a .sqlite file, sent in parts (POST …/database/import). */
async function importDatabase({ slug, file }) {
  let statements;
  if (file && isSqliteFile(file)) {
    if (!(await stat(file).catch(() => null))?.isFile()) refuse("not_a_file", { message: `Couldn't read ${file}.`, field: "file", fix: "Give the path of a .sqlite file, a .sql dump, or pipe the dump in." });
    const { DatabaseSync } = await nodeSqlite(file);
    let sqlite;
    try {
      sqlite = new DatabaseSync(file, { readOnly: true });
      sqlite.prepare("SELECT count(*) FROM sqlite_schema").get();
    } catch (error) {
      refuse("not_a_database", { message: `${file} isn't a SQLite database: ${error.message}.`, field: "file", fix: "Give a SQLite database file, like the Node runner's zaisma-database.sqlite, or a .sql dump." }, EXIT_CODES.failed);
    }
    statements = sqliteDumpStatements(sqlite);
  } else {
    const text = file ? await readFile(file, "utf8").catch(() => refuse("not_a_file", { message: `Couldn't read ${file}.`, field: "file", fix: "Give the path of a .sql dump or a .sqlite file, or pipe the dump in." })) : await readInput();
    if (!text.trim()) refuse("missing_field", { message: "zaisma database import needs a dump.", field: "file", fix: `Give a .sql or .sqlite file, or pipe the dump in. Run it as: ${usage("database import")}` });
    statements = splitDump(text);
  }
  const totals = { part_count: 0, statement_count: 0, skipped_statement_count: 0, read_row_count: 0, written_row_count: 0 };
  const send = async (dumpSql) => {
    let answer;
    try {
      answer = await api("POST", `/games/${slug}/database/import`, { dump_sql: dumpSql });
    } catch (error) {
      if (error instanceof CommandError && totals.part_count) {
        error.error.message = `${error.error.message} (Part ${totals.part_count + 1} was undone; the ${totals.part_count} before it, ${totals.statement_count} statements, went in.)`;
      }
      throw error;
    }
    totals.part_count++;
    for (const key of ["statement_count", "skipped_statement_count", "read_row_count", "written_row_count"]) totals[key] += answer[key];
    showProgress(`${totals.part_count} part${totals.part_count === 1 ? "" : "s"} in`);
  };
  let part = "";
  let partSizeBytes = 0;
  for (const statement of statements) {
    const statementSizeBytes = Buffer.byteLength(statement);
    if (part && partSizeBytes + statementSizeBytes > DUMP_PART_SIZE_BYTES) {
      await send(part);
      part = "";
      partSizeBytes = 0;
    }
    part += statement;
    partSizeBytes += statementSizeBytes;
  }
  if (part.trim()) await send(part);
  if (!isJson) process.stdout.write(totals.part_count ? "\n" : "");
  if (isJson) return printJson(totals);
  console.log(`Imported into ${slug}'s database: ${totals.statement_count - totals.skipped_statement_count} statements in ${totals.part_count} part${totals.part_count === 1 ? "" : "s"}, ${totals.written_row_count.toLocaleString("en-US")} rows written.`);
}

/**
 * A SQL dump cut into its statements, each with the ; that ends it, reading past quotes and comments and
 * through a trigger's BEGIN … END, the same way Zaisma reads one (scanStatements in packages/game-server/src/database.ts).
 */
function splitDump(text) {
  const pieces = [];
  let pieceStartIndex = 0;
  let leadingWords = [];
  let hasOnlyWords = true;
  let hasTokens = false;
  let lastWord = "";
  let sinceSemicolonTokenCount = 0;
  // A ; ends a trigger only after an END that comes straight after a ;.
  const isTriggerBody = () => leadingWords[0] === "CREATE" && (leadingWords[1] === "TRIGGER" || ((leadingWords[1] === "TEMP" || leadingWords[1] === "TEMPORARY") && leadingWords[2] === "TRIGGER")) && !(lastWord === "END" && sinceSemicolonTokenCount === 1);
  const token = (word) => {
    hasTokens = true;
    if (word === null) hasOnlyWords = false;
    else if (hasOnlyWords && leadingWords.length < 6) leadingWords.push(word);
    lastWord = word ?? "";
    sinceSemicolonTokenCount++;
  };
  let i = 0;
  while (i < text.length) {
    const character = text[i];
    if (character === "-" && text[i + 1] === "-") {
      const endIndex = text.indexOf("\n", i);
      i = endIndex === -1 ? text.length : endIndex + 1;
    } else if (character === "/" && text[i + 1] === "*") {
      const endIndex = text.indexOf("*/", i + 2);
      i = endIndex === -1 ? text.length : endIndex + 2;
    } else if (character === "'" || character === '"' || character === "`" || character === "[") {
      const close = character === "[" ? "]" : character;
      let endIndex = i + 1;
      while (endIndex < text.length && !(text[endIndex] === close && text[endIndex + 1] !== close)) endIndex += text[endIndex] === close ? 2 : 1;
      token(null);
      i = endIndex + 1;
    } else if (character === ";") {
      if (hasTokens && !isTriggerBody()) {
        pieces.push(text.slice(pieceStartIndex, i + 1));
        pieceStartIndex = i + 1;
        leadingWords = [];
        hasOnlyWords = true;
        hasTokens = false;
      } else if (hasTokens) token(null);
      lastWord = "";
      sinceSemicolonTokenCount = 0;
      i++;
    } else if (/\s/.test(character)) {
      i++;
    } else if (/[A-Za-z0-9_$]/.test(character)) {
      let endIndex = i + 1;
      while (endIndex < text.length && /[A-Za-z0-9_$]/.test(text[endIndex])) endIndex++;
      token(text.slice(i, endIndex).toUpperCase());
      i = endIndex;
    } else {
      token(null);
      i++;
    }
  }
  // What's after the last ; goes with it: a last statement without one, or the line break that ends the file.
  const rest = text.slice(pieceStartIndex);
  if (rest.trim() || !pieces.length) pieces.push(rest);
  else pieces[pieces.length - 1] += rest;
  return pieces;
}

const quoteName = (name) => `"${name.replaceAll('"', '""')}"`;

/**
 * A .sqlite file's dump, statement by statement: the same SQL Zaisma's export writes (dumpPart in
 * packages/game-server/src/dump.ts), read in one go. test/node/dump.test.ts holds the two to each other.
 */
function* sqliteDumpStatements(sqlite) {
  const entries = sqlite
    .prepare(
      "SELECT entry.type AS type, entry.name AS name, entry.tbl_name AS table_name, entry.sql AS sql, listed.type AS table_kind, listed.wr AS is_without_rowid " +
        "FROM sqlite_schema AS entry LEFT JOIN pragma_table_list AS listed ON listed.schema = 'main' AND listed.name = entry.name " +
        "WHERE entry.sql IS NOT NULL AND substr(entry.tbl_name, 1, 4) <> '_cf_' ORDER BY entry.rowid",
    )
    .all();
  yield "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n";
  for (const table of entries.filter((entry) => entry.type === "table" && (entry.table_kind === "table" || entry.table_kind === "virtual") && !entry.name.startsWith("sqlite_"))) {
    yield `${table.sql};\n`;
    const columns = sqlite.prepare("SELECT name, hidden = 0 AS is_insertable, pk AS primary_key_number FROM pragma_table_xinfo(?) ORDER BY cid").all(table.name);
    const insertedColumns = columns.filter((column) => column.is_insertable === 1);
    const insertInto = `INSERT INTO ${quoteName(table.name)}${insertedColumns.length < columns.length ? `(${insertedColumns.map((column) => quoteName(column.name)).join(",")})` : ""} VALUES(`;
    const valuesSql = insertedColumns.map((column, i) => `quote(${quoteName(column.name)}) AS value_${i}`).join(", ");
    const primaryKey = columns.filter((column) => column.primary_key_number > 0).sort((first, second) => first.primary_key_number - second.primary_key_number);
    const order = table.is_without_rowid ? primaryKey.map((column) => quoteName(column.name)).join(", ") : "rowid";
    for (const row of sqlite.prepare(`SELECT ${valuesSql} FROM ${quoteName(table.name)} ORDER BY ${order}`).iterate()) yield `${insertInto}${insertedColumns.map((_, i) => row[`value_${i}`]).join(",")});\n`;
  }
  if (entries.some((entry) => entry.name === "sqlite_sequence")) {
    yield "DELETE FROM sqlite_sequence;\n";
    for (const counter of sqlite.prepare("SELECT quote(name) AS name_sql, quote(seq) AS counter_sql FROM sqlite_sequence").all()) yield `INSERT INTO sqlite_sequence VALUES(${counter.name_sql},${counter.counter_sql});\n`;
  }
  for (const entry of entries) {
    if ((entry.type === "view" || entry.type === "index" || entry.type === "trigger") && !entry.table_name.startsWith("sqlite_")) yield `${entry.sql};\n`;
  }
  yield "COMMIT;\n";
}

/** The hosts a game's server can call (game_server_allowed_hosts on the game), as the MCP's get_game and update_game. */
async function allowedHosts(values, flags) {
  const given = (values.hosts ?? "").split(/[\s,]+/).filter(Boolean);
  if (given.length && flags.none) refuse("unknown_field", { message: "Hosts and --none were both given.", field: "--none", fix: `Give the whole list, like zaisma allowed-hosts ${values.slug} discord.com api.github.com, or --none for none.` });
  const answer = given.length || flags.none ? await api("PATCH", `/games/${values.slug}`, { game_server_allowed_hosts: given }) : await api("GET", `/games/${values.slug}`);
  if (isJson) return printJson(answer);
  const hosts = answer.game.game_server_allowed_hosts;
  console.log(hosts.length ? `${values.slug}'s game server can call: ${hosts.join(", ")}` : `${values.slug}'s game server calls no other servers. List some with: zaisma allowed-hosts ${values.slug} discord.com`);
  if (given.length || flags.none) console.log("It works within a minute.");
}

/** The game's own servers players' browsers connect to (own_server_urls on the game), as the MCP's get_game and update_game. */
async function ownServers(values, flags) {
  const given = (values.urls ?? "").split(/[\s,]+/).filter(Boolean);
  if (given.length && flags.none) refuse("unknown_field", { message: "Addresses and --none were both given.", field: "--none", fix: `Give the whole list, like zaisma own-servers ${values.slug} wss://play.example.com, or --none for none.` });
  const answer = given.length || flags.none ? await api("PATCH", `/games/${values.slug}`, { own_server_urls: given }) : await api("GET", `/games/${values.slug}`);
  if (isJson) return printJson(answer);
  const servers = answer.game.own_server_urls;
  console.log(servers.length ? `${values.slug} connects to its own servers: ${servers.join(", ")}` : `${values.slug} uses no servers of its own. Add one with: zaisma own-servers ${values.slug} wss://play.example.com`);
  if (given.length || flags.none) console.log(servers.length ? "Live now: the game's menu names them." : "Live now.");
}

/** Who a link opens for, in words (who_can_open). */
const LINK_AUDIENCE_WORDS = { everyone: "opens for everyone", signed_in_adults: "opens for signed-in adults", nobody: "opens for nobody" };

/**
 * A game's registered links (links on the game), as the MCP's get_game and update_game: the API takes
 * the whole list, so set and remove change it and send it back.
 */
async function links(command, values, flags) {
  let answer = await api("GET", `/games/${values.slug}`);
  if (command !== "links") {
    const kept = answer.game.links.map((link) => ({ link_name: link.link_name, destination_url: link.destination_url, is_on_game_page: link.is_on_game_page }));
    const others = kept.filter((link) => link.link_name !== values.link_name);
    if (command === "links remove" && others.length === kept.length) {
      refuse("unknown_link", { message: `${values.slug} has no link named ${values.link_name}.`, field: "link_name", fix: `zaisma links ${values.slug} lists its links.` }, EXIT_CODES.failed);
    }
    const changed = command === "links set" ? kept.map((link) => (link.link_name === values.link_name ? { ...link, destination_url: values.destination_url, is_on_game_page: Boolean(flags["on-game-page"]) } : link)) : others;
    if (command === "links set" && !kept.some((link) => link.link_name === values.link_name)) changed.push({ link_name: values.link_name, destination_url: values.destination_url, is_on_game_page: Boolean(flags["on-game-page"]) });
    answer = await api("PATCH", `/games/${values.slug}`, { links: changed });
  }
  if (isJson) return printJson(answer);
  const gameLinks = answer.game.links;
  if (!gameLinks.length) return console.log(`${values.slug} has no links. Add one with: zaisma links set ${values.slug} store https://kit.itch.io/${values.slug}`);
  for (const link of gameLinks) {
    console.log(`${link.link_name.padEnd(20)} ${link.destination_url}  (${LINK_AUDIENCE_WORDS[link.who_can_open]}${link.is_on_game_page ? ", on the game page" : ""})`);
    if (link.review_reason) console.log(`${"".padEnd(20)} ${link.review_reason.message} ${link.review_reason.fix}`);
  }
  if (command === "links set") console.log(`The game opens it with Zaisma.links.open("${values.link_name}").`);
}

/** A game's secrets (…/games/<slug>/secrets…), as the MCP's list_secrets, set_secret and delete_secret. */
async function secrets(command, values) {
  if (command === "secrets") {
    const answer = await api("GET", `/games/${values.slug}/secrets`);
    if (isJson) return printJson(answer);
    if (!answer.secrets.length) console.log(`No secrets yet. Set one with: zaisma secrets set ${values.slug} DISCORD_WEBHOOK_URL`);
    for (const secret of answer.secrets) console.log(`${secret.name.padEnd(32)} set ${when(secret.set_at)}`);
    return;
  }
  const path = `/games/${values.slug}/secrets/${encodeURIComponent(values.secret_name)}`;
  if (command === "secrets delete") {
    const answer = await api("DELETE", path);
    if (isJson) return printJson(answer);
    return console.log(`Deleted ${values.secret_name} from ${values.slug}. Running rooms lose it within a minute.`);
  }
  const secretValue = await readSecretValue(values.secret_name);
  if (!secretValue) refuse("missing_field", { message: `No value was given for ${values.secret_name}.`, field: "secret_value", fix: `Pipe it in, like printf %s "$TOKEN" | zaisma secrets set ${values.slug} ${values.secret_name}, or run it in a terminal and type it.` });
  const answer = await api("PUT", path, { secret_value: secretValue });
  if (isJson) return printJson(answer);
  console.log(`Set ${values.secret_name} for ${values.slug}. Its game server reads it as server.secrets.${values.secret_name}; running rooms get it within a minute.`);
  if (answer.next_steps.some((step) => step.tool === "update_game")) console.log(`It calls no other servers yet: list the hosts it uses this with, like zaisma allowed-hosts ${values.slug} discord.com`);
}

/** The fields of an item the file gives and set_item takes. */
const ITEM_FILE_FIELDS = ["item_name", "title", "description", "item_kind", "item_category", "price_minor_units", "currency_code", "local_prices"];

/** A price as people read it, from minor units, for the list. */
function itemPriceText(gameItem) {
  if (gameItem.price_minor_units === null) return "not sold";
  const isWhole = ["jpy", "krw"].includes(gameItem.currency_code);
  return `${(gameItem.price_minor_units / (isWhole ? 1 : 100)).toFixed(isWhole ? 0 : 2)} ${gameItem.currency_code.toUpperCase()}${gameItem.local_prices.length ? ` (+${gameItem.local_prices.length} local)` : ""}`;
}

/**
 * A game's items (…/games/<slug>/items…), as the MCP's list_items, set_item and remove_item. items set takes
 * the whole list from a file kept beside the game, so prices live in git: one call per changed item, and one
 * per item gone from the file, which the API refuses for an item players own.
 */
async function items(command, values) {
  const path = `/games/${values.slug}/items`;
  if (command === "items remove") {
    const answer = await api("DELETE", `${path}/${encodeURIComponent(values.item_name)}`);
    if (isJson) return printJson(answer);
    return console.log(`Removed ${values.item_name} from ${values.slug}.`);
  }
  if (command === "items set") {
    const text = values.file ? await readFile(values.file, "utf8").catch(() => refuse("not_a_file", { message: `Couldn't read ${values.file}.`, field: "file", fix: "Give the path of a JSON file of the game's items, or pipe it in." })) : await readInput();
    let wanted;
    try {
      wanted = JSON.parse(text);
    } catch {
      wanted = null;
    }
    const fileFix = 'Give a JSON list of whole items, like [{ "item_name": "revive", "title": "Revive", "description": "", "item_kind": "consumable", "item_category": "gameplay", "price_minor_units": 199, "currency_code": "usd", "local_prices": [] }].';
    if (!Array.isArray(wanted) || wanted.some((gameItem) => !gameItem || typeof gameItem !== "object" || typeof gameItem.item_name !== "string")) refuse("bad_item", { message: `${values.file ?? "What was piped in"} isn't a JSON list of items.`, field: "file", fix: fileFix });
    for (const gameItem of wanted) {
      const unknown = Object.keys(gameItem).find((key) => !ITEM_FILE_FIELDS.includes(key) && !["card_fee_note", "created_at", "updated_at"].includes(key));
      if (unknown) refuse("unknown_field", { message: `${gameItem.item_name} has ${unknown}, which isn't an item's field.`, field: "file", fix: `An item takes ${ITEM_FILE_FIELDS.join(", ")}.` });
    }
    const names = wanted.map((gameItem) => gameItem.item_name);
    const repeated = names.find((name, i) => names.indexOf(name) !== i);
    if (repeated) refuse("bad_item", { message: `${repeated} is in the file twice.`, field: "file", fix: "Give each item once." });
    const current = (await api("GET", path)).items;
    const same = (gameItem, existing) => ITEM_FILE_FIELDS.every((field) => JSON.stringify(gameItem[field] ?? null) === JSON.stringify(existing[field] ?? null));
    const changed = wanted.filter((gameItem) => { const existing = current.find((other) => other.item_name === gameItem.item_name); return !existing || !same(gameItem, existing); });
    const gone = current.filter((existing) => !names.includes(existing.item_name));
    const setNames = [];
    for (const gameItem of changed) {
      const { item_name: itemName, ...fields } = gameItem;
      for (const field of ITEM_FILE_FIELDS.slice(1)) if (!(field in fields)) fields[field] = field === "local_prices" ? [] : field === "description" ? "" : null;
      for (const key of ["card_fee_note", "created_at", "updated_at"]) delete fields[key];
      await api("PUT", `${path}/${encodeURIComponent(itemName)}`, fields);
      setNames.push(itemName);
      say(`Set ${itemName}.`);
    }
    const removedNames = [];
    const keptNames = [];
    for (const existing of gone) {
      try {
        await api("DELETE", `${path}/${encodeURIComponent(existing.item_name)}`);
        removedNames.push(existing.item_name);
        say(`Removed ${existing.item_name}.`);
      } catch (error) {
        if (!(error instanceof CommandError) || error.error.code !== "item_has_owners") throw error;
        keptNames.push(existing.item_name);
      }
    }
    const answer = await api("GET", path);
    if (keptNames.length) {
      refuse("item_has_owners", { message: `Players own ${keptNames.join(", ")}, so ${keptNames.length === 1 ? "it stays" : "they stay"}; everything else matches the file.`, field: "file", fix: "Keep them in the file with price_minor_units and currency_code null to stop selling them." }, EXIT_CODES.failed);
    }
    if (isJson) return printJson({ ...answer, set_item_names: setNames, removed_item_names: removedNames });
    if (!setNames.length && !removedNames.length) console.log(`${values.slug}'s items already match the file.`);
    return;
  }
  const answer = await api("GET", path);
  if (isJson) return printJson(answer);
  if (!answer.items.length) console.log(`${values.slug} sells nothing yet. Set its items with: zaisma items set ${values.slug} items.json`);
  for (const gameItem of answer.items) console.log(`${gameItem.item_name.padEnd(24)} ${gameItem.item_kind.padEnd(11)} ${gameItem.item_category.padEnd(9)} ${itemPriceText(gameItem)}`);
  console.log(`Refund policy: ${answer.refund_policy === "own_words" ? answer.refund_policy_text : (answer.refund_policy ?? "none yet (set_purchase_settings), needed before anything goes on sale")}`);
}

/** A game's kept rooms (…/games/<slug>/kept-rooms…), as the MCP's list_kept_rooms and delete_kept_room. */
async function keptRooms(command, values) {
  if (command === "kept-rooms") {
    const answer = await api("GET", `/games/${values.slug}/kept-rooms`);
    if (isJson) return printJson(answer);
    if (!answer.kept_rooms.length) console.log(`No kept rooms. A game server keeps one with room.setKept(true).`);
    for (const keptRoom of answer.kept_rooms) console.log(`${keptRoom.room_code}  ${(keptRoom.name ?? "").padEnd(24)} ${sizeText(keptRoom.saved_size_bytes).padStart(9)}  played ${keptRoom.last_played_at ? when(keptRoom.last_played_at) : "never"}`);
    console.log(`Storage: ${sizeText(answer.storage_size_bytes)} of the ${sizeText(answer.maximum_storage_size_bytes)} a game can keep (database and kept rooms).`);
    return;
  }
  const answer = await api("DELETE", `/games/${values.slug}/kept-rooms/${encodeURIComponent(values.room_code)}`);
  if (isJson) return printJson(answer);
  console.log(`Deleted kept room ${values.room_code.toUpperCase()} from ${values.slug}, and its world with it.`);
}

/** A game server's logs (GET …/games/<slug>/logs), as the MCP's get_logs; --follow asks for new lines every 2 seconds. */
async function logs(values, flags) {
  if (flags.follow && flags.cursor) refuse("conflicting_flags", { message: "--follow prints new lines, and --cursor older ones.", field: "cursor", fix: `Use one: zaisma logs ${values.slug} --follow, or zaisma logs ${values.slug} --cursor <next_cursor>.` });
  const filters = {};
  for (const [flag, input] of [["room-code", "room_code"], ["minimum-level", "minimum_level"], ["source-kind", "source_kind"], ["search-text", "search_text"], ["maximum-line-count", "maximum_line_count"], ["cursor", "cursor"]]) if (flags[flag] !== undefined) filters[input] = flags[flag];
  const ask = (more) => api("GET", `/games/${values.slug}/logs?${new URLSearchParams({ ...filters, ...more }).toString()}`);
  const print = (answer) => {
    if (isJson) {
      // Followed, each answer is one line of JSON.
      if (flags.follow) process.stdout.write(`${JSON.stringify(answer)}\n`);
      else printJson(answer);
      return;
    }
    for (const line of answer.log_lines) console.log(`${line.logged_at.slice(11, 23)} ${line.level.padEnd(5)} ${line.room_code ?? line.source_kind}  ${line.text}`);
  };
  let answer = await ask({});
  print(answer);
  if (!flags.follow) {
    if (!isJson && !answer.log_lines.length) console.log(`No lines from ${values.slug}'s game server${Object.keys(filters).length ? " that match" : ""} in the last 30 days.`);
    if (!isJson && answer.next_cursor) console.log(`Older lines: zaisma logs ${values.slug} --cursor ${answer.next_cursor}`);
    return;
  }
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    answer = await ask({ new_lines_cursor: answer.new_lines_cursor });
    print(answer);
  }
}

/** A secret's value: piped in (without the line break at its end), or typed in a terminal without showing it. */
async function readSecretValue(secretName) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  process.stderr.write(`${secretName} (it isn't shown; Enter when done): `);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  let typed = "";
  try {
    for await (const chunk of process.stdin) {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") return typed;
        if (character === "\u0003") process.exit(130);
        if (character === "\u007f" || character === "\b") typed = typed.slice(0, -1);
        else typed += character;
      }
    }
    return typed;
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stderr.write("\n");
  }
}

/** A game's cloud saves (…/games/<slug>/saves…), as the MCP's list_saves, get_save, change_save, replace_save, reset_save, list_save_copies, get_save_copy and restore_save_copy. */
async function saves(command, values, flags) {
  const savePath = () => `/games/${values.slug}/saves/${encodeURIComponent(values.player_id)}`;
  if (command === "saves") {
    const answer = await api("GET", `/games/${values.slug}/saves${flags.cursor ? `?cursor=${encodeURIComponent(flags.cursor)}` : ""}`);
    if (isJson) return printJson(answer);
    if (!answer.saves.length) console.log("No saves yet. Players' progress shows up here once they play signed in with cloud saves on.");
    for (const save of answer.saves) console.log(`${save.player_id}  ${save.saved_at.slice(0, 16).replace("T", " ")}  ${sizeText(save.size_bytes).padStart(8)}  ${save.changed_by_kind === "developer" ? "changed by you" : "saved by the game"}${save.save_copy_count ? `, ${save.save_copy_count} earlier` : ""}`);
    if (answer.next_cursor) console.log(`\nMore: zaisma saves ${values.slug} --cursor ${answer.next_cursor}`);
    return;
  }
  if (command === "saves get" || command === "saves copy") {
    const keys = readKeys(flags.keys);
    const query = keys ? `?${keys.map((key) => `keys=${encodeURIComponent(key)}`).join("&")}` : "";
    const answer = await api("GET", command === "saves get" ? `${savePath()}${query}` : `${savePath()}/copies/${encodeURIComponent(values.save_copy_id)}${query}`);
    if (isJson) return printJson(answer);
    const save = answer.save ?? answer.save_copy;
    console.log(answer.save ? `${sizeText(save.size_bytes)}, ${save.changed_by_kind === "developer" ? "changed by you" : "saved by the game"} ${when(save.saved_at)}.` : `Saved ${when(save.saved_at)} (${save.copy_reason})${save.is_current_save ? ", the same as the save now" : ""}.`);
    for (const [key, itemText] of Object.entries(save.local_storage_items)) console.log(`${key} = ${itemText}`);
    for (const key of save.missing_keys) console.log(`${key}: not in the save`);
    if (save.indexeddb_databases?.length) console.log(`IndexedDB: ${save.indexeddb_databases.map((database) => database.name).join(", ")} (--json shows them)`);
    return;
  }
  if (command === "saves copies") {
    const answer = await api("GET", `${savePath()}/copies`);
    if (isJson) return printJson(answer);
    if (!answer.save_copies.length) console.log("No earlier versions yet.");
    for (const copy of answer.save_copies) console.log(`${copy.id}  ${copy.saved_at.slice(0, 16).replace("T", " ")}  ${sizeText(copy.size_bytes).padStart(8)}  ${copy.copy_reason}${copy.is_current_save ? "  (the save now)" : ""}`);
    return;
  }
  let answer;
  if (command === "saves reset") answer = await api("DELETE", savePath());
  else if (command === "saves restore") answer = await api("POST", `${savePath()}/copies/${encodeURIComponent(values.save_copy_id)}/restore`);
  else if (command === "saves change") {
    const text = values.items_json ?? (await readInput());
    let items;
    try {
      items = JSON.parse(text);
    } catch {}
    if (!items || typeof items !== "object" || Array.isArray(items)) {
      refuse("bad_local_storage_items", { message: "The keys to change aren't a JSON object.", field: "items_json", fix: `Give them in single quotes, like '{"coins": "500", "tutorial_seen": null}' (text values; null removes a key), or pipe them in.` });
    }
    answer = await api("PATCH", savePath(), { local_storage_items: items });
  } else {
    const text = values.file ? await readFile(values.file, "utf8").catch(() => refuse("not_a_file", { message: `Couldn't read ${values.file}.`, field: "file", fix: "Give the path of a JSON file of the save, or pipe it in." })) : await readInput();
    let given;
    try {
      given = JSON.parse(text);
    } catch {}
    // What zaisma saves get --json printed works as it is.
    const save = given?.save ?? given;
    if (!save || typeof save !== "object" || save.local_storage_items === undefined || save.indexeddb_databases === undefined) {
      refuse("bad_local_storage_items", { message: `${values.file ?? "What was piped in"} isn't a JSON save with local_storage_items and indexeddb_databases.`, field: "file", fix: 'Give a JSON object like {"local_storage_items": {"coins": "0"}, "indexeddb_databases": []}, or what zaisma saves get <slug> <player_id> --json printed, changed.' });
    }
    answer = await api("PUT", savePath(), { local_storage_items: save.local_storage_items, indexeddb_databases: save.indexeddb_databases });
  }
  if (isJson) return printJson(answer);
  const done = { "saves reset": "Reset", "saves restore": "Restored", "saves change": "Changed", "saves replace": "Replaced" }[command];
  console.log(`${done} ${values.player_id}'s save in ${values.slug}. An open game reloads with it.`);
  if (answer.kept_save_copy_id) console.log(`The save it replaced is kept: undo with zaisma saves restore ${values.slug} ${values.player_id} ${answer.kept_save_copy_id}`);
}

/** --keys: a JSON list of localStorage keys, or null without it. */
function readKeys(given) {
  if (given === undefined) return null;
  let keys;
  try {
    keys = JSON.parse(given);
  } catch {}
  if (!Array.isArray(keys) || !keys.length || !keys.every((key) => typeof key === "string" && key)) refuse("bad_keys", { message: "--keys isn't a JSON list of localStorage keys.", field: "--keys", fix: `Give them as a JSON list in single quotes, like --keys '["coins", "level"]'.` });
  return keys;
}

const sizeText = (sizeBytes) => (sizeBytes < 1024 ? `${sizeBytes} B` : sizeBytes < 1048576 ? `${(sizeBytes / 1024).toFixed(1)} KB` : sizeBytes < 1024 ** 3 ? `${(sizeBytes / 1048576).toFixed(1)} MB` : `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`);

/** A statement's rows as a table, then what it read and wrote. Blobs show their size. */
function printRows({ rows, read_row_count: readRowCount, written_row_count: writtenRowCount }) {
  const shown = (cell) => (cell === null ? "NULL" : typeof cell === "object" ? `<blob, ${Math.floor((cell.blob_base64.replace(/=+$/, "").length * 3) / 4)} bytes>` : String(cell));
  if (rows.length) {
    const columns = Object.keys(rows[0]);
    const widths = columns.map((column) => Math.min(40, Math.max(column.length, ...rows.map((row) => shown(row[column]).length))));
    const line = (cells) => cells.map((cell, i) => (cell.length > widths[i] ? `${cell.slice(0, widths[i] - 1)}…` : cell.padEnd(widths[i]))).join("  ").trimEnd();
    console.log(line(columns));
    for (const row of rows) console.log(line(columns.map((column) => shown(row[column]))));
  }
  console.log(`${rows.length} row${rows.length === 1 ? "" : "s"}. Read ${readRowCount}, wrote ${writtenRowCount}.`);
}

/** Runs the command and answers with how it ended (EXIT_CODES); a failure throws a CommandError. */
async function run({ command, values, flags, globalFlags, rest }) {
  if (command === "help" || globalFlags.help) {
    // zaisma help upload is zaisma upload --help.
    const about = command === "help" ? rest.join(" ") : command;
    if (about && !COMMANDS[about]) refuse("unknown_command", { message: `There's no command "${about}".`, fix: `Run zaisma help. The commands: ${Object.keys(COMMANDS).join(", ")}.` });
    if (isJson) printJson(helpAnswer());
    else console.log(about ? `${usage(about)}\n${COMMANDS[about].about}.\n\n${helpText()}` : helpText());
    return EXIT_CODES.done;
  }
  if (command === "games") {
    const answer = await api("GET", "/games");
    if (isJson) return printAnswer(answer);
    const { games, unread_topic_count: unreadTopicCount } = answer;
    if (!games.length) console.log('No games yet. Make one with: zaisma new "My Game"');
    for (const game of games) {
      console.log(`${game.slug.padEnd(28)} ${game.visibility.padEnd(9)} ${game.review_status.padEnd(8)} ${game.title}${game.review_reason ? `  [${reasonCode(game)}]` : ""}`);
      // What needs attention in it, most urgent first.
      for (const alert of game.alerts ?? []) console.log(`  ! ${alert.message}`);
    }
    if (unreadTopicCount) console.log(`\nZaisma replied to ${unreadTopicCount} of your forum topics. See them with: zaisma forum`);
    return EXIT_CODES.done;
  }
  if (command === "new") {
    const answer = await api("POST", "/games", { title: values.title, ...(flags.slug ? { slug: flags.slug } : {}) });
    if (isJson) return printAnswer(answer);
    console.log(`Made ${answer.game.page_url} (a draft). Upload it with: zaisma upload <folder> --game ${answer.game.slug}`);
    return EXIT_CODES.done;
  }
  if (command === "check") return checkFolder(values, flags);
  if (command === "play-locally") return playLocally(values, flags);
  if (command === "export") return exportGame(values, flags);
  if (command === "upload") return upload(values, flags);
  if (command === "shader") return sendShader(values, flags);
  if (command === "versions") {
    const answer = await api("GET", `/games/${values.slug}`);
    if (isJson) return printAnswer(answer);
    for (const version of answer.versions) {
      const status = (version.is_live ? "live" : version.scan_status).padEnd(9);
      const link = version.preview_url ?? (version.scan_status === "held" || version.scan_status === "rejected" ? `[${reasonCode(version)}]` : "");
      console.log(`${version.id}  ${version.created_at.slice(0, 16).replace("T", " ")}  ${status} ${link}${version.scheduled_publish_at ? `  goes live ${when(version.scheduled_publish_at)}` : ""}`);
    }
    return EXIT_CODES.done;
  }
  if (command === "publish") {
    const { slug, version_id: versionId } = values;
    const scheduledPublishAt = flags["scheduled-publish-at"] === undefined ? undefined : checkPublishTime(flags["scheduled-publish-at"]);
    const matchUpdateMode = flags["match-update-mode"];
    const publishBody = { ...(scheduledPublishAt ? { scheduled_publish_at: scheduledPublishAt } : {}), ...(matchUpdateMode !== undefined ? { match_update_mode: matchUpdateMode } : {}) };
    const answer = await api("POST", `/games/${slug}/versions/${versionId}/publish`, Object.keys(publishBody).length ? publishBody : undefined);
    if (isJson) return printAnswer(answer);
    const { game, version } = answer;
    if (scheduledPublishAt) console.log(`Version ${versionId} will go live at ${when(version.scheduled_publish_at)}${version.scan_status === "scanning" ? ", if it has passed the scan by then" : ""}.`);
    else {
      console.log(`Version ${versionId} is live at ${game.page_url}${matchUpdateMode === "now" ? "; running matches switch to it within seconds" : ""}`);
      if (game.visibility === "draft") console.log(`The game is still a draft, so only you can see it. Show it to everyone with: zaisma visibility ${slug} listed`);
    }
    return EXIT_CODES.done;
  }
  if (command === "unschedule") {
    const answer = await api("DELETE", `/games/${values.slug}/versions/${values.version_id}/publish`);
    if (isJson) return printAnswer(answer);
    console.log(`Version ${values.version_id} won't be published by itself.`);
    return EXIT_CODES.done;
  }
  if (command === "visibility") {
    const answer = await api("PATCH", `/games/${values.slug}`, { visibility: values.visibility });
    if (isJson) return printAnswer(answer);
    console.log(`${answer.game.title} is now ${answer.game.visibility}.`);
    return EXIT_CODES.done;
  }
  if (command === "allowed-hosts") await allowedHosts(values, flags);
  else if (command === "own-servers") await ownServers(values, flags);
  else if (command === "links" || command.startsWith("links ")) await links(command, values, flags);
  else if (command === "secrets" || command.startsWith("secrets ")) await secrets(command, values);
  else if (command === "items" || command.startsWith("items ")) await items(command, values);
  else if (command === "kept-rooms" || command.startsWith("kept-rooms ")) await keptRooms(command, values);
  else if (command === "logs") await logs(values, flags);
  else if (command === "database" || command.startsWith("database ")) await database(command, values, flags);
  else if (command === "saves" || command.startsWith("saves ")) await saves(command, values, flags);
  else await forum(command, values, flags);
  return EXIT_CODES.done;
}

/**
 * play-locally: the game server package's command, run through npx so this command stays free of dependencies
 * (ZAISMA_GAME_SERVER_BIN, a path to its bin/node.js, is for tests and the repository). Its output and exit code
 * come through as they are; with --json it prints { bench_url, game_site_url, rooms_url, network_url } once listening.
 */
async function playLocally(values, flags) {
  const { spawn } = await import("node:child_process");
  const given = [values.folder ?? ".", ...(flags.port !== undefined ? ["--port", flags.port] : []), ...(flags.game !== undefined ? ["--game", flags.game] : []), ...(flags["on-network"] ? ["--on-network"] : []), ...(flags["no-open"] ? ["--no-open"] : []), ...(isJson ? ["--json"] : [])];
  const { existsSync: isThere } = await import("node:fs");
  const { dirname: folderOf, join: joinPath } = await import("node:path");
  const local = process.env.ZAISMA_GAME_SERVER_BIN;
  // npm's npx run through this Node, where npm keeps it beside Node (Windows) or under lib/ (macOS, Linux): a .cmd can't be spawned without a shell on Windows.
  const npxScript = [joinPath(folderOf(process.execPath), "node_modules/npm/bin/npx-cli.js"), joinPath(folderOf(process.execPath), "../lib/node_modules/npm/bin/npx-cli.js")].find((path) => isThere(path));
  const npxArguments = ["--yes", "@zaisma/game-server@1", "play-locally", ...given];
  const [file, list] = local ? [process.execPath, [local, "play-locally", ...given]] : npxScript ? [process.execPath, [npxScript, ...npxArguments]] : ["npx", npxArguments];
  let child;
  try {
    child = spawn(file, list, { stdio: "inherit" });
  } catch {
    refuse("game_server_not_run", { message: "npx couldn't run @zaisma/game-server.", fix: "Check that Node 22.18 or newer and npm are installed, and that npm can reach its registry once to download the package." }, EXIT_CODES.failed);
  }
  // Ctrl-C reaches the child from the terminal by itself; a SIGTERM sent to this command alone is passed on.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  const exitCode = await new Promise((done) => {
    child.on("error", () => done(null));
    // Stopped by a signal (Ctrl-C) is a stop, not a failure.
    child.on("exit", (code, signal) => done(code ?? (signal ? 0 : 1)));
  });
  if (exitCode === null) refuse("game_server_not_run", { message: "npx couldn't run @zaisma/game-server.", fix: "Check that Node 22.18 or newer and npm are installed, and that npm can reach its registry once to download the package." }, EXIT_CODES.failed);
  return exitCode === 0 ? EXIT_CODES.done : { exitCode, meaning: "play-locally stopped" };
}

/** A failure, in the API's shape: with --json the { error } on stdout, otherwise one line on stderr. */
function printError(error) {
  if (isJson) printJson({ error });
  else console.error(`zaisma: ${error.message} ${error.fix ?? ""}${error.code ? ` (${error.code})` : ""}`.replace(/ +\(/, " ("));
}

try {
  process.exitCode = (await run(parseCommandLine(process.argv.slice(2)))).exitCode;
} catch (error) {
  if (error instanceof CommandError) {
    printError(error.error);
    process.exitCode = error.exitCode;
  } else {
    printError({ code: "internal_error", message: `The command broke: ${error.message}`, field: null, fix: "Run it again. If it keeps happening, tell Zaisma: zaisma forum post --kind bug --category cli.", retry_after_sec: null });
    process.exitCode = EXIT_CODES.failed.exitCode;
  }
}
