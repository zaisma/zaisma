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
  zaisma feedback [--search "words"]       Your feedback to Zaisma, and the known issues
  zaisma feedback <id>                      One item with every post, or a known issue
  zaisma feedback send --kind bug|gap|feature|question --title "…" --text "…" [--game <slug>]
                                            Tell Zaisma about a bug, a gap, an idea or a question
  zaisma feedback add <id> --text "…" [--reopen]
                                            Add to an item, reopen it, or add your case to a known issue
        [--by-me]                           Mark a post as written by you; otherwise it says your AI wrote it

Set ZAISMA_KEY to an API key from https://zaisma.com/account (under Game developers).
Without installing: npx @zaisma/cli <command>. Installed (npm i -g @zaisma/cli): zaisma <command>.`;

function fail(message) {
  console.error(`zaisma: ${message}`);
  process.exit(1);
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else out[a.slice(2)] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

async function api(method, path, body) {
  if (!KEY) fail("set ZAISMA_KEY to an API key from https://zaisma.com/account first.");
  const res = await fetch(`${API}/api/dev${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "x-zaisma-client": "cli", ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}) },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(data.error?.message ?? `the server answered ${res.status}.`);
  return data;
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
    createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

async function sendInParts(f, progress) {
  const start = await api("POST", `/files/${f.sha256}/parts`, { size_bytes: f.size_bytes });
  if (start.storage_status === "already_stored") return;
  const file = await open(f.full);
  const parts = [];
  try {
    for (let n = 1, offset = 0; offset < f.size_bytes; n++, offset += start.part_size_bytes) {
      const chunk = new Uint8Array(Math.min(start.part_size_bytes, f.size_bytes - offset));
      await file.read(chunk, 0, chunk.length, offset);
      const part = await api("PUT", `/files/${f.sha256}/parts/${n}?upload_id=${encodeURIComponent(start.upload_id)}`, chunk);
      parts.push({ part_number: part.part_number, etag: part.etag });
      progress(offset + chunk.length);
    }
  } finally {
    await file.close();
  }
  await api("POST", `/files/${f.sha256}/parts/done`, { upload_id: start.upload_id, parts });
}

const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(folder, opts) {
  const slug = opts.game;
  if (!folder || typeof slug !== "string") fail("usage: zaisma upload <folder> --game <slug>");
  if (!(await stat(folder).catch(() => null))?.isDirectory()) fail(`${folder} isn't a folder.`);

  const paths = await walk(folder);
  console.log(`Checking ${paths.length} files…`);
  const files = [];
  for (const full of paths) {
    files.push({ path: relative(folder, full).split(sep).join("/"), sha256: await sha256(full), size_bytes: (await stat(full)).size, full });
  }
  const list = files.map(({ full: _, ...f }) => f);
  const plan = await api("POST", `/games/${slug}/uploads`, { files: list });
  const todo = files.filter((f, i) => plan.missing_file_hashes.includes(f.sha256) && files.findIndex((g) => g.sha256 === f.sha256) === i);
  const total = todo.reduce((n, f) => n + f.size_bytes, 0);
  console.log(todo.length ? `Sending ${todo.length} new or changed files (${size(total)})…` : "Nothing changed since your last upload; making a version from the stored files.");

  let sent = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        if (f.size_bytes > DIRECT_BYTES) await sendInParts(f, (n) => process.stdout.write(`\r  ${size(sent + n)} of ${size(total)}   `));
        else await api("PUT", `/files/${f.sha256}`, new Uint8Array(await readFile(f.full)));
        sent += f.size_bytes;
        process.stdout.write(`\r  ${size(sent)} of ${size(total)}   `);
      }
    }),
  );
  if (todo.length) process.stdout.write("\n");

  const { version } = await api("POST", `/games/${slug}/versions`, { files: list, patch_notes: typeof opts["patch-notes"] === "string" ? opts["patch-notes"] : "", publish_when_approved: opts["publish-when-approved"] === true });
  console.log(`Version ${version.id} is being scanned. This usually takes under a minute…`);

  for (let i = 0; i < 200; i++) {
    await sleep(3000);
    const { version: v } = await api("GET", `/games/${slug}/versions/${version.id}`);
    if (v.scan_status === "scanning") continue;
    if (v.scan_status === "approved") {
      if (v.is_live) console.log(`Passed and live: ${API}/g/${slug}`);
      else {
        console.log(`Passed. Your private preview: ${v.preview_url}`);
        console.log(`Publish it with: zaisma publish ${slug} ${v.id}`);
      }
    } else {
      console.log(v.scan_status === "held" ? "Held: a person will look at it, usually within a day. What the scan found:" : "Rejected. What the scan found:");
      for (const f of v.findings) console.log(`  - ${f.explanation}${f.path ? ` (${f.path})` : ""}`);
      if (v.scan_status === "rejected") process.exit(1);
    }
    return;
  }
  console.log(`Still scanning. Check later with: zaisma versions ${slug}`);
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function printKnown(k) {
  console.log(`${k.id}  ${k.status.padEnd(8)} ${k.title}  (${k.developers} developer${k.developers === 1 ? "" : "s"}${k.roadmap ? `, roadmap: ${k.roadmap}` : ""})`);
  if (k.workaround) console.log(`    Until it's fixed: ${k.workaround}`);
}

