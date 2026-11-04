import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { isCheckPassed, isVersionOnlyDiff, parentOfVersionCommit } from "../../scripts/version-commit.mjs";

const manifestDiff = (name: string, changes: string[]) => [`diff --git a/packages/${name}/package.json b/packages/${name}/package.json`, "index 1a2b3c4..5d6e7f8 100644", `--- a/packages/${name}/package.json`, `+++ b/packages/${name}/package.json`, "@@ -3 +3 @@", ...changes].join("\n");
const VERSION_ONLY = manifestDiff("cli", ['-  "version": "0.38.0",', '+  "version": "0.39.0",']);

describe("a commit that only sets a version", () => {
  it("is one that changes only the version line of the CLI's or game server's manifest", () => {
    expect(isVersionOnlyDiff(VERSION_ONLY)).toBe(true);
    expect(isVersionOnlyDiff(`${VERSION_ONLY}\n${manifestDiff("game-server", ['-  "version": "1.23.0",', '+  "version": "1.24.0",'])}\n`)).toBe(true);
  });

  it("isn't one that changes anything else, even beside the version", () => {
    expect(isVersionOnlyDiff("")).toBe(false);
    expect(isVersionOnlyDiff(manifestDiff("cli", ['-  "bin": "old.js",', '+  "bin": "new.js",']))).toBe(false);
    expect(isVersionOnlyDiff(`${VERSION_ONLY}\n+  "postinstall": "curl",`)).toBe(false);
    expect(isVersionOnlyDiff(manifestDiff("core", ['-  "version": "1.0.0",', '+  "version": "1.1.0",']))).toBe(false);
    expect(isVersionOnlyDiff(`${VERSION_ONLY}\ndiff --git a/apps/site/src/home.ts b/apps/site/src/home.ts\n@@ -1 +1 @@\n-old\n+new`)).toBe(false);
    expect(isVersionOnlyDiff(`${VERSION_ONLY}\nold mode 100644\nnew mode 100755`)).toBe(false);
  });

  it("has one parent to stand on, so a merge commit gets the whole check", () => {
    const git = (parents: string, diff = VERSION_ONLY) => (gitArguments: string[]) => (gitArguments[0] === "rev-list" ? `${parents}\n` : diff);
    expect(parentOfVersionCommit(git("head parent"), "head")).toBe("parent");
    expect(parentOfVersionCommit(git("head parent other"), "head")).toBeNull();
    expect(parentOfVersionCommit(git("head"), "head")).toBeNull();
    expect(parentOfVersionCommit(git("head parent", "diff --git a/README.md b/README.md"), "head")).toBeNull();
  });

  it("stands only on a commit whose check passed", () => {
    const run = (status: string, conclusion: string | null, name = "Tests and typecheck") => ({ name, status, conclusion });
    expect(isCheckPassed([run("completed", "success")])).toBe(true);
    expect(isCheckPassed([])).toBe(false);
    expect(isCheckPassed([run("in_progress", null)])).toBe(false);
    expect(isCheckPassed([run("completed", "failure")])).toBe(false);
    expect(isCheckPassed([run("completed", "cancelled")])).toBe(false);
    expect(isCheckPassed([run("completed", "success", "Typecheck")])).toBe(false);
  });

  it("is asked about by the workflow on a pull request only, so the merge queue and main still run everything", () => {
    const workflow = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../.github/workflows/check.yml"), "utf8");
    expect(workflow).toContain('elif [ "$EVENT_NAME" = pull_request ] && [ "$(node scripts/version-commit.mjs "$HEAD_SHA")" = true ]; then');
  });
});
