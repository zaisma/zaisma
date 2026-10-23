import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a Node script with no types of its own.
import { EVERYTHING_PATHS, affectedChecks, buildGraph, workerProjects } from "../../scripts/affected-tests.mjs";

/** scripts/affected-tests.mjs: which tests and checks a change can affect, from the repository's graph. */

const ROOT = join(import.meta.dirname, "../..");
const graph = buildGraph();
type Affected = { is_every_test_reached: boolean; test_files: { path: string; reached_by: string }[]; is_engine_exports_reached: boolean; is_layout_check_reached: boolean };
const affected = (changedPaths: string[]): Affected => affectedChecks({ changedPaths, graph });
const reached = (changedPaths: string[]) => affected(changedPaths).test_files.map((test) => test.path);

describe("the graph", () => {
  it("has every test file, in the projects vitest.config.ts runs them in", () => {
    const testFiles = ["node", "layout", "site", "games", "core", "game-server", "rooms"].flatMap((project) => readdirSync(join(ROOT, "test", project)).filter((name) => name.endsWith(".test.ts")).map((name) => `test/${project}/${name}`));
    expect([...graph.testFiles].sort()).toEqual(testFiles.sort());
    expect(Object.fromEntries(workerProjects())).toEqual({ site: "site", games: "games", core: "games", "game-server": "games", rooms: "rooms" });
  });

  it("follows a test's imports all the way down", () => {
    // test/node/naming.test.ts imports test/naming-source.ts, which reads every file under apps/ and packages/.
    expect(reached(["test/naming-source.ts"])).toContain("test/node/naming.test.ts");
    expect(reached(["apps/rooms/src/room.ts"])).toContain("test/node/naming.test.ts");
    expect(reached(["packages/game-server/src/room.ts"])).toEqual(expect.arrayContaining(["test/game-server/room.test.ts", "test/node/runner.test.ts"]));
  });

  it("runs a Workers test's whole Worker when the test calls it, and the migrations for every Workers test", () => {
    // Most site tests call the site Worker (SELF), so a change anywhere in its code reaches them.
    expect(reached(["apps/site/src/forum.ts"])).toEqual(expect.arrayContaining(["test/site/forum.test.ts", "test/site/accounts.test.ts"]));
    const workersTests = graph.testFiles.filter((path: string) => !/^test\/(node|layout)\//.test(path));
    expect(reached(["migrations/0001_init.sql"])).toEqual(expect.arrayContaining(workersTests));
    // The core tests only import what they test: the games Worker's own code isn't theirs.
    expect(reached(["apps/games/src/index.ts"]).some((path) => path.startsWith("test/core/"))).toBe(false);
  });

  it("reaches a test through the files it names, and the folders it reads", () => {
    expect(reached(["docs/NAMING.md"])).toContain("test/node/ids.test.ts");
    expect(reached(["docs/DEVELOPER-API.md"])).toContain("test/node/errors.test.ts");
    expect(reached(["migrations/0999_new.sql"])).toContain("test/node/migrations.test.ts");
    // A word that isn't a path part reaches nothing: the forum's "docs" category is no folder.
    expect(reached(["docs/DESIGN.md"])).not.toContain("test/site/forum.test.ts");
  });

  it("reaches nothing from what no test runs or reads", () => {
    // Besides this file, which names it as an example.
    expect(reached([".github/workflows/watch.yml"]).filter((path) => path !== "test/node/affected-tests.test.ts")).toEqual([]);
    expect(affected(["CLAUDE.md"]).is_every_test_reached).toBe(false);
  });

  it("reaches every test from what every test runs on", () => {
    for (const path of EVERYTHING_PATHS) expect(affected([path]).is_every_test_reached, path).toBe(true);
    expect(affected(["packages/game-server/src/pass.ts"]).is_every_test_reached).toBe(true);
    expect(affected(["test/shards.ts"]).is_every_test_reached).toBe(false);
  });

  it("would have run every test that failed on GitHub's check (Oct 22 and 23, 2026), from what each run changed", () => {
    // Each case: a changed path from that run, and the test that failed.
    const cases = [
      ["apps/site/src/admin.ts", "test/site/access-checks.test.ts"],
      ["apps/site/src/admin.ts", "test/node/stored-values.test.ts"],
      ["packages/game-server/bin/node.js", "test/node/runner.test.ts"],
      ["apps/site/src/components/backdrop-script.ts", "test/site/flow.test.ts"],
      ["apps/site/src/components/backdrop-script.ts", "test/site/strict-scripts.test.ts"],
      ["apps/site/src/account-data.ts", "test/node/errors.test.ts"],
      ["apps/rooms/src/database.ts", "test/rooms/room-load.test.ts"],
    ];
    for (const [changedPath, failedTest] of cases) expect(reached([changedPath!]), `${changedPath} → ${failedTest}`).toContain(failedTest);
  });
});

describe("the preview checks", () => {
  it("run the Engine exports for what they run, and not for the rest", () => {
    for (const path of ["apps/site/src/developer.ts", "apps/games/src/index.ts", "apps/compress/src/index.ts", "apps/rooms/src/room.ts", "packages/core/src/uploads.ts", "packages/sdk/zaisma.js", "packages/cli/zaisma.mjs", "migrations/0001_init.sql", "scripts/preview/run.mjs", "scripts/engines/play.mjs", "scripts/engines/samples.mjs", "scripts/chrome.mjs", "test/engines/godot/build/index.html", ".github/workflows/check.yml", "package.json", "package-lock.json"]) expect(affected([path]).is_engine_exports_reached, path).toBe(true);
    // The preview runs every Worker but photodna; it names apps/ whole, so photodna's code counts too, as more than it needs.
    for (const path of ["docs/DEVELOPER-API.md", "scripts/ship.mjs", "scripts/ship-github-check.mjs", "test/site/uploads.test.ts", "test/shards.ts", "vitest.config.ts", ".github/workflows/watch.yml"]) expect(affected([path]).is_engine_exports_reached, path).toBe(false);
    expect(affected(["docs/DEVELOPER-API.md", "packages/cli/zaisma.mjs"]).is_engine_exports_reached).toBe(true);
    expect(affected([]).is_engine_exports_reached).toBe(false);
  });

  it("run the Layout check for the pages' code and the check's own", () => {
    for (const path of ["apps/site/src/components/glass.ts", "scripts/layout-check.mjs", "test/layout/layout-check.test.ts"]) expect(affected([path]).is_layout_check_reached, path).toBe(true);
    expect(affected(["scripts/ship.mjs"]).is_layout_check_reached).toBe(false);
  });

  it("is what GitHub's check asks, before npm ci", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");
    const changes = workflow.slice(workflow.indexOf("name: What changed"), workflow.indexOf("\n  tests:"));
    expect(changes).toContain("node scripts/affected-tests.mjs --github");
    expect(changes).not.toContain("run: npm ci");
  });
});
