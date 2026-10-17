#!/usr/bin/env node
// The Zaisma upload command. No dependencies; Node 18 or newer (22.13 or newer for .sqlite files).
// Docs: https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#the-upload-command

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const API = (process.env.ZAISMA_API || "https://zaisma.com").replace(/\/+$/, "");
const KEY = process.env.ZAISMA_KEY || "";
/** Files bigger than this go in parts; the server says how big each part is. */
const DIRECT_BYTES = 95 * 1024 * 1024;
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX", ".git", "node_modules"]);
/** How long upload waits for the scan (200 checks, 3 seconds apart) before it says it's still scanning. ZAISMA_SCAN_CHECK_INTERVAL_MS is for tests. */
const SCAN_CHECK_INTERVAL_MS = Number(process.env.ZAISMA_SCAN_CHECK_INTERVAL_MS) || 3000;
const SCAN_CHECK_COUNT = 200;
/** The most SQL database import sends at once (a single bigger statement goes on its own; the API takes up to 5 MB). ZAISMA_DUMP_PART_SIZE_BYTES is for tests. */
const DUMP_PART_SIZE_BYTES = Number(process.env.ZAISMA_DUMP_PART_SIZE_BYTES) || 4 * 1024 * 1024;
/** Files database export and import read and write as SQLite databases; any other name is SQL text. */
const SQLITE_EXTENSIONS = [".sqlite", ".sqlite3", ".db"];

/** The choices the API takes, checked before anything is sent (test/node/cli.test.ts holds them to the API's lists). */
const VISIBILITIES = ["listed", "unlisted", "private", "draft"];
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
};

/** The errors only the command itself answers with; every other code is the API's (ERROR_CODES in packages/core/src/errors.ts). */
const COMMAND_ERROR_CODES = {
  unknown_command: "There's no command by that name.",
  renamed_command: "The command has a new name; the error names it.",
  renamed_field: "The flag has a new name; the error names it.",
  repeated_field: "A flag was given twice.",
  missing_value: "A flag that takes a value was given none.",
  takes_no_value: "A flag that takes no value was given one.",
  not_a_folder: "The folder to upload isn't a folder.",
  not_a_file: "The file given (of statements, a dump to import, or a save) can't be read.",
  file_exists: "database export won't write over a file that's already there.",
  needs_newer_node: "Reading or writing a .sqlite file needs Node 22.13 or newer.",
  not_a_database: "The .sqlite file to import isn't a SQLite database.",
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
  upload: {
    about: "Upload a version; only changed files are sent",
    arguments: [{ name: "folder" }],
    flags: {
      game: { hasValue: true, isRequired: true, placeholder: "<slug>", about: "The game to upload to" },
      "patch-notes": { hasValue: true, placeholder: '"…"', about: "What changed, shown with the update" },
      "publish-when-approved": { hasValue: false, about: "Go live as soon as it passes review" },
    },
  },
  versions: { about: "List a game's versions and preview links", arguments: [{ name: "slug" }], flags: {} },
  publish: {
    about: "Publish a version that passed, or roll back to an older one",
    arguments: [{ name: "slug" }, { name: "version_id" }],
    flags: { "scheduled-publish-at": { hasValue: true, placeholder: "<time>", about: 'Publish later instead: an ISO 8601 time with Z or an offset, like "2026-11-01T17:00:00Z" or "2026-11-01T17:00+01:00"' } },
  },
  unschedule: { about: "Cancel a publish-later", arguments: [{ name: "slug" }, { name: "version_id" }], flags: {} },
  visibility: { about: "Set who can see a game: everyone (listed), people with the link (unlisted), or only you and tester links (private, draft)", arguments: [{ name: "slug" }, { name: "visibility", choices: VISIBILITIES }], flags: {} },
  "allowed-hosts": {
    about: "The hosts a game's server can call with fetch(), like discord.com or *.example.com; given hosts, set the whole list",
    arguments: [{ name: "slug" }, { name: "hosts", isRest: true, isOptional: true }],
    flags: { none: { hasValue: false, about: "Set the list to none: the game server calls no other servers" } },
  },
  secrets: { about: "A game's secrets, which its game server reads as server.secrets and room.secrets: their names and when each was set, never the values", arguments: [{ name: "slug" }], flags: {} },
  "secrets set": { about: "Set a secret for a game's server, replacing one of the same name: the value piped in, or typed without showing; it's never shown again", arguments: [{ name: "slug" }, { name: "secret_name" }], flags: {} },
  "secrets delete": { about: "Delete one of a game's secrets", arguments: [{ name: "slug" }, { name: "secret_name" }], flags: {} },
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
  help: { about: "This help; with --json, every command, flag, exit code and error code", arguments: [], flags: {} },
};
/** Commands with a second word, like zaisma forum post. */
const SUBCOMMANDS = { forum: ["post", "message", "reply"], database: ["query", "batch", "export", "import"], saves: ["get", "change", "replace", "reset", "copies", "copy", "restore"], secrets: ["set", "delete"] };
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
      headers: { authorization: `Bearer ${KEY}`, "x-zaisma-client": "cli", ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}) },
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

