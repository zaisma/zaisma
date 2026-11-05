// The preview's test data, kept for every checkout on this machine (Julius, Nov 5, 2026), so a new checkout's first start takes seconds, not
// the two and a half minutes of adding it. It's the trade GitHub's Layout check makes with its own snapshot (check.yml): data made from the
// same seed files, at most 20 hours ago, so it never went through this checkout's changes to the Workers. npm run preview:start -- --reset
// always adds it for real, and leaves a new snapshot.
//   A snapshot is an APFS clone, a quarter of a second, which takes no disk until one side changes. It's made with the servers stopped, so
//   its databases are whole. A checkout takes one only when it has every migration the snapshot has, the same; the ones the snapshot lacks
//   are applied as they are to any kept data. macOS only, and never on GitHub's runners, which have their own.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LINE_DIRECTORY } from "./memory.mjs";

export const SNAPSHOT_DIRECTORY = join(LINE_DIRECTORY, "seeds");
export const SNAPSHOT_USE_LIMIT_MS = 20 * 60 * 60_000;
const KEPT_SNAPSHOT_COUNT = 2;
const MIGRATIONS_FILE = "snapshot-migrations.json";
// As check.yml's snapshot-name, and the engine samples the test data uploads, which GitHub's check leaves to its own job.
const SEED_FILES = ["scripts/preview", "examples", "review-set/listing-cases", "brand", "test/engines", ":!scripts/preview/background.mjs", ":!scripts/preview/memory.mjs", ":!scripts/preview/feedback-*", ":!scripts/preview/bench", ":!scripts/preview/servers.mjs", ":!scripts/preview/seed-snapshot.mjs"];
// What's made again at each start, or only the checkout's own.
const LEFT_OUT = ["v3/cache", "v3/observability", "built", "config", "registry", "tmp", "servers.log", "feedback.log"];

const git = (root, args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";

/** The name of the test data these seed files make for this address: the files as git has them, and any changed or new one's contents. */
export function seedKey({ root, phoneHost }) {
  const hash = createHash("sha256").update(phoneHost).update(git(root, ["ls-files", "-s", "--", ...SEED_FILES]));
  for (const file of git(root, ["ls-files", "-m", "-o", "--exclude-standard", "--", ...SEED_FILES]).split("\n").filter(Boolean).sort()) {
    hash.update(file);
    if (existsSync(join(root, file))) hash.update(readFileSync(join(root, file)));
  }
  return hash.digest("hex").slice(0, 16);
}

/** Each migration's name and a hash of what's in it. */
export function migrationsIn(folder) {
  return Object.fromEntries(readdirSync(folder).filter((name) => name.endsWith(".sql")).sort().map((name) => [name, createHash("sha256").update(readFileSync(join(folder, name))).digest("hex").slice(0, 16)]));
}

/**
 * A kept database whose migrations are the first of these, the same and in the same order, so the rest can be applied to it as they would to
 * an empty one: its folder, or null. Each is kept beside a list of what made it, <folder>.json (migrationsIn).
 */
export function keptMigratedDatabase(folder, migrations) {
  if (!existsSync(folder)) return null;
  const names = Object.keys(migrations);
  for (const listName of readdirSync(folder).filter((name) => name.endsWith(".json"))) {
    const kept = Object.entries(JSON.parse(readFileSync(join(folder, listName), "utf8")));
    const database = join(folder, listName.slice(0, -".json".length));
    if (existsSync(database) && kept.every(([name, hash], index) => names[index] === name && migrations[name] === hash)) return database;
  }
  return null;
}

/** Whether a snapshot's data fits a checkout: young enough, and the checkout has every migration that made it, the same. */
export function isSnapshotUsable({ madeAtMs, snapshotMigrations, checkoutMigrations, nowMs = Date.now() }) {
  return nowMs - madeAtMs < SNAPSHOT_USE_LIMIT_MS && Object.entries(snapshotMigrations).every(([name, hash]) => checkoutMigrations[name] === hash);
}

const isOffered = ({ platform = process.platform, env = process.env } = {}) => platform === "darwin" && !env.CI;

/** Puts this test data's snapshot at stateFolder (which isn't there yet) and answers when it was made, or null when there's none to use. */
export function restoreSnapshot({ root, phoneHost, stateFolder, directory = SNAPSHOT_DIRECTORY, nowMs = Date.now() }) {
  if (!isOffered()) return null;
  try {
    const snapshot = join(directory, seedKey({ root, phoneHost }));
    if (!existsSync(join(snapshot, "seeded"))) return null;
    const madeAtMs = statSync(join(snapshot, "seeded")).mtimeMs;
    const snapshotMigrations = JSON.parse(readFileSync(join(snapshot, MIGRATIONS_FILE), "utf8"));
    if (!isSnapshotUsable({ madeAtMs, snapshotMigrations, checkoutMigrations: migrationsIn(join(root, "migrations")), nowMs })) return null;
    rmSync(stateFolder, { recursive: true, force: true });
    if (spawnSync("cp", ["-c", "-R", snapshot, stateFolder]).status !== 0) {
      rmSync(stateFolder, { recursive: true, force: true });
      return null;
    }
    return madeAtMs;
  } catch (error) {
    console.log(`Couldn't use the kept test data, so it's being added: ${error.message}`);
    rmSync(stateFolder, { recursive: true, force: true });
    return null;
  }
}

/** Keeps stateFolder's test data for other checkouts. Only with the servers stopped. A snapshot that can't be made never stops a start. */
export function saveSnapshot({ root, phoneHost, stateFolder, directory = SNAPSHOT_DIRECTORY }) {
  if (!isOffered()) return;
  try {
    mkdirSync(directory, { recursive: true });
    const key = seedKey({ root, phoneHost });
    const made = join(directory, `.${key}.${process.pid}`);
    rmSync(made, { recursive: true, force: true });
    if (spawnSync("cp", ["-c", "-R", stateFolder, made]).status !== 0) return void rmSync(made, { recursive: true, force: true });
    for (const left of LEFT_OUT) rmSync(join(made, left), { recursive: true, force: true });
    writeFileSync(join(made, MIGRATIONS_FILE), JSON.stringify(migrationsIn(join(root, "migrations"))));
    rmSync(join(directory, key), { recursive: true, force: true });
    renameSync(made, join(directory, key));
    const oldest = readdirSync(directory).filter((name) => !name.startsWith(".")).map((name) => ({ name, madeAtMs: statSync(join(directory, name)).mtimeMs })).sort((a, b) => b.madeAtMs - a.madeAtMs).slice(KEPT_SNAPSHOT_COUNT);
    for (const { name } of oldest) rmSync(join(directory, name), { recursive: true, force: true });
  } catch (error) {
    console.log(`Couldn't keep the test data for other checkouts: ${error.message}`);
  }
}
