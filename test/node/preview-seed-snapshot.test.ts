import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { isSnapshotUsable, keptMigratedDatabase, migrationsIn, restoreSnapshot, saveSnapshot, seedKey, SNAPSHOT_USE_LIMIT_MS } from "../../scripts/preview/seed-snapshot.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/** The preview's kept test data (scripts/preview/seed-snapshot.mjs): which seed files make which data, and when a checkout may take it. */

const NOW_MS = 1_800_000_000_000;
function checkout(): string {
  const root = temporaryFolder("zaisma-seed-");
  mkdirSync(join(root, "scripts/preview"), { recursive: true });
  mkdirSync(join(root, "migrations"));
  writeFileSync(join(root, "scripts/preview/run.mjs"), "seed");
  writeFileSync(join(root, "scripts/preview/memory.mjs"), "line");
  writeFileSync(join(root, "migrations/0001_first.sql"), "CREATE TABLE a (b);");
  writeFileSync(join(root, "README.md"), "words");
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "first"]]) execFileSync("git", args, { cwd: root });
  return root;
}

describe("the seed key", () => {
  it("is the same for two checkouts with the same seed files, and differs by address", () => {
    expect(seedKey({ root: checkout(), phoneHost: "" })).toBe(seedKey({ root: checkout(), phoneHost: "" }));
    const root = checkout();
    expect(seedKey({ root, phoneHost: "" })).not.toBe(seedKey({ root, phoneHost: "mac.example.test" }));
  });

  it("changes with a seed file, committed or not, and not with anything else", () => {
    const root = checkout();
    const before = seedKey({ root, phoneHost: "" });
    writeFileSync(join(root, "README.md"), "other words");
    writeFileSync(join(root, "scripts/preview/memory.mjs"), "the line changed");
    expect(seedKey({ root, phoneHost: "" })).toBe(before);
    writeFileSync(join(root, "scripts/preview/run.mjs"), "another seed");
    const changed = seedKey({ root, phoneHost: "" });
    expect(changed).not.toBe(before);
    writeFileSync(join(root, "scripts/preview/new.mjs"), "new");
    expect(seedKey({ root, phoneHost: "" })).not.toBe(changed);
  });
});

describe("whether a snapshot fits", () => {
  const usable = (madeAgoMs: number, snapshotMigrations: Record<string, string>, checkoutMigrations: Record<string, string>) => isSnapshotUsable({ madeAtMs: NOW_MS - madeAgoMs, snapshotMigrations, checkoutMigrations, nowMs: NOW_MS });

  it("takes a young one, whose migrations the checkout has, with newer ones of its own to apply", () => {
    expect(usable(1000, { a: "1" }, { a: "1", b: "2" })).toBe(true);
  });
  it("refuses one past the limit", () => {
    expect(usable(SNAPSHOT_USE_LIMIT_MS, {}, {})).toBe(false);
  });
  it("refuses one with a migration the checkout lacks or has differently", () => {
    expect(usable(1000, { a: "1", c: "3" }, { a: "1" })).toBe(false);
    expect(usable(1000, { a: "1" }, { a: "other" })).toBe(false);
  });
});

