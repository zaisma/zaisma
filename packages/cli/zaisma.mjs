#!/usr/bin/env node
// The Zaisma upload command. No dependencies; Node 18 or newer.
// Docs: https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const API = (process.env.ZAISMA_API || "https://zaisma.com").replace(/\/+$/, "");
const KEY = process.env.ZAISMA_KEY || "";
/** Files bigger than this go in parts; the server says how big each part is. */
const DIRECT_BYTES = 95 * 1024 * 1024;
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX", ".git", "node_modules"]);

const HELP = `Usage:
  zaisma games                              List your games
  zaisma new <title> [--slug link-name]     Make a game (it starts as a draft)
  zaisma upload <folder> --game <slug>      Upload a version; only changed files are sent
        [--patch-notes "What changed"]      Patch notes, shown with the update
        [--publish-when-approved]           Go live as soon as it passes review
  zaisma versions <slug>                    List versions and preview links
  zaisma publish <slug> <version>           Publish a draft, or roll back to an older version
        [--scheduled-publish-at "2026-11-01 17:00"]  Publish later, at this time (your computer's time zone)
  zaisma unschedule <slug> <version>        Cancel a publish-later
  zaisma show <slug> [--visibility listed|unlisted|private|draft]
  zaisma forum [--search "words"]          Your forum topics and messages to Zaisma, or search the forum
  zaisma forum <topic id>                   A topic with every post you can see
  zaisma forum post --kind bug|gap|feature|question|talk --title "…" --category <category> --text "…"
                                            Start a public topic in the developer forum
  zaisma forum message --kind bug|gap|feature|question --title "…" --text "…" [--category <category>] [--game <slug>]
                                            A private message: only you and Zaisma see it
  zaisma forum reply <topic id> --text "…" [--reopen]
                                            Reply, or reopen your topic when something fixed is back
        [--by-me]                           Mark a post as written by you; otherwise it says your AI wrote it
  Categories: publishing, scans, pages, rooms, servers, passes, sdk, saves, stats, mcp, api, cli,
  accounts, dashboard, reports, rules, docs, other. Markdown works in --text, or pipe the text in.

Set ZAISMA_KEY to an API key from https://zaisma.com/account (under Game developers).
Without installing: npx @zaisma/cli <command>. Installed (npm i -g @zaisma/cli): zaisma <command>.`;

function fail(message) {
  console.error(`zaisma: ${message}`);
  process.exit(1);
}

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[argument.slice(2)] = true;
      else out[argument.slice(2)] = argv[++i];
    } else out._.push(argument);
  }
  return out;
}

async function api(method, path, body) {
  if (!KEY) fail("set ZAISMA_KEY to an API key from https://zaisma.com/account first.");
  const response = await fetch(`${API}/api/dev${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "x-zaisma-client": "cli", ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}) },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) fail(answer.error ? `${answer.error.message} ${answer.error.fix} (${answer.error.code})` : `the server answered ${response.status}.`);
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
  if (skipped.size) console.log(`Skipping hidden files: ${[...skipped].slice(0, 5).join(", ")}${skipped.size > 5 ? "…" : ""}`);
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

async function upload(folder, flags) {
  const slug = flags.game;
  if (!folder || typeof slug !== "string") fail("usage: zaisma upload <folder> --game <slug>");
  if (!(await stat(folder).catch(() => null))?.isDirectory()) fail(`${folder} isn't a folder.`);

  const paths = await walk(folder);
  console.log(`Checking ${paths.length} files…`);
  const files = [];
  for (const full of paths) {
    files.push({ path: relative(folder, full).split(sep).join("/"), sha256: await sha256(full), size_bytes: (await stat(full)).size, full });
  }
  const list = files.map(({ full: _, ...file }) => file);
  const plan = await api("POST", `/games/${slug}/uploads`, { files: list });
  const todo = files.filter((file, i) => plan.missing_file_hashes.includes(file.sha256) && files.findIndex((other) => other.sha256 === file.sha256) === i);
  const totalBytes = todo.reduce((sumBytes, file) => sumBytes + file.size_bytes, 0);
  console.log(todo.length ? `Sending ${todo.length} new or changed files (${readableSize(totalBytes)})…` : "Nothing changed since your last upload; making a version from the stored files.");

  let sentBytes = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        if (file.size_bytes > DIRECT_BYTES) await sendInParts(file, (partSentBytes) => process.stdout.write(`\r  ${readableSize(sentBytes + partSentBytes)} of ${readableSize(totalBytes)}   `));
        else await api("PUT", `/files/${file.sha256}`, new Uint8Array(await readFile(file.full)));
        sentBytes += file.size_bytes;
        process.stdout.write(`\r  ${readableSize(sentBytes)} of ${readableSize(totalBytes)}   `);
      }
    }),
  );
  if (todo.length) process.stdout.write("\n");

  const { version } = await api("POST", `/games/${slug}/versions`, { files: list, patch_notes: typeof flags["patch-notes"] === "string" ? flags["patch-notes"] : "", publish_when_approved: flags["publish-when-approved"] === true });
  console.log(`Version ${version.id} is being scanned. This usually takes under a minute…`);

  for (let i = 0; i < 200; i++) {
    await sleep(3000);
    const { version: checked } = await api("GET", `/games/${slug}/versions/${version.id}`);
    if (checked.scan_status === "scanning") continue;
    if (checked.scan_status === "approved") {
      if (checked.is_live) console.log(`Passed and live: ${API}/g/${slug}`);
      else {
        console.log(`Passed. Your private preview: ${checked.preview_url}`);
        console.log(`Publish it with: zaisma publish ${slug} ${checked.id}`);
      }
    } else {
      console.log(checked.scan_status === "held" ? "Held for a person at Zaisma to look at. Why:" : "Rejected. Why:");
      printReasons(checked);
      if (checked.scan_status === "rejected") process.exit(1);
    }
    return;
  }
  console.log(`Still scanning. Check later with: zaisma versions ${slug}`);
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