async function walk(root) {
  const files = [];
  const skipped = new Set();
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (JUNK.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.name.startsWith(".")) {
        skipped.add(relative(root, full));
        continue;
      }
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await visit(root);
  if (skipped.size) say(`Skipping hidden files: ${[...skipped].slice(0, 5).join(", ")}${skipped.size > 5 ? "…" : ""}`);
  return files;
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

const readableSize = (sizeBytes) => (sizeBytes >= 1048576 ? `${(sizeBytes / 1048576).toFixed(1)} MB` : `${Math.ceil(sizeBytes / 1024)} KB`);
const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));
/** A running count of what's sent, for people watching; left out with --json, where stdout is only the answer. */
const showProgress = (text) => isJson || process.stdout.write(`\r  ${text}   `);

/** Uploads a version and waits for its scan. With --json, prints the last version answer as-is; the exit code says how the scan went. */
async function upload({ folder }, flags) {
  const slug = flags.game;
  if (!(await stat(folder).catch(() => null))?.isDirectory()) refuse("not_a_folder", { message: `${folder} isn't a folder.`, field: "folder", fix: "Give the folder with the game's index.html at the top, like ./build." });

  const paths = await walk(folder);
  say(`Checking ${paths.length} files…`);
  const files = [];
  for (const full of paths) {
    files.push({ path: relative(folder, full).split(sep).join("/"), sha256: await sha256(full), size_bytes: (await stat(full)).size, full });
  }
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

  let answer = await api("POST", `/games/${slug}/versions`, { files: list, patch_notes: flags["patch-notes"] ?? "", publish_when_approved: flags["publish-when-approved"] === true });
  const versionId = answer.version.id;
  say(`Version ${versionId} is being scanned. This usually takes under a minute…`);

  for (let i = 0; i < SCAN_CHECK_COUNT && answer.version.scan_status === "scanning"; i++) {
    await sleep(SCAN_CHECK_INTERVAL_MS);
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

/** A game's own database (GET and POST /games/<slug>/database…), as the MCP's get_database, query_database, batch_database, export_database and import_database. */
async function database(command, values, flags) {
  if (command === "database export") return exportDatabase(values);
  if (command === "database import") return importDatabase(values);
  if (command === "database") {
    const answer = await api("GET", `/games/${values.slug}/database`);
    if (isJson) return printJson(answer);
    const use = answer.database_use_this_month;
    if (!answer.tables.length) console.log("No tables yet. Make one from your game server, or with: zaisma database query <slug> \"CREATE TABLE …\"");
    for (const table of answer.tables) console.log(`${table.sql};`);
    for (const index of answer.indexes) console.log(`${index.sql};`);
    const percent = (used, free) => `${Math.floor((used / free) * 100)}%`;
    console.log(
      `\nThis month: ${use.read_row_count.toLocaleString("en-US")} rows read (${percent(use.read_row_count, use.free_read_row_count)} of the free ${use.free_read_row_count.toLocaleString("en-US")}), ` +
        `${use.written_row_count.toLocaleString("en-US")} written (${percent(use.written_row_count, use.free_written_row_count)} of ${use.free_written_row_count.toLocaleString("en-US")}), ` +
        `${(use.storage_size_bytes / 1024 / 1024).toFixed(1)} MB stored (${percent(use.storage_size_bytes, use.free_storage_size_bytes)} of ${use.free_storage_size_bytes / 1024 / 1024} MB). Resets ${use.reset_date}.`,
    );
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
  console.log(`Saved ${slug}'s database to ${file} (${partCount} part${partCount === 1 ? "" : "s"}, ${readRowCount.toLocaleString("en-US")} rows read).${sqlite ? ` Run your game server on it with: node bin/node.js <server> --game ${slug} --database ${file}` : ""}`);
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
    for (const save of answer.saves) console.log(`${save.player_id}  ${save.updated_at.slice(0, 16).replace("T", " ")}  ${sizeText(save.size_bytes).padStart(8)}  ${save.changed_by_kind === "developer" ? "changed by you" : "saved by the game"}${save.save_copy_count ? `, ${save.save_copy_count} earlier` : ""}`);
    if (answer.next_cursor) console.log(`\nMore: zaisma saves ${values.slug} --cursor ${answer.next_cursor}`);
    return;
  }
  if (command === "saves get" || command === "saves copy") {
    const keys = readKeys(flags.keys);
    const query = keys ? `?${keys.map((key) => `keys=${encodeURIComponent(key)}`).join("&")}` : "";
    const answer = await api("GET", command === "saves get" ? `${savePath()}${query}` : `${savePath()}/copies/${encodeURIComponent(values.save_copy_id)}${query}`);
    if (isJson) return printJson(answer);
    const save = answer.save ?? answer.save_copy;
    console.log(answer.save ? `${sizeText(save.size_bytes)}, ${save.changed_by_kind === "developer" ? "changed by you" : "saved by the game"} ${when(save.updated_at)}.` : `Saved ${when(save.saved_at)} (${save.copy_reason})${save.is_current_save ? ", the same as the save now" : ""}.`);
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

const sizeText = (sizeBytes) => (sizeBytes < 1024 ? `${sizeBytes} B` : sizeBytes < 1048576 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${(sizeBytes / 1048576).toFixed(1)} MB`);

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
    for (const game of games) console.log(`${game.slug.padEnd(28)} ${game.visibility.padEnd(9)} ${game.review_status.padEnd(8)} ${game.title}${game.review_reason ? `  [${reasonCode(game)}]` : ""}`);
    if (unreadTopicCount) console.log(`\nZaisma replied to ${unreadTopicCount} of your forum topics. See them with: zaisma forum`);
    return EXIT_CODES.done;
  }
  if (command === "new") {
    const answer = await api("POST", "/games", { title: values.title, ...(flags.slug ? { slug: flags.slug } : {}) });
    if (isJson) return printAnswer(answer);
    console.log(`Made ${answer.game.page_url} (a draft). Upload it with: zaisma upload <folder> --game ${answer.game.slug}`);
    return EXIT_CODES.done;
  }
  if (command === "upload") return upload(values, flags);
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
    const answer = await api("POST", `/games/${slug}/versions/${versionId}/publish`, scheduledPublishAt ? { scheduled_publish_at: scheduledPublishAt } : undefined);
    if (isJson) return printAnswer(answer);
    const { game, version } = answer;
    if (scheduledPublishAt) console.log(`Version ${versionId} will go live at ${when(version.scheduled_publish_at)}${version.scan_status === "scanning" ? ", if it has passed the scan by then" : ""}.`);
    else {
      console.log(`Version ${versionId} is live at ${game.page_url}`);
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
  else if (command === "secrets" || command.startsWith("secrets ")) await secrets(command, values);
  else if (command === "database" || command.startsWith("database ")) await database(command, values, flags);
  else if (command === "saves" || command.startsWith("saves ")) await saves(command, values, flags);
  else await forum(command, values, flags);
  return EXIT_CODES.done;
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
