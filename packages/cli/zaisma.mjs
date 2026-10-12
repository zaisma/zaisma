#!/usr/bin/env node
// The Zaisma upload command. No dependencies; Node 18 or newer.
// Docs: https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const API = (process.env.ZAISMA_API || "https://zaisma.com").replace(/\/+$/, "");
const KEY = process.env.ZAISMA_KEY || "";
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "__MACOSX", ".git", "node_modules"]);

const HELP = `Usage:
  zaisma games                              List your games
  zaisma new <title> [--slug link-name]     Make a game (it starts as a draft)
  zaisma upload <folder> --game <slug>      Upload a version; only changed files are sent
        [--notes "What changed"]            Patch notes, shown with the update
        [--publish]                         Go live as soon as it passes review
  zaisma versions <slug>                    List versions and preview links
  zaisma publish <slug> <version>           Publish a draft, or roll back to an older version
  zaisma show <slug> [--visibility listed|unlisted|private|draft]

Set ZAISMA_KEY to an API key from https://zaisma.com/account (under Game developers).`;

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
    headers: { authorization: `Bearer ${KEY}`, ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}) },
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
    files.push({ path: relative(folder, full).split(sep).join("/"), sha256: await sha256(full), bytes: (await stat(full)).size, full });
  }
  const list = files.map(({ full: _, ...f }) => f);
  const plan = await api("POST", `/games/${slug}/uploads`, { files: list });
  const todo = files.filter((f, i) => plan.missing.includes(f.sha256) && files.findIndex((g) => g.sha256 === f.sha256) === i);
  const total = todo.reduce((n, f) => n + f.bytes, 0);
  console.log(todo.length ? `Sending ${todo.length} new or changed files (${size(total)})…` : "Nothing changed since your last upload; making a version from the stored files.");

  let sent = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        await api("PUT", `/files/${f.sha256}`, new Uint8Array(await readFile(f.full)));
        sent += f.bytes;
        process.stdout.write(`\r  ${size(sent)} of ${size(total)}   `);
      }
    }),
  );
  if (todo.length) process.stdout.write("\n");

  const { version } = await api("POST", `/games/${slug}/versions`, { files: list, notes: typeof opts.notes === "string" ? opts.notes : "", publish: opts.publish ? "when-approved" : undefined });
  console.log(`Version ${version.id} is being scanned. This usually takes under a minute…`);

  for (let i = 0; i < 200; i++) {
    await sleep(3000);
    const { version: v } = await api("GET", `/games/${slug}/versions/${version.id}`);
    if (v.scan === "scanning") continue;
    if (v.scan === "approved") {
      if (v.live) console.log(`Passed and live: ${API}/g/${slug}`);
      else {
        console.log(`Passed. Your private preview: ${v.preview_url}`);
        console.log(`Publish it with: zaisma publish ${slug} ${v.id}`);
      }
    } else {
      console.log(v.scan === "held" ? "Held: a person will look at it, usually within a day. What the scan found:" : "Rejected. What the scan found:");
      for (const f of v.findings ?? []) console.log(`  - ${f.detail}${f.path ? ` (${f.path})` : ""}`);
      if (v.scan === "rejected") process.exit(1);
    }
    return;
  }
  console.log(`Still scanning. Check later with: zaisma versions ${slug}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  if (!command || command === "help" || command === "--help" || command === "-h") return console.log(HELP);

  if (command === "games") {
    const { games } = await api("GET", "/games");
    if (!games.length) return console.log('No games yet. Make one with: zaisma new "My Game"');
    for (const g of games) console.log(`${g.slug.padEnd(28)} ${g.visibility.padEnd(9)} ${g.review.padEnd(8)} ${g.title}`);
    return;
  }
  if (command === "new") {
    const title = opts._.join(" ");
    if (!title) fail('usage: zaisma new "My Game" [--slug my-game]');
    const { game } = await api("POST", "/games", { title, ...(typeof opts.slug === "string" ? { slug: opts.slug } : {}) });
    return console.log(`Made ${game.url} (a draft). Upload it with: zaisma upload <folder> --game ${game.slug}`);
  }
  if (command === "upload") return upload(opts._[0], opts);
  if (command === "versions") {
    const slug = opts._[0];
    if (!slug) fail("usage: zaisma versions <slug>");
    const { versions } = await api("GET", `/games/${slug}`);
    for (const v of versions) console.log(`${v.id}  ${new Date(v.created_at).toISOString().slice(0, 16).replace("T", " ")}  ${(v.live ? "live" : v.scan).padEnd(9)} ${v.preview_url ?? ""}`);
    return;
  }
  if (command === "publish") {
    const [slug, id] = opts._;
    if (!slug || !id) fail("usage: zaisma publish <slug> <version>");
    const { game } = await api("POST", `/games/${slug}/versions/${id}/publish`);
    console.log(`Version ${id} is live at ${game.url}`);
    if (game.visibility === "draft") console.log(`The game is still a draft, so only you can see it. Show it with: zaisma show ${slug} --visibility listed`);
    return;
  }
  if (command === "show") {
    const slug = opts._[0];
    if (!slug || typeof opts.visibility !== "string") fail("usage: zaisma show <slug> --visibility listed|unlisted|private|draft");
    const { game } = await api("PATCH", `/games/${slug}`, { visibility: opts.visibility });
    return console.log(`${game.title} is now ${game.visibility}.`);
  }
  fail(`unknown command "${command}". Run zaisma help.`);
}

main().catch((err) => fail(err.message));