function printTopic(topic) {
  const countText = topic.is_known_issue ? `, ${topic.affected_developer_count} developer${topic.affected_developer_count === 1 ? "" : "s"} affected` : topic.vote_count ? `, ${topic.vote_count} vote${topic.vote_count === 1 ? "" : "s"}` : "";
  console.log(`${topic.id}  ${topic.topic_status.padEnd(13)} ${topic.is_unread ? "* " : "  "}${topic.title}  (${topic.is_known_issue ? "known issue" : topic.kind}${countText})`);
}

/** Text from --text, or piped in. */
async function readText(flags) {
  if (typeof flags.text === "string") return flags.text;
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** The developer forum. Posts say an AI wrote them unless --by-me says the developer did. */
async function forum(flags) {
  const [subcommand, id] = flags._;
  const by = flags["by-me"] ? { author_kind: "developer" } : {};
  const sent = (out) => {
    if (out.check_note) console.log(out.check_note);
    if (out.removed_secret_count) console.log(`${out.removed_secret_count} secret${out.removed_secret_count === 1 ? " was" : "s were"} blanked before it was stored.`);
  };
  if (subcommand === "post" || subcommand === "message") {
    const text = await readText(flags);
    const isMessage = subcommand === "message";
    const usage = isMessage
      ? 'usage: zaisma forum message --kind bug|gap|feature|question --title "…" --text "…" [--category <category>] [--game <slug>]'
      : 'usage: zaisma forum post --kind bug|gap|feature|question|talk --title "…" --category <category> --text "…"';
    if (typeof flags.kind !== "string" || typeof flags.title !== "string" || !text || (!isMessage && typeof flags.category !== "string")) fail(usage);
    const out = await api("POST", "/forum", {
      kind: flags.kind,
      title: flags.title,
      text_markdown: text,
      ...(typeof flags.category === "string" ? { category: flags.category } : {}),
      ...(isMessage ? { is_public: false, ...(typeof flags.game === "string" ? { game_slug: flags.game } : {}) } : {}),
      ...by,
    });
    console.log(`${isMessage ? "Sent to Zaisma" : "Posted"} (${out.topic.id}). Replies show here: zaisma forum ${out.topic.id}`);
    sent(out);
    if (out.similar_topics.length) {
      console.log("\nTopics that look like the same thing (vote or reply there if one is):");
      for (const topic of out.similar_topics) printTopic(topic);
    }
    return;
  }
  if (subcommand === "reply") {
    const text = await readText(flags);
    if (!id || !text) fail('usage: zaisma forum reply <topic id> --text "…" [--reopen]');
    const out = await api("POST", `/forum/${id}/posts`, { text_markdown: text, ...(flags.reopen ? { reopen: true } : {}), ...by });
    console.log(`Replied in ${id}.`);
    sent(out);
    return;
  }
  if (subcommand) {
    const { topic, posts } = await api("GET", `/forum/${subcommand}`);
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
  if (typeof flags.search === "string") {
    const { topics } = await api("GET", `/forum?detail=brief&search_text=${encodeURIComponent(flags.search)}`);
    if (!topics.length) console.log("Nothing matches that. Post it with: zaisma forum post");
    for (const topic of topics) printTopic(topic);
    return;
  }
  const [yours, messages] = await Promise.all([api("GET", "/forum?detail=brief&tab=yours"), api("GET", "/forum?detail=brief&tab=messages")]);
  console.log(yours.topics.length ? "Your topics (* has something new):" : "You haven't posted in the forum yet.");
  for (const topic of yours.topics) printTopic(topic);
  if (messages.topics.length) {
    console.log("\nYour messages to Zaisma:");
    for (const topic of messages.topics) printTopic(topic);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (!command || command === "help" || command === "--help" || command === "-h") return console.log(HELP);
  // Flags renamed to match the API's names (docs/NAMING.md). Said out loud, so an old one isn't quietly ignored.
  const renamed = { notes: "patch-notes", publish: "publish-when-approved", at: "scheduled-publish-at" };
  for (const [old, now] of Object.entries(renamed)) if (old in flags) fail(`--${old} is now --${now}.`);

  if (command === "games") {
    const { games, unread_topic_count: unreadTopicCount } = await api("GET", "/games");
    if (!games.length) return console.log('No games yet. Make one with: zaisma new "My Game"');
    for (const game of games) console.log(`${game.slug.padEnd(28)} ${game.visibility.padEnd(9)} ${game.review_status.padEnd(8)} ${game.title}${game.review_reason ? `  [${reasonCode(game)}]` : ""}`);
    if (unreadTopicCount) console.log(`\nZaisma replied to ${unreadTopicCount} of your forum topics. See them with: zaisma forum`);
    return;
  }
  if (command === "new") {
    const title = flags._.join(" ");
    if (!title) fail('usage: zaisma new "My Game" [--slug my-game]');
    const { game } = await api("POST", "/games", { title, ...(typeof flags.slug === "string" ? { slug: flags.slug } : {}) });
    return console.log(`Made ${game.page_url} (a draft). Upload it with: zaisma upload <folder> --game ${game.slug}`);
  }
  if (command === "upload") return upload(flags._[0], flags);
  if (command === "versions") {
    const slug = flags._[0];
    if (!slug) fail("usage: zaisma versions <slug>");
    const { versions } = await api("GET", `/games/${slug}`);
    for (const version of versions) console.log(`${version.id}  ${version.created_at.slice(0, 16).replace("T", " ")}  ${(version.is_live ? "live" : version.scan_status).padEnd(9)} ${version.preview_url ?? (version.scan_status === "held" || version.scan_status === "rejected" ? `[${reasonCode(version)}]` : "")}${version.scheduled_publish_at ? `  goes live ${new Date(version.scheduled_publish_at).toLocaleString()}` : ""}`);
    return;
  }
  if (command === "publish") {
    const [slug, id] = flags._;
    if (!slug || !id) fail("usage: zaisma publish <slug> <version>");
    const later = flags["scheduled-publish-at"];
    if (typeof later === "string") {
      const publishTime = new Date(later.includes("T") || /z$|[+-]\d\d:?\d\d$/i.test(later) ? later : later.replace(" ", "T"));
      if (Number.isNaN(publishTime.getTime())) fail('give --scheduled-publish-at as a date and time, like "2026-11-01 17:00".');
      const { version } = await api("POST", `/games/${slug}/versions/${id}/publish`, { scheduled_publish_at: publishTime.toISOString() });
      console.log(`Version ${id} will go live at ${new Date(version.scheduled_publish_at).toLocaleString()}${version.scan_status === "scanning" ? ", if it has passed the scan by then" : ""}.`);
      return;
    }
    const { game } = await api("POST", `/games/${slug}/versions/${id}/publish`);
    console.log(`Version ${id} is live at ${game.page_url}`);
    if (game.visibility === "draft") console.log(`The game is still a draft, so only you can see it. Show it with: zaisma show ${slug} --visibility listed`);
    return;
  }
  if (command === "unschedule") {
    const [slug, id] = flags._;
    if (!slug || !id) fail("usage: zaisma unschedule <slug> <version>");
    await api("DELETE", `/games/${slug}/versions/${id}/publish`);
    return console.log(`Version ${id} won't be published by itself.`);
  }
  if (command === "show") {
    const slug = flags._[0];
    if (!slug || typeof flags.visibility !== "string") fail("usage: zaisma show <slug> --visibility listed|unlisted|private|draft");
    const { game } = await api("PATCH", `/games/${slug}`, { visibility: flags.visibility });
    return console.log(`${game.title} is now ${game.visibility}.`);
  }
  if (command === "forum") return forum(flags);
  if (command === "feedback") fail("zaisma feedback is now zaisma forum: zaisma forum lists your topics, zaisma forum message sends Zaisma a private message.");
  fail(`unknown command "${command}". Run zaisma help.`);
}

main().catch((error) => fail(error.message));