describe.runIf(process.platform === "darwin" && !process.env.CI)("a snapshot, kept and taken", () => {
  function seededState(root: string): string {
    const state = join(root, ".wrangler/preview");
    mkdirSync(join(state, "v3/d1"), { recursive: true });
    mkdirSync(join(state, "v3/cache"), { recursive: true });
    mkdirSync(join(state, "built"), { recursive: true });
    writeFileSync(join(state, "seeded"), "made");
    writeFileSync(join(state, "v3/d1/data.sqlite"), "rows");
    writeFileSync(join(state, "servers.log"), "lines");
    return state;
  }

  it("comes back in another checkout without what each start makes for itself", () => {
    const directory = temporaryFolder("zaisma-seeds-");
    const made = checkout();
    saveSnapshot({ root: made, phoneHost: "", stateFolder: seededState(made), directory });
    const taker = checkout();
    const state = join(taker, ".wrangler/preview");
    mkdirSync(join(taker, ".wrangler"));
    expect(restoreSnapshot({ root: taker, phoneHost: "", stateFolder: state, directory })).toEqual(expect.any(Number));
    expect(readFileSync(join(state, "v3/d1/data.sqlite"), "utf8")).toBe("rows");
    for (const left of ["v3/cache", "built", "servers.log"]) expect(existsSync(join(state, left))).toBe(false);
  });

  it("answers null for other seed files, another address and a migration the checkout lacks", () => {
    const directory = temporaryFolder("zaisma-seeds-");
    const made = checkout();
    writeFileSync(join(made, "migrations/0002_second.sql"), "CREATE TABLE c (d);");
    saveSnapshot({ root: made, phoneHost: "", stateFolder: seededState(made), directory });
    const taker = checkout();
    mkdirSync(join(taker, ".wrangler"));
    const state = join(taker, ".wrangler/preview");
    expect(restoreSnapshot({ root: taker, phoneHost: "other.example.test", stateFolder: state, directory })).toBeNull();
    expect(restoreSnapshot({ root: taker, phoneHost: "", stateFolder: state, directory })).toBeNull();
    expect(existsSync(state)).toBe(false);
    expect(migrationsIn(join(made, "migrations"))).toHaveProperty(["0002_second.sql"]);
  });

  it("is refused once it's older than the limit, and only the newest two stay", () => {
    const directory = temporaryFolder("zaisma-seeds-");
    const root = checkout();
    const state = seededState(root);
    saveSnapshot({ root, phoneHost: "", stateFolder: state, directory });
    const snapshot = join(directory, seedKey({ root, phoneHost: "" }));
    const longAgo = new Date(Date.now() - SNAPSHOT_USE_LIMIT_MS - 1000);
    utimesSync(join(snapshot, "seeded"), longAgo, longAgo);
    const taker = checkout();
    mkdirSync(join(taker, ".wrangler"));
    expect(restoreSnapshot({ root: taker, phoneHost: "", stateFolder: join(taker, ".wrangler/preview"), directory })).toBeNull();
    for (const phoneHost of ["a.example.test", "b.example.test", "c.example.test"]) saveSnapshot({ root, phoneHost, stateFolder: state, directory });
    expect(execFileSync("ls", [directory], { encoding: "utf8" }).trim().split("\n")).toHaveLength(2);
  });
});

describe("the kept database a fresh start builds on", () => {
  function keptFolder(kept: Record<string, string>): string {
    const folder = temporaryFolder("zaisma-migrated-");
    mkdirSync(join(folder, "abc"));
    writeFileSync(join(folder, "abc.json"), JSON.stringify(kept));
    return folder;
  }

  it("is one made from the first of these migrations, so only the rest are applied", () => {
    const folder = keptFolder({ "0001_a.sql": "h1", "0002_b.sql": "h2" });
    expect(keptMigratedDatabase(folder, { "0001_a.sql": "h1", "0002_b.sql": "h2", "0003_c.sql": "h3" })).toBe(join(folder, "abc"));
  });

  it("is never one with a migration that changed, is gone, or came before one it lacks", () => {
    const changed = keptFolder({ "0001_a.sql": "h1", "0002_b.sql": "old" });
    expect(keptMigratedDatabase(changed, { "0001_a.sql": "h1", "0002_b.sql": "h2" })).toBeNull();
    const gone = keptFolder({ "0001_a.sql": "h1", "0002_b.sql": "h2" });
    expect(keptMigratedDatabase(gone, { "0001_a.sql": "h1" })).toBeNull();
    const skipped = keptFolder({ "0001_a.sql": "h1", "0003_c.sql": "h3" });
    expect(keptMigratedDatabase(skipped, { "0001_a.sql": "h1", "0002_b.sql": "h2", "0003_c.sql": "h3" })).toBeNull();
  });

  it("is none when nothing is kept", () => {
    expect(keptMigratedDatabase(join(temporaryFolder("zaisma-migrated-"), "none"), { "0001_a.sql": "h1" })).toBeNull();
  });
});