/** Text from --text, or piped in. */
async function readText(opts) {
  if (typeof opts.text === "string") return opts.text;
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** Feedback to Zaisma. Posts say an AI wrote them unless --by-me says the developer did. */
async function feedback(opts) {
  const [sub, id] = opts._;
  const by = opts["by-me"] ? { author: "person" } : {};
  if (sub === "send") {
    const text = await readText(opts);
    if (typeof opts.kind !== "string" || typeof opts.title !== "string" || !text) fail('usage: zaisma feedback send --kind bug|gap|feature|question --title "…" --text "…" [--game <slug>]');
    const out = await api("POST", "/feedback", { kind: opts.kind, title: opts.title, text, ...(typeof opts.game === "string" ? { game: opts.game } : {}), ...by });
    console.log(`Sent (${out.feedback.id}). Zaisma will reply here: zaisma feedback ${out.feedback.id}`);
    if (out.secrets_removed) console.log(`${out.secrets_removed} secret${out.secrets_removed === 1 ? " was" : "s were"} blanked before it was stored.`);
    if (out.matches.length) {
      console.log("\nKnown issues that look like the same problem:");
      for (const k of out.matches) printKnown(k);
    }
    return;
  }
  if (sub === "add") {
    const text = await readText(opts);
    if (!id || !text) fail('usage: zaisma feedback add <id> --text "…" [--reopen]');
    const out = await api("POST", `/feedback/${id}/posts`, { text, ...(opts.reopen ? { reopen: true } : {}), ...by });
    console.log(`Added to ${out.feedback.id} (${out.feedback.status}).`);
    return;
  }
  if (sub) {
    const out = await api("GET", `/feedback/${sub}`);
    if (!out.feedback) return printKnown(out.known_issue);
    const f = out.feedback;
    console.log(`${f.title}\n${f.kind}, ${f.status}${f.game ? `, ${f.game}` : ""}`);
    if (f.known_issue) printKnown(f.known_issue);
    for (const p of f.posts) console.log(`\n${day(p.at)}  ${p.by}${p.kind === "reopen" ? " (reopened)" : ""}:\n${p.text}${p.picture_url ? `\n[screenshot] ${p.picture_url}` : ""}`);
    return;
  }
  const q = typeof opts.search === "string" ? `?q=${encodeURIComponent(opts.search)}` : "";
  const { mine, known_issues } = await api("GET", `/feedback${q}`);
  console.log(mine.length ? "Yours (* has a reply you haven't read):" : "You haven't sent any feedback yet.");
  for (const f of mine) console.log(`${f.id}  ${f.status.padEnd(8)} ${f.news ? "* " : "  "}${f.title}`);
  if (known_issues.length) {
    console.log("\nKnown issues:");
    for (const k of known_issues) printKnown(k);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  if (!command || command === "help" || command === "--help" || command === "-h") return console.log(HELP);
  // Flags renamed to match the API's names (docs/NAMING.md). Said out loud, so an old one isn't quietly ignored.
  const renamed = { notes: "patch-notes", publish: "publish-when-approved", at: "scheduled-publish-at" };
  for (const [old, now] of Object.entries(renamed)) if (old in opts) fail(`--${old} is now --${now}.`);

  if (command === "games") {
    const { games, unread_topic_count } = await api("GET", "/games");
    if (!games.length) return console.log('No games yet. Make one with: zaisma new "My Game"');
    for (const g of games) console.log(`${g.slug.padEnd(28)} ${g.visibility.padEnd(9)} ${g.review_status.padEnd(8)} ${g.title}`);
    if (unread_topic_count) console.log(`\nZaisma replied to ${unread_topic_count} of your forum topics. See them with: zaisma feedback`);
    return;
  }
  if (command === "new") {
    const title = opts._.join(" ");
    if (!title) fail('usage: zaisma new "My Game" [--slug my-game]');
    const { game } = await api("POST", "/games", { title, ...(typeof opts.slug === "string" ? { slug: opts.slug } : {}) });
    return console.log(`Made ${game.page_url} (a draft). Upload it with: zaisma upload <folder> --game ${game.slug}`);
  }
  if (command === "upload") return upload(opts._[0], opts);
  if (command === "versions") {
    const slug = opts._[0];
    if (!slug) fail("usage: zaisma versions <slug>");
    const { versions } = await api("GET", `/games/${slug}`);
    for (const v of versions) console.log(`${v.id}  ${v.created_at.slice(0, 16).replace("T", " ")}  ${(v.is_live ? "live" : v.scan_status).padEnd(9)} ${v.preview_url ?? ""}${v.scheduled_publish_at ? `  goes live ${new Date(v.scheduled_publish_at).toLocaleString()}` : ""}`);
    return;
  }
  if (command === "publish") {
    const [slug, id] = opts._;
    if (!slug || !id) fail("usage: zaisma publish <slug> <version>");
    const later = opts["scheduled-publish-at"];
    if (typeof later === "string") {
      const at = new Date(later.includes("T") || /z$|[+-]\d\d:?\d\d$/i.test(later) ? later : later.replace(" ", "T"));
      if (Number.isNaN(at.getTime())) fail('give --scheduled-publish-at as a date and time, like "2026-11-01 17:00".');
      const { version } = await api("POST", `/games/${slug}/versions/${id}/publish`, { scheduled_publish_at: at.toISOString() });
      console.log(`Version ${id} will go live at ${new Date(version.scheduled_publish_at).toLocaleString()}${version.scan_status === "scanning" ? ", if it has passed the scan by then" : ""}.`);
      return;
    }
    const { game } = await api("POST", `/games/${slug}/versions/${id}/publish`);
    console.log(`Version ${id} is live at ${game.page_url}`);
    if (game.visibility === "draft") console.log(`The game is still a draft, so only you can see it. Show it with: zaisma show ${slug} --visibility listed`);
    return;
  }
  if (command === "unschedule") {
    const [slug, id] = opts._;
    if (!slug || !id) fail("usage: zaisma unschedule <slug> <version>");
    await api("DELETE", `/games/${slug}/versions/${id}/publish`);
    return console.log(`Version ${id} won't be published by itself.`);
  }
  if (command === "show") {
    const slug = opts._[0];
    if (!slug || typeof opts.visibility !== "string") fail("usage: zaisma show <slug> --visibility listed|unlisted|private|draft");
    const { game } = await api("PATCH", `/games/${slug}`, { visibility: opts.visibility });
    return console.log(`${game.title} is now ${game.visibility}.`);
  }
  if (command === "feedback") return feedback(opts);
  fail(`unknown command "${command}". Run zaisma help.`);
}

main().catch((err) => fail(err.message));
